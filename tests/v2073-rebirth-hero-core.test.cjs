'use strict';
// Лог28.10 04:59: изолированный Rebirth должен восстановить героя до missing-run/Fight, сохранив чужие запреты.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'content.js'),'utf8'),engine={};
vm.runInNewContext(fs.readFileSync(path.join(root,'engine-core.js'),'utf8'),engine);const E=engine.L2EngineCore;
const a=source.indexOf('function rebirthHeroNeeded('),b=source.indexOf('// Сторож баффов, обслуживание',a);assert.ok(a>=0&&b>a,'настоящие функции подготовки найдены');
const helpers=source.slice(a,b),loop=source.match(/async function loopRebirth\(\) \{[\s\S]*?\n\}/)[0];
const RUN='11111111-1111-4111-8111-111111111111',SPAWN='rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_9';
function fixture(o={}){
 let now=1793160000000,href='https://l2wap.com/rebirth-raids.html';const events=[],reads=[],writes=[],S={mode:true,battle:false,won:false,generation:1,pending:false,canAct:true,captcha:false,ab:false,pvp:false,buffNeed:null,readOk:true,saveOk:true,restore:false,hooks:{},...o};
 const location={get href(){return href},set href(v){href=new URL(v,href).href;events.push('navigate:'+new URL(href).pathname)},get pathname(){return new URL(href).pathname},get search(){return new URL(href).search}};
 const ch={id:'own-actor',name:'Hero',level:38,l2Profession:'human_wizard',classSlots:{activeSlot:0},revision:100,inBattle:false,hp:359,maxHp:2292};
 const marker={kind:'death',char:'Hero',prof:'human_wizard',slot:0,kick:5,actor:'own-actor'};
 const c={on:true,tabOwner:true,cfg:{autoTasks:['rebirth'],rebirthMode:true,petAuto:true},rt:{char:'Hero',manualKickAt:5,classCur:{prof:'human_wizard',slot:0}},leaseEpoch:'lease',location,URLSearchParams,
  Date:class extends Date{static now(){return now}},L2EngineCore:E,
  rebirthModeSelected:()=>S.mode&&c.cfg.rebirthMode,isBattle:()=>S.battle,victory:()=>S.won,
  automationSnapshot:()=>S.generation,automationCurrent:x=>x===S.generation,heroNick:()=>S.nick||'Hero',heroLvl:()=>38,
  antibotState:()=>S.captcha,abHold:()=>S.ab,meHp:()=>S.hp||{cur:ch.hp,max:ch.maxHp},petState:()=>S.pet||{has:true,t:now},
  townBuffStep:async()=>{events.push('buff');await S.hooks.buff?.();if(S.restore){c.rt.tbuff=null;ch.hp=ch.maxHp;S.buffNeed=null;}},
  setRt:async p=>{writes.push(structuredClone(p));if(S.saveOk||S.localBeforeAck)Object.assign(c.rt,p);await S.hooks.save?.(p);return{ok:S.saveOk}},
  rtCommit:async()=>{events.push('commit');await S.hooks.commit?.();return S.saveOk;},
  gameGet:async url=>{reads.push(url);await S.hooks.read?.(url);if(S.throwRead)throw Error('read failed');return{ok:S.readOk,json:async()=>{await S.hooks.json?.(url);return{character:structuredClone(ch)}}}},
  setStatus:s=>events.push('status:'+s),sleep:async ms=>events.push('sleep:'+ms),selfHoldMain:()=>!!S.selfHold,selfHoldNow:()=>({}),selfHoldText:()=> 'hold',LOOP:{},
  paymentReconcileOnly:async()=>events.push('reconcile'),petBufferTrip:null,
  rebirthPetTrip:()=>false,warlockTripStep:async()=>events.push('pet-trip'),
  L2V7Modules:{actions:{canAct:()=>S.canAct},payments:{blocked:()=>S.pending,pending:()=>S.payment||null},pvp:{pending:()=>S.pvp},
   buffs:{rebirthBuffNeed:ch=>typeof S.buffNeed==='function'?S.buffNeed(ch):S.buffNeed},warlock:{rebirthPrepare:async()=>{events.push('pet');return false}},rebirth:{step:async()=>events.push('paid-run-step')}}};
 vm.runInNewContext('let rebirthPaymentRead={key:"",at:0};\n'+helpers+'\n'+loop,c);
 return{c,S,ch,marker,events,reads,writes,location,now:()=>now,tick:ms=>now+=ms};
}
const ownJob=f=>({set:null,fa:[],step:'restore',back:'/rebirth-raids.html',rebirthRecovery:{...f.marker}});
const noWork=f=>{assert.equal(f.events.includes('buff'),false);assert.equal(f.events.includes('pet'),false);assert.equal(f.events.includes('paid-run-step'),false);assert.equal(f.writes.length,0);};

