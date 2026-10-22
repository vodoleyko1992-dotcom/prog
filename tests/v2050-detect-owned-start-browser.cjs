'use strict';
// 20.50: настоящий MV3 Start -> owned inventory preflight, без page-resync после получения lease.
// Все HTTP перехвачены. DOM панели и её fetch-клиент — управляемый стенд, не сохранённые JS игры.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
const {until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const root=path.resolve(process.env.DETECT_EXTENSION_ROOT||path.join(__dirname,'..'));
const sourceFiles=['content.js','hook.js','background.js','engine-core.js','modules/buffs.js','modules/combat.js','modules/fightlab.js'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const startHashes=sourceHashes(),flags=Object.fromEntries([...fs.readFileSync(path.join(root,'content.js'),'utf8').matchAll(/once\('([^']+)'/g)].map(x=>[x[1],1]));
const rows=[{id:87,mp:18,action:'detect_animal_weakness',name:'Detect Animal Weakness'},
 {id:75,mp:14,action:'detect_insect_weakness',name:'Detect Insect Weakness'},
 {id:104,mp:21,action:'detect_plant_weakness',name:'Detect Plant Weakness'},
 // Цена Monster намеренно взята только из локальной серверной row; тест не утверждает живую цену навыка.
 {id:80,mp:7,action:'detect_monster_weakness',name:'Detect Monster Weakness'}];
const report={kind:'actual Chrome MV3; controlled page DOM/fetch client and locally fulfilled HTTPS',root,sourceHashes:startHashes,
 fixtureBoundaries:{panel:'Controlled DOM/buttons and fetch client implementing battleId + expectedRevision. Native renderer/executor JS are not used.',
  startup:'Exactly one MAIN page GET before Start. No test calls to resync/snapshot/module functions to supply Detect evidence after Start; own isolated-world inventory preflight must initiate the panel trip.',
  owner:'Real background storage listener receives a foreign lock belonging to an about:blank tab; no second game account/tab.',
  replay:'Reposts a captured real hook response after its request context has been consumed; no new netStart is synthesized.',
  unknown:'Server applies a mutation but returns malformed JSON. Actual document reload plus positive plan for another ID checks the persisted fence without waiting 630 seconds.'},
 liveGame:false,liveGameRequests:0,proof:[],pass:0,fail:0};
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
function html(panel){
 const hud='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">45</div><div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">8000</span><span id="l2-hud-hp-max">8000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">1000</span>';
 const dom=panel?'<div class="l2-battle-hotbar" data-visible-rows="1"><div class="l2-battle-hotbar__row" data-hotbar-row="1">'+rows.map((r,i)=>`<button class="l2-battle-hotbar-slot" data-slot-idx="${i}" title="${r.name}" disabled><span data-slot-cd="${r.action}" hidden></span>${r.name}</button>`).join('')+'</div></div><div id="skill-panel-status"></div>':'<div id="map-mob-list"></div>';
 return '<!doctype html><meta charset="utf-8"><title>Owned Detect local fixture</title>'+hud+dom+`<script>
  window.fixture={ready:false,reads:0,clicks:[],errors:[]};let snapshot=null,busy=false;
  function apply(c){snapshot=c;document.getElementById('l2-hud-mp-cur').textContent=c.mp;}
  document.addEventListener('DOMContentLoaded',async()=>{try{
   const r=await fetch('/character',{headers:{'X-Fixture-Reader':'page'}});fixture.reads++;apply((await r.json()).character);fixture.ready=true;
   for(const b of document.querySelectorAll('.l2-battle-hotbar-slot')){b.disabled=false;b.onclick=async()=>{
    if(busy)return;busy=true;fixture.clicks.push(b.dataset.slotIdx);
    try{const action=b.querySelector('[data-slot-cd]').dataset.slotCd,id=${JSON.stringify(rows)}.find(x=>x.action===action).id;
     const response=await fetch('/character/skills/cast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({battleId:'l2_'+id,expectedRevision:snapshot.revision})});
     const j=await response.json();if(response.ok&&j.character)apply(j.character);
    }catch(e){fixture.errors.push(e.name);}finally{busy=false;}
   };}
  }catch(e){fixture.errors.push(e.name);}});
 </script>`;
}
async function harness(selected,routeHandler){
 const ctx=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox',`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 try{
  const errors=[],external=[],net=[],requests=[];
  await ctx.exposeBinding('__fixtureRecord',(_source,d)=>{if(d?.__l2bot==='net'||d?.__l2bot==='netStart')net.push({...d,capturedAt:Date.now()});});
  await ctx.addInitScript(()=>addEventListener('message',e=>{if(e.source===window&&['net','netStart'].includes(e.data?.__l2bot))window.__fixtureRecord(e.data).catch(()=>{});}));
  await ctx.route(/^https?:\/\//,async r=>{
   const q=r.request(),u=new URL(q.url());requests.push({path:u.pathname,method:q.method()});
   if(u.origin!=='https://l2wap.com'){external.push({origin:u.origin,path:u.pathname});return r.abort('blockedbyclient');}
   return routeHandler(r);
  });
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:30000}),id=new URL(sw.url()).host;
  await until(()=>sw.evaluate(async()=>{const s=await chrome.storage.local.get(['cfg','rt']);return !!s.cfg&&!!s.rt;}));await delay(200);
  await sw.evaluate(async({selected,flags})=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,
   cfg:{...cfg,...flags,dock:false,autoTasks:['farm'],taskOnly:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,nBuffs:selected.join(', '),nToggles:'',
    townBuffSet:'off',vipBuffAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,shopAuto:false,tvtOn:false,enemyHunt:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,
    dailyAuto:false,clanTasks:false,zoneAuto:false,rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,campAuto:false,campaign:false,fishMode:false,weaponScanAuto:false,weaponClassEquip:false,
    chain:false,dailyKillLimit:0,rec:false,netLog:false,autoSnap:false,learnShots:false,reactMin:0,reactMax:0},
   rt:{...rt,...flags,char:'AuditHero',lvl:45,prof:'human_warlord',classCur:{prof:'human_warlord',slot:3},weaponsT:Date.now(),weapons:[{id:299,name:'Orcish Poleaxe',wt:'древковое',g:'C',where:'надето'}],shopT:Date.now(),
    detectOutside:null,detectOutsideWait:0,detectOutsideIntent:{},detectOutsideProof:{},manualKickAt:0,skills:{},skillDb:{},magister:null,invScan:null,shop:null,tbuff:null,petBufferTrip:null,rbHunt:null,rbGo:null,zoneGo:null,storyJob:null,craftJob:null}});},{selected,flags});
  const p=await ctx.newPage(),cdp=await ctx.newCDPSession(p),worlds=new Map();p.on('pageerror',e=>errors.push(e.message));
  cdp.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));cdp.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());await cdp.send('Runtime.enable');
  async function core(expression){for(const w of [...worlds.values()].reverse().filter(w=>w.origin==='chrome-extension://'+id)){
   const probe=await cdp.send('Runtime.evaluate',{contextId:w.id,expression:'typeof L2V7Modules',returnByValue:true}).catch(()=>null);if(probe?.result?.value!=='object')continue;
   const r=await cdp.send('Runtime.evaluate',{contextId:w.id,expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
  }throw Error('no content world');}
  const popup=await ctx.newPage();popup.on('pageerror',e=>errors.push(e.message));await popup.goto('chrome-extension://'+id+'/popup.html');await until(()=>popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
  return {ctx,sw,id,p,core,popup,errors,external,net,requests,get:keys=>sw.evaluate(keys=>chrome.storage.local.get(keys),keys),click:key=>popup.locator('#'+key).click()};
 }catch(e){await ctx.close();throw e;}
}
async function scenario(mode){
 const casts=[],reads=[],visits=[],held=[],routeErrors=[],outside=new Map();let revision=100,mp=500,h,startedAt=0,firstOwnStarted=false,completedOwn=0;
 let holdOwn=['stop-own-read','owner-own-read'].includes(mode);
 const monsterOnly=['monster-unlisted','monster-unknown-cost','monster-negative-cost','monster-cooldown'].includes(mode);
 const selected=monsterOnly?[rows[3]]:mode==='owned-four'?rows:rows.slice(0,3);
 const char=(get=true)=>({name:'AuditHero',level:45,l2Profession:'human_warlord',classBranch:'fighter',classSlots:{activeSlot:3,slots:[{slot:3,active:true,owned:true,profession:'human_warlord',level:45}]},
  revision,...(get?{snapshotGeneratedAt:Date.now()}:{}),inBattle:false,hp:8000,maxHp:8000,mp,maxMp:1000,skillMpCostMul:1,inventory:{eq:{l1:{itemId:299,enchant:0}},stacks:[]},
  activeBuffs:rows.map(r=>({skillId:r.id,level:1,expiresAt:outside.get(r.id)||Date.now()+1200000,...(outside.has(r.id)?{}:{battleDerived:true})})),
  learnedBattleSkillsDetail:rows.map(r=>({battleId:'l2_'+r.id,level:1,mpCost:r.id===80?99:r.mp})),battleHotbarSlots:rows.map(r=>({k:'a',a:r.action})),skillCooldowns:{},
  castableSelfBuffs:rows.filter(r=>r.id!==80||mode!=='monster-unlisted').map(r=>({battleId:r.id===80?'detect_monster_weakness':'l2_'+r.id,l2SkillId:r.id,
   ...(r.id===80&&mode==='monster-unknown-cost'?{}:{mpCost:r.id===80&&mode==='monster-negative-cost'?-1:r.mp}),readyRemainingSec:r.id===80&&mode==='monster-cooldown'?120:0}))});
 const release=()=>{holdOwn=false;for(const resolve of held.splice(0))resolve();};
 const routeHandler=async route=>{const q=route.request(),u=new URL(q.url()),p=u.pathname,json=(body,status=200)=>route.fulfill({json:body,status}).catch(()=>{});
  try{
   if(p==='/character'){
    const reader=q.headers()['x-fixture-reader']==='page'?'page':'own',entry={reader,page:new URL(q.frame().url()).pathname,at:Date.now(),revision};reads.push(entry);
    if(reader==='own'){firstOwnStarted=true;if(holdOwn)await new Promise(r=>held.push(r));completedOwn++;}
    return json({character:char()});
   }
   if(p==='/character/skills/cast'){
    assert.equal(q.method(),'POST');const body=q.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['battleId','expectedRevision']);assert.equal(body.expectedRevision,revision);
    const row=rows.find(r=>'l2_'+r.id===body.battleId);assert.ok(row,'known selected Detect');assert.ok(selected.some(r=>r.id===row.id),'only selected skill');
    assert.ok(reads.some(r=>r.reader==='own'&&r.at>=startedAt),'own preflight precedes POST');
    const state=(await h.get(['rt'])).rt,key=JSON.stringify(['AuditHero','human_warlord',3,row.id]),intent=state.detectOutsideIntent?.[key];
    assert.ok(['prepared','sent'].includes(intent?.phase),'durable intent exists before real POST');assert.equal(intent.baseRevision,revision);
    revision++;mp-=row.mp;outside.set(row.id,Date.now()+600000);casts.push({body,at:Date.now(),revision,mp,expiresAt:outside.get(row.id),intentId:intent.id});
    if(mode==='unknown-reload'&&casts.length===1)return route.fulfill({status:200,contentType:'application/json',body:'{'});
    return json({character:char(false),messageUk:'Detect застосовано.'});
   }
   assert.equal(q.method(),'GET','unexpected local POST '+p);
   if(p==='/map.html'||p==='/skill-panel.html'){visits.push({path:p,at:Date.now()});return route.fulfill({contentType:'text/html',body:html(p==='/skill-panel.html')});}
   if(/\.(png|gif|jpg)$/.test(p))return route.fulfill({contentType:'image/png',body:pixel});
   if(p==='/game/time')return json(require('./tools/daily-server-fixture.cjs')().clock);
   if(p==='/game/daily-quests')return json(require('./tools/daily-server-fixture.cjs')().daily);
   return json({});
  }catch(e){routeErrors.push(e.message);return json({error:'local_fixture_assertion'},500);}
 };
 const observation={case:mode,pass:false,casts,reads,visits};
 try{
  h=await harness(selected.map(r=>r.name),routeHandler);report.browser= h.ctx.browser()?.version();report.extensionVersion=await h.sw.evaluate(()=>chrome.runtime.getManifest().version);
  const actualHashes=await h.sw.evaluate(async files=>Object.fromEntries(await Promise.all(files.map(async p=>{const r=await fetch(chrome.runtime.getURL(p));const d=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return[p,[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')];}))),sourceFiles);
  assert.deepEqual(actualHashes,startHashes,'actual MV3 source equals frozen source bytes');
  await h.p.goto('https://l2wap.com/map.html');await until(()=>h.p.evaluate(()=>window.fixture?.ready));await until(()=>h.core('typeof on==="boolean"&&typeof L2V7Modules.buffs.detectOutsidePlan==="function"'));
  await until(()=>h.net.some(x=>x.__l2bot==='net'&&new URL(x.url,'https://l2wap.com').pathname==='/character'));
  assert.equal(reads.length,1);assert.equal(reads[0].reader,'page');assert.equal(await h.core('on||tabOwner'),false,'single page snapshot was completed before lease');
  assert.equal(await h.core('L2V7Modules.buffs.detectOutsidePlan()'),null);await h.p.bringToFront();startedAt=Date.now();await h.click('start');await until(()=>h.core('on&&tabOwner&&running'));
  await until(()=>firstOwnStarted);assert.equal(reads.filter(r=>r.reader==='page').length,1,'no second page GET supplies initial owned snapshot');
  if(process.env.DETECT_EXPECT_BASELINE==='1'){
   assert.equal(mode,'owned-three');await delay(5500);assert.equal(casts.length,0);assert.equal(await h.core('L2V7Modules.buffs.detectOutsidePlan()'),null);assert.equal(visits.length,1);
   assert.ok(await h.core('!!INV_READY&&INV_NET?.char==="AuditHero"'),'baseline own inventory preflight succeeded');observation.observedDefect='own inventory ready but no Detect plan/panel/casts';
  }else if(['stop-own-read','owner-own-read'].includes(mode)){
   assert.equal(await h.core('INV_READ!==null'),true);assert.equal(visits.length,1,'held own read precedes panel');
   if(mode==='stop-own-read'){await h.click('stop');await until(()=>h.core('!on&&!running'));}
   else{await h.sw.evaluate(async()=>{const t=await chrome.tabs.create({url:'about:blank',active:true});await chrome.storage.local.set({lock:{k:'tab'+t.id,epoch:'fixture-foreign-owner',t:Date.now(),vis:true,tab:t.id,url:'about:blank'}});});await until(()=>h.core('!tabOwner&&leaseEpoch===null'));}
   release();await until(()=>completedOwn>0);await until(()=>h.core('INV_READ===null'));await delay(400);
   assert.equal(casts.length,0);assert.equal(await h.core('INV_NET===null&&INV_READY===""'),true,'late own GET does not publish inventory');
   const rt=(await h.get(['rt'])).rt;assert.equal(rt.detectOutside??null,null);assert.deepEqual(rt.detectOutsideIntent||{},{});assert.deepEqual(rt.detectOutsideProof||{},{});
  }else if(monsterOnly){
   await until(()=>h.core('!!INV_READY'));await delay(800);assert.equal(await h.core('L2V7Modules.buffs.detectOutsidePlan()'),null);assert.equal(casts.length,0);assert.equal(visits.length,1,'ineligible Monster never navigates to panel');
  }else if(mode==='unknown-reload'){
   await until(()=>casts.length===1,20000);await until(async()=>Object.values((await h.get(['rt'])).rt.detectOutsideIntent||{}).some(x=>x.phase==='sent'));
   const first=+casts[0].body.battleId.slice(3);assert.deepEqual((await h.get(['rt'])).rt.detectOutsideProof||{},{});await h.p.reload();await until(()=>h.core('on&&tabOwner'));
   observation.reloadPlan=await until(async()=>{const p=await h.core('L2V7Modules.buffs.detectOutsidePlan()');return p&&p.id!==first?p:null;});
   await delay(1300);assert.equal(casts.filter(x=>x.body.battleId===casts[0].body.battleId).length,1,'unknown cast remains fenced after actual reload');
   assert.deepEqual((await h.get(['rt'])).rt.detectOutsideProof||{},{});
  }else{
   const n=selected.length;await until(async()=>casts.length===n&&new URL(h.p.url()).pathname==='/map.html'&&!(await h.get(['rt'])).rt.detectOutside,30000);
   assert.deepEqual(casts.map(x=>+x.body.battleId.slice(3)).sort((a,b)=>a-b),selected.map(x=>x.id).sort((a,b)=>a-b));
   const rt=(await h.get(['rt'])).rt,proof=rt.detectOutsideProof||{};assert.equal(Object.keys(proof).length,n);
   for(const c of casts){const id=+c.body.battleId.slice(3),key=JSON.stringify(['AuditHero','human_warlord',3,id]),p=proof[key],i=rt.detectOutsideIntent[key];
    assert.equal(p.skillId,id);assert.equal(p.revision,c.revision);assert.equal(p.expiresAt,c.expiresAt);assert.equal(i.phase,'confirmed');assert.ok(Number.isSafeInteger(i.rid));
    const start=h.net.find(x=>x.__l2bot==='netStart'&&x.rid===i.rid&&x.path==='/character/skills/cast');
    const ack=h.net.find(x=>x.__l2bot==='net'&&x.rid===i.rid&&x.req?.battleId===c.body.battleId);assert.ok(start&&ack,'exact actual hook request + ACK');assert.deepEqual(start.req,c.body);assert.deepEqual(ack.req,c.body);
   }
   assert.equal(mp,500-selected.reduce((sum,r)=>sum+r.mp,0),'fresh server row determines MP cost');observation.outsideProof=proof;
   if(mode==='replay-ack'){
    const ack=h.net.find(x=>x.__l2bot==='net'&&x.req?.battleId===casts[0].body.battleId),before=JSON.stringify(proof);assert.ok(ack);
    await h.p.evaluate(d=>{window.postMessage(d,location.origin);window.postMessage({...d,rid:d.rid+10000},location.origin);},ack);
    await delay(800);assert.equal(casts.length,n);assert.equal(JSON.stringify((await h.get(['rt'])).rt.detectOutsideProof),before,'replayed/unknown request ACK changes no proof and causes no click');
   }
  }
  assert.ok(reads.find(r=>r.reader==='own').at>=startedAt);const panelVisit=visits.find(v=>v.path==='/skill-panel.html');if(panelVisit)assert.ok(panelVisit.at>=reads.find(r=>r.reader==='own').at);
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.external,[]);assert.deepEqual(h.errors,[]);assert.equal(h.requests.filter(x=>x.method==='POST'&&x.path!=='/character/skills/cast').length,0);
  await h.click('stop');observation.pass=true;report.pass++;console.log('PASS owned-start Detect MV3',mode,JSON.stringify(observation));
 }catch(e){observation.error=e.message;observation.routeErrors=routeErrors;observation.state=h?await h.core('({on,tabOwner,running,status:rt.status,invReady:INV_READY,inv:INV_NET,job:rt.detectOutside,intent:rt.detectOutsideIntent,proof:rt.detectOutsideProof})').catch(()=>null):null;report.fail++;console.error('FAIL owned-start Detect MV3',JSON.stringify(observation));throw e;}
 finally{release();report.proof.push(observation);if(h)await h.ctx.close();}
}
(async()=>{
 const all=['owned-three','owned-four','monster-unlisted','monster-unknown-cost','monster-negative-cost','monster-cooldown','stop-own-read','owner-own-read','unknown-reload','replay-ack'];
 const cases=process.env.DETECT_BROWSER_CASES?process.env.DETECT_BROWSER_CASES.split(','):all;
 for(const mode of cases){assert.ok(all.includes(mode),'unknown case '+mode);await scenario(mode);}
 assert.deepEqual(sourceHashes(),startHashes,'source remained unchanged during browser run');
})().catch(e=>{report.error=e.stack;console.error(e.stack);process.exitCode=1;}).finally(()=>{
 report.cases=report.proof.length;report.localMockOutsidePosts=report.proof.reduce((n,x)=>n+x.casts.length,0);
 if(process.env.DETECT_BROWSER_REPORT)fs.writeFileSync(path.resolve(process.env.DETECT_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify(report));
});
