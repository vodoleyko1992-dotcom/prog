'use strict';
// 20.43 (разбор 21.10): подготовка кота перед РБ. Один потерянный клик призыва/баффа (pending без подтверждения свежей ревизией)
// навсегда держал loopGate, а каждый круг (≈0,3 с) уходил свой GET /character. Теперь: чтение не чаще раза в 1,5 с первые 15 с
// и раза в 12 с дальше; через 2 мин — один повтор (только MP); второй провал: бафф пропускается на час, без призыва тур РБ отложен
// на 30 мин (raidBlocked); неполная панель / нет призыва на панели — не дольше 2 мин; ожидание уступает TvT.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./warlock-fixture.cjs');
const wanted='Summon Feline Queen, Warrior Servitor, Final Servitor';
function setup(o={}){
 const f=fixture({cfg:{petFullAuto:false,petAuto:true,petBuffAuto:true,nPetBuffs:wanted,...o.cfg},char:{mp:5000,...o.char},rt:o.rt});
 const e=f.env;let page=o.page||'/map.html',fires=[],nav=[],logs=[],status=[];
 e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>true;e.setCfg=async p=>Object.assign(e.cfg,p);
 e.setStatus=t=>status.push(t);e.rec=(...x)=>logs.push(x.join(' '));
 const row=(id,name)=>({action:'l2_'+id,skillId:id,effectId:id===1331?4699:id,name,mp:10,ready:true,button:{id}});
 const panel={summon:row(1276,'Summon Kai the Cat'),buffs:[row(1331,'Summon Feline Queen'),row(1346,'Warrior Servitor'),row(1349,'Final Servitor')]};
 e.nativePanel=()=>panel;e.nativePanelPath=()=>page;e.nativeReturnPath=()=>page;e.nativePanelOpen=async()=>{};
 e.nativeNavigate=p=>{nav.push(p);page=p};e.nativeFire=b=>{fires.push(b.id);return true};
 const chars=()=>f.gets.filter(p=>p==='/character').length;
 const effect=id=>{f.ch.revision++;f.ch.activeSummon.activeBuffs.push({skillId:id,level:1,expiresAtMs:f.now()+1200000})};
 // Круг главного цикла: ≈0,3 с между вызовами (loopGate спит 300 мс)
 const prep=()=>f.api().raidPrepare();
 const loop=async ms=>{for(let t=0;t<ms;t+=300){f.tick(300);await prep();}};
 const until=async(cond,max)=>{let t=0;while(!cond()&&t<max){f.tick(300);await prep();t+=300;}assert.ok(cond(),'условие не наступило за '+max+' мс');return t;};
 const settle=async()=>{f.tick(12100);return prep();};   // следующее чтение после паузы ожидания
 return {...f,e,panel,fires,nav,logs,status,chars,effect,loop,until,settle,prep,page:()=>page};
}
const cat=()=>({kind:'servitor',key:'kai_the_cat',summonSkillId:1276,summonSkillLevel:10,hp:2898,maxHp:4366,pAtk:2688,accuracy:70,critRate:650,critDmgMul:2.44,activeBuffs:[]});

test('неподтверждённый клик: GET /character не на каждом круге — 1,5 с первые 15 с, затем 12 с',async()=>{
 const f=setup();await f.prep();await f.prep();assert.deepEqual(f.fires,[1331]);
 const g0=f.chars();await f.loop(15000);const fast=f.chars()-g0;
 assert.ok(fast>=8&&fast<=11,'первые 15 с: '+fast+' чтений (было бы 50)');
 const g1=f.chars();await f.loop(100000);const slow=f.chars()-g1;
 assert.ok(slow>=7&&slow<=10,'следующие 100 с: '+slow+' чтений (было бы ≈333)');
 assert.deepEqual(f.fires,[1331],'до 2 мин повтора нет');
 assert.match(f.status.at(-1),/жду подтверждения «Summon Feline Queen».*повторю один раз/);
});

