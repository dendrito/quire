// Quire's speed and memory benchmark: the numbers the Lite performance work is measured against.
//   node bench.js [lite|pro|full|file.html ...]     (default: lite)    -> prints a table, writes out/bench-<edition>.json
// Measures start-up, opening and saving a 300-page file, memory after each (after garbage collection), and OCR
// speed and accuracy on the test pages (run `python3 fixtures/make.py` first). Needs the same setup as run.js.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const H = require('./harness.js');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const APPS = { full: path.join(ROOT, 'web', 'quire-pdf-studio.html'), lite: path.join(ROOT, 'web', 'dist', 'quire-lite.html'), pro: path.join(ROOT, 'web', 'dist', 'quire-pro.html') };
const norm = s => s.normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().split(/\s+/).filter(Boolean);
const lcs = (truth, got) => { const a = norm(truth), b = norm(got), dp = Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; } } return dp[b.length] / a.length * 100; };
const OCR_PAGES = ['book.pdf', 'faded.pdf', 'table-ruled.pdf', 'real/herculano-faded.pdf'];

// memory of the whole browser (every tab, the PDF reader's and OCR's background workers, the GPU process): the sum of
// memory of Chromium's processes, with shared memory counted once (Linux PSS), roughly what an activity monitor shows
function rss() { try { let kb = 0; for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) { try { if (!/chrom/i.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'))) continue; const m = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m); if (m) kb += +m[1]; } catch {} } return Math.round(kb / 1024); } catch { return null; } }
async function heap(p) { const c = await p.context().newCDPSession(p); await c.send('HeapProfiler.collectGarbage'); const h = await c.send('Runtime.getHeapUsage'); await c.detach(); return +(h.usedSize / 1048576).toFixed(1); }
const ms = async (p, fn, arg) => p.evaluate(async ([src, a]) => { const t = performance.now(); await (0, eval)(src)(a); return Math.round(performance.now() - t); }, [fn.toString(), arg]);

async function bench(ed) {
  if (/\.html$/.test(ed)) APPS[ed] = path.resolve(ed);
  const R = { edition: ed, when: new Date().toISOString() };
  const t0 = Date.now(); const p = await H.open(APPS[ed]); R.startMs = Date.now() - t0;
  R.htmlKB = Math.round(fs.statSync(APPS[ed]).size / 1024);
  R.heapIdleMB = await heap(p);
  // a 300-page file with text and a drawing on every page
  await p.evaluate(async () => { const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.TimesRoman);
    for (let i = 0; i < 300; i++) { const pg = pdf.addPage([595, 842]); for (let l = 0; l < 40; l++) pg.drawText(`Page ${i + 1}, line ${l + 1}: the quick brown fox jumps over the lazy dog.`, { x: 60, y: 780 - l * 18, size: 11, font: f }); pg.drawRectangle({ x: 60, y: 40, width: 475, height: 20, color: rgb(.9, .9, .95) }); }
    window._b = await pdf.save(); });
  R.rssIdleMB = rss();
  // until the first page is on screen; memory is read 3 s later, while the thumbnails are still being drawn
  R.open300Ms = await ms(p, async () => { await openBytes(window._b.slice(), 'bench-300.pdf');
    const drawn = () => { const c = document.querySelector('#viewer canvas'); try { return c && c.width && c.getContext('2d').getImageData(c.width >> 1, 60, 1, 1).data[3] > 0; } catch { return false; } };
    while (!drawn()) await new Promise(r => setTimeout(r, 20)); });
  await p.waitForTimeout(3000); R.heapOpen300MB = await heap(p); R.rssOpen300MB = rss();
  R.rotateMs = await ms(p, async () => { await editBytes('Rotated', pdf => { pdf.getPage(0).setRotation(degrees(90)); }); });
  R.saveMs = await ms(p, async () => { window._o = await buildOutput(cur()); });
  R.thumbsRendered = await p.evaluate(() => [...document.querySelectorAll('#thumbs canvas')].filter(c => { try { return c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0; } catch { return false; } }).length);
  R.thumbPixelsMB = await p.evaluate(() => +([...document.querySelectorAll('#thumbs canvas')].reduce((a, c) => a + c.width * c.height * 4, 0) / 1048576).toFixed(1));
  R.heapAfterEditsMB = await heap(p); R.rssAfterEditsMB = rss();
  R.pdfLibLoads = (fs.readFileSync(APPS[ed], 'utf8').match(/PDFDocument\.load\(/g) || []).length;
  await p.context().close();
  // OCR, Portuguese, the everyday models, as the tests run it
  R.ocr = {};
  for (const f of process.argv.includes('--no-ocr') ? [] : OCR_PAGES) {
    const fx = path.join(__dirname, 'fixtures', f); if (!fs.existsSync(fx)) continue;
    const q = await H.open(APPS[ed]); await H.load(q, fx);
    await q.evaluate(() => { pref.set('ocr', { lang: 'por', also: '', dir: 'h', skip: true }); S.ocr = null; openTask('ocr'); });
    await q.waitForSelector('#oGo'); const n0 = await q.evaluate(() => cur().bytes.length); const t = Date.now();
    await q.click('#oGo');
    await q.waitForFunction(n => cur().bytes.length !== n || /fail|could not|No text/i.test(document.querySelector('#oMsg')?.textContent || ''), n0, { timeout: 600000, polling: 250 });
    const secs = (Date.now() - t) / 1000, heapMB = await heap(q), rssMB = rss();
    const file = path.join(OUT, 'bench-ocr-' + f.replace(/\//g, '-'));
    fs.writeFileSync(file, await H.bytes(q, async () => buildOutput(cur())));
    const words = lcs(fs.readFileSync(fx.replace(/pdf$/, 'txt'), 'utf8'), execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-']).toString());
    R.ocr[f] = { secs: +secs.toFixed(1), wordsPct: +words.toFixed(1), heapMB, rssMB };
    await q.context().close();
  }
  return R;
}

(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--')), eds = args.length ? args : ['lite'];
  if (eds.some(e => e === 'lite' || e === 'pro')) execFileSync('node', [path.join(ROOT, 'tools', 'build-editions.js')]);
  for (const ed of eds) {
    const R = await bench(ed); fs.writeFileSync(path.join(OUT, `bench-${path.basename(ed, '.html')}.json`), JSON.stringify(R, null, 2));
    console.log(`\n${ed}: app ${R.htmlKB} KB, ready in ${R.startMs} ms, ${R.heapIdleMB} MB script memory idle, ${R.rssIdleMB} MB browser`);
    console.log(`  300 pages: first page on screen ${R.open300Ms} ms, ${R.heapOpen300MB} MB script / ${R.rssOpen300MB} MB browser; rotate one page ${R.rotateMs} ms; save ${R.saveMs} ms; ${R.heapAfterEditsMB} MB after; ${R.thumbsRendered} thumbnails drawn (${R.thumbPixelsMB} MB of thumbnail pictures)`);
    for (const [f, o] of Object.entries(R.ocr)) console.log(`  OCR ${f}: ${o.wordsPct}% of words in ${o.secs} s (${o.rssMB} MB browser)`);
  }
  await H.close();
})().catch(e => { console.error(e); process.exit(1); });
