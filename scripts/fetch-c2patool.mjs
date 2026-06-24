#!/usr/bin/env node
/**
 * Provides resources/c2patool.exe for the app.
 *
 * Strategy:
 *   1. If resources/c2patool.exe already exists, do nothing.
 *   2. Otherwise copy a local binary if one can be found
 *      (env C2PATOOL_SRC, the sibling c2patoolPS/app, or ./app).
 *   3. Otherwise download the Windows x64 build from the
 *      contentauth/c2pa-rs GitHub releases and extract it.
 *
 * Set the version with: C2PATOOL_VERSION=0.26.67 npm run setup
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  createWriteStream,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const dest = join(projectRoot, 'resources', 'c2patool.exe');
const VERSION = process.env.C2PATOOL_VERSION || '0.26.67';

main().catch((err) => {
  console.error('\n✗ Could not provide c2patool.exe automatically.');
  console.error('  ' + err.message);
  console.error(
    '\n  Manual fix: download the Windows build from\n' +
      '  https://github.com/contentauth/c2pa-rs/releases?q=c2patool\n' +
      `  and place c2patool.exe at:\n  ${dest}\n`,
  );
  process.exit(1);
});

async function main() {
  if (existsSync(dest)) {
    console.log('✓ c2patool.exe already present:', dest);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });

  if (tryCopyLocal()) return;
  await download();
}

/** Copy an existing c2patool.exe from a known location. */
function tryCopyLocal() {
  const candidates = [
    process.env.C2PATOOL_SRC,
    resolve(projectRoot, '..', 'c2patoolPS', 'app', 'c2patool.exe'),
    resolve(projectRoot, 'app', 'c2patool.exe'),
  ].filter(Boolean);

  for (const src of candidates) {
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log('✓ Copied c2patool.exe from', src);
      return true;
    }
  }
  return false;
}

/** Download + extract the Windows build from GitHub releases. */
async function download() {
  const asset = `c2patool-v${VERSION}-x86_64-pc-windows-msvc.zip`;
  const url = `https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v${VERSION}/${asset}`;
  console.log('Downloading', url);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  const work = join(tmpdir(), `c2patool-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const zipPath = join(work, asset);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

  // Windows 10/11 ships bsdtar, which extracts .zip archives.
  execFileSync('tar', ['-xf', zipPath, '-C', work], { stdio: 'inherit' });

  const exe = findExe(work);
  if (!exe) throw new Error('c2patool.exe was not found inside the archive');
  copyFileSync(exe, dest);
  rmSync(work, { recursive: true, force: true });
  console.log('✓ Installed c2patool.exe ->', dest);
}

/** Recursively look for c2patool.exe under dir. */
function findExe(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    } else if (name.toLowerCase() === 'c2patool.exe') {
      return full;
    }
  }
  return null;
}
