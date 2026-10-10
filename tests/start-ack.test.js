'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const content = fs.readFileSync(path.join(root,'content.js'),'utf8');
const a = content.indexOf('chrome.runtime.onMessage.addListener((m, _s, reply) => {');
const b = content.indexOf('// ---------- старт ----------',a);
assert.ok(a>0&&b>a,'content listener block');
const listener = content.slice(a,b);
const waitReply = async ({ enabled=true, ownership='yes' } = {}) => {
  let handler;let responses=[];let mainCalls=0;
  const context = {
    chrome: { runtime: { onMessage: {addListener:fn=>{handler=fn}},getManifest:()=>({version:'7.1.15'})},
      storage:{local:{get: async()=>({on:enabled,cfg:{}})}} },
    mergeCfg:x=>x,on:false,running:false,tabOwner:false,leaseEpoch:null,
    main(){mainCalls++;context.running=true;if (ownership==='yes') {context.tabOwner=true;context.leaseEpoch='lease';}},
    heartbeat(){},setTimeout,Date,Promise,
  };
  vm.runInNewContext(listener,context);
  await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('kick response timeout')),5000);
    const asyncResponse=handler({cmd:'kick'}, {},r=>{responses.push(r);clearTimeout(t);resolve();});
    assert.equal(asyncResponse,true);
  });
  assert.equal(responses.length,1,'exactly one ACK');
  return {pong:responses[0],mainCalls};
};
(async()=>{
  const stopped=await waitReply({enabled:false});assert.equal(stopped.pong.ok,false);assert.equal(stopped.pong.reason,'stopped');assert.equal(stopped.mainCalls,0);
  const started=await waitReply();assert.equal(started.pong.ok,true);assert.equal(started.pong.running,true);assert.equal(started.pong.owner,true);assert.equal(started.mainCalls,1);
  const blocked=await waitReply({ownership:'no'});assert.equal(blocked.pong.ok,false);assert.equal(blocked.pong.reason,'another_tab_or_lock_unavailable');
  const popup=fs.readFileSync(path.join(root,'popup.js'),'utf8');
  const x=popup.indexOf('async function wakeGame() {');const y=popup.indexOf('async function showWakeResult()',x);
  assert.ok(x>0&&y>x);
  let reload=0,response={ok:false,running:true,owner:false,v:'7.1.15',reason:'another_tab_or_lock_unavailable'};
  const ctx={chrome:{tabs:{query:async()=>[{id:99,url:'https://l2wap.com/battle.html'}],sendMessage:async()=>response,reload:async()=>{reload++}},runtime:{getManifest:()=>({version:'7.1.15'})}},Promise,Date,setTimeout};
  vm.runInNewContext(popup.slice(x,y),ctx);
  const failure=await vm.runInNewContext('wakeGame()',ctx);
  assert.equal(failure.ok,false);assert.match(failure.reason,/другие вкладки/i);assert.equal(reload,0,'do not reload an owned game tab on denied lease');
  response={ok:true,running:true,owner:true,v:'7.1.15'};
  const success=await vm.runInNewContext('wakeGame()',ctx);assert.equal(success.ok,true);
  console.log('PASS: start ACK requires owner and running; stopped/missing lease never report success; popup does not reload a denied lease');
})().catch(err=>{console.error(err);process.exit(1)});
