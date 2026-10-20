'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
const bgStart=background.indexOf('const LOCK_TTL ='),bgEnd=background.indexOf('const paint =',bgStart);
assert(bgStart>0&&bgEnd>bgStart);
const state={on:false,lock:null,rt:{},cfg:{}};
const chrome={runtime:{getURL:p=>'chrome-extension://testing/'+p},storage:{local:{async get(keys){let o={};for(const k of (typeof keys==='string'?[keys]:keys))if(Object.hasOwn(state,k))o[k]=structuredClone(state[k]);return o;},async set(o){Object.assign(state,structuredClone(o));}}}};
// 20.30: menuPatch использует ядро при Start; лимиты patch и поведение классов проверяются без изменений.
const bg=vm.createContext({L2EngineCore:require('../engine-core.js'),chrome,console,Date,URL,crypto:{randomUUID:()=> 'uuid'},noteAlive(){} });
vm.runInContext(background.slice(bgStart,bgEnd)+'\nthis.menuPatch=menuPatch; this.statePatch=statePatch;',bg);
const sender={url:'chrome-extension://testing/popup.html?dock=1'};
const owner={tab:{id:7},frameId:0,url:'https://l2wap.com/map.html'};
const patch=n=>Object.fromEntries(Array.from({length:n},(_,i)=>['setting_'+i,i]));
(async()=>{
  for(const count of [122,400]){
    const ret=await bg.menuPatch({rtPatch:{manualKickAt:count},cfgPatch:patch(count),on:true},sender);
    assert.equal(ret.ok,true,`popup full ${count} fields accepted`);
    assert.equal(state.on,true,`Start accepted with ${count} config`);
    assert.equal(Object.keys(state.cfg).length,count);
    assert.equal(state.cfg['setting_'+(count-1)],count-1);
    state.on=false;
    const c=await bg.statePatch({patch:{},cfgPatch:patch(count)},owner);
    assert.equal(c.ok,true,`game config ${count} fields accepted`);
  }
  const before=JSON.stringify(state);
  assert.equal((await bg.menuPatch({cfgPatch:patch(401),on:true},sender)).reason,'invalid_patch');
  assert.equal((await bg.statePatch({patch:{},cfgPatch:patch(401)},owner)).reason,'invalid_patch');
  assert.equal(JSON.stringify(state),before,'invalid patch must not partially set on or config');
  console.log('PASS: Start, Buy/Mode via menuPatch accept 122 and 400 settings; content statePatch accepts 122 and 400; 401 rejected atomically');
  const content=(fs.readFileSync(path.join(root,'content.js'),'utf8') + '\n' + fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'));
  const popup=(fs.readFileSync(path.join(root,'popup.js'),'utf8') + '\n' + fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'));
  assert.match(content,/combatProfile: 'auto'/);
  assert.match(popup,/'combatProfile'/);
  assert.match(fs.readFileSync(path.join(root,'popup.html'),'utf8'),/id="combatProfile"/);
  const ilSource=fs.readFileSync(path.join(root,'skills-il.js'),'utf8');
  const sk={};vm.runInNewContext(ilSource+'\nglobalThis.il=IL_DB;',sk);
  const getIL=id=>sk.il[id];
  const skills=[['1220','Blaze'],['1111','Summon Kat the Cat'],['1127','Servitor Heal'],['1141','Servitor Haste'],['1125','Heal'],['1177','Wind Strike']].map(([id,name],i)=>({idx:i,name,kind:'скилл',title:name,cdKey:'l2_'+id}));
  const inv=[...skills,{idx:20,kind:'атака',name:'Атака'}, {idx:21,kind:'заряды',name:'Soulshot'}, {idx:22,kind:'заряды',name:'Blessed Spiritshot'}];
  const env={ cfg:{combatProfile:'mage_summoner'},rt:{panel:inv,prof:'Human Wizard',skills:{},weaponRec:{}}, MAGE:'#mage',combatProfileKind:()=> 'mage_summoner',normalizeProfession:x=>String(x||'').trim().toLowerCase().replace(/[_\s-]+/g,' '),CLASS_W:{'human wizard':['#mage']},
    panelInventory:()=>inv,isBattle:()=>false,ilOf:v=>getIL((typeof v==='object'?v.cdKey:'' ).replace('l2_',''))||Object.values(sk.il).find(x=>x.n===(typeof v==='string'?v:v.name))||null,
    expDmg:()=>100, names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean), skillCost:()=>0,itemOf:()=>null,iconStem:x=>x };
  const context=vm.createContext({console,document:{querySelectorAll:()=>[]}});
  vm.runInContext(fs.readFileSync(path.join(root,'modules/equipment.js'),'utf8'),context);
  const roles=context.L2V7Factories.equipment(env).suggestRoles().roles;
  assert.match(roles.nPower,/Blaze/);
  assert.match(roles.nPower,/Wind Strike/);
  assert.doesNotMatch(roles.nPower,/Summon|Servitor/i);
  assert.doesNotMatch(roles.nHeal,/Servitor/i);
  assert.doesNotMatch(roles.nBuffs,/Servitor/i);
  assert.equal(roles.nShots,'Blessed Spiritshot');
  const combat=fs.readFileSync(path.join(root,'modules/combat.js'),'utf8');
  assert.match(combat,/function mageCombat\(\)/);
  assert.match(combat,/!mageCombat\(\)/);
  assert.match(combat,/il\.target === 'PET'/);
  console.log('PASS: Warlock/mage role learning prioritizes magical damage and Blessed Spiritshots; summon and PET-target skills never auto-enter attack/self-heal');
})().catch(e=>{console.error(e);process.exitCode=1;});

// 7.1.14-fix: вкладка с меню расширения (не страница игры) не может писать состояние от имени вкладки
(async()=>{ const r=await bg.statePatch({patch:{kills:77}},{tab:{id:9},frameId:0,url:'chrome-extension://abc/popup.html'});
  require('node:assert/strict').equal(r.reason,'not_game_page'); console.log('PASS: statePatch rejects non-game sender'); })();
