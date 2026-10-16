'use strict';
// Настоящий MV3/hook; завершённый новичок → принятие Диона → следующая глава → reload/Stop.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let chapter=2;const visits=[];try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,campAuto:false,campaign:false},rt:{...rt,campaignUrl:'/starter-story-quest.html',campaign:{title:'Путь новичка',targets:[{name:'Skeleton',ok:false}]},questSeen:{skeleton:Date.now()},qAlias:{Skeleton:'Skeleton'},campSkipUntil:Date.now()+600000}})});
 const char=()=>({name:'AuditHero',level:24,l2Profession:'human_warrior',revision:100+chapter,hp:2801,maxHp:2801,mp:314,maxMp:314});
 const quest=()=>({stage:'active',chapter,completed:false,minLevel:22,chapterTitleRu:'Глава '+chapter});
 await h.ctx.route('https://l2wap.com/**',async r=>{const p=new URL(r.request().url()).pathname;const json=d=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
 if(p==='/character')return json({character:char()});
 if(p.startsWith('/game/story-quests/dion-campaign'))return json({character:char(),quest:quest()});
 if(p.startsWith('/game/story-quests/starter-saga'))return json({character:char(),quest:{stage:'completed',completed:true}});
 if(p.endsWith('.html')){visits.push(p);const name=chapter===2?'Enku Orc Shaman':'Tumran Bugbear';return r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">24</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Warrior</div><a href="/map.html">Окрестности</a>${p==='/dion-campaign.html'?`<h2 id="dion-campaign-title">Глава ${chapter}</h2><li class="l2-starter-story-target"><strong>${name}</strong> · Lv.20: <span class="l2-starter-story-progress">0 / 35</span><small>Локация: Plains of Dion</small></li>`:'<div id="map-mob-list"></div>'}<script>fetch('/character')</script>`})}
 return json({});});
 await h.g.p.reload();await h.click('start');await until(()=>h.g.core('on && tabOwner'));
 await h.g.p.evaluate(async()=>{await fetch('/game/story-quests/starter-saga/claim-reward',{method:'POST'});await fetch('/game/story-quests/dion-campaign/complete-chapter',{method:'POST'});});
 await until(()=>h.g.core('rt.campaignUrl==="/dion-campaign.html" && rt.dionCampaign?.chapter===2'));
 assert.equal(await h.g.core('Object.keys(rt.qAlias).length'),0);assert.equal(await h.g.core('L2V7Modules.quests.isQuestName("Skeleton")'),false);
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,campaign:true}})});
 await until(()=>h.g.core('rt.campaign?.targets?.[0]?.name === "Enku Orc Shaman"'),20000);
 console.log('PASS MV3 native quest response → new chapter → correct target, no starter loop');
 // 15.10: targets записываются до goOutskirts; ждём конец этапа и доставки Stop, прежде чем выполнять ручной POST.
 await until(()=>h.g.p.url().endsWith('/map.html'),15000);
 await h.click('stop');await until(()=>h.g.core('!on && !running && document.readyState === "complete"'));
 chapter=3;await h.g.p.evaluate(()=>fetch('/game/story-quests/dion-campaign/complete-chapter',{method:'POST'}));
 // Чтение ручного перехода запоминается и на паузе, управление остаётся выключено.
 const before=visits.length;await delay(800);assert.equal(visits.length,before);
 await h.g.p.reload();await h.click('start');await until(()=>h.g.core('on && tabOwner'));
 // 20.4: Start может перейти на страницу главы между проверками. Повторяем только безопасное чтение в готовом документе.
 await until(()=>h.g.p.evaluate(()=>{if(document.readyState!=='complete')return false;fetch('/game/story-quests/dion-campaign').catch(()=>{});return true;}));
 await until(async()=>(await h.get(['rt'])).rt.campaign?.targets?.[0]?.name === 'Tumran Bugbear',20000);await h.click('stop');
 assert.ok(!visits.includes('/starter-story-quest.html'));assert.deepEqual(h.errors,[]);console.log('PASS MV3 next chapter, Stop, reload, no old quest revisit');
 }catch(e){console.error('DIAG',JSON.stringify({visits,chapter,state:await h.get(['on','rt']).then(x=>({on:x.on,campaign:x.rt.campaign,url:x.rt.campaignUrl,dion:x.rt.dionCampaign,status:x.rt.status,errors:x.rt.errors}))}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
