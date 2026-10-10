'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=(name)=>fs.readFileSync(path.join(root,name),'utf8');
(async()=>{
  // Test REAL heartbeat function with controllable clock, storage and failed commits.
  const bgSource=source('background.js');
  const heartbeatSource=bgSource.slice(0,bgSource.indexOf('// v5.6.3:'))+
    bgSource.slice(bgSource.indexOf('function persistHeartbeat('),bgSource.indexOf('// Chrome MV3: scheduled alarms'));
  let time=100000,fail=false,writes=[];const stored={};
  const FakeDate=class extends Date{static now(){return time}};
  const hb=vm.createContext({Date:FakeDate,Promise,console,chrome:{storage:{local:{async set(value){
    if(fail){fail=false;throw Error('storage transient failure')}
    writes.push({at:time,snapshot:JSON.parse(JSON.stringify(value))});Object.assign(stored,JSON.parse(JSON.stringify(value)));
  }}}}});
  vm.runInContext(heartbeatSource+'\nthis.noteAlive=noteAlive;this.readState=()=>({persisted:hbPersistedAt,memory:{...hbMem}});',hb);
  for(let i=0;i<=36;i++){
    time=100000+i*5000;
    await hb.noteAlive(42,'/battle.html');
    assert.equal(stored.hbBg.tab,42);
    assert(time-stored.hbBg.t<=10000,'storage remains fresh throughout three minutes of five-second pulses');
  }
  assert(writes.length>=18 && writes.length<=20,`10-second persistence cadence, got ${writes.length}`);
  assert(time-stored.hbBg.t<70000,'popup should keep active state');
  time+=70001;assert(time-stored.hbBg.t>70000,'after pulses cease popup must mark signal stale');
  const n=writes.length;time+=1;await hb.noteAlive(99,'/battle.html');
  assert.equal(writes.length,n+1,'owner tab change commits immediately');assert.equal(stored.hbBg.tab,99);
  const persisted=hb.readState().persisted;
  time+=10000;fail=true;await assert.rejects(()=>hb.noteAlive(99,'/battle.html'));
  assert.equal(hb.readState().persisted,persisted,'failed write does not advance durable timestamp');
  time+=5000;await hb.noteAlive(99,'/battle.html');
  assert.equal(stored.hbBg.t,time,'failed write is retried with the next heartbeat');
  assert.match(bgSource,/m\.epoch === lock\.epoch/);assert.match(bgSource,/if \(valid\) await noteAlive/);
  console.log('PASS: heartbeat 5s for 180s, storage every 10s, popup stale after silence, owner change, failed write retry, epoch guard');

  // Run ACTUAL shared class normalization and decision logic in a VM.
  const content=source('content.js');
  const profSource=content.slice(content.indexOf('const normalizeProfession ='), content.indexOf('function classWeaponTypes(...args)'));
  assert(profSource.includes('function combatProfileKind'));
  const classMap={'mage':['mage'], 'human mage':['mage'], 'warlock':['mage'],'orc tyrant':['кастеты']};
  const profile=vm.createContext({rt:{prof:'Mage'},cfg:{combatProfile:'auto'},CLASS_W:classMap,MAGE:'mage'});
  vm.runInContext(profSource+'\nthis.normalize=normalizeProfession;this.kind=combatProfileKind;',profile);
  for(const name of ['Mage','Human Mage','human_mage',' HUMAN   MAGE ','mAgE']){
    profile.rt.prof=name;profile.cfg.combatProfile='auto';
    assert.equal(profile.normalize(name).includes('_'),false);
    assert.equal(profile.kind(),'mage_summoner',`normalized class ${name}`);
  }
  profile.rt.prof='Mage';profile.cfg.combatProfile='fighter';assert.equal(profile.kind(),'fighter');
  profile.cfg.combatProfile='mage_summoner';profile.rt.prof='Orc Tyrant';assert.equal(profile.kind(),'mage_summoner');
  profile.cfg.combatProfile='auto';assert.equal(profile.kind(),'fighter');
  const eqCtx=vm.createContext({console,document:{querySelectorAll:()=>[]}});
  vm.runInContext(source('modules/equipment.js'),eqCtx);
  profile.rt.prof='Mage';profile.cfg.combatProfile='auto';
  const db=JSON.parse(source('items-il.json'));
  const eqEnv={rt:profile.rt,cfg:profile.cfg,CLASS_W:classMap,MAGE:'mage',
    normalizeProfession:profile.normalize,combatProfileKind:profile.kind,
    GRADE_LV:{NG:0,D:20,C:40},heroLevel:()=>17};
  const eq=eqCtx.L2V7Factories.equipment(eqEnv);
  // Real catalog is injected for weaponOf, no fabricated magic attack values.
  eqEnv.itemOf=id=>db[id];
  const known=[eq.weaponOf(87,{name:'Iron Hammer',g:'NG'}),eq.weaponOf(100,{name:'Voodoo Doll',g:'NG'})];
  assert.equal(eq.classWeaponTypes().types[0],'mage');
  assert.equal(known[0].ma,db[87].ma);assert.equal(known[1].ma,db[100].ma);
  assert.equal(eq.rankWeapons(known).main.name,'Voodoo Doll','mage chooses actual higher M.Atk from supplied character inventory');
  const unknown=eq.weaponOf(87);delete unknown.ma;
  assert.equal(eq.rankWeapons([unknown,...known]).main.name,'Voodoo Doll','unknown M.Atk cannot defeat known M.Atk');
  assert.equal(eq.rankWeapons([...known,{name:'Forbidden C',wt:'прочее',g:'C',ma:999}]).main.name,'Voodoo Doll','grade restriction remains');
  profile.cfg.combatProfile='fighter';assert.equal(eqEnv.combatProfileKind(),'fighter');
  assert.notEqual(eq.classWeaponTypes().types[0],'mage','explicit fighter overrides auto-mage');
  console.log('PASS: Mage/Human Mage/human_mage, explicit profiles, real Voodoo Doll vs Iron Hammer M.Atk, unknown stat and grade restrictions');

  // Exercise the actual post-action force-energy block, not just magePlan's return value.
  const combat=source('modules/combat.js'),begin=combat.indexOf('      if (a.charge || a.cost) {'),end=combat.indexOf('      // «обычный» силовой удар',begin);
  assert(begin>0 && end>begin);
  const postForce='(async()=>{do {'+combat.slice(begin,end)+'} while(false);})()';
  async function executeAction(action){
    const seen={force:[],sleep:0,scan:0};let rt={};
    const env={rt,forceMax:()=>3,forceNow:()=>5,forceFromLog:async()=>{seen.scan++;return false},
      forceSet:async n=>seen.force.push(n),newLines:()=>[],logLines:()=>[],
      sleep:async()=>{seen.sleep++},cleanTitle:s=>s,logName:s=>s.toLowerCase(),FORCE_SPEND:/energy spent/,
      setRt:async p=>Object.assign(rt,p),rec:()=>{}};
    const context={a:action,done:true,env,ctx:{block:{}},logArr:[],mageCombat:()=>!!action.mpCost,Date};
    await vm.runInNewContext(postForce,context);
    return seen;
  }
  const mageA=await executeAction({name:'Wind Strike',b:{title:'Wind Strike'},mpCost:10,key:'power:Wind Strike'});
  const mageB=await executeAction({name:'Vampiric Touch',b:{title:'Vampiric Touch'},mpCost:15,key:'power:Vampiric Touch'});
  assert.equal(mageA.sleep+mageA.scan+mageA.force.length,0,'Wind Strike MP never triggers force logic');
  assert.equal(mageB.sleep+mageB.scan+mageB.force.length,0,'Vampiric Touch MP never triggers force logic');
  const fighterA=await executeAction({name:'Force Blaster',b:{title:'Force Blaster'},cost:2,key:'force:Force Blaster'});
  assert.equal(fighterA.sleep,1);assert.equal(fighterA.scan,1);assert.deepEqual(fighterA.force,[3]);
  assert.match(combat,/mpCost <= Math\.max/);assert.match(combat,/a\.mpCost-b\.mpCost/);
  console.log('PASS: post-action Wind Strike/Vampiric Touch never change force energy; charged fighter attack still does');

  // Server clock & battle switching. Newer zero/shortened deadlines supersede older ones.
  const {createBattleCooldown}=require('../battle-cooldown.js');let clock=500000;
  const cd=createBattleCooldown(()=>clock), sync=(srv,fields,spawn='mob-A')=>cd.observeSync({serverNowMs:srv,...fields},spawn);
  sync(1000000,{skillCooldowns:{l2_1177:1010000,l2_1147:1015000},globalCooldownUntilMs:1001000});
  assert(cd.skillWait('l2_1177','mob-A')>=10000);
  sync(1000200,{skillCooldowns:{l2_1177:1000500},globalCooldownUntilMs:1000200});
  assert(cd.skillWait('l2_1177','mob-A')<350,'newer shorter skill timer replaces old one');
  assert.equal(cd.globalWait('mob-A'),0,'newer server GCD completion clears old global deadline');
  sync(1000100,{skillCooldowns:{l2_1177:1019900},globalCooldownUntilMs:1019900});
  assert(cd.skillWait('l2_1177','mob-A')<350,'stale skill packet ignored');
  assert.equal(cd.globalWait('mob-A'),0,'stale global packet ignored');
  sync(1000500,{skillCooldowns:{l2_1177:0}});
  assert.equal(cd.skillWait('l2_1177','mob-A'),0,'explicit ready removes per-skill cooldown');
  sync(1000600,{});assert.equal(cd.skillWait('l2_1147','mob-A')>10000,true,'omitted field is not zero cooldown');
  sync(2000000,{skillCooldowns:{l2_1177:2000900}},'mob-B');
  const snapshot=JSON.stringify(cd.snapshot());
  cd.observe({action:'l2_1177',battleSpawnId:'mob-A'}, {serverNowMs:3000000,skillCooldowns:{l2_1177:3050000}},200,'mob-B');
  assert.equal(JSON.stringify(cd.snapshot()),snapshot,'late old-battle response cannot override new battle');
  assert.equal(cd.skillWait('l2_1147','mob-B'),0,'old opponent cooldown not copied to new opponent');
  assert(cd.skillWait('l2_1177','mob-B')>0);
  // End-to-end action choice with stale local cdUntil, but fresher server values.
  const spells=[{title:'Wind Strike',id:'l2_1177',mp:10,dmg:320},
                {title:'Vampiric Touch',id:'l2_1147',mp:15,dmg:316}].map(b=>({
     ...b,disabled:false,kind:'скилл',getAttribute(k){return k==='data-slot-cd'?this.id:null;}
  }));
  const castNow={t:clock};
  const dom={querySelectorAll(){return spells}};
  const mageEnv={SLOT:'.slot',rt:{prof:'Mage',skills:{},cdUntil:{'wind strike':999999999,'vampiric touch':999999999}},
     cfg:{combatProfile:'auto',nPower:'Wind Strike, Vampiric Touch',skillMpMin:35},
     combatProfileKind:()=> 'mage_summoner',combatCooldown:cd,battleSpawn:()=> 'mob-B',
     $q:q=>q==='#battle-mob-hp-val'?{textContent:'1200 / 1200'}:null,shown:()=>false,
     names:v=>String(v||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),
     isEquip:()=>false,slotKind:b=>b.kind,slotCd:()=>null,slotAction:b=>b.id,
     skKey:b=>b.title.toLowerCase(),memLeft:b=>Math.max(0,(mageEnv.rt.cdUntil[b.title.toLowerCase()]||0)-clock)/1000,
     ilOf:()=>({c:'Маг. атака',t:'MDAM',pow:100}),cleanTitle:s=>s,
     skillMp:b=>spells.find(x=>x.title===b)?.mp||0,expDmg:b=>spells.find(x=>x.title.toLowerCase()===String(b).toLowerCase() || x.id===b)?.dmg||0};
  const mageCtx=vm.createContext({console,document:dom,Date:{now:()=>clock}});
  vm.runInContext(combat,mageCtx);
  const mageCombat=mageCtx.L2V7Factories.combat(mageEnv),fighter={block:{}};
  cd.observeSync({serverNowMs:2001000,skillCooldowns:{l2_1177:2001000,l2_1147:2003000}},'mob-B');
  assert.equal(mageCombat.chooseAction(fighter,{cur:200,max:200})?.name,'Wind Strike','fresh server-ready Wind overrides stale 30-second local timer');
  cd.observeSync({serverNowMs:2001100,skillCooldowns:{l2_1177:2011100,l2_1147:2001100}},'mob-B');
  assert.equal(mageCombat.chooseAction(fighter,{cur:200,max:200})?.name,'Vampiric Touch','ready Vamp selected immediately while Wind is cooling down');
  cd.observeSync({serverNowMs:2001200,skillCooldowns:{l2_1177:2011200,l2_1147:2011200}},'mob-B');
  assert.equal(mageCombat.chooseAction(fighter,{cur:200,max:200}),null,'two spells cooling down does not cast prematurely or use fists');
  // The actual cooldown field is observed independently of the reserve local timer.
  assert.equal(mageEnv.memLeft(spells[0])>10000,true);
  assert.match(combat,/overlayBusySeen\.get\(b\)/,'overlay must be seen busy before ready can clear fallback');
  assert.doesNotMatch(combat,/ref \* 0\.98/,'no forced lower bound from Interlude reuse');
  assert.match(content,/logCooldownApi\(d, path\)/,'structured response logged before truncation');
  assert.match(combat,/ожидание навыков/);
  console.log('PASS: two spells, shortened/zero/stale server cooldowns, missing fields, GCD, new opponent, overlay transition, bounded diagnostic');
})().catch(e=>{console.error(e);process.exitCode=1});
