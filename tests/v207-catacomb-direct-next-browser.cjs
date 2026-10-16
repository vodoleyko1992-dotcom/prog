'use strict';
// Локальные ответы, реальные dungeons.js и battle-start-flow.js игры из разрешённого снимка.
// L2_NATIVE_BATTLE_START_FLOW=/path/to/battle-start-flow.js node tests/v207-catacomb-direct-next-browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
const native=fs.readFileSync(process.env.L2_NATIVE_BATTLE_START_FLOW,'utf8'),moduleSource=fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8');
const did='catacomb_of_the_branded',sid=n=>'sdms_'+did+'_'+n;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const interrupt of [false,true]){
   const page=await browser.newPage(),requests=[],starts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());requests.push(u.pathname);
    if(u.pathname==='/game/dungeon/view')return route.fulfill({contentType:'application/json',body:JSON.stringify({dungeon:{id:did,mobs:[{id:sid('026'),name:'Grave Priest',level:50,kind:'passive'},{id:sid('041'),name:'Safe',level:49,kind:'passive'}]}})});
    if(u.pathname==='/game/battle/start'){starts.push(req.postDataJSON().spawnId);return route.fulfill({json:{character:{revision:8},battle:{spawnId:sid('041')}}})}
    if(u.pathname==='/battle.html'&&u.searchParams.get('spawnId')===sid('041'))return route.fulfill({contentType:'text/html',body:`<script>${native}</script><script>
      let ch={revision:7},bt=null;const sid=new URLSearchParams(location.search).get('spawnId');
      L2BattleStartFlow.create({state:{getCharacter:()=>ch,setCharacter:c=>ch=c,getBattle:()=>bt,setBattle:b=>bt=b,getSpawnId:()=>sid},revision:{current:()=>ch.revision},battleApi:{start:async id=>(await fetch('/game/battle/start',{method:'POST',body:JSON.stringify({spawnId:id})})).json()},ui:{prepareActive:()=>window.ready=true}}).ensureBattle();</script>`});
    return route.fulfill({contentType:'text/html',body:'<div id="victory">Победа</div>'});
   });
   await page.goto('https://l2wap.com/battle.html?spawnId='+sid('119'));await page.addScriptTag({content:moduleSource});
   const result=page.evaluate(async({did,interrupt})=>{
    const cfg={catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:10},rt={char:'Hero'};
    const env={cfg,rt,on:true,tabOwner:true,canAct:()=>true,canRun:()=>true,autonomyMode:()=> 'cat',heroLvl:()=>49,victory:()=>!!document.getElementById('victory'),cancelRisk:n=>n==='Grave Priest'?{n:3}:null,
     setRt:async p=>Object.assign(rt,p),setStatus:()=>{},gameGet:async p=>{const r=await fetch(p);if(interrupt){env.on=false;document.getElementById('victory').remove()}return r}};
    return L2V7Factories.dungeons(env).catNext();
   },{did,interrupt});
   if(interrupt){assert.equal(await result,true);assert.equal(starts.length,0);assert.match(page.url(),/_119$/)}
   else{await result.catch(e=>{if(!/context.*destroyed/i.test(e.message))throw e});await page.waitForFunction(()=>window.ready===true);assert.deepEqual(starts,[sid('041')]);assert.match(page.url(),/_041$/)}
   assert.ok(!requests.includes('/dungeon.html'));assert.ok(!requests.includes('/map.html'));assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS browser: safe next → native battle start, no map; interrupted read → no battle start');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
