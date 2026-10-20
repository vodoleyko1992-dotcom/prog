'use strict';
// 20.10, журналы11:28: Battle Trance → Frenzy/Zealot раньше банок и Battle Roar.
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
 const heal=skill('Battle Roar','l2_121',{n:'Battle Roar',id:121,c:'Лечение',t:'HEAL_PERCENT',target:'SELF',o:'ACTIVE',mp:25});
 const pot=skill('Велике зілля HP','battle_potion_use',{n:'Велике зілля HP'});pot.kind='предмет';
 slots.splice(0,slots.length,atk,trance,frenzy,zealot,heal,pot);
 const names=s=>String(s||'').split(/[,|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 Object.assign(env.cfg,{destroyerLimits:true,nKeyBuffs:'Frenzy, Zealot',nBuffs:'',nHeal:'Battle Roar',nPower:'',nUltra:'',nAttack:'Атака',autoRoles:false,chain:false,rbFrenzyDive:false,hpPotAt:50,stopHp:25,rbTurnPrice:false});
 Object.assign(env.rt,{prof:'orc_destroyer',classCur:{prof:'orc_destroyer',slot:0},skillDb:{},rbDb:{},buffAt:{}});
 Object.assign(env,{names,slotKind:b=>b===atk?'атака':b.kind||'скилл',slotAction:b=>b===atk?'attack':b.action,ilOf:b=>typeof b==='string'?slots.find(x=>x.title.toLowerCase()===b.toLowerCase())?.meta:b?.meta,
  skillMp:()=>0,buffActive:(bn,b)=>active.has(String(b?.title||bn).toLowerCase()),meHp:()=>({cur,max,pct:cur/max*100}),meMp:()=>({cur:mp,max:3841,pct:mp/3841*100}),qty:b=>b===pot?100:null,
  hpPotPick:()=>pot,hpPots:()=>[pot],hpPotByDeficit:()=>pot,HP_POT_RE:/HP|зілля/i,activeBuffs:()=>[],
  combatCooldown:{globalWait:()=>0,skillWait:a=>cooldown.has(a)?1000:0,recentlyGlobalRejected:()=>false},
  fire:b=>{
   used.push(b.title);seq++;f.setNet({start:seq,done:seq,okN:seq,ok:true,action:env.slotAction(b),doneT:0});
   if(b===trance){if(o.failedDrop)return false;if(!o.noDrop)cur=Math.floor(max*(o.dropPct??.25));}
   else if(b===frenzy||b===zealot){active.add(b.title.toLowerCase());mp-=b.meta.mp;}
   else if(b===heal||b===pot){cur=max;env.on=false;}
   else env.on=false;
   return true;
  },pause:async()=>{},rbFlee:()=>null,rbAssess:()=>{},rbLearn:()=>{},hpPotLeft:()=>100
 });
 const ctx={block:{},...(o.rb?{rb:{id:'rb-fixture',hits:[]}}:{})};
 if(o.rb)env.rt.rbDb['rb-fixture']={hitP90:100,sp:200};
 if(o.battleRb){env.isBoss=()=>true;env.rbAssess=()=>({retreat:false});env.rt.via='manual';env.rt.target=null;f.location.search='?spawnId=l2dop_rb_fixture';env.rt.rbDb.l2dop_rb_fixture={hitP90:100,sp:200};}
 return {...f,ctx,used,active,cooldown,trance,frenzy,zealot,heal,pot,setHp:n=>cur=n,setMp:n=>mp=n,plan:()=>combat.limitPlan(ctx,env.meHp(),env.meMp())};
}
for(const rb of [false,true])test('план снижает HP только для готовых выбранных лимитов: '+(rb?'РБ':'обычный бой'),()=>{
 const f=fixture({rb});const p=f.plan();assert.equal(p?.kind,'trance');assert.equal(p.b,f.trance);
 assert.equal(f.combat.ready(f.trance),false,'общий запрет случайной атакующей роли сохранён');
 f.setHp(Math.floor(37261*.25));assert.equal(f.plan()?.b,f.frenzy);f.active.add('frenzy');assert.equal(f.plan()?.b,f.zealot);
 f.active.add('zealot');assert.equal(f.plan(),null,'после лимитов повторного слива нет');
});
for(const prof of ['human_warlock','dwarf_bounty_hunter','orc_tyrant','human_warlord',''])test('чужой/неизвестный активный класс запрещает снижение HP: '+prof,()=>{
 const f=fixture();f.env.rt.classCur={prof,slot:1};f.env.rt.prof=prof;assert.equal(f.plan(),null);
});
test('актуальный сабкласс важнее сохранённой основной профессии',()=>{
 const f=fixture();f.env.rt.prof='orc_destroyer';f.env.rt.classCur={prof:'dwarf_bounty_hunter',slot:1};assert.equal(f.plan(),null);
 f.env.rt.prof='human_warlock';f.env.rt.classCur={prof:'orc_titan',slot:0};assert.equal(f.plan()?.b,f.trance);
});
test('явное OFF сохраняет обычное лечение и запрещает HP-сброс',()=>{const f=fixture();f.env.cfg.destroyerLimits=false;assert.equal(f.plan(),null);});
test('без выбранных Frenzy/Zealot Battle Trance не запускается',()=>{const f=fixture();f.env.cfg.nKeyBuffs='Guts';assert.equal(f.plan(),null);});
test('когда оба лимита активны либо на КД, HP не снижается',()=>{
 for(const active of [true,false]){const f=fixture();if(active){f.active.add('frenzy');f.active.add('zealot');}else{f.cooldown.add('l2_176');f.cooldown.add('l2_420');}assert.equal(f.plan(),null);}
});
test('Battle Trance на КД или отсутствует: нет автоматического ожидания урона',()=>{
 const f=fixture();f.cooldown.add('battle_trance');assert.equal(f.plan(),null);f.cooldown.clear();f.slots.splice(f.slots.indexOf(f.trance),1);assert.equal(f.plan(),null);
});
test('MP резервируется на оба недостающих готовых лимита до снижения HP',()=>{
 const f=fixture({mp:160});assert.equal(f.plan(),null,'25+136 MP не хватает');f.setMp(200);assert.equal(f.plan()?.kind,'trance');
});
test('ниже опасного HP приоритет восстановлению, а не подготовке лимитов',()=>{const f=fixture({hp:100});assert.equal(f.plan(),null);});
test('известный смертельный спецудар РБ запрещает искусственный слив',()=>{
 const f=fixture({rb:true});f.env.rt.rbDb['rb-fixture']={sp:10000,hitP90:1000};assert.equal(f.plan(),null);
});
test('известные обычные удары РБ учитываются вместе со спецударом',()=>{
 const f=fixture({rb:true});f.env.rt.rbDb['rb-fixture']={sp:2000,hitP90:4000};assert.equal(f.plan(),null);
});
test('реальный battle: Battle Trance → Frenzy → Zealot → лечение без Stop/Start',async()=>{
 const f=fixture();await f.combat.battle();assert.deepEqual(f.used,['Battle Trance','Frenzy','Zealot','Велике зілля HP']);assert.ok(f.env.rt.buffAt.frenzy>0);assert.ok(f.env.rt.buffAt.zealot>0);
});
test('естественное HP25%: реальные Frenzy/Zealot раньше банки, без повторного Trance',async()=>{
 const f=fixture({hp:Math.floor(37261*.25)});await f.combat.battle();assert.deepEqual(f.used,['Frenzy','Zealot','Велике зілля HP']);
});
test('неудачный сброс не зацикливается и не мешает обычной атаке',async()=>{
 const f=fixture({failedDrop:true});await f.combat.battle();assert.equal(f.used.filter(x=>x==='Battle Trance').length,1);assert.ok(f.used.includes('Атака'));
});
for(const change of ['stop','class','off'])test('последняя сверка во время gameFree: '+change,async()=>{
 const f=fixture();let busy=true;
 f.env.gameBusy=()=>({busy,end:0});f.env.sleep=async()=>{if(!busy)return;busy=false;if(change==='stop')f.env.on=false;if(change==='class')f.env.rt.classCur.prof='dwarf_bounty_hunter';if(change==='off')f.env.cfg.destroyerLimits=false;};
 await f.combat.battle();assert.ok(!f.used.includes('Battle Trance'));
});

test('РБ без замеров не использует неподтверждённую безопасность HP25%',()=>{const f=fixture({rb:true});f.env.rt.rbDb={};assert.equal(f.plan(),null);});
test('активен только Frenzy: готовится только Zealot',()=>{const f=fixture({active:['frenzy']});assert.equal(f.plan()?.b,f.trance);f.setHp(Math.floor(37261*.25));assert.equal(f.plan()?.b,f.zealot);});
test('получен ответ без уменьшения HP: один Trance, затем обычный бой',async()=>{const f=fixture({noDrop:true});await f.combat.battle();assert.deepEqual(f.used,['Battle Trance','Атака']);});
test('реальный РБ: оба лимита до банки даже при HP босса100%',async()=>{const f=fixture({battleRb:true});await f.combat.battle();assert.deepEqual(f.used,['Battle Trance','Frenzy','Zealot','Велике зілля HP']);});
test('опасный реальный ответ Trance HP10%: банка раньше лимитов',async()=>{const f=fixture({dropPct:.10});await f.combat.battle();assert.deepEqual(f.used,['Battle Trance','Велике зілля HP']);});
test('локальное имя без native battle_trance не разрешает расход HP',()=>{const f=fixture();f.trance.action='unknown_action';assert.equal(f.plan(),null);});
test('HP уже снизилось во время ожидания: Trance отменён, лимиты применены',async()=>{
 const f=fixture();let busy=true;f.env.gameBusy=()=>({busy,end:0});f.env.sleep=async()=>{if(busy){busy=false;f.setHp(Math.floor(37261*.25));}};
 await f.combat.battle();assert.deepEqual(f.used,['Frenzy','Zealot','Велике зілля HP']);
});
test('MP исчезло во время ожидания: Trance отменён до клика',async()=>{
 const f=fixture();let busy=true;f.env.gameBusy=()=>({busy,end:0});f.env.sleep=async()=>{if(busy){busy=false;f.setMp(0);}};
 await f.combat.battle();assert.ok(!f.used.includes('Battle Trance'));
});
test('новый опасный замер РБ во время ожидания отменяет расход HP',async()=>{
 const f=fixture({battleRb:true});let busy=true;f.env.gameBusy=()=>({busy,end:0});f.env.sleep=async()=>{if(busy){busy=false;f.env.rt.rbDb.l2dop_rb_fixture={sp:10000,hitP90:2000};}};
 await f.combat.battle();assert.ok(!f.used.includes('Battle Trance'));
});
test('сильный спецудар из пробы запрещает снижение HP',()=>{
 const f=fixture({rb:true});f.env.rt.rbDb['rb-fixture']={hitP90:100,probe:{sp:10000}};assert.equal(f.plan(),null);
});
test('неполные данные активного сабкласса не используют старую профессию',()=>{
 const f=fixture();f.env.rt.classCur={slot:1};assert.equal(f.plan(),null);
});
test('стоимость Zealot в HP входит в запас после Trance',()=>{
 const f=fixture({rb:true});f.env.rt.rbDb['rb-fixture']={hitP90:100,sp:8700};assert.equal(f.plan()?.kind,'trance');
 f.zealot.meta.hp=[159,204,500];assert.equal(f.plan(),null);
});
test('явно недоступный в этом бою лимит не служит причиной слива',()=>{
 const f=fixture();f.ctx.block['buff:frenzy']=Infinity;f.ctx.block['buff:zealot']=Infinity;assert.equal(f.plan(),null);
});
test('общие умолчания и меню дают выключатель подготовки',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),root=path.join(__dirname,'..'),box={};vm.runInNewContext(fs.readFileSync(path.join(root,'defaults.js'),'utf8'),box);
 assert.equal(box.L2Defaults.CFG.destroyerLimits,true);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'base-profile.json'),'utf8')).cfg.destroyerLimits,true);
 assert.match(fs.readFileSync(path.join(root,'popup.html'),'utf8'),/id="destroyerLimits" type="checkbox"/);assert.match(fs.readFileSync(path.join(root,'popup.js'),'utf8'),/'destroyerLimits'/);
});
test('неизвестные HP/MP запрещают намеренный расход HP',()=>{
 const f=fixture();for(const mp of [null,{}, {cur:NaN}, {cur:Infinity}])assert.equal(f.combat.limitPlan(f.ctx,f.env.meHp(),mp),null);
 for(const me of [{cur:Infinity,max:37261,pct:100},{cur:37261,max:37261,pct:NaN}])assert.equal(f.combat.limitPlan(f.ctx,me,f.env.meMp()),null);
});
