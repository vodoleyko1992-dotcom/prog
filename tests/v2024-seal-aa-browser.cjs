'use strict';
// Настоящий MV3/popup/dispatcher/native input/click/hook. Все HTTPS ответы локальные.
const assert=require('node:assert/strict');
const{harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const requests=[],posts=[];const large=process.env.SEAL_LARGE==='1',cap=100000;let revision=30,bag=large?{6360:2718796,6361:1434738,6362:753415,5575:100}:{6360:10,6361:20,6362:3,5575:100};const expected=bag[5575]+bag[6360]*5+bag[6361]*3+bag[6362]*10;
 h.ctx.on('request',r=>{if(r.url().startsWith('https://'))requests.push({path:new URL(r.url()).pathname,method:r.method()})});
 const character=()=>({name:'AuditHero',id:'seal-fixture',revision,inBattle:false,inventory:{stacks:Object.entries(bag).map(([itemId,qty])=>({itemId:+itemId,qty})),eq:{}}});
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({character:character()})}));
 await h.ctx.route('https://l2wap.com/game/ancient-trader/exchange',async r=>{
  const q=r.request().postDataJSON();posts.push(q);assert.equal(q.expectedRevision,revision);const[id,rate]={green:[6360,5],blue:[6361,3],red:[6362,10]}[q.stone];assert.ok(q.qty>0&&q.qty<=bag[id]);if(q.qty>cap)return r.fulfill({status:400,json:{error:'invalid_quantity',messageUk:'Некоректна кількість.'}});
  bag[id]-=q.qty;bag[5575]+=q.qty*rate;revision++;
  await r.fulfill({contentType:'application/json',body:JSON.stringify({character:character(),stone:q.stone,qty:q.qty})});
 });
 const row=(stone,qty,rate)=>`<div class="l2-ancient-trader-exchange" data-stone="${stone}" data-aa-rate="${rate}"><span class="l2-ancient-trader-owned__value">${qty}</span><input class="l2-ancient-trader-exchange__input"><button class="l2-ancient-trader-exchange__btn">Обміняти</button><span class="l2-ancient-trader-exchange__err" hidden></span></div>`;
 await h.ctx.route('https://l2wap.com/ancient-trader.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><body><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div>${row('green',bag[6360],5)}${row('blue',bag[6361],3)}${row('red',bag[6362],10)}<script>let revision=${revision};for(const row of document.querySelectorAll('[data-stone]'))row.querySelector('button').onclick=async()=>{const r=await fetch('/game/ancient-trader/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stone:row.dataset.stone,qty:+row.querySelector('input').value,expectedRevision:revision})});const d=await r.json();if(!r.ok){row.querySelector('.l2-ancient-trader-exchange__err').hidden=false;row.querySelector('.l2-ancient-trader-exchange__err').textContent=d.messageUk;return;}revision=d.character.revision;const itemId={green:6360,blue:6361,red:6362}[row.dataset.stone];row.querySelector('span').textContent=String(d.character.inventory.stacks.find(x=>x.itemId===itemId)?.qty||0);};</script></body>`}));
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:[],taskOnly:true,sealAuto:false}})});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#sealNow')?.onclick));await h.reveal('#sealNow');
 await h.g.core(`(async()=>{await setRt({actionOwner:{key:'invScan',context:'old',stamp:'1'},invScan:{t:1}});await rtCommit();return true})()`);
 await h.popup.locator('#sealNow').click();
 await until(()=>bag[6360]===0&&bag[6361]===0&&bag[6362]===0,180000);await until(async()=>{const s=await h.get(['rt','on']);return !s.on&&!s.rt.sealEx},15000);
 assert.equal((await h.get(['rt'])).rt.sealSeen.q[3],expected,'итог в меню обновился сразу, без минутного ожидания');
 assert.equal(bag[5575],expected);if(!large)assert.deepEqual(posts.map(x=>[x.stone,x.qty]),[['green',10],['blue',20],['red',3]]);else{assert.ok(posts.every(x=>x.qty<=cap));assert.ok(posts.length>8);assert.match((await h.get(['rt'])).rt.sealLast.why,/2718796 зелёных/);console.log('PASS 4 906 949 stones; cap100000 → batches → all colours; dispatcher yields safely');}
 assert.match((await h.get(['rt'])).rt.sealLast.why,/обмен на Ancient Adena/);
 console.log(`PASS actual popup при OFF + autoTasks=[] → dispatcher → Ancient Trader → три стека → +${expected-100} AA → OFF`);
 // В том же tasks-only галка запускает отдельный автообмен и сохраняется через переход.
 bag[6360]=2;posts.length=0;
 await h.g.p.goto('https://l2wap.com/map.html');
 await until(()=>h.g.core('typeof invRefresh==="function"'));
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({on:true,cfg:{...cfg,sealAuto:true,sealMin:1}})});
 await until(()=>h.g.core('on&&running&&tabOwner&&L2V7Modules.actions.canAct()'));
 await h.g.core('(async()=>{await invRefresh();await setRt({sealT:0});await rtCommit();return true})()');
 await until(()=>posts.length===1,30000);await until(async()=>!(await h.get(['rt'])).rt.sealEx,15000);
 assert.equal(bag[5575],expected+10);assert.equal((await h.get(['on'])).on,true);
 assert.ok(requests.filter(x=>x.method==='POST').every(x=>x.path==='/game/ancient-trader/exchange'));
 assert.deepEqual(h.errors,[]);
 console.log('PASS auto tasks-only → сохранённая очередь → +10 AA; только обмен, 0 покупок/боёв/телепортов, 0 ошибок');
 }catch(e){console.error('DIAG',await h.g.core('({on,running,tabOwner,owner:rt.actionOwner,status:rt.status,seal:rt.sealEx,due:sealDue(),available:sealAvailable(),auto:cfg.sealAuto,qty:invQty(6360),total:L2V7Modules.dungeons.sealStones(),min:cfg.sealMin,last:rt.sealT,char:rt.char})').catch(String));throw e}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
