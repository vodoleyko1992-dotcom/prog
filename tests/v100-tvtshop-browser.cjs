'use strict';
// 10.0: браузерный смоук «Магазин TvT» (node tests/v100-tvtshop-browser.cjs; CHROMIUM=…): Shil в «Обзоре», список целей (магу — Vesper Singer первым
// среди оружия), строка цели «не хватает N (≈M побед)», галочка «покупать сам» пишется в cfg, без ошибок и горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const py = fs.readFileSync(path.join(root, 'tests/v715-ui-browser.py'), 'utf8');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
mock = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", "rt:{char:'Warlock',lvl:64,prof:'Warlock',tsShil:{n:13,t:Date.now()},tsLog:[{t:Date.now(),id:920032,n:'Пояс Судьбы',ok:false,why:'на странице 100 Shil, нужно 180'}]}");
mock = mock.replace("cfg:{", "cfg:{tsGoalItem:920033,");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.evaluate(mock);
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, c), 'utf8') });
    // 14.10: используем реальный порядок зависимостей меню с новыми панелями.
    for (const j of [...fs.readFileSync(path.join(root,'popup.html'),'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1])) await page.addScriptTag({ content: fs.readFileSync(path.join(root, j), 'utf8') });
    await page.waitForTimeout(900);
    const dash = await page.$eval('#dashLines', e => e.textContent);
    await page.locator('#navToggle').click(); await page.locator('#moduleNav button[data-tab="pvp"]').click(); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#tsBox').scrollIntoView());
    const box = await page.$eval('#tsBox', e => e.textContent), goal = await page.$eval('#tsGoalBox', e => e.textContent);
    const opts = await page.$$eval('#tsGoalItem option', o => o.map(x => x.textContent)), sel = await page.$eval('#tsGoalItem', e => e.value);
    await page.locator('#tsBuy').check(); await page.waitForTimeout(500);
    const saved = await page.evaluate(() => window.__mockState.cfg.tsBuy);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = /Shil 13/.test(dash) && /Shil Coins: 13/.test(box) && /✗ Пояс Судьбы/.test(box) && sel === '920033' && /Тату Души · 260 Shil · есть 13 Shil, не хватает 247 \(≈124 побед в TvT\) · нужен 70 ур\./.test(goal)
      && /\+978 M\.Atk/.test(goal) && opts.length === 14 && /^Vesper Singer · оружие · 200 Shil · 70 ур\./.test(opts[1]) && opts.filter(x => /^· /.test(x)).length === 8 && saved === true && !overflow && !errors.length;
    if (!ok) { console.error('FAIL', JSON.stringify({ w, dash, box, goal, sel, opts, saved, overflow, errors })); process.exit(1); }
    console.log(`PASS ${w}px: TvT shop menu — Shil in overview, goal list (mage: Vesper Singer first, 8 non-fitting weapons marked), goal line with wins to go and level 70, buy checkbox saved`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
