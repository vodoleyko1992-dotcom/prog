'use strict';
// 20.74, лог28.10 05:58: next→200, но start не отправлен; durable receipt не должна запрещать бесплатную сверку.
// По прямой просьбе пользователя файл написан, но НЕ запускался при сборке20.74.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2072-rebirth-victory-retry.test.cjs'),src=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(src.slice(0,src.indexOf("\ntest('"))+'\nthis.make=own;',box);
const RECEIPT='l2bot.rebirth-next';
async function fixture({role='mob',age=9000,metadata=true}={}){
 const f=await box.make(role),raw=JSON.stringify({key:JSON.stringify(['Hero','human_wizard',0,f.ctx.spawnId]),t:f.now()-age});
 f.storage.set(RECEIPT,raw);f.raw=raw;if(!metadata)f.S.noMetadata=true;return f;
}
const noPayments=f=>{assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);assert.equal(f.storage.get(RECEIPT),f.raw);};
const noClicks=f=>{noPayments(f);assert.equal(f.clicks.length,0);};

test('ACKnext без start: свежая победа+receipt→catalog→тот же оплаченный Continue/Fight без второго hunt',async()=>{
 const f=await fixture();await f.api().nextFight(f.ctx);
 assert.equal(f.reads.length,2);assert.equal(f.location.pathname,'/rebirth-raids.html');noClicks(f);
 const next=f.ctx.spawnId.replace(/mob_1$/,'mob_2');f.env.fire=b=>{f.clicks.push(b.role);if(b.role==='continue')f.location.href='/rebirth-raid-dungeon.html';
  if(b.role==='fight'){f.ch.inBattle=true;f.ch.battleSpawnId=next;f.location.href='/battle.html?spawnId='+next;}return true;};
 await f.step();assert.equal(f.location.pathname,'/rebirth-raid-dungeon.html');f.tick(3000);await f.step();
 assert.equal(f.location.pathname,'/battle.html');assert.equal(f.ch.battleSpawnId,next);assert.deepEqual(Array.from(f.clicks),['continue','fight']);noPayments(f);
});

for(const missing of [false,true])test('receipt после reload и60с не требует ручного hunt: '+missing,async()=>{
 const f=await fixture({metadata:!missing});f.tick(61000);f.reload();await f.api().nextFight();
 assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.reads.length,2);noClicks(f);
});

for(const age of [0,7999,-1])test('ранний или будущий receipt не обгоняет нативный запрос: '+age,async()=>{
 const f=await fixture({age});await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.reads.length,0);noClicks(f);
});

test('граница8с допускает лишь свежую сверку, никогда старый hunt',async()=>{
 const f=await fixture({age:7999});await f.api().nextFight(f.ctx);assert.equal(f.reads.length,0);f.tick(1);await f.api().nextFight(f.ctx);
 assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.reads.length,2);noClicks(f);
});

for(const change of ['run','actor','prof','slot','spawn','role','char','kick','missing','duplicate'])test('receipt без точной собственной lineage удерживает старую страницу: '+change,async()=>{
 const f=await fixture(),s=f.env.rt.rebirth;if(change==='run')s.runId='22222222-2222-4222-8222-222222222222';if(change==='actor')s.actor='';
 if(change==='prof')s.prof='other';if(change==='slot')s.slot=1;if(change==='spawn')s.battleSpawn+='1';if(change==='role')s.battleRole='champion';
 if(change==='char')s.observedRun.char='Other';if(change==='kick')s.observedRun.kick++;if(change==='missing')f.env.rt.rebirth={};if(change==='duplicate')f.location.href+='&spawnId='+f.ctx.spawnId;
 await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.reads.length,0);noClicks(f);
});

for(const change of ['foreignRun','foreignActor','party','stage','inBattle','dead','revision','difficulty','http','json'])test('сверка receipt не принимает неизвестный или чужой свежий сервер: '+change,async()=>{
 const f=await fixture();if(change==='noRun')f.instance.activeRun=null;if(change==='foreignRun')f.instance.activeRun.id='22222222-2222-4222-8222-222222222222';
 if(change==='foreignActor'){f.ch.id='other';f.instance.activeRun.participantCharacterIds=['other'];}if(change==='party')f.instance.activeRun.partyId='party';
 if(change==='stage')f.instance.rebirthStage=2;if(change==='inBattle')f.ch.inBattle=true;if(change==='dead')f.ch.hp=0;if(change==='revision')f.ch.revision=-1;
 if(change==='difficulty')f.instance.activeRun.difficulty=99;const get=f.env.gameGet;f.env.gameGet=async url=>{const r=await get(url);if(url!=='/character')return r;
  if(change==='http')return{...r,ok:false,status:503};if(change==='json')return{...r,json:async()=>{throw Error('bad JSON');}};return r;};
 await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.reads.length,2);noClicks(f);
});

test('20.74: receipt последнего рейда с activeRun:null возвращает в каталог без следующего платного входа',async()=>{
 const f=await fixture({role:'raid'});f.env.rt.rebirth.char='Hero';f.env.cfg.rebirthAutoEnter=true;f.instance.activeRun=null;
 await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.reads.length,2);noClicks(f);
});

for(const point of ['read','json','commit'])for(const change of ['stop','owner','class','mode','generation','page','lineage','receipt','captcha','native'])test(`receipt: отмена ${change} после ${point} не уводит старый контекст`,async()=>{
 const f=await fixture();let changed=false,blocked=false;
 f.env.antibotState=()=>blocked;const cancel=()=>{if(changed)return;changed=true;
  if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='class')f.env.rt.classCur.prof='other';if(change==='mode')f.S.mode='farm';
  if(change==='generation')f.S.generation=2;if(change==='page')f.location.href+='#manual';if(change==='lineage')f.env.rt.rebirth.battleSpawn+='1';
  if(change==='receipt')f.storage.set(RECEIPT,JSON.stringify({key:'replacement',t:f.now()}));if(change==='captcha')blocked=true;if(change==='native')f.S.native=true;};
 if(point==='commit')f.S.hooks.commit=cancel;else f.S.hooks[point]=url=>{if(url==='/character')cancel();};
 await f.api().nextFight(f.ctx);assert.equal(changed,true);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.keys,100);
 if(change!=='receipt')assert.equal(f.storage.get(RECEIPT),f.raw);
});

test('native-inflight удерживает receipt до любых GET; отказ сохранения не открывает каталог',async()=>{
 const native=await fixture();native.S.native=true;await native.api().nextFight(native.ctx);assert.equal(native.reads.length,0);assert.equal(native.location.pathname,'/battle.html');noClicks(native);
 const failed=await fixture();failed.S.saveOk=false;await failed.api().nextFight(failed.ctx);assert.equal(failed.reads.length,0);assert.equal(failed.location.pathname,'/battle.html');noClicks(failed);
});

test('ошибка чтения receipt остаётся удержанием, не снимает квитанцию и не делает GET',async()=>{
 const f=await fixture();f.storage.set(RECEIPT,'{broken');await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.reads.length,0);assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);
 assert.equal(f.storage.get(RECEIPT),'{broken');
});


for(const point of ['read','json'])test('receipt неизвестной фазы не обгоняет nativePending после '+point,async()=>{
 const f=await fixture();f.instance.activeRun.phase='unknown';let changed=false;
 f.S.hooks[point]=url=>{if(url==='/character'){changed=true;f.S.native=true;}};
 await f.api().nextFight(f.ctx);assert.equal(changed,true);assert.equal(f.location.pathname,'/battle.html');noClicks(f);
});
