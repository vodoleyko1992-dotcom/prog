'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/dungeons.js','utf8');
function fixture({counts={green:2718796,blue:1434738,red:753415},cap=1000000,nativeMax='',mode='normal',change}={}){
 let net=null,aa=0;const bag={...counts},sent=[],logs=[],rt={char:'Hero',manualKickAt:1,sealEx:{t:Date.now(),manual:true}},loc={pathname:'/ancient-trader.html',href:''};
 const rows=Object.keys(bag).map(st=>{const inp={value:'',getAttribute:()=>nativeMax,dispatchEvent(){if(mode==='clamped'&&+this.value>80)this.value='80'}},btn={disabled:mode==='disabled'},row={dataset:{stone:st},querySelector:q=>q.includes('owned__value')?{textContent:String(bag[st])}:q.includes('__input')?inp:q.includes('__btn')?btn:null};btn.row=row;btn.inp=inp;return row});
 const env={rt,cfg:{},on:true,tabOwner:true,leaseEpoch:1,routeLocation:loc,canAct:()=>true,canRun:()=>true,
  setRt:async p=>{Object.assign(rt,p);return {ok:true}},rtCommit:async()=>true,pause:async()=>change?.(env),sleep:async()=>{},rec:(...a)=>logs.push(a.join(' ')),setStatus(){},
  waitX:async f=>f(),sealNet:()=>net,fire:btn=>{
   const stone=btn.row.dataset.stone,qty=+btn.inp.value;sent.push({stone,qty});
   if(mode==='false-click')return false;
   if(mode==='lost'){bag[stone]-=qty;return true;}
   if(mode==='stale'){net={t:Date.now(),ok:true,status:200,stone:'other',qty};return true;}
   if(mode==='same-old')return true;
   if(qty>cap||mode==='reject-all'){net={t:Date.now(),ok:false,status:400,code:'invalid_quantity',msg:'Некоректна кількість.',stone,qty};return true;}
   if(mode==='server'){net={t:Date.now(),ok:false,status:503,stone,qty};return true;}
   assert.ok(qty>0&&qty<=bag[stone]);bag[stone]-=qty;aa+=qty*({green:5,blue:3,red:10}[stone]);net={t:Date.now(),ok:true,status:200,stone,qty};return true;
  }};
 const b={Date,Event:class{},document:{querySelectorAll:()=>rows},chrome:{storage:{local:{set:async p=>{Object.assign(env,p)}}}}};vm.runInNewContext(source,b);let module=b.L2V7Factories.dungeons(env);
 return {env,rt,bag,sent,logs,loc,get aa(){return aa},step:()=>module.sealStep(),reload:()=>{module=b.L2V7Factories.dungeons(env)},setNet:n=>{net=n}};
}
test('журнал21:36: миллионные стеки всех трёх цветов обмениваются партиями без invalid_quantity',async()=>{
 const f=fixture();await f.step();assert.deepEqual(f.sent,[{stone:'green',qty:1000000},{stone:'green',qty:1000000},{stone:'green',qty:718796},{stone:'blue',qty:1000000},{stone:'blue',qty:434738},{stone:'red',qty:753415}]);assert.deepEqual(f.bag,{green:0,blue:0,red:0});assert.equal(f.aa,25432344);assert.equal(f.rt.sealEx,null);assert.match(f.rt.sealLast.why,/2718796 зелёных/);assert.match(f.rt.sealLast.why,/1434738 синих/);assert.match(f.rt.sealLast.why,/753415 красных/);
});
test('более строгий сервер: только явный invalid_quantity уменьшает партию до принятой',async()=>{
 const f=fixture({counts:{green:1100000},cap:300000});for(let i=0;i<5&&f.rt.sealEx;i++)await f.step();assert.deepEqual(f.sent.map(x=>x.qty),[1000000,500000,250000,250000,250000,250000,100000]);assert.equal(f.bag.green,0);assert.equal(f.aa,5500000);
});
test('предел поля количества учитывается до первого клика',async()=>{
 const f=fixture({counts:{green:250},cap:100,nativeMax:'100'});await f.step();assert.deepEqual(f.sent.map(x=>x.qty),[100,100,50]);assert.equal(f.aa,1250);
});
test('устаревший ответ прошлого цвета/количества не подтверждает новый обмен',async()=>{
 const f=fixture({counts:{green:200},mode:'stale'});await f.step();assert.equal(f.sent.length,1);assert.equal(f.aa,0);assert.match(f.rt.sealLast.why,/нет подтверждённого ответа/);
});
test('тот же объект старой квитанции с будущим временем не используется повторно',async()=>{
 const f=fixture({counts:{green:200},mode:'same-old'});f.setNet({t:Date.now()+10000,ok:true,status:200,stone:'green',qty:200});await f.step();assert.equal(f.sent.length,1);assert.match(f.rt.sealLast.why,/нет подтверждённого ответа/);
});
for(const mode of ['lost','server'])test('неизвестный исход не повторяет партию и не переключается на следующий цвет: '+mode,async()=>{
 const f=fixture({mode});await f.step();assert.equal(f.sent.length,1);assert.equal(f.rt.sealEx,null);assert.match(f.rt.sealLast.why,/не вышло/);
});
test('размер1 с invalid_quantity завершает маршрут, а не бесконечно уменьшает',async()=>{
 const f=fixture({counts:{green:3},mode:'reject-all'});await f.step();assert.deepEqual(f.sent.map(x=>x.qty),[3,1]);assert.match(f.rt.sealLast.why,/не вышло/);
});
test('большое число партий отдаёт управление диспетчеру; reload продолжает с сохранённого остатка',async()=>{
 const f=fixture({counts:{green:10000001}});await f.step();assert.equal(f.sent.length,8);assert.equal(f.rt.sealEx.remaining.green,2000001);assert.equal(f.rt.sealEx.exchanged.green,8000000);f.reload();await f.step();assert.equal(f.bag.green,0);assert.equal(f.sent.length,11);assert.equal(f.aa,50000005);assert.match(f.rt.sealLast.why,/10000001 зелёных/);
});
for(const change of [e=>e.on=false,e=>e.tabOwner=false,e=>e.rt.char='Other',e=>e.rt.manualKickAt++,e=>e.leaseEpoch++])test('смена управления перед кликом не обменивает камни',async()=>{
 const f=fixture({change});await f.step();assert.equal(f.sent.length,0);
});
test('disabled и отклонённый центральным fire клик не выдают обмен за успешный',async()=>{
 const f=fixture({mode:'disabled'});await f.step();assert.equal(f.sent.length,0);assert.match(f.rt.sealLast.why,/кнопка обмена недоступна/);
 const g=fixture({mode:'false-click'});await g.step();assert.equal(g.aa,0);assert.ok(g.rt.sealEx);assert.equal(g.rt.sealLast,undefined);
});

test('native input нормализует количество: учитываем именно отправленную партию',async()=>{
 const f=fixture({counts:{green:200},mode:'clamped'});await f.step();assert.deepEqual(f.sent.map(x=>x.qty),[80,80,40]);assert.equal(f.aa,1000);
});
