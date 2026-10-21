'use strict';
// 20.41 (лог 20.10 21:09: «бот стал очень медленный», память rt 1,3 МБ): у фона больше нет слушателей chrome.storage.onChanged —
// каждая запись rt раньше доставлялась им целиком (старое+новое значение) в том же потоке фона, что и statePatch.
// Их работу делают сами писатели «on»: значок, controlSeq и новый отсчёт сторожа только при настоящем запуске off→on;
// прямые записи on:false зовут badgeSync. Объём снимков после «Очистить журнал» (ревью 20.41): пустое хранилище снимков = 0 байт,
// без сообщения от меню и при любом порядке записей. Фон загружается целиком, как в браузере.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bgSrc = read('background.js'), clone = x => x === undefined ? undefined : structuredClone(x);
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };

function load(initial = {}, opts = {}) {
  const state = clone(initial), badges = [], reloads = [], updates = [];
  let setHook = null, fetchGate = null;
  const local = {
    get: async keys => { const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async patch => { await setHook?.(patch); Object.assign(state, clone(patch)); },
    remove: async keys => { for (const k of [].concat(keys)) delete state[k]; },
  };
  const onChanged = ev();
  const chrome = {
    runtime: { id: 'test', onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: p => 'chrome-extension://test/' + p, lastError: null },
    storage: { local, onChanged },
    tabs: { query: async () => [], get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async id => { reloads.push(id); }, update: async (id, p) => { updates.push([id, p]); }, sendMessage: async () => {}, onRemoved: ev() },
    alarms: { get: async () => ({ name: 'l2watch' }), create: async () => {}, onAlarm: ev() }, permissions: { contains: async () => false },
  };
  if (!opts.android) Object.assign(chrome, { commands: { onCommand: ev() }, notifications: { create() {}, clear() {} },
    action: { setBadgeText: async o => { badges.push(o.text); }, setBadgeBackgroundColor: async () => {} } });
  const fetch = async () => { await (fetchGate?.promise); return { status: 200, headers: { get: () => 'application/json' } }; };
  // Таймеры фона (повтор записи журнала без IndexedDB раз в 3 с) не держат процесс теста.
  const unref = t => (t?.unref?.(), t);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout: (...a) => unref(setTimeout(...a)), clearTimeout, setInterval: (...a) => unref(setInterval(...a)), clearInterval, setImmediate, Date, Math, JSON, Promise, URL,
    structuredClone, fetch, indexedDB: undefined, self: {}, AbortController, crypto: { randomUUID: () => 'uuid' }, L2EngineCore: require('../engine-core.js') };
  sb.globalThis = sb;
  vm.createContext(sb); vm.runInContext(bgSrc, sb);
  const [onMessage] = chrome.runtime.onMessage.l;
  const send = (m, sender) => new Promise(res => { if (onMessage(m, sender, res) !== true) tick().then(() => res(undefined)); });
  const popup = { id: 'test', url: 'chrome-extension://test/popup.html' }, game = { id: 'test', frameId: 0, url: 'https://l2wap.com/map.html', tab: { id: 1 } };
  const vmGet = expr => vm.runInContext(expr, sb);
  return { state, badges, reloads, updates, chrome, onChanged, send, popup, game, vmGet, ctx: sb,
    seq: () => vmGet('serializeLock.controlSeq || 0'), painted: () => vmGet('paintedOn'),
    hotkey: () => chrome.commands.onCommand.l[0]('toggle-bot'), alarm: () => chrome.alarms.onAlarm.l[0]({ name: 'l2watch' }),
    onSet: f => { setHook = f; }, gateFetch: () => (fetchGate = defer()) };
}
const running = (over = {}) => {
  const now = Date.now();
  return { on: true, lock: { k: 'tab1', tab: 1, epoch: 'one', t: now }, hbBg: { tab: 1, t: now - 180000, page: '/map.html' }, wdog: [now - 60000], wdDown: { since: now - 600000, last: now - 300000 },
    rt: { char: 'Hero', manualKickAt: 1 }, cfg: {}, ...over };
};

test('фон не держит ни одного слушателя storage.onChanged (ни для «on», ни для snapbytes)', async () => {
  for (const android of [false, true]) { const f = load({ on: true }, { android }); await tick(); assert.equal(f.onChanged.l.length, 0, android ? 'Android' : 'Chrome'); }
  assert.doesNotMatch(bgSrc.replace(/\/\/[^\n]*/g, ''), /storage\.onChanged/);
  const f = load({ on: true }); await tick(); assert.deepEqual(f.badges.slice(-1), ['ON'], 'при пробуждении фона значок по факту «on»'); assert.equal(f.painted(), true);
});

