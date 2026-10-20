'use strict';
// 20.41 (лог 20.10 21:09: «бот стал очень медленный», память rt 1,3 МБ): у фона больше нет слушателей chrome.storage.onChanged —
// каждая запись rt раньше доставлялась им целиком (старое+новое значение) в том же потоке фона, что и statePatch.
// Их работу делают сами писатели «on»: значок, controlSeq и новый отсчёт сторожа только при настоящем запуске off→on;
// прямые записи on:false зовут badgeSync, «Очистить журнал» — snapBytesReset. Фон загружается целиком, как в браузере.
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

test('сторож останавливает бота после 3 неудачных перезагрузок — значок гаснет без слушателя хранилища', async () => {
  const now = Date.now(), f = load(running({ wdog: [now - 360000, now - 420000, now - 480000], wdDown: null })); await tick(); const seq0 = f.seq();
  await f.alarm(); await tick();
  assert.equal(f.state.on, false); assert.equal(f.state.stopMeta.source, 'watchdog'); assert.equal(f.badges.at(-1), ''); assert.equal(f.painted(), false); assert.equal(f.seq(), seq0 + 1);
});

test('snapBytesReset: только со страницы расширения; следующий снимок перечитывает объём из хранилища', async () => {
  const f = load({ on: false, snapbytes: 0 }); await tick(); const ctx = f.ctx;
  vm.runInContext('snapBytes = 48 * 1024 * 1024', ctx);
  for (const s of [f.game, { id: 'other', url: 'chrome-extension://other/popup.html' }, { id: 'test', url: 'https://l2wap.com/chrome-extension://test/' }]) {
    await f.send({ cmd: 'snapBytesReset' }, s); await vm.runInContext('writing', ctx); assert.equal(f.vmGet('snapBytes'), 48 * 1024 * 1024, JSON.stringify(s));
  }
  await f.send({ cmd: 'snapBytesReset' }, f.popup); await vm.runInContext('writing', ctx);
  assert.equal(f.vmGet('snapBytes'), null); assert.equal(await vm.runInContext('snapBytesNow(null)', ctx), 0, 'перечитано 0 из storage');
});

test('snapBytesReset сериализован с записью снимков: снимок после очистки считает объём заново', async () => {
  const f = load({ on: false, snapbytes: 0 }); await tick(); const ctx = f.ctx, rows = new Map(), MB = 1024 * 1024;
  // Минимальная IndexedDB: хранит снимки, считает, отдаёт курсор по времени.
  const later = g => setImmediate(g);
  const db = { transaction: () => { const tx = { pending: 0, oncomplete: null, check() { if (!tx.pending) later(() => { if (!tx.pending && tx.oncomplete && !tx.done) { tx.done = true; tx.oncomplete(); } }); } };
    const req = fn => { const r = {}; Object.defineProperty(r, 'onsuccess', { set(cb) { tx.pending++; later(() => { r.result = fn(); cb({ target: r }); tx.pending--; tx.check(); }); } }); return r; };
    const cur = list => { const r = {}; let i = 0, cb; const step = () => { tx.pending++; later(() => { const v = list[i]; r.result = v ? { value: v, delete() { rows.delete(v.key); }, continue() { i++; step(); } } : null; cb({ target: r }); tx.pending--; tx.check(); }); };
      Object.defineProperty(r, 'onsuccess', { set(g) { cb = g; step(); } }); return r; };
    const st = { count: () => req(() => rows.size), getKey: k => req(() => rows.has(k) ? k : undefined), put: v => { rows.set(v.key, v); }, openCursor: () => cur([...rows.values()]), index: () => ({ openCursor: () => cur([...rows.values()].sort((a, b) => a.t - b.t)) }) };
    tx.objectStore = () => st; return tx; } };
  ctx.__db = db; vm.runInContext('idb = async () => __db;', ctx);
  vm.runInContext('snapBytes = 49 * 1024 * 1024', ctx);   // меню очистило IndexedDB и записало snapbytes:0; в памяти фона — старая сумма
  await f.send({ cmd: 'snapBytesReset' }, f.popup);
  await f.send({ cmd: 'snap', key: 'a', state: '', html: 'x'.repeat(2 * MB) }, f.game); await vm.runInContext('writing', ctx);
  assert.ok(rows.has('a'), 'новый снимок не удалён как «сверх 50 МБ»'); assert.equal(f.state.snapbytes, 2 * MB); assert.equal(f.vmGet('snapBytes'), 2 * MB);
});

test('писатели on:false вне фона зовут badgeSync; меню после очистки журнала — snapBytesReset', () => {
  const content = read('content.js'), popup = read('popup.js');
  for (const file of ['modules/dungeons.js', 'modules/fishing.js']) assert.match(read(file), /await chrome\.storage\.local\.set\(\{ on: false \}\); env\.badgeSync\?\.\(\);/, file);
  assert.match(content, /const badgeSync = \(\) => \{ try \{ chrome\.runtime\.sendMessage\(\{ cmd: 'badgeSync' \}\)/);
  for (const m of ['fishing', 'dungeons']) assert.match(content, new RegExp(`L2V7Modules\\.${m} = L2V7Factories\\.${m}\\(\\{ get badgeSync\\(\\)\\{return badgeSync\\}`), m);
  assert.match(popup, /on: false, stopMeta: \{ source: 'memory-import'[^\n]*\n\s*try \{ chrome\.runtime\.sendMessage\(\{ cmd: 'badgeSync' \}\)/);
  assert.match(popup, /snapbytes: 0, exLogKey: null, exSnapT: 0 \}\); try \{ chrome\.runtime\.sendMessage\(\{ cmd: 'snapBytesReset' \}\)/);
  // Других прямых записей «on» мимо фона нет: остальные идут через menuPatch/botControl/горячую клавишу/сторожа.
  const direct = [];
  for (const file of ['content.js', 'popup.js', 'ui-v7.js', ...fs.readdirSync(path.join(root, 'modules')).map(x => 'modules/' + x)])
    for (const line of read(file).split('\n')) if (/storage\.local\.set\(\{[^}]*\bon: ?(false|true)\b/.test(line)) direct.push(file);
  assert.deepEqual(direct.sort(), ['modules/dungeons.js', 'modules/fishing.js', 'popup.js']);
});
