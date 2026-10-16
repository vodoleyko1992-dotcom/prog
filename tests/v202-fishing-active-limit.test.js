'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const core={};vm.runInNewContext(read('engine-core.js'),core);const E=core.L2EngineCore;
test('последний заброс доводит активную рыбу, потом отдаёт выбранной следующей задаче',()=>{
 const cfg={autoTasks:['fish','farm'],fishMaxCasts:1},rt={fish:{casts:1},fishCastActive:true};
 assert.equal(E.selectedTask(cfg,rt),'fish');
 rt.fishCastActive=false;assert.equal(E.selectedTask(cfg,rt),'farm');
 rt.fishCastActive=true;rt.fishTgt={done:true};assert.equal(E.selectedTask(cfg,rt),'fish');
 rt.fishCastActive=false;assert.equal(E.selectedTask(cfg,rt),'farm');
});
test('activeflag не обходит явный allowlist и приоритет эпика',()=>{
 const rt={fish:{casts:1},fishCastActive:true};
 for(const autoTasks of [[],['tvt'],['farm']]) assert.notEqual(E.selectedTask({autoTasks,fishMaxCasts:1},rt),'fish');
 assert.equal(E.selectedTask({autoTasks:['fish','epic'],fishMaxCasts:1},rt),'epic');
 assert.equal(E.selectedTask({autoTasks:['fish'],fishMaxCasts:1},{fish:{casts:1},fishCastActive:'true'}),'tasks');
});
function fixture({target=false,on=true,tvt=false}={}){
 let writes=[];const ctx={console,Date,document:{querySelectorAll:()=>[]}};vm.runInNewContext(read('modules/fishing.js'),ctx);
 const el={textContent:'Fish',querySelector:()=>null};
 const env={on,tabOwner:true,rt:{fishCastActive:true},cfg:{reactMin:0,reactMax:0},fishBaitStat:{},
  $q:()=>target?el:null,shown:()=>true,antibotState:()=>false,rnd:()=>0,tvtStep:async()=>tvt,
  setRt:async p=>{writes.push(p);Object.assign(env.rt,p)},rec:()=>{}};
 return {env,m:ctx.L2V7Factories.fishing(env),writes};
}
test('завершённая/исчезнувшая рыба снимает persisted active',async()=>{
 const f=fixture();await f.m.fishFight();assert.equal(f.env.rt.fishCastActive,false);assert.ok(f.writes.some(p=>p.fishCastActive===false));
});
test('Stop и TvT interruption не объявляют ещё активную рыбу завершённой',async()=>{
 const stopped=fixture({on:false});await stopped.m.fishFight();assert.equal(stopped.env.rt.fishCastActive,true);
 const arena=fixture({target:true,tvt:true});await arena.m.fishFight();assert.equal(arena.env.rt.fishCastActive,true);
});
test('loaded idle снимает stale active до обслуживания и не начинает новый заброс за лимитом',async()=>{
 // 20.8: ранняя проверка выполненной цели тоже умеет доводить рыбу; проверяем прежний блок загруженной пустой панели.
 const source=read('modules/fishing.js'),start=source.indexOf('  // Загруженная пустая панель',source.indexOf('async function fishing()'));
 const section=source.slice(start,source.indexOf('  await fishTimeTopUp();',start));
 const cfg={autoTasks:['fish'],fishMaxCasts:1},rt={fish:{casts:1},fishCastActive:true};let setup=0;
 const fn=vm.runInNewContext('(async()=>{'+section+'})',{env:{rt,setRt:async p=>Object.assign(rt,p)},fishState:()=>null,fishFight:()=>assert.fail('idle'),still:()=>E.selectedTask(cfg,rt)==='fish',fishSetup:async()=>{setup++;return false}});
 await fn();assert.equal(rt.fishCastActive,false);assert.equal(setup,0);assert.equal(E.selectedTask(cfg,rt),'tasks');
});
