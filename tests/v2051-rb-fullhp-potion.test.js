'use strict';
// 20.51, лог23.10 11:47: Rudelto — порог34960 вышеMaxHP22873, зелье нажалось на полной полосе.
// Выполняем настоящие rbTurnHeal, участки выбора банки и act с управляемыми ожиданиями игры.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.L2BOT_COMBAT_SOURCE||path.join(__dirname,'../modules/combat.js'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,'реальный участок найден: '+start);return source.slice(a,b);}
const priceSource=between('function rbTurnHeal(','function frenzyDive(');
const bandSource=between('    let potAt = env.cfg.hpPotAt;','    if ((s = await mpPotStep(me, mp))');
const emergencySource=between('    if (me && me.pct <= Math.max(env.cfg.stopHp, 25)','    ctx.emWait = 0;');
const actSource=between('  const act = async ','  const t0 = Date.now();\n  let progSig');
const price=vm.runInNewContext(priceSource+';rbTurnHeal;',{Math});
const copy=x=>JSON.parse(JSON.stringify(x));

function fixture({hp=22873,max=22873,pct=hp/max*100,sp=1329,p90=13002,hits=[],rb=true,cfg={},dbExtra={}}={}){
 let live={cur:hp,max,pct},global=0,change=null,stage='gameFree',picks=0;
 const fired=[],pot={title:'Зілля зцілення'},stopClick=Error('fixture click boundary');
 const ctx={rb:rb?{id:'boss',hits:copy(hits),potOn:false}:null,block:{},seq:[]};
 const env={on:true,tabOwner:true,isBattle:()=>true,canAct:()=>true,pvpPending:()=>false,
  cfg:{hpPotAt:50,stopHp:25,rbBandAuto:true,rbTurnPrice:true,rbPotAt:75,rbPotTo:80,rbUsePots:true,rbPotReserve:10,nDrain:'',...cfg},
  rt:{rbDb:{boss:{sp,hitP90:p90,...dbExtra}}},meHp:()=>live,
  hpPotByDeficit:deficit=>{picks++;assert.ok(deficit>0,'банка выбирается только для реальной недостачи');return pot},
  hpPotPick:()=>{picks++;return pot},hpPots:()=>[pot],qty:b=>b?800:0,
  rec:()=>{},cleanTitle:s=>s,names:()=>[],slotAction:()=> 'battle_potion_use',
  combatCooldown:{globalWait:()=>global,skillWait:()=>0},cdSpawn:()=> 'boss',
  observeSlot:()=>{},fire:b=>{fired.push(b);throw stopClick}};
 const box={env,ctx,me:copy(live),mp:{cur:1839,max:1839},Math,Number,console,
  Date:class extends Date{static now(){return 1800000000000}},
  actionContext:()=> 'same-owner',battleOwner:'same-owner',pendingTurn:null,turnAnswered:()=>true,
  waitNet:async()=>true,victory:()=>false,defeat:()=>false,
  pulse:async()=>{global=0;if(change&&stage==='global'){const f=change;change=null;f()}},
  gameFree:async()=>{if(change&&stage==='gameFree'){const f=change;change=null;f()}return{dT:0,gE:0}},
  lockA:0,lockB:0,noticeText:()=>'',fastMark:()=>{},affordable:()=>true,
  hpReserveBlocked:()=>false,frenzyDive:()=>false,epicFrenzyHold:()=>false,epicFrenzyFloor:()=>0,slotsBy:()=>[],
  drainPick:()=>null,mageCombat:()=>false,drainPreferred:()=>false,healPick:()=>null,
  lastHpPot:0,lastAct:0,lastActT:0};
 vm.createContext(box);vm.runInContext(priceSource+'\n'+actSource+'\nthis.actualAct=act;',box);
 async function step(which='band'){
  const block=which==='emergency'?emergencySource:bandSource;
  return vm.runInContext('(async()=>{for(let once=0;once<1;once++){'+block+'}return {lastHpPot,potOn:ctx.rb?.potOn,potTimes:ctx.rb?.potT?.length||0};})()',box);
 }
 return{env,ctx,box,pot,fired,step,live:()=>live,picks:()=>picks,
  fillAt(where='gameFree'){stage=where;if(where==='global')global=100;change=()=>{live={...live,cur:live.max,pct:100}}},
  changeAt(fn){change=()=>{live=fn(live)}},
  async expectClick(which='band'){await assert.rejects(step(which),e=>e===stopClick);assert.deepEqual(fired,[pot])}};
}

