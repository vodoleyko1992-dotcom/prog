'use strict';
// 19.10: общий дневной счётчик виден рядом с рыбалкой без выбора охоты, только синтетический storage.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup,day=new Date(Date.now()+10*3600000).toISOString().slice(0,10);
 await h.sw.evaluate(async day=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid','fish'],dailyKillLimit:8000,dailyFishLimit:1511,limitRanges:{}},rt:{...rt,dailyQuota:{day,auto:1200,cat:300,raid:500,fish:100}}})},day);
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('overview');
 const row=P.locator('#taskBoardRows [data-task-summary="mobs"]');assert.equal(await row.count(),1);
 assert.match(await row.innerText(),/Мобы за сутки/);assert.match(await row.innerText(),/Сегодня: 2000 \/ 8000/);assert.match(await row.innerText(),/осталось 6000/);
 assert.equal(await row.locator('[role="progressbar"]').getAttribute('aria-valuenow'),'25');
 assert.match(await row.evaluate(e=>e.previousElementSibling.textContent),/Рыбалка/);
 assert.match(await P.locator('#taskBoardNote').innerText(),/Выбрано: 2\./);
 await row.locator('[data-task-tab="limits"]').first().click();assert.equal(await P.locator('#tab-limits').isVisible(),true);
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,dailyQuota:{...rt.dailyQuota,raid:6500}}})});
 await h.openTab('overview');await until(()=>row.innerText().then(t=>t.includes('8000 / 8000')));assert.match(await row.innerText(),/Лимит достигнут/);assert.match(await row.innerText(),/осталось 0/);
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('overview');assert.match(await row.innerText(),/8000 \/ 8000/);
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,dailyQuota:{day:'2000-01-01',auto:9000,cat:1000,raid:1000}}})});
 await until(()=>row.innerText().then(t=>t.includes('Сегодня: 0 / 8000')));
 for(const width of [360,760,1100]){
  await P.setViewportSize({width,height:850});await P.goto('chrome-extension://'+h.id+'/popup.html'+(width===760?'':'?dock=1'));
  await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('overview');assert.equal(await row.count(),1);
  assert.equal(await P.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,width+' без прокрутки вбок');
 }
 assert.deepEqual((await h.get('cfg')).cfg.autoTasks,['raid','fish']);assert.equal((await h.get('on')).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS MV3 daily mobs: рядом с рыбалкой, сумма трёх источников, остаток/полоса, лимиты/reload/смена дня, 360–1100px, задачи не меняются');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
