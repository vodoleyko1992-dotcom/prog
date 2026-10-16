'use strict';
// Настоящие MV3/main/hook и клики меню; вся игра заменена локальными ответами.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness();let held=null,hp=300;const acts=[];
try{
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...cfg,autoTasks:['fish','auto'],fishAutoSetup:false,fishRodBuy:false,fishProcess:false,fishShots:false,autoShots:false,potSlotAuto:false,reactMin:0,reactMax:0,townBuff:false,sealAuto:false},rt:{...rt,fishCastActive:true,fishCastPending:null,fish:{casts:1,caught:0},manualKickAt:0,actionOwner:null,actionPayments:{pending:null,history:[]}}});});
 await h.ctx.route('https://l2wap.com/**',async r=>{
 const path=new URL(r.request().url()).pathname;
 if(path==='/character')return r.fulfill({json:{character:{name:'AuditHero',level:75,inventory:{stacks:[]},hp:100,maxHp:100,mp:100,maxMp:100}}});
 if(path==='/fishing.html')return r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"><a href="/map.html" data-nav-role="outskirts">Окрестности</a></div><div id="fishing-target"><span class="l2-fishing-target__name">Old Box</span><span class="l2-fishing-target__hp">300 / 300</span><span class="l2-fishing-target__state">Reeling</span></div><button class="l2-fishing-hotbar-slot" data-slot="reeling">Reeling</button><div id="fishing-log"></div><script>document.querySelector('button').onclick=async()=>{const d=await(await fetch('/game/fishing/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reeling',expectedRevision:1})})).json();document.querySelector('.l2-fishing-target__hp').textContent=d.hp+' / 300';if(!d.hp){document.getElementById('fishing-target').hidden=true;document.getElementById('fishing-log').innerHTML='<div class="l2-fishing-log-line catch">Вы вытащили Old Box</div>';}};</script>`});
 if(path==='/game/fishing/action'){
  acts.push(r.request().postDataJSON().action);hp-=100;
  if(acts.length===1||acts.length===4){held=()=>r.fulfill({json:{hp,ok:true}});return;}
  return r.fulfill({json:{hp,ok:true}});
 }
 return r.fallback();
 });
 await h.g.p.goto('https://l2wap.com/fishing.html');await until(()=>h.g.core('!on && rt.char==="AuditHero"'));await h.g.p.bringToFront();await h.click('start');await until(()=>held!==null);
 if(!await h.popup.locator('#autoTaskSelection').isVisible())await h.popup.locator('#modeToggle').click();
 await h.popup.locator('[data-auto-task="fish"]').uncheck();await until(()=>h.g.core('!cfg.autoTasks.includes("fish")'));
 await held();held=null;
 await until(()=>new URL(h.g.p.url()).pathname==='/map.html',20000);
 assert.deepEqual(acts,['reeling','reeling','reeling']);assert.equal((await h.get(['on'])).on,true);
 await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="farm"'));
 console.log('PASS remove fish during awaited action: finish existing catch, navigate to auto farm, no cast and no restart');
 // Добавление задачи также должно сменить frame, не требуя Stop/Start.
 hp=300;await h.popup.locator('[data-auto-task="fish"]').check();await until(()=>new URL(h.g.p.url()).pathname==='/fishing.html',20000);
 await until(()=>held!==null);const mark=acts.length;
 await h.popup.locator('[data-auto-task="mammon"]').check();
 await until(()=>h.g.core('cfg.autoTasks.includes("mammon")'));await held();held=null;await until(()=>acts.length>mark,10000);
 assert.equal((await h.get(['on'])).on,true);assert.equal(await h.g.core('running && tabOwner'),true);
 await h.click('stop');await until(()=>h.g.core('!on && !running'));await delay(100);
 assert.deepEqual(h.errors,[]);console.log('PASS re-enable fish and add another task during catch: actions continue without restart; Stop exits; zero page errors');
}catch(e){console.error('DIAG',acts,await h.g.core('JSON.stringify({on,running,tabOwner,status:rt.status,mode:autonomyMode(),frame:L2V7Modules.actions.canAct()})').catch(()=>''));throw e;}finally{await h.ctx.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