test('свой посмертный маршрут обслуживается раньше missing-run и не создаёт нового входа',async()=>{
 const f=fixture();f.c.rt.tbuff=ownJob(f);await f.c.loopRebirth();assert.deepEqual(f.events.slice(0,2),['commit','buff']);assert.ok(!f.events.includes('paid-run-step'));assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
});

test('полные HP и готовые бесплатные баффы отпускают круг к текущему оплаченному run',async()=>{
 const f=fixture();f.ch.hp=f.ch.maxHp;await f.c.loopRebirth();assert.ok(f.events.includes('paid-run-step'));assert.ok(!f.events.includes('buff'));assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
});

test('низкие HP читаются с сервера и создают свой бесплатный restore перед любым run-step',async()=>{
 const f=fixture();await f.c.loopRebirth();assert.deepEqual(f.reads,['/character']);assert.ok(f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));
 const J=f.writes[0].tbuff;assert.equal(J.step,'restore');assert.equal(J.back,'/rebirth-raids.html');assert.deepEqual(J.fa,[]);assert.equal(E.rebirthBuffJob(f.c.cfg,f.c.rt,J),true);assert.equal(J.rebirthRecovery.actor,'own-actor');assert.equal(J.rebirthRecovery.revision,100);
});

test('прежний чужой tbuff не запускается и не присваивается подготовкой героя',async()=>{
 const f=fixture();f.c.rt.tbuff={set:'mage',step:'town',back:'/map.html'};assert.equal(await f.c.rebirthPrepareHero(f.ch),true);noWork(f);assert.equal(f.c.rt.tbuff.set,'mage');
});

test('свежий snapshot из допуска боя важнее старой полной шапки и передаётся до кота',async()=>{
 const f=fixture({hp:{cur:2292,max:2292}});assert.equal(await f.c.rebirthPreparePet({character:f.ch}),true);assert.equal(f.reads.length,0);assert.ok(f.events.includes('buff'));assert.ok(!f.events.includes('pet'));assert.equal(f.writes[0].tbuff.rebirthRecovery.actor,f.ch.id);
});

test('снят бесплатный бафф при полных HP — отдельная подготовка героя до кота',async()=>{
 const f=fixture({buffNeed:{set:'basic',fa:[]}});f.ch.hp=f.ch.maxHp;await f.c.rebirthPreparePet({character:f.ch});assert.ok(f.events.includes('buff'));assert.ok(!f.events.includes('pet'));assert.equal(f.writes[0].tbuff.step,'restore');
});

test('после подтверждённого восстановления очередной круг доходит до оплаченного похода',async()=>{
 const f=fixture({restore:true});f.c.rt.tbuff=ownJob(f);await f.c.loopRebirth();assert.equal(f.c.rt.tbuff,null);await f.c.loopRebirth();assert.deepEqual(f.events.filter(x=>['buff','paid-run-step'].includes(x)),['buff','paid-run-step']);assert.equal(f.writes.length,0);
});

test('неудавшееся восстановление ждёт3мин и не начинает Fight или новые оплаты',async()=>{
 const f=fixture();f.c.rt.restoreRes={t:f.now(),ok:false};await f.c.loopRebirth();noWork(f);assert.equal(f.reads.length,0);
 f.tick(179999);await f.c.loopRebirth();noWork(f);f.tick(1);await f.c.loopRebirth();assert.ok(f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));
});

for(const change of ['otherHero','otherActorEmpty','class','slot','level','inBattle','revision','missingMax','zeroHp','overMax'])test('повреждённый или чужой свежий герой не допускается: '+change,async()=>{
 const f=fixture();if(change==='otherHero')f.ch.name='Other';if(change==='otherActorEmpty')f.ch.id='';if(change==='class')f.ch.l2Profession='human_warlord';if(change==='slot')f.ch.classSlots.activeSlot=1;if(change==='level')f.ch.level=39;
 if(change==='inBattle')f.ch.inBattle=true;if(change==='revision')f.ch.revision=-1;if(change==='missingMax')delete f.ch.maxHp;if(change==='zeroHp')f.ch.hp=0;if(change==='overMax')f.ch.hp=f.ch.maxHp+1;
 assert.equal(await f.c.rebirthPrepareHero(f.ch),true);noWork(f);
});

