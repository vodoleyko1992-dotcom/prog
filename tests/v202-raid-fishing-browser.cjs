'use strict';
const assert=require('node:assert/strict'),{raidFishing,until,delay}=require('./v202-raid-fishing-fixture.cjs');
async function run(kind){const f=await raidFishing(kind);try{
 await f.start();
 if(kind.startsWith('upgrade')){
  await until(()=>f.S.raidPages.length>0,15000);
  if(kind==='upgrade-partial'||kind==='upgrade-error'){
   await until(async()=>!!(await f.h.get(['rt'])).rt.rbListIncomplete,25000);await delay(1500);await f.h.click('stop');
   const {rt}=await f.h.get(['rt']);assert.equal(f.S.casts.length,0);assert.equal(rt.rbListVerifiedAt,0);assert.ok(!rt.rbFishWait);assert.equal(f.S.raidPages.length,1);console.log('PASS '+kind+' remains closed after incomplete/error read');return;
  }
 }
 await until(()=>f.S.fightHeld,25000);
 if(kind==='upgrade'||kind==='upgrade-no-step'){assert.deepEqual(f.S.raidPages,[1,2]);const {rt}=await f.h.get(['rt']);assert.equal(Object.keys(rt.rbList).length,51);assert.equal(rt.rbListVerifiedAt,rt.rbListT);}

 const before=await f.h.get(['rt','cfg']);assert.equal(before.cfg.fishMode,false);assert.deepEqual(before.cfg.autoTasks,['raid','fish','tvt']);assert.ok(before.rt.rbFishWait?.until>Date.now());assert.equal(f.S.casts.length,1);assert.equal(f.h.g.p.url(),'https://l2wap.com/fishing.html');
 const mark=before.rt.rbFishWait.at;
 await f.h.g.core('setRt({rbHuntIdle:Date.now()-1,rbFishWait:{...rt.rbFishWait,until:Date.now()-1}})');
 await delay(400);assert.equal(await f.h.g.core('autonomyMode()'),'fish','expired raid wait cannot interrupt active fish');assert.equal(f.S.hits,0);f.releaseFight();
 await until(async()=>{const {rt}=await f.h.get(['rt']);return rt.fish?.caught===1&&rt.rbFishWait?.at>mark;},20000);
 await f.h.click('stop');assert.equal(f.S.hits,1);assert.equal(f.S.casts.length,1);assert.deepEqual(f.S.errors,[]);console.log('PASS '+kind+' actual MV3 empty raid → selected fish → active fish finishes after raid timer → raid reassessed',JSON.stringify({casts:f.S.casts.length,caught:(await f.h.get(['rt'])).rt.fish.caught,mapVisits:f.S.mapVisits}));
 }catch(e){console.error('DIAG',JSON.stringify({S:f.S,state:await f.h.get(['rt']).then(({rt})=>({status:rt.status,rbHunt:rt.rbHunt,rbHuntIdle:rt.rbHuntIdle,rbFishWait:rt.rbFishWait,fish:rt.fish,fishCastActive:rt.fishCastActive,fishCastPending:rt.fishCastPending})),url:f.h.g.p.url()}));throw e;}finally{await f.close();}}
(async()=>{for(const k of(process.env.RAID_FISH_CASES||'normal,upgrade,upgrade-no-step,upgrade-partial,upgrade-error').split(','))await run(k);})().catch(e=>{console.error(e.stack);process.exitCode=1});
