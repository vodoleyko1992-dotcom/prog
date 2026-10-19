'use strict';
// 19.10, журнал11:19: сотни соседей за один РБ, reload/пауза не создают повторные убийства.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),spawn='l2dop_rb_fixture';
function fixture(){
 let now=Date.parse('2026-10-19T00:00:00Z'),report;
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 const source=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),box);
 const f=box.fixture();Object.assign(f.state.cfg,{autoTasks:['raid','auto'],dailyKillLimit:1000,autoKillLimit:0});
 Object.assign(f.state.rt,{kills:0,sessT0:123,classCur:{prof:'dwarf_bounty_hunter',slot:1}});f.refresh();f.c.location.search='?spawnId='+spawn;
 f.c.L2V7Modules={fightlab:{raidKillsFor:()=>structuredClone(report)}};
 f.report=x=>{report={spawn,t:now,win:false,lose:false,...x}};
 f.snapshot=(n,extra={})=>{const seq=n*3;f.report({stream:{seq,rev:10+n,start:'rev:10',deaths:Array.from({length:Math.min(n,4096)},(_,i)=>(n-Math.min(n,4096)+i+1)*3),fullN:n,fullSeq:seq,...extra}});f.c.killSnapNote({name:'Hero',k:100+n,rev:10+n});};
 // 20.27: обе стороны IPC используют один clock fixture, независимо от реальной серверной даты.
 f.clock=()=>now;f.note=begin=>f.c.noteRaidMobKills(spawn,begin);f.advance=ms=>{now+=ms;f.state.lock.t=now};
 f.snapshot(0);return f;
}
test('живой РБ: соседи сразу увеличивают оба счётчика, задача РБ и разовая серия не меняются',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();assert.equal(f.state.rt.kills,3);assert.equal(f.state.rt.dailyQuota.raid,3);assert.equal(f.state.rt.farmQuota,undefined);assert.deepEqual(f.state.cfg.autoTasks,['raid','auto']);
});
test('429 соседей одного РБ не ограничены первыми200 именами',async()=>{const f=fixture();await f.note(true);f.snapshot(429);await f.note();assert.equal(f.state.rt.kills,429);assert.equal(f.state.rt.dailyQuota.raid,429)});
test('полный счёт восстанавливает5000 смертей при ограниченном хвосте4096 номеров',async()=>{const f=fixture();await f.note(true);f.snapshot(5000);await f.note();assert.equal(f.state.rt.kills,5000);assert.equal(f.state.rt.dailyQuota.raid,5000)});
test('повтор снимка и новый frame того же боя не дублируют131 прежнее убийство',async()=>{
 const f=fixture();await f.note(true);f.snapshot(131);await f.note();await f.note();f.refresh();await f.note(true);await f.note();assert.equal(f.state.rt.kills,131);assert.equal(f.state.rt.dailyQuota.raid,131);f.snapshot(134);await f.note();assert.equal(f.state.rt.kills,134);
});
test('GET после reload с обрезанным полным логом учитывает только новые номера',async()=>{
 const f=fixture();await f.note(true);f.snapshot(429);await f.note();f.refresh();f.report({stream:{seq:1290,rev:500,deaths:[1287,1290]}});await f.note(true);await f.note();assert.equal(f.state.rt.kills,430);assert.equal(f.state.rt.dailyQuota.raid,430);
});
test('потерянный ACK не повторяет запись, локальный счётчик догоняет durable итог',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);const ipc=f.c.ipc;let lost=true;f.c.ipc=async m=>{const r=await ipc(m);if(lost){lost=false;throw Error('lost ACK')}return r};await f.note();assert.equal(f.state.rt.kills,3);await f.note();assert.equal(f.state.rt.kills,3);assert.equal(f.c.rt.kills,3);
});
test('отказ записи начала сохраняет исходный курсор для следующего повтора',async()=>{
 const f=fixture(),ipc=f.c.ipc;f.c.ipc=async()=>({ok:false});await f.note(true);f.c.ipc=ipc;f.snapshot(3);await f.note();assert.equal(f.state.rt.kills,3);assert.equal(f.state.rt.dailyQuota.raid,3);
});
for(const kind of ['stop','char','lease','kick','class'])test('устаревший владелец не пишет убийства: '+kind,async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);if(kind==='stop')f.state.on=false;if(kind==='char')f.state.rt.char='Other';if(kind==='lease')f.state.lock.epoch++;if(kind==='kick')f.state.rt.manualKickAt++;if(kind==='class')f.state.rt.classCur.slot=2;await f.note();assert.equal(f.state.rt.kills,0);assert.equal(f.state.rt.dailyQuota?.raid||0,0);
});
test('сброс статистики не возвращает старые убийства и не сбрасывает день',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();await f.menu({rtPatch:{kills:0,sessT0:999}});f.refresh();await f.note();assert.equal(f.state.rt.kills,0);f.snapshot(4);await f.note();assert.equal(f.state.rt.kills,1);assert.equal(f.state.rt.dailyQuota.raid,4);
});
test('сброс сессии во время IPC не засчитывает предыдущее событие в новую статистику',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);const ipc=f.c.ipc;f.c.ipc=async m=>{f.state.rt.kills=0;f.state.rt.sessT0=999;return ipc(m)};await f.note();assert.equal(f.state.rt.kills,0);assert.equal(f.state.rt.dailyQuota.raid,3);
});
test('сброс дневного лимита обнуляет raid, но сохранённый курсор не даёт повторить старые смерти',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();await f.menu({rtPatch:{manualKickAt:2},resetDailyQuota:'mobs'});f.refresh();await f.note();assert.equal(f.state.rt.dailyQuota.raid,0);f.snapshot(4);await f.note();assert.equal(f.state.rt.dailyQuota.raid,1);assert.equal(f.state.rt.kills,4);
});
test('полночь переносит только новые смерти, не весь РБ',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();f.advance(86400000);f.snapshot(4);await f.note();assert.equal(f.state.rt.dailyQuota.raid,1);assert.equal(f.state.rt.kills,4);
});
test('дневной лимит0 сохраняет общий счёт и не восстанавливает прежнюю добычу после включения',async()=>{
 const f=fixture();f.state.cfg.dailyKillLimit=0;f.refresh();await f.note(true);f.snapshot(3);await f.note();assert.equal(f.state.rt.kills,3);assert.equal(f.state.rt.dailyQuota,undefined);f.state.cfg.dailyKillLimit=1000;f.refresh();f.snapshot(4);await f.note();assert.equal(f.state.rt.dailyQuota.raid,1);
});
test('победа над самим боссом без соседей не добавляет дневных обычных мобов',async()=>{
 const f=fixture();await f.note(true);f.report({win:true,stream:{seq:1,rev:11,start:'rev:10',deaths:[],fullN:0,fullSeq:1}});await f.note();assert.equal(f.state.rt.kills,0);assert.equal(f.state.rt.dailyQuota.raid||0,0);
});
test('следующий респ того же РБ начинает новую последовательность',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();f.report({win:true,stream:{seq:10,rev:20,start:'rev:10',deaths:[3,6,9],fullN:3,fullSeq:10}});await f.note();f.report({stream:{seq:0,rev:30,start:'rev:30',deaths:[],fullN:0,fullSeq:0}});await f.note(true);f.report({stream:{seq:3,rev:31,start:'rev:30',deaths:[3],fullN:1,fullSeq:3}});await f.note();assert.equal(f.state.rt.kills,4);assert.equal(f.state.rt.dailyQuota.raid,4);
});
test('обычный моб/PvP не принимается как сосед РБ',async()=>{const f=fixture();assert.equal(await f.c.noteRaidMobKills('regular_spawn',true),false);assert.equal(f.state.rt.raidMobMarks,undefined)});
test('уже учтённые соседи не попадают повторно в незакрытую квоту автофарма',async()=>{
 const f=fixture();f.state.cfg.autoKillLimit=99;f.state.rt.farmKillMark={counter:100,revision:10,floor:100};f.state.rt.farmQuota={auto:{run:1,limit:99,got:0,pending:{spawn:'old',counter:100,revision:10,floor:100,kick:1}}};f.refresh();await f.note(true);f.snapshot(3);await f.note();const r=f.bg.farmQuotaChange(f.state,{op:'win',task:'auto',limit:99,dailyLimit:1000,kick:1,run:1,spawn:'old',beforeRevision:10,revision:20,counter:104,seen:1},f.clock());assert.equal(r.row.got,1);assert.equal(r.dailyQuota.raid,3);assert.equal(r.dailyQuota.auto,1);
});
test('движок включает соседей РБ в общий дневной лимит автофарма и катакомб, тур не выключается',()=>{
 const c={};vm.runInNewContext(read('engine-core.js'),c);const rt={dailyQuota:{day:c.L2EngineCore.dailyDay(),auto:2,cat:1,raid:7}},cfg={autoTasks:['raid','auto'],dailyKillLimit:10};assert.equal(c.L2EngineCore.dailyCount(rt,'auto'),10);assert.equal(c.L2EngineCore.dailyBlocked(cfg,rt,'auto'),true);assert.equal(c.L2EngineCore.selectedTask(cfg,rt),'raid');
});
test('неполный меньший fullN не откатывает абсолютную отметку и не создаёт следующий повтор',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();f.report({stream:{seq:12,rev:14,start:'rev:10',deaths:[12],fullN:1,fullSeq:12}});await f.note();f.report({stream:{seq:13,rev:15,start:'rev:10',deaths:[3,6,9,12],fullN:4,fullSeq:13}});await f.note();assert.equal(f.state.rt.kills,4);assert.equal(f.state.rt.dailyQuota.raid,4);
});
test('первый вход посреди чужой истории задаёт baseline, а не восстанавливает131 старое убийство',async()=>{
 const f=fixture();f.snapshot(131);await f.note(true);await f.note();assert.equal(f.state.rt.kills,0);f.snapshot(132);await f.note();assert.equal(f.state.rt.kills,1);assert.equal(f.state.rt.dailyQuota.raid,1);
});
test('сброс сессии после записи IPC не перетирается поздним ответом',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);const ipc=f.c.ipc;let reset=true;f.c.ipc=async m=>{const r=await ipc(m);if(reset){reset=false;await f.menu({rtPatch:{kills:0,sessT0:999}});f.refresh()}return r};await f.note();assert.equal(f.c.rt.kills,0);assert.equal(f.state.rt.dailyQuota.raid,3);f.snapshot(4);await f.note();assert.equal(f.state.rt.kills,1);
});
test('меню показывает общий итог и отдельную долю соседей РБ',()=>{
 const js=read('popup.js'),els={},ctx={$:id=>els[id]||(els[id]={}),Date,L2EngineCore:require('../engine-core.js')};vm.runInNewContext(js.slice(js.indexOf('const dailyLimitKeys='),js.indexOf('for(const task of Object.keys(dailyLimitKeys))')),ctx);
 const day=require('../engine-core.js').dailyDay();ctx.renderDailyLimits({dailyQuota:{day,auto:2,cat:1,raid:7}},{dailyKillLimit:20,dailyFishLimit:0});assert.match(els.mobsDailyProgress.textContent,/^10 \/ 20 /);assert.match(els.mobsDailyProgress.textContent,/рядом с РБ 7/);
});
test('после завершённого РБ отсутствие первого курсора не оставляет новый респ на старой отметке',async()=>{
 const f=fixture();await f.note(true);f.snapshot(3);await f.note();f.report({win:true,stream:{seq:10,rev:20,deaths:[3,6,9],fullN:3,fullSeq:10}});await f.note();f.report({});assert.equal(await f.note(true),false);f.report({stream:{seq:3,rev:31,deaths:[3],fullN:1,fullSeq:3}});await f.note();f.report({stream:{seq:6,rev:32,deaths:[3,6],fullN:2,fullSeq:6}});await f.note();assert.equal(f.state.rt.kills,4);assert.equal(f.state.rt.dailyQuota.raid,4);
});
test('новый живой РБ после завершения старого задаёт baseline даже при большем номере журнала',async()=>{
 const f=fixture();await f.note(true);f.snapshot(1);await f.note();f.report({win:true,stream:{seq:4,rev:20,deaths:[3],fullN:1,fullSeq:4}});await f.note();f.report({stream:{seq:30,rev:40,deaths:[3,6,9,12,15,18,21,24,27,30],fullN:10,fullSeq:30}});await f.note(true);f.report({stream:{seq:33,rev:41,deaths:[33],fullN:11,fullSeq:33}});await f.note();assert.equal(f.state.rt.kills,2);assert.equal(f.state.rt.dailyQuota.raid,2);
});
