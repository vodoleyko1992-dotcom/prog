'use strict';
// 18.10: настоящее меню — режим задач со старым rbHuntMode=true: «Тур по РБ» выключается и показывает ВЫКЛ; «Выключить один РБ».
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const errors=[];h.popup.on('pageerror',e=>errors.push(e.message));
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid','fish'],rbHuntMode:true,epicMode:true},rt:{...(rt||{}),rbOne:{on:true,n:1,last:Date.now()}}})});
 await h.popup.reload();await h.openTab('rb');
 const b=h.popup.locator('#huntToggle2');await until(async()=>/ВКЛ/.test(await b.innerText()));
 assert.match(await h.popup.locator('#epicToggle2').innerText(),/ВЫКЛ/,'эпики не в списке задач');
 assert.equal(await h.popup.locator('#rbOneOff').isVisible(),true);
 await b.click();await until(async()=>/ВЫКЛ/.test(await b.innerText()));
 let s=await h.get(['cfg','rt']);assert.deepEqual(s.cfg.autoTasks,['fish']);assert.equal(s.rt.rbOne.on,false);
 await until(async()=>!(await h.popup.locator('#rbOneOff').isVisible()));
 await b.click();await until(async()=>/ВКЛ/.test(await b.innerText()));
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,rbOne:{on:true,n:2}}})});
 await until(()=>h.popup.locator('#rbOneOff').isVisible());await h.popup.locator('#rbOneOff').click();
 await until(async()=>/ВЫКЛ/.test(await b.innerText()));s=await h.get(['cfg','rt']);assert.ok(!s.cfg.autoTasks.includes('raid'));assert.equal(s.rt.rbOne.on,false);
 assert.deepEqual(errors,[]);console.log('PASS actual MV3: тур по РБ выключается в режиме задач, «один РБ» выключается отдельной кнопкой');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
