'use strict';
// 7.1.30: автофарм по реальным замерам Warlock (выгрузка 10.10): соседние уровни учитываются, а не «всё заново на каждом уровне»
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sb = { console, Date, location: { pathname: '/map.html' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'modules/navigation.js'), 'utf8'), sb);
const Z = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-zones-7128.json'), 'utf8'));
const env = { cfg: { zoneTrial: 20, lvlBelow: 3, lvlAbove: 20, shopReserve: 200000 }, rt: { ...Z, zone: 'pavel_ruins', zoneTried: {} }, heroLvl: () => 50, setRt: () => {} };
const N = sb.L2V7Factories.navigation(env);
const r = N.zoneRate('pavel_ruins', 50); assert.ok(r.exp > 0 && r.n >= 20, 'pavel_ruins rated from neighbour levels');
const pick = N.zonePick();
assert.equal(pick?.id, 'blazing_swamp', `best known zone for hero 50 (got ${JSON.stringify(pick)})`);
// уже в лучшей — остаёмся
env.rt.zone = 'blazing_swamp'; env.rt.zoneExploreT = Date.now();
assert.equal(N.zonePick(), null, 'stay in the best zone');
console.log('PASS: autofarm — ratings from neighbour levels, picks the best known zone (blazing_swamp), stays there');
