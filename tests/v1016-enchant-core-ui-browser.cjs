'use strict';
// 15.10: выполнение серии требует явно выбранного отдельного режима заточки.
// Настоящее MV3 расширение в изолированном профиле. Все ответы игры локальные.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 const character={name:'AuditHero',revision:77,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:2,enchantPAtkBonus:6,enchantMAtkBonus:6,weaponEnchantHistory:['physical','magic']}},stacks:[{itemId:8688,enchant:2,enchantPAtkBonus:6,enchantMAtkBonus:6,weaponEnchantHistory:['magic','physical'],qty:1},{itemId:910527,qty:20}]}};
 const catalog={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesEn:{8688:'Daimon Crystal'}};
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({json:{character}}));
 await h.ctx.route('https://l2wap.com/character/catalog-hints',r=>r.fulfill({json:catalog}));
 const ui=h.popup.locator('#enchantPanel');await until(()=>ui.locator('[data-add]').count());
 await h.popup.evaluate(()=>document.querySelector('nav [data-tab="enchant"]').click());
 assert.equal(await ui.locator('[data-key]').count(),0);assert.equal(await ui.locator('[data-cfg="enabled"]').isChecked(),false);
 assert.equal((await h.get(['on'])).on,false);assert.notEqual((await h.get(['cfg'])).cfg.enchantMode,true);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);console.log('PASS opening separate enchant section never selects mode or starts bot');
 await ui.locator('[data-command="refresh"]').click();await until(()=>ui.locator('[data-candidate] option').count().then(n=>n===3));
 assert.equal((await h.get(['on'])).on,false);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);console.log('PASS actual popup off refresh → real core/readItems → exact candidate snapshot');
 const labels=await ui.locator('[data-candidate] option').allTextContents();assert.notEqual(labels[1],labels[2]);
 for(const choice of ['0','1']){await ui.locator('[data-candidate]').selectOption(choice);await ui.locator('[data-add]').click();await until(()=>ui.locator('[data-key]').count().then(n=>n===+choice+1),5000).catch(async e=>{console.log('ADD DEBUG',{choice,rows:await ui.locator('[data-key]').count(),status:await ui.locator('[role="status"]').textContent(),cfg:(await h.get(['cfg'])).cfg.enchant,errors:h.errors});throw e});}
 const queue=(await h.get(['cfg'])).cfg.enchant.queue;assert.equal(queue[0].targetInstanceId,'eq:l1');assert.equal(queue[1].targetInstanceId,'bag:8688:2:6:6:Hmp');assert.notEqual(queue[0].key,queue[1].key);assert.ok(queue.every(q=>q.fingerprint));
 await ui.locator('[data-candidate]').selectOption('1');await ui.locator('[data-add]').click();await until(()=>ui.locator('[role="status"]').textContent().then(t=>t.includes('уже в очереди')));assert.equal((await h.get(['cfg'])).cfg.enchant.queue.length,2);console.log('PASS exact equipped/bag instances distinguished, stable keys/fingerprint, duplicate rejected');
 for(const [key,value] of [['maxAttempts','8'],['maxScrolls','8']]){await ui.locator('[data-global][data-field="'+key+'"]').fill(value);await ui.locator('[data-global][data-field="'+key+'"]').dispatchEvent('change');await until(async()=> (await h.get(['cfg'])).cfg.enchant[key]===+value);await delay(100);}
 await ui.locator('[data-cfg="scrollPolicy"]').selectOption('mixed');await until(async()=> (await h.get(['cfg'])).cfg.enchant.scrollPolicy==='mixed');
 await ui.locator('[data-cfg="enabled"]').check();await until(async()=> (await h.get(['cfg'])).cfg.enchant.enabled);assert.equal((await h.get(['on'])).on,false);assert.equal(await ui.locator('[data-command="start"]').isDisabled(),true);console.log('PASS settings roundtrip, enabled never starts stopped bot, zero initial budgets become explicit');
 // Старый UI снимок нельзя записать другому герою даже при ответе storage между await.
 const denied=await h.popup.evaluate(async()=>chrome.runtime.sendMessage({cmd:'menuPatch',rtPatch:{},cfgPatch:{enchant:{enabled:true,queue:[{key:'wrong'}]}},expectedChar:'OtherHero'}));assert.equal(denied.ok,false);assert.equal((await h.get(['cfg'])).cfg.enchant.queue.length,2);console.log('PASS background transaction rejects stale-character configuration');
 await h.click('enchantToggle');await until(()=>h.g.core('on && running && tabOwner'));await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-command="start"]').isEnabled());
 assert.equal((await h.get(['cfg'])).cfg.enchantMode,true);assert.equal((await h.get(['rt'])).rt.enchant?.runId,undefined);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);console.log('PASS explicit enchant mode starts its dispatcher and waits for separate series command');
 await h.popup.locator('#enchantPanel [data-command="start"]').click();await until(async()=>!!(await h.get(['rt'])).rt.enchant?.runId);
 await h.click('stop');await until(async()=>!(await h.get(['on'])).on);await until(async()=> (await h.get(['rt'])).rt.enchant?.status==='paused');assert.equal(h.requests.filter(r=>r.method==='POST').length,0);console.log('PASS explicit series start → real session; global Stop pauses before any fixture mutation');
 const run=(await h.get(['rt'])).rt.enchant.runId;await h.g.p.reload();await until(()=>h.g.core('typeof on!=="undefined"'));assert.equal((await h.get(['rt'])).rt.enchant.runId,run);assert.equal((await h.get(['on'])).on,false);console.log('PASS stopped session survives document reload without restart');
 assert.deepEqual(h.errors,[]);console.log('PASS no page errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
