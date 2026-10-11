'use strict';
// 9.0 (игрок 11.10: «разработай полностью механизм автофарма (авто кач) исходя из КПД локации, от 1-х лвлов до хай лвла»):
// встроенная база зон (zone-db.js из kb/data), модель КПД (zone-kpd.js), выбор зоны в navigation по прогнозу + своим замерам, меню
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let finished = false;
process.on('exit', () => { if (!finished) { console.error('FAIL: v90-autofarm не дошёл до конца'); process.exitCode = 1; } });
const sandbox = (files, now) => {
  const D = now ? Object.assign(function (...a) { return new Date(...a); }, { now: () => now.t }) : Date;
  const sb = { console, Date: D, Math, JSON, location: { pathname: '/map.html', search: '', href: '' }, CSS: { escape: s => s } };
  sb.globalThis = sb;
  for (const f of files) vm.runInNewContext(read(f), sb, { filename: f });
  return sb;
};
const J = x => JSON.parse(JSON.stringify(x));

// ---------- 1. база и подключение ----------
const mf = JSON.parse(read('manifest.json')), js = mf.content_scripts.find(x => x.js.includes('content.js')).js;
for (const f of ['zone-db.js', 'zone-kpd.js']) {
  assert.ok(js.includes(f) && js.indexOf(f) < js.indexOf('modules/navigation.js') && js.indexOf(f) < js.indexOf('content.js'), `${f} loaded before modules/content`);
  assert.ok(read('popup.html').indexOf(`<script src="${f}">`) >= 0 && read('popup.html').indexOf(`<script src="${f}">`) < read('popup.html').indexOf('<script src="popup.js">'), `${f} in popup before popup.js`);
}
const sb = sandbox(['zone-db.js', 'zone-kpd.js']), DB = sb.L2ZONE_DB, K = sb.L2Kpd;
assert.equal(Object.keys(DB.zones).length, 90, '90 teleport points from the live game');
assert.ok(Object.keys(DB.mobs).length >= 400, 'mobs with level/EXP');
assert.deepEqual(J(DB.hp), [180, 48], 'mob HP = 180 + 48·level (live game, 11.10)');
assert.ok(read('zone-db.js').length < 64 * 1024, 'compact');
for (const [id, z] of Object.entries(DB.zones)) { assert.ok(z.n && z.lo > 0 && z.hi >= z.lo, id); for (const n of z.m) assert.ok(DB.mobs[n]?.[0] > 0, `${id}: ${n} has a level`); }
assert.equal(/passw|token|"auth"/i.test(read('zone-db.js')), false, 'no secrets in the built-in base');
// база пересобирается тем же скриптом из kb/data (если есть python3)
const py = require('node:child_process').spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (py.status === 0) {
  const tmp = path.join(require('node:os').tmpdir(), 'zdb-' + process.pid);
  fs.mkdirSync(path.join(tmp, 'kb'), { recursive: true });
  fs.cpSync(path.join(root, 'kb', 'data'), path.join(tmp, 'kb', 'data'), { recursive: true });
  const r = require('node:child_process').spawnSync('python3', ['-I', path.join(root, 'tests/tools/zone-db-build.py'), tmp], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(tmp, 'zone-db.js'), 'utf8'), read('zone-db.js'), 'zone-db.js is up to date with kb/data');
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('PASS: built-in zone base — 90 points, mob levels/EXP, HP by level, loaded before the modules and in the menu, rebuilt from kb/data');

