'use strict';
// 20.43 (разбор 21.10): проверка набора кота у Warlock после победы (свой GET /character + каталог + две записи памяти ≈1–1,3 с)
// шла раз в минуту при действующем наборе и раз в 10 с, когда купить нельзя (бюджет 10 млн исчерпан первой покупкой, автообновление
// выключено, цена выше лимита, мало адены, архив), — почти на каждой второй победе цепочки. Теперь «купить нельзя» — раз в 10 мин,
// early-loss — к концу оплаченного срока, свой оплаченный набор — за 1,5 мин до конца срока. Смена настроек/Старт снимают ожидание.
// Покупка и сверка оплаты прежние.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const H=3600000,PAID=18000000;
const reads=f=>f.gets.filter(p=>p==='/character').length;
// Победы цепочки «Охотиться дальше» ≈5 с/моб: проверка после каждой победы
const wins=async(f,ms,every=5000)=>{for(let t=0;t<ms;t+=every){f.tick(every);await f.step({afterWin:true});}};

test('бюджет исчерпан: после победы не чаще раза в 10 мин; новый бюджет — сразу проверка и покупка',async()=>{
 const f=fixture({char:{adena:'50000000'}});await f.step();assert.equal(f.calls.length,1);
 f.tick(PAID+1000);f.ch.revision++;await f.step({afterWin:true});assert.equal(f.status(),'budget');
 const g=reads(f);await wins(f,595000);assert.equal(reads(f),g,'за 10 мин побед — ни одного GET (было бы ≈60 пар GET)');
 await wins(f,10000);assert.equal(reads(f),g+1,'через 10 мин — одна проверка');assert.equal(f.status(),'budget');
 f.env.cfg.petFullBudget=20000000;f.tick(5000);await f.step({afterWin:true});
 assert.equal(f.calls.length,2,'смена настроек снимает ожидание — набор куплен сразу');assert.equal(f.env.rt.petFull.spent,20000000);
});

test('сброс бюджета кнопкой снимает ожидание (nextCheckAt 0)',async()=>{
 const f=fixture({char:{adena:'50000000'}});await f.step();f.tick(PAID+1000);f.ch.revision++;await f.step();assert.equal(f.status(),'budget');
 f.tick(5000);assert.equal(await f.reset(),true);await f.step({afterWin:true});assert.equal(f.calls.length,2);
});

for(const [name,cfg,code] of [['автообновление выключено',{petFullBudget:30000000,petFullRenew:false},'renew'],['цена выше лимита',{petFullMaxPrice:9999999},'price'],['мало адены',{petFullReserve:15000000},'reserve']])
 test(name+': следующая проверка через 10 мин, не через 10 с',async()=>{
  const f=fixture({cfg,char:{adena:'20000000'}});
  if(code==='renew'){await f.step();f.tick(PAID+1000);f.ch.revision++;}
  await f.step({afterWin:true});assert.equal(f.status(),code);const g=reads(f);
  await wins(f,595000);assert.equal(reads(f),g);await wins(f,10000);assert.equal(reads(f),g+1);
  assert.equal(f.calls.length,code==='renew'?1:0,'покупок сверх прежних нет');
 });

test('новый Старт и смена класса снимают ожидание «купить нельзя»',async()=>{
 for(const change of ['kick','class']){
  const f=fixture({cfg:{petFullMaxPrice:9999999}});await f.step();assert.equal(f.status(),'price');const g=reads(f);
  f.tick(5000);await f.step({afterWin:true});assert.equal(reads(f),g);
  if(change==='kick')f.env.rt.manualKickAt=77;else f.env.rt.classCur={prof:'human_warlock',slot:1};
  f.tick(5000);await f.step({afterWin:true});assert.equal(reads(f),g+1);
 }
});

