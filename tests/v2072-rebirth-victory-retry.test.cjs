'use strict';
// Лог28.10 03:12: timeout→60с backoff→устаревшая победа без ctx→1748ожиданий и20мин передышки.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2071-rebirth-route-isolation.test.cjs'),src=fs.readFileSync(file,'utf8');
const code=src.slice(0,src.indexOf("\ntest('"))+src.slice(src.indexOf('function victoryFixture('),src.indexOf("test('отдельное продолжение"))+'\nthis.won=victoryFixture;';
const box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone};vm.runInNewContext(code,box);
async function own(role='mob'){
 const f=box.won(role);f.ch.inBattle=true;assert.ok(await f.prove(),'собственный живой бой сначала подтверждён штатным battleProof');f.ch.inBattle=false;
 const metadata={t:f.now(),spawn:f.ctx.spawnId,name:f.ctx.name};f.env.battleInfo=()=>f.S.noMetadata?null:metadata;f.metadata=metadata;f.reads.length=0;
 return f;
}
const noActions=f=>{assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);};

test('таймаут→60с→повтор без ctx восстанавливает тот же оплаченный run через каталог',async()=>{
 const f=await own(),get=f.env.gameGet;let fail=true;
 f.env.gameGet=async url=>{const r=await get(url);return fail&&url==='/character'?{...r,ok:false,status:503}:r;};
 await f.api().nextFight();assert.equal(f.reads.length,2);noActions(f);
 fail=false;f.tick(59999);await f.api().nextFight();assert.equal(f.reads.length,2,'до срока сервер не опрашивается');noActions(f);
 f.tick(1);await f.api().nextFight();assert.equal(f.reads.length,4,'после истечения метки снова свежие GET');
 assert.equal(f.location.pathname,'/rebirth-raids.html');noActions(f);
 f.env.fire=b=>{f.clicks.push(b.role);if(b.role==='continue')f.location.href='/rebirth-raid-dungeon.html';
  if(b.role==='fight'){f.ch.inBattle=true;f.location.href='/battle.html?spawnId='+f.ctx.spawnId.replace(/mob_1$/,'mob_2');}return true;};
 await f.step();assert.equal(f.location.pathname,'/rebirth-raid-dungeon.html');assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
 f.tick(3000);await f.step();assert.equal(f.location.pathname,'/battle.html');assert.equal(f.ch.inBattle,true);
 assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);assert.equal(f.clicks.filter(x=>x==='hunt').length,0,'не повторяем next по старой победе');
 assert.equal(f.clicks.filter(x=>x==='fight').length,1,'свежая кнопка текущего оплаченного этапа');
});

for(const missing of [false,true])test('перезагрузка/возраст метки без ctx не требует ручного продолжения: '+missing,async()=>{
 const f=await own();f.tick(61000);f.S.noMetadata=missing;if(missing)f.reload();
 await f.api().nextFight();assert.equal(f.reads.length,2);assert.equal(f.location.pathname,'/rebirth-raids.html');noActions(f);
});

for(const change of ['run','malformedRun','spawn','actor','class','slot','char','role','kick','missing'])test('неподтверждённая сохранённая связь боя не разрешает восстановление: '+change,async()=>{
 const f=await own();f.tick(61000);f.S.noMetadata=true;const r=f.env.rt.rebirth;
 if(change==='run')r.runId='22222222-2222-4222-8222-222222222222';if(change==='malformedRun')r.runId=42;if(change==='spawn')r.battleSpawn+='1';if(change==='actor')r.actor='other';
 if(change==='class')r.prof='other';if(change==='slot')r.slot=1;if(change==='char')r.observedRun.char='Other';if(change==='role')r.battleRole='champion';
 if(change==='kick')r.observedRun.kick=1;if(change==='missing')f.env.rt.rebirth={};
 await f.api().nextFight();assert.equal(f.location.pathname,'/battle.html');noActions(f);
});

