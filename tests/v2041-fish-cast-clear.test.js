'use strict';
// 20.41 (лог 20.10 21:09: память 1,3 МБ, каждая запись ≈0,4–0,75 с): после исхода заброса снятие отметки fishCastPending больше не ждёт
// хранилища — первая Pumping и следующий заброс шли только после полной записи памяти. Проверяем: (a) вываживание начинается, даже если
// запись снятия не подтверждена, память вкладки уже без отметки; (b) Stop сразу после исхода — без Pumping; (c) следующий заброс
// по-прежнему ждёт своей записи намерения и rtCommit, которые дописывают и снятие; (d) снятие и статистика исхода — один пакет записи.
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../engine-core.js');
const {world}=require('./v1014-fishing-controls.test.js');
const pump=async(n=5)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const within=(p,ms=500)=>Promise.race([p.then(()=>'done'),new Promise(r=>setTimeout(()=>r('hung'),ms))]);
const noBite=n=>({className:'l2-fishing-log-line no_bite',textContent:`Рыба не клюнула (${n}).`,querySelector:()=>null});
const isClear=p=>!!p&&Object.prototype.hasOwnProperty.call(p,'fishCastPending')&&p.fishCastPending===null&&'fishCastActive' in p;
function fx(){
 const W=world({cfg:{fishTimeAuto:false,reactMin:0,reactMax:0}});W.remain='01:00:00';W.env.rt.char='Hero';
 W.slots.pumping={kind:'pumping',disabled:false};W.lines=[];const qa=W.document.querySelectorAll;
 W.document.querySelectorAll=s=>s.includes('fishing-log')?W.lines:qa(s);return W;
}
// настоящая очередь записи ядра (engine-core createPatchQueue) поверх «хранилища» с ручным подтверждением пакетов
function queue(W){
 const S={sent:[],held:[],hold:false,fail:false,store:{},commits:0};
 S.q=core.createPatchQueue(b=>{const e={b:JSON.parse(JSON.stringify(b)),done:false};S.sent.push(e);
  const end=()=>{e.done=true;if(S.fail)return {ok:false,reason:'storage_patch_failed'};Object.assign(S.store,e.b);return {ok:true};};
  return S.hold?new Promise(r=>S.held.push(()=>r(end()))):Promise.resolve(end());},()=>true,()=>{},()=>Date.now(),{set:()=>0,clear(){}});
 W.env.setRt=p=>{Object.assign(W.env.rt,p);return S.q.enqueue(p);};
 W.env.rtCommit=async()=>{S.commits++;return (await S.q.recover())?.ok===true;};
 return S;
}

test('(a) поклёвка: запись снятия не подтверждается — первая Pumping всё равно нажата, отметки в памяти нет',async()=>{
 const W=fx(),set=W.env.setRt;let pend='не нажата',writes=0;
 W.env.setRt=p=>{if(isClear(p)){writes++;Object.assign(W.env.rt,p);return new Promise(()=>{});}return set(p);};
 W.env.fire=b=>{if(!W.env.on||!b)return;W.clicks.push(b.kind);if(b.kind==='fishing')W.active=true;if(b.kind==='pumping'){pend=W.env.rt.fishCastPending;W.env.on=false;}};
 assert.equal(await within(W.F.fishing()),'done','заброс не ждёт записи снятия');
 assert.deepEqual(W.clicks,['fishing','pumping']);assert.equal(writes,1);assert.equal(pend,null);
 assert.equal(W.env.rt.fishCastActive,true);assert.equal(W.env.rt.fish.bites,1);
});

test('(b) Stop сразу после исхода заброса — Pumping не нажимается',async()=>{
 for(const how of ['на снятии','после ожидания','потеря вкладки']){
  const W=fx(),set=W.env.setRt,wf=W.env.waitFor;
  if(how==='на снятии')W.env.setRt=p=>{const r=set(p);if(isClear(p))W.env.on=false;return r;};
  else W.env.waitFor=async(f,ms,st)=>{const r=await wf(f,ms,st);if(r==='bite'){if(how==='после ожидания')W.env.on=false;else W.env.tabOwner=false;}return r;};
  W.env.fire=b=>{if(!b)return;W.clicks.push(b.kind);if(b.kind==='fishing')W.active=true;};
  assert.equal(await within(W.F.fishing()),'done',how);
  assert.deepEqual(W.clicks,['fishing'],how);
  if(how==='на снятии')assert.equal(W.env.rt.fishCastPending,null,how);
  else assert.ok(W.env.rt.fishCastPending,how+': исход не принят — отметка остаётся для сверки');
 }
});

