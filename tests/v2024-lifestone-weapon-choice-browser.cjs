'use strict';
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 let posts=0;const snap={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:123,enchant:7,clanWeaponUid:'staff'}},stacks:[{itemId:124,enchant:5,qty:1,clanWeaponUid:'pole'},{itemId:125,enchant:4,qty:1},{itemId:10411,qty:4},{itemId:2133,qty:4}]}};
 const hints={itemGradeHints:{123:'A',124:'A',125:'A'},itemSlotHints:{123:'rhand',124:'rhand',125:'chest'},itemNamesRu:{123:'Посох',124:'Копьё',125:'Броня'}};
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/character/catalog-hints')return r.fulfill({json:hints});
  if(p==='/character'&&r.request().method()==='GET')return r.fulfill({json:{character:snap}});
  if(p==='/character/weapon-augmentation'){
   const b=r.request().postDataJSON();assert.equal(b.operation,'install');assert.equal(b.expectedRevision,snap.revision);assert.equal(snap.inventory.eq.l1.clanWeaponUid,'pole','ЛС только в выбранное копьё');
   posts++;snap.revision++;for(const item of snap.inventory.stacks)if([10411,2133].includes(item.itemId))item.qty--;
   snap.inventory.eq.l1.augmentation={uid:'ls-'+posts,grade:'A',outcomeId:'prominence'};
   return r.fulfill({json:{character:snap,outcomeId:'prominence',gemstonesSpent:1}});
  }
  assert.notEqual(r.request().method(),'POST','другие расходы запрещены: '+p);return r.fallback();
 });
 await h.openTab('lifestone');await h.popup.locator('#lsScanWeapons').click();await until(()=>h.popup.locator('#lsWeapon option').count().then(n=>n===3));
 assert.match(await h.popup.locator('#lsWeapon option').nth(1).textContent(),/Посох.*надето/);assert.match(await h.popup.locator('#lsWeapon option').nth(2).textContent(),/Копьё.*рюкзак/);
 await h.popup.locator('#lsWeapon').selectOption({index:2});await h.popup.locator('#lsWeapon').blur();await until(async()=>!!(await h.get(['cfg'])).cfg.autoLs?.weaponKey);
 const selected=(await h.get(['cfg'])).cfg.autoLs.weaponKey;
 await h.popup.locator('#lsTargets').selectOption('prominence');await h.popup.locator('#lsTargets').blur();await until(async()=>(await h.get(['cfg'])).cfg.autoLs?.targets?.includes('prominence'));
 await h.g.p.goto('https://l2wap.com/augmentation.html');await until(()=>h.g.core('typeof lifestonePrepareFree === "function"'));
 await h.popup.locator('#lsStart').click();await until(()=>h.popup.locator('body').innerText().then(s=>s.includes('Сначала наденьте выбранное оружие')));
 assert.equal(posts,0);assert.equal((await h.get(['on'])).on,false);
 // Пользователь надевает выбранное копьё в игре; сервер отдаёт тот же экземпляр без stack qty.
 const pole=snap.inventory.stacks.shift();delete pole.qty;snap.inventory.stacks.push({...snap.inventory.eq.l1,qty:1});snap.inventory.eq.l1=pole;snap.revision++;
 await h.popup.locator('#lsScanWeapons').click();await until(()=>h.popup.locator('#lsWeapon option').nth(1).textContent().then(s=>s.includes('Копьё')));
 assert.equal(await h.popup.locator('#lsWeapon').inputValue(),selected,'перенос из рюкзака в слот сохраняет выбор');
 await h.popup.setViewportSize({width:360,height:900});await h.popup.reload();await h.openTab('lifestone');await until(()=>h.popup.locator('#lsWeapon').inputValue().then(s=>s===selected));
 await h.popup.locator('#lsStart').click();await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='done',20000);
 const state=(await h.get(['rt'])).rt.autoLs;assert.equal(posts,1);assert.equal(state.itemId,124);assert.equal(state.weaponName,'Копьё');assert.equal(state.weaponKey,selected);assert.equal(state.last,'prominence');
 await delay(1800);assert.equal(posts,1);assert.match(await h.popup.locator('#lsRun').textContent(),/Оружие: Копьё/);assert.deepEqual(h.errors,[]);
 await h.popup.locator('#stop').click();console.log('PASS actual MV3 360px: scan OFF → bag target saved/reload → wrong equipped blocked → selected item equipped → one LS on exact weapon');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
