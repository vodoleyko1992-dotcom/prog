'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mk,docOf}=require('./epic-harness.cjs');
const pin='<div class="l2-map-mob-pin l2-map-mob-pin--raid" data-spawn-id="l2dop_rb_29014" title="Orfen · ур. 50"></div>';
function fixture(step='prep'){
 const f=mk({doc:docOf(pin),rt:{char:'Hero',manualKickAt:10,epic:{step,k:'orfen',id:'l2dop_rb_29014',at:Date.now(),seenSaved:true}}});
 f.env.tabOwner=true;f.env.canAct=()=>true;f.env.canRun=()=>true;f.env.rbShopFirst=async()=>false;f.env.townBuffStart=async()=>false;f.env.meHp=()=>({cur:100,max:100,pct:100});f.env.meMp=()=>({cur:100,max:100});f.env.buffWaitBeforeRb=()=>null;f.env.mapReady=async()=>true;
 f.env.rbEngage=async()=>{f.fires.push('engage');return true};return f;
}
for(const [name,change]of[['Stop',f=>f.env.on=false],['mode',f=>f.env.cfg.epicMode=false],['character',f=>f.env.rt.char='Other'],['manual command',f=>f.env.rt.manualKickAt++],['priority',f=>f.env.canRun=()=>false]]){
 test('epic preparation interrupted by '+name+' cannot advance stale route',async()=>{
  const f=fixture();f.env.rbShopFirst=async()=>{change(f);return false};await f.E.epicStep();assert.equal(f.env.rt.epic.step,'prep');assert.equal(f.fires.length,0);
 });
 test('epic arrival interrupted by '+name+' cannot set fight or engage',async()=>{
  const f=fixture('arrive');f.env.mapReady=async()=>{change(f);return true};await f.E.epicStep();assert.equal(f.env.rt.epic.step,'arrive');assert.equal(f.fires.length,0);
 });
}
test('new epic selected during preparation retains its own state',async()=>{const f=fixture();f.env.townBuffStart=async()=>{f.env.rt.manualKickAt++;f.env.rt.epic={step:'pick',k:'core'};return false};await f.E.epicStep();assert.equal(f.env.rt.epic.k,'core');assert.equal(f.env.rt.epic.step,'pick')});
test('unchanged preparation advances to go',async()=>{const f=fixture();await f.E.epicStep();assert.equal(f.env.rt.epic.step,'go')});

test('unloaded epic map preserves arrival instead of recording route failure',async()=>{const f=fixture('arrive');f.env.mapReady=async()=>false;f.env.rt.epic.at=Date.now()-30000;await f.E.epicStep();assert.equal(f.env.rt.epic.step,'arrive');assert.equal(f.fires.length,0)});
for(const operation of ['reserve','release'])test('epic '+operation+' keeps budget and paid-count in the same profile write',async()=>{
 const f=fixture();f.env.cfg.epicCoinDailyMax=10;f.env.cfg.epicCoinPerBoss=1;f.env.cfg.epicCoinKeep=0;
 if(operation==='release'){f.env.rt.epicTpBudget=[{t:1000,k:'orfen',cost:1,unit:'Coin of Luck',kind:'tp'}];f.env.rt.epicDb={orfen:{paidN:1}}}
 const writes=[];f.env.setRt=async p=>{writes.push(p);Object.assign(f.env.rt,p);f.env.rt.char='Other';f.env.rt.epicDb={};f.env.rt.epicTpBudget=[]};
 if(operation==='reserve')await f.E.epicTpBudgetReserve('orfen',{known:true,col:1,adena:0});else await f.E.epicTpBudgetRelease('orfen',1000,'cancelled');
 assert.equal(writes.length,1);assert.equal(Object.keys(f.env.rt.epicDb).length,0);assert.equal(writes[0].epicDb.orfen.paidN,operation==='reserve'?1:0);
});
test('epic map failure reloads once and pauses with the same target',async()=>{const f=fixture('arrive');let reloads=0,pauses=0;f.env.mapReady=async()=>null;f.loc.reload=()=>reloads++;f.env.pauseBot=async()=>pauses++;f.env.rt.epic.mapLoadT=Date.now()-31000;await f.E.epicStep();assert.equal(reloads,1);f.env.rt.epic.mapLoadT=Date.now()-31000;await f.E.epicStep();assert.equal(pauses,1);assert.equal(reloads,1);assert.equal(f.env.rt.epic.k,'orfen');assert.equal(f.env.rt.epic.step,'arrive')});
