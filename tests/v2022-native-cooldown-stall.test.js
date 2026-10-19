'use strict';
// 19.10,20.22: перед поражениями воин простаивал с nativeID и «интерфейс0мс».
// Проверяем реальные combat/resources и серверную модель, без запросов в игру.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
const {createBattleCooldown}=require('../battle-cooldown.js');
const ROOT=path.resolve(__dirname,'..'),SOURCE=fs.readFileSync(path.join(ROOT,'modules/combat.js'),'utf8');

function deadlineFixture(action='whirlwind'){
 let now=1000000;
 const model=createBattleCooldown(()=>now),net={start:1,done:1,doneT:now};
 const overlay={busy:true,timer:'2.3'},logs=[];
 const b={title:'Native skill',disabled:false,getAttribute:()=>null};
 const cd={hidden:false,classList:{contains:()=>overlay.busy},querySelector:()=>({textContent:overlay.timer})};
 const env={rt:{},cfg:{},slotCd:()=>cd,slotAction:()=>action,skKey:()=> 'native skill',slotKind:()=> 'скилл',
  cdSpawn:()=> 'same-boss',memLeft:()=>0,combatCooldown:model,actNet:()=>net,ilOf:()=>null,
  cleanTitle:x=>x,rec:(...x)=>logs.push(x.join(' '))};
 class Clock extends Date{static now(){return now;}}
 const box={Date:Clock,console,Math,Map,WeakMap,WeakSet};box.globalThis=box;
 vm.runInNewContext(SOURCE,box);const combat=box.L2V7Factories.combat(env);
 const press=()=>{combat.pressAt.set('native skill',now);now+=50;};
 const reply=(remaining=1100,spawn='same-boss')=>model.observe({action,battleSpawnId:spawn},
  {serverNowMs:5000000,delta:{skillCooldowns:{[action]:5000000+remaining}}},200,spawn);
 const grace=()=>{combat.ready(b);now+=1201;};
 return {env,model,net,b,cd,overlay,logs,combat,press,reply,grace,tick:n=>now+=n,now:()=>now};
}

for(const action of ['whirlwind','wild_sweep','thunder_storm','war_cry','l2_36'])
 test(action+': точный серверный дедлайн возвращает застывший навык после1200мс',()=>{
  const f=deadlineFixture(action);f.press();f.reply();
  assert.equal(f.combat.ready(f.b),false,'серверный КД ещё действует');
  f.tick(1141);assert.equal(f.combat.ready(f.b),false,'начало отдельного ожидания рисунка');
  f.tick(1000);assert.equal(f.combat.ready(f.b),false,'1000мс недостаточно для обхода рисунка');
  f.tick(201);assert.equal(f.combat.ready(f.b),true);
  assert.equal(f.logs.filter(x=>/застыл/.test(x)).length,1);
  f.tick(100);f.combat.ready(f.b);assert.equal(f.logs.filter(x=>/застыл/.test(x)).length,1);
 });

for(const reason of ['unknown','before press','wrong spawn','pending','lost click','expired','disabled','aria-disabled','not a skill'])
 test('nativeID не обходит запрет: '+reason,()=>{
  const f=deadlineFixture();
  if(reason==='before press'){f.reply(0);f.tick(100);f.press();}
  else {f.press();if(reason!=='unknown')f.reply(0,reason==='wrong spawn'?'previous-boss':'same-boss');}
  if(reason==='pending')f.net.start++;
  if(reason==='lost click')f.combat.lostUntil.set('native skill',f.now()+10000);
  if(reason==='expired')f.tick(30000);
  if(reason==='disabled')f.b.disabled=true;
  if(reason==='aria-disabled')f.b.getAttribute=()=> 'true';
  if(reason==='not a skill')f.env.slotKind=()=> 'предмет';
  f.grace();assert.equal(f.combat.ready(f.b),false);
 });

test('два потерянных нажатия после обхода возвращают доверие рисунку nativeID',async()=>{
 const f=deadlineFixture();f.press();f.reply(0);f.grace();
 assert.equal(f.combat.ready(f.b),true);
 await f.combat.rememberCd(f.b,'lost');assert.equal(f.combat.ready(f.b),true);
 await f.combat.rememberCd(f.b,'lost');assert.equal(f.combat.ready(f.b),false);
});

