'use strict';
// 20.43 (автономность, сквозное ревью 21.10): маршруты и передышки.
// 1) В режиме задач передышка (rt.selfHold) и ожидание тура на рыбалке (rt.rbFishWait, отсрочка кота) меняют autonomyMode. Он входил в контекст
//    владельца маршрута (actions.context) и задания Маммона — конец передышки выглядел как «пользователь сменил режим»: начатый поход к
//    Маммону (после платного телепорта) и «Закупить сейчас» отменялись. Теперь в контексте routeMode = выбор игрока без этих пропусков.
// 2) Запрещённый после циклов маршрут: создатели его не пересоздают (Маммон, чтение сумки — routeBanned; перелёт/магистр/баффер/закупка —
//    отметки «была попытка»); пересоздание вхолостую 10 раз за 1 мин — пауза с причиной, а не передышка основной задачи; 4-й запрет одного
//    маршрута за 12 ч — стоп с причиной (раньше окно 6 ч при запрете 2 ч не достигалось никогда).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const MIN = 60000, H = 3600000;
const modeOf = t => t === 'quests' ? 'campaign' : t === 'auto' ? 'farm' : t;
const hold = (task, until = Date.now() + 10 * MIN, kick = 0) => ({ kind: 'mob', why: 'Клик по мобу 3 раза подряд не открыл бой', at: Date.now() - MIN, until, n: 1, task, kick });

