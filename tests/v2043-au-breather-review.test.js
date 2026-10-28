'use strict';
// 20.43 (автономность, ревью au/breather): две находки ревью «передышки».
// 1) Карта тура/эпика. После отсрочки «карта не загрузилась после 3 обновлений» тур сразу платил телепорт к следующему РБ (≈100 000 аден),
//    не проверив, работает ли карта вообще: при общем сбое (карта и спавны не отдаются, а список РБ и POST телепорта живы) — до 4 платных
//    перелётов за ≈15 мин вместо одного. И 4-я отсрочка обнуляла счёт вида ДО мягкого halt, а он при неотвечающем сервере уходит в ожидание
//    сервера — после ответа ещё 3 платных перелёта до следующей попытки стопа. Теперь метка «карта не подтверждена» (rt.mapBad): платный путь
//    тура/эпиков — только после бесплатной свежей загрузки карты (content.mapGate), не загрузилась — передышка тура без телепорта; счёт вида
//    обнуляется только после настоящей остановки.
// 2) Передышка держала весь круг главного цикла (шаг сразу после срочных): Маммон, квесты, дейлики/клан, баффер кота, опрос эпиков, команды
//    меню («🛒 Закупить сейчас», «Проверить эпиков»), сверка неизвестной оплаты стояли 5–30 мин. Теперь ждёт только основная работа —
//    loopSelfHoldWait после всех служб, перед туром РБ и основной работой; сторож вкладки молчит, только пока круг дошёл до ожидания.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const { mk } = require('./epic-harness.cjs');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000;
const HOLD_SRC = slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы');
const LOOP_SRC = slice(content, 'const LOOP_BREAK =', '// Магистр: актуальный');
const TB_SRC = content.match(/^async function townBuffStart\(.*$/m)[0];
// 20.71: в обычных service/breather-стендах отдельный Rebirth выключен.
const base = () => ({ rebirthModeSelected: () => false, L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Promise, URL });

// ---------- content.selfHoldStart: счёт вида — только после настоящей остановки ----------
function holdBox({ tasks = ['raid'], mode = 'raid', rt: rt0 = {}, halt } = {}) {
  const calls = [], recs = [];
  const c = { ...base(), rt: { char: 'Hero', manualKickAt: 5, ...rt0 }, cfg: tasks ? { autoTasks: tasks } : {}, on: true, tabOwner: true,
    location: { pathname: '/map.html', href: '' }, automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, p); return { ok: true }; }, rtCommit: async () => true,
    rec: (...a) => recs.push(a), setStatus() {}, sleep: async () => {}, autonomyMode: () => mode };
  c.halt = halt ? (...a) => halt(c, ...a) : async (msg, hard) => { calls.push(['halt', msg, hard]); c.on = false; };
  vm.createContext(c); vm.runInContext(HOLD_SRC + ';this.start=selfHoldStart;this.gate=mapGate;', c);
  return { c, calls, recs };
}
// 20.43 (доводка 21.10): отсрочки noWait — свой счёт rt.selfHoldDefer (раньше общий с передышками вида в selfHoldLog), в причине — «отсрочки»
for (const kind of ['raidMap', 'epicMap']) test(`4-я отсрочка карты (${kind}): мягкий halt ушёл в ожидание сервера — счёт не обнуляется, следующий сбой сразу ведёт к стопу`, async () => {
  const t = Date.now(), log = [t - 3 * MIN, t - 2 * MIN, t - MIN], halts = [];
  let serverUp = false;
  const f = holdBox({ rt: { selfHoldDefer: { [kind]: [...log] } }, halt: async (c, msg, hard) => { halts.push([msg, hard]); if (serverUp) c.on = false; } });
  assert.equal(await f.c.start(kind, 'Тур РБ: карта не загрузилась после 3 обновлений (цель Первый)', { noWait: true }), null, 'ни отсрочки, ни стопа');
  assert.match(halts[0][0], /3 отсрочки за 6 ч не помогли/); assert.equal(halts[0][1], false, 'мягкий стоп: лежащий сервер — ждём сервер');
  assert.equal(f.c.on, true); assert.deepEqual([...f.c.rt.selfHoldDefer[kind]], log, 'счёт сохранён — новых отсрочек (и платных перелётов) не будет');
  // после ответа сервера тот же сбой — снова план «стоп», бот выключается, и только теперь счёт с нуля (новый Старт даст ещё 3)
  serverUp = true;
  assert.equal(await f.c.start(kind, 'Тур РБ: карта не загрузилась после 3 обновлений (цель Второй)', { noWait: true }), 'stop');
  assert.equal(halts.length, 2); assert.equal(f.c.on, false); assert.deepEqual([...f.c.rt.selfHoldDefer[kind]], []);
});
test('stall (жёсткий стоп) — как прежде: стоп сразу, счёт с нуля', async () => {
  const t = Date.now(), f = holdBox({ rt: { selfHoldLog: { stall: [t - 3, t - 2, t - 1] } } });
  assert.equal(await f.c.start('stall', 'нет прогресса', { hard: true }), 'stop'); assert.equal(f.calls[0][2], true); assert.deepEqual([...f.c.rt.selfHoldLog.stall], []);
});

