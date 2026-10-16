'use strict';
const assert=require('node:assert/strict');
const {questChampion,until,delay}=require('./v1029-quest-champion-fixture.cjs');
async function test(kind){const f=await questChampion({nonquest:kind==='nonquest',targetList:['target-list','named-target'].includes(kind),namedChampion:kind==='named-target',noNet:['objective-line','orange','completed','chapter-transition'].includes(kind),orange:['orange','never','color-off','slow'].includes(kind),slow:kind==='slow',never:kind==='never',colorOff:kind==='color-off',completed:['completed','chapter-transition'].includes(kind)});try{
 await f.start();
 if(kind==='slow'){
  await until(()=>f.S.leaves===1,25000);assert.ok(f.S.attacks>0);assert.ok(f.S.leftAt-f.S.firstAttackAt<12000,'защитный выход не ждёт сверх короткой пробы');assert.ok(Object.values(f.S.holdAtLeave||{}).some(v=>v.orange?.t>0),'hold сохранён до native leave POST');
  await until(()=>f.h.g.p.url().includes('/map.html'));await delay(2000);assert.equal(f.S.entries,1,'после выхода не входит повторно');
  await f.h.g.p.reload();await until(()=>f.h.g.core('on&&tabOwner'));await delay(1500);await f.h.click('stop');assert.equal(f.S.entries,1);assert.equal(f.S.wins,0);
 }
 else if(kind==='chapter-transition'){
  await until(async()=>(await f.h.get(['rt'])).rt.campaign?.targets?.some(t=>t.champ&&t.done===12&&t.ok));await f.h.click('stop');
  await until(()=>f.h.g.core('!on&&!running'));f.S.chapter=10;f.S.goalDone=0;await f.h.g.p.goto('https://l2wap.com/dion-campaign.html',{waitUntil:'domcontentloaded'});await until(()=>f.h.g.core('!!L2V7Modules.quests'));await f.start();
  await until(()=>f.S.wins===1,20000);await f.h.click('stop');const goals=(await f.h.get(['rt'])).rt.campaign.targets;
  assert.ok(goals.some(t=>t.champ&&t.total===15&&!t.ok));assert.equal(f.S.entries,1);
 }
 else if(kind==='completed'){await until(async()=>(await f.h.get(['rt'])).rt.campaign?.targets?.some(t=>t.champ&&t.done===12&&t.ok));await delay(1500);await f.h.click('stop');assert.equal(f.S.entries,0);}
 else if(kind==='named-target'){await until(async()=>(await f.h.get(['rt'])).rt.campaign?.targets?.some(t=>t.name==='Champion Raider'));await f.h.click('stop');const target=(await f.h.get(['rt'])).rt.campaign.targets.find(t=>t.name==='Champion Raider');assert.ok(!target.champ&&!target.objective);assert.equal(f.S.entries,0);}
 else if(['nonquest','never','color-off'].includes(kind)){await delay(2500);await f.h.click('stop');assert.equal(f.S.entries,0);assert.equal(f.S.attacks,0);}
 else {await until(()=>f.S.wins===1,20000);await f.h.click('stop');assert.equal(f.S.entries,1);assert.equal(f.S.attacks,1);assert.ok((await f.h.get(['rt'])).rt.campaign.targets.some(t=>t.champ&&!t.ok),'generic champion objective parsed');}
 assert.deepEqual(f.S.routeErrors,[]);assert.deepEqual(f.h.errors,[]);console.log('PASS quest champion '+kind,JSON.stringify({entries:f.S.entries,attacks:f.S.attacks,leaves:f.S.leaves,exitMs:f.S.leftAt?f.S.leftAt-f.S.firstAttackAt:undefined,visits:f.S.visits}));
}catch(e){console.error('DIAG '+kind,JSON.stringify(await f.diag()));throw e;}finally{await f.close();}}
(async()=>{for(const k of(process.env.CHAMP_CASES||'objective-line,target-list,orange,completed,chapter-transition,named-target,nonquest,never,color-off,slow').split(','))await test(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
