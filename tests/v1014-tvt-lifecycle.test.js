'use strict';
// 14.10: текущая игра (tvt-arena-lifecycle/combat.js, v=ef25c9538ce4) при ACTIVE + selfCombat.alive=false
// выводит погибшего в /chat.html; повторного входа в это событие быть не должно. Stop — не итог TvT.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../modules/tvt.js'),'utf8');
function make(){
 let now=1900000000000;
 const loc={pathname:'/tvt-arena.html',search:'',href:''};
 const sb={console,Date:class extends Date{static now(){return now;}},location:loc,document:{querySelectorAll:()=>[]}};sb.globalThis=sb;
 vm.runInNewContext(src,sb);
 const env={cfg:{tvtOn:true,zoneAuto:true,fishMode:false},rt:{},on:true,tabOwner:true,
 TVT:{eventId:'event-1',phase:'ACTIVE',isRegistered:true,myTeam:2,startsAt:now-30000,endsAt:now+600000,t:now},TVTC:{},TVTS:{},
 $q:()=>null,shown:e=>!!e&&!e.hidden,isBattle:()=>false,rec(){},setStatus(){},autonomyMode:()=>env.cfg.fishMode?'fish':'farm',pause:async()=>{},fire(){},
 sleep:async()=>{now+=1000;env.on=false},rnd:()=>0,waitX:async f=>f(),setRt:async p=>Object.assign(env.rt,p)};
 return {loc,env,T:sb.L2V7Factories.tvt(env),advance:n=>{now+=n}};
}
for(const why of ['Stop','потеря вкладки','выключение TvT'])test(why+' внутри активного TvT не записывает итог и не меняет страницу',async()=>{
 const {env,T,loc}=make();let waits=0;env.sleep=async()=>{if(why==='Stop')env.on=false;else if(why==='потеря вкладки')env.tabOwner=false;else env.cfg.tvtOn=false;if(++waits>2)env.on=false;};
 await T.tvtStep();assert.equal(env.rt.tvtDone??null,null);assert.equal(env.rt.tvtIn,'event-1');assert.equal(loc.href,'');
 env.on=true;env.tabOwner=true;env.cfg.tvtOn=true;assert.equal(T.tvtSoon(),true,'повторный Старт продолжает событие');
});
test('12 минут работы обработчика не подменяют серверный итог ACTIVE',async()=>{
 const {env,T,loc,advance}=make();env.sleep=async()=>advance(13*60000);await T.tvtStep();
 assert.equal(env.rt.tvtDone??null,null);assert.equal(loc.href,'');assert.equal(T.tvtSoon(),true);
});
for(const fish of [false,true])test('текущее выбывание → '+(fish?'рыбалка':'автофарм')+' без петли arena/chat',async()=>{
 const {env,T,loc}=make();loc.pathname='/chat.html';env.cfg.fishMode=fish;env.cfg.zoneAuto=!fish;const cfg=JSON.stringify(env.cfg);
 env.TVT.selfCombat={alive:false,hp:0};env.rt.tvtIn='event-1';env.sleep=async()=>{};
 assert.equal(T.tvtSoon(),false);assert.equal(T.tvtHold(),false);await T.tvtStep();
 assert.equal(env.rt.tvtDone,'event-1');assert.equal(env.rt.tvtIn,null);assert.equal(loc.href,fish?'/fishing.html':'/map.html');assert.equal(JSON.stringify(env.cfg),cfg);
 loc.pathname=loc.href;loc.href='';assert.equal(await T.tvtStep(),false);assert.equal(loc.href,'','уже завершённое участие не запускает новый переход');
 env.TVT={...env.TVT,eventId:'event-2',selfCombat:{alive:true},startsAt:env.TVT.startsAt+1000};assert.equal(T.tvtSoon(),true,'новое событие доступно');
});
test('после reload запись selfCombat текущего события предотвращает возврат на арену',async()=>{
 const {env,T,loc}=make();env.rt.tvt={...env.TVT,selfCombat:{alive:false}};env.TVT=null;loc.pathname='/chat.html';env.sleep=async()=>{};
 assert.equal(T.tvtSoon(),false);await T.tvtStep();assert.equal(env.rt.tvtDone,'event-1');assert.notEqual(loc.href,'/tvt-arena.html');
});
test('старый TVTC.self=false не приклеивается к новому событию',()=>{
 const {env,T}=make();env.TVTC={self:{alive:false},t:1};env.TVT.selfCombat={alive:true};assert.equal(T.tvtSoon(),true);
});
test('старое selfCombat=false в регистрации не означает выбывание из нового события',()=>{
 const {env,T}=make();env.TVT={...env.TVT,phase:'REGISTRATION',selfCombat:{alive:false}};assert.equal(T.tvtState().eliminated,false);
});
for(const fish of [false,true])test('серверный FINISHED возвращает прежний '+(fish?'fish':'auto'),async()=>{
 const {env,T,loc}=make();env.cfg.fishMode=fish;env.cfg.zoneAuto=!fish;env.rt.tvtIn='event-1';env.TVT.phase='FINISHED';env.sleep=async()=>{};const cfg=JSON.stringify(env.cfg);
 await T.tvtStep();assert.equal(env.rt.tvtDone,'event-1');assert.equal(env.rt.tvtIn,null);assert.equal(loc.href,fish?'/fishing.html':'/map.html');assert.equal(JSON.stringify(env.cfg),cfg);
});
test('Stop во время загрузки регистрации не нажимает и не уводит со страницы',async()=>{
 const {env,T,loc}=make();env.TVT={...env.TVT,phase:'REGISTRATION',isRegistered:false,myTeam:null};let clicked=0;env.fire=()=>clicked++;
 env.waitX=async()=>{env.on=false;return {id:'tvt-register-btn'}};await T.tvtStep();assert.equal(clicked,0);assert.equal(loc.href,'');
});
