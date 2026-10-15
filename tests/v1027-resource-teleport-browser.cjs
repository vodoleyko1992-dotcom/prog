'use strict';
// Настоящие MV3, dispatcher, hook, native fetch/navigation. Только сервер/DOM — локальные фикстуры.
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let posts=0,city='l2dop_dion',revision=100;try{
 const character=()=>({id:'fixture-hero',name:'AuditHero',level:75,hp:10000,maxHp:10000,mp:1000,maxMp:1000,adena:1000000,revision,cityId:city,currentZoneId:null,activeDungeonId:null,inBattle:false});
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/character')return r.fulfill({contentType:'application/json',body:JSON.stringify({character:character()})});
  if(p==='/game/farm-guide/resource-teleport'){
   const req=r.request().postDataJSON(),state=(await h.get(['rt'])).rt;
   assert.deepEqual(req,{teleportId:'heine',expectedRevision:100,expectedAdenaCost:50000});
   assert.ok(state.zoneGo.forumTp.sentAt,'pending persisted before native POST');assert.equal(state.actionOwner?.key,'zoneGo');
   posts++;city='l2dop_heine';revision++;
   return r.fulfill({contentType:'application/json',body:JSON.stringify({character:character()})});
  }
  if(p==='/forum-farm-resources.html'||p==='/map.html')return r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div><button data-teleport-id="heine" data-base-adena-cost="50000" data-adena-cost="50000">Телепорт 50 000 Adena</button><script>localStorage.setItem('token','fixture');document.querySelector('button').onclick=async()=>{const r=await fetch('/game/farm-guide/resource-teleport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teleportId:'heine',expectedRevision:100,expectedAdenaCost:50000})});await r.json();location.href='/map.html';};</script>`});
  return r.fallback();
 });
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({cfg:{...cfg,shopReserve:200000},rt:{...rt,zoneGo:{id:'heine',url:'/forum-farm-resources.html',forum:true,t:Date.now()},zoneGoT:0,zoneCat:{heine:{name:'Heine'}}}})});
 await h.g.p.goto('https://l2wap.com/forum-farm-resources.html');await until(()=>h.g.core('!!rt.zoneGo'));await h.click('start');
 await until(()=>posts===1,20000);await until(()=>h.g.p.url().endsWith('/map.html'));await until(async()=>!(await h.get(['rt'])).rt.zoneGo,20000);
 await delay(2500);assert.equal(posts,1);assert.equal((await h.get(['rt'])).rt.zone,'heine');
 await h.g.p.reload();await until(()=>h.g.core('on && tabOwner'),20000);await delay(1000);assert.equal(posts,1);
 await h.click('stop');await until(()=>h.g.core('!on'));assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 native resource teleport → reload map → dispatcher → no repeated payment; persisted owner/intent verified');
 }catch(e){console.error('DIAG',JSON.stringify({posts,city,url:h.g.p.url(),errors:h.errors,state:await h.get(['on','rt']).then(x=>({on:x.on,zoneGo:x.rt.zoneGo,owner:x.rt.actionOwner,status:x.rt.status}))}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
