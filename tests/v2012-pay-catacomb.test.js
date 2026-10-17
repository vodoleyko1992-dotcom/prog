'use strict';
// 20.12 (ревизия 17.10, аудит H2): телепорт в катакомбы — 423/429 и 2xx с error закрывают ожидание как отказ;
// без квитанции сверка по GET /character: прибыл в подземелье — подтверждено, дважды «не там» за ≥2 мин — не применился.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function fixture(){
 let now=1_000_000_000_000,receipt=null,ch={name:'Hero',id:'hero',revision:10,adena:500000,activeDungeonId:null};const statuses=[];
 const clock=class extends Date{static now(){return now}};
 const box={Date:clock,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},document:{querySelector:()=>null,querySelectorAll:()=>[]},location:{pathname:'/catacombs.html',search:''}};
 vm.runInNewContext(read('modules/payments.js'),box);
 const env={rt:{char:'Hero',manualKickAt:1},cfg:{catMode:true},on:true,tabOwner:true,leaseEpoch:1,CAT_URL:'/catacombs.html',autonomyMode:()=> 'cat',canRun:()=>true,canAct:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,setStatus:s=>statuses.push(s),rec(){},catPaymentNet:()=>receipt,
  gameGet:async p=>({ok:true,json:async()=>p==='/character'?{character:{...ch}}:{}})};
 env.payments=box.L2V7Factories.payments(env);
 vm.runInNewContext(read('modules/dungeons.js'),box);const D=box.L2V7Factories.dungeons(env);
 const pay=async()=>{const p=await env.payments.prepare({key:'cat:witch',kind:'cat-teleport',quote:{amount:1,currency:'Adena'},evidence:{id:'witch',revision:10,actorId:'hero'}});assert.ok(p);assert.ok(env.payments.sent(p));return p};
 return {env,D,pay,statuses,tick:ms=>now+=ms,now:()=>now,receipt:r=>receipt=r,ch:patch=>Object.assign(ch,patch)};
}
const base=(f,p,patch)=>({paymentId:p.id,t:f.now()+1,id:'witch',expectedRevision:10,expectedAdenaCost:1,characterName:'Hero',characterId:'hero',...patch});
for(const status of [423,429])test(`ответ ${status} — отказ без списания, ожидание снято`,async()=>{
 const f=fixture(),p=await f.pay();f.receipt(base(f,p,{ok:false,status}));
 assert.equal(await f.D.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');assert.equal(f.env.rt.actionPayments.history[0].confirmation.spent,0);
});
test('200 с error (исход «отказ» по общему правилу) — отказ без списания',async()=>{
 const f=fixture(),p=await f.pay();f.receipt(base(f,p,{ok:false,status:200,outcome:'rejected'}));
 assert.equal(await f.D.paymentReconcile(),true);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');
});
test('502 — исход неизвестен, повтор запрещён',async()=>{
 const f=fixture(),p=await f.pay();f.receipt(base(f,p,{ok:false,status:502,outcome:'unknown'}));
 assert.equal(await f.D.paymentReconcile(),false);assert.ok(f.env.payments.pending());
 assert.equal(await f.env.payments.prepare({key:'cat:x',kind:'cat-teleport',quote:{amount:1,currency:'Adena'}}),null);
});
test('ответа нет, герой уже в подземелье — прибытие подтверждено по GET /character',async()=>{
 const f=fixture();await f.pay();f.tick(16000);f.ch({activeDungeonId:'witch',revision:11});
 assert.equal(await f.D.paymentReconcile(),true);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'target-arrival');
});
test('ответа нет, герой не в подземелье: через ≥2 мин две сверки подряд — телепорт не применился',async()=>{
 const f=fixture();await f.pay();
 f.tick(60000);assert.equal(await f.D.paymentReconcile(),false,'минута — ещё ждём');
 f.tick(70000);assert.equal(await f.D.paymentReconcile(),false,'первая сверка после 2 мин');assert.ok(f.env.payments.pending());
 f.tick(31000);assert.equal(await f.D.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'state-not-applied');assert.equal(c.spent,0);
});
test('смерть после оплаты — не доказательство «не применился»: ожидание остаётся',async()=>{
 const f=fixture(),p=await f.pay();f.env.rt.deathLog=[p.at+5000];
 for(let i=0;i<6;i++){f.tick(31000);assert.equal(await f.D.paymentReconcile(),false)}
 assert.ok(f.env.payments.pending());
});
test('чужой персонаж в ответе GET не снимает ожидание',async()=>{
 const f=fixture();await f.pay();f.ch({name:'Other'});
 for(let i=0;i<8;i++){f.tick(31000);assert.equal(await f.D.paymentReconcile(),false)}
 assert.ok(f.env.payments.pending());
});
console.log('PASS: v2012-pay-catacomb');
