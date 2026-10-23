'use strict';
// 20.54 (John 23.10 02:44, Orc Raider с Claymore): Battle Trance (HP → 25 %) → Frenzy на РБ, эпиках и чемпионах для любого класса.
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
function fixture(o={}) {
 const f=flowFixture('fighter'),{env,combat,slots,atk}=f,used=[],active=new Set(o.active||[]),cooldown=new Set(o.cooldown||[]);
 let cur=o.hp??37261,mp=o.mp??3841,seq=0;
 const max=37261;
 const skill=(title,action,meta)=>({title,action,meta,querySelector:()=>null,getAttribute:()=>null});
 const trance=skill('Battle Trance','battle_trance',{n:'Battle Trance',c:'Расход HP',t:'HP_SELF_COST',target:'SELF',o:'ACTIVE',autoUse:false,mp:0});
 const frenzy=skill('Frenzy','l2_176',{n:'Frenzy',id:176,c:'Бафф',t:'BUFF',target:'SELF',o:'ACTIVE',pc:{hp:30},mp:25});
 const zealot=skill('Zealot','l2_420',{n:'Zealot',id:420,c:'Бафф',t:'BUFF',target:'SELF',o:'ACTIVE',pc:{hp:30},mp:136});
 const guts=skill('Guts','l2_139',{n:'Guts',id:139,c:'Бафф',t:'BUFF',target:'SELF',o:'ACTIVE',pc:{hp:30},mp:16});
 const heal=skill('Battle Roar','l2_121',{n:'Battle Roar',id:121,c:'Лечение',t:'HEAL_PERCENT',target:'SELF',o:'ACTIVE',mp:25});
 const pot=skill('Велике зілля HP','battle_potion_use',{n:'Велике зілля HP'});pot.kind='предмет';
 slots.splice(0,slots.length,atk,trance,frenzy,zealot,guts,heal,pot);
 const names=s=>String(s||'').split(/[,|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 Object.assign(env.cfg,{destroyerLimits:true,nKeyBuffs:'Frenzy',nBuffs:'',nHeal:'Battle Roar',nPower:'',nUltra:'',nAttack:'Атака',autoRoles:false,chain:false,rbFrenzyDive:false,hpPotAt:50,stopHp:25,rbTurnPrice:false});
 Object.assign(env.rt,{prof:o.prof||'orc_raider',classCur:{prof:o.prof||'orc_raider',slot:1},skillDb:{},rbDb:{},buffAt:{}});
 Object.assign(env,{names,slotKind:b=>b===atk?'атака':b.kind||'скилл',slotAction:b=>b===atk?'attack':b.action,ilOf:b=>typeof b==='string'?slots.find(x=>x.title.toLowerCase()===b.toLowerCase())?.meta:b?.meta,
  skillMp:()=>0,buffActive:(bn,b)=>active.has(String(b?.title||bn).toLowerCase()),meHp:()=>({cur,max,pct:cur/max*100}),meMp:()=>({cur:mp,max:3841,pct:mp/3841*100}),qty:b=>b===pot?100:null,
  hpPotPick:()=>pot,hpPots:()=>[pot],hpPotByDeficit:()=>pot,HP_POT_RE:/HP|зілля/i,activeBuffs:()=>[],
  combatCooldown:{globalWait:()=>0,skillWait:a=>cooldown.has(a)?1000:0,recentlyGlobalRejected:()=>false},
  fire:b=>{
   used.push(b.title);seq++;f.setNet({start:seq,done:seq,okN:seq,ok:true,action:env.slotAction(b),doneT:0});
   if(b===trance){if(o.failedDrop)return false;if(!o.noDrop)cur=Math.floor(max*(o.dropPct??.25));}
   else if(b===frenzy||b===zealot||b===guts){active.add(b.title.toLowerCase());mp-=b.meta.mp;}
   else if(b===heal||b===pot){cur=max;env.on=false;}
   else env.on=false;
   return true;
  },pause:async()=>{},rbFlee:()=>null,rbAssess:()=>{},rbLearn:()=>{},hpPotLeft:()=>100
 });
 const ctx={block:{},...(o.rb?{rb:{id:'rb-fixture',hits:[]}}:{}),...(o.champ?{champ:true,tier:o.tier||'blue',lvl:o.lvl||40}:{})};
 let hitsIn=o.hitsIn??[300,350,400,380];env.fightHitsIn=()=>hitsIn;env.champs={isHard:c=>c.lvl>=73&&c.tier!=='blue'};
 if(o.rb)env.rt.rbDb['rb-fixture']={hitP90:100,sp:200};
 if(o.battleRb){env.isBoss=()=>true;env.rbAssess=()=>({retreat:false});env.rt.via='manual';env.rt.target=null;f.location.search='?spawnId=l2dop_rb_fixture';env.rt.rbDb.l2dop_rb_fixture={hitP90:100,sp:200};}
 return {...f,ctx,used,active,cooldown,trance,frenzy,zealot,guts,heal,pot,setHp:n=>cur=n,setMp:n=>mp=n,setHits:h=>hitsIn=h,plan:(mob={cur:o.mobCur??900,max:1000})=>combat.limitPlan(ctx,env.meHp(),env.meMp(),mob)};
}

test('Raider на обычном мобе: Frenzy не тратим сливом HP',()=>{const f=fixture();assert.equal(f.plan(),null);});
test('Raider на РБ с замерами: Battle Trance, затем Frenzy',()=>{
 const f=fixture({rb:true});assert.equal(f.plan()?.b,f.trance);f.setHp(Math.floor(37261*.25));assert.equal(f.plan()?.b,f.frenzy);
 f.active.add('frenzy');assert.equal(f.plan(),null);
});
test('Raider на РБ без замера спецудара: не сливаем',()=>{const f=fixture({rb:true});f.env.rt.rbDb['rb-fixture']={hitP90:100};assert.equal(f.plan(),null);assert.match(f.ctx.limitSkip,/не замерены/);});
test('РБ почти добит (<10 %): Frenzy не нужен',()=>{const f=fixture({rb:true,mobCur:50});assert.equal(f.plan(),null);});
test('чемпион с замеренными ударами: слив и Frenzy',()=>{const f=fixture({champ:true});assert.equal(f.plan()?.b,f.trance);});
test('чемпион без замеров ударов: не сливаем',()=>{const f=fixture({champ:true,hitsIn:[300]});assert.equal(f.plan(),null);assert.match(f.ctx.limitSkip,/мало замеров/);});
test('чемпион бьёт сильно: HP после слива не хватит',()=>{const f=fixture({champ:true,hitsIn:[3000,3200,3100]});assert.equal(f.plan(),null);});
test('чемпион 73+ (оранжевый/красный): никогда',()=>{const f=fixture({champ:true,tier:'red',lvl:75});assert.equal(f.plan(),null);});
test('чемпион почти убит: не сливаем',()=>{const f=fixture({champ:true,mobCur:200});assert.equal(f.plan(),null);});
test('выключатель limitBig: OFF',()=>{const f=fixture({rb:true});f.env.cfg.limitBig=false;assert.equal(f.plan(),null);});
test('Дестроер на обычном мобе как раньше; на чемпионе — по строгим правилам',()=>{
 assert.equal(fixture({prof:'orc_destroyer'}).plan()?.b!=null,true);
 const f=fixture({prof:'orc_destroyer',champ:true,hitsIn:[]});assert.equal(f.plan(),null);
});
test('реальный бой Raider на РБ: Trance → Frenzy → банка',async()=>{
 const f=fixture({battleRb:true});f.env.rt.rbDb.l2dop_rb_fixture={hitP90:100,sp:200};await f.combat.battle();
 assert.deepEqual(f.used.slice(0,3),['Battle Trance','Frenzy','Велике зілля HP']);
});
test('чемпион: свой слив HP не вызывает отход «мало HP» 90 с',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),box={globalThis:{}};box.globalThis=box;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','modules','champs.js'),'utf8'),box);
 const ch=box.L2V7Factories.champs({cfg:{},rt:{}});
 const ctx={champ:true,tier:'blue',lvl:40,chHp0:10000};const me={pct:25},mob={cur:9000,max:10000};
 assert.equal(ch.fleeCheck(ctx,me,mob,7)?.kind,'danger');ctx.limitDiveT=Date.now();assert.equal(ch.fleeCheck(ctx,me,mob,7)?.kind!=='danger',true);
 assert.equal(ch.fleeCheck(ctx,{pct:10},mob,7)?.kind,'danger');
});
test('меню и умолчания: limitBig ВКЛ',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),root=path.join(__dirname,'..'),box={};vm.runInNewContext(fs.readFileSync(path.join(root,'defaults.js'),'utf8'),box);
 assert.equal(box.L2Defaults.CFG.limitBig,true);assert.match(fs.readFileSync(path.join(root,'popup.html'),'utf8'),/id="limitBig" type="checkbox"/);assert.match(fs.readFileSync(path.join(root,'popup.js'),'utf8'),/'limitBig'/);
});

test('Guts: после слива первым, затем Frenzy (лог 02:56 Hatu Weird Bee)',()=>{
 const f=fixture({rb:true});f.env.cfg.nKeyBuffs='Frenzy, Guts';assert.equal(f.plan()?.b,f.trance);
 f.setHp(Math.floor(37261*.25));assert.equal(f.plan()?.b,f.guts);f.active.add('guts');assert.equal(f.plan()?.b,f.frenzy);
});
test('Guts без готового Frenzy: ради одной защиты HP не сливаем',()=>{
 const f=fixture({rb:true});f.env.cfg.nKeyBuffs='Frenzy, Guts';f.cooldown.add('l2_176');assert.equal(f.plan(),null);
 f.setHp(Math.floor(37261*.25));assert.equal(f.plan()?.b,f.guts,'HP уже низкое само — Guts жмём');
});
test('красный чемпион бьёт по 542 при HP 5275 (лог 02:55, смерть): не сливаем',()=>{
 const f=fixture({champ:true,tier:'red',lvl:35,hitsIn:[542,542,542]});f.env.cfg.nKeyBuffs='Frenzy, Guts';
 f.setHp(5275);f.env.meHp=()=>({cur:5275,max:5275,pct:100});assert.equal(f.plan(),null);
});
