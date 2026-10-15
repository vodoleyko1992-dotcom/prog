'use strict';
const assert=require('node:assert/strict');
const {journey,bosses,until,delay}=require('./v1024-journey-fixture.cjs');
async function test(kind){const ledger=/^(gm|fa|raid)-(reload|lost)$/.exec(kind);const priority=/^pending-(tvt|revive)$/.exec(kind);const f=await journey({holdKind:ledger?.[2]==='reload'?ledger[1]:null,lostKind:ledger?.[2]==='lost'?ledger[1]:priority?'gm':null,unproven:!!priority,holdTownCatalog:kind==='queued',holdCatalog:['stop','mode','tvt','resummon'].includes(kind),holdPayment:kind==='reload',networkPayment:kind==='network',death:kind==='death',travel:kind==='paid'||ledger?.[1]==='raid'});const debug=process.env.JOURNEY_DEBUG?setInterval(async()=>console.log('PROGRESS',JSON.stringify(await f.diag())),10000):null;try{
 await f.start();
 if(ledger){
  const paymentKind={gm:'shop',fa:'fa-buff',raid:'raid-teleport'}[ledger[1]],accepted=()=>ledger[1]==='gm'?f.S.buyPosts:ledger[1]==='fa'?f.S.heroBuffs.length:f.S.teleports.length;
  await until(()=>accepted()===1,60000);if(ledger[2]==='reload'){await until(()=>f.held());await f.h.g.p.reload();f.release();}
  // Потерянный ответ перелёта не сообщает браузеру новую страницу. Пользователь открывает карту; только её метка подтверждает прибытие.
  if(ledger[1]==='raid'){await until(async()=>!!(await f.h.get(['rt'])).rt.actionPayments?.pending);await delay(500);assert.equal(f.S.teleports.length,1);await f.h.g.p.goto('https://l2wap.com/map.html');}
  await until(async()=>{const p=(await f.h.get(['rt'])).rt.actionPayments;return !p?.pending&&p?.history?.some(x=>x.kind===paymentKind);},30000);await f.h.click('stop');assert.equal(accepted(),1);
  assert.equal((await f.h.get(['rt'])).rt.actionPayments.history.filter(x=>x.kind===paymentKind).length,1);
 }else if(kind==='queued'){
  await until(()=>f.held(),30000);await until(async()=>(await f.h.get(['rt'])).rt.actionOwner?.key==='petBufferTrip');
  // Внешняя пользовательская очередь, не вызов бизнес-функций и не подмена исполнителей.
  const queuedAt=f.paths.length;await f.h.g.core('setRt({shop:{step:"count",back:"/map.html",force:true,t:Date.now()},tbuff:{step:"fa",fa:[1059],t:Date.now()}})');f.release();
  await until(()=>f.S.buffPosts===1,30000);assert.ok(!f.paths.slice(queuedAt).some(p=>['/fast-aden-buffer.html','/gm-shop.html','/char.html'].includes(p)),'чужой маршрут начат до завершения оплаты суммона');await until(()=>f.S.buyPosts===1,30000);await f.h.click('stop');
  assert.ok(f.events.findIndex(x=>x.kind==='pet-buff')<f.events.findIndex(x=>x.kind==='buy'));assert.equal(f.paths.filter(p=>p==='/city.html').length,1);
 }else if(priority){
  await until(async()=>f.S.buyPosts===1&&!!(await f.h.get(['rt'])).rt.actionPayments?.pending,60000);
  if(priority[1]==='tvt'){f.S.register=true;await f.h.g.p.evaluate(()=>fetch('/game/tvt'));await until(()=>f.S.registered,20000);}
  else{f.S.hp=0;await f.h.g.p.goto('https://l2wap.com/map.html');await until(()=>f.h.g.core('on && tabOwner'));await f.h.g.core('setRt({revive:{t:Date.now(),url:"/map.html",revived:false}})');await until(()=>f.events.some(x=>x.kind==='revive'),20000);}
  await f.h.click('stop');assert.equal(f.S.buyPosts,1);assert.equal((await f.h.get(['rt'])).rt.actionPayments.pending.kind,'shop');assert.equal(f.S.wins.length,0);
 }else if(kind==='network'){await until(async()=>(await f.h.get(['rt'])).rt.petFull?.spent===10000000,30000);await f.h.click('stop');assert.equal(f.S.buffPosts,1);assert.equal((await f.h.get(['rt'])).rt.petFull.pending,null);}
 else if(kind==='death'){await until(()=>f.S.restores===1,60000);await f.h.click('stop');assert.equal(f.S.deaths,1);assert.equal(f.events.filter(x=>x.kind==='engage').length,1);assert.equal(f.S.buffPosts,1);}
 else if(kind==='full'||kind==='paid'){
  await until(()=>f.S.wins.length===2,120000);await f.h.click('stop');
  assert.deepEqual(f.S.wins,bosses.map(b=>b.id));assert.deepEqual(f.events.filter(x=>x.kind==='engage').map(x=>x.id),bosses.map(b=>b.id),'атака только выбранной цели и в порядке тура');if(kind==='paid')assert.deepEqual(f.S.teleports,bosses.map(b=>b.id));assert.equal(f.S.buffPosts,1);assert.equal(f.S.buyPosts,1);
  const first=f.events.findIndex(x=>x.kind==='engage');for(const kind of ['hero-buff','pet-buff','buy'])assert.ok(f.events.findIndex(x=>x.kind===kind)<first,kind);
  assert.equal(f.paths.filter(p=>p==='/city.html').length,1);assert.ok(f.paths.length<25,'маршрут зациклился');
 }else{await until(()=>f.held(),30000);
  if(kind==='stop'){await f.h.click('stop');await until(()=>f.h.g.core('!on'));f.release();await delay(1200);assert.equal(f.S.buffPosts,0);assert.equal(f.S.wins.length,0);}
  if(kind==='mode'){await f.h.click('tasksToggle');await until(()=>f.h.g.core('autonomyMode()==="tasks"'));f.release();await delay(1200);assert.equal(f.S.wins.length,0);assert.equal(f.events.some(x=>x.kind==='engage'),false);}
  if(kind==='tvt'){f.S.register=true;await f.h.g.p.evaluate(()=>fetch('/game/tvt'));f.release();await until(()=>f.S.registered,30000);await f.h.click('stop');assert.equal(f.S.buffPosts,0);assert.equal(f.S.wins.length,0);}
  if(kind==='resummon'){f.S.petLevel++;f.S.revision++;f.release();await until(()=>f.S.buffPosts===1,30000);await f.h.click('stop');assert.equal(f.events.find(x=>x.kind==='pet-buff').petLevel,f.S.petLevel);}
  if(kind==='reload'){await f.h.g.p.reload();f.release();await until(()=>f.h.g.core('on && tabOwner'));await until(async()=>(await f.h.get(['rt'])).rt.petFull?.spent===10000000,30000);await f.h.click('stop');assert.equal(f.S.buffPosts,1);}
 }
 assert.deepEqual(f.routeErrors.map(e=>e.message),[]);assert.deepEqual(f.h.errors,[]);console.log('PASS journey '+kind,JSON.stringify({events:f.events,paths:f.paths}));
}catch(e){console.error('DIAG '+kind,JSON.stringify(await f.diag()));throw e;}finally{clearInterval(debug);await f.close();}}
(async()=>{for(const kind of(process.env.JOURNEY_CASES||'full,stop,mode,tvt,resummon,reload,network,death,paid,gm-reload,gm-lost,fa-reload,fa-lost,raid-reload,raid-lost,queued,pending-tvt,pending-revive').split(','))await test(kind)})().catch(e=>{console.error(e.stack);process.exitCode=1});
