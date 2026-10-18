'use strict';
// 18.10: настоящий MV3/content/hook, синтетические ответы игры; никаких обращений к аккаунту.
const assert=require('node:assert/strict');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const HTML=`<!doctype html><html><head><title>Рыбалка — проверка восстановления</title></head><body>
<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="l2-nav-bottom"></div>
<span id="l2-hud-hp-cur">16000</span><span id="l2-hud-hp-max">16000</span><span id="l2-hud-mp-cur">6000</span><span id="l2-hud-mp-max">6000</span>
<div id="fishing-gear-row"><div class="l2-fishing-gear-item l2-fishing-gear-item--rod">Вудка +10</div><div class="l2-fishing-gear-item">100 наживок</div></div>
<div id="fishing-time-remaining">05:36:43</div><div id="fishing-target" hidden></div><div id="fishing-log"></div>
<button class="l2-fishing-hotbar-slot" data-slot="fishing">Fishing</button>
<button class="l2-fishing-hotbar-slot toggle-on" data-slot="basicBait">Наживка <span class="l2-battle-hotbar-slot-uqty">100</span></button>
<script>
(async()=>{
 while(!window.__l2botHook)await new Promise(r=>setTimeout(r,10));
 const b=document.querySelector('[data-slot="fishing"]');b.disabled=true;
 await fetch('/character');let state=await(await fetch('/game/fishing/state')).json();
 b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{const r=await fetch('/game/fishing/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cast',expectedRevision:state.revision})});const j=await r.json();if(r.ok){state=j.fishing;if(state.logTail?.length)document.getElementById('fishing-log').innerHTML='<div class="l2-fishing-log-line l2-fishing-log-line--no_bite">Рыба не клюнула.</div>';}}finally{b.disabled=false;}};
 b.disabled=false;
})();
</script></body></html>`;
async function scenario(kind){
 const h=await harness({withPopup:false}),S={revision:64042,casts:[],accepted:0,bait:100,visits:0,errors:[]};let release;
 const gate=new Promise(r=>release=r);
 const character=()=>({name:'AuditHero',id:'fixture-fisher',level:75,l2Profession:'human_warlock',revision:S.revision,hp:16000,maxHp:16000,mp:6000,maxMp:6000,adena:1000000,inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const state=()=>({revision:S.revision,target:null,serverNowMs:Date.now(),logTail:S.accepted>1?[{kind:'no_bite',text:'Рыба не клюнула.'}]:[],fishingTime:{remainingMs:20203399,canFish:true},basicBait:{quantity:S.bait}});
 try{
  // Даже при потерянной доставке netStart квитанция остаётся в общей памяти документа.
  if(kind!=='normal')await h.ctx.addInitScript(()=>window.addEventListener('message',e=>{if(e.data?.__l2bot==='netStart'&&e.data.path==='/game/fishing/action'&&e.data.req?.action==='cast')e.stopImmediatePropagation();},true));
  await h.ctx.route('https://l2wap.com/**',async r=>{
   const p=new URL(r.request().url()).pathname,json=(data,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   try{
    if(p==='/fishing.html'){S.visits++;return r.fulfill({contentType:'text/html',body:HTML});}
    if(p==='/character')return json({character:character()});
    if(p==='/game/fishing/state')return json(state());
    if(p==='/game/fishing/action'){
     const b=r.request().postDataJSON();S.casts.push(b);assert.equal(b.action,'cast');if(b.expectedRevision!==S.revision)return json({error:'revision_conflict'},409);
     S.accepted++;S.bait--;S.revision++;const response={revision:S.revision,fishing:state(),character:character()};
     if(S.accepted===1)await gate;
     return json(response).catch(()=>{}); // reload может оборвать доставку уже применённого запроса.
    }
    if(r.request().method()==='POST')throw Error('unexpected POST '+p);return json({});
   }catch(e){S.errors.push(e.message);return r.fulfill({status:500,body:'{}'}).catch(()=>{});}
  });
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['fish'],fishMode:false,fishAutoSetup:false,fishTimeAuto:false,fishAutoBuy:false,fishRodBuy:false,fishProcess:false,fishShots:false,fishBait:'basic',fishMaxCasts:2,rodEnchantTo:0,dailyFishLimit:0,rec:false,netLog:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',rodLvl:10,fishSetupDone:Date.now(),fishCastPending:null,fish:null}});});
  await h.g.p.goto('https://l2wap.com/fishing.html');await until(()=>S.accepted===1,30000);
  const receipt=await h.g.p.evaluate(()=>JSON.parse(sessionStorage.getItem('l2bot.fishingCastRequest')||'null'));
  assert.equal(receipt?.requestRevision,64042,'точная revision сохранена до доставки ответа');
  if(kind!=='normal')assert.equal((await h.get(['rt'])).rt.fishCastPending.requestRevision,undefined,'netStart намеренно потерян');
  if(kind==='slow-response'){
   await delay(8442);release();await until(()=>h.g.p.evaluate(()=>!document.querySelector('[data-slot="fishing"]').disabled));
  }
  if(kind==='stop')await h.g.core('automationStop("Проверка Stop перед обновлением", "stop", {user:true})');
  if(kind==='deselected')await h.sw.evaluate(async()=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,autoTasks:[]}});});
  await h.g.p.reload();release();
  if(kind==='stop'||kind==='deselected'){
   await until(()=>h.g.core('typeof L2V7Modules.fishing === "object"'));await delay(1500);assert.equal(S.accepted,1);assert.equal(S.casts.length,1);
  }else{
   await until(()=>S.accepted===2,30000);await until(async()=>{const s=await h.get(['rt','on']);return s.on===true&&s.rt.fish?.casts===2&&!s.rt.fishCastPending;},30000);
   await delay(500);assert.equal(S.accepted,2,'лимит забросов не обходится восстановлением');
   assert.deepEqual(S.casts,[{action:'cast',expectedRevision:64042},{action:'cast',expectedRevision:64043}]);assert.equal(S.bait,98);
   const {rt}=await h.get(['rt']);assert.equal(rt.fishCastPending,null);assert.equal(rt.fish.nobite,1,'исход старого запроса не выдуман');assert.equal(rt.fish.caught,0);
  }
  assert.deepEqual(S.errors,[]);assert.deepEqual(h.errors,[]);console.log('PASS MV3 fishing reload '+kind,JSON.stringify({accepted:S.accepted,requests:S.casts.length,visits:S.visits,bait:S.bait}));
 }catch(e){console.error('DIAG',kind,JSON.stringify({S,core:await h.g.core('JSON.stringify({on,running,tabOwner,status:rt.status,pending:rt.fishCastPending,fish:rt.fish,mode:autonomyMode()})').catch(()=>null)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{for(const kind of (process.env.FISH_RELOAD_CASES||'normal,lost-start,slow-response,stop,deselected').split(','))await scenario(kind);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
