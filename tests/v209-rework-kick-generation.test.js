'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(process.env.KICK_SOURCE||__dirname+'/../content.js','utf8');
const start=src.indexOf('chrome.runtime.onMessage.addListener((m, _s, reply) => {'),code=src.slice(start,src.indexOf('// ---------- старт ----------',start));
function fixture({owned=true,delayRead=false,timer,reread}={}){let handler,resolveRead,main=0,hb=0,answer,reads=0;const first=delayRead?new Promise(r=>resolveRead=r):Promise.resolve({on:true,cfg:{old:true}});
 const read=()=>++reads===1?first:reread?Promise.resolve(reread(ctx)):first;
 const ctx={automationGeneration:0,on:false,cfg:{kept:true},running:false,tabOwner:false,leaseEpoch:null,Date,Promise,mergeCfg:x=>x,
 chrome:{runtime:{getManifest:()=>({version:'20.9'}),onMessage:{addListener:f=>handler=f}},storage:{local:{get:read}}},
 main(){main++;ctx.running=true;if(owned){ctx.tabOwner=true;ctx.leaseEpoch=1}},heartbeat(){hb++},setTimeout:r=>{timer?.(ctx);r()}};
 vm.createContext(ctx);vm.runInContext(code,ctx);const response=new Promise(r=>answer=r);assert.equal(handler({cmd:'kick'},{},answer),true);
 return{ctx,response,resolveRead,main:()=>main,hb:()=>hb,reads:()=>reads};
}
test('старый storage.get после Stop перечитывается и не запускает цикл',async()=>{const f=fixture({delayRead:true,reread:()=>({on:false,cfg:{old:true}})});f.ctx.automationGeneration++;f.ctx.on=false;f.resolveRead({on:true,cfg:{old:true}});const r=await f.response;assert.equal(r.ok,false);assert.equal(r.reason,'stopped');assert.equal(f.ctx.on,false);assert.deepEqual(f.ctx.cfg,{old:true});assert.equal(f.main(),0);assert.equal(f.reads(),2)});
// 17.10.2026: запись настроек/on самим Стартом меняет поколение одновременно с kick — перечитываем свежее состояние и запускаем, а не отказываем
test('запись настроек во время чтения не срывает Старт: хранилище перечитывается, цикл стартует со свежим cfg',async()=>{const f=fixture({delayRead:true,reread:()=>({on:true,cfg:{fresh:true}})});f.ctx.automationGeneration++;f.resolveRead({on:true,cfg:{old:true}});const r=await f.response;assert.equal(r.ok,true);assert.deepEqual(f.ctx.cfg,{fresh:true});assert.equal(f.main(),1);assert.equal(f.reads(),2)});
test('поколение не успокаивается три чтения подряд — отказ start_superseded без запуска',async()=>{const f=fixture({delayRead:true,reread:c=>{c.automationGeneration++;return{on:true,cfg:{x:1}}}});f.ctx.automationGeneration++;f.resolveRead({on:true,cfg:{old:true}});const r=await f.response;assert.equal(r.ok,false);assert.equal(r.reason,'start_superseded');assert.equal(f.main(),0);assert.equal(f.reads(),3)});
for(const restart of [false,true])test('ACK не подтверждает запуск после Stop'+(restart?'→Start':''),async()=>{const f=fixture({owned:false,timer:c=>{c.automationGeneration++;c.on=restart;c.running=true;c.tabOwner=true;c.leaseEpoch=2}});const r=await f.response;assert.equal(r.ok,false);assert.equal(f.main(),1);assert.equal(f.hb(),0)});
test('свежий kick подтверждает фактический запуск и владельца',async()=>{const f=fixture(),r=await f.response;assert.equal(r.ok,true);assert.equal(r.owner,true);assert.equal(f.main(),1);assert.equal(f.hb(),1)});
