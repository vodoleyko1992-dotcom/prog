'use strict';
// 20.36: реальное ожидание боя из content.js — события будят, таймер страхует, готовность проверяется заново.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../content.js'),'utf8'),start=source.indexOf('function createCombatSignal('),end=source.indexOf('\nconst combatSignal=',start);
assert.ok(start>=0&&end>start,'createCombatSignal найден в боевом runtime');
const createCombatSignal=vm.runInNewContext(source.slice(start,end)+';createCombatSignal;',{Promise,Set,Math,Date});
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
for(const error of [null,undefined,0])test('falsy thrown value is still a rejection: '+String(error),async()=>{const s=createCombatSignal(()=>Promise.resolve());let caught=false;try{await s.wait(()=>{throw error;});}catch(e){caught=true;assert.equal(e,error);}assert.equal(caught,true);});
function fixture(){
 let now=0;const jobs=[];
 const signal=createCombatSignal(ms=>new Promise((resolve,reject)=>jobs.push({ms,at:now,due:now+ms,resolve,reject,pending:true})),()=>now);
 async function fire(index=jobs.findIndex(x=>x.pending),reject){const j=jobs[index];assert.ok(j?.pending,'есть ожидающий таймер');j.pending=false;reject===undefined?j.resolve():j.reject(reject);await settle();}
 return{signal,jobs,fire,now:()=>now,set:t=>now=t,async tick(ms){now+=ms;for(const j of jobs.filter(x=>x.pending&&x.due<=now)){j.pending=false;j.resolve();}await settle();}};
}
test('already satisfied predicate resolves its exact value without scheduling a timer',async()=>{
 const f=fixture(),value={accepted:true};assert.equal(await f.signal.wait(()=>value,500,40),value);await settle();assert.equal(f.jobs.length,0);
});
test('notify wakes a matching wait immediately without waiting for its fallback timer',async()=>{
 const f=fixture();let ready=false,value='pending',calls=0;const p=f.signal.wait(()=>{calls++;return ready?'server-ack':null;},1000,300).then(x=>value=x);
 await settle();assert.equal(f.jobs[0].ms,300);assert.equal(value,'pending');ready=true;f.signal.notify();await p;
 assert.equal(value,'server-ack');assert.equal(f.now(),0);assert.equal(calls,2);
});
test('unrelated notifications recheck the predicate but do not complete the wait or duplicate timers',async()=>{
 const f=fixture();let ready=false,done=false,calls=0;const p=f.signal.wait(()=>{calls++;return ready;},1000,200).then(x=>{done=true;return x;});await settle();
 for(let i=0;i<5;i++)f.signal.notify();await settle();assert.equal(done,false);assert.equal(calls,6);assert.equal(f.jobs.length,1);
 ready=true;f.signal.notify();assert.equal(await p,true);
});
test('fallback scheduler polls at the requested interval and stops at the exact timeout',async()=>{
 const f=fixture();let done=false,calls=0;const p=f.signal.wait(()=>{calls++;return false;},95,40).then(x=>{done=true;return x;});await settle();
 assert.deepEqual(f.jobs.map(x=>x.ms),[40]);await f.tick(40);assert.equal(done,false);assert.deepEqual(f.jobs.map(x=>x.ms),[40,40]);
 await f.tick(40);assert.deepEqual(f.jobs.map(x=>x.ms),[40,40,15]);await f.tick(14);assert.equal(done,false);await f.tick(1);
 assert.equal(await p,null);assert.equal(calls,4);assert.equal(f.jobs.length,3);
});
test('the fallback can observe readiness with no network notification',async()=>{
 const f=fixture();let ready=false;const p=f.signal.wait(()=>ready?'timer-ready':null,200,40);await settle();ready=true;await f.tick(40);assert.equal(await p,'timer-ready');
});
test('early timer resolution or a network event cannot advance a server deadline',async()=>{
 const f=fixture();const deadline=100;let done=false;const p=f.signal.wait(()=>f.now()>=deadline,100,100).then(x=>{done=true;return x;});await settle();
 await f.fire(0);assert.equal(done,false);assert.equal(f.jobs[1].ms,100);
 f.set(99);f.signal.notify();await settle();assert.equal(done,false);await f.fire(1);assert.equal(done,false);assert.equal(f.jobs[2].ms,1);
 f.set(100);await f.fire(2);assert.equal(await p,true);assert.equal(f.now(),100);
});
test('completed wait removes its listener and ignores the still-pending timer',async()=>{
 const f=fixture();let ready=false,calls=0;const p=f.signal.wait(()=>{calls++;return ready;},1000,100);await settle();ready=true;f.signal.notify();await p;
 const before=calls;for(let i=0;i<3;i++)f.signal.notify();await f.fire(0);assert.equal(calls,before);assert.equal(f.jobs.length,1);
});
test('timed-out wait removes its listener and schedules no additional fallback',async()=>{
 const f=fixture();let calls=0;const p=f.signal.wait(()=>{calls++;return null;},20,50);await settle();assert.equal(f.jobs[0].ms,20);await f.tick(20);assert.equal(await p,null);
 const before=calls;f.signal.notify();await settle();assert.equal(calls,before);assert.equal(f.jobs.length,1);
});
test('initial predicate failure rejects its exact error and leaves no listener or timer',async()=>{
 const f=fixture(),error=new Error('predicate failed');let calls=0;const p=f.signal.wait(()=>{calls++;throw error;},100,40);
 await assert.rejects(p,e=>e===error);f.signal.notify();await settle();assert.equal(calls,1);assert.equal(f.jobs.length,0);
});
test('predicate failure after notify rejects and the pending timer cannot run it again',async()=>{
 const f=fixture(),error=new Error('late predicate failed');let fail=false,calls=0;const p=f.signal.wait(()=>{calls++;if(fail)throw error;return false;},1000,200);const rejected=assert.rejects(p,e=>e===error);await settle();
 fail=true;f.signal.notify();await rejected;const before=calls;f.signal.notify();await f.fire(0);assert.equal(calls,before);assert.equal(f.jobs.length,1);
});
test('scheduler promise rejection rejects the wait and clears its listener',async()=>{
 const f=fixture(),error=new Error('background timer failed');let calls=0;const p=f.signal.wait(()=>{calls++;return false;},1000,200),rejected=assert.rejects(p,e=>e===error);await settle();
 await f.fire(0,error);await rejected;const before=calls;f.signal.notify();await settle();assert.equal(calls,before);assert.equal(f.jobs.length,1);
});
test('synchronous scheduler failure rejects the wait and clears its listener',async()=>{
 const error=new Error('schedule throw');let calls=0;const signal=createCombatSignal(()=>{throw error;},()=>0),p=signal.wait(()=>{calls++;return false;},1000,200);
 await assert.rejects(p,e=>e===error);signal.notify();await settle();assert.equal(calls,1);
});
test('pulse wakes on a notification, then the next pulse starts from the new revision',async()=>{
 const f=fixture();let done=false;const p=f.signal.pulse(500);await settle();f.signal.notify();assert.equal(await p,true);
 const next=f.signal.pulse(500).then(x=>{done=true;return x;});await settle();assert.equal(done,false);f.signal.notify();assert.equal(await next,true);
});
test('pulse falls back to its complete duration and returns null when no event arrives',async()=>{
 const f=fixture();let done=false;const p=f.signal.pulse(125).then(x=>{done=true;return x;});await settle();assert.equal(f.jobs[0].ms,125);
 await f.tick(124);assert.equal(done,false);await f.tick(1);assert.equal(await p,null);assert.equal(f.jobs.length,1);
});
test('several independent waits and pulses share notify without releasing false predicates',async()=>{
 const f=fixture();let a=false,b=false,bDone=false;const pa=f.signal.wait(()=>a?'A':null,1000,100),pb=f.signal.wait(()=>b?'B':null,1000,200).then(x=>{bDone=true;return x;}),pulse=f.signal.pulse(400);await settle();
 a=true;f.signal.notify();assert.equal(await pa,'A');assert.equal(await pulse,true);await settle();assert.equal(bDone,false);
 b=true;f.signal.notify();assert.equal(await pb,'B');assert.equal(f.jobs.length,3);
});
test('zero timeout does not schedule, and a zero poll step uses bounded one-ms fallback',async()=>{
 const f=fixture();assert.equal(await f.signal.wait(()=>false,0,100),null);assert.equal(f.jobs.length,0);
 const p=f.signal.wait(()=>false,3,0);await settle();assert.equal(f.jobs[0].ms,1);await f.tick(1);await f.tick(1);await f.tick(1);assert.equal(await p,null);assert.deepEqual(f.jobs.map(x=>x.ms),[1,1,1]);
});
