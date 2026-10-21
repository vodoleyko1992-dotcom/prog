'use strict';
// 20.43 (решение игрока 21.10 06:19 «Да, быстрее»; лог 21.10 15:50–15:51 Catacomb of Dark Omens 72–78 ур.): штатное «Охотиться дальше»
// и в подземелье с мобами разных уровней, если ≥5 соседей и ≥60 % из них в окне героя (не ниже −5); выбор сервера вне окна дважды — свой выбор.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const dungeon='catacomb_of_dark_omens',sid=n=>'sdms_'+dungeon+'_'+n;
const row=(n,name,level)=>({id:sid(n),name,level,kind:'passive',inBattleRange:true});
const omens=()=>[row('016','Nephilim Commander',78),row('026','Lilim Great Mystic',78),row('041','Lesser Ancient Warrior',78),row('050','Crypt Preacher',75),row('060','Tomb Guard',74),row('070','Lilim Slayer',72),row('080','Nephilim Royal Guard',77),row('081','Tomb Guard',76)];
function fixture(rows=omens()){
 const f=flowFixture('fighter'),{env,location:loc,events}=f;
 loc.pathname='/battle.html';loc.search='?spawnId='+sid('016');loc.href='https://l2wap.com/battle.html'+loc.search;
 Object.assign(env.cfg,{catMode:true,catDungeon:'auto',chain:true,noCancelMobs:true,lvlBelow:5,lvlAbove:5,farmRes:''});
 Object.assign(env.rt,{char:'Hero',manualKickAt:1,buffCancel:{},catCur:dungeon});
 env.routeLocation=loc;env.autonomyMode=()=>'cat';env.heroLvl=()=>78;env.CAT_LIST={[dungeon]:['Catacomb of Dark Omens',72,78]};env.canAct=()=>true;env.canRun=()=>true;
 env.cancelRisk=()=>null;env.catGo=async()=>events.push('catGo');
 env.gameGet=async p=>{events.push('GET '+p);return{ok:true,json:async()=>({dungeon:{id:dungeon,mobs:rows}})}};
 const ss=new Map(),box={console,Date,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc,sessionStorage:{getItem:k=>ss.has(k)?ss.get(k):null,setItem:(k,v)=>ss.set(k,String(v))}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();env.catNatArm=()=>D.catNatArm();f.setWon(true);
 return {...f,D,setRows:r=>{rows.length=0;rows.push(...r)},run:()=>f.farm.nextFight({name:'Nephilim Commander'})};
}
const nav=f=>f.location.href.startsWith('/battle.html?spawnId=');
test('Dark Omens 72–78, герой 78: штатное «Охотиться дальше» без новой страницы',async()=>{
 const f=fixture();await f.run();assert.ok(f.events.includes('hunt'));assert.ok(!nav(f));
});
test('большинство соседей ниже окна героя (−5): свой выбор и переход',async()=>{
 const f=fixture([row('016','Nephilim Commander',78),row('026','Lilim Great Mystic',78),row('030','Low',70),row('031','Low',70),row('032','Low',71),row('033','Low',72)]);
 await f.run();assert.ok(!f.events.includes('hunt'));assert.ok(nav(f));
});
test('сервер дважды подряд дал моба ниже окна: в этом документе снова свой выбор',async()=>{
 const f=fixture();await f.run();assert.ok(f.events.includes('hunt'));
 const step=async(n,name,lvl)=>{f.location.search='?spawnId='+sid(n);f.location.href='https://l2wap.com/battle.html'+f.location.search;f.setWon(true);f.events.length=0;f.setRows([...omens(),row(n,name,lvl)]);await f.run();return f.events.includes('hunt')};
 assert.equal(await step('090','Crypt Preacher',75),true,'75 — в окне, удачный выбор');
 assert.equal(await step('091','Lilim Slayer',72),true,'72 — первая неудача');
 assert.equal(await step('092','Lilim Slayer',72),false,'вторая подряд — свой выбор');assert.ok(nav(f));
});
