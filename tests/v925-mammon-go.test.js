'use strict';
// 9.2.5 (игрок 12.10: «добавь кнопку — идти улучшить / выполнить задание у Маммона»): кнопки «📦 Сдать заказ сейчас» и «⬆ Улучшить сейчас»
// (rt.mmGoReq) — разовая команда: летим без автоматических условий, но с проверками игры; невозможное — в журнал и отбой
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const card = (name, lvl, btnText, disabled = false) => { const btn = { textContent: btnText, disabled };
  const els = { '.l2-mammon-upgrade-card__name': { textContent: name }, '.l2-mammon-upgrade-card__level': { textContent: `Lv.${lvl}` }, '.l2-mammon-upgrade-card__btn': btn };
  return { btn, querySelector: s => els[s] || null }; };
const item = (o = {}) => ({ itemId: 920018, nameUk: 'Пояс першопрохідця', level: 0, max: false, canAfford: true, targetInstanceId: 'i1',
  cost: { adena: 250000, adenaOwned: 9e6, coinOfLuck: 1, coinOfLuckOwned: 3, materials: [{ itemId: 1458, nameUk: 'Кристал D', required: 100, owned: 100, enough: true }] }, ...o });
const mk = ({ rt = {}, cfg = {}, inv = {}, path: pn = '/mammon-blacksmith.html', cards = [], lists = [] } = {}) => {
  const recs = [], fired = [], loc = { pathname: pn, href: '' }; let n = 0;
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: loc, document: { querySelectorAll: () => cards } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const env = { rt: { mmEq: { belt: [920018, 0] }, ...rt }, cfg: { mmTpMax: 500000, mmGoalItem: 920018, mmGoalLvl: 2, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: el => { fired.push(el); }, $q: () => null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => inv[id] ?? null, ITEMS: {}, FARM: { res: {} },
    gameGet: async () => { const items = lists[Math.min(n++, lists.length - 1)]; return { ok: true, status: 200, json: async () => ({ items }) }; } };
  return { env, M: sb.L2V7Factories.mammon(env), loc, fired, recs };
};
const INV = { 57: 9e6, 4037: 3, 1458: 100, 1869: 100, 1876: 100, 1880: 3 };
const now = Date.now(), ORDER = { id: 'r1', st: 'OPEN', res: 'Iron Ore', qty: 50, have: 60, exp: now + 3600000, col: 1, adena: 1500000 };
(async () => {
  // 1. сдать заказ по кнопке: галочка «сам» выключена и заказ уже пробовали — всё равно летим; задача закрывает команду
  { const { env, M } = mk({ cfg: { mmOrders: false }, rt: { mmOrder: { ...ORDER }, mmTried: { r1: now }, mmGoReq: { kind: 'order', t: now } } });
    const w = M.want(); assert.equal(w.kind, 'order'); assert.equal(w.cmd, true);
    assert.equal(await M.mmStep(), true); assert.equal(env.rt.mmJob.kind, 'order'); assert.equal(env.rt.mmGoReq, null, 'command consumed'); }
  // 2. ресурса не хватает / заказ закрыт → не летим, причина в журнал и в меню
  { const { env, M, recs } = mk({ rt: { mmOrder: { ...ORDER, have: 10 }, mmGoReq: { kind: 'order', t: now } } });
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmJob, undefined); assert.equal(env.rt.mmGoReq, null);
    assert.match(env.rt.mmGoSay.why, /в сумке 10 — не хватает/); assert.match(recs.join('\n'), /сдать заказ сейчас.*не лечу/); }
  { const { env, M } = mk({ rt: { mmOrder: { ...ORDER, st: 'CLAIMED', win: 'Dremia' }, mmGoReq: { kind: 'order', t: now } } });
    await M.mmStep(); assert.match(env.rt.mmGoSay.why, /забрал Dremia/); }
  // 3. улучшить по кнопке: материалов по сумке не хватает, галочка выключена, недавно не вышло — всё равно летим к кузнецу (там решит «хватает»)
  { const { env, M } = mk({ cfg: { mmUpgrade: false }, inv: { 57: 1000 }, rt: { mmUpT: now, mmGoReq: { kind: 'up', t: now } } });
    const w = M.want(); assert.equal(w.kind, 'smith'); assert.equal(w.up, true); assert.equal(w.cmd, true); assert.match(w.why, /по кнопке: улучшить .* Lv\.0 → 1/);
    assert.equal(await M.mmStep(), true); assert.equal(env.rt.mmJob.cmd, true); assert.equal(env.rt.mmGoReq, null); }
  // у кузнеца: команда игрока проходит «улучшение выключено», но «не хватает» игры по-прежнему останавливает
  { const mine = card('Пояс першопрохідця', 0, 'Покращити до Lv.1');
    const { env, M, fired } = mk({ cfg: { mmUpgrade: false }, cards: [mine], lists: [[item()], [item({ level: 1 })]] });
    const J = { kind: 'smith', up: true, cmd: true, step: 'act', t: Date.now() }; env.rt.mmJob = J;
    await M.smith(J); assert.deepEqual(fired, [mine.btn]); assert.equal(env.rt.mmLog[0].ok, true); }
  { const mine = card('Пояс першопрохідця', 0, 'Покращити до Lv.1');
    const { env, M, fired } = mk({ cards: [mine], lists: [[item({ canAfford: false, cost: { ...item().cost, coinOfLuckOwned: 0 } })]] });
    const J = { kind: 'smith', up: true, cmd: true, step: 'act', t: Date.now() }; env.rt.mmJob = J;
    await M.smith(J); assert.deepEqual(fired, [], 'not affordable — nothing pressed'); assert.match(env.rt.mmLog[0].why, /не хватает Coin of Luck 1/); }
  // 4. цели нет / цель достигнута / команда старше 30 мин → отбой
  { const { env, M } = mk({ cfg: { mmGoalItem: 0 }, rt: { mmGoReq: { kind: 'up', t: now } } }); await M.mmStep(); assert.match(env.rt.mmGoSay.why, /вещь-цель не выбрана/); }
  { const { env, M } = mk({ rt: { mmEq: { belt: [920018, 2] }, mmGoReq: { kind: 'up', t: now } } }); await M.mmStep(); assert.match(env.rt.mmGoSay.why, /уже на уровне цели/); }
  { const { env, M } = mk({ rt: { mmOrder: { ...ORDER }, mmGoReq: { kind: 'order', t: now - 31 * 60000 } } }); await M.mmStep(); assert.match(env.rt.mmGoSay.why, /устарела/); }
  // 5. в бою / в туре РБ — ждём, команда остаётся
  { const { env, M } = mk({ rt: { mmOrder: { ...ORDER }, mmGoReq: { kind: 'order', t: now }, rbSess: { on: true } } });
    assert.equal(await M.mmStep(), false); assert.ok(env.rt.mmGoReq, 'kept until free'); assert.equal(env.rt.mmJob, undefined); }
  // 6. меню: кнопки и команда
  const html = read('popup.html'), pj = read('popup.js');
  assert.match(html, /<button id="mmGoOrder"[^>]*>📦 Сдать заказ сейчас<\/button>/); assert.match(html, /<button id="mmGoUp"[^>]*>⬆ Улучшить сейчас<\/button>/);
  assert.match(pj, /\$\('mmGoOrder'\)\?\.addEventListener\('click', async \(\) => \{ await menuPatch\(\{ mmGoReq: \{ kind: 'order', t: Date\.now\(\) \}, mmGoSay: null \}\)/);
  assert.match(pj, /\$\('mmGoUp'\)\?\.addEventListener\('click', async \(\) => \{ await menuPatch\(\{ mmGoReq: \{ kind: 'up', t: Date\.now\(\) \}, mmGoSay: null \}\)/);
  console.log('PASS: 9.2.5 Mammon buttons — «hand in the order now» / «upgrade now» go at once (no auto conditions), game checks still apply, impossible commands dropped with a reason, wait while busy');
})().catch(e => { console.error(e); process.exit(1); });
