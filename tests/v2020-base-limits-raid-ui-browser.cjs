'use strict';
// 19.10: заводские дневные цели и переключатель приоритета РБ; настоящее меню, без игры.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({cleanInstall:true});try{
 const P=h.popup;
 const {cfg}=await h.get('cfg');
 assert.equal(cfg.dailyKillLimit,8000);assert.equal(cfg.limitRanges?.dailyKillLimit,undefined);
 assert.equal(cfg.dailyFishLimit,1511);assert.deepEqual(cfg.limitRanges.dailyFishLimit,{min:1511,max:1564});assert.equal(cfg.rbScrollFirst,true);
 await h.openTab('limits');assert.equal(await P.locator('#dailyKillLimit').inputValue(),'8000');
 assert.equal(await P.locator('#dailyKillLimitFrom').inputValue(),'');assert.equal(await P.locator('#dailyKillLimitTo').inputValue(),'');
 assert.equal(await P.locator('#dailyFishLimitFrom').inputValue(),'1511');assert.equal(await P.locator('#dailyFishLimitTo').inputValue(),'1564');
 await P.locator('#uiSearch').fill('Сначала РБ с заточками');await until(()=>P.locator('#uiResults [data-i]').count());await P.locator('#uiResults [data-i]').first().click();
 assert.equal(await P.locator('section.act').getAttribute('id'),'tab-rb');assert.equal(await P.locator('#rbScrollFirst').isVisible(),true);assert.equal(await P.locator('#rbScrollFirst').isChecked(),true);
 await P.locator('#rbScrollFirst').uncheck();await until(async()=>(await h.get('cfg')).cfg.rbScrollFirst===false);
 await P.reload();await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.reveal('#rbScrollFirst');assert.equal(await P.locator('#rbScrollFirst').isChecked(),false);
 await P.locator('#rbScrollFirst').check();await until(async()=>(await h.get('cfg')).cfg.rbScrollFirst===true);
 for(const width of [360,760,1100]){
  await P.setViewportSize({width,height:850});await P.goto('chrome-extension://'+h.id+'/popup.html'+(width===760?'':'?dock=1'));
  await until(()=>P.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.reveal('#rbScrollFirst');
  assert.equal(await P.locator('#rbScrollFirst').isVisible(),true);assert.equal(await P.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
 }
 assert.notEqual((await h.get('on')).on,true);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS MV3: база8000бездиапазона/рыба1511–1564, экспериментальныйприоритетРБ, поиск/сохранение/reload/360–1100px, безигры');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
