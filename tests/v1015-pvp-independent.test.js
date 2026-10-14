'use strict';
// Независимые регрессии по native снимку15:24; игра/сервер полностью mocked, реальных атак нет.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=process.env.L2_PVP_SOURCE||path.resolve(__dirname,'..'),PVP_SOURCE=process.env.PVP_REVIEW_SOURCE||path.join(ROOT,'modules/pvp.js');
const DID='6f573aad-08ee-4713-9d76-33f5fd4afc93',EV='f211689d-a055-49e3-9483-9b94faeedf92';
// Seed — только намерение; ответ берём из настоящего background helper, а не из старого whole-map patch.
const bg=fs.readFileSync(ROOT+'/background.js','utf8'),sa=bg.indexOf('function pvpSeedPatch('),sb=bg.indexOf('async function menuPatch(',sa);assert.ok(sa>=0&&sb>sa);const canonicalSeed=vm.runInNewContext('('+bg.slice(sa,sb).trim()+')',{Date});
const pd={id:DID,name:'Dremia',ev:EV,scope:'world',log:['[Dremia] −16441 HP (Вампірні кігті).']};
function fixture(o={}){
 let now=1e6;const calls=[],nodes={},location={pathname:o.page||'/map.html',search:''};
 const target={id:DID,name:'Dremia',enabled:true},hero={characterId:DID,name:'Dremia',level:77,clanId:'their-clan',isPartyMember:false,battleOnNameClick:true,pvpAllowed:true,pvpNickColor:''};
 const button={dataset:{},textContent:'Dremia',disabled:false};nodes[`#map-hero-list li[data-character-id="${DID}"] .l2-map-hero-name-link--battle`]=button;
 const env={cfg:{autoRevive:true,enemyHunt:true,enemyMinHits:10,enemyFlagOnly:true,pvpOnSight:true},rt:{char:'Warlock',manualKickAt:0,pvpTargets:{[DID]:target},enemies:{[DID]:{id:DID,name:'Dremia',kills:2,hitMax:16441,streak:4,blockLvl:75,skipT:2e6}}},on:true,tabOwner:true,
 antibotState:()=>false,abHold:()=>false,setRt:async p=>{const before={...env.rt};Object.assign(env.rt,p);if(p.pvpSeedDremia1410===true)Object.assign(env.rt,canonicalSeed(p,before));return{ok:true}},rtCommit:async()=>true,rec:(...a)=>calls.push(['log',...a]),setStatus:()=>{},
 heroLevel:()=>75,meHp:()=>({cur:9785,max:9785}),autonomyMode:()=> 'raid',fishNow:()=>false,tvtSoon:()=>false,
 isMap:()=>location.pathname==='/map.html',isBattle:()=>location.pathname==='/battle.html',victory:()=>false,
 $q:s=>nodes[s],shown:b=>!!b&&!b.hidden,fire:b=>{calls.push(['click',b]);return true},pause:async()=>{},sleep:async()=>{},waitX:async fn=>fn(),toMap:async()=>calls.push(['map']),
 gameGet:async path=>{calls.push(['GET',path]);return{ok:true,json:async()=>path==='/character'?{character:{id:'our-id',name:'Warlock',clanId:'our-clan'}}:{nearbyHeroes:[hero]}}}};
 const box={console,Date:{now:()=>now},Math,URLSearchParams,Object,location,document:{querySelectorAll:()=>[]},CSS:{escape:x=>x}};
 vm.createContext(box);for(const file of [ROOT+'/modules/enemies.js',PVP_SOURCE])vm.runInContext(fs.readFileSync(file,'utf8'),box);
 const pvp=box.L2V7Factories.pvp(env),en=box.L2V7Factories.enemies(env);
 return {env,pvp,en,calls,hero,nodes,button,location,box,setNow:n=>now=n};
}
const clicks=f=>f.calls.filter(x=>x[0]==='click');
test('exact captured mixed-language defeat shout creates early recovery even if hook was missed',async()=>{const f=fixture();f.nodes['#map-defeat-root']={};f.nodes['#map-defeat-shout']={textContent:'Вас вбив игрок [Dremia]!'};f.nodes['#map-defeat-tocity']={};assert.equal(await f.pvp.recoveryStep(),true);assert.equal(f.pvp.pending(),true);assert.equal(clicks(f).length,1)});
for(const job of ['mmJob','tsJob','storyJob','enchant'])test('active service '+job+' is preserved before on-sight attack',async()=>{const f=fixture();f.env.rt[job]=job==='enchant'?{status:'running',pending:{id:'durable-attempt'}}:{step:'pending',t:1e6};assert.equal(await f.pvp.step(),false);assert.equal(clicks(f).length,0)});
test('confirmed killer added idempotently remains ordinary; explicit forced target does not increment kill history',async()=>{const f=fixture();await f.en.noteDefeat(pd);await f.en.noteDefeat(pd);assert.equal(f.env.rt.enemies[DID].kills,3);f.env.rt.pvpTargets={};await f.pvp.seedConfirmed();assert.equal(f.env.rt.enemies[DID].kills,3);assert.equal(f.env.rt.pvpTargets[DID].enabled,true)});
test('late old-hero return receipt with ID but no name does not clear current hero death',async()=>{const f=fixture();await f.pvp.refresh();await f.pvp.capture(pd);await f.pvp.onNet('/game/battle/return-to-town',{method:'POST',status:200,req:{expectedRevision:20},res:{character:{id:'other-hero-id',revision:21}}});assert.equal(f.pvp.pending(),true)});
test('target disabled, own clan, party and server restriction still apply during awaited pause',async()=>{for(const change of ['disable','party','clan','server']){const f=fixture();f.env.pause=async()=>{if(change==='disable')f.env.rt.pvpTargets[DID].enabled=false;else{const h=f.pvp._state.heroes[0];if(change==='party')h.party=true;if(change==='clan')h.clanId='our-clan';if(change==='server')h.ok=false}};await f.pvp.step();assert.equal(clicks(f).length,0,change)}});

