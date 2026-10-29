'use strict';
// 20.81 (лог 29.10 20:08): поздняя победа не должна теряться из-за reload старого spawn.
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
async function timeout({age=9000,up=true,rebirth=true,mutate,mode='pending'}={}){
 const f=flowFixture('fighter'),e=f.env,state={recovered:0,reloaded:0,valid:null,selected:rebirth,generation:1},base=1000000000;
 let now=base;f.box.Date={now:()=>now};f.location.href='https://l2wap.com/battle.html?spawnId=one';
 e.routeLocation=f.location;e.canAct=()=>true;e.antibotState=()=>false;e.pvpPending=()=>false;
 Object.assign(e.rt,{char:'RunHero',classCur:{prof:'human_wizard',slot:0}});
 e.rebirthSelected=()=>state.selected;e.actionGeneration=()=>state.generation;
 e.rebirthBattleProof=async()=>({spawn:'one',name:'Safe Mob',lvl:75,role:'mob',current:()=>true});
 e.srvUp=async()=>{if(mutate)mutate({e,state,f});return up;};
 e.rebirthRecover=async valid=>{state.recovered++;state.valid=valid();e.on=false;return true;};
 f.location.reload=()=>{state.reloaded++;};
 e.sleep=async()=>{now+=mode==='panel'?7000:25000;};
 if(mode==='pending')f.setNet({start:2,done:1,t:now-age,okN:0});
 else{
  f.atk.disabled=true;e.uiTimer=()=>99;
  if(mode==='load'){const q=e.$q;e.$q=s=>s==='#battle-mob-hp-val'?null:q(s);}
  if(mode==='hp'){
   let hidden=false;const q=e.$q,extras=e.extraKillsInLog;
   e.$q=s=>s==='#battle-mob-hp-val'&&hidden?null:q(s);e.extraKillsInLog=lines=>{const r=extras(lines);hidden=true;return r;};
  }
 }
 try{await f.combat.battle();}catch(err){if(err.message!=='bounded-loop')throw err;}
 return{...state,events:f.events};
}

test('Rebirth: отвечающий сервер при ходе >8сек вызывает сверку похода вместо reload',async()=>{
 const f=await timeout();assert.equal(f.reloaded,0);assert.equal(f.recovered,1);assert.equal(f.valid,true);
});
test('Rebirth: >20сек без ответа также идёт в сверку похода',async()=>{
 const f=await timeout({age:21000,up:false});assert.equal(f.reloaded,0);assert.equal(f.recovered,1);assert.equal(f.valid,true);
});
for(const mode of ['stall','panel','hp','load'])test(`Rebirth: сторож ${mode} использует сверку без reload`,async()=>{
 const f=await timeout({mode});assert.equal(f.reloaded,0);assert.equal(f.recovered,1);assert.equal(f.valid,true);
});
test('обычная охота сохраняет прежнее восстановление страницы',async()=>{
 const f=await timeout({rebirth:false});assert.equal(f.reloaded,1);assert.equal(f.recovered,0);
});
for(const kind of ['stop','owner','class','kick','page','mode','captcha','generation'])test(`смена ${kind} при проверке сервера отменяет старое восстановление`,async()=>{
 const f=await timeout({mutate:({e,state,f})=>{
  if(kind==='stop')e.on=false;else if(kind==='owner')e.tabOwner=false;else if(kind==='class')e.rt.classCur.prof='human_warlock';
  else if(kind==='kick')e.rt.manualKickAt=123;else if(kind==='page')f.location.href='https://l2wap.com/char.html';
  else if(kind==='mode')state.selected=false;else if(kind==='generation')state.generation++;else e.antibotState=()=>true;
 }});assert.equal(f.reloaded,0);assert.equal(f.valid,null);assert.equal(f.recovered,0);
});
