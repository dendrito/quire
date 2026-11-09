// Builds bin/quire-scan, the small helper that reaches scanners through the Mac's Image Capture framework
// (scanner/quire-scan.swift), as one file for both Apple silicon and Intel, and signs it the same ad-hoc way as the app.
// Needs the Xcode command line tools (swiftc). On other computers it does nothing, and the app is built without scanning.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const src = path.join(root, 'scanner', 'quire-scan.swift'), bin = path.join(root, 'bin'), out = path.join(bin, 'quire-scan');
fs.mkdirSync(bin, { recursive: true });
if (process.platform !== 'darwin') { console.log('build-scanner: not a Mac, scanner helper skipped'); process.exit(0); }
if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) { console.log('build-scanner: bin/quire-scan is up to date'); process.exit(0); }
const parts = [];
for (const arch of ['arm64', 'x86_64']) {
  const o = path.join(bin, 'quire-scan-' + arch);
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos11`, '-framework', 'ImageCaptureCore', '-o', o, src], { stdio: 'inherit' });
  parts.push(o);
}
execFileSync('lipo', ['-create', '-output', out, ...parts], { stdio: 'inherit' });
for (const p of parts) fs.rmSync(p);
execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' });
console.log('build-scanner: built bin/quire-scan (arm64 + x86_64)');
