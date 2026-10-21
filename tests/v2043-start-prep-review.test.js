'use strict';
// 20.43 (ревью диффа, лог 21.10 15:47–15:51): подготовка кота после Старта — поколение подготовки (rt.startPrep.id) для отметок и
// сохранённой задачи warlock, повторная проверка «кот пропал вне боя», без создания подготовки в бою, свежее чтение платного набора
// только один раз за этап, сторож баффов в туре РБ — после призыва кота.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
let passed=0;const run=async(n,f)=>{await f();passed++;console.log('PASS '+n)};
const CAT={kind:'servitor',key:'feline_king',summonSkillId:1406,summonSkillLevel:3,hp:100,activeBuffs:[]};
function setup(o={}){
 const f=fixture({cfg:{petFullAuto:false,petAuto:true,petBuffAuto:true,nPetBuffs:'Summon Feline Queen',...o.cfg},char:{mp:5000,l2Profession:'arcana_lord',...o.char},rt:{classCur:{prof:'arcana_lord',slot:0},startPrep:{id:1,phase:'summon'},...o.rt}});
 const e=f.env;let page=o.page||'/dungeon.html?dungeonId=x';const fires=[],nav=[],logs=[];
 e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>true;e.startPrepWanted=()=>true;e.raidWanted=()=>false;
 e.setStatus=t=>logs.push(t);e.rec=(...x)=>logs.push(x.join(' '));e.classNote=()=>{};
 const row=(id,name)=>({action:'l2_'+id,skillId:id,effectId:id===1331?4699:id,name,mp:10,ready:true,button:{id}});
 e.nativePanel=()=>({summon:row(1406,'Summon Feline King'),buffs:[row(1331,'Summon Feline Queen')]});
 e.nativePanelPath=()=>page.split('?')[0];e.nativeReturnPath=()=>page;e.nativePanelOpen=async()=>{};
 e.nativeNavigate=p=>{nav.push(p);page=p};e.nativeFire=b=>{fires.push(b.id);return true};
 return {...f,e,fires,nav,logs,prep:x=>f.api().startPrepare(x),ready:p=>f.api().startReady(p)};
}
(async()=>{
 await run('задача прошлого Старта (старое поколение) снимается без «не уложилась в 2 мин» — призыв идёт',async()=>{
  const f=setup({char:{activeSummon:null},rt:{petPrep:{char:'hero',classKey:'0:arcana_lord',gen:1,buffs:false,back:'/map.html',pending:null,t:1792000000000-600000}}});
  f.e.rt.startPrep={id:2,phase:'summon'};
  assert.equal(await f.prep({buffs:false}),true);
  assert.ok(!f.logs.some(x=>/не уложилась в 2 мин/.test(x)),'не таймаут');assert.equal(f.ready('summon'),false,'нет отметки отказа');
  assert.equal(f.e.rt.petPrep.gen,2,'новая задача — нового поколения');assert.deepEqual(f.nav,['/skill-panel.html']);
  await f.prep();assert.deepEqual(f.fires,[1406]);
 });
 await run('задача своего поколения старше 2 мин — прежний таймаут',async()=>{
  const f=setup({char:{activeSummon:null},rt:{petPrep:{char:'hero',classKey:'0:arcana_lord',gen:1,buffs:false,back:'/map.html',pending:null,t:1792000000000-130000}}});
  assert.equal(await f.prep({buffs:false}),false);assert.ok(f.logs.some(x=>/не уложилась в 2 мин/.test(x)));assert.equal(f.ready('pet'),true);
 });
 await run('«кот пропал вне боя»: новое поколение отменяет прежнюю отметку «кот готов» — свежее чтение и призыв',async()=>{
  const f=setup({char:{activeSummon:{...CAT,activeBuffs:[{skillId:4699,level:1,expiresAtMs:1792000000000+600000}]}}});
  f.e.petBuffGuess=()=>[{effectId:4699,name:'Summon Feline Queen'}];
  assert.equal(await f.prep({buffs:true}),false);assert.equal(f.ready('pet'),true);const g=f.gets.length;
  f.ch.revision++;f.ch.activeSummon=null;f.e.rt.startPrep={id:3,phase:'summon',resets:1};
  assert.equal(f.ready('summon'),false,'старая отметка не действует');
  assert.equal(await f.prep({buffs:false}),true);assert.equal(f.gets.length,g+1,'сервер прочитан заново');assert.deepEqual(f.nav,['/skill-panel.html']);
 });
 await run('отказ прошлой подготовки (failed) не пропускает подготовку нового поколения',async()=>{
  const f=setup({char:{activeSummon:null},rt:{petPrep:{char:'hero',classKey:'0:arcana_lord',gen:1,buffs:false,back:'/map.html',pending:null,t:1792000000000-130000}}});
  assert.equal(await f.prep({buffs:false}),false);assert.equal(f.ready('pet'),true);
  f.e.rt.startPrep={id:4,phase:'summon'};assert.equal(f.ready('pet'),false);assert.equal(await f.prep({buffs:false}),true);assert.deepEqual(f.nav,['/skill-panel.html']);
 });
 // content.js: этапы подготовки
 const block=content.slice(content.indexOf('const START_PREP_MS'),content.indexOf('// Сторож баффов, обслуживание рыбы'));
 function load(o={}){
  let now=1792000000000;const calls=[],steps=[];
  const W={startPrepare:async()=>false,startReady:()=>true,step:async x=>{steps.push(x);calls.push('step');return o.step?.(x)??false}};
  const sb={console,Date:class extends Date{static now(){return now}},Object,JSON,
   cfg:{autoTasks:['cat','petbuff'],petAuto:true,petFullAuto:true},rt:{char:'hero',classCur:{prof:'arcana_lord',slot:0},dailyStart:1,...o.rt},on:true,tabOwner:true,location:{pathname:'/map.html'},
   L2EngineCore:{selectedTask:()=> 'cat',taskAllowed:(c,k)=>(c.autoTasks||[]).includes(k)},autonomyMode:()=>'cat',
   L2V7Modules:{warlock:W,payments:{blocked:()=>false}},loopStale:()=>false,isBattle:()=>!!sb.battle,fishNow:()=>false,tvtSoon:()=>false,
   setRt:async p=>{Object.assign(sb.rt,p);return {ok:true}},rtCommit:async()=>true,rec:()=>{},setStatus:()=>{},townBuffStart:async()=>false,battle:!!o.battle};
  vm.createContext(sb);vm.runInContext(block+';this.loopStartPrep=loopStartPrep;this.prepHold=prepHold;',sb);
  return {sb,W,calls,steps,tick:n=>now+=n,phase:()=>sb.rt.startPrep?.phase};
 }
 await run('платный набор кота: свежее чтение только при первом заходе этапа, дальше — пауза step',async()=>{
  const t=load({rt:{startPrep:{char:'hero',classKey:'0:arcana_lord',start:1,task:'cat',phase:'pet',t:1792000000000,id:1}},step:x=>!!x.forceRead});
  assert.equal(await t.sb.loopStartPrep(),true);assert.equal(t.steps[0].forceRead,true);assert.equal(t.sb.rt.startPrep.paid,1);
  assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.steps[1].forceRead,false,'второй тик без forceRead');assert.equal(t.phase(),'done');
 });
 await run('в бою подготовка не заводится; первый тик вне боя — с призыва и свежим сроком',async()=>{
  const t=load({battle:true});assert.equal(await t.sb.loopStartPrep(),false);assert.equal(t.sb.rt.startPrep,undefined);
  t.tick(300000);t.sb.battle=false;await t.sb.loopStartPrep();assert.equal(t.phase(),'self','кот готов — баффы героя, без таймаута');
  assert.ok(t.sb.rt.startPrep.id>0);assert.equal(t.sb.rt.startPrep.t,1792000000000+300000,'срок этапа — с первого тика вне боя');
 });
 await run('исходник: «кот пропал вне боя» даёт новое поколение; сторож тура РБ — после призыва',async()=>{
  assert.ok(content.includes("setRt({ startPrep: { ...S, phase: 'summon', t: Date.now(), id: Date.now(), paid: 0, resets: (+S.resets || 0) + 1, resetT: Date.now() } })"));
  const town=content.slice(content.indexOf('async function loopTownJobs()'),content.indexOf('async function loopSideJobs()'));
  const a=town.indexOf("autonomyMode() === 'raid' && !rt.petRaidPrep && await L2V7Modules.warlock.raidPrepare({ buffs: false })"),b=town.indexOf("townBuffStart('сторож: баффы слетели')");
  assert.ok(a>0&&a<b);
 });
 console.log(passed+' сценариев PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
