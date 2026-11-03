# Quire PDF Studio for Windows

The same app as the web version and the Mac app, packaged as a native Windows app that runs 100% offline.
It is a twin of `mac/`: same app file, same bundled libraries, same offline rules.

## Offline by design

- **Everything is bundled.** PDF engines (pdf.js, pdf-lib), zip export (JSZip), OCR (Tesseract with English, German, French, Spanish, Italian, Portuguese, Dutch and Polish) and fonts are copied into the app when you build it.
- **The network is blocked.** The app refuses every `http`, `https`, WebSocket and FTP request, so nothing can be fetched or sent. Links you click open in your normal browser instead.
- **Files stay put.** Your documents are read from disk and saved back to disk. Nothing is uploaded.

## Document scanners

The Scan screen has a **Document scanner** panel in the Windows app. It works with any scanner that has a Windows driver (WIA), which covers nearly all of them, including printer/scanner combos.

- Pick the scanner, then **Flatbed**, **Feeder** or **Both sides** (duplex). Feeder modes scan until the feeder is empty.
- Choose resolution (150–600 dpi) and Colour, Grey or B&W.
- **Scanner's own settings…** opens the scanner maker's window, with every option its driver has.
- Scanned pages land in the same strip as camera pages, so reordering, rotating, filters and margins all work the same.

It runs through Windows' built-in PowerShell (`scanner/wia.ps1`). Nothing is installed and nothing leaves the PC.

## Build on a Windows PC

You need Node.js 20 or newer (the LTS installer from https://nodejs.org). The internet is needed only for this one-time `npm install`.

Open PowerShell in this folder, then:

```powershell
npm install        # downloads the libraries and bundles them into app\
npm start          # run it straight away
npm run dist       # build the installer and portable .exe files in dist\
```

`dist\` then holds, for both normal PCs (x64) and ARM PCs (arm64):

- `Quire-PDF-Studio-Setup-….exe`: installer with Start menu and desktop shortcuts. It registers Quire as a PDF app, so you can right-click a PDF and choose **Open with → Quire PDF Studio**.
- `Quire-PDF-Studio-Portable-….exe`: runs without installing, for example from a USB stick.

## Build without a Windows PC

Push this folder to a GitHub repository. Open **Actions**, pick **Build Windows app**, then click **Run workflow**.
When it finishes, download the `.exe` files from the run's artifacts.

## First launch

The app isn't code-signed, so Windows SmartScreen warns the first time.
Click **More info**, then **Run anyway**. You only need to do this once.

## How it fits together

| File | What it does |
| --- | --- |
| `src/quire.html` | The whole app. Same file as `web/quire-pdf-studio.html` and `mac/src/quire.html`. |
| `scripts/vendor.js` | Identical to the Mac one. Copies libraries, OCR data and fonts from `node_modules` into `app/vendor`, and builds `app/index.html` with every web address swapped for a local file. |
| `main.js` | Opens the window, serves `app/` through a private `app://` address, blocks the network, allows only the camera (for the scanner), runs document scans, and handles PDFs opened from Explorer. Opening a second PDF sends it to the window already open. |
| `preload.js` | Like the Mac one (opened files, camera check), plus `quireDesktop.scanner` for document scanners. |
| `scanner/wia.ps1` | Lists scanners and scans pages through Windows Image Acquisition. |

To update the app, replace `src/quire.html` with the newer version (copy `web/quire-pdf-studio.html` here and into `mac/src/`) and run `npm run dist` again.
