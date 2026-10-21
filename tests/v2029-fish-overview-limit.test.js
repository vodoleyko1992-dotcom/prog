'use strict';
// 20.10: выбранная рыбалка показывает лимит и дневной счёт до запуска, при нуле и после смены суток.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../engine-core.js'),source=fs.readFileSync(__dirname+'/../popup.js','utf8');
const context={L2EngineCore:E,selectedAutoTasks:d=>d.autoTasks,AUTO_TASK_LABELS:{fish:'Рыбалка'},AUTO_MAIN_TASKS:['fish'],TASK_TABS:{fish:'fish'},Date};
vm.runInNewContext(source.slice(source.indexOf('function taskBoardRows('),source.indexOf('// 19.10: дневные мобы')),context);
const now=Date.parse('2026-10-20T08:00:00Z'),day=E.dailyDay(now),state={on:false};
function row(cfg={},rt={}){return context.taskBoardRows({dailyQuota:{day,fish:100},...rt},{autoTasks:['fish'],dailyFishLimit:1511,fishMaxCasts:0,...cfg},state,now)[0];}
test('до выбора дневного диапазона видны счёт и границы, без выдуманного процента',()=>{
 const r=row({limitRanges:{dailyFishLimit:{min:1511,max:1564}}});
 assert.match(r.progress,/Сегодня: 100/);assert.match(r.progress,/1511–1564/);assert.match(r.progress,/выберется при запуске/);assert.equal(r.percent,null);assert.equal(r.limits,true);assert.equal(r.state,'selected');
});
test('нулевой лимит сохраняет дневной счётчик и переход к лимитам',()=>{
 const r=row({dailyFishLimit:0});assert.match(r.progress,/Сегодня: 100.*без дневного лимита/);assert.equal(r.percent,null);assert.equal(r.limits,true);
});
test('точный лимит и выбранный сегодня диапазон показывают действующее число и остаток',()=>{
 for(const patch of [{},{limitRanges:{dailyFishLimit:{min:1511,max:1564}}}]){
  const r=row(patch,{limitRolls:{dailyFishLimit:{day,value:1511}}});assert.match(r.progress,/Сегодня: 100 \/ 1511.*осталось 1411/);assert.equal(r.percent,7);assert.doesNotMatch(r.progress,/выберется/);
 }
});
test('достигнутый лимит продолжает показывать ожидание сервера и остаток0',()=>{
 const r=row({dailyFishLimit:100});assert.equal(r.state,'waiting');assert.match(r.label,/сброса суток/);assert.match(r.progress,/сброс в \d\d:\d\d по Владивостоку/);   // 20.43: было «До 00:00 сервера»assert.equal(r.percent,100);assert.match(r.progress,/осталось 0/);
});
test('вчерашние счётчик и выбор диапазона не выглядят сегодняшним лимитом',()=>{
 const r=row({limitRanges:{dailyFishLimit:{min:1511,max:1564}}},{dailyQuota:{day:'2000-01-01',fish:1600},limitRolls:{dailyFishLimit:{day:'2000-01-01',value:1550}}});
 assert.match(r.progress,/Сегодня: 0/);assert.match(r.progress,/1511–1564/);assert.equal(r.percent,null);assert.equal(r.state,'selected');
});
test('отображение не изменяет настройки, выбранные задачи или дневные счётчики',()=>{
 const cfg={autoTasks:['fish'],dailyFishLimit:0},rt={dailyQuota:{day,fish:100}},before=JSON.stringify({cfg,rt});
 context.taskBoardRows(rt,cfg,state,now);assert.equal(JSON.stringify({cfg,rt}),before);
});
test('дневная сводка рыбы остаётся без выбранной рыбалки и не включает её',()=>{
 const cfg={autoTasks:[],dailyFishLimit:1511},rt={dailyQuota:{day,fish:100}},before=JSON.stringify({cfg,rt});
 assert.equal(context.taskBoardRows(rt,cfg,state,now).length,0);
 const r=context.dailyFishBoardRow(rt,cfg,now);
 assert.equal(r.summary,'fish');assert.equal(r.key,'daily-fish');assert.equal(r.limits,true);assert.equal(r.tab,'limits');
 assert.match(r.progress,/Сегодня: 100 \/ 1511.*осталось 1411/);assert.equal(r.percent,7);
 assert.equal(JSON.stringify({cfg,rt}),before);
 for(const d of [{...cfg,dailyFishLimit:0},{...cfg,limitRanges:{dailyFishLimit:{min:1511,max:1564}}}]){
  const summary=context.dailyFishBoardRow(rt,d,now);assert.equal(summary.limits,true);assert.match(summary.progress,/Сегодня: 100/);assert.equal(summary.percent,null);
 }
});
