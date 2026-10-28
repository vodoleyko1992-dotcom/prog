'use strict';
// 20.71: отдельный Rebirth в этих старых сценариях выключен; его guard включён в зависимости стенда.
// 22.10: выделенный крафт владеет кругом даже без работы; законченный бой не начинает следующую охоту.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../content.js', 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const loop = section('const isCraftPage', '// PvP, «один РБ»');   // 24.10: вместе с переходом на /craft.html
function fixture() {
  const calls = [], f = { mode: 'craft', on: true, tabOwner: true, cfg: { tvtOn: true }, rt: {}, fighting: false, fishing: false, hooked: false, hold: false, ab: false, role: 'crafter',
    autonomyMode: () => f.mode, antibotGuard: async () => f.ab, isBattle: () => f.fighting, isFishing: () => f.fishing, fishState: () => f.hooked,
    battle: async () => calls.push('battle'), fishFight: async () => calls.push('fish'), shopStep: async () => calls.push('shop'),
    sleep: async () => {}, setStatus: s => calls.push(s), calls, console, Date, JSON,
    location: { pathname: '/craft.html', set href(v) { calls.push('go ' + v); } }, ss: new Map(), rtCommit: async () => {},
    sessionStorage: { getItem: k => f.ss.get(k) ?? null, setItem: (k, v) => f.ss.set(k, v) },
    L2V7Modules: { subclass: { role: () => f.role }, craft: { step: async () => { calls.push('craft'); return false; }, text: () => 'очередь выполнена' },
      tvt: { tvtHold: () => f.hold, tvtWait: async () => calls.push('tvt') }, actions: { hasPending: () => false, dispatch: async () => { calls.push('dispatch'); return true; } } } };
  vm.createContext(f); vm.runInContext(loop, f); return f;
}
test('крафт с пустой/готовой очередью держит круг, показывает ожидание', async () => {
  const f = fixture(); assert.equal(await f.loopCraft(), true); assert.deepEqual(f.calls, ['craft', 'Крафт: очередь выполнена']);
});
for (const kind of ['battle', 'fish', 'tvt']) test(`${kind}: начатая срочная работа раньше крафта`, async () => {
  const f = fixture(); if (kind === 'battle') f.fighting = true;
  if (kind === 'fish') { f.fishing = true; f.hooked = {}; } if (kind === 'tvt') f.hold = true;
  assert.equal(await f.loopCraft(), true); assert.deepEqual(f.calls, [kind]);
});
test('капча, Stop, потеря хозяина, смена режима во время await запрещают крафт', async () => {
  for (const change of [f => { f.ab = true; }, f => { f.on = false; }, f => { f.tabOwner = false; }, f => { f.mode = 'farm'; }]) {
    const f = fixture(); f.antibotGuard = async () => { change(f); return f.ab; };
    assert.equal(await f.loopCraft(), true); assert.deepEqual(f.calls, []);
  }
});
test('выключенный/другой режим не забирает обычный круг', async () => {
  const f = fixture(); f.mode = 'farm'; assert.equal(await f.loopCraft(), false); assert.deepEqual(f.calls, []);
});
test('неизвестная оплата и существующий владелец обслуживаются до расхода ресурсов', async () => {
  for (const pending of [false, true]) {
    const f = fixture(); if (pending) f.L2V7Modules.actions.hasPending = () => true; else f.rt.actionOwner = { key: 'shop' };
    assert.equal(await f.loopCraft(), true); assert.deepEqual(f.calls, ['dispatch']);
  }
});
test('явная срочная закупка передаётся общему диспетчеру', async () => {
  const f = fixture(); f.rt.shop = { urgent: true, t: Date.now() }; await f.loopCraft(); assert.deepEqual(f.calls, ['dispatch']);
});
test('диспетчер без действия после смены режима не пропускает старый круг к крафту', async () => {
  const f = fixture(); f.rt.actionOwner = {};
  f.L2V7Modules.actions.dispatch = async () => { f.mode = 'farm'; return false; };
  await f.loopCraft(); assert.deepEqual(f.calls, []);
});
test('не крафтер: объяснение без расхода и автоматической смены класса', async () => {
  const f = fixture(); f.role = 'fighter'; await f.loopCraft(); assert.deepEqual(f.calls, ['Крафт: выберите класс крафтера — класс сам не переключаю']);
});
test('явная команда смены саба исполняется и на другом классе, затем не держит крафт', async () => {
  const f = fixture(); f.role = 'fighter'; f.rt.subGo = {};
  f.L2V7Modules.subgo = { step: async () => { f.calls.push('subGo'); f.rt.subGo = null; f.role = 'crafter'; return true; } };
  await f.loopCraft(); assert.deepEqual(f.calls, ['subGo']); f.calls.length = 0;
  await f.loopCraft(); assert.deepEqual(f.calls, ['craft', 'Крафт: очередь выполнена']);
});
test('поздний результат шага после Stop не заменяет статус нового режима', async () => {
  const f = fixture(); f.L2V7Modules.craft.step = async () => { f.on = false; }; await f.loopCraft(); assert.deepEqual(f.calls, []);
});
test('настоящий mainTick: срочное/сверка маршрута раньше крафта; обычные службы и фарм не стартуют', async () => {
  const f = fixture(), tick = section('async function mainTick()', '// Замок вкладки');
  for (const key of ['loopLease','loopMigrations','loopGate','loopWatchdog','loopUrgent','loopSelfHold','loopTravel','loopTaskList','loopRebirth','loopEnchant','loopPriority','loopMenuJobs','loopStartPrep','loopTownJobs','loopSideJobs','loopSelfHoldWait','loopRaid','loopActivity'])
    f[key] = async () => { f.calls.push(key); return false; };
  vm.runInContext(tick, f); assert.equal(await f.mainTick(), true);
  assert.deepEqual(f.calls.slice(0, 10), ['loopLease','loopMigrations','loopGate','loopWatchdog','loopUrgent','loopSelfHold','loopTravel','loopTaskList','loopRebirth','loopEnchant']);
  assert.ok(f.calls.includes('craft')); assert.ok(!f.calls.includes('loopPriority')); assert.ok(!f.calls.includes('loopActivity'));
});
test('старые автоматические маршруты сняты и в legacy, и при выбранных службах; квитанции остаются', async () => {
  for (const cfg of [{ craftMode: true }, { autoTasks: ['craft','mammon','petbuff'] }]) {
    const f = fixture(); f.cfg = cfg; f.rt = { char: 'Local', shop: {}, tbuff: {}, invScan: {}, mmJob: {}, petBufferTrip: {},
      actionPayments: { pending: { kind: 'shop', id: 'unresolved' } }, craftMpPending: { rev: 12 }, craftPending: { code: 'steel' } };
    f.taskPolicyNote = () => {}; f.setRt = async p => { Object.assign(f.rt, p); return { ok: true }; };
    f.rec = () => {}; f.sealQueue = async () => { throw Error('посторонняя служба не должна запускаться'); };
    vm.runInContext(fs.readFileSync(__dirname + '/../engine-core.js', 'utf8'), f);
    vm.runInContext(section('async function loopTaskList()', '// 15.10: заточка'), f);
    assert.equal(await f.loopTaskList(), true);
    for (const key of ['shop','tbuff','invScan','mmJob','petBufferTrip']) assert.equal(f.rt[key], null, key);
    assert.equal(f.rt.actionPayments.pending.id, 'unresolved'); assert.equal(f.rt.craftMpPending.rev, 12); assert.equal(f.rt.craftPending.code, 'steel');
    if (!cfg.autoTasks) assert.equal(f.cfg.autoTasks, undefined, 'legacy профиль не превращается в другой набор задач');
  }
});
test('явные проверки меню сохранены политикой крафта и выполняются без прежнего actionOwner', async () => {
  for (const key of ['shop','invScan','bagCheck','faScan','recipeScan','farmScan','zoneScan']) {
    const f = fixture(); f.cfg = { autoTasks: ['craft'] }; f.rt[key] = { manual: true };
    vm.runInContext(fs.readFileSync(__dirname + '/../engine-core.js', 'utf8'), f);
    assert.equal(f.L2EngineCore.taskJobAllowed(f.cfg, key, f.rt), true); await f.loopCraft(); assert.deepEqual(f.calls, ['dispatch']);
  }
});
test('nextFight в крафте завершает бой выходом; смена режима во время дневного GET также отменяет новую охоту', async () => {
  for (const initial of ['craft', 'farm']) {
    const calls = [], f = { rebirthModeSelected:()=>false, on: true, tabOwner: true, mode: initial, rt: {}, autonomyMode: () => f.mode,
      dailyServerSync: async () => { calls.push('daily'); f.mode = 'craft'; }, toMap: async () => calls.push('map'),
      L2V7Modules: { mobfarm: { nextFight: async () => calls.push('hunt') } }, selfHoldApplies: () => false };
    vm.createContext(f); vm.runInContext(section('async function nextFight(', '\n', ), f); await f.nextFight();
    assert.deepEqual(calls, initial === 'craft' ? ['map'] : ['daily', 'map']);
  }
});
test('подключённая фабрика получает режим и защиту от старых служб, без бессрочного rbSess запрета', () => {
  const f = { cfg: { craftMode: true }, rt: { rbSess: { on: true }, epic: { step: 'fight' } }, mode: 'craft',
    autonomyMode: () => f.mode, antibotState: () => false, L2V7Modules: { mammon: { modeFree: () => false }, payments: { blocked: () => false } },
    L2V7Factories: { craft: env => env } };
  vm.createContext(f); vm.runInContext(section('L2V7Modules.craft =', '// 20.43 (John 21.10): набор крафтера'), f);
  const env = f.L2V7Modules.craft; assert.equal(env.mode(), 'craft'); assert.equal(env.free(), true);
  for (const key of ['shop','travelCheck','revive','tbuff','magister','invScan','petBufferTrip','subTrip','mmJob','subGo','actionOwner']) {
    f.rt[key] = {}; if (key === 'travelCheck') f.L2V7Modules.navigation = { travelPending: () => true };
    assert.equal(env.free(), false, key); delete f.rt[key]; delete f.L2V7Modules.navigation;
  }
  f.mode = 'farm'; assert.equal(env.free(), false, 'фоновый крафт подчиняется прежнему modeFree');
});
// 24.10 (John: «надо, чтобы бот открывал страницу крафта сам в режиме активного крафта»)
test('крафтер в режиме крафта сам открывает /craft.html, на странице крафта — крафтит', async () => {
  const f = fixture(); f.location.pathname = '/city.html';
  assert.equal(await f.loopCraft(), true); assert.deepEqual(f.calls, ['Крафт: открываю страницу крафта', 'go /craft.html']);
  f.calls.length = 0; f.location.pathname = '/craft.html'; await f.loopCraft(); assert.deepEqual(f.calls, ['craft', 'Крафт: очередь выполнена']);
});
test('страница крафта не открывается: после 3 переходов за 2 мин крафт идёт на месте', async () => {
  const f = fixture(); f.location.pathname = '/city.html';
  for (let i = 0; i < 3; i++) await f.loopCraft();
  f.calls.length = 0; await f.loopCraft(); assert.deepEqual(f.calls, ['craft', 'Крафт: очередь выполнена']);
});
test('на страницу крафта не уходит из боя, рыбалки, TvT и без класса крафтера', async () => {
  for (const set of [f => { f.fighting = true; }, f => { f.fishing = true; f.hooked = true; }, f => { f.hold = true; }, f => { f.role = 'fighter'; }]) {
    const f = fixture(); f.location.pathname = '/city.html'; set(f); await f.loopCraft();
    assert.ok(!f.calls.some(x => /^go /.test(x)), f.calls.join());
  }
});
