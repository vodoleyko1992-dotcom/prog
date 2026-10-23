'use strict';
// 23.10: общая пауза выполняется до свежих снимков и намерений служебных действий.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createActionPace}=require('../engine-core.js'),{fixture:cat}=require('./warlock-fixture.cjs'),{make:kit}=require('./kit-harness.cjs');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
function load(name,env,extra={}){const box={console,setTimeout,clearTimeout,...extra};vm.runInNewContext(read('modules/'+name+'.js'),box);return box.L2V7Factories[name](env);}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
for(const change of ['Stop','герой'])test('баф кота: '+change+' во время паузы отменяет fresh GET/оплату',async()=>{
 const f=cat({cfg:{petFullBudget:20000000,petFullMaxPrice:20000000}}),gate=deferred();let valid;
 f.env.actionWait=async v=>{valid=v;await gate.promise;return v();};
 const pending=f.step();assert.equal(f.gets.length,0);assert.equal(f.env.rt.petFull?.pending,undefined);
 if(change==='Stop')f.env.on=false;else if(change==='герой')f.env.rt.char='Other';else f.env.rt.classCur.prof='human_sorcerer';
 assert.equal(valid(),false);gate.resolve();await pending;assert.equal(f.gets.length,0);assert.equal(f.calls.length,0);
});
test('баф кота: snapshot и намерение создаются после паузы, sent→POST остаётся без ожидания',async()=>{
 const f=cat({cfg:{petFullBudget:20000000,petFullMaxPrice:20000000}});let waited=0;
 f.env.actionWait=async valid=>{assert.equal(f.gets.length,0);assert.equal(f.env.rt.petFull?.pending,undefined);f.ch.revision=123;waited++;return valid();};
 await f.step();assert.equal(waited,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.expectedRevision,123);
});
for(const stop of [false,true])test('набор крафтера: после ожидания '+(stop?'отмена смены задачи':'свежий герой'),async()=>{
 const f=kit({mode:'raid'}),gate=deferred();f.env.actionWait=async valid=>{assert.equal(f.S.gets,0);await gate.promise;return valid();};
 const pending=f.K.step();assert.equal(f.S.posts.length,0);f.S.h.revision=123;
 if(stop)f.M.mode='fish';gate.resolve();await pending;
 assert.equal(f.S.posts.length,stop?0:1);if(!stop)assert.equal(f.S.posts[0][1].expectedRevision,123);
});
function craft(){
 const gets=[],posts=[],env={cfg:{craftAuto:true,craftMpKeep:0},rt:{char:'Hero',craftQueue:[{id:'q',code:'x',n:1}]},on:true,tabOwner:true,
 role:()=> 'crafter',isBattle:()=>false,setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rec:()=>{},
 gameGet:async p=>{gets.push(p);return {ok:true,json:async()=>p==='/character'?{character:{name:'Hero',revision:123,mp:100,inventory:{stacks:[{itemId:1,qty:10}]}}}:{canCraftProfession:true,createItemLevel:1,currentMp:100,maxMp:100,recipes:[{code:'x',createItemLevel:1,mpCost:1,maxCraftable:10,output:{itemId:2,quantity:1},ingredients:[{itemId:1,quantity:1,have:10}]}]}}},
 gamePost:async(p,b)=>{posts.push(copy(b));return {ok:true,status:200,json:async()=>({})}}};return {env,gets,posts,C:load('craft',env)};
}
for(const stop of [false,true])test('крафт: пауза до книги, fresh hero и durable intent; '+(stop?'Stop':'успешный POST'),async()=>{
 const f=craft(),gate=deferred();f.env.actionWait=async valid=>{assert.equal(f.gets.length,0);assert.equal(f.env.rt.craftPending,undefined);await gate.promise;return valid();};
 const pending=f.C.step();await Promise.resolve();assert.equal(f.posts.length,0);if(stop)f.env.on=false;gate.resolve();await pending;
 assert.equal(f.posts.length,stop?0:1);if(!stop)assert.equal(f.posts[0].expectedRevision,123);
});
function daily(){
 const posts=[],env={cfg:{clanTasks:true},rt:{char:'Hero',clanTasks:{t:Date.now(),me:{id:'h'},active:[],defs:[{id:'kill_monsters',canTake:true,n:'Охота',reward:{}}]}},on:true,tabOwner:true,isBattle:()=>false,rec:()=>{},setRt:async p=>Object.assign(env.rt,p),
 gamePost:async p=>{posts.push(p);return {ok:true,json:async()=>({})}}};return {env,posts,D:load('dailies',env)};
}
for(const change of ['Stop','план'])test('клан: '+change+' во время паузы — без POST',async()=>{
 const f=daily(),gate=deferred();f.env.actionWait=async valid=>{await gate.promise;return valid();};const pending=f.D.clanStep();
 assert.equal(f.posts.length,0);if(change==='Stop')f.env.on=false;else f.env.rt.clanTasks.defs[0].canTake=false;gate.resolve();await pending;assert.equal(f.posts.length,0);
});
function subclass({cancel=0}={}){
 let now=100000,near=false,conflict=true,waits=0;const posts=[],ch={name:'Hero',revision:100,l2Profession:'human_warlock',level:75,inBattle:false,classSlots:{activeSlot:0,slots:[{slot:1,owned:true,profession:'human_warlock'}]},inventory:{eq:{},stacks:[]}},env={cfg:{},rt:{char:'Hero',subGo:{t:now,slot:1}},on:true,tabOwner:true,isBattle:()=>false,setStatus:()=>{},rec:()=>{},sleep:async()=>{},rtCommit:async()=>true,setRt:async p=>{Object.assign(env.rt,p);return {ok:true}}};
 const res=(status,j)=>({ok:status===200,status,json:async()=>copy(j)}),pace=createActionPace({delay:()=>1000,clock:()=>now,sleep:async ms=>{now+=ms}});pace.note();
 env.actionWait=async valid=>{waits++;if(waits===cancel)env.on=false;return pace.wait(valid);};
 env.gameGet=async p=>p==='/character'?res(200,{character:ch}):p==='/character/subclasses'?res(200,{classes:{nearClassMaster:near}}):p==='/character/catalog-hints'?res(200,{gearCatalog:[]}):res(200,{locations:[{teleportId:'oren',vipFreeApplied:true}]});
 env.gamePost=async(p,b)=>{posts.push({p,at:now,b:copy(b)});pace.note();if(p==='/game/teleport'){near=true;ch.revision++;return res(200,{character:ch});}if(conflict){conflict=false;ch.revision++;return res(409,{serverRevision:ch.revision});}ch.classSlots.activeSlot=1;ch.revision++;return res(200,{});};
 return {env,posts,m:load('subgo',env,{Date:class extends Date{static now(){return now}},location:{href:'/map.html'}})};
}
test('саб: бесплатный TP, смена класса и 409 retry соблюдают общую паузу',async()=>{
 const f=subclass();await f.m.step();assert.equal(f.posts.length,3);assert.deepEqual(f.posts.map(x=>x.at),[101000,102000,103000]);assert.deepEqual(f.posts.map(x=>x.b.expectedRevision),[100,101,102]);
});
test('саб: Stop во время паузы 409 retry отменяет следующий POST',async()=>{
 const f=subclass({cancel:3});await f.m.step();assert.equal(f.posts.length,2);assert.ok(f.env.rt.subGo,'отменённая задача не считается выполненной');
});

