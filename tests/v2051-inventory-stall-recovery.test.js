'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.L2_INV_SOURCE||path.join(__dirname,'../content.js'),'utf8');
const getter=source.slice(source.indexOf('async function gameGet('),source.indexOf('// 7.2.5',source.indexOf('async function gameGet(')));
const inventory=source.slice(source.indexOf('let INV_NET ='),source.indexOf('const actNet ='));
const copy=x=>JSON.parse(JSON.stringify(x));
const SECRET='fixture-private-token-must-never-be-logged';

// Управляем только время/сервер/IPC. Проверяем настоящие функции preflight, не копию алгоритма восстановления.
function clock(start=1800000000000){
 let now=start,seq=0;const timers=new Map(),flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve()};
 return{Date:class extends Date{static now(){return now}},now:()=>now,
  set(fn,ms=0){const id=++seq;timers.set(id,{at:now+ms,fn});return id},clear:id=>timers.delete(id),flush,
  async tick(ms){const end=now+ms;await flush();for(;;){let next;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush()}now=end;await flush()}};
}
function snapshot(overrides={}){return{name:'Hero',revision:100,l2Profession:'human_warlord',classBranch:'fighter',level:57,
 classSlots:{activeSlot:3,slots:[{slot:3,owned:true,active:true,profession:'human_warlord',level:57}]},inventory:{stacks:[{itemId:1465,qty:1000}],eq:{}},...copy(overrides)}}
function fixture(options={}){
 const time=clock(options.now),stored=options.stored||{},queue=[],calls=[],logs=[],statuses=[],writes=[],publications=[],signals=new WeakMap();
 let hero='Hero',reloads=0,ab=null,payment=null,payWriting=false,travel=false,hold=false,canAct=true,flushCount=0,flushResult=true,flushHook=null,storeFails=false;
 const box={Date:time.Date,AbortController,DOMException,setTimeout:time.set,clearTimeout:time.clear,
  AbortSignal:{timeout(ms){const controller=new AbortController();signals.set(controller.signal,ms);time.set(()=>controller.abort(new DOMException(SECRET,'TimeoutError')),ms);return controller.signal}},
  cfg:{task:'raid'},modeSig:cfg=>cfg.task,on:true,tabOwner:true,leaseEpoch:'one',automationGeneration:1,
  rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},manualKickAt:0},heroNick:()=>hero,gameAuth:()=>({}),
  location:{pathname:options.page||'/map.html',search:'',reload(){reloads++}},
  sessionStorage:{getItem:k=>stored[k]??null,setItem(k,v){if(storeFails&&k==='l2bot-inv-reload')throw new Error(SECRET);stored[k]=v},removeItem:k=>delete stored[k]},
  setStatus:line=>statuses.push(line),rec:(...entry)=>logs.push(copy(entry)),antibotState:()=>ab,
  isBattle:()=>/battle/.test(box.location.pathname),isFishing:()=>/fishing/.test(box.location.pathname),isMap:()=>box.location.pathname==='/map.html',
  setRt:async p=>{Object.assign(box.rt,copy(p));writes.push(copy(p));return{ok:true}},rtCommit:async()=>true,
  automationSnapshot:()=>JSON.stringify([box.automationGeneration,box.rt.char,box.leaseEpoch,box.rt.manualKickAt,box.cfg.task,box.location.pathname,box.location.search]),
  automationCurrent:stamp=>box.on&&box.tabOwner&&stamp===box.automationSnapshot()&&canAct,
  automationFlush:async stamp=>{flushCount++;if(flushHook)await flushHook();return flushResult&&box.automationCurrent(stamp)},
  sleep:async ms=>{await time.tick(ms)},
  L2V7Modules:{payments:{pending:()=>payment,blocked:()=>payWriting||!!payment},navigation:{travelPending:()=>travel},actions:{canAct:()=>canAct},tvt:{tvtHold:()=>hold},
   mammon:{eqNote(){}},warlock:{noteSnapshot:c=>publications.push(c)},buffs:{vipNote(){}},subclass:{charNote(){}},
   story:{charNote(c){box.rt.classCur={prof:c.l2Profession,slot:c.classSlots.activeSlot,t:time.now()}}}},
  fetch:(url,options)=>{
   const plan=queue.shift()||{},signal=options.signal;calls.push({url,ms:signals.get(signal)});
   return new Promise((resolve,reject)=>{
    let ready=false,bodyWait;const bodyError=()=>signal.reason||new DOMException(SECRET,'AbortError');
    signal.addEventListener('abort',()=>{reject(bodyError());bodyWait?.reject(bodyError())},{once:true});
    time.set(()=>{
     if(signal.aborted)return;if(plan.error)return reject(plan.error);
     const consume=()=>new Promise((res,rej)=>{const deliver=()=>{if(signal.aborted)return rej(bodyError());if(plan.badJSON)return rej(new SyntaxError(SECRET));res({character:copy(plan.character||snapshot())})};bodyWait={reject:rej,deliver};if(ready)deliver()});
     resolve({ok:plan.status?plan.status<400:true,status:plan.status||200,json:consume});
     if(plan.body!==Infinity)time.set(()=>{ready=true;bodyWait?.deliver()},plan.body||0);
    },plan.headers||0);
   });
  }};
 vm.createContext(box);vm.runInContext(getter+inventory+';this.inspectInv=()=>({ready:INV_READY,net:INV_NET,retry:INV_RETRY,read:!!INV_READ,wait:INV_CLASS_WAIT});this.qty=invQty;',box);
 const f={box,time,queue,calls,logs,statuses,writes,publications,stored,reloads:()=>reloads,flushes:()=>flushCount,hero:x=>hero=x,ab:x=>ab=x,payment:x=>payment=x,payWriting:x=>payWriting=x,travel:x=>travel=x,hold:x=>hold=x,canAct:x=>canAct=x,
  flushResult:x=>flushResult=x,flushHook:x=>flushHook=x,storeFails:x=>storeFails=x,
  start(plan={}){queue.push(plan);return box.inventoryReady()},
  async read(plan={},ms=0){let done=false,value,error;f.start(plan).then(v=>{done=true;value=v},e=>{done=true;error=e});await time.tick(ms);assert.ok(done,'preflight must settle after request/recovery deadline');if(error)throw error;return value},
  async retryTime(){await time.tick(Math.max(0,(box.inspectInv().retry.at||0)-time.now()))},
  async firstTwo(){assert.equal(await f.read({body:Infinity},6000),false);await f.retryTime();assert.equal(await f.read({body:Infinity},25000),false);await f.retryTime()},
  async three(){await f.firstTwo();assert.equal(await f.read({body:Infinity},25000),false)}};
 return f;
}

