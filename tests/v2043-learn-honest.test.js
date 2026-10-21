'use strict';
// 20.43 (разбор 21.10): честные замеры —
// 1) шанс FA за бой из своих замеров класса (rt.faRate), а не из константы 1 % (цена чемпиона, «Cancel», окупаемость оранжевого, faChance);
// 2) паузы между боями (служебный маршрут, страница вне охоты, Стоп/Старт, РБ) не записываются как «время на моба», вклад одного боя ≤ 3×
//    обычного времени на такую награду; кнопка «Сбросить замеры охоты» (mobVal, zoneStat, eff);
// 3) бои в катакомбах — своя корзина rt.eff.cat, без zoneStat прошлой зоны и без общих «цепочка/карта»;
// 4) иммунитет к дебаффам у мобов/чемпионов — по виду цели и на сутки, РБ — общий флаг; миграция снимает старые общие флаги.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const core = require('../engine-core.js');
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, `${msg || ''}: ${a} ≈ ${b}`);
const plain = x => JSON.parse(JSON.stringify(x));
// модуль в песочнице вместе с engine-core (как в content_scripts: engine-core раньше модулей)
const loadMod = (file, env, withCore = true) => { const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, URLSearchParams, CSS: { escape: s => s },
  document: { querySelectorAll: () => [], querySelector: () => null, prerendering: false }, location: { href: '', search: '', pathname: '/battle.html' } }; sb.globalThis = sb;
  if (withCore) vm.runInNewContext(read('engine-core.js'), sb);
  vm.runInNewContext(read(file), sb); return sb.L2V7Factories[path.basename(file, '.js')](env); };

