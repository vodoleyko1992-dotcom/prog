'use strict';
// 20.41 (лог 20.10 22:03): покупка Кристал C для пояса Маммона → HTTP 500 {"message":"inventory_full"}. Бот считал исход
// неизвестным, запрещал все оплаты и стоял в магазине. Теперь это явный отказ: адена не списана, причина «сумка полна».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const FULL={statusCode:500,error:'Internal Server Error',message:'inventory_full'};
function load(){const box={console,Date};vm.runInNewContext(read('modules/payments.js'),box);vm.runInNewContext(read('modules/economy.js'),box);return box;}
test('classify: 500 inventory_full — отказ; обычный 500 и 502 — неизвестно',()=>{
 const b=load(),P=b.L2PayOutcome;
 assert.equal(P.classify({status:500,res:FULL}),'rejected');
 assert.equal(P.classify({status:500,res:{statusCode:500,error:'Internal Server Error',message:'not_enough_adena'}}),'rejected');
 for(const d of [{status:500},{status:500,res:{statusCode:500,error:'Internal Server Error',message:'Internal server error'}},{status:502,res:{error:'bad gateway'}},{status:500,res:{message:'inventory_full; db down'}}])assert.equal(P.classify(d),'unknown',JSON.stringify(d));
});
function shop(net){
 const box=load(),now=Date.now(),pending={id:'own',key:'mm1459',kind:'shop',char:'Hero',at:now-1000,kick:1,phase:'prepared',quote:{currency:'Adena',amount:1800000},evidence:{shopKey:'consumable/resource_crystal_c',qty:600,ids:[1459],beforeQty:0,itemKey:'mm1459',label:'Кристал: ранг C (Маммон)',jobT:100,revision:5,adenaChar:9000000}};
 let reads=0;
 const env={on:true,tabOwner:true,leaseEpoch:7,rt:{char:'Hero',manualKickAt:1,actionPayments:{pending},shop:{t:100,done:[],spent:0}},canRun:()=>true,autonomyMode:()=>'farm',setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},gameGet:async()=>{reads++;return{ok:true,json:async()=>({character:{name:'Hero',revision:5,adena:'9000000',inventory:{stacks:[]}}})}}};
 env.payments=box.L2V7Factories.payments(env);
 env.shopBuyNet=()=>({paymentId:pending.id,t:now,key:'consumable/resource_crystal_c',qty:600,status:net.status,msg:String(net.res?.message||''),outcome:env.payments.classify(net)});
 return{env,api:box.L2V7Factories.economy(env),reads:()=>reads};
}
test('inventory_full снимает блокировку оплаты сразу, без траты и с понятной причиной',async()=>{
 const f=shop({status:500,res:FULL});
 assert.equal(await f.api.paymentReconcile(),true);
 assert.equal(f.reads(),0,'квитанция отказа — без лишнего GET');
 assert.equal(f.env.payments.blocked(),false);
 assert.equal(f.env.rt.shop.spent,0);
 assert.equal(f.env.rt.shop.done[0].ok,false);
 assert.match(f.env.rt.shop.done[0].why,/сумка полна/);
});
test('обычный 500 по-прежнему держит неизвестную оплату',async()=>{
 const f=shop({status:500,res:{statusCode:500,error:'Internal Server Error'}});
 assert.equal(await f.api.paymentReconcile(),false);assert.ok(f.env.payments.blocked());
});
test('ядро сохраняет код отказа в квитанции; «сумка полна» растит паузу закупки',()=>{
 assert.match(read('content.js'),/SHOP_BUY = \{[^\n]*msg: String\(d\.res\?\.message/);
 assert.match(read('modules/economy.js'),/const SHOP_CANT = \/[^\n]*сумка полна/);
});
test('потерянный ответ: ревизия ушла вперёд, запас не вырос и цена не списана — после двух сверок оплата снята',async()=>{
 let now=2_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const box={console,Date:clock};vm.runInNewContext(read('modules/payments.js'),box);vm.runInNewContext(read('modules/economy.js'),box);
 const pending={id:'own',key:'mm1459',kind:'shop',char:'Hero',at:now-1000,kick:1,phase:'sent',quote:{currency:'Adena',amount:1800000},evidence:{shopKey:'consumable/resource_crystal_c',qty:600,ids:[1459],beforeQty:0,itemKey:'mm1459',label:'C',jobT:100,revision:5,adenaChar:9000000}};
 let rev=9,adena='9000000',stock=0;
 const env={on:true,tabOwner:true,leaseEpoch:7,rt:{char:'Hero',manualKickAt:1,actionPayments:{pending},shop:{t:100,done:[],spent:0}},canRun:()=>true,autonomyMode:()=>'farm',setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},shopBuyNet:()=>null,
  gameGet:async()=>({ok:true,json:async()=>({character:{name:'Hero',revision:rev++,adena,inventory:{stacks:stock?[{itemId:1459,qty:stock}]:[]}}})})};
 env.payments=box.L2V7Factories.payments(env);const api=box.L2V7Factories.economy(env);
 now+=130000;assert.equal(await api.paymentReconcile(),false,'первая сверка');
 now+=31000;assert.equal(await api.paymentReconcile(),true,'вторая сверка подряд');
 assert.equal(env.payments.blocked(),false);assert.equal(env.rt.shop.spent,0);assert.equal(env.rt.shop.done[0].ok,false);
});
test('цена списана — даже без роста запаса оплата остаётся неизвестной',async()=>{
 let now=2_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const box={console,Date:clock};vm.runInNewContext(read('modules/payments.js'),box);vm.runInNewContext(read('modules/economy.js'),box);
 const pending={id:'own',key:'mm1459',kind:'shop',char:'Hero',at:now-1000,kick:1,phase:'sent',quote:{currency:'Adena',amount:1800000},evidence:{shopKey:'k',qty:600,ids:[1459],beforeQty:0,itemKey:'mm1459',label:'C',jobT:100,revision:5,adenaChar:9000000}};
 let rev=9;const env={on:true,tabOwner:true,leaseEpoch:7,rt:{char:'Hero',manualKickAt:1,actionPayments:{pending},shop:{t:100,done:[],spent:0}},canRun:()=>true,autonomyMode:()=>'farm',setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},shopBuyNet:()=>null,
  gameGet:async()=>({ok:true,json:async()=>({character:{name:'Hero',revision:rev++,adena:'7200000',inventory:{stacks:[]}}})})};
 env.payments=box.L2V7Factories.payments(env);const api=box.L2V7Factories.economy(env);
 for(let i=0;i<4;i++){now+=i?31000:130000;assert.equal(await api.paymentReconcile(),false);}
 assert.ok(env.payments.blocked());
});
