'use strict';
// 20.71: отдельный Rebirth не уступает другим задачам и не исполняет их маршруты; сохранённые настройки и квитанции остаются.
// По просьбе John «Сборка без проверок» этот файл при подготовке20.71 не запускался.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const E=require(process.env.L2_ENGINE_SOURCE||path.join(__dirname,'..','engine-core.js'));
const foreignFlags=['enchantMode','craftMode','epicMode','rbHuntMode','rbMode','rbBetween','fishMode','catMode','zoneAuto','campaign',
 'tvtOn','tvtOverRb','tsBuy','mmOrders','mmUpgrade','mmShopBuy','mmSmithAuto','mmCraftSend','mmCraftNote','mmMailClaim','mmGoalFarm',
 'storyTurnIn','campAuto','goddardQuest','dailyAuto','clanTasks','enemyHunt','pvpOnSight','pvpAll','petFullAuto','subHelpMain','mmFarmBest','mmFarmGuide',
 'autoMagister','weaponScanAuto','weaponClassEquip','weaponAuto','shopAuto','townBuff','autoLearn','sealAuto'];
const rawConfig=extra=>({...Object.fromEntries(foreignFlags.map(k=>[k,true])),chain:true,autoRevive:true,petAuto:true,
 farmRes:'ore',recipeRes:'recipe',resQuests:'quest',mmGoalItem:42,rebirthMode:true,rebirthAutoEnter:true,rebirthDifficulty:2,rebirthKeyReserve:7,...extra});

test('явный список задач определяет Rebirth сильнее старого режима, отдельная галочка входа его не выбирает',()=>{
 const a=rawConfig({autoTasks:['farm','rebirth','tvt'],rebirthMode:false}),c=E.taskConfig(a);
 assert.equal(E.rebirthSelected(c),true);assert.equal(E.selectedTask(c),'rebirth');assert.equal(c.rebirthMode,true);
 for(const list of [[],['farm'],['fish'],['raid'],['epic'],['craft']]){
  const raw=rawConfig({autoTasks:list}),view=E.taskConfig(raw);assert.equal(E.rebirthSelected(view),false);assert.equal(view.rebirthMode,false);
  assert.notEqual(E.selectedTask(view),'rebirth');assert.equal(raw.rebirthMode,true,'исходный флаг не переписывается');
 }
 assert.equal(E.rebirthSelected({autoTasks:['farm'],rebirthAutoEnter:true}),false);
});

test('при выбранном Rebirth все прежние задачи хранятся, но не получают разрешения',()=>{
 const raw=rawConfig({autoTasks:[...E.TASK_KEYS]}),saved=JSON.stringify(raw),c=E.taskConfig(raw);
 assert.equal(E.selectedTask(c),'rebirth');assert.equal(E.baseTask(c),'rebirth');
 for(const key of E.TASK_KEYS)assert.equal(E.taskAllowed(c,key),key==='rebirth',key);
 assert.deepEqual(E.taskList(c),E.TASK_KEYS);assert.equal(JSON.stringify(raw),saved);
});

test('дневная квота и передышка Rebirth не разрешают переключение на fish/farm/raid',()=>{
 const now=Date.UTC(2026,9,27,5),rt={dailyQuota:{day:E.dailyDay(now),basis:'server',auto:10},
  selfHold:{task:'rebirth',mode:'rebirth',until:now+60000,kind:'stall'}};
 const c=E.taskConfig(rawConfig({autoTasks:['rebirth','fish','farm','raid'],dailyKillLimit:10}),()=>rt);
 assert.equal(E.dailyBlocked(c,rt,'rebirth',now),true);assert.equal(E.selectedTask(c,rt,now),'rebirth');assert.equal(E.baseTask(c,rt,now),'rebirth');
 assert.equal(c.rebirthMode,true);assert.equal(c.fishMode,false);assert.equal(c.rbHuntMode,false);
});

for(const strict of [false,true])test((strict?'autoTasks':'legacy')+': чужие включатели и ресурсы закрыты, поддержка текущего боя и настройки входа сохраняются',()=>{
 const raw=rawConfig(strict?{autoTasks:['rebirth','tvt','mammon','petbuff','resources']}:{dailyKillLimit:0}),saved=JSON.stringify(raw),c=E.taskConfig(raw);
 for(const key of foreignFlags)assert.equal(c[key],false,key);
 for(const key of ['farmRes','recipeRes','resQuests'])assert.equal(c[key],'',key);
 assert.equal(c.mmGoalItem,0);assert.equal(c.rebirthMode,true);assert.equal(c.taskOnly,false);assert.equal(c.chain,true);
 assert.equal(c.autoRevive,true);assert.equal(c.petAuto,true);assert.equal(c.rebirthAutoEnter,true);assert.equal(c.rebirthDifficulty,2);assert.equal(c.rebirthKeyReserve,7);
 assert.equal(E.rawTaskConfig(c),raw);assert.equal(JSON.stringify(raw),saved);
});

