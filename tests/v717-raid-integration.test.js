'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const dom={slots:[], querySelectorAll(sel){return sel==='button'?this.slots:[];},querySelector(sel){return sel==='#battle-mob-hp-val'?{textContent:'400000/500000'}:null;}};
const sandbox={console,Math,Date,document:dom,location:{pathname:'/map.html'},globalThis:null}; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
for(const mod of ['combat','raid']) vm.runInContext(fs.readFileSync(path.join(root,'modules',mod+'.js'),'utf8'),sandbox,{filename:mod+'.js'});
const F=sandbox.L2V7Factories;
const make=(title,key,cd=0)=>({title,key,cdUntil:cd,disabled:false,getAttribute:()=>null});
(async()=>{
  // Real cooldowns are seconds: one second to readiness must prevent charging;
  // five seconds is sufficient to opportunistically charge.
  const atk=make('Атака','атака'), bf=make('Burning Fist','burning fist',Date.now()+5000);
  const ff=make('Focused Force','focused force'),fb=make('Force Blaster','force blaster');
  dom.slots=[atk,bf,ff,fb];
  const cfg={nAttack:'Атака',nPower:'Burning Fist',nUltra:'',nCharge:'Focused Force',nForce:'Force Blaster=1',fightMode:'dps',skillMpMin:0,rbCharge:true,rbVampHp:60};
  const rt={skills:{},skillDb:{},rbDb:{},pots:{},cdUntil:{},cdUse:{}};
  const env={SLOT:'button',cfg,rt,HP_POT_RE:/healing/i,
    names:s=>String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),
    isEquip:()=>false,shown:x=>x?1:0,slotKind:b=>b===atk?'атака':'скилл',
    slotCd:()=>null,slotAction:()=>null,skKey:b=>b.key,
    memLeft:b=>Math.max(0,((b.cdUntil||0)-Date.now())/1000),
    uiTimer:b=>Math.max(0,((b.cdUntil||0)-Date.now())/1000),
    combatCooldown:{skillWait:()=>0},battleSpawn:()=>1,ilOf:()=>({reuse:10000}),
    $q:sel=>dom.querySelector(sel),expDmg:k=>({'атака':1973,'burning fist':4706,'force blaster':4082})[String(k).toLowerCase()]||0,
    forceNow:()=>0,forceMax:()=>2,forceCosts:()=>[{name:'Force Blaster',cost:1}],
    isChargeName:t=>/focused force/i.test(t),isForceName:t=>/force blaster/i.test(t),
    cleanTitle:s=>s,longFightMp:()=>null,skillMp:()=>30,meHp:()=>({cur:7666,max:7666,pct:100}),
    hpPotByDeficit:()=>null,mpPotSlot:()=>null,chargeValue:()=>6000,turnSec:()=>1.4,actCost:()=>1,
    qty:()=>0,SK_NET:{},setRt:async patch=>Object.assign(rt,patch)};
  const C=F.combat(env),ctx={rb:{id:'x'},block:{}},mp={cur:900,max:1000};
  assert.equal(C.dpsPlan(ctx,mp)?.b,ff,'charge while powerful skill is >1.5 seconds away');
  bf.cdUntil=Date.now()+900;
  assert.notEqual(C.dpsPlan(ctx,mp)?.b,ff,'do not charge if powerful skill is almost ready');
  bf.cdUntil=0;
  assert.equal(C.dpsPlan(ctx,mp)?.b,bf,'ready strong skill takes priority');
  bf.cdUntil=Date.now()+5000;cfg.rbCharge=false;
  assert.notEqual(C.dpsPlan(ctx,mp)?.b,ff,'manual RB charge opt-out works');
  console.log('PASS: RB cooldown seconds, charge gating, strong-skill priority, opt-out');

  const renv={cfg:{rbValueTour:true,rbMaxBelow:15,rbMaxAbove:15,rbPotReserve:10},
    rt:{rbDb:{a:{sp:2500,adenaPerKill:100000,expPerKill:300000,fightS:400},b:{sp:400,adenaPerKill:250000,expPerKill:700000,fightS:240}},
      rbList:{a:{alive:true,lvl:50,price:100000,name:'A'},b:{alive:true,lvl:50,price:100000,name:'B'}},rbListT:Date.now(),rbGoTried:{},rbGoCnt:{},rbStats:{}},
    meHp:()=>({max:7666}),heroLvl:()=>56,fmtK:x=>String(x),fmtT:x=>String(x),potModel:()=>({pool:500000,rate:280,n:300}),
    rec:()=>{},RB_WIN:15,RB_TRY_MS:0,RB_RETRY_MS:0,logLines:()=>[],newLines:(_,b)=>b,activeBuffs:()=>[],
    rbNote:async(id,patch)=>{renv.rt.rbDb[id]={...renv.rt.rbDb[id],...patch}},setRt:async p=>Object.assign(renv.rt,p)};
  const R=F.raid(renv);
  assert(R.rbValueScore('b',renv.rt.rbList.b)>R.rbValueScore('a',renv.rt.rbList.a),'measured actual rewards rank B higher');
  assert.equal(R.rbListPick().id,'b','tour orders by measured net value');
  renv.rt.rbListT=Date.now()-11*60000;
  assert.equal(R.rbListPick(),null,'stale RB list not used for profit routing');
  renv.rt.rbListT=Date.now();
  renv.rt.rbDb.b.verdict='no';renv.rt.rbDb.b.heroLvl=56;
  assert(R.rbTeleportCheck('b',renv.rt.rbList.b),'no verdict blocks paid teleport');
  console.log('PASS: measured per-RB economics, fresh list required, no-verdict blocks teleport');

  const lg=['[Берун] ударив тебе (крит!) −300 HP','[Берун] ударив тебе −250 HP','Берун · Удар вітру 2004'];
  const logEnv={...renv,rt:{rbDb:{}},logLines:()=>lg,newLines:(_,lines)=>lines,
    rbNote:async(id,p)=>{logEnv.rt.rbDb[id]={...(logEnv.rt.rbDb[id]||{}),...p}}};
  const lr=F.raid(logEnv);lr.rbLearn({name:'Берун',rb:{id:'berun',lp:['old']}});
  await Promise.resolve();
  assert.equal(logEnv.rt.rbDb.berun.sp,2004,'special damage persisted per boss');
  console.log('PASS: RB log learns specials and critical ordinary attacks');
  console.log('PASS: all v7.1.7 raid integration tests');
})().catch(e=>{console.error(e);process.exitCode=1});
