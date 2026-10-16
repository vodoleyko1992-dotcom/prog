'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {vm,docOf,read}=require('./epic-harness.cjs');
function fixture(o={}){
 const loc={pathname:'/catacombs.html',search:'',href:'',reload(){events.push('reload')}},events=[],rt={char:'Hero',manualKickAt:1},cfg={catMode:true,catDungeon:'witch',shopReserve:200000,shopMaxSpend:2000000};
 let receipt=null,hold=false,doc=docOf('<div class="l2-rb-row"><span class="l2-rb-row__price">Аден 1</span><button class="l2-rb-row__tp" data-dungeon-id="witch">Телепорт</button></div>');
 const env={rt,cfg,on:true,tabOwner:true,CAT_URL:'/catacombs.html',CAT_LIST:{witch:['Witch',60,75]},heroLvl:()=>70,heroAt:()=>null,
  canAct:()=>true,canRun:()=>!hold,gameGet:async path=>({ok:true,json:async()=>path==='/character'?{character:{name:'Hero',id:'hero',revision:10,adena:500000,inBattle:false}}:{dungeons:[{dungeonId:'witch',adenaCost:1}]}}),
  setRt:async p=>{Object.assign(rt,p);return{ok:true}},rtCommit:async()=>true,isMap:()=>loc.pathname==='/map.html',isBattle:()=>false,
  $q:s=>doc.querySelector(s),shown:e=>!!e&&!e.hidden,sleep:async()=>{},pause:async()=>{},waitX:async f=>f()||null,waitFor:async f=>f()||null,
  fire:e=>{events.push(e.tag==='a'?'battle':'click');env.payments.consumePermit();o.click?.(f);return true},
  idle:async()=>{},setStatus:s=>events.push(s),rec:(...a)=>events.push(a.join(' ')),noticeText:()=>'',NET_ERR:{},catPaymentNet:()=>receipt,
  autonomyMode:()=>cfg.catMode?'cat':'farm'};
 const box={Date:o.clock||Date,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},get document(){return doc},location:loc};vm.runInNewContext(read('modules/payments.js'),box);env.payments=box.L2V7Factories.payments(env);
 vm.runInNewContext(process.env.CAT_SAFETY_SOURCE?fs.readFileSync(process.env.CAT_SAFETY_SOURCE,'utf8'):read('modules/dungeons.js'),box);let mod=box.L2V7Factories.dungeons(env);
 const f={env,rt,cfg,loc,events,get mod(){return mod},setDoc:d=>doc=d,hold:()=>hold=true,reload(){mod=box.L2V7Factories.dungeons(env);env.payments=box.L2V7Factories.payments(env)},ack(patch={}){const p=env.payments.pending();receipt={paymentId:p.id,t:Date.now()+1,id:'witch',expectedRevision:10,expectedAdenaCost:1,characterName:'Hero',characterId:'hero',ok:true,status:200,...patch}}};return f;
}

test('отказ цены не спамит запросами и ложными телепортами, через 15 с повторяется',async()=>{
 let now=Date.now(),calls=0;const clock=class extends Date{static now(){return now}};
 const f=fixture({clock}),get=f.env.gameGet;
 f.env.gameGet=async p=>{calls++;return p==='/character'?{ok:true,json:async()=>({character:{name:'Hero',id:'hero',revision:10,adena:'500000',inBattle:true}})}:get(p)};
 await f.mod.catGo('witch');for(let i=0;i<66;i++)await f.mod.catGo('witch');
 assert.equal(calls,2);assert.ok(f.events.some(x=>x.includes('выход из боя')));assert.ok(!f.events.some(x=>x.includes('телепорт в')));assert.ok(!f.events.includes('click'));
 now+=15001;f.env.gameGet=async p=>{calls++;return get(p)};await f.mod.catGo('witch');assert.equal(calls,4);assert.equal(f.events.filter(x=>x==='click').length,1);
});
test('строковый запас адены из настоящего API разрешает ровно один телепорт',async()=>{
 const f=fixture(),get=f.env.gameGet;f.env.gameGet=async p=>p==='/character'?{ok:true,json:async()=>({character:{name:'Hero',id:'hero',revision:10,adena:'344184696',inBattle:false}})}:get(p);
 await f.mod.catGo('witch');await f.mod.catGo('witch');assert.equal(f.events.filter(x=>x==='click').length,1);
});
test('новые лимиты расходов снимают ожидание и проверяются заново',async()=>{
 const f=fixture();f.cfg.shopMaxSpend=0;await f.mod.catGo('witch');assert.ok(!f.events.includes('click'));assert.ok(f.events.some(x=>x.includes('лимит расходов')));
 f.cfg.shopMaxSpend=10;await f.mod.catGo('witch');assert.equal(f.events.filter(x=>x==='click').length,1);
});
test('неизвестная цена не маскируется общим сообщением о герое',async()=>{
 const f=fixture(),get=f.env.gameGet;f.env.gameGet=async p=>p==='/game/catacombs'?{ok:true,json:async()=>({dungeons:[]})}:get(p);
 await f.mod.catGo('witch');assert.ok(f.events.some(x=>x.includes('сервер не подтвердил цену')));assert.ok(!f.events.includes('click'));assert.equal(f.env.payments.pending(),null);
});
