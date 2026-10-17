'use strict';
// 20.13 (ревизия 17.10, шаг 5 — застревания задач, участок farm): MF-1, MF-2, NAV-1, NAV-2, DG-1, KPD-1.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MOB = read('modules/mobfarm.js'), NAV = read('modules/navigation.js'), DUN = read('modules/dungeons.js');
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const sandbox = (extra = {}) => { const sb = { console, Date, Math, JSON, URLSearchParams, CSS: { escape: s => s }, location: { pathname: '/map.html', search: '', href: '' },
  document: { querySelector: () => null, querySelectorAll: () => [] }, sessionStorage: store(), ...extra }; sb.globalThis = sb; return sb; };

test('MF-1: счётчики простоя «Целей нет» переживают перезагрузку карты (sessionStorage), сброс — когда цели нашлись', () => {
  const i0 = MOB.indexOf('let farRecT = 0'), i1 = MOB.indexOf('function idleClear()'), i2 = MOB.indexOf('\n', i1);
  const decl = MOB.slice(i0, i2 + 1), ss = store();
  const load = () => { const c = { Date, JSON, sessionStorage: ss }; vm.runInNewContext(decl + 'this.api = { idleLoad, idleSave, idleClear, get: () => ({ idleT0, idleN, idleRecT }), set: (a, b, r) => { idleT0 = a; idleN = b; idleRecT = r; } };', c); return c.api; };
  // первая загрузка карты: простой начался
  let a = load(); a.idleLoad(); a.set(Date.now() - 200000, 1, 0); a.idleSave();
  // перезагрузка (/map.html) — модуль создан заново, но счёт продолжается
  a = load(); a.idleLoad(); let s = a.get();
  assert.equal(s.idleN, 1, 'проходов карты подряд — с прошлой загрузки'); assert.ok(Date.now() - s.idleT0 >= 200000, 'начало простоя сохранено');
  a.set(s.idleT0, 4, 123); a.idleSave(); a = load(); a.idleLoad(); s = a.get();
  assert.equal(s.idleN, 4); assert.equal(s.idleRecT, 123, 'время последней записи в журнал тоже сохранено');
  // цели нашлись — сохранённый счёт стёрт
  a.idleClear(); a = load(); a.idleLoad(); assert.equal(a.get().idleN, 0);
  // запись старше 10 мин не продолжается
  ss.setItem('l2bot.mapIdle', JSON.stringify({ t0: 1, n: 9, recT: 0, at: Date.now() - 700000 })); a = load(); a.idleLoad(); assert.equal(a.get().idleN, 0, 'старый простой — новый счёт');
  // в map(): загрузка до idleN++, сохранение до перехода на /map.html, сброс со стиранием
  const blk = MOB.slice(MOB.indexOf('    idleLoad();'), MOB.indexOf("if (env.on) { location.href = '/map.html'"));
  assert.ok(blk.indexOf('idleLoad()') < blk.indexOf('idleN++') && blk.includes('idleSave();'), 'load → ++ → save перед перезагрузкой');
  assert.ok(/idleT0 = 0; idleN = 0; +\/\/ 10\.0\.10: цели есть[^\n]*\n\s+idleRecT = 0; idleClear\(\);/.test(MOB), 'цели есть — счёт и хранилище сброшены');
});

test('MF-2: netSpawns не подставляет «синий» вместо неизвестного цвета чемпиона', async () => {
  const sb = sandbox(); vm.runInNewContext(MOB, sb);
  const env = { rt: {}, cfg: {}, isRaidId: () => false, setRt: async p => Object.assign(env.rt, p), rec() {}, tabIdle: true };
  const M = sb.L2V7Factories.mobfarm(env);
  await M.netSpawns([['dense_77', 'champion', 'Odd Champ', 50, 0, '', 1000, 50], ['champ_r_1', 'champion', 'Red', 50, 0, '', 0, 0], ['x_2', 'champion', 'Told', 50, 0, 'orange', 0, 0]]);
  assert.equal(env.NET_SPAWNS.tier.dense_77, undefined, 'неизвестный цвет остаётся неизвестным');
  assert.equal(M.champTier('dense_77', null, ''), '', 'решение о нём — за tierOff (пусто, а не blue)');
  assert.equal(env.NET_SPAWNS.tier.champ_r_1, 'red'); assert.equal(env.NET_SPAWNS.tier.x_2, 'orange');
  assert.equal(env.NET_SPAWNS.hp.dense_77, 1000, 'HP/EXP чемпиона по-прежнему записаны'); assert.equal(env.NET_SPAWNS.exp.dense_77, 50);
});

