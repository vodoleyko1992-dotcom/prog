'use strict';
// Настоящий MV3 dispatcher: глава Диона не уступает ежедневной рыбалке. Все ответы локальные.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
// 20.54 (прогон смоуков 23.10): с 20.43 (PR #325) у Warlock перед квестами/фармом идёт подготовка «кот → баффы» до 2 мин;
// здесь проверяется только диспетчер дейликов/кампании, поэтому автопризыв кота выключен, как в v1027-campaign-location.
(async()=>{const h=await harness();try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,dailyAuto:true,campaign:true,petAuto:false},rt:{...rt,campaign:{title:'Глава 3/10',targets:[{name:'Ol Mahum Guerilla',done:24,total:40,ok:false},{name:'Ol Mahum Raider',done:28,total:40,ok:false}]},campaignDue:false,campSkipUntil:Date.now()+600000,daily:{day:'20261015',t:Date.now(),tasks:{fishing_catch_50:{have:0,need:50,done:false}}}}})});
 await h.g.p.reload();await until(()=>h.g.core('cfg.campaign && rt.daily?.tasks?.fishing_catch_50?.need===50'));
 // Только счётчик вызовов: решение и запись состояния выполняет настоящий модуль через настоящий dispatcher.
 await h.g.core('window.__dailyCalls=0;window.__dailyOriginal=L2V7Modules.dailies.dailyStep;L2V7Modules.dailies.dailyStep=async(...a)=>{window.__dailyCalls++;return window.__dailyOriginal(...a)};true');
 await h.click('start');await until(()=>h.g.core('on && tabOwner && window.__dailyCalls>=1'),20000);
 await delay(1500);let s=await h.get(['cfg','rt']);assert.equal(!!s.cfg.fishMode,false);assert.ok(!s.rt.dailyFish);assert.ok(!h.requests.some(r=>r.path==='/fishing.html'));
 console.log('PASS MV3 campaign 24/40, 28/40 → dispatcher tick → no fishing or training');
 await h.click('stop');await until(()=>h.g.core('!on'));
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,fishMode:true},rt:{...rt,dailyFish:{day:'20261015',t:Date.now(),need:50,got:0,entering:false,prev:{fishMode:false,zoneAuto:false,rbHuntMode:false,epicMode:false,catMode:false}}}})});
 await h.g.p.goto('https://l2wap.com/fishing.html');await until(()=>h.g.core('!on && !!rt.dailyFish'));await h.click('start');
 await until(async()=>{const x=await h.get(['cfg','rt']);return !x.cfg.fishMode&&x.rt.dailyFish===null},20000);
 await until(()=>h.g.p.url().endsWith('/map.html'));await h.click('stop');await delay(300);
 s=await h.get(['cfg','rt']);assert.equal(s.cfg.campaign,true);assert.equal(s.rt.campaign.targets[0].done,24);assert.equal(s.rt.campaign.targets[1].done,28);
 assert.ok(!h.requests.some(r=>r.method==='POST'&&r.path.startsWith('/game/fishing/')));assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 reload active legacy dailyFish → former mode restored, quest progress retained, no fishing POST');
 // Без кампании неподготовленная рыбалка всё равно не должна тратить SP/адену на открытие.
 let checks=0;await h.ctx.route('https://l2wap.com/game/fishing/state',r=>{checks++;return r.fulfill({contentType:'application/json',body:JSON.stringify({unlocked:false,fishingSpot:{purchased:false},fishingTime:{canFish:false,remainingMs:0}})})});
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,campaign:false,fishMode:false},rt:{...rt,dailyFish:null,dailyFishCheck:null,dailyDone:{}}})});
 const n=h.requests.filter(r=>r.path==='/fishing.html').length;
 await h.g.p.reload();await h.click('start');await until(()=>checks>0);await until(async()=>!!(await h.get(['rt'])).rt.dailyFishCheck);await delay(500);await h.click('stop');
 s=await h.get(['cfg','rt']);assert.equal(!!s.cfg.fishMode,false);assert.ok(!s.rt.dailyFish);assert.equal(h.requests.filter(r=>r.path==='/fishing.html').length,n);assert.equal(checks,1);
 assert.ok(!h.requests.some(r=>r.method==='POST'&&r.path.startsWith('/game/fishing/')));assert.deepEqual(h.errors,[]);
 console.log('PASS MV3 daily preflight: untrained/unpaid fishing → one GET, no detour, no training or purchase');
 }catch(e){console.error('DIAG',JSON.stringify({state:await h.get(['cfg','rt','on']).then(x=>({on:x.on,campaign:x.cfg.campaign,fishMode:x.cfg.fishMode,dailyFish:x.rt.dailyFish,status:x.rt.status})),url:h.g.p.url(),errors:h.errors,requests:h.requests.slice(-12)}));throw e;}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
