'use strict';
// 20.64 (лог 25.10 23:20:51): клик заброса совпал с ручными покупками времени — cast не ушёл, запись без revision,
// бот минуту писал «выполните один заброс вручную». Метка вкладки без квитанции hook дольше 15 с = запроса не было.
const test=require('node:test'),assert=require('node:assert/strict'),{world}=require('./v1014-fishing-controls.test.js');
const KEY='l2bot.fishingCastRequest';
function setup(marker){
  const W=world({cfg:{fishMode:true}}),e=W.env,at=W.box.Date.now(),mem=new Map();
  W.box.sessionStorage.getItem=k=>mem.get(k)??null;W.box.sessionStorage.setItem=(k,v)=>mem.set(k,v);
  if(marker)mem.set(KEY,JSON.stringify(marker(at)));
  Object.assign(e.rt,{char:'Hero',fishCastPending:{char:'Hero',at,bait:'basic',pre:[]},fish:{casts:5}});
  e.tabOwner=true;e.leaseEpoch=1;e.canRun=()=>true;e.rtCommit=async()=>true;e.castEvidence=async()=>null;
  let sends=0;e.gamePost=async()=>{sends++;return{ok:true}};
  e.gameGet=async p=>({ok:true,json:async()=>p==='/character'?{character:{name:'Hero',id:'c1',revision:29618}}:{fishing:{revision:29618,target:null}}});
  return {W,e,at,sends:()=>sends};
}
const wait=async(W,ms)=>{await W.env.sleep(ms);};
test('метка без квитанции дольше 15 с: запись закрыта без повтора и без счёта заброса',async()=>{
  const {W,e,sends}=setup(at=>({char:'Hero',at,armedAt:at+5}));await wait(W,16000);
  await W.F.castReconcile();
  assert.equal(e.rt.fishCastPending,null);assert.equal(e.rt.fish.casts,5);assert.equal(sends(),0);assert.equal(W.reloads,0);
  assert.ok(W.logs.some(l=>/не был отправлен игрой/.test(l)));
});
test('до 15 с запись не закрывается',async()=>{
  const {W,e}=setup(at=>({char:'Hero',at,armedAt:at+5}));await wait(W,9000);
  await W.F.castReconcile();assert.ok(e.rt.fishCastPending);
});
test('квитанция hook (запрос ушёл) — прежний путь, не быстрое закрытие',async()=>{
  const {W,e}=setup(at=>({char:'Hero',at,armedAt:at+5,requestRevision:29617,requestAt:at+10}));await wait(W,16000);
  await W.F.castReconcile();assert.equal(e.rt.fishCastPending?.requestRevision,29617);
});
test('нет метки или чужая попытка — ждём прежние 60 с',async()=>{
  for(const m of [null,at=>({char:'Hero',at:at-1,armedAt:at}),at=>({char:'Other',at,armedAt:at+5})]){
    const {W,e}=setup(m);await wait(W,16000);await W.F.castReconcile();assert.ok(e.rt.fishCastPending,'не закрыто');
  }
});
test('рыба на сервере — запись не закрывается как «не отправлено»',async()=>{
  const {W,e}=setup(at=>({char:'Hero',at,armedAt:at+5}));await wait(W,16000);
  e.gameGet=async p=>({ok:true,json:async()=>p==='/character'?{character:{name:'Hero',id:'c1',revision:29619}}:{fishing:{revision:29619,target:{name:'White Fish'}}}});
  await W.F.castReconcile();assert.ok(!W.logs.some(l=>/не был отправлен/.test(l)));
});
test('статус больше не просит заброс вручную',()=>{
  const s=require('node:fs').readFileSync(__dirname+'/../modules/fishing.js','utf8');assert.ok(!s.includes("выполните один заброс вручную'"));assert.ok(s.includes('не дольше минуты, потом продолжу сам'));
});
