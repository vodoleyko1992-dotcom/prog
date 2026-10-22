'use strict';
// 22.10: Focus/Vicious выбранных ролей держим включёнными; относительное переключение требует свежего явного OFF.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),core=read('content.js'),combat=read('modules/combat.js');
const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
function fixture(saved){
 let now=1792661383119,net=0,owner='lease1',buffs=[],wait=0,global=0;
 const box={console:{log(){},warn(){}},Date:class extends Date{static now(){return now}},location:{pathname:'/battle.html',search:'?spawnId=dense_1'}};
 vm.createContext(box);vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const slot=(name,cdKey)=>({name,title:name,cdKey,kind:'скилл',disabled:false,hidden:false,className:'',attrs:{},getAttribute(k){return k==='data-slot-cd'?this.cdKey:this.attrs[k]??null}});
 const focus=slot('Зосереджений удар','focus_attack'),vicious=slot('Жорстка стійка','vicious_stance'),panel=[focus,vicious];
 box.document={querySelectorAll:()=>panel};
 const env={on:true,tabOwner:true,canAct:()=>true,isBattle:()=>true,pvpPending:()=>false,evidenceOwner:()=>owner,
  cfg:{nToggles:focus.name+', '+vicious.name,toggleMpOff:10,toggleMpOn:30,nBuffs:'',nKeyBuffs:''},
  rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},weaponsT:now-100,weapons:[{id:299,wt:'древковое',where:'надето'}],weaponEq:{id:299,t:now},skills:{},skillDb:{},...saved},
  SLOT:'.slot',ilOf:box.ilOf,names,cleanTitle:s=>s.split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,slotKind:b=>b?.kind,
  slotCd:()=>null,memLeft:()=>0,skKey:b=>b.title.toLowerCase(),shown:e=>!!e&&!e.hidden,isEquip:()=>false,
  combatCooldown:{skillKnown:()=>false,skillWait:()=>wait,globalWait:()=>global},cdSpawn:()=> 'dense_1',battleSpawn:()=> 'dense_1',
  activeBuffs:()=>buffs,noEffect:()=>false,meMp:()=>({cur:759,max:759}),skillMp:()=>18,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rec:()=>{},actNet:()=>({start:net})};
 vm.runInContext(combat.replace('return { limitPlan,','return { managedTogglePlan, limitPlan,'),box);
 const C=box.L2V7Factories.combat(env),ctx={block:{},seq:[]};env.slotsBy=C.slotsBy;
 const snap=(patch={})=>({name:'Hero',l2Profession:'human_warlord',revision:100,classSlots:{activeSlot:3},snapshotGeneratedAt:now,requestStartedAt:now,
  toggleStances:[{skillId:317,battleId:'l2_317',active:false},{skillId:312,battleId:'l2_312',active:false}],activeBuffs:[],inventory:{eq:{l1:{itemId:299}}},...patch});
 let clicks=0;
 const act=async(b,status,hp,needed)=>{assert.equal(typeof needed,'function');if(!needed())return 'lock';clicks++;net++;return true};
 return {C,box,env,ctx,focus,vicious,panel,snap,act,clicks:()=>clicks,sent:()=>net++,now:()=>now,advance:n=>{now+=n},buffs:v=>{buffs=v},wait:v=>{wait=v},global:v=>{global=v},owner:v=>{owner=v}};
}
function note(f,p){assert.equal(typeof f.C.noteToggleSnapshot,'function');return f.C.noteToggleSnapshot(f.snap(p));}
function run(f,act=f.act){assert.equal(typeof f.C.managedToggleStep,'function');return f.C.managedToggleStep(f.ctx,{},act);}
test('Focus остаётся generic autoUse:false, managedToggle открывает лишь специальный путь',()=>{
 const f=fixture();assert.equal(f.box.ilOf(f.focus).autoUse,false);assert.equal(f.box.ilOf(f.focus).managedToggle,true);
 for(const b of f.panel){assert.equal(f.C.ready(b),false);assert.equal(f.C.ready(b,true),true)}
 assert.equal([f.vicious,f.focus].filter(f.C.ready).length,0,'index в Array.filter не разрешает toggle');
 assert.equal([f.vicious,f.focus].find(f.C.ready),undefined,'index в Array.find не разрешает toggle');
});
test('явный OFF: intent сохранён до одного клика, алиасы одного ID не создают повтор',async()=>{
 const f=fixture();f.env.cfg.nToggles+=', Зосереджений удар';note(f);
 await run(f,async(...a)=>{assert.equal(Object.keys(f.env.rt.managedToggleIntent).length,1);return f.act(...a)});
 await run(f);assert.equal(f.clicks(),2,'Focus и Vicious по одному, не повтор Focus');await run(f);assert.equal(f.clicks(),2);
});
for(const [role,label]of [['Focus Attack','Зосереджений удар'],['Зосереджений удар','Focus Attack'],['Фокусована атака','Focus Attack'],['Vicious Stance','Жорстка стійка'],['Жорстка стійка','Vicious Stance']])
 test('роль/панель разных языков без кэша: '+role+' / '+label,async()=>{
  const f=fixture();f.env.cfg.nToggles=role;const b=/Vicious|стійка/.test(role)?f.vicious:f.focus;b.name=b.title=label;note(f);
  assert.equal(await run(f),true);assert.equal(f.clicks(),1);
 });