test('2 мин без подтверждения — один повтор, ещё 2 мин — к РБ без этого баффа, остальные ставятся',async()=>{
 const f=setup();await f.prep();await f.prep();assert.deepEqual(f.fires,[1331]);
 const t1=await f.until(()=>f.fires.length===2,140000);
 assert.ok(t1>=120000&&t1<=133000,'повтор через 2 мин: '+t1);assert.deepEqual(f.fires,[1331,1331],'один повтор того же навыка');
 assert.equal(f.e.rt.petRaidPrep.pending.tries,2);
 assert.ok(f.logs.some(l=>/«Summon Feline Queen» не подтвердился за 2 мин — повторю один раз/.test(l)));
 const t2=await f.until(()=>f.fires.length===3,140000);
 assert.ok(t2>=120000&&t2<=133000,'отказ ещё через 2 мин: '+t2);
 assert.deepEqual(f.fires,[1331,1331,1346],'после второго провала — следующий бафф, третьего клика Queen нет');
 assert.ok(f.e.rt.petRaidSkip.buffs[4699]>f.now()+3500000,'Queen пропускается на час');
 assert.ok(f.logs.some(l=>/«Summon Feline Queen» не подтвердился и после повтора — иду к РБ без него/.test(l)));
 f.effect(1346);await f.settle();assert.deepEqual(f.fires,[1331,1331,1346,1349]);
 f.effect(1349);await f.settle();
 assert.equal(f.api().raidReady(),true,'подготовка закончена без Queen');assert.equal(f.e.rt.petRaidPrep,null);assert.equal(f.page(),'/map.html');
 // В пределах часа следующая сверка не ведёт снова на панель ради пропущенного баффа
 f.tick(31000);const n=f.nav.length;assert.equal(await f.prep(),false);assert.equal(f.nav.length,n);assert.equal(f.api().raidReady(),true);
 assert.equal(f.calls.length,0,'платный набор не покупался');
});

test('повтор после reload не превращается в третий клик; подтверждённый повтор ничего не пропускает',async()=>{
 const f=setup();await f.prep();await f.prep();await f.until(()=>f.fires.length===2,140000);
 f.reload();await f.until(()=>f.fires.length===3,140000);
 assert.deepEqual(f.fires,[1331,1331,1346],'после reload счёт повторов из rt: Queen пропущен');
 const g=setup();await g.prep();await g.prep();await g.until(()=>g.fires.length===2,140000);g.effect(4699);await g.settle();
 assert.deepEqual(g.fires,[1331,1331,1346]);assert.equal(g.e.rt.petRaidPrep.retry,null);assert.equal(g.e.rt.petRaidPrep.pending.tries,1);
 assert.equal(g.e.rt.petRaidSkip,undefined);
});

test('новый Старт снимает пропуск баффа — снова пробую',async()=>{
 const f=setup();await f.prep();await f.prep();await f.until(()=>f.fires.length===3,280000);assert.deepEqual(f.fires,[1331,1331,1346]);
 f.effect(1346);await f.settle();f.effect(1349);await f.settle();assert.equal(f.api().raidReady(),true);
 f.e.rt.manualKickAt=999;f.tick(31000);await f.prep();await f.prep();
 assert.deepEqual(f.fires,[1331,1331,1346,1349,1331],'после Старта Queen снова в работе');
});

test('призыв не подтвердился дважды — тур отложен на 30 мин, без GET и родной панели; снимают ручной кот, Старт и срок',async()=>{
 for(const lift of ['manual','start','expiry']){
  const f=setup({char:{activeSummon:null},cfg:{petBuffAuto:false}});
  await f.prep();assert.equal(f.nav[0],'/skill-panel.html');await f.prep();assert.deepEqual(f.fires,[1276]);
  await f.until(()=>f.fires.length===2,140000);assert.deepEqual(f.fires,[1276,1276],'один повтор призыва');
  await f.until(()=>!f.e.rt.petRaidPrep,140000);
  assert.deepEqual(f.fires,[1276,1276],'третьего призыва нет');assert.equal(f.page(),'/map.html','назад со страницы навыков');
  assert.ok(f.e.rt.petRaidSkip.summonUntil>f.now()+1790000);
  assert.match(f.api().raidBlocked(),/призыв кота перед РБ не подтвердился и после повтора — тур отложен до \d\d:\d\d/);
  // 20.43 (ревью): warlock не обещает «остальные задачи продолжаю» — что будет дальше, пишет тур (рыбалка / фарм на месте / ожидание)
  assert.ok(f.logs.some(l=>/без кота тур РБ отложен на 30 мин$/.test(l)));assert.ok(!f.logs.some(l=>/остальные задачи продолжаю/.test(l)));
  assert.equal(f.api().raidHoldUntil(),f.e.rt.petRaidSkip.summonUntil);
  assert.equal(f.api().raidReady(),false,'к РБ без кота не идём');
  const g=f.chars(),n=f.nav.length;for(let i=0;i<20;i++){f.tick(300);assert.equal(await f.prep(),false);}
  assert.equal(f.chars(),g,'во время отсрочки свой GET не идёт');assert.equal(f.nav.length,n);
  if(lift==='manual'){f.tick(1000);f.ch.activeSummon=cat();f.ch.revision++;f.api().noteSnapshot(f.ch);assert.equal(f.api().raidBlocked(),'');assert.equal(await f.prep(),false);assert.equal(f.api().raidReady(),true);}
  if(lift==='start'){f.e.rt.manualKickAt=55;assert.equal(f.api().raidBlocked(),'');await f.prep();assert.equal(f.nav.at(-1),'/skill-panel.html');}
  if(lift==='expiry'){f.tick(1800000);assert.equal(f.api().raidBlocked(),'');await f.prep();assert.equal(f.nav.at(-1),'/skill-panel.html');}
  assert.equal(f.calls.length,0);
 }
});

