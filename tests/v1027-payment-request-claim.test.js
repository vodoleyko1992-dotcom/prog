'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function fixture(rt={char:'Hero'}){
 const b={Date,Map,console,rt,leaseEpoch:'lease',heroNick:()=> 'Hero',sessionStorage:{getItem(){},setItem(){}},L2V7Modules:{}};
 vm.runInNewContext(read('modules/payments.js'),b);const env={get rt(){return b.rt},on:true,tabOwner:true,lease:()=>b.leaseEpoch,setRt:async p=>{Object.assign(b.rt,p);return {ok:true}},rtCommit:async()=>true,rec(){}};
 b.L2V7Modules.payments=b.L2V7Factories.payments(env);const src=read('content.js');vm.runInNewContext(src.slice(src.indexOf('const NET_CONTEXT ='),src.indexOf('const gameBusy =')),b);
 return{b,P:b.L2V7Modules.payments,start:(path,rid,method='POST')=>b.netContextStart({path,rid,method}),take:rid=>b.netContextTake({rid})};
}
const spec={kind:'fishing',key:'time:5h',quote:{amount:10000,currency:'Adena'},evidence:{path:'/game/fishing/action',request:{action:'buyFishingTime'}}};
test('permit → native GET → первый paid POST: claim один; параллельный ручной same-item409 без claim',async()=>{
 const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);assert.equal(f.P.consumePermit(),true);
 f.start('/character',1,'GET');assert.equal(f.take(1).paymentId,'');f.start('/game/fishing/state',2,'GET');assert.equal(f.take(2).paymentId,'');
 f.start('/game/fishing/action',3);f.start('/game/fishing/action',4);
 assert.equal(f.take(4).paymentId,'');assert.equal(f.take(3).paymentId,p.id);assert.equal(f.P.pending().id,p.id);
});
test('после reload pending не выдаёт claim новому ручному запросу',async()=>{
 const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);f.P.consumePermit();const re=fixture(JSON.parse(JSON.stringify(f.b.rt)));
 re.start('/game/fishing/action',1);assert.equal(re.take(1).paymentId,'');assert.equal(re.P.pending().id,p.id);
});
test('сохранённая точная квитанция отказа подтверждается после reload существующим confirm',async()=>{
 const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);f.P.consumePermit();f.start('/game/fishing/action',1);const receipt={paymentId:f.take(1).paymentId,status:409};
 const re=fixture(JSON.parse(JSON.stringify(f.b.rt)));assert.equal(receipt.paymentId,re.P.pending().id);assert.equal(await re.P.confirm(re.P.pending(),{kind:'server-rejected',spent:0,status:receipt.status}),true);assert.equal(re.P.pending(),null);
});
test('prepare/sent без фактического consumePermit не привязывают ручной POST',async()=>{const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);f.start('/game/fishing/action',1);assert.equal(f.take(1).paymentId,'')});
test('чужой POST не крадёт ожидаемый claim; смена lease отменяет его',async()=>{const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);f.P.consumePermit();f.start('/game/tvt/register',1);assert.equal(f.take(1).paymentId,'');f.b.leaseEpoch='new';f.start('/game/fishing/action',2);assert.equal(f.take(2).paymentId,'')});
for(const [kind,evidence,url,extra] of [['cat-teleport',{},'/game/catacombs/teleport'],['tvt-shop',{},'/game/tvt/shop/purchase'],['story-teleport',{},'/game/story-quests/noblesse/teleport',{questKind:'noblesse'}],['mammon',{action:'transfer'},'/game/item-transfer/send']])test(kind+' получает только один matching POST claim',async()=>{const f=fixture(),p=await f.P.prepare({...spec,kind,evidence,...extra});f.P.sent(p);f.P.consumePermit();f.start(url,1);assert.equal(f.take(1).paymentId,p.id);f.start(url,2);assert.equal(f.take(2).paymentId,'')});
test('давно не отправленный native POST не присваивает поздний ручной запрос',async()=>{const f=fixture(),p=await f.P.prepare(spec);f.P.sent(p);f.P.consumePermit();f.b.Date={now:()=>Date.now()+31000};f.start('/game/fishing/action',1);assert.equal(f.take(1).paymentId,'')});
test('рыболовный receipt сохраняет HTTP status для definitive отказов и unknown 5xx',()=>{const src=read('content.js'),line=src.split('\n').find(x=>x.includes('NET_FISH = { t: Date.now()'));for(const status of [409,500]){const box={Date,d:{status,req:{action:'cast'},res:{error:'failure'}},fz:null};vm.runInNewContext(line,box);assert.equal(box.NET_FISH.status,status);assert.equal(box.NET_FISH.ok,false)}});
