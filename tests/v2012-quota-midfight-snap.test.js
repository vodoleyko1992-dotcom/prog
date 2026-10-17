'use strict';
// 20.12 (ревизия 17.10, ревью шага 3): итог боя подтверждается только снимком счётчика, снятым после конца боя. Снимок родного
// GET /character из середины AoE-боя (убит сосед) устаревает на конце боя и не годится как итог — иначе убийство главной цели терялось.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(server){
 let now=Date.parse('2026-10-17T05:00:00Z');
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture('auto');f.state.cfg.autoKillLimit=0;f.state.cfg.dailyKillLimit=50;f.refresh();
 f.gets=0;f.c.gameGet=async()=>{f.gets++;return {ok:true,json:async()=>({character:{name:'Hero',mobsKilled:server.k,revision:server.rev}})}};
 return f;
}
test('победа: снимок из середины боя после конца боя не итог — свой GET, засчитана и главная цель',async()=>{
 const server={k:102,rev:14},f=fixture(server);f.c.killSnapNote({name:'Hero',k:100,rev:10});
 const t=await f.begin();assert.ok(t&&!t.approx);assert.equal(f.state.rt.farmQuota.auto.pending.counter,100);assert.equal(f.gets,0);
 f.c.killSnapNote({name:'Hero',k:101,rev:13});   // родной GET /character после хода, где умер сосед
 f.c.killSnapStale();                            // последний ход убил главную цель, ответ боя без character
 assert.equal(await f.win(t),false);
 assert.equal(f.gets,1,'нужен свежий счётчик после конца боя');assert.equal(f.state.rt.dailyQuota.auto,2);
 assert.equal(f.state.rt.farmQuota.auto.pending,null);
});
test('поражение: снимок из середины боя не закрывает бой, поздние убийства засчитаны',async()=>{
 const server={k:103,rev:15},f=fixture(server);f.c.killSnapNote({name:'Hero',k:100,rev:10});
 await f.begin();f.c.killSnapNote({name:'Hero',k:101,rev:12});f.c.killSnapStale();
 assert.equal(await f.c.finishFarmQuota(null,true),false);assert.equal(f.gets,1);assert.equal(f.state.rt.dailyQuota.auto,3);
});
test('снимок после конца боя (родной GET после победы) по-прежнему без своего запроса',async()=>{
 const f=fixture({k:0,rev:0});f.c.killSnapNote({name:'Hero',k:100,rev:10});const t=await f.begin();
 f.c.killSnapNote({name:'Hero',k:101,rev:13});f.c.killSnapStale();f.c.killSnapNote({name:'Hero',k:102,rev:14});
 assert.equal(await f.win(t),false);assert.equal(f.gets,0);assert.equal(f.state.rt.dailyQuota.auto,2);
});
