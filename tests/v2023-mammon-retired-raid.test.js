'use strict';
// 20.23, журнал19.10 17:26: raid снят из autoTasks, а rbSess.on продолжал блокировать явный поход к Маммону.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),E=require('../engine-core.js');
const content=read('content.js'),popup=read('popup.js'),mammon=read('modules/mammon.js');
const policy=content.slice(content.indexOf('async function loopTaskList()'),content.indexOf('// 15.10: заточка — отдельный режим.',content.indexOf('async function loopTaskList()')));
assert.ok(policy.includes('taskJobAllowed'),'исполняется настоящий шаг политики задач');
function fixture({tasks=['raid','mammon'],extra={},command='up'}={}){
 const now=Date.now(),logs=[],writes=[],clicks=[],menuWrites=[],route={pathname:'/map.html',search:'',href:''};let battle=false,tvt=false,paid=false,persisted,afterMenu=async()=>{};
 const state={cfg:{autoTasks:tasks.slice(),mmOrders:false,mmUpgrade:false,mmSmithAuto:false,mmMailClaim:false,mmGoalItem:920018,mmGoalLvl:1,mmGoalFarm:false},rt:{char:'Hero',manualKickAt:1,mmEq:{belt:[920018,0]},zone:'hunt',mmGoReq:{kind:command,t:now},rbSess:{on:true,start:now-60000,bought:true,until:now+3600000,fa:152,k0:7,sum:{kills:2}},...extra},on:true};
 const save=async p=>{writes.push(structuredClone(p));Object.assign(state.rt,p);persisted=structuredClone(state.rt);return {ok:true}};
 persisted=structuredClone(state.rt);
 const env={get cfg(){return E.taskConfig(state.cfg,()=>state.rt)},get rt(){return state.rt},get on(){return state.on},tabOwner:true,leaseEpoch:1,routeLocation:route,
  autonomyMode:()=>E.selectedTask(state.cfg,state.rt)==='auto'?'farm':E.selectedTask(state.cfg,state.rt),isBattle:()=>battle,isFishing:()=>false,fishState:()=>null,fishNow:()=>false,tvtSoon:()=>tvt,
  payments:{blocked:()=>paid},setRt:save,setStatus:s=>logs.push(s),rec:(...a)=>logs.push(a.join(' ')),sleep:async()=>{},invQty:()=>1000,ITEMS:{},FARM:{res:{}},$q:()=>null,
  fire:el=>{clicks.push(el);return true},gameGet:async()=>{throw Error('живых запросов быть не должно')}
 };
 const box={console,Date,Math,JSON,URLSearchParams,document:{querySelectorAll:()=>[]},location:route,chrome:{runtime:{getURL:f=>f}},fetch:async()=>({ok:true,json:async()=>({})})};
 vm.runInNewContext(mammon,box);const M=box.L2V7Factories.mammon(env);
 const core={L2EngineCore:E,L2V7Modules:{},taskPolicyNote(){},setRt:save,rec:env.rec,autonomyMode:env.autonomyMode,isBattle:env.isBattle,isFishing:env.isFishing,fishState:env.fishState,fishFight:async()=>{},battle:async()=>{},tasksIdle:async()=>{},sleep:env.sleep};
 Object.defineProperties(core,{cfg:{get:()=>env.cfg},rt:{get:()=>state.rt}});vm.runInNewContext(policy+'\nthis.step=loopTaskList;',core);
 const ui={console,Set,Date,Object,Promise,DEF:{},chrome:{storage:{local:{get:async()=>({cfg:structuredClone(state.cfg)})}}},menuPatch:async(p,{cfgPatch}={})=>{menuWrites.push({p:structuredClone(p),cfgPatch:structuredClone(cfgPatch)});Object.assign(state.rt,p);state.cfg={...state.cfg,...cfgPatch};persisted=structuredClone(state.rt);await afterMenu()},load:async()=>{},save:async()=>{},toast(){}};
 vm.runInNewContext(popup.slice(popup.indexOf('const AUTO_TASK_LABELS'),popup.indexOf('const MODE_NAME'))+'\nthis.edit=editAutoTask;',ui);
 const start=popup.indexOf("$('rbSessStart').onclick = "),finish=popup.indexOf('\n};',start);
 ui.setMode=(key,on)=>ui.edit(key==='rb'?'raid':key,on);vm.runInNewContext('this.beginSession='+popup.slice(popup.indexOf('async ',start),finish+2)+';',ui);
 return {state,env,M,route,logs,writes,clicks,menuWrites,policy:core.step,edit:ui.edit,beginSession:ui.beginSession,set afterMenu(fn){afterMenu=fn},set battle(v){battle=v},set tvt(v){tvt=v},set paid(v){paid=v},
  reload(){state.rt=structuredClone(persisted)},async start(){state.on=true;state.rt.deaths=[];state.rt.manualKickAt++;await core.step()}}
}
test('настоящая кнопка снятия raid → политика → команда улучшения у Маммона запускается',async()=>{
 const f=fixture();assert.equal(f.M.modeFree(),false);await f.edit('raid',false);assert.equal(f.state.rt.rbSess.on,true,'меню только меняет список; политику применяет ядро');
 const req=structuredClone(f.state.rt.mmGoReq),before=structuredClone(f.state.rt.rbSess);assert.equal(await f.policy(),true);assert.equal(f.state.rt.rbSess.on,false);assert.ok(f.state.rt.rbSess.end>=before.start);
 for(const key of ['start','bought','until','fa','k0','sum'])assert.deepEqual(f.state.rt.rbSess[key],before[key],key+' сохранён');
 assert.deepEqual(f.state.rt.mmGoReq,req);assert.equal(f.M.modeFree(),true);assert.equal(await f.M.mmStep(),true);assert.equal(f.state.rt.mmJob.kind,'smith');assert.equal(f.state.rt.mmJob.cmd,true);assert.equal(f.state.rt.mmGoReq,null);assert.equal(f.clicks.length,0);
});
test('старый rbSess после снятия raid и reload/Start завершается, команда сохраняется',async()=>{
 const f=fixture({tasks:['mammon']});f.reload();await f.start();assert.equal(f.state.rt.rbSess.on,false);assert.equal(f.state.rt.mmGoReq.kind,'up');f.reload();assert.equal(f.state.rt.rbSess.on,false);await f.policy();assert.equal(await f.M.mmStep(),true);assert.equal(f.state.rt.mmJob.up,true);
});
test('снятие остальных задач оставляет Маммона и не возвращает raid при повторном Start',async()=>{
 const f=fixture({tasks:['raid','auto','mammon']});await f.edit('raid',false);await f.edit('auto',false);await f.policy();await f.start();assert.deepEqual(Array.from(f.state.cfg.autoTasks),['mammon']);assert.equal(f.state.rt.rbSess.on,false);assert.equal(await f.M.mmStep(),true);
});
test('действующая выбранная raid-сессия по-прежнему запрещает отлучку и сохраняет команду',async()=>{
 const f=fixture();const before=structuredClone(f.state.rt.rbSess);await f.policy();assert.deepEqual(f.state.rt.rbSess,before);assert.equal(f.M.modeFree(),false);assert.equal(await f.M.mmStep(),false);assert.equal(f.state.rt.mmGoReq.kind,'up');assert.equal(f.state.rt.mmJob,undefined);
});
test('разрешённый raid сохраняет сессию при временном приоритете другой основной задачи',async()=>{
 const f=fixture({tasks:['epic','raid','mammon']});await f.policy();assert.equal(f.state.rt.rbSess.on,true);assert.equal(f.M.modeFree(),false);assert.equal(f.state.rt.mmGoReq.kind,'up');
});
for(const hold of ['battle','tvt','paid'])test('закрытая raid-сессия не обходит защиту '+hold,async()=>{
 const f=fixture({tasks:['mammon']});f[hold]=true;if(hold==='tvt')f.state.cfg.autoTasks.push('tvt');
 const receipt={id:'paid',kind:'raid-teleport',state:'sent'};f.state.rt.actionPayments={pending:receipt,history:[{id:'old'}]};await f.policy();assert.equal(f.state.rt.rbSess.on,false);assert.deepEqual(f.state.rt.actionPayments,{pending:receipt,history:[{id:'old'}]});
 assert.equal(f.M.modeFree(),false);assert.equal(await f.M.mmStep(),false);assert.equal(f.state.rt.mmGoReq.kind,'up');assert.equal(f.state.rt.mmJob,undefined);assert.equal(f.clicks.length,0);
});
for(const key of ['shop','zoneGo','petBufferTrip','revive'])test('завершение сессии не удаляет принадлежащий другой задаче '+key,async()=>{
 const f=fixture({tasks:['mammon','resources','auto','petbuff']});const job=key==='zoneGo'?{id:'ore',task:'resources',t:Date.now()}:{manual:true,urgent:true,t:Date.now()};f.state.rt[key]=job;await f.policy();assert.equal(f.state.rt.rbSess.on,false);assert.deepEqual(f.state.rt[key],job);assert.equal(f.M.modeFree(),false);
});
test('настоящая кнопка запуска сессии публикует rbSess и разрешение raid атомарно',async()=>{
 const f=fixture({tasks:['mammon']});f.state.rt.rbSess=null;f.afterMenu=async()=>f.policy();await f.beginSession();assert.equal(f.menuWrites.length,1);assert.equal(f.menuWrites[0].p.rbSess.on,true);assert.equal(f.menuWrites[0].cfgPatch.autoTasks.includes('raid'),true);assert.equal(f.state.rt.rbSess.on,true);assert.equal(f.M.modeFree(),false);assert.equal(f.state.rt.mmGoReq.kind,'up');
});
test('legacy режим без autoTasks не получает новую отмену сессии',async()=>{
 const f=fixture();delete f.state.cfg.autoTasks;f.state.cfg.rbHuntMode=true;const before=structuredClone(f.state.rt.rbSess);await f.policy();assert.deepEqual(f.state.rt.rbSess,before);
});
