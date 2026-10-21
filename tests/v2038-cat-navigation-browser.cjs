'use strict';
// 20.38 (лог20.10 19:36): старый экран победы не должен начинать новый выбор,
// пока браузер загружает уже выбранный бой. Настоящий MV3; HTTPS целиком локальный.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const proof=[],DELAY=1200;
async function scenario(stop){
 const h=await harness(),calls=[],paths=[],routeErrors=[],statusTrace=[];
 h.g.p.on('console',m=>{const t=m.text();if(t.startsWith('CAT_NAV_OBS:')){try{statusTrace.push(JSON.parse(t.slice(12)))}catch(_){}}});
 const did='necropolis_of_martyrdom',sid=n=>'sdms_'+did+'_'+n,initial=sid('013'),next=sid('032');
 let nextStarted=0,nextFulfilled=0,firstAction=0,stoppedAt=0,pendingState=null;
 const rows=[{id:initial,name:'Lilim Knight Banneret',level:72,kind:'passive',inBattleRange:true},{id:next,name:'Nephilim Praetorian',level:72,kind:'passive',inBattleRange:true}];
 const ch=()=>({id:'cat-navigation-hero',name:'AuditHero',revision:100,level:71,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:71}]},adena:30000000,inBattle:!!nextFulfilled,hp:16549,maxHp:21188,mp:837,maxMp:1883,mobsKilled:0,locationType:'dungeon',activeDungeonId:did,inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153}]},activeBuffs:[],activeSummon:null});
 const battle=()=>({spawnId:next,mobName:'Nephilim Praetorian',mobHp:3636,mobMaxHp:3636,mobLevel:72,kind:'passive',log:[]});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">71</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">16549</span><span id="l2-hud-hp-max">21188</span><span id="l2-hud-mp-cur">837</span><span id="l2-hud-mp-max">1883</span>';
 const html=old=>'<!doctype html><meta charset="utf-8"><title>Переход катакомб</title>'+base+(old?'<div id="battle-mob-title">Lilim Knight Banneret · ур.72</div><div id="battle-mob-hp-val">0 / 3636</div><div id="battle-log"></div><div id="battle-victory-inline">Победа!</div><button id="battle-victory-hunt">Охотиться дальше</button>':`<div id="battle-mob-title">Nephilim Praetorian · ур.72</div><div id="battle-mob-hp-val">3636 / 3636</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/game/battle/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spawnId:'${next}'})});document.getElementById('attack').onclick=()=>fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'${next}'})});</script>`);
 const state=()=>h.g.core('({on,running,tabOwner,status:rt.status,target:rt.target,recent:RECENT.slice(),url:location.href})');
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;calls.push({path:p,query:u.search,method:q.method(),at:Date.now()});
   if(p.endsWith('.html')){
    paths.push({url:p+u.search,at:Date.now()});
    if(p==='/battle.html'&&u.searchParams.get('spawnId')===next){nextStarted ||= Date.now();await delay(DELAY);nextFulfilled=Date.now();return r.fulfill({contentType:'text/html',body:html(false)}).catch(()=>{});}
    return r.fulfill({contentType:'text/html',body:html(p==='/battle.html')});
   }
   if(p==='/character')return r.fulfill({json:{character:ch()}});
   if(p==='/game/dungeon/view'){assert.equal(q.method(),'GET');assert.equal(u.searchParams.get('dungeonId'),did);return r.fulfill({json:{dungeon:{id:did,mobs:rows}}});}
   if(p==='/game/battle/start')return r.fulfill({json:{character:ch(),battle:battle(),ok:true}});
   if(p==='/game/battle/action'){firstAction ||= Date.now();return r.fulfill({json:{character:ch(),battle:battle(),ok:true,serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+60000}});}
   assert.equal(q.method(),'GET','никаких платных/случайных POST');
   return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({did})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['cat'],taskOnly:false,catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:5,rbHuntMode:false,rbMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',nAttack:'Атака',searchChamp:false,searchQuest:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catKillLimit:0,dailyCatKillLimit:0},rt:{...rt,char:'AuditHero',lvl:71,prof:'Bounty hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},classBranch:'fighter',manualKickAt:0,catCur:did,catIn:did,catInT:Date.now(),catLv:{[did]:{lo:70,hi:75,n:5,t:Date.now()}},invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:{name:'Lilim Knight Banneret',rb:false,champ:false},buffCancel:{}}})},{did});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+initial);await until(()=>h.g.core('typeof L2V7Modules.dungeons.catNext==="function"'));
  await h.popup.reload();await h.g.p.bringToFront();
  await h.g.core("window.__catNavObserve=setInterval(()=>{const r=RECENT[0];if(r&&r.t!==window.__catNavObserved){window.__catNavObserved=r.t;console.info('CAT_NAV_OBS:'+JSON.stringify(r));}},10);true");
  await h.click('start');
  await until(()=>nextStarted,15000);await delay(400);
  const stored=await h.get(['rt']);pendingState={target:stored.rt.target,status:stored.rt.status,observedAt:Date.now()};
  if(stop){stoppedAt=Date.now();await h.click('stop');await until(async()=>!(await h.get(['on'])).on);}
  const pendingViews=calls.filter(x=>x.path==='/game/dungeon/view').length;
  const pendingPaths=paths.filter(x=>x.url.includes('spawnId='+next)).length;
  const duplicateLoads=statusTrace.filter(x=>x.t>=nextStarted&&x.s==='Бой: загрузка');
  assert.equal(pendingViews,1,'пока новый документ грузится, старый не перечитывает список целей');
  assert.equal(pendingPaths,1,'одна выбранная цель даёт одну навигацию, без перезапуска загрузки');
  assert.equal(duplicateLoads.length,0,'старый экран победы не запускает battleOpen заново');
  if(pendingState)assert.equal(pendingState.target.name,'Nephilim Praetorian');
  await until(()=>h.g.p.url().endsWith('spawnId='+next),15000);
  await until(()=>h.g.core('typeof on!=="undefined"'),10000);
  if(stop){assert.ok(stoppedAt>nextStarted&&stoppedAt<nextFulfilled,'Stop пришёл во время загрузки, до нового документа');await delay(700);assert.equal(firstAction,0,'Stop до загрузки нового боя запрещает удар');assert.equal(await h.g.core('on'),false);}
  else{await until(()=>firstAction,10000);assert.ok(firstAction-nextFulfilled<2800,'новый документ не ждёт таймаут старой навигации');await h.click('stop');await until(async()=>!(await h.get(['on'])).on);}
  // 20.41: новый бой сам заранее читает список подземелья (catPrefetch в начале боя) — это уже новый документ; старый список не перечитывает.
  assert.equal(calls.filter(x=>x.path==='/game/dungeon/view'&&x.at<nextFulfilled).length,1);
  assert.ok(calls.filter(x=>x.path==='/game/dungeon/view').length<=(stop?1:2));
  assert.equal(paths.filter(x=>x.url.includes('spawnId='+next)).length,1);
  assert.equal(paths.some(x=>x.url.startsWith('/dungeon.html')),false,'старый документ не перекрывает новый бой возвратом в подземелье');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const item={case:stop?'Stop while document loads':'single navigation then immediate new-document combat',browser:h.ctx.browser().version(),navigationDelayMs:DELAY,stopBeforeDocument:stop?stoppedAt<nextFulfilled:null,statusTrace,views:pendingViews,navigations:pendingPaths,oldDocumentReloadStatuses:duplicateLoads.length,newDocumentFirstActionMs:!stop?firstAction-nextFulfilled:null,pendingState,calls,paths,errors:[...routeErrors,...h.errors]};proof.push(item);console.log('PASS actual MV3 cat navigation',JSON.stringify({case:item.case,views:pendingViews,navigations:pendingPaths,newDocumentFirstActionMs:item.newDocumentFirstActionMs}));
 }catch(e){proof.push({case:stop?'Stop while document loads':'single navigation',failed:e.message,calls,paths,statusTrace,pendingState,routeErrors,state:await state().catch(String)});throw e;}
 finally{await h.ctx.close();}
}
(async()=>{try{for(const stop of [false,true])await scenario(stop)}finally{if(process.env.CAT_NAV_PROOF)fs.writeFileSync(process.env.CAT_NAV_PROOF,JSON.stringify({at:new Date().toISOString(),boundary:'actual extension/main; fully local HTTPS, delayed document navigation; no live game',proof},null,2)+'\n')}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
