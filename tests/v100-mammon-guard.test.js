'use strict';
// 10.0 (аудит Маммона): защита от повторов и лишних трат — две неудачи улучшения → пауза 6 ч, «не хватает» у кузнеца → по сумке не летим,
// улучшение на несколько уровней за один заход, надетая вещь из двух одинаковых, почта не забирается → не ходим раз в 10 мин,
// письмо не по цели → к кузнецу не летим, остаток партии крафтеру досылается, сам — только при видимом уровне вещи, вещь-цель своя у героя
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('modules/mammon.js');
const card = (name, lvl, btnText) => { const btn = { textContent: btnText, disabled: false };
  const els = { '.l2-mammon-upgrade-card__name': { textContent: name }, '.l2-mammon-upgrade-card__level': { textContent: `Lv.${lvl}` }, '.l2-mammon-upgrade-card__btn': btn };
  return { btn, querySelector: s => els[s] || null }; };
const item = (o = {}) => ({ itemId: 920018, nameUk: 'Пояс першопрохідця', level: 0, max: false, canAfford: true,
  cost: { adena: 250000, adenaOwned: 9e6, coinOfLuck: 1, coinOfLuckOwned: 3, materials: [{ itemId: 1458, nameUk: 'Кристал D', required: 100, owned: 100, enough: true }] }, ...o });
