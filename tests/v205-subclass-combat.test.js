'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8'),src=read('content.js');
function fixture(){
 const panel=[{name:'Атака',title:'Атака',kind:'атака',img:''}];
 const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 const env={cfg:{autoRoles:true,combatProfile:'auto',nAttack:'',nPower:'Blaze'},rt:{prof:'Arcana Lord',classBranch:'fighter',classCur:{prof:'dwarf_bounty_hunter',slot:1},skills:{},weapons:[],panelKnown:[]},
 isBattle:()=>true,panelInventory:()=>panel,ilOf:()=>null,noEffect:()=>false,names,iconStem:s=>s,itemOf:()=>null,itemByIcon:()=>null,
 expDmg:()=>0,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,ilNum:x=>x,isEquip:()=>false,heroLevel:()=>40,itemsDb:async()=>{},FREE_HIT:/x^/,
 slotsBy:n=>panel.filter(x=>names(n).includes(x.name.toLowerCase())),rec:()=>{},TAG:'test'};
 env.setRt=async p=>Object.assign(env.rt,p);env.setCfg=async p=>Object.assign(env.cfg,p);
 const b={cfg:env.cfg,rt:env.rt,isBattle:env.isBattle,panelInventory:env.panelInventory,ilOf:env.ilOf,console,Date,Math,
 document:{querySelectorAll:()=>panel},chrome:{storage:{local:{get:async()=>({cfg:env.cfg})}}}};
 vm.createContext(b);
 vm.runInContext(src.slice(src.indexOf("const W2H ="),src.indexOf('const heroLevel =',src.indexOf('const W2H =')))+'\n'+src.slice(src.indexOf('const normalizeProfession ='),src.indexOf('function classWeaponTypes(...args)'))+'\nthis.profile=combatProfileKind;this.norm=normalizeProfession;this.cw=CLASS_W;',b);
 Object.assign(env,{combatProfileKind:b.profile,normalizeProfession:b.norm,CLASS_W:b.cw,MAGE:'#mage'});
 vm.runInContext(read('modules/equipment.js'),b);
 return {env,panel,E:b.L2V7Factories.equipment(env)};
}
test('Bounty Hunter активен при старой профессии Arcana Lord: автороли возвращают атаку',async()=>{
 const {env,E}=fixture();assert.equal(env.combatProfileKind(),'fighter');assert.equal(E.suggestRoles().roles.nAttack,'Атака');
 await E.autoRoles();assert.equal(env.cfg.nAttack,'Атака');assert.ok(env.slotsBy(env.cfg.nAttack).length);assert.ok(E.classWeaponTypes().types.includes('древковое'));
});
test('переключение обратно на Arcana Lord убирает автоатаку',async()=>{
 const {env,E}=fixture();await E.autoRoles();env.rt.classCur={prof:'human_arcana_lord',slot:0};env.rt.prof='Bounty Hunter';env.rt.classBranch='fighter';
 assert.equal(env.combatProfileKind(),'mage_summoner');await E.autoRoles();assert.equal(env.cfg.nAttack,'');assert.equal(E.classWeaponTypes().types[0],'#mage');
});
test('нативные профессии разных рас имеют приоритет над старым магом',()=>{
 const {env}=fixture();for(const prof of ['dwarf_bounty_hunter','dwarf_fortune_seeker','human_warlord','dark_elf_shillien_knight','elf_sword_singer']){
 env.rt.classCur.prof=prof;env.rt.classBranch='fighter';assert.equal(env.combatProfileKind(),'fighter',prof);}
 env.rt.classCur.prof='dark_elf_spellhowler';assert.equal(env.combatProfileKind(),'mage_summoner');
});
test('ручной профиль и выключенные автороли сохраняются; без API остаётся прежний fallback',async()=>{
 const {env,E}=fixture();env.cfg.combatProfile='mage_summoner';assert.equal(env.combatProfileKind(),'mage_summoner');
 env.cfg.combatProfile='fighter';assert.equal(env.combatProfileKind(),'fighter');env.cfg.combatProfile='auto';env.cfg.autoRoles=false;await E.autoRoles();assert.equal(env.cfg.nAttack,'');
 env.rt.classCur=null;assert.equal(env.combatProfileKind(),'mage_summoner');env.rt.prof='Bounty Hunter';assert.equal(env.combatProfileKind(),'fighter');
 env.rt.prof='';assert.equal(env.combatProfileKind(),'fighter');
});
