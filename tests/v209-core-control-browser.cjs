'use strict';
// Настоящий MV3, popup, IPC и две смены состояния; HTTPS ответы только локальные.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness();
 try{
  assert.equal(await h.sw.evaluate(()=>typeof L2EngineCore.selectedTask),'function','worker загрузил общее ядро');
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));
  const control=action=>h.popup.evaluate(action=>chrome.runtime.sendMessage({cmd:'botControl',action,source:'core-browser-test',reason:'Проверка управления'}),action);
  assert.equal((await control('pause')).ok,true);await until(()=>h.g.core('!on && !running'));
  assert.equal((await h.get(['paused'])).paused.why,'Проверка управления');
  await h.click('pause');await until(()=>h.g.core('on && running && tabOwner'));
  const stale=await h.g.core('ipc({cmd:"botControl",action:"stop",char:rt.char,epoch:"retired",kick:rt.manualKickAt||0})');
  assert.equal(stale.ok,false);assert.equal((await h.get(['on'])).on,true);
  assert.equal((await control('stop')).ok,true);await until(()=>h.g.core('!on && !running'));
  const state=await h.get(['on','paused','stopMeta']);assert.equal(state.on,false);assert.equal(state.paused,null);assert.equal(state.stopMeta.source,'core-browser-test');
  assert.deepEqual(h.errors,[]);console.log('PASS MV3 shared worker core, popup pause/resume, stale automatic stop rejected, manual Stop clears pause; local responses only');
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
