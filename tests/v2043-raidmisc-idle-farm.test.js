'use strict';
// 20.43 (разбор 21.10): «Тур РБ» + «На месте» — в простое тура бот бьёт мобов там, где стоит (без перелётов).
// Раньше idleFarmAllowed смотрел только на выбранную задачу (тур), а map() уходил в tasksIdle: бот стоял со статусом
// «жду новые РБ… фарм мобов сейчас не выбран», хотя «На месте» было в списке задач. Автофарм и катакомбы по-прежнему ждут.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const content=read('content.js'),raid=read('modules/raid.js');
function fixture(autoTasks,{mobs=true,daily=true}={}){
  const box={console,Date,Intl,Math,JSON,Proxy,Reflect,WeakMap,Map,Set,Object,Array,Number,String};vm.runInNewContext(read('engine-core.js'),box);
  const E=box.L2EngineCore,raw=autoTasks?{autoTasks}:{rbHuntMode:true},rt={char:'Hero'};
  const calls={mobfarm:0,tasksIdle:0,statuses:[],nav:0};
  Object.assign(box,{rt,cfg:autoTasks?E.taskConfig(raw,()=>rt):raw,campOn:()=>false,lootGoal:()=>null,tasksIdle:async()=>{calls.tasksIdle++},dailyWorkReady:async()=>daily,
    L2V7Modules:{mobfarm:{map:async()=>{calls.mobfarm++}}}});
  // ядро: обёртка map() и разрешение фарма в простое тура — как в content.js
  vm.runInNewContext(content.slice(content.indexOf('const raidIdleFarm ='),content.indexOf('// ---------- бой ----------')),box);
  const getter=content.match(/get idleFarmAllowed\(\)\{return (\(\)=>[\s\S]*?)\}, get IL\(\)/)[1];
  box.idleFarmAllowed=vm.runInNewContext(getter,box);
  const env={cfg:box.cfg,idleFarmAllowed:box.idleFarmAllowed,map:(...a)=>box.map(...a),isMap:()=>true,setStatus:t=>calls.statuses.push(t),sleep:async()=>{},
    $q:sel=>mobs&&/l2-map-mob-link/.test(sel)?{}:null};
  const rbox={env,location:{set href(v){calls.nav++}}};
  vm.runInNewContext(raid.slice(raid.indexOf('const rbIdleFarmAllowed ='),raid.indexOf('const RB_IDLE_MS ='))+';globalThis.rbIdleFarmAllowed=rbIdleFarmAllowed;',rbox);
  return{E,box,env,calls,idle:text=>rbox.rbIdleMap(text,()=>true),allowed:()=>rbox.rbIdleFarmAllowed()};
}
test('тур РБ + «На месте»: в простое тура фарм на месте, без автофарма и катакомб (перелётов нет)',async()=>{
  const f=fixture(['raid','farm']);
  assert.equal(f.E.selectedTask(f.box.cfg,f.box.rt),'raid','тур остаётся выбранной задачей');
  assert.equal(f.allowed(),true);
  await f.idle('Тур РБ: подходящих РБ нет — жду новые РБ, фарм на месте при наличии мобов');
  assert.equal(f.calls.mobfarm,1,'карта мобов вызвана');assert.equal(f.calls.tasksIdle,0);assert.equal(f.calls.nav,0);
  // платные перелёты выключены: при выбранном туре автофарм/катакомбы не включаются через список
  assert.equal(f.box.cfg.zoneAuto,false);assert.equal(f.box.cfg.catMode,false);
  for(const list of [['raid','farm','cat'],['raid','farm','auto']]){const g=fixture(list);assert.equal(g.allowed(),true);assert.equal(g.box.cfg.zoneAuto,false,list.join('+'));assert.equal(g.box.cfg.catMode,false,list.join('+'));await g.idle('Тур РБ: жду');assert.equal(g.calls.mobfarm,1,list.join('+'));}
});
test('тур РБ без «На месте» (только тур, + катакомбы, + автофарм) по-прежнему стоит со статусом тура',async()=>{
  for(const list of [['raid'],['raid','cat'],['raid','auto']]){
    const f=fixture(list);assert.equal(f.allowed(),false,list.join('+'));
    await f.idle('Тур РБ: подходящих РБ нет — жду новые РБ, фарм мобов сейчас не выбран');
    assert.equal(f.calls.mobfarm,0,list.join('+'));assert.equal(f.calls.nav,0);assert.match(f.calls.statuses.at(-1),/^Тур РБ/);
    // обёртка map() тоже не бьёт мобов, если фарм не выбран
    await f.box.map();assert.equal(f.calls.mobfarm,0);assert.equal(f.calls.tasksIdle,1,list.join('+'));
  }
});
test('фарм на месте в простое тура уважает дневной лимит мобов и отсутствие обычных мобов на карте',async()=>{
  const day=fixture(['raid','farm'],{daily:false});await day.idle('Тур РБ: жду');assert.equal(day.calls.mobfarm,0,'дневной лимит мобов исчерпан');
  const none=fixture(['raid','farm'],{mobs:false});await none.idle('Тур РБ: жду');
  assert.equal(none.calls.mobfarm,0);assert.equal(none.calls.nav,0);assert.match(none.calls.statuses.at(-1),/обычных мобов здесь нет/);
});
test('старый профиль без списка задач и сам режим «На месте» не изменились',async()=>{
  const legacy=fixture(null);assert.equal(legacy.allowed(),true);await legacy.idle('Тур РБ: жду');assert.equal(legacy.calls.mobfarm,1);
  const farm=fixture(['farm']);assert.equal(farm.E.selectedTask(farm.box.cfg,farm.box.rt),'farm');await farm.box.map();assert.equal(farm.calls.mobfarm,1);
  // эпики + «На месте» — вне этой правки: map() эпиков по-прежнему не фармит
  const epic=fixture(['epic','farm']);assert.equal(epic.E.selectedTask(epic.box.cfg,epic.box.rt),'epic');await epic.box.map();assert.equal(epic.calls.mobfarm,0);assert.equal(epic.calls.tasksIdle,1);
});
test('исходник: обёртка map() и idleFarmAllowed используют одно правило raidIdleFarm',()=>{
  assert.match(content,/const raidIdleFarm = \(\) => Array\.isArray\(cfg\.autoTasks\) && L2EngineCore\.selectedTask\(cfg,rt\) === 'raid' && L2EngineCore\.taskAllowed\(cfg,'farm'\);/);
  assert.match(content,/!\['farm','auto','quests'\]\.includes\(L2EngineCore\.selectedTask\(cfg,rt\)\) && !raidIdleFarm\(\)/);
  assert.match(content,/get idleFarmAllowed\(\)\{return \(\)=>[^}]*raidIdleFarm\(\)/);
});
