'use strict';
// 20.43 (разбор 21.10): бот сам остановился или встал на паузу («Персонаж погиб», «3 смерти за 30 минут», сторож «3 перезагрузки…
// не помогли», «выход из Ashen Bastion не подтверждён») — раньше значок просто гас, уведомление было только у капчи и автовхода, а в меню
// причина пряталась в подсказке у мыши. Теперь: одно системное уведомление и красный «!» (фон, по stopMeta), постоянная строка причины в
// меню (#stopWarn), уведомление о неподтверждённой оплате дольше 15 мин (одно на id), галка cfg.notifyStops (ВКЛ), и пауза из-за сбоя
// при лежащем сервере ждёт сервер, как halt. Фон загружается целиком в vm (как tests/v2041-sw-no-storage-listener.test.js).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bgSrc = read('background.js'), content = read('content.js'), popup = read('popup.js'), clone = x => x === undefined ? undefined : structuredClone(x);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };

function load(initial = {}, opts = {}) {
  const state = clone(initial), session = {}, badges = [], colors = [], notes = [], cleared = [];
  const local = {
    get: async keys => { const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async patch => { Object.assign(state, clone(patch)); },
    remove: async keys => { for (const k of [].concat(keys)) delete state[k]; },
  };
  const storage = { local, onChanged: ev() };
  if (opts.session !== false) storage.session = { get: async k => (Object.hasOwn(session, k) ? { [k]: clone(session[k]) } : {}), set: async p => { Object.assign(session, clone(p)); } };
  const chrome = {
    runtime: { id: 'test', onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: p => 'chrome-extension://test/' + p, lastError: null },
    storage,
    tabs: { query: async () => [], get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async () => {}, update: async () => {}, sendMessage: async () => {}, onRemoved: ev() },
    alarms: { get: async () => ({ name: 'l2watch' }), create: async () => {}, onAlarm: ev() }, permissions: { contains: async () => false },
  };
  if (!opts.android) Object.assign(chrome, { commands: { onCommand: ev() },
    notifications: { create(id, o) { if (opts.noRequire && 'requireInteraction' in o) throw new Error('Property "requireInteraction" is unsupported by Firefox'); notes.push({ id, ...o }); return Promise.resolve(id); }, clear(id) { cleared.push(id); return Promise.resolve(true); } },
    action: { setBadgeText: async o => { badges.push(o.text); }, setBadgeBackgroundColor: async o => { colors.push(o.color); } } });
  const fetch = async () => ({ status: 200, headers: { get: () => 'application/json' } });
  const unref = t => (t?.unref?.(), t);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout: (...a) => unref(setTimeout(...a)), clearTimeout, setInterval: (...a) => unref(setInterval(...a)), clearInterval, setImmediate, Date, Math, JSON, Promise, URL,
    structuredClone, fetch, indexedDB: undefined, self: {}, AbortController, crypto: { randomUUID: () => 'uuid' }, L2EngineCore: require('../engine-core.js') };
  sb.globalThis = sb;
  vm.createContext(sb); vm.runInContext(bgSrc, sb);
  const [onMessage] = chrome.runtime.onMessage.l;
  const send = (m, sender) => new Promise(res => { if (onMessage(m, sender, res) !== true) tick().then(() => res(undefined)); });
  const popupS = { id: 'test', url: 'chrome-extension://test/popup.html' }, game = { id: 'test', frameId: 0, url: 'https://l2wap.com/map.html', tab: { id: 1 } };
  return { state, session, badges, colors, notes, cleared, chrome, send, popup: popupS, game, ctx: sb,
    hotkey: () => chrome.commands.onCommand.l[0]('toggle-bot'), alarm: () => chrome.alarms.onAlarm.l[0]({ name: 'l2watch' }) };
}
const running = (over = {}) => { const now = Date.now(); return { on: true, lock: { k: 'tab1', tab: 1, epoch: 'one', t: now }, hbBg: { tab: 1, t: now, page: '/map.html' }, wdog: [], wdDown: null, rt: { char: 'Hero', manualKickAt: 1 }, cfg: {}, ...over }; };
const selfStop = (f, reason = 'Персонаж погиб', action = 'stop') => f.send({ cmd: 'botControl', action, source: action === 'pause' ? 'content-pause' : 'content-halt', reason, char: 'Hero', epoch: 'one', kick: 1, ...(action === 'stop' ? { hard: true } : {}) }, f.game);

