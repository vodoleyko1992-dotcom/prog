'use strict';
// 17.10: отложенный сервис не переживает смену команды; неподтверждённая запись не разрешает переход.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {world}=require('./v1014-fishing-controls.test.js');
function actions(){
 const b={};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/actions.js','utf8'),b);
 let durable=false,generation=1,commits=0;const calls=[],e={on:true,tabOwner:true,rt:{char:'Hero',shop:{t:1,step:'buy'}},cfg:{},mode:()=> 'farm',lease:()=>1,page:()=> '/shop.html',actionGeneration:()=>generation,id:()=> 'owner',
 setRt:async p=>{Object.assign(e.rt,p);return {ok:true}},rtCommit:async()=>{commits++;return durable},rec(){},isBattle:()=>false,paymentPending:()=>null,interrupted:()=>false,jobs:()=>[{key:'shop',run:async()=>calls.push('buy')}]};
 const A=b.L2V7Factories.actions(e);A.enterFrame();return {A,e,calls,commits:()=>commits,durable:v=>durable=v,next:()=>generation++};
}
test('route owner retries failed persistence on every tick before allowing the service',async()=>{
 const f=actions();await f.A.dispatch();await f.A.dispatch();assert.deepEqual(f.calls,[]);assert.equal(f.commits(),2);
 f.durable(true);await f.A.dispatch();assert.deepEqual(f.calls,['buy']);await f.A.dispatch();assert.deepEqual(f.calls,['buy','buy']);assert.equal(f.commits(),3);
});
test('rejected setRt acknowledgement cannot be bypassed on an unchanged next tick',async()=>{
 const f=actions();f.durable(true);let accepted=false;f.e.setRt=async p=>{Object.assign(f.e.rt,p);return {ok:accepted}};
 await f.A.dispatch();await f.A.dispatch();assert.deepEqual(f.calls,[]);accepted=true;await f.A.dispatch();assert.deepEqual(f.calls,['buy']);
});
test('Stop then Start invalidates an old action frame even with unchanged lease/task',()=>{
 const f=actions(),native={href:'/shop.html'};f.e.on=false;f.next();f.e.on=true;f.next();f.A.locationProxy(native).href='/late.html';assert.equal(native.href,'/shop.html');
 f.A.enterFrame();f.A.locationProxy(native).href='/current.html';assert.equal(native.href,'/current.html');
});
function cutting(){
 const W=world({rt:{char:'Hero',manualKickAt:1,fishService:'cut',fishSinceProc:7}});W.location.pathname='/char.html';W.env.leaseEpoch=1;
 let generation=1,opened=false,result='';W.env.actionGeneration=()=>generation;
 const row={querySelector:s=>s==='.l2-char-bag-name'?{textContent:'White Fish ×7'}:{open:true}},j={itemId:9101,qty:7};
 W.document.querySelectorAll=s=>s.includes('l2-char-bag-row')?[row]:[];W.env.itemJson=()=>j;W.env.MATERIAL_RE=/fish oil/;
 W.env.$q=s=>s==='button[data-fishing-inventory-tab]'?{getAttribute:()=> 'true'}:s==='#char-bag-modal-cut-row'?opened?{}:null:s==='#char-bag-modal-overlay'?{get textContent(){return result}}:s==='#char-bag-modal-cut-max'?{max:true}:s==='#char-bag-modal-cut'?{cut:true}:s==='#char-bag-modal-close'?{close:true}:null;
 W.env.fire=b=>{W.clicks.push(b);if(b?.open)opened=true;if(b?.cut)result='Вы разрезали White Fish ×7. Получено: Fish Oil ×25.';if(b?.close)opened=false;};
 return Object.assign(W,{next:()=>generation++});
}
for(const stage of ['tab','max','result'])for(const change of ['character','lease','task','generation','frame'])test(`cut ${stage} await → ${change} preserves the replacement service and counters`,async()=>{
 const W=cutting();let changed=false,waits=0;const wait=W.env.waitFor;
 W.env.canAct=()=>!changed||change!=='frame';
 const mutate=()=>{if(changed)return;changed=true;if(change==='character')W.env.rt={char:'New',fishService:'rod',fishSinceProc:99};else{if(change==='lease')W.env.leaseEpoch++;if(change==='task')W.env.rt.manualKickAt++;if(change==='generation')W.next();W.env.rt.fishService='rod';W.env.rt.fishSinceProc=99;}};
 W.env.waitFor=async(f,...args)=>{const value=await wait(f,...args);waits++;if((stage==='tab'&&waits===1)||(stage==='max'&&waits===3)||(stage==='result'&&waits===4))mutate();return value;};
 await W.F.fishCut();assert.equal(changed,true);assert.equal(W.env.rt.fishService,'rod');assert.equal(W.env.rt.fishSinceProc,99);assert.equal(W.env.rt.fishVal,undefined);
 if(stage!=='result')assert.equal(W.clicks.filter(x=>x?.cut).length,0);
});
test('unchanged cut continuation completes and preserves confirmed yield accounting',async()=>{
 const W=cutting();await W.F.fishCut();assert.equal(W.env.rt.fishService,'exchange');assert.equal(W.env.rt.fishSinceProc,0);assert.equal(W.env.rt.fishVal['White Fish'].n,7);
});
for(const fail of ['false','throw'])test(`failed fishing persistence ${fail} holds soft recovery on the current page`,async()=>{
 const W=world();W.location.href='/char.html';W.env.rtCommit=async()=>{if(fail==='throw')throw Error('storage offline');return false};await W.F.fishSoft('пауза');assert.equal(W.location.href,'/char.html');
});
test('new command during fishing soft wait cancels the old return',async()=>{
 const W=world();let generation=1;W.env.actionGeneration=()=>generation;W.location.href='/char.html';W.env.idle=async()=>{generation++;};await W.F.fishSoft('пауза');assert.equal(W.location.href,'/char.html');
});
test('successful fishing persistence permits the current soft recovery',async()=>{
 const W=world();W.location.href='/char.html';await W.F.fishSoft('пауза');assert.equal(W.location.href,'/fishing.html');
});
function observer({revision=100,target=null}={}){
 const W=world({cfg:{autoTasks:['fish','farm'],fishMaxCasts:1},rt:{char:'Hero',manualKickAt:1,fish:{casts:1}}});
 vm.runInNewContext(fs.readFileSync(__dirname+'/../engine-core.js','utf8'),W.box);W.env.autonomyMode=()=>W.box.L2EngineCore.selectedTask(W.env.cfg,W.env.rt);
 W.env.rt.fishCastPending={char:'Hero',at:W.box.Date.now(),bait:'basic',requestRevision:100,pre:[]};W.env.leaseEpoch=1;let generation=1;W.env.actionGeneration=()=>generation;W.next=()=>generation++;
 W.gets=[];W.posts=[];W.env.gameGet=async path=>{W.gets.push(path);return{ok:true,json:async()=>path==='/character'?{character:{name:'Hero',id:'hero',revision}}:{revision,target}}};
 W.env.gamePost=async(...args)=>{W.posts.push(args);return{ok:true}};return W;
}
test('reached cast limit selects farm, but observation still settles advanced idle revision once',async()=>{
 const W=observer({revision:101});assert.equal(W.env.autonomyMode(),'farm');await W.F.castReconcile({observeOnly:true});
 assert.deepEqual(W.gets.sort(),['/character','/game/fishing/state']);assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,2);assert.equal(await W.F.castReconcile({observeOnly:true}),false);assert.equal(W.env.rt.fish.casts,2);assert.equal(W.posts.length,0);assert.equal(W.reloads,0);assert.equal(W.clicks.length,0);
});
for(const state of [{revision:100,target:null},{revision:101,target:{name:'White Fish'}},{revision:101}])test(`observation of ${JSON.stringify(state)} leaves uncertain cast without POST/reload`,async()=>{
 const W=observer(state);if(!Object.hasOwn(state,'target'))W.env.gameGet=async path=>({ok:true,json:async()=>path==='/character'?{character:{name:'Hero',id:'hero',revision:101}}:{revision:101}});
 await W.F.castReconcile({observeOnly:true});assert.ok(W.env.rt.fishCastPending);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.posts.length,0);assert.equal(W.reloads,0);assert.equal(W.clicks.length,0);
});
test('new generation during observer GET cannot settle or count an old cast',async()=>{
 const W=observer({revision:101}),get=W.env.gameGet;W.env.gameGet=async path=>{const r=await get(path);if(path==='/character')W.next();return r;};await W.F.castReconcile({observeOnly:true});assert.ok(W.env.rt.fishCastPending);assert.equal(W.env.rt.fish.casts,1);assert.equal(W.posts.length,0);assert.equal(W.reloads,0);
});
test('observed current DOM target settles cast but performs no fishing skill',async()=>{
 const W=observer();W.active=true;await W.F.castReconcile({observeOnly:true});assert.equal(W.env.rt.fishCastPending,null);assert.equal(W.env.rt.fish.casts,2);assert.equal(W.env.rt.fish.bites,1);assert.equal(W.env.rt.fishCastActive,true);assert.equal(W.posts.length,0);assert.equal(W.reloads,0);assert.equal(W.clicks.length,0);
});
test('failed persistence holds cast recovery reload with pending retained',async()=>{
 const W=observer({revision:101,target:{name:'White Fish'}});W.env.cfg.fishMaxCasts=0;W.env.rtCommit=async()=>false;await W.F.castReconcile();assert.ok(W.env.rt.fishCastPending);assert.equal(W.reloads,0);assert.equal(W.posts.length,0);
});
for(const fail of ['false','throw'])test(`failed persistence ${fail} holds exchange reload with service retained`,async()=>{
 const W=world({rt:{fishService:'exchange'}});W.location.pathname='/fishing-shop.html';W.env.rtCommit=async()=>{if(fail==='throw')throw Error('storage offline');return false};await W.F.fishExchange();assert.equal(W.reloads,0);assert.equal(W.env.rt.fishService,'exchange');
});
test('new manual service during old completion is not stopped by old stopAfter',async()=>{
 const W=world({rt:{fishSvc:{t:1,stopAfter:true}}});W.box.chrome={storage:{local:{set:async()=>{throw Error('old completion stopped new command')}}}};
 const setRt=W.env.setRt;W.env.setRt=async p=>{const r=await setRt(p);W.env.rt.fishSvc={t:2,stopAfter:false};return r};assert.equal(await W.F.fishSvcDone('готово'),true);assert.equal(W.env.rt.fishSvc.t,2);
});
function raid(change=()=>{}){
 const s=fs.readFileSync(__dirname+'/../modules/raid.js','utf8'),first={id:'old-boss',t:1,name:'Old Boss'},replacement={id:'new-boss',t:2,name:'New Boss'};
 let generation=1,allowed=true;const loc={href:'/map.html'},writes=[],e={on:true,tabOwner:true,cfg:{},rt:{char:'Hero',manualKickAt:1,rbGo:first},actionGeneration:()=>generation,canAct:()=>allowed,setStatus(){},sleep:async()=>{},
 setRt:async p=>{writes.push(p);Object.assign(e.rt,p)},townBuffStart:async()=>{await change({e,replacement,next:()=>generation++,block:()=>allowed=false});return true}};
 const b={env:e,location:loc,huntOn:()=>false,rbVerdictBlocks:()=>false,rbTeleportCheck:()=>null,isRbPage:()=>false};
 vm.runInNewContext(s.slice(s.indexOf('async function rbGoStep()'),s.indexOf('const huntOn ='))+'\nthis.run=rbGoStep;',b);return {e,writes,loc,run:b.run};
}
for(const [name,change] of Object.entries({replacement:f=>f.e.rt.rbGo=f.replacement,kick:f=>f.e.rt.manualKickAt++,character:f=>f.e.rt={char:'New',rbGo:f.replacement},generation:f=>f.next(),frame:f=>f.block(),stop:f=>f.e.on=false,owner:f=>f.e.tabOwner=false}))test(`raid buff await → ${name} cannot restore the captured boss`,async()=>{
 const f=raid(change);await f.run();assert.equal(f.writes.length,0);assert.equal(f.loc.href,'/map.html');
});
test('current raid continuation keeps its captured target after a successful buff start',async()=>{
 const f=raid();await f.run();assert.equal(f.writes.length,1);assert.equal(f.e.rt.rbGo.id,'old-boss');assert.ok(f.e.rt.rbGo.t>1);
});
