'use strict';
// 20.66 (лог Rebirth 26.10 21:52): Работаем только с уже открытым боем; платный вход и ключи не моделируются как разрешённые действия.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(f==='content.js'&&process.env.L2_REBIRTH_CONTENT_SOURCE||path.join(root,f),'utf8');
const {flowFixture}=require(path.join(root,'tests/warlock-combat-fixture.cjs'));
const RUN='11111111-1111-4111-8111-111111111111',HERO='22222222-2222-4222-8222-222222222222';
const sid=n=>'rebirth_raid_'+RUN+'_1_1_25146_mob_'+n,clone=x=>structuredClone(x);
function fixture(o={}){
 const f=flowFixture('fighter'),e=f.env,posts=[],routes=[],checks=[],ss=o.ss||new Map();
 const state={now:1793000000000,hero:'Hero',mode:'farm',generation:1,canAct:true,challenge:null,pvp:false,tvt:false,tvtStep:false,tvtHold:false,
  quota:true,quotaCalls:[],hooks:{},nativeClicks:0,nativeRequests:[],nextSpawn:sid(23),accepted:true,services:[],commits:0,saveOk:true,saveAck:true};
 f.box.Date=class extends Date{static now(){return state.now}};
 f.box.sessionStorage={getItem:k=>ss.get(k)||null,setItem:(k,v)=>ss.set(k,String(v)),removeItem:k=>ss.delete(k)};
 for(const [field,file] of [['combat','L2_REBIRTH_COMBAT_SOURCE'],['farm','L2_REBIRTH_FARM_SOURCE']])if(process.env[file]){
  vm.runInContext(fs.readFileSync(process.env[file],'utf8'),f.box);f[field]=f.box.L2V7Factories[field==='farm'?'mobfarm':field](e);
 }
 const title=o.title||'Rebirth · Akaste Succubus Turen · ур. 21';
 e.$q('#battle-mob-title').textContent=title;f.hp.textContent='2546 / 7128';
 f.location.pathname='/battle.html';f.location.search='?spawnId='+(o.spawn||sid(19));
 let origin='https://l2wap.com',hash='';Object.defineProperty(f.location,'href',{get:()=>origin+f.location.pathname+f.location.search+hash,
  set:v=>{const u=new URL(v,'https://l2wap.com');origin=u.origin;hash=u.hash;f.location.pathname=u.pathname;f.location.search=u.search}});
 Object.assign(e.cfg,{catMode:false,deepEvery:20,chain:true});
 Object.assign(e.rt,{char:'Hero',lvl:21,classCur:{prof:'human_wizard',slot:0},manualKickAt:1,catIn:'witch',sinceDeep:200,deepHot:false,via:'manual'});
 Object.assign(e,{routeLocation:f.location,heroNick:()=>state.hero,heroLvl:()=>e.rt.lvl,autonomyMode:()=>state.mode,actionGeneration:()=>state.generation,leaseEpoch:'lease-1',
  campOn:()=>false,campEnabled:()=>false,campActive:()=>false,
  campMobOpen:()=>[],campChampOpen:()=>false,campRbOpen:()=>[],searchActive:()=>true,rbDue:()=>false,
  catGo:async()=>routes.push('catGo'),catNext:async()=>routes.push('catNext'),
  gamePost:async(p,b)=>{posts.push({p,b});throw Error('новый вход/ключ вне разрешённого сценария')},
  canAct:()=>state.canAct,nativePending:()=>!!state.nativePending,antibotState:()=>state.challenge,pvpPending:()=>state.pvp,pvpRecoveryStep:async()=>routes.push('pvp'),
  tvtSoon:()=>state.tvt,tvtStep:async()=>{await state.hooks.tvt?.();return state.tvtStep},tvtHoldWait:async()=>state.tvtHold,
  dailyWorkReady:async task=>{state.quotaCalls.push(task);await state.hooks.quota?.(state.quotaCalls.length);return state.quota},
  rtCommit:async()=>{state.commits++;await state.hooks.commit?.();return state.saveOk},
  magisterAfterWin:async()=>{state.services.push('magister');return false},warlock:{step:async()=>state.services.push('warlock'),chainBlocked:()=>false}});
 state.character={id:HERO,name:'Hero',level:21,l2Profession:'human_wizard',classSlots:{activeSlot:0},revision:100,inBattle:false,rebirthStage:1};
 state.instance={enabled:true,rebirthStage:1,activeRun:{id:RUN,difficulty:1,phase:'mobs',mobKillTarget:300,mobKills:20,
  participantCharacterIds:[HERO],partyId:null,referenceBossSpawnId:'l2dop_rb_25146',referenceBossLevel:21}};
 state.meta={t:state.now,spawn:o.spawn||sid(19),name:'Rebirth · Akaste Succubus Turen',kind:'dungeon',lvl:21,max:7128};
 e.battleInfo=()=>state.meta;
 e.gameGet=async p=>{checks.push(p);assert.ok(['/character','/game/rebirth-raids?view=instance'].includes(p),'только доказательство текущего героя/run');
  await state.hooks.get?.(p);return{ok:state.httpOk!==false,status:state.httpOk===false?503:200,
  json:async()=>{await state.hooks.json?.(p);if(state.jsonError)throw Error('JSON');return clone(p==='/character'?state.characterReply||{character:state.character}:state.instance)}}};
 const source=read('content.js'),control={autonomyMode:()=>state.mode};
 for(const k of ['rt','leaseEpoch'])Object.defineProperty(control,k,{get:()=>e[k]});
 const owner=source.match(/function observeOwner\(\) \{[^\n]+\}/)?.[0];assert.ok(owner);
 const scan=source.match(/get scanContext\(\)\{return (\(\)=>JSON\.stringify\(\[rt\.char,leaseEpoch,rt\.manualKickAt,autonomyMode\(\)\]\))\}/)?.[1];assert.ok(scan);
 vm.runInNewContext(owner+';this.owner=observeOwner;this.scan='+scan+';',control);e.evidenceOwner=control.owner;e.scanContext=control.scan;
 const fire=e.fire;e.fire=b=>{if(b!==f.hunt||!/^rebirth_raid_/.test(new URLSearchParams(f.location.search).get('spawnId')||''))return fire(b);
  state.nativeClicks++;f.events.push('hunt');state.nativeRequests.push('/game/rebirth-raids/next?after='+new URLSearchParams(f.location.search).get('spawnId'));
  if(state.accepted){f.setWon(false);f.hp.textContent='7128 / 7128';f.location.search='?spawnId='+state.nextSpawn;state.meta={...state.meta,spawn:state.nextSpawn}}
  return true};
 const write=e.setRt;e.setRt=async p=>{await write(p);await state.hooks.save?.(p);return{ok:state.saveAck}};
 // Браузер возвращает тот же DOM-узел победы, пока он не заменён; старая общая fixture создавала {} при каждом query.
 const q=e.$q,victoryNode={};e.$q=selector=>selector==='#battle-victory-inline'?(q(selector)?victoryNode:null):selector==='#battle-victory-hunt'&&state.noButton?null:q(selector);
 f.hunt.disabled=false;f.hunt.isConnected=true;
 // Реальная политика срока карты: before обязан упасть, если nextFight вызовет её на живом Rebirth-бою.
 const policy={get cfg(){return e.cfg},get rt(){return e.rt},FARM_EVERY:50,farmMapOn:()=>false,
  campChampDue:()=>false,champHunt:()=>false,champEvery:()=>20,mapOff:()=>!e.cfg.deepEvery,rbDue:()=>false,
  campRbOpen:()=>[],searchActive:()=>true};
 vm.runInNewContext(source.slice(source.indexOf('const deepN ='),source.indexOf('// цепочка сама'))+';this.api={deepN,mapDue};',policy);
 Object.assign(e,policy.api);f.setWon(o.won===true);
 return{...f,state,ss,posts,routes,checks,run:ctx=>f.farm.nextFight(ctx),context:{name:'Rebirth · Akaste Succubus Turen',spawnId:o.spawn||sid(19),killed:[],champ:false}};
}

