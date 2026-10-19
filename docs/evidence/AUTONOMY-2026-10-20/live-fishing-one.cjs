'use strict';
// Реальная игра: только отдельный осознанный запуск; не входит в tests/run-all.cjs.
if(process.env.L2_LIVE_AUDIT!=='one-cast')throw Error('Для живой проверки задайте L2_LIVE_AUDIT=one-cast');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=process.env.AUDIT_REPO||path.resolve(__dirname,'../../..');
const output=process.env.AUDIT_OUTPUT||path.join(root,'work/live-fishing-one-result.json');fs.mkdirSync(path.dirname(output),{recursive:true});
const browser=process.env.CHROMIUM||'/usr/bin/chromium';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=30000){const stop=Date.now()+ms;while(Date.now()<stop){try{const r=await fn();if(r)return r}catch{}await delay(250)}throw Error('timeout waiting for audit condition')}
(async()=>{
 const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
 const ctx=await chromium.launchPersistentContext('',{headless:true,executablePath:browser,...(proxy?{proxy:{server:proxy}}:{}),args:['--no-sandbox',`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 const out={startedAt:new Date().toISOString(),readOnly:false,scenario:'one-cast-with-reload',maxDurationMs:300000,blockedMutations:[],mutations:[],pageErrors:[],samples:[]};let phase='page-load-off',castRequests=0;const watchdog=setTimeout(()=>ctx.close().catch(()=>{}),360000);
 try{
  await ctx.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(!['http:','https:'].includes(u.protocol))return route.continue();
   if(u.hostname!=='l2wap.com')return route.abort();
   if(!['GET','HEAD'].includes(req.method())&&!['/auth/login','/auth/refresh'].includes(u.pathname)){
    let action='';try{action=req.postDataJSON()?.action||''}catch{}
    const native=['/game/world/enter-map','/game/player-login-claim','/game/player-interaction'].includes(u.pathname);
    const fish=u.pathname.startsWith('/game/fishing/')&&!/buy|purchase|enchant|learn|exchange|process|cut|training|spot/i.test(u.pathname);
    if((!native&&!fish)||/buy|purchase|enchant|learn|exchange|process|cut|open/i.test(action)||(action==='cast'&&++castRequests>1)){
     out.blockedMutations.push({phase,path:u.pathname,method:req.method(),action});return route.fulfill({status:403,json:{error:'audit_limit'}});
    }
    out.mutations.push({phase,path:u.pathname,method:req.method(),action,at:new Date().toISOString()});
   }
   return route.continue();
  });
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),id=new URL(sw.url()).host;
  await until(()=>sw.evaluate(async()=>{const s=await chrome.storage.local.get(['cfg','rt']);return !!s.cfg&&!!s.rt}));await delay(300);
  const flags=Object.fromEntries([...fs.readFileSync(root+'/content.js','utf8').matchAll(/once\('([^']+)'/g)].map(m=>[m[1],1]));
  await sw.evaluate(async flags=>{
   const s=await chrome.storage.local.get(['cfg']);
   const cfg={...s.cfg,...flags,dock:false,autoTasks:[],taskOnly:true,tvtOn:false,weaponScanAuto:false,enemyHunt:false,rbTimers:false,clanTasks:false,dailyAuto:false,mmOrders:false,mmUpgrade:false,mmMailClaim:false,mmGoalFarm:false,mmCraftSend:false,mmFarmGuide:false,storyTurnIn:false,campAuto:false,campaign:false,shopAuto:false,autoMagister:false,rec:false,autoSnap:false,limitRanges:{},fishAutoSetup:false,fishRodBuy:false,fishAutoBuy:false,fishTimeAuto:false,fishShots:false,fishShotAuto:false,fishProcess:false,rodEnchantTo:0,fishMaxCasts:1,dailyFishLimit:1,dailyKillLimit:0,fishGoal:'',fishBait:'basic',fishOpenBoxes:false};
   const rt={...flags,char:'Warlock',engineRecoveryEpoch:'7.1.13',rodLvl:10};
   await chrome.storage.local.set({on:false,paused:false,lock:null,cfg,rt,'cfg@Warlock':cfg,'rt@Warlock':rt});
  },flags);
  const page=await ctx.newPage();page.on('pageerror',e=>out.pageErrors.push(e.name+': '+e.message.slice(0,160)));
  await page.goto('https://l2wap.com/login.html',{waitUntil:'domcontentloaded',timeout:45000});
  const login=await ctx.request.post('https://l2wap.com/auth/login',{data:{login:process.env.L2WAP_LOGIN,password:process.env.L2WAP_PASSWORD}});
  if(login.status()!==200)throw Error('live login HTTP '+login.status());
  const auth=await login.json();if(!auth.token)throw Error('live login missing token');
  await page.evaluate(token=>localStorage.setItem('token',token),auth.token);delete auth.token;
  await page.goto('https://l2wap.com/fishing.html',{waitUntil:'domcontentloaded',timeout:45000});
  await until(()=>page.locator('#l2-hud-legacy-name').textContent().then(x=>x?.trim()==='Warlock'));
  const sample=async phase=>{
   const s=await sw.evaluate(async()=>{const{on,paused,rt,cfg,lock}=await chrome.storage.local.get(['on','paused','rt','cfg','lock']);return {on,paused,hero:rt?.char,status:rt?.status,check:rt?.dailyServerCheck,quota:rt?.dailyQuota,tasks:cfg?.autoTasks,hasLease:!!lock,fish:rt?.fish,pending:rt?.fishCastPending,active:rt?.fishCastActive}});
   const ch=await page.evaluate(async()=>{const r=await L2.authFetch('/character');const d=typeof r.json==='function'?await r.json():r,c=d.character||d;return {name:c.name,level:c.level,inBattle:c.inBattle,revision:c.revision,adena:c.adena,coinOfLuck:c.coinOfLuck,hp:c.hp,mp:c.mp}});
   const fish=await page.evaluate(async()=>{const r=await L2.authFetch('/game/fishing/state');const d=typeof r.json==='function'?await r.json():r;return {revision:d.revision,target:d.target?{present:true,name:d.target.name}:null,remainingMs:d.fishingTime?.remainingMs,basicBait:d.basicBait?.quantity,goodBait:d.goodBait?.quantity,bait:d.bait?.quantity}});
   out.samples.push({phase,at:new Date().toISOString(),bot:s,hero:ch,fishing:fish});
   return s;
  };
  await sample('loaded-off');
  const popup=await ctx.newPage();await popup.goto('chrome-extension://'+id+'/popup.html');await until(()=>popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
  const before=out.samples[0];assert.equal(before.hero.inBattle,false);assert.equal(before.fishing.target,null);assert.ok(before.fishing.remainingMs>60000);
  await sw.evaluate(async()=>{const{cfg}=await chrome.storage.local.get('cfg');const next={...cfg,autoTasks:['fish']};await chrome.storage.local.set({cfg:next,'cfg@Warlock':next});});
  phase='start';await popup.locator('#start').click();
  await until(()=>sw.evaluate(async()=>{const{on,rt}=await chrome.storage.local.get(['on','rt']);return on&&rt?.dailyServerCheck?.char==='Warlock'}),45000);
  await sample('started');
  const started=Date.now();let reloaded=false,done=false;
  while(Date.now()-started<300000){
   const b=await sw.evaluate(async()=>{const{on,rt}=await chrome.storage.local.get(['on','rt']);return {on,casts:rt?.fish?.casts||0,active:rt?.fishCastActive,pending:!!rt?.fishCastPending,status:rt?.status}});
   if(castRequests===1&&!reloaded&&(b.active||b.casts>=1)){
    phase='reload-after-cast';await sample('before-reload');await page.reload({waitUntil:'domcontentloaded'});reloaded=true;await delay(1000);continue;
   }
   if(b.casts===1&&!b.active&&!b.pending){await sample('completed');if(out.samples.at(-1).fishing.target===null){done=true;break;}}
   if(!b.on&&b.casts===0)throw Error('bot stopped before cast: '+b.status);
   await delay(1000);
  }
  assert.ok(done,'one cast did not finish within300s');
  phase='stop';await popup.locator('#stop').click();await until(()=>sw.evaluate(async()=>!(await chrome.storage.local.get('on')).on));await delay(1500);await sample('stopped');
  const after=out.samples.at(-1);assert.equal(after.hero.inBattle,false);assert.equal(after.fishing.target,null);assert.equal(after.hero.adena,before.hero.adena);assert.equal(after.hero.coinOfLuck,before.hero.coinOfLuck);
  assert.equal(after.bot.fish.casts,1);assert.ok(!after.bot.pending);assert.equal(castRequests,1);assert.equal(out.blockedMutations.length,0);assert.deepEqual(out.pageErrors,[]);
  out.reloaded=reloaded;out.castRequests=castRequests;
  out.passed=true;
 }catch(e){out.passed=false;out.error=e.name+': '+e.message.replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,350);process.exitCode=1}
 finally{clearTimeout(watchdog);out.finishedAt=new Date().toISOString();await ctx.close();fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2))}
})().catch(e=>{console.error(e.name+': browser setup failed');process.exitCode=1});