test('обычное завершение рисунка обнуляет1200мс ожидания nativeID',()=>{
 const f=deadlineFixture();f.press();f.reply(0);f.combat.ready(f.b);f.tick(600);
 f.overlay.busy=false;assert.equal(f.combat.ready(f.b),true);
 f.overlay.busy=true;assert.equal(f.combat.ready(f.b),false);f.tick(601);
 assert.equal(f.combat.ready(f.b),false,'повторно занятый рисунок не наследует прежние600мс');
 f.tick(600);assert.equal(f.combat.ready(f.b),true);
});

// Настоящий battle(), с тем же стендом DOM/награды, что остальные сквозные тесты.
const imported={console,URLSearchParams,setTimeout,__dirname:__dirname,module:{exports:{}},
 require:n=>n==='node:test'?()=>{}:require(n)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'v1014-combat-outcomes.test.js'),'utf8')+'\nmodule.exports={flowFixture};',imported);
const {flowFixture}=imported.module.exports;
function battleFixture({known=false,attackReady=false,weak=false,disabled=false,aria=false,noAttack=false,
 pending=false,gcd=0,attackCd=0,progress=false,cap=0,stopAt=7500,pendingNoClock=false}={}){
 const f=flowFixture('fighter'),{env,box,combat,slots}=f;
 let now=1000000,loops=0;
 const start=now,calls=[],reloads=[],hangs=[];
 class Clock extends Date{static now(){return now;}}
 box.Date=Clock;
 const native={title:weak?'Wild Sweep':'Whirlwind',disabled,getAttribute:()=>aria?'true':null};
 slots.push(native);if(noAttack)slots.splice(slots.indexOf(f.atk),1);
 f.hp.textContent='50000 / 50000';
 f.location.search='?spawnId=l2dop_rb_test';
 Object.assign(env.cfg,{nAttack:'атака',nPower:native.title,nDrain:'',nHeal:'',nBuffs:'',nUltra:'',
  petAuto:false,hpPotAt:50,stopHp:25,rbMode:true,rbBandAuto:false,rbTurnPrice:true,rbPotAt:75,rbPotTo:80});
 Object.assign(env.rt,{via:'manual',target:null,shopT:now,skills:{}});
 env.names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 env.meHp=()=>({cur:9000,max:10000,pct:90});env.meMp=()=>({cur:1000,max:1000,pct:100});
 env.isBoss=()=>true;env.slotKind=b=>b===f.atk?'атака':'скилл';
 const action=weak?'wild_sweep':'whirlwind',key=native.title.toLowerCase(),spawn='l2dop_rb_test';
 env.slotAction=b=>b===native?action:'attack';env.cdSpawn=()=>spawn;env.battleSpawn=()=>spawn;
 env.ilOf=b=>b===native?{c:'Физ. атака',t:'PDAM',mp:20}:null;
 env.expDmg=k=>String(k).toLowerCase()===key?(weak?1200:3000):1000;
 env.rt.skills[key]={uses:5,dmgN:5,dmg:weak?1200:3000};
 env.skKey=b=>String(typeof b==='string'?b:b.title).toLowerCase();env.memLeft=()=>0;
 const overlay={hidden:false,classList:{contains:()=>true},querySelector:()=>({textContent:'2.3'})};
 env.slotCd=b=>(b===f.atk&&!attackReady||b===native&&!weak)?overlay:null;env.uiTimer=()=>2.3;
 const model=createBattleCooldown(()=>now);env.combatCooldown=model;
 const net={start:pending?2:1,done:1,doneT:now,t:pendingNoClock?0:now,ok:true,okN:0};env.actNet=()=>net;
 combat.pressAt.set(key,now);
 if(known)model.observe({action,battleSpawnId:spawn},{serverNowMs:5000000,delta:{skillCooldowns:{[action]:5002000}}},200,spawn);
 if(gcd||attackCd)model.observeSync({serverNowMs:5000000,
  ...(gcd?{globalCooldownUntilMs:5000000+gcd}:{}),
  ...(attackCd?{nextPhysicalAttackAt:5000000+attackCd}:{})},spawn);
 env.rbAssess=()=>({retreat:false});env.rbFlee=()=>null;env.fightSpikeEta=()=>null;
 env.isChargeName=()=>false;env.isForceName=()=>false;
 env.HP_POT_RE=/зцілення|healing potion/i;
 env.potKey=b=>String(b?.title||'').toLowerCase();env.potName=b=>b?.title||'';
 vm.runInContext(fs.readFileSync(path.join(ROOT,'modules/resources.js'),'utf8'),box);
 const resources=box.L2V7Factories.resources(env);
 Object.assign(env,{ready:combat.ready,slotsBy:combat.slotsBy,hpPots:resources.hpPots,
  hpPotPick:resources.hpPotPick,hpPotByDeficit:resources.hpPotByDeficit});
 env.gameBusy=()=>({busy:false,end:0});env.pause=async()=>{};
 env.sleep=async ms=>{now+=ms;if(now-start>=stopAt)env.on=false;};
 env.waitFor=async(fn,ms=0)=>{let x=fn();if(x)return x;now+=ms;return fn();};
 env.antibotState=()=>{if(++loops>20000)throw Error('bounded actual battle');if(now-start>=stopAt){env.on=false;return true;}return false;};
 env.srvHangMark=(why,kind)=>hangs.push({why,kind,at:now-start});
 env.fire=b=>{calls.push({b,at:now-start});env.on=false;return true;};
 f.location.reload=()=>{reloads.push(now-start);env.on=false;};
 if(progress)env.logLines=()=>['внешнее обновление '+Math.floor((now-start)/500)];
 if(cap)box.sessionStorage.setItem('l2bot.mageReload',JSON.stringify(Array.from({length:cap},(_,i)=>now-1000-i*1000)));
 return {...f,native,model,net,calls,reloads,hangs,elapsed:()=>now-start};
}

