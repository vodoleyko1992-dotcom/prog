'use strict';
// 10.0.5 (игрок 13.10, спойлер WestSPOIL: «левая панель вышла за край»): информационное окно слева запоминало самое широкое поле
// и на экране с более широкой рамкой игры залезало на игру. Настоящий Chromium с расширением: экран с узкой игрой, потом с широкой —
// окно не заходит за левый край игры, старая запись «самого широкого» поля из localStorage не мешает
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const path = require('path'), root = path.join(__dirname, '..');
const game = w => `<!doctype html><html><head><title>L2WAP</title>
<style>body{margin:0;background:#111}#wrap{width:${w}px;margin:0 auto;background:#222}#map-mob-list{height:600px}#l2-nav-bottom{height:80px}</style></head>
<body><div id="wrap"><div id="map-mob-list"><a class="l2-map-mob-link">Giant Fungus · ур. 40</a></div><div id="l2-nav-bottom"></div></div></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  // 20.54 (прогон смоуков 23.10): стенд не ждал конца установки — onInstalled фона (базовый профиль, rec/autoSnap) в конце
  // перезагружает открытые вкладки l2wap, и под нагрузкой это рвало goto map.html (net::ERR_ABORTED); иногда chrome.storage
  // в только что поднятом service worker ещё не было. Ждём, как общий стенд v1014: storage доступен, установка записала cfg.rec и rt.
  for (let t0 = Date.now(); ; await new Promise(r => setTimeout(r, 100))) {
    const ready = await sw.evaluate(async () => { if (!globalThis.chrome?.storage?.local) return false; const s = await chrome.storage.local.get(['cfg', 'rt']); return !!s.cfg?.rec && !!s.rt; }).catch(() => false);
    if (ready) break;
    if (Date.now() - t0 > 20000) throw new Error('установка расширения не завершилась за 20 с');
  }
  await new Promise(r => setTimeout(r, 300));
  await sw.evaluate(() => chrome.storage.local.set({ cfg: { dock: false } }));
  let gw = 560;
  await ctx.route('https://l2wap.com/**', r => /\.html/.test(r.request().url()) ? r.fulfill({ contentType: 'text/html', body: game(gw) }) : r.fulfill({ contentType: 'application/json', body: '{}' }));
  const errs = [], out = {};
  const look = p => p.evaluate(() => { const i = document.getElementById('l2bot-ind'), g = document.getElementById('wrap').getBoundingClientRect(), r = i.getBoundingClientRect();
    return { wide: i.classList.contains('wide'), right: Math.round(r.right), left: Math.round(r.left), game: Math.round(g.left), bottom: Math.round(r.bottom), vh: innerHeight }; });
  const open = async (w, label, pre) => {
    gw = w; const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 1600, height: 900 });
    if (pre) await p.addInitScript(pre);
    await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(3500); out[label] = await look(p); await p.close();
  };
  // старая запись 7.2.3 «самое широкое поле» 700 px при ширине окна 1600
  await open(560, 'narrowGame', () => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('l2bot-indw', JSON.stringify({ vw: 1600, free: 700 })); } });
  await open(900, 'wideGame');
  await open(560, 'backNarrow');
  await ctx.close();
  const fits = o => o.right <= o.game && o.left >= 0 && o.bottom <= o.vh;
  const ok = !errs.length && fits(out.narrowGame) && out.narrowGame.wide && fits(out.wideGame) && out.wideGame.wide && fits(out.backNarrow) && out.backNarrow.right === out.wideGame.right;
  console.log((ok ? 'PASS' : 'FAIL') + ': info window never covers the game — narrower margin on another screen shrinks it, it stays put after, old «widest» record ignored' + (ok ? '' : ' ' + JSON.stringify({ out, errs })));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
