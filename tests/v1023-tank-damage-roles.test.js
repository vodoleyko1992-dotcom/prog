'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8'),content=read('content.js');
function fixture(){
 const panel=[['Атака','attack','атака'],['Power Strike','l2_3'],['Corpse Plague','corpse_plague'],['Hamstring','hamstring_slash'],['Majesty','l2_82'],['Summon Dark Panther','l2_283'],['Удар щитом','l2_92']].map(([name,cdKey,kind])=>({name,title:name,cdKey,kind:kind||'скилл',img:'',querySelector:()=>null}));
 const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 const env={cfg:{autoRoles:true,nPower:'Power Strike',nAttack:'Атака'},rt:{skills:{},weapons:[],panelKnown:panel.map(x=>x.name.toLowerCase())},
 isBattle:()=>true,panelInventory:()=>panel,combatProfileKind:()=> 'fighter',noEffect:()=>false,names,iconStem:s=>s,itemOf:()=>null,expDmg:()=>4000,
 isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,ilNum:x=>Array.isArray(x)?x[0]:x,normalizeProfession:x=>x||'',CLASS_W:{},isEquip:()=>false,
 slotsBy:n=>panel.filter(x=>names(n).includes(x.name.toLowerCase())),heroLevel:()=>60,itemByIcon:()=>null,itemsDb:async()=>{},FREE_HIT:/x^/,
 setRt:async p=>Object.assign(env.rt,p),setCfg:async p=>Object.assign(env.cfg,p),rec:()=>{},TAG:'test'};
 const b={console:{log(){}},Date,Math,rt:env.rt,setRt:env.setRt,chrome:{storage:{local:{get:async()=>({cfg:env.cfg})}}}},ctx=vm.createContext(b);
 vm.runInContext(read('skills-il.js')+'\n'+content.slice(content.indexOf("const IL = typeof IL_DB"),content.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',ctx);
 env.ilOf=b.ilOf;vm.runInContext(read('modules/equipment.js'),ctx);
 return {env,panel,E:b.L2V7Factories.equipment(env),b};
}
test('реальные ID/ключи навыков распознаются как прямой урон, без старой цели-трупа',()=>{
 const f=fixture();for(const [name,key,id]of [['Corpse Plague','corpse_plague',103],['Hamstring','hamstring_slash',127]]){
 for(const input of [name,{name,cdKey:key},{name:'локальное имя',cdKey:'l2_'+id},{name:'локальное имя',cdKey:key}]){const il=f.env.ilOf(input);assert.equal(il.id,id);assert.equal(il.target,'ONE');assert.equal(il.l2Damage,true);assert.ok(/атака/.test(il.c));}}
 const roles=f.E.suggestRoles().roles;assert.match(roles.nPower,/Corpse Plague/);assert.match(roles.nPower,/Hamstring/);assert.doesNotMatch(roles.nPower,/Majesty|Panther|Удар щитом/);
});
test('ранее виденные навыки добавляются к Power Strike один раз',async()=>{
 const f=fixture();await f.E.autoRoles();assert.match(f.env.cfg.nPower,/Power Strike/);assert.match(f.env.cfg.nPower,/Corpse Plague/);assert.match(f.env.cfg.nPower,/Hamstring/);
 f.env.cfg.nPower='Power Strike';await f.E.autoRoles();assert.equal(f.env.cfg.nPower,'Power Strike');
});
test('выключенные автороли не меняют настройку и не отмечают миграцию',async()=>{
 const f=fixture();f.env.cfg.autoRoles=false;await f.E.autoRoles();assert.equal(f.env.cfg.nPower,'Power Strike');assert.equal(f.env.rt.damageRoles1023,undefined);
});
test('отсутствующий на панели навык не добавляется и не считается исправленным',async()=>{
 const f=fixture();f.panel.splice(f.panel.findIndex(x=>x.name==='Hamstring'),1);await f.E.autoRoles();assert.doesNotMatch(f.env.cfg.nPower,/Hamstring/);assert.ok(!f.env.rt.damageRoles1023.includes('hamstring'));
});
test('сбой сохранения ролей не закрывает повторную попытку исправления',async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async()=>{throw Error('storage failure')};await assert.rejects(f.E.autoRoles(),/storage failure/);assert.equal(f.env.rt.damageRoles1023,undefined);
 f.env.setCfg=save;await f.E.autoRoles();assert.match(f.env.cfg.nPower,/Hamstring/);
});

test('исправление ранее известного локализованного имени использует ключ панели',async()=>{
 const f=fixture(),s=f.panel.find(x=>x.name==='Corpse Plague');s.name=s.title='Чума трупа';f.env.rt.panelKnown=f.panel.map(x=>x.name.toLowerCase());await f.E.autoRoles();assert.match(f.env.cfg.nPower,/Чума трупа/);
});
