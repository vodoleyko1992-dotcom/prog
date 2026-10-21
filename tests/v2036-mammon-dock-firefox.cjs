'use strict';
// Настоящий Firefox: изолированный профиль, только локальные HTTPS fixture и явно переданный финальный ZIP.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {Builder,By,until}=require('selenium-webdriver'),firefox=require('selenium-webdriver/firefox');
const base=path.resolve(process.env.L2_NATIVE_OUT||'work/native-firefox-mammon'),source=path.resolve(process.env.L2_SOURCE||process.cwd()),zip=process.env.L2_ZIP;
if(!zip)throw Error('L2_ZIP is required: test only the explicitly supplied final offline package');
fs.mkdirSync(base,{recursive:true});
const manifest=JSON.parse(execFileSync('unzip',['-p',zip,'manifest.json'],{encoding:'utf8'}));
const flags=Object.fromEntries([...fs.readFileSync(source+'/content.js','utf8').matchAll(/once\('([^']+)'/g)].map(x=>[x[1],1]));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fixture='<!doctype html><meta charset="utf-8"><title>Local L2 fixture</title><body><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div><div id="character-profession">Human Warlock</div><div id="char-bag-list"></div><div id="char-bag-pager"></div><div id="map-mob-list"></div><button data-inv-cat="weapon" aria-selected="true"></button><button data-inv-grade="all" aria-selected="true"></button>';
const snap={id:'synthetic-bag-hero',name:'AuditHero',revision:1,level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},
 inventory:{eq:{belt:{itemId:920018,specialGearLevel:0}},stacks:[{itemId:1874,qty:11891},{itemId:1893,qty:0}]}};
const requests=[],errors=[];let reads=0,mode='ok',driver;
const tls=fs.mkdtempSync(path.join(base,'tls-')),cert=path.join(tls,'c.pem'),key=path.join(tls,'k.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=l2wap.com','-keyout',key,'-out',cert],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(q,r)=>{try{
 const u=new URL(q.url,'https://l2wap.com');requests.push({method:q.method,path:u.pathname});
 const json=x=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(x));};
 if(q.method!=='GET'){errors.push('Unexpected '+q.method+' '+u.pathname);r.writeHead(405);return r.end('{}');}
 if(['/char.html','/map.html'].includes(u.pathname)){r.setHeader('content-type','text/html; charset=utf-8');return r.end(fixture);}
 if(u.pathname==='/character'){reads++;if(mode==='error'){r.writeHead(500);return r.end('{}');}return json({character:snap});}
 if(u.pathname==='/character/catalog-hints')return json(JSON.parse(fs.readFileSync(path.join(source,'kb/raw/catalog-hints.json'),'utf8')).data);
 if(u.pathname==='/character/catalog-version')return json({catalogVersion:'synthetic-local'});
 const daily=require(path.join(source,'tests/tools/daily-server-fixture.cjs'))();
 if(u.pathname==='/game/time')return json(daily.clock);
 if(u.pathname==='/game/daily-quests')return json(daily.daily);
 r.writeHead(503);r.end('{}');
 }catch(e){errors.push(e.stack);if(!r.headersSent)r.writeHead(500);r.end('{}');}});
