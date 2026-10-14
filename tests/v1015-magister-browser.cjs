'use strict';
// Настоящие публичные HTML/JS v117bf8f3cf33. Вся сеть закрыта route-all, данные и POST только локальные.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/workspace/.local/l2tools/node_modules/playwright');
const root=path.join(__dirname,'..'),sources={};
const read=n=>{if(n==='magister-block.js'){const c=fs.readFileSync(path.join(root,'content.js'),'utf8'),a=c.indexOf('const MAG_SKIP_DEF =');return c.slice(a,c.indexOf('// ---------- выбило из игры:',a));}return sources[n];};
async function loadPublic(){
 await Promise.all(['magister.html','magisters.html','magister.js','magisters.js'].map(async name=>{
  if(process.env.L2_MAGISTER_PUBLIC){sources[name]=fs.readFileSync(path.join(process.env.L2_MAGISTER_PUBLIC,name),'utf8');return;}
  const r=await fetch('https://l2wap.com/'+name,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(name+': HTTP '+r.status);sources[name]=await r.text();
 }));
}
const clean=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
(async()=>{
 await loadPublic();
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM});
 async function fixture({hub=false,status=200,blocked=false,rank=0,max=2,level=75,sp=1000}={}){
  const ctx=await browser.newContext(),page=await ctx.newPage(),name=hub?'magisters':'magister';
  await page.route('**/*',r=>new URL(r.request().url()).pathname==='/'+name+'.html'?r.fulfill({status:200,contentType:'text/html',body:clean(read(name+'.html'))}):r.abort());
  await page.goto('https://l2wap.com/'+name+'.html?npcId=30344');
  await page.evaluate(opt=>{
   window.audit={calls:[],status:opt.status,resyncs:0,snapshot:{name:'hero',l2Profession:'human_warlock',classSlots:{activeSlot:0},revision:7,sp:opt.sp,level:opt.level,learnedBattleSkillsDetail:[{battleId:'l2_1230',level:opt.rank}]},rank:opt.rank,max:opt.max};
   const A=window.audit,clone=o=>JSON.parse(JSON.stringify(o));
   const catalog=()=>({profession:{l2Profession:'human_warlock'},npc:{npcId:30344,titleUk:'Гільдія магів · Test City'},characterSp:A.snapshot.sp,skills:[{battleId:'l2_1230',l2SkillId:1230,nameUk:'Blaze',minLevel:74,spCost:100,skillLevel:A.rank,maxSkillLevel:A.max,kind:'active',canLearn:!opt.blocked&&A.rank<A.max&&A.snapshot.sp>=100&&opt.level>=74,learnedMax:A.rank>=A.max,canLearnBlockReasonUk:'Недостатньо умов'}]});
   window.L2={token:()=> 'fixture',getUiLang:()=> 'uk',lastSnapshot:()=>A.snapshot,applyMutationSnapshot:s=>{if(s)A.snapshot=s},
    resyncCharacterWhenRequired:async()=>A.snapshot,resyncCharacterAfterConflict:async()=>{A.resyncs++},playerMessageOr:(j,f)=>j.message||f,
    authFetch:async(url,init={})=>{A.calls.push({url,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});
     if(url==='/character')return {ok:true,status:200,json:async()=>({character:clone(A.snapshot)})};
     if(url==='/character/town')return {ok:true,status:200,json:async()=>({npcs:[{actions:[{labelUk:'Квест',href:'/quest.html'}]},{actions:[{labelUk:'Вивчити',href:'/magister.html?npcId=30344'}]}]})};
     if(url.startsWith('/character/magister'))return {ok:true,status:200,json:async()=>catalog()};
     if(url==='/character/skills/learn'){if(A.status===200){A.rank++;A.snapshot={...A.snapshot,revision:A.snapshot.revision+1,sp:A.snapshot.sp-100,learnedBattleSkillsDetail:[{battleId:'l2_1230',level:A.rank}]};}
      return {ok:A.status===200,status:A.status,json:async()=>A.status===200?{character:clone(A.snapshot)}:{error:'revision_conflict'}};}
     throw Error('unexpected fixture API '+url);
    }};
  },{hub,status,blocked,rank,max,level,sp});
  await page.addScriptTag({content:read(name+'.js')});
  await page.waitForFunction(h=>document.querySelector(h?'#magisters-npc-list a':'#magister-list li'),hub);
  return {ctx,page,close:()=>ctx.close()};
 }
 const cases=[];function test(n,f){cases.push([n,f]);}
 test('hub показывает только учителя с реальным href и отдельный learned-only link',async()=>{const f=await fixture({hub:true});const hrefs=await f.page.locator('#magisters-npc-list a').evaluateAll(es=>es.map(e=>e.getAttribute('href')));assert.deepEqual(hrefs,['/magister.html?npcId=30344','/magister.html?npcId=30344&mode=learned']);await f.close();});
 test('learn передаёт battleId+revision; подтверждённый rank/SP обновляются и каталог перечитывается',async()=>{const f=await fixture();await f.page.locator('.l2-magister-skill-card__learn-link').click();await f.page.waitForFunction(()=>document.querySelector('.l2-magister-meta__rank-current')?.textContent==='1');const a=await f.page.evaluate(()=>audit);assert.deepEqual(a.calls.find(x=>x.method==='POST').body,{battleId:'l2_1230',expectedRevision:7});assert.equal(a.snapshot.sp,900);assert.equal(a.calls.filter(x=>x.url.startsWith('/character/magister')).length,2);await f.close();});
 test('двойной синхронный click не отправляет две мутации',async()=>{const f=await fixture();await f.page.evaluate(()=>{const b=document.querySelector('.l2-magister-skill-card__learn-link');b.click();b.click()});await f.page.waitForFunction(()=>audit.rank===1);assert.equal(await f.page.evaluate(()=>audit.calls.filter(x=>x.method==='POST').length),1);await f.close();});
 test('409 синхронизирует/перечитывает, не повторяет POST автоматически',async()=>{const f=await fixture({status:409});await f.page.locator('.l2-magister-skill-card__learn-link').click();await f.page.waitForFunction(()=>audit.resyncs===1&&audit.calls.filter(x=>x.url.startsWith('/character/magister')).length===2);const a=await f.page.evaluate(()=>audit);assert.equal(a.calls.filter(x=>x.method==='POST').length,1);assert.equal(a.rank,0);assert.equal(a.snapshot.sp,1000);await f.close();});
 test('blocked / недостаток SP / уровень ниже условия не предоставляют рабочую learn кнопку',async()=>{for(const opt of [{blocked:true},{sp:99},{level:73}]){const f=await fixture(opt);assert.equal(await f.page.locator('.l2-magister-skill-card__learn-link').isDisabled(),true);assert.equal(await f.page.evaluate(()=>audit.calls.filter(x=>x.method==='POST').length),0);await f.close();}});
 test('максимальный ранг отображается без кнопки повторной оплаты',async()=>{const f=await fixture({rank:2,max:2});assert.equal(await f.page.locator('.l2-magister-skill-card__learn-link').count(),0);assert.match(await f.page.locator('.l2-magister-skill-card__status-msg--max').innerText(),/Максималь/);await f.close();});

 async function attachBot(f){
  await f.page.evaluate(()=>{
   window.cfg={autoMagister:true};window.rt={char:'hero',lvl:75,classCur:{prof:'human_warlock',slot:0},panel:[{name:'Blaze'}],magEnabled:true,magister:{t:1,char:'hero',key:'0:human_warlock',prof:'human_warlock',slot:0,lvl:75,kick:0,home:{mode:'auto'}}};
   window.on=true;window.tabOwner=true;window.heroNick=()=>rt.char;window.heroLevel=()=>75;window.autonomyMode=()=>'auto';window.fishNow=()=>false;window.isBattle=()=>false;window.victory=()=>false;
   window.abHold=()=>!!rt.abChal;window.antibotState=()=>rt.abChal?'check':null;window.names=s=>String(s).toLowerCase().split(',').map(x=>x.trim());window.ilOf=()=>({c:'Маг. атака'});window.petState=()=>null;
   window.L2V7Modules={story:{charNote(){}},subclass:{charNote(){}},tvt:{tvtHold:()=>false}};
   window.setRt=async p=>{Object.assign(rt,p);return {ok:true}};window.rtCommit=async()=>true;window.rec=()=>{};window.setStatus=()=>{};
   window.gameGet=p=>L2.authFetch(p);window.gamePost=(p,b)=>L2.authFetch(p,{method:'POST',body:JSON.stringify(b)});
  });
  await f.page.addScriptTag({content:read('magister-block.js')});
  // Return/navigation is covered by independent actual combat-chain harness; retain this real public DOM for assertions.
  await f.page.evaluate(()=>{window.magBack=async M=>{audit.returned=true;rt.magister=null}});
 }
 test('новый bot helper на actual public guild учит оба ранга с последовательной ревизией',async()=>{const f=await fixture();await attachBot(f);await f.page.evaluate(()=>magisterStep());const a=await f.page.evaluate(()=>({a:audit,rt}));assert.deepEqual(a.a.calls.filter(x=>x.method==='POST').map(x=>x.body.expectedRevision),[7,8]);assert.equal(a.a.rank,2);assert.equal(a.a.snapshot.sp,800);assert.equal(a.rt.magChecked['0:human_warlock'].lvl,75);assert.equal(a.a.returned,true);await f.close()});
 test('новый helper actual public API 409 не повторяет POST и не маркирует уровень',async()=>{const f=await fixture({status:409});await attachBot(f);await f.page.evaluate(()=>magisterStep());const a=await f.page.evaluate(()=>({a:audit,rt}));assert.equal(a.a.calls.filter(x=>x.method==='POST').length,1);assert.equal(a.a.rank,0);assert.equal(a.rt.magChecked,undefined);await f.close()});
 test('проверка активности до запроса оставляет public guild без платных действий',async()=>{const f=await fixture();await attachBot(f);await f.page.evaluate(async()=>{rt.abChal={t:1};await magisterStep()});assert.equal(await f.page.evaluate(()=>audit.calls.filter(x=>x.method==='POST').length),0);await f.close()});
 let fails=0;for(const[n,f]of cases){try{await f();console.log('PASS',n)}catch(e){fails++;console.error('FAIL',n,e.message)}}await browser.close();if(fails)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
