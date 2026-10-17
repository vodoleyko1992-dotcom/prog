'use strict';
// 20.12 (ревизия 17.10, аудит combat/C5): отказ записи запрета rbPreSkip перед выходом из опасного боя с РБ давал вечное 'wait' —
// цикл боя не доходил до банок/лечения. Теперь после двух неудач подряд выход жмётся без записи, а зависшая запись ограничена 1,5 с.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(withTimers=false){
 const box={console,Date,Math,location:{pathname:'/battle.html',search:'?spawnId=boss'}};
 if(withTimers)Object.assign(box,{setTimeout,clearTimeout});
 vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/combat.js','utf8'),box);
 const events=[],logs=[],rt={char:'Hero',rbDb:{boss:{probe:{kind:'dps',t:Date.now()-60000}}}};
 const env={rt,cfg:{},on:true,tabOwner:true,ordinaryLiveTour:()=>true,probeFight:()=>true,$q:()=>({}),shown:()=>true,isBattle:()=>true,
 setRt:async()=>{events.push('save');return{ok:false}},rec:(...a)=>logs.push(a.join(' ')),sleep:async()=>{},fire:()=>events.push('fire'),waitFor:async()=>true,
 rbRetreat:async(c,m,w,v)=>events.push('retreat:'+v),rbNote:async()=>{},leaveMark(){}};
 return {env,rt,events,logs,C:box.L2V7Factories.combat(env),ctx:{name:'Gordon',rb:{id:'boss'}},me:{cur:100,max:100},mob:{cur:10000,max:10000}};
}
const danger={abort:true,safety:true,why:'следующий спецудар смертелен'};
test('первая неудача записи — ждём, вторая — выходим без записи (не вечное wait)',async()=>{
 const f=fixture();
 assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,danger,false),'wait');
 assert.ok(!f.events.includes('fire'),'после первой неудачи выход ещё не жмём');
 assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,danger,false),'done');
 assert.ok(f.events.includes('fire'),'после второй неудачи выход нажат: '+JSON.stringify(f.events));
 assert.ok(f.logs.some(l=>/сохранить не удалось/.test(l)));
 assert.ok(f.events.includes('retreat:danger'),'вердикт дописан после выхода');
});
test('зависшая запись запрета не держит бой дольше ≈1,5 с',async()=>{
 const f=fixture(true);f.env.setRt=()=>new Promise(()=>{});
 const t0=Date.now();
 const r=await Promise.race([f.C.rbTryExit(f.ctx,f.me,f.mob,danger,false),new Promise(res=>setTimeout(()=>res('hung'),2500))]);
 assert.equal(r,'wait');assert.ok(Date.now()-t0<2400);
});
