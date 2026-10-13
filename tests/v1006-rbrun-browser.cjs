'use strict';
// 10.0.6 (игрок 13.10 02:02: «кнопочка — что выпало за серию РБ»): настоящий Chromium с расширением — в левом окне бота между журналом
// и «🐉 Респ эпиков» есть кнопка «📦 Серия РБ», она кликабельна (окно само pointer-events:none), раскрывает сводку из памяти персонажа
// (rt.rbRun: убитые, адена/EXP, вещи), «↺ Новая серия» по двойному нажатию обнуляет и пишет в память
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const path = require('path'), root = path.join(__dirname, '..');
const game = `<!doctype html><html><head><title>L2WAP</title><style>body{margin:0;background:#111}#wrap{width:560px;margin:0 auto;background:#222}#map-mob-list{height:600px}</style></head>
<body><div id="wrap"><div id="map-mob-list"><a class="l2-map-mob-link">Giant Fungus · ур. 40</a></div><div id="l2-nav-bottom"></div></div></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const run = { t0: Date.now() - 50 * 60000, mode: 'tour', kills: 2, adena: 369185, exp: 754395, sp: 371706, fa: 2, deaths: 1, items: { 'Spellbook: Blaze': 2, 'Mithril Ore': 4 },
    bosses: [{ n: 'Rahha', l: 65, t: Date.now() - 40 * 60000, a: 269184, e: 704393 }, { n: 'Rahha', l: 65, t: Date.now() - 20 * 60000, a: 100001, e: 50002 }] };
  await sw.evaluate(run => chrome.storage.local.set({ cfg: { dock: false, rbHuntMode: true }, rt: { char: 'Warlock', rbRun: run, rbTimer: { b: {} } }, 'rt@Warlock': { rbRun: run } }), run);
  await ctx.route('https://l2wap.com/**', r => /\.html/.test(r.request().url()) ? r.fulfill({ contentType: 'text/html', body: game }) : r.fulfill({ contentType: 'application/json', body: '{}' }));
  const errs = [], p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.setViewportSize({ width: 1600, height: 900 });
  await p.goto('https://l2wap.com/map.html'); await p.waitForTimeout(3500);
  const q = s => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, s);
  const out = {};
  out.btn = await q('#l2bot-ind .b [data-rbrun=toggle]');
  out.order = await p.evaluate(() => { const i = document.getElementById('l2bot-ind'); const b = i.querySelector('.b'), e = i.querySelector('.e'), r = i.querySelector('.r');
    return { hasB: !!b, bAfterR: !r || (!!b && !!(r.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)), eAfterB: !!(b && e) && !!(b.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING), closed: !i.querySelector('[data-rbrun=reset]') }; });
  await p.click('#l2bot-ind [data-rbrun=toggle]'); await p.waitForTimeout(300);
  out.open = await q('#l2bot-ind .b');
  out.reset1 = !!(await q('#l2bot-ind [data-rbrun=reset]'));
  await p.click('#l2bot-ind [data-rbrun=reset]'); await p.waitForTimeout(200); out.ask = await q('#l2bot-ind [data-rbrun=reset]');
  await p.click('#l2bot-ind [data-rbrun=reset]'); await p.waitForTimeout(1500);
  out.after = await q('#l2bot-ind .b');
  out.stored = await sw.evaluate(async () => { const s = await chrome.storage.local.get('rt'); const r = s.rt?.rbRun; return r ? { kills: r.kills, mode: r.mode, items: Object.keys(r.items || {}).length } : null; });
  await p.reload(); await p.waitForTimeout(3000); out.reopen = !!(await q('#l2bot-ind [data-rbrun=reset]'));   // раскрытое состояние помнится на устройстве
  await ctx.close();
  const ok = !errs.length && /📦 Серия РБ: убито 2 · вещей 6 ▾/.test(out.btn || '') && out.order.hasB && out.order.bAfterR && out.order.eAfterB && out.order.closed
    && /\(тур РБ\) · РБ убито 2 · смертей 1/.test(out.open || '') && /убиты: Rahha \(65\) ×2/.test(out.open) && /Mithril Ore ×4, Spellbook: Blaze ×2/.test(out.open) && /💎 FA \+2/.test(out.open)
    && out.reset1 && /Ещё раз/.test(out.ask || '') && /РБ убито 0/.test(out.after || '') && /\(вручную\)/.test(out.after) && out.stored && out.stored.kills === 0 && out.stored.mode === 'manual' && out.reopen;
  console.log((ok ? 'PASS' : 'FAIL') + ': «📦 Серия РБ» button in the info window between the journal and epic respawns — click opens the per-series drop summary, double «↺ Новая серия» resets it in memory' + (ok ? '' : ' ' + JSON.stringify({ out, errs })));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
