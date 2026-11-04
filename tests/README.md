# Quire's automatic tests

They run on GitHub on every change (Actions tab → **Tests**) and drive the real app in headless Chromium.
Each result is checked with an independent tool, not with Quire itself:

| Group | What is checked | Checked with |
|---|---|---|
| signatures | two signatures on one file are valid; one changed byte is caught | the app's verifier |
| pdfa | a file whose fonts are only named becomes PDF/A-2b without pictures of pages | veraPDF |
| pdfua | Fix all on an untagged file gives a valid PDF/UA-1 file | veraPDF |
| ocr | share of words read on a skewed book scan, a faded page, ruled and unruled tables | poppler `pdftotext` |
| excel | every cell of the scanned tables | openpyxl |
| word | alignment, indents, header and footer, footnote marks, columns, scanned pages | python-docx |
| redaction | the word is gone from the text and from the file's bytes; the rest stays | poppler, raw bytes |
| editions | Quire Lite and Quire Pro build; Lite uses nothing only Pro defines, shows no Pro buttons, and every ribbon tab loads without errors in both | `tools/build-editions.js --check`, the app |

The test files are made by `fixtures/make.py` (seeded, so the same every time).

## Running them on your own computer

```
cd tests
npm install && npx playwright install chromium
pip install reportlab pillow numpy python-docx openpyxl     # and poppler-utils, fonts-liberation
python3 fixtures/make.py
mvn -f verapdf/pom.xml dependency:copy-dependencies -DoutputDirectory=lib
printf '#!/bin/sh\nexec java -cp "%s/verapdf/lib/*" org.verapdf.apps.GreenfieldCliWrapper "$@"\n' "$PWD" > verapdf/vera && chmod +x verapdf/vera
VERAPDF=$PWD/verapdf/vera node run.js          # or only some groups: node run.js word pdfua
```

`out/report.md` has the table; `out/` also keeps every file the tests wrote.
