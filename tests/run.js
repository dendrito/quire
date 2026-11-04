// Quire's automatic tests. Each one drives the real app in headless Chromium and checks the result with independent
// tools: veraPDF for PDF/A and PDF/UA, poppler's pdftotext for OCR and redaction, python-docx and openpyxl for Word
// and Excel. Run from this folder:  node run.js [name ...]     (names: signatures pdfa pdfua ocr excel word pptx protect compare bigfile bigfile_edit redaction htr htr_inquisition editions memory)
// Needs: npm install, python3 fixtures/make.py, pip install python-docx openpyxl, poppler-utils, and veraPDF on
// VERAPDF (a command) for the PDF/A and PDF/UA tests.
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const H = require('./harness.js');
const FX = path.join(__dirname, 'fixtures'), OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const fx = n => path.join(FX, n), out = n => path.join(OUT, n);
const VERA = process.env.VERAPDF || 'verapdf';

const norm = s => s.normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean);
const lcs = (truth, got) => { const a = norm(truth), b = norm(got), dp = Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; } } return dp[b.length] / a.length * 100; };
const pdftotext = f => execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', f, '-']).toString();
const inspect = f => JSON.parse(execFileSync('python3', ['-W', 'ignore', path.join(__dirname, 'office_facts.py'), f]).toString());
const vera = (f, flavour) => { let x = ''; try { x = execFileSync(VERA, ['--flavour', flavour, '--format', 'xml', f], { maxBuffer: 1 << 26 }).toString(); } catch (e) { x = String(e.stdout || ''); }
  const failed = [...x.matchAll(/<rule [^>]*clause="([^"]+)" testNumber="(\d+)" status="failed"/g)].map(m => m[1] + '-' + m[2]);
  return { ok: /isCompliant="true"/.test(x), failed, ran: /isCompliant=/.test(x) }; };
const b64 = async (p, fn, arg) => H.bytes(p, fn, arg);

const results = []; let current = null;
const check = (what, ok, detail = '') => { current.checks.push({ what, ok: !!ok, detail: String(detail) }); };
const TESTS = {};

