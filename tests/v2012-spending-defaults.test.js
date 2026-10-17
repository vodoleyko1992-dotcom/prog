'use strict';
// 20.12 (ревизия 17.10, шаг 4 «траты по умолчанию»): базовый профиль не включает режимы и не переносит замеры Warlock 52,
// дейлик «Убей 1 РБ» без явной галки не покупает набор за FA, новый герой не наследует платные режимы, конец РБ-сессии
// при списке задач снимает тур, эпик после смерти без бесплатной дороги не берёт FA, тур не берёт FA без бюджета телепорта.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const core = require('../engine-core.js');

// ---------- (a) базовый профиль ----------
test('base-profile: нет ключей режимов, ручного оружия, замеров боя Warlock 52 и пароля', () => {
  const raw = read('base-profile.json'), B = JSON.parse(raw), rt = B.chars.Warlock.rt;
  for (const k of [...core.MODE_KEYS, 'weaponManual', 'nWeaponMain']) assert.equal(k in B.cfg, false, 'режим/оружие в профиле: ' + k);
  for (const k of ['rbHuntMode', 'rbMode', 'rbBetween', 'epicMode', 'fishMode', 'catMode', 'zoneAuto', 'enchantMode', 'campaign', 'autoTasks']) assert.ok(core.MODE_KEYS.includes(k), 'в списке режимов: ' + k);
  for (const k of ['skills', 'rbK', 'rbDps', 'rbStats', 'hardMobs', 'zoneBad', 'lvl']) assert.equal(k in rt, false, 'замер боя в профиле: ' + k);
  assert.equal(/passw|"auth"/i.test(raw), false, 'пароль/auth');
  // остальное сохранено: настройки, справочники, база ресурсов, автообучение
  assert.equal(B.cfg.tvtOn, true); assert.equal(B.cfg.fishBait, 'auto'); assert.equal(B.cfg.nHeal, 'Corpse Life Drain');
  for (const k of ['spawns', 'rbList', 'rbDb', 'zoneStat', 'lootStat', 'faCat', 'zoneCat']) assert.ok(rt[k] != null, 'справочник сохранён: ' + k);
  assert.equal(Object.keys(B.farmDb.res).length, 378); assert.ok(B.learn?.pages);
  assert.equal(raw.split('\n').length, 2, 'одна строка JSON + перевод строки');
});

function baseFixture(cur, base) {
  const state = clone(cur), sets = [];
  const box = { console, Date, JSON, Object, Array, String, buf: [], flush: () => {}, globalThis: { L2EngineCore: core },
    fetch: async () => ({ ok: true, json: async () => clone(base) }),
    chrome: { runtime: { getURL: p => 'chrome-extension://x/' + p }, storage: { local: { get: async keys => { const k = [].concat(keys); return clone(Object.fromEntries(k.filter(x => x in state).map(x => [x, state[x]]))); }, set: async p => { sets.push(clone(p)); Object.assign(state, clone(p)); } } } } };
  const src = read('background.js'), i = src.indexOf('async function applyBaseProfile('), j = src.indexOf('\n}\n', i) + 3;
  vm.runInNewContext(src.slice(i, j), box);
  return { state, sets, run: why => box.applyBaseProfile(why) };
}
test('applyBaseProfile: даже старый профиль с режимами не включает их на чистой установке', async () => {
  const base = { l2botBase: 1, cfg: { rbHuntMode: true, rbMode: true, epicMode: true, zoneAuto: true, weaponManual: true, nWeaponMain: 'Посох спрайта', shopReserve: 200000, tvtOn: true },
    chars: { Warlock: { rt: { lvl: 52, skills: { blaze: { dmg: 1 } }, rbK: 0.1, rbDps: 2783, rbStats: { x: { hp: 1 } }, hardMobs: { a: {} }, zoneBad: { z: 1 }, spawns: { s: ['Mob', 40] }, rbList: { r: {} }, weapons: [1] } } } };
  const f = baseFixture({}, base); await f.run('test');
  assert.deepEqual(f.state.cfg, { shopReserve: 200000, tvtOn: true }, 'режимы и ручное оружие отфильтрованы');
  assert.deepEqual(Object.keys(f.state.rt).sort(), ['char', 'rbList', 'spawns'], 'замеры боя и снаряжение не переносятся');
  // повторный запуск браузера: замеров ещё нет, но память уже есть — профиль не ложится поверх
  f.state.rt.spawns.mine = ['Own', 50]; const before = f.sets.length; await f.run('startup');
  assert.equal(f.sets.length, before, 'нет повторной записи'); assert.deepEqual(f.state.rt.spawns.mine, ['Own', 50]);
  // уже установленный игрок: его cfg (с режимом) не трогаем
  const g = baseFixture({ cfg: { rbHuntMode: true, shopReserve: 5 } }, base); await g.run('update');
  assert.deepEqual(g.state.cfg, { rbHuntMode: true, shopReserve: 5 });
});

