'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(__dirname+'/../popup.js','utf8'),src=text.slice(text.indexOf('async function wakeGame() {'),text.indexOf('async function showWakeResult()'));
const good={v:'10',ok:true,running:true,owner:true};
async function run(opt={}){
 let t=10000,n=0,reloads=0,on=true,listener;const tab={id:1,url:'https://l2wap.com/map.html',status:'complete'};
 const e={Promise,Date:{now:()=>t},setTimeout:(fn,ms)=>{if(ms!==5500){t+=ms;queueMicrotask(fn)}},chrome:{runtime:{getManifest:()=>({version:'10'})},storage:{local:{get:async()=>({on})}},tabs:{query:async()=>[{...tab}],get:async()=>{if(opt.close)throw Error('closed');return {...tab}},onUpdated:{addListener:f=>listener=f,removeListener:f=>{assert.equal(f,listener);listener=null}},reload:async()=>{reloads++},sendMessage:async()=>{n++;if(n===1){if(opt.navigate){tab.url='https://l2wap.com/dion-campaign.html';listener?.(1,{url:tab.url,status:'loading'},tab);if(opt.returnToMap){tab.url='https://l2wap.com/map.html';listener?.(1,{url:tab.url},tab)}tab.status=opt.loading?'loading':'complete'}if(opt.foreign)tab.url='https://example.com/';if(opt.stop)on=false;if(opt.deny)return {...good,ok:false,owner:false,reason:'another_tab_or_lock_unavailable'};if(opt.good)return good;return opt.outdated?{...good,v:'9'}:null}if(opt.never||opt.loading)return null;if(opt.denyAfter)return {...good,ok:false,owner:false,reason:'another_tab_or_lock_unavailable'};if(opt.requireReload&&!reloads)return null;return good}}}};
 vm.runInNewContext(src,e);const out=await e.wakeGame();return{out,n,reloads,listener};
}
for(const returnToMap of [false,true])test('kick ACK lost during native navigation does not reload new document '+returnToMap,async()=>{const r=await run({navigate:true,returnToMap});assert.equal(r.out.ok,true);assert.equal(r.reloads,0);assert.ok(r.n>=2);assert.equal(r.listener,null)});
test('same URL document replacement gets a second handshake before reload',async()=>{const r=await run();assert.equal(r.out.ok,true);assert.equal(r.reloads,0)});
test('unknown engine on moving document times out safely without reload',async()=>{const r=await run({navigate:true,never:true});assert.equal(r.out.ok,false);assert.equal(r.reloads,0);assert.ok(r.n<20);assert.equal(r.listener,null)});
test('ongoing page load is not interrupted',async()=>{const r=await run({navigate:true,loading:true});assert.equal(r.out.ok,false);assert.equal(r.reloads,0)});
test('Stop while first handshake pending forbids reload',async()=>{const r=await run({stop:true,requireReload:true});assert.equal(r.out.ok,false);assert.equal(r.reloads,0)});
test('closed tab cannot be reloaded',async()=>{const r=await run({close:true,requireReload:true});assert.equal(r.out.ok,false);assert.equal(r.reloads,0)});
test('tab that left the game cannot be reloaded',async()=>{const r=await run({foreign:true,requireReload:true});assert.equal(r.out.ok,false);assert.equal(r.reloads,0)});
for(const opt of [{deny:true},{navigate:true,denyAfter:true}])test('explicit lease denial is not reload permission '+JSON.stringify(opt),async()=>{const r=await run(opt);assert.equal(r.out.ok,false);assert.equal(r.reloads,0)});
test('missing stable content still recovers with exactly one reload',async()=>{const r=await run({requireReload:true});assert.equal(r.out.ok,true);assert.equal(r.reloads,1)});
test('outdated stable content can reload once',async()=>{const r=await run({outdated:true,requireReload:true});assert.equal(r.out.ok,true);assert.equal(r.reloads,1)});
test('already acknowledged engine needs no reload',async()=>{const r=await run({good:true});assert.equal(r.out.ok,true);assert.equal(r.reloads,0);assert.equal(r.n,1);assert.equal(r.listener,null)});
