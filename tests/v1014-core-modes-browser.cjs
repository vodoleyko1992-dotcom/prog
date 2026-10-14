'use strict';
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 for(const key of ['mmOrders','mmUpgrade','mmCraftSend','storyTurnIn','enemyHunt','dailyAuto','clanTasks']) {
  const click=()=>h.popup.evaluate(key=>document.querySelector('#quickModeGrid [data-task="'+key+'"]').click(),key);
  await click();await until(async()=>!!(await h.get(['cfg'])).cfg[key]);assert.equal((await h.get(['on'])).on,false);
  await click();await until(async()=>!(await h.get(['cfg'])).cfg[key]);assert.equal((await h.get(['cfg'])).cfg.taskOnly,true);
  console.log('PASS quick task toggle сохраняет режим и off',key);
 }
 for(const [button,expected] of [['tasksToggle','tasks'],['farmToggle','farm'],['autoFarmToggle','farm'],['huntToggle','raid'],['epicToggle','epic'],['fishToggle','fish'],['catToggle','cat']]){
  await h.click(button);await until(async()=>{const {cfg,on}=await h.get(['cfg','on']);return button==='tasksToggle'?cfg.taskOnly&&!on:on&&await h.g.core('autonomyMode()')===expected},15000);
  const s=await h.get(['cfg','on']);const flags=['epicMode','rbHuntMode','fishMode','catMode','taskOnly'].filter(k=>s.cfg[k]);assert.ok(flags.length<=1);console.log('PASS popup mode → persisted cfg → actual content decision',JSON.stringify({button,expected,flags,zoneAuto:!!s.cfg.zoneAuto,on:s.on,page:new URL(h.g.p.url()).pathname}));
  if(button!=='tasksToggle'){await h.click(button);await until(async()=>{const s=await h.get(['cfg','on']);return s.cfg.taskOnly&&s.on});assert.equal((await h.get(['on'])).on,true);console.log('PASS re-click removes mode, keeps task engine running');await h.click('stop');await until(async()=>!await h.g.core('on || running'),20000)}
 }
 for(const button of ['campToggle','huntToggle2','epicToggle2','rbOneBtn','rbToggle']){
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,campaign:false,fishMode:true,rbHuntMode:false,epicMode:false,catMode:false,rbBetween:false,rbMode:false,zoneAuto:false},rt:{...rt,dailyFish:{t:Date.now(),day:'today',need:1,got:1,prev:{zoneAuto:true,fishMode:false}},dailyRb:{t:Date.now(),day:'today'},dailyDone:{fish:'today'}}})});
  await h.click(button);await until(async()=>{const s=await h.get(['rt','on']);return s.on&&s.rt.dailyFish===null&&s.rt.dailyRb===null});assert.equal((await h.get(['rt'])).rt.dailyDone.fish,'today');console.log('PASS actual direct mode button cancels old daily jobs',button);
  await h.click('stop');await until(async()=>!await h.g.core('on || running'),20000);
 }
 console.log('ERRORS',JSON.stringify(h.errors));assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
