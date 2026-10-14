'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const cases=[];const test=(name,run)=>cases.push({name,run});
function make(){
 const f=fixture({cfg:{petFullAuto:false}});Object.assign(f.ch,{mAtk:8000,pAtk:1300,pDef:1400,mDef:1100,maxHp:9785,activeBuffs:[{skillId:1356,level:1,expiresAtMs:f.now()+60000}]});
 f.env.shotContext=()=> 'BSPS-A:on';f.api().noteSnapshot(f.ch);
 const env=f.env;Object.assign(env.cfg,{rbRetreatHp:20,stopHp:25,rbRestHp:95,rbMaxKillMin:20});Object.assign(env.rt,{rbDps:3000,rbDb:{boss:{dps:3000,dpsBase:3000,dpsLvl:75,sp:1000}},rbStats:{boss:{hp:2409850,patk:4949,matk:3292,pdef:5924,mdef:5517}},rbList:{boss:{lvl:66}}});
 Object.assign(env,{warlock:f.api(),heroLvl:()=>75,meHp:()=>({cur:9000,max:9785,pct:92}),logLines:()=>[],newLines:()=>[],activeBuffs:()=>[],potModel:()=>null,epicOn:()=>false,epicById:()=>null,fmtT:x=>String(Math.round(x)),fmtK:x=>String(Math.round(x))});
 const sb={console,Math,Number,Date:{now:f.now}};sb.globalThis=sb;vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../modules/raid.js'),'utf8'),sb);f.R=sb.L2V7Factories.raid(env);env.rbNote=f.R.rbNote;return f;
}
test('real provider works while paid full-buff feature is OFF',()=>{const f=make();assert.ok(f.api().raidContext('boss',f.env.rt.rbStats.boss).key);assert.equal(f.R.rbDpsOn('boss'),1150);assert.equal(f.calls.length,0);});
test('real provider tags exact measured total and detects target defense changes',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);assert.equal(f.R.rbDpsOn('boss'),34462);f.env.rt.rbStats.boss.mdef++;assert.equal(f.R.rbDpsOn('boss'),1150);});
test('hero vampire buff removed invalidates old total and survival context',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.ch.activeBuffs=[];f.api().noteSnapshot(f.ch);assert.equal(f.R.rbDpsOn('boss'),1150);});
test('shots off invalidates old measurement before new character response',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.env.shotContext=()=> 'BSPS-A:off';assert.equal(f.R.rbDpsOn('boss'),1150);});
test('pet expires before30s TTL invalidates exact old context',async()=>{const f=make();f.ch.activeSummon.activeBuffs=[{skillId:4699,level:2,expiresAtMs:f.now()+5000}];f.api().noteSnapshot(f.ch);await f.R.rbDpsLearn('boss',34462);f.tick(5001);assert.equal(f.R.rbDpsOn('boss'),1150);});
test('same key repeated fresh GET does not reset observation window',()=>{const f=make(),ctx={name:'Boss',rb:{id:'boss',samples:[],hits:[]}};for(let i=0;i<26;i++){if(i)f.tick(1000);f.api().noteSnapshot(f.ch);ctx.rb.hits.push(120);f.R.rbAssess(ctx,{cur:9000-i*20,max:9785,pct:90},{cur:2409850-i*10000,max:2409850});}assert.equal(ctx.rb.samples.length,26);assert.equal(f.env.rbLive.dps,10000);assert.equal(f.env.rbLive.loss,20);assert.equal(f.env.rt.rbDb.boss.dps,10000);});
test('same type resummoned pet does not inherit previous context estimate',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.env.rt.petBornT=f.now();assert.equal(f.R.rbDpsOn('boss'),1150);});
test('class change does not apply tagged Warlock total to another class',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.env.rt.rbDps=34462;f.env.rt.rbDpsContext=f.env.rt.rbDb.boss.dpsContext;f.env.rt.classCur.prof='dwarf_artisan';assert.equal(f.R.rbDpsOn('boss'),1150);});
test('hero switch does not apply another hero full-buff total',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.env.rt.char='OtherHero';assert.equal(f.R.rbDpsOn('boss'),1150);});
test('subclass slot change invalidates even same profession name',async()=>{const f=make();await f.R.rbDpsLearn('boss',34462);f.env.rt.classCur.slot=1;assert.equal(f.R.rbDpsOn('boss'),1150);});
(async()=>{let fail=0;for(const c of cases){try{await c.run();console.log('PASS '+c.name);}catch(e){fail++;console.log('FAIL '+c.name+': '+e.message)}}console.log(JSON.stringify({pass:cases.length-fail,fail}));process.exitCode=fail?1:0})();