(async () => {
  // ---------- 1. FA: чистая формула ----------
  assert.equal(core.faRate(null, 'mob'), 0.01); assert.equal(core.faRate(undefined, 'red'), 0.6); assert.equal(core.faRate({}, 'orange'), 0.2); assert.equal(core.faRate({}, 'blue'), 0.1);
  assert.equal(core.faRate({}, 'что-то'), 0.1, 'неизвестный вид — как синий');
  // ночной лог alt2 Warlord 48: обычным боям ≥ 22 FA на 554 боя
  const W = { k: { mob: 554, blue: 8, orange: 6, red: 4 }, f: { mob: 22, blue: 2, orange: 1, red: 3 } };
  near(core.faRate(W, 'mob'), (22 + 0.01 * 100) / (554 + 100), 1e-12, 'mob: (FA + анонс × 100) / (боёв + 100)');
  near(core.faRate(W, 'red'), (3 + 0.6 * 30) / (4 + 30), 1e-12, 'red: N0 = 30');
  assert.ok(core.faRate(W, 'mob') > 0.035, 'Warlord: ≈3,5 % за обычный бой вместо 1 %');
  assert.equal(core.faRate({ k: { mob: 1000 }, f: {} }, 'mob'), 0.01, 'обычный бой не ниже анонса 1 % (нераспознанные строки FA — как раньше)');
  near(core.faRate({ k: { red: 30 }, f: {} }, 'red'), 0.3, 1e-12, 'чемпион: замер может опустить и ниже анонса (сглажено N0 = 30)');
  assert.equal(core.faClass('human_warlock'), 'warlock'); assert.equal(core.faClass('Warlock'), 'warlock');
  assert.equal(core.faClass('dark_elf_spellhowler'), 'spellhowler'); assert.equal(core.faClass('dwarf_bounty_hunter'), 'bounty hunter'); assert.equal(core.faClass(''), '?');
  console.log('PASS: faRate — свой шанс FA за бой, сглаженный анонсом (N0 100/30), обычный бой не ниже 1 %; ключ класса без расы');

  // ---------- 2. FA: учёт по классу (loot.faRateNote / trackLoot) ----------
  const recs = [], lenv = { cfg: {}, rt: { lvl: 48, char: 'Alt2', prof: 'Warlord', classCur: { prof: 'human_warlord' } }, heroLvl: () => 48, LOOT_RE: /^(.+?)\s*×\s*(\d+)$/, SPECIAL_RE: /^\s*$x^/,
    rec: (...a) => recs.push(a.join(' | ')), tabOwner: true, leaseEpoch: 1, itemsDb: async () => {}, itemOf: () => null, recipeKey: s => String(s || '').toLowerCase(), setRt: async p => Object.assign(lenv.rt, p) };
  const lt = loadMod('modules/loot.js', lenv);
  let R = lt.faRateNote(['Fast Aden ×2', 'Coal ×1'], { champ: false, tier: '', lvl: 48 });
  assert.deepEqual(plain(R.warlord.k), { mob: 1 }); assert.deepEqual(plain(R.warlord.f), { mob: 2 });
  lenv.rt.faRate = R;
  assert.equal(lt.faRateNote(['Fast Aden ×1'], { champ: false, lvl: 40 }), null, 'ниже героя −5 — FA не падает, бой не считаем');
  assert.equal(lt.faRateNote(['Fast Aden ×1'], null), null, 'РБ — не считаем');
  R = lt.faRateNote(['Coal ×1'], { champ: true, tier: 'red', lvl: 50 }); lenv.rt.faRate = R;
  assert.deepEqual(plain(R.warlord.k), { mob: 1, red: 1 });
  lenv.rt.classCur = { prof: 'dwarf_bounty_hunter' };
  R = lt.faRateNote(['Fast Aden ×1'], { champ: false, lvl: 48 });
  assert.deepEqual(plain(R['bounty hunter'].k), { mob: 1 }); assert.deepEqual(plain(R.warlord.k), { mob: 1, red: 1 }, 'другой класс — своя строка, прежняя не меняется');
  lenv.rt.classCur = { prof: 'human_warlord' }; lenv.rt.faDrop = { t0: 1, k: { mob: 5 }, f: { mob: 1 } };
  await lt.trackLoot(['Fast Aden ×1'], 'Ogre', { champ: false, tier: '', lvl: 49 });
  assert.deepEqual(plain(lenv.rt.faDrop.k), { mob: 6 }, 'rt.faDrop — общий, как раньше (сумму сверяют buffs/raid с балансом FA)');
  assert.deepEqual(plain(lenv.rt.faRate.warlord.k), { mob: 2, red: 1 }); assert.equal(lenv.rt.faRate.warlord.f.mob, 3);
  assert.doesNotMatch(read('modules/story.js').match(/const CLASS_KEYS = \[[\s\S]*?\];/)[0], /'faDrop'|'faRate'/, 'faDrop/faRate не уходят в classStash (класс — ключ внутри rt.faRate)');
  assert.match(read('content.js'), /const RT_STAT_SOON = new Set\(\[[\s\S]*'faRate'[\s\S]*\]\);/, 'faRate пишется отложенно вместе с остальной статистикой боя');
  console.log('PASS: FA за бой считается по классу (rt.faRate[класс]), rt.faDrop остаётся общим');

  // ---------- 3. FA: цена чемпиона, «Cancel», окупаемость, faChance ----------
  const cenv = { cfg: { champCancel: 'paid' }, rt: { char: 'Alt2', prof: 'Warlord', classCur: { prof: 'human_warlord' }, lvl: 48 }, heroLvl: () => 48, combatContext: () => null,
    farmRate: () => ({ eps: 5600, sk: 1.5 }), faPaidLeft: () => 6, setRt: async p => Object.assign(cenv.rt, p), rec() {} };
  const ch = loadMod('modules/champs.js', cenv);
  const red = { tier: 'red', lvl: 50, exp: 250000 };
  const lim0 = ch.limitS(red), cc0 = ch.cancelCost(red, 50);
  assert.equal(lim0, Math.round(250000 / 5600 + 0.6 * 1.5 / 0.01), 'без замеров — анонс (1 %), как раньше');
  cenv.rt.faRate = { warlord: W };
  const pm = core.faRate(W, 'mob'), pr = core.faRate(W, 'red');
  assert.equal(ch.faRate('mob'), pm); assert.equal(ch.faRate('red'), pr); assert.equal(ch.faRate(''), core.faRate(W, 'blue'));
  const lim1 = ch.limitS(red), cc1 = ch.cancelCost(red, 50);
  assert.equal(lim1, Math.round(250000 / 5600 + pr * 1.5 / pm), 'предел красного — по своим шансам красного и обычного боя');
  assert.ok(lim1 < lim0 / 1.5, `Warlord: красный стоит меньше секунд фарма (${lim1} с против ${lim0} с)`);
  assert.equal(ch.limitS({ ...red, fa: 0 }), Math.round(250000 / 5600), 'c.fa = 0 (ниже героя −5) — только EXP');
  assert.equal(cc1.s, Math.round(cc1.buffs * 1.5 / pm), 'Cancel: 1 FA = время на бой ÷ свой шанс');
  assert.ok(cc1.s < cc0.s / 2 && cc1.buffs === cc0.buffs, 'снятые баффы те же, их цена ниже');
  const orange = { tier: 'orange', lvl: 50, exp: 120000, hp: 60000 };
  cenv.rt.champLearn = {}; cenv.combatContext = () => 'ctx1'; cenv.rt.champLearn = { cohorts: { ctx1: { base: { dps: 2000, n: 20 }, dps: { dps: 3000 } } } };
  const vj = ch.valueJudge(orange);
  assert.match(vj.why, new RegExp(`награда ≈${Math.round(Math.min(300, 120000 / 5600 + core.faRate(W, 'orange') * 1.5 / pm))} с`), 'окупаемость оранжевого — по своим шансам');
  cenv.rt.classCur = { prof: 'human_warlock' }; cenv.rt.prof = 'Warlock';
  assert.equal(ch.faRate('mob'), 0.01, 'у другого класса (Warlock, одиночные цели) замеров нет — остаётся ≈1 %');
  const noCore = loadMod('modules/champs.js', cenv, false);
  assert.equal(noCore.limitS(red), lim0, 'без engine-core — прежние цифры анонса');
  // mobfarm.faChance: свой шанс; порог «FA-чемпион первым» — по цвету
  const menv = { cfg: { priority: '[квест]\n[чемп]\n[все]', searchChamp: false, searchQuest: true, champFa: true, lvlBelow: 5, lvlAbove: 6, lvlMin: 1, lvlMax: 99 }, rt: { spawns: {}, lvl: 66 }, PAGE_SIZE: 15, NET_SPAWNS: null,
    heroLvl: () => 66, isRaidId: id => /^l2dop_rb_/.test(id), isBoss: () => false, isQuestName: (n, q) => (q || []).includes(n), campActive: () => false, campChampOpen: () => false, campChampMin: () => 0, campMobOpen: () => [],
    farmRules: () => [], recipeRules: () => [], rec() {}, setRt: async p => Object.assign(menv.rt, p),
    champs: { faRate: k => ({ mob: 0.05, blue: 0.04, orange: 0.08, red: 0.3 })[k], tierOff: () => null, held: () => null, judge: () => ({ ok: true, lim: 100 }), valueMode: () => false } };
  const mf = loadMod('modules/mobfarm.js', menv);
  assert.equal(mf.faChance(false, '', 66, 66), 0.05, 'обычный бой — свой шанс класса');
  assert.equal(mf.faChance(true, 'red', 66, 66), 0.3); assert.equal(mf.faChance(true, 'зелёный', 66, 66), 0.04, 'неизвестный цвет — как синий');
  assert.equal(mf.faChance(true, 'red', 60, 66), 0, 'ниже героя −5 — 0, как раньше');
  await mf.netSpawns([['dense_1', 'aggressive', 'Kookaburra', 67, 100, ''], ['dense_2', 'champion', 'Buffalo', 66, 200, 'blue'],
    ['champ_o_wbp_0', 'champion', 'Buffalo', 66, 300, 'orange'], ['champ_r_wbp_0', 'champion', 'Kookaburra', 67, 400, 'red']]);
  const cand = mf.candidates(mf.parseRules(), { ids: ['dense_1', 'dense_2', 'champ_o_wbp_0', 'champ_r_wbp_0'], quest: [] }, menv.NET_SPAWNS.kind, 99);
  assert.deepEqual(plain(cand.slice(0, 2).map(x => x.id)), ['champ_r_wbp_0', 'champ_o_wbp_0'], 'красный, потом оранжевый — по цвету, хотя свой шанс оранжевого 8 % < порога 20 %');
  assert.ok(cand.find(x => x.id === 'champ_o_wbp_0').faHot && !cand.find(x => x.id === 'dense_2').faHot);
  assert.equal(cand.find(x => x.id === 'champ_o_wbp_0').fa, 0.08, 'r.fa — свой замер (для цены чемпиона)');
  console.log('PASS: limitS/cancelCost/valueJudge/faChance — по своему шансу FA класса; без замеров и у Warlock — ≈1 %; порядок FA-чемпионов — по цвету');

  // ---------- 4. паузы, предел вклада боя, катакомбы (настоящий trackEfficiency ядра) ----------
  const mfst = JSON.parse(read('manifest.json'));
  const mkContent = ({ pathname = '/battle.html', search = '', store = {} } = {}) => {
    const ss = { getItem: k => Object.hasOwn(store, k) ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const el = () => ({ style: {}, dataset: {}, append() {}, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
    const ctx = vm.createContext({ addEventListener() {}, removeEventListener() {}, console: { log() {}, warn() {}, error() {}, info() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Math,
      crypto: { randomUUID: () => 'x' }, sessionStorage: ss, localStorage: ss, navigator: { userAgent: 'Chrome' },
      location: { pathname, search, href: 'https://l2wap.com' + pathname + search, origin: 'https://l2wap.com' }, window: { addEventListener() {}, innerWidth: 1080 },
      document: { visibilityState: 'visible', prerendering: false, createElement: el, addEventListener() {}, querySelector: s => s === '#l2-hud-legacy-lvl' ? { textContent: '48' } : null, querySelectorAll() { return []; },
        getElementsByTagName() { return []; }, hasFocus() { return true; }, documentElement: { className: '', clientWidth: 1024, append() {} }, body: { className: '', querySelector() { return null; } } },
      chrome: { runtime: { sendMessage: async () => null, onMessage: { addListener() {} }, getManifest: () => mfst, getURL: s => s }, storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}), set: async () => {} } } } });
    ctx.window.window = ctx.window;
    for (const s of mfst.content_scripts.find(x => x.js.includes('content.js')).js) vm.runInContext(read(s), ctx);
    return { ctx, store, run: code => vm.runInContext(code, ctx) };
  };
  const H = mkContent();
  const win = async (state, exp, c) => {
    H.run(`cfg = mergeCfg({}); rt = { ...DEF_RT, ...${JSON.stringify(state)} }`); H.ctx.__c = c;
    await Promise.race([H.run(`trackEfficiency(${exp}, __c)`), new Promise(r => setTimeout(r, 300))]);
    return plain(H.run('rt'));
  };
  const t0 = Date.now(), zone = { zone: 'out:test', zoneStat: { 'out:test': { 48: { n: 10, exp: 50000, sec: 40, pct: 0, pn: 0 } } } };
  let r = await win({ ...zone, lastWinT: t0 - 4000, via: 'chain' }, 5000, { name: 'Probe Mob', champ: false });
  assert.equal(r.mobVal['probe mob'].n, 1); near(r.mobVal['probe mob'].sec, 4, 0.3, 'обычная победа в цепочке меряется');
  assert.equal(r.zoneStat['out:test'][48].n, 11); assert.equal(r.eff.chain.n, 1);
  // служебный поход/страница вне охоты после прошлой победы (метка вкладки)
  H.store['l2bot-huntGapT'] = String(t0 - 2000);
  r = await win({ ...zone, lastWinT: t0 - 4000, via: 'chain' }, 5000, { name: 'Probe Mob', champ: false });
  assert.equal(r.mobVal, undefined, 'после страницы вне охоты бой не меряется (mobVal)'); assert.equal(r.zoneStat['out:test'][48].n, 10, '… и zoneStat'); assert.equal(r.eff, undefined, '… и rt.eff');
  assert.ok(r.lastWinT >= t0, 'но эта победа — новая точка отсчёта');
  delete H.store['l2bot-huntGapT'];
  // Старт/Продолжить после паузы/Стопа (manualKickAt новее прошлой победы)
  r = await win({ ...zone, lastWinT: t0 - 30000, manualKickAt: t0 - 10000, via: 'chain' }, 5000, { name: 'Probe Mob', champ: false });
  assert.equal(r.mobVal, undefined, 'Стоп → Старт за 30 с: разрыв не записан как время на моба'); assert.equal(r.zoneStat['out:test'][48].n, 10);
  // РБ: следующий моб — с нуля
  r = await win({ ...zone, lastWinT: t0 - 4000, via: 'chain' }, 90000, { name: 'Boss', rb: true });
  assert.equal(r.lastWinT, 0, 'после РБ lastWinT = 0'); assert.equal(r.mobVal, undefined);
  // предел вклада одного боя: 30 боёв по 3 с, один разрыв 60 с
  const V30 = { 'probe mob': { n: 30, exp: 150000, sec: 90, t: t0 } };
  r = await win({ ...zone, lastWinT: t0 - 60000, via: 'chain', mobVal: V30 }, 5000, { name: 'Probe Mob', champ: false });
  near(r.mobVal['probe mob'].sec, 90 * 29 / 30 + 9, 0.3, 'разрыв 60 с → вклад 9 с (3 × 3 с), EXP/с вида почти прежний');
  near(r.zoneStat['out:test'][48].sec, 40 + 9, 0.3, 'зона — тоже 9 с'); near(r.eff.chain.sec, 9, 0.3, 'темп цепочки — тоже');
  assert.ok(r.mobVal['probe mob'].exp / r.mobVal['probe mob'].sec > 0.9 * 150000 / 90, 'вид не выпадает с карты по c.low из-за одного разрыва');
  // пачка агро: ×4 EXP за ×4 времени — не обрезается
  r = await win({ ...zone, lastWinT: t0 - 12000, via: 'chain', mobVal: V30 }, 20000, { name: 'Probe Mob', champ: false });
  near(r.mobVal['probe mob'].sec, 90 * 29 / 30 + 12, 0.3, 'пачка: 12 с при ×4 EXP — честное время');
  // новый вид: предел по способу прихода (rt.eff.map ≥ 5 боёв)
  r = await win({ ...zone, lastWinT: t0 - 100000, via: 'map', eff: { map: { n: 50, sec: 11, rate: 27000 } } }, 5000, { name: 'Fresh Mob', champ: false });
  near(r.eff.map.sec, 11 * 0.95 + 3 * 11.111 * 0.05, 0.05, 'новый вид через карту: 100 с → ≤ 3 × 11 с');
  near(r.mobVal['fresh mob'].sec, 33.33 - 11, 0.1, 'mobVal: предел минус дорога картой');
  r = await win({ ...zone, lastWinT: t0 - 100000, via: 'map' }, 5000, { name: 'Fresh Mob', champ: false });
  near(r.mobVal['fresh mob'].sec, 100, 0.3, 'ни вида, ни темпа ещё нет — только прежний предел 180 с');
  // катакомбы: своя корзина eff.cat, без zoneStat прошлой зоны и без общих «цепочка/карта»
  const effOld = { chain: { n: 40, rate: 9000, sec: 5 }, map: { n: 40, rate: 6000, sec: 11 } };
  r = await win({ ...zone, lastWinT: t0 - 6000, via: 'chain', eff: effOld }, 7000, { name: 'Lith Warrior', champ: false, spawnId: 'sdms_necropolis_of_sacrifice_003' });
  assert.deepEqual(r.zoneStat, zone.zoneStat, 'бой в подземелье не пишется в zoneStat прошлой зоны');
  assert.deepEqual(r.eff.chain, effOld.chain); assert.deepEqual(r.eff.map, effOld.map); assert.equal(r.eff.cat.n, 1); near(r.eff.cat.sec, 6, 0.3);
  assert.equal(r.zone, 'out:test', 'rt.zone не меняется'); assert.equal(r.mobVal['lith warrior'].n, 1, 'ценность вида по-прежнему считается');
  r = await win({ ...zone, lastWinT: t0 - 6000, via: 'dungeon', eff: effOld }, 7000, { name: 'Lith Warrior', champ: false });
  assert.deepEqual(r.eff.map, effOld.map, 'выбор из списка подземелья — не «карта»'); assert.equal(r.eff.cat.n, 1); assert.deepEqual(r.zoneStat, zone.zoneStat);
  const HC = mkContent({ search: '?spawnId=sdms_necropolis_of_sacrifice_007' });
  HC.run(`cfg = mergeCfg({}); rt = { ...DEF_RT, ...${JSON.stringify({ ...zone, lastWinT: t0 - 6000, via: 'chain', eff: effOld })} }`); HC.ctx.__c = { name: 'Lith Archer', champ: false };
  await Promise.race([HC.run('trackEfficiency(7000, __c)'), new Promise(res => setTimeout(res, 300))]);
  r = plain(HC.run('rt')); assert.deepEqual(r.eff.chain, effOld.chain, 'цепочка «Охотиться дальше» в подземелье (адрес sdms_*) — в eff.cat'); assert.equal(r.eff.cat.n, 1); assert.deepEqual(r.zoneStat, zone.zoneStat);
  // метка разрыва ставится на любой странице вне охоты и не ставится на страницах охоты
  for (const p of ['/gm-shop.html', '/fishing.html', '/town-buffer.html', '/teleport.html', '/city.html', '/mammon-merchant-loc.html', '/char.html'])
    assert.ok(+mkContent({ pathname: p }).store['l2bot-huntGapT'] > 0, `${p}: метка разрыва`);
  for (const p of ['/battle.html', '/map.html', '/dungeon.html', '/catacombs.html', '/ashen-bastion.html'])
    assert.equal(mkContent({ pathname: p }).store['l2bot-huntGapT'], undefined, `${p}: страница охоты — без метки`);
  console.log('PASS: паузы (страница вне охоты, Старт после Стопа, РБ) не попадают в замеры; вклад боя ≤ 3× обычного по награде; катакомбы — eff.cat без zoneStat');

  // ---------- 5. служебный маршрут обнуляет lastWinT (actions) ----------
  { const box = { Date, JSON, Object, Proxy }; vm.runInNewContext(read('modules/actions.js'), box);
    const aenv = { rt: { char: 'Hero', lastWinT: 12345, shop: { step: 'count' } }, cfg: {}, on: true, tabOwner: true, mode: () => 'farm', lease: () => 'a', page: () => '/map.html', id: () => 'o1',
      setRt: async p => { Object.assign(aenv.rt, p); return { ok: true }; }, rtCommit: async () => true, rec() {}, setStatus() {}, halt: async () => {}, isBattle: () => false, interrupted: () => false,
      paymentPending: () => null, reconcile: async () => {}, jobs: () => [{ key: 'shop', run: async () => {} }] };
    const A = box.L2V7Factories.actions(aenv); A.enterFrame(); await A.dispatch();
    assert.equal(aenv.rt.actionOwner?.key, 'shop'); assert.equal(aenv.rt.lastWinT, 0, 'новый владелец маршрута (магазин) — прошлую победу забыли');
    aenv.rt.lastWinT = 777; aenv.rt.shop = { step: 'buy' };
    await A.dispatch(); assert.equal(aenv.rt.actionOwner?.key, 'shop'); assert.equal(aenv.rt.lastWinT, 777, 'продолжение того же маршрута lastWinT не трогает'); }
  console.log('PASS: старт служебного маршрута (actions.dispatch) обнуляет lastWinT той же записью');

  // ---------- 6. меню: «Сбросить замеры охоты», строки FA/катакомб/иммунитета ----------
  const html = read('popup.html'), popup = read('popup.js');
  const hunt = html.slice(html.indexOf('<section id="tab-hunt">'), html.indexOf('</section>', html.indexOf('<section id="tab-hunt">')));
  assert.match(hunt, /<button id="huntStatReset"[^>]*>↺ Сбросить замеры охоты<\/button>/, 'кнопка — в разделе «Охота»');
  assert.match(popup, /confirmClick\('huntStatReset', async \(\) => \{\s*try \{ await menuPatch\(\{ mobVal: \{\}, zoneStat: \{\}, eff: \{\}, lastWinT: 0 \}\)/, 'подтверждение вторым нажатием, сброс трёх замеров');
  for (const k of ['mobVal', 'zoneStat', 'eff', 'lastWinT']) assert.ok(core.MENU_STAT_KEYS.includes(k), `${k}: отложенная запись вкладки не воскрешает сброс`);
  const panel = html.slice(html.indexOf('<section id="tab-panel">'), html.indexOf('</section>', html.indexOf('<section id="tab-panel">')));
  assert.match(panel, /id="debuffImmBox"/, 'список видов с иммунитетом — в «Бой и класс»');
  const pb = { L2EngineCore: core, Date, Math, Object, String, Number, JSON, $: () => null }; pb.globalThis = pb;
  vm.runInNewContext(popup.slice(popup.indexOf('function faRateText(rt)'), popup.indexOf('function renderFaDrop(rt)')), pb);
  assert.match(pb.faRateText({ classCur: { prof: 'human_warlord' }, faRate: { warlord: W } }), /^Цена чемпионов считается по: обычный бой 3,5 %, синий [\d,]+ %, оранжевый [\d,]+ %, красный [\d,]+ % \(свои замеры класса «warlord»: 572 боёв/);
  assert.match(pb.faRateText({ prof: 'Warlock' }), /обычный бой 1,0 %.*по анонсу — своих замеров у класса ещё нет/);
  const now = Date.now(), it = pb.debuffImmText({ rb: 1, sp: { 'foo mob': now - 3600000, 'ч:bar champ': now - 25 * 3600000 } });
  assert.match(it, /рейд-боссы — да/); assert.match(it, /· foo mob: не вешаю ещё ≈23 ч/); assert.match(it, /· bar champ \(чемпион\): сутки прошли — в следующем бою одна проба/);
  assert.match(pb.debuffImmText({ rb: 1, mob: 5, champ: 6 }), /невосприимчивых видов не встречал/, 'старые общие флаги в меню не показываются как действующие');
  assert.match(popup, /line\('🏛 Катакомбы \(отдельно, 20\.43\)', E\.cat\)/, '«Эффективность» показывает катакомбы отдельно');
  console.log('PASS: меню — кнопка сброса замеров в «Охоте», шанс FA для цены чемпионов, катакомбы отдельно, виды с иммунитетом в «Бой и класс»');

  // ---------- 7. иммунитет к дебаффам: по виду и со сроком ----------
  const mk = (title, cd, il) => ({ title, cd, il, kind: 'скилл', disabled: false, className: '', getAttribute(k) { return k === 'aria-disabled' ? null : k === 'data-slot-cd' ? this.cd : null; } });
  const slots = [mk('Blaze', 'l2_1220', { c: 'Маг. атака', t: 'MDAM' }), mk('Curse Chaos', 'l2_1222', { c: 'Дебафф', t: 'DEBUFF', st: 'mDefDown', st2: 'pAtkDown', dur: 15 })];
  const sb = { document: { querySelectorAll: () => slots, querySelector: () => null }, console, Date }; sb.globalThis = sb;
  vm.runInNewContext(read('modules/combat.js'), sb);
  const denv = { SLOT: '.slot', cfg: {}, rt: { skills: { blaze: { dmg: 1600, dmgN: 2 } } }, combatProfileKind: () => 'mage_summoner',
    $q: s => s === '#battle-mob-hp-val' ? { textContent: '9000 / 9000' } : null, shown: () => false, cleanTitle: s => s, slotKind: b => b.kind, isEquip: () => false,
    ilOf: b => typeof b === 'string' ? slots.find(x => x.title.toLowerCase() === b.toLowerCase())?.il : b.il, slotCd: () => null, memLeft: () => 0, slotAction: b => b.cd, combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 'x',
    skKey: b => b.title.toLowerCase(), names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), skillMp: () => 20, setRt: async p => Object.assign(denv.rt, p), rec() {} };
  const C = sb.L2V7Factories.combat(denv), mp = { cur: 1500, max: 2000 }, me = { pct: 100 };
  assert.equal(C.debuffPlan({ block: {}, name: 'Bar' }, mp, me)?.n, 'Curse Chaos', 'долгий бой — дебафф');
  denv.rt.debuffImmune = { sp: { foo: Date.now() - 3600000 } };
  assert.equal(C.debuffPlan({ block: {}, name: 'Foo' }, mp, me), null, 'иммунный вид Foo — не вешаем');
  assert.equal(C.debuffPlan({ block: {}, name: 'Bar' }, mp, me)?.n, 'Curse Chaos', 'иммунитет Foo не мешает дебаффу на Bar');
  const champCtx = name => ({ block: {}, name, champ: true, spellDmg: { blaze: { off: [1800, 2], on: [0, 0] } } });   // у чемпиона без замера выгоды — сперва 2 заклинания
  assert.equal(C.debuffPlan(champCtx('Foo'), mp, me)?.n, 'Curse Chaos', 'чемпион Foo — отдельный вид');
  denv.rt.debuffImmune = { sp: { foo: Date.now() - 25 * 3600000 } };
  assert.equal(C.debuffPlan({ block: {}, name: 'Foo' }, mp, me)?.n, 'Curse Chaos', 'сутки прошли — одна проба');
  denv.rt.debuffImmune = { mob: Date.now(), champ: Date.now() };
  assert.equal(C.debuffPlan({ block: {}, name: 'Bar' }, mp, me)?.n, 'Curse Chaos', 'старый общий флаг .mob больше не выключает дебаффы на всех');
  assert.equal(C.debuffPlan(champCtx('Bar'), mp, me)?.n, 'Curse Chaos', '… и .champ');
  denv.rt.debuffImmune = { rb: 1 };
  assert.equal(C.debuffPlan({ block: {}, name: 'Rahha', rb: { id: 1 } }, mp, me), null, 'РБ — общий флаг, как раньше');
  assert.equal(C.dbfImmune({ name: 'Bar' }), false);
  // вырезка обработки строки «має імунітет» из боя (как вырезка act() в v803-clicklock)
  const src = read('modules/combat.js'), a = src.indexOf("        if (/імунітет|иммунитет|immune/i.test(added)) {"), b = src.indexOf('return AGAIN;\n        }', a);
  assert.ok(a > 0 && b > a);
  const ib = { env: denv, Date, Object, String, IMM_MS: C.IMM_MS, immKey: C.immKey, AGAIN: 'again', rtSoon: p => Object.assign(denv.rt, p) }; ib.globalThis = ib;
  vm.runInNewContext('function onImmune(added, dbf, ctx) {\n' + src.slice(a, b + 'return AGAIN;\n        }'.length) + '\n}', ib);
  const recs2 = []; denv.rec = (...x) => recs2.push(x.join(' | '));
  denv.rt.debuffImmune = { rb: 1, mob: 5, champ: 6 };
  let c1 = { name: 'Foo', debuffed: { 'curse chaos': 1 } };
  assert.equal(ib.onImmune('Foo має імунітет до негативних ефектів', { k: 'curse chaos' }, c1), 'again');
  assert.ok(Date.now() - denv.rt.debuffImmune.sp.foo < 1000 && denv.rt.debuffImmune.rb === 1 && !denv.rt.debuffImmune.mob, 'вид Foo на сутки; общий .mob не ставится');
  assert.equal(denv.rt.debuffImmune.champ, undefined, 'старые общие флаги при записи не переносятся');
  assert.equal(c1.debuffed['curse chaos'], undefined); assert.ok(recs2.some(x => /Foo: невосприимчив к дебаффам .* не вешаю на этот вид 24 ч, на остальных — как обычно/.test(x)));
  assert.equal(C.debuffPlan({ block: {}, name: 'Foo' }, mp, me), null, 'в том же бою — больше не вешаем');
  denv.rt.debuffImmune = {};
  ib.onImmune('Raid Boss має імунітет до негативних ефектів', { k: 'curse chaos' }, { name: 'Gatekeeper' });
  assert.ok(denv.rt.debuffImmune.rb > 0, '«Raid Boss» в тексте — флаг РБ при ctx без rb'); assert.ok(denv.rt.debuffImmune.sp.gatekeeper > 0, '… и вид этой цели');
  denv.rt.debuffImmune = { rb: 5 };
  ib.onImmune('Raid Boss має імунітет до негативних ефектів', { k: 'curse chaos' }, { name: 'Rahha', rb: { id: 1 } });
  assert.deepEqual(plain(denv.rt.debuffImmune), { rb: 5 }, 'настоящий РБ: только общий флаг, видов не копим');
  denv.rt.debuffImmune = { sp: { foo: Date.now() - 26 * 3600000, old: Date.now() - 8 * 24 * 3600000 } }; recs2.length = 0;
  ib.onImmune('Foo має імунітет до негативних ефектів', { k: 'curse chaos' }, { name: 'Foo' });
  assert.ok(recs2.some(x => /проба после суток: всё ещё иммунитет/.test(x))); assert.equal(denv.rt.debuffImmune.sp.old, undefined, 'записи старше недели вычищаются');
  // миграция dbfImm2043: снять старые общие флаги, РБ оставить
  const csrc = read('content.js'), ma = csrc.indexOf("  once('dbfImm2043'"), mb = csrc.indexOf('\n  });\n', ma);
  assert.ok(ma > 0 && mb > ma);
  const mig = state => { const m = { rt: state, rf: {}, cf: {}, Object }; m.globalThis = m;
    vm.runInNewContext('const once = (flag, fn) => { if (!rt[flag] && !rf[flag]) { rf[flag] = 1; cf[flag] = 1; fn(); } };\n' + csrc.slice(ma, mb + 6), m); return plain(m.rf); };
  assert.deepEqual(mig({ debuffImmune: { rb: 7, mob: 8, champ: 9 } }), { dbfImm2043: 1, debuffImmune: { rb: 7 } });
  assert.deepEqual(mig({ debuffImmune: { rb: 7 } }), { dbfImm2043: 1 }, 'нечего снимать — rt не пишем');
  assert.deepEqual(mig({ debuffImmune: { rb: 7, mob: 8 }, dbfImm2043: 1 }), {}, 'разовая');
  assert.ok(csrc.indexOf("once('dbfImm2043'") > csrc.indexOf("once('rbFix721'"), 'после rbFix721 (та ставит rb в rf.debuffImmune)');
  console.log('PASS: иммунитет к дебаффам — по виду цели на сутки (потом одна проба), РБ общим флагом, «Raid Boss» в тексте = РБ, миграция снимает старые общие флаги');
})().catch(e => { console.error(e); process.exit(1); });
