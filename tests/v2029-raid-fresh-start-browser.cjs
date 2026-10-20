'use strict';
// Actual MV3/popup/background/content. All game responses are local; no bot function is replaced.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.env.L2_REPO||path.join(__dirname,'..'));
const {harness,until,delay}=require(path.join(root,'tests/v1014-core-lifecycle-browser.cjs'));
const oldId='l2dop_rb_29095',ids=['l2dop_rb_25001','l2dop_rb_25002','l2dop_rb_25003'];
const character=()=>({name:'AuditHero',revision:10,level:75,l2Profession:'human_warlock',classSlots:{activeSlot:0},adena:30000000,hp:10000,maxHp:10000,mp:1000,maxMp:1000,inBattle:false,locationType:'map',inventory:{eq:{},stacks:[]}});
function html(mode,raid){
 return `<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">75</div><div id="character-profession">Human Warlock</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">10000</span><span id="l2-hud-hp-max">10000</span><span id="l2-hud-mp-cur">1000</span><span id="l2-hud-mp-max">1000</span><div id="map-mob-list"></div>${raid?'<div id="rb-pager-ind"></div><div id="rb-list"></div><div id="rb-load-err"></div>':''}<script>
 localStorage.setItem('token','fixture');
 (async()=>{while(!window.__l2botHook)await new Promise(r=>setTimeout(r,20));await fetch('/character');})();
 const ids=${JSON.stringify(mode==='cached'?[oldId]:ids)},mode=${JSON.stringify(mode)};
 function render(page){
  const list=document.getElementById('rb-list'),pager=document.getElementById('rb-pager-ind');
  if(!list)return;
  if(mode==='empty'){document.getElementById('rb-load-err').textContent='Service unavailable';return;}
  list.innerHTML='<div class="l2-rb-row"><span class="l2-rb-row__label">Fresh '+page+'</span><span class="l2-rb-row__level">65</span><span class="l2-rb-row__status">Убит</span><span class="l2-rb-row__price">100000 аден</span><button class="l2-rb-row__tp" data-spawn-id="'+ids[page-1]+'">Телепорт</button></div>';
  list.querySelector('button').onclick=()=>fetch('/game/raid-boss/teleport',{method:'POST',body:JSON.stringify({spawnId:ids[page-1]})});
  pager.innerHTML=(mode==='cached'?[1]:[1,2,3]).map(n=>'<button '+(n===page?'disabled aria-current="page"':'')+'>'+n+'</button>').join('');
  for(const b of pager.querySelectorAll('button'))b.onclick=async()=>{const next=+b.textContent;const r=await fetch('/game/raid-bosses?page='+next);if(r.ok)render(next);else document.getElementById('rb-load-err').textContent='Service unavailable';};
 }
 render(1);
 </script>`;
}
async function scenario(mode){
 const h=await harness(),requests=[],started=Date.now();let releaseFirst,releaseSecond,firstHeld=false,secondHeld=false,startClicked=false;
 const firstGate=new Promise(r=>releaseFirst=r),secondGate=new Promise(r=>releaseSecond=r);
 try{
  await h.ctx.route('https://l2wap.com/**',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;requests.push({path:p,query:url.search,method:req.method()});
   if(p==='/game/time'||p==='/game/daily-quests')return route.fallback();
   if(p==='/character')return route.fulfill({json:{character:character()}});
   if(p==='/rb-bosses.html'){
    if(!startClicked)return route.fulfill({contentType:'text/html; charset=utf-8',body:html('cached',true)});
    firstHeld=true;await firstGate;return route.fulfill({contentType:'text/html; charset=utf-8',body:html(mode,true)}).catch(()=>{});
   }
   if(p==='/game/raid-bosses'){
    if(url.searchParams.get('page')==='2'){secondHeld=true;await secondGate;}
    return route.fulfill({status:mode==='partial'?503:200,json:mode==='partial'?{error:'temporary'}:{ok:true}}).catch(()=>{});
   }
   if(p.endsWith('.html'))return route.fulfill({contentType:'text/html; charset=utf-8',body:html(mode,false)});
   return route.fulfill({json:{}});
  });
  await h.sw.evaluate(async({oldId,mode})=>{
   const {cfg,rt}=await chrome.storage.local.get(['cfg','rt']),now=Date.now();
   const old={name:'Cached Gordon',lvl:80,alive:true,price:100000,unit:'аден',page:3,t:now};
   await chrome.storage.local.set({on:false,cfg:{...cfg,taskOnly:false,autoTasks:['raid','fish'],dailyKillLimit:0,dailyFishLimit:0,limitRanges:{},rbFaFull:false,rbValueTour:true,rbOrder:'up',rbMaxBelow:12,rbMaxAbove:12,rbTimers:false,rbProbe:false,tvtOn:false,petFullAuto:false,petAuto:false,petBuffAuto:false,townBuffSet:'off',faBuffs:'',nBuffs:'',nKeyBuffs:'',shopAuto:false,autoRoles:false,autoMagister:false,autoShots:false,potSlotAuto:false,reactMin:0,reactMax:0},
    rt:{...rt,dailyStart:7,manualKickAt:12,classCur:{prof:'human_warlock',slot:0},rbList:{[oldId]:old},rbListT:now,rbListVerifiedAt:now,rbListIncomplete:false,rbListReadStart:'old-run',rbListStartRequired:'old-run',rbListStartSeq:0,rbTourView:{ready:[{id:oldId,...old}]},rbListVerifyNextAt:now+180000,rbFishWait:{at:now-1000,until:now+300000},rbHuntIdle:now+300000,rbHunt:{step:'pick',phase:'wait'},rbGo:mode==='partial'?{id:oldId,...old}:null,rbRefuse:null,rbScan:null,rbSess:null,actionPayments:null}});
   globalThis.raidStartWrites=[];
   chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.rt)globalThis.raidStartWrites.push({on:changes.on?.newValue,rt:changes.rt.newValue});});
  },{oldId,mode});
  if(mode==='staleDOM'){
   await h.g.p.goto('https://l2wap.com/rb-bosses.html?page=1');
   assert.equal(await h.g.p.locator('.l2-rb-row__tp').getAttribute('data-spawn-id'),oldId,'до Start в DOM только старый кэш');
  }else await h.g.p.reload();
  await until(()=>h.g.core('!!L2V7Modules.raid && !on'));
  await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#start')?.onclick));
  startClicked=true;await h.click('start');
  const atomic=await until(()=>h.sw.evaluate(()=>globalThis.raidStartWrites.find(x=>x.on===true)));
  assert.equal(atomic.rt.dailyStart,8);assert.deepEqual(atomic.rt.rbList,{},'Start atomically discards the cached list');
  assert.equal(atomic.rt.rbListT,0);assert.equal(atomic.rt.rbListVerifiedAt,0);assert.equal(atomic.rt.rbListReadStart,null);assert.equal(atomic.rt.rbListIncomplete,true);
  assert.equal(atomic.rt.rbFishWait,null);assert.equal(atomic.rt.rbTourView,null);assert.equal(atomic.rt.rbListVerifyNextAt,0);
  assert.equal(atomic.rt.rbListStartSeq,1);assert.equal(atomic.rt.rbListStartRequired,`${atomic.rt.dailyStart}:${atomic.rt.manualKickAt||0}:${atomic.rt.rbListStartSeq}`);
  await until(()=>firstHeld,20000);
  const pages=requests.filter(r=>r.path==='/rb-bosses.html');assert.equal(pages[0].query,'?page=1','fresh scan starts at native page 1, not cached page 3');
  if(mode==='staleDOM')assert.equal(pages.length,2,'Start на первой странице делает новый GET, не подтверждает старый DOM');
  assert.equal((await h.get('rt')).rt.rbListReadStart,null);assert.equal(requests.some(r=>r.method==='POST'),false);
  releaseFirst();
  if(mode!=='empty'){
   await until(()=>secondHeld,20000);
   const pending=(await h.get('rt')).rt;
   assert.equal(pending.rbListReadStart,null,'first page cannot certify a complete scan');assert.equal(pending.rbListVerifiedAt,0);
   assert.ok(!pending.rbHunt?.id,'no target selected before the full list');assert.equal(requests.some(r=>r.method==='POST'),false);
   releaseSecond();
  }
  if(mode==='complete'||mode==='staleDOM'){
   const rt=await until(async()=>{const r=(await h.get('rt')).rt;return r.rbListReadStart===atomic.rt.rbListStartRequired&&r.rbListVerifiedAt>0&&r;},20000);
   assert.deepEqual(Object.keys(rt.rbList).sort(),ids.slice().sort());assert.equal(rt.rbListIncomplete,false);assert.equal(rt.rbListT,rt.rbListVerifiedAt);
   assert.ok(rt.rbListT>=started);assert.deepEqual(ids.map(id=>rt.rbList[id].page),[1,2,3]);assert.equal(rt.rbList[oldId],undefined);
   assert.deepEqual(requests.filter(r=>r.path==='/game/raid-bosses').map(r=>r.query),['?page=2','?page=3']);
  }else{
   const rt=await until(async()=>{const r=(await h.get('rt')).rt;return r.rbListVerifyNextAt>Date.now()&&r;},25000);
   assert.equal(rt.rbListReadStart,null);assert.equal(rt.rbListVerifiedAt,0);assert.equal(rt.rbListIncomplete,true);
   assert.ok(!rt.rbHunt?.id,'partial/error response cannot select a target');assert.equal(rt.rbList[oldId],undefined);
   assert.ok(rt.rbListVerifyNextAt-Date.now()<=180000,'retry is bounded');
   await delay(1200);assert.ok(!((await h.get('rt')).rt.rbHunt?.id));
  }
  assert.equal(requests.some(r=>r.method==='POST'),false,'no game action before fresh verification or after incomplete/error read');assert.deepEqual(h.errors,[]);
  console.log('PASS actual MV3 raid fresh Start '+mode+': atomic reset, page1, '+(mode==='complete'||mode==='staleDOM'?'native pages1→2→3 verified':'unverified list stays blocked')+', 0 POST, '+(Date.now()-started)+'ms');
 }catch(error){console.error('DIAG',JSON.stringify({mode,requests,state:await h.get(['on','rt']).catch(()=>null),errors:h.errors}));throw error;}
 finally{releaseFirst();releaseSecond();await h.ctx.close();}
}
(async()=>{for(const mode of ['complete','partial','empty','staleDOM'])await scenario(mode);})().catch(error=>{console.error(error.stack);process.exitCode=1});
