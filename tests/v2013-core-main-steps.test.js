'use strict';
// 20.13 (ревизия 17.10, шаг 7, участок core): главный цикл разрезан на шаги без смены порядка; отложенная смена героя (core-a/M1)
// не пускает круг дальше с rt/cfg прежнего героя.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),core=read('content.js');
const slice=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,a);return s.slice(i,j);};
const steps=slice(core,'async function main() {','// Магистр: актуальный');
const enchantCore=read('tests/v1016-enchant-mode-core.test.js');
const fixBox={require,console,URL,Date,Promise,Math,vm,assert,core};
vm.runInNewContext(slice(enchantCore,'function coreFixture(){',"test('выбранная заточка")+';this.mainFixture=mainFixture;',fixBox);

test('охранная строка цикла — один помощник, старого повтора нет',()=>{
 assert.equal((steps.match(/if \(!on \|\| !tabOwner \|\| autonomyMode\(\) === 'enchant'\) continue;/g)||[]).length,0);
 assert.equal((steps.match(/if \(loopStale\(\)\) return true;/g)||[]).length,21);
 assert.match(steps,/const loopStale = \(\) => !on \|\| !tabOwner \|\| autonomyMode\(\) === 'enchant';/);
 // в шагах нет continue/break — только return true / LOOP_BREAK (иначе шаг не выйдет из круга)
 const bodies=steps.slice(steps.indexOf('async function mainTick()'));
 assert.doesNotMatch(bodies,/\bcontinue;|\bbreak;/);
});
test('mainTick: шаги в прежнем порядке',()=>{
 const tick=steps.match(/async function mainTick\(\) \{\s*return ([^;]+);/)[1].replace(/\s+/g,' ');
 const order=[...tick.matchAll(/await (\w+)\(\)/g)].map(m=>m[1]);
 assert.deepEqual(order,['loopLease','loopMigrations','loopGate','loopWatchdog','loopUrgent','loopTaskList','loopEnchant','loopPriority','loopMenuJobs','loopTownJobs','loopSideJobs','loopRaid','loopActivity']);
 for(const f of order)assert.match(steps,new RegExp('async function '+f+'\\(\\) \\{'),f);
 // прежний порядок ключевых веток по тексту
 const at=s=>{const i=steps.indexOf(s);assert.ok(i>0,s);return i;};
 const seq=['await tabLock()','stopPendRetry()','deferredMigrations.rt','if (heroNick() && rt.char !== heroNick()) {','serverDown()','loginPage()','syncLimitRanges()','L2V7Modules.pvp.recoveryStep()','progressMonitor.tick(','rt.revive','await tvtStep()','Array.isArray(cfg.autoTasks)',"if (autonomyMode() === 'enchant') {",'L2V7Modules.pvp.seedConfirmed()','L2V7Modules.raid.rbOneStep()','L2V7Modules.tvt.tvtHold()) { taskPolicyNote','pveFishingStep()','inventoryReady()','castReconcile(','{ await shopStep(); await sleep(300); return true; }','magisterDisable()','townBuffStep()','rt.bagCheck','rt.faScan','rt.epicScanReq','rt.rbGo && !isBattle()','rt.zoneGo && !isBattle()',"townBuffStart('сторож","rt.fishSvc && !isBattle()",'if (await sealQueue())','mammon.mmStep()','story.storyStep()','tvtshop.shopStep()','dailies.clanStep()','dailies.dailyStep()','warlockTripStep()','warlock.step()','await epicStep()','await invScanStep()','await rbHuntStep()','weaponRescanWhy(','campLocationStep()',"rt.fishService === 'cut'",'await fishing()','await catGo()','await goOutskirts()','await sleep(isBattle() ? 40 : 200)'];
 for(let i=1;i<seq.length;i++)assert.ok(at(seq[i-1])<at(seq[i]),seq[i-1]+' → '+seq[i]);
});
test('главный цикл: «нет прогресса» после 3 восстановлений выходит из цикла (бывший break)',async()=>{
 const c=fixBox.mainFixture();c.cfg.enchantMode=false;let halted=0;
 Object.assign(c,{progressMonitor:{tick:()=>'stalled'},automationSnapshot:()=>1,automationCurrent:()=>true,srvUp:async()=>true,halt:async()=>{halted++},
  sleep:async()=>{},enchantModePause:async()=>{},syncLimitRanges:async()=>true,limitSyncDue:()=>false,limitSyncBlock:()=>false});
 c.rt.stallRecoveries=[Date.now(),Date.now(),Date.now()];
 await vm.runInContext('main()',c);   // без выхода по LOOP_BREAK цикл крутился бы вечно (on не снят)
 assert.equal(halted,1);assert.equal(c.running,false);
});
test('M1: смена героя отложена (switchChar не сменил rt) — круг не идёт дальше, повтор через 0,5 с',async()=>{
 const c=fixBox.mainFixture({recovery:true}),calls=c.calls;c.cfg.enchantMode=false;c.rt.char='Old';
 const waits=[];
 Object.assign(c,{switchChar:async()=>{calls.push('switch')},sleep:async ms=>{waits.push(ms);c.on=false}});
 await vm.runInContext('main()',c);
 assert.ok(calls.includes('switch'));assert.deepEqual(waits,[500]);
 assert.ok(!calls.includes('recovery'),'PvP/бой/задачи с памятью прежнего героя не начинаются: '+JSON.stringify(calls));
});
test('M1: смена героя состоялась — круг продолжается как раньше',async()=>{
 const c=fixBox.mainFixture({recovery:true}),calls=c.calls;c.cfg.enchantMode=false;c.rt.char='Old';
 Object.assign(c,{switchChar:async()=>{calls.push('switch');c.rt.char='Hero'}});
 await vm.runInContext('main()',c);
 assert.ok(calls.includes('switch')&&calls.includes('recovery'),JSON.stringify(calls));
});

// --- core-a/L1: частый статус — в маленьком ключе live@Ник, rt.status — не чаще раза в минуту
// 20.41 (замер цепочки катакомб, память 1,3 МБ): при записанном live@Ник минутная копия rt.status — отложенной записью (setRtSoon);
// без live — по-прежнему обычной setRt. writes — обычные записи, soon — отложенные.
function statusBox(opt={}){
 let now=1e12;const sets=[],writes=[],soon=[];
 const c={rt:{char:'Hero',status:''},tabIdle:!!opt.idle,on:opt.on??true,tabOwner:opt.owner??true,leaseEpoch:opt.owner===false?null:'e1',document:{prerendering:false},Date:{now:()=>now},String,
  chrome:{storage:{local:{set:async v=>{sets.push(v)}}}},quietErr(){},recBot(){},draw(){},
  setRt:p=>{writes.push(p);c.rt={...c.rt,...p};return Promise.resolve({ok:true})},setRtSoon:p=>{soon.push(p);c.rt={...c.rt,...p};return Promise.resolve({ok:true,deferred:true})}};
 vm.createContext(c);vm.runInContext(slice(core,'const RECENT = [];','// Команда остановки сериализуется')+';this.S=setStatus;this.save=statusSave;',c);
 return {c,sets,writes,soon,tick:ms=>{now+=ms}};
}
test('L1: статус каждые 2,5 с идёт в live@Ник, весь rt — раз в минуту',()=>{
 const b=statusBox();
 b.c.S('Бой: моб 1');assert.equal(b.soon.length,1,'первая запись rt (20.41: отложенная)');assert.equal(b.writes.length,0,'20.41: без обычной записи');assert.deepEqual(Object.keys(b.sets[0]),['live@Hero']);
 for(let i=2;i<=20;i++){b.tick(3000);b.c.S('Бой: моб '+i);}   // ≈57 с
 assert.equal(b.soon.length,1,'rt не переписывается на каждый статус');assert.equal(b.sets.length,20);
 assert.equal(b.sets.at(-1)['live@Hero'].s,'Бой: моб 20');assert.equal(b.c.rt.status,'Бой: моб 20','память вкладки — свежая');
 b.tick(5000);b.c.S('Бой: моб 21');assert.equal(b.soon.length,2,'раз в минуту rt.status освежается');assert.equal(b.writes.length,0);
});
test('L1: вкладка, ждущая чужой замок, не пишет live (старый путь — setRt, он сам откажет)',()=>{
 const b=statusBox({idle:true});b.c.S('⏸ Бот уже работает в другой вкладке');assert.equal(b.sets.length,0);assert.equal(b.writes.length,1);
});
test('L1 (ревью): бот включён, замка у вкладки нет (ещё не tabIdle) — live не пишем, как rtWriter',()=>{
 const b=statusBox({owner:false});b.c.S('Загрузка');assert.equal(b.sets.length,0);assert.equal(b.writes.length,1);
 const off=statusBox({on:false,owner:false});off.c.S('Бот выключен');assert.equal(off.sets.length,1,'бот выключен — писать можно (как rtWriter: !on)');
});
test('L1: остановка пишет и rt.status, и live@Ник',async()=>{
 const b=statusBox();await b.c.save('Остановлено');assert.equal(b.writes.at(-1).status,'Остановлено');assert.equal(b.sets.at(-1)['live@Hero'].s,'Остановлено');
 assert.match(core,/leaseEpoch === epoch\) await statusSave\(msg\);/);
});
test('L1: меню берёт live@Ник своего героя, иначе rt.status; память/экспорт без live-ключей',async()=>{
 const popup=read('popup.js'),store={'live@Hero':{s:'Бой: свежий',t:1,char:'Hero'},'live@Old':{s:'чужой',t:1,char:'Old'}};
 const c={chrome:{storage:{local:{get:async k=>({[k]:store[k]})}}}};vm.createContext(c);
 vm.runInContext(slice(popup,'const isLiveKey','async function load()')+';this.F=liveStatusInto;this.K=isLiveKey;',c);
 assert.equal((await c.F({char:'Hero',status:'старый'})).status,'Бой: свежий');
 assert.equal((await c.F({char:'Nobody',status:'старый'})).status,'старый');
 store['live@Hero']={s:'x',char:'Other'};assert.equal((await c.F({char:'Hero',status:'старый'})).status,'старый','чужой герой в ключе — не верим');
 assert.ok(c.K('live@Hero')&&!c.K('rt@Hero'));
 assert.match(popup,/await liveStatusInto\(rt\);/);assert.match(popup,/Object\.keys\(ch\)\.some\(isLiveKey\)\) return loadSoon\(\);/);
 assert.equal((popup.match(/!MEM_SKIP\.has\(k\) && !isLiveKey\(k\)/g)||[]).length,2,'сохранение и загрузка памяти без live@');
 assert.match(read('background.js'),/await chrome\.storage\.local\.remove\('live@' \+ nick\)/,'смена героя стирает старый живой статус');
});