test('early-loss: проверка к концу оплаченного срока, не каждые 10 с',async()=>{
 const f=fixture({cfg:{petFullBudget:30000000},char:{adena:'50000000'}});await f.step();const end=f.env.rt.petFull.lastReceipt.expiresAt;
 f.tick(61000);f.ch.activeSummon.activeBuffs=[];f.ch.revision++;await f.step({afterWin:true});assert.equal(f.status(),'early-loss');
 const g=reads(f);await wins(f,end-f.now()-60000,60000);assert.equal(reads(f),g,'весь оплаченный срок без проверок');
 await wins(f,120000,60000);assert.ok(reads(f)>g,'сразу после срока — проверка');assert.equal(f.calls.length,2,'после срока продление по прежним правилам (одна покупка)');
});

test('свой оплаченный набор: проверка за 1,5 мин до конца срока; продление вовремя; observedMs за весь срок',async()=>{
 const f=fixture({cfg:{petFullBudget:30000000},char:{adena:'50000000'}});await f.step();assert.equal(f.calls.length,1);const end=f.env.rt.petFull.lastReceipt.expiresAt;
 f.tick(61000);await f.step({afterWin:true});assert.equal(f.status(),'active');
 assert.ok(f.env.rt.petFull.nextCheckAt>=end-91000&&f.env.rt.petFull.nextCheckAt<=end-89000,'следующая проверка за 1,5 мин до конца');
 const g=reads(f);await wins(f,end-f.now()-95000);assert.equal(reads(f),g,'≈5 ч побед без GET (было бы ≈300 пар)');
 await wins(f,95000+10000);
 assert.ok(reads(f)-g>=2&&reads(f)-g<=4,'у конца срока — 2–4 проверки: '+(reads(f)-g));
 assert.equal(f.calls.length,2,'продление после истечения — одна покупка');
 assert.ok(f.env.rt.petFull.observedMs>=PAID-5*60000,'наблюдаемое время набора ≈ весь срок: '+f.env.rt.petFull.observedMs);
});

test('набор без квитанции бота проверяется как раньше — раз в минуту; разрыв больше минуты не засчитывается',async()=>{
 const f=fixture();f.apply();await f.step();assert.equal(f.status(),'active');const g=reads(f);
 await wins(f,55000);assert.equal(reads(f),g);await wins(f,10000);assert.equal(reads(f),g+1);
 const h=fixture();h.apply();await h.step();h.tick(120000);await h.step({forceRead:true});assert.equal(h.env.rt.petFull.observedMs||0,0);
});

test('свой набор: потеря и перепокупка меняют сроки — непрерывность не засчитывается',async()=>{
 const f=fixture({cfg:{petFullBudget:30000000},char:{adena:'50000000'}});await f.step();f.tick(61000);await f.step();const at=f.env.rt.petFull.observation.at;
 // те же типы эффектов, но другие сроки (перепокупка вручную) — набор уже не «свой», разрыв не засчитывается
 f.tick(2*H);for(const b of f.ch.activeSummon.activeBuffs)b.expiresAtMs+=7;f.ch.revision++;await f.step({forceRead:true});
 assert.equal(f.env.rt.petFull.observedMs||0,0);assert.ok(f.env.rt.petFull.observation.at>at);assert.equal(f.env.rt.petFull.observation.own,true,'сдвиг ≤1 мин — тот же оплаченный срок');
});

test('архив неизвестной попытки: ожидание до возможного срока, но не дольше 10 мин',async()=>{
 const f=fixture({post:()=>{throw Error('timeout')}});await f.step();f.ch.revision++;assert.equal((await f.archive()).ok,true);
 await f.step();assert.equal(f.status(),'archived');const left=f.env.rt.petFull.nextCheckAt-f.now();
 assert.ok(left>=599000&&left<=600000,'10 мин: '+left);assert.equal(f.calls.length,1);
});

test('бой на сервере после победы по-прежнему перепроверяется сразу (20.13)',async()=>{
 const f=fixture({cfg:{petFullMaxPrice:9999999},char:{inBattle:true}});await f.step();assert.equal(f.status(),'battle');
 f.ch.inBattle=false;f.tick(3000);await f.step({afterWin:true});assert.equal(f.status(),'price');
});
