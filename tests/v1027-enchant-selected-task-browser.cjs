'use strict';
// Реальное MV3 меню/ядро, все HTTPS перехвачены локально. Цель уже достигнута: расходов нет.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const assert=require('node:assert/strict');
(async()=>{const h=await harness(),traffic=[];try{
 const character={name:'AuditHero',revision:100,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:3,enchantPAtkBonus:0,enchantMAtkBonus:18,weaponEnchantHistory:['magic','magic','magic']}},stacks:[{itemId:910527,qty:10}]}};
 const hints={itemSlotHints:{8688:'rhand'},itemGradeHints:{8688:'A'},itemNamesRu:{8688:'Посох проверки'}};
 const item={key:'selected-weapon',itemId:8688,name:'Посох проверки',level:3,pb:0,mb:18,history:['magic','magic','magic'],legacy:0,uid:'',qty:1,slot:'rhand',eqSlot:'l1',grade:'A',category:'weapon',targetInstanceId:'eq:l1',fingerprint:JSON.stringify([8688,3,0,18,['magic','magic','magic'],0,'']),targetLevel:3,weaponMode:'magic',rules:{maxAttempts:2}};
 const enchant={enabled:true,queue:[item],scrollPolicy:'blessed',ordinaryUntil:3,maxAttempts:7,maxScrolls:9,maxAdena:0,maxConsecutiveFails:2,maxDropFromStart:1,maxDropFromPeak:2,delayMs:1500,purchase:false,colBudget:0};
 await h.ctx.route('https://**/*',route=>{const req=route.request(),path=new URL(req.url()).pathname;traffic.push({path,method:req.method()});if(path==='/character')return route.fulfill({json:{character}});if(path==='/character/catalog-hints')return route.fulfill({json:hints});return route.fallback();});
 await h.sw.evaluate(async enchant=>{const s=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({cfg:{...s.cfg,enchantMode:false,autoTasks:['enchant','fish'],enchant,fishAutoSetup:false,fishRodBuy:false,fishProcess:false},rt:{...s.rt,enchant:null,enchantArchive:[],manualKickAt:0,_src:'selected-enchant-browser'}});},enchant);
 await h.popup.reload();await until(()=>h.popup.locator('#enchantPanel [data-command="start"]').count());await h.popup.evaluate(()=>document.querySelector('nav [data-tab="enchant"]').click());
 const button=()=>h.popup.locator('#enchantPanel [data-command="start"]');assert.equal(await button().isDisabled(),true);
 await h.click('start');await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="enchant"'));
 await until(()=>button().isEnabled());assert.equal((await h.get(['cfg'])).cfg.enchantMode,false);await delay(500);assert.equal((await h.get(['rt'])).rt.enchant,null);
 console.log('PASS allowlist enchant selection enables explicit series button with raw enchantMode=false; no implicit series');
 let previous='';
 for(let i=0;i<2;i++){
  if(i){await until(()=>new URL(h.g.p.url()).pathname==='/fishing.html');await delay(300);await h.popup.reload();await until(()=>button().count());await h.popup.evaluate(()=>document.querySelector('nav [data-tab="enchant"]').click());await until(()=>button().isEnabled());}
  await button().click();await until(async()=>{const r=(await h.get(['rt'])).rt.enchant;return r?.status==='done'&&r.runId!==previous;},20000).catch(async e=>{console.log('RESTART DEBUG',await h.g.core('({mode:autonomyMode(),on,running,tabOwner,status:rt.status,session:rt.enchant,ack:rt.enchantCommandAck,archive:rt.enchantArchive,owner:rt.actionOwner})'),await h.popup.locator('#enchantPanel [role="status"]').textContent());throw e;});
  const state=await h.get(['cfg','rt']);assert.equal(state.cfg.enchantMode,false);assert.deepEqual(state.cfg.autoTasks,['enchant','fish']);assert.equal(state.rt.enchant.totals.attempts,0);assert.equal(state.rt.enchant.totals.scrolls,0);
  if(i)assert.ok(state.rt.enchantArchive.some(a=>a.runId===previous),'previous completed series archived');
  previous=state.rt.enchant.runId;
  await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="fish"'),20000);
  assert.deepEqual(traffic.filter(r=>r.method!=='GET'),[]);
  console.log('PASS '+(i?'explicit restart archives completed series':'explicit first start')+' → target already reached → selected fish fallback, zero attempts/POST');
 }
 await h.click('stop');await until(()=>h.g.core('!on && !running'));assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
