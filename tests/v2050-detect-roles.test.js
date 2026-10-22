'use strict';
// 20.50: Detect добавляются в баффы Warlord по ID один раз; применение остаётся отдельному контроллеру.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),core=read('content.js');
const names=s=>String(s||'').toLowerCase().split(',').map(n=>n.trim()).filter(Boolean);
const detects={75:['detect_insect_weakness','Detect Insect Weakness','Вразливість комах'],87:['detect_animal_weakness','Detect Animal Weakness','Вразливість звірів'],104:['detect_plant_weakness','Detect Plant Weakness','Вразливість рослин']};
const exact=Object.fromEntries(Object.entries(detects).flatMap(([id,entry])=>entry.slice(1).map(n=>[n.toLowerCase(),+id])));
function fixture(){
 const box={console:{log(){}},Date,rt:{skillDb:{}}};vm.createContext(box);
 vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const make=(id,english=false)=>({cdKey:detects[id][0],name:detects[id][english?1:2],kind:'скилл'});
 const panel=[make(75),make(87),make(104)],events=[],writes=[];let managed=true,generation=7;
 // Контракт core-правки: generic autoUse:false и старый st не меняются, добавляется managedDetect:true.
 const ilOf=x=>{const il=box.ilOf(x);return detects[il?.id]?{...il,managedDetect:managed}:il};
 const env={cfg:{autoRoles:true,nBuffs:'Свій бафф'},rt:{char:'Hero',prof:'Warlord',classCur:{prof:'human_warlord',slot:3},weapons:[]},
  on:true,tabOwner:true,isBattle:()=>true,actionGeneration:()=>generation,itemsDb:async()=>{},panelInventory:()=>panel,ilOf,
  normalizeProfession:s=>String(s||'').toLowerCase(),CLASS_W:{},isEquip:()=>false,combatProfileKind:()=> 'fighter',
  cleanTitle:s=>String(s||'').split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,noEffect:()=>false,
  isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>500,ilNum:x=>Array.isArray(x)?x[0]:x,
  itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,names,slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===String(n).toLowerCase()),
  setCfg:async p=>{events.push('cfg');writes.push(structuredClone(p));Object.assign(env.cfg,p);return {ok:true}},
  setRt:async p=>{events.push(Object.hasOwn(p,'warlordDetectRoles2050')?'mark':'rt');Object.assign(env.rt,p);return {ok:true}},rec:()=>{},TAG:'test'};
 env.rt.panelKnown=panel.map(x=>x.name.toLowerCase());env.rt.warriorRoles1027=[...env.rt.panelKnown];
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};vm.runInContext(read('modules/equipment.js'),box);
 return {box,env,panel,events,writes,make,managed:v=>{managed=v},nextGeneration:()=>generation++,E:box.L2V7Factories.equipment(env)};
}
const roleIds=(f,role)=>names(role).map(n=>f.env.ilOf(n)?.id??exact[n]).filter(id=>detects[id]);
const markIds=f=>Object.keys(f.env.rt.warlordDetectRoles2050||{}).filter(id=>f.env.rt.warlordDetectRoles2050[id]).map(Number).sort((a,b)=>a-b);
test('managed Detect предлагаются только в обычные баффы, generic запрет и st сохраняются',()=>{
 const f=fixture(),s=f.E.suggestRoles();assert.deepEqual(roleIds(f,s.roles.nBuffs),[75,87,104]);
 for(const [k,v]of Object.entries(s.roles).filter(([k])=>k!=='nBuffs'))assert.deepEqual(roleIds(f,v),[],k);
 for(const p of f.panel){const il=f.env.ilOf(p);assert.equal(il.autoUse,false);assert.equal(il.managedDetect,true);assert.equal(il.st,'detect_weakness');}
});
test('использованный обычный бафф не скрывает Detect и не возвращает остальные неиспользованные баффы',()=>{
 const f=fixture();f.panel.unshift({cdKey:'war_cry',name:'War Cry',kind:'скилл'},{cdKey:'l2_287',name:'Lionheart',kind:'скилл'});
 f.env.damageSkills={'war cry':{usesU:4}};const out=names(f.E.suggestRoles().roles.nBuffs);
 assert.ok(out.includes('war cry'));assert.ok(!out.includes('lionheart'));assert.deepEqual(roleIds(f,out.join(', ')),[75,87,104]);
});
test('назначение Detect не открывает им обычный buffList; обычный выбранный бафф остаётся',async()=>{
 const f=fixture();f.panel.unshift({cdKey:'war_cry',name:'War Cry',kind:'скилл'});f.env.cfg.nBuffs='War Cry';
 await f.E.autoRoles();assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[75,87,104]);
 vm.runInContext(read('modules/buffs.js'),f.box);const buffs=f.box.L2V7Factories.buffs({...f.env,isTotem:()=>false});
 assert.equal(JSON.stringify(buffs.buffList({rb:true})),JSON.stringify(['war cry']));
});
for(const prof of ['human_warlord','human_dreadnought','Warlord','Dreadnought','human-warlord','Human Dreadnought'])test('подтверждённый класс без требования оружия: '+prof,async()=>{
 const f=fixture();f.env.rt.prof='Maestro';f.env.rt.classCur.prof=prof;await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[75,87,104]);assert.deepEqual(markIds(f),[75,87,104]);
});
for(const prof of ['dwarf_maestro','human_warrior','human_gladiator',''])test('другой или неизвестный classCur не получает Detect: '+(prof||'unknown'),async()=>{
 const f=fixture();f.env.rt.classCur.prof=prof;f.env.rt.prof=prof?'Warlord':'';
 assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nBuffs),[]);await f.E.autoRoles();
 assert.equal(f.env.cfg.nBuffs,'Свій бафф');assert.deepEqual(markIds(f),[]);
 for(const why of f.E.suggestRoles().why)assert.doesNotMatch(why,/25\s*%|Frenzy|Zealot/i);
});
test('если classCur не известен, подтверждённый сохранённый Warlord остаётся допустимым',async()=>{
 const f=fixture();f.env.rt.classCur=null;await f.E.autoRoles();assert.deepEqual(markIds(f),[75,87,104]);
});
test('пустая старая роль заполняется, прежние warrior/toggle markers не сбрасываются',async()=>{
 const f=fixture();f.env.cfg.nBuffs='';f.env.rt.warlordToggleRoles2049={312:true,317:true};
 const old=JSON.stringify({warrior:f.env.rt.warriorRoles1027,toggle:f.env.rt.warlordToggleRoles2049});await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[75,87,104]);assert.ok(f.events.indexOf('cfg')<f.events.indexOf('mark'));
 assert.equal(JSON.stringify({warrior:f.env.rt.warriorRoles1027,toggle:f.env.rt.warlordToggleRoles2049}),old);
});
test('непустая роль сохраняет свой бафф и дописывается один раз',async()=>{
 const f=fixture();await f.E.autoRoles();assert.equal(names(f.env.cfg.nBuffs)[0],'свій бафф');const saved=f.env.cfg.nBuffs;
 await f.E.autoRoles();assert.equal(f.env.cfg.nBuffs,saved);assert.equal(f.writes.length,1);
});
test('выбранные English aliases проходят ACK без добавления украинских дублей',async()=>{
 const f=fixture(),saved='Свій бафф, Detect Plant Weakness, Detect Animal Weakness, Detect Insect Weakness';f.env.cfg.nBuffs=saved;
 await f.E.autoRoles();assert.equal(f.env.cfg.nBuffs,saved);assert.deepEqual(markIds(f),[75,87,104]);assert.equal(f.writes.length,1);assert.ok(f.events.indexOf('cfg')<f.events.indexOf('mark'));
});
test('сохранённые фактические UA aliases не дублируются свежей английской панелью',async()=>{
 const f=fixture();f.panel.splice(0,f.panel.length,...[75,87,104].map(id=>f.make(id,true)));
 f.env.rt.panelKnown=f.panel.map(x=>x.name.toLowerCase());f.env.rt.warriorRoles1027=[...f.env.rt.panelKnown];
 assert.equal(f.env.ilOf('Вразливість звірів'),null);const saved='Свій бафф, Вразливість звірів, Вразливість комах, Вразливість рослин';f.env.cfg.nBuffs=saved;
 await f.E.autoRoles();assert.equal(f.env.cfg.nBuffs,saved);assert.deepEqual(markIds(f),[75,87,104]);
});
test('дубли aliases одной native ID убираются из предложения и merged роли, похожий custom остаётся',async()=>{
 const f=fixture();f.panel.push(...[75,87,104].map(id=>f.make(id,true)));
 const custom='My Detect Animal Weakness';f.env.cfg.nBuffs=custom+', Detect Insect Weakness, Вразливість комах';
 assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nBuffs),[75,87,104]);await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[75,87,104]);assert.equal(names(f.env.cfg.nBuffs)[0],custom.toLowerCase());
});
test('неизвестная native панель не ремонтируется по одному украинскому тексту',async()=>{
 const f=fixture();f.panel.splice(0,f.panel.length,{...f.make(75),cdKey:'unknown_detect'});
 await f.E.autoRoles();assert.deepEqual(markIds(f),[]);assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[]);
});
for(const absent of [75,87,104])test('каждый ID помечается отдельно и добавляется при позднем появлении: '+absent,async()=>{
 const f=fixture();f.panel.splice(0,f.panel.length,...[75,87,104].filter(id=>id!==absent).map(id=>f.make(id)));
 await f.E.autoRoles();assert.deepEqual(markIds(f),[75,87,104].filter(id=>id!==absent));
 f.panel.push(f.make(absent));await f.E.autoRoles();assert.deepEqual(markIds(f),[75,87,104]);assert.deepEqual(new Set(roleIds(f,f.env.cfg.nBuffs)),new Set([75,87,104]));
});
test('ручное удаление всех Detect сохраняется при пустой роли и новом языке панели',async()=>{
 const f=fixture();await f.E.autoRoles();f.env.cfg.nBuffs='';f.panel.push(...[75,87,104].map(id=>f.make(id,true)));await f.E.autoRoles();
 assert.equal(f.env.cfg.nBuffs,'');assert.equal(f.writes.length,1);assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nBuffs),[75,87,104]);
});
test('поздний Plant после ручного удаления первых двух не возвращает75/87',async()=>{
 const f=fixture();f.panel.splice(2,1);await f.E.autoRoles();f.env.cfg.nBuffs='';
 f.panel.splice(0,f.panel.length,...[75,87,104].map(id=>f.make(id,true)));await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nBuffs),[104]);assert.deepEqual(markIds(f),[75,87,104]);
});
test('autoRoles:false полностью сохраняет cfg/rt и не читает itemsDb',async()=>{
 const f=fixture();f.env.cfg.autoRoles=false;const before=JSON.stringify([f.env.cfg,f.env.rt]);f.env.itemsDb=()=>assert.fail('OFF');
 await f.E.autoRoles();assert.equal(JSON.stringify([f.env.cfg,f.env.rt]),before);assert.deepEqual(f.events,[]);
});
test('вне боя ремонт не запускается и не читает itemsDb',async()=>{
 const f=fixture();f.env.isBattle=()=>false;f.env.itemsDb=()=>assert.fail('outside');await f.E.autoRoles();assert.deepEqual(f.events,[]);
});
for(const missing of ['managed','noEffect','non-skill'])test('непригодный Detect ждёт без ранней отметки: '+missing,async()=>{
 const f=fixture();f.panel.splice(0,2);if(missing==='managed')f.managed(false);if(missing==='noEffect')f.env.noEffect=()=>true;if(missing==='non-skill')f.panel[0].kind='предмет';
 await f.E.autoRoles();assert.deepEqual(markIds(f),[]);assert.equal(f.env.cfg.nBuffs,'Свій бафф');
 f.managed(true);f.env.noEffect=()=>false;f.panel[0].kind='скилл';await f.E.autoRoles();assert.deepEqual(markIds(f),[104]);
});
for(const failure of ['throw','negative-ack'])test('неуспешный cfg не помечает ID, повтор успешен: '+failure,async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async()=>{if(failure==='throw')throw Error('storage failed');return {ok:false}};
 if(failure==='throw')await assert.rejects(f.E.autoRoles(),/storage failed/);else await f.E.autoRoles();
 assert.deepEqual(markIds(f),[]);f.env.setCfg=save;await f.E.autoRoles();assert.deepEqual(markIds(f),[75,87,104]);
});
test('успешный core setCfg без возвращаемого значения подтверждает ремонт после resolve',async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async p=>{await save(p)};await f.E.autoRoles();assert.deepEqual(markIds(f),[75,87,104]);
});
test('новое отключение авторолей в storage до обновления env не переписывается',async()=>{
 const f=fixture();f.box.chrome.storage.local.get=async()=>({cfg:{...f.env.cfg,autoRoles:false}});await f.E.autoRoles();
 assert.equal(f.writes.length,0);assert.deepEqual(markIds(f),[]);assert.equal(f.env.cfg.nBuffs,'Свій бафф');
});
test('новая ручная строка в storage до обновления env не теряется при ремонте',async()=>{
 const f=fixture();f.box.chrome.storage.local.get=async()=>({cfg:{...f.env.cfg,nBuffs:'Новий ручний бафф'}});await f.E.autoRoles();
 assert.equal(f.writes.length,0);assert.deepEqual(markIds(f),[]);
});
const invalidate={off:f=>{f.env.cfg.autoRoles=false},stop:f=>{f.env.on=false},owner:f=>{f.env.tabOwner=false},hero:f=>{f.env.rt.char='Other'},class:f=>{f.env.rt.classCur.prof='human_dreadnought'},slot:f=>{f.env.rt.classCur.slot=4},generation:f=>f.nextGeneration(),kick:f=>{f.env.rt.manualKickAt=123},classSwitch:f=>{f.env.rt.classSwT=123}};
for(const [reason,change]of Object.entries(invalidate))test('изменение контекста во время itemsDb не пишет Detect: '+reason,async()=>{
 const f=fixture();f.env.itemsDb=async()=>change(f);await f.E.autoRoles();assert.deepEqual(markIds(f),[]);assert.equal(f.env.cfg.nBuffs,'Свій бафф');assert.equal(f.writes.length,0);
});
for(const [reason,change]of Object.entries(invalidate))test('изменение контекста перед cfg не пишет Detect: '+reason,async()=>{
 const f=fixture();f.box.chrome.storage.local.get=async()=>{change(f);return {cfg:f.env.cfg}};await f.E.autoRoles();
 assert.deepEqual(markIds(f),[]);assert.equal(f.env.cfg.nBuffs,'Свій бафф');assert.equal(f.writes.length,0);
});
for(const [reason,change]of Object.entries(invalidate))test('изменение контекста после cfg ACK не ставит поздний marker: '+reason,async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async p=>{const ack=await save(p);change(f);return ack};await f.E.autoRoles();
 assert.equal(f.writes.length,1);assert.deepEqual(markIds(f),[]);
});
test('why Detect не обещает HP-жертву и в допустимом классе',()=>{
 const f=fixture();for(const why of f.E.suggestRoles().why){assert.match(why,/Detect/);assert.doesNotMatch(why,/25\s*%|Frenzy|Zealot/i);}
});
