'use strict';
// Лог28.10 04:59: штатное воскрешение должно передать собственный маршрут баффов/HP отдельному Rebirth.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../engine-core.js'),file=path.join(__dirname,'v2022-death-once.test.js'),src=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,console,URLSearchParams,structuredClone,process};
vm.runInNewContext(src.slice(0,src.indexOf('\ntest('))+'\nthis.make=fixture;',box);
const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),markerCode=content.slice(content.indexOf('function rebirthDeathRecovery()'),content.indexOf('async function rebirthPrepareHero('));
const RUN='11111111-1111-4111-8111-111111111111',SPAWN='rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_9';
function fixture(o={}){
 const f=box.make({previous:0,...o});Object.assign(f.env.cfg,{rebirthMode:true,autoTasks:['rebirth']});f.env.rt.classCur={prof:'human_wizard',slot:0};
 f.route.search='?spawnId='+SPAWN;f.env.rt.rebirth={char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,runId:RUN,battleSpawn:SPAWN,battleRole:'mob',observedRun:{char:'Hero',kick:f.env.rt.manualKickAt}};
 const c={location:f.route,URLSearchParams,rebirthModeSelected:()=>f.env.cfg.rebirthMode};Object.defineProperty(c,'rt',{get:()=>f.env.rt});vm.runInNewContext(markerCode,c);
 f.env.rebirthDeathRecovery=()=>c.rebirthDeathRecovery();f.env.rebirthRecoveryAllowed=m=>E.rebirthBuffJob(f.env.cfg,f.env.rt,{back:'/rebirth-raids.html',rebirthRecovery:m});return f;
}

test('собственное поражение→город→статуя сохраняет marker и каталог вместо обычной карты',async()=>{
 const f=fixture();await f.S.onDeath();assert.equal(f.route.pathname,'/city.html');assert.equal(f.env.rt.revive.rebirthRecovery.kind,'death');
 assert.equal(f.env.rt.revive.rebirthRecovery.runId,RUN);assert.equal(f.env.rt.revive.rebirthRecovery.spawn,SPAWN);assert.equal(f.env.rt.deathLog.length,1);
 await f.S.reviveStep();assert.equal(f.env.rt.revive,null);assert.equal(f.route.pathname,'/town-buffer.html');
 const job=f.env.rt.tbuff;assert.equal(job.step,'restore');assert.equal(job.back,'/rebirth-raids.html');assert.equal(job.rebirthRecovery.actor,'own-actor');
 assert.equal(E.taskJobAllowed(f.env.cfg,'tbuff',f.env.rt),true);assert.equal(f.clicks.filter(x=>x==='statue').length,1);assert.equal(f.clicks.filter(x=>x==='native-return').length,1);
});

test('исчезновение activeRun не стирает собственное восстановление после смерти',async()=>{
 const f=fixture();await f.S.onDeath();f.env.rt.rebirth={...f.env.rt.rebirth,runPhase:'missing',mobKills:9};await f.S.reviveStep();
 assert.equal(E.rebirthBuffJob(f.env.cfg,f.env.rt),true);assert.equal(f.env.rt.tbuff.rebirthRecovery.runId,RUN);
 assert.equal(f.env.rt.tbuff.back,'/rebirth-raids.html');assert.equal(f.env.rt.deathLog.length,1);
});

for(const change of ['spawn','class','slot','kick','char','actor','ordinary'])test('чужая/повреждённая связь поражения не получает маркер Rebirth: '+change,async()=>{
 const f=fixture(),r=f.env.rt.rebirth;if(change==='spawn')r.battleSpawn+='1';if(change==='class')r.prof='other';if(change==='slot')r.slot=1;
 if(change==='kick')r.observedRun.kick++;if(change==='char')r.observedRun.char='Other';if(change==='actor')r.actor='';if(change==='ordinary')f.route.search='?spawnId=dense_1';
 await f.S.onDeath();assert.equal(f.env.rt.revive.rebirthRecovery,undefined);assert.equal(f.env.rt.deathLog.length,1);
});

for(const point of ['setRt','sleep','waitFor','pause'])for(const change of ['stop','owner','class','kick','mode'])test(`отмена ${change} на границе ${point} не продолжает старое воскрешение`,async()=>{
 const f=fixture();let changed=false;
 if(point==='pause'){await f.S.onDeath();f.route.pathname='/city.html';}
 f.hook=async p=>{if(p===point&&!changed){changed=true;if(change==='mode')f.env.cfg.rebirthMode=false;else f.mutate(change);}};
 const clicks=f.clicks.length;if(point==='pause')await f.S.reviveStep();else await f.S.onDeath();
 assert.equal(changed,true);assert.equal(f.clicks.length,clicks);assert.notEqual(f.route.pathname,'/town-buffer.html');
});

test('изменённая сохранённая метка не превращается в обычный оплачиваемый маршрут',async()=>{
 const f=fixture();await f.S.onDeath();f.env.rt.revive.rebirthRecovery.slot=1;const n=f.clicks.length;await f.S.reviveStep();
 assert.equal(f.clicks.length,n);assert.equal(f.env.rt.revive,null);assert.equal(f.env.rt.tbuff,undefined);
});

test('autoRevive=false не разрешает ни собственный маршрут, ни статую',async()=>{
 const f=fixture({autoRevive:false});await f.S.onDeath();assert.equal(f.clicks.length,0);assert.equal(f.env.on,false);assert.equal(f.env.rt.revive.counted,true);assert.equal(f.env.rt.tbuff,undefined);
});

for(const change of ['kick','mode'])test('новая команда после смерти не оставляет revive навсегда: '+change,async()=>{
 const f=fixture();await f.S.onDeath();const count=f.env.rt.deathLog.length;
 if(change==='kick')f.env.rt.manualKickAt++;else{f.env.cfg.rebirthMode=false;f.env.cfg.autoTasks=['farm'];}
 await f.S.reviveStep();assert.equal(f.env.rt.revive,null);assert.equal(f.env.rt.deathLog.length,count);
 if(change==='kick'){assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.clicks.filter(x=>x==='statue').length,0);}
 else{assert.equal(f.env.rt.tbuff.rebirthRecovery,undefined);assert.equal(f.env.rt.tbuff.back,'/map.html');}
 await f.S.reviveStep();assert.equal(f.env.rt.revive,null);assert.equal(f.env.rt.deathLog.length,count);
});
