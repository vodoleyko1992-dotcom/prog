'use strict';
// 20.43 (автономность, доводка 21.10): передышки по задаче. Раньше rt.selfHold был одной ячейкой: новая передышка молча затирала прежнюю,
// и задача затёртой передышки сразу снова становилась доступной. [тур, фарм] при общем сбое карты: тур на передышке (raidMap), идёт фарм,
// его передышка «mob» стирала туровую — тур снова на сломанную карту и стирал фермерскую; передышки сменяли друг друга, счёт «3 за 6 ч»
// набегал за 30–40 мин. [фарм, рыбалка]: фарм на «mob», рыбалка зависла — «stall» рыбалки стирал фермерскую, фарм сразу кликал по
// сломанной карте. И отсрочка noWait (карта на прилёте) с передышкой проверки карты (mapGate) того же вида считались дважды за один сбой.
// Теперь rt.selfHold = {ключ: передышка} (ключ — задача / 'mode:<режим>' / 'kind:<вид>'), замена той же задачи — со строкой в журнале и
// сроком не раньше прежнего; отсрочки noWait — свой счёт rt.selfHoldDefer (предел тот же).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), popup = read('popup.js');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000;
const holds = rt => Object.values(rt.selfHold && typeof rt.selfHold === 'object' && !('until' in rt.selfHold) ? rt.selfHold : rt.selfHold ? { one: rt.selfHold } : {});
const byTask = (rt, task) => holds(rt).find(h => h.task === task);

function core({ tasks = ['raid', 'farm'], mode = 'farm', rt: rt0 = {} } = {}) {
  const calls = [], recs = [], status = [];
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console, Set,
    rt: { char: 'Hero', manualKickAt: 5, ...rt0 }, cfg: tasks ? { autoTasks: tasks } : {}, on: true, tabOwner: true, LOOP: { holdWaitT: 0 },
    location: { pathname: '/map.html', href: '' }, L2V7Modules: { actions: { canAct: () => true } },
    automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, JSON.parse(JSON.stringify(p))); return { ok: true }; }, rtCommit: async () => true,
    halt: async (msg, hard) => { calls.push(['halt', msg, hard]); c.on = false; }, rec: (...a) => recs.push(a[2]), setStatus: s => status.push(s),
    sleep: async () => {}, autonomyMode: () => mode,
    isBattle: () => false, battle: async () => {}, isFishing: () => false, fishState: () => null, fishFight: async () => {} };
  vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + '\n' + slice(content, 'async function loopSelfHold() {', '// Режим «Задачи бота»')
    + ';this.start=selfHoldStart;this.loop=loopSelfHold;this.wait=loopSelfHoldWait;this.main_=selfHoldMain;this.on_=selfHoldOn;'
    + 'this.of=typeof selfHoldOf==="function"?selfHoldOf:null;', c);
  return { c, calls, recs, status };
}

test('[тур, фарм] общий сбой карты: передышка фарма не затирает туровую — обе задачи ждут, тур не возвращается на сломанную карту', async () => {
  const f = core({ tasks: ['raid', 'farm'] });
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загружается и при бесплатной проверке — платный перелёт не начинаю'), 'hold');
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'farm', 'тур на передышке — идёт фарм');
  assert.equal(await f.c.start('mob', 'Клик по мобу 3 раза подряд не открыл бой', { page: '/char.html' }), 'hold');
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'tasks', 'обе задачи на передышке — ожидание, тур на сломанную карту не идёт');
  assert.ok(byTask(f.c.rt, 'raid'), 'туровая передышка цела'); assert.ok(byTask(f.c.rt, 'farm'), 'фермерская передышка есть');
  assert.equal(f.c.on_('raidMap'), true); assert.equal(f.c.on_('mob'), true);
  assert.equal(f.c.rt.selfHoldLog.raidMap.length, 1); assert.equal(f.c.rt.selfHoldLog.mob.length, 1, 'по одной передышке каждого вида, а не цепочка замен');
  assert.ok(!f.recs.some(r => /заменяет прежнюю/.test(r)), 'разные задачи — не замена');
  assert.equal(f.c.of?.('mob')?.task, 'farm'); assert.equal(f.c.of?.('raidMap')?.task, 'raid');
});