test('полное имя Rebirth сохраняется до отдельного сегмента уровня',()=>{
 for(const name of ['Langk Lizardman Warrior','Ol Mahum Raider']){
  const f=fixture({title:'Rebirth · '+name+' · ур. 21'});assert.equal(f.combat.mobName(),'Rebirth · '+name);
 }
});

test('обычные и цветные имена по-прежнему отделены от уровня и меток',()=>{
 for(const [title,name] of [['Tumran Bugbear · ур. 23 · агрессивный','Tumran Bugbear'],['Hatu Weird Bee · ур. 30 · чемпион','Hatu Weird Bee'],
  ['Rebirth Beast · ур. 21 · агрессивный','Rebirth Beast'],['Guard · чемпион','Guard'],['Guard','Guard']])assert.equal(fixture({title}).combat.mobName(),name);
});

test('Start/current nextFight не прерывает уже открытый Rebirth raid сроком карты',async()=>{
 for(const withContext of [false,true]){
  const f=fixture();assert.equal(f.env.mapDue([]),true,'настоящая политика карты действительно просрочена');
  await f.run(withContext?f.context:undefined);
  assert.equal(f.events.includes('map'),false,'оплаченный текущий бой не уходит на карту');assert.equal(f.events.includes('hunt'),false,'живой бой не требует нового запуска');
  assert.equal(f.posts.length,0);assert.deepEqual(f.routes,[],'не превращается в обычные катакомбы');assert.equal(f.env.rt.catIn,'witch');assert.equal(f.env.cfg.catMode,false);
 }
});

