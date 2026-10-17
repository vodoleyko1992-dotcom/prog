'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),SRC=ROOT+'/modules/combat.js';
const {createBattleCooldown}=require(ROOT+'/battle-cooldown.js');
const customFs={...fs,readFileSync:(file,...args)=>fs.readFileSync(String(file)===ROOT+'/modules/combat.js'?SRC:file,...args)};
const imported={console,URLSearchParams,setTimeout,__dirname:ROOT+'/tests',module:{exports:{}},require:n=>n==='node:test'?()=>{}:n==='fs'?customFs:require(n)};
vm.runInNewContext(fs.readFileSync(ROOT+'/tests/v1014-combat-outcomes.test.js','utf8')+'\nmodule.exports={flowFixture};',imported);
function setup(o={}){
 const f=imported.module.exports.flowFixture('mage'),{env,box,combat,slots,hp,blaze}=f;
 let now=1000000,hero=o.hero??5500,network={start:1,done:1,doneT:0,ok:true,okN:0},calls=[],sleeps=0,loops=0,damageApplied=false;
 class Clock extends Date {static now(){return now}}box.Date=Clock;
 const vt={title:'Vampiric Touch',getAttribute:()=>null},pot={title:'Зілля зцілення',getAttribute:()=>null};slots.push(vt);if(o.pot)slots.push(pot);
 hp.textContent=(o.mob??50000)+' / '+(o.mob??50000);
 Object.assign(env.cfg,{nDrain:'Vampiric Touch',nHpPot:'Зілля зцілення',nHeal:'',nPower:'Blaze',drainHp:85,petAuto:false,hpPotAt:50,stopHp:25,rbPotReserve:10});
 env.rt.skills={'vampiric touch':{dmg:1400,dmgN:1},blaze:{dmg:4000,dmgN:1}};env.rt.pots={'зілля зцілення':{kind:'hp',pulse:600,heal:600,pulses:4,n:1}};
 env.rt.shopT=now;env.names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 env.meHp=()=>({cur:hero,max:10000,pct:hero/100});env.meMp=()=>({cur:6000,max:6600,pct:91});
 env.antibotState=()=>{if(++loops>(o.maxLoops??160))throw Error('fixture exceeded bounded actual battle loops');return false};
 env.slotKind=b=>b===pot?'предмет':b===f.atk?'атака':'скилл';env.slotAction=b=>b===vt?'l2_1147':b===pot?'battle_potion_use':b===f.atk?'attack':'l2_1220';
 env.HP_POT_RE=/зцілення/i;env.potKey=b=>b?.title.toLowerCase();env.potName=b=>b.title;env.potBag=()=>1;env.qty=b=>b===pot?1:b?null:0;
 // 20.9: допуск лечения проверяет тип; настоящий Vampiric Touch — DRAIN, Blaze — MDAM.
 env.ilOf=b=>b===vt?{c:'Маг. атака',t:'DRAIN',mp:20}:b===blaze?{c:'Маг. атака',t:'MDAM',mp:20}:null;
 env.expDmg=k=>/vampiric/i.test(k)?1400:4000;env.skillMp=()=>20;env.skKey=b=>typeof b==='string'?b.toLowerCase():b.title.toLowerCase();
 env.combatCooldown=createBattleCooldown(()=>now);env.memLeft=b=>Math.max(0,(env.rt.cdUntil?.[env.skKey(b)]||0)-now)/1000;
 env.fightHealOn=()=>o.heal==null?null:{n:5,p20:o.heal,mean:o.heal};
 env.fightSpikeEta=()=>null;env.fightHpRisk=()=>({maxHit:o.incoming||332,p90:o.incoming||332});
 env.actNet=o.noHook?undefined:()=>network;env.FORCE_NEED=/never-force/;env.UNAVAIL=/never-unavail/;env.CD_RE=/перезаряд/;
 env.waitFor=async(fn,ms=0)=>{let v=fn();if(v)return v;now+=ms;return fn()};env.pause=async()=>{now+=o.pause??900};
 env.sleep=async ms=>{sleeps++;now+=ms;if(o.damageDuringWait&&!damageApplied){damageApplied=true;hero=2000}if(o.stopWait)env.on=false;if(o.leaseWait)env.tabOwner=false;};
 env.gameBusy=()=>({busy:!!(o.damageDuringWait||o.stopWait||o.leaseWait)&&now<1000200,end:0});
 env.fire=b=>{
  calls.push({name:b.title,t:now,hero});
  if(o.lostFirst&&calls.length===1)return true;
  network={start:network.start+1,done:network.start+1,doneT:now-(o.staleReceipt?5000:0),ok:true,okN:network.okN+1,action:env.slotAction(b)};
  if(!o.unknownCD)env.combatCooldown.observeSync({serverNowMs:now,globalCooldownUntilMs:now,skillCooldowns:{[env.slotAction(b)]:now+(o.cd??800)}},'first-mob');
  if(b===vt)hero=Math.min(10000,hero+(o.heal??600));if(b===pot)hero=Math.min(10000,hero+600);
  if(o.kill&&b!==pot){hp.textContent='0 / '+(o.mob??50000);f.setWon(true)}
  if(calls.length>=(o.limit??2)||o.stopAfterAccepted)env.on=false;
  return true;
 };
 vm.runInContext(fs.readFileSync(ROOT+'/modules/resources.js','utf8'),box);const resources=box.L2V7Factories.resources(env);
 Object.assign(env,{ready:combat.ready,slotsBy:combat.slotsBy,hpPots:resources.hpPots,hpPotPick:resources.hpPotPick,hpPotByDeficit:resources.hpPotByDeficit});
 return {...f,vt,pot,calls,now:()=>now,hero:()=>hero,sleeps:()=>sleeps};
}
const actions=f=>f.calls.map(x=>x.name);
test('fresh server ready at 900ms: second healing turn remains VT, not fixed 1500ms exclusion',async()=>{const f=setup();await f.combat.battle();assert.deepEqual(actions(f),['Vampiric Touch','Vampiric Touch'])});
for(const noHook of [true,false])test('no fresh cooldown with '+(noHook?'absent':'accepted')+' network hook keeps bounded anti-flood interval',async()=>{const f=setup({noHook,unknownCD:true,pause:100,limit:14});await f.combat.battle();const vt=f.calls.filter(x=>x.name==='Vampiric Touch');assert.ok(vt.length>=2);for(let i=1;i<vt.length;i++)assert.ok(vt[i].t-vt[i-1].t>=800)});
test('lost network click does not immediately spam same skill',async()=>{const f=setup({lostFirst:true,pause:100,limit:5});await f.combat.battle();const vt=f.calls.filter(x=>x.name==='Vampiric Touch');assert.equal(vt[0].name,'Vampiric Touch');for(let i=1;i<vt.length;i++)assert.ok(vt[i].t-vt[i-1].t>=700);assert.ok(f.calls.length<=5)});
for(const key of ['stopWait','leaseWait'])test(key+' during actual gameFree forbids every click',async()=>{const f=setup({[key]:true});await f.combat.battle();assert.equal(f.calls.length,0)});
test('Stop after accepted VT response forbids another action',async()=>{const f=setup({stopAfterAccepted:true});await f.combat.battle();assert.deepEqual(actions(f),['Vampiric Touch'])});
for(const [name,heal,want] of [['weak',100,'Зілля зцілення'],['unknown',null,'Зілля зцілення'],['strong',900,'Vampiric Touch']])test('emergency '+name+' current-fight self heal vs ready600 potion',async()=>{const f=setup({hero:2000,heal,pot:true,limit:1});await f.combat.battle();assert.equal(f.calls[0].name,want)});
test('pet-only historical heal cannot prove emergency VT self-heal',async()=>{const f=setup({hero:2000,pot:true,limit:1});f.env.rt.petHealGain=[4000,4000,4000];f.env.rt.skills['vampiric touch'].heal=4000;await f.combat.battle();assert.equal(f.calls[0].name,'Зілля зцілення')});
test('low mob HP is not a reason to skip needed VT healing or assume pet critical',async()=>{const f=setup({hero:2000,heal:900,pot:true,mob:500,kill:true,limit:1});f.env.rt.petStat={kai:{dmg:90000,hits:1}};await f.combat.battle();assert.equal(f.calls[0].name,'Vampiric Touch')});
test('incoming damage during actual gameFree re-evaluates weak VT against emergency potion',async()=>{const f=setup({hero:5500,heal:100,pot:true,damageDuringWait:true,limit:1});await f.combat.battle();assert.equal(f.calls[0].hero,2000);assert.equal(f.calls[0].name,'Зілля зцілення')});
module.exports={setup};

