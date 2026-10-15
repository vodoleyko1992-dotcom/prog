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
  idle:async()=>{},setStatus:s=>events.push(s),rec:()=>{},noticeText:()=>'',NET_ERR:{},catPaymentNet:()=>receipt,
  autonomyMode:()=>cfg.catMode?'cat':'farm'};
 const box={Date,console,URLSearchParams,Math,JSON,CSS:{escape:s=>s},get document(){return doc},location:loc};vm.runInNewContext(read('modules/payments.js'),box);env.payments=box.L2V7Factories.payments(env);
 vm.runInNewContext(process.env.CAT_SAFETY_SOURCE?fs.readFileSync(process.env.CAT_SAFETY_SOURCE,'utf8'):read('modules/dungeons.js'),box);let mod=box.L2V7Factories.dungeons(env);
 const f={env,rt,cfg,loc,events,get mod(){return mod},setDoc:d=>doc=d,hold:()=>hold=true,reload(){mod=box.L2V7Factories.dungeons(env);env.payments=box.L2V7Factories.payments(env)},ack(patch={}){const p=env.payments.pending();receipt={paymentId:p.id,t:Date.now()+1,id:'witch',expectedRevision:10,expectedAdenaCost:1,characterName:'Hero',characterId:'hero',ok:true,status:200,...patch}}};return f;
}
test('unknown paid teleport survives timeout and reload without another click',async()=>{
 const f=fixture();await f.mod.catGo('witch');f.reload();await f.mod.catGo('witch');await f.mod.catGo('witch');assert.equal(f.events.filter(x=>x==='click').length,1);
 f.ack();await f.mod.paymentReconcile();assert.equal(f.env.payments.pending(),null);
});
test('receipt of another attempt, actor, cost, or old response never acknowledges payment',async()=>{
 for(const patch of [{paymentId:'old'},{characterName:'Other'},{characterId:'other'},{expectedAdenaCost:2},{t:1}]){const f=fixture();await f.mod.catGo('witch');f.ack(patch);await f.mod.paymentReconcile();assert.ok(f.env.payments.pending());assert.equal(f.events.filter(x=>x==='click').length,1);}
});
test('known server refusal releases hold; timeout/5xx does not',async()=>{
 for(const status of [409,412,503]){const f=fixture();await f.mod.catGo('witch');f.ack({ok:false,status,characterName:'',characterId:''});await f.mod.paymentReconcile();assert.equal(!!f.env.payments.pending(),status===503);}
});
test('native request revision may differ from quote revision, exact request id wins',async()=>{const f=fixture();await f.mod.catGo('witch');f.ack({expectedRevision:9,ok:false,status:409,characterName:'',characterId:''});await f.mod.paymentReconcile();assert.equal(f.env.payments.pending(),null)});
test('unknown price, currency ceiling, balance and character state do not send teleport',async()=>{
 for(const value of [null,-1,3000000]){const f=fixture();const get=f.env.gameGet;f.env.gameGet=async p=>p==='/game/catacombs'?{ok:true,json:async()=>({dungeons:[{dungeonId:'witch',adenaCost:value}]})}:get(p);await f.mod.catGo('witch');assert.ok(!f.events.includes('click'));}
});
test('stop or changed manual target while quote is read cannot reserve or click',async()=>{
 for(const change of [f=>f.env.on=false,f=>f.cfg.catMode=false,f=>f.rt.manualKickAt++,f=>f.rt.char='Other',f=>f.hold()]){const f=fixture(),get=f.env.gameGet;f.env.gameGet=async p=>{const r=await get(p);change(f);return r};await f.mod.catGo('witch');assert.ok(!f.events.includes('click'));assert.equal(f.env.payments.pending(),null);}
});
test('failed durable flush never sends paid teleport',async()=>{const f=fixture();f.env.rtCommit=async()=>false;await f.mod.catGo('witch');assert.ok(!f.events.includes('click'))});
function huntFixture(){const f=fixture();f.loc.pathname='/dungeon.html';f.loc.search='?dungeonId=witch';f.setDoc(docOf('<ul id="dungeon-mob-list"><li><a href="/battle.html?spawnId=sdms_witch_1">Mob · ур. 70</a></li></ul>'));f.env.dungNet=()=>null;f.env.isBattle=()=>f.events.includes('battle');return f}
for(const [label,change]of[['mode',f=>f.cfg.catMode=false],['character',f=>f.rt.char='Other'],['manual target',f=>f.rt.manualKickAt++],['dungeon choice',f=>f.cfg.catDungeon='other'],['TvT',f=>f.hold()],['Stop',f=>f.env.on=false]]){
 test('dungeon read interrupted by '+label+' cannot change route or attack',async()=>{const f=huntFixture(),wait=f.env.waitX;f.env.waitX=async pred=>{const value=await wait(pred);change(f);return value};await f.mod.catHunt('witch');assert.ok(!f.events.includes('battle'));assert.equal(f.loc.href,'');assert.equal(f.rt.target,undefined)});
 test('last dungeon attack interrupted by '+label+' cannot start battle',async()=>{const f=huntFixture();f.env.pause=async()=>change(f);await f.mod.catHunt('witch');assert.ok(!f.events.includes('battle'));assert.equal(f.loc.href,'')});
}
test('unchanged dungeon context opens exactly one chosen battle',async()=>{const f=huntFixture();await f.mod.catHunt('witch');assert.equal(f.events.filter(x=>x==='battle').length,1);assert.equal(f.rt.target.name,'Mob')});

test('accepted receipt with lost redirect goes to map, never pays again after reload',async()=>{const f=fixture();await f.mod.catGo('witch');f.ack();await f.mod.paymentReconcile();f.reload();await f.mod.catGo('witch');assert.equal(f.events.filter(x=>x==='click').length,1);assert.equal(f.loc.href,'/map.html')});
test('fresh character mismatch, unknown balance or battle blocks paid teleport',async()=>{for(const patch of [{name:'Other'},{adena:null},{adena:200000},{inBattle:true},{revision:null}]){const f=fixture(),get=f.env.gameGet;f.env.gameGet=async p=>p==='/character'?{ok:true,json:async()=>({character:{name:'Hero',id:'hero',revision:10,adena:500000,inBattle:false,...patch}})}:get(p);await f.mod.catGo('witch');assert.ok(!f.events.includes('click'));assert.equal(f.env.payments.pending(),null)}});
test('repainted price during durable save cancels prepared payment before click',async()=>{const f=fixture();let n=0;f.env.rtCommit=async()=>{if(++n===2)f.setDoc(docOf('<div class="l2-rb-row"><span class="l2-rb-row__price">Аден 2</span><button class="l2-rb-row__tp" data-dungeon-id="witch">Телепорт</button></div>'));return true};await f.mod.catGo('witch');assert.ok(!f.events.includes('click'));assert.equal(f.env.payments.pending(),null)});
test('battle confirmation after profile switch does not reset new profile errors',async()=>{const f=huntFixture();f.rt.catFar=2;f.env.waitFor=async()=>{f.rt.char='Other';f.rt.catFar=7;return true};await f.mod.catHunt('witch');assert.equal(f.rt.catFar,7)});
