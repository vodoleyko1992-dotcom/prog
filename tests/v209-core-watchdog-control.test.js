'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../background.js','utf8'),core=require('../engine-core.js');
const clone=x=>structuredClone(x),defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(options={}){
 let now=Date.UTC(2026,9,17),listener,hotkey,probeCount=0,setHook,getHook,url='https://l2wap.com/map.html';
 const old={tab:1,t:now-180000,page:'/map.html'},reloads=[],updates=[],warnings=[];
 const state={on:true,hbBg:old,lock:{k:'tab1',tab:1,epoch:'one',t:now},rt:{char:'Hero',manualKickAt:1},cfg:{},wdog:[],wdDown:null,...clone(options.state||{})};
 const gate=options.probe||{promise:Promise.resolve('up')};
 const local={get:async keys=>{const snapshot=Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,clone(state[k])])) ;await getHook?.(keys,snapshot);return snapshot},
  set:async patch=>{await setHook?.(patch);Object.assign(state,clone(patch))}};
 const box={URL,Date:class extends Date{static now(){return now}},console:{warn:(...a)=>warnings.push(a)},L2EngineCore:core,crypto:{randomUUID:()=> 'lease'},
  hbMem:clone(old),hbPersistedAt:0,watchdogRunning:false,buf:[],flush(){},paint(){},
  chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local},commands:{onCommand:{addListener:f=>{hotkey=f}}},
   alarms:{onAlarm:{addListener:f=>{listener=f}}},tabs:{get:async id=>({id,url}),reload:async id=>reloads.push(id),update:async(id,p)=>updates.push([id,clone(p)])}},
  srvProbe:async()=>{probeCount++;return gate.promise}};
 vm.createContext(box);
 vm.runInContext(src.slice(src.indexOf('const LOCK_TTL ='),src.indexOf('async function lockCommand(')),box);
 vm.runInContext(src.slice(src.indexOf('async function botControl('),src.indexOf('async function switchCharacter(')),box);
 // 20.41 (лог 20.10 21:09: память 1,3 МБ): слушателя storage.onChanged в фоне нет — Start/Stop сами зовут afterOnWrite после записи «on»;
 // Start здесь — горячая клавиша при остановленном боте (настоящий переход off→on, как прежнее событие хранилища)
 vm.runInContext(src.slice(src.indexOf('let paintedOn = null;'),src.indexOf("chrome.storage.local.get('on').then(s => paintOn")),box);
 vm.runInContext(src.slice(src.indexOf('chrome.commands?.onCommand.addListener('),src.indexOf('// ===== журнал и снимки')),box);
 vm.runInContext(src.slice(src.indexOf('function wdPlan('),src.indexOf('async function srvProbe(')),box);
 vm.runInContext(src.slice(src.indexOf('chrome.alarms?.onAlarm.addListener('),src.indexOf('// Release immediately when')),box);
 const popup={id:'test',url:'chrome-extension://test/popup.html'},game={id:'test',frameId:0,url:'https://l2wap.com/map.html',tab:{id:1}};
 return{state,box,reloads,updates,warnings,gate,tick:()=>listener({name:'l2watch'}),probes:()=>probeCount,
  onGet:f=>{getHook=f},onSet:f=>{setHook=f},url:v=>{url=v},advance:n=>{now+=n},
  control:(m={},sender=popup)=>box.botControl({action:'stop',source:'test',reason:'Стоп',...m},sender),game,
  start:()=>{state.on=false;return hotkey('toggle-bot')},drain:()=>box.serializeLock(async()=>{})};
}
for(const change of ['stop','lease','heartbeat','character','task','navigation'])test('probe не держит очередь, '+change+' отменяет восстановление',async()=>{
 const gate=defer(),f=fixture({probe:gate}),work=f.tick();await tick();assert.equal(f.probes(),1);
 await f.box.serializeLock(async()=>{
  if(change==='stop')f.state.on=false;
  if(change==='lease')f.state.lock.epoch='two';
  if(change==='heartbeat')f.state.hbBg={tab:1,t:Date.now()+100000,page:'/battle.html'};
  if(change==='character')f.state.rt.char='Other';
  if(change==='task')f.state.rt.manualKickAt=2;
  if(change==='navigation')f.url('https://l2wap.com/battle.html?spawnId=new');
 });
 gate.resolve('up');await work;assert.deepEqual(f.reloads,[]);assert.deepEqual(f.updates,[]);assert.equal(f.state.stopMeta,undefined);
});
test('Stop, пришедший во время записи сторожа, отменяет ещё не отправленный reload',async()=>{
 const f=fixture(),gate=defer(),entered=defer();let once=true;
 f.onSet(async p=>{if(p.wdog&&once){once=false;entered.resolve();await gate.promise}});
 const work=f.tick();await entered.promise;const stop=f.control();gate.resolve();await Promise.all([work,stop]);
 assert.equal(f.state.on,false);assert.equal(f.state.stopMeta.reason,'Стоп');assert.deepEqual(f.reloads,[]);
});
test('неудачная запись сторожа не рисует успешный heartbeat и допускает повтор',async()=>{
 const f=fixture(),old=clone(f.box.hbMem);let fail=true;
 f.onSet(p=>{if(p.wdog&&fail){fail=false;throw Error('storage down')}});
 await f.tick();assert.deepEqual(f.box.hbMem,old);assert.deepEqual(f.reloads,[]);
 await f.tick();assert.deepEqual(f.reloads,[1]);assert.equal(f.state.wdog.length,1);
});
test('одновременные alarm не выполняют два probe и два восстановления',async()=>{
 const gate=defer(),f=fixture({probe:gate});const a=f.tick();await tick();const b=f.tick();gate.resolve('up');await Promise.all([a,b]);
 assert.equal(f.probes(),1);assert.deepEqual(f.reloads,[1]);
});
for(const fish of [true,false])test('сторож использует выбранные задачи вместо старого fishMode: '+fish,async()=>{
 const now=Date.UTC(2026,9,17),f=fixture({state:{cfg:{autoTasks:fish?['fish']:['auto'],fishMode:!fish},wdog:[now-360000,now-420000,now-480000]}});
 await f.tick();assert.equal(f.state.on,fish);
 if(fish){assert.deepEqual(f.updates,[[1,{url:'https://l2wap.com/fishing.html'}]]);assert.equal(f.state.wdog.length,4)}
 else {assert.deepEqual(f.updates,[]);assert.equal(f.state.stopMeta.source,'watchdog')}
});
test('лимит/цель рыбалки не возвращают выбранный автофарм в fishing',async()=>{
 const now=Date.UTC(2026,9,17),f=fixture({state:{cfg:{autoTasks:['fish','auto'],fishMode:true},rt:{char:'Hero',manualKickAt:1,fishTgt:{done:true}},wdog:[now-360000,now-420000,now-480000]}});
 await f.tick();assert.equal(f.state.on,false);assert.deepEqual(f.updates,[]);
});
test('старт с задержанным чтением не откатывает более свежий heartbeat',async()=>{
 const f=fixture(),gate=defer(),entered=defer();let first=true;
 f.onGet(async keys=>{if(first&&keys.includes('hbBg')){first=false;entered.resolve();await gate.promise}});
 f.start();await entered.promise;const hb=f.box.serializeLock(async()=>{f.box.hbMem={tab:1,t:Date.UTC(2026,9,17)+1000,page:'/battle.html'};await f.box.chrome.storage.local.set({hbBg:f.box.hbMem})});
 gate.resolve();await hb;await f.drain();assert.equal(f.state.hbBg.page,'/battle.html');
});
for(const action of ['stop','pause'])test('ручная '+action+' доступна с ошибочной конфигурацией и неизвестной оплатой',async()=>{
 const f=fixture({state:{cfg:{limitRanges:{bad:{min:-1,max:0}}},rt:{char:'Hero',manualKickAt:1,actionPayments:{pending:{kind:'shop'}}}}});
 assert.equal((await f.control({action})).ok,true);assert.equal(f.state.on,false);assert.equal(!!f.state.paused,action==='pause');assert.equal(f.state.rt.actionPayments.pending.kind,'shop');
});
for(const bad of ['epoch','char','kick','subframe','host'])test('запоздалая автоматическая остановка: '+bad+' отвергается',async()=>{
 const f=fixture(),sender=clone(f.game),m={char:'Hero',epoch:'one',kick:1};
 if(bad==='epoch')m.epoch='old';if(bad==='char')m.char='Other';if(bad==='kick')m.kick=0;if(bad==='subframe')sender.frameId=1;if(bad==='host')sender.url='https://l2wap.com.example/map.html';
 assert.equal((await f.control(m,sender)).ok,false);assert.equal(f.state.on,true);
});
test('действующий владелец может поставить паузу, не стирая состояние задачи',async()=>{
 const f=fixture();assert.equal((await f.control({action:'pause',char:'Hero',epoch:'one',kick:1},f.game)).ok,true);
 assert.equal(f.state.on,false);assert.equal(f.state.paused.why,'Стоп');assert.equal(f.state.rt.manualKickAt,1);
});
test('домен с похожим именем не опрашивается и не перезагружается',async()=>{
 const f=fixture();f.url('https://l2wap.com.example/map.html');await f.tick();assert.equal(f.probes(),0);assert.deepEqual(f.reloads,[]);
});
