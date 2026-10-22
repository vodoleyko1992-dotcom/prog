'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const getter=source.slice(source.indexOf('async function gameGet('),source.indexOf('// 7.2.5',source.indexOf('async function gameGet(')));
const inventory=source.slice(source.indexOf('let INV_NET ='),source.indexOf('const actNet ='));
const copy=x=>JSON.parse(JSON.stringify(x));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Настоящий fetch/Response: заголовки 200 ещё не означают, что тело дочитано.
async function localServer(run){
 const timers=new Set(),later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn()},ms);timers.add(id)};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  const headers=()=>{res.writeHead(200,{'content-type':'application/json','x-fixture':'native'});res.flushHeaders()};
  if(url.pathname==='/slow-headers')return later(()=>{headers();res.end('{"ok":true}')},350);
  headers();
  if(url.pathname==='/never'){res.write('{"ok":');return}
  if(url.pathname==='/drip'){res.write('{"ok":');later(()=>res.write('t'),70);later(()=>res.write('r'),140);later(()=>res.end('ue}'),350);return}
  if(url.pathname==='/slow-body')return later(()=>res.end('{"ok":true}'),70);
  res.end('{"ok":true}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await run('http://127.0.0.1:'+server.address().port)}
 finally{for(const id of timers)clearTimeout(id);server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
function getFixture(){
 const box={fetch,AbortController,AbortSignal,setTimeout,clearTimeout,gameAuth:()=>({'x-local-fixture':'1'})};
 vm.runInNewContext(getter,box);return box.gameGet;
}
async function outcome(p,ms=700){
 let timeout;try{return await Promise.race([p.then(value=>({value}),error=>({error})),new Promise(resolve=>timeout=setTimeout(()=>resolve({hung:true}),ms))])}finally{clearTimeout(timeout)}
}
test('GET native deadline includes headers, hanging body and drip',async()=>{
 await localServer(async base=>{
  const get=getFixture();
  for(const route of ['/slow-headers','/never','/drip']){
   const result=await outcome(get(base+route,180).then(r=>r.json()));
   assert.ok(result.error,'original GET deadline must reject '+route+' (not remain pending or accept a late body)');
   assert.match(result.error.name,/AbortError|TimeoutError/);
  }
 });
});
test('GET returns native Response and parallel/delayed consumers keep their original deadlines',async()=>{
 await localServer(async base=>{
  const get=getFixture(),[first,second]=await Promise.all([get(base+'/slow-body',450),get(base+'/plain',450)]);
  assert.ok(first instanceof Response);assert.equal(first.status,200);assert.equal(first.headers.get('x-fixture'),'native');assert.equal(first.bodyUsed,false);
  const clone=first.clone();assert.deepEqual(await second.json(),{ok:true});await delay(90);
  assert.deepEqual(await first.json(),{ok:true});assert.equal(await clone.text(),'{"ok":true}');assert.equal(first.bodyUsed,true);
  const late=await get(base+'/never',120);await delay(150);const result=await outcome(late.text());
  assert.ok(result.error,'starting body consumption later must not restart the deadline');
 });
});

function clock(){
 let now=1800000000000,seq=0,lastDelay=0;const timers=new Map();
 const set=(fn,ms=0)=>{lastDelay=ms;const id=++seq;timers.set(id,{at:now+ms,fn});return id};
 const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve()};
 return{Date:class extends Date{static now(){return now}},set,clear:id=>timers.delete(id),now:()=>now,lastDelay:()=>lastDelay,
  async tick(ms){const end=now+ms;await flush();for(;;){let due;for(const [id,t]of timers)if(t.at<=end&&(!due||t.at<due[1].at))due=[id,t];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await flush()}now=end;await flush()}};
}
function snapshot(overrides={}){return{name:'Hero',revision:100,l2Profession:'dwarf_warsmith',classBranch:'fighter',level:70,
 classSlots:{activeSlot:2,slots:[{slot:2,owned:true,active:true,profession:'dwarf_warsmith',level:70}]},inventory:{stacks:[{itemId:1465,qty:1000}],eq:{}},...copy(overrides)}}
function fixture(){
 const time=clock(),queue=[],calls=[],publications=[],writes=[],stored={};let hero='Hero';
 const box={Date:time.Date,AbortController,AbortSignal:{timeout(ms){const controller=new AbortController();time.set(()=>controller.abort(new DOMException('GET deadline','TimeoutError')),ms);return controller.signal}},
  setTimeout:time.set,clearTimeout:time.clear,gameAuth:()=>({}),cfg:{},on:true,tabOwner:true,leaseEpoch:'one',automationGeneration:1,
  rt:{char:'Hero',classCur:{prof:'dwarf_warsmith',slot:2},manualKickAt:0},heroNick:()=>hero,
  sessionStorage:{getItem:k=>stored[k]??null,setItem:(k,v)=>stored[k]=v,removeItem:k=>delete stored[k]},setStatus:()=>{},
  setRt:async p=>{Object.assign(box.rt,copy(p));writes.push(copy(p));return{ok:true}},rtCommit:async()=>true,
  L2V7Modules:{mammon:{eqNote(){}},warlock:{noteSnapshot:c=>publications.push(c)},buffs:{vipNote(){}},subclass:{charNote(){}},story:{charNote(c){box.rt.classCur={prof:c.l2Profession,slot:c.classSlots.activeSlot,t:time.now()}}}},
  fetch:(url,options)=>{
   const plan=queue.shift()||{},signal=options.signal;calls.push({url,ms:time.lastDelay(),options});
   return new Promise((resolve,reject)=>{
    let ready=false,bodyWait;const bodyError=()=>signal.reason||new DOMException('Aborted','AbortError');
    signal.addEventListener('abort',()=>{reject(bodyError());bodyWait?.reject(bodyError())},{once:true});
    time.set(()=>{
     if(signal.aborted)return;
     const consume=kind=>new Promise((res,rej)=>{
      const deliver=()=>{if(signal.aborted)return rej(bodyError());if(plan.badJSON&&kind==='json')return rej(new SyntaxError('fixture body'));res(kind==='text'?(plan.html||JSON.stringify({character:plan.character||snapshot()})):{character:copy(plan.character||snapshot())})};
      bodyWait={reject:rej,deliver};if(ready)deliver();
     });
     resolve({ok:plan.ok!==false,json:()=>consume('json'),text:()=>consume('text')});
     if(plan.body!==Infinity)time.set(()=>{ready=true;bodyWait?.deliver()},plan.body||0);
    },plan.headers||0);
   });
  }};
 vm.createContext(box);vm.runInContext(getter+inventory+';this.inspectInv=()=>({ready:INV_READY,net:INV_NET,retry:INV_RETRY,read:!!INV_READ,wait:INV_CLASS_WAIT});this.qty=invQty;',box);
 return{box,time,calls,publications,writes,stored,queue,hero:x=>hero=x,
  async read(plan={},ms=0){queue.push(plan);let done=false,value;box.inventoryReady().then(v=>{done=true;value=v});await time.tick(ms);assert.ok(done,'inventory read must settle within its deadline');return value},
  async failed(){assert.equal(await this.read({headers:14000},6000),false);assert.equal(box.inspectInv().read,false);await time.tick(2000)}};
}
test('inventory first read stays 6s and respects the initial retry backoff',async()=>{
 const f=fixture();assert.equal(await f.read({headers:14000},6000),false);assert.equal(f.calls[0].ms,6000);assert.equal(await f.box.inventoryReady(),false);assert.equal(f.calls.length,1,'backoff is still active until the original two seconds elapse');
});
test('inventory recovery is 25s only after failure; success resets the same context',async()=>{
 const f=fixture();await f.failed();assert.equal(await f.read({headers:14000},14000),true);assert.deepEqual(f.calls.map(x=>x.ms),[6000,25000]);
 assert.equal(f.box.qty(1465),1000);assert.equal(f.box.inspectInv().retry.n,0);assert.equal(f.publications.length,1);
 await f.time.tick(300001);assert.equal(await f.read({},0),true);assert.deepEqual(f.calls.map(x=>x.ms),[6000,25000,6000]);
});
test('headers without a body release INV_READ and enter existing bounded backoff',async()=>{
 const f=fixture();assert.equal(await f.read({body:Infinity},6000),false);assert.equal(f.box.inspectInv().read,false);assert.equal(f.box.inspectInv().retry.at-f.time.now(),2000);
 for(const backoff of [4000,8000,16000,30000,30000]){await f.time.tick(f.box.inspectInv().retry.at-f.time.now());assert.equal(await f.read({body:Infinity},25000),false);assert.equal(f.box.inspectInv().retry.at-f.time.now(),backoff)}
 assert.equal(f.publications.length,0);assert.equal(f.box.inspectInv().ready,'');
});
test('concurrent inventory consumers share the recovery GET',async()=>{
 const f=fixture();await f.failed();f.queue.push({body:14000});const a=f.box.inventoryReady(),b=f.box.inventoryReady();await f.time.tick(14000);
 assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(f.calls.length,2);assert.equal(f.calls[1].ms,25000);
});
for(const [name,change]of[
 ['Stop',f=>f.box.on=false],['owner',f=>f.box.tabOwner=false],['lease',f=>f.box.leaseEpoch='two'],['actor',f=>f.box.rt.char='Other'],
 ['HUD',f=>f.hero('Other')],['class',f=>f.box.rt.classCur={prof:'human_warlock',slot:0}],['new Start',f=>f.box.rt.manualKickAt=10],['generation',f=>f.box.automationGeneration++]
])test('late recovery cannot publish inventory after '+name,async()=>{
 const f=fixture();await f.failed();f.queue.push({body:14000});const p=f.box.inventoryReady();await f.time.tick(1000);change(f);await f.time.tick(13000);
 assert.equal(await p,false);assert.equal(f.box.inspectInv().read,false);assert.equal(f.box.inspectInv().ready,'');assert.equal(f.box.inspectInv().net,null);assert.equal(f.publications.length,0);assert.equal(f.writes.length,0);
});
for(const [name,change]of[['lease',f=>f.box.leaseEpoch='two'],['actor',f=>{f.box.rt.char='Other';f.hero('Other')}],['class',f=>f.box.rt.classCur={prof:'human_warlock',slot:0}]])test('new '+name+' context starts with ordinary 6s after old read failed',async()=>{
 const f=fixture();await f.failed();change(f);const next=snapshot({name:f.box.rt.char,l2Profession:f.box.rt.classCur.prof,classSlots:{activeSlot:f.box.rt.classCur.slot}});
 assert.equal(await f.read({character:next},0),true);assert.deepEqual(f.calls.map(x=>x.ms),[6000,6000]);
});
for(const [name,plan]of[['HTML200',{html:'<html>maintenance</html>',badJSON:true}],['bad JSON',{badJSON:true}],['HTTP502',{ok:false}],['wrong hero',{character:snapshot({name:'Other'})}],['old revision',{character:snapshot({revision:99})}]])test('recovery rejects '+name+' without inventory permission',async()=>{
 const f=fixture();await f.failed();f.box.rt.invClassProof={char:'Hero',prof:'dwarf_warsmith',slot:2,revision:100};assert.equal(await f.read({...plan,body:14000},14000),false);
 assert.equal(f.box.inspectInv().ready,'');assert.equal(f.box.inspectInv().net,null);assert.equal(f.publications.length,0);
});
test('recovery can durably confirm an actual class change, then requires a new-context GET',async()=>{
 const f=fixture();await f.failed();const changed=snapshot({revision:101,l2Profession:'human_warlock',classBranch:'mystic',classSlots:{activeSlot:0,slots:[{slot:0,owned:true,active:true,profession:'human_warlock',level:70}]}});
 assert.equal(await f.read({character:changed,body:14000},14000),false);assert.equal(f.box.rt.classCur.prof,'human_warlock');assert.equal(f.box.rt.invClassProof.revision,101);
 assert.equal(f.box.inspectInv().ready,'');assert.equal(f.box.inspectInv().net,null);assert.equal(f.publications.length,0);
 assert.equal(await f.read({character:changed},0),true);assert.deepEqual(f.calls.map(x=>x.ms),[6000,25000,6000]);assert.equal(f.box.qty(1465),1000);
});
test('explicit inventory active guard and ordinary unrelated GET keep their own contracts',async()=>{
 const f=fixture();f.queue.push({});const inactive=f.box.invRefresh(()=>false,25000);await f.time.tick(0);assert.equal(await inactive,null);assert.equal(f.box.inspectInv().ready,'');
 f.queue.push({});const other=f.box.gameGet('/unrelated');await f.time.tick(0);await other;assert.deepEqual(f.calls.map(x=>x.ms),[25000,6000]);
});
