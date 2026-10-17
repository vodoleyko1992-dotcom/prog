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
 const seq=['await tabLock()','stopPendRetry()','deferredMigrations.rt','if (heroNick() && rt.char !== heroNick()) {','serverDown()','loginPage()','syncLimitRanges()','L2V7Modules.pvp.recoveryStep()','progressMonitor.tick(','rt.revive','await tvtStep()','Array.isArray(cfg.autoTasks)',"if (autonomyMode() === 'enchant') {",'L2V7Modules.pvp.seedConfirmed()','L2V7Modules.raid.rbOneStep()','L2V7Modules.tvt.tvtHold()) { taskPolicyNote','pveFishingStep()','inventoryReady()','castReconcile(','{ await shopStep(); await sleep(300); return true; }','magisterDisable()','townBuffStep()','rt.bagCheck','rt.faScan','rt.epicScanReq','rt.rbGo && !isBattle()','rt.zoneGo && !isBattle()',"townBuffStart('сторож","rt.fishSvc && !isBattle()",'sealDue()','mammon.mmStep()','story.storyStep()','tvtshop.shopStep()','dailies.clanStep()','dailies.dailyStep()','warlockTripStep()','warlock.step()','await epicStep()','await invScanStep()','await rbHuntStep()','weaponRescanWhy(','campLocationStep()',"rt.fishService === 'cut'",'await fishing()','await catGo()','await goOutskirts()','await sleep(isBattle() ? 40 : 200)'];
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
