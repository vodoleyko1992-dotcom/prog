'use strict';
// 20.41 (лог 20.10 21:09: память rt 1,3 МБ, «бот стал очень медленный»): настоящий MV3 — у фона нет слушателей storage.onChanged,
// значок «работает/стоит» рисуют сами писатели «on» (Start/Stop меню), прямую остановку модуля — badgeSync, «!» капчи
// не стирается повторной остановкой; ревью 20.41: «Очистить журнал» фону ничего не шлёт — первый снимок после очистки сам считает
// объём с нуля (пустое хранилище снимков = 0 байт). HTTPS ответы только локальные.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness();
 try{
  const badge=()=>h.sw.evaluate(()=>chrome.action.getBadgeText({}));
  assert.equal(await h.sw.evaluate(()=>chrome.storage.onChanged.hasListeners()),false,'фон не слушает storage.onChanged');
  await until(async()=>await badge()==='');
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));await until(async()=>await badge()==='ON');
  console.log('PASS Start из меню → значок ON без слушателя хранилища');
  // modules/fishing.js / dungeons.js при stopAfter: прямая запись on:false и badgeSync
  await h.g.core('chrome.storage.local.set({on:false}).then(()=>{badgeSync();return true})');
  await until(()=>h.g.core('!on && !running'));await until(async()=>await badge()==='');
  console.log('PASS прямая остановка модуля + badgeSync → значок погас, вкладка остановилась');
  await h.g.core('ipc({cmd:"alert",id:"badge-test",title:"Проверка",text:"Проверка значка"}).catch(()=>true).then(()=>true)');await until(async()=>await badge()==='!');
  const control=()=>h.popup.evaluate(()=>chrome.runtime.sendMessage({cmd:'botControl',action:'stop',source:'badge-browser-test',reason:'Повторный стоп'}));
  assert.equal((await control()).ok,true);await new Promise(r=>setTimeout(r,300));assert.equal(await badge(),'!','повторная остановка не стирает «!»');
  await h.g.core('ipc({cmd:"badgeSync"}).catch(()=>true).then(()=>true)');await new Promise(r=>setTimeout(r,300));assert.equal(await badge(),'!','badgeSync при неизменном «on» не стирает «!»');
  await h.g.core('ipc({cmd:"alertClear",id:"badge-test"}).catch(()=>true).then(()=>true)');await until(async()=>await badge()==='');
  console.log('PASS «!» капчи держится до alertClear');
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));await until(async()=>await badge()==='ON');
  assert.equal((await control()).ok,true);await until(()=>h.g.core('!on && !running'));await until(async()=>await badge()==='');
  console.log('PASS Stop через botControl → значок погас');
  // ревью 20.41: настоящая кнопка «Удалить журнал и снимки» в меню; в памяти фона — старая сумма почти полного хранилища (49,5 МБ)
  const MB=1024*1024,K=300*1024;
  await h.sw.evaluate(async MB=>{await writing;addSnap({key:'clr-old',state:'',html:'o'.repeat(1000)});await writing;await chrome.storage.local.set({snapbytes:49.5*MB});snapBytes=49.5*MB;},MB);
  await h.reveal('#recClear');await h.popup.evaluate(()=>{const d=document.getElementById('recClear').closest('details');if(d)d.open=true;});await h.popup.locator('#recClear').click();await h.popup.locator('#recClear').click();
  await until(async()=>{const s=await h.get(['snapbytes','snapcount']);return s.snapbytes===0&&s.snapcount===0;});
  assert.equal(await h.sw.evaluate(()=>snapBytes),49.5*MB,'меню фону ничего не шлёт — в памяти фона прежняя сумма');
  const snapState=()=>h.sw.evaluate(async()=>{await writing;const db=await idb(),keys=await new Promise(r=>{const q=db.transaction('snaps').objectStore('snaps').getAllKeys();q.onsuccess=()=>r(q.result);});return {keys:keys.sort(),mem:snapBytes,...await chrome.storage.local.get(['snapbytes','snapcount'])};});
  await h.sw.evaluate(K=>{for(const k of ['a','b','c','d','e'])addSnap({key:'clr-'+k,state:'',html:k.repeat(K)});},K);
  let st=await snapState();
  assert.deepEqual(st.keys,['clr-a','clr-b','clr-c','clr-d','clr-e'],'новые снимки не вытеснены «сверх 50 МБ»');assert.equal(st.snapbytes,5*K);assert.equal(st.mem,5*K);assert.equal(st.snapcount,5);
  await h.sw.evaluate(K=>{snapBytes=null;addSnap({key:'clr-f',state:'',html:'f'.repeat(K)});},K);   // как после перезапуска фона: сумма из хранилища
  st=await snapState();assert.equal(st.keys.length,6);assert.equal(st.snapbytes,6*K);
  console.log('PASS «Очистить журнал» без сообщения фону: снимки после очистки сохранены, объём верный (и после перечитывания)');
  assert.equal(await h.sw.evaluate(()=>chrome.storage.onChanged.hasListeners()),false);
  assert.deepEqual(h.errors,[]);console.log('PASS MV3: значок и сторож без слушателей storage.onChanged в фоне');
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
