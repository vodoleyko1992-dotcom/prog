'use strict';
// Полное расширение, ответы игры локальные: проверяем явное включение без покупки.
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,petFullAuto:false,petFullBudget:10000000},rt:{...rt,_src:'panther-ui-fixture',classCur:{prof:'human_dark_avenger',slot:0},petFull:{spent:10000000}}});});
 await h.popup.reload();await until(()=>h.popup.locator('#petFullToggle').isEnabled());
 await h.popup.evaluate(()=>showTab('warlock'));
 assert.match(await h.popup.locator('#warlockPanel').innerText(),/пантере Dark Avenger \/ Hell Knight/);
 assert.equal(await h.popup.locator('[data-field="petFullAuto"]').isChecked(),false);
 assert.equal((await h.get(['cfg'])).cfg.petFullAuto,false);
 await h.openTab('warlock');await h.popup.locator('#petFullToggle').click();await until(async()=> (await h.get(['cfg'])).cfg.petFullAuto===true);
 let s=await h.get(['cfg','rt','on']);assert.equal(s.on,false);assert.equal(s.cfg.petFullBudget,10000000);assert.equal(s.rt.petFull.spent,10000000);
 await until(()=>h.popup.locator('#petFullToggle').isEnabled());await h.openTab('warlock');await h.popup.locator('#petFullToggle').click();await until(async()=> (await h.get(['cfg'])).cfg.petFullAuto===false);
 console.log('PASS Dark Avenger: выключено до нажатия; кнопка не запускает бота и не сбрасывает бюджет');
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,_src:'panther-ui-fixture',classCur:{prof:'human_hell_knight',slot:0}}});});
 await h.popup.reload();await until(()=>h.popup.locator('#petFullToggle').isEnabled());assert.equal((await h.get(['cfg'])).cfg.petFullAuto,false);
 assert.equal(h.requests.filter(x=>x.method==='POST').length,0);assert.deepEqual(h.errors,[]);
 console.log('PASS Hell Knight: кнопка доступна, автоматического включения и платных запросов нет; ошибок JS нет');
}finally{await h.ctx.close();}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
