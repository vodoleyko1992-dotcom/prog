'use strict';
// 20.10: Start не доверяет прежнему списку РБ; сброс не теряет бой, неизвестный платёж и защитные паузы.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../engine-core.js');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
function fixture(){
 const box={require:x=>x==='node:test'?()=>{}:require(x),__dirname,URL,URLSearchParams,Date,structuredClone,console};
 const s=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(s.slice(0,s.indexOf("for(const task of ['auto','cat'])")),box);const f=box.fixture();
 f.state.cfg={autoTasks:['raid','fish']};
 Object.assign(f.state.rt,{dailyStart:4,rbList:{old:{alive:true,lvl:65}},rbListT:123,rbListVerifiedAt:123,rbListReadStart:'old',rbListStartRequired:'old',rbTourView:{ready:[{id:'old'}]},rbFishWait:{at:Date.now(),until:Date.now()+300000},rbHuntIdle:Date.now()+300000,rbIdleMark:{old:true},rbListVerifyNextAt:Date.now()+100000,
  rbHunt:{step:'fight',id:'current'},rbGo:{id:'current'},actionPayments:{pending:{id:'unsettled',kind:'raid-teleport'}},rbStats:{learned:true},rbTimer:{b:{old:{dead:true}}}});
 return f;
}
function assertReset(r){assert.deepEqual(Object.keys(r.rbList),[]);assert.equal(r.rbListT,0);assert.equal(r.rbListVerifiedAt,0);assert.equal(r.rbListReadStart,null);assert.equal(r.rbListIncomplete,true);assert.equal(r.rbTourView,null);assert.equal(r.rbFishWait,null);assert.equal(r.rbListVerifyNextAt,0);assert.equal(r.rbListStartRequired,`${r.dailyStart||0}:${r.manualKickAt||0}:${r.rbListStartSeq}`);}
test('Start и повторный Start атомарно выбрасывают список, сохраняя текущий бой и платёж',async()=>{
 const f=fixture();for(let i=0;i<2;i++){
  const old=f.state.rt.dailyStart;assert.equal((await f.menu({on:true})).ok,true);const r=f.state.rt;assert.equal(r.dailyStart,old+1);assertReset(r);
  assert.equal(r.rbHunt.id,'current');assert.equal(r.rbHunt.step,'fight');assert.equal(r.rbGo.id,'current');assert.equal(r.actionPayments.pending.id,'unsettled');assert.equal(r.rbStats.learned,true);assert.equal(r.rbTimer.b.old.dead,true);
 }
});
test('включение задачи РБ и новый запуск РБ-сессии требуют полного нового чтения без запуска бота',async()=>{
 const f=fixture();f.state.on=false;f.state.cfg.autoTasks=['fish'];
 assert.equal((await f.menu({cfgPatch:{autoTasks:['fish','raid']},rtPatch:{manualKickAt:10}})).ok,true);assertReset(f.state.rt);assert.equal(f.state.on,false);
 Object.assign(f.state.rt,{rbList:{old:{}},rbListT:12,rbListReadStart:f.state.rt.rbListStartRequired});
 await f.menu({rtPatch:{rbSess:{on:true,start:99},manualKickAt:11}});assertReset(f.state.rt);assert.equal(f.state.rt.rbSess.start,99);assert.equal(f.state.on,false);
});
test('Stop и запуск без выбранного РБ не сбрасывают чужие данные',async()=>{
 const f=fixture();await f.menu({on:false});assert.ok(f.state.rt.rbList.old);f.state.cfg.autoTasks=['fish'];await f.menu({on:true});assert.ok(f.state.rt.rbList.old);
});
test('свежая защитная пауза после отказов сохраняется при сбросе списка',()=>{
 const now=Date.now(),rt={dailyStart:1,manualKickAt:2,rbHuntIdle:now+300000,rbRefuse:{n:2,t:now}};
 const patch=E.raidFreshStartPatch(rt,{autoTasks:['raid']},now);assert.equal(patch.rbHuntIdle,undefined);assert.equal(patch.rbIdleMark,undefined);assert.deepEqual(patch.rbList,{});assert.equal(rt.rbRefuse.n,2);
});
test('поздний старый fish fallback не скрывает обязательное чтение нового запуска',()=>{
 const now=Date.now(),cfg={autoTasks:['raid','fish']},rt={rbHunt:{step:'pick',phase:'wait'},rbFishWait:{at:now-1,until:now+300000},rbListStartRequired:'new',rbListReadStart:'old'};
 assert.equal(E.selectedTask(cfg,rt,now),'raid');rt.rbListReadStart='new';assert.equal(E.selectedTask(cfg,rt,now),'fish');
});
test('горячая клавиша Start использует тот же сброс и сохраняет профиль персонажа',async()=>{
 const f=fixture(),s=f.state;s.on=false;let command;
 const c={Date,L2EngineCore:E,serializeLock:async fn=>fn(),chrome:{commands:{onCommand:{addListener:fn=>command=fn}},storage:{local:{get:async()=>structuredClone(s),set:async p=>Object.assign(s,structuredClone(p))}}}};
 const src=read('background.js');vm.runInNewContext(src.slice(src.indexOf("chrome.commands?.onCommand.addListener"),src.indexOf('// ===== журнал и снимки')),c);
 await command('toggle-bot');assert.equal(s.on,true);assertReset(s.rt);assert.equal(s['rt@Hero'].rbListStartRequired,s.rt.rbListStartRequired);assert.equal(s.rt.actionPayments.pending.id,'unsettled');
});

test('включение РБ и новая сессия получают новый маркер без смены времени или manualKickAt',async()=>{
 const f=fixture();f.state.cfg.autoTasks=['fish'];const kick=f.state.rt.manualKickAt,daily=f.state.rt.dailyStart;
 await f.menu({cfgPatch:{autoTasks:['fish','raid']}});const first=f.state.rt.rbListStartRequired;assertReset(f.state.rt);
 await f.menu({cfgPatch:{autoTasks:['fish']}});await f.menu({cfgPatch:{autoTasks:['fish','raid']}});const second=f.state.rt.rbListStartRequired;assertReset(f.state.rt);assert.notEqual(second,first);
 await f.menu({rtPatch:{rbSess:{on:true,start:123}}});assertReset(f.state.rt);assert.notEqual(f.state.rt.rbListStartRequired,second);
 assert.equal(f.state.rt.manualKickAt,kick);assert.equal(f.state.rt.dailyStart,daily);
});
