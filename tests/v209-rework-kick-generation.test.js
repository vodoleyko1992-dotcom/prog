'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(process.env.KICK_SOURCE||__dirname+'/../content.js','utf8');
const start=src.indexOf('chrome.runtime.onMessage.addListener((m, _s, reply) => {'),code=src.slice(start,src.indexOf('// ---------- старт ----------',start));
function fixture({owned=true,delayRead=false,timer}={}){let handler,resolveRead,main=0,hb=0,answer;const read=delayRead?new Promise(r=>resolveRead=r):Promise.resolve({on:true,cfg:{old:true}});
 const ctx={automationGeneration:0,on:false,cfg:{kept:true},running:false,tabOwner:false,leaseEpoch:null,Date,Promise,mergeCfg:x=>x,
 chrome:{runtime:{getManifest:()=>({version:'20.9'}),onMessage:{addListener:f=>handler=f}},storage:{local:{get:()=>read}}},
 main(){main++;ctx.running=true;if(owned){ctx.tabOwner=true;ctx.leaseEpoch=1}},heartbeat(){hb++},setTimeout:r=>{timer?.(ctx);r()}};
 vm.createContext(ctx);vm.runInContext(code,ctx);const response=new Promise(r=>answer=r);assert.equal(handler({cmd:'kick'},{},answer),true);
 return{ctx,response,resolveRead,main:()=>main,hb:()=>hb};
}
for(const change of ['Stop','settings'])test('старый storage.get не меняет '+change+' и не запускает цикл',async()=>{const f=fixture({delayRead:true});f.ctx.automationGeneration++;f.ctx.on=false;if(change==='settings')f.ctx.cfg={new:true};f.resolveRead({on:true,cfg:{old:true}});const r=await f.response;assert.equal(r.ok,false);assert.equal(f.ctx.on,false);assert.equal(f.main(),0);assert.equal(f.hb(),0);assert.equal(f.ctx.cfg.old,undefined)});
for(const restart of [false,true])test('ACK не подтверждает запуск после Stop'+(restart?'→Start':''),async()=>{const f=fixture({owned:false,timer:c=>{c.automationGeneration++;c.on=restart;c.running=true;c.tabOwner=true;c.leaseEpoch=2}});const r=await f.response;assert.equal(r.ok,false);assert.equal(f.main(),1);assert.equal(f.hb(),0)});
test('свежий kick подтверждает фактический запуск и владельца',async()=>{const f=fixture(),r=await f.response;assert.equal(r.ok,true);assert.equal(r.owner,true);assert.equal(f.main(),1);assert.equal(f.hb(),1)});
