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
 const ss=new Map(),box={console,Date,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc,sessionStorage:{getItem:k=>ss.has(k)?ss.get(k):null,setItem:(k,v)=>ss.set(k,String(v))}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();env.catNatArm=()=>D.catNatArm();f.setWon(true);
 return {...f,D,ss,setRows:r=>{rows.length=0;rows.push(...r)},run:()=>f.farm.nextFight({name:'Lilim Knight Banneret'})};
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
// 20.41 (ревью): отказ сервера на штатное продолжение виден уже на странице подземелья — 30 мин свой выбор в этом подземелье.
test('штатное продолжение не начало бой: на странице подземелья метка отказа, дальше свой выбор',async()=>{
 const f=fixture();await f.run();assert.ok(f.events.includes('hunt'));
 const recs=[];f.env.rec=(...a)=>recs.push(a.join(' '));assert.equal(f.D.catNatFail(dungeon),true,'игра увела на /dungeon.html');assert.match(recs.join('|'),/не начало бой/);
 f.setWon(true);f.events.length=0;f.location.href='https://l2wap.com/battle.html'+f.location.search;await f.run();
 assert.ok(!f.events.includes('hunt'));assert.ok(nav(f),'свой выбор и переход');
});
test('удачное штатное продолжение снимает метку: страница подземелья позже не считается отказом',async()=>{
 const f=fixture();await f.run();f.D.catNatOk();assert.equal(f.D.catNatFail(dungeon),false);
 f.setWon(true);f.events.length=0;await f.run();assert.ok(f.events.includes('hunt'));
});
test('предзагрузка списка не удалась: на победе список читается заново',async()=>{
 const f=fixture();let n=0;const get=f.env.gameGet;f.env.gameGet=async p=>++n===1?{ok:false,status:503,json:async()=>({})}:get(p);
 f.D.catPrefetch();await f.run();assert.equal(n,2);assert.ok(f.events.includes('hunt'));assert.ok(!f.events.includes('catGo'));
});
test('выбранное вручную подземелье: предзагрузки списка нет',()=>{
 const f=fixture();f.env.cfg.catDungeon=dungeon;f.D.catPrefetch();assert.equal(f.events.filter(x=>x.startsWith('GET ')).length,0);
});
test('страница подземелья первым делом сверяет метку штатного продолжения; удачный старт в цепочке её снимает',()=>{
 const src=fs.readFileSync(require('node:path').join(__dirname,'../modules/dungeons.js'),'utf8'),a=src.indexOf('async function catHunt(id) {');
 assert.match(src.slice(a,a+200),/if \(!active\(\)\) return;[^\n]*\n\s*catNatFail\(id\);/);
 const mf=fs.readFileSync(require('node:path').join(__dirname,'../modules/mobfarm.js'),'utf8');assert.match(mf,/if \(ok\) env\.catNatOk\?\.\(\);[^\n]*\n\s*if \(ok \|\| !env\.on\) return;/);
});
test('старая метка (больше минуты) — не отказ; свежая в пределах минуты — отказ',()=>{
 const f=fixture();f.env.rec=()=>{};
 f.ss.set('l2bot.catNat',JSON.stringify({wait:{id:dungeon,t:Date.now()-61000}}));assert.equal(f.D.catNatFail(dungeon),false);
 f.ss.set('l2bot.catNat',JSON.stringify({wait:{id:dungeon,t:Date.now()-40000}}));assert.equal(f.D.catNatFail(dungeon),true);
 f.ss.set('l2bot.catNat',JSON.stringify({wait:{id:'other_dungeon',t:Date.now()}}));assert.equal(f.D.catNatFail(dungeon),false);
});
// 20.41 (ревью 2): метка ожидания — только перед самим нажатием. Без нажатия (дневной лимит, Stop, нет кнопки) страница подземелья
// не считается отказом сервера и не выключает штатное продолжение на 30 мин.
test('выбрано штатное продолжение, но кнопку не нажали: страница подземелья — не отказ',async()=>{
 const f=fixture();f.env.dailyWorkReady=async()=>false;await f.run();assert.ok(!f.events.includes('hunt'));
 f.env.rec=()=>{};assert.equal(f.D.catNatFail(dungeon),false);assert.equal(JSON.parse(f.ss.get('l2bot.catNat')||'{}').off,undefined);
});
test('метку ставит нажатие: mobfarm вызывает catNatArm прямо перед fire(hunt), catNative её не пишет',()=>{
 const mf=fs.readFileSync(require('node:path').join(__dirname,'../modules/mobfarm.js'),'utf8');assert.match(mf,/if \(native\) env\.catNatArm\?\.\(\); env\.fire\(hunt\);/);
 const src=fs.readFileSync(require('node:path').join(__dirname,'../modules/dungeons.js'),'utf8'),a=src.indexOf('function catNative('),b=src.indexOf('\n}',a);assert.ok(!/natSave/.test(src.slice(a,b)));
 assert.match(fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8'),/get catNatArm\(\) \{ return \(\) => L2V7Modules\.dungeons\.catNatArm\(\); \}/);
});
