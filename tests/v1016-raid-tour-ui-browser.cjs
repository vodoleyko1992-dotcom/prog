'use strict';
// 14.10: настоящее MV3-меню → background → storage; все ответы игры локальные, без аккаунта.
const assert = require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');

(async()=>{
 const h=await harness(), failed=[];let passed=0;
 try {
  // Проверяем именно команду меню: игровой цикл не успевает переписать её результат.
  // wakeGame штатно сообщает об отсутствии вкладки; вкладку игры сам не открывает.
  await h.g.p.close();
  const initial=await h.get(['cfg','rt']), now=Date.now();
  const list={
   low:{name:'Low Boss',lvl:65,alive:true},high:{name:'High Boss',lvl:80,alive:true},
   pot1:{name:'Potion One',lvl:70,alive:true},pot2:{name:'Potion Two',lvl:72,alive:true},
   retry:{name:'Retry Boss',lvl:73,alive:true},dead:{name:'Dead Boss',lvl:78,alive:false}
  };
  const limits={epicCoinDailyMax:0,epicCoinPerBoss:1,epicCoinKeep:30,epicAdenaDailyMax:4321,shopReserve:900000,rbMaxKillMin:11,rbPotReserve:20};
  const history={rbGoTried:{high:now-600000},rbGoCnt:{high:[now-300000,now-200000,now-100000]},rbDb:{low:{verdict:'no',heroLvl:60,kills:2}},epicTpBudget:[{t:now,k:'fixture',cost:7,unit:'COL',kind:'tp'}]};
  const snapshot=(patch={})=>({at:now,heroLvl:75,lo:60,hi:90,mode:'up',listT:now,stale:false,
   ready:[{id:'low',name:'Low Boss',lvl:65},{id:'high',name:'High Boss',lvl:80}],
   blocked:[{id:'pot1',name:'Potion One',lvl:70,kind:'pots',why:'не хватает банок HP'},
    {id:'pot2',name:'Potion Two',lvl:72,kind:'pots',why:'не хватает банок HP'},
    {id:'retry',name:'Retry Boss',lvl:73,kind:'retry',why:'недавно пробовал — жду повтор',waitMs:90000},
    {id:'dead',name:'Dead Boss',lvl:78,kind:'dead',why:'мёртв по списку игры'}],...patch});
  async function seed(cfg={},rt={}) {
   await h.sw.evaluate(({cfg,rt})=>chrome.storage.local.set({on:false,paused:null,cfg,rt}),{
    cfg:{...initial.cfg,...limits,rbHuntMode:false,rbMode:false,rbBetween:false,fishMode:false,epicMode:false,catMode:false,taskOnly:true,campaign:false,zoneAuto:false,rbOrder:'up',rbValueTour:false,rbMaxBelow:15,rbMaxAbove:15,...cfg},
    rt:{...initial.rt,...history,_src:'raid-ui-fixture',lvl:75,rbList:list,rbListT:now,rbTourView:null,rbHunt:null,rbHuntIdle:0,rbIdleMark:null,rbIdleN:0,rbRefuse:null,...rt}
   });
   await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
   await h.popup.evaluate(()=>load());await h.popup.evaluate(()=>showTab('rb'));
  }
  const queue=()=>h.popup.locator('#huntQueue').textContent();
  async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed.push(name+': '+e.message);console.error('FAIL '+name+'\n'+e.stack)}}
  function preserved(s){for(const [k,v] of Object.entries(limits))assert.deepEqual(s.cfg[k],v,k);for(const [k,v] of Object.entries(history))assert.deepEqual(s.rt[k],v,k)}

  await test('без расчёта движка показан честный предварительный список',async()=>{
   await seed();const q=await queue();assert.match(q,/Предварительный список/);assert.ok(q.includes('Low Boss'));assert.doesNotMatch(q,/Последний расч[её]т/);assert.equal((await h.get(['on'])).on,false);
  });
  await test('готовый snapshot определяет очередь, старый no/таймер меню не исключает цель повторно',async()=>{
   await seed({}, {rbTourView:snapshot()});const q=await queue();assert.match(q,/Последний расч[её]т/);assert.match(q,/\d{1,2}:\d{2}/);assert.doesNotMatch(q,/Предварительный список/);
   assert.ok(q.indexOf('Low Boss')>=0&&q.indexOf('High Boss')>q.indexOf('Low Boss'),q);assert.doesNotMatch(q,/не по силам/);
  });
  await test('меню группирует реальные причины и показывает ожидание следующей попытки',async()=>{
   await seed({}, {rbTourView:snapshot()});const q=await queue();assert.equal(q.split('не хватает банок HP').length-1,1);assert.match(q,/не хватает банок HP \(2\)/);assert.ok(q.includes('Potion One')&&q.includes('Potion Two'));
   assert.ok(q.includes('недавно пробовал — жду повтор'));assert.match(q,/(?:2\s*мин|90\s*с)/);assert.ok(q.includes('мёртв по списку игры'));
  });
  await test('режим с сильных сохраняет фактический порядок snapshot',async()=>{
   await seed({rbOrder:'down'},{rbTourView:snapshot({mode:'down',ready:[{id:'high',name:'High Boss',lvl:80},{id:'low',name:'Low Boss',lvl:65}]})});const q=await queue();assert.match(q,/Последний расч[её]т/);assert.ok(q.indexOf('High Boss')>=0&&q.indexOf('Low Boss')>q.indexOf('High Boss'),q);
  });
  for(const [name,change] of [['уровень героя',{heroLvl:74}],['нижняя граница',{lo:61}],['верхняя граница',{hi:89}],['режим сортировки',{mode:'down'}],['дата списка',{listT:now-1000}]]) {
   await test('изменился '+name+' — прежний расчёт не выдаётся за актуальную очередь',async()=>{
    await seed({}, {rbTourView:snapshot({...change,ready:[{id:'old',name:'Old Calculated Boss',lvl:66}]})});const q=await queue();assert.match(q,/Предварительный список/);assert.doesNotMatch(q,/Old Calculated Boss/);
   });
  }
  await test('выгода без подходящего расчёта ждёт движок и не обещает порядок уровня',async()=>{
   await seed({rbValueTour:true},{rbTourView:snapshot()});const q=await queue();assert.match(q,/выгод/i);assert.match(q,/ожида|жд|расч[её]т/i);assert.doesNotMatch(q,/→/);
  });
  await test('готовый расчёт выгоды показывает его порядок и не подсвечивает уровень',async()=>{
   await seed({rbValueTour:true},{rbTourView:snapshot({mode:'value',ready:[{id:'high',name:'High Boss',lvl:80},{id:'low',name:'Low Boss',lvl:65}]})});const q=await queue();assert.match(q,/Последний расч[её]т/);assert.match(q,/выгод/i);assert.ok(q.indexOf('High Boss')>=0&&q.indexOf('Low Boss')>q.indexOf('High Boss'),q);
   for(const id of ['rbOrderUp','rbOrderDown'])assert.equal(await h.popup.locator('#'+id).evaluate(e=>e.classList.contains('on')),false);
  });
  for(const [button,order] of [['rbOrderUp','up'],['rbOrderDown','down']]) {
   await test(button+' явно выключает выгоду; сохраняет Stop, лимиты и историю',async()=>{
    await seed({rbValueTour:true,rbOrder:order==='up'?'down':'up'});await h.popup.locator('#'+button).click();
    await until(async()=>{const {cfg}=await h.get(['cfg']);return cfg.rbOrder===order&&!cfg.rbValueTour});
    const s=await h.get(['cfg','rt','on']);assert.equal(s.on,false);preserved(s);await until(()=>h.popup.locator('#rbValueTour').isChecked().then(v=>!v));
    assert.equal(await h.popup.locator('#'+button).evaluate(e=>e.classList.contains('on')),true);
   });
  }
  await test('сразу изменённое соседнее поле не возвращает старый порядок или выгоду',async()=>{
   await seed({rbValueTour:true,rbOrder:'down'},{rbTourView:snapshot({mode:'value'})});
   await h.popup.evaluate(()=>{document.querySelector('#rbOrderUp').click();const field=document.querySelector('#rbMaxAbove');field.value='7';field.dispatchEvent(new Event('change',{bubbles:true}));});
   await until(async()=>{const {cfg}=await h.get(['cfg']);return cfg.rbOrder==='up'&&!cfg.rbValueTour&&cfg.rbMaxAbove===7});
   const s=await h.get(['cfg','rt','on']);assert.equal(s.on,false);assert.equal(s.rt.rbTourView,null);preserved(s);
  });
  await test('быстрый запуск после смены порядка не сохраняет прежнюю галочку выгоды',async()=>{
   await seed({rbValueTour:true,rbOrder:'down'});
   // Обработчик кнопки завершён; общий save() запуска выполняется раньше отложенного loadSoon().
   await h.popup.evaluate(async()=>{await document.querySelector('#rbOrderUp').onclick();document.querySelector('#huntToggle').click();});
   await until(async()=>{const s=await h.get(['cfg','on']);return s.on&&s.cfg.rbHuntMode});const s=await h.get(['cfg','rt']);assert.equal(s.cfg.rbOrder,'up');assert.equal(s.cfg.rbValueTour,false);preserved(s);
  });
  for(const button of ['huntToggle','huntToggle2']) {
   for(const [name,refuse,idle,protect] of [
    ['обычный простой',null,now+600000,false],
    ['один свежий отказ',{n:1,t:now-1000},now+600000,false],
    ['просроченные отказы',{n:2,t:now-660000},now+600000,false],
    ['свежие повторные отказы',{n:2,t:now-1000},now+600000,true],
    ['завершённая защитная пауза',{n:2,t:now-1000},now-1000,false]
   ]) {
    await test(button+' / '+name+': ручной запуск сохраняет только действующую защитную паузу',async()=>{
     const mark={lvl:75,pots:10,t:now-2000};await seed({}, {rbHuntIdle:idle,rbIdleMark:mark,rbIdleN:4,rbRefuse:refuse,rbTourView:snapshot()});
     if(button==='huntToggle')await h.popup.evaluate(()=>showTab('overview'));
     await h.popup.locator('#'+button).click();await until(async()=>{const s=await h.get(['cfg','on']);return s.on&&s.cfg.rbHuntMode});
     const s=await h.get(['cfg','rt','on']);assert.equal(s.on,true);assert.equal(s.rt.rbListT,0);assert.equal(s.rt.rbHunt.step,'pick');preserved(s);
     assert.equal(s.rt.rbHuntIdle,protect?idle:0);assert.deepEqual(s.rt.rbIdleMark,protect?mark:null);assert.equal(s.rt.rbIdleN,protect?4:0);
     if(protect)assert.deepEqual(s.rt.rbRefuse,refuse);
     await until(()=>h.popup.locator('#wakeWarn').textContent().then(x=>/вкладка игры не отвечает/.test(x)));
    });
   }
  }
  await test('выключение тура не обнуляет защитную паузу и историю',async()=>{
   const idle=now+600000,refuse={n:2,t:now-1000},mark={lvl:75,pots:10,t:now-2000};await seed({rbHuntMode:true},{rbHuntIdle:idle,rbIdleMark:mark,rbIdleN:4,rbRefuse:refuse});
   await h.popup.locator('#huntToggle2').click();await until(async()=>!(await h.get(['cfg'])).cfg.rbHuntMode);const s=await h.get(['cfg','rt','on']);assert.equal(s.on,false);assert.equal(s.rt.rbHuntIdle,idle);assert.deepEqual(s.rt.rbIdleMark,mark);assert.equal(s.rt.rbIdleN,4);assert.deepEqual(s.rt.rbRefuse,refuse);preserved(s);
  });
  await test('нет ошибок JavaScript и игровых POST',async()=>{assert.deepEqual(h.errors,[]);assert.equal(h.requests.filter(x=>x.method==='POST').length,0)});
  console.log(`RESULT ${passed} PASS / ${failed.length} FAIL`);
  if(failed.length)throw Error(failed.join('\n'));
 } finally {await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
