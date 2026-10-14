'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {integrated}=require('./warlock-combat-fixture.cjs');

test('TvT becoming due during optional buff GET preempts next hunt',async()=>{
 let f;f=integrated({read:(path,e)=>{if(path.includes('catalog')){e.tvtHold=()=>true;f.env.tvtSoon=()=>true;}}});
 await f.combat.battle();assert.equal(f.w.calls.length,0);
 assert.equal(f.events.filter(x=>x==='hunt').length,0,'next main loop must dispatch TvT before another mob');
});

test('lease loss during buff catalog GET stops battle chain',async()=>{
 const f=integrated({read:(path,e)=>{if(path.includes('catalog'))e.tabOwner=false}});
 await f.combat.battle();assert.equal(f.w.calls.length,0);assert.equal(f.events.filter(x=>x==='hunt').length,0);
});

test('feature config cancellation before POST does not stop authorized ordinary hunt',async()=>{
 const f=integrated({read:(path,e)=>{if(path.includes('catalog'))e.cfg.petFullAuto=false}});
 await f.combat.battle();assert.equal(f.w.calls.length,0);assert.equal(f.events.filter(x=>x==='hunt').length,1);
});

test('new same-type pet within paid expiry keeps reserved spend and normal chain',async()=>{
 const f=integrated({char:{adena:'50000000'},cfg:{petFullBudget:30000000}});await f.combat.battle();
 f.w.tick(61000);f.w.ch.activeSummon.activeBuffs=[];f.w.ch.revision++;
 await f.combat.battle();assert.equal(f.w.calls.length,1);assert.equal(f.w.status(),'early-loss');assert.equal(f.events.filter(x=>x==='hunt').length,2);
});

test('captcha during optional buff GET does not fall through to hunt timeout and navigation',async()=>{
 let held=false;const f=integrated({read:(path,e)=>{if(path.includes('catalog')){held=true;e.abHold=()=>true;e.antibotState=()=> 'check'}}});
 f.env.abHold=()=>held;f.env.antibotState=()=>held?'check':null;
 const native=f.env.fire;f.env.fire=b=>held?false:native(b); // actual core fire blocks captcha
 await f.combat.battle();assert.equal(f.w.calls.length,0);assert.equal(f.events.filter(x=>x==='hunt').length,0);
 assert.equal(f.events.filter(x=>x==='map').length,0,'captcha must retain current page');
 assert.equal(f.location.href,undefined);
});
