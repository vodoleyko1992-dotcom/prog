'use strict';
// 20.49: отдельный ремонт постоянных тогглов Warlord по ID312/317, без возврата ручных удалений.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),core=read('content.js');
const names=s=>String(s||'').toLowerCase().split(',').map(n=>n.trim()).filter(Boolean);
function fixture(){
 const box={console:{log(){}},Date,rt:{skillDb:{}}};vm.createContext(box);
 vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const make=(id,english=false)=>({cdKey:id===317?'focus_attack':'vicious_stance',name:id===317?(english?'Focus Attack':'Фокусована атака'):(english?'Vicious Stance':'Жорстка стійка'),kind:'скилл'});
 const panel=[make(312),make(317)],events=[],writes=[];let managed=true;
 // Контракт отдельной metadata-правки:317 остаётся autoUse:false/o:TOGGLE и получает только managedToggle:true.
 const ilOf=x=>{const il=box.ilOf(x);return il?.id===317?{...il,managedToggle:managed}:il};
 const env={cfg:{autoRoles:true,nToggles:'Свій перемикач'},rt:{char:'Hero',prof:'Warlord',classCur:{prof:'human_warlord',slot:3},weapons:[]},
  on:true,tabOwner:true,isBattle:()=>true,itemsDb:async()=>{},panelInventory:()=>panel,ilOf,
  normalizeProfession:s=>String(s||'').toLowerCase(),CLASS_W:{},isEquip:()=>false,combatProfileKind:()=> 'fighter',
  cleanTitle:s=>String(s||'').split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,noEffect:()=>false,
  isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>500,ilNum:x=>Array.isArray(x)?x[0]:x,
  itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/,names,slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===String(n).toLowerCase()),
  setCfg:async p=>{events.push('cfg');writes.push(structuredClone(p));Object.assign(env.cfg,p)},
  setRt:async p=>{events.push(Object.hasOwn(p,'warlordToggleRoles2049')?'mark':'rt');Object.assign(env.rt,p);return {ok:true}},rec:()=>{},TAG:'test'};
 env.rt.panelKnown=panel.map(x=>x.name.toLowerCase());env.rt.warriorRoles1027=[...env.rt.panelKnown];
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};vm.runInContext(read('modules/equipment.js'),box);
 return {box,env,panel,events,writes,make,managed:v=>{managed=v},E:box.L2V7Factories.equipment(env)};
}
const roleIds=(f,role)=>names(role).map(n=>f.env.ilOf(n)?.id).filter(id=>id===312||id===317);
test('suggestRoles допускает managed317 только в тогглы, не в остальные автороли',()=>{
 const f=fixture(),suggestion=f.E.suggestRoles(),r=suggestion.roles;
 assert.deepEqual(roleIds(f,r.nToggles),[312,317]);
 for(const [k,v]of Object.entries(r).filter(([k])=>k!=='nToggles'))assert.deepEqual(roleIds(f,v),[],k);
 assert.equal(f.env.ilOf(f.panel[1]).autoUse,false);assert.equal(f.env.ilOf(f.panel[1]).managedToggle,true);
 const why=suggestion.why.find(s=>s.includes('Фокусована атака'));assert.match(why,/поддерживаю включённым/);assert.doesNotMatch(why,/25\s*%|Frenzy/i);
});
test('текущий classCur.prof важнее старого Warlord; другие классы сохраняют прежний generic312',async()=>{
 const f=fixture();f.env.rt.classCur.prof='dwarf_maestro';
 assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nToggles),[312]);
 await f.E.autoRoles();assert.equal(f.env.cfg.nToggles,'Свій перемикач');assert.equal(f.env.rt.warlordToggleRoles2049,undefined);
});
for(const prof of ['human_warlord','human_dreadnought','Warlord','Dreadnought','human-warlord','Human Dreadnought'])test('подтверждённая профессия получает оба ID без требования пики: '+prof,async()=>{
 const f=fixture();f.env.rt.prof='Maestro';f.env.rt.classCur.prof=prof;
 await f.E.autoRoles();assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);
 assert.equal(f.env.rt.warlordToggleRoles2049[312],true);assert.equal(f.env.rt.warlordToggleRoles2049[317],true);
});
test('пустая строка старой установки заполняется, старая warriorRoles1027 не сбрасывается',async()=>{
 const f=fixture(),old=[...f.env.rt.warriorRoles1027];f.env.cfg.nToggles='';
 await f.E.autoRoles();assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);
 assert.deepEqual(f.env.rt.warriorRoles1027,old);assert.ok(f.events.indexOf('cfg')<f.events.indexOf('mark'));
});
test('непустая строка сохраняет пользовательский тоггл и дописывает оба ID один раз',async()=>{
 const f=fixture();await f.E.autoRoles();
 assert.equal(names(f.env.cfg.nToggles)[0],'свій перемикач');assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);
 const value=f.env.cfg.nToggles;await f.E.autoRoles();assert.equal(f.env.cfg.nToggles,value);assert.equal(f.writes.length,1);
});
test('уже выбранные английские aliases не дублируются украинскими именами панели',async()=>{
 const f=fixture();f.env.cfg.nToggles='Свій перемикач, Focus Attack, Vicious Stance';
 await f.E.autoRoles();assert.equal(f.env.cfg.nToggles,'Свій перемикач, Focus Attack, Vicious Stance');
 assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[317,312]);assert.ok(f.events.indexOf('cfg')<f.events.indexOf('mark'));
});
test('украинские сохранённые aliases не дублируются на свежей английской панели',async()=>{
 for(const focus of ['Зосереджений удар','Фокусована атака']) {
  const f=fixture();f.panel.splice(0,f.panel.length,f.make(312,true),f.make(317,true));
  f.env.rt.panelKnown=f.panel.map(x=>x.name.toLowerCase());f.env.rt.warriorRoles1027=[...f.env.rt.panelKnown];
  const saved='Свій перемикач, Жорстка стійка, '+focus;f.env.cfg.nToggles=saved;
  assert.equal(f.env.ilOf(focus),null,'свежая core metadata ещё не видела украинскую панель');
  await f.E.autoRoles();assert.equal(f.env.cfg.nToggles,saved);
  assert.equal(f.env.rt.warlordToggleRoles2049[312],true);assert.equal(f.env.rt.warlordToggleRoles2049[317],true);
 }
});
test('два aliases одного native ID на панели дают одно предложение и одно назначение',async()=>{
 const f=fixture();f.panel.push(f.make(317,true),f.make(312,true));
 assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nToggles),[312,317]);await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);
});
for(const first of [312,317])test('каждый ID помечается отдельно; поздняя панель добавляет второй: '+first,async()=>{
 const f=fixture();f.panel.splice(0,f.panel.length,f.make(first));
 await f.E.autoRoles();assert.equal(f.env.rt.warlordToggleRoles2049[first],true);
 const later=first===312?317:312;assert.equal(f.env.rt.warlordToggleRoles2049[later],undefined);
 f.panel.push(f.make(later));await f.E.autoRoles();
 assert.deepEqual(new Set(roleIds(f,f.env.cfg.nToggles)),new Set([312,317]));assert.equal(f.env.rt.warlordToggleRoles2049[later],true);
});
test('ручное удаление после ремонта сохраняется даже при пустой строке и новых aliases панели',async()=>{
 const f=fixture();await f.E.autoRoles();f.env.cfg.nToggles='';
 f.panel.push(f.make(317,true),f.make(312,true));await f.E.autoRoles();
 assert.equal(f.env.cfg.nToggles,'');assert.deepEqual(roleIds(f,f.E.suggestRoles().roles.nToggles),[312,317],'ручная подсказка остаётся доступна');
});
test('autoRoles:false не читает базу, не меняет роли и отметки',async()=>{
 const f=fixture();f.env.cfg.autoRoles=false;const cfg=JSON.stringify(f.env.cfg),rt=JSON.stringify(f.env.rt);
 f.env.itemsDb=()=>assert.fail('OFF не начинает ремонт');await f.E.autoRoles();
 assert.equal(JSON.stringify(f.env.cfg),cfg);assert.equal(JSON.stringify(f.env.rt),rt);assert.deepEqual(f.events,[]);
});
test('выключение авторолей во время itemsDb не начинает запись',async()=>{
 const f=fixture();f.env.itemsDb=async()=>{f.env.cfg.autoRoles=false};await f.E.autoRoles();
 assert.deepEqual(f.events,[]);assert.equal(f.env.rt.warlordToggleRoles2049,undefined);
});
for(const failure of ['throw','negative-ack'])test('неуспешная запись не помечает IDs, успешный повтор ремонтирует: '+failure,async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async()=>{if(failure==='throw')throw Error('storage failed');return {ok:false}};
 if(failure==='throw')await assert.rejects(f.E.autoRoles(),/storage failed/);else await f.E.autoRoles();
 assert.equal(f.env.rt.warlordToggleRoles2049,undefined);f.env.setCfg=save;await f.E.autoRoles();
 assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);assert.equal(f.env.rt.warlordToggleRoles2049[317],true);
});
test('смена класса во время подтверждения cfg не ставит позднюю отметку новому классу',async()=>{
 const f=fixture(),save=f.env.setCfg;f.env.setCfg=async p=>{await save(p);f.env.rt.classCur={prof:'dwarf_maestro',slot:1}};
 await f.E.autoRoles();assert.equal(f.env.rt.warlordToggleRoles2049,undefined);
});
test('отключение авторолей перед setCfg сохраняет ручной выбор',async()=>{
 const f=fixture();f.box.chrome.storage.local.get=async()=>{f.env.cfg.autoRoles=false;return {cfg:f.env.cfg}};
 await f.E.autoRoles();assert.equal(f.env.cfg.nToggles,'Свій перемикач');assert.equal(f.env.rt.warlordToggleRoles2049,undefined);assert.equal(f.writes.length,0);
});
test('неизвестный managed317 и неэффективный312 ждут пригодной metadata/панели без ранних отметок',async()=>{
 const f=fixture();f.managed(false);f.env.noEffect=n=>f.env.ilOf(n)?.id===312;await f.E.autoRoles();
 assert.equal(f.env.rt.warlordToggleRoles2049,undefined);assert.equal(f.env.cfg.nToggles,'Свій перемикач');
 f.managed(true);f.env.noEffect=()=>false;await f.E.autoRoles();assert.deepEqual(roleIds(f,f.env.cfg.nToggles),[312,317]);
});
