'use strict';
// Настоящие MV3/main/mobfarm/dungeons; HTTPS и обработчик родной кнопки — локальная модель.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const proof=[];
async function scenario(reroute){
 const h=await harness(),calls=[],paths=[],routeErrors=[];
 const did=reroute?'necropolis_of_devotion':'catacomb_of_the_witch',sid=n=>'sdms_'+did+'_'+n,initial=sid('099');
 const rows=(reroute?[[60,'Low60'],[64,'Low64'],[67,'Low67']]:[[69,'Lower69'],[71,'EqualPlusOne71'],[73,'Higher73']]).map(([level,name])=>({id:sid(String(level).padStart(3,'0')),name,level,kind:'passive',inBattleRange:true}));
 const ch=()=>({id:'fixture-cat-hero',name:'AuditHero',revision:100,level:70,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:70}]},adena:30000000,inBattle:false,hp:10000,maxHp:10000,mp:1400,maxMp:1400,mobsKilled:0,locationType:'dungeon',activeDungeonId:did,inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153}]},activeBuffs:[],activeSummon:null});
 const base='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">70</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1400</span><span id="l2-hud-mp-max">1400</span>';
 const html=u=>{const initialPage=u.pathname==='/battle.html'&&u.searchParams.get('spawnId')===initial;return '<!doctype html><meta charset="utf-8"><title>Подбор уровня</title>'+base+(initialPage?'<div id="battle-mob-title">Previous67 · ур.67</div><div id="battle-mob-hp-val">0 / 1000</div><div id="battle-log"></div><div id="battle-victory-inline">Победа!</div><button id="battle-victory-hunt">Охотиться дальше</button><script>document.getElementById("battle-victory-hunt").onclick=async()=>{await fetch("/game/battle/hunt-continue",{method:"POST",body:JSON.stringify({fixture:true})});document.getElementById("battle-victory-inline").hidden=true;document.getElementById("battle-mob-hp-val").textContent="1000 / 1000";};</script>':'<div id="map-mob-list"></div>');};
 const state=()=>h.g.core('({on,running,tabOwner,status:rt.status,catMode:cfg.catMode,mode:autonomyMode(),next:L2V7Modules.dungeons.catTarget(),catLv:rt.catLv,target:rt.target,owner:rt.actionOwner})');
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;calls.push({path:p,query:u.search,method:q.method()});
   if(p==='/game/battle/hunt-continue')return r.fulfill({json:{ok:true,fixture:true}});
   assert.equal(q.method(),'GET','выбор следующей цели не инициирует оплату/случайную охоту');
   if(p.endsWith('.html')){paths.push(p+u.search);return r.fulfill({contentType:'text/html',body:html(u)});}
   if(p==='/character')return r.fulfill({json:{character:ch()}});
   if(p==='/game/dungeon/view'){assert.equal(u.searchParams.get('dungeonId'),did);return r.fulfill({json:{dungeon:{id:did,mobs:rows}}});}
   return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({did})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['cat'],taskOnly:false,catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:5,rbHuntMode:false,rbMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',searchChamp:false,searchQuest:false,potSlotAuto:false,autoShots:false,zoneAuto:false,catKillLimit:0,dailyCatKillLimit:0},rt:{...rt,char:'AuditHero',lvl:70,prof:'Bounty hunter',classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},classBranch:'fighter',manualKickAt:0,catCur:did,catIn:did,catInT:Date.now(),catLv:{catacomb_of_the_witch:{lo:70,hi:75,n:5,t:Date.now()}},invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:{name:'Previous67',rb:false,champ:false},buffCancel:{}}})},{did});
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+initial);await until(()=>h.g.core('typeof L2V7Modules.dungeons.catNext==="function"'));
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(()=>calls.some(x=>x.path==='/game/battle/hunt-continue')||(reroute?h.g.p.url().endsWith('/catacombs.html'):h.g.p.url().endsWith('spawnId='+sid('071'))),18000);
  const native=calls.filter(x=>x.path==='/game/battle/hunt-continue');assert.equal(native.length,0,'автовыбор не использует случайный native hunt-continue');
  await until(()=>h.g.core('typeof L2V7Modules.dungeons.catTarget==="function"'));
  const s=await state();
  if(reroute){assert.equal(new URL(h.g.p.url()).pathname,'/catacombs.html');assert.equal(s.next,'catacomb_of_the_witch');assert.equal(s.catLv.necropolis_of_devotion.lo,60);assert.equal(s.catLv.necropolis_of_devotion.hi,67);assert.ok(!paths.some(x=>x.includes('spawnId=sdms_necropolis_of_devotion_0')&&!x.endsWith('_099')));}
  else{assert.equal(new URL(h.g.p.url()).searchParams.get('spawnId'),sid('071'));assert.ok(!paths.some(x=>x.includes('spawnId='+sid('069'))||x.includes('spawnId='+sid('073'))));}
  await h.click('stop');await until(()=>h.g.core('!on'));assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);assert.equal(calls.some(x=>x.method==='POST'),false);
  proof.push({case:reroute?'fresh-low-dungeon-reroute':'fresh-list-pick-hero-plus-one',browser:h.ctx.browser().version(),calls,paths,state:s,errors:[...h.errors,...routeErrors]});
  console.log('PASS actual MV3 cat level '+(reroute?'fresh Devotion60–67 → appropriate Witch target/catalog, no low next battle':'fresh69/71/73 → exact71 spawn URL'),JSON.stringify({paths,views:calls.filter(x=>x.path==='/game/dungeon/view').length,native:0}));
 }catch(e){console.error('DIAG',JSON.stringify({reroute,calls,paths,routeErrors,state:await state().catch(String)}));throw e;}
 finally{await h.ctx.close();}
}
(async()=>{for(const reroute of [true,false])await scenario(reroute);if(process.env.CAT_LEVEL_PROOF)fs.writeFileSync(process.env.CAT_LEVEL_PROOF,JSON.stringify({at:new Date().toISOString(),boundary:'actual extension/parser/main; fully local HTTPS and native handler model; no live game',proof},null,2)+'\n')})().catch(e=>{console.error(e.stack);process.exitCode=1});
