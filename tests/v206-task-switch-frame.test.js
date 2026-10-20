'use strict';
// Лог 16.10 23:31: новый список задач блокировал клики внутри старого вываживания.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
function fixture(){
 const box={console,Date,document:{querySelectorAll:()=>[]},MutationObserver:class{observe(){}}};
 for(const n of ['actions','fishing'])vm.runInNewContext(read('modules/'+n+'.js'),box);
 const target={textContent:'Old Box',querySelector:s=>({textContent:s.includes('__hp')?'100 / 2000':s.includes('__state')?'Reeling':'Old Box'})};
 let clicks=0,waits=0;
 const env={rt:{char:'hero',manualKickAt:1},cfg:{autoTasks:['fish','auto'],reactMin:0,reactMax:0},on:true,tabOwner:true,mode:()=>env.cfg.autoTasks.includes('fish')?'fish':'farm',lease:()=>1,
  fishBaitStat:{},NET_FISH:{},rnd:()=>0,antibotState:()=>false,shown:()=>true,$q:s=>s==='#fishing-target'?target:null,
  setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rec(){},fire(){clicks++;return false},
  waitFor:async fn=>{waits++;env.change?.();assert.equal(fn(),true,'ожидание отдаёт управление сразу после смены выбора');return true},
  tvtStep:async()=>{env.change?.();return false},canAct:()=>A.canAct()};
 const A=box.L2V7Factories.actions(env),F=box.L2V7Factories.fishing(env);A.enterFrame();
 return{env,A,F,counts:()=>({clicks,waits})};
}
for(const change of ['remove','add','kick','stop','lease'])test('вываживание отдаёт устаревший frame: '+change,async()=>{
 const f=fixture();f.env.change=()=>{if(change==='remove')f.env.cfg.autoTasks=['auto'];if(change==='add')f.env.cfg.autoTasks.push('mammon');if(change==='kick')f.env.rt.manualKickAt++;if(change==='stop')f.env.on=false;if(change==='lease')f.env.tabOwner=false;};
 await f.F.fishFight();assert.deepEqual(f.counts(),{clicks:0,waits:0});assert.equal(f.env.rt.fishCastActive,true);
 if(['remove','add','kick'].includes(change)){assert.equal(f.A.canAct(),false);f.A.enterFrame();assert.equal(f.A.canAct(),true);}
});
test('ожидание ответа на уже отправленный приём прерывается сменой frame',async()=>{
 const f=fixture();f.env.change=()=>{f.env.cfg.autoTasks=['auto'];};
 const lines=await f.F.fishAct('reeling');assert.equal(lines.tmo,true);assert.deepEqual(f.counts(),{clicks:1,waits:1});assert.equal(f.A.canAct(),false);
 f.A.enterFrame();assert.equal(f.A.canAct(),true);
});
test('устаревший frame не нажимает даже первый приём',async()=>{
 const f=fixture();f.env.cfg.autoTasks=['auto'];await f.F.fishAct('reeling');assert.deepEqual(f.counts(),{clicks:0,waits:0});
});
test('main доводит активную рыбу без нового заброса при следующей задаче',async()=>{
 const source=read('content.js'),start=source.indexOf('\n  if (!fishNow() && isFishing()'),end=source.indexOf('\n  // «🛒 Закупить сейчас»',start);assert.ok(start>=0&&end>start);
 for(const active of [true,false])for(const urgent of [true,false]){
  let fight=0,next=0;const b={rt:{shop:{urgent}},fishNow:()=>false,isFishing:()=>true,fishState:()=>active,fishFight:async()=>{fight++},sleep:async()=>{}};
  await vm.runInNewContext('(async()=>{for(let i=0;i<1;i++){'+source.slice(start,end)+'next()}})()',{...b,next:()=>next++});
  assert.equal(fight,active&&!urgent?1:0);assert.equal(next,active&&!urgent?0:1);
 }
});
test('боевой цикл тоже возвращает устаревший frame до тактики и кликов',async()=>{
 const src=read('modules/combat.js'),start=src.indexOf('  while (env.on && env.tabOwner) {'),end=src.indexOf('    strengthReliable(',start);assert.ok(start>=0&&end>start);
 for(const allowed of [true,false]){let tactics=0;await vm.runInNewContext('(async()=>{'+src.slice(start,end)+'tactics();break;}})()',{env:{on:true,tabOwner:true,canAct:()=>allowed},actionContext:()=> 'same',battleOwner:'same',tactics:()=>tactics++});assert.equal(tactics,allowed?1:0);}
});

test('ожидание карты отдаёт новый выбор до ожидания DOM и счётчика ошибок',async()=>{
 const src=read('modules/mobfarm.js'),start=src.indexOf('async function mapReady('),end=src.indexOf('\n// 8.0.3',start);assert.ok(start>=0&&end>start);
 const b={Date,env:{canAct:()=>false,waitFor:async f=>f(),serverDown:()=>assert.fail('новая задача уже выбрана')}};
 vm.runInNewContext(src.slice(start,end),b);assert.equal(await b.mapReady(),'changed');
});
test('оба ожидания карты не продолжают устаревший маршрут',()=>{
 const src=read('modules/mobfarm.js');assert.match(src,/mr === 'changed' \|\| mr === 'down'/);assert.match(src,/if \(await mapReady\(15000\) === 'changed'\) return/);
});
