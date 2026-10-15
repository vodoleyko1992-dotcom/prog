'use strict';
// Native public fishing renderer + real payment ledger; every API response is synthetic.
const {make,downloadPublic}=require('./v1014-fishing-public-browser.cjs'),assert=require('node:assert/strict'),path=require('node:path');
async function attach(w){await w.page.addScriptTag({path:path.join(__dirname,'../modules/payments.js')});await w.run(()=>{
 env.rt.char='SyntheticHero';env.leaseEpoch=1;env.tabOwner=true;env.canRun=()=>env.on;env.canAct=()=>env.on;
 env.setRt=async p=>{Object.assign(env.rt,p);return{ok:true}};env.rtCommit=async()=>true;
 window.hero={name:'SyntheticHero',id:'synthetic',revision:testState.revision,adena:'100000000',inventory:{stacks:[],eq:{}}};
 env.gameGet=async p=>({ok:!window.failedRead,json:async()=>structuredClone(p==='/character'?{character:hero}:testState)});
 env.payments=L2V7Factories.payments(env);const native=env.fire;env.fire=b=>{if(!env.on)return false;env.payments.consumePermit();native(b);return true};
 const send=L2.authFetch;L2.authFetch=async(url,init={})=>{const paymentId=env.payments.claimRequest?env.payments.claimRequest({path:url,method:init.method||'GET',req:JSON.parse(init.body||'{}')}):env.payments.pending()?.id;const r=await send(url,init);if(init.method==='POST'){
  const req=JSON.parse(init.body||'{}');hero.revision=testState.revision;
  if(url.endsWith('/buy-gear')){const g=testState.economy.gearCategories.flatMap(x=>x.items).find(x=>x.key===req.gearKey);hero.inventory.stacks.push({itemId:g.itemId,qty:1});}
  if(req.action==='buyFishingSpot')testState.fishingSpot.purchased=true;
  if(window.loseReply){window.failedRead=true;throw Error('synthetic lost response')}
  F.paymentNote(url,{method:'POST',status:r.status,paymentId,req,res:{character:structuredClone(hero)}});
 }return r};
 });}
async function one(label,options,act,check){const w=await make(options);try{await attach(w);await act(w);check(await w.snapshot());assert.deepEqual(w.errors,[]);console.log('PASS '+label)}finally{await w.close()}}
(async()=>{await downloadPublic();const time={remainingMs:0,active:false,availableAdena:15000000,packages:[{key:'6h',hours:6,durationMs:21600000,priceAdena:14000000,canBuy:true}]};
 await one('native time purchase ACK resolves ledger',{cfg:{fishTimeAuto:true},state:{fishingTime:time}},w=>w.run(()=>F.fishTimeTopUp()),x=>{assert.equal(x.actions.filter(a=>a.action==='buyFishingTime').length,1);assert.equal(x.rt.actionPayments.pending,null)});
 await one('native time lost reply survives module reload without repeated POST',{cfg:{fishTimeAuto:true},state:{fishingTime:time}},w=>w.run(async()=>{window.loseReply=true;await F.fishTimeTopUp();F=L2V7Factories.fishing(env);env.payments=L2V7Factories.payments(env);await F.fishTimeTopUp();}),x=>{assert.equal(x.actions.filter(a=>a.action==='buyFishingTime').length,1);assert.ok(x.rt.actionPayments.pending)});
 await one('native starter purchase uses fresh quantities and exact receipt',{},w=>w.run(()=>F.fishBuy('bait_x10',2,'наживка')),x=>{assert.equal(x.actions.filter(a=>a.offerKey==='bait_x10').length,1);assert.equal(x.state.basicBait.quantity,50);assert.equal(x.rt.actionPayments.pending,null)});
 const e=require('../kb/raw/fishing-state.json').data.economy; e.proofQty=5000;e.exchanges.forEach(x=>Object.assign(x,{ownedQty:0,maxExchangeCount:0,canExchange:false}));e.gearCategories.forEach(x=>x.items.forEach(g=>g.canBuy=true));
 await one('native fishing gear receipt persists purchased goal once',{shop:true,state:{economy:e},cfg:{fishGoal:'cloak_d'},rt:{fishService:'exchange',fishSvc:{stopAfter:true}}},w=>w.run(async()=>{chrome.storage={local:{set:async()=>{env.on=false}}};await F.fishExchange();env.on=true;env.rt.fishSvc={stopAfter:true};await F.fishExchange()}),x=>{assert.equal(x.actions.filter(a=>a.gearKey==='cloak_d').length,1);assert.deepEqual(x.rt.fishGearBought,['cloak_d']);assert.equal(x.rt.actionPayments.pending,null)});
 await one('native gear receipt with missing banner survives next service',{shop:true,state:{economy:structuredClone(e)},cfg:{fishGoal:'cloak_d'},rt:{fishService:'exchange',fishSvc:{stopAfter:true}}},w=>w.run(async()=>{chrome.storage={local:{set:async()=>{env.on=false}}};const wait=env.waitFor;env.waitFor=async(fn,...a)=>{const r=await wait(fn,...a);return env.rt.fishPaymentReceipt?false:r};await F.fishExchange();env.waitFor=wait;env.on=true;env.rt.fishSvc={stopAfter:true};await F.fishExchange()}),x=>{assert.equal(x.actions.filter(a=>a.gearKey==='cloak_d').length,1);assert.deepEqual(x.rt.fishGearBought,['cloak_d']);assert.equal(x.rt.actionPayments.pending,null)});
 await one('actor changed after gear settlement cannot receive previous service state',{shop:true,state:{economy:structuredClone(e)},cfg:{fishGoal:'cloak_d'},rt:{fishService:'exchange',fishSvc:{stopAfter:true}}},w=>w.run(async()=>{const sleep=env.sleep;env.sleep=async ms=>{await sleep(ms);if(env.rt.fishGearBought?.includes('cloak_d'))env.rt={char:'Other'}};await F.fishExchange()}),x=>{assert.equal(x.rt.char,'Other');assert.equal(x.rt.fishGearBought,undefined);assert.equal(x.rt.fishProof,undefined)});
 await one('native stale UI revision returns 409 and releases only rejected purchase',{cfg:{fishTimeAuto:true},state:{fishingTime:time}},w=>w.run(async()=>{testState.revision++;hero.revision=testState.revision;await F.fishTimeTopUp()}),x=>{assert.equal(x.actions.filter(a=>a.action==='buyFishingTime').length,1);assert.equal(x.state.fishingTime.remainingMs,0);assert.equal(x.rt.actionPayments.pending,null);assert.equal(x.rt.actionPayments.history[0].confirmation.kind,'server-rejected')});
 console.log('PASS native fishing payment browser: 7 cases; real game actions: 0');
})().catch(e=>{console.error(e);process.exitCode=1});
