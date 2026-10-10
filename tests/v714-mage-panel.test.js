'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const {createBattleCooldown} = require('../battle-cooldown.js');
let now = 100000;
const cd = createBattleCooldown(() => now);
// A sync endpoint—not just rejected skills—reports the true global recovery.
cd.observeSync({serverNowMs: 900000, globalCooldownUntilMs: 900425, inBattle:true, skillCooldowns:{l2_1177:901000}}, 'mob-1');
assert(cd.globalWait('mob-1') >= 425, 'global cooldown read from battle/sync');
assert(cd.skillWait('l2_1177', 'mob-1') >= 1000, 'individual skill cooldown read from battle/sync');
now += 500;
assert.equal(cd.globalWait('mob-1'),0, 'GCD expires without three-minute recovery');
assert(cd.skillWait('l2_1177', 'mob-1') > 400, 'individual cooldown is independent');
cd.observe({action:'l2_1177',battleSpawnId:'mob-1'}, {
  error:'skill_cooldown',blockedBy:'global',serverNowMs:910000,
  globalCooldownUntilMs:910320,cooldownUntilMs:910320,skillRemainingMs:0
},400);
assert(cd.globalWait('mob-1') >= 300, 'global rejection establishes next-action gap');
assert(cd.skillWait('l2_1177', 'mob-1') < 600, 'global cooldown cannot poison individual skill timer');
cd.observeSync({serverNowMs:920000, globalCooldownUntilMs:920300, inBattle:true}, 'mob-2');
assert(cd.globalWait('mob-2')>=300,'new mob cooldown respected after changed battle');
assert.equal(cd.skillWait('l2_1177','mob-2'),0,'new battle does not inherit previous cast cooldown');
const combat=fs.readFileSync(path.join(root,'modules/combat.js'),'utf8');
const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
const equip=fs.readFileSync(path.join(root,'modules/equipment.js'),'utf8');
assert.match(content,/combatCooldown\.observeSync\(d\.res, battleSpawn\(\)\)/);
assert.match(combat,/function nonOffenseSkill/);
assert.doesNotMatch(combat,/return env\.halt\('На панели нет атаки/);
assert.match(combat,/await env\.waitX\(hasDamageSlot/);
assert.match(combat,/env\.combatCooldown\.globalWait\(\)/);
assert.match(equip,/warrior servitor\|final servitor/);
console.log('PASS: mage GCD from server sync, per-spell cooldown, battle transition, future servitor skills isolation, recoverable hotbar loading');