// ---------- 2. модель КПД ----------
const cfg = { lvlBelow: 3, zoneAbove: 10 }, o0 = { rt: {}, cfg, mage: true };
assert.ok(K.thick(65, 60, true) > 1.1 && K.thick(65, 60, true) < 1.25, 'mob +5 lvl is only ≈1.17× thicker (flat stats)');
assert.equal(K.pen(60, 55), 1); assert.ok(Math.abs(K.pen(60, 50) - Math.pow(5 / 6, 5)) < 1e-9, 'Interlude EXP penalty below −5');
assert.equal(K.aboveBase(5, cfg), 3); assert.equal(K.aboveBase(20, cfg), 5); assert.equal(K.aboveBase(60, cfg), 10); assert.equal(K.aboveBase(60, { zoneAbove: 4 }), 4);
// 60 ур.: Ancient Battleground (Past Knight 64) — как вывод базы знаний «лучшие мобы на 60: Past Knight»
const r60 = K.rank(60, o0);
assert.equal(r60[0].id, 'ancient_battleground', `L60 best: ${r60[0].id}`);
assert.match(r60[0].why, /Past Knight 64/);
// у каждой зоны в оценке — только мобы окна [L−3, L+верх]
for (const L of [3, 12, 25, 40, 55, 70, 78]) for (const e of K.rank(L, o0).slice(0, 5)) for (const m of e.mobs) assert.ok(m.lvl >= L - 3 && m.lvl <= L + K.aboveBase(L, cfg), `L${L} ${e.id}: ${m.name} ${m.lvl}`);
// маршрут 1→80: сплошной, без дыр; у каждого отрезка в зоне есть мобы этих уровней
const rt80 = K.route(o0, 1, 80);
assert.equal(rt80[0].from, 1); assert.equal(rt80[rt80.length - 1].to, 80);
for (let i = 1; i < rt80.length; i++) assert.equal(rt80[i].from, rt80[i - 1].to + 1, 'route is contiguous');
for (const x of rt80) { assert.ok(x.id, `L${x.from}: some zone`); for (const L of [x.from, x.to]) assert.ok(K.zoneEst(x.id, L, o0).n > 0, `L${L} ${x.id}: mobs of this level`); }
assert.ok(rt80.length >= 8 && rt80.length <= 25, `route has ${rt80.length} legs (not flapping every level)`);
assert.ok(rt80.find(x => x.from <= 60 && x.to >= 60).id === 'ancient_battleground');
console.log('PASS: KPD model — flat mob stats, EXP penalty, window by level (low levels narrower), L60 → Ancient Battleground (Past Knight), contiguous route 1→80');

// ---------- 3. обучение по своим замерам ----------
const now = { t: Date.parse('2026-10-11T12:00:00Z') };
const mv = (n, exp, sec) => ({ n, exp: n * exp, sec: n * sec, t: now.t - 3600000 });
let o = { rt: { mobVal: { 'past knight': mv(10, 11588, 6), 'plando': mv(10, 4953, 4) } }, cfg, mage: true, now: now.t };
let cal = K.learn(o, 62);
assert.ok(cal.sMeasured && cal.s > 2 && cal.s < 8, `own time per mob learned (${cal.s})`);
// мобы +12 бьются уверенно (≥5 боёв, не «не по зубам») → верх окна для зоны расширяется до +12
o.rt.mobVal['bloody lord'] = mv(6, 9382, 8); o.rt.mobVal['dark guard'] = mv(6, 13863, 9);
cal = K.learn(o, 58);
assert.equal(cal.above, 12, 'window grows to the highest level the hero kills fine (Dark Guard 70 at 58)');
o.rt.hardMobs = { 'dark guard': { t: now.t } };
assert.equal(K.learn(o, 58).above, 10, '«не по зубам» does not widen the window');
assert.ok(!K.zoneEst('ancient_battleground', 62, o).mobs.some(m => m.name === 'Dark Guard'), 'hard mob not counted in the zone');
o.rt.hardMobs = {}; o.rt.deathLog = [now.t - 600000, now.t - 300000];
assert.equal(K.learn(o, 58).above, 9, 'two deaths within an hour — 3 levels more careful');
o.rt.deathLog = [];
// замер вида перевешивает базу: Past Knight на деле бьётся очень долго → зона теряет КПД
const before = K.zoneEst('ancient_battleground', 62, { rt: {}, cfg, mage: true, now: now.t }).exp;
o = { rt: { mobVal: { 'past knight': mv(30, 11588, 40), 'bloody lady': mv(10, 4536, 4), 'seer of hallate': mv(10, 4045, 4) } }, cfg, mage: true, now: now.t };
const after = K.zoneEst('ancient_battleground', 62, o), pk = after.mobs.find(m => m.name === 'Past Knight');
assert.ok(pk.meas && pk.eps < 11588 / 40 * 2, `Past Knight valued by its 30 measured fights (${Math.round(pk.eps)} EXP/s)`);
assert.ok(after.exp < before * 0.9 && after.mobs[0].name !== 'Past Knight', `measured slow Past Knight drops the zone (${Math.round(before)} → ${Math.round(after.exp)})`);
assert.match(after.why, /свои замеры/);
// старые (> 3 дней) замеры не учитываются
o.rt.mobVal['past knight'].t = now.t - 4 * 86400000;
assert.ok(!K.zoneEst('ancient_battleground', 62, o).mobs.find(m => m.name === 'Past Knight').meas, 'stale measurement ignored');
// мобы, увиденные ботом на карте зоны (rt.zoneMobs + уровни из rt.spawns), дополняют базу
const zx = K.zoneEst('aden', 60, { rt: { zoneMobs: { aden: ['Totally New Mob'] }, spawns: { s1: ['Totally New Mob', 61] } }, cfg, mage: true });
assert.ok(zx.mobs.some(m => m.name === 'Totally New Mob' && m.est), 'mob seen on the map counts (EXP by level curve)');
console.log('PASS: learning — own time per mob, window widens to proven levels, hard mobs/deaths narrow it, measured mobs override the base, map-seen mobs added');

