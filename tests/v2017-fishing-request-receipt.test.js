'use strict';
// 18.10: квитанция своего native-заброса переживает потерянный postMessage и reload.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../hook.js','utf8'),key='l2bot.fishingCastRequest',now=1800000000000;
const marker=()=>({char:'Hero',at:now-500,armedAt:now-20}),request=()=>({action:'cast',expectedRevision:64042});
function fixture({stored=marker(),storageError='',postError=false}={}) {
 const memory=new Map(),writes=[],sent=[],posted=[];if(stored!==undefined)memory.set(key,typeof stored==='string'?stored:JSON.stringify(stored));
 const sessionStorage={getItem(k){if(storageError==='get')throw Error('storage blocked');return memory.get(k)||null},setItem(k,v){if(storageError==='set')throw Error('storage quota');writes.push({key:k,value:v});memory.set(k,v)}};
 const response={status:200,headers:{get:()=> 'application/json'},clone:()=>({text:async()=> '{}'})},promise=Promise.resolve(response),xhrResult={native:true};
 const nativeSend=(transport,args,receiver)=>{sent.push({transport,args,receiver,receipt:memory.get(key)});return transport==='fetch'?promise:xhrResult};
 const window={fetch:function(){return nativeSend('fetch',[...arguments],this)},postMessage(d){if(postError)throw Error('postMessage lost');posted.push(d)}};
 class X {open(){}addEventListener(_,f){this.end=f}getResponseHeader(){return'application/json'}send(){const result=nativeSend('xhr',[...arguments],this);this.status=200;this.responseText='{}';this.end?.();return result}}
 class Clock extends Date{static now(){return now}}
 const location={href:'https://l2wap.com/fishing.html',origin:'https://l2wap.com',host:'l2wap.com',pathname:'/fishing.html'};
 const box={window,location,sessionStorage,XMLHttpRequest:X,URL,URLSearchParams,FormData,Date:Clock,performance:{now:()=>0},console};
 const load=()=>vm.runInNewContext(source,box);load();
 const send=(transport,{path='/game/fishing/action',method='POST',body=request()}={})=>{
  const raw=typeof body==='string'?body:JSON.stringify(body);
  if(transport==='fetch'){const init={method,body:raw},receiver={native:'receiver'},result=window.fetch.call(receiver,path,init);assert.equal(result,promise,'сохранён исходный Promise fetch');assert.equal(sent.at(-1).receiver,receiver);assert.deepEqual(sent.at(-1).args,[path,init]);return result}
  const x=new X();x.open(method,path);const result=x.send(raw);assert.equal(result,xhrResult,'сохранён результат native send');assert.equal(sent.at(-1).receiver,x);assert.deepEqual(sent.at(-1).args,[raw]);return result;
 };
 return{send,memory,writes,sent,posted,window,box,load,receipt:()=>JSON.parse(memory.get(key)||'null')};
}
for(const transport of ['fetch','xhr']) {
 test(transport+': точная revision существует до настоящей отправки',async()=>{const f=fixture();await f.send(transport);assert.deepEqual(JSON.parse(f.sent[0].receipt),{...marker(),requestRevision:64042,requestAt:now});assert.equal(f.writes.length,1);assert.ok(f.posted.some(d=>d.__l2bot==='netStart'));});
 test(transport+': потеря postMessage не теряет синхронную квитанцию',async()=>{const f=fixture({postError:true});await f.send(transport);assert.equal(f.receipt().requestRevision,64042);assert.equal(f.sent.length,1);assert.equal(f.posted.length,0);});
 test(transport+': первый valid requestRevision сохраняется при следующем запросе и reload hook',async()=>{const f=fixture();await f.send(transport);const first=f.memory.get(key);delete f.window.__l2botHook;f.load();await f.send(transport,{body:{action:'cast',expectedRevision:64043}});assert.equal(f.memory.get(key),first);assert.equal(f.writes.length,1);});
 for(const [label,change] of Object.entries({
  'нет маркера':()=>null,'не JSON':()=>'{broken','пустой герой':m=>({...m,char:''}),'пробелы вместо героя':m=>({...m,char:'  '}),'не строка героя':m=>({...m,char:5}),
  'нет at':m=>({char:m.char,armedAt:m.armedAt}),'нулевой at':m=>({...m,at:0}),'отрицательный at':m=>({...m,at:-1}),'дробный at':m=>({...m,at:now-0.5}),
  'нет armedAt':m=>({char:m.char,at:m.at}),'armedAt раньше at':m=>({...m,armedAt:m.at-1}),'armedAt из будущего':m=>({...m,armedAt:now+1}),'дробный armedAt':m=>({...m,armedAt:now-0.5}),
  'просроченный маркер':m=>({...m,at:now-20000,armedAt:now-15001}),'уже есть revision 0':m=>({...m,requestRevision:0,requestAt:now-10}),'уже есть revision':m=>({...m,requestRevision:64040,requestAt:now-10})
 }))test(transport+': '+label+' не меняется',async()=>{const f=fixture({stored:change(marker())}),before=f.memory.get(key);await f.send(transport);assert.equal(f.memory.get(key),before);assert.equal(f.writes.length,0);assert.equal(f.sent.length,1);});
 for(const [label,options] of Object.entries({
  'GET':{method:'GET'},'другое действие':{body:{action:'pumping',expectedRevision:64042}},'нет action':{body:{expectedRevision:64042}},
  'нет revision':{body:{action:'cast'}},'отрицательная revision':{body:{action:'cast',expectedRevision:-1}},'дробная revision':{body:{action:'cast',expectedRevision:1.5}},'строковая revision':{body:{action:'cast',expectedRevision:'64042'}},
  'небезопасная revision':{body:{action:'cast',expectedRevision:Number.MAX_SAFE_INTEGER+1}},'другой путь':{path:'/game/other/action'},'другой сайт':{path:'https://example.com/game/fishing/action'}
 }))test(transport+': '+label+' не записывает квитанцию',async()=>{const f=fixture(),before=f.memory.get(key);await f.send(transport,options);assert.equal(f.memory.get(key),before);assert.equal(f.writes.length,0);assert.equal(f.sent.length,1);});
 for(const storageError of ['get','set'])test(transport+': ошибка storage '+storageError+' не препятствует native-запросу',async()=>{const f=fixture({storageError});await f.send(transport);assert.equal(f.sent.length,1);assert.ok(f.posted.some(d=>d.__l2bot==='netStart'));});
 test(transport+': граница 15000 мс допускается и revision 0 сохраняется',async()=>{const f=fixture({stored:{char:'Hero',at:now-15000,armedAt:now-15000}});await f.send(transport,{body:{action:'cast',expectedRevision:0}});assert.equal(f.receipt().requestRevision,0);assert.equal(f.receipt().requestAt,now);});
 test(transport+': некорректная прежняя revision заменяется точной revision запроса',async()=>{const f=fixture({stored:{...marker(),requestRevision:-1}});await f.send(transport);assert.equal(f.receipt().requestRevision,64042);});
}
