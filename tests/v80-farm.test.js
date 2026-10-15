'use strict';
// 8.0 (аудит фарма): зоны 50–52 ур. в базовом профиле; «изученная» зона — по боям рядом с уровнем героя, не ниже медианы;
// карта по плану — только по делу; чемпионы до −8 ур.; среди равных целей — самая выгодная (rt.mobVal); плановая проверка запасов —
// по сумке из ответов сервера; тур РБ не перечитывает список каждые 105 с; мобов зоны — до 80
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let finished = false;
process.on('exit', () => { if (!finished) { console.error('FAIL: v80-farm не дошёл до конца'); process.exitCode = 1; } });
const loadMod = name => {
  const sb = { console, Date, Math, JSON, location: { pathname: '/map.html', search: '', href: '' }, CSS: { escape: s => s } };
  sb.globalThis = sb;
  vm.runInNewContext(read(`modules/${name}.js`), sb);
  return sb;
};

// ---------- A1 (a): замеры зон 50–52 ур. из шапок журналов 10.10 — в базовом профиле ----------
const B = JSON.parse(read('base-profile.json')), R = B.chars.Warlock.rt, Z = R.zoneStat;
const perH = e => e.exp / e.sec * 3600;
for (const [z, L, n, rate] of [['den_of_evil', 51, 294, 6524198], ['blazing_swamp', 51, 130, 4318444], ['blazing_swamp', 50, 37, 5825567],
  ['pavel_ruins', 51, 201, 3859872], ['pavel_ruins', 52, 426, 3737930], ['enchanted_valley_north', 50, 150, 1638025]]) {
  assert.equal(Z[z]?.[L]?.n, n, `${z} ${L}: fights from the log header`);
  assert.equal(Z[z][L].pn, n);
  assert.ok(Math.abs(perH(Z[z][L]) - rate) / rate < 0.001, `${z} ${L}: EXP/h ${Math.round(perH(Z[z][L]))} ≈ ${rate}`);
}
assert.equal(Z.pavel_ruins[48].n, 900, 'older rows untouched');
assert.equal(/passw|"auth"/i.test(read('base-profile.json')), false, 'no password in base profile');
console.log('PASS: base profile — zone rows L50–52 (Den of Evil 51, Blazing 50–51, Pavel 51–52, EV North 50) from the 10.10 log headers');

