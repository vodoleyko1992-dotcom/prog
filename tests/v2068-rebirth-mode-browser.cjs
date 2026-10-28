'use strict';
// 27.10.2026: настоящий MV3/Start/main. Контракт mob300→champion→bossSlot3→rb_active→none из журнала03:20.
// Неизвестное имя фазы выбора помечено synthetic_gate_phase; выбор подтверждает видимый DOM16 ворот, без выдуманного enum.
// Победа возвращает battle:null, как в настоящем журнале: краткая метка теряет kind/lvl/max.
// 20.71: чемпион открывается после своей подготовки из каталога; native next после mob300 не нужен.
// Все HTTPS и родные обработчики локальные. Полный игровой клиент/живой аккаунт не используются.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',NEW='00000000-0000-4000-8000-000000000003',proof=[];
const clone=x=>JSON.parse(JSON.stringify(x));
async function scenario(which){
 const manual=which==='manual',lost=which==='lost-entry-reload',h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={revision:100,keys:100,phase:lost?'none':'mobs',runId:lost?null:RUN,mobKills:299,inBattle:false,spawn:null,won:false,
  starts:[],attacks:[],next:[],bossChoices:[],entries:0,entryHeld:false,pagers:[],continues:0,newRun:false};
 let releaseEntry;const entryGate=new Promise(resolve=>releaseEntry=resolve);
 const kindOf=spawn=>/_champion_/.test(spawn||'')?'champion':/_raid_3$/.test(spawn||'')?'boss':'mob';
 const target=(kind,run=RUN)=>'rebirth_raid_'+run+'_1_1_'+(kind==='boss'?'25098':'25041')+'_lv35_'+(kind==='boss'?'raid_3':kind==='champion'?'champion_1':'mob_300');
 const name=()=>kindOf(S.spawn)==='champion'?'Rebirth Champion · Wasp Worker':kindOf(S.spawn)==='boss'?"Rebirth Sejarr's Servitor":'Rebirth · Wyrm';
 const max=()=>kindOf(S.spawn)==='champion'?312480:kindOf(S.spawn)==='boss'?12276:11160;
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:35,rebirthStage:1,l2Profession:'human_wizard',classBranch:'mystic',race:'Human',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:35,owned:true,active:true}]},inBattle:S.inBattle,battleSpawnId:S.inBattle?S.spawn:null,
  hp:3317,maxHp:3317,mp:1648,maxMp:1648,sp:0,adena:'30000000',cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],activeSummon:null,vip:{active:false}});
 const activeRun=()=>S.runId?{id:S.runId,difficulty:1,phase:S.phase,mobKillTarget:300,mobKills:S.newRun?0:S.mobKills,verifiedVictoryIds:[],participantCharacterIds:[HERO],partyId:null,
  referenceBossSpawnId:'l2dop_rb_25041',referenceBossLevel:35,mobLevel:35,mobLevelOwnerCharacterId:HERO,
  ...(S.phase==='rb_active'?{selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25098'}:{})}:null;
 const instance=()=>({enabled:true,rebirthStage:1,activeRun:activeRun(),activeMobPage:S.newRun?1:20,totalMobPages:20,mobTargets:[]});
 const battle=()=>({spawnId:S.spawn,mobName:name(),mobLevel:35,mobHp:S.won?0:max(),mobMaxHp:max(),kind:'dungeon',championTier:'',ended:S.won,logSeq:S.won?3:1,
  log:['Бій розпочато: ['+name()+'] (ур.35).',...(S.won?['Перемога!']:[])]});
 const response=()=>({ok:true,revision:S.revision,character:character(),battle:S.won?null:battle(),...(S.won?{victory:{spawnId:S.spawn,mobName:name(),mobLevel:35,
  fullLog:['Бій розпочато: ['+name()+'] (ур.35).','Ты нанёс ['+name()+'] '+max()+' урона.','Перемога!','EXP +360'],expGain:'360',spGain:0,adenaGain:'0'}}:{})});
 const base=()=>`<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">35</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div>
  <span id="l2-hud-hp-cur">3317</span><span id="l2-hud-hp-max">3317</span><span id="l2-hud-mp-cur">1648</span><span id="l2-hud-mp-max">1648</span>
  <div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>`;
 const content=u=>{
  if(u.pathname==='/rebirth-raids.html')return `<h1>Подземелья Rebirth RB</h1>${S.runId?'<button class="l2-rraid-main-button" id="resume">Продолжить подземелье</button>':''}<div id="rebirth-raid-levels"><p>Ключи подземелья: ${S.keys} · вход оплачивает каждый участник</p>${['Easy','Medium','Hard'].map((x,i)=>`<section class="l2-rraid-difficulty"><h2>${i+1}. ${x}</h2><p>Стоимость входа: ${(i+1)*2} ключа</p><button id="entry-${i+1}" class="l2-rraid-difficulty__button" data-fixture-difficulty="${i+1}">Войти в подземелье</button></section>`).join('')}</div>`;
  if(u.pathname==='/rebirth-raid-dungeon.html'){
   if(S.newRun)return '<h1>Подземелье Rebirth RB</h1><div id="rebirth-instance-content">Подготовка списка мобов нового похода</div>';
   if(S.phase==='synthetic_gate_phase')return `<h1>Подземелье Rebirth RB</h1><div id="rebirth-instance-content"><p>Чемпион побеждён! Выбери одного из16 рейд-боссов</p>${Array.from({length:16},(_,i)=>`<article><h2>РБ${i+1}${i===3?' — одноручный посох':''}</h2><button ${i===3?'id="manual-staff"':''} class="l2-rraid-main-button l2-rraid-gate__enter" data-fixture-slot="${i}">Войти</button></article>`).join('')}</div>`;
   const page=+(u.searchParams.get('page')||1);return `<h1>Подземелье Rebirth RB</h1><div id="rebirth-instance-content"><p>Мобы · страница ${page} /20</p>${page===20||S.phase==='champion'?'<button class="l2-rraid-fight" id="fight">Бой</button>':'<button class="l2-rraid-pager-btn" data-fixture-page="20">20</button>'}</div>`;
  }
  if(u.pathname==='/rebirth-raid-lair.html')return '<h1>Логово Rebirth RB</h1><div id="rebirth-instance-content"><button class="l2-rraid-fight" id="fight">Бой</button></div>';
  if(u.pathname==='/battle.html')return `<section id="battle-mob-panel"><h2 id="battle-mob-title">${name()} · ур.35 · агрессивный</h2><div id="battle-mob-hp-val">${S.won?0:max()} /${max()}</div></section><div id="battle-log"></div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" ${S.won?'':'hidden'}><div id="battle-victory-lootline">360EXP</div><button id="battle-victory-hunt" class="l2-battle-victory-link">Охотиться дальше</button><button id="battle-victory-continue" class="l2-battle-victory-link l2-battle-victory-link--primary">К подземелью</button></div>`;
  throw Error('выход режима в обычную игру '+u.pathname);
 };
 const html=u=>`<!doctype html><meta charset="utf-8"><title>Rebirth mode fixture</title>${base()}${content(u)}<script>
  localStorage.setItem('token','local-rebirth-mode-only');window.currentSpawn=${JSON.stringify(S.spawn)};
  const post=(p,d)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json());
  const render=d=>{const b=d.battle||{spawnId:d.victory.spawnId,mobName:d.victory.mobName,mobHp:0,mobMaxHp:+document.getElementById('battle-mob-hp-val').textContent.split('/').pop()};window.snapshot=d.character;window.currentSpawn=b.spawnId;document.getElementById('battle-mob-title').textContent=b.mobName+' · ур.35 · агрессивный';document.getElementById('battle-mob-hp-val').textContent=b.mobHp+' /'+b.mobMaxHp;document.getElementById('battle-victory-inline').hidden=!d.victory;document.getElementById('battle-log').textContent=(d.victory?.fullLog||b.log).join(String.fromCharCode(10));};
  const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await(await fetch('/character')).json()).character;${u.pathname==='/battle.html'?`render(await(await fetch('/game/battle?characterId=${HERO}&spawnId='+encodeURIComponent(window.currentSpawn))).json());`:''}window.fixtureReady=true;})();
  const resume=document.getElementById('resume');if(resume)resume.onclick=()=>location.href='/rebirth-raid-dungeon.html';
  for(const p of document.querySelectorAll('.l2-rraid-pager-btn'))p.onclick=()=>location.href='/rebirth-raid-dungeon.html?page='+p.dataset.fixturePage;
  for(const b of document.querySelectorAll('.l2-rraid-difficulty__button'))b.onclick=async()=>{await ready;try{await post('/game/rebirth-raids/start',{difficulty:+b.dataset.fixtureDifficulty});location.href='/rebirth-raid-dungeon.html';}catch(e){window.lostEntryResponse=true;}};
  const fight=document.getElementById('fight');if(fight)fight.onclick=async()=>{await ready;const d=await post('/game/battle/start',{spawnId:${JSON.stringify(S.phase==='rb_active'?target('boss'):S.phase==='champion'?target('champion'):target('mob'))},expectedRevision:window.snapshot.revision});location.href='/battle.html?spawnId='+encodeURIComponent(d.battle.spawnId);};
  for(const b of document.querySelectorAll('.l2-rraid-gate__enter'))b.onclick=async()=>{await ready;await post('/game/rebirth-raids/enter-boss',{bossSlot:+b.dataset.fixtureSlot});location.href='/rebirth-raid-lair.html';};
  const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await ready;render(await post('/game/battle/action',{action:'attack',battleSpawnId:window.currentSpawn,expectedRevision:window.snapshot.revision}));};
  const hunt=document.getElementById('battle-victory-hunt');if(hunt)hunt.onclick=async()=>{await ready;const n=await(await fetch('/game/rebirth-raids/next?after='+encodeURIComponent(window.currentSpawn))).json();if(n.phase==='none'){location.href='/rebirth-raids.html';return;}render(await post('/game/battle/start',{spawnId:n.spawnId,expectedRevision:window.snapshot.revision}));history.replaceState(null,'','/battle.html?spawnId='+encodeURIComponent(window.currentSpawn));};
  const back=document.getElementById('battle-victory-continue');if(back)back.onclick=()=>location.href='/rebirth-raid-dungeon.html';
 </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   calls.push({path:p,query:u.search,method:req.method(),body:data,phase:S.phase,keys:S.keys});const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);if(u.searchParams.has('page'))S.pagers.push(+u.searchParams.get('page'));return route.fulfill({contentType:'text/html; charset=utf-8',body:html(u)}).catch(()=>{});}
   if(p==='/character')return json({character:character()});
   if(p==='/game/rebirth-raids'){assert.equal(req.method(),'GET');assert.equal(u.searchParams.get('view'),'instance');return json(instance());}
   if(p==='/game/rebirth-raids/start'){
    assert.equal(S.runId,null,'существующий поход нельзя заменить платным новым');assert.equal(data.difficulty,1);assert.equal(S.entries,0,'ровно один новый вход');
    S.entries++;S.keys-=2;S.runId=NEW;S.phase='mobs';S.mobKills=0;S.newRun=true;S.revision++;
    if(lost){S.entryHeld=true;await entryGate;return route.abort('failed').catch(()=>{});}
    return json({run:activeRun(),nextSpawnId:'rebirth_raid_'+NEW+'_1_1_25041_lv35_mob_1'});
   }
   if(p==='/game/rebirth-raids/enter-boss'){
    assert.equal(S.phase,'synthetic_gate_phase');assert.equal(S.runId,RUN);assert.equal(S.mobKills,300);assert.deepEqual(data,{bossSlot:3});
    S.bossChoices.push(data.bossSlot);assert.equal(S.bossChoices.length,1,'выбор РБ не повторяется');S.phase='rb_active';
    return json({run:activeRun()});
   }
   if(p==='/game/battle/start'){
    assert.equal(S.inBattle,false);assert.equal(data.expectedRevision,S.revision);assert.ok([target('mob'),target('champion'),target('boss')].includes(data.spawnId));
    assert.ok(!S.starts.includes(data.spawnId),'нативный бой не открывается дважды');S.starts.push(data.spawnId);S.spawn=data.spawnId;S.inBattle=true;S.won=false;S.revision++;
    return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal(S.inBattle,true);assert.equal(data.battleSpawnId,S.spawn);assert.equal(data.action,'attack');assert.equal(data.expectedRevision,S.revision);
    const k=kindOf(S.spawn);S.attacks.push(k);S.inBattle=false;S.won=true;S.revision++;
    if(k==='mob'){S.mobKills=300;S.phase='champion';}else if(k==='champion')S.phase='synthetic_gate_phase';else{S.phase='none';S.runId=null;}
    return json(response());
   }
   if(p==='/game/battle'){
    assert.equal(u.searchParams.get('characterId'),HERO);assert.equal(u.searchParams.get('spawnId'),S.spawn);return json(response());
   }
   if(p==='/game/rebirth-raids/next'){
    assert.equal(S.won,true);assert.equal(u.searchParams.get('after'),S.spawn);const k=kindOf(S.spawn);S.next.push(k);
    if(k==='mob')return json({phase:'champion',spawnId:target('champion')});
    assert.equal(k,'boss','после чемпиона используется «К подземелью», неизвестный next-контракт не выдуман');S.bossVictoryMeta=await h.g.core('({spawn:BATTLE_NET?.spawn,kind:BATTLE_NET?.kind,victory:victory()})');assert.deepEqual(S.bossVictoryMeta,{spawn:S.spawn,kind:'',victory:true},'реальная победа battle:null стирает kind, точная победа и spawn сохраняются');return json({phase:'none',spawnId:null});
   }
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   assert.equal(req.method(),'GET','неожиданный POST '+p);return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  await h.sw.evaluate(async({manual,lost})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['rebirth','petbuff'],rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:!manual,rebirthKeyReserve:0,rebirthBossChoice:manual?'manual':'staff1h',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:true,petFullAuto:true,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',
    nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,deepEvery:0,mapEvery:0,dailyKillLimit:0},
   rt:{...rt,char:'AuditHero',lvl:35,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,rebirth:{},kills:0,sp:0,exp:0,adena:0,
    storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},
    shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});},{manual,lost});
  await h.g.p.goto('https://l2wap.com/rebirth-raids.html');await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));await until(()=>h.g.p.evaluate(()=>window.fixtureReady));
  const browserIdentity=await h.g.core('(async()=>{await TAB_KEY_READY;return{key:BROWSER_TAB_KEY,id:await chrome.runtime.sendMessage({cmd:"tabId"})};})()');assert.ok(Number.isInteger(browserIdentity.id)&&browserIdentity.id>=0);assert.equal(browserIdentity.key,'tab'+browserIdentity.id,'идентичность подтверждена настоящим background tabId');
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  if(lost){
   await until(()=>S.entryHeld,30000);await until(async()=>(await h.get(['rt'])).rt.rebirth?.pending?.phase==='sent');
   assert.equal(S.entries,1);assert.equal(S.keys,98);await h.g.p.reload();await until(()=>h.g.core('on&&running&&tabOwner&&!!L2V7Modules.rebirth'));
   await until(async()=>(await h.get(['rt'])).rt.rebirth?.lastEntry?.runId===NEW,20000);
   await h.click('stop');await until(()=>h.g.core('!on&&!running'));releaseEntry();
   const st=(await h.get(['rt'])).rt.rebirth;assert.equal(S.entries,1);assert.equal(S.keys,98);assert.equal(st.pending,null);assert.equal(st.lastEntry.confirmation,'fresh-own-run');
  }else{
   if(manual){
    await until(()=>S.phase==='synthetic_gate_phase'&&h.g.p.url().includes('/rebirth-raid-dungeon.html'),40000);
    await until(()=>h.g.p.locator('.l2-rraid-gate__enter').count().then(n=>n===16));await delay(1200);
    assert.equal(S.bossChoices.length,0,'ручной выбор РБ не подменяется автоматикой');assert.equal(S.entries,0);assert.equal(S.keys,100);
    await h.g.p.locator('#manual-staff').click();
    await until(()=>S.phase==='none'&&h.g.p.url().includes('/rebirth-raids.html'),30000);await until(()=>h.g.core('rt.rebirth?.phase==="manual-entry"'));
    await delay(1200);assert.equal(S.entries,0,'ручной новый вход не включается автоматически');assert.equal(S.keys,100);await h.g.p.locator('#entry-1').click();
   }
   await until(()=>S.entries===1,50000);await until(async()=>{const r=(await h.get(['rt'])).rt.rebirth;return r?.runId===NEW&&(manual||r?.lastEntry?.runId===NEW)&&!r.pending;},20000);
   await h.click('stop');await until(()=>h.g.core('!on&&!running'));
   assert.deepEqual(S.attacks,['mob','champion','boss']);assert.equal(S.starts.length,3);assert.deepEqual(S.next,['boss']);assert.deepEqual(S.bossChoices,[3]);assert.deepEqual(S.pagers,[20]);
   assert.equal(S.entries,1);assert.equal(S.keys,98);assert.ok(paths.includes('/rebirth-raid-lair.html'));assert.equal(paths.some(x=>/^\/map|^\/city|^\/teleport/.test(x)),false,'режим не уходит в обычный фарм/город');
  }
  const finalBrowserIdentity=await h.g.core('(async()=>({key:BROWSER_TAB_KEY,id:await chrome.runtime.sendMessage({cmd:"tabId"})}))()');assert.deepEqual(finalBrowserIdentity,browserIdentity,'браузерный tabId сохраняется при навигации и reload');
  const saved=await h.get(['cfg','rt']);assert.deepEqual(saved.cfg.autoTasks,['rebirth','petbuff']);assert.equal(saved.cfg.rebirthAutoEnter,!manual);assert.equal(saved.cfg.rebirthBossChoice,manual?'manual':'staff1h');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  proof.push({case:which,browser:h.ctx.browser().version(),browserIdentity,finalBrowserIdentity,paths,calls,result:clone(S),runtime:saved.rt.rebirth,errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 Rebirth mode',JSON.stringify({case:which,starts:S.starts.length,attacks:S.attacks,bossChoices:S.bossChoices,entries:S.entries,keys:S.keys,paths}));
 }catch(e){console.error('DIAG rebirth-mode',JSON.stringify({case:which,S,paths,calls,routeErrors,errors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,mode:autonomyMode(),rebirth:rt.rebirth,owner:rt.actionOwner,cfg:[cfg.rebirthMode,cfg.chain]})').catch(String)}));throw e;}
 finally{releaseEntry();await h.ctx.close();}
}
(async()=>{try{for(const c of ['auto-full-cycle','manual','lost-entry-reload'].filter(c=>!process.env.REBIRTH_MODE_CASE||c===process.env.REBIRTH_MODE_CASE))await scenario(c)}finally{if(process.env.REBIRTH_MODE_PROOF)fs.writeFileSync(process.env.REBIRTH_MODE_PROOF,JSON.stringify({boundary:'actual Chrome MV3/main with local native handlers; mob299 seeded to test final mob300, champion, observed staff boss3, completion and one2key entry; gate phase enum synthetic because upload omits it; new-run mob buttons withheld during first DOM render so entry receipt can be measured before further fighting; no live game or user scripts',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
