'use strict';
// 8.0.7 (игрок 11.10: планшет с Firefox для Android — «всё немного криво косо»): настоящий Chromium с расширением,
// подставная страница игры. Широкий экран — меню рядом с игрой; портрет планшета (800×1280) — меню свёрнуто, игра видна,
// язычок открывает меню поверх игры, индикатор при этом прячется; меню вкладкой — раскладка на всю вкладку
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const path = require('path'), root = path.join(__dirname, '..');
const game = w => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>L2WAP</title>
<style>body{margin:0;background:#111}#wrap{width:${w}px;margin:0 auto;background:#222}#map-mob-list{height:600px}#l2-nav-bottom{height:80px}</style></head>
<body><div id="wrap"><div id="map-mob-list"><a class="l2-map-mob-link">Giant Fungus · ур. 40</a></div><div id="l2-nav-bottom"></div></div></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = sw.url().split('/')[2];
  let gw = 560;
  await ctx.route('https://l2wap.com/**', r => /\.html/.test(r.request().url()) ? r.fulfill({ contentType: 'text/html', body: game(gw) }) : r.fulfill({ contentType: 'application/json', body: '{}' }));
  const out = {}, errs = [];
  const look = async (p, label) => out[label] = await p.evaluate(() => { const d = document.getElementById('l2bot-dock'), i = document.getElementById('l2bot-ind'), t = document.getElementById('l2bot-dock-toggle');
    return { right: d?.style.right, w: d?.style.width, ind: i && getComputedStyle(i).display, over: i?.classList.contains('over'), tw: t?.style.width }; });
  // широкий экран: игра 560 px по центру 1600 — места справа хватает
  let p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 1600, height: 900 });
  await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(5500); await look(p, 'wide'); await p.close();
  // портрет планшета: игра на всю ширину
  gw = 790; p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 800, height: 1280 });
  await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(5500); await look(p, 'portrait');
  await p.click('#l2bot-dock-toggle'); await p.waitForTimeout(600); await look(p, 'portraitOpen');
  await p.click('#l2bot-dock-toggle'); await p.waitForTimeout(600); await look(p, 'portraitClosed');
  const cfg = (await sw.evaluate(() => chrome.storage.local.get('cfg'))).cfg || {};
  await p.close();
  // меню отдельной вкладкой
  p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 800, height: 1280 });
  await p.goto(`chrome-extension://${id}/popup.html`); await p.waitForTimeout(1500);
  out.tab = await p.evaluate(() => ({ cls: document.documentElement.className, h: document.body.getBoundingClientRect().height, vp: !!document.querySelector('meta[name=viewport]') }));
  await ctx.close();
  const W = out.wide, P = out.portrait, O = out.portraitOpen, C = out.portraitClosed;
  const ok = W.right === '8px' && !W.over && W.ind !== 'none'
    && P.over && P.right === `-${P.w}` && P.ind !== 'none' && P.tw === '36px'
    && O.right === '8px' && O.ind === 'none' && O.w === '460px'
    && C.right === `-${C.w}` && C.ind !== 'none' && !cfg.dockMin
    && /\btabbed\b/.test(out.tab.cls) && out.tab.h > 1200 && out.tab.vp && !errs.length;
  console.log((ok ? 'PASS' : 'FAIL') + ': tablet layout — wide: menu beside the game; portrait: menu folded, big tab opens it over the game, indicator hidden while open, shared dockMin untouched; menu as a tab fills it ' + (ok ? '' : JSON.stringify({ out, cfgDockMin: cfg.dockMin, errs })));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