test('[фарм, рыбалка]: «stall» рыбалки не снимает передышку фарма; кончилась одна — вторая держит, строка «окончена» только у кончившейся', async () => {
  const f = core({ tasks: ['fish', 'farm'] });
  f.c.rt.fishCastActive = false;
  // фарм на «mob» (рыбалка ниже по выбору только из-за условий — делаем фарм первым, убрав рыбалку на время)
  f.c.cfg.autoTasks = ['farm']; await f.c.start('mob', 'Клик по мобу 3 раза вернул на карту', { page: '/char.html' });
  f.c.cfg.autoTasks = ['fish', 'farm'];
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'fish');
  assert.equal(await f.c.start('stall', 'нет прогресса (рыбалка)'), 'hold');
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'tasks', 'фарм не возвращается на сломанную карту');
  assert.ok(byTask(f.c.rt, 'farm') && byTask(f.c.rt, 'fish'));
  // передышка фарма кончилась — одна строка «окончена» с её причиной; рыбалка ещё ждёт
  byTask(f.c.rt, 'farm').until = Date.now() - 1; f.recs.length = 0;
  assert.equal(await f.c.loop(), undefined);
  assert.equal(f.recs.length, 1); assert.match(f.recs[0], /^окончена: Клик по мобу 3 раза вернул на карту — продолжаю сам/);
  assert.equal(byTask(f.c.rt, 'farm'), undefined); assert.ok(byTask(f.c.rt, 'fish'), 'передышка рыбалки осталась');
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'farm');
});

test('замена передышки той же задачи — строка в журнале, срок не раньше прежнего; без списка задач — то же по режиму', async () => {
  const f = core({ tasks: null, mode: 'farm' });
  await f.c.start('stall', 'нет прогресса 9 мин', { page: '/map.html' });   // 20 мин
  const first = holds(f.c.rt)[0]; assert.equal(first.kind, 'stall');
  await f.c.start('mob', 'Список мобов не грузится 15 минут');               // 5 мин — короче
  const all = holds(f.c.rt); assert.equal(all.length, 1, 'одна запись на режим');
  assert.equal(all[0].kind, 'mob'); assert.ok(all[0].until >= first.until, 'срок прежней передышки не сокращён');
  assert.match(f.recs.at(-1), /заменяет прежнюю «нет прогресса 9 мин» до \d\d:\d\d/);
});

test('отсрочка noWait (карта на прилёте) не считается передышкой того же вида: передышка проверки карты после неё — первая, а не вторая', async () => {
  const f = core({ tasks: ['raid', 'farm'] });
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загрузилась после 3 обновлений (цель Первый)', { noWait: true }), 'defer');
  assert.equal(await f.c.start('raidMap', 'Тур РБ: карта не загружается и при бесплатной проверке'), 'hold');
  assert.equal(byTask(f.c.rt, 'raid').n, 1, 'один сбой — одна передышка (раньше 2/3)');
  assert.match(f.recs.at(-1), /\(1\/3 за 6 ч\)/);
  // три отсрочки за 6 ч — следующая передышка вида всё ещё обычная (раньше — стоп)
  const t = Date.now(), g = core({ tasks: ['raid', 'farm'], rt: { selfHoldDefer: { raidMap: [t - 3 * MIN, t - 2 * MIN, t - MIN] } } });
  assert.equal(await g.c.start('raidMap', 'Тур РБ: карта не загружается и при бесплатной проверке'), 'hold'); assert.equal(g.calls.length, 0);
  // а у самих отсрочек предел прежний: 4-я за 6 ч — стоп с причиной «3 отсрочки»
  assert.equal(await g.c.start('raidMap', 'Тур РБ: карта не загрузилась после 3 обновлений (цель Второй)', { noWait: true }), 'stop');
  assert.match(g.calls[0][1], /3 отсрочки за 6 ч не помогли/);
  assert.equal(byTask(g.c.rt, 'raid'), undefined, 'стоп снимает передышки этого вида');
});

test('стоп одного вида не снимает передышки других задач', async () => {
  const t = Date.now(), f = core({ tasks: ['raid', 'farm', 'fish'], rt: { selfHoldLog: { mob: [t - 3 * MIN, t - 2 * MIN, t - MIN] } } });
  f.c.halt = async (msg, hard) => { f.calls.push(['halt', msg, hard]); };   // сервер лежит: мягкий halt ушёл в ожидание сервера, бот не выключен
  await f.c.start('raidMap', 'Тур РБ: карта не загружается');
  assert.equal(await f.c.start('mob', 'Клик по мобу 3 раза подряд не открыл бой'), null);
  assert.ok(byTask(f.c.rt, 'raid'), 'передышка тура цела'); assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'fish');
});

