'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const b={console,URLSearchParams,sessionStorage:{getItem:()=>null},document:{querySelectorAll:()=>[]}};
 for(const name of ['actions','survival'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules',name+'.js'),'utf8'),b);
 let hook=()=>{},rt={char:'HeroA',manualKickAt:1};const writes=[],fires=[],halts=[],route={pathname:'/battle.html',search:'?spawnId=mob1',href:''};
 const env={get rt(){return rt},set rt(v){rt=v},on:true,tabOwner:true,leaseEpoch:'A',cfg:{autoRevive:true},pvpPending:()=>false,epicOn:()=>false,
 setRt:async p=>{writes.push({char:rt.char,p});rt={...rt,...p};await hook('setRt',p);return {ok:true}},rec(){},setStatus(){},sleep:async()=>hook('sleep'),rnd:()=>1,
 waitFor:async f=>{await hook('waitFor');return f()},$q:()=>null,shown:()=>false,byText:()=>null,halt:async msg=>halts.push(msg),pause:async()=>hook('pause'),
 isCity:()=>route.pathname==='/city.html',isBattle:()=>route.pathname==='/battle.html',isMap:()=>route.pathname==='/map.html',toOutskirts:async()=>fires.push('outskirts')};
 const a=b.L2V7Factories.actions({get rt(){return rt},cfg:{},get on(){return env.on},get tabOwner(){return env.tabOwner},mode:()=> 'auto',lease:()=>env.leaseEpoch});a.enterFrame();
 env.routeLocation=a.locationProxy(route);env.fire=el=>{if(!a.canAct())return false;fires.push(el);return true};
 const mutate=kind=>{if(kind==='actor')rt={char:'HeroB',manualKickAt:1,marker:'new-profile'};if(kind==='lease')env.leaseEpoch='B';if(kind==='stop')env.on=false;if(kind==='owner')env.tabOwner=false;if(kind==='kick')rt={...rt,manualKickAt:2};};
 return {env,route,writes,fires,halts,mutate,A:a,S:b.L2V7Factories.survival(env),set hook(fn){hook=fn}};
}
for(const kind of ['actor','lease','stop','owner','kick'])for(const point of ['sleep','waitFor'])test(`death: ${kind} during ${point} cannot write revive or act`,async()=>{
 const f=fixture();let switched=false,writesAtSwitch=0;f.hook=async p=>{if(p===point&&!switched){switched=true;writesAtSwitch=f.writes.length;f.mutate(kind)}};await f.S.onDeath();
 assert.equal(switched,true);assert.equal(f.writes.length,writesAtSwitch);assert.equal(f.env.rt.revive?.revived,kind==='actor'?undefined:false);assert.equal(f.fires.length,0);assert.equal(f.writes.filter(x=>x.char==='HeroB').length,0);
});
for(const kind of ['actor','lease','stop','owner','kick'])test(`revival: ${kind} while finding city statue preserves newer context`,async()=>{
 const f=fixture();f.route.pathname='/city.html';f.env.rt.revive={t:Date.now(),revived:true};let switched=false;
 f.hook=async p=>{if(p==='waitFor'&&!switched){switched=true;f.mutate(kind)}};await f.S.reviveStep();
 assert.equal(switched,true);assert.equal(f.env.rt.tbuff,undefined);assert.equal(f.writes.length,0);assert.equal(f.fires.length,0);assert.equal(f.route.href,'');
});
test('revival: actor changes while waiting for missing defeat button; no foreign revived flag',async()=>{
 const f=fixture();f.env.rt.revive={t:Date.now(),revived:false};f.hook=async p=>{if(p==='waitFor')f.mutate('actor')};await f.S.reviveStep();assert.equal(f.env.rt.revive,undefined);assert.equal(f.writes.length,0);
});
test('death: actor changes while raid death accounting settles; no foreign halt or revive',async()=>{
 const f=fixture();f.env.rbRun={death:async()=>f.mutate('actor')};await f.S.onDeath();assert.equal(f.env.rt.revive,undefined);assert.equal(f.writes.filter(x=>x.char==='HeroB').length,0);assert.equal(f.halts.length,0);
});
test('restore: actor changes at durable write; no old route continuation',async()=>{
 const f=fixture();f.hook=async p=>{if(p==='setRt')f.mutate('actor')};assert.equal(await f.S.restoreVitals('test'),false);assert.equal(f.route.href,'');assert.equal(f.writes.filter(x=>x.char==='HeroB').length,0);
});
// 20.13 (ревизия 17.10, шаг 7, combat/C12): мёртвая lowHpEscape (остановка бота после 3 просадок HP) удалена — её больше нет ни в модуле, ни в ядре
test('low HP: no stop-after-3-dips escape remains in survival or core',()=>{
 const f=fixture();assert.equal(f.S.lowHpEscape,undefined);assert.equal(f.halts.length,0);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),/lowHpEscape/);
});
test('normal death still records old profile and schedules recovery',async()=>{
 const f=fixture();await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rt.revive.revived,false);assert.equal(f.env.rt.revive.url,'/battle.html?spawnId=mob1');
});
test('Stop during death wait preserves own recovery; resume does not count the death twice',async()=>{
 const f=fixture();f.hook=async p=>{if(p==='sleep')f.env.on=false};await f.S.onDeath();assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rt.revive.revived,false);
 f.env.on=true;f.hook=()=>{};await f.S.reviveStep();assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rt.revive.revived,true);
});
