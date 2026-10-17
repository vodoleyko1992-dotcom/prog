'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),engine=require('../engine-core.js');
// Тот же контур background/content, что у разовых целей; часы управляются тестом.
function fixture(task='auto'){
 let now=Date.parse('2026-10-17T13:59:00Z');
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const source=read('tests/v208-farm-kill-quota.test.js'),c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console};
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);
 const f=c.fixture(task);f.state.cfg.autoKillLimit=0;f.state.cfg.catKillLimit=0;f.state.cfg.dailyAutoKillLimit=3;f.state.cfg.dailyCatKillLimit=3;f.state.cfg.dailyFishLimit=2;f.refresh();
 f.advance=()=>{now+=120000;f.state.lock.t=now;};
 f.fish=()=>f.bg.statePatch({patch:{},dailyFish:{limit:f.state.cfg.dailyFishLimit,kick:f.state.rt.manualKickAt||0},expectedChar:f.state.rt.char,epoch:1},{tab:{id:7},frameId:0,url:'https://l2wap.com/fishing.html'});
 return f;
}
for(const task of ['auto','cat'])test(task+': daily cap pauses only until midnight, retains selection and bot ON',async()=>{
 const f=fixture(task),t=await f.begin();f.grow(4);assert.equal(await f.win(t),true);
 assert.equal(f.state.rt.dailyQuota[task],4);assert.equal(f.state.on,true);assert.ok(f.state.cfg.autoTasks.includes(task));assert.equal(f.state.cfg[task==='cat'?'catMode':'zoneAuto'],true);
 assert.notEqual(engine.selectedTask(f.state.cfg,f.state.rt,Date.parse('2026-10-17T13:59:00Z')),task);
 f.advance();f.refresh();assert.equal(engine.selectedTask(f.state.cfg,f.state.rt,Date.parse('2026-10-17T14:01:00Z')),task);
 const next=await f.begin();f.grow(1);await f.win(next);assert.equal(f.state.rt.dailyQuota[task],1);assert.equal(f.state.rt.dailyQuota.day,'2026-10-18');
});
test('Vladivostok midnight is exactly 14:00 UTC; disabled/manual-unselected never resumes',()=>{
 const cfg={autoTasks:['fish','cat','auto'],dailyFishLimit:1,dailyCatKillLimit:1,dailyAutoKillLimit:1},rt={dailyQuota:{day:'2026-10-17',fish:1,auto:1,cat:1}};
 assert.equal(engine.selectedTask(cfg,rt,Date.parse('2026-10-17T13:59:59.999Z')),'tasks');assert.equal(engine.selectedTask(cfg,rt,Date.parse('2026-10-17T14:00:00Z')),'fish');
 assert.equal(engine.selectedTask({...cfg,autoTasks:[]},rt,Date.parse('2026-10-18T14:00:00Z')),'tasks');assert.equal(engine.dailyBlocked({...cfg,dailyFishLimit:0},rt,'fish'),false);
});
test('legacy profiles project blocked flags without falling into unlimited default farm',()=>{
 const raw={catMode:true,zoneAuto:true,dailyCatKillLimit:2,dailyAutoKillLimit:2},rt={dailyQuota:{day:engine.dailyDay(),cat:2,auto:2}},view=engine.taskConfig(raw,()=>rt);
 assert.equal(view.catMode,false);assert.equal(view.zoneAuto,false);assert.equal(view.taskOnly,true);assert.equal(raw.zoneAuto,true);
 rt.dailyQuota.auto=0;assert.equal(view.zoneAuto,true);assert.notEqual(view.taskOnly,true);
});
test('raid wait does not yield to fish already at its daily cap',()=>{
 const cfg={autoTasks:['raid','fish'],dailyFishLimit:1},now=Date.now(),rt={dailyQuota:{day:engine.dailyDay(now),fish:1},rbFishWait:{until:now+10000,at:now},rbHunt:{phase:'wait',step:'pick'}};
 assert.equal(engine.selectedTask(cfg,rt,now),'raid');
});
test('one-off completion stays permanent even with a daily cap',async()=>{
 const f=fixture();f.state.cfg.autoKillLimit=2;f.refresh();const t=await f.begin();f.grow(2);await f.win(t);assert.ok(!f.state.cfg.autoTasks.includes('auto'));f.advance();assert.equal(engine.selectedTask(f.state.cfg,f.state.rt),'tasks');
});
test('daily edit retains today count, invalidates old battle; reset affects only one counter',async()=>{
 const f=fixture();let t=await f.begin();f.grow(1);await f.win(t);t=await f.begin();f.grow(4);
 await f.menu({cfgPatch:{dailyAutoKillLimit:9}});f.refresh();await f.win(t);assert.equal(f.state.rt.dailyQuota.auto,1);assert.equal(f.state.cfg.zoneAuto,true);
 f.state.rt.dailyQuota.cat=7;await f.menu({rtPatch:{manualKickAt:2},resetDailyQuota:'auto'});assert.equal(f.state.rt.dailyQuota.auto,0);assert.equal(f.state.rt.dailyQuota.cat,7);
});
test('duplicate battle, reload and partial defeat retain exact server counts',async()=>{
 const f=fixture(),t=await f.begin();f.grow(1);f.refresh();await f.c.finishFarmQuota(null,true);await f.win(t);assert.equal(f.state.rt.dailyQuota.auto,1);assert.equal(f.state.rt.farmQuota.auto.pending,null);
});
test('fish high water counts catches once, survives reset of statistics and reload',async()=>{
 const f=fixture();f.state.rt.fish={t0:100,caught:500};await f.fish();assert.equal(f.state.rt.dailyQuota.fish,0);
 f.state.rt.fish.caught++;await f.fish();await f.fish();assert.equal(f.state.rt.dailyQuota.fish,1);
 f.state.rt.fish={t0:200,caught:1};await f.fish();assert.equal(f.state.rt.dailyQuota.fish,2);assert.equal(f.state.cfg.dailyFishLimit,2);
 f.advance();f.state.rt.fish.caught++;await f.fish();assert.equal(f.state.rt.dailyQuota.fish,1);assert.equal(f.state.rt.dailyQuota.day,'2026-10-18');
});
test('fish reset today baselines existing catch total; editing cap does not erase count',async()=>{
 const f=fixture();f.state.rt.fish={t0:10,caught:5};await f.fish();f.state.rt.fish.caught++;await f.fish();
 await f.menu({cfgPatch:{dailyFishLimit:8}});assert.equal(f.state.rt.dailyQuota.fish,1);await f.menu({resetDailyQuota:'fish'});await f.fish();assert.equal(f.state.rt.dailyQuota.fish,0);
 f.state.rt.fish.caught++;await f.fish();assert.equal(f.state.rt.dailyQuota.fish,1);
});
test('stale character, owner or Stop cannot credit fish',async()=>{
 for(const type of ['char','owner','stop']){const f=fixture();f.state.rt.fish={t0:1,caught:0};await f.fish();f.state.rt.fish.caught=1;if(type==='char')f.state.rt.char='Other';if(type==='owner')f.state.lock.epoch=2;if(type==='stop')f.state.on=false;
 const r=await f.bg.statePatch({patch:{},dailyFish:{limit:2,kick:1},expectedChar:'Hero',epoch:1},{tab:{id:7},frameId:0,url:'https://l2wap.com/fishing.html'});assert.equal(r.ok,false);assert.equal(f.state.rt.dailyQuota.fish,0);}
});
test('limits tab owns all quota controls once; defaults preserve unlimited behavior',()=>{
 const html=read('popup.html'),section=html.split('<section id="tab-limits">')[1].split('</section>')[0],base=JSON.parse(read('base-profile.json'));
 assert.match(html,/data-tab="limits"/);
 for(const id of ['dailyFishLimit','dailyAutoKillLimit','dailyCatKillLimit','autoKillLimit','catKillLimit','fishTgtType','fishMaxCasts']){assert.ok(section.includes('id="'+id+'"'));assert.equal(html.split('id="'+id+'"').length,2);}
 for(const key of ['dailyFishLimit','dailyAutoKillLimit','dailyCatKillLimit'])assert.equal(base.cfg[key],0);
});

test('content fish hook persists quota then avoids writes without a new catch',async()=>{
 const f=fixture();f.state.rt.fish={t0:10,caught:0};f.refresh();assert.equal(await f.c.dailyLimitFishSync(),true);
 f.state.rt.fish.caught=1;f.c.rt.fish.caught=1;assert.equal(await f.c.dailyLimitFishSync(),true);assert.equal(f.c.rt.dailyQuota.fish,1);
 const writes=f.writes();await f.c.dailyLimitFishSync();assert.equal(f.writes(),writes);
});
test('failed fish write holds fishing without fabricating quota or stopping bot',async()=>{
 const f=fixture();f.state.rt.fish={t0:10,caught:0};f.refresh();await f.c.dailyLimitFishSync();f.state.rt.fish.caught=1;f.c.rt.fish.caught=1;f.fail();
 assert.equal(await f.c.dailyLimitFishSync(),false);assert.equal(f.c.rt.dailyQuota.fish,0);assert.equal(f.state.on,true);
});
