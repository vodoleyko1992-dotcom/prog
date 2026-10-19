'use strict';
// Настоящий /game/time → hook → content → background → popup; все HTTPS ответы локальные.
const assert=require('node:assert/strict'),{harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 let serverNow=Date.parse('2026-10-19T12:00:00Z');
 await h.ctx.route('https://l2wap.com/game/time',r=>r.fulfill({json:{serverNowMs:serverNow,timeZone:'Europe/Kyiv',gameDayKey:'20261019',nextDailyResetAt:Date.parse('2026-10-19T21:00:00Z')}}));
 await h.click('start');await until(()=>h.g.core('on&&tabOwner'));
 await h.g.p.evaluate(()=>fetch('/game/time'));
 await until(async()=>(await h.get(['rt'])).rt.serverClock?.gameDayKey==='2026-10-19');
 await h.sw.evaluate(async()=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:[],taskOnly:true,dailyKillLimit:8000,dailyFishLimit:1511,limitRanges:{dailyFishLimit:{min:1511,max:1564}}},rt:{...rt,dailyQuota:{basis:'server',day:'2026-10-19',auto:7000,cat:500,raid:500,fish:1511},limitRolls:{dailyFishLimit:{basis:'server',day:'2026-10-19',min:1511,max:1564,value:1511,seq:7}}}})});
 await until(()=>h.g.core('rt.dailyQuota?.auto===7000'));
 assert.equal(await h.g.core('L2EngineCore.dailyBlocked(cfg,rt,"auto")'),true);
 serverNow=Date.parse('2026-10-19T20:59:55Z');await h.g.p.evaluate(()=>fetch('/game/time'));
 await until(()=>h.g.core('rt.serverClock?.serverNowMs===Date.parse("2026-10-19T20:59:55Z")'));
 assert.equal(await h.g.core('L2EngineCore.dailyBlocked(cfg,rt,"auto")'),true);
 await until(()=>h.g.core('L2EngineCore.dailyDay(Date.now(),rt)==="2026-10-20"'),10000);
 assert.equal(await h.g.core('L2EngineCore.dailyBlocked(cfg,rt,"auto")'),false);
 assert.equal(await h.g.core('syncLimitRanges()'),true);
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.dailyQuota?.day==='2026-10-20'&&rt.limitRolls?.dailyFishLimit?.seq===8});
 const{rt,cfg}=await h.get(['rt','cfg']);assert.equal(rt.dailyQuota.auto+rt.dailyQuota.cat+rt.dailyQuota.raid+rt.dailyQuota.fish,0);assert.ok(cfg.dailyFishLimit>=1511&&cfg.dailyFishLimit<=1564);
 await h.popup.reload();await h.openTab('limits');await until(()=>h.popup.locator('#dailyLimitsDay').textContent().then(s=>s.includes('2026-10-20')));
 assert.match(await h.popup.locator('#dailyLimitsDay').textContent(),/время сервера/);assert.match(await h.popup.locator('#mobsDailyProgress').textContent(),/^0 \/ 8000/);
 await h.click('stop');assert.deepEqual(h.errors,[]);console.log('PASS actual MV3 server clock offset → midnight → both quotas reset → one daily reroll → popup reload');
 }finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
