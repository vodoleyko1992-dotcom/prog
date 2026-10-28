'use strict';
// 20.76+ (ревизия 28.10, группа ui-bg):
// 1) горячая клавиша Alt+Shift+B (toggle-bot) не снимала paused — после «пауза → старт клавишей → стоп клавишей» меню/индикатор
//    показывали «⏸ Пауза»/«▶ Продолжить» вместо «○ Остановлен»; фон грузится целиком в vm (как tests/v2043-notify-stop.test.js);
// 2) activateMode меню не снимал выбранный Rebirth: «🎯 Убить один РБ» и «Цель: заточить удочку до +10» молча оставляли Rebirth
//    (ядро выбирает его первым), а 'raid'/'fish' копились в autoTasks и запускались после снятия Rebirth. Вырезка popup.js в vm,
//    итог проверяется настоящим L2EngineCore.selectedTask/rebirthSelected.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bgSrc = read('background.js'), popup = read('popup.js'), EC = require('../engine-core.js'), D = require('../defaults.js');
const clone = x => x === undefined ? undefined : structuredClone(x), arr = x => JSON.parse(JSON.stringify(x));
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, hasListener: () => false, l }; };
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'нет фрагмента ' + a); return src.slice(i, j); };

// ===== 1. фон: toggle-bot =====
function loadBg(initial) {
  const state = clone(initial), session = {};
  const local = {
    get: async keys => { const ks = keys == null ? Object.keys(state) : Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async patch => { Object.assign(state, clone(patch)); },
    remove: async keys => { for (const k of [].concat(keys)) delete state[k]; },
  };
  const chrome = {
    runtime: { id: 'test', onMessage: ev(), onInstalled: ev(), onStartup: ev(), getManifest: () => ({ version: 'x' }), getURL: p => 'chrome-extension://test/' + p, lastError: null },
    storage: { local, onChanged: ev(), session: { get: async k => (Object.hasOwn(session, k) ? { [k]: clone(session[k]) } : {}), set: async p => { Object.assign(session, clone(p)); } } },
    tabs: { query: async () => [], get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async () => {}, update: async () => {}, sendMessage: async () => {}, onRemoved: ev() },
    alarms: { get: async () => ({ name: 'l2watch' }), create: async () => {}, onAlarm: ev() }, permissions: { contains: async () => false },
    commands: { onCommand: ev() },
    notifications: { create: (id) => Promise.resolve(id), clear: () => Promise.resolve(true) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const unref = t => (t?.unref?.(), t);
  const sb = { chrome, console: { log() {}, warn() {}, error() {} }, setTimeout: (...a) => unref(setTimeout(...a)), clearTimeout, setInterval: (...a) => unref(setInterval(...a)), clearInterval, setImmediate, Date, Math, JSON, Promise, URL,
    structuredClone, fetch: async () => ({ status: 200, headers: { get: () => 'application/json' } }), indexedDB: undefined, self: {}, AbortController, crypto: { randomUUID: () => 'uuid' }, L2EngineCore: EC };
  sb.globalThis = sb;
  vm.createContext(sb); vm.runInContext(bgSrc, sb);
  const [onMessage] = chrome.runtime.onMessage.l;
  const send = (m, sender) => new Promise(res => { if (onMessage(m, sender, res) !== true) tick().then(() => res(undefined)); });
  return { state, send, game: { id: 'test', frameId: 0, url: 'https://l2wap.com/map.html', tab: { id: 1 } }, hotkey: () => chrome.commands.onCommand.l[0]('toggle-bot') };
}
const running = () => { const now = Date.now(); return { on: true, lock: { k: 'tab1', tab: 1, epoch: 'one', t: now }, hbBg: { tab: 1, t: now, page: '/map.html' }, wdog: [], wdDown: null, rt: { char: 'Hero', manualKickAt: 1 }, cfg: {} }; };
// метка меню (popup.js: «⏸ Пауза» при !on && paused, иначе «○ Остановлен»)
const label = st => st.on ? 'работает' : st.paused ? '⏸ Пауза' : '○ Остановлен';

test('ui-bg/1: пауза → старт клавишей → стоп клавишей: paused снят, меню показывает «Остановлен», а не «Продолжить»', async () => {
  const f = loadBg(running()); await tick();
  await f.send({ cmd: 'botControl', action: 'pause', source: 'content-pause', reason: 'Пауза', char: 'Hero', epoch: 'one', kick: 1 }, f.game);
  assert.equal(f.state.on, false); assert.ok(f.state.paused, 'бот встал на паузу'); assert.equal(label(f.state), '⏸ Пауза');
  await f.hotkey(); await tick();
  assert.equal(f.state.on, true); assert.equal(f.state.paused, null, 'запуск клавишей снимает паузу, как «Старт»/«▶ Продолжить» меню');
  assert.ok(f.state.stopMeta.resumed >= f.state.stopMeta.t, 'запуск отмечен в stopMeta, как прежде');
  await f.hotkey(); await tick();
  assert.equal(f.state.on, false); assert.equal(f.state.paused, null); assert.equal(f.state.stopMeta.source, 'hotkey');
  assert.equal(label(f.state), '○ Остановлен');
});

test('ui-bg/1: стоп клавишей во время работы с устаревшим paused тоже его снимает', async () => {
  const f = loadBg({ ...running(), paused: { t: 1, why: 'старая пауза' } }); await tick();
  await f.hotkey(); await tick();
  assert.equal(f.state.on, false); assert.equal(f.state.paused, null); assert.equal(label(f.state), '○ Остановлен');
});

test('ui-bg/1: исходник — toggle-bot пишет paused:null при старте и стопе', () => {
  const h = slice(bgSrc, "if (c !== 'toggle-bot') return;", 'await ST.set(change);');
  assert.match(h, /const change = \{ on: !on, paused: null \};/);
});

// ===== 2. меню: activateMode и кнопки «Один РБ»/«Цель +10» =====
function loadPopup(cfg0, rt0 = {}) {
  const state = { cfg: clone(cfg0), rt: clone(rt0), on: false, paused: { t: 1, why: 'x' }, patches: [] }, els = {};
  const local = {
    get: async keys => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (Object.hasOwn(state, k)) o[k] = clone(state[k]); return o; },
    set: async p => { Object.assign(state, clone(p)); },
  };
  const box = { console, Date, Object, Set, Promise, Number, Array, String, Math, JSON, structuredClone, DEF: D.CFG,
    chrome: { storage: { local } }, L2EngineCore: { hotStore: () => local },
    menuPatch: async (p, o = {}) => { state.patches.push({ rt: clone(p), cfg: clone(o.cfgPatch) }); Object.assign(state.rt, clone(p)); if (o.cfgPatch) Object.assign(state.cfg, clone(o.cfgPatch)); if (o.on != null) state.on = o.on; },
    showWakeResult: async () => ({ ok: true }), save: async () => true, toast: () => {}, load: async () => {}, showTab: () => {},
    $: id => els[id] ||= { id, textContent: '', value: '', checked: false, onclick: null } };
  vm.createContext(box);
  vm.runInContext(slice(popup, 'async function activateMode(', '\nconst NUM  =') + '\n' +
    slice(popup, 'const MODES_OFF =', 'async function setMode(') + '\n' +
    slice(popup, "$('fishRodGoal10').onclick", "$('fishQuickCut').onclick") + '\n' +
    slice(popup, "$('rbOneBtn').onclick", "$('rbOneOff').onclick") + '\n' +
    slice(popup, 'async function huntToggle(', 'async function epicToggle(') + '\n' +
    slice(popup, 'async function epicToggle(', "$('epicToggle2').onclick") +
    '\nthis.activateMode=activateMode;this.huntToggle=huntToggle;this.epicToggle=epicToggle;', box);
  return { box, state, click: id => els[id].onclick() };
}
const REBIRTH = { ...D.CFG, autoTasks: ['tvt', 'rebirth'], rebirthMode: true, rbHuntMode: false, fishMode: false, epicMode: false, catMode: false, zoneAuto: false, campaign: false };

test('ui-bg/2: «🎯 Убить один РБ» при выбранном Rebirth: Rebirth снят, ядро выбирает тур, rbOne включён', async () => {
  const f = loadPopup(REBIRTH, { rbKills: 3 });
  await f.click('rbOneBtn');
  assert.deepEqual(arr(f.state.cfg.autoTasks), ['tvt', 'raid']);
  assert.equal(f.state.cfg.rebirthMode, false); assert.equal(f.state.cfg.rbHuntMode, true);
  assert.equal(EC.rebirthSelected(f.state.cfg), false); assert.equal(EC.selectedTask(f.state.cfg, f.state.rt), 'raid');
  assert.equal(EC.taskAllowed(f.state.cfg, 'raid'), true);
  assert.equal(f.state.rt.rbOne.on, true); assert.equal(f.state.on, true); assert.equal(f.state.paused, null);
});

test('ui-bg/2: «Цель: заточить удочку до +10» при выбранном Rebirth (autoTasks): Rebirth снят, ядро выбирает рыбалку', async () => {
  const f = loadPopup(REBIRTH);
  await f.click('fishRodGoal10');
  assert.deepEqual(arr(f.state.cfg.autoTasks), ['tvt', 'fish']);
  assert.equal(f.state.cfg.rebirthMode, false); assert.equal(f.state.cfg.fishMode, true); assert.equal(f.state.cfg.rodEnchantTo, 10);
  assert.equal(EC.rebirthSelected(f.state.cfg), false); assert.equal(EC.selectedTask(f.state.cfg, f.state.rt), 'fish');
  assert.equal(f.state.rt.rodGoalActive, true);
});

test('ui-bg/2: плоский режим (старый профиль без autoTasks, rebirthMode:true): «Цель +10» и тумблеры тура/эпиков снимают rebirthMode', async () => {
  const flat = { ...REBIRTH }; delete flat.autoTasks;
  let f = loadPopup(flat); await f.click('fishRodGoal10');
  assert.equal(f.state.cfg.autoTasks, undefined, 'плоский профиль не превращается в список');
  assert.equal(f.state.cfg.rebirthMode, false); assert.equal(EC.rebirthSelected(f.state.cfg), false);
  f = loadPopup(flat); await f.box.huntToggle();
  assert.equal(f.state.cfg.rbHuntMode, true); assert.equal(f.state.cfg.rebirthMode, false); assert.equal(EC.rebirthSelected(f.state.cfg), false);
  f = loadPopup(flat); await f.box.epicToggle();
  assert.equal(f.state.cfg.epicMode, true); assert.equal(f.state.cfg.rebirthMode, false); assert.equal(EC.rebirthSelected(f.state.cfg), false);
});

test('ui-bg/2: регрессия — выбор самого Rebirth (patch со своим autoTasks) и разовые службы без смены режима Rebirth не снимают', async () => {
  let f = loadPopup({ ...D.CFG, autoTasks: ['tvt', 'raid'], rbHuntMode: true, rebirthMode: false });
  await f.box.activateMode({}, { craftMode: false, enchantMode: false, epicMode: false, rbHuntMode: false, fishMode: false, catMode: false, taskOnly: false, zoneAuto: false, rbMode: false, campaign: false, storyTurnIn: false, rebirthMode: true, chain: true, autoTasks: ['tvt', 'rebirth'] });
  assert.deepEqual(arr(f.state.cfg.autoTasks), ['tvt', 'rebirth']); assert.equal(f.state.cfg.rebirthMode, true);
  assert.equal(EC.selectedTask(f.state.cfg, f.state.rt), 'rebirth');
  f = loadPopup(REBIRTH);
  await f.box.activateMode({ fishSvc: { t: 1 }, fishService: 'cut' }, {});
  assert.deepEqual(arr(f.state.cfg.autoTasks), ['tvt', 'rebirth']); assert.equal(f.state.cfg.rebirthMode, true);
  // выключение задачи (флаг false) тоже не трогает Rebirth
  f = loadPopup(REBIRTH);
  await f.box.activateMode({}, { epicMode: false });
  assert.deepEqual(arr(f.state.cfg.autoTasks), ['tvt', 'rebirth']); assert.equal(f.state.cfg.rebirthMode, true);
});
