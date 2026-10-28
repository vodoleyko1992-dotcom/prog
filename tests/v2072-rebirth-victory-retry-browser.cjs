'use strict';
// Лог28.10 03:12: победа → временный HTTP-сбой → метка старше60с / новый документ → продолжение оплаченного похода.
// Настоящие MV3/Start/main/hook; все ответы HTTPS локальные. Сдвиг Date.now только в isolated world — вместо минуты ожидания.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HERO='00000000-0000-4000-8000-000000000002',RUN='00000000-0000-4000-8000-000000000001',NAME='Rebirth · Wyrm',MAX=11160,proof=[];
const spawn=n=>'rebirth_raid_'+RUN+'_1_1_25041_lv35_mob_'+n;
async function scenario(which){
 const h=await harness(),calls=[],paths=[],errors=[];
 const S={revision:100,keys:100,kills:0,inBattle:false,spawn:null,won:false,starts:[],actions:[],next:0,entries:0,failed:false,recoveryHeld:false,recoveryReads:0,holdUsed:false};
 let release;const gate=new Promise(r=>release=r);
 const character=()=>({id:HERO,name:'AuditHero',revision:S.revision,level:35,rebirthStage:1,l2Profession:'human_wizard',classBranch:'mystic',race:'Human',
  classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:35,owned:true,active:true}]},inBattle:S.inBattle,battleSpawnId:S.inBattle?S.spawn:null,
  hp:3317,maxHp:3317,mp:1648,maxMp:1648,sp:0,adena:'30000000',cityId:'l2dop_oren',currentZoneId:'plains_of_the_lizardman',locationType:'zone',worldX:1,worldY:1,
  activeDungeonId:null,inventory:{stacks:[],eq:{}},activeBuffs:[],activeSummon:null,vip:{active:false}});
 const run=()=>({id:RUN,difficulty:1,phase:'mobs',mobKillTarget:300,mobKills:S.kills,verifiedVictoryIds:[],participantCharacterIds:[HERO],partyId:null,
  referenceBossSpawnId:'l2dop_rb_25041',referenceBossLevel:35,mobLevel:35,mobLevelOwnerCharacterId:HERO});
 const battle=()=>({spawnId:S.spawn,mobName:NAME,mobLevel:35,mobHp:S.won?0:MAX,mobMaxHp:MAX,kind:'dungeon',championTier:'',ended:S.won,logSeq:S.won?3:1,
  log:['Бій розпочато: ['+NAME+'] (ур.35).',...(S.won?['Перемога!']:[])]});
 const response=()=>({ok:true,revision:S.revision,character:character(),battle:S.won?null:battle(),...(S.won?{victory:{spawnId:S.spawn,mobName:NAME,mobLevel:35,
  fullLog:['Бій розпочато: ['+NAME+'] (ур.35).','Ты нанёс ['+NAME+'] '+MAX+' урона.','Перемога!','EXP +360'],expGain:'360',spGain:0,adenaGain:'0'}}:{})});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">35</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">3317</span><span id="l2-hud-hp-max">3317</span><span id="l2-hud-mp-cur">1648</span><span id="l2-hud-mp-max">1648</span><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>';
 const html=u=>{
  const p=u.pathname,next=spawn(S.kills+1);
  let content;
  if(p==='/rebirth-raids.html')content='<h1>Подземелья Rebirth RB</h1><button class="l2-rraid-main-button" id="resume">Продолжить подземелье</button><div id="rebirth-raid-levels">Ключи подземелья:100</div>';
  else if(p==='/rebirth-raid-dungeon.html')content='<h1>Подземелье Rebirth RB</h1><div id="rebirth-instance-content"><p>Мобы · страница1/20</p><button class="l2-rraid-fight" id="fight">Бой</button></div>';
  else if(p==='/battle.html')content=`<section id="battle-mob-panel"><h2 id="battle-mob-title">${NAME} · ур.35 · агрессивный</h2><div id="battle-mob-hp-val">${S.won?0:MAX}/${MAX}</div></section><div id="battle-log"></div><button id="hit" class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" ${S.won?'':'hidden'}><div id="battle-victory-lootline">360EXP</div><button id="battle-victory-hunt" class="l2-battle-victory-link">Охотиться дальше</button><button id="battle-victory-continue" class="l2-battle-victory-link l2-battle-victory-link--primary">К подземелью</button></div>`;
  else throw Error('поход покинут: '+p);
  return `<!doctype html><meta charset="utf-8"><title>Rebirth victory retry fixture</title>${base}${content}<script>
   localStorage.setItem('token','local-rebirth-retry-fixture');window.currentSpawn=${JSON.stringify(S.spawn)};
   const post=(p,d)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json','X-fixture-native':'1'},body:JSON.stringify(d)}).then(r=>r.json());
   const get=p=>fetch(p,{headers:{'X-fixture-native':'1'}}).then(r=>r.json());
   const render=d=>{const b=d.battle||{spawnId:d.victory.spawnId,mobName:d.victory.mobName,mobHp:0,mobMaxHp:${MAX}};window.snapshot=d.character;window.currentSpawn=b.spawnId;document.getElementById('battle-mob-title').textContent=b.mobName+' · ур.35 · агрессивный';document.getElementById('battle-mob-hp-val').textContent=b.mobHp+'/'+b.mobMaxHp;document.getElementById('battle-victory-inline').hidden=!d.victory;document.getElementById('battle-log').textContent=(d.victory?.fullLog||b.log).join(String.fromCharCode(10));};
   const ready=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await get('/character')).character;${p==='/battle.html'&&!S.won?`render(await get('/game/battle?characterId=${HERO}&spawnId='+encodeURIComponent(window.currentSpawn)));`:''}window.fixtureReady=true;})();
   const resume=document.getElementById('resume');if(resume)resume.onclick=()=>location.href='/rebirth-raid-dungeon.html';
   const fight=document.getElementById('fight');if(fight)fight.onclick=async()=>{await ready;const d=await post('/game/battle/start',{spawnId:${JSON.stringify(next)},expectedRevision:window.snapshot.revision});location.href='/battle.html?spawnId='+encodeURIComponent(d.battle.spawnId);};
   const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await ready;render(await post('/game/battle/action',{action:'attack',battleSpawnId:window.currentSpawn,expectedRevision:window.snapshot.revision}));};
   const hunt=document.getElementById('battle-victory-hunt');if(hunt)hunt.onclick=async()=>{await ready;await get('/game/rebirth-raids/next?after='+encodeURIComponent(window.currentSpawn));};
   const back=document.getElementById('battle-victory-continue');if(back)back.onclick=()=>location.href='/rebirth-raid-dungeon.html';
  </script>`;
 };
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let body=null;try{body=req.postDataJSON()}catch(_){}
   const native=req.headers()['x-fixture-native']==='1';calls.push({path:p,method:req.method(),query:u.search,native,body});
   const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){paths.push(p+u.search);return route.fulfill({contentType:'text/html; charset=utf-8',body:html(u)}).catch(()=>{});}
   if(p==='/character'){
    if(!native&&S.won){
     if(!S.failed){S.failed=true;return route.fulfill({status:503,json:{error:'temporary_fixture_failure'}}).catch(()=>{});}
     S.recoveryReads++;
     if((which==='stop-held'||which==='missing-reload')&&!S.holdUsed){S.holdUsed=true;S.recoveryHeld=true;await gate;}
    }
    return json({character:character()});
   }
   if(p==='/game/rebirth-raids'){assert.equal(req.method(),'GET');assert.equal(u.searchParams.get('view'),'instance');return json({enabled:true,rebirthStage:1,activeRun:run(),activeMobPage:1,totalMobPages:20,mobTargets:[]});}
   if(p==='/game/battle/start'){
    assert.equal(S.inBattle,false);assert.equal(body.expectedRevision,S.revision);assert.equal(body.spawnId,spawn(S.kills+1));assert.ok(!S.starts.includes(body.spawnId),'одно открытие каждой цели');
    assert.ok(S.starts.length<2,'никакого спина после восстановления');S.starts.push(body.spawnId);S.spawn=body.spawnId;S.inBattle=true;S.won=false;S.revision++;
    return json(response());
   }
   if(p==='/game/battle/action'){
    assert.equal(S.inBattle,true);assert.equal(body.battleSpawnId,S.spawn);assert.equal(body.expectedRevision,S.revision);assert.equal(body.action,'attack');
    S.actions.push(S.spawn);
    if(S.spawn===spawn(2)){await gate;return json(response());}
    S.inBattle=false;S.won=true;S.kills++;S.revision++;return json(response());
   }
   if(p==='/game/battle'){assert.equal(u.searchParams.get('characterId'),HERO);assert.equal(u.searchParams.get('spawnId'),S.spawn);return json(response());}
   if(p==='/game/rebirth-raids/next'){S.next++;throw Error('устаревшая победа не должна повторять native next');}
   if(p==='/game/rebirth-raids/start'){S.entries++;throw Error('оплаченный поход не требует нового входа');}
   if(p.startsWith('/game/story-quests/'))return json({quest:{completed:true,stage:'completed',chapter:10}});
   assert.equal(req.method(),'GET','неожиданный POST '+p);return route.fallback();
  }catch(e){errors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['rebirth'],rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:true,rebirthKeyReserve:0,rebirthBossChoice:'manual',chain:true,taskOnly:false,
    zoneAuto:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,autoLearn:false,weaponScanAuto:false,weaponClassEquip:false,shopAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmFarmGuide:false,storyTurnIn:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,campAuto:false,searchChamp:false,searchQuest:false,champFa:false,priority:'[все]',nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',autoShots:false,potSlotAuto:false,debuffAuto:false,rec:false,autoSnap:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,dailyKillLimit:0},
   rt:{...rt,char:'AuditHero',lvl:35,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},manualKickAt:0,zone:'plains_of_the_lizardman',hpMin:{},target:null,via:null,rebirth:{},kills:0,sp:0,exp:0,adena:0,
    storySaga:{completed:true,stage:'completed'},dionCampaign:{completed:true,stage:'completed',chapter:10},campaign:null,campaignUrl:'',campaignDue:false,questTargets:[],questSeen:{},shopT:now,weaponsT:now,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,zoneGo:null,petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});});
  await h.g.p.goto('https://l2wap.com/rebirth-raids.html');await until(()=>h.g.core('!!L2V7Modules.rebirth&&rt.char==="AuditHero"'));await until(()=>h.g.p.evaluate(()=>window.fixtureReady));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(()=>S.failed,20000);await until(()=>h.g.core('String(rt.status||"").includes("подтверждён сервером")||String(rt.status||"").includes("повторной серверной")'),10000);
  assert.equal(S.actions.length,1);assert.equal(S.starts.length,1);assert.equal(S.next,0);assert.equal(S.entries,0);
  const before=await h.g.core('({meta:BATTLE_NET,run:rt.rebirth,win:victory()})');assert.equal(before.win,true);assert.equal(before.run.battleSpawn,spawn(1));
  if(which==='missing-reload'){
   await h.g.p.reload();await until(()=>S.recoveryHeld,15000);
   const after=await h.g.core('({meta:BATTLE_NET,win:victory()})');assert.equal(after.meta,null,'новый документ не получил native battle GET/metadata');assert.equal(after.win,true);release();
  }else{
   await h.g.core('window.__retryRealNow=Date.now.bind(Date);Date.now=()=>window.__retryRealNow()+61000;true');
   if(which==='stop-held'){
    await until(()=>S.recoveryHeld,10000);assert.equal(S.starts.length,1);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(500);
    assert.equal(S.starts.length,1);assert.equal(paths.filter(p=>p==='/rebirth-raids.html').length,1,'Stop до завершения GET запрещает возврат');
   }
  }
  if(which!=='stop-held'){
   await until(()=>S.starts.length===2,15000);await h.popup.locator('#stop').click({force:true});await until(async()=>!(await h.get(['on'])).on);release();await delay(300);
   assert.deepEqual(S.starts,[spawn(1),spawn(2)]);assert.ok(paths.filter(p=>p==='/rebirth-raids.html').length>=2,'возврат в свой каталог');assert.ok(S.recoveryReads>0);
  }
  assert.equal(S.next,0,'повтор native next не нужен');assert.equal(S.entries,0,'никакой оплаты входа');assert.equal(S.keys,100);assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);
  const saved=await h.get(['rt']);assert.ok(!saved.rt.selfHold,'не требуется20минутная передышка');
  proof.push({case:which,browser:h.ctx.browser().version(),before,paths,calls,result:{starts:S.starts,next:S.next,entries:S.entries,keys:S.keys,recoveryReads:S.recoveryReads},errors:[...errors,...h.errors]});
  console.log('PASS actual MV3 Rebirth victory retry',JSON.stringify({case:which,starts:S.starts.length,next:S.next,entries:S.entries,recoveryReads:S.recoveryReads}));
 }catch(e){console.error('DIAG rebirth-victory-retry',JSON.stringify({which,S,paths,errors,pageErrors:h.errors,state:await h.g.core('({on,running,tabOwner,status:rt.status,rebirth:rt.rebirth,metadata:BATTLE_NET})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{try{for(const c of ['aged-after-http','missing-reload','stop-held'].filter(c=>!process.env.REBIRTH_RETRY_CASE||c===process.env.REBIRTH_RETRY_CASE))await scenario(c);}finally{if(process.env.REBIRTH_RETRY_PROOF)fs.writeFileSync(process.env.REBIRTH_RETRY_PROOF,JSON.stringify({boundary:'Actual Chrome MV3/main/hook; local reconstructed native handlers, failed internal characterGET and isolated-world clock+61s, missing metadata on reload, Stop after held GET; no live game or paid entry',proof},null,2)+'\n');}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
