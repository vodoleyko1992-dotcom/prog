'use strict';
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): встроенное меню (popup.html#dock) больше не перерисовывается целиком на каждую
// запись бота. live@Ник — только строка «чем занят» (paintLive); запись бота rt/wdog — не чаще раза в 1,5 с; настройки/Старт/запись меню
// и всё сразу после действия игрока — через 350 мс; короткий запрос заменяет длинный таймер; тяжёлые разделы рисуются только открытыми,
// при переходе в раздел — сразу.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const js = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const cut = (a, b) => { const i = js.indexOf(a); assert.ok(i >= 0, 'нет: ' + a); const j = js.indexOf(b, i); assert.ok(j > i, 'нет: ' + b); return js.slice(i, j); };

// ---------- 1. слушатель хранилища и loadSoon — на поддельных часах ----------
function dock() {
  let now = 1000, seq = 0; const timers = [], loads = [], paints = [], listeners = {}, scrolls = [];
  let storeCb = null;
  const document = { hidden: false, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, getElementById: () => null };
  const c = { console, Object, Array, String, Math, JSON, Promise, Set, Date: { now: () => now }, document, DOCKED: false,
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onStore: fn => { storeCb = fn; }, load: () => { loads.push(now); return Promise.resolve(); },
    renderWorkspace: (rt, d, st) => paints.push({ status: rt.status, d, st }), restoreTabScroll: () => scrolls.push(now), showCounts: () => {} };
  vm.createContext(c);
  const src = cut('let dockMin = false', '// 8.0.7 (игрок 11.10') + '\n' + cut('const isLiveKey', 'async function liveStatusInto') + '\n'
    + cut('function loadSoon(gap', "document.addEventListener('visibilitychange'");
  vm.runInContext(src + '\nuserT = -1e9;', c);   // игрок в меню давно ничего не нажимал
  const advance = ms => { const end = now + ms;
    for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); }
    now = end; };
  return { c, loads, paints, scrolls, listeners, document, timers, advance, store: ch => storeCb(ch), at: v => { now = v; }, get now() { return now; },
    run: s => vm.runInContext(s, c), fire: t => (listeners[t] || []).forEach(f => f({ detail: { tab: 'craft' } })) };
}
const botRt = { rt: { newValue: { char: 'Hero', _src: 'content' }, oldValue: { char: 'Hero' } } };

test('live@Ник без других ключей — только строка «чем занят», без load()', () => {
  const D = dock();
  D.run(`lastPaint = { rt: { char: 'Hero', status: 'старый' }, d: { x: 1 }, st: { on: true }, statusRaw: 'старый' }`);
  D.store({ 'live@Hero': { newValue: { s: 'Бой: Golem', t: 1, char: 'Hero' } } });
  D.advance(10000);
  assert.equal(D.loads.length, 0, 'полная перерисовка не нужна');
  assert.equal(D.paints.length, 1); assert.equal(D.paints[0].status, 'Бой: Golem'); assert.equal(JSON.stringify(D.paints[0].st), '{"on":true}');
  D.store({ 'live@Other': { newValue: { s: 'чужой', char: 'Other' } } }); D.advance(5000);
  assert.equal(D.paints.length, 1, 'чужой герой — не наш показ'); assert.equal(D.loads.length, 0);
  D.store({ 'live@Hero': { newValue: { s: 'x', char: 'Other' } } }); D.advance(100);
  assert.equal(D.paints.at(-1).status, 'старый', 'ключ с чужим героем — rt.status прошлой отрисовки');
  D.store({ 'live@Hero': { oldValue: { s: 'y', char: 'Hero' } } }); D.advance(100);
  assert.equal(D.paints.at(-1).status, 'старый', 'ключ стёрт — rt.status');
  // live@ вместе с rt: строка сразу, полный load() — по паузе записи бота
  D.at(50000); D.run('loadT = 50000');
  D.store({ ...botRt, 'live@Hero': { newValue: { s: 'Бой: Basilisk', char: 'Hero' } } });
  assert.equal(D.paints.at(-1).status, 'Бой: Basilisk', 'строка — сразу');
  D.advance(1499); assert.equal(D.loads.length, 0); D.advance(1); assert.equal(D.loads.length, 1);
});

