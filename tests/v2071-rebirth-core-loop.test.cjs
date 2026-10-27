'use strict';
// 20.71: самостоятельный поход завершает круг до любых обычных служб; файл написан без запуска по просьбе игрока.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const body=source.match(/async function mainTick\(\) \{[\s\S]*?\n\}/)[0];
const names=[...new Set([...body.matchAll(/await (loop\w+)\(/g)].map(m=>m[1]))];
function fixture(stop){const calls=[],box={};for(const key of names)box[key]=async()=>{calls.push(key);return key===stop;};vm.runInNewContext(body+';this.tick=mainTick;',box);return{calls,tick:box.tick};}
test('самостоятельное подземелье не запускает обычный dispatcher, меню, баффера, стартовую подготовку или тур',async()=>{
 const f=fixture('loopRebirth');await f.tick();assert.equal(f.calls.at(-1),'loopRebirth');
 for(const key of ['loopPriority','loopMenuJobs','loopStartPrep','loopTownJobs','loopSideJobs','loopRaid','loopActivity'])assert.ok(!f.calls.includes(key),key);
 for(const key of ['loopGate','loopUrgent','loopSelfHold','loopTravel','loopTaskList'])assert.ok(f.calls.includes(key),key);
});
test('срочная защита останавливает круг до подземелья',async()=>{const f=fixture('loopUrgent');await f.tick();assert.equal(f.calls.at(-1),'loopUrgent');assert.ok(!f.calls.includes('loopRebirth'));});
test('обычный режим после отказа Rebirth сохраняет прежние службы',async()=>{const f=fixture('loopActivity');await f.tick();assert.ok(f.calls.includes('loopRebirth'));assert.ok(f.calls.includes('loopPriority'));assert.ok(f.calls.includes('loopTownJobs'));assert.equal(f.calls.at(-1),'loopActivity');});
