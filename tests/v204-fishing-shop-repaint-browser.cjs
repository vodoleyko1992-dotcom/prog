'use strict';
// 16.10, журнал07:48: настоящий публичный renderer; focus заменяет строку до платного клика.
// Все API/деньги синтетические, игровой аккаунт не используется.
const {make,downloadPublic}=require('./v1014-fishing-public-browser.cjs'),assert=require('node:assert/strict'),path=require('node:path');
async function attach(w){await w.page.addScriptTag({path:path.join(__dirname,'../modules/payments.js')});await w.run(()=>{
 env.rt.char='SyntheticHero';env.leaseEpoch=1;env.tabOwner=true;env.canRun=()=>env.on;env.canAct=()=>env.on;
 env.setRt=async p=>{Object.assign(env.rt,p);return{ok:true}};env.rtCommit=async()=>true;
 window.hero={name:'SyntheticHero',id:'synthetic',revision:testState.revision,adena:'100000000',inventory:{stacks:[],eq:{}}};
 env.gameGet=async p=>({ok:true,json:async()=>structuredClone(p==='/character'?{character:hero}:testState)});
 env.payments=L2V7Factories.payments(env);const native=env.fire;
 env.fire=b=>{if(!env.on||!b)return false;if(env.payments.blocked()&&!env.payments.consumePermit())return false;if(b.classList.contains('l2-fishing-starter-buy-btn')){window.buyClicks=(window.buyClicks||0)+1;window.detachedClick=window.detachedClick||!b.isConnected}native(b);return true};
 const send=L2.authFetch;L2.authFetch=async(url,init={})=>{const req=JSON.parse(init.body||'{}'),paymentId=env.payments.claimRequest({path:url,method:init.method||'GET',req});const r=await send(url,init);if(init.method==='POST'){
  hero.revision=testState.revision;F.paymentNote(url,{method:'POST',status:r.status,paymentId,req,res:{character:structuredClone(hero)}});
 }return r};
 });}
async function one(label,prepare,check){const w=await make();try{await attach(w);await prepare(w);const result=await w.run(()=>F.fishBuy('bait_x10',2,'наживка'));const snapshot=await w.snapshot(),extra=await w.run(()=>({detachedClick:!!window.detachedClick,buyClicks:window.buyClicks||0}));check(snapshot,result,extra);assert.deepEqual(w.errors,[]);console.log('PASS '+label)}finally{await w.close()}}
const success=(x,r,e)=>{assert.equal(r,true);assert.equal(x.actions.filter(a=>a.offerKey==='bait_x10').length,1);assert.equal(x.state.basicBait.quantity,50);assert.equal(x.rt.actionPayments.pending,null);assert.equal(e.detachedClick,false);assert.equal(e.buyClicks,1)};
const cancelled=(x,r,e)=>{assert.equal(r,false);assert.equal(x.actions.filter(a=>a.offerKey==='bait_x10').length,0);assert.equal(x.state.basicBait.quantity,30);assert.equal(x.rt.actionPayments.pending,null);assert.equal(e.buyClicks,0)};
(async()=>{await downloadPublic();
 await one('обычная покупка: один POST, точный товар/количество и квитанция',async()=>{},success);
 await one('focus во время ввода: renderer заменил строку, покупается актуальная кнопка',w=>w.run(()=>{document.querySelector('#fishing-starter-offers').addEventListener('input',()=>window.dispatchEvent(new Event('focus')),{once:true})}),success);
 await one('focus после сохранения намерения: повторный поиск кнопки, один POST',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);window.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,30));return r}}),success);
 await one('количество изменилось во время prepare: отмена без расхода и блокировки',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);document.querySelector('input[data-offer="bait_x10"]').value='1';return r}}),cancelled);
 await one('магазин удалён до клика: отмена без расхода и блокировки',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);document.querySelector('#fishing-starter-offers').remove();return r}}),cancelled);
 await one('кнопка отключилась до клика: отмена без расхода и блокировки',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);document.querySelector('button.l2-fishing-starter-buy-btn[data-offer="bait_x10"]').disabled=true;return r}}),cancelled);
 await one('цена изменилась до клика: отмена без расхода и блокировки',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);document.querySelector('[data-offer="bait_x10"] .l2-fishing-starter-line').textContent='Пакет: ×10 — 2 000 Adena';return r}}),cancelled);
 await one('Stop во время prepare: отмена без расхода и блокировки',w=>w.run(()=>{const save=env.payments.prepare;env.payments.prepare=async p=>{const r=await save(p);env.on=false;return r}}),cancelled);
 console.log('PASS 8 fishing shop repaint scenarios; real game actions: 0');
})().catch(e=>{console.error(e);process.exitCode=1});
