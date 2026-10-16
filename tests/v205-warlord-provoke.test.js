'use strict';
// 20.5: Provoke — отдельное решение, не поддержка в списке прямого урона.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const panel=[['provoke','Провокація масова',57],['whirlwind','Вихор',49],['thunder_storm','Грозова буря',67]].map(([action,title,mp])=>({action,title,mp,disabled:false,getAttribute:()=>null}));
 const state={hp:1000,max:1000,mob:2484,extra:[],infoMax:2484,kind:'normal',tier:'',age:0,cd:{},mage:false};
 const location={search:'?spawnId=dense_1'};
 const env={routeLocation:location,cfg:{warlordAggro:true,nPower:'Вихор, Грозова буря',stopHp:25,nUltra:'',nStun:'',skillMpMin:35},rt:{classCur:{prof:'human_warlord'},weaponNow:'Orcish Poleaxe',weaponsT:Date.now(),weapons:[{name:'Orcish Poleaxe',where:'надето',wt:'древковое'}],skillDb:{},skills:{}},SLOT:'.slot',
  combatProfileKind:()=>state.mage?'mage_summoner':'fighter',battleInfo:()=>({name:'Garden Guard',max:state.infoMax,kind:state.kind,tier:state.tier,t:Date.now()-state.age}),
  meHp:()=>({cur:state.hp,max:state.max,pct:state.hp/state.max*100}),cleanTitle:s=>s,names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),
  slotAction:b=>b.action,slotKind:()=> 'скилл',slotCd:()=>null,skKey:b=>b.title.toLowerCase(),ilOf:b=>({mp:typeof b==='string'?30:b.mp,autoUse:b.action==='provoke'?false:undefined}),
  memLeft:()=>0,cdSpawn:()=> 'dense_first',combatCooldown:{skillWait:key=>state.cd[key]||0},pvpPending:()=>false,
  $q:s=>s==='#battle-mob-title'?{textContent:'Garden Guard · ур.48'}:s==='#battle-mob-hp-val'?{textContent:state.mob+'/2484'}:s==='#battle-whirlwind-extras'&&state.extra.length?{textContent:state.extra.map(x=>'Garden Guard '+x+'/2484').join(' '),querySelectorAll:()=>[]}:null,
  shown:b=>!!b,forceNow:()=>0,forceCosts:()=>[],expDmg:()=>1000,isEquip:()=>false};
 const box={console,Date,document:{querySelectorAll:()=>panel},location};vm.createContext(box);vm.runInContext(fs.readFileSync('modules/combat.js','utf8'),box);
 const C=box.L2V7Factories.combat(env),ctx={block:{},champ:false,rb:false,lastStun:0};return {C,ctx,env,panel,state,mp:{cur:200,max:874},location};
}
test('Warlord собирает агро, затем первым выбирает массовый удар из своих ролей',()=>{
 const f=fixture(),a=f.C.chooseAction(f.ctx,f.mp);assert.equal(a.warlordPull,'pull');assert.equal(a.b.action,'provoke');
 f.C.warlordPullResult(f.ctx,a,true);const b=f.C.chooseAction(f.ctx,{cur:143,max:874});assert.equal(b.warlordPull,'hit');assert.equal(b.b.action,'whirlwind');
 f.C.warlordPullResult(f.ctx,b,true);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);
});
for(const [name,change]of Object.entries({
 'выключатель':f=>f.env.cfg.warlordAggro=false,'чужой класс':f=>f.env.rt.classCur.prof='human_warrior','смена саба':f=>{f.env.rt.prof='human_warlord';f.env.rt.classCur.prof='dwarf_bounty_hunter'},
 'профиль мага':f=>f.state.mage=true,'РБ':f=>f.ctx.rb={},'чемпион':f=>f.ctx.champ=true,'PvP':f=>f.env.pvpPending=()=>true,
 'чужие HP в ответе':f=>f.state.infoMax=34104,'нет HP в ответе':f=>f.state.infoMax=null,'неподтверждённое оружие':f=>f.env.rt.weapons[0].unknown=true,
 'неизвестный тип цели':f=>f.state.kind='unknown','API чемпион':f=>f.state.kind='champion','цвет чемпиона':f=>f.state.tier='orange','старый ответ':f=>f.state.age=61000,
 'мало HP':f=>f.state.hp=749,'нет HP':f=>f.state.max=0,'готовая группа':f=>f.state.extra=[100,200,300],
 'нет копья':f=>f.env.rt.weapons[0].wt='меч','неизвестное оружие':f=>f.env.rt.weaponsT=0,'переодевание':f=>f.env.rt.weaponMetaPending={},'старая запись оружия':f=>f.env.rt.weaponNow='New weapon',
 'нет Provoke':f=>f.panel.shift(),'отключённый слот':f=>f.panel[0].disabled=true,'откат Provoke':f=>f.state.cd.provoke=1000,
 'оба AoE на КД':f=>{f.state.cd.whirlwind=1000;f.state.cd.thunder_storm=1000},'AoE удалены из ролей':f=>f.env.cfg.nPower='',
 'мало MP на связку':f=>f.mp.cur=115,'неизвестная цена агро':f=>f.panel[0].mp=null,'неизвестная цена AoE':f=>{f.panel[1].mp=null;f.panel[2].mp=null},
 'локальный запрет агро':f=>f.ctx.block['aggro:Провокація масова']=Infinity
}))test('не собирает: '+name,()=>{const f=fixture();change(f);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('MP хватает ровно на обе цены и запас10; без запаса не собирает',()=>{const f=fixture();f.mp.cur=116;assert.ok(f.C.warlordPullPlan(f.ctx,f.mp));f.mp.cur=115;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('каталог MP важнее net-дельты, верх справочника важнее её занижения',()=>{const f=fixture();f.mp.cur=115;f.env.rt.skills['провокація масова']={mpN:10,mp:1};assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);f.env.rt.skillDb['провокація масова']={mp:40};assert.ok(f.C.warlordPullPlan(f.ctx,f.mp));f.env.rt.skillDb={};f.panel[0].mp=[20,60,90];f.mp.cur=140;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('Thunder Storm используется, когда Whirlwind недоступен; чужие роли не восстанавливаются',()=>{const f=fixture();f.env.cfg.nPower='Грозова буря';const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,true);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'thunder_storm')});
for(const result of [true,false])test('после результата '+result+' повторного сбора нет',()=>{const f=fixture(),a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,result);const b=f.C.warlordPullPlan(f.ctx,f.mp);assert.equal(b.warlordPull,'hit');f.C.warlordPullResult(f.ctx,b,true);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('lock до клика оставляет решение доступным, повтор не считается отправленным',()=>{const f=fixture(),a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,'lock');assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).warlordPull,'pull')});
test('за время ожидания отключение/HP/MP/смена цели отменяют прежний план',()=>{
 for(const change of [f=>f.env.cfg.warlordAggro=false,f=>f.state.hp=700,f=>f.mp.cur=40,f=>f.location.search='?spawnId=new']){const f=fixture(),a=f.C.warlordPullPlan(f.ctx,f.mp);change(f);const b=f.C.warlordPullPlan(f.ctx,f.mp);assert.ok(!b||b.b!==a.b||b.target!==a.target)}
});
test('смена цели внутри собранного боя не запускает новый Provoke',()=>{const f=fixture(),a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,true);f.location.search='?spawnId=next';assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('новый бой получает новое решение; готовая группа после reload не собирается повторно',()=>{const f=fixture();assert.ok(f.C.warlordPullPlan({block:{}},f.mp));f.state.extra=[100,100,100];assert.equal(f.C.warlordPullPlan({block:{}},f.mp),null)});

test('переключатель агро зарегистрирован для чтения/сохранения и ВКЛ только по умолчанию',()=>{
 const pop=fs.readFileSync('popup.js','utf8'),core=fs.readFileSync('content.js','utf8'),profile=JSON.parse(fs.readFileSync('base-profile.json','utf8'));
 assert.match(pop,/const BOOL = \[[^;]*'warlordAggro'/);assert.match(pop,/warlordAggro: true/);assert.match(core,/warlordAggro: true/);assert.equal(profile.cfg.warlordAggro,true);
 const f=fixture();f.env.cfg.warlordAggro=false;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);
});

test('собственный минимальный MPна скиллы сохраняется и резервируется после агро',()=>{const f=fixture();f.env.cfg.skillMpMin=500;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);f.mp.cur=560;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);f.mp.cur=567;assert.ok(f.C.warlordPullPlan(f.ctx,f.mp))});