test('Start из меню при остановленном боте: новый отсчёт сторожа (wdog, wdDown, hbBg) и значок ON', async () => {
  const f = load(running({ on: false })); await tick(); const seq0 = f.seq(), t0 = Date.now();
  assert.equal((await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 5 }, on: true }, f.popup)).ok, true);
  assert.equal(f.state.on, true); assert.deepEqual(f.state.wdog, []); assert.equal(f.state.wdDown, null); assert.ok(f.state.hbBg.t >= t0, 'пульс сдвинут на сейчас');
  assert.equal(f.seq(), seq0 + 2, 'controlSeq: до очереди и после записи'); assert.equal(f.badges.at(-1), 'ON'); assert.equal(f.painted(), true);
});

test('Start (выбор режима) при уже работающем боте не сбрасывает сторожа — как Chrome, не сообщавший о неизменном «on»', async () => {
  const f = load(running()); await tick(); const before = clone(f.state), seq0 = f.seq(), n = f.badges.length;
  assert.equal((await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 7 }, cfgPatch: { fishMode: true }, on: true }, f.popup)).ok, true);
  assert.deepEqual(f.state.wdog, before.wdog); assert.deepEqual(f.state.wdDown, before.wdDown); assert.deepEqual(f.state.hbBg, before.hbBg);
  assert.equal(f.seq(), seq0 + 1, 'только прежнее увеличение до очереди'); assert.equal(f.badges.length, n, 'значок уже ON — не перерисовываем');
});

test('Start без пульса хозяина замка не трогает счётчики сторожа (прежняя проверка lock === вкладка пульса)', async () => {
  const f = load(running({ on: false, lock: { k: 'tab2', tab: 2, epoch: 'x', t: Date.now() } })); await tick(); const before = clone(f.state);
  await f.send({ cmd: 'menuPatch', rtPatch: {}, on: true }, f.popup);
  assert.equal(f.state.on, true); assert.deepEqual(f.state.wdog, before.wdog); assert.deepEqual(f.state.hbBg, before.hbBg);
});

for (const via of ['botControl', 'menuPatch', 'hotkey']) test(`Stop через ${via}: controlSeq растёт после записи и значок гаснет`, async () => {
  const f = load(running()); await tick(); const seq0 = f.seq(); assert.equal(f.painted(), true);
  if (via === 'botControl') assert.equal((await f.send({ cmd: 'botControl', action: 'stop', reason: 'Стоп' }, f.popup)).ok, true);
  else if (via === 'menuPatch') assert.equal((await f.send({ cmd: 'menuPatch', rtPatch: {}, on: false }, f.popup)).ok, true);
  else await f.hotkey();
  assert.equal(f.state.on, false); assert.equal(f.seq(), seq0 + 2); assert.equal(f.badges.at(-1), ''); assert.equal(f.painted(), false);
});

test('горячая клавиша Start при остановленном боте сбрасывает сторожа, повторная остановка — нет', async () => {
  const f = load(running({ on: false })); await tick();
  await f.hotkey(); assert.equal(f.state.on, true); assert.deepEqual(f.state.wdog, []); assert.equal(f.state.wdDown, null); assert.equal(f.badges.at(-1), 'ON');
  f.state.wdog = [Date.now() - 1000]; await f.hotkey(); assert.equal(f.state.on, false); assert.equal(f.state.wdog.length, 1); assert.equal(f.badges.at(-1), '');
});

test('Stop из меню при уже остановленном боте не стирает значок «!» капчи', async () => {
  const f = load(running({ on: false })); await tick();
  await f.send({ cmd: 'alert', id: 'captcha', title: 'x', text: 'y' }, f.game); assert.equal(f.badges.at(-1), '!');
  await f.send({ cmd: 'botControl', action: 'stop', reason: 'Стоп' }, f.popup); assert.equal(f.badges.at(-1), '!');
  await f.alarm(); await tick(); assert.equal(f.badges.at(-1), '!', 'сторож раз в минуту не перерисовывает совпадающий значок');
  await f.send({ cmd: 'alertClear', id: 'captcha' }, f.game); await tick(); assert.equal(f.badges.at(-1), '');
});

