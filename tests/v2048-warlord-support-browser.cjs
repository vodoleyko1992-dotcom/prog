'use strict';
// 20.48: настоящее MV3/content, локальный DOM панели и разрешённый обезличенный ответ одного РБ22.10.
// Главный цикл выключен; suggestRoles/ilOf/ready/combatCooldown настоящие. observe вызывается стендом, не реальным игровым POST.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const fixture=require('./fixtures/warlord-cooldowns-20261022.json'),proof=[],routeErrors=[],seen=[];
const spawn=fixture.cases[0].request.battleSpawnId;
const skills=[['roar','battle_roar','Бойовий рик (Battle Roar)'],['lion','lionheart','Левине серце (Lionheart)'],
 ['spin','whirlwind','Вихор (Whirlwind)'],['sweep','wild_sweep','Дикий розмах (Wild Sweep)'],
 ['storm','thunder_storm','Грозова буря (Thunder Storm)'],['focus','focus_attack','Фокусована атака (Focus Attack)']];
const html='<!doctype html><meta charset="utf-8"><title>Warlord local support</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div>'
 +'<div id="character-profession">Warlord</div><span id="l2-hud-legacy-lvl">45</span><span id="l2-hud-hp-cur">8000</span><span id="l2-hud-hp-max">8000</span>'
 +'<span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span><div id="battle-mob-title">Flamestone Golem · ур.44</div><div id="battle-mob-hp-val">500000 / 500000</div>'
 +skills.map(([id,cd,title],i)=>`<button id="${id}" class="l2-battle-hotbar-slot" data-slot-idx="${i}" title="${title}"><span data-slot-cd="${cd}" hidden></span></button>`).join('');
