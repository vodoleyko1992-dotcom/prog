'use strict';
const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=require('path').join(__dirname,'..');
function load(file,exports,customFs=fs){const box={console,URLSearchParams,setTimeout,__dirname:root+'/tests',module:{exports:{}},require:n=>n==='node:test'?()=>{}:n==='fs'?customFs:require(n)};vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports='+exports,box);return box.module.exports}
const customFs=fs;
const {flowFixture}=load(root+'/tests/v1014-combat-outcomes.test.js','{flowFixture}',customFs);
const {fixture}=load(root+'/tests/v1015-magister.test.js','{fixture}');
function integrated(o={}){
 const f=flowFixture('mage'),m=fixture({max:1,path:'/battle.html',cfg:{catMode:!!o.cat,catDungeon:'witch'},rt:{lvl:74,magChecked:{'0:human_warlock':{lvl:74}}}});
 Object.assign(f.env.rt,m.ctx.rt,{kills:0,magister:null,catIn:o.cat?'witch':null});Object.assign(f.env.cfg,m.ctx.cfg,{deepEvery:0});
 m.ctx.rt=f.env.rt;m.ctx.cfg=f.env.cfg;m.ctx.location=f.location;f.location.search=o.cat?'?spawnId=sdms_witch_001':'?spawnId=first-mob';
 for(const key of ['on','tabOwner'])Object.defineProperty(m.ctx,key,{get:()=>f.env[key],set:v=>f.env[key]=v});
 f.env.heroLvl=m.ctx.heroLevel;m.ctx.victory=f.combat.victory;m.ctx.toMap=async()=>{f.events.push('map');f.location.pathname='/map.html'};
 m.ctx.catGo=async id=>{f.events.push('cat:'+id);f.location.href='/dungeon.html?dungeonId='+id};f.env.autonomyMode=m.ctx.autonomyMode;
 const fire=f.env.fire;f.env.fire=b=>{const ok=fire(b);if(b===f.blaze&&o.levelup!==false)f.env.rt.lvl=o.jump||75;return ok};
 f.env.magisterAfterWin=()=>m.start(true);f.env.magisterHold=m.ctx.magisterHold;return {...f,m};
}
for(const cat of [false,true])test('actual combat victory → actual scheduler/guild → '+(cat?'same dungeon':'map'),async()=>{
 const f=integrated({cat});await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.env.rt.loot.Coal,2);assert.equal(f.events.filter(x=>x==='hunt').length,0);assert.equal(f.env.rt.magister.lvl,75);
 await f.m.step();assert.equal(f.location.href,'/magister.html?npcId=30344');assert.equal(f.m.posts().length,0);
 f.location.pathname='/magister.html';f.location.search='?npcId=30344';await f.m.step();assert.equal(f.m.posts().length,1);assert.equal(f.m.rank(),1);assert.equal(f.m.sp(),900);assert.equal(f.env.rt.magChecked['0:human_warlock'].lvl,75);assert.equal(f.env.rt.magister,null);assert.equal(f.location.href,cat?'/dungeon.html?dungeonId=witch':'/map.html');assert.equal(f.env.cfg.catDungeon,'witch');
});
for(const cat of [false,true])test('actual helper without due preserves '+(cat?'cat':'ordinary')+' chain',async()=>{const f=integrated({cat,levelup:false});await f.combat.battle();assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.equal(f.env.rt.magister,null);assert.equal(f.m.posts().length,0);assert.ok(!f.events.includes('map'))});
test('multi-level jump checks current level once, death/recovery does not retrain',async()=>{const f=integrated({jump:78});await f.combat.battle();f.location.pathname='/magister.html';f.location.search='?npcId=30344';await f.m.step();assert.equal(f.env.rt.magChecked['0:human_warlock'].lvl,78);f.location.pathname='/map.html';f.env.rt.lvl=77;assert.equal(await f.m.start(),false);f.env.rt.lvl=78;assert.equal(await f.m.start(),false);f.env.rt.lvl=79;assert.equal(await f.m.start(),true)});
test('manual clear inside start reservation returns cleanly without navigation',async()=>{const f=fixture({write:(p,c)=>{if(p.magister){c.rt.magister=null;c.rt.manualKickAt=1}}});f.ctx.rt.magister=null;assert.equal(await f.start(),false);assert.equal(f.calls.length,0)});
test('lease loss before POST can restart without impossible pending receipt',async()=>{let once=true;const f=fixture({max:1,write:(p,c)=>{if(p.magPending&&Object.keys(p.magPending).length&&once){once=false;c.tabOwner=false}}});await f.step();assert.equal(f.posts().length,0);f.ctx.tabOwner=true;f.reload();await f.step();assert.equal(f.posts().length,0);f.tick(61000);await f.start();await f.step();assert.equal(f.posts().length,1);assert.equal(f.rank(),1)});
test('afterWin failed durable commit preserves victory and suppresses hunt',async()=>{const f=integrated();f.m.ctx.rtCommit=async()=>false;await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.ok(f.env.rt.magister);assert.equal(f.m.posts().length,0);assert.ok(!f.events.includes('map'));assert.ok(!f.events.includes('hunt'));assert.equal(f.combat.victory(),true)});

for(const [kind,levelup] of [['TvT',false],['captcha',false],['TvT',true]])test('actual magister fallback /character await: '+kind+' levelup='+levelup+' must preempt hunt/navigation',async()=>{
 const f=integrated({levelup});f.env.cfg.tvtOn=true;
 // DOM hero level временно отсутствует: actual helper идёт в свою штатную ветку GET /character.
 f.m.ctx.heroLevel=()=>0;
 const get=f.m.ctx.gameGet;let raised=false,reads=0;
 f.m.ctx.gameGet=async path=>{const res=await get(path);if(path==='/character'){reads++;raised=true;if(kind==='TvT'){f.m.ctx.L2V7Modules.tvt.tvtHold=()=>true;f.env.tvtSoon=()=>true}else{f.m.ctx.abHold=()=>true;f.m.ctx.antibotState=()=> 'check'}}return res};
 if(kind==='captcha'){
  // Реальный central fire запрещает клик при abHold. Сам факт вызова fire здесь не считается нарушением.
  const fire=f.env.fire;f.env.fire=b=>raised?false:fire(b);
  vm.runInContext(fs.readFileSync(root+'/modules/navigation.js','utf8'),f.box);
  f.env.byText=()=>null;f.env.BACK=/назад/i;f.env.toMap=f.box.L2V7Factories.navigation(f.env).toMap;
 }
 await f.combat.battle();assert.equal(reads,1);assert.equal(f.env.rt.kills,1);
 if(kind==='TvT'){assert.equal(f.events.filter(x=>x==='hunt').length,0);assert.equal(f.combat.victory(),true);assert.ok(!f.events.includes('map'),'TvT during character read must preempt a new guild detour')}
 else {assert.equal(f.events.filter(x=>x==='hunt').length,0);assert.equal(f.location.href,undefined,'actual navigation.toMap must not replace captcha with map URL')}
});
