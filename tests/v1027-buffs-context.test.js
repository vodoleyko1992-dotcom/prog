'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(){
 const b={console,Date,document:{querySelectorAll:()=>[]}};for(const n of ['actions','buffs'])vm.runInNewContext(read('modules/'+n+'.js'),b);
 let rt={char:'HeroA',manualKickAt:1,tbuff:{step:'restore',buffDone:true,t:Date.now(),back:'/map.html'}};const writes=[],fires=[],route={pathname:'/town-buffer.html',search:'',href:''};let hook=()=>{},H={};
 const env={get rt(){return rt},set rt(v){rt=v},cfg:{townBuffSet:'basic'},on:true,tabOwner:true,leaseEpoch:'A',TB_KEYS:{basic:[]},FA_KNOWN:{},IL:{},DEAD_RE:/unconscious/,
 setStatus(){},rec(){},setRt:async p=>{writes.push({char:rt.char,p});rt={...rt,...p};await hook('setRt',p);return {ok:true}},$q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(H).map(([id,expiry])=>({dataset:{skillId:id,expiresAt:expiry},getAttribute:()=>''}))}:null,
 sleep:async()=>hook('sleep'),pause:async()=>hook('pause'),waitX:async f=>{await hook('waitX');return f()},autonomyMode:()=> 'farm'};
 const a=b.L2V7Factories.actions({get rt(){return rt},cfg:{},get on(){return env.on},get tabOwner(){return env.tabOwner},mode:()=> 'auto',lease:()=>env.leaseEpoch});a.enterFrame();env.routeLocation=a.locationProxy(route);env.fire=el=>{if(!a.canAct())return false;fires.push(el);return true};
 const mutate=kind=>{if(kind==='actor')rt={char:'HeroB',tbuff:{step:'town',set:'basic',t:999},marker:'new'};if(kind==='lease')env.leaseEpoch='B';if(kind==='stop')env.on=false;if(kind==='owner')env.tabOwner=false;if(kind==='kick')rt={...rt,manualKickAt:2};};
 return {env,route,writes,fires,H,mutate,B:b.L2V7Factories.buffs(env),set hook(fn){hook=fn}};
}
for(const kind of ['actor','lease','stop','owner','kick'])test(`restore wait cancelled by ${kind} cannot clear another restoration`,async()=>{
 const f=fixture();f.hook=async p=>{if(p==='waitX')f.mutate(kind)};await f.B.townBuffStep();assert.equal(f.writes.length,0);assert.equal(f.env.rt.restoreRes,undefined);assert.ok(f.env.rt.tbuff);assert.equal(f.route.href,'');
});
for(const step of ['town','fa'])test(`${step} button wait crossing actor cannot write catalog, completion or queue`,async()=>{
 const f=fixture();f.route.pathname=step==='fa'?'/fast-aden-buffer.html':'/town-buffer.html';f.env.rt.tbuff={step,set:'basic',fa:[],t:Date.now()};f.hook=async p=>{if(p==='waitX')f.mutate('actor')};await f.B.townBuffStep();assert.equal(f.writes.length,0);assert.equal(f.env.rt.tbuff.t,999);assert.equal(f.fires.length,0);
});
test('clash learning after actor switch cannot pollute new profile with old HUD differences',async()=>{
 const f=fixture();f.H[1357]=Date.now()+3*3600000;f.hook=async p=>{if(p==='waitX')f.mutate('actor')};await f.B.faClashNote(1357,{1413:Date.now()+3*3600000});assert.equal(f.writes.length,0);assert.equal(f.env.rt.faClash,undefined);
});
test('normal restore without button records failed attempt and returns to original map',async()=>{
 const f=fixture();await f.B.townBuffStep();assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.restoreRes.ok,false);assert.equal(f.route.href,'/map.html');
});
test('Stop after town CoL reserve releases known unsent reservation without click',async()=>{
 const f=fixture(),oldQ=f.env.$q,released=[];f.env.cfg.townBuffSet='mage';f.env.rt.tbuff={step:'town',set:'mage',fa:[],t:Date.now()};const btn={};
 f.env.$q=s=>s.startsWith('#town-buffer-sets ')?btn:oldQ(s);f.env.payments={blocked:()=>false,prepare:async()=>null};
 f.env.gameGet=async()=>({ok:true,json:async()=>({sets:[{id:'mage',feeAdena:0,feeCoinOfLuck:15,skills:[1]}]})});f.env.epicBuffPay=async()=>123;f.env.epicBuffRelease=async at=>released.push(at);
 f.hook=async p=>{if(p==='pause')f.env.on=false};await f.B.townBuffStep();assert.deepEqual(released,[123]);assert.equal(f.fires.length,0);
});
// Actual shared ledger adapter: confirmation of an already sent purchase remains passive.
const fixtures={console,process,__dirname,URLSearchParams,require:n=>n==='node:test'?()=>{}:require(n)};
vm.runInNewContext(read('tests/v1024-payment-adapters.test.js').split('\nfunction raid(){')[0]+'\nthis.make=buffs;',fixtures);
test('Stop after sent FA purchase still permits own passive reconciliation without another purchase',async()=>{
 const f=fixtures.make();f.apply(false);await f.B.townBuffStep();assert.equal(f.pays(),1);f.env.on=false;f.H[1357]=Date.now()+3*3600000;assert.equal(await f.B.paymentReconcile(),true);assert.equal(f.env.payments.blocked(),false);assert.equal(f.pays(),1);
});
