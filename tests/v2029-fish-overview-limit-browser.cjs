'use strict';
// Настоящий MV3; локальные ответы игры. «Обзор» показывает лимит, не изменяя настройки и не запуская бота.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.env.L2_REPO||path.join(__dirname,'..'));
const {harness,until}=require(path.join(root,'tests/v1014-core-lifecycle-browser.cjs'));
const E=require(path.join(root,'engine-core.js'));
(async()=>{const h=await harness(),failures=[];try{
 const P=h.popup,day=E.dailyDay(Date.now()),range={min:1511,max:1564};
 // Считаем и попытки записи из popup: равенство конечной cfg само по себе не обнаружит запись с откатом.
 await P.addInitScript(()=>{
  window.fishOverviewWrites=[];
  const set=chrome.storage.local.set.bind(chrome.storage.local),send=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.storage.local.set=(values,...args)=>{if(values&&['cfg','on'].some(key=>Object.hasOwn(values,key)))window.fishOverviewWrites.push({via:'storage',keys:Object.keys(values)});return set(values,...args);};
  chrome.runtime.sendMessage=(message,...args)=>{if(message&&(message.cfg||message.cfgPatch||Object.hasOwn(message,'on')))window.fishOverviewWrites.push({via:'message',cmd:message.cmd});return send(message,...args);};
 });
 const row=P.locator('#taskBoardRows .task-row:has(.task-name[data-task-tab="fish"]), #taskBoardRows .task-row[data-task-summary="fish"]');
 async function ready(){await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('overview');await until(()=>row.count().then(n=>n===1));}
 async function readonly(expected){
  assert.deepEqual((await h.get('cfg')).cfg,expected,'просмотр не изменяет cfg');assert.equal((await h.get('on')).on,false);
  assert.deepEqual(await P.evaluate(()=>window.fishOverviewWrites),[],'popup не отправляет запись cfg/on');
 }
 async function seed(kind){
  await h.sw.evaluate(async({kind,day,range})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:kind==='fishunselected'?['raid']:['raid','fish'],dailyKillLimit:8000,dailyFishLimit:kind==='unlimited'?0:1511,fishMaxCasts:0,limitRanges:['unlimited','fishunselected'].includes(kind)?{}:{dailyFishLimit:range}},
    rt:{...rt,dailyQuota:{basis:'server',day,auto:0,cat:0,raid:0,fish:100},limitRolls:kind==='exact'?{dailyFishLimit:{basis:'server',day,...range,value:1511,seq:1}}:{},fish:null,fishTgt:null}});
  },{kind,day,range});
  const expected=(await h.get('cfg')).cfg;await P.reload();await ready();return expected;
 }
 async function linksAndReload(expected,check){
  assert.equal(await row.locator('.task-progress [data-task-tab="limits"]').count(),1,'у рыбалки всегда доступен переход «Лимиты»');
  await row.locator('.task-progress [data-task-tab="limits"]').click();assert.equal(await P.locator('#tab-limits').isVisible(),true);await readonly(expected);
  await P.reload();await ready();await check();await readonly(expected);
 }
 const scenarios=[
  ['pending',async expected=>{
   const check=async()=>{const text=await row.innerText();assert.match(text,/Сегодня:\s*100\b/);assert.match(text,/1511\s*[–—-]\s*1564/);assert.doesNotMatch(text,/осталось\s+\d/);assert.equal(await row.locator('[role="progressbar"]').count(),0,'до выбора цели нет ложного процента');};
   await check();await linksAndReload(expected,check);
   for(const width of [360,760,1100]){
    await readonly(expected);await P.setViewportSize({width,height:850});await P.goto('chrome-extension://'+h.id+'/popup.html'+(width===760?'':'?dock=1'));await ready();await check();
    assert.equal(await P.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,width+'px: нет горизонтальной прокрутки');
    assert.equal(await row.locator('[data-task-tab="limits"]').isVisible(),true);await readonly(expected);
   }
  }],
  ['exact',async expected=>{
   const check=async()=>{const text=await row.innerText();assert.match(text,/Сегодня:\s*100\s*\/\s*1511/);assert.match(text,/осталось\s+1411/);assert.doesNotMatch(text,/1511\s*[–—-]\s*1564/);assert.equal(await row.locator('[role="progressbar"]').getAttribute('aria-valuenow'),'7');};
   await check();await linksAndReload(expected,check);
  }],
  ['unlimited',async expected=>{
   const check=async()=>{assert.equal(await row.locator('[data-task-tab="limits"]').count(),1,'нулевой лимит тоже имеет ссылку «Лимиты»');const text=await row.innerText();assert.match(text,/Сегодня:\s*100\b/);assert.match(text,/без (?:дневного )?лимита/i);assert.doesNotMatch(text,/100\s*\/\s*0|осталось\s+\d/);assert.equal(await row.locator('[role="progressbar"]').count(),0);};
   await check();await linksAndReload(expected,check);
  }],
  ['fishunselected',async expected=>{
   const check=async()=>{
    assert.equal(await row.getAttribute('data-task-summary'),'fish','без выбранной задачи остаётся дневная сводка');
    assert.match(await row.innerText(),/Сегодня:\s*100\s*\/\s*1511/);assert.match(await row.innerText(),/осталось\s+1411/);
    assert.match(await P.locator('#taskBoardNote').innerText(),/^Выбрано:\s*1\./,'сводка не увеличивает число выбранных задач');
    assert.equal(await P.locator('[data-auto-task="fish"]').isChecked(),false,'показ счётчика не включает рыбалку');
   };
   await check();await linksAndReload(expected,check);assert.deepEqual(expected.autoTasks,['raid']);
  }]
 ];
 // Независимые состояния: baseline должен показать и исчезнувшие числа диапазона, и потерянную ссылку при 0.
 for(const [kind,verify] of scenarios){
  try{const expected=await seed(kind);await verify(expected);await readonly(expected);console.log('PASS actual MV3 fish overview '+kind+': counter/limit/link/reload, cfg/on unchanged');}
  catch(error){failures.push({scenario:kind,message:error.message});console.error('FAIL '+kind+': '+error.message);}
 }
 assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(request=>request.method==='GET'),'просмотр не отправляет игровые POST');
 assert.deepEqual(failures,[]);console.log('PASS actual MV3 fish overview: 1511–1564 pending, exact1511, unlimited0, fish unselected summary, 360/760/1100px, no cfg/on writes or game POST');
 }finally{await h.ctx.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
