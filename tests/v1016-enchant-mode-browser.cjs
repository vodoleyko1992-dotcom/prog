'use strict';
// 14.10: настоящее MV3-расширение (popup → background → content); все игровые ответы локальные.
// Вкладка игры остаётся открыта во всех сценариях. Состояния очереди задаются как сохранённый профиль.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26;
// defaults.js AUTO_ENCHANT_DISABLED/withoutAutoEnchant, popup showTab/setMode, content enchantCommand/enchantDispatch). Прежние
// проверки «отдельный подраздел и оба входа в режим», «быстрый режим запускает цикл enchant», «ручной старт серии» описывали
// включённую функцию и пройти не могут. Тот же сценарий профиля переведён на действующий контракт: разметка сохранена, но скрыта;
// поиск не ведёт в раздел и меню не переполняется; оба прежних входа (галка и кнопка раздела) ничего не выбирают; сохранённые
// режим/очередь/серии paused/done/unknown не запускают ни серию, ни чужую автоматику; неизвестная попытка и история переживают
// смену режима и Stop; ни одного игрового POST.
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
  const ui=h.popup.locator('#enchantPanel');
  const nav=async tab=>h.openTab(tab);   // 20.12 (ревизия 17.10): шесть разделов на виду, старые имена — через showTab/TAB_GROUP
  const patch=async(cfgPatch={},rtPatch={})=>h.sw.evaluate(async({cfgPatch,rtPatch})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({cfg:{...cfg,...cfgPatch},...(Object.keys(rtPatch).length?{rt:{...rt,...rtPatch,_src:'enchant-mode-browser'}}:{})});
  },{cfgPatch,rtPatch});
  const reload=async()=>{await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));};
  const command=action=>h.sw.evaluate(async action=>{const [tab]=await chrome.tabs.query({url:'https://l2wap.com/*'});return chrome.tabs.sendMessage(tab.id,{cmd:'enchantCommand',id:crypto.randomUUID(),action,char:'AuditHero'},{frameId:0});},action);
  const rejected=async action=>{const r=await command(action);assert.equal(r.ok,false,action);assert.match(r.reason,/Автозаточка временно убрана/,action);};
  // Оба прежних входа в режим: видимая галка задачи и кнопка раздела (через setMode). Ни один не меняет выбор.
  const tryEnter=async()=>{const before=(await h.get(['cfg'])).cfg.autoTasks;
   await h.tasks();await h.popup.locator('[data-auto-task="enchant"]').click({force:true,timeout:3000}).catch(()=>{});
   await h.popup.locator('#enchantModeToggle').click({force:true,timeout:3000}).catch(()=>{});await h.popup.evaluate(()=>setMode('enchant',true));
   await delay(400);assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,before,'enchant entries do not change selection');};
  const status=async()=>h.g.core('({on,running,owner:tabOwner,mode:autonomyMode(),status:rt.status,enchant:rt.enchant})');
  const noActions=async(label,ms=1300,mode='tasks')=>{
   const mark=traffic.length,url=h.g.p.url();await delay(ms);
   assert.equal(h.g.p.url(),url,label+': unexpected navigation');
   // 10.0.22: включённый TvT проверяет регистрацию; разрешён только GET статуса, не переход/POST/бой.
   assert.deepEqual(traffic.slice(mark).filter(r=>!(r.method==='GET'&&r.path==='/game/tvt')).filter(r=>r.method!=='GET'||/battle|raid|rb-boss|quest|teleport|tvt|fishing|mammon|magister|enchant/.test(r.path)),[],label+': unrelated automation');
   const current=await status();assert.equal(current.mode,mode);assert.doesNotMatch(String(current.status||''),/^Заточка:/);pass(label);
  };

  await patch({...Object.fromEntries(modes.map(k=>[k,true])),enchantMode:false,enchant:config,...Object.fromEntries(automatic.map(k=>[k,true])),rbBetween:true,rec:false,autoSnap:false},
   {enchant:null,enchantArchive:archive,enchantScan:null,rbGo:null,zoneGo:null,magister:null,petBufferTrip:null,manualKickAt:0});
  await h.popup.setViewportSize({width:760,height:1200});
  await h.popup.goto('chrome-extension://'+h.id+'/popup.html?dock=1');await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
  // 20.25: разметка раздела оставлена для возврата, но скрыта; панель не смонтирована; старая ссылка enchant ведёт в «Обзор».
  assert.equal(await h.popup.locator('#tab-enchant').count(),1);assert.equal(await h.popup.locator('#tab-enchant').isVisible(),false);
  assert.equal(await h.popup.locator('#enchantPanel').count(),1);assert.equal(await ui.locator('*').count(),0);
  assert.equal(await h.popup.locator('[data-auto-task="enchant"]').count(),1);assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isDisabled(),true);
  assert.equal(await h.popup.locator('#enchantModeToggle').count(),1);assert.equal(await h.popup.locator('#enchantModeToggle').isVisible(),false);
  assert.equal(await h.popup.locator('nav [data-tab="enchant"]').isVisible(),false);
  await nav('enchant');assert.equal(await h.popup.locator('#tab-overview').evaluate(e=>e.classList.contains('act')),true);assert.equal(await h.popup.locator('#tab-enchant').isVisible(),false);
  pass('скрытый подраздел: разметка сохранена, панель не смонтирована, старая ссылка ведёт в «Обзор»');

  for(const width of [760,375]){
   await h.popup.setViewportSize({width,height:1200});await nav('panel');
   await h.popup.locator('#uiSearch').fill('заточка');await delay(400);
   assert.equal(await h.popup.evaluate(()=>searchIndex().some(r=>r.tab==='enchant')),false);
   const found=await h.popup.locator('#uiResults [data-i]').allTextContents();assert.ok(!found.some(t=>/Автозаточк|Режим и серия заточки|Начать серию/i.test(t)),'search results: '+JSON.stringify(found));
   const bounds=await h.popup.evaluate(()=>({viewport:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
   assert.ok(bounds.doc<=bounds.viewport+1&&bounds.body<=bounds.viewport+1,'horizontal overflow at '+width+': '+JSON.stringify(bounds));
   pass('поиск «заточка» не открывает снятый раздел; без горизонтального переполнения '+width+' px');
  }
  await h.popup.setViewportSize({width:760,height:1200});await reload();
  await rejected('refresh');await delay(300);
  assert.equal((await h.get(['on'])).on,false);assert.equal((await h.get(['rt'])).rt.enchantScan,null);assert.ok(!traffic.some(r=>r.path==='/character'),'no inventory read while OFF');
  assert.deepEqual((await h.get(['cfg'])).cfg.enchant,config);assert.deepEqual((await h.get(['rt'])).rt.enchantArchive,archive);pass('«Обновить вещи» при Stop отклонено без чтения; выключенное состояние, очередь и история сохранены');

  // Прежний выбор одной заточки при полном профиле режимов/автозаданий: Старт даёт общее ожидание, без серии и чужих действий.
  await patch({autoTasks:['enchant']});await reload();await tryEnter();await h.popup.locator('#start').click();
  await until(()=>h.g.core('on && running && tabOwner'),30000);let state=await h.get(['on','cfg','rt']);
  assert.equal(state.on,true);assert.deepEqual(state.cfg.autoTasks,['enchant']);assert.deepEqual(await h.g.core('cfg.autoTasks'),[]);assert.equal(await h.g.core('cfg.enchantMode'),false);
  assert.deepEqual(state.cfg.enchant,config);assert.equal(state.rt.enchant,null);assert.deepEqual(state.rt.enchantArchive,archive);
  assert.doesNotMatch(await h.popup.locator('#modeSummary').innerText(),/заточ/i);
  pass('сохранённый выбор только заточки: Старт без серии, остальные режимы не включаются, очередь/история прежние');
  await noActions('выбранная готовая очередь сама не запускается; автоматические задания не вмешиваются');
  await rejected('start');

  for(const [name,options] of [['очередь пуста',{...config,queue:[]}],['автозаточка выключена',{...config,enabled:false}]]){
   await patch({enchant:options});await until(()=>h.g.core('cfg.enchant.queue.length==='+options.queue.length));
   await noActions(name+': основной цикл остаётся на месте');
  }
  const session={v:1,char:'AuditHero',runId:'saved-paused',status:'paused',reason:'Пауза игрока',startedAt:1,items:[{...item,start:3,peak:3,attempts:0,successes:0,failures:0,failStreak:0,scrolls:0,adena:0,unknown:0,reservedScrolls:0,done:true}],totals,history:oldHistory,pending:null,nextAt:0,conflicts:0,home:'/map.html'};
  // Выбраны только заточка и TvT: после фильтра остаётся TvT; ни сохранённая серия, ни разрешённые в профиле Маммон/дейлики не идут.
  await patch({enchant:config,autoTasks:['enchant','tvt']});
  await until(()=>h.g.core('cfg.autoTasks.length===1 && cfg.autoTasks[0]==="tvt"'));
  for(const phase of ['paused','done']){
   await h.g.core('setRt({enchant:'+JSON.stringify({...session,status:phase})+'})');
   await noActions('сохранённая серия '+phase+': нет фарма, рейда, заточки или автоматического квеста');
   assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,['enchant','tvt']);
   const saved=(await h.get(['rt'])).rt.enchant;assert.equal(saved.status,phase);assert.deepEqual(saved.history,oldHistory);
  }
  await rejected('resume');

  // Обычный режим задач: оба прежних входа в заточку ничего не выбирают.
  await patch({...quiet,rbBetween:false,enchant:config,autoTasks:[]});await h.g.core('setRt({enchant:null})');
  await until(()=>h.g.core('on && running && autonomyMode()==="tasks" && !cfg.enchantMode'));
  await reload();assert.equal(await ui.locator('[data-command]').count(),0);await tryEnter();
  pass('в режиме задач кнопки серии нет; галка и кнопка раздела не выбирают заточку');
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);await reload();
  assert.deepEqual((await h.get(['cfg'])).cfg.enchant,config);pass('Stop сохраняет очередь');

  const pending={id:'saved-unknown-attempt',t:Date.now(),lastCheck:Date.now(),state:'unknown',key:item.key,itemId:item.itemId,targetInstanceId:item.targetInstanceId,before:3,fingerprint:item.fingerprint,revision:100,scrollId:910527,scrollBefore:10,adenaBefore:1000000,colBefore:99,chance:1,weaponMode:'magic'};
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'),30000);
  await h.g.core('setRt({enchant:'+JSON.stringify({...session,status:'running',pending})+'})');
  await until(async()=>(await h.get(['rt'])).rt.enchant?.status==='paused');state=await h.get(['cfg','rt']);
  assert.equal(state.rt.enchant.pending.id,pending.id);assert.equal(state.rt.enchant.pending.state,'unknown');assert.deepEqual(state.rt.enchant.history,oldHistory);assert.deepEqual(state.cfg.enchant,config);
  await delay(700);assert.equal((await h.get(['rt'])).rt.enchant.pending.id,pending.id);pass('сохранённая running-серия с неизвестной попыткой → пауза; попытка и история сохранены; новых попыток нет');
  await tryEnter();await rejected('resume');await rejected('start');
  assert.equal((await h.get(['rt'])).rt.enchant.pending.id,pending.id);pass('попытка вернуться в режим не повторяет неизвестную попытку');
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
  assert.equal((await h.get(['rt'])).rt.enchant.pending.id,pending.id);
  assert.equal(traffic.filter(r=>r.method==='POST').length,0);assert.deepEqual(h.errors,[]);pass('ни одного игрового POST; нет ошибок JavaScript; реальная игровая вкладка оставалась открыта');
  console.log('TOTAL '+passed+' PASS');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1;});
