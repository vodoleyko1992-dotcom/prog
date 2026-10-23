'use strict';
// 23.10 (John: «Раздели режим РБ и ЭПИКИ, для удобства»): настоящий MV3 — кнопка «Эпики» открывает свой раздел, поля сохраняются,
// в «РБ» эпиков не видно, задача «Эпики» включается кнопкой нового раздела.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup;
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:['tvt']}})});await P.reload();
 await h.openTab('rb');assert.equal(await P.locator('section.act').getAttribute('id'),'tab-rb');
 assert.equal(await P.locator('#huntToggle2').isVisible(),true,'тур РБ в «РБ»');
 assert.equal(await P.locator('#epicToggle2').isVisible(),false,'эпиков в «РБ» нет');
 await P.locator('nav button[data-tab="epic"]').click();
 assert.equal(await P.locator('section.act').getAttribute('id'),'tab-epic');
 for(const f of ['#epicToggle2','#epicCoinDailyMax','#epicFaFull','#epicScan']) assert.equal(await P.locator(f).isVisible(),true,f);
 assert.equal(await P.locator('#huntToggle2').isVisible(),false,'тура РБ в «Эпиках» нет');
 await P.locator('#epicCoinDailyMax').fill('3');await P.locator('#epicCoinDailyMax').blur();
 await until(async()=>(await h.get(['cfg'])).cfg.epicCoinDailyMax===3);
 await P.locator('#epicToggle2').click();
 await until(async()=>((await h.get(['cfg'])).cfg.autoTasks||[]).includes('epic'));
 await until(async()=>/ВКЛ/.test(await P.locator('#epicToggle2').innerText()));
 assert.deepEqual(h.errors,[]);
 console.log('PASS v2054-rb-epic-split-browser: «РБ» и «Эпики» — разные разделы, поля эпиков сохраняются, задача включается из нового раздела');
}catch(e){console.error('FAIL v2054-rb-epic-split-browser:',e);process.exitCode=1}finally{await h.ctx.close()}})();
