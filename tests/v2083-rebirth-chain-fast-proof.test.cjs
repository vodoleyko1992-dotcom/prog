'use strict';
// 20.83 (лог30.10 11:00–12:03, John «какие-то серверные сверки, лаги»): моб похода ≈3 с, из них ≈1 с — повторная сверка героя/похода
// в начале каждого следующего боя и ≈1 с — сверка и лишние записи памяти после победы. Следующий моб своего же продолжения допускается
// одним GET живого боя; остальное — прежняя полная сверка. Плюс выход из зависания, когда ответ start потерян, а сервер уже открыл бой.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2071-rebirth-route-isolation.test.cjs'),source=fs.readFileSync(file,'utf8');
const code=source.slice(0,source.indexOf("\ntest('"))+source.slice(source.indexOf('function victoryFixture('),source.indexOf("test('отдельное продолжение"))+'\nthis.make=fixture;this.won=victoryFixture;this.sid=sid;';
const box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(code,box);
const sid=box.sid,instance='/game/rebirth-raids?view=instance';

// Победа над mob_1 → своё «Охотиться дальше» → игра открыла mob_n (по умолчанию mob_2) того же похода.
async function chained(o={}){
 const f=box.won(),next=o.next||sid('mob',25098,2);
 if(o.beforeNext)o.beforeNext(f);
 await f.api().nextFight(f.ctx);assert.deepEqual(Array.from(f.clicks),['hunt']);
 const readsAfterWin=f.reads.length;
 f.env.victory=()=>false;f.location.href='/battle.html?spawnId='+next;f.ch.inBattle=true;f.ch.battleSpawnId=next;f.ch.revision+=1;
 Object.assign(f.battle,{spawnId:next,mobHp:900});f.instance.activeRun.mobKills+=1;
 if(o.tick)f.tick(o.tick);
 if(o.after)o.after(f);
 return{...f,next,readsAfterWin};
}

test('следующий моб своего продолжения допускается одним GET живого боя, связь сохраняется',async()=>{
 const f=await chained();
 const proof=await f.prove();
 assert.equal(proof?.role,'mob');assert.equal(proof.spawn,f.next);assert.equal(proof.current(),true);
 const reads=f.reads.slice(f.readsAfterWin);
 assert.equal(reads.length,1);assert.match(reads[0],/^\/game\/battle\?characterId=/);assert.ok(reads[0].includes(encodeURIComponent(f.next)));
 const s=f.env.rt.rebirth;assert.equal(s.battleSpawn,f.next);assert.equal(s.battleRole,'mob');assert.equal(s.phase,'battle');
 assert.equal(f.posts.length,0);assert.equal(f.clicks.length,1);
});

test('быстрый допуск одноразовый: повторная проверка того же боя — полная сверка',async()=>{
 const f=await chained();assert.equal((await f.prove())?.role,'mob');
 const before=f.reads.length;f.tick(16000);assert.equal((await f.prove())?.role,'mob');
 assert.deepEqual(Array.from(f.reads.slice(before)).map(u=>u.startsWith('/game/battle?')?'battle':u),['/character','battle',instance]);
});

for(const [label,o] of [
 ['старше15с',{tick:15000}],
 ['чужой run в URL',{next:'rebirth_raid_22222222-2222-4222-8222-222222222222_2_1_25098_lv35_mob_2'}],
 ['номер моба не больше прежнего',{next:sid('mob',25098,1)}],
 ['чемпион, а не моб',{next:sid('champion'),after:f=>{Object.assign(f.instance.activeRun,{phase:'champion',mobKills:300});f.battle.mobName='Rebirth Champion · Wyrm';}}],
 ['квитанция продолжения стёрта',{after:f=>f.storage.delete('l2bot.rebirth-next')}],
 ['смена класса героя',{after:f=>{f.env.rt.classCur.slot=1;f.ch.classSlots.activeSlot=1;}}],
])test(`полная сверка вместо быстрой: ${label}`,async()=>{
 const f=await chained(o);
 const name=f.battle.mobName;await f.api().battleProof({name,max:1000,title:name+' · ур.35',valid:()=>true});
 const reads=Array.from(f.reads.slice(f.readsAfterWin)).map(u=>u.startsWith('/game/battle?')?'battle':u);
 assert.notDeepEqual(reads,['battle'],'быстрый допуск не применяется');assert.equal(reads[0],'/character');
 assert.equal(f.posts.length,0);assert.equal(f.clicks.length,1);
});

test('живой бой не совпал с продолжением — полная сверка решает по свежему серверу',async()=>{
 // герой в бою другого моба: быстрый GET не подтверждает, полная сверка видит чужой для URL бой и не допускает
 const f=await chained({after:f=>{f.ch.battleSpawnId=sid('mob',25098,7);}});
 assert.equal(await f.prove(),null);
 assert.deepEqual(Array.from(f.reads.slice(f.readsAfterWin)).map(u=>u.startsWith('/game/battle?')?'battle':u),['battle','/character','battle',instance]);
 assert.equal(f.clicks.length,1);
});

