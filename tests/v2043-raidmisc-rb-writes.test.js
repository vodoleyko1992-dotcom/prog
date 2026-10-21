'use strict';
// 20.43 (разбор 21.10): в бою с РБ обучающие цифры (incoming, спецудар/maxHit, rbWound) пишутся отложенно и только при изменении.
// Раньше rbLearn на каждой порции журнала писал весь rbDb обычной записью (метка t новая каждый ход) — она выталкивала с собой
// отложенные пакеты 20.41, и фон каждый ход читал/писал всю память. Память вкладки (её читает rbFlee) обновляется сразу.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function fixture({soon=true}={}){
  let now=1800000000000,lines=[];const timers=[];
  const core={console,Date,Intl,Math,JSON};vm.runInNewContext(read('engine-core.js'),core);
  const sends=[],calls={setRt:0,soon:0};
  // очередь записи — настоящая (createPatchQueue), таймер отложенной записи — ручной
  const Q=core.L2EngineCore.createPatchQueue(async b=>{sends.push(JSON.parse(JSON.stringify(b)));return{ok:true}},()=>true,()=>{},()=>now,{set:(f,ms)=>{const t={f,at:now+ms};timers.push(t);return t},clear:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1)}});
  const rt={char:'Hero',classCur:{prof:'human_arcana_lord',slot:0},rbDb:{},rbStats:{boss:{hp:2123774,patk:11210,matk:6280,lvl:69}},rbList:{boss:{lvl:69}}};
  const env={rt,cfg:{rbHuntMode:true,rbRestHp:95,rbRetreatHp:20},heroLvl:()=>78,epicById:()=>null,warlock:{raidContext:()=>({managed:true,key:'boss:armor-A',prepared:true})},
    logLines:()=>lines,newLines:(a,b)=>b.slice(a.length),activeBuffs:()=>[],rec:()=>{},mobHp:()=>({cur:1500000,max:2123774}),
    setRt:p=>{calls.setRt++;Object.assign(rt,p);return Q.enqueue(p)}};
  if(soon)env.setRtSoon=(p,ms=8000)=>{calls.soon++;Object.assign(rt,p);return Q.defer(p,ms)};
  const box={console,Math,Number,JSON,Date:class extends Date{static now(){return now}}};box.globalThis=box;
  vm.runInNewContext(read('modules/raid.js'),box);const R=box.L2V7Factories.raid(env);env.rbNote=R.rbNote;
  const settle=()=>new Promise(r=>setImmediate(r));
  const fire=async()=>{for(const t of timers.splice(0).filter(t=>t.at<=now))t.f();await settle();};
  return{env,rt,R,Q,sends,calls,timers,settle,fire,ctx:{name:'Boss',rb:{id:'boss',lp:[]}},add:l=>{lines=[...lines,...l]},tick:ms=>{now+=ms},now:()=>now};
}
test('10 ходов с РБ: обычной записи памяти нет, maxHit и incoming в памяти вкладки — сразу, в хранилище — одним пакетом',async()=>{
  const f=fixture(),hits=[300,420,380,610,500,450,700,520,480,690];let max=0;
  for(const [i,h] of hits.entries()){
    f.add([`Ты нанёс [Boss] ${1000+i} урона.`,`Boss ударив тебе −${h} HP`]);f.R.rbLearn(f.ctx);await f.settle();max=Math.max(max,h);
    assert.equal(f.rt.rbDb.boss.incoming.maxHit,max,`ход ${i+1}: incoming.maxHit в памяти вкладки`);
    assert.equal(f.rt.rbDb.boss.maxHit,max,`ход ${i+1}: maxHit для аварийного выхода`);
    f.tick(1300);
  }
  assert.equal(f.calls.setRt,0,'ни одной обычной записи за 10 ходов (раньше — каждый ход)');
  assert.equal(f.sends.length,0,'до срока отложенной записи хранилище не трогаем');
  assert.ok(f.rt.rbWound.boss.cur>0,'rbWound в памяти вкладки');
  await f.fire();
  assert.equal(f.sends.length,1,'один пакет за 8 с');
  assert.equal(f.sends[0].rbDb.boss.incoming.maxHit,700);assert.equal(f.sends[0].rbDb.boss.incoming.n,10);assert.equal(f.sends[0].rbWound.boss.cur,1500000);
  // аварийный выход в этом бою видит цифры сразу (из памяти вкладки)
  assert.equal(f.R.rbIncoming('boss').maxHit,700);assert.equal(f.R.rbIncoming('boss').source,'observed');
});
test('без изменения цифр новых записей нет; метка свежести — не чаще раза в минуту',async()=>{
  const f=fixture();f.add(['Boss ударив тебе −300 HP']);f.R.rbLearn(f.ctx);const n0=f.calls.soon,t0=f.rt.rbDb.boss.t;
  for(let i=0;i<5;i++){f.tick(1300);f.add([`Ты нанёс [Boss] ${900+i} урона.`]);f.R.rbLearn(f.ctx);}
  assert.equal(f.calls.soon,n0,'свои удары без новых ударов РБ — не повод писать rbDb');assert.equal(f.rt.rbDb.boss.t,t0);
  f.tick(60000);f.add(['Ты нанёс [Boss] 950 урона.']);f.R.rbLearn(f.ctx);
  assert.equal(f.calls.soon,n0+2,'через минуту освежаем метку incoming (и замер HP РБ раз в 8 с)');assert.equal(f.rt.rbDb.boss.incoming.t,f.now());
  assert.equal(f.calls.setRt,0);
});
test('победа, смерть и проба пишутся сразу и забирают с собой отложенные цифры боя; отход — тоже',async()=>{
  const f=fixture();f.add(['Boss ударив тебе −450 HP']);f.R.rbLearn(f.ctx);await f.settle();assert.equal(f.sends.length,0);
  await f.R.rbNote('boss',{kills:1});
  assert.equal(f.sends.length,1,'победа — обычная запись');assert.equal(f.sends[0].rbDb.boss.kills,1);assert.equal(f.sends[0].rbDb.boss.incoming.maxHit,450,'отложенное ушло вместе с победой');
  assert.ok(f.sends[0].rbWound?.boss,'замер HP РБ ушёл вместе с победой');assert.equal(f.sends[0].rbHuntIdle,0);
  // soon=true не откладывает факты: смерть и проба — сразу
  for(const patch of [{note:'убил героя 78'},{probe:{kind:'dps',t:f.now()}}]){const n=f.sends.length;await f.R.rbNote('boss',patch,true);assert.equal(f.sends.length,n+1,JSON.stringify(patch));}
  assert.equal(f.rt.rbDb.boss.deathLog.length,1);
  // отход: обычная запись rbRetreat уносит отложенный rbWound
  const g=fixture();g.add(['Boss ударив тебе −300 HP']);g.R.rbLearn(g.ctx);await g.settle();
  await g.env.setRt({rb:{boss:{hpAfter:1400000}}});assert.equal(g.sends.length,1);assert.ok(g.sends[0].rbWound?.boss);assert.ok(g.sends[0].rbDb?.boss?.incoming);
});
test('старое окружение без setRtSoon пишет как раньше (обычной записью)',async()=>{
  const f=fixture({soon:false});f.add(['Boss ударив тебе −300 HP']);f.R.rbLearn(f.ctx);await f.settle();
  assert.ok(f.calls.setRt>=2);assert.equal(f.rt.rbDb.boss.incoming.maxHit,300);assert.equal(f.rt.rbWound.boss.cur,1500000);
});
test('исходник: incoming, спецудар/maxHit и rbWound — через отложенную запись; победа/смерть/проба исключены',()=>{
  const s=read('modules/raid.js');
  assert.match(s,/const write = soon && !won && !died && !patch\.probe && typeof env\.setRtSoon === 'function' \? env\.setRtSoon : env\.setRt;/);
  assert.match(s,/\['n','base','sp','maxHit','hitP90'\]\.some\(k => inc\[k\] !== old\[k\]\)/);
  assert.match(s,/\(env\.setRtSoon \|\| env\.setRt\)\(\{ rbWound: W \}\)/);
});
