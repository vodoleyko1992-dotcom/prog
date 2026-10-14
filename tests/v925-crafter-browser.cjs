'use strict';
// 9.2.5 (крафтер Skye): браузерный смоук с НАСТОЯЩИМ кодом страниц игры (item-transfer-ui.js + item-transfer.js, mail-item-render.js +
// mail-item-attachments.js — берутся с l2wap.com при запуске; нет сети — пропуск). 1) «Передача предмета»: модуль mammon находит строку
// Iron Ore на 2-й странице (листает «Вперед »»), вводит количество и ник, жмёт «Надіслати», проверяет окно подтверждения и жмёт
// «Підтвердити» — игра шлёт POST /game/item-transfer/send {itemKey, qty, recipientName: 'Skye'} ровно один раз на предмет.
// (письмо крафтеру после партии — в v1002-crafter-note-browser.cjs, здесь выключено)
// 2) Почта, вкладка «Предмети»: «Забрати» — игра шлёт POST /game/item-transfer/claim, после — список перечитан, возврат от Skye списан.
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const L2STUB = `window.L2 = { tr: (k, f) => f, token: () => 'x', lastSnapshot: () => ({ revision: 7 }), authFetch: (u, o) => fetch(u, o), setToken() {},
  playerMessageOr: (j, f) => (j && (j.messageUk || j.error)) || f, applyCharacterSnapshot() {}, resyncCharacterWhenRequired: async () => null };`;
const TR_BODY = `<main id="item-transfer-content"><p class="l2-item-transfer-err" id="item-transfer-err" hidden></p><p id="item-transfer-loading">…</p>
<p id="item-transfer-empty" hidden>Немає</p><nav id="item-transfer-categories" hidden></nav><div class="l2-item-transfer-list" id="item-transfer-list" hidden></div>
<nav id="item-transfer-pagination" hidden></nav><div id="item-transfer-confirm-mount"></div><p class="l2-item-transfer-success" id="item-transfer-success" hidden></p></main>`;
const MAIL_BODY = `<nav id="mail-tabs"><button type="button" data-mail-tab="inbox">Вхідні</button><button type="button" data-mail-tab="items">Предмети</button></nav><div id="mail-tab-items" hidden></div>
<script>document.querySelector('[data-mail-tab=items]').addEventListener('click', e => { e.target.classList.add('is-active'); const r = document.getElementById('mail-tab-items'); r.hidden = false; MailItemAttachments.mount('mail-tab-items'); });</script>`;
async function gameJs(f) { try { const r = await fetch('https://l2wap.com/' + f); return r.ok ? await r.text() : null; } catch (e) { return null; } }
// 25 предметов в сумке: Iron Ore — 22-й (2-я страница по 20)
const CANDS = Array.from({ length: 25 }, (_, i) => i === 21 ? { itemKey: 'res:1869', itemId: 1869, name: 'Iron Ore', stackable: true, availableQty: 115, transferValueUnitAdena: 10, categoryKey: 'other' }
  : i === 3 ? { itemKey: 'res:1865', itemId: 1865, name: 'Varnish', stackable: true, availableQty: 20, transferValueUnitAdena: 12, categoryKey: 'other' }
  : { itemKey: 'x:' + (2000 + i), itemId: 2000 + i, name: 'Item ' + i, stackable: true, availableQty: 5, transferValueUnitAdena: 1, categoryKey: 'other' });
// окружение модуля как в content.js (настоящий fire из content.js)
const ENV = `
  const contentSrc = window.__content, fireSrc = contentSrc.slice(contentSrc.indexOf('function fire(el) {'), contentSrc.indexOf('\\n}\\n', contentSrc.indexOf('function fire(el) {')) + 3);
  const on = true, tabOwner = true; const fire = (0, eval)('(function(){ const on = true, tabOwner = true, abHold = () => false; return ' + fireSrc.replace('function fire', 'function') + '; })()');
  (0, eval)(window.__mammon);
  const rt = window.__rt || {}, recs = [], bag = window.__bag;
  const env = { rt, cfg: { mmGoalItem: 920018, mmGoalLvl: 1, mmCrafter: 'Skye', mmCraftNote: false }, setRt: async p => { Object.assign(rt, p); await window.__report(JSON.stringify({ rt, recs })); }, rec: (...a) => recs.push(a.join(' ')), setStatus() {},
    sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 400))), waitX: async (fn, ms = 5000, st = 100) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, st)); } },
    fire, $q: s => document.querySelector(s), isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false, autonomyMode: () => 'hunt', tvtSoon: () => false,
    heroNick: () => 'Warlock', invQty: id => bag[id] ?? 0, invRefresh: async () => ({ ...bag }), ITEMS: {}, FARM: { res: {} }, gameGet: p => fetch(p) };
  const M = globalThis.L2V7Factories.mammon(env);`;
