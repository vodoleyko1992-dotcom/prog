'use strict';
// 20.23, журнал19.10 17:26: raid снят из autoTasks, а rbSess.on продолжал блокировать явный поход к Маммону.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),E=require('../engine-core.js');
const content=read('content.js'),popup=read('popup.js'),mammon=read('modules/mammon.js'),background=read('background.js');
const retireBox={};vm.runInNewContext(background.slice(background.indexOf('function retireRaidSessionPatch('),background.indexOf('async function statePatch('))+'\nthis.apply=retireRaidSessionPatch;',retireBox);
const policy=content.slice(content.indexOf('async function loopTaskList()'),content.indexOf('// 15.10: заточка — отдельный режим.',content.indexOf('async function loopTaskList()')));
assert.ok(policy.includes('taskJobAllowed'),'исполняется настоящий шаг политики задач');
function fixture({tasks=['raid','mammon'],extra={},command='up'}={}){
 const now=Date.now(),logs=[],writes=[],clicks=[],menuWrites=[],route={pathname:'/map.html',search:'',href:''};let battle=false,tvt=false,paid=false,persisted,afterMenu=async()=>{};
 const state={cfg:{autoTasks:tasks.slice(),mmOrders:false,mmUpgrade:false,mmSmithAuto:false,mmMailClaim:false,mmGoalItem:920018,mmGoalLvl:1,mmGoalFarm:false},rt:{char:'Hero',manualKickAt:1,mmEq:{belt:[920018,0]},zone:'hunt',mmGoReq:{kind:command,t:now},rbSess:{on:true,start:now-60000,bought:true,until:now+3600000,fa:152,k0:7,sum:{kills:2}},...extra},on:true};
 const save=async p=>{writes.push(structuredClone(p));const canonical=retireBox.apply(p,state.rt,state.cfg,Date.now()).patch;Object.assign(state.rt,canonical);persisted=structuredClone(state.rt);return {ok:true}};
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
// Настоящие statePatch/menuPatch/createPatchQueue и строка rebase из content:
// pending отмены не содержит снимка rbSess, который мог бы перекрыть новый Start.
function queueFixture(){
 let now=1000000,fail=false,hold=false,release,enteredResolve;const entered=new Promise(r=>enteredResolve=r);
 const disk={on:true,lock:{k:'tab1',epoch:'lease',t:now},cfg:{autoTasks:['mammon']},rt:{char:'Hero',manualKickAt:1,rbSess:{on:true,start:111,bought:true,until:2000000}}};
 const local={rt:structuredClone(disk.rt)},saved=[],rebase=content.match(/if \(ch\.rt && ch\.rt\.newValue\?\._src !== TAB_ID\) rt = [^\n]+;/)?.[0];assert.ok(rebase);
 const reb={DEF_RT:{},TAB_ID:'client',rtWriter:null};Object.defineProperty(reb,'rt',{get:()=>local.rt,set:v=>{local.rt=v}});vm.createContext(reb);
 class Clock extends Date{static now(){return now}}
 const box={Date:Clock,URL,console,MAX_PATCH_KEYS:400,LOCK_TTL:90000,chrome:{runtime:{getURL:p=>'chrome-extension://bot/'+p},storage:{local:{
  get:async keys=>Object.fromEntries([].concat(keys).map(k=>[k,structuredClone(disk[k])])),
  set:async change=>{if(fail)throw Error('storage failure');const before=structuredClone(disk);Object.assign(disk,structuredClone(change));saved.push(structuredClone(change));if(change.rt){reb.ch={rt:{oldValue:before.rt,newValue:structuredClone(change.rt)}};vm.runInContext(rebase,reb)}}
 }}}};
 const serial=background.slice(background.indexOf('let lockQueue ='),background.indexOf('async function lockCommand('));
 const retirement=background.slice(background.indexOf('function retireRaidSessionPatch('),background.indexOf('// Popup writes also go'));
 const seed=background.slice(background.indexOf('function pvpSeedPatch('),background.indexOf('async function menuPatch('));
 const menu=background.slice(background.indexOf('async function menuPatch('),background.indexOf('// Реворк ядра: Stop/пауза'));
 vm.runInNewContext(serial+retirement+seed+menu+'\nthis.patch=statePatch;this.menu=menuPatch;',box);
 const sender={frameId:0,url:'https://l2wap.com/map.html',tab:{id:1}},popupSender={url:'chrome-extension://bot/popup.html'};
 const q=E.createPatchQueue(async p=>{const r=await box.patch({patch:p,src:'client',expectedChar:'Hero',epoch:'lease'},sender);if(hold){hold=false;enteredResolve();await new Promise(r=>release=r)}return r},()=>true,()=>{},()=>now);reb.rtWriter=q;
 return {disk,local,q,saved,entered,set fail(v){fail=v},hold(){hold=true},release(){release()},advance(){now+=3100},
  send(p){local.rt={...local.rt,...p};return q.enqueue(p)},
  menu:async (p,cfgPatch)=>box.menu({rtPatch:p,cfgPatch,expectedChar:'Hero'},popupSender)};
}
test('write_failed → новая атомарная сессия → recover не меняет start/on ни в storage, ни локально',async()=>{
 const f=queueFixture();f.fail=true;assert.equal((await f.send({retireRaidSession:{start:111}})).reason,'write_failed');assert.equal(f.q.peek().rbSess,undefined);
 f.fail=false;await f.menu({rbSess:{on:true,start:222,bought:false},manualKickAt:222},{autoTasks:['mammon','raid']});assert.equal(f.local.rt.rbSess.start,222);assert.equal(f.local.rt.rbSess.on,true);
 f.advance();assert.equal((await f.q.recover()).ok,true);assert.equal(f.disk.rt.rbSess.start,222);assert.equal(f.disk.rt.rbSess.on,true);assert.equal(f.local.rt.rbSess.start,222);assert.equal(f.local.rt.rbSess.on,true);assert.equal(f.disk.rt.retireRaidSession,undefined);assert.equal(f.q.peek().retireRaidSession,undefined);
});
test('повтор отмены той же сессии после возвращения raid не обходит актуальный список задач',async()=>{
 const f=queueFixture();f.fail=true;await f.send({retireRaidSession:{start:111}});f.fail=false;await f.menu({manualKickAt:222},{autoTasks:['mammon','raid']});f.advance();await f.q.recover();assert.equal(f.disk.rt.rbSess.start,111);assert.equal(f.disk.rt.rbSess.on,true);assert.equal(f.local.rt.rbSess.on,true);
});
test('старый intent не снимает другую сессию даже без raid; совпавший intent сохраняет свежие поля',async()=>{
 const f=queueFixture();f.fail=true;await f.send({retireRaidSession:{start:111}});f.fail=false;await f.menu({rbSess:{on:true,start:222,bought:true,until:3000000,fa:99}},{autoTasks:['mammon']});f.advance();await f.q.recover();assert.equal(f.disk.rt.rbSess.start,222);assert.equal(f.disk.rt.rbSess.on,true);
 await f.send({retireRaidSession:{start:222}});assert.equal(f.disk.rt.rbSess.on,false);assert.equal(f.disk.rt.rbSess.until,3000000);assert.equal(f.disk.rt.rbSess.fa,99);assert.equal(f.disk.rt.retireRaidSession,undefined);
});
test('задержанный ACK старой успешной отмены не откатывает новую сессию; intent не хранится',async()=>{
 const f=queueFixture();f.hold();const pending=f.send({retireRaidSession:{start:111}});await f.entered;assert.equal(f.disk.rt.rbSess.on,false);assert.equal(f.local.rt.rbSess.on,false);assert.equal(f.disk.rt._src,'raid-session-policy');assert.equal(f.disk.rt.retireRaidSession,undefined);
 await f.menu({rbSess:{on:true,start:222,bought:false},manualKickAt:222},{autoTasks:['mammon','raid']});assert.equal(f.local.rt.rbSess.start,222);f.release();await pending;assert.equal(f.disk.rt.rbSess.start,222);assert.equal(f.local.rt.rbSess.start,222);assert.equal(f.local.rt.rbSess.on,true);
});
