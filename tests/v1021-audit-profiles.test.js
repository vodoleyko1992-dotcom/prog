'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..'), bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8'), no = () => {};
const copy = x => structuredClone(x), storage = state => ({ get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, copy(state[k])])), set: async patch => Object.assign(state, copy(patch)) });
test('поздний ответ старого героя не дописывает клановые задания новому', async () => {
  const state = { on: true, lock: { k: 'tab1', epoch: 'e', t: Date.now() }, rt: { char: 'Warlock' }, cfg: { dailyAuto: false, clanTasks: true },
    'rt@Spoiler': { char: 'Spoiler' }, 'cfg@Spoiler': { dailyAuto: false, clanTasks: true } };
  const box = { URL, console, Date, crypto: require('node:crypto').webcrypto, chrome: { storage: { local: storage(state) } } };
  vm.createContext(box); vm.runInContext(bg.slice(0, bg.indexOf('// 8.0.6 (Firefox')), box);
  let release, requested = false; const gate = new Promise(r => { release = r; });
  const env = { get cfg() { return state.cfg; }, get rt() { return state.rt; }, on: true, tabOwner: true, rec: no,
    gameGet: async () => { requested = true; return gate; }, setRt: patch => box.statePatch({ patch, epoch: 'e', src: 'tab1', expectedChar: 'Warlock' }, { tab: { id: 1 }, frameId: 0, url: 'https://l2wap.com/map.html' }) };
  const mod = { console, Date, sessionStorage: { getItem: () => null, setItem: no } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/dailies.js'), 'utf8'), mod);
  const pending = mod.L2V7Factories.dailies(env).tick(); while (!requested) await Promise.resolve();
  state.on = false; env.on = false; await box.switchCharacter({ nick: 'Spoiler', vis: true, roles: [], defRt: {}, src: 'tab2' }, { tab: { id: 2, active: true } });
  release({ ok: true, status: 200, json: async () => ({ clan: { name: 'Old clan' }, me: { characterId: 'warlock-id' }, taskDefinitions: [], activeClanTasks: [] }) });
  await pending; await box.serializeLock(async () => {});
  assert.equal(state.rt.char, 'Spoiler'); assert.equal(state.rt.clanTasks, undefined);
  const rejected = await box.statePatch({ patch: { clanTasks: { me: 'Warlock' } }, expectedChar: 'Warlock', src: 'tab1' }, { tab: { id: 1 }, frameId: 0, url: 'https://l2wap.com/map.html' });
  assert.equal(rejected.reason, 'character_changed');
});