test('победа: свежий собственный run разрешает ровно один native hunt без новой оплаты и mapDue',async()=>{
 for(const withContext of [false,true]){
  const f=fixture({won:true});assert.equal(f.env.mapDue([]),true);
  await f.run(withContext?f.context:undefined);
  assert.deepEqual(f.checks,['/character','/game/rebirth-raids?view=instance']);assert.equal(f.state.nativeClicks,1);
  assert.equal(f.state.nativeRequests[0],'/game/rebirth-raids/next?after='+sid(19),'after берёт точную завершённую цель');
  assert.equal(new URLSearchParams(f.location.search).get('spawnId'),sid(23),'native-ответ может перескочить после AoE');
  assert.equal(f.events.includes('map'),false);assert.deepEqual(f.routes,[]);assert.equal(f.posts.length,0);assert.deepEqual(f.state.services,[]);
 }
});

test('нужна точная identity победы; URL run без свежей меты или контекста не разрешает native-клик',async()=>{
 const ctxOnly=fixture({won:true});ctxOnly.state.meta=null;await ctxOnly.run(ctxOnly.context);assert.equal(ctxOnly.state.nativeClicks,1);
 for(const kind of ['missing','old','future','other name','conflicting spawn']){
  const f=fixture({won:true});let ctx;
  if(kind==='missing')f.state.meta=null;
  if(kind==='old')f.state.meta.t-=60001;
  if(kind==='future')f.state.meta.t+=60000;
  if(kind==='other name')f.state.meta.name='Other';
  if(kind==='conflicting spawn'){f.state.meta.spawn=sid(20);ctx=f.context}
  await f.run(ctx);assert.equal(f.state.nativeClicks,0,kind);assert.equal(f.checks.length,0,kind+' не начинает proof без identity');assert.equal(f.posts.length,0);
 }
});