// ---------- 4. выбор зоны (navigation) ----------
const nsb = sandbox(['zone-db.js', 'zone-kpd.js', 'modules/navigation.js'], now);
let L = 60;
const nenv = { cfg: { zoneTrial: 20, lvlBelow: 3, lvlAbove: 99, zoneAbove: 10, shopReserve: 200000 }, rt: {}, heroLvl: () => L,
  setRt: p => { Object.assign(nenv.rt, p); }, kpd: nsb.L2Kpd, kpdMage: () => true, rec: () => {}, sleep: async () => {} };
const N = nsb.L2V7Factories.navigation(nenv);
// новый герой без замеров и без прочитанного «Телепорта»: сразу в лучшую по КПД, не в ближайшую по уровню
for (const [lv, want] of [[60, 'ancient_battleground'], [70, null], [20, null], [5, null]]) {
  L = lv; nenv.rt = { zoneStat: {}, zoneCat: {}, zone: 'out:x', zoneTried: {} };
  const p = N.zonePick(), best = nsb.L2Kpd.rank(lv, { rt: {}, cfg: nenv.cfg, mage: true })[0];
  assert.equal(p?.id, want || best.id, `L${lv}: fly to the best KPD zone (${JSON.stringify(p)})`);
  assert.match(p.why, /по КПД для \d+ ур\./);
}
// без модели (env.kpd нет) — как в 8.0: каталог пуст → никуда
L = 60; const plain = nsb.L2V7Factories.navigation({ ...nenv, kpd: undefined, rt: { zoneStat: {}, zoneCat: {}, zone: 'out:x', zoneTried: {} } });
assert.equal(plain.zonePick(), null, 'no model: unchanged 8.0 behaviour');
// в городе без мобов своего уровня бесплатную «пробу здесь» не устраиваем
nenv.rt = { zoneStat: {}, zoneCat: { aden: { name: 'Town of Aden', city: 'aden', town: true, price: 0 } }, zone: 'aden', zoneTried: {}, zoneTrialT: 1 };
assert.equal(N.zonePick()?.id, 'ancient_battleground', 'Aden at 60: no mobs of this level in town — fly, no trial here');
// прогноз приводится к своим замерам: k = замер ÷ прогноз по изученным зонам
const est60 = nsb.L2Kpd.zoneEst('forest_of_the_dead', 60, { rt: {}, cfg: nenv.cfg, mage: true }).exp;
const zs = { forest_of_the_dead: { 60: { n: 100, exp: est60 * 2 / 3600 * 600, sec: 600 } } };
nenv.rt = { zoneStat: zs, zoneCat: {}, zone: 'forest_of_the_dead', zoneTried: {} };
const kp = N.kpdOf(60, ['forest_of_the_dead', 'ancient_battleground']);
assert.ok(Math.abs(kp.k - 2) < 0.01 && kp.n === 1, `calibration factor from measured zone (${kp.k})`);
// изученная зона намного лучше прогнозов остальных — стоим, раз в час пробуем только зону с прогнозом ≥ 0,9 лучшей
// (k = медиана 3 и 1 = 2: прогноз Ancient Battleground ×2 всё равно < 0,9 замера Forest of the Dead ×3)
const estFm = nsb.L2Kpd.zoneEst('fields_of_massacre', 60, { rt: {}, cfg: nenv.cfg, mage: true }).exp;
nenv.rt = { zoneStat: { forest_of_the_dead: { 60: { n: 100, exp: est60 * 3 / 3600 * 600, sec: 600 } }, fields_of_massacre: { 60: { n: 100, exp: estFm / 3600 * 600, sec: 600 } } },
  zoneCat: {}, zone: 'forest_of_the_dead', zoneTried: {}, zoneExploreT: now.t - 2 * 3600000 };