test('новый ON Vicious не теряет уже подтверждённый Focus ON',async()=>{
 const f=fixture();note(f);f.C.noteToggleBattle({be:{revision:101},res:{delta:{battleMods:{focusAttackActive:true}}}});
 f.C.noteToggleBattle({be:{revision:102},res:{delta:{battleMods:{stanceVicious:true}}}});assert.equal(await run(f),false);
});
test('реальный A/B start: active:false не отменяет серверные activeBuff317/battleModsON',async()=>{
 const r=JSON.parse(read('kb/raw/focus-attack-ab-20261022/normal-on-1-start.json')).response;
 assert.equal(r.character.toggleStances.find(x=>x.skillId===317).active,false);
 assert.equal(r.battle.battleMods.focusAttackActive,true);
 const f=fixture();note(f,{toggleStances:r.character.toggleStances,activeBuffs:r.character.activeBuffs});
 f.C.noteToggleBattle({be:{revision:100},res:r});assert.equal(await run(f),false);assert.equal(f.clicks(),0);
});
for(const [name,res]of Object.entries({iconOnly:{delta:{battleBuffIcons:[{l2SkillId:317,key:'focus_attack',isToggle:true}]}},noState:{}}))
 test('более новый собственный бой не позволяет старое OFF: '+name,async()=>{
  const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);f.C.noteToggleBattle({be:{revision:101,prof:'human_warlord',slot:3,request:{action:'focus_attack'}},res});
  assert.equal(await run(f),false);assert.equal(f.clicks(),0);
 });
test('request/успех без revision отзывают OFF до нового post-request снимка',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);f.C.noteToggleBattle({req:{action:'focus_attack',expectedRevision:100},res:{}});
 assert.equal(await run(f),false);f.advance(10);note(f,{revision:100});assert.equal(await run(f),false);
 f.advance(10);note(f,{revision:101});assert.equal(await run(f),true);assert.equal(f.clicks(),1);
});
for(const [name,patch]of Object.entries({missingRow:{toggleStances:[]},missingStances:{toggleStances:null},missingBuffs:{activeBuffs:null},unknownActive:{toggleStances:[{skillId:317,active:null},{skillId:312}]},
 wrongChar:{name:'Other'},wrongClass:{l2Profession:'orc_titan'},wrongSlot:{classSlots:{activeSlot:2}},badRevision:{revision:null},oldGenerated:{snapshotGeneratedAt:1792661300000},oldRequest:{requestStartedAt:1792661300000},futureGenerated:{snapshotGeneratedAt:1792661483119}}))
 test('нет доказательства OFF: '+name,async()=>{const f=fixture();note(f,patch);assert.equal(await run(f),false);assert.equal(f.clicks(),0)});
for(const [name,change]of Object.entries({hud:f=>f.buffs([{id:317},{id:312}]),pressed:f=>f.panel.forEach(b=>b.attrs['aria-pressed']='true'),slotActive:f=>f.panel.forEach(b=>b.className='slot--active'),
 liveSlot:f=>f.panel.forEach(b=>b.className='l2-battle-hotbar-slot l2-battle-hotbar-slot--toggle-on'),
 snapshotBuff:f=>note(f,{activeBuffs:[{skillId:317},{skillId:312}]}),snapshotTrue:f=>note(f,{toggleStances:[{skillId:317,active:true},{skillId:312,active:true}]}),battleMods:f=>f.C.noteToggleBattle({be:{revision:100},res:{delta:{battleMods:{focusAttackActive:true,stanceVicious:true}}}})}))
 test('любой положительный ON перекрывает OFF: '+name,async()=>{const f=fixture();note(f);change(f);assert.equal(await run(f),false);assert.equal(f.clicks(),0)});