function realHealSource(f,kind){
 const dir=path.dirname(SRC),file=process.env.L2_VT_FIGHTLAB||dir+'/fightlab.js';
 const src=fs.existsSync(file)?file:require('node:path').join(__dirname,'../modules/fightlab.js');
 vm.runInContext(fs.readFileSync(src,'utf8'),f.box);Object.assign(f.env,{actName:()=> 'Vampiric Touch',activeBuffs:()=>[],recoveryContext:()=> 'stable-fixture'});
 const fl=f.box.L2V7Factories.fightlab(f.env);f.env.fightHealOn=fl.healOn;
 fl.onNet('/game/battle/start',{status:200,bt:{name:'Safe Mob',kind:'normal',spawn:'first-mob',mob:50000,mobMax:50000,hp:2000,mp:6000,seq:1,log:[]}});
 for(let seq=2;seq<=3;seq++)fl.onNet('/game/battle/action',{status:200,req:{action:'l2_1147'},bt:{name:'Safe Mob',spawn:'first-mob',mob:50000-seq*100,hp:2000,mp:6000-seq*20,seq,log:kind==='self'?['Вампірний дотик 2250','HP +900 (зцілення).','Вампіризм +900 HP']:['Слуга [Kai the Cat] атакує [Safe Mob] 9000 урону.','Servitor Heal: слуга відновив 4000 HP.']}});
 return fl;
}
test('actual fightlab self-heal samples authorize strong emergency VT',async()=>{const f=setup({hero:2000,pot:true,limit:1});const fl=realHealSource(f,'self');assert.equal(fl.healOn('Vampiric Touch')?.n,2);await f.combat.battle();assert.equal(f.calls[0].name,'Vampiric Touch')});
test('actual fightlab pet damage/heal cannot authorize emergency self-heal',async()=>{const f=setup({hero:2000,pot:true,limit:1});const fl=realHealSource(f,'pet');assert.equal(fl.healOn('Vampiric Touch'),null);await f.combat.battle();assert.equal(f.calls[0].name,'Зілля зцілення')});

