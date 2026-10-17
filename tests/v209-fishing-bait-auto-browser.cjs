'use strict';
// 17.10.2026 (пользователь: «есть улучшенная наживка, на автомате не использует её, а потом не переключается на обычную»).
// Настоящий публичный рендер рыбалки + фабрика; игровые API синтетические, денег и аккаунта нет.
// Запуск: L2_FISHING_PUBLIC=<кэш public JS> node tests/v209-fishing-bait-auto-browser.cjs
const assert=require('node:assert/strict');
const {make,downloadPublic}=require('./v1014-fishing-public-browser.cjs');
const H=3600000;const G=(q,sel)=>({itemId:910602,name:'Якісна наживка',icon:'/icons/fishing/bait_good.png',quantity:q,selected:sel}),B=(q,sel)=>({itemId:6519,name:'Наживка',icon:'/icons/fishing/bait_basic.png',quantity:q,selected:sel});let failed=0;
async function one(title,options,act,check){
 const w=await make(options);
 try{await act(w);const x=await w.snapshot();check(x);assert.deepEqual(w.errors,[]);console.log('PASS '+title);}
 catch(e){failed++;console.error('FAIL '+title+': '+e.message.split('\n')[0]);const x=await w.snapshot().catch(()=>null);console.error(JSON.stringify({actions:x?.actions?.map(a=>a.action),rt:{baitSwapTo:x?.rt?.baitSwapTo,baitAutoWant:x?.rt?.baitAutoWant},good:x?.state?.goodBait,basic:x?.state?.basicBait,halted:x?.halted,recs:x?.recs?.slice(-4)}));}
 finally{await w.close();}
}
(async()=>{
 await downloadPublic();
 // замер говорит «хорошая не лучше» — раньше «Авто» навсегда уходило на обычную, а бесплатная хорошая из Old Box лежала в сумке
 const worse={fishBaitStat:{basic:{casts:200,ms:2*H,proof:600},good:{casts:80,ms:H,proof:250}}};
 await one('авто: хорошая есть в сумке → ловим на ней, даже если замер её не хвалит',{cfg:{fishBait:'auto'},rt:worse,state:{goodBait:G(30,false)}},
  w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.goodBait.selected,true,'good selected');assert.equal(x.state.basicBait.selected,false);});
 await one('авто: хорошая появилась (Old Box) в окне «30 мин на обычной» → переключаемся на хорошую сразу',
  {cfg:{fishBait:'auto'},rt:{baitSwapTo:'basicBait',baitSwapT:Date.now()-60000,baitAutoWant:'goodBait'},state:{goodBait:G(20,false)}},
  w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.goodBait.selected,true);});
 await one('авто: хорошей нет → обычная, журнал без паузы',{cfg:{fishBait:'auto'},state:{goodBait:G(0,false)}},
  w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.basicBait.selected,true);assert.equal(x.halted,undefined);});
 // хорошая кончилась на последнем забросе: следующий заброс должен идти на обычной, без паузы «наживка кончилась»
 await one('авто: хорошая кончилась после заброса → следующий заброс на обычной',{cfg:{fishBait:'auto'},state:{goodBait:G(1,true),basicBait:B(30,false)}},
  w=>w.run(async()=>{await F.fishing();await F.fishing();}),x=>{
   const casts=x.actions.filter(a=>a.action==='cast');assert.equal(casts.length,2,'two casts: '+JSON.stringify(x.actions.map(a=>a.action)));
   assert.equal(x.state.goodBait.quantity,0);assert.equal(x.state.basicBait.selected,true);assert.equal(x.state.basicBait.quantity,29);assert.equal(x.halted,undefined);});
 await one('ручная «обычная»: хорошая в сумке не трогается',{cfg:{fishBait:'basic'},state:{goodBait:G(30,false)}},
  w=>w.run(()=>F.fishPrepare()),x=>{assert.equal(x.state.basicBait.selected,true);assert.equal(x.state.goodBait.selected,false);});
 if(failed){console.error('FAIL: '+failed+' scenarios');process.exitCode=1;}else console.log('PASS: fishing bait auto, public renderer, 5 scenarios; authenticated game requests: 0');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