// ---------- content.mapGate: бесплатная проверка карты перед платным путём ----------
function gateBox({ path: page = '/rb-bosses.html', ready = false, mapBad, tasks = ['raid', 'farm'] } = {}) {
  const f = holdBox({ tasks, rt: mapBad === undefined ? {} : { mapBad } }), c = f.c, holds = [];
  c.location.pathname = page; c.isMap = () => c.location.pathname === '/map.html';
  c.mapReady = async () => (typeof ready === 'function' ? ready() : ready);
  c.selfHoldStart = async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'hold'; };
  const nav = () => { if (c.location.href) { c.location.pathname = c.location.href; c.location.href = ''; } };
  return { ...f, holds, nav };
}
test('mapGate: без метки — платный путь разрешён сразу; на Ashen — сначала свой бесплатный выход', async () => {
  const g = gateBox(); assert.equal(await g.c.gate('raidMap', 'Тур РБ'), false); assert.equal(g.c.location.href, '');
  const a = gateBox({ path: '/ashen-bastion.html', mapBad: { at: Date.now() } }); assert.equal(await a.c.gate('raidMap', 'Тур РБ'), false); assert.equal(a.c.location.href, '');
  const s = gateBox({ mapBad: { at: Date.now() } }); assert.equal(await s.c.gate('raidMap', 'Тур РБ', () => false), true, 'запуск сменился — дальше не идём'); assert.equal(s.c.location.href, '');
});
test('mapGate: метка — свежая загрузка /map.html, карта не загрузилась — передышка вида raidMap, повтор снова со свежей загрузкой', async () => {
  const g = gateBox({ mapBad: { at: Date.now() - MIN, why: 'тур РБ, Первый', loadAt: 0 } });
  assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.c.location.href, '/map.html'); assert.ok(g.c.rt.mapBad.loadAt > 0); assert.equal(g.holds.length, 0);
  assert.equal(g.recs.length, 1); assert.match(g.recs[0][2], /сначала проверяю карту здесь, бесплатно/);
  g.nav(); assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true);
  assert.equal(g.holds.length, 1); assert.equal(g.holds[0].kind, 'raidMap'); assert.match(g.holds[0].why, /^Тур РБ: карта не загружается и при бесплатной проверке \(тур РБ, Первый\) — платный перелёт не начинаю/);
  assert.equal(g.holds[0].opt, undefined, 'обычная передышка (учёт, 4-я за 6 ч — стоп), не noWait');
  assert.equal(g.c.rt.mapBad.loadAt, 0, 'следующая проверка — снова со свежей загрузкой'); assert.ok(g.c.rt.mapBad.at > 0, 'метка стоит');
  assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.c.location.href, '/map.html'); assert.equal(g.recs.length, 1, 'строка в журнал — один раз на метку');
});
test('mapGate: карта загрузилась — метка снята, строка в журнал; дальше платный путь разрешён', async () => {
  const g = gateBox({ path: '/map.html', ready: true, mapBad: { at: Date.now() - MIN, loadAt: Date.now() - 1000, said: true } });
  assert.equal(await g.c.gate('epicMap', 'Эпики'), true); assert.equal(g.c.rt.mapBad, null); assert.equal(g.holds.length, 0);
  assert.match(g.recs.at(-1)[2], /^Эпики: карта снова загружается — продолжаю, платный перелёт разрешён/);
  assert.equal(await g.c.gate('epicMap', 'Эпики'), false);
});
test('mapGate: переход на карту ещё идёт — ждём ≤ 60 с без передышки; не открылась за минуту — передышка; смена задачи и лежащий сервер — без передышки', async () => {
  let g = gateBox({ mapBad: { at: Date.now() - MIN, loadAt: Date.now() - 5000, said: true } });
  assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.holds.length, 0); assert.equal(g.c.location.href, '');
  g = gateBox({ mapBad: { at: Date.now() - 2 * MIN, loadAt: Date.now() - 61000, said: true } });
  assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.holds.length, 1);
  for (const ready of ['changed', 'down']) {
    g = gateBox({ path: '/map.html', ready, mapBad: { at: Date.now() - MIN, loadAt: Date.now() - 1000, said: true } });
    assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.holds.length, 0, ready); assert.ok(g.c.rt.mapBad.loadAt > 0, ready);
  }
  // страница карты старше 5 мин — не судим по ней, свежая загрузка
  g = gateBox({ path: '/map.html', ready: () => assert.fail('старая страница — не проверка'), mapBad: { at: Date.now() - 10 * MIN, loadAt: Date.now() - 6 * MIN, said: true } });
  assert.equal(await g.c.gate('raidMap', 'Тур РБ'), true); assert.equal(g.c.location.href, '/map.html'); assert.equal(g.holds.length, 0);
});

