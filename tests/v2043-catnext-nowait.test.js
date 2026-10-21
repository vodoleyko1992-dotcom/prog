'use strict';
// 20.43 (лог 21.10 15:47–15:51): «итог боя» → «следующий бой» ≈1,0 с — переход к следующему мобу катакомб ждал записи пути
// (mobClickAt — полная запись ≈960 КБ за двумя такими же в очереди фона). Теперь для обычного моба путь пишется отложенно,
// без ожидания; уход со страницы отправляет его, и новый бой видит via:'dungeon'.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const dungeon='catacomb_of_dark_omens',sid=n=>'sdms_'+dungeon+'_'+n;
function fixture(){
 const f=flowFixture('fighter'),{env,location:loc,events}=f;
 loc.pathname='/battle.html';loc.search='?spawnId='+sid('056');loc.href='https://l2wap.com/battle.html'+loc.search;
 Object.assign(env.cfg,{catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:10,farmRes:''});
 Object.assign(env.rt,{char:'Hero',manualKickAt:1,catCur:dungeon,catLv:{[dungeon]:{lo:78,hi:78,n:3,t:1}}});
 const rows=[{id:sid('056'),name:'Nephilim Commander',level:78,kind:'passive',inBattleRange:true},{id:sid('073'),name:'Lilim Court Knight',level:78,kind:'passive',inBattleRange:true}];
 env.routeLocation=loc;env.autonomyMode=()=>'cat';env.heroLvl=()=>78;env.CAT_LIST={[dungeon]:['Dark Omens',70,80]};env.canAct=()=>true;env.canRun=()=>true;
 env.catGo=async()=>events.push('catGo');env.gameGet=async p=>{events.push('GET '+p);return{ok:true,json:async()=>({dungeon:{id:dungeon,mobs:rows}})}};
 const writes=[],later={};
 env.setRt=p=>{writes.push(Object.keys(p));Object.assign(env.rt,p);events.push('write:start');return new Promise(r=>setTimeout(()=>{events.push('write:done');r({ok:true})},300))};
 env.setRtSoon=p=>{Object.assign(env.rt,p);Object.assign(later,p);events.push('soon');return Promise.resolve({ok:true,deferred:true})};
 const box={console,Date,Math,URLSearchParams,setTimeout,document:{querySelectorAll:()=>[]},location:loc};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);f.setWon(true);
 return {...f,D,later,writes};
}
test('обычный следующий моб: переход без ожидания записи, путь в отложенной очереди',async()=>{
 const f=fixture(),t0=Date.now(),p=f.D.catNext();
 await new Promise(r=>setTimeout(r,20));
 assert.match(f.location.href,/_073$/,'переход уже начат: '+f.location.href);
 assert.ok(!f.events.includes('write:start'),'обычной (ожидаемой) записи пути нет');
 assert.equal(f.later.via,'dungeon');assert.equal(f.later.target.name,'Lilim Court Knight');assert.ok(f.later.mobClickAt>0);
 f.setWon(false);await p;assert.ok(Date.now()-t0<300);
});
test('исходник: путь обычного моба — setRtSoon, getter в фабрике dungeons; начало боя сбрасывает петлю отложенно',()=>{
 const d=fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8'),c=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),cb=fs.readFileSync(path.join(__dirname,'../modules/combat.js'),'utf8');
 assert.match(d,/if \(env\.setRtSoon\) env\.setRtSoon\(route\)/);
 assert.match(c,/L2V7Factories\.dungeons\(\{ get badgeSync\(\)\{return badgeSync\}, get setRtSoon\(\)\{return setRtSoon\}/);
 assert.match(cb,/if \(env\.rt\.bounce \|\| env\.rt\.mobClickAt\) rtSoon\(\{ bounce: 0, mobClickAt: 0 \}\);/);
});
test('отложенный путь уходит при уходе со страницы (pagehide → peek) — новый бой видит via:dungeon',()=>{
 const box={globalThis:{}};box.globalThis=box;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../engine-core.js'),'utf8'),box);
 const sent=[],q=box.L2EngineCore.createPatchQueue(async p=>{sent.push(p);return{ok:true}},()=>true,()=>{},()=>Date.now(),{set:()=>1,clear:()=>{}});
 q.defer({target:{name:'Lilim Court Knight'},mobClickAt:5,via:'dungeon',catInT:5});
 assert.equal(q.peek().via,'dungeon');assert.equal(q.peek().mobClickAt,5);
 const c=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 assert.match(c,/addEventListener\('pagehide', \(\) => \{\s*try \{[\s\S]{0,200}const p = rtWriter\.peek\(\);[\s\S]{0,200}cmd: 'statePatch', patch: p/);
});