(async () => {
  const js = await Promise.all(['l2-compact-pagination.js', 'item-transfer-ui.js', 'item-transfer.js', 'mail-item-render.js', 'mail-item-attachments.js'].map(gameJs));
  if (js.some(x => !x)) { console.log('SKIP: game JS (item-transfer.js / mail) unavailable — no network'); return; }
  const [pager, tui, tjs, mrender, matt] = js;
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = [], sends = [], claims = []; p.on('pageerror', e => errors.push(String(e)));
  let claimed = false, last = null;
  await p.exposeFunction('__report', s => { last = JSON.parse(s); });
  // в конце похода модуль уходит на карту (location.href = '/map.html') — итог берём из последней записи rt
  const run = async body => { last = null; await p.evaluate(async ([ENVSRC, B]) => new Function(`return (async () => { ${ENVSRC}\n${B} })()`)(), [ENV, body]).catch(e => { if (!/context was destroyed|navigation/i.test(e.message)) throw e; });
    await p.waitForURL('**/map.html', { timeout: 15000 }); return last; };
  await p.route('**/*', async r => {
    const u = new URL(r.request().url()), json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/game/item-transfer/candidates') { const pg = +u.searchParams.get('page') || 1; return json({ candidates: CANDS.slice((pg - 1) * 20, pg * 20), page: pg, totalPages: 2, categoryCounts: {} }); }
    if (u.pathname === '/game/item-transfer/send') { sends.push(JSON.parse(r.request().postData() || '{}')); return json({ ok: true }); }
    if (u.pathname === '/game/item-transfer/claim') { claims.push(JSON.parse(r.request().postData() || '{}')); claimed = true; return json({ ok: true }); }
    if (u.pathname === '/game/item-transfer/received') return json({ page: 1, totalPages: 1, attachments: [{ attachmentId: 501, senderName: 'Skye', itemId: 1880, name: 'Steel', qty: 3, createdAt: new Date().toISOString(), claimedAt: claimed ? new Date().toISOString() : null }] });
    if (u.pathname === '/map.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>map</p>' });
    if (u.pathname === '/item-transfer.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${TR_BODY}<script>${L2STUB}</script><script>${pager}</script><script>${tui}</script><script>${tjs}</script></body></html>` });
    if (u.pathname === '/mail.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${MAIL_BODY}<script>${L2STUB}</script><script>${pager}</script><script>${mrender}</script><script>${matt}</script></body></html>` });
    return json({});
  });
  const inject = async extra => { await p.evaluate(([c, m, rt, bag]) => { window.__content = c; window.__mammon = m; window.__rt = rt; window.__bag = bag; }, [read('content.js'), read('modules/mammon.js'), extra.rt, extra.bag]); };
  // 1. передача
  await p.goto('https://l2wap.com/item-transfer.html');
  await p.waitForSelector('.l2-item-transfer-row-wrap', { timeout: 10000 });
  await inject({ rt: { mmEq: { belt: [920018, 0] } }, bag: { 1458: 100, 1869: 115, 1876: 100, 1865: 20 } });
  const S = await run(`const w = M.craftWant(); if (!w) throw new Error('no want'); await env.setRt({ mmJob: { ...w, step: 'act', t: Date.now() } });
      for (let i = 0; i < 12 && rt.mmJob; i++) await M.sendStep(rt.mmJob);`);
  const res = { at: S.rt.mmCraft?.at, log: S.rt.mmLog?.[0], job: S.rt.mmJob };
  assert.equal(sends.length, 2, 'two items, one send each: ' + JSON.stringify(sends));
  const iron = sends.find(s => s.itemKey === 'res:1869'), varn = sends.find(s => s.itemKey === 'res:1865');
  assert.equal(iron.qty, 15); assert.equal(iron.recipientName, 'Skye'); assert.equal(varn.qty, 15); assert.equal(varn.expectedRevision, 7); assert.ok(iron.clientTransferId);
  assert.equal(JSON.stringify(res.at), JSON.stringify({ 1865: 15, 1869: 15 }));
  assert.equal(res.job, null); assert.equal(res.log.ok, true); assert.match(res.log.why, /отправил Skye: .*Iron Ore 15/);
  console.log('PASS browser: «Передача предмета» (real game page) — Iron Ore found on page 2, qty and nick typed, «Надіслати» → confirm checked → «Підтвердити»; one POST per item to Skye, «у крафтера» recorded');
  // 2. почта
  await p.goto('https://l2wap.com/mail.html');
  await inject({ rt: { mmEq: { belt: [920018, 0] }, mmCraft: { to: 'Skye', at: { 1869: 15, 1865: 15 }, t0: Date.now() - 60000 } }, bag: {} });
  const S2 = await run(`await env.setRt({ mmJob: { kind: 'claim', step: 'act', t: Date.now() } });
      for (let i = 0; i < 6 && rt.mmJob; i++) await M.claimStep(rt.mmJob);`);
  const m = { craft: S2.rt.mmCraft, log: S2.rt.mmLog?.[0], recs: S2.recs };
  assert.equal(claims.length, 1); assert.equal(claims[0].attachmentId, 501);
  assert.equal(m.craft, null, 'returned Steel ×3 writes off 15 Iron Ore + 15 Varnish'); assert.equal(m.log.ok, true); assert.match(m.log.why, /забрал: Steel ×3 от Skye/);
  assert.ok(m.recs.some(x => /Skye вернул: Steel ×3/.test(x)));
  console.log('PASS browser: mail «Предмети» (real game code) — «Забрати» pressed once, list re-read, return from Skye written off');
  assert.deepEqual(errors, []);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
