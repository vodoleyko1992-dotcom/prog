'use strict';
// 20.13 (ревизия 17.10, шаг 5, services): ECO-1 — закупка, где купить нечего, не повторяется каждые 10 мин;
// ACT-1 — цикл одного служебного маршрута снимает только его, а не выключает бота целиком.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function economy(rt={}){
 const recs=[],nav=[];
 const box={location:{pathname:'/gm-shop.html',search:'?cat=consumable&grade=NG',set href(v){nav.push(v)}},document:{querySelectorAll:()=>[]},URLSearchParams};
 vm.runInNewContext(src('modules/economy.js'),box);
 const env={rt:{char:'Hero',...rt},cfg:{shopAuto:true},on:true,setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rec:(...a)=>recs.push(a.join(' ')),setStatus(){},
  $q:s=>s==='.l2-gm-shop-adena__amount'?{textContent:'150 000'}:s==='.l2-gm-shop-row'?{}:null,waitX:async f=>f(),sleep:async()=>{},rnd:a=>a,
  pair:(v,d)=>String(v||d).split('/').map(Number),BSPS_IDS:{NG:3947},SHOT_IDS:{NG:1835},isBattle:()=>false,autonomyMode:()=>'farm',slotsBy:()=>[],
  rtCommit:async()=>true,classWeaponTypes:()=>({types:['mage']}),combatProfileKind:()=>'mage',MAGE:'mage',SLOT:'.x',GRADE_LV:{},heroLevel:()=>50};
 return {M:box.L2V7Factories.economy(env),env,recs,nav};
}
const MIN=60000;
test('ECO-1: «не хватает адены» по всем позициям — пауза закупки растёт 10 → 30 → 60 → 180 мин',async()=>{
 const f=economy();assert.equal(f.M.shopGap(),10*MIN);
 const gaps=[];
 for(let i=0;i<5;i++){
  f.env.rt.shop={step:'buy',t:Date.now(),need:[{key:'hp',label:'Банки HP',buy:700,grade:'NG'}],done:[{key:'hp',ok:false,label:'Банки HP',qty:0,why:'не хватает адены (резерв 75 000)'}]};
  await f.M.shopStep();assert.equal(f.env.rt.shop,null);gaps.push(f.M.shopGap()/MIN);
 }
 assert.deepEqual(gaps,[10,30,60,180,180]);assert.equal(f.env.rt.shopFail.adena,150000);
 assert.ok(f.recs.some(r=>/следующая попытка не раньше чем через 30 мин/.test(r)));
});
test('ECO-1: удачная покупка, «всё есть» и рост адены возвращают обычные 10 мин',async()=>{
 const f=economy({shopFail:{n:3,t:Date.now()-1000,adena:150000}});assert.equal(f.M.shopGap(),60*MIN);
 f.env.rt.adenaSeen={v:250000,t:Date.now()};assert.equal(f.M.shopGap(),10*MIN,'адены стало ≥ ×1,2 + 50 тыс.');
 f.env.rt.adenaSeen={v:160000,t:Date.now()};assert.equal(f.M.shopGap(),60*MIN,'мелкий рост не сбрасывает');
 f.env.rt.shop={step:'buy',t:Date.now(),need:[{key:'hp',label:'Банки HP',buy:700,grade:'NG'},{key:'mp',label:'Банки MP',buy:10,grade:'NG'}],done:[{key:'hp',ok:true,label:'Банки HP',qty:700},{key:'mp',ok:false,label:'Банки MP',why:'не хватает адены'}]};
 await f.M.shopStep();assert.equal(f.env.rt.shopFail,null);assert.equal(f.M.shopGap(),10*MIN);
});
test('ECO-1: временный сбой (окно не открылось) паузу не растит и не сбрасывает',async()=>{
 const f=economy({shopFail:{n:2,t:Date.now(),adena:1}});
 f.env.rt.shop={step:'buy',t:Date.now(),need:[{key:'hp',label:'Банки HP',buy:700,grade:'NG'}],done:[{key:'hp',ok:false,label:'Банки HP',why:'окно покупки не открылось'}]};
 await f.M.shopStep();assert.equal(f.env.rt.shopFail.n,2);
});
test('ECO-1 (ревью): «нет в магазине (видел: пусто)» — список не отрисовался, паузу не растит',async()=>{
 const f=economy({shopFail:{n:1,t:Date.now(),adena:1}});
 f.env.rt.shop={step:'buy',t:Date.now(),need:[{key:'hp',label:'Банки HP',buy:700,grade:'NG'}],done:[{key:'hp',ok:false,label:'Банки HP',why:'нет в магазине (видел: пусто)'}]};
 await f.M.shopStep();assert.equal(f.env.rt.shopFail.n,1);assert.equal(f.M.shopGap(),10*MIN);
 f.env.rt.shop={step:'buy',t:Date.now(),need:[{key:'hp',label:'Банки HP',buy:700,grade:'NG'}],done:[{key:'hp',ok:false,label:'Банки HP',why:'нет в магазине (видел: Зілля, Заряд)'}]};
 await f.M.shopStep();assert.equal(f.env.rt.shopFail.n,2,'товар правда не найден в отрисованном списке — пауза растёт');
});
test('ECO-1: все вызовы закупки уважают паузу, смена оружия её сбрасывает, геттеры есть',()=>{
 const mob=src('modules/mobfarm.js'),raid=src('modules/raid.js'),content=src('content.js');
 assert.match(mob,/> \(env\.shopGap\?\.\(\) \?\? 600000\)\) \{ const low0/);
 assert.match(mob,/const low = since > shopGap \?/);
 assert.match(mob,/since > Math\.max\(3600000, shopGap\)/);
 assert.match(raid,/< \(env\.shopGap\?\.\(\) \?\? 600000\)\) return false;/);
 assert.match(content,/\{shopT:0,shopFail:null\}/);
 assert.match(content,/L2V7Factories\.mobfarm\(\{ get shopGap\(\)\{return \(\)=>L2V7Modules\.economy\.shopGap\(\)\}/);
 assert.match(content,/L2V7Factories\.raid\(\{ get shopGap\(\)\{return \(\)=>L2V7Modules\.economy\.shopGap\(\)\}/);
});
function actions(saved={}){
 const box={Date,JSON,Object,Proxy};vm.runInNewContext(src('modules/actions.js'),box);
 let page='/map.html';const calls=[],recs=[];
 const env={rt:{char:'Hero',...saved},cfg:{},on:true,tabOwner:true,mode:()=>'farm',lease:()=>'a',page:()=>page,id:()=>String(Math.random()),
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,rec:(...a)=>recs.push(a.join(' ')),setStatus(){},halt:async s=>{calls.push('halt:'+s);env.on=false},isBattle:()=>false,interrupted:()=>false,
  paymentPending:()=>null,reconcile:async()=>{},jobs:()=>['tbuff','shop','invScan','rbHunt','zoneGo'].map(key=>({key,run:async()=>calls.push(key)}))};
 const A=box.L2V7Factories.actions(env);A.enterFrame();
 return {A,env,calls,recs,page:v=>page=v};
}
async function loop(f,key,value){f.env.rt[key]=value;for(let i=0;i<14&&f.env.on&&f.env.rt[key];i++){f.page(i%2?'/map.html':'/x.html');await f.A.dispatch();}}
test('ACT-1: цикл магазина снимает только магазин и ставит паузу закупки; остальные маршруты целы',async()=>{
 const f=actions();await loop(f,'shop',{step:'buy',t:1});
 assert.equal(f.env.on,true);assert.equal(f.env.rt.shop,null);assert.equal(f.env.rt.actionOwner,null);
 assert.ok(Date.now()-f.env.rt.shopT<5000);assert.equal(f.env.rt.shopFail.n,1);
 assert.ok(f.recs.some(r=>/маршрут shop снят \(1\/3 за час\), остальные задачи продолжаются/.test(r)));
 f.env.rt.zoneGo={id:'z'};await f.A.dispatch();assert.equal(f.calls.at(-1),'zoneGo','следующий маршрут работает');
});
test('ACT-1: цикл баффера отмечает прерванный бафф; третий цикл за час — полная остановка',async()=>{
 const f=actions();await loop(f,'tbuff',{step:'fa',t:7});
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.tbInterrupted.jobT,7);assert.equal(f.env.on,true);
 await loop(f,'tbuff',{step:'fa',t:8});assert.equal(f.env.on,true);
 await loop(f,'tbuff',{step:'fa',t:9});assert.equal(f.env.on,false);assert.ok(f.calls.some(c=>/^halt:.*3-й раз за час/.test(c)));
});
test('ACT-1: старые отметки циклов (старше часа) не копятся',async()=>{
 const f=actions({actionLoops:{invScan:[Date.now()-2*3600000,Date.now()-90*MIN]}});await loop(f,'invScan',{t:1,step:'scan'});
 assert.equal(f.env.on,true);assert.equal(f.env.rt.actionLoops.invScan.length,1);
});
test('ACT-1: выход тура РБ (rbHunt) по-прежнему останавливает сразу — это состояние тура, не маршрут',async()=>{
 const f=actions({rbHunt:{step:'exit',phase:'exit'}});f.env.rt.rbHunt={step:'exit',phase:'exit'};
 for(let i=0;i<14&&f.env.on;i++){f.page(i%2?'/map.html':'/x.html');await f.A.dispatch();}
 assert.equal(f.env.on,false);assert.ok(f.env.rt.rbHunt);
});
