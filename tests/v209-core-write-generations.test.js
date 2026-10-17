'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPatchQueue}=require('../engine-core.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const tick=()=>new Promise(r=>setImmediate(r));
for(const success of [true,false])test('clear отделяет новый запрос от старого '+(success?'успеха':'отказа'),async()=>{
 const old=deferred(),sent=[],errors=[];
 const q=createPatchQueue(p=>{sent.push({...p});return sent.length===1?old.promise:Promise.resolve({ok:true})},()=>true,e=>errors.push(e),()=>1000);
 const stale=q.enqueue({kills:3});await tick();q.clear();
 assert.deepEqual(await q.enqueue({kills:10,status:'Новый хозяин'}),{ok:true},'новый хозяин не ждёт зависший запрос старого');
 old.resolve({ok:success});assert.equal((await stale).reason,'cleared');
 assert.deepEqual(q.peek(),{});assert.equal(errors.length,0,'чужая ошибка не создаёт backoff и повтор');
 assert.equal((await q.enqueue({kills:11})).ok,true);
 assert.deepEqual(sent,[{kills:3},{kills:10,status:'Новый хозяин'},{kills:11}]);
});
test('запись на границе завершения promise ждёт свою квитанцию',async()=>{
 const first=deferred(),second=deferred(),sent=[];let q,late,settled=false;
 q=createPatchQueue(p=>{
  sent.push({...p});
  if(sent.length===1){first.promise.then(()=>queueMicrotask(()=>{late=q.enqueue({status:'Оплата подготовлена'});late.then(()=>{settled=true})}));return first.promise}
  return second.promise;
 });
 const start=q.enqueue({kills:1});await tick();first.resolve({ok:true});await tick();
 assert.equal(sent.length,2,'пакет не остаётся в peek до следующего случайного setRt');
 assert.equal(settled,false,'durable intent не подтверждён до записи');
 second.resolve({ok:true});await Promise.all([start,late]);assert.equal(settled,true);assert.deepEqual(q.peek(),{});
});
test('потеря владельца сохраняет только текущую очередь до recover',async()=>{
 let active=false;const sent=[],q=createPatchQueue(async p=>{sent.push({...p});return{ok:true}},()=>active);
 assert.equal((await q.enqueue({phase:'Жду замок'})).reason,'inactive');
 active=true;assert.equal((await q.recover()).ok,true);assert.deepEqual(sent,[{phase:'Жду замок'}]);
});
