#!/usr/bin/env node
// Builds Quire's two editions from the one source file.
//   node tools/build-editions.js            -> web/dist/quire-lite.html and web/dist/quire-pro.html
//   node tools/build-editions.js --check    -> also fails if a Lite build still names something only Pro defines
//   node tools/build-editions.js --site     -> also web/site/<edition>/index.html, whole pages to host as a website
// Which sections are Pro only is in tools/editions.json; the splitting itself is in tools/editions-lib.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { EDITIONS, split, build, liteUsesPro } = require('./editions-lib.js');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web/quire-pdf-studio.html'), 'utf8');
const parts = split(src);
const out = path.join(root, 'web/dist');
fs.mkdirSync(out, { recursive: true });
const report = [];
for (const ed of EDITIONS) {
  const html = build(src, ed, parts);
  fs.writeFileSync(path.join(out, `quire-${ed}.html`), html);
  report.push(`${ed}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}
console.log(report.join(', ') + ` (Pro-only sections: ${parts.sections.filter(parts.isPro).map(s => s.name).join('; ')})`);

// --site: web/site/<edition>/index.html, complete pages ready to host as websites (Cloudflare Pages: quire-lite.pages.dev)
if (process.argv.includes('--site')) {
  const page = (ed, html) => '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + `<title>Quire ${ed[0].toUpperCase() + ed.slice(1)}</title><meta name="description" content="A PDF editor that runs in your browser. Your files never leave your computer.">`
    + '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + html + '</body></html>';
  for (const ed of EDITIONS) {
    const dir = path.join(root, 'web/site', ed); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(ed, build(src, ed, parts)));
  }
  console.log('site: web/site/lite/index.html, web/site/pro/index.html');
}

if (process.argv.includes('--check')) {
  const { checked, bad } = liteUsesPro(parts);
  if (bad.length) { console.error('Lite still uses names that only Pro defines: ' + bad.join(', ')); process.exit(1); }
  console.log(`check: Lite uses none of the ${checked} names defined only in Pro`);
}
