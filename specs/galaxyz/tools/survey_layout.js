// Survey: run GZLayout on every real page in eu/pages and print a compact per-page summary.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const HERE = path.resolve(__dirname, '..');
const DIR = path.resolve(HERE, '../../../eu/pages');
(async () => {
  const b = await chromium.launch();
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort()) {
    const p = await b.newPage();
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + path.join(DIR, f), { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'layout-recipes.js') });
    const r = await p.evaluate(() => {
      const L = GZLayout.parseLayout(document), A = GZLayout.anchors(document);
      return { det: L.detect.ok + '/' + L.detect.layout, route: L.route.page + '/' + L.route.mode + '/body=' + L.route.bodyId,
        tz: L.time.tzOffsetMs, render: L.time.renderUnix, cur: L.current.id, n: L.planets.length, tt: L.planets.filter(p => p.tooltip).length,
        bld: L.planets.filter(p => p.building).map(p => p.id).join(','),
        res: ['metal','crystal','deuterium'].map(k => L.resources[k].amount != null && L.resources[k].storage != null && L.resources[k].perHour != null ? 1 : 0).join(''),
        en: L.resources.energy && L.resources.energy.available + '/' + L.resources.energy.production, dm: L.resources.darkmatter,
        ev: L.events.length, pl: L.player.name + '#' + L.player.rank + ' msg' + L.player.unreadMessages,
        anchors: Object.entries(A).filter(([k, v]) => v).map(([k]) => k).join(',') };
    });
    console.log(f.padEnd(22), JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