test('самоостановка вкладки (content-halt): одно уведомление с причиной и красный «!» после погасшего значка', async () => {
  const f = load(running()); await tick(); assert.equal(f.badges.at(-1), 'ON');
  assert.equal((await selfStop(f, '3 смерти за 30 минут — бот остановлен (проверьте уровень целей и настройки)')).ok, true);
  assert.equal(f.state.on, false); assert.equal(f.state.stopMeta.source, 'content-halt');
  assert.equal(f.badges.at(-1), '!'); assert.equal(f.colors.at(-1), '#c0392b');
  assert.equal(f.notes.length, 1); assert.equal(f.notes[0].id, 'l2bot-stop'); assert.equal(f.notes[0].title, 'L2wap Bot остановлен');
  assert.match(f.notes[0].message, /^\d\d:\d\d · 3 смерти за 30 минут/); assert.equal(f.notes[0].requireInteraction, true);
  await f.alarm(); await tick(); assert.equal(f.badges.at(-1), '!', 'страховка значка раз в минуту «!» не стирает');
});

test('пауза от самого бота (content-pause): уведомление «сам встал на паузу», «!»; «▶ Продолжить» снимает их', async () => {
  const f = load(running()); await tick();
  await selfStop(f, 'Тур РБ: выход из Ashen Bastion не подтверждён за минуту; проверь город и продолжи', 'pause');
  assert.ok(f.state.paused); assert.equal(f.notes.length, 1); assert.equal(f.notes[0].title, 'L2wap Bot сам встал на паузу'); assert.equal(f.badges.at(-1), '!');
  const t = f.state.stopMeta.t; f.state.paused = null;   // popup «▶ Продолжить»: paused:null, затем menuPatch on:true
  assert.equal((await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 9 }, on: true }, f.popup)).ok, true);
  assert.equal(f.badges.at(-1), 'ON'); assert.deepEqual(f.cleared, ['l2bot-stop']);
  assert.equal(f.state.stopMeta.t, t, 'время остановки прежнее — по нему stopPendRetry узнаёт дошедшую остановку'); assert.ok(f.state.stopMeta.resumed >= t);
  // следующий ручной стоп из меню — без «!» и без уведомления
  await f.send({ cmd: 'botControl', action: 'stop', source: 'popup-stop', reason: 'Нажата кнопка Стоп' }, f.popup);
  assert.equal(f.badges.at(-1), ''); assert.equal(f.notes.length, 1);
});

// 20.43 (автономность, разбор 21.10): 3 перезагрузки за 20 мин больше не стоп (дальше раз в 15 мин); стоп сторожа — после 2,5 ч тишины,
// уведомление и «!» на этом пути прежние
test('стоп сторожа фона (2,5 ч тишины, перезагрузки не помогли): уведомление «сторож: …» и «!»; 3 перезагрузки — ещё не стоп', async () => {
  const now = Date.now(), e = load(running({ hbBg: { tab: 1, t: now - 180000, page: '/map.html' }, wdog: [now - 360000, now - 420000, now - 480000] })); await tick();
  await e.alarm(); await tick(); assert.equal(e.state.on, true); assert.equal(e.notes.length, 0); assert.notEqual(e.badges.at(-1), '!');
  const f = load(running({ hbBg: { tab: 1, t: now - 180000, page: '/map.html' }, wdog: [now - 360000, now - 420000, now - 480000], wdSilent: { since: now - 155 * 60000, n: 11, last: now - 360000 } })); await tick();
  await f.alarm(); await tick();
  assert.equal(f.state.on, false); assert.equal(f.state.stopMeta.source, 'watchdog');
  assert.equal(f.badges.at(-1), '!'); assert.equal(f.notes.length, 1); assert.match(f.notes[0].message, /сторож: бот молчит 15\d мин подряд \(с \d\d:\d\d\), перезагрузки вкладки \(11\) не помогли/);
});

for (const via of ['popup-stop', 'popup-pause', 'menuPatch', 'hotkey', 'esc']) test(`ручная остановка (${via}) — без уведомления и без «!»`, async () => {
  const f = load(running()); await tick();
  if (via === 'popup-stop' || via === 'popup-pause') await f.send({ cmd: 'botControl', action: via.slice(6), source: via, reason: 'x' }, f.popup);
  else if (via === 'menuPatch') await f.send({ cmd: 'menuPatch', rtPatch: {}, on: false }, f.popup);
  else if (via === 'hotkey') await f.hotkey();
  else await f.send({ cmd: 'botControl', action: 'stop', user: true, reason: 'Остановлено (Esc ×2)' }, f.game);
  assert.equal(f.state.on, false); assert.equal(f.notes.length, 0); assert.equal(f.badges.at(-1), '');
});

