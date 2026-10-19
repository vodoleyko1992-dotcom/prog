'use strict';
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false});try{
 const {p,core}=h.g;
 await p.goto('https://l2wap.com/battle.html?spawnId=native_fixture');
 await until(()=>core('typeof L2V7Modules.combat.ready === "function"'));
 for(const id of ['whirlwind','wild_sweep']){
  const label=id==='whirlwind'?'Whirlwind':'Wild Sweep';
  await p.evaluate(({id,label})=>{
   document.getElementById('native-slot')?.remove();const b=document.createElement('button');b.id='native-slot';b.className='l2-battle-hotbar-slot';b.title=label+' — скилл';
   b.innerHTML='<span class="l2-battle-hotbar-slot-cd l2-battle-hotbar-slot-cd--on" data-slot-cd="'+id+'"><span class="l2-battle-hotbar-slot-cd__timer">2.3</span></span>';
   document.body.append(b);
  },{id,label});
  const data=await core(`(()=>{const b=document.getElementById('native-slot'),t=Date.now();ACT_NET.start=ACT_NET.done=1;ACT_NET.doneT=t;combatCooldown.observeSync({serverNowMs:t,globalCooldownUntilMs:t,skillCooldowns:{${JSON.stringify(id)}:t+100}},cdSpawn());return {action:slotAction(b),kind:slotKind(b),ready:ready(b)}})()`);
  assert.deepEqual(data,{action:id,kind:'скилл',ready:false});
  await delay(150);assert.equal(await core("ready(document.getElementById('native-slot'))"),false,'грация после серверного дедлайна');
  await delay(1250);assert.equal(await core("ready(document.getElementById('native-slot'))"),true,id+' восстанавливается при застывшем DOM');
  assert.equal(await p.locator('#native-slot .l2-battle-hotbar-slot-cd__timer').textContent(),'2.3','таймер действительно не обновлялся');
  await p.locator('#native-slot').evaluate(b=>{b.disabled=true});assert.equal(await core("ready(document.getElementById('native-slot'))"),false,'disabled не обходится');
  await p.locator('#native-slot').evaluate(b=>{b.disabled=false;b.setAttribute('aria-disabled','true')});assert.equal(await core("ready(document.getElementById('native-slot'))"),false,'aria-disabled не обходится');
  await p.locator('#native-slot').evaluate(b=>b.removeAttribute('aria-disabled'));
  await core("history.replaceState(null,'','/battle.html?spawnId=other_fixture')");assert.equal(await core("ready(document.getElementById('native-slot'))"),false,'дедлайн чужого боя не подходит');
  await core("history.replaceState(null,'','/battle.html?spawnId=native_fixture')");
 }
 assert.deepEqual(h.errors,[]);assert.equal((await h.get(['on'])).on,false);assert.ok(h.requests.every(r=>r.method==='GET'));
 console.log('PASS actual MV3: native whirlwind/wild_sweep, серверный дедлайн и грация, застывший реальный DOM, disabled/aria/spawn защиты, без POST');
}finally{await h.ctx.close()}})().catch(e=>{console.error(e);process.exitCode=1});
