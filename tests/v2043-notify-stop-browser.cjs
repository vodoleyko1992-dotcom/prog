'use strict';
// 20.43 (разбор 21.10): настоящий MV3 — самоостановка вкладки (halt) даёт «!» на значке, уведомление l2bot-stop и постоянную строку
// причины в меню (#stopWarn); Старт снимает всё; ручной Стоп — без «!»; пауза из-за сбоя при лежащем сервере (/game/time 502) не ставится,
// бот ждёт сервер; пауза без fault («один РБ») — сразу, с «!» и строкой «Сам встал на паузу». HTTPS ответы только локальные.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const h=await harness();
 try{
  const badge=()=>h.sw.evaluate(()=>chrome.action.getBadgeText({}));
  const notes=()=>h.sw.evaluate(()=>chrome.notifications?.getAll?.().catch(()=>({}))||{});
  const warn=async()=>{await h.popup.evaluate(()=>load());return h.popup.evaluate(()=>{const w=document.getElementById('stopWarn');return w.hidden?'':w.textContent;});};
  await until(async()=>await badge()==='');
  assert.equal(await h.popup.locator('#notifyStops').isChecked(),true,'галка «Уведомлять об остановках» ВКЛ по умолчанию');
  // 1) самоостановка вкладки (не hard: сервер отвечает — останавливаемся, как раньше)
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));await until(async()=>await badge()==='ON');
  await h.g.core("halt('Клик по мобу 3 раза подряд не открыл бой — проверьте игру').then(()=>true)");
  await until(()=>h.g.core('!on'));await until(async()=>await badge()==='!');
  assert.equal((await h.get(['stopMeta'])).stopMeta.source,'content-halt');
  const n1=await notes();console.log('notifications after halt:',JSON.stringify(n1));
  assert.match(await warn(),/^Остановлен сам в \d\d:\d\d: Клик по мобу 3 раза подряд не открыл бой/);
  assert.equal(await h.popup.locator('#stopWarn').isVisible(),true,'строка видна без наведения мыши');
  console.log('PASS halt → «!» на значке и постоянная строка причины в меню');
  // 2) Старт снимает «!», уведомление и строку
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));await until(async()=>await badge()==='ON');
  assert.ok((await h.get(['stopMeta'])).stopMeta.resumed,'stopMeta.resumed после Старта');assert.equal(await warn(),'');
  assert.equal(Object.hasOwn(await notes(),'l2bot-stop'),false,'уведомление снято Стартом');
  console.log('PASS Старт снимает «!», уведомление и строку');
  // 3) пауза из-за сбоя при лежащем сервере — ждём сервер, паузы нет
  await h.ctx.route('https://l2wap.com/game/time',r=>r.fulfill({status:502,contentType:'text/html',body:'<html>502 Bad gateway</html>'}));
  await h.g.core("(pauseBot('Тур РБ: карта не загрузилась после обновления; цель Test сохранена. Проверь игру и продолжи',{fault:true}),true)");
  await delay(2500);
  const s3=await h.get(['on','paused']);assert.equal(s3.on,true,'бот не встал на паузу');assert.equal(s3.paused??null,null);assert.equal(await badge(),'ON');
  await h.ctx.unroute('https://l2wap.com/game/time');
  console.log('PASS пауза из-за сбоя при 502 /game/time — бот ждёт сервер, не встаёт на паузу');
  // 4) ручной Стоп из меню — без «!» и без строки
  await h.popup.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await until(async()=>await badge()==='');
  assert.equal(await warn(),'');
  console.log('PASS ручной Стоп — без «!» и без строки причины');
  // 5) пауза без fault («один РБ») — сразу, «!» и «Сам встал на паузу»
  await h.click('start');await until(async()=>(await h.get(['on'])).on);
  await until(()=>h.g.core('on && tabOwner'),30000);
  await h.g.core("pauseBot('🎯 По одному РБ: РБ убит (1-й по команде) — жду команды').then(()=>true)");
  await until(async()=>!!(await h.get(['paused'])).paused);await until(async()=>await badge()==='!');
  assert.match(await warn(),/^Сам встал на паузу в \d\d:\d\d: 🎯 По одному РБ/);
  console.log('PASS пауза от бота → «!» и строка «Сам встал на паузу»');
  // 6) галка ВЫКЛ — значок как раньше
  await h.popup.evaluate(()=>{const b=document.getElementById('pause');b.click();});await until(async()=>(await h.get(['on'])).on);await until(async()=>await badge()==='ON');
  await h.reveal('#notifyStops');await h.popup.locator('#notifyStops').uncheck();await until(async()=>(await h.get(['cfg'])).cfg.notifyStops===false);
  await until(()=>h.g.core('on && tabOwner'),30000);
  // жёсткий стоп: обычный halt молча отменяется, если смена настроек меню успела сменить поколение действий во время проверки сервера
  await h.g.core("halt('Персонаж погиб', true).then(()=>true)");await until(async()=>!(await h.get(['on'])).on);await delay(500);
  assert.equal(await badge(),'','галка выключена — «!» нет');assert.match(await warn(),/^Остановлен сам в \d\d:\d\d: Персонаж погиб/,'строка причины в меню остаётся');
  console.log('PASS галка выключена: без «!», строка причины остаётся');
  assert.deepEqual(h.errors,[]);console.log('PASS MV3: уведомление и причина самоостановки');
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
