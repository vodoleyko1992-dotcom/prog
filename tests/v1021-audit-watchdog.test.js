'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const copy = x => structuredClone(x), noop = () => {};
const storage = state => ({ get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, copy(state[k])])), set: async patch => Object.assign(state, copy(patch)) });
for (const mode of ['stop', 'restart', 'heartbeat']) test(`сторож отменяет старое решение после ${mode}`, async () => {
  const now = Date.now(), old = { tab: 1, t: now - 180000, page: '/map.html' };
  const state = { on: true, hbBg: old, wdog: mode === 'restart' ? [now - 10000, now - 20000, now - 30000] : [], cfg: {}, lock: { k: 'tab1', epoch: 'e1' }, wdDown: null };
  let release, requested = false, listener; const gate = new Promise(r => { release = r; }), reloads = [];
  const box = { URL, console, Date, hbMem: copy(old), hbPersistedAt: 0, buf: [], flush: noop,
    chrome: { storage: { local: storage(state) }, alarms: { onAlarm: { addListener: f => { listener = f; } } },
      tabs: { get: async id => ({ id, url: 'https://l2wap.com/map.html' }), reload: async id => reloads.push(id), update: async () => {} } },
    srvProbe: async () => { requested = true; return gate; } };
  vm.createContext(box);
  vm.runInContext(src.slice(src.indexOf('function wdPlan('), src.indexOf('async function srvProbe(')), box);
  vm.runInContext(src.slice(src.indexOf('chrome.alarms?.onAlarm.addListener('), src.indexOf('// Release immediately when')), box);
  const pending = listener({ name: 'l2watch' }); while (!requested) await Promise.resolve();
  if (mode === 'stop') state.on = false;
  else if (mode === 'restart') { state.lock = { k: 'tab2', epoch: 'e2' }; state.wdog = []; state.hbBg = { tab: 2, t: Date.now(), page: '/fishing.html' }; box.hbMem = copy(state.hbBg); }
  else { state.hbBg = { tab: 1, t: Date.now(), page: '/map.html' }; box.hbMem = copy(state.hbBg); }
  release('up'); await pending;
  assert.deepEqual(reloads, []); assert.equal(state.on, mode !== 'stop'); assert.equal(state.stopMeta, undefined);
});
