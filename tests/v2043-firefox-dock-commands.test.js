'use strict';
// 20.43 (разбор 21.10): встроенное меню Firefox (iframe с runtime/storage, без chrome.tabs). Старт/быстрый запуск/смена режима
// (wakeGame → kick), кнопки Warlock (preview/resetBudget/archiveUnknown) и «Проверить панель»/«Предложить роли»/«Снимок страницы»
// падали на chrome.tabs. Теперь одна функция gameSend: есть tabs — как раньше, нет — фон пересылает команду только родительской
// вкладке меню (frame 0) и только из белого списка. Проверяем фон (dockGameCommand) и меню (gameSend и кнопки) через vm.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8'), plain = x => JSON.parse(JSON.stringify(x));
const background = read('background.js'), popup = read('popup.js'), content = read('content.js'), smoke = read('tests/tools/firefox-smoke.cjs');
const slice = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, 'нет начала: ' + from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, 'нет конца: ' + to); return src.slice(a, b); };
const relaySource = slice(background, 'const DOCK_GAME_WAIT', '\nchrome.runtime.onMessage.addListener');
const wakeSource = slice(popup, 'const WAKE_KEY', 'async function activateMode(');
const warlockSource = slice(popup, 'async function warlockMenuCommand(', 'const warlockUI=');
const panelSource = slice(popup, "$('check').onclick", "$('apply').onclick");
const domSource = slice(popup, "$('recDom').onclick", '// ---------- 💾 память бота');
const VERSION = '20.42';
const tick = async (n = 40) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// ---------- фон: пересылка только родителю, только белый список ----------
function relay() {
  const forwarded = [], tabsRead = [], timers = new Map(), delays = []; let id = 0, answer = { ok: true }, failed = false, hung = false;
  const state = { on: false, rt: { char: 'AuditHero', manualKickAt: 10 } }, tab = { id: 7, url: 'https://l2wap.com/map.html' };
  const sender = { id: 'bot@test', url: 'moz-extension://bot-host/popup.html?dock=1&r=5', frameId: 3, tab: { id: 7, url: 'https://ignored.invalid/' } };
  const box = { URL, Object, Array, Number, Promise, setTimeout: (fn, ms) => { timers.set(++id, fn); delays.push(ms); return id; }, clearTimeout: k => timers.delete(k),
    chrome: { runtime: { id: 'bot@test', getURL: p => 'moz-extension://bot-host/' + p }, storage: { local: { get: async () => structuredClone(state) } },
      tabs: { get: async n => { tabsRead.push(n); return structuredClone(tab); }, sendMessage: async (...args) => { forwarded.push(plain(args)); if (failed) throw Error('Could not establish connection'); if (hung) return new Promise(() => {}); return answer; } } } };
  vm.createContext(box); vm.runInContext(relaySource + '\nglobalThis.run=dockGameCommand;', box);
  return { state, tab, sender, forwarded, tabsRead, timers, delays, run: m => box.run(m, sender), answer: x => answer = x, fail: () => failed = true, hang: () => hung = true };
}
const warlockMsg = (o = {}) => ({ cmd: 'warlockCommand', id: 'uuid-1', action: 'preview', char: 'AuditHero', budgetEpoch: 123, spent: 0, ...o });

test('слушатель фона принимает dockGameCommand и отвечает асинхронно', () => {
  assert.match(background, /m\?\.cmd === 'dockGameCommand'\) \{\s*dockGameCommand\(m, _s\)\.then\(reply\)/);
});
for (const cmd of ['kick', 'slots', 'suggest', 'dom']) test('белый список: ' + cmd + ' уходит один раз родителю меню, frame 0, без лишних полей', async () => {
  const f = relay();
  const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', tabId: 999, message: { cmd, tabId: 999, frameId: 5, expectedChar: 'Other', injected: { cmd: 'lifestoneCommand' } } });
  assert.equal(r.relayed, true);
  assert.deepEqual(f.forwarded, [[7, { cmd }, { frameId: 0 }]]); assert.deepEqual(f.tabsRead, [7]); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.state, { on: false, rt: { char: 'AuditHero', manualKickAt: 10 } }, 'пересылка не меняет хранилище');
});
for (const action of ['preview', 'resetBudget', 'archiveUnknown']) test('кнопка Warlock ' + action + ' уходит с точным контекстом и только им', async () => {
  const f = relay(), msg = warlockMsg({ action, ...(action === 'archiveUnknown' ? { pendingId: 'local-unknown' } : {}), extra: 'drop', cmdOverride: 'kick' });
  f.answer({ id: 'uuid-1', ok: true, reason: '', private: 'drop' });
  const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: msg });
  assert.deepEqual(plain(r), { relayed: true, answer: { ok: true, reason: '' } });
  assert.deepEqual(f.forwarded, [[7, { cmd: 'warlockCommand', id: 'uuid-1', action, char: 'AuditHero', budgetEpoch: 123, spent: 0, ...(action === 'archiveUnknown' ? { pendingId: 'local-unknown' } : {}) }, { frameId: 0 }]]);
});
for (const cmd of ['lifestoneCommand', 'mammonBagAnalyze', 'enchantCommand', 'lockLost', 'ping', 'lifestoneTarget', 'install', undefined, 'toString', '__proto__'])
  test('команда вне белого списка не пересылается: ' + cmd, async () => {
    const f = relay(), r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd, action: 'scan' } });
    assert.equal(r.relayed, false); assert.equal(r.retry, false); assert.equal(f.forwarded.length, 0); assert.equal(f.tabsRead.length, 0);
  });