test('призыв подтверждён после повтора — отсрочки нет',async()=>{
 const f=setup({char:{activeSummon:null},cfg:{petBuffAuto:false}});await f.prep();await f.prep();await f.until(()=>f.fires.length===2,140000);
 f.ch.activeSummon=cat();f.ch.revision++;await f.settle();
 assert.equal(f.api().raidReady(),true);assert.equal(f.e.rt.petRaidSkip,undefined);assert.equal(f.api().raidBlocked(),'');assert.ok(f.e.rt.petBornT>0);
});

test('после призыва появился другой кот — без повтора призыва и без отсрочки, дальше баффы',async()=>{
 const f=setup({char:{activeSummon:null}});await f.prep();await f.prep();assert.deepEqual(f.fires,[1276]);
 f.ch.activeSummon={...cat(),key:'mew_the_cat',summonSkillId:1225};f.ch.revision++;
 await f.until(()=>f.fires.length===2,140000);
 assert.deepEqual(f.fires,[1276,1331]);assert.equal(f.api().raidBlocked(),'');assert.ok(!f.logs.some(l=>/повторю один раз/.test(l)));
});

test('неполная панель держит не дольше 2 мин (чтение раз в 3 с), дальше кот готовится тем, что есть',async()=>{
 const f=setup({page:'/skill-panel.html'});f.panel.incomplete=true;f.panel.buffs=f.panel.buffs.slice(0,1);
 await f.prep();assert.equal(f.fires.length,0);const g0=f.chars();await f.loop(60000);
 assert.ok(f.chars()-g0<=21,'за минуту не больше 21 чтения, было бы 200: '+(f.chars()-g0));assert.equal(f.fires.length,0);
 const t=await f.until(()=>f.fires.length===1,70000);assert.ok(60000+t>=120000,'не раньше 2 мин');assert.deepEqual(f.fires,[1331]);
 f.effect(4699);await f.settle();await f.settle();
 assert.equal(f.api().raidReady(),true);assert.equal(f.logs.filter(l=>/не нашлись все навыки кота/.test(l)).length,1);
});

test('нет призыва на панели и кота нет — через 2 мин отсрочка тура вместо вечного ожидания',async()=>{
 const f=setup({page:'/skill-panel.html',char:{activeSummon:null},cfg:{petBuffAuto:false}});f.panel.summon=null;
 await f.prep();assert.match(f.status.at(-1),/нужен навык призыва кота на панели/);
 const t=await f.until(()=>!f.e.rt.petRaidPrep,130000);assert.ok(t>=119000,'не раньше 2 мин: '+t);
 assert.equal(f.fires.length,0);assert.equal(f.page(),'/map.html');
 assert.ok(f.api().raidBlocked());assert.ok(f.logs.some(l=>/не нашёлся навык призыва кота — без кота тур РБ отложен на 30 мин/.test(l)));
});

test('MP/откат: ждёт без повтора и без GET на каждом круге',async()=>{
 const f=setup({page:'/skill-panel.html',char:{mp:0}});await f.prep();const g0=f.chars();await f.loop(30000);
 assert.equal(f.fires.length,0);assert.ok(f.chars()-g0<=11,'раз в 3 с: '+(f.chars()-g0));
 f.ch.mp=5000;await f.settle();assert.deepEqual(f.fires,[1331]);
});

