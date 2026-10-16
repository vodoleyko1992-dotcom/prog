'use strict';
// Настоящее расширение/main и пользовательское меню; серверные ответы локальны.
const assert=require('node:assert/strict');
const {journey,until,delay}=require('./v1028-buff-interruption-fixture.cjs');
async function test(kind){const f=await journey(kind==='dynamic'?{dynamicFourth:true}:kind==='unknown'?{lostKind:'fa',unproven:true}:{holdKind:'fa'});try{
 await f.start();
 if(kind==='dynamic'){
  await until(()=>f.events.filter(e=>e.kind==='hero-buff').length===4,30000);
  assert.deepEqual(f.events.filter(e=>e.kind==='hero-buff').map(e=>e.id),[1059,1085,1204,1303]);
  assert.equal(new Set(f.events.filter(e=>e.kind==='hero-buff').map(e=>e.pageIndex)).size,1,'новый missing FA докуплен до ухода со страницы баффера');
  await f.h.click('stop');assert.deepEqual(f.routeErrors.map(e=>e.message),[]);assert.deepEqual(f.h.errors,[]);
  console.log('PASS buff interruption dynamic',JSON.stringify(f.events.filter(e=>e.kind==='hero-buff')));return;
 }
 await until(()=>f.S.heroBuffs.length===1,60000);
 if(kind==='unknown'){
  await until(async()=>!!(await f.h.get(['rt'])).rt.actionPayments?.pending,15000);
  await f.h.popup.locator('[data-auto-task=cat]').click();await until(async()=>(await f.h.get(['cfg'])).cfg.autoTasks.includes('cat'));
  await f.h.g.p.reload();await until(()=>f.h.g.core('on&&tabOwner'));await delay(2500);
  assert.equal(f.S.heroBuffs.length,1);assert.equal((await f.h.get(['rt'])).rt.actionPayments.pending.kind,'fa-buff');
 }else{
  await until(()=>f.held());const before=(await f.h.get(['rt'])).rt.actionOwner;
  assert.equal(before.key,'tbuff');
  assert.ok((await f.h.get(['rt'])).rt.tbuff.fa.length>=2,'прервана незавершённая очередь нескольких FA баффов');
  if(kind==='cat')await f.h.popup.locator('[data-auto-task=cat]').click();
  else {await f.h.popup.locator('[data-auto-task="tvt"]').check();await f.h.popup.locator('[data-auto-task="raid"]').uncheck();}
  await until(async()=>{const tasks=(await f.h.get(['cfg'])).cfg.autoTasks;return kind==='cat'?tasks.includes('cat'):tasks.length===1&&tasks[0]==='tvt';});
  if(kind==='cat')assert.equal(await f.h.g.core('autonomyMode()'),'raid');
  const resumed=Date.now();f.release();
  await until(async()=>{const P=(await f.h.get(['rt'])).rt.actionPayments;return !P?.pending&&P?.history?.some(p=>p.kind==='fa-buff');},15000);
  if(kind==='cat'){
   await until(()=>f.S.heroBuffs.length===3,20000);assert.ok(Date.now()-resumed<20000,'очередь не ждёт старый 60-секундный cooldown');
   assert.deepEqual(f.S.heroBuffs.map(x=>x.skillId),[1059,1085,1204]);
   const owner=(await f.h.get(['rt'])).rt.actionOwner;assert.notEqual(owner?.id,before.id,'старый владелец не сохраняется');
   await f.h.g.p.reload();await until(()=>f.h.g.core('on&&tabOwner'));await delay(1500);assert.equal(f.S.heroBuffs.length,3);
  }else{await delay(2000);assert.equal(f.S.heroBuffs.length,1);await f.h.g.p.reload();await until(()=>f.h.g.core('on&&tabOwner'));await delay(1500);assert.equal(f.S.heroBuffs.length,1);}
 }
 await f.h.click('stop');assert.deepEqual(f.routeErrors.map(e=>e.message),[]);assert.deepEqual(f.h.errors,[]);
 console.log('PASS buff interruption '+kind,JSON.stringify(f.events.filter(x=>x.kind==='hero-buff')));
}catch(e){console.error('DIAG '+kind,JSON.stringify(await f.diag()));throw e;}finally{await f.close();}}
(async()=>{for(const k of (process.env.BUFF_CASES||'cat,tvt,unknown,dynamic').split(','))await test(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
