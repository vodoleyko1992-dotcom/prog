'use strict';
// 20.13 (ревизия 17.10, шаг 5, участок core-a): застревания задач и устойчивость ядра.
// H3 — временный запрет автомагистра выбранной задачей не стирает отметки уровней; M3 — неудача farm-guide снимает запрос по кнопке;
// M5 — неизвестный исход заброса не считается «нет прогресса»; M6 — неподтверждённая фоном остановка не теряется и повторяется.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=fs.readFileSync(path.resolve(__dirname,'..','content.js'),'utf8');
const slice=(a,b)=>{const i=core.indexOf(a),j=core.indexOf(b,i);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return core.slice(i,j);};

function magBox(raw,rt){
 const writes=[],c={on:true,tabOwner:true,writes,rt:{...rt},
  cfg:{autoMagister:false},L2EngineCore:{rawTaskConfig:()=>raw},
  setRt:async p=>{writes.push(p);c.rt={...c.rt,...p};return{ok:true}}};
 vm.createContext(c);vm.runInContext(slice('async function magisterDisable() {','async function magBack(')+';this.D=magisterDisable;',c);return c;
}
test('H3: автомагистр запрещён только выбранной задачей — magEnabled и magChecked сохраняются',async()=>{
 const c=magBox({autoMagister:true},{magEnabled:true,magChecked:{'0:warlock':{lvl:56}},magister:{key:'0:warlock'}});
 await c.D();
 assert.equal(c.rt.magEnabled,true);assert.deepEqual(JSON.parse(JSON.stringify(c.rt.magChecked)),{'0:warlock':{lvl:56}});
 assert.equal(c.rt.magister,null,'начатый поход снимаем');
 const c2=magBox({autoMagister:true},{magEnabled:true,magChecked:{}});await c2.D();assert.equal(c2.writes.length,0,'без похода — ни одной записи');
});
test('H3: игрок сам выключил автомагистра — как прежде, magEnabled:false',async()=>{
 const c=magBox({autoMagister:false},{magEnabled:true,magister:{key:'x'}});await c.D();
 assert.equal(c.rt.magEnabled,false);assert.equal(c.rt.magister,null);
});

function guideBox(get){
 const writes=[],recs=[],c={writes,recs,FARM_GUIDE_URL:'/game/farm-guide',FARM_GUIDE_EVERY:86400000,farmGuideBusy:false,Date,String,
  gameGet:get,rec:(...a)=>recs.push(a.join(' ')),setRt:async p=>{writes.push(p);return{ok:true}},farmDb:async()=>({res:{}}),farmGuideMerge:()=>({n:0})};
 vm.createContext(c);vm.runInContext(slice('const farmGuideRetry','function farmGuideTick').replace('let farmGuideBusy','var farmGuideBusy')+';this.S=farmGuideSync;',c);return c;
}
for(const [name,get] of [['HTTP 404',async()=>({ok:false,status:404})],['ответ без ресурсов',async()=>({ok:true,json:async()=>({resources:[]})})],['исключение',async()=>{throw new Error('сеть')}]])
 test(`M3: farm-guide «по кнопке», ${name} — запрос снят, повтор не раньше чем через час`,async()=>{
  const c=guideBox(get);assert.equal(await c.S('по кнопке'),false);
  assert.equal(c.writes.length,1);assert.equal(c.writes[0].farmGuideReq,null);
  assert.ok(Date.now()-c.writes[0].farmGuideT>=86400000-3600000-1000);assert.equal(c.recs.length,1);
 });

test('M5: неизвестный исход заброса (fishCastPending) исключён из «активной задачи» сторожа прогресса',()=>{
 const m=core.match(/const activeJob = ([^;]+);/);assert.ok(m);assert.match(m[1],/payments\?\.pending/);
 // ревью: глушим сторожа только пока сама рыбалка ждёт сверки, не при бое/других задачах со старой записью
 const EX='!(rt.fishCastPending && fishNow() && !isBattle())';assert.ok(m[1].includes(EX),'исключение ограничено условием');const ex=[0,'fishNow() && !isBattle()'];
 const ctx={rt:{fishCastPending:{at:1}}};
 const f=new Function('rt','fishNow','isBattle','return !(rt.fishCastPending && '+ex[1]+')');
 assert.equal(f(ctx.rt,()=>true,()=>false),false,'рыбалка ждёт сверки — не активная задача');
 assert.equal(f(ctx.rt,()=>false,()=>true),true,'старая запись, идёт бой другой задачи — сторож работает');
 assert.equal(f(ctx.rt,()=>true,()=>true),true,'бой с рыбой — сторож работает');
 assert.equal(f({},()=>true,()=>false),true);
});

