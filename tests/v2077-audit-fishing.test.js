'use strict';
// 20.76+ (ревизия 28.10, группа «рыбалка»): отказ подготовки оплаты больше не держит бота в магазине/на месте рыбака.
// 1) Цель рыбака (плащ/тату/пояс): адены меньше «цена + резерв» → цель ждёт, как «копим», fishService снимается.
//    Отказ сервера (500 inventory_full) → цель отложена на 30 мин, тот же POST buy-gear на следующем круге не уходит.
// 2) Рыболовное место: подготовка не прошла → fishSoft (причина в журнале, пауза, передача очереди), а не цикл GET без паузы.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const {world}=require('./v1014-fishing-controls.test.js');

// --- 1. Цель рыбака за Proof: настоящие fishing.js + payments.js, магазин рыбака на заглушках ---
function gearShop(o={}){
 const W=world({cfg:{rodEnchantTo:0,fishGoal:'cloak_d'},rt:{char:'Hero',manualKickAt:1,fishService:'exchange',fishSinceProcN:0,...(o.svc?{fishSvc:{stopAfter:true}}:{})}});
 const proof=600,gearBtn={gear:'cloak_d',disabled:false,isConnected:true};let success='',gets=0;
 W.document.querySelectorAll=()=>[];
 const base=W.env.$q;
 W.env.$q=s=>s==='#fishing-shop-proof-qty'?{textContent:String(proof)}:s==='#fishing-shop-success'?{textContent:success}:s.includes('fishing-shop-tab-')?{classList:{contains:()=>true}}
  :s.includes('.l2-fshop-row--exchange')?{}:s.includes('l2-fshop-buy-gear-btn')?gearBtn:base(s);
 W.box.chrome={storage:{local:{set:async v=>{if(v?.on===false)W.env.on=false;}}}};
 Object.assign(W.env,{leaseEpoch:1,tabOwner:true});
 const pbox={Date:W.box.Date,console,Math,JSON};vm.runInNewContext(read('modules/payments.js'),pbox);
 W.env.payments=pbox.L2V7Factories.payments({get rt(){return W.env.rt},setRt:async p=>{Object.assign(W.env.rt,p);return {ok:true}},rtCommit:async()=>true,get on(){return W.env.on},tabOwner:true,canRun:()=>true,autonomyMode:()=> 'fish',rec:(...x)=>W.logs.push(x.join(' '))});
 W.env.gameGet=async p=>{gets++;return {ok:true,json:async()=>p==='/character'
  ?{character:{name:'Hero',id:7,revision:10,adena:String(o.adena),inventory:{stacks:[],eq:{}}}}
  :{revision:5,economy:{proofQty:proof,gearCategories:[{items:[{key:'cloak_d',itemId:999,priceAdena:'500000',priceProof:500,canBuy:true}]}]}}};};
 W.env.fire=b=>{if(b!==gearBtn)return;W.clicks.push(b);
  // Ответ игры на POST buy-gear приходит через сетевой обработчик ядра: отказ 500 inventory_full привязан к своей оплате.
  if(o.reject){const p=W.env.payments.pending();W.F.paymentNote('/game/fishing/buy-gear',{method:'POST',status:500,res:{message:'inventory_full'},paymentId:p.id,req:{gearKey:'cloak_d',expectedRevision:10}});}};
 return {W,gets:()=>gets};
}
test('цель рыбака: адены меньше цены + резерв — цель ждёт, обслуживание снимается, клика нет',async()=>{
 const {W}=gearShop({adena:600000});await W.F.fishExchange();
 assert.equal(W.clicks.length,0);assert.equal(W.env.rt.fishService,null);assert.equal(W.env.payments.pending(),null);
 assert.ok(W.logs.some(l=>/cloak_d: покупка отложена — нужно 500.000 Adena \+ резерв 200.000, есть 600.000/.test(l)),W.logs.join('\n'));
});
test('цель рыбака: «Разделать всю рыбу» со stopAfter завершается и при отложенной цели',async()=>{
 const {W}=gearShop({adena:600000,svc:true});await W.F.fishExchange();
 assert.equal(W.env.rt.fishService,null);assert.equal(W.env.rt.fishSvc,null);assert.equal(W.env.on,false);
});
test('цель рыбака: повторные круги не крутятся в магазине — один заход, без покупок',async()=>{
 const {W,gets}=gearShop({adena:600000});await W.F.fishExchange();const n=gets();
 assert.equal(W.env.rt.fishService,null);assert.equal(n,2);assert.equal(W.clicks.length,0);
});
test('цель рыбака: контроль — хватает адены с резервом, покупка готовится и нажимается',async()=>{
 const {W}=gearShop({adena:5000000});await W.F.fishExchange();
 assert.equal(W.clicks.length,1);assert.ok(W.env.payments.pending());assert.equal(W.env.rt.fishService,'exchange');   // неизвестный исход ждёт сверки
});
test('цель рыбака: отказ сервера 500 inventory_full — цель отложена на 30 мин, тот же POST не повторяется',async()=>{
 const {W}=gearShop({adena:5000000,reject:true});await W.F.fishExchange();
 assert.equal(W.clicks.length,1);assert.equal(W.env.payments.pending(),null);
 assert.equal(W.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');assert.equal(W.env.rt.actionPayments.history[0].confirmation.spent,0);
 assert.ok(Number.isFinite(W.env.rt.fishGearFail?.cloak_d));assert.equal(W.env.rt.fishService,null);
 W.env.rt.fishService='exchange';await W.F.fishExchange();
 assert.equal(W.clicks.length,1,'второй круг в течение 30 мин не нажимает «Купить»');assert.equal(W.env.rt.fishService,null);
 assert.deepEqual(Array.from(W.env.rt.fishGearBought||[]),[]);
 await W.env.sleep(31*60000);W.env.rt.fishService='exchange';await W.F.fishExchange();
 assert.equal(W.clicks.length,2,'через 30 мин цель снова пробуется');
});

// --- 1б. «Покупка не применилась» (две сверки без изменений) тоже откладывает цель ---
test('цель рыбака: «не применилась» при сверке — цель отложена',async()=>{
 let now=1_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const box={Date:clock,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},sessionStorage:{getItem:()=>null,setItem(){}},document:{querySelector:()=>null,querySelectorAll:()=>[]},location:{pathname:'/fishing-shop.html',search:''}};
 vm.runInNewContext(read('modules/payments.js'),box);
 const ch={name:'Hero',id:'hero',revision:7,adena:900000,inventory:{stacks:[],eq:{}}},st={revision:4};
 const env={rt:{char:'Hero',manualKickAt:1},cfg:{},on:true,tabOwner:true,leaseEpoch:1,autonomyMode:()=> 'fish',canRun:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,setStatus(){},rec(){},
  gameGet:async p=>({ok:true,json:async()=>p==='/character'?{character:{...ch}}:{...st}})};
 env.payments=box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/fishing.js'),box);const F=box.L2V7Factories.fishing(env);
 const e={action:'gear',key:'cloak_d',charId:'hero',revision:7,chRev:7,stRev:4,adena:900000,path:'/game/fishing/buy-gear',request:{gearKey:'cloak_d'},itemId:999,before:0,gain:1,proofCost:500};
 const p=await env.payments.prepare({key:'fishing:gear:cloak_d',kind:'fishing',quote:{amount:500000,currency:'Adena'},evidence:e});assert.ok(p);assert.ok(env.payments.sent(p));
 now+=125000;assert.equal(await F.paymentReconcile(),false);assert.ok(env.payments.pending());assert.equal(env.rt.fishGearFail,undefined);
 now+=31000;await F.paymentReconcile();assert.equal(env.payments.pending(),null);
 assert.equal(env.rt.actionPayments.history[0].confirmation.kind,'state-not-applied');assert.equal(env.rt.fishGearFail.cloak_d,now);
});

