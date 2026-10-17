'use strict';
// 20.10 (игрок 17.10 04:33: «мобы на автофарм и каты — общие! количество в сумме ограничено»):
// один дневной лимит мобов dailyKillLimit на автофарм и катакомбы, миграция dailyKill2010, остаток в меню.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),engine0=require('../engine-core.js');
// 20.13 (ревизия 17.10, шаг 5): проверки движка — на часах фикстуры (13:59Z), а не на настоящих: после 14:00Z (00:00 UTC+10)
// настоящие сутки уже другие, и тест падал в зависимости от времени запуска.
const T0=Date.parse('2026-10-17T13:59:00Z'),engine={dailyCount:(r,k,n)=>engine0.dailyCount(r,k,n??T0),dailyBlocked:(c,r,k,n)=>engine0.dailyBlocked(c,r,k,n??T0),selectedTask:(c,r,n)=>engine0.selectedTask(c,r,n??T0)};
function fixture(task='auto'){
 let now=Date.parse('2026-10-17T13:59:00Z');
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture(task);f.state.cfg.autoKillLimit=0;f.state.cfg.catKillLimit=0;f.state.cfg.dailyKillLimit=5;f.state.cfg.autoTasks=['cat','auto','dailies'];f.state.cfg.catMode=true;f.refresh();
 f.advance=()=>{now+=120000;f.state.lock.t=now;};
 return f;
}
test('убийства автофарма и катакомб складываются в один дневной лимит; достигнут — ждут обе охоты, остальные задачи идут',async()=>{
 const f=fixture('cat');let t=await f.begin();f.grow(3);assert.equal(await f.win(t),false);   // 3/5 — лимит не достигнут
 assert.equal(f.state.rt.dailyQuota.cat,3);assert.equal(engine.dailyCount(f.state.rt,'auto'),3);
 assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'auto'),false);assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'cat'),false);
 f.state.rt.dailyQuota.auto=2;f.refresh();   // ещё 2 моба на автофарме → 5/5
 assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'cat'),true);assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'auto'),true);
 assert.equal(engine.selectedTask(f.state.cfg,f.state.rt),'tasks');assert.equal(f.state.on,true);assert.deepEqual(f.state.cfg.autoTasks,['cat','auto','dailies']);
 f.advance();assert.equal(engine.selectedTask(f.state.cfg,f.state.rt,Date.parse('2026-10-17T14:01:00Z')),'cat');
});
test('итог боя ставит dailyDone по сумме: катакомбы 4 + автофарм 1 = 5/5, обе охоты остаются выбранными',async()=>{
 const f=fixture('cat');f.state.rt.dailyQuota={day:'2026-10-17',auto:4,cat:0,fish:0};f.refresh();
 const t=await f.begin();f.grow(1);assert.equal(await f.win(t),true);
 assert.equal(f.state.rt.dailyQuota.cat,1);assert.equal(f.state.rt.dailyQuota.auto,4);assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'auto'),true);assert.equal(engine.dailyBlocked(f.state.cfg,f.state.rt,'cat'),true);
 assert.deepEqual(f.state.cfg.autoTasks,['cat','auto','dailies']);assert.equal(f.state.cfg.catMode,true);assert.equal(f.state.on,true);
});
test('сброс «за сегодня» обнуляет оба счётчика мобов и не трогает рыбу',async()=>{
 const f=fixture();f.state.rt.dailyQuota={day:'2026-10-17',auto:3,cat:2,fish:9};f.state.rt.farmQuota={auto:{run:1,limit:0,got:3,pending:{spawn:'x'}},cat:{run:1,limit:0,got:2,pending:{spawn:'y'}}};f.refresh();
 await f.menu({rtPatch:{manualKickAt:2},resetDailyQuota:'mobs'});
 assert.deepEqual([f.state.rt.dailyQuota.auto,f.state.rt.dailyQuota.cat,f.state.rt.dailyQuota.fish],[0,0,9]);
 assert.equal(f.state.rt.farmQuota.auto.pending,null);assert.equal(f.state.rt.farmQuota.cat.pending,null);
});
test('миграция dailyKill2010: старые лимиты складываются, пустые получают диапазон игрока 8434–9119, диапазоны переезжают',()=>{
 const src=read('content.js'),m=src.match(/once\('dailyKill2010', \(\) => \{[\s\S]*?rf\.limitRolls = rolls;\n  \}\);/)[0];
 const RANGE={min:8434,max:9119},run=(cfgIn,rtIn={})=>{const cf={},rf={},cfg={...cfgIn},rt={...rtIn},C=k=>(k in cf?cf[k]:cfg[k]);vm.runInNewContext(m,{cf,rf,rt,cfg,C,DAILY_RANGE:RANGE,DAILY_KILL_DEF:RANGE.min,DAILY_FISH_DEF:RANGE.min,once:(_,fn)=>fn()});return {cf,rf};};
 let r=run({dailyAutoKillLimit:200,dailyCatKillLimit:150,dailyFishLimit:0});
 assert.equal(r.cf.dailyKillLimit,350);assert.equal(r.cf.dailyFishLimit,8434);assert.equal(r.cf.dailyAutoKillLimit,0);assert.equal(r.cf.dailyCatKillLimit,0);assert.equal(JSON.stringify(r.cf.limitRanges),JSON.stringify({dailyFishLimit:RANGE}));
 r=run({dailyAutoKillLimit:0,dailyCatKillLimit:0,dailyFishLimit:500});
 assert.equal(r.cf.dailyKillLimit,8434);assert.equal(r.cf.dailyFishLimit,undefined);assert.equal(JSON.stringify(r.cf.limitRanges),JSON.stringify({dailyKillLimit:RANGE}));
 r=run({dailyAutoKillLimit:10,dailyCatKillLimit:0,limitRanges:{dailyAutoKillLimit:{min:10,max:20},dailyCatKillLimit:{min:5,max:5},dailyFishLimit:{min:1,max:2}}},{limitRolls:{dailyAutoKillLimit:{value:10},dailyFishLimit:{value:1}}});
 assert.equal(JSON.stringify(r.cf.limitRanges),JSON.stringify({dailyFishLimit:{min:1,max:2},dailyKillLimit:{min:15,max:25}}));assert.equal(JSON.stringify(r.rf.limitRolls),JSON.stringify({dailyFishLimit:{value:1}}));
 const DEF=src.match(/const DAILY_RANGE = \{ min: (\d+), max: (\d+) \}, DAILY_KILL_DEF = DAILY_RANGE\.min, DAILY_FISH_DEF = DAILY_RANGE\.min;/);assert.deepEqual([+DEF[1],+DEF[2]],[8434,9119]);assert.ok(/limitRanges: DAILY_RANGES_DEF\(\)/.test(src));
 assert.ok(/dailyFishLimit: DAILY_FISH_DEF, dailyKillLimit: DAILY_KILL_DEF,/.test(src));assert.ok(!/dailyAutoKillLimit: 0/.test(src));
});
test('меню: один общий лимит мобов, остаток в «Лимитах» и в обзоре задач',()=>{
 const html=read('popup.html'),js=read('popup.js'),section=html.split('id="tab-limits"')[1].split('</section>')[0];   // 20.12: «Лимиты» — подраздел «Обзора» (метка #tab-limits)
 assert.ok(section.includes('id="dailyKillLimit"'));assert.ok(section.includes('id="mobsDailyProgress"'));assert.ok(section.includes('id="mobsDailyReset"'));
 for(const id of ['dailyAutoKillLimit','dailyCatKillLimit','autoDailyProgress','catDailyProgress'])assert.ok(!html.includes('id="'+id+'"'),id);
 assert.ok(!/dailyAutoKillLimit|dailyCatKillLimit/.test(js));
 const els={},$=id=>els[id]||(els[id]={}),ctx={$,Date};
 vm.runInNewContext(js.slice(js.indexOf('const dailyLimitKeys='),js.indexOf('for(const task of Object.keys(dailyLimitKeys))')),ctx);
 const day=new Date(Date.now()+10*3600000).toISOString().slice(0,10),rt={dailyQuota:{day,auto:1200,cat:300,fish:10}};
 ctx.renderDailyLimits(rt,{dailyKillLimit:3000,dailyFishLimit:0});
 assert.equal(els.mobsDailyProgress.textContent,'1500 / 3000 (автофарм 1200, катакомбы 300) · осталось 1500');assert.equal(els.fishDailyProgress.textContent,'Без дневного лимита');
 ctx.renderDailyLimits(rt,{dailyKillLimit:1500,dailyFishLimit:0});assert.match(els.mobsDailyProgress.textContent,/1500 \/ 1500 .* до 00:00$/);
 // обзор задач: строка автофарма показывает общий счётчик и остаток
 const st={on:true},board={L2EngineCore:engine,Date};
 vm.runInNewContext(js.slice(js.indexOf('const AUTO_TASK_LABELS ='),js.indexOf('function workspaceState('))+'\n'+js.slice(js.indexOf('function taskBoardRows('),js.indexOf('function autoTaskPatch(')),board);
 const rows=board.taskBoardRows(rt,{autoTasks:['auto','cat'],dailyKillLimit:3000},st);
 assert.match(rows[0].progress,/Сегодня: 1500 \/ 3000 \(автофарм \+ катакомбы\) · осталось 1500/);assert.equal(rows[0].percent,50);
});
