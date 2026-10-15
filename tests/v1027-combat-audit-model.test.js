'use strict';
// 15.10, аудит: native входящие удары, вероятность добивания и подтверждённая потеря Queen.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..');
function fixture(){
 let now=100000,rid=0;const rt={classCur:{prof:'human_warlock'},char:'Hero'};
 const box={Date:{now:()=>now},URLSearchParams};vm.runInNewContext(fs.readFileSync(root+'/modules/fightlab.js','utf8'),box);
 const env={rt,cfg:{},mobTitle:()=>'',actName:()=> 'Blaze',setRt:async p=>Object.assign(rt,p)};
 const lab=box.L2V7Factories.fightlab(env);
 const send=(path,bt,action='l2_1220',status=200)=>{now+=1000;return lab.onNet(path,{rid:++rid,status,req:{action},res:{},bt:{actor:'Hero',actorId:'hero',name:'Boss',spawn:'l2dop_rb_fixture',kind:'raid',log:[],...bt}})};
 const start=()=>send('/game/battle/start',{mob:10000,mobMax:10000,seq:1});
 return {lab,rt,start,send};
}
test('native Zakaron ordinary/critical incoming hits reach exact turn and persisted P90 samples',()=>{
 const f=fixture();f.start();
 const t=f.send('/game/battle/action',{mob:9000,seq:2,log:['[Boss] ударив тебе — −138 HP.','[Boss] ударив тебе (крит!) — −283 HP.','Полум’я 1000','Слуга [Cat] атакує [Boss]: 300 урону.']});
 assert.equal(t.hitIn,421);assert.equal(t.own,1000);assert.equal(t.pet,300);f.lab.finish('left');
 assert.deepEqual(Array.from(f.lab.recall('rb:l2dop_rb_fixture').h),[138,283]);
});
test('known misses lower one-shot probability and mean; unknown/rejected actions do not invent zeros',()=>{
 const f=fixture();f.start();let seq=1;
 for(let i=0;i<4;i++)f.send('/game/battle/action',{mob:9000,seq:++seq,log:['Полум’я 1200']});
 for(let i=0;i<4;i++)f.send('/game/battle/action',{mob:9000,seq:++seq,log:['[Hero] промахнувся.']});
 for(let i=0;i<4;i++)f.send('/game/battle/action',{mob:9000,seq:++seq,log:[]});
 f.send('/game/battle/action',{mob:9000,seq:++seq,log:['[Hero] промахнувся.']},'l2_1220',409);
 assert.equal(f.lab.killP('Blaze',1000),0.5);assert.equal(f.lab.dmgOn('Blaze').mean,600);
 f.lab.finish('left');f.start();assert.equal(f.lab.killP('Blaze',1000),0.5,'the same probability survives finish/new fight');
 assert.equal(f.lab.recall('rb:l2dop_rb_fixture').a.blaze.unknown,4);
});
test('positive hits plus confirmed misses form a bounded recent window',()=>{
 const f=fixture();f.start();let seq=1;
 for(let i=0;i<12;i++)f.send('/game/battle/action',{mob:9000,seq:++seq,log:['Полум’я 1200']});
 for(let i=0;i<12;i++)f.send('/game/battle/action',{mob:9000,seq:++seq,log:['[Hero] промахнувся.']});
 assert.equal(f.lab.killP('Blaze',1000),0);assert.equal(f.lab.dmgOn('Blaze').mean,0);
});
const {flowFixture}=require('./warlock-combat-fixture.cjs');
test('Queen fresh missing beats local timer; confirmed present and unknown keep anti-repeat protection',()=>{
 const f=flowFixture('pet');f.env.petState=()=>({t:Date.now(),has:true,key:'kai_the_cat',hp:1000,maxHp:1000});
 f.env.cfg.nPetBuffs='Summon Feline Queen';f.env.cfg.petBuffAuto=true;
 f.env.slotAction=b=>b.title==='Summon Feline Queen'?'l2_1331':'other';
 f.env.rt.petBornT=Date.now()-600000;f.env.rt.petBuffAt={'summon feline queen':Date.now()-180000};
 let state=false;f.env.warlock={petBuffState:()=>state};
 const pick=()=>f.combat.petBuffPick({block:{}},{pct:100},{cur:10000},{cur:100000});
 assert.equal(pick()?.b.title,'Summon Feline Queen','confirmed missing effect must be restored after Cancel');
 state=true;assert.equal(pick(),null,'fresh successful rebuff stops further actions');
 state=null;assert.equal(pick(),null,'unknown snapshot retains local twenty-minute guard');
 f.env.cfg.petBuffAuto=false;state=false;assert.equal(pick(),null,'manual toggle remains authoritative');
});
test('actual mage rotation retains measured zero instead of optimistic global damage/IL power',()=>{
 const f=flowFixture('mage');f.env.cfg.mageProbe=false;f.env.ilOf=()=>({c:'Маг. атака',t:'MDAM',mp:20,pow:99999});
 f.env.fightDmgOn=()=>({n:12,mean:0,p20:0,p50:0});f.env.fightKillP=()=>0;f.env.expDmg=()=>99999;
 const p=f.combat.magePlan({block:{}},{cur:1000,max:1000});
 assert.equal(p?.name,'Blaze');assert.equal(p.dmg,0);assert.doesNotMatch(p.why,/добива/);
});
for(const changed of ['class','character','slot'])test('unfinished fight cannot contaminate new '+changed+' after runtime reconfiguration',()=>{
 const f=fixture();f.start();f.send('/game/battle/action',{mob:8800,seq:2,log:['Полум’я 1200']});
 if(changed==='class')f.rt.classCur={prof:'human_dark_avenger',slot:0};
 if(changed==='character')f.rt.char='Other';
 if(changed==='slot')f.rt.classCur={...f.rt.classCur,slot:1};
 f.rt.fightMem={};
 assert.equal(f.lab.turnFor('Blaze',0),null,'old exact turn is no longer this owner');
 assert.equal(f.lab.damageFor('Boss','l2dop_rb_fixture'),null);
 f.start();assert.equal(f.lab.recall('rb:l2dop_rb_fixture'),null,'fresh start must not finish old fight into new memory');
});
const {fixture:warlockFixture}=require('./warlock-fixture.cjs');
test('Warlock stale revision cannot erase newer pet Queen or overwrite hero/raid context',()=>{
 const f=warlockFixture(),a=f.api();Object.assign(f.ch,{mAtk:10000,pAtk:1000,pDef:1000,mDef:1000,maxHp:10000,activeBuffs:[]});f.env.shotContext=()=> 'shots:on';
 const old=JSON.parse(JSON.stringify(f.ch));f.ch.revision++;
 f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+1200000}];f.ch.mAtk=20000;a.noteSnapshot(f.ch);
 const key=a.raidContext('boss',{}).key,hero=a.heroContext();a.noteSnapshot(old);
 assert.equal(a.petBuffState(4699),true);assert.equal(a.heroContext(),hero);assert.equal(a.raidContext('boss',{}).key,key);
 f.tick(31000);a.noteSnapshot(old);assert.equal(a.petBuffState(4699),null,'old response cannot refresh validity after30sec');
});
test('Warlock server-aged snapshot and stale subclass response cannot revive old measurements',()=>{
 const f=warlockFixture(),a=f.api();f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+1200000}];
 a.noteSnapshot({...f.ch,snapshotGeneratedAt:f.now()-60000});assert.equal(a.petBuffState(4699),null);
 a.noteSnapshot(f.ch);assert.equal(a.petBuffState(4699),true);
 f.env.rt.classCur={prof:'human_dark_avenger',slot:1};a.noteSnapshot(f.ch);assert.equal(a.petBuffState(4699),null);
});
test('old target damage cannot override new weapon/buff power; analytics remain while new cohort relearns',()=>{
 let context='weapon-S:buff-on';
 // Настоящий getter анализатора, тот же контракт warlock.heroContext в content.
 // Отдельный factory нужен, чтобы менять уже инжектированный getter.
 let now=100000,seq=0;const env={rt:{char:'Hero'},cfg:{},recoveryContext:()=>context,actName:()=> 'Blaze',mobTitle:()=>'',setRt:async p=>Object.assign(env.rt,p)};
 const b={Date:{now:()=>now},URLSearchParams};vm.runInNewContext(fs.readFileSync(root+'/modules/fightlab.js','utf8'),b);const lab=b.L2V7Factories.fightlab(env);
 const start=()=>lab.onNet('/game/battle/start',{status:200,bt:{actor:'Hero',name:'Safe Mob',spawn:'main',mob:10000,mobMax:10000,seq:0,log:[]}});
 const hit=dmg=>{now+=1000;return lab.onNet('/game/battle/action',{status:200,req:{action:'l2_1220'},bt:{name:'Safe Mob',spawn:'main',mob:9000,seq:++seq,log:['Полум’я '+dmg]}})};
 start();for(let i=0;i<4;i++)hit(9000);assert.equal(lab.dmgOn('Blaze').mean,9000);lab.finish('left');
 context='weapon-N:buff-off';seq=0;start();
 const c=flowFixture('mage');c.env.cfg.mageProbe=false;c.env.expDmg=()=>500;c.env.fightDmgOn=lab.dmgOn;c.env.fightKillP=lab.killP;
 assert.equal(c.combat.magePlan({block:{}},{cur:1000,max:1000}).dmg,500,'new global weapon estimate wins over old exact-target measurement');
 assert.equal(lab.dmgOn('Blaze'),null);assert.equal(lab.killP('Blaze',1000),null);
 for(let i=0;i<3;i++)hit(400);assert.equal(lab.dmgOn('Blaze').mean,400,'new context relearns independently');
 context='weapon-N:buff-on';assert.equal(lab.dmgOn('Blaze'),null,'buff change invalidates same-weapon prediction');
 context=null;assert.equal(lab.dmgOn('Blaze'),null,'expired full snapshot cannot promise old damage');
 lab.finish('left');assert.equal(lab.recall('m:safe mob').a.blaze.n,7,'all accepted uses survive as analytics');assert.equal(lab.recall('m:safe mob').a.blaze.s.length,7);
});
test('Queen old missing snapshot cannot trigger repeated rebuff after accepted cast',()=>{
 const f=warlockFixture(),a=f.api();a.noteSnapshot(f.ch);const before=f.now();
 assert.equal(a.petBuffState(4699,before-180000),false);
 f.tick(1000);const applied=f.now();assert.equal(a.petBuffState(4699,applied),null,'old absent snapshot predates successful cast');
 f.tick(6000);assert.equal(a.petBuffState(4699,applied),null,'five-second action guard expiry does not revive obsolete absence');
 f.ch.revision++;f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+1200000}];a.noteSnapshot(f.ch);assert.equal(a.petBuffState(4699,applied),true);
 f.tick(1000);f.ch.revision++;f.ch.activeSummon.activeBuffs=[];a.noteSnapshot(f.ch);assert.equal(a.petBuffState(4699,applied),false,'new confirmed Cancel permits restoration');
});
test('late pre-cast same-revision GET cannot refresh missing Queen proof after accepted rebuff',()=>{
 const f=warlockFixture(),a=f.api();a.noteSnapshot(f.ch);const old=JSON.parse(JSON.stringify(f.ch));
 f.tick(1000);const applied=f.now();f.tick(6000);a.noteSnapshot(old);
 assert.equal(a.petBuffState(4699,applied),null,'arrival after cast is not evidence of state after cast');
 f.ch.revision++;f.tick(1000);a.noteSnapshot(f.ch);assert.equal(a.petBuffState(4699,applied),false,'a genuinely later revision may prove effect missing');
});
test('Queen unseen intermediate revision from GET begun before cast is not post-cast absence evidence',()=>{
 const f=warlockFixture(),a=f.api();a.noteSnapshot(f.ch);f.tick(500);const requestStartedAt=f.now();
 f.tick(500);const applied=f.now();f.tick(6000);a.noteSnapshot({...f.ch,revision:f.ch.revision+1,requestStartedAt});
 assert.equal(a.petBuffState(4699,applied),null);
 f.tick(1000);a.noteSnapshot({...f.ch,revision:f.ch.revision+2,requestStartedAt:f.now()});assert.equal(a.petBuffState(4699,applied),false);
});
test('public gear attributes and skill rank separate equal-stat damage cohorts, raw and real-hook shapes agree',()=>{
 const f=warlockFixture(),a=f.api();Object.assign(f.ch,{mAtk:20000,pAtk:2000,pDef:1000,mDef:1000,maxHp:10000,activeBuffs:[],
 inventory:{eq:{l1:{itemId:9002284,enchant:25,clanWeaponUid:'private-instance',clanWeaponAttrs:[{attributeId:'magical_damage_pct',level:1}]}}},
 learnedBattleSkillsDetail:[{battleId:'l2_1220',level:3,nameUk:'Полум’я'}]});f.env.shotContext=()=> 'shots:on';
 const hook=fs.readFileSync(root+'/hook.js','utf8'),petOf=vm.runInNewContext(hook.slice(hook.indexOf('  const petOf ='),hook.indexOf('  const augOf ='))+';petOf');
 a.noteSnapshot(f.ch);let old=a.heroContext(),oldRaid=a.raidContext('boss',{}).key;assert.ok(old&&oldRaid);
 const normalized=petOf({pathname:'/character'},{character:f.ch});assert.ok(!JSON.stringify(normalized).includes('private-instance'));
 a.noteSnapshot(normalized);assert.equal(a.heroContext(),old);assert.equal(a.raidContext('boss',{}).key,oldRaid);
 for(const change of [()=>f.ch.inventory.eq.l1.itemId++,()=>f.ch.inventory.eq.l1.clanWeaponAttrs[0].level++,()=>f.ch.learnedBattleSkillsDetail[0].level++]){
  change();f.ch.revision++;a.noteSnapshot(f.ch);assert.notEqual(a.heroContext(),old);assert.notEqual(a.raidContext('boss',{}).key,oldRaid);
  old=a.heroContext();oldRaid=a.raidContext('boss',{}).key;
  a.noteSnapshot(petOf({pathname:'/character'},{character:f.ch}));assert.equal(a.heroContext(),old,'hook keeps the same public model identity');
 }
 f.ch.hp=1;f.ch.mp=1;f.ch.inventory.eq.l1.clanWeaponUid='another-private-instance';f.ch.revision++;a.noteSnapshot(f.ch);
 assert.equal(a.heroContext(),old,'vitals/revision/private instance UID do not fragment the model');
});
