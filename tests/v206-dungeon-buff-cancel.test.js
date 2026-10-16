'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function read(file){const base=path.basename(String(file)),old=process.env.BUFF_CANCEL_BASELINE&&['combat.js','buffs.js','mobfarm.js'].includes(base)?path.join(root,'work',base.replace('.js','-before-buff-cancel.js')):file;return fs.readFileSync(old,'utf8')}
function fixture(){
 const now=Date.now(),recs=[],H={},loc={pathname:'/battle.html',search:'?spawnId=sdms_catacomb_of_the_branded_026',href:''};
 const hud={querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:String(e)},getAttribute:()=>''}))};
 const env={on:true,tabOwner:true,cfg:{catMode:true,catDungeon:'auto',chain:true,noCancelMobs:true,townBuffSet:'basic',faBuffs:'',lvlBelow:5,lvlAbove:10,lvlMin:1,lvlMax:99},rt:{char:'Hero',manualKickAt:1,catCur:'catacomb_of_the_branded',tbT:now-50000,tbOk:true},routeLocation:loc,TB_KEYS:{basic:[1068,1268,1086,1045]},FA_KNOWN:{},IL:{},
 $q:s=>s==='#l2-hud-active-buffs'?hud:null,rec:(...a)=>recs.push(a.join(' ')),setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},sleep:async()=>{},heroLvl:()=>45};
 const box={console,Date,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc};vm.createContext(box);
 for(const name of ['combat','buffs','mobfarm','dungeons'])vm.runInContext(read(path.join(root,'modules',name+'.js')),box);
 const B=box.L2V7Factories.buffs(env),C=box.L2V7Factories.combat(env),M=box.L2V7Factories.mobfarm(env),D=box.L2V7Factories.dungeons(env);env.cancelRisk=B.cancelRisk;
 return {now,env,H,recs,loc,B,C,M,D};
}
const cancel='[Grave Priest] зняв з вас 3 бафи.';
test('строка снятия сохраняется после вытеснения наградами AoE и не дублируется при опросе',()=>{
 const f=fixture(),ctx={logStart:['Бой начат: Grave Priest']};
 f.C.cancelCollect(ctx,[cancel,'Удар −6 HP.','Бой начат: Grave Priest']);
 f.C.cancelCollect(ctx,[cancel,'Удар −6 HP.','Бой начат: Grave Priest']);
 f.C.cancelCollect(ctx,Array.from({length:40},(_,i)=>'Спойл ресурс '+i));
 assert.deepEqual(Array.from(ctx.cancelLines),[cancel]);
 assert.equal(f.B.cancelNote(ctx.cancelLines,'Grave Priest',{dungeon:'catacomb_of_the_branded'}),3);
 assert.equal(f.env.rt.buffCancel['grave priest'].k,1);assert.ok(f.env.rt.tbCancelT>=f.now);
});
test('два одинаковых снятия в разных ходах считаются, старая строка из прошлого боя не считается',()=>{
 const f=fixture(),ctx={logStart:[cancel,'Прошлый бой']};
 f.C.cancelCollect(ctx,['Ход 1',cancel,'Прошлый бой']);assert.equal(ctx.cancelLines,undefined);
 f.C.cancelCollect(ctx,[cancel,'Ход 1',cancel,'Прошлый бой']);
 f.C.cancelCollect(ctx,['Ход 2',cancel,'Ход 1',cancel,'Прошлый бой']);
 f.C.cancelCollect(ctx,[cancel,'Ход 2',cancel,'Ход 1',cancel,'Прошлый бой']);
 assert.equal(f.B.cancelNote(ctx.cancelLines,'Grave Priest'),6);assert.equal(f.env.rt.buffCancel['grave priest'].k,1);
});
test('подтверждённое снятие не считается неудачей баффера и разрешает восстановление после боя',async()=>{
 const f=fixture();f.B.cancelNote([cancel],'Grave Priest',{dungeon:'catacomb_of_the_branded'});
 assert.equal(await f.B.townBuffStart('баффы кончились'),true);assert.equal(f.env.rt.tbFail,undefined);
 assert.ok(f.recs.some(x=>x.includes('сняты мобом')));assert.ok(!f.recs.some(x=>x.includes('так и не появились')));
 assert.equal(f.loc.href,'/town-buffer.html');
});
test('катакомбы выбирают безопасный вид, запрет цепочки относится к текущему подземелью',()=>{
 const f=fixture();f.B.cancelNote([cancel],'Grave Priest',{dungeon:'catacomb_of_the_branded'});
 const rows=[{id:'bad',name:'Grave Priest',lvl:46},{id:'safe',name:'Lilim Butcher',lvl:46}];
 assert.equal(f.D.catPick(rows,45).id,'safe');assert.equal(f.M.dungeonCancelBlocked(),true);
 f.loc.search='?spawnId=sdms_saints_necropolis_001';assert.equal(f.M.dungeonCancelBlocked(),false);
 f.loc.search='?spawnId=sdms_catacomb_of_the_branded_099';f.env.cfg.noCancelMobs=false;
 assert.equal(f.M.dungeonCancelBlocked(),false);
});
test('просроченная память и чемпион не запрещают обычную цепочку катакомб',()=>{
 const f=fixture();f.B.cancelNote([cancel],'Grave Priest',{champ:true,tier:'red',dungeon:'catacomb_of_the_branded'});
 assert.equal(f.M.dungeonCancelBlocked(),false);
 f.B.cancelNote([cancel],'Grave Priest',{dungeon:'catacomb_of_the_branded'});f.env.rt.buffCancel['grave priest'].t=f.now-31*86400000;
 assert.equal(f.M.dungeonCancelBlocked(),false);
});
// Реальный battle() с усечённым журналом: ход со снятием → победа AoE с длинной добычей → nextFight.
function flow(){
 const proxy=Object.create(fs);proxy.readFileSync=(p,...a)=>String(p).endsWith('/modules/combat.js')||String(p).endsWith('/modules/mobfarm.js')?read(p):fs.readFileSync(p,...a);
 const box={console,URLSearchParams,setTimeout,__dirname,require:n=>n==='node:test'?()=>{}:n==='fs'?proxy:require(n)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'v1014-combat-outcomes.test.js'),'utf8')+'\nthis.make=flowFixture;',box);
 return box.make('fighter');
}
test('battle сохраняет снятие до победы и передаёт его в память ровно один раз',async()=>{
 const f=flow(),notes=[];let lines=[],turn=0;const fire=f.env.fire;
 f.location.search='?spawnId=sdms_catacomb_of_the_branded_026';f.env.logLines=()=>lines.slice();
 f.env.cancelNote=(...a)=>notes.push(a);f.env.fire=b=>{
  if(++turn===1){lines=[cancel,'Удар −6 HP.'];f.setNet({start:Date.now()+10,done:Date.now()+20,okN:1,action:'attack',ok:true});return true}
  const ok=fire(b);lines=Array.from({length:40},(_,i)=>'Спойл ресурс '+i);return ok;
 };
 await f.combat.battle();assert.equal(notes.length,1);assert.deepEqual(Array.from(notes[0][0]),[cancel]);
 assert.equal(notes[0][2].dungeon,'catacomb_of_the_branded');assert.ok(f.events.includes('sweep'));
});
for(const blocked of [true,false])test('nextFight '+(blocked?'возвращается к фильтрованному списку':'сохраняет цепочку без снятий'),async()=>{
 const f=flow();f.location.search='?spawnId=sdms_catacomb_of_the_branded_026';
 f.env.cfg.catMode=true;f.env.cfg.noCancelMobs=true;f.env.cfg.farmRes='';f.env.cancelRisk=()=>blocked?{n:3}:null;
 f.env.rt.buffCancel=blocked?{'grave priest':{name:'Grave Priest',dungeon:'catacomb_of_the_branded',champ:false}}:{};
 f.env.catGo=async()=>f.events.push('catGo');f.setWon(true);await f.farm.nextFight({name:'Safe Mob'});
 assert.equal(f.events.includes('hunt'),!blocked);assert.equal(f.events.includes('catGo'),blocked);
});
