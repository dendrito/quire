# Quire PDF Studio: handoff

Context for a new Claude Code session continuing this project on the Mac.

## What this is

A personal PDF editor modelled on PDF-XChange Pro. It runs entirely on the device: no uploads.

- `web/quire-pdf-studio.html`: the whole app in one file (vanilla JS, pdf.js 3.11.174, pdf-lib 1.17.1, JSZip 3.10.1 and Tesseract.js 5.1.1 loaded lazily). It is also published as a private claude.ai artifact: https://claude.ai/artifact/T3vz7q5rYGkmzAJ63Q7L1F. The file has no `<html>`/`<head>` because the artifact publisher adds them.
- `mac/`: an Electron wrapper that runs 100% offline.
  - `src/quire.html` is a copy of the app file. Re-copy it after every change.
  - `scripts/vendor.js` (run on `npm install`, `npm start` and `npm run dist`) copies the libraries, Tesseract core, the bundled OCR languages (`OCR_LANGS`, announced to the page as `window.QUIRE_OCR_LANGS`) and the Caveat font from `node_modules` into `app/vendor`. It builds `app/index.html` with the CDN URLs swapped for local ones and sets `window.QUIRE_VENDOR = "vendor/"`.
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

## Ideas from PDF-XChange (done, 3 Nov 2026)

Write-up: https://claude.ai/artifact/WvGqbDxrxE6QRiPpnYaCH5. The code lives in the "organise, page size & margins, settings" block, just above `findAll`.

- **Organise** (Pages toolbar): a full-screen grid of every page. Click, Shift-click and Ctrl/⌘-click to select. Drag to reorder, or drop PDFs between pages to insert them. It has rotate, duplicate, blank, insert, extract and delete. Shortcuts: Del, Ctrl+A, Ctrl+D, the arrow keys, Enter and Esc. The grid rebuilds after every edit through a hook in `reloadDoc`.
- **Arrange & clean up** (`TASKS.arrange`): move up or down, move to page N, reverse, and swap. **Collate fronts and backs** is for one-sided feeders and assumes the backs are reversed. **Find blank pages** looks at ink coverage with a sensitivity slider. **Find duplicate pages** compares a 24×32 normalised thumbnail, plus the text when there is any. Results can be selected or deleted. **Split** works every N pages, at blank separator pages (which are dropped), into odd and even, or into single pages, and saves a .zip.
- **Page size & margins** (`TASKS.pagesize`):
  - **Resize** goes to A4, Letter, Legal, A5, A3 or a custom size. **Normalize** goes to the most common size, the first page in range, or the largest page. Orientation can match each page or be fixed. Content can be fit, shrunk only, or kept at actual size.
  - **Add margins** has a per-side or linked value and a binding margin: left on odd pages, right on even pages.
  - Scope is all, selected or current, then all, odd or even.
  - `placeContent` wraps the content stream in a transform plus a clip to the old visible area, so a previous crop stays hidden. It also moves link Rects and QuadPoints and Quire markup.
- **Toolbar labels:** words under the icons, on by default and switchable in Settings.
- **Settings:** the gear in the top bar, with labels, units and your name.
- **Command search:** the lightning button, or Ctrl/⌘+K (or Ctrl+.), finds any command by name or keyword.
- Up and Down moved off the Pages toolbar and into Arrange.

## Compression, Combine and Smart fit (done, 4 Nov 2026)

Code: the "smart fit" and "compression and combine" blocks above `findAll`.

