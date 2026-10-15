'use strict';
// 15.10 11:11: DOM переводит [герой] −N HP в «Ты нанёс», сырой ответ остаётся другим.
// Числа/цели двух случаев из журнала; сырые ответы синтетические по сохранённому native renderer.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const root = require('node:path').resolve(__dirname, '..');
const read = f => fs.readFileSync(root + '/' + f, 'utf8');
const hook = read('hook.js'), content = read('content.js');
const btOf = vm.runInNewContext(hook.slice(hook.indexOf('  const btOf = '), hook.indexOf('  const pvOf =')) + ';btOf');
function fixture() {
 let now = 100000, rid = 0;
 const location = {search: '?spawnId=main'}, rt = {char: 'Fixture', zone: 'cruma'}, logs = [];
 const env = {rt, cfg: {}, routeLocation: location, actName: a => a === 'attack' ? 'атака' : a,
   setRt: async p => Object.assign(rt,p), rec: (...a) => logs.push(a), mobTitle: () => 'Main'};
 const box = {Date: {now: () => now}, URLSearchParams, console};
 vm.runInNewContext(read('modules/fightlab.js'),box); const lab = box.L2V7Factories.fightlab(env);
 const send = (path,data,req={},status=200,id=++rid) => {
   now += 1000; return lab.onNet(path,{status,req,rid:id,res:data,bt:btOf({pathname:path},data)});
 };
 const start = (name='Main',hp=1572,extras=[],spawn='main',rev=1) => {
   location.search='?spawnId='+spawn;
   return send('/game/battle/start',{character:{id:'fixture',name:'Hero',revision:rev,hp:5000,mp:500},
    battle:{spawnId:spawn,mobName:name,mobHp:hp,mobMaxHp:hp,log:[],whirlwindExtras:extras,logSeq:0}});
 };
 const hit = (lines, {name='Main',spawn='main',hp=0,rev=2,win=true,extras,actor='Hero',id='fixture',status=200,action='attack',reqId}={}) => send('/game/battle/action',{
   character:{id,name:actor,revision:rev,hp:5000,mp:500}, ...(win ? {victory:{spawnId:spawn,mobName:name,fullLog:lines}} : {delta:{mobHp:hp,logTail:lines,logSeq:rev,whirlwindExtras:extras}})
 },{action,battleSpawnId:spawn},status,reqId);
 return {lab,rt,start,hit,send,now:()=>now,logs};
}
const cases = [
 {name:'Marsh Stakato',hp:1572,side:[['Neer Crawler',1524,11649],['Marsh Stakato Drone',1860,2028]]},
 {name:'Marsh Stakato Soldier',hp:1764,side:[['Marsh Stakato Worker',1668,12024],['Marsh Stakato Drone',1860,2050]]}
];
const linesFor = c => [`[Hero] — крит! −${c.hp} HP.`, `Древко розсікло ворогів поруч: ${c.side.map(x=>x[0]+' −'+x[2]).join(', ')}.`,
 ...c.side.map(x=>'Додаткова ціль повалена: '+x[0]+'.'),'Перемога!'];
