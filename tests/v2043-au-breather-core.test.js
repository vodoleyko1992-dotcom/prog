'use strict';
// 20.43 (автономность, разбор 21.10): «передышка» вместо стопа — ядро. Временный технический сбой (клик по мобу не открыл бой, список мобов
// не грузится, нет прогресса 9 мин ×3) раньше выключал бота до утра. Теперь rt.selfHold: задача на передышке уступает другим выбранным
// задачам, нет других — бот ждёт с пульсом и продолжает сам; 4-я передышка одного вида за 6 ч — стоп с причиной; новый Старт снимает передышку.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const E = require('../engine-core.js');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const content = read('content.js'), popup = read('popup.js');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const MIN = 60000, now = Date.parse('2026-10-21T03:00:00Z');

// ---------- engine-core: selfHoldActive / selfHoldPlan / selectedTask ----------
test('selfHoldActive: действует до until и только при том же запуске (manualKickAt); мусор и будущие записи не действуют', () => {
  const h = { kind: 'mob', why: 'x', at: now - MIN, until: now + 5 * MIN, task: 'farm', kick: 7 };
  assert.equal(E.selfHoldActive({ selfHold: h, manualKickAt: 7 }, now), h);
  assert.equal(E.selfHoldActive({ selfHold: h, manualKickAt: 8 }, now), null, 'новый Старт игрока снимает передышку');
  assert.equal(E.selfHoldActive({ selfHold: { ...h, until: now }, manualKickAt: 7 }, now), null, 'истекла');
  assert.equal(E.selfHoldActive({ selfHold: { ...h, at: now + 2 * MIN }, manualKickAt: 7 }, now), null, 'запись из будущего (часы) не держит');
  assert.equal(E.selfHoldActive({ selfHold: { ...h, until: 'x' }, manualKickAt: 7 }, now), null);
  assert.equal(E.selfHoldActive({ selfHold: null }, now), null);
  assert.equal(E.selfHoldActive({ selfHold: { ...h, kick: undefined } }, now)?.kind, 'mob', 'без запусков (0 = 0)');
});
test('selfHoldPlan: шаги 5 → 15 → 30 мин, 4-я за 6 ч — стоп; старые (старше 6 ч) и будущие отметки не считаются', () => {
  const steps = [5, 15, 30];
  let rt = {}, p = E.selfHoldPlan(rt, 'mob', steps, now);
  assert.deepEqual([p.stop, p.n, p.ms], [false, 1, 5 * MIN]); assert.deepEqual(p.log, [now]);
  rt = { selfHoldLog: { mob: [now - 50 * MIN] } }; p = E.selfHoldPlan(rt, 'mob', steps, now); assert.deepEqual([p.n, p.ms], [2, 15 * MIN]);
  rt = { selfHoldLog: { mob: [now - 90 * MIN, now - 50 * MIN] } }; p = E.selfHoldPlan(rt, 'mob', steps, now); assert.deepEqual([p.n, p.ms], [3, 30 * MIN]);
  rt = { selfHoldLog: { mob: [now - 5 * 3600000, now - 90 * MIN, now - 50 * MIN] } }; p = E.selfHoldPlan(rt, 'mob', steps, now); assert.equal(p.stop, true); assert.equal(p.n, 3);
  rt = { selfHoldLog: { mob: [now - 7 * 3600000, now - 90 * MIN, now - 50 * MIN] } }; p = E.selfHoldPlan(rt, 'mob', steps, now); assert.equal(p.stop, false, 'отметка старше 6 ч ушла'); assert.equal(p.n, 3);
  rt = { selfHoldLog: { mob: [now + 3600000, now - 50 * MIN], stall: [now - 1, now - 2, now - 3] } }; p = E.selfHoldPlan(rt, 'mob', steps, now); assert.equal(p.n, 2, 'будущая отметка не в счёт, чужой вид не в счёт');
  assert.equal(E.SELF_HOLD_MAX, 3); assert.equal(E.SELF_HOLD_WINDOW, 6 * 3600000);
});
test('selectedTask: задача на передышке уступает следующей выбранной; нет других — «tasks»; начатый заброс и заточка не прерываются', () => {
  const hold = (task, extra = {}) => ({ selfHold: { kind: 'mob', why: 'x', at: now - MIN, until: now + 10 * MIN, task, kick: 0 }, ...extra });
  assert.equal(E.selectedTask({ autoTasks: ['farm', 'fish'] }, {}, now), 'fish', 'рыбалка выше фарма в порядке ядра');
  assert.equal(E.selectedTask({ autoTasks: ['raid', 'farm'] }, hold('raid'), now), 'farm');
  assert.equal(E.selectedTask({ autoTasks: ['farm'] }, hold('farm'), now), 'tasks', 'других нет — ожидание');
  assert.equal(E.selectedTask({ autoTasks: ['fish', 'farm'] }, hold('fish'), now), 'farm');
  assert.equal(E.selectedTask({ autoTasks: ['fish', 'farm'] }, hold('fish', { fishCastActive: true }), now), 'fish', 'начатый заброс доводится');
  assert.equal(E.selectedTask({ autoTasks: ['enchant', 'farm'] }, hold('enchant'), now), 'enchant', 'серия заточки не держится');
  assert.equal(E.selectedTask({ autoTasks: ['farm', 'cat'] }, { ...hold('cat'), manualKickAt: 3 }, now), 'cat', 'новый Старт — передышка не действует');
  assert.equal(E.selectedTask({ autoTasks: ['farm', 'cat'] }, hold('cat'), now + 11 * MIN), 'cat', 'истекла — задача снова первая');
});

