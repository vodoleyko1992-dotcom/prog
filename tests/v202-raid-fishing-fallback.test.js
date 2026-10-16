'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');const box={};vm.runInNewContext(read('engine-core.js'),box);const E=box.L2EngineCore;
const now=Date.now(),cfg={autoTasks:['tvt','raid','fish'],fishMode:false,rbHuntMode:true,fishMaxCasts:0};
const idle=()=>({rbFishWait:{at:now-100,until:now+300000,listT:now-1000},rbHuntIdle:now+300000,rbHunt:{step:'pick',phase:'wait',id:null}});
test('confirmed empty raid uses explicitly selected fish despite raw fishModefalse',()=>{
 const rt=idle();assert.equal(E.selectedTask(cfg,rt,now),'fish');
 const c=E.taskConfig(cfg,()=>rt);assert.equal(c.fishMode,true);assert.equal(c.rbHuntMode,false);assert.equal(c.tvtOn,true);assert.equal(E.taskJobAllowed(c,'rbHunt',rt),true,'parked tour survives main prune');
 assert.equal(E.selectedTask({...cfg,autoTasks:['raid']},rt,now),'raid');
 assert.equal(E.selectedTask({...cfg,autoTasks:[]},rt,now),'tasks');
});
test('plain idle, prepare/error, active tour and unknown nonfish payment cannot fallback',()=>{
 assert.equal(E.selectedTask(cfg,{rbHuntIdle:now+300000},now),'raid');
 for(const patch of [{rbHunt:{step:'pick',phase:'prepare'}},{rbHunt:{step:'fight',phase:'wait',id:'rb'}},{rbGo:{id:'rb'}},{rbPending:true},{actionPayments:{pending:{kind:'raid-teleport'}}}])
  assert.equal(E.selectedTask(cfg,{...idle(),...patch},now),'raid');
});
test('deadline or fresh candidate returns raid only after current fish/reconciliation',()=>{
 for(const wake of [{rbFishWait:{at:now-100,until:now-1}},{rbTourView:{at:now,ready:[{id:'alive'}]}}]){
  const rt={...idle(),...wake};assert.equal(E.selectedTask(cfg,rt,now),'raid');
  for(const busy of [{fishCastActive:true},{fishCastPending:{at:now-20}},{actionPayments:{pending:{kind:'fishing'}}}])
   assert.equal(E.selectedTask(cfg,{...rt,...busy},now),'fish');
 }
});
test('fish completion/limits and higher selected quest priority remain effective',()=>{
 for(const rt of [{fishTgt:{done:true}},{fish:{casts:1}}]) assert.equal(E.selectedTask({...cfg,fishMaxCasts:1},{...idle(),...rt},now),'raid');
 assert.equal(E.selectedTask({...cfg,autoTasks:['raid','quests','fish']},idle(),now),'quests');
 assert.equal(E.selectedTask({...cfg,autoTasks:['raid','fish','epic']},idle(),now),'epic');
});
test('actual empty-plan marker block refuses unknown payment and omitted fish',async()=>{
 const source=read('modules/raid.js'),start=source.indexOf('    const idleAt = Date.now();'),end=source.indexOf('\n    return rbIdleMap',start),fragment=source.slice(start,end);
 assert.ok(start>0&&end>start);
 for(const [selected,pending] of [[true,false],[false,false],[true,true]]){
  const rt={rbListT:now-100,rbList:{dead:{alive:false}}};const env={cfg:{autoTasks:selected?['raid','fish']:['raid']},rt,payments:{blocked:()=>pending},heroLvl:()=>78,potModel:()=>({n:0}),setRt:async p=>Object.assign(rt,p)};
  await vm.runInNewContext('(async()=>{'+fragment+'})()',{env,Date,wait:300000,idleN:0,active:()=>true,fishSelected:selected,verified:true});
  assert.equal(!!rt.rbFishWait,selected&&!pending);if(rt.rbFishWait){assert.equal(rt.rbFishWait.until,rt.rbHuntIdle);assert.equal(rt.rbFishWait.listT,rt.rbListT);}
 }
});
test('unverified legacy/partial list forces one read and throttles errors, never yields fish',async()=>{
 const source=read('modules/raid.js'),start=source.indexOf('    const fishSelected = Array.isArray(env.cfg.autoTasks)',source.indexOf('  const p = plan.ready[0] || null;'));
 const end=source.indexOf('    const why = `подходящих РБ нет',start),fragment=source.slice(start,end);
 assert.ok(start>0&&end>start);
 let scans=0;const rt={rbListT:now,rbList:{dead:{alive:false}}},env={cfg,rt,setRt:async p=>Object.assign(rt,p)};
 const run=()=>vm.runInNewContext('(async()=>{'+fragment+'return "verified"})()',{env,Date,active:()=>true,isRbPage:()=>true,rbListScan:async()=>{scans++;rt.rbListT=Date.now()-720000;rt.rbListVerifiedAt=0;rt.rbListIncomplete=true;},rbIdleMap:async()=> 'hold'});
 await run();assert.equal(scans,1);assert.equal(rt.rbFishWait,null);
 assert.equal(await run(),'hold');assert.equal(scans,1);
 rt.rbListVerifiedAt=rt.rbListT;rt.rbListIncomplete=false;assert.equal(await run(),'verified');
});
test('actual rbListScan clears verification on error/partial and verifies only full success',async()=>{
 const source=read('modules/raid.js'),start=source.indexOf('async function rbListScan()'),end=source.indexOf('\nfunction rbStatsGuess',start),fragment=source.slice(start,end);
 for(const mode of ['empty','partial','complete']){
  const rt={rbList:{old:{alive:false}},rbListT:now,rbListVerifiedAt:now};
  const rows=mode==='empty'?{}:{dead:{id:'dead',name:'Dead',lvl:78,alive:false}};
  const env={rt,cfg:{},on:true,tabOwner:true,canAct:()=>true,setStatus(){},$q:()=>({}),waitX:async()=>true,sleep:async()=>{},rnd:()=>0,heroLvl:()=>78,rec(){},fire:()=>false,setRt:async p=>Object.assign(rt,p)};
  const fn=vm.runInNewContext(fragment+'\nrbListScan;',{env,Date,location:{href:''},rbPageNow:()=>1,rbRowsParse:()=>rows,rbNextPageButton:()=>mode==='partial'?{}:null,rbPartialListT:()=>Date.now()-720000});
  await fn();
  assert.equal(rt.rbListIncomplete,mode!=='complete');
  if(mode==='complete')assert.equal(rt.rbListVerifiedAt,rt.rbListT);else assert.equal(rt.rbListVerifiedAt,0);
 }
});
