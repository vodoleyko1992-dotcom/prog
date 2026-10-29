'use strict';
// 20.81: настоящий MV3/main с локальными HTTPS — актуальный encodedslot3→25134 и Stop на свежей сверке перед POST.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',SPAWN='rebirth_raid_'+RUN+'_1_1_25134_lv41_raid_3',proof=[];
async function scenario(stop){
 const h=await harness(),calls=[],paths=[],errors=[],S={revision:100,phase:'fixture_gate_phase',held:false,choices:0};let release;
 const gate=new Promise(r=>release=r);
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:41,rebirthStage:1,l2Profession:'human_wizard',race:'Human',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_wizard',level:41,rebirthStage:1}]},hp:5198,maxHp:5198,mp:2271,maxMp:2271,
  inBattle:false,sp:0,adena:'30000000',cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],activeSummon:null,vip:{active:false}});
 const run=()=>({id:RUN,difficulty:1,phase:S.phase,mobKillTarget:300,mobKills:300,participantCharacterIds:[HERO],partyId:null,
  ...(S.phase==='rb_active'?{selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25134'}:{})});
 const html=p=>`<!doctype html><meta charset="utf-8"><title>Rebirth state fixture</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">41</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5198</span><span id="l2-hud-hp-max">5198</span><span id="l2-hud-mp-cur">2271</span><span id="l2-hud-mp-max">2271</span><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button><h1>Подземелья Rebirth RB</h1><div id="rebirth-instance-content">${p==='/rebirth-raid-dungeon.html'?'<p>Чемпион побеждён</p>'+Array.from({length:16},()=>'<button class="l2-rraid-gate__enter">Войти</button>').join(''):'<p>Leto Chief Talkin: бой удержан стендом</p>'}</div><script>localStorage.setItem('token','local-only-rebirth-state-fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.fixtureReady=true})();</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),p=new URL(req.url()).pathname;calls.push({path:p,method:req.method()});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){assert.ok(['/rebirth-raid-dungeon.html','/rebirth-raid-lair.html'].includes(p),'платный/чужой маршрут запрещён '+p);paths.push(p);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)});}
   if(p==='/character'){if(stop&&!S.held&&(await h.get(['on'])).on){S.held=true;await gate;}return json({character:character()});}
   if(p==='/game/rebirth-raids')return json({enabled:true,rebirthStage:1,activeRun:run()});
   if(req.method()==='POST'){
    assert.equal(p,'/game/rebirth-raids/enter-boss');assert.equal(stop,false,'Stop отменяет POST выбора');assert.deepEqual(req.postDataJSON(),{bossSlot:3});S.choices++;assert.equal(S.choices,1);
    S.phase='rb_active';S.revision++;return json({run:run(),nextSpawnId:SPAWN});
   }
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   return route.fallback();
  }catch(e){errors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{});}});
  await h.sw.evaluate(async({HERO,RUN})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:false,rebirthBossChoice:'staff1h',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'',nPower:'',nBuffs:'',nPetBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0},
   rt:{...rt,char:'AuditHero',lvl:41,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:5,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,
    rebirth:{char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,runId:RUN,mobKills:300,mobKillTarget:300,runPhase:'fixture_gate_phase',observedRun:{id:RUN,char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,kick:5,phase:'fixture_gate_phase',at:now}},
    petFull:null,petPrep:null,petRaidPrep:null,petBufferTrip:null,storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,restoreRes:null,revive:null,deathLog:[],deaths:[],rbGo:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});},{HERO,RUN});
  await h.g.p.goto('https://l2wap.com/rebirth-raid-dungeon.html');await until(()=>h.g.p.evaluate(()=>window.fixtureReady));await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));
  await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));await until(()=>h.g.core('on&&running&&tabOwner'));
  if(stop){await until(()=>S.held,15000);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(500);}
  else{await until(async()=>{const {rt}=await h.get(['rt']);return rt.rebirth?.lastBossChoice?.spawnId==='l2dop_rb_25134'&&h.g.p.url().includes('/rebirth-raid-lair.html');},25000);await h.popup.locator('#stop').click({force:true});}
  await until(async()=>!(await h.get(['on'])).on);const {rt}=await h.get(['rt']);
  assert.equal(S.choices,stop?0:1);assert.equal(rt.rebirth.runId,RUN);if(!stop){assert.equal(rt.rebirth.lastBossChoice.choice,'staff1h');assert.ok(!/выбор РБ не подтверждён/.test(rt.status||''));}
  assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);assert.ok(!calls.some(c=>c.path==='/game/rebirth-raids/start'),'новый вход не оплачивается');
  const result={case:stop?'Stop-held-read':'slot3-current25134',browser:h.ctx.browser().version(),choices:S.choices,paths,calls,run:rt.rebirth,errors:[...errors,...h.errors],liveRequests:0};proof.push(result);
  console.log('PASS actual MV3 Rebirth state',JSON.stringify({case:result.case,choices:S.choices,selected:rt.rebirth.lastBossChoice?.spawnId||null,liveRequests:0}));
 }catch(e){console.error('DIAG Rebirth state',JSON.stringify({stop,S,paths,errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,rebirth:rt.rebirth})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const stop of [false,true])await scenario(stop);}finally{if(process.env.REBIRTH_STATE_PROOF)fs.writeFileSync(process.env.REBIRTH_STATE_PROOF,JSON.stringify({boundary:'Actual Chrome MV3/main with local HTTPS: own solo run, encodedslot3 with current25134, no live game, no paid entry, full raid fight not modelled; late metadata and stale-spawn recovery covered by Node regressions',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
