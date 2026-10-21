'use strict';
// Лог20.10 10:43UTC: native power-строки не обучали основной урон и модель соседей.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const actual=JSON.parse(read('tests/fixtures/native-damage-20261020.json')).cases;
const hook=read('hook.js'),btOf=vm.runInNewContext(hook.slice(hook.indexOf('  const btOf = '),hook.indexOf('  const pvOf ='))+';btOf');
function fixture(){
 let now=100000,rid=0;
 const rt={char:'Hero',classCur:{prof:'dwarf_bounty_hunter',slot:1},catIn:'martyrdom',skills:{}},location={search:'?spawnId=main'};
 const env={rt,cfg:{catMode:true},routeLocation:location,actName:a=>({whirlwind:'Whirlwind',wild_sweep:'Wild Sweep'})[a]||a,setRt:async p=>Object.assign(rt,p),rec:()=>{},mobTitle:()=> 'Main'};
 const box={console,Date:{now:()=>now},Math,URLSearchParams};vm.runInNewContext(read('modules/fightlab.js'),box);const lab=box.L2V7Factories.fightlab(env);
 const send=(p,d,req={},status=200)=>{now+=100;return lab.onNet(p,{rid:++rid,status,req,res:d,bt:btOf({pathname:p},d)})};
 const start=(extras=[])=>send('/game/battle/start',{character:{id:'fixture',name:'Hero',revision:1,hp:10000,mp:1000},battle:{spawnId:'main',mobName:'Main',mobHp:3636,mobMaxHp:3636,log:[],logSeq:0,whirlwindExtras:extras}});
 const hit=(row,more={})=>send('/game/battle/action',{character:{id:'fixture',name:'Hero',revision:2,hp:10000,mp:900,...more},victory:{spawnId:'main',mobName:'Main',fullLog:row.lines}},{action:row.action,battleSpawnId:'main'});
 return{lab,env,rt,start,hit,now:()=>now};
}
for(const row of actual)test('native victory '+row.at+' '+row.action+' — точный основной урон и подтверждённые соседи',()=>{
 const f=fixture(),p=f.lab.parseLog(row.lines,row.name,'Hero');
 assert.equal(row.omitted,0);assert.equal(row.shortened,0);assert.equal(p.own,row.ownDamage);assert.equal(p.ownN,1);
 assert.equal(p.extraKills.length,row.extraKills);assert.equal(p.splash.length,row.extraKills);
 assert.equal(p.rewards.exp,1+row.extraKills);assert.equal(p.rewards.sp,1+row.extraKills);
 assert.notEqual(p.own,326);assert.notEqual(p.own,2033);
});
for(const [line,damage]of [
 ['Wild Sweep: power 326 — 12 909 урона',12909],
 ['Дикий розмах: power 326 — 12\u00a0909 урону.',12909],
 ['\u2060245\u200bДикий розмах: power 326 — 0 урона',0],
 ['[20:41:48.308] \u206036\u200bВихор: power 2033; до 4 цілей (головна + 3 поруч) — 20\u202f394 урона',20394],
 ['Whirlwind: power 2033; до 4 цілей (головна + 3 поруч) — 20394 урона',20394],
])test('native формат: '+line,()=>{const p=fixture().lab.parseLog([line],'Main','Hero');assert.equal(p.own,damage);assert.equal(p.ownN,1);assert.equal(p.splash.length,0)});
for(const line of [
 'Дикий розмах: power 326',
 'Дикий розмах: power 326 —',
 'Дикий розмах: power 326 — 12',
 'Дикий розмах: power 326 — 12909 уро',
 'Дикий розмах: power 326 — 12x909 урона',
 'Дикий розмах: power 326 — -12909 урона',
 'Дикий розмах: power 326 — 9007199254740992 урона',
 '\u206036\u200bДикий розмах: power 326 — 12909 урона',
 '\u2060245\u200bВихор: power 2033; до 4 цілей (головна + 3 поруч) — 20394 урона',
 '[Stranger] Дикий розмах: power 326 — 12909 урона',
 'Main · Дикий розмах: power 326 — 12909 урона',
 'Main: Вихор: power 2033; до 4 цілей (головна + 3 поруч) — 20394 урона',
 'Spoil Festival: power 326 — 12909 урона',
 'Дикий розмах на 120 с.',
 'Buff: power 326 — 12909 урона',
])test('не считаем чужую/неполную строку: '+line,()=>{const p=fixture().lab.parseLog([line],'Main','Hero');assert.equal(p.own,0);assert.equal(p.ownN,0)});
test('настоящий onNet: Whirlwind учит3соседей, Wild Sweep не выдумывает их',()=>{
 for(const action of ['whirlwind','wild_sweep']){
  const f=fixture(),row=actual.find(x=>x.action===action);
  f.start([{name:'Grave Wanderer',mobHp:2340,mobMaxHp:2340},{name:'Grave Wanderer',mobHp:2340,mobMaxHp:2340},{name:'Grave Overlord',mobHp:2340,mobMaxHp:2340}]);
  const turn=f.hit(row);assert.equal(turn.own,row.ownDamage);assert.equal(turn.ownKnown,true);
  const group=f.lab.groupOn(action==='whirlwind'?'Whirlwind':'Wild Sweep',3636);
  if(action==='whirlwind'){assert.equal(group.targets,3);assert.equal(group.kills,3);assert.equal(group.damage,row.ownDamage)}else assert.equal(group,null);
 }
});
test('onNet отвергает native damage чужого героя до обучения группы',()=>{
 const f=fixture(),row=actual.find(x=>x.action==='whirlwind');f.start();
 assert.equal(f.hit(row,{name:'Other',id:'other'}),null);assert.equal(f.lab.groupOn('Whirlwind',3636),null);
});
test('onNet→groupOn→chooseAction выбирает подтверждённый Whirlwind вместо большего одиночного overkill',()=>{
 const f=fixture(),row=actual.find(x=>x.action==='whirlwind');f.start();f.hit(row);
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),c=flowFixture('fighter'),e=c.env;
 const whirlwind={title:'Whirlwind',getAttribute:()=>null},sweep={title:'Wild Sweep',getAttribute:()=>null};
 c.slots.push(whirlwind,sweep);c.hp.textContent='3636 / 3636';
 Object.assign(e.cfg,{nPower:'Whirlwind, Wild Sweep',nUltra:'',nCharge:'',mageProbe:false,fightMode:'dps'});
 e.names=s=>String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 e.isChargeName=()=>false;e.isForceName=()=>false;
 e.rt.skills={'whirlwind':{dmg:4000*3,dmgN:3},'wild sweep':{dmg:13000*3,dmgN:3}};
 e.expDmg=n=>({whirlwind:4000,'wild sweep':13000,'атака':100})[n.toLowerCase()]||0;
 e.skillMp=()=>37;e.ilOf=b=>({c:'Физ. атака',t:'PDAM',mp:37,target:b===whirlwind?'AURA':'ONE'});
 e.fightGroupOn=(...a)=>f.lab.groupOn(...a);e.fightKillP=n=>n.toLowerCase()==='атака'?0:1;
 const panel={textContent:'Grave Wanderer 2340/2340 Grave Wanderer 2340/2340 Grave Overlord 2340/2340',querySelectorAll:()=>[]};
 const q=e.$q;e.$q=s=>s==='#battle-whirlwind-extras'?panel:q(s);
 const ctx={block:{},seq:[],nearSpoiled:3},a=c.combat.chooseAction(ctx,{cur:1000,max:1883});
 assert.equal(a.b,whirlwind);assert.equal(a.group,true);assert.equal(a.sideKills,3);
 const own=f.lab.parseLog(row.lines,row.name,'Hero');assert.equal(own.own,row.ownDamage,'splash не прибавляется к основному удару');
 assert.equal(own.splash.reduce((s,x)=>s+x.damage,0),row.ownDamage*3);
});
