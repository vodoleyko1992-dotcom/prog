'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(saved={}){
 const box={Date,JSON,Object,Proxy};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/actions.js','utf8'),box);
 let id=0,mode='raid',lease='a',page='/map.html',interrupt=false,battle=false,commit=true;
 const calls=[],run={},env={rt:{char:'Hero',...saved},cfg:{},on:true,tabOwner:true,mode:()=>mode,lease:()=>lease,page:()=>page,id:()=>String(++id),
  setRt:async p=>{Object.assign(env.rt,p);return {ok:commit}},rtCommit:async()=>commit,rec(){},setStatus:s=>calls.push(s),halt:async s=>{calls.push('halt');env.on=false},isBattle:()=>battle,interrupted:()=>interrupt,
  paymentPending:()=>env.rt.actionPayments?.pending,reconcile:async()=>calls.push('reconcile'),
  jobs:()=>['tbuff','petBufferTrip','shop','rbGo','zoneGo'].map(key=>({key,run:async()=>{calls.push(key);await run[key]?.();}}))};
 const A=box.L2V7Factories.actions(env);A.enterFrame();
 return {A,env,calls,run,page:v=>page=v,mode:v=>mode=v,lease:v=>lease=v,interrupt:v=>interrupt=v,battle:v=>battle=v,commit:v=>commit=v};
}
test('начатый поход суммона завершается прежде очереди магазина и баффера',async()=>{
 const f=fixture({petBufferTrip:{id:'cat',phase:'city'}});await f.A.dispatch();f.env.rt.shop={step:'count'};f.env.rt.tbuff={step:'fa'};await f.A.dispatch();assert.deepEqual(f.calls,['petBufferTrip','petBufferTrip']);
 f.run.petBufferTrip=()=>{f.env.rt.petBufferTrip=null};await f.A.dispatch();await f.A.dispatch();assert.equal(f.calls.at(-1),'tbuff');
});
test('reload продолжает сохранённого владельца, не выбирает более ранний сервис',async()=>{
 const f=fixture({petBufferTrip:{id:'cat',phase:'pay'}});await f.A.dispatch();const g=fixture(JSON.parse(JSON.stringify({...f.env.rt,tbuff:{step:'fa'}})));await g.A.dispatch();assert.deepEqual(g.calls,['petBufferTrip']);
});
for(const change of ['mode','kick','lease','stop','TvT'])test('после await '+change+' запрещает старые переходы',async()=>{
 const f=fixture({shop:{step:'buy'}}),native={href:'/shop'};const loc=f.A.locationProxy(native);
 f.run.shop=async()=>{await Promise.resolve();if(change==='mode')f.mode('farm');if(change==='kick')f.env.rt.manualKickAt=1;if(change==='lease')f.lease('b');if(change==='stop')f.env.on=false;if(change==='TvT')f.interrupt(true);loc.href='/old-map';assert.equal(f.A.canAct(),false);};
 await f.A.dispatch();assert.equal(native.href,'/shop');
});
test('ручная смена режима отменяет старые маршруты, не трогает историю оплаты',async()=>{
 const f=fixture({shop:{step:'buy',t:1},actionPayments:{history:[{id:'receipt'}]}});await f.A.dispatch();f.mode('farm');f.env.rt.manualKickAt=2;f.A.enterFrame();await f.A.dispatch();assert.equal(f.env.rt.shop,null);assert.equal(f.env.rt.actionPayments.history[0].id,'receipt');
});
test('unknown после смены режима/reload разрешает только сверку, без маршрутов',async()=>{
 const f=fixture({shop:{step:'buy'},actionPayments:{pending:{kind:'shop'}}});f.mode('farm');f.A.enterFrame();await f.A.dispatch();assert.deepEqual(f.calls,['reconcile']);assert.ok(f.env.rt.actionPayments.pending);
});
test('неудачная durable запись владельца не разрешает действие',async()=>{
 // 17.10: ожидание записи теперь видно игроку; запуск shop по-прежнему запрещён.
 const f=fixture({shop:{step:'buy'}});f.commit(false);await f.A.dispatch();assert.deepEqual(f.calls,['Служебный маршрут: жду сохранения состояния']);
});
test('петля переходов без нового этапа ограничена и переживает reload',async()=>{
 let f=fixture({shop:{step:'buy'}});for(let i=0;i<12&&f.env.on;i++){f.page(i%2?'/map.html':'/shop.html');await f.A.dispatch();if(i===5)f=fixture(JSON.parse(JSON.stringify(f.env.rt)));}assert.ok(f.calls.includes('halt'));
});
test('смена этапа сбрасывает счётчик переходов',async()=>{
 const f=fixture({shop:{step:'count'}});for(let i=0;i<15;i++){f.page('/page'+i);f.env.rt.shop.step='stage'+i;await f.A.dispatch();}assert.equal(f.env.on,true);
});
test('рейд делегирует бафферу и продолжается после завершения',async()=>{
 const f=fixture({rbGo:{id:'boss'}});await f.A.dispatch();f.env.rt.tbuff={step:'fa'};f.run.tbuff=()=>{f.env.rt.tbuff=null};await f.A.dispatch();await f.A.dispatch();assert.deepEqual(f.calls,['rbGo','tbuff','rbGo']);
});
test('восстановление после смерти временно сильнее маршрута суммона',async()=>{
 const f=fixture({petBufferTrip:{id:'cat',phase:'pay'}});await f.A.dispatch();f.env.rt.tbuff={step:'restore'};f.run.tbuff=()=>{f.env.rt.tbuff=null};await f.A.dispatch();await f.A.dispatch();assert.deepEqual(f.calls,['petBufferTrip','tbuff','petBufferTrip']);
});

