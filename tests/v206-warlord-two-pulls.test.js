'use strict';
// 16.10, журнал13:43: Howl собирает соседей, ранение главного моба не запрещает сбор.
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

function withHowl(){const f=fixture();f.panel.push({action:'howl',title:'Звіриний рев',mp:31,disabled:false,getAttribute:()=>null});return f;}
test('Provoke доступен на раненом Connabi: собираем новых соседей перед добиванием',()=>{const f=fixture();f.state.mob=458;assert.equal(f.C.chooseAction(f.ctx,f.mp).b.action,'provoke')});
test('Howl выбран при Provoke на серверном КД и пустом nDebuff',()=>{const f=withHowl();f.env.cfg.nDebuff='';f.state.cd.provoke=5000;assert.equal(f.C.chooseAction(f.ctx,f.mp).b.action,'howl')});
test('Provoke приоритетен, Howl заменяет его при нехватке MP на дорогой сбор',()=>{const f=withHowl();assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'provoke');f.mp.cur=90;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'howl');f.mp.cur=89;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('Howl учитывает собственный серверный откат',()=>{const f=withHowl();f.state.cd.howl=5000;f.state.cd.provoke=1000;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);f.state.cd.provoke=0;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'provoke')});
test('после Howl идёт AoE, второе агро в ту же группу не тратит ход',()=>{const f=withHowl();f.state.cd.provoke=5000;const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,true);f.state.extra=Array(30).fill(2772);const b=f.C.warlordPullPlan(f.ctx,f.mp);assert.equal(b.b.action,'whirlwind');f.C.warlordPullResult(f.ctx,b,true);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
for(const result of ['cd','unavail'])test('явный отказ Provoke '+result+' разрешает Howl, повтор Provoke заблокирован',()=>{const f=withHowl();const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,result);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'howl');f.panel.pop();assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
for(const result of [true,false])test('принятый/неизвестный результат Howl '+result+' не повторяет агро',()=>{const f=withHowl();f.state.cd.provoke=5000;const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,result);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).warlordPull,'hit')});
test('lock не поглощает Howl и новая проверка MP может отменить нажатие',()=>{const f=withHowl();f.state.cd.provoke=5000;const a=f.C.warlordPullPlan(f.ctx,f.mp);f.C.warlordPullResult(f.ctx,a,'lock');assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'howl');f.mp.cur=50;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
for(const [name,change]of Object.entries({'выключатель':f=>f.env.cfg.warlordAggro=false,'мало HP':f=>f.state.hp=700,'чемпион':f=>f.ctx.champ=true,'РБ':f=>f.ctx.rb={},'PvP':f=>f.env.pvpPending=()=>true,'нет пики':f=>f.env.rt.weapons[0].wt='меч','готовая группа':f=>f.state.extra=[100,200,300],'нет AoE':f=>f.env.cfg.nPower='','нет подтверждения цели':f=>f.state.kind='unknown'}))test('Howl не обходит ограничения: '+name,()=>{const f=withHowl();f.panel.shift();change(f);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('причина пропуска доступна для журнала и обновляется после восстановления готовности',()=>{const f=withHowl();f.state.cd.provoke=5000;f.state.cd.howl=5000;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null);assert.match(f.ctx.warlordPullSkip,/Provoke и Howl недоступны/);f.state.cd.howl=0;assert.equal(f.C.warlordPullPlan(f.ctx,f.mp).b.action,'howl');assert.equal(f.ctx.warlordPullSkip,'')});