// ---------- (b) дейлик «Убей 1 РБ» ----------
function buffsFixture(cfg, rt) {
  const now = Date.now(), env = { cfg: { rbSessBuffs: 'auto', rbSessNob: true, faBuffs: '', townBuffSet: 'basic', rbHuntMode: true, rbMode: true, ...cfg },
    rt: { faBal: { v: 101, t: now }, rbHunt: { step: 'go' }, tbT: 0, ...rt }, TB_KEYS: { basic: [1068] }, IL: {}, FA_KNOWN: {}, $q: () => null,
    setRt: async p => Object.assign(env.rt, p), rec: () => {}, heroRole: () => ({ mage: true }), epicFaOk: () => false, waitX: async f => f() || null, epicBuffCol: () => null, sleep: async () => {} };
  const sb = { console, Date, Math, JSON, document: { querySelectorAll: () => [] }, location: { pathname: '/map.html', href: '/map.html' } };
  sb.globalThis = sb; vm.createContext(sb); vm.runInContext(read('fa-full.js'), sb); vm.runInContext(read('modules/buffs.js'), sb);
  env.faCost = id => sb.L2FaFull.COST[id] || 1;
  return { env, B: sb.L2V7Factories.buffs(env) };
}
test('тур по дейлику РБ не покупает фулл бафф за FA без явной галки dailyRbFa', () => {
  const daily = { day: '2026-10-17', k0: 0, t: Date.now(), prev: {}, entering: false };
  const off = buffsFixture({}, { dailyRb: daily });
  assert.deepEqual([...off.B.faWanted()], [], 'дейлик: набор не нужен');
  const on = buffsFixture({ dailyRbFa: true }, { dailyRb: daily });
  assert.ok(on.B.faWanted().length >= 5, 'явная галка — набор как в «Туре РБ»');
  const tour = buffsFixture({}, {});
  assert.ok(tour.B.faWanted().length >= 5, 'обычный тур без дейлика — как прежде');
  const content = read('content.js'), popup = read('popup.js'), html = read('popup.html');
  assert.match(content, /dailyRbFa: false,/); assert.match(popup, /dailyRbFa: false,/); assert.match(popup, /'dailyRbFa'/); assert.match(html, /id="dailyRbFa" type="checkbox"/);
});

