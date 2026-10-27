'use strict';
// 20.71: сценарии отдельного допуска и продолжения Rebirth. По просьбе сборки без проверок здесь не запускались.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2068-rebirth-runtime.test.cjs'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.fixture=fixture;',box);
const RUN='11111111-1111-4111-8111-111111111111';
const sid=(role='mob',id=25098,n=role==='raid'?3:1)=>'rebirth_raid_'+RUN+'_2_1_'+id+'_lv35_'+role+'_'+n;
function fixture(role='mob'){
 const f=box.fixture({page:'/battle.html?spawnId='+sid(role)}),name=role==='champion'?'Rebirth Champion · Wyrm':role==='raid'?'Rebirth Sejarr’s Servitor':'Rebirth · Wyrm';
 f.ch.inBattle=true;f.ch.battleSpawnId=sid(role);f.env.autonomyMode=()=>f.S.mode||'rebirth';
 Object.assign(f.instance.activeRun,{phase:role==='mob'?'mobs':role==='champion'?'champion':'rb_active',mobKills:role==='mob'?2:300,
  ...(role==='raid'?{selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25098'}:{})});
 f.battle={spawnId:sid(role),mobName:name,mobLevel:35,mobHp:100,mobMaxHp:1000,kind:'dungeon',ended:false};
 f.env.gameGet=async url=>{f.reads.push(url);await f.S.hooks.read?.(url);return{ok:true,status:200,json:async()=>{await f.S.hooks.json?.(url);
  return structuredClone(url==='/character'?{character:f.ch}:url==='/game/rebirth-raids?view=instance'?f.instance:{character:f.ch,battle:f.battle});}};};
 f.prove=()=>f.api().battleProof({name,max:1000,title:name+' · ур.35',valid:()=>f.S.valid!==false});
 return f;
}

test('свой mob/champion/raid допускается по своему этапу, независимо от фильтров обычной охоты',async()=>{
 for(const role of ['mob','champion','raid']){
  const f=fixture(role);Object.assign(f.env.cfg,{champBlue:false,champOrange:false,champRed:false,chain:false,rbMode:false,searchChamp:false});
  const proof=await f.prove();assert.equal(proof.role,role);assert.equal(proof.spawn,sid(role));assert.equal(proof.runId,RUN);assert.equal(proof.current(),true);
  assert.equal(f.reads.length,3);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);assert.equal(f.S.keys,100);
  f.battle.mobHp=50;assert.equal(proof.current(),true,'нанесённый урон не отменяет собственный контекст боя');
 }
});

test('чужой run, неверный этап и неподтверждённый выбранный РБ не допускаются',async()=>{
 for(const [role,change] of [
  ['mob',f=>{f.instance.activeRun.participantCharacterIds=['other'];}],
  ['mob',f=>{f.instance.activeRun.partyId='party';}],
  ['mob',f=>{f.ch.battleSpawnId='dense_5598';}],
  ['champion',f=>{f.instance.activeRun.phase='mobs';}],
  ['champion',f=>{f.instance.activeRun.mobKills=299;}],
  ['raid',f=>{f.instance.activeRun.selectedBossSpawnId='l2dop_rb_25063';}],
  ['raid',f=>{f.instance.activeRun.selectedBossSlot=4;}],
  ['raid',f=>{f.instance.activeRun.selectedBossSlotEncoded=false;}]
 ]){const f=fixture(role);change(f);assert.equal(await f.prove(),null);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);}
});

test('нулевой encoded slot выбранного РБ допускается, нулевой номер mob/champion не допускается',async()=>{
 const raid=fixture('raid'),zero=sid('raid',25098,0);raid.ch.battleSpawnId=zero;raid.battle.spawnId=zero;raid.instance.activeRun.selectedBossSlot=0;
 const proof=await raid.prove();assert.equal(proof.role,'raid');assert.equal(proof.spawn,zero);assert.equal(raid.posts.length,0);
 for(const role of ['mob','champion']){const f=fixture(role);f.ch.battleSpawnId=sid(role,25098,0);f.battle.spawnId=f.ch.battleSpawnId;
  assert.equal(await f.prove(),null);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);}
});

test('неизвестный тип, завершённый бой и другое имя/HP не расширяют Rebirth-допуск',async()=>{
 for(const change of [f=>{f.battle.kind='unknown';},f=>{f.battle.ended=true;},f=>{f.battle.mobName='Other';},f=>{f.battle.mobMaxHp=1001;}]){
  const f=fixture('champion');change(f);assert.equal(await f.prove(),null);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);
 }
});

