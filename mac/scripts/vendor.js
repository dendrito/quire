// Copies every library, OCR file and font the app needs out of node_modules into app/vendor,
// then builds app/index.html from src/quire.html with all web addresses replaced by those local copies.
// Runs automatically after `npm install`, and before `npm start` / `npm run dist`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const appDir = path.join(root, 'app');
const vendor = path.join(appDir, 'vendor');

// OCR languages bundled with the app (about 36 MB). Every other language is downloaded from the app's language manager.
const OCR_LANGS = ['eng', 'por', 'ita', 'heb', 'ara', 'spa', 'jpn', 'jpn_vert', 'chi_sim', 'chi_sim_vert', 'chi_tra', 'chi_tra_vert', 'fra', 'deu', 'nld', 'cat', 'syr', 'fas', 'rus', 'kor', 'kor_vert', 'pol'];
// The interface uses the Mac's own system font; only the handwriting font for typed signatures is bundled.
const FONTS = [
  ['Caveat', 'caveat', [600]]
];

const copies = [
  ['pdfjs-dist/build/pdf.min.js', 'pdfjs/pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdfjs/pdf.worker.min.js'],
  ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/pdf-lib.min.js'],
  ['jszip/dist/jszip.min.js', 'jszip/jszip.min.js'],
  ['jsqr/dist/jsQR.js', 'jsqr/jsQR.js'],
  ['qrcode-generator/qrcode.js', 'qrcode/qrcode.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit/fontkit.umd.min.js'],
  ['node-forge/dist/forge.min.js', 'forge/forge.min.js'],
  ['tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ...['', '-lstm', '-simd', '-simd-lstm'].map(v => [`tesseract.js-core/tesseract-core${v}.wasm.js`, `tesseract-core/tesseract-core${v}.wasm.js`]),
  ...OCR_LANGS.map(l => [`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `tessdata/${l}.traineddata.gz`]),
  // fonts drawn to the widths of Helvetica/Arial, Times and Courier, put into PDFs that only name those fonts (PDF/A, PDF/UA)
  ...['Arimo', 'Tinos', 'Cousine'].flatMap(f => ['400Regular', '400Regular_Italic', '700Bold', '700Bold_Italic'].map(v => [`@expo-google-fonts/${f.toLowerCase()}/${v}/${f}_${v}.ttf`, `fonts-sub/${f}_${v}.ttf`])),
  // handwriting recognition: the ONNX runtime, and kraken's line finder plus the manuscript readers from models/htr
  ...['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(f => [`onnxruntime-web/dist/${f}`, `onnxruntime/${f}`]),
  ...['blla', 'traprinq', 'geneapt', 'mccatmus', 'catmus-medieval', 'tridis', 'frolat-expan', 'regfiii-damage', 'catmus-print', 'catmus-gothic', 'fraktur', 'lectaurep', 'hooker', 'sephardi', 'muharaf'].flatMap(m => ['.onnx', '.json'].map(x => [`../../models/htr/${m}${x}`, `htr/${m}${x}`]))
];
let fontCss = '';
for (const [family, pkg, weights] of FONTS) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    copies.push([`@fontsource/${pkg}/files/${file}`, `fonts/${file}`]);
    fontCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(${file}) format('woff2')}\n`;
  }
}

let missing = 0;
for (const [from, to] of copies) {
  const src = path.join(nm, from);
  const dst = path.join(vendor, to);
  if (!fs.existsSync(src)) { console.error('Missing: node_modules/' + from); missing++; continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
if (missing) { console.error(`\n${missing} file(s) missing. Run "npm install" first.`); process.exit(1); }
fs.writeFileSync(path.join(vendor, 'fonts', 'fonts.css'), fontCss);

// Build app/index.html
let html = fs.readFileSync(path.join(root, 'src', 'quire.html'), 'utf8');
// QUIRE_EDITION=lite or pro builds that edition (see tools/editions.json); unset keeps every feature, as before.
const EDITION = process.env.QUIRE_EDITION;
if (EDITION) {
  const lib = path.join(root, '..', 'tools', 'editions-lib.js');
  if (!fs.existsSync(lib)) { console.error('QUIRE_EDITION needs tools/editions-lib.js from the full Quire folder.'); process.exit(1); }
  html = require(lib).build(html, EDITION);
}
const swap = (from, to) => {
  if (!html.includes(from)) { console.error('Could not find in src/quire.html: ' + from); process.exit(1); }
  html = html.split(from).join(to);
};
swap('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'vendor/pdfjs/pdf.min.js');
swap('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'vendor/pdf-lib/pdf-lib.min.js');
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="vendor/fonts/fonts.css">');
if (/<script src="https?:|<link[^>]+href="https?:/.test(html)) { console.error('src/quire.html still loads something from the web.'); process.exit(1); }

const head = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
  + '<script>window.QUIRE_VENDOR = "vendor/"; window.QUIRE_OCR_LANGS = ' + JSON.stringify(OCR_LANGS) + ';</script>'
  + '</head><body>';
fs.writeFileSync(path.join(appDir, 'index.html'), head + html + '</body></html>');
console.log(`${EDITION ? 'Quire ' + EDITION[0].toUpperCase() + EDITION.slice(1) + ': ' : ''}Bundled ${copies.length} files into app/vendor and built app/index.html. The app runs fully offline.`);