// --- digital signatures: two signatures on one file, both valid; one changed byte breaks them
TESTS.signatures = async () => {
  const p = await H.open();
  const r = await p.evaluate(async () => {
    const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) pdf.addPage([595, 842]).drawText('Contract page ' + (i + 1), { x: 72, y: 760, size: 18, font: f });
    const d = await openBytes(await pdf.save(), 'contract.pdf');
    const n = await sigNewId({ name: 'Test Signer', email: 'signer@example.org', org: 'Quire tests', pw: 'pass1234' }); const id = await sigOpenId(n.der, 'pass1234');
    const s1 = await sigSign(d, id, { kind: 'corner', page: 0, rect: sigCorner(d, 0, 'bottom-right') }, { reason: 'I approve', location: 'Lisboa' });
    const d2 = await openBytes(s1, 'contract-s1.pdf'); const s2 = await sigSign(d2, id, { kind: 'corner', page: 1, rect: sigCorner(d2, 1, 'top-left') }, { reason: 'Second' });
    const l = await sigList(s2); const bad = s2.slice(); bad[12] ^= 1; const lb = await sigList(bad);
    return { n: l.length, ok: l.map(s => !!(s.ok && s.intact)), cn: l.map(s => s.cert && s.cert.subject.cn), tampered: lb.map(s => !!s.intact) };
  });
  check('two signatures found', r.n === 2, r.n);
  check('both signatures valid and intact', r.ok.length === 2 && r.ok.every(Boolean), JSON.stringify(r.ok));
  check('signer name read back', r.cn.every(c => c === 'Test Signer'), JSON.stringify(r.cn));
  check('a changed byte is detected', r.tampered.length && r.tampered.every(x => !x), JSON.stringify(r.tampered));

  // A certificate as a commercial CA issues it (root -> intermediate -> signer, in a .p12 with its chain) and an RFC 3161
  // timestamp, both checked by pyHanko, an independent validator: chain to a trusted root, integrity, timestamp, and
  // that the second signature's incremental update did not change what the first one signed.
  const pki = out('pki'); execFileSync('python3', [path.join(__dirname, 'fixtures', 'pki.py'), 'make', pki]);
  H.tsa = req => execFileSync('python3', [path.join(__dirname, 'fixtures', 'pki.py'), 'tsa', pki], { input: req });
  const file = out('signed-ca.pdf');
  fs.writeFileSync(file, await b64(p, async p12 => {
    const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) pdf.addPage([595, 842]).drawText('Contract page ' + (i + 1), { x: 72, y: 760, size: 18, font: f });
    const d = await openBytes(await pdf.save(), 'contract-ca.pdf'); const id = await sigOpenId(u64(p12), 'pass1234');
    const s1 = await sigSign(d, id, { kind: 'corner', page: 0, rect: sigCorner(d, 0, 'bottom-right') }, { reason: 'I approve', tsa: 'https://tsa.quire.test/' });
    const d2 = await openBytes(s1, 'contract-ca-1.pdf'); return sigSign(d2, id, { kind: 'corner', page: 1, rect: sigCorner(d2, 1, 'top-left') }, { reason: 'Second' });
  }, fs.readFileSync(path.join(pki, 'signer.p12')).toString('base64')));
  const own = await p.evaluate(async b => (await sigList(u64(b))).map(s => ({ ok: s.ok, ts: s.timestamp ? s.timestamp.ok : null, tsa: s.timestamp && s.timestamp.tsa })), fs.readFileSync(file).toString('base64'));
  check('Quire reads its own timestamp back as valid', own[0].ts === true && own[1].ts === null && own.every(s => s.ok), JSON.stringify(own));
  const V = JSON.parse(execFileSync('python3', [path.join(__dirname, 'fixtures', 'pki.py'), 'validate', pki, file]).toString());
  check('pyHanko: both signatures intact, valid and trusted through the CA chain', V.length === 2 && V.every(v => v.intact && v.valid && v.trusted), JSON.stringify(V.map(v => v.bottom_line)));
  check('pyHanko: chain is signer -> intermediate -> root', V[0].chain.join(' > ') === 'Quire Test Root CA > Quire Test Signing CA > Maria Teste', V[0].chain.join(' > '));
  check('pyHanko: first signature carries a valid, trusted timestamp', V[0].timestamp && V[0].timestamp.intact && V[0].timestamp.valid && V[0].timestamp.trusted, JSON.stringify(V[0].timestamp));
  // On GitHub (REAL_TSA set by the workflow) the same is done with DigiCert's public timestamp server, the default in the app
  if (process.env.REAL_TSA) {
    H.tsa = req => execFileSync('curl', ['-s', '-m', '30', '-H', 'Content-Type: application/timestamp-query', '--data-binary', '@-', process.env.REAL_TSA], { input: req });
    const f2 = out('signed-digicert.pdf');
    fs.writeFileSync(f2, await b64(p, async p12 => { const pdf = await PDFDocument.create(); pdf.addPage([595, 842]); const d = await openBytes(await pdf.save(), 'ts.pdf');
      return sigSign(d, await sigOpenId(u64(p12), 'pass1234'), { kind: 'corner', page: 0, rect: sigCorner(d, 0, 'bottom-right') }, { tsa: 'https://tsa.quire.test/' }); }, fs.readFileSync(path.join(pki, 'signer.p12')).toString('base64')));
    const T = JSON.parse(execFileSync('python3', [path.join(__dirname, 'fixtures', 'pki.py'), 'validate', pki, f2]).toString())[0];
    check(`pyHanko: timestamp from ${process.env.REAL_TSA} intact and valid`, T.timestamp && T.timestamp.intact && T.timestamp.valid, JSON.stringify(T.timestamp));
  }
  check('pyHanko: the second signature only added to the file (first one still covers its revision, no forbidden changes)', V[0].coverage === 'ENTIRE_REVISION' && V[1].coverage === 'ENTIRE_FILE' && /FORM_FILLING|ANNOTATIONS|LTA_UPDATES|NONE/.test(V[0].modification_level), `${V[0].coverage}, ${V[0].modification_level}`);
};

// --- PDF/A-2b: a file whose fonts are only named; fonts are embedded, nothing is turned into a picture
TESTS.pdfa = async () => {
  for (const f of ['report.pdf', 'columns.pdf']) {
    const p = await H.open(); await H.load(p, fx(f));
    const r = await p.evaluate(async () => { const x = await pdfaConvert(cur()); window.__pa = x.bytes; return x.rep; });
    const file = out('pdfa-' + f); fs.writeFileSync(file, await b64(p, () => window.__pa));
    check(`${f}: no page turned into a picture`, !r.raster.length, JSON.stringify(r.raster));
    check(`${f}: missing fonts embedded`, r.fixed.some(x => /Font embedded/.test(x)), r.fixed.join('; '));
    const v = vera(file, '2b'); check(`${f}: veraPDF PDF/A-2b`, v.ok, v.ran ? v.failed.join(' ') || 'pass' : 'veraPDF did not run');
    check(`${f}: text unchanged`, lcs(pdftotext(fx(f)), pdftotext(file)) > 99.5);
  }
};

// --- PDF/UA-1: Fix all on an untagged file with unembedded fonts, then the PDF/UA mark
// a file that names Georgia (not embedded) with its own, wider widths: the fix must embed a font and keep the spacing
const georgia = async () => { const p = await H.open(); const file = out('georgia.pdf');
  fs.writeFileSync(file, await b64(p, async () => { const L = PDFLib, N = n => L.PDFName.of(n);
    const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.TimesRoman); const pg = pdf.addPage([595, 842]);
    pg.drawText('Georgia text with its own spacing: The quick brown fox.', { x: 50, y: 780, size: 14, font: f }); await pdf.save();
    const fd = pdf.context.lookup(f.ref); fd.set(N('BaseFont'), N('Georgia'));
    const enc = L.StandardFontEmbedder.for('Times-Roman'); const W = []; for (let c = 32; c <= 255; c++) { let w = 500; try { const e = ceEnc().win.get(c); if (e) w = Math.round(enc.font.getWidthOfGlyph(e.name) * 1.12); } catch {} W.push(w || 500); }
    fd.set(N('FirstChar'), L.PDFNumber.of(32)); fd.set(N('LastChar'), L.PDFNumber.of(255)); fd.set(N('Widths'), pdf.context.obj(W)); return pdf.save(); }));
  return file; };
