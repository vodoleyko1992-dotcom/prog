'use strict';
// Настоящий popup → IPC → content/Mammon; /character полностью синтетический.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const {p,core}=h.g,P=h.popup,initialUrl=p.url(),requests=[];
 h.ctx.on('request',r=>{if(r.url().startsWith('https://'))requests.push({path:new URL(r.url()).pathname,method:r.method()});});
 let reads=0,mode='ok',held=null,release=null;
 let snapshot={id:'synthetic-bag-hero',name:'AuditHero',revision:1,l2Profession:'human_warlock',
  classSlots:{activeSlot:0},inventory:{eq:{belt:{itemId:920018,specialGearLevel:0}},
   stacks:[{itemId:1874,qty:11891},{itemId:1893,qty:0}]}};
 await h.ctx.route('https://l2wap.com/character',async r=>{
  reads++;const captured=structuredClone(snapshot),status=mode==='error'?500:200;
  if(mode==='hold'){held=true;await new Promise(resolve=>{release=resolve;});held=null;}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{character:captured}:{error:'synthetic_unavailable'})});
 });
 await p.evaluate(()=>localStorage.setItem('token','synthetic-local-only'));
 await h.sw.evaluate(async()=>{
  const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);const now=Date.now();
  await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['mammon'],taskOnly:false,
   mmGoalItem:920018,mmGoalLvl:1,mmUpgrade:false,mmOrders:false,mmMailClaim:false,mmGoalFarm:false},
   rt:{...rt,_src:'synthetic-mammon-bag-fixture',classCur:{prof:'human_warlock',slot:0},mmJob:null,mmGoReq:null,actionPayments:{pending:null},
    mmCost:{'920018:0':{a:0,c:0,m:[[1893,'Oriharukon',13]],t:now}},
    mmGear:[{id:920018,n:'Synthetic Belt',g:'D',lvl:0,eq:true}],mmGearT:now,
    mmEq:{belt:[920018,0]},mmEqT:now,mmBagAnalysis:null}});
 });
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#mmBagAnalyze')?.onclick));
 await h.openTab('mammon');await h.reveal('#mmBagAnalyze');
 const analysis=async()=>(await h.get(['rt'])).rt.mmBagAnalysis;
 const button=P.locator('#mmBagAnalyze');
 async function clickAndWait(){
  const before=reads,old=(await analysis())?.attemptAt||0;
  await button.click();await until(async()=>reads>before);
  await until(async()=>{const a=await analysis();return a&&a.attemptAt>old;});
  await until(()=>button.isEnabled());return analysis();
 }
 async function staysOff(){
  assert.equal((await h.get(['on'])).on,false);assert.equal(await core('on'),false);
  assert.equal(p.url(),initialUrl);const rt=(await h.get(['rt'])).rt;
  assert.equal(rt.mmJob,null);assert.equal(rt.mmGoReq,null);assert.equal(rt.actionPayments?.pending??null,null);
  assert.ok(requests.every(r=>r.method==='GET'),'анализ не отправляет POST');
 }

 let before=reads;const ore=await clickAndWait();
 assert.equal(reads,before+1,'ручная кнопка делает один свежий GET');
 assert.equal(ore.status,'ok');assert.equal(ore.char,'AuditHero');assert.equal(ore.prof,'human_warlock');
 assert.deepEqual(ore.goal,{id:920018,lvl:0,to:1});assert.equal(ore.readyMaterials,false);
 const product=ore.items.find(x=>x.id===1893),raw=ore.raw.find(x=>x.id===1874);
 assert.deepEqual({need:product.need,have:product.have,missing:product.missing},{need:13,have:0,missing:13});
 assert.equal(raw.have,11891);assert.equal(raw.need,65);
 assert.match(await P.locator('[data-mm-bag-kind="material"][data-mm-bag-item="1893"]').innerText(),/Oriharukon/);
 assert.match(await P.locator('[data-mm-bag-kind="raw"][data-mm-bag-item="1874"]').innerText(),/Ore|руд/i);
 await staysOff();
 await P.setViewportSize({width:360,height:900});
 // 20.10: dock проверяется настоящим iframe в v2035-mammon-dock-browser; здесь отдельное узкое меню.
 await P.goto('chrome-extension://'+h.id+'/popup.html');
 await until(()=>P.evaluate(()=>!!document.querySelector('#mmBagAnalyze')?.onclick));
 await h.openTab('mammon');await h.reveal('#mmBagAnalyze');
 assert.equal(await P.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'таблицы на360px без горизонтальной прокрутки');

 snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=13;
 before=reads;const complete=await clickAndWait();
 assert.equal(reads,before+1,'ручной запрос не пользуется свежим прежним кэшем');
 assert.equal(complete.status,'ok');assert.equal(complete.readyMaterials,true);
 assert.equal(complete.items.find(x=>x.id===1893).have,13);
 assert.equal(complete.items.find(x=>x.id===1893).missing,0);await staysOff();

 mode='error';const failure=await clickAndWait();
 assert.equal(failure.status,'error');assert.equal(failure.t,complete.t,'ошибка не обновляет время успеха');
 assert.deepEqual(failure.items,complete.items,'последний подтверждённый состав сохраняется');
 assert.match(await P.locator('#mmBagStatus').innerText(),/ошиб|не удалось|предыдущ|прошл|не обнов/i);
 await staysOff();

 // Запоздавший ответ для прежней цели не меняет результат или live-кэш сумки.
 mode='hold';snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=999999;
 const oldSuccess=failure.t;
 await button.click();await until(()=>held);
 await P.locator('#mmGoalLvl').selectOption('2');await P.locator('#mmGoalLvl').dispatchEvent('change');
 await until(async()=>(await h.get(['cfg'])).cfg.mmGoalLvl===2);
 release();await until(()=>button.isEnabled());await delay(150);
 assert.equal((await analysis()).t,oldSuccess);assert.notEqual(await core('invQty(1893)'),999999);
 assert.equal((await h.get(['cfg'])).cfg.mmGoalLvl,2);await staysOff();

 // Запрос от другого героя не начинает даже чтение его сумки.
 before=reads;
 const gameTab=await core('chrome.runtime.sendMessage({cmd:"tabId"})');
 const other=await P.evaluate(tab=>chrome.tabs.sendMessage(tab,{cmd:'mammonBagAnalyze',expectedChar:'OtherHero',goalItem:920018,goalLvl:2}),gameTab);
 assert.equal(other.ok,false);assert.equal(reads,before);await staysOff();

 mode='ok';await P.locator('#mmGoalItem').selectOption('0');await P.locator('#mmGoalItem').dispatchEvent('change');
 await until(async()=>(await h.get(['cfg'])).cfg.mmGoalItem===0);
 const noGoal=await clickAndWait();assert.equal(noGoal.status,'ok');assert.equal(noGoal.goal,null);
 assert.deepEqual(noGoal.items,[]);assert.deepEqual(noGoal.raw,[]);assert.deepEqual(noGoal.craft,[]);
 assert.ok(noGoal.resourceCount>0);await staysOff();

 // Автоматические чтения исполняем под настоящей арендой, удерживая main между шагами.
 snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=0;
 await P.locator('#mmGoalItem').selectOption('920018');await P.locator('#mmGoalItem').dispatchEvent('change');
 await until(async()=>(await h.get(['cfg'])).cfg.mmGoalItem===920018);
 await P.locator('#mmGoalLvl').selectOption('1');await P.locator('#mmGoalLvl').dispatchEvent('change');
 await until(async()=>(await h.get(['cfg'])).cfg.mmGoalLvl===1);
 await P.locator('#mmGoalLvl').blur();
 await core('running=true;loopT=Date.now();true');
 await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));await until(()=>core('on'));
 assert.equal(await core('tabLock()'),true);
 before=reads;
 const automatic=await core('L2V7Modules.mammon.bagAuto()');
 assert.equal(automatic.ok,true);assert.equal(reads,before+1);assert.equal((await analysis()).source,'auto');
 assert.equal(automatic.analysis.goal.to,1,JSON.stringify({goal:automatic.analysis.goal,cfg:(await h.get(['cfg'])).cfg.mmGoalLvl}));
 assert.equal((await analysis()).readyMaterials,false);
 assert.equal(await core('L2V7Modules.mammon.bagAuto()'),null);
 assert.equal(reads,before+1,'свежий автоматический анализ не дублирует GET');

 snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=13;
 const received=await core('L2V7Modules.mammon.bagAfterClaim()');
 assert.equal(received.analysis.goal.to,1,JSON.stringify({received:received.analysis.goal,stored:(await analysis()).goal,cfg:(await h.get(['cfg'])).cfg.mmGoalLvl,local:await core('cfg.mmGoalLvl')}));
 assert.equal(received.ok,true);assert.equal((await analysis()).source,'mail');
 assert.equal((await analysis()).readyMaterials,true);assert.equal(reads,before+2,'получение почты перечитывает свежий кэш');

 before=reads;
 await core('setCfg({mmGoalLvl:2})');
 await until(async()=>(await analysis())?.goal?.to===2);
 assert.equal(reads,before,'смена цели пересчитывает план по свежему подтверждённому снимку');
 assert.equal((await analysis()).t,received.analysis.t,'пересчёт не выдумывает новое время чтения сумки');
 await core('INV_NET={...INV_NET,t:Date.now()-300001};setRt({mmBagAnalysis:{...rt.mmBagAnalysis,t:Date.now()-300001}})');
 assert.equal((await core('L2V7Modules.mammon.bagAuto()')).ok,true);
 assert.equal(reads,before+1,'после5мин нужен новый GET');

 await core('setCfg({autoTasks:[]})');before=reads;
 assert.equal(await core('L2V7Modules.mammon.bagAuto()'),null);assert.equal(reads,before,'без задачи Маммона автопроверки нет');
 await h.sw.evaluate(()=>chrome.storage.local.set({on:false}));await until(()=>core('!on'));await staysOff();
 assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: анализ сумки OFF,1874≠1893/0→13, ошибка/stale/чужой герой, без цели; автоанализ/5мин/получение/смена цели/разрешение задачи, без POST/маршрутов');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
