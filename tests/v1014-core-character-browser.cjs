'use strict';
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 await h.ctx.route('https://l2wap.com/map.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><div id="l2-hud-legacy-name">—</div><div id="l2-nav-bottom"></div><div id="map-mob-list"></div><script>setTimeout(()=>document.getElementById("l2-hud-legacy-name").textContent="AuditHero",5000)</script>'}));
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({on:false,rt:{...rt,char:'',auditKeep:17},'rt@AuditHero':{...rt,char:'AuditHero',auditKeep:99},'cfg@AuditHero':{...cfg,rbHuntMode:true,fishMode:false,taskOnly:false}})});
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof heroNick==="function"'));await delay(500);
 console.log('PRE',JSON.stringify(await h.get(['rt']).then(s=>({char:s.rt.char,keep:s.rt.auditKeep}))));
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('[data-auto-task=fish]')?.onchange));await h.click('fishToggle');
 await until(async()=>{const s=await h.get(['rt']);return s.rt.char==='AuditHero'},15000);await delay(1000);
 const s=await h.get(['rt','cfg']);console.log('POST',JSON.stringify({char:s.rt.char,fish:s.cfg.fishMode,raid:s.cfg.rbHuntMode,keep:s.rt.auditKeep}));
 assert.equal(s.cfg.fishMode,true,'выбранная рыбалка не должна заменяться старым cfg@герой после HUD placeholder');assert.equal(s.cfg.rbHuntMode,false);assert.equal(s.rt.auditKeep,17,'initial memory сохраняется без фиктивного переключения');
 await h.click('stop');await until(()=>h.g.core('!on && !running'));
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({'rt@OtherHero':{...rt,char:'OtherHero',auditKeep:55},'cfg@OtherHero':{...cfg,fishMode:false,taskOnly:true}})});
 await h.g.p.bringToFront(); await h.g.p.evaluate(()=>document.querySelector('#l2-hud-legacy-name').textContent='OtherHero');await h.g.core('switchChar()');
 const other=await h.get(['rt','cfg']);assert.equal(other.rt.char,'OtherHero');assert.equal(other.rt.auditKeep,55);assert.equal(other.cfg.taskOnly,true);assert.equal(other.cfg.fishMode,false);console.log('PASS настоящая смена героя загружает его память и режим');
 assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
