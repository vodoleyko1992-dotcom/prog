'use strict';
// 20.13 (ревизия 17.10, шаг 5, аудит combat/C10): автобаф суммона при бое на сервере (inBattle) не ставил nextCheckAt —
// GET /character уходил на каждом тике главного цикла. Теперь следующая проверка не раньше чем через 10 с.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
test('бой на сервере: повторный GET /character не раньше чем через 10 с',async()=>{
 const f=fixture({char:{inBattle:true}});
 await f.step();
 assert.equal(f.status(),'battle');
 assert.equal(f.gets.filter(p=>p==='/character').length,1);
 for(let i=0;i<20;i++){f.tick(100);await f.step();}
 assert.equal(f.gets.filter(p=>p==='/character').length,1,'за 2 с повторных запросов нет');
 f.tick(10000);await f.step();
 assert.equal(f.gets.filter(p=>p==='/character').length,2,'через 10 с проверка повторяется');
 assert.equal(f.calls.length,0,'в бою ничего не покупается');
});
test('после победы проверка не ждёт паузы «бой на сервере», тики цикла — ждут',async()=>{
 const f=fixture({char:{inBattle:true}});
 await f.step();
 assert.equal(f.status(),'battle');
 f.ch.inBattle=false;f.tick(3000);
 await f.step();
 assert.equal(f.gets.filter(p=>p==='/character').length,1,'тик цикла ждёт 10 с');
 await f.step({afterWin:true});
 assert.ok(f.gets.filter(p=>p==='/character').length>=2,'после победы — сразу проверка');
 assert.notEqual(f.status(),'battle');
});
