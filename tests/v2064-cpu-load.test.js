'use strict';
// 20.64 (John 25.10 после 20.62: «стало лучше, что ещё можем сделать для облегчения нагрузки вообще без потери качества и скорости»).
// Замер в настоящем Chromium (стенд с расширением, заглушки игры с размерами из журналов 25.10): каждая запись памяти героя стоит
// ≈1,5–1,7 мс ЦП на КБ по всем процессам, память героя у игрока 764–928 КБ; встроенное меню с бесконечными анимациями держит
// перерисовку каждый кадр (GPU 5,6 → 0,5 с/мин без них); журнал на каждый сброс (раз в 1,5 с) считал все 20 000 строк (≈21 мс);
// прокси cfg на каждое чтение настройки (≈62 000 в минуту в бою) считал выбранную задачу. Здесь — что исправлено и что не изменилось.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };
const core = require('../engine-core.js');
const DEF = require('../defaults.js').CFG;

// ---------- 1. Журнал: число строк без count() на каждый сброс ----------
function journal({ max = 10 } = {}) {
  const rows = new Map(); let next = 1, counts = 0, failAdd = false;
  const writes = [], timers = [];
  const store = {
    add(v) { if (failAdd) throw new Error('add failed'); rows.set(next++, structuredClone(v)); },
    count() { counts++; const r = {}; queueMicrotask(() => r.onsuccess?.({ target: { result: rows.size } })); return r; },
    openKeyCursor(range, dir) {                                  // как IndexedDB: запрос видит хранилище на момент своей очереди (до add этого пакета)
      assert.equal(range, null); assert.equal(dir, 'prev');
      const keys = [...rows.keys()].sort((a, b) => a - b), k = keys[keys.length - 1];
      const r = {}; queueMicrotask(() => r.onsuccess?.({ target: { result: k == null ? null : { key: k } } })); return r;
    },
    openCursor(range) {
      const r = {}; let keys = null, i = 0;
      const emit = () => queueMicrotask(() => {
        keys ||= [...rows.keys()].sort((a, b) => a - b).filter(k => !range || k <= range.upper);
        const k = keys[i];
        r.onsuccess?.({ target: { result: k == null ? null : { key: k, delete() { rows.delete(k); }, continue() { i++; emit(); } } } });
      });
      emit(); return r;
    },
  };
  const db = { transaction() { const tx = { objectStore: () => store }; setTimeout(() => tx.oncomplete?.(), 5); return tx; } };
  const c = { MAX_EV: max, idb: async () => db, console: { warn() {} }, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; },
    IDBKeyRange: { upperBound: k => ({ upper: k }) }, chrome: { storage: { local: { set: async o => { writes.push(o); } } } }, Promise, Date, Math, structuredClone };
  const bg = read('background.js');
  vm.runInNewContext(slice(bg, 'const txDone', '// Старый pending не содержит revision')
    + ';this.push=e=>buf.push(e);this.flush=flush;this.wait=()=>writing;this.bufN=()=>buf.length;', c);
  const step = async (n, tag) => { for (let i = 0; i < n; i++) c.push({ t: i, tag }); c.flush(); await c.wait(); };
  return { c, rows, writes, step, counts: () => counts, fail: v => { failAdd = v; }, keys: () => [...rows.keys()].sort((a, b) => a - b) };
}

