'use strict';
// 20.66: новый документ боя без BATTLE_NET после map/start сверяет тип цели при одном сигнале старого HP.
// HP3000 — воспроизводящее условие стенда, а не извлечённый из пользовательского журнала факт.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {flowFixture}=require(path.join(root,'tests/warlock-combat-fixture.cjs'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function fixture(o={}){
 const f=flowFixture('fighter'),e=f.env;
 if(process.env.L2_COMBAT_SOURCE){vm.runInContext(fs.readFileSync(process.env.L2_COMBAT_SOURCE,'utf8'),f.box);f.combat=f.box.L2V7Factories.combat(e)}
 const name=o.name||'Tumran Bugbear',spawn=o.spawn||'dense_5598';
 const state={gets:[],posts:[],commits:0,canAct:true,mode:'farm',generation:1,hooks:{},httpOk:true,now:Date.now(),challenge:null,pvp:false};
 f.box.Date=class extends Date{static now(){return state.now}};
 Object.assign(e.cfg,{champHpMult:1.5,champBlue:true,champOrange:false,champRed:false,champMinLvl:0,champCancel:'always',...o.cfg});
 Object.assign(e.rt,{char:'QuestHero',lvl:25,classCur:{prof:'human_wizard',slot:0},manualKickAt:7,
  hpMin:{[name.toLowerCase()]:3000},target:{name,champ:!!o.champ,quest:true,...o.target},via:'map'});
 f.location.search='?spawnId='+spawn;e.heroLvl=()=>25;e.heroNick=()=>e.rt.char;e.isQuestName=()=>true;e.leaseEpoch='lease-1';
 let hash='',origin='https://l2wap.com';Object.defineProperty(f.location,'href',{get:()=> origin+f.location.pathname+f.location.search+hash,
  set:v=>{const u=new URL(v,'https://l2wap.com');f.location.pathname=u.pathname;f.location.search=u.search;hash=u.hash;origin=u.origin}});
 e.$q('#battle-mob-title').textContent=o.title||name+' · ур. 23 · '+(o.champ?'чемпион':'агрессивный');
 f.hp.textContent='5073 / 5073';
 const marking=read('content.js'),a=marking.indexOf('function hasMark('),b=marking.indexOf('const PAGE_SIZE =',a);
 const sb={cfg:{champMark:'чемпион,champion'},names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim())};
 vm.runInNewContext(marking.slice(a,b)+';this.isChampion=isChamp;',sb);e.isChamp=sb.isChampion;
 e.battleInfo=()=>o.meta||null;
 if(o.lookupTier)e.champTier=()=>o.lookupTier;
 state.reply={revision:100,character:{id:'hero-id',name:'QuestHero',level:25,l2Profession:'human_wizard',classSlots:{activeSlot:0},
  revision:100,inBattle:true,battleSpawnId:spawn},battle:{spawnId:spawn,mobName:name,mobLevel:23,kind:'aggressive',championTier:'',mobHp:5073,mobMaxHp:5073}};
 e.gameGet=async url=>{state.gets.push(url);await state.hooks.get?.(url,state.gets.length);return{ok:state.httpOk,status:state.httpOk?200:503,
  json:async()=>{await state.hooks.json?.(url,state.gets.length);return structuredClone(url==='/character'?{character:state.initialCharacter||state.reply.character}:state.reply)}}};
 e.gamePost=async url=>{state.posts.push(url);throw Error('сверка типа не отправляет POST')};
 e.rtCommit=async()=>{state.commits++;await state.hooks.commit?.();return state.commitOk!==false};
 e.canAct=()=>state.canAct;e.antibotState=()=>state.challenge;e.pvpPending=()=>state.pvp;e.actionGeneration=()=>state.generation;
 const control={cfg:e.cfg,location:f.location,autonomyMode:()=>state.mode};
 for(const k of ['on','tabOwner','leaseEpoch','rt'])Object.defineProperty(control,k,{get:()=>e[k]});
 const owner=marking.match(/function observeOwner\(\) \{[^\n]+\}/)?.[0];assert.ok(owner,'настоящий владелец сетевых наблюдений');
 const exit=marking.match(/get battleExitContext\(\)\{return (\(\)=>JSON\.stringify\([^\n]+?\))\}, get evidenceOwner/)?.[1];assert.ok(exit,'настоящий контекст выхода');
 vm.runInNewContext(owner+';this.owner=observeOwner;this.exit='+exit+';',control);e.evidenceOwner=control.owner;e.battleExitContext=control.exit;
 vm.runInContext(read('modules/champs.js'),f.box);
 e.champs=require(path.join(root,'tests/champs-context-fixture.cjs')).freshChamps(f.box.L2V7Factories.champs,e);
 const fire=e.fire;e.fire=b=>{const r=fire(b);if(b===f.atk)f.hp.textContent='0 / 5073';if(b===f.hunt)f.hp.textContent='5073 / 5073';return r};
 return{...f,state};
}

