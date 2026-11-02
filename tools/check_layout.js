const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const f of ['layout-overview-planet.html','layout-overview-moon.html','layout-overview-compact.html']) {
    const p = await b.newPage();
    p.on('pageerror', e => {});
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + path.resolve('fixtures', f));
    const r = await p.evaluate(() => {
      const meta = n => document.querySelector(`meta[name="${n}"]`)?.content ?? null;
      const isOgx = !!(meta('csrf-token') && meta('ogame-version') && document.querySelector('#planetList') &&
        (document.querySelector('#siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i]') ||
         [...document.head.childNodes].some(n => n.nodeType === 8 && /OGameX/.test(n.data))));
      const planets = [...document.querySelectorAll('#planetList > .smallplanet')].map(el => {
        const a = el.querySelector('a.planetlink');
        const t = a.getAttribute('title') || '';
        const f = t.match(/([\d,.]+)km \((\d+)\/(\d+)\)/);
        const m = el.querySelector('a.moonlink');
        const moonId = m ? +new URL(m.getAttribute('href'), location.href).searchParams.get('cp') : null;
        return { id: +el.dataset.planetId, name: el.querySelector('.planet-name').textContent.trim(),
          coords: el.querySelector('.planet-koords').textContent.trim().replace(/[\[\]]/g,''),
          fields: f ? [+f[2], +f[3]] : null, diameter: f ? +f[1].replace(/\D/g,'') : null,
          moonId, moonFields: m ? (m.getAttribute('title').match(/\((\d+)\/(\d+)\)/)||[]).slice(1).map(Number) : null,
          building: !!el.querySelector('a.constructionIcon'), active: a.classList.contains('active'), moonActive: !!m?.classList.contains('active') };
      });
      const src = [...document.scripts].map(s => s.textContent).find(t => t.includes('reloadResources({')) || '';
      const res = {};
      for (const k of ['metal','crystal','deuterium']) {
        const mm = src.match(new RegExp('"' + k + '":\\s*\\{\\s*"amount":\\s*(-?[\\d.eE+]+),\\s*"storage":\\s*(-?[\\d.eE+]+),[\\s\\S]*?"production":\\s*(-?[\\d.eE+]+)'));
        res[k] = mm && { amount: +mm[1], storage: +mm[2], perSec: +mm[3] };
      }
      const st = src.match(/var serverTime = new Date\('(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)'\)/);
      return { isOgx, body: document.body.id, cur: meta('ogame-planet-id'), planets, res,
        serverTimeUTC: st && Date.parse(st[1].replace(' ', 'T') + 'Z'),
        cls: [...document.querySelector('#characterclass .sprite').classList].pop(),
        dm: +document.querySelector('#resources_darkmatter').dataset.raw };
    });
    console.log(f, JSON.stringify(r));
  }
  await b.close();
})();