test('legacy Rebirth остаётся отдельным при нулевой квоте и после достижения положительной квоты',()=>{
 for(const limit of [0,10]){
  const now=Date.UTC(2026,9,27,5),rt={dailyQuota:{day:E.dailyDay(now),basis:'server',auto:10}},raw=rawConfig({dailyKillLimit:limit}),c=E.taskConfig(raw,()=>rt);
  assert.notEqual(c,raw,'legacy тоже получает изолированное представление');assert.equal(E.selectedTask(c,rt,now),'rebirth');
  assert.equal(c.rebirthMode,true);assert.equal(c.taskOnly,false);assert.equal(c.fishMode,false);assert.equal(c.epicMode,false);
 }
});

test('Rebirth не исполняет чужие ручные/автоматические маршруты и не меняет квитанции',()=>{
 const jobs=['shop','invScan','bagCheck','faScan','recipeScan','farmScan','zoneScan','sealEx','tbuff','detectOutside','petBufferTrip',
  'magister','mmJob','storyJob','tsJob','rbGo','rbHunt','zoneGo','rbScan','fishSvc','fishService','dailyFish','dailyRb','enchantJob','subTrip'];
 const rt={...Object.fromEntries(jobs.map(k=>[k,{manual:true,urgent:true,auto:false,kind:'goddard'}])),actionPayments:{pending:{kind:'shop',id:'receipt'}},
  travelCheck:{id:'travel'},rebirth:{pending:{id:'entry'},bossPending:{id:'boss'}}},saved=JSON.stringify(rt),c=E.taskConfig(rawConfig({autoTasks:[...E.TASK_KEYS]}),()=>rt);
 for(const key of jobs){assert.equal(E.taskJobAllowed(c,key,rt),false,key);assert.equal(E.taskJobHeld(c,key,rt),false,key);}
 assert.equal(E.taskJobAllowed(c,'rebirthJob',rt),true);assert.equal(E.taskJobAllowed(c,'revive',rt),true);assert.equal(JSON.stringify(rt),saved);
});

test('снятие задачи Rebirth возвращает исходные настройки остальных задач без миграции/потери autoTasks',()=>{
 const raw=rawConfig({autoTasks:['rebirth','fish','tvt','mammon','petbuff','resources']}),c=E.taskConfig(raw);
 assert.equal(c.tvtOn,false);assert.equal(c.shopAuto,false);assert.equal(c.petFullAuto,false);
 raw.autoTasks=raw.autoTasks.filter(k=>k!=='rebirth');
 assert.equal(E.rebirthSelected(c),false);assert.equal(E.selectedTask(c),'fish');assert.equal(c.fishMode,true);assert.equal(c.tvtOn,true);
 assert.equal(c.mmOrders,true);assert.equal(c.petFullAuto,true);assert.equal(c.farmRes,'ore');assert.deepEqual(raw.autoTasks,['fish','tvt','mammon','petbuff','resources']);
});

test('legacy выключение Rebirth возвращает прежние режимы и включатели без изменения самого профиля',()=>{
 const raw=rawConfig({dailyKillLimit:0}),c=E.taskConfig(raw);assert.equal(c.rbMode,false);assert.equal(c.shopAuto,false);
 raw.rebirthMode=false;assert.equal(E.rebirthSelected(c),false);assert.equal(E.selectedTask(c),null);assert.equal(c.rbMode,true);assert.equal(c.shopAuto,true);assert.equal(c.tvtOn,true);
});

test('явный Rebirth сильнее старых mode-флагов, выключение сохраняет прежние приоритеты',()=>{
 assert.equal(E.chooseMode({rebirth:true,enchant:true,craft:true,epic:true,raid:true,fish:true,cat:true,campaign:true}),'rebirth');
 assert.equal(E.chooseMode({enchant:true,craft:true,epic:true,raid:true}),'enchant');assert.equal(E.chooseMode({craft:true,epic:true}),'craft');
 assert.equal(E.chooseMode({epic:true,raid:true}),'epic');assert.equal(E.chooseMode({raid:true,fish:true}),'raid');
});
