'use strict';
// Лог22.10 22:44:31: native Whirlwind после победы, без logSeq; наблюдаемая смешанная ротация отдельно от выбора агро.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),source=read('content.js'),labSource=read('modules/fightlab.js'),hookSource=read('hook.js'),actual=require('./fixtures/warlord-metrics-20261022.json');
const hookBox={SECRET:/password|token|session|secret/i};vm.runInNewContext(hookSource.slice(hookSource.indexOf('  const btOf ='),hookSource.indexOf('  const pvOf ='))+';globalThis.extract={btOf,battleOf}',hookBox);
function namesFixture(){
 let panel=[{title:'Вихор',cd:'whirlwind'},{title:'Провокація масова',cd:'provoke'},{title:'Звіриний рев',cd:'howl'},{title:'Бойовий клич',cd:'war_cry'},{title:'Полум’я',cd:'l2_1220'}];
 for(const b of panel){b.getAttribute=k=>k==='data-slot-cd'?b.cd:null;b.querySelector=()=>null;b.closest=()=>b;}
 let owner='Hero/warlord/3/lease1';const box={Map,document:{querySelectorAll:()=>panel,querySelector:s=>panel.find(b=>s.includes('"'+b.cd+'"'))||null},observeOwner:()=>owner,cleanTitle:x=>x.trim(),slotAction:b=>b.cd};
 const snap=source.slice(source.indexOf('const ACT_NAMES ='),source.indexOf('const gameBusy ='));
 const act=source.slice(source.indexOf('const actName = a =>'),source.indexOf('L2V7Modules.fightlab =',source.indexOf('const actName = a =>')));
 vm.runInNewContext(snap+'\n'+act+'\nglobalThis.api={actNameSnap,actName};',box);
 return{...box.api,hide(){panel=[]},show(p){panel=p},set owner(x){owner=x}};
}
function fixture(){
 let now=100000,rid=0,rev=439225,setup='gear-buffs-1',spawn=actual.request.spawn;const records=[];
 const env={rt:{char:'Hero',prof:'human_warlord',lvl:51,classCur:{prof:'human_warlord',slot:3},zone:'Branded',sessT0:1000,manualKickAt:1},cfg:{stopHp:25},routeLocation:{search:'?spawnId='+spawn},
 recoveryContext:()=>setup,actName:x=>x,rec:(...a)=>records.push(a),setRt:p=>{Object.assign(env.rt,p);return Promise.resolve({ok:true})},pvpPending:()=>false,mobTitle:()=> 'Lilim Magus'};
 let L;const load=()=>{const box={Date:{now:()=>now},URLSearchParams,console};vm.runInNewContext(labSource,box);L=box.L2V7Factories.fightlab(env);return L};load();
 function send(p,raw,{action='',requestId=++rid,expected=rev,actor='Hero',ms=0}={}){
 const req={action,battleSpawnId:spawn,expectedRevision:expected};raw.character={name:actor,l2Profession:env.rt.classCur.prof,classSlots:{activeSlot:env.rt.classCur.slot},hp:actual.hp,maxHp:actual.hpMax,mp:actual.mp,maxMp:actual.mpMax,...raw.character};
 raw.revision??=rev+1;rev=raw.revision;const d={status:200,ms,rid:requestId,req,res:raw,bt:hookBox.extract.btOf({pathname:p},raw),be:hookBox.extract.battleOf({pathname:p},raw,req)};return L.onNet(p,d);
 }
 const extras=()=>['Lilim Magus','Lilim Magus','Nephilim Priest'].map((name,i)=>({spawnId:'side_'+i,name,mobHp:actual.mobMax,mobMaxHp:actual.mobMax}));
 const start=()=>{now+=1000;return send('/game/battle/start',{battle:{spawnId:spawn,mobName:'Lilim Magus',kind:'normal',mobHp:actual.mobMax,mobMaxHp:actual.mobMax,log:[actual.log[0]]},character:{mp:420}})};
 const pull=()=>{now+=1000;return send('/game/battle/action',{battle:{spawnId:spawn,mobName:'Lilim Magus',kind:'normal',mobHp:actual.mobMax,mobMaxHp:actual.mobMax,whirlwindExtras:extras(),log:actual.log.slice(0,5)},character:{mp:actual.mpBefore}},{action:'provoke'})};
 const victory=()=>({revision:actual.revision,character:{mp:actual.mp},victory:{spawnId:spawn,mobName:'Lilim Magus',fullLog:actual.log}});
 return{env,records,send,start,pull,victory,load,advance:n=>now+=n,set setup(s){setup=s},get L(){return L},get row(){return env.rt.packLab?.samples?.at(-1)},get now(){return now},get rev(){return rev}};
}
function packFixture(){
 const s=read('tests/v2034-pack-efficiency.test.cjs'),a=s.indexOf('function fixture('),b=s.indexOf("\ntest(",a),box={src:labSource,h:hookBox,vm,console,Date,URLSearchParams};
 vm.runInNewContext(s.slice(a,b)+';globalThis.make=fixture;',box);return box.make();
}
test('native slot names survive the victory screen for current request, including unchanged l2_ID',()=>{
 const n=namesFixture();n.actNameSnap();n.hide();
 assert.equal(n.actName('whirlwind'),'вихор');assert.equal(n.actName('provoke'),'провокація масова');assert.equal(n.actName('howl'),'звіриний рев');assert.equal(n.actName('war_cry'),'бойовий клич');assert.equal(n.actName('l2_1220'),'полум’я');assert.equal(n.actName('attack'),'атака');
});
test('a stored native name does not survive a different actor/class/lease',()=>{
 const n=namesFixture();n.actNameSnap();n.hide();n.owner='Other/warlock/0/lease2';assert.equal(n.actName('whirlwind'),'whirlwind');n.actNameSnap();n.owner='Hero/warlord/3/lease1';assert.equal(n.actName('whirlwind'),'whirlwind');
});
test('exact33-line full victory withoutseq teaches named acceptedWhirlwind and capped usefulAoE',()=>{
 const f=fixture(),n=namesFixture();f.env.actName=n.actName;f.start();f.pull();n.actNameSnap();n.hide();f.advance(1000);
 const turn=f.send('/game/battle/action',f.victory(),{action:'whirlwind',requestId:19,expected:439227});
 assert.equal(turn.own,16137);assert.equal(turn.ownKnown,true);assert.equal(turn.name,'вихор');assert.equal(f.L.turnFor('вихор',f.now-889,'whirlwind',19)?.own,16137);
 assert.equal(f.row.skills.whirlwind.raw,64548);assert.equal(f.row.skills.whirlwind.useful,10512);assert.equal(f.row.skills.whirlwind.known,1);assert.equal(f.row.damageUnknown,0);
 assert.equal(f.L.turnFor('вихор',f.now-889,'thunder_storm',19),null);assert.equal(f.L.turnFor('вихор',f.now-889,'whirlwind',18),null);
});
test('GET same victoryrevision beforePOST cannot consume the named hit, damage, or packbaseline',()=>{
 const f=fixture(),n=namesFixture();f.env.actName=n.actName;f.start();f.pull();n.actNameSnap();n.hide();f.advance(1000);
 f.send('/game/battle',f.victory());const turn=f.send('/game/battle/action',f.victory(),{action:'whirlwind',requestId:19,expected:439227});
 assert.equal(turn?.own,16137);assert.equal(f.row.quality,true);assert.equal(f.row.accepted,2);assert.equal(f.row.skills.whirlwind.known,1);assert.equal(f.env.rt.packLab.samples.length,1);
 f.send('/game/battle/action',f.victory(),{action:'whirlwind',requestId:19,expected:439227});f.send('/game/battle',f.victory());assert.equal(f.env.rt.packLab.samples.length,1);assert.equal(f.row.skills.whirlwind.n,1);
});
test('foreign actor without anID or wrongclass cannot become a named damage sample',()=>{
 const f=fixture();f.start();f.pull();f.advance(1000);
 assert.equal(f.send('/game/battle/action',f.victory(),{action:'whirlwind',actor:'Other'}),null);assert.equal(f.row,undefined);
 const other=f.victory();other.character={l2Profession:'human_arcana_lord'};assert.equal(f.send('/game/battle/action',other,{action:'whirlwind'}),null);assert.equal(f.row,undefined);
});
test('an unchanged seqless full log under a newer revision does not attribute olddamage to support',()=>{
 const f=fixture();f.start();f.pull();f.advance(1000);
 const log=[...actual.log.slice(0,5),'Ти завдав 100 урона.'];
 f.send('/game/battle/action',{revision:439228,battle:{spawnId:actual.request.spawn,mobName:'Lilim Magus',mobHp:2528,mobMaxHp:2628,log}},{action:'attack'});
 f.send('/game/battle/action',{revision:439229,battle:{spawnId:actual.request.spawn,mobName:'Lilim Magus',mobHp:2528,mobMaxHp:2628,log}},{action:'howl'});
 assert.equal(f.env.rt.packLab.active.raw,100);assert.equal(f.env.rt.packLab.active.skills.howl,undefined);
});
test('an older stagedGET advances pack baseline before the newerPOST and excludes unseenactions from comparison',()=>{
 const f=packFixture();f.start();const log=['Бой начат','Ты нанёс [Garden Guard] 400 урона.'];
 f.send('/game/battle',{revision:f.revision+1,battle:{spawnId:f.spawn,mobName:'Garden Guard',kind:'normal',mobHp:600,mobMaxHp:1000,logSeq:1,log}});
 const turn=f.send('/game/battle/action',{revision:f.revision+1,battle:{spawnId:f.spawn,mobName:'Garden Guard',kind:'normal',mobHp:0,mobMaxHp:1000,logSeq:2,log:[...log,'Ты нанёс [Garden Guard] 800 урона.']},victory:{spawnId:f.spawn,mobName:'Garden Guard',adena:100,sp:10}},{action:'whirlwind'});
 const r=f.rows.at(-1);assert.equal(turn.own,800);assert.equal(r.raw,800);assert.equal(r.useful,600);assert.equal(r.skills.whirlwind.known,1);assert.equal(r.partial,true);assert.equal(r.quality,false);assert.equal(r.cycle,false);assert.equal(r.observedCycle,false);
});
test('a seqless full log without any previousanchor cannot teach a fresh packdamage sample',()=>{
 const f=fixture();f.start();f.pull();f.advance(1000);
 const raw=f.victory();raw.victory.fullLog=actual.log.slice(5);f.send('/game/battle/action',raw,{action:'whirlwind',expected:439227});
 assert.equal(f.row.skills.whirlwind,undefined);assert.equal(f.row.raw,0);assert.ok(f.row.damageUnknown>0);
});
test('empty loghistory accepts seqless full lines only after a proven freshbattle start',()=>{
 for(const known of [false,true]){
  const f=fixture();if(known)f.send('/game/battle/start',{battle:{spawnId:actual.request.spawn,mobName:'Lilim Magus',mobHp:2628,mobMaxHp:2628,log:[]}});
  else f.send('/game/battle',{battle:{spawnId:actual.request.spawn,mobName:'Lilim Magus',mobHp:2600,mobMaxHp:2628,log:[]}});
  f.advance(1000);const raw=f.victory();raw.victory.fullLog=actual.log.slice(5);f.send('/game/battle/action',raw,{action:'whirlwind'});
  assert.equal(f.row.raw,known?64548:0);assert.equal(f.row.skills.whirlwind?.n,known?1:undefined);
 }
});
test('alternating pulls yield observedtempo, while conservative selectioncycles remain unavailable',()=>{
 const f=packFixture();f.fight('provoke');const r=f.fight('howl');assert.equal(r.v,2);assert.equal(r.quality,true);assert.equal(r.observedCycle,true);assert.equal(r.observedCycleMs,r.ms+1000);assert.equal(r.cycle,false);
 assert.equal(f.L.packStats(f.rows,true).adena.n,1);assert.equal(f.L.packStats(f.rows).adena.n,0);assert.match(f.L.packReport(),/наблюдаемых циклов 1, сопоставимых для выбора 0/);
 for(let i=0;i<14;i++)f.fight(i%2?'howl':'provoke',{reward:i%2?1000:100});assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
});
test('different target withsameframe counts observedtransition only against the currenttarget',()=>{
 const f=packFixture();f.fight('provoke');f.start();
 // Use a fresh second target through the real net parser, preserving its setup and level frame.
 f.send('/game/battle/hunt-continue',{revision:f.revision+1,battle:{spawnId:f.spawn,mobName:'Other',kind:'normal',mobHp:1000,mobMaxHp:1000,logSeq:0,log:['Бой начат']}});f.pull('howl');const r=f.end({mode:'howl'});
 assert.equal(r.name,'Other');assert.equal(r.observedCycle,true);assert.equal(r.cycle,false);
});
for(const [name,change]of Object.entries({session:f=>f.env.rt.sessT0++,run:f=>f.env.rt.manualKickAt++,setup:f=>f.setup='other',long:f=>f.advance(30001),unknown:f=>f.setup=''}))test('observedtempo excludes '+name+' transition',()=>{
 const f=packFixture();f.fight();change(f);assert.equal(f.fight().observedCycle,false);
});
test('oldv1 rows and savedactive cannot be reinterpreted as corrected observations',()=>{
 const f=packFixture();f.fight();const old=f.rows[0];old.v=1;old.cycle=true;old.cycleMs=1000;assert.equal(f.L.packStats([old],true).adena.value,null);assert.equal(f.L.packStats([old]).adena.value,null);
 const totals={...f.env.rt.packLab.totals};f.start();f.env.rt.packLab.active.v=1;f.reload();f.send('/game/battle',{revision:f.revision,battle:{spawnId:f.spawn,mobName:'Garden Guard',mobHp:1000,mobMaxHp:1000,logSeq:0,log:['Бой начат']}});const r=f.end();assert.equal(r.quality,false);assert.equal(r.v,2);assert.equal(f.env.rt.packLab.totals.n,totals.n+1);
});
test('unknown initialHPMP does not authorize performance preference from otherwise strongsame-mode data',()=>{
 const f=packFixture();for(let i=0;i<7;i++)f.fight('none',{reward:100});for(let i=0;i<7;i++)f.fight('provoke',{reward:1000});assert.equal(f.L.packAdvice('Garden Guard',1000,{hp:NaN,mp:null}).preferred,'');assert.equal(f.L.packAdvice('Garden Guard',1000).preferred,'');
});
