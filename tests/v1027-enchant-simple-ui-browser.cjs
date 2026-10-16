'use strict';
// Простое меню на искусственных данных: без игровых запросов и платежей.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:840}});await page.setContent('<div id="enchantPanel"></div>');await page.addStyleTag({path:__dirname+'/../enchant-ui.css'});await page.addScriptTag({path:__dirname+'/../enchant-ui.js'});
 await page.evaluate(async()=>{window.calls=[];window.state={on:true,cfg:{enchantMode:true,enchant:{enabled:false,maxAttempts:0,maxScrolls:0,queue:[{key:'one',name:'Меч',level:2,targetLevel:3,grade:'A',category:'weapon'}]}},rt:{char:'Hero',enchant:{status:'idle'}}};window.ui=L2EnchantUI.mount(document.querySelector('#enchantPanel'),{getState:async()=>structuredClone(state),saveConfig:async cfg=>{state.cfg.enchant=cfg;},command:async c=>calls.push(c),refreshItems:async()=>{}});await ui.ready;});
 assert.equal(await page.locator('[data-global][data-field="maxAttempts"]').isVisible(),true);assert.equal(await page.locator('[data-global][data-field="maxDropFromPeak"]').isVisible(),false);assert.equal(await page.locator('.ench-metrics').isVisible(),false);assert.equal(await page.locator('[data-command="start"]').isDisabled(),true);
 await page.locator('[data-detail=permission]>summary').click();await page.locator('[data-cfg="enabled"]').check();await page.waitForFunction(()=>state.cfg.enchant.enabled);assert.equal(await page.locator('[data-command="start"]').isDisabled(),true);
 await page.locator('[data-detail=limits]>summary').click();
 for(const name of ['maxAttempts','maxScrolls']){const el=page.locator(`[data-global][data-field="${name}"]`);await el.fill('3');await el.dispatchEvent('change');await page.waitForFunction(n=>state.cfg.enchant[n]===3,name);}
 assert.equal(await page.locator('[data-command="start"]').isEnabled(),true);assert.deepEqual(await page.evaluate(()=>calls),[]);
 await page.locator('[data-cfg="delayMs"]').fill('1800');await page.locator('[data-cfg="delayMs"]').dispatchEvent('change');await page.waitForFunction(()=>state.cfg.enchant.delayMs===1800);assert.equal(await page.locator('[data-detail="limits"]').getAttribute('open'),'');
 await page.locator('[data-detail="item:one"]>summary').click();await page.evaluate(()=>ui.refresh());assert.equal(await page.locator('[data-detail="item:one"]').getAttribute('open'),'');
 await page.locator('[data-command="start"]').click();await page.waitForFunction(()=>calls.length===1);assert.deepEqual(await page.evaluate(()=>calls),['start']);
 await page.evaluate(async()=>{state.rt.enchant={runId:'run',status:'running'};await ui.refresh();});assert.equal(await page.locator('[data-command="pause"]').count(),1);assert.equal(await page.locator('[data-command="start"],[data-command="resume"]').count(),0);
 await page.evaluate(async()=>{state.rt.enchant.status='paused';await ui.refresh();});assert.equal(await page.locator('[data-command="resume"]').isEnabled(),true);
 await page.evaluate(async()=>{state.rt.enchant.pending={id:'unknown',state:'unknown',before:2};state.analytics=state.rt.enchant;await ui.refresh();});assert.equal(await page.locator('[data-command="resume"]').isDisabled(),true);assert.equal(await page.locator('[data-archive-begin]').isVisible(),true);assert.equal(await page.locator('[data-command="archiveUnknown"]').count(),0);
 await page.evaluate(async()=>{state.rt.char='Other';await ui.refresh();});assert.equal(await page.locator('[data-detail="limits"]').getAttribute('open'),null);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.ench-section').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(33, 26, 20)');console.log('PASS simple enchant UI: limits, explicit commands, disclosure persistence/profile isolation, pending protection, narrow layout and warm palette');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
