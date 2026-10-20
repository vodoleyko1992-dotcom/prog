'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bg=fs.readFileSync(__dirname+'/../background.js','utf8'),src=fs.readFileSync(__dirname+'/../content.js','utf8');
const signature=n=>JSON.stringify([['matk_6'],n,'weapon:1']);
function fixture(){
 const context=JSON.stringify(['hero','lease',2,5,'/augmentation.html']);
 const cfg={other:7,autoLs:{targets:['matk_6'],maxAttempts:10,weaponKey:'weapon:1',buyMaterials:true,aaBudget:2000000}};
 const autoLs={id:'series',context,configSig:signature(10),status:'running',hold:true,pending:null,maxAttempts:10,attempts:1,spentAA:160000,history:[{attempt:1}]};
 const state={on:true,lock:{k:'tab1',epoch:'lease',t:Date.now()},cfg,rt:{char:'hero',manualKickAt:5,autoLs,other:'kept'}},writes=[];
 const box={Date,URL,MAX_PATCH_KEYS:50,LOCK_TTL:60000,serializeLock:fn=>fn(),chrome:{storage:{local:{get:async()=>structuredClone(state),set:async p=>{writes.push(structuredClone(p));Object.assign(state,structuredClone(p));}}}}};
 vm.createContext(box);vm.runInContext(bg.slice(bg.indexOf('function reduceLsAttemptsChange('),bg.indexOf('// Popup writes also'))+';globalThis.change=reduceLsAttemptsChange;globalThis.patch=statePatch;',box);
 const edit={id:'series',context,configSig:signature(10),from:10,to:4,attempts:1,kick:5,expectedConfig:structuredClone(cfg.autoLs)};
 const sender={tab:{id:1,url:'https://l2wap.com/augmentation.html'},url:'https://l2wap.com/augmentation.html',frameId:0};
 return {box,state,writes,edit,call:()=>box.patch({patch:{},src:'tab1',epoch:'lease',expectedChar:'hero',reduceLsAttempts:edit},sender),sender};
}
test('background atomically reduces cfg and runtime, retaining accounting/history/unrelated state',async()=>{
 const f=fixture(),r=await f.call();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.writes.length,1);assert.equal(f.state.cfg.autoLs.maxAttempts,4);assert.equal(f.state.rt.autoLs.maxAttempts,4);assert.equal(f.state.rt.autoLs.configSig,signature(4));assert.equal(f.state.rt.autoLs.spentAA,160000);assert.deepEqual(f.state.rt.autoLs.history,[{attempt:1}]);assert.equal(f.state.cfg.other,7);assert.equal(f.state.rt.other,'kept');
});
for(const kind of ['Stop','owner','character','series','context','config','attempts','pending','paused','kick','cfgLimit','signature'])test('atomic reduction rejects stale '+kind,async()=>{
 const f=fixture();if(kind==='Stop')f.state.on=false;if(kind==='owner')f.state.lock.epoch='new';if(kind==='character')f.state.rt.char='other';if(kind==='series')f.state.rt.autoLs.id='new';if(kind==='context')f.state.rt.autoLs.context='new';if(kind==='config')f.state.cfg.autoLs.aaBudget=0;if(kind==='attempts')f.state.rt.autoLs.attempts=2;if(kind==='pending')f.state.rt.autoLs.pending={kind:'supply'};if(kind==='paused')f.state.rt.autoLs.status='paused';if(kind==='kick')f.state.rt.manualKickAt=6;if(kind==='cfgLimit')f.state.cfg.autoLs.maxAttempts=9;if(kind==='signature')f.state.rt.autoLs.configSig='wrong';
 assert.equal((await f.call()).ok,false);assert.equal(f.writes.length,0);
});
for(const value of [0,-1,1,10,11,2.5,NaN,'4'])test('invalid or non-decreasing total '+String(value)+' is rejected',async()=>{const f=fixture();f.edit.to=value;assert.equal((await f.call()).ok,false);assert.equal(f.writes.length,0);});
test('duplicate reduction is rejected without second write',async()=>{const f=fixture();assert.equal((await f.call()).ok,true);assert.equal((await f.call()).ok,false);assert.equal(f.writes.length,1);});
function parent(){
 const f=fixture();let calls=0;
 const box={on:true,tabOwner:true,leaseEpoch:'lease',automationGeneration:2,location:{pathname:'/augmentation.html'},rt:structuredClone(f.state.rt),cfg:structuredClone(f.state.cfg),OWN_CFG:[],TAB_ID:'tab1',Date,
  rtCommit:async()=>true,withRb:c=>c,L2EngineCore:{rawTaskConfig:c=>c},ipc:async m=>{calls++;const r=f.box.change(f.state,m.reduceLsAttempts);return r;}};
 vm.createContext(box);vm.runInContext(src.slice(src.indexOf('async function reduceLsAttempts('),src.indexOf('L2V7Modules.lifestone = L2V7Factories.lifestone('))+';globalThis.reduce=reduceLsAttempts;',box);
 const next={...box.rt.autoLs,maxAttempts:4,configSig:signature(4)};return {...f,box,next,calls:()=>calls};
}
test('parent consumes canonical atomic result and marks own config change',async()=>{const f=parent();assert.equal((await f.box.reduce(f.next)).ok,true);assert.equal(f.calls(),1);assert.equal(f.box.cfg.autoLs.maxAttempts,4);assert.equal(f.box.rt.autoLs.maxAttempts,4);assert.equal(f.box.OWN_CFG[0].patch.autoLs.maxAttempts,4);});
for(const kind of ['Stop','owner','context','pending','storageFailure'])test('parent does not request reduction after '+kind,async()=>{const f=parent();if(kind==='Stop')f.box.on=false;if(kind==='owner')f.box.tabOwner=false;if(kind==='context')f.box.automationGeneration++;if(kind==='pending')f.box.rt.autoLs.pending={};if(kind==='storageFailure')f.box.rtCommit=async()=>false;assert.equal((await f.box.reduce(f.next)).ok,false);assert.equal(f.calls(),0);});
for(const kind of ['Stop','owner','character','generation','newSeries','pending','paused','attempts','weapon','signature'])test('late atomic response cannot replace local state after '+kind,async()=>{
 const f=parent(),before=structuredClone(f.box.cfg);let release;f.box.ipc=()=>new Promise(r=>{release=r});const p=f.box.reduce(f.next);await new Promise(r=>setImmediate(r));
 if(kind==='Stop')f.box.on=false;if(kind==='owner')f.box.tabOwner=false;if(kind==='character')f.box.rt.char='other';if(kind==='generation')f.box.automationGeneration++;if(kind==='newSeries')f.box.rt.autoLs={...f.box.rt.autoLs,id:'new'};if(kind==='pending')f.box.rt.autoLs={...f.box.rt.autoLs,pending:{kind:'supply'}};if(kind==='paused')f.box.rt.autoLs={...f.box.rt.autoLs,status:'paused'};if(kind==='attempts')f.box.rt.autoLs={...f.box.rt.autoLs,attempts:2};if(kind==='weapon')f.box.rt.autoLs={...f.box.rt.autoLs,weapon:'changed'};if(kind==='signature')f.box.rt.autoLs={...f.box.rt.autoLs,configSig:'changed'};
 release({ok:true,cfg:{...before,autoLs:{...before.autoLs,maxAttempts:4}},autoLs:f.next});assert.equal((await p).ok,false);assert.equal(f.box.cfg.autoLs.maxAttempts,10);
});
