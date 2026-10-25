'use strict';
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): настоящие MV3/фон/вкладка/меню, все HTTPS ответы локальные, без аккаунта.
// Тайник классов rt.classStash — в ключе stash: смена саба пишет его туда (rt в хранилище без тайника), вкладка и меню видят
// rt.classStash как раньше, запись rt из меню тайник в памяти вкладки не стирает, старое rt.classStash переносит stashMigrate фона
// (ревью 20.62: по классам поверх ключа — откат на старую сборку не стирает классы ключа). Затем обычная загрузка страницы берёт
// тайник уже только из ключа stash, и смена саба обратно возвращает память класса из него.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness(),routeErrors=[];let slot=1;
 const ch=()=>({id:'fixture-hero',name:'AuditHero',revision:slot?100:101,level:slot?70:78,l2Profession:slot?'dwarf_bounty_hunter':'human_arcana_lord',classBranch:slot?'fighter':'mystic',classSlots:{activeSlot:slot,slots:[{slot:0,profession:'human_arcana_lord',active:!slot,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:!!slot,owned:true,level:70}]},adena:30000000,inBattle:false,hp:10000,maxHp:10000,mp:1400,maxMp:1400,mobsKilled:0,locationType:'map',inventory:{eq:{l1:{itemId:97,enchant:0}},stacks:[{itemId:1465,qty:4153},{itemId:728,qty:40}]},activeBuffs:[],activeSummon:null});
 const page=()=>html.replace('>70<',slot?'>70<':'>78<').replace('Bounty Hunter',slot?'Bounty Hunter':'Arcana Lord');
 const html='<!doctype html><meta charset="utf-8"><title>Смена саба</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">70</div><div id="character-profession">Bounty Hunter</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1400</span><span id="l2-hud-mp-max">1400</span>';
 const mem=()=>h.g.core('({classCur:rt.classCur,skills:rt.skills,classStash:rt.classStash,foo:rt.foo})');
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),p=new URL(q.url()).pathname;
   if(p.endsWith('.html'))return r.fulfill({contentType:'text/html',body:page()});
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
  // Старое rt.classStash (как пишет сборка без ключа stash: тайник с {} — только orc_titan) — stashMigrate фона переносит его в ключ
  // по классам: human_arcana_lord, что лежит только в ключе, остаётся (ревью 20.62)
  await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,classStash:{orc_titan:{t:5}},_src:'old'}});});
  await until(async()=>(await mem()).classStash?.orc_titan);
  assert.deepEqual(Object.keys((await mem()).classStash).sort(),['human_arcana_lord','orc_titan'],'вкладка: старое поле по классам поверх своего тайника');
  assert.equal(await h.sw.evaluate(()=>stashMigrate('проверка')),true);
  const d2=await h.get(['rt','stash']);assert.equal('classStash' in d2.rt,false);assert.deepEqual(Object.keys(d2.stash.v).sort(),['human_arcana_lord','orc_titan']);
  assert.deepEqual(d2.stash.v.orc_titan,{t:5});assert.equal(d2.stash.v.human_arcana_lord.skills.blaze.n,7,'класс только из ключа не стёрт');
  await delay(300);assert.deepEqual((await mem()).classStash,d2.stash.v,'после переноса вкладка видит тот же тайник');
  assert.equal(await h.sw.evaluate(()=>stashMigrate('повтор')),false,'повтор ничего не пишет');
  // Обычная загрузка страницы после обновления: rt в хранилище без тайника — вкладка собирает rt.classStash из ключа stash
  await h.g.p.reload();await until(()=>h.g.core('typeof inventoryReady==="function"'));
  const d3=await h.get(['rt','stash']);assert.equal('classStash' in d3.rt,false,'rt на диске по-прежнему без тайника');
  assert.deepEqual((await mem()).classStash,d3.stash.v,'загрузка: тайник из ключа stash');
  // Смена саба обратно (Arcana Lord) после загрузки из ключа — память класса возвращается из тайника, BH уходит в ключ
  slot=0;await h.popup.reload();await h.g.p.bringToFront();await h.click('start');
  await until(async()=>(await mem()).classCur?.prof==='human_arcana_lord',18000);
  s=await mem();assert.equal(s.skills.blaze.n,7,'память Arcana Lord вернулась из ключа');assert.deepEqual(Object.keys(s.classStash).sort(),['dwarf_bounty_hunter','orc_titan']);
  await until(async()=>(await h.get(['stash'])).stash?.v?.dwarf_bounty_hunter,10000);
  const d4=await h.get(['rt','stash']);assert.equal('classStash' in d4.rt,false);assert.deepEqual(Object.keys(d4.stash.v).sort(),['dwarf_bounty_hunter','orc_titan']);
  assert.equal(d4.stash.v.dwarf_bounty_hunter.skills.spoil.n,3,'память BH — в ключе');assert.equal(d4.rt.skills.blaze.n,7);
  await h.click('stop');await until(()=>h.g.core('!on'));await delay(300);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 class stash key: class switch → stash key (rt without classStash), menu rt write keeps tab view, popup shows other classes, legacy rt.classStash merged per class into key once, page reload boots from stash key, switch back restores class memory');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
