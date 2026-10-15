'use strict';
// 15.10: реальные механики Warlock — ручной HP-сброс, Queen20мин и King55%.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('content.js','utf8');
const box={console,Date,URLSearchParams,rt:{}};
vm.createContext(box);
vm.runInContext(fs.readFileSync('skills-il.js','utf8')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
const ilOf=box.ilOf;
assert.equal(ilOf('Battle Trance').t,'HP_SELF_COST');
assert.equal(ilOf({cdKey:'battle_trance',name:'Боевой транс'}).autoUse,false);
assert.equal(ilOf('Боевой транс').target,'SELF');
assert.equal(ilOf({title:'Локальное имя',getAttribute:k=>k==='data-slot-cd'?'battle_trance':null}).autoUse,false);
assert.equal(ilOf({cdKey:'l2_1331'}).dur,1200);

const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
const slot=(name,key)=>({title:name,name,cdKey:key,kind:'скилл',getAttribute:k=>k==='data-slot-cd'?key:null});
const trance=slot('Battle Trance','battle_trance'),queen=slot('Summon Feline Queen','l2_1331'),kai=slot('Summon Kai the Cat','l2_1276'),king=slot('Summon Feline King','l2_1406');
let slots=[trance,queen,kai,king],heroBuffs=[];
box.document={querySelectorAll:()=>slots,querySelector:()=>null};
const env={SLOT:'.slot',cfg:{nPower:'Battle Trance',nPetBuffs:'Summon Feline Queen',skillMpMin:0},rt:{skills:{'battle trance':{dmgN:4,dmg:99999999}}},
 normalizeProfession:()=>'',CLASS_W:{},isEquip:()=>false,ilOf,panelInventory:()=>slots,combatProfileKind:()=> 'fighter',noEffect:()=>false,
 isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>4000,ilNum:x=>Array.isArray(x)?x[0]:x,itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,
 names,cleanTitle:s=>s,slotAction:b=>b.cdKey,slotKind:b=>b.kind,slotCd:()=>null,memLeft:()=>0,combatCooldown:{skillWait:()=>0},battleSpawn:()=> 'battle',skKey:b=>b.title.toLowerCase(),
 shown:x=>!!x,$q:()=>null,longFightMp:()=>null,mpPotSlot:()=>null,qty:()=>0,turnSec:()=>1,forceNow:()=>0,forceCosts:()=>[],forceMax:()=>0,petState:()=>({t:Date.now(),has:true,key:'kai_the_cat',hp:1000,maxHp:1000}),
 skillMp:()=>87,activeBuffs:()=>heroBuffs,warlock:{petBuffActive:()=>false}};
vm.runInContext(fs.readFileSync('modules/equipment.js','utf8')+'\n'+fs.readFileSync('modules/combat.js','utf8'),box);
const E=box.L2V7Factories.equipment(env),C=box.L2V7Factories.combat(env);
for(const profile of ['fighter','mage_summoner']){
 env.combatProfileKind=()=>profile;
 const sug=E.suggestRoles();
 assert.doesNotMatch(sug.roles.nPower,/trance/i,profile+' не учит ложный урон питомца как атаку');
 const why=sug.why.find(s=>s.includes('Battle Trance'));
 assert.match(why,/HP до 25%.*вручную/);assert.doesNotMatch(why,/урон|IL #undefined/);
 assert.equal(C.mageSpellSlots().length,0);
}
env.combatProfileKind=()=> 'fighter';
assert.equal(C.ready(trance),false,'даже вручную записанная старая роль не разрешает автоклик');
assert.equal(C.dpsPlan({block:{}},{cur:1000}),null);
assert.equal(C.chooseAction({block:{}},{cur:1000}),null);
// Native ID защищает даже при неизвестном локализованном имени и отсутствии справочника.
const old=env.ilOf;env.ilOf=()=>null;slots=[slot('Непонятное имя','battle_trance')];env.cfg.nPower=slots[0].title;
assert.equal(C.dpsPlan({block:{}},{cur:1000}),null);env.ilOf=old;slots=[queen,kai,king];
const pick=()=>C.petBuffPick({block:{}},{pct:100},{cur:1000},{cur:10000});
let now=Date.now();env.rt.petBornT=now-600000;heroBuffs=[{id:4699,exp:now+900000}];
assert.equal(pick(),null,'действующий Queen героя после призыва не повторяется из-за неизвестного баффа пета');
env.warlock.petBuffState=()=>false;assert.equal(pick()?.b,queen,'свежий полный снимок пета без Queen важнее HUD героя');
env.warlock.petBuffState=()=>null;assert.equal(pick(),null,'только неизвестный пет допускает HUD fallback');
heroBuffs=[{id:4699,exp:now-1}];assert.equal(pick()?.b,queen,'истечение героя разрешает Queen');
heroBuffs=[{id:4699,exp:0}];assert.equal(pick()?.b,queen,'неизвестное время не подтверждает20мин');
heroBuffs=[{id:4699,exp:now+900000}];env.rt.petBornT=now-1000;assert.equal(pick()?.b,queen,'старый геройский Queen не подавляет бафф нового пета');
env.warlock.petBuffActive=()=>true;assert.equal(pick(),null,'подтверждённый бафф пета важнее перепризыва/локальной памяти');env.warlock.petBuffActive=()=>false;
heroBuffs=[{id:4699,exp:now+5*3600000}];assert.equal(pick()?.b,queen,'по долгому платному баффу героя нельзя датировать Queen для нового пета');
heroBuffs=[];env.rt.petBornT=now-600000;env.rt.petBuffAt={'summon feline queen':now-180000};
assert.equal(pick(),null,'через3мин собственный Queen ещё не истёк');
env.rt.petBuffAt['summon feline queen']=now-1201000;assert.equal(pick()?.b,queen);
assert.equal(C.petMul('feline_king'),55);
assert.match(fs.readFileSync('popup.html','utf8'),/<option value="Summon Feline King">Feline King \(\+55 % от M\.Atk\)<\/option>/,'явный выбор King доступен в меню');
assert.equal(C.petPick([kai,king],''),king,'без текущего/прошлого выбираем по описанию55%');
assert.equal(C.petPick([king,kai],'kai_the_cat'),kai,'живой/явно выбранный Kai сохраняется');
env.rt.petLast='kai_the_cat';assert.equal(C.petPick([king,kai],''),kai,'последний выбранный кот сохраняется');
env.rt.skillDb={'summon feline king':{desc:'+60% от текущего M.Atk'}};assert.equal(C.petMul('feline_king'),60,'свежее описание важнее fallback');
console.log('PASS Warlock: Battle Trance safety/roles, Queen20min/fresh hero/respawn, King55% without overriding chosen pet');
// Реальные формы полей из King после Queen, /character15.10: у героя expiresAt, у слуги expiresAtMs.
const {fixture:warlockFixture}=require('./warlock-fixture.cjs');
const rawHeroBuff={skillId:4699,level:3,expiresAt:1792064902015,remainingSec:1189};
const rawPetBuff={skillId:4699,level:3,expiresAtMs:1792064902015,remainingSec:1189};
const hookSource=fs.readFileSync('hook.js','utf8'),hookBox={};
vm.runInNewContext(hookSource.slice(hookSource.indexOf('  const petOf ='),hookSource.indexOf('  const augOf ='))+'\nthis.petOf=petOf;',hookBox);
for(const format of ['raw','hook','normalized']){
 const f=warlockFixture();f.tick(rawHeroBuff.expiresAt-5000-f.now());
 Object.assign(f.ch,{mAtk:24833,pAtk:1300,pDef:1400,mDef:3605,maxHp:15070,activeBuffs:[{...rawHeroBuff}]});
 Object.assign(f.ch.activeSummon,{key:'feline_king',summonSkillId:1406,summonSkillLevel:1,critRate:780,critDmgMul:3,activeBuffs:[{...rawPetBuff}]});
 f.env.shotContext=()=> 'BSPS-S:on';
 let ch=f.ch;
 if(format==='hook')ch=hookBox.petOf({pathname:'/character'},{character:f.ch});
 if(format==='normalized'){ch={...f.ch,activeBuffs:[{skillId:4699,level:3,expiresAtMs:rawHeroBuff.expiresAt}]};}
 const api=f.api();
 assert.equal(api.snapshot({...ch,activeSummon:{...ch.activeSummon,summonSkillId:1276}}),null,'King допускается только с подтверждённым skill1406');
 api.noteSnapshot(ch);
 const heroKey=api.heroContext(),raidKey=api.raidContext('rb1',{lvl:78,hp:1000000}).key;
 assert.ok(heroKey&&raidKey,format+': контекст доступен');
 assert.equal(JSON.stringify(api.snapshot(ch).hero.buffs),JSON.stringify(['4699:3']),format+': реальный бафф героя не потерян');
 assert.equal(api.petBuffState(4699),true,format+': бафф King сохранён отдельно');
 api.noteSnapshot({...ch,activeBuffs:[]});
 assert.notEqual(api.heroContext(),heroKey,format+': баффы героя разделяют выборки');
 assert.notEqual(api.raidContext('rb1',{lvl:78,hp:1000000}).key,raidKey,format+': разные баффы не смешивают DPS рейда');
 api.noteSnapshot(ch);f.tick(5001);
 assert.equal(api.heroContext(),null,format+': срок баффа истёк раньше30секунд');
 assert.equal(api.raidContext('rb1',{lvl:78,hp:1000000}).key,null,format+': старые измерения больше не действуют');
 api.noteSnapshot(ch);
 assert.equal(JSON.stringify(api.snapshot(ch).hero.buffs),'[]',format+': перечитанный просроченный бафф не ожил');
}
console.log('PASS Warlock: raw hero expiresAt + pet expiresAtMs, hook normalization, expiry and raid cohort separation');