// ---------- engine-core: baseTask ----------
test('baseTask: выбор игрока без передышки и без ожидания тура на рыбалке; без списка задач — null, как selectedTask', () => {
  const now = Date.now(), c = { autoTasks: ['farm', 'mammon'] };
  assert.equal(E.selectedTask(c, { selfHold: hold('farm') }, now), 'tasks'); assert.equal(E.baseTask(c, { selfHold: hold('farm') }, now), 'farm');
  assert.equal(E.baseTask({ autoTasks: ['fish', 'farm'] }, { selfHold: hold('fish') }, now), 'fish');
  // тур ждёт на рыбалке (отсрочка кота / пустой тур): фактически рыбалка, режим маршрута — тур
  const raidWait = { rbFishWait: { at: now - MIN, until: now + 20 * MIN, pet: true }, rbHunt: { phase: 'wait', step: 'pick' } };
  assert.equal(E.selectedTask({ autoTasks: ['raid', 'fish'] }, raidWait, now), 'fish'); assert.equal(E.baseTask({ autoTasks: ['raid', 'fish'] }, raidWait, now), 'raid');
  // настоящие решения игрока и счёт суток по-прежнему меняют выбор
  assert.equal(E.baseTask({ autoTasks: ['fish', 'farm'] }, {}, now), 'fish'); assert.equal(E.baseTask({ autoTasks: ['mammon'] }, {}, now), 'tasks');
  assert.equal(E.baseTask({ fishMode: true }, {}, now), null);
});
test('taskJobAllowed: обратный перелёт Маммона/квеста (zoneGo.svc) на передышке фарма не снимается; без службы и в «только задачах» — как прежде', () => {
  const now = Date.now(), back = { id: 'blazing_swamp', t: now, why: 'Маммон: обратно на точку', svc: 'mammon' };
  assert.equal(E.taskJobAllowed({ autoTasks: ['farm', 'mammon'] }, 'zoneGo', { selfHold: hold('farm'), zoneGo: back }), true, 'герой не остаётся у NPC');
  assert.equal(E.taskJobAllowed({ autoTasks: ['auto', 'quests'] }, 'zoneGo', { selfHold: hold('auto'), zoneGo: { ...back, svc: 'quests' } }), true);
  assert.equal(E.taskJobAllowed({ autoTasks: ['farm', 'mammon'] }, 'zoneGo', { selfHold: hold('farm'), zoneGo: { ...back, svc: undefined } }), false, 'перелёт самой задачи на передышке ждёт');
  assert.equal(E.taskJobAllowed({ autoTasks: ['mammon'] }, 'zoneGo', { zoneGo: back }), false, '«только задачи» — прежнее поведение');
  assert.equal(E.taskJobAllowed({ autoTasks: ['farm'] }, 'zoneGo', { selfHold: hold('farm'), zoneGo: back }), false, 'Маммон не выбран — служба не владеет перелётом');
  assert.equal(E.taskJobAllowed({ autoTasks: ['fish', 'mammon'] }, 'zoneGo', { zoneGo: back }), false, 'рыбалка — как прежде');
  assert.match(read('modules/mammon.js'), /zoneGo: \{ id: J\.home, t: Date\.now\(\), why: 'Маммон: обратно на точку', svc: 'mammon',/);
  assert.match(read('modules/story.js'), /zoneGo: \{ id: J\.home, t: Date\.now\(\), why: 'квест сдан: обратно на точку', svc: 'quests' \}/);
});
test('selfHoldPlan: окно учёта задаётся (запрет маршрута — 12 ч); по умолчанию прежние 6 ч', () => {
  const now = Date.now(), rt = { selfHoldLog: { 'route:mmJob': [now - 7 * H, now - 4.9 * H, now - 2.8 * H] } };
  const p6 = E.selfHoldPlan(rt, 'route:mmJob', [30], now), p12 = E.selfHoldPlan(rt, 'route:mmJob', [30], now, 12 * H);
  assert.equal(p6.stop, false); assert.equal(p6.n, 3, 'в 6 ч — две прежние отметки');
  assert.equal(p12.stop, true, '4-й запрет за 12 ч — стоп');
  assert.equal(E.selfHoldPlan(rt, 'route:mmJob', [30], now, 'x').stop, false, 'мусор — прежнее окно');
});

// ---------- actions: контекст владельца маршрута ----------
function actions({ rt: rt0 = {}, cfg = { autoTasks: ['farm', 'mammon'] }, routeMode = true, jobs = ['shop', 'mmJob', 'zoneGo', 'invScan', 'magister', 'tbuff', 'rbGo'] } = {}) {
  const box = { Date, JSON, Object, Proxy }; vm.runInNewContext(read('modules/actions.js'), box);
  const calls = [], recs = [], holds = [], pauses = [];
  const env = { rt: { char: 'Hero', manualKickAt: 0, ...rt0 }, cfg, on: true, tabOwner: true, lease: () => 'a', page: () => '/map.html', id: () => String(Math.random()),
    mode: () => modeOf(E.selectedTask(env.cfg, env.rt)) || 'farm',
    ...(routeMode ? { routeMode: () => modeOf(E.baseTask(env.cfg, env.rt)) || 'farm' } : {}),
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, rtCommit: async () => true, rec: (...a) => recs.push(a.join(' ')), setStatus() {},
    halt: async s => { calls.push('halt:' + s); env.on = false; }, isBattle: () => false, interrupted: () => false, paymentPending: () => null, reconcile: async () => {},
    selfHold: async (kind, why, opt) => { holds.push({ kind, why, opt }); return 'defer'; }, pauseBot: async (msg, opt) => { pauses.push({ msg, opt }); env.on = false; },
    jobs: () => jobs.map(key => ({ key, run: async () => calls.push(key) })) };
  const A = box.L2V7Factories.actions(env); A.enterFrame();
  return { A, env, calls, recs, holds, pauses };
}
test('actions: поход к Маммону, начатый на передышке фарма, переживает её конец; настоящая смена списка задач — по-прежнему отмена', async () => {
  const f = actions({ rt: { selfHold: hold('farm') } });
  assert.equal(f.env.mode(), 'tasks'); assert.equal(f.env.routeMode(), 'farm');
  f.env.rt.mmJob = { kind: 'smith', up: true, step: 'act', t: Date.now() }; await f.A.dispatch(); assert.deepEqual(f.calls, ['mmJob']);
  f.env.rt.selfHold.until = Date.now() - 1; assert.equal(f.env.mode(), 'farm', 'передышка кончилась — фарм снова первый');
  f.A.enterFrame(); assert.equal(f.A.canAct(), true); await f.A.dispatch();
  assert.deepEqual(f.calls, ['mmJob', 'mmJob'], 'поход продолжается'); assert.ok(f.env.rt.mmJob); assert.ok(!f.recs.some(r => /сменил режим/.test(r)));
  // начало передышки посреди похода тоже не отмена
  f.env.rt.selfHold = hold('farm'); f.A.enterFrame(); await f.A.dispatch(); assert.equal(f.calls.length, 3); assert.ok(f.env.rt.mmJob);
  // игрок сам сменил задачи — прежняя отмена с причиной
  f.env.cfg = { autoTasks: ['fish', 'mammon'] }; f.A.enterFrame(); await f.A.dispatch();
  assert.equal(f.env.rt.mmJob, null); assert.ok(f.recs.some(r => /mmJob: пользователь сменил режим или цель; старый маршрут отменён/.test(r)));
  // старое ядро без routeMode — прежнее поведение (контекст по autonomyMode): конец передышки отменял поход
  const g = actions({ rt: { selfHold: hold('farm') }, routeMode: false });
  g.env.rt.mmJob = { kind: 'smith', step: 'act', t: Date.now() }; await g.A.dispatch(); g.env.rt.selfHold.until = Date.now() - 1; g.A.enterFrame(); await g.A.dispatch();
  assert.equal(g.env.rt.mmJob, null, 'так было до правки');
});
test('actions: «Закупить сейчас» (urgent) не отменяется ни началом, ни концом передышки; ожидание тура на рыбалке тоже не смена режима', async () => {
  const f = actions(); f.env.rt.shop = { step: 'buy', urgent: true, t: Date.now() }; await f.A.dispatch(); assert.deepEqual(f.calls, ['shop']);
  f.env.rt.selfHold = hold('farm'); f.A.enterFrame(); await f.A.dispatch(); assert.deepEqual(f.calls, ['shop', 'shop'], 'передышка началась — закупка идёт');
  f.env.rt.selfHold.until = Date.now() - 1; f.A.enterFrame(); await f.A.dispatch(); assert.deepEqual(f.calls, ['shop', 'shop', 'shop'], 'передышка кончилась — закупка идёт');
  assert.ok(f.env.rt.shop); assert.ok(!f.recs.some(r => /сменил режим/.test(r)));
  // тур → рыбалка (отсрочка кота, rbFishWait) → тур: начатый на рыбалке поход к Маммону не отменяется
  const now = Date.now(), g = actions({ cfg: { autoTasks: ['raid', 'fish', 'mammon'] }, rt: { rbFishWait: { at: now - MIN, until: now + 20 * MIN, pet: true }, rbHunt: { phase: 'wait', step: 'pick' } } });
  assert.equal(g.env.mode(), 'fish'); g.env.rt.mmJob = { kind: 'claim', t: now }; await g.A.dispatch();
  g.env.rt.rbFishWait = null; assert.equal(g.env.mode(), 'raid'); g.A.enterFrame(); await g.A.dispatch();
  assert.deepEqual(g.calls, ['mmJob', 'mmJob']); assert.ok(g.env.rt.mmJob);
});

// ---------- actions: запрет маршрута ----------
test('actions: запрещённый маршрут, который создатель пересоздаёт вхолостую, — 10 раз за 1 мин → пауза с причиной; передышки основной задаче нет', async () => {
  const until = Date.now() + 100 * MIN, f = actions({ rt: { actionBan: { mmJob: { t: 5, until, why: 'Маршрут mmJob: повторяется цикл' } } } });
  for (let i = 1; i <= 9; i++) { f.env.rt.mmJob = { kind: 'claim', t: i }; await f.A.dispatch(); assert.equal(f.env.rt.mmJob, null); }
  assert.equal(f.pauses.length, 0); assert.equal(f.env.on, true);
  f.env.rt.mmJob = { kind: 'claim', t: 10 }; await f.A.dispatch();
  assert.equal(f.pauses.length, 1); assert.equal(f.pauses[0].opt.fault, true, 'пауза «сам встал» с уведомлением, сервер лежит — сначала ждёт сервер');
  assert.match(f.pauses[0].msg, /^Маршрут mmJob запрещён после циклов \(до \d\d:\d\d\), но его снова создают — 10 раз за 1 мин; основная работа стоит/);
  assert.equal(f.holds.length, 0, 'передышка не уходит на основную задачу (фарм)'); assert.ok(!f.calls.includes('mmJob'));
  assert.equal(f.recs.filter(r => /маршрут mmJob запрещён до/.test(r)).length, 1, 'в журнал — один раз на запрет');
  // редкие запросы (создатель со своей отметкой времени) — только снятие, без паузы
  const g = actions({ rt: { actionBan: { zoneGo: { t: 5, until } } } });
  for (let i = 1; i <= 15; i++) { if (g.env.rt.actionBan.zoneGo.askT) g.env.rt.actionBan.zoneGo.askT -= 61000; g.env.rt.zoneGo = { id: 'z', t: i }; await g.A.dispatch(); }   // раз в минуту с лишним
  assert.equal(g.pauses.length, 0); assert.equal(g.env.rt.actionBan.zoneGo.asks, 1); assert.equal(g.env.on, true);
  // кнопка Маммона в меню (cmd) запретом не задерживается
  const k = actions({ rt: { actionBan: { mmJob: { t: 5, until } } } }); k.env.rt.mmJob = { kind: 'smith', visit: true, cmd: true, t: 1 }; await k.A.dispatch();
  assert.deepEqual(k.calls, ['mmJob']); assert.equal(k.A.banned('mmJob'), true, 'автоматическое создание при этом запрещено');
});
test('actions: при запрете и при снятии нового запроса создатели получают отметку «была попытка» — перелёт, сумка, магистр, баффер, закупка', async () => {
  const until = Date.now() + 100 * MIN, ban = { t: 5, until };
  const f = actions({ rt: { actionBan: { zoneGo: ban, rbGo: ban, invScan: ban, magister: ban, tbuff: ban, shop: ban }, zoneGoT: 0, invTourT: 0, tbPauseUntil: 0, shopT: 0 } });
  for (const [key, value] of [['zoneGo', { id: 'z', t: 1 }], ['rbGo', { id: 'rb', t: 1 }], ['invScan', { step: 'prof', t: 1 }], ['magister', { key: 'Hero:mage:0', lvl: 61, t: 1 }], ['tbuff', { step: 'fa', t: 1 }], ['shop', { step: 'buy', t: 1 }]]) {
    f.env.rt[key] = value; await f.A.dispatch(); assert.equal(f.env.rt[key], null, key);
  }
  assert.ok(Date.now() - f.env.rt.zoneGoT < 5000, 'автофарм/цель ресурса/тур: перелёт не выбирается сразу снова');
  assert.ok(Date.now() - f.env.rt.invTourT < 5000); assert.deepEqual({ ...f.env.rt.magRetry }, { key: 'Hero:mage:0', lvl: 61, until }, 'магистр ждёт конца запрета');
  assert.equal(f.env.rt.tbPauseUntil, until); assert.ok(Date.now() - f.env.rt.shopT < 5000); assert.deepEqual(f.calls, []);
  // третий цикл за час: запрет на 2 ч с теми же отметками, учёт передышки — окно 12 ч
  const g = actions({ rt: { actionLoops: { magister: [Date.now() - 20 * MIN, Date.now() - 10 * MIN] } }, jobs: ['magister'] });
  g.env.rt.magister = { key: 'Hero:mage:0', lvl: 61, t: 1, phase: 'learn' }; let page = 0; g.env.page = () => '/p' + (page++ % 2);
  for (let i = 0; i < 14 && g.env.rt.magister; i++) await g.A.dispatch();
  assert.equal(g.env.rt.magister, null); assert.ok(g.env.rt.actionBan.magister.until > Date.now() + 119 * MIN);
  assert.equal(g.holds.length, 1); assert.equal(g.holds[0].kind, 'route:magister'); assert.equal(g.holds[0].opt.window, 12 * H); assert.equal(g.holds[0].opt.noWait, true);
  assert.equal(g.env.rt.magRetry.until, g.env.rt.actionBan.magister.until);
});

// ---------- mammon: контекст задания и запрет ----------
function mammon({ rt: rt0 = {}, cfg = { autoTasks: ['farm', 'mammon'] }, routeMode = true, banned = false } = {}) {
  let rt = { char: 'HeroA', manualKickAt: 1, ...rt0 }; const recs = [], status = [];
  const b = { console, Date, Event: class {}, location: { pathname: '/map.html', search: '', href: '' }, document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null }, sessionStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(read('modules/mammon.js'), b);
  const env = { get rt() { return rt; }, set rt(v) { rt = v; }, cfg, on: true, tabOwner: true, leaseEpoch: 'A', ITEMS: {}, FARM: { res: {} },
    autonomyMode: () => modeOf(E.selectedTask(env.cfg, rt)) || 'farm', ...(routeMode ? { routeMode: () => modeOf(E.baseTask(env.cfg, rt)) || 'farm' } : {}),
    routeBanned: k => banned && k === 'mmJob', setStatus: s => status.push(s), rec: (...a) => recs.push(a.join(' ')), invQty: () => 0, fire: () => false, $q: () => null,
    setRt: async p => { rt = { ...rt, ...p }; return { ok: true }; }, sleep: async () => {}, waitX: async f => f(), isBattle: () => false, fishNow: () => false, isFishing: () => false, fishState: () => null,
    payments: { blocked: () => false, pending: () => null }, gameGet: async () => ({ ok: false, status: 503, json: async () => ({}) }) };
  return { env, M: b.L2V7Factories.mammon(env), recs, status };
}
const mail = { mmMail: { unc: [{ a: 'att1', n: 'Iron Ore', q: 5, s: 'Bob' }] } };
test('Маммон: задание, созданное на передышке, хранит режим маршрута и переживает её конец; настоящая смена задач — снимает', async () => {
  const f = mammon({ rt: { ...mail, selfHold: hold('farm', undefined, 1) } });
  assert.equal(f.env.autonomyMode(), 'tasks'); assert.equal(await f.M.mmStep(), true);
  const J = f.env.rt.mmJob; assert.equal(J.kind, 'claim'); assert.equal(J.context.mode, 'farm', 'режим маршрута, а не «tasks» передышки');
  f.env.rt = { ...f.env.rt, selfHold: { ...f.env.rt.selfHold, until: Date.now() - 1 } }; assert.equal(f.env.autonomyMode(), 'farm');
  f.env.payments.blocked = () => true;   // шаг задания дальше не ведём — проверяем только, что контекст тот же
  assert.equal(await f.M.mmStep(), true); assert.equal(f.env.rt.mmJob, J, 'поход не отменён');
  f.env.cfg = { autoTasks: ['fish', 'mammon'] }; assert.equal(await f.M.mmStep(), false); assert.equal(f.env.rt.mmJob, null, 'игрок сменил задачи — задание снято');
  // старое ядро без routeMode: тот же сценарий снимал задание (так было до правки)
  const g = mammon({ rt: { ...mail, selfHold: hold('farm', undefined, 1) }, routeMode: false }); await g.M.mmStep(); assert.equal(g.env.rt.mmJob.context.mode, 'tasks');
  g.env.rt = { ...g.env.rt, selfHold: { ...g.env.rt.selfHold, until: Date.now() - 1 } }; await g.M.mmStep(); assert.equal(g.env.rt.mmJob, null);
});
test('Маммон: маршрут запрещён — почта, заказ, улучшение и цены кузнеца сами не просятся (без строки «иду к …»), кнопка меню проходит', async () => {
  const now = Date.now(), order = { mmOrder: { st: 'OPEN', qty: 3, have: 3, id: 'o1', exp: now + H, res: 'Iron Ore' } };
  const free = mammon({ rt: { ...mail, ...order } }); assert.equal(free.M.want().kind, 'order'); free.env.rt = { ...free.env.rt, mmOrder: null }; assert.equal(free.M.want().kind, 'claim');
  const f = mammon({ rt: { ...mail, ...order }, banned: true });
  assert.equal(f.M.want(), null);
  for (let i = 0; i < 5; i++) assert.equal(await f.M.mmStep(), false);
  assert.equal(f.env.rt.mmJob, undefined); assert.deepEqual(f.recs, [], 'журнал не засоряется'); assert.equal(f.env.rt.mmTried, undefined, 'заказ не помечен «пробован» — не пропадёт на сутки');
  f.env.rt = { ...f.env.rt, mmGoReq: { kind: 'visit', npc: 'smith', t: now } };
  const w = f.M.want(); assert.equal(w.cmd, true); assert.equal(w.visit, true, 'кнопка «прийти к кузнецу» — явная команда, проходит');
});

// ---------- content.js: проводка ----------
test('content.js: routeMode из baseTask — в контексте маршрутов и Маммона; чтение сумки не начинается при запрете', () => {
  const s = read('content.js');
  assert.match(s, /const routeMode = \(\) => \{ const t = L2EngineCore\.baseTask\(cfg, rt\); return t == null \? autonomyMode\(\) : t === 'quests' \? 'campaign' : t === 'auto' \? 'farm' : t; \};/);
  assert.match(s, /const routeBanned = key => !!L2V7Modules\.actions\?\.banned\?\.\(key\);/);
  const act = s.slice(s.indexOf('L2V7Modules.actions = L2V7Factories.actions({')).split('\n').slice(0, 6).join('\n');
  assert.match(act, /get routeMode\(\)\{return routeMode\},get pauseBot\(\)\{return pauseBot\}/);
  assert.match(s, /L2V7Modules\.mammon = L2V7Factories\.mammon\(\{ get routeMode\(\)\{return routeMode\}, get routeBanned\(\)\{return routeBanned\},/);
  const raid = s.slice(s.indexOf('async function loopRaid() {'), s.indexOf('if (isMap() && campOn() && !fishNow()', s.indexOf('async function loopRaid() {')));
  assert.equal((raid.match(/!routeBanned\('invScan'\)/g) || []).length, 3, 'все три автоматических запуска чтения сумки');
  assert.match(s, /L2EngineCore\.selfHoldPlan\(rt, kind, opt\.steps \|\| SELF_HOLD_STEPS\[kind\] \|\| \[30\], now, opt\.window\)/);
  assert.match(s, /передышки за \$\{Math\.round\(\(\+opt\.window > 0 \? \+opt\.window : L2EngineCore\.SELF_HOLD_WINDOW\) \/ 3600000\)\} ч не помогли/);
  const mm = read('modules/mammon.js');
  assert.match(mm, /const context = \(\) => \(\{ char: env\.rt\.char \|\| '', kick: \+env\.rt\.manualKickAt \|\| 0, mode: \(env\.routeMode \|\| env\.autonomyMode\)\?\.\(\) \|\| '' \}\);/);
});
