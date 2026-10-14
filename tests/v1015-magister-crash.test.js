'use strict';
// 14.10: память вкладки и подтверждённое хранилище разделены. Crash теряет sent, уже отправленный POST остаётся у сервера.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const content=fs.readFileSync(process.env.L2_MAGISTER_CONTENT||path.join(__dirname,'../content.js'),'utf8');
const a=content.indexOf('const MAG_SKIP_DEF ='),source=content.slice(a,content.indexOf('// ---------- выбило из игры:',a));
const clone=x=>JSON.parse(JSON.stringify(x));
function crashFixture({max=1}={}){
 let now=1000000,nextPage=0;
 const server={revision:10,rank:0,sp:1000,max,visibleRank:null,paid:0},requests=[];
 const key='0:human_warlock';
 let disk={char:'hero',lvl:75,classCur:{prof:'human_warlock',slot:0},magEnabled:true,
  magister:{t:now,char:'hero',key,prof:'human_warlock',slot:0,lvl:75,kick:0,home:{mode:'auto'}}};
 let dropSent=true,onRequest=null;
 function settle(q){
  if(q.done)return q.response;
  // Серверный контракт expectedRevision: проверка и рост revision — одна атомарная мутация.
  const ok=q.body.expectedRevision===server.revision && server.rank<server.max && server.sp>=100;
  q.response={ok,status:ok?200:409};q.done=true;
  if(ok){server.revision++;server.rank++;server.sp-=100;server.paid++;}
  q.resolve(q.response);return q.response;
 }
 function page(){
  const id=++nextPage,ctx={console,URLSearchParams,Date:{now:()=>now},on:true,tabOwner:true,cfg:{autoMagister:true},rt:clone(disk),
   location:{pathname:'/magister.html',search:'?npcId=30344',href:''},heroNick:()=>ctx.rt.char,heroLevel:()=>75,
   autonomyMode:()=> 'auto',fishNow:()=>false,isBattle:()=>false,victory:()=>false,abHold:()=>false,antibotState:()=>null,
   names:s=>String(s).toLowerCase().split(',').map(x=>x.trim()),ilOf:()=>({}),petState:()=>null,rec(){},setStatus(){},
   L2V7Modules:{story:{charNote(){}},subclass:{charNote(){}},tvt:{tvtHold:()=>false}},
   setRt:p=>{Object.assign(ctx.rt,p);if(dropSent&&p.magPending?.[key]?.phase==='sent')return Promise.resolve({ok:false,reason:'write_pending'});
    Object.assign(disk,clone(p));return Promise.resolve({ok:true})},rtCommit:async()=>true,
   gameGet:async url=>({ok:true,status:200,json:async()=>url==='/character'?{character:{name:'hero',level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},revision:server.revision}}
    :{npc:{npcId:30344},profession:{l2Profession:'human_warlock'},characterSp:server.sp,skills:[{battleId:'l2_123',nameUk:'Blaze',minLevel:1,spCost:100,skillLevel:server.visibleRank??server.rank,maxSkillLevel:server.max,canLearn:true}]}}),
   gamePost:(url,body)=>new Promise(resolve=>{const q={id,url,body:clone(body),resolve};requests.push(q);if(onRequest)onRequest(q);else if(id>1)settle(q)})};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,step:()=>ctx.magisterStep(),start:()=>ctx.magisterStart(),crash(){ctx.on=false;ctx.tabOwner=false}};
 }
 async function original(){const p=page();const running=p.step();for(let i=0;i<60&&!requests.length;i++)await Promise.resolve();
  assert.equal(requests.length,1,'первый POST действительно начат');assert.equal(disk.magPending[key].phase,'prepared');assert.equal(p.ctx.rt.magPending[key].phase,'sent');
  p.crash();return {p,running,q:requests[0]};}
 return {server,requests,page,original,settle,key,disk:()=>disk,tick:n=>now+=n,handler:f=>onRequest=f,flushSent:()=>dropSent=false};
}
test('crash after send loses sent write: prepared on disk is ambiguous, not permission for an immediate new POST',async()=>{
 const f=crashFixture(),old=await f.original(),fresh=f.page();await fresh.step();
 assert.equal(f.requests.length,1);assert.equal(f.server.paid,0);assert.ok(f.disk().magPending[f.key]);
 f.settle(old.q);await old.running;
});
test('accepted original with delayed rank visibility cannot spend again using newer revision',async()=>{
 const f=crashFixture({max:2}),old=await f.original();f.settle(old.q);await old.running;f.server.visibleRank=0;
 const fresh=f.page();await fresh.step();assert.equal(f.requests.length,1);assert.equal(f.server.sp,900);assert.ok(f.disk().magPending[f.key]);
});
test('crash before send also leaves ambiguous intent; unchanged revision is retried with original CAS after bounded delay',async()=>{
 const f=crashFixture(),p=f.page(),set=p.ctx.setRt;p.ctx.setRt=async patch=>{const result=await set(patch);if(patch.magPending?.[f.key]?.phase==='prepared')p.crash();return result};
 await p.step();assert.equal(f.requests.length,0);const fresh=f.page();await fresh.step();assert.equal(f.requests.length,0);
 f.tick(61000);await fresh.start();await fresh.step();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.expectedRevision,10);assert.equal(f.server.paid,1);
});
for(const order of ['original-first','retry-first'])test('concurrent original/retry '+order+': same expectedRevision spends exactly once',async()=>{
 const f=crashFixture(),old=await f.original();f.tick(61000);
 f.handler(q=>{if(order==='original-first'){f.settle(old.q);f.settle(q)}else{f.settle(q);f.settle(old.q)}});
 const fresh=f.page();await fresh.step();await old.running;
 assert.deepEqual(f.requests.map(q=>q.body),[{battleId:'l2_123',expectedRevision:10},{battleId:'l2_123',expectedRevision:10}]);
 assert.equal(f.server.paid,1);assert.equal(f.server.rank,1);assert.equal(f.server.sp,900);
 if(order==='original-first')assert.ok(f.disk().magPending[f.key],'409 повторного запроса не доказывает отказ оригинала');
 f.tick(61000);await fresh.start();await fresh.step();assert.equal(f.requests.length,2);assert.equal(f.disk().magPending[f.key],undefined);
});
test('higher revision + unchanged rank/SP invalidates original; delayed original cannot pay after a fresh guarded learn',async()=>{
 const f=crashFixture(),old=await f.original();f.server.revision++;
 const fresh=f.page();await fresh.step();f.settle(old.q);await old.running;
 assert.deepEqual(f.requests.map(q=>q.body.expectedRevision),[10,11]);assert.equal(old.q.response.status,409);assert.equal(f.server.paid,1);
});
test('known-unsent exists only in the live instance and can resume without waiting for an impossible rank',async()=>{
 const f=crashFixture(),p=f.page(),set=p.ctx.setRt;let once=true;
 p.ctx.setRt=async patch=>{const result=await set(patch);if(once&&patch.magPending?.[f.key]?.phase==='prepared'){once=false;p.ctx.tabOwner=false}return result};
 await p.step();assert.equal(f.requests.length,0);p.ctx.tabOwner=true;f.handler(f.settle);await p.step();assert.equal(f.requests.length,1);assert.equal(f.server.paid,1);
});
test('ambiguous replay respects changed reserve and keeps original receipt',async()=>{
 const f=crashFixture(),old=await f.original();f.tick(61000);const fresh=f.page();fresh.ctx.cfg.magisterSpReserve=950;
 await fresh.step();assert.equal(f.requests.length,1);assert.ok(f.disk().magPending[f.key]);f.settle(old.q);await old.running;
});
