'use strict';
// 20.43 (разбор 21.10): проверка набора кота у Warlock после победы (свой GET /character + каталог + две записи памяти ≈1–1,3 с)
// шла раз в минуту при действующем наборе и раз в 10 с, когда купить нельзя (бюджет 10 млн исчерпан первой покупкой — снят в 20.60, автообновление
// выключено, цена выше лимита, мало адены, архив), — почти на каждой второй победе цепочки. Теперь «купить нельзя» — раз в 10 мин,
// early-loss — к концу оплаченного срока, свой оплаченный набор — за 1,5 мин до конца срока. Смена настроек/Старт снимают ожидание.
// Покупка и сверка оплаты прежние.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const H=3600000,PAID=18000000;
const reads=f=>f.gets.filter(p=>p==='/character').length;
// Победы цепочки «Охотиться дальше» ≈5 с/моб: проверка после каждой победы
const wins=async(f,ms,every=5000)=>{for(let t=0;t<ms;t+=every){f.tick(every);await f.step({afterWin:true});}};

// 20.60 (John 24.10: «Убери вообще лимит на Бафф суммонов»): общего бюджета нет. Ожидание «бюджет», записанное до обновления, — со старым
// ключом настроек: снимается сразу, набор покупается на первой победе после конца прежнего
test('старое ожидание «бюджет» после обновления не держит: набор куплен сразу',async()=>{
 const f=fixture({char:{adena:'50000000'}});await f.step();assert.equal(f.calls.length,1);
 f.tick(PAID+1000);f.ch.revision++;
 f.env.rt.petFull={...f.env.rt.petFull,status:'budget',reason:'Бюджет автобафа исчерпан; увеличьте лимит или явно сбросьте расход',nextCheckAt:Date.now()+600000,waitKey:'["old",10000000]'};
 await f.step({afterWin:true});
 assert.equal(f.calls.length,2);assert.equal(f.env.rt.petFull.spent,20000000);assert.notEqual(f.status(),'budget');
});

test('сброс счётчика кнопкой снимает ожидание (nextCheckAt 0)',async()=>{
 const f=fixture({cfg:{petFullMaxPrice:9999999}});await f.step();assert.equal(f.status(),'price');const g=reads(f);
 f.tick(5000);assert.equal(await f.reset(),true);await f.step({afterWin:true});assert.equal(reads(f),g+1);assert.equal(f.calls.length,0);
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

// 20.43 (ревью): waitKey писал только observe(); ветки «нет кота», «класс», «каталог», «бой», «ошибка чтения» ставили nextCheckAt без
// ключа — после Старта/смены класса старый ключ не совпадал, срок не действовал, и каждый круг цикла (≈0,3 с) шёл свой GET /character
test('после Старта/смены класса ветки без observe держат свой срок: 100 кругов по 300 мс — не больше 3 GET',async()=>{
 for(const change of ['kick','class'])for(const kind of ['pet','class','catalog','battle','read']){
  let broken=false;const f=fixture({cfg:{petFullMaxPrice:9999999},read:p=>{if(broken&&p==='/character')throw Error('read_failed')}});
  await f.step();assert.equal(f.status(),'price');assert.ok(f.env.rt.petFull.waitKey,'ключ записан при наблюдении');
  if(kind==='pet')f.ch.activeSummon=null;if(kind==='class')f.ch.l2Profession='human_sorcerer';if(kind==='catalog')f.cat.sets=[];if(kind==='battle')f.ch.inBattle=true;if(kind==='read')broken=true;
  if(change==='kick')f.env.rt.manualKickAt=55;else f.env.rt.classCur={prof:'human_warlock',slot:1};
  const g=reads(f);for(let i=0;i<100;i++){f.tick(300);await f.step();}
  const n=reads(f)-g;assert.ok(n>=1&&n<=3,`${change}/${kind}: ${n} GET за 30 с (было 100)`);assert.equal(f.status(),kind);
  assert.equal(f.calls.length,0,'покупок нет');
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
