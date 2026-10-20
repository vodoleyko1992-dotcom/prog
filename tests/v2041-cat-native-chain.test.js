'use strict';
// 20.41 (лог 20.10 21:15: моб катакомб ≈9 с, из них ≈4 с — загрузка новой страницы боя): однородный свежий список — следующий бой
// штатной кнопкой «Охотиться дальше» без перезагрузки; разнородный, с Cancel или после двух неудачных выборов сервера — прежний переход.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const dungeon='necropolis_of_martyrdom',sid=n=>'sdms_'+dungeon+'_'+n;
const row=(n,name,level,kind='passive')=>({id:sid(n),name,level,kind,inBattleRange:true});
const uniform=()=>[row('013','Lilim Knight Banneret',72),row('032','Nephilim Praetorian',72),row('040','Lilim Knight Banneret',72),row('051','Nephilim Praetorian',72),row('060','Lilim Knight Banneret',72)];
function fixture(rows=uniform()){
 const f=flowFixture('fighter'),{env,location:loc,events}=f;
 loc.pathname='/battle.html';loc.search='?spawnId='+sid('013');loc.href='https://l2wap.com/battle.html'+loc.search;
 Object.assign(env.cfg,{catMode:true,catDungeon:'auto',chain:true,noCancelMobs:true,lvlBelow:5,lvlAbove:5,farmRes:''});
 Object.assign(env.rt,{char:'Hero',manualKickAt:1,buffCancel:{},catCur:dungeon});
 env.routeLocation=loc;env.autonomyMode=()=>env.cfg.catMode?'cat':'farm';env.heroLvl=()=>71;env.CAT_LIST={[dungeon]:['Martyrdom',60,75]};env.canAct=()=>true;env.canRun=()=>true;
 env.cancelRisk=()=>null;env.catGo=async()=>events.push('catGo');
 env.gameGet=async path=>{events.push('GET '+path);return{ok:true,json:async()=>({dungeon:{id:dungeon,mobs:rows}})}};
 const box={console,Date,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();f.setWon(true);
 return {...f,D,setRows:r=>{rows.length=0;rows.push(...r)},run:()=>f.farm.nextFight({name:'Lilim Knight Banneret'})};
}
const nav=f=>f.location.href.startsWith('/battle.html?spawnId=');
test('однородный список: штатное «Охотиться дальше», без новой страницы',async()=>{
 const f=fixture();await f.run();
 assert.ok(f.events.includes('hunt'));assert.ok(!nav(f));assert.ok(!f.events.includes('catGo'));
 assert.equal(f.events.filter(x=>x.startsWith('GET ')).length,1);assert.equal(f.env.rt.via,'chain');
});
test('разные уровни рядом: свой выбор и переход, как раньше',async()=>{
 const f=fixture([row('013','Lilim Knight Banneret',72),row('032','Nephilim Praetorian',72),row('040','Grave Warden',64),row('051','Grave Warden',64),row('060','Grave Warden',63)]);
 await f.run();assert.ok(!f.events.includes('hunt'));assert.ok(nav(f));assert.equal(f.env.rt.target.name,'Nephilim Praetorian');
});
test('известный Cancel среди соседей: только свой выбор',async()=>{
 const f=fixture();f.env.cancelRisk=name=>name==='Lilim Knight Banneret'?{n:2}:null;await f.run();
 assert.ok(!f.events.includes('hunt'));assert.ok(nav(f));assert.equal(f.env.rt.target.name,'Nephilim Praetorian');
});
test('меньше трёх соседей: свой выбор',async()=>{
 const f=fixture([row('013','Lilim Knight Banneret',72),row('032','Nephilim Praetorian',72),row('040','Nephilim Praetorian',72)]);await f.run();
 assert.ok(!f.events.includes('hunt'));assert.ok(nav(f));
});
test('цепочка выключена: штатную кнопку не жмём',async()=>{const f=fixture();f.env.cfg.chain=false;await f.run();assert.ok(!f.events.includes('hunt'));assert.ok(f.events.includes('catGo'))});
// Сервер сам выбирает следующего моба; после боя текущий моб виден в свежем списке по spawnId адреса.
const stepper=f=>async(n,name,level)=>{f.location.search='?spawnId='+sid(n);f.location.href='https://l2wap.com/battle.html'+f.location.search;f.setWon(true);f.events.length=0;
 f.setRows([...uniform(),row(n,name,level)]);await f.run();return f.events.includes('hunt')};
test('два чужих выбора сервера подряд: в этом документе снова свой выбор',async()=>{
 const f=fixture();await f.run();assert.ok(f.events.includes('hunt'));const step=stepper(f);
 assert.equal(await step('081','Grave Warden',64),true,'первая неудача — ещё штатная кнопка');
 assert.equal(await step('082','Grave Warden',64),false,'вторая подряд — свой выбор');assert.ok(nav(f));assert.match(f.env.rt.target.name,/Lilim|Nephilim/);
});
test('удачный выбор сервера сбрасывает счёт неудач',async()=>{
 const f=fixture();await f.run();const step=stepper(f);
 for(const [n,name,lvl] of [['081','Grave Warden',64],['082','Nephilim Praetorian',72],['083','Grave Warden',64],['084','Nephilim Praetorian',72]])assert.equal(await step(n,name,lvl),true,n);
});
