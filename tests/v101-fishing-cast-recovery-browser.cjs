'use strict';
const assert=require('node:assert/strict'),{fishingRecovery,until,delay}=require('./v101-fishing-cast-recovery-fixture.cjs');
async function test(kind){const f=await fishingRecovery(kind);try{
 await f.start();if(!kind.startsWith('legacy'))await until(()=>f.S.casts.length===1,20000);
 if(kind==='reload')await f.h.g.p.reload();
 if(kind==='legacy-ambiguous'){await delay(7000);assert.equal(f.S.casts.length,0);assert.ok((await f.h.get(['rt'])).rt.fishCastPending);
 }else if(['stop','tvt','selection'].includes(kind)){
  await until(()=>f.S.held,30000);
  if(kind==='stop')await f.h.click('stop');
  if(kind==='selection'){await f.h.popup.locator('[data-auto-task="fish"]').click();await until(async()=>!(await f.h.get(['cfg'])).cfg.autoTasks.includes('fish'));}
  if(kind==='tvt'){f.S.tvt=true;await f.h.g.p.evaluate(()=>fetch('/game/tvt'));await until(()=>f.h.g.core('L2V7Modules.tvt.tvtHold()'));}
  f.release();await delay(2000);assert.equal(f.S.casts.length,1);assert.equal(f.S.accepted,0);
 }else{await until(()=>f.S.hits===1,40000);if(kind==='accepted-lost-limit')await until(async()=>{const {rt}=await f.h.get(['rt']);return rt.fish?.caught===1&&!rt.fishCastPending;});await f.h.click('stop');assert.equal(f.S.accepted,1);assert.equal(f.state.basicBait.quantity,29);assert.equal(f.S.casts.length,kind.startsWith('accepted-lost')||kind.startsWith('legacy')?1:2);assert.ok(f.S.casts.every(b=>b.expectedRevision===100),'original and recovery share revision fence');}
 await f.h.click('stop');assert.deepEqual(f.S.errors,[]);console.log('PASS fishing recovery '+kind,JSON.stringify({casts:f.S.casts,accepted:f.S.accepted,hits:f.S.hits,visits:f.S.visits}));
 }catch(e){console.error('DIAG',kind,JSON.stringify({S:f.S,core:await f.h.g.core('JSON.stringify({on,running,tabOwner,mode:autonomyMode(),status:rt.status,fishState:L2V7Modules.fishing.fishState(),rod:L2V7Modules.fishing.rodText(),body:document.body.innerText.slice(-2500)})'),state:await f.h.get(['rt','on'])}));throw e;}finally{await f.close();}}
(async()=>{for(const k of(process.env.FISH_RECOVERY_CASES||'aborted,accepted-lost,race,reload,stop,tvt,selection,accepted-lost-limit,legacy,legacy-ambiguous,legacy-full').split(','))await test(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
