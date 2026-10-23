'use strict';
// 22.10, живой РБ: повторный Battle Roar при HP6958/11035 принят, HP6958 не изменилось.
// Активный MaxHP-эффект не считается экстренным лечением; первое применение на раненом герое не переопределяем.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),core=read('content.js'),combat=read('modules/combat.js');
const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
function fixture(){
 let now=1792661383119,known=true,wait=0,net=0;
 const box={console,Date:class extends Date{static now(){return now}},location:{pathname:'/battle.html',search:'?spawnId=l2dop_rb_25431'}};
 vm.createContext(box);vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const slot=(name,cdKey)=>({name,title:name,cdKey,kind:'скилл',disabled:false,hidden:false,getAttribute:k=>k==='data-slot-cd'?cdKey:null});
 const roar=slot('Бойовий рик','battle_roar'),heal=slot('Heal','l2_1011'),panel=[roar,heal],hud={hidden:false};
 let buffs=[{id:1040,exp:now+60000}];
 box.document={querySelectorAll:()=>panel};
 const env={on:true,tabOwner:true,canAct:()=>true,isBattle:()=>true,pvpPending:()=>false,
  cfg:{nHeal:roar.name,nBuffs:'',nKeyBuffs:'',hpPotAt:50,stopHp:25},
  rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},weaponsT:now-100,
   weapons:[{id:1,wt:'древковое',where:'надето'}],weaponEq:{id:1,t:now},
   skillDb:{'бойовий рик':{mp:18,mpKnown:true}},skills:{},buffAt:{}},
  SLOT:'.slot',ilOf:box.ilOf,names,cleanTitle:s=>s.split(/\s*\(/)[0].trim(),slotAction:b=>b?.cdKey,
  slotKind:b=>b?.kind,slotCd:()=>null,memLeft:()=>0,skKey:b=>b.title.toLowerCase(),
  combatCooldown:{skillKnown:()=>known,skillWait:()=>wait},cdSpawn:()=> 'l2dop_rb_25431',battleSpawn:()=> 'l2dop_rb_25431',
  shown:e=>!!e&&!e.hidden,isEquip:()=>false,$q:s=>s==='#l2-hud-active-buffs'?hud:null,
  activeBuffs:()=>buffs,buffActive:()=>false,noEffect:()=>false,epicById:()=>null,
  meHp:()=>({cur:11035,max:11035,pct:100}),meMp:()=>({cur:759,max:759}),
  setRt:async p=>Object.assign(env.rt,p),rec:()=>{},actNet:()=>({start:net}),
  buffAuditStep:async()=>{},spoilStep:async()=>false,toggleStep:async()=>false,buffList:()=>[]};
 vm.runInContext(combat,box);const C=box.L2V7Factories.combat(env),ctx={rb:{id:'l2dop_rb_25431'},block:{},seq:[]};
 return {C,box,env,ctx,roar,heal,panel,hud,now:()=>now,advance:ms=>{now+=ms},buffs:v=>{buffs=v},known:v=>{known=v},wait:v=>{wait=v},sent:()=>{net++}};
}
test('активный Battle Roar при HP63% не выбирается как лечение, другой Heal остаётся',()=>{
 const f=fixture();f.buffs([{id:121,exp:f.now()+600000}]);
 assert.equal(f.C.healPick(f.ctx,f.env.meMp()),null);
 f.env.cfg.nHeal+=' , Heal';assert.equal(f.C.healPick(f.ctx,f.env.meMp()),f.heal);
});
for(const exp of ['near','unknown'])test('активный Roar не лечит при '+exp+' expiry, даже если обычный buffActive уже false',()=>{
 const f=fixture();f.buffs([{id:121,exp:exp==='near'?f.now()+2000:0}]);assert.equal(f.C.healPick(f.ctx,f.env.meMp()),null);
});
test('первое лечение не переопределяется, nHeal и другие классы не переписываются',()=>{
 const f=fixture(),before=JSON.stringify(f.env.cfg);assert.equal(f.C.healPick(f.ctx,f.env.meMp()),f.roar);
 f.env.rt.classCur.prof='orc_titan';assert.equal(f.C.healPick(f.ctx,f.env.meMp()),f.roar);
 assert.equal(JSON.stringify(f.env.cfg),before);
});
function plan(f){assert.equal(typeof f.C.battleRoarPlan,'function');return f.C.battleRoarPlan(f.ctx,f.env.meHp(),f.env.meMp());}
test('в начале боя РБ неактивный выбранный Roar доступен как MaxHP-бафф с известными MP/CD',()=>{
 const f=fixture();assert.equal(plan(f)?.b,f.roar);
 f.buffs([{id:121,exp:f.now()-1},{id:1040,exp:f.now()+60000}]);assert.equal(plan(f)?.b,f.roar,'истёкший эффект разрешает начало нового');
});
for(const [name,change]of Object.entries({
 active:f=>f.buffs([{id:121,exp:f.now()+2000}]),unknownExpiry:f=>f.buffs([{id:121,exp:0}]),
 noRole:f=>{f.env.cfg.nHeal='';f.env.cfg.nBuffs='';f.env.cfg.nKeyBuffs=''},noPanel:f=>f.panel.splice(0,1),hiddenSlot:f=>{f.roar.hidden=true},
 noHud:f=>{f.env.$q=()=>null},hiddenHud:f=>{f.hud.hidden=true},emptyHud:f=>f.buffs([]),
 otherClass:f=>{f.env.rt.classCur.prof='orc_titan'},noPike:f=>{f.env.rt.weapons[0].wt='дубина'},
 stalePike:f=>{f.env.rt.weaponAug={w:2,t:f.now()}},unknownWeapon:f=>{f.env.rt.weaponMetaPending=true},
 noMpPrice:f=>{f.env.rt.skillDb={}},insufficientMp:f=>{f.env.meMp=()=>({cur:17,max:759})},
 serverCd:f=>f.wait(1000),disabled:f=>{f.roar.disabled=true},
 lowHp:f=>{f.env.meHp=()=>({cur:2207,max:11035,pct:20})},normalMob:f=>{f.ctx.rb=null},
 pvp:f=>{f.env.pvpPending=()=>true},afterStrike:f=>{f.ctx.seq=['А']},afterAttempt:f=>{f.ctx.roarPrepTried=true},
 stop:f=>{f.env.on=false},owner:f=>{f.env.tabOwner=false},frame:f=>{f.env.canAct=()=>false},
 retreat:f=>{f.ctx.rb.retreated=true},notBattle:f=>{f.env.isBattle=()=>false},epic:f=>{f.env.epicById=()=>({id:'epic'})}
}))test('MaxHP-подготовка не начинается: '+name,()=>{const f=fixture();change(f);assert.equal(plan(f),null);});
function step(f,act){
 Object.assign(f.box,{env:f.env,ctx:f.ctx,act,NEXT:'next',AGAIN:'again',battleRoarPlan:f.C.battleRoarPlan,battleRoarActive:f.C.battleRoarActive,
  managedMonsterStep:f.C.managedMonsterStep,slotsBy:f.C.slotsBy,ready:f.C.ready,affordable:f.C.affordable});
 const a=combat.indexOf('  async function buffStep('),b=combat.indexOf('  // шаг: дебафф мага',a);
 vm.runInContext(combat.slice(a,b)+'\nthis.roarBuffStep=buffStep;',f.box);
 return ()=>f.box.roarBuffStep(f.env.meHp(),f.env.meMp(),{cur:100000,max:100000,pct:100});
}
test('MaxHP кастуется до обычных баффов один раз, задержка HUD не вызывает повтор',async()=>{
 const f=fixture(),calls=[];f.env.buffList=()=>{calls.push('ordinary');return []};
 const run=step(f,async(b,status,hpGuard,needed)=>{assert.equal(needed(),true);calls.push(b);f.sent();return true});
 await run();assert.deepEqual(calls,[f.roar]);assert.equal(f.ctx.roarPrepTried,true);
 await run();assert.deepEqual(calls,[f.roar,'ordinary']);assert.equal(f.C.healPick(f.ctx,f.env.meMp()),null,'неподтверждённый HUD не превращает уже сделанный MaxHP ход в лечение');
});
test('сервер опустил готовый CD121: UI/local разрешают одну попытку, неизвестный ответ не повторяется',async()=>{
 const f=fixture();f.known(false);assert.equal(plan(f)?.b,f.roar);
 let fired=0;const run=step(f,async()=>{fired++;f.sent();return 'lock'});
 await run();await run();assert.equal(fired,1);assert.equal(plan(f),null);
});
for(const [result,sent]of [['lock',false],['nomp',false],[false,true],['lock',true],['unavail',true]])test('исход подготовки '+result+', sent='+sent,async()=>{
 const f=fixture();const run=step(f,async()=>{if(sent)f.sent();return result});await run();
 assert.equal(!!f.ctx.roarPrepTried,sent||!['lock','nomp'].includes(result));
});
for(const [name,change]of Object.entries({stop:f=>{f.env.on=false},class:f=>{f.env.rt.classCur.prof='orc_titan'},weapon:f=>{f.env.rt.weaponMetaPending=true},role:f=>{f.env.cfg.nHeal=''},mp:f=>{f.env.meMp=()=>({cur:0,max:759})},cooldown:f=>f.wait(1000)}))test('перед кликом повторяется проверка: '+name,async()=>{
 const f=fixture();let fired=0;
 const run=step(f,async(b,status,hpGuard,needed)=>{change(f);if(!needed())return 'lock';fired++;return true});
 await run();assert.equal(fired,0);
});
test('ручная запись Roar в баффы не обновляет ещё активный эффект в последние две секунды',async()=>{
 const f=fixture();f.ctx.seq=['А'];f.env.cfg.nBuffs=f.roar.name;f.env.buffList=()=>[f.roar.name];
 f.buffs([{id:121,exp:f.now()+2000}]);let fired=0;await step(f,async()=>{fired++;return true})();assert.equal(fired,0);
});