test('badgeSync после прямой записи on:false (модуль, импорт памяти) гасит значок; при неизменном «on» — не трогает', async () => {
  const f = load(running()); await tick(); assert.equal(f.badges.at(-1), 'ON');
  await f.chrome.storage.local.set({ on: false }); await f.send({ cmd: 'badgeSync' }, f.game); await tick();
  assert.equal(f.badges.at(-1), ''); assert.equal(f.painted(), false);
  await f.send({ cmd: 'alert', id: 'pve' }, f.game); await f.send({ cmd: 'badgeSync' }, f.game); await tick(); assert.equal(f.badges.at(-1), '!');
});

test('сторож-страховка: значок расходится с «on» (badgeSync потерян) — перерисовывается в ближайший будильник', async () => {
  const f = load(running({ on: false })); await tick(); vm.runInContext('paintedOn = true', f.ctx); f.badges.length = 0;
  await f.alarm(); await tick(); assert.deepEqual(f.badges, ['']); assert.equal(f.painted(), false);
});

test('Firefox для Android (нет значка): badgeSync, Start и Stop не падают', async () => {
  const f = load(running({ on: false }), { android: true }); await tick();
  assert.equal((await f.send({ cmd: 'menuPatch', rtPatch: {}, on: true }, f.popup)).ok, true); assert.equal(f.painted(), true);
  await f.send({ cmd: 'badgeSync' }, f.game); assert.equal((await f.send({ cmd: 'botControl', action: 'stop' }, f.popup)).ok, true); assert.equal(f.painted(), false);
});

test('сторож без слушателя: прямая запись on:false во время probe — без reload; контроль: без неё reload есть', async () => {
  const ctl = load(running({ wdog: [], wdDown: null })); await tick(); await ctl.alarm(); await tick();
  assert.deepEqual(ctl.reloads, [1], 'контроль: молчащая вкладка перезагружается');
  const f = load(running({ wdog: [], wdDown: null })); await tick(); const gate = f.gateFetch(), seq0 = f.seq();
  const work = f.alarm(); await tick();
  await f.chrome.storage.local.set({ on: false });   // modules/fishing.js / dungeons.js: stopAfter — мимо очереди фона
  gate.resolve(); await work; await tick();
  assert.deepEqual(f.reloads, []); assert.deepEqual(f.updates, []); assert.equal(f.state.on, false); assert.equal(f.state.stopMeta, undefined);
  assert.deepEqual(f.state.wdog, [], 'попытка не засчитана'); assert.equal(f.seq(), seq0, 'controlSeq не нужен — сторож перечитал «on» под очередью');
});

test('сторож без слушателя: прямая on:false во время записи попытки — stillCurrent отменяет reload', async () => {
  const f = load(running({ wdog: [], wdDown: null })); await tick();
  f.onSet(async p => { if (p.wdog && !p.on && p.on !== false) { f.onSet(null); await f.chrome.storage.local.set({ on: false }); } });
  await f.alarm(); await tick();
  assert.deepEqual(f.reloads, []); assert.equal(f.state.on, false); assert.equal(f.state.wdog.length, 1);
});

// 20.43 (автономность, разбор 21.10): 3 неудачные перезагрузки больше не стоп — дальше редкая перезагрузка раз в 15 мин; стоп сторожа —
// только после 2,5 ч непрерывной тишины (wdSilent.since). Проверка значка без слушателя хранилища сохранена на этом новом пути стопа
test('сторож после 3 неудачных перезагрузок не останавливает, после 2,5 ч тишины останавливает — значок гаснет без слушателя хранилища', async () => {
  const now = Date.now(), e = load(running({ wdog: [now - 360000, now - 420000, now - 480000], wdDown: null })); await tick();
  await e.alarm(); await tick(); assert.equal(e.state.on, true); assert.deepEqual(e.reloads, []); assert.equal(e.painted(), true);
  const silent = { since: now - 151 * 60000, n: 12, last: now - 6 * 60000 };
  const f = load(running({ wdog: [now - 360000, now - 420000, now - 480000], wdDown: null, wdSilent: silent })); await tick(); const seq0 = f.seq();
  await f.alarm(); await tick();
  // 20.43 (разбор 21.10): стоп сторожа — самоостановка: «ON» гаснет, затем красный «!» (tests/v2043-notify-stop); при выключенной галке — пусто, как раньше
  assert.equal(f.state.on, false); assert.equal(f.state.stopMeta.source, 'watchdog'); assert.deepEqual(f.badges.slice(-2), ['', '!']); assert.equal(f.painted(), false); assert.equal(f.seq(), seq0 + 1);
  const g = load(running({ wdog: [now - 360000, now - 420000, now - 480000], wdDown: null, wdSilent: silent, cfg: { notifyStops: false } })); await tick();
  await g.alarm(); await tick(); assert.equal(g.state.on, false); assert.equal(g.badges.at(-1), ''); assert.equal(g.painted(), false);
});

