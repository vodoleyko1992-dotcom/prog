'use strict';
// 24.10 (лог 10:54, Dreadnought — 3-я профессия саба Warlord): новые навыки пики приходят именованными actionId.
// Без ID бот считал Око мисливця/Око вбивці/Стійку парування «силовыми» и тратил ходы «пробую новый удар».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
const PANEL=[['whirlwind','Вихор'],['thunder_storm','Грозова буря'],['earthquake','Землетрус'],['shock_blast','Ударний імпульс'],['eye_slayer','Око вбивці'],
 ['eye_hunter','Око мисливця'],['parry_stance','Стійка парування'],['vicious_stance','Жорстка стійка'],['war_cry','Бойовий клич']];
const OLD=['вихор','грозова буря','жорстка стійка','бойовий клич'];   // прежние ID уже были отремонтированы warriorRoles1027
function fixture(){
 const box={Date,rt:{skillDb:{}}},core=read('content.js');vm.createContext(box);
 vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const panel=PANEL.map(([cdKey,name])=>({cdKey,name,kind:'скилл'}));
 // Роли игрока из выгрузки 24.10 10:55 (автороли уже записали ошибочные силовые).
 const env={on:true,tabOwner:true,cfg:{autoRoles:true,nBuffs:'Бойовий клич',nToggles:'Жорстка стійка',nStun:'Грозова буря',
   nPower:'Вихор, Грозова буря, Землетрус, Ударний імпульс, Око вбивці, Око мисливця, Стійка парування'},
  rt:{char:'Hero',classCur:{prof:'human_dreadnought',slot:3},weapons:[],panelKnown:panel.map(x=>x.name.toLowerCase()),warriorRoles1027:OLD,warlordDetectRoles2050:{},warlordToggleRoles2049:{312:true}},
  isBattle:()=>true,actionGeneration:()=>1,itemsDb:async()=>{},panelInventory:()=>panel,ilOf:box.ilOf,normalizeProfession:s=>s,CLASS_W:{},isEquip:()=>false,combatProfileKind:()=> 'fighter',
  cleanTitle:s=>s,slotAction:b=>b.cdKey,noEffect:()=>false,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>500,ilNum:x=>Array.isArray(x)?x[0]:x,itemOf:()=>null,iconStem:x=>x,
  FREE_HIT:/x^/,names,slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===n),setCfg:async p=>{Object.assign(env.cfg,p);return{ok:true}},setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rec:()=>{}};
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};vm.runInContext(read('modules/equipment.js'),box);
 return{env,panel,ilOf:box.ilOf,E:box.L2V7Factories.equipment(env)};
}
test('ID новых навыков Dreadnought по actionId панели',()=>{
 const {ilOf}=fixture();
 for(const [k,id] of [['earthquake',347],['shock_blast',361],['eye_hunter',359],['eye_slayer',360],['parry_stance',339]])assert.equal(ilOf({cdKey:k,name:''})?.id,id,k);
 for(const id of [359,360]){const x=ilOf({cdKey:id===359?'eye_hunter':'eye_slayer',name:''});assert.equal(x.autoUse,false);assert.equal(x.managedDetect,true);assert.equal(x.c,'Бафф');}
 assert.equal(ilOf({cdKey:'parry_stance',name:''}).autoUse,false,'защитная стойка −20% скорости атаки не включается');
 assert.equal(ilOf({cdKey:'earthquake',name:''}).reuse,4700,'откат сервера, не 30 с Interlude');
});
test('автороли один раз чинят силовые: Око и Стійка парування — не удары, Землетрус/Ударний імпульс остаются',async()=>{
 const f=fixture();await f.E.autoRoles();
 const p=names(f.env.cfg.nPower);
 for(const n of ['вихор','грозова буря','землетрус','ударний імпульс'])assert.ok(p.includes(n),n);
 for(const n of ['око вбивці','око мисливця','стійка парування'])assert.equal(p.includes(n),false,n);
 const b=names(f.env.cfg.nBuffs);assert.ok(b.includes('око вбивці')&&b.includes('око мисливця')&&b.includes('бойовий клич'));
 assert.equal(names(f.env.cfg.nToggles).includes('стійка парування'),false);
 assert.equal(names(f.env.cfg.nUltra).includes('землетрус'),false);
 assert.ok(names(f.env.cfg.nStun).includes('ударний імпульс'),'оглушение по шансу');
 assert.equal(f.env.rt.warlordDetectRoles2050[359],true);assert.equal(f.env.rt.warlordDetectRoles2050[360],true);
 // Последующее ручное удаление сохраняется.
 f.env.cfg.nBuffs='Бойовий клич, Око мисливця';f.env.cfg.nPower='Вихор, Око вбивці';await f.E.autoRoles();
 assert.equal(f.env.cfg.nBuffs,'Бойовий клич, Око мисливця');assert.equal(f.env.cfg.nPower,'Вихор, Око вбивці');
});
test('Warlord-сбор группы знает новые массовые удары пики',()=>{
 const src=read('modules/combat.js');assert.match(src,/\['whirlwind','thunder_storm','earthquake','shock_blast'\]\.includes\(env\.slotAction\(b\)\)/);
});

test('все пять Вразливостей и оба Ока остаются в баффах вместе (они складываются)',async()=>{
 const f=fixture();const det=[['detect_insect_weakness','Вразливість комах'],['detect_animal_weakness','Вразливість звірів'],['detect_plant_weakness','Вразливість рослин'],['detect_monster_weakness','Вразливість монстрів'],['detect_dragon_weakness','Вразливість драконів']];
 for(const [cdKey,name] of det)f.panel.push({cdKey,name,kind:'скилл'});
 f.env.rt.warlordDetectRoles2050={75:true,87:true,104:true,80:true,88:true};f.env.rt.warriorRoles1027=[...OLD,...det.map(x=>x[1].toLowerCase())];f.env.rt.panelKnown=f.panel.map(x=>x.name.toLowerCase());
 f.env.cfg.nBuffs='Бойовий клич, '+det.map(x=>x[1]).join(', ');await f.E.autoRoles();
 const b=names(f.env.cfg.nBuffs);for(const n of [...det.map(x=>x[1].toLowerCase()),'око мисливця','око вбивці'])assert.ok(b.includes(n),n);
});
