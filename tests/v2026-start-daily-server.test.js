'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../engine-core.js'),data=require('./tools/daily-server-fixture.cjs');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(mobs=8055,fish=1511){
 const box={require:x=>x==='node:test'?()=>{}:require(x),__dirname,URL,URLSearchParams,Date,structuredClone,console};const src=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(src.slice(0,src.indexOf("for(const task of ['auto','cat'])")),box);const f=box.fixture(),c=f.c,requests=[];
 f.state.cfg.autoKillLimit=0;f.state.cfg.dailyKillLimit=8000;f.state.cfg.dailyFishLimit=1511;f.refresh();Object.assign(c,{isBattle:()=>false,isFishing:()=>false,heroNick:()=>c.rt.char,automationGeneration:1});
 const d=data();d.daily.tasks.hunt_start_500={score:mobs,have:500,need:500,done:true,claimed:true,leader:{score:999999}};d.daily.tasks.fishing_catch_50={score:fish,have:50,need:50,done:true};d.daily.tasks.damage_dealer_500k.score=39087476;
 const charGet=c.gameGet;c.gameGet=async path=>{requests.push(path);if(path==='/character')return charGet();return {ok:true,json:async()=>path==='/game/time'?d.clock:d.daily}};
 return {...f,d,requests,sync:()=>c.dailyServerSync()};
}
test('первый старт восстанавливает полный score8055/1511, а не have500/50 или счёт лидера; сохраняет все8 заданий',async()=>{
 const f=fixture();assert.equal(await f.sync(),true);assert.equal(E.dailyCount(f.c.rt,'auto'),8055);assert.equal(E.dailyCount(f.c.rt,'fish'),1511);assert.equal(E.dailyBlocked(f.c.cfg,f.c.rt,'auto'),true);assert.equal(E.dailyBlocked(f.c.cfg,f.c.rt,'fish'),true);assert.equal(f.state.rt.daily.tasks.damage_dealer_500k.score,39087476);assert.equal(Object.keys(f.state.rt.daily.tasks).length,8);assert.equal(f.state.rt.daily.tasks.hunt_start_500.leader,undefined);
 assert.deepEqual(f.requests,['/game/time','/game/daily-quests']);await f.sync();assert.equal(f.requests.length,2);
});
test('серверный остаток + новая добыча: старые500 не удваиваются, новые100 закрывают ровно8000',async()=>{
 const f=fixture(7900,100);f.state.rt.dailyQuota={day:E.dailyDay(),basis:'server',auto:400,cat:100,fish:100};f.refresh();await f.sync();assert.equal(f.state.rt.dailyQuota.server,7400);assert.equal(E.dailyCount(f.c.rt,'auto'),7900);const t=await f.begin();f.grow(100);await f.win(t);assert.equal(E.dailyCount(f.c.rt,'auto'),8000);assert.equal(E.dailyBlocked(f.c.cfg,f.c.rt,'cat'),true);
 f.state.rt.dailyStart=2;f.refresh();f.d.daily.tasks.hunt_start_500.score=8000;await f.sync();assert.equal(E.dailyCount(f.c.rt,'auto'),8000);
});
test('рыба сверяется с текущей локальной отметкой, следующий улов учитывается один раз',async()=>{
 const f=fixture(0,100);f.state.rt.fish={t0:10,caught:20};f.refresh();await f.sync();assert.equal(f.state.rt.dailyFishMark.caught,20);await f.c.dailyLimitFishSync();assert.equal(f.state.rt.dailyQuota.fish,100);f.c.rt.fish.caught++;f.state.rt.fish.caught++;await f.c.dailyLimitFishSync();assert.equal(f.state.rt.dailyQuota.fish,101);
});
test('новый явный старт перечитывает сервер; изменение лимита и ручной сброс в текущем запуске не повторяют GET',async()=>{
 const f=fixture(7900,10);await f.sync();await f.menu({cfgPatch:{dailyKillLimit:9000}});f.refresh();await f.sync();assert.equal(f.requests.length,2);await f.menu({resetDailyQuota:'mobs'});f.refresh();await f.sync();assert.equal(E.dailyCount(f.c.rt,'auto'),0);assert.equal(f.requests.length,2);
 await f.menu({on:true});f.refresh();await f.sync();assert.equal(f.requests.length,4);assert.equal(E.dailyCount(f.c.rt,'auto'),7900);
});
test('начатый бой/улов заканчивается до сверки: нет двойного учёта и блокировки завершения',async()=>{
 for(const patch of [{isBattle:()=>true},{rt:{fishCastActive:true}},{rt:{fishCastPending:{at:1}}},{isFishing:()=>true,fishState:()=>({hp:1})}]){const f=fixture();if(patch.rt)Object.assign(f.c.rt,patch.rt);else Object.assign(f.c,patch);assert.equal(await f.sync(),true);assert.equal(f.requests.length,0);assert.equal(f.state.rt.dailyServerCheck,undefined);}
});
test('ошибка/неполный score/чужой день не разрешают новую охоту под лимитом; повтор ограничен15с',async()=>{
 for(const mutate of [d=>delete d.daily.tasks.hunt_start_500.score,d=>d.daily.dayKey='20200101',d=>d.clock.timeZone='bad/zone']){const f=fixture();mutate(f.d);assert.equal(await f.sync(),false);assert.equal(f.state.rt.dailyServerCheck,undefined);const n=f.requests.length;assert.equal(await f.sync(),false);assert.equal(f.requests.length,n);}
});
for(const kind of ['stop','char','hud','lease','kick','generation'])test('поздняя проверка после '+kind+' не применяется',async()=>{
 const f=fixture(),get=f.c.gameGet;f.c.gameGet=async path=>{const r=await get(path);if(path==='/game/daily-quests'){if(kind==='stop')f.c.on=false;if(kind==='char')f.c.rt.char='Other';if(kind==='hud')f.c.heroNick=()=> 'Other';if(kind==='lease')f.c.leaseEpoch++;if(kind==='kick')f.c.rt.manualKickAt++;if(kind==='generation')f.c.automationGeneration++;}return r};await f.sync();assert.equal(f.state.rt.dailyServerCheck,undefined);
});
test('дневной счёт с сервера включён в UI и общий предел; в полночь старый остаток исчезает',()=>{
 const js=read('popup.js'),ctx={Date,L2EngineCore:E};vm.runInNewContext(js.slice(js.indexOf('function dailyMobBoardRow('),js.indexOf('function renderWorkspace(')),ctx);
 const now=Date.now(),rt={dailyQuota:{basis:'server',day:E.dailyDay(now),auto:100,server:7955}},row=ctx.dailyMobBoardRow(rt,{dailyKillLimit:8000},now);assert.match(row.progress,/8055 \/ 8000/);assert.equal(row.percent,100);assert.match(row.progress,/ранее по серверу: 7955/);assert.equal(E.dailyCount(rt,'auto',now+86400000),0);
});

