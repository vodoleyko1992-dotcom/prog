'use strict';
// 22.10 (Old Box → автофарм): настоящий Chromium/native fetch, точные функции content.js и чистый dailyServerChange.
// Локальный HTTP, управляемые actor/IPC/конечная map. Это узкая браузерная регрессия, не полный MV3 и не живая игра.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/workspace/.local/l2tools/node/node_modules/playwright');
const root=path.join(__dirname,'..'),source=fs.readFileSync(process.env.FISH_RESUME_CONTENT_SOURCE||root+'/content.js','utf8'),background=fs.readFileSync(root+'/background.js','utf8');
const section=(s,a,b)=>{const from=s.indexOf(a),to=s.indexOf(b,from);assert.ok(from>=0&&to>from,a);return s.slice(from,to)};
const daily=section(source,'let dailyStartRetry=','// ---------- персонаж');
const get=section(source,'async function gameGet(','// 7.2.5');
const quota=section(source,'function farmQuotaTask()','const farmQuotaKey');
const map=section(source,'async function map(...args)','// ---------- бой ----------');
const change=section(background,'function dailyServerChange(','function dailyFishChange(');
const dailyFixture=require('./tools/daily-server-fixture.cjs'),proof=[],requests=[],routeErrors=[];
let count=1000,holdTime=false,releaseTime=null,failDaily=false;
const runner=()=>`
'use strict';
let on=true,tabOwner=true,leaseEpoch=1,automationGeneration=1,fixtureFishing=false,fixtureFishTask=false,fixtureTarget=null;
let cfg={autoTasks:['auto'],dailyKillLimit:36000,dailyFishLimit:1539},rt={char:'AuditHero',manualKickAt:1,dailyStart:1,fishCastActive:true,fish:{t0:100,caught:153}};
let stored=structuredClone(rt);const calls=[],logs=[],statuses=[];let maps=0;
const isBattle=()=>false,isFishing=()=>fixtureFishing,fishNow=()=>fixtureFishTask,fishState=()=>fixtureTarget,victory=()=>false,heroNick=()=>rt.char;
const autonomyMode=()=>{const t=L2EngineCore.selectedTask(cfg,rt);return t==='auto'?'farm':t||'farm'};
const automationSnapshot=()=>JSON.stringify([automationGeneration,rt.char,leaseEpoch,rt.manualKickAt,cfg.autoTasks,fixtureFishing,fixtureFishTask]);
const automationCurrent=s=>on&&tabOwner&&s===automationSnapshot();
const gameAuth=()=>({}),setStatus=s=>statuses.push(s),rec=(...a)=>logs.push(a),rtCommit=async()=>true;
const setRt=async p=>{Object.assign(rt,p);Object.assign(stored,structuredClone(p));return{ok:true}};
const TAB_ID='local-browser';
const dailyQuotaToday=(r,now)=>L2EngineCore.dailyQuotaToday(r,now),quotaRandom=(min)=>min;
${change}
const ipc=async m=>{calls.push(m);const r=dailyServerChange({on,cfg,rt:stored},m.dailyServer,Date.now());if(!r.ok)return r;stored=r.rt;return{ok:true,dailyQuota:r.rt.dailyQuota,daily:r.rt.daily,dailyServerCheck:r.rt.dailyServerCheck,dailyFishMark:r.rt.dailyFishMark,serverClock:r.rt.serverClock,fishTgt:r.rt.fishTgt??null}};
const campOn=()=>false,raidIdleFarm=()=>false,lootGoal=()=>null,tasksIdle=async()=>{throw Error('unexpected tasksIdle')};
const L2V7Modules={mobfarm:{map:async()=>{maps++;return true}}};
${quota}
${get}
${daily}
${map}
const state=()=>({maps,active:rt.fishCastActive,storedActive:stored.fishCastActive,current:dailyServerCurrent(),count:L2EngineCore.dailyCount(rt,'auto'),fish:L2EngineCore.dailyCount(rt,'fish'),check:rt.dailyServerCheck||null,storedCheck:stored.dailyServerCheck||null,calls:calls.length,statuses,logs});
window.Fixture={map:async()=>{await map();return state()},state,change:kind=>{if(kind==='stop')on=false;if(kind==='pending')rt.fishCastPending={at:Date.now()};if(kind==='task'){fixtureFishTask=true;cfg.autoTasks=['fish'];automationGeneration++}}};
`;
const server=http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;requests.push({method:req.method,path:p});
 if(req.method!=='GET'){routeErrors.push(req.method+' '+p);res.writeHead(405);return res.end();}
 if(p==='/runner.html'){res.writeHead(200,{'content-type':'text/html'});return res.end('<!doctype html><meta charset="utf-8"><script src="/engine-core.js"></script><script src="/runner.js"></script>');}
 if(p==='/engine-core.js'){res.writeHead(200,{'content-type':'application/javascript'});return res.end(fs.readFileSync(root+'/engine-core.js'));}
 if(p==='/runner.js'){res.writeHead(200,{'content-type':'application/javascript'});return res.end(runner());}
 const d=dailyFixture();d.daily.tasks.hunt_start_500.score=count;d.daily.tasks.fishing_catch_50.score=153;
 if(p==='/game/time'&&holdTime)await new Promise(resolve=>{releaseTime=resolve});
 if(p==='/game/daily-quests'&&failDaily){res.writeHead(503,{'content-type':'application/json'});return res.end('{}');}
 const body=p==='/game/time'?d.clock:p==='/game/daily-quests'?d.daily:p==='/game/fishing/state'?{revision:437460,target:{type:'old_box',hp:813,maxHp:2000}}:null;
 if(!body){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));
});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+4000;while(Date.now()<end){if(await fn())return;await delay(20)}throw Error('fixture condition timed out')}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port+'/runner.html';
 const load=()=>page.goto(url);
 try{
  await load();const before=requests.length;let s=await page.evaluate(()=>Fixture.map());
  assert.equal(s.maps,1);assert.equal(s.active,true);assert.equal(s.storedActive,true);assert.equal(s.current,true);assert.equal(s.count,1000);assert.equal(s.fish,153);
  assert.deepEqual(requests.slice(before).filter(x=>x.path.startsWith('/game/')).map(x=>x.path),['/game/fishing/state','/game/time','/game/daily-quests']);
  proof.push({case:'native GET→dailyServerChange→map; stored fish retained',pass:true,state:s});console.log('PASS native GET/JSON sync permits map and retains fish');
  count=36000;await load();s=await page.evaluate(()=>Fixture.map());assert.equal(s.maps,0);assert.equal(s.count,36000);assert.equal(s.current,true);assert.equal(s.active,true);
  proof.push({case:'server cap blocks map',pass:true,state:s});console.log('PASS server cap36000 blocks map');
  count=1000;await load();await page.evaluate(()=>Fixture.change('pending'));const at=requests.length;s=await page.evaluate(()=>Fixture.map());assert.equal(s.maps,0);assert.equal(s.current,false);assert.equal(requests.slice(at).filter(x=>x.path.startsWith('/game/')).length,0);
  proof.push({case:'pending cast blocks sync',pass:true,state:s});console.log('PASS pending cast blocks sync/map');
  await load();holdTime=true;const pending=page.evaluate(()=>Fixture.map());await until(()=>!!releaseTime);await page.evaluate(()=>Fixture.change('stop'));releaseTime();holdTime=false;s=await pending;assert.equal(s.maps,0);assert.equal(s.current,false);assert.equal(s.storedCheck,null);assert.equal(s.calls,0);
  proof.push({case:'Stop rejects delayed native response',pass:true,state:s});console.log('PASS Stop rejects delayed response');
  await load();failDaily=true;s=await page.evaluate(()=>Fixture.map());assert.equal(s.maps,0);assert.equal(s.current,false);assert.equal(s.active,true);failDaily=false;
  proof.push({case:'daily503 keeps farm closed',pass:true,state:s});console.log('PASS daily503 keeps map closed');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);
  const report={browser:browser.version(),kind:'exact content functions + pure background dailyServerChange; controlled actor/IPC/map; native fetch on local HTTP',contentSha256:createHash('sha256').update(source).digest('hex'),liveGame:false,proof,postRequests:requests.filter(x=>x.method==='POST').length,pageErrors:errors,routeErrors};
  if(process.env.FISH_RESUME_BROWSER_REPORT)fs.writeFileSync(path.resolve(process.env.FISH_RESUME_BROWSER_REPORT),JSON.stringify(report,null,2)+'\n');console.log('RESULT',JSON.stringify(report));
 }finally{releaseTime?.();await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1});
