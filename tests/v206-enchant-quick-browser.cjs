'use strict';
// DOM панели из выгрузки16.10; обработчик сервера локальный, аккаунт не открывается.
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/workspace/work/browser/node_modules/playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><main id="ui"></main><aside hidden>'+fs.readFileSync(path.join(__dirname,'fixtures/enchant-tunic-panel.html'),'utf8')+'</aside>'}));
 await p.goto('https://fixture.test/enchant.html?target=bag%3A9002296%3A0%3Atunic');
 await p.addScriptTag({path:path.join(__dirname,'../modules/enchant.js')});await p.addScriptTag({path:path.join(__dirname,'../enchant-ui.js')});
 await p.evaluate(async()=>{
  window.posts=[];window.snap={name:'Hero',revision:7,adena:1000,inventory:{eq:{},stacks:[{itemId:9002296,enchant:0,clanArmorUid:'tunic',qty:1},{itemId:910518,qty:23}]}};
  const hints={itemSlotHints:{9002296:'chest'},itemGradeHints:{9002296:'S'}};
  window.E={on:true,tabOwner:true,cfg:{autoTasks:['enchant'],enchantMode:true,enchant:{maxConsecutiveFails:0,maxDropFromStart:25,maxDropFromPeak:25}},rt:{char:'Hero'},
   setRt:async v=>(Object.assign(E.rt,v),{ok:true}),gameGet:async url=>({ok:true,json:async()=>structuredClone(url==='/character'?{character:snap}:hints)}),
   waitX:async fn=>fn(),pause:async()=>{},fire:el=>el.click(),$q:s=>document.querySelector(s)};
  // Экспорт HTML не сохраняет DOM-свойства value. В игре их присваивает renderer.
  const pay=document.querySelector('input[name="pay"]');pay.value='scroll:910518';pay.checked=true;
  document.querySelector('#enchant-submit').onclick=()=>{
   const req={expectedRevision:snap.revision,targetInstanceId:new URLSearchParams(location.search).get('target'),payment:'scroll',count:+document.querySelector('#enchant-count').value,scrollItemId:910518};posts.push(req);
   snap.inventory.stacks[0].enchant=10;snap.inventory.stacks[1].qty-=req.count;snap.revision++;
   window.settlement=M.note(req,{previousEnchantLevel:0,currentEnchantLevel:10,attemptedCount:23,successCount:16,failCount:7,scrollConsumedCount:23,coinConsumed:false,updatedTargetInstanceId:'bag:9002296:10:tunic'},200);
  };
  window.M=L2V7Factories.enchant(E);
  window.UI=L2EnchantUI.mount(document.querySelector('#ui'),{getState:async()=>E,saveConfig:async c=>{E.cfg.enchant=structuredClone(c)},refreshItems:()=>M.readItems(),command:cmd=>M.command(cmd)});await UI.ready;
 });
 await p.locator('[data-command="refresh"]').click();await p.locator('[data-candidate]').selectOption('0');await p.locator('[data-add]').click();
 await p.locator('[data-item="targetLevel"]').fill('25');await p.locator('[data-item="targetLevel"]').dispatchEvent('change');
 await p.locator('[data-cfg="scrollPolicy"]').selectOption('ordinary');await p.locator('[data-global][data-field="maxAttempts"]').fill('23');await p.locator('[data-global][data-field="maxAttempts"]').dispatchEvent('change');await p.locator('[data-cfg="batchSize"]').selectOption('25');
 assert.equal(await p.locator('[data-global][data-field="maxScrolls"]').isVisible(),false);
 assert.equal(await p.evaluate(()=>E.cfg.enchant.enabled),false);assert.equal(await p.evaluate(()=>E.cfg.enchant.maxScrolls),23);
 await p.locator('[data-command="start"]').click();assert.equal(await p.evaluate(()=>E.cfg.enchant.enabled),true);
 await p.evaluate(async()=>{await M.step();await settlement;await UI.refresh()});
 const state=await p.evaluate(()=>({posts,series:E.rt.enchant}));assert.equal(state.posts.length,1);assert.equal(state.posts[0].count,23);assert.equal(state.series.totals.successes,16);assert.equal(state.series.totals.failures,7);assert.equal(state.series.items[0].targetInstanceId,'bag:9002296:10:tunic');assert.equal(state.series.pending,null);
 await p.locator('[data-detail="results"] summary').first().click();await p.locator('[data-detail="history"] summary').click();assert.match(await p.locator('[data-detail="history"]').innerText(),/16 успехов \/ 7 неудач/);
 assert.deepEqual(errors,[]);console.log('PASS simplified UI → exact clan UID → native count23 → mixed result16/7 → fresh inventory and history; 0 page errors');
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
