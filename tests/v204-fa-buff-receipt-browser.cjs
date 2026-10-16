'use strict';
// Actual MV3: настоящий hook/main, content, durable ledger и background/IDB. Ответы игры локальны.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false});const posts=[];try{
 await h.ctx.route('https://l2wap.com/character/town/fast-aden-buffer/apply',r=>{const q=r.request().postDataJSON();posts.push(q);return r.fulfill({contentType:'application/json',body:JSON.stringify({set:q.set,skillId:q.skillId,costFastAden:1,fastAdenBalance:234,character:{name:'AuditHero',revision:q.expectedRevision+1,activeBuffs:[]}})});});
 await h.sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:[],taskOnly:true},on:true});});
 await until(()=>h.g.core('on&&running&&tabOwner&&L2V7Modules.actions.canAct()'));
 await h.g.p.evaluate(()=>{const b=document.createElement('button');b.id='fa-native';b.textContent='Купить';b.onclick=()=>fetch('/character/town/fast-aden-buffer/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({set:'mage',skillId:273,expectedCostFastAden:1,expectedRevision:294666})});document.body.append(b);});
 const paid=await h.g.core(`(async()=>{const P=await L2V7Modules.payments.prepare({key:'fa:273',kind:'fa-buff',quote:{amount:1,currency:'FA'},evidence:{set:'mage',ids:[273],balance:235,before:{273:Date.now()+86400000},beforeLevels:{273:1},expectedLevels:{273:1}}});return !!P&&L2V7Modules.payments.sent(P)&&fire(document.getElementById('fa-native'));})()`);
 assert.equal(paid,true);await until(async()=>{const{rt}=await h.get(['rt']);return rt.actionPayments?.history?.some(p=>p.confirmation.kind==='server-receipt');},25000);
 assert.equal(posts.length,1);assert.equal(await h.g.core('L2V7Modules.payments.pending()'),null);
 console.log('PASS actual native paid click → hook request-start → exact receipt → dispatcher unblocked without active effect');
 // Исторический pending без set; строки журнала и timestamp искусственные и обезличенные.
 const at=Date.now()-86400000,sid='legacy-fixture';
 const rows=[{t:at-500,src:'B',what:'Бафф: Fast Aden',sid,st:{page:'fast-aden-buffer'}},{t:at+500,src:'N',what:'POST /character/town/fast-aden-buffer/apply → 200 · 400 мс · 42000 б',sid,st:{page:'fast-aden-buffer'},data:{q:{set:'mage',skillId:273,expectedCostFastAden:1,expectedRevision:294666},r:'{"character":{"id":"synthetic","name":"AuditHero","unrelated":'}},{t:at+1000,src:'B',what:'Бафф: исход оплаты неизвестен',sid,st:{page:'fast-aden-buffer'},added:['Fast Aden: 234 FA','Баф наложен. Списано 1 FA.']}];
 await h.sw.evaluate(async rows=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('l2bot');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});await new Promise((resolve,reject)=>{const tx=db.transaction('log','readwrite');rows.forEach(r=>tx.objectStore('log').add(r));tx.oncomplete=resolve;tx.onerror=reject;});db.close();},rows);
 await h.g.core(`(async()=>{await setRt({actionPayments:{pending:{id:'legacy-fa',kind:'fa-buff',key:'fa:273',char:'AuditHero',kick:0,at:${at},quote:{amount:1,currency:'FA'},evidence:{ids:[273],balance:235}},history:rt.actionPayments.history}});await rtCommit();return true;})()`);
 await h.g.p.reload();await until(()=>h.g.core('on&&running&&tabOwner'));
 await until(async()=>{const{rt}=await h.get(['rt']);return rt.actionPayments?.history?.some(p=>p.id==='legacy-fa'&&p.confirmation.kind==='journal-receipt');},25000);
 assert.equal(await h.g.core('L2V7Modules.payments.pending()'),null);assert.equal(posts.length,1);
 console.log('PASS reload → old pending → background IDB evidence → durable journal receipt; zero repeated purchases');
 // Похожая запись с другим балансом не имеет доказательства; новый POST запрещён.
 await h.g.core(`(async()=>{await setRt({actionPayments:{pending:{id:'unproven-fa',kind:'fa-buff',key:'fa:273',char:'AuditHero',kick:0,at:${at},quote:{amount:1,currency:'FA'},evidence:{ids:[273],balance:999}},history:rt.actionPayments.history}});await rtCommit();return true;})()`);
 assert.equal(await h.g.core('L2V7Modules.buffs.paymentReconcile()'),false);assert.equal(await h.g.core('fire(document.getElementById("probe"))'),false);assert.equal(posts.length,1);assert.equal((await h.get(['rt'])).rt.actionPayments.pending.id,'unproven-fa');
 console.log('PASS unrelated/missing receipt preserves global payment guard');
 await h.sw.evaluate(()=>chrome.storage.local.set({on:false}));await until(()=>h.g.core('!on&&!running'));assert.deepEqual(h.errors,[]);
 }finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
