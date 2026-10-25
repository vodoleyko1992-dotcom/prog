'use strict';
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): настоящие MV3/фон/вкладка/меню, все HTTPS ответы локальные, без аккаунта.
// Тайник классов rt.classStash — в ключе stash: смена саба пишет его туда (rt в хранилище без тайника), вкладка и меню видят
// rt.classStash как раньше, запись rt из меню тайник в памяти вкладки не стирает, старое rt.classStash переносит stashMigrate фона.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness(),routeErrors=[];
 const ch=()=>({id:'fixture-hero',name:'AuditHero',revision:100,level:70,l2Profession:'dwarf_bounty_hunter',classBranch:'fighter',classSlots:{activeSlot:1,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:70}]},adena:30000000,inBattle:false,hp:10000,maxHp:10000,mp:1400,maxMp:1400,mobsKilled:0,locationType:'map',inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153},{itemId:728,qty:40}]},activeBuffs:[],activeSummon:null});
 const html='<!doctype html><meta charset="utf-8"><title>Смена саба</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">70</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1400</span><span id="l2-hud-mp-max">1400</span>';
 const mem=()=>h.g.core('({classCur:rt.classCur,skills:rt.skills,classStash:rt.classStash,foo:rt.foo})');
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),p=new URL(q.url()).pathname;
   if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:html});
   if(p==='/character')return r.fulfill({json:{character:ch()}}).catch(()=>{});
   return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture'}}).catch(()=>{})}});
  // Память до обновления: тайник внутри rt; рядом — чужой ключ stash другого героя (не должен подставиться)
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,stash:{char:'Other',v:{elf_x:{t:1}},_src:'x'},cfg:{...cfg,autoTasks:['farm'],taskOnly:false,rbHuntMode:false,rbMode:false,catMode:false,fishMode:false,epicMode:false,autoRoles:false,weaponScanAuto:false,weaponClassEquip:false,petFullAuto:false,petAuto:false,petBuffAuto:false,shopAuto:false,autoMagister:false,tvtOn:false,enemyHunt:false,pvpOnSight:false,townBuffSet:'off',vipBuffAuto:false,faBuffs:'',nBuffs:'',nKeyBuffs:'',searchChamp:false,searchQuest:false,chain:false,potSlotAuto:false,autoShots:false,zoneAuto:false},rt:{...rt,char:'AuditHero',lvl:78,prof:'Arcana lord',classCur:{prof:'human_arcana_lord',slot:0,t:1},classBranch:'mystic',skills:{blaze:{n:7}},classStash:{dwarf_bounty_hunter:{skills:{spoil:{n:3}},t:1}},invClassProof:null,manualKickAt:0,invScan:null,shop:null,magister:null,tbuff:null,rbGo:null,rbHunt:null,zoneGo:null,storyJob:null,mmJob:null,tsJob:null,petBufferTrip:null,petRaidPrep:null,fishSvc:null,fishService:null,dailyFish:null,dailyRb:null,actionOwner:null,revive:null,weaponsT:Date.now(),shopT:Date.now(),target:null}})});
  await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof inventoryReady==="function"'));
  assert.deepEqual(Object.keys((await mem()).classStash),['dwarf_bounty_hunter'],'загрузка: старое rt.classStash видно, чужой ключ stash — нет');
  await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(async()=>{const s=await mem();return s.classCur?.prof==='dwarf_bounty_hunter'&&s.classStash?.human_arcana_lord},18000);
  await until(async()=>(await h.get(['stash'])).stash?.v?.human_arcana_lord,10000);
  const disk=await h.get(['rt','stash']);
  assert.equal('classStash' in disk.rt,false,'rt в хранилище без тайника');
  assert.equal(disk.stash.char,'AuditHero');assert.deepEqual(Object.keys(disk.stash.v),['human_arcana_lord']);assert.equal(disk.stash.v.human_arcana_lord.skills.blaze.n,7);
  let s=await mem();assert.equal(s.skills.spoil.n,3,'память BH вернулась из тайника');assert.deepEqual(Object.keys(s.classStash),['human_arcana_lord']);
  // Запись rt не от этой вкладки (меню) — тайник в памяти вкладки остаётся
  await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,foo:1,_src:'menu'}});});
  await until(async()=>(await mem()).foo===1);s=await mem();assert.equal(s.classStash.human_arcana_lord.skills.blaze.n,7,'после записи меню тайник на месте');
  // Меню показывает память других классов из ключа stash
  await h.popup.reload();await until(()=>h.popup.evaluate(()=>/Память других классов: Arcana Lord/.test(document.getElementById('clsBox')?.textContent||'')),10000);
  await h.click('stop');await until(()=>h.g.core('!on'));await delay(600);
  // Старое rt.classStash (как до обновления) — stashMigrate фона переносит его в ключ, вкладка видит тот же тайник
  await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,classStash:{orc_titan:{t:5}},_src:'old'}});});
  await until(async()=>(await mem()).classStash?.orc_titan);
  assert.equal(await h.sw.evaluate(()=>stashMigrate('проверка')),true);
  const d2=await h.get(['rt','stash']);assert.equal('classStash' in d2.rt,false);assert.deepEqual(d2.stash.v,{orc_titan:{t:5}});
  await delay(300);assert.deepEqual((await mem()).classStash,{orc_titan:{t:5}},'после переноса вкладка видит тот же тайник');
  assert.equal(await h.sw.evaluate(()=>stashMigrate('повтор')),false,'повтор ничего не пишет');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 class stash key: class switch → stash key (rt without classStash), menu rt write keeps tab view, popup shows other classes, legacy rt.classStash migrated once');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