test('полныйHP не требует банки даже при цене хода вышеMaxHP; сам порог сохранён',()=>{
 const r=price({cur:22873,max:22873,spike:1329,p90:13002,stopPct:25});
 assert.equal(r.floor,21958);assert.equal(r.at,34960);assert.equal(r.need,false);
 assert.equal(price({cur:22874,max:22873,spike:1329,p90:13002,stopPct:25}).need,false);
});
for(const deficit of [1,600,10000,22872])test('реальный дефицит '+deficit+' HP сохраняет прежнюю срочность сильногоРБ',()=>{
 assert.equal(price({cur:22873-deficit,max:22873,spike:1329,p90:13002,stopPct:25}).need,true);
});
test('прежняя безопасная и аварийная цена хода не меняется',()=>{
 assert.equal(price({cur:4333,max:5417,spike:1995,p90:359,stopPct:25}).need,false);
 assert.equal(price({cur:3000,max:5417,spike:1995,p90:359,stopPct:25}).need,true);
 assert.equal(price({cur:1800,max:5417,spike:708,p90:196,stopPct:25}).need,true);
});
test('реальный шаг Rudelto на полномHP не выбирает и не нажимает банку',async()=>{
 const f=fixture(),r=await f.step();assert.equal(f.picks(),0);assert.deepEqual(f.fired,[]);assert.equal(r.potOn,false);assert.equal(r.lastHpPot,0);
});
test('абсолютный полныйHP защищён и при устаревшем процентеHUD',async()=>{
 const f=fixture({pct:24,cfg:{rbTurnPrice:false}});await f.step();assert.equal(f.picks(),0);assert.deepEqual(f.fired,[]);
});
for(const deficit of [1,600,10000])test('настоящий шаг с дефицитом '+deficit+' HP по прежнему нажимает банку',async()=>{
 await fixture({hp:22873-deficit}).expectClick();
});
for(const phase of ['gameFree','global'])test('исцеление до полногоHP в '+phase+' отменяет банку перед реальнымfire и снимает отметку расхода',async()=>{
 const f=fixture({hp:10000});f.fillAt(phase);const r=await f.step();assert.deepEqual(f.fired,[]);assert.equal(r.lastHpPot,0);assert.equal(r.potTimes,0);
});
test('частичное исцеление во время ожидания сохраняет полезную банку',async()=>{
 const f=fixture({hp:10000});f.changeAt(h=>({...h,cur:22872,pct:99.99}));await f.expectClick();
});
test('новый урон во время ожидания не отменяет выбранную банку',async()=>{
 const f=fixture({hp:10000});f.changeAt(h=>({...h,cur:1000,pct:4.37}));await f.expectClick();
});
test('потеряHUD во время ожидания не разрешает тратить банку вслепую',async()=>{
 const f=fixture({hp:10000});f.changeAt(()=>null);const r=await f.step();assert.deepEqual(f.fired,[]);assert.equal(r.lastHpPot,0);
});
test('аварийная банка при критическомHP по прежнему нажимается',async()=>{
 await fixture({hp:1029}).expectClick('emergency');
});
for(const phase of ['gameFree','global'])test('аварийная банка после полного исцеления в '+phase+' также отменяется',async()=>{
 const f=fixture({hp:1029});f.fillAt(phase);const r=await f.step('emergency');assert.deepEqual(f.fired,[]);assert.equal(r.lastHpPot,0);assert.equal(r.potTimes,0);
});
test('аварийная банка не тратится при полномHP и старом проценте',async()=>{
 const f=fixture({pct:4});await f.step('emergency');assert.deepEqual(f.fired,[]);
});
test('свежий одиночный ударRahha не скрывается старымP90≈635',async()=>{
 const f=fixture({hp:11921,max:21521,sp:2770,p90:635,hits:[10576]});await f.expectClick();assert.equal(f.ctx.rb.potOn,true);
});
test('два свежих удара до накопления трёх образцов уже повышают запасHP',async()=>{
 const f=fixture({hp:11921,max:21521,sp:2770,p90:635,hits:[4955,10576]});await f.expectClick();
});
test('новая серия обычных ударов не скрывается даже при наличии прежнегоP90',async()=>{
 const f=fixture({hp:11921,max:21521,sp:2770,p90:635,hits:[4955,5200,5100]});await f.expectClick();
});
test('при более низких текущих ударах прежний высокийP90 остаётся',async()=>{
 const f=fixture({hp:10000,sp:1329,p90:13002,hits:[635,700,640]});await f.expectClick();
});
test('старыйmaxHit и записи другогоРБ не выдаются за свежий полученный удар',async()=>{
 const f=fixture({hp:11921,max:21521,sp:2770,p90:635,hits:[],dbExtra:{maxHit:20000}});
 f.env.rt.rbDb.other={sp:20000,hitP90:20000,maxHit:20000};await f.step();assert.deepEqual(f.fired,[]);assert.equal(f.ctx.rb.potOn,false);
});
test('пустые и некорректные свежие значения не меняют прежнюю оценку',async()=>{
 const f=fixture({hp:11921,max:21521,sp:2770,p90:635,hits:[]});f.ctx.rb.hits=[null,0,-1,NaN,Infinity];await f.step();assert.deepEqual(f.fired,[]);assert.equal(f.ctx.rb.potOn,false);
});
