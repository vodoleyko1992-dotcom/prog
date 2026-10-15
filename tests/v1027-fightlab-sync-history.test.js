'use strict';
// Live Olkuth 15.10: allowlisted response fields only; no account IDs, credentials or request bodies.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../hook.js','utf8');
const btOf=vm.runInNewContext(source.slice(source.indexOf('  const btOf = '),source.indexOf('  const pvOf ='))+';btOf');
const sequence=require('./fixtures/olkuth-battle-sequence.json');
const boss='Last Lesser Giant Olkuth',spawn=sequence[0].data.battle.spawnId;
function fixture(){
 let now=100000,rid=0;const rt={char:'Hero',classCur:{prof:'warlock',slot:0}},box={Date:{now:()=>now},URLSearchParams};
 const env={rt,cfg:{},routeLocation:{search:'?spawnId='+spawn},mobTitle:()=>boss,actName:x=>x,setRt:async p=>Object.assign(rt,p),rec(){}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/fightlab.js','utf8'),box);const L=box.L2V7Factories.fightlab(env);
 const send=(path,data,at=now+1000,id=++rid)=>{now=at;return L.onNet(path,{status:200,rid:id,req:{action:'test-action'},res:data,bt:btOf({pathname:path},data)})};
 return{rt,L,send};
}
test('native 13 actions interleaved with sync → 42-line victory: each hero/pet/special occurs once',()=>{
 const f=fixture();let final;
 for(const e of sequence){const t=f.send(e.path,e.data,100000+e.at);if(e.data.victory)final=t;}
 const sum=f.L.lastSum(),memory=f.L.recall(sum.key);
 assert.equal(sum.turns,13);assert.equal(sum.dealt,98016);assert.equal(sum.pet,3598130);
 assert.equal(final.own,6308,'victory assigns only the final hero hit to the final action');
 assert.equal(final.pet,826930);assert.equal(final.spike,0);
 assert.equal(memory.sp.n,1);assert.equal(memory.sp.mx,3666);assert.deepEqual(Array.from(memory.sp.g),[]);
 assert.equal(sum.hpLoss,3320110,'HP removed remains separate from overkill in raw hit numbers');
 const before=JSON.stringify(sum),last=sequence.find(e=>e.data.victory);
 f.send(last.path,last.data);f.send('/game/battle/sync',{serverNowMs:999});
 assert.equal(JSON.stringify(f.L.lastSum()),before,'late repeated victory/sync cannot change totals');
});
test('page attaches after first King hit: baseline excludes that hit; later sync never replays it',()=>{
 const f=fixture(),start=sequence[0].data.battle,first=sequence.find(e=>e.data.delta),prefix=[...start.log,...first.data.delta.logTail];
 f.send('/game/battle',{battle:{...start,mobHp:first.data.delta.mobHp,logSeq:3,log:prefix}});
 for(const e of sequence.filter(e=>e.at>first.at))f.send(e.path,e.data,100000+e.at);
 assert.equal(f.L.lastSum().pet,3598130-488244);assert.equal(f.L.lastSum().dealt,98016);
 assert.equal(f.L.recall(f.L.lastSum().key).sp.n,1);
});
test('heartbeat preserves a staged full snapshot before the next action',()=>{
 const f=fixture(),line='Слуга [Cat] атакує ['+boss+']: 100 урону.';
 f.send('/game/battle/start',{character:{revision:1},battle:{spawnId:spawn,mobName:boss,mobHp:1000,mobMaxHp:1000,log:[],logSeq:0}});
 f.send('/game/battle',{character:{revision:2},battle:{spawnId:spawn,mobName:boss,mobHp:900,log:[line],logSeq:1}});
 f.send('/game/battle/sync',{serverNowMs:1});
 const t=f.send('/game/battle/action',{character:{revision:3},battle:{spawnId:spawn,mobName:boss,mobHp:800,log:[line,line],logSeq:2}});
 assert.equal(t.pet,100,'the snapshot is the baseline, not an additional old pet hit');
 assert.equal(f.L.damageFor(boss,spawn).main,100);
});
test('identical real delta hits across sync still count separately, full log does not repeat them',()=>{
 const f=fixture(),line='Слуга [Cat] атакує ['+boss+']: 100 урону.';
 f.send('/game/battle/start',{battle:{spawnId:spawn,mobName:boss,mobHp:1000,log:[],logSeq:0}});
 for(let seq=1;seq<=3;seq++){f.send('/game/battle/sync',{serverNowMs:seq});f.send('/game/battle/action',{delta:{logTail:[line],logSeq:seq,mobHp:1000-seq*100}});}
 f.send('/game/battle/action',{victory:{spawnId:spawn,mobName:boss,fullLog:[line,line,line,'Перемога!']}});
 assert.equal(f.L.lastSum().pet,300);
});
test('full rolling log beyond40 lines interleaved with heartbeat never resets history',()=>{
 const f=fixture(),lines=[];f.send('/game/battle/start',{battle:{spawnId:spawn,mobName:boss,mobHp:10000,log:[],logSeq:0}});
 let total=0;for(let i=1;i<=55;i++){const damage=100+i;total+=damage;lines.push(`Слуга [Cat] атакує [${boss}]: ${damage} урону.`);
 f.send('/game/battle/sync',{serverNowMs:i});f.send('/game/battle/action',{battle:{spawnId:spawn,mobName:boss,mobHp:10000-total,log:lines,logSeq:i}});}
 f.send('/game/battle/action',{victory:{spawnId:spawn,mobName:boss,fullLog:[...lines,'Перемога!']}});
 assert.equal(f.L.lastSum().pet,total);
});
test('empty sync cannot initialize a fight or unlock actions after a subclass switch',()=>{
 const f=fixture();f.send('/game/battle/sync',{serverNowMs:1});assert.equal(f.L.fight(),null);
 f.send('/game/battle/start',{battle:{spawnId:spawn,mobName:boss,mobHp:1000,log:[]}});
 f.rt.classCur={prof:'tank',slot:1};f.send('/game/battle/sync',{serverNowMs:2});
 const t=f.send('/game/battle/action',{delta:{mobHp:900,logSeq:1,logTail:['Полум’я 100']}});
 assert.equal(t,null);assert.equal(f.L.fight(),null);
});
test('sync carrying a terminal result remains available as a pending snapshot',()=>{
 const f=fixture();f.send('/game/battle/start',{battle:{spawnId:spawn,mobName:boss,mobHp:1000,log:[]}});
 f.send('/game/battle/sync',{defeat:{spawnId:spawn,mobName:boss,fullLog:['Поразка.']}});
 assert.equal(f.L.fight().pendingSnapshot.end,true);assert.equal(f.L.fight().pendingSnapshot.lose,true);
});
test('legacy damage and spike history stay visible but cannot predict; fresh cohort survives reload',()=>{
 const f=fixture(),key='rb:'+spawn,old={n:9,w:9,l:0,a:{'test-action':{n:9,s:[999999,999999,999999,999999],rolls:[999999,999999,999999,999999],z:0}},sp:{mx:9999,n:10,g:[2,2,2]}};
 f.rt.fightMem={[key]:old};
 f.send('/game/battle/start',{character:{name:'Hero',revision:1},battle:{spawnId:spawn,mobName:boss,mobHp:10000,mobMaxHp:10000,log:[],logSeq:0}});
 assert.equal(f.L.dmgOn('test-action'),null);assert.equal(f.L.killP('test-action',1),null);assert.equal(f.L.spikeEta(),null);
 for(let i=1;i<=4;i++)f.send('/game/battle/action',{character:{name:'Hero',revision:i+1},delta:{mobHp:10000-i*100,logSeq:i,logTail:['[Hero] −100 HP.']}},100000+i*1000);
 assert.equal(f.L.dmgOn('test-action').mean,100);assert.equal(f.L.killP('test-action',200),0);
 f.L.finish('left');f.L.flush();const m=f.rt.fightMem[key];
 assert.equal(m.a['test-action'].legacyRolls[0],999999);assert.equal(m.a['test-action'].s[0],999999);assert.equal(m.sp.g[0],2);
 assert.equal(m.a['test-action'].evidence,1);assert.equal(m.a['test-action'].rolls.length,4);
 const reload=fixture();reload.rt.fightMem=JSON.parse(JSON.stringify(f.rt.fightMem));
 reload.send('/game/battle/start',{character:{name:'Hero',revision:20},battle:{spawnId:spawn,mobName:boss,mobHp:10000,mobMaxHp:10000,log:[],logSeq:0}});
 assert.equal(reload.L.dmgOn('test-action').mean,100);assert.equal(reload.L.spikeEta(),null);
});
test('fresh special gaps predict independently of preserved legacy rhythm',()=>{
 const f=fixture(),key='rb:'+spawn;f.rt.fightMem={[key]:{n:1,w:1,l:0,a:{},sp:{mx:999,n:4,g:[2,2,2]}}};
 f.send('/game/battle/start',{character:{revision:1},battle:{spawnId:spawn,mobName:boss,mobHp:10000,mobMaxHp:10000,log:[],logSeq:0}},100000);
 for(let i=1;i<=4;i++)f.send('/game/battle/action',{character:{revision:i+1},delta:{mobHp:10000,logSeq:i,logTail:[boss+' · Shock 100']}},100000+i*10000);
 assert.equal(f.L.spikeEta().gap,10);f.L.finish('left');f.L.flush();assert.equal(f.rt.fightMem[key].sp.prediction.g.length,3);
 assert.equal(f.rt.fightMem[key].sp.g[0],2,'legacy analytics retained');
});