TESTS.pdfua = async () => {
  for (const f of ['report.pdf', 'columns.pdf', 'georgia.pdf']) {
    const src = f === 'georgia.pdf' ? await georgia() : fx(f);
    const p = await H.open(); await H.load(p, src);
    const log = await p.evaluate(async () => { const fixable = ['title', 'lang', 'tags', 'tabs', 'links', 'fields', 'fonts', 'uaid']; const log = [];
      let R = await a11yScan(cur());
      for (let k = 0; k < 3; k++) { const ids = R.checks.filter(c => c.state === 'fail' && fixable.includes(c.fix)).map(c => c.fix); if (!ids.length) break; log.push((await a11yFix(cur(), ids, { title: 'Test document', lang: 'en' })).join(', ')); R = await a11yScan(cur()); }
      log.push(R.checks.filter(c => c.state === 'fail').map(c => c.id).join(',') || 'no failures'); return log; });
    const file = out('pdfua-' + f); fs.writeFileSync(file, await b64(p, async () => buildOutput(cur())));
    check(`${f}: Quire's own check passes after Fix`, log[log.length - 1] === 'no failures', log.join(' | '));
    const v = vera(file, 'ua1'); check(`${f}: veraPDF PDF/UA-1`, v.ok, v.ran ? v.failed.join(' ') || 'pass' : 'veraPDF did not run');
  }
};

