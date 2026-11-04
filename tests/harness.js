// Loads web/quire-pdf-studio.html in headless Chromium with every library it would fetch from a CDN served from
// tests/node_modules instead, so the tests run offline and always against the pinned versions.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), NM = path.join(__dirname, 'node_modules') + '/';
const APP = path.join(ROOT, 'web', 'quire-pdf-studio.html');
const { chromium } = require('playwright');

const CDN = [
  [/pdf\.js\/3\.11\.174\/pdf\.min\.js/, 'pdfjs-dist/build/pdf.min.js'],
  [/pdf\.js\/3\.11\.174\/pdf\.worker\.min\.js/, 'pdfjs-dist/build/pdf.worker.min.js'],
  [/pdf-lib\/1\.17\.1\/pdf-lib\.min\.js/, 'pdf-lib/dist/pdf-lib.min.js'],
  [/jszip\/3\.10\.1\/jszip\.min\.js/, 'jszip/dist/jszip.min.js'],
  [/node-forge@[\d.]+\/dist\/forge\.min\.js/, 'node-forge/dist/forge.min.js'],
  [/fontkit@1\.1\.1\/dist\/fontkit\.umd\.min\.js/, '@pdf-lib/fontkit/dist/fontkit.umd.min.js'],
];
const VENDOR = { 'pdfjs/': 'pdfjs-dist/build/', 'pdf-lib/': 'pdf-lib/dist/', 'jszip/': 'jszip/dist/', 'forge/': 'node-forge/dist/', 'fontkit/': '@pdf-lib/fontkit/dist/', 'tesseract/': 'tesseract.js/dist/', 'tesseract-core/': 'tesseract.js-core/' };
const type = f => /\.js$/.test(f) ? 'application/javascript' : /\.wasm$/.test(f) ? 'application/wasm' : /\.ttf$/.test(f) ? 'font/ttf' : 'application/octet-stream';

let browser = null;
exports.open = async () => {
  if (!browser) browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // OCR uses the app's offline layout (the same one the Mac and Windows apps use)
  await ctx.addInitScript(() => { window.QUIRE_VENDOR = 'https://quire.test/v/'; });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errs.push(m.text()); });
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u === 'https://quire.test/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><style>[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>' });
    for (const [re, f] of CDN) if (re.test(u)) return r.fulfill({ contentType: type(f), body: fs.readFileSync(NM + f) });
    if (u.startsWith('https://quire.test/v/')) {
      const rel = u.slice(21).split('?')[0]; let f = null;
      const m = rel.match(/^tessdata\/(\w+)\.traineddata\.gz$/); if (m) f = `@tesseract.js-data/${m[1]}/4.0.0_best_int/${m[1]}.traineddata.gz`;
      const s = rel.match(/^fonts-sub\/(\w+?)_(\w+)\.ttf$/); if (s) f = `@expo-google-fonts/${s[1].toLowerCase()}/${s[2]}/${s[1]}_${s[2]}.ttf`;
      if (!f) for (const [a, b] of Object.entries(VENDOR)) if (rel.startsWith(a)) f = b + rel.slice(a.length);
      if (f && fs.existsSync(NM + f)) return r.fulfill({ contentType: type(f), body: fs.readFileSync(NM + f) });
      return r.fulfill({ status: 404, body: '' });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await p.goto('https://quire.test/'); await p.waitForFunction(() => window.PDFLib && document.querySelector('#toolbar'));
  return p;
};
exports.close = async () => { if (browser) await browser.close(); browser = null; };
// open a PDF file in the app
exports.load = async (p, file) => { const b64 = fs.readFileSync(file).toString('base64'); await p.evaluate(async ([b, n]) => { await openBytes(Uint8Array.from(atob(b), c => c.charCodeAt(0)), n); }, [b64, path.basename(file)]); };
// bytes from the page (base64 over the bridge)
exports.bytes = async (p, fn, arg) => Buffer.from(await p.evaluate(async ([src, a]) => { const r = await (0, eval)(src)(a); const u = r instanceof Uint8Array ? r : new Uint8Array(r instanceof Blob ? await r.arrayBuffer() : r); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }, [fn.toString(), arg]), 'base64');
