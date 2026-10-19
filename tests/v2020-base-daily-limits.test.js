'use strict';
// 19.10.2026: новые базовые лимиты и обновление только прежнего заводского диапазона.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),D=require('../defaults.js'),src=read('content.js');
const once=src.match(/const once =[^\n]+/)[0],start=src.indexOf("  once('dailyKill2010'"),end=src.indexOf('  const ha =',start),migrations=src.slice(start,end);
const clone=x=>structuredClone(x),OLD={min:8434,max:9119},oldRanges=()=>({dailyKillLimit:{...OLD},dailyFishLimit:{...OLD}});
function migrate(input={},runtime={}){
 const cfg={...clone(D.CFG),...clone(input)},rt=clone(runtime),cf={},rf={},C=k=>Object.hasOwn(cf,k)?cf[k]:cfg[k];
 vm.runInNewContext(once+'\n'+migrations,{cfg,rt,cf,rf,C,...D});
 return clone({cfg:{...cfg,...cf},rt:{...rt,...rf},cf,rf});
}
test('чистая установка и базовый профиль:8000 мобов точным числом,1511–1564 рыбы',()=>{
 const base=JSON.parse(read('base-profile.json')).cfg,x=migrate();
 for(const cfg of [D.CFG,base,x.cfg]){
  assert.equal(cfg.dailyKillLimit,8000);assert.equal(cfg.limitRanges.dailyKillLimit,undefined);
  assert.equal(cfg.dailyFishLimit,1511);assert.deepEqual(cfg.limitRanges.dailyFishLimit,{min:1511,max:1564});
 }
 assert.equal(x.cfg.dailyLimits8000_20261019,1);assert.equal(x.rt.dailyLimits8000_20261019,1);
});
for(const value of [8434,8726,9119])test('старые заводские границы и выбранное сегодня число'+value+' заменяются вместе',()=>{
 const dailyQuota={day:'2026-10-19',auto:3000,cat:1000,raid:200,fish:500},farmQuota={auto:{got:24,pending:{spawn:'s1'}}},raidMobMarks={s1:{seq:7}},other={min:2,max:5,value:3,seq:8};
 const x=migrate({dailyKill2010:1,dailyKillLimit:value,dailyFishLimit:value,limitRanges:{...oldRanges(),autoKillLimit:{min:2,max:5}}},{dailyQuota,farmQuota,raidMobMarks,kills:4200,limitRolls:{dailyKillLimit:{...OLD,value,seq:9},dailyFishLimit:{...OLD,value,seq:4},autoKillLimit:other}});
 assert.equal(x.cfg.dailyKillLimit,8000);assert.equal(x.cfg.limitRanges.dailyKillLimit,undefined);assert.equal(x.cfg.dailyFishLimit,1511);assert.deepEqual(x.cfg.limitRanges.dailyFishLimit,{min:1511,max:1564});
 assert.deepEqual(x.rt.limitRolls,{autoKillLimit:other});assert.deepEqual(x.rt.dailyQuota,dailyQuota);assert.deepEqual(x.rt.farmQuota,farmQuota);assert.deepEqual(x.rt.raidMobMarks,raidMobMarks);assert.equal(x.rt.kills,4200);
});
test('профиль со старыми границами до первого выбора не возвращает прежний диапазон мобов',()=>{
 const x=migrate({dailyKill2010:1,limitRanges:oldRanges()});
 assert.equal(x.cfg.dailyKillLimit,8000);assert.equal(x.cfg.limitRanges.dailyKillLimit,undefined);assert.equal(x.cfg.dailyFishLimit,1511);assert.deepEqual(x.cfg.limitRanges.dailyFishLimit,{min:1511,max:1564});
});
test('старая миграция и новая за один reload сохраняют прежний выбранный заводской лимит до его замены',()=>{
 const x=migrate({dailyKillLimit:8800,dailyFishLimit:9000,limitRanges:oldRanges()},{limitRolls:{dailyKillLimit:{value:8800},dailyFishLimit:{value:9000},catKillLimit:{value:7}}});
 assert.equal(x.cfg.dailyKillLimit,8000);assert.deepEqual(x.cfg.limitRanges,{dailyFishLimit:{min:1511,max:1564}});assert.deepEqual(x.rt.limitRolls,{catKillLimit:{value:7}});
});
test('свои точные числа, в том числе0 и прежнее8434 без диапазона, сохраняются',()=>{
 for(const n of [0,1200,8434,9000]){
  const rolls={dailyFishLimit:{value:n}},x=migrate({dailyKill2010:1,dailyKillLimit:n,dailyFishLimit:n,limitRanges:{}},{limitRolls:rolls});
  assert.equal(x.cfg.dailyKillLimit,n);assert.equal(x.cfg.dailyFishLimit,n);assert.deepEqual(x.cfg.limitRanges,{});assert.deepEqual(x.rt.limitRolls,rolls);
 }
});
test('свои диапазоны и выбранные значения не меняются',()=>{
 const limitRanges={dailyKillLimit:{min:7500,max:7900},dailyFishLimit:{min:1511,max:1564}},limitRolls={dailyKillLimit:{value:7800,seq:2},dailyFishLimit:{value:1520,seq:3}};
 const x=migrate({dailyKill2010:1,dailyKillLimit:7800,dailyFishLimit:1520,limitRanges},{limitRolls});
 assert.equal(x.cfg.dailyKillLimit,7800);assert.equal(x.cfg.dailyFishLimit,1520);assert.deepEqual(x.cfg.limitRanges,limitRanges);assert.deepEqual(x.rt.limitRolls,limitRolls);
});
test('несовпадающее число или выключенный лимит при старых границах не считается заводским выбором',()=>{
 for(const n of [0,7000,9200,8500.5]){
  const limitRanges=oldRanges(),x=migrate({dailyKill2010:1,dailyKillLimit:n,dailyFishLimit:n,limitRanges});
  assert.equal(x.cfg.dailyKillLimit,n);assert.equal(x.cfg.dailyFishLimit,n);assert.deepEqual(x.cfg.limitRanges,limitRanges);
 }
});
test('каждый лимит мигрирует отдельно, собственный второй лимит и его выбор сохраняются',()=>{
 const fish={min:1500,max:1600},fishRoll={value:1550,seq:7},x=migrate({dailyKill2010:1,dailyKillLimit:8900,dailyFishLimit:1550,limitRanges:{dailyKillLimit:OLD,dailyFishLimit:fish}},{limitRolls:{dailyKillLimit:{value:8900},dailyFishLimit:fishRoll}});
 assert.equal(x.cfg.dailyKillLimit,8000);assert.equal(x.cfg.dailyFishLimit,1550);assert.deepEqual(x.cfg.limitRanges,{dailyFishLimit:fish});assert.deepEqual(x.rt.limitRolls,{dailyFishLimit:fishRoll});
});
test('once флаг в cfg или rt не повторяет замену после ручной настройки и смены героя',()=>{
 for(const holder of ['cfg','rt']){
  const input={dailyKill2010:1,dailyKillLimit:8800,dailyFishLimit:8900,limitRanges:oldRanges()},runtime={};(holder==='cfg'?input:runtime).dailyLimits8000_20261019=1;
  const x=migrate(input,runtime);assert.equal(x.cfg.dailyKillLimit,8800);assert.equal(x.cfg.dailyFishLimit,8900);assert.deepEqual(x.cfg.limitRanges,oldRanges());
 }
 const x=migrate({dailyKill2010:1,dailyKillLimit:8800,dailyFishLimit:8900,limitRanges:oldRanges()}),edited={...x.cfg,dailyKillLimit:6000,dailyFishLimit:800,limitRanges:{}};
 const y=migrate(edited,{});assert.equal(y.cfg.dailyKillLimit,6000);assert.equal(y.cfg.dailyFishLimit,800);assert.deepEqual(y.cfg.limitRanges,{});
});
