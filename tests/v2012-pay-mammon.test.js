'use strict';
// 20.12 (ревизия 17.10, аудит PAY-2): Маммон — отказ улучшения/телепорта (409, 412, 200 с error) закрывает ожидание
// без списания; без ответа — сверка «уровень, Coin of Luck и адена те же» дважды за ≥2 мин; задание не ждёт снятую оплату вечно.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function fixture(){
 let now=1_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const store=new Map(),sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
 const loc={pathname:'/mammon-blacksmith.html',search:'',href:''},events=[];
 const box={Date:clock,console,URLSearchParams,Math,JSON,sessionStorage,location:loc,document:{documentElement:{dataset:{}},querySelectorAll:()=>[],querySelector:()=>null}};
 vm.runInNewContext(read('modules/payments.js'),box);
 const item={itemId:920018,targetInstanceId:'eq:belt',nameUk:'Пояс',level:0,canAfford:true,cost:{adena:250000,adenaOwned:1000000,coinOfLuck:1,coinOfLuckOwned:3,materials:[]}};
 const ups={status:200,body:{items:[item]}},char={name:'Tank',id:'tank',revision:9,adena:1000000,worldX:0,worldY:0};
 const env={rt:{char:'Tank',manualKickAt:0},cfg:{mmGoalItem:920018,mmGoalLvl:3,mmUpgrade:true},on:true,tabOwner:true,leaseEpoch:3,routeLocation:loc,autonomyMode:()=> 'farm',canRun:()=>true,
  isBattle:()=>false,fishNow:()=>false,rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),sleep:async()=>{},waitX:async f=>f(),
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,
  gameGet:async p=>p==='/game/mammon/blacksmith/upgrades'?{ok:ups.status===200,status:ups.status,json:async()=>JSON.parse(JSON.stringify(ups.body))}:p==='/character'?{ok:true,status:200,json:async()=>({character:{...char}})}:{ok:false,status:404,json:async()=>({})}};
 env.payments=box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/mammon.js'),box);const M=box.L2V7Factories.mammon(env);
 const ctx={char:'Tank',kick:0,mode:'farm'};
 const pay=async(evidence,quote={amount:1,currency:'coin_of_luck'})=>{const p=await env.payments.prepare({key:'mammon:'+evidence.action,kind:'mammon',quote,evidence});assert.ok(p);assert.ok(env.payments.sent(p));return p};
 const upgrade=async()=>{const p=await pay({action:'upgrade',itemId:920018,target:'eq:belt',level:0,adena:250000,materials:[],colOwned:3,adenaOwned:1000000});
  env.rt.mmJob={kind:'smith',up:true,id:'up:920018:0',step:'act',payment:p,paymentAction:'upgrade',clicked:0,tries:1,t:now,context:ctx};return p};
 const teleport=async()=>{const p=await pay({action:'teleport',npc:'smith',home:'zone1',revision:9,adena:1000000,charId:'tank'},{amount:500000,currency:'adena'});
  env.rt.mmJob={kind:'smith',up:true,id:'up:920018:0',step:'act',home:'zone1',payment:p,paymentAction:'teleport',t:now,context:ctx};return p};
 return {env,M,loc,item,ups,char,events,upgrade,teleport,tick:ms=>now+=ms};
}
test('улучшение: 409 своего запроса — отказ, Coin of Luck не списаны, задание продолжает по счётчику попыток',async()=>{
 const f=fixture(),p=await f.upgrade();
 f.M.paymentNote('/game/mammon/blacksmith/upgrade',{method:'POST',status:409,res:{error:'revision_conflict'},paymentId:p.id,req:{targetInstanceId:'eq:belt',expectedLevel:0}});
 assert.equal(await f.M.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'server-rejected');assert.equal(c.spent,0);
 assert.equal(f.env.rt.mmJob.payment,null);assert.equal(f.env.rt.mmJob.tries,1);
});
test('улучшение: 409 чужого запроса не снимает ожидание',async()=>{
 const f=fixture();await f.upgrade();
 f.M.paymentNote('/game/mammon/blacksmith/upgrade',{method:'POST',status:409,res:{error:'x'},paymentId:'other',req:{targetInstanceId:'eq:belt'}});
 assert.equal(await f.M.paymentReconcile(),false);assert.ok(f.env.payments.pending());
});
test('телепорт: 200 с error — отказ без списания, поход закрыт без возврата «домой»',async()=>{
 const f=fixture(),p=await f.teleport();f.ups.status=403;
 f.M.paymentNote('/game/mammon/teleport',{method:'POST',status:200,res:{error:'not_enough_adena'},paymentId:p.id,req:{kind:'blacksmith'}});
 assert.equal(await f.M.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');assert.equal(f.env.rt.mmJob,null);assert.equal(f.env.rt.zoneGo,undefined);
});
test('улучшение без ответа: уровень, CoL и адена те же — через ≥2 мин две сверки, оплата не прошла',async()=>{
 const f=fixture();await f.upgrade();
 assert.equal(await f.M.paymentReconcile(),false);f.tick(125000);assert.equal(await f.M.paymentReconcile(),false);assert.ok(f.env.payments.pending());
 f.tick(31000);assert.equal(await f.M.paymentReconcile(),true);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'state-not-applied');assert.equal(c.spent,0);assert.equal(f.env.rt.mmJob.payment,null);
});
test('улучшение без ответа: Coin of Luck уменьшились — «не прошла» не объявляется',async()=>{
 const f=fixture();await f.upgrade();f.item.cost.coinOfLuckOwned=2;
 for(let i=0;i<8;i++){f.tick(31000);assert.equal(await f.M.paymentReconcile(),false)}
 assert.ok(f.env.payments.pending());
});
test('телепорт без ответа: не рядом, ревизия и адена те же — дважды за ≥2 мин, телепорт не прошёл',async()=>{
 const f=fixture();await f.teleport();f.ups.status=403;
 f.tick(125000);assert.equal(await f.M.paymentReconcile(),false);f.tick(31000);assert.equal(await f.M.paymentReconcile(),true);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'state-not-applied');assert.equal(f.env.rt.mmJob,null);
});
test('mmStep: оплата задания уже снята (кнопка игрока) — телепорт не ждёт её вечно',async()=>{
 const f=fixture();await f.teleport();f.ups.status=403;f.env.rt.actionPayments={...f.env.rt.actionPayments,pending:null};
 assert.equal(await f.M.mmStep(),true);assert.equal(f.env.rt.mmJob,null);assert.equal(f.env.rt.zoneGo,undefined);
});
console.log('PASS: v2012-pay-mammon');
