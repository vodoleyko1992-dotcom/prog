'use strict';
// Локальная DOM-страница, настоящая фабрика fishing; без обращений к игре.
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{for(const kind of ['tasks','legacy','stale-active']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<button class="l2-fishing-hotbar-slot" data-slot="fishing">Fishing</button><section id="fishing-target" hidden></section><div id="fishing-log"></div>');
  await page.addScriptTag({path:path.join(__dirname,'../modules/fishing.js')});
  const r=await page.evaluate(async kind=>{
   const clicks=[],halts=[],statuses=[];
   const env={on:true,tabOwner:true,rt:{char:'hero',fishCastActive:kind==='stale-active',fishTgt:{type:'fish',n:100,got:100,done:true,doneT:123}},
    cfg:{...(kind==='legacy'?{fishMode:true}:{autoTasks:['fish','auto']}),fishAutoSetup:false},NET_FISH:{},autonomyMode:()=> 'fish',
    $q:s=>document.querySelector(s),shown:e=>!!e&&!e.hidden,fire:b=>{clicks.push(b?.dataset.slot);b?.click()},
    setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},setStatus:s=>statuses.push(s),halt:async s=>{halts.push(s);env.on=false},
    rec(){},waitFor:async fn=>fn(),sleep:async()=>{},cdBusy:()=>false};
   const F=L2V7Factories.fishing(env);await F.fishing();await F.fishing();
   return{clicks,halts,statuses,rt:env.rt};
  },kind);
  assert.equal(r.clicks.length,0);assert.equal(r.halts.length,kind==='legacy'?1:0);assert.equal(r.rt.fishCastActive,false);assert.equal(r.rt.fishTgt.doneT,123);assert.deepEqual(errors,[]);
  console.log('PASS browser completed goal '+kind);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
