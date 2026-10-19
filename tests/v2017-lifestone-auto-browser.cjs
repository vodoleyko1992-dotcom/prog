'use strict';
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 let n=0,loseNext=false;const snap={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:123,enchant:7}},stacks:[{itemId:10411,qty:8},{itemId:2133,qty:8}]}};
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/character/catalog-hints')return r.fulfill({json:{itemGradeHints:{123:'A'},itemSlotHints:{123:'rhand'}}});
  if(path==='/character'&&r.request().method()==='GET')return r.fulfill({json:{character:snap}});
  if(path==='/character/weapon-augmentation'){
   const b=r.request().postDataJSON();assert.equal(b.operation,'install');assert.equal(b.expectedRevision,snap.revision);n++;
   snap.revision++;snap.inventory.stacks.forEach(x=>x.qty--);snap.inventory.eq.l1.augmentation={uid:'uid-'+n,outcomeId:n===2?'prominence':'tempest',grade:'A'};
   if(loseNext){loseNext=false;return r.abort('failed');}
   return r.fulfill({json:{character:snap,outcomeId:snap.inventory.eq.l1.augmentation.outcomeId,gemstonesSpent:1}});
  }
  return r.fallback();
 });
 await h.g.p.goto('https://l2wap.com/augmentation.html');await until(()=>h.g.core('typeof lifestonePrepareFree === "function"'));
 await h.openTab('lifestone');assert.equal(await h.popup.locator('#lsTargets option').count(),21);
 await h.popup.locator('#lsScanWeapons').click();await until(()=>h.popup.locator('#lsWeapon option').count().then(n=>n===2));await h.popup.locator('#lsWeapon').selectOption({index:1});await h.popup.locator('#lsWeapon').blur();await until(async()=>!!(await h.get(['cfg'])).cfg.autoLs?.weaponKey);
 await h.popup.locator('#lsTargets').selectOption(['prominence','matk_6']);await h.popup.locator('#lsTargets').blur();
 await h.popup.locator('#lsMaxAttempts').fill('3');await h.popup.locator('#lsMaxAttempts').blur();
 await until(async()=>{const c=(await h.get(['cfg'])).cfg.autoLs;return c?.maxAttempts===3&&c.targets.length===2;});
 assert.equal(n,0,'выбор не тратит камни');
 await h.popup.locator('#lsStart').click();
 await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.status==='done';},25000).catch(async e=>{console.log('STATE',JSON.stringify(await h.get(['rt','on','lock'])));console.log('GUARDS',await h.g.core('JSON.stringify({on,tabOwner,free:lifestonePrepareFree(),actions:L2V7Modules.actions.canAct(),tvt:tvtSoon(),gen:automationGeneration})'));console.log('TOAST',await h.popup.locator('body').innerText());throw e;});
 let state=await h.get(['rt']);assert.equal(n,2);assert.equal(state.rt.autoLs.attempts,2);assert.equal(state.rt.autoLs.last,'prominence');assert.equal(state.rt.autoLs.hold,true);
 await delay(2000);assert.equal(n,2,'после цели не повторяет');assert.equal(snap.inventory.stacks[0].qty,6);
 await h.popup.reload();await h.openTab('lifestone');await until(()=>h.popup.locator('#lsRun').textContent().then(s=>s.includes('2/3')));
 assert.deepEqual(await h.popup.locator('#lsTargets').evaluate(e=>[...e.selectedOptions].map(o=>o.value)),['prominence','matk_6']);
 await h.popup.locator('#lsStart').click();await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='done');assert.equal(n,2,'уже стоящая цель без расходов');
 await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);
 // Новый выбор, конечная серия; после отправки первой попытки останавливаем и перезагружаем.
 await h.popup.locator('#lsTargets').selectOption('hurricane');await h.popup.locator('#lsTargets').blur();await until(async()=>(await h.get(['cfg'])).cfg.autoLs.targets[0]==='hurricane');
 await h.popup.locator('#lsStart').click();await until(()=>Promise.resolve(n>=3));await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);
 const stopped=n;await h.g.p.reload();await until(()=>h.g.core('typeof L2V7Modules.lifestone === "object"'));
 await h.popup.locator('#start').click();await until(()=>h.g.core('on&&tabOwner'));await delay(2500);assert.equal(n,stopped,'Stop/reload/Start не возобновляет расход автоматически');
 await h.popup.locator('#lsResume').click();await until(async()=>(await h.get(['rt'])).rt.autoLs.status==='done',15000);assert.equal((await h.get(['rt'])).rt.autoLs.attempts,3,'лимит сохраняется после продолжения');
 await h.popup.locator('#lsClose').click();await until(async()=>(await h.get(['rt'])).rt.autoLs.hold===false);
 await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);
 await h.popup.locator('#lsTargets').selectOption('major_heal');await h.popup.locator('#lsTargets').blur();await until(async()=>(await h.get(['cfg'])).cfg.autoLs.targets[0]==='major_heal');
 loseNext=true;await h.popup.locator('#lsStart').click();await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.pending&&s.status==='paused';});
 const lost=n;await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);
 await h.popup.locator('#lsReconcile').click();await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return !s.pending&&s.attempts===1;});
 assert.equal(n,lost,'сверка при выключенном боте не повторяет POST');assert.equal((await h.get(['rt'])).rt.autoLs.status,'paused');
 if(process.env.L2_SCREENSHOT){await h.popup.setViewportSize({width:760,height:850});await h.popup.screenshot({path:process.env.L2_SCREENSHOT});}
 assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: 21 цель, мультивыбор/сохранение, старт с выключенного бота, цель/лимит, Stop/reload/ручное продолжение, сверка потерянного ответа при выключенном боте, завершение удержания');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
