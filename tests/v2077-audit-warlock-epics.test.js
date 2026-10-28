'use strict';
// 20.76+ (ревизия 28.10, группа warlock-epics):
// 1) автобаф суммона не оставляет вечный 'sent' при отказе gamePost до отправки (иначе externalPending блокировал все оплаты бота);
// 2) эпики: маршрут в логово, снятый навигацией без телепорта (адена сверх резерва/цена/кнопка/персонаж), — не промах логова;
// 3) epicApiScan и raid.rbInfo: дедлайн своего GET охватывает и тело ответа (как gameGet 20.46).
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const presend=code=>{let tries=0;const f=fixture({char:{adena:'50000000'}}),real=f.env.gamePost;f.env.gamePost=()=>{tries++;return Promise.reject(new Error(code))};return {f,real,tries:()=>tries};};
for(const code of ['action_cancelled','lifestone_session_active','bot_inactive','pvp_defeat_pending','payment_unconfirmed']){
 test(`warlock: отказ gamePost до отправки (${code}) снимает pending, не блокирует оплаты; затем покупка проходит`,async()=>{
  const {f,real,tries}=presend(code);await f.step();
  assert.equal(tries(),1);assert.equal(f.calls.length,0,'на сервер ничего не ушло');
  assert.equal(f.env.rt.petFull.pending,null,'неотправленная покупка не остаётся в phase sent');assert.equal(f.status(),'paused');
  assert.match(f.env.rt.petFull.reason,/отменена до отправки/);
  f.env.gamePost=real;await f.step();assert.equal(f.calls.length,0,'ждёт 15 с, не повторяет на каждом тике');
  f.tick(20000);await f.step({forceRead:true});assert.equal(f.calls.length,1);assert.equal(f.status(),'active');assert.equal(f.env.rt.petFull.pending,null);
 });
}
test('warlock: потерянный ответ (AbortError/обрыв сети) по-прежнему unknown без повтора оплаты',async()=>{
 for(const err of [Object.assign(new Error('The operation was aborted'),{name:'AbortError'}),new TypeError('Failed to fetch')]){
  const f=fixture({char:{adena:'50000000'}});f.env.gamePost=()=>Promise.reject(err);await f.step();
  assert.equal(f.env.rt.petFull.pending?.phase,'sent');assert.equal(f.status(),'unknown');
 }
});
test('warlock: устаревший кадр действий (canAct false) отменяет покупку до пометки sent',async()=>{
 const f=fixture({char:{adena:'50000000'}});let act=true,tries=0;const real=f.env.gamePost;
 f.env.canAct=()=>act;f.env.rtCommit=async()=>{act=false;return true};f.env.gamePost=(...a)=>{tries++;return real(...a)};
 await f.step();assert.equal(tries,0,'до gamePost не доходит');assert.equal(f.env.rt.petFull.pending,null);assert.equal(f.status(),'paused');
 assert.ok(!f.writes.some(w=>w.petFull?.pending?.phase==='sent'),'pending не помечается sent');
 act=true;f.env.rtCommit=async()=>true;f.tick(20000);await f.step({forceRead:true});assert.equal(tries,1);assert.equal(f.status(),'active');
});
test('warlock: удержание ЛС в Rebirth (priority его пропускает) отменяет покупку до отправки',async()=>{
 const f=fixture({char:{adena:'50000000'},cfg:{petFullAuto:false}});let tries=0;const real=f.env.gamePost;
 f.env.canRun=()=>true;f.env.rebirthCfg=()=>({petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:null,petFullRenew:true,shopReserve:200000});
 f.env.rt.autoLs={hold:true};f.env.gamePost=(...a)=>{tries++;return real(...a)};
 await f.step();assert.equal(tries,0);assert.equal(f.env.rt.petFull.pending,null);assert.equal(f.status(),'paused');
 f.env.rt.autoLs=null;f.tick(20000);await f.step({forceRead:true});assert.equal(tries,1);assert.equal(f.status(),'active');
});

// ---------- эпики: маршрут в логово снят навигацией до оплаты — не промах логова ----------
const {mk,base,clone,MIN,listAlive}=require('./epic-harness.cjs');
const ID='l2dop_rb_29014',LAIR='sea_of_spores';   // логово Орфена из таблицы EPICS (без lairOkT — раньше сразу lairBadT на 6 ч)
const okDb=(x={})=>({orfen:{id:ID,col:1,adena:0,apiT:Date.now(),alive:true,canAttack:true,lvl:50,respH:12,lifeT:Date.now()-3600000,...x}});
const okStats=()=>({...clone(base.rbStats),[ID]:{hp:400000,patk:1100,matk:700,mdef:800,pdef:700,src:'api'}});
const zoneCat=()=>({[LAIR]:{price:50000,cur:'аден',curT:'аден'}});
const lairArrive=(lairT,rt={})=>mk({cfg:{epicList:'orfen',epicCoinDailyMax:3},net:()=>null,
 rt:{epicDb:okDb(),rbStats:okStats(),zoneCat:zoneCat(),zoneGoT:0,epicTpBudget:[{t:lairT,k:'orfen',cost:50000,unit:'аден',kind:'lair'}],
  epic:{step:'arrive',k:'orfen',id:ID,name:'Орфен',via:'zone',lair:LAIR,at:lairT,lairT,tpRes:lairT,seenSaved:false},...rt}});
