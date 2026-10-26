'use strict';
// 20.65 (лог 26.10 12:55:55–12:58:13): Пауза застала hunt-continue, затем Старт в почте держал живой бой на подготовке кота.
// Фабрика Warlock и настоящая функция сверки из content.js; все ответы локальные, ни одного запроса в игру.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const source=content.match(/async function resumeStartBattle\([^]*?\n\}/)?.[0];
assert.ok(source,'ядро предоставляет сверку и возврат в подтверждённый активный бой');
const SID='ashen_bastion_mob_192',URL='/battle.html?spawnId='+SID;
const copy=x=>JSON.parse(JSON.stringify(x));
function world(o={}){
 const f=fixture({cfg:{petAuto:true,petBuffAuto:true,petFullAuto:false},rt:{classCur:{prof:'human_arcana_lord',slot:0},manualKickAt:7,startPrep:{id:1}},
  char:{id:'hero-id',l2Profession:'human_arcana_lord',battleSpawnId:SID,inBattle:true,...o.char},read:async()=>{await o.duringInitial?.(w)}});
 const e=f.env,state={href:'https://l2wap.com/mail.html',hero:'hero',allowed:true,stamp:1,antibot:null,ab:false,tvt:false,pvp:false,canAct:true},nav=[],order=[],reads=[],statuses=[],recs=[];
 e.nativePanelPath=()=>location.pathname;e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>state.canAct;e.startPrepWanted=()=>true;e.raidWanted=()=>true;e.heroNick=()=>state.hero;
 e.setStatus=t=>statuses.push(t);e.rec=(...a)=>recs.push(a);e.nativeFire=()=>{throw Error('вне боя навык не нажимается при восстановлении активного боя')};
 const location={get href(){return state.href},set href(v){nav.push(v);state.href=new globalThis.URL(v,'https://l2wap.com').href},get pathname(){return new globalThis.URL(state.href).pathname}};
 const proof={character:{...copy(f.ch),revision:f.ch.revision+1},battle:{spawnId:SID,mobHp:267261,mobMaxHp:267261,ended:false,battleMode:'pve',kind:'normal'},...o.proof};
 const box={console,Date:class extends Date{static now(){return f.now()}},URL:globalThis.URL,encodeURIComponent,location,
  automationSnapshot:()=>state.stamp,automationCurrent:s=>s===state.stamp,heroNick:()=>state.hero,
  startPrepProf:()=>String(e.rt.classCur?.prof||e.rt.prof||'').trim().toLowerCase().replace(/[ -]+/g,'_').replace(/^human_/,''),
  isBattle:()=>location.pathname==='/battle.html',abHold:()=>state.ab,antibotState:()=>state.antibot,tvtSoon:()=>state.tvt,
  L2V7Modules:{actions:{canAct:()=>state.canAct},pvp:{pending:()=>state.pvp}},setStatus:t=>statuses.push(t),rec:(...a)=>recs.push(a),
  rtCommit:async()=>{order.push('commit');await o.during?.('commit',w);return o.durable!==false},
  gameGet:async(p,ms)=>{order.push('get');reads.push({path:p,ms});await o.during?.('get',w);return {ok:o.httpOk!==false,status:o.httpOk===false?503:200,json:async()=>{order.push('json');await o.during?.('json',w);return proof}}}};
 for(const k of ['rt','on','tabOwner','leaseEpoch'])Object.defineProperty(box,k,{get:()=>e[k]});
 vm.createContext(box);vm.runInContext(source,box);
 const w={...f,e,state,nav,order,reads,statuses,recs,proof,box,location,
  resume:valid=>box.resumeStartBattle(f.ch,valid||(()=>state.allowed)),prep:o=>f.api().startPrepare(o)};
 e.resumeStartBattle=(ch,valid)=>box.resumeStartBattle(ch,valid);
 return w;
}
let passed=0;
const run=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
(async()=>{
 await run('Старт в почте + живой кот + серверный бой192: flush → свежая сверка → точный URL, без нового боя',async()=>{
  const w=world();assert.equal(await w.prep({buffs:false}),true);assert.deepEqual(w.nav,[URL]);assert.deepEqual(w.order,['commit','get','json']);
  assert.deepEqual(w.gets,['/character']);assert.equal(w.reads.length,1);
  const q=new globalThis.URL(w.reads[0].path,'https://l2wap.com');assert.equal(q.pathname,'/game/battle');assert.equal(q.searchParams.get('characterId'),'hero-id');assert.equal(q.searchParams.get('spawnId'),SID);
  assert.equal(w.calls.length,0);assert.equal(w.e.rt.petPrep,undefined,'подготовка и перепризыв не начинаются перед возвратом');
 });
 await run('нет исходного доказательства: без ID, spawn, ревизии или собственных героя/класса/слота переход закрыт',async()=>{
  const changes=[ch=>delete ch.id,ch=>ch.id='',ch=>delete ch.battleSpawnId,ch=>ch.battleSpawnId='',ch=>ch.battleSpawnId='../other',ch=>delete ch.revision,ch=>ch.revision=NaN,ch=>ch.name='other',ch=>ch.l2Profession='human_sorcerer',ch=>ch.classSlots.activeSlot=1,ch=>ch.inBattle=false];
  for(const change of changes){const w=world();change(w.ch);assert.equal(await w.resume(),false);assert.deepEqual(w.nav,[]);assert.equal(w.calls.length,0);}
 });
 await run('отсутствующий или некорректный собственный слот не подтверждается совпадением undefined',async()=>{
  for(const slot of [undefined,-1,0.5,'0']){const w=world();w.e.rt.classCur.slot=slot;w.ch.classSlots.activeSlot=slot;w.proof.character.classSlots.activeSlot=slot;assert.equal(await w.resume(),false);assert.deepEqual(w.nav,[]);}
 });
 await run('свежая сверка: ended/victory/defeat/чужой/старая ревизия/другой spawn/ошибка не открывают бой',async()=>{
  const changes=[d=>d.victory={},d=>d.defeat={},d=>d.error='read_failed',d=>d.ok=false,d=>d.battle.ended=true,d=>d.battle.finished=true,d=>d.battle.status='ended',d=>d.battle.state='ended',d=>d.battle.mobHp=0,d=>d.battle.spawnId='other',d=>delete d.battle,d=>delete d.character,
   d=>d.character.name='other',d=>d.character.id='other-id',d=>d.character.l2Profession='human_sorcerer',d=>d.character.classSlots.activeSlot=1,d=>d.character.revision=99,d=>delete d.character.revision,d=>d.character.inBattle=false,d=>d.character.battleSpawnId='ashen_bastion_mob_193'];
  for(const change of changes){const w=world();change(w.proof);assert.equal(await w.resume(),false);assert.deepEqual(w.nav,[]);assert.equal(w.calls.length,0);}
 });
 await run('явный PvP/TvT в исходном снимке, character, battle или ответе не становится PvE-переходом',async()=>{
  for(const where of ['initial','character','battle','reply'])for(const flag of ['pvp','isPvp','inPvp','tvt','isTvt','inTvt']){
   const w=world(),target=where==='initial'?w.ch:where==='reply'?w.proof:w.proof[where];target[flag]=true;
   assert.equal(await w.resume(),false,where+'/'+flag);assert.deepEqual(w.nav,[]);
  }
  for(const mode of ['pvp','tvt']){const w=world();w.proof.battle.battleType=mode;assert.equal(await w.resume(),false,'battleType/'+mode);assert.deepEqual(w.nav,[]);}
  for(const where of ['initial','character','battle','reply'])for(const key of ['mode','kind','type','battleMode'])for(const value of ['pvp','tvt_arena']){
   const w=world(),target=where==='initial'?w.ch:where==='reply'?w.proof:w.proof[where];target[key]=value;
   assert.equal(await w.resume(),false,where+'/'+key+'/'+value);assert.deepEqual(w.nav,[]);
  }
 });
 await run('Stop, владелец, lease, kick, страница, герой, класс и защитные запреты перепроверяются после каждого await',async()=>{
  const changes={stop:w=>w.e.on=false,owner:w=>w.e.tabOwner=false,lease:w=>w.e.leaseEpoch='other',kick:w=>w.e.rt.manualKickAt++,page:w=>w.state.href='https://l2wap.com/char.html',
   actor:w=>w.e.rt.char='other',hero:w=>w.state.hero='other',class:w=>w.e.rt.classCur.slot=1,antibot:w=>w.state.antibot='check',abHold:w=>w.state.ab=true,canAct:w=>w.state.canAct=false,tvt:w=>w.state.tvt=true,pvp:w=>w.state.pvp=true,valid:w=>w.state.allowed=false};
  for(const stage of ['commit','get','json'])for(const[name,change]of Object.entries(changes)){
   const w=world({during:(point,w)=>{if(point===stage)change(w)}});assert.equal(await w.resume(),false,stage+'/'+name);assert.deepEqual(w.nav,[],stage+'/'+name);assert.equal(w.calls.length,0);
   if(stage==='commit')assert.equal(w.reads.length,0,'отмена flush запрещает следующую сверку');
  }
 });
 await run('Stop/lease/kick/page во время первоначального GET character запрещают даже следующую сверку боя',async()=>{
  for(const change of [w=>w.e.on=false,w=>w.e.tabOwner=false,w=>w.e.leaseEpoch='other',w=>w.e.rt.manualKickAt++,w=>w.state.href='https://l2wap.com/char.html',w=>w.e.rt.char='other']){
   const w=world({duringInitial:change});assert.equal(await w.prep({buffs:false}),true);assert.deepEqual(w.nav,[]);assert.equal(w.reads.length,0);assert.equal(w.calls.length,0);
  }
 });
 await run('исключение на flush, GET или разборе JSON не разрешает переход',async()=>{
  for(const stage of ['commit','get','json']){const w=world({during:point=>{if(point===stage)throw Error('local-fixture-timeout')}});assert.equal(await w.resume(),false);assert.deepEqual(w.nav,[]);assert.equal(w.calls.length,0);}
 });
 await run('неуспешный flush или HTTP закрывает переход; не полученная сверка держит backoff',async()=>{
  const uncommitted=world({durable:false});assert.equal(await uncommitted.resume(),false);assert.equal(uncommitted.reads.length,0);assert.deepEqual(uncommitted.nav,[]);
  const unavailable=world({httpOk:false});assert.equal(await unavailable.resume(),false);assert.deepEqual(unavailable.nav,[]);
  const w=world({proof:{battle:{spawnId:'other'}}});assert.equal(await w.prep({buffs:false}),true);assert.ok(w.statuses.some(x=>/бой|свер|подтверж/.test(x)),'неподтверждённый бой имеет понятный статус');
  const initialReads=w.gets.length;await w.prep({buffs:false});assert.equal(w.gets.length,initialReads,'повторный круг соблюдает паузу после неподтверждённого боя');assert.deepEqual(w.nav,[]);assert.equal(w.calls.length,0);
 });
 await run('inBattle=false с живым котом сохраняет обычную подготовку, а тур РБ не вызывает возврат Старта',async()=>{
  const idle=world({char:{inBattle:false}});assert.equal(await idle.prep({buffs:false}),false);assert.deepEqual(idle.nav,[]);assert.equal(idle.reads.length,0);assert.equal(idle.api().startReady('summon'),true);
  const raid=world();assert.equal(await raid.api().raidPrepare({buffs:false}),true);assert.equal(raid.reads.length,0);assert.deepEqual(raid.nav,[]);assert.equal(raid.calls.length,0);
 });
 console.log('PASS v2065-start-active-battle: '+passed+' групп проверок');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
