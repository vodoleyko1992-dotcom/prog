'use strict';
// 20.82 (John 30.10: «убери вообще лимиты на бафф кота, адены как грязи»): у полного бафа суммона нет потолка цены и резерва адены.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');

test('цена выше прежнего потолка и резерв больше остатка — набор всё равно покупается один раз',async()=>{
 const f=fixture({cfg:{petFullMaxPrice:1,petFullReserve:50000000,shopReserve:50000000},char:{adena:'30000000'}});
 f.set().feeAdena='25000000';await f.step();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.expectedFeeAdena,'25000000');assert.equal(f.status(),'active');
});
test('адены ровно на набор — покупка; на 1 меньше — нет, причина «адена», повтор через 10 мин',async()=>{
 const ok=fixture({char:{adena:'10000000'}});await ok.step();assert.equal(ok.calls.length,1);
 const poor=fixture({char:{adena:'9999999'}});await poor.step();assert.equal(poor.calls.length,0);assert.equal(poor.status(),'adena');
 assert.match(poor.env.rt.petFull.reason,/Не хватает адены на набор/);
 assert.ok(poor.env.rt.petFull.nextCheckAt-poor.now()>=599000);
});
test('смена прежних полей лимита не сбивает ожидание: они больше не входят в ключ',async()=>{
 const f=fixture({char:{adena:'9999999'}});await f.step();assert.equal(f.status(),'adena');const key=f.env.rt.petFull.waitKey;
 f.env.cfg.petFullMaxPrice=5;f.env.cfg.petFullReserve=7;f.env.cfg.shopReserve=9;f.tick(5000);await f.step();
 assert.equal(f.env.rt.petFull.waitKey,key);assert.equal(f.calls.length,0);
});
test('неизвестный исход оплаты по-прежнему запрещает вторую покупку',async()=>{
 const f=fixture({post:()=>{throw Error('lost_response');}});await f.step();assert.equal(f.calls.length,1);
 f.reload();f.tick(61000);await f.step({forceRead:true});assert.equal(f.calls.length,1);assert.ok(f.env.rt.petFull.pending);
});
