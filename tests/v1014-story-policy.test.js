'use strict';
// 10.0.14: сохранённый поход к NPC не даёт разрешения тратить адену после выключения автосдачи.
// Кнопки/цена соответствуют публичным noblesse-quest.js и /game/teleport/locations.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../modules/story.js'),'utf8');
function fixture(change={}) {
 const fired=[],gets=[],tp={dataset:{noblesseTarget:'rune'}},done={dataset:{noblesseAction:'advance'}};
 const box={children:[tp],querySelector:s=>s.includes('="teleport"')?tp:change.done&&s.includes('="advance"')?done:null};
 const sb={location:{pathname:'/noblesse-quest.html',href:''},sessionStorage:{getItem(){},setItem(){}},console};vm.runInNewContext(src,sb);
 const J={kind:'noblesse',key:'noblesse:1',why:'часть 1',home:'silent_valley',t:Date.now()};
 const env={on:true,cfg:{storyTurnIn:true,storyTpMax:100000},rt:{storyJob:J,storyTried:{[J.key]:Date.now()}},
  isBattle:()=>false,fishNow:()=>false,$q:s=>s==='#noblesse-quest-actions'?box:null,
  waitX:async f=>{const r=f();change.wait?.(env);return r;},setRt:async p=>{Object.assign(env.rt,p);change.write?.(env,p)},
  gameGet:async url=>{gets.push(url);change.price?.(env);return {ok:true,json:async()=>({locations:[{teleportId:'rune',adenaCost:20000}]})}},
  rec(){},setStatus(){},sleep:async()=>{},fire:b=>fired.push(b)};
 require('./helpers/story-payments.cjs')(env);
 return {S:sb.L2V7Factories.story(env),env,fired,gets,tp};
}
test('сохранённый поход при выключенной автосдаче отменяется до платного перехода',async()=>{
 const f=fixture();f.env.cfg.storyTurnIn=false;await f.S.storyStep();assert.equal(f.fired.length,0);assert.equal(f.env.rt.storyJob,null);assert.equal(f.gets.length,0);assert.equal(f.env.rt.storyTried['noblesse:1'],undefined);
});
test('автосдача выключена во время запроса цены — телепорт не нажимается',async()=>{
 const f=fixture({price:e=>{e.cfg.storyTurnIn=false}});await f.S.storyStep();assert.equal(f.fired.length,0);assert.equal(f.env.rt.storyJob,null);
});
test('автосдача выключена во время сохранения перехода — адена остаётся',async()=>{
 const f=fixture({write:(e,p)=>{if(p.actionPayments?.pending)e.cfg.storyTurnIn=false}});await f.S.storyStep();assert.equal(f.fired.length,0);assert.equal(f.env.rt.storyJob,null);
});
test('автосдача выключена при загрузке готовой кнопки — часть не сдаётся',async()=>{
 const f=fixture({done:true,wait:e=>{e.cfg.storyTurnIn=false}});await f.S.storyStep();assert.equal(f.fired.length,0);assert.equal(f.env.rt.storyJob,null);
});
test('разрешённая автосдача нажимает известный телепорт в пределах лимита один раз',async()=>{
 const f=fixture();await f.S.storyStep();assert.deepEqual(f.fired,[f.tp]);assert.ok(f.env.rt.storyJob.tpT);assert.deepEqual(f.gets,['/game/teleport/locations']);
});
test('отклонённый fire не оставляет фиктивный tpT и restart выполняет один телепорт',async()=>{
 const f=fixture(),fire=f.env.fire;f.env.fire=()=>false;await f.S.storyStep();assert.equal(f.fired.length,0);assert.ok(f.env.rt.storyJob);assert.equal(f.env.rt.storyJob.tpT,undefined);
 f.env.fire=fire;await f.S.storyStep();assert.equal(f.fired.length,1);assert.ok(f.env.rt.storyJob.tpT);
});
test('durable prepare завершается до клика; Stop во время записи не тратит адену',async()=>{
 const f=fixture(),set=f.env.setRt;let release;
 f.env.setRt=p=>{const result=set(p);return p.actionPayments?.pending?new Promise(resolve=>{release=()=>resolve({ok:true})}):result};
 const running=f.S.storyStep();for(let i=0;i<30&&!release;i++)await Promise.resolve();assert.ok(release);assert.equal(f.fired.length,0);
 f.env.on=false;release();await running;assert.equal(f.fired.length,0);assert.equal(f.env.payments.pending(),null);assert.equal(f.env.rt.storyLog,undefined);
});
test('Stop до принятия fire сохраняет задание без tpT и допускает restart',async()=>{
 const f=fixture(),fire=f.env.fire;f.env.fire=()=>{f.env.on=false;return false};await f.S.storyStep();
 assert.ok(f.env.rt.storyJob);assert.equal(f.env.rt.storyJob.tpT,undefined);assert.equal(f.env.rt.storyLog,undefined);f.env.on=true;f.env.fire=fire;
 await f.S.storyStep();assert.equal(f.fired.length,1);assert.ok(f.env.rt.storyJob.tpT);
});
