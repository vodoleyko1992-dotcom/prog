'use strict';
// 18.10, журнал 13:34: убийства группы подтверждают журнал и сервер, догон счётчика не удваивает квоту.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(){
 let now=Date.parse('2026-10-18T03:00:00Z'),counter=100,revision=10;
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture();Object.assign(f.state.cfg,{autoKillLimit:0,catKillLimit:0,dailyKillLimit:1000});Object.assign(f.state.rt,{kills:50,sessT0:123});f.refresh();
 f.gets=0;f.c.gameGet=async()=>{f.gets++;return{ok:true,json:async()=>({character:{name:'Hero',mobsKilled:counter,revision}})}};
 f.server=(n,r=revision+1,cache=true)=>{counter=n;revision=r;if(cache)f.c.killSnapNote({name:'Hero',k:n,rev:r})};
 f.done=(ticket,n=1,lost=false)=>f.c.finishFarmQuota(ticket,lost,n);
 f.advance=ms=>{now+=ms;f.state.lock.t=now};
 return f;
}
test('сервер +1, подтверждено4: квота и сессионные убийства +4',async()=>{
 const f=fixture(),t=await f.begin();f.server(101);await f.done(t,4);
 assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.farmQuota.auto.got,4);assert.equal(f.state.rt.farmKillMark.floor,104);assert.equal(f.state.rt.kills,54);assert.equal(f.c.rt.kills,54);
});
test('сервер +4 при коротком журнале1 сохраняет всех4',async()=>{
 const f=fixture(),t=await f.begin();f.server(104);await f.done(t,1);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.kills,54);
});
test('поздний догон: +1/seen3, затем +3/seen1 — всего4',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);t=await f.begin();f.server(104);await f.done(t,1);
 assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.farmKillMark.floor,104);assert.equal(f.state.rt.kills,54);
});
test('сервер считает по1, журнал по3: каждый бой сразу добавляет3',async()=>{
 const f=fixture();for(let n=1;n<=3;n++){const t=await f.begin();f.server(100+n);await f.done(t,3)}
 assert.equal(f.state.rt.dailyQuota.auto,9);assert.equal(f.state.rt.farmKillMark.floor,109);assert.equal(f.state.rt.kills,59);
});
test('новая revision без роста счётчика не держит подтверждённые убийства',async()=>{
 const f=fixture(),t=await f.begin();f.server(100);assert.equal(await f.done(t,3),false);assert.equal(f.state.rt.dailyQuota.auto,3);
});
test('общая отметка auto→cat не считает догон повторно',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);
 f.state.cfg.autoTasks=['cat','auto'];f.state.cfg.catMode=true;f.refresh();t=await f.begin();assert.equal(t.task,'cat');f.server(104);await f.done(t,1);
 assert.equal(f.state.rt.dailyQuota.auto,3);assert.equal(f.state.rt.dailyQuota.cat,1);assert.equal(f.state.rt.kills,54);
});
test('полночь сохраняет долг, в новые сутки засчитывается только новый моб',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);f.advance(86400000);t=await f.begin();f.server(104);await f.done(t,1);
 assert.equal(f.state.rt.dailyQuota.day,'2026-10-19');assert.equal(f.state.rt.dailyQuota.auto,1);assert.equal(f.state.rt.farmQuota.auto.got,4);
});
for(const reset of ['series','day'])test('сброс '+reset+' не забывает уже засчитанный догон',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);
 await f.menu({rtPatch:{manualKickAt:2},...(reset==='series'?{resetFarmQuota:'auto'}:{resetDailyQuota:'mobs'})});f.refresh();t=await f.begin();f.server(104);await f.done(t,1);
 assert.equal(f.state.rt.farmKillMark.floor,104);assert.equal(reset==='series'?f.state.rt.farmQuota.auto.got:f.state.rt.dailyQuota.auto,1);
});
test('явный сброс серверного счётчика начинает новую шкалу, квота сохраняется',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);f.server(10,30);t=await f.begin();f.server(11);await f.done(t,1);
 assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.farmKillMark.floor,11);
});
test('сброс сервера в бою сохраняет observed и резерв нового догоняющего роста',async()=>{
 const f=fixture();let t=await f.begin();f.server(1);await f.done(t,3);assert.equal(f.state.rt.farmKillMark.floor,3);t=await f.begin();f.server(4);await f.done(t,1);assert.equal(f.state.rt.dailyQuota.auto,4);
});
test('внешний рост до следующего боя не расходует квоту',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);f.server(120);t=await f.begin();f.server(121);await f.done(t,1);assert.equal(f.state.rt.dailyQuota.auto,4);
});
test('поражение учитывает только убитых соседей, нулевое поражение не держит восстановление',async()=>{
 for(const n of [0,2]){const f=fixture(),t=await f.begin();f.server(100);assert.equal(await f.done(t,n,true),false);assert.equal(f.state.rt.dailyQuota.auto,n);assert.equal(f.state.rt.kills,50+n)}
});
test('reload посреди боя сохраняет исходные floor и сессионную baseline',async()=>{
 const f=fixture();await f.begin();f.server(101);f.state.rt.kills=51;f.refresh();const t=await f.begin();f.server(102);await f.done(t,4);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.kills,54);
});
test('повторный итог того же боя не добавляет убийств',async()=>{
 const f=fixture(),t=await f.begin();f.server(101);await f.done(t,4);await f.done(t,4);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.kills,54);
});
test('approxclose резервирует уже учтённые убийства перед точным следующим боем',async()=>{
 const f=fixture(),t=await f.begin();await f.c.farmQuotaApprox(t,3,true);assert.equal(f.state.rt.farmKillMark.floor,103);f.server(101);const t2=await f.begin();f.server(104);await f.done(t2,1);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.state.rt.kills,54);
});
test('отказ записи begin даёт приблизительный билет с исходной baseline',async()=>{
 const f=fixture(),ipc=f.c.ipc;let first=true;f.c.ipc=m=>first?(first=false,Promise.resolve({ok:false,reason:'disk'})):ipc(m);
 const t=await f.begin();assert.equal(t.approx,true);await f.done(t,3);assert.equal(f.state.rt.dailyQuota.auto,3);assert.equal(f.state.rt.kills,53);assert.equal(f.state.rt.farmKillMark.floor,103);
});
test('неуспешная запись approx не ставит done и допускает повтор',async()=>{
 const f=fixture(),ipc=f.c.ipc;f.c.ipc=async()=>({ok:false,reason:'disk'});const t=await f.begin();assert.equal(t.approx,true);await f.done(t,3);assert.notEqual(t.done,true);f.c.ipc=ipc;await f.done(t,3);assert.equal(t.done,true);assert.equal(f.state.rt.dailyQuota.auto,3);
});
test('потерянный ACK approx повторяется идемпотентно',async()=>{
 const f=fixture(),ipc=f.c.ipc;f.c.gameGet=async()=>({ok:false});const t=await f.begin();let lose=true;f.c.ipc=async m=>{const r=await ipc(m);if(lose){lose=false;throw Error('lost ack')}return r};
 await f.done(t,3);assert.notEqual(t.done,true);await f.done(t,3);assert.equal(f.state.rt.dailyQuota.auto,3);assert.equal(f.state.rt.kills,53);assert.equal(t.done,true);
});
test('сессионный счётчик не откатывает уже засчитанных локально соседей',async()=>{
 const f=fixture(),t=await f.begin();f.state.rt.kills=53;f.c.rt.kills=55;f.server(101);await f.done(t,4);assert.equal(f.state.rt.kills,54);assert.equal(f.c.rt.kills,55);
});
test('сброс сессионной статистики не восстанавливает старые50',async()=>{
 const f=fixture(),t=await f.begin();f.state.rt.kills=0;f.state.rt.sessT0=456;f.refresh();f.server(101);await f.done(t,4);assert.equal(f.state.rt.kills,0);assert.equal(f.state.rt.dailyQuota.auto,4);
});
test('старый pending без session baseline не выдумывает исторические убийства',async()=>{
 const f=fixture(),t=await f.begin();delete f.state.rt.farmQuota.auto.pending.sessionKills;delete f.state.rt.farmQuota.auto.pending.sessionT0;f.refresh();f.server(101);await f.done(t,4);assert.equal(f.state.rt.kills,50);assert.equal(f.state.rt.dailyQuota.auto,4);
});
test('продвинутый cat high-water не засчитывается повторно старому auto pending',async()=>{
 const f=fixture(),a=await f.begin();f.state.cfg.autoTasks=['cat'];f.state.cfg.catMode=true;f.refresh();const b=await f.begin();f.server(101);await f.done(b,1);f.state.cfg.autoTasks=['auto'];f.refresh();f.server(102);await f.done(a,1);assert.equal(f.state.rt.dailyQuota.cat,1);assert.equal(f.state.rt.dailyQuota.auto,1);
});
test('same revision меньшего счётчика не снимает stale и не заменяет100на99',async()=>{
 const f=fixture();f.c.killSnapNote({name:'Hero',k:100,rev:10});f.c.killSnapStale();f.c.killSnapNote({name:'Hero',k:99,rev:10});assert.equal(vm.runInNewContext('killSnapFresh("Hero")',f.c),false);await f.begin();assert.equal(f.gets,1);assert.equal(f.state.rt.farmQuota.auto.pending.counter,100);
});
test('same revision точный повтор старого hook не снимает stale',async()=>{
 const f=fixture();f.c.killSnapNote({name:'Hero',k:100,rev:10});f.c.killSnapStale();f.c.killSnapNote({name:'Hero',k:100,rev:10});assert.equal(vm.runInNewContext('killSnapFresh("Hero")',f.c),false);await f.begin();assert.equal(f.gets,1);
});
test('свой GET обязан удовлетворять need и не возвращает старую revision как подтверждение',async()=>{
 const f=fixture();f.c.killSnapNote({name:'Hero',k:100,rev:10});await assert.rejects(()=>f.c.farmQuotaSnapshot('Hero',s=>s.rev>10));assert.equal(f.gets,1);
});
// 20.41: approx больше не ждёт очередь записи вкладки (rtCommit) — смена состояния моделируется между началом и итогом боя.
for(const change of ['stop','lease','kick','char'])test('approx после '+change+' не пишет старое завершение',async()=>{
 const f=fixture();f.c.gameGet=async()=>({ok:false});const t=await f.begin();let commits=0;f.c.rtCommit=async()=>{commits++;return true};if(change==='stop')f.c.on=false;if(change==='lease')f.c.leaseEpoch++;if(change==='kick')f.c.rt.manualKickAt++;if(change==='char')f.c.rt.char='Other';await f.done(t,3);assert.equal(commits,0,'итог не ждёт очередь записи');assert.notEqual(t.done,true);assert.equal(f.state.rt.dailyQuota,undefined);
});
test('approx после сброса серии отвергает старый run',async()=>{
 const f=fixture();await f.begin();const ipc=f.c.ipc;f.c.ipc=async()=>({ok:false});f.c.location.search='?spawnId=sdms_test_002';const t=await f.c.beginFarmQuota('sdms_test_002');f.c.ipc=ipc;await f.menu({resetFarmQuota:'auto'});f.refresh();await f.done(t,3);assert.equal(f.state.rt.farmQuota.auto.got,0);
});

test('победа после reload при долге сохраняет хотя бы главную цель без seen',async()=>{
 const f=fixture();let t=await f.begin();f.server(101);await f.done(t,3);await f.begin();f.refresh();f.server(102);await f.c.finishFarmQuota();assert.equal(f.state.rt.dailyQuota.auto,4);
});

test('первый approx с потерянным ACK после сброса run не возвращает старые убийства',async()=>{
 const f=fixture(),ipc=f.c.ipc;f.c.gameGet=async()=>({ok:false});const t=await f.begin();let lose=true;f.c.ipc=async m=>{const r=await ipc(m);if(lose){lose=false;throw Error('lost ack')}return r};await f.done(t,3);await f.menu({resetFarmQuota:'auto'});f.refresh();await f.done(t,3);assert.equal(f.state.rt.farmQuota.auto.got,0);assert.equal(f.state.rt.dailyQuota.auto,3);
});
