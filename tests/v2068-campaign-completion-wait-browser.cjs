'use strict';
// 27.10.2026: настоящий MV3/Start/main; глава9 готова, герой35/min36 уже у NPC.
// DOM и родные обработчики восстановлены безопасно; все HTTPS-ответы локальные, аккаунт игры не используется.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='campaign-wait-hero',SPAWN='dense_21883',MOB='Leto Lizardman Soldier',proof=[];
const clone=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 const h=await harness(),calls=[],paths=[],errors=[];
 const S={revision:100,level:35,inBattle:false,hp:9754,starts:0,attacks:0,completes:0,teleports:0,attackHeld:false,completed:false};
 let releaseAttack;const attackGate=new Promise(resolve=>releaseAttack=resolve);
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:S.level,rebirthStage:1,l2Profession:'human_wizard',classBranch:'mystic',race:'Human',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:S.level,owned:true,active:true}]},inBattle:S.inBattle,battleSpawnId:S.inBattle?SPAWN:null,
  hp:3317,maxHp:3317,mp:1648,maxMp:1648,cp:923,maxCp:923,adena:'30000000',sp:0,cityId:'gludin_village',currentZoneId:'wastelands',locationType:'zone',worldX:-23403,worldY:186599,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],activeSummon:null,vip:{active:false}});
 const quest=()=>({id:'dion_shadow_campaign',titleRu:'Тень над Дионом',stage:S.completed?'completed':'active',completed:S.completed,level:S.level,minLevel:36,
  chapter:S.completed?10:9,totalChapters:10,chapterTitleRu:S.completed?'Кампания завершена':'Перед бурей',location:{atNpc:true},npc:{id:'dion_campaign_envoy_kael',teleportId:'wastelands'}});
 const battle=()=>({spawnId:SPAWN,mobName:MOB,mobLevel:37,mobHp:S.hp,mobMaxHp:9754,kind:'passive',championTier:'',ended:!S.inBattle,
  log:[`Бой начат: ${MOB} (ур.37)`],logSeq:S.inBattle?1:3});
 const targets=`<ul id="starter-story-targets"><li class="l2-starter-story-target"><strong>${MOB}</strong> · Lv.37 <span class="l2-starter-story-progress">30 / 30</span><span class="l2-starter-story-done">✓</span></li><li class="l2-starter-story-target"><strong>Leto Lizardman Archer</strong> · Lv.36 <span class="l2-starter-story-progress">40 / 40</span><span class="l2-starter-story-done">✓</span></li></ul>`;
 const html=page=>`<!doctype html><meta charset="utf-8"><title>Campaign completion wait fixture</title>
  <div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">${S.level}</div><div id="character-profession">Human Wizard</div>
  <span id="l2-hud-hp-cur">3317</span><span id="l2-hud-hp-max">3317</span><span id="l2-hud-mp-cur">1648</span><span id="l2-hud-mp-max">1648</span>
  <div id="l2-nav-bottom"><a href="/map.html" data-nav-role="outskirts">Окрестности</a></div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>
  ${page==='/dion-campaign.html'?`<h1 id="dion-campaign-title">${S.completed?'Кампания завершена':'Глава9/10 · Перед бурей'}</h1>${targets}<div class="l2-starter-story-location"><button id="npc" data-quest-teleport-id="wastelands">К NPC</button></div>${S.level>=36&&!S.completed?'<button id="complete" data-action="complete-chapter">Завершить главу</button>':''}`:
   page==='/map.html'?`<div id="map-list-mode-mobs" class="is-active"></div><ul id="map-mob-list" data-l2-around-sig="1|${SPAWN}:0|p0"><li class="l2-map-mob-item l2-map-mob-item--battle"><a class="l2-map-mob-link l2-map-mob-link--lvl-same" href="/battle.html?spawnId=${SPAWN}">${MOB} · ур.37<span class="l2-mob-card-meta">HP9754 · EXP500</span></a></li></ul><span id="map-mob-page-ind">1 / 1 (1)</span>`:
   `<section id="battle-mob-panel"><h2 id="battle-mob-title">${MOB} · ур.37</h2><div id="battle-mob-hp-val">9754 / 9754</div></section><div id="battle-log">Бой начат: ${MOB} (ур.37)</div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" hidden><div id="battle-victory-lootline">EXP500 · SP100 · Adena100</div><a id="battle-back-map" href="/map.html">Продолжить</a></div>`}
  <script>
   localStorage.setItem('token','synthetic-local-campaign-wait');
   const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
   const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await(await fetch('/character')).json()).character;${page==='/dion-campaign.html'?'await fetch("/game/story-quests/dion-campaign");':''}})();
   for(const a of document.querySelectorAll('.l2-map-mob-link'))a.onclick=async e=>{e.preventDefault();await ready;const d=await post('/game/battle/start',{spawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});window.snapshot=d.character;location.href=a.href;};
   const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await ready;const d=await post('/game/battle/action',{action:'attack',battleSpawnId:'${SPAWN}',expectedRevision:window.snapshot.revision});window.snapshot=d.character;document.getElementById('l2-hud-legacy-lvl').textContent=d.character.level;document.getElementById('battle-mob-hp-val').textContent='0 / 9754';document.getElementById('battle-log').textContent='Победа! EXP500 SP100';document.getElementById('battle-victory-inline').hidden=false;};
   const npc=document.getElementById('npc');if(npc)npc.onclick=async()=>{await ready;await post('/game/story-quests/dion-campaign/teleport',{teleportId:'wastelands',expectedRevision:window.snapshot.revision});};
   const complete=document.getElementById('complete');if(complete)complete.onclick=async()=>{await ready;const d=await post('/game/story-quests/dion-campaign/complete-chapter',{expectedRevision:window.snapshot.revision});window.snapshot=d.character;document.getElementById('starter-story-targets').remove();document.getElementById('npc').remove();document.getElementById('dion-campaign-title').textContent='Кампания завершена';complete.remove();};
  </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   calls.push({path:p,method:req.method(),body:data,level:S.level});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(p==='/character')return json({character:character()});
   if(p==='/game/story-quests/dion-campaign')return json({quest:quest(),character:character()});
   if(p.startsWith('/game/story-quests/')&&req.method()==='GET')return json({quest:{completed:true,stage:'completed',chapter:10}});
   if(p==='/game/battle/start'){
    assert.equal(S.starts,0,'локальный фарм начинает ровно один бой');assert.equal(data.spawnId,SPAWN);assert.equal(data.expectedRevision,S.revision);
    S.starts++;S.inBattle=true;S.revision++;return json({ok:true,revision:S.revision,character:character(),battle:battle()});
   }
   if(p==='/game/battle/action'){
    assert.equal(S.attacks,0);assert.equal(data.action,'attack');assert.equal(data.battleSpawnId,SPAWN);assert.equal(data.expectedRevision,S.revision);
    S.attacks++;S.attackHeld=true;await attackGate;S.level=36;S.hp=0;S.inBattle=false;S.revision++;
    return json({ok:true,revision:S.revision,character:character(),battle:null,victory:{spawnId:SPAWN,mobName:MOB,mobLevel:37,fullLog:['Бой начат: '+MOB+' (ур.37)','Атака —9754 урона','Перемога!','EXP +500','SP +100'],expGain:'500',spGain:100,adenaGain:'100',levelUp:{level:36}}});
   }
   if(p==='/game/story-quests/dion-campaign/complete-chapter'){
    assert.equal(S.level,36,'до уровня36 нет разрешённой сдачи');assert.equal(S.inBattle,false);assert.equal(S.completes,0);assert.equal(data.expectedRevision,S.revision);
    S.completes++;S.completed=true;S.revision++;return json({ok:true,quest:quest(),character:character()});
   }
   if(/\/story-quests\/dion-campaign\/(?:teleport|transport)$/.test(p)){S.teleports++;throw Error('герой уже у NPC: телепорт не нужен');}
   assert.equal(req.method(),'GET','неожиданный POST '+p);return route.fallback();
  }catch(e){errors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['quests','petbuff'],campaign:true,campAuto:false,campaignEvery:25,taskOnly:false,zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,
    petAuto:false,petBuffAuto:true,petFullAuto:true,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',
    nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,chain:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,deepEvery:0,mapEvery:0,dailyKillLimit:0},
   rt:{...rt,char:'AuditHero',lvl:35,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,zone:'wastelands',hpMin:{},spawns:{dense_21883:['Leto Lizardman Soldier',37]},target:null,via:null,
    storySaga:{completed:true,stage:'completed'},dionCampaign:{stage:'active',completed:false,chapter:9,title:'Перед бурей',minLevel:36,level:35,atNpc:true,owner:JSON.stringify(['AuditHero','human_wizard',0]),t:now},
    campaign:null,campaignUrl:'/dion-campaign.html',campaignDue:true,campCompletionWait:null,campSkipUntil:0,campNoTasksUntil:0,questListT:now,questList:[{href:'/dion-campaign.html',title:'Тень над Дионом'}],
    shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});});
  await h.g.p.goto('https://l2wap.com/dion-campaign.html');await until(()=>h.g.core('rt.char==="AuditHero"&&!!L2V7Modules.quests.campCompletionWait'));
  const cfgBefore=await h.g.core('JSON.stringify([cfg.autoTasks,cfg.campaign,cfg.campAuto,cfg.zoneAuto,cfg.fishMode,cfg.rbHuntMode,cfg.catMode])');
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(()=>S.attackHeld,30000);
  const waiting=await h.g.core('({wait:L2V7Modules.quests.campCompletionWait(),campOn:campOn(),campActive:L2V7Modules.quests.campActive(),cfg:JSON.stringify([cfg.autoTasks,cfg.campaign,cfg.campAuto,cfg.zoneAuto,cfg.fishMode,cfg.rbHuntMode,cfg.catMode]),targets:rt.campaign?.targets,url:location.pathname+location.search})');
  assert.equal(waiting.wait?.kind,'level');assert.equal(waiting.wait.minLevel,36);assert.equal(waiting.campOn,false);assert.equal(waiting.campActive,false);assert.equal(waiting.cfg,cfgBefore);
  assert.equal(waiting.targets.length,2);assert.ok(waiting.targets.every(x=>x.ok));assert.equal(S.starts,1);assert.equal(S.teleports,0);assert.equal(S.completes,0);
  await delay(1200);assert.equal(paths.filter(p=>p==='/dion-campaign.html').length,1,'ожидание не создаёт повторные походы сдавать');
  assert.deepEqual(paths,['/dion-campaign.html','/map.html','/battle.html?spawnId='+SPAWN]);
  releaseAttack();await until(()=>S.completes===1,30000);await until(()=>h.g.core('rt.dionCampaign?.completed===true'),10000);
  await h.click('stop');await until(()=>h.g.core('!on&&!running'));
  const done=await h.get(['cfg','rt']);assert.equal(S.starts,1);assert.equal(S.attacks,1);assert.equal(S.completes,1);assert.equal(S.teleports,0);assert.equal(S.level,36);
  assert.equal(paths.filter(p=>p==='/dion-campaign.html').length,2,'новый уровень возвращает к главе ровно один раз');assert.equal(done.rt.campCompletionWait,null);assert.equal(done.rt.dionCampaign.completed,true);
  assert.deepEqual(done.cfg.autoTasks,['quests','petbuff']);assert.equal(done.cfg.campaign,true);assert.equal(done.cfg.zoneAuto,false);
  assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:'Dion9 level35 waits and farms locally; native victory level36 releases and displayed completion applies once',browser:h.ctx.browser().version(),paths,calls,waiting,result:clone(S),errors:[...errors,...h.errors]});
  console.log('PASS actual MV3 campaign completion wait',JSON.stringify({paths,starts:S.starts,attacks:S.attacks,completes:S.completes,teleports:S.teleports,level:S.level}));
 }catch(e){console.error('DIAG campaign-completion-wait',JSON.stringify({S,paths,calls,errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,wait:rt.campCompletionWait,campaign:rt.campaign,dion:rt.dionCampaign,owner:rt.actionOwner,inv:rt.inventoryGate})').catch(String)}));throw e;}
 finally{releaseAttack();await h.ctx.close();if(process.env.CAMPAIGN_COMPLETION_WAIT_PROOF)fs.writeFileSync(process.env.CAMPAIGN_COMPLETION_WAIT_PROOF,JSON.stringify({boundary:'actual Chrome MV3/main with synthetic native DOM and HTTPS fixtures; local one-hit victory advances level; no live game, account, or uploaded scripts',proof},null,2)+'\n');}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
