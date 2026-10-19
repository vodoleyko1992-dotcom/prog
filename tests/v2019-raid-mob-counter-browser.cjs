'use strict';
// Настоящие MAIN hook/content/background/popup. РБ жив, старые201 смерти уже находятся в журнале.
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness(),S={acts:0,cap:5,revision:10,win:false,n:201},spawn='l2dop_rb_fixture',errors=[];
 const lines=['Бой начат: Audit Boss',...Array(201).fill('Додаткова ціль повалена: Cave Maiden.'),...Array(100).fill('Coal ×1')];
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:63,l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},revision:S.revision,mobsKilled:10000+S.n-201+(S.win?1:0),hp:40000,maxHp:40000,mp:1000,maxMp:1000,inBattle:!S.win,inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const battle=()=>({spawnId:spawn,mobName:'Audit Boss',mobHp:S.win?0:900000-S.acts*1000,mobMaxHp:1000000,mobLevel:63,kind:'raid',log:lines,logSeq:lines.length});
 const result=()=>({kind:'full',revision:S.revision,character:character(),battle:battle(),...(S.win?{victory:{spawnId:spawn,mobName:'Audit Boss',fullLog:lines}}:{})});
 const html=()=>`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">63</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">40000</span><span id="l2-hud-hp-max">40000</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span><div id="battle-mob-title">Audit Boss · ур.63</div><div id="battle-mob-hp-val">${battle().mobHp} / 1000000</div><button class="l2-battle-hotbar-slot" title="Атака" id="attack" ${S.acts>=S.cap?'disabled':''}><span data-slot-cd="attack" hidden></span></button><div id="battle-log"></div><div id="battle-victory-inline" ${S.win?'':'hidden'}>Победа!</div><script>
(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));await fetch('/character');await fetch('/game/battle');document.getElementById('attack').onclick=async()=>{const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'attack',battleSpawnId:'stale-spawn'})});const d=await r.json();document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / 1000000';document.getElementById('battle-victory-inline').hidden=!d.victory;document.getElementById('battle-log').innerHTML=d.battle.log.slice(-6).map(x=>'<div class="l2-battle-log-line">'+x+'</div>').join('');document.getElementById('attack').disabled=d.fixtureHold;};})();</script>`;
 try{
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid','auto'],limitRanges:{},dailyKillLimit:20,autoKillLimit:0,catKillLimit:0,autoRoles:false,autoMagister:false,autoRevive:false,combatProfile:'fighter',nAttack:'Атака',nPower:'',nUltra:'',nStun:'',nBuffs:'',nKeyBuffs:'',nDebuff:'',nDrain:'',nCharge:'',nToggles:'',warlordAggro:false,petAuto:false,petBuffAuto:false,debuffAuto:false,autoShots:false,potSlotAuto:false,townBuffSet:'off',faBuffs:'',tvtOn:false,enemyHunt:false,fishMode:false,rbMode:true,rbHuntMode:false,rbUsePots:false,rbCharge:false,rbFrenzyDive:false,epicMode:false,shopAuto:false,campAuto:false,campaign:false,weaponScanAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,chain:false,rec:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',lvl:63,prof:'dwarf_bounty_hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1},kills:0,sessT0:1,dailyQuota:null,farmQuota:{},farmKillMark:null,raidMobMarks:{},via:'manual',target:null,mobClickAt:0,rbCur:null,rbDb:{},rbHunt:null,rbGo:null,magister:null,magPending:{},magEnabled:false,shop:null,tbuff:null,storyJob:null,zoneGo:null,invScan:null,petBufferTrip:null,manualKickAt:0,skills:{},skillDb:{},cdUntil:{},cdUse:{},weaponsT:Date.now(),shopT:Date.now()}});});
  await h.ctx.route('https://l2wap.com/**',async r=>{const p=new URL(r.request().url()).pathname;try{
   if(p==='/character')return r.fulfill({json:{character:character()}});
   if(p==='/game/battle'){const d=result();if(S.hideCursorOnce){S.hideCursorOnce=false;delete d.battle.logSeq}return r.fulfill({json:d});}
   if(p==='/game/battle/action'){
    assert.equal(r.request().postDataJSON().action,'attack');assert.ok(S.acts<S.cap,'не больше разрешённых fixture-ходов');S.acts++;S.revision++;
    if(S.cap===16){S.win=true;lines.push('Победа!')}else{S.n+=3;lines.push('Додаткова ціль повалена: Cave Maiden.','Додаткова ціль повалена: Cave Maiden.','Додаткова ціль повалена: Cave Howler.',...Array(100).fill('Coal ×1'))}
    return r.fulfill({json:{...result(),fixtureHold:S.acts>=S.cap}});
   }
   if(p==='/battle.html')return r.fulfill({contentType:'text/html',body:html()});
   if(r.request().method()==='POST')throw Error('unexpected POST '+p);return r.fulfill({json:{}});
  }catch(e){errors.push(e.message);return r.fulfill({status:500,json:{}}).catch(()=>{})}});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn);await until(()=>h.g.core('rt.char==="AuditHero"'));await h.g.p.evaluate(()=>fetch('/game/battle'));await h.click('start');
  await until(()=>S.acts===5,30000);
  if(process.env.RAID_BASELINE)await delay(1500);else await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.raid===15,15000);
  let state=await h.get(['rt','on']);assert.equal(state.rt.dailyQuota?.raid||0,15);assert.equal(state.rt.kills,15);assert.equal(S.win,false);assert.equal(state.on,true);
  S.cap=10;S.hideCursorOnce=true;await h.g.p.reload();await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.raid===30,30000);state=await h.get(['rt','on']);assert.equal(state.rt.kills,30);assert.equal(S.acts,10);assert.equal(S.win,false);assert.equal(state.on,true);
  await h.openTab('limits');await until(async()=>(await h.popup.locator('#mobsDailyProgress').textContent()).includes('рядом с РБ 30'));assert.match(await h.popup.locator('#mobsDailyProgress').textContent(),/^30 \/ 20 /);
  await h.click('reset');await h.click('reset');await until(async()=>(await h.get(['rt'])).rt.kills===0);S.cap=13;await h.g.p.evaluate(()=>document.getElementById('attack').disabled=false);
  await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.raid===39,30000);assert.equal((await h.get(['rt'])).rt.kills,9);
  await h.openTab('limits');await h.popup.locator('#mobsDailyReset').click();await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.raid===0);
  await h.g.p.evaluate(()=>fetch('/game/battle'));await delay(300);assert.equal((await h.get(['rt'])).rt.dailyQuota.raid,0);
  S.cap=15;await h.g.p.evaluate(()=>document.getElementById('attack').disabled=false);await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.raid===6,30000);assert.equal((await h.get(['rt'])).rt.kills,15);
  S.cap=16;await h.g.p.evaluate(()=>document.getElementById('attack').disabled=false);await until(async()=>(await h.get(['rt'])).rt.rbKills===1,30000);await h.click('stop');state=await h.get(['rt']);assert.equal(state.rt.kills,16);assert.equal(state.rt.dailyQuota.raid,6);
  assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);console.log('PASS MV3 raid counter: старые201 не повторены, +15/+15 по живому РБ, reload, лимит не выключает тур, сброс сессии/дня, новые смерти и босс отдельно');
 }catch(e){const {rt,on}=await h.get(['rt','on']);console.error('DIAG',JSON.stringify({S,on,kills:rt.kills,daily:rt.dailyQuota,marks:rt.raidMobMarks,status:rt.status,errors}));throw e}
 finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
