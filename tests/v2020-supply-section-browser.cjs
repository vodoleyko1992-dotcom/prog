'use strict';
// 19.10: снабжение — отдельный раздел; настоящие обработчики меню и storage, без действий в игре.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup;
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,shopAuto:false,shopHp:'300/1000',shopReserve:123456,shopMaxSpend:654321}})});
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));
 assert.equal(await P.locator('#moduleNav [data-tab="supply"]').count(),1);
 await h.openTab('supply');assert.equal(await P.locator('section.act').getAttribute('id'),'tab-supply');
 for(const id of ['shopAuto','shopHp','shopMp','shopShots','shopSpirit','shopSoul','shopReserve','shopMaxSpend','shopNow','shopBox']){
  assert.equal(await P.locator('#'+id).count(),1,id+' без дублей');
  assert.equal(await P.locator('#'+id).evaluate(e=>e.closest('section').id),'tab-supply');
 }
 assert.equal(await P.locator('#shopHp').inputValue(),'300/1000');assert.equal(await P.locator('#shopReserve').inputValue(),'123456');
 await P.locator('#shopHp').fill('400/1200');await P.locator('#shopHp').blur();
 await until(async()=>(await h.get('cfg')).cfg.shopHp==='400/1200');
 await P.locator('#shopReserve').fill('234567');await P.locator('#shopReserve').blur();
 await until(async()=>(await h.get('cfg')).cfg.shopReserve===234567);
 await P.locator('#shopAuto').check();await until(async()=>(await h.get('cfg')).cfg.shopAuto===true);
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));
 assert.equal(await P.locator('#tab-supply').isVisible(),true);assert.equal(await P.locator('#shopHp').inputValue(),'400/1200');assert.equal(await P.locator('#shopReserve').inputValue(),'234567');assert.equal(await P.locator('#shopAuto').isChecked(),true);
 await P.locator('#tab-supply [data-goto="fish"]').click();assert.equal(await P.locator('#tab-fish').isVisible(),true);
 assert.equal(await P.locator('#fishBait').evaluate(e=>e.closest('section').id),'tab-fish');
 await P.locator('#tab-fish [data-goto="supply"]').click();assert.equal(await P.locator('#tab-supply').isVisible(),true);
 await h.openTab('rb');await P.locator('#tab-rb [data-goto="supply"]').click();assert.equal(await P.locator('#tab-supply').isVisible(),true);
 await h.openTab('overview');await P.locator('#uiSearch').fill('Spirit Ore');await until(()=>P.locator('#uiResults [data-i]').count());
 assert.match(await P.locator('#uiResults').innerText(),/Снабжение/);await P.locator('#uiResults [data-i]').first().click();assert.equal(await P.locator('#tab-supply').isVisible(),true);assert.equal(await P.locator('#shopSpirit').isVisible(),true);
 // 20.54 (прогон смоуков 23.10): «Крафт» третьим разделом (PR #358, 86cbe91) сдвинул горячие клавиши — «Рыбалка» Alt+7, Alt+0 — «TvT и PvP» (как в подсказках кнопок)
 for(const [key,tab]of [['7','fish'],['0','pvp']]){assert.match(await P.locator('#moduleNav [data-tab="'+tab+'"]').getAttribute('title'),new RegExp('\\(Alt\\+'+key+'\\)$'));await P.keyboard.press('Alt+'+key);assert.equal(await P.locator('#tab-'+tab).isVisible(),true,'Alt+'+key+' → '+tab);}
 for(const width of [360,760,1100]){
  await P.setViewportSize({width,height:850});await P.goto('chrome-extension://'+h.id+'/popup.html'+(width===760?'':'?dock=1'));
  await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('supply');
  assert.equal(await P.locator('#moduleNav [data-tab="supply"]').isVisible(),true);
  assert.equal(await P.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,width+' без прокрутки вбок');
 }
 assert.equal((await h.get('on')).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS MV3 supply: отдельный раздел, прежние значения/сохранение/reload/вкладка, поиск, ссылки РБ/рыбалки, Alt+7/0, 360/760/1100px, без игровых действий');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
