'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture:warlockFixture}=require('./warlock-fixture.cjs');
function fixture(){
 const f=warlockFixture(),e=f.env;e.cfg.champCancel='always';e.cfg.champMinLvl=0;e.leaseEpoch='lease1';e.heroLvl=()=>f.ch.level;e.shotContext=()=> 'on:S';
 Object.assign(f.ch,{level:78,mAtk:20000,pAtk:1500,pDef:4081,mDef:4000,maxHp:15070,activeBuffs:[],toggleStances:[],inventory:{eq:{l1:{itemId:100,enchant:25}}},learnedBattleSkillsDetail:[]});
 const snap=()=>{f.ch.revision++;f.api().noteSnapshot(f.ch)};snap();e.combatContext=options=>f.api().combatContext(options);
 const box={console,Date:class extends Date{static now(){return f.now()}},sessionStorage:{setItem(){}}};
 for(const n of ['champs','story'])vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/'+n+'.js','utf8'),box);
 const C=box.L2V7Factories.champs(e),S=box.L2V7Factories.story(e);
 const ctx=()=>{const c={champ:true,tier:'blue',lvl:79,heroLvl0:f.ch.level};C.observe(c);return c};
 return {...f,e,C,S,snap,ctx};
}
test('legacy champion and rbDps do not become known without current composition evidence',()=>{
 const f=fixture();f.e.rt.rbDps=10000;f.e.rt.dps={dps:10000,n:20};const legacy={dps:{dps:10000,base:10000,lvl:78,n:20}};f.e.rt.champLearn=legacy;
 assert.equal(f.C.dpsOn().known,false);assert.equal(f.C.dpsOn().dps,0);assert.equal(f.C.judge({tier:'blue',lvl:79,hp:150000}).probe,true);assert.equal(f.e.rt.champLearn,legacy);
});
test('real classNote Warlock78 -> Warrior40 cannot reuse champion DPS; fresh slow cohort rejects 150k HP',async()=>{
 const f=fixture();f.e.rt.rbDps=10000;await f.C.learn(f.ctx(),'win',100000,10);assert.equal(f.C.dpsOn().known,true);
 f.S.classNote('human_warrior',1,40);Object.assign(f.ch,{level:40,l2Profession:'human_warrior',classSlots:{activeSlot:1},activeSummon:null});f.snap();
 assert.equal(f.C.dpsOn().known,false);assert.equal(f.C.dpsOn().dps,0);
 const c=f.ctx();await f.C.noteDamage(c,1000,10);f.e.rt.rbDps=100;f.e.rt.dps={dps:100,n:20};
 assert.equal(f.C.dpsOn().dps,100);assert.equal(f.C.dpsOn().known,false);
 const j=f.C.judge({tier:'blue',lvl:45,hp:150000});assert.equal(j.ok,false);assert.equal(j.eta,1502);
 assert.equal(Object.keys(f.e.rt.champLearn.cohorts).length,2);
});
test('changed weapon, rank, hero buff and pet buff isolate cohorts without deleting history',async()=>{
 for(const change of [f=>f.ch.inventory.eq.l1.enchant++,f=>f.ch.learnedBattleSkillsDetail.push({battleId:'x',level:2}),f=>f.ch.activeBuffs.push({skillId:1059,level:3,expiresAtMs:f.now()+60000}),f=>f.ch.activeSummon.activeBuffs.push({skillId:4699,level:3,expiresAtMs:f.now()+60000})]){
  const f=fixture(),key=f.e.combatContext();await f.C.learn(f.ctx(),'win',100000,10);change(f);f.snap();assert.notEqual(f.e.combatContext(),key);assert.equal(f.C.dpsOn().known,false);assert.ok(f.e.rt.champLearn.cohorts[key].dps);
 }
});
test('changed then restored composition during fight is mixed forever',async()=>{
 const f=fixture(),c=f.ctx();f.ch.inventory.eq.l1.enchant++;f.snap();f.C.observe(c);f.ch.inventory.eq.l1.enchant--;f.snap();await f.C.learn(c,'win',100000,10);assert.equal(f.C.dpsOn().known,false);assert.equal(f.e.rt.champLearn?.dps,undefined);
});
test('no start capture, stale snapshot and lease/actor/manual changes cannot teach current profile',async()=>{
 for(const change of [(f,c)=>delete c.chMeasure,f=>f.tick(31000),f=>f.e.leaseEpoch='new',f=>f.e.rt.manualKickAt=1,f=>f.e.rt.char='Other',f=>f.e.tabOwner=false]){
 const f=fixture(),c=f.ctx();change(f,c);await f.C.noteDamage(c,100000,10);await f.C.learn(c,'win',100000,10);assert.equal(f.e.rt.champLearn?.dps,undefined);
 }
});
test('known champion DPS does not scale from unscoped globals; repeated outcome is idempotent',async()=>{
 const f=fixture(),c=f.ctx();await f.C.learn(c,'win',100000,10);f.e.rt.rbDps=100;f.e.rt.dps={dps:100,n:30};assert.equal(f.C.dpsOn().dps,10000);await f.C.learn(c,'win',100000,10);assert.equal(f.e.rt.champLearn.st.blue.win,1);
});
test('full context distinguishes no pet, missing pet, death, resummon, expiry and changing stance',()=>{
 const f=fixture(),key=f.e.combatContext();assert.ok(key);f.ch.activeSummon.hp--;f.snap();assert.equal(f.e.combatContext(),key);
 f.ch.activeSummon.hp=0;f.snap();assert.notEqual(f.e.combatContext(),key);
 f.ch.activeSummon=null;f.snap();const noPet=f.e.combatContext();assert.ok(noPet);assert.notEqual(noPet,key);
 delete f.ch.activeSummon;f.snap();assert.equal(f.e.combatContext(),null);
 f.ch.activeSummon=null;f.snap();assert.equal(f.e.combatContext(),noPet);f.ch.toggleStances.push({battleId:'stance',active:true});f.snap();assert.notEqual(f.e.combatContext(),noPet);
 f.e.rt.petBornT=1;assert.equal(f.e.combatContext(),null);f.snap();assert.ok(f.e.combatContext());f.tick(31000);assert.equal(f.e.combatContext(),null);
});
test('late snapshot request does not refresh combat evidence',()=>{const f=fixture();f.ch.requestStartedAt=f.now()-31000;f.snap();assert.equal(f.e.combatContext(),null)});
test('legacy history is preserved on first scoped champion measurement',async()=>{const f=fixture();f.e.rt.champLearn={dps:{dps:9999,n:5},st:{red:{death:2}}};await f.C.learn(f.ctx(),'win',1000,10);assert.equal(f.e.rt.champLearn.legacy.dps.dps,9999);assert.equal(f.e.rt.champLearn.legacy.st.red.death,2);assert.equal(f.C.dpsOn().dps,100)});
test('runtime wires real context and combat capture before initial action loop',()=>{
 const content=fs.readFileSync(__dirname+'/../content.js','utf8'),combat=fs.readFileSync(__dirname+'/../modules/combat.js','utf8');
 assert.match(content,/Factories\.champs\(\{ get combatContext\(\)\{return options=>L2V7Modules\.warlock\.combatContext\(options\)\}/);
 // 20.66: дополнительный hpProofCurrent отменяет старое API-доказательство до observe; захват состава и учёт урона прежние.
 assert.match(combat,/champs\?\.observe\?\.\(ctx\);\n  const t0 = Date\.now\(\)/);assert.match(combat,/while \(env\.on && env\.tabOwner\) \{\n(?:    if\(actionContext\(\)!==battleOwner(?:\|\|ctx\.hpProofCurrent&&!ctx\.hpProofCurrent\(\))?\)return;\n)?    env\.champs\?\.observe/);assert.match(combat,/champs\?\.noteDamage\?\.\(ctx,base,ttk\)/);
});
test('hook -> map preflight -> battle -> learned DPS -> map: planned shots remain only a probe and hold survives',async()=>{
 const f=fixture();let battle=true;f.e.isBattle=()=>battle;f.ch.inBattle=true;
 f.e.rt.weaponsT=1;f.e.rt.weapons=[{id:100,g:'S',where:'надето'}];
 f.ch.inventory.stacks=[{itemId:1467,qty:500}];f.ch.battleHotbarSlots=[{k:'u',id:1467}];
 const shotButton={title:'#1467',querySelector:()=>({getAttribute:()=>'/game/item-icon/1467'})};
 const content=fs.readFileSync(__dirname+'/../content.js','utf8');
 const shot=vm.runInNewContext(content.slice(content.indexOf('const warlockShotContext ='),content.indexOf('// Свежесть плана не переживает'))+';warlockShotContext',{
  isBattle:()=>battle,on:true,tabOwner:true,rt:f.e.rt,heroNick:()=>f.e.rt.char,SHOT_IDS:{S:1467},BSPS_IDS:{S:1467},
  L2V7Modules:{economy:{shotGrade:()=>({g:'S'}),shotsMage:()=>true}},document:{querySelectorAll:()=>battle?[shotButton]:[]},qty:()=>500,shotsOn:()=>true});
 f.e.shotContext=shot;
 const hook=fs.readFileSync(__dirname+'/../hook.js','utf8'),petOf=vm.runInNewContext(hook.slice(hook.indexOf('  const petOf ='),hook.indexOf('  const augOf ='))+';petOf');
 const native=()=>{f.ch.revision++;f.api().noteSnapshot(petOf({pathname:'/character'},{character:f.ch}))};
 native();assert.ok(f.e.combatContext());const key=f.e.combatContext();await f.C.learn(f.ctx(),'win',100000,10);assert.equal(f.C.dpsOn().known,true);
 const bad=f.ctx();await f.C.learn(bad,'weak',10,10);
 battle=false;f.ch.inBattle=false;native();assert.equal(f.e.combatContext(),null);assert.equal(f.e.combatContext({preflight:true}),key);
 assert.equal(f.C.dpsOn().known,false);assert.equal(f.C.dpsOn().dps,10000);assert.match(f.C.held({tier:'blue',lvl:79}),/жду роста силы/);
 assert.equal(f.C.judge({tier:'blue',lvl:79,hp:150000}).ok,false);
 f.reload();assert.equal(f.e.combatContext({preflight:true}),null);assert.match(f.C.held({tier:'blue',lvl:79}),/жду роста силы/);native();assert.equal(f.e.combatContext({preflight:true}),key);assert.equal(f.C.dpsOn().known,false);assert.equal(f.C.dpsOn().dps,10000);
 f.ch.inventory.stacks[0].qty=0;native();assert.equal(f.e.combatContext({preflight:true}),null);assert.equal(f.C.dpsOn().dps,0);assert.match(f.C.held({tier:'blue',lvl:79}),/жду роста силы/);
 const missing={...f.ch};delete missing.activeSummon;const normalized=petOf({pathname:'/character'},{character:missing});assert.equal(normalized.activeSummon,undefined);f.ch.revision++;f.api().noteSnapshot({...normalized,revision:f.ch.revision});assert.equal(f.e.combatContext({preflight:true}),null);
});
test('mixed or unknown composition retains defensive hold without learning DPS, isolated by class',async()=>{
 const f=fixture(),c=f.ctx();f.api().invalidateSnapshot();await f.C.learn(c,'weak',50,10);assert.equal(f.C.dpsOn().known,false);assert.match(f.C.held({tier:'blue',lvl:79}),/жду роста силы/);
 f.S.classNote('human_warrior',1,40);assert.equal(f.C.held({tier:'blue',lvl:79}),null);
});
test('Queen4699 changes outgoing composition but not incoming defense',()=>{
 const f=fixture(),before=f.api().defenseContext(),damage=f.e.combatContext(),raid=f.api().raidContext('boss',{}).key;assert.ok(before);assert.ok(raid);f.ch.activeBuffs.push({skillId:4699,level:3,expiresAtMs:f.now()+60000});f.snap();
 assert.equal(f.api().defenseContext(),before);assert.notEqual(f.e.combatContext(),damage);assert.notEqual(f.api().raidContext('boss',{}).key,raid);
});

test('class switch away and back invalidates an old async fight even with restored composition',async()=>{const f=fixture(),c=f.ctx();f.tick(10);f.S.classNote('human_warrior',1,40);f.tick(10);f.S.classNote('human_warlock',0,78);f.snap();await f.C.learn(c,'win',100000,10);assert.equal(f.e.rt.champLearn?.dps,undefined);});
test('real combat entry into wounded champion learns remaining HP under captured composition',async()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage'),e=f.env;
 let now=Date.now();f.box.Date=class extends Date{static now(){return now}};
 Object.assign(e.cfg,{champBlue:true,champCancel:'always',champMinLvl:0});e.isChamp=()=>true;e.combatContext=()=> 'fixed-composition';
 e.battleInfo=()=>({t:now,name:'Safe Mob',kind:'champion',tier:'blue',lvl:74,max:1000});f.hp.textContent='200 / 1000';
 vm.runInContext(fs.readFileSync(__dirname+'/../modules/champs.js','utf8'),f.box);e.champs=f.box.L2V7Factories.champs(e);
 const fire=e.fire;e.fire=b=>{if(b!==f.hunt)now+=5000;return fire(b)};
 await f.combat.battle();assert.equal(e.rt.kills,1);assert.equal(e.rt.champLearn.st.blue.win,1);assert.equal(e.champs.dpsOn().known,true);assert.equal(e.champs.dpsOn().dps,40);
 assert.equal(e.rt.champLearn.cohorts['fixed-composition'].base.dps,40);
});
