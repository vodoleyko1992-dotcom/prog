'use strict';
// 20.41 (лог 20.10 21:15: моб катакомб ≈9 с, из них ≈4 с — загрузка новой страницы боя): настоящий MV3, HTTPS целиком локальный.
// Однородный список — следующий бой штатной кнопкой «Охотиться дальше» в том же документе; разные уровни — прежний переход на страницу боя.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const RTT=400,did='necropolis_of_martyrdom',sid=n=>'sdms_'+did+'_'+n,initial=sid('013'),next=sid('032');
const row=(n,name,level)=>({id:sid(n),name,level,kind:'passive',inBattleRange:true});
async function scenario(kind){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const rows=kind==='native'?[row('013','Lilim Knight Banneret',72),row('032','Nephilim Praetorian',72),row('040','Lilim Knight Banneret',72),row('051','Nephilim Praetorian',72),row('060','Lilim Knight Banneret',72)]
  :[row('013','Lilim Knight Banneret',72),row('032','Nephilim Praetorian',72),row('040','Grave Warden',64),row('051','Grave Warden',64),row('060','Grave Warden',63)];
 let huntAt=0,huntDone=0,firstAction=0,docLoaded=0;
 const ch=()=>({id:'cat-native-hero',name:'AuditHero',revision:100,level:71,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:71}]},adena:30000000,inBattle:true,hp:16549,maxHp:21188,mp:837,maxMp:1883,mobsKilled:0,locationType:'dungeon',activeDungeonId:did,inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153}]},activeBuffs:[],activeSummon:null});
 const battle=()=>({spawnId:next,mobName:'Nephilim Praetorian',mobHp:3636,mobMaxHp:3636,mobLevel:72,kind:'passive',log:[]});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">71</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">16549</span><span id="l2-hud-hp-max">21188</span><span id="l2-hud-mp-cur">837</span><span id="l2-hud-mp-max">1883</span>';
 const act=`document.getElementById('attack').onclick=()=>fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'${next}'})});`;
 // Старый документ: экран победы; «Охотиться дальше» как в игре — POST hunt-continue, новый бой в той же странице и spawnId в адресе.
 const oldDoc='<!doctype html><meta charset="utf-8"><title>Бой — L2WAP</title>'+base+`<div id="battle-mob-title">Lilim Knight Banneret · ур.72</div><div id="battle-mob-hp-val">0 / 3636</div><div id="battle-log"></div><div id="battle-victory-inline">Победа!</div><button id="battle-victory-hunt">Охотиться дальше</button><button class="l2-battle-hotbar-slot" title="Атака" id="attack" hidden><span data-slot-cd="attack" hidden></span></button><script>
 document.getElementById('battle-victory-hunt').onclick=async()=>{const d=await(await fetch('/game/battle/hunt-continue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({excludeSpawnId:'${initial}',preferredSpawnId:'${next}',targetLevel:72,expectedRevision:100})})).json();
  history.replaceState({},'','/battle.html?spawnId='+d.battle.spawnId);document.getElementById('battle-victory-inline').hidden=true;document.getElementById('battle-victory-hunt').hidden=true;
  document.getElementById('battle-mob-title').textContent=d.battle.mobName+' · ур.'+d.battle.mobLevel;document.getElementById('battle-mob-hp-val').textContent='3636 / 3636';document.getElementById('attack').hidden=false;};
 ${act}</script>`;
 const newDoc='<!doctype html><meta charset="utf-8"><title>Бой — L2WAP</title>'+base+`<div id="battle-mob-title">Nephilim Praetorian · ур.72</div><div id="battle-mob-hp-val">3636 / 3636</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/game/battle/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spawnId:'${next}'})});${act}</script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;calls.push({path:p,method:q.method(),at:Date.now()});
   if(p.endsWith('.html')){paths.push(p+u.search);if(p==='/battle.html'&&u.searchParams.get('spawnId')===next){await delay(900);docLoaded=Date.now();return r.fulfill({contentType:'text/html',body:newDoc}).catch(()=>{});}return r.fulfill({contentType:'text/html',body:oldDoc});}
   if(p==='/character')return r.fulfill({json:{character:ch()}});
   if(p==='/game/dungeon/view'){assert.equal(q.method(),'GET');return r.fulfill({json:{dungeon:{id:did,mobs:rows}}});}
   if(p==='/game/battle/hunt-continue'){huntAt ||= Date.now();await delay(RTT);huntDone=Date.now();return r.fulfill({json:{character:ch(),battle:battle(),ok:true}});}
   if(p==='/game/battle/start'){await delay(RTT);return r.fulfill({json:{character:ch(),battle:battle(),ok:true}});}
   if(p==='/game/battle/action'){firstAction ||= Date.now();return r.fulfill({json:{character:ch(),battle:battle(),ok:true,serverNowMs:Date.now(),globalCooldownUntilMs:Date.now()+60000}});}
   assert.equal(q.method(),'GET','никаких платных/случайных POST');
   return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({did})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['cat'],taskOnly:false,catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:5,rbHuntMode:false,rbMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',nPower:'',nUltra:'',nStun:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',nAttack:'Атака',searchChamp:false,searchQuest:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catKillLimit:0,dailyCatKillLimit:0},rt:{...rt,char:'AuditHero',lvl:71,prof:'Bounty hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},classBranch:'fighter',manualKickAt:0,catCur:did,catIn:did,catInT:Date.now(),catLv:{[did]:{lo:63,hi:75,n:5,t:Date.now()}},invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:{name:'Lilim Knight Banneret',rb:false,champ:false},buffCancel:{}}})},{did});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+initial);await until(()=>h.g.core('typeof L2V7Modules.dungeons.catNext==="function"'));
  await h.popup.reload();await h.g.p.bringToFront();
  const t0=Date.now();await h.click('start');
  await until(()=>firstAction,20000);
  await h.click('stop');await until(async()=>!(await h.get(['on'])).on);
  const huntN=calls.filter(x=>x.path==='/game/battle/hunt-continue').length,navN=paths.filter(x=>x.includes('spawnId='+next)).length;
  if(kind==='native'){
   assert.equal(huntN,1,'одно штатное продолжение');assert.equal(navN,0,'без новой страницы боя');
   assert.ok(firstAction>huntDone,'удар — уже по новому бою');
  }else{assert.equal(huntN,0,'разные уровни — без случайного выбора сервера');assert.equal(navN,1,'свой выбор — одна навигация');}
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 cat '+kind,JSON.stringify({startToFirstActionMs:firstAction-t0,huntToFirstActionMs:huntAt?firstAction-huntAt:null,docToFirstActionMs:docLoaded?firstAction-docLoaded:null,hunt:huntN,navigations:navN}));
 }finally{await h.ctx.close();}
}
(async()=>{for(const k of ['native','spread'])await scenario(k)})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
