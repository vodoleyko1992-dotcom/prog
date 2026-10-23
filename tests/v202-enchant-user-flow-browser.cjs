'use strict';
// Чистая установка → настоящий popup → content/main → память. Ответы сервера локальные. Ни аккаунта, ни реальной траты.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26).
// Прежний путь игрока «галка Автозаточка → вещи/лимиты → Старт → серия → POST» закрыт намеренно: галка скрыта и отключена,
// панели нет, команды серии отклоняются. Проверяем тот же путь чистой установки на действующем контракте: базовый профиль не
// выбирает заточку, галку нельзя нажать, поиск не ведёт в раздел, выбранная видимыми галками рыбалка запускается обычным Стартом,
// бот не открывает /enchant.html и не шлёт /game/inventory/enchant, команды серии отклонены.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness({cleanInstall:true}),traffic=[];try{
 const snapshot={name:'Warlock',revision:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']}},stacks:[{itemId:910527,qty:3},{itemId:4037,qty:99}]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesEn:{8688:'Daimon Crystal'}};
 await h.ctx.route('https://**/*',r=>{const req=r.request(),path=new URL(req.url()).pathname;traffic.push({path,method:req.method()});return r.fallback();});
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({json:{character:snapshot}}));
 await h.ctx.route('https://l2wap.com/character/catalog-hints',r=>r.fulfill({json:hints}));
 await h.ctx.route(/^https:\/\/l2wap\.com\/(?:map|fishing)\.html$/, r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="l2-hud-legacy-name">Warlock</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Warlock</div><div id="map-mob-list"></div>'}));
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof heroNick==="function"'));console.log('INITIAL IDENTITY',await h.g.core('({stored:rt.char,hud:heroNick(),on})'));
 const initial=await h.get(['cfg','rt','on']);assert.notEqual(initial.on,true);assert.ok(!initial.cfg.enchant?.queue?.length);assert.ok(!initial.rt.enchant?.runId);
 assert.ok(!(initial.cfg.autoTasks||[]).includes('enchant'),'base profile does not select enchant');assert.notEqual(initial.cfg.enchantMode,true);assert.notEqual(initial.cfg.enchant?.enabled,true);
 // Чистая установка: только пользовательские переключатели, никаких cfg/rt/queue injections.
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
 await h.tasks();   // 20.12 (ревизия 17.10): задачи — в «Обзоре»
 const enchant=h.popup.locator('[data-auto-task="enchant"]');assert.equal(await enchant.count(),1);assert.equal(await enchant.isVisible(),false);assert.equal(await enchant.isDisabled(),true);
 const before=(await h.get(['cfg'])).cfg.autoTasks;await enchant.click({force:true,timeout:3000}).catch(()=>{});await delay(500);
 assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,before);assert.equal(await enchant.isChecked(),false);
 assert.equal(await h.popup.evaluate(()=>searchIndex().some(r=>r.tab==='enchant')),false);
 console.log('PASS clean install: base profile without enchant; hidden disabled checkbox cannot be selected; search has no enchant section');
 // Видимыми галками оставляем одну рыбалку и запускаем обычным Стартом.
 const fish=h.popup.locator('[data-auto-task="fish"]');if(!await fish.isChecked()){await fish.click();await until(async()=>(await h.get(['cfg'])).cfg.autoTasks?.includes('fish'));}
 for(const key of (await h.get(['cfg'])).cfg.autoTasks.filter(k=>k!=='fish')){
  const el=h.popup.locator('[data-auto-task="'+key+'"]');if(!await el.isVisible())continue;
  await until(()=>el.isChecked());await el.click();await until(async()=>!(await h.get(['cfg'])).cfg.autoTasks.includes(key));
 }
 assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,['fish']);
 await h.popup.locator('#start').click();await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="fish"'),30000);
 for(const action of ['refresh','start']){const r=await h.sw.evaluate(async action=>{const [tab]=await chrome.tabs.query({url:'https://l2wap.com/*'});return chrome.tabs.sendMessage(tab.id,{cmd:'enchantCommand',id:crypto.randomUUID(),action,char:'Warlock'},{frameId:0});},action);assert.equal(r.ok,false,action);assert.match(r.reason,/Автозаточка временно убрана/);}
 await delay(2500);
 const state=await h.get(['cfg','rt']);assert.ok(!state.rt.enchant?.runId);assert.ok(!state.rt.enchantScan);assert.deepEqual(state.cfg.autoTasks,['fish']);
 assert.equal(traffic.filter(r=>r.path==='/enchant.html'||r.path==='/game/inventory/enchant').length,0);assert.equal(snapshot.inventory.stacks.find(x=>x.itemId===910527).qty,3);
 console.log('PASS visible task selection → Start → fish; series commands rejected; bot never opens /enchant.html or posts enchant; scrolls untouched');
 await h.popup.locator('#stop').click();await until(()=>h.g.core('!on && !running'),20000);assert.deepEqual(h.errors,[]);console.log('PASS Stop; no page errors');
}catch(e){console.error('FLOW DIAG',{state:await h.get(['cfg','rt']).catch(()=>null),errors:h.errors});throw e;}finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
