'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));

test('crash after paid POST but before sent persisted: disappeared effects never authorize second10M',async()=>{
 const f=fixture({char:{adena:'50000000'},post:(_,ch,apply)=>{apply();throw Error('lost_response')}});
 await f.step();assert.equal(f.calls.length,1);
 const durable=copy(f.writes.find(p=>p.petFull?.pending?.phase==='prepared').petFull);
 assert.equal(durable.pending.phase,'prepared');
 f.env.rt.petFull=durable;
 f.ch.activeSummon.activeBuffs=[];f.ch.revision++; // paid pet lost, new same-type pet
 f.tick(16000);f.reload();await f.step();await f.step();
 assert.equal(f.calls.length,1,'reload must reserve uncertain first payment, not send second');
 assert.ok(f.env.rt.petFull.pending,'uncertain intent remains accounted');
});

test('prepared durable crash with old paid effects expired cannot reset payment budget',async()=>{
 const f=fixture({char:{adena:'50000000'},post:(_,ch,apply)=>{apply();throw Error('lost_response')}});
 await f.step();f.env.rt.petFull=copy(f.writes.find(p=>p.petFull?.pending?.phase==='prepared').petFull);
 f.tick(18001000);f.reload();await f.step();await f.step();
 assert.equal(f.calls.length,1);
 assert.ok(f.env.rt.petFull.pending);
});

test('prepared reload unchanged revision+wallet still reserves possible in-flight request',async()=>{
 const f=fixture({char:{adena:'50000000'},durable:false});await f.step();
 const p=copy(f.writes.find(p=>p.petFull?.pending?.phase==='prepared').petFull);f.env.rt.petFull=p;
 f.env.rtCommit=async()=>true;f.reload();f.tick(16000);await f.step();await f.step();
 assert.equal(f.calls.length,0);assert.equal(f.env.rt.petFull.spent||0,0);assert.equal(f.api().summary().reserved,10000000);
});

for(const phase of ['/character','/character/town/buffer/catalog'])for(const change of ['captcha','config','character'])test(change+' during '+phase+' never pays',async()=>{
 const f=fixture({read:(path,e)=>{if(path!==phase)return;if(change==='captcha')e.antibotState=()=> 'check';if(change==='config')e.cfg.petFullRenew=false;if(change==='character')e.rt.char='other'}});
 await f.step();assert.equal(f.calls.length,0);
});

test('catalog changed after409 exceeds wallet: only rejected request, no renewed payment',async()=>{
 const f=fixture({reject:409,char:{adena:'50000000'},cfg:{petFullBudget:30000000}});await f.step();
 f.set().feeAdena='51000000';f.ch.revision++;f.tick(16000);await f.step();
 assert.equal(f.calls.length,1);assert.equal(f.status(),'adena');
});

test('unknown payment GETs honor throttle and never rePOST after repeated ticks',async()=>{
 const f=fixture({post:()=>{throw Error('timeout')}});await f.step();await f.step();
 const before=f.gets.length;for(let i=0;i<30;i++)await f.step();
 assert.equal(f.gets.length,before);assert.equal(f.calls.length,1);assert.equal(f.api().summary().reserved,10000000);
});

test('expiry without server mutation permits explicitly funded renewal once',async()=>{
 const f=fixture({char:{adena:'50000000'},cfg:{petFullBudget:20000000}});await f.step();
 const rev=f.ch.revision;f.tick(18001000);await f.step();
 assert.equal(rev,101);assert.equal(f.calls.length,2);assert.equal(f.env.rt.petFull.spent,20000000);
});

test('known paid period blocks new higher-rank same-type pet before expiry',async()=>{
 const f=fixture({char:{adena:'50000000'},cfg:{petFullBudget:30000000}});await f.step();
 f.tick(61000);f.ch.activeSummon.summonSkillLevel++;f.ch.activeSummon.activeBuffs=[];f.ch.revision++;
 await f.step();assert.equal(f.calls.length,1);assert.equal(f.status(),'early-loss');
});

test('class changed after accepted POST remains reserved, cannot label new class paid or buy again',async()=>{
 const f=fixture({char:{adena:'50000000'},cfg:{petFullBudget:30000000},post:(_,ch,apply)=>{apply();ch.classSlots.activeSlot=1;ch.l2Profession='dwarf_artisan';return {ok:true,status:200,json:async()=>({set:'summon',feeAdena:'10000000',feeCoinOfLuck:0})}}});
 await f.step();f.tick(16000);f.reload();await f.step();
 assert.equal(f.calls.length,1);assert.equal(f.env.rt.petFull.spent||0,0);assert.ok(f.env.rt.petFull.pending);
});

test('late battle analytics from previous hero cannot write into new hero profile',async()=>{
 const f=fixture();const ctx={pet:{key:'kai_the_cat',hits:0,hitDmg:0,crits:0,misses:0,dmg:0,acts:0}};
 f.api().capture(ctx,f.ch,'on');assert.ok(ctx.petCohort);
 Object.assign(ctx.pet,{hits:1,hitDmg:1000,dmg:1000,acts:1});
 f.env.rt.char='other';delete f.env.rt.petCohorts;
 await f.api().noteBattle(ctx);
 assert.equal(Object.keys(f.env.rt.petCohorts||{}).length,0);
});

test('late old-class cohort cannot label a new subclass battle with old rank/buffs',async()=>{
 const f=fixture();const ctx={pet:{key:'kai_the_cat',hits:0,hitDmg:0,crits:0,misses:0,dmg:0,acts:0}};
 f.api().capture(ctx,f.ch,'on');
 Object.assign(ctx.pet,{hits:1,hitDmg:1000,dmg:1000,acts:1});
 f.env.rt.classCur={prof:'human_warlock',slot:1};
 await f.api().noteBattle(ctx);
 assert.equal(Object.keys(f.env.rt.petCohorts||{}).length,0);
});

test('buff expiry during fight invalidates cohort even without a fresh actor response',async()=>{
 const f=fixture();f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+5000}];
 f.api().noteSnapshot(f.ch,'on');
 const ctx={pet:{key:'kai_the_cat',hits:0,hitDmg:0,crits:0,misses:0,dmg:0,acts:0}};
 f.api().capture(ctx);Object.assign(ctx.pet,{hits:1,hitDmg:1000,dmg:1000,acts:1});
 f.tick(6000);f.api().capture(ctx);await f.api().noteBattle(ctx);
 assert.equal(Object.keys(f.env.rt.petCohorts||{}).length,0);
});

for(const changed of ['rank','buffs','shots','death','resummon'])test('cohort rejects mixed '+changed+' battle instead of reusing old stats',async()=>{
 const f=fixture();const ctx={pet:{key:'kai_the_cat',hits:0,hitDmg:0,crits:0,misses:0,dmg:0,acts:0}};
 f.api().noteSnapshot(f.ch,'on');f.api().capture(ctx);Object.assign(ctx.pet,{hits:1,hitDmg:1000,dmg:1000,acts:1});
 if(changed==='rank')f.ch.activeSummon.summonSkillLevel++;
 if(changed==='buffs')f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+100000}];
 if(changed==='death')ctx.pet.deaths=1;
 if(changed==='resummon')ctx.pet.resummons=1;
 f.api().noteSnapshot(f.ch,changed==='shots'?'off':'on');f.api().capture(ctx);await f.api().noteBattle(ctx);
 assert.equal(Object.keys(f.env.rt.petCohorts||{}).length,0);
});
