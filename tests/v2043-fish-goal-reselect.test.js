'use strict';
// 20.43 (лог 21.10 17:13): старая выполненная цель рыбалки («✅ 1679 рыб», 18.10) держала selectedTask без рыбалки —
// игрок снова выбрал рыбалку в задачах, а бот писал «только задачи: TvT; дел нет, стою». Новое явное включение рыбалки
// (галка задачи или «Старт» с выбранной рыбалкой) снимает выполненную цель; незавершённая цель и прочие записи не трогаются.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../engine-core.js'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function background(storage){
 const src=read('background.js'),cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<i)throw Error(a);return src.slice(i,j)};
 const ctx={console,Date,URL,Number,JSON,Object,Math,Promise,Set,Array,String,L2EngineCore:core,MAX_PATCH_KEYS:400,LOCK_TTL:90000,lockQueue:Promise.resolve(),
  afterOnWrite:async()=>{},stopAlert:async()=>{},
  chrome:{runtime:{getURL:p=>'chrome-extension://x/'+p},storage:{local:{get:async keys=>{const r={};for(const k of keys)r[k]=clone(storage[k]??null);return r},set:async p=>{Object.assign(storage,clone(p))}}}}};
 vm.createContext(ctx);vm.runInContext(cut('function serializeLock(fn)','async function lockCommand(')+cut('function mergeTimerPatch(','// Реворк ядра'),ctx);
 return (rtPatch,extra={})=>ctx.menuPatch({rtPatch,...extra},{url:'chrome-extension://x/popup.html'});
}
const done={type:'fish',n:1679,got:1679,t:1,done:true,doneT:2,final:true};
const store=(tasks,tgt=done)=>({on:true,cfg:{autoTasks:tasks},rt:{char:'Hero',fishTgt:clone(tgt)}});
test('до правки: выполненная цель держит выбранную рыбалку в простое',()=>{
 const S=store(['tvt','fish']);assert.equal(core.selectedTask(S.cfg,S.rt),'tasks');
});
test('галка рыбалки снова включена → выполненная цель снята, рыбалка — выбранная задача',async()=>{
 const S=store(['tvt','dailies']),menu=background(S);
 assert.equal((await menu({manualKickAt:5},{cfgPatch:{autoTasks:['tvt','fish','dailies']},expectedChar:'Hero'})).ok,true);
 assert.equal(S.rt.fishTgt,null);assert.equal(core.selectedTask(S.cfg,S.rt),'fish');
});
test('«Старт» с уже выбранной рыбалкой снимает выполненную цель (состояние из лога)',async()=>{
 const S=store(['tvt','fish']),menu=background(S);
 assert.equal((await menu({manualKickAt:5},{on:true,expectedChar:'Hero'})).ok,true);
 assert.equal(S.rt.fishTgt,null);assert.equal(core.selectedTask(S.cfg,S.rt),'fish');
});
test('незавершённая цель, другие задачи и правка без включения рыбалки цель не трогают',async()=>{
 const run={type:'fish',n:100,got:10,t:1};
 let S=store(['tvt'],run),menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','fish']},expectedChar:'Hero'});assert.deepEqual(S.rt.fishTgt,run);
 S=store(['tvt','fish']);menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','fish','clan']},expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true,'рыбалка уже была выбрана — без «Старта» цель остаётся');
 S=store(['tvt']);menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','cat']},expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true);
 S=store(['tvt']);menu=background(S);await menu({manualKickAt:5},{on:true,expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true,'Старт без рыбалки');
});
test('простой в режиме задач называет выполненную цель рыбалки',()=>{
 const src=read('content.js');assert.match(src,/рыбалка не идёт: цель/);
});

// 20.43 (John 21.10: «смотрел ежедневно на новый лимит рыб …, что сброс произошёл и наша цель»): цель рыбалки — на игровые сутки.
const E2=require('../engine-core.js'),dailyData=require('./tools/daily-server-fixture.cjs');
function dayFixture(tgt){
 const box={require:x=>x==='node:test'?()=>{}:require(x),__dirname,URL,URLSearchParams,Date,structuredClone,console};const src=read('tests/v208-farm-kill-quota.test.js');vm.runInNewContext(src.slice(0,src.indexOf("for(const task of ['auto','cat'])")),box);const f=box.fixture(),c=f.c;
 f.state.cfg.dailyFishLimit=1523;f.state.cfg.autoTasks=['tvt','fish'];f.state.rt.fishTgt=clone(tgt);f.refresh();Object.assign(c,{isBattle:()=>false,isFishing:()=>false,heroNick:()=>c.rt.char,automationGeneration:1});
 const d=dailyData();d.daily.tasks.fishing_catch_50={score:10,have:10,need:50,done:false};
 const charGet=c.gameGet;c.gameGet=async path=>{if(path==='/character')return charGet();return {ok:true,json:async()=>path==='/game/time'?d.clock:d.daily}};
 return {...f,sync:()=>c.dailyServerSync()};
}
test('новые сутки сервера: выполненная цель прошлого дня обновляется (диапазон — новое число), рыбалка снова выбрана',async()=>{
 const f=dayFixture({type:'fish',n:1600,min:1500,max:1700,got:1600,t:1,done:true,doneT:2,day:'2026-10-20'});assert.equal(await f.sync(),true);
 const T=f.state.rt.fishTgt,day=f.state.rt.dailyServerCheck.day;assert.equal(T.done,undefined);assert.equal(T.got,0);assert.equal(T.day,day);assert.ok(T.n>=1500&&T.n<=1700);assert.equal(T.renewFrom,'2026-10-20');
 assert.deepEqual(clone(f.c.rt.fishTgt),clone(T),'вкладка видит новую цель сразу');assert.equal(E2.selectedTask(f.c.cfg,f.c.rt),'fish');
});
test('цель без дня (до 20.43): выполненная обновляется, незавершённая получает день без сброса счёта; цель этих суток не трогается',async()=>{
 let f=dayFixture(done);await f.sync();assert.equal(f.state.rt.fishTgt.done,undefined);assert.equal(f.state.rt.fishTgt.n,1679);assert.equal(f.state.rt.fishTgt.got,0);
 f=dayFixture({type:'fish',n:100,got:40,t:1});await f.sync();assert.equal(f.state.rt.fishTgt.got,40);assert.equal(f.state.rt.fishTgt.day,f.state.rt.dailyServerCheck.day);
 f=dayFixture({type:'fish',n:100,got:100,t:1,done:true,day:E2.dailyDay()});const before=clone(f.state.rt.fishTgt);await f.sync();
 assert.deepEqual(f.state.rt.fishTgt,{...before,day:f.state.rt.dailyServerCheck.day},'выполнена сегодня — ждёт сброса');
});
test('«Старт» не снимает цель, выполненную в эти сутки; явное включение рыбалки — снимает',async()=>{
 const today=E2.dailyDay();let S=store(['tvt','fish'],{...done,day:today}),menu=background(S);
 await menu({manualKickAt:5},{on:true,expectedChar:'Hero'});assert.equal(S.rt.fishTgt.done,true);assert.equal(E2.selectedTask(S.cfg,S.rt),'tasks');
 S=store(['tvt'],{...done,day:today});menu=background(S);await menu({},{cfgPatch:{autoTasks:['tvt','fish']},expectedChar:'Hero'});assert.equal(S.rt.fishTgt,null);
});
test('финиш цели в режиме задач оставляет рыбалку выбранной и ставит день цели',()=>{
 const src=read('background.js');assert.match(src,/fishTgt = T\.done \? \{ \.\.\.T, day: T\.day \|\| day \}/);assert.doesNotMatch(src,/autoTasks = cfg\.autoTasks\.filter\(k => k !== 'fish'\)/);
});
