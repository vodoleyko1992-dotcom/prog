'use strict';
// Настоящее MV3-расширение; harness перехватывает все HTTPS локально, живой игры нет.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
const legacy=['epicMode','rbHuntMode','rbMode','fishMode','catMode','zoneAuto','campaign','enchantMode','dailyAuto','clanTasks','mmOrders','mmUpgrade','mmMailClaim','mmGoalFarm','mmCraftSend','mmFarmGuide','storyTurnIn','campAuto','tvtOn','enemyHunt','pvpOnSight','petFullAuto','autoMagister','shopAuto','weaponScanAuto','townBuff','sealAuto','autoLearn','chain'];
const jobs=['tbuff','petBufferTrip','shop','magister','invScan','mmJob','storyJob','tsJob','rbGo','rbHunt','zoneGo','bagCheck','faScan','recipeScan','farmScan','rbScan','zoneScan','fishSvc','fishService','dailyFish','dailyRb'];
(async()=>{const h=await harness();try{
 const patch=async(cfgPatch,rtPatch={})=>h.sw.evaluate(async({cfgPatch,rtPatch})=>{const s=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...s.cfg,...cfgPatch},rt:{...s.rt,...rtPatch,_src:'policy-browser'}});},{cfgPatch,rtPatch});
 const modes=()=>h.g.core('({mode:autonomyMode(),tvt:cfg.tvtOn,fish:cfg.fishMode,cat:cfg.catMode,quest:cfg.campaign,raid:cfg.rbHuntMode,enchant:cfg.enchantMode,shop:cfg.shopAuto,chain:cfg.chain})');
 for(const list of [['tvt'],[]]){
  await patch({...Object.fromEntries(legacy.map(k=>[k,true])),autoTasks:list,rec:false,autoSnap:false}, {...Object.fromEntries(jobs.map(k=>[k,{t:Date.now(),step:k==='rbHunt'?'exit':'start'}])),actionOwner:null,enchant:null,revive:null});
  await until(()=>h.g.core('JSON.stringify(cfg.autoTasks)==='+JSON.stringify(JSON.stringify(list))));
  const mark=h.requests.length,url=h.g.p.url();await h.click('start');
  await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="tasks"'));
  await until(()=>h.g.core(JSON.stringify(jobs)+'.every(k=>!rt[k])'));
  await delay(2300);assert.equal(h.g.p.url(),url);
  // 20.54 (прогон смоуков 23.10): с 20.27 (#291) каждый Старт читает серверные сутки GET /game/time + /game/daily-quests независимо от
  // галки дейликов — это чтение лимитов, не квест; остальные маршруты квестов/боя/телепортов по-прежнему запрещены.
  assert.deepEqual(h.requests.slice(mark).filter(r=>r.method!=='GET'||r.path!=='/game/daily-quests'&&(/\.html$|battle|quest|teleport|fishing|mammon|magister|rb-boss/.test(r.path))),[]);
  const effective=await modes();assert.equal(effective.tvt,list.includes('tvt'));for(const key of ['fish','cat','quest','raid','enchant','shop','chain'])assert.equal(effective[key],false,key);
  const raw=(await h.get(['cfg'])).cfg;for(const key of legacy)assert.equal(raw[key],true,'raw '+key);
  await h.g.p.reload();await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="tasks"'));await delay(2200);assert.equal(new URL(h.g.p.url()).pathname,'/map.html');
  assert.deepEqual(h.requests.slice(mark).filter(r=>r.method!=='GET'),[]);
  await h.click('stop');await until(()=>h.g.core('!on && !running'));
  console.log('PASS '+JSON.stringify(list)+': actual Start/reload clears legacy routes, stays on map, no POST, raw options preserved');
 }
 for(const [list,mode,yes] of [[['fish'],'fish','fish'],[['cat'],'cat','cat'],[['quests'],'campaign','quest']]){
  await patch({autoTasks:list},{storySaga:{completed:true},dionCampaign:{stage:'active'},campaignUrl:'',campSkipUntil:0});
  await until(async()=>(await modes()).mode===mode);const v=await modes();assert.equal(v[yes],true);for(const key of ['tvt','fish','cat','quest','raid','enchant'])if(key!==yes)assert.equal(v[key],false);
  assert.equal((await h.get(['on'])).on,false);assert.equal(await h.g.core('on'),false);
  console.log('PASS '+list+': real storage/content policy selects only intended mode; edit does not start bot');
 }
 await patch({autoTasks:['tvt']});await until(async()=>(await modes()).mode==='tasks');await h.click('start');await until(()=>h.g.core('on && running && tabOwner'));
 await h.g.core('L2V7Modules.actions.enterFrame(); window.__policyContext=L2V7Modules.actions.context();true');assert.equal(await h.g.core('L2V7Modules.actions.canAct()'),true);
 await patch({autoTasks:[]});await until(()=>h.g.core('cfg.autoTasks.length===0'));
 // Сравнение контекста проверяем по сохранённому отпечатку: основной цикл вправе уже открыть следующий frame.
 assert.equal(await h.g.core('window.__policyContext!==L2V7Modules.actions.context()'),true);assert.equal(await h.g.core('cfg.tvtOn'),false);assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,[]);
 await delay(2300);assert.equal(new URL(h.g.p.url()).pathname,'/map.html');await h.click('stop');await until(()=>h.g.core('!on && !running'));
 // Задержанный настоящий GET TvT: пользователь снимает задачу, пока старый цикл ждёт ответ.
 let heldRoute=null;await h.ctx.route('**/game/tvt',route=>{heldRoute=route;});
 await patch({autoTasks:['tvt']},{tvt:null,actionOwner:null});await h.g.core('TVT=null;true');
 await h.click('start');await until(()=>heldRoute!==null);
 const pending={id:'unknown-shop',kind:'shop',key:'shop:fixture',char:'AuditHero',at:Date.now(),phase:'prepared',quote:{amount:1000,currency:'adena'},evidence:{ids:[1539],beforeQty:0,qty:1}};
 const mark=h.requests.length;
 await patch({autoTasks:[]},{shop:{t:Date.now(),step:'buy'},rbHunt:{t:Date.now(),step:'exit',id:'old-raid'},actionPayments:{pending,history:[]}});
 await until(()=>h.g.core('cfg.autoTasks.length===0 && rt.actionPayments?.pending?.id==="unknown-shop"'));
 await heldRoute.fulfill({json:{phase:'REGISTRATION',eventId:'stale-event',isRegistered:false,registrationEndsAt:Date.now()+60000}});await h.ctx.unroute('**/game/tvt');
 await until(()=>h.g.core('!rt.shop && !rt.rbHunt'));
 await until(()=>h.requests.slice(mark).some(r=>r.path==='/character'));
 await delay(1000);assert.equal(new URL(h.g.p.url()).pathname,'/map.html');assert.equal(await h.g.core('rt.actionPayments.pending.id'),'unknown-shop');assert.deepEqual(h.requests.slice(mark).filter(r=>r.method!=='GET'),[]);
 await h.g.p.reload();await until(()=>h.g.core('on && running && tabOwner && rt.actionPayments?.pending?.id==="unknown-shop"'));await delay(800);
 assert.equal(new URL(h.g.p.url()).pathname,'/map.html');assert.deepEqual(h.requests.slice(mark).filter(r=>r.method!=='GET'),[]);
 await h.click('stop');await until(()=>h.g.core('!on && !running'));await patch({}, {actionPayments:{pending:null,history:[]},tvt:null});
 console.log('PASS selection during awaited TvT GET rejects stale registration; old routes canceled; unknown payment survives reload with GET-only reconciliation');
 // Основной цикл сам уходит на арену, переживает навигацию и возвращается к выбранной задаче.
 for(const list of [['tvt','fish'],['tvt']]){
  const event='priority-'+list.join('-'),status={phase:'PREPARATION',eventId:event,isRegistered:true,myTeam:'blue',startsAt:Date.now()+30000,t:Date.now()};
  await patch({autoTasks:list,fishAutoSetup:false,fishRodBuy:false,fishProcess:false},{tvt:status,tvtDone:null,tvtIn:null,actionPayments:{pending:null,history:[]}});
  await h.g.core('TVT='+JSON.stringify(status)+';true');await h.click('start');
  await until(()=>new URL(h.g.p.url()).pathname==='/tvt-arena.html',20000);
  await until(()=>h.g.core('on && running && tabOwner && !!rt.tvtIn'),20000);
  assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,list);
  await h.g.core('TVT={...TVT,...rt.tvt,phase:"FINISHED",startsAt:Date.now()-60000,t:Date.now()};true');
  const target=list.includes('fish')?'/fishing.html':'/map.html';await until(()=>new URL(h.g.p.url()).pathname===target,20000);
  await until(()=>h.g.core('on && running && tabOwner'),20000);
  assert.equal(await h.g.core('autonomyMode()'),list.includes('fish')?'fish':'tasks');
  assert.equal((await h.get(['rt'])).rt.tvtDone,event);assert.deepEqual((await h.get(['cfg'])).cfg.autoTasks,list);
  await h.click('stop');await until(()=>h.g.core('!on && !running'));
  // Следующий случай начинает с карты; переход теста выполняется только после Stop.
  if(target!=='/map.html'){await h.g.p.goto('https://l2wap.com/map.html');await until(()=>h.g.core('!on'));}
  console.log('PASS '+JSON.stringify(list)+': actual main preempts to TvT, exits finished event and resumes '+target+' without changing selection');
 }
 assert.deepEqual(h.errors,[]);console.log('PASS running allowlist change propagates without navigation; zero page errors');
}finally{await h.ctx.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
