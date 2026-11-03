# Quire PDF Studio for Windows

The Windows desktop app. Like the Mac app in `mac/`, it is a thin offline
Electron wrapper around the shared web app, `web/quire-pdf-studio.html`, so both
desktop apps always have exactly the same features. Edit the web file, rebuild,
and both apps pick up the change.

## What the wrapper adds on Windows

- Installer (Start menu and desktop shortcuts) and a portable `.exe` that runs without installing, for x64 and ARM64.
- Registers as a PDF editor, so you can right-click a PDF and choose *Open with → Quire PDF Studio*. Opening a second PDF while the app is running sends it to the open window.
- Native File menu with Open (Ctrl+O), Save (Ctrl+S), Save As (Ctrl+Shift+S) and Print (Ctrl+P), plus Windows recent documents in the taskbar jump list.
- Works offline. Nothing can be uploaded: every outgoing request is blocked, except downloading code libraries or OCR language data from public CDNs if the web app asks for them. The camera is allowed for the batch scanner.

## Build it on your PC

1. Install Node.js LTS from https://nodejs.org (one time).
2. Make sure `web/quire-pdf-studio.html` sits next to the `windows/` folder.
3. Double-click `windows\build-local.bat`.

The `windows\dist` folder opens when it finishes, with
`Quire-PDF-Studio-1.0.0-x64-setup.exe` (installer) and
`Quire-PDF-Studio-1.0.0-x64-portable.exe` (no install).

To try it without building: `cd windows`, `npm install`, `npm start`.

## Build it on GitHub instead

Once the web app is committed, the *Build Windows app* workflow
(`.github/workflows/windows-build.yml`) builds both `.exe` files on a Windows
machine on every push to `main`, or on demand from the Actions tab. Download
them from the run's *Artifacts* section.

## Hooks for the web app (optional)

The web app works unchanged. If it wants native file dialogs, it can check for
`window.quireDesktop` (also worth exposing the same object from the Mac wrapper):

- `quireDesktop.open()` shows the Open dialog; chosen files arrive through the web app's normal drag-and-drop loader.
- `quireDesktop.save(bytes, suggestedName, path?)` writes a file, asking where if no path is given.
- `quireDesktop.onMenu(cmd => …)` receives `save` and `save-as` from the File menu.

Windows SmartScreen will warn on first run because the app isn't code-signed.
Click *More info → Run anyway*.
