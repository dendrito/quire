// Copies the shared web app (../web/quire-pdf-studio.html) into ./app/index.html.
// The Mac and Windows wrappers both load this one file, so every feature added
// to the web app shows up in both desktop apps on the next build.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'web', 'quire-pdf-studio.html');
const outDir = path.resolve(__dirname, '..', 'app');
const dest = path.join(outDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error(`\nCannot find the web app at:\n  ${src}\n` +
    'Put quire-pdf-studio.html in the web/ folder next to windows/ and try again.\n');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied web app -> ${path.relative(process.cwd(), dest)}`);