assert.equal(N.zonePick(), null, 'measured zone far above every forecast: stay, no hourly paid trial');
// текущая зона на деле втрое хуже своего прогноза, другая изученная — как прогноз (k = 0,65): летим в изученную лучшую (прогноз Ancient
// Battleground ×0,65 ≈3,5 M не лучше её ≈4,2 M с запасом ×0,85/×1,10 — платная проба не нужна)
nenv.rt = { zoneStat: { forest_of_the_dead: { 60: { n: 100, exp: est60 * 0.3 / 3600 * 600, sec: 600 } }, fields_of_massacre: { 60: { n: 100, exp: estFm / 3600 * 600, sec: 600 } } },
  zoneCat: {}, zone: 'forest_of_the_dead', zoneTried: {}, zoneExploreT: now.t };
assert.equal(N.zonePick()?.id, 'fields_of_massacre', 'poor current zone: to the better measured zone');
// а если лучшая изученная (Rune ≈4,0 M, замеры = прогнозу, k = 1) сильно уступает прогнозу непроверенной (Ancient Battleground ≈5,4 M:
// ×0,85 > ×1,10) — пробуем её сразу, не через час
const E60 = id => nsb.L2Kpd.zoneEst(id, 60, { rt: {}, cfg: nenv.cfg, mage: true }).exp, row = x => ({ 60: { n: 100, exp: x / 6, sec: 600 } });
nenv.rt = { zoneStat: { schuttgart: row(E60('schuttgart') * 0.3), rune: row(E60('rune')), wild_beast_pastures: row(E60('wild_beast_pastures')), tower_of_insolence: row(E60('tower_of_insolence')) },
  zoneCat: {}, zone: 'schuttgart', zoneTried: {}, zoneExploreT: now.t };
const hot = N.zonePick();
assert.equal(hot?.id, 'ancient_battleground', `measured zones well below the best forecast: try it now (${JSON.stringify(hot)})`);
// каталог: база + «Телепорт»; имя зоны из базы в журнале
nenv.rt = { zoneCat: { giran: { name: 'Town of Giran', city: 'giran', town: true, price: 10000 } } };
assert.equal(N.catAll().giran.lo, 31, 'town from «Телепорт» gets levels from the base');
assert.equal(N.catAll().giran.city, 'giran');
assert.equal(N.zoneName('ancient_battleground'), 'Ancient Battleground');
console.log('PASS: zone choice — new hero flies to the best KPD zone at any level, no trial in a town without mobs, forecast scaled to own measurements, no pointless paid trials, base + teleport catalog');

