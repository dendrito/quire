// Writes edition-builder.json: the electron-builder settings from package.json, with the app named after the
// edition in QUIRE_EDITION (lite or pro), so Quire Lite and Quire Pro each have their own name, id, installer and
// settings and can be installed side by side. Build with: npx electron-builder --config edition-builder.json
// With QUIRE_EDITION unset the settings are unchanged ("Quire PDF Studio").
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const b = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
const ed = process.env.QUIRE_EDITION;
if (ed) {
  const Name = 'Quire ' + ed[0].toUpperCase() + ed.slice(1), file = Name.replace(' ', '-');
  Object.assign(b, { productName: Name, appId: 'local.quire.' + ed });
  if (b.dmg) b.dmg.title = Name;
  if (b.nsis) Object.assign(b.nsis, { shortcutName: Name, artifactName: file + '-Setup-${version}-${arch}.${ext}' });
  if (b.portable) b.portable.artifactName = file + '-Portable-${version}-${arch}.${ext}';
}
fs.writeFileSync(path.join(root, 'edition-builder.json'), JSON.stringify(b, null, 2));
console.log(`edition-builder.json: ${b.productName} (${b.appId})`);
