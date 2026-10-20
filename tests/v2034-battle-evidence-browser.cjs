'use strict';
// Настоящее MV3: MAIN fetch/XHR → isolated content → background IDB → оба скачанных формата.
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const h=await harness();try{
  const packet={revision:44,character:{hp:6195,maxHp:6195,mp:18,maxMp:874,password:'DO_NOT_SAVE'},
   delta:{mobHp:0,logSeq:70,serverNowMs:1000,logTail:Array.from({length:70},(_,i)=>`Ход ${i}: `+'Вихор вразив ворогів поруч −123. '.repeat(8)),
    whirlwindExtras:Array.from({length:31},(_,i)=>({spawnId:'evidence_'+i,name:'Garden Guard '+i,mobHp:0,mobMaxHp:2484,token:'DO_NOT_SAVE'})),skillCooldowns:[{skillId:181,readyAt:10000,remainingSec:9}]},
   victory:{spawnId:'battle_evidence',mobName:'Garden Guard',adena:123292,sp:19820,exp:0,fullLog:['Итог боя: 31 цель','Получено 123292 адены']}};
  await h.g.p.route('**/game/battle/action',r=>r.fulfill({json:packet}));
  await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,rec:true,netLog:true,autoLearn:false}})});
  await until(()=>h.g.core('cfg.rec && cfg.netLog'));
  const replies=await h.g.p.evaluate(async()=>{
   const init={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'l2_181',battleSpawnId:'battle_evidence',expectedRevision:43})};
   const a=await(await fetch('/game/battle/action',init)).json(),b=await(await fetch('/game/battle/action',init)).json();
   const c=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST','/game/battle/action');x.responseType='json';x.onload=()=>resolve(x.response);x.send(init.body)});return[a,b,c];
  });
  assert.equal(replies.length,3);assert.equal(replies[2].character.password,'DO_NOT_SAVE');
  const saved=await until(()=>h.popup.evaluate(async()=>{const rows=(await readLog({last:1000})).filter(([,e])=>e.data?.battle?.spawn==='battle_evidence');return rows.length===3?rows:null}),15000);
  assert.equal(new Set(saved.map(([,e])=>e.data.rid)).size,3);
  for(const [,e]of saved){assert.equal(e.data.battle.extras.length,31);assert.equal(e.data.battle.log.lines.length,70);assert.equal(e.data.battle.reward.adena,123292);assert.doesNotMatch(JSON.stringify(e),/DO_NOT_SAVE/)}
  console.log('PASS actual MAIN fetch ×2 + XHR → three distinct IDB events, 31 targets / 70 long lines / final reward / no secrets');
  const txtDownload=h.popup.waitForEvent('download');
  await h.popup.evaluate(async()=>exportLog((await readLog({last:1000})).filter(([,e])=>e.data?.battle?.spawn==='battle_evidence'),'проверка боя',false));
  const txt=fs.readFileSync(await(await txtDownload).path(),'utf8'),blocks=txt.split('\n').filter(x=>!x.startsWith('#')&&x.includes('| бой: ')).map(x=>JSON.parse(x.slice(x.indexOf('| бой: ')+7)));
  assert.equal(blocks.length,3);for(const b of blocks){assert.equal(b.log.lines.length,70);assert.equal(b.extras.at(-1).id,'evidence_30');assert.equal(b.reward.sp,19820)}assert.doesNotMatch(txt,/DO_NOT_SAVE/);
  const jsonDownload=h.popup.waitForEvent('download');await h.popup.evaluate(()=>$('exJson').onclick());
  const lines=fs.readFileSync(await(await jsonDownload).path(),'utf8').trim().split('\n').map(x=>JSON.parse(x)),events=lines.slice(1).filter(x=>x.data?.battle?.spawn==='battle_evidence');
  assert.equal(events.length,3);assert.equal(lines[0].omitted,0);assert.equal(lines[0].kept,lines.length-1);
  assert.deepEqual(events.map(x=>({rid:x.data.rid,...x.data.battle})),blocks);
  assert.deepEqual(h.errors,[]);console.log('PASS downloaded TXT and JSONL preserve identical bounded evidence, zero page errors; all game traffic mocked');
 }finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
