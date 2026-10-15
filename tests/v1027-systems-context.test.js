'use strict';
// Полные асинхронные переходы: старый ответ не управляет новым героем/классом/ручным запуском.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../modules',n+'.js'),'utf8');
const defer=()=>{let resolve;return {p:new Promise(r=>resolve=r),done:x=>resolve(x)}};
const response=j=>({ok:true,status:200,json:async()=>j});
function fixture(n,extra={}){
 const loc={pathname:'/map.html',search:'',href:''},clicks=[],notes=[],storage=new Map();
 const box={console,Date,URLSearchParams,CSS:{escape:x=>x},location:loc,document:{querySelectorAll:()=>[]},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
 vm.runInNewContext(read(n),box);
 const e={on:true,tabOwner:true,cfg:{},rt:{char:'Old',manualKickAt:1},setRt:async p=>{Object.assign(e.rt,p);return {ok:true}},rtCommit:async()=>true,
 rec:(...x)=>notes.push(x),setStatus(){},sleep:async()=>{},waitX:async f=>f(),pause:async()=>{},fire:b=>{clicks.push(b);return true},shown:b=>!!b&&!b.hidden,
 $q:()=>null,gameGet:async()=>response({}),isBattle:()=>false,isMap:()=>loc.pathname==='/map.html',fishNow:()=>false,tvtSoon:()=>false,tvtHold:()=>false,autonomyMode:()=> 'farm',awayFree:()=>true,heroLevel:()=>80,meHp:()=>({cur:1000,max:1000}),...extra};
 return {e,M:box.L2V7Factories[n](e),loc,box,clicks,notes};
}
test('story GET старого героя не создаёт готовые к сдаче квесты нового; новый герой опрашивается сразу',async()=>{
 const f=fixture('story'),g=defer();let calls=0;f.e.gameGet=()=>{calls++;return g.p};const old=f.M.storyTick(true);f.e.rt={char:'New'};g.done(response({quest:{stage:'return_to_ladd'}}));await old;assert.equal(f.e.rt.story,undefined);
 f.e.gameGet=async()=>{calls++;return response({quest:{stage:'hunt_bosses'}})};await f.M.storyTick();assert.equal(calls,3);assert.equal(f.e.rt.story.subclass.ready,false);
});
for(const change of ['character','manual','replacement','stop','owner'])test(`story готовая сдача → ${change} при ACK не стирает новую задачу и не уводит на старую точку`,async()=>{
 const f=fixture('story');f.loc.pathname='/subclass-quest.html';const J={kind:'subclass',key:'subclass:return_to_ladd',t:Date.now(),home:'old-zone'},N={kind:'noblesse',key:'noblesse:2',t:2,home:'new-zone'};f.e.rt.storyJob=J;
 let done={};const box={children:[done],querySelector:()=>done};f.e.$q=s=>s==='#subclass-quest-actions'?box:null;let waits=0;
 f.e.waitX=async fn=>{if(++waits===2){done=null;if(change==='character')f.e.rt={char:'New',manualKickAt:1,storyJob:N};if(change==='manual'){f.e.rt.manualKickAt++;f.e.rt.storyJob=N}if(change==='replacement')f.e.rt.storyJob=N;if(change==='stop')f.e.on=false;if(change==='owner')f.e.tabOwner=false;}return fn()};
 await f.M.storyStep();assert.equal(f.clicks.length,1);assert.equal(f.e.rt.zoneGo,undefined);assert.equal(f.e.rt.storyLog,undefined);assert.equal(f.loc.href,'');assert.equal(f.e.rt.storyJob,change==='stop'||change==='owner'?J:N);
});
test('story foreign character snapshot does not change class memory',()=>{const f=fixture('story');f.e.rt.classCur={prof:'human_warlock',slot:0};f.M.charNote({name:'New',l2Profession:'human_dark_avenger',classBranch:'fighter'});assert.equal(f.e.rt.classCur.prof,'human_warlock');assert.equal(f.e.rt.classBranch,undefined)});
test('TvT old registered GET cannot consume new hero registration; new request does not wait old response',async()=>{
 const f=fixture('tvt',{cfg:{tvtOn:true}}),a=defer(),b=defer();let n=0;f.e.gameGet=()=>++n===1?a.p:b.p;
 const first=f.M.tvtRefresh(true);f.e.rt={char:'New',manualKickAt:1};const second=f.M.tvtRefresh(true);assert.equal(n,2);
 b.done(response({phase:'REGISTRATION',eventId:'slot',isRegistered:false}));await second;a.done(response({phase:'REGISTRATION',eventId:'slot',isRegistered:true}));await first;
 assert.equal(f.e.rt.tvt.isRegistered,false);assert.equal(f.M.tvtRegistrationDue(),true);
});
for(const change of ['character','manual','class'])test(`TvT registration wait → ${change} in same event cancels old click`,async()=>{
 const f=fixture('tvt',{cfg:{tvtOn:true}});f.loc.pathname='/tvt-arena.html';f.e.TVT={phase:'REGISTRATION',eventId:'same',registeredCount:19,maxPlayers:20};f.e.gameGet=undefined;
 f.e.$q=s=>s==='#tvt-register-btn'?{}:null;f.e.waitX=async fn=>{const b=fn();if(change==='character')f.e.rt={char:'New',manualKickAt:1};if(change==='manual')f.e.rt.manualKickAt++;if(change==='class')f.e.rt.classCur={prof:'human_warlock',slot:1};return b};
 await f.M.tvtStep();assert.equal(f.clicks.length,0);assert.equal(f.e.rt.tvtRegN,undefined);assert.equal(f.loc.href,'');
});
test('TvT skills catalog belongs to class even in same event; old class response ignored then new catalog loaded',async()=>{
 const f=fixture('tvt',{cfg:{tvtOn:true}}),g=defer();f.e.TVT={phase:'ACTIVE',eventId:'same'};f.e.rt.classCur={prof:'warlock',slot:0};f.e.gameGet=()=>g.p;
 const p=f.M.tvtSkillsRefresh();f.e.rt.classCur={prof:'tank',slot:1};g.done(response({skills:[{action:'old'}]}));await p;assert.equal(f.e.TVTS,undefined);
 f.e.gameGet=async()=>response({skills:[{action:'new'}]});await f.M.tvtSkillsRefresh();assert.equal(f.e.TVTS.skills[0].action,'new');
});
test('clan POST old hero success is not installed as new hero task',async()=>{
 const f=fixture('dailies'),g=defer();f.e.rt.clanTasks={t:Date.now(),me:{},active:[],defs:[{id:'kill_monsters',canTake:true,n:'Монстры',reward:{}}]};f.e.gamePost=()=>g.p;
 const p=f.M.clanStep();f.e.rt={char:'New'};g.done(response({clan:{name:'OldClan'},taskDefinitions:[]}));await p;assert.equal(f.e.rt.clanTasks,undefined);assert.equal(f.e.rt.clanTaskFail,undefined);
});
test('clan POST after manual switch does not install failure backoff in new run',async()=>{
 const f=fixture('dailies'),g=defer();f.e.rt.clanTasks={t:Date.now(),me:{},active:[],defs:[{id:'kill_monsters',canTake:true,n:'Монстры',reward:{}}]};f.e.gamePost=()=>g.p;
 const p=f.M.clanStep();f.e.rt.manualKickAt++;g.done({ok:false,status:500,json:async()=>({error:'failure'})});await p;assert.equal(f.e.rt.clanTaskFail,undefined);
});
function enemyFixture(){return fixture('enemies',{cfg:{enemyHunt:true},rt:{char:'Old',manualKickAt:1,enemies:{killer:{id:'killer',name:'Killer',kills:1}}}})}
test('enemy list accepts only own confirmed world death, not foreign owner/error/arena/NPC',async()=>{
 const f=enemyFixture();for(const [owner,status,scope] of [['New',200,'world'],['Old',500,'world'],['Old',200,'tvt']])f.M.onNet('/character',{status,pv:{owner:{name:owner},defeat:{id:'other',name:'Other',ev:owner+status+scope,scope}}});
 f.M.onNet('/game/battle/turn',{status:200,bt:{dead:true,mobName:'NPC'}});await Promise.resolve();assert.equal(f.e.rt.enemies.other,undefined);
 f.M.onNet('/character',{status:200,pv:{owner:{name:'Old'},defeat:{id:'killer',name:'Killer',ev:'death',scope:'world'}}});await Promise.resolve();assert.equal(f.e.rt.enemies.killer.kills,2);
 f.M.onNet('/character',{status:200,pv:{owner:{name:'Old'},defeat:{id:'killer',name:'Killer',ev:'death',scope:'world'}}});await Promise.resolve();assert.equal(f.e.rt.enemies.killer.kills,2);
});
test('nearby heroes GET old character cannot populate new target list',async()=>{
 const f=enemyFixture(),g=defer();f.e.gameGet=()=>g.p;const p=f.M.tick();f.e.rt={char:'New',enemies:{killer:{id:'killer',name:'Killer',kills:1}}};g.done(response({nearbyHeroes:[{characterId:'killer',name:'Killer',level:70,pvpNickColor:'pk',showPkButton:true}]}));await p;assert.equal(f.M.pick(),null);assert.equal(f.e.rt.enemies.killer.seenT,undefined);
});
for(const change of ['stop','character','manual','tvt','ignore'])test(`map enemy button wait → ${change} does not start stale attack`,async()=>{
 const f=enemyFixture();f.M.noteHeroes([{id:'killer',name:'Killer',lvl:70,col:'pk',atk:true}], 'zone');f.e.$q=()=>({});f.e.waitX=async fn=>{const b=fn();if(change==='stop')f.e.on=false;if(change==='character')f.e.rt={char:'New'};if(change==='manual')f.e.rt.manualKickAt++;if(change==='tvt'){f.e.cfg.tvtOn=true;f.e.tvtHold=()=>true}if(change==='ignore')f.e.rt.enemies.killer.ignore=true;return b};await f.M.step();assert.equal(f.clicks.length,0);assert.equal(f.e.rt.enemyHunt,undefined);
});
test('subclass shared helper GET after hero switch does not clear new goal; foreign class slots ignored',async()=>{
 const f=fixture('subclass',{cfg:{subMainNick:'Main'},heroNick:()=> 'Helper'}),g=defer();f.e.sharedGet=()=>g.p;const p=f.M.needRead();f.e.rt={char:'New',subNeed:{nick:'NewMain'}};g.done({nick:'Main',t:Date.now(),items:[]});await p;assert.equal(f.e.rt.subNeed.nick,'NewMain');f.M.charNote({name:'Old',classSlots:{slots:[{slot:1,profession:'warlock'}]}});assert.equal(f.e.rt.subSlots,undefined);
});
test('subclass handover transfers positive deficits only, never all stock for zero/malformed deficit',()=>{
 const f=fixture('subclass',{cfg:{subMainNick:'Main'},heroNick:()=> 'Helper',invQty:()=>100});f.e.rt.subNeed={nick:'Main',items:[[1,'zero',0],[2,'bad','x'],[3,'negative',-2],[4,'wanted',7]]};assert.equal(JSON.stringify(f.M.handover().items),JSON.stringify([[4,7,'wanted']]));
});

test('PvP fresh own clan identity cannot be rolled back by older snapshot',()=>{const f=fixture('pvp');f.M.onNet('/character',{status:200,res:{id:'hero',name:'Old',revision:20,clanId:'ours'}});f.M.onNet('/character',{status:200,res:{id:'hero',name:'Old',revision:19,clanId:'former'}});assert.equal(f.M._state.self.clanId,'ours');assert.equal(f.M._state.self.revision,20)});
test('PvP failed HTTP payload cannot invent a confirmed death; explicit pending error still requires recovery',()=>{const f=fixture('pvp');f.M.onNet('/character',{status:500,pv:{owner:{name:'Old'},defeat:{id:'killer',name:'Killer',scope:'world',ev:'e'}}});assert.equal(f.M.pending(),false);f.M.onNet('/game/battle/start',{status:409,res:{error:'pvp_defeat_pending'}});assert.equal(f.M.pending(),true)});
test('TvT previous class cached skill costs are not used after class switch',()=>{const f=fixture('tvt',{cleanTitle:x=>x,slotAction:()=> 'old',cfg:{tvtOn:true}});f.e.TVTS={identity:'old-hero-class',complete:true,skills:[{action:'old',mpCost:1}]};assert.equal(f.M.skillInfo({title:'old'}),null)});
