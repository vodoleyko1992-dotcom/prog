'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./v1016-enchant-independent-fixture.cjs');
async function started(){const f=fixture({target:4});f.env.rt.char='Hero';f.snap.name='Hero';await f.start();f.create();return f;}
for(const path of ['/character/catalog-hints','/character'])test(`enchant reload: transient ${path} failure recovers without manual resume`,async()=>{
 const f=await started(),get=f.env.gameGet;let failed=false,reads=0;
 f.env.gameGet=async p=>{if(p===path){reads++;if(!failed){failed=true;return {ok:false,status:503};}}return get(p);};
 await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.pending,null);assert.equal(f.env.rt.enchant.status,'running');
 const before=reads;await f.M.step();assert.equal(reads,before,'backoff prevents immediate repeated GET');
 await f.tick();assert.equal(f.posts.length,1);assert.equal(f.env.rt.enchant.totals.successes,1);assert.equal(f.env.rt.enchant.pending,null);
});
for(const path of ['/character/catalog-hints','/character'])test(`enchant reload: persistent ${path} failure pauses after three reads`,async()=>{
 const f=await started(),get=f.env.gameGet;let reads=0;f.env.gameGet=async p=>p===path?(reads++,{ok:false,status:503}):get(p);
 for(let i=0;i<4;i++){await f.tick();f.create();}
 assert.equal(reads,3);assert.equal(f.env.rt.enchant.status,'paused');assert.match(f.env.rt.enchant.reason,path.endsWith('hints')?/каталог/:/героя/);assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.totals.scrolls,0);
});
for(const action of ['stop','owner','profile','mode','pause'])test(`enchant preflight: ${action} during failed read cannot schedule or spend`,async()=>{
 const f=await started(),get=f.env.gameGet,before=f.env.rt.enchant;
 f.env.gameGet=async p=>{if(p==='/character'){
  if(action==='stop')f.env.on=false;
  if(action==='owner')f.env.tabOwner=false;
  if(action==='profile')f.env.rt.char='Other';
  if(action==='mode')f.env.cfg.enchantMode=false;
  if(action==='pause')await f.M.command('pause');
  return {ok:false,status:503};
 }return get(p);};
 await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.readFailures||0,0);assert.equal(f.env.rt.enchant.nextAt,before.nextAt);
 if(action==='pause')assert.equal(f.env.rt.enchant.status,'paused');
});
test('enchant: successful retry still rejects changed item before any scroll',async()=>{
 const f=await started(),get=f.env.gameGet;let fail=true;f.env.gameGet=async p=>p==='/character'&&fail?(fail=false,{ok:false,status:503}):get(p);
 await f.tick();f.snap.inventory.eq.l1.enchant=8;await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.status,'paused');assert.match(f.env.rt.enchant.reason,/экземпляр/);
});
test('enchant: unavailable actor identity never grants spending permission',async()=>{
 const f=await started();f.snap.name='Other';for(let i=0;i<3;i++)await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.status,'paused');assert.match(f.env.rt.enchant.reason,/героя/);
});
test('enchant: Stop during successful recovery save prevents spending',async()=>{
 const f=await started(),get=f.env.gameGet;let fail=true;f.env.gameGet=async p=>p==='/character'&&fail?(fail=false,{ok:false,status:503}):get(p);
 await f.tick();f.afterSet=p=>{if(p.enchant?.readFailures===0)f.env.on=false;};await f.tick();assert.equal(f.posts.length,0);assert.equal(f.env.rt.enchant.pending,null);
});
