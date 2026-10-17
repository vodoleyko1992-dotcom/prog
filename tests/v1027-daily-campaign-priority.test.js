'use strict';
// 15.10, журнал10:52: ежедневная рыбалка не прерывает незавершённую кампанию.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../modules/dailies.js'),'utf8');
function make(kind='fish'){
 const loc={pathname:'/dion-campaign.html',href:''},writes=[],logs=[];
 const ctx={Date,location:loc,sessionStorage:{getItem(){return null},setItem(){}}};vm.createContext(ctx);vm.runInContext(src,ctx);
 const env={on:true,tabOwner:true,cfg:{dailyAuto:true,fishMode:false,rbHuntMode:false,epicMode:false,catMode:false,zoneAuto:true},rt:{manualKickAt:10,daily:{day:'20261015',t:Date.now(),tasks:kind==='fish'?{fishing_catch_50:{need:50,have:0,done:false}}:{strong_enemy_20:{need:1,have:0,done:false}}}},
  gameGet:async()=>({ok:true,json:async()=>({unlocked:true,fishingSpot:{purchased:true},fishingTime:{canFish:true,remainingMs:3600000}})}),
  isBattle:()=>false,fishState:()=>null,campEnabled:()=>false,awayFree:()=>true,fishNow:()=>env.cfg.fishMode,heroLevel:()=>75,
  setRt:async p=>Object.assign(env.rt,p),setCfg:async p=>{writes.push(p);Object.assign(env.cfg,p)},rec:(...a)=>logs.push(a),sleep:async()=>{},setStatus(){}};
 const fresh=()=>ctx.L2V7Factories.dailies(env);
 return {env,loc,writes,logs,D:fresh(),fresh};
}
function saved(env,key='dailyFish',entering=false){
 const d={day:'20261015',t:Date.now(),need:50,got:0,k0:0,entering,prev:{fishMode:false,rbHuntMode:false,epicMode:false,catMode:false,zoneAuto:true}};
 env.rt[key]=d;env.cfg[key==='dailyFish'?'fishMode':'rbHuntMode']=!entering;env.cfg.zoneAuto=entering;return d;
}
for(const kind of ['fish','rb'])for(const phase of ['цели24/40','чтение главы','все цели выполнены, сдача','автокампания','разовая проверка','сюжетный маршрут'])test(kind+': дейлик ждёт — '+phase,async()=>{
 const {env,D,writes}=make(kind);
 if(phase==='автокампания')env.campEnabled=()=>true;
 else if(phase==='разовая проверка')Object.assign(env.rt,{campOnce:true,campaignDue:true});
 else if(phase==='сюжетный маршрут')env.rt.storyJob={step:'claim'};
 else {env.cfg.campaign=true;env.rt.campaign={targets:phase==='чтение главы'?[]:[{name:'Ol Mahum Guerilla',done:24,total:40,ok:phase.includes('все цели')}]};}
 assert.equal(await D.dailyStep(),false);assert.equal(writes.length,0);assert.equal(env.rt.dailyFish,undefined);assert.equal(env.rt.dailyRb,undefined);assert.equal(env.rt.dailyDone,undefined);
});
for(const key of ['dailyFish','dailyRb'])for(const entering of [true,false])test(key+': reload старого дейлика уступает кампании, entering='+entering,async()=>{
 const {env,loc,fresh}=make();env.cfg.campaign=true;saved(env,key,entering);if(key==='dailyFish')loc.pathname='/fishing.html';
 assert.equal(await fresh().dailyStep(),true);assert.equal(env.rt[key],null);assert.equal(env.cfg.fishMode,false);assert.equal(env.cfg.rbHuntMode,false);assert.equal(env.cfg.zoneAuto,true);assert.equal(env.cfg.campaign,true);
 assert.equal(loc.href,key==='dailyFish'?'/map.html':'');
});
test('рыба на крючке завершается, затем возврат кампании без нового заброса',async()=>{
 const {env,D,loc}=make();env.cfg.campaign=true;saved(env).readyUntil=Date.now()+300000;loc.pathname='/fishing.html';env.fishState=()=>({hp:20});
 assert.equal(await D.dailyStep(),false);assert.ok(env.rt.dailyFish);assert.equal(loc.href,'');
 env.fishState=()=>null;assert.equal(await D.dailyStep(),true);assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,false);
});
test('бой рейдового дейлика завершается до возврата кампании',async()=>{
 const {env,D}=make('rb');env.cfg.campaign=true;saved(env,'dailyRb');env.isBattle=()=>true;
 assert.equal(await D.dailyStep(),false);assert.ok(env.rt.dailyRb);env.isBattle=()=>false;assert.equal(await D.dailyStep(),true);assert.equal(env.cfg.rbHuntMode,false);
});
for(const point of ['запись задания','смена режима'])test('кампания включена во время await: '+point,async()=>{
 const {env,D,logs}=make();
 if(point==='запись задания'){const set=env.setRt;env.setRt=async p=>{await set(p);if(p.dailyFish)env.cfg.campaign=true};}
 else {const set=env.setCfg;env.setCfg=async p=>{await set(p);if(p.fishMode)env.cfg.campaign=true};}
 await D.dailyStep();assert.equal(env.cfg.fishMode,false);assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.campaign,true);assert.ok(!logs.some(a=>a.join(' ').includes('иду на рыбалку')));
});
for(const why of ['Stop','потеря вкладки'])test(why+' при возврате: reload завершает прежний режим без раннего перехода',async()=>{
 const {env,D,loc,fresh}=make();env.cfg.campaign=true;saved(env);loc.pathname='/fishing.html';const set=env.setCfg;
 env.setCfg=async p=>{await set(p);if(why==='Stop')env.on=false;else env.tabOwner=false};
 await D.dailyStep();assert.ok(env.rt.dailyFish);assert.equal(loc.href,'');env.on=env.tabOwner=true;env.setCfg=set;
 await fresh().dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(loc.href,'/map.html');
});
test('новый ручной режим во время возврата не перезаписывается',async()=>{
 const {env,D,loc}=make();env.cfg.campaign=true;saved(env);loc.pathname='/fishing.html';const set=env.setCfg;
 env.setCfg=async p=>{await set(p);env.rt.manualKickAt=11;env.rt.dailyFish=null;env.cfg.fishMode=true;env.cfg.campaign=false;};
 await D.dailyStep();assert.equal(env.cfg.fishMode,true);assert.equal(loc.href,'');
});
test('новый manualKick после reload снимает только старое задание',async()=>{
 const {env,D,writes}=make();env.cfg.campaign=true;const F=saved(env);F.kick=9;env.cfg.rbHuntMode=true;
 await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(writes.length,0);assert.equal(env.cfg.rbHuntMode,true);
});
for(const goal of [false,true])test('ручная/квестовая рыбалка без dailyFish сохранена, цель='+goal,async()=>{
 const {env,D,loc,writes}=make();env.cfg.fishMode=true;env.cfg.campaign=true;if(goal)env.rt.fishTgt={type:'fish',n:50,got:2,t:Date.now()};loc.pathname='/fishing.html';
 assert.equal(await D.dailyStep(),false);assert.equal(env.cfg.fishMode,true);assert.equal(writes.length,0);assert.equal(loc.href,'');
});
for(const campaign of [false,true])test('явная рыбная цель, назначенная после старта дейлика, сохраняется, campaign='+campaign,async()=>{
 const {env,D,loc,writes}=make();env.cfg.campaign=campaign;const F=saved(env);env.rt.fishTgt={type:'fish',n:100,got:2,t:F.t+1};loc.pathname='/fishing.html';
 await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,true);assert.equal(env.rt.fishTgt.n,100);assert.equal(writes.length,0);assert.equal(loc.href,'');
});
test('без кампании обычный дейлик ловит и возвращается как прежде',async()=>{
 const {env,D,loc}=make();await D.dailyStep();assert.equal(env.cfg.fishMode,true);assert.equal(env.rt.dailyFish.kick,10);
 env.rt.dailyFish.got=50;loc.pathname='/fishing.html';await D.dailyStep();assert.equal(env.cfg.fishMode,false);assert.equal(env.cfg.zoneAuto,true);assert.equal(env.rt.dailyFish,null);assert.equal(loc.href,'/map.html');
});
for(const why of ['не изучены навыки','нет места','нет времени','ошибка сервера','неизвестные поля'])test('preflight без лишних трат: '+why,async()=>{
 const {env,D,writes,logs}=make();let gets=0;
 const data={unlocked:true,fishingSpot:{purchased:true},fishingTime:{canFish:true,remainingMs:3600000}};
 if(why==='не изучены навыки')data.unlocked=false;
 if(why==='нет места')data.fishingSpot.purchased=false;
 if(why==='нет времени'){data.fishingTime.remainingMs=0;data.fishingTime.canFish=false;env.cfg.fishTimeAuto=true;}
 env.gameGet=async p=>{assert.equal(p,'/game/fishing/state');gets++;return {ok:why!=='ошибка сервера',json:async()=>why==='неизвестные поля'?{}:data}};
 assert.equal(await D.dailyStep(),false);assert.equal(writes.length,0);assert.ok(!env.rt.dailyFish);assert.ok(!env.rt.dailyDone);assert.equal(env.cfg.fishMode,false);
 await D.dailyStep();assert.equal(gets,1,'отказ не опрашивается каждый тик');assert.equal(logs.length,1);
 env.rt.dailyFishCheck.t-=5*60000;await D.dailyStep();assert.equal(gets,2,'после паузы готовность перечитывается');
});
for(const entering of [true,false])test('старый dailyFish без готовой рыбалки возвращается без fishSetup, entering='+entering,async()=>{
 const {env,D,loc}=make();saved(env,'dailyFish',entering);loc.pathname='/fishing.html';env.gameGet=async()=>({ok:true,json:async()=>({unlocked:false})});
 await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,false);assert.equal(env.cfg.zoneAuto,true);assert.equal(loc.href,'/map.html');
});
test('старый готовый dailyFish подтверждается один раз и продолжается',async()=>{
 const {env,D}=make();saved(env,'dailyFish',true);let gets=0;const get=env.gameGet;env.gameGet=async p=>{gets++;return get(p)};
 await D.dailyStep();assert.ok(env.rt.dailyFish.readyUntil>Date.now());assert.equal(env.cfg.fishMode,false);
 await D.dailyStep();assert.equal(env.cfg.fishMode,true);assert.equal(env.rt.dailyFish.entering,false);await D.dailyStep();assert.equal(gets,1);
});
for(const campaign of [false,true])for(const paid of [false,true])test('legacy с рыбой читает срок: кампания='+campaign+', оплачено='+paid,async()=>{
 const {env,D,loc}=make();env.cfg.campaign=campaign;saved(env);env.fishState=()=>({hp:20});loc.pathname='/fishing.html';let gets=0;
 env.gameGet=async()=>{gets++;return {ok:true,json:async()=>({unlocked:true,fishingSpot:{purchased:true},fishingTime:{canFish:paid,remainingMs:paid?300000:0}})}};
 await D.dailyStep();assert.equal(gets,1);
 if(paid){assert.ok(env.rt.dailyFish.readyUntil>Date.now());assert.equal(env.cfg.fishMode,true);assert.equal(loc.href,'');assert.equal(await D.dailyStep(),false);assert.equal(gets,1);}
 else{assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,false);assert.equal(loc.href,'/map.html');}
});
test('завершённый legacy-дейлик возвращается без ненужного preflight',async()=>{
 const {env,D}=make();saved(env).got=50;env.gameGet=async()=>{throw Error('лишний GET')};
 await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.zoneAuto,true);
});
for(const why of ['Stop','вкладка','кампания','ручная рыбалка','новый герой'])test('preflight не действует после изменения контекста: '+why,async()=>{
 const {env,D,writes}=make();const get=env.gameGet;env.gameGet=async p=>{
  if(why==='Stop')env.on=false;else if(why==='вкладка')env.tabOwner=false;else if(why==='кампания')env.cfg.campaign=true;
  else if(why==='новый герой')env.rt.char='Other';else {env.rt.manualKickAt++;env.cfg.fishMode=true;}
  return get(p);
 };
 await D.dailyStep();assert.equal(writes.length,0);assert.ok(!env.rt.dailyFish);assert.ok(!env.rt.dailyFishCheck);
});
// 20.12 (решение игрока 17.10 10:56: «тур по РБ не должен быть авто включённым»): после неподготовленной рыбалки РБ-дейлик тур тоже не включает
test('неподготовленная рыбалка не включает рыбалку, РБ-дейлик тур РБ не включает',async()=>{
 const {env,D}=make();env.rt.daily.tasks.strong_enemy_20={have:0,need:1,done:false};env.gameGet=async()=>({ok:true,json:async()=>({unlocked:false})});
 await D.dailyStep();assert.equal(env.cfg.fishMode,false);assert.equal(env.cfg.rbHuntMode,false);assert.ok(!env.rt.dailyRb);
});
for(const campaign of [false,true])for(const hooked of [false,true])test('закончено уже оплаченное время: возврат вместо автопокупки, рыба='+hooked+', кампания='+campaign,async()=>{
 const {env,D,loc}=make();env.cfg.fishTimeAuto=true;env.cfg.campaign=campaign;const F=saved(env);F.readyUntil=Date.now()-1;loc.pathname='/fishing.html';
 if(hooked)env.fishState=()=>({hp:20});
 await D.dailyStep();assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.fishMode,false);assert.equal(loc.href,'/map.html');
});
const {world}=require('./v1014-fishing-controls.test.js');
for(const remaining of ['00:05:00','00:00:00'])test('настоящий fishTimeTopUp не покупает время dailyFish, осталось '+remaining,async()=>{
 const W=world({rt:{dailyFish:{need:50}},cfg:{fishTimeAuto:true,fishTimeMin:10}});W.remain=remaining;
 assert.equal(await W.F.fishTimeTopUp(),false);assert.equal(W.clicks.length,0);assert.ok(!W.env.rt.fishTimeBuyAt);
});
test('ручная рыбалка по-прежнему докупает время при пороге10мин',async()=>{
 const W=world({cfg:{fishTimeAuto:true,fishTimeMin:10}});W.remain='00:05:00';assert.equal(await W.F.fishTimeTopUp(),true);assert.equal(W.clicks.length,1);
});
test('dailyFish появился во время await: покупка времени не нажимается',async()=>{
 const W=world({cfg:{fishTimeAuto:true,fishTimeMin:10}});W.remain='00:05:00';const set=W.env.setRt;W.env.setRt=async p=>{await set(p);W.env.rt.dailyFish={need:50}};
 assert.equal(await W.F.fishTimeTopUp(),false);assert.equal(W.clicks.length,0);
});
test('настоящий fishSetup не учит навыки и не покупает место для dailyFish',async()=>{
 const W=world({rt:{dailyFish:{need:50}},cfg:{fishAutoSetup:true}});let reads=0;W.env.waitX=async()=>{reads++;return true};
 const fishSrc=fs.readFileSync(path.join(__dirname,'../modules/fishing.js'),'utf8'),a=fishSrc.indexOf('async function fishSetup()'),b=fishSrc.indexOf('\nasync function fishing()',a);
 assert.ok(a>0&&b>a);await vm.runInNewContext('('+fishSrc.slice(a,b)+')()', {env:W.env,location:W.location});
 assert.equal(reads,0);assert.equal(W.clicks.length,0);
});
test('ручной рыболовный режим с нуля preflight не ограничивает',async()=>{
 const {env,D}=make();env.cfg.fishMode=true;env.gameGet=async()=>{throw Error('preflight не должен запрашиваться')};
 assert.equal(await D.dailyStep(),false);assert.equal(env.cfg.fishMode,true);assert.ok(!env.rt.dailyFishCheck);
});