for(const [name,change]of Object.entries({stop:f=>{f.env.on=false},owner:f=>{f.env.tabOwner=false},held:f=>{f.env.canAct=()=>false},notBattle:f=>{f.env.isBattle=()=>false},pvp:f=>{f.env.pvpPending=()=>true},
 class:f=>{f.env.rt.classCur.prof='orc_titan'},noRole:f=>{f.env.cfg.nToggles=''},unknownMP:f=>{f.env.meMp=()=>null},zeroMP:f=>{f.env.meMp=()=>({cur:0,max:759})},
 cd:f=>f.wait(12000),gcd:f=>f.global(1000),stale:f=>f.advance(30001),newOwner:f=>f.owner('lease2')}))
 test('общий запрет управляемого клика: '+name,async()=>{const f=fixture();note(f);change(f);assert.equal(await run(f),false);assert.equal(f.clicks(),0)});
for(const [name,change]of Object.entries({sword:f=>{f.env.rt.weapons[0].wt='меч'},staleHand:f=>{f.env.rt.weaponAug={w:2,t:f.now()}},unknownWeapon:f=>{f.env.rt.weaponMetaPending=true},
 snapshotWrongHand:f=>note(f,{inventory:{eq:{l1:{itemId:2}}}}),snapshotNoHand:f=>note(f,{inventory:null})}))
 test('Focus требует положительно подтверждённую пику: '+name,async()=>{const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);change(f);assert.equal(await run(f),false);assert.equal(f.clicks(),0)});
test('низкий известный MP не выключает ON и не запрещает доступное включение по проценту',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.vicious.name;f.env.skillMp=()=>0;f.env.meMp=()=>({cur:1,max:759});note(f);
 assert.equal(await run(f),true);assert.equal(f.clicks(),1);note(f,{revision:101,toggleStances:[{skillId:312,active:true}]});assert.equal(await run(f),false);assert.equal(f.clicks(),1);
});
test('Focus OFF при MP1: unknown price разрешает одну попытку, текущая серверная цена важнее',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.focus.name;f.env.meMp=()=>({cur:1,max:759});note(f);
 assert.ok(f.C.actionMp(f.focus)>1,'общая IL-модель не переписана в бесплатную');
 assert.equal(await run(f,async(b,s,h,needed,priceChecked)=>{assert.equal(priceChecked,true);return f.act(b,s,h,needed)}),true);assert.equal(f.clicks(),1);assert.equal(await run(f),false);
 const g=fixture();g.env.cfg.nToggles=g.focus.name;g.env.meMp=()=>({cur:1,max:759});g.env.rt.skillDb['зосереджений удар']={mp:18,mpKnown:true};note(g);
 assert.equal(g.C.actionMp(g.focus),18);assert.equal(await run(g),false);
});
for(const [name,change]of Object.entries({stop:f=>{f.env.on=false},class:f=>{f.env.rt.classCur.prof='orc_titan'},weapon:f=>{f.env.rt.weapons[0].wt='меч'},role:f=>{f.env.cfg.nToggles=''},
 mp:f=>{f.env.meMp=()=>null},cooldown:f=>f.wait(1000),manualON:f=>{f.focus.attrs['aria-pressed']='true'}}))
 test('stillNeeded повторяет запреты непосредственно перед кликом: '+name,async()=>{
  const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);let fired=0;
  await run(f,async(b,status,hp,needed)=>{change(f);if(!needed())return 'lock';fired++;return true});assert.equal(fired,0);
 });