// Минимальная IndexedDB для снимков: хранит, считает, отдаёт курсор по времени (как tests/v2013-core-step7-misc.test.js).
function snapDb(f, rows = new Map()) {
  const later = g => setImmediate(g);
  const db = { transaction: () => { const tx = { pending: 0, oncomplete: null, check() { if (!tx.pending) later(() => { if (!tx.pending && tx.oncomplete && !tx.done) { tx.done = true; tx.oncomplete(); } }); } };
    const req = fn => { const r = {}; Object.defineProperty(r, 'onsuccess', { set(cb) { tx.pending++; later(() => { r.result = fn(); cb({ target: r }); tx.pending--; tx.check(); }); } }); return r; };
    const cur = list => { const r = {}; let i = 0, cb; const step = () => { tx.pending++; later(() => { const v = list[i]; r.result = v ? { value: v, delete() { rows.delete(v.key); }, continue() { i++; step(); } } : null; cb({ target: r }); tx.pending--; tx.check(); }); };
      Object.defineProperty(r, 'onsuccess', { set(g) { cb = g; step(); } }); return r; };
    const st = { count: () => req(() => rows.size), getKey: k => req(() => rows.has(k) ? k : undefined), put: v => { rows.set(v.key, v); }, openCursor: () => cur([...rows.values()]), index: () => ({ openCursor: () => cur([...rows.values()].sort((a, b) => a.t - b.t)) }) };
    tx.objectStore = () => st; return tx; } };
  f.ctx.__db = db; vm.runInContext('idb = async () => __db;', f.ctx);
  const snap = async (key, bytes) => { await f.send({ cmd: 'snap', key, state: '', html: key.repeat(bytes) }, f.game); await vm.runInContext('writing', f.ctx); await tick(); };
  const real = () => [...rows.values()].reduce((a, r) => a + r.html.length, 0);
  return { rows, snap, real };
}
const MB = 1024 * 1024, K300 = 300 * 1024;
// «Очистить журнал» в меню (popup.js recClear): IndexedDB очищена, затем snapbytes:0 — фону ничего не шлётся
const menuClear = async (f, rows) => { rows.clear(); await f.chrome.storage.local.set({ reccount: 0, snapcount: 0, snapbytes: 0, exLogKey: null, exSnapT: 0 }); };

test('ревью 20.41: «Очистить журнал» без сообщения фону — следующие снимки не вытесняются, объём верный и после перезапуска фона', async () => {
  const f = load({ on: false, snapbytes: 49.5 * MB }); await tick(); const d = snapDb(f, new Map([['old', { key: 'old', t: 1, html: 'o'.repeat(1000) }]]));
  vm.runInContext('snapBytes = 49.5 * 1024 * 1024', f.ctx);   // фон бодрствует, в памяти — сумма почти полного хранилища
  await menuClear(f, d.rows); await tick();
  for (const k of ['a', 'b', 'c', 'd', 'e']) await d.snap(k, K300);
  assert.deepEqual([...d.rows.keys()], ['a', 'b', 'c', 'd', 'e'], 'ни один новый снимок не удалён «сверх 50 МБ»');
  assert.equal(f.state.snapbytes, 5 * K300); assert.equal(f.state.snapbytes, d.real()); assert.equal(f.state.snapcount, 5);
  vm.runInContext('snapBytes = null', f.ctx);   // перезапуск фона: сумма перечитывается из хранилища
  for (const k of ['f', 'g']) await d.snap(k, K300);
  assert.equal(d.rows.size, 7); assert.equal(f.state.snapbytes, 7 * K300); assert.equal(f.state.snapbytes, d.real());
});

