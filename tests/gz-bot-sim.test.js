'use strict';
// botsim.js as the extension loads it: plain content script in a window-like global (no require/module), after the core.
// Checks the UMD browser branch: window.OGX.botSim, OGX.module('botsim') registration (title, no-op init), the default unit
// table taken from window.OGX.catalog, and that the browser copy computes exactly what the node copy computes.
//   node tests/gz-bot-sim.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['shared/core/00-ogx.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'ogamex-bot/modules/botsim/botsim.js'];

function browserSandbox() {
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  return sb;
}

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e)); }
}

const sb = browserSandbox();
const B = sb.OGX.botSim;
const N = require(path.join(ROOT, 'ogamex-bot/modules/botsim/botsim.js'));

test('window.OGX.botSim defined, module registered', () => {
  assert.ok(B && typeof B.battle === 'function');
  assert.equal(B.version, '1.0.0');
  const def = sb.OGX.modules.botsim;
  assert.ok(def, 'OGX.module botsim');
  assert.equal(def.title, 'Бот: симулятор боя');
  assert.equal(typeof def.init, 'function');
  assert.equal(def.init({}), undefined);   // init does nothing (pure library)
  assert.equal(typeof sb.module, 'undefined');
});

test('browser default unit table = catalog table', () => {
  const T = B._defaultUnits();
  assert.equal(T[214].attack, 200000);
  assert.equal(T[408].attack, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(T)), JSON.parse(JSON.stringify(N.unitTable(N.loadCatalog(path.join(ROOT, 'shared/core/08-catalog-data.js'))))));
});

test('browser and node copies give identical results for a seed', () => {
  const opts = { attacker: { units: { 206: 200, 202: 50 }, tech: { weapons: 10, shielding: 10, armour: 10 } },
    defender: { units: { 401: 500, 402: 200, 204: 100 }, tech: { weapons: 8, shielding: 8, armour: 8 } }, planet: { metal: 5e6, crystal: 3e6, deuterium: 1e6 }, runs: 50, seed: 'x' };
  assert.deepEqual(JSON.parse(JSON.stringify(B.raid(opts))), JSON.parse(JSON.stringify(N.raid(opts))));
  const e = { ships: { 202: 5, 210: 1 }, runs: 300, seed: 3 };
  assert.deepEqual(JSON.parse(JSON.stringify(B.expedition(e))), JSON.parse(JSON.stringify(N.expedition(e))));
  assert.equal(B.spyNeeded({ ourSpy: 7, theirSpy: 8, want: 'defense' }), 2);
});

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