test('(c) следующий заброс ждёт свою запись намерения и rtCommit, а они — неподтверждённое снятие',async()=>{
 const W=fx(),S=queue(W);let n=0,atClick=null;
 W.env.fire=b=>{if(!W.env.on||!b)return;W.clicks.push(b.kind);if(b.kind!=='fishing')return;n++;
  if(n===2)atClick={done:S.sent.map(e=>e.done),commits:S.commits,pending:W.env.rt.fishCastPending};
  W.lines.unshift(noBite(n));if(n===1)S.hold=true;};
 assert.equal(await within(W.F.fishing()),'done','первый заброс не ждёт записи снятия');
 assert.equal(S.held.length,1);assert.ok(isClear(S.sent[S.sent.length-1].b),'в полёте — пакет снятия');
 const commits1=S.commits,p2=W.F.fishing();await pump();
 assert.equal(n,1,'нет нового заброса, пока снятие не записано');
 const p2pend=W.env.rt.fishCastPending;assert.ok(p2pend&&p2pend.at>0,'намерение второго заброса — в памяти');
 S.held.shift()();await pump();
 assert.equal(n,1,'нет нового заброса, пока не записано его намерение');
 assert.equal(S.sent[S.sent.length-1].b.fishCastPending?.at,p2pend.at);
 S.hold=false;S.held.shift()();await pump();
 assert.equal(n,2);assert.ok(atClick.done.every(Boolean),'к нажатию все пакеты подтверждены: '+JSON.stringify(atClick.done));
 assert.ok(atClick.commits>commits1,'перед нажатием — rtCommit');assert.equal(atClick.pending.at,p2pend.at);
 assert.equal(await within(p2),'done');await pump();
 assert.equal(S.store.fishCastPending,null);assert.equal(S.store.fish.casts,2);assert.equal(S.store.fish.nobite,2);
});

test('(c) неудачная запись снятия: следующий заброс не нажимается, снятие и статистика остаются в очереди для повтора',async()=>{
 const W=fx(),S=queue(W);let n=0;
 W.env.fire=b=>{if(!W.env.on||!b)return;W.clicks.push(b.kind);if(b.kind!=='fishing')return;n++;W.lines.unshift(noBite(n));if(n===1)S.hold=true;};
 assert.equal(await within(W.F.fishing()),'done');
 const p2=W.F.fishing();await pump();assert.equal(n,1);
 S.fail=true;S.held.shift()();await pump();
 assert.equal(await within(p2),'done');assert.equal(n,1,'без подтверждённой записи — без заброса');
 assert.equal(S.store.fishCastPending?.at>0,true,'в хранилище — прежняя отметка, повтор вслепую невозможен');
 const left=S.q.peek();assert.equal(left.fishCastPending,null);assert.equal(left.fish?.casts,1);assert.equal(left.fishBaitStat?.basic?.casts,1);
});

test('(d) не клюнула: снятие отметки и статистика исхода уходят одним пакетом после квитанции запроса',async()=>{
 const W=fx(),S=queue(W);
 W.env.fire=b=>{if(!W.env.on||!b)return;W.clicks.push(b.kind);if(b.kind!=='fishing')return;
  W.F.castRequestNote({path:'/game/fishing/action',method:'POST',req:{action:'cast',expectedRevision:7}},W.box.Date.now());W.lines.unshift(noBite(1));};
 await W.F.fishing();await pump();
 const clears=S.sent.filter(e=>isClear(e.b));assert.equal(clears.length,1);const b=clears[0].b;
 assert.equal(b.fishCastActive,false);assert.equal(b.fish.casts,1);assert.equal(b.fish.nobite,1);assert.equal(b.fishBaitStat.basic.casts,1);
 assert.equal(S.sent.indexOf(clears[0]),S.sent.length-1,'статистика заброса отдельной записью после снятия не идёт');
 const rr=S.sent.findIndex(e=>e.b.fishCastPending?.requestRevision===7);assert.ok(rr>=0&&rr<S.sent.indexOf(clears[0]),'квитанция запроса — раньше снятия');
 assert.equal(S.store.fishCastPending,null);assert.equal(S.store.fish.casts,1);
});

test('(d) поклёвка: снятие отметки и статистика начала вываживания — один пакет',async()=>{
 const W=fx(),S=queue(W);
 W.env.fire=b=>{if(!W.env.on||!b)return;W.clicks.push(b.kind);if(b.kind==='fishing')W.active=true;if(b.kind==='pumping')W.env.on=false;};
 await W.F.fishing();await pump();
 assert.deepEqual(W.clicks,['fishing','pumping']);
 const clears=S.sent.filter(e=>isClear(e.b));assert.equal(clears.length,1);const b=clears[0].b;
 assert.equal(b.fishCastActive,true);assert.equal(b.fish.casts,1);assert.equal(b.fish.bites,1);assert.equal(b.fishBaitStat.basic.bites,1);
 assert.equal(S.store.fishCastPending,null);
});

test('исходник: снятие отметки фоном, запись намерения и сверка прежние',()=>{
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../modules/fishing.js'),'utf8');
 assert.match(src,/if\(res && res!=='unknown'\)bg\(env\.setRt\(\{fishCastPending:null,fishCastActive:res==='bite'\}\)\);/);
 assert.match(src,/const saved=await env\.setRt\(\{fishCastPending:pending\}\);\s*const durable=saved\?\.ok!==false&&\(!env\.rtCommit\|\|await env\.rtCommit\(\)\);/);
 assert.match(src,/await env\.setRt\(statTake\(\{fishCastPending:null,fishCastActive:!!f\}\)\)/);
});