// ---------- A1 (b): выбор зоны ----------
const nav = loadMod('navigation');
let L = 53;
const nenv = { cfg: { zoneTrial: 20, lvlBelow: 3, lvlAbove: 20, shopReserve: 200000 }, rt: {}, heroLvl: () => L, setRt: p => { Object.assign(nenv.rt, p); } };
const N = nav.L2V7Factories.navigation(nenv);
const at = (zone, zs = Z, extra = {}) => { nenv.rt = { zoneStat: zs, zoneCat: R.zoneCat, zone, zoneTried: {}, zoneTrialT: 1, ...extra }; return N.zonePick(); };
// Antharas' Lair на 53 ур. — только старые 248 боёв на 50 ур.: оценка есть, но зона не «изучена» для 53
nenv.rt = { zoneStat: Z, zoneCat: R.zoneCat };
const ra = N.zoneRate('antharas_lair', 53);
assert.ok(ra.exp > 0 && ra.n >= 20 && ra.n1 === 0, `antharas at 53: estimate from L50 only (${JSON.stringify(ra)})`);
// ни на одном уровне 50–55 и ни из какой зоны автофарм не выбирает худшую (Antharas' Lair ≈1,46 M)
for (L = 50; L <= 55; L++) for (const cur of ['den_of_evil', 'pavel_ruins', 'blazing_swamp', 'enchanted_valley_north', 'out:x']) {
  const p = at(cur);
  assert.notEqual(p?.id, 'antharas_lair', `L${L} from ${cur}: never the worst zone (${JSON.stringify(p)})`);
}
// 50–52 ур.: лучшая изученная — Den of Evil (≈6,5 M); там и остаёмся
for (L = 50; L <= 52; L++) { assert.equal(at('pavel_ruins')?.id, 'den_of_evil', `L${L}: pavel → den`); assert.equal(at('den_of_evil'), null, `L${L}: stay in den`); }
// 53 ур. (замеров на 52–54 у Den of Evil нет): стоим в Den — меряем здесь, не летим пробовать другую
L = 53;
assert.equal(at('den_of_evil'), null, 'L53 in den: measure here instead of a paid trial elsewhere');
const p53 = at('pavel_ruins');
assert.equal(p53?.id, 'den_of_evil', `L53 from pavel: trial of the zone with the best old estimate (${JSON.stringify(p53)})`);
assert.match(p53.why, /старым замерам/);
// воспроизведение лога 21:05 (переустановка, замеров 51–52 нет): раньше герой 53 летел в Antharas' Lair
const old = JSON.parse(read('tests/fixtures-zones-7128.json')).zoneStat;
old.pavel_ruins = { ...old.pavel_ruins, 52: { exp: 24309, n: 3, pct: 0.39, pn: 3, sec: 12.317 } };
for (const cur of ['out:x', 'pavel_ruins', 'blazing_swamp']) {
  const p = at(cur, old);
  assert.ok(!p || !['antharas_lair', 'enchanted_valley_north'].includes(p.id), `reinstall, L53 from ${cur}: not the worst zones (${JSON.stringify(p)})`);
}
assert.equal(at('out:x', old)?.id, 'pavel_ruins', 'reinstall, L53: trial of the zone with the best old estimate');
// текущая зона неизвестна, изучена только зона ниже медианы — туда не летим (пробуем лучшую по старым замерам, иначе стоим)
const cat3 = { a: { name: 'A', lo: 48, hi: 60, city: 'x' }, b: { name: 'B', lo: 48, hi: 60, city: 'x' }, d: { name: 'D', lo: 48, hi: 60, city: 'x' } };
const zs3 = { a: { 53: { n: 100, exp: 1.4e6 / 3600 * 600, sec: 600 } }, b: { 51: { n: 200, exp: 5e6 / 3600 * 1000, sec: 1000 } }, d: { 51: { n: 200, exp: 4e6 / 3600 * 1000, sec: 1000 } } };
nenv.rt = { zoneStat: zs3, zoneCat: cat3, zone: 'out:x', zoneTried: {} };
assert.equal(N.zonePick()?.id, 'b', 'unknown current zone: trial of the best old estimate, not the rated-but-poor zone');
nenv.rt = { zoneStat: zs3, zoneCat: cat3, zone: 'out:x', zoneTried: { 'b:53': Date.now(), 'd:53': Date.now() } };
assert.equal(N.zonePick(), null, 'only a below-median rated zone left: stay');
console.log('PASS: zone pick — rated only with fights near the hero level, never below the median, no flight to the worst zone after a reinstall');
// «мобы тут не своего уровня» (автофарм): сразу в зону с лучшей оценкой, а не в «изученную» худшую
(async () => {
  L = 53;
  let go = null;
  Object.assign(nenv, { pageItems: () => [15, 20, 27, 35].map(lvl => ({ lvl, champ: false })), zoneCatThin: () => false, rec: () => {}, sleep: async () => {} });
  nenv.rt = { zoneStat: old, zoneCat: R.zoneCat, zone: 'out:cruma', zoneTried: {}, zoneLvlT: 0, zoneCatT: Date.now() };
  nenv.setRt = p => { if (p.zoneGo) go = p.zoneGo; Object.assign(nenv.rt, p); };
  assert.equal(await N.zoneForLevel(), true);
  assert.ok(go && !['antharas_lair', 'enchanted_valley_north'].includes(go.id), `low-level spot at 53 after a reinstall: not the worst zone (${JSON.stringify(go)})`);
  go = null; nenv.rt = { zoneStat: Z, zoneCat: R.zoneCat, zone: 'out:cruma', zoneTried: {}, zoneLvlT: 0, zoneCatT: Date.now() };
  assert.equal(await N.zoneForLevel(), true);
  assert.equal(go?.id, 'den_of_evil', `low-level spot at 53: Den of Evil by old measurements (${JSON.stringify(go)})`);
  assert.match(go.why, /старым замерам/);
  console.log('PASS: wrong-level spot — flies to the best estimate, not to a poor «rated» zone');

  // ---------- C5: мобов зоны — до 80 ----------
  const many = Array.from({ length: 70 }, (_, i) => ({ id: 's' + i, name: 'Mob ' + i, lvl: 50, champ: false }));
  nenv.rt = { zone: 'den_of_evil', zoneMobs: {}, zoneCat: R.zoneCat };
  Object.assign(nenv, { pageItems: () => many, isRaidId: () => false, heroLvl: () => 53, setRt: p => { Object.assign(nenv.rt, p); } });
  N.zoneHere();
  assert.equal(nenv.rt.zoneMobs.den_of_evil.length, 70, 'zone keeps up to 80 mob names (was 40)');
  console.log('PASS: zone mob list keeps up to 80 names');

  // ---------- A4 + B1: цели на карте ----------
  const mf = loadMod('mobfarm');
  const menv = {
    cfg: { lvlBelow: 3, lvlAbove: 20, lvlMin: 1, lvlMax: 99, searchChamp: true }, PAGE_SIZE: 15,   // 8.0.3: проверки A4/B1 — при ВКЛ поиске чемпионов
    rt: { zone: 'z', hardMobs: {}, zoneMobs: { z: ['Near Weak', 'Far Strong', 'Mid', 'Low'] }, mobVal: {},
      spawns: { s1: ['Near Weak', 52], s3: ['Mid', 52], s4: ['Low', 52], s2: ['Far Strong', 53], q1: ['Quest Mob', 52], c1: ['Probe Golem Prodigy IV', 47], c2: ['Old Champ', 43], m6: ['Lowbie', 47] } },
    heroLvl: () => 52, isRaidId: id => /^l2dop_/.test(id), campChampMin: () => 0, isBoss: () => false, campActive: () => false, campChampOpen: () => false,
    isQuestName: (n, q = []) => q.some(x => x.toLowerCase() === String(n).toLowerCase()), setRt: p => { Object.assign(menv.rt, p); },
  };
  const M = mf.L2V7Factories.mobfarm(menv);
  const rules = [{ neg: false, quest: true, champ: false, all: false, name: '' }, { neg: false, quest: false, champ: false, all: true, name: '' }];
  const idsAt = { s1: 0, s3: 1, s4: 2, c1: 5, c2: 6, m6: 7, s2: 20, q1: 30 };
  const ids = []; for (const [id, i] of Object.entries(idsAt)) ids[i] = id;
  const sig = { ids: ids.map((x, i) => x || 'gap' + i), quest: ['Quest Mob'] }, types = { c1: 'champion', c2: 'champion' };
  // без замеров: чемпион 46 (−6) — цель, обычный 46 — нет, чемпион 43 (−9) — нет; среди равных — выше уровнем, потом ближе
  let c = Array.from(M.candidates(rules, sig, types, 99), x => x.id);   // массив из песочницы vm — в обычный
  // 10.0.5 (игрок 13.10: «фарм мобов −5 лвл максимум, иначе не падают ФА»): окно чемпионов −8 → −5 — чемпион и обычный теперь на −5 (были −6)
  assert.ok(c.includes('c1'), 'champion at hero−5 is a target (A4, FA window)');
  assert.ok(!c.includes('m6'), 'normal mob at hero−5 stays out of the window −3');
  assert.ok(!c.includes('c2'), 'champion at hero−9 is out');
  assert.equal(c[0], 'q1', '★ quest target first');
  assert.equal(c[1], 's2', 'no measurements: higher level first (53 > 52)');
  assert.deepEqual(c.slice(2, 5), ['s1', 's3', 's4'], 'equal level: nearer first');
  // замеры: Far Strong ≈2000 EXP/с (через страницу), Mid ≈1000, Near Weak ≈500, Low ≈250 — медиана зоны 750 → Near Weak и Low (< 525) не цели
  const mv = (n, exp, sec) => ({ n, exp: n * exp, sec: n * sec, t: Date.now() });
  menv.rt.mobVal = { 'near weak': mv(5, 2000, 4), 'far strong': mv(5, 8000, 4), mid: mv(5, 4000, 4), low: mv(5, 1000, 4) };
  c = Array.from(M.candidates(rules, sig, types, 99), x => x.id);
  assert.equal(c[0], 'q1', '★ quest target still first, whatever the value');
  assert.equal(c[1], 'c1', 'unmeasured champion ≈3× zone median comes before ordinary mobs');
  assert.equal(c[2], 's2', 'the most rewarding mob, though a page further');
  assert.equal(c[3], 's3');
  assert.ok(!c.includes('s1') && !c.includes('s4'), 'measured mobs below 0.7× zone median are skipped');
  // 8.0.3 (игрок 11.10: «поиск чемпионов по умолчанию откл.»): выключено — чемпион как обычный моб: окно −3, без ×3 к ценности
  menv.cfg.searchChamp = false;
  menv.rt.spawns.c3 = ['Near Champ', 52]; idsAt.c3 = 8; ids[8] = 'c3'; types.c3 = 'champion';
  const sigOff = { ids: ids.map((x, i) => x || 'gap' + i), quest: ['Quest Mob'] };
  c = Array.from(M.candidates(rules, sigOff, types, 99), x => x.id);
  assert.ok(!c.includes('c1'), 'search off: champion at hero−5 is out of the window −3, like a normal mob');
  assert.ok(c.includes('c3'), 'search off: champion inside the window is still a normal target');
  assert.ok(c.indexOf('c3') > c.indexOf('s3'), 'search off: unmeasured champion gets the zone median, not 3× — no rush to champions');
  menv.cfg.searchChamp = true;
  delete menv.rt.spawns.c3; delete idsAt.c3; ids[8] = undefined; delete types.c3;
  // все ниже 0,7 медианы — всё равно бьём (лучше, чем стоять)
  const only = Array.from(M.candidates([rules[1]], { ids: ['s1', 's4'], quest: [] }, {}, 99), x => x.id);
  assert.deepEqual(only, ['s1', 's4'], 'nothing else left: low-value mobs are still targets');
  // «не по зубам» и окно сверху по-прежнему отсекают
  menv.rt.hardMobs = { 'far strong': { t: Date.now() } };
  assert.ok(!M.candidates(rules, sig, types, 99).some(x => x.id === 's2'), 'hardMobs guard respected');
  menv.rt.hardMobs = {};
  // замер: скользящее по 30 боям, не больше 150 видов
  menv.rt.mobVal = {};
  for (let i = 0; i < 35; i++) M.mobValNote('Probe', false, 1000, 2);
  assert.equal(menv.rt.mobVal.probe.n, 30); assert.ok(Math.abs(menv.rt.mobVal.probe.exp / menv.rt.mobVal.probe.sec - 500) < 1);
  M.mobValNote('Probe', true, 30000, 10);
  assert.equal(menv.rt.mobVal['ч:probe'].n, 1, 'champion measured separately from the ordinary mob of the same name');
  for (let i = 0; i < 160; i++) M.mobValNote('M' + i, false, 100, 1);
  assert.ok(Object.keys(menv.rt.mobVal).length <= 150, 'mobVal capped');
  console.log('PASS: map targets — champions to hero−8, most EXP/s among equal priority (distance only a tiebreak), low-value kinds skipped');

  // ---------- B4: плановая проверка запасов ----------
  let started = null, inv = {};
  const plan = [{ key: 'hp', ids: [1061], mm: [300, 1000] }, { key: 'mp', ids: [728], mm: [20, 100] }, { key: 'shots', ids: [3950], mm: [1000, 5000] },
    { key: 'spirit', ids: [3031], mm: [0, 1000] }, { key: 'soul', ids: [1785], mm: [0, 1000] }];
  // 10.0.15: nextFight читает подтверждённую победу перед дополнительным Warlock обслуживанием.
  const fenv = { victory: () => true, tabOwner: true, tvtSoon: () => false, sleep: async () => {}, rnd: () => 0, on: true, huntOn: () => false, epicOn: () => false, cfg: { shopAuto: true }, rt: {},
    townBuffStart: async () => false, shopNeedByPanel: () => '', shopPlan: () => plan, resQuests: () => [], invQty: id => inv === null ? null : (inv[id] ?? 0),
    shopStart: async why => { started = why; }, autonomyMode: () => 'fish', goFishing: async () => 'fish' };
  const F = loadMod('mobfarm').L2V7Factories.mobfarm(fenv);
  const nf = async (setup = {}) => { started = null; fenv.rt = { shopT: Date.now() - 2 * 3600000, bagAll: { t: Date.now() - 3600000 }, ...setup.rt }; inv = setup.inv === undefined ? { 1061: 500, 728: 50, 3950: 2000 } : setup.inv; fenv.resQuests = () => setup.rq || []; return F.nextFight(null); };
  assert.equal(await nf(), 'fish'); assert.equal(started, null, 'fresh bag from the server, all above minimum: no hourly trip');
  await nf({ inv: null }); assert.match(started || '', /плановая проверка/, 'bag not known from the network: hourly trip as before');
  await nf({ inv: { 1061: 500, 728: 50, 3950: 900 } }); assert.match(started || '', /плановая проверка/, 'something below minimum: trip');
  await nf({ rq: [{ key: 'coal' }] }); assert.match(started || '', /плановая проверка/, 'resource quests need the bag recount');
  await nf({ rt: { bagAll: { t: Date.now() - 6 * 3600000 } } }); assert.match(started || '', /плановая проверка/, 'full bag recount older than 5 h: trip');
  await nf({ rt: { shopT: Date.now() - 1800000 } }); assert.equal(started, null, 'less than an hour since the last trip: nothing');
  console.log('PASS: hourly stock check skipped when the bag from server responses is fresh and above minimums');

  // ---------- A5: тур РБ — простой без перечитки списка ----------
  const rsb = loadMod('raid');
  let lvl = 53, pots = 100;
  // 10.0.14: проверяем активный тур владельца вкладки; Stop/потеря lease отдельно покрыты raid-lifecycle.
  const renv = { on: true, tabOwner: true, cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbPotReserve: 0 }, RB_WIN: 15, rt: {}, heroLvl: () => lvl, potModel: () => ({ n: pots }),
    // 15.10: старый A5 проверяет idle на точке с обычными мобами.
    $q: s => s.startsWith('#map-mob-list ')?{}:null,
    meHp: () => ({ max: 5000, cur: 5000, pct: 100 }), isMap: () => true, map: async () => 'map', setRt: async p => { Object.assign(renv.rt, p); }, rec: () => {}, recBot: () => {}, setStatus: () => {}, sleep: async () => {} };
  const RB = rsb.L2V7Factories.raid(renv);
  const idleEnd = (mark, extra = {}) => {
    rsb.location.href = '';
    renv.rt = { rbHunt: { step: 'pick' }, rbHuntIdle: Date.now() - 1000, rbListT: Date.now() - 5 * 60000, rbList: {}, rbIdleMark: { lvl: 53, pots: 100, t: Date.now() - 6 * 60000, ...mark }, shopT: Date.now() - 3600000, ...extra };
    return RB.rbHuntStep();
  };
  assert.equal(await idleEnd({}), 'map');
  assert.ok(renv.rt.rbListT > 0 && rsb.location.href === '', 'idle over, nothing changed: RB list cache kept (no rescan every 105 s)');
  assert.ok(renv.rt.rbHuntIdle - Date.now() > 4 * 60000, 'next idle — 5 min');
  assert.equal(renv.rt.rbIdleMark.lvl, 53); assert.equal(renv.rt.rbIdleMark.pots, 100);
  // 15.10: пробуждение отдельно от следующего действия; банки/магазин не меняют живой список РБ.
  await idleEnd({ lvl: 52 }); assert.equal(renv.rt.rbListT, 0, 'hero level changed: rescan'); await RB.rbHuntStep(); assert.match(rsb.location.href, /rb-bosses/);
  pots = 150; await idleEnd({}); assert.ok(renv.rt.rbListT > 0, 'more potions: reassess without rescan'); assert.equal(renv.rt.rbHuntIdle, 0); pots = 100;
  await idleEnd({}, { shopT: Date.now() - 60000 }); assert.ok(renv.rt.rbListT > 0, 'shop visited during idle: reassess without rescan'); assert.equal(renv.rt.rbHuntIdle, 0);
  console.log('PASS: RB tour idle — list kept for its 15 min, level changes invalidate it, more potions wake without rescanning');

  // ---------- A3 + B1 в ядре: карта по плану только по делу; ценность моба пишется после победы ----------
  const mfst = JSON.parse(read('manifest.json'));
  const ctx = vm.createContext({ addEventListener() {}, removeEventListener() {}, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Math,
    crypto: { randomUUID: () => 'x' }, sessionStorage: { getItem: () => null, setItem() {} }, navigator: { userAgent: 'Chrome' },
    location: { pathname: '/map.html', search: '', href: 'https://l2wap.com/map.html', origin: 'https://l2wap.com' }, window: { addEventListener() {}, innerWidth: 1080 },
    document: { visibilityState: 'visible', prerendering: false, createElement() { return { style: {}, append() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementsByTagName() { return []; }, hasFocus() { return true; },
      documentElement: { className: '', clientWidth: 1024, append() {} }, body: { className: '', querySelector() { return null; } } },
    chrome: { runtime: { sendMessage: async () => null, onMessage: { addListener() {} }, getManifest: () => mfst, getURL: s => s }, storage: { onChanged: { addListener() {} }, local: { get: () => new Promise(() => {}), set: async () => {} } } } });
  ctx.window.window = ctx.window;
  for (const s of mfst.content_scripts.find(x => x.js.includes('content.js')).js) vm.runInContext(read(s), ctx);
  const sa = (c, r) => vm.runInContext(`cfg = mergeCfg(${JSON.stringify(c)}); rt = { ...DEF_RT, ...${JSON.stringify(r)} }; searchActive(parseRules())`, ctx);
  const due = (c, r) => vm.runInContext(`cfg = mergeCfg(${JSON.stringify(c)}); rt = { ...DEF_RT, ...${JSON.stringify(r)} }; mapDue(parseRules())`, ctx);
  const here = { zone: 'z', zoneMobs: { z: ['Giant Fungus', 'Dire Wyrm'] } };
  assert.equal(sa({ deepEvery: 10, searchChamp: false }, {}), false, 'only the [квест] rule, no ★ target: no reason for the map');
  assert.equal(sa({ deepEvery: 10, searchChamp: true }, {}), true, 'champion hunting is a reason');
  assert.equal(sa({ deepEvery: 10, searchChamp: false }, { ...here, questTargets: ['Giant Fungus'] }), true, '★ target on this location is a reason');
  assert.equal(sa({ deepEvery: 10, searchChamp: false }, { ...here, questTargets: ['Leto Lizardman'] }), false, '★ target of another location is not');
  assert.equal(sa({ deepEvery: 10, searchChamp: false, priority: 'Giant Fungus\n[все]' }, here), true, 'named rule with a mob of this location');
  assert.equal(sa({ deepEvery: 10, searchChamp: false, priority: 'Hatchling\n[все]' }, here), false, 'named rule with a mob elsewhere');
  assert.equal(due({ deepEvery: 0, searchChamp: false }, { ...here, questTargets: ['Giant Fungus'], sinceDeep: 500 }), false, '0 = never, even with a ★ target here');
  assert.equal(due({ deepEvery: 10, searchChamp: false }, { ...here, questTargets: ['Giant Fungus'], sinceDeep: 10 }), true);
  // trackEfficiency → rt.mobVal (без ожидания записи); приход картой приводится к цепочке
  vm.runInContext(`cfg = mergeCfg({}); rt = { ...DEF_RT, lastWinT: Date.now() - 4000, via: 'chain' }; trackEfficiency(5000, { name: 'Probe Mob', champ: false })`, ctx);
  const v1 = vm.runInContext(`rt.mobVal['probe mob']`, ctx);
  assert.equal(v1?.n, 1); assert.equal(v1.exp, 5000); assert.ok(Math.abs(v1.sec - 4) < 0.3, `chain kill: ${v1.sec} s`);
  vm.runInContext(`rt = { ...DEF_RT, lastWinT: Date.now() - 14000, via: 'map', eff: { chain: { n: 50, sec: 5 }, map: { n: 50, sec: 11 } } }; trackEfficiency(5000, { name: 'Map Mob', champ: true })`, ctx);
  const v2 = vm.runInContext(`rt.mobVal['ч:map mob']`, ctx);
  assert.ok(v2 && Math.abs(v2.sec - 8) < 0.3, `map kill normalised to chain time: 14 − (11 − 5) ≈ 8 s (got ${v2?.sec})`);
  vm.runInContext(`rt = { ...DEF_RT, lastWinT: Date.now() - 4000, via: 'chain' }; trackEfficiency(5000, { name: 'Boss', rb: true })`, ctx);
  assert.equal(vm.runInContext(`rt.mobVal`, ctx), undefined, 'RB fights are not counted');
  console.log('PASS: core — planned map only with a reason (★ here, champions, farm spot, named mob here), mob value recorded after each win');
  finished = true;
})().catch(e => { console.error(e); process.exit(1); });