// ---------- (c) новый герой ----------
function switchFixture(extra = {}) {
  const src = read('background.js'), start = src.indexOf('async function switchCharacter('), end = src.indexOf('// 8.0.6 (Firefox', start);
  const cfg = { epicMode: true, epicCoinDailyMax: 30, epicAdenaDailyMax: 5000000, rbHuntMode: true, rbMode: true, rbFaFull: true, epicFaFull: true, fishTimeAuto: true, mmUpgrade: true,
    autoTasks: ['raid', 'epic', 'fish', 'tvt'], enemyHunt: true, pvpOnSight: true, shopReserve: 12345, tvtOn: true };
  const state = { on: false, cfg, rt: { char: 'Warlock' }, ...clone(extra) };
  const box = { Date, LOCK_TTL: 85000, serializeLock: fn => fn(), globalThis: { L2EngineCore: core }, chrome: { storage: { local: { get: async () => clone(state), set: async p => Object.assign(state, clone(p)) } } } };
  vm.runInNewContext(src.slice(start, end), box);
  return { state, cfg: clone(cfg), go: () => box.switchCharacter({ nick: 'Alt', vis: true, src: 't', roles: [], defRt: {} }, { tab: { id: 1, active: true } }) };
}
test('новый герой без cfg@Ник не наследует платные режимы и разрешения', async () => {
  const f = switchFixture(); assert.equal((await f.go()).ok, true);
  const c = f.state.cfg;
  for (const [k, v] of Object.entries(core.NEW_HERO_PAID)) assert.equal(c[k], v, k);
  for (const k of ['epicMode', 'epicCoinDailyMax', 'epicAdenaDailyMax', 'rbHuntMode', 'rbFaFull', 'epicFaFull', 'fishTimeAuto', 'mmUpgrade']) assert.ok(k in core.NEW_HERO_PAID, 'в списке: ' + k);
  assert.deepEqual(c.autoTasks, ['fish', 'tvt'], 'тур РБ и эпики сняты и из списка задач');
  assert.equal(c.enemyHunt, true); assert.equal(c.pvpOnSight, true); assert.equal(c.shopReserve, 12345); assert.equal(c.tvtOn, true);
  assert.deepEqual(f.state['cfg@Warlock'], f.cfg, 'профиль прежнего героя сохранён без изменений');
});
test('свой сохранённый cfg@Ник героя не меняется', async () => {
  const own = { epicMode: true, epicCoinDailyMax: 7, rbHuntMode: true, rbFaFull: true };
  const f = switchFixture({ 'cfg@Alt': own }); assert.equal((await f.go()).ok, true);
  assert.deepEqual(f.state.cfg, own);
});

// ---------- (d) конец РБ-сессии при списке задач ----------
test('конец РБ-сессии при autoTasks снимает «Тур РБ» из списка, журнал не пишет «Автофарм»', async () => {
  const load = f => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html' } }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };
  const recs = [], sets = [], env = { rt: { rbKills: 5, exp: 0, adena: 0, deaths: [], rbSess: { on: true, bought: true, until: Date.now() + 30000, t0: Date.now() - 60000 } },
    cfg: { autoTasks: ['raid', 'fish', 'tvt'], rbSessBuffs: '1413', faBuffs: '' }, setRt: async p => Object.assign(env.rt, p), setCfg: async p => { sets.push(clone(p)); Object.assign(env.cfg, p); },
    rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, hudBuffs: () => ({ 1413: Date.now() + 30000 }), townBuffStart: async () => true, faCost: () => 1 };
  const R = load('modules/raid.js').L2V7Factories.raid(env);
  assert.equal(await R.rbSessTick(), true);
  assert.equal(env.rt.rbSess.on, false);
  assert.deepEqual(env.cfg.autoTasks, ['fish', 'tvt'], 'тур снят из выбранных задач');
  const view = core.taskConfig(env.cfg, () => env.rt); assert.equal(view.rbHuntMode, false, 'тур РБ больше не выбран');
  assert.doesNotMatch(recs.join('\n'), /режим «Автофарм»/); assert.match(recs.join('\n'), /«Тур РБ» снят из выбранных задач/);
  // без списка — как прежде: автофарм
  const env2 = { ...env, rt: { ...env.rt, rbSess: { on: true, bought: true, until: Date.now() + 30000 } }, cfg: { rbHuntMode: true, rbSessBuffs: '1413', faBuffs: '' } };
  env2.setCfg = async p => Object.assign(env2.cfg, p); env2.setRt = async p => Object.assign(env2.rt, p);
  const R2 = load('modules/raid.js').L2V7Factories.raid(env2); assert.equal(await R2.rbSessTick(), true);
  assert.equal(env2.cfg.rbHuntMode, false); assert.equal(env2.cfg.zoneAuto, true);
});

