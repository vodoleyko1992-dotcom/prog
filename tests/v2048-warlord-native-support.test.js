'use strict';
// 20.48: безопасные поля panelHotbarSkills из живого GET /character 22.10.2026.
// Локальные названия теряли тип поддержки, пока именованные actionId не были связаны с ID навыков.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),source=read('content.js');
const native=[
 {id:'battle_roar',labelUk:'Бойовий рик (Battle Roar)',l2SkillId:121,iconUrl:'/skills/0121.jpg'},
 {id:'lionheart',labelUk:'Левине серце (Lionheart)',l2SkillId:287,iconUrl:'/skills/0287.jpg'}
];
const names=s=>String(s||'').toLowerCase().split(',').map(n=>n.trim()).filter(Boolean);
function fixture(){
 const box={console:{log(){}},Date,rt:{skillDb:{}}};vm.createContext(box);
 vm.runInContext(read('skills-il.js')+'\n'+source.slice(source.indexOf('const IL = typeof IL_DB'),source.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const panel=native.map(x=>({cdKey:x.id,name:x.labelUk.split(/\s*\(/)[0],title:x.labelUk,kind:'скилл',img:x.iconUrl}));
 panel.push({cdKey:'whirlwind',name:'Вихор',title:'Вихор (Whirlwind)',kind:'скилл'});
 const env={cfg:{},rt:{},normalizeProfession:()=>'',CLASS_W:{},isEquip:()=>false,ilOf:box.ilOf,panelInventory:()=>panel,
  combatProfileKind:()=> 'fighter',cleanTitle:s=>String(s||'').split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,
  noEffect:()=>false,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>500,
  ilNum:x=>Array.isArray(x)?x[0]:x,itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,names,
  isBattle:()=>true,itemsDb:async()=>{},slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===n),
  setCfg:async p=>Object.assign(env.cfg,p),setRt:async p=>Object.assign(env.rt,p),rec:()=>{},TAG:'test'};
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};
 vm.runInContext(read('modules/equipment.js'),box);box.env=env;
 const combat=read('modules/combat.js');
 vm.runInContext(combat.slice(combat.indexOf('function nonOffenseSkill('),combat.indexOf('\nconst petNote'))+'\nthis.blocked=nonOffenseSkill;',box);
 return {box,panel,env,E:box.L2V7Factories.equipment(env)};
}
for(const row of native)test(row.id+': реальный локализованный слот распознаётся по actionId',()=>{
 const f=fixture(),slot=f.panel.find(x=>x.cdKey===row.id);
 assert.equal(f.box.ilOf(slot)?.id,row.l2SkillId);
 assert.equal(f.box.ilOf({getAttribute:key=>key==='data-slot-cd'?row.id:null,title:row.labelUk})?.id,row.l2SkillId,'тот же native ID на DOM-кнопке');
 assert.equal(f.box.ilOf(slot.name)?.id,row.l2SkillId,'имя из наблюдённой панели сохраняет связь с ID');
});
test('автороли отправляют Battle Roar в лечение, Lionheart в баффы, Whirlwind остаётся ударом',()=>{
 const f=fixture(),r=f.E.suggestRoles().roles;
 assert.deepEqual(names(r.nPower),['вихор']);
 assert.deepEqual(names(r.nHeal),['бойовий рик']);
 assert.deepEqual(names(r.nBuffs),['левине серце']);
 for(const role of ['nStun','nToggles','nKeyBuffs','nUltra','nDrain'])assert.deepEqual(names(r[role]),[],role);
});
test('старая ошибочная роль nPower не позволяет нажимать native поддержку как удар',()=>{
 const f=fixture();
 for(const slot of f.panel)assert.equal(f.box.blocked(slot),slot.cdKey!=='whirlwind',slot.name);
});
test('native поддержка сохраняет английское и l2_ID распознавание без новых игровых коэффициентов',()=>{
 const f=fixture();
 for(const [name,id,kind]of [['Battle Roar',121,'Лечение'],['Lionheart',287,'Бафф']]){
  const byName=f.box.ilOf(name),byId=f.box.ilOf({cdKey:'l2_'+id,title:name});
  assert.equal(byName.id,id);assert.equal(byId.id,id);assert.equal(byName.c,kind);
  assert.deepEqual(JSON.parse(JSON.stringify(byId)),JSON.parse(JSON.stringify(f.box.ilOf(f.panel.find(x=>x.cdKey===native.find(n=>n.l2SkillId===id).id)))));
 }
 assert.equal(f.box.ilOf({cdKey:'unseen_support',title:'Невідомий навик'}),null,'неизвестные имена не угадываются');
});
function installed(){
 const f=fixture();
 f.panel.push({cdKey:'custom',name:'Свій удар',title:'Свій удар',kind:'скилл'},
  {cdKey:'l2_1011',name:'Власне лікування',title:'Власне лікування',kind:'скилл'},
  {cdKey:'l2_1040',name:'Власний баф',title:'Власний баф',kind:'скилл'});
 Object.assign(f.env.cfg,{autoRoles:true,nPower:'Бойовий рик, Левине серце, Свій удар',nHeal:'Власне лікування',nBuffs:'Власний баф'});
 f.env.rt.panelKnown=f.panel.map(x=>x.name.toLowerCase());f.env.rt.warriorRoles1027=['вихор'];
 return f;
}
test('установленные автороли исправляют уже виденную поддержку, сохраняя свои строки',async()=>{
 const f=installed();await f.E.autoRoles();
 assert.deepEqual(names(f.env.cfg.nPower),['свій удар']);
 assert.deepEqual(names(f.env.cfg.nHeal),['власне лікування','бойовий рик']);
 assert.deepEqual(names(f.env.cfg.nBuffs),['власний баф','левине серце']);
 assert.ok(f.env.rt.warriorRoles1027.includes('бойовий рик'));
 assert.ok(f.env.rt.warriorRoles1027.includes('левине серце'));
});
test('после ремонта повтор не возвращает вручную удалённую поддержку',async()=>{
 const f=installed();await f.E.autoRoles();
 f.env.cfg.nHeal='Власне лікування';f.env.cfg.nBuffs='Власний баф';
 await f.E.autoRoles();
 assert.equal(f.env.cfg.nHeal,'Власне лікування');assert.equal(f.env.cfg.nBuffs,'Власний баф');
 assert.deepEqual(names(f.env.cfg.nPower),['свій удар']);
});
test('выключенные автороли сохраняют прежние назначения, боевой запрет поддержки остаётся',async()=>{
 const f=installed(),before=JSON.stringify(f.env.cfg);f.env.cfg.autoRoles=false;
 f.env.itemsDb=()=>assert.fail('OFF не начинает ремонт');
 await f.E.autoRoles();
 assert.equal(JSON.stringify({...f.env.cfg,autoRoles:true}),before);
 for(const x of f.panel.filter(x=>['battle_roar','lionheart'].includes(x.cdKey)))assert.equal(f.box.blocked(x),true);
});
test('отказ записи ролей не помечает ремонт поддержки завершённым',async()=>{
 const f=installed();f.env.setCfg=async()=>{throw Error('storage failed')};
 await assert.rejects(f.E.autoRoles(),/storage failed/);
 assert.deepEqual(f.env.rt.warriorRoles1027,['вихор']);
 f.env.setCfg=async p=>Object.assign(f.env.cfg,p);await f.E.autoRoles();
 assert.deepEqual(names(f.env.cfg.nPower),['свій удар']);
 assert.ok(names(f.env.cfg.nHeal).includes('бойовий рик'));
});