// ---------- тур РБ: настоящий raid.rbHuntStep + настоящий content.mapGate ----------
const lifecycle = path.join(__dirname, 'v1021-raid-farm-lifecycle.test.js'), lsrc = fs.readFileSync(lifecycle, 'utf8');
const lbox = { require: require('node:module').createRequire(lifecycle), __dirname, console, process };
vm.runInNewContext(lsrc.slice(0, lsrc.indexOf('\ntest(')) + '\nthis.fixture=fixture;this.page=page;this.pin=pin;this.docOf=docOf;', lbox);
function wireGate(m) {
  const holds = [], g = { ...base(), location: m.loc, on: true, tabOwner: true, automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null, cfg: {},
    setRt: async p => { await m.env.setRt(p); return { ok: true }; }, rtCommit: async () => true, rec: (...a) => m.logs.push(a.slice(1).join(' ')),
    setStatus() {}, sleep: async () => {}, isMap: () => m.env.isMap(), mapReady: (...a) => m.env.mapReady(...a), autonomyMode: () => 'raid' };
  Object.defineProperty(g, 'rt', { get: () => m.env.rt, set() {} });
  vm.createContext(g); vm.runInContext(HOLD_SRC + ';this.gate=mapGate;', g);
  g.selfHoldStart = async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'hold'; };
  m.env.mapGate = (...a) => g.gate(...a);
  const nav = () => { if (m.loc.href) { const u = new URL(m.loc.href, 'https://fixture.invalid'); m.loc.pathname = u.pathname; m.loc.search = u.search; m.loc.href = ''; } };
  return { holds, nav };
}
test('общий сбой карты: после отсрочки первого РБ тур не платит за следующего, пока карта не подтверждена; карта ожила — один платный перелёт', async () => {
  const m = lbox.fixture({ rt: { rbHunt: { step: 'arrive', phase: 'arrive', id: 'one', name: 'Первый', lvl: 80, page: 1, at: Date.now(), t: 1, mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } } });
  const { holds, nav } = wireGate(m), defer = [];
  m.env.selfHold = async (kind, why, opt) => { defer.push({ kind, opt }); return opt?.noWait ? 'defer' : 'hold'; };
  m.env.mapReady = async () => false;           // карта и спавны не отдаются, а список РБ и телепорт живы
  await m.R.rbHuntStep();
  assert.equal(defer.length, 1); assert.equal(defer[0].kind, 'raidMap'); assert.equal(defer[0].opt.noWait, true);
  assert.ok(m.env.rt.rbSkip.one.until > Date.now(), 'Первый отложен на 30 мин'); assert.ok(m.env.rt.mapBad?.at > 0, 'метка «карта не подтверждена»');
  assert.equal(m.env.rt.rbHunt.step, 'pick'); assert.match(m.logs.join('\n'), /следующий платный перелёт — только после проверки карты/);
  for (let i = 0; i < 12; i++) { await m.R.rbHuntStep(); nav(); }
  assert.equal(m.fires.length, 0, 'ни одного платного перелёта (раньше — к Второму сразу)'); assert.equal(m.env.rt.rbGoCnt?.two, undefined);
  assert.notEqual(m.env.rt.rbHunt.step, 'go'); assert.ok(holds.length >= 1 && holds.every(h => h.kind === 'raidMap'), 'вместо перелёта — передышка тура с учётом');
  // карта ожила: проверка снимает метку, тур продолжает и платит один раз
  m.env.mapReady = async () => true;
  for (let i = 0; i < 6 && m.env.rt.rbHunt.step !== 'go'; i++) { await m.R.rbHuntStep(); nav(); }
  assert.equal(m.env.rt.mapBad, null); assert.match(m.logs.join('\n'), /карта снова загружается/);
  assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.env.rt.rbHunt.id, 'two');
  m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(lbox.docOf(lbox.page('two', 'Второй')));
  m.env.fire = el => { m.fires.push(el); m.loc.pathname = '/map.html'; m.setDoc(lbox.docOf(lbox.pin('two', 'Второй'))); return true; };
  await m.R.rbHuntStep(); assert.equal(m.fires.length, 1); assert.equal(m.env.rt.rbHunt.step, 'arrive'); assert.equal(m.env.rt.rbGoCnt.two.length, 1);
});
test('сохранённый шаг «go» при метке: сначала проверка карты (raidMap), без списка и оплаты; без метки — прежний путь', async () => {
  const m = lbox.fixture(); await m.R.rbHuntStep(); assert.equal(m.env.rt.rbHunt.step, 'go');
  m.env.rt.mapBad = { at: Date.now(), why: 'тест', loadAt: 0 };
  const gates = []; m.env.mapGate = async (...a) => { gates.push(a.slice(0, 2)); return true; };
  m.loc.pathname = '/rb-bosses.html'; m.loc.search = '?page=1'; m.setDoc(lbox.docOf(lbox.page('one', 'Первый')));
  await m.R.rbHuntStep();
  assert.equal(JSON.stringify(gates), JSON.stringify([['raidMap', 'Тур РБ']])); assert.equal(m.fires.length, 0); assert.equal(m.env.rt.rbHunt.step, 'go'); assert.equal(m.loc.href, '');
  delete m.env.rt.mapBad; m.env.mapGate = async () => assert.fail('без метки проверка карты не нужна');
  m.env.fire = el => { m.fires.push(el); m.loc.pathname = '/map.html'; m.setDoc(lbox.docOf(lbox.pin('one', 'Первый'))); return true; };
  await m.R.rbHuntStep(); assert.equal(m.fires.length, 1); assert.equal(m.env.rt.rbHunt.step, 'arrive');
});
test('прилёт тура: карта загрузилась — метка «карта не подтверждена» снимается', async () => {
  const m = lbox.fixture({ rt: { rbHunt: { step: 'arrive', id: 'one', name: 'Первый', at: Date.now(), t: 1 }, mapBad: { at: Date.now() - MIN } } });
  m.setDoc(lbox.docOf(lbox.pin('one', 'Первый'))); await m.R.rbHuntStep(); assert.equal(m.env.rt.mapBad, null);
});

