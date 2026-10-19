'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { createRecoveryController, createTransitionMonitor, createProgressMonitor, createPatchQueue, chooseMode } = require('../engine-core.js');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
function sourceSlice(src, a, b) { const i=src.indexOf(a), j=src.indexOf(b,i+a.length); assert(i>=0 && j>i); return src.slice(i,j); }
async function testPatchQueue() {
  let now=1000, fail=true, last={}, calls=0;
  const send=async patch=>{calls++; if(fail){fail=false;throw new Error('storage unavailable');} Object.assign(last,patch); return {ok:true};};
  const q=createPatchQueue(send,()=>true,()=>{},()=>now);
  let res=await q.enqueue({ kills:1 });
  assert.equal(res.ok,false);
  assert.equal(q.peek().kills,1,'Failed batch remains queued');
  res=await q.enqueue({ kills:3, exp:5 });
  assert.equal(res.reason,'backoff');
  now+=3001;
  res=await q.recover();
  assert.equal(res.ok,true);
  assert.equal(last.kills,3,'New patch wins over retried stale patch');
  assert.equal(last.exp,5);
  assert.equal(calls,2);
  assert.equal(Object.keys(q.peek()).length,0);
  // Parallel writes coalesce; must not drop an update inserted during an in-flight write.
  let release;
  const pending=createPatchQueue(async p=>{ await new Promise(r=>release=r); Object.assign(last,p); return {ok:true}; });
  const a=pending.enqueue({ a:1 });
  await new Promise(r=>setImmediate(r));
  const b=pending.enqueue({ b:2 });
  release();
  await new Promise(r=>setImmediate(r));
  release();
  await Promise.all([a,b]);
  assert.equal(last.a,1);
  assert.equal(last.b,2);
  console.log('PASS: patch coalescing, transient write failure, last-write-wins, inflight ordering');
}
function testRecovery() {
  let now=1000000;
  const c=createRecoveryController(()=>now);
  assert.equal(c.failure('/map','fail').action,'retry');
  assert.equal(c.failure('/map','fail').action,'retry');
  assert.equal(c.failure('/map','fail').action,'reload');
  assert.equal(c.failure('/battle','fail').recent,1,'Failures are route-local');
  const fourth=c.failure('/map','fail');
  assert.equal(fourth.recent,4);
  const reloaded=createRecoveryController(()=>now);
  reloaded.restore('/map',fourth.times);
  assert.equal(reloaded.failure('/map','fail').recent,5,'Failure streak survives page reload');
  assert.equal(reloaded.failure('/map','fail').action,'cooldown');
  for(let i=0;i<12;i++) reloaded.failure('/map','fail');
  assert.equal(reloaded.failure('/map','fail').action,'halt');
  now+=31*60000;
  assert.equal(reloaded.failure('/map','fail').recent,1);
  console.log('PASS: route-based recovery, persisted streak, bounded backoff, circuit breaker');
}
function testModesAndTransitions() {
  assert.equal(chooseMode({fish:true,epic:true}), 'epic');
  assert.equal(chooseMode({fish:true,raid:true}), 'raid');
  assert.equal(chooseMode({fish:true,cat:true}), 'fish');
  assert.equal(chooseMode({cat:true,campaign:true}), 'campaign');
  assert.equal(chooseMode({cat:true}), 'cat');
  assert.equal(chooseMode(), 'farm');
  let now=1000;
  const m=createTransitionMonitor(()=>now);
  m.expect('tp','/epic-bosses.html',8000);
  assert.equal(m.check('tp','/epic-bosses.html'),'pending');
  assert.equal(m.check('tp','/map.html'),'complete');
  assert.equal(m.check('tp','/map.html'),'none');
  m.expect('tp','/epic-bosses.html',8000);
  now+=8100;
  assert.equal(m.check('tp','/epic-bosses.html'),'timeout');
  const prog=createProgressMonitor(()=>now);
  assert.equal(prog.tick('map|hp100',true,10000),'progress');
  now+=9000;
  assert.equal(prog.tick('map|hp100',true,10000),'waiting');
  now+=2000;
  assert.equal(prog.tick('map|hp100',true,10000),'stalled');
  assert.equal(prog.tick('map|hp100',true,10000),'waiting','Repeated alarms rate limited');
  assert.equal(prog.tick('map|hp90',true,10000),'progress','HP changes prove progress');
  assert.equal(prog.tick('map|hp90',false,10000),'idle');
  console.log('PASS: exclusive mode, navigation confirmation, no-progress detection');
}
function testIntegration() {
  assert.equal(manifest.version,'20.27');
  const script=manifest.content_scripts.find(x=>x.js.includes('content.js'));
  assert(script.js.indexOf('engine-core.js')<script.js.indexOf('content.js'));
  assert(content.includes("cmd: 'statePatch', patch, src: TAB_ID, epoch: leaseEpoch"));
  assert(content.includes("ch.lock.newValue?.epoch !== leaseEpoch"));
  assert(content.includes("autonomyMode() === 'epic'"));
  assert(content.includes("else if (fishNow()) await goFishing()"));
  assert(!popup.includes("storage.local.set({ rt: { ...rt, _src: 'menu'"));
  assert(popup.includes('if (v) await activateMode(patch, mode); else await menuPatch(patch, { cfgPatch: mode });'));
  assert(popup.includes('epicMode: v') && popup.includes('fishMode: false, rbHuntMode: false')); 
  assert(popup.includes('rbHuntMode: v') && !popup.includes("$('rbToggle').onclick"));
  assert(bg.includes("chrome.tabs.onRemoved.addListener"));
  console.log('PASS: code integration, menu writes migrated, manifest scripts order');
}
(async()=>{await testPatchQueue(); testRecovery();testModesAndTransitions();testIntegration(); console.log('PASS: all v6 core tests');})().catch(e=>{console.error(e);process.exitCode=1;});
