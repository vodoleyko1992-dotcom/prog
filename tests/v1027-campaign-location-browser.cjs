'use strict';
// Настоящий MV3/hook/dispatcher: ручной город → запуск → восстановление Cruma → бой. Все HTTP — моки.
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let revision=100,zone='cruma_marshlands',x=6040,y=125713,teleports=0,attacks=0;const visits=[],logs=[];h.g.p.on('console',m=>{if(m.text().includes('кампан'))logs.push(m.text())});
 // Синтетический полный снимок: регион dion не равен teleportId Cruma. Receipt опирается на POST + revision + координаты, не на выдуманное равенство zoneId.
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:35,hp:1000,maxHp:1000,mp:1000,maxMp:1000,revision,worldX:x,worldY:y,currentZoneId:'dion',locationType:zone==='dion'?'city':'zone',activeDungeonId:null,adena:1000000});
 const quest=()=>({stage:'active',chapter:5,completed:false,npc:{teleportId:'cruma_marshlands',worldX:6040,worldY:125713}});
 try{
 await h.ctx.route('https://l2wap.com/**',async r=>{const u=new URL(r.request().url()),p=u.pathname;const json=d=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  if(p==='/character')return json({character:character()});
  if(p==='/game/world/enter-city'){zone='dion';x=100;y=200;revision++;return json({character:character()})}
  if(p==='/game/story-quests/dion-campaign/teleport'){
   const req=r.request().postDataJSON(),s=(await h.get(['rt'])).rt;assert.equal(req.teleportId,'cruma_marshlands');assert.equal(req.expectedRevision,revision);assert.ok(s.campaignTp,'intent before POST');
   teleports++;zone='cruma_marshlands';x=6040;y=125713;revision++;return json({character:character(),quest:quest()});
  }
  if(p==='/game/story-quests/dion-campaign')return json({character:character(),quest:quest()});
  if(p==='/game/battle/action'){attacks++;revision++;assert.equal(zone,'cruma_marshlands','no combat on foreign map');return json({character:character(),delta:{mobHp:900,logTail:['Ты нанёс [Marsh Stakato] 100 урона.']}})}
  if(p.endsWith('.html')){visits.push(p);const map=p==='/map.html',camp=p==='/dion-campaign.html',battle=p==='/battle.html';return r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">35</div><div id="l2-nav-bottom"><a data-nav-role="outskirts" href="/map.html">Окрестности</a></div><span id="l2-hud-hp-cur">1000</span><span id="l2-hud-hp-max">1000</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span>
   ${map?`<div id="map-mob-list" data-l2-around-sig="1|cruma_mob:10|p0|lv35|qMarsh Stakato"><a class="l2-map-mob-link l2-map-mob-link--quest-target" href="/battle.html?spawnId=cruma_mob">Marsh Stakato · ур.35</a></div><span id="map-mob-page-ind">1 / 1 (1)</span>`:''}
   ${camp?'<h2 id="dion-campaign-title">Глава 5</h2><li class="l2-starter-story-target"><strong>Marsh Stakato</strong> · Lv.35: <span class="l2-starter-story-progress">0 / 40</span><small>Локация: Cruma Marshlands</small><button data-quest-teleport-id="cruma_marshlands">Телепорт</button></li>':''}
   ${battle?'<div id="battle-mob-title">Marsh Stakato · ур.35</div><div id="battle-mob-hp-val">1000 / 1000</div><button class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака" id="hit"><span data-slot-cd="attack">Атака</span></button>':''}
   <script>localStorage.setItem('token','fixture');fetch('/character');const tp=document.querySelector('[data-quest-teleport-id]');if(tp)tp.onclick=async()=>{const c=await(await fetch('/character')).json();await(await fetch('/game/story-quests/dion-campaign/teleport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teleportId:'cruma_marshlands',expectedRevision:c.character.revision})})).json()};const hit=document.getElementById('hit');if(hit)hit.onclick=()=>fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack'})});</script>`})}
  return json({});
 });
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,campaign:true,taskOnly:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',searchChamp:false,champFa:false,champBlue:false,champOrange:false,champRed:false,priority:'[квест]\n[все]',reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,lvlMin:1,lvlMax:99,lvlAbove:99,lvlBelow:99,autoMagister:false},rt:{...rt,char:'AuditHero',lvl:35,lastTeleport:'cruma_marshlands',campaignUrl:'/dion-campaign.html',campaignDue:false,campaign:{title:'Глава 5',targets:[{name:'Marsh Stakato',tp:'cruma_marshlands',done:0,total:40,ok:false}]},dionCampaign:{stage:'active',chapter:5,completed:false},zone:'cruma_marshlands',spawns:{cruma_mob:['Marsh Stakato',35]},questTargets:['Marsh Stakato'],zoneMobs:{cruma_marshlands:['Marsh Stakato']},manualKickAt:0}})});
 await h.g.p.reload();await until(()=>h.g.core('rt.campaign?.targets?.[0]?.tp==="cruma_marshlands"'));
 // Ручной вход в город при остановленном боте. Native API реально проходит через hook.
 await h.g.p.evaluate(()=>fetch('/game/world/enter-city',{method:'POST'}));await h.g.p.goto('https://l2wap.com/magister.html');await delay(300);await h.g.p.goto('https://l2wap.com/map.html');await h.click('start');
 await until(()=>teleports===1,25000);await until(()=>attacks>0,25000);await h.click('stop');await until(()=>h.g.core('!on'));
 assert.equal(teleports,1);assert.equal(visits.filter(x=>x==='/dion-campaign.html').length,1);assert.equal((await h.get(['rt'])).rt.campaignTp,null);assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 manual city → guild → resume: stale Cruma restored once, same foreign mob ignored, correct battle attack');
 // Та же гильдия без городского POST не меняет точку: перезагрузка и старт не покупают повторный перенос.
 await h.g.p.goto('https://l2wap.com/magister.html');await h.g.p.goto('https://l2wap.com/map.html');await h.click('start');await until(()=>h.g.p.url().includes('/battle.html'),20000);await h.click('stop');assert.equal(teleports,1);assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 guild load + reload at same coordinates → next battle, no repeat teleport');
 }catch(e){console.error('DIAG',JSON.stringify({teleports,attacks,visits,logs,url:h.g.p.url(),errors:h.errors,state:await h.get(['on','rt']).then(s=>({on:s.on,status:s.rt.status,at:s.rt.campaignAt,pending:s.rt.campaignTp,owner:s.rt.actionOwner,errs:s.rt.errors}))}));throw e}finally{await h.ctx.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
