'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture(task='auto'){
 let now=Date.parse('2026-10-17T13:59:00Z');class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const c={require:x=>x==='node:test'?()=>{}:require(x),__dirname,Date:Clock,URL,URLSearchParams,structuredClone,console},source=read('tests/v208-farm-kill-quota.test.js');
 vm.runInNewContext(source.slice(0,source.indexOf("for(const task of ['auto','cat'])")),c);const f=c.fixture(task),menu=f.menu;
 f.menu=m=>menu({expectedChar:'Hero',...m});let calls=0,rng=.5;f.bg.Math=Object.create(Math);f.bg.Math.random=()=>{calls++;return rng};
 f.random=x=>rng=x;f.calls=()=>calls;f.advance=()=>{now+=120000;f.state.lock.t=now};
 f.edit=(key,min,max)=>f.menu({rtPatch:{manualKickAt:2},limitRangeEdit:{key,min,max}});
 f.resolve=()=>f.bg.statePatch({patch:{},resolveLimitRanges:true,rangeKick:f.state.rt.manualKickAt||0,epoch:1,expectedChar:'Hero'},{tab:{id:7},frameId:0,url:'https://l2wap.com/map.html'});
 return f;
}
for(const key of ['dailyFishLimit','dailyKillLimit','autoKillLimit','catKillLimit','fishMaxCasts'])test(key+': selected integer within range persists across resolve/reload/Stop',async()=>{
 const f=fixture();assert.equal((await f.edit(key,100,300)).ok,true);assert.equal(f.state.cfg[key],200);assert.equal(f.state.cfg.limitRanges[key].min,100);
 const seq=f.state.rt.limitRolls[key].seq;f.refresh();await f.resolve();await f.resolve();assert.equal(f.state.rt.limitRolls[key].seq,seq);assert.equal(f.calls(),1);
 f.state.on=false;assert.equal((await f.resolve()).ok,false);f.state.on=true;await f.resolve();assert.equal(f.state.cfg[key],200);assert.equal(f.calls(),1);
});
test('inclusive endpoints, equal bounds and safe integer maximum',async()=>{
 for(const [min,max,rng,want] of [[1,3,0,1],[1,3,1-Number.EPSILON,3],[7,7,.5,7],[Number.MAX_SAFE_INTEGER-2,Number.MAX_SAFE_INTEGER,1-Number.EPSILON,Number.MAX_SAFE_INTEGER]]){
 const f=fixture();f.random(rng);await f.edit('autoKillLimit',min,max);assert.equal(f.state.cfg.autoKillLimit,want);assert.ok(Number.isSafeInteger(want));}
});
test('new Vladivostok day rerolls daily quotas only, retaining all task choices',async()=>{
 const f=fixture();await f.edit('dailyKillLimit',10,20);await f.edit('dailyFishLimit',100,200);await f.edit('catKillLimit',1000,2000);const cat=f.state.cfg.catKillLimit;
 f.random(0);f.advance();await f.resolve();assert.equal(f.state.cfg.dailyKillLimit,10);assert.equal(f.state.cfg.dailyFishLimit,100);assert.equal(f.state.cfg.catKillLimit,cat);assert.equal(f.state.rt.limitRolls.dailyKillLimit.day,'2026-10-18');assert.deepEqual(f.state.cfg.autoTasks,['auto','dailies']);
 const calls=f.calls();await f.resolve();assert.equal(f.calls(),calls);
});
test('daily counter reset keeps chosen number; changed bounds keep today progress',async()=>{
 const f=fixture();await f.edit('dailyKillLimit',10,20);f.state.rt.dailyQuota={day:'2026-10-17',auto:8,cat:4,fish:2};const calls=f.calls();
 await f.menu({resetDailyQuota:'mobs'});assert.equal(f.calls(),calls);assert.equal(f.state.rt.dailyQuota.auto,0);assert.equal(f.state.rt.dailyQuota.cat,0);assert.equal(f.state.rt.dailyQuota.fish,2);
 f.state.rt.dailyQuota.auto=7;await f.edit('dailyKillLimit',30,40);assert.equal(f.state.rt.dailyQuota.auto,7);assert.equal(f.state.cfg.dailyKillLimit,35);
});
for(const task of ['auto','cat'])test(task+': completed one-off reenables with a new stored goal; explicit reset rerolls only its own series',async()=>{
 const f=fixture(task),key=task+'KillLimit';await f.edit(key,2,4);f.refresh();const t=await f.begin();f.grow(3);await f.win(t);assert.equal(f.state.rt.farmQuota[task].done,true);assert.ok(!f.state.cfg.autoTasks.includes(task));
 const calls=f.calls();await f.resolve();assert.equal(f.calls(),calls);f.state.cfg.autoTasks.push(task);f.state.cfg[task==='auto'?'zoneAuto':'catMode']=true;f.random(0);f.refresh();assert.equal(await f.c.syncLimitRanges(),true);
 assert.equal(f.state.cfg[key],2);assert.equal(f.state.rt.farmQuota[task].got,0);assert.equal(f.state.rt.farmQuota[task].done,undefined);
 f.random(1-Number.EPSILON);await f.menu({resetFarmQuota:task});assert.equal(f.state.cfg[key],4);assert.equal(f.state.rt.farmQuota[task].got,0);
});
test('changing range rejects an old battle even when random chooses the same target',async()=>{
 const f=fixture();f.random(0);await f.edit('autoKillLimit',3,5);f.refresh();const t=await f.begin();f.grow(3);await f.edit('autoKillLimit',3,10);f.refresh();await f.win(t);assert.equal(f.state.cfg.zoneAuto,true);assert.equal(f.state.rt.farmQuota.auto.got,0);
});
test('fixed value turns off range and future midnight reroll; other ranges survive',async()=>{
 const f=fixture();await f.edit('dailyKillLimit',100,300);await f.edit('dailyFishLimit',10,20);await f.menu({cfgPatch:{dailyKillLimit:40}});assert.equal(f.state.cfg.limitRanges.dailyKillLimit,undefined);assert.ok(f.state.cfg.limitRanges.dailyFishLimit);
 f.advance();await f.resolve();assert.equal(f.state.cfg.dailyKillLimit,40);
});
test('cast goal rerolls on statistics reset while daily fish quota keeps its value',async()=>{
 const f=fixture();await f.edit('fishMaxCasts',100,200);await f.edit('dailyFishLimit',5,10);const daily=f.state.cfg.dailyFishLimit;f.random(0);await f.menu({rtPatch:{fish:null}});assert.equal(f.state.cfg.fishMaxCasts,100);assert.equal(f.state.cfg.dailyFishLimit,daily);
});
for(const type of ['fish','proof'])test(type+': one-off goal samples once and survives further menu operations',async()=>{
 const f=fixture();assert.equal((await f.menu({setFishGoal:{type,min:10,max:20}})).ok,true);const goal=structuredClone(f.state.rt.fishTgt);assert.equal(goal.n,15);assert.equal(goal.type,type);await f.menu({rtPatch:{keep:22}});assert.deepEqual(f.state.rt.fishTgt,goal);
});
test('invalid, fractional or unsupported bounds do not write anything',async()=>{
 for(const E of [{key:'autoKillLimit',min:0,max:20},{key:'autoKillLimit',min:30,max:20},{key:'autoKillLimit',min:1.5,max:20},{key:'autoKillLimit',min:2,max:Infinity},{key:'epicCoinDailyMax',min:1,max:5},{key:'__proto__',min:1,max:3}]){
 const f=fixture(),before=structuredClone(f.state);assert.equal((await f.menu({limitRangeEdit:E})).ok,false);assert.equal(JSON.stringify(f.state),JSON.stringify(before));assert.equal(f.calls(),0);}
});
test('range edits and resolve reject stale character or owner, Stop and write failure',async()=>{
 const f=fixture();assert.equal((await f.menu({expectedChar:'Other',limitRangeEdit:{key:'autoKillLimit',min:1,max:3}})).ok,false);assert.equal(f.calls(),0);
 await f.edit('dailyFishLimit',10,20);f.advance();f.state.lock.epoch=2;assert.equal((await f.resolve()).ok,false);f.state.lock.epoch=1;f.state.on=false;assert.equal((await f.resolve()).ok,false);
 f.state.on=true;f.refresh();f.fail();assert.equal(await f.c.syncLimitRanges(),false);assert.equal(f.state.rt.limitRolls.dailyFishLimit.day,'2026-10-17');
});
test('same fixed existing defaults do not gain random limits; UI ranges use explicit Apply',()=>{
 const base=JSON.parse(read('base-profile.json'));assert.deepEqual(Object.keys(base.cfg.limitRanges).sort(),['dailyFishLimit']);const html=read('popup.html');for(const key of ['dailyFishLimit','dailyKillLimit','autoKillLimit','catKillLimit','fishMaxCasts'])for(const suffix of ['From','To','RangeSet','RangeClear','RangeInfo'])assert.ok(html.includes('id="'+key+suffix+'"'));
 /* 20.12 (UI-1): полной записи формы больше нет вовсе — выпавший лимит диапазона не перезаписывается старым числом формы */assert.match(read('popup.js'),/if \(!one\.length\) return false;/);assert.match(html,/id="fishTgtMax"/);
});