test('без message / message не объект / длинный char — отказ', async () => {
  for (const m of [{ cmd: 'dockGameCommand', char: 'AuditHero' }, { cmd: 'dockGameCommand', char: 'AuditHero', message: 'kick' }, { cmd: 'dockGameCommand', char: 'x'.repeat(65), message: { cmd: 'kick' } }, { cmd: 'dockGameCommand', char: 5, message: { cmd: 'kick' } }]) {
    const f = relay(), r = await f.run(m); assert.equal(r.relayed, false); assert.equal(f.forwarded.length, 0);
  }
});
const badSenders = { foreignExtension: f => f.sender.id = 'other@test', foreignHost: f => f.sender.url = 'moz-extension://other-host/popup.html?dock=1',
  wrongProtocol: f => f.sender.url = 'https://bot-host/popup.html?dock=1', gamePage: f => f.sender.url = 'https://l2wap.com/popup.html?dock=1',
  wrongPath: f => f.sender.url = 'moz-extension://bot-host/other.html?dock=1', plainPopup: f => f.sender.url = 'moz-extension://bot-host/popup.html',
  dockOff: f => f.sender.url = 'moz-extension://bot-host/popup.html?dock=0', topFrame: f => f.sender.frameId = 0, noFrame: f => delete f.sender.frameId,
  noTab: f => delete f.sender.tab, negativeTab: f => f.sender.tab.id = -1 };
for (const [name, change] of Object.entries(badSenders)) test('непроверенный отправитель ' + name + ' не доходит до вкладки', async () => {
  const f = relay(); change(f); const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } });
  assert.equal(r.relayed, false); assert.equal(f.forwarded.length, 0); assert.equal(f.tabsRead.length, 0);
});
for (const url of ['http://l2wap.com/map.html', 'https://l2wap.com.evil.test/map.html', 'moz-extension://bot-host/popup.html', 'about:blank'])
  test('родитель — не HTTPS-игра: ' + url, async () => {
    const f = relay(); f.tab.url = url; const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'slots' } });
    assert.equal(r.relayed, false); assert.equal(f.forwarded.length, 0);
  });
test('родитель загружается — без пересылки и без поиска другой вкладки, можно повторить', async () => {
  const f = relay(); f.tab.pendingUrl = 'https://l2wap.com/battle.html'; const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } });
  assert.equal(r.relayed, false); assert.equal(r.retry, true); assert.equal(f.forwarded.length, 0); assert.deepEqual(f.tabsRead, [7]);
});
test('герой меню не совпал с сохранённым — отказ до пересылки; пустой герой при новой установке допустим', async () => {
  const f = relay(); f.state.rt.char = 'OtherHero'; const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } });
  assert.equal(r.relayed, false); assert.equal(r.retry, false); assert.match(r.reason, /Персонаж изменился/); assert.equal(f.forwarded.length, 0);
  const g = relay(); delete g.state.rt.char; assert.equal((await g.run({ cmd: 'dockGameCommand', char: '', message: { cmd: 'kick' } })).relayed, true); assert.equal(g.forwarded.length, 1);
  const h = relay(); assert.equal((await h.run({ cmd: 'dockGameCommand', char: '', message: { cmd: 'slots' } })).relayed, false); assert.equal(h.forwarded.length, 0);
});
const badWarlock = { action: { action: 'buy' }, noId: { id: '' }, longId: { id: 'x'.repeat(81) }, otherChar: { char: 'OtherHero' }, emptyChar: { char: '' },
  epochString: { budgetEpoch: '123' }, epochNegative: { budgetEpoch: -1 }, epochNaN: { budgetEpoch: NaN }, spentString: { spent: '0' }, spentMissing: { spent: undefined },
  pendingNumber: { pendingId: 5 }, pendingEmpty: { pendingId: '' }, pendingLong: { pendingId: 'p'.repeat(81) } };