test('журнал: count() — только при первом сбросе; дальше счёт в памяти фона, лишние строки — самые старые до пакета', async () => {
  const J = journal({ max: 10 });
  await J.step(4, 'a'); assert.equal(J.counts(), 1, 'первый сброс после запуска фона — пересчёт');
  assert.equal(J.writes.at(-1).reccount, 4);
  await J.step(3, 'b'); assert.equal(J.counts(), 1, 'второй сброс — без count()'); assert.equal(J.rows.size, 7); assert.equal(J.writes.at(-1).reccount, 7);
  await J.step(5, 'c'); assert.equal(J.counts(), 1);
  assert.deepEqual(J.keys(), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'удалены ровно 2 самые старые, новый пакет цел');
  assert.equal(J.writes.at(-1).reccount, 10);
  const w = J.writes.length;
  await J.step(2, 'd'); assert.deepEqual(J.keys(), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(J.writes.length, w, 'reccount не изменился — без записи в хранилище');
  assert.ok([...J.rows.values()].slice(-2).every(e => e.tag === 'd'));
});

test('журнал: «Очистить журнал» в меню (база очищена напрямую) — счёт с нуля, свежие строки не удаляются', async () => {
  const J = journal({ max: 10 });
  await J.step(10, 'a'); await J.step(3, 'b'); assert.equal(J.rows.size, 10);
  J.rows.clear(); J.writes.push({ reccount: 0 });              // popup recClear: clear() базы + reccount:0
  await J.step(2, 'c'); assert.equal(J.rows.size, 2, 'пакет после очистки сохранён целиком');
  assert.equal(J.writes.at(-1).reccount, 2);
  await J.step(3, 'd'); assert.equal(J.rows.size, 5); assert.equal(J.writes.at(-1).reccount, 5);
  assert.equal(J.counts(), 1, 'очистка распознана без пересчёта');
});

test('журнал: ошибка записи — пакет возвращается в буфер, следующий сброс пересчитывает строки', async () => {
  const J = journal({ max: 10 });
  await J.step(3, 'a'); J.fail(true); await J.step(2, 'b');
  assert.equal(J.c.bufN(), 2, 'пакет не потерян'); J.fail(false);
  J.c.flush(); await J.c.wait(); assert.equal(J.counts(), 2, 'после ошибки — снова count()'); assert.equal(J.rows.size, 5);
});

test('журнал: пересчёт раз в 200 сбросов (самолечение счёта)', async () => {
  const J = journal({ max: 50 });
  await J.step(1, 'x');
  for (let i = 0; i < 199; i++) await J.step(1, 'y');
  assert.equal(J.counts(), 1);
  await J.step(1, 'z'); assert.equal(J.counts(), 2, '200-й сброс после первого — count()');
  assert.equal(J.rows.size, 50);
});

// ---------- 2. Прокси cfg: selectedTask только для подменяемых ключей, значения те же ----------
// Прежняя ловушка 20.63 (дословно по смыслу): эталон для сравнения
const G = { mammon: ['mmOrders','mmUpgrade','mmShopBuy','mmSmithAuto','mmCraftSend','mmCraftNote','mmMailClaim','mmGoalFarm'],
  quests: ['storyTurnIn','campAuto'], dailies: ['dailyAuto'], clan: ['clanTasks'], pvp: ['enemyHunt','pvpOnSight','pvpAll'], petbuff: ['petFullAuto'], resources: ['subHelpMain','mmFarmBest','mmFarmGuide'] };
const SUP = ['autoMagister','weaponScanAuto','weaponClassEquip','weaponAuto','shopAuto','townBuff','autoLearn'];
function oldGet(target, key, rt) {
  const active = core.selectedTask(target, rt), allowed = k => core.taskAllowed(target, k);
  const primary = {enchantMode:'enchant',craftMode:'craft',epicMode:'epic',rbHuntMode:'raid',rbMode:'raid',fishMode:'fish',catMode:'cat',zoneAuto:'auto',campaign:'quests'};
  if (Object.hasOwn(primary,key)) return primary[key] === active;
  if (key === 'tvtOn') return allowed('tvt');
  if (key === 'taskOnly') return active === 'tasks';
  if (key === 'tvtOverRb') return true;
  if (key === 'tsBuy') return false;
  if (key === 'chain' && !['farm','auto','quests','cat'].includes(active)) return false;
  if (['farmRes','recipeRes','resQuests'].includes(key) && !allowed('resources')) return '';
  if (key === 'mmGoalItem' && !allowed('mammon')) return 0;
  if (key === 'mmGoalFarm' && !allowed('resources')) return false;
  for (const [group, keys] of Object.entries(G)) if (keys.includes(key) && !allowed(group)) return false;
  if (key === 'campAuto') return false;
  if (SUP.includes(key) && ['tasks','fish','enchant','craft'].includes(active)) return false;
  return Reflect.get(target,key);
}
function oldLegacy(target, key, rt) {
  const tasks = {fishMode:'fish',catMode:'cat',zoneAuto:'auto'};
  if (Object.hasOwn(tasks,key) && core.dailyBlocked(target,rt,tasks[key]) && !(key==='fishMode' && rt.fishCastActive)) return false;
  if (key==='taskOnly' && Object.entries(tasks).some(([flag,k])=>target[flag] && core.dailyBlocked(target,rt,k)) && !['enchantMode','craftMode','epicMode','rbHuntMode','campaign'].some(k=>target[k]) && !Object.entries(tasks).some(([flag,k])=>target[flag] && !core.dailyBlocked(target,rt,k))) return true;
  return Reflect.get(target,key);
}
const NOW = Date.now(), day = core.dailyDay(NOW, {});
const RTS = [{}, { fishCastActive: true }, { fish: { casts: 9 } }, { dailyQuota: { day, auto: 50, cat: 0, fish: 9, raid: 0 } },
  { selfHold: { fish: { task: 'fish', until: NOW + 600000, t: NOW } } }, { enchant: { status: 'done' } }, { campNoTasksUntil: NOW + 60000 }];
const TASKS = [['tvt','mammon','dailies','clan','pvp','resources','fish','auto'], ['tvt','mammon','dailies','clan','pvp','resources','epic'], ['enchant'], ['craft','quests'], [], ['cat','pvp'], ['farm','resources']];
const KEYS = [...new Set([...Object.keys(DEF), 'enchantMode','craftMode','epicMode','rbHuntMode','rbMode','fishMode','catMode','zoneAuto','campaign','tvtOn','taskOnly','tvtOverRb','tsBuy','chain',
  'farmRes','recipeRes','resQuests','mmGoalItem','mmGoalFarm','campAuto', ...Object.values(G).flat(), ...SUP, 'autoTasks', 'nope', 'searchQuest'])];

test('прокси cfg: для всех ключей и состояний — те же значения, что у прежней ловушки', () => {
  let n = 0;
  for (const tasks of TASKS) for (const rt of RTS) {
    const cfg = { ...DEF, autoTasks: tasks, dailyKillLimit: 60, dailyFishLimit: 10, fishMaxCasts: 5, farmRes: 'Oriharukon', mmGoalItem: 7, chain: true };
    const v = core.taskConfig(cfg, () => rt);
    for (const k of KEYS) { assert.deepEqual(v[k], oldGet(cfg, k, rt), `ключ ${k}, задачи ${tasks}, rt ${JSON.stringify(rt)}`); n++; }
  }
  for (const rt of RTS) {                                        // без списка задач, с дневными лимитами — второй (старый) прокси
    const cfg = { ...DEF, autoTasks: null, fishMode: true, zoneAuto: true, dailyKillLimit: 60, dailyFishLimit: 10 };
    const v = core.taskConfig(cfg, () => rt);
    for (const k of KEYS) { assert.deepEqual(v[k], oldLegacy(cfg, k, rt), `старый прокси, ключ ${k}`); n++; }
  }
  assert.ok(n > 3000);
});

test('прокси cfg: обычные ключи не считают задачу (runtime не вызывается), подменяемые — не больше одного расчёта на чтение', () => {
  let calls = 0; const rt = {};
  const v = core.taskConfig({ ...DEF, autoTasks: ['fish','auto'] }, () => { calls++; return rt; });
  for (const k of ['actionDelayMs', 'rbPotAt', 'drainHp', 'indMode', 'fightMode', 'nope']) void v[k];
  assert.equal(calls, 0, 'обычные настройки — без selectedTask');
  void v.autoMagister; assert.equal(calls, 1); void v.chain; assert.equal(calls, 2); void v.tvtOn; assert.equal(calls, 2, 'tvtOn — только разрешение задачи');
  let lc = 0; const L = core.taskConfig({ ...DEF, autoTasks: null, fishMode: true, dailyFishLimit: 5 }, () => { lc++; return rt; });
  void L.rbPotAt; void L.indMode; assert.equal(lc, 0); void L.fishMode; assert.equal(lc, 1);
});

// ---------- 3. Каталог предметов игры: устаревший не едет в каждой записи памяти ----------
const content = read('content.js');
function writer({ fresh = false, modules = true, idle = false } = {}) {
  const sent = [], timers = [], MIN = 60000;
  const c = { rt: { char: 'Hero', weaponCatalog: { t: Date.now() - 31 * MIN, version: 'v', items: { 7: { id: 7, k: 'W' } } } }, rtSizeT: 0, rtBigWarnT: 0,
    RT_BULKY: ['spawns'], rec() {}, rtSizeTop: () => '', tabIdle: idle, document: {}, Date, JSON, Object, Math, Promise };
  if (modules) c.L2V7Modules = { equipment: { weaponCatalogFresh: () => fresh ? c.rt.weaponCatalog : null } };
  c.rtWriter = core.createPatchQueue(async b => { sent.push(b); return { ok: true }; }, () => true, () => {}, () => Date.now(), { set: f => { timers.push(f); return timers.length; }, clear() {} });
  vm.runInNewContext(slice(content, 'function setRt(p) {', 'const RECENT = [];') + ';this.setRt=setRt;', c);
  return { c, sent, timers, settle: () => new Promise(r => setImmediate(r)) };
}
test('каталог: устаревший (30 мин) — null в памяти вкладки и отложенной записью вместе с ближайшим пакетом', async () => {
  const W = writer();
  const r = await W.c.setRt({ kills: 1 });
  assert.equal(r.deferred, true, 'статистика боя по-прежнему отложенная — без ожидания записи');
  assert.equal(W.c.rt.weaponCatalog, null);
  assert.equal(W.sent.length, 0); W.timers.forEach(f => f()); await W.settle();
  assert.equal(W.sent.length, 1); assert.deepEqual([...Object.keys(W.sent[0])].sort(), ['kills', 'weaponCatalog']); assert.equal(W.sent[0].weaponCatalog, null);
  const W2 = writer(); await W2.c.setRt({ lock2: 1 }); await W2.settle();
  assert.deepEqual([...Object.keys(W2.sent[0])].sort(), ['lock2', 'weaponCatalog'], 'обычная запись забирает null с собой');
});
test('каталог: свежий не трогаем; без модуля оружия и в неактивной вкладке — без ошибок и без записи', async () => {
  const F = writer({ fresh: true }); await F.c.setRt({ x: 1 }); await F.settle();
  assert.ok(F.c.rt.weaponCatalog?.items, 'свежий каталог цел'); assert.deepEqual([...Object.keys(F.sent[0])], ['x']);
  const N = writer({ modules: false }); await N.c.setRt({ x: 1 }); await N.settle();
  assert.ok(N.c.rt.weaponCatalog?.items); assert.deepEqual([...Object.keys(N.sent[0])], ['x']);
  const I = writer({ idle: true }); const r = await I.c.setRt({ x: 1 });
  assert.equal(r.ok, false); I.timers.forEach(f => f()); await I.settle(); assert.equal(I.sent.length, 0, 'вкладка без замка ничего не пишет');
  assert.match(read('modules/equipment.js'), /return \{ isRebirthRow, resolveWeaponItem, weaponItem, weaponCatalogFresh,/);
});

// ---------- 4. Память боя: отпечаток состава вместо строки 1,2–2,1 КБ, старая память совпадает ----------
function lab(context) {
  let now = 100000, seq = 0; const writes = [];
  const env = { rt: { char: 'Hero' }, cfg: {}, recoveryContext: () => context.v, actName: () => 'Blaze', mobTitle: () => '',
    setRt: async p => { writes.push(p); Object.assign(env.rt, p); return { ok: true }; } };
  const b = { Date: { now: () => now }, URLSearchParams, console }; vm.runInNewContext(read('modules/fightlab.js'), b);
  const L = b.L2V7Factories.fightlab(env);
  const start = () => { seq = 0; return L.onNet('/game/battle/start', { status: 200, bt: { actor: 'Hero', name: 'Safe Mob', spawn: 'main', mob: 10000, mobMax: 10000, seq: 0, log: [] } }); };
  const hit = dmg => { now += 1000; return L.onNet('/game/battle/action', { status: 200, req: { action: 'l2_1220' }, bt: { name: 'Safe Mob', spawn: 'main', mob: 9000, seq: ++seq, log: ['Полум’я ' + dmg] } }); };
  return { L, env, writes, start, hit };
}
const LONG = a => JSON.stringify({ char: 'Hero', setup: a, stats: { pAtk: 2915, mAtk: 1800 }, buffs: Array.from({ length: 14 }, (_, i) => ({ id: 1000 + i, lv: 3, until: 1e12 + i })), shots: 'B', eq: 'x'.repeat(900) });

test('память боя: в хранилище — короткий отпечаток состава; тот же состав находит прежние замеры, другой — нет', () => {
  const ctx = { v: LONG('A') }, T = lab(ctx);
  assert.ok(ctx.v.length > 1000);
  T.start(); for (let i = 0; i < 4; i++) T.hit(9000); T.L.finish('left'); T.L.flush();
  const fm = T.writes.filter(p => p.fightMem).at(-1).fightMem, row = fm['m:safe mob'].a.blaze;
  assert.ok(typeof row.context === 'string' && row.context.length <= 64, 'контекст — отпечаток: ' + row.context);
  assert.ok(JSON.stringify(fm).length < 600, 'память цели без полной строки состава');
  T.start(); assert.equal(T.L.dmgOn('Blaze').mean, 9000, 'тот же состав — прежние замеры работают');
  ctx.v = LONG('B'); assert.equal(T.L.dmgOn('Blaze'), null, 'другой состав — прежние замеры не обещают урон');
});

test('память боя: прежняя память с полными строками совпадает как раньше и облегчается при следующем сохранении', () => {
  const ctx = { v: LONG('A') }, T = lab(ctx);
  T.env.rt.fightMem = { 'm:safe mob': { nm: 'Safe Mob', k: 'm', n: 2, w: 2, l: 0, t: 99000,
    a: { blaze: { n: 4, s: [8000, 8000, 8000, 8000], z: 0, unknown: 0, rolls: [8000, 8000, 8000, 8000], evidence: 2, context: LONG('A') } } } };
  const before = JSON.stringify(T.env.rt.fightMem).length;
  T.start(); assert.equal(T.L.dmgOn('Blaze').mean, 8000, 'старая полная строка = текущий состав');
  T.hit(10000); T.hit(10000); T.L.finish('left'); T.L.flush();
  const fm = T.writes.filter(p => p.fightMem).at(-1).fightMem, row = fm['m:safe mob'].a.blaze;
  assert.deepEqual([...row.rolls], [8000, 8000, 8000, 8000, 10000, 10000], 'прежние замеры не сброшены');
  assert.ok(row.context.length <= 64); assert.ok(JSON.stringify(fm).length < before / 2, 'память стала меньше');
  ctx.v = LONG('C'); T.start(); assert.equal(T.L.dmgOn('Blaze'), null);
  const S = lab({ v: 'short-ctx' }); S.start(); for (let i = 0; i < 3; i++) S.hit(500); S.L.finish('left'); S.L.flush();
  assert.equal(S.writes.filter(p => p.fightMem).at(-1).fightMem['m:safe mob'].a.blaze.context, 'short-ctx', 'короткий контекст — как был');
});

// ---------- 5. Встроенное меню и окно на странице игры без покадровой перерисовки ----------
test('без бесконечных анимаций в меню и без размытия под окном бота', () => {
  const html = read('popup.html');
  assert.doesNotMatch(html, /animation:[^;}]*infinite/, 'бесконечная анимация держит перерисовку каждый кадр');
  assert.match(html, /#start\.running\{[^}]*box-shadow:0 0 6px 2px rgba\(111,224,127,\.5\)/, 'работающий бот — неподвижное свечение «Старта»');
  assert.match(html, /#heroLine \.state\.on::before\{[^}]*background:var\(--ok\)/, 'точка «работает» на месте');
  const css = slice(content, 'uiCss.textContent = `', '`;');
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.match(css, /#l2bot-ind\{[^}]*background:rgba\(20,16,13,\.93\)/);
});
