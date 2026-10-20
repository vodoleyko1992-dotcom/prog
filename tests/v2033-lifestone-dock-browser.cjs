'use strict';
// Настоящие MV3/dock/runtime IPC; отсутствие chrome.tabs моделирует Firefox iframe. HTTPS полностью локальные.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false}),calls=[];let attempts=0,holdCharacter=false,held=false,release;const gate=new Promise(r=>release=r);try{
 const hints=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../kb/raw/catalog-hints.json'),'utf8')).data;
 const snap={name:'AuditHero',revision:100,inventory:{eq:{l1:{itemId:9002284,enchant:25,instanceId:'audit-caster'}},stacks:[{itemId:97,enchant:0,qty:1},{itemId:8688,enchant:7,qty:1},{itemId:175,enchant:0,qty:1},{itemId:10412,qty:8},{itemId:2134,qty:8}]}};
 await h.ctx.route('https://l2wap.com/**',async r=>{
  const q=r.request(),path=new URL(q.url()).pathname;calls.push({path,method:q.method()});
  if(path==='/character/catalog-hints')return r.fulfill({json:hints});
  if(path==='/character'&&q.method()==='GET'){if(holdCharacter){held=true;await gate;}return r.fulfill({json:{character:snap}}).catch(()=>{});}
  if(path==='/character/weapon-augmentation'){
   const body=q.postDataJSON();assert.equal(body.operation,'install');assert.equal(body.expectedRevision,snap.revision);assert.equal(snap.inventory.eq.l1.itemId,9002284);
   attempts++;snap.revision++;for(const item of snap.inventory.stacks)if([10412,2134].includes(item.itemId))item.qty--;
   snap.inventory.eq.l1.augmentation={uid:'audit-ls-'+attempts,grade:'S',outcomeId:attempts===2?'matk_6':'tempest'};
   return r.fulfill({json:{character:snap,outcomeId:snap.inventory.eq.l1.augmentation.outcomeId,gemstonesSpent:1}});
  }
  assert.equal(q.method(),'GET','прочие мутации запрещены: '+path);return r.fallback();
 });
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,dock:true,dockMin:false}})});
 await h.g.p.goto('https://l2wap.com/augmentation.html');await until(()=>h.g.core('typeof lifestonePrepareFree==="function"'));
 await h.g.p.setViewportSize({width:1897,height:953});await h.g.core("cfg.dock=true;cfg.dockMin=false;localStorage.setItem('l2bot-dockWide','1');dock();true");
 const frame=h.g.p.frameLocator('#l2bot-dock iframe');await until(()=>frame.locator('#start').isVisible());
 await frame.locator('body').evaluate(()=>{Object.defineProperty(chrome,'tabs',{configurable:true,value:undefined});showTab('lifestone');});await delay(600);
 const capabilities=await frame.locator('body').evaluate(()=>({docked:DOCKED,tabs:typeof chrome.tabs,runtime:typeof chrome.runtime.sendMessage}));assert.equal(capabilities.tabs,'undefined');
 async function scan(){const old=(await h.get(['rt'])).rt.lsWeapons?.t||0;await frame.locator('body').evaluate(()=>document.getElementById('lsScanWeapons').click());await until(async()=>((await h.get(['rt'])).rt.lsWeapons?.t||0)>old);await until(()=>frame.locator('#lsScanStatus').textContent().then(s=>s.includes('Прочитано оружия: 4')));assert.equal(await frame.locator('#lsWeapon option').count(),5);}
 await scan();assert.equal((await h.get(['on'])).on,false);assert.equal(attempts,0);
 await frame.locator('#lsWeapon').selectOption({index:1});await frame.locator('#lsWeapon').blur();await until(async()=>!!(await h.get(['cfg'])).cfg.autoLs?.weaponKey);
 await frame.locator('#lsTargets').selectOption('matk_6');await frame.locator('#lsTargets').blur();await frame.locator('#lsMaxAttempts').fill('3');await frame.locator('#lsMaxAttempts').blur();
 await until(async()=>{const c=(await h.get(['cfg'])).cfg.autoLs;return c?.targets?.[0]==='matk_6'&&c.maxAttempts===3;});assert.equal(attempts,0,'scan/selection никогда не запускают расход');
 // Общая кнопка Start включает движок, а read-only скан проверяется и при активном владельце.
 await frame.locator('body').evaluate(()=>document.getElementById('start').click());await until(()=>h.g.core('on && running && tabOwner'));await scan();assert.equal(attempts,0);
 await frame.locator('body').evaluate(()=>document.getElementById('stop').click());await until(async()=>!(await h.get(['on'])).on);await until(()=>h.g.core('!on && !running'));
 await frame.locator('body').evaluate(()=>{globalThis.__lsWakeObservations=[];const e=document.getElementById('wakeWarn');new MutationObserver(()=>globalThis.__lsWakeObservations.push({hidden:e.hidden,text:e.textContent,toast:document.getElementById('toast').textContent})).observe(e,{attributes:true,childList:true,subtree:true});document.getElementById('lsStart').click();});
 await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.status==='done'&&s.last==='matk_6';},25000);
 const wakeObservations=await frame.locator('body').evaluate(()=>globalThis.__lsWakeObservations||[]);assert.equal(wakeObservations.some(x=>!x.hidden),false,'успешный OFF-старт ЛС не показывает ложную ошибку запуска');let series=(await h.get(['rt'])).rt.autoLs;assert.equal(attempts,2);assert.equal(series.attempts,2);assert.equal(series.itemId,9002284);assert.equal(series.grade,'S');assert.equal(series.maxAttempts,3);
 await delay(1800);assert.equal(attempts,2,'после цели нет повторов');assert.equal(snap.inventory.stacks.find(x=>x.itemId===10412).qty,6);assert.equal(snap.inventory.stacks.find(x=>x.itemId===2134).qty,6);
 await frame.locator('body').evaluate(()=>document.getElementById('lsPause').click());await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='paused');assert.equal(attempts,2);
 // Stop во время GET отменяет позднюю публикацию списка и не запускает расход.
 const old=(await h.get(['rt'])).rt.lsWeapons;holdCharacter=true;
 await frame.locator('body').evaluate(()=>document.getElementById('lsScanWeapons').click());await until(()=>held);
 await frame.locator('body').evaluate(()=>document.getElementById('stop').click());await until(async()=>!(await h.get(['on'])).on);release();await until(()=>frame.locator('body').evaluate(()=>!lsActionBusy),10000);await delay(700);
 assert.deepEqual((await h.get(['rt'])).rt.lsWeapons,old);assert.equal(attempts,2);assert.match(await frame.locator('#lsScanStatus').textContent(),/изменил|останов|управлен/i);
 assert.equal(calls.filter(x=>x.method==='POST').length,2);assert.deepEqual(h.errors,[]);
 const proof={at:new Date().toISOString(),boundary:'actual Chrome MV3 dock; Firefox iframe capability chrome.tabs unavailable explicitly modeled; all HTTPS local, no live game',capabilities,weaponIds:[9002284,97,8688,175],offScan:'PASS',onScan:'PASS',startFromOff:'PASS',wakeObservations,unpromptedPosts:0,series:{status:series.status,attempts:series.attempts,last:series.last,itemId:series.itemId,grade:series.grade,maxAttempts:series.maxAttempts},pause:'PASS',stopHeldScan:'PASS',posts:attempts,calls,errors:h.errors};
 if(process.env.LS_SCAN_PROOF)fs.writeFileSync(process.env.LS_SCAN_PROOF,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));console.log('PASS actual dock without tabs API: OFF/ONscan4weapons → exact S weapon2attemptgoal → pause/StopheldGET; no unprompted POST');
 }catch(e){console.error('DIAG',JSON.stringify({attempts,held,state:await h.g.core('({on,running,tabOwner,free:lifestonePrepareFree(),status:rt.status,autoLs:rt.autoLs,generation:automationGeneration})').catch(String),calls}));throw e;}
 finally{release();await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
