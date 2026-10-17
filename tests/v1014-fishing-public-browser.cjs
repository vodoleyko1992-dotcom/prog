'use strict';
// Публичные HTML/JS загружаются без логина; все игровые API и деньги ниже — синтетический сервер.
// Запуск: NODE_USE_ENV_PROXY=1 node tests/v1014-fishing-public-browser.cjs
const {chromium}=require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const repo=path.join(__dirname,'..'),pub=process.env.L2_FISHING_PUBLIC || fs.mkdtempSync(path.join(os.tmpdir(),'l2bot-fishing-public-'));
async function downloadPublic(){
 const get=async name=>{const r=await fetch('https://l2wap.com/'+name,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('public '+name+' HTTP '+r.status);const b=await r.text();fs.writeFileSync(path.join(pub,name.split('?')[0]),b);return b;};
 if(process.env.L2_FISHING_PUBLIC){console.log('PUBLIC explicit cache '+pub);return;}
 const html=await get('fishing.html');
 const urls=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x=>x[1].slice(1)).filter(x=>/^(?:fishing-|battle-hotbar-cd)/.test(x));
 urls.push('fishing-shop.html','fishing-shop-page.js','char-fishing-cut.js','char-fishing-old-box-open.js','char-fishing-reward-result.js');
 await Promise.all(urls.map(get));console.log('PUBLIC current HTML + '+urls.length+' JS/pages; TLS verified');
}
async function make(options={}){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM || '/opt/pw-browsers/chromium',args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const S=JSON.parse(fs.readFileSync(repo+'/kb/raw/fishing-state.json')).data;Object.assign(S,{revision:100,target:null,logTail:[],serverNowMs:Date.now()});Object.assign(S.basicBait,{quantity:30,selected:true});Object.assign(S.goodBait,{quantity:0,selected:false});Object.assign(S.fishingSoulshot,{quantity:100,enabled:true});S.cooldowns={pumpingMs:500,reelingMs:700,pumpingUntil:0,reelingUntil:0};S.fishingTime.remainingMs=18000000;S.fishingTime.active=false;Object.assign(S,options.state||{});const actions=[];
 await page.route('**/*',async r=>{let url=new URL(r.request().url()),name=path.basename(url.pathname);if(name=== 'fishing.html'||name==='fishing-shop.html'){let html=fs.readFileSync(pub+'/'+name,'utf8');html=html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>/\/(?:fishing-|battle-hotbar-cd)/.test(src)?all:'').replace(/<link\b[^>]*>/g,'');return r.fulfill({contentType:'text/html',body:html});}if(fs.existsSync(pub+'/'+name)&&name.endsWith('.js'))return r.fulfill({contentType:'application/javascript',body:fs.readFileSync(pub+'/'+name)});return r.fulfill({contentType:'text/plain',body:''});});
 await page.addInitScript(({S,options})=>{window.testState=S;window.actions=[];window.options=options;window.L2={whenReady:f=>f(),applyCharacterSnapshot(){},fetchCatalogHints:async()=>{},resyncCharacterAfterConflict:async()=>{},lastSnapshot:()=>({revision:window.testState.revision}),authFetch:async(url,init={})=>{const s=window.testState,body=JSON.parse(init.body||'{}');if(init.method==='POST'){
  window.actions.push({url,...body});if(window.options.delay)await new Promise(r=>setTimeout(r,window.options.delay));
  if(window.options.reject)return new Response(JSON.stringify({error:window.options.reject}),{status:window.options.reject==='revision_conflict'?409:400});
  if(body.expectedRevision!==s.revision)return new Response(JSON.stringify({error:'revision_conflict'}),{status:409});
  s.revision++;s.serverNowMs=Date.now();
  if(body.action==='setFishingSoulshotEnabled')s.fishingSoulshot.enabled=body.enabled;
  if(body.action==='selectBait'){s.basicBait.selected=body.baitItemId===s.basicBait.itemId;s.goodBait.selected=body.baitItemId===s.goodBait.itemId;}
  if(body.action==='selectRod'){let r=s.rods.find(x=>x.targetInstanceId===body.targetInstanceId);s.rods.forEach(x=>x.selected=x===r);s.rod={...r,name:'Вудка'};}
  if(body.action==='buyFishingTime'){const p=s.fishingTime.packages.find(x=>x.key===body.timePackageKey);s.fishingTime.availableAdena-=p.priceAdena;s.fishingTime.remainingMs+=p.durationMs;}
  if(url.includes('exchange-material')){const ex=s.economy.exchanges.find(x=>x.key===body.exchangeKey);ex.ownedQty-=body.amount*ex.requiredQty;ex.maxExchangeCount=Math.floor(ex.ownedQty/ex.requiredQty);s.economy.proofQty+=body.amount*ex.proofReward;}
  if(url.includes('buy-gear')){const gear=s.economy.gearCategories.flatMap(x=>x.items).find(x=>x.key===body.gearKey);s.economy.proofQty-=gear.priceProof;s.starterShop.availableAdena-=gear.priceAdena;}
  if(body.action==='cast'){
   (s.goodBait.selected?s.goodBait:s.basicBait).quantity--;
   if(window.options.noBite){s.logTail=[{text:'Рыба не клюнула.',kind:'no_bite'},{text:'Вы забросили удочку...',kind:'cast'},...s.logTail].slice(0,10);}
   else {s.target={name:'White Fish',currentHp:140,maxHp:140,stateHint:'Рыба замерла — Pumping'};s.logTail=[{text:'Что-то клюнуло!',kind:'bite'},{text:'Вы забросили удочку...',kind:'cast'},...s.logTail].slice(0,10);}
  }
  if(['pumping','reeling'].includes(body.action)){
   if(s.fishingSoulshot.enabled)s.fishingSoulshot.quantity--;
   if(window.options.escape){s.target=null;s.logTail=[{kind:'lost',text:'Рыба сорвалась!'},...s.logTail].slice(0,10);}
   else if(s.target.currentHp>70){s.target.currentHp-=70;s.target.stateHint='Рыба сопротивляется — Reeling';s.logTail=[{kind:'hit',text:'Pumping + Soulshot — 70 урона.'},...s.logTail].slice(0,10);}
   else{s.target=null;s.logTail=[{kind:'catch',text:'Вы вытащили White Fish.',parts:[{text:'Вы вытащили '},{text:'White Fish',tone:'fish_name'}]},{kind:'hit',text:'Reeling + Soulshot — 70 урона.'},...s.logTail].slice(0,10);}
   s.cooldowns[body.action+'Until']=Date.now()+s.cooldowns[body.action+'Ms'];
  }
  if(url.includes('buy-starter')){const offer=s.starterShop.offers.find(x=>x.key===body.offerKey);s.starterShop.availableAdena-=offer.priceAdena*body.amount;if(body.offerKey==='bait_x10')s.basicBait.quantity+=10*body.amount;if(body.offerKey==='soulshot_x50')s.fishingSoulshot.quantity+=50*body.amount;if(body.offerKey==='starter_rod'){s.rods=[{itemId:910600,name:'Fishing Rod',enchant:0,targetInstanceId:'bag:910600:0',selected:false}];}}
  return new Response(JSON.stringify({fishing:s,revision:s.revision}),{status:200});
 }return new Response(JSON.stringify(s),{status:200});}};},{S,options});
 await page.goto('https://fixture.invalid/'+(options.shop?'fishing-shop.html':'fishing.html'));await page.waitForSelector(options.shop?'#fishing-shop-proof-qty':'.l2-fishing-hotbar-slot');await page.addScriptTag({path:repo+'/modules/fishing.js'});
 await page.evaluate(options=>{
 const shown=e=>!!e&&!e.closest('[hidden]');window.recs=[];
 const env={cfg:{fishMode:true,fishAutoSetup:false,fishShots:true,fishBait:'basic',fishAutoBuy:false,fishProcess:false,reactMin:0,reactMax:0,rodEnchantTo:0,...options.cfg},rt:{rodLvl:10,...options.rt},on:true,TAG:'test',FCD:{},NET_FISH:{t:0},fishMut:0,fishCdMsg:0,fishShotsSess:0,fishGearN:0,fishNoResp:0,
 $q:s=>document.querySelector(s),shown,qty:e=>{const s=e?.querySelector('.l2-battle-hotbar-slot-uqty');return s?/\d/.test(s.textContent)?+s.textContent.replace(/\D/g,''):0:null;},cdBusy:()=>false,fire:e=>{if(env.on)e?.click();},rnd:a=>a,sleep:async ms=>new Promise(r=>setTimeout(r,Math.min(ms,20))),waitFor:async(f,ms=5000,step=20)=>{let end=Date.now()+Math.min(ms,options.waitCap||1500);while(env.on&&Date.now()<end){let r=f();if(r)return r;await new Promise(r=>setTimeout(r,Math.min(step,20)));}return null;},
 setRt:async p=>Object.assign(env.rt,p),rtCommit:async()=>true,setStatus:s=>window.statusLog=s,rec:(...a)=>window.recs.push(a.join(' ')),idle:async()=>{},halt:async m=>{window.halted=m;env.on=false;},autonomyMode:()=> 'fish',names:t=>t.split(/[,\n]+/).filter(Boolean),
 ROD_NONE_RE:/не\s*выбран|не\s*обран|не\s*вибран|not\s*selected|без\s*удочк|нет\s*удочк/i,ROD_RE:/удочк|вудк|rod/i,CD_RE:/перезаряд|на откат|cooldown/i,GEAR_RE:/(удочк|наживк).*(нет|выбер)/i,
 isNoBite:l=>!!l&&(/no_bite/.test(l.cls)||/не клюнула/.test(l.t)),isBite:l=>!!l&&/--bite/.test(l.cls),isCast:l=>!!l&&/--cast/.test(l.cls)};env.finishFishGoal=async T=>{env.rt.fishTgt=T.done?T:{...T,done:true,doneT:Date.now()};env.rt.fishService=null;env.cfg.fishMode=false;return true};env.waitX=env.waitFor;window.env=env;window.F=L2V7Factories.fishing(env);
 },options);
 return {page,browser,errors,snapshot:()=>page.evaluate(()=>({actions,rt:env.rt,state:testState,recs,status:window.statusLog,halted:window.halted})),run:fn=>page.evaluate(fn),close:()=>browser.close()};
}
module.exports={make,downloadPublic};
async function publicBag(w,fail=false){
 await w.page.setContent(`<button data-fishing-inventory-tab aria-selected="true">Рибалка</button><div id="char-bag-list"></div><div id="char-bag-pager"></div><div id="char-stub-msg" hidden></div>
 <div id="char-bag-modal-overlay" hidden><span id="char-bag-modal-qty"></span><div id="char-bag-modal-cut-row"><input id="char-bag-modal-cut-qty"><button id="char-bag-modal-cut-max">MAX</button><button id="char-bag-modal-cut">Разрезать</button></div><div id="char-cut-result" hidden></div>
 <div id="char-bag-modal-oldbox-row"><span id="char-oldbox-owned-qty"></span><input id="char-oldbox-open-qty"><button id="char-oldbox-open-max">MAX</button><button id="char-bag-modal-open-oldbox">Открыть</button></div><div id="char-oldbox-open-result" hidden></div><button id="char-bag-modal-close">Закрыть</button></div>`);
 for(const f of ['char-fishing-reward-result.js','char-fishing-cut.js','char-fishing-old-box-open.js'])await w.page.addScriptTag({path:path.join(pub,f)});
 await w.page.evaluate(fail=>{
  let busy=false,modal=null,revision=500;const stacks=[{itemId:910603,qty:1,name:'White Fish'},{itemId:910606,qty:2,name:'Old Box'}];
  const render=()=>{const root=document.querySelector('#char-bag-list');root.innerHTML='';for(const st of stacks.filter(x=>x.qty>0)){const r=document.createElement('div');r.className='l2-char-bag-row';r.dataset.fishingInventoryRow='1';r.dataset.itemJson=JSON.stringify(st);r.innerHTML='<span class="l2-char-bag-name">'+st.name+' ×'+st.qty+'</span>';r.onclick=()=>{modal=st;document.querySelector('#char-bag-modal-overlay').hidden=false;L2CharFishingCut.configureBagModalRow(st.itemId,st.qty);L2CharFishingOldBoxOpen.configureOldBoxModalRow(st.itemId,st.qty);};root.appendChild(r);}};
  const bridge={isMutationInFlight:()=>busy,setMutationInFlight:v=>busy=v,expectedRevisionForMutation:()=>revision,resyncCharacterFromServer:async()=>{},applyCharacterMutation:c=>{revision=c.revision;render();},patchBagModalCtx:(id,qty)=>{if(modal)modal.qty=qty;},getBagModalCtx:()=>modal,bagQtySuffix:(id,n)=>String(n)};
  L2.lastSnapshot=()=>({revision,inventory:{stacks}});L2.playerMessageOr=(j,f)=>f;
  L2.authFetch=async(url,init)=>{const b=JSON.parse(init.body);actions.push({url,...b});if(fail)return new Response(JSON.stringify({error:'revision_conflict'}),{status:409});if(b.expectedRevision!==revision)throw Error('stale revision');revision++;const st=stacks.find(x=>x.itemId===(b.itemId||910606));st.qty-=b.amount;const rewards=b.itemId?[{itemId:910607,name:'Fish Oil',quantity:25},{itemId:910610,name:'Fish Scale',quantity:5}]:[{itemId:910616,name:'Proof of Catching a Fish',quantity:20},{itemId:4037,name:'Coin of Luck',quantity:2}];return new Response(JSON.stringify({character:{revision,inventory:{stacks}},result:b.itemId?{amount:b.amount,fishName:st.name,rewards}:{openedAmount:b.amount,boxName:st.name,rewards}}));};
  L2CharFishingCut.init(bridge);L2CharFishingOldBoxOpen.init(bridge);document.querySelector('#char-bag-modal-close').onclick=()=>{document.querySelector('#char-bag-modal-overlay').hidden=true;L2CharFishingCut.hideCutResultMessage();L2CharFishingOldBoxOpen.hideOldBoxOpenResult();};
  env.itemJson=r=>JSON.parse(r.dataset.itemJson);env.MATERIAL_RE=/fish oil|fish scale|rod|lure|proof|soulshot/i;env.cfg.fishOpenBoxes=true;Object.assign(env.rt,{fishService:'cut',fishSinceProc:3,fishSinceProcN:3,fishProof:100,fishTgt:{type:'proof',n:100,got:0}});render();
 },fail);
}
async function run(){
 await downloadPublic();let count=0;
 const one=async(name,options,action,check)=>{const w=await make(options);try{const result=await action(w);const x=await w.snapshot();check(x,result);assert.deepEqual(w.errors,[]);console.log('PASS '+name);count++;}finally{await w.close();}};
 await one('cast → pumping → reeling → catch → recast',{},w=>w.run(async()=>{await F.fishing();await F.fishing();}),x=>{assert.equal(x.rt.fish.caught,2);assert.deepEqual(x.actions.map(x=>x.action),['cast','pumping','reeling','cast','pumping','reeling']);assert.equal(x.state.basicBait.quantity,28);assert.equal(x.state.fishingSoulshot.quantity,96);});
 await one('два одинаковых no-bite → два новых заброса',{noBite:true},w=>w.run(async()=>{await F.fishing();await F.fishing();}),x=>{assert.equal(x.rt.fish.nobite,2);assert.equal(x.actions.length,2);});
 await one('срыв учитывается без ложного улова',{escape:true},w=>w.run(()=>F.fishing()),x=>{assert.equal(x.rt.fish.lost,1);assert.equal(x.rt.fish.caught,0);});
 await one('наживка auto, good отсутствует → basic',{cfg:{fishBait:'auto'}},w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.basicBait.selected,true);assert.equal(x.rt.baitSwapTo,'basicBait');});
 await one('ручная good выбирает имеющуюся хорошую',{cfg:{fishBait:'good'},state:{goodBait:{itemId:910602,quantity:10,selected:false}}},w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.goodBait.selected,true);assert.equal(x.actions[0].baitItemId,910602);});
 await one('выключатель зарядов посылает серверу OFF',{cfg:{fishShots:false}},w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.fishingSoulshot.enabled,false);assert.equal(x.actions[0].action,'setFishingSoulshotEnabled');});
 await one('зарядов 0 → покупка 5 пакетов и ON',{cfg:{fishAutoBuy:true,fishShotAuto:true},state:{fishingSoulshot:{itemId:910601,quantity:0,enabled:false}}},w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.actions.find(a=>a.offerKey)?.amount,5);assert.equal(x.state.fishingSoulshot.quantity,250);assert.equal(x.state.fishingSoulshot.enabled,true);});
 const balanceState={starterShop:{availableAdena:210000,offers:[{key:'bait_x10',name:'Fishing Lure',qty:10,priceAdena:1000,canBuy:true}]}};
 await one('закупка сохраняет резерв 200000',{state:balanceState,cfg:{shopReserve:200000}},w=>w.run(()=>F.fishBuy('bait_x10',100,'наживка')),x=>{assert.equal(x.actions[0].amount,10);assert.equal(x.state.starterShop.availableAdena,200000);});
 await one('закупка соблюдает лимит 5000',{cfg:{shopMaxSpend:5000}},w=>w.run(()=>F.fishBuy('bait_x10',100,'наживка')),x=>assert.equal(x.actions[0].amount,5));
 const rods=[{itemId:910600,name:'Fishing Rod +10',targetInstanceId:'bag:910600:10',enchant:10,selected:true},{itemId:910600,name:'Fishing Rod',targetInstanceId:'bag:910600:0',enchant:0,selected:false}];
 await one('force не понижает выбранную +10',{rt:{fishRodForce:'Выберите удочку'},state:{rods}},w=>w.run(()=>F.fishRod()),x=>{assert.equal(x.actions.length,0);assert.equal(x.rt.fishRodName,'Fishing Rod +10');});
 const oldRod={itemId:910600,name:'Вудка',enchant:0};const unselected=rods.map(r=>({...r,selected:r.enchant===0}));
 await one('выбор +10 с выбранной +0 подтверждается игрой',{rt:{fishRodForce:'Выберите удочку'},state:{rod:oldRod,rods:unselected}},w=>w.run(()=>F.fishRod()),x=>{assert.equal(x.state.rod.enchant,10);assert.equal(x.rt.fishRodName,'Fishing Rod +10');});
 await one('409 selectRod сохраняет выбранную +0 и очередь',{reject:'revision_conflict',rt:{fishRodForce:'Выберите удочку'},state:{rod:oldRod,rods:unselected}},w=>w.run(async()=>{env.idle=async()=>{env.on=false;};return F.fishRod();}),(x,r)=>{assert.equal(r,false);assert.equal(x.state.rod.enchant,0);assert.equal(x.rt.fishRodName,undefined);assert.ok(x.rt.fishRodForce);});
 await one('капча после отправки приёма → передача управления без новых POST',{delay:50},w=>w.run(async()=>{let blocked=false;env.antibotState=()=>blocked?'check':null;const fire=env.fire;env.fire=e=>{fire(e);if(e?.dataset.slot==='pumping')blocked=true;};await F.fishing();await new Promise(r=>setTimeout(r,100));}),x=>assert.deepEqual(x.actions.map(a=>a.action),['cast','pumping']));
 const time={remainingMs:0,active:false,availableAdena:15000000,packages:[{key:'6h',hours:6,durationMs:21600000,priceAdena:14000000,canBuy:true}]};
 await one('время истекло с рыбой → оплата → завершение',{cfg:{fishTimeAuto:true,shopReserve:200000},state:{target:{name:'White Fish',currentHp:140,maxHp:140,stateHint:'Pumping'},fishingTime:time}},w=>w.run(()=>F.fishing()),x=>{assert.deepEqual(x.actions.map(x=>x.action),['buyFishingTime','pumping','reeling']);assert.equal(x.rt.fish.caught,1);});
 await one('изменённая цена времени не расходует резерв',{cfg:{fishTimeAuto:true,shopReserve:200000},state:{fishingTime:{...time,packages:[{...time.packages[0],priceAdena:14900000}]}}},w=>w.run(()=>F.fishTimeTopUp()),x=>assert.equal(x.actions.length,0));
 const economy=JSON.parse(fs.readFileSync(path.join(repo,'kb/raw/fishing-state.json'))).data.economy;Object.assign(economy.exchanges[0],{ownedQty:25,maxExchangeCount:1,canExchange:true});
 await one('409 exchange оставляет материалы и услугу',{shop:true,reject:'revision_conflict',state:{economy},rt:{fishService:'exchange',fishSinceProcN:7}},w=>w.run(()=>F.fishExchange()),x=>{assert.equal(x.rt.fishService,'exchange');assert.equal(x.rt.fishSinceProcN,7);assert.equal(x.state.economy.proofQty,239);});
 await one('третья незагрузка магазина сохраняет услугу с паузой',{shop:true,waitCap:30,rt:{fishService:'exchange',fishSinceProcN:7,fishShopRetry:2,fishSvc:{stopAfter:true}}},w=>w.run(async()=>{document.querySelector('#fishing-shop-proof-qty').textContent='—';document.querySelector('#fishing-shop-exchange').replaceChildren();env.idle=async ms=>{env.rt.fixtureWait=ms;};await F.fishExchange();}),x=>{assert.equal(x.rt.fishService,'exchange');assert.equal(x.rt.fishSvc.stopAfter,true);assert.equal(x.rt.fishSinceProcN,7);assert.equal(x.rt.fixtureWait,30000);assert.equal(x.actions.length,0);assert.ok(!x.recs.some(s=>/готово/.test(s)));});
 await one('успешный exchange → Proof цель → выключена только рыбалка',{shop:true,state:{economy},rt:{fishService:'exchange',fishSinceProcN:7,fishTgt:{type:'proof',n:1,got:0}}},w=>w.run(()=>F.fishExchange()),x=>{assert.equal(x.rt.fishProofGain,1);assert.equal(x.rt.fishTgt.done,true);assert.equal(x.state.economy.proofQty,240);});
 await one('отсутствующая награда не считается купленной',{shop:true,cfg:{fishGoal:'cloak_missing'},rt:{fishSvc:{stopAfter:true}}},w=>w.run(async()=>{chrome.storage={local:{set:async()=>{env.on=false;}}};await F.fishExchange();}),x=>assert.deepEqual(x.rt.fishGearBought,[]));
 const gearEconomy=JSON.parse(JSON.stringify(economy));gearEconomy.proofQty=5000;gearEconomy.exchanges.forEach(x=>Object.assign(x,{ownedQty:0,maxExchangeCount:0,canExchange:false}));gearEconomy.gearCategories.forEach(x=>x.items.forEach(g=>{g.canBuy=true;}));
 await one('плащ → тату → пояс: покупки подтверждаются и не повторяются',{shop:true,state:{economy:gearEconomy},cfg:{fishGoal:'cloak_d,tattoo_d,belt_d'},rt:{fishService:'exchange',fishSvc:{stopAfter:true}}},w=>w.run(async()=>{chrome.storage={local:{set:async()=>{env.on=false;}}};await F.fishExchange();env.on=true;env.rt.fishSvc={stopAfter:true};await F.fishExchange();}),x=>{assert.deepEqual(x.actions.map(a=>a.gearKey),['cloak_d','tattoo_d','belt_d']);assert.deepEqual(x.rt.fishGearBought,['cloak_d','tattoo_d','belt_d']);assert.equal(x.state.economy.proofQty,3500);});
 await one('409 покупки награды сохраняет цель неприобретённой',{shop:true,reject:'revision_conflict',state:{economy:gearEconomy},cfg:{fishGoal:'cloak_d'},rt:{fishSvc:{stopAfter:true}}},w=>w.run(async()=>{chrome.storage={local:{set:async()=>{env.on=false;}}};await F.fishExchange();}),x=>{assert.deepEqual(x.rt.fishGearBought,[]);assert.equal(x.state.economy.proofQty,5000);assert.equal(x.actions.length,1);});
 await one('public cut + Old Box → результат, прямые Proof и очередь обмена',{},async w=>{await publicBag(w);return w.run(()=>F.fishCut());},x=>{assert.equal(x.actions.filter(a=>a.url.endsWith('/cut')).length,1);assert.equal(x.actions.filter(a=>a.url.endsWith('/open-old-box')).length,1);assert.equal(x.rt.fishVal['White Fish'].n,1);assert.equal(x.rt.fishProofGain,20);assert.equal(x.rt.fishTgt.got,20);assert.equal(x.rt.fishService,'exchange');});
 await one('public cut409 не завершает разделку',{},async w=>{await publicBag(w,true);return w.run(()=>F.fishCut());},x=>{assert.equal(x.rt.fishService,'cut');assert.equal(x.rt.fishSinceProc,3);assert.equal(x.rt.fishProofGain,undefined);});
 console.log('PASS: fishing current public renderer + factory: '+count+' scenarios; authenticated game requests: 0');
}
if(require.main===module)run().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1;});
