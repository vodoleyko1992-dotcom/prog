'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/raid.js','utf8');
function fixture(key='current') {
 const env={cfg:{rbProbe:true,rbMaxKillMin:20},rt:{rbDb:{},rbStats:{},rbList:{hekaton:{lvl:80}}},
  warlock:{raidContext:()=>({managed:true,key})},heroLvl:()=>77,meHp:()=>({max:14917}),
  potModel:()=>({pool:568000,rate:2000}),fmtT:x=>String(Math.round(x)),fmtK:x=>String(Math.round(x)),
  epicOn:()=>false,epicById:()=>null};
 const box={console,Math,Number,Date};box.globalThis=box;vm.runInNewContext(source,box);
 return {env,raid:box.L2V7Factories.raid(env)};
}
const stats={hp:5500896,patk:7714,matk:6088};
test('неизмеренный состав может безопасно пробовать Hekaton вместо отказа по 92 минутам',()=>{
 const {raid}=fixture();const v=raid.rbPreCheck('hekaton',stats);
 assert.equal(v.ok,true);assert.equal(v.probe,true);
});
test('повторная проба на том же уровне и опасный спецудар остаются запрещены',()=>{
 const {env,raid}=fixture();env.rt.rbDb.hekaton={probe:{t:Date.now()-4*3600000,lvl:77}};
 assert.equal(raid.rbPreCheck('hekaton',stats).ok,false);
 delete env.rt.rbDb.hekaton;assert.equal(raid.rbPreCheck('hekaton',{...stats,matk:20000}).ok,false);
});
test('без ключа состава и при отключённой пробе прежний предел действует',()=>{
 assert.equal(fixture(null).raid.rbPreCheck('hekaton',stats).kind,'slow');
 const {env,raid}=fixture();env.cfg.rbProbe=false;assert.equal(raid.rbPreCheck('hekaton',stats).kind,'slow');
});
test('старый отказ из-за времени не скрывает новую разрешённую пробу',()=>{
 const {env,raid}=fixture();env.rt.rbStats.hekaton=stats;
 env.rt.rbPreSkip={hekaton:{t:Date.now(),kind:'slow'}};
 assert.equal(raid.rbTeleportCheck('hekaton',{lvl:80},true),null);
});