test('до первой отрисовки live@ ведёт к полному load(); скрытое меню не рисует', () => {
  const D = dock();
  D.store({ 'live@Hero': { newValue: { s: 'Бой', char: 'Hero' } } }); D.advance(2000);
  assert.equal(D.loads.length, 1, 'прошлой отрисовки нет — load()');
  D.document.hidden = true; D.run(`lastPaint = { rt: { char: 'Hero', status: 's' }, d: {}, st: {}, statusRaw: 's' }`);
  D.store({ 'live@Hero': { newValue: { s: 'Бой 2', char: 'Hero' } } }); D.store(botRt); D.advance(10000);
  assert.equal(D.paints.length, 0); assert.equal(D.loads.length, 1); assert.equal(D.run('loadPending'), true, 'перерисуем, когда покажут');
});

test('запись бота (rt без _src menu, wdog) — не раньше 1,5 с после прошлой перерисовки', () => {
  const D = dock(); D.run('loadT = 1000'); D.at(1100);
  D.store(botRt); D.advance(1399); assert.equal(D.loads.length, 0, 'не через 350 мс'); D.advance(1); assert.deepEqual(D.loads, [2500]);
  D.store(botRt); D.store({ wdog: { newValue: [1] } }); D.advance(1499); assert.equal(D.loads.length, 1); D.advance(1); assert.deepEqual(D.loads, [2500, 4000]);
  assert.equal(D.timers.length, 0, 'одна перерисовка на пачку записей');
  // давно не рисовали — первая запись рисуется сразу
  D.at(20000); D.store(botRt); D.advance(0); assert.deepEqual(D.loads.at(-1), 20000);
});

test('настройки, Старт/Пауза и запись меню — в пределах 350 мс; короткий запрос заменяет длинный таймер', () => {
  for (const ch of [{ cfg: { newValue: {} } }, { on: { newValue: true } }, { paused: { newValue: null } }, { rt: { newValue: { _src: 'menu' } } }]) {
    const D = dock(); D.run('loadT = 1000'); D.at(1100);
    D.store(ch); D.advance(249); assert.equal(D.loads.length, 0); D.advance(1); assert.deepEqual(D.loads, [1350], JSON.stringify(ch));
  }
  const D = dock(); D.run('loadT = 1000'); D.at(1100);
  D.store(botRt); D.at(1200); D.store({ cfg: { newValue: {} } });
  D.advance(150); assert.deepEqual(D.loads, [1350], 'клик не ждёт таймер записи бота');
  D.advance(5000); assert.deepEqual(D.loads, [1350], 'длинный таймер снят');
  // длинный запрос не отодвигает уже взведённый короткий
  const E = dock(); E.run('loadT = 1000'); E.at(1100); E.store({ cfg: { newValue: {} } }); E.store(botRt); E.advance(250); assert.deepEqual(E.loads, [1350]);
});

test('запись фона сразу после действия игрока в меню (src не menu) — тоже быстро', () => {
  const D = dock(); D.run('loadT = 1000'); D.at(1050);
  D.fire('pointerdown'); D.at(1100); D.store(botRt); D.advance(250); assert.deepEqual(D.loads, [1350]);
  D.at(10000); D.run('loadT = 10000'); D.at(10100); D.store(botRt); D.advance(400); assert.equal(D.loads.length, 1, 'через 3 с после клика — снова пауза бота');
  for (const t of ['keydown', 'input', 'change']) assert.ok(D.listeners[t]?.length, t);
});

test('смена раздела — load() сразу, отложенная перерисовка снята, прокрутка восстанавливается', async () => {
  const D = dock(); D.run('loadT = 1000'); D.at(1100); D.store(botRt); assert.equal(D.timers.length, 1);
  D.fire('l2:tabchange'); assert.deepEqual(D.loads, [1100], 'сразу');
  assert.equal(D.timers.length, 0, 'таймер записи бота снят');
  await new Promise(r => setImmediate(r)); assert.equal(D.scrolls.length, 1, 'restoreTabScroll после отрисовки');
});