test('ordinary квест после map→новый battle документ: один удар, без ухода как unknown чемпион',async()=>{
 const f=fixture();await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,1);
 assert.equal(f.events.filter(x=>x==='map').length,0);assert.equal(f.env.rt.kills,1);assert.equal(f.state.gets.length,2,'одна сверка героя и текущего боя');assert.equal(f.state.posts.length,0);
});

test('свежий серверный ordinary тип сохраняет обычный бой при прежнем hpMin',async()=>{
 const f=fixture({meta:{t:Date.now(),spawn:'dense_5598',name:'Tumran Bugbear',kind:'aggressive',tier:'',lvl:23,max:5073}});
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.events.includes('map'),false);
 assert.equal(f.state.gets.length,0,'уже свежий ordinary тип не создаёт новый GET');
});

test('настоящие blue/orange/red не обходят выключенный цвет ради квестовой метки',async()=>{
 for(const tier of ['blue','orange','red']){
  const f=fixture({champ:true,target:{tier},cfg:{champBlue:false}});await f.combat.battle();
  assert.equal(f.events.filter(x=>x==='Атака').length,0,tier);assert.equal(f.events.filter(x=>x==='map').length,1,tier);
  assert.equal(f.env.rt.kills,0,tier);
  assert.equal(f.state.gets.length,0,'явный цвет сохраняет прежний путь без дополнительной сверки');
 }
});

test('обычный DOM-заголовок не скрывает свежий серверный champion или явный цвет',async()=>{
 for(const tier of ['blue','orange','red','']){
  const f=fixture({cfg:{champBlue:false},meta:{t:Date.now(),spawn:'dense_5598',name:'Tumran Bugbear',kind:'champion',tier,lvl:23,max:5073}});
  await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0,tier);assert.equal(f.events.filter(x=>x==='map').length,1,tier);
 }
});

test('ordinary слово не скрывает прямой champion spawn, точную цветную цель или второй champion сегмент',async()=>{
 for(const opt of [{spawn:'champ_o_plains_of_dion_4'}, {spawn:'champ_r_plains_of_dion_4'}, {lookupTier:'red'},
  {target:{champ:true,tier:'red'}}, {title:'Tumran Bugbear · ур. 23 · агрессивный · чемпион',target:{tier:'red'}}]){
  const f=fixture(opt);await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);
  assert.equal(f.events.filter(x=>x==='map').length,1);
  assert.equal(f.state.gets.length,0,'явный champion не уходит в ordinary-сверку');
 }
});

test('свежий API ordinary допускает все четыре серверных типа, без квестовой или DOM догадки',async()=>{
 for(const kind of ['normal','passive','neutral','aggressive']){
  const f=fixture({title:'Tumran Bugbear · ур. 23',target:{quest:false}});f.env.isQuestName=()=>false;
  f.state.reply.battle.kind=kind;f.state.reply.battle.mobName='TUMRAN BUGBEAR';await f.combat.battle();
  assert.equal(f.events.filter(x=>x==='Атака').length,1,kind);assert.equal(f.events.includes('map'),false,kind);
  assert.equal(f.state.gets[0],'/character');assert.equal(f.state.gets[1],'/game/battle?characterId=hero-id&spawnId=dense_5598');assert.equal(f.state.posts.length,0);
 }
});

