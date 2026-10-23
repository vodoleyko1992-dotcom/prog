'use strict';
// Настоящее MV3/Start/диспетчер; DOM и все HTTPS-ответы игры локальные. Живых боёв нет.
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
const base=`<meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">68</div><div id="character-profession">Human Warlord</div><span id="l2-hud-hp-cur">18117</span><span id="l2-hud-hp-max">18117</span><span id="l2-hud-mp-cur">1713</span><span id="l2-hud-mp-max">1713</span><div id="l2-nav-bottom"><a href="/map.html" data-nav-role="outskirts">Окрестности</a></div><script>localStorage.setItem('token','synthetic-local-only');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch('/character')})();</script>`;
const pages={
 '/character-quests.html':base+`<div id="character-quests-list"><div class="l2-character-quests-entry"><a class="l2-character-quests-entry__title" href="/noblesse-quest.html">Possessor of a Precious Soul · 1/4</a><div class="l2-character-quests-entry__line">★ Vanor Silenos Chieftain — 0/100</div><div class="l2-character-quests-entry__line">✓ Varnish — 100/100</div></div></div>`,
 '/noblesse-quest.html':base+'<h1>Possessor of a Precious Soul · 1/4</h1><p>★ Vanor Silenos Chieftain — 0/100</p><button data-noblesse-action="teleport" data-noblesse-target="aden">Телепорт</button>',
 '/map.html':base+`<div id="map-list-mode-mobs" class="is-active"></div><ul id="map-mob-list" class="l2-map-mob-list" data-l2-around-sig="1|dense_9584:0|p0"><li class="l2-map-mob-item l2-map-mob-item--battle"><a class="l2-map-mob-link l2-map-mob-link--quest-target" href="/battle.html?spawnId=dense_9584">★ Vanor Silenos Chieftain · ур. 50<span class="l2-mob-card-meta">HP 2 580 · EXP 3 637</span></a></li></ul>`
};
(async()=>{const h=await harness();const visits=[],posts=[];try{
 await h.ctx.route('https://l2wap.com/**',async r=>{const u=new URL(r.request().url()),p=u.pathname;if(r.request().method()==='POST')posts.push(p);
  if(pages[p]){visits.push(p);return r.fulfill({contentType:'text/html',body:pages[p]});}
  if(p==='/character')return r.fulfill({json:{character:{name:'AuditHero',id:'hero',revision:100,level:68,l2Profession:'human_warlord',classBranch:'fighter',classSlots:{activeSlot:3,slots:[{slot:3,profession:'human_warlord',active:true,owned:true,level:68}]},hp:18117,maxHp:18117,mp:1713,maxMp:1713,adena:1000000,inBattle:false,currentZoneId:'aden',cityId:'aden',locationType:'zone',worldX:1,worldY:1,inventory:{eq:{},stacks:[]},activeBuffs:[],activeSummon:null}}});
  if(p==='/game/story-quests/noblesse')return r.fulfill({json:{quest:{active:true,completed:false,part:1,totalParts:4,subclassLevel:68,minLevel:50,actions:{canAdvance:false},targets:[{name:'Vanor Silenos Chieftain',level:50,have:0,need:100,teleportId:'aden'},{name:'Varnish',have:100,need:100}]}}});
  if(p.startsWith('/game/story-quests/'))return r.fulfill({json:{quest:{completed:true,stage:'completed',chapter:10}}});
  if(p==='/battle.html'){visits.push('/battle.html?'+u.searchParams.toString());return r.fulfill({contentType:'text/html',body:base+'<div id="battle-mob-title">Vanor Silenos Chieftain · ур.50</div>'});}
  return r.fallback();
 });
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['quests'],campaign:true,campAuto:false,townBuff:false,townBuffSet:'off',vipBuffAuto:false,autoMagister:false,weaponScanAuto:false,shopAuto:false,petAuto:false,petFullAuto:false,petBuffAuto:false,nBuffs:'',nToggles:'',nPetBuffs:'',searchQuest:true,searchChamp:false,priority:'[квест]\n[все]',lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,stopHp:0,autoSnap:false,rec:false},rt:{...rt,char:'AuditHero',lvl:68,prof:'Human Warlord',classCur:{prof:'human_warlord',slot:3},zone:'aden',spawns:{dense_9584:['Vanor Silenos Chieftain',50]},questTargets:['Vanor Silenos Chieftain'],questSeen:{'vanor silenos chieftain':now},storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:true,questList:[],questListT:0,campSkipUntil:0,campNoTasksUntil:0,manualKickAt:0,weaponsT:now,shopT:now,actionOwner:null,actionPayments:{pending:null,history:[]},storyJob:null,invScan:null,shop:null,tbuff:null,magister:null,rbGo:null,rbHunt:null}});});
 await h.g.p.goto('https://l2wap.com/character-quests.html');await until(()=>h.g.core('JSON.stringify(cfg.autoTasks)==="[\\"quests\\"]"'));
 await h.popup.reload();await h.popup.locator('#start').click();
  await until(()=>visits.some(x=>x==='/battle.html?spawnId=dense_9584'),30000);
  assert.equal(visits.filter(x=>x==='/character-quests.html').length,1);
  assert.equal(visits.includes('/noblesse-quest.html'),false);
  const {cfg,rt}=await h.get(['cfg','rt']);assert.deepEqual(cfg.autoTasks,['quests']);assert.equal(rt.campNoTasksUntil||0,0);assert.equal(rt.storyJob,null);assert.equal(posts.some(x=>/noblesse|teleport/.test(x)),false);
  assert.deepEqual(h.errors,[]);console.log('PASS actual Start, quests-only → list handoff → map → native ★ Vanor link, without Noblesse/list loop, paid requests or JS errors',JSON.stringify(visits));
 await h.popup.locator('#stop').click();
}catch(e){console.error('DIAG',JSON.stringify({url:h.g.p.url(),visits,posts,errors:h.errors,core:await h.g.core('({on,running,tabOwner,mode:autonomyMode(),status:rt.status,campaign:rt.campaign,inv:rt.inventoryGate,actionOwner:rt.actionOwner,questList:rt.questList})').catch(()=>null)}));throw e;}finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
