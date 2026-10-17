'use strict';
// Настоящие MV3/main/background/popup, все ответы игры локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(task){
 const h=await harness();let counter=100,won=false,target=3;const acts=[];
 const character=()=>({name:'AuditHero',level:49,l2Profession:'dwarf_bounty_hunter',revision:100+acts.length,mobsKilled:counter,hp:7000,maxHp:7000,mp:500,maxMp:900,inBattle:!won});
 try{
 await h.sw.evaluate(async task=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:task==='cat'?['cat','auto']:['auto','dailies'],autoKillLimit:task==='auto'?3:0,catKillLimit:task==='cat'?3:0,taskOnly:false,zoneAuto:true,catMode:task==='cat',catDungeon:'catacomb_of_the_branded',warlordAggro:false,autoMagister:false,autoRoles:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:false,rbHuntMode:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:false},rt:{...rt,char:'AuditHero',lvl:49,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},farmQuota:{},magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,kills:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}})},task);
 await h.ctx.route('https://l2wap.com/**',async route=>{const p=new URL(route.request().url()).pathname;const json=x=>route.fulfill({json:x}).catch(()=>{});
 if(p==='/character')return json({character:character()});
 if(p==='/game/battle')return json({character:character(),battle:{spawnId:'fixture',mobName:'Garden Guard',mobHp:won?0:1000,mobMaxHp:1000,mobLevel:49,kind:'normal',log:[]}});
 if(p==='/game/battle/action'){acts.push(route.request().postDataJSON().action);counter+=target;won=true;return json({character:character(),victory:{spawnId:'fixture'}})}
 if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">49</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">7000</span><span id="l2-hud-hp-max">7000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">900</span><div id="battle-mob-title">Garden Guard · ур.49</div><div id="battle-mob-hp-val">1000 / 1000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>fetch('/character');fetch('/game/battle');document.getElementById('attack').onclick=async()=>{await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack'})});document.getElementById('battle-mob-hp-val').textContent='0 / 1000';document.getElementById('battle-victory-inline').hidden=false;};</script>`});
 return json({});
 });
 await h.openTab('limits');const key=task+'KillLimit';await h.popup.locator('#'+key+'From').fill('2');await h.popup.locator('#'+key+'To').fill('4');await h.click(key+'RangeSet');
 await until(async()=>!!(await h.get(['cfg'])).cfg.limitRanges?.[key]);target=(await h.get(['cfg'])).cfg[key];assert.ok(target>=2&&target<=4);
 await h.popup.reload();await until(()=>h.popup.locator('#'+key+'RangeSet').evaluate(e=>!!e.onclick));await h.openTab('limits');assert.equal((await h.get(['cfg'])).cfg[key],target);assert.equal(await h.popup.locator('#'+key+'From').inputValue(),'2');
 await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.g.p.bringToFront();await h.click('start');
 await until(async()=>((await h.get(['rt'])).rt.farmQuota?.[task]?.done),20000);
 const state=await h.get(['rt','cfg','on']);assert.equal(state.on,true);assert.equal(state.rt.farmQuota[task].got,target);assert.ok(state.cfg.limitRanges[key]);assert.ok(!state.cfg.autoTasks.includes(task));assert.ok(state.cfg.autoTasks.includes(task==='cat'?'auto':'dailies'));assert.deepEqual(acts,['attack']);await h.click('stop');
 await h.openTab('limits');await h.click(task+'KillReset');assert.equal((await h.get(['rt'])).rt.farmQuota[task].got,0);
 assert.deepEqual(h.errors,[]);console.log('PASS MV3 '+task+': random range 2–4 → stored target / popup reload / full Save+Start preserves range / exact victory / reset');
 }catch(e){console.error('DIAG',task,acts,await h.get(['rt','cfg','on']));throw e}finally{await h.ctx.close()}
}
async function settings(){
 const h=await harness();try{
 await h.openTab('limits');const keys={dailyFishLimit:[2,4],dailyAutoKillLimit:[10,20],dailyCatKillLimit:[5,10],fishMaxCasts:[50,100]};
 for(const [key,[min,max]] of Object.entries(keys)){
 await h.popup.locator('#'+key+'From').fill(String(min));await h.popup.locator('#'+key+'To').fill(String(max));await h.click(key+'RangeSet');await until(async()=>!!(await h.get(['cfg'])).cfg.limitRanges?.[key]);
 const {cfg}=await h.get(['cfg']);assert.ok(cfg[key]>=min&&cfg[key]<=max);assert.ok((await h.popup.locator('#'+key+'RangeInfo').textContent()).includes('выбрано'));
 }
 const {cfg:before}=await h.get(['cfg']);await h.click('start');await until(()=>h.g.core('on && tabOwner'));
 const {cfg:after}=await h.get(['cfg']);for(const key of Object.keys(keys)){assert.equal(after[key],before[key]);assert.deepEqual(after.limitRanges[key],before.limitRanges[key]);}
 await h.g.core('dailyLimitFishSync()');await h.g.core('L2V7Modules.fishing.fishCaught("Small Fish")');assert.equal((await h.get(['rt'])).rt.dailyQuota.fish,1);await h.click('stop');
 await h.openTab('limits');await h.popup.locator('#fishTgtN').fill('4');await h.popup.locator('#fishTgtMax').fill('6');await h.click('fishTgtSet');await until(async()=>!!(await h.get(['rt'])).rt.fishTgt);
 const goal=(await h.get(['rt'])).rt.fishTgt;assert.ok(goal.n>=4&&goal.n<=6);assert.equal(goal.min,4);assert.equal(goal.max,6);
 await h.popup.locator('#fishTgtType').selectOption('proof');await h.popup.locator('#fishTgtN').fill('20');await h.popup.locator('#fishTgtMax').fill('30');await h.click('fishTgtSet');await until(async()=>(await h.get(['rt'])).rt.fishTgt?.type==='proof');assert.ok((await h.get(['rt'])).rt.fishTgt.n>=20);
 await h.popup.locator('#dailyAutoKillLimit').fill('40');await h.popup.locator('#dailyAutoKillLimit').dispatchEvent('change');await until(async()=>!(await h.get(['cfg'])).cfg.limitRanges?.dailyAutoKillLimit);assert.equal((await h.get(['cfg'])).cfg.dailyAutoKillLimit,40);
 await h.click('dailyCatKillLimitRangeClear');assert.equal((await h.get(['cfg'])).cfg.limitRanges.dailyCatKillLimit,undefined);
 assert.deepEqual(h.errors,[]);console.log('PASS MV3 daily/cast range settings, Start preserves chosen limits, real fish hook, fish/Proof random goals and return to fixed');
 }finally{await h.ctx.close()}
}
(async()=>{for(const task of ['cat','auto'])await scenario(task);await settings()})().catch(e=>{console.error(e.stack);process.exitCode=1});
