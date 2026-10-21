'use strict';
// 21.10 (игрок: «сделай это окно чуть больше», скрин плашки «Движок активен»): статус и «Следующая по приоритету» переносятся до 2 строк, а не режутся «…» в одну.
const assert=require('node:assert/strict');
const {harness}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.openTab('overview');
 const text='Закупка: исход оплаты неизвестен; повтор запрещён, сверяю запас в сумке и адену по ответу сервера',hint='Следующая по приоритету: Тур по РБ. TvT и обслуживание могут её прервать.';
 
 for(const [width,height,name] of [[1280,900,'wide'],[460,844,'dock'],[375,620,'compact']]){
  await h.popup.setViewportSize({width,height});
  const r=await h.popup.evaluate(([text,hint])=>{document.documentElement.classList.add('docked');const p=document.getElementById('activityPanel');p.dataset.state='running';document.getElementById('quickStart').hidden=true;
   document.getElementById('activityState').textContent='Движок активен';const t=document.getElementById('activityText'),x=document.getElementById('activityHint');t.textContent=text;x.textContent=hint;
   const lh=e=>parseFloat(getComputedStyle(e).lineHeight);return {tH:t.getBoundingClientRect().height,tL:lh(t),tFull:t.scrollHeight<=t.clientHeight+1,hH:x.getBoundingClientRect().height,hL:lh(x),pH:p.getBoundingClientRect().height,overflowX:document.body.scrollWidth>innerWidth};},[text,hint]);
  assert.equal(r.overflowX,false,name+': no horizontal overflow');
  assert.ok(r.tH<=r.tL*2+1,name+': status ≤2 lines');assert.ok(r.hH<=r.hL*2+1,name+': hint ≤2 lines');
  if(name!=='wide')assert.ok(r.tH>r.tL*1.5,name+': long status wraps to second line instead of «…»');
  assert.ok(r.pH<=120,name+': panel stays compact ('+r.pH+')');
  assert.ok((await h.popup.locator('section.act').boundingBox()).height>120,name+': content remains usable');
  
 }
 assert.deepEqual(h.errors,[]);
 console.log("PASS v2143-activity-wrap-browser");
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