for(const change of ['http','throw','save'])test('ошибка '+change+' не приводит к town-action или готовности боя',async()=>{
 const f=fixture();if(change==='http')f.S.readOk=false;if(change==='throw')f.S.throwRead=true;if(change==='save')f.S.saveOk=false;
 assert.equal(await f.c.rebirthPrepareHero(),true);assert.ok(!f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));if(change!=='save')assert.equal(f.writes.length,0);
});

for(const point of ['read','json','save'])for(const change of ['stop','owner','class','slot','mode','generation','page','kick','captcha','pending'])test(`await ${point}: отмена ${change} не применяет восстановление`,async()=>{
 const f=fixture();f.S.hooks[point]=()=>{if(change==='stop')f.c.on=false;if(change==='owner')f.c.tabOwner=false;if(change==='class')f.c.rt.classCur.prof='human_warlord';if(change==='slot')f.c.rt.classCur.slot=1;if(change==='mode')f.S.mode=false;
  if(change==='generation')f.S.generation++;if(change==='page')f.location.href='/menu.html';if(change==='kick')f.c.rt.manualKickAt++;if(change==='captcha')f.S.captcha=true;if(change==='pending')f.S.pending=true;};
 await f.c.rebirthPrepareHero();assert.ok(!f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));if(point!=='save')assert.equal(f.writes.length,0);
});

for(const state of ['off','battle','stop','owner'])test('неподходящий режим подготовки ничего не делает: '+state,async()=>{
 const f=fixture();if(state==='off')f.S.mode=false;if(state==='battle')f.S.battle=true;if(state==='stop')f.c.on=false;if(state==='owner')f.c.tabOwner=false;
 assert.equal(await f.c.rebirthPrepareHero(f.ch),false);noWork(f);assert.equal(f.reads.length,0);
});

test('маркер смерти создаётся лишь для текущего собственного подтверждённого Rebirth боя',()=>{
 const f=fixture();f.location.href='/battle.html?spawnId='+SPAWN;f.c.rt.rebirth={actor:'own-actor',runId:RUN,battleSpawn:SPAWN,prof:'human_wizard',slot:0,observedRun:{char:'Hero',kick:5}};
 const R=f.c.rebirthDeathRecovery();assert.equal(R.kind,'death');assert.equal(R.spawn,SPAWN);assert.equal(R.runId,RUN);assert.equal(E.rebirthBuffJob(f.c.cfg,f.c.rt,{back:'/rebirth-raids.html',rebirthRecovery:R}),true);
 for(const change of ['spawn','char','class','slot','kick','actor']){const g=fixture();g.location.href='/battle.html?spawnId='+SPAWN;g.c.rt.rebirth=structuredClone(f.c.rt.rebirth);
  if(change==='spawn')g.c.rt.rebirth.battleSpawn+='1';if(change==='char')g.c.rt.rebirth.observedRun.char='Other';if(change==='class')g.c.rt.rebirth.prof='other';if(change==='slot')g.c.rt.rebirth.slot=1;if(change==='kick')g.c.rt.rebirth.observedRun.kick=4;if(change==='actor')g.c.rt.rebirth.actor='';assert.equal(g.c.rebirthDeathRecovery(),null,change);}
});

test('проверка после победы замечает героя даже когда кот не разрешён',()=>{
 const f=fixture();f.c.cfg.petAuto=false;assert.equal(f.c.rebirthNeedsPet(),true,'низкие HP требуют каталога');f.ch.hp=f.ch.maxHp;assert.equal(f.c.rebirthNeedsPet(),false);
});

