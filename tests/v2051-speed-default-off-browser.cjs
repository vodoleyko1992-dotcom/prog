'use strict';
// Настоящее расширение с прежним профилем без нового ключа; все игровые ответы локальные.
// 20.59 (John 24.10 «замедление в норме 0.5с … по умолчанию»): умолчание и разовая миграция — 0,5 с вместо прежнего 0.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();try{
 await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');delete cfg.actionDelayMs;await chrome.storage.local.set({cfg:{...cfg,autoTasks:[],petFullAuto:false,petBuffAuto:false}});});
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner && cfg.actionDelayMs === 500'));
 const result=await h.g.core(`(async()=>{actionNote();const t=performance.now();let clicks=0;for(let i=0;i<3;i++){if(!await actionWait())throw Error('cancelled');if(fire(document.querySelector('#probe')))clicks++;}return {gap:actionPace.gap(),left:actionPace.left(),elapsed:performance.now()-t,clicks};})()`);
 assert.equal(result.gap,500);assert.equal(result.clicks,3);assert.ok(result.elapsed>=900&&result.elapsed<2500,JSON.stringify(result));
 await h.click('stop');await until(()=>h.g.core('!on && !running'));assert.deepEqual(h.errors,[]);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
 fs.writeFileSync(path.join(__dirname,'../docs/evidence/speed-panel/default-05s-chromium.json'),JSON.stringify({checkedAt:new Date().toISOString(),localResponsesOnly:true,...result,pageErrors:0,posts:0},null,2)+'\n');
 console.log('PASS actual MV3 legacy profile→default 0.5 s; three clicks with 0.5 s pace; Stop/no POST/page errors');
}finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
