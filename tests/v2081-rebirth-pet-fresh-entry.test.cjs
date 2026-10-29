'use strict';
// 20.81 (лог 29.10 20:05–20:15): новый Rebirth-вход сверяет живые эффекты кота, а не срок старой проверки.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const same=(a,b,msg)=>assert.equal(JSON.stringify(a),JSON.stringify(b),msg);
function own(o={}){
 const f=fixture({...o,cfg:{petAuto:false,petFullAuto:false,...o.cfg}}),logs=[],trips=[];
 const raw={petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:null,petFullRenew:true,shopReserve:200000,...o.raw};
 Object.assign(f.env,{leaseEpoch:'owner',canAct:()=>true,canRun:()=>true,rebirthCfg:()=>raw,
  rec:(...args)=>logs.push(args),townBufferStart:async p=>{trips.push(p);return true;}});
 f.env.rt.rebirth={runId:'11111111-1111-4111-8111-111111111111'};
 const cached=({expired=false}={})=>{f.env.rt.petFull={status:'active',lastCheckAt:f.now()-60000,nextCheckAt:f.now()+3600000,
  expiresAt:f.now()+(expired?-1:3600000),lastReceipt:{id:'old-paid',petKey:'kai_the_cat',revision:99,expiresAt:f.now()+(expired?-1:3600000)}};};
 return{...f,logs,trips,raw,cached,prep:allowTown=>f.api().rebirthPrepare({wanted:()=>true,returnPath:'/rebirth-raids.html',allowTown})};
}
test('новый вход не пропускает живую проверку из-за старого nextCheckAt',async()=>{
 const f=own();f.cached();await f.prep(true);
 same(f.gets,['/character','/character/town/buffer/catalog']);assert.equal(f.status(),'early-loss');
 assert.equal(f.calls.length,0,'не тратим повторно до конца оплаченного срока');
 assert.ok(f.logs.some(x=>x[0]==='B'&&x[1]==='суммон'&&/перед новым входом|Перед новым входом/.test(x[2])&&/оплачен/.test(x[2])));
});
test('истёкшая квитанция со старой паузой больше не запрещает обычное разрешённое обновление',async()=>{
 const f=own();f.cached({expired:true});await f.prep(true);
 assert.equal(f.calls.length,1);assert.equal(f.status(),'active');assert.equal(f.calls[0].body.expectedFeeCoinOfLuck,0);
 assert.equal(f.calls[0].body.expectedFeeAdena,'10000000');
});
test('свежая проверка выполняется один раз для этого входа и заново для следующего run',async()=>{
 const f=own();f.apply();f.cached();await f.prep(true);const read=f.gets.length;
 assert.equal(read,2);assert.equal(f.status(),'active');await f.prep(true);await f.prep(true);assert.equal(f.gets.length,read);
 f.env.rt.rebirth.runId='22222222-2222-4222-8222-222222222222';await f.prep(true);assert.equal(f.gets.length,read+2);same(f.calls,[]);
});
test('ранняя потеря сообщается один раз для входа, но не разрешает новую покупку',async()=>{
 const f=own();f.cached();const before=structuredClone(f.env.rt.petFull.lastReceipt);await f.prep(true);await f.prep(true);
 assert.equal(f.logs.filter(x=>x[1]==='суммон').length,1);same(f.env.rt.petFull.lastReceipt,before);same(f.calls,[]);
 f.env.rt.rebirth.runId='22222222-2222-4222-8222-222222222222';await f.prep(true);
 assert.equal(f.logs.filter(x=>x[1]==='суммон').length,2);same(f.calls,[]);
});
for(const allowTown of [undefined,false])test('внутри run нет свежей платной сверки, города или оплаты: '+allowTown,async()=>{
 const f=own();f.cached({expired:true});await f.prep(allowTown);same(f.gets,[]);same(f.calls,[]);same(f.trips,[]);
});
// 20.82: лимит цены и резерв сняты; остались нехватка адены на сам набор и выключенное автообновление
for(const reason of ['adena','renew'])test('свежая проверка не обходит прежний запрет '+reason,async()=>{
 const f=own(reason==='adena'?{char:{adena:'9999999'}}:{raw:{petFullRenew:false}});
 f.cached({expired:true});await f.prep(true);assert.equal(f.status(),reason);same(f.calls,[]);same(f.trips,[]);
});
test('неизвестная покупка остаётся неизвестной после свежей проверки перед входом',async()=>{
 const f=own({post:()=>{throw Error('lost_response');}});await f.prep(true);assert.equal(f.calls.length,1);const p=structuredClone(f.env.rt.petFull.pending);
 f.env.rt.rebirth.runId='22222222-2222-4222-8222-222222222222';await f.prep(true);assert.equal(f.calls.length,1);same(f.env.rt.petFull.pending,p);
});
for(const change of ['stop','owner','mode','kick','lease'])test('отмена '+change+' во время свежего чтения не начинает оплату',async()=>{
 const f=own({read:(path,e)=>{if(path!=='/character')return;if(change==='stop')e.on=false;if(change==='owner')e.tabOwner=false;
  if(change==='mode')e.rebirthCfg=()=>null;if(change==='kick')e.rt.manualKickAt=1;if(change==='lease')e.leaseEpoch='other';}});
 f.cached({expired:true});await f.prep(true);same(f.calls,[]);same(f.trips,[]);
});
test('ошибка свежего чтения оставляет штатную паузу, а не новый запрос на каждом тике',async()=>{
 const f=own({read:()=>{throw Error('unavailable');}});f.cached();await f.prep(true);assert.equal(f.gets.length,1);assert.equal(f.status(),'read');
 await f.prep(true);await f.prep(true);assert.equal(f.gets.length,1);same(f.calls,[]);
});
test('отменённый темп действий не засчитывает пропущенную свежую проверку',async()=>{
 const f=own();f.cached({expired:true});let allowed=false;f.env.actionWait=async()=>allowed;
 assert.equal(await f.prep(true),true);same(f.gets,[]);same(f.calls,[]);
 allowed=true;await f.prep(true);assert.equal(f.calls.length,1);assert.equal(f.status(),'active');
});
