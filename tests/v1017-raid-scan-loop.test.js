'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mk,docOf}=require('./epic-harness.cjs');
const MIN=60000;
function page(){return docOf('<div id="rb-pager-ind">1 / 14</div><div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">РБ 50</span><span class="l2-rb-row__level">50</span><span class="l2-rb-row__status l2-rb-row__status--alive">Жив</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="low">Телепорт</button></div></div><button id="rb-pager-next">Дальше</button>')}
for(const value of [false,true])test('частичный список не вызывает немедленный повтор при rbValueTour='+value,async()=>{
 const m=mk({path:'/rb-bosses.html',search:'?page=1',doc:page(),cfg:{rbValueTour:value},rt:{rbScan:true,rbList:{old:{name:'Старый',lvl:45,alive:true}}}});
 const start=Date.now();await m.R.rbListScan();
 assert.ok(m.env.rt.rbList.old);assert.ok(m.env.rt.rbList.low);
 assert.equal(m.env.rt.rbScan,null);assert.equal(m.loc.href,'/map.html');
 const age=Date.now()-m.env.rt.rbListT,ttl=(value?10:15)*MIN;
 assert.ok(age>=ttl-3*MIN-1000&&age<ttl-3*MIN+1000,`age=${age}`);
 assert.ok(Date.now()-m.env.rt.rbListT<ttl);
 assert.ok(m.logs.some(x=>x.includes('перечитаю через 3 мин')));
 assert.ok(Date.now()-start<1000);
});
test('пустая страница также ставит трёхминутную паузу и возвращает на карту',async()=>{
 const m=mk({path:'/rb-bosses.html',doc:docOf('<div id="rb-list"></div>'),cfg:{rbValueTour:true},rt:{rbScan:true}});
 await m.R.rbListScan();assert.equal(m.loc.href,'/map.html');assert.ok(Date.now()-m.env.rt.rbListT<10*MIN);assert.equal(m.env.rt.rbScan,null);
});
