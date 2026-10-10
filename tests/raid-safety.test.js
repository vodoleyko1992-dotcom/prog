'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const dir=path.join(__dirname,'..');
function factory(file,key,env){
 const sandbox={console,Math,Date,Number,document:{querySelectorAll:()=>[]},URLSearchParams,location:{pathname:'/map.html'},globalThis:{}};
 sandbox.globalThis=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(dir,'modules',file),'utf8'),sandbox,{filename:file});
 return sandbox.L2V7Factories[key](env);
}
(async()=>{
 const pot={title:'Зілля зцілення',disabled:false,getAttribute:()=>null};
 const skill={title:'Iron Punch',disabled:false,getAttribute:()=>null};
 const env={
  HP_POT_RE:/зцілен|healing/i, SLOT:'.l2-battle-hotbar-slot',cfg:{nHpPot:'Зілля зцілення',rbUsePots:true,rbPotReserve:10},
  rt:{skills:{pot:{cd:10,cdFloor:10,cdNet:10},skill:{cd:10}},cdUntil:{pot:Date.now()+10000},pots:{}},
  slotKind:b=>b===pot?'предмет':'скилл',skKey:b=>b===pot?'pot':'skill',slotAction:b=>b===pot?'battle_potion_use':'l2_29',
  slotCd:()=>null,combatCooldown:{skillWait:()=>0},battleSpawn:()=> 'rb-test',memLeft:b=>b===pot?9800:Math.max(0,(env.rt.cdUntil.skill||0)-Date.now()),
  ilOf:b=>({reuse:10000}),SK_NET:{},uiTimer:()=>0,setRt:async p=>Object.assign(env.rt,p),
  hpPots:()=>[],potBag:()=>300,isBattle:()=>false,qty:()=>300
 };
 const combat=factory('combat.js','combat',env);
 assert.equal(combat.ready(pot),true,'Potion must ignore legacy local cooldown');
 await combat.rememberCd(pot,'used');
 assert.equal(env.rt.cdUntil.pot,undefined,'Potion legacy cooldown must be cleared');
 assert.equal(env.rt.skills.pot.cd,0);
 assert.equal(env.rt.skills.pot.cdNet,0);
 assert.equal(combat.ready(pot),true);
 await combat.rememberCd(skill,'used');
 assert(env.rt.cdUntil.skill > Date.now()+9000,'Measured actual cooldown is retained; Interlude reuse is not required');
 assert.equal(combat.ready(skill),false);
 console.log('PASS: potion ready at zero server cooldown; local legacy timer removed; measured skill reuse retained');
 env.rt.bagAll={t:Date.now(),n:{'Зілля зцілення':200}};
 const pm=combat.potModel();
 assert.equal(pm.n,190,'Reserve deducted once');
 assert.equal(pm.H,600,'Potion pulse recognized');
 assert(pm.rate<300 && pm.rate>270,'Rate bounded by observed 2.2s interval');
 assert.equal(pm.pool,114000);
 console.log('PASS: inventory-derived potion pool, one shared reserve, conservative pulse rate');
 const raidEnv={cfg:{},rt:{rbDb:{berun:{sp:2004,hitP90:300},verfa:{sp:2811},golem:{sp:3801},tarlk:{sp:6588},bad:{verdict:'no',heroLvl:56}}},
  heroLvl:()=>56,meHp:()=>({cur:7666,max:7666,pct:100}),potModel:()=>({pool:240000,rate:273,n:400,H:600}),
  fmtT:t=>String(Math.round(t)),fmtK:x=>String(Math.round(x)),rec:()=>{},logLines:()=>[],newLines:(a,b)=>b,activeBuffs:()=>[],rbNote:async (id,p)=>{raidEnv.rt.rbDb[id]={...(raidEnv.rt.rbDb[id]||{}),...p}}};
 const raid=factory('raid.js','raid',raidEnv);
 const stat={hp:507285,patk:1400,loss:200};
 assert.equal(raid.rbPreCheck('berun',stat).ok,true,'Berun-class with observed 26% spike and 400 potions should not be mechanically ruled out');
 assert.equal(raid.rbPreCheck('verfa',stat).ok,true,'Updated spec: Verfa 37% allowed if potions cover observed loss');
 assert.equal(raid.rbPreCheck('golem',stat).ok,false,'Golem 50% spike lethal');
 assert.equal(raid.rbPreCheck('tarlk',stat).ok,false,'Tarlk 86% spike high risk');
 assert(raid.rbTeleportCheck('bad',{lvl:50}),'Existing no verdict must block before teleport');
 console.log('PASS: observed boss spike preflight; risky specials rejected; no verdict stops paid teleport');
 let lines=['[Берун] ударив тебе −300 HP','Берун · Удар вітру 2004'];
 const rbEnv={...raidEnv,rt:{rbDb:{}},logLines:()=>lines,newLines:()=>lines,activeBuffs:()=>[], rbNote:async (id,p)=>{rbEnv.rt.rbDb[id]={...(rbEnv.rt.rbDb[id]||{}),...p}}};
 const rr=factory('raid.js','raid',rbEnv);
 const fight={name:'Берун',rb:{id:'berun',lp:['old'],hits:[]}};
 rr.rbLearn(fight);
 await Promise.resolve();
 assert.equal(rbEnv.rt.rbDb.berun.sp,2004,'Special hit must be learned per boss');
 console.log('PASS: raid special attack recognized from game combat log');
})().catch(e=>{console.error(e);process.exitCode=1});