// ---------- 2. load(): тяжёлые разделы только открытыми ----------
function loadBox(active) {
  const calls = [], U = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined : U,
    apply: () => U, set: () => true, has: () => true });
  const rec = name => new Proxy(function () {}, { get: (t, k) => U[k], apply: () => { calls.push(name); return U; }, set: () => true });
  const sec = { 'tab-hunt': 'hunt', 'tab-rb': 'rb', 'tab-epic': 'epic', 'tab-mammon': 'mammon', 'tab-craft': 'craft', 'tab-overview': 'overview' };
  const base = { console, Object, Array, String, Number, Boolean, Math, Date, JSON, Set, Map, Promise, RegExp, Error, Symbol, parseInt, isFinite, undefined, Infinity, NaN,
    document: { activeElement: null, getElementById: id => ({ classList: { contains: c => c === 'act' && sec[id] === active } }), querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async () => ({ cfg: {}, rt: { char: 'Hero', status: 's' }, on: false }) } }, runtime: { getManifest: () => ({ version: '0' }) } },
    L2Defaults: undefined, DEF: {}, settingsFailed: new Map(), TXT: [], NUM: [], BOOL: [], dlSig: {}, DOCKED: false, showAllCls: false };
  const ctx = new Proxy(base, { has: () => true, get: (t, k) => k in t ? t[k] : typeof k === 'string' ? rec(k) : undefined, set: (t, k, v) => { t[k] = v; return true; } });
  base.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(cut('let loadT = 0', '\n') + '\n' + cut('const secOpen', '\n') + '\n' + cut('const huntOpen', '\n') + '\n'
    + cut('async function load() {', '\n// шапка: цели задачи карточками') + ';this.L = load; this.LP = () => lastPaint;', ctx);
  return { load: () => base.L(), calls, base };
}
const HEAVY = { epic: ['renderEpics'], rb: ['renderRbTimer', 'renderHunt', 'renderRb'], mammon: ['renderMammon'], craft: ['renderCraft'], hunt: ['renderZones', 'renderHuntDb'] };
test('скрытые тяжёлые разделы не рисуются; открытый — рисуется', async () => {
  const all = Object.values(HEAVY).flat();
  { const B = loadBox('overview'); await B.load();
    for (const f of all) assert.ok(!B.calls.includes(f), f + ' при закрытом разделе');
    for (const f of ['renderDash', 'renderWorkspace', 'renderTvtShop', 'renderDailies', 'renderLoot', 'paintModes']) assert.ok(B.calls.includes(f), f + ' рисуется всегда');
    const P = B.base.LP(); assert.ok(P?.rt?.char === 'Hero' && P.statusRaw === 's' && P.st?.on === false, 'lastPaint для paintLive'); }
  for (const [sec, fns] of Object.entries(HEAVY)) {
    const B = loadBox(sec); await B.load();
    for (const f of fns) assert.ok(B.calls.includes(f), `${f} в открытом разделе ${sec}`);
    for (const f of all.filter(f => !fns.includes(f))) assert.ok(!B.calls.includes(f), `${f} не в разделе ${sec}`);
  }
});

test('элементы тяжёлых рендеров лежат в своих разделах', () => {
  const secOf = id => { const i = html.indexOf(`id="${id}"`); assert.ok(i > 0, id); const s = html.lastIndexOf('<section id="', i); return html.slice(s + 13, html.indexOf('"', s + 13)); };
  const map = { 'tab-epic': ['epicBox', 'epicTable', 'epicSum'], 'tab-rb': ['rbTimerTable', 'rbTimerSum', 'huntBox', 'huntQueue', 'rbOrderUp', 'rbOrderDown', 'rbList', 'rbTourBox'],
    'tab-mammon': ['mmNpcBox', 'mmOrderBox', 'mmLogBox', 'mmCraftBox', 'mmGoalItem', 'mmGoalLvl', 'mmGoalBox', 'mmBagStatus', 'mmBagAnalyze', 'mmPlanBox', 'mmGearBox'],
    'tab-craft': ['craftBox', 'craftPick', 'craftCatalog', 'craftList', 'craftShortage', 'craftModeState', 'craftPreview'], 'tab-hunt': ['zoneBox', 'lvlWin', 'routeBox'] };
  for (const [sec, ids] of Object.entries(map)) for (const id of ids) assert.equal(secOf(id), sec, id);
  // подписи кнопок разделов и прогноз РБ рисуются всегда, не из закрытых рендеров
  const load = cut('async function load() {', '\n// шапка: цели задачи карточками');
  for (const s of ["$('epicToggle2').textContent", "$('huntToggle2').textContent", "$('rbForecastBox')"]) assert.ok(load.includes(s), s);
  assert.match(load, /if \(huntOpen\(\)\) renderHuntDb\(rt, d\);/);
});
