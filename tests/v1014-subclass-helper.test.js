'use strict';
// 10.0.14: реальная цепочка «запрос основного → помощник → команда письма Маммона» без отправки игроку.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'../modules/'+n+'.js'),'utf8');
function fixture() {
 const sb={console,sessionStorage:{getItem(){},setItem(){}},location:{pathname:'/map.html'}};
 for(const n of ['subclass','story','mammon'])vm.runInNewContext(read(n),sb);
 const shared={},env={cfg:{subMainNick:'Main',subHelpMain:true,mmOrders:false},rt:{},heroNick:()=> 'Helper',invQty:id=>id===1869?4:0,
  sharedSet:async(k,v)=>{shared[k]=v},sharedGet:async k=>shared[k],setRt:async p=>Object.assign(env.rt,p),rec(){},FARM:{res:{}},ITEMS:{},
  mammon:{farmPlanPt:(_p,raws)=>({goal:{key:'iron ore',why:'Маммон: Main — Iron Ore',raws}})}};
 const S=sb.L2V7Factories.subclass(env),M=sb.L2V7Factories.mammon({...env,handWant:n=>S.handWant(n)});
 return {env,shared,S,M,story:sb.L2V7Factories.story(env)};
}
test('смена основного не отправляет сырьё предыдущему адресату из кэша',()=>{
 const {env,S,M}=fixture();env.rt.subNeed={nick:'OldMain',t:Date.now(),goal:'Belt',items:[[1869,'Iron Ore',20,1]]};env.rt.subHandReq={t:Date.now()};
 assert.equal(M.want(),null);assert.equal(S.helpGoal(),null);assert.equal(S.handover(),null);assert.ok(S.handWant().drop);
});
test('новый ответ выбранного основного → фарм → ручное письмо ограничено сумкой и недостачей',async()=>{
 const {env,shared,S,M}=fixture();shared.subNeed={nick:'Main',t:Date.now(),goal:'Belt',items:[[1869,'Iron Ore',3,1]]};
 await S.needRead();assert.equal(S.helpGoal().help,'Main');env.rt.subHandReq={t:Date.now()};const w=M.want();
 assert.equal(w.to,'Main');assert.equal(w.hand,1);assert.equal(w.cmd,true);assert.deepEqual(JSON.parse(JSON.stringify(w.items)),[[1869,3,'Iron Ore']]);
});
test('чужой/просроченный shared ответ не создаёт передачу, одинаковый ник без учёта регистра допустим',async()=>{
 for(const v of [{nick:'Other',t:Date.now()},{nick:'Main',t:Date.now()-8*86400000}]){const {env,shared,S}=fixture();shared.subNeed={...v,items:[[1869,'Iron Ore',3,1]]};await S.needRead();env.rt.subHandReq={t:Date.now()};assert.ok(S.handWant().drop);}
 const {env,S}=fixture();env.rt.subNeed={nick:'MAIN',t:Date.now(),items:[[1869,'Iron Ore',3,1]]};assert.equal(S.handover().to,'MAIN');
});
test('смена класса маг → крафтер → спойлер → маг переключает способности и возвращает собственную память',()=>{
 const {env,S,story}=fixture();env.rt.classCur={prof:'human_warlock',slot:0};env.rt.skills={blaze:{n:3}};
 story.classNote('dwarf_warsmith',1,40);assert.equal(S.craftSelf(),true);assert.equal(S.spoilFirst(),false);assert.equal(env.rt.skills,null);
 env.rt.skills={hammer:{n:2}};story.classNote('dwarf_bounty_hunter',2,40);assert.equal(S.craftSelf(),false);assert.equal(S.spoilFirst(),true);
 env.cfg.subSpoilFirst=false;assert.equal(S.spoilFirst(),false);story.classNote('human_warlock',0,75);assert.equal(env.rt.skills.blaze.n,3);assert.equal(S.craftSelf(),false);assert.equal(S.spoilFirst(),false);
});
