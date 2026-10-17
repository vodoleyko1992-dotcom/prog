'use strict';
// Настоящие MV3/main/background/popup, все ответы игры локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(task){
 const h=await harness();let counter=100,won=false;const acts=[];
 const character=()=>({name:'AuditHero',level:49,l2Profession:'dwarf_bounty_hunter',revision:100+acts.length,mobsKilled:counter,hp:7000,maxHp:7000,mp:500,maxMp:900,inBattle:!won});
 try{
 await h.sw.evaluate(async task=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:task==='cat'?['cat','auto']:['auto','dailies'],autoKillLimit:task==='auto'?3:0,catKillLimit:task==='cat'?3:0,taskOnly:false,zoneAuto:true,catMode:task==='cat',catDungeon:'catacomb_of_the_branded',warlordAggro:false,autoMagister:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:false,rbHuntMode:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:false},rt:{...rt,char:'AuditHero',lvl:49,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},farmQuota:{},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}})},task);
 await h.ctx.route('https://l2wap.com/**',async route=>{const p=new URL(route.request().url()).pathname;const json=x=>route.fulfill({json:x}).catch(()=>{});
 if(p==='/character')return json({character:character()});
 if(p==='/game/battle')return json({character:character(),battle:{spawnId:'fixture',mobName:'Garden Guard',mobHp:won?0:1000,mobMaxHp:1000,mobLevel:49,kind:'normal',log:[]}});
 if(p==='/game/battle/action'){acts.push(route.request().postDataJSON().action);counter+=3;won=true;return json({character:character(),victory:{spawnId:'fixture'}})}
 if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">49</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">7000</span><span id="l2-hud-hp-max">7000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">900</span><div id="battle-mob-title">Garden Guard · ур.49</div><div id="battle-mob-hp-val">1000 / 1000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');fetch('/game/battle');document.getElementById('attack').onclick=async()=>{await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack'})});document.getElementById('battle-mob-hp-val').textContent='0 / 1000';document.getElementById('battle-victory-inline').hidden=false;};</script>`});
 return json({});
 });
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.g.p.bringToFront();await h.click('start');
 await until(async()=>((await h.get(['rt'])).rt.farmQuota?.[task]?.done),20000);
 const state=await h.get(['rt','cfg','on']);assert.equal(state.on,true);assert.equal(state.rt.farmQuota[task].got,3);assert.ok(!state.cfg.autoTasks.includes(task));assert.ok(state.cfg.autoTasks.includes(task==='cat'?'auto':'dailies'));assert.deepEqual(acts,['attack']);await h.click('stop');
 await h.openTab('hunt');await h.popup.locator('#'+task+'KillLimit').fill('12');await h.popup.locator('#'+task+'KillLimit').dispatchEvent('change');await until(async()=>((await h.get(['cfg'])).cfg[task+'KillLimit'])===12);await h.click(task+'KillReset');assert.equal((await h.get(['rt'])).rt.farmQuota[task].got,0);
 assert.deepEqual(h.errors,[]);console.log('PASS MV3 '+task+': victory +3 → task disabled / bot ON / remaining task; UI limit/reset');
 }catch(e){console.error('DIAG',task,acts,await h.get(['rt','cfg','on']));throw e}finally{await h.ctx.close()}
}
(async()=>{for(const task of ['cat','auto'])await scenario(task)})().catch(e=>{console.error(e.stack);process.exitCode=1});
