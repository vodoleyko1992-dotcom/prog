'use strict';
// 19.10.2026: реальные обработчики меню при задержке storage/ACK, смене героя и запуске с несохранённой задачей.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '../popup.js'), 'utf8');
const part = (a,b) => { const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j); };
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
function fixture() {
 const state={cfg:{autoTasks:['farm'],shopReserve:200000},rt:{char:'HeroA'},on:false},els=new Map(),writes=[],toasts=[];
 const el=id=>{if(!els.has(id))els.set(id,{id,dataset:{},hidden:false,textContent:'',value:'',checked:false});return els.get(id);};
 const f={state,els,writes,toasts,getHook:null,messageHook:null,loads:0,wakes:0,fast:false};
 const c={console,Date,Promise,Object,Array,Set,Map,String,Number,Math,JSON,structuredClone,
  setTimeout:(fn,ms)=>f.fast&&ms===100?setImmediate(fn):setTimeout(fn,ms),clearTimeout,
  formChar:'HeroA',DEF:{shopReserve:200000},NUM:['shopReserve'],TXT:['nPower'],BOOL:['tvtOn'],$:el,toast:t=>toasts.push(t),
  load:async()=>{f.loads++;},showWakeResult:async()=>{f.wakes++;},
  chrome:{runtime:{sendMessage:async m=>{writes.push(structuredClone(m));if(f.messageHook)return f.messageHook(m);
    if(m.expectedChar!=null&&m.expectedChar!==state.rt.char)return {ok:false,reason:'Персонаж изменился — обновите меню'};
    Object.assign(state.cfg,m.cfgPatch||{});Object.assign(state.rt,m.rtPatch||{});if(typeof m.on==='boolean')state.on=m.on;return {ok:true};}},
   storage:{local:{get:async keys=>f.getHook?f.getHook(keys):structuredClone(state),set:async p=>Object.assign(state,p)}}}};
 vm.createContext(c);
 vm.runInContext(part('let settingsSerial =','// 8.0 (аудит меню): неудачный запуск')+part('async function save(e)','// ---------- вкладки ----------')+
   part('const AUTO_TASK_LABELS =','function currentMode(')+part('let controlGeneration =','async function botControl(')+
   ';this.cancel=()=>controlGeneration++;this.taskPending=()=>autoTaskPending;',c);
 f.c=c;f.field=el;return f;
}
const cases=[];const test=(name,fn)=>cases.push({name,fn});
test('изменение поля героя A отменяется при переходе формы к B во время чтения',async()=>{
 const f=fixture(),d=deferred();f.field('shopReserve').value='777';f.getHook=()=>{f.getHook=null;return d.promise;};
 const p=f.c.save({target:f.field('shopReserve')});f.c.formChar='HeroB';f.state.rt.char='HeroB';d.resolve(structuredClone(f.state));
 await assert.rejects(p,/Персонаж изменился/);assert.equal(f.writes.length,0);assert.equal(f.state.cfg.shopReserve,200000);
});
test('галка TvT не переносит список задач старого героя после перерисовки формы',async()=>{
 const f=fixture(),d=deferred();f.state.cfg.autoTasks=['raid'];f.field('tvtOn').checked=false;
 const old=structuredClone(f.state);f.getHook=()=>{f.getHook=null;return d.promise;};const p=f.c.save({target:f.field('tvtOn')});
 f.c.formChar='HeroB';f.state.rt.char='HeroB';f.state.cfg.autoTasks=['fish','tvt'];f.field('tvtOn').checked=true;
 d.resolve(old);await assert.rejects(p,/Персонаж изменился/);assert.equal(f.writes.length,0);assert.deepEqual(f.state.cfg.autoTasks,['fish','tvt']);
});
test('значение поля фиксируется до await и не подменяется новым DOM',async()=>{
 const f=fixture(),d=deferred();f.field('shopReserve').value='777';f.getHook=()=>{f.getHook=null;return d.promise;};
 const p=f.c.save({target:f.field('shopReserve')});f.field('shopReserve').value='888';d.resolve(structuredClone(f.state));await p;
 assert.equal(f.state.cfg.shopReserve,777);assert.equal(f.writes[0].expectedChar,'HeroA');
});
test('очередь задачи A не переносится к герою B',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const p=f.c.editAutoTask('fish',true);await tick();
 f.c.formChar='HeroB';f.state.rt.char='HeroB';d.resolve(structuredClone(f.state));await assert.rejects(p,/Персонаж изменился/);
 assert.equal(f.writes.length,0);assert.equal(f.c.taskPending(),0);assert.equal(f.loads,0);
});
test('Start ждёт чтения и ACK всех выбранных задач',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const edit=f.c.editAutoTask('fish',true);await tick();
 let done=false;const start=f.field('start').onclick().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(f.state.on,false);
 f.getHook=null;d.resolve(structuredClone(f.state));await edit;await start;
 assert.deepEqual(Array.from(f.state.cfg.autoTasks),['farm','fish']);assert.equal(f.state.on,true);
 assert.ok(f.writes.findIndex(m=>m.cfgPatch?.autoTasks)<f.writes.findIndex(m=>m.on===true));
});
test('ошибка сохранения задачи запрещает запуск',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};f.messageHook=async()=>({ok:false,reason:'disk full'});
 const edit=f.c.editAutoTask('fish',true);const caught=edit.catch(()=>{});await tick();const start=f.field('start').onclick();
 f.getHook=null;d.resolve(structuredClone(f.state));await caught;await start;assert.equal(f.state.on,false);assert.equal(f.writes.some(m=>m.on===true),false);
 assert.ok(f.toasts.some(t=>/disk full/.test(t)));
});
test('ошибка чтения задачи до отправки запрещает Start и видна в меню',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const edit=f.c.editAutoTask('fish',true);const caught=edit.catch(()=>{});await tick();
 const start=f.field('start').onclick();d.reject(new Error('storage unavailable'));await caught;await start;
 assert.equal(f.state.on,false);assert.equal(f.writes.length,0);assert.match(f.field('settingsFeedbackText').textContent,/storage unavailable/);
 await f.c.editAutoTask('fish',true);await f.field('start').onclick();assert.equal(f.state.on,true,'успешное повторное изменение снимает запрет');
});
test('ошибка чтения обычного поля запрещает Start до успешного повторного изменения',async()=>{
 const f=fixture(),d=deferred();f.field('shopReserve').value='777';f.getHook=()=>{f.getHook=null;return d.promise;};
 const edit=f.c.save({target:f.field('shopReserve')});const caught=edit.catch(()=>{});const start=f.field('start').onclick();d.reject(new Error('storage unavailable'));await caught;await start;
 assert.equal(f.state.on,false);assert.equal(f.writes.length,0);await f.c.save({target:f.field('shopReserve')});await f.field('start').onclick();assert.equal(f.state.on,true);
});
test('тайм-аут незавершённого чтения настройки запрещает Start',async()=>{
 const f=fixture(),d=deferred();f.fast=true;f.getHook=()=>{f.getHook=null;return d.promise;};const edit=f.c.editAutoTask('fish',true);await tick();
 await f.field('start').onclick();assert.equal(f.state.on,false);assert.equal(f.writes.length,0);assert.ok(f.toasts.some(t=>/сохранени|сохраня/i.test(t)));
 f.getHook=null;d.resolve(structuredClone(f.state));await edit;assert.equal(f.state.on,false,'поздний ответ не продолжает отменённый запуск');
});
test('Stop во время ожидания задачи сохраняет изменение без последующего Start',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const edit=f.c.editAutoTask('fish',true);await tick();const start=f.field('start').onclick();
 f.c.cancel();f.getHook=null;d.resolve(structuredClone(f.state));await edit;await start;assert.equal(f.state.on,false);assert.equal(f.writes.some(m=>m.on===true),false);
});
test('смена героя во время Start не запускает следующий профиль',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const start=f.field('start').onclick();await tick();
 f.c.formChar='HeroB';f.state.rt.char='HeroB';d.resolve(structuredClone(f.state));await start;
 assert.equal(f.state.on,false);assert.equal(f.writes.some(m=>m.on===true),false);
});
test('поздний ACK героя A не показывает сохранение в форме B',async()=>{
 const f=fixture(),d=deferred();f.messageHook=()=>d.promise;const p=f.c.menuPatch({}, {cfgPatch:{shopReserve:777}});
 f.c.formChar='HeroB';f.state.rt.char='HeroB';f.c.paintSettingsFeedback();d.resolve({ok:true});await p;
 assert.doesNotMatch(f.field('settingsState').textContent,/✓|Сохраняю/);f.c.formChar='HeroA';f.c.paintSettingsFeedback();assert.match(f.field('settingsState').textContent,/сохранены/);
});
test('быстрый запуск ждёт предыдущую задачу и отменяется при смене героя',async()=>{
 const f=fixture(),d=deferred();f.getHook=()=>{f.getHook=null;return d.promise;};const edit=f.c.editAutoTask('fish',true);const caught=edit.catch(()=>{});await tick();
 const start=f.c.quickStart('auto');f.c.formChar='HeroB';f.state.rt.char='HeroB';f.getHook=null;d.resolve(structuredClone(f.state));await caught;await start;
 assert.equal(f.state.on,false);assert.equal(f.writes.length,0);
});
(async()=>{let bad=0;for(const {name,fn} of cases){try{let timer;try{await Promise.race([fn(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('scenario timed out')),2500))]);}finally{clearTimeout(timer);}console.log('PASS '+name);}catch(e){bad++;console.error('FAIL '+name+'\n'+e.stack);}}console.log(`${cases.length-bad} PASS / ${bad} FAIL`);process.exitCode=bad?1:0;})();
