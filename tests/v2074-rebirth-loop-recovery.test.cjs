'use strict';
// Логи28.10 06:10/06:11: исчезнувший поход и старый экран победы не должны создавать вечное ожидание.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(name,cut,tail){const file=path.join(__dirname,name),src=fs.readFileSync(file,'utf8');
 const box={require:require('node:module').createRequire(file),__dirname,console,URL,URLSearchParams,Date,structuredClone,process};
 vm.runInNewContext(src.slice(0,src.indexOf(cut))+'\n'+tail,box);return box;}
const runtime=load('v2068-rebirth-runtime.test.cjs',"test('",'this.make=fixture;');
const victory=load('v2072-rebirth-victory-retry.test.cjs','const noActions=','this.own=own;');
const survival=load('v2073-rebirth-hero-survival.test.cjs',"\ntest('",'this.make=fixture;');
const buffs=load('v2073-rebirth-hero-buffs.test.cjs',"\ntest('",'this.make=fixture;');
const RUN='11111111-1111-4111-8111-111111111111',SPAWN='rebirth_raid_'+RUN+'_2_1_25098_lv35_mob_1';
function dead(){
 const f=runtime.make({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},rt:{manualKickAt:5}}),at=f.now()-10000;
 f.env.rt.rebirth={char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,runId:RUN,
  observedRun:{id:RUN,char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:5,at:at-1000},
  failedRun:{kind:'death',char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:5,runId:RUN,spawn:SPAWN,at,restoredAt:at+5000}};
 f.env.rt.deathLog=[at];return f;
}

test('собственная смерть сохраняется атомарно с deathLog, без выдуманной победы',async()=>{
 const f=survival.make();await f.S.onDeath();const failed=f.env.rt.rebirth.failedRun;
 assert.equal(failed.kind,'death');assert.equal(failed.runId,RUN);assert.ok(f.env.rt.deathLog.includes(failed.at));
 assert.equal(failed.restoredAt,undefined);assert.equal(f.env.rt.rebirth.completed,undefined);
});
test('только завершённое своё восстановление оставляет квитанцию готовности после смерти',async()=>{
 const f=buffs.make();Object.assign(f.marker,{runId:RUN,spawn:SPAWN});
 f.env.rt.rebirth={failedRun:{...f.marker,at:0}};f.env.rt.tbuff.buffDone=true;
 await f.B.townBuffStep();assert.equal(f.env.rt.restoreRes.ok,true);assert.ok(f.env.rt.rebirth.failedRun.restoredAt>0);
 assert.equal(f.env.rt.rebirth.completed,undefined);
});
for(const change of ['actor','run','spawn','kick','kind'])test('чужой restore не подтверждает собственный конец смерти: '+change,async()=>{
 const f=buffs.make();Object.assign(f.marker,{runId:RUN,spawn:SPAWN});f.env.rt.rebirth={failedRun:{...f.marker,at:0}};
 const failed=f.env.rt.rebirth.failedRun;failed[change==='run'?'runId':change]=change==='kick'?99:'other';f.env.rt.tbuff.buffDone=true;
 await f.B.townBuffStep();assert.equal(f.env.rt.rebirth.failedRun.restoredAt,undefined);
});
test('после подтверждённых смерти/восстановления AutoEnter продолжает без ручного Start и оплачивает ровно один вход',async()=>{
 const f=dead();await f.step();assert.equal(f.S.entries,1);assert.equal(f.S.keys,98);assert.equal(f.env.rt.rebirth.pending.phase,'sent');
 assert.equal(f.env.rt.rebirth.completed,undefined);f.tick(3000);await f.step();assert.equal(f.S.entries,1);
});
for(const change of ['noDeath','notRestored','foreignActor','foreignChar','foreignProf','foreignSlot','oldKick','foreignRun','foreignSpawn','futureDeath','futureRestore','badOrder','noDeathLog','stage','autoOff','quota','reserve','pending'])
 test('неполное подтверждение/запрет не разрешает новый вход: '+change,async()=>{
 const f=dead(),s=f.env.rt.rebirth,F=s.failedRun;
 if(change==='noDeath')delete s.failedRun;if(change==='notRestored')delete F.restoredAt;if(change==='foreignActor')F.actor='other';if(change==='foreignChar')F.char='Other';
 if(change==='foreignProf')F.prof='other';if(change==='foreignSlot')F.slot=1;if(change==='oldKick')F.kick=4;
 if(change==='foreignRun')F.runId='22222222-2222-4222-8222-222222222222';if(change==='foreignSpawn')F.spawn=SPAWN.replace(RUN,'22222222-2222-4222-8222-222222222222');
 if(change==='futureDeath')F.at=f.now()+1;if(change==='futureRestore')F.restoredAt=f.now()+1;if(change==='badOrder')F.restoredAt=F.at-1;
 if(change==='noDeathLog')f.env.rt.deathLog=[];if(change==='stage')f.instance.rebirthStage=2;if(change==='autoOff')f.env.cfg.rebirthAutoEnter=false;
 if(change==='quota')f.S.quota=false;if(change==='reserve')f.env.cfg.rebirthKeyReserve=100;
 if(change==='pending')s.pending={id:'unknown',kind:'entry',phase:'sent',actor:'own-actor',char:'Hero',prof:'human_wizard',slot:0,revision:99};
 await f.step();assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);assert.equal(s.completed,undefined);
 });