test('Rebirth не становится обычными катакомбами при catMode и старом catIn',async()=>{
 for(const won of [false,true]){const f=fixture({won});f.env.cfg.catMode=true;f.env.cfg.catDungeon='witch';f.state.mode='cat';
  await f.run(f.context);assert.deepEqual(f.routes,[]);assert.equal(f.env.rt.catIn,'witch');assert.equal(f.env.cfg.catDungeon,'witch');
  assert.equal(f.state.nativeClicks,won?1:0);assert.equal(f.posts.length,0);assert.equal(f.events.includes('map'),false)}
});

test('chain false и отсутствие/disabled native-кнопки не лечатся картой или повторным входом',async()=>{
 for(const change of [f=>{f.env.cfg.chain=false},f=>{f.state.noButton=true},f=>{f.hunt.disabled=true}]){
  const f=fixture({won:true});change(f);await f.run(f.context);assert.equal(f.state.nativeClicks,0);assert.equal(f.events.includes('map'),false);assert.equal(f.posts.length,0);assert.deepEqual(f.routes,[]);
 }
});

test('чужой/неполный character и отсутствие собственного activeRun не разрешают продолжение',async()=>{
 const changes={hero:f=>{f.state.character.name='Other'},id:f=>{f.state.character.id=''},class:f=>{f.state.character.l2Profession='human_warlock'},
  slot:f=>{f.state.character.classSlots.activeSlot=1},missingSlot:f=>{delete f.state.character.classSlots.activeSlot},revision:f=>{delete f.state.character.revision},
  activeBattle:f=>{f.state.character.inBattle=true},notRebirth:f=>{f.state.character.rebirthStage=0},
  noRun:f=>{f.state.instance.activeRun=null},otherRun:f=>{f.state.instance.activeRun.id='33333333-3333-4333-8333-333333333333'},
  foreignParticipant:f=>{f.state.instance.activeRun.participantCharacterIds=['other']},missingParticipants:f=>{delete f.state.instance.activeRun.participantCharacterIds},
  disabled:f=>{f.state.instance.enabled=false},unknownPhase:f=>{f.state.instance.activeRun.phase='unknown'},
  finished:f=>{f.state.instance.activeRun.phase='completed'},error:f=>{f.state.instance.error='unavailable'}};
 for(const [label,change] of Object.entries(changes)){
  const f=fixture({won:true});change(f);await f.run(f.context);assert.equal(f.state.nativeClicks,0,label);
  assert.equal(f.events.includes('map'),false,label);assert.equal(f.posts.length,0,label);assert.deepEqual(f.routes,[],label);
 }
});

test('Stop, lease, Start, герой/класс/слот, URL, режим, новая цель и антибот отменяют proof после await',async()=>{
 const changes={Stop:f=>{f.env.on=false},owner:f=>{f.env.tabOwner=false},lease:f=>{f.env.leaseEpoch='lease-2'},start:f=>{f.state.generation++},
  hero:f=>{f.env.rt.char='Other'},class:f=>{f.env.rt.classCur.prof='human_warlock'},slot:f=>{f.env.rt.classCur.slot=1},kick:f=>{f.env.rt.manualKickAt++},
  URL:f=>{f.location.href+='#changed'},mode:f=>{f.state.mode='fish'},frame:f=>{f.state.canAct=false},captcha:f=>{f.state.challenge='check'},
  pvp:f=>{f.state.pvp=true},tvt:f=>{f.state.tvt=true},newBattle:f=>{f.setWon(false);f.location.search='?spawnId='+sid(20)},
  metadata:f=>{f.state.meta={...f.state.meta,spawn:sid(20)}},ctxSpawn:f=>{f.context.spawnId=sid(20)},
  title:f=>{f.env.$q('#battle-mob-title').textContent+=' · изменено'},disabled:f=>{f.hunt.disabled=true},
  replacedButton:f=>{const q=f.env.$q;f.env.$q=s=>s==='#battle-victory-hunt'?{title:'Охотиться дальше'}:q(s)}};
 for(const point of ['tvt','actionWait','commit','characterGET','characterJSON','runGET','runJSON','save','lateCommit'])for(const [label,change] of Object.entries(changes)){
  const f=fixture({won:true});let fired=false;
  if(point==='tvt')f.state.hooks.tvt=()=>{if(!fired){fired=true;change(f)}};
  else if(point==='actionWait')f.env.actionWait=async valid=>{fired=true;change(f);return valid()};
  else if(point==='save')f.state.hooks.save=()=>{fired=true;change(f)};
  else if(point==='lateCommit')f.state.hooks.commit=()=>{if(f.state.commits>=2&&!fired){fired=true;change(f)}};
  else if(point==='commit')f.state.hooks.commit=()=>{fired=true;change(f)};
  else f.state.hooks[point.endsWith('GET')?'get':'json']=p=>{if((point.startsWith('character')?p==='/character':p==='/game/rebirth-raids?view=instance')&&!fired){fired=true;change(f)}};
  await f.run(f.context);assert.ok(fired,point+': '+label);assert.equal(f.state.nativeClicks,0,point+': '+label);
  assert.equal(f.events.includes('map'),false,point+': '+label);assert.equal(f.posts.length,0,point+': '+label);
 }
});