for (const [name, change] of Object.entries(badWarlock)) test('некорректная команда Warlock не пересылается: ' + name, async () => {
  const f = relay(), char = name === 'emptyChar' ? '' : 'AuditHero', r = await f.run({ cmd: 'dockGameCommand', char, message: warlockMsg(change) });
  assert.equal(r.relayed, false); assert.equal(f.forwarded.length, 0);
});
test('ответ kick — только поля подтверждения запуска', async () => {
  const f = relay(); f.answer({ ok: true, v: VERSION, running: true, owner: true, reason: '', lock: { epoch: 'secret' } });
  assert.deepEqual(plain(await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } })), { relayed: true, answer: { ok: true, v: VERSION, running: true, owner: true, reason: '' } });
  const g = relay(); g.answer({ ok: false, reason: 'kick_error: ' + 'x'.repeat(500) }); const r = await g.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } });
  assert.equal(r.answer.v, ''); assert.equal(r.answer.ok, false); assert.ok(r.answer.reason.length <= 220);
});
test('ответ «Предложить роли»: роли целиком (их пишет «Применить»), чужие ключи отброшены', async () => {
  const f = relay(), long = Array.from({ length: 80 }, (_, i) => 'Skill ' + i).join(', ');
  f.answer({ battle: true, roles: { nPower: long, nAttack: 'Атака', evil: 'x', constructor: 'y' }, buffsNote: 'баффы', why: ['a', 'b'], extra: 1 });
  const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'suggest' } });
  assert.deepEqual(plain(r.answer), { battle: true, roles: { nPower: long, nAttack: 'Атака' }, buffsNote: 'баффы', why: ['a', 'b'] });
});
test('ответ «Проверить панель» и «Снимок страницы» сохраняют то, что показывает меню', async () => {
  const f = relay(); f.answer({ battle: false, roles: ['✅ Атака: Атака'], panel: ['slot 1'] });
  assert.deepEqual(plain((await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'slots' } })).answer), { battle: false, roles: ['✅ Атака: Атака'], panel: ['slot 1'] });
  const g = relay(), html = '<body>' + 'x'.repeat(390000) + '</body>'; g.answer({ html, page: 'map' });
  assert.deepEqual(plain((await g.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'dom' } })).answer), { html, page: 'map' });
});
test('закрытый канал: один отказ, без повтора и без запасной вкладки', async () => {
  const f = relay(); f.fail(); const r = await f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } });
  assert.equal(r.relayed, false); assert.equal(r.retry, true); assert.equal(f.forwarded.length, 1); assert.equal(f.timers.size, 0);
});
for (const [cmd, ms, retry] of [['kick', 6000, true], ['slots', 8000, true], ['suggest', 15000, true], ['dom', 15000, true], ['warlockCommand', 20000, false]])
  test('зависшая вкладка: ' + cmd + ' ждёт ' + ms + ' мс и не повторяется', async () => {
    const f = relay(); f.hang(); const pending = f.run({ cmd: 'dockGameCommand', char: 'AuditHero', message: cmd === 'warlockCommand' ? warlockMsg() : { cmd } });
    for (let i = 0; i < 40 && !f.timers.size; i++) await Promise.resolve();
    assert.deepEqual(f.delays, [ms]); [...f.timers.values()][0](); const r = await pending;
    assert.equal(r.relayed, false); assert.equal(r.retry, retry); assert.equal(f.forwarded.length, 1); assert.equal(f.timers.size, 0);
    if (cmd === 'warlockCommand') assert.match(r.reason, /могла быть принята/);
  });

