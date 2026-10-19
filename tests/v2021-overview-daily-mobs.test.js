'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../popup.js','utf8'),ctx={Date,L2EngineCore:require('../engine-core.js')};
vm.runInNewContext(source.slice(source.indexOf('function dailyMobBoardRow('),source.indexOf('function renderWorkspace(')),ctx);
const now=Date.parse('2026-10-19T03:00:00Z'),day='2026-10-19',cfg={dailyKillLimit:8000};
test('дневная сводка суммирует автофарм, катакомбы и соседей РБ, исключая рыбу и общую статистику',()=>{
 const row=ctx.dailyMobBoardRow({kills:99999,dailyQuota:{day,auto:1200,cat:300,raid:500,fish:1511}},cfg,now);
 assert.match(row.progress,/Сегодня: 2000 \/ 8000/);assert.match(row.progress,/осталось 6000/);assert.equal(row.percent,25);assert.equal(row.tab,'limits');
});
test('ровно достигнутый и превышенный лимит не дают отрицательный остаток или полосу свыше100%',()=>{
 for(const got of [8000,8011]){
  const row=ctx.dailyMobBoardRow({dailyQuota:{day,raid:got}},cfg,now);assert.equal(row.label,'Лимит достигнут');assert.equal(row.percent,100);assert.match(row.progress,/осталось 0$/);
 }
});
test('полночь сервера обнуляет только отображение вчерашнего счётчика',()=>{
 const rt={dailyQuota:{day:'2026-10-18',auto:8000}},before=JSON.stringify(rt),edge=Date.parse('2026-10-18T21:00:00Z');
 assert.match(ctx.dailyMobBoardRow(rt,cfg,edge-1).progress,/Сегодня: 8000/);
 assert.match(ctx.dailyMobBoardRow(rt,cfg,edge).progress,/Сегодня: 0 \/ 8000/);assert.equal(JSON.stringify(rt),before);
});
test('до первого выбора дневного диапазона полоса и остаток не выдумываются',()=>{
 const row=ctx.dailyMobBoardRow({dailyQuota:{day,auto:30},limitRolls:{dailyKillLimit:{day:'2026-10-18',value:7500}}},{...cfg,limitRanges:{dailyKillLimit:{min:7000,max:8000}}},now);
 assert.match(row.progress,/Сегодня: 30 /);assert.match(row.progress,/цель выберется при запуске/);assert.doesNotMatch(row.progress,/осталось|\/ 8000/);assert.equal(row.percent,null);
});
test('выбранный на сегодня диапазон показывает действующее число',()=>{
 const row=ctx.dailyMobBoardRow({dailyQuota:{day,auto:3500},limitRolls:{dailyKillLimit:{day,value:7000}}},{dailyKillLimit:7000,limitRanges:{dailyKillLimit:{min:7000,max:8000}}},now);
 assert.match(row.progress,/3500 \/ 7000/);assert.equal(row.percent,50);
});
test('отключённый дневной лимит сохраняет счётчик без ложного ожидания',()=>{
 const row=ctx.dailyMobBoardRow({dailyQuota:{day,cat:20}},{dailyKillLimit:0},now);assert.match(row.progress,/Сегодня: 20 .*без дневного лимита/);assert.equal(row.percent,null);assert.equal(row.state,'selected');
});
test('отсутствие данных не рисует NaN и не меняет настройки или выбранные задачи',()=>{
 const rt={},d={...cfg,autoTasks:['fish']},before=JSON.stringify({rt,d}),row=ctx.dailyMobBoardRow(rt,d,now);
 assert.match(row.progress,/Сегодня: 0 \/ 8000/);assert.equal(row.percent,0);assert.equal(JSON.stringify({rt,d}),before);
});
