'use strict';
// Настоящее MV3, игровая вкладка и API полностью локальные; никакого аккаунта.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 const day=new Date(Date.now()+10*3600000).toISOString().slice(0,10);
 await h.sw.evaluate(async day=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['raid','fish','auto','tvt'],dailyFishLimit:10,dailyKillLimit:500,autoKillLimit:200,limitRanges:{}},rt:{...rt,status:'Жду доступного РБ; дневной лимит рыбалки выполнен',dailyQuota:{day,fish:10,auto:80},farmQuota:{auto:{limit:200,got:80}},rbHunt:{phase:'wait'},rbFishWait:{at:Date.now(),until:Date.now()+60000}}})},day);
 await h.popup.reload();await until(()=>h.popup.locator('#taskBoardRows .task-row:not([data-task-summary])').count().then(n=>n===4));await h.openTab('overview');
 assert.match(await h.popup.locator('#activityText').innerText(),/Выберите, чем заняться/);assert.equal(await h.popup.locator('#quickStart').isVisible(),true);   // 18.10: быстрый запуск вместо «после «Старт»»
 assert.match(await h.popup.locator('#activityText').getAttribute('title'),/Последнее:/);   // 18.10: бот стоит — строка «Последнее» уходит в подсказку, место под быстрый запуск
 assert.match(await h.popup.locator('#taskBoardRows').innerText(),/Сегодня: 10 \/ 10/);
 assert.match(await h.popup.locator('#taskBoardRows').innerText(),/До 00:00 сервера/);
 assert.equal((await h.get(['on'])).on,false);
 await h.popup.locator('#taskBoardRows [data-task-tab="limits"]').first().click();assert.equal(await h.popup.locator('#tab-limits').isVisible(),true);await h.openTab('overview');
 await h.popup.locator('#taskBoardEdit').click();assert.equal(await h.popup.locator('#autoTaskSelection').isVisible(),true);assert.equal(await h.popup.locator('#modeToggle').getAttribute('aria-expanded'),'true');
 await h.openTab('hunt');await h.popup.locator('#tab-hunt').evaluate(e=>e.scrollTop=400);const before=await h.popup.locator('#tab-hunt').evaluate(e=>e.scrollTop);await h.openTab('overview');await h.openTab('hunt');assert.equal(await h.popup.locator('#tab-hunt').evaluate(e=>e.scrollTop),before);assert.ok(before>0);assert.equal(await h.popup.locator('nav [data-tab="hunt"]').getAttribute('aria-current'),'page');
 const head=h.popup.locator('#tab-hunt .card>.ch').first();await head.focus();const expanded=await head.getAttribute('aria-expanded');await head.press('Enter');assert.notEqual(await head.getAttribute('aria-expanded'),expanded);await head.press('Enter');assert.equal(await head.getAttribute('aria-expanded'),expanded);
 console.log('PASS actual MV3 board: quota/series progress, correct stopped action, limits link, task selector, retained scroll, keyboard/aria disclosure');
 // Отклонённая запись через реальный popup→фон: источник expectedChar специально устарел.
 await h.openTab('panel');await h.popup.evaluate(()=>{formChar='StaleHero';document.getElementById('hpPotAt').value='31';return save({target:document.getElementById('hpPotAt')}).catch(()=>{});});
 await until(()=>h.popup.locator('#settingsFeedback').isVisible());assert.match(await h.popup.locator('#settingsFeedback').innerText(),/не сохранены/);assert.notEqual((await h.get(['cfg'])).cfg.hpPotAt,31);
 // 19.10.2026: чужая ошибка сохраняется в памяти исходной формы, но не выдаётся за ошибку текущего героя.
 await h.popup.evaluate(()=>load());assert.equal(await h.popup.locator('#settingsFeedback').isVisible(),false);
 // Возвращаем контекст неудавшейся формы: retry по-прежнему не пишет настройки в активный профиль.
 const cfgBefore=(await h.get(['cfg'])).cfg;await h.popup.evaluate(()=>{formChar='StaleHero';paintSettingsFeedback();});
 await h.popup.locator('#settingsRetry').click();assert.match(await h.popup.locator('#settingsFeedback').innerText(),/Персонаж изменился/);assert.deepEqual((await h.get(['cfg'])).cfg,cfgBefore);
 // Новое изменение настоящего героя имеет свой ACK и честное подтверждение; прежний отказ не стирается.
 await h.popup.evaluate(()=>{document.activeElement?.blur();return load()});await h.popup.evaluate(()=>{document.getElementById('hpPotAt').value='37';return save({target:document.getElementById('hpPotAt')})});assert.equal((await h.get(['cfg'])).cfg.hpPotAt,37);assert.match(await h.popup.locator('#settingsState').innerText(),/сохранены/);assert.equal(await h.popup.locator('#settingsFeedback').isVisible(),false);
 await h.popup.evaluate(()=>{formChar='StaleHero';paintSettingsFeedback();});assert.equal(await h.popup.locator('#settingsFeedback').isVisible(),true);assert.match(await h.popup.locator('#settingsFeedback').innerText(),/Персонаж изменился/);
 console.log('PASS actual MV3 storage refusal: original hero retains error, safe character-bound retry, current hero has independent success');
 await h.popup.locator('#settingsDiscard').click();await until(()=>h.popup.locator('#settingsFeedback').isHidden());
 // Имитируем краткий отказ транспорта, сохраняя настоящий фон для следующей попытки.
 await h.popup.evaluate(()=>{window.originalSendMessage=chrome.runtime.sendMessage;chrome.runtime.sendMessage=request=>request.cfgPatch?.hpPotAt===31?Promise.resolve({ok:false,reason:'fixture storage failure'}):window.originalSendMessage(request);document.getElementById('hpPotAt').value='31';return save({target:document.getElementById('hpPotAt')}).catch(()=>{});});
 await h.popup.evaluate(()=>{document.activeElement?.blur();return load()});assert.equal(await h.popup.locator('#hpPotAt').inputValue(),'31');assert.equal((await h.get(['cfg'])).cfg.hpPotAt,37);
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,hpPotAt:22},rt:{...rt,char:'OtherHero'}})});await until(()=>h.popup.locator('#heroLine').innerText().then(t=>t.includes('OtherHero')));await h.popup.evaluate(()=>{document.activeElement?.blur();return load()});assert.equal(await h.popup.locator('#hpPotAt').inputValue(),'22');
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,hpPotAt:37},rt:{...rt,char:'AuditHero'}})});await until(()=>h.popup.locator('#heroLine').innerText().then(t=>t.includes('AuditHero')));await h.popup.evaluate(()=>load());assert.equal(await h.popup.locator('#hpPotAt').inputValue(),'31');
 await h.popup.evaluate(()=>{chrome.runtime.sendMessage=window.originalSendMessage});await h.popup.locator('#settingsRetry').click();await until(async()=>(await h.get(['cfg'])).cfg.hpPotAt===31);assert.equal(await h.popup.locator('#settingsFeedback').isVisible(),false);
 console.log('PASS actual MV3 transient failure: correct draft across character switch and exact-field retry to original profile');

 // Снимки обычного состояния: ошибка теста убирается только из памяти текущего popup.
 await h.popup.reload();await until(()=>h.popup.locator('#settingsFeedback').isHidden());await h.openTab('overview');
 fs.mkdirSync(__dirname+'/../work',{recursive:true});
 for(const [width,height,name] of [[1280,900,'wide'],[390,844,'narrow'],[375,620,'compact']]){
  await h.popup.setViewportSize({width,height});await h.popup.evaluate(()=>{document.documentElement.classList.add('docked');document.getElementById('quickModeGrid').hidden=true;document.getElementById('modeToggle').setAttribute('aria-expanded','false')});
  assert.ok(await h.popup.evaluate(()=>document.body.scrollWidth<=innerWidth),name+': no horizontal overflow');
  assert.ok((await h.popup.locator('section.act').boundingBox()).height>120,name+': content remains usable');
  await h.popup.screenshot({path:__dirname+'/../work/rework-ui-'+name+'.png',fullPage:true});
 }
 // Самый тесный режим: раскрытые задачи и одновременно два отказа не закрывают настройки.
 await h.popup.setViewportSize({width:375,height:620});await h.popup.evaluate(()=>{document.getElementById('quickModeGrid').hidden=false;document.getElementById('settingsFeedback').hidden=false;document.getElementById('settingsFeedbackText').textContent='Не удалось сохранить настройки. '.repeat(4);document.getElementById('controlWarn').hidden=false;document.getElementById('controlWarn').textContent='Не удалось остановить бота: временно недоступен фон. Повторите команду.';});
 assert.ok((await h.popup.locator('section.act').boundingBox()).height>=170);await h.popup.locator('.workarea').evaluate(e=>e.scrollTop=e.scrollHeight);const section=await h.popup.locator('section.act').boundingBox(),footer=await h.popup.locator('footer').boundingBox();assert.ok(section.y<footer.y,'content accessible by outer scroll');assert.ok(section.y+section.height<=footer.y+1,'content ends before footer');await h.popup.screenshot({path:__dirname+'/../work/rework-ui-compact-errors.png',fullPage:true});
 console.log('PASS actual MV3 375×620 with expanded tasks and simultaneous persistent errors: settings remain accessible');
 assert.equal((await h.get(['on'])).on,false);assert.deepEqual(h.errors,[]);assert.ok(h.requests.every(x=>x.method==='GET'));
 console.log('PASS actual MV3 1280/390/375 px screenshots and no overflow; no actions/POST/errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
