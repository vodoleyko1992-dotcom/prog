'use strict';
// 20.43 (разбор 21.10): настоящий MV3 — «Тур РБ» + «На месте». Подходящих РБ нет (единственный РБ убит) → в простое тура бой
// с мобом этой точки, без телепорта и оплат. Контроль: только «Тур РБ» — бот ждёт со статусом тура и мобов не бьёт.
// Все ответы игры локальные; функции бота не подменяются.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const list=fs.readFileSync(path.join(__dirname,'fixtures/farm-local-quests-20261016.html'),'utf8');
const hud='<div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">45</div><div id="character-profession">Human Warrior</div><div id="l2-nav-bottom"></div>';
const mapHtml=`<!doctype html><meta charset="utf-8"><script>localStorage.setItem('token','synthetic-local-only')</script>${hud}<div id="map-list-mode-mobs" class="is-active"></div>${list}<span id="map-mob-page-ind" class="l2-compact-pages"><button class="l2-compact-pages__btn" disabled>1</button><button class="l2-compact-pages__btn">2</button><button class="l2-compact-pages__btn">3</button><button class="l2-compact-pages__btn">4</button><button class="l2-compact-pages__btn">5</button><button class="l2-compact-pages__btn">&gt;&gt;</button></span>`;
const rbId='l2dop_rb_45001';
const rbHtml=`<!doctype html><meta charset="utf-8"><script>localStorage.setItem('token','synthetic-local-only')</script>${hud}<div id="rb-pager-ind"><button disabled aria-current="page">1</button></div><div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">Idle Camp Boss</span><span class="l2-rb-row__level">45</span><span class="l2-rb-row__status">Убит</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="${rbId}">Телепорт</button></div></div><div id="rb-load-err"></div>`;
async function run(kind){const h=await harness();const visits=[],posts=[];try{
 await h.ctx.route('https://l2wap.com/map.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:mapHtml}));
 await h.ctx.route('https://l2wap.com/rb-bosses.html*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:rbHtml}));
 await h.ctx.route('https://l2wap.com/game/raid-bosses*',r=>r.fulfill({json:{page:1,pageSize:15,total:1,totalPages:1,baseAdenaCost:100000,adenaCost:100000,characterLevel:45,minRaidBossLevel:36,bosses:[{spawnId:rbId,name:'Idle Camp Boss',level:45,bossType:'raid',isAlive:false,adenaCost:100000,canAttack:true}]}}));
 await h.ctx.route('https://l2wap.com/character',r=>r.fulfill({json:{character:{name:'AuditHero',level:45,revision:100,hp:4990,maxHp:4990,mp:775,maxMp:775,adena:100000,inBattle:false,locationType:'map',inventory:{eq:{},stacks:[]}}}}));
 await h.ctx.route('https://l2wap.com/battle.html?*',async r=>{visits.push(new URL(r.request().url()).searchParams.get('spawnId'));await r.fallback();});
 h.ctx.on('request',req=>{if(req.method()==='POST'&&/l2wap\.com/.test(req.url()))posts.push(new URL(req.url()).pathname);});
 await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('typeof L2V7Modules.mobfarm==="object"'));
 const rows=await h.g.core('pageItems().map(i=>({id:i.id,name:i.name,lvl:i.lvl}))');
 const tasks=kind==='raid+farm'?['raid','farm']:['raid'];
 await h.sw.evaluate(async({tasks,rows,rbId})=>{
  const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
  await chrome.storage.local.set({cfg:{...cfg,taskOnly:false,autoTasks:tasks,dailyKillLimit:0,dailyFishLimit:0,limitRanges:{},rbFaFull:false,rbValueTour:false,rbOrder:'up',rbMaxBelow:12,rbMaxAbove:12,rbTimers:false,rbProbe:false,
    tvtOn:false,petFullAuto:false,petAuto:false,petBuffAuto:false,townBuff:false,townBuffSet:'off',faBuffs:'',nBuffs:'',nKeyBuffs:'',shopAuto:false,autoRoles:false,autoMagister:false,autoShots:false,potSlotAuto:false,weaponScanAuto:false,sealAuto:false,
    searchQuest:true,searchChamp:false,priority:'[квест]\n[все]',lvlAbove:99,lvlBelow:3,lvlMin:1,lvlMax:99,reactMin:0,reactMax:0,rec:true,autoSnap:false},
   rt:{...rt,char:'AuditHero',lvl:45,prof:'Human Warrior',zone:'forest_of_mirrors',zoneMobs:{forest_of_mirrors:rows.map(r=>r.name)},spawns:Object.fromEntries(rows.map(r=>[r.id,[r.name,r.lvl]])),
    questSeen:{'taik orc warrior':now},profQuest:{open:['taik orc warrior'],t:now},dailyStart:3,manualKickAt:0,rbList:{},rbListT:0,rbHunt:{step:'pick'},rbGo:null,rbFishWait:null,rbScan:null,rbHuntIdle:0,rbIdleMark:null,
    rbRefuse:null,rbSess:null,shop:null,actionOwner:null,actionPayments:{pending:null,history:[]}}});
 },{tasks,rows,rbId});
 await until(()=>h.g.core('JSON.stringify(cfg.autoTasks)==='+JSON.stringify(JSON.stringify(tasks))));
 assert.equal(await h.g.core('L2EngineCore.selectedTask(cfg,rt)'),'raid','выбран тур РБ');
 assert.equal(await h.g.core('cfg.zoneAuto||cfg.catMode'),false,'при туре автофарм и катакомбы через список не включаются');
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
 await h.popup.locator('#start').click();
 // полный свежий список → подходящих нет → простой тура
 await until(()=>h.g.core('on && rt.rbHuntIdle > Date.now() && rt.rbHunt?.phase === "wait"'),40000);
 if(kind==='raid+farm'){
  await until(()=>visits.length>0,40000);
  assert.ok(rows.some(r=>r.id===visits[0]),'бой с мобом этой точки');
  // 20.69: visits отмечает начало запроса, когда прежний документ уже исчезает. Читаем состояние после загрузки нового мира и настроек.
  const st=await until(()=>h.g.core('location.pathname==="/battle.html" && rt.char==="AuditHero" && JSON.stringify(cfg.autoTasks)==='+JSON.stringify(JSON.stringify(tasks))+' ? ({idle:rt.rbHuntIdle,next:rt.rbHunt?.next,sel:L2EngineCore.selectedTask(cfg,rt)}) : null'));
  assert.equal(st.sel,'raid');assert.match(st.next||'',/фарм на месте при наличии мобов/);
 }else{
  await delay(6000);
  assert.deepEqual(visits,[],'без «На месте» тур мобов не бьёт');
  assert.match(await h.g.core('rt.rbHunt?.next||""'),/фарм мобов сейчас не выбран/);
 }
 await h.popup.locator('#stop').click();await until(()=>h.g.core('!on&&!running'));
 const nav=h.requests.filter(r=>/\.html$/.test(r.path)).map(r=>r.path);
 assert.ok(!nav.some(p=>/teleport|town-buffer|gm-shop|fast-aden|catacomb|dungeon/.test(p)),'нет перелётов/покупок: '+nav.join(','));
 assert.deepEqual(posts.filter(p=>/teleport|buy|buffer|apply|enter-city/.test(p)),[],'нет платных запросов');
 assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,tasks);assert.deepEqual(h.errors,[]);
 console.log('PASS '+kind+': '+(kind==='raid+farm'?'простой тура → бой на месте '+visits[0]:'простой тура без боя')+'; без перелётов и оплат');
 }catch(e){console.error('DIAG '+kind,JSON.stringify({url:h.g.p.url(),visits,posts,core:await h.g.core('({on,running,tabOwner,mode:autonomyMode(),sel:L2EngineCore.selectedTask(cfg,rt),status:rt.status,hunt:rt.rbHunt,idle:rt.rbHuntIdle,start:[rt.rbListStartRequired,rt.rbListReadStart],list:rt.rbList})').catch(()=>null),requests:h.requests.slice(-25),errors:h.errors}));throw e;}finally{await h.ctx.close();}}
(async()=>{for(const k of ['raid+farm','raid'])await run(k);})().catch(e=>{console.error(e.stack);process.exitCode=1;});
