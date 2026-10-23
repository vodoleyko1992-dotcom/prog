'use strict';
// Реальный popup/content/main → публичный renderer/submit → hook → память. Ответы сервера локальные. Ни аккаунта, ни реальной траты.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26;
// defaults.js AUTO_ENCHANT_DISABLED/withoutAutoEnchant). Прежний сценарий «очередь в меню → Start серии → POST → учёт» больше
// не может пройти: панель не монтируется, команды start/resume/refresh отклоняются. Модуль заточки сохранён для возврата и
// проверяется напрямую на том же публичном DOM (v1016-enchant-public-browser.cjs, v206-enchant-quick-browser.cjs).
// Здесь — действующий контракт настоящего расширения на настоящей странице заточки игры:
//  обычный режим: профиль из прежней версии (режим заточки, разрешение, очередь, архив) не запускает серию; бот на /enchant.html
//   с готовой кнопкой не жмёт её (0 POST), команды меню отклонены, очередь и архив сохранены; ручная заточка игрока не
//   превращается в серию бота;
//  --unknown (v1016-enchant-core-recovery-browser.cjs): неизвестная попытка прежней версии не угадывается и не повторяется —
//   только сверка чтением GET /character не чаще 15 с; явное завершение archiveUnknown остаётся доступным и сохраняет
//   полный след (1 зарезервированный свиток, ключи прежней очереди).
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pub,downloadPublic}=require('./v1016-enchant-public-browser.cjs');
const unknown=process.argv.includes('--unknown');
(async()=>{await downloadPublic();const h=await harness();try{
 // --unknown: сервер уже применил попытку +3→+4 (ревизия 101, свиток 3→2), а ответ до прежней версии не дошёл.
 let snapshot={name:'AuditHero',revision:unknown?101:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:unknown?4:3,enchantPAtkBonus:0,enchantMAtkBonus:unknown?24:18,weaponEnchantHistory:unknown?['magic','magic','magic','magic']:['magic','magic','magic']}},stacks:[{itemId:910527,qty:unknown?2:3},{itemId:4037,qty:99}]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesEn:{8688:'Daimon Crystal'}};
 const posts=[],reads=[];
 await h.ctx.route('https://l2wap.com/character',r=>{reads.push(Date.now());return r.fulfill({json:{character:snapshot}});});
 await h.ctx.route('https://l2wap.com/character/catalog-hints',r=>r.fulfill({json:hints}));
 await h.ctx.route('https://l2wap.com/game/inventory/enchant',r=>{
  const req=r.request().postDataJSON();posts.push(req);
  const row=snapshot.inventory.eq.l1,before=row.enchant;row.enchant++;row.enchantMAtkBonus+=6;row.weaponEnchantHistory.push(req.weaponEnchantMode);snapshot.inventory.stacks.find(x=>x.itemId===req.scrollItemId).qty--;snapshot.revision++;
  return r.fulfill({json:{character:snapshot,attemptedCount:1,successCount:1,failCount:0,scrollConsumedCount:1,coinConsumed:false,previousEnchantLevel:before,currentEnchantLevel:row.enchant,updatedTargetInstanceId:'eq:l1',messageUk:'Заточка вдала'}});
 });
 const names=['l2-enchant-client.js','l2-enchant-policy.js','enchant-scroll-meta.js','enchant-render-categories.js','enchant-weapon-mode-ui.js','enchant.js'];
 for(const file of names)await h.ctx.route('https://l2wap.com/'+file,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(pub,file),'utf8')}));
 await h.ctx.route('https://l2wap.com/enchant.html?*',r=>{
  const bootstrap=`window.SNAP=${JSON.stringify(snapshot)};const hints=${JSON.stringify(hints)};window.L2={itemSlotById:hints.itemSlotHints,itemGradeById:hints.itemGradeHints,itemNameById:hints.itemNamesEn,itemStatsById:{8688:{weaponMode:'magic',weaponType:'bigblunt'}},resolveCatalogItemName:id=>hints.itemNamesEn[id]||'#'+id,clampPersistedEnchant:n=>Math.max(0,Math.floor(+n||0)),maxEnchantForItemId:()=>25,effectiveEnchantBatchMax:(id,en,q)=>Math.min(25-en,q,100),nextWeaponSuccessBonusPreview:()=>({enchantPAtkBonus:0,enchantMAtkBonus:6}),applyHudFromSnapshot(){},fetchCatalogHints:async()=>true,resyncCharacterWhenRequired:async()=>SNAP,lastSnapshot:()=>SNAP,applyMutationSnapshot:s=>SNAP=s,token:()=> 'synthetic-local-only',playerMessageOr:(j,f)=>j.messageUk||f,authFetch:(url,opt)=>fetch(url,{...opt,headers:{'Content-Type':'application/json'}})};`;
  let html=fs.readFileSync(path.join(pub,'enchant.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  html=html.replace('</body>',`<div id="l2-hud-legacy-name">AuditHero</div><script>${bootstrap}</script>${names.slice(0,-1).map(f=>'<script src="/'+f+'"></script>').join('')}<script>L2EnchantClient.install(L2);</script><script src="/enchant.js"></script></body>`);
  return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
 });
 // Очередь и разрешение — так, как их оставила последняя версия с автозаточкой (после выбора вещи и лимитов в меню).
 const item={key:'saved-weapon',itemId:8688,name:'Daimon Crystal',level:3,pb:0,mb:18,history:['magic','magic','magic'],legacy:0,uid:'',qty:1,slot:'rhand',eqSlot:'l1',grade:'A',category:'weapon',targetInstanceId:'eq:l1',fingerprint:JSON.stringify([8688,3,0,18,['magic','magic','magic'],0,'']),targetLevel:5,weaponMode:'magic'};
 const enchant={enabled:true,queue:[item],scrollPolicy:'blessed',ordinaryUntil:3,maxAttempts:2,maxScrolls:2,maxAdena:0,maxConsecutiveFails:2,maxDropFromStart:1,maxDropFromPeak:2,delayMs:1500,purchase:false,colBudget:0};
 const totals={attempts:0,successes:0,failures:0,scrolls:0,adena:0,col:0,unknown:0,reservedScrolls:0,latencyMs:0,samples:0,conflicts:0,byScroll:{}};
 const archive=[{runId:'previous-series',startedAt:1,finishedAt:2,status:'done',totals:{...totals,attempts:1,successes:1,scrolls:1},items:[item],history:[{id:'previous-attempt',t:1,key:item.key,before:2,after:3,status:'confirmed',success:true,scrolls:1}]}];
 const lastCheck=Date.now()-60000;
 const pending={id:'lost-receipt',t:lastCheck-1000,lastCheck,state:'unknown',key:item.key,itemId:8688,targetInstanceId:'eq:l1',before:3,fingerprint:item.fingerprint,revision:100,count:1,scrollId:910527,scrollBefore:3,adenaBefore:1000000,colBefore:99,chance:1,weaponMode:'magic'};
 const session=unknown?{v:1,char:'AuditHero',runId:'old-series',status:'running',reason:'',startedAt:lastCheck-5000,items:[{...item,start:3,peak:3,attempts:0,successes:0,failures:0,failStreak:0,scrolls:0,adena:0,unknown:0,reservedScrolls:0,done:false}],totals,history:[],pending,nextAt:0,conflicts:0,home:'/map.html'}:null;
 await h.sw.evaluate(async({enchant,archive,session})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:['enchant'],enchantMode:true,enchant},rt:{...rt,enchant:session,enchantArchive:archive,enchantScan:null,enchantRecovery:null,_src:'enchant-core-public'}});},{enchant,archive,session});
 // Сообщение меню той же формы, что слал enchantMenuCommand: popup сам его больше не отправляет (кнопок нет).
 const command=(action,extra={})=>h.sw.evaluate(async({action,extra})=>{const [tab]=await chrome.tabs.query({url:'https://l2wap.com/*'});return chrome.tabs.sendMessage(tab.id,{cmd:'enchantCommand',id:crypto.randomUUID(),action,char:'AuditHero',...extra},{frameId:0});},{action,extra});
 const stored=async()=>h.get(['cfg','rt','on']);
 await h.g.p.goto('https://l2wap.com/enchant.html?target=eq%3Al1&mode=magic');await until(()=>h.g.core('typeof on!=="undefined" && heroNick()==="AuditHero"'),30000);
 await until(()=>h.g.p.evaluate(()=>{const b=document.querySelector('#enchant-submit');return !!b&&!b.disabled&&/^\s*\+\d+/.test(document.querySelector('.l2-enchant-selected-card__name')?.textContent||'');}),20000);
 // Меню: раздел и панель скрыты, кнопок серии нет — прежний путь «выбрать → Старт серии» закрыт.
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.popup.evaluate(()=>showTab('enchant'));
 assert.equal(await h.popup.locator('#tab-enchant').isVisible(),false);assert.equal(await h.popup.locator('#enchantPanel [data-command]').count(),0);
 assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isVisible(),false);
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner'),30000);
 assert.equal(await h.g.core('cfg.enchantMode'),false);assert.equal(await h.g.core('cfg.enchant.enabled'),false);assert.equal(await h.g.core('autonomyMode()'),'tasks');
 if(unknown){
  // Сверка чтением: свежий снимок в evidence, исход не угадан (pending остаётся unknown, итог 0 попыток), серия на паузе.
  await until(async()=>(await stored()).rt.enchant?.pending?.lastCheck>lastCheck,20000);
  const first=(await stored()).rt.enchant;assert.equal(first.status,'paused');assert.equal(first.pending.id,pending.id);assert.equal(first.pending.state,'unknown');
  assert.equal(first.pending.evidence.revision,101);assert.equal(first.pending.evidence.level,4);assert.equal(first.pending.evidence.scrollBefore,3);assert.equal(first.pending.evidence.scrollNow,2);assert.equal(first.pending.evidence.adenaDelta,0);assert.equal(first.pending.evidence.colDelta,0);
  assert.equal(first.totals.attempts,0);assert.equal(first.totals.successes,0);assert.deepEqual(first.history,[]);assert.equal(posts.length,0);
  console.log('PASS unknown attempt from previous version → read-only GET reconcile: fresh evidence +4/rev101/scroll3→2, outcome not guessed, series paused, 0 POST');
  for(const action of ['resume','start','refresh']){const r=await command(action);assert.equal(r.ok,false,action);assert.match(r.reason,/Автозаточка временно убрана/);}
  // Не чаще раза в 15 с: следующая сверка не раньше, но и не пропадает.
  await delay(8000);assert.equal((await stored()).rt.enchant.pending.lastCheck,first.pending.lastCheck);
  await until(async()=>(await stored()).rt.enchant.pending.lastCheck>first.pending.lastCheck,25000);
  const second=(await stored()).rt.enchant.pending;assert.ok(second.lastCheck-first.pending.lastCheck>=15000,'reconcile interval '+(second.lastCheck-first.pending.lastCheck));assert.equal(second.id,pending.id);assert.equal(posts.length,0);
  console.log('PASS repeated reconcile not more often than 15 s ('+(second.lastCheck-first.pending.lastCheck)+' ms); resume/start/refresh rejected; no repeat POST');
  // Stop → явное завершение: чужой номер попытки отклонён, точный — архивирует серию с полным следом.
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
  assert.equal((await command('archiveUnknown',{pendingId:'other-attempt'})).ok,false);assert.equal((await stored()).rt.enchant.pending.id,pending.id);
  const answer=await command('archiveUnknown',{pendingId:pending.id});assert.equal(answer.ok,true,JSON.stringify(answer));
  await until(async()=>(await stored()).rt.enchant===null,15000);
  const result=await stored(),archived=result.rt.enchantArchive[0];
  assert.equal(archived.status,'closed_unknown');assert.equal(archived.runId,'old-series');assert.equal(archived.pending.id,pending.id);assert.equal(archived.totals.unknown,1);assert.equal(archived.totals.reservedScrolls,1);assert.equal(archived.totals.attempts,0);assert.equal(archived.totals.successes,0);
  assert.equal(archived.evidence.revision,101);assert.equal(archived.evidence.scrollNow,2);assert.equal(archived.history[0].status,'unknown');assert.equal(archived.history[0].source,'manual_archive');
  assert.deepEqual(result.rt.enchantArchive.slice(1),archive,'previous archive kept');assert.ok(result.rt.enchantRecovery.previousKeys.includes(item.key));assert.equal(result.rt.enchantRecovery.attemptRevision,100);
  assert.deepEqual(result.cfg.enchant.queue,[item],'stored queue kept for restoration');assert.equal(result.on,false);
  await until(async()=>!(await h.get(['lock'])).lock,10000);
  console.log('PASS Stop → explicit archiveUnknown (wrong id rejected) → closed_unknown, 1 reserved scroll, evidence rev101, recovery keys, old archive/queue kept, lease released');
  assert.equal((await command('start')).ok,false);assert.equal(posts.length,0);assert.equal(snapshot.revision,101);assert.deepEqual(h.errors,[]);
  console.log('PASS after archive the series still cannot start; 0 POST, no page errors');
  return;
 }
 // Профиль прежней версии: бот работает, вкладка на странице заточки с готовой кнопкой, но серии нет и кнопку не жмёт.
 await delay(4000);
 for(const action of ['start','resume','refresh']){const r=await command(action);assert.equal(r.ok,false,action);assert.match(r.reason,/Автозаточка временно убрана/);}
 await delay(1500);
 let state=await stored();assert.equal(posts.length,0);assert.equal(state.rt.enchant,null);assert.equal(state.rt.enchantScan,null);assert.equal(snapshot.revision,100);
 assert.deepEqual(state.cfg.enchant.queue,[item]);assert.deepEqual(state.rt.enchantArchive,archive);
 console.log('PASS legacy enchant profile + running bot on public /enchant.html: no series, no submit click, menu commands rejected, queue/archive kept, 0 POST');
 // Ручная заточка игрока на той же странице проходит у игры, но не становится серией бота и не трогает архив.
 assert.equal(new URL(h.g.p.url()).pathname,'/enchant.html','idle tasks mode stays on the page');assert.equal(await h.g.p.evaluate(()=>document.querySelector('#enchant-submit').disabled),false);
 {
  await h.g.p.evaluate(()=>document.querySelector('#enchant-submit').click());await until(()=>posts.length===1,10000);await delay(1500);
  state=await stored();assert.equal(state.rt.enchant,null);assert.deepEqual(state.rt.enchantArchive,archive);assert.equal(posts.length,1);
  console.log('PASS manual player submit on the same page → native POST only by the player; bot creates no session/history');
 }
 await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);assert.deepEqual(h.errors,[]);
 console.log('PASS Stop; no page errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
