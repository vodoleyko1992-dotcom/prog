'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const box=vm.createContext({});vm.runInContext(read('engine-core.js'),box);const E=box.L2EngineCore;
const legacy={tvtOn:true,fishMode:true,rbHuntMode:true,campaign:true,campAuto:true,epicMode:true,catMode:true,zoneAuto:true,enchantMode:true,dailyAuto:true,clanTasks:true,mmOrders:true,mmGoalItem:77,mmGoalFarm:true,storyTurnIn:true,enemyHunt:true,pvpOnSight:true,petFullAuto:true,shopAuto:true,autoMagister:true,weaponScanAuto:true,chain:true,farmRes:'ore',recipeRes:'recipe',faBuffs:'123',tsBuy:true};
let rt={};const cfg=tasks=>E.taskConfig({...legacy,autoTasks:tasks},()=>rt);
for(const tasks of [[],['tvt']]){
 const c=cfg(tasks);assert.equal(E.selectedTask(c),'tasks');
 for(const key of ['fishMode','rbHuntMode','epicMode','catMode','campaign','campAuto','zoneAuto','enchantMode','dailyAuto','clanTasks','mmOrders','storyTurnIn','enemyHunt','pvpOnSight','petFullAuto','shopAuto','autoMagister','weaponScanAuto','chain','tsBuy'])assert.equal(c[key],false,key);
 assert.equal(c.farmRes,'');assert.equal(c.recipeRes,'');assert.equal(c.mmGoalItem,0);
 for(const key of ['shop','tbuff','magister','invScan','mmJob','storyJob','rbHunt','rbGo','fishSvc','tsJob'])assert.equal(E.taskJobAllowed(c,key,rt),false,key);
}
for(const [task,flag] of [['quests','campaign'],['fish','fishMode'],['cat','catMode'],['raid','rbHuntMode'],['epic','epicMode'],['farm',null],['auto','zoneAuto'],['enchant','enchantMode']]){
 const c=cfg(['tvt',task]);assert.equal(E.selectedTask(c),task);if(flag)assert.equal(c[flag],true);assert.equal(c.tvtOn,true);
 for(const other of ['quests','fish','cat','raid','epic','farm','auto','enchant'])if(other!==task)assert.equal(E.taskAllowed(c,other),false);
}
const order=['enchant','epic','raid','quests','fish','cat','auto','farm'];
for(let bits=0;bits<256;bits++) {const list=order.filter((_,i)=>bits&(1<<i));assert.equal(E.selectedTask(cfg(list)),list[0]||'tasks');}
rt={enchant:{status:'done'},campNoTasksUntil:Date.now()+60000};assert.equal(E.selectedTask(cfg(order),rt),'epic');
assert.equal(E.selectedTask(cfg(['quests','fish']),rt),'fish');assert.equal(E.selectedTask(cfg(['quests']),rt),'tasks');
rt={campSkipUntil:Date.now()+60000};assert.equal(E.selectedTask(cfg(['quests','fish']),rt),'quests','temporary quest error must not switch to fishing');
rt={storySaga:{completed:true},campaignUrl:'/giran-campaign.html'};assert.equal(E.selectedTask(cfg(['quests','fish']),rt),'quests','completed starter does not finish another campaign');
rt={fishTgt:{done:true}};assert.equal(E.selectedTask(cfg(['fish','cat']),rt),'cat','completed fish target yields only to selected task');
assert.equal(E.selectedTask(cfg(['fish']),rt),'tasks');
rt={};const c=cfg(['tvt']);const raw=E.rawTaskConfig(c);assert.equal(raw.shopAuto,true);assert.equal(raw.fishMode,true);
const saved=E.taskConfig({...E.rawTaskConfig(c),rec:false});assert.equal(E.rawTaskConfig(saved).shopAuto,true);assert.equal(E.rawTaskConfig(saved).farmRes,'ore');
assert.equal(E.taskConfig(legacy),legacy,'legacy profiles keep prior behavior until explicit selection');
assert.equal(cfg(['mammon']).mmGoalFarm,false,'Mammon does not authorize resource farming');
assert.equal(cfg(['raid']).chain,false,'raid-only cannot farm normal chain');
assert.equal(E.taskJobAllowed(cfg(['epic','raid']),'rbGo'),false,'old raid cannot bypass epic priority');
assert.equal(E.taskJobAllowed(cfg(['quests','fish']),'fishSvc'),false,'old fish service cannot bypass campaign');
assert.equal(E.taskJobAllowed(cfg(['fish','dailies']),'dailyFish'),false,'old daily detour does not own the selected mode');
for(const key of ['shop','tbuff','magister','invScan'])assert.equal(E.taskJobAllowed(cfg(['fish']),key),false);
// Журнал фиксирует переходы, но не разрастается на каждом тике.
const notes=[],source=read('content.js'),start=source.indexOf('function taskPolicyNote('),end=source.indexOf('// эпики + рыбалка:',start);
let clock=10000;const noteBox=vm.createContext({cfg:cfg(['tvt','fish']),rt:{},tabOwner:true,window:{},L2EngineCore:E,Date:{now:()=>clock},autonomyMode:()=> 'fish',rec:(...a)=>notes.push(a)});
vm.runInContext(source.slice(start,end),noteBox);noteBox.taskPolicyNote();noteBox.taskPolicyNote();assert.equal(notes.length,1);
noteBox.taskPolicyNote('tvt');assert.equal(notes.length,1);clock+=5000;noteBox.taskPolicyNote('tvt');assert.equal(notes.length,2);
// Actual action coordinator cancels an in-flight continuation when only the allowlist changes.
(async()=>{
 const context=vm.createContext({});vm.runInContext(read('modules/actions.js'),context);
 const state={char:'hero',manualKickAt:1},config={autoTasks:['tvt','fish']};let release,posts=0;
 const env={rt:state,cfg:config,on:true,tabOwner:true,mode:()=> 'fish',lease:()=>1,page:()=>'/map.html',id:()=> 'job',interrupted:()=>false,paymentPending:()=>null,isBattle:()=>false,setRt:async p=>{Object.assign(state,p);return{ok:true}},rtCommit:async()=>true,rec(){},jobs:()=>[{key:'work',run:async()=>{await new Promise(r=>release=r);if(A.canAct())posts++}}]};
 const A=context.L2V7Factories.actions(env);state.work={t:1};A.enterFrame();const pending=A.dispatch();await new Promise(r=>setImmediate(r));config.autoTasks=['tvt'];release();await pending;assert.equal(posts,0);
 assert.equal(A.canAct(),false);A.enterFrame();assert.equal(A.canAct(),true);
 // Pending payments always reconcile, even with no allowed task and no job owner.
 let reconciles=0;env.paymentPending=()=>({id:'paid',kind:'shop'});env.reconcile=async()=>reconciles++;await A.dispatch();assert.equal(reconciles,1);
 // Устаревшее ожидание панели рыбалки не останавливает уже выбранную заточку.
 const fishingBox=vm.createContext({location:{pathname:'/fishing.html'},sessionStorage:{getItem:()=>null,setItem(){}},document:{querySelectorAll:()=>[]}});vm.runInContext(read('modules/fishing.js'),fishingBox);
 let mode='fish',halts=0;const fishEnv={on:true,tabOwner:true,cfg:{autoTasks:['enchant','fish'],fishAutoSetup:false},rt:{char:'hero'},NET_FISH:{},autonomyMode:()=>mode,$q:()=>null,shown:()=>false,waitFor:async()=>{mode='enchant';return null},halt:async()=>halts++,setStatus(){},setRt:async p=>Object.assign(fishEnv.rt,p),rec(){}};
 const F=fishingBox.L2V7Factories.fishing(fishEnv);await F.fishing();assert.equal(halts,0);
 fishEnv.rt.fishTgt={type:'fish',n:1,got:1};await F.fishTgtReached();assert.equal(fishEnv.rt.fishTgt.done,true);assert.equal(halts,0,'completed selected fish target does not stop the next task');
 console.log('PASS: 256 selection combinations, TvT-only, fallbacks, raw preservation, stale awaits and pending payment');
})().catch(e=>{console.error(e);process.exitCode=1});
