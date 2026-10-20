'use strict';
// Native fetch → hook.js → content NET_CONTEXT → real raid parser. Local server only; no teleport.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.env.L2_REPO||path.join(__dirname,'..'));
const {harness,until,delay}=require(path.join(root,'tests/v1014-core-lifecycle-browser.cjs'));
const rows=[['vip','VIP'],['empty',''],['zero','0'],['fa','0 FA'],['col','0 Coin of Luck'],['other','VIP']];
const id=name=>'l2dop_rb_'+name;
const body=()=>({page:1,bosses:rows.filter(([key])=>key!=='other').map(([key])=>({spawnId:id(key),bossType:'raid',adenaCost:0,vipFreeApplied:true})),adenaCost:0,vipFreeApplied:true});
const html=`<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"></div><div id="rb-pager-ind">1 / 1</div><div id="rb-list">${rows.map(([key,price])=>`<div class="l2-rb-row"><span class="l2-rb-row__label">${key}</span><span class="l2-rb-row__level">65</span><span class="l2-rb-row__status l2-rb-row__status--alive">Живой</span><span class="l2-rb-row__price">${price}</span><button class="l2-rb-row__tp" data-spawn-id="${id(key)}">Телепорт</button></div>`).join('')}</div><button id="read-price">Обновить</button><script>
 localStorage.setItem('token','fixture');window.priceReplies=0;window.priceReads=0;
 window.addEventListener('message',e=>{if(e.source===window&&e.data?.__l2bot==='net'&&String(e.data.url).includes('/game/raid-bosses'))window.priceReplies++;});
 document.getElementById('read-price').onclick=async()=>{await(await fetch('/game/raid-bosses?page=1')).json();window.priceReads++;};
 </script>`;
