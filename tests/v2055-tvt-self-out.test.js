'use strict';
// 20.55 (лог 24.10 03:00:05–03:05:29): павший в TvT (combat/sync self.alive=false, отказ tvt_attacker_dead) — выбывание из этого
// события сразу, без свежего GET /game/tvt: нет петли chat ↔ арена и ожидания «живых врагов нет» на арене.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../modules/tvt.js'),'utf8');
function make(){
 let now=1900000000000;
 const loc={pathname:'/chat.html',search:'',href:''};
 const sb={console,Date:class extends Date{static now(){return now;}},location:loc,document:{querySelectorAll:()=>[]}};sb.globalThis=sb;
 vm.runInNewContext(src,sb);
 const recs=[];
 const env={cfg:{tvtOn:true,zoneAuto:true,fishMode:false},on:true,tabOwner:true,
 rt:{tvtIn:'ev',tvt:{eventId:'ev',phase:'ACTIVE',isRegistered:true,myTeam:1,startsAt:now-60000,t:now-30000}},TVT:null,TVTC:{},TVTS:{},
 $q:()=>null,shown:e=>!!e&&!e.hidden,isBattle:()=>false,rec:(...a)=>recs.push(a.join(' ')),setStatus(){},autonomyMode:()=>'farm',pause:async()=>{},fire(){},
 sleep:async()=>{},rnd:()=>0,waitX:async f=>f(),setRt:async p=>Object.assign(env.rt,p)};
 return {loc,env,recs,T:sb.L2V7Factories.tvt(env)};
}
test('до правки: без selfCombat записанный герой в чате снова идёт на арену',()=>{
 const {T}=make();assert.equal(T.tvtSoon(),true);
});
test('выбывание после reload в чате — сразу к делу, без арены',async()=>{
 const {env,T,loc,recs}=make();
 assert.equal(T.tvtSelfOut('ev','тест'),true);
 assert.equal(env.rt.tvt.selfCombat.alive,false);assert.equal(T.tvtSoon(),false);assert.equal(T.tvtHold(),false);
 await T.tvtStep();assert.equal(env.rt.tvtDone,'ev');assert.equal(loc.href,'/map.html');
 assert.ok(recs.some(r=>/выбыл из боя/.test(r)));
});
test('выбывание видно и в странице (env.TVT) — бой на арене завершается',async()=>{
 const {env,T,loc}=make();loc.pathname='/tvt-arena.html';env.TVT={...env.rt.tvt,t:Date.now()};
 T.tvtSelfOut(undefined,'отказ удара');assert.equal(env.TVT.selfCombat.alive,false);assert.equal(T.tvtState().eliminated,true);
 await T.tvtStep();assert.equal(env.rt.tvtDone,'ev');assert.equal(loc.href,'/map.html');
});
test('ответ другого события не трогает текущее',()=>{
 const {env,T}=make();assert.equal(T.tvtSelfOut('old-ev'),false);assert.equal(env.rt.tvt.selfCombat,undefined);assert.equal(T.tvtSoon(),true);
});
test('content: combat/sync без воскрешения и tvt_attacker_dead зовут tvtSelfOut',()=>{
 const c=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 assert.match(c,/self\?\.alive === false && !d\.res\.self\.respawnAt && d\.res\.eventId\) L2V7Modules\.tvt\.tvtSelfOut/);
 assert.match(c,/tvt_attacker_dead'\) L2V7Modules\.tvt\.tvtSelfOut/);
});
