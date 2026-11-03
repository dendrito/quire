# Quire PDF Studio: handoff

Context for a new Claude Code session continuing this project on the Mac.

## What this is

A personal PDF editor modelled on PDF-XChange Pro. It runs entirely on the device: no uploads.

- `web/quire-pdf-studio.html`: the whole app in one file (vanilla JS, pdf.js 3.11.174, pdf-lib 1.17.1, JSZip 3.10.1 and Tesseract.js 5.1.1 loaded lazily). It is also published as a private claude.ai artifact: https://claude.ai/artifact/T3vz7q5rYGkmzAJ63Q7L1F. The file has no `<html>`/`<head>` because the artifact publisher adds them.
- `mac/`: an Electron wrapper that runs 100% offline.
  - `src/quire.html` is a copy of the app file. Re-copy it after every change.
  - `scripts/vendor.js` (run on `npm install`, `npm start` and `npm run dist`) copies the libraries, Tesseract core, 8 OCR languages and the Caveat font from `node_modules` into `app/vendor`. It builds `app/index.html` with the CDN URLs swapped for local ones and sets `window.QUIRE_VENDOR = "vendor/"`.
  - `main.js` serves `app/` over a privileged `app://` scheme so workers and fetch work, blocks every http(s)/ws/ftp request, and forwards PDFs opened from Finder through `preload.js`.
  - `.github/workflows/build-mac.yml` builds the `.dmg` on GitHub's macOS runners.
  - The app is unsigned (`identity: null`). The README covers the Gatekeeper workaround.

## Features done and tested

- **Markup:** text, notes (exported as real PDF Text annotations), highlight, pen, rectangle, ellipse, line, arrow, stamps (with name and date), signature (draw, type or upload), image, whiteout, redaction (pages are rasterised on save), distance and area measuring with calibration.
- **Pages:** rotate, move, delete, duplicate, blank page, insert file, extract, split to zip, combine, images to PDF.
- **Forms:** add text fields and checkboxes, fill, flatten.
- **Tools:** search (plus highlight or redact every match), watermark, header/footer, Bates numbering, properties, compress (lossless or rasterise), OCR (invisible text layer), page to PNG, export text.
- **General:** tabs, undo/redo, shortcuts.
- **Saving:** markup is drawn into the pages. An optional "editable" mode embeds `quire-source.pdf` and `quire-annotations.json` as attachments, and they are restored on reopen.
- **Design (latest):** minimal and Mac-like. System font, frosted floating toolbar with icon-only buttons and JS tooltips (`data-tip`), an inspector that appears only when there's something to adjust (`PANEL_TOOLS` or a selection or a task; the `#bInfo` button toggles a document/markup view), a page and zoom pill, and a collapsible thumbnail sidebar. A ResizeObserver re-fits "fit width".

## Batch scanner (done, 3 Nov 2026)

Open it with **Scan** in the top bar, the camera button on the Pages toolbar, or the empty screen. It works with no document open.

- **Capture:** Manual (Space or the round button), Timer (every 2 to 15 s, with a countdown), or Auto (shoots when the detected page has been still for about 0.9 s, then waits until the frame changes, i.e. the page is turned, before it re-arms). Space captures in every mode. A camera picker appears when there is more than one camera. **Import photos** works everywhere, including the claude.ai artifact, which blocks the camera.
- **Edges:** downscale to 240 px (420 px for a captured photo), score each pixel as brightness minus saturation, box blur, Otsu threshold, largest component, convex hull of its boundary, then the 4 hull points with the largest area. The page is straightened with an 8-parameter homography and bilinear sampling (long side up to 2400 px).
- **Page editor:** draggable corners with a 3x magnifier, find edges again, use the whole photo, rotate, retake, remove, reorder by dragging thumbnails. Corners / Result toggle.
- **Filters:** Colour, Enhanced, Grey, B&W. The last three divide out an estimate of the paper's brightness on a coarse grid, which removes shadows and makes the paper white. "Use this filter on every page".
- **Margins (mm):** one set for the whole batch, or "This page" for its own. Positive adds white paper, negative trims into the scan.
- **PDF:** page size "Match each scan" (210 mm or Letter wide), A4 or Letter. Create PDF opens a new tab; "Add to <document>" inserts after the current page.
- Everything is non-destructive until Create PDF: each page keeps `{src, quad, rot, filter, margins}`.

## Crop margins (done)

Pages toolbar, crop button. **Set margins** (top/bottom/left/right in mm, in or pt, linkable, or drag the dashed edges on the page) or **Trim white space** (renders each page, finds where the content ends and keeps a border). Scope: all, selected or current page. It sets each page's CropBox, so the margins are hidden rather than deleted; **Remove crop** restores them. Works on rotated pages.

## Mac camera permission (done)

`package.json` has `NSCameraUsageDescription`; `main.js` allows only video media and answers `ask-camera` with `systemPreferences.askForMediaAccess('camera')`; `preload.js` exposes `askCamera`, which the scanner calls before `getUserMedia`.

## Research notes (scanning and PDF apps)

- Microsoft Lens was retired in 2026 (OneDrive replaces it); Adobe Scan and Genius Scan are the usual picks.
- vFlat: auto-shoot on page change, a timer option, book flattening, two-page split, finger removal.
- Auto-capture that fires too early is the top complaint about Adobe Scan, hence the stability window and the page-change re-arm here.
- PDF Expert's crop hides margins (reversible) and offers "crop all pages"; Quire copies both.
- Not yet copied, worth considering: two-page book split, curved-page flattening, finger removal.

## Testing notes

- Test by serving the files over localhost. The artifact file needs a `<!doctype html>…<body>` wrapper to run as a standalone page.
- After each change: copy `web/quire-pdf-studio.html` to `mac/src/quire.html` (and the Windows wrapper's copy) and republish the artifact (same URL).