test('fresh champion с подтверждённым цветом проходит прежний запрет цветов',async()=>{
 for(const patch of [{kind:'champion',championTier:'blue'},{kind:'champion',championTier:'orange'},{kind:'champion',championTier:'red'},
  {kind:'aggressive',championTier:'red'}]){
  const f=fixture({cfg:{champBlue:false}});Object.assign(f.state.reply.battle,patch);await f.combat.battle();
  assert.equal(f.events.filter(x=>x==='Атака').length,0,JSON.stringify(patch));assert.equal(f.events.includes('map'),true,'подтверждённый цвет проверяется прежним правилом');
  assert.equal(f.state.posts.length,0);assert.equal(f.state.gets.length,2);
 }
});

test('fresh разрешённый синий чемпион продолжает бой и получает обычный учёт win',async()=>{
 const f=fixture();Object.assign(f.state.reply.battle,{kind:'champion',championTier:'blue'});await f.combat.battle();
 assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.events.includes('map'),false);assert.equal(f.state.gets.length,2);
 assert.equal(f.env.rt.champLearn.st.blue.win,1);assert.equal(f.state.posts.length,0);
});

test('неизвестный тип или чемпион без цвета ждёт доказательства без ухода и атаки',async()=>{
 for(const patch of [{kind:'champion',championTier:''},{kind:''},{kind:'pve'}]){
  const f=fixture();Object.assign(f.state.reply.battle,patch);await f.combat.battle();assert.equal(f.events.includes('Атака'),false);
  assert.equal(f.events.includes('map'),false);assert.equal(f.state.gets.length,2);assert.equal(f.state.posts.length,0);
 }
});

test('чужой или неполный первый character не разрешает чтение чужого боя',async()=>{
 for(const patch of [{name:'Other'},{id:''},{l2Profession:'human_warlock'},{classSlots:{activeSlot:1}},{classSlots:{}},{level:24},{level:undefined},
  {revision:undefined},{revision:-1},{inBattle:false},{inBattle:undefined},{battleSpawnId:'other'},{battleSpawnId:'pvp_unsafe'},
  {battleSpawnId:undefined},{battleSpawnId:'unsafe/path'}]){
  const f=fixture();f.state.initialCharacter={...structuredClone(f.state.reply.character),...patch};await f.combat.battle();
  assert.equal(f.state.gets.length,1,JSON.stringify(patch));assert.equal(f.events.includes('Атака'),false);assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);
 }
});

test('свежий бой требует того же героя, класса, слота, revision, exact spawn/name/max и живого PvE',async()=>{
 const changes={hero:d=>{d.character.name='Other'},id:d=>{d.character.id='other-id'},class:d=>{d.character.l2Profession='human_warlock'},
  slot:d=>{d.character.classSlots.activeSlot=1},heroLevel:d=>{d.character.level=24},missingHeroLevel:d=>{delete d.character.level},
  mobLevel:d=>{d.battle.mobLevel=24},missingMobLevel:d=>{delete d.battle.mobLevel},revision:d=>{d.character.revision=99},missingRevision:d=>{delete d.character.revision},
  noBattle:d=>{d.character.inBattle=false},characterSpawn:d=>{d.character.battleSpawnId='other'},spawn:d=>{d.battle.spawnId='other'},
  name:d=>{d.battle.mobName='Other'},max:d=>{d.battle.mobMaxHp=5000},zeroHP:d=>{d.battle.mobHp=0},missingHP:d=>{delete d.battle.mobHp},
  oversizedHP:d=>{d.battle.mobHp=5074},ended:d=>{d.battle.ended=true},finished:d=>{d.battle.finished=true},victory:d=>{d.victory={}},
  defeat:d=>{d.defeat={}},status:d=>{d.battle.status='victory'},error:d=>{d.error='unknown'},pvp:d=>{d.battle.kind='pvp'},
  tvt:d=>{d.battle.battleType='tvt'},characterPvp:d=>{d.character.isPvp=true},outerTvt:d=>{d.tvt=true}};
 for(const [label,change] of Object.entries(changes)){
  const f=fixture();change(f.state.reply);f.state.initialCharacter={id:'hero-id',name:'QuestHero',level:25,l2Profession:'human_wizard',classSlots:{activeSlot:0},revision:100,inBattle:true,battleSpawnId:'dense_5598'};
  await f.combat.battle();assert.equal(f.events.includes('Атака'),false,label);assert.equal(f.events.includes('map'),false,label);assert.equal(f.state.posts.length,0,label);
 }
});