- **Smart compress** (Tools, Compress) keeps text. Each image gets the codec that suits it: JPEG with the quality found by binary search against an SSIM target (`jpegTuned`), a lossless Indexed palette for images with 256 colours or fewer, or 1-bit Flate (Otsu threshold) for black-and-white scans. The smallest wins, with lossless favoured unless JPEG is 30% smaller. It handles DCT and Flate images (with PNG predictors) and keeps SMask. Options: resolution, quality (Smallest/Balanced/Best = SSIM .955/.975/.988), grey, `dedupeObjects` (identical streams and Font/FontDescriptor/ExtGState stored once, then unreachable objects dropped) and `stripHidden` (page Thumb and PieceInfo).
- **Scans: Text over background (MRC)** (`mrcPage`): Sauvola threshold makes a 1-bit mask at 150 to 400 dpi. The paper is averaged with text pixels left out into a 75 to 100 dpi JPEG, and the ink colour is a 25 dpi JPEG drawn through the mask (explicit /Mask). Pages that are more than 30% ink fall back to one JPEG. Text needs OCR afterwards.
- **Combine** (`combineFiles`): a window to order files (drag, arrows, A–Z, reverse), page ranges per file, a bookmark per file, each file's own bookmarks kept and nested (`readOutline` resolves named destinations; `addOutlineTree`), form fields registered with clashing names renamed (`mergeFields`), duplicate fonts removed, and the result as a new PDF or appended to the open one.
- **Smart fit** (Pages toolbar, `sfOpen`): one size for every page. It loads an uncropped copy, measures the ink on each page, and picks the size with the least shrinking, then the least added paper, then the least content cut, preferring real paper sizes or sizes already in the file. Other choices: most common, smallest, A4, Letter, A5, Legal or custom. A crop window is placed around the content (centre, top or page centre, with padding) and can be dragged per page. Applying sets the CropBox only; when the window is bigger than the paper the MediaBox grows, and only when content can't fit is it scaled (`placeContent`). Re-opening starts from the current crops.

## Library search across books (done, 4 Nov 2026)

Index → **Library**, or Ctrl+Shift+F (`libOpen`, block "library search" above the signature code). Works without an open file.

- **Folders**: Add folder uses `showDirectoryPicker` (the handle is kept in IndexedDB, so the folder stays added between visits; Quire asks for read permission again when needed). Where that API is missing (Safari, Firefox) a folder input is used and the files last only for the session. Subfolders are included; to search a whole disk or the Google Drive folder on the computer, add its top folder. PDFs only.
- **Index** (IndexedDB `quire-library`): `books` (path, size, mtime, page labels, per-page term counts, metadata from XMP/Info or the "Title - Author.pdf" name), `text` (page text for snippets and copying), `terms` (one row per stem: `num.gen|page,tf,…;…`). Update index re-reads only changed files and drops removed ones. Books with text-less pages are listed so they can be OCR'd.
- **Search**: accent folding plus a light pt/es/en stemmer (inquisição, inquisições, Inquisition, inquisición → `inquis`), BM25 ranking over pages (k1 1.2, b .75), words ANDed, `"phrase"`, `word*`, `-word`; a word with no hits falls back to vocabulary words 1–2 edits away (OCR slips) and says so. Views: by book, or best pages.
- **Actions on selected pages**: copy with citations (plain + HTML, so it pastes formatted into Google Docs and Word), Google Docs (copies, with a .docx fallback), Word .docx (built with JSZip, Heading/Quote styles), Markdown, RIS, BibTeX, Send to Zotero, Merge into a PDF (one bookmark per book), Open a book at the page. Citation style ABNT, APA or Chicago.
- **Send to Zotero**: the Mac and Windows apps relay through the main process (`zotero-save` IPC, preload `quireDesktop.zotero`) to the Zotero app's connector server on 127.0.0.1:23119 (`/connector/saveItems`); items go to the collection selected in Zotero, one book item per book with a note per passage. The browser version uses the Zotero web API with a key the owner pastes once (kept in localStorage, Disconnect in the Library sidebar).
- Tested in Chromium with two generated books: stemming, ranking, fuzzy, phrase, prefix, exclusions, all exports (docx opened as XML, md, bib, ris), merge with bookmarks, open at page, phone layout, Zotero desktop and web calls against mocks. Not tried yet: a real Zotero app or account, a large real library, `showDirectoryPicker` with a real folder.
- Not built yet: live Google Docs (needs a Google Cloud OAuth client ID from the owner), Mendeley API, EPUB.

## PDF-XChange features, batches 1 and 2 (done, 4 Nov 2026)