test('ручной стоп после самоостановки снимает «!»; Старт клавишей тоже снимает', async () => {
  const f = load(running()); await tick(); await selfStop(f); assert.equal(f.badges.at(-1), '!');
  await f.send({ cmd: 'botControl', action: 'stop', source: 'popup-stop', reason: 'Нажата кнопка Стоп' }, f.popup); assert.equal(f.badges.at(-1), '');
  const g = load(running()); await tick(); await selfStop(g); await g.hotkey(); assert.equal(g.state.on, true); assert.equal(g.badges.at(-1), 'ON'); assert.ok(g.state.stopMeta.resumed);
});

test('перезапуск фона MV3: «!» восстанавливается по stopMeta; после Старта, ручного стопа или при выключенной галке — нет', async () => {
  const t = Date.now() - 60000, meta = { source: 'content-halt', reason: 'Персонаж погиб', t };
  let f = load({ on: false, stopMeta: meta, cfg: {} }); await tick(); assert.equal(f.badges.at(-1), '!');
  f = load({ on: false, stopMeta: { ...meta, source: 'watchdog' }, cfg: {} }); await tick(); assert.equal(f.badges.at(-1), '!');
  f = load({ on: false, stopMeta: { ...meta, resumed: t + 1 }, cfg: {} }); await tick(); assert.equal(f.badges.at(-1), '');
  f = load({ on: false, stopMeta: { ...meta, source: 'popup-stop' }, cfg: {} }); await tick(); assert.equal(f.badges.at(-1), '');
  f = load({ on: false, stopMeta: meta, cfg: { notifyStops: false } }); await tick(); assert.equal(f.badges.at(-1), '');
  f = load({ on: true, stopMeta: meta, cfg: {} }); await tick(); assert.equal(f.badges.at(-1), 'ON');
});

test('галка «Уведомлять об остановках» выключена — как раньше: ни уведомления, ни «!»', async () => {
  const f = load(running({ cfg: { notifyStops: false } })); await tick(); await selfStop(f);
  assert.equal(f.state.on, false); assert.equal(f.notes.length, 0); assert.equal(f.badges.at(-1), '');
});

test('шум: одна и та же причина (цифры не в счёт) — одно уведомление за 30 мин, другая причина — новое; «!» каждый раз', async () => {
  const f = load(running()); await tick();
  await selfStop(f, 'бот молчит 160 с — стоп'); f.state.on = true; await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 2 }, on: false }, f.popup);
  await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 3 }, on: true }, f.popup); await selfStop(f, 'бот молчит 172 с — стоп');
  assert.equal(f.notes.length, 1); assert.equal(f.badges.at(-1), '!');
  await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 4 }, on: true }, f.popup); await selfStop(f, 'Персонаж погиб');
  assert.equal(f.notes.length, 2); assert.ok(f.session.noteSeen, 'отметки — в storage.session (переживают перезапуск фона)');
  f.session.noteSeen = Object.fromEntries(Object.entries(f.session.noteSeen).map(([k, t]) => [k, t - 31 * 60000]));   // прошло 31 мин
  await f.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 5 }, on: true }, f.popup); await selfStop(f, 'Персонаж погиб'); assert.equal(f.notes.length, 3);
});

test('Firefox: requireInteraction не принят — уведомление уходит без него; Android без notifications/action — стоп работает', async () => {
  const f = load(running(), { noRequire: true }); await tick(); await selfStop(f);
  assert.equal(f.notes.length, 1); assert.equal('requireInteraction' in f.notes[0], false); assert.match(f.notes[0].message, /Персонаж погиб/);
  const a = load(running(), { android: true, session: false }); await tick();
  assert.equal((await selfStop(a)).ok, true); assert.equal(a.state.on, false);
  await a.send({ cmd: 'menuPatch', rtPatch: { manualKickAt: 2 }, on: true }, a.popup); assert.equal(a.state.on, true);
});

test('badgeSync после импорта памяти (stopMeta memory-import) снимает прежний «!» самоостановки', async () => {
  const f = load(running()); await tick(); await selfStop(f); assert.equal(f.badges.at(-1), '!');
  await f.chrome.storage.local.set({ on: false, stopMeta: { source: 'memory-import', reason: 'Импорт памяти', t: Date.now() } });
  await f.send({ cmd: 'badgeSync' }, f.popup); await tick(); assert.equal(f.badges.at(-1), '');
});

