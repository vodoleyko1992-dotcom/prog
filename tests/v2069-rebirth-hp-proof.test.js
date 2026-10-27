'use strict';
// 20.69 (лог 27.10 14:16–14:23): второй Rebirth Wyrm16740HP равен 1,5× прежнего минимума11160.
// Это fresh own dungeon/mob, а не неизвестный чемпион; оба GET и прежние запреты остаются обязательными.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2066-quest-champion-kind.test.js'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),process,console,__dirname,Date,URL,structuredClone};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.fixture=fixture;',box);
const RUN='11111111-1111-4111-8111-111111111111';
const sid=n=>'rebirth_raid_'+RUN+'_2_1_25063_lv35_mob_'+n;
const attacks=f=>f.events.filter(x=>x==='Атака').length;
function fixture(o={}){
 const name=o.name||'Rebirth · Wyrm',spawn=o.spawn||sid(3),f=box.fixture({name,spawn,title:name+' · ур. 35',target:{quest:false},...o});
 f.env.heroLvl=()=>35;f.env.rt.lvl=35;f.env.isQuestName=()=>false;
 f.env.rt.hpMin={[name.toLowerCase()]:11160};f.hp.textContent='16740 / 16740';
 Object.assign(f.state.reply.character,{level:35,rebirthStage:1});
 Object.assign(f.state.reply.battle,{kind:'dungeon',mobLevel:35,mobHp:16740,mobMaxHp:16740});
 const fire=f.env.fire;f.env.fire=b=>{const done=fire(b);if(b===f.atk)f.hp.textContent='0 / 16740';return done;};
 return f;
}
function initial(f){return structuredClone(f.state.reply.character);}

test('свежий собственный Rebirth dungeon mob при точном пороге1,5×HP бьётся без ложного чемпиона',async()=>{
 const f=fixture();await f.combat.battle();assert.equal(attacks(f),1);assert.equal(f.events.includes('map'),false);
 assert.equal(f.env.rt.kills,1);assert.equal(f.state.gets.length,2);assert.equal(f.state.posts.length,0);
 assert.ok(!f.logs.some(l=>l.includes('серверный тип цели неизвестен')));
});

test('старый URL цепочки не подменяет точный Rebirth mob из собственного character',async()=>{
 const f=fixture();f.env.rt.via='chain';f.location.search='?spawnId='+sid(1);
 await f.combat.battle();assert.equal(attacks(f),1);assert.equal(f.events.includes('map'),false);
 assert.equal(f.state.gets[1],'/game/battle?characterId=hero-id&spawnId='+sid(3));assert.equal(f.state.posts.length,0);
});

test('Rebirth-допуск не расширяется на произвольный dungeon, champion/raid и неполное имя или spawn',async()=>{
 for(const o of [{spawn:'dense_5598'},{spawn:'sdms_run_35_mob_3'},{spawn:'rebirth_raid_fake_2_1_25063_lv35_mob_3'},
  {spawn:sid(3).replace('_mob_3','_champion_1')},{spawn:sid(3).replace('_mob_3','_raid_3')},
  {spawn:sid(3).replace('_lv35_','_lv34_')},{spawn:sid(3).replace('_mob_3','_mob_0')},
  {spawn:sid(3)+'_extra'},{name:'Wyrm'},{name:'Rebirth Wyrm'}]){
  const f=fixture(o);await f.combat.battle();assert.equal(attacks(f),0,JSON.stringify(o));
  assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);
 }
});