async function quoteCases(){const h=await harness(),requests=[];let response=body(),status=200,gate=null,release=null;try{
 await h.ctx.route('https://l2wap.com/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;requests.push({path:p,method:req.method()});
  if(p==='/rb-bosses.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  if(p==='/game/raid-bosses'){const data=structuredClone(response),code=status,wait=gate;if(wait)await wait;return route.fulfill({status:code,json:data}).catch(()=>{});}
  return route.fallback();
 });
 await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,autoTasks:[],dailyKillLimit:0,dailyFishLimit:0,limitRanges:{}},rt:{...rt,classCur:{prof:'human_warlock',slot:0},dailyStart:2,manualKickAt:0,rbListStartRequired:'quote-run-1'}});});
 await h.g.p.goto('https://l2wap.com/rb-bosses.html?page=1');await until(()=>h.g.core('!!L2V7Modules.raid && !on && rt.rbListStartRequired==="quote-run-1"'));
 const parsed=()=>h.g.core('L2V7Modules.raid.rbRowsParse()');
 const free=row=>row.price===0&&row.unit==='аден';
 async function rejected(){const p=await parsed();for(const key of ['vip','empty','zero','other'])assert.equal(free(p[id(key)]),false,key+' has no matching native proof');}
 async function read(){const n=await h.g.p.evaluate(()=>window.priceReplies);await h.g.p.locator('#read-price').click();await until(()=>h.g.p.evaluate(n=>window.priceReplies>n,n));await until(()=>h.g.core('NET_CONTEXT.size===0'));await delay(50);}
 async function patch(change){await h.sw.evaluate(async change=>{const {rt}=await chrome.storage.local.get('rt');await chrome.storage.local.set({rt:{...rt,...change,_src:'quote-browser-external'}});},change);await until(()=>h.g.core(Object.entries(change).map(([key,value])=>'JSON.stringify(rt['+JSON.stringify(key)+'])==='+JSON.stringify(JSON.stringify(value))).join(' && ')));}
 await rejected();await read();let p=await parsed();
 for(const key of ['vip','empty','zero']){assert.equal(free(p[id(key)]),true,key+' gets adena0 from native GET');assert.match(p[id(key)].priceText,/сервер VIP/);}
 assert.equal(free(p[id('other')]),false,'unlisted ID is not authorised');assert.equal(p[id('fa')].unit,'FA');assert.equal(p[id('col')].unit,'Coin of Luck');
 console.log('PASS actual MV3 native quote: VIP/empty/0 → adena0; explicit FA/CoL and other ID stay blocked');
 response={...body(),bosses:[{spawnId:'different-id',bossType:'raid',adenaCost:0,vipFreeApplied:true}]};await read();await rejected();
 response={...body(),page:2};await read();await rejected();
 response={...body(),bosses:body().bosses.map(({spawnId,bossType})=>({spawnId,bossType}))};await read();await rejected();
 response=body();status=503;await read();await rejected();status=200;
 console.log('PASS actual MV3 native quote: wrong ID/page, missing per-boss proof and 503 do not authorise');
 for(const [name,change] of [['start',{rbListStartRequired:'quote-run-2'}],['class',{classCur:{prof:'human_warlock',slot:1}}]]){
  await read();assert.equal(free((await parsed())[id('vip')]),true,'fresh proof before '+name+' change');
  const before=requests.length,n=await h.g.p.evaluate(()=>window.priceReplies);gate=new Promise(r=>release=r);
  await h.g.p.locator('#read-price').click();await until(()=>requests.slice(before).some(r=>r.path==='/game/raid-bosses'));
  await until(()=>h.g.core('NET_CONTEXT.size>0'));await patch(change);release();gate=null;
  await until(()=>h.g.p.evaluate(n=>window.priceReplies>n,n));await until(()=>h.g.core('NET_CONTEXT.size===0'));await delay(50);await rejected();
  console.log('PASS actual MV3 native quote: delayed response after '+name+' change rejected');
 }
 await read();assert.equal(free((await parsed())[id('vip')]),true,'new request in current context recovers without reload');
 assert.equal((await h.get('on')).on,false);assert.equal(requests.some(r=>r.method==='POST'),false);assert.deepEqual(h.errors,[]);
 console.log('PASS actual MV3 native quote integration: recovery while OFF, 0 POST, 0 pageerrors; bot functions unchanged');
}catch(error){console.error('DIAG',JSON.stringify({requests,parsed:await h.g.core('L2V7Modules.raid.rbRowsParse()').catch(String),state:await h.g.core('({on,leaseEpoch,char:rt.char,classCur:rt.classCur,status:rt.status,start:rt.rbListStartRequired,net:[...NET_CONTEXT.values()]})').catch(String),errors:h.errors}));throw error;}
finally{release?.();await h.ctx.close();}}
async function activeQuoteCase(){
 // A new browser/profile avoids retaining the preceding intentional Start/class mutations.
 const h=await harness(),requests=[];let held=false,holding=true,release,context;
 const gate=new Promise(r=>release=r),nativeHtml=html.replace('</script>',`const list=document.getElementById('rb-list');for(const row of list.children){if(!${JSON.stringify(['vip','empty','zero'].map(id))}.includes(row.querySelector('button').dataset.spawnId)){const status=row.querySelector('.l2-rb-row__status');status.className='l2-rb-row__status';status.textContent='Убит';}}const markup=list.innerHTML;list.innerHTML='';(async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await(await fetch('/game/raid-bosses?page=1')).json();list.innerHTML=markup;})();</script>`);
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;requests.push({path:p,method:req.method()});
   if(p==='/character')return route.fulfill({json:{character:{name:'AuditHero',revision:10,level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},adena:30000000,hp:10000,maxHp:10000,mp:1000,maxMp:1000,inBattle:false,locationType:'map',inventory:{eq:{},stacks:[]}}}});
   if(p==='/rb-bosses.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:nativeHtml});
   if(p==='/game/raid-bosses'){if(holding){held=true;await gate;}return route.fulfill({json:body()}).catch(()=>{});}
   return route.fallback();
  });
  await h.sw.evaluate(async()=>{const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:false,cfg:{...cfg,taskOnly:false,autoTasks:['raid'],dailyKillLimit:0,dailyFishLimit:0,limitRanges:{},rbFaFull:false,rbValueTour:true,faBuffs:'',townBuffSet:'off',petFullAuto:false,petAuto:false,petBuffAuto:false},rt:{...rt,char:'AuditHero',lvl:75,classCur:{prof:'human_warlock',slot:0},dailyStart:0,manualKickAt:0,rbListStartSeq:0,rbListStartRequired:'old',rbListReadStart:null,rbListVerifiedAt:0,rbHunt:{step:'pick'},rbList:{},rbListT:0,rbGo:null,rbFishWait:null,rbScan:null,actionPayments:null}});});
  await h.g.p.reload();await until(()=>h.g.core('!!L2V7Modules.raid && !on'));
  await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));await h.click('start');
  await until(()=>held,20000);await until(()=>h.g.core('on && running && tabOwner && !!leaseEpoch'));
  context=await h.g.core('({lease:leaseEpoch,char:rt.char,classCur:rt.classCur,start:rt.rbListStartRequired,requests:[...NET_CONTEXT.values()]})');console.log('ACTIVE_REQUEST_CONTEXT',JSON.stringify(context));holding=false;release();
  const checked=await until(async()=>{const r=(await h.get('rt')).rt;return r.rbListReadStart===r.rbListStartRequired&&r.rbListVerifiedAt>0&&r;},25000);
  await h.click('stop');await until(async()=>!(await h.get('on')).on);
  for(const key of ['vip','empty','zero']){assert.equal(checked.rbList[id(key)].price,0,key+' verified price');assert.equal(checked.rbList[id(key)].unit,'аден','native initial GET or bounded read after ownership confirms '+key);}
  assert.equal(checked.rbList[id('other')].unit,'');assert.equal(checked.rbList[id('fa')].unit,'FA');assert.equal(checked.rbList[id('col')].unit,'Coin of Luck');
  assert.equal(requests.some(r=>r.method==='POST'),false);assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 active raid scan native quote: fresh context, initial GET → rows → ownership → verified list, 0 POST');
 }catch(error){console.error('ACTIVE_DIAG',JSON.stringify({requests,context,state:await h.get(['on','rt']).catch(String),errors:h.errors}));throw error;}
 finally{release();await h.ctx.close();}
}
(async()=>{if(!process.env.L2_QUOTE_ACTIVE_ONLY)await quoteCases();await activeQuoteCase();})().catch(error=>{console.error(error.stack);process.exitCode=1});
