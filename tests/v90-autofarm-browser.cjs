'use strict';
// 10.0.17: тест загружает фактические зависимости popup, включая новые разделы, как расширение.
// 9.0: браузерный смоук меню автокача (node tests/v90-autofarm-browser.cjs; CHROMIUM=…): таблица зон с колонкой КПД,
// строка «по базе игры лучше всех», маршрут 1→80 с отметкой своего уровня, поле «мобы не выше героя на N», без ошибок и прокрутки вбок
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'base-profile.json'), 'utf8')), W = base.chars.Warlock.rt;
const py = fs.readFileSync(path.join(root, 'tests/v715-ui-browser.py'), 'utf8');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
mock = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", "rt:{char:'Warlock',lvl:60,prof:'Warlock',zone:'aden',zoneCat:window.__zc,zoneStat:window.__zs}");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.evaluate(([zc, zs]) => { window.__zc = zc; window.__zs = zs; }, [W.zoneCat, W.zoneStat]);
    await page.evaluate(mock);
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, c), 'utf8') });
    for (const j of [...require('fs').readFileSync(require('path').join(root, 'popup.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) await page.addScriptTag({ content: fs.readFileSync(path.join(root, j), 'utf8') });
    await page.waitForTimeout(900);
    await page.locator('#navToggle').click(); await page.locator('#moduleNav button[data-tab="hunt"]').click(); await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('#zoneBox').scrollIntoView(); });
    const head = await page.$$eval('#zoneBox table th', t => t.map(x => x.textContent));
    const rec = await page.$eval('#zoneBox .rec', x => x.textContent);
    const kpd = await page.$$eval('#zoneBox table tr', r => r.slice(1).map(x => x.children[3]?.textContent));
    await page.locator('#routeWrap > summary').click(); await page.waitForTimeout(300);
    const route = await page.$$eval('#routeBox table tr', r => r.slice(1).map(x => [...x.children].map(c => c.textContent)));
    const cur = route.find(x => x[0].startsWith('📍'));
    await page.fill('#zoneAbove', '6'); await page.locator('#zoneAbove').dispatchEvent('change'); await page.waitForTimeout(500);
    const saved = await page.evaluate(() => window.__mockState.cfg.zoneAbove);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (process.env.SHOT) await page.locator('#zoneBox').screenshot({ path: process.env.SHOT + '-' + w + '-zones.png' }), await page.locator('#routeBox').screenshot({ path: process.env.SHOT + '-' + w + '-route.png' });
    const ok = head.includes('КПД') && /По базе игры лучше всех для 60 ур\.: Ancient Battleground/.test(rec) && kpd.some(x => /^≈/.test(x || ''))
      && route.length >= 8 && /^1/.test(route[0][0]) && /80$/.test(route[route.length - 1][0]) && cur && /Ancient Battleground/.test(cur[1])
      && +saved === 6 && !overflow && !errors.length;
    if (!ok) { console.error('FAIL', JSON.stringify({ w, head, rec, kpd, route: route.slice(0, 4), cur, saved, overflow, errors })); process.exit(1); }
    console.log(`PASS ${w}px: autofarm menu — KPD column, best zone by the game base (Ancient Battleground at 60), route 1→80 (${route.length} legs, ${cur[0]}), «не выше героя на N» saved`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
