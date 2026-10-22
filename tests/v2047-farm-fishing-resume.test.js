'use strict';
// 20.47 (лог 22.10 16:44 → 17:47): забытый улов не держит автофарм, но дневной лимит проверяется сервером.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),src=read('content.js'),dailyData=require('./tools/daily-server-fixture.cjs');
function fixture(){
 const box={require:x=>x==='node:test'?()=>{}:require(x),__dirname,URL,URLSearchParams,Date,structuredClone,console};
 const base=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(base.slice(0,base.indexOf("for(const task of ['auto','cat'])")),box);
 const f=box.fixture(),c=f.c,d=dailyData(),requests=[],messages=[],statuses=[],logs=[];
 Object.assign(f.state.cfg,{autoKillLimit:0,catKillLimit:0,dailyKillLimit:36000,dailyFishLimit:1539,autoTasks:['auto','mammon','clan']});
 Object.assign(f.state.rt,{fishCastActive:true,fish:{t0:100,caught:153}});f.refresh();
 Object.assign(c,{automationGeneration:1,isBattle:()=>false,isFishing:()=>false,fishNow:()=>false,fishState:()=>null,victory:()=>false,heroNick:()=>c.rt.char,setStatus:s=>statuses.push(s),rec:(...a)=>logs.push(a)});
 c.location.pathname='/map.html';c.location.search='';
 c.autonomyMode=()=>{const task=c.L2EngineCore.selectedTask(c.cfg,c.rt);return task==='auto'?'farm':task==='quests'?'campaign':task||'farm'};
 c.automationSnapshot=()=>JSON.stringify([c.automationGeneration,c.leaseEpoch,c.rt.char,c.rt.manualKickAt,c.cfg.autoTasks,c.location.pathname,c.location.search]);
 c.automationCurrent=stamp=>c.on&&c.tabOwner&&stamp===c.automationSnapshot();
 c.setRt=async p=>{Object.assign(c.rt,p);Object.assign(f.state.rt,structuredClone(p));return {ok:true}};
 const ipc=c.ipc;c.ipc=m=>{messages.push(structuredClone(m));return ipc(m)};
 d.daily.tasks.hunt_start_500.score=1000;d.daily.tasks.fishing_catch_50.score=153;
 c.gameGet=async path=>{requests.push(path);return {ok:true,json:async()=>path==='/game/time'?d.clock:path==='/game/fishing/state'?{target:{type:'old_box',hp:813,maxHp:2000}}:d.daily}};
 c.gamePost=()=>assert.fail('сверка лимитов не должна отправлять POST');
 vm.runInNewContext('this.dailyServerCurrent=dailyServerCurrent;',c);
 return {...f,d,requests,messages,statuses,logs};
}
test('подтверждённый сохранённый улов вне рыбалки: дневная сверка идёт без очистки улова',async()=>{
 const f=fixture(),c=f.c;
 assert.equal(await c.dailyServerSync(),true);assert.equal(c.dailyServerCurrent(),false,'по умолчанию active по-прежнему держит сверку');
 assert.equal(await c.dailyWorkReady('mobs'),true);assert.equal(c.dailyServerCurrent(),true);
 assert.deepEqual(f.requests,['/game/fishing/state','/game/time','/game/daily-quests']);
 assert.equal(c.rt.fishCastActive,true);assert.equal(f.state.rt.fishCastActive,true);
 assert.equal(c.L2EngineCore.dailyCount(c.rt,'auto'),1000);assert.equal(c.L2EngineCore.dailyCount(c.rt,'fish'),153);
 assert.equal(f.messages.filter(m=>m.dailyServer).length,1);
});
test('вход в обычную карту после старой рыбалки разрешён только после серверного счёта',async()=>{
 const f=fixture(),c=f.c;let maps=0;
 c.L2V7Modules={mobfarm:{map:async()=>{maps++;assert.equal(c.dailyServerCurrent(),true)}}};
 vm.runInNewContext(src.slice(src.indexOf('async function map(...args)'),src.indexOf('// ---------- бой ----------')),c);
 await c.map();assert.equal(maps,1);assert.equal(c.rt.fishCastActive,true);
 assert.deepEqual(f.requests,['/game/fishing/state','/game/time','/game/daily-quests']);
});
test('сохранённая рыба не обходит уже достигнутый дневной лимит мобов',async()=>{
 const f=fixture(),c=f.c;f.d.daily.tasks.hunt_start_500.score=36000;
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(c.dailyServerCurrent(),true);
 assert.equal(c.L2EngineCore.dailyCount(c.rt,'auto'),36000);assert.equal(c.rt.fishCastActive,true);
 assert.deepEqual(f.requests,['/game/fishing/state','/game/time','/game/daily-quests']);
});
for(const task of ['auto','cat'])test(task+': новая добыча восстанавливается, забытый улов сохраняется',async()=>{
 const f=fixture(),c=f.c;c.cfg.autoTasks=[task];f.state.cfg.autoTasks=[task];
 assert.equal(await c.dailyWorkReady('mobs'),true);assert.equal(c.rt.fishCastActive,true);
 assert.equal(c.dailyServerCurrent(),true);assert.deepEqual(f.requests,['/game/fishing/state','/game/time','/game/daily-quests']);
 assert.equal(await c.dailyWorkReady('mobs'),true);assert.equal(f.requests.length,3,'готовая сверка используется повторно');
});
for(const kind of ['page','task','dom','cast-pending','payment-pending'])test('настоящая/неподтверждённая рыбалка по-прежнему держит сверку: '+kind,async()=>{
 const f=fixture(),c=f.c;
 if(kind==='page'){c.location.pathname='/fishing.html';c.isFishing=()=>true;}
 if(kind==='task'){c.cfg.autoTasks=['fish'];c.fishNow=()=>true;}
 if(kind==='dom')c.fishState=()=>({hp:813});
 if(kind==='cast-pending')c.rt.fishCastPending={at:1};
 if(kind==='payment-pending')c.rt.actionPayments={pending:{kind:'fishing'}};
 assert.equal(await c.dailyServerSync(),true);assert.equal(c.dailyServerCurrent(),false);
 assert.equal(c.rt.fishCastActive,true);assert.deepEqual(f.requests,[]);
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(c.dailyServerCurrent(),false);
 assert.equal(c.rt.fishCastActive,true);assert.equal(f.messages.filter(m=>m.dailyServer).length,0);
 assert.ok(f.requests.every(p=>p==='/game/fishing/state'),'живая рыбалка не открывает GET времени/дневных квот');
 assert.ok(f.requests.length<=1);
});
for(const change of ['stop','owner','hero','lease','kick','generation','task','page','cast-pending','payment-pending'])test('поздний серверный ответ не продолжает старый запуск: '+change,async()=>{
 const f=fixture(),c=f.c,get=c.gameGet;
 c.gameGet=async path=>{const r=await get(path);if(path==='/game/time'){
  if(change==='stop')c.on=false;if(change==='lease')c.leaseEpoch++;
  if(change==='owner')c.tabOwner=false;if(change==='hero')c.heroNick=()=> 'Other';
  if(change==='kick')c.rt.manualKickAt++;if(change==='generation')c.automationGeneration++;
  if(change==='task'){c.cfg.autoTasks=['fish'];c.fishNow=()=>true;}
  if(change==='page'){c.location.pathname='/fishing.html';c.isFishing=()=>true;}
  if(change==='cast-pending')c.rt.fishCastPending={at:Date.now()};
  if(change==='payment-pending')c.rt.actionPayments={pending:{kind:'fishing'}};
 }return r};
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(c.dailyServerCurrent(),false);
 assert.equal(c.rt.fishCastActive,true);assert.equal(f.messages.filter(m=>m.dailyServer).length,0);
});
for(const snapshot of [null,{}, {target:5}, {target:[]}])test('неизвестный/неполный рыболовный снимок не разрешает дневную сверку: '+JSON.stringify(snapshot),async()=>{
 const f=fixture(),c=f.c;c.gameGet=async path=>{f.requests.push(path);return {ok:true,json:async()=>snapshot}};
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(c.dailyServerCurrent(),false);
 assert.equal(await c.dailyWorkReady('mobs'),false,'повтор неполного снимка ждёт 15 с');
 assert.equal(c.rt.fishCastActive,true);assert.deepEqual(f.requests,['/game/fishing/state']);
});
for(const failure of ['HTTP','network'])test('ошибка GET рыбы не открывает квоты и не повторяется на каждом круге: '+failure,async()=>{
 const f=fixture(),c=f.c;c.gameGet=async path=>{f.requests.push(path);if(failure==='network')throw Error('offline');return {ok:false,status:503}};
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(await c.dailyWorkReady('mobs'),false);
 assert.equal(c.dailyServerCurrent(),false);assert.equal(c.rt.fishCastActive,true);
 assert.deepEqual(f.requests,['/game/fishing/state']);assert.equal(f.messages.filter(m=>m.dailyServer).length,0);
});
for(const failure of ['time','daily','malformed','storage'])test('неудача сверки закрывает новую охоту, не стирает улов: '+failure,async()=>{
 const f=fixture(),c=f.c,get=c.gameGet;
 if(failure==='storage')f.fail();
 if(failure==='malformed')f.d.daily.tasks.hunt_start_500.score=-1;
 c.gameGet=async path=>failure=== 'time'&&path==='/game/time'||failure==='daily'&&path==='/game/daily-quests'?{ok:false}:get(path);
 assert.equal(await c.dailyWorkReady('mobs'),false);assert.equal(c.dailyServerCurrent(),false);
 assert.equal(c.rt.fishCastActive,true);assert.equal(f.state.rt.fishCastActive,true);
});
test('после возобновления рыба добавляется ровно один раз к серверному счётчику',async()=>{
 const f=fixture(),c=f.c;
 assert.equal(await c.dailyWorkReady('mobs'),true);
 assert.equal(c.L2EngineCore.dailyCount(c.rt,'fish'),153);
 await c.setRt({fish:{t0:100,caught:154},fishCastActive:false});
 assert.equal(await c.dailyLimitFishSync(),true);assert.equal(c.L2EngineCore.dailyCount(c.rt,'fish'),154);
 assert.equal(await c.dailyLimitFishSync(),true);assert.equal(c.L2EngineCore.dailyCount(c.rt,'fish'),154);
 assert.equal(f.messages.filter(m=>m.dailyFish).length,1);
 assert.equal(c.L2EngineCore.dailyCount(c.rt,'auto'),1000);
});
