'use strict';
// 20.41 (замер цикла катакомб: запись итога боя в полную память 1,3 МБ — 0,7–1,3 с на экране победы до «Охотиться дальше»):
// вдали от лимита итог пишется без ожидания, следующий бой начинается после записи и берёт счёт сессии уже с убитыми;
// у лимита — прежнее ожидание, чтобы задача остановилась ровно на нём.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(cfg){
 let counter=100,revision=10;
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture();Object.assign(f.state.cfg,{autoKillLimit:0,catKillLimit:0,dailyKillLimit:1000},cfg);Object.assign(f.state.rt,{kills:50,sessT0:123});f.refresh();
 f.c.gameGet=async()=>({ok:true,json:async()=>({character:{name:'Hero',mobsKilled:counter,revision}})});
 f.server=n=>{counter+=n;revision++;f.c.killSnapNote({name:'Hero',k:counter,rev:revision})};
 // Фон отвечает на итог боя только по команде — видно, кто его ждёт.
 const ipc=f.c.ipc,order=[];let gate=null;
 f.c.ipc=async m=>{const op=m.farmQuota?.op;order.push(op);if(op==='win'&&gate)await gate.p;const r=await ipc(m);order.push(op+'<');return r};
 f.hold=()=>{let open;gate={p:new Promise(r=>open=r)};return()=>{gate=null;open()}};
 f.order=order;f.finish=(t,n=1)=>f.c.finishFarmQuotaRaw(t,false,n);
 return f;
}
const tick=()=>new Promise(r=>setImmediate(r));
test('вдали от лимита: экран победы не ждёт запись итога, потом итог засчитан',async()=>{
 const f=fixture(),t=await f.begin();f.server(2);const open=f.hold();
 assert.equal(await f.finish(t,2),false);assert.equal(f.state.rt.farmQuota.auto.pending.counter,100,'запись ещё идёт');
 open();await f.c.farmQuotaIdle();
 assert.equal(f.state.rt.dailyQuota.auto,2);assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.c.rt.dailyQuota.auto,2);assert.equal(f.c.rt.kills,52);
});
test('следующий бой начинается после записи итога и считает сессию уже с убитыми',async()=>{
 const f=fixture(),t=await f.begin();f.server(3);const open=f.hold();
 assert.equal(await f.finish(t,3),false);f.c.location.search='?spawnId=sdms_test_002';
 const next=f.c.beginFarmQuota('sdms_test_002');await tick();await tick();
 assert.deepEqual([...f.order].slice(-1),['win'],'начало нового боя не обгоняет итог прошлого');
 open();const t2=await next;assert.ok(t2&&!t2.approx);
 assert.deepEqual([...f.order].slice(-3),['win<','begin','begin<']);
 assert.equal(f.state.rt.farmQuota.auto.pending.spawn,'sdms_test_002');assert.equal(f.state.rt.farmQuota.auto.pending.sessionKills,53);
 f.server(1);assert.equal(await f.finish(t2,1),false);await f.c.farmQuotaIdle();assert.equal(f.state.rt.kills,54);assert.equal(f.state.rt.dailyQuota.auto,4);
});
test('у лимита задачи: итог ждём, задача снимается ровно на лимите',async()=>{
 const f=fixture({autoKillLimit:3,dailyKillLimit:0}),t=await f.begin();f.server(3);let opened=false;const open=f.hold();
 const p=f.finish(t,3).then(r=>{assert.ok(opened,'ответ только после записи');return r});await tick();await tick();
 opened=true;open();assert.equal(await p,true);assert.equal(f.state.rt.farmQuota.auto.done,true);assert.equal(f.state.rt.farmQuota.auto.got,3);
});
test('у дневного лимита: итог ждём',async()=>{
 const f=fixture({dailyKillLimit:30}),t=await f.begin();f.server(1);let opened=false;const open=f.hold();
 const p=f.finish(t,1).then(r=>{assert.ok(opened);return r});await tick();await tick();opened=true;open();await p;assert.equal(f.state.rt.dailyQuota.auto,1);
});
test('фон отказал в итоге без ожидания: засчёт по журналу боя, бой закрыт',async()=>{
 const f=fixture(),t=await f.begin();f.server(2);const ipc=f.c.ipc;f.c.ipc=async m=>m.farmQuota?.op==='win'?{ok:false,reason:'disk'}:ipc(m);
 assert.equal(await f.finish(t,2),false);await f.c.farmQuotaIdle();
 assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.state.rt.dailyQuota.auto,2);assert.equal(f.state.rt.farmQuota.auto.approx,2);
});
test('Stop во время записи: вкладка не применяет поздний ответ',async()=>{
 const f=fixture(),t=await f.begin();f.server(2);const open=f.hold();
 assert.equal(await f.finish(t,2),false);f.c.on=false;open();await f.c.farmQuotaIdle();
 assert.equal(f.c.rt.dailyQuota?.auto||0,0);assert.equal(f.state.rt.dailyQuota.auto,2,'фон итог записал');
});
// 20.41 (ревью): в цепочке той же страницы новый бой может прийти с тем же ключом спавна, пока итог прошлого ещё пишется.
test('тот же ключ спавна во время записи итога: новый бой не теряет своих убитых',async()=>{
 const f=fixture(),t=await f.begin();f.server(2);const open=f.hold();
 assert.equal(await f.finish(t,2),false);
 const next=f.c.beginFarmQuota('sdms_test_001');await tick();await tick();open();const t2=await next;
 assert.ok(t2&&!t2.approx,'не null и не «неточно»');assert.notEqual(t2.beforeRevision,t.beforeRevision);
 f.server(3);assert.equal(await f.finish(t2,3),false);await f.c.farmQuotaIdle();
 assert.equal(f.state.rt.dailyQuota.auto,5);assert.equal(f.state.rt.farmQuota.auto.pending,null);
});
test('убитые нового боя во время записи итога не попадают в его счёт сессии дважды',async()=>{
 const f=fixture(),t=await f.begin();f.server(1);f.c.rt={...f.c.rt,kills:51};const open=f.hold();
 assert.equal(await f.finish(t,1),false);f.c.location.search='?spawnId=sdms_test_002';
 const next=f.c.beginFarmQuota('sdms_test_002');await tick();await tick();
 f.c.rt={...f.c.rt,kills:53};   // AoE нового боя убил двух соседей, пока фон пишет итог прошлого
 open();const t2=await next;assert.equal(f.state.rt.farmQuota.auto.pending.sessionKills,51);
 f.server(3);assert.equal(await f.finish(t2,3),false);await f.c.farmQuotaIdle();assert.equal(f.state.rt.kills,54);
});
test('страница ушла, фон не подтвердил итог: засчёт по журналу боя делает сам фон',async()=>{
 for(const stay of [false,true]){
  const f=fixture(),t=await f.begin();f.server(2);const ipc=f.c.ipc;
  f.c.ipc=async m=>{if(m.farmQuota?.op!=='win')return ipc(m);assert.equal(m.farmQuota.fallback,true);if(!stay)f.c.on=false;return ipc({...m,farmQuota:{...m.farmQuota,revision:1}})};
  assert.equal(await f.finish(t,2),false);await f.c.farmQuotaIdle();
  assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.state.rt.dailyQuota.auto,2,'ровно один раз');assert.equal(f.state.rt.farmQuota.auto.approx,2);
  if(stay)assert.equal(f.c.rt.dailyQuota.auto,2);
 }
});
test('итог у лимита (с ожиданием) не просит фон засчитывать сам',async()=>{
 const f=fixture({autoKillLimit:3,dailyKillLimit:0}),t=await f.begin();f.server(3);const ipc=f.c.ipc;let fb;
 f.c.ipc=async m=>{if(m.farmQuota?.op==='win')fb=m.farmQuota.fallback;return ipc(m)};await f.finish(t,3);assert.equal(fb,undefined);
});
