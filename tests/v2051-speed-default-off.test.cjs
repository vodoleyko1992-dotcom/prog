'use strict';
// 23.10.2026: умолчание отключает только добавочную паузу, не проверки контекста.
const test=require('node:test'),assert=require('node:assert/strict');
const {createActionPace}=require('../engine-core.js');
function setup(value){let now=10000,delay=value;const sleeps=[];const p=createActionPace({delay:()=>delay,clock:()=>now,read:()=>10000,sleep:async ms=>{sleeps.push(ms);now+=ms;}});return {p,sleeps,now:()=>now,set:value=>{delay=value;}};}
for(const value of [0,undefined,NaN,Infinity,'invalid'])test('нет добавочной паузы при '+String(value)+' и свежей отметке прошлого действия',async()=>{
 const f=setup(value);f.p.note();assert.equal(f.p.gap(),0);assert.equal(f.p.left(),0);assert.equal(await f.p.wait(),true);assert.deepEqual(f.sleeps,[]);assert.equal(f.now(),10000);
});
test('нулевая пауза не разрешает действие после Stop/смены контекста',async()=>{const f=setup(0);assert.equal(await f.p.wait(()=>false),false);assert.deepEqual(f.sleeps,[]);});
test('свои положительные настройки продолжают задавать ожидание',async()=>{const f=setup(2300);f.p.note();await f.p.wait();assert.equal(f.now(),12300);assert.equal(f.p.gap(),2300);});
test('положение 0,1 с работает без прежнего нижнего ограничения 0,5 с',async()=>{const f=setup(100);f.p.note();await f.p.wait();assert.equal(f.now(),10100);assert.deepEqual(f.sleeps,[100]);});
test('после включения паузы учитывается последнее действие даже если оно было при нуле',async()=>{const f=setup(0);f.p.note();await f.p.wait();f.set(1000);await f.p.wait();assert.equal(f.now(),11000);});
test('переключение в ноль прекращает оставшуюся добавочную паузу',async()=>{
 let now=10000,value=5000,sleeps=0;const p=createActionPace({delay:()=>value,clock:()=>now,sleep:async ms=>{now+=ms;sleeps++;value=0;}});p.note();assert.equal(await p.wait(),true);assert.equal(sleeps,1);assert.equal(now,10100);assert.equal(p.left(),0);
});