test('оба свежих character должны подтверждать Rebirth, активный spawn и прежние identity/revision',async()=>{
 for(const [label,change] of Object.entries({
  firstStage:f=>{f.state.initialCharacter=initial(f);delete f.state.initialCharacter.rebirthStage;},
  firstNotRebirth:f=>{f.state.initialCharacter=initial(f);f.state.initialCharacter.rebirthStage=0;},
  firstStringStage:f=>{f.state.initialCharacter=initial(f);f.state.initialCharacter.rebirthStage='1';},
  battleStage:f=>{f.state.initialCharacter=initial(f);delete f.state.reply.character.rebirthStage;},
  battleNotRebirth:f=>{f.state.initialCharacter=initial(f);f.state.reply.character.rebirthStage=0;},
  battleInvalidStage:f=>{f.state.initialCharacter=initial(f);f.state.reply.character.rebirthStage=Infinity;},
  changedStage:f=>{f.state.initialCharacter=initial(f);f.state.reply.character.rebirthStage=2;},
  missingBattleSpawn:f=>{f.state.initialCharacter=initial(f);delete f.state.reply.character.battleSpawnId;},
  wrongCharacter:f=>{f.state.initialCharacter=initial(f);f.state.reply.character.id='other';},
  oldRevision:f=>{f.state.initialCharacter=initial(f);f.state.reply.character.revision--;},
  otherTarget:f=>{f.state.reply.battle.spawnId=sid(4);},
  wrongLevel:f=>{f.state.reply.battle.mobLevel=34;},
  wrongHP:f=>{f.state.reply.battle.mobMaxHp=16741;},
  ended:f=>{f.state.reply.battle.ended=true;},
  pvp:f=>{f.state.reply.battle.isPvp=true;}
 })){
  const f=fixture();change(f);await f.combat.battle();assert.equal(attacks(f),0,label);
  assert.equal(f.events.includes('map'),false,label);assert.equal(f.state.posts.length,0,label);
 }
});

test('dungeon с явным цветом сохраняет правила чемпионов, неизвестный цвет или тип ждёт подтверждения',async()=>{
 for(const kind of ['dungeon','champion'])for(const tier of ['blue','orange','red']){
  const f=fixture({cfg:{champBlue:false}});Object.assign(f.state.reply.battle,{kind,championTier:tier});
  await f.combat.battle();assert.equal(attacks(f),0,kind+':'+tier);assert.equal(f.events.includes('map'),true,kind+':'+tier);
  assert.equal(f.state.posts.length,0);
 }
 for(const patch of [{kind:'unknown'},{kind:''},{championTier:'unknown'},{kind:'champion',championTier:''}]){
  const f=fixture();Object.assign(f.state.reply.battle,patch);await f.combat.battle();assert.equal(attacks(f),0,JSON.stringify(patch));
  assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);
 }
 for(const kind of ['dungeon','champion']){
  const blue=fixture();Object.assign(blue.state.reply.battle,{kind,championTier:'blue'});await blue.combat.battle();
  assert.equal(attacks(blue),1);assert.equal(blue.env.rt.champLearn.st.blue.win,1);
 }
});

test('Rebirth-подтверждение отменяется на каждом await и перед ударом при Stop/смене контекста',async()=>{
 const changes={Stop:f=>{f.env.on=false;},owner:f=>{f.env.tabOwner=false;},class:f=>{f.env.rt.classCur.prof='human_warlock';},
  slot:f=>{f.env.rt.classCur.slot=1;},generation:f=>{f.state.generation++;},target:f=>{f.env.rt.target.tier='red';},
  url:f=>{f.location.search+='&changed=1';},captcha:f=>{f.state.challenge=true;},pvp:f=>{f.state.pvp=true;}};
 for(const point of ['commit','characterGET','characterJSON','battleGET','battleJSON','actionWait'])for(const [label,change] of Object.entries(changes)){
  const f=fixture();let applied=false;const apply=()=>{if(!applied){applied=true;change(f);}};
  if(point==='commit')f.state.hooks.commit=apply;
  else if(point==='actionWait')f.env.actionWait=async valid=>{apply();return valid();};
  else f.state.hooks[point.endsWith('GET')?'get':'json']=url=>{if(point.startsWith('character')?url==='/character':url.startsWith('/game/battle?'))apply();};
  await f.combat.battle();assert.ok(applied,point+':'+label);assert.equal(attacks(f),0,point+':'+label);
  assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);
 }
});

test('ошибка GET Rebirth по-прежнему ждёт ограниченный повтор и не создаёт дополнительного POST',async()=>{
 const f=fixture(),get=f.env.gameGet;let failing=true;
 f.env.gameGet=async url=>{const r=await get(url);return failing?{...r,ok:false,status:503}:r;};
 await f.combat.battle();assert.equal(attacks(f),0);assert.equal(f.state.gets.length,1);
 f.state.now+=2999;await f.combat.battle();assert.equal(f.state.gets.length,1);
 failing=false;f.state.now++;await f.combat.battle();assert.equal(attacks(f),1);assert.equal(f.state.gets.length,3);assert.equal(f.state.posts.length,0);
});
