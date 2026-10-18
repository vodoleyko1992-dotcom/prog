'use strict';
// Настоящие MV3/content/hook/background/popup; сервер и короткий DOM-журнал синтетические.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
async function scenario(kind){
 const h=await harness(),S={phase:1,won:false,dead:false,counter:100,revision:10,acts:[],errors:[]};
 const spawn=()=>S.phase===1?'fixture-1':'fixture-2';
 const names=()=>S.phase===2?[]:kind==='defeat'?['Cave Maiden','Cave Maiden']:['Cave Maiden','Cave Maiden','Cave Howler'];
 const log=()=>['Бой начат: Safe Mob (ур.63)',...names().map(n=>'Додаткова ціль повалена: '+n+'.'),...Array.from({length:100},(_,i)=>'Спойл Coal ×'+(i+1)),S.dead?'Поражение!':'Победа!'];
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:63,l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},revision:S.revision,mobsKilled:S.counter,hp:S.dead?0:7000,maxHp:7000,mp:900,maxMp:900,inBattle:!S.won&&!S.dead,inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const battle=()=>({spawnId:spawn(),mobName:'Safe Mob',mobHp:S.won?0:1000,mobMaxHp:1000,mobLevel:63,kind:'normal',log:S.won||S.dead?log():['Бой начат: Safe Mob (ур.63)'],logSeq:S.won||S.dead?102+names().length:1});
 const result=()=>({kind:'full',revision:S.revision,character:character(),battle:battle(),...(S.won?{victory:{spawnId:spawn(),mobName:'Safe Mob',fullLog:log()}}:S.dead?{defeat:{spawnId:spawn(),mobName:'Safe Mob',fullLog:log()}}:{})});
 const html=()=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">63</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">${S.dead?0:7000}</span><span id="l2-hud-hp-max">7000</span><span id="l2-hud-mp-cur">900</span><span id="l2-hud-mp-max">900</span><div id="battle-mob-title">Safe Mob · ур.63</div><div id="battle-mob-hp-val">${S.won?0:1000} / 1000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack"><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" ${S.won?'':'hidden'}>Победа!</div><div id="battle-defeat-root" ${S.dead?'':'hidden'}>Поражение!</div><script>
(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));await fetch('/character');await fetch('/game/battle');document.getElementById('attack').onclick=async()=>{const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'stale-first-spawn'})});const d=await r.json();document.getElementById('battle-mob-hp-val').textContent=(d.victory?'0':'1000')+' / 1000';document.getElementById('battle-victory-inline').hidden=!d.victory;document.getElementById('battle-defeat-root').hidden=!d.defeat;document.getElementById('l2-hud-hp-cur').textContent=d.character.hp;document.getElementById('battle-log').innerHTML=d.battle.log.slice(-6).map(s=>'<div class="l2-battle-log-line">'+s+'</div>').join('');${kind==='reload'?'location.reload();':''}};})();</script>`;
 try{
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['auto'],limitRanges:{},autoKillLimit:0,catKillLimit:0,dailyKillLimit:99,taskOnly:false,zoneAuto:true,catMode:false,warlordAggro:false,autoMagister:false,autoRoles:false,autoRevive:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:false,rbHuntMode:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:false,rec:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',lvl:63,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},farmQuota:{},farmKillMark:null,dailyQuota:null,kills:0,magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,rbGo:null,rbHunt:null,zoneGo:null,invScan:null,target:null,petBufferTrip:null,manualKickAt:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}});});
  await h.ctx.route('https://l2wap.com/**',async r=>{const p=new URL(r.request().url()).pathname,json=x=>r.fulfill({json:x}).catch(()=>{});try{
   if(p==='/character')return json({character:character()});
   if(p==='/game/battle')return json(result());
   if(p==='/game/battle/action'){
    S.acts.push(r.request().postDataJSON().action);S.revision++;S.dead=kind==='defeat';S.won=!S.dead;
    S.counter+=S.phase===2?4:kind==='short-counter'||kind==='late-counter'?1:kind==='defeat'?2:4;
    return json(result());
   }
   if(p==='/battle.html')return r.fulfill({contentType:'text/html',body:html()});
   if(r.request().method()==='POST')throw Error('unexpected POST '+p);return json({});
  }catch(e){S.errors.push(e.message);return r.fulfill({status:500,body:'{}'}).catch(()=>{});}});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn());await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.click('start');
  const first=kind==='defeat'?2:4;
  await until(async()=>((await h.get(['rt'])).rt.dailyQuota?.auto===first),30000);await h.click('stop');
  let state=await h.get(['rt']);assert.equal(state.rt.kills,first);assert.equal(state.rt.farmQuota.auto.got,first);assert.deepEqual(S.acts,['attack']);
  if(kind==='late-counter'){
   S.phase=2;S.won=false;await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn());await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.click('start');
   await until(async()=>((await h.get(['rt'])).rt.dailyQuota?.auto===5),30000);await h.click('stop');state=await h.get(['rt']);assert.equal(state.rt.kills,5);assert.equal(state.rt.farmQuota.auto.got,5);assert.deepEqual(S.acts,['attack','attack']);
  }
  await h.openTab('limits');await until(async()=>(await h.popup.locator('#mobsDailyProgress').textContent()).includes(String(kind==='late-counter'?5:first)+' / 99'),10000);
  assert.deepEqual(S.errors,[]);assert.deepEqual(h.errors,[]);console.log('PASS MV3 group counter '+kind,JSON.stringify({kills:state.rt.kills,daily:state.rt.dailyQuota.auto,series:state.rt.farmQuota.auto.got,actions:S.acts.length}));
 }catch(e){const {rt,on}=await h.get(['rt','on']);console.error('DIAG',kind,JSON.stringify({S,state:{on,kills:rt.kills,status:rt.status,daily:rt.dailyQuota,series:rt.farmQuota,mark:rt.farmKillMark},core:await h.g.core('JSON.stringify({on,running,tabOwner,status:rt.status,kills:rt.kills,summary:L2V7Modules.fightlab.killsFor?.(new URLSearchParams(location.search).get("spawnId"),0)})').catch(()=>null)}));throw e;}
 finally{await h.ctx.close();}
}
(async()=>{for(const kind of(process.env.GROUP_COUNTER_CASES||'full,short-counter,late-counter,reload,defeat').split(','))await scenario(kind)})().catch(e=>{console.error(e.stack);process.exitCode=1});