test('оплата без подтверждения дольше 15 мин — одно уведомление на id (и при остановленном боте); моложе 15 мин и при выключенной галке — нет', async () => {
  const now = Date.now(), pend = (id, ago) => ({ actionPayments: { pending: { id, kind: 'raid-teleport', at: now - ago, char: 'Hero', quote: { amount: 120000, currency: 'adena' }, evidence: {} } } });
  const f = load({ on: false, cfg: {}, rt: { char: 'Hero', ...pend('p1', 10 * 60000) } }); await tick();
  await f.alarm(); await tick(); assert.equal(f.notes.length, 0, 'моложе 15 мин');
  f.state.rt = { char: 'Hero', ...pend('p1', 16 * 60000) }; await f.alarm(); await tick();
  assert.equal(f.notes.length, 1); assert.equal(f.notes[0].id, 'l2bot-pay'); assert.match(f.notes[0].message, /телепорт к РБ · 120\s000 adena ждёт сверки 16 мин/); assert.match(f.notes[0].message, /Считать оплату не прошедшей/);
  assert.equal(f.notes[0].requireInteraction, undefined); assert.equal(f.badges.at(-1), '', 'оплата значок не трогает');
  await f.alarm(); await tick(); assert.equal(f.notes.length, 1, 'та же оплата — без повтора');
  f.state.rt = { char: 'Hero', ...pend('p2', 20 * 60000) }; await f.alarm(); await tick(); assert.equal(f.notes.length, 2, 'новая оплата — новое уведомление');
  const g = load({ on: false, cfg: { notifyStops: false }, rt: { char: 'Hero', ...pend('p3', 30 * 60000) } }); await tick(); await g.alarm(); await tick(); assert.equal(g.notes.length, 0);
  assert.match(bgSrc, /void payAlert\(state\.rt, state\.cfg\)\.catch/, 'проверка в будильнике сторожа не держит очередь');
});