test('после каждого await сохраняются Stop, владелец, lease, герой, класс, слот, поколение, полный URL и текущая цель',async()=>{
 const changes={Stop:f=>{f.env.on=false},owner:f=>{f.env.tabOwner=false},lease:f=>{f.env.leaseEpoch='lease-2'},
  hero:f=>{f.env.rt.char='Other'},class:f=>{f.env.rt.classCur.prof='human_warlock'},slot:f=>{f.env.rt.classCur.slot=1},
  start:f=>{f.state.generation++},kick:f=>{f.env.rt.manualKickAt++},mode:f=>{f.state.mode='cat'},
  fullURL:f=>{f.location.href+='&changed=1'},hash:f=>{f.location.href+='#frame-change'},origin:f=>{f.location.href='https://other.invalid/battle.html?spawnId=dense_5598'},
  page:f=>{f.location.pathname='/map.html'},canAct:f=>{f.state.canAct=false},captcha:f=>{f.state.challenge='check'},pvp:f=>{f.state.pvp=true},
  mobName:f=>{f.env.$q('#battle-mob-title').textContent='Other mob · ур. 23'},mobMax:f=>{f.hp.textContent='5000 / 5000'},
  championTitle:f=>{f.env.$q('#battle-mob-title').textContent+=' · чемпион'},target:f=>{f.env.rt.target={...f.env.rt.target,champ:true,tier:'red'}},
  targetTier:f=>{f.env.rt.target.tier='red'},
  metadata:f=>{f.env.battleInfo=()=>({t:f.state.now,name:'Tumran Bugbear',spawn:'dense_5598',kind:'champion',tier:'red',max:5073})}};
 for(const point of ['commit','characterGET','characterJSON','battleGET','battleJSON'])for(const [label,change] of Object.entries(changes)){
  const f=fixture();let fired=false;
  if(point==='commit')f.state.hooks.commit=()=>{fired=true;change(f)};
  else f.state.hooks[point.endsWith('GET')?'get':'json']=(url)=>{if((point.startsWith('character')?url==='/character':url.startsWith('/game/battle?'))&&!fired){fired=true;change(f)}};
  await f.combat.battle();assert.ok(fired,point+': '+label);assert.equal(f.events.includes('Атака'),false,point+': '+label);
  assert.equal(f.events.includes('map'),false,point+': '+label);assert.equal(f.state.posts.length,0,point+': '+label);
 }
});

test('успешная API-сверка отменяется перед первым fire при изменении цели внутри actionWait или gameFree',async()=>{
 const changes={generation:f=>{f.state.generation++},metadata:f=>{f.env.battleInfo=()=>({t:f.state.now,name:'Tumran Bugbear',spawn:'dense_5598',kind:'champion',tier:'red',max:5073})},
  title:f=>{f.env.$q('#battle-mob-title').textContent+=' · чемпион'},target:f=>{f.env.rt.target.tier='red'}};
 for(const stage of ['actionWait','gameFree'])for(const [label,change] of Object.entries(changes)){
  const f=fixture();let fired=false;
  if(stage==='actionWait')f.env.actionWait=async valid=>{fired=true;change(f);return valid()};
  else{let busy=true;f.env.gameBusy=()=>({busy,end:0});f.env.combatPulse=async ms=>{f.state.now+=ms;busy=false;fired=true;change(f)}}
  await f.combat.battle();assert.ok(fired,stage+': '+label);assert.equal(f.state.gets.length,2,'сверка уже завершилась');
  assert.equal(f.events.includes('Атака'),false,stage+': '+label);assert.equal(f.events.includes('map'),false,stage+': '+label);
 }
});