function lifestone(){
 const box={console,setTimeout,clearTimeout};vm.runInNewContext(read('augment.js'),box);vm.runInNewContext(read('modules/lifestone.js'),box);
 const server=require('./tools/lifestone-supply-server-fixture.cjs')({ls:3,gem:3,near:true}),gets=[],posts=[],env={cfg:{autoLs:{targets:['prominence'],maxAttempts:3}},rt:{char:'AuditHero'},on:true,tabOwner:true,canRun:()=>env.on,canPrepare:()=>true,context:()=>'context',rec:()=>{},setStatus:()=>{},setRt:async p=>{Object.assign(env.rt,copy(p));return {ok:true}},
 gameGet:async p=>{gets.push(p);const r=p==='/character/catalog-hints'?{status:200,json:{itemGradeHints:{9002284:'S'}}}:server.handle(p,'GET');return {ok:r.status===200,status:r.status,json:async()=>copy(r.json)};},
 gamePost:async(p,b,ms,permit)=>{assert.equal(m.consumePermit(permit,b),true);posts.push(copy(b));const r=server.handle(p,'POST',b);return {ok:r.status===200,status:r.status,json:async()=>copy(r.json)};}};
 const m=box.L2V7Factories.lifestone(env);return {env,gets,posts,m,server};
}
for(const stop of [false,true])test('ЛС: пауза до fresh snapshot и permit; '+(stop?'Stop не создаёт pending':'POST сразу после подготовки'),async()=>{
 const f=lifestone();await f.m.command('prepare');await f.m.command('resume');f.gets.length=0;
 const gate=deferred();f.env.actionWait=async valid=>{assert.equal(f.gets.length,0);assert.equal(f.env.rt.autoLs.pending,null);await gate.promise;return valid();};
 const pending=f.m.step();assert.equal(f.posts.length,0);if(stop)f.env.on=false;gate.resolve();await pending;
 assert.equal(f.posts.length,stop?0:1);if(stop){assert.equal(f.env.rt.autoLs.pending,null);assert.equal(f.gets.length,0);}
});
test('саб: отмена контекста при переодевании не выдаёт незавершённый комплект за выполненную задачу',async()=>{
 const F=JSON.parse(read('tests/fixtures/subgo-2026-10-21.json')),ch=copy(F.ws);ch.name='Hero';ch.classSlots.activeSlot=2;
 const posts=[],env={cfg:{},rt:{char:'Hero',subGo:{t:Date.now(),slot:2}},on:true,tabOwner:true,isBattle:()=>false,canAct:()=>true,setStatus:()=>{},rec:()=>{},sleep:async()=>{},rtCommit:async()=>true,setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},
 gameGet:async p=>({ok:true,status:200,json:async()=>p==='/character'?{character:ch}:F.catalog}),gamePost:async()=>{posts.push(1);throw Error('unexpected POST')}};
 env.actionWait=async valid=>{env.canAct=()=>false;return valid();};await load('subgo',env,{location:{href:'/map.html'}}).step();
 assert.equal(posts.length,0);assert.ok(env.rt.subGo);assert.equal(env.rt.subGoSay,undefined);
});
