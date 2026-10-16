'use strict';
// Реальный popup → content/main → публичный renderer/submit → hook → память; законченный режим ждёт игрока.
// Ответы сервера локальные. Ни аккаунта, ни реальной траты.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pub,downloadPublic}=require('./v1016-enchant-public-browser.cjs');
const unknown=false;
(async()=>{await downloadPublic();const h=await harness({cleanInstall:true});try{
 let snapshot={name:'Warlock',revision:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']}},stacks:[{itemId:910527,qty:3},{itemId:4037,qty:99}]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesEn:{8688:'Daimon Crystal'}};
 const posts=[];
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({json:{character:snapshot}}));
 await h.ctx.route('https://l2wap.com/character/catalog-hints',r=>r.fulfill({json:hints}));
 await h.ctx.route('https://l2wap.com/game/inventory/enchant',r=>{
  const req=r.request().postDataJSON();posts.push(req);
  assert.equal(req.expectedRevision,snapshot.revision);assert.equal(req.targetInstanceId,'eq:l1');assert.equal(req.payment,'scroll');assert.equal(req.count,1);assert.equal(req.scrollItemId,910527);
  const row=snapshot.inventory.eq.l1,before=row.enchant;row.enchant++;row.enchantMAtkBonus+=6;row.weaponEnchantHistory.push(req.weaponEnchantMode);snapshot.inventory.stacks.find(x=>x.itemId===910527).qty--;snapshot.revision++;
  return r.fulfill({json:unknown&&posts.length===1?{}:{character:snapshot,attemptedCount:1,successCount:1,failCount:0,scrollConsumedCount:1,coinConsumed:false,previousEnchantLevel:before,currentEnchantLevel:row.enchant,updatedTargetInstanceId:'eq:l1',messageUk:'Заточка вдала'}});
 });
 const names=['l2-enchant-client.js','l2-enchant-policy.js','enchant-scroll-meta.js','enchant-render-categories.js','enchant-weapon-mode-ui.js','enchant.js'];
 for(const file of names)await h.ctx.route('https://l2wap.com/'+file,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(pub,file),'utf8')}));
 await h.ctx.route('https://l2wap.com/enchant.html?*',r=>{
  const bootstrap=`window.SNAP=${JSON.stringify(snapshot)};const hints=${JSON.stringify(hints)};window.L2={itemSlotById:hints.itemSlotHints,itemGradeById:hints.itemGradeHints,itemNameById:hints.itemNamesEn,itemStatsById:{8688:{weaponMode:'magic',weaponType:'bigblunt'}},resolveCatalogItemName:id=>hints.itemNamesEn[id]||'#'+id,clampPersistedEnchant:n=>Math.max(0,Math.floor(+n||0)),maxEnchantForItemId:()=>25,effectiveEnchantBatchMax:(id,en,q)=>Math.min(25-en,q,100),nextWeaponSuccessBonusPreview:()=>({enchantPAtkBonus:0,enchantMAtkBonus:6}),applyHudFromSnapshot(){},fetchCatalogHints:async()=>true,resyncCharacterWhenRequired:async()=>SNAP,lastSnapshot:()=>SNAP,applyMutationSnapshot:s=>SNAP=s,token:()=> 'synthetic-local-only',playerMessageOr:(j,f)=>j.messageUk||f,authFetch:(url,opt)=>fetch(url,{...opt,headers:{'Content-Type':'application/json'}})};`;
  let html=fs.readFileSync(path.join(pub,'enchant.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  html=html.replace('</body>',`<div id="l2-hud-legacy-name">Warlock</div><script>${bootstrap}</script>${names.slice(0,-1).map(f=>'<script src="/'+f+'"></script>').join('')}<script>L2EnchantClient.install(L2);</script><script src="/enchant.js"></script></body>`);
  return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
 });
 await h.ctx.route(/^https:\/\/l2wap\.com\/(?:map|fishing)\.html$/, r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="l2-hud-legacy-name">Warlock</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Warlock</div><div id="map-mob-list"></div>'}));
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof heroNick==="function"'));console.log('INITIAL IDENTITY',await h.g.core('({stored:rt.char,hud:heroNick(),on})'));
 const ui=h.popup.locator('#enchantPanel');
 const initial=await h.get(['cfg','rt','on']);assert.notEqual(initial.on,true);assert.ok(!initial.cfg.enchant?.queue?.length);assert.ok(!initial.rt.enchant?.runId);
 // Чистая установка: только пользовательские переключатели, никаких cfg/rt/queue injections.
 const enchant=h.popup.locator('[data-auto-task="enchant"]');await enchant.click();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks?.includes('enchant'));
 for(const key of (await h.get(['cfg'])).cfg.autoTasks.filter(k=>k!=='enchant')){
  await until(()=>h.popup.locator('[data-auto-task="'+key+'"]').isChecked());await h.popup.locator('[data-auto-task="'+key+'"]').click();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes(key));
 }
 assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,['enchant']);
 await h.popup.locator('#navToggle').click();await h.popup.locator('nav [data-tab="enchant"]').click();await ui.locator('[data-command="refresh"]').click();await until(()=>ui.locator('[data-candidate] option').count().then(n=>n===2));
 await ui.locator('[data-candidate]').selectOption('0');await ui.locator('[data-add]').click();await until(()=>ui.locator('[data-key]').count());
 await ui.locator('[data-cfg="scrollPolicy"]').selectOption('blessed');await until(async()=>(await h.get(['cfg'])).cfg.enchant.scrollPolicy==='blessed');
 for(const key of ['maxAttempts','maxScrolls']){const el=ui.locator('[data-global][data-field="'+key+'"]');await el.fill('2');await el.dispatchEvent('change');await until(async()=>(await h.get(['cfg'])).cfg.enchant[key]===2);}
 await ui.locator('[data-item="weaponMode"]').selectOption('magic');await until(async()=>(await h.get(['cfg'])).cfg.enchant.queue[0].weaponMode==='magic');
 await ui.locator('[data-cfg="enabled"]').check();await until(async()=>(await h.get(['cfg'])).cfg.enchant.enabled);
 assert.notEqual((await h.get(['on'])).on,true);assert.equal(posts.length,0);
 await h.popup.locator('#start').click();await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="enchant"'));
 await until(()=>ui.locator('[data-command="start"]').isEnabled());await ui.locator('[data-command="start"]').click();
 await until(async()=>(await h.get(['rt'])).rt.enchant?.status==='done',30000).catch(async e=>{console.error('DIAG',{posts,url:h.g.p.url(),state:await h.get(['cfg','rt']),errors:h.errors});throw e;});
 const state=(await h.get(['rt'])).rt.enchant;assert.equal(posts.length,1);assert.equal(state.totals.attempts,1);assert.equal(state.totals.successes,1);assert.equal(state.totals.scrolls,1);assert.equal(state.items[0].level,4);assert.equal(state.pending,null);assert.equal(snapshot.inventory.stacks.find(x=>x.itemId===910527).qty,2);assert.equal(snapshot.inventory.stacks.find(x=>x.itemId===4037).qty,99);
 const firstRun=state.runId;
 await h.popup.locator('[data-auto-task="fish"]').click();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks.includes('fish'));await until(()=>h.g.core('autonomyMode()==="fish"'));
 await until(()=>h.popup.locator('#enchantModeToggle').getAttribute('aria-pressed').then(v=>v==='true'));assert.match(await h.popup.locator('#enchantModeToggle').textContent(),/выбран/);
 const target=ui.locator('[data-item="targetLevel"]');await target.fill('5');await target.dispatchEvent('change');await until(async()=>(await h.get(['cfg'])).cfg.enchant.queue[0].targetLevel===5);
 await until(()=>ui.locator('[data-command="start"]').isEnabled());await ui.locator('[data-command="start"]').click();
 await until(async()=>{const {rt}=await h.get(['rt']);return rt.enchant?.status==='done'&&rt.enchant.runId!==firstRun;},30000);
 const again=await h.get(['cfg','rt']);assert.deepEqual(again.cfg.autoTasks,['enchant','fish']);assert.equal(posts.length,2);assert.equal(posts[1].expectedRevision,101);assert.equal(again.rt.enchant.items[0].level,5);assert.equal(again.rt.enchant.totals.attempts,1);assert.equal(again.rt.enchant.totals.successes,1);assert.ok(again.rt.enchantArchive.some(a=>a.runId===firstRun));assert.equal(snapshot.inventory.stacks.find(x=>x.itemId===910527).qty,1);
 console.log('PASS completed enchant stays selected during fish fallback → UI target+5/new series → second native POST receipt, no reselect');
 await h.popup.locator('#stop').click();assert.deepEqual(h.errors,[]);console.log('PASS clean install → actual task selection/inventory/queue/material/budgets/enable/Start/series → native POST receipt: +3→+4, one scroll');
}catch(e){console.error('FLOW DIAG',{state:await h.get(['cfg','rt']),panel:await h.popup.locator('#enchantPanel').innerText(),errors:h.errors});throw e;}finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
