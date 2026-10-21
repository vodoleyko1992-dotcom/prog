'use strict';
// 20.43 (автономность, доводка 21.10; ревью сверки перелёта, замечание к метке паузы): настоящие MV3 + content.pauseBot/serverWait + фон + popup.
// Квитанция перелёта с неоднозначным исходом дошла до 30-й минуты, а сервер лежит (/game/time — 502): pauseBot(fault) ждёт сервер
// (serverWait), своей паузы «Проверьте положение героя» нет. Игрок в это время жмёт ⏹ Стоп (или ⏸ Пауза) в меню: serverWait выходит без
// перезагрузки, pauseBot возвращается, бот выключен. Раньше одного on=false хватало для метки gaveUp («была пауза»), и следующий Старт
// игрока закрывал квитанцию «по решению игрока» — игрок этой паузы не видел, а запрет платного снимался при неизвестном исходе клика.
// Теперь метка — только по паузе, которую записал фон (paused, stopMeta.source 'content-pause' с этой причиной, не раньше начала паузы):
// после Стоп/Пауза игрока и Старта/«Продолжить» квитанция остаётся, начинается новое окно сверки, платное по-прежнему запрещено.
// Все ответы сервера — локальные фикстуры (l2wap.com не открывается).
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let down=false,gets=0,timeDown=0;const seen=[];try{
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
 // квитанция платного телепорта (клик 31 мин назад, 60 сверок без вывода) — как её пишет navigation.zoneGoStep
 const seed=async()=>{const kick=await h.g.core('rt.manualKickAt'),now=Date.now(),t0=now-31*60000;
  const T={id:'cruma_marshlands',t:t0,nativeTp:{id:'cruma_marshlands',char:'AuditHero',charId:'fixture-hero',revision:100,adena:1000000,from:{zone:'giran_field',city:'l2dop_giran'},cost:50000,kick,sentAt:t0,nonce:t0+':fx'},
   check:{kick,t0,at:now-40000,next:0,n:60,same:0,sameAt:0,why:'прибытие не подтверждено'}};
  assert.equal(await h.g.core(`setRt(${JSON.stringify({travelCheck:T,zoneCat:{cruma_marshlands:{name:'Cruma Marshlands',city:'dion',lo:40,hi:45}}})}).then(r=>r?.ok!==false)`),true);return kick;};
 // кнопка игрока во время ожидания сервера → Старт/«Продолжить» → квитанция открыта, «решения игрока» нет
 for(const [press,resume,source] of [['stop','start','popup-stop'],['pause','pause','popup-pause']]){
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'),30000);await delay(2500);
  down=true;timeDown=0;await seed();
  await until(async()=>timeDown>0&&await h.g.core('!!rt.downT'),40000);   // pauseBot(fault) → srvUp() 502 → serverWait
  let s=await h.get(['on','paused']);assert.equal(s.on,true,'ожидание сервера — бот включён, паузы нет');assert.ok(!s.paused);
  await h.click(press);await until(async()=>(await h.get(['on'])).on===false,20000);
  await delay(4000);                                  // serverWait вышел без перезагрузки, pauseBot вернулся — travelVerify дошёл до метки
  s=await h.get(['on','paused','stopMeta','rt']);
  assert.equal(s.stopMeta?.source,source,'остановку записал игрок');
  if(press==='stop')assert.ok(!s.paused,'Стоп — не пауза');else assert.ok(s.paused,'⏸ Пауза игрока');
  assert.ok(s.rt.travelCheck?.nativeTp,'квитанция на месте');
  assert.equal(s.rt.travelCheck.check.gaveUp,undefined,'своей паузы «Проверьте положение героя» не было — метки нет');
  assert.equal(s.rt.travelCheck.check.gaveUpStart,undefined);
  const start=+s.rt.dailyStart||0;down=false;
  await h.click(resume);await until(async()=>(await h.get(['on'])).on===true,20000);
  assert.equal((await h.get(['rt'])).rt.dailyStart,start+1,'Старт/«Продолжить» поднял номер');
  const k=await h.g.core('rt.manualKickAt');
  await until(async()=>{const c=(await h.get(['rt'])).rt.travelCheck;return !c||c.check?.kick===k&&c.check?.n>=1;},40000);
  await delay(2000);
  s=await h.get(['on','rt']);
  assert.ok(s.rt.travelCheck?.nativeTp,'квитанция не закрыта «по решению игрока»');assert.equal(s.on,true);
  assert.equal(s.rt.travelCheck.check.ackStart,undefined,'новое окно сверки, а не закрытие');
  assert.ok(await h.g.core('L2V7Modules.navigation.travelPending()'),'платное по-прежнему запрещено');
  seen.push(`${press}: ${source}, 502 /game/time ×${timeDown}`);
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
  await h.g.core('setRt({travelCheck:null}).then(()=>true)');
 }
 assert.deepEqual(h.errors,[]);
 console.log(`PASS MV3 квитанция перелёта на 30-й минуте, сервер лежит: ⏹ Стоп / ⏸ Пауза игрока в ожидании сервера → метки «была пауза» нет → Старт / «Продолжить» — квитанция открыта, новое окно сверки, платное запрещено (${seen.join('; ')}; GET /character: ${gets})`);
}catch(e){console.error('DIAG',JSON.stringify({gets,timeDown,seen,url:h.g.p.url(),errors:h.errors,state:await h.get(['on','paused','rt','stopMeta']).then(x=>({on:x.on,paused:x.paused,stopMeta:x.stopMeta,travelCheck:x.rt.travelCheck,kick:x.rt.manualKickAt,dailyStart:x.rt.dailyStart,downT:x.rt.downT,status:x.rt.status}))}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