test('неизвестная оплата не мешает бою и не задерживает его GET-сверкой',async()=>{
 const f=fixture({actionPayments:{pending:{id:'p',kind:'shop'}}});f.battle(true);f.env.combatActive=()=>true;f.env.runCombat=async()=>f.calls.push('combat');await f.A.dispatch();assert.deepEqual(f.calls,['combat']);
});
test('неизвестная оплата не опрашивает сервер каждый тик, новая страница разрешает сверку',async()=>{
 const f=fixture({actionPayments:{pending:{id:'p',kind:'shop'}}});for(let i=0;i<30;i++)await f.A.dispatch();assert.deepEqual(f.calls,['reconcile']);f.page('/char.html');await f.A.dispatch();assert.deepEqual(f.calls,['reconcile','reconcile']);
});
test('изменение ресурса без manualKick отменяет старый маршрут',async()=>{
 const f=fixture({zoneGo:{id:'old'}});f.env.cfg.farmRes='iron';f.A.enterFrame();await f.A.dispatch();f.env.cfg.farmRes='coal';f.A.enterFrame();await f.A.dispatch();assert.equal(f.env.rt.zoneGo,null);assert.equal(f.env.rt.actionOwner,null);
});
test('экстренное снабжение в бою прерывает обычный маршрут, который остаётся в очереди',async()=>{
 const f=fixture({petBufferTrip:{phase:'city'}});await f.A.dispatch();f.battle(true);f.env.rt.shop={step:'count',urgent:true};await f.A.dispatch();assert.equal(f.calls.at(-1),'shop');assert.ok(f.env.rt.petBufferTrip);assert.equal(f.env.rt.actionOwner.key,'shop');
});

test('ручная срочная закупка прерывает маршрут и вне боя',async()=>{
 const f=fixture({petBufferTrip:{phase:'pay'}});await f.A.dispatch();f.env.rt.shop={step:'count',urgent:true};await f.A.dispatch();assert.equal(f.calls.at(-1),'shop');assert.ok(f.env.rt.petBufferTrip);assert.equal(f.env.rt.actionOwner.key,'shop');
});
test('неизвестная оплата не блокирует обработку победы и поражения',async()=>{
 const f=fixture({actionPayments:{pending:{id:'p',kind:'shop'}}});f.battle(true);f.env.combatActive=()=>false;f.env.runCombat=async()=>f.calls.push('outcome');await f.A.dispatch();assert.deepEqual(f.calls,['outcome']);assert.equal(f.A.hasPending(),true);
});
test('отключение автообучения освобождает владельца магистра',async()=>{
 const source=fs.readFileSync(__dirname+'/../content.js','utf8');
 const disable=source.match(/async function magisterDisable\(\) \{[\s\S]*?\n\}/)[0];
 const runner=source.match(/\{key:'magister',run:(async\(\)=>\{[^\n]+?\})\},/)[1];
 const f=fixture({magister:{t:1}});f.env.cfg.autoMagister=false;
 const box={L2EngineCore:require('../engine-core.js'),cfg:f.env.cfg,rt:f.env.rt,on:true,tabOwner:true,setRt:f.env.setRt,magisterStep:()=>{throw Error('disabled job ran')}};
 vm.runInNewContext(disable+';run='+runner,box);f.env.jobs=()=>[{key:'magister',run:box.run}];await f.A.dispatch();assert.equal(f.env.rt.magister,null);assert.equal(f.env.rt.actionOwner,null);
});

test('отмена старого владельца не стирает новую задачу того же ключа',async()=>{
 const f=fixture({shop:{step:'buy',t:1}});await f.A.dispatch();f.mode('farm');f.env.rt.manualKickAt=2;f.env.rt.shop={step:'count',t:3};f.A.enterFrame();await f.A.dispatch();assert.equal(f.env.rt.shop.t,3);assert.equal(f.env.rt.actionOwner,null);await f.A.dispatch();assert.equal(f.env.rt.actionOwner.stamp,'3');
});

test('Stop блокирует автоматический переход, но допускает отдельное разрешение ручного просмотра',()=>{
 const f=fixture(),native={href:'/map.html'};f.env.on=false;f.A.locationProxy(native).href='/automatic';assert.equal(native.href,'/map.html');let manual=true;const loc=f.A.locationProxy(native,()=>manual);loc.href='/char.html';assert.equal(native.href,'/char.html');manual=false;loc.href='/late';assert.equal(native.href,'/char.html');
});

test('цикл A→B→A с изменением фазы также ограничен и переживает reload',async()=>{
 let f=fixture({petBufferTrip:{id:'cycle',phase:'city'}});for(let i=0;i<14&&f.env.on;i++){f.env.rt.petBufferTrip.phase=i%2?'pay':'city';f.page(i%2?'/town-buffer.html':'/city.html');await f.A.dispatch();if(i===5)f=fixture(JSON.parse(JSON.stringify(f.env.rt)));}assert.ok(f.calls.includes('halt'));
});
