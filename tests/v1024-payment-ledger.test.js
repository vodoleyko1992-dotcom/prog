'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/payments.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 let disk={}, flush=true, saving=true, afterSave=null, commits=0;
 const env={on:true,tabOwner:true,rt:{char:'hero',manualKickAt:1,classCur:{prof:'human_warlock',slot:0}},autonomyMode:()=> 'raid',
  setRt:async patch=>{Object.assign(env.rt,patch);if(afterSave)afterSave();return {ok:saving}},
  rtCommit:async()=>{commits++;if(flush)disk=clone(env.rt);return flush},rec(){}};
 const load=()=>{const box={console,Date};vm.runInNewContext(source,box);return box.L2V7Factories.payments(env)};
 let api=load();return {env,get api(){return api},commits:()=>commits,disk:()=>disk,flush:v=>flush=v,saving:v=>saving=v,afterSave:f=>afterSave=f,
 reload(){env.rt=clone(disk);api=load();return api}};
}
const spec={key:'shop:shots:S',kind:'shop',quote:{amount:500,currency:'Adena'},evidence:{qty:10}};
test('намерение оплаты durable до выдачи допуска; один допуск на один клик',async()=>{const f=fixture(),p=await f.api.prepare(spec);assert.ok(p);assert.equal(f.disk().actionPayments.pending.id,p.id);assert.ok(f.api.sent(p));assert.ok(f.api.consumePermit());assert.equal(f.api.consumePermit(),false);assert.equal(f.api.sent(p),false)});
test('reload после durable prepare до клика запрещает повтор',async()=>{const f=fixture();await f.api.prepare(spec);f.reload();assert.equal(await f.api.prepare(spec),null);assert.ok(f.api.blocked())});
test('reload после отправки запрещает повтор и другую покупку',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);f.reload();assert.equal(await f.api.prepare({...spec,key:'fa:1356'}),null);assert.equal(f.api.sent(p),false)});
test('неподтверждённая запись хранилища не даёт билет',async()=>{for(const kind of ['saving','flush']){const f=fixture();f[kind](false);assert.equal(await f.api.prepare(spec),null);assert.equal(f.api.consumePermit(),false)}});
test('Stop и смена режима во время durable prepare отменяют неотправленный билет',async()=>{for(const change of [f=>f.env.on=false,f=>f.env.rt.manualKickAt++,f=>f.env.rt.classCur.slot++]){const f=fixture();let changed=false;f.afterSave(()=>{if(!changed){changed=true;change(f)}});assert.equal(await f.api.prepare(spec),null);assert.equal(f.api.consumePermit(),false)}});
test('смена режима между prepare и sent не разрешает клик',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.env.rt.manualKickAt++;assert.equal(f.api.sent(p),false);assert.equal(await f.api.cancel(p),true)});
test('unknown не отменяется после reload даже с notSent:true',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);f.reload();assert.equal(await f.api.cancel(p,{notSent:true}),false);assert.ok(f.api.blocked())});
test('fire=false позволяет отменить доказанно неотправленный клик',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);assert.ok(await f.api.cancel(p,{notSent:true}));assert.equal(f.api.blocked(),false)});
test('сверка старого платежа разрешена после ручной смены режима',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);f.reload();f.env.rt.manualKickAt++;assert.ok(await f.api.confirm(p,{kind:'stock-satisfied'}));assert.equal(f.api.blocked(),false);assert.equal(f.disk().actionPayments.history.length,1)});
test('неудачный flush квитанции сохраняет pending в памяти и на диске',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);f.flush(false);assert.equal(await f.api.confirm(p,{kind:'receipt'}),false);assert.equal(f.api.pending().id,p.id);f.reload();assert.equal(f.api.pending().id,p.id)});
test('потеря вкладки/смена персонажа запрещает подтверждать чужой платёж',async()=>{for(const mutate of [f=>f.env.tabOwner=false,f=>f.env.rt.char='other']){const f=fixture(),p=await f.api.prepare(spec);mutate(f);assert.equal(await f.api.confirm(p,{kind:'receipt'}),false)}});
test('внешний неизвестный платёж и action guard запрещают новую оплату',async()=>{const f=fixture();f.env.externalPending=()=>true;assert.equal(await f.api.prepare(spec),null);f.env.externalPending=()=>false;f.env.canRun=()=>false;assert.equal(await f.api.prepare(spec),null)});
test('повтор подтверждения не дублирует квитанцию',async()=>{const f=fixture(),p=await f.api.prepare(spec);f.api.sent(p);assert.ok(await f.api.confirm(p,{kind:'receipt'}));assert.equal(await f.api.confirm(p,{kind:'receipt'}),false);assert.equal(f.disk().actionPayments.history.length,1)});