test('быстрый допуск сохраняет все проверки цели: завершённый бой, другое имя/HP не допускаются',async()=>{
 for(const change of [f=>{f.battle.ended=true;},f=>{f.battle.mobName='Other';},f=>{f.battle.mobMaxHp=1001;},f=>{f.battle.kind='unknown';}]){
  const f=await chained({after:change});assert.equal(await f.prove(),null);assert.equal(f.clicks.length,1);assert.equal(f.posts.length,0);
 }
});

test('Stop/смена режима во время быстрого GET отменяют допуск',async()=>{
 for(const change of [f=>{f.env.on=false;},f=>{f.S.mode='farm';},f=>{f.S.generation=2;}]){
  const f=await chained();f.S.hooks.json=url=>{if(url.startsWith('/game/battle?'))change(f);};
  assert.equal(await f.prove(),null);assert.equal(f.clicks.length,1);
 }
});

test('via уже «chain» — следующий моб без лишней записи памяти; первая запись по-прежнему обязательна',async()=>{
 const f=box.won();const writes=[],set=f.env.setRt;f.env.setRt=async p=>{writes.push(Object.keys(p).join(','));return set(p);};
 await f.api().nextFight(f.ctx);assert.equal(writes.filter(k=>k==='via').length,1);
 const g=box.won();g.env.rt.via='chain';const w2=[],set2=g.env.setRt;g.env.setRt=async p=>{w2.push(Object.keys(p).join(','));return set2(p);};
 await g.api().nextFight(g.ctx);assert.equal(w2.filter(k=>k==='via').length,1,'via не подтверждён этой вкладкой — пишется');
 // второй моб той же вкладки: via уже записан — без записи
 g.env.victory=()=>true;const next=sid('mob',25098,2);
 g.location.href='/battle.html?spawnId='+next;g.env.battleInfo=()=>({t:g.now(),spawn:next,name:g.ctx.name});g.ch.inBattle=false;
 await g.api().nextFight({name:g.ctx.name,spawnId:next});
 assert.equal(w2.filter(k=>k==='via').length,1);assert.equal(g.clicks.filter(x=>x==='hunt').length,2);
});

test('потерянный ответ start: сервер уже открыл следующего моба — бесплатный каталог вместо 15-секундного круга',async()=>{
 const f=box.won();
 f.storage.set('l2bot.rebirth-next',JSON.stringify({key:JSON.stringify(['Hero','human_wizard',0,sid()]),t:f.now()-9000}));
 Object.assign(f.env.rt,{rebirth:{actor:f.ch.id,prof:'human_wizard',slot:0,runId:f.instance.activeRun.id,battleSpawn:sid(),battleRole:'mob',
  observedRun:{char:'Hero',kick:f.env.rt.manualKickAt||0}}});
 f.env.battleInfo=()=>null;f.ch.inBattle=true;f.ch.battleSpawnId=sid('mob',25098,2);
 await f.api().nextFight(null);
 assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);
 assert.ok(f.storage.has('l2bot.rebirth-next'),'квитанция продолжения не снимается');
});

test('потерянный ответ start: бой другого похода или героя — прежний отказ, без перехода',async()=>{
 for(const change of [f=>{f.ch.battleSpawnId='rebirth_raid_22222222-2222-4222-8222-222222222222_2_1_25098_lv35_mob_2';},f=>{f.ch.battleSpawnId='dense_5598';},f=>{f.ch.id='other';}]){
  const f=box.won(),page=f.location.href;
  f.storage.set('l2bot.rebirth-next',JSON.stringify({key:JSON.stringify(['Hero','human_wizard',0,sid()]),t:f.now()-9000}));
  Object.assign(f.env.rt,{rebirth:{actor:f.ch.id,prof:'human_wizard',slot:0,runId:f.instance.activeRun.id,battleSpawn:sid(),battleRole:'mob',
   observedRun:{char:'Hero',kick:f.env.rt.manualKickAt||0}}});
  f.env.battleInfo=()=>null;f.ch.inBattle=true;f.ch.battleSpawnId=sid('mob',25098,2);change(f);
  await f.api().nextFight(null);assert.equal(f.location.href,page);assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);
 }
});

// 20.83 (лог30.10 11:22–11:36): 14 мин одной строкой «сверка не ответила» без причины — теперь причина в журнале, без секретов.
const rtFile=path.join(__dirname,'v2068-rebirth-runtime.test.cjs'),rtSource=fs.readFileSync(rtFile,'utf8');
const rtBox={require:require('node:module').createRequire(rtFile),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(rtSource.slice(0,rtSource.indexOf("test('"))+'\nthis.fixture=fixture;',rtBox);
test('сбой сверки хода похода: причина в журнале раз в минуту, текст сетевой ошибки не пишется',async()=>{
 const f=rtBox.fixture();f.env.prepareRun=async()=>{const x=null;return x.ready;};
 await f.step();const logs=()=>f.logs.filter(l=>/сверка хода похода прервана/.test(l));
 assert.equal(logs().length,1);assert.match(logs()[0],/TypeError/);
 f.tick(3000);await f.step();assert.equal(logs().length,1,'та же причина не чаще раза в минуту');
 f.tick(61000);await f.step();assert.equal(logs().length,2);
 const g=rtBox.fixture({state:{readFail:true}});await g.step();
 assert.equal(g.logs.filter(l=>/сверка хода похода прервана: ошибка Error/.test(l)).length,1);assert.ok(!g.logs.join('').includes('private-token'));
});