test('неполная сверка и HTTP-отказ имеют backoff; отсутствие одного HP-сигнала не создаёт GET',async()=>{
 const f=fixture();f.state.reply.battle.kind='';await f.combat.battle();assert.equal(f.state.gets.length,2);
 f.state.now+=14999;await f.combat.battle();assert.equal(f.state.gets.length,2);f.state.now++;
 f.state.reply.battle.kind='aggressive';await f.combat.battle();assert.equal(f.state.gets.length,4);assert.equal(f.events.filter(x=>x==='Атака').length,1);
 const http=fixture();http.state.httpOk=false;await http.combat.battle();assert.equal(http.state.gets.length,1);
 // 20.68: временный HTTP-отказ повторяется через 3/6/12 с; неполная схема выше по-прежнему ждёт 15 с.
 http.state.now+=2999;await http.combat.battle();assert.equal(http.state.gets.length,1);http.state.now++;http.state.httpOk=true;
 await http.combat.battle();assert.equal(http.state.gets.length,3);assert.equal(http.events.filter(x=>x==='Атака').length,1);
 for(const minimum of [undefined,5000]){const ordinary=fixture();ordinary.env.rt.hpMin={'tumran bugbear':minimum};await ordinary.combat.battle();
  assert.equal(ordinary.state.gets.length,0);assert.equal(ordinary.events.filter(x=>x==='Атака').length,1)}
});

test('цепочка читает точный активный spawn из собственного character, а не старый spawn в адресе',async()=>{
 const f=fixture();f.env.rt.via='chain';f.location.search='?spawnId=old-first-mob';
 f.state.reply.character.battleSpawnId='dense_next';f.state.reply.battle.spawnId='dense_next';await f.combat.battle();
 assert.equal(f.state.gets[1],'/game/battle?characterId=hero-id&spawnId=dense_next');
 assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.events.includes('map'),false);
});

test('отказ flush не запускает GET, одновременные обращения не дублируют сверку',async()=>{
 const f=fixture();f.state.commitOk=false;await f.combat.battle();assert.equal(f.state.gets.length,0);assert.equal(f.events.includes('Атака'),false);assert.equal(f.events.includes('map'),false);
 const concurrent=fixture();let release,seen;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>seen=resolve);
 concurrent.state.hooks.get=async url=>{if(url==='/character'){seen();await gate}};
 const first=concurrent.combat.battle();await started;await concurrent.combat.battle();assert.equal(concurrent.state.gets.length,1,'второй круг не начинает такой же GET');
 release();await first;assert.equal(concurrent.state.gets.length,2);assert.equal(concurrent.events.filter(x=>x==='Атака').length,1);
});

test('явно разрешённый синий чемпион сохраняет настоящий бой и учёт цвета',async()=>{
 const f=fixture({champ:true,target:{tier:'blue'}});await f.combat.battle();
 assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.events.includes('map'),false);assert.equal(f.env.rt.champLearn.st.blue.win,1);
});

test('неполный заголовок и обычное слово в имени не превращаются в доказательство ordinary',async()=>{
 for(const opt of [{title:'Tumran Bugbear · ур. 23'},{name:'Агрессивный зверь',title:'Агрессивный зверь · ур. 23'}]){
  const f=fixture(opt);f.state.reply.battle.kind='';await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);
  assert.equal(f.events.filter(x=>x==='map').length,0,'неопределённый тип ждёт свежего доказательства');
 }
});

test('неподходящий серверный ordinary снимок не дополняет отсутствующий тип в DOM',async()=>{
 for(const patch of [{t:Date.now()-60001},{t:Date.now()+60000},{name:'Other mob'},{max:5000}]){
  const f=fixture({title:'Tumran Bugbear · ур. 23',meta:{t:Date.now(),spawn:'dense_5598',name:'Tumran Bugbear',kind:'aggressive',tier:'',max:5073,...patch}});
  f.state.reply.battle.kind='';await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);assert.equal(f.events.filter(x=>x==='map').length,0);
 }
});
