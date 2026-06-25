'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Secure API exposed to the renderer as `window.c2pa`.
 * No Node internals leak into the page; everything goes through IPC.
 */
contextBridge.exposeInMainWorld('c2pa', {
  toolVersion: () => ipcRenderer.invoke('tool:version'),
  analyze: (filePath) => ipcRenderer.invoke('analyze', filePath),
  pickFiles: () => ipcRenderer.invoke('pick:files'),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),
  openInEditor: (json, name) => ipcRenderer.invoke('open:editor', { json, name }),
  saveJson: (json, name) => ipcRenderer.invoke('save:json', { json, name }),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),

  // Resolve the absolute path of a dropped File (File.path was removed in
  // recent Electron versions in favour of webUtils.getPathForFile).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file && file.path ? file.path : null;
    }
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onState: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state)),
  },
});
