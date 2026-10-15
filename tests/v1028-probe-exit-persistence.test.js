'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8');
function fixture(ok=true){const rt={rbDb:{boss:{probe:{kind:'dps',t:Date.now(),startedAt:Date.now()-10000}}}},writes=[];const box={console,Date,Math,location:{pathname:'/battle.html'}};vm.runInNewContext(read('modules/combat.js')+read('modules/raid.js'),box);const env={rt,cfg:{rbHuntMode:true},heroLvl:()=>78,epicById:()=>null,setRt:async p=>{writes.push(p);Object.assign(rt,p);return{ok}}};return{rt,writes,env,C:box.L2V7Factories.combat(env),R:box.L2V7Factories.raid(env)}}
test('probe abort stores current wound and hard skip before navigation, surviving a fresh module',async()=>{
 const f=fixture(),ctx={name:'Rudelto',rb:{id:'boss'}};
 assert.equal(await f.C.probeExitCommit(ctx,{cur:80402,max:2480352},'защита неизвестна'),true);
 assert.equal(f.rt.rbPreSkip.boss.probeExit,true);assert.equal(f.rt.rbPreSkip.boss.observed,true);assert.equal(f.rt.rbPending,false);
 assert.equal(f.rt.rbWound.boss.cur,80402);assert.equal(f.R.rbWounded('boss'),false);
 assert.equal(f.R.rbEntryDecision('boss',{price:0,unit:'аден',lvl:69}).ok,false);
});
test('missing or rejected durable ACK does not authorize the leave click',async()=>{for(const response of [{ok:false},undefined]){const f=fixture();f.env.setRt=async()=>response;assert.equal(await f.C.probeExitCommit({name:'Boss',rb:{id:'boss'}},{cur:100,max:1000},'abort'),false)}});
test('buff wait names missing effects and cooldown; repeated prepare phase preserves that status',async()=>{
 const source=read('modules/raid.js'),statuses=[],now=Date.now();
 const env={rt:{tbWaitUntil:now+40000,faCat:{123:{name:'Shield'}}},IL:{456:{n:'Wind Walk'}},cfg:{},townBuffStart:async()=>false,hudBuffs:()=>true,townBuffNeed:()=>({fa:[123,456]}),setStatus:t=>statuses.push(t),sleep:async()=>{}};
 const box={env,Date:class extends Date{static now(){return now}},rbBuffShortage:()=>0,huntSet:async p=>{env.rt.rbHunt={...env.rt.rbHunt,...p}}};
 vm.runInNewContext(source.slice(source.indexOf('async function rbBuffHold('),source.indexOf('function rbSummonBuffReady('))+source.slice(source.indexOf('async function rbHuntPhase('),source.indexOf('async function huntDone(')),box);
 await box.rbHuntPhase('prepare','подготовка');await box.rbBuffHold('Boss',()=>true);const wait=statuses.at(-1);
 assert.match(wait,/Shield, Wind Walk/);assert.match(wait,/40 с/);
 await box.rbHuntPhase('prepare','подготовка');assert.equal(statuses.at(-1),wait);assert.equal(statuses.length,2);
});

test('strict raid+cat idle retains raid waiting status instead of calling forbidden farm/tasksIdle',async()=>{
 const source=read('modules/raid.js'),statuses=[];let maps=0,navigations=0;
 const env={cfg:{autoTasks:['raid','cat']},setStatus:t=>statuses.push(t),sleep:async()=>{},map:()=>maps++,isMap:()=>true,$q:()=>({})};
 const box={env,location:{set href(v){navigations++}}};
 vm.runInNewContext(source.slice(source.indexOf('const rbIdleFarmAllowed ='),source.indexOf('const RB_IDLE_MS =')),box);
 await box.rbIdleMap('Тур РБ: подходящих РБ нет — жду повторной проверки',()=>true);
 assert.equal(maps,0);assert.equal(navigations,0);assert.match(statuses[0],/Тур РБ/);assert.doesNotMatch(statuses[0],/Без режима/);
 env.cfg={};await box.rbIdleMap('старый разрешённый фарм',()=>true);assert.equal(maps,1);
});

test('awaited probe commit cannot leave after hero, lease, manual mode or battle identity changes',async()=>{
 for(const changed of ['hero','lease','manualKick','battle','mode']){
  const f=fixture(),identity={hero:'A',lease:'e',manualKick:0,battle:'boss',mode:'raid'};let release,clicks=0;
  const gate=new Promise(r=>release=r);Object.assign(f.env,{on:true,tabOwner:true,probeFight:()=>true,$q:()=>({}),shown:()=>true,isBattle:()=>true,battleExitContext:()=>JSON.stringify(identity),fire:()=>clicks++,setRt:async()=>{await gate;return{ok:true}},sleep:async()=>{}});
  const pending=f.C.rbTryExit({name:'Boss',rb:{id:'boss'}},{cur:100,max:100},{cur:50,max:100},{abort:true},false);
  identity[changed]='changed';release();assert.equal(await pending,'done');assert.equal(clicks,0,changed);
 }
});

test('actor changed while waiting for leave ACK cannot mutate new hero through retreat or failure note',async()=>{
 for(const ended of [true,false]){
  const f=fixture();let release,writes=0,actor='first';const gate=new Promise(r=>release=r);
  Object.assign(f.env,{on:true,tabOwner:true,probeFight:()=>true,$q:()=>({}),shown:()=>true,isBattle:()=>true,battleExitContext:()=>actor,fire:()=>{},rec:()=>{},waitFor:()=>gate,rbRetreat:()=>writes++,rbNote:()=>writes++});
  const pending=f.C.rbTryExit({name:'Boss',rb:{id:'boss'}},{cur:100,max:100},{cur:50,max:100},{abort:true},false);
  await new Promise(r=>setImmediate(r));actor='new hero or lease';release(ended);assert.equal(await pending,'done');assert.equal(writes,0);
 }
});
