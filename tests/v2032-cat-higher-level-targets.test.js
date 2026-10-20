'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=f=>process.env.CAT_LEVEL_BASELINE?cp.execFileSync('git',['show','b8b9dda:'+f],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,f),'utf8');
const did='necropolis_of_devotion',sid=n=>'sdms_'+did+'_'+n;
function fixture(o={}){
 const events=[],loc={pathname:o.page||'/battle.html',search:o.page==='dungeon'?('?dungeonId='+did):('?spawnId='+sid('035')),href:'https://l2wap.com/battle.html?spawnId='+sid('035'),reload:()=>events.push('reload')};
 let won=true,rows=o.rows||[{id:sid('035'),name:'Current',level:67,kind:'passive'},{id:sid('062'),name:'Low',level:62,kind:'passive'},{id:sid('070'),name:'Equal',level:70,kind:'passive'},{id:sid('071'),name:'Higher',level:71,kind:'passive'}];
 const env={on:true,tabOwner:true,cfg:{catMode:true,catDungeon:'auto',chain:true,lvlBelow:5,lvlAbove:5,noCancelMobs:true,...o.cfg},rt:{char:'Hero',manualKickAt:1,lvl:70,classCur:{prof:'dwarf_bounty_hunter',slot:1},...o.rt},routeLocation:loc,CAT_URL:'/catacombs.html',CAT_LIST:o.catalog||{[did]:['Devotion',60,70],saints_necropolis:['Saints',70,80]},
 heroLvl:()=>env.rt.lvl,autonomyMode:()=>env.cfg.catMode?'cat':'farm',victory:()=>won,canAct:()=>true,canRun:()=>true,
 campOn:()=>false,huntOn:()=>false,campActive:()=>false,campChampOpen:()=>false,isMap:()=>false,isBattle:()=>loc.pathname==='/battle.html',
 $q:s=>s==='#battle-victory-hunt'?{id:'hunt'}:null,shown:b=>!!b,pause:async()=>{},sleep:async()=>{},waitFor:async f=>f()||null,waitX:async f=>f()||null,
 setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},setStatus:s=>events.push('status:'+s),rec:(...a)=>events.push(a.join(' ')),
 gameGet:async p=>{events.push('GET '+p);return{ok:true,json:async()=>({dungeon:{id:did,mobs:rows}})}},
 fire:b=>{events.push(b?.id==='hunt'?'hunt':'fire');if(b?.id==='hunt')won=false;return true},mobHp:()=>({cur:won?0:1}),actNet:()=>({}),NET_ERR:{t:0},cancelRisk:()=>null};
 const box={console,Date,Math:Object.create(Math),JSON,URLSearchParams,CSS:{escape:s=>s},location:loc,document:{querySelectorAll:()=>[]}};box.Math.random=()=>0;vm.createContext(box);vm.runInContext(read('modules/dungeons.js'),box);
 const D=box.L2V7Factories.dungeons(env);env.catNext=()=>D.catNext();env.catGo=async()=>events.push('catGo:'+D.catTarget());
 const mob=read('modules/mobfarm.js'),start=mob.indexOf('  if (env.cfg.catMode && !env.campOn() && !env.huntOn()) {'),end=mob.indexOf('  if (env.campOn() && env.rt.campaignDue)',start);
 Object.assign(box,{env,dungeonBattle:()=>/^sdms_/.test(new URLSearchParams(loc.search).get('spawnId')||''),dungeonCancelBlocked:()=>!!env.rt.cancelBlocked});
 vm.runInContext('this.run=async()=>{'+mob.slice(start,end)+'}',box);
 return {env,D,loc,events,setRows:r=>rows=r,setWon:b=>won=b,run:box.run};
}
const mob=(id,lvl,more={})=>({id,name:id,lvl,rb:false,champ:false,...more});
test('авто для героя70 выбирает подземелье с целью71 вместо границы60–70',()=>{const f=fixture();assert.equal(f.D.catTarget(),'saints_necropolis')});
test('свежий известный диапазон60–67 не удерживает героя70',()=>{const f=fixture({rt:{catCur:did,catLv:{[did]:{lo:60,hi:67,n:3}}}});f.env.heroAt=()=>({dung:did});assert.equal(f.D.catTarget(),'saints_necropolis')});
test('подходящее текущее подземелье удерживается среди равных',()=>{const f=fixture({catalog:{a:['A',70,80],b:['B',70,80]},rt:{catCur:'a'}});f.env.heroAt=()=>({dung:'b'});assert.equal(f.D.catTarget(),'b')});
test('явный верхний запас0 не сдвигает цель выше героя',()=>{const f=fixture({cfg:{lvlAbove:0}});assert.equal(f.D.catTarget(),did);assert.equal(f.D.catPick([mob('high',71),mob('equal',70)],70).id,'equal')});
test('общая верхняя граница70 сдерживает выбор подземелья и боя при запасе+5',()=>{const f=fixture({cfg:{lvlMax:70}});assert.equal(f.D.catTarget(),did);assert.equal(f.D.catWin(70).hi,70);assert.equal(f.D.catPick([mob('high',71),mob('equal',70)],70).id,'equal')});
test('нет lvlAbove — цель+1 разрешена только до общего lvlMax',()=>{const f=fixture({cfg:{lvlAbove:undefined,lvlMax:70}});assert.equal(f.D.catTarget(),did);assert.equal(f.D.catPick([mob('high',71)],70),null)});
test('из равного приоритета предпочитается разрешённый73 вместо69',()=>{const f=fixture();assert.equal(f.D.catPick([mob('low',69),mob('high',73)],70).id,'high')});
test('окно+5 и предел−5 соблюдаются при выборе обычных мобов',()=>{const f=fixture();assert.equal(f.D.catPick([mob('too-low',64),mob('too-high',76),mob('bound',75)],70).id,'bound');assert.equal(f.D.catPick([mob('too-low',64),mob('too-high',76)],70),null)});
test('нижняя часть допустимого окна остаётся запасной при отсутствии других подходящих',()=>{const f=fixture();f.env.rt.hardMobs={high:{t:Date.now()}};assert.equal(f.D.catPick([mob('low',69),mob('high',71)],70).id,'low')});
test('приоритет явного квеста и чемпиона перед обычным мобом сохранён',()=>{const f=fixture();assert.equal(f.D.catPick([mob('ordinary',71),mob('quest',65,{quest:true})],70).id,'quest');assert.equal(f.D.catPick([mob('ordinary',71),mob('champion',65,{champ:true})],70).id,'champion')});
test('ручной выбор подземелья и прежнее сравнение уровней сохранены',()=>{const f=fixture({cfg:{catDungeon:did}});assert.equal(f.D.catTarget(),did);assert.equal(f.D.catPick([mob('low',69),mob('high',73)],70).id,'low');assert.equal(f.D.catPick([mob('explicit',62)],70).id,'explicit')});
test('авто следующую цель подтверждает свежим списком и открывает71 без случайного hunt',async()=>{const f=fixture();await f.run();assert.equal(f.loc.href,'/battle.html?spawnId='+sid('071'));assert.equal(f.env.rt.target.name,'Higher');assert.equal(f.events.filter(x=>x.startsWith('GET ')).length,1);assert.ok(!f.events.includes('hunt'))});
for(const kind of ['HTTP503','empty','only below−5'])test(kind+': авто не откатывается к случайной native цепочке',async()=>{const f=fixture();if(kind==='HTTP503')f.env.gameGet=async()=>({ok:false});if(kind==='empty')f.setRows([]);if(kind==='only below−5')f.setRows([{id:sid('001'),name:'Too low',level:64,kind:'passive'}]);await f.run();assert.ok(f.events.some(x=>x.startsWith('catGo:')));assert.ok(!f.events.includes('hunt'));assert.ok(!f.events.includes('fire'));assert.match(f.loc.href,/_035$/)});
test('полный свежий каталог слабого подземелья возвращает к подбору более высокого',async()=>{const f=fixture({rows:[{id:sid('035'),name:'Current',level:67,kind:'passive'},{id:sid('067'),name:'Low',level:67,kind:'passive'}]});await f.run();assert.equal(f.env.rt.catLv[did].hi,67);assert.ok(f.events.includes('catGo:saints_necropolis'));assert.ok(!f.events.includes('hunt'));assert.match(f.loc.href,/_035$/)});
test('первое чтение Devotion60–67 выбирает другое до начала низкого боя',async()=>{const f=fixture({page:'dungeon',rows:[]});f.loc.pathname='/dungeon.html';f.loc.search='?dungeonId='+did;f.env.dungNet=()=>({id:did,mobs:[[sid('065'),'passive','Low',65,0],[sid('067'),'passive','Low2',67,0]],t:Date.now()});await f.D.catHunt(did);assert.equal(f.loc.href,'/catacombs.html');assert.equal(f.env.rt.target,undefined);assert.ok(!f.events.includes('fire'))});
test('высокий чемпион вне окна не скрывает низкий диапазон обычных мобов',async()=>{const f=fixture({page:'dungeon',rows:[]});f.loc.pathname='/dungeon.html';f.loc.search='?dungeonId='+did;f.env.dungNet=()=>({id:did,mobs:[[sid('065'),'passive','Low',65,0],[sid('067'),'passive','Low2',67,0],['champ_o_'+did+'_090','champion','High champion',85,0]],t:Date.now()});await f.D.catHunt(did);assert.equal(f.env.rt.catLv[did].hi,67);assert.equal(f.loc.href,'/catacombs.html');assert.equal(f.env.rt.target,undefined)});
test('если проверены только слабые подземелья, лучший доступный не порождает круг перелётов',async()=>{const f=fixture({rt:{catLv:{[did]:{lo:65,hi:67,n:3},saints_necropolis:{lo:60,hi:66,n:3}}},rows:[{id:sid('035'),name:'Current',level:67,kind:'passive'},{id:sid('067'),name:'Low',level:67,kind:'passive'}]});await f.run();assert.equal(f.D.catTarget(),did);assert.equal(f.loc.href,'/battle.html?spawnId='+sid('067'));assert.ok(!f.events.some(x=>x.startsWith('catGo:')))});
for(const kind of ['Stop','class','level','manual choice'])test('изменение во время fresh GET: '+kind+' запрещает старый переход',async()=>{const f=fixture(),get=f.env.gameGet;f.env.gameGet=async p=>{const r=await get(p);if(kind==='Stop')f.env.on=false;if(kind==='class')f.env.rt.classCur={prof:'human_arcana_lord',slot:0};if(kind==='level')f.env.rt.lvl=71;if(kind==='manual choice')f.env.cfg.catDungeon=did;return r};await f.run();assert.match(f.loc.href,/_035$/);assert.ok(!f.events.includes('hunt'));assert.ok(!f.events.includes('fire'));assert.ok(!f.events.some(x=>x.startsWith('catGo:')))});
for(const kind of ['upper window','hardMobs','Cancel','enchant mode'])test('последняя дневная сверка: '+kind+' отменяет уже выбранный бой',async()=>{const f=fixture();f.env.dailyWorkReady=async()=>{if(kind==='upper window')f.env.cfg.lvlMax=70;if(kind==='hardMobs')f.env.rt.hardMobs={higher:{t:Date.now()}};if(kind==='Cancel')f.env.cancelRisk=()=>({n:3});if(kind==='enchant mode')f.env.autonomyMode=()=> 'enchant';return true};await f.run();assert.match(f.loc.href,/_035$/);assert.ok(!f.events.includes('hunt'));assert.ok(!f.events.includes('fire'));assert.ok(!f.events.some(x=>x.startsWith('catGo:')))});
test('ручное подземелье без Cancel сохраняет родную цепочку',async()=>{const f=fixture({cfg:{catDungeon:did}});await f.run();assert.ok(f.events.includes('hunt'));assert.ok(!f.events.some(x=>x.startsWith('GET ')))});
test('ручное подземелье с Cancel сохраняет свежий безопасный выбор',async()=>{const f=fixture({cfg:{catDungeon:did},rt:{cancelBlocked:true}});await f.run();assert.equal(f.loc.href,'/battle.html?spawnId='+sid('071'));assert.ok(!f.events.includes('hunt'))});
test('явно выключенная цепочка остаётся на выборе через список',async()=>{const f=fixture({cfg:{chain:false}});await f.run();assert.ok(f.events.some(x=>x.startsWith('catGo:')));assert.ok(!f.events.includes('hunt'));assert.ok(!f.events.some(x=>x.startsWith('GET ')))});

