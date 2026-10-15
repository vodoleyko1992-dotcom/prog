'use strict';
// Реконструкция по видимым ударам23:10: N-ответы обрезаны800, это не native payload replay.
const test=require('node:test');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');const root=__dirname+'/../',source=fs.readFileSync(root+'hook.js','utf8');const btOf=vm.runInNewContext(source.slice(source.indexOf('  const btOf = '),source.indexOf('  const pvOf ='))+';btOf');const boss='Spirit of Andras the Betrayer',spawn='l2dop_rb_25233';
const attacks=[10982,13897,20962,25140,22185,13933,11214],pets=[1027422,0,0,966356,0,0,80006];
function replay(prefix){let now=100000,rid=0;const rt={char:'Hero',classCur:{prof:'warlock',slot:0}},box={Date:{now:()=>now},URLSearchParams};vm.runInNewContext(fs.readFileSync(root+'modules/fightlab.js','utf8'),box);const L=box.L2V7Factories.fightlab({rt,cfg:{},mobTitle:()=>boss,routeLocation:{search:'?spawnId='+spawn},actName:x=>x,setRt:async p=>Object.assign(rt,p),rec(){}});const send=(path,data,action='test')=>{now+=1000;return L.onNet(path,{status:200,rid:++rid,req:{action},res:data,bt:btOf({pathname:path},data)})};send('/game/battle/sync',{revision:1,logSeq:1,logTail:[],changed:false});let hp=2123774;const lines=['Благословений заряд духу активний.'];send('/game/battle/action',{revision:2,delta:{mobHp:hp,mobMaxHp:hp,logSeq:2,logTail:lines}},'mystic_spiritshot_toggle');for(let i=0;i<7;i++){const tail=[];if(pets[i])tail.push(`Слуга [Feline King] атакує [${boss}] ${pets[i]} урону.`);tail.push('Полум’я '+attacks[i]);if(i===3)tail.push(boss+' · Ураган 1750');lines.push(...tail);hp=Math.max(0,hp-attacks[i]-pets[i]);if(i===6)send('/game/battle/action',{revision:i+3,victory:{spawnId:spawn,mobName:boss,fullLog:[...prefix,...lines,'Победа!']}});else send('/game/battle/action',{revision:i+3,delta:{mobHp:hp,logSeq:lines.length+1,logTail:tail}});}const s=L.lastSum();return{own:s.dealt,pet:s.pet,hp:s.hpLoss,specials:L.recall(s.key).sp.n};}

test('Andras: missed opening/toggle prefix in final full log does not double earlier actions',()=>{
 for(const prefix of [[],['Бій розпочато.']])assert.deepEqual(replay(prefix),{own:118313,pet:2073784,hp:2123774,specials:1});
});
function fixture(){
 let rid=0,now=100000;const rt={char:'Hero',classCur:{prof:'warlock',slot:0}},box={Date:{now:()=>now},URLSearchParams};
 vm.runInNewContext(fs.readFileSync(root+'modules/fightlab.js','utf8'),box);
 const L=box.L2V7Factories.fightlab({rt,cfg:{},routeLocation:{search:'?spawnId='+spawn},actName:x=>x,setRt:async p=>Object.assign(rt,p),rec(){}});
 return {L,send(path,data){now+=1000;return L.onNet(path,{status:200,rid:++rid,req:{action:'attack'},res:data,bt:btOf({pathname:path},data)})}};
}
test('equal real delta hits and equal new full hit survive prefix recovery; fresh battle resets history',()=>{
 const f=fixture(),hit=`Слуга [Cat] атакує [${boss}] 100 урону.`;
 for(let battle=0;battle<2;battle++){
  f.send('/game/battle/start',{revision:battle*10,battle:{spawnId:spawn,mobName:boss,mobHp:1000,logSeq:0,log:[]}});
  for(let seq=1;seq<=2;seq++)f.send('/game/battle/action',{revision:battle*10+seq,delta:{mobHp:1000-seq*100,logSeq:seq,logTail:[hit]}});
  const last=f.send('/game/battle/action',{revision:battle*10+3,victory:{spawnId:spawn,mobName:boss,fullLog:['Бій розпочато.',hit,hit,hit,'Перемога!']}});
  assert.equal(last.pet,100);assert.equal(f.L.lastSum().pet,300);
 }
});
test('stale revision and different actor full snapshots cannot rewrite history',()=>{
 const f=fixture(),hit=`Слуга [Cat] атакує [${boss}] 100 урону.`;
 f.send('/game/battle/start',{revision:10,character:{id:'hero-fixture'},battle:{spawnId:spawn,mobName:boss,mobHp:1000,logSeq:0,log:[]}});
 f.send('/game/battle/action',{revision:11,character:{id:'hero-fixture'},delta:{mobHp:900,logSeq:1,logTail:[hit]}});
 for(const [revision,id] of [[9,'hero-fixture'],[12,'other-fixture']]){
  assert.equal(f.send('/game/battle',{revision,character:{id},battle:{spawnId:spawn,mobName:boss,mobHp:1,logSeq:2,log:['old',hit,hit]}}),null);
  assert.equal(f.L.fight().petDmg,100);assert.equal(f.L.fight().pendingSnapshot,undefined);
 }
 const final=f.send('/game/battle/action',{revision:12,character:{id:'hero-fixture'},victory:{spawnId:spawn,mobName:boss,fullLog:['old',hit,hit]}});
 assert.equal(final.pet,100);assert.equal(f.L.lastSum().pet,200);
});

test('version1 predictions remain historical; only corrected version2 samples predict',()=>{
 const key='rb:'+spawn;
 // Загружаем сохранённую когорту предыдущего анализатора.
 const rt={char:'Hero',classCur:{prof:'warlock',slot:0},fightMem:{[key]:{n:1,a:{attack:{evidence:1,rolls:[9999],s:[9999]}},sp:{mx:1750,n:2,g:[1],prediction:{v:1,g:[1,1]}}}}};
 const box={Date:{now:()=>100000},URLSearchParams};vm.runInNewContext(fs.readFileSync(root+'modules/fightlab.js','utf8'),box);
 const L=box.L2V7Factories.fightlab({rt,cfg:{},routeLocation:{search:'?spawnId='+spawn},actName:x=>x,setRt:async p=>Object.assign(rt,p),rec(){}});
 const send=(data)=>L.onNet('/game/battle/action',{status:200,req:{action:'attack'},res:data,bt:btOf({pathname:'/game/battle/action'},data)});
 L.onNet('/game/battle/start',{status:200,res:{},bt:{spawn,name:boss,mob:1000,seq:0,log:[]}});
 assert.equal(L.dmgOn('attack'),null);assert.equal(L.killP('attack',1),null);assert.equal(L.spikeEta(),null);
 send({delta:{mobHp:900,logSeq:1,logTail:['Полум’я 100']}});L.finish('left');L.flush();
 assert.equal(rt.fightMem[key].a.attack.evidence,2);assert.deepEqual(Array.from(rt.fightMem[key].a.attack.rolls),[100]);
 assert.deepEqual(Array.from(rt.fightMem[key].a.attack.legacyRolls),[9999]);assert.equal(rt.fightMem[key].sp.n,2);
});
