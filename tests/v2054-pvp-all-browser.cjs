'use strict';
// 20.54 (John 23.10): раздел «PvP» отдельно от «TvT»: «Нападать на всех» ВКЛ, «Не трогать» = Teddy, tms, правка сохраняется в cfg
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const P=h.popup;
 await h.openTab('pvp');assert.equal(await P.locator('section.act').getAttribute('id'),'tab-pvp');
 assert.equal(await P.locator('#pvpAll').isVisible(),true);assert.equal(await P.locator('#pvpAll').isChecked(),true);
 assert.equal(await P.locator('#pvpSpare').inputValue(),'Teddy, tms');
 assert.equal(await P.locator('#tab-pvp #tvtOn').count(),0);
 await P.locator('#pvpSpare').fill('Teddy, tms, Friend');await P.locator('#pvpSpare').blur();
 await until(async()=>(await h.get(['cfg'])).cfg.pvpSpare==='Teddy, tms, Friend');
 await P.locator('#pvpAll').uncheck();await until(async()=>(await h.get(['cfg'])).cfg.pvpAll===false);
 await h.openTab('tvt');assert.equal(await P.locator('#tvtOn').isVisible(),true);assert.equal(await P.locator('section.act').getAttribute('id'),'tab-tvt');
 await P.evaluate(()=>showTab('tvtshop'));assert.equal(await P.locator('#tab-tvt').isVisible(),true);
 await P.evaluate(()=>showTab('enemies'));assert.equal(await P.locator('#tab-pvp').isVisible(),true);
 assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS v2054-pvp-all-browser: раздел PvP (бить всех, не трогать Teddy/tms, сохранение), TvT отдельно, без игровых POST');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
