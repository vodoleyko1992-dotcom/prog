'use strict';
// 9.2.5 (игрок 12.10: «полностью разрешаю функцию прокачки ЛВЛ вещей, выбранных в настройках у мамона, не смотря на цену в колах»):
// всё на следующий уровень вещи-цели собрано → поход к кузнецу → «Покращити до Lv.N» на его странице (одна вещь, один уровень, до цели)
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
(async () => {
  // 1. всё собрано → want() зовёт к кузнецу улучшать; выключено / нет Coin of Luck / нет адены / недавно не вышло / цель достигнута — нет
  { const { env, M } = mk({ inv: INV });
    assert.equal(M.goalPlan().ready, true);
    const w = M.want(); assert.equal(w.kind, 'smith'); assert.equal(w.up, true); assert.match(w.why, /улучшить .* Lv\.0 → 1/);
    env.cfg.mmUpgrade = false; assert.equal(M.want(), null, 'switched off'); env.cfg.mmUpgrade = true;
    INV[4037] = 0; assert.equal(M.want(), null, 'no Coin of Luck'); INV[4037] = 3;
    INV[57] = 1000; assert.equal(M.want(), null, 'no adena'); INV[57] = 9e6;
    env.rt.mmUpT = Date.now(); assert.equal(M.want(), null, 'failed recently'); env.rt.mmUpT = 0;
    env.rt.mmEq = { belt: [920018, 2] }; assert.equal(M.want(), null, 'goal Lv.2 reached'); }
  // 2. на странице кузнеца: жмёт кнопку своей вещи (не соседней), один раз; уровень вырос → ✓, mmJob закрыт, журнал с ценой в Coin of Luck
  { const other = card('Плащ', 0, 'Покращити до Lv.1'), mine = card('Пояс першопрохідця', 0, 'Покращити до Lv.1');
    const { env, M, fired, recs } = mk({ inv: INV, cards: [other, mine], lists: [[item()], [item({ level: 1 })]] });
    const J = { kind: 'smith', up: true, step: 'act', t: Date.now() }; env.rt.mmJob = J;
    await M.smith(J);
    assert.deepEqual(fired, [mine.btn], 'clicked own card only');
    assert.equal(env.rt.mmJob, null); assert.equal(env.rt.mmLog[0].ok, true); assert.match(env.rt.mmLog[0].why, /Lv\.0 → Lv\.1 \(250.000 адены, 1 Coin of Luck\)/);
    assert.ok(recs.some(r => /жму «Покращити до Lv\.1»/.test(r))); assert.equal(env.rt.mmUpT, 0); }
  // 3. не на странице кузнеца → переход туда, без клика
  { const { M, loc, fired } = mk({ inv: INV, path: '/map.html', lists: [[item()]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now() });
    assert.equal(loc.href, '/mammon-blacksmith.html'); assert.equal(fired.length, 0); }
  // 4. игра пишет «не хватает» → не жмём, называем, чего нет; повтор не раньше 30 мин
  { const { env, M, fired } = mk({ inv: INV, cards: [card('Пояс першопрохідця', 0, 'Покращити до Lv.1', true)],
      lists: [[item({ canAfford: false, cost: { adena: 250000, adenaOwned: 9e6, coinOfLuck: 2, coinOfLuckOwned: 1, materials: [{ nameUk: 'Сталь', required: 3, owned: 1, enough: false }] } })]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now() });
    assert.equal(fired.length, 0); assert.match(env.rt.mmLog[0].why, /не хватает Coin of Luck 1, Сталь 2/); assert.ok(env.rt.mmUpT > 0); }
  // 5. уровень уже цель / вещи нет у кузнеца / кнопка недоступна → без клика
  { const { env, M, fired } = mk({ inv: INV, cards: [card('Пояс першопрохідця', 2, 'Покращити до Lv.3')], lists: [[item({ level: 2 })]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now() });
    assert.equal(fired.length, 0); assert.equal(env.rt.mmLog[0].ok, true); assert.match(env.rt.mmLog[0].why, /цель Lv\.2 достигнута/); }
  { const { env, M, fired } = mk({ inv: INV, lists: [[item({ itemId: 1 })]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now() }); assert.equal(fired.length, 0); assert.match(env.rt.mmLog[0].why, /вещи-цели нет/); }
  { const { env, M, fired } = mk({ inv: INV, cards: [card('Пояс першопрохідця', 0, 'Покращити до Lv.1', true)], lists: [[item()]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now() }); assert.equal(fired.length, 0); assert.match(env.rt.mmLog[0].why, /недоступна/); }
  // 6. клик был, уровень не подтвердился → следующий круг: вырос → ✓ без второго клика; не вырос после 2 попыток → ✗
  { const mine = card('Пояс першопрохідця', 0, 'Покращити до Lv.1');
    const { env, M, fired } = mk({ inv: INV, cards: [mine], lists: [[item()], [item()], [item({ level: 1 })]] });
    const J = { kind: 'smith', up: true, step: 'act', t: Date.now() }; env.rt.mmJob = J;
    await M.smith(J); assert.equal(fired.length, 1); assert.equal(env.rt.mmJob.clicked, 0, 'click remembered before the check');
    await M.smith(env.rt.mmJob); assert.equal(fired.length, 1, 'no second click'); assert.equal(env.rt.mmLog[0].ok, true); }
  { const mine = card('Пояс першопрохідця', 0, 'Покращити до Lv.1');
    const { env, M, fired } = mk({ inv: INV, cards: [mine], lists: [[item()]] });
    await M.smith({ kind: 'smith', up: true, step: 'act', t: Date.now(), clicked: 0, tries: 2 });
    assert.equal(fired.length, 0); assert.equal(env.rt.mmLog[0].ok, false); assert.match(env.rt.mmLog[0].why, /не вырос/); }
  // 7. меню и настройки: галочка, по умолчанию ВКЛ
  const html = read('popup.html'), pj = read('popup.js'), c = read('content.js');
  assert.ok(html.includes('id="mmUpgrade"')); assert.match(pj, /'mmSmithAuto', 'mmUpgrade'/); assert.match(pj, /mmSmithAuto: true, mmUpgrade: true/); assert.match(c, /mmSmithAuto: true, mmUpgrade: true/);
  const hk = read('hook.js');
  assert.match(hk, /location\.pathname === '\/mammon-blacksmith\.html'[\s\S]{0,200}window\.confirm = function/, 'confirm() only on the smith page');
  assert.match(hk, /Date\.now\(\) - t < 5000\) \{ delete h\.dataset\.l2botConfirm/, 'yes only right after the bot click, once');
  assert.match(src, /document\.documentElement\.dataset\.l2botConfirm = String\(Date\.now\(\)\)[^\n]*\n\s*env\.fire\(btn\)/);
  console.log('PASS: 9.2.5 Mammon smith — goal item upgraded by the «Покращити» button when everything is collected (Coin of Luck allowed), own card only, one click, verified; off/short/goal reached → no click');
})().catch(e => { console.error(e); process.exit(1); });