test('допуск прекращается после каждого await при Stop, смене класса, режима или DOM',async()=>{
 for(const url of ['/character','battle','/game/rebirth-raids?view=instance'])for(const change of [f=>{f.env.on=false;},f=>{f.env.rt.classCur.prof='other';},f=>{f.S.mode='farm';},f=>{f.S.valid=false;}]){
  const f=fixture('champion');f.S.hooks.json=p=>{if(p===url||url==='battle'&&p.startsWith('/game/battle?'))change(f);};
  assert.equal(await f.prove(),null);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);
 }
});

function victoryFixture(role='mob'){
 const f=fixture(role),name=f.battle.mobName,title={textContent:name+' · ур.35'},win={},hunt={hidden:false,disabled:false},q=f.env.$q;
 f.ch.inBattle=false;f.env.cfg.chain=false;f.env.victory=()=>true;f.env.battleInfo=()=>({t:f.now(),spawn:sid(role),name});
 f.env.$q=s=>s==='#battle-mob-title'?title:s==='#battle-victory-inline'?win:s==='#battle-victory-hunt'?hunt:q(s);
 f.env.evidenceOwner=()=> 'owner';f.env.scanContext=()=> 'scan';f.env.pvpPending=()=>false;f.env.antibotState=()=>false;
 f.env.tvtSoon=()=>false;f.env.tvtHoldWait=async()=>false;f.env.actionWait=async valid=>valid();f.env.waitFor=async valid=>valid();
 f.env.fire=b=>{assert.equal(b,hunt);f.clicks.push('hunt');return true;};f.env.rebirthReturn=async valid=>{if(valid())f.location.href='/rebirth-raids.html';};
 return{...f,hunt,ctx:{name,spawnId:sid(role)}};
}

test('отдельное продолжение Rebirth не зависит от общей галки chain и не повторяет неизвестный клик',async()=>{
 const f=victoryFixture();await f.api().nextFight(f.ctx);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.reads.length,2);
 await f.api().nextFight(f.ctx);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);
});

test('обычная охота не продолжает Rebirth и потеря нативной кнопки возвращает к собственному походу',async()=>{
 const off=victoryFixture();off.S.mode='farm';await off.api().nextFight(off.ctx);assert.equal(off.reads.length,0);assert.equal(off.clicks.length,0);
 const missing=victoryFixture();missing.hunt.hidden=true;await missing.api().nextFight(missing.ctx);assert.equal(missing.location.pathname,'/rebirth-raids.html');assert.equal(missing.clicks.length,0);
});

test('локальная отмена до native-клика не оставляет15с паузы на том же завершённом мобе',async()=>{
 for(const point of ['commit','characterGET','characterJSON','runGET','runJSON','save']){
  const f=victoryFixture(),before=f.now();let cancelled=false;
  const cancel=()=>{if(!cancelled){cancelled=true;f.S.generation=2;}};
  if(point==='commit'||point==='save')f.S.hooks[point]=cancel;
  else f.S.hooks[point.endsWith('GET')?'read':'json']=url=>{if(point.startsWith('character')?url==='/character':url==='/game/rebirth-raids?view=instance')cancel();};
  await f.api().nextFight(f.ctx);assert.equal(cancelled,true,point);assert.equal(f.clicks.length,0,point);assert.equal(f.storage.has('l2bot.rebirth-next'),false,point);
  const reads=f.reads.length;f.S.hooks={};await f.api().nextFight(f.ctx);
  assert.equal(f.now(),before,'повтор без продвижения часов');assert.equal(f.reads.length,reads+2,point);assert.equal(f.clicks.filter(x=>x==='hunt').length,1,point);assert.equal(f.posts.length,0);
 }
});

test('обновившаяся metadata победы после GET отменяет только старый probe без15с паузы',async()=>{
 const f=victoryFixture();f.env.battleInfo=()=>({t:f.now()-1+(f.S.metaRevision||0),spawn:sid(),name:f.ctx.name});
 f.S.hooks.json=url=>{if(url==='/character')f.S.metaRevision=1;};
 await f.api().nextFight(f.ctx);assert.equal(f.reads.length,1);assert.equal(f.clicks.length,0);
 f.S.hooks={};await f.api().nextFight(f.ctx);assert.equal(f.reads.length,3);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.posts.length,0);
});

test('локальная ошибка flush не маскируется серверным backoff, durable receipt после fire сохраняется',async()=>{
 const local=victoryFixture();let failing=true;local.env.rtCommit=async()=>{if(failing)throw Error('локальная запись');return true;};
 await local.api().nextFight(local.ctx);assert.equal(local.reads.length,0);assert.equal(local.clicks.length,0);
 failing=false;await local.api().nextFight(local.ctx);assert.equal(local.reads.length,2);assert.equal(local.clicks.filter(x=>x==='hunt').length,1);
 const sent=victoryFixture();sent.env.waitFor=async()=>{sent.S.generation=2;return true;};
 await sent.api().nextFight(sent.ctx);assert.equal(sent.clicks.filter(x=>x==='hunt').length,1);const receipt=sent.storage.get('l2bot.rebirth-next');
 sent.tick(120000);await sent.api().nextFight(sent.ctx);assert.equal(sent.clicks.filter(x=>x==='hunt').length,1);assert.equal(sent.storage.get('l2bot.rebirth-next'),receipt);
});

