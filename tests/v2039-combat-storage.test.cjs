'use strict';
// Лог20.10 10:43UTC: бой уже выигран, а следующий моб ждёт сохранения статистики.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createPatchQueue}=require('../engine-core.js');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const drain=async()=>{for(let i=0;i<100;i++)await Promise.resolve()};
function storage(rt){
 const pending=[],batches=[],saved={};let writable=true,now=0;
 const q=createPatchQueue(p=>{batches.push(JSON.parse(JSON.stringify(p)));return new Promise(resolve=>pending.push((ok=true)=>{if(ok)Object.assign(saved,p);resolve({ok})}))},()=>writable,()=>{},()=>now);
 const setRt=p=>{Object.assign(rt,p);return q.enqueue(p)};
 return{q,pending,batches,saved,setRt,setWritable:v=>writable=v,advance:ms=>now+=ms,release:async(ok=true)=>{const ack=pending.shift();assert.ok(ack,'должна быть запись в полёте');ack(ok);await drain()},flush:async()=>{for(let i=0;i<20&&pending.length;i++){pending.shift()();await drain()}assert.equal(pending.length,0)}};
}
function lootFixture(kind){
 const rt={spoilStat:{},synthetic:'x'.repeat(1300*1024)},sink=storage(rt),logs=[];
 let lines=[];
 const b={title:kind==='single'?'Spoil':'Spoil Festival'};
 const env={rt,cfg:{nSpoil:'Spoil',nSpoilMass:kind==='single'?'':'Spoil Festival'},cleanTitle:s=>s,names:s=>s.split(',').map(x=>x.trim().toLowerCase()),slotsBy:n=>n===b.title.toLowerCase()?[b]:[],ready:()=>true,meMp:()=>({cur:1000}),skillMp:()=>171,extraMobs:()=>[],logLines:()=>lines.slice(),mobSpoiled:()=>lines.length>0,newLines:(a,z)=>z.filter(x=>!a.includes(x)),waitFor:async fn=>fn(),nameLike:(a,b)=>a===b,SPOIL_OK:/успіх/,SPOIL_FAIL:/промах/,SPOIL_LOOT:/Спойл: (.+) ×(\d+)/,rec:(...a)=>logs.push(a),$q:()=>null,setRt:sink.setRt};
 const box={console,Date};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/loot.js'),'utf8'),box);
 const loot=box.L2V7Factories.loot(env),ctx={name:'Mob',block:{},logStart:[]};
 const act=async()=>{lines=[kind==='single'?'Spoil: успіх (100%)':'Spoil Festival: Mob: успіх (100%)'];return true};
 const run=()=>{if(kind==='sweep'){ctx.spoiled=true;lines=['Спойл: Coal ×3'];return loot.sweepStep(ctx)}return kind==='single'?loot.spoilStep(ctx,act,{max:1000,cur:1000}):loot.massSpoilStep(ctx,act,{max:1000,cur:1000})};
 return{rt,sink,ctx,logs,run};
}
for(const kind of ['mass','single','sweep'])test(kind+': подтверждённый спойл не ждёт медленный диск или более позднюю статистику',async()=>{
 const f=lootFixture(kind);let done=false;const run=f.run().then(()=>done=true);await drain();
 try{
  assert.equal(done,true,'действие закончено до ACK статистики');
  assert.equal(f.ctx.spoiled,true);assert.ok(f.sink.q.peek().spoilStat);
  assert.equal(f.sink.saved.spoilStat,undefined,'медленный диск ещё не ответил');
  const observer=f.sink.q.enqueue({skills:{whirlwind:{uses:1}}});
  const final=f.sink.q.recover();let durable=false;final.then(()=>durable=true);
  await f.sink.release();assert.equal(done,true);assert.equal(durable,false,'финальный барьер всё ещё ждёт накопленные данные');
  await f.sink.flush();await Promise.all([run,observer,final]);
  assert.equal(durable,true);assert.equal(JSON.stringify(f.sink.saved.spoilStat),JSON.stringify(f.rt.spoilStat));
  assert.equal(f.sink.saved.skills.whirlwind.uses,1);
  if(kind==='mass')assert.equal(f.rt.spoilStat.mass,1);
  if(kind==='single')assert.equal(f.rt.spoilStat.ok,1);
  if(kind==='sweep')assert.equal(f.rt.spoilStat.items.Coal,3);
 }finally{await f.sink.flush()}
});
test('настоящий battle учитывает соседа без дискового барьера, затем ждёт сохранения перед следующим боем',async()=>{
 const f=flowFixture('fighter'),{env}=f;Object.assign(env.rt,{panelSig:'',synthetic:'x'.repeat(1300*1024)});
 const sink=storage(env.rt);env.setRt=sink.setRt;
 env.extraKillsInLog=arr=>arr.some(l=>l==='Coal ×2')?[{name:'Side Mob',exp:5,sp:2,adena:3,items:[]}]:[];
 let reachedNext=false,navigated=false;
 env.nextFight=async()=>{reachedNext=true;await sink.q.recover();if(env.on&&env.tabOwner)navigated=true};
 let done=false;const run=f.combat.battle().then(()=>done=true);await drain();
 try{
  assert.equal(reachedNext,true,'учёт соседа не задерживает расчёт победы');
  assert.equal(env.rt.kills,2);assert.equal(env.rt.exp,5);assert.equal(env.rt.sp,2);assert.equal(env.rt.adena,3);
  assert.equal(navigated,false);assert.equal(done,false,'финальный барьер сохранён');
  await sink.flush();await run;assert.equal(navigated,true);assert.equal(sink.saved.kills,2);
 }finally{await sink.flush()}
});
test('отказ записи сохраняет подтверждённый спойл в очереди и повторяет только сохранение',async()=>{
 const f=lootFixture('mass');let done=false;const run=f.run().then(()=>done=true);await drain();
 try{
  assert.equal(done,true);const saved=f.sink.q.recover();await f.sink.release(false);
  assert.equal((await saved).ok,false);assert.equal(f.sink.saved.spoilStat,undefined);assert.equal(f.sink.q.peek().spoilStat.mass,1);
  f.sink.advance(3001);const retry=f.sink.q.recover();await drain();await f.sink.flush();assert.equal((await retry).ok,true);
  await run;assert.equal(f.sink.saved.spoilStat.mass,1);assert.equal(f.ctx.massTried,true);
 }finally{await f.sink.flush()}
});
