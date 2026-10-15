'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../modules/champs.js'), 'utf8');
function fixture(mode = 'efficiency') {
  const box = {}; vm.runInNewContext(src, box);
  const env = { cfg: { champBlue: true, champOrange: true, champRed: false, champCancel: mode },
    rt: { lvl: 77, dps: { dps: 2534, n: 100 } }, heroLvl: () => 77,
    farmRate: () => ({ eps: 40000, sk: 2.9 }), faPaidLeft: () => 5 };
  return require('./champs-context-fixture.cjs').freshChamps(box.L2V7Factories.champs,env);
}
const blue = { tier: 'blue', lvl: 76, hp: 10000, exp: 30000, fa: 0.1 };
test('short blue fight from 23:41 log is tried in efficiency mode despite FA buffs', () => {
  const j = fixture().judge(blue);
  assert.equal(j.ok, true, j.why);
  assert.ok(j.eta <= 30);
});
test('strict paid mode still protects FA buffs', () => {
  const j = fixture('paid').judge(blue);
  assert.equal(j.ok, false);
  assert.equal(j.cancel, true);
});
test('red stays disabled and a long blue fight is not exempt from Cancel cost', () => {
  assert.equal(fixture().judge({ ...blue, tier: 'red' }).off, true);
  assert.equal(fixture().judge({ ...blue, hp: 100000 }).ok, false);
});
