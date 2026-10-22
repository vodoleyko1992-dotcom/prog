'use strict';
// 22.10: отдельный режим крафта — выбор задачи, изоляция, меню очереди и защищённый быстрый запуск.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = f => fs.readFileSync(__dirname + '/../' + f, 'utf8'), js = read('popup.js'), html = read('popup.html');
const E = require('../engine-core.js'), D = require('../defaults.js');
const plain = x => JSON.parse(JSON.stringify(x));
const cut = (a,b) => { const i=js.indexOf(a), j=js.indexOf(b,i+1); assert.ok(i>=0&&j>i,a); return js.slice(i,j); };
const tasks = cut('const AUTO_TASK_LABELS =','const TASK_OWNED =') + '\n' + cut('function selectedAutoTasks(d) {','function autoTaskPatch(') + '\n' + cut('function currentMode(d) {','const MODE_NAME =');

test('режим без списка сильнее боевых режимов и не включён по умолчанию', () => {
  assert.equal(D.CFG.craftMode,false); assert.equal(D.CFG.craftMpPots,true);
  assert.equal(E.chooseMode({craft:true,epic:true,raid:true,fish:true,cat:true,campaign:true,tasks:true}),'craft');
  assert.equal(E.chooseMode({enchant:true,craft:true}),'enchant');
});
test('явная задача включает крафт без фоновой галки и бережёт изоляцию режима', () => {
  const raw={...D.CFG,autoTasks:['tvt','craft','raid','fish'],craftAuto:false,rbHuntMode:true,fishMode:true,autoMagister:true,shopAuto:true,chain:true};
  const c=E.taskConfig(raw,()=>({}));
  assert.equal(E.selectedTask(c,{}),'craft'); assert.equal(c.craftMode,true); assert.equal(c.craftAuto,false);
  for(const key of ['rbHuntMode','rbMode','fishMode','zoneAuto','chain','shopAuto','autoMagister','weaponClassEquip']) assert.equal(c[key],false,key);
  assert.equal(c.tvtOn,true); assert.equal(c.craftMpPots,true);
});
test('старый флаг без разрешённой задачи не включает крафт',()=>{
  const c=E.taskConfig({...D.CFG,autoTasks:['fish'],craftMode:true},()=>({}));
  assert.equal(c.craftMode,false);assert.equal(E.selectedTask(c,{}),'fish');
});
test('пустая и выполненная очереди остаются в выбранном режиме до решения игрока',()=>{
  for(const rt of [{},{craftQueue:[]},{craftQueue:[{id:'a',n:1}],craftMade:{a:1}}]) assert.equal(E.selectedTask({autoTasks:['craft','raid']},rt),'craft');
});
test('новый герой сам включает крафт, базовый профиль режим не переносит',()=>{
  const c=E.newHeroCfg({...D.CFG,craftMode:true,autoTasks:['tvt','craft','raid','fish']});
  assert.equal(c.craftMode,false);assert.deepEqual(c.autoTasks,['tvt','fish']);
  assert.equal(Object.hasOwn(E.baseProfileCfg({craftMode:true,craftMpPots:false}),'craftMode'),false);
  assert.equal(E.baseProfileCfg({craftMpPots:false}).craftMpPots,false);
});
test('несовместимые автоматические маршруты сняты, ручная проверка сумки разрешена',()=>{
  const c={autoTasks:['craft']};
  assert.equal(E.taskJobAllowed(c,'zoneGo',{zoneGo:{id:'x'}}),false);
  assert.equal(E.taskJobAllowed(c,'shop',{shop:{step:'count'}}),false);
  assert.equal(E.taskJobAllowed(c,'invScan',{invScan:{manual:true}}),true);
  assert.equal(E.taskJobAllowed(c,'rbHunt',{rbHunt:{step:'go'}}),false);
});
test('меню читает craft так же как ядро, фоновая галка не выбирает режим',()=>{
  const c={L2Defaults:D,L2EngineCore:E,Date};vm.runInNewContext(tasks,c);
  assert.deepEqual(plain(c.selectedAutoTasks({...D.CFG,autoTasks:['tvt','craft']})),['tvt','craft']);
  assert.equal(c.currentMode({autoTasks:['raid','craft']}),'craft');
  assert.equal(c.currentMode({craftMode:true}),'craft');
  assert.equal(c.currentMode({craftAuto:true}),'farm');
  assert.equal(c.selectedAutoTasks({craftMode:true}).includes('farm'),false);
});
test('доска крафта показывает пустую очередь, прогресс, неизвестный результат и готовность',()=>{
  const c={L2Defaults:D,L2EngineCore:E,Date};vm.runInNewContext(cut('const AUTO_TASK_LABELS =','let autoTaskEditQueue ='),c);
  const row=rt=>plain(c.taskBoardRows(rt,{autoTasks:['craft']},{on:true}))[0];
  assert.equal(row({}).label,'Добавьте рецепты в очередь');
  assert.equal(row({craftQueue:[{id:'a',n:10}],craftMade:{a:3}}).percent,30);
  assert.equal(row({craftQueue:[{id:'a',n:10}],craftMade:{a:10}}).label,'Очередь выполнена');
  assert.equal(row({craftQueue:[{id:'a',n:10}],craftMade:{a:3},craftPending:{id:'p'}}).label,'Сверяю результат крафта');
  assert.equal(row({}).tab,'hunt');
});
test('раздел рецептов видит отдельный режим без craftAuto и статус после завершения',()=>{
  const els={},c={$:id=>els[id]||(els[id]={}),Date,fmt:n=>String(n),esc:n=>String(n)};
  vm.runInNewContext(tasks+'\n'+cut("let craftSig = ''",'// ревью 21.10: строка добавляется'),c);
  c.renderCraft({craftQueue:[]},{autoTasks:['craft'],craftAuto:false,craftMpPots:true});
  assert.match(els.craftBox.textContent,/Очередь пуста/);assert.doesNotMatch(els.craftBox.textContent,/Фоновый крафт выключен/);
  assert.match(els.craftBox.textContent,/МП-банки из сумки разрешены/);
  c.renderCraft({craftQueue:[{id:'a',n:3,code:'steel'}],craftMade:{a:3}},{autoTasks:['craft'],craftMpPots:false});
  assert.match(els.craftBox.textContent,/Очередь выполнена/);assert.match(els.craftBox.textContent,/МП-банки выключены/);
});
test('быстрый запуск сохраняет фоновые задачи и очередь, открывает раздел и запускает бота',async()=>{
  let stored={cfg:{autoTasks:['tvt','raid','mammon']},rt:{craftQueue:[{id:'a',n:10}]}};
  const calls=[],c={...{Date,Set,Object,Promise},DEF:D.CFG,L2Defaults:D,formChar:'Hero',controlGeneration:0,save:async()=>{},
    chrome:{storage:{local:{get:async()=>structuredClone(stored)}}},
    menuPatch:async(rt,opt)=>{calls.push(['patch',plain(rt),plain(opt)]);stored.cfg={...stored.cfg,...opt.cfgPatch};},
    showTab:name=>calls.push(['tab',name]),$:id=>id==='start'?{onclick:async()=>{c.controlGeneration++;calls.push(['start']);}}:{scrollIntoView:()=>calls.push(['scroll'])},toast:()=>{}};
  vm.runInNewContext(tasks+'\n'+cut('async function quickStart(key) {','async function botControl('),c);
  await c.quickStart('craft');
  assert.deepEqual(plain(stored.cfg.autoTasks),['tvt','mammon','craft']);
  assert.deepEqual(stored.rt.craftQueue,[{id:'a',n:10}]);
  assert.deepEqual(calls.slice(1),[['tab','hunt'],['scroll'],['start']]);
  assert.equal(Object.hasOwn(calls[0][1],'craftPending'),false);
});
test('Stop во время записи быстрого запуска не запускает крафт и не меняет раздел',async()=>{
  const calls=[],c={Date,Set,Object,Promise,DEF:D.CFG,L2Defaults:D,formChar:'Hero',controlGeneration:0,save:async()=>{},
    chrome:{storage:{local:{get:async()=>({cfg:{autoTasks:[]}})}}},menuPatch:async()=>{c.controlGeneration++;},
    showTab:()=>calls.push('tab'),$:()=>({onclick:async()=>calls.push('start')}),toast:()=>{}};
  vm.runInNewContext(tasks+'\n'+cut('async function quickStart(key) {','async function botControl('),c);
  await c.quickStart('craft');assert.deepEqual(calls,[]);
});
test('в меню есть задача, быстрый запуск и явное разрешение МП-банок',()=>{
  assert.match(html,/data-auto-task="craft"/);assert.match(html,/data-quick-task="craft"/);
  assert.match(html,/id="craftStart"/);assert.match(html,/id="craftMpPots"/);
  assert.match(js,/'craftMpPots'/);assert.match(html,/сам их не покупает/);
});
