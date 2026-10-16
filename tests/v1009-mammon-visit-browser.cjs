'use strict';
// 10.0.9 (игрок 13.10 07:22: «добавь кнопку — открыть Маммона/прийти к Маммону — торговец или кузнец»): настоящий Chromium с расширением —
// в окне бота под «🐉 Респ эпиков» (раскладка20.4) две кнопки, кликабельны (окно само pointer-events:none); бот стоит → клик открывает страницу
// телепорта к NPC; бот работает (on) → в памяти появляется rt.mmGoReq {kind:'visit', npc} через фон, блок показывает «⏳ …»
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const {until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const path = require('path'), root = path.join(__dirname, '..');
const game = `<!doctype html><html><head><title>L2WAP</title><style>body{margin:0;background:#111}#wrap{width:560px;margin:0 auto;background:#222}#map-mob-list{height:600px}</style></head>
<body><div id="wrap"><div id="map-mob-list"><a class="l2-map-mob-link">Giant Fungus · ур. 40</a></div><div id="l2-nav-bottom"></div></div></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  // onInstalled дописывает профиль и перезагружает игровые вкладки; первая навигация теста ждёт этой инициализации.
  await until(()=>sw.evaluate(async()=>{const s=await chrome.storage.local.get(['cfg','rt']);return !!s.cfg&&!!s.rt&&s.cfg.rec===true&&s.cfg.autoSnap===true;}));await delay(200);
  await sw.evaluate(() => chrome.storage.local.set({ on:false, cfg: { dock: false }, rt: { char: 'Warlock', rbTimer: { b: {} } }, 'rt@Warlock': {} }));
  await ctx.route('https://l2wap.com/**', r => /\.html/.test(r.request().url()) ? r.fulfill({ contentType: 'text/html', body: game }) : r.fulfill({ contentType: 'application/json', body: '{}' }));
  const errs = [], p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 1600, height: 900 });
  await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(3500);
  const out = {};
  out.layout = await p.evaluate(() => { const i = document.getElementById('l2bot-ind'); const e = i.querySelector('.e'), mm = i.querySelector('.e .mm'), et = i.querySelector('.e .et');
    const b = [...i.querySelectorAll('[data-mmgo]')].map(x => x.textContent); const r1 = et?.getBoundingClientRect(), r2 = mm?.getBoundingClientRect();
    return { hasE: !!e, btns: b, below: !!(r1 && r2) && r1.height > 0 && r2.height > 0 && r2.top >= r1.bottom - 1, last: i.lastElementChild === e, ptr: mm ? getComputedStyle(mm.querySelector('.bt')).pointerEvents : null }; });
  // бот стоит → клик «⚒ Кузнец Маммона» открывает страницу телепорта к кузнецу
  await p.click('#l2bot-ind [data-mmgo=smith]'); await p.waitForTimeout(1500); out.urlOff = p.url();
  // бот работает → клик «🛒 Торговец Маммона» ставит команду в память (через фон), окно показывает «⏳ к торговцу»
  await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(2500);
  await sw.evaluate(() => chrome.storage.local.set({ on: true })); await p.waitForTimeout(1500);
  await p.click('#l2bot-ind [data-mmgo=order]'); await p.waitForTimeout(1500);
  out.urlOn = p.url();
  out.req = await sw.evaluate(async () => { const s = await chrome.storage.local.get('rt'); return s.rt?.mmGoReq || null; });
  out.state = await p.evaluate(() => document.querySelector('#l2bot-ind .e .mm .ms')?.textContent || '');
  await ctx.close();
  const ok = !errs.length && out.layout.hasE && out.layout.btns.join('|') === '🛒 Торговец Маммона|⚒ Кузнец Маммона' && out.layout.below && out.layout.last && out.layout.ptr === 'auto'
    && /\/mammon-blacksmith-loc\.html$/.test(out.urlOff) && out.req && out.req.kind === 'visit' && out.req.npc === 'order' && /⏳ к торговцу/.test(out.state);
  console.log((ok ? 'PASS' : 'FAIL') + ': Mammon buttons in the bot window below epic respawns — stopped bot opens the teleport page, running bot queues a visit command in memory' + (ok ? '' : ' ' + JSON.stringify({ out, errs })));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
