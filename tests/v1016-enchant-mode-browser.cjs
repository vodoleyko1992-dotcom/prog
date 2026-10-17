'use strict';
// 14.10: настоящее MV3-расширение (popup → background → content); все игровые ответы локальные.
// Вкладка игры остаётся открыта во всех сценариях. Состояния очереди задаются как сохранённый профиль.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict');
const clone=x=>JSON.parse(JSON.stringify(x));
const row={itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']};
const snapshot={name:'AuditHero',revision:100,adena:1000000,inventory:{eq:{l1:row},stacks:[{itemId:910527,qty:10},{itemId:4037,qty:99}]}};
const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesRu:{8688:'Посох проверки'}};
const item={key:'saved-weapon',itemId:8688,name:'Посох проверки',level:3,pb:0,mb:18,history:['magic','magic','magic'],legacy:0,uid:'',qty:1,slot:'rhand',eqSlot:'l1',grade:'A',category:'weapon',targetInstanceId:'eq:l1',fingerprint:JSON.stringify([8688,3,0,18,['magic','magic','magic'],0,'']),targetLevel:3,weaponMode:'magic',rules:{maxAttempts:2}};
const config={batchSize:1,enabled:true,queue:[item],scrollPolicy:'blessed',ordinaryUntil:3,maxAttempts:7,maxScrolls:9,maxAdena:0,maxConsecutiveFails:2,maxDropFromStart:1,maxDropFromPeak:2,delayMs:1500,purchase:false,colBudget:0};
const totals={attempts:0,successes:0,failures:0,scrolls:0,adena:0,col:0,unknown:0,reservedScrolls:0,latencyMs:0,samples:0,conflicts:0,byScroll:{}};
const oldHistory=[{id:'previous-attempt',t:1,key:item.key,before:2,after:3,status:'confirmed',success:true,scrolls:1}];
const archive=[{runId:'previous-series',startedAt:1,finishedAt:2,status:'done',totals:{...totals,attempts:1,successes:1,scrolls:1},items:[item],history:oldHistory}];
const modes=['epicMode','rbHuntMode','rbMode','fishMode','catMode','taskOnly','zoneAuto','campaign'];
const automatic=['dailyAuto','clanTasks','mmOrders','mmUpgrade','mmMailClaim','mmGoalFarm','mmCraftSend','mmFarmGuide','storyTurnIn','campAuto','tvtOn','enemyHunt','pvpOnSight','petFullAuto','autoMagister','shopAuto','weaponScanAuto','autoRoles'];
const quiet=Object.fromEntries(automatic.map(k=>[k,false]));
let passed=0;
const pass=name=>{passed++;console.log('PASS '+name);};