test('ожидание проверки передаёт круг срочному TvT/воскрешению и следующим службам',async()=>{
 const src=read('content.js'),part=src.slice(src.indexOf('async function loopGate()'),src.indexOf('  if((Object.keys(cfg.limitRanges||{}).length'))+'}';
 // 19.10, аудит автономности: gate больше не завершает круг; настоящий mainTick доходит до срочных и обычных служб.
 for(const urgent of [true,false]){let calls=0,services=0;const ctx={on:true,tabOwner:true,L2V7Modules:{actions:{enterFrame(){}}},rt:{},serverDown:()=>false,loginPage:()=>false,antibotState:()=>null,dailyServerSync:async()=>false,loopUrgent:async()=>{calls++;return urgent}};vm.runInNewContext(part,ctx);assert.equal(await ctx.loopGate(),undefined);
  // 20.43: в mainTick новый шаг loopTravel (сверка квитанции перелёта) — заглушка, как у прочих шагов; проверка прежняя
  // 20.43 (автономность): новый шаг передышки loopSelfHold (после срочных) — здесь без передышки; 20.43 (ревью au/breather): + loopSelfHoldWait
  for(const k of ['loopLease','loopMigrations','loopWatchdog','loopSelfHold','loopTravel','loopTaskList','loopEnchant','loopPriority','loopMenuJobs','loopTownJobs','loopSelfHoldWait','loopRaid','loopActivity'])ctx[k]=async()=>false;
  ctx.loopSideJobs=async()=>{services++;return true};vm.runInNewContext(src.slice(src.indexOf('async function mainTick()'),src.indexOf('// Замок вкладки:')),ctx);await ctx.mainTick();assert.equal(calls,1);assert.equal(services,urgent?0:1);
 }
});

test('цепочка после начатого боя проверяет сервер перед передачей в nextFight, даже на battle.html',async()=>{
 const f=fixture();f.c.isBattle=()=>true;await f.sync();assert.equal(f.requests.length,0);
 let next=0;f.c.L2V7Modules={mobfarm:{nextFight:()=>{next++;assert.equal(E.dailyBlocked(f.c.cfg,f.c.rt,'auto'),true);return 'checked'}}};
 const js=read('content.js');vm.runInNewContext(js.match(/async function nextFight\(\.\.\.args\) \{[^\n]+/)[0],f.c);
 assert.equal(await f.c.nextFight(),'checked');assert.equal(next,1);assert.deepEqual(f.requests,['/game/time','/game/daily-quests']);
});
