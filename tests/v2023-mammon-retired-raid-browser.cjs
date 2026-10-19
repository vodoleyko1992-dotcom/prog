'use strict';
// Настоящие MV3/core/Mammon и storage; HTTPS полностью перехвачен локальным стендом.
// Отдельные шаги вызываем под реальной арендой, удерживая автоматический main между ними.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false});try{
 const {p,core}=h.g;
 await core('running=true;loopT=Date.now();true');
 await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));
 await until(()=>core('on'));
 assert.equal(await core('tabLock()'),true,'настоящая аренда фонового ядра');
 assert.equal(await core('on&&tabOwner&&!!leaseEpoch&&isMap()'),true);

 async function seed(raid,payment=false){
  return core(`(async()=>{
   loopT=Date.now();
   await setCfg({autoTasks:${JSON.stringify(raid?['raid','mammon']:['mammon'])},taskOnly:false,enchantMode:false,
    rbHuntMode:${raid},rbMode:${raid},tvtOn:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmGoalItem:''});
   const now=Date.now();
   await setRt({rbSess:{on:true,bought:true,start:now-60000,t0:now-60000,until:now+3600000,k0:0},
    rbHunt:null,rbGo:null,zoneGo:null,shop:null,tbuff:null,magister:null,invScan:null,revive:null,
    mmJob:null,mmGoReq:{kind:'visit',npc:'order',t:now},mmGoSay:null,
    actionPayments:${payment?"{pending:{id:'synthetic-unknown-raid-payment',key:'raid:synthetic',kind:'raid',char:rt.char,at:now,phase:'sent',quote:{amount:100000,currency:'Adena'}}}":'{pending:null}'}});
   return await rtCommit();
  })()`);
 }
 async function step(){
  return core(`(async()=>{
   loopT=Date.now();const policy=await loopTaskList();
   const accepted=await L2V7Modules.mammon.mmStep();await rtCommit();
   return {policy:!!policy,accepted,session:rt.rbSess,job:rt.mmJob,req:rt.mmGoReq,
    pending:L2V7Modules.payments.pending(),free:L2V7Modules.mammon.modeFree(),tasks:cfg.autoTasks};
  })()`);
 }

 assert.equal(await seed(true),true);
 const selected=await step();
 assert.equal(selected.session.on,true,'выбранный тур сохраняет сессию');
 assert.equal(selected.accepted,false);assert.equal(selected.job,null);
 assert.equal(selected.req.kind,'visit');assert.equal(selected.free,false);
 assert.ok(selected.tasks.includes('raid'));

 assert.equal(await seed(false),true);
 const retired=await step();
 assert.equal(retired.session.on,false,'снятый тур освобождает завершённую сессию');
 assert.ok(retired.session.end>0);assert.equal(retired.accepted,true);
 assert.deepEqual({kind:retired.job.kind,visit:retired.job.visit,cmd:retired.job.cmd,step:retired.job.step},
  {kind:'order',visit:true,cmd:true,step:'go'});
 assert.equal(retired.req,null);assert.deepEqual(retired.tasks,['mammon']);
 const stored=(await h.get(['rt'])).rt;
 assert.equal(stored.rbSess.on,false);assert.equal(stored.mmJob.kind,'order');assert.equal(stored.mmGoReq,null);
 assert.equal(p.url(),'https://l2wap.com/map.html','создали маршрут, но не начали телепорт');

 assert.equal(await seed(false,true),true);
 const protectedPayment=await step();
 assert.equal(protectedPayment.session.on,false);
 assert.equal(protectedPayment.pending.id,'synthetic-unknown-raid-payment');
 assert.equal(protectedPayment.pending.phase,'sent');assert.equal(protectedPayment.free,false);
 assert.equal(protectedPayment.accepted,false);assert.equal(protectedPayment.job,null);
 assert.equal(protectedPayment.req.kind,'visit','команда ждёт исход оплаты');
 const protectedStored=(await h.get(['rt'])).rt;
 assert.equal(protectedStored.actionPayments.pending.id,'synthetic-unknown-raid-payment');
 assert.equal(protectedStored.mmJob,null);
 assert.ok(h.requests.every(r=>r.method==='GET'),'стенд не отправлял POST');
 assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3: снятый raid завершает rbSess и принимает команду Маммона; выбранный raid и неизвестная оплата сохраняют блокировку; storage, без телепорта/POST');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
