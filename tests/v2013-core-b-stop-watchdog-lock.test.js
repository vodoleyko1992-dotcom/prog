'use strict';
// 20.13 (ревизия 17.10, шаг 5, участок core-b): устойчивость остановки, сторожа и замка вкладки.
// F3 — Esc ×2 с любой вкладки игры и «жёсткий» стоп бота не отклоняются фоном из-за чужого epoch/нового kick;
// F4 — перезагрузка сторожа, после которой бот пульсировал ≥ 3 мин, не идёт в счётчик «3 за 20 мин → стоп»;
// F6 — неудачное продление своего же (протухшего) замка не стирает очередь записей: замок возвращается тем же документом.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..'),bg=fs.readFileSync(path.join(base,'background.js'),'utf8'),content=fs.readFileSync(path.join(base,'content.js'),'utf8');
const core=require('../engine-core.js'),clone=x=>structuredClone(x);
const slice=(src,a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return src.slice(i,j);};

function fixture(options={}){
 let now=Date.UTC(2026,9,17),listener;
 const old={tab:1,t:now-180000,page:'/map.html'},reloads=[];
 const state={on:true,hbBg:old,lock:{k:'tab1',tab:1,epoch:'one',t:now},rt:{char:'Hero',manualKickAt:1},cfg:{},wdog:[],wdDown:null,...clone(options.state||{})};
 const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,clone(state[k])])),set:async p=>{Object.assign(state,clone(p))}};
 const box={URL,Date:class extends Date{static now(){return now}},console:{warn(){}},L2EngineCore:core,crypto:{randomUUID:()=>'lease'},
  hbMem:clone(options.hb||old),hbPersistedAt:0,watchdogRunning:false,buf:[],flush(){},paint(){},noteAlive:async()=>{},
  chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local,onChanged:{addListener(){}}},
   alarms:{onAlarm:{addListener:f=>{listener=f}}},tabs:{get:async id=>({id,url:'https://l2wap.com/map.html'}),reload:async id=>reloads.push(id),update:async()=>{},sendMessage:async()=>{}}},
  srvProbe:async()=>'up'};
 vm.createContext(box);
 vm.runInContext(slice(bg,'const LOCK_TTL =','// A single process owns'),box);
 vm.runInContext(slice(bg,'async function botControl(','async function switchCharacter('),box);
 vm.runInContext(slice(bg,'function wdPlan(','async function srvProbe('),box);
 vm.runInContext(slice(bg,'chrome.alarms?.onAlarm.addListener(','// Release immediately when'),box);
 const tab=id=>({id:'test',frameId:0,url:'https://l2wap.com/map.html',tab:{id}});
 return{state,box,reloads,tick:()=>listener({name:'l2watch'}),tab,advance:n=>{now+=n},
  control:(m,sender)=>box.botControl({action:'stop',source:'test',reason:'Стоп',...m},sender)};
}