// ---------- меню: wakeGame без chrome.tabs ----------
function menu({ tabs = false, answers = [], on = true, char = 'AuditHero' } = {}) {
  const runtime = [], tabCalls = [], toasts = [], els = { wakeWarn: { hidden: true, textContent: '' } }, ls = new Map(), state = { on, rt: { char } };
  const box = { Promise, Date, Number, Object, Error, String, JSON, formChar: char, $: id => els[id], toast: t => toasts.push(t), localStorage: { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) },
    setTimeout: (fn, ms) => { if (ms <= 1000) queueMicrotask(fn); return 1; }, clearTimeout: () => {},
    chrome: { runtime: { getManifest: () => ({ version: VERSION }), sendMessage: async m => { runtime.push(plain(m)); const a = answers.length > 1 ? answers.shift() : answers[0]; return typeof a === 'function' ? a(m) : a; } },
      storage: { local: { get: async () => structuredClone(state) } } } };
  if (tabs) box.chrome.tabs = { query: async () => [{ id: 7, url: 'https://l2wap.com/map.html', status: 'complete' }], sendMessage: async (...a) => { tabCalls.push(plain(a)); return { ok: true, v: VERSION, running: true, owner: true }; },
    onUpdated: { addListener() {}, removeListener() {} }, get: async () => ({ id: 7, url: 'https://l2wap.com/map.html', status: 'complete' }), reload: async () => {} };
  vm.createContext(box); vm.runInContext(wakeSource + '\nasync function activeTab(){if(!chrome.tabs?.query)return null;return {id:7};}\nglobalThis.api={wakeGame,showWakeResult,gameSend};', box);
  return { box, state, runtime, tabCalls, toasts, els, ls, api: box.api };
}
const okKick = { relayed: true, answer: { ok: true, v: VERSION, running: true, owner: true, reason: '' } };
test('Старт во встроенном меню Firefox: kick через фон, подтверждение движка, без ложного «вкладка не отвечает»', async () => {
  const f = menu({ answers: [okKick] }); assert.equal(f.box.chrome.tabs, undefined);
  const r = await f.api.showWakeResult();
  assert.equal(r.ok, true); assert.deepEqual(f.runtime, [{ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'kick' } }]);
  assert.equal(f.els.wakeWarn.hidden, true); assert.equal(f.ls.has('l2bot-wakeWarn'), false); assert.deepEqual(f.toasts, ['▶ Движок запущен и управляет вкладкой']);
  assert.ok(!f.toasts.some(t => /не отвечает/.test(t)));
});
test('вкладка ещё не ответила (повторимо) — повтор kick, затем подтверждение', async () => {
  const f = menu({ answers: [{ relayed: false, retry: true, reason: 'Вкладка игры не ответила — обновите страницу' }, okKick] });
  const r = await f.api.wakeGame(); assert.equal(r.ok, true); assert.equal(f.runtime.length, 2);
});
test('отказ фона (герой сменился) — без повторов, причина видна игроку', async () => {
  const f = menu({ answers: [{ relayed: false, retry: false, reason: 'Персонаж изменился — обновите меню' }] });
  const r = await f.api.showWakeResult(); assert.equal(r.ok, false); assert.equal(f.runtime.length, 1);
  assert.match(f.els.wakeWarn.textContent, /игра не подтвердила запуск: Персонаж изменился/); assert.equal(f.els.wakeWarn.hidden, false);
});
test('ответ движка разбирается как в Chrome: вкладка без управления', async () => {
  const f = menu({ answers: [{ relayed: true, answer: { ok: false, v: VERSION, running: true, owner: false, reason: 'another_tab_or_lock_unavailable' } }] });
  const r = await f.api.wakeGame(); assert.equal(r.ok, false); assert.match(r.reason, /закройте другие вкладки/); assert.equal(f.runtime.length, 1);
});
test('старая версия content — до 4 попыток и понятная причина, без перезагрузки вкладки', async () => {
  const f = menu({ answers: [{ relayed: true, answer: { ok: true, v: '20.41', running: true, owner: true } }] });
  const r = await f.api.wakeGame(); assert.equal(r.ok, false); assert.match(r.reason, /старой версией/); assert.equal(f.runtime.length, 4);
});
test('бот выключен до kick — запуск отменён, команда не отправлена', async () => {
  const f = menu({ on: false, answers: [okKick] }); const r = await f.api.wakeGame(); assert.equal(r.ok, false); assert.match(r.reason, /отменён/); assert.equal(f.runtime.length, 0);
});
test('нет ответа фона вовсе — ошибка, а не бесконечное ожидание', async () => {
  const f = menu({ answers: [undefined] }); const r = await f.api.wakeGame(); assert.equal(r.ok, false); assert.ok(r.reason.length > 5);
});
test('Chrome/отдельное меню с chrome.tabs — прежний путь kick через tabs, фон не участвует', async () => {
  const f = menu({ tabs: true, answers: [okKick] }); const r = await f.api.wakeGame();
  assert.equal(r.ok, true); assert.deepEqual(f.tabCalls, [[7, { cmd: 'kick' }]]); assert.equal(f.runtime.length, 0);
});

