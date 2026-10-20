'use strict';
// Настоящий MV3 iframe → runtime relay → content; Firefox-граница tabs моделируется явно, HTTPS локальные.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
(async()=>{const h=await harness({withPopup:false});try{
 const {p,core}=h.g,initialUrl=p.url();let reads=0,mode='ok';
 const snapshot={id:'synthetic-bag-hero',name:'AuditHero',revision:1,l2Profession:'human_warlock',classSlots:{activeSlot:0},
  inventory:{eq:{belt:{itemId:920018,specialGearLevel:0}},stacks:[{itemId:1874,qty:11891},{itemId:1893,qty:0}]}};
 await h.ctx.route('https://l2wap.com/character',async r=>{
  assert.equal(r.request().method(),'GET');reads++;
  await r.fulfill({status:mode==='error'?500:200,contentType:'application/json',body:JSON.stringify(mode==='error'?{error:'synthetic_unavailable'}:{character:structuredClone(snapshot)})});
 });
 await p.evaluate(()=>localStorage.setItem('token','synthetic-local-only'));
 await h.sw.evaluate(async()=>{
  const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
  await chrome.storage.local.set({on:false,cfg:{...cfg,dock:true,dockMin:false,autoTasks:['mammon'],taskOnly:false,
   mmGoalItem:920018,mmGoalLvl:1,mmUpgrade:false,mmOrders:false,mmMailClaim:false,mmGoalFarm:false},
   rt:{...rt,_src:'synthetic-mammon-dock-fixture',classCur:{prof:'human_warlock',slot:0},mmJob:null,mmGoReq:null,actionPayments:{pending:null},
    mmCost:{'920018:0':{a:0,c:0,m:[[1893,'Oriharukon',13]],t:now}},mmGear:[{id:920018,n:'Synthetic Belt',g:'D',lvl:0,eq:true}],mmGearT:now,
    mmEq:{belt:[920018,0]},mmEqT:now,mmBagAnalysis:null}});
 });
 await p.setViewportSize({width:1897,height:953});
 await core("cfg.dock=true;cfg.dockMin=false;localStorage.setItem('l2bot-dockWide','1');dock();true");
 const frame=p.frameLocator('#l2bot-dock iframe');await until(()=>frame.locator('#start').isVisible());
 await frame.locator('body').evaluate(()=>{Object.defineProperty(chrome,'tabs',{configurable:true,value:undefined});showTab('mammon');revealEl(document.getElementById('mmBagAnalyze'));});
 await until(()=>frame.locator('#mmBagAnalyze').isVisible());
 const capabilities=await frame.locator('body').evaluate(()=>({docked:DOCKED,tabs:typeof chrome.tabs,runtime:typeof chrome.runtime.sendMessage}));
 assert.deepEqual(capabilities,{docked:true,tabs:'undefined',runtime:'function'});
 const button=frame.locator('#mmBagAnalyze'),analysis=async()=>(await h.get(['rt'])).rt.mmBagAnalysis;
 async function clickAndWait(){const before=reads,old=(await analysis())?.attemptAt||0;await button.click();await until(()=>reads>before);
  await until(async()=>((await analysis())?.attemptAt||0)>old);await until(()=>button.isEnabled());return analysis();}
 async function noActions(on=false){
  assert.equal((await h.get(['on'])).on,on);assert.equal(await core('on'),on);assert.equal(p.url(),initialUrl);
  const rt=(await h.get(['rt'])).rt;assert.equal(rt.mmJob,null);assert.equal(rt.mmGoReq,null);assert.equal(rt.actionPayments?.pending??null,null);
  assert.equal(h.requests.filter(x=>x.method!=='GET').length,0,'анализ не запускает POST/оплаты');
 }
 let before=reads;const first=await clickAndWait();assert.equal(reads,before+1);assert.equal(first.status,'ok');assert.equal(first.source,'manual');
 assert.deepEqual(first.goal,{id:920018,lvl:0,to:1});assert.equal(first.readyMaterials,false);
 assert.deepEqual(first.items.filter(x=>x.id===1893).map(x=>[x.need,x.have,x.missing]),[[13,0,13]]);
 assert.equal(first.raw.find(x=>x.id===1874).have,11891);await noActions();assert.equal(await core('running'),false,'кнопка анализа не запускает main');
 snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=13;
 before=reads;const fresh=await clickAndWait();assert.equal(reads,before+1,'кнопка перечитывает GET вместо прежнего кэша');
 assert.equal(fresh.status,'ok');assert.equal(fresh.readyMaterials,true);assert.ok(fresh.t>first.t);
 assert.deepEqual(fresh.items.filter(x=>x.id===1893).map(x=>[x.have,x.missing]),[[13,0]]);await noActions();
 mode='error';before=reads;const failed=await clickAndWait();assert.equal(reads,before+1);assert.equal(failed.status,'error');
 assert.equal(failed.t,fresh.t,'ошибка сохраняет время последнего успешного чтения');assert.deepEqual(failed.items,fresh.items);
 await until(()=>frame.locator('#mmBagStatus').textContent().then(s=>/Анализ не обновлён/.test(s)));
 assert.match(await frame.locator('#mmBagStatus').innerText(),/Последний успешный анализ/);assert.equal(await button.isEnabled(),true);await noActions();
 // ON под настоящей арендой; main удержан между шагами, проверяется именно ручная кнопка действующего владельца.
 mode='ok';snapshot.revision++;snapshot.inventory.stacks.find(x=>x.itemId===1893).qty=7;
 await core('running=true;loopT=Date.now();true');await h.sw.evaluate(()=>chrome.storage.local.set({on:true}));await until(()=>core('on'));
 assert.equal(await core('tabLock()'),true);before=reads;const owner=await clickAndWait();assert.equal(reads,before+1);
 assert.equal(owner.status,'ok');assert.equal(owner.items.find(x=>x.id===1893).have,7);assert.equal(owner.items.find(x=>x.id===1893).missing,6);await noActions(true);
 await h.sw.evaluate(()=>chrome.storage.local.set({on:false}));await until(()=>core('!on'));await core('running=false;true');await noActions();
 assert.deepEqual(h.errors,[]);
 const proof={at:new Date().toISOString(),boundary:'actual Chrome MV3 dock/runtime/content; Firefox iframe tabs absence modeled; HTTPS fully local',capabilities,
  offFreshRead:'PASS',refreshChangedBag:'PASS',errorKeepsSuccessTimestamp:'PASS',buttonRecovered:'PASS',onOwnerRead:'PASS',posts:0,navigation:false,unpromptedStartup:false,reads,errors:h.errors};
 if(process.env.MM_DOCK_PROOF)fs.writeFileSync(process.env.MM_DOCK_PROOF,JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));console.log('PASS actual dock without tabs: OFFfresh/changedbag/errorprevious/ONowner; no POST, navigation or unprompted startup');
 }finally{await h.ctx.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
