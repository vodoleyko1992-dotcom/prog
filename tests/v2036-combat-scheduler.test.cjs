'use strict';
// 20.36: настоящий act() — следующий ход после своего ACK и дедлайна, без искусственной реакции.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../modules/combat.js'),'utf8');
const actSource=source.slice(source.indexOf('  let lastHpPot = 0, lastMpPot = 0'),source.indexOf('  const t0 = Date.now();\n  let progSig'));
function fixture(opt={}){
 let now=1000000,rid=10,won=false,busyUntil=0,globalUntil=0,skillUntil=0,mp=500,owner='hero/class/lease',ready=true;
 const events=[],fired=[],receipts=new Map(),learned=[],pauses=[];
 const net={start:1,done:1,doneT:now-10000,startRid:9,startOwner:owner,ok:true,action:'whirlwind'};
 const b={title:'Вихор',mp:49},ctx={pet:null,block:{},seq:[]};
 const at=(ms,fn)=>events.push({t:now+ms,fn});
 function advance(to){events.sort((a,b)=>a.t-b.t);while(events.length&&events[0].t<=to){const e=events.shift();now=e.t;e.fn();events.sort((a,b)=>a.t-b.t);}now=to;}
 async function wait(fn,ms){const end=now+ms;for(let i=0;i<1000;i++){const v=fn();if(v)return v;if(now>=end)return null;const next=Math.min(end,...events.map(e=>e.t));advance(next);}throw Error('wait spin');}
 const env={cfg:{nDrain:''},names:()=>[],rt:{char:'Hero',classCur:{prof:'human_warlord',slot:0}},on:true,tabOwner:true,isBattle:()=>true,canAct:()=>true,evidenceOwner:()=>owner,battleExitContext:()=>owner,routeLocation:{href:'/battle.html?spawnId=one'},
  sleep:async ms=>advance(now+ms),combatPulse:async ms=>advance(Math.min(now+ms,...events.map(e=>e.t))),combatWait:wait,waitFor:wait,
  gameBusy:()=>({busy:now<busyUntil,end:busyUntil&&now>=busyUntil?busyUntil:0}),
  combatCooldown:{globalWait:()=>Math.max(0,globalUntil-now),skillWait:()=>Math.max(0,skillUntil-now),skillKnown:()=>!!opt.knownSkill,recentlyGlobalRejected:()=>!!opt.globalReject},
  slotAction:()=> 'whirlwind',cdSpawn:()=> 'one',battleSpawn:()=> 'one',observeSlot:()=>{},actNet:()=>net,actReceipt:id=>receipts.get(id),skKey:()=> 'whirlwind',
  fire(){fired.push(now);const request=++rid;net.start++;net.startRid=request;net.startOwner=owner;
   if(opt.onFire)opt.onFire(f,request);else f.ack(request,opt.ackMs??120);return true;},
  setStatus:()=>{},setRt:async()=>{},slotCd:()=>({}),meMp:()=>({cur:mp,max:500}),petState:()=>null,pause:async()=>{pauses.push(now);advance(now+300)},rnd:a=>a,rec:()=>{},TAG:'test',cleanTitle:s=>s,memLeft:()=>opt.memLeft||0,FORCE_NEED:/x^/,UNAVAIL:/x^/,CD_RE:/x^/
 };
 const box={console:{info:()=>{}},Date:{now:()=>now},Math,Map,env,ctx,LOCK_A:[60,500,120],LOCK_B:[30,200,50],NOMP_MS:1500,lostUntil:new Map(),mpUntil:new Map(),oreKind:()=>null,pressAt:new Map(),
  victory:()=>won,defeat:()=>false,affordable:(b,m)=>m.cur>=b.mp,healSlot:()=>false,noticeText:()=>'',uiReady:()=>ready,mobHp:()=>({cur:won?0:1000}),rememberCd:async(b,why)=>learned.push(why),slotsBy:()=>[],drainBackoff:()=>{}};
 vm.runInNewContext(actSource+'\nthis.act=act;',box);
 const f={env,ctx,box,b,net,fired,receipts,learned,pauses,at,now:()=>now,advance:ms=>advance(now+ms),setMp:v=>mp=v,setOwner:v=>owner=v,setWon:v=>won=v,setBusy:ms=>busyUntil=now+ms,setGlobal:ms=>globalUntil=now+ms,setSkill:ms=>skillUntil=now+ms,setReady:v=>ready=v,
  ack(id,ms=0,extra={}){const receiptOwner=owner;at(ms,()=>{net.done++;net.doneT=now;net.ok=extra.ok!==false;net.action=extra.action??'whirlwind';receipts.set(id,{rid:id,t:now,owner:receiptOwner,action:'whirlwind',ok:true,...extra});if(extra.ok!==false)ready=false;});},
  act:(needed=null)=>box.act(b,'AoE',false,needed)};
 return f;
}
test('свой ACK завершает действие за120мс, без300мс реакции',async()=>{const f=fixture();assert.equal(await f.act(),true);assert.equal(f.now()-f.fired[0],120);assert.equal(f.pauses.length,0);assert.deepEqual(f.learned,['used']);});
test('следующий ход ждёт GET игры и запас B, даже после быстрого ACK',async()=>{const f=fixture();await f.act();const reply=f.now();f.setBusy(400);f.setReady(true);assert.equal(await f.act(),true);assert.ok(f.fired[1]>=reply+450);assert.equal(f.fired.length,2);});
test('общий дедлайн не удлиняется лишними60мс',async()=>{const f=fixture();const start=f.now();f.setGlobal(740);assert.equal(await f.act(),true);assert.equal(f.fired[0]-start,740);});
test('изменившийся план прерывает ожидание КД на событии',async()=>{const f=fixture();f.setGlobal(900);let needed=true;f.at(100,()=>needed=false);assert.equal(await f.act(()=>needed),'lock');assert.equal(f.now(),1000100);assert.equal(f.fired.length,0);});
for(const kind of ['global','skill'])test('новый '+kind+' КД во время gameFree запрещает устаревший клик',async()=>{const f=fixture();f.setBusy(200);f.at(100,()=>kind==='global'?f.setGlobal(500):f.setSkill(500));assert.equal(await f.act(),'lock');assert.equal(f.fired.length,0);});
test('цель изменилась во время GET: клик отменён',async()=>{const f=fixture();f.setBusy(200);let target='old';f.at(80,()=>target='new');assert.equal(await f.act(()=>target==='old'),'lock');assert.equal(f.fired.length,0);});
test('MP упал во время GET: nomp без клика и без lostUntil',async()=>{const f=fixture();f.setBusy(200);f.at(80,()=>f.setMp(5));assert.equal(await f.act(),'nomp');assert.equal(f.fired.length,0);assert.equal(f.box.lostUntil.size,0);assert.ok(f.box.mpUntil.get('whirlwind')>f.now());});
for(const change of ['owner','class','route','restart','lease','stop','pvp','canAct'])test(change+' во время ожидания отменяет клик',async()=>{const f=fixture();f.setGlobal(900);f.at(80,()=>{if(change==='owner'||change==='lease')f.setOwner(change);if(change==='class')f.env.rt.classCur.slot++;if(change==='route')f.env.routeLocation.href='/map.html';if(change==='restart')f.env.rt.manualKickAt=1;if(change==='stop')f.env.on=false;if(change==='pvp')f.env.pvpPending=()=>true;if(change==='canAct')f.env.canAct=()=>false;});assert.equal(await f.act(),false);assert.equal(f.fired.length,0);});
test('победный ACK учитывается как успешный удар без повторов',async()=>{const f=fixture({onFire(f,id){f.ack(id,120);f.at(120,()=>f.setWon(true));}});assert.equal(await f.act(),true);assert.deepEqual(f.learned,['used']);assert.equal(f.pauses.length,0);assert.equal(await f.act(),false);assert.equal(f.fired.length,1);});
for(const problem of ['wrong-action','wrong-owner','no-rid','two-starts'])test(problem+' не включает ускорение по чужому подтверждению',async()=>{const f=fixture({onFire(f,id){if(problem==='no-rid'){delete f.net.startRid;f.env.actReceipt=undefined;}if(problem==='two-starts'){f.net.start++;f.net.startRid=id+1;f.ack(id+1,120);}else f.ack(id,120,problem==='wrong-action'?{action:'attack'}:problem==='wrong-owner'?{owner:'Other'}:{});}});await f.act();assert.equal(f.pauses.length,1);});
test('поздний старый ACK не завершает новое действие',async()=>{const f=fixture({onFire(f,id){f.ack(id-1,20);f.ack(id,170);}});assert.equal(await f.act(),true);assert.equal(f.now()-f.fired[0],170);assert.equal(f.pauses.length,0);});
test('таймаут6с не разрешает второй запрос до ответа на7с',async()=>{const f=fixture({ackMs:7000});assert.equal(await f.act(),'lock');assert.equal(f.fired.length,1);assert.equal(await f.act(),'lock');assert.equal(f.fired.length,2);assert.ok(f.fired[1]>=1007000+120);});
test('контекст сменился между выбором и входом в act: старый бой не принимает нового владельца',async()=>{const f=fixture();f.setOwner('other-class');assert.equal(await f.act(),false);assert.equal(f.fired.length,0);});
for(const kind of ['global','skill'])test('точный '+kind+' отказ не создаёт дополнительный личный КД',async()=>{const f=fixture({knownSkill:kind==='skill',globalReject:kind==='global',memLeft:9,onFire(f,id){f.ack(id,50,{ok:false,code:'battle_cooldown',blockedBy:kind});}});assert.equal(await f.act(),'cd');assert.equal(f.box.lostUntil.size,0);assert.equal(f.pauses.length,0);assert.deepEqual(f.learned,kind==='skill'?['cd']:[]);});
test('известный MP-отказ держит слот отдельно от потери клика, без паузы реакции',async()=>{const f=fixture({onFire(f,id){f.ack(id,50,{ok:false,code:'not_enough_mp'});}});assert.equal(await f.act(),'nomp');assert.equal(f.box.lostUntil.size,0);assert.equal(f.box.mpUntil.get('whirlwind').server,true);assert.equal(f.pauses.length,0);});
test('явный отказ оружия сразу возвращает unavail для нового выбора',async()=>{const f=fixture({onFire(f,id){f.ack(id,50,{ok:false,code:'wrong_weapon'});}});assert.equal(await f.act(),'unavail');assert.equal(f.pauses.length,0);assert.equal(f.now()-f.fired[0],50);});
for(const code of ['champion_immune','target_empty'])test(code+' не распознаётся как MP-отказ',async()=>{const f=fixture({onFire(f,id){f.ack(id,50,{ok:false,code});}});assert.equal(await f.act(),false);assert.equal(f.box.mpUntil.size,0);});
