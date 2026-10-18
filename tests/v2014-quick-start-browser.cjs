'use strict';
// 18.10: настоящее MV3-меню — быстрый запуск виден, пока бот стоит; «Рыбалка» заменяет основные дела, сохраняет фоновые и включает бота.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const errors=[];h.popup.on('pageerror',e=>errors.push(e.message));
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:false,paused:null,cfg:{...cfg,autoTasks:['tvt','quests','farm','mammon'],campaign:true}})});
 for(const [width,height] of [[800,600],[360,720]]){
  await h.popup.setViewportSize({width,height});await h.popup.reload();await until(()=>h.popup.locator('#quickStart').isVisible());
  const m=await h.popup.evaluate(()=>({header:document.querySelector('header').offsetHeight,h:document.documentElement.scrollWidth>document.documentElement.clientWidth,cut:[...document.querySelectorAll('#quickStart button')].some(b=>b.scrollWidth>b.clientWidth+1)}));
  assert.ok(m.header<=200&&!m.h&&!m.cut,width+' '+JSON.stringify(m));
 }
 await h.popup.locator('#quickStart [data-quick-task="fish"]').click();
 await until(async()=>(await h.get(['on'])).on===true);
 const s=await h.get(['cfg','on']);assert.deepEqual(s.cfg.autoTasks,['tvt','mammon','fish']);assert.equal(s.cfg.campaign,false);
 await until(async()=>!(await h.popup.locator('#quickStart').isVisible()));
 assert.deepEqual(errors,[]);
 console.log('PASS actual MV3 quick start: visible when stopped, fits 800/360, one main task kept with background tasks, bot started');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