// ---------- эпики ----------
test('эпики: при метке подготовка и дорога начинаются с бесплатной проверки карты (epicMap); отсрочка карты ставит метку, карта на прилёте — снимает', async () => {
  for (const step of ['prep', 'go']) {
    const gates = [], m = mk({ rt: { epic: { step, k: 'ak', name: 'Queen Ant', at: Date.now(), t: Date.now() }, mapBad: { at: Date.now() } },
      env: { mapGate: async (...a) => { gates.push(a.slice(0, 2)); return true; } } });
    await m.E.epicStep();
    assert.equal(JSON.stringify(gates), JSON.stringify([['epicMap', 'Эпики']]), step); assert.equal(m.fires.length, 0); assert.equal(m.loc.href, ''); assert.equal(m.env.rt.epic.step, step);
  }
  const d = mk({ rt: { epic: { step: 'arrive', k: 'ak', via: 'zone', at: Date.now(), t: Date.now(), mapLoadT: Date.now() - 5 * MIN, mapLoadReloads: 3 } },
    env: { mapReady: async () => false, selfHold: async (k, w, o) => (o?.noWait ? 'defer' : 'hold') } });
  await d.E.epicStep(); assert.ok(d.env.rt.mapBad?.at > 0); assert.match(d.env.rt.mapBad.why, /эпики/); assert.ok(d.env.rt.epicDb.ak.skipT > Date.now()); assert.equal(d.env.rt.epic.step, 'pick');
  const ok = mk({ rt: { epic: { step: 'arrive', k: 'ak', via: 'zone', at: Date.now(), t: Date.now() }, mapBad: { at: Date.now() } } });
  await ok.E.epicStep(); assert.equal(ok.env.rt.mapBad, null);
});

