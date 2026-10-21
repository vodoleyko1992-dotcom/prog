'use strict';
// 20.43 (лог 21.10 15:47–15:51): после Старта котовод — призыв кота → баффы героя → баффы кота → задача; без вечных ожиданий.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
let passed=0;
const run=async(name,f)=>{await f();passed++;console.log('PASS '+name)};
const CAT={kind:'servitor',key:'feline_king',summonSkillId:1406,summonSkillLevel:3,hp:100,activeBuffs:[]};
function setup(o={}){
 const f=fixture({cfg:{petFullAuto:false,petAuto:true,petBuffAuto:true,nPetBuffs:'Summon Feline Queen, Warrior Servitor, Final Servitor',...o.cfg},char:{mp:5000,l2Profession:'arcana_lord',...o.char},rt:{classCur:{prof:'arcana_lord',slot:0},...o.rt}});
 const e=f.env;let page=o.page||'/dungeon.html?dungeonId=x',fires=[],nav=[],logs=[],wanted=true;
 e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>true;e.startPrepWanted=()=>wanted;e.raidWanted=()=>false;
 e.setStatus=t=>logs.push(t);e.rec=(...x)=>logs.push(x.join(' '));e.classNote=()=>{};
 const row=(id,name)=>({action:'l2_'+id,skillId:id,effectId:id===1331?4699:id,name,mp:10,ready:true,button:{id}});
 const panel={summon:row(1406,'Summon Feline King'),buffs:[row(1331,'Summon Feline Queen'),row(1346,'Warrior Servitor'),row(1349,'Final Servitor')]};
 e.nativePanel=()=>panel;e.nativePanelPath=()=>page.split('?')[0];e.nativeReturnPath=()=>page;e.nativePanelOpen=async()=>{};
 e.nativeNavigate=p=>{nav.push(p);page=p};e.nativeFire=b=>{fires.push(b.id);return true};
 return {...f,e,panel,fires,nav,logs,page:()=>page,want:v=>wanted=v,
  prep:o=>f.api().startPrepare(o),ready:p=>f.api().startReady(p),
  born:()=>{f.ch.revision++;f.ch.activeSummon={...CAT,activeBuffs:[]}},
  effect:id=>{f.ch.revision++;f.ch.activeSummon.activeBuffs.push({skillId:id,level:1,expiresAtMs:f.now()+120000})}};
}
(async()=>{
 await run('Arcana Lord без кота: только призыв на родной панели и возврат в подземелье',async()=>{
  const f=setup({char:{activeSummon:null}});
  assert.equal(await f.prep({buffs:false}),true);assert.deepEqual(f.nav,['/skill-panel.html']);assert.equal(f.fires.length,0);assert.equal(f.e.rt.petPrep.back,'/dungeon.html?dungeonId=x');assert.equal(f.e.rt.petPrep.buffs,false);
  await f.prep();assert.deepEqual(f.fires,[1406]);assert.equal(f.e.rt.petPrep.pending.kind,'summon');
  await f.prep();assert.deepEqual(f.fires,[1406],'без свежей ревизии не повторяет');
  f.born();await f.prep();
  assert.deepEqual(f.fires,[1406],'баффы кота на этапе призыва не ставятся');assert.equal(f.page(),'/dungeon.html?dungeonId=x');assert.equal(f.e.rt.petPrep,null);
  assert.equal(f.ready('summon'),true);assert.equal(f.ready('pet'),false);assert.equal(f.calls.length,0);
  assert.ok(f.e.rt.petBornT>0);assert.ok(f.logs.some(x=>/Старт: Summon Feline King/.test(x)));
 });
 await run('баффы кота после призыва: Queen → Warrior → Final строго по подтверждению',async()=>{
  const f=setup({char:{activeSummon:{...CAT}}});
  await f.prep({buffs:true});assert.deepEqual(f.nav,['/skill-panel.html']);
  await f.prep({buffs:true});assert.deepEqual(f.fires,[1331]);f.effect(4699);
  await f.prep({buffs:true});assert.deepEqual(f.fires,[1331,1346]);f.effect(1346);
  await f.prep({buffs:true});assert.deepEqual(f.fires,[1331,1346,1349]);f.effect(1349);
  await f.prep({buffs:true});assert.equal(f.e.rt.petPrep,null);assert.equal(f.ready('pet'),true);assert.equal(f.e.rt.petRaidPrep,undefined,'задача тура РБ не затронута');
 });
 await run('готовый кот с баффами: один GET, без поездки (справочник эффектов)',async()=>{
  const f=setup({char:{activeSummon:{...CAT,activeBuffs:[4699,1346,1349].map(id=>({skillId:id,level:1,expiresAtMs:1792000000000+600000}))}}});
  f.e.petBuffGuess=()=>[{effectId:4699,name:'Summon Feline Queen'},{effectId:1346,name:'Warrior Servitor'},{effectId:1349,name:'Final Servitor'}];
  assert.equal(await f.prep({buffs:false}),false);assert.equal(f.ready('pet'),true);assert.equal(await f.prep({buffs:true}),false);
  assert.equal(f.gets.filter(x=>x==='/character').length,1);assert.equal(f.nav.length,0);assert.equal(f.fires.length,0);
 });
 await run('неподтверждённый призыв: 2 повтора, затем задача без вечного ожидания',async()=>{
  const f=setup({char:{activeSummon:null},page:'/skill-panel.html'});
  await f.prep({buffs:false});assert.deepEqual(f.fires,[1406]);
  for(let i=1;i<=2;i++){f.tick(16000);f.ch.revision++;assert.equal(await f.prep(),true);assert.equal(f.e.rt.petPrep.retries,i);assert.equal(f.e.rt.petPrep.pending,null);await f.prep();assert.equal(f.fires.length,i+1)}
  f.tick(16000);f.ch.revision++;assert.equal(await f.prep(),false);assert.equal(f.e.rt.petPrep,null);
  assert.ok(f.logs.some(x=>/не подтверждён сервером — повторю \(1\/2\)/.test(x)));assert.ok(f.logs.some(x=>/кот не подтверждён — начинаю задачу/.test(x)));
  assert.equal(f.ready('pet'),true,'отказ засчитан — задача идёт');assert.equal(await f.prep({buffs:true}),false);assert.equal(f.fires.length,3,'после отказа новых кастов нет');
 });
 await run('тур РБ по-прежнему не повторяет неподтверждённый каст',async()=>{
  const f=setup({char:{activeSummon:null},page:'/skill-panel.html'});f.e.raidWanted=()=>true;const raid=()=>f.api().raidPrepare();
  await raid();assert.deepEqual(f.fires,[1406]);f.tick(16000);f.ch.revision++;assert.equal(await raid(),true);assert.equal(await raid(),true);assert.deepEqual(f.fires,[1406]);assert.ok(f.e.rt.petRaidPrep.pending);
 });
 await run('нет отдельного баффа на панели: один раз в журнал и без него',async()=>{
  const f=setup({char:{activeSummon:{...CAT}},page:'/skill-panel.html'});f.panel.buffs.splice(1,1);f.panel.incomplete=true;f.panel.missing=['Warrior Servitor'];f.panel.hotbar=true;
  await f.prep({buffs:true});assert.deepEqual(f.fires,[1331]);f.effect(4699);await f.prep({buffs:true});assert.deepEqual(f.fires,[1331,1349]);f.effect(1349);
  assert.equal(await f.prep({buffs:true}),true);assert.equal(f.e.rt.petPrep,null);assert.equal(f.ready('pet'),true);
  assert.equal(f.logs.filter(x=>/на панели нет Warrior Servitor — пропускаю/.test(x)).length,1);
 });
 await run('панель не открылась: ждёт не дольше 10 с',async()=>{
  const f=setup({char:{activeSummon:null},page:'/skill-panel.html'});f.panel.incomplete=true;f.panel.hotbar=false;f.panel.summon=null;
  assert.equal(await f.prep({buffs:false}),true);assert.equal(await f.prep(),true);f.tick(11000);assert.equal(await f.prep(),false);assert.equal(f.fires.length,0);assert.equal(f.e.rt.petPrep,null);
 });
 await run('сохранённая задача старше 2 мин снимается без чтения сервера',async()=>{
  const f=setup({char:{activeSummon:null}});await f.prep({buffs:false});f.tick(121000);f.e.gameGet=async()=>{throw Error('нет сети')};
  assert.equal(await f.prep(),false);assert.equal(f.e.rt.petPrep,null);assert.ok(f.logs.some(x=>/не уложилась в 2 мин/.test(x)));
 });
 for(const gate of ['wanted','petAuto','orc_titan','autoLs','stop','owner'])await run('подготовка закрыта: '+gate,async()=>{
  const f=setup({char:{activeSummon:null,...(gate==='orc_titan'?{l2Profession:'orc_titan'}:{})},cfg:gate==='petAuto'?{petAuto:false}:{},rt:{...(gate==='orc_titan'?{classCur:{prof:'orc_titan',slot:0}}:{}),...(gate==='autoLs'?{autoLs:{hold:true}}:{})}});
  if(gate==='wanted')f.want(false);if(gate==='stop')f.e.on=false;if(gate==='owner')f.e.tabOwner=false;
  assert.equal(await f.prep({buffs:false}),false);assert.equal(f.nav.length,0);assert.equal(f.fires.length,0);assert.equal(f.gets.length,0);
 });
 await run('Stop/смена Старта между GET и кликом запрещают призыв',async()=>{
  for(const k of ['on','kick','lease']){const f=setup({char:{activeSummon:null},page:'/skill-panel.html'});f.e.nativePanelOpen=async()=>{if(k==='on')f.e.on=false;if(k==='kick')f.e.rt.manualKickAt=99;if(k==='lease')f.e.leaseEpoch='other'};await f.prep({buffs:false});assert.equal(f.fires.length,0,k)}
 });
 // content.js: возврат в подземелье/рыбалку, getter и панель для Старта.
 const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 await run('nativeReturnPath сохраняет /dungeon.html?dungeonId',async()=>{
  const m=content.match(/get nativeReturnPath\(\)\{return \(\)=>(\/\^.*?\$\/)\.test/);assert(m);const re=eval(m[1]);
  assert.ok(re.test('/dungeon.html'));assert.ok(re.test('/fishing.html'));assert.ok(re.test('/map.html'));assert.ok(!re.test('/battle.html'));
  assert.ok(content.includes('get startPrepWanted(){return startPrepWanted}'));assert.ok(content.includes('get petBuffGuess(){return warlockPetBuffGuess}'));
  assert.ok(/return \{summon,buffs,missing,hotbar,incomplete:!hotbar\|\|missing\.length>0\}/.test(content));
 });
 console.log(passed+' сценариев PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
