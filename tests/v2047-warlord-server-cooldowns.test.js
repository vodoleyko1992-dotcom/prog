'use strict';
// 22.10, живой Flamestone Golem44: native запрос wild_sweep получает только l2_245; Battle Roar откатывается дольше2мин.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createBattleCooldown}=require('../battle-cooldown.js'),actual=require('./fixtures/warlord-cooldowns-20261022.json');
const combatSource=fs.readFileSync(path.join(__dirname,'../modules/combat.js'),'utf8');
const hookSource=fs.readFileSync(path.join(__dirname,'../hook.js'),'utf8');
const secretStart=hookSource.indexOf('  const SECRET ='),secretEnd=hookSource.indexOf('\n',secretStart);
const battleOf=vm.runInNewContext(hookSource.slice(secretStart,secretEnd)+'\n'+hookSource.slice(hookSource.indexOf('  const battleOf = '),hookSource.indexOf('  const pvOf ='))+';battleOf');
const labBox={console,Date,Math,URLSearchParams};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/fightlab.js'),'utf8'),labBox);
const lab=labBox.L2V7Factories.fightlab({rt:{},cfg:{}}),spawn=actual.cases[0].request.battleSpawnId;
function fixture(){let now=1000000;return{model:createBattleCooldown(()=>now),now:()=>now,tick:ms=>now+=ms};}
for(const row of actual.cases){
 test('живой '+row.request.action+': native и l2_ID получают один явный серверный дедлайн',()=>{
  const f=fixture(),{model}=f;model.observe(row.request,row.response,row.status,spawn);
  const end=row.response.delta.skillCooldowns[row.canonical],remaining=end-row.response.serverNowMs;
  assert.ok(remaining>0);assert.equal(model.skillKnown(row.request.action,spawn),true);
  assert.equal(model.skillKnown(row.canonical,spawn),true);
  if(row.canonical!=='l2_1')assert.equal(model.skillKnown(row.canonical.slice(3),spawn),true);
  assert.equal(model.skillWait(row.request.action,spawn),remaining+40);
  assert.equal(model.skillWait(row.request.action,spawn),model.skillWait(row.canonical,spawn));
  f.tick(remaining+40);assert.equal(model.skillWait(row.request.action,spawn),0);
 });
 test('точные строки '+row.request.action+': основной урон, поддержка и боссы не смешиваются',()=>{
  const parsed=lab.parseLog(row.response.delta.logTail,actual.mob,actual.actor);
  assert.equal(parsed.own,row.ownDamage);assert.equal(parsed.ownN,row.ownDamage?1:0);
  if(row.request.action==='attack')assert.equal(parsed.splash.reduce((n,x)=>n+x.damage,0),20085);
  if(row.request.action==='whirlwind')assert.equal(parsed.splash.reduce((n,x)=>n+x.damage,0),19710);
  if(row.request.action==='howl'){assert.equal(parsed.spikes.length,3);assert.ok(parsed.spikes.every(x=>x.dmg===126));assert.equal(parsed.hits.length,9);}
 });
 test('hook.be '+row.request.action+' сохраняет тот же срок, независимо от сокращённого общего ответа',()=>{
  const f=fixture(),be=battleOf({pathname:'/game/battle/action'},row.response,row.request);
  f.model.observe(row.request,be,row.status,spawn);
  assert.equal(f.model.skillKnown(row.request.action,spawn),true);
  assert.equal(f.model.skillWait(row.request.action,spawn),row.response.delta.skillCooldowns[row.canonical]-row.response.serverNowMs+40);
 });
}
test('несовпадающий ID, отсутствующий срок и неизвестное имя не превращаются в готовый навык',()=>{
 const f=fixture(),server=5000000;
 f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server,delta:{skillCooldowns:{l2_48:server+5000}}},200,spawn);
 assert.equal(f.model.skillKnown('wild_sweep',spawn),false);assert.equal(f.model.skillKnown('thunder_storm',spawn),true);
 assert.equal(f.model.skillKnown('unknown_native',spawn),false);
 f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server+10,delta:{}},200,spawn);
 assert.equal(f.model.skillKnown('wild_sweep',spawn),false);
});
test('новое native-наблюдение и числовой ID обновляют один срок; старый ответ его не заменяет',()=>{
 const f=fixture(),server=5000000;
 f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server,delta:{skillCooldowns:{l2_245:server+5000}}},200,spawn);
 f.tick(1000);f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server+1000,skillCooldowns:{wild_sweep:server+3000}},200,spawn);
 assert.equal(f.model.skillWait('wild_sweep',spawn),2040);assert.equal(f.model.skillWait('l2_245',spawn),2040);
 assert.equal(f.model.skillWait('245',spawn),2040,'числовой alias не оставляет прежний более длинный срок');
 f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server-1,skillCooldowns:{l2_245:server+50000}},200,spawn);
 assert.equal(f.model.skillWait('wild_sweep',spawn),2040);
});
test('запоздалый native-ответ от другого спавна и global отказ не дают таймер навыка',()=>{
 const f=fixture(),server=5000000;
 f.model.observe({action:'wild_sweep',battleSpawnId:'old'},{serverNowMs:server,delta:{skillCooldowns:{l2_245:server+5000}}},200,spawn);
 assert.equal(f.model.skillKnown('wild_sweep',spawn),false);
 f.model.observe({action:'wild_sweep',battleSpawnId:spawn},{serverNowMs:server,blockedBy:'global',cooldownUntilMs:server+5000},400,spawn);
 assert.equal(f.model.skillKnown('wild_sweep',spawn),false);
});
for(const kind of ['generic','array','row'])test('явный чужой numeric ID не переопределяет известный native: '+kind,()=>{
 const f=fixture(),server=5000000,req={action:'whirlwind',battleSpawnId:spawn};
 const res=kind==='generic'?{serverNowMs:server,skillId:181,cooldownUntilMs:server+5000}
  :kind==='array'?{serverNowMs:server,skillId:181,skillCooldowns:[{skillId:181,readyAt:server+5000}]}
  :{serverNowMs:server,skillCooldowns:[{skillId:181,action:'whirlwind',readyAt:server+5000}]};
 f.model.observe(req,res,200,spawn);
 assert.equal(f.model.skillKnown('whirlwind',spawn),false);assert.equal(f.model.skillKnown('l2_36',spawn),false);
 assert.equal(f.model.skillWait('181',spawn),5040);
});
for(const ms of [178231,600000,900000])test('явный skill-дедлайн '+ms+'мс конечен и не продлевается свежим временем получения',()=>{
 const f=fixture(),server=5000000;
 const req={action:'battle_roar',battleSpawnId:spawn},res={serverNowMs:server,delta:{skillCooldowns:{l2_121:server+ms}}};
 f.model.observe(req,res,200,spawn);
 assert.equal(f.model.skillKnown('battle_roar',spawn),true);assert.equal(f.model.skillWait('battle_roar',spawn),ms+40);
 f.tick(30000);assert.equal(f.model.skillKnown('battle_roar',spawn),false,'старое наблюдение не продавливает застывший рисунок');
 f.model.observe(req,res,200,spawn);
 assert.equal(f.model.skillKnown('battle_roar',spawn),false,'replay не делает старый серверный ответ свежим');
 assert.equal(f.model.skillWait('battle_roar',spawn),ms+40-30000);
 f.tick(ms+40);assert.equal(f.model.skillWait('battle_roar',spawn),0);
 f.model.observe(req,res,200,spawn);assert.equal(f.model.skillWait('battle_roar',spawn),0,'старый срок не воскрешается после истечения');
});
test('слишком далёкий skill-срок и global срок за прежним пределом игнорируются',()=>{
 const f=fixture(),server=5000000;
 f.model.observe({action:'battle_roar',battleSpawnId:spawn},{serverNowMs:server,globalCooldownUntilMs:server+120001,delta:{skillCooldowns:{l2_121:server+900001}}},200,spawn);
 assert.equal(f.model.skillKnown('battle_roar',spawn),false);assert.equal(f.model.globalWait(spawn),0);
});
test('combat.ready видит живой native Wild Sweep и ждёт сервер, затем возвращает кнопку',()=>{
 const row=actual.cases.find(x=>x.request.action==='wild_sweep'),f=fixture(),b={title:'Дикий розмах',disabled:false,getAttribute:()=>null};
 const env={rt:{},cfg:{},slotCd:()=>null,slotAction:()=> 'wild_sweep',skKey:()=> 'дикий розмах',slotKind:()=> 'скилл',
  cdSpawn:()=>spawn,memLeft:()=>0,combatCooldown:f.model,actNet:()=>({start:1,done:1}),ilOf:()=>null};
 class Clock extends Date{static now(){return f.now();}}
 const box={Date:Clock,console,Math,Map,WeakMap,WeakSet};vm.runInNewContext(combatSource,box);const combat=box.L2V7Factories.combat(env);
 f.model.observe(row.request,row.response,row.status,spawn);
 assert.equal(combat.ready(b),false);f.tick(1000);assert.equal(combat.ready(b),false);
 f.tick(5000);assert.equal(combat.ready(b),true);
});
