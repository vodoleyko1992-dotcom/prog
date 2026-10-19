'use strict';
// 19.10: усиленная банка у резерва блокировала все HP-банки, хотя обычных оставалось1000.
// Проверяем реальный выбор resources и круг battle; конкретную смерть этим не объясняем.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const imported={console,URLSearchParams,setTimeout,__dirname:__dirname,module:{exports:{}},
 require:n=>n==='node:test'?()=>{}:require(n)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'v1014-combat-outcomes.test.js'),'utf8')+'\nmodule.exports={flowFixture};',imported);
const {flowFixture}=imported.module.exports;

function setup({normal=1000,big=10,pct=60,allIn=false,heal=false}={}){
 const f=flowFixture('fighter'),{env,box,combat,slots}=f;
 let now=1000000,net={start:1,done:1,doneT:now,ok:true,okN:0};
 const calls=[];
 class Clock extends Date{static now(){return now;}}
 box.Date=Clock;
 const pot=(title,q)=>({title,q,getAttribute:()=>null});
 const ordinary=pot('Зілля зцілення — зілля: натисни для використання',normal);
 const large=pot('Велике зілля HP — зілля: натисни для використання',big);
 const healer={title:'Heal',getAttribute:()=>null};
 slots.push(ordinary,large);if(heal)slots.push(healer);
 f.location.search='?spawnId=l2dop_rb_test';
 Object.assign(env.cfg,{nAttack:'атака',nHpPot:'',nHeal:heal?'Heal':'',nDrain:'',nPower:'',nBuffs:'',nUltra:'',
  petAuto:false,hpPotAt:50,stopHp:25,rbMode:true,rbBandAuto:false,rbTurnPrice:true,
  rbPotAt:75,rbPotTo:80,rbPotReserve:10,rbUsePots:true});
 Object.assign(env.rt,{via:'manual',target:null,shopT:now,skills:{},pots:{}});
 env.names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 env.meHp=()=>({cur:pct*100,max:10000,pct});
 env.meMp=()=>({cur:1000,max:1000,pct:100});
 env.isBoss=()=>true;
 env.slotKind=b=>b&&Object.hasOwn(b,'q')?'предмет':b===f.atk?'атака':'скилл';
 env.slotAction=b=>b===ordinary||b===large?'battle_potion_use':b===healer?'l2_1011':'attack';
 env.HP_POT_RE=/зцілен|\bhp\b/i;
 env.potKey=b=>(b?.title||'').split(' — ')[0].toLowerCase();
 env.potName=b=>(b?.title||'').split(' — ')[0];
 env.potBag=b=>b?.q??null;
 env.qty=b=>b?.q??null;
 env.ilOf=b=>b===healer?{c:'Лечение',t:'HEAL',target:'SELF',mp:10}:null;
 env.rbAssess=ctx=>{if(allIn)ctx.rb.allIn=true;return {retreat:false};};
 env.rbFlee=()=>null;
 env.fightSpikeEta=()=>null;
 env.gameBusy=()=>({busy:false,end:0});
 env.actNet=()=>net;
 env.pause=async()=>{now+=900;};
 env.sleep=async ms=>{now+=ms;};
 env.waitFor=async(fn,ms=0)=>{let x=fn();if(x)return x;now+=ms;return fn();};
 env.fire=b=>{calls.push(b);net={start:net.start+1,done:net.start+1,doneT:now,ok:true,okN:net.okN+1,action:env.slotAction(b)};env.on=false;return true;};
 vm.runInContext(fs.readFileSync(path.join(ROOT,'modules/resources.js'),'utf8'),box);
 const resources=box.L2V7Factories.resources(env);
 Object.assign(env,{ready:combat.ready,slotsBy:combat.slotsBy,hpPots:resources.hpPots,
  hpPotPick:resources.hpPotPick,hpPotByDeficit:resources.hpPotByDeficit});
 return {...f,resources,ordinary,large,healer,calls};
}

test('общий запас1000 обычных+10 усиленных позволяет усиленную при60%HP',async()=>{
 const f=setup();
 assert.equal(f.resources.hpPotByDeficit(4000),f.large);
 assert.equal(f.combat.hpReserveBlocked(f.large,10),false);
 assert.equal(f.combat.potModel().n,1000,'единый резерв10 из1010');
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('два типа по8 разрешены: общий запас16 выше единого резерва10',async()=>{
 const f=setup({normal:8,big:8});
 assert.equal(f.combat.hpReserveBlocked(f.large,10),false);
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('общий остаток10 при60%HP сохраняется в резерве',async()=>{
 const f=setup({normal:6,big:4});
 assert.equal(f.combat.hpReserveBlocked(f.large,10),true);
 await f.combat.battle();assert.equal(f.calls[0],f.atk);
});

for(const pct of [35,25])test('приHP'+pct+'% аварийное лечение может потратить общий резерв',async()=>{
 const f=setup({normal:6,big:4,pct});
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('allIn разрешает общий резерв при60%HP',async()=>{
 const f=setup({normal:6,big:4,allIn:true});
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('лечащий скилл при40%HP уступает усиленной, когда общий запас выше резерва',async()=>{
 const f=setup({pct:40,heal:true});
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('исчерпанный общий резерв при40%HP оставляет доступным лечение скиллом',async()=>{
 const f=setup({normal:6,big:4,pct:40,heal:true});
 await f.combat.battle();assert.equal(f.calls[0],f.healer);
});

test('неизмеренный вампиризм не вытесняет усиленную у резерва при большом общем запасе',()=>{
 const f=setup({pct:40}),ctx={rb:{id:'l2dop_rb_test',hits:[]}};
 const drain={title:'Vampiric Touch',getAttribute:()=>null};
 assert.equal(f.combat.drainPreferred(ctx,f.env.meHp(),drain,f.large),false);
});

test('повторный слот одного типа не создаёт дополнительного запаса',()=>{
 const f=setup({normal:6,big:4});
 f.slots.push({...f.ordinary});
 assert.equal(f.resources.hpPots().length,3,'два DOM-слота одной банки реально видны');
 assert.equal(f.combat.hpReserveBlocked(f.large,10),true,'6+6(alias)+4 остаются10');
 assert.equal(f.combat.potModel(),null,'единый подтверждённый запас целиком зарезервирован');
});

test('повторная запись того же DOM-слота не удваивает запас',()=>{
 const f=setup({normal:6,big:4}),get=f.env.hpPots;
 f.env.hpPots=()=>{const x=get();return [x[0],x[0],x[1]];};
 assert.equal(f.combat.hpReserveBlocked(f.large,10),true);
});

test('неизвестный остаток другого типа не открывает выбранную банку из резерва',async()=>{
 const f=setup({normal:null,big:10});
 assert.equal(f.combat.hpReserveBlocked(f.large,10),true);
 await f.combat.battle();assert.equal(f.calls[0],f.atk);
});

test('неизвестный остаток выбранной банки сохраняет прежний допуск',async()=>{
 const f=setup({normal:6,big:null});
 assert.equal(f.combat.hpReserveBlocked(f.large,10),false);
 await f.combat.battle();assert.equal(f.calls[0],f.large);
});

test('при неизвестном potBag используется известный счётчик qty',()=>{
 const f=setup({normal:8,big:8});
 f.env.potBag=()=>null;
 assert.equal(f.combat.hpReserveBlocked(f.large,10),false);
});
