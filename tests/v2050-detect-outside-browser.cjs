'use strict';
// 20.50: настоящее MV3 и сохранённые native skill-panel/hotbar/executor/cast-client. Все HTTP-ответы локальные.
// Требуется кэш публичных JS из разрешённого аудита; тест ничего не скачивает и не читает игровые credentials.
// L2 framework/world-context — адаптер стенда; DOM кнопок создаёт неизменённый battle-hotbar.js, POST — native cast-client.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const cache=process.env.DETECT_NATIVE_CACHE||'/workspace/work/warlord-audit';
const nativeFiles=['skill-panel.html','battle-hotbar.js','battle-api-transport.js','l2-skill-cast-client.js','l2-skill-panel-executor.js','skill-panel.js'];
const native=Object.fromEntries(nativeFiles.map(f=>[f,fs.readFileSync(path.join(cache,f),'utf8')]));
const nativeHashes=Object.fromEntries(nativeFiles.map(f=>[f,createHash('sha256').update(native[f]).digest('hex')]));
for(const id of ['skill-panel-load-err','skill-panel-content','skill-panel-hotbar-mount','skill-panel-status'])assert.ok(native['skill-panel.html'].includes('id="'+id+'"'),'native DOM anchor '+id);
const rows=[{id:87,mp:18,action:'detect_animal_weakness',name:'Detect Animal Weakness',label:'Вразливість звірів (Detect Animal Weakness)'},
 {id:75,mp:14,action:'detect_insect_weakness',name:'Detect Insect Weakness',label:'Вразливість комах (Detect Insect Weakness)'},
 {id:104,mp:21,action:'detect_plant_weakness',name:'Detect Plant Weakness',label:'Вразливість рослин (Detect Plant Weakness)'}];
