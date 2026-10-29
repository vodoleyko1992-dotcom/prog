'use strict';
// 20.81 (логи29.10 19:42–20:39): поздний итог, сменившийся список РБ и восстановление без повторного start старого spawn.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixtureFile(name,cut,tail){const file=path.join(__dirname,name),source=fs.readFileSync(file,'utf8'),box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone};vm.runInNewContext(source.slice(0,source.indexOf(cut))+'\n'+tail,box);return box;}
const runtime=fixtureFile('v2068-rebirth-runtime.test.cjs',"test('",'this.make=fixture;');
const victory=fixtureFile('v2072-rebirth-victory-retry.test.cjs','const noActions=','this.own=own;');
const RUN='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const quiet=f=>{assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);};

test('поздний конечный ответ во время успешного commit отменяет старый probe без ложной ошибки памяти и лишней секунды',async()=>{
 const f=await victory.own(),statuses=[],waits=[];f.env.setStatus=s=>statuses.push(s);f.env.sleep=async ms=>waits.push(ms);
 let changed=false;f.S.hooks.commit=()=>{if(!changed){changed=true;f.metadata.t++;f.metadata.max=null;f.metadata.kind='';}};
 await f.api().nextFight(f.ctx);assert.equal(changed,true);quiet(f);assert.deepEqual(statuses,[]);assert.deepEqual(waits,[]);
 f.S.hooks={};await f.api().nextFight(f.ctx);assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.posts.length,0);
});
test('настоящий отказ commit по-прежнему запрещает продолжение и сообщает причину',async()=>{
 const f=await victory.own(),statuses=[];f.env.setStatus=s=>statuses.push(s);f.S.saveOk=false;
 await f.api().nextFight(f.ctx);quiet(f);assert.ok(statuses.some(s=>/подтвердить память/.test(s)));
});

