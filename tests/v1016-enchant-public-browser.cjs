'use strict';
// 15.10: выполнение серии требует явно выбранного отдельного режима заточки.
// Реальные freshly fetched enchant.js/client/policy/meta и их DOM/submit handler; сервер — локальный mock, без аккаунта и расходов.
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),modulePath=fs.existsSync(path.join(root,'modules/enchant.js'))?path.join(root,'modules/enchant.js'):path.join(root,'enchant.js');
const pub=process.env.L2_ENCHANT_PUBLIC||fs.mkdtempSync(path.join(os.tmpdir(),'l2bot-enchant-public-'));
async function downloadPublic(){
 if(!process.env.L2_ENCHANT_PUBLIC)await Promise.all(['enchant.html','enchant.js','l2-enchant-client.js','l2-enchant-policy.js','enchant-scroll-meta.js','enchant-render-categories.js','enchant-weapon-mode-ui.js'].map(async name=>{
  const r=await fetch('https://l2wap.com/'+name,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('public '+name+' HTTP '+r.status);fs.writeFileSync(path.join(pub,name),await r.text());
 }));
 console.log('PUBLIC '+(process.env.L2_ENCHANT_PUBLIC?'explicit cache ':'current TLS ')+pub+'; enchant.js SHA256 '+crypto.createHash('sha256').update(fs.readFileSync(path.join(pub,'enchant.js'))).digest('hex'));
}
async function boot(browser,{target='eq:l1',category='weapon',policy='blessed',level=3,outcomes=[true,true],multi=false}={}) {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync(path.join(pub,'enchant.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto('https://enchant.fixture/enchant.html?target='+encodeURIComponent(target)+'&mode=magic');
 await page.evaluate(({target,category,level,outcomes,multi})=>{
  const id=category==='weapon'?8688:2376,slot=category==='weapon'?'rhand':'chest';
  window.F={posts:[],tasks:[],outcomes,errors:[],hints:{itemSlotHints:{8688:'rhand',2376:'chest'},itemGradeHints:{8688:'A',2376:'B'},itemNamesEn:{8688:'Daimon Crystal',2376:'Avadon Breastplate'}},
   snap:{revision:20,adena:1000000,inventory:{eq:{},stacks:[{itemId:910517,qty:20},{itemId:910527,qty:20},{itemId:910514,qty:20},{itemId:910524,qty:20},{itemId:4037,qty:99}]}}};
  const row={itemId:id,enchant:level,enchantPAtkBonus:0,enchantMAtkBonus:category==='weapon'?level*6:0,qty:1,weaponEnchantHistory:category==='weapon'?Array(level).fill('magic'):[]};
  if(target.startsWith('eq:'))F.snap.inventory.eq[target.slice(3)]=row;else F.snap.inventory.stacks.push(row,{itemId:id,enchant:9,enchantPAtkBonus:0,enchantMAtkBonus:54,qty:1,weaponEnchantHistory:Array(9).fill('magic')});
  if(multi)F.snap.inventory.eq.l3={itemId:2376,enchant:0,qty:1};
  window.L2={itemSlotById:F.hints.itemSlotHints,itemGradeById:F.hints.itemGradeHints,itemNameById:F.hints.itemNamesEn,itemStatsById:{8688:{weaponMode:'magic',weaponType:'bigblunt'}},
   resolveCatalogItemName:id=>F.hints.itemNamesEn[id]||'#'+id,clampPersistedEnchant:n=>Math.max(0,Math.floor(+n||0)),maxEnchantForItemId:()=>25,effectiveEnchantBatchMax:(id,en,q)=>Math.min(25-en,q,100),
   nextWeaponSuccessBonusPreview:()=>({enchantPAtkBonus:0,enchantMAtkBonus:6}),applyHudFromSnapshot(){},fetchCatalogHints:async()=>true,resyncCharacterWhenRequired:async()=>F.snap,
   lastSnapshot:()=>F.snap,applyMutationSnapshot:s=>F.snap=s,token:()=> 'local-fixture-only',playerMessageOr:(j,f)=>j.messageUk||f,
   authFetch:async(url,opt)=>{
    if(url!=='/game/inventory/enchant')throw Error('unexpected path '+url);
    const req=JSON.parse(opt.body);F.posts.push(req);const resolved=L2.resolveSelectedEnchantTarget(F.snap,req.targetInstanceId);if(!resolved)throw Error('exact target not found');
    const row=resolved.source==='eq'?F.snap.inventory.eq[resolved.slotKey]:F.snap.inventory.stacks[resolved.bagIndex];
    const before=row.enchant,ok=F.outcomes.length?F.outcomes.shift():true;row.enchant=ok?before+1:Math.max(0,before-1);
    if(L2.itemSlotById[row.itemId]==='rhand'){row.enchantMAtkBonus=row.enchant*6;if(ok)row.weaponEnchantHistory.push(req.weaponEnchantMode);else row.weaponEnchantHistory.pop();}
    F.snap.inventory.stacks.find(s=>s.itemId===req.scrollItemId).qty--;F.snap.revision++;
    const updated=resolved.source==='eq'?req.targetInstanceId:L2.mkBagEnchantTargetId(row.itemId,row.enchant,row);
    const res={character:structuredClone(F.snap),attemptedCount:1,successCount:+ok,failCount:+!ok,scrollConsumedCount:1,coinConsumed:false,previousEnchantLevel:before,currentEnchantLevel:row.enchant,updatedTargetInstanceId:updated,messageUk:ok?'Заточка вдала':'Заточка не вдалася'};
    if(window.M)F.tasks.push(M.note(req,res,200));return new Response(JSON.stringify(res),{status:200,headers:{'Content-Type':'application/json'}});
   }};
 },{target,category,level,outcomes,multi});
 for(const name of ['l2-enchant-client.js','l2-enchant-policy.js','enchant-scroll-meta.js','enchant-render-categories.js','enchant-weapon-mode-ui.js'])await page.addScriptTag({path:path.join(pub,name)});
 await page.evaluate(()=>L2EnchantClient.install(L2));
 await page.addScriptTag({path:path.join(pub,'enchant.js')});
 await page.waitForSelector('#enchant-submit');
 await page.addScriptTag({path:modulePath});
 await page.evaluate(async({target,policy,multi})=>{
  window.E={cfg:{enchantMode:true,enchant:{enabled:true,queue:[],scrollPolicy:policy,maxAttempts:10,maxScrolls:10,maxConsecutiveFails:5,maxDropFromStart:5,maxDropFromPeak:5,delayMs:500}},rt:{},on:true,tabOwner:true,
    setRt:async p=>{Object.assign(E.rt,p);return {ok:true}},gameGet:async p=>({ok:true,json:async()=>structuredClone(p==='/character'?{character:F.snap}:F.hints)}),awayFree:()=>true,rec(){},setStatus(){},pause:async()=>{},
    $q:s=>document.querySelector(s),waitX:async fn=>{for(let i=0;i<100;i++){const x=fn();if(x)return x;await new Promise(r=>setTimeout(r,10))}return null},fire:el=>{if(!E.on||!E.tabOwner)return false;el.click();return true}};
  window.M=L2V7Factories.enchant(E);const scan=await M.readItems();const item=scan.items.find(i=>i.targetInstanceId===target);if(!item)throw Error('candidate missing '+target);
  E.cfg.enchant.queue=[{...item,key:'chosen',targetLevel:item.level+2,weaponMode:'magic'}];
  if(multi)E.cfg.enchant.queue.push({...scan.items.find(x=>x.targetInstanceId==='eq:l3'),key:'armor',targetLevel:1});
  if(!await M.command('start'))throw Error('start refused');
 },{target,policy,multi});
 return {page,errors,tick:async()=>{await page.evaluate(async()=>{E.rt.enchant.nextAt=0;await M.step();await Promise.all(F.tasks.splice(0))});await page.waitForTimeout(30)}};
}
module.exports={pub,downloadPublic,boot};
if(require.main===module)(async()=>{
 await downloadPublic();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox']});try{
  {const f=await boot(browser);await f.tick();await f.tick();const out=await f.page.evaluate(()=>({posts:F.posts,state:E.rt.enchant,title:document.querySelector('.l2-enchant-selected-card__name').textContent}));assert.equal(out.posts.length,2);assert.ok(out.posts.every(p=>p.count===1&&p.payment==='scroll'&&p.scrollItemId===910527));assert.equal(out.state.status,'done');assert.match(out.title,/\+5/);assert.deepEqual(f.errors,[]);await f.page.close();console.log('PASS actual public DOM: weapon blessed ×2 togoal');}
  {const f=await boot(browser,{target:'eq:l3',category:'armor',policy:'ordinary',outcomes:[false,true]});await f.tick();await f.tick();const o=await f.page.evaluate(()=>({posts:F.posts,state:E.rt.enchant}));assert.equal(o.state.items[0].level,3);assert.equal(o.state.totals.failures,1);assert.equal(o.state.totals.successes,1);assert.ok(o.posts.every(p=>p.scrollItemId===910514&&!('weaponEnchantMode'in p)));assert.deepEqual(f.errors,[]);await f.page.close();console.log('PASS actual public DOM: armor ordinary fail3→2 then success2→3');}
  {const f=await boot(browser,{target:'bag:8688:3:0:18:Hmmm'});await f.tick();await f.tick();const o=await f.page.evaluate(()=>({posts:F.posts,state:E.rt.enchant,stacks:F.snap.inventory.stacks}));assert.equal(o.state.status,'done');assert.equal(o.posts[1].targetInstanceId,'bag:8688:4:0:24:Hmmmm');assert.equal(o.state.items[0].targetInstanceId,'bag:8688:5:0:30:Hmmmmm');assert.equal(o.stacks.filter(x=>x.itemId===8688&&x.enchant===9).length,1);assert.deepEqual(f.errors,[]);await f.page.close();console.log('PASS actual public DOM: bag history instance updates; other duplicate untouched');}
  {const f=await boot(browser,{multi:true});await f.tick();await f.tick();await f.page.evaluate(()=>{L2EnchantPage.refreshFromSnap(F.snap,'eq:l3');M=L2V7Factories.enchant(E)});await f.tick();const o=await f.page.evaluate(()=>({posts:F.posts,state:E.rt.enchant}));assert.equal(o.state.status,'done');assert.deepEqual(o.posts.map(x=>x.targetInstanceId),['eq:l1','eq:l1','eq:l3']);assert.deepEqual(o.posts.map(x=>x.scrollItemId),[910527,910527,910524]);assert.equal(o.state.totals.attempts,3);assert.deepEqual(o.state.items.map(x=>x.level),[5,1]);assert.deepEqual(f.errors,[]);await f.page.close();console.log('PASS actual public DOM: ordered weapon+armor queue preserves aggregate budget across new factory');}
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