for(const change of ['duplicate','badUuid','zeroMob','ordinary','wrongPath','metadataSpawn','metadataName','ctxSpawn','ctxName'])test('неоднозначный или противоречивый указатель победы не восстанавливается: '+change,async()=>{
 const f=await own();f.tick(61000);let ctx;
 if(change==='duplicate')f.location.href+='&spawnId='+f.ctx.spawnId;if(change==='badUuid')f.location.href=f.location.href.replace(/11111111/g,'notuuid');
 if(change==='zeroMob')f.location.href=f.location.href.replace(/mob_1$/,'mob_0');if(change==='ordinary')f.location.href='https://l2wap.com/battle.html?spawnId=dense_1';
 if(change==='wrongPath')f.location.href=f.location.href.replace('/battle.html','/map.html');
 if(change==='metadataSpawn')f.metadata.spawn+='1';if(change==='metadataName')f.metadata.name='Other';
 if(change==='ctxSpawn')ctx={name:f.ctx.name,spawnId:'dense_other'};if(change==='ctxName')ctx={name:'Other',spawnId:f.ctx.spawnId};
 await f.api().nextFight(ctx);assert.notEqual(f.location.pathname,'/rebirth-raids.html');noActions(f);
});

for(const change of ['foreignActor','foreignRun','party','inBattle','stage','dead','http','json'])test('устаревшая победа заново требует свежие серверные подтверждения: '+change,async()=>{
 const f=await own();f.tick(61000);
 if(change==='foreignActor')f.ch.id='other';if(change==='foreignRun')f.instance.activeRun.id='22222222-2222-4222-8222-222222222222';
 if(change==='party')f.instance.activeRun.partyId='party';if(change==='inBattle')f.ch.inBattle=true;if(change==='stage')f.instance.rebirthStage=2;if(change==='dead')f.ch.hp=0;
 const get=f.env.gameGet;f.env.gameGet=async url=>{const r=await get(url);if(url!=='/character')return r;if(change==='http')return{...r,ok:false,status:503};
  if(change==='json')return{...r,json:async()=>{throw Error('bad JSON');}};return r;};
 await f.api().nextFight();assert.equal(f.reads.length,2);assert.equal(f.location.pathname,'/battle.html');noActions(f);
});

for(const point of ['read','json','commit'])for(const change of ['stop','owner','class','mode','page','generation','metadata','lineage'])test(`после await ${point} отмена ${change} не уводит в каталог`,async()=>{
 const f=await own();f.tick(61000);let changed=false;
 const cancel=()=>{if(changed)return;changed=true;
  if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='class')f.env.rt.classCur.prof='other';if(change==='mode')f.S.mode='farm';
  if(change==='page')f.location.href+='#manual';if(change==='generation')f.S.generation=2;if(change==='metadata')f.metadata.spawn+='1';
  if(change==='lineage')f.env.rt.rebirth.battleSpawn+='1';};
 f.S.hooks[point]=cancel;await f.api().nextFight();assert.equal(changed,true);assert.equal(f.location.pathname,'/battle.html');noActions(f);
});

test('неизвестный отправленный next и native-inflight не обходятся восстановлением',async()=>{
 for(const pending of ['receipt','native']){const f=await own();
  if(pending==='receipt'){await f.api().nextFight();assert.equal(f.clicks.filter(x=>x==='hunt').length,1);f.clicks.length=0;}
  else f.S.native=true;
  f.tick(61000);await f.api().nextFight();assert.equal(f.location.pathname,'/battle.html');noActions(f);
 }
});

for(const change of ['actor','stage'])test('неизвестная фаза не обходит свежую связь героя с прежним боем: '+change,async()=>{
 const f=await own();f.tick(61000);f.instance.activeRun.phase='unknown';
 if(change==='actor'){f.ch.id='other';f.instance.activeRun.participantCharacterIds=['other'];}else f.instance.rebirthStage=2;
 await f.api().nextFight();assert.equal(f.location.pathname,'/battle.html');noActions(f);
});
