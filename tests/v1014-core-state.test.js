'use strict';
// 14.10: реальные ветки диспетчера, popup и сетевой памяти; без аккаунта и игровых действий.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const core = read('content.js'), popup = read('popup.js');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
function modeBox() {
  const rt = { dailyFish: { prev: { auto: true } }, dailyRb: { prev: { fish: true } }, dailyDone: { fish: 7 } }, cfg = { fishMode: true };
  const box = { rt, cfg, Date, MODE_NAME: {}, toast() {}, save: async () => {}, chrome: { storage: { local: { get: async () => ({ rt, cfg }) } } },
    menuPatch: async (p, o = {}) => { Object.assign(rt, p); Object.assign(cfg, o.cfgPatch || {}); },
    activateMode: async (p, c) => { Object.assign(rt, p); Object.assign(cfg, c); } };
  vm.runInNewContext(slice(popup, 'const MODES_OFF =', '// 10.0: повторное нажатие'), box); return box;
}
for (const mode of ['tasks', 'farm', 'auto', 'rb', 'epic', 'fish', 'cat']) test('ручной режим ' + mode + ' отменяет старые daily detours, сохраняя прогресс', async () => {
  const b = modeBox(); await b.setMode(mode); assert.equal(b.rt.dailyFish, null); assert.equal(b.rt.dailyRb, null); assert.equal(b.rt.dailyDone.fish, 7);
});
test('рейд: pending inventory выполняется перед следующим шагом тура', async () => {
  const calls = [], rt = { invScan: { step: 'prof', t: Date.now() }, invTourT: Date.now(), rbHunt: { step: 'pick' } };
  const box = { rt, Date, cfg: { weaponScanAuto: true }, autonomyMode: () => 'raid', isBattle: () => false, fishNow: () => false,
    invScanStart: async () => calls.push('start'), invScanStep: async () => calls.push('scan'), rbHuntStep: async () => calls.push('raid'), sleep: async () => {}, setRt: async p => Object.assign(rt, p) };
  const code = slice(core, '      // 8.0.3 (разбор логов 11.10): в туре оружие', '      if (cfg.weaponScanAuto !== false && !rt.weaponsT');
  await vm.runInNewContext('(async()=>{for(let once=0;once<1;once++){' + code + '}})()', box); assert.deepEqual(calls, ['scan']);
});
test('TvT: изменение alive сохраняется в том же событии и переживает reload', () => {
  const box = { path: '/game/tvt', d: { res: { eventId: 'event1', phase: 'ACTIVE', isRegistered: true, selfCombat: { alive: true } } }, TVT: null, rt: {}, Date, tvtMs: () => 0, setRt: p => Object.assign(box.rt, p) };
  const code = slice(core, "  if (path === '/game/tvt' &&", "  if (/\\/game\\/tvt\\/");
  vm.runInNewContext(code, box); const k = box.rt.tvt.k;
  box.d.res.selfCombat.alive = false; vm.runInNewContext(code, box);
  assert.notEqual(box.rt.tvt.k, k); assert.equal(JSON.parse(JSON.stringify(box.rt.tvt)).selfCombat.alive, false);
  box.d.res = { eventId: 'event2', phase: 'REGISTRATION', isRegistered: false }; vm.runInNewContext(code, box);
  assert.notEqual(box.rt.tvt.selfCombat?.alive, false, 'смерть старого события не переносится в новое');
});
function level(rt) {
  const b = { rt, id: 7 }; vm.runInNewContext(slice(popup, '  const eq = Object.entries(rt.mmEq || {})', '  const nm = id =>') + '\nthis.actual = lvlOf(id);', b); return b.actual;
}
test('Маммон: popup показывает надетый экземпляр, а не первый дубликат', () => {
  assert.equal(level({ mmGear: [{ id: 7, lvl: 5 }, { id: 7, lvl: 0, eq: true }] }), 0);
});
test('Маммон: свежая экипировка побеждает старый снимок кузнеца', () => {
  assert.equal(level({ mmGear: [{ id: 7, lvl: 5, eq: true }], mmGearT: 100, mmEq: { belt: [7, 0] }, mmEqT: 101 }), 0);
});
test('Маммон: свежий кузнец и legacy без timestamp сохраняют приоритет', () => {
  for (const mmEqT of [0, 99]) assert.equal(level({ mmGear: [{ id: 7, lvl: 5, eq: true }], mmGearT: 100, mmEq: { belt: [7, 0] }, mmEqT }), 5);
});
test('DOM журнал: внешний префикс Спойл сохраняется при разнесённых частях тела', () => {
  const body = { children: [{ textContent: 'Coal' }, { textContent: '×5' }] }, line = { textContent: 'Спойл: Coal×5', querySelector: s => s.endsWith('__body') ? body : s.endsWith('__spoil-prefix') ? { textContent: 'Спойл: ' } : null };
  const box = { $q: () => ({ querySelectorAll: () => [line] }), heavyPage: () => false };
  vm.runInNewContext(slice(core, 'function logLines()', 'function newLines('), box); assert.equal(box.logLines()[0], 'Спойл: Coal ×5');
});
test('HUD placeholder не переключает профиль персонажа; настоящее имя принимается после загрузки', async () => {
  let nick = '—'; const switches = [];
  const b = { $q: s => s === '#l2-hud-legacy-name' ? { textContent: nick } : null, rt: { char: 'AuditHero' }, cfg: {}, on: false,
    document: { documentElement: { className: '' }, visibilityState: 'visible' }, rtWriter: { recover: async () => ({ ok: true }), clear() {} },
    ipc: async m => { switches.push(m.nick); return { ok: true, rt: { char: m.nick }, cfg: {} }; }, leaseEpoch: null, TAB_ID: 'tab1', DEF_RT: {}, mergeCfg: x => x, rec() {} };
  vm.runInNewContext(slice(core, 'const heroNick =', '// ---------- главный цикл ----------'), b);
  for (const value of ['—', '-', '…', '...', '  —  ']) { nick = value; await b.switchChar(); }
  assert.deepEqual(switches, [], 'common.js рисует — до загрузки героя: нельзя сохранять cfg в профиль заглушки');
  nick = 'AuditHero'; await b.switchChar(); assert.deepEqual(switches, []);
  nick = 'OtherHero'; await b.switchChar(); assert.deepEqual(switches, ['OtherHero']);
});
test('Stop + reload: автоматический invScan не становится ручным заданием', async () => {
  let calls = 0; const b = { on: false, rt: { invScan: { step: 'prof' } }, L2V7Modules: { equipment: { invScanDrive: async () => calls++ } } };
  const code = core.match(/async function invScanDrive\([^\n]+/)[0]; vm.runInNewContext(code, b);
  await b.invScanDrive(); assert.equal(calls, 0);
  b.rt.invScan.manual = true; await b.invScanDrive(); assert.equal(calls, 1, 'явная команда меню работает при off');
});
test('фон отклоняет прямой charSwitch с placeholder, не читая и не меняя профиль', async () => {
  const src = read('background.js'), code = slice(src, 'async function switchCharacter(', '// 8.0.6 (Firefox');
  let calls = 0; const b = { serializeLock: async () => calls++ }; vm.runInNewContext(code, b);
  const result = await b.switchCharacter({ nick: '—' }, { tab: { id: 1 } }); assert.equal(result.reason, 'invalid_character'); assert.equal(calls, 0);
});
test('кнопка заточки +10 отменяет прежний daily detour и остаётся на рыбалке после его старого результата', async () => {
  const b = modeBox(), elements = {}, env = { on: true, tabOwner: true, cfg: b.cfg, rt: b.rt, setRt: b.menuPatch,
    setCfg: async p => Object.assign(b.cfg, p), rec() {}, setStatus() {}, sleep: async () => {} };
  b.rt.dailyFish = { t: Date.now(), need: 1, got: 1, prev: { zoneAuto: true, fishMode: false } }; b.rt.dailyRb = null;
  b.location = { pathname: '/map.html' }; b.$ = id => elements[id] || (elements[id] = {});
  vm.runInNewContext(read('modules/dailies.js'), b);
  vm.runInNewContext(slice(popup, "$('fishRodGoal10').onclick =", "$('fishQuickCut').onclick ="), b);
  await elements.fishRodGoal10.onclick(); await b.L2V7Factories.dailies(env).dailyStep();
  assert.equal(b.cfg.fishMode, true); assert.equal(b.rt.dailyFish, null); assert.equal(b.rt.rodGoalActive, true);
});
function directModeBox() {
  const b = modeBox(), elements = {};
  Object.assign(b.cfg, { fishMode: true, zoneAuto: false, rbHuntMode: false, epicMode: false, catMode: false, campaign: false });
  b.rt.dailyFish = { t: Date.now(), day: 'today', need: 1, got: 1, prev: { zoneAuto: true, fishMode: false, rbHuntMode: false, epicMode: false, catMode: false } };
  b.rt.dailyRb = null; b.showWakeResult = async () => {}; b.location = { pathname: '/map.html' };
  b.chrome.storage.local.set = async () => {}; b.$ = id => elements[id] || (elements[id] = {});
  vm.runInNewContext(slice(popup, 'async function activateMode(', 'const NUM '), b);
  vm.runInNewContext(read('modules/dailies.js'), b);
  const daily = b.L2V7Factories.dailies({ on: true, tabOwner: true, cfg: b.cfg, rt: b.rt, setRt: b.menuPatch,
    setCfg: async p => Object.assign(b.cfg, p), rec() {}, setStatus() {}, sleep: async () => {} });
  return { b, elements, daily };
}
for (const [name, start, end, invoke] of [
  ['кампания', "$('campToggle').onclick =", '// «🛒 Закупить сейчас»', e => e.campToggle.onclick()],
  ['тур РБ', 'async function huntToggle()', 'async function epicToggle()', (_e, b) => b.huntToggle()],
  ['эпики', 'async function epicToggle()', "$('epicToggle2').onclick", (_e, b) => b.epicToggle()],
  ['один РБ', "$('rbOneBtn').onclick =", 'function paintRbOne(', e => e.rbOneBtn.onclick()],
]) test('отдельная кнопка «' + name + '» не даёт старому daily завершению заменить ручной режим', async () => {
  const { b, elements, daily } = directModeBox(); vm.runInNewContext(slice(popup, start, end), b);
  await invoke(elements, b); const selected = JSON.stringify(b.cfg);
  await daily.dailyStep(); assert.equal(JSON.stringify(b.cfg), selected); assert.equal(b.rt.dailyFish, null); assert.equal(b.rt.dailyDone.fish, 7);
});
for (const [name, start, end] of [
  ['разделка', "$('fishQuickCut').onclick =", "$('rbOrderUp').onclick"],
  ['обмен камней', "$('sealNow').onclick =", 'function renderCat('],
]) test('разовая услуга «' + name + '» сохраняет возврат из daily после завершения', async () => {
  const { b, elements, daily } = directModeBox(); vm.runInNewContext(slice(popup, start, end), b);
  const oldJob = b.rt.dailyFish; await elements[name === 'разделка' ? 'fishQuickCut' : 'sealNow'].onclick();
  assert.equal(b.rt.dailyFish, oldJob); await daily.dailyStep(); assert.equal(b.cfg.zoneAuto, true); assert.equal(b.rt.dailyFish, null);
});
