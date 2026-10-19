'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const realRead=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const src=realRead('tests/v208-farm-kill-quota.test.js');
function setup(){
 let now=Date.parse('2026-10-17T20:59:00Z');class Clock extends Date{static now(){return now}}
 const b={Date:Clock,URL,URLSearchParams,console,structuredClone,vm,read:p=>p==='content.js'&&process.env.QUOTA_SOURCE?fs.readFileSync(process.env.QUOTA_SOURCE,'utf8'):realRead(p)};
 vm.createContext(b);vm.runInContext(src.slice(src.indexOf('function fixture('),src.indexOf("\nfor(const task")),b);
 const f=b.fixture();// 20.10: дневной лимит мобов общий — до полуночи катакомбы не выбраны (иначе при полном счётчике обе охоты ждут), после полуночи игрок добавляет их.
 f.state.cfg={...f.state.cfg,autoTasks:['auto'],autoKillLimit:0,catKillLimit:0,dailyKillLimit:3};
 f.state.rt.dailyQuota={day:'2026-10-17',cat:2,auto:0,fish:0};f.refresh();
 return {...f,midnight:()=>{now=Date.parse('2026-10-17T21:01:00Z');f.state.lock.t=now;f.state.cfg.autoTasks=['cat','auto'];f.refresh()}};
}
for(const reload of ['victory','live','resume'])test('после полуночи '+reload+' сохраняет владельца auto и весь AoE',async()=>{
 const f=setup();assert.equal(f.c.L2EngineCore.selectedTask(f.c.cfg,f.c.rt),'auto');await f.begin();f.grow(2);f.midnight();
 assert.equal(f.c.L2EngineCore.selectedTask(f.c.cfg,f.c.rt),'cat');
 if(reload==='resume'){f.state.rt.manualKickAt=2;f.refresh()}
 if(reload==='live'){const t=await f.begin();f.grow(1);await f.win(t)}else await f.win();
 assert.equal(f.state.rt.farmQuota.auto.got,reload==='live'?3:2);assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.state.rt.farmQuota.cat,undefined);
 assert.equal(f.state.rt.dailyQuota.auto,reload==='live'?3:2);assert.equal(f.state.rt.dailyQuota.cat,0);
});
test('снятая пользователем задача не возобновляется через старый pending',async()=>{const f=setup();await f.begin();f.grow(2);f.midnight();f.state.cfg.autoTasks=['cat'];f.refresh();assert.equal(await f.win(),false);assert.equal(f.state.rt.farmQuota.auto.got,0)});
test('два противоречивых владельца одного spawn не назначают счётчик наугад',async()=>{const f=setup();await f.begin();f.grow(2);f.midnight();f.state.rt.farmQuota.cat=structuredClone(f.state.rt.farmQuota.auto);f.refresh();assert.equal(await f.begin(),false);assert.equal(await f.win(),true);assert.equal(f.state.rt.farmQuota.auto.got,0);assert.equal(f.state.rt.farmQuota.cat.got,0)});
