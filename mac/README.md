# Quire PDF Studio for macOS

The same app as the web version, packaged as a native Mac app that runs 100% offline.

## Offline by design

- **Everything is bundled.** PDF engines (pdf.js, pdf-lib), zip export (JSZip), OCR (Tesseract, with 17 languages built in: English, Portuguese, Italian, Hebrew, Arabic, Spanish, Japanese, Chinese Simplified and Traditional, French, German, Dutch, Catalan, Syriac, Persian, Russian, Korean, plus Polish) and fonts are copied into the app when you build it. Another 100 or so OCR languages can be downloaded from inside the app (OCR → More languages). That download is the only network request the app allows, and it only fetches the language file you picked.
- **The network is blocked.** The app refuses every `http`, `https`, WebSocket and FTP request, so nothing can be fetched or sent. Links you click open in your normal browser instead.
- **Files stay put.** Your documents are read from disk and saved back to disk. Nothing is uploaded.

To see it for yourself: turn off Wi-Fi, open the app, and use OCR, compression and saving as normal.

## Build on a Mac

You need Node.js 20 or newer (from https://nodejs.org). The internet is needed only for this one-time `npm install`.

```bash
cd quire-mac
npm install        # downloads the libraries and bundles them into app/
npm start          # run it straight away
npm run dist       # build the .dmg files in dist/ (Apple silicon and Intel)
```

Open the `.dmg` and drag **Quire PDF Studio** into Applications.

## Build without a Mac

Push this folder to a GitHub repository. Open **Actions**, pick **Build macOS app**, then click **Run workflow**.
When it finishes, download the `.dmg` from the run's artifacts.

## First launch

The app isn't signed with an Apple Developer ID, so Gatekeeper blocks it the first time.
Right-click the app in Applications, choose **Open**, then confirm. You only need to do this once.

## How it fits together

| File | What it does |
| --- | --- |
| `src/quire.html` | The whole app. Same file as the web version. |
| `scripts/vendor.js` | Copies libraries, OCR data and fonts from `node_modules` into `app/vendor`, and builds `app/index.html` with every web address swapped for a local file. Runs after `npm install` and before `npm start` / `npm run dist`. |
| `main.js` | Opens the window, serves `app/` through a private `app://` address, blocks the network, and handles PDFs opened from Finder. |
| `preload.js` | Passes files opened from Finder to the page. |

To update the app, replace `src/quire.html` with the newer version and run `npm run dist` again.