for (const c of cases) test(c.name+': accepted one-shot uses hero identity, caps extras, never counts overkill',()=>{
 const f=fixture(); f.start(c.name,c.hp,c.side.map(x=>({name:x[0],mobHp:x[1],mobMaxHp:x[1]})));
 const turn=f.hit(linesFor(c),{name:c.name}); assert.equal(turn.own,c.hp); assert.equal(turn.ownKnown,true); assert.equal(turn.crit,1);
 assert.equal(f.lab.groupOn('атака',c.hp).kills,2);
 const d=f.lab.damageFor(c.name,'main'); assert.equal(d.main,c.hp); assert.equal(d.side,c.side.reduce((s,x)=>s+x[1],0)); assert.equal(d.unknownSides,0);
 assert.equal(f.lab.lastSum().dealt,c.hp,'main hero damage excludes splash and pet');
 assert.equal(f.lab.turnFor('атака',f.now()-100,'attack',2),turn);
 assert.equal(f.lab.turnFor('атака',f.now()-100,'wild_sweep',2),null);
 assert.equal(f.lab.turnFor('атака',f.now()-100,'attack',99),null);
});
test('unknown extra HP stays unknown, even with huge overkill and two confirmed kills',()=>{
 const f=fixture(), c=cases[0]; f.start(c.name,c.hp);f.hit(linesFor(c),{name:c.name});
 const d=f.lab.damageFor(c.name,'main');assert.equal(d.removed,c.hp);assert.equal(d.unknownSides,2);assert.equal(f.lab.groupOn('атака',c.hp).kills,2);
});
test('raw hero/mob/other actors, timestamp, miss and pet stay separate',()=>{
 const f=fixture();const p=f.lab.parseLog(['[21:08:45] [Hero] −1572 HP.','[Main] −9 HP.','[Stranger] −10000 HP.',
 'Слуга [Cat] атакує [Main]: 300 урону.','[Hero] промахнувся.'],'Main','Hero');
 assert.equal(p.own,1572);assert.equal(p.pet,300);assert.equal(p.miss,1);assert.equal(p.hits.length,1);assert.equal(p.hits[0].dmg,9);
 assert.equal(f.lab.parseLog(['[Hero] −1572 HP.'],'Main').own,0,'unknown actor cannot be called hero');
});
test('empty delta log does not hide victory fullLog; main zero HP is confirmed by victory',()=>{
 const b=btOf({pathname:'/game/battle/action'},{character:{name:'Hero'},delta:{logTail:[]},victory:{spawnId:'main',fullLog:['[Hero] −1572 HP.']}});
 assert.equal(b.mob,0);assert.equal(b.log.length,1);assert.equal(b.full,true);assert.equal(b.spawn,'main');
});
test('accepted unknown outcome is not a miss; explicit miss is known zero',()=>{
 const f=fixture();f.start();const a=f.hit(['Невідомий ефект'],{hp:1572,win:false});assert.equal(a.ownKnown,false);
 const b=f.hit(['[Hero] промахнувся.'],{hp:1572,win:false,rev:3});assert.equal(b.ownKnown,true);assert.equal(b.own,0);
});
test('pet damage is not assigned to hero when own line is missing',()=>{
 const f=fixture();f.start('Main',1000);const t=f.hit(['Слуга [Cat] атакує [Main]: 300 урону.'],{hp:700,win:false});
 assert.equal(t.own,0);assert.equal(t.ownKnown,false);assert.equal(t.pet,300);assert.equal(f.lab.damageFor('Main','main').main,300);
});
test('rejected action, duplicate transport response and repeated final GET cannot add damage twice',()=>{
 const f=fixture(),c=cases[0];f.start(c.name,c.hp,c.side.map(x=>({name:x[0],mobHp:x[1],mobMaxHp:x[1]})));
 assert.equal(f.hit(linesFor(c),{name:c.name,status:409}),null);assert.equal(f.lab.damageFor(c.name,'main').removed,0);
 f.hit(linesFor(c),{name:c.name,reqId:90});const d=JSON.stringify(f.lab.damageFor(c.name,'main'));
 f.hit(linesFor(c),{name:c.name,reqId:90});f.hit(linesFor(c),{name:c.name,reqId:91});
 f.send('/game/battle',{character:{revision:2},victory:{spawnId:'main',mobName:c.name,fullLog:linesFor(c)}});
 assert.equal(JSON.stringify(f.lab.damageFor(c.name,'main')),d);
});
test('same lines in different chain battles count again; old response/actor cannot replace new battle',()=>{
 const f=fixture(),c=cases[0];f.start(c.name,c.hp);f.hit(linesFor(c),{name:c.name});
 f.start(c.name,c.hp,[],'next',3);f.hit(linesFor(c),{name:c.name,spawn:'main',rev:2});
 assert.equal(f.lab.damageFor(c.name,'next').removed,0);
 f.hit(linesFor(c),{name:c.name,spawn:'next',rev:4,id:'other'});assert.equal(f.lab.damageFor(c.name,'next').removed,0);
 const t=f.hit(linesFor(c),{name:c.name,spawn:'next',rev:4});assert.equal(t.own,c.hp);assert.equal(f.lab.damageFor(c.name,'next').removed,c.hp);
});
test('repeated delta text with increasing sequence counts real second hit; extras retain remaining HP',()=>{
 const f=fixture();f.start('Main',1000,[{name:'Side',mobHp:500,mobMaxHp:500}]);
 const lines=['[Hero] −100 HP.','Древко розсікло ворогів поруч: Side −300.'];
 f.hit(lines,{hp:900,win:false});f.hit(lines,{hp:800,win:false,rev:3});
 const d=f.lab.damageFor('Main','main');assert.equal(d.main,200);assert.equal(d.side,500);
});
test('reload has no historic targets; final response cannot invent damage from zero start HP',()=>{
 const f=fixture(),c=cases[0];f.hit(linesFor(c),{name:c.name});const d=f.lab.damageFor(c.name,'main');assert.equal(d.removed,0);assert.equal(d.unknownSides,2);
});
test('identical names with ambiguous HP do not pick an arbitrary cap',()=>{
 const f=fixture();f.start('Main',1000,[{name:'Side',mobHp:100,mobMaxHp:100},{name:'Side',mobHp:300,mobMaxHp:300}]);
 f.hit(['[Hero] −100 HP.','Древко розсікло ворогів поруч: Side −500.'],{hp:900,win:false});
 assert.equal(f.lab.damageFor('Main','main').side,0);assert.equal(f.lab.damageFor('Main','main').unknownSides,1);
});
async function observe({turn,domDamage=0,accepted=true,sent=true,hpAfter=1572}={}) {
 let callback,now=10000;
 const rt={},notes=[],logs=[],net={start:2,done:2,action:'attack',ok:true,rid:1};
 const b={title:'Атака',querySelector:()=>null};
 const box={Date:{now:()=>now},ACT_NET:net,slotAction:()=> 'attack',isBattle:()=>true,slotKind:()=> 'атака',cleanTitle:x=>x,
  mobHp:()=>({cur:now>10000?hpAfter:1572,max:1572}),meHp:()=>({cur:5000}),meMp:()=>({cur:500}),logLines:()=>[],noticeText:()=>'',slotCd:()=>null,
  setTimeout:f=>{callback=f},sleep:async()=>{},newLines:()=>[],BUFF_RE:/x^/,ilOf:()=>null,isChargeName:()=>false,dmgFromLog:()=>domDamage,
  L2V7Modules:{fightlab:{turnFor:(name,t,action,rid)=>turn&&turn.rid===rid&&turn.action===action?turn:null}},rt,
  fightNote:(...a)=>notes.push(a),splashDmg:()=>0,BUFF_CTX:null,UNAVAIL:/x^/,setRt:async p=>Object.assign(rt,p),rec:(...a)=>logs.push(a)};
 vm.runInNewContext(content.slice(content.indexOf('function observeOwner()'),content.indexOf('// роли по панели'))+';this.observeSlot=observeSlot',box);
 box.observeSlot(b,'B');if(sent){net.start=net.done=3;net.rid=2;net.ok=accepted;}now+=900;await callback();return{rt,notes,logs};
}
test('real observeSlot keeps accepted raw physical damage, unknown is not recorded as zero, genuine miss is zero',async()=>{
 const good=await observe({turn:{rid:2,action:'attack',own:1572,ownKnown:true}});
 assert.equal(good.rt.skills['атака'].dmg,1572);assert.equal(good.notes[0][1],1572);
 const unknown=await observe({turn:{rid:2,action:'attack',own:0,ownKnown:false}});
 assert.equal(unknown.rt.skills['атака'].unknown,1);assert.equal(unknown.rt.skills['атака'].dmgN,0);assert.equal(unknown.notes.length,0);
 assert.match(unknown.logs[0][2],/урон не измерен/);
 const foreign=await observe({turn:{rid:2,action:'attack',own:0,ownKnown:false},hpAfter:500});assert.equal(foreign.notes.length,0,'unknown server sample cannot be replaced by foreign DOM HP drop');
 const miss=await observe({turn:{rid:2,action:'attack',own:0,ownKnown:true}});assert.equal(miss.notes[0][1],0);
 const dom=await observe({turn:{rid:2,action:'attack',own:0,ownKnown:false},domDamage:1572});assert.equal(dom.rt.skills['атака'].dmg,1572,'unknown server detail cannot erase confirmed DOM damage');
 for(const opts of [{accepted:false},{sent:false}]){const r=await observe(opts);assert.equal(r.notes.length,0);assert.equal(r.rt.skills,undefined);}
});
test('RB HP lost to another player does not prove hero zero-damage hit',()=>{
 const f=fixture();f.start('Boss',1000,[],'l2dop_rb_1');const t=f.hit([],{name:'Boss',spawn:'l2dop_rb_1',hp:500,win:false});
 assert.equal(t.own,0);assert.equal(t.ownKnown,false);
});
test('real combat victory includes capped instant extras, preserves loot accounting, marks incomplete totals',async()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs');
 for(const known of [true,false]){
  const f=flowFixture('fighter'),m=fixture();f.env.rt.dps={n:100,dps:999999};m.start('Safe Mob',1000,known?[{name:'Side',mobHp:500,mobMaxHp:500}]:[],'first-mob');
  const fire=f.env.fire;f.env.fire=b=>{if(b.title==='Атака')m.hit(['[Hero] −1000 HP.','Древко розсікло ворогів поруч: Side −12024.'],{name:'Safe Mob',spawn:'first-mob'});return fire(b)};
  f.env.fightDamage=(name,spawn)=>m.lab.damageFor(name,spawn);
  await f.combat.battle();const summary=f.logs.find(x=>x.includes('итог боя'));
  assert.equal(f.env.rt.dps.singleTarget,true);assert.equal(f.env.rt.dps.n,1,'legacy mixed DPS is not carried into single-target estimate');
  if(known){assert.match(summary,/урон по всем мобам 1500/);assert.ok(f.env.rt.dps.all>f.env.rt.dps.dps,'AoE total cannot inflate single-target/champion estimate');}else{assert.doesNotMatch(summary,/урон по всем мобам/);assert.match(summary,/HP части соседей неизвестны/);}
  assert.equal(f.env.rt.kills,1,'new damage channel does not add kills');assert.equal(f.env.rt.loot.Coal,2,'loot remains in existing outcome flow');
 }
});
test('GET arrives before the accepted action: snapshot cannot consume the action log or its HP baseline',()=>{
 const f=fixture();f.start('Main',1000);
 f.send('/game/battle',{character:{id:'fixture',name:'Hero',revision:2,hp:5000,mp:500},battle:{spawnId:'main',mobName:'Main',mobHp:900,mobMaxHp:1000,log:['[Hero] −100 HP.'],logSeq:2}});
 const t=f.hit(['[Hero] −100 HP.'],{hp:900,win:false,rev:2});assert.equal(t.own,100);assert.equal(f.lab.damageFor('Main','main').main,100);
});
test('delayed start and hunt from the previous revision cannot replace active fight',()=>{
 const f=fixture();f.start('New',1000,[],'new',10);f.hit(['[Hero] −100 HP.'],{name:'New',spawn:'new',hp:900,win:false,rev:11});
 for(const path of ['/game/battle/start','/game/battle/hunt-continue'])f.send(path,{character:{name:'Hero',id:'fixture',revision:5},battle:{spawnId:'old',mobName:'Old',mobHp:500,mobMaxHp:500,log:[]}});
 assert.equal(f.lab.fight().spawn,'new');assert.equal(f.lab.damageFor('New','new').main,100);
});
test('older GET is baseline of later action: another player damage is not learned as ours',()=>{
 const f=fixture();f.start('Main',1000);
 f.send('/game/battle',{character:{id:'fixture',name:'Hero',revision:2,hp:5000,mp:500},battle:{spawnId:'main',mobName:'Main',mobHp:500,mobMaxHp:1000,log:['[Stranger] −500 HP.'],logSeq:2}});
 const t=f.hit([],{hp:500,win:false,rev:3,action:'l2_1220'});assert.equal(t.own,0);assert.equal(t.ownKnown,false);assert.equal(f.lab.damageFor('Main','main').main,0);
});
test('older GET contains prior hero hit: fullLog of later skill learns only the new hit',()=>{
 const f=fixture();f.start('Main',1000);
 const log=['[Hero] −500 HP.'];f.send('/game/battle',{character:{id:'fixture',name:'Hero',revision:2,hp:5000,mp:500},battle:{spawnId:'main',mobName:'Main',mobHp:500,mobMaxHp:1000,log,logSeq:2}});
 const t=f.send('/game/battle/action',{character:{id:'fixture',name:'Hero',revision:3,hp:5000,mp:500},battle:{spawnId:'main',mobName:'Main',mobHp:400,mobMaxHp:1000,log:[...log,'[Hero] −100 HP.'],logSeq:3}},{action:'l2_1220'});
 assert.equal(t.own,100);assert.equal(f.lab.damageFor('Main','main').main,100);
});
test('explicit new character start has its own revision sequence; old character action is rejected',()=>{
 const f=fixture();f.start('Main',1000,[],'main',50);
 f.send('/game/battle/start',{character:{id:'new-character',name:'Alt',revision:1,hp:1000,mp:100},battle:{spawnId:'alt-mob',mobName:'Rat',mobHp:100,mobMaxHp:100,log:[]}});
 assert.equal(f.lab.fight().actorId,'new-character');assert.equal(f.lab.fight().rev,1);
 const old=f.hit(['[Hero] −100 HP.'],{name:'Main',spawn:'main',rev:51});assert.equal(old,null);assert.equal(f.lab.fight().actorId,'new-character');
});
test('legacy AoE group averages are retained as history, never merged into new prediction',()=>{
 const f=fixture(),key='map:cruma|атака';f.rt.fightGroups={[key]:{t:f.now(),samples:[{t:f.now(),hp:1572,kills:20,targets:20,damage:999999}]}};
 f.start();assert.equal(f.lab.groupOn('атака',1572),null);
 f.hit(['[Hero] −1572 HP.','Древко розсікло ворогів поруч: Side −1000.','Додаткова ціль повалена: Side.']);
 assert.equal(f.lab.groupOn('атака',1572).damage,1000);assert.equal(f.lab.groupOn('атака',1572).kills,1);
 assert.equal(f.rt.fightGroups[key].legacySamples[0].damage,999999);
});
