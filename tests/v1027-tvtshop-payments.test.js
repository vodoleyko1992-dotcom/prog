'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../modules',n+'.js'),'utf8');
function fixture(){
 let clock=Date.now();class Clock extends Date{static now(){return clock}}
 let count=0,coins=300,revision=10,fires=0,apply=true,ack=true,equipped=false,catPrice=260;const loc={pathname:'/tvt-shop.html',href:''};
 const btn={disabled:false},row={closest:()=>null,querySelector:s=>s.endsWith('__name')?{textContent:'Тату Души'}:s.endsWith('__price')?{textContent:'260'}:s.endsWith('__buy')?btn:null};
 const box={console,Date:Clock,location:loc,document:{querySelectorAll:()=>[row]}};vm.runInNewContext(read('payments'),box);vm.runInNewContext(read('tvtshop'),box);
 const ch=()=>({id:'hero-id',name:'Hero',revision,inventory:{stacks:[{itemId:920030,qty:coins},...(!equipped&&count?[{itemId:920033,qty:count}]:[])],eq:equipped&&count?{tattoo:{itemId:920033}}:{}}});
 const e={on:true,tabOwner:true,leaseEpoch:1,rt:{char:'Hero',manualKickAt:1,lvl:80},cfg:{tsBuy:true,tsGoalItem:920033},
 setRt:async p=>{Object.assign(e.rt,p);return {ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},sleep:async()=>{},pause:async()=>{},waitX:async f=>f(),shown:()=>true,isBattle:()=>false,awayFree:()=>true,fishNow:()=>false,tvtHold:()=>false,
 $q:s=>s==='#tvt-shop-shil-balance'?{textContent:'300'}:null,invQty:id=>id===920030?coins:null,heroLevel:()=>80,autonomyMode:()=> 'farm',
 gameGet:async url=>({ok:true,json:async()=>url==='/character'?{character:ch()}:{categories:[{key:'tattoo',items:[{itemId:920033,nameRu:'Тату Души',priceShil:catPrice,requiredLevel:70}]}]}})};
 const reload=()=>{e.payments=box.L2V7Factories.payments(e);return box.L2V7Factories.tvtshop(e)};let M=reload();
 e.fire=b=>{assert.equal(b,btn);if(!e.payments.consumePermit())return false;fires++;const rev=revision;if(apply){count++;coins-=260;revision++}if(ack)M.onNet('/game/tvt/shop/purchase',{paymentId:e.payments.pending()?.id,method:'POST',status:200,req:{itemId:920033,expectedRevision:rev},res:{character:ch()}});return true};
 const start=async()=>{await M.shopStep();await M.shopStep()};
 return {e,loc,btn,row,ch,start,get M(){return M},fires:()=>fires,reload:()=>{M=reload()},apply:x=>apply=x,ack:x=>ack=x,grant:()=>{count++;revision++;clock+=5001},equip:()=>{equipped=true},price:x=>catPrice=x};
}
test('TvT goal → live quote → durable permit → native purchase → inventory+ACK → one confirmed item',async()=>{const f=fixture();await f.start();assert.equal(f.fires(),1);assert.equal(f.e.rt.tsLog[0].ok,true);assert.equal(f.e.payments.pending(),null);assert.equal(f.loc.href,'/map.html');await f.M.shopStep();assert.equal(f.fires(),1)});
test('TvT timeout + hour later + reload cannot repeat unknown purchase; inventory then releases hold',async()=>{const f=fixture();f.apply(false);f.ack(false);await f.start();assert.equal(f.fires(),1);assert.ok(f.e.payments.pending());f.e.rt.tsTryT=0;f.reload();await f.M.shopStep();assert.equal(f.fires(),1);assert.equal(f.e.rt.tsLog,undefined);f.grant();await f.M.shopStep();assert.equal(f.e.payments.pending(),null);assert.equal(f.e.rt.tsLog[0].ok,true);await f.M.shopStep();assert.equal(f.fires(),1)});
test('TvT lost ACK accepted purchase is confirmed by fresh inventory, including equipped item',async()=>{const f=fixture();f.ack(false);f.e.waitX=async fn=>{f.equip();return fn()};await f.start();assert.equal(f.fires(),1);assert.equal(f.e.payments.pending(),null);assert.equal(f.e.rt.tsGoalDone.id,920033)});
test('TvT storage failure before native fire spends no Shil',async()=>{const f=fixture();f.e.rtCommit=async()=>false;await f.start();assert.equal(f.fires(),0)});
for(const change of ['stop','owner','manual','goal','registration','character'])test(`TvT paid prepare → ${change} cancels unsent command`,async()=>{
 const f=fixture();const commit=f.e.rtCommit;let first=true;f.e.rtCommit=async()=>{if(first){first=false;if(change==='stop')f.e.on=false;if(change==='owner')f.e.tabOwner=false;if(change==='manual')f.e.rt.manualKickAt++;if(change==='goal')f.e.cfg.tsGoalItem=920031;if(change==='registration')f.e.tvtHold=()=>true;if(change==='character')f.e.rt={char:'Other'};}return commit()};await f.start();assert.equal(f.fires(),0);
});
test('TvT rejected native click clears known-unsent ledger and allows one later attempt',async()=>{const f=fixture(),fire=f.e.fire;f.e.fire=()=>false;await f.start();assert.equal(f.e.payments.pending(),null);f.e.fire=fire;await f.M.shopStep();assert.equal(f.fires(),1)});
test('TvT price changed in catalog cannot buy stale DOM price',async()=>{const f=fixture();f.price(280);await f.start();assert.equal(f.fires(),0);assert.match(f.e.rt.tsLog[0].why,/цена/)});
test('TvT old receipt / foreign hero / unrelated item cannot confirm unknown payment',async()=>{
 const f=fixture();f.apply(false);f.ack(false);await f.start();const p=f.e.payments.pending();for(const [itemId,ch,rev] of [[920031,{...f.ch(),revision:11},10],[920033,{...f.ch(),name:'Other',revision:11},10],[920033,{...f.ch(),revision:10},10]])f.M.onNet('/game/tvt/shop/purchase',{paymentId:f.e.payments.pending()?.id,method:'POST',status:200,req:{itemId,expectedRevision:rev},res:{character:ch}});
 await f.M.paymentReconcile();assert.equal(f.e.payments.pending().id,p.id);assert.equal(f.e.rt.tsLog,undefined);
});
test('TvT exact server rejection releases ledger but remains failed with cooldown',async()=>{const f=fixture();f.apply(false);f.ack(false);await f.start();f.M.onNet('/game/tvt/shop/purchase',{paymentId:f.e.payments.pending()?.id,method:'POST',status:409,req:{itemId:920033,expectedRevision:10},res:{error:'revision_conflict'}});assert.equal(await f.M.paymentReconcile(),true);assert.equal(f.e.payments.pending(),null);assert.equal(f.e.rt.tsLog[0].ok,false);assert.equal(f.M.want(),null)});
for(const change of ['character','lease','owner','payment'])test(`TvT fresh inventory reconcile → ${change} cannot settle other context`,async()=>{
 const f=fixture();f.apply(false);f.ack(false);await f.start();f.grant();f.e.gameGet=async()=>({ok:true,json:async()=>{const ch=f.ch();if(change==='character')f.e.rt.char='Other';if(change==='lease')f.e.leaseEpoch++;if(change==='owner')f.e.tabOwner=false;if(change==='payment')f.e.rt.actionPayments.pending={...f.e.payments.pending(),id:'replacement'};return {character:ch}}});assert.equal(await f.M.paymentReconcile(),false);assert.equal(f.e.rt.tsLog,undefined);
});
test('TvT confirmed old payment after manual mode change records result without clearing a new goal job/navigation',async()=>{const f=fixture();f.apply(false);f.ack(false);await f.start();f.e.rt.manualKickAt++;f.e.rt.tsJob={t:999,it:{id:920031,n:'New'}};f.grant();assert.equal(await f.M.paymentReconcile(),true);assert.equal(f.e.rt.tsJob.t,999);assert.equal(f.loc.href,'');assert.equal(f.e.rt.tsLog[0].id,920033)});

test('TvT native stale cached revision409 is bound to current payment and releases refused intent',async()=>{const f=fixture();f.apply(false);f.ack(false);await f.start();f.M.onNet('/game/tvt/shop/purchase',{paymentId:f.e.payments.pending().id,method:'POST',status:409,req:{itemId:920033,expectedRevision:9},res:{error:'revision_conflict'}});assert.equal(await f.M.paymentReconcile(),true);assert.equal(f.e.payments.pending(),null);assert.equal(f.e.rt.tsLog[0].ok,false)});
