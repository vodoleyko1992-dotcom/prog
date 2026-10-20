'use strict';
// 20.41 (лог 20.10 21:09, Krokian Padisha Sobekk 74): удар → удар 2,7–3,0 с при разрешённых сервером ≈1,2 с. Перед каждым ударом
// бой ждал учёт соседей РБ (вся очередь записи + полный statePatch при памяти 1,3 МБ), до первого удара — ещё 7 полных записей.
// Теперь: учёт соседей в бою — в фоне строго по одной записи, итог боя ждёт её и делает последнюю; запись без новых смертей
// соседей не делается; опись панели, статистика РБ и проверка баффов не держат удар.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const combat=read('modules/combat.js'),buffs=read('modules/buffs.js'),content=read('content.js');

// Вырезка одиночной фоновой записи из battle(): тот же текст, что в бою.
function raidCounter(note,valid=()=>true){
 const a=combat.indexOf('  let raidCountP = null, raidCountAgain = false;'),b=combat.indexOf('  const countExtras = async (final = false) => {');
 assert.ok(a>0&&b>a,'вырезка raidCount');
 const box={env:{noteRaidMobKills:note},ctx:{},killOwnerValid:valid,out:null};
 vm.runInNewContext(combat.slice(a,b)+'\nout={raidCount,flight:()=>raidCountP};',box);
 return box.out;
}
const deferred=()=>{let resolve;const p=new Promise(r=>resolve=r);return {p,resolve};};

test('ход не ждёт записи: во время записи новые ответы дают ровно один повтор после неё',async()=>{
 const calls=[],gates=[];
 const R=raidCounter((sp,begin)=>{calls.push(begin?'begin':'count');const d=deferred();gates.push(d);return d.p;});
 R.raidCount('l2dop_rb_1',true);
 assert.deepEqual(calls,['begin'],'курсор начала снимается сразу при вызове');
 R.raidCount('l2dop_rb_1');R.raidCount('l2dop_rb_1');R.raidCount('l2dop_rb_1');
 assert.equal(calls.length,1,'пока идёт запись, новых записей нет');
 gates[0].resolve();await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['begin','count'],'три ответа за время записи — один проход после неё');
 gates[1].resolve();await new Promise(r=>setImmediate(r));
 assert.equal(R.flight(),null,'фоновая запись завершена');
 R.raidCount('l2dop_rb_1');assert.deepEqual(calls,['begin','count','count']);gates[2].resolve();
});

test('ошибка записи не ломает следующий ход, смена владельца прекращает повторы',async()=>{
 let ok=true,n=0;const R=raidCounter(async()=>{n++;throw Error('storage');},()=>ok);
 await R.raidCount('l2dop_rb_1');assert.equal(n,1);assert.equal(R.flight(),null);
 const d=deferred();let m=0;const R2=raidCounter(()=>{m++;return d.p;},()=>ok);
 R2.raidCount('l2dop_rb_1');R2.raidCount('l2dop_rb_1');ok=false;d.resolve();await new Promise(r=>setImmediate(r));
 assert.equal(m,1,'после смены героя/Stop повторная запись не делается');
});

