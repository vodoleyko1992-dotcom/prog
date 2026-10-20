'use strict';
// 20.7: лог17.10 01:02 — ручная цепочка начала бой, старый nextFight увёл на карту.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const dungeon='catacomb_of_the_branded',sid=n=>'sdms_'+dungeon+'_'+n;
function fixture(){
 const f=flowFixture('fighter'),{env,location:loc,events}=f;
 loc.pathname='/battle.html';loc.search='?spawnId='+sid('119');loc.href='https://l2wap.com/battle.html'+loc.search;
 Object.assign(env.cfg,{catMode:true,catDungeon:'auto',chain:true,noCancelMobs:true,lvlBelow:5,lvlAbove:10,farmRes:''});
 Object.assign(env.rt,{char:'Hero',manualKickAt:1,buffCancel:{priest:{name:'Grave Priest',champ:false,dungeon}},catCur:dungeon});
 let rows=[{id:sid('026'),name:'Grave Priest',level:49,kind:'passive',inBattleRange:true},{id:sid('041'),name:'Decayed Ancient Pikeman',level:49,kind:'aggressive',inBattleRange:true}];
 env.routeLocation=loc;env.autonomyMode=()=>env.cfg.catMode?'cat':'farm';env.heroLvl=()=>49;env.CAT_LIST={[dungeon]:['Branded',40,51]};env.canAct=()=>true;env.canRun=()=>true;
 env.cancelRisk=name=>name==='Grave Priest'?{n:3}:null;env.catGo=async()=>events.push('catGo');
 env.gameGet=async path=>{events.push('GET '+path);return{ok:true,json:async()=>({dungeon:{id:dungeon,mobs:rows}})}};
 const box={console,Date,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../modules/dungeons.js'),'utf8'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();f.setWon(true);
 return {...f,D,setRows:r=>rows=r,run:()=>f.farm.nextFight({name:'Decayed Ancient Pikeman'})};
}
test('память Cancel: следующий безопасный бой открывается без карты и случайного hunt',async()=>{
 const f=fixture();await f.run();assert.equal(f.location.href,'/battle.html?spawnId='+sid('041'));assert.ok(!f.events.includes('catGo'));assert.ok(!f.events.includes('hunt'));
 assert.equal(f.events.filter(x=>x.startsWith('GET ')).length,1);assert.equal(f.env.rt.target.name,'Decayed Ancient Pikeman');
});
test('начавшийся вручную бой не перекрывается возвратом старого nextFight',async()=>{const f=fixture();f.setWon(false);await f.run();assert.ok(!f.events.includes('catGo'));assert.ok(!f.events.some(x=>x.startsWith('GET ')));assert.match(f.location.href,/119$/)});
for(const stage of ['read','save'])for(const why of ['Stop','lease','mode','task','choice','manual','character','hold','chain','new battle'])test(stage+': '+why+' отменяет старый выбор без карты/клика',async()=>{
 const f=fixture(),changes={Stop:()=>f.env.on=false,lease:()=>f.env.tabOwner=false,mode:()=>f.env.cfg.catMode=false,task:()=>f.env.autonomyMode=()=> 'farm',choice:()=>f.env.cfg.catDungeon='other',manual:()=>f.env.rt.manualKickAt++,character:()=>f.env.rt.char='Other',hold:()=>f.env.canRun=()=>false,chain:()=>f.env.cfg.chain=false,'new battle':()=>{f.setWon(false);f.location.search='?spawnId='+sid('112');f.location.href='/battle.html'+f.location.search}};
 const key=stage==='read'?'gameGet':'setRt',old=f.env[key];f.env[key]=async(...a)=>{const r=await old(...a);changes[why]();return r};
 await f.run();assert.ok(!f.events.includes('catGo'));assert.ok(!f.events.includes('hunt'));assert.ok(!f.location.href.endsWith('_041'));
});
test('новая опасность после сохранения цели перепроверяется перед переходом',async()=>{const f=fixture(),save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);if(p.target)f.env.cancelRisk=()=>({n:3});return r};await f.run();assert.ok(!f.location.href.endsWith('_041'));assert.ok(!f.events.includes('catGo'))});
for(const why of ['empty','wrong dungeon','HTTP503','malformed','only banned','foreign spawn','out of range'])test(why+': без подтверждённой цели остаётся прежний запасной список',async()=>{
 const f=fixture();if(why==='empty')f.setRows([]);if(why==='wrong dungeon')f.env.gameGet=async()=>({ok:true,json:async()=>({dungeon:{id:'other',mobs:[]}})});if(why==='HTTP503')f.env.gameGet=async()=>({ok:false});if(why==='malformed')f.env.gameGet=async()=>({ok:true,json:async()=>{throw Error('json')}});if(why==='only banned')f.setRows([{id:sid('026'),name:'Grave Priest',level:49}]);if(why==='foreign spawn')f.setRows([{id:'sdms_other_001',name:'Safe',level:49}]);if(why==='out of range')f.setRows([{id:sid('002'),name:'Safe',level:49,inBattleRange:false}]);
 await f.run();assert.equal(f.events.filter(x=>x==='catGo').length,1);assert.ok(!f.events.includes('hunt'));assert.match(f.location.href,/119$/);
});
// 20.32: штатная случайная цепочка остаётся только при явном ручном выборе подземелья.
test('ручной выбор без памяти Cancel сохраняет штатную цепочку',async()=>{const f=fixture();f.env.cfg.catDungeon=dungeon;f.env.rt.buffCancel={};await f.run();assert.ok(f.events.includes('hunt'));assert.ok(!f.events.some(x=>x.startsWith('GET ')));assert.ok(!f.events.includes('catGo'))});
test('явно отключённая цепочка сохраняет выбор через список',async()=>{const f=fixture();f.env.cfg.chain=false;await f.run();assert.ok(f.events.includes('catGo'));assert.ok(!f.events.some(x=>x.startsWith('GET ')))});
test('цепочка не выбирает чемпиона или РБ из свежего списка',async()=>{const f=fixture();f.setRows([{id:sid('011'),name:'Champion',level:50,kind:'champion'},{id:sid('012'),name:'Raid',level:50,kind:'raid'},{id:sid('041'),name:'Safe',level:49,kind:'passive'}]);await f.run();assert.equal(f.location.href,'/battle.html?spawnId='+sid('041'));assert.equal(f.env.rt.target.champ,false)});
test('память Cancel только о чемпионе не запрещает ручную штатную цепочку',async()=>{const f=fixture();f.env.cfg.catDungeon=dungeon;f.env.rt.buffCancel.priest.champ=true;await f.run();assert.ok(f.events.includes('hunt'));assert.ok(!f.events.includes('catGo'));assert.ok(!f.events.some(x=>x.startsWith('GET ')))});
