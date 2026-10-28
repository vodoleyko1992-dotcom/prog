'use strict';
// 20.71: отдельный Rebirth в этих старых сценариях выключен; его guard включён в зависимости стенда.
// 23.10.2026: стенд получает новые зависимости темпа; прежние проверки отправок сохранены.
// 19.10: отказ дневного API закрывает новую добычу, а не весь диспетчер; старый улов не выдаёт разрешение на охоту.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),src=read('content.js'),data=require('./tools/daily-server-fixture.cjs');
function fixture(){
 const box={require:x=>x==='node:test'?()=>{}:require(x),__dirname,URL,URLSearchParams,Date,structuredClone,console};
 const base=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(base.slice(0,base.indexOf("for(const task of ['auto','cat'])")),box);
 const f=box.fixture(),c=f.c,d=data(),requests=[];
 vm.runInNewContext('this.dailyServerCurrent=dailyServerCurrent;this.dailyWorkWaiting=dailyWorkWaiting;',c);
 Object.assign(f.state.cfg,{autoKillLimit:0,catKillLimit:0,dailyKillLimit:8000,dailyFishLimit:1511,autoTasks:['auto']});f.refresh();
 Object.assign(c,{automationGeneration:1,isBattle:()=>false,isFishing:()=>false,fishNow:()=>false,fishState:()=>null,victory:()=>false,heroNick:()=>c.rt.char});
 c.autonomyMode=()=>{const task=c.L2EngineCore.selectedTask(c.cfg,c.rt);return task==='auto'?'farm':task==='quests'?'campaign':task||'farm'};
 c.automationSnapshot=()=>JSON.stringify([c.automationGeneration,c.leaseEpoch,c.rt.char,c.rt.manualKickAt,c.cfg.autoTasks,c.location.search]);
 c.automationCurrent=stamp=>c.on&&c.tabOwner&&stamp===c.automationSnapshot();
 c.setRt=async p=>{Object.assign(c.rt,p);Object.assign(f.state.rt,structuredClone(p));return {ok:true}};
 c.gameGet=async path=>{requests.push(path);return {ok:true,json:async()=>path==='/game/time'?d.clock:path==='/game/fishing/state'?{target:null}:d.daily}};
 return {...f,d,requests};
}
test('сбой /game/time не перекрывает PvP-восстановление и последующие службы',async()=>{
 const f=fixture(),c=f.c,events=[];c.cfg.autoTasks=['clan','mammon'];c.gameGet=async p=>{f.requests.push(p);return {ok:false,status:503}};
 Object.assign(c,{rebirthModeSelected:()=>false,actionWait:async()=>true,L2V7Modules:{actions:{enterFrame(){}},pvp:{recoveryStep:async()=>{events.push('pvp');return false}}},LOOP:{servicesStarted:true},lifestoneCommandBusy:false,serverDown:()=>false,loginPage:()=>false,antibotState:()=>null,enchantModePause:async()=>{},tvtSoon:()=>false});
 vm.runInNewContext(src.slice(src.indexOf('async function loopGate()'),src.indexOf('// Сторож «нет прогресса')),c);
 assert.equal(await c.loopGate(),undefined);assert.deepEqual(events,['pvp']);assert.deepEqual(f.requests,['/game/time']);
 // Этот результат передаёт круг следующим шагам mainTick, а не возвращает true из gate.
 vm.runInNewContext(src.slice(src.indexOf('async function mainTick()'),src.indexOf('// Замок вкладки:')),c);
 // 22.10: loopCraft без выбранного крафта пропускает круг, как прежний loopEnchant.
 // 20.43: в mainTick новый шаг loopTravel (сверка квитанции перелёта) — заглушка, как у прочих шагов; проверка прежняя
 // 20.43 (автономность): новый шаг передышки loopSelfHold — здесь без передышки; 20.43 (ревью au/breather): + ожидание loopSelfHoldWait после служб
 for(const key of ['loopLease','loopMigrations','loopWatchdog','loopUrgent','loopSelfHold','loopTravel','loopTaskList','loopEnchant','loopCraft','loopPriority','loopMenuJobs','loopRebirth','loopStartPrep','loopTownJobs','loopSelfHoldWait','loopRaid','loopActivity'])c[key]=async()=>false;
 c.loopSideJobs=async()=>{events.push('services');return true};await c.mainTick();assert.deepEqual(events,['pvp','pvp','services']);
});
test('без серверного stamp новый фарм закрыт, повтор GET ограничен15с',async()=>{
 const f=fixture();f.c.gameGet=async p=>{f.requests.push(p);return {ok:false,status:503}};
 assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(f.requests.length,1);
 assert.equal(f.c.dailyWorkWaiting(),true);f.c.rt.mmJob={t:Date.now()};assert.equal(f.c.dailyWorkWaiting(),false,'служебный маршрут не освобождён от сторожа');
});
test('сторож не перезагружает ожидающую дневной API рыбалку, но следит за зависшим сервисом',async()=>{
 const f=fixture(),c=f.c,active=[];c.cfg.autoTasks=['fish'];c.gameGet=async()=>({ok:false});
 assert.equal(await c.dailyWorkReady('fish'),false);
 // 20.43 (ревью au/breather): сторож спрашивает selfHoldMain (передышки здесь нет)
 Object.assign(c,{L2V7Modules:{},fishNow:()=>true,antibotState:()=>null,meHp:()=>null,mobHp:()=>null,selfHoldMain:()=>false,LOOP:{holdWaitT:0},progressMonitor:{tick:(_,watch)=>{active.push(watch);return 'ok'}}});
 vm.runInNewContext(src.slice(src.indexOf('async function loopWatchdog()'),src.indexOf('// Повтор ранних веток после долгих шагов')),c);
 await c.loopWatchdog();c.rt.mmJob={t:Date.now()};await c.loopWatchdog();assert.deepEqual(active,[false,true]);
});
test('отложенная сверка pending улова не разрешает новую охоту',async()=>{
 for(const patch of [{fishCastPending:{at:1}},{actionPayments:{pending:{kind:'fishing'}}}]){
  const f=fixture();Object.assign(f.c.rt,patch);assert.equal(await f.c.dailyServerSync(),true);
  assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(f.requests.length,0);assert.equal(f.c.dailyServerCurrent(),false);
 }
});
test('сохранённый active без текущей рыбы сначала сверяется, затем восстанавливаются серверные квоты',async()=>{
 const f=fixture();f.c.rt.fishCastActive=true;f.state.rt.fishCastActive=true;
 f.d.daily.tasks.hunt_start_500.score=8000;
 assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.deepEqual(f.requests,['/game/fishing/state','/game/time','/game/daily-quests']);
 assert.equal(f.c.rt.fishCastActive,false);assert.equal(f.state.rt.fishCastActive,false);assert.equal(f.c.L2EngineCore.dailyCount(f.c.rt,'auto'),8000);
});
test('неполный ответ/живая рыба выбранной рыбалки не очищают active и не открывают дневную квоту',async()=>{
 for(const state of [{},{target:{hp:5}},null]){
  // 22.10: сохранённая рыба вне рыбалки теперь разрешает только серверную сверку квоты охоты, сама выбранная рыбалка ждёт по-прежнему.
  const f=fixture();f.c.rt.fishCastActive=true;f.c.fishNow=()=>true;f.c.gameGet=async p=>{f.requests.push(p);return {ok:true,json:async()=>state}};
  assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(await f.c.dailyWorkReady('mobs'),false);
  assert.equal(f.c.rt.fishCastActive,true);assert.deepEqual(f.requests,['/game/fishing/state']);
 }
});
test('очистка active требует подтверждённой записи, а поздний ответ после Stop не применяется',async()=>{
 for(const mode of ['storage','stop','lease','kick','generation']){
  const f=fixture();f.c.rt.fishCastActive=true;let writes=0;
  f.c.setRt=async()=>{writes++;return {ok:false}};
  const get=f.c.gameGet;f.c.gameGet=async p=>{const r=await get(p);if(mode==='stop')f.c.on=false;if(mode==='lease')f.c.leaseEpoch++;if(mode==='kick')f.c.rt.manualKickAt++;if(mode==='generation')f.c.automationGeneration++;return r};
  assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(writes,mode==='storage'?1:0);assert.equal(f.c.dailyServerCurrent(),false);
 }
});
test('успешная сверка разрешает добычу только своего дня, героя и запуска',async()=>{
 const f=fixture();assert.equal(await f.c.dailyWorkReady('mobs'),true);assert.equal(f.requests.length,2);
 await f.c.dailyWorkReady('mobs');assert.equal(f.requests.length,2);
 for(const change of [()=>f.c.rt.dailyServerCheck.day='2000-01-01',()=>f.c.rt.dailyServerCheck.char='Other',()=>f.c.rt.dailyStart=1]){
  change();assert.equal(f.c.dailyServerCurrent(),false);
  f.c.gameGet=async()=>({ok:false});assert.equal(await f.c.dailyWorkReady('mobs'),false);
 }
});
test('нет дневного лимита — отказ дневного API не закрывает добычу',async()=>{
 const f=fixture();f.c.cfg.dailyKillLimit=0;f.c.cfg.dailyFishLimit=0;
 f.c.gameGet=()=>assert.fail('без лимита дополнительная сверка не нужна');assert.equal(await f.c.dailyWorkReady('mobs'),true);assert.equal(await f.c.dailyWorkReady('fish'),true);
});
test('достигнутый cap закрывает поздний auto, сохраняя явно выбранный farm/raid',async()=>{
 for(const task of ['auto','farm','raid']){
  const f=fixture(),c=f.c,day=c.L2EngineCore.dailyDay(Date.now(),c.rt);c.cfg.autoTasks=[task];
  c.rt.dailyQuota={day,basis:'server',auto:8000};c.rt.dailyServerCheck={day,char:c.rt.char,start:c.rt.dailyStart||0};
  assert.equal(await c.dailyWorkReady('mobs'),task!=='auto');assert.equal(f.requests.length,0);
 }
});
test('дневной API не ограничивает явно выбранные farm/raid/quests/epic без такого cap',async()=>{
 for(const task of ['farm','raid','quests','epic']){
  const f=fixture();f.c.cfg.autoTasks=[task];f.c.gameGet=()=>assert.fail('эта задача не расходует ограниченный режим auto/cat');
  assert.equal(await f.c.dailyWorkReady('mobs'),true);
 }
});
test('вход на карту из обычного и бесплатного платежного пути не обходит дневной gate',async()=>{
 const f=fixture();let calls=0,gates=0;f.c.cfg.autoTasks=['farm'];f.c.cfg.zoneAuto=false;f.c.L2V7Modules={mobfarm:{map:async()=>calls++}};f.c.dailyWorkReady=async()=>{gates++;return false};
 vm.runInNewContext(src.slice(src.indexOf('async function map(...args)'),src.indexOf('// ---------- бой ----------')),f.c);
 await f.c.map();assert.equal(calls,0);
 // paymentFreeStep использует тот же map(), без отдельной незащищённой функции.
 Object.assign(f.c,{paymentFreeAllowed:()=>true,isMap:()=>true,fishNow:()=>false,farmRbOn:()=>false,campOn:()=>false,lootGoal:()=>null,antibotState:()=>null,setStatus(){},sleep:async()=>{},tvtSoon:()=>false,L2V7Modules:{mobfarm:{map:async()=>calls++},pvp:{pending:()=>false}}});
 vm.runInNewContext(src.slice(src.indexOf('async function paymentFreeStep('),src.indexOf('//',src.indexOf('async function paymentFreeStep(')+30)),f.c);
 assert.equal(await f.c.paymentFreeStep({kind:'shop'}),true);assert.equal(calls,0);assert.equal(gates,2);
});
const {flowFixture}=require('./warlock-combat-fixture.cjs');
for(const spawn of ['sdms_test_001','ashen_bastion_mob_001'])test('победа '+spawn+': службы/выход доступны, hunt не посылается без сверки',async()=>{
 const f=flowFixture('mage');f.location.search='?spawnId='+spawn;f.setWon(true);f.env.dailyWorkReady=async()=>false;
 await f.farm.nextFight({killed:[]});assert.ok(!f.events.includes('hunt'));assert.ok(f.events.includes('map'));
});
test('Ashen: прямой список не запускает новый бой без дневной сверки',async()=>{
 let clicks=0;const fight={disabled:false,textContent:'Бой'},row={querySelector:s=>s==='.ashen-name'?{textContent:'Моб ур. 60'}:fight,classList:{contains:()=>false}};
 const c={document:{querySelectorAll:()=>[row]},location:{},console};vm.runInNewContext(read('modules/mobfarm.js'),c);
 const env={on:true,tabOwner:true,cfg:{lvlMin:1,lvlMax:99},autonomyMode:()=> 'farm',dailyWorkReady:async()=>false,fire:()=>{clicks++},setStatus(){}};
 await c.L2V7Factories.mobfarm(env).ashenStep();assert.equal(clicks,0);
});
test('attackSpawn: отказ дневной сверки после записи цели не отправляет атаку',async()=>{
 const c={require,__dirname,console,Date,URLSearchParams},source=read('tests/v1027-map-attack-repaint.test.js');
 vm.runInNewContext(source.slice(0,source.indexOf('for(const phase')),c);const f=c.fixture();let gates=0;
 f.env.dailyWorkReady=async()=>{gates++;return false};assert.equal(await f.attack(),false);assert.equal(gates,1);assert.equal(f.fires.length,0);assert.equal(f.waits(),0);
});
for(const modal of [true,false])test('РБ главы: fallback после отказа attackSpawn повторяет gate; modal='+modal,async()=>{
 const m=read('modules/mobfarm.js'),a=m.indexOf('  if (env.campRbOpen().length) {'),b=m.indexOf('  const rules = parseRules();',a),events=[];
 const r={id:'chapter_boss',idx:0,name:'Boss',lvl:33};
 const env={campRbOpen:()=>[{name:'Boss'}],meHp:()=>({pct:100}),raidList:()=>[r],nameLike:()=>true,rt:{campRbSeen:'see:chapter_boss'},cfg:{rbRestHp:95},rbVerdictBlocks:()=>false,setRt:async p=>Object.assign(env.rt,p),on:true,tabOwner:true,fire:e=>{events.push(e.kind);return true},$q:s=>s.includes('pin')?{kind:'pin'}:{kind:'battle'},waitFor:async fn=>typeof fn==='function'?fn():true,rbModalIs:()=>modal,shown:()=>true,isBattle:()=>true,dailyWorkReady:async()=>false};
 const c={env,CSS:{escape:s=>s},Date,encodeURIComponent,location:{},attackSpawn:async()=>false};
 vm.runInNewContext('async function run(){'+m.slice(a,b)+'};this.run=run',c);await c.run();
 assert.deepEqual(events,['pin']);assert.equal(c.location.href,undefined);
});
function catFixture(){
 const c={require,__dirname,console,Date,URLSearchParams},source=read('tests/v207-catacomb-direct-next.test.js');
 vm.runInNewContext(source.slice(0,source.indexOf("test('")),c);return c.fixture();
}
test('катакомбы: отказ после сохранения следующей цели не открывает бой',async()=>{
 const f=catFixture(),url=f.location.href;let gates=0;f.env.dailyWorkReady=async()=>{gates++;return false};
 assert.equal(await f.D.catNext(),true);assert.equal(gates,1);assert.equal(f.location.href,url);assert.ok(f.env.rt.target);
});
test('катакомбы: новый поход ждёт сверку, подтверждение прежнего платежа доступно',async()=>{
 const f=catFixture();let gates=0,confirmed=0;f.env.dailyWorkReady=async()=>{gates++;return false};
 await f.D.catGo();assert.equal(gates,1);assert.equal(f.events.length,0);
 const P={id:'pay1',kind:'cat-teleport',at:10,char:'Hero',quote:{amount:100},evidence:{id:'cat1'}};
 f.env.payments={blocked:()=>true,pending:()=>P,confirm:async()=>{confirmed++;return true}};
 f.env.catPaymentNet=()=>({t:11,id:'cat1',paymentId:'pay1',expectedAdenaCost:100,ok:true,characterName:'Hero',outcome:'applied'});
 await f.D.catGo();assert.equal(confirmed,1);assert.equal(gates,1);
});
for(const kind of ['mode','kick','generation','lease','char','page','stop'])test('idle прерывается за один такт при '+kind,async()=>{
 let now=1e12,sleeps=0;const c={Date:class extends Date{static now(){return now}},on:true,tabOwner:true,rt:{char:'Hero'},cfg:{autoTasks:['fish']},leaseEpoch:1,automationGeneration:1,location:{pathname:'/fishing.html',search:''},modeSig:x=>JSON.stringify(x.autoTasks),setStatus(){},idleTvtBreak:()=>false};
 c.sleep=async ms=>{now+=ms;sleeps++;if(kind==='mode')c.cfg.autoTasks=['auto'];if(kind==='kick')c.rt.manualKickAt=2;if(kind==='generation')c.automationGeneration++;if(kind==='lease')c.leaseEpoch++;if(kind==='char')c.rt.char='Other';if(kind==='page')c.location.pathname='/map.html';if(kind==='stop')c.on=false};
 vm.runInNewContext(src.slice(src.indexOf('function automationSnapshot()'),src.indexOf('function automationCurrent(')),c);
 vm.runInNewContext(src.slice(src.indexOf('async function idle('),src.indexOf('// «реакция»')),c);
 await c.idle(300000,'старая пауза');assert.equal(sleeps,1);assert.equal(now,1e12+1000);
});