(async()=>{
 const h=await harness(),traffic=[];
 try {
  // Новый обработчик учитывает каждый запрос; fallback также остаётся локальным fixture исходного harness.
  await h.ctx.route('https://**/*',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;traffic.push({path,method:req.method()});
   if(path==='/character')return route.fulfill({json:{character:clone(snapshot)}});
   if(path==='/character/catalog-hints')return route.fulfill({json:hints});
   return route.fallback();
  });
  const ui=h.popup.locator('#enchantPanel'),start=()=>ui.locator('[data-command="start"]');
  const nav=async tab=>h.openTab(tab);   // 20.12 (ревизия 17.10): шесть разделов на виду, старые имена — через showTab/TAB_GROUP
  const clickMode=async id=>h.click(id);
  const patch=async(cfgPatch={},rtPatch={})=>h.sw.evaluate(async({cfgPatch,rtPatch})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({cfg:{...cfg,...cfgPatch},...(Object.keys(rtPatch).length?{rt:{...rt,...rtPatch,_src:'enchant-mode-browser'}}:{})});
  },{cfgPatch,rtPatch});
  const reload=async()=>{await h.popup.reload();await until(()=>ui.locator('[data-command="refresh"]').count());};
  const select=async id=>{if(id==='enchantModeToggle')await nav('enchant');await clickMode(id);await h.click('start');await nav('enchant');await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="enchant"'),30000);};
  const status=async()=>h.g.core('({on,running,owner:tabOwner,mode:autonomyMode(),status:rt.status,enchant:rt.enchant})');
  const noActions=async(label,ms=1300,mode='enchant')=>{
   const mark=traffic.length,url=h.g.p.url();await delay(ms);
   assert.equal(h.g.p.url(),url,label+': unexpected navigation');
   // 10.0.22: включённый TvT проверяет регистрацию даже в заточке; разрешён только GET статуса, не переход/POST/бой.
   assert.deepEqual(traffic.slice(mark).filter(r=>!(r.method==='GET'&&r.path==='/game/tvt')).filter(r=>r.method!=='GET'||/battle|raid|rb-boss|quest|teleport|tvt|fishing|mammon|magister/.test(r.path)),[],label+': unrelated automation');
   const current=await status();assert.equal(current.mode,mode);if(mode==='enchant')assert.match(current.status,/^Заточка:/);pass(label);
  };

  await patch({...Object.fromEntries(modes.map(k=>[k,true])),enchantMode:false,enchant:config,...Object.fromEntries(automatic.map(k=>[k,true])),rbBetween:true,rec:false,autoSnap:false},
   {enchant:null,enchantArchive:archive,enchantScan:null,rbGo:null,zoneGo:null,magister:null,petBufferTrip:null,manualKickAt:0});
  await h.popup.setViewportSize({width:760,height:1200});
  await h.popup.goto('chrome-extension://'+h.id+'/popup.html?dock=1');await until(()=>ui.locator('[data-command="refresh"]').count());
  // 20.12: автозаточка — свой подраздел «Боя и класса» с меткой #tab-enchant (старая ссылка enchant ведёт туда).
  assert.equal(await h.popup.locator('#tab-panel > #tab-enchant.subsec-title, #tab-panel #tab-enchant').count(),1);
  assert.equal(await h.popup.locator('#enchantPanel').count(),1);
  assert.equal(await h.popup.locator('[data-auto-task="enchant"]').count(),1);
  assert.equal(await h.popup.locator('#tab-panel #enchantModeToggle').count(),1);
  await nav('enchant');assert.equal(await h.popup.locator('#tab-panel').evaluate(e=>e.classList.contains('act')),true);assert.equal(await h.popup.locator('#tab-enchant').isVisible(),true);
  pass('отдельный подраздел и оба входа в режим');

  for(const width of [760,375]){
   await h.popup.setViewportSize({width,height:1200});await nav('panel');
   await h.popup.locator('#uiSearch').fill('заточка');await until(()=>h.popup.locator('#uiResults [data-i]').count());
   const result=h.popup.locator('#uiResults [data-i]').filter({hasText:'Заточка'}).first();await result.click();
   assert.equal(await h.popup.locator('#tab-panel').evaluate(e=>e.classList.contains('act')),true);
   const bounds=await h.popup.evaluate(()=>({viewport:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,panel:document.querySelector('#enchantPanel').getBoundingClientRect().right}));
   assert.ok(bounds.doc<=bounds.viewport+1&&bounds.body<=bounds.viewport+1&&bounds.panel<=bounds.viewport+1,'horizontal overflow at '+width+': '+JSON.stringify(bounds));
   pass('поиск открывает самостоятельную заточку; без горизонтального переполнения '+width+' px');
  }
  await h.popup.setViewportSize({width:760,height:1200});
  assert.equal(await start().isDisabled(),true);
  await ui.locator('[data-command="refresh"]').click();await until(()=>ui.locator('[data-candidate] option').count().then(n=>n===2),20000);
  assert.equal((await h.get(['on'])).on,false);assert.equal((await h.get(['cfg'])).cfg.enchantMode,false);
  assert.ok(traffic.some(r=>r.path==='/character')&&traffic.some(r=>r.path==='/character/catalog-hints'));
  const limit=ui.locator('[data-global][data-field="maxAttempts"]');await limit.fill('8');await limit.dispatchEvent('change');await until(async()=>(await h.get(['cfg'])).cfg.enchant.maxAttempts===8);
  // #211: основной лимит одновременно задаёт попытки и свитки.
  const saved=clone(config);saved.maxAttempts=8;saved.maxScrolls=8;
  assert.equal((await h.get(['on'])).on,false);assert.deepEqual((await h.get(['rt'])).rt.enchantArchive,archive);pass('обновление вещей и настройка очереди при Stop сохраняют выключенное состояние и историю');

  await select('enchantToggle');let state=await h.get(['on','cfg','rt']);
  assert.equal(state.on,true);assert.ok(state.cfg.autoTasks.includes('enchant'));for(const key of ['epic','raid','fish','cat','auto','farm','quests'])assert.ok(!state.cfg.autoTasks.includes(key),key);
  assert.deepEqual(state.cfg.enchant,saved);assert.equal(state.rt.enchant,null);assert.deepEqual(state.rt.enchantArchive,archive);
  assert.equal(await h.popup.locator('#tab-panel').evaluate(e=>e.classList.contains('act')),true);
  await until(()=>h.popup.locator('[data-auto-task=enchant]').isChecked());
  assert.match(await h.popup.locator('#modeSummary').innerText(),/заточ/i);
  pass('быстрый режим запускает настоящий цикл enchant, выключает остальные режимы и не начинает серию');
  await noActions('выбранная готовая очередь сама не запускается; автоматические задания не вмешиваются');

  for(const [name,options] of [['очередь пуста',{...saved,queue:[]}],['автозаточка выключена',{...saved,enabled:false}]]){
   await patch({enchant:options});await until(()=>h.g.core('cfg.enchant.enabled==='+options.enabled+' && cfg.enchant.queue.length==='+options.queue.length));
   await noActions(name+': основной цикл остаётся на месте');
  }
  const session={v:1,char:'AuditHero',runId:'saved-paused',status:'paused',reason:'Пауза игрока',startedAt:1,items:[{...item,start:3,peak:3,attempts:0,successes:0,failures:0,failStreak:0,scrolls:0,adena:0,unknown:0,reservedScrolls:0,done:true}],totals,history:oldHistory,pending:null,nextAt:0,conflicts:0,home:'/map.html'};
  // Завершённая заточка уступает следующей разрешённой задаче. Здесь выбраны только заточка и TvT:
  // после done остаётся ожидание, а не ранее разрешённые в профиле Маммон/дейлики.
  await patch({enchant:saved,autoTasks:['enchant','tvt']});
  await until(()=>h.g.core('cfg.autoTasks.length===2 && cfg.autoTasks.includes("enchant") && cfg.autoTasks.includes("tvt")'));
  for(const phase of ['paused','done']){
   await h.g.core('setRt({enchant:'+JSON.stringify({...session,status:phase})+'})');
   await noActions('сохранённая серия '+phase+': нет фарма, рейда или автоматического квеста',1300,phase==='done'?'tasks':'enchant');
   assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,['enchant','tvt']);
   assert.deepEqual((await h.get(['rt'])).rt.enchant.history,oldHistory);
  }

  // Для проверки обычного режима отключаем задачи профиля: их разрешённые действия не относятся к заточке.
  await patch({...quiet,rbBetween:false,enchant:saved});await h.g.core('setRt({enchant:null})');
  await clickMode('tasksToggle');await until(()=>h.g.core('on && running && autonomyMode()==="tasks" && !cfg.enchantMode'));
  await reload();assert.equal(await start().isDisabled(),true);pass('кнопка серии заблокирована в другом режиме при работающем боте');
  await select('enchantModeToggle');state=await h.get(['cfg','rt']);assert.ok(state.cfg.autoTasks.includes('enchant'));assert.equal(state.rt.enchant,null);assert.deepEqual(state.cfg.enchant,saved);
  pass('кнопка раздела выбирает тот же отдельный режим без запуска серии');

  // #211: кнопка серии сама даёт явное разрешение; до её нажатия флаг и расходы не меняются.
  await patch({enchant:{...saved,enabled:false}});await reload();assert.equal(await start().isEnabled(),true);assert.equal((await h.get(['cfg'])).cfg.enchant.enabled,false);await noActions('enabled=false: доступна только явная команда начала, серия сама не запускается');
  for(const [name,changes] of [['пустая очередь',{queue:[]}],['лимит попыток 0',{maxAttempts:0}],['лимит свитков 0',{maxScrolls:0}]]){
   await patch({enchant:{...saved,...changes}});await reload();assert.equal(await start().isDisabled(),true,name);pass('старт серии запрещён: '+name);
  }
  await patch({enchant:saved});await reload();assert.equal(await start().isEnabled(),true);
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);await reload();assert.equal(await start().isDisabled(),true);
  assert.ok((await h.get(['cfg'])).cfg.autoTasks.includes('enchant'));pass('Stop блокирует серию и сохраняет выбранный режим и очередь');
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="enchant"'));await reload();assert.equal(await start().isEnabled(),true);
  await start().click();await until(async()=>(await h.get(['rt'])).rt.enchant?.status==='done',20000);
  state=await h.get(['rt']);assert.equal(state.rt.enchant.items[0].level,3);assert.equal(state.rt.enchant.totals.attempts,0);assert.equal(state.rt.enchant.pending,null);
  pass('ручной старт серии проходит через настоящий content; достигнутая цель завершает серию без расхода');

  const pending={id:'saved-unknown-attempt',t:Date.now(),lastCheck:Date.now(),state:'unknown',key:item.key,itemId:item.itemId,targetInstanceId:item.targetInstanceId,before:3,fingerprint:item.fingerprint,revision:100,scrollId:910527,scrollBefore:10,adenaBefore:1000000,colBefore:99,chance:1,weaponMode:'magic'};
  await h.g.core('setRt({enchant:'+JSON.stringify({...session,status:'running',pending})+'})');await clickMode('tasksToggle');
  await until(()=>h.g.core('autonomyMode()==="tasks" && !cfg.enchantMode'));state=await h.get(['cfg','rt']);
  assert.equal(state.rt.enchant.status,'paused');assert.equal(state.rt.enchant.pending.id,pending.id);assert.deepEqual(state.rt.enchant.history,oldHistory);assert.deepEqual(state.cfg.enchant,saved);
  await delay(700);assert.equal((await h.get(['rt'])).rt.enchant.pending.id,pending.id);pass('переключение режима сохраняет неизвестную попытку и историю; новых попыток нет');
  await select('enchantModeToggle');await reload();assert.equal(await start().count(),0);assert.equal(await ui.locator('[data-command="resume"]').isDisabled(),true);
  assert.equal((await h.get(['rt'])).rt.enchant.pending.id,pending.id);pass('возвращение в режим не повторяет неизвестную попытку');
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
  assert.equal(traffic.filter(r=>r.method==='POST').length,0);assert.deepEqual(h.errors,[]);pass('ни одного игрового POST; нет ошибок JavaScript; реальная игровая вкладка оставалась открыта');
  console.log('TOTAL '+passed+' PASS');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1;});
