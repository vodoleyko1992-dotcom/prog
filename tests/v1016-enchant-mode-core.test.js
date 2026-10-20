'use strict';
// 15.10.2026: выбранная заточка владеет циклом даже при пустой очереди и паузе.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(base,p),'utf8'),core=read('content.js');
const lifecycle=read('tests/v1016-enchant-lifecycle.test.js');
const fixtureBox={require,__dirname:path.join(base,'tests'),console,URLSearchParams};
vm.runInNewContext(lifecycle.slice(0,lifecycle.indexOf("test('по умолчанию"))+';this.fixture=fixture;',fixtureBox);
function fixture(opts){const f=fixtureBox.fixture(opts);f.env.cfg.enchantMode=true;return f;}
function coreFixture(){
 const calls=[],c=vm.createContext({console,URL,Date,Promise,Math,L2EngineCore:require('../engine-core.js'),taskPolicyNote(){},location:{origin:'https://fixture.invalid',pathname:'/map.html',search:'',href:''},
  on:true,tabOwner:true,cfg:{enchantMode:true,enchant:{enabled:true},tvtOn:true},rt:{char:'Hero'},hero:'Hero',battleNow:false,fishCaught:false,nearTvt:false,ab:false,calls,
  L2V7Factories:{enchant:env=>({step:async()=>{calls.push('enchant');return true},command:async cmd=>{calls.push(cmd);if(cmd==='pause')c.rt.enchant={...c.rt.enchant,status:'paused'};return true}}),warlock:()=>({})},L2V7Modules:{}});
 vm.runInContext(`const heroNick=()=>hero,antibotState=()=>ab,autonomyMode=()=>cfg.enchantMode===true?'enchant':'farm';
 const awayFree=()=>!battleNow&&!fishCaught&&!nearTvt&&!rt.shop&&!rt.rbGo&&!rt.zoneGo&&!rt.revive&&!rt.tbuff&&!rt.magister&&!rt.invScan&&!rt.fishSvc;
 L2V7Modules.mammon={modeFree:awayFree};
 const setStatus=s=>calls.push(s),setRt=async p=>{Object.assign(rt,p);return {ok:true}},rtCommit=async()=>true;`,c);
 const start=core.indexOf('// Автозаточка: команды меню'),end=core.indexOf('chrome.runtime.onMessage.addListener',start);
 assert.ok(start>0&&end>start);vm.runInContext(core.slice(start,end),c);return c;
}
function mainFixture(options={}){
 const c=coreFixture(),calls=c.calls,noop=()=>false,done=name=>async()=>{calls.push(name);c.on=false;return true};
 Object.assign(c,{lifestoneCommandBusy:false,running:false,window:{__lockT:Date.now()},deferredMigrations:{cfg:{},rt:{}},migApplied:noop,
  isBattle:()=>!!options.battle,isMap:()=>!options.battle,isFishing:()=>!!options.catch,fishState:()=>!!options.catch,fishNow:noop,
  campEnabled:noop,farmDb:async()=>{},recipeDb:async()=>{},learnSkillDb(){},progressMonitor:{tick:(sig,active)=>{calls.push(['watchdog',active]);return 'progress'}},
  meHp:noop,mobHp:noop,serverDown:noop,loginPage:noop,leaveCheck:async()=>false,tvtStep:options.tvt?done('TvT'):async()=>false,
  pveFishingStep:async()=>false,antibotGuard:options.antibot?done('antibot'):async()=>false,shopStep:done('urgent shop'),reviveStep:done('revive'),battle:done('battle'),fishFight:done('catch'),
  magisterDisable:done('magister disable'),magisterStep:done('magister step'),magisterStart:done('magister start'),tvtSoon:noop,
  sleep:async()=>{c.on=false},softError:async e=>{throw e},rec(){},stopPendRetry:async()=>false,   // 20.13 (шаг 5, core-a/M6)
 });
 Object.assign(c.L2V7Modules,{pvp:{recoveryStep:options.recovery?done('recovery'):async()=>false,seedConfirmed:async()=>{},step:async()=>false},
  raid:{rbOneStep:async()=>false},enemies:{tick:async()=>{},step:async()=>false},rbtimer:{tick:async()=>{}},
  tvt:{tvtHold:noop,tvtWait:done('TvT wait')}});
 if(options.urgent)c.rt.shop={urgent:true,t:Date.now()};if(options.revive)c.rt.revive={};
 const start=core.indexOf('async function main() {'),end=core.indexOf('// Магистр: актуальный',start);assert.ok(start>0&&end>start);vm.runInContext(core.slice(start,end),c);return c;
}
test('выбранная заточка сильнее всех старых флагов режимов',()=>{const c={};vm.runInNewContext(read('engine-core.js'),c);assert.equal(c.L2EngineCore.chooseMode({enchant:true,epic:true,raid:true,fish:true,cat:true,campaign:true,tasks:true}),'enchant');assert.equal(c.L2EngineCore.chooseMode({enchant:false,raid:true}),'raid')});
test('старый enabled не выбирает режим и не разрешает start',async()=>{const f=fixture();delete f.env.cfg.enchantMode;assert.equal(await f.start(),false);assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant,undefined)});
test('resume требует заново выбрать режим',async()=>{const f=fixture();await f.start();await f.M.command('pause');f.env.cfg.enchantMode=false;assert.equal(await f.M.command('resume'),false);assert.equal(f.env.rt.enchant.status,'paused')});
for(const point of ['get','pause','prepared'])test('смена режима во время '+point+' запрещает расход',async()=>{const f=fixture();await f.start();const stop=()=>{f.env.cfg.enchantMode=false};if(point==='get')f.onGet=stop;if(point==='pause')f.onPause=stop;if(point==='prepared')f.afterSet=p=>{if(p.enchant?.pending)stop()};await f.tick();assert.equal(f.posts.length,0);assert.equal(f.location.href,'');if(point==='prepared')assert.equal(f.env.rt.enchant.pending,null)});
test('выход из режима паузит старую серию без автоматического resume',async()=>{const f=fixture();await f.start();f.env.cfg.enchantMode=false;await f.tick();assert.equal(f.env.rt.enchant.status,'paused');f.env.cfg.enchantMode=true;await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.status,'paused')});
test('результат отправленной попытки учитывается после выхода и Stop',async()=>{const f=fixture();await f.start();f.mode='timeout';await f.tick();f.env.cfg.enchantMode=false;f.env.on=false;f.snap.inventory.eq.l1.enchant=4;f.snap.inventory.eq.l1.enchantMAtkBonus=24;f.snap.revision++;f.snap.inventory.stacks.find(x=>x.itemId===910527).qty--;await f.M.note(f.posts[0],{attemptedCount:1,successCount:1,failCount:0,scrollConsumedCount:1,previousEnchantLevel:3,currentEnchantLevel:4,updatedTargetInstanceId:'eq:l1'},200);assert.equal(f.env.rt.enchant.totals.attempts,1);assert.equal(f.env.rt.enchant.status,'paused');assert.equal(f.env.rt.enchant.pending,null);assert.equal(f.posts.length,1)});
test('неизвестный результат сверяется после выхода без повтора',async()=>{const f=fixture();await f.start();f.mode='timeout';await f.tick();f.env.cfg.enchantMode=false;f.env.on=false;f.advance(20000);await f.tick();assert.equal(f.env.rt.enchant.pending.state,'unknown');assert.equal(f.posts.length,1)});
for(const status of ['empty','paused','done','running','disabled'])test('main удерживает режим '+status+' раньше магистра и остальных задач',async()=>{const c=mainFixture();if(status!=='empty')c.rt.enchant={runId:'run',status:status==='disabled'?'running':status};if(status==='disabled')c.cfg.enchant.enabled=false;await vm.runInContext('main()',c);assert.ok(!c.calls.some(x=>typeof x==='string'&&x.startsWith('magister')),JSON.stringify(c.calls));assert.equal(c.location.href,'');assert.equal(c.cfg.enchantMode,true)});
for(const [key,label] of [['recovery','recovery'],['revive','revive'],['tvt','TvT'],['antibot','antibot'],['urgent','urgent shop'],['battle','battle'],['catch','catch']])test('main сохраняет приоритет '+label,async()=>{const c=mainFixture({[key]:true});await vm.runInContext('main()',c);assert.ok(c.calls.includes(label),JSON.stringify(c.calls));assert.ok(!c.calls.includes('enchant'))});
test('ожидание чужой задачи не вызывает watchdog и объясняет причину',async()=>{const c=mainFixture();c.rt.magister={t:Date.now()};c.rt.enchant={status:'running'};await vm.runInContext('main()',c);assert.deepEqual(c.calls.filter(Array.isArray).map(x=>x[1]),[false]);assert.ok(c.calls.some(x=>typeof x==='string'&&/магистр/i.test(x)),JSON.stringify(c.calls));assert.ok(!c.calls.includes('magister start'))});
test('готовая серия не уводит со страницы заточки',async()=>{const c=coreFixture();c.rt.enchant={runId:'run',status:'done',home:'/map.html'};c.location.pathname='/enchant.html';await vm.runInContext('enchantDispatch()',c);assert.equal(c.location.href,'');assert.equal(c.rt.enchant.returned,undefined)});
function chainFixture({cat=false,changeAt='',mode='farm'}={}) {
 const calls=[],box={console,Date,URLSearchParams,location:{pathname:'/battle.html',search:cat?'?spawnId=sdms_crypt_001':'?spawnId=dense_001',href:'/battle.html'}};
 vm.runInNewContext(read('modules/mobfarm.js'),box);
 // 20.32: этот стенд проверяет отмену native-цепочки при смене режима; «Авто» теперь использует отдельный fresh-list путь.
 const env={on:true,tabOwner:true,cfg:{chain:true,catMode:cat,catDungeon:cat?'crypt':'auto',priority:'[все]',shopAuto:false},rt:{catIn:cat?'crypt':null},
  autonomyMode:()=>mode,tvtSoon:()=>false,rnd:()=>0,sleep:async()=>{if(changeAt==='sleep')mode='enchant'},victory:()=>true,pvpPending:()=>false,
  pvpStep:async()=>{calls.push('pvp');return false},huntOn:()=>false,epicOn:()=>false,toMap:async()=>calls.push('map'),
  townBuffStart:async()=>{calls.push('buff');return false},shopNeedByPanel:()=>'',resQuests:()=>[],campOn:()=>false,campEnabled:()=>false,campMobOpen:()=>[],campActive:()=>false,
  farmRules:()=>[],recipeRules:()=>[],mapDue:()=>false,searchActive:()=>false,antibotState:()=>false,
  waitFor:async fn=>{if(changeAt==='wait')mode='enchant';return fn()},$q:()=>({}),shown:()=>true,
  fire:()=>{calls.push('fire');env.on=false},setRt:async p=>Object.assign(env.rt,p),setStatus(){},rec(){},mobHp:()=>({cur:10})};
 return {env,calls,M:box.L2V7Factories.mobfarm(env)};
}
for(const cat of [false,true]) {
 test((cat?'катакомбы':'обычная цепочка')+': заточка после победы не запускает обслуживание и следующий бой',async()=>{const f=chainFixture({cat,mode:'enchant'});await f.M.nextFight();assert.deepEqual(f.calls,['map'])});
 for(const changeAt of ['sleep','wait'])test((cat?'катакомбы':'обычная цепочка')+': смена режима во время '+changeAt+' не нажимает охотиться дальше',async()=>{const f=chainFixture({cat,changeAt});await f.M.nextFight();assert.equal(f.calls.includes('fire'),false);assert.equal(f.calls.at(-1),'map')});
 test((cat?'катакомбы':'обычная цепочка')+': прежний режим продолжает охоту',async()=>{const f=chainFixture({cat});await f.M.nextFight();assert.ok(f.calls.includes('fire'))});
}
test('выход из режима в core сохраняет pending и не продолжает серию при возврате',async()=>{const c=coreFixture();c.rt.enchant={runId:'run',status:'running',pending:{id:'receipt'},history:[{id:'past'}]};c.cfg.enchantMode=false;await vm.runInContext('enchantDispatch()',c);assert.equal(c.rt.enchant.status,'paused');assert.equal(c.rt.enchant.pending.id,'receipt');assert.equal(c.rt.enchant.history[0].id,'past');c.cfg.enchantMode=true;await vm.runInContext('enchantDispatch()',c);assert.equal(c.rt.enchant.status,'paused')});
test('конфликт ревизии после выхода из режима не перезагружает чужую страницу',async()=>{const f=fixture();await f.start();f.mode='timeout';await f.tick();f.env.cfg.enchantMode=false;await f.M.note(f.posts[0],{},409);assert.equal(f.events.includes('reload'),false);await f.tick();assert.equal(f.env.rt.enchant.status,'paused');assert.equal(f.posts.length,1)});
test('новый профиль не включает заточку автоматически',()=>{const profile=JSON.parse(read('base-profile.json'));assert.notEqual(profile.cfg.enchantMode,true)}); // 20.12: ключи режимов убраны из профиля — отсутствие = ВЫКЛ
// Настоящий участок main: выбор заточки приходит во время чужого await, до следующей задачи.
for(const interrupted of ['mammon','story','shop','clan','daily','trip','warlock'])test('смена режима во время '+interrupted+' не запускает следующую задачу',async()=>{
 const calls=[],c=vm.createContext({L2EngineCore:require('../engine-core.js'),on:true,tabOwner:true,cfg:{enchantMode:false},rt:{petBufferTrip:{}},calls});
 const step=name=>async()=>{calls.push(name);await Promise.resolve();if(name===interrupted)c.cfg.enchantMode=true;return false};
 Object.assign(c,{autonomyMode:()=>c.cfg.enchantMode?'enchant':'farm',isBattle:()=>false,sleep:async()=>{},farmGuideTick(){},enchantDispatch:async()=>false,epicOn:()=>{calls.push('fallback');return false},warlockTripStep:step('trip'),
  L2V7Modules:{mammon:{mmTick:async()=>{},mmStep:step('mammon')},subclass:{tick:async()=>{}},story:{storyTick:async()=>{},storyStep:step('story')},
  tvtshop:{shopStep:step('shop')},dailies:{tick:async()=>{},clanStep:step('clan'),dailyStep:step('daily')},warlock:{step:step('warlock')}}});
 // 20.13 (ревизия 17.10, шаг 7): участок main стал шагом loopSideJobs() — берём настоящие шаги цикла и зовём этот шаг
 const start=core.indexOf('async function main() {'),end=core.indexOf('// Магистр: актуальный',start);assert.ok(start>0&&end>start&&core.slice(start,end).includes('async function loopSideJobs()'));
 vm.runInContext(core.slice(start,end),c);
 await vm.runInContext('(async()=>{if(autonomyMode()!=="enchant")await loopSideJobs();})()',c);
 assert.equal(calls.at(-1),interrupted,JSON.stringify(calls));
});
