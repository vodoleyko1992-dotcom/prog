'use strict';
// 27.10: Rebirth — отдельная выбранная задача; ключи и режим не включаются новым героем или базовым профилем.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),E=require(process.env.L2_ENGINE_SOURCE||path.join(root,'engine-core.js')),D=require(path.join(root,'defaults.js')).CFG;
const profile=JSON.parse(fs.readFileSync(path.join(root,'base-profile.json'),'utf8'));
const selected=(list,rt={},extra={})=>E.taskConfig({...D,chain:true,...extra,autoTasks:list},()=>rt);

test('умолчания: режим и автоматический вход выключены, выбран Easy, резерв ключей нулевой',()=>{
 assert.equal(D.rebirthMode,false);assert.equal(D.rebirthAutoEnter,false);assert.equal(D.rebirthDifficulty,1);assert.equal(D.rebirthKeyReserve,0);assert.equal(D.rebirthBossChoice,'manual');
 assert.ok(!Object.hasOwn(profile.cfg,'rebirthMode'));assert.ok(!profile.cfg.autoTasks?.includes('rebirth'));
 assert.equal(profile.cfg.rebirthAutoEnter,false);assert.equal(profile.cfg.rebirthDifficulty,1);assert.equal(profile.cfg.rebirthKeyReserve,0);assert.equal(profile.cfg.rebirthBossChoice,'manual');
});
test('только явная задача Rebirth включает свой режим и сохраняет обычную цепочку',()=>{
 // 20.71: отдельный поход сохраняет выбранные TvT-настройки, но не допускает переключение на событие.
 const c=selected(['rebirth','tvt']);assert.equal(E.selectedTask(c),'rebirth');assert.equal(c.rebirthMode,true);assert.equal(c.chain,true);assert.equal(c.tvtOn,false);
 for(const flag of ['rbHuntMode','rbMode','epicMode','catMode','fishMode','campaign','zoneAuto','craftMode','enchantMode'])assert.equal(c[flag],false,flag);
});
test('старый флаг Rebirth не обходит явный список других задач',()=>{
 for(const tasks of [[],['fish'],['farm'],['quests'],['cat']]){
  const c=selected(tasks,{}, {rebirthMode:true,rebirthAutoEnter:true});assert.equal(c.rebirthMode,false,tasks.join(','));assert.notEqual(E.selectedTask(c),'rebirth');
  assert.equal(E.rawTaskConfig(c).rebirthMode,true,'сохранённый профиль не перезаписан');
 }
});
test('автоматический вход сам по себе не выбирает режим Rebirth',()=>{
 const c=selected(['farm'],{}, {rebirthAutoEnter:true});assert.equal(E.selectedTask(c),'farm');assert.equal(c.rebirthMode,false);assert.equal(E.chooseMode({}), 'farm');
});
test('отдельный Rebirth сильнее остальных задач, без него прежний порядок сохраняется',()=>{
 // 20.71: John вынес подземелья из общей очереди; смешанный старый autoTasks больше не уводит в тур РБ.
 const order=['rebirth','enchant','craft','epic','raid','quests','fish','cat','auto','farm'];
 for(let bits=0;bits<(1<<order.length);bits++){
  const list=order.filter((_,i)=>bits&(1<<i));assert.equal(E.selectedTask(selected(list)),list[0]||'tasks',list.join(','));
 }
});
test('явный legacy Rebirth не уступает обычному туру или эпикам; без него прежние приоритеты сохранены',()=>{
 // 20.71: отдельный режим сильнее старых активных флагов профиля.
 assert.equal(E.chooseMode({rebirth:true,campaign:true,fish:true,cat:true}),'rebirth');assert.equal(E.chooseMode({raid:true,rebirth:true}),'rebirth');
 assert.equal(E.chooseMode({epic:true,rebirth:true}),'rebirth');assert.equal(E.chooseMode({fish:true,campaign:true}),'fish');assert.equal(E.chooseMode({cat:true,campaign:true}),'campaign');
});
test('Rebirth делит общий дневной лимит мобов, но ожидание лимита не выбирает другую задачу',()=>{
 // 20.71: квоту ожидает собственный модуль подземелий; selectedTask не разрешает рыбалку вместо похода.
 const now=Date.UTC(2026,9,27,3),rt={dailyQuota:{day:E.dailyDay(now),basis:'server',auto:1,cat:2,raid:3,server:4}};
 const c=selected(['rebirth','fish'],rt,{dailyKillLimit:10,dailyFishLimit:100});
 assert.equal(E.dailyCount(rt,'rebirth',now),10);assert.equal(E.dailyBlocked(c,rt,'rebirth',now),true);assert.equal(E.selectedTask(c,rt,now),'rebirth');assert.equal(c.fishMode,false);
 rt.dailyQuota.server=3;assert.equal(E.selectedTask(c,rt,now),'rebirth');
});
test('нулевой дневной лимит сохраняет Rebirth, чужие старые сутки не блокируют новый день',()=>{
 const now=Date.UTC(2026,9,27,3),rt={dailyQuota:{day:'2026-10-25',basis:'server',auto:9000,cat:0,raid:0,server:0}};
 assert.equal(E.selectedTask(selected(['rebirth'],rt,{dailyKillLimit:10}),rt,now),'rebirth');
 rt.dailyQuota.day=E.dailyDay(now);assert.equal(E.selectedTask(selected(['rebirth'],rt,{dailyKillLimit:0}),rt,now),'rebirth');
});
test('старый профиль без списка задач держит отдельный Rebirth при дневном лимите и в новые сутки',()=>{
 // 20.71: удержание квоты не выключает сам режим, иначе main выбирал чужую работу.
 const raw={...D,rebirthMode:true,taskOnly:false,dailyKillLimit:10};delete raw.autoTasks;
 const rt={dailyQuota:{day:E.dailyDay(),basis:'server',auto:1,cat:2,raid:3,server:4}},c=E.taskConfig(raw,()=>rt);
 assert.equal(c.rebirthMode,true);assert.equal(c.taskOnly,false);assert.equal(raw.rebirthMode,true);assert.equal(raw.taskOnly,false);assert.equal(E.dailyBlocked(c,rt,'rebirth'),true);
 rt.dailyQuota.day='2000-01-01';assert.equal(c.rebirthMode,true);assert.equal(c.taskOnly,false);
});
test('дневная пауза legacy Rebirth не запускает рыбалку, исходные разрешения сохраняются',()=>{
 // 20.71: оба лимита остаются числовыми ограничениями модулей; чужой режим не запускается автоматически.
 const raw={...D,rebirthMode:true,fishMode:true,taskOnly:false,dailyKillLimit:10,dailyFishLimit:20};delete raw.autoTasks;
 const rt={dailyQuota:{day:E.dailyDay(),basis:'server',auto:10,fish:0}},c=E.taskConfig(raw,()=>rt);
 assert.equal(c.rebirthMode,true);assert.equal(c.fishMode,false);assert.equal(c.taskOnly,false);assert.equal(raw.fishMode,true);
 rt.dailyQuota.auto=0;rt.dailyQuota.fish=20;assert.equal(c.rebirthMode,true);assert.equal(c.fishMode,false);assert.equal(c.taskOnly,false);
 rt.dailyQuota.auto=10;assert.equal(c.taskOnly,false);assert.equal(c.rebirthMode,true);assert.equal(c.fishMode,false);
});
test('новый герой не наследует Rebirth и разрешение расходовать ключи',()=>{
 const raw={autoTasks:['tvt','rebirth','farm','raid','craft'],rebirthMode:true,rebirthAutoEnter:true,rebirthBossChoice:'staff1h',rebirthDifficulty:3,rebirthKeyReserve:10,shopReserve:123};
 const c=E.newHeroCfg(raw);assert.equal(c.rebirthMode,false);assert.equal(c.rebirthAutoEnter,false);assert.equal(c.rebirthBossChoice,'manual');assert.deepEqual(c.autoTasks,['tvt','farm']);
 assert.equal(c.rebirthDifficulty,3);assert.equal(c.rebirthKeyReserve,10);assert.equal(c.shopReserve,123);assert.equal(raw.rebirthMode,true);
});
test('базовый профиль отбрасывает новый режим наравне с остальными режимами',()=>{
 assert.ok(E.MODE_KEYS.includes('rebirthMode'));const c=E.baseProfileCfg({rebirthMode:true,autoTasks:['rebirth'],chain:true,rebirthDifficulty:2});
 assert.equal(Object.hasOwn(c,'rebirthMode'),false);assert.equal(Object.hasOwn(c,'autoTasks'),false);assert.equal(c.rebirthDifficulty,2);
});
test('старые маршруты других основных режимов не исполняются поверх Rebirth',()=>{
 const c=selected(['rebirth']);for(const key of ['rbGo','rbHunt','fishSvc','fishService'])assert.equal(E.taskJobAllowed(c,key,{}),false,key);
 assert.equal(E.taskJobAllowed(c,'rebirthJob',{}),true);assert.equal(E.taskJobAllowed(selected(['farm']),'rebirthJob',{}),false);
});
test('ручное выключение цепочки сохраняется; Rebirth не включает её фоновым чтением',()=>{
 const c=selected(['rebirth'],{}, {chain:false});assert.equal(c.chain,false);assert.equal(E.rawTaskConfig(c).chain,false);
});
