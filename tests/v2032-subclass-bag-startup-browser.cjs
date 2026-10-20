'use strict';
// Настоящие MV3/main/storage; все HTTPS ответы локальные, без запросов к аккаунту.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const fs=require('node:fs');
const proof=[];
async function scenario(stop){
 const h=await harness(),calls=[],routeErrors=[];let held=false,release;
 const gate=new Promise(r=>release=r);
 const ch=()=>({id:'fixture-hero',name:'AuditHero',revision:100,level:70,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:70}]},adena:30000000,inBattle:false,hp:10000,maxHp:10000,mp:1400,maxMp:1400,mobsKilled:0,locationType:'map',inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153},{itemId:728,qty:40}]},activeBuffs:[],activeSummon:null});
 const html='<!doctype html><meta charset="utf-8"><title>Смена саба</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">70</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1400</span><span id="l2-hud-mp-max">1400</span>';
 const state=()=>h.g.core('({on,running,tabOwner,status:rt.status,classCur:rt.classCur,lvl:rt.lvl,prof:rt.prof,skills:rt.skills,classStash:rt.classStash,ready:INV_READY===invContext(),qty:invQty(1465),proof:rt.invClassProof,owner:rt.actionOwner})');
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),p=new URL(q.url()).pathname,call={path:p,method:q.method()};calls.push(call);
   assert.equal(q.method(),'GET','смена класса и сверка сумки не инициируют мутации');
   if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:html});
   if(p==='/character'){
    call.before=await h.g.core('({classCur:rt.classCur,ready:INV_READY===invContext(),qty:invQty(1465)})');
    if(stop&&!held){held=true;await gate;}
    return r.fulfill({json:{character:ch()}}).catch(()=>{});
   }
   return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['farm'],taskOnly:false,rbHuntMode:false,rbMode:false,catMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',searchChamp:false,searchQuest:false,chain:false,potSlotAuto:false,autoShots:false,zoneAuto:false},rt:{...rt,char:'AuditHero',lvl:78,prof:'Arcana lord',classCur:{prof:'human_arcana_lord',slot:0,t:1},classBranch:'mystic',skills:{blaze:{n:7}},classStash:{dwarf_bounty_hunter:{skills:{spoil:{n:3}},t:1}},invClassProof:null,manualKickAt:0,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:null}})});
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof inventoryReady==="function"'));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  if(stop){
   await until(()=>held,10000);await h.click('stop');await until(()=>h.g.core('!on'));release();await delay(900);
   const s=await state();assert.equal(s.classCur.prof,'human_arcana_lord');assert.equal(s.ready,false);assert.notEqual(s.qty,4153);assert.equal((await h.get(['rt'])).rt.classCur.prof,'human_arcana_lord');
  }else{
   await until(async()=>{const s=await state();return s.on&&s.running&&s.tabOwner&&s.classCur?.prof==='dwarf_bounty_hunter'&&s.classCur.slot===1&&s.ready&&s.qty===4153},process.env.BAG_BASELINE?5500:18000);
   const s=await state();assert.equal(s.lvl,70);assert.match(String(s.prof),/bounty/i);assert.equal(s.skills.spoil.n,3);assert.equal(s.classStash.human_arcana_lord.skills.blaze.n,7);
   const reads=calls.filter(x=>x.path==='/character');assert.ok(reads.some((x,i)=>x.before?.classCur?.prof==='human_arcana_lord'&&reads.slice(i+1).some(y=>y.before?.classCur?.prof==='dwarf_bounty_hunter'&&!y.before.ready&&y.before.qty!==4153)),'новый класс ещё не разрешает сумку: нужен отдельный GET под новым ключом');await delay(400);await h.click('stop');
  }
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);assert.equal(h.g.p.url(),'https://l2wap.com/map.html');assert.equal(calls.some(x=>x.method!=='GET'),false);
  proof.push({case:stop?'stop-held-get':'stale-class-startup',browser:h.ctx.browser().version(),calls,state:await state(),errors:[...h.errors,...routeErrors]});
  console.log('PASS actual MV3 subclass bag '+(stop?'Stop during held GET leaves old class/inventory untouched':'stale Arcana78 → fresh Bounty70 → new inventory GET → ready, class stash preserved'),JSON.stringify({gets:calls.filter(x=>x.path==='/character').length,posts:calls.filter(x=>x.method==='POST').length}));
 }catch(e){console.error('DIAG',JSON.stringify({stop,held,calls,routeErrors,state:await state().catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{for(const stop of (process.env.BAG_ONLY_STOP?[true]:[false,true]))await scenario(stop);if(process.env.BAG_PROOF)fs.writeFileSync(process.env.BAG_PROOF,JSON.stringify({at:new Date().toISOString(),boundary:'actual MV3/main/storage, fully intercepted HTTPS, no live game',proof},null,2)+'\n')})().catch(e=>{console.error(e.stack);process.exitCode=1});