// ---------- меню: кнопки Warlock ----------
function warlock({ tabs = false, on = false, answer = { relayed: true, answer: { ok: true, reason: '' } }, tabAnswer = { ok: true } } = {}) {
  const runtime = [], tabCalls = [], state = { on, rt: { char: 'AuditHero' }, lock: { tab: 99, t: Date.now() } };
  const box = { Promise, Date, Number, Object, Error, crypto: { randomUUID: () => 'uuid-1' }, setTimeout: () => 1, clearTimeout: () => {},
    chrome: { runtime: { sendMessage: async m => { runtime.push(plain(m)); return answer; } }, storage: { local: { get: async () => structuredClone(state) } } } };
  if (tabs) box.chrome.tabs = { query: async () => [], sendMessage: async (...a) => { tabCalls.push(plain(a)); return tabAnswer; } };
  vm.createContext(box);
  vm.runInContext(slice(popup, 'const gameTabsApi', 'const WAKE_HINTS') + '\nasync function activeTab(){if(!chrome.tabs?.query)return null;return {id:7};}\n' + warlockSource + '\nglobalThis.run=warlockMenuCommand;', box);
  return { runtime, tabCalls, run: (a, c) => box.run(a, c) };
}
for (const action of ['preview', 'resetBudget', 'archiveUnknown']) test('Warlock «' + action + '» без chrome.tabs — через фон, команда и контекст целиком', async () => {
  const f = warlock(), context = { char: 'AuditHero', budgetEpoch: 123, spent: 10000000, ...(action === 'archiveUnknown' ? { pendingId: 'local-unknown' } : {}) };
  await f.run(action, context);
  assert.deepEqual(f.runtime, [{ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'warlockCommand', id: 'uuid-1', action, ...context } }]); assert.equal(f.tabCalls.length, 0);
});
test('Warlock: отказ фона и отказ движка видны в панели', async () => {
  await assert.rejects(warlock({ answer: { relayed: false, reason: 'Персонаж изменился — обновите меню' } }).run('preview', { char: 'AuditHero', budgetEpoch: 0, spent: 0 }), /Персонаж изменился/);
  await assert.rejects(warlock({ answer: { relayed: true, answer: { ok: false, reason: 'Управление у другой вкладки' } } }).run('resetBudget', { char: 'AuditHero', budgetEpoch: 0, spent: 0 }), /Управление у другой вкладки/);
});
test('Warlock с chrome.tabs — как раньше: вкладка-хозяин замка при ON, активная при OFF', async () => {
  const onF = warlock({ tabs: true, on: true }); await onF.run('preview', { char: 'AuditHero', budgetEpoch: 0, spent: 0 });
  assert.deepEqual(onF.tabCalls, [[99, { cmd: 'warlockCommand', id: 'uuid-1', action: 'preview', char: 'AuditHero', budgetEpoch: 0, spent: 0 }]]); assert.equal(onF.runtime.length, 0);
  const offF = warlock({ tabs: true }); await offF.run('preview', { char: 'AuditHero', budgetEpoch: 0, spent: 0 }); assert.equal(offF.tabCalls[0][0], 7);
});

// ---------- меню: «Проверить панель», «Предложить роли», «Снимок страницы» ----------
function panel({ tabs = false, answer } = {}) {
  const runtime = [], tabCalls = [], toasts = [], downloads = [], els = {}; const el = id => els[id] || (els[id] = { id, style: {}, textContent: '', hidden: true });
  const box = { Promise, Object, Error, String, formChar: 'AuditHero', save: async () => {}, stamp: () => 'T', download: (...a) => downloads.push(a), toast: t => toasts.push(t), $: el,
    chrome: { runtime: { sendMessage: async m => { runtime.push(plain(m)); return typeof answer === 'function' ? answer(m) : answer; } }, storage: { local: { get: async () => ({ cfg: { nAttack: 'Атака' } }) } } } };
  if (tabs) box.chrome.tabs = { query: async () => [], sendMessage: async (...a) => { tabCalls.push(plain(a)); return typeof answer === 'function' ? answer({ message: a[1] })?.answer : answer?.answer; } };
  vm.createContext(box);
  vm.runInContext(slice(popup, 'const gameTabsApi', 'const WAKE_HINTS') + '\nasync function activeTab(){if(!chrome.tabs?.query)return null;return {id:7};}\n' + panelSource + domSource, box);
  return { runtime, tabCalls, toasts, downloads, els, click: id => el(id).onclick() };
}
const panelAnswer = m => ({ relayed: true, answer: m.message.cmd === 'slots' ? { battle: true, roles: ['✅ Атака: Атака'], panel: ['Атака #1'] }
  : m.message.cmd === 'suggest' ? { battle: true, roles: { nAttack: 'Атака' }, buffsNote: 'баффы — все найденные', why: ['Атака: удар'] } : { html: '<body>snap</body>', page: 'map' } });
