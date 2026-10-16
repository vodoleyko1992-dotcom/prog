'use strict';
// 20.3: именованные actionId и роли с реальной панели Warlord из журнала16.10 07:15.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('content.js','utf8');
const entries=[['wild_sweep','Дикий розмах',245],['war_cry','Бойовий клич',78],['vicious_stance','Жорстка стійка',312],
 ['detect_animal_weakness','Вразливість звірів',87],['focus_attack','Зосереджений удар',317],['howl','Звіриний рев',116],
 ['detect_insect_weakness','Вразливість комах',75],['thrill_fight','Азарт бою',130],['whirlwind','Вихор',36],
 ['thunder_storm','Грозова буря',48],['detect_plant_weakness','Вразливість рослин',104],['provoke','Провокація масова',286]];
function fixture(){
 const box={console:{log(){}},Date,rt:{skillDb:{}}};vm.createContext(box);
 vm.runInContext(fs.readFileSync('skills-il.js','utf8')+'\n'+source.slice(source.indexOf('const IL = typeof IL_DB'),source.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const panel=entries.map(([cdKey,name])=>({cdKey,name,title:name,kind:'скилл'}));
 panel.push({cdKey:'custom',name:'Свой удар',title:'Свой удар',kind:'скилл'});
 const names=s=>String(s||'').toLowerCase().split(',').map(n=>n.trim()).filter(Boolean);
 const env={cfg:{},rt:{},normalizeProfession:()=>'',CLASS_W:{},isEquip:()=>false,ilOf:box.ilOf,panelInventory:()=>panel,
  combatProfileKind:()=> 'fighter',cleanTitle:s=>String(s||'').split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,noEffect:()=>false,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,
  expDmg:()=>500,ilNum:x=>Array.isArray(x)?x[0]:x,itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,names,
  isBattle:()=>true,itemsDb:async()=>{},slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===n),
  setCfg:async p=>Object.assign(env.cfg,p),setRt:async p=>Object.assign(env.rt,p),rec:()=>{},TAG:'test'};
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};
 vm.runInContext(fs.readFileSync('modules/equipment.js','utf8'),box);
 const combat=fs.readFileSync('modules/combat.js','utf8');box.env=env;
 vm.runInContext(combat.slice(combat.indexOf('function nonOffenseSkill('),combat.indexOf('\nconst petNote'))+'\nthis.blocked=nonOffenseSkill;',box);
 return {box,panel,env,E:box.L2V7Factories.equipment(env),names};
}
for(const [cdKey,name,id] of entries)test('native '+cdKey+' узнаётся по ID и локализованному имени',()=>{
 const f=fixture(),row=f.box.ilOf({cdKey,name});assert.equal(row?.id,id);assert.equal(f.box.ilOf(name)?.id,id);
});
test('урон, контроль и баффы распределены по назначению, ручные навыки не назначаются',()=>{
 const f=fixture(),r=f.E.suggestRoles().roles;
 assert.deepEqual(f.names(r.nPower).sort(),['дикий розмах','вихор','грозова буря','свой удар'].sort());
 assert.ok(f.names(r.nStun).includes('грозова буря'));assert.ok(f.names(r.nBuffs).includes('азарт бою'));
 assert.ok(f.names(r.nToggles).includes('жорстка стійка'));
 for(const n of ['зосереджений удар','провокація масова','вразливість звірів','вразливість комах','вразливість рослин'])
  assert.ok(!Object.values(r).some(v=>f.names(v).includes(n)),n+' остаётся ручным');
});
test('Howl 30с, Thrill Fight 300с; Focus — ручной тоггл, Provoke — ручное агро',()=>{
 const f=fixture();for(const p of f.panel)f.box.ilOf(p);
 assert.equal(f.box.ilOf('Звіриний рев').dur,30);assert.equal(f.box.ilOf('Азарт бою').dur,300);
 assert.equal(f.box.ilOf('Зосереджений удар').o,'TOGGLE');assert.equal(f.box.ilOf('Зосереджений удар').autoUse,false);
 assert.equal(f.box.ilOf('Провокація масова').autoUse,false);
});
test('старая ошибочная nPower не превращает поддержку в прямые атаки',()=>{
 const f=fixture();for(const p of f.panel){const damage=['wild_sweep','whirlwind','thunder_storm','custom'].includes(p.cdKey);assert.equal(f.box.blocked(p),!damage,p.name);}
 assert.equal(f.box.blocked({cdKey:'corpse_plague',title:'Corpse Plague'}),false,'подтверждённая прямая атака сохранена');
});
test('ремонт уже виденной панели однократный, свои роли и ручное удаление сохраняются',async()=>{
 const f=fixture();Object.assign(f.env.cfg,{autoRoles:true,nPower:f.panel.filter(p=>!['war_cry','vicious_stance'].includes(p.cdKey)).map(p=>p.name).join(', '),nBuffs:'Свой бафф',nToggles:'Свой тоггл'});
 f.env.rt.panelKnown=f.panel.map(p=>p.name.toLowerCase());
 f.env.rt.warriorRoles1027=['дикий розмах','бойовий клич','жорстка стійка'];
 await f.E.autoRoles();assert.deepEqual(f.names(f.env.cfg.nPower).sort(),['дикий розмах','вихор','грозова буря','свой удар'].sort());
 assert.ok(f.env.cfg.nBuffs.startsWith('Свой бафф'));assert.ok(f.names(f.env.cfg.nBuffs).includes('азарт бою'));
 assert.equal(f.env.cfg.nToggles,'Свой тоггл');
 f.env.cfg.nPower='Дикий розмах, Грозова буря, Свой удар';f.env.cfg.nBuffs='Свой бафф';
 await f.E.autoRoles();assert.ok(!f.names(f.env.cfg.nPower).includes('вихор'));assert.equal(f.env.cfg.nBuffs,'Свой бафф');
});
test('выключенные автороли не меняют выбор пользователя',async()=>{
 const f=fixture();f.env.cfg={autoRoles:false,nPower:'Провокація масова'};await f.E.autoRoles();assert.equal(f.env.cfg.nPower,'Провокація масова');
 assert.equal(f.box.blocked(f.panel.find(p=>p.cdKey==='provoke')),true,'боевой guard остаётся');
});
test('ошибка сохранения не помечает исправление выполненным',async()=>{
 const f=fixture();f.env.cfg={autoRoles:true,nPower:f.panel.map(p=>p.name).join(', '),nBuffs:'Свой бафф'};
 f.env.rt.panelKnown=f.panel.map(p=>p.name.toLowerCase());f.env.setCfg=async()=>{throw Error('storage failed')};
 await assert.rejects(f.E.autoRoles(),/storage failed/);assert.equal(f.env.rt.warriorRoles1027,undefined);
});
test('Final Frenzy остаётся пассивным эффектом',()=>{
 const f=fixture(),p={cdKey:'l2_290',title:'Final Frenzy'};assert.equal(f.box.ilOf(p).id,290);assert.equal(f.box.blocked(p),true);
});
test('ручные эффекты не выполняются из сохранённого списка баффов',()=>{
 const f=fixture();f.env.cfg.nBuffs='Азарт бою, Зосереджений удар, Провокація масова, Вразливість звірів';f.env.isTotem=()=>false;
 vm.runInContext(fs.readFileSync('modules/buffs.js','utf8'),f.box);
 const list=f.box.L2V7Factories.buffs(f.env).buffList();assert.equal(JSON.stringify(list),JSON.stringify(['азарт бою']));
});
test('Focus Attack не включается и не выключается автоматически даже при старой роли тоггла',async()=>{
 const f=fixture(),b=f.panel.find(p=>p.cdKey==='focus_attack'),box=f.box;
 Object.assign(box,{cfg:{nToggles:b.name},names:f.names,meMp:()=>({cur:500,max:500}),slotsBy:()=>[b],toggleState:()=>false});
 vm.runInContext(source.slice(source.indexOf('async function toggleStep('),source.indexOf('// ---------- 🩺'))+'\nthis.step=toggleStep;',box);
 let clicks=0;assert.equal(await box.step({block:{}},{},async()=>{clicks++;}),false);assert.equal(clicks,0);
 box.toggleState=()=>true;box.meMp=()=>({cur:0,max:500});assert.equal(await box.step({block:{}},{},async()=>{clicks++;}),false);assert.equal(clicks,0);
});
