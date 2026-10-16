'use strict';
// Actual MV3; статические строки и порядок мобов из присланного снимка, все запросы перехватывает локальный harness.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const list=fs.readFileSync(path.join(__dirname,'fixtures/farm-local-quests-20261016.html'),'utf8');
const html=`<!doctype html><meta charset="utf-8"><script>localStorage.setItem('token','synthetic-local-only')</script><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">45</div><div id="character-profession">Human Warrior</div><div id="l2-nav-bottom"></div><div id="map-list-mode-mobs" class="is-active"></div>${list}<span id="map-mob-page-ind" class="l2-compact-pages"><button class="l2-compact-pages__btn" disabled>1</button><button class="l2-compact-pages__btn">2</button><button class="l2-compact-pages__btn">3</button><button class="l2-compact-pages__btn">4</button><button class="l2-compact-pages__btn">5</button><button class="l2-compact-pages__btn">&gt;&gt;</button></span>`;
async function run(kind){const h=await harness();try{
 const visits=[];await h.ctx.route('https://l2wap.com/map.html',r=>r.fulfill({contentType:'text/html',body:html}));
 await h.ctx.route('https://l2wap.com/character-quests.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="character-profession">Human Warrior</div><div id="character-quests-list"><p class="l2-character-quests-empty">Нет активных квестов.</p></div><div id="l2-nav-bottom"><a href="/map.html" data-nav-role="outskirts">Окрестности</a></div>'}));
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({json:{character:{name:'AuditHero',level:45,revision:100,hp:4990,maxHp:4990,mp:775,maxMp:775,adena:100000,inventory:{eq:{},stacks:[]}}}}));
 await h.ctx.route('https://l2wap.com/battle.html?*',async r=>{visits.push(new URL(r.request().url()).searchParams.get('spawnId'));await r.fallback();});
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof L2V7Modules.mobfarm==="object"'));
 const rows=await h.g.core('pageItems().map(i=>({id:i.id,name:i.name,lvl:i.lvl}))');
 const tasks=kind==='completed-stories'?['tvt','quests','farm']:kind==='tvt-only'?['tvt']:['tvt','farm'];
 await h.sw.evaluate(async({tasks,rows,kind})=>{
  const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
  await chrome.storage.local.set({cfg:{...cfg,autoTasks:tasks,searchQuest:true,searchChamp:true,priority:'[квест]\n[чемп]\n[все]',champBlue:true,champOrange:true,champRed:false,lvlAbove:99,lvlBelow:3,lvlMin:1,lvlMax:99,townBuff:false,sealAuto:false,autoMagister:false,weaponScanAuto:false,shopAuto:false,rec:false,autoSnap:false},
   rt:{...rt,lvl:45,prof:'Human Warrior',zone:'forest_of_mirrors',zoneMobs:{forest_of_mirrors:rows.map(r=>r.name)},spawns:Object.fromEntries(rows.map(r=>[r.id,[r.name,r.lvl]])),questSeen:{'taik orc warrior':now},quests:{'Taik Orc Warrior':{prof:1,total:50,done:3,left:47,t:now}},profQuest:{open:['taik orc warrior'],t:now},
    ...(kind==='completed-stories'?{storySaga:{stage:'completed',completed:true},dionCampaign:{stage:'completed',completed:true},questList:[],questListT:0,campSkipUntil:0,campaign:null,campaignUrl:'',campaignDue:true}:{}),shop:null,actionOwner:null,actionPayments:{pending:null,history:[]}}});
 },{tasks,rows,kind});
 await until(()=>h.g.core('JSON.stringify(cfg.autoTasks)==='+JSON.stringify(JSON.stringify(tasks))));
 if(kind==='farm'){
  assert.equal(await h.g.core('L2EngineCore.selectedTask(cfg,rt)'),'farm');assert.equal(await h.g.core('cfg.searchQuest'),true);assert.equal(await h.g.core('cfg.campaign'),false);
  const picks=await h.g.core('candidates(parseRules(),aroundSig(),L2V7Modules.mobfarm.markerTypes(),aroundSig().ids.length).slice(0,5).map(c=>({id:c.id,rank:c.rank,quest:c.quest,champ:c.champ}))');
  assert.equal(picks[0].id,'dense_10653');assert.equal(picks[0].rank,0);assert.equal(picks[0].quest,true);assert.ok(!picks.some(c=>c.id==='champ_r_forest_of_mirrors_2'));
 }
 if(kind==='completed-stories'){
  await h.g.p.goto('https://l2wap.com/character-quests.html');await until(()=>h.g.core('autonomyMode()==="campaign"'));
 }
 const mark=h.requests.length;await h.popup.locator('#start').click();
 if(kind==='tvt-only'){
  await until(()=>h.g.core('on&&running&&tabOwner'));await delay(1800);assert.equal(new URL(h.g.p.url()).pathname,'/map.html');assert.deepEqual(visits,[]);
 }else{
  await until(()=>visits.length>0,25000);assert.equal(visits[0],'dense_10653');
  if(kind==='completed-stories')assert.ok((await h.get(['rt'])).rt.campNoTasksUntil>Date.now(),'explicit empty page published confirmed absence');
 }
 await h.popup.locator('#stop').click();await until(()=>h.g.core('!on&&!running'));
 const nav=h.requests.slice(mark).filter(r=>/\.html$/.test(r.path));assert.ok(!nav.some(r=>/teleport|campaign|character-quests|mail/.test(r.path)),'no unsolicited campaign/location detour');
 assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,tasks);assert.deepEqual(h.errors,[]);
 console.log('PASS '+kind+': actual task policy → '+(kind==='tvt-only'?'idle without battle':'native link to visible ★ Taik Orc Warrior')+'; no campaign/teleport, unchanged selection');
 }catch(e){console.error('DIAG '+kind,JSON.stringify({url:h.g.p.url(),visits,core:await h.g.core('({on,running,tabOwner,mode:autonomyMode(),status:rt.status,inventory:rt.inventoryGate,owner:rt.actionOwner,target:rt.target})').catch(()=>null),requests:h.requests.slice(-20),errors:h.errors}));throw e;}finally{await h.ctx.close();}}
(async()=>{for(const k of ['farm','completed-stories','tvt-only'])await run(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
