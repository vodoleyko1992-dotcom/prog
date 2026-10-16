'use strict';
// 17.10.2026: настоящее MV3, штатный weaponEquipNote без имени ручного клика, затем оба агро → AoE. Все ответы локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(mode){
 const h=await harness();const acts=[];let mp=500,ended=false,paused=false;
 const character=()=>({name:'AuditHero',level:48,l2Profession:'human_warlord',classBranch:'fighter',classSlots:{activeSlot:0},revision:100+acts.length,hp:6195,maxHp:6195,mp,maxMp:874,inBattle:!ended});
 const battle=()=>({spawnId:'fixture',mobName:'Garden Guard',mobHp:ended?0:458,mobMaxHp:2484,mobLevel:48,kind:'normal',log:ended?['Победа!']:acts.includes('provoke')?['Провокація (Provoke): агро Garden Guard; −10% опору до списів, 10 с.']:[]});
 try{
 await h.sw.evaluate(async mode=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,warlordAggro:mode!=='off',autoMagister:false,taskOnly:false,zoneAuto:false,catMode:false,chain:false,searchChamp:false,searchQuest:false,champFa:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'Вихор',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,reactMin:0,reactMax:0,rbMode:false,rbTour:false,epicMode:false,fishMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false},rt:{...rt,char:'AuditHero',lvl:48,prof:'human_warlord',classCur:{prof:'human_warlord',slot:0},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponMetaPending:null,weaponNow:mode.includes('stale')?'Old Sword':'',weapons:[],weaponsT:0,shopT:Date.now()}})},mode);
 await h.ctx.route('https://l2wap.com/**',async route=>{
 const path=new URL(route.request().url()).pathname;const json=d=>route.fulfill({contentType:'application/json',body:JSON.stringify(d)}).catch(()=>{});
 if(path==='/character')return json({character:character()});
 if(path==='/game/battle')return json({character:character(),battle:battle()});
 if(path==='/game/battle/action'){
  const q=route.request().postDataJSON();acts.push(q.action);mp-=q.action==='provoke'?57:q.action==='howl'?31:49;
  if(mode==='howl-stop'&&q.action==='howl'){await h.click('stop');paused=true;}
  if(!['provoke','howl'].includes(q.action))ended=true;
  return json({kind:'full',character:character(),battle:battle(),...(ended?{victory:{spawnId:'fixture',mobName:'Garden Guard'}}:{})});
 }
 if(path==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">48</div><div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">6195</span><span id="l2-hud-hp-max">6195</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">874</span><div id="battle-mob-title">Garden Guard · ур.48</div><div id="battle-mob-hp-val">458 / 2484</div><button class="l2-battle-hotbar-slot" title="Провокація масова" id="pull" ${mode.startsWith('howl')?'disabled':''}><span data-slot-cd="provoke" hidden></span></button><button class="l2-battle-hotbar-slot" title="Звіриний рев" id="howl"><span data-slot-cd="howl" hidden></span></button><button class="l2-battle-hotbar-slot" title="Вихор" id="aoe"><span data-slot-cd="whirlwind" hidden></span></button><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');fetch('/game/battle');for(const [id,action]of [['pull','provoke'],['howl','howl'],['aoe','whirlwind'],['attack','attack']])document.getElementById(id).onclick=async()=>{const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,battleSpawnId:'fixture'})});const d=await r.json();document.getElementById('l2-hud-mp-cur').textContent=d.character.mp;document.getElementById('battle-log').textContent=d.battle.log.join(' ');if(d.victory){document.getElementById('battle-mob-hp-val').textContent='0 / 2484';document.getElementById('battle-victory-inline').hidden=false;}};</script>`});
 return json({});
 });
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await until(()=>h.g.core('BATTLE_NET?.name==="Garden Guard"'));await h.g.core("weaponEquipNote({action:'equip',itemId:299,expectedRevision:100}).then(()=>true)");
 const proof=await h.g.core('({hint:rt.weaponNow,eq:rt.weaponEq?.id,wt:rt.weapons.find(w=>w.where===\"надето\")?.wt,pending:rt.weaponMetaPending})');assert.equal(proof.hint,mode.includes('stale')?'Old Sword':'');assert.equal(proof.eq,299);assert.equal(proof.wt,'древковое');assert.equal(proof.pending,null);
 await h.g.p.bringToFront();await h.click('start');
 if(mode==='howl-stop'){await until(()=>paused,12000);await delay(1600);assert.deepEqual(acts,['howl']);}
 else{await until(()=>ended,12000);assert.deepEqual(acts,mode==='off'?['whirlwind']:mode.startsWith('howl')?['howl','whirlwind']:['provoke','whirlwind']);}
 await h.click('stop');
 if(mode==='off'){await h.openTab('panel');const box=h.popup.locator('#warlordAggro');assert.equal(await box.isChecked(),false);await box.check();await until(async()=>(await h.get(['cfg'])).cfg.warlordAggro===true);await box.uncheck();await until(async()=>(await h.get(['cfg'])).cfg.warlordAggro===false);}
 assert.deepEqual(h.errors,[]);console.log('PASS MV3/main/hook Provoke',mode,acts.join('→'));
 }catch(e){console.error('DIAG',mode,acts,await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,prof:rt.classCur,weapon:rt.weapons,weaponNow:rt.weaponNow,net:BATTLE_NET,errors:rt.errors})').catch(()=>''));throw e;}finally{await h.ctx.close()}
}
(async()=>{for(const mode of ['provoke-empty','provoke-stale','howl-empty','howl-stale','howl-stop','off'])await scenario(mode)})().catch(e=>{console.error(e.stack);process.exitCode=1});
