'use strict';
// Реальное MV3 меню/ядро, все HTTPS перехвачены локально. Цель уже достигнута: расходов нет.
// 20.54 (прогон смоуков 23.10): автозаточка снята по решению игрока 19.10 («пока убираем модуль автозаточки», PR #288, 20.25/20.26):
// выбранная задача enchant отфильтровывается (defaults.js withoutAutoEnchant), кнопок серии нет, start отклоняется. Прежний сценарий
// «enchant+fish → явная серия → цель достигнута → рыбалка» заменён действующим контрактом того же списка: сохранённый выбор
// ['enchant','fish'] сразу ведёт к выбранной рыбалке (а не к ожиданию или фарму), серия не создаётся, завершённая серия прежней
// версии не перезапускается и не переархивируется, ни одного не-GET запроса.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness(),traffic=[];try{
 const character={name:'AuditHero',revision:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']}},stacks:[{itemId:910527,qty:10}]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesRu:{8688:'Посох проверки'}};
 const item={key:'selected-weapon',itemId:8688,name:'Посох проверки',level:3,pb:0,mb:18,history:['magic','magic','magic'],legacy:0,uid:'',qty:1,slot:'rhand',eqSlot:'l1',grade:'A',category:'weapon',targetInstanceId:'eq:l1',fingerprint:JSON.stringify([8688,3,0,18,['magic','magic','magic'],0,'']),targetLevel:3,weaponMode:'magic',rules:{maxAttempts:2}};
 const enchant={enabled:true,queue:[item],scrollPolicy:'blessed',ordinaryUntil:3,maxAttempts:7,maxScrolls:9,maxAdena:0,maxConsecutiveFails:2,maxDropFromStart:1,maxDropFromPeak:2,delayMs:1500,purchase:false,colBudget:0};
 const totals={attempts:0,successes:0,failures:0,scrolls:0,adena:0,col:0,unknown:0,reservedScrolls:0,latencyMs:0,samples:0,conflicts:0,byScroll:{}};
 const done={v:1,char:'AuditHero',runId:'completed-run',status:'done',reason:'Все цели достигнуты',startedAt:1,finishedAt:2,items:[{...item,start:3,peak:3,attempts:0,successes:0,failures:0,failStreak:0,scrolls:0,adena:0,unknown:0,reservedScrolls:0,done:true}],totals,history:[],pending:null,nextAt:0,conflicts:0};
 const archive=[{runId:'older-run',startedAt:0,finishedAt:1,status:'done',totals,items:[],history:[]}];
 await h.ctx.route('https://**/*',route=>{const req=route.request(),path=new URL(req.url()).pathname;traffic.push({path,method:req.method()});if(path==='/character')return route.fulfill({json:{character}});if(path==='/character/catalog-hints')return route.fulfill({json:hints});return route.fallback();});
 const command=action=>h.sw.evaluate(async action=>{const [tab]=await chrome.tabs.query({url:'https://l2wap.com/*'});return chrome.tabs.sendMessage(tab.id,{cmd:'enchantCommand',id:crypto.randomUUID(),action,char:'AuditHero'},{frameId:0});},action);
 for(const [phase,session] of [['no saved series',null],['completed series of previous version',done]]){
  await h.sw.evaluate(async({enchant,session,archive})=>{const s=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...s.cfg,enchantMode:false,autoTasks:['enchant','fish'],enchant,fishAutoSetup:false,fishRodBuy:false,fishProcess:false},rt:{...s.rt,enchant:session,enchantArchive:archive,manualKickAt:0,_src:'selected-enchant-browser'}});},{enchant,session,archive});
  await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.popup.evaluate(()=>showTab('enchant'));
  assert.equal(await h.popup.locator('#enchantPanel [data-command="start"]').count(),0,'no series button');assert.equal(await h.popup.locator('#tab-overview').isVisible(),true);
  await h.popup.locator('#start').click();
  await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="fish"'),20000).catch(async e=>{console.log('DEBUG',await h.g.core('({mode:autonomyMode(),on,running,tabOwner,status:rt.status,tasks:cfg.autoTasks,session:rt.enchant})'));throw e;});
  assert.deepEqual(await h.g.core('cfg.autoTasks'),['fish']);assert.equal(await h.g.core('cfg.enchantMode'),false);
  const r=await command('start');assert.equal(r.ok,false);assert.match(r.reason,/Автозаточка временно убрана/);await delay(800);
  const state=await h.get(['cfg','rt']);assert.deepEqual(state.cfg.enchant.queue,[item]);assert.deepEqual(state.rt.enchant,session);assert.deepEqual(state.rt.enchantArchive,archive);
  assert.deepEqual(traffic.filter(x=>x.method!=='GET'),[]);
  console.log('PASS '+phase+': saved [enchant, fish] → selected fish runs directly; series start rejected; queue/series/archive unchanged; zero POST');
  await h.click('stop');await until(()=>h.g.core('!on && !running'),20000);
 }
 assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
