'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),html=read('popup.html'),js=read('popup.js'),ui=read('ui-v7.js');
for(const id of ['tasksToggle','farmToggle','autoFarmToggle','huntToggle','epicToggle','fishToggle','catToggle','enchantToggle','campToggle','tvtToggle']){
 assert.ok(!html.includes('id="'+id+'"'),'legacy duplicate removed '+id);
 assert.ok(!js.includes("$('"+id+"')"),'no dangling handler '+id);
}
for(const task of ['raid','fish','tvt','quests','mammon','enchant','petbuff'])assert.match(html,new RegExp('data-auto-task="'+task+'"'));
// 20.7: поля удалённой отправки крафтеру больше не являются настройками меню.
for(const id of ['start','stop','pause','mmOrders','mmUpgrade','enchantModeToggle','petFullToggle'])assert.ok(html.includes('id="'+id+'"'),'detailed setting retained '+id);
assert.ok(html.indexOf('id="petFullToggle"')>html.indexOf('<section id="tab-warlock">'));
assert.ok(ui.includes("querySelectorAll('[data-auto-task]:checked')"));assert.ok(!ui.includes("querySelectorAll('button.on')"));
assert.ok(!html.includes('Быстрые режимы'));assert.ok(html.includes('Рыбалка и фарм не чередуются'));
console.log('PASS single task panel, retained detailed settings, no dangling legacy handlers, canonical summary');
// Реальный обработчик первого изменения переводит legacy профиль в allowlist, не запуская бота.
const vm=require('node:vm');const state={cfg:{autoTasks:null,fishMode:true,taskOnly:true,mmCraftSend:true,mmCrafter:'Craft',shopReserve:123456},rt:{dailyFish:{old:true}},on:false};
const context={Date,Object,Set,Promise,DEF:{},chrome:{storage:{local:{get:async()=>({cfg:state.cfg})}}},load:async()=>{},
 menuPatch:async(p,o)=>{Object.assign(state.rt,p);Object.assign(state.cfg,o.cfgPatch)}};
const start=js.indexOf('const AUTO_TASK_LABELS ='),end=js.indexOf('function currentMode(',start);
vm.runInNewContext(js.slice(start,end)+'\nthis.selected=selectedAutoTasks;this.edit=editAutoTask;',context);
assert.deepEqual(Array.from(context.selected(state.cfg)),['fish']);
(async()=>{await context.edit('raid',true);assert.deepEqual(Array.from(state.cfg.autoTasks),['fish','raid']);assert.equal(state.on,false);assert.equal(state.cfg.mmCrafter,'Craft');assert.equal(state.cfg.shopReserve,123456);assert.equal(state.rt.dailyFish,null);
 await context.edit('fish',false);assert.ok(!state.cfg.autoTasks.includes('fish'));assert.equal(state.cfg.fishMode,true,'raw setting сохранён, ограничивает allowlist');console.log('PASS actual task edit: legacy migration, strict selection, settings and Stop preserved');})().catch(e=>{console.error(e);process.exitCode=1});
