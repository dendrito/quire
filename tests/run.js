// Quire's automatic tests. Each one drives the real app in headless Chromium and checks the result with independent
// tools: veraPDF for PDF/A and PDF/UA, poppler's pdftotext for OCR and redaction, python-docx and openpyxl for Word
// and Excel. Run from this folder:  node run.js [name ...]     (names: signatures pdfa pdfua ocr excel word pptx redaction htr)
// Needs: npm install, python3 fixtures/make.py, pip install python-docx openpyxl, poppler-utils, and veraPDF on
// VERAPDF (a command) for the PDF/A and PDF/UA tests.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
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
  await p.evaluate(([l, m]) => { pref.set('ocr', { lang: l, also: '', dir: 'h', skip: true, ...m }); S.ocr = null; openTask('ocr'); }, [lang, more]);
  await p.waitForSelector('#oGo'); const n0 = await p.evaluate(() => cur().bytes.length); const t0 = Date.now();
  await p.click('#oGo');
  await p.waitForFunction(n => cur().bytes.length !== n || (document.querySelector('#oMsg') && /fail|could not|No text/i.test(document.querySelector('#oMsg').textContent)), n0, { timeout: 600000, polling: 500 });
  const file = out('ocr-' + f); fs.writeFileSync(file, await b64(p, async () => buildOutput(cur())));
  return { file, secs: (Date.now() - t0) / 1000, p };
};
// faded.pdf reads 58% here and 49.5% on GitHub's runner (Pillow and numpy draw the page slightly differently); before the faded-page work it was 30%
const OCR_MIN = { 'book.pdf': 95, 'faded.pdf': 45, 'table-ruled.pdf': 95, 'table-free.pdf': 95 };
TESTS.ocr = async () => {
  for (const [f, min] of Object.entries(OCR_MIN)) {
    const { file, secs } = await ocr(f); const acc = lcs(fs.readFileSync(fx(f.replace(/pdf$/, 'txt')), 'utf8'), pdftotext(file));
    check(`${f}: at least ${min}% of words read`, acc >= min, `${acc.toFixed(1)}% in ${secs.toFixed(0)} s`);
  }
  // the most accurate (full-precision) models on the faded page: 60.6% here against 58.2% with the everyday ones
  const { file, secs } = await ocr('faded.pdf', 'por', { best: true }); const acc = lcs(fs.readFileSync(fx('faded.txt'), 'utf8'), pdftotext(file));
  check(`faded.pdf with the most accurate models: at least ${OCR_MIN['faded.pdf'] + 2}% of words read`, acc >= OCR_MIN['faded.pdf'] + 2, `${acc.toFixed(1)}% in ${secs.toFixed(0)} s`);
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
const docx = async (src, name) => { const p = await H.open(); await H.load(p, src); const file = out(name);
  fs.writeFileSync(file, await b64(p, async () => { const d = cur(); return (await cvDocx(d, { headings: true, tables: true, images: true, dropRunning: true, pageBreaks: false, pages: [...d.info.keys()] }, () => {})).blob; })); return inspect(file); };
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
