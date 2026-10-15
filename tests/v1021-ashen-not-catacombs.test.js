'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sb={console,URLSearchParams,location:{search:'?spawnId=ashen_bastion_mob_001'}};sb.globalThis=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/mobfarm.js'),'utf8'),sb);
const mod=sb.L2V7Factories.mobfarm({rt:{catIn:'necropolis_of_devotion'}});
assert.equal(mod.dungeonBattle(),false,'stale catIn must not turn an Ashen battle into catacombs');
sb.location.search='?spawnId=sdms_necropolis_of_devotion_001';assert.equal(mod.dungeonBattle(),true);
sb.location.search='?spawnId=dense_123';assert.equal(mod.dungeonBattle(),false);
console.log('PASS: dungeon hunt chain requires current dungeon spawn, not stale catIn');