const UUID='7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5e';
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,url='https://l2wap.com:'+port+'/char.html';
 const opt=new firefox.Options().addArguments('-headless').setBinary(process.env.FIREFOX).setAcceptInsecureCerts(true);
 for(const[k,v]of Object.entries({'network.dns.localDomains':'l2wap.com','network.proxy.type':0,'network.dns.disableIPv6':true,
  'extensions.webextensions.uuids':JSON.stringify({'l2wap-bot@local':UUID}),'xpinstall.signatures.required':false,
  'datareporting.healthreport.uploadEnabled':false,'toolkit.telemetry.enabled':false,'app.update.auto':false}))opt.setPreference(k,v);
 driver=await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER)).build();
 const storage=keys=>driver.executeAsyncScript('const keys=arguments[0],done=arguments[arguments.length-1];chrome.storage.local.get(keys).then(done).catch(e=>done({error:String(e)}))',keys);
 const set=data=>driver.executeAsyncScript('const data=arguments[0],done=arguments[arguments.length-1];chrome.storage.local.set(data).then(done).catch(e=>done({error:String(e)}))',data);
 async function wait(fn,ms=20000){const end=Date.now()+ms;let last,error;while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){error=e;}await delay(100);}throw Error('timeout '+String(last)+(error?' · '+error.message:''));}
 try{
  await driver.installAddon(zip,true);await delay(2500);await driver.get(url);
  await driver.executeScript('window.location.href=arguments[0]',`moz-extension://${UUID}/popup.html`);await driver.wait(until.urlContains('moz-extension://'),15000);
  await wait(async()=>Object.keys((await storage(['cfg'])).cfg||{}).length>100);await delay(200);
  const now=Date.now();await set({on:false,cfg:{...flags,dock:true,dockMin:false,taskOnly:true,autoTasks:['mammon'],weaponScanAuto:false,tvtOn:false,enemyHunt:false,rbTimers:false,
   clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmGoalFarm:false,mmCraftSend:false,mmFarmGuide:false,storyTurnIn:false,campAuto:false,campaign:false,
   shopAuto:false,autoMagister:false,rec:false,autoSnap:false,mmGoalItem:920018,mmGoalLvl:1},rt:{...flags,char:'AuditHero',lvl:75,prof:'Human Warlock',classCur:{prof:'human_warlock',slot:0},
   weaponsT:now,engineRecoveryEpoch:'7.1.13',mmJob:null,mmGoReq:null,actionPayments:{pending:null},mmCost:{'920018:0':{a:0,c:0,m:[[1893,'Oriharukon',13]],t:now}},
   mmGear:[{id:920018,n:'Synthetic Belt',g:'D',lvl:0,eq:true}],mmGearT:now,mmEq:{belt:[920018,0]},mmEqT:now,mmBagAnalysis:null}});
  await driver.get(url);await driver.executeScript("localStorage.setItem('token','synthetic-local-only')");
  const dock=await driver.wait(until.elementLocated(By.css('#l2bot-dock iframe')),15000);await driver.switchTo().frame(dock);
  await wait(()=>driver.executeScript("return typeof document.getElementById('mmBagAnalyze')?.onclick==='function'"));
  await driver.executeScript("document.querySelector('nav [data-tab=\"mammon\"]').click();const e=document.getElementById('mmBagAnalyze');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true");
  const capabilities=await driver.executeScript("return {docked:document.documentElement.classList.contains('docked'),tabs:typeof chrome.tabs,runtime:typeof chrome.runtime.sendMessage}");
  assert.deepEqual(capabilities,{docked:true,tabs:'undefined',runtime:'function'});
  const analysis=async()=>(await storage(['rt'])).rt.mmBagAnalysis;
  async function clickAndWait(){const old=(await analysis())?.attemptAt||0,before=reads;await driver.findElement(By.id('mmBagAnalyze')).click();await wait(()=>reads>before);
   await wait(async()=>((await analysis())?.attemptAt||0)>old);await wait(()=>driver.findElement(By.id('mmBagAnalyze')).isEnabled());return analysis();}
  async function noActions(on=false){const s=await storage(['rt','on']);assert.equal(s.on,on);assert.equal(s.rt.mmJob,null);assert.equal(s.rt.mmGoReq,null);assert.equal(s.rt.actionPayments?.pending??null,null);
   assert.equal(requests.filter(q=>q.method!=='GET').length,0);await driver.switchTo().defaultContent();assert.equal(await driver.getCurrentUrl(),url);await driver.switchTo().frame(dock);}
  let before=reads;const first=await clickAndWait();assert.equal(reads,before+1);assert.equal(first.status,'ok');assert.equal(first.source,'manual');
  assert.deepEqual(first.goal,{id:920018,lvl:0,to:1});assert.equal(first.readyMaterials,false);assert.deepEqual(first.items.filter(x=>x.id===1893).map(x=>[x.need,x.have,x.missing]),[[13,0,13]]);
  assert.equal(first.raw.find(x=>x.id===1874).have,11891);await noActions();
  snap.revision++;snap.inventory.stacks.find(x=>x.itemId===1893).qty=13;before=reads;const fresh=await clickAndWait();assert.equal(reads,before+1);
  assert.equal(fresh.status,'ok');assert.equal(fresh.readyMaterials,true);assert.ok(fresh.t>first.t);assert.equal(fresh.items.find(x=>x.id===1893).missing,0);await noActions();
  mode='error';before=reads;const failure=await clickAndWait();assert.equal(reads,before+1);assert.equal(failure.status,'error');assert.equal(failure.t,fresh.t);assert.deepEqual(failure.items,fresh.items);
  await wait(async()=>/Анализ не обновлён/.test(await driver.findElement(By.id('mmBagStatus')).getText()));assert.match(await driver.findElement(By.id('mmBagStatus')).getText(),/Последний успешный анализ/);
  assert.equal(await driver.findElement(By.id('mmBagAnalyze')).isEnabled(),true);await noActions();
  // Запуск явно нажат пользователем: тот же владелец может вручную перечитать сумку при ON.
  mode='ok';snap.revision++;snap.inventory.stacks.find(x=>x.itemId===1893).qty=7;
  await driver.findElement(By.id('start')).click();await wait(async()=>{const s=await storage(['on','lock']);return s.on&&!!s.lock?.epoch});await delay(700);
  before=reads;const owner=await clickAndWait();assert.equal(reads,before+1);assert.equal(owner.status,'ok');assert.equal(owner.items.find(x=>x.id===1893).have,7);assert.equal(owner.items.find(x=>x.id===1893).missing,6);await noActions(true);
  await driver.findElement(By.id('stop')).click();await wait(async()=>(await storage(['on'])).on===false);await noActions();
  assert.deepEqual(errors,[]);const browser=await driver.getCapabilities();
  const result={at:new Date().toISOString(),version:manifest.version,result:'PASS',browser:browser.get('browserName'),browserVersion:browser.get('browserVersion'),capabilities,
   offFreshRead:'PASS',refreshChangedBag:'PASS',errorKeepsPreviousSuccess:'PASS',buttonRecovered:'PASS',onSameOwnerRead:'PASS',startStopControls:'PASS',reads,posts:0,navigation:false,
   boundary:'Native Firefox; chrome.tabs absent without mocking. Every game address resolves to loopback TLS fixture; no live account, credentials, game network or mutations.',requests,errors};
  fs.writeFileSync(path.join(base,'native-mammon-dock-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));console.log('PASS native Firefox Mammon dock '+manifest.version);
 }catch(e){const failure={error:e.stack,version:manifest.version,reads,requests,errors};try{failure.body=await driver.findElement(By.css('body')).getText();failure.state=await storage(['on','rt','cfg','lock']);}catch{}
  fs.writeFileSync(path.join(base,'native-mammon-dock-failure.json'),JSON.stringify(failure,null,2)+'\n');throw e;}
 finally{await driver.quit();}
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>{server.close();fs.rmSync(tls,{recursive:true,force:true});});