test('quota, TvT и уже отправленный native-запрос сохраняют запрет нового боя',async()=>{
 for(const change of [f=>{f.state.quota=false},f=>{f.state.hooks.quota=n=>{if(n>=2)f.state.quota=false}},
  f=>{f.state.tvtStep=true},f=>{f.state.tvtHold=true},f=>{f.state.tvt=true},f=>{f.state.nativePending=true}]){
  const f=fixture({won:true});change(f);await f.run(f.context);assert.equal(f.state.nativeClicks,0);assert.equal(f.posts.length,0);
 }
 const live=fixture();live.state.quota=false;await live.run(live.context);assert.equal(live.events.includes('map'),false);assert.equal(live.state.nativeClicks,0);
});

test('настоящий nativePending игнорирует chat/events и чужого владельца, учитывает next/start/hunt/action',()=>{
 const content=read('content.js'),at=content.indexOf('get nativePending() {');assert.ok(at>=0);
 const end=content.indexOf('get warlock()',at);assert.ok(end>at);
 const declaration=content.slice(at,end);
 const box={NET_CONTEXT:new Map(),rt:{char:'Hero'},leaseEpoch:'lease-1'};
 const pending=vm.runInNewContext('({'+declaration+'}).nativePending',box);
 for(const path of ['/chat','/game/chat','/game/events','/events','/character','/game/battle','/character/mail']){
  box.NET_CONTEXT.clear();box.NET_CONTEXT.set(1,{char:'Hero',lease:'lease-1',path});assert.equal(pending(),false,path);
 }
 for(const path of ['/game/rebirth-raids/next','/game/battle/start','/game/battle/hunt-continue','/game/battle/action']){
  for(const [char,lease,expected] of [['Hero','lease-1',true],['Other','lease-1',false],['Hero','lease-2',false]]){
   box.NET_CONTEXT.clear();box.NET_CONTEXT.set(1,{char,lease,path});assert.equal(pending(),expected,path+'/'+char+'/'+lease);
  }
 }
});

test('ошибки GET/JSON и неудачный flush оставляют оплаченный результат без нового входа',async()=>{
 for(const change of [f=>{f.state.httpOk=false},f=>{f.state.jsonError=true},f=>{f.state.saveOk=false}]){
  const f=fixture({won:true});change(f);await f.run(f.context);assert.equal(f.state.nativeClicks,0);assert.equal(f.events.includes('map'),false);assert.equal(f.posts.length,0);
 }
});

test('отказ ACK финального via-save, позднего flush и записи receipt не разрешает native-клик',async()=>{
 for(const kind of ['save ACK','late flush','receipt']){
  const f=fixture({won:true});
  if(kind==='save ACK')f.state.saveAck=false;
  if(kind==='late flush')f.state.hooks.commit=()=>{if(f.state.commits>=2)f.state.saveOk=false};
  if(kind==='receipt')f.box.sessionStorage.setItem=()=>{throw Error('storage недоступен')};
  await f.run(f.context);assert.equal(f.state.nativeClicks,0,kind);assert.equal(f.posts.length,0,kind);
  f.state.now+=61000;await f.run(f.context);assert.equal(f.state.nativeClicks,0,kind+' повторный tick не обходит отказ');
 }
});

