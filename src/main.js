'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { autoUpdater } = require('electron-updater');

const execFileAsync = promisify(execFile);
const isDev = !app.isPackaged;

const MEDIA_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif',
  '.heic', '.heif', '.dng', '.mp4', '.mov', '.m4v', '.avi', '.m4a', '.wav',
]);

/** Absolute path to the bundled c2patool binary. */
function c2patoolPath() {
  return isDev
    ? path.join(__dirname, '..', 'resources', 'c2patool.exe')
    : path.join(process.resourcesPath, 'c2patool.exe');
}

let mainWindow = null;

// Last known auto-update status, so the renderer can ask for it on load
// (events may fire before the window has finished loading).
let updateStatus = { state: 'idle', version: null, percent: 0 };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececf0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const sendState = () =>
    mainWindow?.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  initAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Checks GitHub Releases for a newer version and downloads it in the
// background. The renderer shows a Download button (Discord-style) that only
// appears when an update exists; clicking it restarts and installs.
// No-ops in development (unpackaged build).
function initAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel, payload) => {
    try {
      mainWindow?.webContents.send(channel, payload);
    } catch {
      /* window gone */
    }
  };

  autoUpdater.on('error', (err) =>
    console.error('[updater]', err == null ? 'unknown error' : err.message || err),
  );
  autoUpdater.on('update-available', (info) => {
    updateStatus = { state: 'available', version: (info && info.version) || null, percent: 0 };
    send('update:available', updateStatus);
  });
  autoUpdater.on('download-progress', (p) => {
    updateStatus = { ...updateStatus, state: 'downloading', percent: p ? p.percent : 0 };
    send('update:progress', updateStatus);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = { state: 'downloaded', version: (info && info.version) || updateStatus.version, percent: 100 };
    send('update:downloaded', updateStatus);
  });

  autoUpdater
    .checkForUpdates()
    .catch((err) => console.error('[updater]', err.message || err));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('tool:version', getToolVersion);
  ipcMain.handle('analyze', (_e, filePath) => analyze(filePath));

  ipcMain.handle('pick:files', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select media files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: [...MEDIA_EXT].map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return canceled ? [] : filePaths;
  });

  ipcMain.handle('open:editor', async (_e, { json, name }) => {
    const file = path.join(os.tmpdir(), 'c2pa-inspector', safeName(name));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, json, 'utf8');
    const err = await shell.openPath(file);
    return err ? { ok: false, error: err } : { ok: true, path: file };
  });

  ipcMain.handle('save:json', async (_e, { json, name }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save manifest JSON',
      defaultPath: safeName(name),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fs.writeFile(filePath, json, 'utf8');
    return { ok: true, path: filePath };
  });

  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('update:state', () => updateStatus);
  ipcMain.handle('update:install', () => {
    // Restart into the freshly downloaded version.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
  ipcMain.handle('open:external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
}

async function getToolVersion() {
  try {
    const { stdout } = await execFileAsync(c2patoolPath(), ['-V'], { windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Run c2patool against a single asset. c2patool prints the manifest store
 * report as JSON to stdout; it exits non-zero when there is no manifest.
 */
async function analyze(filePath) {
  const name = path.basename(filePath);
  try {
    const { stdout } = await execFileAsync(c2patoolPath(), [filePath], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    const raw = stdout.trim();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* not valid JSON */
    }
    return { ok: true, hasManifest: Boolean(json), name, path: filePath, raw, json };
  } catch (e) {
    const stderr = String(e.stderr || '');
    const stdout = String(e.stdout || '');
    const blob = `${stderr}\n${stdout}`;
    const noManifest = /no\s+claim|no\s+manifest|not\s+found|jumbf|no\s+c2pa/i.test(blob);
    return {
      ok: false,
      hasManifest: false,
      name,
      path: filePath,
      raw: stdout.trim(),
      error: (stderr || e.message || 'Unknown error').trim(),
      noManifest,
    };
  }
}

/** Build a safe `<base>.manifest.json` filename from an asset name. */
function safeName(name) {
  const base = (name || 'manifest')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.[^.]+$/, '');
  return `${base}.manifest.json`;
}