Each lives in its own block in web/quire-pdf-studio.html, above "compression and combine":
- **reading & review** (commit 3eb54f2): text layer and Select text tool (C), selection bar, underline/strikeout, Link tool (K) writing real Link annotations, Links panel, print dialog, View ribbon tab (back/forward, single/two/book, rotate view), comments list.
- **forms**: field tools fradio/fdrop/flist/fdate/fbutton (FFIELD set), addFormField + fieldDialog, the rewritten Fill form panel (TASKS.form) with date pickers, radio groups, reset, Edit fields (rename/required/read-only/delete), import/export data (formDataIn/formDataOut: XFDF, FDF, JSON, CSV), formMerge (one copy per CSV row, zip or one PDF), detectFields (underscores, box characters, ruled lines and hollow squares on rendered pages).
- **read aloud, statistics, compare**: speakText/stopSpeaking redefined (sentence chunks, voice picked by guessLang), TASKS.read, TASKS.stats (counts, reading time, keywords), TASKS.compare (Myers word diff with page positions; pixel diff for scans), cmpMark adds highlights/notes or boxes as ordinary markup.
- **password protection**: md5, rc4, hash2B (ISO 32000-2 alg. 2.B) via WebCrypto; encryptPdf writes AES-256 (V5 R6); decryptPdf unlocks R2-R6 (RC4, AESV2, AESV3) with the user or owner password. Files whose objects sit in encrypted object streams can't be unlocked yet (pdf-lib parses them before we can decrypt).
- **recent files, images, sanitize, background**: recent files in IndexedDB 'quire-recent' (copies of the last 10 files under 40 MB, sample excluded), shown on the empty screen; exportImages (PNG/JPEG/WebP, dpi, range, greyscale, zip); sanitizeDialog (scan then remove metadata, scripts/actions, attachments, private data, comments, links, fields, bookmarks, layers); bgDialog adds a colour under the content, or multiplied over scans, marked with %QuireBG so Remove finds it.
- Tests: scratchpad t13 to t17 (forms, merge/detect, read/stats/compare, encryption checked with pypdf, misc).

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

## OCR languages (done, 3 Nov 2026)

Code: the "OCR languages" block just above `TASKS`, plus `TASKS.ocr`.