test('ожидание подтверждения уступает TvT: без GET и без удержания круга',async()=>{
 const f=setup();await f.prep();await f.prep();let tvt=true;f.e.tvtHold=()=>tvt;const g=f.chars();
 for(let i=0;i<10;i++){f.tick(300);assert.equal(await f.prep(),false);}
 assert.equal(f.chars(),g);assert.ok(f.e.rt.petRaidPrep.pending,'неизвестный клик сохраняется до сверки');
 tvt=false;f.tick(1500);assert.equal(await f.prep(),true);assert.equal(f.chars(),g+1);
});

test('ядро: loopGate уступает записи на TvT и самому TvT (idleTvtBreak перечитывает /game/tvt)',()=>{
 const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 // 22.10: отдельный крафт не возобновляет подготовку кота; уступка TvT и прежние проверки сохраняются.
 assert.match(content,/if \(autonomyMode\(\) !== 'craft' && rt\.petRaidPrep && !idleTvtBreak\(\) && await L2V7Modules\.warlock\.raidPrepare\(\)\) \{ await sleep\(300\); return true; \}/);
 assert.match(content,/const idleTvtBreak = \(\) => \{[^\n]*tvtRefresh[^\n]*tvtRegistrationDue[^\n]*tvtSoon/);
});

// Тур РБ: отсрочка призыва — ожидание (фарм на месте), а не выбор → «подготовлю снова» каждый круг
const raidFile=path.join(__dirname,'v1021-raid-buff-order.test.js'),source=fs.readFileSync(raidFile,'utf8'),box={require:require('node:module').createRequire(raidFile),console,Date};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.raidFixture=fixture;',box);
const HOLD='призыв кота перед РБ не подтвердился и после повтора — тур отложен до 05:30 (снимут новый Старт или кот, призванный вручную)';
test('тур РБ ждёт отсрочку призыва кота, затем продолжает выбор',async()=>{
 const f=box.raidFixture({cat:false});let hold=HOLD;
 f.env.warlock.raidBlocked=()=>hold;f.env.warlock.raidHoldUntil=()=>hold?Date.now()+1800000:0;
 for(let i=0;i<3;i++)await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbHunt.step,'pick');assert.equal(f.env.rt.rbHunt.phase,'wait');assert.equal(f.env.rt.rbHunt.next,HOLD+'; фарм на месте при наличии мобов');assert.equal(f.fires.length,0);
 assert.equal(f.buffCalls(),0,'баффер за FA во время отсрочки не зовём');assert.equal(f.env.rt.rbFishWait,undefined,'без выбранной рыбалки ход ей не передаётся');
 hold='';await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'go');
});

