'use strict';
// 20.12 (ревизия 17.10, аудит PAY-3): закупка и рыбалка — ответ 200 с error / ok:false это отказ без списания;
// без квитанции и без прироста запаса — сверка «состояние героя не изменилось» дважды за ≥2 мин снимает ожидание.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function realm(){
 let now=1_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const store=new Map(),sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
 const box={Date:clock,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},sessionStorage,document:{querySelector:()=>null,querySelectorAll:()=>[]},location:{pathname:'/gm-shop.html',search:''}};
 vm.runInNewContext(read('modules/payments.js'),box);return {box,tick:ms=>now+=ms,now:()=>now};
}
function shop(){
 const R=realm();let N=null,ch={name:'Hero',revision:5,adena:1000,inventory:{stacks:[{itemId:3951,qty:3}]}};
 const env={rt:{char:'Hero',manualKickAt:1,shop:{t:123,step:'buy'}},cfg:{},on:true,tabOwner:true,leaseEpoch:1,autonomyMode:()=> 'farm',canRun:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,setStatus(){},rec(){},shopBuyNet:()=>N,
  gameGet:async()=>({ok:true,json:async()=>({character:JSON.parse(JSON.stringify(ch))})})};
 env.payments=R.box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/economy.js'),R.box);const E=R.box.L2V7Factories.economy(env);
 const pay=async(extra={})=>{const p=await env.payments.prepare({key:'shop:shots:A',kind:'shop',quote:{amount:500,currency:'Adena'},evidence:{jobT:123,ids:[3951],beforeQty:3,qty:10,itemKey:'shots',label:'A',shopKey:'consumable/blessed_spiritshot_a',adena:1000,revision:5,adenaChar:1000,...extra}});assert.ok(p);assert.ok(env.payments.sent(p));return p};
 return {...R,env,E,pay,net:x=>N=x,ch:p=>Object.assign(ch,p)};
}
test('закупка: 200 с error — отказ без списания, задача видит «не куплено»',async()=>{
 const f=shop(),p=await f.pay();f.net({paymentId:p.id,t:f.now()+1,key:'consumable/blessed_spiritshot_a',qty:10,status:200,ok:false,outcome:'rejected'});
 assert.equal(await f.E.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');assert.equal(f.env.rt.shop.done[0].ok,false);assert.equal(f.env.rt.shop.spent,0);
});
test('закупка: 502 без прироста запаса — ждём, а через ≥2 мин две сверки «ревизия и адена те же» — не применилась',async()=>{
 const f=shop(),p=await f.pay();f.net({paymentId:p.id,t:f.now()+1,key:'consumable/blessed_spiritshot_a',qty:10,status:502,ok:false,outcome:'unknown'});
 assert.equal(await f.E.paymentReconcile(),false);f.tick(130000);assert.equal(await f.E.paymentReconcile(),false);assert.ok(f.env.payments.pending());
 f.tick(31000);assert.equal(await f.E.paymentReconcile(),true);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'state-not-applied');assert.equal(c.spent,0);
 assert.equal(f.env.rt.shop.done[0].ok,false);assert.match(f.env.rt.shop.done[0].why,/не применилась/);
});
// 20.41: одна выросшая ревизия при том же запасе и той же адене больше не держит оплату (v2041-shop-inventory-full).
test('закупка: адена списана — «не применилась» не объявляется, даже при выросшей ревизии',async()=>{
 for(const patch of [{adena:500},{revision:6,adena:999}]){
  const f=shop();await f.pay();f.ch(patch);
  for(let i=0;i<10;i++){f.tick(31000);assert.equal(await f.E.paymentReconcile(),false,JSON.stringify(patch))}
  assert.ok(f.env.payments.pending());
 }
});
test('закупка: запас вырос — это подтверждение покупки, а не отказ',async()=>{
 const f=shop();await f.pay();f.ch({revision:6,adena:500,inventory:{stacks:[{itemId:3951,qty:13}]}});
 assert.equal(await f.E.paymentReconcile(),true);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'stock-satisfied');
});
function fishing(){
 const R=realm();R.box.location.pathname='/fishing.html';let ch={name:'Hero',id:'hero',revision:7,adena:9000},st={revision:4,fishingSpot:{purchased:false}};
 const env={rt:{char:'Hero',manualKickAt:1},cfg:{},on:true,tabOwner:true,leaseEpoch:1,autonomyMode:()=> 'fish',canRun:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,setStatus(){},rec(){},
  gameGet:async p=>({ok:true,json:async()=>p==='/character'?{character:{...ch}}:{...st}})};
 env.payments=R.box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/fishing.js'),R.box);const F=R.box.L2V7Factories.fishing(env);
 const e={action:'spot',key:'spot',charId:'hero',revision:7,chRev:7,stRev:4,adena:9000,path:'/game/fishing/action',request:{action:'buyFishingSpot'},before:0,gain:1};
 const pay=async(ev=e)=>{const p=await env.payments.prepare({key:'fishing:spot:spot',kind:'fishing',quote:{amount:100,currency:'Adena'},evidence:ev});assert.ok(p);assert.ok(env.payments.sent(p));return p};
 return {...R,env,F,pay,e,ch:p=>Object.assign(ch,p),st:p=>Object.assign(st,p)};
}
test('рыбалка: 200 с error на свою покупку — отказ, ожидание снято',async()=>{
 const f=fishing(),p=await f.pay();
 f.F.paymentNote('/game/fishing/action',{method:'POST',status:200,res:{error:'not_enough_adena'},paymentId:p.id,req:{action:'buyFishingSpot',expectedRevision:7}});
 await f.F.paymentReconcile();assert.equal(f.env.payments.pending(),null);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');
});
test('рыбалка: чужой запрос с error не снимает свою оплату',async()=>{
 const f=fishing();await f.pay();
 f.F.paymentNote('/game/fishing/action',{method:'POST',status:200,res:{error:'x'},paymentId:'other',req:{action:'buyFishingSpot',expectedRevision:7}});
 assert.equal(await f.F.paymentReconcile(),false);assert.ok(f.env.payments.pending());
});
test('рыбалка: ни герой, ни рыбалка не изменились за ≥2 мин (две сверки) — покупка не применилась',async()=>{
 const f=fishing();await f.pay();
 f.tick(125000);assert.equal(await f.F.paymentReconcile(),false);assert.ok(f.env.payments.pending());
 f.tick(31000);await f.F.paymentReconcile();assert.equal(f.env.payments.pending(),null);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'state-not-applied');assert.equal(c.spent,0);
});
test('рыбалка: ревизия рыбалки изменилась — «не применилась» не объявляется',async()=>{
 const f=fishing();await f.pay();f.st({revision:5});
 for(let i=0;i<8;i++){f.tick(31000);assert.equal(await f.F.paymentReconcile(),false)}
 assert.ok(f.env.payments.pending());
});
console.log('PASS: v2012-pay-shop-fishing');
