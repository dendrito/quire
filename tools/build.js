#!/usr/bin/env node
// Builds Quire for every platform from the one web app, the way the quando project does it: one command per platform
// and edition, finished files collected in build/<platform>/ with their checksums and the commit they came from.
// GitHub runs the same command for each platform in .github/workflows/build.yml, so nothing needs installing to get
// the apps: Actions > Build > Run workflow, then download them from the "latest" release.
//
//   node tools/build.js <platform> [edition]
//
//   platform  web       Quire Lite and Pro as single pages that open in a browser             any computer
//             mac       .dmg for Apple silicon and Intel                                       a Mac
//             windows   installer and portable .exe, x64 and arm64                             Windows (or Linux with wine)
//             android   .apk for Android tablets (Lite only)                                   Java 17 and the Android SDK
//             ipad      checks the iPad app compiles (Lite only; install it from Xcode)         a Mac with Xcode
//             all       every platform this computer can build
//             check     lists what this computer can build, and what is missing for the rest
//   edition   lite, pro or both (the default). Phones and tablets are Lite only.
//
// Options: --no-install skips npm install (when node_modules is already up to date).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build');
const win = process.platform === 'win32', mac = process.platform === 'darwin';
const PLATFORMS = ['web', 'mac', 'windows', 'android', 'ipad'];
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const noInstall = process.argv.includes('--no-install');
const [platform = '', edArg = 'both'] = args;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/build.js web|mac|windows|android|ipad|all|check [lite|pro|both] [--no-install]');
  process.exit(2);
}
if (![...PLATFORMS, 'all', 'check'].includes(platform)) usage(platform ? `Unknown platform "${platform}".` : '');
if (!['lite', 'pro', 'both'].includes(edArg)) usage(`Unknown edition "${edArg}".`);
const editions = edArg === 'both' ? ['lite', 'pro'] : [edArg];