const levelProof=(more={})=>({char:'Hero',prof:'dwarf_bounty_hunter',slot:1,level:71,revision:100,...more});
const lowRows=[{id:sid('065'),name:'Below server floor',level:65,kind:'passive'}];
test('нет имени или подтверждённого класса: уровень HUD доступен без исключения',()=>{
 for(const rt of [{},{invClassProof:{level:90}},{char:'Hero',invClassProof:{char:'Hero',level:90}}]){const f=fixture();f.env.rt=rt;f.env.heroLvl=()=>70;assert.doesNotThrow(()=>f.D.catTarget());assert.equal(f.D.catTarget(),'saints_necropolis')}
});
test('настоящий invRefresh узнаёт71 при HUD70 и отменяет старый catNext65',async()=>{
 const helper=fs.readFileSync(path.join(root,'tests/v2032-subclass-bag-proof.test.cjs'),'utf8'),cut=helper.indexOf("test('пропущенная смена"),box={console,require,__dirname:path.join(root,'tests')};
 assert.ok(cut>0);vm.runInNewContext(helper.slice(0,cut)+';this.make=fixture;',box);
 const bag=box.make({rt:{classCur:{prof:'dwarf_bounty_hunter',slot:1,t:1},prof:'Bounty hunter',lvl:70,autoLs:null,actionPayments:null},snapshot:{level:71,classSlots:{activeSlot:1,slots:[{slot:0,owned:true,active:false,profession:'human_arcana_lord',level:78},{slot:1,owned:true,active:true,profession:'dwarf_bounty_hunter',level:71}]}}});
 const f=fixture({rows:lowRows,catalog:{[did]:['Devotion',60,70]}}),get=f.env.gameGet;f.env.rt=bag.box.rt;f.env.setRt=bag.box.setRt;f.env.heroLvl=()=>70;
 f.env.gameGet=async p=>{await bag.box.invRefresh();return get(p)};
 assert.equal(await f.D.catNext(),true);assert.equal(f.env.rt.lvl,71);assert.equal(f.env.rt.invClassProof.level,71);assert.equal(f.env.heroLvl(),70);
 assert.match(f.loc.href,/_035$/);assert.equal(f.env.rt.target,undefined);assert.ok(!f.events.includes('hunt'));
});
test('следующий выбор при HUD70 использует подтверждённый71:65 исключён,66 допустим',async()=>{
 const f=fixture({rt:{lvl:71,invClassProof:levelProof()},rows:lowRows,catalog:{[did]:['Devotion',60,70]}});f.env.heroLvl=()=>70;
 assert.equal(await f.D.catNext(),false);assert.match(f.loc.href,/_035$/);assert.equal(f.env.rt.target,undefined);
 f.setRows([{id:sid('066'),name:'Server floor',level:66,kind:'passive'}]);assert.equal(await f.D.catNext(),true);assert.equal(f.loc.href,'/battle.html?spawnId='+sid('066'));assert.equal(f.env.rt.target.name,'Server floor');
});
for(const [name,proof] of [['чужой герой',levelProof({char:'Other',level:90})],['другой класс',levelProof({prof:'human_arcana_lord',slot:0,level:90})]])test('устаревший proof не определяет уровень: '+name,async()=>{
 const f=fixture({rt:{lvl:90,invClassProof:proof},rows:[{id:sid('071'),name:'Allowed by HUD',level:71,kind:'passive'}]});f.env.heroLvl=()=>70;
 assert.equal(await f.D.catNext(),true);assert.equal(f.loc.href,'/battle.html?spawnId='+sid('071'));assert.equal(f.env.rt.target.name,'Allowed by HUD');
});
test('более высокий актуальный HUD не понижается старым proof71',async()=>{
 const f=fixture({rt:{lvl:71,invClassProof:levelProof()},rows:[{id:sid('067'),name:'Too low for HUD73',level:67,kind:'passive'}]});f.env.heroLvl=()=>73;
 assert.equal(await f.D.catNext(),false);assert.match(f.loc.href,/_035$/);assert.equal(f.env.rt.target,undefined);
});
test('сырой rt.lvl90 без proof не переопределяет HUD70',async()=>{
 const f=fixture({rt:{lvl:90},rows:[{id:sid('071'),name:'Allowed by HUD',level:71,kind:'passive'}]});f.env.heroLvl=()=>70;
 assert.equal(await f.D.catNext(),true);assert.equal(f.loc.href,'/battle.html?spawnId='+sid('071'));assert.equal(f.env.rt.target.name,'Allowed by HUD');
});