test('three failed reads recover map after one minute while retaining the original 6s/25s budgets',async()=>{
 const f=fixture();await f.three();assert.deepEqual(f.calls.map(x=>x.ms),[6000,25000,25000]);assert.equal(f.reloads(),1);assert.equal(f.flushes(),1);
 assert.equal(f.box.inspectInv().ready,'');assert.equal(f.publications.length,0);assert.ok(f.stored['l2bot-inv-reload']);assert.match(JSON.stringify(f.logs),/сумк/i);
});
test('first failure and a successful slower retry keep the map and reset the failure series',async()=>{
 const f=fixture();assert.equal(await f.read({headers:Infinity},6000),false);assert.equal(f.reloads(),0);await f.retryTime();assert.equal(await f.read({body:14000},14000),true);
 assert.equal(f.reloads(),0);assert.equal(f.box.qty(1465),1000);assert.equal(f.box.inspectInv().retry.n,0);assert.deepEqual(f.calls.map(x=>x.ms),[6000,25000]);
});
test('three immediate HTTP failures do not reload before a full minute',async()=>{
 const f=fixture();for(let i=0;i<3;i++){assert.equal(await f.read({status:502}),false);await f.retryTime()}assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
test('concurrent readers share the same failed GET and only one recovery',async()=>{
 const f=fixture();await f.firstTwo();f.queue.push({body:Infinity});const a=f.box.inventoryReady(),b=f.box.inventoryReady();await f.time.tick(25000);assert.deepEqual(await Promise.all([a,b]),[false,false]);assert.equal(f.calls.length,3);assert.equal(f.reloads(),1);
});
test('reload cooldown survives a new document and permits recovery again after five minutes',async()=>{
 const first=fixture();await first.three();assert.equal(first.reloads(),1);
 const next=fixture({stored:first.stored,now:first.time.now()});await next.three();assert.equal(next.reloads(),0);assert.equal(next.flushes(),0);
 await next.time.tick(300001);await next.retryTime();assert.equal(await next.read({body:Infinity},25000),false);assert.equal(next.reloads(),1);
});
for(const page of ['/battle.html','/fishing.html','/town-buffer.html','/map.html.other'])test('inventory recovery never reloads '+page,async()=>{
 const f=fixture({page});await f.three();assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
for(const [name,change]of[
 ['Stop',f=>f.box.on=false],['owner',f=>f.box.tabOwner=false],['lease',f=>f.box.leaseEpoch='two'],['actor',f=>f.box.rt.char='Other'],['HUD',f=>f.hero('Other')],
 ['class',f=>f.box.rt.classCur={prof:'human_warlock',slot:0}],['new Start',f=>f.box.rt.manualKickAt++],['generation',f=>f.box.automationGeneration++]
])test('a third reply from before '+name+' cannot recover or publish',async()=>{
 const f=fixture();await f.firstTwo();const p=f.start({body:14000});await f.time.tick(1000);change(f);await f.time.tick(13000);assert.equal(await p,false);assert.equal(f.reloads(),0);assert.equal(f.publications.length,0);
});
test('changing the selected mode during a failed GET cancels that old recovery even without a generation bump',async()=>{
 const f=fixture();await f.firstTwo();const p=f.start({body:Infinity});await f.time.tick(1000);f.box.cfg.task='fish';await f.time.tick(24000);assert.equal(await p,false);assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
for(const [name,change]of[['new Start',f=>f.box.rt.manualKickAt++],['generation',f=>f.box.automationGeneration++],['mode',f=>f.box.cfg.task='fish']])test(name+' starts a fresh 6s read and failure series despite the previous run backoff',async()=>{
 const f=fixture();await f.firstTwo();assert.equal(await f.read({body:Infinity},25000),false);assert.equal(f.reloads(),1);const before=f.time.now();change(f);
 assert.equal(await f.read({body:Infinity},6000),false);const retry=f.box.inspectInv().retry;assert.equal(f.calls.at(-1).ms,6000);assert.equal(retry.n,1);assert.equal(retry.since,before);assert.equal(retry.at-f.time.now(),2000);assert.equal(f.reloads(),1);
});
for(const [name,change]of[
 ['captcha',f=>f.ab({active:true})],['payment',f=>f.payment({id:'pending'})],['payment write',f=>f.payWriting(true)],['travel',f=>f.travel(true)],['cast receipt',f=>f.box.rt.fishCastPending={id:'pending'}],
 ['revival',f=>f.box.rt.revive=true],['PvE block',f=>f.box.rt.pveBlockUntil=f.time.now()+100000],['TvT hold',f=>{f.box.cfg.tvtOn=true;f.hold(true)}],['action hold',f=>f.canAct(false)]
])test('recovery respects '+name+' appearing before the failed GET finishes',async()=>{
 const f=fixture();await f.firstTwo();const p=f.start({body:Infinity});await f.time.tick(1000);change(f);await f.time.tick(24000);assert.equal(await p,false);assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
for(const [name,change]of[
 ['Stop',f=>f.box.on=false],['owner',f=>f.box.tabOwner=false],['lease',f=>f.box.leaseEpoch='two'],['actor',f=>f.box.rt.char='Other'],['HUD',f=>f.hero('Other')],
 ['class',f=>f.box.rt.classCur={prof:'human_warlock',slot:0}],['Start',f=>f.box.rt.manualKickAt++],['generation',f=>f.box.automationGeneration++],['mode',f=>f.box.cfg.task='fish'],
 ['captcha',f=>f.ab({active:true})],['payment',f=>f.payment({id:'pending'})],['payment write',f=>f.payWriting(true)],['travel',f=>f.travel(true)],['cast receipt',f=>f.box.rt.fishCastPending={id:'pending'}],['action hold',f=>f.canAct(false)],['manual task',f=>f.box.cfg.taskOnly=true]
])test('after recovery flush, '+name+' is checked again before reload',async()=>{
 const f=fixture();await f.firstTwo();f.flushHook(async()=>change(f));assert.equal(await f.read({body:Infinity},25000),false);assert.equal(f.flushes(),1,'recovery reached the actual flush guard');assert.equal(f.reloads(),0);
});
test('a failed state flush cannot reload or claim recovery',async()=>{
 const f=fixture();f.flushResult(false);await f.three();assert.equal(f.flushes(),1);assert.equal(f.reloads(),0);assert.equal(f.stored['l2bot-inv-reload'],undefined);
});
test('a failed sessionStorage cooldown write cannot trigger repeated page reloads',async()=>{
 const f=fixture();f.storeFails(true);await f.three();assert.equal(f.reloads(),0);assert.equal(f.stored['l2bot-inv-reload'],undefined);
});
test('an unparseable reload marker prevents an uncontrolled reload loop',async()=>{
 const f=fixture({stored:{'l2bot-inv-reload':'malformed'}});await f.three();assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
test('recovery requires a nonempty owned lease',async()=>{
 const f=fixture();f.box.leaseEpoch=null;await f.three();assert.equal(f.reloads(),0);assert.equal(f.flushes(),0);
});
test('a valid newer inventory while flushing cancels an unnecessary page recovery',async()=>{
 const f=fixture();await f.firstTwo();let release;f.flushHook(()=>new Promise(resolve=>release=resolve));const third=f.start({body:Infinity});await f.time.tick(25000);assert.equal(typeof release,'function');
 f.queue.push({});const fresh=f.box.invRefresh();await f.time.tick(0);assert.ok(await fresh);release();await f.time.flush();assert.equal(await third,false);assert.equal(f.flushes(),1);assert.equal(f.reloads(),0);assert.equal(f.box.qty(1465),1000);
});
for(const [name,inject]of[
 ['pending class ACK','INV_CLASS_WAIT={char:rt.char,prof:rt.classCur.prof,slot:rt.classCur.slot,revision:100};'],
 ['conflicting durable class proof',"rt.invClassProof={char:rt.char,prof:'human_warlock',slot:0,revision:100};"]
])test('a hooked inventory cannot suppress recovery while '+name+' still blocks preflight',async()=>{
 const f=fixture();await f.firstTwo();vm.runInContext(inject+'INV_READY=invContext();INV_NET={char:rt.char,t:Date.now(),m:{1465:1000}};',f.box);
 assert.equal(await f.read({body:Infinity},25000),false);assert.equal(f.reloads(),1);assert.equal(f.flushes(),1,'unconfirmed class is not a healthy preflight');
});
for(const [name,plan]of[
 ['HTTP 502',{status:502}],['invalid JSON',{badJSON:true}],['network exception',{error:new TypeError(SECRET)}],['body timeout',{body:Infinity}],['wrong hero',{character:snapshot({name:'Other'})}],
 ['missing inventory',{character:snapshot({inventory:{eq:{}}})}]
])test('sanitized failure diagnostics distinguish '+name+' without exception text or bodies',async()=>{
 const f=fixture();assert.equal(await f.read(plan,name==='body timeout'?6000:0),false);const printed=JSON.stringify([f.logs,f.statuses]);assert.ok(f.logs.length,'failed owned preflight has a diagnostic event');assert.ok(!printed.includes(SECRET));
 if(name==='HTTP 502')assert.match(printed,/502/);if(name==='body timeout')assert.match(printed,/тайм|timeout|врем/i);
});
test('direct inventory diagnostics identify successful, JSON and durable proof phases',async()=>{
 const f=fixture(),details=[];f.queue.push({});const p=f.box.invRefresh(undefined,6000,d=>details.push(copy(d)));await f.time.tick(0);assert.ok(await p);assert.equal(details.length,1);assert.equal(details[0].reason,'ok');
 f.queue.push({badJSON:true});const bad=f.box.invRefresh(undefined,6000,d=>details.push(copy(d)));await f.time.tick(0);assert.equal(await bad,null);assert.equal(details.length,2);assert.notEqual(details[1].reason,'ok');assert.ok(details[1].phase);assert.ok(!JSON.stringify(details).includes(SECRET));
 f.box.setRt=async()=>({ok:false});f.queue.push({});const ack=f.box.invRefresh(undefined,6000,d=>details.push(copy(d)));await f.time.tick(0);assert.equal(await ack,null);assert.equal(details.length,3);assert.ok(details[2].phase);assert.notEqual(details[2].reason,'ok');assert.notEqual(details[2].phase,details[1].phase);
});
