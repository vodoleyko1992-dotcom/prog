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
// 20.43 (автономность, разбор 21.10): opt.hold — ответ content.selfHoldStart ('defer' | 'stop'); без него — старое ядро без передышек (halt)
function actions(saved={},opt={}){
 const box={Date,JSON,Object,Proxy};vm.runInNewContext(src('modules/actions.js'),box);
 let page='/map.html';const calls=[],recs=[],holds=[];
 const env={rt:{char:'Hero',...saved},cfg:{},on:true,tabOwner:true,mode:()=>'farm',lease:()=>'a',page:()=>page,id:()=>String(Math.random()),
  ...(opt.hold?{selfHold:async(kind,why,o)=>{holds.push({kind,why,o});if(opt.hold==='stop')env.on=false;return opt.hold}}:{}),
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,rec:(...a)=>recs.push(a.join(' ')),setStatus(){},halt:async s=>{calls.push('halt:'+s);env.on=false},isBattle:()=>false,interrupted:()=>false,
  paymentPending:()=>null,reconcile:async()=>{},jobs:()=>['tbuff','shop','invScan','rbHunt','zoneGo'].map(key=>({key,run:async()=>calls.push(key)}))};
 const A=box.L2V7Factories.actions(env);A.enterFrame();
 return {A,env,calls,recs,holds,page:v=>page=v};
}
async function loop(f,key,value){f.env.rt[key]=value;for(let i=0;i<14&&f.env.on&&f.env.rt[key];i++){f.page(i%2?'/map.html':'/x.html');await f.A.dispatch();}}
test('ACT-1: цикл магазина снимает только магазин и ставит паузу закупки; остальные маршруты целы',async()=>{
 const f=actions();await loop(f,'shop',{step:'buy',t:1});
 assert.equal(f.env.on,true);assert.equal(f.env.rt.shop,null);assert.equal(f.env.rt.actionOwner,null);
 assert.ok(Date.now()-f.env.rt.shopT<5000);assert.equal(f.env.rt.shopFail.n,1);
 assert.ok(f.recs.some(r=>/маршрут shop снят \(1\/3 за час\), остальные задачи продолжаются/.test(r)));
 f.env.rt.zoneGo={id:'z'};await f.A.dispatch();assert.equal(f.calls.at(-1),'zoneGo','следующий маршрут работает');
});
// 20.43 (автономность, разбор 21.10): третий цикл за час — уже не полная остановка, а запрет маршрута на 2 ч (actionBan) и пауза сторожа
// баффов; стоп с причиной — 4-я такая отсрочка за 6 ч (selfHold → 'stop'). Без передышек в ядре — прежний стоп (проверка сохранена)
test('ACT-1: цикл баффера отмечает прерванный бафф; третий цикл за час — запрет маршрута на 2 ч, бот работает',async()=>{
 const f=actions({},{hold:'defer'});await loop(f,'tbuff',{step:'fa',t:7});
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.tbInterrupted.jobT,7);assert.equal(f.env.on,true);
 await loop(f,'tbuff',{step:'fa',t:8});assert.equal(f.env.on,true);assert.equal(f.holds.length,0,'первые два цикла — без передышки');
 await loop(f,'tbuff',{step:'fa',t:9});assert.equal(f.env.on,true);assert.ok(!f.calls.some(c=>/^halt:/.test(c)));
 assert.equal(f.holds.length,1);assert.equal(f.holds[0].kind,'route:tbuff');assert.equal(f.holds[0].o.noWait,true);assert.equal(f.holds[0].o.hard,true);
 const b=f.env.rt.actionBan.tbuff;assert.ok(b.until-Date.now()>119*MIN&&b.until-Date.now()<=120*MIN);assert.ok(f.env.rt.tbPauseUntil>=b.until-1000);
 assert.equal(f.env.rt.actionLoops.tbuff.length,0,'после запрета счёт циклов заново');
 assert.ok(f.recs.some(r=>/маршрут tbuff запрещён на 2 ч, остальные задачи продолжаются/.test(r)));
 const g=actions({},{hold:'stop'});for(const t of [7,8,9])await loop(g,'tbuff',{step:'fa',t});
 assert.equal(g.env.on,false);assert.equal(g.env.rt.actionBan,undefined,'4-я отсрочка за 6 ч — стоп с причиной без запрета');
 const h=actions();for(const t of [7,8,9])await loop(h,'tbuff',{step:'fa',t});
 assert.equal(h.env.on,false);assert.ok(h.calls.some(c=>/^halt:.*3-й раз за час/.test(c)),'старое ядро без передышек — прежний стоп');
});
test('ACT-1: старые отметки циклов (старше часа) не копятся',async()=>{
 const f=actions({actionLoops:{invScan:[Date.now()-2*3600000,Date.now()-90*MIN]}});await loop(f,'invScan',{t:1,step:'scan'});
 assert.equal(f.env.on,true);assert.equal(f.env.rt.actionLoops.invScan.length,1);
});
// 20.43 (автономность, разбор 21.10): цикл выхода тура больше не стоп — текущий РБ откладывается на 60 мин (rbSkip.until), тур выбирает
// следующего; стоп с причиной — 4-я такая отсрочка за 6 ч. Без передышек в ядре — прежний немедленный стоп (проверка сохранена)
test('ACT-1: цикл выхода тура РБ (rbHunt) откладывает этот РБ на 60 мин и возвращает тур к выбору цели',async()=>{
 const f=actions({},{hold:'defer'});f.env.rt.rbHunt={step:'exit',phase:'exit',id:'rb1',name:'Босс'};
 for(let i=0;i<14&&f.env.on&&f.env.rt.rbHunt?.step==='exit';i++){f.page(i%2?'/map.html':'/x.html');await f.A.dispatch();}
 assert.equal(f.env.on,true);assert.equal(f.env.rt.rbHunt.step,'pick');assert.equal(f.env.rt.actionOwner,null);
 assert.equal(f.holds.length,1);assert.equal(f.holds[0].kind,'rbExit');assert.equal(f.holds[0].o.noWait,true);
 const sk=f.env.rt.rbSkip.rb1;assert.ok(sk.until-Date.now()>59*MIN&&sk.until-Date.now()<=60*MIN);
 assert.ok(f.recs.some(r=>/Босс отложен на 60 мин, тур выбирает следующую цель/.test(r)));
 const g=actions({rbHunt:{step:'exit',phase:'exit'}});g.env.rt.rbHunt={step:'exit',phase:'exit'};
 for(let i=0;i<14&&g.env.on;i++){g.page(i%2?'/map.html':'/x.html');await g.A.dispatch();}
 assert.equal(g.env.on,false,'старое ядро без передышек — прежний стоп');assert.ok(g.env.rt.rbHunt);
});
