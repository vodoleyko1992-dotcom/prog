'use strict';
// 10.0.17: тест загружает фактические зависимости popup, включая новые разделы, как расширение.
// 9.0 (Маммон): браузерный смоук (node tests/v90-mammon-browser.cjs; CHROMIUM=…). Настоящие скрипты расширения (порядок из manifest)
// на подставной https://l2wap.com: 1) свой GET заказа уходит с «Authorization: Bearer <token страницы>» и заказ попадает в rt;
// 2) страница телепорта к торговцу — цена, кнопка нажата настоящим fire; 3) страница торговца — «Здати» своего заказа, победитель
// проверен, поход закрыт; 4) меню: раздел «Маммон» (заказ, NPC, цель, бонусы) на 760 и 375 px без горизонтальной прокрутки
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
const py = read('tests/v715-ui-browser.py');
let mock = py.slice(py.indexOf('mock=r"""') + 9); mock = mock.slice(0, mock.indexOf('"""'));
const exp = new Date(Date.now() + 3600000).toISOString();
const order = st => ({ request: { requestId: 'r-77', status: st, resourceItemId: 1864, resourceNameEn: 'Stem', quantity: 42, reward: { coinOfLuck: 1, adena: 1500000 }, expiresAt: exp, winnerName: st === 'CLAIMED' ? 'Warlock' : null, playerHaveQty: 2299 } });
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false }, rt: { char: 'Warlock' } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); Object.assign(data.cfg, msg.cfgPatch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  localStorage.setItem('token', 'tok-123'); })();`;
const HUD = '<div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div>';
// 10.0.24: реальная игра UTF-8; без charset Chromium портил «Адена», новая проверка валюты правильно отказывала.
const PAGES = {
  '/map.html': `<html><body>${HUD}</body></html>`,
  '/mammon-merchant-loc.html': `<html><body>${HUD}<p id="mammon-loc-cost">Ціна телепорту: 500000 Адена</p><button id="mammon-loc-teleport-btn" onclick="window.__tp=(window.__tp||0)+1">Телепорт до Торговця Маммона</button><p id="mammon-loc-err" hidden></p></body></html>`,
  '/mammon-merchant.html': `<html><body>${HUD}<div id="mammon-request-panel-mount"><button class="l2-mammon-request-panel__btn l2-mammon-order-submit" data-request-id="r-77" onclick="window.__claimed=1;document.getElementById('mammon-merchant-shop-msg').textContent='Замовлення виконано!';document.getElementById('mammon-merchant-shop-msg').hidden=false">Здати 42 Stem</button></div><p id="mammon-merchant-shop-msg" hidden></p></body></html>`,
};
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const auth = [];
  const run = async (pagePath, fn, arg) => {
    const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
    let claimed = false;
    await p.route('https://l2wap.com/**', async r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
      if (u.pathname.startsWith('/game/') || u.pathname === '/character') {
        auth.push([u.pathname, r.request().headers().authorization || '']);
        const body = u.pathname === '/game/mammon/merchant/request' ? order(claimed ? 'CLAIMED' : 'OPEN') : u.pathname === '/game/mammon/merchant'
          ? { mammonMerchant: { current: { id: 'pilgrims_necropolis', labelEn: "The Pilgrim's Necropolis", worldX: 45600, worldY: 126944 }, next: { labelEn: 'Necropolis of Worship' }, rotatesAtMs: Date.now() + 3600000 }, teleport: { adenaCost: 500000 } }
          : u.pathname === '/game/mammon/blacksmith' ? { mammonBlacksmith: { current: { id: 'catacomb_of_the_witch', labelEn: 'Catacomb of the Witch', worldX: 136672, worldY: 79328 }, next: { labelEn: 'Catacomb of Dark Omens' }, rotatesAtMs: Date.now() + 3600000 }, teleport: { adenaCost: 500000 } }
          : u.pathname === '/character' ? { character: { worldX: 114736, worldY: -2316 } } : {};
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGES[u.pathname] || PAGES['/map.html'] });
    });
    await p.goto('https://l2wap.com' + pagePath);
    await p.evaluate(coreMock);
    for (const s of scripts) await p.addScriptTag({ content: read(s) });
    await p.exposeFunction('__setClaimed', () => { claimed = true; });
    const res = await p.evaluate(fn, arg);
    await p.close();
    return { res, errors };
  };
  // 1. опрос заказа и NPC — с токеном страницы
  const r1 = await run('/map.html', async () => { on = true; tabOwner = true; leaseEpoch = 'e'; await L2V7Modules.mammon.mmTick(); return { o: rt.mmOrder, npc: rt.mmNpc, want: L2V7Modules.mammon.want() }; });
  const hdr = auth.filter(a => a[0] === '/game/mammon/merchant/request');
  const ok1 = r1.res.o?.qty === 42 && r1.res.o.have === 2299 && r1.res.npc?.order?.loc === "The Pilgrim's Necropolis" && r1.res.npc?.smith?.price === 500000 && r1.res.want?.kind === 'order'
    && hdr.length && hdr.every(a => a[1] === 'Bearer tok-123') && !r1.errors.length;
  if (!ok1) { console.error('FAIL 1', JSON.stringify({ r1, auth })); process.exit(1); }
  console.log('PASS browser: order + NPC polled with the page token (Bearer), order «Stem ×42, 2299 in bag» → trip wanted');
  // 2. мы далеко → страница телепорта: цена 500 000 ≤ лимита, кнопка нажата, шаг «на месте»
  const r2 = await run('/mammon-merchant-loc.html', async () => { on = true; tabOwner = true; leaseEpoch = 'e';
    await setRt({ mmJob: { kind: 'order', id: 'r-77', step: 'go', home: 'ancient_battleground', t: Date.now(), why: 'заказ Stem ×42' } });
    await L2V7Modules.mammon.mmStep();
    return { tp: window.__tp || 0, job: rt.mmJob, log: rt.mmLog, payment: rt.actionPayments }; });
  if (!(r2.res.tp === 1 && r2.res.job?.step === 'act' && !r2.errors.length)) { console.error('FAIL 2', JSON.stringify(r2)); process.exit(1); }
  console.log('PASS browser: far from the merchant → teleport page, price 500 000 within the limit, button pressed once');
  // 3. у торговца: «Здати» своего заказа → победитель Warlock → поход закрыт, обратно на точку
  const r3 = await run('/mammon-merchant.html', async () => { on = true; tabOwner = true; leaseEpoch = 'e';
    document.querySelector('.l2-mammon-order-submit').addEventListener('click', () => window.__setClaimed());
    await setRt({ mmJob: { kind: 'order', id: 'r-77', step: 'act', home: 'ancient_battleground', t: Date.now(), why: 'заказ Stem ×42' } });
    await L2V7Modules.mammon.mmStep();
    return { claimed: window.__claimed || 0, job: rt.mmJob, log: rt.mmLog, zoneGo: rt.zoneGo }; });
  if (!(r3.res.claimed === 1 && r3.res.job === null && r3.res.log?.[0]?.ok === true && /\+1 Coin of Luck, \+1\s500\s000 адены/.test(r3.res.log[0].why) && r3.res.zoneGo?.id === 'ancient_battleground' && !r3.errors.length)) { console.error('FAIL 3', JSON.stringify(r3)); process.exit(1); }
  console.log('PASS browser: at the merchant — «Здати» pressed for our order, winner checked (+1 Coin of Luck, +1 500 000 adena), back to the spot');
  // 4. меню
  const rtMenu = { char: 'Warlock', lvl: 60, mmOrder: { id: 'r-77', st: 'OPEN', res: 'Stem', qty: 42, have: 2299, adena: 1500000, col: 1, exp: Date.now() + 3600000 },
    mmNpc: { t: Date.now(), order: { loc: "The Pilgrim's Necropolis", next: 'Necropolis of Worship', at: Date.now() + 3600000, price: 500000 }, smith: { loc: 'Catacomb of the Witch', next: 'Catacomb of Dark Omens', at: Date.now() + 3600000, price: 500000 } },
    mmEq: { belt: [920018, 0], cloak: [920019, 0], tattoo: [910623, 0] }, mmGoalSt: 'Пояс першопрохідця Lv.1: не хватает Crystal: D-Grade 100, Mithril Ore 100, Steel 3 · добываю Mithril Ore',
    // 9.2: план наперёд до цели — по уровням (≈ оценка), итог, сырьё, что передать крафтеру
    mmGoalPlan: { id: 920018, n: 'Пояс першопрохідця', lvl: 0, to: 3, a: 1500000, c: 3, unk: [], lv: [{ L: 0, e: 0, a: 250000, c: 1, m: [['Crystal: D-Grade', 100], ['Iron Ore', 100], ['Mithril Ore', 100], ['Steel', 3]] },
      { L: 1, e: 1, a: 500000, c: 1, m: [['Crystal: D-Grade', 200], ['Iron Ore', 200], ['Mithril Ore', 200], ['Steel', 6]] }, { L: 2, e: 1, a: 750000, c: 1, m: [['Crystal: D-Grade', 300], ['Iron Ore', 300], ['Mithril Ore', 300], ['Steel', 9]] }],
      tot: [['Crystal: D-Grade', 600, 0, 600], ['Iron Ore', 600, 908, 0], ['Mithril Ore', 600, 0, 600], ['Steel', 18, 0, 18]],
      raw: [['Crystal: D-Grade', 600, 0, 600, 0], ['Iron Ore', 690, 908, 0, 1], ['Mithril Ore', 600, 0, 600, 1], ['Varnish', 90, null, 90, 1]], cr: [['Steel', 18, 18, '5 Iron Ore + 5 Varnish']] },
    mmLog: [{ kind: 'order', ok: true, why: 'сдал Stem ×42 → +1 Coin of Luck, +1 500 000 адены', t: Date.now() }] };
  const m = mock.replace("rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}}", `rt:${JSON.stringify(rtMenu)}`).replace(/cfg:\{/, 'cfg:{mmGoalItem:920018,mmGoalLvl:3,');
  if (m === mock) { console.error('FAIL 4: popup mock not patched'); process.exit(1); }
  for (const w of [760, 375]) {
    const page = await b.newPage({ viewport: { width: w, height: 1100 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**/mammon-gear.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: read('mammon-gear.json') }));
    await page.goto('about:blank');
    await page.evaluate(m);
    await page.evaluate(() => { const g = chrome.runtime.getURL; chrome.runtime.getURL = p => p === 'mammon-gear.json' ? 'https://l2wap.com/mammon-gear.json' : g(p); });
    await page.route('https://l2wap.com/mammon-gear.json', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: read('mammon-gear.json') }));
    const html = read('popup.html').replace(/<link rel="stylesheet" href="[^"]+">/g, '').replace(/<script src="[^"]+"><\/script>/g, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const c of ['ui-v7.css', 'ui-game.css']) await page.addStyleTag({ content: read(c) });
    for (const j of [...require('fs').readFileSync(require('path').join(root, 'popup.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) await page.addScriptTag({ content: read(j) });
    await page.evaluate(() => document.querySelector('nav button[data-tab="mammon"]').click());
    await page.waitForTimeout(1200);
    const t = await page.$eval('#tab-mammon', e => e.innerText), opts = await page.$$eval('#mmGoalItem option', o => o.length), sel = await page.$eval('#mmGoalItem', e => e.value);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.evaluate(() => document.querySelector('#mmPoll').click()); await page.waitForTimeout(200);
    const req = await page.evaluate(() => window.__mockState?.rt?.mmPollReq);
    // 9.2.5: кнопки «Сдать заказ сейчас» / «Улучшить сейчас» → разовая команда rt.mmGoReq
    await page.evaluate(() => document.querySelector('#mmGoOrder').click()); await page.waitForTimeout(200);
    const goO = await page.evaluate(() => window.__mockState?.rt?.mmGoReq?.kind);
    await page.evaluate(() => document.querySelector('#mmGoUp').click()); await page.waitForTimeout(200);
    const goU = await page.evaluate(() => window.__mockState?.rt?.mmGoReq?.kind);
    if (goO !== 'order' || goU !== 'up') { console.error('FAIL: Mammon go buttons', goO, goU); process.exit(1); }
    const ok = /Stem ×42/.test(t) && /1 Coin of Luck \+ 1\s500\s000 адены/.test(t) && /Pilgrim's Necropolis/.test(t) && /Catacomb of the Witch/.test(t) && /добываю Mithril Ore/.test(t)
      && /≈ Lv\.2→3/.test(t) && /Всего наперёд до Lv\.3: 1\s500\s000 адены \+ 3 Coin of Luck/.test(t) && /Varnish\s+90\s+\?\s+90/.test(t) && /Нужно изготовить/.test(t) && /Steel\s+18\s+5 Iron Ore \+ 5 Varnish/.test(t)
      && /M\.Def|HP: 200 → 220/.test(t) && opts === 24 && sel === '920018' && !overflow && req && !errs.length;
    if (!ok) { console.error('FAIL 4', JSON.stringify({ w, t: t.slice(0, 900), opts, sel, overflow, req, errs })); process.exit(1); }
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-' + w + '.png', fullPage: true });
    console.log(`PASS browser ${w}px: «Маммон» — order, NPC places, goal progress, plan ahead by level + total + raw + crafter list, bonuses Lv.0–5, 23 items to pick, «Проверить заказ» → mmPollReq, «Сдать заказ / Улучшить сейчас» → mmGoReq, no sideways scroll`);
    await page.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
