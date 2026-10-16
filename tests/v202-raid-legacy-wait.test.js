'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../modules/raid.js'),'utf8');
const start=source.indexOf('  const mark = env.rt.rbIdleMark || {}, idle = env.rt.rbHuntIdle || 0;');
const end=source.indexOf('  const preparing = rbPreparationCandidates()[0];',start);
assert.ok(start>0&&end>start);
async function run(patch={}){
 const now=Date.now(),H={phase:'wait',step:'pick',id:null,...patch.H};
 const rt={rbHuntIdle:now+1200000,rbListT:now,rbIdleMark:{t:now,lvl:78,pots:0},...patch.rt};
 const cfg={rbHuntMode:true,autoTasks:['raid','fish'],...patch.cfg};let scans=0,waits=0;
 const env={rt,cfg,potModel:()=>({n:0}),setRt:async p=>Object.assign(rt,p),rec(){},setStatus(){},sleep:async()=>{}};
 const result=await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'return "continue";})()',{
 env,H,Date,RB_IDLE_MS:300000,plan:{heroLvl:78,ready:[],blocked:[]},active:()=>true,
 rbIdleMap:async()=>{waits++;return 'idle'},rbHuntPhase:async()=>{},isRbPage:()=>true,
 rbListScan:async()=>{scans++;return 'scan'},location:{href:''}});
 return {result,rt,scans,waits};
}
test('upgrade wait and newly selected fish bypass old future idle without granting fallback',async()=>{
 for(const H of [{step:'pick'},{step:undefined}]){const r=await run({H});assert.equal(r.result,'continue');assert.equal(r.rt.rbHuntIdle,0);assert.equal(r.waits,0);assert.equal(r.rt.rbFishWait,undefined);}
});
test('expired/unavailable list goes directly to full scan, not old timer',async()=>{
 const r=await run({rt:{rbListT:0}});assert.equal(r.scans,1);assert.equal(r.waits,0);
});
test('unselected fish, active/preparing route and existing parked marker keep their timer',async()=>{
 for(const patch of [{cfg:{autoTasks:['raid']}},{H:{phase:'prepare'}},{H:{id:'boss'}},{H:{step:'fight'}},{rt:{rbFishWait:{at:Date.now()}}}]){
  const r=await run(patch);assert.equal(r.result,'idle');assert.equal(r.scans,0);
 }
});
test('epic refusal safety pause is not migrated to fish',async()=>{
 const r=await run({cfg:{epicMode:true},rt:{rbRefuse:{n:2,t:Date.now()}}});assert.equal(r.result,'idle');
});
