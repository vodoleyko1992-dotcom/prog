'use strict';
const assert=require('node:assert/strict'),{harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.click('start');await until(()=>h.g.core('on && tabOwner'));
 await h.g.p.evaluate(()=>{const layer=document.createElement('div');layer.id='l2-antibot-layer';layer.innerHTML='<div class="l2-antibot-card__options">Проверку решает игрок</div>';document.body.append(layer);window.__scrolls=0;document.querySelector('#probe').scrollIntoView=()=>window.__scrolls++});
 await h.g.core('setRt({abChal:{t:Date.now(),id:"fixture-active"}})');
 const before=h.g.p.url();const got=await h.g.core('(async()=>{const click=fire(document.querySelector("#probe"));actionLocation.href="/char.html";actionLocation.reload();const r=await gameGet("/game/time");return {click,status:r.status,hold:abHold()}})()');
 assert.equal(got.click,false);assert.equal(got.status,423);assert.equal(got.hold,true);assert.equal(h.g.p.url(),before);assert.equal(await h.g.p.evaluate(()=>window.__scrolls),0);
 await h.click('stop');await h.click('start');await until(()=>h.g.core('on && tabOwner'));assert.ok((await h.get(['rt'])).rt.abChal,'Start не доказывает решение проверки');
 await h.g.core('abNet("/game/antibot/challenge",{passed:true})');await h.g.p.evaluate(()=>document.querySelector('#l2-antibot-layer').remove());await until(async()=>!(await h.get(['rt'])).rt.abChal);await h.click('stop');
 assert.deepEqual(h.errors,[]);console.log('PASS actual MV3: CAPTCHA prevents scroll/click/navigation/reload/fetch, survives Stop/Start, clears only confirmed passed');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