test('настоящие HTTP/JSON отказы и серверное несовпадение сохраняют ограниченный backoff',async()=>{
 for(const kind of ['http','throw','json','identity']){
  const f=victoryFixture(),get=f.env.gameGet;let failing=true;
  f.env.gameGet=async url=>{const r=await get(url);if(url!=='/character'||!failing)return r;
   if(kind==='http')return{...r,ok:false,status:503};if(kind==='throw')throw Error('read failed');
   if(kind==='json')return{...r,json:async()=>{throw Error('bad JSON');}};
   return{...r,json:async()=>({character:{...f.ch,name:'Other'}})};
  };
  await f.api().nextFight(f.ctx);assert.equal(f.reads.length,1,kind);assert.equal(f.clicks.length,0,kind);failing=false;
  const wait=kind==='identity'?15000:60000;f.tick(wait-1);await f.api().nextFight(f.ctx);assert.equal(f.reads.length,1,kind+' до срока нет GET');
  f.tick(1);await f.api().nextFight(f.ctx);assert.equal(f.reads.length,3,kind);assert.equal(f.clicks.filter(x=>x==='hunt').length,1,kind);assert.equal(f.posts.length,0);
 }
});

test('поздняя ошибка старого probe не снимает backoff нового завершённого моба',async()=>{
 const f=victoryFixture(),get=f.env.gameGet;let calls=0,release,started;
 const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);
 f.env.battleInfo=()=>({t:f.now(),spawn:f.S.after||sid(),name:f.ctx.name});
 f.env.gameGet=async url=>{if(url==='/character'){
  calls++;if(calls===1){f.reads.push(url);started();await gate;throw Error('старый ответ');}
  if(calls===2){f.reads.push(url);return{ok:false,status:503};}
 }return get(url);};
 const old=f.api().nextFight(f.ctx);await began;f.S.after=sid('mob',25098,2);f.ctx.spawnId=f.S.after;f.location.href='https://l2wap.com/battle.html?spawnId='+f.S.after;
 await f.api().nextFight(f.ctx);assert.equal(f.reads.length,2);release();await old;
 await f.api().nextFight(f.ctx);assert.equal(f.reads.length,2,'старый probe не сбросил ограничение нового');assert.equal(f.clicks.length,0);
 f.tick(60000);await f.api().nextFight(f.ctx);assert.equal(f.reads.length,4);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.posts.length,0);
});

test('busy по-прежнему удерживает два одновременных продолжения одной победы',async()=>{
 const f=victoryFixture();let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);
 f.S.hooks.read=async url=>{if(url==='/character'){started();await gate;}};
 const first=f.api().nextFight(f.ctx);await began;await f.api().nextFight(f.ctx);assert.equal(f.reads.length,1);assert.equal(f.clicks.length,0);
 release();await first;assert.equal(f.reads.length,2);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.posts.length,0);
});

test('новый чемпион/РБ и нехватка баффа возвращают к собственной подготовке, победа РБ сохраняет native next',async()=>{
 for(const phase of ['champion','rb_active','mobs']){
  const f=victoryFixture();Object.assign(f.instance.activeRun,{phase,mobKills:phase==='mobs'?2:300,
   ...(phase==='rb_active'?{selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25098'}:{})});
  f.env.needsPetPreparation=()=>phase==='mobs';await f.api().nextFight(f.ctx);
  assert.equal(f.location.pathname,'/rebirth-raids.html',phase);assert.equal(f.clicks.length,0,phase);assert.equal(f.posts.length,0);
 }
 const raid=victoryFixture('raid');raid.env.needsPetPreparation=()=>true;await raid.api().nextFight(raid.ctx);
 assert.equal(raid.clicks.filter(x=>x==='hunt').length,1,'после самого РБ продолжается native next:none');assert.equal(raid.posts.length,0);
});

test('свой prepareRun до native fight удерживает бой и отменяется при смене владельца',async()=>{
 for(const cancel of [false,true]){
  const f=box.fixture({page:'/rebirth-raids.html'});let calls=0;
  f.env.prepareRun=async()=>{calls++;if(cancel)f.env.tabOwner=false;return true;};
  await f.step();assert.equal(calls,1);assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.keys,100);
 }
});
