'use strict';
// Локальные ответы, реальные dungeons.js и battle-start-flow.js игры из разрешённого снимка.
// L2_NATIVE_BATTLE_START_FLOW=/path/to/battle-start-flow.js node tests/v207-catacomb-direct-next-browser.cjs
// 20.54 (прогон смоуков 23.10): сохранённого снимка в репозитории нет — без переменной и копии в /mnt/project-files/fixtures читается публичный статический
// https://l2wap.com/battle-start-flow.js (один GET без входа и токена, как town-buffer.js в tests/tools/warlock-public-contract.cjs).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
let native;const moduleSource=fs.readFileSync(path.join(__dirname,'../modules/dungeons.js'),'utf8');
const did='catacomb_of_the_branded',sid=n=>'sdms_'+did+'_'+n;
(async()=>{
 // 20.54: по умолчанию — копия 23.10 в общей папке проекта (SHA256SUMS.txt в native-detect/); L2_FETCH_PUBLIC=1 — живой файл игры
 const saved=process.env.L2_FETCH_PUBLIC==='1'?'':process.env.L2_NATIVE_BATTLE_START_FLOW||['/mnt/project-files/fixtures/battle-start-flow.js'].find(f=>fs.existsSync(f));
 if(saved)native=fs.readFileSync(saved,'utf8');
 else{const r=await fetch('https://l2wap.com/battle-start-flow.js');if(!r.ok)throw Error('Public source HTTP '+r.status);native=await r.text();}
 assert.match(native,/L2BattleStartFlow/,'не тот battle-start-flow.js');
 console.log('battle-start-flow.js SHA256 '+require('node:crypto').createHash('sha256').update(native).digest('hex'));
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
     setRt:async p=>Object.assign(rt,p),setStatus:()=>{},
     // 20.54 (прогон смоуков 23.10): с 20.39 (feb69bd, #314) catNext после перехода ждёт ухода старого документа через env.waitFor —
     // как content.waitFor: опрос условия, null при Stop/потере вкладки или по сроку.
     sleep:ms=>new Promise(r=>setTimeout(r,ms)),waitFor:async(fn,timeout=10000,step=250)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(!env.on||!env.tabOwner)return null;const r=fn();if(r)return r;await new Promise(r=>setTimeout(r,step));}return null;},
     gameGet:async p=>{const r=await fetch(p);if(interrupt){env.on=false;document.getElementById('victory').remove()}return r}};
    return L2V7Factories.dungeons(env).catNext();
   },{did,interrupt});
   if(interrupt){assert.equal(await result,true);assert.equal(starts.length,0);assert.match(page.url(),/_119$/)}
   else{await result.catch(e=>{if(!/context.*destroyed/i.test(e.message))throw e});await page.waitForFunction(()=>window.ready===true);assert.deepEqual(starts,[sid('041')]);assert.match(page.url(),/_041$/)}
   assert.ok(!requests.includes('/dungeon.html'));assert.ok(!requests.includes('/map.html'));assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS browser: safe next → native battle start, no map; interrupted read → no battle start');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
