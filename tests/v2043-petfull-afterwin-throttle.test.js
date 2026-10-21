'use strict';
// 20.43 (лог 21.10 15:47–15:51, Arcana Lord в катакомбах): проверка автобафа после победы раз в ≈10 с давала два GET
// и две ожидаемые полные записи памяти (+0,9–1,8 с на каждой ≈3-й победе). Теперь после победы — не чаще раза в 60 с без перемен,
// справочные статусы без изменения смысла не пишутся, наблюдение не ждёт записи. Оплата — прежним путём.
const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./warlock-fixture.cjs');
const chars=f=>f.gets.filter(p=>p==='/character').length;
function earlyLoss(){
 const f=fixture({battle:true,win:true,cfg:{petFullBudget:30000000},char:{adena:'50000000'}});
 return f;
}
test('10 побед за 45 с с потерянным оплаченным бафом — не больше одного GET /character',async()=>{
 const f=earlyLoss();await f.step({afterWin:true});assert.equal(f.calls.length,1,'первая покупка');
 f.tick(61000);f.ch.activeSummon.activeBuffs=[];f.ch.revision++;
 const g0=chars(f);
 for(let i=0;i<10;i++){await f.step({afterWin:true});f.tick(4500);}
 assert.ok(chars(f)-g0<=1,'GET после побед: '+(chars(f)-g0));
 assert.equal(f.status(),'early-loss');assert.equal(f.calls.length,1,'повторной оплаты нет');
});
// Слияние с PR #324: early-loss ждёт конца оплаченного срока (v2043-warlock-recheck), а не 60 с ворот после победы
test('без изменений статус после победы не переписывается; early-loss ждёт конца оплаченного срока',async()=>{
 const f=earlyLoss();await f.step({afterWin:true});f.tick(61000);f.ch.activeSummon.activeBuffs=[];f.ch.revision++;
 await f.step({afterWin:true});assert.equal(f.status(),'early-loss');
 const w=f.writes.length,g=chars(f);f.tick(61000);await f.step({afterWin:true});
 assert.equal(chars(f),g,'через 60 с — без GET: срок ещё оплачен');
 assert.ok(f.writes.length<=w,'статус тот же — без записей');
});
test('новый призыв кота снимает ворота: проверка сразу после победы',async()=>{
 const f=earlyLoss();await f.step({afterWin:true});f.tick(61000);f.ch.activeSummon.activeBuffs=[];f.ch.revision++;
 await f.step({afterWin:true});const g=chars(f);f.tick(5000);await f.step({afterWin:true});assert.equal(chars(f),g,'ворота держат');
 f.tick(1000);f.env.rt.petBornT=f.now();f.tick(11000);await f.step({afterWin:true});assert.equal(chars(f),g+1,'кот призван заново — проверка');
});
test('«бой на сервере» после победы перепроверяется не больше двух раз подряд',async()=>{
 const f=fixture({battle:true,win:true,char:{inBattle:true}});
 for(let i=0;i<6;i++){await f.step({afterWin:true});f.tick(4000);}
 assert.ok(chars(f)<=3,'GET: '+chars(f));
});
test('путь оплаты прежний: запрос сохраняется и подтверждается до POST',async()=>{
 const order=[];const f=fixture({battle:true,win:true,commit:()=>order.push('commit')});
 const post=f.env.gamePost;f.env.gamePost=async(...a)=>{order.push('post');return post(...a)};
 await f.step({afterWin:true});assert.deepEqual(order.slice(0,2),['commit','post']);assert.equal(f.calls.length,1);assert.equal(f.status(),'active');
});
