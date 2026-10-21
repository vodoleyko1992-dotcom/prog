'use strict';
// 21.10 (игрок: «Кнопка свернуть не работает и должна сворачивать выделенную часть», скрин «Выбранные задачи»): «Свернуть» прячет
// простые плитки (TvT, Тур по РБ… без счётчиков), плитки с лимитами остаются, скрытые — одной строкой; состояние переживает перезагрузку меню.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get(['cfg']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid','fish','auto','tvt','dailies'],dailyKillLimit:500,limitRanges:{}}})});
 await h.popup.reload();await h.openTab('overview');
 const vis=()=>h.popup.evaluate(()=>[...document.querySelectorAll('#taskBoardRows .task-row')].filter(e=>e.offsetParent).map(e=>e.querySelector('.task-name').textContent.replace(' ↗','').trim()));
 await until(async()=>(await vis()).length>=5);
 const all=await vis();assert.ok(all.includes('TvT')&&all.some(n=>/Тур/.test(n)),'all tiles shown: '+all);
 assert.equal(await h.popup.locator('#taskBoardFold').innerText(),'Свернуть');
 await h.popup.locator('#taskBoardFold').click();
 const min=await vis();assert.ok(!min.includes('TvT')&&!min.some(n=>/Тур|Дейлики/.test(n)),'plain tiles hidden: '+min);
 assert.ok(min.some(n=>/Автофарм/.test(n))&&min.some(n=>/Мобы за сутки/.test(n)),'tiles with counters stay: '+min);
 assert.match(await h.popup.locator('.task-folded').innerText(),/Свёрнуто:.*TvT/);
 assert.equal(await h.popup.locator('#taskBoardFold').innerText(),'Развернуть');
 assert.equal(await h.popup.locator('#quickModeGrid').isHidden(),true,'fold does not touch task list');
 await h.popup.reload();await h.openTab('overview');await until(async()=>(await h.popup.locator('#taskBoardRows .task-row').count())>=5);
 assert.deepEqual(await vis(),min,'folded state remembered');
 await h.popup.locator('.task-folded').click();assert.deepEqual((await vis()).length,all.length,'summary line unfolds');
 // «Изменить» раскрывает список галок, второе нажатие («Готово») его закрывает
 await h.popup.locator('#taskBoardEdit').click();assert.equal(await h.popup.locator('#quickModeGrid').isVisible(),true);assert.equal(await h.popup.locator('#taskBoardEdit').innerText(),'Готово');
 await h.popup.locator('#taskBoardEdit').click();assert.equal(await h.popup.locator('#quickModeGrid').isHidden(),true);
 assert.deepEqual(h.errors,[]);
 console.log('PASS v2143-taskboard-fold-browser');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
