'use strict';
// Интеграция UI с serialized botControl фона; настоящие MV3, API только локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.popup.evaluate(()=>{window.realSave=save;save=()=>new Promise(resolve=>window.finishSave=resolve);document.getElementById('start').click()});
 await until(()=>h.popup.evaluate(()=>typeof window.finishSave==='function'));
 await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await h.popup.evaluate(()=>{window.finishSave();save=window.realSave});await delay(100);assert.equal((await h.get(['on'])).on,false);
 console.log('PASS actual MV3 delayed settings ACK cannot re-enable bot after Stop');
 await h.sw.evaluate(()=>chrome.storage.local.set({on:false,paused:{t:Date.now()}}));await until(()=>h.popup.locator('#pause').innerText().then(t=>t.includes('Продолжить')));
 await h.popup.evaluate(()=>{window.realSet=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=data=>Object.keys(data).length===1&&data.paused===null?new Promise(resolve=>window.finishResume=()=>window.realSet(data).then(resolve)):window.realSet(data);document.getElementById('pause').click()});await until(()=>h.popup.evaluate(()=>typeof window.finishResume==='function'));
 await h.popup.locator('#stop').click();await until(async()=>(await h.get(['paused'])).paused===null);await h.popup.evaluate(()=>{window.finishResume();chrome.storage.local.set=window.realSet});await delay(100);assert.equal((await h.get(['on'])).on,false);
 console.log('PASS actual MV3 delayed Resume cannot re-enable bot after Stop');
 await h.popup.evaluate(()=>{window.realSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=request=>request.cmd==='botControl'?Promise.resolve({ok:false,reason:'fixture refusal'}):window.realSend(request)});await h.popup.locator('#stop').click();await until(()=>h.popup.locator('#controlWarn').isVisible());await h.popup.evaluate(()=>load());assert.match(await h.popup.locator('#controlWarn').innerText(),/fixture refusal/);await h.popup.evaluate(()=>{chrome.runtime.sendMessage=window.realSend});await h.popup.locator('#stop').click();await until(()=>h.popup.locator('#controlWarn').isHidden());
 assert.deepEqual(h.errors,[]);assert.equal((await h.get(['on'])).on,false);assert.ok(h.requests.every(r=>r.method==='GET'));console.log('PASS actual MV3 Stop refusal persists through repaint; successful retry clears warning, no actions or errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
