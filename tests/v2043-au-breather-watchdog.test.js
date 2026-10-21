'use strict';
// 20.43 (автономность, разбор 21.10): фоновый сторож (background.js wdPlan) больше не выключает бота после 3 неудачных перезагрузок за 20 мин:
// для всех задач, как у рыбалки, — дальше редкая перезагрузка раз в 15 мин, а on:false (с уведомлением и «!») — только после 2,5 ч
// непрерывной тишины. Серия тишины rt-независима (storage wdSilent {since, n, last}); в журнал — начало редких перезагрузок и конец серии.
// Фон загружается целиком в vm (как tests/v2043-notify-stop.test.js).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), clone = x => x === undefined ? undefined : structuredClone(x);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };
const MIN = 60000;

function load(initial = {}) {
  const state = clone(initial), reloads = [], notes = [], logged = [];
  const local = {
    get: async keys => { const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async patch => { Object.assign(state, clone(patch)); }, remove: async keys => { for (const k of [].concat(keys)) delete state[k]; },
  };
  const chrome = {
    runtime: { id: 'test', onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: p => 'chrome-extension://test/' + p, lastError: null },
    storage: { local, onChanged: ev(), session: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [], get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async id => { reloads.push(id); }, update: async (id, o) => { reloads.push(o?.url || id); }, sendMessage: async () => {}, onRemoved: ev() },
    alarms: { get: async () => ({ name: 'l2watch' }), create: async () => {}, onAlarm: ev() }, permissions: { contains: async () => false }, commands: { onCommand: ev() },
    notifications: { create(id, o) { notes.push({ id, ...o }); return Promise.resolve(id); }, clear: () => Promise.resolve(true) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const unref = t => (t?.unref?.(), t);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout: (...a) => unref(setTimeout(...a)), clearTimeout, setInterval: (...a) => unref(setInterval(...a)), clearInterval, setImmediate, Date, Math, JSON, Promise, URL,
    structuredClone, fetch: async () => ({ status: 200, headers: { get: () => 'application/json' } }), indexedDB: undefined, self: {}, AbortController, crypto: { randomUUID: () => 'uuid' }, L2EngineCore: require('../engine-core.js'), __logged: logged };
  sb.globalThis = sb; vm.createContext(sb); vm.runInContext(bgSrc, sb);
  vm.runInContext('flush = function () { timer = null; __logged.push(...buf.map(e => e.what)); buf = []; };', sb);   // журнал — в массив теста
  const [onMessage] = chrome.runtime.onMessage.l, popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const send = m => new Promise(res => { if (onMessage(m, popup, res) !== true) tick().then(() => res(undefined)); });
  return { state, reloads, notes, logged, sb, send, alarm: () => chrome.alarms.onAlarm.l[0]({ name: 'l2watch' }) };
}
const running = (over = {}) => { const now = Date.now(); return { on: true, lock: { k: 'tab1', tab: 1, epoch: 'one', t: now }, hbBg: { tab: 1, t: now, page: '/map.html' }, wdog: [], wdDown: null, rt: { char: 'Hero', manualKickAt: 1 }, cfg: { autoTasks: ['farm'] }, ...over }; };
// тишина вкладки: последний пульс ms назад — и в хранилище, и в памяти фона (hbMem после перезагрузки держит её время)
const quiet = (f, ms) => { f.state.hbBg = { ...f.state.hbBg, t: Date.now() - ms }; vm.runInContext('hbMem = null;', f.sb); };

test('серия тишины: 3 обычные перезагрузки, затем раз в 15 мин без стопа; журнал — только переход на редкие перезагрузки', async () => {
  const f = load(running()); await tick(); quiet(f, 200000); const pulse = f.state.hbBg.t;
  await f.alarm(); await tick(); assert.deepEqual(f.reloads, [1]); assert.equal(f.state.wdSilent.n, 1); assert.equal(f.state.wdSilent.since, pulse, 'начало серии — последний настоящий пульс');
  for (let i = 2; i <= 3; i++) { quiet(f, 200000); await f.alarm(); await tick(); }
  assert.equal(f.reloads.length, 3); assert.equal(f.state.wdSilent.n, 3); assert.equal(f.state.wdSilent.since, pulse);
  assert.equal(f.logged.filter(x => /перезагружаю вкладку \d\/3/.test(x)).length, 3);
  // сразу после третьей — ждём (раз в 15 мин), бот включён
  quiet(f, 200000); await f.alarm(); await tick(); assert.equal(f.reloads.length, 3); assert.equal(f.state.on, true);
  // прошло 15 мин с последней — редкая перезагрузка, строка в журнал одна (начало редких)
  f.state.wdog = f.state.wdog.map(t => t - 16 * MIN); f.state.wdSilent.last -= 16 * MIN; quiet(f, 200000);
  await f.alarm(); await tick(); assert.equal(f.reloads.length, 4); assert.equal(f.state.on, true); assert.equal(f.state.wdSilent.n, 4);
  assert.equal(f.logged.filter(x => /дальше перезагружаю раз в 15 мин, не останавливаю/.test(x)).length, 1);
  f.state.wdog = f.state.wdog.map(t => t - 16 * MIN); f.state.wdSilent.last -= 16 * MIN; quiet(f, 200000);
  await f.alarm(); await tick(); assert.equal(f.reloads.length, 5); assert.equal(f.logged.filter(x => /раз в 15 мин/.test(x)).length, 1, 'дальше молча до конца серии');
  assert.equal(f.notes.length, 0, 'уведомления нет — бот не остановлен');
});
test('2,5 ч непрерывной тишины — стоп с причиной, уведомлением и stopMeta сторожа; серия сброшена', async () => {
  const now = Date.now(), f = load(running({ wdog: [now - 20 * MIN], wdSilent: { since: now - 151 * MIN, n: 9, last: now - 16 * MIN } })); await tick(); quiet(f, 200000);
  await f.alarm(); await tick();
  assert.equal(f.state.on, false); assert.equal(f.state.wdSilent, null); assert.equal(f.state.stopMeta.source, 'watchdog'); assert.match(f.state.stopMeta.reason, /бот молчит 15\d мин подряд \(с \d\d:\d\d\), перезагрузки вкладки \(9\) не помогли — останавливаю/);
  assert.equal(f.notes.length, 1); assert.equal(f.reloads.length, 0);
  // 2 ч 20 мин — ещё редкая перезагрузка, не стоп
  const g = load(running({ wdSilent: { since: now - 140 * MIN, n: 9, last: now - 16 * MIN } })); await tick(); quiet(g, 200000);
  await g.alarm(); await tick(); assert.equal(g.state.on, true); assert.equal(g.reloads.length, 1);
});
test('вкладка снова пульсирует ≥ 3 мин после перезагрузки — серия окончена: строка в журнал и сброс; короткий пульс серию не обрывает', async () => {
  const now = Date.now(), f = load(running({ wdSilent: { since: now - 60 * MIN, n: 5, last: now - 2 * MIN } })); await tick();
  await f.alarm(); await tick(); assert.ok(f.state.wdSilent, 'пульс 2 мин после перезагрузки — серия продолжается');
  f.state.wdSilent.last = now - 4 * MIN; await f.alarm(); await tick();
  assert.equal(f.state.wdSilent, null); assert.equal(f.logged.filter(x => /вкладка снова работает: тишина \d+ мин, перезагрузок 5/.test(x)).length, 1);
  const g = load(running({ wdSilent: { since: now - 10 * MIN, n: 1, last: now - 4 * MIN } })); await tick(); await g.alarm(); await tick();
  assert.equal(g.state.wdSilent, null); assert.equal(g.logged.length, 0, 'одна удачная перезагрузка — в журнал не пишем (её строка уже есть)');
});
test('лежащий сервер — не тишина бота: серия сброшена, перезагрузка раз в 2 мин, стопа нет даже после 3 ч тишины', async () => {
  const now = Date.now(), f = load(running({ wdSilent: { since: now - 180 * MIN, n: 12, last: now - 16 * MIN } })); await tick(); quiet(f, 200000);
  f.sb.fetch = async () => ({ status: 502, headers: { get: () => 'text/html' } });
  await f.alarm(); await tick();
  assert.equal(f.state.on, true); assert.equal(f.state.wdSilent, null); assert.ok(f.state.wdDown?.since > 0); assert.deepEqual(f.reloads, [1]); assert.equal(f.notes.length, 0);
});
test('рыбалка — как раньше: после 3 перезагрузок раз в 5 мин на страницу рыбалки, без стопа даже после 2,5 ч', async () => {
  const now = Date.now(), f = load(running({ cfg: { autoTasks: ['fish'] }, wdog: [now - 6 * MIN, now - 7 * MIN, now - 8 * MIN], wdSilent: { since: now - 200 * MIN, n: 20, last: now - 6 * MIN } })); await tick(); quiet(f, 200000);
  await f.alarm(); await tick(); assert.equal(f.state.on, true); assert.equal(f.reloads.length, 1); assert.match(String(f.reloads[0]), /\/fishing\.html$/);
});
test('новый Старт сбрасывает серию тишины (как wdog/wdDown); ручной Стоп — всегда стоп', async () => {
  const now = Date.now(), f = load({ ...running({ wdSilent: { since: now - 100 * MIN, n: 7, last: now - 16 * MIN } }), on: false }); await tick();
  assert.ok(f.state.wdSilent);
  await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 9 }, on: true }); await tick();
  assert.equal(f.state.on, true); assert.equal(f.state.wdSilent, null); assert.equal(f.state.wdog.length, 0);
  await f.send({ cmd: 'botControl', action: 'stop', source: 'popup-stop', reason: 'Нажата кнопка Стоп' }); await tick(); assert.equal(f.state.on, false);
  quiet(f, 200000); await f.alarm(); await tick(); assert.equal(f.reloads.length, 0, 'остановленного бота сторож не будит');
});