// Клиентский контракт player.js: GET /game/player/:exactID/profile -> {profile}.
// Это моделирование missing-field границы, а не утверждение об actual полном /around.
function profileFixture(){
 const f=fixture(),profiles={
  'our-id':{id:'our-id',name:'Warlock',clanId:'our-clan'},
  [DID]:{id:DID,name:'Dremia',clanId:'their-clan'}
 };
 delete f.hero.clanId;
 f.env.gameGet=async url=>{
  f.calls.push(['GET',url]);
  const m=/^\/game\/player\/([^/]+)\/profile$/.exec(url);
  if(m){const id=decodeURIComponent(m[1]);return{ok:true,json:async()=>({profile:profiles[id]})}}
  return{ok:true,json:async()=>url==='/character'?{character:{id:'our-id',name:'Warlock',revision:12}}:{nearbyHeroes:[f.hero]}};
 };
 return Object.assign(f,{profiles});
}
const profileGets=f=>f.calls.filter(x=>x[0]==='GET'&&/\/profile$/.test(x[1]));
test('missing clan fields resolve only exact own and explicitly selected profiles; native attack remains possible',async()=>{
 const f=profileFixture();assert.equal(await f.pvp.step(),true);assert.equal(clicks(f).length,1);
 assert.deepEqual(profileGets(f).map(x=>x[1]),['/game/player/our-id/profile','/game/player/'+DID+'/profile']);
 assert.equal(f.pvp._state.self.clanId,'our-clan');assert.equal(f.pvp._state.heroes[0].clanKnown,true);
});
test('profile ID/name mismatch, missing clan field and failed response refuse attack',async()=>{
 for(const who of ['our-id',DID])for(const reason of ['id','name','missing','http']){
  const f=profileFixture();if(reason==='id')f.profiles[who].id='another-id';
  if(reason==='name')f.profiles[who].name='AnotherHero';
  if(reason==='missing')delete f.profiles[who].clanId;
  if(reason==='http'){const get=f.env.gameGet;f.env.gameGet=async url=>url==='/game/player/'+who+'/profile'?{ok:false}:get(url)}
  await f.pvp.step();assert.equal(clicks(f).length,0,who+':'+reason);
 }
});
test('explicit null clan is known clanless; same clan is still refused',async()=>{
 for(const clan of [null,'our-clan']){const f=profileFixture();f.profiles[DID].clanId=clan;await f.pvp.step();assert.equal(clicks(f).length,clan===null?1:0)}
});
test('profile cache is bounded, refreshes after 30 seconds and sees changed own/target clan',async()=>{
 const f=profileFixture();await f.pvp.refresh();assert.equal(profileGets(f).length,2);
 f.setNow(1004000);await f.pvp.refresh();assert.equal(profileGets(f).length,2);
 f.setNow(1006000);await f.pvp.refresh();assert.equal(profileGets(f).length,2);
 f.profiles[DID].clanId='joined';f.profiles['our-id'].clanId='joined';f.setNow(1031000);
 await f.pvp.step();assert.equal(profileGets(f).length,4);assert.equal(clicks(f).length,0);
 assert.equal(f.pvp._state.self.clanId,'joined');assert.equal(f.pvp._state.heroes[0].clanId,'joined');
});
test('unknown profile is throttled for five seconds and can recover without relaxing guard',async()=>{
 const f=profileFixture();delete f.profiles[DID].clanId;await f.pvp.step();assert.equal(clicks(f).length,0);assert.equal(profileGets(f).length,2);
 f.profiles[DID].clanId='their-clan';f.setNow(1004000);await f.pvp.step();assert.equal(clicks(f).length,0);assert.equal(profileGets(f).length,2);
 f.setNow(1005001);await f.pvp.step();assert.equal(clicks(f).length,1);assert.equal(profileGets(f).length,3);
});
test('Stop, lease loss, character switch or pending death while profile JSON waits prevents attack',async()=>{
 for(const boundary of ['stop','lease','char','death']){
  const f=profileFixture(),get=f.env.gameGet;
  f.env.gameGet=async url=>{const r=await get(url);if(url==='/game/player/'+DID+'/profile'){const json=r.json;r.json=async()=>{if(boundary==='stop')f.env.on=false;if(boundary==='lease')f.env.tabOwner=false;if(boundary==='char')f.env.rt.char='West';if(boundary==='death')f.pvp.capture(pd);return json()}}return r};
  await f.pvp.step();assert.equal(clicks(f).length,0,boundary);
 }
});
