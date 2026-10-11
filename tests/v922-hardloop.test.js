'use strict';
// 9.2.2 (лог 12.10 07:22–07:34, спойлер, цель Маммона «добываю Mithril Ore»): Guardian Basilisk — источник ресурса и «не по зубам».
// Карта выбирала его (источник ресурса обходил hardMobs), бой тут же возвращал на карту — 12 мин по кругу. Плюс заказ торговца
// Маммона спрашивался на каждой загрузке страницы (HTTP 429 ×92): метки опроса теперь в sessionStorage вкладки
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
let finished = false;
process.on('exit', () => { if (!finished) { console.error('FAIL: v922-hardloop не дошёл до конца'); process.exitCode = 1; } });
const load = (name, extra = {}) => {
  const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, location: { pathname: '/map.html', search: '', href: '' }, CSS: { escape: s => s }, ...extra };
  sb.globalThis = sb; vm.runInNewContext(read(`modules/${name}.js`), sb); return sb;
};
(async () => {
  // 1. карта: источник ресурса «не по зубам» — не цель; ★ квест «не по зубам» — по-прежнему цель
  const menv = {
    cfg: { lvlBelow: 3, lvlAbove: 99, searchChamp: false }, PAGE_SIZE: 15,
    rt: { zone: 'brekas_stronghold', hardMobs: { 'guardian basilisk': { t: Date.now(), why: 'урон ≈4.6/с' } }, zoneMobs: {}, mobVal: {},
      spawns: { b1: ['Guardian Basilisk', 36], o1: ['Breka Orc Warrior', 33], q1: ['Quest Basilisk', 36] } },
    heroLvl: () => 33, isRaidId: () => false, campChampMin: () => 0, isBoss: () => false, campActive: () => false, campChampOpen: () => false,
    isQuestName: (n, q = []) => q.some(x => x.toLowerCase() === String(n).toLowerCase()), setRt: p => { Object.assign(menv.rt, p); },
  };
  const M = load('mobfarm').L2V7Factories.mobfarm(menv);
  const rules = [{ neg: false, quest: true, name: '' }, { neg: false, quest: false, name: 'guardian basilisk', farm: true }, { neg: false, all: true, name: '' }];
  let c = Array.from(M.candidates(rules, { ids: ['b1', 'o1'], quest: [] }, {}, 99), x => x.id);
  assert.ok(!c.includes('b1'), `«не по зубам» источник ресурса не выбирается (было: карта ↔ бой по кругу) ${JSON.stringify(c)}`);
  assert.ok(c.includes('o1'), 'обычный моб локации — цель');
  menv.rt.hardMobs = {};
  c = Array.from(M.candidates(rules, { ids: ['b1', 'o1'], quest: [] }, {}, 99), x => x.id);
  assert.equal(c[0], 'b1', 'без «не по зубам» источник ресурса — первым, как раньше');
  menv.rt.hardMobs = { 'quest basilisk': { t: Date.now() } };
  c = Array.from(M.candidates(rules, { ids: ['q1', 'o1'], quest: ['Quest Basilisk'] }, {}, 99), x => x.id);
  assert.equal(c[0], 'q1', '★ цель квеста «не по зубам» не отсекается (бой её тоже не отсекает)');
  console.log('PASS: hard farm source is not picked on the map (no map ↔ battle loop)');

  // 2. бой и карта согласованы: исключение «не по зубам» — квест и чемпион главы, источник ресурса — нет
  const cb = read('modules/combat.js');
  assert.match(cb, /const hd = !isRb && !ctx\.questKill && !\(ctx\.champ && env\.campActive\(\) && env\.campChampOpen\(\)\) && env\.rt\.hardMobs/, 'combat hard check mirrors map exemptions');
  console.log('PASS: combat and map agree on «не по зубам» exemptions');

  // 3. Маммон: заказ торговца не спрашивается заново после перезагрузки страницы (90 с)
  const store = {}; const sessionStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  let calls = 0;
  const mk = () => { const sb = load('mammon', { sessionStorage });
    const env = { rt: { mmNpc: { t: Date.now() } }, cfg: { mmOrders: true }, setRt: async p => Object.assign(env.rt, p), rec: () => {},
      gameGet: async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; } };
    return sb.L2V7Factories.mammon(env); };
  await mk().mmTick();
  const first = calls; assert.ok(first >= 1, 'first page load polls');
  await mk().mmTick(); await mk().mmTick();
  assert.equal(calls, first, `reloaded pages do not poll again within 90 s (calls ${calls})`);
  console.log('PASS: Mammon poll timestamps survive page reloads (no HTTP 429 spam)');
  finished = true;
})().catch(e => { console.error(e); process.exit(1); });
