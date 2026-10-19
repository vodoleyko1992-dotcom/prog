'use strict';
// Настоящие MV3/main/background/popup, все ответы игры локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(task){
 const h=await harness();let counter=100,won=false;const acts=[];
 const character=()=>({name:'AuditHero',level:49,l2Profession:'dwarf_bounty_hunter',revision:100+acts.length,mobsKilled:counter,hp:7000,maxHp:7000,mp:500,maxMp:900,inBattle:!won});
 try{
 await h.sw.evaluate(async task=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:task==='cat'?['cat','auto']:['auto','dailies'],autoKillLimit:0,catKillLimit:0,dailyKillLimit:8000,taskOnly:false,zoneAuto:true,catMode:task==='cat',catDungeon:'catacomb_of_the_branded',warlordAggro:false,autoMagister:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:false,rbHuntMode:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:true},rt:{...rt,char:'AuditHero',lvl:49,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},farmQuota:{},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}})},task);
 await h.ctx.route('https://l2wap.com/**',async route=>{const p=new URL(route.request().url()).pathname;const json=x=>route.fulfill({json:x}).catch(()=>{});
 if(p==='/game/time')return route.fallback();
 if(p==='/game/daily-quests'){const d=require('./tools/daily-server-fixture.cjs')();d.daily.tasks.hunt_start_500.score=8055;d.daily.tasks.hunt_start_500.have=500;return json(d.daily);}
 if(p==='/game/battle/hunt-continue'){acts.push('forbidden-chain');throw Error('цепочка обошла серверный лимит');}
 if(p==='/character')return json({character:character()});
 if(p==='/game/battle')return json({character:character(),battle:{spawnId:'fixture',mobName:'Garden Guard',mobHp:won?0:1000,mobMaxHp:1000,mobLevel:49,kind:'normal',log:[]}});
 if(p==='/game/battle/action'){acts.push(route.request().postDataJSON().action);counter+=3;won=true;return json({character:character(),victory:{spawnId:'fixture'}})}
 if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">49</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">7000</span><span id="l2-hud-hp-max">7000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">900</span><div id="battle-mob-title">Garden Guard · ур.49</div><div id="battle-mob-hp-val">1000 / 1000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><button id="battle-victory-hunt" hidden>Охотиться дальше</button><script>document.getElementById('battle-victory-hunt').onclick=()=>fetch('/game/battle/hunt-continue',{method:'POST'});fetch('/character');fetch('/game/battle');document.getElementById('attack').onclick=async()=>{await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack'})});document.getElementById('battle-mob-hp-val').textContent='0 / 1000';document.getElementById('battle-victory-inline').hidden=false;document.getElementById('battle-victory-hunt').hidden=false;};</script>`});
 return json({});
 });
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.g.p.bringToFront();await h.click('start');
 await until(async()=>((await h.get(['rt'])).rt.dailyQuota?.[task]>=3),20000);
 await until(async()=>(await h.get(['rt'])).rt.dailyServerCheck);
 const state=await h.get(['rt','cfg','on']);assert.equal(state.rt.dailyQuota.server,8052);assert.equal(await h.g.core('L2EngineCore.dailyCount(rt,\"auto\")'),8055);assert.equal(state.on,true);assert.equal(state.rt.farmQuota[task].got,3);assert.ok(state.cfg.autoTasks.includes(task));assert.equal(state.rt.dailyQuota[task],3);assert.ok(state.cfg.autoTasks.includes(task==='cat'?'auto':'dailies'));assert.deepEqual(acts,['attack']);await h.click('stop');
 await h.openTab('limits');const key='dailyKillLimit';
 assert.equal(await h.popup.locator('#tab-limits').evaluate(e=>e.classList.contains('act')),true);assert.equal(await h.popup.locator('#tab-overview').isVisible(),false);   // 19.10, #270: «Лимиты» — отдельный раздел; прежние поля и сбросы сохранены.
 await h.popup.locator('#'+key).fill('12');await h.popup.locator('#'+key).dispatchEvent('change');await until(async()=>((await h.get(['cfg'])).cfg[key])===12);
 assert.equal((await h.get(['rt'])).rt.dailyQuota[task],3);await h.click('mobsDailyReset');await until(async()=>(await h.get(['rt'])).rt.dailyQuota[task]===0);   // 20.12: сброс идёт через async menuPatch — ждём запись, а не мгновенное состояние
 assert.deepEqual(h.errors,[]);console.log('PASS actual active battle +3 → server score8055 → 0 hunt-continue despite chain=true → bot ON / task retained / explicit reset');
 }catch(e){console.error('DIAG',task,acts,await h.get(['rt','cfg','on']));throw e}finally{await h.ctx.close()}
}
(async()=>{await scenario('auto')})().catch(e=>{console.error(e.stack);process.exitCode=1});
