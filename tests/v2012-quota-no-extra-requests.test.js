'use strict';
// 20.12 (ревизия 17.10, аудит H1/F1/F9/Q-2/Q-3/M4): дневной лимит мобов без лишних запросов. Счётчик убийств — из ответов
// самой игры (hook kc), отметка начала боя не держит героя (без счётчика — билет «неточно» и учёт по журналу боя),
// подтверждение итога ограничено 5 попытками / 30 с, cfg пишется только при снятии задачи.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(){
 let now=Date.parse('2026-10-17T05:00:00Z');
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture('auto');f.state.cfg.autoKillLimit=0;f.state.cfg.dailyKillLimit=50;f.refresh();
 f.gets=0;const get=f.c.gameGet;f.c.gameGet=async(...a)=>{f.gets++;return get(...a)};
 f.cfgWrites=0;const set=f.bg.chrome.storage.local.set;f.bg.chrome.storage.local.set=async p=>{if('cfg' in p)f.cfgWrites++;return set(p)};
 f.advance=ms=>{now+=ms;f.state.lock.t=now};
 return f;
}
test('счётчик из ответа игры: ни одного своего GET /character на бой',async()=>{
 const f=fixture();f.c.killSnapNote({name:'Hero',k:100,rev:10});
 const t=await f.begin();assert.ok(t&&!t.approx);assert.equal(f.state.rt.farmQuota.auto.pending.counter,100);
 f.c.killSnapNote({name:'Hero',k:104,rev:11});   // GET /character самой игры после победного хода
 assert.equal(await f.win(t),false);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(f.gets,0);
 // следующий бой начинается от того же снимка — без запроса
 const t2=await f.begin();assert.equal(f.state.rt.farmQuota.auto.pending.counter,104);f.c.killSnapNote({name:'Hero',k:105,rev:12});await f.win(t2);
 assert.equal(f.state.rt.dailyQuota.auto,5);assert.equal(f.gets,0);
});
test('снимок другого героя, старая ревизия и снимок после конца боя не годятся',async()=>{
 const f=fixture();f.c.killSnapNote({name:'Other',k:5,rev:99});await f.begin();assert.equal(f.gets,1);
 const g=fixture();g.c.killSnapNote({name:'Hero',k:100,rev:10});g.c.killSnapNote({name:'Hero',k:90,rev:9});await g.begin();assert.equal(g.state.rt.farmQuota.auto.pending.counter,100);assert.equal(g.gets,0);
 const h=fixture();h.c.killSnapNote({name:'Hero',k:100,rev:10});h.c.killSnapStale();await h.begin();assert.equal(h.gets,1);
});
test('сбой счётчика не держит бой: билет «неточно», убитые по журналу, повтор GET не чаще раза в 10 с',async()=>{
 const f=fixture();f.c.gameGet=async()=>{f.gets++;return {ok:false,status:429}};
 const t=await f.begin();assert.notEqual(t,false);assert.equal(t.approx,true);assert.equal(f.gets,1);
 assert.equal(await f.c.finishFarmQuota(t,false,3),false);assert.equal(f.state.rt.dailyQuota.auto,3);assert.equal(f.state.rt.farmQuota.auto.approx,3);
 assert.equal(await f.c.finishFarmQuota(t,false,3),false);assert.equal(f.state.rt.dailyQuota.auto,3,'один бой не засчитывается дважды');
 f.c.location.search='?spawnId=sdms_test_002';const t2=await f.c.beginFarmQuota('sdms_test_002');assert.equal(t2.approx,true);assert.equal(f.gets,1,'нет повторного запроса сразу после неудачи');
 assert.equal(await f.c.finishFarmQuota(t2,true,2),false);assert.equal(f.state.rt.dailyQuota.auto,5);
});
test('неподтверждённая победа: не больше 5 попыток / 30 с, потом учёт по журналу и следующий бой',async()=>{
 const f=fixture(),t=await f.begin();   // счётчик сервера после победы не вырос
 let tries=0;for(;tries<20;tries++){const r=await f.c.finishFarmQuota(null,false);if(r===false)break;f.advance(2500)}
 assert.ok(tries>=4&&tries<=6,'попыток '+tries);assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.state.rt.dailyQuota.auto,1);assert.equal(f.state.rt.farmQuota.auto.approx,1);
 assert.ok(f.gets<=7,'запросов '+f.gets);
 assert.equal(await f.c.finishFarmQuota(null,false),false,'экран победы больше не держит');
 const g=fixture();await g.begin();assert.equal(await g.c.finishFarmQuota(null,false),true);assert.equal(await g.c.finishFarmQuota(null,false),true);assert.equal(g.gets,2,'повтор не чаще раза в 2 с');
});
test('cfg пишется только при снятии задачи по лимиту',async()=>{
 const f=fixture();let t=await f.begin();f.grow(2);await f.win(t);assert.equal(f.cfgWrites,0);
 f.state.cfg.autoKillLimit=3;f.refresh();t=await f.begin();f.grow(3);assert.equal(await f.win(t),true);assert.equal(f.cfgWrites,1);assert.equal(f.state.cfg.zoneAuto,false);
});
test('бой не бросается при отказе отметки; hook отдаёт счётчик из /character',()=>{
 const combat=read('modules/combat.js');assert.doesNotMatch(combat,/ctx\.farmQuota === false\) return/);assert.match(combat,/ctx\.quotaTicket\(\)/);
 const hook=read('hook.js'),line=hook.split('\n').find(l=>l.includes('const killsOf ='));const killsOf=vm.runInNewContext(line.replace('const killsOf =','(').replace(/;\s*$/,'')+')');
 assert.equal(JSON.stringify(killsOf({character:{name:'Hero',mobsKilled:7,revision:3,hp:1}})),'{"name":"Hero","k":7,"rev":3}');
 assert.equal(killsOf({character:{name:'Hero',revision:3}}),undefined);assert.match(hook,/kc: killsOf\(o\)/);
 assert.match(read('content.js'),/get farmQuotaCached\(\)/);
});