test('ожидание: ждёт только передышка текущей работы; tasksIdle показывает все передышки', async () => {
  const f = core({ tasks: ['raid', 'farm'] });
  await f.c.start('raidMap', 'карта тура'); await f.c.start('mob', 'карта фарма');
  assert.equal(f.c.main_(), false, 'выбор «tasks»: ни одна из передышек основную работу «tasks» не держит');
  const src = slice(content, 'async function tasksIdle() {', '\n}\n');
  const box = { L2EngineCore: E, rt: f.c.rt, cfg: f.c.cfg, Date, setStatus: s => box.s = s, sleep: async () => {}, selfHoldText: f.c.selfHoldText || (h => `Передышка до ${h.until}: ${h.why}`) };
  vm.runInNewContext(src + '\n}\nthis.idle=tasksIdle;', box); await box.idle();
  assert.match(box.s, /карта тура/); assert.match(box.s, /карта фарма/); assert.match(box.s, /других выбранных задач сейчас нет/);
});

test('старая одиночная запись rt.selfHold читается и снимается как прежде', async () => {
  const t = Date.now(), old = { kind: 'mob', why: 'старая', at: t - MIN, until: t + 10 * MIN, task: 'farm', kick: 5 };
  const f = core({ tasks: ['farm', 'fish'], rt: { selfHold: { ...old } } });
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'fish'); assert.equal(E.selfHoldActive(f.c.rt).why, 'старая');
  await f.c.start('stall', 'рыбалка стоит');
  assert.ok(byTask(f.c.rt, 'farm') && byTask(f.c.rt, 'fish'), 'старая запись сохранена рядом с новой');
  byTask(f.c.rt, 'farm').until = t - 1; byTask(f.c.rt, 'fish').until = t - 1; f.recs.length = 0;
  await f.c.loop(); assert.equal(f.c.rt.selfHold, null); assert.equal(f.recs.length, 2);
});

test('меню: у каждой задачи своя передышка в строке; подсказка состояния перечисляет обе', () => {
  const ctx = { L2EngineCore: E, selectedAutoTasks: d => d.autoTasks, AUTO_TASK_LABELS: { raid: 'Тур РБ', farm: 'Фарм' }, AUTO_MAIN_TASKS: ['raid', 'farm'], TASK_TABS: { raid: 'raid', farm: 'farm' }, Date };
  vm.runInNewContext(slice(popup, 'function taskBoardRows(', '// 19.10: дневные мобы'), ctx);
  const t = Date.now(), rt = { selfHold: { raid: { kind: 'raidMap', why: 'карта тура', at: t - MIN, until: t + 20 * MIN, task: 'raid', kick: 0 },
    farm: { kind: 'mob', why: 'карта фарма', at: t - MIN, until: t + 5 * MIN, task: 'farm', kick: 0 } } };
  const rows = ctx.taskBoardRows(rt, { autoTasks: ['raid', 'farm'] }, { on: true, heartbeatValid: true }, t);
  for (const [key, why] of [['raid', 'карта тура'], ['farm', 'карта фарма']]) {
    const r = rows.find(x => x.key === key); assert.match(r.label, /^Передышка до \d\d:\d\d$/, key); assert.match(r.progress, new RegExp(why));
  }
  assert.equal(typeof ctx.selfHoldViews, 'function'); assert.equal(ctx.selfHoldViews(rt, {}, t).length, 2);
  assert.equal(ctx.selfHoldViews(rt, {}, t)[0].key, 'farm', 'ближайшая к концу — первой');
});

test('mobfarm: статус ожидания карты — текст передышки карты, даже когда рядом передышка другой задачи', async () => {
  const box = { console, document: null, Date, JSON, Object, Math, location: { reload() {}, href: '' } }; box.globalThis = box;
  vm.createContext(box); vm.runInContext(read('modules/mobfarm.js'), box);
  const status = [], t = Date.now(), rt = { char: 'Hero', selfHold: { fish: { kind: 'stall', why: 'рыбалка стоит', at: t, until: t + MIN, task: 'fish', kick: 5 },
    farm: { kind: 'mob', why: 'Клик по мобу 3 раза подряд не открыл бой', at: t, until: t + MIN, task: 'farm', kick: 5 } } };
  const f = core({ tasks: ['fish', 'farm'], rt });
  const env = { on: true, rt: f.c.rt, cfg: {}, setRt: async () => ({ ok: true }), setStatus: s => status.push(s), sleep: async () => {}, $q: () => null, shown: () => false,
    selfHoldOn: k => f.c.on_(k), selfHoldText: h => `Передышка: ${h.why}`, ...(f.c.of ? { selfHoldOf: f.c.of } : {}) };
  await box.L2V7Factories.mobfarm(env).map();
  assert.equal(status.at(-1), 'Передышка: Клик по мобу 3 раза подряд не открыл бой');
  assert.match(content, /get selfHoldOf\(\)\{return selfHoldOf\}/, 'геттер у фабрики mobfarm');
});
