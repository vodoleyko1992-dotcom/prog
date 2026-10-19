'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const D=require('../defaults.js'),E=require('../engine-core.js');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
for(const raw of [
 {autoTasks:['enchant'],enchant:{enabled:true,queue:[{key:'old'}]}},
 {autoTasks:['enchant','fish','tvt'],enchantMode:true},
 {autoTasks:null,enchantMode:true,taskOnly:false},
 {autoTasks:['enchant','mammon'],enchantMode:true}
])test('старый профиль не включает снятый модуль: '+JSON.stringify(raw),()=>{
 const copy=structuredClone(raw),cfg=D.withoutAutoEnchant(raw);
 assert.equal(cfg.enchantMode,false);assert.ok(!cfg.autoTasks?.includes('enchant'));assert.equal(cfg.enchant?.enabled??false,false);
 const mode=E.selectedTask(cfg)||E.chooseMode({enchant:cfg.enchantMode,fish:cfg.fishMode,tasks:cfg.taskOnly});
 assert.notEqual(mode,'enchant');if(raw.autoTasks?.length===1||!raw.autoTasks)assert.equal(mode,'tasks');
 assert.deepEqual(raw,copy,'сохранённая очередь и исходный профиль не стираются');
});
test('обычный фарм, ЛС и настройка свитков РБ сохраняются',()=>{
 const raw={taskOnly:false,autoTasks:['farm','petbuff'],autoLs:{targets:['prominence']},rbScrollFirst:true};
 const cfg=D.withoutAutoEnchant(raw);assert.equal(E.selectedTask(cfg),'farm');assert.deepEqual(cfg.autoLs,raw.autoLs);assert.equal(cfg.rbScrollFirst,true);
});
function feature(pending=null){
 let gets=0,clicks=0;const rt={char:'Hero',enchant:{char:'Hero',status:'running',items:[],pending,totals:{},history:[]}},env={on:true,tabOwner:true,cfg:{enchantMode:true,enchant:{enabled:true}},rt,canRun:()=>true,awayFree:()=>true,setRt:async p=>Object.assign(rt,p),gameGet:async()=>{gets++;return{ok:true,json:async()=>({character:{name:'Hero',id:'hero',revision:12,inventory:{stacks:[],eq:{}}}})}},fire:()=>clicks++,rec(){}};
 const b={L2Defaults:D,Date,location:{pathname:'/enchant.html'},document:{querySelector:()=>null,querySelectorAll:()=>[]}};vm.runInNewContext(read('modules/enchant.js'),b);return{env,F:b.L2V7Factories.enchant(env),gets:()=>gets,clicks:()=>clicks};
}
for(const cmd of ['start','resume','refresh'])test('даже прямой вызов фабрики '+cmd+' не читает сумку и не нажимает заточку',async()=>{const f=feature();assert.equal(await f.F.command(cmd),false);assert.equal(f.gets(),0);assert.equal(f.clicks(),0)});
test('сохранённая running-серия не выполняет следующий шаг',async()=>{const f=feature();assert.equal(await f.F.step(),false);assert.equal(f.gets(),0);assert.equal(f.clicks(),0);assert.ok(f.env.rt.enchant)});
test('команда runtime отклоняет старое меню без действий и аренды',async()=>{
 const src=read('content.js'),b={L2Defaults:D};vm.runInNewContext(src.slice(src.indexOf('async function enchantCommand(m)'),src.indexOf('async function enchantDispatch()')),b);
 for(const action of ['start','resume','refresh','reset']){const r=await b.enchantCommand({action});assert.equal(r.ok,false);assert.match(r.reason,/временно убрана/)}
});
test('pending сохраняется для сверки: отключение не выдаёт его за отменённую оплату',()=>{
 const rt={enchant:{pending:{id:'sent',revision:7}}},before=structuredClone(rt);D.withoutAutoEnchant({enchant:{enabled:true}});assert.deepEqual(rt,before);
 const src=read('content.js');assert.match(src,/AUTO_ENCHANT_DISABLED === true \? L2V7Modules.enchant.reconcile\(\) : L2V7Modules.enchant.step\(\)/);
});

test('неизвестная старая попытка только сверяется чтением, не стирается и не повторяется',async()=>{
 const f=feature({id:'sent',state:'unknown',revision:7,itemId:123,targetInstanceId:'old',scrollId:910510,scrollBefore:1,colBefore:0});await f.F.step();assert.ok(f.gets()>0);assert.equal(f.clicks(),0);assert.equal(f.env.rt.enchant.pending.id,'sent');const gets=f.gets();await f.F.step();assert.equal(f.gets(),gets,'сверка не повторяет GET на каждом тике');
});