function boss(change){
 const f=runtime.make({cfg:{rebirthBossChoice:'staff1h'},state:{gates:16,gateText:'Чемпион побеждён',fights:0}});
 Object.assign(f.instance.activeRun,{phase:'boss_choice',mobKills:300});
 f.env.gamePost=async(url,req)=>{f.posts.push({url,body:req});Object.assign(f.instance.activeRun,{phase:'rb_active',selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25134'});f.ch.revision++;
  const run=structuredClone(f.instance.activeRun),body={run,nextSpawnId:'rebirth_raid_'+RUN+'_1_1_25134_lv35_raid_3'};change?.(body);return{ok:true,status:200,json:async()=>body};};
 return f;
}
test('encodedslot3 подтверждается актуальным своим РБ25134, без старого hardcode25098',async()=>{
 const f=boss();await f.step();assert.equal(f.env.rt.rebirth.bossPending.ack.ok,true);assert.equal(f.env.rt.rebirth.phase,'boss-selected');assert.equal(f.posts.length,1);
 f.tick(3000);await f.step();assert.equal(f.env.rt.rebirth.lastBossChoice.choice,'staff1h');assert.equal(f.env.rt.rebirth.lastBossChoice.spawnId,'l2dop_rb_25134');assert.equal(f.location.pathname,'/rebirth-raid-lair.html');
});
for(const kind of ['run','actor','party','slot','encoded','spawn','nextRun','nextBoss','nextSlot','nextStage','nextDifficulty','nextLevel','difficulty','progress'])test('чужой/несогласованный ответ выбора не подтверждает staff1h: '+kind,async()=>{
 const f=boss(b=>{if(kind==='run')b.run.id=OTHER;if(kind==='actor')b.run.participantCharacterIds=['other'];if(kind==='party')b.run.partyId='party';if(kind==='slot')b.run.selectedBossSlot=4;
  if(kind==='encoded')b.run.selectedBossSlotEncoded=false;if(kind==='spawn')b.run.selectedBossSpawnId='pvp_other';if(kind==='nextRun')b.nextSpawnId=b.nextSpawnId.replace(RUN,OTHER);
  if(kind==='nextBoss')b.nextSpawnId=b.nextSpawnId.replace('_25134_','_25098_');if(kind==='nextSlot')b.nextSpawnId=b.nextSpawnId.replace(/raid_3$/,'raid_4');
  if(kind==='nextStage')b.nextSpawnId=b.nextSpawnId.replace('_1_1_','_2_1_');if(kind==='nextDifficulty')b.nextSpawnId=b.nextSpawnId.replace('_1_1_','_1_3_');if(kind==='nextLevel')b.nextSpawnId=b.nextSpawnId.replace('_lv35_','_lv36_');
  if(kind==='difficulty')b.run.difficulty=3;if(kind==='progress')b.run.mobKills=299;});
 await f.step();assert.equal(f.env.rt.rebirth.bossPending.ack.ok,false);assert.equal(f.posts.length,1);assert.equal(f.S.entries,0);
});

async function recovery(role='mob'){
 const f=await victory.own(role);f.ch.rebirthStage=2;f.instance.rebirthStage=2;f.env.victory=()=>false;f.ch.inBattle=true;f.reads.length=0;
 f.env.nativePendingKey=()=>f.S.native?'request1':'';f.env.rt.rebirth.char='Hero';f.env.rt.rebirth.mobKills=role==='mob'?2:300;f.instance.activeRun.mobKills=role==='mob'?2:300;
 return f;
}
test('поздняя победа при ещё ожидающем action: свежий счёт похода разрешает только бесплатный каталог',async()=>{
 const f=await recovery();f.S.native=true;f.ch.inBattle=false;f.instance.activeRun.mobKills=3;
 assert.equal(await f.api().recoverBattle(()=>true),true);assert.equal(f.location.pathname,'/rebirth-raids.html');quiet(f);
 assert.equal(f.env.rt.rebirth.runId,RUN);assert.equal(f.env.rt.rebirth.completed,undefined);
});
test('живой зависший action не перезагружает старый URL; частые повторы не опрашивают сервер',async()=>{
 const f=await recovery();f.S.native=true;const page=f.location.href;
 assert.equal(await f.api().recoverBattle(()=>true),true);assert.equal(f.location.href,page);quiet(f);const reads=f.reads.length;
 await f.api().recoverBattle(()=>true);assert.equal(f.reads.length,reads);assert.equal(f.location.href,page);
 f.S.native=false;f.ch.inBattle=false;f.instance.activeRun.mobKills=3;f.tick(3000);await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/rebirth-raids.html');quiet(f);
});
test('без pending живой собственный бой сверяется и восстанавливается через каталог',async()=>{
 const f=await recovery();assert.equal(await f.api().recoverBattle(()=>true),true);assert.equal(f.location.pathname,'/rebirth-raids.html');quiet(f);
 assert.ok(f.reads.some(url=>url.startsWith('/game/battle?')));
});
for(const kind of ['actor','run','party','stage','class','slot','unknownRun','revision','battleSpawn','battleEnd'])test('неполный/чужой свежий контекст не восстанавливает бой: '+kind,async()=>{
 const f=await recovery();if(kind==='actor'){f.ch.id='other';f.instance.activeRun.participantCharacterIds=['other'];}if(kind==='run')f.instance.activeRun.id=OTHER;
 if(kind==='party')f.instance.activeRun.partyId='party';if(kind==='stage')f.instance.rebirthStage=1;if(kind==='class')f.ch.l2Profession='other';if(kind==='slot')f.ch.classSlots.activeSlot=1;
 if(kind==='dead')f.ch.hp=0;if(kind==='unknownRun')f.instance.activeRun=undefined;if(kind==='revision')f.ch.revision=-1;
 if(kind==='battleSpawn')f.battle.spawnId='dense_other';if(kind==='battleEnd')f.battle.ended=true;
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});
for(const point of ['read','json','commit'])for(const kind of ['stop','owner','lease','class','slot','generation','page','lineage','valid','captcha'])test('восстановление отменяется после '+point+': '+kind,async()=>{
 const f=await recovery();f.ch.inBattle=false;f.instance.activeRun.mobKills=3;let valid=true,captcha=false,changed=false;
 f.env.antibotState=()=>captcha;f.S.hooks[point]=()=>{if(changed)return;changed=true;if(kind==='stop')f.env.on=false;if(kind==='owner')f.env.tabOwner=false;if(kind==='lease')f.env.leaseEpoch='other';
  if(kind==='class')f.env.rt.classCur.prof='other';if(kind==='slot')f.env.rt.classCur.slot=1;if(kind==='generation')f.S.generation=2;if(kind==='page')f.location.href+='#manual';
  if(kind==='lineage')f.env.rt.rebirth.battleSpawn+='1';if(kind==='valid')valid=false;if(kind==='captcha')captcha=true;};
 await f.api().recoverBattle(()=>valid);assert.equal(changed,true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});

test('новый native-запрос после свежего прогресса не наследует разрешение старого action',async()=>{
 const f=await recovery();f.S.native=true;f.ch.inBattle=false;f.instance.activeRun.mobKills=3;let pending='old-action';f.env.nativePendingKey=()=>pending;
 f.S.hooks.commit=()=>{pending='new-manual-request';};await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});
test('pending без точной квитанции запроса не разрешает навигацию по одному прогрессу',async()=>{
 const f=await recovery();f.S.native=true;f.ch.inBattle=false;f.instance.activeRun.mobKills=3;delete f.env.nativePendingKey;
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});
test('неизвестное завершение run только открывает каталог, не создаёт победу и не оплачивает новый вход',async()=>{
 const f=await recovery();f.ch.inBattle=false;f.instance.activeRun=null;f.env.cfg.rebirthAutoEnter=true;
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.env.rt.rebirth.completed,undefined);quiet(f);
 await f.step();assert.equal(f.env.rt.rebirth.phase,'missing-run');quiet(f);
});

for(const role of ['champion','raid'])test('потерянный конечный ответ '+role+' не держит вечный pending после свежего продвижения сервера',async()=>{
 const f=await recovery(role);f.env.victory=()=>false;f.env.nativePendingKey=()=>f.S.native?'old-action':'';f.S.native=true;f.ch.inBattle=false;f.reads.length=0;f.env.rt.rebirth.char='Hero';
 if(role==='champion')f.instance.activeRun.phase='fixture_boss_choice';else f.instance.activeRun=null;
 const pending={id:'preserve-payment'};f.env.rt.petFull={pending};
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.env.rt.rebirth.completed,undefined);assert.equal(f.env.rt.petFull.pending,pending);quiet(f);
});
test('pending чемпиона с неизменным этапом не объявляется завершением по одному отсутствию боя',async()=>{
 const f=await recovery('champion');f.env.victory=()=>false;f.env.nativePendingKey=()=> 'old-action';f.S.native=true;f.ch.inBattle=false;f.reads.length=0;f.env.rt.rebirth.char='Hero';
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});

async function serverDeath(autoRevive=true){
 const f=await recovery();f.ch.hp=0;f.ch.inBattle=false;f.instance.activeRun=null;f.S.native=true;Object.assign(f.env.cfg,{autoRevive,tvtOn:false});
 const q=f.env.$q,returnTown={role:'native-return'},statue={role:'statue'};
 f.env.shown=b=>!!b&&!b.hidden;f.env.$q=s=>s==='#map-defeat-tocity'&&f.location.pathname==='/map.html'?returnTown:s==='a.l2-town-miru-item--buffer-statue'&&f.location.pathname==='/city.html'?statue:q(s);
 Object.assign(f.env,{epicOn:()=>false,epicById:()=>null,mobName:()=>f.ctx.name,byText:()=>null,rnd:x=>x,isBattle:()=>f.location.pathname==='/battle.html',isMap:()=>f.location.pathname==='/map.html',isCity:()=>f.location.pathname==='/city.html',
  rebirthDeathRecovery:()=>({kind:'death',char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:f.env.rt.manualKickAt||0,runId:RUN,spawn:f.ctx.spawnId}),rebirthRecoveryAllowed:()=>true,
  halt:async()=>{f.env.on=false;},fire:b=>{f.clicks.push(b.role);if(b===returnTown)f.location.href='/city.html';if(b===statue)f.location.href='/town-buffer.html';return true;},pause:async()=>{},waitFor:async fn=>fn()});
 const box={console,Math,JSON,URLSearchParams,Date:class extends Date{static now(){return f.now();}},sessionStorage:{getItem:k=>f.storage.get(k)||null},document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/survival.js'),'utf8'),box);f.survival=box.L2V7Factories.survival(f.env);f.env.onDeath=()=>f.survival.onDeath();return f;
}
test('свежая серверная смерть при застывшем живом DOM идёт через штатные counted→карта→город→статуя, без старого start',async()=>{
 const f=await serverDeath();await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/map.html');assert.equal(f.env.rt.revive.url,'/map.html');assert.equal(f.env.rt.revive.counted,true);
 assert.equal(f.env.rt.deathLog.length,1);assert.equal(f.env.rt.rebirth.failedRun.kind,'death');assert.equal(f.env.rt.rebirth.failedRun.spawn,f.ctx.spawnId);assert.equal(f.env.rt.rebirth.completed,undefined);
 await f.survival.reviveStep();assert.equal(f.location.pathname,'/city.html');await f.survival.reviveStep();assert.equal(f.location.pathname,'/town-buffer.html');assert.equal(f.env.rt.revive,null);
 assert.equal(f.env.rt.tbuff.back,'/rebirth-raids.html');assert.equal(f.env.rt.tbuff.rebirthRecovery.runId,RUN);assert.equal(f.env.rt.deathLog.length,1);assert.deepEqual(Array.from(f.clicks),['native-return','statue']);assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);
});
test('серверная смерть сохраняет запрет autoRevive=false и не начинает маршрут',async()=>{
 const f=await serverDeath(false);await f.api().recoverBattle(()=>true);assert.equal(f.env.on,false);assert.equal(f.location.pathname,'/battle.html');assert.equal(f.env.rt.revive.manual,true);assert.equal(f.env.rt.deathLog.length,1);quiet(f);
});

for(const kind of ['stage','difficulty','level'])test('URL зависшего боя должен согласоваться со свежими stage/difficulty/level: '+kind,async()=>{
 const f=await recovery();f.ch.inBattle=false;f.instance.activeRun.mobKills=3;
 const sid=f.ctx.spawnId.replace(kind==='stage'?'_2_1_':kind==='difficulty'?'_2_1_':'_lv35_',kind==='stage'?'_1_1_':kind==='difficulty'?'_2_3_':'_lv36_');
 f.location.href='/battle.html?spawnId='+sid;f.env.rt.rebirth.battleSpawn=sid;
 await f.api().recoverBattle(()=>true);assert.equal(f.location.pathname,'/battle.html');quiet(f);
});
