'use strict';
// 20.12 (ревизия 17.10, аудит M1): одно правило исхода платного запроса и ограниченная сверка по состоянию — в payments.js.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function load(){
 let now=1_000_000_000_000;const clock=class extends Date{static now(){return now}};
 const box={console,Date:clock};vm.runInNewContext(read('modules/payments.js'),box);
 const env={on:true,tabOwner:true,rt:{char:'Hero',manualKickAt:1},autonomyMode:()=> 'farm',canRun:()=>true,setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,rec(){}};
 const P=box.L2V7Factories.payments(env);return {P,env,box,tick:ms=>now+=ms};
}
test('classify: явный отказ — 4xx из общего списка и 2xx с error / ok:false',()=>{
 const {P}=load();
 for(const s of [400,401,403,404,409,412,422,423,429])assert.equal(P.classify({status:s,res:{}}),'rejected',String(s));
 assert.equal(P.classify({status:200,res:{error:'not_enough_adena'}}),'rejected');
 assert.equal(P.classify({status:200,res:{ok:false}}),'rejected');
 assert.equal(P.classify({status:200,res:{ok:true}}),'applied');
 assert.equal(P.classify({status:201,res:null}),'applied');
});
test('classify: 5xx, обрыв, нет ответа — исход неизвестен',()=>{
 const {P}=load();
 for(const d of [{status:500},{status:502,res:{error:'bad gateway'}},{status:504},{error:'Failed to fetch'},{status:0},null,{},{status:408}])assert.equal(P.classify(d),'unknown',JSON.stringify(d));
});
test('unchanged: та же ревизия и адены не меньше; рост ревизии или списание адены — не доказательство',()=>{
 const {P}=load();
 assert.equal(P.unchanged({revision:5,adena:1000},{revision:5,adena:'1000'}),true);
 assert.equal(P.unchanged({revision:5,adena:1000},{revision:5,adena:1500}),true);
 assert.equal(P.unchanged({revision:5,adena:1000},{revision:6,adena:1000}),false);
 assert.equal(P.unchanged({revision:5,adena:1000},{revision:5,adena:999}),false);
 assert.equal(P.unchanged({revision:5},{revision:5}),true);
 assert.equal(P.unchanged({},{revision:5}),false);
});
test('probe: первые 15 с не читаем; «не применилась» только через ≥2 мин двумя сверками ≥30 с подряд',async()=>{
 const {P,tick}=load();const p=await P.prepare({key:'k',kind:'shop',quote:{amount:1,currency:'Adena'}});assert.ok(p);
 assert.equal(P.probeDue(p),false);tick(15000);assert.equal(P.probeDue(p),true);
 assert.equal(P.probeNote(p,true),false,'до 2 мин не считается');tick(30000);assert.equal(P.probeDue(p),true);
 tick(80000);assert.equal(P.probeNote(p,true),false,'первая сверка после 2 мин');tick(10000);assert.equal(P.probeDue(p),false,'чаще раза в 30 с не читаем');
 tick(20000);assert.equal(P.probeNote(p,false),false,'изменение сбрасывает серию');tick(30000);assert.equal(P.probeNote(p,true),false);tick(30000);assert.equal(P.probeNote(p,true),true);
});
test('probe: после 20 сверок без результата — не чаще раза в 5 мин',async()=>{
 const {P,tick}=load();const p=await P.prepare({key:'k',kind:'shop',quote:{amount:1,currency:'Adena'}});
 tick(15000);for(let i=0;i<20;i++){assert.equal(P.probeDue(p),true);P.probeNote(p,false);tick(30000)}
 assert.equal(P.probeDue(p),false);tick(270000);assert.equal(P.probeDue(p),true);
});
test('claimRequest: native POST улучшения и телепорта Маммона привязывается к своей оплате',async()=>{
 for(const [action,pathName] of [['upgrade','/game/mammon/blacksmith/upgrade'],['teleport','/game/mammon/teleport']]){
  const {P}=load();const p=await P.prepare({key:'m:'+action,kind:'mammon',quote:{amount:1,currency:'coin_of_luck'},evidence:{action}});
  assert.ok(P.sent(p));assert.ok(P.consumePermit());assert.equal(P.claimRequest({method:'POST',path:pathName}),p.id,action);
 }
});
test('confirm с spent:0 пишет в журнал «оплата не прошла», а не «получена квитанция»',async()=>{
 const {P,env}=load();const lines=[];env.rec=(...a)=>lines.push(a.join(' '));
 const p=await P.prepare({key:'k',kind:'shop',quote:{amount:500,currency:'Adena'}});P.sent(p);
 assert.ok(await P.confirm(p,{kind:'server-rejected',status:409,spent:0}));assert.match(lines.at(-1),/оплата не прошла/);assert.doesNotMatch(lines.at(-1),/квитанция/);
});
console.log('PASS: v2012-pay-outcome');
