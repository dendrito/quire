// Bridge between Quire and the iPad / Android system, through Capacitor's Filesystem and Share plugins.
// Saving writes the file to the app's cache, then opens the share sheet (Save to Files, AirDrop, Mail, Drive...).
(function () {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const { Filesystem, Share } = C.Plugins;
  const b64 = blob => new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });
  window.quireNative = {
    platform: C.getPlatform(),
    async save(filename, blob) {
      const name = filename.replace(/[\\/:*?"<>|]/g, '_');
      const w = await Filesystem.writeFile({ path: name, data: await b64(blob), directory: 'CACHE' });
      try { await Share.share({ title: name, url: w.uri, dialogTitle: 'Save ' + name }); }
      catch (e) { if (/cancel/i.test((e && e.message) || '')) return false; throw e; }
      return true;
    }
  };
})();
