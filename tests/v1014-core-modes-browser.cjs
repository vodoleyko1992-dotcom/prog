'use strict';
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 for(const task of ['mammon','quests','pvp','dailies','clan']) {
  // 20.5: async render может вернуть старый checked до завершения сохранения.
  // Native click + ожидание обоих результатов вместо синхронного assert внутри check/uncheck.
  const el=h.popup.locator('[data-auto-task="'+task+'"]');if(!await el.isChecked())await el.click();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks?.includes(task)&&await el.isChecked());assert.equal((await h.get(['on'])).on,false);
  await el.click();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes(task)&&!await el.isChecked());console.log('PASS task selection saves without starting',task);
 }
 for(const [button,task,expected] of [['farmToggle','farm','farm'],['autoFarmToggle','auto','farm'],['huntToggle','raid','raid'],['epicToggle','epic','epic'],['fishToggle','fish','fish'],['catToggle','cat','cat']]){
  await h.click(button);await until(async()=> (await h.get(['on'])).on&&await h.g.core('autonomyMode()')===expected,15000);
  assert.ok((await h.get(['cfg'])).cfg.autoTasks.includes(task));console.log('PASS task checkbox + Start → actual content',task);
  const el=h.popup.locator('[data-auto-task="'+task+'"]');await until(()=>el.isChecked());await el.click();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes(task)&&!await el.isChecked()&&await h.g.core('autonomyMode()==="tasks"'));assert.equal((await h.get(['on'])).on,true);
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
 }
 for(const button of ['campToggle','huntToggle2','epicToggle2','rbOneBtn']){
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:null,campaign:false,fishMode:true,rbHuntMode:false,epicMode:false,catMode:false,rbBetween:false,rbMode:false,zoneAuto:false},rt:{...rt,dailyFish:{t:Date.now(),day:'today',need:1,got:1,prev:{zoneAuto:true,fishMode:false}},dailyRb:{t:Date.now(),day:'today'},dailyDone:{fish:'today'}}})});
  await h.click(button);await until(async()=>{const s=await h.get(['rt','on']);return s.on&&s.rt.dailyFish===null&&s.rt.dailyRb===null});assert.equal((await h.get(['rt'])).rt.dailyDone.fish,'today');console.log('PASS actual direct mode button cancels old daily jobs',button);
  await h.click('stop');await until(async()=>!await h.g.core('on || running'),20000);
 }
 console.log('ERRORS',JSON.stringify(h.errors));assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
