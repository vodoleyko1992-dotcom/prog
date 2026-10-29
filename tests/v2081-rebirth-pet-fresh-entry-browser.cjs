'use strict';
// 20.81: настоящий Chrome MV3/main/hook. Новый entry сверяет истёкший набор вопреки старому nextCheckAt; весь HTTPS локальный.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',proof=[];
async function scenario(stop){
 const h=await harness(),paths=[],calls=[],errors=[];let release;const gate=new Promise(r=>release=r),S={catalogs:0,held:false,entries:0,purchases:0};
 const char=()=>({id:HERO,name:'AuditHero',revision:100,level:41,rebirthStage:1,l2Profession:'human_wizard',race:'Human',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_wizard',level:41,rebirthStage:1}]},hp:5198,maxHp:5198,mp:2271,maxMp:2271,cp:992,maxCp:992,
  inBattle:false,sp:0,adena:'30000000',cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],vip:{active:false},
  activeSummon:{kind:'servitor',key:'mew_the_cat',summonSkillId:1278,summonSkillLevel:10,hp:2599,maxHp:2599,activeBuffs:[]}});
 const hud='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">41</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">5198</span><span id="l2-hud-hp-max">5198</span><span id="l2-hud-mp-cur">2271</span><span id="l2-hud-mp-max">2271</span><div id="l2-hud-active-buffs"></div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>';
 const html=p=>{
  assert.ok(['/rebirth-raids.html','/city.html'].includes(p),'подготовка не открывает бой или чужую страницу: '+p);
  return `<!doctype html><meta charset="utf-8"><title>Rebirth fresh summon fixture</title>${hud}${p==='/rebirth-raids.html'?'<h1>Подземелья Rebirth RB</h1><div id="rebirth-raid-levels">Ключи подземелья:100<section class="l2-rraid-difficulty">1. Easy Стоимость входа:2 ключа<button class="l2-rraid-difficulty__button" id="entry">Войти</button></section></div>':'<h1>Город</h1>'}<script>localStorage.setItem('token','local-only-fresh-pet-fixture');(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.fixtureReady=true})();const b=document.getElementById('entry');if(b)b.onclick=()=>fetch('/game/rebirth-raids/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({difficulty:1})});</script>`;
 };
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),p=new URL(req.url()).pathname,json=d=>route.fulfill({json:d}).catch(()=>{});calls.push({path:p,method:req.method()});
   if(p.endsWith('.html')){paths.push(p);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});}
   if(req.method()==='POST'){
    if(p==='/game/rebirth-raids/start')S.entries++;
    if(p==='/character/town/buffer')S.purchases++;
    return json({error:'no_post_expected'});
   }
   if(p==='/character')return json({character:char()});
   if(p==='/game/rebirth-raids')return json({enabled:true,rebirthStage:1,activeRun:null,levels:[],keys:100});
   if(p==='/character/town/buffer/catalog'){
    S.catalogs++;if(stop&&!S.held){S.held=true;await gate;}
    return json({sets:[{id:'summon',feeAdena:'10000000',feeCoinOfLuck:0,skills:[{skillId:1068,level:3,durationSec:18000}]}]});
   }
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   return route.fallback();
  }catch(e){errors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{});}});
  await h.sw.evaluate(async({HERO})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
   await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:true,rebirthBossChoice:'manual',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:200000,petFullRenew:true,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'',nPower:'',nBuffs:'',nPetBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0,autoRevive:true},
    rt:{...rt,char:'AuditHero',lvl:41,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:5,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,rebirth:{actor:HERO},
     petFull:{status:'active',lastCheckAt:now-60000,nextCheckAt:now+3600000,expiresAt:now-60000,lastReceipt:{id:'expired-full-set',petKey:'mew_the_cat',revision:90,expiresAt:now-60000}},petPrep:null,petRaidPrep:null,petBufferTrip:null,
     storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,restoreRes:null,revive:null,deathLog:[],deaths:[],rbGo:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});
  },{HERO});
  await h.g.p.goto('https://l2wap.com/rebirth-raids.html');await until(()=>h.g.p.evaluate(()=>window.fixtureReady));
  await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));await until(()=>h.g.core('on&&running&&tabOwner'));
  if(stop){
   await until(()=>S.held||S.entries>0,15000);assert.equal(S.entries,0,'до свежего каталога вход не разрешён');
   await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(700);
  }else{
   await until(async()=>S.entries>0||!!(await h.get(['rt'])).rt.petBufferTrip,20000);
   assert.equal(S.entries,0,'истёкший набор сначала направляется на прежнюю подготовку');
   await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);
  }
  const {rt}=await h.get(['rt']);assert.equal(S.catalogs,1);assert.equal(S.entries,0);assert.equal(S.purchases,0,'городская квитанция не выдумывается');
  if(stop){assert.equal(rt.petBufferTrip,null);assert.ok(!paths.includes('/city.html'),'Stop запрещает позднюю поездку');}
  else{assert.equal(rt.petBufferTrip?.rebirth,true);assert.equal(rt.petBufferTrip?.price,10000000);assert.equal(rt.petBufferTrip?.home.path,'/rebirth-raids.html');}
  assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:stop?'Stop-during-fresh-catalog':'expired-before-new-entry',browser:h.ctx.browser().version(),paths,calls,catalogReads:S.catalogs,paidEntries:S.entries,summonPurchases:S.purchases,preparationStarted:!!rt.petBufferTrip,liveRequests:0,errors:[...errors,...h.errors]});
  console.log('PASS actual MV3 fresh pet entry',JSON.stringify(proof.at(-1)));
 }catch(e){console.error('DIAG fresh pet entry',JSON.stringify({stop,S,paths,errors,pageErrors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,petFull:rt.petFull,petBufferTrip:rt.petBufferTrip,rebirth:rt.rebirth})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const stop of [false,true])await scenario(stop);}finally{if(process.env.REBIRTH_PET_FRESH_PROOF)fs.writeFileSync(process.env.REBIRTH_PET_FRESH_PROOF,JSON.stringify({boundary:'Actual Chrome MV3/main/hook with local HTTPS only; expired full set with future nextCheckAt before new entry starts existing city-preparation; Stop during catalog; no purchase, paid entry or full game battle',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