// --- 2. Рыболовное место: настоящие fishing.js + payments.js, страница /fishing.html с кнопкой покупки места ---
function spotWorld(o={}){
 let now=1_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const store=new Map(),sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
 const spot={id:'fishing-spot-buy',disabled:false,isConnected:true,closest:()=>null};
 const document={querySelector:s=>/fishing-spot-buy/.test(s)?spot:null,querySelectorAll:()=>[],body:{textContent:''}};
 const location={pathname:'/fishing.html',search:'',href:'/fishing.html'};
 const box={Date:clock,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},sessionStorage,document,location};
 vm.runInNewContext(read('modules/payments.js'),box);
 const W={gets:[],fires:0,recs:[],idles:[]};
 const ch={name:'Hero',id:'hero',revision:7,adena:o.adena??10100000,inBattle:false},st={revision:o.sameRev?7:4,target:null,fishingSpot:{purchased:false,priceAdena:10000000,canBuy:true}};
 const env={rt:{char:'Hero',manualKickAt:1},cfg:{shopReserve:200000,autoTasks:['fish','auto']},on:true,tabOwner:true,leaseEpoch:1,autonomyMode:()=> 'fish',canRun:()=>true,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,setStatus(){},rec(...a){W.recs.push(a.join(' '))},
  gameGet:async p=>{W.gets.push(p);o.onGet?.(env);return {ok:true,json:async()=>p==='/character'?{character:{...ch}}:{...st}}},
  $q:s=>document.querySelector(s),shown:e=>!!e,waitX:async f=>f(),waitFor:async f=>f(),sleep:async ms=>{now+=ms},fire:()=>{W.fires++;return true},
  NET_FISH:{},idle:async ms=>{W.idles.push(ms)},halt:()=>{}};
 if(o.alternatives)env.fishTaskWaitKey=()=> 'fish|auto';
 env.payments=box.L2V7Factories.payments(env);
 vm.runInNewContext(read('modules/fishing.js'),box);
 return Object.assign(W,{env,location,F:box.L2V7Factories.fishing(env)});
}
test('место рыбака: адены меньше цены + резерв — пауза с причиной вместо цикла GET без паузы',async()=>{
 const W=spotWorld();await W.F.fishing();
 assert.equal(W.fires,0);assert.equal(W.env.rt.fishSoftN,1);assert.deepEqual(W.idles,[5000]);
 assert.ok(W.recs.some(r=>/рыбалка: пауза Рыбалка: рыболовное место не куплено — нужно 10.000.000 Adena \+ резерв 200.000, есть 10.100.000/.test(r)),W.recs.join('\n'));
 // повтор попадает в лесенку пауз: вторая попытка ждёт дольше, а не крутится каждые 1,5 с
 await W.F.fishing();assert.equal(W.env.rt.fishSoftN,2);assert.deepEqual(W.idles,[5000,10000]);
});
test('место рыбака: при других выбранных задачах очередь передаётся им (taskWait.fish)',async()=>{
 const W=spotWorld({alternatives:true,sameRev:true});await W.F.fishing();
 assert.equal(W.fires,0);assert.ok(W.env.rt.taskWait?.fish);assert.match(W.env.rt.taskWait.fish.why,/рыболовное место не куплено — нужно .* резерв/);
 assert.deepEqual(W.idles,[]);
});
test('место рыбака: игра запрещает покупку (canBuy:false) — тоже пауза с причиной',async()=>{
 const W=spotWorld({adena:20000000});W.env.gameGet=async p=>{W.gets.push(p);return {ok:true,json:async()=>p==='/character'?{character:{name:'Hero',id:'hero',revision:7,adena:20000000}}:{revision:4,fishingSpot:{purchased:false,priceAdena:10000000,canBuy:false}}}};
 await W.F.fishing();assert.equal(W.fires,0);assert.ok(W.recs.some(r=>/рыболовное место не куплено — игра не разрешает покупку/.test(r)),W.recs.join('\n'));
});
test('место рыбака: задача снята во время сверки — без паузы и без покупки',async()=>{
 const W=spotWorld({onGet:env=>{env.cfg.fishAutoSetup=false;}});await W.F.fishing();
 assert.equal(W.fires,0);assert.equal(W.env.rt.fishSoftN,undefined);assert.ok(!W.recs.some(r=>/пауза/.test(r)));
});
test('место рыбака: контроль — хватает адены с резервом, покупка готовится и нажимается',async()=>{
 const W=spotWorld({adena:11000000});await W.F.fishing();
 assert.equal(W.fires,1);assert.ok(W.env.payments.pending());assert.equal(W.env.rt.fishSoftN,undefined);
});