(async()=>{
 const h=await harness({withPopup:false});
 try{
  await h.sw.evaluate(async()=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['farm'],autoRoles:false,combatProfile:'fighter',dailyKillLimit:0,rec:false,netLog:false,autoMagister:false},rt:{...rt,char:'AuditHero',lvl:45,prof:'human_warlord',classCur:{prof:'human_warlord',slot:3},skills:{},skillDb:{},panel:null,target:null,cdUntil:{},cdUse:{},weaponsT:Date.now()}})});
  await h.ctx.route('https://l2wap.com/**',route=>{
   const q=route.request(),p=new URL(q.url()).pathname;seen.push({method:q.method(),path:p});
   if(q.method()!=='GET'){routeErrors.push(q.method()+' '+p);return route.fulfill({status:405,json:{error:'fixture_rejects_posts'}});}
   if(p==='/battle.html')return route.fulfill({contentType:'text/html',body:html});
   if(p==='/local-warlord-fixture.json')return route.fulfill({json:fixture});
   return route.fallback();
  });
  await h.g.p.goto('https://l2wap.com/battle.html?spawnId='+spawn);
  await until(()=>h.g.core('!on&&isBattle()&&rt.prof==="human_warlord"&&panelInventory().length===6'));
  const aliases=await h.g.core('({roar:ilOf(document.getElementById("roar")),lion:ilOf(document.getElementById("lion")),focus:ilOf(document.getElementById("focus"))})');
  assert.equal(aliases.roar.id,121);assert.equal(aliases.lion.id,287);assert.equal(aliases.focus.id,317);
  proof.push({case:'actual native localized DOM resolves support IDs',pass:true,ids:{roar:aliases.roar.id,lion:aliases.lion.id,focus:aliases.focus.id}});
  console.log('PASS MV3 localized native support DOM→121/287, Focus→317');
  const roles=await h.g.core('L2V7Modules.equipment.suggestRoles().roles');
  const names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
  assert.deepEqual(names(roles.nHeal),['бойовий рик']);assert.deepEqual(names(roles.nBuffs),['левине серце']);
  // 20.49: Focus — отдельный тоггл ON-only; обычные баффы/удары его не переключают.
  for(const k of ['nPower','nStun','nBuffs','nHeal'])assert.ok(!names(roles[k]).includes('фокусована атака'),'Focus только в роли тогглов: '+k);
  assert.ok(names(roles.nToggles).includes('фокусована атака'));
  assert.ok(names(roles.nPower).includes('вихор'));assert.ok(names(roles.nPower).includes('дикий розмах'));
  assert.ok(!names(roles.nPower).includes('бойовий рик'));assert.ok(!names(roles.nPower).includes('левине серце'));
  proof.push({case:'actual suggestRoles assigns heal/buff and managed Focus toggle role',pass:true,roles});
  console.log('PASS MV3 actual suggestRoles: Roar heal, Lionheart buff, damage skills retained, Focus managed toggle');
  // Fetch действительно выполняется Chromium; route возвращает только сохранённую безопасную fixture, реальной сети нет.
  const rows=await h.g.p.evaluate(async()=>{const r=await fetch('/local-warlord-fixture.json');return(await r.json()).cases});
  async function observe(action,id){
   const row=rows.find(x=>x.request.action===action);assert.ok(row);
   const r=await h.g.core(`(()=>{combatCooldown.observe(${JSON.stringify(row.request)},${JSON.stringify(row.response)},${row.status},${JSON.stringify(spawn)});return{wait:combatCooldown.skillWait(${JSON.stringify(action)},${JSON.stringify(spawn)}),numeric:combatCooldown.skillWait(${JSON.stringify(row.canonical)},${JSON.stringify(spawn)}),known:combatCooldown.skillKnown(${JSON.stringify(action)},${JSON.stringify(spawn)}),ready:L2V7Modules.combat.ready(document.getElementById(${JSON.stringify(id)})),snapshot:combatCooldown.snapshot()}})()`);
   const expected=row.response.delta.skillCooldowns[row.canonical]-row.response.serverNowMs+40;
   assert.equal(r.known,true);assert.equal(r.wait,r.numeric);assert.ok(r.wait>expected-250&&r.wait<=expected);assert.equal(r.ready,false);
   proof.push({case:'actual server '+action+' native/numeric deadline and DOM ready',pass:true,expectedMs:expected,state:r});console.log('PASS MV3 actual server deadline/ready',action,JSON.stringify({expected,wait:r.wait,numeric:r.numeric,ready:r.ready}));return{row,r};
  }
  await observe('wild_sweep','sweep');
  const roar=await observe('battle_roar','roar');assert.ok(roar.r.wait>170000,'явный178с не обрезан до120с');
  await observe('lionheart','lion');
  const before=await h.g.core('combatCooldown.snapshot()');await delay(80);
  await h.g.core(`combatCooldown.observe(${JSON.stringify(roar.row.request)},${JSON.stringify(roar.row.response)},${roar.row.status},${JSON.stringify(spawn)})`);
  const after=await h.g.core('combatCooldown.snapshot()');assert.equal(after.skillUntil.l2_121,before.skillUntil.l2_121);
  proof.push({case:'replayed old raw response does not extend long Roar timer',pass:true,until:after.skillUntil.l2_121});console.log('PASS MV3 replay does not extend178s Roar');
  const foreign={...roar.row.request,battleSpawnId:'old_foreign_spawn'};
  await h.g.core(`combatCooldown.observe(${JSON.stringify(foreign)},${JSON.stringify(roar.row.response)},200,${JSON.stringify(spawn)})`);
  assert.deepEqual(await h.g.core('combatCooldown.snapshot()'),after);
  proof.push({case:'foreign spawn response leaves current cooldowns intact',pass:true});console.log('PASS MV3 foreign-spawn response ignored');
  assert.equal(await h.g.core('on'),false);assert.equal(seen.some(x=>x.method==='POST'),false);assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);
  const report={browser:h.ctx.browser()?.version(),extensionVersion:await h.sw.evaluate(()=>chrome.runtime.getManifest().version),kind:'actual MV3/content with main OFF; native DOM/roles/ready/model; saved raw response supplied through controlled observe call',liveGame:false,cases:proof.length,proof,postRequests:seen.filter(x=>x.method==='POST').length,pageErrors:h.errors,routeErrors};
  if(process.env.WARLORD_SUPPORT_BROWSER_REPORT)fs.writeFileSync(path.resolve(process.env.WARLORD_SUPPORT_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify(report));
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
