'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync((process.env.SEAL_SOURCE_ROOT||__dirname+'/..')+'/'+f,'utf8'),content=read('content.js');
const box={Date,console,document:{querySelectorAll:()=>[]}};vm.runInNewContext(read('engine-core.js'),box);const E=box.L2EngineCore;
for(const tasks of [[],['tvt'],['fish'],['mammon'],['cat']])test('очередь кнопки и галка обмена доступны при списке '+tasks,()=>{
 const raw={autoTasks:tasks,sealAuto:true},rt={sealEx:{t:Date.now(),manual:true}};
 assert.equal(E.taskConfig(raw,()=>rt).sealAuto,true);assert.equal(E.taskJobAllowed(raw,'sealEx',rt),true);
 rt.sealEx={t:Date.now(),auto:true};assert.equal(E.taskJobAllowed(raw,'sealEx',rt),true);
 raw.sealAuto=false;assert.equal(E.taskJobAllowed(raw,'sealEx',rt),false);
 rt.sealEx={t:Date.now()};assert.equal(E.taskJobAllowed(raw,'sealEx',rt),true,'очередь старого меню тоже ручная');
});
test('выбранная заточка сохраняет очередь до окончания серии',()=>assert.equal(E.taskJobAllowed({autoTasks:['enchant'],sealAuto:true},'sealEx',{sealEx:{manual:true,t:1}}),true));
function queue(change={}){
 const rt={char:'Hero'},loc={pathname:'/map.html'},w={rt,location:loc,on:true,tabOwner:true,isBattle:()=>false,isFishing:()=>false,fishState:()=>false,tvtSoon:()=>false,autonomyMode:()=> 'tasks',sealDue:()=> 'автообмен',setRt:async p=>{Object.assign(rt,p);return{ok:true}},rtCommit:async()=>true,...change};
 vm.runInNewContext(content.slice(content.indexOf('function sealAvailable()'),content.indexOf('// Сторож баффов, обслуживание рыбы')),w);return w;
}
test('автообмен получает durable маршрут до навигации',async()=>{const w=queue();assert.equal(await w.sealQueue(),true);assert.equal(w.rt.sealEx.auto,true);assert.ok(w.rt.sealEx.t>0)});
for(const [name,change]of Object.entries({battle:{isBattle:()=>true},fish:{isFishing:()=>true,fishState:()=>true},tvt:{tvtSoon:()=>true},enchant:{autonomyMode:()=> 'enchant'},stop:{on:false},lease:{tabOwner:false},epic:{rt:{epic:{step:'fight'}}},raid:{rt:{rbHunt:{step:'go'}}}}))test(name+' не начинает автообмен',async()=>{const w=queue(change);assert.equal(await w.sealQueue(),false);assert.equal(w.rt.sealEx,undefined)});
test('ошибка сохранения не запускает маршрут',async()=>{const w=queue({rtCommit:async()=>false});assert.equal(await w.sealQueue(),false)});
test('dispatcher содержит обмен и в tasks-only до idle',()=>{
 assert.match(content,/sealAvailable\(\)\?\[\{key:'sealEx',run:sealStep\}/);
 const task=content.slice(content.indexOf('async function loopTaskList()'),content.indexOf('async function loopEnchant()'));
 assert.ok(task.indexOf('await sealQueue()')<task.indexOf('await tasksIdle()'));
 assert.match(task,/actions\.dispatch\(\)/);
});
test('новая ручная очередь переживает отмену старого владельца при том же kick',async()=>{
 const b={};vm.runInNewContext(read('modules/actions.js'),b);const rt={char:'Hero',manualKickAt:100,sealEx:{t:100,manual:true},old:{t:1},actionOwner:{key:'old',stamp:'1',context:'old'}};
 const env={rt,cfg:{autoTasks:[]},on:true,tabOwner:true,mode:()=> 'tasks',lease:()=>1,page:()=>'/map.html',paymentPending:()=>null,interrupted:()=>false,isBattle:()=>false,rec(){},setRt:async p=>{Object.assign(rt,p);return{ok:true}},rtCommit:async()=>true,jobs:()=>[{key:'sealEx',run:async()=>{}},{key:'old',run:async()=>{}}]};
 const A=b.L2V7Factories.actions(env);A.enterFrame();await A.dispatch();assert.ok(rt.sealEx);assert.equal(rt.old,null);assert.equal(rt.actionOwner,null);
});
function dungeon(change){
 const rt={char:'Hero',manualKickAt:1,sealEx:{t:Date.now(),manual:true}},loc={pathname:'/ancient-trader.html',href:''};let clicks=0,net=null;
 const inp={value:'',dispatchEvent(){}},btn={disabled:false};const row={dataset:{stone:'green'},querySelector:s=>s.includes('owned__value')?{textContent:'10'}:s.includes('__input')?inp:s.includes('__btn')?btn:null,getAttribute:()=> '5'};
 const env={on:true,tabOwner:true,leaseEpoch:1,rt,cfg:{},routeLocation:loc,canAct:()=>true,waitX:async fn=>fn(),setRt:async p=>{Object.assign(rt,p);return{ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},sleep:async()=>{},shown:()=>false,sealNet:()=>net,pause:async()=>change?.(env),fire:()=>{clicks++;net={t:Date.now(),ok:true,status:200,stone:'green',qty:+inp.value};return true}};
 const b={Date,Event:class{},document:{querySelectorAll:()=>[row]},chrome:{storage:{local:{set:async()=>{}}}}};vm.runInNewContext(read('modules/dungeons.js'),b);return{env,loc,clicks:()=>clicks,D:b.L2V7Factories.dungeons(env)};
}
for(const [name,change]of Object.entries({Stop:e=>e.on=false,lease:e=>e.leaseEpoch++,hero:e=>e.rt.char='Other',kick:e=>e.rt.manualKickAt++,queue:e=>e.rt.sealEx={t:1}}))test(name+' во время подготовки отменяет клик обмена',async()=>{const w=dungeon(change);await w.D.sealStep();assert.equal(w.clicks(),0);assert.equal(w.loc.href,'')});
test('неизменный контекст обменивает весь стек и завершает очередь',async()=>{const w=dungeon();await w.D.sealStep();assert.equal(w.clicks(),1);assert.equal(w.env.rt.sealEx,null);assert.match(w.env.rt.sealLast.why,/10 зелёных → 50 AA/)});

test('выключение галки во время подготовки автообмена отменяет клик и снимает маршрут',async()=>{
 const w=dungeon(e=>e.cfg.sealAuto=false);w.env.rt.sealEx.auto=true;w.env.cfg.sealAuto=true;await w.D.sealStep();assert.equal(w.clicks(),0);await w.D.sealStep();assert.equal(w.env.rt.sealEx,null);
});
test('отказ durable записи не даёт уйти к торговцу',async()=>{
 const w=dungeon();w.loc.pathname='/map.html';w.env.rtCommit=async()=>false;await w.D.sealStep();assert.equal(w.loc.href,'');assert.ok(w.env.rt.sealEx);
});

test('подготовка очереди в политике не перехватывает выбранную заточку',async()=>{
 // 20.71: отдельный режим подземелий в этом сценарии заточки выключен.
 const w={L2EngineCore:E,cfg:{autoTasks:['enchant']},rt:{},on:true,tabOwner:true,taskPolicyNote(){},sealQueue:async()=>false,loopStale:()=>true,autonomyMode:()=> 'enchant',rebirthModeSelected:()=>false};
 vm.runInNewContext(content.slice(content.indexOf('async function loopTaskList()'),content.indexOf('// 15.10: заточка — отдельный режим.')),w);assert.equal(await w.loopTaskList(),undefined);
});
