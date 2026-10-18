'use strict';
// 18.10: медленный cast и обновление не должны терять исходную revision и требовать ручного заброса.
const test=require('node:test'),assert=require('node:assert/strict');
const {world}=require('./v1014-fishing-controls.test.js');
const KEY='l2bot.fishingCastRequest';
function fixture(){
 const W=world({cfg:{fishMode:true,fishTimeAuto:false}}),e=W.env;W.remain='05:36:43';
 Object.assign(e.rt,{char:'Hero',manualKickAt:0,fishCastPending:{char:'Hero',at:W.box.Date.now()-10000,bait:'basic',before:100,pre:[],refreshed:true}});
 e.tabOwner=true;e.leaseEpoch=7;e.canRun=()=>true;e.canAct=()=>true;e.payments={blocked:()=>false};
 const values=new Map();Object.assign(W.box.sessionStorage,{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)});
 W.values=values;W.posts=[];W.state={revision:64043,target:null};W.character={name:'Hero',id:'hero-id',revision:64043};
 e.setRt=async p=>{Object.assign(e.rt,p);return{ok:true}};e.gameGet=async p=>({ok:true,json:async()=>p==='/character'?{character:W.character}:W.state});e.gamePost=async(p,b)=>{W.posts.push({p,b});return{ok:true}};
 W.receipt=(patch={})=>({char:'Hero',at:e.rt.fishCastPending.at,armedAt:e.rt.fishCastPending.at+100,requestAt:e.rt.fishCastPending.at+150,requestRevision:64042,...patch});
 W.saveReceipt=patch=>values.set(KEY,JSON.stringify(W.receipt(patch)));return W;
}
test('квитанция переживает reload: старый успешный cast закрывается без повторной наживки и ручного клика',async()=>{
 const W=fixture();W.saveReceipt();W.env.cfg.rec=false;let journal=0;W.env.castEvidence=async()=>{journal++;return null};
 await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending.requestRevision,64042);assert.equal(journal,0);assert.equal(W.posts.length,0);
 W.F=W.box.L2V7Factories.fishing(W.env);await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.env.rt.fish.nobite,0);assert.equal(W.posts.length,0);
 assert.equal(await W.F.castReconcile(),false);assert.equal(W.env.rt.fish.casts,1);
});
for(const [name,patch] of Object.entries({otherChar:{char:'Other'},otherAttempt:{at:1},missingRevision:{requestRevision:null},negativeRevision:{requestRevision:-1},stringRevision:{requestRevision:'64042'},beforeArmed:{requestAt:1},expired:{requestAt:1800000006000},future:{requestAt:1800000000001},badArmed:{armedAt:1}}))test('чужая или некорректная квитанция не разрешает повтор: '+name,async()=>{
 const W=fixture();W.saveReceipt(patch);await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending.requestRevision,undefined);assert.equal(W.posts.length,0);
});
test('сохранение квитанции после Stop не продолжает восстановление',async()=>{
 const W=fixture();W.saveReceipt();const save=W.env.setRt;W.env.setRt=async p=>{const r=await save(p);W.env.on=false;return r};await W.F.castReconcile();assert.equal(W.posts.length,0);assert.equal(W.reloads,0);assert.ok(W.env.rt.fishCastPending);
});
test('поздний netStart во время чтения журнала сохраняет актуальную revision и остальные поля',async()=>{
 const W=fixture();W.env.castEvidence=async()=>{W.F.castRequestNote({path:'/game/fishing/action',method:'POST',req:{action:'cast',expectedRevision:64042}});W.env.rt.fishCastPending={...W.env.rt.fishCastPending,retryAt:123};return{revision:64041}};
 await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending.requestRevision,64042);assert.equal(W.env.rt.fishCastPending.retryAt,123);assert.equal(W.posts.length,0);
});
test('ошибка commit не выдаётся за подтверждённое восстановление из журнала',async()=>{
 const W=fixture();W.env.castEvidence=async()=>({revision:64042});W.env.rtCommit=async()=>false;await W.F.castReconcile();assert.ok(!W.logs.some(s=>/revision.*восстановлена/.test(s)));assert.equal(W.posts.length,0);
});
test('потерянный req в netStart восполняется точным запросом позднего ответа в прежнем контексте',async()=>{
 const W=fixture(),p=W.env.rt.fishCastPending;W.F.castResponseNote('/game/fishing/action',{method:'POST',req:{action:'cast',expectedRevision:64042}},{char:'Hero',lease:7,at:p.at+150});
 await Promise.resolve();assert.equal(W.env.rt.fishCastPending.requestRevision,64042);await W.F.castReconcile();assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.posts.length,0);
});
for(const [name,patch] of Object.entries({actor:{char:'Other'},lease:{lease:8},old:{at:1},late:{at:1800000006000}}))test('ответ чужого запроса не связывается с pending: '+name,async()=>{
 const W=fixture(),p=W.env.rt.fishCastPending;W.F.castResponseNote('/game/fishing/action',{method:'POST',req:{action:'cast',expectedRevision:64042}},{char:'Hero',lease:7,at:p.at+150,...patch});assert.equal(W.env.rt.fishCastPending.requestRevision,undefined);
});
test('новый intent вооружает квитанцию только после подтверждённого сохранения и до native-клика',async()=>{
 const W=fixture();W.env.rt.fishCastPending=null;let armed;
 W.env.fire=b=>{if(b?.kind==='fishing'){armed=JSON.parse(W.values.get(KEY)||'null');W.env.on=false;}return true};
 await W.F.fishing();assert.equal(armed?.char,'Hero');assert.equal(armed.at,W.env.rt.fishCastPending.at);assert.equal(armed.armedAt,W.box.Date.now());
});
test('неподтверждённая запись intent не вооружает запрос и не кликает',async()=>{
 const W=fixture();W.env.rt.fishCastPending=null;W.env.rtCommit=async()=>false;await W.F.fishing();assert.equal(W.values.has(KEY),false);assert.equal(W.clicks.length,0);
});
