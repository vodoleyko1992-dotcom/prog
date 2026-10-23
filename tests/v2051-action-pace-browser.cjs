'use strict';
// Настоящее расширение, часы браузера; все HTTPS ответы перехвачены локальным стендом.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{
 const h=await harness();const evidence={browser:'Chromium',cases:[],requests:[]};
 try{
  await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:[],actionDelayMs:500,petFullAuto:false,petBuffAuto:false}});});
  await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));
  const times=await h.g.core(`(async()=>{const times=[];for(let i=0;i<3;i++){if(!await actionWait())throw Error('cancelled');if(!fire(document.querySelector('#probe')))throw Error('not sent');times.push(Date.now());}return times;})()`);
  assert.ok(times[1]-times[0]>=490,JSON.stringify(times));assert.ok(times[2]-times[1]>=490,JSON.stringify(times));
  evidence.cases.push({name:'real fire timing 500ms',intervals:[times[1]-times[0],times[2]-times[1]]});
  await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,actionDelayMs:1700}});});
  await until(()=>h.g.core('cfg.actionDelayMs === 1700 && L2V7Modules.actions.canAct()'));
  const longer=await h.g.core(`(async()=>{const times=[];for(let i=0;i<2;i++){if(!await actionWait())throw Error('cancelled');if(!fire(document.querySelector('#probe')))throw Error('not sent');times.push(Date.now());}return times;})()`);
  assert.ok(longer[1]-longer[0]>=1690,JSON.stringify(longer));evidence.cases.push({name:'updated setting 1700ms',interval:longer[1]-longer[0]});
  const left=await h.g.core('actionPace.left()');assert.ok(left>1000,left);await h.g.p.reload();await until(()=>h.g.core('on && running && tabOwner'));
  const saved=await h.g.core("JSON.parse(sessionStorage.getItem('l2bot.actionPace'))");assert.equal(saved.char,'AuditHero');evidence.cases.push({name:'page reload retains timestamp',stored:true});
  await h.g.core('actionNote(); true');
  const count=await h.g.p.getAttribute('body','data-actions');
  const pending=h.g.core("(async()=>{const ok=await actionWait();if(ok)fire(document.querySelector('#probe'));return ok;})()");
  await delay(120);await h.click('stop');assert.equal(await pending,false);await until(()=>h.g.core('!on && !running'));await delay(1800);
  assert.equal(await h.g.p.getAttribute('body','data-actions'),count);evidence.cases.push({name:'Stop cancels waiting action; no late click',pass:true});
  assert.deepEqual(h.errors,[]);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);evidence.errors=h.errors;evidence.posts=0;
  fs.mkdirSync(path.join(__dirname,'../docs/evidence/speed-panel'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../docs/evidence/speed-panel/runtime-chromium.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS actual MV3 pace500/1700, persistence, Stop/no delayed action; no POST/page errors');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
