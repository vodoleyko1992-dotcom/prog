'use strict';
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.popup.setViewportSize({width:360,height:720});
 const errors=[];h.popup.on('pageerror',e=>errors.push(e.message));
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:null,fishMode:true,rbHuntMode:false,taskOnly:false,mmCraftSend:true,mmCrafter:'Crafter',shopReserve:456789,fishMaxCasts:12}})});
 await h.popup.reload();await until(()=>h.popup.locator('[data-auto-task="fish"]').isChecked());
 assert.equal(await h.popup.locator('#quickModeGrid button,#tasksToggle,#farmToggle,#fishToggle,#tvtToggle').count(),0);
 assert.equal(await h.popup.locator('#start,#stop,#pause').count(),3);
 assert.match(await h.popup.locator('#modeToggle').innerText(),/Задачи бота/);
 let s=await h.get(['cfg','on']);assert.equal(s.cfg.autoTasks,null);assert.equal(s.on,false);
 await h.tasks();   // 20.12 (ревизия 17.10): задачи — в «Обзоре», свёрнуты по умолчанию
 await h.popup.locator('[data-auto-task="raid"]').check();
 await until(async()=>Array.isArray((await h.get(['cfg'])).cfg.autoTasks));
 s=await h.get(['cfg','on']);assert.ok(s.cfg.autoTasks.includes('raid')&&s.cfg.autoTasks.includes('fish'));assert.equal(s.on,false);assert.equal(s.cfg.mmCraftSend,true);assert.equal(s.cfg.mmCrafter,'Crafter');assert.equal(s.cfg.shopReserve,456789);assert.equal(s.cfg.fishMaxCasts,12);
 await h.popup.locator('[data-auto-task="fish"]').uncheck();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
 await h.popup.reload();await until(()=>h.popup.locator('[data-auto-task="raid"]').isChecked());assert.equal(await h.popup.locator('[data-auto-task="fish"]').isChecked(),false);
 await h.popup.locator('#modeToggle').click();assert.equal(await h.popup.locator('#autoTaskSelection').isVisible(),false);await h.popup.locator('#modeToggle').click();assert.equal(await h.popup.locator('#autoTaskSelection').isVisible(),true);
 await h.openTab('warlock');   // 20.12 (ревизия 17.10): подраздел «Боя и класса»
 assert.equal(await h.popup.locator('#petFullToggle').isVisible(),true);
 await h.openTab('overview');
 const tasks=h.popup.locator('#autoTaskSelection [data-auto-task]');
 for(let i=0;i<await tasks.count();i++){await tasks.nth(i).scrollIntoViewIfNeeded();assert.equal(await tasks.nth(i).isVisible(),true);await tasks.nth(i).click({trial:true});}
 await h.popup.screenshot({path:'/tmp/v202-popup-task-selection-scrolled.png',fullPage:true});
 await h.popup.evaluate(()=>{document.querySelector('header').scrollTop=0;window.scrollTo(0,0)});
 await h.popup.screenshot({path:'/tmp/v202-popup-task-selection.png',fullPage:true});assert.deepEqual(errors,[]);assert.equal((await h.get(['on'])).on,false);
 console.log('PASS actual MV3 single task selector: legacy display/migration, no autostart, settings preserved, reload, disclosure, Warlock control and no popup errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