test('ordinary popup Start/Stop and statistics commands remain available with active ranges',async()=>{
 const f=fixture();await f.edit('dailyFishLimit',10,20);
 const sender={url:'chrome-extension://test/popup.html'};
 assert.equal((await f.bg.menuPatch({rtPatch:{},on:false},sender)).ok,true);assert.equal(f.state.on,false);
 assert.equal((await f.bg.menuPatch({rtPatch:{},on:true},sender)).ok,true);assert.equal(f.state.on,true);
 assert.equal((await f.bg.menuPatch({rtPatch:{fish:null}},sender)).ok,true);
});

test('Stop remains available even with a malformed imported range',async()=>{
 const f=fixture();f.state.cfg.limitRanges={autoKillLimit:{min:0,max:1}};
 const r=await f.bg.menuPatch({rtPatch:{},on:false},{url:'chrome-extension://test/popup.html'});assert.equal(r.ok,true);assert.equal(f.state.on,false);
});

test('ordinary midnight popup write does not drop an active battle or rebaseline fish catches',async()=>{
 const f=fixture();await f.edit('dailyKillLimit',10,20);await f.edit('dailyFishLimit',10,20);f.state.rt.dailyFishMark={t0:10,caught:5};f.refresh();await f.begin();const baseline=structuredClone(f.state.rt.farmQuota.auto.pending);
 f.advance();await f.menu({rtPatch:{keep:19}});assert.equal(f.state.rt.limitRolls.dailyKillLimit.day,'2026-10-17');assert.deepEqual(f.state.rt.farmQuota.auto.pending,baseline);assert.equal(f.state.rt.dailyFishMark.caught,5);
 f.refresh();await f.c.syncLimitRanges();assert.deepEqual(f.state.rt.farmQuota.auto.pending,baseline);f.grow(2);f.refresh();await f.win();assert.equal(f.state.rt.dailyQuota.auto,2);assert.equal(f.state.rt.farmQuota.auto.got,2);assert.equal(f.state.rt.dailyFishMark.caught,5);
});
