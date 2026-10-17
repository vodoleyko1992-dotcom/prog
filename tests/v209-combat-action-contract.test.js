'use strict';
// 17.10.2026: единый допуск ролей и MP — старые роли не превращают поддержку в удар.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const source=fs.readFileSync(process.env.L2_COMBAT_SOURCE||path.join(__dirname,'../modules/combat.js'),'utf8');
function fixture(){
 const panel=[],state={force:3,mp:50};
 const env={cfg:{nPower:'',nUltra:'',nForce:'',nCharge:'',nStun:'',nHeal:'',nDrain:'',nAttack:'',skillMpMin:35,stunEvery:0,ultMode:'always'},rt:{skills:{},skillDb:{}},SLOT:'.slot',
 cleanTitle:s=>String(s||'').split(/\s+[—–-]\s+|\s*\(/)[0].trim(),names:s=>String(s||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean),
 ilOf:b=>typeof b==='string'?panel.find(x=>x.title.toLowerCase()===b.toLowerCase())?.il:b?.il,
 slotKind:b=>b.kind||'скилл',slotAction:b=>b.action||b.title.toLowerCase(),skKey:b=>b.title.toLowerCase(),isEquip:()=>false,
 slotCd:()=>null,memLeft:()=>0,cdSpawn:()=> 'same-spawn',battleSpawn:()=> 'same-spawn',combatCooldown:{skillWait:()=>0},shown:b=>!!b&&!b.hidden,
 $q:s=>s==='#battle-mob-hp-val'?{textContent:'10000 / 10000'}:null,combatProfileKind:()=> 'fighter',meHp:()=>({cur:1000,max:1000,pct:100}),meMp:()=>({cur:state.mp,max:500}),
 skillMp:()=>0,noEffect:b=>!!b?.ineffective,forceNow:()=>state.force,forceMax:()=>3,forceCosts:()=>env.cfg.nForce?[{name:env.cfg.nForce,cost:1}]:[],
 isChargeName:n=>n==='Focused Force',isForceName:()=>false,expDmg:()=>1000,longFightMp:()=>null,turnSec:()=>1,powerOf:()=>0,mpPotSlot:()=>null,chargeValue:()=>0};
 const box={console,Date,document:{querySelectorAll:()=>panel},location:{search:'?spawnId=same-spawn'}};vm.runInNewContext(source,box);
 const C=box.L2V7Factories.combat(env),ctx={block:{},lastStun:0};
 const add=(title,il={},extra={})=>{const b={title,il,getAttribute:()=>null,...extra};panel.push(b);return b;};
 return {C,ctx,env,panel,state,add,mp:()=>env.meMp()};
}
test('точное имя Heal выбирается раньше видимого Heal Servitor',()=>{const f=fixture();f.add('Heal Servitor');const own=f.add('Heal (ур. 2)',{}, {hidden:true});assert.equal(f.C.slotsBy('Heal')[0],own)});
test('Heal не совпадает с подстрокой Healing Potion',()=>{const f=fixture();f.add('Healing Potion',{}, {kind:'предмет'});assert.equal(f.C.slotsBy('Heal').length,0)});
for(const [label,il,extra] of [
 ['цель-труп',{c:'Маг. атака',t:'DRAIN',target:'CORPSE_MOB'},{}],
 ['проц',{c:'Физ. атака',t:'PDAM',o:'CHANCE'},{}],
 ['нет эффекта',{c:'Физ. атака',t:'PDAM'},{ineffective:true}],
 ['бафф',{c:'Бафф',t:'BUFF'},{}],
 ['питомец',{c:'Лечение',t:'HEAL',target:'PET'},{}]
]) for(const role of ['nPower','nForce','nUltra'])test(role+' отвергает: '+label,()=>{const f=fixture();f.add('Wrong Skill',il,extra);f.env.cfg[role]='Wrong Skill';assert.equal(f.C.chooseAction(f.ctx,f.mp()),null)});
for(const role of ['nPower','nForce','nUltra','nStun','nCharge'])test(role+': замер MP0 не отменяет известную цену100 при MP50',()=>{
 const f=fixture();const name=role==='nCharge'?'Focused Force':'Power Strike';f.add(name,{c:role==='nCharge'?'Заряд':'Физ. атака',t:role==='nCharge'?'CHARGE':'PDAM',mp:100});
 f.env.cfg[role]=name;f.ctx.champ=role==='nStun';if(role==='nCharge'){f.state.force=0;f.env.forceCosts=()=>[{name:'Power Strike',cost:1}];f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:100})}
 assert.equal(f.C.chooseAction(f.ctx,f.mp()),null);
});
test('цена текущего изученного ранга важнее заниженного замера MP',()=>{const f=fixture();f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:20});f.env.rt.skillDb['power strike']={mp:100,mpKnown:true};f.env.cfg.nPower='Power Strike';assert.equal(f.C.chooseAction(f.ctx,f.mp()),null)});
test('недоступный силовой уступает настоящей атаке',()=>{const f=fixture();f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:100});const a=f.add('Атака',{}, {kind:'атака',action:'attack'});f.env.cfg.nPower='Power Strike';f.env.cfg.nAttack='Атака';assert.equal(f.C.chooseAction(f.ctx,f.mp())?.b,a)});
test('подтверждённый совмещённый удар/дебафф сохраняется',()=>{const f=fixture();const b=f.add('Corpse Plague',{c:'Дебафф',t:'DEBUFF',l2Damage:true,mp:20});f.env.cfg.nPower='Corpse Plague';assert.equal(f.C.chooseAction(f.ctx,f.mp())?.b,b)});
test('лечащая роль не исполняет атакующий навык',()=>{const f=fixture();f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:10});f.env.cfg.nHeal='Power Strike';assert.equal(f.C.healPick(f.ctx,f.mp()),null)});
test('вампиризм не исполняет бафф, no-effect или цель-труп',()=>{for(const il of [{c:'Бафф',t:'BUFF'},{c:'Маг. атака',t:'DRAIN',target:'CORPSE_MOB'}]){const f=fixture();f.add('Wrong Drain',il);f.env.cfg.nDrain='Wrong Drain';assert.equal(f.C.drainPick(f.ctx,f.mp()),null)}});
test('лечащая роль сохраняет бесплатный Corpse Life Drain по правилам L2WAP',()=>{const f=fixture();const b=f.add('Corpse Life Drain',{c:'Лечение',t:'HEAL',target:'SELF',mp:0});f.env.cfg.nHeal='Corpse Life Drain';f.state.mp=0;assert.equal(f.C.healPick(f.ctx,f.mp()),b)});
test('настоящий content.skillMp fallback30 не отменяет бесплатный IL_FIX',()=>{const f=fixture(),b=f.add('Corpse Life Drain',{c:'Лечение',t:'HEAL',target:'SELF',mp:0});f.env.cfg.nHeal='Corpse Life Drain';f.state.mp=0;
 const core=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),start=core.indexOf('function skillMp(name)');f.env.skillMp=vm.runInNewContext(core.slice(start,core.indexOf('function powerOf(',start))+'\nskillMp',{rt:f.env.rt,ilOf:f.env.ilOf});
 assert.equal(f.env.skillMp('Corpse Life Drain'),30);assert.equal(f.C.healPick(f.ctx,f.mp()),b);
});
test('ошибочная ручная роль не отменяет защиту HP атакующего навыка',()=>{const f=fixture();const b=f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:10});f.env.cfg.nHeal='Power Strike';assert.equal(f.C.healSlot(b),false)});
test('настоящий вампиризм распознаётся как лечение независимо от ручной роли',()=>{const f=fixture();const b=f.add('Vampiric Touch',{c:'Маг. атака',t:'DRAIN',mp:10});assert.equal(f.C.healSlot(b),true)});
function armed(){const f=fixture();Object.assign(f.env.rt,{char:'Hero',prof:'Warlord',classCur:{slot:0,prof:'human_warlord'},weaponsT:Date.now(),weaponNow:'Old Sword',weapons:[{id:299,inst:'eq:l1',ench:3,where:'надето',wt:'древковое'}]});return f;}
test('отказ сохраняется для той же подтверждённой экипировки',()=>{const f=armed();f.env.rt.unavailW={power:{context:f.C.weaponContext(),t:Date.now()}};assert.equal(f.C.weaponBlocks().power,Infinity)});
for(const [label,change] of [
 ['ID',f=>{f.env.rt.weapons[0].id=265}],['экземпляр',f=>{f.env.rt.weapons[0].inst='bag:299:other'}],['заточка',f=>{f.env.rt.weapons[0].ench=5}],
 ['класс',f=>{f.env.rt.classCur={slot:1,prof:'orc_tyrant'}}],['герой',f=>{f.env.rt.char='Other'}],['смена в полёте',f=>{f.env.rt.weaponMetaPending={id:265}}],
 ['нет скана',f=>{f.env.rt.weaponsT=0}],['противоречивый ID',f=>{f.env.rt.weaponEq={id:265,t:Date.now()+1}}]
])test('старый отказ не запрещает навык после смены: '+label,()=>{const f=armed();f.env.rt.unavailW={power:{context:f.C.weaponContext(),t:Date.now()}};change(f);assert.equal(f.C.weaponBlocks().power,undefined)});
test('legacy отказ по старому weaponNow не переносится на подтверждённую пику',()=>{const f=armed();f.env.rt.unavailW={power:{w:'Old Sword',t:Date.now()}};assert.equal(f.C.weaponBlocks().power,undefined)});
test('смена оружия в том же бою снимает лишь оружейный запрет, сохраняя иммунитет',()=>{
 const f=armed(),b=f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:10});f.env.cfg.nPower='Power Strike';const key='power:'+b.title;
 Object.assign(f.ctx,{weaponContext:f.C.weaponContext(),weaponBlocked:[key],block:{[key]:Infinity,'stun:Immune':Infinity}});f.env.rt.weapons[0].id=265;
 assert.equal(f.C.chooseAction(f.ctx,f.mp())?.b,b);assert.equal(f.ctx.block['stun:Immune'],Infinity);
});
test('MP после ожидания игрового GET перепроверяется перед fire',async()=>{
 const f=fixture(),b=f.add('Power Strike',{c:'Физ. атака',t:'PDAM',mp:100});f.state.mp=150;let busy=true,fires=0;
 Object.assign(f.env,{on:true,tabOwner:true,isBattle:()=>true,gameBusy:()=>({busy,end:0}),actNet:()=>({start:1,done:1,doneT:0}),sleep:async()=>{busy=false;f.state.mp=50},fire:()=>{fires++;return true}});
 Object.assign(f.env.combatCooldown,{globalWait:()=>0});
 const actSrc=source.slice(source.indexOf('  let lastHpPot = 0, lastMpPot = 0'),source.indexOf('  const t0 = Date.now();\n  let progSig'));
 const box={console,Date,Math,Map,env:f.env,ctx:f.ctx,LOCK_A:[60,500,120],LOCK_B:[30,200,50],victory:()=>false,defeat:()=>false,affordable:f.C.affordable,lostUntil:new Map(),NOMP_MS:1500};
 // 20.12 (ревизия 17.10): нехватка MP — отдельный результат 'nomp' (слот на паузе), 'lock' — только потерянный клик
 vm.runInNewContext(actSrc+'\nthis.act=act;',box);assert.equal(await box.act(b,'Power'), 'nomp');assert.equal(fires,0);
});
