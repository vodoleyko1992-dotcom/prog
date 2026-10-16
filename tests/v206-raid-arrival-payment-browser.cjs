'use strict';
// Настоящее MV3/main, локальные HTML/API: прилёт к РБ, который существует только ссылкой.
const assert=require('node:assert/strict');
const {journey,bosses,until}=require('./v1029-raid-live-targets-fixture.cjs');
(async()=>{const f=await journey({travel:true,listOnly:true});try{
 await f.start();await until(()=>f.events.some(e=>e.kind==='win'),45000);
 await until(async()=>{const rt=(await f.h.get(['rt'])).rt;return !rt.actionPayments?.pending&&rt.rbHunt?.step!=='fight';},20000);
 await f.h.click('stop');assert.deepEqual(f.S.teleports,[bosses[0].id]);assert.deepEqual(f.S.wins,[bosses[0].id]);assert.deepEqual(f.events.filter(e=>e.kind==='engage').map(e=>e.id),[bosses[0].id]);
 assert.deepEqual(f.routeErrors.map(e=>e.message),[]);assert.deepEqual(f.h.errors,[]);
 console.log('PASS MV3 list-only raid: one teleport → autonomous battle → victory → route released');
}catch(e){console.error(JSON.stringify(await f.diag()));throw e;}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
