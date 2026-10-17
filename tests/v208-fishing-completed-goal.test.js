'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8'),src=read('modules/fishing.js');
function fixture({active=false,target=false,legacy=false,done=true}={}){
 const calls={setup:0,time:0,prepare:0,cast:0,fight:0,halt:0,reconcile:0};
 const env={on:true,tabOwner:true,rt:{char:'hero',fishCastActive:active,fishTgt:{type:'fish',n:100,got:100,done,doneT:123},fishSinceProc:9},
 cfg:{...(legacy?{fishMode:true}:{autoTasks:['fish','auto']}),fishProcess:true},NET_FISH:{},setStatus(){},rec(){},
 setRt:async p=>{Object.assign(env.rt,p);env.duringSave?.(p);return {ok:true}},halt:async()=>{calls.halt++;env.on=false},
 $q:()=>null,shown:()=>false,rnd:()=>0,sleep:async()=>env.duringSleep?.(),waitFor:async()=>{env.duringReady?.();return true}};
 // 17.10: цель выключает только рыбалку, общий Stop больше не вызывается.
 env.finishFishGoal=async T=>{env.rt.fishTgt=T.done?T:{...T,done:true,doneT:Date.now()};env.cfg.fishMode=false;if(env.cfg.autoTasks)env.cfg.autoTasks=env.cfg.autoTasks.filter(k=>k!=='fish');return true};
 const box={console,Date,document:{querySelectorAll:()=>[]}};vm.runInNewContext(src,box);const F=box.L2V7Factories.fishing(env);
 const ctx={env,fishOwn:()=>env.on&&env.tabOwner,fishNow:()=>true,castReconcile:async()=>{calls.reconcile++;return !!env.pending},
 fishSetup:async()=>{calls.setup++;return false},fishState:()=>target?{}:null,fishFight:async()=>{calls.fight++;env.rt.fishCastActive=false},
 fishTimeTopUp:async()=>{calls.time++},fishingTimeRemainingMs:()=>10000,fishTgtReached:()=>F.fishTgtReached(),
 fishPrepare:async()=>{calls.prepare++;return true},fSlot:()=>({}),fOk:()=>true,fishWatch(){},fishLog:()=>[],curBait:()=> 'basic',
 Date,Math,console};env.qty=()=>10;env.fire=()=>{calls.cast++;env.on=false;return false};env.payments={blocked:()=>false};
 const section=src.slice(src.indexOf('async function fishing()'),src.indexOf('// 10.0.13 (аудит 14.10): у рыболовной'));
 const run=vm.runInNewContext('('+section+')',ctx);return {env,F,calls,run};
}
for(const legacy of [false,true])test('выполненная цель блокирует обслуживание и новый заброс; legacy='+legacy,async()=>{
 const f=fixture({legacy});await f.run();assert.equal(f.calls.cast,0);assert.equal(f.calls.setup,0);assert.equal(f.calls.time,0);assert.equal(f.calls.halt,0);assert.equal(f.env.rt.fishTgt.doneT,123);assert.equal(f.env.rt.fishService,undefined);
});
test('сохранённый active без рыбы снимается, выполненная цель не запускает покупки',async()=>{
 const f=fixture({active:true});await f.run();assert.equal(f.env.rt.fishCastActive,false);assert.equal(f.calls.cast,0);assert.equal(f.calls.setup,0);assert.equal(f.calls.time,0);
});
test('уже начатое вываживание завершается, следующий заход не делает заброс',async()=>{
 const f=fixture({active:true,target:true});await f.run();assert.equal(f.calls.fight,1);assert.equal(f.calls.cast,0);assert.equal(f.calls.setup,0);
});
test('неизвестный заброс сначала сверяется, completed не теряет pending',async()=>{
 const f=fixture();f.env.pending=true;await f.run();assert.equal(f.calls.reconcile,1);assert.equal(f.calls.halt,0);assert.equal(f.calls.setup,0);assert.equal(f.calls.cast,0);
});
test('цель стала выполненной пока загружалась панель — без пополнения времени',async()=>{
 const f=fixture({done:false});f.env.duringReady=()=>{f.env.rt.fishTgt.done=true};await f.run();assert.equal(f.calls.time,0);assert.equal(f.calls.prepare,0);assert.equal(f.calls.cast,0);
});
test('цель выполнена во время реакции перед забросом — клик запрещён',async()=>{
 const f=fixture({done:false});f.env.rt.fishTgt.got=99;f.env.duringSleep=()=>{f.env.rt.fishTgt.done=true};await f.run();assert.equal(f.calls.prepare,1);assert.equal(f.calls.cast,0);
});
test('повтор завершения не переделывает улов, не меняет doneT и не сбрасывает цель',async()=>{
 const f=fixture();await f.F.fishTgtReached();await f.F.fishTgtReached();assert.equal(f.env.rt.fishTgt.done,true);assert.equal(f.env.rt.fishTgt.doneT,123);assert.equal(f.env.rt.fishService,undefined);
});
test('активная невыполненная цель сохраняет финальную разделку',async()=>{
 const f=fixture({done:false});await f.F.fishTgtReached();assert.equal(f.env.rt.fishTgt.final,true);assert.equal(f.env.rt.fishService,'cut');assert.equal(f.env.rt.fishTgt.done,false);
});

test('реальная рыба доводится даже без сохранённого active',async()=>{
 const f=fixture({active:false,target:true});await f.run();assert.equal(f.calls.fight,1);assert.equal(f.calls.cast,0);assert.equal(f.calls.setup,0);
});
test('цель выполнена пока сохранялось намерение заброса — несделанный клик отменяется',async()=>{
 const f=fixture({done:false});f.env.rt.fishTgt.got=99;f.env.duringSave=p=>{if(p.fishCastPending)f.env.rt.fishTgt.done=true};await f.run();assert.equal(f.calls.cast,0);assert.equal(f.env.rt.fishCastPending,null);
});
test('невыполненная цель допускает штатный заброс',async()=>{
 const f=fixture({done:false});f.env.rt.fishTgt.got=99;await f.run();assert.equal(f.calls.cast,1);assert.equal(f.env.rt.fishTgt.done,false);
});
