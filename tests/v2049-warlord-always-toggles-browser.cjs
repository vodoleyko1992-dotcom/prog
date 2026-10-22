'use strict';
// 20.49: настоящее MV3/main/hook; только локальные HTTPS-fixtures, никаких запросов к игре.
// GET /character с toggleStances/activeBuffs проходит настоящий MAIN hook; все POST ниже — управляемый сервер стенда.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const proof=[];let browserVersion='',extensionVersion='',runtimeHashes=null;
async function scenario(mode){
 const h=await harness(),actions=[],routeErrors=[];
 browserVersion=h.ctx.browser()?.version()||browserVersion;
 extensionVersion=await h.sw.evaluate(()=>chrome.runtime.getManifest().version);
 if(!runtimeHashes)runtimeHashes=await h.sw.evaluate(async()=>Object.fromEntries(await Promise.all(
  ['content.js','hook.js','modules/combat.js','modules/buffs.js','modules/equipment.js','battle-cooldown.js'].map(async p=>{
   const r=await fetch(chrome.runtime.getURL(p));if(!r.ok)throw Error('extension source unreadable: '+p);
   const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return[p,[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')];
  }))));
 const focusName='Фокусована атака',viciousName='Порочна стійка',spawn='fixture_managed_toggles';
 const knownOn=['on-conflict','lowmp-on'].includes(mode),unknown=mode==='unknown';
 const enabled={focus_attack:knownOn,vicious_stance:knownOn};let ended=false,attacks=0,revision=100;
 const mp=['lowmp-on','lowmp-off','known-price'].includes(mode)?1:mode==='mp0-off'?0:500;
 const character=()=>({id:'local-audit-actor',name:'AuditHero',level:45,l2Profession:'human_warlord',classBranch:'fighter',classSlots:{activeSlot:3},
  revision:mode==='reload-sent'?100:revision,snapshotGeneratedAt:Date.now(),hp:8000,maxHp:8000,mp,maxMp:1000,pAtk:500,mAtk:50,inBattle:!ended,
  inventory:{eq:{l1:{itemId:299,enchant:0}},stacks:[]},
  ...(unknown?{toggleStances:[{skillId:317,battleId:'l2_317',level:1},{skillId:312,battleId:'l2_312',level:1}],activeBuffs:[]}:{toggleStances:[{skillId:317,battleId:'l2_317',level:1,active:mode==='on-conflict'||mode==='reload-sent'?false:enabled.focus_attack},
   {skillId:312,battleId:'l2_312',level:1,active:mode==='on-conflict'||mode==='reload-sent'?false:enabled.vicious_stance}],
   activeBuffs:mode==='reload-sent'?[]:[317,312].filter(id=>enabled[id===317?'focus_attack':'vicious_stance']).map(skillId=>({skillId,level:1,expiresAt:Date.now()+600000}))}),
  learnedBattleSkillsDetail:[{battleId:'l2_317',level:1},{battleId:'l2_312',level:1}]});
 const battle=()=>({spawnId:spawn,mobName:'Local Guard',mobHp:ended?0:10000-attacks*100,mobMaxHp:10000,mobLevel:45,kind:'normal',
  serverNowMs:Date.now(),...(mode==='cd'?{skillCooldowns:{l2_317:Date.now()+12000,l2_312:Date.now()+12000}}:{}),log:ended?['Победа!']:[]});
 const page=`<!doctype html><meta charset="utf-8"><title>Local Warlord toggles</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">45</div>
  <div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">8000</span><span id="l2-hud-hp-max">8000</span>
  <span id="l2-hud-mp-cur">${mp}</span><span id="l2-hud-mp-max">1000</span><div id="battle-mob-title">Local Guard · ур.45</div><div id="battle-mob-hp-val">10000 / 10000</div>
  <button id="focus" data-slot-idx="0" class="l2-battle-hotbar-slot" title="${focusName} (Focus Attack)" ${mode==='on-conflict'?'aria-pressed="false"':''} disabled><span data-slot-cd="focus_attack" hidden></span></button>
  <button id="vicious" data-slot-idx="1" class="l2-battle-hotbar-slot" title="${viciousName} (Vicious Stance)" ${mode==='on-conflict'?'aria-pressed="false"':''} disabled><span data-slot-cd="vicious_stance" hidden></span></button>
  <button id="attack" data-slot-idx="2" class="l2-battle-hotbar-slot" title="Атака" disabled><span data-slot-cd="attack" hidden></span></button>
  <div id="battle-toast"></div><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>
  fetch('/character');fetch('/game/battle');
  for(const[id,action]of[['focus','focus_attack'],['vicious','vicious_stance'],['attack','attack']])document.getElementById(id).onclick=async()=>{
   try{
    const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,battleSpawnId:${JSON.stringify(spawn)}})}),d=await r.json();
    if(!r.ok){document.getElementById('battle-toast').textContent=d.messageUk||d.error||'HTTP '+r.status;return;}
    if(d.toggleActive!==undefined){const b=document.getElementById(id);b.classList.toggle('l2-battle-hotbar-slot--toggle-on',d.toggleActive);b.setAttribute('aria-pressed',String(d.toggleActive));}
    document.getElementById('battle-log').textContent=d.battle?.log?.join(' ')||'';
    if(d.victory){document.getElementById('battle-mob-hp-val').textContent='0 / 10000';document.getElementById('battle-victory-inline').hidden=false;}
    await fetch('/character');
   }catch(e){document.getElementById('battle-toast').textContent='local lost response';}
  };</script>`;
 try{
  await h.sw.evaluate(async({focusName,viciousName,mode})=>{
   const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);
   await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['farm'],taskOnly:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,
    zoneAuto:false,catMode:false,chain:false,searchChamp:false,searchQuest:false,champFa:false,warlordAggro:false,
    nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:focusName+', '+viciousName,nKeyBuffs:'',nDebuff:'',nDrain:'',nHeal:'',nCharge:'',nToggles:focusName+', '+viciousName,
    petAuto:false,petBuffAuto:false,petFullAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',
    tvtOn:false,enemyHunt:false,reactMin:0,reactMax:0,rbMode:false,rbTour:false,rbHuntMode:false,epicMode:false,fishMode:false,shopAuto:false,campAuto:false,
    campaign:false,weaponScanAuto:false,weaponClassEquip:false,dailyKillLimit:0,dailyAuto:false,clanTasks:false,mpPotAt:0,hpPotAt:0,toggleMpOff:80,toggleMpOn:90},
    rt:{...rt,char:'AuditHero',lvl:45,prof:'human_warlord',classCur:{prof:'human_warlord',slot:3},magister:null,magPending:{},magEnabled:false,
     shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},
     skillDb:mode==='known-price'?{'focus attack':{mp:18,mpKnown:true},'vicious stance':{mp:18,mpKnown:true}}:{},
     cdUntil:{},cdUse:{},managedToggleIntent:{},toggleOn:{},toggleOff:{},toggleSeen:{},weaponMetaPending:null,weaponEq:null,weaponNow:'',weaponAug:null,
     weapons:[{id:299,name:'Orcish Poleaxe',wt:'древковое',g:'C',where:'надето'}],weaponsT:Date.now()-10,shopT:Date.now()}});
  },{focusName,viciousName,mode});
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const q=route.request(),p=new URL(q.url()).pathname,json=(data,status=200)=>route.fulfill({status,json:data}).catch(()=>{});
   try{
    if(p==='/character')return json({character:character()});
    if(p==='/game/battle'||p==='/game/battle/sync')return json({character:character(),battle:battle()});
    if(p==='/game/battle/action'){
     const a=q.postDataJSON().action,wasOn=enabled[a]??null;actions.push({action:a,wasOn});
     if(a==='focus_attack'||a==='vicious_stance'){
      if(mode==='server-nomp')return json({error:'not_enough_mp',code:'not_enough_mp',messageUk:'Недостатньо MP'},400);
      enabled[a]=!enabled[a];revision++;
      if(mode==='reload-sent'&&a==='focus_attack'&&actions.filter(x=>x.action==='focus_attack').length===1)return route.abort('failed');
      return json({kind:'full',serverNowMs:Date.now(),character:character(),battle:battle(),toggleActive:enabled[a]});
     }
     assert.equal(a,'attack','неожиданный mock action');attacks++;revision++;ended=attacks>=2;
     return json({kind:'full',serverNowMs:Date.now(),character:character(),battle:battle(),...(ended?{victory:{spawnId:spawn,mobName:'Local Guard'}}:{})});
    }
    assert.equal(q.method(),'GET','неожиданный mock POST '+p);
    if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:page});
    return route.fallback();
   }catch(e){routeErrors.push(e.message);return json({error:'fixture_assertion'},500)}
  });
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn);
  await until(()=>h.g.core('typeof L2V7Modules.combat.managedToggleStep==="function"'));
  await h.g.p.bringToFront();await h.click('start');await until(()=>h.g.core('on&&tabOwner&&running'));
  await h.g.p.evaluate(()=>Promise.all([fetch('/character'),fetch('/game/battle')]));
  await until(()=>h.g.core('rt.weaponAug?.w===299&&rt.weaponAug.t>=rt.weaponsT'));await delay(100);
  if(mode==='cd')await until(()=>h.g.core('combatCooldown.skillWait("l2_317",cdSpawn())>10000'));
  assert.deepEqual(actions,[],'до проверки свежего героя панель удерживала клики');
  await h.g.p.evaluate(()=>{for(const b of document.querySelectorAll('.l2-battle-hotbar-slot'))b.disabled=false});
  if(mode==='reload-sent'){
   await until(()=>actions.some(x=>x.action==='focus_attack'),12000);
   await until(()=>h.sw.evaluate(async()=>Object.values((await chrome.storage.local.get('rt')).rt.managedToggleIntent||{}).some(x=>x.id===317)));
   await h.g.p.reload();await until(()=>h.g.core('on&&tabOwner&&running'));
   await h.g.p.evaluate(()=>Promise.all([fetch('/character'),fetch('/game/battle')]));
   await until(()=>h.g.core('rt.weaponAug?.w===299'));await delay(100);
   await h.g.p.evaluate(()=>{for(const b of document.querySelectorAll('.l2-battle-hotbar-slot'))b.disabled=false});
  }
  await until(()=>ended,18000);await h.click('stop');await delay(100);
  const toggleActions=actions.filter(x=>x.action!=='attack');
  assert.ok(toggleActions.every(x=>x.wasOn!==true),'ни одного автоматического OFF');
  if(mode==='off'||mode==='lowmp-off'){
   assert.deepEqual(actions.slice(0,2).map(x=>x.action).sort(),['focus_attack','vicious_stance']);
   assert.deepEqual(actions.slice(2).map(x=>x.action),['attack','attack']);
  }
  else if(mode==='server-nomp'){
   assert.ok(toggleActions.length<=2,'отказ MP не зацикливает попытки');assert.ok(toggleActions.length>=1);
   for(const key of ['focus_attack','vicious_stance'])assert.ok(toggleActions.filter(x=>x.action===key).length<=1);
  }else if(mode==='reload-sent')assert.equal(toggleActions.filter(x=>x.action==='focus_attack').length,1,'unknown намерение переживает reload и старый OFF не открывает повтор');
  else assert.deepEqual(toggleActions,[],mode+': автоматических переключений нет');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const row={case:mode,pass:true,actions,liveGamePosts:0};proof.push(row);console.log('PASS MV3/main/hook managed Warlord toggles',mode,JSON.stringify(row));
 }catch(e){console.error('DIAG',mode,JSON.stringify({actions,routeErrors,state:await h.g.core('({on,tabOwner,status:rt.status,weapon:rt.weaponAug,intent:rt.managedToggleIntent,net:BATTLE_NET})').catch(()=>null)}));throw e}
 finally{await h.ctx.close()}
}
(async()=>{
 const all=['off','on-conflict','lowmp-on','mp0-off','unknown','cd','server-nomp','reload-sent','lowmp-off','known-price'],modes=process.env.WARLORD_TOGGLE_CASES?process.env.WARLORD_TOGGLE_CASES.split(','):all;
 for(const mode of modes){assert.ok(all.includes(mode),'неизвестный сценарий '+mode);await scenario(mode);}
 const report={browser:browserVersion,extensionVersion,runtimeHashes,kind:'actual MV3/main/hook with local mocked game routes and MAIN /character fetch; no live game',cases:proof.length,proof,liveGame:false,liveGamePosts:0,localMockBattlePosts:proof.reduce((n,x)=>n+x.actions.length,0),pageErrors:[],routeErrors:[]};
 if(process.env.WARLORD_TOGGLES_BROWSER_REPORT)fs.writeFileSync(path.resolve(process.env.WARLORD_TOGGLES_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