function stopBox(ipc,rt={char:'Warlock',manualKickAt:5},store={}){
 const ss=new Map(),recs=[],calls=[],c={recs,calls,ss,rt:{...rt},leaseEpoch:7,on:true,automationGeneration:0,Date,JSON,String,Promise,
  chrome:{storage:{local:{get:async k=>({[k]:store[k]})}}},
  setTimeout:(f)=>f(),sessionStorage:{getItem:k=>ss.has(k)?ss.get(k):null,setItem:(k,v)=>ss.set(k,String(v)),removeItem:k=>ss.delete(k)},
  ipc:async m=>{calls.push(m);return ipc(m,calls.length)},rec:(...a)=>recs.push(a.join(' ')),setRt:async()=>({ok:true}),statusSave:async()=>({ok:true})};   // 20.13 (шаг 7): статус остановки — statusSave (rt + live@Ник)
 vm.createContext(c);vm.runInContext(slice('const STOP_PEND_KEY','// hard = настоящая остановка')+';this.S=automationStop;this.R=stopPendRetry;this.P=stopPendRead;',c);return c;
}
test('M6: таймаут фона — без исключения, 3 попытки, остановка отмечена для повтора после перезагрузки',async()=>{
 const c=stopBox(async()=>{throw new Error('timeout')});
 const r=await c.S('Ошибка повторилась');assert.equal(r.ok,false);assert.equal(c.on,false);assert.equal(c.calls.length,3);
 const p=c.P();assert.equal(p.char,'Warlock');assert.equal(p.kick,5);assert.equal(p.action,'stop');
 // после перезагрузки: тот же герой и kick — повтор остановки; фон ответил — отметка снята
 const c2=stopBox(async()=>({ok:true}));c2.ss.set('l2bot-stopPend',JSON.stringify(p));
 assert.equal(await c2.R(),true);assert.equal(c2.calls.length,1);assert.equal(c2.calls[0].action,'stop');assert.equal(c2.P(),null);assert.equal(c2.on,false);
});
test('M6: новый Start игрока (другой kick) отменяет отметку, бот не останавливается',async()=>{
 const c=stopBox(async()=>({ok:true}),{char:'Warlock',manualKickAt:9});
 c.ss.set('l2bot-stopPend',JSON.stringify({char:'Warlock',kick:5,action:'stop',msg:'x',t:Date.now()}));
 assert.equal(await c.R(),false);assert.equal(c.calls.length,0);assert.equal(c.P(),null);assert.equal(c.on,true);
});
test('M6: подтверждённая остановка — одна попытка, отметки нет; потеря замка — не повторяем',async()=>{
 const c=stopBox(async()=>({ok:true}));await c.S('стоп');assert.equal(c.calls.length,1);assert.equal(c.P(),null);
 const c2=stopBox(async()=>({ok:false,reason:'ownership_lost'}));await c2.S('стоп');assert.equal(c2.calls.length,1);assert.equal(c2.P(),null);
});
test('M6: main() повторяет неподтверждённую остановку сразу после получения замка',()=>{
 const m=slice('async function main() {','// Migrations calculated during page initialization');assert.match(m,/stopPendRetry\(\)/);
});
test('M6 (ревью): после неподтверждённой остановки фон записал остановку, затем запуск горячей клавишей (kick тот же) — не останавливаем',async()=>{
 const t0=Date.now()-60000;
 const c=stopBox(async()=>({ok:true}),{char:'Warlock',manualKickAt:5},{stopMeta:{source:'hotkey',t:t0+30000}});
 c.ss.set('l2bot-stopPend',JSON.stringify({char:'Warlock',kick:5,action:'stop',msg:'x',t:t0+2000,t0}));
 assert.equal(await c.R(),false);assert.equal(c.calls.length,0);assert.equal(c.P(),null);assert.equal(c.on,true);
 // старая stopMeta (до начала остановки) — остановка не дошла: повторяем
 const c2=stopBox(async()=>({ok:true}),{char:'Warlock',manualKickAt:5},{stopMeta:{t:t0-5000}});
 c2.ss.set('l2bot-stopPend',JSON.stringify({char:'Warlock',kick:5,action:'stop',msg:'x',t:t0+2000,t0}));
 assert.equal(await c2.R(),true);assert.equal(c2.calls.length,1);
});
test('M6 (ревью): отказ invalid_control/invalid_sender — без отметки повтора (после перезагрузки не исправится)',async()=>{
 for(const reason of ['invalid_control','invalid_sender']){
  const c=stopBox(async()=>({ok:false,reason}));await c.S('стоп');assert.equal(c.calls.length,1);assert.equal(c.P(),null,reason);
 }
 const c=stopBox(async()=>{throw new Error('timeout')});await c.S('стоп');assert.ok(Number.isFinite(c.P().t0),'t0 сохранён');
});