const mk = ({ rt = {}, cfg = {}, inv = {}, path: pn = '/mammon-blacksmith.html', cards = [], lists = [] } = {}) => {
  const recs = [], fired = [], loc = { pathname: pn, href: '' }; let n = 0;
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, location: loc, document: { querySelectorAll: () => cards, getElementById: () => null } };
  sb.globalThis = sb; vm.runInNewContext(src, sb);
  const env = { rt: { mmEq: { belt: [920018, 0] }, ...rt }, cfg: { mmTpMax: 500000, mmGoalItem: 920018, mmGoalLvl: 2, ...cfg }, recs, fired,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, sleep: async () => {}, waitX: async fn => fn(),
    fire: el => { fired.push(el); }, $q: () => null, isBattle: () => false, isFishing: () => false, fishState: () => null, fishNow: () => false,
    autonomyMode: () => 'hunt', tvtSoon: () => false, heroNick: () => 'Warlock', invQty: id => inv[id] ?? null, ITEMS: {}, FARM: { res: {} },
    gameGet: async () => { const items = lists[Math.min(n++, lists.length - 1)]; return { ok: true, status: 200, json: async () => ({ items }) }; } };
  return { env, M: sb.L2V7Factories.mammon(env), loc, fired, recs };
};
const INV = { 57: 9e6, 4037: 3, 1458: 100, 1869: 100, 1876: 100, 1880: 3 };
(async () => {
  // 1. две неудачи на уровне → не летим 6 ч (даже если кузнец недавно писал «хватает»); кнопка игрока — летим
  { const { env, M } = mk({ inv: INV });
    assert.equal(M.want().up, true);
    await M.finish({ kind: 'smith', up: true, id: 'up:920018:0' }, false, 'карточки нет');
    assert.equal(env.rt.mmUpFail.n, 1); env.rt.mmUpT = 0; assert.equal(M.want().up, true, 'one failure: retry after 30 min');
    await M.finish({ kind: 'smith', up: true, id: 'up:920018:0' }, false, 'карточки нет'); env.rt.mmUpT = 0;
    env.rt.mmSmithOk = { id: 920018, lvl: 0, ok: true, t: Date.now() };
    assert.equal(M.want(), null, 'two failures: stop paying for teleports');
    env.rt.mmGoReq = { kind: 'up', t: Date.now() }; assert.equal(M.want().cmd, true, 'player button still goes'); env.rt.mmGoReq = null;
    env.rt.mmUpFail.t = Date.now() - 7 * 3600000; assert.equal(M.want().up, true, 'after 6 h — again');
    await M.finish({ kind: 'smith', up: true, id: 'up:920018:0' }, true, 'ok'); assert.equal(env.rt.mmUpFail, null, 'success resets'); }
  // 2. кузнец недавно ответил «не хватает» на этом уровне (адену видит только он) → по сумке не летим
  { const { env, M } = mk({ inv: INV, rt: { mmSmithOk: { id: 920018, lvl: 0, ok: false, t: Date.now() } } });
    assert.equal(M.want(), null);
    env.rt.mmSmithOk.t = Date.now() - 3 * 3600000; assert.equal(M.want().up, true, 'stale answer — try again'); }
  // 3. уровень вырос, на следующий тоже «хватает» и цель выше → продолжаем в этом же заходе, без телепорта домой
  { const mine0 = card('Пояс першопрохідця', 0, 'Покращити до Lv.1'), mine1 = card('Пояс першопрохідця', 1, 'Покращити до Lv.2');
    const { env, M, fired } = mk({ inv: INV, cards: [mine0, mine1], lists: [[item()], [item({ level: 1 })], [item({ level: 1 })], [item({ level: 2, canAfford: false })]] });
    const J = { kind: 'smith', up: true, step: 'act', home: 'z1', t: Date.now() }; env.rt.mmJob = J;
    await M.smith(J);
    assert.ok(env.rt.mmJob, 'job continues'); assert.equal(env.rt.mmJob.clicked, null); assert.equal(env.rt.mmJob.id, 'up:920018:1'); assert.equal(env.rt.zoneGo, undefined, 'no flight home yet');
    await M.smith(env.rt.mmJob);
    assert.deepEqual(fired, [mine0.btn, mine1.btn]); assert.equal(env.rt.mmJob, null); assert.equal(env.rt.zoneGo.id, 'z1', 'home after the last level'); }
  // 4. две одинаковые вещи — надетая
  { const { M } = mk();
    const it = M.upItem([item({ locationLabelUk: 'У сумці', level: 3 }), item({ locationLabelUk: 'Одягнено', level: 1 })], 920018);
    assert.equal(it.level, 1); }
  // 5. почта не забирается (полный инвентарь) → не ходим раз в 10 мин, пока список вложений тот же; новое письмо — идём
  { const unc = [{ a: '7', s: 'Bob', id: 1, n: 'X', q: 1 }];
    const { env, M } = mk({ cfg: { mmGoalItem: 0, mmCrafter: '' }, rt: { mmMail: { unc } } });
    assert.equal(M.want().kind, 'claim');
    await M.finish({ kind: 'claim', got: [] }, false, 'инвентарь переполнен'); env.rt.mmClaimT = 0;
    assert.equal(M.want(), null, 'same mail — wait');
    env.rt.mmMail = { unc: [...unc, { a: '8', s: 'Bob', id: 2, n: 'Y', q: 1 }] }; assert.equal(M.want().kind, 'claim', 'new mail — go'); }
  // 6. забрал письмо не по цели (не от крафтера, не материал) → к кузнецу не летим
  { const { env, M } = mk({ inv: { ...INV, 1458: 0 }, rt: { mmMail: { unc: [{ a: '1', s: 'Bob', id: 57, n: 'Adena', q: 5 }] } } });
    assert.equal(M.mailNote(), false);
    env.rt.mmMail.unc[0].s = 'Skye'; assert.equal(M.mailNote(), true, 'from the crafter — ask the smith'); }
  // 7. крафтер: остаток партии досылается (3 попытки), сам — только при видимом уровне вещи
  { const { env, M } = mk({ inv: { 1869: 50 }, rt: { mmCraft: { to: 'Skye', at: { 1880: 1 }, t: Date.now() } } });
    await M.finish({ kind: 'send', to: 'Skye', items: [[1869, 50, 'Iron Ore']], done: [['Steel', 1, 0]] }, false, 'строки нет');
    assert.equal(JSON.stringify(env.rt.mmCraft.pend), JSON.stringify([[1869, 50, 'Iron Ore']]));
    assert.equal(M.craftWant(), null, 'not sooner than 30 min');
    env.rt.mmSendT = 0; const w = M.craftWant(); assert.equal(w.kind, 'send'); assert.equal(w.pendJob, true); assert.match(w.why, /досылаю остаток/);
    for (let i = 0; i < 3; i++) await M.finish({ ...w }, false, 'строки нет');
    assert.equal(env.rt.mmCraft.pend, null, 'dropped after 3 tries'); assert.ok(env.recs.some(r => /не ушёл 3 раза/.test(r))); }
  { const { env, M } = mk({ inv: { 1869: 500 }, rt: { mmEq: {} } });
    assert.equal(M.craftWant(), null, 'item level unknown — do not send by itself'); }
  // 7б. цепочка: после победы (страница боя) дело у Маммона есть → chainWant; в бою mmStep не ходит
  { const { env, M } = mk({ inv: INV }); env.isBattle = () => true;
    assert.equal(M.modeFree(), false); assert.equal(M.chainWant()?.up, true, 'victory screen — go');
    env.rt.shop = { t: 1 }; assert.equal(M.chainWant(), null, 'busy with the shop'); }
  // 7в. возврат на точку: перелёт ещё в пути (zonePend) — туда, а не в старую зону
  { const { env, M } = mk({ inv: INV, path: '/map.html', rt: { zone: 'old', zonePend: { id: 'new', t: Date.now() } } });
    assert.equal(await M.mmStep(), true); assert.equal(env.rt.mmJob.home, 'new'); }
  // 8. исходник: смена персонажа сбрасывает вещь-цель, перед «Підтвердити» сообщения очищаются, список кандидатов с паузой, опрос NPC не раз в минуту
  assert.match(read('modules/mobfarm.js'), /if \(!ctx\?\.rb && \(env\.mmChainWant\?\.\(\) \|\| env\.storyChainWant\?\.\(\)(?: \|\| env\.tsChainWant\?\.\(\))?\)\)/);
  assert.match(read('content.js'), /get mmChainWant\(\) \{ return \(\) => L2V7Modules\.mammon\?\.chainWant\?\.\(\); \}/);
  const bg = read('background.js'); assert.match(bg, /nextCfg\.mmGoalItem = ''/);
  assert.match(src, /'item-transfer-success', 'item-transfer-err'\]\) \{ const el = document\.getElementById\(eid\); if \(el\) el\.textContent = ''; \}\s*\n\s*env\.fire\(okBtn\)/);
  assert.match(src, /if \(pg < tp\) await env\.sleep\(350\)/);
  assert.match(src, /now - np\.order\.at < 10 \* 60000 \? 60000 : 5 \* 60000/);
  console.log('PASS: 10.0 Mammon guards — 2 failed upgrades pause 6 h, smith «not enough» beats the bag, several levels in one visit, equipped copy, stuck mail not retried every 10 min, only goal mail calls the smith, crafter remainder resent (3 tries), self-send only with a known item level, goal item per hero');
})().catch(e => { console.error(e); process.exit(1); });