// ---------- content.js: selfHoldStart / loopSelfHold / loopWatchdog ----------
function core({ tasks = ['farm', 'fish'], mode = 'farm', rt: rt0 = {}, path: page = '/map.html', battle = false } = {}) {
  const calls = [], recs = [], status = [];
  const c = { L2EngineCore: E, Date, String, Number, Math, Object, Array, JSON, console,
    rt: { char: 'Hero', manualKickAt: 5, ...rt0 }, cfg: tasks ? { autoTasks: tasks } : {}, on: true, tabOwner: true, LOOP: { holdWaitT: 0 },
    location: { pathname: page, href: '' }, L2V7Modules: { actions: { canAct: () => false } },   // кадр действий сменился вместе с задачей — не помеха
    automationGeneration: 0, leaseEpoch: 'e1', antibotState: () => null,
    setRt: async p => { Object.assign(c.rt, p); return { ok: true }; }, rtCommit: async () => { calls.push('commit'); return true; },
    halt: async (msg, hard) => { calls.push(['halt', msg, hard]); c.on = false; }, rec: (...a) => recs.push(a), setStatus: s => status.push(s),
    sleep: async () => {}, autonomyMode: () => mode,
    isBattle: () => battle, battle: async () => calls.push('battle'), isFishing: () => false, fishState: () => null, fishFight: async () => calls.push('fishFight') };
  vm.createContext(c);
  vm.runInContext(slice(content, 'const SELF_HOLD_STEPS =', '// ---------- переходы') + '\n' + slice(content, 'async function loopSelfHold() {', '// Режим «Задачи бота»')
    + ';this.start=selfHoldStart;this.loop=loopSelfHold;this.wait=loopSelfHoldWait;this.main_=selfHoldMain;this.applies=selfHoldApplies;this.on_=selfHoldOn;this.text=selfHoldText;', c);
  return { c, calls, recs, status };
}
test('selfHoldStart(mob): передышка 5 мин на текущей задаче фарма, уход на нейтральную страницу после сохранения; stall другой задачи — идёт следующая', async () => {
  const f = core({ tasks: ['farm'], path: '/map.html' });
  const r = await f.c.start('mob', 'Клик по мобу 3 раза подряд не открыл бой', { page: '/char.html' });
  assert.equal(r, 'hold'); const h = f.c.rt.selfHold;
  assert.equal(h.kind, 'mob'); assert.equal(h.task, 'farm'); assert.equal(h.n, 1); assert.equal(h.kick, 5);
  assert.ok(Math.abs(h.until - h.at - 5 * MIN) < 50); assert.equal(f.c.rt.selfHoldLog.mob.length, 1);
  assert.equal(f.c.location.href, '/char.html'); assert.ok(f.calls.includes('commit'), 'переход только после подтверждённой записи');
  assert.equal(f.recs.length, 1); assert.match(f.recs[0][2], /передышка до \d\d:\d\d \(1\/3 за 6 ч\)/); assert.match(f.status.at(-1), /^Передышка до \d\d:\d\d: Клик по мобу/);
  // во время передышки задача фарма пропускается ядром — «tasks» (ожидание), loopSelfHold на неё не наступает (ждёт tasksIdle)
  assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'tasks'); assert.equal(f.c.on_('mob'), true); assert.equal(f.c.on_('stall'), false);
  // рыбалка не продвигается (stall) — на передышке она, идёт следующая выбранная задача (фарм)
  const g = core({ tasks: ['fish', 'farm'] }); await g.c.start('stall', 'нет прогресса', { page: '/map.html' });
  assert.equal(g.c.rt.selfHold.task, 'fish'); assert.equal(E.selectedTask(g.c.cfg, g.c.rt), 'farm', 'другая выбранная задача идёт'); assert.match(g.recs[0][2], /пока идёт «farm»/);
  assert.ok(Math.abs(g.c.rt.selfHold.until - g.c.rt.selfHold.at - 20 * MIN) < 50, 'stall: 20 мин');
});
test('selfHoldStart: вторая и третья — 15 и 30 мин; четвёртая за 6 ч — стоп с причиной, счёт вида с нуля; stall — жёсткий стоп', async () => {
  const t = Date.now(), f = core({ tasks: ['farm'], rt: { selfHoldLog: { mob: [t - 40 * MIN] } } });
  await f.c.start('mob', 'x'); assert.ok(Math.abs(f.c.rt.selfHold.until - f.c.rt.selfHold.at - 15 * MIN) < 50); assert.equal(f.c.rt.selfHold.n, 2);
  f.c.rt.selfHoldLog.mob = [t - 80 * MIN, t - 40 * MIN]; await f.c.start('mob', 'x'); assert.ok(Math.abs(f.c.rt.selfHold.until - f.c.rt.selfHold.at - 30 * MIN) < 50);
  f.c.rt.selfHoldLog.mob = [t - 120 * MIN, t - 80 * MIN, t - 40 * MIN];
  assert.equal(await f.c.start('mob', 'Клик по мобу 3 раза вернул на карту'), 'stop');
  const halt = f.calls.find(x => x[0] === 'halt'); assert.match(halt[1], /^Клик по мобу 3 раза вернул на карту — 3 передышки за 6 ч не помогли/); assert.equal(halt[2], false);
  assert.equal(f.c.rt.selfHold, null); assert.equal(f.c.rt.selfHoldLog.mob.length, 0, 'новый Старт даёт ещё 3 передышки');
  const s = core({ rt: { selfHoldLog: { stall: [t - 3 * MIN, t - 2 * MIN, t - MIN] } } }); assert.equal(await s.c.start('stall', 'нет прогресса', { hard: true }), 'stop');
  assert.equal(s.calls.find(x => x[0] === 'halt')[2], true, 'stall — жёсткий стоп, как прежний стоп сторожа');
});
test('selfHoldStart(noWait): только учёт (карта тура/эпика, цикл маршрута) — передышки нет, страница не меняется', async () => {
  const f = core(); assert.equal(await f.c.start('raidMap', 'карта', { noWait: true }), 'defer');
  assert.equal(f.c.rt.selfHold, undefined); assert.equal(f.c.rt.selfHoldLog.raidMap.length, 1); assert.equal(f.c.location.href, ''); assert.equal(f.recs.length, 0);
  // noCount (запрет маршрута до его конца): передышка без нового учёта и без стопа
  const t = Date.now(), g = core({ tasks: ['farm'], rt: { selfHoldLog: { 'route:shop': [t - 3, t - 2, t - 1] } } });
  assert.equal(await g.c.start('route:shop', 'просится', { until: t + 30 * MIN, noCount: true }), 'hold'); assert.equal(g.c.rt.selfHold.until, t + 30 * MIN); assert.equal(g.c.rt.selfHoldLog['route:shop'].length, 3);
});
test('selfHoldStart(mob) вне фарма (тур/эпики/катакомбы): задача не держится, только запрет карты; без перехода', async () => {
  const f = core({ tasks: ['raid', 'farm'] }); await f.c.start('mob', 'x', { page: '/char.html' });
  assert.equal(f.c.rt.selfHold.task, null); assert.equal(f.c.location.href, ''); assert.equal(E.selectedTask(f.c.cfg, f.c.rt), 'raid');
  assert.equal(f.c.on_('mob'), true, 'map() всё равно не кликает'); assert.match(f.recs[0][2], /карту не трогаю/);
  const legacy = core({ tasks: null, mode: 'farm' }); await legacy.c.start('mob', 'x'); assert.equal(legacy.c.rt.selfHold.mode, 'farm'); assert.equal(legacy.c.applies(), true);
  const legacyRaid = core({ tasks: null, mode: 'raid' }); await legacyRaid.c.start('mob', 'x'); assert.equal(legacyRaid.c.rt.selfHold.mode, null); assert.equal(legacyRaid.c.applies(), false);
});
test('selfHoldStart: Стоп, новый Старт или другая вкладка во время записи — передышка не объявляется и перехода нет; капча — без перехода', async () => {
  for (const cut of [c => { c.on = false; }, c => { c.rt.manualKickAt = 6; }, c => { c.tabOwner = false; }, c => { c.automationGeneration++; }]) {
    const f = core({ tasks: ['farm'] }); f.c.setRt = async p => { Object.assign(f.c.rt, p); cut(f.c); return { ok: true }; };
    assert.equal(await f.c.start('mob', 'x', { page: '/char.html' }), null); assert.equal(f.c.location.href, ''); assert.equal(f.recs.length, 0);
  }
  const g = core({ tasks: ['farm'] }); g.c.setRt = async () => ({ ok: false }); assert.equal(await g.c.start('mob', 'x', { page: '/char.html' }), null); assert.equal(g.c.location.href, '');
  const a = core({ tasks: ['farm'] }); a.c.antibotState = () => ({ kind: 'captcha' }); assert.equal(await a.c.start('mob', 'x', { page: '/char.html' }), 'hold'); assert.equal(a.c.location.href, '', 'капча — со страницы не уходим');
  // стоп 4-й передышки тоже отменяется Стопом игрока во время записи
  const t = Date.now(), s = core({ rt: { selfHoldLog: { mob: [t - 3, t - 2, t - 1] } } }); s.c.setRt = async p => { Object.assign(s.c.rt, p); s.c.on = false; return { ok: true }; };
  assert.equal(await s.c.start('mob', 'x'), null); assert.ok(!s.calls.some(x => x[0] === 'halt'));
});
// 20.43 (ревью au/breather): ждёт теперь loopSelfHoldWait (после служб), а loopSelfHold круг не держит — только завершает истёкшую передышку
test('loopSelfHoldWait: ждёт с пульсом (статус), доводит бой; loopSelfHold: истекла или новый Старт — одна строка «окончена»/«снята», дальше работа', async () => {
  const t = Date.now(), base = { kind: 'stall', why: 'нет прогресса', at: t - MIN, until: t + 20 * MIN, task: 'tasks', kick: 5 };
  // передышка, взятая в «tasks» (основных задач нет) — держит основную работу; сам шаг loopSelfHold круг не держит
  let f = core({ tasks: [], rt: { selfHold: { ...base } } });
  assert.equal(await f.c.loop(), undefined, 'службы ниже идут'); assert.equal(f.recs.length, 0);
  assert.equal(await f.c.wait(), true); assert.match(f.status.at(-1), /^Передышка до \d\d:\d\d: нет прогресса/); assert.equal(f.recs.length, 0);
  assert.ok(Date.now() - f.c.LOOP.holdWaitT < 1000, 'круг дошёл до ожидания — сторож вкладки это видит');
  f = core({ tasks: null, mode: 'farm', rt: { selfHold: { ...base, task: null, mode: 'farm' } }, battle: true });
  assert.equal(await f.c.wait(), true); assert.deepEqual(f.calls, ['battle'], 'начатый бой доводится');
  f = core({ tasks: null, mode: 'raid', rt: { selfHold: { ...base, task: null, mode: 'farm' } } });
  assert.equal(await f.c.wait(), undefined, 'другая работа (режим сменился) — передышка её не держит'); assert.equal(f.c.main_(), false);
  f = core({ rt: { selfHold: { ...base, until: t - 1 } } });
  assert.equal(await f.c.loop(), undefined); assert.equal(f.c.rt.selfHold, null); assert.match(f.recs[0][2], /^окончена: нет прогресса — продолжаю сам/);
  f = core({ rt: { selfHold: { ...base }, manualKickAt: 6 } });
  assert.equal(await f.c.loop(), undefined); assert.equal(f.c.rt.selfHold, null); assert.match(f.recs[0][2], /^снята новым запуском/);
  f = core({ rt: {} }); assert.equal(await f.c.loop(), undefined); assert.equal(f.recs.length, 0);
});
test('ручной Стоп во время передышки — ничего не пишется (loopStale/цикл остановлен), передышка не переживает новый Старт', async () => {
  const t = Date.now(), f = core({ rt: { selfHold: { kind: 'mob', why: 'x', at: t - MIN, until: t - 1, kick: 5 } } }); f.c.on = false;
  assert.equal(await f.c.loop(), true); assert.equal(f.recs.length, 0, 'бот остановлен — строки «окончена» нет');
});

