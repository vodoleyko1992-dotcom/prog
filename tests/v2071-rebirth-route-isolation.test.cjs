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

function victoryFixture(){
 const f=fixture(),title={textContent:'Rebirth · Wyrm · ур.35'},win={},hunt={hidden:false,disabled:false},q=f.env.$q;
 f.ch.inBattle=false;f.env.cfg.chain=false;f.env.victory=()=>true;f.env.battleInfo=()=>({t:f.now(),spawn:sid(),name:'Rebirth · Wyrm'});
 f.env.$q=s=>s==='#battle-mob-title'?title:s==='#battle-victory-inline'?win:s==='#battle-victory-hunt'?hunt:q(s);
 f.env.evidenceOwner=()=> 'owner';f.env.scanContext=()=> 'scan';f.env.pvpPending=()=>false;f.env.antibotState=()=>false;
 f.env.tvtSoon=()=>false;f.env.tvtHoldWait=async()=>false;f.env.actionWait=async valid=>valid();f.env.waitFor=async valid=>valid();
 f.env.fire=b=>{assert.equal(b,hunt);f.clicks.push('hunt');return true;};f.env.rebirthReturn=async valid=>{if(valid())f.location.href='/rebirth-raids.html';};
 return{...f,hunt,ctx:{name:'Rebirth · Wyrm',spawnId:sid()}};
}

test('отдельное продолжение Rebirth не зависит от общей галки chain и не повторяет неизвестный клик',async()=>{
 const f=victoryFixture();await f.api().nextFight(f.ctx);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.reads.length,2);
 await f.api().nextFight(f.ctx);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);
});

test('обычная охота не продолжает Rebirth и потеря нативной кнопки возвращает к собственному походу',async()=>{
 const off=victoryFixture();off.S.mode='farm';await off.api().nextFight(off.ctx);assert.equal(off.reads.length,0);assert.equal(off.clicks.length,0);
 const missing=victoryFixture();missing.hunt.hidden=true;await missing.api().nextFight(missing.ctx);assert.equal(missing.location.pathname,'/rebirth-raids.html');assert.equal(missing.clicks.length,0);
});
