// Splits Quire's one source into its Lite and Pro editions. Used by tools/build-editions.js (web builds) and by the
// Mac and Windows apps' scripts/vendor.js (desktop builds, when QUIRE_EDITION is set).
// The app's own script is the last inline <script> block, cut into sections at its /* ===== name ===== */ markers.
// tools/editions.json lists the sections that are Pro only; every other section is in both editions.
'use strict';
const fs = require('fs');
const path = require('path');

const MARK = /^\/\* =+ (.+?) =+ ?\*\/\s*$/;
const EDITIONS = ['lite', 'pro'];
const config = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'editions.json'), 'utf8'));

function split(src, cfg = config()) {
  const open = src.lastIndexOf('<script>');
  const close = src.indexOf('</script>', open);
  if (open < 0 || close < 0) throw new Error('no inline <script> found');
  const head = src.slice(0, open + '<script>'.length), body = src.slice(open + '<script>'.length, close), tail = src.slice(close);
  const sections = [];
  let cur = { name: '(start)', lines: [] };
  for (const l of body.split('\n')) {
    const m = l.match(MARK);
    if (m) { sections.push(cur); cur = { name: m[1].trim(), lines: [l] }; } else cur.lines.push(l);
  }
  sections.push(cur);
  const isPro = s => cfg.pro.some(p => s.name.toLowerCase().startsWith(p.toLowerCase()));
  for (const p of cfg.pro) if (!sections.some(s => s.name.toLowerCase().startsWith(p.toLowerCase()))) throw new Error(`editions.json names a section that is not in the source: "${p}"`);
  return { head, tail, sections, isPro };
}

function build(src, edition, parts = split(src)) {
  if (!EDITIONS.includes(edition)) throw new Error(`unknown edition "${edition}" (use ${EDITIONS.join(' or ')})`);
  const keep = parts.sections.filter(s => edition === 'pro' || !parts.isPro(s));
  return parts.head + `\nwindow.QUIRE_EDITION = ${JSON.stringify(edition)};` + keep.map(s => s.lines.join('\n')).join('\n') + parts.tail;
}

// Names declared at the top level of a Pro-only section that Lite code still uses (should be none).
function liteUsesPro(parts) {
  const proOnly = parts.sections.filter(parts.isPro), decl = new Set();
  for (const s of proOnly) for (const l of s.lines) {
    const m = l.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/) || l.match(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
    if (m) decl.add(m[1]);
  }
  const lite = parts.sections.filter(s => !parts.isPro(s)).map(s => s.lines.join('\n')).join('\n');
  const q = n => n.replace(/\$/g, '\\$');
  // A name Lite declares for itself (say, a local helper with the same name) is Lite's own, not a use of Pro's.
  const own = n => new RegExp(`\\b(?:const|let|var|function|class)\\s+${q(n)}(?![\\w$])`).test(lite);
  return { checked: decl.size, bad: [...decl].filter(n => !own(n) && new RegExp(`(^|[^\\w$.'"])${q(n)}(?![\\w$])`).test(lite)) };
}

module.exports = { EDITIONS, split, build, liteUsesPro };
