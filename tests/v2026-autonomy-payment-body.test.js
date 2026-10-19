'use strict';
// 20.26, аудит автономности: HTTP200 без достоверного тела не завершает закупку.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
async function receipt({body='{"ok":true}',ct='application/json',status=200,broken=false,transport='fetch'}={}){
 const events=[];
 const response={status,headers:{get:()=>ct},clone:()=>({text:async()=>{if(broken)throw Error('body interrupted');return body}})};
 const window={fetch:()=>Promise.resolve(response),postMessage:d=>events.push(d)};
 class X{open(){}addEventListener(_,f){this.end=f}getResponseHeader(){return ct}send(){this.status=status;this.responseText=body;this.end()}}
 const box={window,XMLHttpRequest:X,URL,URLSearchParams,FormData,Date,performance:{now:()=>0},location:{href:'https://l2wap.com/gm-shop.html',origin:'https://l2wap.com',host:'l2wap.com'}};
 vm.runInNewContext(read('hook.js'),box);
 if(transport==='fetch')await window.fetch('/game/drops-shop/buy',{method:'POST',body:'{"shopKey":"consumable/hp","qty":100}'});
 else{const x=new X();x.open('POST','/game/drops-shop/buy');x.send('{"shopKey":"consumable/hp","qty":100}')}
 await new Promise(r=>setImmediate(r));
 const result=events.find(d=>d.__l2bot==='net');assert.ok(result,'hook всегда закрывает сетевой запрос');return result;
}
function shop(net,{stock=0}={}){
 const box={console,Date};vm.runInNewContext(read('modules/payments.js'),box);vm.runInNewContext(read('modules/economy.js'),box);
 const now=Date.now(),pending={id:'own-payment',key:'hp',kind:'shop',char:'Hero',at:now-1000,kick:1,phase:'prepared',quote:{currency:'Adena',amount:100000},evidence:{shopKey:'consumable/hp',qty:100,ids:[1539],beforeQty:0,itemKey:'hp',label:'HP',jobT:100,revision:5,adenaChar:200000}};
 let reads=0;
 const env={on:true,tabOwner:true,leaseEpoch:7,rt:{char:'Hero',manualKickAt:1,actionPayments:{pending},shop:{t:100,done:[],spent:0}},canRun:()=>true,autonomyMode:()=> 'farm',setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},gameGet:async()=>{reads++;return{ok:true,json:async()=>({character:{name:'Hero',revision:stock?6:5,adena:stock?'100000':'200000',inventory:{stacks:stock?[{itemId:1539,qty:stock}]:[]}}})}}};
 env.payments=box.L2V7Factories.payments(env);
 env.shopBuyNet=()=>({paymentId:pending.id,t:now,key:'consumable/hp',qty:100,status:net.status,outcome:env.payments.classify(net)});
 return{env,api:box.L2V7Factories.economy(env),reads:()=>reads};
}
for(const transport of ['fetch','xhr'])for(const [name,options]of Object.entries({html:{body:'<html>unavailable</html>',ct:'text/html'},truncated:{body:'{"ok":'},null:{body:'null'},scalar:{body:'true'},array:{body:'[]'},empty:{body:'{}'},noContent:{body:'',status:204}}))
 test(transport+': '+name+' не подтверждает покупку и сохраняет pending',async()=>{
  const net=await receipt({...options,transport}),f=shop(net);assert.equal(await f.api.paymentReconcile(),false);assert.equal(f.reads(),1);assert.equal(f.env.rt.actionPayments.pending.id,'own-payment');assert.equal(f.env.rt.shop.spent,0);assert.equal(f.env.rt.shop.done.length,0);
 });
test('ошибка чтения тела fetch не снимает неизвестный платёж',async()=>{const f=shop(await receipt({broken:true}));assert.equal(await f.api.paymentReconcile(),false);assert.equal(f.reads(),1);assert.ok(f.env.rt.actionPayments.pending)});
test('потерянное тело при реально полученных100банках подтверждается свежим чтением запаса',async()=>{const f=shop(await receipt({body:'null'}),{stock:100});assert.equal(await f.api.paymentReconcile(),true);assert.equal(f.reads(),1);assert.equal(f.env.rt.actionPayments.pending,null);assert.equal(f.env.rt.shop.spent,100000);assert.equal(f.env.rt.shop.done[0].qty,100)});
test('корректная квитанция успеха сохраняет прежнее подтверждение без лишнего GET',async()=>{const f=shop(await receipt());assert.equal(await f.api.paymentReconcile(),true);assert.equal(f.reads(),0);assert.equal(f.env.rt.actionPayments.pending,null);assert.equal(f.env.rt.shop.spent,100000)});
test('явный отказ при HTTP200 не считается покупкой',async()=>{const f=shop(await receipt({body:'{"ok":false,"error":"not_enough_adena"}'}));assert.equal(await f.api.paymentReconcile(),true);assert.equal(f.reads(),0);assert.equal(f.env.rt.shop.spent,0);assert.equal(f.env.rt.shop.done[0].ok,false)});