test('unknown CD retry guard also holds when other spell is unavailable in damage rotation',async()=>{const f=setup({unknownCD:true,pause:100,limit:8});f.blaze.disabled=true;await f.combat.battle();const vt=f.calls.filter(x=>x.name==='Vampiric Touch');assert.ok(vt.length>=2);for(let i=1;i<vt.length;i++)assert.ok(vt[i].t-vt[i-1].t>=800,'VT retry via damage rotation at '+(vt[i].t-vt[i-1].t)+'ms')});

test('actual counter receipt with fresh doneT permits ready VT at900ms',async()=>{const f=setup();await f.combat.battle();assert.deepEqual(actions(f),['Vampiric Touch','Vampiric Touch']);assert.equal(f.env.actNet().start,3);assert.equal(f.env.actNet().done,3);assert.equal(f.calls[1].t-f.calls[0].t,900)});
test('stale doneT does not authorize immediate retry even with known zero CD',async()=>{const f=setup({staleReceipt:true,cd:0,pause:100,limit:4});f.blaze.disabled=true;await f.combat.battle();const vt=f.calls.filter(x=>x.name==='Vampiric Touch');assert.ok(vt.length>=2);for(let i=1;i<vt.length;i++)assert.ok(vt[i].t-vt[i-1].t>=800)});