- **Engine:** Tesseract.js 5.1.1 with the 4.0.0 `best_int` models from the `@tesseract.js-data/<code>@1.0.0` npm packages. `OCR_CAT` lists all 119 languages (about 210 MB in total, most 1 to 3 MB). Japanese, both Chinese and Korean also have a `_vert` model, which is downloaded with them.
- **Built in (desktop):** the priority list plus Polish, about 36 MB (`OCR_LANGS` in both `scripts/vendor.js`).
- **Language manager** (OCR → More languages, or the command "OCR languages"): search, download, remove, Download all, Import files (`.traineddata` or `.traineddata.gz`, including your own models). Downloads come from jsDelivr, with unpkg as a fallback, and are stored in IndexedDB `keyval-store`/`keyval` under `quire-ocr/<code>.traineddata`. That's where Tesseract.js looks first (`cachePath: 'quire-ocr'`), so they work offline. The Electron `main.js` lets through only GET requests that match `OCR_DOWNLOAD`.
- **Text layer:** an invisible glyphless Type0 font (Identity-H, ToUnicode identity, the same idea as Tesseract's own PDF output), so any script survives. The old Helvetica layer dropped everything outside WinAnsi, including Polish ł. Right-to-left words are written in visual order (`ocrVisual`) so readers give them back in reading order. Vertical CJK is written rotated, top to bottom. CJK characters on one line are joined (`ocrWords`) so that a search for 東京 finds the text. PSM is 3 (auto layout) because Tesseract.js defaults to 6, which breaks vertical text and columns.
- **Tested** in Chromium with pdf.js and pdftotext: Hebrew, Arabic, Persian, Polish, Ukrainian (downloaded), and Japanese across and down all come back as the right text, and search finds Hebrew and vertical Japanese words.
- **Aramaic:** Tesseract has no model for it. Syriac (`syr`) covers Syriac script, and Hebrew reads square-script Aramaic with more mistakes. A community model can be added with Import files.

## Index tab: Acrobat-style indexing for Acrobat, Calibre and Estante (done, 4 Nov 2026)

Code: the "index & library" block just above "signature". New ribbon tab **Index** (`RIB.index`).

- **Bookmarks** (`TASKS.bookmarks`): Acrobat-style tree. Add (titled from the largest line on the page), rename (bold/italic), point at the current page, move, indent/outdent, delete, expand/collapse. Edits stay in memory until **Save bookmarks** (`bmWrite` replaces the outline and deletes the old outline objects). **Generate** from headings (`bmFromHeadings`: lines ≥ N% larger than the body size, running heads dropped, multi-line titles merged, up to 4 levels), from the book's contents page (`bmFindTocPages` + `bmFromToc`: finds "Contents/Índice/Sumário…", reads "Title …… 41", works out the printed→file page offset by finding the titles in the body, uses page labels when present, levels from 1.2.3 numbering or indent), every N pages, or each page's first line.
- **Page labels** (`TASKS.labels`, `plRead`/`plWrite`): ranges with style (1, i, I, a, A, none), prefix and start; one-click "roman front matter, 1 from this page".
- **Library info** (`TASKS.library`) with four profiles (`S.lib.profile`; `libCal(p)` is true for calibre and estante):
  - *Drive*: Acrobat-style metadata, plus a check that every page has searchable text (Run OCR button when not) and the "Title - Author" file name, because Google Drive search reads only the file name and the text layer.
  - *Acrobat*: Info dictionary + XMP (dc, pdf, xmp, xmpMM, xmp:Identifier, prism:isbn), /Lang, initial view (PageMode, PageLayout, OpenAction page and zoom, DisplayDocTitle).
  - *Calibre*: adds calibre's XMP namespace (calibre:series + calibreSI:series_index, title_sort, author_sort, rating ×2, timestamp), authors joined with " & ", Keywords comma-separated, optional "Title - Author.pdf" file name, and a calibre .opf download.
  - *Estante*: Calibre + tag chips from Estante's smart shelves (`GET /api/shelf`) + **Send to Estante** (`sendToEstante`: probes `/api/info`, `POST /api/upload` with X-Filename and, when `upload-meta` is advertised, X-Title/Authors/Tags/Comments/Identifier). Address and API key in pref `estante`. Estante's CORS allow-list must include Quire's origin; the message says so. The desktop wrappers now let `http://localhost|127.0.0.1/api/` through.
  - Checks list (title, author, ISBN check digit, language, series, bookmarks, page labels, cover = page 1) and **Find in book** for ISBNs (first 15 and last 6 pages, checksum-validated, normalised to 13 digits).
- **Index** (`TASKS.bookindex`):
  - Embedded full-text index like Acrobat's: `quire-search-index.json` attachment, words accent- and case-folded (`ixFold`), hyphenated line breaks joined (`ixPageString`), page lists stored as ranges, a fingerprint so a stale index is flagged, pages with no text listed with a Run OCR button.
  - Index search: word*, "phrase", -exclude.
  - Back-of-book index: terms (`Term = variant; variant`, `Main > sub`), Suggest terms (capitalised names/phrases on 2+ pages and ≤40% of pages), preview, then index pages appended in two columns with letter headings, page ranges, page-label numbers, linked numbers, an "Index" bookmark and an "Index N" page label range. Sub-terms count only on pages that also mention the main term.
- Tested in Chromium on a generated 11-page book: TOC → 4 nested bookmarks with offset 3, labels i–iii then 1–8, XMP read back by pdf.js and by `lxReadXmp`, index search, index pages with 4 link annotations. Not tested against a real Calibre import or a running Estante.

### Contents page (done, 4 Nov 2026)

Index → **Contents** (`TASKS.toc`, block "contents pages" after the book index code).

- **Link existing**: finds the printed contents page (or takes page numbers), lists every line on it, matches "Title …… 41" lines to file pages (page labels first, else the offset learned by finding entry titles in the body; "Re-match pages" uses a typed offset), and lets the user tick lines and correct any target page by hand. **Add links** puts a Link annotation over each ticked line (optional thin blue box) and can replace the bookmarks with the entries. Pages with no text get a Run OCR button. Links are named `quire-toc-…`, so re-applying or **Remove Quire's links** replaces only Quire's.
- **Build new**: entries from the bookmarks, headings, the detected contents page, or blank; edit titles and pages, add, reorder, indent/outdent, delete. **Insert contents page** (`tocInsert`) sets title, entries, wrapped long titles, dot leaders and right-aligned numbers, links every line, inserts the pages before a chosen page, shifts page numbers or keeps printed labels (adds a "Contents" label range and continues the old numbering after it) and can add a bookmark.
- Tested in Chromium on the generated book (text, not OCR): 4 entries matched with offset 3, links pointed at pages 4/5/7/9, a 5-entry contents page inserted before page 4 with shifted numbers and 6 links. Not yet tried on a real OCR'd scan.

## Edit tab: editing existing content (done, 4 Nov 2026)

Code: the "edit content" block just above `signature`. Hooks elsewhere are one line each: `onDown`/`onMove`/`onUp`, `drawOverlay` (`edDraw`), `renderPage` (redraw when the Edit tools or OCR layer are on), `closeTextEditor` (`edFinish`), `renderPanel` (`edPanel`), `setTool` (`redrawAll`), the keydown handler (`edKey`), `renderRibbon` (`edRibbon`) and `buildOutput` (waits for `ED.pending`). Top-level names use `ce*`, `ed*`, `CE`, `CEM`, `ED`, `EDF`.

- **Engine:** `ceParse` tokenises the page's content stream; `ceModel` interprets it (graphics and text state, colour, fonts) into text runs (one per Tj/TJ/'/"), images, inline images, form objects and painted paths. `ceFont` reads widths (Widths/W/standard 14), ToUnicode, Encoding/Differences and the subset tag. Fonts without ToUnicode take Unicode from pdf.js's operator list (matched by order of top-level text operators). Runs → lines (`ceLines`, faux bold de-duplicated) → paragraphs (`ceParas`: steady spacing, alignment and indent detection; a short line ending a sentence, or a change of font, starts a new paragraph).
- **Editing text** (`edOpen`, `edCommit`): a contenteditable box over the paragraph, with styled spans per font/size/colour, scaled so lines break where the PDF's will. On commit, each original operator becomes `[n] TJ` with the same advance (so later text never moves), and the new text is laid out with the PDF font's widths (`ceLayout`: wrap, left/centre/right/justify via TJ offsets) and appended. Font per letter: the paragraph's own font if the file has that glyph, then a bold/italic sibling font on the page, then the same family installed on the computer (`queryLocalFonts` + fontkit), then standard 14, then any installed font of the same kind that has it, then `?`.
- **Moving text** re-emits the original operators under a shifted `cm` (`ceClone`), so the glyphs stay identical.
- **Objects:** images, forms, inline images and paths are moved, resized, rotated or flipped by wrapping their operators in `q M cm … Q` with M = C·D·C⁻¹ (`ceWrapObj`). Also Replace image, Save image (renders just that object) and Delete. Clip paths are never treated as objects.
- **OCR:** "OCR layer" draws the invisible text (Tr 3/7) in teal. Proofread (`TASKS.ocrfix`) shows each OCR line's picture above an editable field. Corrected words keep their boxes on the scan (`ceOcrLine`, horizontal scaling Tz), using the GlyphLess font for any script.
- **Desktop:** both `vendor.js` files bundle `@pdf-lib/fontkit` 1.1.1 (lazy-loaded, `FONTKIT_URL`). Electron already allows `local-fonts`, because non-media permissions pass.
- Tested in Chromium with LibreOffice, reportlab, pdf-lib and synthetic OCR PDFs, checked with pdftotext and pdffonts. Not handled: Type 3 and vertical (CJK -V) fonts can be moved or deleted but not retyped; text inside form XObjects moves as one object.