const proof=[];let browserVersion='',extensionVersion='',runtimeHashes=null;
const onePixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
function htmlPage(panel){
 const hud='<div id="l2-hud-legacy-name">AuditHero</div><span id="l2-hud-legacy-lvl">45</span><div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">8000</span><span id="l2-hud-hp-max">8000</span><span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">1000</span>';
 const shim=`
 let nativeSnapshot=null;
 const nativeRows=${JSON.stringify(rows)};
 function worldBattle(c){return{spawnId:'world-panel',serverNowMs:Date.now(),skills:nativeRows.map(r=>({id:r.action,l2SkillId:r.id,labelUk:r.label,iconUrl:'/skills/'+String(r.id).padStart(4,'0')+'.jpg',cooldownSec:10})),mysticSkillCdUntil:c.skillCooldowns||{},battleMods:{}};}
 window.L2={token:()=> 'local-fixture',tr:(k,f)=>f||k,authFetch:(p,o)=>fetch(p,o),lastSnapshot:()=>nativeSnapshot,
  playerMessageOr:(b,f)=>b?.messageUk||b?.messageRu||f||'',setToken(){},mountL2Nav(){},renderCharacterFromCache(){},applyHudFromSnapshot(c){document.getElementById('l2-hud-mp-cur').textContent=c.mp;},
  applyMutationSnapshot(c,apply){nativeSnapshot=c;L2.applyHudFromSnapshot(c);if(apply)apply(c);},
  async fetchSnapshot(){const r=await fetch('/character');return r.ok?(await r.json()).character:null;},
  async resyncCharacterWhenRequired(){const c=await L2.fetchSnapshot();nativeSnapshot=c;return c;},
  async resyncCharacterAfterConflict(apply){const c=await L2.fetchSnapshot();if(c)L2.applyMutationSnapshot(c,apply);return c;}};
 window.L2BattleHotbarWorldContext={buildFromCharacter:worldBattle};
 window.L2SkillPanelHotbar={mountWorldPanel(container,opts){return L2BattleHotbar.mount({container,getBattle:()=>worldBattle(opts.getCharacter()),getCharacter:opts.getCharacter,getToken:opts.getToken,showToast:opts.showToast,onBattleAction:a=>opts.onHotbarAction(a)});}};
 `;
 return '<!doctype html><meta charset="utf-8"><title>Local Detect outside panel</title>'+hud+(panel?'<div class="l2-screen-inner l2-skill-panel-root"><p class="err" id="skill-panel-load-err" hidden></p><main class="l2-skill-panel-main" id="skill-panel-content" hidden><h1 class="l2-skill-panel-title">Панель скілів</h1><div id="skill-panel-hotbar-mount" class="l2-skill-panel-hotbar-mount l2-battle-skills"></div><div id="skill-panel-status" class="l2-skill-panel-status" hidden></div></main></div>'
  +'<script>'+shim+'</script><script src="/battle-hotbar.js"></script><script src="/battle-api-transport.js"></script><script src="/l2-skill-cast-client.js"></script><script src="/l2-skill-panel-executor.js"></script><script src="/skill-panel.js"></script>':'<div id="map-mob-list"></div><script>'+shim+'\n document.addEventListener("DOMContentLoaded",()=>L2.resyncCharacterWhenRequired().then(c=>{if(c)L2.applyMutationSnapshot(c);}));</script>');
}
async function scenario(mode){
 const h=await harness(),casts=[],battlePosts=[],visits=[],routeErrors=[],held=[],observations={};
 let revision=100,mp=mode==='mp-zero'?0:500,prof='human_warlord',slot=3,inBattle=false,holdReads=['stop','owner','class','mp-change'].includes(mode),nativeReadStarted=false;
 const outside=new Map(),char=(nativeGet=true)=>({id:'native-local-actor',name:'AuditHero',level:45,l2Profession:prof,classBranch:'fighter',classSlots:{activeSlot:slot},
  revision,...(nativeGet?{snapshotGeneratedAt:Date.now()}:{}),inBattle,battleSpawnId:'native-detect-fallback',hp:8000,maxHp:8000,mp,maxMp:1000,skillMpCostMul:1,pAtk:3000,mAtk:100,
  inventory:{eq:{l1:{itemId:299,enchant:0}},stacks:[]},
  activeBuffs:rows.map(r=>({skillId:r.id,level:1,expiresAt:outside.get(r.id)||Date.now()+1200000,...(outside.has(r.id)?{}:{battleDerived:true})})),
  learnedBattleSkillsDetail:rows.map(r=>({battleId:'l2_'+r.id,level:1,hintUk:'Витрата MP: '+r.mp,mpCost:r.mp})),battleHotbarSlots:rows.map(r=>({k:'a',a:r.action})),castableSelfBuffs:[],
  panelHotbarSkills:rows.map(r=>({id:r.action,l2SkillId:r.id,labelUk:r.label,iconUrl:'/skills/'+String(r.id).padStart(4,'0')+'.jpg',mpCost:r.mp,cooldownSec:10})),
  skillCooldowns:mode==='cooldown'?Object.fromEntries(rows.map(r=>['l2_'+r.id,Date.now()+120000])):{}});
 const release=()=>{holdReads=false;for(const fn of held.splice(0))fn()};
 try{
  browserVersion=h.ctx.browser()?.version()||browserVersion;extensionVersion=await h.sw.evaluate(()=>chrome.runtime.getManifest().version);
  if(!runtimeHashes)runtimeHashes=await h.sw.evaluate(async()=>Object.fromEntries(await Promise.all(['content.js','hook.js','background.js','engine-core.js','modules/actions.js','modules/buffs.js','modules/equipment.js'].map(async p=>{
   const r=await fetch(chrome.runtime.getURL(p)),d=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return[p,[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')];}))));
  await h.sw.evaluate(async names=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:['farm'],taskOnly:false,combatProfile:'fighter',autoRoles:false,autoMagister:false,nBuffs:names.join(', '),nToggles:'',
   townBuffSet:'off',vipBuffAuto:false,petAuto:false,petBuffAuto:false,petFullAuto:false,shopAuto:false,tvtOn:false,enemyHunt:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,dailyAuto:false,clanTasks:false,
   zoneAuto:false,rbMode:false,rbHuntMode:false,epicMode:false,catMode:false,campAuto:false,campaign:false,fishMode:false,weaponScanAuto:false,weaponClassEquip:false,chain:false,dailyKillLimit:0,rec:false,netLog:false,reactMin:0,reactMax:0},
   rt:{...rt,char:'AuditHero',lvl:45,prof:'human_warlord',classCur:{prof:'human_warlord',slot:3},weaponsT:Date.now(),weapons:[{id:299,name:'Orcish Poleaxe',wt:'древковое',g:'C',where:'надето'}],shopT:Date.now(),
    detectOutside:null,detectOutsideIntent:{},detectOutsideProof:{},manualKickAt:0,skills:{},skillDb:{},magister:null,invScan:null,shop:null,tbuff:null,petBufferTrip:null,rbHunt:null,rbGo:null,zoneGo:null,storyJob:null,craftJob:null}})},rows.map(r=>r.name));
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const q=route.request(),p=new URL(q.url()).pathname,json=(body,status=200)=>route.fulfill({json:body,status}).catch(()=>{});
   try{
    if(p==='/character'){
     if(holdReads&&new URL(h.g.p.url()).pathname==='/skill-panel.html'){nativeReadStarted=true;await new Promise(r=>held.push(r));}
     // Snapshot is generated when the blocked local GET completes: class/MP changes are part of its actual reply.
     return json({character:char()});
    }
    if(p==='/character/skills/cast'){
     const body=q.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['battleId','expectedRevision']);assert.ok(/^l2_(75|87|104)$/.test(body.battleId));assert.equal(body.expectedRevision,revision);
     casts.push({body,at:Date.now()});
     if(mode==='fallback'){inBattle=true;return json({error:'skill_in_battle',messageUk:'Кастити поза боєм — лише коли ти не в бою.'},400);}
     const id=+body.battleId.slice(3);revision++;outside.set(id,Date.now()+600000);mp-=rows.find(r=>r.id===id).mp;
     // Server mutation happened, but reply cannot be parsed: no safe hook ACK and no native unhandled network exception.
     if(mode==='unknown-reload'&&casts.length===1)return route.fulfill({status:200,contentType:'application/json',body:'{'});
     return json({character:char(false),messageUk:'Detect застосовано.'});
    }
    if(p==='/game/battle/action'){
     assert.equal(mode,'fallback','только explicit native fallback может послать mock battle action');battlePosts.push(q.postDataJSON());
     return json({serverNowMs:Date.now(),character:char(),battle:{spawnId:'native-detect-fallback',mobName:'Local Guard',mobHp:1000,mobMaxHp:1000,skills:[]}});
    }
    assert.equal(q.method(),'GET','неожиданный mock POST '+p);
    if(p==='/map.html'||p==='/skill-panel.html'){visits.push(p);return route.fulfill({contentType:'text/html',body:htmlPage(p==='/skill-panel.html')});}
    if(native[p.slice(1)]&&p.endsWith('.js'))return route.fulfill({contentType:'application/javascript',body:native[p.slice(1)]});
    if(/\.(?:jpg|png|gif|svg)$/.test(p))return route.fulfill({contentType:'image/png',body:onePixel});
    return route.fallback();
   }catch(e){routeErrors.push(e.message);return json({error:'fixture_assertion'},500)}
  });
  if(mode==='native-ui'){
   await h.g.p.goto('https://l2wap.com/skill-panel.html');await until(()=>h.g.p.locator('.l2-battle-hotbar-slot[data-slot-idx="0"] [data-slot-cd]').count());
   const dom=await h.g.p.locator('.l2-battle-hotbar-slot:not(.l2-battle-hotbar-slot--empty)').evaluateAll(bs=>bs.map(b=>({title:b.title,action:b.querySelector('[data-slot-cd]')?.dataset.slotCd,idx:b.dataset.slotIdx})));
   assert.equal(dom.length,3);await h.g.p.locator('.l2-battle-hotbar-slot[data-slot-idx="0"]').click();await until(()=>casts.length===1);
   assert.deepEqual(Object.keys((await h.get(['rt'])).rt.detectOutsideProof||{}),[],'manual fixture smoke without a bot intent does not create an outside proof');
   proof.push({case:mode,pass:true,dom,casts,battlePosts});
  }else{
   await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof L2V7Modules.buffs.detectOutsideStep==="function"'));
   await h.g.p.bringToFront();await h.click('start');await until(()=>h.g.core('on&&tabOwner&&running'));
   // The fixture page performs its ordinary native snapshot refresh under the acquired content lease.
   await h.g.p.evaluate(async()=>{if(location.pathname!=='/map.html')return;const c=await L2.resyncCharacterWhenRequired();if(c)L2.applyMutationSnapshot(c);});
   if(['stop','owner','class','mp-change'].includes(mode)){
    await until(()=>nativeReadStarted,15000);
    if(mode==='stop')await h.click('stop');
    if(mode==='owner'){
     observations.foreignOwner=await h.sw.evaluate(async()=>{const t=await chrome.tabs.create({url:'about:blank',active:true});await chrome.storage.local.set({lock:{k:'tab'+t.id,epoch:'local-fixture-foreign-owner',t:Date.now(),vis:true,tab:t.id,url:'about:blank'}});return t.id;});
     await until(()=>h.g.core('!tabOwner&&leaseEpoch===null'));
    }
    if(mode==='class'){prof='orc_titan';slot=4;revision++;await h.g.core('rt={...rt,prof:"orc_titan",classCur:{prof:"orc_titan",slot:4}};automationGeneration++;true');}
    if(mode==='mp-change'){mp=0;revision++;await h.g.p.evaluate(()=>{document.getElementById('l2-hud-mp-cur').textContent='0'});}
    release();await delay(600);assert.equal(casts.length,0);
   }else if(mode==='unknown-reload'){
    await until(()=>casts.length===1,15000);await until(()=>h.sw.evaluate(async()=>Object.keys((await chrome.storage.local.get('rt')).rt.detectOutsideIntent||{}).length>0));
    await h.g.p.reload();await until(()=>h.g.core('on&&tabOwner'));
    await h.g.p.evaluate(async()=>{const c=await L2.resyncCharacterWhenRequired();if(c)L2.applyMutationSnapshot(c);});
    const first=+casts[0].body.battleId.slice(3),plan=await until(async()=>{const p=await h.g.core('L2V7Modules.buffs.detectOutsidePlan()');return p&&p.id!==first?p:null;});
    observations.reloadPlan=plan;assert.notEqual(plan.id,first,'fresh positive snapshot still fences the unknown skill, independently of the job wait timer');
    await delay(1500);assert.equal(casts.filter(x=>x.body.battleId===casts[0].body.battleId).length,1,'unknown outside cast не повторяется после reload');
   }else if(mode==='fallback'){
    await until(()=>battlePosts.length>0,15000);await delay(400);const state=await h.get(['rt']);assert.deepEqual(Object.keys(state.rt.detectOutsideProof||{}),[],'native battle fallback не является outside ACK');
   }else if(mode==='mp-zero'){
    await until(()=>h.g.core('meMp()?.cur===0'));
    assert.equal(await h.g.core('L2V7Modules.buffs.detectOutsidePlan()'),null,'native MP0 forbids an outside plan');
    await delay(600);assert.equal(casts.length,0);assert.equal(visits.includes('/skill-panel.html'),false,'MP0 does not start a panel trip');
   }else if(mode==='cooldown'){
    await until(()=>h.g.core('meMp()?.cur===500'));
    await delay(600);assert.equal(casts.length,0);
    assert.equal(await h.g.core('L2V7Modules.buffs.detectOutsidePlan()'),null,'native cooldown object blocks all selected Detect skills');
    const state=(await h.get(['rt'])).rt;assert.deepEqual(Object.keys(state.detectOutsideIntent||{}),[],'bot does not prepare a cast that only native UI would reject');assert.notEqual(state.detectOutside?.phase,'wait');
    assert.equal(visits.includes('/skill-panel.html'),false,'all selected skills on server CD do not start a panel trip');
   }else{
    await until(async()=>casts.length===3&&new URL(h.g.p.url()).pathname==='/map.html'&&!(await h.get(['rt'])).rt.detectOutside,25000);
    assert.deepEqual(casts.map(x=>+x.body.battleId.slice(3)).sort((a,b)=>a-b),[75,87,104]);
    const state=(await h.get(['rt'])).rt;assert.equal(Object.keys(state.detectOutsideProof||{}).length,3);
   }
   await h.click('stop');proof.push({case:mode,pass:true,casts,battlePosts,visits,...observations,outsideProof:(await h.get(['rt'])).rt.detectOutsideProof||{}});
  }
  assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);console.log('PASS MV3 cached native Detect outside',mode,JSON.stringify(proof.at(-1)));
 }catch(e){console.error('DIAG',mode,JSON.stringify({casts,battlePosts,visits,routeErrors,state:await h.g.core('({on,tabOwner,status:rt.status,job:rt.detectOutside,intent:rt.detectOutsideIntent,proof:rt.detectOutsideProof})').catch(()=>null)}));throw e}
 finally{release();await h.ctx.close()}
}
(async()=>{
 const all=['native-ui','all-three','unknown-reload','stop','owner','class','mp-zero','mp-change','cooldown','fallback'],modes=process.env.DETECT_BROWSER_CASES?process.env.DETECT_BROWSER_CASES.split(','):all;
 for(const mode of modes){assert.ok(all.includes(mode),'неизвестный сценарий '+mode);await scenario(mode);}
 const report={browser:browserVersion,extensionVersion,runtimeHashes,nativeAssetHashes:nativeHashes,kind:'actual MV3 plus cached native hotbar renderer/skill-panel/executor/cast-client; controlled L2/world adapter and local routes',
  fixtureBoundaries:{framework:'Controlled L2 snapshot API and world-panel adapter; cached native renderer creates DOM and cached native executor/client creates POST.',map:'Controlled native fetch GET/character supplies the page snapshot; no cached map implementation.',owner:'Background storage receives a valid foreign lock owned by a local about:blank tab; actual content storage listener invalidates the lease. No second real game tab.',unknownReply:'Local server applies the cast and returns HTTP200 malformed JSON; fresh native GET plus actual positive plan of another ID proves the persisted fence; the full timeout is not waited.'},
  cases:proof.length,proof,liveGame:false,liveGamePosts:0,localMockOutsidePosts:proof.reduce((n,x)=>n+x.casts.length,0),localMockBattlePosts:proof.reduce((n,x)=>n+x.battlePosts.length,0),pageErrors:[],routeErrors:[]};
 if(process.env.DETECT_BROWSER_REPORT)fs.writeFileSync(path.resolve(process.env.DETECT_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
