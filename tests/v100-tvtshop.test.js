'use strict';
// 10.0 (игрок 12.10: «добавь все, монеток шоу»): магазин TvT — Shil Coins по сумке, каталог из ответа игры, цель «копить на вещь», покупка по галочке
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/tvtshop.js'), raw = JSON.parse(read('kb/raw/tvt-shop.json')).data;
const mk = ({ rt = {}, cfg = {}, inv = {}, pn = '/map.html', rows = [], bal = 0, msg = null } = {}) => {
  const recs = [], fired = [], loc = { pathname: pn, href: '' }, msgEl = { textContent: msg || '' }, balEl = { textContent: String(bal) };
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: loc, document: { querySelectorAll: s => s === '.l2-tvt-shop-row' ? rows : [] } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const env = { rt: { lvl: 70, ...rt }, cfg: { tsGoalItem: 920033, tsBuy: true, ...cfg }, recs, fired, setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')),
    setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(), fire: el => { fired.push(el); if (el.onFire) el.onFire(); }, shown: () => true, isBattle: () => false, fishNow: () => false,
    $q: s => s === '#tvt-shop-msg' ? msgEl : s === '#tvt-shop-shil-balance' ? balEl : null, heroLevel: () => env.rt.lvl, invQty: id => inv[id] ?? null, awayFree: () => true, pause: async () => {} };
  return { env, T: sb.L2V7Factories.tvtshop(env), loc, fired, recs, msgEl };
};
(async () => {
  // 1. каталог из ответа игры: 13 вещей (расходники не цель), id/цены как в снимке 12.10; встроенный список совпадает
  { const { env, T } = mk(); assert.equal(T.shopNote(raw), true); assert.equal(env.rt.tsCat.items.length, 13);
    const tat = env.rt.tsCat.items.find(x => x.id === 920033); assert.equal(tat.n, 'Тату Души'); assert.equal(tat.price, 260); assert.equal(tat.lvl, 70); assert.match(tat.st, /\+978 M\.Atk/);
    for (const k of T.TS_KNOWN) { const l = env.rt.tsCat.items.find(x => x.id === k.id); assert.ok(l, k.n); assert.equal(l.price, k.price); assert.equal(l.cat, k.cat); }
    assert.equal(T.catalog().length, 13); assert.equal(T.shopNote(raw), true, 'same sig → no rewrite'); }
  // 2. монеты по сумке → rt.tsShil, прирост в журнал; без сумки — из памяти
  { const { env, T, recs } = mk({ inv: { 920030: 13 } }); T.shilNote(); assert.equal(env.rt.tsShil.n, 13); assert.equal(recs.length, 0);
    const e2 = mk({ inv: { 920030: 15 }, rt: { tsShil: { n: 13, t: 1 } } }); e2.T.shilNote(); assert.equal(e2.env.rt.tsShil.n, 15); assert.match(e2.recs.join(), /13 → 15 \(\+2\)/);
    const e3 = mk({ rt: { tsShil: { n: 7, t: 1 } } }); assert.equal(e3.T.shil(), 7); assert.equal(mk().T.shil(), null); }
  // 3. план и строка: не хватает → побед; хватает, но уровень мал
  { const { T } = mk({ inv: { 920030: 13 } }); const p = T.plan(); assert.equal(p.lack, 247); assert.equal(p.wins, 124); assert.match(T.line(), /Тату Души · 260 Shil · есть 13 Shil, не хватает 247 \(≈124 побед в TvT\)/);
    const e2 = mk({ inv: { 920030: 300 }, rt: { lvl: 64 } }); assert.equal(e2.T.plan().lvlOk, false); assert.match(e2.T.line(), /хватает, но нужен 70 ур\. \(сейчас 64\)/); assert.equal(e2.T.want(), null);
    assert.equal(mk({ inv: { 920030: 300 }, cfg: { tsBuy: false } }).T.want(), null, 'checkbox off');
    assert.equal(mk({ inv: { 920030: 300 }, rt: { tsLog: [{ id: 920033, ok: true }] } }).T.want(), null, 'already bought');
    assert.equal(mk({ inv: { 920030: 300 }, rt: { tsTryT: Date.now() } }).T.want(), null, 'tried < 1 h ago');
    assert.match(mk({ inv: { 920030: 300 } }).T.want().why, /Тату Души за 260 Shil \(есть 300\)/); }
  // 4. шаг: монет хватает → задача, переход в магазин; на странице — строка по имени, «Купити», ответ игры «Придбано» → ✓, на карту
  { const { env, T, loc } = mk({ inv: { 920030: 300 } }); assert.equal(await T.shopStep(), true); assert.equal(env.rt.tsJob.kind, 'buy'); assert.ok(env.rt.tsTryT);
    assert.equal(await T.shopStep(), true); assert.equal(loc.href, '/tvt-shop.html'); }
  { const msgEl = {}; const btn = { disabled: false, onFire: () => { msgEl.textContent = 'Придбано: Тату Души'; } };
    const row = { querySelector: s => s === '.l2-tvt-shop-row__name' ? { textContent: 'Тату Души' } : s === '.l2-tvt-shop-row__buy' ? btn : null, closest: () => null };
    const { env, T, loc, fired } = mk({ inv: { 920030: 300 }, pn: '/tvt-shop.html', rows: [row], bal: 300 });
    env.$q = s => s === '#tvt-shop-msg' ? msgEl : s === '#tvt-shop-shil-balance' ? { textContent: '300' } : null;
    env.rt.tsJob = { kind: 'buy', it: T.itemOf(920033), t: Date.now() };
    assert.equal(await T.shopStep(), true); assert.deepEqual(fired, [btn]); assert.equal(env.rt.tsJob, null); assert.equal(env.rt.tsLog[0].ok, true); assert.equal(env.rt.tsGoalDone.id, 920033); assert.equal(loc.href, '/map.html');
    assert.equal(T.want(), null, 'bought once — not again'); }
  // отказ игры и нехватка на странице → ✗ с причиной, без нажатия
  { const row = { querySelector: s => s === '.l2-tvt-shop-row__name' ? { textContent: 'Тату Души' } : { disabled: false }, closest: () => null };
    const { env, T, fired } = mk({ inv: { 920030: 300 }, pn: '/tvt-shop.html', rows: [row], bal: 100 });
    env.rt.tsJob = { kind: 'buy', it: T.itemOf(920033), t: Date.now() }; await T.shopStep(); assert.deepEqual(fired, []); assert.match(env.rt.tsLog[0].why, /на странице 100 Shil, нужно 260/); }
  // 5. ядро и меню
  const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), manifest = read('manifest.json'), mobfarm = read('modules/mobfarm.js');
  assert.match(manifest, /"modules\/tvtshop\.js"/); assert.match(html, /<script src="modules\/tvtshop\.js"><\/script>/);
  assert.match(content, /tsGoalItem: 0, tsBuy: false,/); assert.match(popup, /tsGoalItem: 0, tsBuy: false,/);
  assert.match(content, /if \(await L2V7Modules\.tvtshop\.shopStep\(\)\) \{ await sleep\(200\); continue; \}/);
  assert.match(content, /path === '\/game\/tvt\/shop\/catalog' && tabOwner && Array\.isArray\(d\.res\?\.categories\)\) try \{ L2V7Modules\.tvtshop\.shopNote\(d\.res\); \}/);
  assert.match(content, /if \(tabOwner\) try \{ L2V7Modules\.tvtshop\.shilNote\(\); \} catch \(er\) \{\}/);
  assert.match(mobfarm, /env\.tsChainWant\?\.\(\)/);
  assert.match(html, /<select id="tsGoalItem"/); assert.match(html, /<input id="tsBuy" type="checkbox">/);
  assert.match(popup, /const NUM  = \['enemyLvlAbove', 'tsGoalItem',/); assert.match(popup, /const BOOL = \['sealAuto', 'tsBuy',/); assert.match(popup, /renderMammon\(rt, d\); renderTvtShop\(rt, d\);/);
  console.log('PASS: 10.0 TvT shop — catalog from the game (13 items, ids/prices as snapped 12.10), Shil by the bag with +N in the log, goal plan (wins to go, level 70), buy only with the checkbox / enough coins / level / once, page flow «Купити» → «Придбано», menu wired');
})().catch(e => { console.error(e); process.exit(1); });
