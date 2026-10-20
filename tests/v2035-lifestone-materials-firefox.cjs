'use strict';
// Настоящий Firefox: все игровые адреса направлены в локальный TLS fixture, без аккаунта и секретов.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
// FIREFOX=… GECKODRIVER=… NODE_PATH=… L2_ZIP=… L2_NATIVE_OUT=… node native-materials.cjs (из корня проекта).
const {Builder,By,until}=require('selenium-webdriver'),firefox=require('selenium-webdriver/firefox');
const base=path.resolve(process.env.L2_NATIVE_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'l2-native-materials-'))),source=path.resolve(process.env.L2_SOURCE||process.cwd()),zip=process.env.L2_ZIP;
fs.mkdirSync(base,{recursive:true});
if(!zip)throw Error('L2_ZIP is required; only an explicitly supplied final offline package is tested');
const version=JSON.parse(execFileSync('unzip',['-p',zip,'manifest.json'],{encoding:'utf8'})).version;
const flags=Object.fromEntries([...fs.readFileSync(source+'/content.js','utf8').matchAll(/once\('([^']+)'/g)].map(x=>[x[1],1]));
const catalog=JSON.parse(fs.readFileSync(path.join(source,'kb/raw/catalog-hints.json'),'utf8')).data;
const fixture='<!doctype html><meta charset="utf-8"><title>Local L2 fixture</title><body><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Arcana Lord</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><div id="map-mob-list"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>';
const merchant={mammonMerchant:{current:{id:'offline-merchant',worldX:20000,worldY:25000}},teleport:{adenaCost:0}};
const lsShop={categories:[{categoryId:'life_stones',items:[{categoryId:'life_stones',itemKey:'s',itemId:10412,aaPrice:160000,priceCoinOfLuck:0,priceFastAden:0}]}]};
const gemShop={grades:[{grade:'S',sections:[{category:'consumable',items:[{shopKey:'consumable/resource_gemstone_s',category:'consumable',grade:'S',consumableSubtype:'resources',itemId:2134,purchasable:true,minPurchaseQty:1,priceAdena:100000,priceCoinOfLuck:0,priceFastAden:0}]}]}]};
const clone=x=>JSON.parse(JSON.stringify(x)),delay=ms=>new Promise(ok=>setTimeout(ok,ms));
let C=null;
function qty(id){return C.snap.inventory.stacks.filter(x=>x.itemId===id).reduce((n,x)=>n+x.qty,0);}
function add(id,n){let r=C.snap.inventory.stacks.find(x=>x.itemId===id);if(!r){r={itemId:id,qty:0};C.snap.inventory.stacks.push(r);}r.qty+=n;assert.ok(r.qty>=0);}
function freshCase(spec){let release;const gate=new Promise(ok=>release=ok);const ls=spec.ls??0,gem=spec.gem??0;
 return {...spec,requests:[],posts:[],fixtureErrors:[],attempts:0,dropped:false,held:false,gate,release,snap:{name:'AuditHero',revision:100,level:78,l2Profession:'human_arcana_lord',classBranch:'mystic',adena:spec.adena??2000000,fastAdenBalance:11,worldX:spec.near?20000:0,worldY:spec.near?25000:0,subclasses:{activeSlot:0,slots:[{slot:0,profession:'human_arcana_lord',level:78,active:true}]},inventory:{eq:{l1:{itemId:9002284,enchant:25,instanceId:'offline-caster',...(spec.alreadyTarget?{augmentation:{uid:'already-target',grade:'S',outcomeId:'matk_6'}}:{})}},stacks:[{itemId:97,qty:1,enchant:6},{itemId:175,qty:1},{itemId:8688,qty:1},{itemId:10412,qty:ls},{itemId:2134,qty:gem},{itemId:5575,qty:spec.aa??2000000},{itemId:4037,qty:17},{itemId:920048,qty:11}]}}};}
const tls=fs.mkdtempSync(path.join(os.tmpdir(),'l2-native-tls-')),cert=path.join(tls,'c.pem'),key=path.join(tls,'k.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=l2wap.com','-keyout',key,'-out',cert],{stdio:'ignore'});
const srv=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},async(q,r)=>{try{
 const u=new URL(q.url,'https://l2wap.com');if(!C){r.writeHead(503);return r.end('{}');}C.requests.push({method:q.method,path:u.pathname});
 const json=x=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(x));};
 if(q.method==='GET'){
  if(['/char.html','/augmentation.html'].includes(u.pathname)){r.setHeader('content-type','text/html; charset=utf-8');return r.end(fixture);}
  if(u.pathname==='/character')return json({character:C.snap});
  if(u.pathname==='/character/catalog-hints')return json(catalog);
  if(u.pathname==='/character/catalog-version')return json({catalogVersion:catalog.catalogVersion});
  if(u.pathname==='/game/mammon/merchant')return json(merchant);
  if(u.pathname==='/game/mammon/merchant/shop'){if(C.holdQuote){C.held=true;await C.gate;}return json(lsShop);}
  if(u.pathname==='/game/drops-shop')return json(gemShop);
  const d=require(path.join(source,'tests/tools/daily-server-fixture.cjs'))();
  if(u.pathname==='/game/time')return json(d.clock);
  if(u.pathname==='/game/daily-quests')return json(d.daily);
  r.writeHead(503);return r.end('{}');
 }
 if(q.method!=='POST'){r.writeHead(405);return r.end('{}');}
 const chunks=[];for await(const chunk of q)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
 C.posts.push({path:u.pathname,body:clone(body)});if(body.expectedRevision!==C.snap.revision){C.revisionConflicts=(C.revisionConflicts||0)+1;r.statusCode=409;return json({error:'revision_conflict'});}C.appliedMutations=(C.appliedMutations||0)+1;
 if(u.pathname==='/game/mammon/teleport'){
  assert.deepEqual(body,{kind:'merchant',expectedAdenaCost:0,expectedRevision:C.snap.revision});C.snap.worldX=20000;C.snap.worldY=25000;C.snap.revision++;return json({character:C.snap});
 }
 if(u.pathname==='/game/mammon/merchant/buy'){
  assert.ok(Math.hypot(C.snap.worldX-20000,C.snap.worldY-25000)<=10800,'buy only near the merchant');assert.deepEqual(body,{category:'life_stones',itemKey:'s',qty:C.lsQty??3,expectedRevision:C.snap.revision});add(5575,-160000*body.qty);add(10412,body.qty);C.snap.revision++;
  if(C.dropLifeStone&&!C.dropped){C.dropped=true;q.socket.destroy();return;}return json({character:C.snap});
 }
 if(u.pathname==='/game/drops-shop/buy'){
  assert.deepEqual(body,{shopKey:'consumable/resource_gemstone_s',qty:C.gemQty??3,expectedRevision:C.snap.revision});C.snap.adena-=100000*body.qty;add(2134,body.qty);C.snap.revision++;return json({character:C.snap});
 }
 if(u.pathname==='/character/weapon-augmentation'){
  assert.equal(body.operation,'install');assert.equal(C.snap.inventory.eq.l1.itemId,9002284);add(10412,-1);add(2134,-1);C.snap.revision++;C.attempts++;
  const outcome=C.attempts===(C.goalAt??1)?'matk_6':'tempest';C.snap.inventory.eq.l1.augmentation={uid:'offline-augmentation-'+C.attempts,grade:'S',outcomeId:outcome};if(C.dropInstall&&!C.dropped){C.dropped=true;q.socket.destroy();return;}return json({character:C.snap,outcomeId:outcome,gemstonesSpent:1});
 }
 throw Error('Unexpected POST '+u.pathname);
 }catch(e){if(C)C.fixtureErrors.push(e.message);if(!r.headersSent)r.writeHead(500);r.end('{}');}});