function navFixture({ zoneId = 'z1', here = 'z1' } = {}) {
  const loc = { pathname: '/teleport.html', search: '', href: '' };
  const row = { textContent: '', querySelector: s => s === '.l2-teleport-miru-price-num' ? { textContent: '5000' } : s === '.l2-teleport-miru-price-currency' ? { textContent: 'аден', querySelectorAll: () => [] } : null };
  const btn = { closest: () => row };
  const sb = sandbox({ location: loc, document: { body: { innerText: '' }, querySelector: () => null, querySelectorAll: s => /city-btn/.test(s) ? [{}] : [] } });
  vm.runInNewContext(NAV, sb);
  const g = { id: zoneId, t: Date.now() }, fired = [], recs = [];
  const env = { on: true, tabOwner: true, cfg: {}, rt: { char: 'Hero', manualKickAt: 1, zoneGo: g }, fired, recs,
    sleep: async () => {}, waitX: async f => f(), shown: () => true, $q: s => /tp-btn/.test(s) ? btn : null, setStatus() {}, rec: (...a) => recs.push(a.slice(2).join(' ')),
    setRt: async p => (Object.assign(env.rt, p), { ok: true }), fire: b => { fired.push(b); return true; }, pauseBot: async () => { env.paused = true; },
    heroLvl: () => 60, gameGet: async () => ({ ok: true, json: async () => ({ character: { name: 'Hero', id: 7, revision: 3, currentZoneId: here, adena: '1000000' } }) }) };
  return { M: sb.L2V7Factories.navigation(env), env, g };
}
test('NAV-1: обычный телепорт в зону, где герой уже стоит, не оплачивается', async () => {
  let f = navFixture({ zoneId: 'z1', here: 'z1' });
  await f.M.zoneGoStep();
  assert.equal(f.env.fired.length, 0, 'кнопка «Телепорт» не нажата'); assert.equal(f.env.rt.zoneGo, null); assert.equal(f.env.rt.zone, 'z1');
  assert.ok(f.env.recs.some(r => /прибытие подтверждено сервером/.test(r)));
  f = navFixture({ zoneId: 'z1', here: 'z0' });
  await f.M.zoneGoStep();
  assert.equal(f.env.fired.length, 1, 'в другую зону — платный перелёт как прежде');
});

function lvlFixture() {
  const sb = sandbox(); vm.runInNewContext(NAV, sb);
  const cat = { A: { name: 'Zone A', lo: 72, hi: 80, city: 'c' }, B: { name: 'Zone B', lo: 72, hi: 80, city: 'c' }, C: { lo: 1, hi: 10, city: 'c' }, D: { lo: 11, hi: 20, city: 'c' }, E: { lo: 21, hi: 30, city: 'c' } };
  const recs = [], env = { on: true, cfg: { lvlAbove: 5, lvlBelow: 5 }, rt: { zone: 'A', zoneCat: cat, zoneCatT: Date.now() }, recs,
    heroLvl: () => 78, pageItems: () => [60, 64, 70].map(lvl => ({ lvl })), setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.slice(2).join(' ')), sleep: async () => {} };
  return { M: sb.L2V7Factories.navigation(env), env };
}
test('NAV-2: прилетел по уровню, а своих мобов нет — зона 6 ч «плохая»; два таких перелёта подряд — остаёмся', async () => {
  const { M, env } = lvlFixture();
  assert.equal(await M.zoneForLevel(), true, 'первый перелёт по уровню'); assert.equal(env.rt.zoneGo.id, 'B'); assert.equal(env.rt.zoneLvlGo.id, 'B');
  // прилетели в B — у точки снова 60–70
  Object.assign(env.rt, { zone: 'B', zoneGo: null, zoneLvlT: 0 });
  // (ревью) первый проход по ещё пустой карте не стирает отметку перелёта
  const items = env.pageItems; env.pageItems = () => [];
  assert.equal(await M.zoneForLevel(), false); assert.equal(env.rt.zoneLvlGo?.id, 'B', 'пустая страница — не «свои нашлись»');
  env.pageItems = items;
  assert.equal(await M.zoneForLevel(), true, 'B не годится → дальше, но не обратно без отметки');
  assert.ok(env.rt.zoneBad.B > 0, 'B помечена «плохой»'); assert.equal(env.rt.zoneLvlMiss.n, 1); assert.equal(env.rt.zoneGo.id, 'A');
  // прилетели в A — и там то же: второй неудачный перелёт подряд → остаёмся
  Object.assign(env.rt, { zone: 'A', zoneGo: null, zoneLvlT: 0 });
  assert.equal(await M.zoneForLevel(), false, 'остаёмся'); assert.equal(env.rt.zoneGo, null); assert.ok(env.rt.zoneBad.A > 0); assert.equal(env.rt.zoneLvlMiss.n, 2);
  assert.ok(env.recs.some(r => /2-й перелёт подряд/.test(r)));
  env.rt.zoneLvlT = 0; assert.equal(await M.zoneForLevel(), false, '6 ч новых перелётов по уровню нет'); assert.equal(env.rt.zoneGo, null);
  // свои мобы появились — счёт с нуля
  env.pageItems = () => [{ lvl: 77 }]; await M.zoneForLevel(); assert.equal(env.rt.zoneLvlMiss, null);
});

