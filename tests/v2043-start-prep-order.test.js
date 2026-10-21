'use strict';
// 20.43 (лог 21.10 15:47–15:51): порядок главного цикла и этапы подготовки после Старта (кот → баффы героя → баффы кота → задача).
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
let passed=0;const run=async(n,f)=>{await f();passed++;console.log('PASS '+n)};
const block=content.slice(content.indexOf('const START_PREP_MS'),content.indexOf('// Сторож баффов, обслуживание рыбы'));
function load(o={}){
 let now=1792000000000;const logs=[],calls=[];
 const W={summonReady:false,petReady:false,
  startPrepare:async x=>{calls.push('prep:'+(x.buffs?'pet':'summon'));return o.prepare?.(x)??false},
  startReady:p=>p==='summon'?W.summonReady||W.petReady:W.petReady,step:async x=>{calls.push('step');return o.step?.(x)??false}};
 const sb={console,Date:class extends Date{static now(){return now}},Object,JSON,
  cfg:{autoTasks:['cat'],petAuto:true,...o.cfg},rt:{char:'hero',classCur:{prof:'human_arcana_lord',slot:0},dailyStart:1,...o.rt},on:true,tabOwner:true,location:{pathname:'/map.html'},
  L2EngineCore:{selectedTask:c=>o.task??'cat',taskAllowed:(c,k)=>(c.autoTasks||[]).includes(k)},autonomyMode:()=>'cat',
  L2V7Modules:{warlock:W,payments:{blocked:()=>!!o.payBlocked}},
  loopStale:()=>false,isBattle:()=>!!o.battle,fishNow:()=>false,tvtSoon:()=>!!o.tvt,
  setRt:async p=>{Object.assign(sb.rt,p);return {ok:true}},rtCommit:async()=>true,rec:(...x)=>logs.push(x.join(' ')),setStatus:()=>{},
  townBuffStart:async why=>{calls.push('self');return o.self?.(why)??false}};
 vm.createContext(sb);vm.runInContext(block+';this.loopStartPrep=loopStartPrep;this.prepHold=prepHold;this.startPrepWanted=startPrepWanted;',sb);
 return {sb,W,logs,calls,tick:n=>now+=n,phase:()=>sb.rt.startPrep?.phase};
}
(async()=>{
 await run('mainTick: подготовка между разовыми командами меню и сторожем баффов',async()=>{
  assert.ok(content.includes('await loopMenuJobs() || await loopStartPrep() || await loopTownJobs()'));
  const a=content.indexOf('rt.petRaidPrep && await L2V7Modules.warlock.raidPrepare()'),b=content.indexOf('rt.petPrep && await L2V7Modules.warlock.startPrepare()'),c=content.indexOf('await enchantModePause();');
  assert.ok(a>0&&b>a&&c>b);
  const town=content.slice(content.indexOf('async function loopTownJobs()'),content.indexOf('async function loopSideJobs()'));
  assert.ok(town.includes("!(prepHold() && rt.startPrep.phase === 'summon')"),'сторож не бафает героя до призыва');
  assert.ok(content.includes('!isBattle() && !prepHold() && await L2V7Modules.warlock.step()'),'платный набор кота — после призыва');
  const act=content.slice(content.indexOf('async function loopActivity()'));
  assert.ok(act.indexOf('else if (prepHold())')>0&&act.indexOf('else if (prepHold())')<act.indexOf("autonomyMode() === 'cat') await catGo()"));
  assert.ok(act.indexOf('else if (isBattle()) await battle();')<act.indexOf('else if (prepHold())'),'открытый бой не держится');
 });
 await run('этапы: призыв → баффы героя → баффы кота → задача',async()=>{
  const t=load({prepare:x=>!x.buffs&&!t.W.summonReady});
  assert.equal(await t.sb.loopStartPrep(),true);assert.equal(t.phase(),'summon');assert.ok(t.sb.prepHold());
  t.W.summonReady=true;assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.phase(),'self');
  assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.phase(),'pet');
  t.W.petReady=true;assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.phase(),'done');assert.equal(t.sb.prepHold(),false);
  assert.deepEqual(t.calls,['prep:summon','prep:summon','self','prep:pet']);
  assert.ok(t.logs.some(x=>/старт подготовка перед задачей «катакомбы»/.test(x)));assert.ok(t.logs.some(x=>/кот призван и забафан — начинаю задачу/.test(x)));
  // повторный круг ничего не делает
  assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.calls.length,4);
 });
 await run('платный набор кота — только с petFullAuto и задачей petbuff, после родных баффов',async()=>{
  const t=load({cfg:{autoTasks:['cat','petbuff'],petFullAuto:true},rt:{startPrep:{char:'hero',classKey:'0:arcana_lord',start:1,task:'cat',phase:'pet',t:1792000000000}}});
  t.W.petReady=true;await t.sb.loopStartPrep();assert.deepEqual(t.calls,['prep:pet','step']);assert.equal(t.phase(),'done');
  const u=load({cfg:{autoTasks:['cat'],petFullAuto:true},rt:{startPrep:{char:'hero',classKey:'0:arcana_lord',start:1,task:'cat',phase:'pet',t:1792000000000}}});
  u.W.petReady=true;await u.sb.loopStartPrep();assert.deepEqual(u.calls,['prep:pet']);
 });
 await run('этап дольше 2 мин — задача начинается',async()=>{
  const t=load({prepare:()=>true});await t.sb.loopStartPrep();t.tick(121000);assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.phase(),'done');assert.ok(t.logs.some(x=>/не уложился в 2 мин/.test(x)));
 });
 await run('временный запрет: задача держится, таймаут всё равно отпускает',async()=>{
  const t=load({payBlocked:true});await t.sb.loopStartPrep();assert.equal(t.phase(),'summon');assert.equal(t.calls.length,0);assert.ok(t.sb.prepHold());
  t.tick(121000);await t.sb.loopStartPrep();assert.equal(t.phase(),'done');
 });
 await run('новый Старт, другая задача или класс — заново с призыва',async()=>{
  for(const ch of ['start','task','class']){
   const t=load({rt:{startPrep:{char:'hero',classKey:'0:arcana_lord',start:1,task:'cat',phase:'done',t:1}}});
   assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.phase(),'done');
   if(ch==='start')t.sb.rt.dailyStart=2;if(ch==='task')t.sb.L2EngineCore.selectedTask=()=>'auto';if(ch==='class')t.sb.rt.classCur={prof:'human_warlock',slot:1};
   await t.sb.loopStartPrep();assert.equal(t.phase(),'summon',ch);assert.ok(t.calls.includes('prep:summon'),ch);
  }
  const t=load({rt:{startPrep:{char:'hero',classKey:'0:arcana_lord',start:1,task:'cat',phase:'done',t:1},manualKickAt:5}});
  t.sb.rt.manualKickAt=6;await t.sb.loopStartPrep();assert.equal(t.phase(),'done','правка лимитов подготовку не повторяет');
 });
 await run('без подготовки: рыбалка, заточка, «Только задачи», тур РБ, эпик, нет petAuto, воин',async()=>{
  for(const o of [{task:'fish'},{task:'enchant'},{task:'tasks'},{task:'raid'},{task:'epic'},{cfg:{petAuto:false}},{rt:{classCur:{prof:'orc_titan',slot:0}}}]){
   const t=load(o);assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.sb.rt.startPrep,undefined);assert.equal(t.sb.prepHold(),false);assert.equal(t.calls.length,0);
  }
  const t=load({task:'fish',rt:{petPrep:{char:'hero',pending:null}}});await t.sb.loopStartPrep();assert.equal(t.sb.rt.petPrep,null,'остаток задачи снимается');
 });
 await run('в бою подготовка не идёт и бой не держится',async()=>{
  const t=load({battle:true});assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.calls.length,0);assert.equal(t.sb.prepHold(),false);
 });
 await run('после воскрешения и при пропаже кота вне боя — снова призыв',async()=>{
  assert.ok(content.includes("if (rt.revive) { await reviveStep(); if (!rt.revive && rt.startPrep && tabOwner) await setRt({ startPrep: null });"));
  const h=content.slice(content.indexOf('// 20.43: собственный GET /character игры'));
  assert.ok(/S\?\.phase === 'done' && startPrepEligible\(\) && startPrepSame\(S\) && \(\+S\.resets \|\| 0\) < 3 && Date\.now\(\) - \(\+S\.resetT \|\| 0\) > 60000/.test(h));
 });
 await run('тур РБ: призыв раньше баффа героя, баффы кота — после',async()=>{
  const raid=fs.readFileSync(path.join(__dirname,'../modules/raid.js'),'utf8');
  const a=raid.indexOf('await env.warlock?.raidPrepare?.({ buffs: false })'),b=raid.indexOf('rbBuffHold(preparing.name, active)'),c=raid.indexOf("rbHuntPhase('prepare', 'призываю и бафаю кота до боя с РБ')");
  assert.ok(a>0&&a<b&&b<c);
 });
 console.log(passed+' сценариев PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
