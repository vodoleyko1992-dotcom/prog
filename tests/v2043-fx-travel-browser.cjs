'use strict';
// 20.43 (автономность, доводка 21.10; ревью сверки перелёта, замечание 4): настоящие MV3 + content.pauseBot/serverWait + фон + popup.
// Квитанция перелёта с неоднозначным исходом (ревизия выросла, адены убыло меньше цены, герой на месте) дошла до 30-й минуты, а сервер
// лежит (/game/time — 502): pauseBot(fault) ждёт сервер (serverWait), паузы нет. Игрок в это время правит меню (menuPatch с новым
// manualKickAt, без Старта) — раньше метка gaveUp уже была записана до pauseBot, и следующая сверка закрывала квитанцию «по решению
// игрока», снимая запрет платного. Теперь квитанция остаётся. Затем сервер жив: настоящая пауза (фон: on=false, paused) — метка gaveUp
// с номером Старта (rt.dailyStart); правка меню на паузе ничего не меняет; Старт игрока закрывает квитанцию одной сверкой.
// Все ответы сервера — локальные фикстуры (l2wap.com не открывается).
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let down=false,gets=0,timeDown=0;try{
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:75,hp:10000,maxHp:10000,mp:1000,maxMp:1000,adena:990000,revision:101,cityId:'l2dop_giran',currentZoneId:'giran_field',activeDungeonId:null,inBattle:false});
 const html=()=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div>`;
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/game/time'&&down){timeDown++;return r.fulfill({status:502,contentType:'text/html',body:'<html><body>502 Bad Gateway</body></html>'});}
  if(p==='/character'){gets++;return r.fulfill({contentType:'application/json',body:JSON.stringify({character:character()})});}
  if(/\.html$/.test(p))return r.fulfill({contentType:'text/html',body:html()});
  return r.fallback();
 });
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof on!=="undefined"'));
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner'),30000);await delay(2500);
 // квитанция платного телепорта (клик 31 мин назад, 60 сверок без вывода) — как её пишет navigation.zoneGoStep
 const seed=async()=>{const kick=await h.g.core('rt.manualKickAt'),now=Date.now(),t0=now-31*60000;
  const T={id:'cruma_marshlands',t:t0,nativeTp:{id:'cruma_marshlands',char:'AuditHero',charId:'fixture-hero',revision:100,adena:1000000,from:{zone:'giran_field',city:'l2dop_giran'},cost:50000,kick,sentAt:t0,nonce:t0+':fx'},
   check:{kick,t0,at:now-40000,next:0,n:60,same:0,sameAt:0,why:'прибытие не подтверждено'}};
  assert.equal(await h.g.core(`setRt(${JSON.stringify({travelCheck:T,zoneCat:{cruma_marshlands:{name:'Cruma Marshlands',city:'dion',lo:40,hi:45}}})}).then(r=>r?.ok!==false)`),true);return kick;};
 // 1) сервер лежит на 30-й минуте: pauseBot ждёт сервер; игрок правит меню — квитанция не закрыта
 down=true;const k1=await seed();
 await until(async()=>timeDown>0&&await h.g.core('!!rt.downT'),40000);   // pauseBot(fault) → srvUp() 502 → serverWait
 let s=await h.get(['on','paused','rt']);assert.equal(s.on,true,'паузы нет — бот ждёт сервер');assert.ok(!s.paused);
 const mark=s.rt.travelCheck?.check?.gaveUp;
 const k2=Date.now();await h.popup.evaluate(k=>menuPatch({manualKickAt:k}),k2);          // правка меню без Старта
 await until(()=>h.g.core('rt.manualKickAt==='+k2),20000);
 down=false;
 await until(async()=>{const c=(await h.get(['rt'])).rt.travelCheck;return !c||c.check?.kick===k2;},40000).catch(()=>{});
 await delay(4000);
 s=await h.get(['on','paused','rt']);
 assert.ok(s.rt.travelCheck?.nativeTp,'квитанция не закрыта «по решению игрока»');assert.equal(s.on,true);
 assert.equal(mark,undefined,'метки «была пауза» не было');
 assert.equal(s.rt.travelCheck.check.kick,k2,'новое окно сверки');assert.equal(s.rt.travelCheck.check.ackStart,undefined);
 assert.ok(await h.g.core('L2V7Modules.navigation.travelPending()'),'платное по-прежнему запрещено');
 // 2) сервер жив, снова 30-я минута: настоящая пауза (фон) — метка gaveUp с номером Старта
 const start=await h.g.core('rt.dailyStart||0');await seed();
 await until(async()=>(await h.get(['on'])).on===false,40000);
 await until(async()=>!!(await h.get(['rt'])).rt.travelCheck?.check?.gaveUp,20000);
 s=await h.get(['on','paused','rt','stopMeta']);
 assert.ok(s.paused,'пауза записана фоном');assert.equal(s.stopMeta?.source,'content-pause');assert.match(String(s.paused.why),/Проверьте положение героя/);
 assert.equal(s.rt.travelCheck.check.gaveUpStart,start,'метка помнит номер Старта');
 // 3) правка меню на паузе — ничего не меняет
 const k3=Date.now();await h.popup.evaluate(k=>menuPatch({manualKickAt:k}),k3);await delay(3000);
 s=await h.get(['on','rt']);assert.equal(s.on,false);assert.ok(s.rt.travelCheck?.check?.gaveUp,'квитанция и метка на месте');
 // 4) Старт игрока (фон: +1 к rt.dailyStart) — квитанция закрыта одной сверкой «по решению игрока»
 await h.click('start');await until(async()=>(await h.get(['on'])).on===true,20000);
 assert.equal((await h.get(['rt'])).rt.dailyStart,start+1,'Старт поднял номер');
 await until(async()=>!(await h.get(['rt'])).rt.travelCheck,40000);
 s=await h.get(['on','rt']);assert.equal(s.on,true);assert.ok(!await h.g.core('L2V7Modules.navigation.travelPending()'));
 await h.click('stop');await until(()=>h.g.core('!on'));assert.deepEqual(h.errors,[]);
 console.log(`PASS MV3 квитанция перелёта на 30-й минуте: сервер лежит (502 /game/time ×${timeDown}) → ожидание сервера без паузы → правка меню — квитанция открыта; настоящая пауза → метка с номером Старта ${start} → правка меню на паузе — без изменений → Старт — закрыта (GET /character: ${gets})`);
}catch(e){console.error('DIAG',JSON.stringify({gets,timeDown,url:h.g.p.url(),errors:h.errors,state:await h.get(['on','paused','rt','stopMeta']).then(x=>({on:x.on,paused:x.paused,stopMeta:x.stopMeta,travelCheck:x.rt.travelCheck,kick:x.rt.manualKickAt,dailyStart:x.rt.dailyStart,downT:x.rt.downT,status:x.rt.status}))}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
