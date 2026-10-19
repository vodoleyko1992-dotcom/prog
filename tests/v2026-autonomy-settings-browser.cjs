'use strict';
// 19.10.2026: настоящий popup → MV3 фон → локальная игровая вкладка. Задерживается только чтение cfg выбранной задачи.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness();try{
  const p=h.popup;
  await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:[],limitRanges:{}}});});
  await p.reload();await until(()=>p.evaluate(()=>!!document.getElementById('start')?.onclick&&formChar==='AuditHero'));await h.tasks();
  await p.evaluate(()=>{
   const get=chrome.storage.local.get.bind(chrome.storage.local),send=chrome.runtime.sendMessage.bind(chrome.runtime);
   window.settingsAuditMessages=[];
   chrome.runtime.sendMessage=(m,...args)=>{if(m?.cmd==='menuPatch')window.settingsAuditMessages.push({on:m.on,tasks:m.cfgPatch?.autoTasks});return send(m,...args);};
   window.settingsAuditGate=()=>{
    const gate=window.settingsAuditPending={seen:false};
    chrome.storage.local.get=(keys,...args)=>{
     if(keys!=='cfg'||gate.seen)return get(keys,...args);
     gate.seen=true;const snapshot=get(keys,...args);return new Promise((resolve,reject)=>{
      gate.release=()=>snapshot.then(resolve,reject);gate.fail=()=>reject(new Error('fixture settings read unavailable'));
     });
    };
   };
   window.settingsAuditGate();
  });
  await p.locator('[data-auto-task="farm"]').check();await until(()=>p.evaluate(()=>window.settingsAuditPending.seen));
  await p.locator('#start').click();await delay(450);
  assert.equal((await h.get(['on'])).on,false,'Start не включает движок, пока чтение выбранной задачи задержано');
  assert.equal(await p.evaluate(()=>window.settingsAuditMessages.some(m=>m.on===true)),false,'до сохранения нет команды on=true');
  assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,[]);
  await p.evaluate(()=>window.settingsAuditPending.release());
  await until(async()=>{const s=await h.get(['cfg','on']);return s.on&&s.cfg.autoTasks.includes('farm');});
  await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="farm"'));
  const messages=await p.evaluate(()=>window.settingsAuditMessages);
  assert.ok(messages.findIndex(m=>m.tasks?.includes('farm'))<messages.findIndex(m=>m.on===true),'фактический фон получает запись задачи раньше команды запуска');
  console.log('PASS actualMV3 checkbox read delayed → Start stays OFF → cfg ACK → on=true → farm selected by runtime');

  await p.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await until(()=>h.g.core('!on && !running'));
  await p.locator('[data-auto-task="farm"]').uncheck();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes('farm'));
  await p.evaluate(()=>{window.settingsAuditMessages=[];window.settingsAuditGate();});
  await p.locator('[data-auto-task="farm"]').check();await until(()=>p.evaluate(()=>window.settingsAuditPending.seen));
  await p.locator('#start').click();await delay(150);await p.evaluate(()=>window.settingsAuditPending.fail());
  await until(()=>p.locator('#settingsFeedback').isVisible());await delay(450);
  assert.equal((await h.get(['on'])).on,false,'отказ чтения не разрешает Start со старой конфигурацией');
  assert.equal(await p.evaluate(()=>window.settingsAuditMessages.some(m=>m.on===true)),false);
  assert.match(await p.locator('#settingsFeedback').innerText(),/fixture settings read unavailable/);
  assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,[]);
  console.log('PASS actualMV3 checkbox read rejection → persistent error → no on=true/no runtime start');

  // После успешного повторного выбора прежний отказ больше не требует перезапуска расширения.
  await until(async()=>!await p.locator('[data-auto-task="farm"]').isChecked());
  await p.locator('[data-auto-task="farm"]').check();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks.includes('farm'));
  await p.locator('#start').click();await until(async()=>(await h.get(['on'])).on);await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="farm"'));
  assert.equal(await p.locator('#settingsFeedback').isVisible(),false);
  await p.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await until(()=>h.g.core('!on && !running'));
  assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(r=>r.method==='GET'),'нет боевых команд, покупок или игровых POST');
  console.log('PASS actualMV3 successful retry clears read failure → starts chosen task → Stop; all HTTPS mocked, 0 POST, 0 page errors');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error('FAIL actualMV3 autonomy settings:',e.stack);process.exitCode=1;});