// 20.43 (ревью): в режиме задач тур во время отсрочки оставался выбранной задачей и спал 30 мин — рыбалка [raid, fish] не запускалась,
// а журнал обещал «остальные задачи продолжаю». Теперь ход рыбалке передаётся как при пустом туре (rbFishWait до конца отсрочки).
const core={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../engine-core.js'),'utf8'),core);const E=core.L2EngineCore;
test('режим задач [raid, fish]: на время отсрочки призыва выбрана рыбалка; после срока — снова тур (начатый заброс доводится)',async()=>{
 const f=box.raidFixture({cat:false}),until=Date.now()+1800000;f.env.cfg.autoTasks=['tvt','raid','fish'];
 f.env.warlock.raidBlocked=()=>HOLD;f.env.warlock.raidHoldUntil=()=>until;
 assert.equal(E.selectedTask(f.env.cfg,f.env.rt),'raid','до отсрочки — тур');
 for(let i=0;i<3;i++)await f.R.rbHuntStep();
 const W=f.env.rt.rbFishWait;assert.ok(W&&W.pet===true&&W.until===until,'передача рыбалке до конца отсрочки');
 assert.equal(f.env.rt.rbHunt.phase,'wait');assert.equal(f.env.rt.rbHunt.step,'pick');assert.ok(!f.env.rt.rbHunt.id);
 assert.equal(E.selectedTask(f.env.cfg,f.env.rt),'fish','во время отсрочки работает выбранная рыбалка');
 assert.equal(E.taskJobAllowed(E.taskConfig(f.env.cfg,()=>f.env.rt),'rbHunt',f.env.rt),true,'отложенный тур не стирается');
 const said=f.logs.filter(l=>/перехожу к выбранной рыбалке/.test(l));assert.equal(said.length,1,'одна строка журнала на отсрочку: '+said.length);
 assert.ok(!f.logs.some(l=>/остальные задачи продолжаю/.test(l)));assert.equal(f.fires.length,0);assert.equal(f.buffCalls(),0);
 const late=until+1000;assert.equal(E.selectedTask(f.env.cfg,f.env.rt,late),'raid','после срока — снова тур');
 assert.equal(E.selectedTask(f.env.cfg,{...f.env.rt,fishCastActive:true},late),'fish','начатый заброс доводится');
 // Оплата в ожидании сверки — ход рыбалке не передаётся (как при пустом туре)
 const g=box.raidFixture({cat:false});g.env.cfg.autoTasks=['raid','fish'];g.env.rt.actionPayments={pending:{kind:'raid-teleport'}};
 g.env.warlock.raidBlocked=()=>HOLD;g.env.warlock.raidHoldUntil=()=>until;await g.R.rbHuntStep();assert.equal(g.env.rt.rbFishWait,undefined);
});
test('режим задач без рыбалки: журнал честно говорит «жду», выбор задач не меняется',async()=>{
 const f=box.raidFixture({cat:false}),until=Date.now()+1800000;f.env.cfg.autoTasks=['raid','auto'];
 f.env.warlock.raidBlocked=()=>HOLD;f.env.warlock.raidHoldUntil=()=>until;
 for(let i=0;i<3;i++)await f.R.rbHuntStep();
 assert.equal(f.env.rt.rbFishWait,undefined);assert.equal(f.env.rt.rbHunt.next,HOLD+'; жду, фарм мобов сейчас не выбран');
 assert.equal(f.logs.filter(l=>/жду, фарм мобов сейчас не выбран/.test(l)).length,1);assert.equal(E.selectedTask(f.env.cfg,f.env.rt),'raid');
});
test('кот, призванный вручную, снимает отсрочку и при переданной рыбалке (срок передачи истекает сразу)',async()=>{
 const f=setup({char:{activeSummon:null},cfg:{petBuffAuto:false}});
 await f.prep();await f.prep();await f.until(()=>f.fires.length===2,140000);await f.until(()=>!f.e.rt.petRaidPrep,140000);
 const until=f.api().raidHoldUntil();assert.ok(until>f.now());
 f.e.rt.rbFishWait={at:f.now(),until,listT:0,pet:true};
 f.tick(1000);f.ch.revision++;f.api().noteSnapshot(f.ch);assert.equal(f.e.rt.rbFishWait.until,until,'без кота — передача рыбалке продолжается');
 f.e.rt.rbFishWait={at:f.now(),until:f.now()+600000,listT:0};f.ch.activeSummon=cat();f.ch.revision++;f.api().noteSnapshot(f.ch);
 assert.equal(f.e.rt.rbFishWait.until,f.now()+600000,'ожидание пустого тура (без pet) кот не трогает');
 f.e.rt.rbFishWait={at:f.now(),until,listT:0,pet:true};f.tick(1000);f.ch.revision++;f.api().noteSnapshot(f.ch);
 assert.equal(f.api().raidBlocked(),'');assert.ok(f.e.rt.rbFishWait.until<=f.now(),'живой кот — ход снова туру');
});
test('меню задач: отсрочка призыва кота с переданной рыбалкой — «Ждёт кота», пустой тур — прежнее «Ждёт доступного РБ»',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8'),ctx={L2EngineCore:E,selectedAutoTasks:d=>d.autoTasks,AUTO_TASK_LABELS:{raid:'Тур РБ',fish:'Рыбалка'},AUTO_MAIN_TASKS:['raid','fish'],TASK_TABS:{raid:'rb',fish:'fish'},Date};
 vm.runInNewContext(src.slice(src.indexOf('function taskBoardRows('),src.indexOf('// 19.10: дневные мобы')),ctx);
 const now=Date.now(),cfg={autoTasks:['raid','fish']},hunt={step:'pick',phase:'wait',id:null};
 const raid=w=>ctx.taskBoardRows({rbHunt:hunt,rbFishWait:w},cfg,{on:true,heartbeatValid:true},now).find(r=>r.key==='raid');
 assert.equal(raid({at:now,until:now+1800000,listT:0,pet:true}).label,'Ждёт кота: призыв не подтвердился');
 assert.equal(raid({at:now,until:now+300000,listT:0}).label,'Ждёт доступного РБ');
});