// 20.73: отсутствие HUD/разбора — неизвестность, а готовность подтверждает свежий собственный snapshot.
test('неизвестная шапка запускает свежую сверку; полный собственный snapshot отпускает поход без буфа',async()=>{
 const seen=[],f=fixture({buffNeed:ch=>{seen.push(ch);return ch?null:{unknown:true};}});f.ch.hp=f.ch.maxHp;
 await f.c.loopRebirth();assert.deepEqual(f.reads,['/character']);assert.equal(seen[0],undefined);assert.ok(seen.some(ch=>ch?.id==='own-actor'));
 assert.ok(f.events.includes('paid-run-step'));assert.ok(!f.events.includes('buff'));assert.equal(f.writes.length,0);
});
for(const full of [true,false])test('свежие неподтверждённые баффы удерживают бой без задания и расходов, полныеHP='+full,async()=>{
 const f=fixture({buffNeed:{unknown:true}});if(full)f.ch.hp=f.ch.maxHp;
 await f.c.loopRebirth();assert.deepEqual(f.reads,['/character']);noWork(f);
 assert.ok(f.events.some(x=>x.includes('баффы героя ещё не подтверждены')));assert.equal(f.c.rt.tbuff,undefined);
});
test('чужой серверный герой не передаётся определителю баффов и не становится готовностью',async()=>{
 const seen=[],f=fixture({buffNeed:ch=>{seen.push(ch);return ch?null:{unknown:true};}});f.ch.name='Other';f.ch.hp=f.ch.maxHp;
 await f.c.loopRebirth();assert.deepEqual(f.reads,['/character']);assert.ok(seen.length>0);assert.ok(seen.every(ch=>ch===undefined),'сначала проверена принадлежность snapshot');noWork(f);
});
test('неизвестность в уже переданном свежем snapshot удерживает подготовку кота без повторного GET',async()=>{
 const seen=[],f=fixture({buffNeed:ch=>{seen.push(ch);return{unknown:true};}});f.ch.hp=f.ch.maxHp;
 assert.equal(await f.c.rebirthPreparePet({character:f.ch}),true);assert.equal(f.reads.length,0);assert.equal(seen.at(-1),f.ch);noWork(f);
});

// 20.73: setRt меняет локальную память до ACK фона; неподтверждённый маршрут не разрешает действие следующего круга.
test('неудачная запись с локальной мутацией откатывает только свой новый restore',async()=>{
 const f=fixture({saveOk:false,localBeforeAck:true});await f.c.rebirthPrepareHero(f.ch);
 assert.equal(f.writes.length,2);assert.ok(f.writes[0].tbuff?.rebirthRecovery);assert.equal(f.writes[1].tbuff,null);assert.equal(f.c.rt.tbuff,null);
 assert.ok(!f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));assert.ok(!f.events.includes('pet'));
});
test('локальный restore без ACK после отмены ждёт commit; следующий круг не выполняет его до успешной записи',async()=>{
 const f=fixture({saveOk:false,localBeforeAck:true});f.S.hooks.save=()=>{f.S.mode=false;};
 await f.c.rebirthPrepareHero(f.ch);assert.ok(f.c.rt.tbuff?.rebirthRecovery);assert.equal(f.writes.length,1);assert.ok(!f.events.includes('buff'));
 f.S.mode=true;f.S.hooks={};await f.c.loopRebirth();assert.ok(f.events.includes('commit'));assert.ok(!f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));
 f.S.saveOk=true;await f.c.loopRebirth();assert.equal(f.events.filter(x=>x==='buff').length,1);assert.ok(!f.events.includes('paid-run-step'));
});
test('после неудачной записи замещённый более новым заданием маршрут не стирается откатом',async()=>{
 const f=fixture({saveOk:false,localBeforeAck:true}),replacement=ownJob(f);replacement.rebirthRecovery.actor='new-actor';
 f.S.hooks.save=()=>{f.c.rt.tbuff=replacement;};await f.c.rebirthPrepareHero(f.ch);
 assert.equal(f.c.rt.tbuff,replacement);assert.equal(f.writes.length,1,'откат не записалnull поверх нового задания');assert.ok(!f.events.includes('buff'));assert.ok(!f.events.includes('paid-run-step'));
});
for(const change of ['stop','owner','mode','class','kick'])test('подтверждение существующего restore отменено до действия: '+change,async()=>{
 const f=fixture();f.c.rt.tbuff=ownJob(f);f.S.hooks.commit=()=>{if(change==='stop')f.c.on=false;if(change==='owner')f.c.tabOwner=false;if(change==='mode')f.S.mode=false;if(change==='class')f.c.rt.classCur.prof='human_warlord';if(change==='kick')f.c.rt.manualKickAt++;};
 await f.c.loopRebirth();assert.ok(f.events.includes('commit'));noWork(f);assert.equal(f.reads.length,0);
});
test('чужой маршрут, заменивший свой во время commit, не исполняется подготовкой Rebirth',async()=>{
 const f=fixture();f.c.rt.tbuff=ownJob(f);const replacement={step:'town',set:'mage',back:'/map.html'};f.S.hooks.commit=()=>{f.c.rt.tbuff=replacement;};
 await f.c.loopRebirth();assert.equal(f.c.rt.tbuff,replacement);assert.ok(f.events.includes('commit'));noWork(f);assert.equal(f.reads.length,0);
});