function catFixture({ hard = true, list } = {}) {
  const loc = { pathname: '/dungeon.html', search: '?dungeonId=d1', href: '', reload() { loc.reloaded = (loc.reloaded || 0) + 1; } };
  const sb = sandbox({ location: loc }); vm.runInNewContext(DUN, sb);
  const mobs = list || [['m1', 'normal', 'Ghoul', 60, 0], ['m2', 'normal', 'Ghoul', 61, 0], ['m3', 'normal', 'Rat', 40, 0]];
  const recs = [], st = [], env = { on: true, tabOwner: true, CAT_URL: '/catacombs.html', CAT_LIST: { d1: ['Dung One', 55, 65], d2: ['Dung Two', 55, 65] },
    cfg: { catMode: true, catDungeon: 'auto', lvlAbove: 5, lvlBelow: 5 }, rt: { char: 'Hero', hardMobs: hard ? { ghoul: { t: Date.now() } } : {} }, recs, st, loc,
    heroLvl: () => 60, dungNet: () => ({ id: 'd1', t: Date.now(), mobs }), waitX: async f => f(), $q: () => null, shown: () => false, sleep: async () => {},
    setStatus: s => st.push(s), rec: (...a) => recs.push(a.slice(2).join(' ')), setRt: async p => Object.assign(env.rt, p), pause: async () => {}, idle: async (ms, s) => { st.push(s); } };
  return { M: sb.L2V7Factories.dungeons(env), env };
}
test('DG-1: мобы по уровню есть, но отфильтрованы — подземелье не банится и бот не летит, причина в журнале', async () => {
  const { M, env } = catFixture();
  await M.catHunt('d1');
  assert.equal(env.rt.catBad?.d1, undefined, 'бана на час нет'); assert.equal(env.loc.href, '', 'перелёта в «Катакомбы» нет');
  assert.ok(env.recs.some(r => /2, но все не цели \(2 «не по зубам»\)/.test(r)), env.recs.join('\n'));
  assert.ok(env.st.some(s => /не цели: 2 «не по зубам» — жду/.test(s)));
  // повтор в течение 10 мин — журнал не засоряется
  await M.catHunt('d1'); assert.equal(env.recs.filter(r => /все не цели/.test(r)).length, 1);
  // мобов по уровню действительно нет — прежнее поведение: бан и поиск другого подземелья
  const g = catFixture({ hard: false, list: [['m3', 'normal', 'Rat', 40, 0]] });
  await g.M.catHunt('d1'); assert.ok(g.env.rt.catBad.d1 > 0); assert.equal(g.env.rt.catBadWhy.d1, 'нет мобов по уровню'); assert.equal(g.env.loc.href, '/catacombs.html');
});
test('DG-1: все подземелья в бане — честный статус «на паузе до HH:MM», а не «не знаю уровень героя»', async () => {
  const { M, env } = catFixture();
  env.rt.catBad = { d1: Date.now() - 1000, d2: Date.now() - 2000 };
  await M.catGo();
  assert.ok(env.st.some(s => /все подземелья на паузе до \d\d:\d\d/.test(s)), env.st.join('\n'));
  assert.ok(!env.st.some(s => /не знаю уровень героя/.test(s)));
  env.heroLvl = () => 0; env.st.length = 0; await M.catGo(); assert.ok(env.st.some(s => /не знаю уровень героя/.test(s)), 'уровень неизвестен — прежний статус');
});

test('KPD-1: окно модели КПД не шире фильтра целей (выше — lvlAbove, ниже — не больше 5)', () => {
  const c = { console }; c.globalThis = c; vm.runInNewContext(read('zone-kpd.js'), c);
  const K = c.L2Kpd;
  let cal = K.learn({ rt: {}, cfg: { lvlAbove: 5, lvlBelow: 5, zoneAbove: 10 } }, 60);
  assert.equal(cal.above, 5, 'сверху как у mobfarm.candidates'); assert.equal(cal.below, 5);
  cal = K.learn({ rt: {}, cfg: { lvlAbove: 15, lvlBelow: 9, zoneAbove: 10 } }, 60);
  assert.equal(cal.above, 10, 'lvlAbove шире — прежний верх модели'); assert.equal(cal.below, 5, 'ниже героя −5 — не цели (FA)');
  cal = K.learn({ rt: {}, cfg: { lvlAbove: 3, lvlBelow: 0 } }, 60);
  assert.equal(cal.above, 3); assert.equal(cal.below, 5, '«0» = 5, как lowCap');
});