test('эпики: навигация сняла маршрут в логово без телепорта (zoneBad после маршрута) — резерв снят, промаха логова нет, страница за CoL не выбирается',async()=>{
 const lairT=Date.now()-30000,m=lairArrive(lairT,{zoneBad:{[LAIR]:lairT+15000}});
 await m.E.epicStep();
 const d=m.env.rt.epicDb.orfen;
 assert.equal(m.env.rt.epicTpBudget.length,0,'резерв адены снят');assert.equal(d.lairMiss,undefined,'не промах логова');assert.equal(d.lairBadT,undefined,'логово не на паузе 6 ч');
 assert.equal(m.env.rt.epic.step,'pick');assert.ok(d.skipT>Date.now()+55*MIN&&d.skipT<=Date.now()+60*MIN);assert.match(d.why,/не промах логова/);
 assert.equal(m.E.epicLair('orfen',Date.now()+61*MIN).ok,true,'логово снова доступно');
 m.env.rt.epicDb.orfen.verdict={v:'ok',why:'test'};assert.equal(m.E.epicRoute('orfen',Date.now()+61*MIN).via,'zone','дорога — логово за адену, не страница за Coin of Luck');
});
test('эпики: прежнее правило промаха логова сохраняется — старая метка zoneBad, открытая квитанция перелёта (клик был), маршрут в работе',async()=>{
 const lairT=Date.now()-30000;
 for(const [name,rt] of [['zoneBad до маршрута',{zoneBad:{[LAIR]:lairT-60000}}],['квитанция перелёта открыта',{zoneBad:{[LAIR]:lairT+15000},travelCheck:{id:LAIR,nativeTp:{id:LAIR}}}],['маршрут ещё в работе',{zoneBad:{[LAIR]:lairT+15000},zoneGo:{id:LAIR,t:lairT}}]]){
  const m=lairArrive(lairT,rt);await m.E.epicStep();
  assert.equal(m.env.rt.epicTpBudget.length,1,name+': резерв не трогаем');
  assert.equal(m.env.rt.epicDb.orfen.lairMiss,1,name+': промах логова как раньше');
 }
});

// ---------- эпики и РБ: дедлайн своего GET охватывает и тело ответа ----------
const nap=ms=>new Promise(r=>setTimeout(r,ms));
// тело: заголовки пришли, json() ждёт без конца — отклоняется только по abort() сигнала запроса (как настоящий fetch)
const hangBody=log=>(u,opt)=>{log.push(u);return Promise.resolve({ok:true,status:200,json:()=>new Promise((_,rej)=>opt?.signal?.addEventListener('abort',()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'}))))})};
const fastTimers={setTimeout:(f,ms)=>setTimeout(f,ms>=6000?30:ms),clearTimeout};
test('эпики: зависшее тело /game/epic-bosses обрывается по дедлайну — apiBusy снят, ошибка записана, следующий запрос новый',async()=>{
 const log=[];const m=mk({cfg:{epicList:'orfen'},sb:{...fastTimers,fetch:hangBody(log)}});
 const r=await Promise.race([m.E.epicApiScan('тест'),nap(1000).then(()=>'hang')]);
 assert.notEqual(r,'hang','epicApiScan не висит на чтении тела');assert.equal(r,null);
 assert.equal(m.env.rt.epicApiFail?.n,1);
 const r2=await Promise.race([m.E.epicApiScan('тест2'),nap(1000).then(()=>'hang')]);
 assert.notEqual(r2,'hang');assert.equal(log.length,2,'apiBusy снят: второй вызов делает новый запрос');
});
test('эпики: обычный ответ /game/epic-bosses по-прежнему разбирается',async()=>{
 const m=mk({cfg:{epicList:'orfen'},sb:fastTimers,net:u=>/epic-bosses/.test(u)?listAlive('orfen'):null});
 const r=await m.E.epicApiScan('тест');assert.ok(r&&Array.isArray(r.seen));assert.ok(!m.env.rt.epicApiFail);
});
test('РБ: зависшее тело /game/spawn/<id>/info обрывается по дедлайну, неудача запоминается',async()=>{
 const log=[];const m=mk({sb:{...fastTimers,fetch:hangBody(log)}});
 const r=await Promise.race([m.R.rbInfo('l2dop_rb_99050'),nap(1000).then(()=>'hang')]);
 assert.notEqual(r,'hang','rbInfo не висит на чтении тела');assert.equal(r,null);assert.ok(m.env.rt.rbInfoFail?.l2dop_rb_99050>0);assert.equal(log.length,1);
});
