'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const expected=f=>({char:f.env.rt.char,pendingId:f.env.rt.petFull?.pending?.id,budgetEpoch:f.env.rt.petFull?.budgetEpoch||0});
async function unknown(opts={}) {const f=fixture({post:()=>{throw Error('timeout')},...opts});await f.step();f.ch.revision++;return f;}

test('off archive preserves uncertain money/history and cannot renew within original default budget',async()=>{
 const f=await unknown();const before=structuredClone(f.env.rt.petFull.pending);f.env.on=false;
 assert.equal((await f.api().archiveUnknown(expected(f))).ok,true);
 assert.equal(f.env.on,false);assert.equal(f.api().summary().reserved,10000000);assert.equal(f.env.rt.petFull.spent||0,0);
 assert.equal(f.env.rt.petFull.history[0].id,before.id);assert.equal(f.env.rt.petFull.history[0].outcome,'unknown');
 assert.equal(f.env.rt.petFull.pending,null);f.env.on=true;f.tick(18001000);f.reload();await f.step();assert.equal(f.calls.length,1);
});

test('failed durable archive cannot acknowledge success or clear blocking intent',async()=>{
 const f=await unknown();const old=f.env.setRt,p=structuredClone(f.env.rt.petFull.pending);
 f.env.setRt=async patch=>{await old(patch);return {ok:false}};f.env.rtCommit=async()=>false;
 const r=await f.api().archiveUnknown(expected(f));assert.equal(r.ok,false);assert.equal(f.env.rt.petFull.pending?.id,p.id);
 assert.equal(f.api().summary().reserved,10000000);assert.equal(f.calls.length,1);
});

test('concurrent duplicate archive reserves once and same old confirmation cannot repeat',async()=>{
 const f=await unknown();const e=expected(f);const results=await Promise.all([f.api().archiveUnknown(e),f.api().archiveUnknown(e)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(f.env.rt.petFull.history.length,1);assert.equal(f.api().summary().reserved,10000000);
 assert.equal((await f.api().archiveUnknown(e)).ok,false);
});

test('lease loss in archive GET retains pending and no archive credit',async()=>{
 let lose=false;const f=await unknown({read:(_,e)=>{if(lose)e.tabOwner=false}});const e=expected(f);lose=true;
 assert.equal((await f.api().archiveUnknown(e)).ok,false);assert.equal(f.env.rt.petFull.pending.id,e.pendingId);assert.equal(f.env.rt.petFull.unknownReserved||0,0);
});

test('archived reserve survives exact budget reset and explicit extra budget pays only new attempt',async()=>{
 let fail=true;const f=await unknown({char:{adena:'50000000'},post:()=>{if(fail)throw Error('timeout')}});
 assert.equal((await f.api().archiveUnknown(expected(f))).ok,true);
 const S=f.env.rt.petFull;assert.equal(await f.api().resetBudget({char:'hero',budgetEpoch:S.budgetEpoch,spent:S.spent||0}),true);
 assert.equal(f.api().summary().reserved,10000000);await f.step();assert.equal(f.calls.length,1);
 f.env.cfg.petFullBudget=20000000;fail=false;await f.step({forceRead:true});assert.equal(f.calls.length,2);
 assert.equal(f.env.rt.petFull.spent,10000000);assert.equal(f.env.rt.petFull.unknownReserved,10000000);assert.equal(f.api().summary().remaining,0);
});

test('late exact receipt found on off archive records confirmed payment instead of unknown',async()=>{
 const f=fixture({post:(_,ch,apply)=>{apply();throw Error('timeout')}});await f.step();f.env.on=false;
 assert.equal((await f.api().archiveUnknown(expected(f))).ok,true);assert.equal(f.env.rt.petFull.spent,10000000);
 assert.equal(f.env.rt.petFull.unknownReserved||0,0);assert.equal(f.env.rt.petFull.pending,null);assert.equal(f.calls.length,1);
});

test('core job priority already active blocks even direct step',async()=>{
 const f=fixture();f.env.canRun=()=>false;await f.step();assert.equal(f.calls.length,0);assert.equal(f.gets.length,0);
});

test('new core job arriving during catalog GET cancels pending payment',async()=>{
 let allowed=true;const f=fixture({read:path=>{if(path.includes('catalog'))allowed=false}});f.env.canRun=()=>allowed;
 await f.step();assert.equal(f.calls.length,0);
});