test('ревью 20.41: снимок, вставший в очередь writing до очистки журнала, считает объём с нуля', async () => {
  const f = load({ on: false, snapbytes: 49 * MB }); await tick(); const d = snapDb(f, new Map([['old', { key: 'old', t: 1, html: 'o'.repeat(49 * MB) }]]));
  vm.runInContext('snapBytes = 49 * 1024 * 1024', f.ctx);
  const gate = defer(); f.ctx.__gate = gate.promise; vm.runInContext('writing = writing.then(() => __gate)', f.ctx);   // очередь занята медленной записью журнала
  f.chrome.runtime.onMessage.l[0]({ cmd: 'snap', key: 'a', state: '', html: 'a'.repeat(K300) }, f.game, () => {}); await tick();
  await menuClear(f, d.rows); await tick(10);
  gate.resolve(); await vm.runInContext('writing', f.ctx); await tick();
  for (const k of ['b', 'c', 'd']) await d.snap(k, K300);
  assert.deepEqual([...d.rows.keys()], ['a', 'b', 'c', 'd']); assert.equal(f.state.snapbytes, 4 * K300); assert.equal(f.state.snapbytes, d.real());
});

test('ревью 20.41: старая сумма в хранилище при пустом хранилище снимков (запись снимка легла после snapbytes:0) не занимает предел', async () => {
  const f = load({ on: false, snapbytes: 49.8 * MB }); await tick(); const d = snapDb(f);   // фон перезапущен: кэша нет, в storage — устаревшие 49,8 МБ
  await d.snap('x', 2 * MB); await d.snap('y', K300);
  assert.deepEqual([...d.rows.keys()], ['x', 'y']); assert.equal(f.state.snapbytes, 2 * MB + K300); assert.equal(f.state.snapbytes, d.real());
  // контроль: непустое хранилище по-прежнему копит сумму и вытесняет самые старые сверх 50 МБ
  const g = load({ on: false }); await tick(); const e = snapDb(g, new Map([['big', { key: 'big', t: 1, html: 'b'.repeat(49 * MB) }]]));
  await e.snap('p', K300); assert.equal(g.state.snapbytes, 49 * MB + K300); assert.ok(e.rows.has('big'));
  await e.snap('q', 2 * MB); assert.ok(!e.rows.has('big'), 'старый снимок вытеснен'); assert.deepEqual([...e.rows.keys()], ['p', 'q']); assert.equal(g.state.snapbytes, e.real());
});

test('писатели on:false вне фона зовут badgeSync; «Очистить журнал» фону ничего не шлёт (команды snapBytesReset нет)', () => {
  const content = read('content.js'), popup = read('popup.js');
  for (const file of ['modules/dungeons.js', 'modules/fishing.js']) assert.match(read(file), /await chrome\.storage\.local\.set\(\{ on: false \}\); env\.badgeSync\?\.\(\);/, file);
  assert.match(content, /const badgeSync = \(\) => \{ try \{ chrome\.runtime\.sendMessage\(\{ cmd: 'badgeSync' \}\)/);
  for (const m of ['fishing', 'dungeons']) assert.match(content, new RegExp(`L2V7Modules\\.${m} = L2V7Factories\\.${m}\\(\\{ get badgeSync\\(\\)\\{return badgeSync\\}`), m);
  assert.match(popup, /on: false, stopMeta: \{ source: 'memory-import'[^\n]*\n\s*try \{ chrome\.runtime\.sendMessage\(\{ cmd: 'badgeSync' \}\)/);
  assert.match(popup, /snapbytes: 0, exLogKey: null, exSnapT: 0 \}\); load\(\); \};/);
  for (const [file, src] of [['background.js', bgSrc], ['popup.js', popup]]) assert.doesNotMatch(src, /snapBytesReset/, file);
  assert.match(bgSrc, /n = e\.target\.result; if \(!n\) total = 0;/);
  // Других прямых записей «on» мимо фона нет: остальные идут через menuPatch/botControl/горячую клавишу/сторожа.
  const direct = [];
  for (const file of ['content.js', 'popup.js', 'ui-v7.js', ...fs.readdirSync(path.join(root, 'modules')).map(x => 'modules/' + x)])
    for (const line of read(file).split('\n')) if (/storage\.local\.set\(\{[^}]*\bon: ?(false|true)\b/.test(line)) direct.push(file);
  assert.deepEqual(direct.sort(), ['modules/dungeons.js', 'modules/fishing.js', 'popup.js']);
});