test('исходник: главный цикл, сторож вкладки, следующий бой и ожидание задач знают о передышке', () => {
  assert.match(content, /await loopUrgent\(\) \|\| await loopSelfHold\(\)\s+\|\| await loopTaskList\(\)/);
  // 20.43 (ревью au/breather): ожидание — после служб, перед туром и основной работой; сторож молчит, только пока круг дошёл до ожидания
  assert.match(content, /await loopSideJobs\(\) \|\| await loopSelfHoldWait\(\) \|\| await loopRaid\(\) \|\| await loopActivity\(\);/);
  const wd = slice(content, 'async function loopWatchdog() {', 'async function loopUrgent() {');
  assert.match(wd, /if \(selfHoldMain\(\) && Date\.now\(\) - \(LOOP\.holdWaitT \|\| 0\) < 15000\) \{ progressMonitor\.tick\('', false\); return; \}/);
  assert.match(wd, /if \(history\.length >= 3\) \{\s+await setRt\(\{ stallRecoveries: \[\] \}\);[\s\S]{0,120}selfHoldStart\('stall', `Автономный режим не продвигается после 3 восстановлений за 30 мин[^`]*`, \{ hard: true, page: '\/map\.html' \}\);\s+return r === 'stop' \? LOOP_BREAK : true;/);
  assert.doesNotMatch(wd, /halt\('Автономный режим не продвигается/);
  assert.match(content, /async function nextFight\(\.\.\.args\) \{[^\n]*if \(rt\.selfHold && selfHoldApplies\(\)\) return toMap\(\);/);
  assert.match(slice(content, 'async function tasksIdle() {', '\n}\n'), /const hold=L2EngineCore\.selfHoldActive\(rt\);\s+if\(hold\?\.task\)\{setStatus\(`⏸ \$\{selfHoldText\(hold\)\}/);
  for (const m of ['mobfarm', 'raid', 'epics', 'actions']) {
    const factory = content.slice(content.indexOf(`L2V7Modules.${m} = L2V7Factories.${m}({`)).split('\n').slice(0, 2).join('\n');
    assert.match(factory, /get selfHold\(\)\{return selfHoldStart\}/, `геттер selfHold у ${m}`);
  }
});

// ---------- popup.js: видно на доске задач и в подсказке ----------
test('меню: задача на передышке — «Передышка до ЧЧ:ММ» и причина в строке задачи; подсказка состояния называет задачу', () => {
  const ctx = { L2EngineCore: E, selectedAutoTasks: d => d.autoTasks, AUTO_TASK_LABELS: { farm: 'Фарм', fish: 'Рыбалка', auto: 'Автофарм' }, AUTO_MAIN_TASKS: ['farm', 'fish', 'auto'], TASK_TABS: { farm: 'farm', fish: 'fish', auto: 'auto' }, Date };
  vm.runInNewContext(slice(popup, 'function taskBoardRows(', '// 19.10: дневные мобы'), ctx);
  const t = Date.now(), rt = { selfHold: { kind: 'mob', why: 'Клик по мобу 3 раза подряд не открыл бой', at: t - MIN, until: t + 10 * MIN, task: 'farm', kick: 0 } };
  const rows = ctx.taskBoardRows(rt, { autoTasks: ['farm', 'fish'] }, { on: true, heartbeatValid: true }, t);
  const farm = rows.find(r => r.key === 'farm'), fish = rows.find(r => r.key === 'fish');
  assert.match(farm.label, /^Передышка до \d\d:\d\d$/); assert.equal(farm.state, 'waiting'); assert.match(farm.progress, /^передышка до \d\d:\d\d: Клик по мобу/);
  assert.equal(fish.label, 'Первая по приоритету');
  const off = ctx.taskBoardRows(rt, { autoTasks: ['farm', 'fish'] }, { on: false }, t).find(r => r.key === 'farm'); assert.doesNotMatch(off.label, /Передышка/, 'бот остановлен — передышки нет');
  const legacy = ctx.selfHoldView({ selfHold: { ...rt.selfHold, task: null, mode: 'farm' } }, { zoneAuto: true }, t); assert.equal(legacy.key, 'auto');
  assert.match(slice(popup, 'function workspaceState(', 'function taskBoardRows('), /holdNote = hold \? `Передышка\$\{hold\.key && AUTO_TASK_LABELS\[hold\.key\] \? ` «\$\{AUTO_TASK_LABELS\[hold\.key\]\}»` : ''\} до \$\{hold\.hm\}: \$\{hold\.why\}\. `/);
  assert.match(popup, /const MEM_SKIP = [^\n]*'wdSilent'/);
});
