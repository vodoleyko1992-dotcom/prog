'use strict';
// 20.66: безопасная реконструкция DOM Tumran из снимка26.10, без исполнения HTML/JS игрока.
// Настоящий MV3/main/hook. Map-кнопка делает native start перед навигацией; новый battle-документ не читает battle API.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='quest-kind-hero',ORDINARY='dense_5598',ORANGE='champ_o_plains_of_dion_4',NAME='Tumran Bugbear',proof=[];

async function scenario(kind){
 const orange=kind==='orange',revealed=kind==='revealed-orange',forbidden=orange||revealed;
 const transient=/^transient-/.test(kind),expectedReads=transient?2:1,proofTimes=[];
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const active=orange?ORANGE:ORDINARY,max=orange?86284:5073;
 const S={revision:100,inBattle:false,starts:0,leaves:0,attacks:0,hp:max,proofReads:0,proofHeld:false,attackHeld:false,battleDocs:0};
 let releaseProof,releaseAttack;
 const proofGate=new Promise(r=>releaseProof=r),attackGate=new Promise(r=>releaseAttack=r);
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:21,rebirthStage:1,l2Profession:'human_wizard',profession:'Human Wizard',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:21}]},inBattle:S.inBattle,battleSpawnId:S.inBattle?active:null,
  hp:2184,maxHp:2184,mp:942,maxMp:942,sp:0,cityId:'l2dop_dion',currentZoneId:'plains_of_dion',locationType:'zone',inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const battle=()=>({spawnId:active,mobName:NAME,mobLevel:23,mobHp:S.hp,mobMaxHp:max,kind:forbidden?'champion':'aggressive',championTier:forbidden?'orange':'',ended:false,
  log:[`Бой начат: ${NAME} (ур.23)`],logSeq:1});
 const response=()=>({ok:true,revision:S.revision,character:character(),battle:battle()});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">21</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">2184</span><span id="l2-hud-hp-max">2184</span><span id="l2-hud-mp-cur">942</span><span id="l2-hud-mp-max">942</span>';
 const row=(id,champ)=>`<li class="l2-map-mob-item l2-map-mob-item--battle${champ?' l2-map-mob-item--champion-orange':''}"><a class="l2-map-mob-link ${champ?'l2-map-mob-link--champion':'l2-map-mob-link--quest-target l2-map-mob-link--lvl-same'}" href="/battle.html?spawnId=${id}"><span class="l2-starter-story-star">★</span> ${NAME} · ур.23${champ?' · чемпион':''}<span class="l2-mob-card-meta">HP ${champ?86284:5073} · EXP ${champ?65850:2920}</span></a></li>`;
 const mapHtml=()=>'<div id="map-list-mode-mobs" class="is-active"></div><ul id="map-mob-list" data-l2-around-sig="2|'+ORDINARY+':1,'+ORANGE+':2|p0|lv21|qTumran Bugbear">'+(!orange?row(ORDINARY,false):'')+row(ORANGE,true)+'</ul><span id="map-mob-page-ind">1 / 1 (2)</span>';
 const html=p=>'<!doctype html><meta charset="utf-8"><title>Quest champion kind fixture</title>'+base+(p==='/map.html'?mapHtml():
  `<section id="battle-mob-panel" class="l2-battle-mob-panel"><h2 id="battle-mob-title" class="l2-battle-mob-title">${NAME} · ур.23 · ${orange?'чемпион':'агрессивный'}</h2><div id="battle-mob-hp-val">${S.hp} / ${max}</div></section><div id="battle-log">Бой начат: ${NAME} (ур.23)</div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" hidden>Победа!</div><a id="battle-back-map" href="/map.html">Назад на карту</a>`)+`<script>
   localStorage.setItem('token','local-quest-kind-fixture');
   const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
   const snapshotReady=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await(await fetch('/character')).json()).character;})();
   for(const a of document.querySelectorAll('.l2-map-mob-link'))a.onclick=async e=>{e.preventDefault();await snapshotReady;const id=new URL(a.href).searchParams.get('spawnId');
    await post('/game/battle/start',{spawnId:id,expectedRevision:window.snapshot.revision});location.href=a.href;};
   const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await snapshotReady;const d=await post('/game/battle/action',{action:'attack',battleSpawnId:'${active}',expectedRevision:window.snapshot.revision});window.snapshot=d.character;window.nativeAttack=d;document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / '+d.battle.mobMaxHp;};
   const back=document.getElementById('battle-back-map');if(back)back.onclick=async e=>{e.preventDefault();await snapshotReady;await post('/game/battle/leave',{battleSpawnId:'${active}',expectedRevision:window.snapshot.revision});location.href='/map.html';};
  </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   calls.push({path:p,query:u.search,method:req.method(),body:data,battleDocs:S.battleDocs});
   const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);if(p==='/battle.html')S.battleDocs++;return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(p==='/character')return json({character:character()});
   if(p==='/game/battle/start'){
    assert.equal(S.starts,0,'не должно быть повторного входа');assert.equal(data.spawnId,active);assert.equal(data.expectedRevision,100);
    S.starts++;S.inBattle=true;S.revision++;return json(response());
   }
   if(p==='/game/battle'){
    assert.equal(req.method(),'GET');assert.equal(orange,false,'явный orange не требует нового proof GET');
    assert.equal(S.battleDocs,1,'условный proof принадлежит новому документу боя');
    assert.equal(u.searchParams.get('characterId'),HERO);assert.equal(u.searchParams.get('spawnId'),ORDINARY);
    S.proofReads++;proofTimes.push(Date.now());
    // 20.68 (лог27.10 12:46): единственный временный сбой не должен держать бой целую минуту.
    if(transient&&S.proofReads===1){if(kind==='transient-read')return route.abort('timedout');return route.fulfill({status:503,json:{error:'temporary_fixture_failure'}});}
    assert.equal(S.proofReads,expectedReads,'одна успешная свежая сверка до первого удара');S.proofHeld=true;await proofGate;
    return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal(forbidden,false,'запрещённый настоящий orange не атакуется');assert.equal(S.proofReads,expectedReads,'атака только после успешной свежей сверки');
    assert.equal(S.leaves,0);assert.equal(data.battleSpawnId,ORDINARY);assert.equal(data.action,'attack');assert.equal(data.expectedRevision,101);
    S.attacks++;assert.equal(S.attacks,1);S.hp-=1000;S.revision++;S.attackHeld=true;await attackGate;return json(response());
   }
   if(p==='/game/battle/leave'){
    assert.equal(forbidden,true,'обычный квестовый моб не отбрасывается из-за hpMin');assert.equal(S.attacks,0);
    S.leaves++;S.inBattle=false;S.revision++;return json({ok:true,character:character()});
   }
   assert.equal(req.method(),'GET','неожиданный POST '+p);return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['farm','petbuff'],taskOnly:false,zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,
    chain:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,storyTurnIn:false,
    searchChamp:true,searchQuest:true,champFa:false,champBlue:true,champOrange:false,champRed:false,champHpMult:1.5,champMinLvl:20,priority:'[квест]\n[чемп]\n[все]',
    nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,deepEvery:0,mapEvery:0},
   rt:{...rt,char:'AuditHero',lvl:21,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,hpMin:{'tumran bugbear':3000},spawns:{dense_5598:['Tumran Bugbear',23],champ_o_plains_of_dion_4:['Tumran Bugbear',23]},
    questTargets:['tumran bugbear'],questSeen:{'tumran bugbear':now},zone:'plains_of_dion',target:null,via:null,shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,
    storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});});
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('rt.char==="AuditHero" && !!L2V7Modules.combat'));
  await h.popup.reload();await h.g.p.bringToFront();
  if(orange){
   // Контроль боевого фильтра: пользователь открыл реального orange до запуска бота.
   await h.g.p.locator('.l2-map-mob-link').click();await until(()=>h.g.core('location.pathname==="/battle.html" && BATTLE_NET===null'));
  }
  await h.click('start');
  let before=null;
  if(!orange){
   await until(()=>S.proofHeld,20000);
   if(transient){const retryMs=proofTimes[1]-proofTimes[0];assert.ok(retryMs>=2500&&retryMs<15000,'короткая ограниченная пауза после сбоя: '+retryMs+' мс');}
   before=await h.g.core('({meta:BATTLE_NET,hpMin:rt.hpMin["tumran bugbear"],url:location.pathname+location.search})');
   assert.deepEqual(before,{meta:null,hpMin:3000,url:'/battle.html?spawnId='+ORDINARY},'новый документ потерял start-meta; HP5073 превышает исторический порог4500');
   assert.equal(S.attacks,0);assert.equal(S.leaves,0);releaseProof();
   if(revealed){
    await until(()=>S.leaves===1,15000);await h.click('stop');await until(async()=>!(await h.get(['on'])).on);await delay(300);
    assert.equal(S.starts,1);assert.equal(S.attacks,0);assert.equal(S.leaves,1);assert.equal(S.proofReads,expectedReads,'свежий proof champion/orange передан старому цветовому запрету');
   }else{
    await until(()=>S.attackHeld,15000);
    await h.click('stop');await until(async()=>!(await h.get(['on'])).on);releaseAttack();
    await until(()=>h.g.p.evaluate(()=>window.nativeAttack?.battle?.mobHp===4073),5000);
    assert.equal(S.starts,1);assert.equal(S.attacks,1);assert.equal(S.leaves,0);assert.equal(S.proofReads,expectedReads);
    assert.deepEqual(paths,['/map.html','/battle.html?spawnId='+ORDINARY]);
   }
  }else{
   await until(()=>S.leaves===1,15000);await h.click('stop');await until(async()=>!(await h.get(['on'])).on);await delay(300);
   assert.equal(S.starts,1);assert.equal(S.attacks,0);assert.equal(S.proofReads,0);assert.equal(S.leaves,1);
  }
  const state=await h.get(['rt','cfg']);assert.equal(state.cfg.champOrange,false);assert.equal(state.cfg.champRed,false);assert.deepEqual(state.cfg.autoTasks,['farm','petbuff']);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:orange?'real orange remains forbidden':revealed?'fresh proof reveals forbidden orange behind dense URL':'HP-ambiguous ordinary gets fresh exact proof',browser:h.ctx.browser().version(),before,paths,calls,
   result:{starts:S.starts,attacks:S.attacks,leaves:S.leaves,conditionalReads:S.proofReads,retryMs:transient?proofTimes[1]-proofTimes[0]:null,mobHp:S.hp,hpMin:state.rt.hpMin['tumran bugbear']},errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 quest champion kind',JSON.stringify({case:kind,starts:S.starts,attacks:S.attacks,leaves:S.leaves,conditionalReads:S.proofReads}));
 }catch(e){console.error('DIAG quest-champion-kind',JSON.stringify({kind,S,paths,calls,routeErrors,state:await h.get(['on','rt']).then(x=>({on:x.on,status:x.rt.status,target:x.rt.target,hpMin:x.rt.hpMin,errs:x.rt.errs})).catch(String)}));throw e;}
 finally{releaseProof();releaseAttack();await h.ctx.close();}
}
(async()=>{try{for(const kind of process.env.QUEST_CHAMPION_KIND_CASES?JSON.parse(process.env.QUEST_CHAMPION_KIND_CASES):['ordinary','orange','revealed-orange','transient-http','transient-read'])await scenario(kind)}finally{if(process.env.QUEST_CHAMPION_KIND_PROOF)fs.writeFileSync(process.env.QUEST_CHAMPION_KIND_PROOF,JSON.stringify({boundary:'actual Chrome MV3; safe reconstructed Tumran DOM and local native handlers; client never GETs battle in new document; no live game or user scripts',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