test('подготовка остаётся обязательной после смерти до нового платежа',async()=>{
 const f=dead();let calls=0;f.env.prepareEntry=async()=>{calls++;return true;};await f.step();assert.equal(calls,1);assert.equal(f.S.entries,0);
});
test('несделанный клик нового входа не возвращает восстановленного героя в missing-run',async()=>{
 const f=dead(),fire=f.env.fire;f.env.fire=()=>false;await f.step();assert.equal(f.S.entries,0);assert.equal(f.env.rt.rebirth.pending,null);
 f.env.fire=fire;f.tick(3000);await f.step();assert.equal(f.S.entries,1);assert.equal(f.S.keys,98);
});
test('явно отклонённый вход после смерти можно повторить после сверки без потери разрешения',async()=>{
 const f=dead();f.S.entryRun=false;await f.step();assert.equal(f.S.entries,1);
 f.env.rt.rebirth.pending.ack={ok:false};f.tick(3000);await f.step();assert.equal(f.env.rt.rebirth.pending,null);
 f.S.entryRun=true;f.tick(15000);await f.step();assert.equal(f.S.entries,2);
});
for(const point of ['read','json','quota','commit','save'])test('Stop после '+point+' отменяет платный повтор',async()=>{
 const f=dead();f.S.hooks[point]=()=>{f.env.on=false;};await f.step();assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
});
test('живой оплаченный поход после восстановления потребляет старую квитанцию смерти',async()=>{
 const f=dead();f.instance.activeRun=f.makeRun();await f.step();assert.equal(f.env.rt.rebirth.failedRun,null);assert.equal(f.S.entries,0);
});
for(const role of ['mob','champion','raid'])for(const receipt of [false,true])test('старый '+role+' при activeRun:null выходит только в бесплатный каталог; receipt='+receipt,async()=>{
 const f=await victory.own(role);f.instance.activeRun=null;
 const key='l2bot.rebirth-next',raw=JSON.stringify({key:JSON.stringify(['Hero','human_wizard',0,f.ctx.spawnId]),t:f.now()-9000});
 if(receipt)f.storage.set(key,raw);f.tick(61000);await f.api().nextFight();
 assert.equal(f.location.pathname,'/rebirth-raids.html');assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
 assert.equal(f.env.rt.rebirth.completed,undefined);if(receipt)assert.equal(f.storage.get(key),raw);
});
test('свежая подтверждённая победа РБ сохраняет штатный native next для квитанции завершения',async()=>{
 const f=await victory.own('raid');f.env.rt.rebirth.char='Hero';f.instance.activeRun=null;await f.api().nextFight(f.ctx);
 assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
});
for(const point of ['read','json','commit'])for(const change of ['stop','owner','class','mode','generation','lineage','native'])
 test('возврат из исчезнувшего похода отменяется после '+point+': '+change,async()=>{
 const f=await victory.own();f.instance.activeRun=null;f.tick(61000);
 f.S.hooks[point]=()=>{if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='class')f.env.rt.classCur.prof='other';
  if(change==='mode')f.S.mode='farm';if(change==='generation')f.S.generation=2;if(change==='lineage')f.env.rt.rebirth.battleSpawn+='1';if(change==='native')f.S.native=true;};
 await f.api().nextFight();assert.equal(f.location.pathname,'/battle.html');assert.equal(f.clicks.length,0);assert.equal(f.S.entries,0);
 });
