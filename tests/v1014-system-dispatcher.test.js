'use strict';
// 14.10: настоящий участок main от TvT до выбора режима + реальные tvt/story/dailies/mammon.modeFree.
// Побочные действия остальных подсистем записываются; внешний мир/игровые запросы заменены.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),src=read('content.js');
const a=src.indexOf('      if (cfg.tvtOn && await tvtStep())'),b=src.indexOf('      await sleep(isBattle() ? 40 : 200);',a);
assert(a>0&&b>a);const dispatch=src.slice(a,b)+'      await sleep(isBattle() ? 40 : 200);';
function make(mode='auto'){
 const calls=[],now=Date.now(),loc={pathname:'/map.html',search:'',href:''};
 const cfg={tvtOn:true,weaponScanAuto:false,autoMagister:false,storyTurnIn:false,dailyAuto:false,clanTasks:false,zoneAuto:mode==='auto',fishMode:mode==='fish',rbHuntMode:mode==='raid',epicMode:mode==='epic',catMode:mode==='cat',taskOnly:mode==='tasks'};
 const rt={zone:'test-zone',tbWatchT:now,weaponsT:now};
 const noop=async()=>false,record=n=>async()=>{calls.push(n);return true};
 const sb={console,Date,URLSearchParams,location:loc,document:{querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem(){}},cfg,rt,on:true,tabOwner:true,
  L2EngineCore:require('../engine-core.js'),L2V7Modules:{},TVT:null,TVTC:null,TVTS:null,
  setRt:async p=>Object.assign(rt,p),setCfg:async p=>Object.assign(cfg,p),sleep:async()=>{},rnd:()=>0,rec(){},setStatus(){},$q:()=>null,shown:()=>false,
  isBattle:()=>loc.pathname==='/battle.html',isMap:()=>loc.pathname==='/map.html',isFishing:()=>loc.pathname==='/fishing.html',isChar:()=>false,isFishShop:()=>false,isTeleport:()=>false,isCampaign:()=>false,isMail:()=>false,isQuests:()=>false,
  fishState:()=>false,fishNow:()=>cfg.fishMode,epicOn:()=>cfg.epicMode,huntOn:()=>cfg.rbHuntMode,campOn:()=>false,campEnabled:()=>false,heroLevel:()=>75,
  antibotGuard:noop,sealDue:()=>null,farmGuideTick(){},townBuffStart:noop,gameGet:async()=>({ok:false,json:async()=>({})}),
  shopStep:record('shop'),magisterStep:record('magister'),townBuffStep:record('buff'),rbGoStep:record('rbGo'),zoneGoStep:record('zoneGo'),invScanStart:record('invStart'),invScanStep:record('invStep'),rbHuntStep:record('raid'),epicStep:record('epic'),
  fishing:record('fish'),battle:record('battle'),goFishing:record('goFish'),catGo:record('cat'),campaign:record('campaign'),goCampaign:record('goCampaign'),mailStep:record('mail'),questsStep:record('quest'),tasksIdle:record('tasks'),map:record('map'),goOutskirts:record('outskirts'),lootGoal:()=>null,
  invQty:()=>null,INV_NET:{m:{}},rbRun:{start:record('dailySeries')},waitX:async f=>f(),pause:async()=>{},fire(){},toMap:async()=>{calls.push('leaveBattle');loc.pathname='/map.html';loc.href='/map.html'},
 };
 // 14.10: main вызывает новые helpers магистра; в этих сценариях autoMagister=false, исполняем настоящий guard.
 const magStart=src.indexOf('const MAG_SKIP_DEF ='),magEnd=src.indexOf('// ---------- выбило из игры:',magStart);
 vm.runInNewContext(src.slice(magStart,magEnd),sb);
 sb.globalThis=sb;sb.autonomyMode=()=>sb.L2EngineCore.chooseMode({epic:cfg.epicMode,raid:cfg.rbHuntMode,fish:cfg.fishMode,cat:cfg.catMode,tasks:cfg.taskOnly});
 for(const m of ['tvt','story','dailies','mammon','enchant','warlock','pvp'])vm.runInNewContext(read('modules/'+m+'.js'),sb);
 const T=sb.L2V7Factories.tvt(sb),D=sb.L2V7Factories.dailies(sb),S=sb.L2V7Factories.story(sb),M=sb.L2V7Factories.mammon(sb);
 sb.awayFree=M.modeFree;sb.tvtStep=T.tvtStep;sb.tvtSoon=T.tvtSoon;
 // Новый PvP executor без явных целей выполняет настоящий guard и не меняет старые цепочки.
 Object.assign(sb.L2V7Modules,{pvp:sb.L2V7Factories.pvp(sb),tvt:T,dailies:D,story:S,mammon:{mmTick:noop,mmStep:noop},raid:{rbOneStep:noop},enemies:{tick:noop,step:noop},rbtimer:{tick:noop},subclass:{tick:noop},tvtshop:{shopStep:noop},epics:{epicPollTick:noop},equipment:{weaponRescanWhy:()=>null}});
 // 14.10: новая задача заточки выключена/без серии; исполняем её настоящий dispatcher guard.
 const enchantStart=src.indexOf('// Автозаточка: команды меню'),enchantEnd=src.indexOf('chrome.runtime.onMessage.addListener',enchantStart);
 vm.runInNewContext(src.slice(enchantStart,enchantEnd),sb);
 vm.runInNewContext('async function dispatchOnce(){for(let once=0;once<1;once++){'+dispatch+'}}',sb);
 return {sb,cfg,rt,loc,calls,T,D,S,step:sb.dispatchOnce,active:()=>{sb.TVT={eventId:'tvt-e1',phase:'ACTIVE',isRegistered:true,myTeam:1,startsAt:now-10000,t:now};},hold:()=>{sb.TVT={eventId:'tvt-e1',phase:'REGISTRATION',isRegistered:true,myTeam:1,startsAt:now+120000,t:now};}};
}
for(const mode of ['farm','auto','fish','raid','epic','cat','tasks'])test('main: active TvT прерывает '+mode+' раньше shop/upgrade/story/daily',async()=>{
 const c=make(mode);c.active();c.rt.shop={urgent:true,t:Date.now()};c.rt.mmJob={t:Date.now()};c.rt.storyJob={t:Date.now()};c.cfg.dailyAuto=true;
 await c.step();assert.equal(c.loc.href,'/tvt-arena.html');assert.deepEqual(c.calls,[]);assert.equal(c.sb.autonomyMode(),mode==='auto'?'farm':mode);
});
for(const mode of ['farm','auto','fish','raid','epic','cat','tasks'])test('main: FINISHED TvT возвращает executor исходного '+mode,async()=>{
 const c=make(mode),original=JSON.stringify(c.cfg);c.active();c.rt.tvtIn='tvt-e1';c.sb.TVT.phase='FINISHED';c.loc.pathname='/tvt-arena.html';
 await c.step();assert.equal(c.rt.tvtDone,'tvt-e1');assert.equal(JSON.stringify(c.cfg),original);assert.equal(c.loc.href,mode==='fish'?'/fishing.html':'/map.html');
 c.loc.pathname=c.loc.href;c.loc.href='';await c.step();
 assert.deepEqual(c.calls,[({farm:'map',auto:'map',fish:'fish',raid:'raid',epic:'epic',cat:'cat',tasks:'tasks'})[mode]]);assert.equal(c.loc.href,'');
});
test('main: окно TvT откладывает обычную закупку и NPC, urgent остаётся явным исключением',async()=>{
 const c=make();c.hold();c.rt.shop={t:Date.now()};await c.step();assert.deepEqual(c.calls,[]);assert.equal(c.loc.href,'');
 c.rt.shop.urgent=true;await c.step();assert.deepEqual(c.calls,['shop']);
});
test('main: TvT важнее PvE-РБ только по tvtOverRb, затем штатный выход и арена',async()=>{
 const c=make('raid');c.active();c.loc.pathname='/battle.html';c.loc.search='?spawnId=l2dop_rb_test';c.cfg.tvtOverRb=false;
 await c.step();assert.deepEqual(c.calls,['battle']);c.calls.length=0;c.cfg.tvtOverRb=true;await c.step();assert.deepEqual(c.calls,['leaveBattle']);await c.step();assert.equal(c.loc.href,'/tvt-arena.html');
});
test('main: ready story из авто начинает NPC job; raid сохраняет приоритет тура',async()=>{
 for(const mode of ['auto','raid']){const c=make(mode);c.cfg.storyTurnIn=true;c.rt.story={subclass:{ready:true,completed:false,stage:'return_to_ladd'}};
 await c.step();if(mode==='auto'){assert.equal(c.rt.storyJob.kind,'subclass');assert.equal(c.rt.storyJob.home,'test-zone');assert.deepEqual(c.calls,[]);}else{assert.equal(c.rt.storyJob,undefined);assert.deepEqual(c.calls,['raid']);}}
});
test('main: auto → dailyFish → TvT → FINISHED → dailyFish → auto сохраняет цепочку',async()=>{
 const c=make();c.cfg.dailyAuto=true;c.rt.daily={day:'d1',t:Date.now(),tasks:{fishing_catch_50:{have:49,need:50,done:false}}};
 await c.step();assert.equal(c.cfg.fishMode,true);assert.ok(c.rt.dailyFish);c.active();await c.step();assert.equal(c.loc.href,'/tvt-arena.html');
 c.loc.pathname='/tvt-arena.html';c.rt.tvtIn='tvt-e1';c.sb.TVT.phase='FINISHED';await c.step();assert.equal(c.loc.href,'/fishing.html');assert.ok(c.rt.dailyFish);
 c.loc.pathname='/fishing.html';await c.D.fishNote();await c.step();assert.equal(c.rt.dailyFish,null);assert.equal(c.cfg.zoneAuto,true);assert.equal(c.cfg.fishMode,false);assert.equal(c.loc.href,'/map.html');
 c.loc.pathname='/map.html';await c.step();assert.deepEqual(c.calls,['map']);
});
test('main: клановый РБ take → dailyRb → raid → убийство → исходный auto → claim',async()=>{
 const c=make();c.cfg.dailyAuto=true;c.cfg.clanTasks=true;c.rt.daily={day:'d1',t:Date.now(),tasks:{fishing_catch_50:{have:50,need:50,done:true}}};
 const raw={clan:{name:'TestClan',diamonds:0},me:{characterId:'self',activeTaskId:null},taskDefinitions:[{id:'kill_raid_boss',nameRu:'Вызов рейдового босса',target:1,canTake:true}],activeClanTasks:[]};
 const posts=[];c.sb.gamePost=async p=>{posts.push(p);if(p.endsWith('/take')){raw.me.activeTaskId='task-1';raw.taskDefinitions[0].canTake=false;raw.activeClanTasks=[{id:'task-1',taskType:'kill_raid_boss',target:1,progress:0,owner:{id:'self'}}];}else{raw.me.activeTaskId=null;raw.activeClanTasks=[];raw.clan.diamonds=7;}return {ok:true,json:async()=>raw}};
 c.D.clanNote(raw);await c.step();assert.deepEqual(posts,['/game/clan-tasks/kill_raid_boss/take']);assert.equal(c.rt.dailyRb,undefined);
 await c.step();assert.equal(c.cfg.rbHuntMode,true);assert.ok(c.rt.dailyRb);assert.deepEqual(c.calls,['dailySeries']);c.calls.length=0;
 await c.step();assert.deepEqual(c.calls,['raid']);c.calls.length=0;c.rt.rbKills=1;await c.step();assert.equal(c.rt.dailyRb,null);assert.equal(c.cfg.rbHuntMode,false);assert.equal(c.cfg.zoneAuto,true);
 raw.activeClanTasks[0].progress=1;raw.activeClanTasks[0].canClaim=true;c.D.clanNote(raw);
 // Перезагрузка страницы обнуляет только локальный POST_GAP; задания и прогресс остаются в rt.
 c.sb.L2V7Modules.dailies=c.sb.L2V7Factories.dailies(c.sb);await c.step();assert.equal(posts.at(-1),'/game/clan-tasks/task-1/claim');assert.equal(c.rt.clanTasks.clan.diamonds,7);assert.equal(c.rt.clanTasks.me.active,null);
});
test('main: отказ клана409 не зацикливает POST и не блокирует следующий автофарм',async()=>{
 const c=make();c.cfg.clanTasks=true;const posts=[];c.sb.gamePost=async p=>{posts.push(p);return {ok:false,status:409,json:async()=>({error:'revision_conflict'})}};
 c.D.clanNote({clan:{name:'TestClan'},me:{characterId:'self'},taskDefinitions:[{id:'kill_monsters',target:500,canTake:true}],activeClanTasks:[]});
 await c.step();assert.equal(posts.length,1);assert.ok(c.rt.clanTaskFail);await c.step();assert.equal(posts.length,1);assert.deepEqual(c.calls,['map']);
});
test('main: доступный штурм стены не запускается автоматикой клана',async()=>{
 const c=make();c.cfg.clanTasks=true;let posts=0;c.sb.gamePost=async()=>{posts++;throw Error('unexpected post')};
 c.D.clanNote({clan:{name:'TestClan'},me:{characterId:'self'},taskDefinitions:[{id:'damage_siege_wall',target:50000,canTake:true}],activeClanTasks:[]});
 await c.step();assert.equal(posts,0);assert.deepEqual(c.calls,['map']);
});
