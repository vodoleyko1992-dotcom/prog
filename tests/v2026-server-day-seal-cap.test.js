'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../engine-core.js'),read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const at=Date.parse('2026-10-19T12:00:00Z');
const sample=(now='2026-10-19T20:59:59Z',reset='2026-10-19T21:00:00Z',day='20261019')=>({serverNowMs:Date.parse(now),timeZone:'Europe/Kyiv',gameDayKey:day,nextDailyResetAt:Date.parse(reset)});
test('сутки сервера: летняя/зимняя полночь и переходы DST без фиксированного UTC-смещения',()=>{
 for(const [edge,old,next] of [['2026-10-19T21:00:00Z','2026-10-19','2026-10-20'],['2026-12-19T22:00:00Z','2026-12-19','2026-12-20'],['2026-03-29T21:00:00Z','2026-03-29','2026-03-30'],['2026-10-25T22:00:00Z','2026-10-25','2026-10-26']]){
  const t=Date.parse(edge);assert.equal(E.dailyDay(t-1),old);assert.equal(E.dailyDay(t),next);
 }
 assert.equal(E.dailyDay(Date.parse('2026-10-19T14:00:00Z')),'2026-10-19');
});
test('/game/time исправляет смещение браузерных часов; лимит снимается ровно в nextDailyResetAt',()=>{
 const rt={serverClock:E.serverClockNote(sample(),at),dailyQuota:{basis:'server',day:'2026-10-19',auto:8000}},cfg={autoTasks:['auto'],dailyKillLimit:8000};
 assert.equal(E.dailyDay(at,rt),'2026-10-19');assert.equal(E.selectedTask(cfg,rt,at+999),'tasks');assert.equal(E.dailyCount(rt,'auto',at+999),8000);
 assert.equal(E.dailyDay(at+1000,rt),'2026-10-20');assert.equal(E.selectedTask(cfg,rt,at+1000),'auto');assert.equal(E.dailyCount(rt,'auto',at+1000),0);
 assert.equal(E.dailyDay(at+86401000,rt),'2026-10-21');
});
test('неполный/ошибочный ответ времени не заменяет серверные часы',()=>{
 for(const data of [null,{},sample(undefined,undefined,'20261020'),{...sample(),timeZone:'bad/zone'},{...sample(),nextDailyResetAt:1},{...sample(),serverNowMs:NaN},{...sample(),nextDailyResetAt:Date.parse('2026-11-01T00:00:00Z')}])assert.equal(E.serverClockNote(data,at),null);
});
test('переход с UTC+10 сохраняет бюджет текущего дня один раз, затем сбрасывает обе охоты и рыбу',()=>{
 const now=Date.parse('2026-10-19T18:00:00Z'),rt={dailyQuota:{day:'2026-10-20',auto:7000,cat:500,raid:500,fish:1500}};
 rt.dailyQuota=E.dailyQuotaToday(rt,now);assert.equal(rt.dailyQuota.day,'2026-10-19');assert.equal(rt.dailyQuota.basis,'server');assert.equal(E.dailyCount(rt,'cat',now),8000);
 const next=E.dailyQuotaToday(rt,Date.parse('2026-10-19T21:00:00Z'));assert.equal(next.day,'2026-10-20');assert.equal(next.auto+next.cat+next.fish,0);
});
test('фон переносит старую дневную цель без нового случайного числа; в серверную полночь выбирает новую',()=>{
 const ctx={};vm.runInNewContext(read('engine-core.js'),ctx);const src=read('background.js');vm.runInNewContext(src.slice(src.indexOf('// 20.8: лимиты фарма'),src.indexOf('// 20.12 (ревизия 17.10, UI-2)')),ctx);
 const now=Date.parse('2026-10-19T18:00:00Z'),state={cfg:{dailyKillLimit:8000,limitRanges:{dailyKillLimit:{min:7000,max:9000}}},rt:{dailyQuota:{day:'2026-10-20',auto:8000},limitRolls:{dailyKillLimit:{day:'2026-10-20',min:7000,max:9000,value:8000,seq:4}}}};
 const r=ctx.limitRangeChange(state,now);assert.equal(r.rt.dailyQuota.auto,8000);assert.equal(r.rt.limitRolls.dailyKillLimit.day,'2026-10-19');assert.equal(r.rt.limitRolls.dailyKillLimit.seq,4);
 const next=ctx.limitRangeChange(r,Date.parse('2026-10-19T21:00:00Z'));assert.equal(next.rt.dailyQuota.auto,0);assert.equal(next.rt.limitRolls.dailyKillLimit.seq,5);assert.equal(next.rt.limitRolls.dailyKillLimit.day,'2026-10-20');
});
test('сетевой обработчик принимает только успешное новое время во вкладке-владельце',()=>{
 const src=read('content.js'),block=src.slice(src.indexOf("  if(path==='/game/time'"),src.indexOf("  if (path === '/game/daily-quests'"));
 const ctx={L2EngineCore:E,rt:{},tabOwner:true,setRt:p=>Object.assign(ctx.rt,p),path:'/game/time',d:{status:200,res:sample()}};
 vm.runInNewContext(block,ctx);assert.equal(ctx.rt.serverClock.gameDayKey,'2026-10-19');const old=ctx.rt.serverClock;
 for(const change of [{tabOwner:false,d:{status:200,res:sample('2026-10-19T20:59:59.500Z')}},{tabOwner:true,d:{status:500,res:sample('2026-10-19T20:59:59.500Z')}},{tabOwner:true,d:{status:200,res:sample('2026-10-19T20:59:58Z')}},{tabOwner:true,d:{status:200,res:{}}}]){Object.assign(ctx,change);vm.runInNewContext(block,ctx);assert.equal(ctx.rt.serverClock,old);}
});