// --- OCR accuracy on hard scans (share of words read, in order)
const ocr = async (f, lang = 'por', more = {}) => {
  const p = await H.open(); await H.load(p, fx(f));
  if (more.haveBest) { await p.evaluate(async l => { await ocrBestReady([l], () => {}); }, lang); delete more.haveBest; }
  await p.evaluate(([l, m]) => { pref.set('ocr', { lang: l, also: '', dir: 'h', skip: true, ...m }); S.ocr = null; openTask('ocr'); }, [lang, more]);
  await p.waitForSelector('#oGo'); const n0 = await p.evaluate(() => cur().bytes.length); const t0 = Date.now();
  await p.click('#oGo');
  await p.waitForFunction(n => cur().bytes.length !== n || (document.querySelector('#oMsg') && /fail|could not|No text/i.test(document.querySelector('#oMsg').textContent)), n0, { timeout: 600000, polling: 500 });
  const file = out('ocr-' + f.replace(/\//g, '-')); fs.writeFileSync(file, await b64(p, async () => buildOutput(cur())));
  return { file, secs: (Date.now() - t0) / 1000, p };
};
// real/herculano-faded.pdf (a page of Herculano's history of the Inquisition, faded) reads 95.6%.
// faded.pdf reads 60.6% here and about 50% on GitHub's runner (Pillow and numpy draw the page slightly differently); before the faded-page work it was 30%
const OCR_MIN = { 'book.pdf': 95, 'faded.pdf': 45, 'table-ruled.pdf': 95, 'table-free.pdf': 95, 'real/herculano-faded.pdf': 93 };
TESTS.ocr = async () => {
  for (const [f, min] of Object.entries(OCR_MIN)) {
    const { file, secs } = await ocr(f); const acc = lcs(fs.readFileSync(fx(f.replace(/pdf$/, 'txt')), 'utf8'), pdftotext(file));
    check(`${f}: at least ${min}% of words read`, acc >= min, `${acc.toFixed(1)}% in ${secs.toFixed(0)} s`);
  }
  // the most accurate (full-precision) models on the faded page: 63.5% here against 60.6% with the everyday ones
  const { file, secs } = await ocr('faded.pdf', 'por', { best: true }); const acc = lcs(fs.readFileSync(fx('faded.txt'), 'utf8'), pdftotext(file));
  check(`faded.pdf with the most accurate models: at least ${OCR_MIN['faded.pdf'] + 2}% of words read`, acc >= OCR_MIN['faded.pdf'] + 2, `${acc.toFixed(1)}% in ${secs.toFixed(0)} s`);
  // with the most accurate models already on the device, an everyday run reads faded pages again with them by itself,
  // and leaves clear pages alone
  for (const [f, want] of [['faded.pdf', true], ['real/herculano-faded.pdf', false]]) {
    const r = await ocr(f, 'por', { haveBest: true }); const last = await r.p.evaluate(() => OCR.last); const a = lcs(fs.readFileSync(fx(f.replace(/pdf$/, 'txt')), 'utf8'), pdftotext(r.file));
    check(`${f}: ${want ? 'faded, so read again with the most accurate models' : 'clear, so the everyday models are kept'}`, last[0].best === want && a >= OCR_MIN[f] + (want ? 2 : 0), `confidence ${last[0].conf}, ${a.toFixed(1)}% in ${r.secs.toFixed(0)} s`);
    await r.p.context().close();
  }
};

// --- Excel from a scanned table
TESTS.excel = async () => {
  for (const f of ['table-ruled.pdf', 'table-free.pdf']) {
    const src = fs.existsSync(out('ocr-' + f)) ? out('ocr-' + f) : (await ocr(f)).file;
    const p = await H.open(); await H.load(p, src);
    const file = out(f.replace(/pdf$/, 'xlsx')); fs.writeFileSync(file, await b64(p, async () => (await cvXlsx(cur(), { pages: [0] }, () => {})).blob));
    const truth = JSON.parse(fs.readFileSync(fx(f.replace(/pdf$/, 'json')), 'utf8')), got = inspect(file).rows.filter(r => r.some(c => c.trim()));
    let right = 0; truth.forEach((row, i) => row.forEach((c, j) => { if (got[i] && (got[i][j] || '').replace(/\s+/g, ' ').trim() === c) right++; }));
    const all = truth.flat().length; check(`${f}: cells right`, right >= all - 2, `${right} of ${all}`);
  }
};

// --- Word: layout kept (alignment, indents, header/footer, footnote marks, columns), and a scanned page stays whole
const docx = async (src, name, extra = {}) => { const p = await H.open(); await H.load(p, src); const file = out(name);
  fs.writeFileSync(file, await b64(p, async extra => { const d = cur(); return (await cvDocx(d, { headings: true, tables: true, images: true, dropRunning: true, pageBreaks: false, pages: [...d.info.keys()], ...extra }, () => {})).blob; }, extra)); return inspect(file); };
// Where every word sits on the page (pdftotext -bbox), for checking that a layout was kept
const wordBoxes = f => [...execFileSync('pdftotext', ['-bbox', f, '-']).toString().matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g)].map(m => ({ x: +m[1], y: +m[2], w: m[3] }));
const placement = (orig, made) => { const A = wordBoxes(orig), B = wordBoxes(made); const by = new Map(); for (const b of B) (by.get(b.w) || by.set(b.w, []).get(b.w)).push(b);
  const d = A.map(a => Math.min(...(by.get(a.w) || [{ x: 1e4, y: 1e4 }]).map(b => Math.hypot(a.x - b.x, a.y - b.y)))).sort((p, q) => p - q);
  return { words: A.length, found: d.filter(v => v < 1e3).length, median: d[d.length >> 1], p90: d[Math.floor(d.length * .9)] }; };
TESTS.word = async () => {
  const r = await docx(fx('report.pdf'), 'report.docx');
  check('report: justified paragraphs', r.justified >= 10, r.justified);
  check('report: centred headings', r.centered >= 3 && r.headings >= 3, `${r.centered} centred, ${r.headings} headings`);
  check('report: right-aligned date', r.right >= 1, r.right);
  check('report: first-line indents', r.firstLineIndent >= 10, r.firstLineIndent);
  check('report: indented quotation (right indent)', r.rightIndent >= 3, r.rightIndent);
  check('report: footnote mark as superscript', r.superscript >= 3, r.superscript);
  check('report: running head became the Word header', /Annual Report of the Library Society/.test(r.header), r.header);
  check('report: page number became a PAGE field', r.footerPageField);
  check('report: page margins from the page (about 90 pt)', Math.abs(r.leftMargin - 90) < 12, r.leftMargin);
  check('report: all text there', lcs(pdftotext(fx('report.pdf')).replace(/Annual Report of the Library Society|^\d+$/gm, ''), r.text) > 98);
  // Exact copy of a magazine page: every word within a few points of where it was, drawings kept behind the text
  for (const [name, exact] of [['magazine-flow.docx', false], ['magazine.docx', true]]) {
    const m = await docx(fx('magazine.pdf'), name, { exact, tables: !exact });
    let pl = null; try { execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', OUT, out(name)], { timeout: 120000, stdio: 'ignore' }); pl = placement(fx('magazine.pdf'), out(name.replace(/docx$/, 'pdf'))); } catch (e) { pl = { error: String(e).slice(0, 80) }; }
    if (!exact) { console.log(`  · flowing layout for comparison: words ${JSON.stringify(pl)}`); continue; }
    { const want = pdftotext(fx('magazine.pdf')).split(/\s+/).filter(Boolean), have = new Set(m.text.split(/\s+/)); const got = want.filter(w => have.has(w)).length / want.length * 100; check('magazine (exact copy): all the words there', got > 99, got.toFixed(1) + '%'); }
    check('magazine (exact copy): words where they were on the page (median under 4 pt, 90% under 12 pt)', pl.median < 4 && pl.p90 < 12, JSON.stringify(pl));
    check('magazine (exact copy): one page, banner and picture kept behind the text', fs.existsSync(out('magazine.pdf')) && execFileSync('pdfinfo', [out('magazine.pdf')]).toString().match(/Pages:\s+(\d+)/)[1] === '1' && execFileSync('pdfimages', ['-list', out('magazine.pdf')]).toString().split('\n').length > 3);
  }
  const c = await docx(fx('columns.pdf'), 'columns.docx');
  check('columns: two-column section', c.columns === 2, c.columns);
  const src = fs.existsSync(out('ocr-book.pdf')) ? out('ocr-book.pdf') : (await ocr('book.pdf')).file;
  const b = await docx(src, 'book.docx');
  check('scanned page: lines joined into paragraphs', b.paragraphs <= 4, b.paragraphs);
  check('scanned page: a real font, not the invisible OCR font', !b.fonts.some(f => /glyphless|courier/i.test(f)), b.fonts.join(', '));
};

// --- redaction: the words are gone from the file, the rest stays
TESTS.redaction = async () => {
  const p = await H.open();
  await p.evaluate(async () => {
    const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.Helvetica); const pg = pdf.addPage([595, 842]);
    pg.drawText('Name: SECRETNAME Silva, lives in Lisboa.', { x: 50, y: 780, size: 12, font: f }); pg.drawText('Keep this line intact please.', { x: 50, y: 760, size: 12, font: f });
    const d = await openBytes(await pdf.save(), 'rx.pdf'); const w0 = f.widthOfTextAtSize('Name: ', 12), w1 = f.widthOfTextAtSize('SECRETNAME', 12);
    d.annots[0].push({ type: 'redact', x1: 50 + w0, y1: 776, x2: 50 + w0 + w1, y2: 792 });
  });
  const file = out('redacted.pdf'); fs.writeFileSync(file, await b64(p, async () => buildOutput(cur())));
  const t = pdftotext(file), raw = fs.readFileSync(file).toString('latin1');
  check('redacted word gone from the text', !/SECRETNAME/.test(t), t.trim().split('\n')[0]);
  check('redacted word gone from the file bytes', !/SECRETNAME/.test(raw));
  check('words around it kept', /Name:/.test(t) && /Silva/.test(t) && /Keep this line intact please/.test(t));
};

// --- Password on save (AES-256) checked with poppler; Compare finds a line added in a second version
TESTS.protect = async () => {
  const p = await H.open(); await H.load(p, fx('report.pdf')); const file = out('protected.pdf');
  fs.writeFileSync(file, await b64(p, async () => encryptPdf(await buildOutput(cur()), 'abc123', '', { print: true, modify: false, copy: true, annot: true, fill: true, assemble: false, printHigh: true })));
  const info = execFileSync('pdfinfo', ['-upw', 'abc123', file]).toString();
  check('AES-256 encryption, as Acrobat writes it', /AES-256/.test(info), (info.match(/Encrypted:.*/) || [''])[0]);
  check('opens with the password', /Library Society/.test(execFileSync('pdftotext', ['-upw', 'abc123', file, '-']).toString()));
  let refused = false; try { execFileSync('pdftotext', [file, '-'], { stdio: 'ignore' }); } catch { refused = true; } check('refused without it', refused);
};
// --- Large files are given to the viewer in pieces: forced on for a small file, it must open, read and render the same
TESTS.bigfile = async () => {
  const p = await H.open(); await H.load(p, fx('report.pdf'));
  const r = await p.evaluate(async () => { const a = cur(); window.QUIRE_BIG_FILE = 1; const d = await openBytes(a.bytes.slice(), 'big.pdf'); window.QUIRE_BIG_FILE = 0;
    const t = await (await d.info[d.info.length - 1].page.getTextContent()).items.map(x => x.str).join(' ');
    const c = document.createElement('canvas'); const vp = d.info[0].page.getViewport({ scale: 1 }); c.width = vp.width; c.height = vp.height; await d.info[0].page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return { pages: d.info.length, want: a.info.length, text: /committee/.test(t), out: (await buildOutput(d)).length === a.bytes.length }; });
  check('opens in pieces with every page, its text and drawing', r.pages === r.want && r.text && r.out, JSON.stringify(r));
};
// --- Page edits on a big file are appended (incremental update): the old bytes stay as they are, poppler and qpdf
// read the result, and undo goes back to the earlier revision without a copy. Classic xref table and xref stream.
TESTS.bigfile_edit = async () => {
  const p = await H.open(); await H.load(p, fx('report.pdf'));
  for (const kind of ['table', 'stream']) {
    const r = await p.evaluate(async kind => {
      const a = S.docs.find(x => /report/.test(x.name)); const src = kind === 'table' ? a.bytes.slice() : await (await PDFDocument.load(a.bytes)).save({ useObjectStreams: true });
      window.QUIRE_BIG_FILE = 1; window.__dbg = src; const d = await openBytes(src, kind + '.pdf'); activate(S.docs.indexOf(d));
      const n0 = d.info.length; const warn = console.warn; let lazy = true; console.warn = (...a) => { if (/full parse/.test(a[0])) lazy = false; warn(...a); }; d.sel = new Set([0]); await rotatePages(90); console.warn = warn; d.sel = new Set([1]); await duplicatePages(); await movePage(0, 3);
      const after = d.bytes; const same = after.length > src.length && src.every((v, i) => after[i] === v);
      const pages = d.info.length; let undone = true; for (let k = 0; k < 3; k++) { await undo(); undone = undone && d.bytes.buffer === after.buffer; } undone = undone && d.info.length === n0 && d.bytes.length === src.length;
      window.QUIRE_BIG_FILE = 0; return { lazy, same, pages, n0, undone, grew: after.length - src.length, b64: btoa(Array.from(after, c => String.fromCharCode(c)).join('')) };
    }, kind);
    const file = out(`incremental-${kind}.pdf`); fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
    let q = ''; try { q = execFileSync('python3', ['-c', 'import sys;from pyhanko.pdf_utils.reader import PdfFileReader as R;r=R(open(sys.argv[1],"rb"),strict=True);print("ok",len(r.root["/Pages"]["/Kids"]),r.xrefs.total_revisions)', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { q = String(e.stderr || e).slice(-300); }
    const perr = spawnSync('pdfinfo', [file]).stderr.toString();
    const info = execFileSync('pdfinfo', ['-f', '1', '-l', '9', file]).toString(); const rots = [...info.matchAll(/Page\s+(\d+) rot:\s+(\d+)/g)].map(m => +m[2]);
    check(`${kind}: earlier bytes untouched, ${r.grew} bytes appended`, r.same && r.grew < 20000, String(r.grew));
    check(`${kind}: pyHanko (strict) and poppler read it with no errors`, /^ok/.test(q) && !perr.trim(), q.trim() + ' ' + perr.slice(0, 200));
    check(`${kind}: one page more, rotated page moved to third place`, r.pages === r.n0 + 1 && rots[2] === 90 && rots.filter(x => x).length === 1, `${r.pages} pages, rot ${rots}`);
    check(`${kind}: rotation read only the page objects (no full parse)`, r.lazy);
    check(`${kind}: text still there`, /committee/.test(execFileSync('pdftotext', [file, '-']).toString()));
    check(`${kind}: undo shares the same memory`, r.undone);
  }
};
TESTS.compare = async () => {
  const p = await H.open(); await H.load(p, fx('report.pdf'));
  const r = await p.evaluate(async () => { const a = cur(); const b = await PDFDocument.load(a.bytes); b.getPage(0).drawText('Extra line added in v2', { x: 90, y: 60, size: 11 }); const d2 = await openBytes(await b.save(), 'v2.pdf'); CMP.src = a.bytes; CMP.name = 'report.pdf'; CMP.mode = 'text'; const R = await runCompare(d2); return { changes: R.H.length, added: R.added, removed: R.removed }; });
  check('finds the one added line and nothing else', r.changes === 1 && r.added === 5 && r.removed === 0, JSON.stringify(r));
  // Word with tracked changes, both ways round: the added line is a tracked insertion, then (swapped) a tracked deletion
  for (const [name, swap] of [['tracked-ins.docx', false], ['tracked-del.docx', true]]) {
    const file = out(name);
    fs.writeFileSync(file, await b64(p, async swap => { const a = S.docs.find(x => /report/.test(x.name)); const b = await PDFDocument.load(a.bytes); b.getPage(0).drawText('Extra line added in v2', { x: 90, y: 60, size: 11 }); const v2 = await b.save();
      const d2 = await openBytes(swap ? a.bytes : v2, 'new.pdf'); CMP.src = swap ? v2 : a.bytes; CMP.name = 'old.pdf'; CMP.mode = 'text'; const R = await runCompare(d2); return cmpDocx(d2, R); }, swap));
    const X = JSON.parse(execFileSync('python3', [path.join(__dirname, 'office_facts.py'), 'tracked', file]).toString());
    check(`${name}: change tracked as ${swap ? 'a deletion' : 'an insertion'}`, swap ? X.del === 'Extra line added in v2' && !X.ins : X.ins === 'Extra line added in v2' && !X.del, JSON.stringify(X).slice(0, 200));
    check(`${name}: rest of the text untouched, in paragraphs`, /committee reviewed the budget/.test(X.text) && X.paras >= 5, `${X.paras} paragraphs`);
    let ok = false; try { execFileSync('soffice', ['--headless', '--convert-to', 'txt', '--outdir', OUT, file], { timeout: 120000, stdio: 'ignore' }); ok = fs.existsSync(file.replace(/docx$/, 'txt')); } catch {}
    check(`${name}: LibreOffice opens it`, ok);
  }
};

// --- PowerPoint: a born-digital report and an OCR'd scan; slides open in python-pptx and LibreOffice, text is editable
TESTS.pptx = async () => {
  for (const [f, src] of [['report.pdf', fx('report.pdf')], ['book.pdf', out('ocr-book.pdf')]]) {
    if (!fs.existsSync(src)) await ocr('book.pdf');
    const p = await H.open(); await H.load(p, src); const file = out(f.replace(/pdf$/, 'pptx'));
    fs.writeFileSync(file, await b64(p, async () => (await cvPptx(cur(), { pages: [...cur().info.keys()], background: true, lang: 'en' }, () => {})).blob));
    const I = inspect(file), n = await p.evaluate(() => cur().info.length);
    check(`${f}: one slide per page`, I.slides === n, `${I.slides} slides`);
    check(`${f}: page look kept as a picture on every slide`, I.pictures.every(x => x === 1), I.pictures.join(','));
    if (f === 'report.pdf') {
      check(`${f}: text in editable text boxes`, I.textBoxes.every(x => x >= 5) && /committee reviewed the budget/.test(I.text) && /Lisbon, 4 November 2026/.test(I.text), I.textBoxes.join(','));
      check(`${f}: headings stay centred`, I.centered >= 3, `${I.centered} centred paragraphs`);
    } else check(`${f}: OCR text kept (invisible, editable)`, lcs(fs.readFileSync(fx('book.txt'), 'utf8'), I.text) > 90, I.text.slice(0, 60));
    let ok = false; try { execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', OUT, file], { timeout: 120000, stdio: 'ignore' }); ok = fs.existsSync(file.replace(/pptx$/, 'pdf')); } catch {}
    check(`${f}: LibreOffice opens it`, ok);
  }
};

// --- Handwriting (paleography): medieval Portuguese charters from the iForal ground truth (fetched by the workflow, not
// stored here: no licence to redistribute). Character error rate against the experts' transcription, abbreviations as
// written. kraken's own Python pipeline with the same reader scores 25.6% on condado-1491 and 47.6% on abrantes-1217 (Quire: 27.3% and 17.8%).
const lev = (a, b) => { a = [...a]; b = [...b]; let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; };
const HTR_MAX = { 'condado-1491': 31, 'abrantes-1217': 22 };
TESTS.htr = async () => {
  for (const [f, max] of Object.entries(HTR_MAX)) {
    if (!fs.existsSync(fx(f + '.pdf'))) { check(`${f}: manuscript page present`, false, 'run fixtures/page_xml.py (see the workflow)'); continue; }
    const p = await H.open(); await H.load(p, fx(f + '.pdf')); const t0 = Date.now();
    const r = await p.evaluate(async () => { const r = await htrPage(cur(), 0, 'catmus-medieval'); return { lines: r.lines, words: r.words.length }; });
    const sp = s => s.normalize('NFC').replace(/\s+/g, ' ').trim(), T = sp(fs.readFileSync(fx(f + '.txt'), 'utf8')), G = sp(r.lines.join('\n'));
    fs.writeFileSync(out(f + '.htr.txt'), r.lines.join('\n'));
    const cer = lev(G, T) / T.length * 100, nl = fs.readFileSync(fx(f + '.txt'), 'utf8').split('\n').length;
    check(`${f}: lines found`, Math.abs(r.lines.length - nl) <= Math.max(3, nl * .1), `${r.lines.length} of ${nl}`);
    check(`${f}: character error rate at most ${max}%`, cer <= max, `${cer.toFixed(1)}% in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (f === 'condado-1491') {
      // the text layer: words land on the page and can be found
      const file = out(f + '-htr.pdf'); fs.writeFileSync(file, await b64(p, async () => { const d = cur(); const r = await htrPage(d, 0, 'catmus-medieval'); await editBytes('t', async pdf => { const font = ocrFont(pdf); ocrLayer(pdf, font, r, false); }); return d.bytes; }));
      const t = pdftotext(file); check(`${f}: text layer searchable`, /poborador/.test(t), t.split('\n')[1] || '');
    }
  }
};

// --- Handwriting on Portuguese Inquisition trials: pages from the TraPrInq validation set (CC BY 4.0, committed by the
// 'Inquisition reader scores' workflow), read with the default reader, TraPrInq, against the project's expert text
const INQ = path.join(__dirname, 'fixtures', 'real', 'inq'), INQ_MAX = 24;
TESTS.htr_inquisition = async () => {
  const pages = fs.existsSync(INQ) ? fs.readdirSync(INQ).filter(f => /\.pdf$/.test(f)).sort() : [];
  check('Inquisition test pages present', pages.length > 0, 'run the Inquisition reader scores workflow'); if (!pages.length) return;
  const p = await H.open(); check('TraPrInq reader available', await H.htrPreload(p, 'traprinq'));
  check('TraPrInq is the default reader', await p.evaluate(() => htrReaders()[0].id === 'traprinq'));
  for (const f of pages) {
    await H.load(p, path.join(INQ, f)); const t0 = Date.now();
    const lines = await p.evaluate(async () => (await htrPage(cur(), 0, 'traprinq')).lines);
    const sp = s => s.normalize('NFC').replace(/\s+/g, ' ').trim(), T = sp(fs.readFileSync(path.join(INQ, f.replace(/pdf$/, 'txt')), 'utf8')), G = sp(lines.join('\n'));
    fs.writeFileSync(out(f.replace(/pdf$/, 'htr.txt')), lines.join('\n'));
    const cer = lev(G, T) / T.length * 100;
    check(`${f}: character error rate at most ${INQ_MAX}%`, cer <= INQ_MAX, `${cer.toFixed(1)}% in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
};

// --- editions: Lite and Pro are built from the one source; each loads cleanly, shows only its own features, and every
// ribbon tab and button works with a document open
TESTS.editions = async () => {
  execFileSync('node', [path.join(__dirname, '..', 'tools', 'build-editions.js'), '--check']);
  const PRO_ONLY = ['pii', 'reader', 'snap', 'loupe', 'splitv', 'audit', 'email'];
  for (const ed of ['lite', 'pro']) {
    const p = await H.open(path.join(__dirname, '..', 'web', 'dist', `quire-${ed}.html`));
    const r = await p.evaluate(async () => {
      const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < 3; i++) pdf.addPage([595, 842]).drawText('Edition check page ' + (i + 1), { x: 72, y: 760, size: 18, font: f });
      await openBytes(await pdf.save(), 'editions.pdf');
      const seen = new Set(), bad = [];
      for (const k of Object.keys(RIB)) { document.querySelector(`[data-rib="${k}"]`).click(); await new Promise(r => setTimeout(r, 30));
        for (const b of document.querySelectorAll('#rbtns [data-act], #rbtns [data-tool]')) { seen.add(b.dataset.act || b.dataset.tool); if (!b.querySelector('svg')) bad.push(b.dataset.act || b.dataset.tool); } }
      return { ed: window.QUIRE_EDITION, seen: [...seen], bad, acts: Object.keys(ACTS) };
    });
    check(`${ed}: QUIRE_EDITION is set`, r.ed === ed, r.ed);
    const has = PRO_ONLY.filter(k => r.seen.includes(k) || r.acts.includes(k));
    check(`${ed}: ${ed === 'lite' ? 'no' : 'all'} Pro-only buttons`, ed === 'lite' ? has.length === 0 : has.length === PRO_ONLY.length, has.join(' ') || 'none');
    check(`${ed}: core Lite buttons present`, ['batch', 'cleanscan', 'versions', 'qr', 'initials', 'fsig', 'mydetails'].every(k => r.seen.includes(k)), r.seen.length + ' buttons');
    check(`${ed}: every button has an icon`, !r.bad.length, r.bad.join(' '));
    check(`${ed}: no errors while loading and switching tabs`, !p.errs.length, p.errs.slice(0, 3).join(' | '));
    await p.context().close();
  }
};

// --- memory: thumbnails are drawn only near view and let go far away; undo copies stay under their cap; pdf.js reads in
// its own thread (not the page's)
TESTS.memory = async () => {
  const p = await H.open();
  const r = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
    const pdf = await PDFDocument.create(); for (let i = 0; i < 300; i++) pdf.addPage([595, 842]).drawText('p' + (i + 1), { x: 60, y: 700, size: 40 });
    const d = await openBytes(await pdf.save(), 'memory.pdf'); const drawn = () => [...document.querySelectorAll('#thumbs canvas')].map((c, i) => c.width ? i : -1).filter(i => i >= 0);
    await w(2500); const top = drawn(); const T = document.querySelector('#thumbs'); T.scrollTop = T.scrollHeight; await w(2500); const bottom = drawn();
    window.QUIRE_UNDO_MAX = d.bytes.length * 2.5; for (let k = 0; k < 6; k++) await editBytes('Rotated', pdf => { pdf.getPage(k).setRotation(degrees(90)); });
    return { top, bottom, undo: d.undo.length, worker: !!d.pdf.loadingTask._worker._webWorker };
  });
  check('thumbnails: only those near view are drawn', r.top.length > 3 && r.top.length < 40 && r.top[0] === 0, `${r.top.length} drawn`);
  check('thumbnails: scrolled-away ones are let go, the new ones drawn', r.bottom.length < 40 && !r.bottom.includes(0) && r.bottom.includes(299), `${r.bottom.length} drawn, from ${r.bottom[0]}`);
  check('undo: copies kept under the memory cap (at least 3 steps)', r.undo === 3, `${r.undo} steps`);
  check('pdf.js reads files in its own thread', r.worker);
  await p.context().close();
};

(async () => {
  const want = process.argv.slice(2); const names = want.length ? want : Object.keys(TESTS);
  for (const n of names) {
    current = { name: n, checks: [], error: null }; results.push(current); const t0 = Date.now(); process.stdout.write(`▶ ${n}\n`);
    try { await TESTS[n](); } catch (e) { current.error = String(e && e.stack || e); }
    current.secs = (Date.now() - t0) / 1000;
    for (const c of current.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.what}${c.detail ? '  (' + c.detail + ')' : ''}`);
    if (current.error) console.log('  ✗ error: ' + current.error);
  }
  await H.close();
  const bad = results.filter(r => r.error || r.checks.some(c => !c.ok));
  const md = ['# Quire tests', '', `${results.length - bad.length} of ${results.length} groups passed.`, '', '| | Test | Result |', '|---|---|---|',
    ...results.flatMap(r => [...r.checks.map(c => `| ${c.ok ? '✅' : '❌'} | ${r.name}: ${c.what} | ${c.detail.replace(/\|/g, '/')} |`), ...(r.error ? [`| ❌ | ${r.name} | ${r.error.split('\n')[0].replace(/\|/g, '/')} |`] : [])])].join('\n');
  fs.writeFileSync(out('report.md'), md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(bad.length ? `\n${bad.length} group(s) failed: ${bad.map(r => r.name).join(', ')}` : '\nAll tests passed.');
  process.exit(bad.length ? 1 : 0);
})();
