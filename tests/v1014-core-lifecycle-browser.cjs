'use strict';
// 14.10: настоящее расширение, все HTTPS ответы локальные; аккаунт игры не используется.
// Headless не переключает document.visibilityState: только этот сигнал явно моделируем.
const {chromium}=require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright'), fs=require('node:fs'), assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..'), content=fs.readFileSync(root+'/content.js','utf8');
const flags=Object.fromEntries([...content.matchAll(/once\('([^']+)'/g)].map(x=>[x[1],1]));
const fixture=`<!doctype html><html><head><title>Fixture L2</title></head><body><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Warlock</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button><div id="map-mob-list"></div><button id="probe">Probe</button><script>document.getElementById('probe').onclick=()=>document.body.dataset.actions=String(+(document.body.dataset.actions||0)+1)</script></body></html>`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=15000){const end=Date.now()+ms;let last,error;do{try{last=await fn();if(last)return last}catch(e){error=e}await delay(100)}while(Date.now()<end);throw Error('timeout '+String(last)+(error?' · '+error.message:''));}
async function harness({cleanInstall=false}={}){
 const ctx=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.CHROMIUM || '/opt/pw-browsers/chromium',args:['--no-sandbox',`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 try {
 const errors=[],requests=[]; await ctx.route('https://**/*',r=>{const pathname=new URL(r.request().url()).pathname;requests.push({path:pathname,method:r.request().method()});return r.fulfill({status:200,contentType:/\.html$/.test(pathname)?'text/html':'application/json',body:/\.html$/.test(pathname)?fixture:'{}'});});
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(sw.url()).host;
 // Новая установка сначала завершает запись базового профиля; иначе onInstalled затирает синтетические данные теста.
 await until(()=>sw.evaluate(async()=>{const s=await chrome.storage.local.get(['cfg','rt']);return !!s.cfg&&!!s.rt;}));await delay(200);
 if(!cleanInstall)await sw.evaluate(({flags})=>chrome.storage.local.set({on:false,cfg:{...flags,dock:false,taskOnly:true,weaponScanAuto:false,tvtOn:false,enemyHunt:false,rbTimers:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmGoalFarm:false,mmCraftSend:false,mmFarmGuide:false,storyTurnIn:false,campAuto:false,campaign:false,shopAuto:false,autoMagister:false,rec:false,autoSnap:false},rt:{...flags,char:'AuditHero',lvl:75,prof:'Human Warlock',weaponsT:Date.now(),engineRecoveryEpoch:'7.1.13'}}),{flags});
 const get=keys=>sw.evaluate(keys=>chrome.storage.local.get(keys),keys);
 async function game(){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));const cdp=await ctx.newCDPSession(p),worlds=new Map();cdp.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));cdp.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());await cdp.send('Runtime.enable');
  async function core(expression){const worldsNow=[...worlds.values()].reverse().filter(w=>w.origin==='chrome-extension://'+id);for(const w of worldsNow){const r=await cdp.send('Runtime.evaluate',{contextId:w.id,expression:'typeof L2V7Modules',returnByValue:true}).catch(()=>null);if(r?.result?.value!=='object')continue;const result=await cdp.send('Runtime.evaluate',{contextId:w.id,expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}throw Error('no content world');}
  await p.goto('https://l2wap.com/map.html');await until(()=>core('typeof on !== "undefined" && !document.prerendering'),30000);return {p,core};}
 const g=await game(), popup=await ctx.newPage();popup.on('pageerror',e=>errors.push(e.message));await popup.goto('chrome-extension://'+id+'/popup.html');await until(()=>popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
 // Старые сценарии «выбрать один режим» воспроизводим видимыми галками и отдельным Стартом.
 async function openTab(tab){const b=popup.locator('nav [data-tab="'+tab+'"]');if(!await b.isVisible())await popup.locator('#navToggle').click();await b.click();}
 async function click(key){
  const tasks={tasksToggle:null,farmToggle:'farm',autoFarmToggle:'auto',huntToggle:'raid',epicToggle:'epic',fishToggle:'fish',catToggle:'cat',enchantToggle:'enchant',campToggle:'quests'};
  if(Object.hasOwn(tasks,key)){
   if(!await popup.locator('#autoTaskSelection').isVisible())await popup.locator('#modeToggle').click();
   const desired=tasks[key];
   for(const task of ['enchant','epic','raid','quests','fish','cat','auto','farm']){
    const el=popup.locator('[data-auto-task="'+task+'"]');if(task!==desired&&await el.isChecked()){await el.uncheck();await until(async()=>!(await get(['cfg'])).cfg.autoTasks?.includes(task));}
   }
   if(!Array.isArray((await get(['cfg'])).cfg.autoTasks)){const el=popup.locator('[data-auto-task="'+(desired||'farm')+'"]');await el.setChecked(!await el.isChecked());await until(async()=>Array.isArray((await get(['cfg'])).cfg.autoTasks));if(!desired){await el.uncheck();await until(async()=>!(await get(['cfg'])).cfg.autoTasks.includes('farm'));}}
   if(desired){const el=popup.locator('[data-auto-task="'+desired+'"]');if(!await el.isChecked()){await el.check();await until(async()=>(await get(['cfg'])).cfg.autoTasks?.includes(desired));}await popup.locator('#start').click();}
   return;
  }
  const b=popup.locator('#'+key);if(!await b.isVisible()){const section=await b.evaluate(e=>e.closest('section[id^="tab-"]')?.id.slice(4));if(section)await openTab(section);}
  await b.click();
 }
 return {ctx,sw,get,id,game,g,popup,errors,requests,click,openTab};
 } catch (e) { await ctx.close(); throw e; } // При ошибке старта браузер тоже закрывается, тест не висит до внешних 300 с.
}
module.exports={harness,until,delay};
if(require.main===module)(async()=>{const h=await harness();try{
 console.log('CASE start');await h.click('start');await until(()=>h.g.core('on && running && tabOwner && autonomyMode()==="tasks"'));const initial=await h.get(['lock']);assert.ok(initial.lock.epoch);console.log('PASS actual popup Start → background lock → content tasksIdle');
 console.log('CASE pause');await h.click('pause');await until(()=>h.g.core('!on && !running'));assert.ok((await h.get(['paused'])).paused);await h.click('pause');await until(()=>h.g.core('on && running && tabOwner'));console.log('PASS actual Pause → loop exits → resume retains tasks mode');
 console.log('CASE reload');const before=(await h.get(['lock'])).lock.epoch;await h.g.p.reload();await until(()=>h.g.core('on && running && tabOwner'));const after=(await h.get(['lock'])).lock.epoch;assert.notEqual(after,before);console.log('PASS document reload resumes and rotates epoch');
 console.log('CASE two tabs');const firstEpoch=after;const other=await h.game();await other.p.bringToFront();await until(()=>other.core('on && running'));assert.equal(await other.core('tabOwner'),false);assert.equal(await other.core('fire(document.getElementById("probe"))'),false);console.log('PASS second visible tab waits; only one owner');await h.g.core("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); true");await until(()=>other.core('on && running && tabOwner'),20000);await until(()=>h.g.core('!tabOwner'));assert.equal(await h.g.core('fire(document.getElementById("probe"))'),false);assert.equal(await h.g.p.getAttribute('body','data-actions'),null);
 const stale=await h.g.core('ipc({cmd:"statePatch",patch:{auditStale:true},epoch:'+JSON.stringify(firstEpoch)+'})');assert.equal(stale.ok,false);assert.equal((await h.get(['rt'])).rt.auditStale,undefined);console.log('PASS browser visibility seam hidden→visible preemption → old clicks and stale patch blocked');
 console.log('CASE stop all');await h.click('stop');await until(async()=>await h.g.core('!on && !running')&&await other.core('!on && !running'));await until(async()=>!(await h.get(['lock'])).lock,10000);assert.equal((await h.get(['on'])).on,false);console.log('PASS Stop reaches both documents and releases lease');
 assert.deepEqual(h.errors,[]);console.log('REQUESTS',JSON.stringify(h.requests));
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});
