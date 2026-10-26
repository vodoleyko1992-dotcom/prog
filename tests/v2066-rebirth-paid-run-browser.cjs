'use strict';
// 20.66: уже оплаченный Rebirth run; точные next{phase,spawnId} и run-поля из статического журнала26.10.
// Настоящий MV3/main/hook, только собственный локальный native-клиент. Скрипты игрока не исполняются.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const RUN='00000000-0000-4000-8000-000000000001',HERO='00000000-0000-4000-8000-000000000002';
const NAME='Rebirth · Akaste Succubus Turen',prefix='rebirth_raid_'+RUN+'_1_1_25146_mob_',proof=[];

async function scenario(race){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={index:race?19:20,won:race,hp:race?0:2546,max:7128,mobKills:19,revision:100,keys:18,entries:0,attacks:0,starts:[],nextReads:[],runReads:0,held:false,nextHeld:false,actionHeld:false,chatHeld:false,chatReleased:false};
 let releaseRun,releaseNext,releaseAction,releaseChat;
 const runGate=new Promise(r=>releaseRun=r),nextGate=new Promise(r=>releaseNext=r),actionGate=new Promise(r=>releaseAction=r),chatGate=new Promise(r=>releaseChat=r);
 const spawn=()=>prefix+S.index;
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:21,rebirthStage:1,l2Profession:'human_wizard',classBranch:'mystic',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:21}]},inBattle:!S.won,battleSpawnId:S.won?null:spawn(),
  hp:2254,maxHp:2254,mp:986,maxMp:986,sp:0,cityId:'l2dop_dion',currentZoneId:'plains_of_dion',locationType:'zone',inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const battle=()=>({spawnId:spawn(),mobName:NAME,mobLevel:21,mobHp:S.hp,mobMaxHp:S.max,kind:'dungeon',championTier:'',ended:S.won,
  log:[`Бій розпочато: [${NAME}] (ур.21).`,...(S.won?['Перемога!']:[])],logSeq:S.won?2:1});
 const response=()=>({ok:true,revision:S.revision,character:character(),battle:battle(),...(S.won?{victory:{spawnId:spawn(),mobName:NAME,
  fullLog:[`Ты нанёс [${NAME}] 2546 урона.`,'Перемога!'],rewards:{adena:50,exp:100,sp:10}}}:{})});
 const instance=()=>({enabled:true,rebirthStage:1,highestCleared:0,activeRun:{id:RUN,difficulty:1,phase:'mobs',mobKillTarget:300,mobKills:S.mobKills,
  verifiedVictoryIds:[],participantCharacterIds:[HERO],partyId:null,referenceBossSpawnId:'l2dop_rb_25146',referenceBossLevel:21},
  selectedBossCurrentHp:null,bossChoices:[],selectedBossPreview:null,activeMobPage:2,mobPage:2,totalMobPages:20,mobTargets:[]});
 const html=()=>`<!doctype html><meta charset="utf-8"><title>Paid Rebirth run fixture</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">21</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">2254</span><span id="l2-hud-hp-max">2254</span><span id="l2-hud-mp-cur">986</span><span id="l2-hud-mp-max">986</span>
  <section id="battle-mob-panel" class="l2-battle-mob-panel"><h2 id="battle-mob-title" class="l2-battle-mob-title">${NAME} · ур.21 · агрессивный</h2><div id="battle-mob-hp-val">${S.hp} / 7128</div></section><div id="battle-log"></div>
  <button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button>
  <div id="battle-victory-inline" ${S.won?'':'hidden'}><div id="battle-victory-lootline">100 EXP · 10 SP</div><button id="battle-victory-hunt" class="l2-battle-victory-link">Охотиться дальше</button></div><a id="battle-back-map" href="/map.html">Назад на карту</a>
  <script>
   localStorage.setItem('token','local-paid-rebirth-fixture');window.huntActors=[];window.currentSpawn='${spawn()}';window.continues=0;
   const post=(path,data)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
   const render=d=>{window.snapshot=d.character;window.currentSpawn=d.battle.spawnId;document.getElementById('battle-mob-title').textContent=d.battle.mobName+' · ур.'+d.battle.mobLevel+' · агрессивный';document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / '+d.battle.mobMaxHp;document.getElementById('battle-victory-inline').hidden=!d.victory;document.getElementById('battle-log').textContent=(d.victory?.fullLog||d.battle.log).join(String.fromCharCode(10));};
   const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));await fetch('/character');render(await(await fetch('/game/battle?characterId=${HERO}&spawnId='+encodeURIComponent(window.currentSpawn))).json());window.fixtureReady=true;})();
   document.getElementById('hit').onclick=async()=>{await ready;render(await post('/game/battle/action',{action:'attack',battleSpawnId:window.currentSpawn,expectedRevision:window.snapshot.revision}));};
   document.getElementById('battle-victory-hunt').onclick=async e=>{await ready;window.huntActors.push(e.isTrusted?'manual':'bot');const next=await(await fetch('/game/rebirth-raids/next?after='+encodeURIComponent(window.currentSpawn))).json();
    if(next.phase!=='mobs'||!next.spawnId)throw Error('fixture unexpected terminal phase');const d=await post('/game/battle/start',{spawnId:next.spawnId,expectedRevision:window.snapshot.revision});render(d);history.replaceState(null,'','/battle.html?spawnId='+encodeURIComponent(window.currentSpawn));window.continues++;};
   document.getElementById('battle-back-map').onclick=async e=>{e.preventDefault();await ready;await post('/game/battle/leave',{battleSpawnId:window.currentSpawn,expectedRevision:window.snapshot.revision});location.href='/map.html';};
  </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   calls.push({path:p,query:u.search,method:req.method(),body:data,index:S.index,keys:S.keys});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);assert.equal(p,'/battle.html','оплаченный run не уводится на карту/каталог/новый вход');return route.fulfill({contentType:'text/html; charset=utf-8',body:html()}).catch(()=>{});}
   if(p==='/character')return json({character:character()});
   if(p==='/game/chat/replies/unread-count'){assert.equal(req.method(),'GET');S.chatHeld=true;await chatGate;return json({count:0});}
   if(p==='/game/battle'){
    assert.equal(u.searchParams.get('characterId'),HERO);assert.equal(u.searchParams.get('spawnId'),spawn());return json(response());
   }
   if(p==='/game/rebirth-raids'){
    assert.equal(req.method(),'GET');assert.equal(u.searchParams.get('view'),'instance');S.runReads++;
    if(race&&S.runReads===1){S.held=true;await runGate;}return json(instance());
   }
   if(p==='/game/rebirth-raids/next'){
    assert.equal(req.method(),'GET');assert.equal(S.won,true,'native next разрешён только после победы');
    assert.equal(u.searchParams.get('after'),spawn());S.nextReads.push(S.index);return json({phase:'mobs',spawnId:prefix+(S.index+1)});
   }
   if(p==='/game/rebirth-raids/start'){S.entries++;S.keys-=2;throw Error('новый платный вход вместо продолжения уже оплаченного run');}
   if(p==='/game/battle/start'){
    assert.equal(req.method(),'POST');assert.equal(S.won,true,'повтор активного боя запрещён');assert.equal(data.spawnId,prefix+(S.index+1));assert.equal(data.expectedRevision,S.revision);
    const n=S.index+1;assert.ok(n===20||n===21,'лишнее native продолжение');S.starts.push(n);S.index=n;S.won=false;S.hp=n===20?2546:7128;S.revision++;
    if(n===21){S.nextHeld=true;await nextGate;}return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal((await h.get(['on'])).on,true);assert.equal(S.index,20);assert.equal(S.won,false);assert.equal(data.action,'attack');assert.equal(data.battleSpawnId,spawn());assert.equal(data.expectedRevision,S.revision);
    S.attacks++;assert.equal(S.attacks,1);S.hp=0;S.won=true;S.mobKills=20;S.revision++;
    if(!race){S.actionHeld=true;await actionGate;}return json(response());
   }
   assert.equal(req.method(),'GET','никаких leave/abandon/платных действий: '+p);return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['auto'],chain:true,taskOnly:false,zoneAuto:false,autoRoles:false,combatProfile:'fighter',autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,
    petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,storyTurnIn:false,
    searchChamp:true,searchQuest:true,champFa:true,champBlue:true,champOrange:false,champRed:false,champHpMult:1.5,champMinLvl:20,champEvery:50,deepEvery:50,priority:'[квест]\n[чемп]\n[все]',
    nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99},
   rt:{...rt,char:'AuditHero',lvl:21,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,kills:0,sp:0,exp:0,adena:0,sinceDeep:999,deepHot:false,
    zone:'plains_of_dion',target:null,via:null,hpMin:{},questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,
    storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn());await until(()=>h.g.p.evaluate(()=>window.fixtureReady));await until(()=>h.g.core('!!L2V7Modules.combat'));
  const before=await h.g.core('({name:L2V7Modules.combat.mobName(),victory:L2V7Modules.combat.victory(),due:mapDue(parseRules()),sinceDeep:rt.sinceDeep})');
  assert.equal(before.name,NAME,'служебный префикс Rebirth сохраняется частью имени');assert.equal(before.victory,race);assert.equal(before.due,true,'плановая проверка обычной карты действительно просрочена');
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  let raceCheckpoint=null,chatCheckpoint=null;
  if(race){
   await until(()=>S.held,20000);await h.g.p.locator('#battle-victory-hunt').click();
   await until(()=>h.g.p.evaluate(expected=>window.continues===1&&window.currentSpawn===expected,prefix+20),10000);
   raceCheckpoint=await h.g.core('({victory:L2V7Modules.combat.victory(),name:L2V7Modules.combat.mobName(),hp:L2V7Modules.combat.mobHp(),href:location.href})');
   assert.equal(raceCheckpoint.victory,false);assert.equal(raceCheckpoint.name,NAME);assert.equal(raceCheckpoint.hp.cur,2546);assert.equal(S.attacks,0);assert.deepEqual(S.starts,[20]);releaseRun();
  }else{
   // Фоновый запрос принадлежит текущей аренде и остаётся pending до принятого native21.
   // Победа пока удержана: paid-run helper ещё не мог решить продолжение без фонового запроса.
   await until(()=>S.actionHeld,15000);
   await h.g.p.evaluate(()=>{window.backgroundChat=fetch('/game/chat/replies/unread-count');window.backgroundChat.catch(()=>{});});
   await until(()=>S.chatHeld);
   await until(()=>h.g.core('[...NET_CONTEXT.values()].some(c=>c.path==="/game/chat/replies/unread-count"&&c.char===rt.char&&c.lease===leaseEpoch)'));
   releaseAction();
  }
  await until(()=>S.nextHeld,25000);assert.equal((await h.get(['on'])).on,true,'native продолжение принято до остановки стенда');assert.equal(S.attacks,1);assert.equal(S.entries,0);assert.equal(S.keys,18);assert.ok(S.runReads>=1);
  assert.deepEqual(S.starts,race?[20,21]:[21]);assert.deepEqual(S.nextReads,race?[19,20]:[20]);
  if(!race){
   chatCheckpoint=await h.g.core('({pending:[...NET_CONTEXT.values()].some(c=>c.path==="/game/chat/replies/unread-count"&&c.char===rt.char&&c.lease===leaseEpoch),on})');
   assert.deepEqual(chatCheckpoint,{pending:true,on:true},'реальный pending NET_CONTEXT фонового чата не блокирует native продолжение');assert.equal(S.chatReleased,false);
  }
  await h.click('stop');await until(async()=>!(await h.get(['on'])).on);releaseNext();
  await until(()=>h.g.p.evaluate(expected=>window.currentSpawn===expected&&document.getElementById('battle-mob-hp-val').textContent==='7128 / 7128',prefix+21),5000);
  const native=await h.g.p.evaluate(()=>({actors:window.huntActors,continues:window.continues,spawn:window.currentSpawn,title:document.getElementById('battle-mob-title').textContent}));
  assert.deepEqual(native.actors,race?['manual','bot']:['bot']);assert.equal(native.continues,race?2:1);assert.equal(native.spawn,prefix+21);
  assert.equal(await h.g.core('L2V7Modules.combat.mobName()'),NAME);assert.deepEqual(paths,['/battle.html?spawnId='+prefix+(race?19:20)]);
  assert.equal(calls.filter(x=>x.path==='/game/battle/leave'||x.path==='/game/battle/hunt-continue'||x.path==='/game/rebirth-raids/start').length,0);
  assert.equal(S.entries,0);assert.equal(S.keys,18);assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const state=await h.get(['cfg']);assert.deepEqual(state.cfg.autoTasks,['auto']);assert.equal(state.cfg.chain,true);assert.equal(state.cfg.deepEvery,50);
  proof.push({case:race?'Start victory + manual next while run GET pending':'Start existing active mob20 + native mob21 despite pending background chat',browser:h.ctx.browser().version(),before,raceCheckpoint,chatCheckpoint,native,paths,calls,
   result:{attacks:S.attacks,nativeStarts:S.starts,nextReads:S.nextReads,runReads:S.runReads,extraEntries:S.entries,keys:S.keys,chatPendingAtContinuation:chatCheckpoint?.pending??false},errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 paid Rebirth continuation',JSON.stringify({race,attacks:S.attacks,starts:S.starts,entries:S.entries,keys:S.keys}));
 }catch(e){console.error('DIAG rebirth-paid-run',JSON.stringify({race,S,paths,calls,routeErrors,pageErrors:h.errors,state:await h.get(['on','rt']).then(x=>({on:x.on,status:x.rt.status,target:x.rt.target,sinceDeep:x.rt.sinceDeep,errs:x.rt.errs})).catch(String)}));throw e;}
 finally{releaseRun();releaseNext();releaseAction();S.chatReleased=true;releaseChat();await h.ctx.close();}
}
(async()=>{try{for(const race of [false,true])await scenario(race)}finally{if(process.env.REBIRTH_PAID_RUN_PROOF)fs.writeFileSync(process.env.REBIRTH_PAID_RUN_PROOF,JSON.stringify({boundary:'actual Chrome MV3; already-paid own run seeded at18keys; local native battle handlers; no entry purchase or user script execution; only mobs phase',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
