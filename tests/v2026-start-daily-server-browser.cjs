'use strict';
// Настоящий Старт → GET времени/дейликов → durable квота → меню; аккаунт не используется.
const assert=require('node:assert/strict'),{harness,until}=require('./v1014-core-lifecycle-browser.cjs'),fixture=require('./tools/daily-server-fixture.cjs');
(async()=>{const h=await harness();try{
 let d=fixture();d.daily.tasks.hunt_start_500.score=8055;d.daily.tasks.hunt_start_500.have=500;d.daily.tasks.fishing_catch_50.score=1600;d.daily.tasks.fishing_catch_50.have=50;d.daily.tasks.damage_dealer_500k.score=39087476;
 const gets=[],posts=[];h.ctx.on('request',r=>{if(r.url().startsWith('https://')&&r.method()==='POST')posts.push(new URL(r.url()).pathname)});
 await h.ctx.route('https://l2wap.com/game/time',r=>{gets.push('time');return r.fulfill({json:d.clock})});
 await h.ctx.route('https://l2wap.com/game/daily-quests',r=>{gets.push('daily');return r.fulfill({json:d.daily})});
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:['fish','auto'],dailyAuto:false,dailyFishLimit:1511,dailyKillLimit:8000,limitRanges:{},autoKillLimit:0}})});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.click('start');
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.dailyServerCheck&&rt.dailyQuota?.server===8055});
 const s=await h.get(['rt','cfg','on']);assert.equal(s.on,true);assert.equal(s.rt.dailyQuota.fish,1600);assert.equal(Object.keys(s.rt.daily.tasks).length,8);assert.equal(s.rt.daily.tasks.damage_dealer_500k.score,39087476);assert.deepEqual(s.cfg.autoTasks,['fish','auto']);
 assert.equal(await h.g.core('L2EngineCore.selectedTask(cfg,rt)'),'tasks');assert.deepEqual(posts,[]);
 await h.openTab('limits');await until(()=>h.popup.locator('#mobsDailyProgress').textContent().then(t=>t.includes('8055 / 8000')));assert.match(await h.popup.locator('#fishDailyProgress').textContent(),/1600 \/ 1511/);
 const n=gets.length;await h.g.p.reload();await until(()=>h.g.core('on&&tabOwner&&running'));assert.equal(await h.g.core('dailyServerSync()'),true);assert.equal(gets.length,n,'reload не повторяет проверку того же старта');
 await h.click('stop');d.daily.tasks.hunt_start_500.score=8056;d.daily.tasks.fishing_catch_50.score=1601;await h.click('start');
 await until(async()=>(await h.get(['rt'])).rt.dailyQuota?.server===8056);assert.equal((await h.get(['rt'])).rt.dailyQuota.fish,1601);assert.ok(gets.length>=n+2);assert.deepEqual(posts,[]);
 await h.click('stop');assert.deepEqual(h.errors,[]);console.log('PASS actual Start: score8055/1600 + all8tasks → both quotas blocked before0POST → reload reuses → new Start rereads8056/1601 without double counting');
 }catch(e){console.error('DIAG',await h.g.core('({on,running,tabOwner,status:rt.status,start:rt.dailyStart,check:rt.dailyServerCheck,quota:rt.dailyQuota})').catch(String));throw e}finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
