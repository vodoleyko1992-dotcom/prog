'use strict';
// Лог28.10 01:32: сверки подземелья перекрываются по времени, но разрешают действие только после всех ответов.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2071-rebirth-route-isolation.test.cjs'),source=fs.readFileSync(file,'utf8');
const code=source.slice(0,source.indexOf("\ntest('"))+source.slice(source.indexOf('function victoryFixture('),source.indexOf("test('отдельное продолжение"))+'\nthis.make=fixture;this.won=victoryFixture;';
const box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(code,box);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const drain=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const instance='/game/rebirth-raids?view=instance';
function delayed(f,urls){
 const gates=Object.fromEntries(urls.map(url=>[url,deferred()])),started=[],get=f.env.gameGet;
 f.env.gameGet=async url=>{const key=url.startsWith('/game/battle?')?'battle':url;started.push(key);if(gates[key])await gates[key].promise;return get(url);};
 return{gates,started,release:()=>Object.values(gates).forEach(x=>x.resolve())};
}

test('допуск: после героя battle и instance отправлены одновременно; до обоих proof отсутствует',async()=>{
 const f=box.make(),d=delayed(f,['battle',instance]);let done=false;
 const pending=f.prove().then(p=>{done=true;return p;});await drain();
 try{assert.deepEqual(d.started,['/character','battle',instance]);assert.equal(done,false);
  d.gates.battle.resolve();await drain();assert.equal(done,false);assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);
 }finally{d.release();}
 assert.equal((await pending)?.role,'mob');assert.equal(f.reads.length,3);
});

test('продолжение: герой и instance отправлены вместе; native-клик ждёт оба и не дублируется',async()=>{
 const f=box.won(),d=delayed(f,['/character',instance]);
 const pending=f.api().nextFight(f.ctx);await drain();
 try{assert.deepEqual(d.started,['/character',instance]);assert.equal(f.clicks.length,0);
  d.gates[instance].resolve();await drain();assert.equal(f.clicks.length,0);
  await f.api().nextFight(f.ctx);assert.equal(d.started.length,2,'busy удерживает параллельное продолжение');
 }finally{d.release();}
 await pending;assert.deepEqual(Array.from(f.clicks),['hunt']);assert.equal(f.posts.length,0);
});

for(const part of ['battle','next'])for(const cancel of ['stop','owner','class','mode','generation','captcha'])test(`${part}: отмена при обратном порядке ответов — ${cancel}`,async()=>{
 const f=part==='battle'?box.make():box.won(),urls=part==='battle'?['battle',instance]:['/character',instance],d=delayed(f,urls);
 if(cancel==='captcha'){let blocked=false;f.env.canRun=()=>!blocked;f.cancel=()=>{blocked=true;};}
 const pending=part==='battle'?f.prove():f.api().nextFight(f.ctx);await drain();
 try{d.gates[instance].resolve();await drain();
  if(cancel==='stop')f.env.on=false;if(cancel==='owner')f.env.tabOwner=false;if(cancel==='class')f.env.rt.classCur.prof='other';
  if(cancel==='mode')f.S.mode='farm';if(cancel==='generation')f.S.generation=2;if(cancel==='captcha')f.cancel();
 }finally{d.release();}
 const proof=await pending;if(part==='battle')assert.equal(proof,null);
 assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.keys,100);
});

for(const part of ['battle','next'])test(`${part}: отказ одного GET ждёт второй, без нового перекрывающегося probe`,async()=>{
 const f=part==='battle'?box.make():box.won(),slow=deferred(),get=f.env.gameGet,started=[];let done=false;
 f.env.gameGet=async url=>{started.push(url);if(url===instance){await slow.promise;return get(url);}
  if(part==='next'||url.startsWith('/game/battle?'))throw Error('read_failed');return get(url);};
 const pending=(part==='battle'?f.prove():f.api().nextFight(f.ctx)).then(v=>{done=true;return v;});await drain();
 try{assert.equal(done,false);const n=started.length;await(part==='battle'?f.prove():f.api().nextFight(f.ctx));
  assert.equal(started.length,n);assert.equal(f.clicks.length,0);
 }finally{slow.resolve();}
 await pending;assert.equal(f.posts.length,0);assert.equal(f.clicks.length,0);
});
