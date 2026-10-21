'use strict';
// 20.12 (ревизия 17.10, аудит PAY-1/H1/M5): неизвестная оплата блокирует только платные шаги; бесплатная работа на месте
// (бой и цепочка, фарм точки, рыбалка из сумки) идёт; сторож прогресса считает такую паузу честным ожиданием.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),src=read('content.js');
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i+1);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return src.slice(i,j)};
test('actions.dispatch: при неизвестной оплате сверка раз в 15 с, а бесплатная работа вызывается каждый тик',async()=>{
 const box={};vm.runInNewContext(read('modules/actions.js'),box);
 let pending={id:'p1',kind:'shop'},reconciles=0,free=[];
 const env={on:true,tabOwner:true,rt:{},cfg:{},mode:()=> 'farm',lease:()=>1,interrupted:()=>false,jobs:()=>[],paymentPending:()=>pending,isBattle:()=>false,victory:()=>false,page:()=> '/map.html',
  reconcile:async()=>{reconciles++},freeWork:async p=>{free.push(p.id)},setRt:async()=>({ok:true}),rtCommit:async()=>true,rec(){}};
 const A=box.L2V7Factories.actions(env);
 assert.equal(await A.dispatch(),true);assert.equal(await A.dispatch(),true);
 assert.equal(reconciles,1);assert.deepEqual(free,['p1','p1']);
 pending=null;assert.equal(await A.dispatch(),false);assert.equal(free.length,2);
});
test('actions.dispatch: при капче бесплатная работа не начинается',async()=>{
 const box={};vm.runInNewContext(read('modules/actions.js'),box);let free=0;
 const env={on:true,tabOwner:true,rt:{},cfg:{},mode:()=> 'farm',lease:()=>1,interrupted:()=>false,jobs:()=>[],paymentPending:()=>({id:'p'}),isBattle:()=>false,page:()=> '/map.html',
  reconcile:async()=>{},freeWork:async()=>{free++},challengeHold:()=>true};
 const A=box.L2V7Factories.actions(env);assert.equal(await A.dispatch(),true);assert.equal(free,0);
});
function freeStep(o={}){
 const calls=[],now=Date.now();
 const box={Date,on:true,tabOwner:true,rt:{},cfg:{zoneAuto:false},calls,
  autonomyMode:()=>o.mode||'farm',antibotState:()=>null,abHold:()=>false,L2V7Modules:{pvp:{pending:()=>false}},
  isBattle:()=>!!o.battle,isFishing:()=>!!o.fishing,fishState:()=>!!o.fish,fishNow:()=>!!o.fishing,isMap:()=>!o.battle&&!o.fishing,
  farmRbOn:()=>false,campOn:()=>false,lootGoal:()=>null,setStatus(){},
  battle:async()=>calls.push('battle'),fishFight:async()=>calls.push('fishFight'),fishing:async()=>calls.push('fishing'),map:async()=>calls.push('map')};
 vm.runInNewContext(cut('const PAY_HOLD_KINDS','// Только выбранная рыбалка'),box);return {box,calls,now};
}
test('бесплатный шаг: бой доводится, фарм на месте идёт при неизвестном телепорте катакомб',async()=>{
 {const f=freeStep({battle:true});assert.equal(await f.box.paymentFreeStep({kind:'cat-teleport',at:f.now}),true);assert.deepEqual(f.calls,['battle'])}
 {const f=freeStep();assert.equal(await f.box.paymentFreeStep({kind:'cat-teleport',at:f.now}),true);assert.deepEqual(f.calls,['map'])}
 {const f=freeStep({fishing:true});assert.equal(await f.box.paymentFreeStep({kind:'mammon',at:f.now}),true);assert.deepEqual(f.calls,['fishing'])}
});
test('бесплатный шаг: закупка/рыбалка/РБ первые 3 мин стоят (сверка по неизменному состоянию), потом фарм идёт',async()=>{
 for(const kind of ['shop','fishing','raid-teleport']){
  const f=freeStep();assert.equal(await f.box.paymentFreeStep({kind,at:f.now-10000}),false,kind);assert.deepEqual(f.calls,[]);
  assert.equal(await f.box.paymentFreeStep({kind,at:f.now-181000}),true,kind);assert.deepEqual(f.calls,['map']);
 }
 {const f=freeStep({fishing:true});assert.equal(await f.box.paymentFreeStep({kind:'fishing',at:f.now-181000}),false,'своя оплата рыбалки — не ловим');}
});
test('бесплатный шаг: перелёты, автофарм зон, заточка и Stop — без бесплатной работы',async()=>{
 const P={kind:'cat-teleport',at:0};
 {const f=freeStep();f.box.cfg.zoneAuto=true;assert.equal(await f.box.paymentFreeStep(P),false)}
 {const f=freeStep();f.box.rt.zoneGo={id:'x'};assert.equal(await f.box.paymentFreeStep(P),false)}
 {const f=freeStep({mode:'raid'});assert.equal(await f.box.paymentFreeStep(P),false)}
 {const f=freeStep({mode:'enchant'});assert.equal(await f.box.paymentFreeStep(P),false)}
 {const f=freeStep();f.box.on=false;assert.equal(await f.box.paymentFreeStep(P),false)}
 {const f=freeStep();assert.equal(await f.box.paymentFreeStep({kind:'enchant',at:0}),false)}
});
function fireBox(page){
 const box={on:true,tabOwner:true,location:{pathname:page},PointerEvent:class{},MouseEvent:class{},window:{},
  L2V7Modules:{actions:{canAct:()=>true},payments:{blocked:()=>true,consumePermit:()=>false},pvp:{pending:()=>false}},
  isBattle:()=>false,isMap:()=>page==='/map.html',isFishing:()=>page==='/fishing.html',abHold:()=>false,invBusy:false,running:false,rt:{},$q:()=>null};
 vm.runInNewContext(cut('const PAY_FREE_MAP','// Single-writer settings update'),box);return box;
}
const el=(sel,slot)=>({fired:0,dataset:{},matches:s=>s.split(',').map(x=>x.trim()).includes(sel),closest:s=>slot&&s==='.l2-fishing-hotbar-slot'?{dataset:{slot}}:null,
 scrollIntoView(){},getBoundingClientRect:()=>({left:0,top:0,width:1,height:1}),dispatchEvent(){this.fired++}});
