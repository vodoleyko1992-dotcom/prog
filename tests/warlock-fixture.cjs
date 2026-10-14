'use strict';
const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../modules/warlock.js'),'utf8');
const rawCatalog=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/warlock-buffer-catalog.json'),'utf8'));
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(o={}){
 let now=1792000000000,calls=[],gets=[],writes=[],once=0;
 const env={on:true,tabOwner:true,cfg:{petFullAuto:true,shopReserve:200000,...o.cfg},rt:{char:'hero',classCur:{prof:'human_warlock',slot:0},...copy(o.rt||{})},
 townBufferReady:()=>true,heroNick:()=>env.rt.char,isBattle:()=>!!o.battle,victory:()=>!!o.win,fishState:()=>!!o.fish,tvtHold:()=>!!o.tvt,abHold:()=>!!o.abHold,antibotState:()=>o.antibot||null,
 rec(){},setRt:p=>{Object.assign(env.rt,p);writes.push(copy(p));o.write?.(p,env);return Promise.resolve({ok:true})},rtCommit:async()=>{o.commit?.(env);return o.durable!==false}};
 const ch={name:'hero',level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},revision:100,adena:'20000000',inBattle:false,
 activeSummon:{kind:'servitor',key:'kai_the_cat',summonSkillId:1276,summonSkillLevel:10,hp:2898,maxHp:4366,pAtk:2688,accuracy:70,critRate:650,critDmgMul:2.44,activeBuffs:[]},...copy(o.char||{})};
 const cat=copy(rawCatalog);o.catalog?.(cat);
 const set=()=>cat.sets.find(x=>x.id==='summon');
 const apply=()=>{ch.revision++;ch.adena=String(+ch.adena-+set().feeAdena);ch.activeSummon.activeBuffs=set().skills.map(x=>({skillId:x.skillId,level:x.level,expiresAtMs:now+x.durationSec*1000,remainingSec:x.durationSec}))};
 env.gameGet=async path=>{gets.push(path);await o.read?.(path,env,ch,++once);return {ok:true,status:200,json:async()=>copy(path==='/character'?{character:ch}:cat)}};
 env.gamePost=async(path,body)=>{assert.ok(env.on&&env.tabOwner);calls.push({path,body:copy(body)});const special=await o.post?.(env,ch,apply);if(special)return special;if(o.reject)return {ok:false,status:o.reject,json:async()=>({})};if(o.apply!==false)apply();return {ok:true,status:200,json:async()=>({set:'summon',feeAdena:set().feeAdena,feeCoinOfLuck:0,...o.receipt})}};
 let api;const load=()=>{const box={console,Date:class extends Date{static now(){return now}},globalThis:null};box.globalThis=box;vm.runInNewContext(source,box);api=box.L2V7Factories.warlock(env)};load();
 return {env,ch,cat,calls,gets,writes,apply,step:opt=>api.step(opt),api:()=>api,tick:n=>now+=n,now:()=>now,reload:load,status:()=>env.rt.petFull?.status,set,archive:()=>api.archiveUnknown({char:env.rt.char,pendingId:env.rt.petFull?.pending?.id,budgetEpoch:env.rt.petFull?.budgetEpoch||0}),reset:()=>api.resetBudget({char:env.rt.char,budgetEpoch:env.rt.petFull?.budgetEpoch||0,spent:env.rt.petFull?.spent||0})};
}
module.exports={fixture};
