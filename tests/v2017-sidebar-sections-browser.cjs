'use strict';
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup;
 await h.sw.evaluate(async()=>{const{rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({rt:{...rt,weaponAug:{w:123,e:7,o:'prominence',g:'A'},weapons:[{id:123,name:'Тестовый посох',where:'надето'}],panel:[{cdKey:'ls_prominence'}]},cfg:{...cfg,mmTpMax:345000,sealMin:123,sealAuto:true}})});
 await P.reload();await until(()=>P.locator('#lsCurrent').textContent().then(s=>s.includes('Тестовый посох')));
 for(const [tab,field]of [['mammon','#mmTpMax'],['enchant','#enchantPanel'],['lifestone','#sealAuto'],['pvp','#pvpAll'],['tvt','#tvtOn'],['epic','#epicCoinDailyMax'],['svc','#cfgExport']]){
  await h.openTab(tab);assert.equal(await P.locator(field).isVisible(),true,tab);assert.equal(await P.locator('section.act').getAttribute('id'),'tab-'+tab);
 }
 await h.openTab('mammon');assert.equal(await P.locator('#mmTpMax').inputValue(),'345000');
 await P.locator('#mmTpMax').fill('400000');await P.locator('#mmTpMax').blur();await until(async()=>(await h.get(['cfg'])).cfg.mmTpMax===400000);
 await P.locator('[data-goto="lifestone"]').click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);
 assert.equal(await P.locator('#sealMin').inputValue(),'123');await P.locator('#sealMin').fill('456');await P.locator('#sealMin').blur();await until(async()=>(await h.get(['cfg'])).cfg.sealMin===456);
 assert.match(await P.locator('#lsCurrent').textContent(),/умение на панели ✓/);
 await P.reload();await until(()=>P.locator('#lsCurrent').textContent().then(s=>s.includes('Тестовый посох')));assert.equal(await P.locator('#tab-lifestone').isVisible(),true);assert.equal(await P.locator('#sealMin').inputValue(),'456');
 await h.reveal('[data-goto="seals"]');await P.locator('[data-goto="seals"]').click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);assert.equal(await P.locator('#sealNow').isVisible(),true);
 await P.keyboard.press('Alt+8');assert.equal(await P.locator('#tab-lifestone').isVisible(),true);
 await P.keyboard.press('Alt+9');assert.equal(await P.locator('#tab-pvp').isVisible(),true);
 await P.keyboard.press('Alt+0');assert.equal(await P.locator('#tab-svc').isVisible(),true);
 await P.locator('#uiSearch').fill('Life Stone');await until(()=>P.locator('#uiResults [data-i]').count());await P.locator('#uiResults [data-i]').first().click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);
 await P.setViewportSize({width:1100,height:850});await P.screenshot({path:__dirname+'/../work/sidebar-lifestone.png'});
 assert.equal((await h.get(['on'])).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS sidebar: Маммон/заточка/ЛС/PvP/сервис напрямую, сохранение настроек и вкладки, AA по ссылкам, Alt+8/9/0, поиск, без игровых POST');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