test('«Проверить панель» без chrome.tabs — ответ игры через фон', async () => {
  const f = panel({ answer: panelAnswer }); await f.click('check');
  assert.deepEqual(f.runtime, [{ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'slots' } }]);
  assert.equal(f.els.slots.textContent, '✅ Атака: Атака\n— панель —\nАтака #1'); assert.doesNotMatch(f.els.slots.textContent, /Откройте вкладку/);
});
test('«Предложить роли» без chrome.tabs — предложение и кнопка «Применить»', async () => {
  const f = panel({ answer: panelAnswer }); await f.click('suggest');
  assert.deepEqual(f.runtime, [{ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'suggest' } }]);
  assert.match(f.els.slots.textContent, /^🤖 Предложение/); assert.equal(f.els.applyRow.hidden, false);
});
test('«Снимок страницы» без chrome.tabs — файл с HTML вкладки игры', async () => {
  const f = panel({ answer: panelAnswer }); await f.click('recDom');
  assert.deepEqual(f.runtime, [{ cmd: 'dockGameCommand', char: 'AuditHero', message: { cmd: 'dom' } }]);
  assert.deepEqual(f.downloads, [['l2wap-map-T.html', '<body>snap</body>', 'text/html']]); assert.deepEqual(f.toasts, []);
});
test('отказ фона показывается своей причиной, а не «Откройте вкладку l2wap.com»', async () => {
  const deny = { relayed: false, reason: 'Вкладка игры закрыта или загружается — повторите после загрузки', retry: true };
  for (const id of ['check', 'suggest']) { const f = panel({ answer: deny }); await f.click(id); assert.equal(f.els.slots.textContent, '⚠ ' + deny.reason); }
  const f = panel({ answer: deny }); await f.click('recDom'); assert.deepEqual(f.toasts, ['⚠ ' + deny.reason]); assert.equal(f.downloads.length, 0);
});
test('с chrome.tabs — прежние тексты и вкладка игры', async () => {
  const f = panel({ tabs: true, answer: panelAnswer }); await f.click('check'); assert.deepEqual(f.tabCalls, [[7, { cmd: 'slots' }]]); assert.equal(f.runtime.length, 0);
  const g = panel({ tabs: true, answer: () => ({ answer: undefined }) }); await g.click('check'); assert.equal(g.els.slots.textContent, '⚠ Откройте вкладку l2wap.com (страницу боя)');
  await g.click('recDom'); assert.deepEqual(g.toasts, ['⚠ Откройте вкладку l2wap.com']);
});

// ---------- согласованность ----------
test('белый список фона ⊂ команды content; в меню нет прямых chrome.tabs у этих кнопок', () => {
  const cmds = [...relaySource.matchAll(/(\w+): \d+/g)].map(x => x[1]); assert.deepEqual(cmds.slice(0, 5), ['kick', 'warlockCommand', 'slots', 'suggest', 'dom']);
  const listener = content.slice(content.lastIndexOf('chrome.runtime.onMessage.addListener'));
  for (const c of cmds.slice(0, 5)) assert.match(listener, new RegExp(`m\\.cmd === '${c}'`));
  for (const src of [panelSource, domSource, warlockSource]) assert.doesNotMatch(src, /chrome\.tabs\.(?:sendMessage|query)\(/);
  assert.match(slice(popup, 'async function wakeGame()', 'let tabs = [];'), /if \(!chrome\.tabs\?\.sendMessage\) return wakeDockGame/);
});
test('firefox-smoke проверяет встроенное меню без chrome.tabs', () => {
  assert.match(smoke, /#l2bot-dock iframe/); assert.match(smoke, /dockGameCommand/); assert.match(smoke, /typeof chrome\.tabs/);
});
