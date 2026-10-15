'use strict';
// Реальные MV3/main/оплата/бой, локальные ответы вместо сети игры.
const assert=require('node:assert/strict');
const {journey,bosses,until,delay}=require('./v1029-raid-live-targets-fixture.cjs');
async function test(kind){const f=await journey({travel:true,tvtSoon:kind==='tvt',dead:kind==='dead',forbidden:kind==='level',unknownPrice:kind==='price',noFunds:kind==='funds',unknownModel:kind==='unknown-model',lostKind:kind==='pending'?'raid':null});try{
 if(kind==='tvt'){f.S.register=true;await f.h.g.p.evaluate(()=>fetch('/game/tvt'));}
 await f.start();
 if(['poor-model','unknown-model'].includes(kind)){
  await until(()=>f.events.some(e=>e.kind==='win'),40000);await f.h.click('stop');
  assert.deepEqual(f.S.teleports,[bosses[0].id]);assert.deepEqual(f.events.filter(e=>e.kind==='engage').map(e=>e.id),[bosses[0].id]);assert.deepEqual(f.S.wins,[bosses[0].id]);
  assert.ok(f.events.findIndex(e=>e.kind==='teleport')<f.events.findIndex(e=>e.kind==='engage'));
 }else if(kind==='pending'){
  await until(async()=>f.S.teleports.length===1&&!!(await f.h.get(['rt'])).rt.actionPayments?.pending,40000);
  await f.h.g.p.reload();await until(()=>f.h.g.core('on&&tabOwner'));await delay(2500);await f.h.click('stop');
  assert.equal(f.S.teleports.length,1);assert.equal((await f.h.get(['rt'])).rt.actionPayments.pending.kind,'raid-teleport');assert.ok(!f.events.some(e=>e.kind==='engage'));
 }else{
  if(kind==='tvt')await until(()=>f.S.registered,20000);
  else await until(async()=>{const rt=(await f.h.get(['rt'])).rt;return rt.rbTourView?.at||rt.rbHuntIdle>Date.now();},20000);
  if(kind!=='tvt'){const reason={dead:'dead',level:'above',price:'currency',funds:'funds'}[kind];await until(async()=>(await f.h.get(['rt'])).rt.rbTourView?.blocked?.some(x=>x.id===bosses[0].id&&x.kind===reason),15000);}
  await delay(2000);await f.h.click('stop');assert.equal(f.S.teleports.length,0);assert.ok(!f.events.some(e=>e.kind==='engage'));
 }
 assert.deepEqual(f.routeErrors.map(e=>e.message),[]);assert.deepEqual(f.h.errors,[]);console.log('PASS ordinary live raid '+kind,JSON.stringify({events:f.events,paths:f.paths}));
}catch(e){console.error('DIAG '+kind,JSON.stringify(await f.diag()));throw e;}finally{await f.close();}}
(async()=>{for(const kind of(process.env.RAID_CASES||'poor-model,unknown-model,dead,level,price,funds,pending,tvt').split(','))await test(kind);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
