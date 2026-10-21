'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
function fixture({legacy=false,process=false,done=false}={}){
 const T={type:'fish',n:10,got:10,t:123,...(done?{done:true,doneT:99}:{})};
 const state={on:true,lock:{k:'tab7',epoch:1,t:Date.now()},cfg:{fishMode:true,catMode:true,extra:42,...(legacy?{}:{autoTasks:['fish','cat','tvt']})},rt:{char:'hero',fishTgt:T,fishSinceProc:3,fishService:null,keep:17}};
 let before,fail=false,writes=0;
 const bg={URL,Date,MAX_PATCH_KEYS:100,LOCK_TTL:60000,serializeLock:async f=>f(),pvpSeedPatch:p=>p,chrome:{storage:{local:{get:async()=>{before?.();return structuredClone(state)},set:async p=>{if(fail)throw Error('disk');writes++;Object.assign(state,structuredClone(p))}}}}};
 const src=read('background.js');vm.runInNewContext(src.slice(src.indexOf('async function statePatch('),src.indexOf('// Popup writes also')),bg);
 const c={rt:structuredClone(state.rt),cfg:{...structuredClone(state.cfg),fishProcess:process},on:true,tabOwner:true,leaseEpoch:1,TAB_ID:'tab7',rtCommit:async()=>true,mergeCfg:x=>x,ipc:m=>bg.statePatch(m,{tab:{id:7},frameId:0,url:'https://l2wap.com/fishing.html'})};
 const content=read('content.js');vm.runInNewContext(content.slice(content.indexOf('async function finishFishGoal('),content.indexOf('// ---------- персонаж')),c);
 const env={get rt(){return c.rt},get cfg(){return c.cfg},on:true,tabOwner:true,finishFishGoal:c.finishFishGoal,setRt:async p=>{Object.assign(c.rt,p);Object.assign(state.rt,structuredClone(p))},rec(){},setStatus(){},halt:()=>assert.fail('общий Stop запрещён')};
 const mod={Date,document:{querySelectorAll:()=>[]}};vm.runInNewContext(read('modules/fishing.js'),mod);const F=mod.L2V7Factories.fishing(env);
 return{state,c,F,bg,env,change:f=>before=f,fail:()=>fail=true,writes:()=>writes};
}
for(const legacy of [false,true])test('цель на сегодня: рыбалка не снимается с задач (20.43), но selectedTask идёт дальше; остальные задачи и on сохраняются; legacy='+legacy,async()=>{
 const f=fixture({legacy});await f.F.fishTgtReached();assert.equal(f.state.on,true);assert.equal(f.state.cfg.fishMode,false);assert.equal(f.state.cfg.catMode,true);assert.equal(f.state.cfg.extra,42);assert.equal(f.state.rt.keep,17);assert.equal(f.state.rt.fishTgt.done,true);if(!legacy){assert.deepEqual(f.state.cfg.autoTasks,['fish','cat','tvt']);const e={};vm.runInNewContext(read('engine-core.js'),e);assert.equal(e.L2EngineCore.selectedTask(f.state.cfg,f.state.rt),'cat');}
});
test('включённая разделка сохраняет задачу до сдачи, затем отключает',async()=>{
 const f=fixture({process:true});await f.F.fishTgtReached();assert.equal(f.state.rt.fishTgt.final,true);assert.equal(f.state.rt.fishService,'cut');assert.equal(f.state.cfg.fishMode,true);assert.equal(f.writes(),0);await f.F.fishTgtReached();assert.equal(f.state.cfg.fishMode,false);
});
test('повтор уже выполненной цели чинит настройки, сохраняет doneT',async()=>{const f=fixture({done:true});await f.F.fishTgtReached();await f.F.fishTgtReached();assert.equal(f.state.rt.fishTgt.doneT,99);assert.deepEqual(f.state.cfg.autoTasks,['fish','cat','tvt']);});
test('свежий список задач из меню сохраняется, stale-массив вкладки не записывается',async()=>{const f=fixture();f.change(()=>f.state.cfg.autoTasks=['fish','raid','shop']);await f.F.fishTgtReached();assert.deepEqual(f.state.cfg.autoTasks,['fish','raid','shop']);});
for(const change of ['goal','char','lease','stop','kick'])test('позднее завершение не меняет настройки после '+change,async()=>{const f=fixture();f.change(()=>{if(change==='goal')f.state.rt.fishTgt={...f.state.rt.fishTgt,t:456};if(change==='char')f.state.rt.char='other';if(change==='lease')f.state.lock.epoch=2;if(change==='stop')f.state.on=false;if(change==='kick')f.state.rt.manualKickAt=3});await f.F.fishTgtReached();assert.equal(f.writes(),0);assert.equal(f.state.cfg.fishMode,true);});
test('ошибка хранения не объявляет цель выполненной локально',async()=>{const f=fixture();f.fail();await assert.rejects(f.F.fishTgtReached(),/disk/);assert.equal(f.c.rt.fishTgt.done,undefined);assert.equal(f.state.cfg.fishMode,true);});
test('недописанная поимка запрещает завершение',async()=>{const f=fixture();f.c.rtCommit=async()=>false;await f.F.fishTgtReached();assert.equal(f.writes(),0);});
test('недостигнутая цель отвергается хранилищем',async()=>{const f=fixture();f.state.rt.fishTgt.got=9;await f.F.fishTgtReached();assert.equal(f.writes(),0);});

test('после финального обмена цель завершается до покупок и заточки удочки',async()=>{
 const f=fixture({process:true});await f.F.fishTgtReached();
 Object.assign(f.state.rt,{fishSinceProc:0,fishSinceProcN:10,fishService:'exchange'});Object.assign(f.c.rt,{fishSinceProc:0,fishSinceProcN:10,fishService:'exchange'});
 Object.assign(f.c.cfg,{rodEnchantTo:10,fishGoal:'cloak_1'});
 Object.assign(f.env,{autonomyMode:()=> 'fish',waitFor:async fn=>fn(),sleep:async()=>{},rnd:a=>a,
 $q:s=>s==='#fishing-shop-proof-qty'?{textContent:'100'}:s.includes('row--exchange')?{}:null,
 names:()=>assert.fail('не начинать покупки после финальной сдачи'),rodScrollsBuy:()=>assert.fail('не покупать свитки')});
 await f.F.fishExchange();assert.equal(f.state.rt.fishTgt.done,true);assert.equal(f.state.rt.fishService,null);assert.equal(f.state.cfg.fishMode,false);assert.equal(f.state.rt.fishProofFish,10);
});

test('поздний ответ IPC не возвращает старую цель поверх новой из меню',async()=>{
 const f=fixture(),ipc=f.c.ipc;f.c.ipc=async m=>{const r=await ipc(m);f.c.rt={...f.c.rt,fishTgt:{type:'fish',n:50,got:0,t:456},manualKickAt:77};f.c.cfg={fishMode:true,autoTasks:['fish','raid']};return r};
 await f.F.fishTgtReached();assert.equal(f.c.rt.fishTgt.t,456);assert.equal(f.c.cfg.fishMode,true);assert.deepEqual(f.c.cfg.autoTasks,['fish','raid']);
});
