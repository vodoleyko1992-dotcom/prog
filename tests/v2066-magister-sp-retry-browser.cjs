'use strict';
// 20.66: после перерождения SP появляется без нового уровня. Настоящий Chrome MV3/main/hook.
// Все HTTPS-ответы локальные; победа приходит от обработчика родной кнопки боя, rt не меняем во время работы.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const KEY='0:human_wizard',SPAWN='magister_sp_mob',proof=[];

async function scenario(){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const S={revision:100,level:20,sp:0,rank:1,won:false,inBattle:false,guilds:0,attacks:0,learns:0,returnHeld:false,returnReleased:false,learnHeld:false};
 let releaseReturn,releaseLearn;
 const returnGate=new Promise(r=>releaseReturn=r),learnGate=new Promise(r=>releaseLearn=r);
 const character=()=>({id:'magister-sp-hero',name:'AuditHero',level:S.level,rebirthStage:1,revision:S.revision,sp:S.sp,
  l2Profession:'human_wizard',profession:'Human Wizard',classBranch:'mystic',classSlots:{activeSlot:0,slots:[{slot:0,profession:'human_wizard',level:20}]},
  hp:1000,maxHp:1000,mp:1000,maxMp:1000,inBattle:S.inBattle,currentZoneId:'silent_valley',locationType:'zone',
  inventory:{stacks:[],eq:{}},learnedBattleSkillsDetail:[{battleId:'l2_1177',level:S.rank}]});
 const catalog=()=>{const cost=S.rank===1?240:600;return {npc:{npcId:30344},profession:{l2Profession:'human_wizard'},characterSp:S.sp,
  skills:[{battleId:'l2_1177',l2SkillId:1177,nameUk:'Wind Strike',minLevel:20,spCost:cost,skillLevel:S.rank,maxSkillLevel:5,kind:'active',
   canLearn:S.sp>=cost,learnedMax:false,canLearnBlockReasonUk:S.sp<cost?`Недостатньо SP (потрібно ${cost}, є ${S.sp}).`:''}]};};
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">20</div><div id="character-profession">Human Wizard</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">1000</span><span id="l2-hud-hp-max">1000</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span>';
 const map=()=>'<div id="map-list-mode-mobs" class="is-active"></div><ul id="map-mob-list" data-l2-around-sig="1|'+SPAWN+'|p0|lv20|q">'+(!S.won?`<li class="l2-map-mob-item l2-map-mob-item--battle"><a class="l2-map-mob-link" href="/battle.html?spawnId=${SPAWN}">Safe Mob · ур. 20<span class="l2-mob-card-meta">HP 1 000 · EXP 100</span></a></li>`:'')+'</ul><span id="map-mob-page-ind">1 / 1 (1)</span>';
 const html=p=>'<!doctype html><meta charset="utf-8"><title>Magister SP retry fixture</title>'+base+(p==='/map.html'?map():p==='/battle.html'
  ? `<div id="battle-mob-title">Safe Mob · ур.20</div><div id="battle-mob-hp-val">1000 / 1000</div><div id="battle-log"></div><button class="l2-battle-hotbar-slot" data-slot-idx="0" title="Атака" id="hit"><span data-slot-cd="attack">Атака</span></button><div id="battle-victory-inline" hidden><div id="battle-victory-lootline">100 EXP · 356 SP · 50 Adena</div><button id="battle-victory-hunt">Охотиться дальше</button></div><a id="battle-back-map" href="/map.html">На карту</a>`:'')+`<script>
  localStorage.setItem('token','local-magister-sp-fixture');
  const snapshotReady=(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));window.snapshot=(await(await fetch('/character')).json()).character;})();
  const hit=document.getElementById('hit');if(hit)hit.onclick=async()=>{await snapshotReady;const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'${SPAWN}',expectedRevision:window.snapshot.revision})});
   const d=await r.json();window.snapshot=d.character;window.nativeWin=d;document.getElementById('battle-mob-hp-val').textContent='0 / 1000';document.getElementById('battle-victory-inline').hidden=false;};
  const hunt=document.getElementById('battle-victory-hunt');if(hunt)hunt.onclick=()=>fetch('/game/battle/hunt-continue',{method:'POST'});
 </script>`;
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{try{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;let data=null;try{data=req.postDataJSON()}catch(_){}
   const call={path:p,method:req.method(),query:u.search,body:data,sp:S.sp,rank:S.rank,revision:S.revision};calls.push(call);
   const json=d=>route.fulfill({json:d}).catch(()=>{});
   if(p.endsWith('.html')){
    paths.push(p+u.search);
    if(p==='/magister.html')S.guilds++;
    if(p==='/map.html'&&S.guilds===1&&!S.returnReleased){S.returnHeld=true;await returnGate;}
    if(p==='/battle.html')S.inBattle=true;
    return route.fulfill({contentType:'text/html; charset=utf-8',body:html(p)}).catch(()=>{});
   }
   if(p==='/character')return json({character:character()});
   if(p==='/character/magister')return json(catalog());
   if(p==='/game/battle/action'){
    assert.equal(req.method(),'POST');assert.equal(data.action,'attack');assert.equal(data.expectedRevision,100);assert.equal(S.attacks,0);
    S.attacks++;S.won=true;S.inBattle=false;S.sp=356;S.revision++;
    return json({character:character(),victory:{fullLog:['Ты нанёс [Safe Mob] 1000 урона.','Перемога!'],rewards:{adena:50,exp:100,sp:356}}});
   }
   if(p==='/character/skills/learn'){
    assert.equal(req.method(),'POST');assert.equal(S.won,true,'SP получены настоящей победой до повторного похода');
    assert.equal(S.level,20,'повтор не ждёт нового уровня');assert.equal(S.guilds,2,'повторно открыт магистр');
    assert.deepEqual(data,{battleId:'l2_1177',expectedRevision:101});assert.equal(S.learns,0,'одна оплата одного ранга');
    const rt=(await h.get(['rt'])).rt,pending=rt.magPending?.[KEY];
    assert.ok(pending,'до платного запроса квитанция сохранена');assert.equal(pending.id,'l2_1177');assert.equal(pending.rank,1);assert.equal(pending.revision,101);
    call.pending={id:pending.id,rank:pending.rank,revision:pending.revision,sp:pending.sp,phase:pending.phase};
    S.learns++;S.rank++;S.sp-=240;S.revision++;S.learnHeld=true;await learnGate;
    return json({character:character()});
   }
   assert.equal(req.method(),'GET','неожиданный платный/боевой POST: '+p);
   return route.fallback();
  }catch(e){routeErrors.push(e.message);return route.fulfill({status:500,json:{error:'fixture_assertion',message:e.message}}).catch(()=>{})}});
  // 27.10 (#431): Wizard разрешает задачу petbuff независимо от autoRoles; стенд начинает с этого штатного набора.
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();await chrome.storage.local.set({on:false,
   cfg:{...cfg,autoTasks:['farm','petbuff'],autoMagister:true,magisterEvery:1,magisterSkip:'',magisterSpReserve:100,taskOnly:false,zoneAuto:false,
    combatProfile:'fighter',chain:true,autoRoles:false,autoShots:false,potSlotAuto:false,nAttack:'Атака',nPower:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nToggles:'',
    petAuto:false,petBuffAuto:false,petFullAuto:false,debuffAuto:false,shopAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,clanTasks:false,dailyAuto:false,
    rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,fishMode:false,campaign:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    searchChamp:false,searchQuest:false,champFa:false,champBlue:false,champOrange:false,champRed:false,reactMin:0,reactMax:0,deepEvery:0,mapEvery:0,rec:false,autoSnap:false,lvlMin:1,lvlMax:99},
   rt:{...rt,char:'AuditHero',lvl:20,prof:'human_wizard',classCur:{prof:'human_wizard',slot:0},magEnabled:true,magChecked:{},magPending:{},magister:null,magRetry:null,
    manualKickAt:0,kills:0,adena:0,exp:0,sp:0,zone:'silent_valley',via:'chain',shopT:now,weaponsT:now,invScan:null,target:null,rbGo:null,zoneGo:null,shop:null,tbuff:null,
    petBufferTrip:null,storyJob:null,mmJob:null,tsJob:null,actionOwner:null,skills:{},farmQuota:{},dailyQuota:null}});});
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof magisterStep==="function" && rt.char==="AuditHero"'));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(()=>S.returnHeld,25000);
  const initial=(await h.get(['on','rt']));
  assert.equal(initial.on,true);assert.equal(initial.rt.magChecked[KEY].lvl,20);assert.equal(S.sp,0);assert.equal(S.rank,1);assert.equal(S.learns,0);
  assert.equal(initial.rt.magChecked[KEY].spWait.balance,0);assert.equal(initial.rt.magChecked[KEY].spWait.skills[0].spCost,240);
  assert.equal(initial.rt.magPending?.[KEY],undefined);S.returnReleased=true;releaseReturn();
  await until(()=>S.learnHeld,30000);
  const pending=(await h.get(['on','rt']));assert.equal(pending.on,true);assert.equal(pending.rt.lvl,20);assert.equal(S.attacks,1);
  await delay(400);assert.equal(S.learns,1,'ожидание ответа не дублирует оплату');releaseLearn();
  await until(async()=>{const r=(await h.get(['rt'])).rt;return S.rank===2&&!r.magister&&!r.magPending?.[KEY]&&new URL(h.g.p.url()).pathname==='/map.html';},20000);
  await delay(500);
  const final=await h.get(['on','rt','cfg']);
  assert.equal(final.on,true,'нет Stop/Start между первой проверкой и повторным обучением');assert.equal(final.rt.lvl,20);assert.equal(final.rt.kills,1);
  assert.equal(S.learns,1);assert.equal(S.sp,116);assert.equal(S.rank,2);assert.equal(final.rt.magPending?.[KEY],undefined);assert.equal(final.rt.magister,null);
  assert.equal(final.cfg.magisterSpReserve,100);assert.deepEqual(final.cfg.autoTasks,['farm','petbuff']);
  assert.equal(calls.filter(x=>x.path==='/game/battle/hunt-continue').length,0,'обучение прерывает новую охоту сразу после победы');
  assert.deepEqual(calls.filter(x=>x.method==='POST').map(x=>x.path),['/game/battle/action','/character/skills/learn']);
  assert.ok(calls.some(x=>x.path==='/character'&&x.sp===356),'кошелёк SP подтверждён свежим character');
  assert.ok(calls.some(x=>x.path==='/character/magister'&&x.sp===356&&x.query==='?npcId=30344'),'перед оплатой прочитан свежий каталог учителя');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  proof.push({browser:h.ctx.browser().version(),initialChecked:initial.rt.magChecked[KEY],finalChecked:final.rt.magChecked[KEY],paths,calls,
   result:{level:S.level,kills:final.rt.kills,sp:S.sp,rank:S.rank,learns:S.learns,on:final.on,magister:final.rt.magister,pending:final.rt.magPending?.[KEY]??null},errors:[...routeErrors,...h.errors]});
  console.log('PASS actual MV3 SP0 → native win +356 SP at level20 → fresh guild retry → rank1→2, one payment, reserve100 retained');
 }catch(e){console.error('DIAG magister-sp-retry',JSON.stringify({S,paths,calls,routeErrors,state:await h.get(['on','rt']).then(x=>({on:x.on,status:x.rt.status,level:x.rt.lvl,sp:x.rt.sp,checked:x.rt.magChecked,job:x.rt.magister,pending:x.rt.magPending,retry:x.rt.magRetry})).catch(String)}));throw e;}
 finally{releaseReturn();releaseLearn();await h.ctx.close();}
}
(async()=>{try{await scenario()}finally{if(process.env.MAGISTER_SP_RETRY_PROOF)fs.writeFileSync(process.env.MAGISTER_SP_RETRY_PROOF,JSON.stringify({boundary:'actual Chrome MV3; local native battle win and fresh catalog; all HTTPS mocked; no live account',proof},null,2)+'\n')}})().catch(e=>{console.error(e.stack);process.exitCode=1});
