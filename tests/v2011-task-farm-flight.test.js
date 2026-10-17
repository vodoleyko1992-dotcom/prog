'use strict';
// 17.10 (лог West 15:10): «Только задачи» + цель «Фарм ресурсов» — перелёт к точке цели отменялся как «несовместимый маршрут zoneGo»,
// бот крутился карта → форум → карта каждые 4 с и не начинал бой.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const box=vm.createContext({});vm.runInContext(read('engine-core.js'),box);const E=box.L2EngineCore;
const cfg=tasks=>E.taskConfig({farmRes:'stone of purity',autoTasks:tasks},()=>({}));
const tasks=['mammon','dailies','clan','pvp','resources','tvt'];
assert.equal(E.selectedTask(cfg(tasks)),'tasks');
const farmGo={zoneGo:{id:'forsaken_plains',url:'/forum-farm-resources.html',forum:true,res:'Stone of Purity',task:'resources',t:1}};
assert.equal(E.taskJobAllowed(cfg(tasks),'zoneGo',farmGo),true,'resource flight belongs to the allowed resources task');
assert.equal(E.taskJobAllowed(cfg(tasks),'zoneGo',{zoneGo:{id:'x',forum:true,res:'Stone of Purity',t:1}}),true,'flight saved by 20.10 (no task field) survives');
assert.equal(E.taskJobAllowed(cfg(tasks),'zoneGo',{zoneGo:{id:'x',task:'resources',why:'рецепт: …',t:1}}),true,'recipe flight');
assert.equal(E.taskJobAllowed(cfg(['mammon','tvt']),'zoneGo',farmGo),false,'without resources task the flight is still cancelled');
assert.equal(E.taskJobAllowed(cfg(tasks),'zoneGo',{zoneGo:{id:'x',t:1,why:'автофарм'}}),false,'ordinary autofarm flight stays blocked in tasks mode');
assert.equal(E.taskJobAllowed(cfg(['auto']),'zoneGo',{zoneGo:{id:'x',t:1}}),true,'autofarm keeps its own flights');
// Источники перелёта помечены задачей.
const src=read('content.js');
assert.match(src,/zoneGo: \{ id: p\.tp, url: FARM_URL, forum: true, res: g\.name, task: 'resources'/);
assert.match(src,/zoneGo: \{ id: p\.zid, task: 'resources'/);
console.log('v2011-task-farm-flight: PASS');