// --- F3
test('F3: Esc ×2 во второй вкладке (без замка) останавливает бота, работающего в первой',async()=>{
 const f=fixture();
 const r=await f.control({user:true,char:'Hero',epoch:null,kick:1,reason:'Остановлено (Esc ×2)'},f.tab(2));
 assert.equal(r.ok,true);assert.equal(f.state.on,false);assert.equal(f.state.stopMeta.source,'content-user');
});
test('F3: обычная автоматическая остановка из чужой вкладки по-прежнему отклоняется',async()=>{
 const f=fixture();assert.equal((await f.control({char:'Hero',epoch:'x',kick:1},f.tab(2))).ok,false);assert.equal(f.state.on,true);
});
test('F3: Esc ×2 — только остановка: user-пауза из вкладки без замка не проходит',async()=>{
 const f=fixture();assert.equal((await f.control({action:'pause',user:true,char:'Hero',epoch:null,kick:1},f.tab(2))).ok,false);assert.equal(f.state.on,true);
});
test('F3: жёсткий стоп бота при новом manualKickAt и протухшем замке принимается',async()=>{
 const f=fixture({state:{rt:{char:'Hero',manualKickAt:5}}});f.state.lock.t-=120000;
 const r=await f.control({hard:true,char:'Hero',epoch:'one',kick:1,reason:'Ошибка программы повторилась'},f.tab(1));
 assert.equal(r.ok,true);assert.equal(f.state.on,false);
});
test('F3: жёсткий стоп не трогает живую вкладку-хозяина другой вкладки и другого героя',async()=>{
 const f=fixture();
 assert.equal((await f.control({hard:true,char:'Hero',epoch:'one',kick:1},f.tab(2))).ok,false);
 assert.equal((await f.control({hard:true,char:'Other',epoch:'one',kick:1},f.tab(1))).ok,false);
 assert.equal(f.state.on,true);
});
test('F3: content передаёт user для Esc и hard для жёстких остановок, отказ пишет в журнал',()=>{
 assert.match(content,/halt\('Остановлено \(Esc ×2\)', true, true\)/);
 const stop=slice(content,'async function automationStop(','async function halt(');
 assert.match(stop,/user:true/);assert.match(stop,/hard:true/);assert.match(stop,/фон не принял остановку/);
 assert.match(slice(content,'async function halt(','async function pauseBot('),/automationStop\(msg, 'stop', \{ hard: !!hard, user: !!user \}\)/);
});
test('F3: automationStop при отказе фона жёсткого стопа повторяет и пишет причину',async()=>{
 const calls=[],recs=[];const c={rt:{char:'Hero',manualKickAt:1},leaseEpoch:'one',automationGeneration:0,on:true,sleep:async()=>{},setTimeout:f=>f(),
  ipc:async m=>{calls.push(m);return calls.length<3?undefined:{ok:false,reason:'ownership_lost'}},rec:(...a)=>recs.push(a.join(' ')),setRt:async()=>{}};
 vm.createContext(c);vm.runInContext(slice(content,'const STOP_PEND_KEY','// hard = настоящая остановка')+';this.S=automationStop;',c);
 const r=await c.S('Аккаунт заблокирован','stop',{hard:true});
 assert.equal(calls.length,3);assert.equal(calls[0].hard,true);assert.equal(r.ok,false);assert.equal(c.on,false);assert.match(recs[0],/ownership_lost/);
});

// --- F4
test('F4: wdHealed — перезагрузка, после которой пульс шёл ≥ 3 мин, удачная',()=>{
 const f=fixture();assert.equal(f.box.wdHealed([1000],1000+180000),true);assert.equal(f.box.wdHealed([1000],1000+60000),false);assert.equal(f.box.wdHealed([],1e9),false);
});
test('F4: четыре перезагрузки за 20 мин, каждая помогала, — бот не выключается',async()=>{
 const now=Date.UTC(2026,9,17),f=fixture({state:{cfg:{autoTasks:['auto']}}});
 for(let i=0;i<4;i++){
  // бот замолчал → сторож перезагружает
  f.box.hbMem={tab:1,t:f.box.Date.now()-160000,page:'/map.html'};await f.tick();
  assert.equal(f.state.on,true,'перезагрузка '+(i+1)+' не стоп');assert.equal(f.reloads.length,i+1);
  // после перезагрузки бот работал 4 мин — сторож видит здоровый пульс
  f.advance(240000);f.box.hbMem={tab:1,t:f.box.Date.now(),page:'/map.html'};await f.tick();
  assert.deepEqual(f.state.wdog,[],'удачная перезагрузка уходит из счётчика');
  f.advance(60000);
 }
 assert.equal(f.state.on,true);assert.ok(f.box.Date.now()-now<=20*60000,'всё в пределах 20 мин');
});
test('F4: три перезагрузки подряд без восстановления — прежний стоп',async()=>{
 const now=Date.UTC(2026,9,17),f=fixture({state:{cfg:{autoTasks:['auto']},wdog:[now-360000,now-420000,now-480000]}});
 await f.tick();assert.equal(f.state.on,false);assert.equal(f.state.stopMeta.source,'watchdog');
});
test('F4: короткий пульс сразу после перезагрузки счётчик не сбрасывает',async()=>{
 const now=Date.UTC(2026,9,17),f=fixture({state:{wdog:[now-60000]},hb:{tab:1,t:now,page:'/map.html'}});
 await f.tick();assert.equal(f.state.wdog.length,1);
});