test('круг боя не ждёт учёт соседей, победа и смерть ждут его и пишут итог',()=>{
 assert.match(combat,/if\(raidCounted\)\{const sp=ctx\.spawnId\|\|spawnId;if\(!final\)void raidCount\(sp\);else\{while\(raidCountP\)await raidCountP;await env\.noteRaidMobKills\(sp\);\}\}/);
 assert.doesNotMatch(combat,/if\(raidCounted\)await env\.noteRaidMobKills/);
 assert.match(combat,/async function battleDeath\(ctx,countExtras\) \{\n  await countExtras\(true\);/);
 assert.match(combat,/if \(env\.pvpPending\?\.\(\)\) return env\.pvpRecoveryStep\(\);\n  await countExtras\(true\);\n  if\(!killOwnerValid\(ctx\)\)return;/);
 assert.match(combat,/\n    await countExtras\(\);\n    if \(!env\.on \|\| !env\.tabOwner\) return;/,'круг боя');
 assert.match(combat,/void raidCount\(ctx\.spawnId\|\|spawnId,true\);/,'начало боя без ожидания записи');
 assert.doesNotMatch(combat,/await env\.noteRaidMobKills\(ctx\.spawnId\|\|spawnId,true\)/);
});

test('первый удар не ждёт статистику РБ, опись панели и проверку баффов',()=>{
 assert.match(combat,/\n    env\.setRt\(\{ panel: inv, panelSig: invSig \}\)\?\.catch\?\.\(\(\) => \{\}\);/);
 assert.doesNotMatch(combat,/await env\.rbNote\(ctx\.rb\.id, \{ name: ctx\.name, lvl: rbLvl, tries/);
 assert.doesNotMatch(combat,/await env\.rbNote\(ctx\.rb\.id, \{ persist: ctx\.rb\.persist/);
 const step=buffs.slice(buffs.indexOf('async function buffAuditStep'),buffs.indexOf('function buffList'));
 assert.doesNotMatch(step,/await env\.setRt/);assert.match(step,/env\.setRt\(patch\)\?\.catch\?\.\(\(\) => \{\}\);/);
});

// Учёт соседей РБ: без новых смертей соседей запись не делается (каждый ответ сервера двигал курсор → полный rt на ход).
function fixture(){
 let now=Date.parse('2026-10-20T11:00:00Z'),report;const spawn='l2dop_rb_fixture';
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 const source=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),box);
 const f=box.fixture();Object.assign(f.state.cfg,{autoTasks:['raid','auto'],dailyKillLimit:1000,autoKillLimit:0});
 Object.assign(f.state.rt,{kills:0,sessT0:123,classCur:{prof:'dwarf_bounty_hunter',slot:1}});f.refresh();f.c.location.search='?spawnId='+spawn;
 f.c.L2V7Modules={fightlab:{raidKillsFor:()=>structuredClone(report)}};
 f.report=(seq,deaths,extra={})=>{report={spawn,t:now,win:false,lose:false,...extra,stream:{seq,rev:10+seq,start:'rev:10',deaths,...(extra.stream||{})}}};
 const ipc=f.c.ipc;f.raidWrites=0;f.c.ipc=async m=>{if(m?.raidMobs)f.raidWrites++;return ipc(m);};
 f.note=begin=>f.c.noteRaidMobKills(spawn,begin);f.report(0,[]);return f;
}
test('ответы без новых смертей соседей не пишут память, смерть и итог боя — пишут',async()=>{
 const f=fixture();await f.note(true);assert.equal(f.raidWrites,1,'начало');
 f.report(3,[]);await f.note();f.report(6,[]);await f.note();
 assert.equal(f.raidWrites,1,'ходы без смертей соседей — без записи');
 f.report(9,[8]);await f.note();assert.equal(f.raidWrites,2);assert.equal(f.state.rt.kills,1);assert.equal(f.state.rt.dailyQuota.raid,1);
 f.report(12,[8]);await f.note();assert.equal(f.raidWrites,2,'тот же сосед не пишется снова');
 f.report(15,[8,14]);await f.note();assert.equal(f.raidWrites,3);assert.equal(f.state.rt.kills,2,'смерть после пропущенных ходов учтена');
 f.report(18,[8,14],{win:true});await f.note();assert.equal(f.raidWrites,4,'итог боя пишется всегда');assert.equal(f.state.rt.kills,2);
 assert.equal(f.state.rt.raidMobMarks[Object.keys(f.state.rt.raidMobMarks)[0]].done,true);
});
test('строка размера памяти называет крупные части',()=>{
 assert.match(content,/function rtSizeTop\(\)/);assert.match(content,/статистика сохранена\$\{rtSizeTop\(\)\}/);
});

// Отложенная запись замеров навыков: не отдельной полной записью после каждого удара, а пакетом.
test('отложенный патч: не пишется сразу, уходит с обычной записью, по таймеру, в recover и peek; clear отменяет',async()=>{
 const {createPatchQueue}=require('../engine-core.js');
 const sent=[];let timer=null;const timers={set:(f,ms)=>{timer={f,ms};return 1;},clear:()=>{timer=null;}};
 const q=createPatchQueue(async b=>{sent.push(b);return {ok:true};},()=>true,()=>{},()=>Date.now(),timers);
 assert.deepEqual(await q.defer({skills:{a:1}}),{ok:true,deferred:true});
 assert.equal(sent.length,0,'не пишется сразу');assert.equal(timer.ms,8000);
 await q.defer({skills:{a:2}},3000);assert.equal(timer.ms,8000,'один таймер на пакет');
 assert.deepEqual(q.peek(),{skills:{a:2}},'уход со страницы (pagehide) видит отложенное');
 await q.enqueue({status:'x'});
 assert.deepEqual(sent,[{skills:{a:2},status:'x'}],'обычная запись забирает отложенное');assert.equal(timer,null);
 await q.defer({skills:{a:3}});await q.enqueue({skills:{a:4}});
 assert.deepEqual(sent.at(-1),{skills:{a:4}},'более новая обычная запись того же ключа сильнее отложенной');
 await q.defer({turnMs:5});timer.f();await new Promise(r=>setImmediate(r));
 assert.deepEqual(sent.at(-1),{turnMs:5},'по таймеру');
 await q.defer({hpMin:1});assert.deepEqual(await q.recover(),{ok:true});assert.deepEqual(sent.at(-1),{hpMin:1},'rtCommit/recover дописывает отложенное');
 await q.defer({skills:{b:1}});q.clear();assert.equal(timer,null);assert.deepEqual(q.peek(),{},'смена героя/замка отменяет');
});
test('замеры навыков после удара пишутся отложенно',()=>{
 assert.match(content,/function setRtSoon\(p, ms = 8000\) \{\n  rt = \{ \.\.\.rt, \.\.\.p \};/);
 assert.match(content,/await setRtSoon\(\{ skills: \{ \.\.\.\(rt\.skills \|\| \{\}\), \[key\]: p \} \}\);/);
 assert.match(content,/await setRtSoon\(\{ skills: \{ \.\.\.\(rt\.skills \|\| \{\}\), \[key\]: \{ \.\.\.p, name \} \} \}\);/);
});
test('учёт соседей ждёт очередь записи только при ключах счёта в ней',async()=>{
 const f=fixture();let commits=0;f.c.rtCommit=async()=>{commits++;return true;};
 await f.note(true);f.c.queued={skills:{a:1},turnMs:[1]};f.report(3,[2]);await f.note();
 assert.equal(commits,0,'замеры навыков в очереди — не повод ждать');assert.equal(f.state.rt.kills,1);
 f.c.queued={kills:5};f.report(6,[2,5]);await f.note();assert.equal(commits,1,'kills в очереди — сначала дописать её');assert.equal(f.state.rt.kills,2);
 f.c.rtCommit=async()=>false;f.c.queued={dailyQuota:{}};f.report(9,[2,5,8]);await f.note();assert.equal(f.state.rt.kills,2,'очередь не записалась — счёт не отправлен');
});

// Итог квоты фарма (обычный моб/катакомбы): больше не ждёт всю очередь записи вкладки перед statePatch итога.
function farmFixture(){
 const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,Date,URL,URLSearchParams,structuredClone,console};
 const source=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),box);
 const f=box.fixture();Object.assign(f.state.rt,{kills:49,sessT0:7});f.refresh();
 f.commits=0;f.c.rtCommit=async()=>{f.commits++;return true;};
 f.c.setRt=p=>{f.c.rt={...f.c.rt,...p};f.c.queued={...(f.c.queued||{}),...p};return Promise.resolve({ok:true});};
 f.flush=()=>{Object.assign(f.state.rt,structuredClone(f.c.queued||{}));f.c.queued={};};
 return f;
}
test('итог квоты не ждёт очередь записи; старый kills в очереди не понижает счёт фона',async()=>{
 const f=farmFixture(),t=await f.begin();f.grow(3);
 f.c.setRt({kills:f.c.rt.kills+1,exp:10});                  // победа: память вкладки +1, патч ещё в очереди
 await f.win(t);
 assert.equal(f.commits,0,'итог не ждёт rtCommit');
 assert.equal(f.state.rt.kills,52,'фон: начало сессии 49 + 3 убитых по серверу');
 assert.equal(f.c.queued.kills,52,'в очереди свежий счёт вместо 50');
 f.flush();assert.equal(f.state.rt.kills,52,'после записи очереди счёт не понизился');assert.equal(f.state.rt.exp,10);
});
test('итог квоты без kills в очереди лишней записи не ставит',async()=>{
 const f=farmFixture(),t=await f.begin();f.grow(2);f.c.queued={skills:{a:1}};
 await f.win(t);assert.equal(f.commits,0);assert.deepEqual(Object.keys(f.c.queued),['skills']);
});