// ---------- (e) эпик после смерти ----------
test('эпик после смерти (noPay) без бесплатной дороги не разрешает набор за FA', () => {
  const { mk, docOf, base } = require('./epic-harness.cjs');
  const stats = { ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } };
  const db = () => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, lifeT: Date.now() - 3600000 } });
  const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
  const mkE = (doc, epic) => mk({ doc: docOf(doc), cfg: { epicCoinDailyMax: 20 }, rt: { epicDb: db(), rbStats: stats, epic, faBal: { v: 101, t: Date.now() } }, env: { faFullIds: () => [1413, 1323], faCost: () => 1 } });
  assert.equal(mkE('<div></div>', { step: 'prep', k: 'orfen', route: 'page' }).E.epicFaOk(), true, 'обычный заход — набор за FA');
  const dead = mkE('<div></div>', { step: 'prep', k: 'orfen', route: 'page', noPay: true });
  assert.equal(dead.E.epicFaOk(), false, 'после смерти без логова и без эпика на карте — FA не тратим');
  assert.match(dead.E.epicBuffWhy(Date.now(), true), /только бесплатно или через логово/);
  assert.equal(mkE('<div></div>', { step: 'prep', k: 'orfen', route: 'page', lairOnly: true }).E.epicFaOk(), false, 'только логово, а его нет');
  assert.equal(mkE(pin, { step: 'prep', k: 'orfen', route: 'page', noPay: true }).E.epicFaOk(), true, 'эпик на этой карте — бесплатная дорога, набор нужен');
});

// ---------- (f) тур РБ: бюджет телепорта до набора за FA ----------
function raidFixture(adena) {
  const file = path.join(__dirname, 'v1021-raid-farm-lifecycle.test.js'), source = fs.readFileSync(file, 'utf8');
  const box = { require: require('node:module').createRequire(file), __dirname, console, process };
  vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nthis.make=fixture;', box);
  const f = box.make({ cfg: { rbHuntMode: false }, rt: { adenaSeen: { v: adena, t: Date.now() } } });
  let buys = 0; const recs = [];
  f.env.townBuffStart = async why => { if (/перед РБ/.test(why)) buys++; return false; };
  f.env.gameGet = async () => ({ ok: true, json: async () => ({ character: { name: 'TestHero', inBattle: false, adena } }) });
  const rec = f.env.rec; f.env.rec = (...a) => { recs.push(a.join(' ')); return rec?.(...a); };
  return { f, buys: () => buys, recs };
}
test('тур РБ: при нехватке адены на телепорт набор за FA не покупается', async () => {
  const poor = raidFixture(250000);   // резерв 200 000 + телепорт 100 000 > 250 000
  await poor.f.R.rbHuntStep();
  assert.equal(poor.buys(), 0, 'FA-набор не куплен');
  assert.match(poor.recs.join('\n'), /бафф за FA не беру — на телепорт 100000 не хватает адены/);
  const rich = raidFixture(1000000);
  await rich.f.R.rbHuntStep();
  assert.equal(rich.buys(), 1, 'адены хватает — подготовка как прежде');
  // несвежий кошелёк перечитывается до покупки, а не пропускается
  const stale = raidFixture(250000); stale.f.env.rt.adenaSeen = { v: 9e9, t: Date.now() - 10 * 60000 };
  await stale.f.R.rbHuntStep();
  assert.equal(stale.buys(), 0, 'перечитанный кошелёк показал нехватку');
  assert.equal(stale.f.env.rt.adenaSeen.v, 250000);
});
