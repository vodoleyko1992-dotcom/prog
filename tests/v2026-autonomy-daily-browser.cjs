'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const {harness,until,delay}=require(root+'/tests/v1014-core-lifecycle-browser.cjs');
const dailyFixture=require(root+'/tests/tools/daily-server-fixture.cjs');
const E=require(root+'/engine-core.js');
const currentFixture=dailyFixture(),currentDay=currentFixture.clock.gameDayKey.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
// Вычитаем календарные дни из серверного dayKey, независимо от локальной зоны/DST.
const oldDate=new Date(currentDay+'T12:00:00Z');oldDate.setUTCDate(oldDate.getUTCDate()-3);
const oldFixture=dailyFixture(oldDate.getTime()),oldDay=oldDate.toISOString().slice(0,10),dailyStart=7;
assert.equal(oldFixture.clock.gameDayKey,oldDay.replaceAll('-',''));
const oldClock=E.serverClockNote(oldFixture.clock,oldDate.getTime());assert.ok(oldClock);
const source=fs.readFileSync(root+'/tests/v2017-fishing-reload-browser.cjs','utf8'),htmlBox={};
vm.runInNewContext(source.slice(source.indexOf('const HTML='),source.indexOf('async function scenario('))+';this.html=HTML;',htmlBox);
(async()=>{const h=await harness({withPopup:false});let down=true,revision=64042,accepted=0,dailyGets=0,timeGets=0,bait=100;const requests=[],casts=[];
 const character=()=>({name:'AuditHero',id:'independent-fisher',level:75,l2Profession:'human_warlock',revision,hp:16000,maxHp:16000,mp:6000,maxMp:6000,adena:1000000,inventory:{stacks:[],eq:{}},activeBuffs:[]});
 const fishing=()=>({revision,target:null,serverNowMs:Date.now(),logTail:accepted?[{kind:'no_bite',text:'Рыба не клюнула.'}]:[],fishingTime:{remainingMs:20203399,canFish:true},basicBait:{quantity:bait}});
 try{
  await h.ctx.route('https://l2wap.com/**',async r=>{
   const p=new URL(r.request().url()).pathname;requests.push({path:p,method:r.request().method()});
   const json=(body,status=200)=>r.fulfill({status,json:body});
   if(p==='/game/time'){timeGets++;return json(currentFixture.clock)}
   if(p==='/game/daily-quests'){dailyGets++;return down?json({error:'independent_daily_unavailable'},503):json(currentFixture.daily)}
   if(p==='/fishing.html')return r.fulfill({contentType:'text/html',body:htmlBox.html});
   if(p==='/character')return json({character:character()});
   if(p==='/game/fishing/state')return json(fishing());
   if(p==='/game/fishing/action'){
    const b=r.request().postDataJSON();casts.push(b);assert.equal(b.action,'cast');assert.equal(down,false,'no harvest while daily API unavailable');assert.equal(b.expectedRevision,revision);accepted++;revision++;bait--;
    return json({revision,fishing:fishing(),character:character()});
   }
   if(r.request().method()==='POST')throw Error('unexpected POST '+p);
   return r.fallback();
  });
  // Сохранённое ON читается новым игровым документом после трёх дней простоя.
  await h.g.p.goto('about:blank');
  await h.sw.evaluate(async({oldDay,oldClock,dailyStart})=>{const{cfg,rt}=await chrome.storage.local.get(['cfg','rt']);await chrome.storage.local.set({on:true,cfg:{...cfg,autoTasks:['fish'],fishMode:false,fishAutoSetup:false,fishTimeAuto:false,fishAutoBuy:false,fishRodBuy:false,fishProcess:false,fishShots:false,fishBait:'basic',fishMaxCasts:1,rodEnchantTo:0,dailyFishLimit:1,dailyKillLimit:0,limitRanges:{},rec:false,netLog:false,reactMin:0,reactMax:0},rt:{...rt,char:'AuditHero',rodLvl:10,fishSetupDone:Date.now(),fishCastPending:null,fishCastActive:false,fish:null,serverClock:oldClock,dailyStart,dailyQuota:{basis:'server',day:oldDay,fish:1,auto:0,cat:0,raid:0},dailyServerCheck:{day:oldDay,char:'AuditHero',start:dailyStart,t:oldClock.at}}})},{oldDay,oldClock,dailyStart});
  const seeded=(await h.get(['rt'])).rt;
  assert.equal(seeded.dailyQuota.day,oldDay);assert.equal(seeded.dailyQuota.fish,1);assert.equal(seeded.dailyServerCheck.day,oldDay);
  await h.g.p.goto('https://l2wap.com/fishing.html');
  await until(()=>h.g.core('typeof dailyWorkReady==="function"'));
  await until(()=>dailyGets>0);await delay(1500);
  assert.equal(accepted,0);assert.equal(casts.length,0);assert.equal((await h.get(['on'])).on,true);
  assert.equal((await h.get(['rt'])).rt.dailyServerCheck.day,oldDay,'API failure must not claim a fresh daily check');
  console.log('PASS actual missed-start after 3 server days + daily503: old exhausted quota/check seeded; no cast, bot remains ON',JSON.stringify({oldDay,currentDay}));
  const n=dailyGets;await h.g.p.reload();await until(()=>dailyGets>n);await delay(1000);
  assert.equal(casts.length,0);assert.equal((await h.get(['on'])).on,true);
  assert.equal((await h.get(['rt'])).rt.dailyServerCheck.day,oldDay,'reload must retain the last confirmed check');
  console.log('PASS actual reload during daily503: no extra action and automatic retry');
  down=false;await until(()=>accepted===1,30000);await until(async()=>{const{rt}=await h.get(['rt']);return rt.fish?.casts===1&&!rt.fishCastPending},30000);await delay(1000);
  assert.equal(accepted,1);assert.equal(casts.length,1);assert.equal(bait,99);assert.deepEqual(h.errors,[]);
  const final=(await h.get(['rt'])).rt;
  assert.equal(final.dailyStart,dailyStart,'no explicit Start between old and recovered daily cycles');
  assert.equal(final.dailyServerCheck.day,currentDay);assert.equal(final.dailyServerCheck.start,dailyStart);
  assert.equal(final.dailyQuota.day,currentDay);assert.equal(final.dailyQuota.basis,'server');
  assert.equal(final.dailyQuota.fish,0,'old caught-fish quota resets; a no-bite cast is not a caught fish');
  assert.equal(final.fish.casts,1);assert.ok(final.dailyServerCheck.t>oldClock.at);
  assert.ok(requests.filter(x=>x.method==='POST').every(x=>x.path==='/game/fishing/action'));
  console.log('PASS actual API recovery after missed days without Start: exactly1 confirmed cast; new daily stamp/count persisted',JSON.stringify({dailyGets,timeGets,accepted,bait,oldDay,newDay:final.dailyServerCheck.day,dailyFish:final.dailyQuota.fish,casts:final.fish.casts,dailyStart:final.dailyStart}));
  await h.g.core('automationStop("Конец независимого локального теста", "stop", {user:true})');
 }catch(e){console.error('DIAG',JSON.stringify({down,revision,accepted,dailyGets,timeGets,casts,core:await h.g.core('({on,running,tabOwner,status:rt.status,quota:rt.dailyQuota,check:rt.dailyServerCheck,pending:rt.fishCastPending,fish:rt.fish})').catch(()=>null)}));throw e}
 finally{await h.ctx.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
