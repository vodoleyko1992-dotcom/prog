'use strict';
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'), assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 // 15.10: рейд сначала сверяет собственную сумку. Общий lifecycle harness даёт
 // пустой JSON; здесь нужен контракт /character, а не обход startup-проверки.
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({character:{id:'audit-hero',name:'AuditHero',revision:1,inventory:{stacks:[],eq:{}}}})}));
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,weaponsT:0,invScan:{step:'prof',back:'/map.html',t:Date.now()}}})});
 await h.g.p.goto('https://l2wap.com/fishing.html');await until(()=>h.g.core('typeof invScanDrive==="function"'));await delay(1800);
 assert.equal(new URL(h.g.p.url()).pathname,'/fishing.html','off automatic scan не должен увести рыбалку после reload');assert.equal((await h.get(['rt'])).rt.weaponsT,0);
 console.log('PASS Stop + reload не возобновляет автоматический scan');
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,invScan:null}})});
 await h.sw.evaluate(async()=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,weaponsT:0}})});
 await h.click('weapScan');await until(async()=>!!(await h.get(['rt'])).rt.invScan);const route=[];
 await until(async()=>{const {rt}=await h.get(['rt']);const state={page:new URL(h.g.p.url()).pathname,step:rt.invScan?.step||'',weaponsT:!!rt.weaponsT};if(JSON.stringify(state)!==JSON.stringify(route.at(-1)))route.push(state);return !rt.invScan&&rt.weaponsT},25000);
 assert.equal((await h.get(['on'])).on,false);console.log('PASS manual inventory off → profession → bag → return',JSON.stringify(route));
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({rt:{...rt,weaponsT:0,invTourT:0,invScan:null},cfg:{...cfg,weaponScanAuto:true}})});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#huntToggle')?.onclick));await h.click('huntToggle');
 await until(async()=>!!(await h.get(['rt'])).rt.invScan);const raidRoute=[];for(let i=0;i<30;i++){const {rt,on}=await h.get(['rt','on']);const state={page:new URL(h.g.p.url()).pathname,step:rt.invScan?.step||'',weaponsT:!!rt.weaponsT,raid:rt.rbHunt?.step,status:rt.status,on};if(JSON.stringify(state)!==JSON.stringify(raidRoute.at(-1)))raidRoute.push(state);if(rt.weaponsT)break;await delay(400)}
 console.log('RAID ROUTE',JSON.stringify(raidRoute));console.log('ERRORS',JSON.stringify(h.errors));const state=await h.get(['rt']);assert.ok(state.rt.weaponsT,'raid initial inventory must complete before hunt continues');
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
