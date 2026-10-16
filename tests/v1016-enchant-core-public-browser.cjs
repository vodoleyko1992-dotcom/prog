'use strict';
// Реальный popup → content/main → публичный renderer/submit → hook → память; законченный режим ждёт игрока.
// Ответы сервера локальные. Ни аккаунта, ни реальной траты.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pub,downloadPublic}=require('./v1016-enchant-public-browser.cjs');
const unknown=process.argv.includes('--unknown');
(async()=>{await downloadPublic();const h=await harness();try{
 let snapshot={name:'AuditHero',revision:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']}},stacks:[{itemId:910527,qty:3},{itemId:4037,qty:99}]}};
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
  html=html.replace('</body>',`<div id="l2-hud-legacy-name">AuditHero</div><script>${bootstrap}</script>${names.slice(0,-1).map(f=>'<script src="/'+f+'"></script>').join('')}<script>L2EnchantClient.install(L2);</script><script src="/enchant.js"></script></body>`);
  return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
 });
 await h.popup.evaluate(()=>document.querySelector('nav [data-tab="enchant"]').click());
 const ui=h.popup.locator('#enchantPanel');await until(()=>ui.locator('[data-command="refresh"]').count());await ui.locator('[data-command="refresh"]').click();await until(()=>ui.locator('[data-candidate] option').count().then(n=>n===2));
 await ui.locator('[data-candidate]').selectOption('0');await ui.locator('[data-add]').click();await until(()=>ui.locator('[data-key]').count());
 for(const key of ['maxAttempts','maxScrolls']){const el=ui.locator('[data-global][data-field="'+key+'"]');await el.fill('2');await el.dispatchEvent('change');await until(async()=> (await h.get(['cfg'])).cfg.enchant[key]===2);await delay(100);}
 await ui.locator('[data-item="weaponMode"]').selectOption('magic');await until(async()=> (await h.get(['cfg'])).cfg.enchant.queue[0].weaponMode==='magic');
 await ui.locator('[data-cfg="enabled"]').check();await until(async()=> (await h.get(['cfg'])).cfg.enchant.enabled);
 await h.click('enchantToggle');await until(()=>h.g.core('on && tabOwner'));await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-command="start"]').isEnabled());await h.popup.locator('#enchantPanel [data-command="start"]').click();
 if(unknown){
  await until(async()=> (await h.get(['rt'])).rt.enchant?.pending?.state==='unknown',30000);
  const before=(await h.get(['rt'])).rt.enchant;await h.click('stop');await until(()=>h.g.core('!on && !tabOwner'),15000);
  await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-archive-begin]').count());await h.popup.locator('#enchantPanel [data-archive-begin]').click();await until(()=>h.popup.locator('#enchantPanel [data-command="archiveUnknown"]').count());await h.popup.locator('#enchantPanel [data-command="archiveUnknown"]').click();
  await until(async()=>{const s=await h.get(['cfg','rt']);return s.rt.enchant===null&&s.cfg.enchant.queue.length===0&&s.cfg.enchant.enabled===false},20000);
  const result=await h.get(['cfg','rt','on']);const archived=result.rt.enchantArchive[0];assert.equal(archived.status,'closed_unknown');assert.equal(archived.pending.id,before.pending.id);assert.equal(archived.totals.unknown,1);assert.equal(archived.totals.reservedScrolls,1);assert.equal(archived.totals.attempts,0);assert.equal(archived.totals.successes,0);assert.equal(result.on,false);assert.equal(posts.length,1);assert.ok(result.rt.enchantRecovery.previousKeys.includes(before.items[0].key));assert.deepEqual(h.errors,[]);
  console.log('PASS actual extension unknown receipt → Stop/released lease → explicit two-step archive → full evidence/1reserved → queue cleared/OFF, no duplicate POST');
  await h.popup.locator('#enchantPanel [data-command="refresh"]').click();await until(async()=> (await h.get(['rt'])).rt.enchantScan?.revision===101);
  await until(()=>h.popup.locator('#enchantPanel [data-candidate] option').count().then(n=>n===2));await h.popup.locator('#enchantPanel [data-candidate]').selectOption('0');await h.popup.locator('#enchantPanel [data-add]').click();
  await until(async()=> (await h.get(['cfg'])).cfg.enchant.queue.length===1);const selected=(await h.get(['cfg'])).cfg.enchant.queue[0];assert.equal(selected.level,4);assert.equal(selected.targetLevel,5);assert.ok(!result.rt.enchantRecovery.previousKeys.includes(selected.key));
  await h.popup.locator('#enchantPanel [data-cfg="enabled"]').check();await until(async()=> (await h.get(['cfg'])).cfg.enchant.enabled);
  await h.click('start');await until(()=>h.g.core('on && tabOwner'));await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-command="start"]').isEnabled());await h.popup.locator('#enchantPanel [data-command="start"]').click();
  await until(async()=> (await h.get(['rt'])).rt.enchant?.reason==='Уровень в панели устарел',15000);assert.equal(posts.length,1);
  await h.g.p.reload();await until(()=>h.g.core('on && tabOwner'));await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-command="resume"]').isEnabled());await h.popup.locator('#enchantPanel [data-command="resume"]').click();
  await until(async()=> (await h.get(['rt'])).rt.enchant?.status==='done',30000).catch(async e=>{const s=await h.get(['rt','cfg']);console.log('RECOVERY STATE',{page:h.g.p.url(),posts,session:s.rt.enchant,recovery:s.rt.enchantRecovery,cfg:s.cfg.enchant,status:s.rt.status,errors:h.errors});throw e});const resumed=(await h.get(['rt'])).rt;
  assert.equal(posts.length,2);assert.equal(posts[1].expectedRevision,101);assert.equal(resumed.enchant.totals.attempts,1);assert.equal(resumed.enchant.totals.successes,1);assert.equal(resumed.enchant.items[0].level,5);assert.equal(resumed.enchantArchive[0].totals.unknown,1);assert.equal(resumed.enchantArchive[0].totals.successes,0);
  await h.click('stop');assert.deepEqual(h.errors,[]);console.log('PASS explicit fresh manual selection → new queue key/revision → stale DOM pauses → explicit reload/resume → new series +4→+5, old unknown remains separate');return;
 }
 await until(async()=> (await h.get(['rt'])).rt.enchant?.status==='done',30000).catch(async e=>{console.log('STATE',{page:h.g.p.url(),posts,rt:(await h.get(['rt'])).rt.enchant,status:(await h.get(['rt'])).rt.status,errors:h.errors});throw e});
 const state=(await h.get(['rt'])).rt.enchant;assert.equal(posts.length,1);assert.equal(state.totals.attempts,1);assert.equal(state.totals.successes,1);assert.equal(state.totals.scrolls,1);assert.equal(state.totals.adena,0);assert.equal(state.pending,null);assert.equal(state.items[0].level,4);assert.equal(snapshot.inventory.stacks.find(x=>x.itemId===4037).qty,99);
 // 15.10: отдельный режим после серии остаётся на заточке и не возобновляет задачи/охоту.
 await delay(1000);assert.equal(new URL(h.g.p.url()).pathname,'/enchant.html');assert.ok((await h.get(['cfg'])).cfg.autoTasks.includes('enchant'));assert.equal(posts.length,1);await h.click('stop');assert.deepEqual(h.errors,[]);
 console.log('PASS full extension: actual popup queue → real main → current public enchant DOM click → hook response → exact accounting → enchant mode/page waits');
 console.log('PASS 1 confirmed scroll, +3→+4, no Adena/CoL, no duplicate POST, no page errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
