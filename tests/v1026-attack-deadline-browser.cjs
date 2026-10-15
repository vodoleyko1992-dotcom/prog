'use strict';
// Настоящий MV3/main/hook. Серверные ответы локальные; рисунок КД намеренно застывает.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(kind,stop=false){
 const h=await harness();let hits=0,rejected=0,next=0;
 const char=()=>({name:'AuditHero',level:14,l2Profession:'human_fighter',classSlots:{activeSlot:0},revision:10+hits,hp:1000,maxHp:1000,mp:180,maxMp:180,inBattle:hits<3});
 try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoMagister:false,taskOnly:false,zoneAuto:false,catMode:false,chain:false,searchChamp:false,searchQuest:false,champFa:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,reactMin:0,reactMax:0,rbMode:false,rbTour:false,epicMode:false,fishMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false},rt:{...rt,char:'AuditHero',lvl:14,classCur:{prof:'human_fighter',slot:0},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}})});
 await h.ctx.route('https://l2wap.com/**',async route=>{
 const p=new URL(route.request().url()).pathname;
 const json=(d,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(d)}).catch(()=>{});
 if(p==='/character')return json({character:char()});
 if(p==='/game/battle/action'){
  const now=Date.now();if(now<next){rejected++;return json({serverNowMs:now,blockedBy:'skill',nextPhysicalAttackAt:next},400)}
  hits++;next=now+550;
  const fields={serverNowMs:now,nextPhysicalAttackAt:next,attackIntervalMs:550};
  return json({kind:kind==='delta'?'delta':'full',character:char(),[kind==='delta'?'delta':'battle']:fields,hp:Math.max(0,900-hits*300)});
 }
 if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">14</div><div id="character-profession">Human Fighter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">1000</span><span id="l2-hud-hp-max">1000</span><span id="l2-hud-mp-cur">180</span><span id="l2-hud-mp-max">180</span><div id="battle-mob-title">Skeleton · ур.14</div><div id="battle-mob-hp-val">900 / 900</div><button class="l2-battle-hotbar-slot" title="Атака" data-slot-idx="9" id="hit"><span data-slot-cd="attack" hidden><span class="l2-battle-hotbar-slot-cd__timer">0.3</span></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');let busy=false;document.getElementById('hit').onclick=async()=>{if(busy)return;busy=true;try{const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'fixture'})});const d=await r.json();if(!r.ok)return;document.getElementById('battle-mob-hp-val').textContent=d.hp+' / 900';const cd=document.querySelector('[data-slot-cd]');cd.hidden=false;cd.className='l2-battle-hotbar-slot-cd l2-battle-hotbar-slot-cd--on';if(!d.hp)document.getElementById('battle-victory-inline').hidden=false;}finally{busy=false;}};</script>`});
 return json({});
 });
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.bringToFront();await h.click('start');
 await until(()=>hits>=1,12000);
 if(stop){await h.click('stop');const before=hits;await delay(1800);assert.equal(hits,before)}
 else await until(()=>hits>=3,6000);
 await h.click('stop');assert.equal(rejected,0);assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 frozen attack overlay',kind,stop?'Stop':'3 hits without 20s stall');
 }catch(e){console.error("DIAG",JSON.stringify({hits,rejected,url:h.g.p.url(),state:await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,mode:autonomyMode(),err:rt.errors,cfg:{nAttack:cfg.nAttack,combatProfile:cfg.combatProfile},profile:combatProfileKind(),slots:panelInventory(),prof:rt.prof})')}));throw e;}finally{await h.ctx.close()}
}
(async()=>{await scenario('delta');await scenario('full');await scenario('delta',true)})().catch(e=>{console.error(e.stack);process.exitCode=1});
