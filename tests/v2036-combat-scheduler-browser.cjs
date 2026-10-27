'use strict';
// 20.36: настоящий MV3/main/hook. Каждый HTTPS-запрос получает локальный ответ стенда;
// аккаунт, авторизация и живой сервер не используются.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');

const REACT_MS=2200;
const cases=[
 {name:'server GCD',gcd:520,get:120},
 {name:'native GET',gcd:120,get:700},
 {name:'MP changed during wait',gcd:450,get:200,power:true,lowMp:true},
 {name:'global refusal',gcd:380,get:100,refused:true},
 // 20.54 (прогон 23.10): нажатие Stop в фоновом popup идёт 0,8–1,5 с — при родном GET 700 мс Stop
 // приходил уже после его конца, и тест проверял не то. Окно GET длиннее; ниже — проверка, что Stop успел внутри.
 {name:'Stop during native GET',gcd:120,get:2500,stop:true},
];

async function scenario(test){
 const h=await harness(),acts=[];
 let mp=500,ended=false,firstAnswer=false,nativeStarted=false,nativeEnded=false,nativeStartedAt=0;
 const character=()=>({name:'AuditHero',level:48,l2Profession:'human_warlord',classBranch:'fighter',classSlots:{activeSlot:0},revision:100+acts.length,hp:6195,maxHp:6195,mp,maxMp:874,inBattle:!ended});
 const battle=()=>({spawnId:'fixture',mobName:'Garden Guard',mobHp:ended?0:2484,mobMaxHp:2484,mobLevel:48,kind:'normal',log:ended?['Победа!']:[]});
 try{
  await h.sw.evaluate(async ({react,power})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({on:false,cfg:{...cfg,warlordAggro:false,autoMagister:false,taskOnly:false,zoneAuto:false,catMode:false,chain:false,searchChamp:false,searchQuest:false,champFa:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:power?'Вихор':'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,reactMin:react,reactMax:react,rbMode:false,rbTour:false,epicMode:false,fishMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false},rt:{...rt,char:'AuditHero',lvl:48,prof:'human_warlord',classCur:{prof:'human_warlord',slot:0},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{'вихор':{dmg:900,dmgN:3}},skillDb:{'вихор':{mp:49,mpKnown:true}},cdUntil:{},cdUse:{},clickLockA:120,clickLockB:50,weaponMetaPending:null,weaponNow:'Orcish Poleaxe',weapons:[{id:297,name:'Orcish Poleaxe',wt:'древковое',g:'C',where:'надето'}],weaponsT:Date.now(),shopT:Date.now()}});
  },{react:REACT_MS,power:!!test.power});
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const u=new URL(route.request().url()),path=u.pathname;
   const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
   if(path==='/character'){
    if(u.searchParams.has('afterTurn')){
     nativeStarted=true;
     nativeStartedAt=Date.now();
     await delay(test.get);
     if(test.lowMp)mp=0;
     nativeEnded=true;
    }
    return json({character:character()});
   }
   if(path==='/game/battle')return json({character:character(),battle:battle()});
   if(path==='/game/battle/action'){
    const q=route.request().postDataJSON();
    acts.push({action:q.action,at:Date.now(),afterNative:nativeEnded});
    if(acts.length===1){
     // Ответ с задержкой проверяет асинхронное пробуждение по квитанции.
     await delay(120);
     const now=Date.now();firstAnswer=true;
     return json({kind:'full',character:character(),battle:battle(),serverNowMs:now,globalCooldownUntilMs:now+test.gcd,...(test.refused?{ok:false,error:'global_cooldown',code:'global_cooldown',blockedBy:'global'}:{ok:true})},test.refused?409:200);
    }
    ended=true;
    return json({kind:'full',ok:true,character:character(),battle:battle(),victory:{spawnId:'fixture',mobName:'Garden Guard'}});
   }
   if(path==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">48</div><div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">6195</span><span id="l2-hud-hp-max">6195</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">874</span><div id="battle-mob-title">Garden Guard · ур.48</div><div id="battle-mob-hp-val">2484 / 2484</div><button class="l2-battle-hotbar-slot" title="Вихор" id="power"><span data-slot-cd="whirlwind" hidden></span></button><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>
    window.fixtureTrace=[];fetch('/character');fetch('/game/battle');
    for(const [id,action]of [['power','whirlwind'],['attack','attack']])document.getElementById(id).onclick=async()=>{
     const turn={action,click:Date.now()};window.fixtureTrace.push(turn);
     const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,battleSpawnId:'fixture'})});
     const d=await r.json();turn.answer=Date.now();
     document.getElementById('l2-hud-mp-cur').textContent=d.character.mp;
     document.getElementById('battle-log').textContent=d.battle.log.join(' ');
     if(d.victory){document.getElementById('battle-mob-hp-val').textContent='0 / 2484';document.getElementById('battle-victory-inline').hidden=false;return;}
     // Родной запрос игры после хода проходит через настоящий внедрённый hook.
     turn.getStart=Date.now();const c=await(await fetch('/character?afterTurn=1')).json();
     turn.getEnd=Date.now();document.getElementById('l2-hud-mp-cur').textContent=c.character.mp;
    };
   </script>`});
   return json({});
  });
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');
  await until(()=>h.g.core('rt.char==="AuditHero"'));
  await h.g.p.evaluate(()=>fetch('/game/battle'));
  await until(()=>h.g.core('BATTLE_NET?.name==="Garden Guard"'));
  await h.g.p.bringToFront();
  // Длинный интервал опроса: ожидание isolated world завершает уведомление
  // настоящего hook раньше резервного таймера.
  const receiptWait=h.g.core(`(async()=>{const start=Date.now();const value=await combatWait(()=>{const r=[...battleReceipts.values()][0];return r?{...r,at:Date.now(),globalReadyAt:Date.now()+combatCooldown.globalWait(),ownerNow:observeOwner()}:null;},10000,9000);return {value,elapsed:Date.now()-start};})()`);
  if(test.stop)await h.popup.evaluate(()=>{window.schedulerStopClickAt=0;document.getElementById('stop').addEventListener('click',()=>{window.schedulerStopClickAt=Date.now();},{capture:true,once:true});});
  await h.click('start');
  const observed=await receiptWait;
  assert.ok(observed.value, 'native action generated a receipt');
  assert.ok(observed.elapsed<8500, 'receipt woke before the 9 s fallback poll');
  const receipt=observed.value;
  assert.equal(receipt.action,test.power?'whirlwind':'attack');
  assert.equal(receipt.owner,receipt.ownerNow,'receipt belongs to the active actor and lease');
  assert.equal(receipt.ok,!test.refused,'refusal must not be an accepted ACK');
  assert.ok(receipt.rid!=null,'receipt is tied to an actual hook request id');
  if(test.stop){
   await until(()=>nativeStarted&&h.g.core('gameBusy().busy'));
   // 20.69: popup уже загружен, но фоновые RAF задерживали actionability-wait Playwright почти на2с.
   // Настоящий клик без ожидания стабильности должен попасть до штатного1500мс выхода gameFree, а не после следующего хода.
   await h.popup.locator('#stop').click({force:true});
   const stopClickAt=await h.popup.evaluate(()=>window.schedulerStopClickAt);
   assert.ok(stopClickAt>=nativeStartedAt&&stopClickAt-nativeStartedAt<1500,'fixture Stop click precedes the native-wait timeout');
   assert.equal(acts.length,1,'fixture Stop click preceded the next turn');
   await until(()=>h.g.core('!on && !running'));
   assert.equal(nativeEnded,false,'Stop reached the bot while the native GET was still pending');
   await delay(test.get+300);
   assert.deepEqual(acts.map(x=>x.action),['attack'],'Stop cancels the waiting next turn');
   assert.equal(ended,false);
   console.log('PASS actual MV3 scheduler:',test.name,'(one POST, no follow-up action)',JSON.stringify({stopClickAfterNativeStartMs:stopClickAt-nativeStartedAt}));
  }else{
   await until(()=>ended,12000);
   const trace=await h.g.p.evaluate(()=>window.fixtureTrace);
   assert.equal(trace.length,2,'exactly one next turn is dispatched');
   assert.deepEqual(acts.map(x=>x.action),test.power?['whirlwind','attack']:['attack','attack']);
   assert.ok(firstAnswer&&nativeStarted&&nativeEnded);
   assert.equal(acts[1].afterNative,true,'next action must not overtake native GET');
   assert.ok(trace[1].click>=receipt.globalReadyAt-5,'next action respects the server GCD plus its safety margin');
   assert.ok(trace[1].click>=trace[0].getEnd+25,'next action preserves the native GET safety margin');
   const afterAnswer=trace[1].click-trace[0].answer;
   assert.ok(afterAnswer<REACT_MS-400,`no redundant ${REACT_MS} ms reaction pause after the response: ${afterAnswer} ms`);
   await h.click('stop');
   console.log('PASS actual MV3 scheduler:',test.name,JSON.stringify({actions:acts.map(x=>x.action),responseToNextMs:afterAnswer,afterGcdMs:trace[1].click-receipt.globalReadyAt,afterNativeGetMs:trace[1].click-trace[0].getEnd,receiptOk:receipt.ok}));
  }
  assert.deepEqual(h.errors,[]);
 }catch(e){
  console.error('DIAG',test.name,acts,await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,net:ACT_NET,busy:gameBusy(),cd:combatCooldown.snapshot(),receipts:[...battleReceipts.values()]})').catch(()=>''),await h.g.p.evaluate(()=>window.fixtureTrace).catch(()=>null));
  throw e;
 }finally{await h.ctx.close();}
}
(async()=>{for(const test of cases)await scenario(test);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