// --- пустые catch вокруг записи памяти и замка → журнал раз в 10 мин
test('потеря записи памяти/замка пишется в журнал (quietErr), а не глушится',()=>{
 const i=core.indexOf('const quietErrs'),w=core.indexOf('const rtWriter = L2EngineCore.createPatchQueue(');assert.ok(i>0&&i<w,'quietErr объявлен до rtWriter');
 const writer=slice(core,'const rtWriter = L2EngineCore.createPatchQueue(',"addEventListener('pagehide'");
 assert.match(writer,/quietErr\('запись памяти', e\);/);assert.doesNotMatch(writer,/\.catch\(\(\) => \{\}\)/);
 assert.doesNotMatch(core,/rtWriter\.recover\(\)\.catch\(\(\) ?=> ?\{\}\)/);
 assert.doesNotMatch(core,/lockRelease[^\n]*\.catch\(\(\) ?=> ?\{\}\)/);
 assert.doesNotMatch(core,/lockRelease', epoch: a\.epoch \}, 9000\); \} catch \(e\) \{\}/);
 assert.doesNotMatch(core,/try \{ await rtWriter\.recover\(\); \} catch \(e\) \{\}/);
 // функционально: одна строка журнала на 10 мин со счётчиком
 let now=1e12;const recs=[];const c={Date:{now:()=>now},String,rec:(...a)=>recs.push(a.join(' '))};vm.createContext(c);
 vm.runInContext(slice(core,'const quietErrs','// 20.13 (ревизия 17.10, шаг 7, аудит «Код»): пустые catch')+';this.q=quietErr;',c);
 c.q('запись памяти',Error('ownership_lost'));c.q('запись памяти',Error('ownership_lost'));now+=601000;c.q('запись памяти',Error('write_failed'));
 assert.equal(recs.length,2);assert.match(recs[0],/запись памяти: ownership_lost/);assert.match(recs[1],/×2 за 10 мин/);
});
