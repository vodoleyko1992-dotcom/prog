'use strict';
// Actual MV3 popup diagnostics; synthetic snapshots, no live or paid actions.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26):
// popup.js не монтирует L2EnchantUI (enchantUI = {refresh}), раздел и #enchantModeToggle скрыты, setMode('enchant') — без действия.
// Прежние проверки панели (шаги запуска, статус сканирования, запас свитков, очередь, переключатель режима) переведены так:
//  • в настоящем меню снимки enchantScan не рисуют панель, ничего не запускают и не меняют выбор задач;
//  • тот же сохранённый для возврата рендерер (enchant-ui.js, загружен popup.html) в контексте настоящего меню даёт прежние
//    диагностические тексты для тех же снимков — чтобы при возврате модуля они не потерялись.
const assert=require('node:assert/strict'),{harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:[],enchant:{enabled:false,queue:[],maxAttempts:0,maxScrolls:0}},rt:{...rt,enchant:null,enchantScan:null}})});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.openTab('enchant');
 const panel=h.popup.locator('#enchantPanel');
 assert.equal(await h.popup.locator('#tab-overview').isVisible(),true);assert.equal(await panel.locator('*').count(),0);assert.equal(await h.popup.locator('#enchantModeToggle').isVisible(),false);
 const D=(fn,...a)=>h.popup.evaluate(({fn,a})=>L2EnchantUI[fn](...a),{fn,a});
 assert.equal((await D('startSteps',{on:false,cfg:{autoTasks:[]},rt:{char:'AuditHero'}},await h.popup.evaluate(()=>structuredClone(L2EnchantUI.DEFAULT)),null)).length,5);
 async function scan(value){await h.sw.evaluate(async value=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,enchantScan:{...value,char:rt.char,t:Date.now()}}})},value);await delay(400);
  assert.equal(await panel.locator('*').count(),0,'hidden panel is not rendered by storage updates');return {...value,char:'AuditHero'};}
 let s=await scan({ok:true,items:[{level:25},{level:3,ambiguous:true}],scrolls:{910510:2,910527:3}});
 assert.match(await D('scanSummary',s,'AuditHero'),/Неоднозначных экземпляров: 1/);assert.match(await D('scanSummary',s,'AuditHero'),/Уже \+25: 1/);assert.match(await D('scrollSummary',s,'AuditHero'),/Обычные · D · броня: 2; Благословенные · A · оружие: 3/);
 s=await scan({ok:false,reason:'Тестовая ошибка чтения'});assert.match(await D('scanSummary',s,'AuditHero'),/Тестовая ошибка/);
 s=await scan({ok:true,items:[],scrolls:{}});assert.match(await D('scanSummary',s,'AuditHero'),/Нет подходящих/);assert.match(await D('scrollSummary',s,'AuditHero'),/Покупки отключены/);
 await scan({ok:true,items:[{itemId:1,targetInstanceId:'eq:l1',fingerprint:'a',name:'Тестовый меч',level:3,grade:'A',category:'weapon',eqSlot:'l1'}],scrolls:{910527:3}});
 let state=await h.get(['on','cfg']);assert.equal(state.on,false);assert.deepEqual(state.cfg.enchant.queue,[]);assert.equal(state.cfg.enchant.maxAttempts,0);
 console.log('PASS hidden enchant panel: diagnostics snapshots do not render or start anything; preserved renderer texts (5 steps, ambiguous/+25, error, empty, stock) intact');
 // Прежний «выбранный» режим рядом с рыбалкой: переключатель скрыт, setMode('enchant') не меняет выбор, бот не стартует.
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:['enchant','fish']},rt:{...rt,enchant:{runId:'done',char:rt.char,status:'done',items:[],history:[],totals:{attempts:0,scrolls:0,unknown:0,byScroll:{}}}}})});
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.tasks();
 assert.equal(await h.popup.locator('#enchantModeToggle').isVisible(),false);await until(()=>h.popup.locator('[data-auto-task="fish"]').isChecked());assert.equal(await h.popup.locator('[data-auto-task="enchant"]').isVisible(),false);
 for(const enabled of [false,true])await h.popup.evaluate(enabled=>setMode('enchant',enabled),enabled);
 await delay(500);state=await h.get(['on','cfg','rt']);assert.deepEqual(state.cfg.autoTasks,['enchant','fish']);assert.equal(state.on,false);assert.equal(state.rt.enchant.status,'done');assert.deepEqual(h.errors,[]);
 console.log('PASS done series beside fish: enchant toggle hidden, setMode(enchant) is a no-op, fish stays selected, bot stays OFF');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
