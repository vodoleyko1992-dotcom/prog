'use strict';
// Rebirth: реальные функции диспетчера, перехода с победы, продолжения run и общей квоты; все ответы локальные.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const content=fs.readFileSync(process.env.REBIRTH_INTEGRATION_CONTENT_SOURCE||path.join(root,'content.js'),'utf8');
function excerpt(a,b){const i=content.indexOf(a),j=content.indexOf(b,i);assert.ok(i>=0&&j>i,a);return content.slice(i,j);}
const dispatcher=excerpt('async function mainTick()','// Замок вкладки:');
const integration=excerpt('async function loopRebirth()','// Сторож баффов, обслуживание');
function scheduler(o={}){
 const events=[],S={mode:'rebirth',battle:false,won:false,steps:0,sleeps:[],hook:null,pending:null,blocked:false,...o};
 const c={on:true,tabOwner:true,cfg:{rebirthMode:true},rt:{},autonomyMode:()=>S.mode,rebirthModeSelected:()=>S.mode==='rebirth'&&c.cfg.rebirthMode,
  isBattle:()=>S.battle,victory:()=>S.won,selfHoldMain:()=>false,setStatus:()=>{},location:{pathname:'/rebirth-raids.html'},
  battle:async()=>events.push('battle'),
  L2V7Modules:{payments:{pending:()=>S.pending,blocked:()=>S.blocked},warlock:{paymentReconcile:async()=>events.push('reconcile:summon-buff')},rebirth:{step:async()=>{S.steps++;events.push('rebirth-step');await S.hook?.();return S.stepResult??false}}},sleep:async ms=>S.sleeps.push(ms)};
 for(const [,name] of dispatcher.matchAll(/await (loop\w+)\(/g))if(name!=='loopRebirth')c[name]=async()=>{events.push(name);return false};
 vm.runInNewContext("let rebirthPaymentRead={key:'',at:0};\n"+integration+'\n'+dispatcher,c);return{c,S,events};
}
// 20.71: отдельный ранний цикл Rebirth заменил старый путь через обычные priority/menu/activity.
test('настоящий mainTick: Rebirth владеет кругом даже когда модуль ждёт и возвращает false',async()=>{
 const f=scheduler();assert.equal(await f.c.mainTick(),true);assert.equal(f.S.steps,1);assert.deepEqual(f.S.sleeps,[200]);
 for(const s of ['loopPriority','loopMenuJobs','loopStartPrep','loopTownJobs','loopSideJobs','loopActivity'])assert.ok(!f.events.includes(s),s+' не уводит поход в обычную охоту');
});
test('обычный farm проходит прежний диспетчер, Rebirth-модуль не вызывается',async()=>{
 const f=scheduler({mode:'farm'});await f.c.mainTick();assert.equal(f.S.steps,0);assert.ok(f.events.includes('loopActivity'));
});
test('страница боя передаётся общему battle внутри собственного цикла, без обычных сервисов',async()=>{
 const f=scheduler({battle:true});await f.c.mainTick();assert.equal(f.S.steps,0);assert.ok(f.events.includes('battle'));assert.ok(!f.events.includes('loopActivity'));
});
test('срочная служба сохраняется раньше Rebirth; отправленная оплата сверяется без нового шага похода',async()=>{
 const f=scheduler();f.c.loopUrgent=async()=>true;assert.equal(await f.c.mainTick(),true);assert.equal(f.S.steps,0);
 const paid=scheduler({pending:{id:'paid',kind:'summon-buff'}});assert.equal(await paid.c.mainTick(),true);
 assert.equal(paid.S.steps,0);assert.ok(paid.events.includes('reconcile:summon-buff'));assert.ok(!paid.events.includes('loopPriority'));
 const blocked=scheduler({blocked:true});await blocked.c.mainTick();assert.equal(blocked.S.steps,0);assert.deepEqual(blocked.S.sleeps,[700]);
});
test('Stop и смена режима внутри Rebirth-шага завершают уже выбранный круг без лишней паузы',async()=>{
 for(const kind of ['stop','owner','mode']){const f=scheduler();f.S.hook=()=>{if(kind==='stop')f.c.on=false;if(kind==='owner')f.c.tabOwner=false;if(kind==='mode')f.S.mode='fish'};
  assert.equal(await f.c.loopRebirth(),true);assert.deepEqual(f.S.sleeps,[]);assert.equal(f.S.steps,1);}
});

function returning(){
 const routes=[],title={textContent:'Rebirth · Boss · ур.35'},S={mode:'rebirth',won:true,nick:'Hero',blocked:false,captcha:null,pvp:false,commit:true,hook:null};
 const c={on:true,tabOwner:true,cfg:{rebirthMode:true},rt:{char:'Hero',classCur:{prof:'human_wizard',slot:0}},leaseEpoch:'lease',automationGeneration:1,
  location:{pathname:'/battle.html',search:'?spawnId=rebirth_raid_own_25098_raid_3',href:'https://l2wap.com/battle.html?spawnId=rebirth_raid_own_25098_raid_3'},BATTLE_NET:{spawn:'rebirth_raid_own_25098_raid_3',kind:'dungeon'},URLSearchParams,
  $q:()=>title,heroNick:()=>S.nick,autonomyMode:()=>S.mode,victory:()=>S.won,antibotState:()=>S.captcha,
  L2V7Modules:{actions:{canAct:()=>!S.blocked},pvp:{pending:()=>S.pvp}},actionLocation:{set href(v){routes.push(v)}},rtCommit:async()=>{await S.hook?.();return S.commit}};
 vm.runInNewContext(integration,c);return{c,S,title,routes};
}
test('подтверждённая победа собственного Rebirth возвращается к каталогу вместо карты',async()=>{
 const f=returning();await f.c.rebirthReturn(()=>f.S.won);assert.deepEqual(f.routes,['/rebirth-raids.html']);
});
for(const change of ['stop','owner','hero','hud','class','slot','lease','generation','page','victory','title','metadata','mode','disabled','action','captcha','pvp','failedCommit','valid'])test('rebirthReturn после commit отменяется: '+change,async()=>{
 const f=returning();let allowed=true;f.S.hook=()=>{
  if(change==='stop')f.c.on=false;if(change==='owner')f.c.tabOwner=false;if(change==='hero')f.c.rt.char='Other';if(change==='hud')f.S.nick='Other';
  if(change==='class')f.c.rt.classCur.prof='human_sorcerer';if(change==='slot')f.c.rt.classCur.slot=1;if(change==='lease')f.c.leaseEpoch='new';if(change==='generation')f.c.automationGeneration++;
  if(change==='page')f.c.location.href+='#changed';if(change==='victory')f.S.won=false;if(change==='title')f.title.textContent='New Battle';if(change==='metadata')f.c.BATTLE_NET.spawn='other';
  if(change==='mode')f.S.mode='fish';if(change==='disabled')f.c.cfg.rebirthMode=false;if(change==='action')f.S.blocked=true;if(change==='captcha')f.S.captcha='check';if(change==='pvp')f.S.pvp=true;
  if(change==='failedCommit')f.S.commit=false;if(change==='valid')allowed=false;
 };await f.c.rebirthReturn(()=>allowed&&f.S.won);assert.deepEqual(f.routes,[]);
});

const paidFile=path.join(root,'tests/v2066-rebirth-paid-run.test.js'),paidSrc=fs.readFileSync(paidFile,'utf8');
const paid={require:createRequire(paidFile),__dirname:path.dirname(paidFile),process,console,URL,URLSearchParams,structuredClone};
vm.runInNewContext(paidSrc.slice(0,paidSrc.indexOf('\ntest('))+'\nthis.make=fixture;this.RUN=RUN;this.HERO=HERO;',paid);
function runFixture(o={}){const f=paid.make({won:true,...o});f.state.mode='rebirth';f.env.cfg.rebirthMode=true;
 f.env.rebirthReturn=async valid=>{assert.ok(!valid||valid());f.routes.push('rebirth-catalog')};return f;}
for(const phase of ['mobs','champion','rb_active'])test('настоящее продолжение Rebirth: завершённая роль '+phase+' после300 допускает только native next своего оплаченного run',async()=>{
 const role=phase==='rb_active'?'raid':phase==='champion'?'champion':'mob',f=runFixture({spawn:'rebirth_raid_'+paid.RUN+'_1_1_25146_lv21_'+role+'_19'});
 f.state.instance.activeRun.phase=phase;f.state.instance.activeRun.mobKills=300;await f.run(f.context);
 assert.equal(f.state.nativeClicks,1);assert.equal(f.posts.length,0);assert.equal(f.routes.length,0);assert.equal(f.events.includes('map'),false);assert.deepEqual(Array.from(f.state.quotaCalls),['mobs','mobs']);
});
for(const phase of ['champion','rb_active'])test('20.71: смена большой фазы '+phase+' после обычного моба возвращает в собственную подготовку без native next',async()=>{
 const f=runFixture();f.state.instance.activeRun.phase=phase;f.state.instance.activeRun.mobKills=300;await f.run(f.context);
 assert.equal(f.state.nativeClicks,0);assert.deepEqual(Array.from(f.routes),['rebirth-catalog']);assert.equal(f.posts.length,0);assert.equal(f.events.includes('map'),false);
});
test('прежний farm не автоматизирует новую фазу чемпионов и не открывает новый платный вход',async()=>{
 const f=runFixture();f.state.mode='farm';f.state.instance.activeRun.phase='champion';f.state.instance.activeRun.mobKills=300;await f.run(f.context);
 assert.equal(f.state.nativeClicks,0);assert.equal(f.posts.length,0);assert.equal(f.routes.length,0);
});
test('неизвестная фаза собственного run возвращается к каталогу, не выбирает16РБ через next',async()=>{
 const f=runFixture();f.state.instance.activeRun.phase='synthetic_gate_phase';f.state.instance.activeRun.mobKills=300;await f.run(f.context);
 assert.equal(f.state.nativeClicks,0);assert.deepEqual(Array.from(f.routes),['rebirth-catalog']);assert.equal(f.posts.length,0);
});
for(const kind of ['party','twoParticipants','malformedUUID'])test('режим Rebirth не продолжает неподтверждённый одиночный run: '+kind,async()=>{
 const f=runFixture();if(kind==='party')f.state.instance.activeRun.partyId='party';if(kind==='twoParticipants')f.state.instance.activeRun.participantCharacterIds.push('Other');
 if(kind==='malformedUUID'){f.state.instance.activeRun.id='unsafe';f.state.meta.spawn='rebirth_raid_unsafe_1_1_25146_mob_19';f.location.search='?spawnId='+f.state.meta.spawn;f.context.spawnId=f.state.meta.spawn;}
 await f.run(f.context);assert.equal(f.state.nativeClicks,0);assert.equal(f.posts.length,0);assert.equal(f.routes.length,0);
});
test('обычная победа с выбранным Rebirth не запускает прежние сервисы и продолжение ordinary farm',async()=>{
 const f=runFixture({spawn:'dense_ordinary'});await f.run(f.context);assert.deepEqual(Array.from(f.routes),['rebirth-catalog']);assert.equal(f.state.nativeClicks,0);assert.equal(f.events.includes('map'),false);assert.equal(f.state.services.length,0);
});
test('отсутствующий activeRun после финальногоРБ требует точную сохранённую принадлежность',async()=>{
 const spawn='rebirth_raid_'+paid.RUN+'_25098_lv35_raid_3';
 for(const kind of ['own','none','hero','actor','class','slot','run']){
  const f=runFixture({spawn});f.state.instance.activeRun=null;f.state.accepted=false;
  f.env.rt.rebirth={char:'Hero',actor:paid.HERO,prof:'human_wizard',slot:0,runId:paid.RUN};
  if(kind==='none')delete f.env.rt.rebirth;if(kind==='hero')f.env.rt.rebirth.char='Other';if(kind==='actor')f.env.rt.rebirth.actor='Other';
  if(kind==='class')f.env.rt.rebirth.prof='human_warlock';if(kind==='slot')f.env.rt.rebirth.slot=1;if(kind==='run')f.env.rt.rebirth.runId='33333333-3333-4333-8333-333333333333';
  await f.run(f.context);assert.equal(f.state.nativeClicks,kind==='own'?1:0,kind);assert.equal(f.posts.length,0,kind);
 }
});
test('квота и изменение владельца во время сверки новой фазы отменяют native next',async()=>{
 for(const kind of ['quota','class','owner','run']){const f=runFixture();f.state.instance.activeRun.phase='champion';f.state.instance.activeRun.mobKills=300;
  if(kind==='quota')f.state.quota=false;else f.state.hooks.get=p=>{if(p.includes('rebirth-raids')){if(kind==='class')f.env.rt.classCur.prof='human_sorcerer';if(kind==='owner')f.env.tabOwner=false;if(kind==='run')f.state.instance.activeRun.participantCharacterIds=['Other'];}};
  await f.run(f.context);assert.equal(f.state.nativeClicks,0,kind);assert.equal(f.posts.length,0,kind);
 }
});

const proofSource=excerpt('function rebirthBossProof()','// 23.10 (лог 13:17');
function bossFixture(){const f=returning(),spawn='rebirth_raid_'+paid.RUN+'_1_1_25098_lv35_raid_3';
 f.c.rt.rebirth={char:'Hero',actor:paid.HERO,prof:'human_wizard',slot:0,runId:paid.RUN,runPhase:'rb_active',selectedBossSpawnId:'l2dop_rb_25098'};
 f.c.BATTLE_NET={spawn,kind:'dungeon'};f.c.battleSpawn=()=>f.c.BATTLE_NET?.spawn||'';vm.runInNewContext(proofSource,f.c);return{...f,spawn};}
test('итогРБ связывается с победой выбранного босса при запросе и сохраняется после открытия каталога',()=>{
 const f=bossFixture(),p=f.c.rebirthBossProof();assert.ok(p);f.S.won=false;f.c.location.href='/rebirth-raids.html';f.c.BATTLE_NET=null;
 assert.equal(f.c.rebirthCompletedBoss(f.spawn,{rebirthBoss:p}),true);assert.equal(f.c.rebirthCompletedBoss(f.spawn,{}),false);assert.equal(f.c.rebirthCompletedBoss(f.spawn+'x',{rebirthBoss:p}),false);
});
test('победа с battle:null допускает пустой kind, но не чужой spawn в сетевой метке',()=>{
 const f=bossFixture();f.c.BATTLE_NET.kind='';assert.ok(f.c.rebirthBossProof());f.c.battleSpawn=()=>f.spawn;f.c.BATTLE_NET.spawn='other';assert.equal(f.c.rebirthBossProof(),null);
});
for(const kind of ['noVictory','otherBoss','mob','kind','foreignChar','class','slot','phase','mode'])test('запрос next не доказывает завершение выбранногоРБ: '+kind,()=>{
 const f=bossFixture();if(kind==='noVictory')f.S.won=false;if(kind==='otherBoss')f.c.rt.rebirth.selectedBossSpawnId='l2dop_rb_25041';if(kind==='mob')f.c.BATTLE_NET.spawn=f.spawn.replace(/_raid_3$/,'_mob_300');
 if(kind==='kind')f.c.BATTLE_NET.kind='passive';if(kind==='foreignChar')f.c.rt.rebirth.char='Other';if(kind==='class')f.c.rt.rebirth.prof='human_sorcerer';if(kind==='slot')f.c.rt.rebirth.slot=1;if(kind==='phase')f.c.rt.rebirth.runPhase='mobs';if(kind==='mode')f.S.mode='farm';
 assert.equal(f.c.rebirthBossProof(),null);
});
for(const kind of ['hero','hud','class','slot','lease','generation','run','actor','mode','disabled','stop','owner'])test('поздний итог next после смены контекста не завершает новый поход: '+kind,()=>{
 const f=bossFixture(),p=f.c.rebirthBossProof();assert.ok(p);
 if(kind==='hero')f.c.rt.char='Other';if(kind==='hud')f.S.nick='Other';if(kind==='class')f.c.rt.classCur.prof='human_sorcerer';if(kind==='slot')f.c.rt.classCur.slot=1;if(kind==='lease')f.c.leaseEpoch='other';if(kind==='generation')f.c.automationGeneration++;
 if(kind==='run')f.c.rt.rebirth.runId='other';if(kind==='actor')f.c.rt.rebirth.actor='other';if(kind==='mode')f.S.mode='farm';if(kind==='disabled')f.c.cfg.rebirthMode=false;if(kind==='stop')f.c.on=false;if(kind==='owner')f.c.tabOwner=false;
 assert.equal(f.c.rebirthCompletedBoss(f.spawn,{rebirthBoss:p}),false);
});

const quotaFile=path.join(root,'tests/v208-farm-kill-quota.test.js'),quotaSrc=fs.readFileSync(quotaFile,'utf8');
const quotaBox={require:createRequire(quotaFile),__dirname:path.dirname(quotaFile),URL,URLSearchParams,Date,structuredClone,console};
vm.runInNewContext(quotaSrc.slice(0,quotaSrc.indexOf("for(const task of ['auto','cat'])"))+'\nthis.make=fixture;',quotaBox);
function quotaFixture(cap=5){const f=quotaBox.make();Object.assign(f.state.cfg,{autoTasks:['rebirth'],rebirthMode:true,zoneAuto:false,dailyKillLimit:cap,autoKillLimit:1,catKillLimit:1});
 f.refresh();const c=f.c;Object.assign(c,{automationGeneration:1,isBattle:()=>false,isFishing:()=>false,fishNow:()=>false,fishState:()=>null,victory:()=>false,heroNick:()=>c.rt.char});
 c.autonomyMode=()=>{const t=c.L2EngineCore.selectedTask(c.cfg,c.rt);return t==='auto'?'farm':t==='quests'?'campaign':t||'farm'};
 c.automationSnapshot=()=>JSON.stringify([c.automationGeneration,c.leaseEpoch,c.rt.char,c.rt.manualKickAt,c.cfg.autoTasks,c.location.search]);
 c.automationCurrent=stamp=>c.on&&c.tabOwner&&stamp===c.automationSnapshot();
 c.rt.dailyServerCheck={day:c.L2EngineCore.dailyDay(Date.now(),c.rt),char:c.rt.char,start:c.rt.dailyStart||0};return f;}
test('настоящие quota/gate: Rebirth не наследует сессионную цель autoKillLimit1',async()=>{
 const f=quotaFixture(0);assert.equal(f.c.farmQuotaTask(),'rebirth');assert.equal(vm.runInNewContext('farmQuotaLimit("rebirth")',f.c),0);assert.equal(await f.c.dailyWorkReady('mobs'),true);
 f.c.gameGet=()=>assert.fail('при отключённом дневном cap у Rebirth нет сессионного лимита');assert.equal(await f.begin(),null);
});
test('настоящие content+background: убийства Rebirth идут в общий auto+cat день, повтор не считает их дважды',async()=>{
 const f=quotaFixture(),day=f.c.L2EngineCore.dailyDay(Date.now(),f.c.rt);f.state.rt.dailyQuota={day,basis:'server',auto:0,cat:1};f.refresh();
 f.c.rt.dailyServerCheck={day,char:f.c.rt.char,start:f.c.rt.dailyStart||0};assert.equal(await f.c.dailyWorkReady('mobs'),true);
 let t=await f.begin();assert.ok(t);f.grow(2);await f.win(t);assert.equal(f.state.rt.farmQuota.rebirth.got,2);assert.equal(f.state.rt.farmQuota.rebirth.limit,0);assert.equal(f.state.rt.farmQuota.rebirth.done,false);
 assert.equal(f.state.rt.dailyQuota.auto,2);assert.equal(f.state.rt.dailyQuota.cat,1);assert.equal(f.state.cfg.rebirthMode,true);assert.ok(f.state.cfg.autoTasks.includes('rebirth'));
 await f.win(t);assert.equal(f.state.rt.dailyQuota.auto,2);f.refresh();t=await f.begin();f.grow(2);await f.win(t);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.dailyQuota.cat,1);
 f.refresh();assert.equal(await f.c.dailyWorkReady('mobs'),false);assert.equal(f.state.on,true);
});
test('сброс общей дневной квоты инвалидирует сохранённую Rebirth-победу',async()=>{
 const f=quotaFixture(),t=await f.begin();assert.ok(t);await f.menu({rtPatch:{manualKickAt:2},resetDailyQuota:'mobs'});f.refresh();f.grow(2);await f.win(t);
 assert.equal(f.state.rt.dailyQuota.auto||0,0);assert.ok(!f.state.rt.farmQuota?.rebirth?.pending);assert.equal(f.state.cfg.rebirthMode,true);
});

