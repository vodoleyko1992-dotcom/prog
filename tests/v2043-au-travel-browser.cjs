'use strict';
// 20.43 (автономность, разбор 21.10): настоящее MV3 + hook + диспетчер. Обычный платный телепорт получил 502 (исход неизвестен):
// бот не встаёт на паузу и второй POST не шлёт, сверяет GET /character раз в 30–60 с, сверка переживает reload; две сверки «ревизия
// и адена те же» с промежутком ≥ 30 с — перелёт снят, бот работает дальше. Все ответы сервера — локальные фикстуры (l2wap.com не открывается).
// 20.43 (ревью au/travel): квитанция — в rt.travelCheck; посреди сверки игрок меняет режим в меню (zoneGo:null + новый manualKickAt —
// как «Задачи бота» в popup): маршрут снят, квитанция и запрет повторной оплаты остаются, сверка доходит до вывода.
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let posts=0,postAt=0;const gets=[];try{
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:75,hp:10000,maxHp:10000,mp:1000,maxMp:1000,adena:1000000,revision:100,cityId:'l2dop_giran',currentZoneId:'giran_field',activeDungeonId:null,inBattle:false});
 const TP=`<div class="l2-teleport-miru-city-block" data-surroundings-key="dion"><button class="l2-teleport-miru-city-btn" data-surroundings-key="dion">Dion</button><div class="l2-teleport-miru-surroundings"><div class="l2-teleport-miru-surroundings-row"><span class="l2-teleport-miru-surroundings-label"><span>Cruma Marshlands</span></span><span class="l2-teleport-miru-mob-level">40-45</span><span class="l2-teleport-miru-price-num">50 000</span> <span class="l2-teleport-miru-price-currency">аден</span><button class="l2-teleport-miru-tp-btn" data-teleport-id="cruma_marshlands">Телепорт</button></div></div></div><div id="tp-error"></div>`
  +`<script>document.querySelector('[data-teleport-id]').onclick=async()=>{const {character:c}=await(await fetch('/character')).json();const r=await fetch('/game/teleport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teleportId:'cruma_marshlands',expectedRevision:c.revision,expectedAdenaCost:50000})});if(r.ok)location.href='/map.html';else document.getElementById('tp-error').textContent='Ошибка сервера';}</script>`;
 const html=p=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div>${p==='/teleport.html'?TP:''}`;
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname,m=r.request().method();
  if(p==='/character'){gets.push(Date.now());return r.fulfill({contentType:'application/json',body:JSON.stringify({character:character()})});}
  if(p==='/game/teleport'&&m==='POST'){
   const req=r.request().postDataJSON(),state=(await h.get(['rt'])).rt;
   assert.deepEqual(req,{teleportId:'cruma_marshlands',expectedRevision:100,expectedAdenaCost:50000});
   assert.ok(state.travelCheck?.nativeTp?.sentAt,'квитанция записана до POST');assert.equal(state.travelCheck.nativeTp.adena,1000000);assert.ok(!state.zoneGo,'маршрут снят той же записью');
   posts++;postAt=Date.now();return r.fulfill({status:502,contentType:'text/html',body:'<html><body>502 Bad Gateway</body></html>'});
  }
  if(/\.html$/.test(p))return r.fulfill({contentType:'text/html',body:html(p)});
  return r.fallback();
 });
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({cfg:{...cfg,shopReserve:200000},rt:{...rt,zoneGo:{id:'cruma_marshlands',t:Date.now(),why:'тест'},zoneGoT:0,zoneCat:{cruma_marshlands:{name:'Cruma Marshlands',city:'dion',lo:40,hi:45}}}})});
 await h.g.p.goto('https://l2wap.com/teleport.html');await until(()=>h.g.core('!!rt.zoneGo'));await h.click('start');
 await until(()=>posts===1,30000);
 await until(async()=>(await h.get(['rt'])).rt.travelCheck?.check?.n>=1,20000);
 let s=await h.get(['on','paused','rt']);assert.equal(s.on,true,'бот не встал на паузу');assert.ok(!s.paused);assert.ok(s.rt.travelCheck.nativeTp,'квитанция сохранена');assert.equal(s.rt.travelCheck.check.same,0,'сверка сразу после клика не в счёт');
 // ревью au/travel: смена режима в меню посреди сверки (как popup «Задачи бота»: zoneGo:null + manualKickAt) — диспетчер/список задач
 // снимают маршруты, но не квитанцию
 const kick=Date.now();await h.popup.evaluate(k=>menuPatch({zoneGo:null,manualKickAt:k}),kick);
 await until(()=>h.g.core('rt.manualKickAt==='+kick),20000);
 await until(async()=>(await h.get(['rt'])).rt.travelCheck?.check?.kick===kick,30000);
 s=await h.get(['on','rt']);assert.equal(s.on,true);assert.ok(s.rt.travelCheck?.nativeTp,'квитанция пережила смену режима');assert.ok(!s.rt.zoneGo);
 await delay(3000);assert.equal(posts,1,'повторного POST нет');
 // первая сверка, которая идёт в счёт (≥ 30 с после клика), — затем reload посреди сверки
 await until(async()=>(await h.get(['rt'])).rt.travelCheck?.check?.same===1,80000);
 await h.g.p.reload();await until(()=>h.g.core('on && tabOwner'),20000);
 s=await h.get(['rt']);assert.equal(s.rt.travelCheck?.check?.same,1,'сверка пережила reload');
 await until(async()=>!(await h.get(['rt'])).rt.travelCheck,90000);
 s=await h.get(['on','paused','rt']);
 assert.equal(posts,1);assert.equal(s.on,true);assert.ok(!s.paused);assert.ok(!s.rt.zoneBad?.cruma_marshlands,'«не прошёл» — не «плохая» зона');assert.ok(!s.rt.zoneGo);
 const after=gets.filter(t=>t>=postAt+30000);assert.ok(after.length>=2,'две сверки после 30 с: '+after.length);
 assert.ok(after.some((t,i)=>after.slice(i+1).some(u=>u-t>=30000)),'между сверками ≥ 30 с');
 const span=after.length?after[after.length-1]-postAt:0;assert.ok(span>=60000&&span<=170000,'вывод через 60–170 с после клика: '+span);
 await delay(2000);assert.equal(posts,1);
 await h.click('stop');await until(()=>h.g.core('!on'));assert.deepEqual(h.errors,[]);
 console.log(`PASS MV3 телепорт 502 → сверка без паузы (GET после клика: ${gets.filter(t=>t>=postAt).length}, вывод через ${Math.round(span/1000)} с) → смена режима в меню (квитанция осталась) → reload → «не прошёл», перелёт снят, повторного POST нет`);
 }catch(e){console.error('DIAG',JSON.stringify({posts,gets:gets.map(t=>t-(postAt||t)),url:h.g.p.url(),errors:h.errors,state:await h.get(['on','paused','rt']).then(x=>({on:x.on,paused:x.paused,zoneGo:x.rt.zoneGo,travelCheck:x.rt.travelCheck,owner:x.rt.actionOwner,status:x.rt.status}))}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
