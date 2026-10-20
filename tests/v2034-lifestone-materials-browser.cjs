'use strict';
// Настоящий MV3/dock/runtime. Отсутствие tabs моделирует Firefox; все HTTPS ответы локальные.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs');
const supplyServer=require('./tools/lifestone-supply-server-fixture.cjs');
const proof=[];
const CASES=['happy','two-attempts','ready-stock','partial-stock','gem-only','limited-AA','unknown','unknown-confirmed','applied-409','install-applied-409','stop-held-quote','zero-budget','adena-budget','reserve','disabled','already-goal','one-limit'];
async function scenario(kind){
 const options={},wantMax=kind==='one-limit'?1:10;
 if(kind==='two-attempts')options.outcomes=['tempest','matk_6'];if(kind==='one-limit')options.outcomes=['tempest'];
 if(kind==='ready-stock')Object.assign(options,{ls:10,gem:10});if(kind==='partial-stock')Object.assign(options,{ls:1,gem:1});if(kind==='gem-only')options.ls=10;
 if(kind==='limited-AA')Object.assign(options,{aa:500000,ls:1});if(kind.startsWith('unknown'))options.near=true;if(kind==='reserve')options.adena=250000;if(kind==='already-goal')options.existingGoal=true;if(kind==='applied-409')options.near=true;if(kind==='install-applied-409')Object.assign(options,{ls:10,gem:10});
 const server=supplyServer(options),h=await harness({withPopup:false}),calls=[],routeErrors=[];let lost=false,held=false,release,wire409=false,proof409=false;const gate=new Promise(r=>release=r);
 const hints=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../kb/raw/catalog-hints.json'),'utf8')).data;
 let frame;
 const short=s=>s?{status:s.status,attempts:s.attempts,maxAttempts:s.maxAttempts,last:s.last,reason:s.reason,spentAA:s.spentAA,spentAdena:s.spentAdena,reservedAA:s.reservedAA,reservedAdena:s.reservedAdena,pending:s.pending?{kind:s.pending.kind,action:s.pending.action,material:s.pending.material,qty:s.pending.qty,currency:s.pending.currency,amount:s.pending.amount,revision:s.pending.revision}:null,supplies:(s.supplies||[]).map(x=>({action:x.action,itemId:x.itemId,qty:x.qty,currency:x.currency,amount:x.amount,status:x.status}))}:null;
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{try{
   const q=r.request(),path=new URL(q.url()).pathname,body=q.method()==='POST'?q.postDataJSON():undefined,call={path,method:q.method(),...(body?{body}:{})};calls.push(call);
   if(path==='/character/catalog-hints')return r.fulfill({json:hints});
   if(path==='/character'&&wire409&&!proof409){const s=(await h.get(['rt'])).rt.autoLs;call.beforeProofGet=short(s);assert.ok(s.pending,'409 не снимает pending до свежего GET');if(kind==='applied-409'){assert.equal(s.reservedAA,1600000);assert.equal(s.spentAA,0);}proof409=true;}
   if(kind==='stop-held-quote'&&path==='/game/mammon/merchant/shop'){held=true;await gate;}
   if(q.method()==='POST'){
    const state=await h.get(['rt','cfg']),s=state.rt.autoLs,p=s?.pending;call.before=short(s);assert.ok(p,'мутация требует долговечно записанного pending');assert.equal(body.expectedRevision,p.revision);assert.equal(s.attempts,server.counts.augmentation,'покупки не увеличивают попытки');
    assert.equal(s.maxAttempts,state.cfg.autoLs.maxAttempts);assert.equal(JSON.parse(s.configSig)[1],s.maxAttempts);
    if(path==='/character/weapon-augmentation'){assert.notEqual(p.kind,'supply');assert.ok(server.qty(10412)>=1&&server.qty(2134)>=1);assert.equal(p.ls,server.qty(10412));assert.equal(p.gem,server.qty(2134));}
    else{
     assert.equal(p.kind,'supply');assert.equal(p.path,path);assert.deepEqual(p.body,body);assert.equal(body.qty??0,p.qty);assert.ok(p.currency==='aa'?s.reservedAA>=p.amount:s.reservedAdena>=p.amount);
     if(path!=='/game/mammon/teleport'){const id=path==='/game/mammon/merchant/buy'?10412:2134;assert.ok(body.qty>0&&body.qty<=9999);assert.equal(body.qty,Math.min(9999,s.maxAttempts-s.attempts-server.qty(id)),'batch только до оставшегося числа попыток');assert.equal(p.amount,body.qty*(id===10412?160000:100000));}
    }
    if(kind.startsWith('unknown')&&path==='/game/mammon/merchant/buy'&&!lost){lost=true;if(kind==='unknown-confirmed'){const out=server.handle(path,q.method(),body);assert.equal(out.status,200);call.lostAfterServer=true;}else call.lostBeforeServer=true;return r.abort('failed');}
   }
   if(q.method()==='POST'&&!wire409&&(kind==='applied-409'&&path==='/game/mammon/merchant/buy'||kind==='install-applied-409'&&path==='/character/weapon-augmentation')){
    const first=server.handle(path,q.method(),body),retry=server.handle(path,q.method(),body);assert.equal(first.status,200);assert.equal(retry.status,409);wire409=true;call.browserReplayModel={firstApplied:200,sameExpectedRevision:body.expectedRevision,retryStatus:409};return r.fulfill({status:409,json:retry.json});
   }
   const out=server.handle(path,q.method(),body);if(out)return r.fulfill({status:out.status,json:out.json});
   assert.equal(q.method(),'GET','непредусмотренная мутация запрещена');return r.fallback();
  }catch(e){routeErrors.push(e.message);return r.fulfill({status:500,json:{error:'fixture_assertion'}}).catch(()=>{})}});
  await h.sw.evaluate(async({kind,wantMax})=>{const {cfg}=await chrome.storage.local.get('cfg');await chrome.storage.local.set({cfg:{...cfg,dock:true,dockMin:false,shopReserve:200000,mmTpMax:500000,autoLs:{targets:[],maxAttempts:wantMax,buyMaterials:kind!=='disabled',aaBudget:kind==='zero-budget'?0:2000000,adenaBudget:kind==='adena-budget'?500000:2000000,aaReserve:0}}})},{kind,wantMax});
  async function openDock(){
   await h.g.p.setViewportSize({width:1897,height:953});await h.g.core("cfg.dock=true;cfg.dockMin=false;localStorage.setItem('l2bot-dockWide','1');dock();true");
   frame=h.g.p.frameLocator('#l2bot-dock iframe');await until(()=>frame.locator('#start').isVisible());await frame.locator('body').evaluate(()=>{Object.defineProperty(chrome,'tabs',{configurable:true,value:undefined});showTab('lifestone');});await delay(450);
  }
  async function assertDone(expected,expectedMax=wantMax,last=kind==='one-limit'?'tempest':'matk_6'){
   await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.status==='done'&&s.last===last},30000);const state=await h.get(['rt','cfg']),s=state.rt.autoLs;
   assert.equal(s.attempts,expected.augmentation);assert.equal(s.maxAttempts,expectedMax);assert.equal(state.cfg.autoLs.maxAttempts,expectedMax);assert.equal(JSON.parse(s.configSig)[1],expectedMax);assert.equal(s.pending,null);assert.equal(s.reservedAA,0);assert.equal(s.reservedAdena,0);
   assert.deepEqual(server.counts,expected);assert.equal(s.spentAA,expected.ls*160000);assert.equal(s.spentAdena,expected.gem*100000);
   assert.equal(server.qty(10412),(options.ls||0)+expected.ls-expected.augmentation);assert.equal(server.qty(2134),(options.gem||0)+expected.gem-expected.augmentation);assert.equal(server.qty(4037),7);assert.equal(server.qty(920048),11);assert.equal(server.character.fastAden,11);assert.ok(server.character.adena>=200000);assert.equal(h.g.p.url(),'https://l2wap.com/augmentation.html');
   await delay(1800);assert.deepEqual(server.counts,expected,'после цели/лимита нет новой закупки');const label=(await frame.locator('#lsRun').textContent()).replace(/\s/g,'');assert.ok(label.includes('Надокупку:'+s.spentAA+'AA·'+s.spentAdena+'аден'),'UI показывает расходы');assert.equal(await frame.locator('#lsMaxAttempts').inputValue(),String(expectedMax));
  }
  await h.g.p.goto('https://l2wap.com/augmentation.html');await until(()=>h.g.core('typeof L2V7Modules.lifestone==="object"'));await openDock();
  await frame.locator('#lsScanWeapons').click();await until(()=>frame.locator('#lsWeapon option').count().then(n=>n===2));
  await frame.locator('#lsWeapon').selectOption({index:1});await frame.locator('#lsWeapon').blur();await until(async()=>!!(await h.get(['cfg'])).cfg.autoLs?.weaponKey);
  await frame.locator('#lsTargets').selectOption('matk_6');await frame.locator('#lsTargets').blur();await frame.locator('#lsMaxAttempts').fill(String(wantMax));await frame.locator('#lsMaxAttempts').blur();
  await until(async()=>{const c=(await h.get(['cfg'])).cfg.autoLs;return c?.targets?.[0]==='matk_6'&&c.maxAttempts===wantMax;});assert.equal(calls.filter(x=>x.method==='POST').length,0,'выбор не запускает закупку');
  if(kind!=='baseline'){assert.equal(await frame.locator('#lsBuyMaterials').isChecked(),kind!=='disabled');assert.equal(await frame.locator('#lsAaBudget').inputValue(),kind==='zero-budget'?'0':'2000000');}
  await frame.locator('#lsStart').click();await until(()=>frame.locator('body').evaluate(()=>!lsActionBusy),15000);
  if(kind==='baseline'){
   await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='done',20000);const s=(await h.get(['rt'])).rt.autoLs;assert.equal(s.attempts,0);assert.match(s.reason,/Закончились/);assert.equal(calls.filter(x=>x.method==='POST').length,0);proof.push({kind,version:await h.sw.evaluate(()=>chrome.runtime.getManifest().version),series:short(s),posts:0});console.log('PASS baseline20.34: stock0/0 → done0/10, no purchase');return;
  }
  if(['applied-409','install-applied-409'].includes(kind)&&process.env.LS_MATERIAL_EXPECT_409_BUG){
   await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='paused',15000);const s=(await h.get(['rt'])).rt.autoLs;assert.equal(s.pending,null);assert.equal(s.attempts,0);assert.equal(s.spentAA,0);assert.equal(s.reservedAA,0);assert.equal(server.counts[kind==='applied-409'?'ls':'augmentation'],kind==='applied-409'?10:1);proof.push({kind:'baseline-'+kind,version:await h.sw.evaluate(()=>chrome.runtime.getManifest().version),series:short(s),counts:server.counts,calls});console.log('PASS baseline409 bug: applied transaction is incorrectly cleared as rejected');return;
  }
  if(kind==='stop-held-quote'){
   await until(()=>held,15000);await frame.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);release();await delay(800);assert.equal(calls.filter(x=>x.method==='POST').length,0);assert.equal((await h.get(['rt'])).rt.autoLs.attempts,0);
   await frame.locator('#start').click();await until(()=>h.g.core('on && tabOwner'));await delay(1200);assert.equal(calls.filter(x=>x.method==='POST').length,0,'новый Start не выдаёт permit');
  }else if(kind.startsWith('unknown')||kind==='applied-409'){
   await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.pending?.kind==='supply'&&s.status==='paused'},15000);
   let s=(await h.get(['rt'])).rt.autoLs;assert.equal(s.attempts,0);assert.equal(s.pending.material,'ls');assert.equal(s.pending.qty,10);assert.equal(s.reservedAA,1600000);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal(await frame.locator('#lsAcknowledge').isHidden(),true);
   await frame.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await h.g.p.reload();await until(()=>h.g.core('typeof L2V7Modules.lifestone==="object"'));await openDock();
   if(kind==='unknown'){
    await frame.locator('#start').click();await until(()=>h.g.core('on && tabOwner'));await delay(1000);await frame.locator('#lsReconcile').click();await until(()=>frame.locator('body').evaluate(()=>!lsActionBusy));await delay(600);s=(await h.get(['rt'])).rt.autoLs;
    assert.equal(s.pending.kind,'supply');assert.equal(s.attempts,0);assert.equal(s.reservedAA,1600000);assert.equal(calls.filter(x=>x.method==='POST').length,1,'Stop/reload/Start/reconcile не повторяют неизвестный batch');assert.equal(await frame.locator('#lsAcknowledge').isHidden(),true);
   }else{
    await frame.locator('#lsReconcile').click();await until(async()=>!(await h.get(['rt'])).rt.autoLs.pending);s=(await h.get(['rt'])).rt.autoLs;assert.equal(s.status,'paused');assert.equal(s.attempts,0);assert.equal(s.reservedAA,0);assert.equal(s.spentAA,1600000);assert.equal(server.qty(10412),10);assert.equal(calls.filter(x=>x.method==='POST').length,1);
    await frame.locator('#lsResume').click();await assertDone({travel:0,ls:10,gem:10,augmentation:1});assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/game/mammon/merchant/buy').length,1,'подтверждённый потерянный batch не покупается второй раз');
   }
  }else if(kind==='install-applied-409'){
   await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.pending&&s.status==='paused'},15000);let s=(await h.get(['rt'])).rt.autoLs;assert.notEqual(s.pending.kind,'supply');assert.equal(s.attempts,0);assert.equal(server.counts.augmentation,1);assert.equal(calls.filter(x=>x.method==='POST').length,1);
   await frame.locator('#stop').click();await until(async()=>!(await h.get(['on'])).on);await h.g.p.reload();await until(()=>h.g.core('typeof L2V7Modules.lifestone==="object"'));await openDock();await frame.locator('#lsReconcile').click();await until(async()=>!(await h.get(['rt'])).rt.autoLs.pending);await assertDone({travel:0,ls:0,gem:0,augmentation:1});assert.equal(proof409,true);assert.equal(calls.filter(x=>x.method==='POST').length,1,'applied install409 не повторяется при сверке');
  }else if(['zero-budget','adena-budget','reserve'].includes(kind)){
   await until(async()=>{const s=(await h.get(['rt'])).rt.autoLs;return s?.status==='paused'&&(/AA|лимит|резерв/i.test(s.reason||''));},15000);const state=await h.get(['rt','cfg']),s=state.rt.autoLs;assert.equal(s.attempts,0);assert.equal(s.pending,null);assert.equal(s.reservedAA,0);assert.equal(s.reservedAdena,0);assert.equal(s.maxAttempts,wantMax);assert.equal(state.cfg.autoLs.maxAttempts,wantMax);assert.match(s.reason,kind==='reserve'?/резерв/i:kind==='adena-budget'?/лимит/i:/AA/);assert.equal((await h.get(['on'])).on,true);assert.equal(calls.filter(x=>x.method==='POST').length,0,'полная цена проверяется до TP/первой покупки');
  }else if(['disabled','already-goal'].includes(kind)){
   await until(async()=>(await h.get(['rt'])).rt.autoLs?.status==='done',15000);const s=(await h.get(['rt'])).rt.autoLs;assert.equal(s.attempts,0);assert.equal(calls.filter(x=>x.method==='POST').length,0);assert.equal(calls.some(x=>['/game/mammon/merchant/shop','/game/drops-shop','/game/mammon/merchant'].includes(x.path)),false,'ранняя цель/OFF не читают магазины');if(kind==='disabled')assert.match(s.reason,/автодокупка выключена/);
  }else{
   const expected=kind==='ready-stock'?{travel:0,ls:0,gem:0,augmentation:1}:kind==='partial-stock'?{travel:1,ls:9,gem:9,augmentation:1}:kind==='gem-only'?{travel:0,ls:0,gem:10,augmentation:1}:kind==='limited-AA'?{travel:1,ls:3,gem:4,augmentation:1}:kind==='one-limit'?{travel:1,ls:1,gem:1,augmentation:1}:{travel:1,ls:10,gem:10,augmentation:kind==='two-attempts'?2:1};
   await assertDone(expected,kind==='limited-AA'?4:wantMax);
   if(['happy','limited-AA'].includes(kind))assert.deepEqual(calls.filter(x=>x.method==='POST').map(x=>x.path),['/game/mammon/teleport','/game/mammon/merchant/buy','/game/drops-shop/buy','/character/weapon-augmentation']);
   if(kind==='gem-only'){assert.equal(calls.some(x=>x.path==='/game/mammon/merchant/shop'),false);assert.equal(calls.some(x=>x.path==='/game/mammon/teleport'),false);}
   if(kind==='happy'){const first=calls.findIndex(x=>x.method==='POST');for(const path of ['/game/mammon/merchant/shop','/game/mammon/merchant','/game/drops-shop'])assert.ok(calls.slice(0,first).some(x=>x.path===path),'свежая цена до мутации: '+path);}
  }
  const state=await h.get(['rt','cfg']),s=state.rt.autoLs;if(kind==='applied-409')assert.equal(proof409,true);assert.deepEqual(routeErrors,[]);assert.deepEqual(h.errors,[]);proof.push({kind,version:await h.sw.evaluate(()=>chrome.runtime.getManifest().version),boundary:'Actual Chrome MV3 dock; Firefox tabs-unavailable capability explicitly modeled; every HTTPS response local',counts:server.counts,series:short(s),cfgMaxAttempts:state.cfg.autoLs.maxAttempts,balances:{aa:server.qty(5575),adena:server.character.adena,col:server.qty(4037),fastAden:server.qty(920048),ls:server.qty(10412),gem:server.qty(2134)},calls,errors:[...h.errors,...routeErrors]});console.log('PASS actual dock batch materials '+kind+' '+JSON.stringify({counts:server.counts,series:short(s)}));
 }catch(e){console.error('DIAG',JSON.stringify({kind,calls,routeErrors,counts:server.counts,series:short((await h.get(['rt'])).rt.autoLs),core:await h.g.core('({on,tabOwner,free:lifestonePrepareFree(),status:rt.status})').catch(String)}));throw e;}
 finally{release();await h.ctx.close();}
}
(async()=>{for(const kind of process.env.LS_MATERIAL_CASE?process.env.LS_MATERIAL_CASE.split(','):CASES)await scenario(kind);if(process.env.LS_MATERIAL_PROOF)fs.writeFileSync(process.env.LS_MATERIAL_PROOF,JSON.stringify({at:new Date().toISOString(),proof},null,2)+'\n')})().catch(e=>{console.error(e.stack);process.exitCode=1});
