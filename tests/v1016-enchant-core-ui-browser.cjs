'use strict';
// 15.10: выполнение серии требует явно выбранного отдельного режима заточки.
// Настоящее MV3 расширение в изолированном профиле. Все ответы игры локальные.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26).
// Панель меню больше не монтируется, refresh/start/resume отклоняются — прежние шаги «обновить вещи → добавить → Старт серии»
// невозможны. Исходный смысл проверки сохраняем на действующем контракте: открытие раздела не выбирает режим и не запускает бота,
// чтение вещей при OFF не выполняется, сохранённая очередь точных экземпляров переживает записи меню, фон отклоняет запись
// чужому герою, прежний режим не запускает серию, остановленная сессия переживает reload без перезапуска.
// Сама логика очереди/экземпляров проверяется модульно (v1016-enchant-public-browser.cjs, tests/*enchant*.test.js).
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness();try{
 const character={name:'AuditHero',revision:77,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:2,enchantPAtkBonus:6,enchantMAtkBonus:6,weaponEnchantHistory:['physical','magic']}},stacks:[{itemId:8688,enchant:2,enchantPAtkBonus:6,enchantMAtkBonus:6,weaponEnchantHistory:['magic','physical'],qty:1},{itemId:910527,qty:20}]}};
 const catalog={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesEn:{8688:'Daimon Crystal'}};
 const reads=[];
 await h.ctx.route('https://l2wap.com/character',r=>{reads.push(Date.now());return r.fulfill({json:{character}});});
 await h.ctx.route('https://l2wap.com/character/catalog-hints',r=>{reads.push(Date.now());return r.fulfill({json:catalog});});
 const posts=()=>h.requests.filter(r=>r.method==='POST').length;
 const command=(action,extra={})=>h.sw.evaluate(async({action,extra})=>{const [tab]=await chrome.tabs.query({url:'https://l2wap.com/*'});return chrome.tabs.sendMessage(tab.id,{cmd:'enchantCommand',id:crypto.randomUUID(),action,char:'AuditHero',...extra},{frameId:0});},{action,extra});
 const ui=h.popup.locator('#enchantPanel');
 await h.popup.evaluate(()=>showTab('enchant'));   // 20.12 (ревизия 17.10): старое имя раздела; с 20.25 ведёт в «Обзор»
 assert.equal(await h.popup.locator('#tab-overview').isVisible(),true);assert.equal(await h.popup.locator('#tab-enchant').isVisible(),false);
 assert.equal(await ui.locator('*').count(),0,'enchant panel is not mounted');assert.equal(await h.popup.locator('#enchantModeToggle').isVisible(),false);
 assert.equal((await h.get(['on'])).on,false);assert.notEqual((await h.get(['cfg'])).cfg.enchantMode,true);assert.equal(posts(),0);console.log('PASS opening hidden enchant section never selects mode or starts bot; panel not mounted');
 // Прежний «Обновить вещи» при OFF — то же сообщение content; чтения инвентаря нет, снимок не пишется.
 const mark=reads.length,answer=await command('refresh');assert.equal(answer.ok,false);assert.match(answer.reason,/Автозаточка временно убрана/);await delay(800);
 assert.equal(reads.length,mark,'no inventory read for refresh');assert.equal((await h.get(['rt'])).rt.enchantScan??null,null);assert.equal((await h.get(['on'])).on,false);assert.equal(posts(),0);console.log('PASS off refresh rejected by real content before any GET; no scan, bot stays OFF');
 // Очередь двух точных экземпляров (надетый и в сумке) из прежней версии сохраняется при записях меню.
 const queue=[{key:'eq-key',itemId:8688,targetInstanceId:'eq:l1',fingerprint:JSON.stringify([8688,2,6,6,['physical','magic'],0,'']),level:2,targetLevel:4,category:'weapon'},
  {key:'bag-key',itemId:8688,targetInstanceId:'bag:8688:2:6:6:Hmp',fingerprint:JSON.stringify([8688,2,6,6,['magic','physical'],0,'']),level:2,targetLevel:4,category:'weapon'}];
 const saved={enabled:true,queue,scrollPolicy:'mixed',maxAttempts:8,maxScrolls:8};
 await h.sw.evaluate(async enchant=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:['enchant'],enchantMode:true,enchant}});},saved);
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.tasks();
 assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isVisible(),false);assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isDisabled(),true);
 const fish=h.popup.locator('[data-auto-task="fish"]');await fish.check();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks?.includes('fish'));
 await fish.uncheck();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
 let cfg=(await h.get(['cfg'])).cfg;assert.ok(!cfg.autoTasks.includes('enchant'),'menu write drops hidden task');assert.deepEqual(cfg.enchant.queue,queue);assert.equal(cfg.enchant.queue[0].key!==cfg.enchant.queue[1].key,true);
 assert.equal(cfg.enchant.maxAttempts,8);assert.equal(cfg.enchant.scrollPolicy,'mixed');assert.equal((await h.get(['on'])).on,false);
 console.log('PASS saved exact equipped/bag queue (keys, fingerprints, limits) survives menu task writes; hidden task not reselected');
 // Старый UI снимок нельзя записать другому герою даже при ответе storage между await.
 const denied=await h.popup.evaluate(async()=>chrome.runtime.sendMessage({cmd:'menuPatch',rtPatch:{},cfgPatch:{enchant:{enabled:true,queue:[{key:'wrong'}]}},expectedChar:'OtherHero'}));assert.equal(denied.ok,false);assert.equal((await h.get(['cfg'])).cfg.enchant.queue.length,2);console.log('PASS background transaction rejects stale-character configuration');
 // Прежний флаг режима при Старте: цикл идёт в общем ожидании, серия не создаётся, POST нет.
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:null,enchantMode:true}});});
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));await delay(1500);
 assert.equal(await h.g.core('cfg.enchantMode'),false);assert.equal(await h.g.core('autonomyMode()'),'tasks');assert.equal((await h.get(['rt'])).rt.enchant?.runId,undefined);
 for(const action of ['start','resume']){const r=await command(action);assert.equal(r.ok,false,action);assert.match(r.reason,/Автозаточка временно убрана/);}
 assert.equal(posts(),0);console.log('PASS legacy enchant mode starts the general loop only; series start/resume rejected; 0 POST');
 // Сохранённая серия прежней версии: работающий бот ставит её на паузу, Stop и reload не перезапускают.
 const totals={attempts:0,successes:0,failures:0,scrolls:0,adena:0,col:0,unknown:0,reservedScrolls:0,latencyMs:0,samples:0,conflicts:0,byScroll:{}};
 await h.g.core('setRt({enchant:'+JSON.stringify({v:1,char:'AuditHero',runId:'saved-run',status:'running',reason:'',startedAt:1,items:[],totals,history:[],pending:null,nextAt:0,conflicts:0})+'})');
 await until(async()=>(await h.get(['rt'])).rt.enchant?.status==='paused');
 await h.click('stop');await until(async()=>!(await h.get(['on'])).on);assert.equal(posts(),0);console.log('PASS saved running series → paused by the real loop; global Stop, no fixture mutation');
 const run=(await h.get(['rt'])).rt.enchant.runId;await h.g.p.reload();await until(()=>h.g.core('typeof on!=="undefined"'));await delay(800);
 const after=(await h.get(['rt','on']));assert.equal(after.rt.enchant.runId,run);assert.equal(after.rt.enchant.status,'paused');assert.equal(after.on,false);console.log('PASS stopped session survives document reload without restart');
 assert.deepEqual(h.errors,[]);console.log('PASS no page errors');
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
