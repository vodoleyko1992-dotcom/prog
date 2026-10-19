'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){const source=fs.readFileSync(__dirname+'/v2017-farm-kill-evidence.test.js','utf8'),c={require:n=>n==='node:test'?()=>{}:require(n),__dirname,console,URLSearchParams};vm.runInNewContext(source.slice(0,source.indexOf("test(")),c);return c.fixture()}
const spawn='dense_fixture',death=n=>'Додаткова ціль повалена: '+n+'.';
test('после200 имён поток продолжает подтверждать каждую новую смерть',()=>{
 const f=fixture();f.start();for(let i=1;i<=300;i++)f.send('/game/battle/action',{revision:i+1,delta:{mobHp:500,logSeq:i*3,logTail:[death('Maiden'),death('Maiden'),death('Howler')]}});
 const s=f.L.raidKillsFor(spawn).stream;assert.equal(f.get().extras.length,200);assert.equal(s.deaths.length,900);assert.equal(s.seq,900);assert.equal(s.deaths.at(-1),900);
});
test('полный журнал5000 смертей сохраняет точный итог и ограниченный хвост4096 номеров',()=>{
 const f=fixture();f.start();const log=['Бой начат: Boss',...Array.from({length:5000},()=>death('Maiden')),...Array(100).fill('Coal ×1')];
 f.send('/game/battle',{revision:2,battle:{spawnId:spawn,mobName:'Boss',mobHp:500,logSeq:log.length,log}});const s=f.L.raidKillsFor(spawn).stream;assert.equal(s.fullN,5000);assert.equal(s.fullSeq,5101);assert.equal(s.deaths.length,4096);
});
test('номера относятся к полному источнику до обрезки и сохраняются при повторе GET',()=>{
 const f=fixture();f.start();const log=['Бой начат: Boss',death('A'),death('A'),...Array(100).fill('Coal ×1')],raw={revision:2,battle:{spawnId:spawn,mobHp:500,logSeq:103,log}};
 f.send('/game/battle',raw);f.send('/game/battle',raw);const s=f.L.raidKillsFor(spawn).stream;assert.deepEqual(JSON.parse(JSON.stringify(s.deaths)),[2,3]);assert.equal(s.fullN,2);
});
test('пустая синхронизация не стирает поток и старый ответ его не дополняет',()=>{
 const f=fixture();f.start();f.send('/game/battle/action',{revision:5,delta:{mobHp:500,logSeq:3,logTail:[death('A'),death('B'),death('C')]}});f.send('/game/battle/sync',{delta:{serverNowMs:1}});f.send('/game/battle',{revision:4,battle:{spawnId:spawn,mobHp:500,logSeq:4,log:[death('Old')]}});assert.equal(f.L.raidKillsFor(spawn).stream.deaths.length,3);
});
test('смена героя/класса и PvP отбрасывают также поток РБ',()=>{
 for(const kind of ['char','class','pvp']){const f=fixture();f.start();f.send('/game/battle/action',{revision:2,delta:{mobHp:500,logSeq:1,logTail:[death('A')]}});if(kind==='char')f.rt.char='Other';if(kind==='class')f.rt.classCur.slot=2;if(kind==='pvp')f.setPvp(true);assert.equal(f.L.raidKillsFor(spawn),null)}
});
test('чужой spawn и изменение возвращённого массива не портят подтверждения',()=>{
 const f=fixture();f.start();f.send('/game/battle/action',{revision:2,delta:{mobHp:500,logSeq:1,logTail:[death('A')]}});assert.equal(f.L.raidKillsFor('other'),null);f.L.raidKillsFor(spawn).stream.deaths.push(999);assert.equal(f.L.raidKillsFor(spawn).stream.deaths.length,1);
});
