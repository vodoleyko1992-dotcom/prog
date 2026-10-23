'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
test('поле прежнего героя в фокусе не записывается в новый профиль', async () => {
  const state = { rt: { char: 'Spoiler' }, cfg: { shopReserve: 10000000 }, on: false }, field = { id: 'shopReserve', tagName: 'INPUT', value: '500000' };
  const storage = { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(state[k])])), set: async patch => Object.assign(state, structuredClone(patch)) };
  const b = { URL, Date, console, MAX_PATCH_KEYS: 400, NUM: ['shopReserve'], TXT: [], BOOL: [], DEF: { shopReserve: 200000 }, formChar: 'Warlock', settingsSerial: 0, document: { activeElement: field },
    $: () => field, paintActionDelay() {}, fillWeapons() { throw Error('поле в фокусе не обновлять'); }, chrome: { storage: { local: storage }, runtime: { getURL: p => 'chrome-extension://fixture/' + p } }, serializeLock: f => f() };
  vm.createContext(b);
  vm.runInContext(bg.slice(bg.indexOf('async function menuPatch('), bg.indexOf('async function switchCharacter(')), b);
  const realMenu = b.menuPatch; b.menuPatch = async (rtPatch, extra) => { const r = await realMenu({ rtPatch, ...extra }, { url: 'chrome-extension://fixture/popup.html' }); if (!r.ok) throw Error(r.reason); };
  vm.runInContext(popup.slice(popup.indexOf('const isLiveKey'), popup.indexOf('  recN = reccount;')) + '\n}', b);   // 20.13 (шаг 7): load() читает живой статус live@Ник
  vm.runInContext(popup.slice(popup.indexOf('async function save(e)'), popup.indexOf('// ---------- вкладки ----------')), b);
  await b.load(); assert.equal(field.value, '500000');
  await assert.rejects(() => b.save({ target: field }), /Персонаж изменился/);
  assert.equal(state.cfg.shopReserve, 10000000);
});
test('пустой профиль до загрузки HUD принимает настройку только пока герой ещё пуст', async () => {
  const state = { rt: { char: '' }, cfg: { fishMode: false } }, b = { URL, Date, console, MAX_PATCH_KEYS: 400,
    chrome: { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(state[k])])), set: async patch => Object.assign(state, structuredClone(patch)) } }, runtime: { getURL: p => 'chrome-extension://fixture/' + p } }, serializeLock: f => f() };
  vm.createContext(b); vm.runInContext(bg.slice(bg.indexOf('async function menuPatch('), bg.indexOf('async function switchCharacter(')), b);
  const sender = { url: 'chrome-extension://fixture/popup.html' }, request = { rtPatch: {}, cfgPatch: { fishMode: true }, expectedChar: '' };
  assert.equal((await b.menuPatch(request, sender)).ok, true); assert.equal(state.cfg.fishMode, true);
  state.rt.char = 'AuditHero'; assert.equal((await b.menuPatch(request, sender)).ok, false);
});
