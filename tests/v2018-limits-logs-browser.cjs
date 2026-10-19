'use strict';
// 19.10: логи сразу видны в «Обзоре», лимиты имеют свой раздел; поля и выгрузка работают после переноса.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup,downloads=[];P.on('download',d=>downloads.push(d.suggestedFilename()));
 for(const [width,dock]of [[760,false],[360,true],[1100,true]]){
  await P.setViewportSize({width,height:850});await P.goto('chrome-extension://'+h.id+'/popup.html'+(dock?'?dock=1':''));
  await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('overview');
  await P.locator('#tab-overview').evaluate(e=>e.scrollTop=0);
  const pos=await P.evaluate(()=>{const log=document.querySelector('#logsAll').getBoundingClientRect(),tasks=document.querySelector('#taskBoard').getBoundingClientRect(),sec=document.querySelector('#tab-overview').getBoundingClientRect();return{log:log.top,tasks:tasks.top,top:sec.top,bottom:sec.bottom,logBottom:log.bottom,over:document.documentElement.scrollWidth>document.documentElement.clientWidth}});
  assert.ok(pos.log<pos.tasks&&pos.log>=pos.top&&pos.logBottom<=pos.bottom,JSON.stringify({width,pos}));assert.equal(pos.over,false);
  assert.equal(await P.locator('#moduleNav [data-tab="limits"]').isVisible(),true);
 }
 await P.locator('#logsAll').click();await until(async()=>(await P.locator('#logsNote').textContent()).includes('в «Загрузках»'),15000);
 assert.ok(downloads.some(n=>n.startsWith('l2bot-learn-')),JSON.stringify(downloads));assert.equal(await P.locator('#logsAll').isEnabled(),true);
 await h.openTab('limits');assert.equal(await P.locator('section.act').getAttribute('id'),'tab-limits');
 await until(()=>P.locator('#dailyFishLimit').inputValue().then(Boolean));await P.locator('#dailyFishLimit').fill('321');await P.locator('#dailyFishLimit').blur();
 await until(async()=>(await h.get(['cfg'])).cfg.dailyFishLimit===321);
 await h.reveal('#autoKillLimit');await P.locator('#autoKillLimit').fill('456');await P.locator('#autoKillLimit').blur();await until(async()=>(await h.get(['cfg'])).cfg.autoKillLimit===456);
 await P.reload();await until(()=>P.locator('#dailyFishLimit').inputValue().then(n=>n==='321'));
 assert.equal(await P.locator('section.act').getAttribute('id'),'tab-limits');assert.equal(await P.locator('#autoKillLimit').inputValue(),'456');
 await h.openTab('hunt');await P.locator('#tab-hunt [data-goto="limits"]').first().click();assert.equal(await P.locator('section.act').getAttribute('id'),'tab-limits');
 await h.openTab('overview');await P.locator('#uiSearch').fill('Рыбы в день');await until(()=>P.locator('#uiResults [data-i]').count());await P.locator('#uiResults [data-i]').first().click();
 assert.equal(await P.locator('section.act').getAttribute('id'),'tab-limits');assert.equal(await P.locator('#dailyFishLimit').isVisible(),true);
 await P.locator('#dailyFishLimit').blur();await P.keyboard.press('Alt+0');assert.equal(await P.locator('section.act').getAttribute('id'),'tab-svc');
 assert.equal((await h.get(['on'])).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS MV3: логи сверху на 360/760/1100px, настоящая выгрузка, отдельные лимиты, сохранение/перезагрузка/ссылки/поиск/Alt+0 без запуска бота');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