// ---- helpers ----
function has(cmd) {
  const r = spawnSync(win ? 'where' : 'command', win ? [cmd] : ['-v', cmd], { shell: !win, stdio: 'ignore' });
  return r.status === 0;
}
function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${opts.cwd ? path.relative(root, opts.cwd) + ': ' : ''}${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit', cwd: opts.cwd || root, shell: win,
    env: { ...process.env, ...(opts.env || {}) }
  });
  if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${cmdArgs.join(' ')}`); process.exit(r.status || 1); }
}
function npmInstall(dir) {
  if (noInstall && fs.existsSync(path.join(dir, 'node_modules'))) return;
  const lock = fs.existsSync(path.join(dir, 'package-lock.json'));
  run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: dir });
}
function fresh(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
function collect(fromDir, test, toDir) {
  const got = fs.existsSync(fromDir) ? fs.readdirSync(fromDir).filter(test) : [];
  if (!got.length) { console.error(`Nothing was built in ${path.relative(root, fromDir)}.`); process.exit(1); }
  for (const f of got) fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f));
  return got;
}
function commit() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown (not a git checkout)';
}
// Writes SHA256SUMS.txt and source-commit.txt next to the files, so a download can be checked against its build.
function stamp(dir) {
  const files = fs.readdirSync(dir).filter(f => !/^(SHA256SUMS|source-commit)\.txt$/.test(f) && fs.statSync(path.join(dir, f)).isFile());
  const sums = files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') + '  ' + f);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'source-commit.txt'), commit() + '\n');
  console.log(`\n${path.relative(root, dir)}/:\n` + files.map(f => `  ${f}  ${(fs.statSync(path.join(dir, f)).size / 1048576).toFixed(1)} MB`).join('\n'));
}
// The desktop apps carry their own copy of the web app; the Tests workflow checks they match.
function syncCopies() {
  const src = path.join(root, 'web/quire-pdf-studio.html');
  for (const app of ['mac', 'windows']) {
    const dst = path.join(root, app, 'src/quire.html');
    if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(fs.readFileSync(src))) {
      fs.copyFileSync(src, dst);
      console.log(`Copied web/quire-pdf-studio.html to ${app}/src/quire.html`);
    }
  }
}

// ---- what this computer can build ----
function androidSdk() { return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''; }
function java17() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', shell: win });
  const m = /version "(\d+)/.exec((r.stderr || '') + (r.stdout || ''));
  return m && +m[1] >= 17;
}
const NEEDS = {
  web: () => '',
  mac: () => mac ? '' : 'a Mac (or run it on GitHub: Actions > Build)',
  windows: () => win ? '' : process.platform === 'linux' ? (has('wine') ? '' : 'wine (or run it on GitHub: Actions > Build)') : 'Windows (or run it on GitHub: Actions > Build)',
  android: () => [!java17() && 'Java 17', !androidSdk() && 'the Android SDK (ANDROID_HOME)'].filter(Boolean).join(' and '),
  ipad: () => !mac ? 'a Mac with Xcode' : has('xcodebuild') ? '' : 'Xcode'
};

// ---- the platforms ----
const BUILD = {
  web() {
    const dir = path.join(out, 'web'); fresh(dir);
    run(process.execPath, ['tools/build-editions.js', '--check', '--site']);
    // the whole pages from web/site (doctype, title, icon), named by edition: open one in any browser
    for (const ed of editions) fs.copyFileSync(path.join(root, 'web/site', ed, 'index.html'), path.join(dir, `quire-${ed}.html`));
    stamp(dir);
  },

  mac() {
    syncCopies();
    const app = path.join(root, 'mac'), dir = path.join(out, 'mac'); fresh(dir);
    npmInstall(app);
    for (const ed of editions) {
      const env = { QUIRE_EDITION: ed, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
      fs.rmSync(path.join(app, 'dist'), { recursive: true, force: true });
      run(process.execPath, ['scripts/vendor.js'], { cwd: app, env });
      run(process.execPath, ['scripts/edition-config.js'], { cwd: app, env });
      // One architecture at a time: two disk images built at once share a volume name and hdiutil cannot detach them.
      for (const arch of ['--arm64', '--x64']) run('npx', ['electron-builder', '--mac', 'dmg', arch, '--config', 'edition-builder.json'], { cwd: app, env });
      collect(path.join(app, 'dist'), f => f.endsWith('.dmg'), dir);
    }
    stamp(dir);
  },

  windows() {
    syncCopies();
    const app = path.join(root, 'windows'), dir = path.join(out, 'windows'); fresh(dir);
    npmInstall(app);
    for (const ed of editions) {
      const env = { QUIRE_EDITION: ed, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
      fs.rmSync(path.join(app, 'dist'), { recursive: true, force: true });
      run(process.execPath, ['scripts/vendor.js'], { cwd: app, env });
      run(process.execPath, ['scripts/edition-config.js'], { cwd: app, env });
      run('npx', ['electron-builder', '--win', '--config', 'edition-builder.json'], { cwd: app, env });
      collect(path.join(app, 'dist'), f => f.endsWith('.exe'), dir);
    }
    stamp(dir);
  },

  android() {
    if (!editions.includes('lite')) return console.log('Android is Lite only: nothing to build for Pro.');
    const app = path.join(root, 'mobile'), dir = path.join(out, 'android'); fresh(dir);
    npmInstall(app);
    run(process.execPath, ['scripts/build-www.js'], { cwd: app, env: { QUIRE_EDITION: 'lite' } });
    run('npx', ['cap', 'sync', 'android'], { cwd: app });
    const gradle = path.join(app, 'android');
    if (!win) fs.chmodSync(path.join(gradle, 'gradlew'), 0o755);
    run(win ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--no-daemon'], { cwd: gradle });
    fs.copyFileSync(path.join(gradle, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(dir, 'Quire-Lite-Android.apk'));
    stamp(dir);
  },

  ipad() {
    if (!editions.includes('lite')) return console.log('The iPad app is Lite only: nothing to build for Pro.');
    const app = path.join(root, 'mobile');
    npmInstall(app);
    run(process.execPath, ['scripts/build-www.js'], { cwd: app, env: { QUIRE_EDITION: 'lite' } });
    run('npx', ['cap', 'sync', 'ios'], { cwd: app });
    // iPads only run apps signed by Apple, so this proves the app compiles; install it with `npm run ios` in mobile/.
    run('xcodebuild', ['-project', 'App.xcodeproj', '-scheme', 'App', '-sdk', 'iphonesimulator',
      '-destination', 'generic/platform=iOS Simulator', 'CODE_SIGNING_ALLOWED=NO', '-quiet', 'build'], { cwd: path.join(app, 'ios/App') });
    console.log('\nThe iPad app compiles. To put it on an iPad: cd mobile && npm run ios, then press Run in Xcode (see mobile/README.md).');
  }
};

// ---- main ----
fs.mkdirSync(out, { recursive: true });
if (platform === 'check') {
  for (const p of PLATFORMS) { const need = NEEDS[p](); console.log(`${p.padEnd(8)} ${need ? 'needs ' + need : 'ready'}`); }
  process.exit(0);
}
const todo = platform === 'all' ? PLATFORMS.filter(p => { const need = NEEDS[p](); if (need) console.log(`Skipping ${p}: needs ${need}.`); return !need; }) : [platform];
for (const p of todo) {
  const need = NEEDS[p]();
  if (need) { console.error(`Building for ${p} needs ${need}.`); process.exit(1); }
  console.log(`\n==== ${p} (${p === 'android' || p === 'ipad' ? 'lite' : editions.join(' + ')}) ====`);
  BUILD[p]();
}
console.log(`\nDone: ${todo.join(', ')}. Files are in build/.`);
