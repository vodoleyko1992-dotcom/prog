'use strict';
// 29.10: оплаченный Rebirth на 300/300 не покидается ради полного городского баффа суммона.
// Настоящие MV3/main/hook и native-кнопка чемпиона; все HTTPS локальные, полный бой не моделируется.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',SPAWN='rebirth_raid_'+RUN+'_champion_1',proof=[];
async function scenario(which){
 const orphan=which==='legacy-missing',stop=which==='Stop-read',h=await harness(),paths=[],calls=[],routeErrors=[];
 let release;const gate=new Promise(r=>release=r),S={revision:100,fights:0,held:false,keys:100};
 const char=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:41,rebirthStage:1,l2Profession:'human_wizard',race:'Human',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_wizard',level:41,rebirthStage:1}]},hp:5198,maxHp:5198,mp:2271,maxMp:2271,cp:992,maxCp:992,
  inBattle:false,sp:0,adena:'30000000',cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],vip:{active:false},
  activeSummon:{kind:'servitor',key:'mew_the_cat',summonSkillId:1278,summonSkillLevel:10,hp:4000,maxHp:4000,activeBuffs:[]}});
 const run=()=>orphan?null:{id:RUN,difficulty:1,phase:'mobs',mobKillTarget:300,mobKills:300,participantCharacterIds:[HERO],partyId:null,verifiedVictoryIds:[],referenceBossSpawnId:'l2dop_rb_25394',referenceBossLevel:41,mobLevel:41,mobLevelOwnerCharacterId:HERO};
 const hud=()=>'<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">41</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5198</span><span id="l2-hud-hp-max">5198</span><span id="l2-hud-mp-cur">2271</span><span id="l2-hud-mp-max">2271</span><div id="l2-hud-active-buffs"></div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>';
 const html=p=>{
  assert.ok(['/rebirth-raids.html','/rebirth-raid-dungeon.html'].includes(p),'поход не должен уходить в город: '+p);
  return `<!doctype html><meta charset="utf-8"><title>Rebirth paid-run preflight fixture</title>${hud()}<h1>Подземелье Rebirth RB</h1>${orphan?'<div id="rebirth-raid-levels">Ключи подземелья:100</div>':'<div id="rebirth-instance-content"><h2>300/300 · Появился чемпион</h2><button class="l2-rraid-fight" id="champion">Бой</button></div>'}<script>localStorage.setItem('token','local-only-town-preflight-fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.fixtureReady=true})();const fight=document.getElementById('champion');if(fight)fight.onclick=()=>fetch('/game/battle/start',{method:'POST',headers:{'Content-Type':'application/json','X-fixture-native':'1'},body:JSON.stringify({spawnId:'${SPAWN}',expectedRevision:100})}).then(r=>r.json()).then(()=>window.championOpened=true);</script>`;
 };
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),p=new URL(req.url()).pathname;calls.push({path:p,method:req.method()});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(req.method()==='POST'){
    assert.equal(p,'/game/battle/start','нет входа в город, оплаты баффа или нового похода');assert.equal(req.headers()['x-fixture-native'],'1');
    const b=req.postDataJSON();assert.equal(b.spawnId,SPAWN);assert.equal(b.expectedRevision,100);assert.equal(orphan,false);assert.equal(stop,false);S.fights++;
    return json({ok:true,battle:{spawnId:SPAWN},character:char()});
   }
   if(p==='/character'){
    if(stop&&!S.held&&(await h.get(['on'])).on){S.held=true;await gate;}return json({character:char()});
   }
   if(p==='/game/rebirth-raids')return json({enabled:true,rebirthStage:1,activeRun:run(),activeMobPage:20,totalMobPages:20});
   if(p==='/character/town/buffer/catalog')return json({sets:[{id:'summon',feeAdena:'10000000',feeCoinOfLuck:0,skills:[{skillId:1068,level:3,durationSec:18000}]}]});
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   return route.fallback(); // harness тоже отвечает локально, включая серверные часы/дневные лимиты
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{});}});
  await h.sw.evaluate(async({HERO,RUN,orphan})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now(),kick=5;
   await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:true,rebirthBossChoice:'manual',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:true,petBuffAuto:false,petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:200000,petFullRenew:true,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'',nPower:'',nBuffs:'',nPetBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0,autoRevive:true},
    rt:{...rt,char:'AuditHero',lvl:41,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:kick,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,
     rebirth:{char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,runId:RUN,mobKills:300,mobKillTarget:300,runPhase:'mobs',observedRun:{id:RUN,char:'AuditHero',actor:HERO,prof:'human_wizard',slot:0,kick,phase:'mobs',at:now-10000}},
     petFull:null,petPrep:null,petRaidPrep:null,petBufferTrip:orphan?{id:'legacy-town-trip',char:'AuditHero',revision:100,price:10000000,kick,t:now-60000,phase:'city',cityAt:now-60000,cityReload:0,rebirth:true,prof:'human_wizard',slot:0,home:{mode:'rebirth',zone:null,catIn:null,catDungeon:null,path:'/rebirth-raids.html'}}:null,
     storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,restoreRes:null,revive:null,deathLog:[],deaths:[],rbGo:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});
  },{HERO,RUN,orphan});
  await h.g.p.goto('https://l2wap.com/'+(orphan?'rebirth-raids.html':'rebirth-raid-dungeon.html'));
  await until(()=>h.g.p.evaluate(()=>window.fixtureReady));await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));
  await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));await until(()=>h.g.core('on&&running&&tabOwner'));
  if(stop){await until(()=>S.held,10000);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(500);}
  else if(orphan){await until(async()=>{const {rt}=await h.get(['rt']);return rt.petBufferTrip===null&&rt.rebirth?.phase==='missing-run';},20000);await h.popup.locator('#stop').click({force:true});}
  else{await until(()=>S.fights===1,20000);await h.popup.locator('#stop').click({force:true});}
  await until(async()=>!(await h.get(['on'])).on);const {rt}=await h.get(['rt']);
  assert.equal(S.fights,orphan||stop?0:1);assert.equal(S.keys,100);assert.equal(rt.rebirth.runId,RUN);assert.equal(rt.rebirth.mobKills,300);
  assert.equal(rt.petBufferTrip,null);assert.equal(rt.petFull?.pending??null,null);assert.ok(!paths.some(p=>/city|buffer|skill-panel/.test(p)));
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const result={case:which,browser:h.ctx.browser().version(),paths,calls,nativeChampionFights:S.fights,paidEntries:0,cityEntries:0,summonPurchases:0,keys:S.keys,runId:rt.rebirth.runId,mobKills:rt.rebirth.mobKills,orphanCleared:orphan?rt.petBufferTrip===null:null,status:rt.status,liveRequests:0,errors:[...routeErrors,...h.errors]};proof.push(result);
  console.log('PASS actual MV3 Rebirth town preflight',JSON.stringify({case:which,nativeChampionFights:S.fights,paidEntries:0,cityEntries:0,summonPurchases:0,mobKills:rt.rebirth.mobKills,liveRequests:0}));
 }catch(e){console.error('DIAG town-preflight',JSON.stringify({which,S,paths,routeErrors,pageErrors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,petFull:rt.petFull,petBufferTrip:rt.petBufferTrip,rebirth:rt.rebirth})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const c of ['active-run','Stop-read','legacy-missing'].filter(x=>!process.env.REBIRTH_TOWN_CASE||x===process.env.REBIRTH_TOWN_CASE))await scenario(c);}finally{if(process.env.REBIRTH_TOWN_PROOF)fs.writeFileSync(process.env.REBIRTH_TOWN_PROOF,JSON.stringify({boundary:'Actual current Chrome MV3/core/main/hook with fully local HTTPS and native champion button; paid run mobs300/300, live unbuffed Mew, no town/buff/new-entry; Stop and legacy orphan; full champion battle not modelled; no live game',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