test('battle воина нажимает застывший nativeWhirlwind после дедлайна и grace, раньше6с',async()=>{
 const f=battleFixture({known:true});await f.combat.battle();
 assert.equal(f.calls[0]?.b,f.native);assert.ok(f.calls[0].at>=3240&&f.calls[0].at<6000);
 assert.equal(f.reloads.length,0);assert.equal(f.hangs.length,0);
});

test('готовый WildSweep слабее1.6атаки используется, пока сама атака недоступна',async()=>{
 const f=battleFixture({weak:true});await f.combat.battle();
 assert.equal(f.calls[0]?.b,f.native);assert.equal(f.reloads.length,0);
});

test('готовая атака сохраняет прежнее предпочтение перед слабым WildSweep',async()=>{
 const f=battleFixture({weak:true,attackReady:true});await f.combat.battle();
 assert.equal(f.calls[0]?.b,f.atk);
});

test('неизвестный серверу застывший навык до6с не продавливается и не вызывает reload',async()=>{
 const f=battleFixture({stopAt:5900});await f.combat.battle();
 assert.equal(f.calls.length,0);assert.equal(f.reloads.length,0);assert.equal(f.hangs.length,0);
});

test('воин без действий и прогресса6с перечитывает интерфейс вместо20с ожидания',async()=>{
 const f=battleFixture();await f.combat.battle();
 assert.equal(f.calls.length,0);assert.equal(f.reloads.length,1);
 assert.ok(f.reloads[0]>6000&&f.reloads[0]<6500);
 assert.equal(f.hangs[0]?.kind,'interface');
});

for(const state of ['disabled','aria'])test(state+' не обходится кликом при восстановлении воина',async()=>{
 const f=battleFixture({known:true,[state]:true});await f.combat.battle();
 assert.equal(f.calls.length,0);assert.equal(f.reloads.length,1);assert.equal(f.hangs[0]?.kind,'interface');
});

for(const [name,opts] of [
 ['серверныйGCD',{gcd:20000}],['серверныйКДатаки',{attackCd:20000}],
 ['запросвполёте',{pending:true}],['свежийпрогресс',{progress:true}],['триперезагрузкиза10мин',{cap:3}]
])test('раннее восстановление не обходит '+name,async()=>{
 const f=battleFixture(opts);await f.combat.battle();
 assert.equal(f.calls.length,0);assert.equal(f.reloads.length,0);assert.equal(f.hangs.length,0);
});

test('общий лимит разрешает третью, но не четвёртую перезагрузку',async()=>{
 const f=battleFixture({cap:2});await f.combat.battle();assert.equal(f.reloads.length,1);
 const marks=JSON.parse(f.box.sessionStorage.getItem('l2bot.mageReload'));
 assert.equal(marks.length,3);
});

for(const pending of [false,true])test('20с сторож различает '+(pending?'отправленный ход':'простой интерфейса'),async()=>{
 const f=battleFixture({noAttack:true,pending,pendingNoClock:true,stopAt:23000});await f.combat.battle();
 assert.equal(f.calls.length,0);assert.equal(f.reloads.length,1);
 assert.ok(f.reloads[0]>20000&&f.reloads[0]<21000);
 assert.equal(f.hangs[0]?.kind,pending?'network':'interface');
});
