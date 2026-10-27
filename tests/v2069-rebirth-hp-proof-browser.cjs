'use strict';
// 27.10.2026: Wyrm11160→16740 из журнала04:23. Настоящий MV3/main/hook, HTTPS целиком локальный.
// Новый документ боя не получает native battle GET: первая атака требует свежей собственной HP-сверки.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001';
const SPAWN='rebirth_raid_'+RUN+'_2_1_25063_lv35_mob_3',NAME='Rebirth · Wyrm',MAX=16740,OLD=11160,proof=[];

async function scenario(which){
 const unknown=which==='unknown-kind',orange=which==='forbidden-orange',h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={revision:100,inBattle:true,hp:MAX,attacks:0,leaves:0,proofReads:0,proofHeld:false,attackHeld:false};
 let releaseProof,releaseAttack;const proofGate=new Promise(r=>releaseProof=r),attackGate=new Promise(r=>releaseAttack=r);
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:35,rebirthStage:1,l2Profession:'human_wizard',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:35}]},inBattle:S.inBattle,battleSpawnId:S.inBattle?SPAWN:null,
  hp:3317,maxHp:3317,mp:1648,maxMp:1648,sp:0,cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const battle=()=>({spawnId:SPAWN,mobName:NAME,mobLevel:35,mobHp:S.hp,mobMaxHp:MAX,kind:unknown?'unrecognized_fixture_kind':orange?'champion':'dungeon',championTier:orange?'orange':'',
  ended:false,log:[`Бій розпочато: [${NAME}] (ур.35).`],logSeq:1});
 const response=()=>({ok:true,revision:S.revision,character:character(),battle:battle()});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">35</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">3317</span><span id="l2-hud-hp-max">3317</span><span id="l2-hud-mp-cur">1648</span><span id="l2-hud-mp-max">1648</span>';
 const html=p=>'<!doctype html><meta charset="utf-8"><title>Rebirth HP proof fixture</title>'+base+(p==='/battle.html'?
  `<section id="battle-mob-panel"><h2 id="battle-mob-title">${NAME} · ур.35 · агрессивный</h2><div id="battle-mob-hp-val">${S.hp} / ${MAX}</div></section><div id="battle-log">Бій розпочато: [${NAME}] (ур.35).</div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" hidden>Перемога!</div><a id="battle-back-map" href="/map.html">Назад на карту</a>`:'<div id="map-list-mode-mobs" class="is-active"></div><ul id="map-mob-list"></ul>')+`<script>
   localStorage.setItem('token','local-rebirth-hp-fixture');
   const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
   const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await(await fetch('/character')).json()).character;window.fixtureReady=true;})();
   const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await ready;const d=await post('/game/battle/action',{action:'attack',battleSpawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});window.snapshot=d.character;window.nativeAttack=d;document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / '+d.battle.mobMaxHp;};
   const back=document.getElementById('battle-back-map');if(back)back.onclick=async e=>{e.preventDefault();await ready;await post('/game/battle/leave',{battleSpawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});location.href='/map.html';};
  </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   calls.push({path:p,query:u.search,method:req.method(),body:data});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(p==='/character')return json({character:character()});
   if(p==='/game/battle'){
    assert.equal(req.method(),'GET');assert.equal(u.searchParams.get('characterId'),HERO);assert.equal(u.searchParams.get('spawnId'),SPAWN);
    S.proofReads++;assert.equal(S.proofReads,1,'одна свежая сверка перед решением');S.proofHeld=true;await proofGate;return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal(unknown||orange,false,'неизвестная цель и запрещённый чемпион не атакуются');assert.equal(S.proofReads,1);assert.equal(S.leaves,0);
    assert.equal(data.battleSpawnId,SPAWN);assert.equal(data.action,'attack');assert.equal(data.expectedRevision,100);assert.equal((await h.get(['on'])).on,true);
    S.attacks++;assert.equal(S.attacks,1);S.hp-=1000;S.revision++;S.attackHeld=true;await attackGate;return json(response());
   }
   if(p==='/game/battle/leave'){
    assert.equal(orange,true,'обычный Rebirth-моб или неизвестный тип не выбрасывается на карту');assert.equal(S.attacks,0);
    assert.equal(data.battleSpawnId,SPAWN);S.leaves++;S.inBattle=false;S.revision++;return json({ok:true,character:character()});
   }
   assert.equal(req.method(),'GET','никаких новых входов/платных/боевых POST: '+p);return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async({NAME,OLD})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['farm','petbuff'],taskOnly:false,zoneAuto:false,rebirthMode:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,
    chain:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,storyTurnIn:false,
    searchChamp:true,searchQuest:false,champFa:false,champBlue:true,champOrange:false,champRed:false,champHpMult:1.5,champMinLvl:20,priority:'[все]',
    nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,deepEvery:0,mapEvery:0},
   rt:{...rt,char:'AuditHero',lvl:35,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,hpMin:{[NAME.toLowerCase()]:OLD},spawns:{},
    questTargets:[],questSeen:{},zone:'plains_of_the_lizardman',target:null,via:null,shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,
    storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});},{NAME,OLD});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+SPAWN);await until(()=>h.g.p.evaluate(()=>window.fixtureReady));await until(()=>h.g.core('!!L2V7Modules.combat'));
  const before=await h.g.core('({meta:BATTLE_NET,name:L2V7Modules.combat.mobName(),hpMin:rt.hpMin["rebirth · wyrm"],hp:L2V7Modules.combat.mobHp()})');
  assert.equal(before.meta,null);assert.equal(before.name,NAME);assert.equal(before.hpMin,OLD);assert.equal(before.hp.max,MAX);assert.equal(MAX,OLD*1.5);
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');await until(()=>S.proofHeld,20000);
  assert.equal(S.attacks,0,'до ответа свежей собственной сверки ударов нет');assert.equal(S.leaves,0);releaseProof();
  let rejection=null;
  if(unknown){
   await until(()=>h.g.core('String(rt.status||"").includes("тип цели по HP не подтверждён")'),6000);
   await delay(300);assert.equal(S.attacks,0);assert.equal(S.leaves,0);
   rejection=await h.g.core('({status:rt.status,errors:rt.errs})');await h.popup.locator('#stop').click({force:true});
  }else if(orange){
   await until(()=>S.leaves===1,10000);await h.popup.locator('#stop').click({force:true});
  }else{
   await until(()=>S.attackHeld,10000);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);releaseAttack();
   await until(()=>h.g.p.evaluate(()=>window.nativeAttack?.battle?.mobHp===15740),5000);
  }
  await until(async()=>!(await h.get(['on'])).on);await delay(250);
  assert.equal(S.proofReads,1);assert.equal(S.attacks,unknown||orange?0:1);assert.equal(S.leaves,orange?1:0);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const state=await h.get(['cfg','rt']);assert.equal(state.cfg.champOrange,false);assert.equal(state.cfg.champRed,false);assert.deepEqual(state.cfg.autoTasks,['farm','petbuff']);
  assert.equal(calls.filter(x=>x.path==='/game/rebirth-raids/start'||x.path==='/game/battle/start'||x.path==='/game/battle/hunt-continue').length,0);
  proof.push({case:which,browser:h.ctx.browser().version(),before,paths,calls,rejection,result:{attacks:S.attacks,leaves:S.leaves,proofReads:S.proofReads,mobHp:S.hp,hpMin:state.rt.hpMin[NAME.toLowerCase()]},errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 Rebirth HP proof',JSON.stringify({case:which,attacks:S.attacks,leaves:S.leaves,proofReads:S.proofReads}));
 }catch(e){console.error('DIAG rebirth-hp-proof',JSON.stringify({which,S,paths,calls,routeErrors,pageErrors:h.errors,state:await h.get(['on','rt']).then(x=>({on:x.on,status:x.rt.status,target:x.rt.target,hpMin:x.rt.hpMin,errs:x.rt.errs})).catch(String)}));throw e;}
 finally{releaseProof();releaseAttack();await h.ctx.close();}
}
(async()=>{try{for(const which of process.env.REBIRTH_HP_CASES?JSON.parse(process.env.REBIRTH_HP_CASES):['dungeon','unknown-kind','forbidden-orange'])await scenario(which)}finally{if(process.env.REBIRTH_HP_PROOF)fs.writeFileSync(process.env.REBIRTH_HP_PROOF,JSON.stringify({boundary:'actual Chrome MV3; safe reconstructed Wyrm35 DOM; local native handlers; own fresh character+battle GET; no live game or user scripts; no paid entry',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