test('потерянное подтверждение native-клика не разрешает второй клик после тика или reload',async()=>{
 const f=fixture({won:true});f.state.accepted=false;await f.run(f.context);assert.equal(f.state.nativeClicks,1);
 f.state.now+=120000;await f.run(f.context);assert.equal(f.state.nativeClicks,1,'истечение времени не разрешает неизвестный повтор');
 const fresh=fixture({won:true,ss:f.ss});fresh.state.accepted=false;fresh.state.now+=180000;await fresh.run(fresh.context);
 assert.equal(fresh.state.nativeClicks,0,'новый экземпляр помнит неизвестный исход текущего after');assert.equal(f.posts.length+fresh.posts.length,0);
});

test('два одновременных nextFight не дублируют proof и native-клик',async()=>{
 const f=fixture({won:true});let release;const gate=new Promise(resolve=>release=resolve);
 f.state.hooks.get=async p=>{if(p==='/character')await gate};
 const first=f.run(f.context);for(let n=0;n<50&&f.checks.length===0;n++)await Promise.resolve();
 assert.equal(f.checks.length,1,'первый proof действительно ожидает character');
 const second=f.run(f.context);for(let n=0;n<20;n++)await Promise.resolve();assert.equal(f.checks.length,1);
 release();await Promise.all([first,second]);assert.equal(f.state.nativeClicks,1);assert.equal(f.posts.length,0);
});

test('sdms-подземелья сохраняют прежнюю native-цепочку, Rebirth не включается в dungeonBattle',async()=>{
 const f=fixture({won:true,spawn:'sdms_witch_119'});f.env.cfg.catMode=true;f.env.cfg.catDungeon='witch';f.state.mode='cat';
 assert.equal(f.farm.dungeonBattle(),true);await f.run(f.context);assert.equal(f.events.filter(x=>x==='hunt').length,1);
 assert.equal(f.state.nativeClicks,0);assert.deepEqual(f.checks,[]);assert.deepEqual(f.routes,[]);
 assert.equal(fixture().farm.dungeonBattle(),false,'Rebirth не проходит обычный catGo/catNext шлюз');
});

test('обычный открытый бой сохраняет прежнюю политику карты',async()=>{
 const f=fixture({spawn:'dense_5598'});await f.run(f.context);assert.equal(f.events.includes('map'),true);assert.equal(f.posts.length,0);
});

test('старый nextFight после victory19 не перекрывает вручную начатый живой mob20',async()=>{
 const prefix='rebirth_raid_11111111-1111-4111-8111-111111111111_1_1_25146_mob_';
 const f=fixture({won:true,spawn:prefix+'19'});
 f.env.tvtStep=async()=>{f.setWon(false);f.hp.textContent='2546 / 7128';f.location.search='?spawnId='+prefix+'20';f.location.href='https://l2wap.com/battle.html'+f.location.search;return false};
 await f.run(f.context);assert.equal(f.events.includes('map'),false);assert.equal(f.events.includes('hunt'),false);assert.equal(f.posts.length,0);assert.deepEqual(f.routes,[]);
});

test('Stop/lease/неизвестный spawn/чужой герой не запускают новый платный вход или ключ',async()=>{
 for(const change of [f=>{f.env.on=false},f=>{f.env.tabOwner=false},f=>{f.location.search='?spawnId=unknown'},f=>{f.env.rt.char='Other'}]){
  const f=fixture();change(f);await f.run(f.context);assert.equal(f.posts.length,0);assert.deepEqual(f.routes,[]);assert.equal(f.events.includes('hunt'),false);
 }
});