// ---------- главный цикл: передышка держит только основную работу ----------
function loopBox({ tasks = null, mode = 'farm', hold = null, rt: rt0 = {}, cfg: cfg0 = {} } = {}) {
  const calls = [], status = [], ticks = [], now = Date.now();
  const note = (name, ret = false) => async () => { calls.push(name); return ret; };
  const c = { ...base(),
    rt: { char: 'Hero', manualKickAt: 5, ...(hold ? { selfHold: { kind: 'mob', why: 'Клик по мобу 3 раза подряд не открыл бой', at: now - MIN, until: now + 10 * MIN, kick: 5, ...hold } } : {}), ...rt0 },
    cfg: { tvtOn: false, ...(tasks ? { autoTasks: tasks } : {}), ...cfg0 }, on: true, tabOwner: true, location: { pathname: '/char.html', search: '', href: '' },
    automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null, setRt: async p => { Object.assign(c.rt, p); return { ok: true }; }, rtCommit: async () => true,
    rec() {}, setStatus: s => status.push(s), sleep: async () => {}, taskPolicyNote() {}, isBattle: () => false, isFishing: () => false, fishState: () => null,
    fishNow: () => false, tvtSoon: () => false, battle: note('battle'), fishFight: note('fishFight'), tasksIdle: note('tasksIdle'), pveFishingStep: note('pveFishing'),
    antibotGuard: async () => false, inventoryReady: async () => true, shopStep: note('shopStep'), magisterDisable: async () => {}, magisterStart: async () => false,
    magisterStep: note('magisterStep'), townBuffStep: note('townBuffStep'), huntOn: () => false, farmRbOn: () => false, rbGoStep: note('rbGoStep'), farmGuideTick() {},
    modErr() {}, warlockTripStep: note('warlockTrip'), epicOn: () => mode === 'epic', epicStep: note('MAIN:epicStep'),
    meHp: () => null, mobHp: () => null, serverDown: () => false, progressMonitor: { tick: (sig, active) => { ticks.push([sig, active]); return 'ok'; } },
    L2V7Modules: { pvp: { seedConfirmed: async () => {}, step: async () => false, pending: () => null }, raid: { rbOneStep: async () => false }, enemies: { tick: async () => {}, step: async () => false },
      tvt: { tvtHold: () => false, tvtWait: note('tvtWait') }, actions: { dispatch: note('dispatch'), canAct: () => true }, fishing: { castReconcile: note('castReconcile') },
      mammon: { mmTick: note('mmTick'), mmStep: note('mmStep') }, subclass: { tick: async () => {} }, story: { storyTick: note('storyTick'), storyStep: note('storyStep') },
      tvtshop: { shopStep: async () => false }, dailies: { tick: note('dailiesTick'), clanStep: note('clanStep'), dailyStep: note('dailyStep') },
      warlock: { step: note('warlockStep'), raidPrepare: async () => false }, epics: { epicPollTick: note('epicPoll'), epicScanAll: note('epicScanAll') },
      buffs: { townBuffStart: note('buyBuffs') }, payments: { blocked: () => false, pending: () => null } } };
  c.autonomyMode = () => { const t = E.selectedTask(c.cfg, c.rt); return t === 'quests' ? 'campaign' : t === 'auto' ? 'farm' : t || mode; };
  vm.createContext(c); vm.runInContext(HOLD_SRC + '\n' + TB_SRC + '\n' + LOOP_SRC, c);
  c.realWatchdog = c.loopWatchdog;
  for (const k of ['loopLease', 'loopMigrations', 'loopGate', 'loopWatchdog', 'loopUrgent']) c[k] = async () => {};
  c.loopRaid = note('MAIN:raid', true); c.loopActivity = note('MAIN:activity', true); c.sealQueue = async () => false;
  return { c, calls, status, ticks, tick: () => vm.runInContext('mainTick()', c), LOOP: () => vm.runInContext('LOOP', c) };
}
const SERVICES = ['dispatch', 'mmTick', 'mmStep', 'storyTick', 'storyStep', 'dailiesTick', 'clanStep', 'dailyStep', 'warlockStep'];
test('без списка задач (заводское): передышка фарма не держит службы — Маммон, квесты, дейлики/клан, баффер кота, сверка оплаты идут; основная работа ждёт', async () => {
  const f = loopBox({ hold: { task: null, mode: 'farm' } });
  assert.equal(await f.tick(), true);
  for (const s of SERVICES) assert.ok(f.calls.includes(s), `${s}: ${JSON.stringify(f.calls)}`);
  assert.ok(!f.calls.some(x => x.startsWith('MAIN:')), 'основная работа (тур, карта, бой с новым мобом) ждёт');
  assert.ok(!f.calls.includes('buyBuffs'), 'набор баффов под ждущую работу не покупаем'); assert.ok(!f.calls.includes('pveFishing'));
  assert.match(f.status.at(-1), /^Передышка до \d\d:\d\d: Клик по мобу 3 раза подряд не открыл бой/); assert.ok(Date.now() - f.LOOP().holdWaitT < 1000);
  // контроль: без передышки — та же цепочка служб и основная работа
  const n = loopBox(); assert.equal(await n.tick(), true);
  for (const s of SERVICES) assert.ok(n.calls.includes(s), s);
  assert.ok(n.calls.includes('MAIN:raid')); assert.ok(n.calls.includes('buyBuffs')); assert.ok(n.calls.includes('pveFishing'));
});
test('режим задач, держится сама «tasks» (фарм цели ресурса) с Маммоном и дейликами: службы идут, ожидание — только вместо основной работы', async () => {
  const f = loopBox({ tasks: ['resources', 'mammon', 'dailies'], hold: { task: 'tasks', mode: null } });
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'tasks');
  assert.equal(await f.tick(), true);
  for (const s of ['dispatch', 'mmTick', 'mmStep', 'dailiesTick', 'clanStep', 'dailyStep']) assert.ok(f.calls.includes(s), `${s}: ${JSON.stringify(f.calls)}`);
  assert.ok(!f.calls.some(x => x.startsWith('MAIN:'))); assert.match(f.status.at(-1), /^Передышка до/);
});
for (const tasks of [null, ['resources', 'mammon']]) test(`«🛒 Закупить сейчас» и «Проверить эпиков» на передышке выполняются (${tasks ? 'режим задач' : 'без списка'})`, async () => {
  const hold = tasks ? { task: 'tasks' } : { task: null, mode: 'farm' };
  const f = loopBox({ tasks, hold, rt: { shop: { urgent: true, t: Date.now() } } });
  assert.equal(await f.tick(), true); assert.ok(f.calls.includes('shopStep'), JSON.stringify(f.calls)); assert.ok(!f.calls.some(x => x.startsWith('MAIN:')));
  const e = loopBox({ tasks, hold, rt: { epicScanReq: { t: Date.now() } } });
  assert.equal(await e.tick(), true); assert.ok(e.calls.includes('epicScanAll'), JSON.stringify(e.calls));
});
test('неизвестная оплата на передышке: сверка (actions.dispatch) идёт и заканчивает круг', async () => {
  const f = loopBox({ hold: { task: null, mode: 'farm' } }); f.c.L2V7Modules.actions.dispatch = async () => { f.calls.push('dispatch'); return true; };
  assert.equal(await f.tick(), true); assert.deepEqual(f.calls.filter(x => ['dispatch', 'mmStep'].includes(x) || x.startsWith('MAIN:')), ['dispatch']);
});
test('режим эпиков на передышке: свой цикл не начинается, опрос списка эпиков идёт', async () => {
  const f = loopBox({ mode: 'epic', hold: { kind: 'epicMap', task: null, mode: 'epic' } });
  assert.equal(await f.tick(), true); assert.ok(f.calls.includes('epicPoll')); assert.ok(!f.calls.some(x => x.startsWith('MAIN:')), JSON.stringify(f.calls));
  const n = loopBox({ mode: 'epic' }); assert.equal(await n.tick(), true); assert.ok(n.calls.includes('MAIN:epicStep'));
});
test('передышка другой работы (режим сменился) основную работу не держит; истекла — «окончена» и обычный круг', async () => {
  const f = loopBox({ mode: 'raid', hold: { task: null, mode: 'farm' } }); assert.equal(await f.tick(), true); assert.ok(f.calls.includes('MAIN:raid'));
  const x = loopBox({ hold: { task: null, mode: 'farm', until: Date.now() - 1 } }); assert.equal(await x.tick(), true);
  assert.equal(x.c.rt.selfHold, null); assert.ok(x.calls.includes('MAIN:raid'));
});
test('сторож вкладки: молчит, только пока круг дошёл до ожидания передышки; служба во время передышки — под присмотром', async () => {
  const f = loopBox({ hold: { task: null, mode: 'farm' }, rt: { mmJob: { t: Date.now() } } });
  await f.c.realWatchdog(); assert.notEqual(f.ticks[0][0], '', 'круг занят службой (Маммон) — обычный отсчёт'); assert.equal(f.ticks[0][1], true);
  vm.runInContext('LOOP.holdWaitT = Date.now()', f.c); await f.c.realWatchdog(); assert.deepEqual(f.ticks[1], ['', false], 'ожидание передышки — не «нет прогресса»');
  vm.runInContext('LOOP.holdWaitT = Date.now() - 16000', f.c); await f.c.realWatchdog(); assert.notEqual(f.ticks[2][0], '');
});