const UUID='7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5e';
async function runCase(spec,port){C=freshCase(spec);const current=C;
 const opt=new firefox.Options().addArguments('-headless').setBinary(process.env.FIREFOX).setAcceptInsecureCerts(true);
 for(const[k,v]of Object.entries({'network.dns.localDomains':'l2wap.com','network.proxy.type':0,'network.dns.disableIPv6':true,'extensions.webextensions.uuids':JSON.stringify({'l2wap-bot@local':UUID}),'xpinstall.signatures.required':false,'datareporting.healthreport.uploadEnabled':false,'toolkit.telemetry.enabled':false,'app.update.auto':false}))opt.setPreference(k,v);
 const drv=await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER)).build();
 const storage=keys=>drv.executeAsyncScript('const keys=arguments[0],done=arguments[arguments.length-1];chrome.storage.local.get(keys).then(done).catch(e=>done({error:String(e)}))',keys);
 async function wait(fn,ms=20000){const end=Date.now()+ms;let err;while(Date.now()<end){try{if(await fn())return;}catch(e){err=e;}await delay(100);}throw err||Error('timeout '+spec.name);}
 async function event(id,value){await drv.executeScript("const e=document.getElementById(arguments[0]);if(e.type==='checkbox')e.checked=arguments[1];else e.value=arguments[1];e.dispatchEvent(new Event('change',{bubbles:true}));e.blur()",id,value);}
 let result;
 try{
  await drv.installAddon(zip,true);await drv.get('https://l2wap.com:'+port+'/char.html');await drv.executeScript('window.location.href=arguments[0]',`moz-extension://${UUID}/popup.html`);await drv.wait(until.urlContains('moz-extension://'),15000);await wait(async()=>Object.keys((await storage(['cfg'])).cfg||{}).length>100);await delay(200);
  const autoLs={weaponKey:'',targets:['matk_6'],maxAttempts:spec.maxAttempts??3,buyMaterials:true,aaBudget:spec.aaBudget??2000000,adenaBudget:spec.adenaBudget??2000000,aaReserve:0};
  const seed={on:false,cfg:{...flags,dock:true,dockMin:false,taskOnly:true,autoTasks:[],weaponScanAuto:false,tvtOn:false,enemyHunt:false,rbTimers:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmGoalFarm:false,mmCraftSend:false,mmFarmGuide:false,storyTurnIn:false,campAuto:false,campaign:false,shopAuto:false,autoMagister:false,rec:true,autoSnap:false,shopReserve:200000,mmTpMax:500000,autoLs},rt:{...flags,char:'AuditHero',lvl:78,prof:'Human Arcana Lord',classCur:{prof:'human_arcana_lord',slot:0},weaponsT:Date.now(),engineRecoveryEpoch:'7.1.13'}};
  await drv.executeAsyncScript('const data=arguments[0],done=arguments[arguments.length-1];chrome.storage.local.set(data).then(done)',seed);
  await drv.get('https://l2wap.com:'+port+'/augmentation.html');const f=await drv.wait(until.elementLocated(By.css('#l2bot-dock iframe')),15000);await drv.switchTo().frame(f);await wait(()=>drv.executeScript("return typeof document.getElementById('lsScanWeapons').onclick==='function'"));await drv.executeScript("document.querySelector('nav [data-tab=\"lifestone\"]').click()");
  assert.equal(await drv.executeScript('return typeof chrome.tabs'),'undefined');
  const stamp=(await storage(['rt'])).rt.lsWeapons?.t||0;await drv.findElement(By.id('lsScanWeapons')).click();await wait(async()=>((await storage(['rt'])).rt.lsWeapons?.t||0)>stamp);await wait(()=>drv.executeScript("return document.getElementById('lsWeapon').options.length===5"));
  await drv.executeScript("const e=document.getElementById('lsWeapon');e.value=e.options[1].value;e.dispatchEvent(new Event('change',{bubbles:true}));e.blur()");await wait(async()=>!!(await storage(['cfg'])).cfg.autoLs?.weaponKey);
  await event('lsTargets','matk_6');await wait(async()=>(await storage(['cfg'])).cfg.autoLs?.targets?.[0]==='matk_6');await event('lsMaxAttempts',autoLs.maxAttempts);await wait(async()=>(await storage(['cfg'])).cfg.autoLs?.maxAttempts===autoLs.maxAttempts);
  await event('lsAaBudget',autoLs.aaBudget);await event('lsAdenaBudget',autoLs.adenaBudget);await event('lsBuyMaterials',true);await wait(async()=>{const c=(await storage(['cfg'])).cfg.autoLs;return c.buyMaterials===true&&c.aaBudget===autoLs.aaBudget&&c.adenaBudget===autoLs.adenaBudget});
  assert.equal(C.posts.length,0,'scanning and choosing never mutate');await drv.findElement(By.id('lsStart')).click();
  if(spec.holdQuote){await wait(()=>C.held);await drv.findElement(By.id('stop')).click();await wait(async()=>(await storage(['on'])).on===false);C.release();await delay(1800);assert.equal(C.posts.length,0);assert.equal(C.attempts,0);assert.equal(qty(10412),0);assert.equal(qty(2134),3);}
  else if(spec.dropLifeStone||spec.dropInstall){
   await wait(async()=>{const s=(await storage(['rt'])).rt.autoLs;return C.dropped&&(s?.status==='paused'||spec.dropInstall&&s?.status==='done')});
   const requestPath=spec.dropInstall?'/character/weapon-augmentation':'/game/mammon/merchant/buy';
   await drv.switchTo().defaultContent();C.resourceTimings=await drv.executeScript("return performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname===arguments[0]).map(e=>({initiatorType:e.initiatorType,startTime:e.startTime,duration:e.duration}))",requestPath);await drv.switchTo().frame(f);assert.equal(C.resourceTimings.length,1,'one JavaScript fetch despite automatic wire retry');
   let unknown=(await storage(['rt'])).rt.autoLs;
   if(spec.dropInstall)assert.ok(unknown.pending&&!unknown.pending.kind||!unknown.pending&&unknown.attempts===1&&unknown.last==='matk_6','lost install receipt must keep pending or settle its one applied attempt');
   else assert.ok(unknown.pending?.kind==='supply'||!unknown.pending&&unknown.spentAA===480000,'lost original receipt must retain supply pending or confirm original debit via fresh GET');
   const wirePosts=C.posts.length;assert.equal(C.appliedMutations,1);assert.equal(C.attempts,spec.dropInstall?1:0);assert.equal(qty(10412),spec.dropInstall?2:3);
   assert.ok(C.posts.every(x=>x.path===requestPath&&JSON.stringify(x.body)===JSON.stringify(C.posts[0].body)),'automatic wire retry keeps identical expectedRevision/body');
   await drv.findElement(By.id('stop')).click();await wait(async()=>(await storage(['on'])).on===false);await drv.findElement(By.id('start')).click();await wait(async()=>(await storage(['on'])).on===true);await delay(1800);assert.equal(C.posts.length,wirePosts,'restart cannot replay unknown operation');assert.equal(C.appliedMutations,1);
   await drv.findElement(By.id('stop')).click();await wait(async()=>(await storage(['on'])).on===false);await drv.findElement(By.id('lsReconcile')).click();
   await wait(async()=>{const s=(await storage(['rt'])).rt.autoLs;return !s.pending&&(spec.dropInstall?s.attempts===1&&s.last==='matk_6'&&s.status==='done':s.status==='paused'&&s.spentAA===480000)});
   assert.equal(C.posts.length,wirePosts,'manual reconcile cannot replay mutation');
  }
  else if(spec.expectBudget){await wait(async()=>{const s=(await storage(['rt'])).rt.autoLs;return s?.status==='paused'});await delay(700);assert.equal(C.posts.length,0,'budget rejection precedes even a free teleport');assert.equal(C.attempts,0);assert.equal((await storage(['cfg'])).cfg.autoLs.maxAttempts,spec.maxAttempts??3);}
  else{await wait(async()=>(await storage(['rt'])).rt.autoLs?.status==='done',45000);const s=(await storage(['rt'])).rt.autoLs;
   if(spec.alreadyTarget)assert.equal(C.snap.inventory.eq.l1.augmentation.outcomeId,'matk_6');else assert.equal(s.last,spec.expectedLast??'matk_6');assert.equal(s.attempts,spec.expectedAttempts??spec.goalAt??1);assert.equal(C.attempts,spec.expectedAttempts??spec.goalAt??1);const kinds=C.posts.map(x=>x.path);assert.deepEqual(kinds,spec.expectedPaths);assert.equal(s.spentAA||0,spec.spentAA);assert.equal(s.spentAdena||0,spec.spentAdena);assert.equal(qty(5575),(spec.aa??2000000)-spec.spentAA);assert.equal(C.snap.adena,(spec.adena??2000000)-spec.spentAdena);
   if(spec.expectedMax){await wait(async()=>{const c=(await storage(['cfg'])).cfg.autoLs;return c.maxAttempts===spec.expectedMax&&+await drv.findElement(By.id('lsMaxAttempts')).getAttribute('value')===spec.expectedMax});assert.equal(s.maxAttempts,spec.expectedMax);}
   if(spec.alreadyTarget)assert.ok(!C.requests.some(x=>['/game/mammon/merchant','/game/mammon/merchant/shop','/game/drops-shop'].includes(x.path)),'existing target never quotes or buys');
   await delay(1700);assert.equal(C.posts.length,spec.expectedPaths.length,'goal or limit cannot buy more materials');}
  assert.equal(qty(4037),17);assert.equal(qty(920048),11);assert.equal(C.snap.fastAdenBalance,11);assert.deepEqual(C.fixtureErrors,[]);const s=(await storage(['rt'])).rt.autoLs;
  result={name:spec.name,result:'PASS',attempts:C.attempts,posts:C.posts,postCount:C.posts.length,appliedMutations:C.appliedMutations||0,automaticStaleRevisionConflicts:C.revisionConflicts||0,resourceTimings:C.resourceTimings||[],final:{status:s?.status,pendingKind:s?.pending?.kind||null,attempts:s?.attempts,spentAA:s?.spentAA||0,spentAdena:s?.spentAdena||0,maxAttempts:s?.maxAttempts,cfgMaxAttempts:(await storage(['cfg'])).cfg.autoLs.maxAttempts,uiMaxAttempts:+await drv.findElement(By.id('lsMaxAttempts')).getAttribute('value'),ls:qty(10412),gem:qty(2134),aa:qty(5575),adena:C.snap.adena,col:qty(4037),fastAden:qty(920048),worldX:C.snap.worldX,worldY:C.snap.worldY},requests:C.requests};console.log('CASE PASS',spec.name,C.posts.length);
 }catch(e){result={name:spec.name,result:'FAIL',error:e.stack,fixtureErrors:C.fixtureErrors,requests:C.requests,posts:C.posts,appliedMutations:C.appliedMutations||0,automaticStaleRevisionConflicts:C.revisionConflicts||0,resourceTimings:C.resourceTimings||[],serverState:{revision:C.snap.revision,aa:qty(5575),ls:qty(10412),gem:qty(2134)}};try{result.body=await drv.findElement(By.css('body')).getText();result.state=await storage(['rt','on','lock','cfg']);}catch{}fs.writeFileSync(path.join(base,'failure.json'),JSON.stringify(result,null,2)+'\n');throw e;}
 finally{current.release();await drv.quit();}
 return result;
}
(async()=>{await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));const port=srv.address().port;
 const TP='/game/mammon/teleport',LS='/game/mammon/merchant/buy',GM='/game/drops-shop/buy',AUG='/character/weapon-augmentation';
 const specs=[
  {name:'empty stock: VIP teleport, LS3 Gem3 batch, early goal leaves1pair',goalAt:2,expectedPaths:[TP,LS,GM,AUG,AUG],spentAA:480000,spentAdena:300000,expectedMax:3},
  {name:'only Life Stone deficit: batchLS3 and no extra Gemstone',ls:0,gem:3,expectedPaths:[TP,LS,AUG],spentAA:480000,spentAdena:0,expectedMax:3},
  {name:'only Gemstone deficit: batchGem3 without merchant or LS',ls:3,gem:0,expectedPaths:[GM,AUG],spentAA:0,spentAdena:300000,expectedMax:3},
  {name:'limited AA: stockLS1 AA500k max10 becomes4 atomically',ls:1,gem:0,aa:500000,maxAttempts:10,goalAt:99,expectedAttempts:4,expectedLast:'tempest',expectedMax:4,lsQty:3,gemQty:4,expectedPaths:[TP,LS,GM,AUG,AUG,AUG,AUG],spentAA:480000,spentAdena:400000},
  {name:'zero AA budget blocks all mutations without setting max0',aaBudget:0,expectBudget:true},
  {name:'zero adena budget pauses without reducing max or spending',adenaBudget:0,expectBudget:true},
  {name:'insufficient adena reserve pauses before free teleport',adena:250000,expectBudget:true},
  {name:'lost batchLS3 receipt: no replay, explicit reconcile',ls:0,gem:3,near:true,dropLifeStone:true},
  {name:'lost augmentation receipt: Firefox retry409 keeps one applied attempt',ls:3,gem:3,dropInstall:true},
  {name:'Stop during held batch quote cancels all spending',ls:0,gem:3,holdQuote:true},
  {name:'existing target needs no material quotes or purchases',alreadyTarget:true,expectedAttempts:0,expectedPaths:[],spentAA:0,spentAdena:0,expectedMax:3}
 ];
 const wanted=process.env.L2_NATIVE_CASES?JSON.parse(process.env.L2_NATIVE_CASES):null;const selected=wanted?specs.filter(s=>wanted.some(part=>s.name.includes(part))):process.env.L2_NATIVE_CASE?specs.filter(s=>s.name.includes(process.env.L2_NATIVE_CASE)):specs;if(!selected.length)throw Error('No matching native case');const results=[];try{for(const spec of selected){results.push(await runCase(spec,port));fs.writeFileSync(path.join(base,'partial-results.json'),JSON.stringify(results,null,2)+'\n');}}
 finally{srv.close();fs.rmSync(tls,{recursive:true,force:true});}
 const data={at:new Date().toISOString(),version,firefox:'153.5.0esr',geckodriver:'0.37.1',result:'PASS',nativeCases:results.length,boundary:'Isolated native Firefox profiles; every game URL resolves via network.dns.localDomains to loopback HTTPS only, missing routes503. WebDriver acceptInsecureCerts applies only to this local fixture; download TLS verification unchanged. No live account or credentials.',cases:results};fs.writeFileSync(path.join(base,'native-materials-result.json'),JSON.stringify(data,null,2)+'\n');console.log('PASS native Firefox materials',JSON.stringify({version,cases:results.length}));
})().catch(e=>{console.error(e.stack);C?.release();srv.close();fs.rmSync(tls,{recursive:true,force:true});process.exitCode=1});
