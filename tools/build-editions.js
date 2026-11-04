#!/usr/bin/env node
// Builds Quire's two editions from the one source file.
//   node tools/build-editions.js            -> web/dist/quire-lite.html and web/dist/quire-pro.html
//   node tools/build-editions.js --check    -> also fails if a Lite build still names something only Pro defines
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

if (process.argv.includes('--check')) {
  const { checked, bad } = liteUsesPro(parts);
  if (bad.length) { console.error('Lite still uses names that only Pro defines: ' + bad.join(', ')); process.exit(1); }
  console.log(`check: Lite uses none of the ${checked} names defined only in Pro`);
}
