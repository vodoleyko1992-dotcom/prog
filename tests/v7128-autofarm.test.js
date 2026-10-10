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
// 7.1.31 (лог 10.10 19:35): мобы тут 15–35 ур. — сразу в лучшую замеренную зону своего уровня, а не в ближайшую по уровню
(async () => {
  env.rt.zone = 'out:cruma'; env.rt.zoneLvlT = 0; env.rt.zoneCatT = Date.now();
  let go = null; env.setRt = p => { if (p.zoneGo) go = p.zoneGo; Object.assign(env.rt, p); };
  env.pageItems = () => [15, 20, 27, 35].map(lvl => ({ lvl, champ: false }));
  env.zoneCatThin = () => false; env.rec = () => {};
  sb.location.href = '';
  const sleep0 = env.sleep; env.sleep = async () => {};
  assert.equal(await N.zoneForLevel(), true);
  assert.equal(go?.id, 'blazing_swamp', `low-level spot → best measured zone (got ${JSON.stringify(go)})`);
  assert.match(go.why, /лучшая по опыту/);
  env.sleep = sleep0;
  console.log('PASS: low-level spot → straight to the best measured zone (one teleport, not two)');
})().catch(e => { console.error(e); process.exit(1); });
console.log('PASS: autofarm — ratings from neighbour levels, picks the best known zone (blazing_swamp), stays there');