test('fire: при неизвестной оплате моб карты и листание списка нажимаются, телепорт и магазин — нет',()=>{
 const b=fireBox('/map.html');
 assert.equal(b.fire(el('#map-mob-list a.l2-map-mob-link')),true);assert.equal(b.fire(el('#map-mob-page-next')),true);
 assert.equal(b.fire(el('.l2-rb-row__tp')),false);assert.equal(b.fire(el('.l2-gm-shop-buy')),false);
});
test('fire: рыбалка из сумки (заброс, подсечка, наживка) разрешена, покупка места/времени — нет',()=>{
 const b=fireBox('/fishing.html');
 for(const s of ['fishing','pumping','reeling','basicBait'])assert.equal(b.fire(el('.l2-fishing-hotbar-slot',s)),true,s);
 assert.equal(b.fire(el('#fishing-spot-buy')),false);assert.equal(b.fire(el('[data-offer]')),false);
 const town=fireBox('/town.html');assert.equal(town.fire(el('#map-mob-list a.l2-map-mob-link')),false,'не на карте — не бесплатно');
});
test('сторож прогресса: неизвестная оплата — не «нет прогресса»; платные походы не начинаются',async()=>{
 assert.match(src,/const activeJob = !L2V7Modules\.payments\?\.pending\?\.\(\) && \(/);
 // 20.43 (ревью au/breather): + selfHoldMain — основная работа на передышке баффы под себя не покупает
 const box={cfg:{},rt:{},L2EngineCore:{selectedTask:()=> 'farm'},L2V7Modules:{payments:{blocked:()=>true},buffs:{townBuffStart:async()=>true}},selfHoldMain:()=>false};
 vm.runInNewContext(src.match(/^async function townBuffStart\(.*$/m)[0],box);assert.equal(await box.townBuffStart('баффов нет'),false);
 box.L2V7Modules.payments.blocked=()=>false;assert.equal(await box.townBuffStart('баффов нет'),true);
 box.selfHoldMain=()=>true;assert.equal(await box.townBuffStart('баффов нет'),false,'передышка основной работы — набор не покупаем');
 assert.match(cut('async function magisterStart(','async function magisterStep'),/payments\?\.blocked\?\.\(\)\) return false/);
 const mf=read('modules/mobfarm.js');assert.match(mf,/if \(env\.rt\.shop && !payHold\)/);assert.match(mf,/if \(!payHold && \(low \|\| \(oreDue/);
});
console.log('PASS: v2012-pay-free-work');