// Скопированный sessionStorage не доказывает вкладку: нужен настоящий ответ background tabId.
const tabInit=excerpt('let TAB_KEY = (() =>','let tabOwner = false;');
const tabGetter=content.match(/get browserTabKey\(\)\{[^}]+\}/)?.[0];assert.ok(tabGetter,'проверяем настоящий getter фабрики Rebirth');
function browserIdentity(reply,fallback='tab123'){
 const store=new Map([['l2botTab',fallback]]),c={Math,sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
  chrome:{runtime:{sendMessage:m=>{assert.equal(m.cmd,'tabId');return typeof reply==='function'?reply():Promise.resolve(reply)}}}};
 vm.runInNewContext(tabInit+'\nthis.ready=TAB_KEY_READY;this.lockKey=()=>TAB_KEY;this.rebirthEnv={'+tabGetter+'};',c);return c;
}
test('background tabId даёт устойчивую Rebirth-идентичность при reload и отличает дубликат вкладки',async()=>{
 const first=browserIdentity(7),reload=browserIdentity(7,'tab999'),duplicate=browserIdentity(8);
 assert.equal(first.rebirthEnv.browserTabKey,'');await Promise.all([first.ready,reload.ready,duplicate.ready]);
 assert.equal(first.rebirthEnv.browserTabKey,'tab7');assert.equal(reload.rebirthEnv.browserTabKey,'tab7');assert.equal(duplicate.rebirthEnv.browserTabKey,'tab8');assert.equal(first.lockKey(),'tab7');
 const zero=browserIdentity(0);await zero.ready;assert.equal(zero.rebirthEnv.browserTabKey,'tab0');
});
test('ожидание background не превращает правдоподобный sessionStorage tab123 в доказательство вкладки',async()=>{
 let answer;const f=browserIdentity(()=>new Promise(resolve=>{answer=resolve}));assert.equal(f.lockKey(),'tab123');assert.equal(f.rebirthEnv.browserTabKey,'');
 answer(42);await f.ready;assert.equal(f.rebirthEnv.browserTabKey,'tab42');assert.equal(f.lockKey(),'tab42');
});
for(const reply of ['7',null,undefined,-1,1.5,NaN,{id:7}])test('нецелый background tabId '+String(reply)+' оставляет Rebirth-proof пустым',async()=>{
 const f=browserIdentity(reply);await f.ready;assert.equal(f.lockKey(),'tab123');assert.equal(f.rebirthEnv.browserTabKey,'');
});
test('отказ background API сохраняет legacy lock, но не разрешает Rebirth-proof из fallback',async()=>{
 const f=browserIdentity(()=>Promise.reject(Error('background unavailable')));await f.ready;assert.equal(f.lockKey(),'tab123');assert.equal(f.rebirthEnv.browserTabKey,'');
});