test('unknown sent переживает reload/lease; только новый OFF с новой revision снимает fence',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);await run(f,async()=>{f.sent();return 'lock'});
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nToggles=g.focus.name;g.owner('lease2');note(g);assert.equal(await run(g),false);
 g.advance(10);note(g,{revision:101,requestStartedAt:g.now()-20});assert.equal(await run(g),false,'GET начат до попытки');
 g.advance(10);note(g,{revision:102});assert.equal(await run(g),true);assert.equal(g.clicks(),1);
});
test('равная revision/replay не освежает OFF и старый ответ не откатывает новое ON',async()=>{
 const f=fixture();note(f);f.advance(30001);note(f);assert.equal(await run(f),false);
 note(f,{revision:101,toggleStances:[{skillId:317,active:true},{skillId:312,active:true}]});note(f,{revision:100});assert.equal(await run(f),false);
});
test('нет подтверждения записи intent — нет клика',async()=>{const f=fixture();note(f);f.env.setRt=async()=>({ok:false});assert.equal(await run(f),false);assert.equal(f.clicks(),0)});
test('сменившаяся за durable intent ревизия отменяет клик со старым baseRevision',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.focus.name;note(f);const save=f.env.setRt;
 f.env.setRt=async p=>{const r=await save(p);f.advance(100);note(f,{revision:101});return r};
 assert.equal(await run(f),false);assert.equal(f.clicks(),0);
});
test('отсутствующий active в настоящем hook не становится false',()=>{
 const src=read('hook.js'),s=src.indexOf('  const petOf ='),e=src.indexOf('  // 20.12',s),box={};vm.createContext(box);vm.runInContext(src.slice(s,e)+'\nthis.petOf=petOf;',box);
 const c={name:'Hero',revision:1,toggleStances:[{skillId:317},{skillId:312,active:false},{skillId:256,active:true}]};
 const p=box.petOf({pathname:'/character'},{character:c});assert.equal(p.toggleStances[0].active,null);assert.equal(p.toggleStances[1].active,false);assert.equal(p.toggleStances[2].active,true);
});
test('старые роли обычных баффов не нажимают Focus/Vicious',()=>{
 const f=fixture();f.env.cfg.nBuffs=f.focus.name+', '+f.vicious.name;f.env.cfg.nKeyBuffs=f.env.cfg.nBuffs;f.env.isTotem=()=>false;
 vm.runInContext(read('modules/buffs.js'),f.box);assert.equal(JSON.stringify(f.box.L2V7Factories.buffs(f.env).buffList()),'[]');
});
function toggleStep(f){
 Object.assign(f.box,{L2V7Modules:{combat:f.C},cfg:f.env.cfg,rt:f.env.rt,names,meMp:()=>f.env.meMp(),slotsBy:f.C.slotsBy,toggleState:()=>true,ilOf:f.box.ilOf,uiReady:f.C.uiReady,
  activeBuffs:()=>[],setRt:f.env.setRt,cleanTitle:f.env.cleanTitle,rec:()=>{},noticeText:()=>''});
 vm.runInContext(core.slice(core.indexOf('async function toggleStep('),core.indexOf('// ---------- 🩺'))+'\nthis.toggleStep=toggleStep;',f.box);
 return f.box.toggleStep;
}
test('generic MP ветка никогда не выключает312/317 Warlord, даже без snapshot',async()=>{
 const f=fixture();f.env.meMp=()=>({cur:1,max:759});let n=0;await toggleStep(f)(f.ctx,{},async()=>{n++;return true});assert.equal(n,0);
});
test('Vicious другого класса сохраняет прежнее выключение по низкому MP',async()=>{
 const f=fixture();f.env.rt.classCur.prof='orc_titan';f.env.cfg.nToggles=f.vicious.name;f.env.meMp=()=>({cur:1,max:759});let n=0;
 await toggleStep(f)(f.ctx,{},async(b,s,h,cb,free)=>{n++;assert.equal(free,true);return true});assert.equal(n,1);
});
// Существующий стенд событийного act: используем настоящий scheduler и настоящий ON-plan, без копии реализации.
function attackScheduler(f){
 const src=read('tests/v2036-combat-scheduler.test.cjs'),fn=src.slice(src.indexOf('function fixture('),src.indexOf("\ntest('"));
 const body=combat.slice(combat.indexOf('  let lastHpPot = 0, lastMpPot = 0'),combat.indexOf('  const t0 = Date.now();\n  let progSig'));
 const box={vm,console,Map,Math,actSource:body};vm.runInNewContext(fn+'\nthis.make=fixture;',box);
 const a=box.make();a.env.slotAction=()=> 'attack';a.box.managedToggleIds=[317,312];a.box.managedTogglePlan=(_,id)=>f.C.managedTogglePlan(f.ctx,id);
 return a;
}
test('fresh OFF приходит во время gameFree: старый attack отменяется, Vicious включается, затем attack проходит',async()=>{
 const f=fixture();f.env.cfg.nToggles=f.vicious.name;const a=attackScheduler(f);a.setBusy(200);a.at(80,()=>note(f));
 assert.equal(await a.act(),'lock');assert.equal(a.fired.length,0);assert.equal(await run(f),true);assert.equal(f.clicks(),1);
 await a.act();assert.equal(a.fired.length,1,'pending включения не держит следующий обычный удар');
});
for(const mode of ['unknown','pending','knownCost','storageThrow'])test('ordinary attack продолжается при '+mode,async()=>{
 const f=fixture();f.env.cfg.nToggles=f.vicious.name;
 if(mode!=='unknown')note(f);
 if(mode==='pending')await run(f,async()=>{f.sent();return 'lock'});
 if(mode==='knownCost'){f.env.rt.skillDb['vicious stance']={mp:18,mpKnown:true};f.env.meMp=()=>({cur:1,max:759})}
 if(mode==='storageThrow'){f.env.setRt=async()=>{throw Error('storage')};assert.equal(await run(f),false);assert.ok(f.ctx.block['managed:312']>f.now())}
 const a=attackScheduler(f);await a.act();assert.equal(a.fired.length,1);
});
