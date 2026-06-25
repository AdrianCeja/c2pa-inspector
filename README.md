# C2PA Inspector

A desktop app to inspect **C2PA / Content Credentials (CAI)** embedded in images
and videos. Drop a file in and instantly see who generated it, the **CAI / claim
generator versions**, whether it is **AI‑generated** (and with which model), the
signing certificate, and the overall validation status — plus the full raw
manifest JSON with syntax highlighting.

It is a graphical front‑end for [`c2patool`](https://github.com/contentauth/c2pa-rs),
built with Electron and styled after macOS, running on Windows.

> Evolves the original `c2patoolPS` PowerShell scripts into a proper app.

## Features

- **Images and videos** — JPG, PNG, WebP, AVIF, TIFF, MP4, MOV…
- **Drag & drop** one or many files, or pick files to inspect.
- **Readable summary cards**: validation state, content credentials & CAI
  versions, AI generation + model, signing certificate, and provenance
  (ingredient chain).
- **Built‑in JSON viewer** with syntax highlighting, light/dark theme and line
  numbers — no need to open another app.
- **Open in your editor** (VS Code / Notepad — whatever is your default for
  `.json`) and **Save JSON…** when you want a copy on disk.
- macOS‑style UI: frameless window, traffic‑light controls, translucency,
  automatic light/dark mode.

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+ (developed on v22)
- `c2patool.exe` (provided automatically by `npm run setup`, see below)

## Getting started

```powershell
# 1. Install dependencies
npm install

# 2. Provide the c2patool.exe binary (copies a local one or downloads it)
npm run setup

# 3. Run the app
npm run dev
```

## Building a distributable

```powershell
npm run dist
```

This produces an NSIS installer in `dist/`. The `c2patool.exe` binary is bundled
automatically. To use a custom app icon, drop a 256×256 `build/icon.ico` before
building.

## Releasing a new version

Releases are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`) whenever a version tag is pushed. Installed
apps then update themselves via `electron-updater`.

```powershell
npm version patch      # bumps package.json (e.g. 0.1.0 -> 0.1.1) and tags it
git push --follow-tags # pushes the commit and the tag -> CI builds & publishes
```

## How it works

The app runs `c2patool.exe "<file>"`, which prints the C2PA manifest store as
JSON to stdout. That JSON is parsed in memory (`src/renderer/parser.js`) into a
small view model and rendered as cards; the raw JSON is shown in the viewer. The
manifest is only written to disk when you choose **Open in editor** or
**Save JSON…**.

## Project structure

```
src/
  main.js              Electron main process (window, IPC, runs c2patool)
  preload.js           Secure bridge exposed to the UI (window.c2pa)
  renderer/
    index.html         Window layout
    app.css            macOS-style theme (light/dark)
    app.js             UI logic: drag & drop, batch, cards, JSON viewer
    parser.js          manifest store JSON -> view model
scripts/
  fetch-c2patool.mjs   Provides resources/c2patool.exe
resources/
  c2patool.exe         The C2PA CLI (git-ignored, provided by setup)
```

## Publishing to GitHub

This repo is ready to push. With the [GitHub CLI](https://cli.github.com/):

```powershell
gh repo create c2pa-inspector --source . --private --push
```

Or manually, after creating an empty repo on github.com:

```powershell
git remote add origin https://github.com/<user>/c2pa-inspector.git
git push -u origin main
```

## License

[MIT](LICENSE). Bundles `c2patool` from the
[Content Authenticity Initiative](https://github.com/contentauth/c2pa-rs)
(Apache-2.0 / MIT).
