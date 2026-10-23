'use strict';
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
// 20.54 (прогон смоуков 23.10): «Автозаточка» временно убрана решением игрока (19.10, после 20.25) — кнопка hidden, showTab('enchant') → «Обзор»,
// разметка #enchantPanel сохранена для восстановления. «Крафт» (PR #358, 86cbe91) встал третьим разделом: Alt+3…0 сдвинулись на один
// (подсказки кнопок — «Маммон (Alt+8)», «ЛС (Alt+9)», с #378 «PvP (Alt+0)»), у «Сервиса» и нового «TvT» горячей клавиши больше нет — открываем кнопкой.
(async()=>{const h=await harness();try{
 const P=h.popup;
 await h.sw.evaluate(async()=>{const{rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({rt:{...rt,weaponAug:{w:123,e:7,o:'prominence',g:'A'},weapons:[{id:123,name:'Тестовый посох',where:'надето'}],panel:[{cdKey:'ls_prominence'}]},cfg:{...cfg,mmTpMax:345000,sealMin:123,sealAuto:true}})});
 await P.reload();await until(()=>P.locator('#lsCurrent').textContent().then(s=>s.includes('Тестовый посох')));
 assert.equal(await P.locator('#moduleNav [data-tab="enchant"]').isVisible(),false,'кнопка автозаточки скрыта');await P.evaluate(()=>showTab('enchant'));
 assert.equal(await P.locator('section.act').getAttribute('id'),'tab-overview','enchant → Обзор');assert.equal(await P.locator('#enchantPanel').count(),1,'разметка заточки сохранена');assert.equal(await P.locator('#enchantPanel').isVisible(),false);
 for(const [tab,field]of [['mammon','#mmTpMax'],['lifestone','#sealAuto'],['pvp','#pvpAll'],['tvt','#tvtOn'],['epic','#epicCoinDailyMax'],['svc','#cfgExport']]){  // 23.10 (#378): PvP и TvT — отдельные разделы; «Эпики» — отдельно от «РБ»
  await h.openTab(tab);assert.equal(await P.locator(field).isVisible(),true,tab);assert.equal(await P.locator('section.act').getAttribute('id'),'tab-'+tab);
 }
 await h.openTab('mammon');assert.equal(await P.locator('#mmTpMax').inputValue(),'345000');
 await P.locator('#mmTpMax').fill('400000');await P.locator('#mmTpMax').blur();await until(async()=>(await h.get(['cfg'])).cfg.mmTpMax===400000);
 await P.locator('[data-goto="lifestone"]').click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);
 assert.equal(await P.locator('#sealMin').inputValue(),'123');await P.locator('#sealMin').fill('456');await P.locator('#sealMin').blur();await until(async()=>(await h.get(['cfg'])).cfg.sealMin===456);
 assert.match(await P.locator('#lsCurrent').textContent(),/умение на панели ✓/);
 await P.reload();await until(()=>P.locator('#lsCurrent').textContent().then(s=>s.includes('Тестовый посох')));assert.equal(await P.locator('#tab-lifestone').isVisible(),true);assert.equal(await P.locator('#sealMin').inputValue(),'456');
 await h.reveal('[data-goto="seals"]');await P.locator('[data-goto="seals"]').click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);assert.equal(await P.locator('#sealNow').isVisible(),true);
 for(const [key,tab]of [['8','mammon'],['9','lifestone'],['0','pvp']]){assert.match(await P.locator('#moduleNav [data-tab="'+tab+'"]').getAttribute('title'),new RegExp('\\(Alt\\+'+key+'\\)$'));await P.keyboard.press('Alt+'+key);assert.equal(await P.locator('#tab-'+tab).isVisible(),true,'Alt+'+key+' → '+tab);}
 await P.locator('#moduleNav [data-tab="svc"]').click();assert.equal(await P.locator('#tab-svc').isVisible(),true);
 await P.locator('#uiSearch').fill('Life Stone');await until(()=>P.locator('#uiResults [data-i]').count());await P.locator('#uiResults [data-i]').first().click();assert.equal(await P.locator('#tab-lifestone').isVisible(),true);
 await P.setViewportSize({width:1100,height:850});await P.screenshot({path:require('node:path').join(process.env.L2_SHOTS||require('node:os').tmpdir(),'sidebar-lifestone.png')});
 assert.equal((await h.get(['on'])).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS sidebar: Маммон/ЛС/PvP/сервис напрямую, автозаточка скрыта (→ Обзор), сохранение настроек и вкладки, AA по ссылкам, Alt+8/9/0 как в подсказках, поиск, без игровых POST');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