// ---- content.js: пауза из-за сбоя ждёт сервер, как halt
function pauseFixture({ up = true, current = true } = {}) {
  const calls = [], c = { on: true, netOutage: { since: 0, last: 0 }, automationSnapshot: () => 1, automationCurrent: () => current,
    srvUp: async () => { calls.push('srvUp'); return up; }, serverWait: async () => { calls.push('serverWait'); }, rec: (...a) => calls.push('rec:' + a.join('|')),
    automationStop: async (msg, action) => { calls.push(`stop:${action}:${msg}`); c.on = false; } };
  vm.createContext(c); vm.runInContext(slice(content, 'async function pauseBot(', '// ---------- переходы') + ';this.P=pauseBot;', c);
  return { c, calls };
}
test('pauseBot: сбой при лежащем сервере — ждём сервер (serverWait), паузы нет', async () => {
  const { c, calls } = pauseFixture({ up: false }); await c.P('Тур РБ: карта не загрузилась после обновления', { fault: true });
  assert.deepEqual(calls.filter(x => !x.startsWith('rec:')), ['srvUp', 'serverWait']); assert.equal(c.on, true); assert.ok(c.netOutage.since > 0);
  assert.match(calls.find(x => x.startsWith('rec:')), /сервер игры не отвечает: жду сервер, на паузу не встаю/);
});
test('pauseBot: сбой при живом сервере — пауза как раньше; без fault («один РБ», Маммон) — сразу, без проверки сервера', async () => {
  let f = pauseFixture({ up: true }); await f.c.P('Телепорт: x', { fault: true }); assert.deepEqual(f.calls.filter(x => !x.startsWith('rec:')), ['srvUp', 'stop:pause:Телепорт: x']);
  f = pauseFixture({ up: false }); await f.c.P('🎯 По одному РБ: РБ убит'); assert.deepEqual(f.calls.filter(x => !x.startsWith('rec:')), ['stop:pause:🎯 По одному РБ: РБ убит']);
  f = pauseFixture({ up: true, current: false }); await f.c.P('Телепорт: x', { fault: true }); assert.deepEqual(f.calls, ['srvUp'], 'Стоп игрока во время проверки — паузу не пишем');
  f = pauseFixture({ up: false }); f.c.on = false; await f.c.P('Телепорт: x', { fault: true }); assert.deepEqual(f.calls.filter(x => !x.startsWith('rec:')), ['stop:pause:Телепорт: x'], 'бот уже стоит — без ожидания');
});
test('паузы из-за сбоя помечены fault (карта, Ashen, телепорт); «один РБ» и визит к Маммону — нет', () => {
  const raid = read('modules/raid.js'), epics = read('modules/epics.js'), nav = read('modules/navigation.js'), mammon = read('modules/mammon.js');
  // 20.43 (автономность, разбор 21.10): бесплатный выход из Ashen не ставит паузу через минуту и без кнопки — бот сам повторяет выход раз в
  // минуту и обновляет страницу; единственная оставшаяся пауза выхода (60 промахов подряд) и запасная пауза карты (старое ядро без selfHold) — fault
  for (const re of [/выход из Ashen Bastion не подтверждён \$\{ASHEN_MISS_MAX\} раз подряд \(≈1 ч\); проверь город и продолжи`,\{fault:true\}\)/,
    /карта не загрузилась после обновления; цель \$\{H\.name\} сохранена\. Проверь игру и продолжи`, \{ fault: true \}\)/]) assert.match(raid, re);
  for (const re of [/выход из Ashen Bastion не подтверждён за минуту; проверь город/, /не найдена штатная кнопка выхода из Ashen Bastion в город'/, /сервер не подтвердил выход из Ashen Bastion; проверь город/]) assert.doesNotMatch(raid, re);
  assert.match(epics, /Эпики: карта не загрузилась после обновления; цель \$\{e\.nm\} сохранена\. Проверь игру и продолжи`, \{ fault: true \}\)/);
  // 20.43 (доводка 21.10, ревью сверки): причина паузы телепорта — в переменной msg (по ней navigation узнаёт запись фона именно этой паузы)
  assert.match(nav, /const msg = `Телепорт: \$\{why\}\. Проверьте положение героя`, t0 = Date\.now\(\);\n\s*await env\.pauseBot\?\.\(msg, \{ fault: true \}\)/); assert.match(nav, /pauseBot\(`Возврат в Ashen Bastion: \$\{why\}`, \{ fault: true \}\)/);
  assert.doesNotMatch(raid.match(/return env\.pauseBot\(`🎯 По одному РБ[^\n]*/)[0], /fault/); assert.doesNotMatch(mammon.match(/await env\.pauseBot\(`пришёл к [^\n]*/)[0], /fault/);
});

// ---- popup.js: постоянная строка причины
function popupLine() { const c = { Date, String, Number }; vm.createContext(c); vm.runInContext(slice(popup, 'function selfStopLine(', 'function workspaceState(') + ';this.L=selfStopLine;', c); return c.L; }
test('меню: строка «Остановлен сам в ЧЧ:ММ: причина» только для своих остановок', () => {
  const L = popupLine(), now = Date.parse('2026-10-21T03:20:00Z'), t = now - 8 * 60000, hm = new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  assert.equal(L({ source: 'content-halt', reason: 'Персонаж погиб', t }, null, now), `Остановлен сам в ${hm}: Персонаж погиб`);
  assert.equal(L({ source: 'watchdog', reason: 'бот молчит 160 с', t }, null, now), `Остановлен сторожем в ${hm}: бот молчит 160 с`);
  assert.equal(L({ source: 'content-pause', reason: 'Телепорт: x', t }, { t, why: 'x' }, now), `Сам встал на паузу в ${hm}: Телепорт: x`);
  assert.equal(L({ source: 'content-pause', reason: 'Телепорт: x', t }, null, now), '', 'пауза уже снята');
  for (const source of ['popup-stop', 'popup-pause', 'popup-menu', 'hotkey', 'content-user', 'memory-import']) assert.equal(L({ source, reason: 'x', t }, source === 'popup-pause' ? { t } : null, now), '', source);
  assert.equal(L({ source: 'content-halt', reason: 'x', t, resumed: t + 1 }, null, now), '', 'после Старта строки нет');
  assert.equal(L(null, null, now), ''); assert.equal(L({ source: 'content-halt', reason: 'x' }, null, now), '');
  const old = now - 2 * 86400000; assert.match(L({ source: 'content-halt', reason: 'x', t: old }, null, now), new RegExp(`^Остановлен сам ${new Date(old).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }).replace(/\./g, '\\.')} в `));
});
test('меню: строка — отдельным баннером #stopWarn (не title), читает stopMeta; галка в «Сервисе», умолчание ВКЛ', () => {
  const html = read('popup.html');
  assert.match(html, /<div id="stopWarn" class="wake-warn" role="status" hidden><\/div>/);
  assert.match(html, /<label>🔔 Уведомлять об остановках <input id="notifyStops" type="checkbox"><\/label>/);
  assert.match(popup, /'stopMeta'\]\);/); assert.match(popup, /const line = on \? '' : selfStopLine\(stopMeta, paused\), w = \$\('stopWarn'\);/);
  assert.match(popup, /^const BOOL = \[[^\n]*'dock', 'notifyStops',[^\n]*\];$/m); assert.equal(require('../defaults.js').CFG.notifyStops, true);
  assert.match(read('ui-v7.js'), /notifyStops:'Бот остановился или встал на паузу сам/);
});