// --- F6
test('F6: фон — свой протухший замок тем же epoch возвращается с resumed, чужой epoch нет',async()=>{
 const f=fixture();f.state.lock.t-=120000;
 const a=await f.box.lockCommand({cmd:'lockRenew',epoch:'one'},f.tab(1));assert.equal(a.ok,false);
 const b=await f.box.lockCommand({cmd:'lockAcquire',epoch:'one',page:'/map.html',vis:false},f.tab(1));assert.equal(b.ok,true);assert.equal(b.resumed,true);
 const g=fixture();g.state.lock.t-=120000;
 const c=await g.box.lockCommand({cmd:'lockAcquire',epoch:'other',page:'/map.html'},g.tab(1));assert.equal(c.ok,false);
 const h=fixture();h.state.lock={k:'tab2',tab:2,epoch:'two',t:h.box.Date.now()-120000};
 const d=await h.box.lockCommand({cmd:'lockAcquire',epoch:'one',page:'/map.html'},h.tab(1));assert.equal(d.ok,true);assert.equal(d.resumed,false,'чужой протухший замок — не возврат своего');
});
function resumeBox(answer){
 const c={leaseEpoch:'one',documentLease:'one',tabOwner:true,on:true,recovered:0,location:{pathname:'/map.html'},document:{hasFocus:()=>true},tabVis:()=>false,
  calls:[],ipc:async m=>{c.calls.push(m);return m.cmd==='lockAcquire'?answer:{ok:true}},rtWriter:{recover:async()=>{c.recovered++;}}};
 vm.createContext(c);vm.runInContext(slice(content,'async function renewResume(','setInterval(async () => {')+';this.R=renewResume;',c);return c;
}
test('F6: content — возврат своего замка сохраняет очередь и досылает её',async()=>{
 const c=resumeBox({ok:true,epoch:'new',resumed:true});assert.equal(await c.R(),true);assert.equal(c.leaseEpoch,'new');assert.equal(c.recovered,1);
});
test('F6: content — замок у другой вкладки или не возврат: прежняя очистка',async()=>{
 assert.equal(await resumeBox({ok:false,reason:'other_tab'}).R(),false);
 const c=resumeBox({ok:true,epoch:'new',resumed:false});assert.equal(await c.R(),false);assert.equal(c.leaseEpoch,'one');assert.equal(c.recovered,0);
 // шаг 5 (core-b, ревью): выданный, но не возвращённый замок отпускается, а его epoch запоминается — иначе следующий tabLock получал ownership_lost навсегда
 assert.deepEqual(c.calls.map(m=>m.cmd),['lockAcquire','lockRelease']);assert.equal(c.calls[1].epoch,'new');assert.equal(c.documentLease,'new');
});
test('F6 (ревью): возврат замка не отбирает его у видимой вкладки и не трогает пересобранный замок',async()=>{
 const c=resumeBox({ok:true,epoch:'new',resumed:true});await c.R();assert.equal(c.calls[0].focus,false);
 const d=resumeBox({ok:true,epoch:'one',resumed:true});d.ipc=async m=>{d.calls.push(m);d.leaseEpoch='fresh';return{ok:true,epoch:'fresh'}};
 assert.equal(await d.R(),'moved');assert.equal(d.leaseEpoch,'fresh');assert.equal(d.recovered,0);assert.equal(d.calls.length,1);
 const e=resumeBox({ok:true,epoch:'new',resumed:true});e.on=false;assert.equal(await e.R(),false);assert.deepEqual(e.calls.map(m=>m.cmd),['lockAcquire','lockRelease']);
 // фон: свежий чужой замок при focus:false не отдаётся
 const f=fixture();f.state.lock={k:'tab2',tab:2,epoch:'two',t:f.box.Date.now(),vis:false};
 assert.equal((await f.box.lockCommand({cmd:'lockAcquire',epoch:'one',page:'/map.html',vis:true,focus:false},f.tab(1))).ok,false);
 assert.match(slice(content,"const r = await ipc({ cmd: 'lockRenew'",'else if (tabOwner && !on'),/again === 'moved'\) return;/);
});
test('F6: при отказе продления очередь чистится только после неудачного возврата',()=>{
 const tick=slice(content,"const r = await ipc({ cmd: 'lockRenew'",'else if (tabOwner && !on');
 assert.ok(tick.indexOf('renewResume()')>=0&&tick.indexOf('renewResume()')<tick.indexOf('rtWriter.clear()'));
});