(async () => {
  // «мобы тут не своего уровня»: в лучшую по КПД, а не ближайшую по уровню
  L = 60; let go = null;
  Object.assign(nenv, { pageItems: () => [15, 20, 27].map(lvl => ({ lvl, champ: false })), zoneCatThin: () => false });
  const tpCat = Object.fromEntries(Object.entries(K.cat()).map(([id, c]) => [id, { name: c.name, lo: c.lo, hi: c.hi, price: c.price, city: 'x' }]));   // «Телепорт» прочитан
  nenv.rt = { zoneStat: {}, zoneCat: tpCat, zone: 'out:low', zoneTried: {}, zoneLvlT: 0, zoneCatT: now.t };
  nenv.setRt = p => { if (p.zoneGo) go = p.zoneGo; Object.assign(nenv.rt, p); };
  assert.equal(await N.zoneForLevel(), true);
  assert.equal(go?.id, 'ancient_battleground', `wrong-level spot at 60 → best KPD zone (${JSON.stringify(go)})`);
  assert.match(go.why, /лучшая по КПД/);
  console.log('PASS: wrong-level spot — flies to the best KPD zone');

  // ---------- 5. симуляция кача 1→78 (скрытая «правда» зоны ×0,6…1,4 к прогнозу): КПД лучше 8.0 ----------
  const sim = useK => {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const zf = {}; for (const id of Object.keys(DB.zones)) zf[id] = 0.6 + 0.8 * rnd();
    const truth = (id, lv) => { const e = K.zoneEst(id, lv, { rt: {}, cfg: nenv.cfg, mage: true }); return e && e.exp > 0 ? e.exp * zf[id] : 0.015e6 * lv; };
    const clk = { t: now.t }, s2 = sandbox(['zone-db.js', 'zone-kpd.js', 'modules/navigation.js'], clk);
    let lv = 1; const e2 = { cfg: nenv.cfg, rt: { zoneStat: {}, zoneCat: useK ? {} : K.cat(), zone: 'talking_island', zoneTried: {} }, heroLvl: () => lv, setRt: p => Object.assign(e2.rt, p), kpd: useK ? s2.L2Kpd : undefined, kpdMage: () => true };
    const N2 = s2.L2V7Factories.navigation(e2);
    let tp = 0, sum = 0, steps = 0, inLvl = 0;
    while (lv < 78) {
      const p = N2.zonePick(); if (p) { e2.rt.zone = p.id; tp++; clk.t += 60000; }
      const ex = truth(e2.rt.zone, lv), z = e2.rt.zoneStat[e2.rt.zone] = e2.rt.zoneStat[e2.rt.zone] || {}, x = z[lv] = z[lv] || { n: 0, exp: 0, sec: 0 };
      x.n += 100; x.exp += ex / 6; x.sec += 600;
      sum += ex / Math.max(...Object.keys(zf).map(id => truth(id, lv))); steps++; clk.t += 600000;
      if (++inLvl >= 3) { lv++; inLvl = 0; }
    }
    return { tp, eff: sum / steps };
  };
  const a = sim(true), b = sim(false);
  assert.ok(a.eff > b.eff + 0.05 && a.eff > 0.75, `leveling 1→78: KPD ${(a.eff * 100).toFixed(1)} % of ideal vs 8.0 ${(b.eff * 100).toFixed(1)} %`);
  assert.ok(a.tp <= b.tp, `no more teleports than 8.0 (${a.tp} vs ${b.tp})`);
  console.log(`PASS: leveling simulation 1→78 — ${(a.eff * 100).toFixed(1)} % of the ideal zone EXP/h (8.0: ${(b.eff * 100).toFixed(1)} %), teleports ${a.tp} (8.0: ${b.tp})`);

  // ---------- 6. меню ----------
  const pj = read('popup.js'), ph = read('popup.html'), cj = read('content.js');
  assert.ok(/'zoneTrial', 'zoneAbove'/.test(pj) && ph.includes('id="zoneAbove"'), 'zoneAbove is a menu number');
  assert.ok(ph.includes('id="routeBox"') && pj.includes('function renderRoute(') && pj.includes('K.route(o, 1, 80)'), 'route 1→80 in the menu');
  assert.ok(pj.includes('<th title="Прогноз по базе игры (КПД)">КПД</th>'), 'KPD column in the zone table');
  assert.ok(pj.includes('cat = { ...(rt.zoneCat || {}) }'), 'menu does not mutate rt.zoneCat while adding base zones');
  assert.ok(cj.includes('get kpd() { return globalThis.L2Kpd; }, get kpdMage() { return kpdMage; },'), 'navigation gets the model through env');
  console.log('PASS: menu — KPD column, best-by-base line, route 1→80, «мобы не выше героя на N» setting');
  finished = true;
})().catch(e => { console.error(e); process.exit(1); });
