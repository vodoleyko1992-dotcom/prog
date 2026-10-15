'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const box={console,Date,Math,location:{pathname:'/battle.html',search:'?spawnId=boss'}};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/combat.js','utf8'),box);
 const events=[],rt={char:'Hero',rbDb:{boss:{probe:{kind:'dps',t:Date.now()-60000}}},rbGoCnt:{boss:Array(10).fill(Date.now())}};
 const env={rt,cfg:{rbChipRetreat:false,rbChipMaxAttempts:1},on:true,tabOwner:true,ordinaryLiveTour:()=>true,probeFight:()=>true,$q:()=>({}),shown:()=>true,isBattle:()=>true,
 setRt:async p=>{Object.assign(rt,p);events.push('save');return{ok:true}},rec(){},sleep:async()=>{},fire:()=>events.push('fire'),waitFor:async()=>true,rbRetreat:async(c,m,w,v)=>events.push(v),rbNote:async()=>{},leaveMark(){}};
 return {env,rt,events,C:box.L2V7Factories.combat(env),ctx:{name:'Gordon',rb:{id:'boss'}},me:{cur:100,max:100},mob:{cur:10000,max:10000}};
}
for(const v of [{abort:true,why:'нет модели'},{abort:true,why:'30 секунд'},{retreat:true,why:'не окупается'},{lethal:true,why:'старая оценка'}])test('обычный тур не выходит по старому прогнозу: '+v.why,async()=>{const f=fixture();assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,v,false),null);assert.deepEqual(f.events,[])});
test('текущая опасность вызывает durable exit даже при chip off, probe off и исчерпанных попытках',async()=>{
 const f=fixture();f.env.probeFight=()=>false;
 assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,{abort:true,safety:true,why:'текущий HP ниже резерва'},false),'done');
 assert.deepEqual(f.events,['save','fire','danger']);assert.equal(f.rt.rbPreSkip.boss.safety,true);assert.equal(f.rt.rbPreSkip.boss.kind,'safety');
});
test('неподтверждённая запись опасности не разрешает выход',async()=>{const f=fixture();f.env.setRt=async()=>({ok:false});assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,{abort:true,safety:true},false),'wait');assert.deepEqual(f.events,[])});
test('эпик не получает обычный safety bypass',async()=>{const f=fixture();assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,{abort:true,safety:true},true),null);assert.deepEqual(f.events,[])});
test('вне обычного тура прежняя проба всё ещё завершает опасный прогноз',async()=>{const f=fixture();f.env.ordinaryLiveTour=()=>false;assert.equal(await f.C.rbTryExit(f.ctx,f.me,f.mob,{abort:true},false),'done');assert.deepEqual(f.events,['save','fire','skip']);assert.equal(f.rt.rbPreSkip.boss.safety,undefined)});
