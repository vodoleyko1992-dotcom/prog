'use strict';
// 27.10: настоящий выбор задачи/быстрый запуск и отображение прогресса нового режима.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),source=read('popup.js'),html=read('popup.html');
const D=require(path.join(root,'defaults.js')),E=require(path.join(root,'engine-core.js'));
function fixture(){
 const state={cfg:{...D.CFG,autoTasks:['tvt','quests','farm','petbuff'],rebirthDifficulty:1,rebirthAutoEnter:false,rebirthKeyReserve:7,rebirthBossChoice:'staff1h'},rt:{rebirth:{pending:{id:'unknown-entry'}}},on:false,starts:0,loads:0,patches:[]};
 const box={console,Date,Object,Set,Promise,Number,Array,String,Math,formChar:'Hero',settingsSerial:0,controlGeneration:0,DEF:D.CFG,L2Defaults:D,L2EngineCore:E,
  chrome:{storage:{local:{get:async()=>({cfg:state.cfg,rt:state.rt})}}},load:async()=>{state.loads++},save:async()=>true,
  menuPatch:async(p,o)=>{state.patches.push({p,o});Object.assign(state.rt,p);Object.assign(state.cfg,o.cfgPatch);},
  $:id=>id==='start'?{onclick:async()=>{state.on=true;state.starts++}}:null,showTab:()=>{},toast:()=>{}};
 vm.createContext(box);
 vm.runInContext(source.slice(source.indexOf('const AUTO_TASK_LABELS ='),source.indexOf('function currentMode('))+
  source.slice(source.indexOf('function currentMode('),source.indexOf('function paintModes('))+
  source.slice(source.indexOf('function rebirthView('),source.indexOf('function renderRebirth('))+
  source.slice(source.indexOf('async function quickStart('),source.indexOf('async function botControl('))+
  '\nthis.select=selectedAutoTasks;this.edit=editAutoTask;this.mode=currentMode;this.view=rebirthView;this.quick=quickStart;',box);
 return {box,state};
}
test('новый режим доступен отдельной задачей, быстрым запуском и настройками подземелья',()=>{
 for(const fragment of ['data-auto-task="rebirth"','data-quick-task="rebirth"','id="tab-rebirth"','id="rebirthMode"','id="rebirthDifficulty"','id="rebirthBossChoice"','id="rebirthAutoEnter"','id="rebirthKeyReserve"','id="rebirthBox"','id="rebirthStart"'])assert.ok(html.includes(fragment),fragment);
 const {box}=fixture();assert.equal(box.mode({autoTasks:['rebirth','farm']}),'rebirth');assert.equal(box.mode({rebirthMode:true}),'rebirth');
});
test('галка Rebirth добавляет задачу без самостоятельного запуска и без изменения настроек входа',async()=>{
 const f=fixture();await f.box.edit('rebirth',true);assert.ok(f.state.cfg.autoTasks.includes('rebirth'));assert.equal(f.state.cfg.rebirthMode,true);
 assert.equal(f.state.on,false);assert.equal(f.state.starts,0);assert.equal(f.state.cfg.rebirthAutoEnter,false);assert.equal(f.state.cfg.rebirthKeyReserve,7);
 await f.box.edit('rebirth',false);assert.ok(!f.state.cfg.autoTasks.includes('rebirth'));assert.equal(f.state.cfg.rebirthMode,false);
});
test('быстрый запуск выбирает Rebirth вместо прочих основных задач, сохраняя TvT и неизвестную попытку входа',async()=>{
 const f=fixture();await f.box.quick('rebirth');assert.deepEqual(Array.from(f.state.cfg.autoTasks),['tvt','petbuff','rebirth']);
 assert.equal(f.state.starts,1);assert.equal(f.state.on,true);assert.equal(f.state.cfg.rebirthAutoEnter,false);assert.equal(f.state.cfg.rebirthDifficulty,1);assert.equal(f.state.cfg.rebirthKeyReserve,7);
 assert.equal(f.state.cfg.rebirthBossChoice,'staff1h','явный выбор РБ не сбрасывается новым Start');
 assert.deepEqual(f.state.rt.rebirth,{pending:{id:'unknown-entry'}});assert.equal(f.state.cfg.campaign,false);assert.equal(f.state.cfg.storyTurnIn,false);
});
test('прогресс собственного текущего захода показывает мобов и причину ожидания из runtime',()=>{
 const f=fixture(),v=f.box.view({char:'Hero',rebirth:{char:'Hero',phase:'wait',runId:'private-run-id',mobKills:20,mobKillTarget:300,reason:'Жду нативную кнопку боя'}},{autoTasks:['rebirth']});
 assert.equal(v.enabled,true);assert.equal(v.waiting,true);assert.equal(v.percent,7);assert.match(v.text,/20 \/ 300 мобов/);assert.match(v.text,/Жду нативную кнопку боя/);
});
test('вложенный run поддерживается, UUID и технические фазы не выводятся в текст меню',()=>{
 const f=fixture(),v=f.box.view({char:'Hero',rebirth:{char:'Hero',run:{id:'private-run-id',phase:'mobs',mobKills:300,mobKillTarget:300}}},{autoTasks:['rebirth']});
 assert.equal(v.percent,100);assert.match(v.progress,/300 \/ 300/);assert.ok(!v.text.includes('private-run-id'));
});
test('выбор РБ ограничен ручным вариантом и подтверждённым одноручным посохом',()=>{
 const select=html.match(/<select id="rebirthBossChoice">([\s\S]*?)<\/select>/);assert.ok(select);
 const choices=[...select[1].matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(choices,['manual','staff1h']);
 assert.ok(!select[1].includes('bossSlot'));assert.ok(!select[1].includes('value="3"'));
});
test('этапы чемпиона и логова показываются по-русски, ручной выбор явно ожидает игрока',()=>{
 const f=fixture();for(const [phase,label] of [['champion','Чемпион'],['rb_active','Рейдовый босс'],['manual','Выбор РБ в игре']]){
  const v=f.box.view({char:'Hero',rebirth:{char:'Hero',phase}},{autoTasks:['rebirth']});assert.ok(v.progress.includes(label));assert.ok(!v.text.includes(phase));assert.equal(v.waiting,phase==='manual');
 }
});
test('реальные фазы runtime показывают ожидание ручного входа, лимита, ключей и серверной сверки',()=>{
 const f=fixture(),cfg={autoTasks:['rebirth'],rebirthAutoEnter:false};
 for(const [phase,label] of [['manual-entry','Ожидание ручного входа'],['quota','Дневной лимит охоты'],['keys','Недостаточно ключей'],['price','Проверка стоимости входа'],['wait','Ожидание подтверждения'],['unknown','Исход действия не подтверждён'],['read','Ожидание ответа сервера'],['rejected','Вход отклонён'],['boss-selected','Сверка выбранного РБ']]){
  const v=f.box.view({char:'Hero',rebirth:{char:'Hero',phase,actor:'actor-id',prof:41,slot:0,runId:null,reason:'Требуется подтверждение игры'}},cfg);
  assert.equal(v.waiting,true,phase);assert.ok(v.progress.includes(label),phase);assert.ok(!v.text.includes(phase),phase);assert.ok(!v.text.includes('actor-id'));
 }
 for(const [phase,label] of [['mobs','Мобы'],['prepare','Подготовка к походу'],['catalog','Каталог подземелий'],['entry','Вход в подземелье'],['resume','Возвращение в поход'],['page','Следующая страница мобов'],['battle','Незавершённый бой'],['boss-choice','Выбор РБ']]){
  const v=f.box.view({char:'Hero',rebirth:{char:'Hero',phase}},{autoTasks:['rebirth']});assert.equal(v.waiting,false,phase);assert.ok(v.progress.includes(label),phase);
 }
});
test('каждая сохранённая попытка входа, боя или выбора РБ ожидает свежего подтверждения, включая ответ сервера',()=>{
 const f=fixture();for(const [field,label] of [['pending','Подтверждение входа'],['fightPending','Подтверждение боя'],['bossPending','Подтверждение выбора РБ']]){
  for(const phase of ['prepared','sent']){
   const rebirth={char:'Hero',phase:'mobs',runId:'private-run-id',mobKills:20,mobKillTarget:300,[field]:{id:'private-receipt-id',char:'Hero',phase,runId:'private-run-id',ack:{ok:true}}};
   const v=f.box.view({char:'Hero',rebirth},{autoTasks:['rebirth']});assert.equal(v.waiting,true,field+':'+phase);assert.ok(v.progress.includes(label));assert.ok(!v.text.includes('private-'));
   rebirth[field]=null;assert.equal(f.box.view({char:'Hero',rebirth},{autoTasks:['rebirth']}).waiting,false);
  }
 }
});
test('внешняя фаза ожидания важнее вложенной фазы похода, неизвестная фаза не выдаётся за активный фарм',()=>{
 const f=fixture(),rebirth={char:'Hero',phase:'quota',run:{id:'private-run-id',phase:'mobs',mobKills:20,mobKillTarget:300}};
 const v=f.box.view({char:'Hero',rebirth},{autoTasks:['rebirth']});assert.equal(v.waiting,true);assert.match(v.progress,/Дневной лимит охоты/);assert.ok(!v.progress.includes('Мобы'));assert.equal(v.percent,7);
 rebirth.phase='future-technical-phase';const unknown=f.box.view({char:'Hero',rebirth},{autoTasks:['rebirth']});assert.equal(unknown.waiting,true);assert.ok(!unknown.text.includes('future-technical-phase'));
});
test('чужой герой и некорректные счётчики не показывают старый прогресс',()=>{
 const f=fixture();for(const R of [{char:'Other',mobKills:100,mobKillTarget:300,reason:'чужое состояние'},null,[],{char:'Hero',mobKills:-1,mobKillTarget:300},{char:'Hero',mobKills:1,mobKillTarget:0}]){
  const v=f.box.view({char:'Hero',rebirth:R},{autoTasks:['rebirth']});assert.equal(v.percent,null);assert.ok(!v.text.includes('чужое состояние'));
 }
});
test('снятая задача отображается выключенной, сохраняя разрешение входа отдельной настройкой',()=>{
 const f=fixture(),v=f.box.view({char:'Hero',rebirth:{char:'Hero',reason:'Поход остановлен'}},{autoTasks:['farm'],rebirthMode:true,rebirthAutoEnter:true});
 assert.equal(v.enabled,false);assert.match(v.text,/Выключено/);assert.equal(f.box.mode({autoTasks:['farm'],rebirthMode:true}),'farm');
});
test('импорт принимает переключатель входа, сложность и резерв с исходными типами',()=>{
 const start=source.indexOf('const CFG_IMPORT_EXTRA ='),end=source.indexOf("$('cfgImport').onclick",start),box={DEF:D.CFG,Object,JSON,Number,Array};
 vm.runInNewContext(source.slice(start,end)+'\nthis.clean=cfgImportClean;',box);
 const out=box.clean({rebirthMode:true,rebirthAutoEnter:true,rebirthDifficulty:2,rebirthKeyReserve:5,rebirthBossChoice:'staff1h'});
 assert.equal(JSON.stringify(out.clean),JSON.stringify({rebirthMode:true,rebirthAutoEnter:true,rebirthDifficulty:2,rebirthKeyReserve:5,rebirthBossChoice:'staff1h'}));assert.equal(out.skipped.length,0);
 const bad=box.clean({rebirthMode:'yes',rebirthAutoEnter:1,rebirthDifficulty:'Easy',rebirthKeyReserve:-1,rebirthBossChoice:3});assert.equal(Object.keys(bad.clean).length,0);assert.equal(bad.skipped.length,5);
});
