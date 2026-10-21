'use strict';
// 20.43 (разбор 21.10): настоящее MV3-меню — «↺ Сбросить замеры охоты» в «Охоте», строка цены чемпионов по своему шансу FA, список иммунитета к дебаффам. Все ответы игры локальные, аккаунта и денег нет.
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');const assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 const now=Date.now();
 await h.sw.evaluate(async t=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,_src:'learn-fixture',prof:'warlock',lastWinT:t-5000,
  mobVal:{'cave bat':{exp:5000,sec:40,n:8,c:'warlock'}},zoneStat:{'Cruma Tower':{'60':{exp:9e6,sec:3600,n:300}}},eff:{chain:{n:40,sec:6,rate:2e5},map:{n:9,sec:12,rate:1e5},cat:{n:7,sec:9,rate:1.5e5}},
  faRate:{warlock:{k:{mob:300,blue:0,orange:0,red:10},f:{mob:9,blue:0,orange:0,red:8},t:t}},faDrop:{n:3,t:t},dailyFish:{id:'keep'},
  debuffImmune:{rb:t-1000,sp:{'ч:hot springs yeti':t-3600000,'cave bat':t-25*3600000}}}});},now);
 await h.popup.reload();await until(()=>h.popup.locator('#huntStatReset').count());
 assert.equal(await h.popup.locator('#tab-hunt #huntStatReset').count(),1);assert.equal(await h.popup.locator('#tab-panel #debuffImmBox').count(),1);
 const fa=await until(()=>h.popup.locator('#faDropBox').textContent().then(x=>x.includes('Цена чемпионов')&&x));
 assert.match(fa,/обычный бой 2,5 %/);assert.match(fa,/красный 65,0 %/);assert.match(fa,/«warlock»: 310 боёв/);console.log('PASS menu shows champion price by own class FA chance (2,5 % / 65 %)');
 const im=await h.popup.locator('#debuffImmBox').textContent();assert.match(im,/рейд-боссы — да/);assert.match(im,/hot springs yeti \(чемпион\): не вешаю ещё ≈23 ч/);assert.match(im,/cave bat: сутки прошли — в следующем бою одна проба/);console.log('PASS immunity list: RB flag + per-species 24 h with probe after expiry');
 await h.reveal('#huntStatReset');const b=h.popup.locator('#huntStatReset');await b.click();assert.ok((await h.get(['rt'])).rt.mobVal['cave bat'],'первое нажатие только просит подтверждение');
 await b.click();await until(async()=>{const {rt}=await h.get(['rt']);return !Object.keys(rt.mobVal||{}).length&&!Object.keys(rt.zoneStat||{}).length&&!Object.keys(rt.eff||{}).length&&rt.lastWinT===0;});
 const s=await h.get(['rt','on']);assert.equal(s.on,false);assert.equal(s.rt.dailyFish.id,'keep');assert.equal(s.rt.faRate.warlock.f.red,8);assert.equal(s.rt.faDrop.n,3);assert.ok(s.rt.debuffImmune.sp['ч:hot springs yeti']);
 assert.equal(h.requests.filter(x=>x.method==='POST').length,0);console.log('PASS two-step reset clears mobVal/zoneStat/eff/lastWinT only; FA, immunity, daily, Stop kept; no game POST');
 assert.deepEqual(h.errors,[]);console.log('PASS no page/popup errors');
}finally{await h.ctx.close();}})().catch(e=>{console.error('FAIL',e);process.exit(1);});
