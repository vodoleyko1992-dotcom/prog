'use strict';
// 20.76+ (ревизия кода 28.10, группа core): Rebirth — возврат в незавершённый бой не перехватывается подготовкой героя,
// повтор/самовосстановление после смерти закрывает failedRun (restoredAt), чужая завершённая победа не ждёт ручного продолжения.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(name,cut,tail){const file=path.join(__dirname,name),src=fs.readFileSync(file,'utf8');
 const box={require:require('node:module').createRequire(file),__dirname,path,console,URL,URLSearchParams,Date,structuredClone,process};
 vm.runInNewContext(src.slice(0,src.indexOf(cut))+'\n'+tail,box);return box;}
const core=load('v2073-rebirth-hero-core.test.cjs',"\ntest('",'this.make=fixture;this.E=E;');
const buffs=load('v2073-rebirth-hero-buffs.test.cjs',"\ntest('",'this.make=fixture;');
const runtime=load('v2068-rebirth-runtime.test.cjs',"test('",'this.make=fixture;');
const routeFile=path.join(__dirname,'v2071-rebirth-route-isolation.test.cjs'),routeSrc=fs.readFileSync(routeFile,'utf8');
const route={require:require('node:module').createRequire(routeFile),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(routeSrc.slice(0,routeSrc.indexOf("\ntest('"))+routeSrc.slice(routeSrc.indexOf('function victoryFixture('),routeSrc.indexOf("test('отдельное продолжение"))+'\nthis.won=victoryFixture;',route);
const RUN='11111111-1111-4111-8111-111111111111',SPAWN='rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_9';
// Массивы из vm сравниваем через JSON (разные realm'ы).
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const steps=f=>f.events.filter(x=>x==='paid-run-step').length,refused=f=>f.events.filter(x=>/не подтверждены — бой не начинаю/.test(x)).length;

// ---------- находка: подготовка героя перехватывала возврат в незавершённый бой ----------
test('свой герой уже в бою (HP 70 %) вне страницы боя — круг отдаёт управление rebirth.step, а не «бой не начинаю»',async()=>{
 const f=core.make();Object.assign(f.ch,{inBattle:true,battleSpawnId:SPAWN,hp:1600});
 for(let i=0;i<3;i++)await f.c.loopRebirth();
 assert.equal(steps(f),3,'каждый круг доходит до возврата в бой');assert.equal(refused(f),0);
 assert.ok(!f.events.includes('buff'),'подготовка в бою не начинается');assert.equal(f.writes.length,0);
});
for(const change of ['otherHero','emptyId','class','slot','level','revision'])test('чужой/неполный снимок в бою по-прежнему держит круг: '+change,async()=>{
 const f=core.make();Object.assign(f.ch,{inBattle:true,battleSpawnId:SPAWN,hp:1600});
 if(change==='otherHero')f.ch.name='Other';if(change==='emptyId')f.ch.id='';if(change==='class')f.ch.l2Profession='human_warlord';if(change==='slot')f.ch.classSlots.activeSlot=1;
 if(change==='level')f.ch.level=39;if(change==='revision')f.ch.revision=-1;
 await f.c.loopRebirth();assert.equal(steps(f),0);assert.equal(refused(f),1);assert.ok(!f.events.includes('buff'));assert.equal(f.writes.length,0);
});
test('переданный snapshot в бою (допуск входа/кота) по-прежнему отказ, без нового пути',async()=>{
 const f=core.make();Object.assign(f.ch,{inBattle:true,battleSpawnId:SPAWN,hp:1600});assert.equal(await f.c.rebirthPrepareHero(f.ch),true);assert.equal(f.reads.length,0);
});
test('сам rebirth.step с каталога возвращает героя в его живой бой подземелья',async()=>{
 const f=runtime.make({page:'/rebirth-raids.html',char:{inBattle:true,battleSpawnId:'rebirth_raid_'+RUN+'_2_1_25098_lv35_mob_7',hp:700}});
 await f.step();assert.equal(f.location.pathname,'/battle.html');assert.equal(new URL(f.location.href).searchParams.get('spawnId'),'rebirth_raid_'+RUN+'_2_1_25098_lv35_mob_7');
 assert.equal(f.S.entries,0);same(f.clicks,[]);same(f.posts,[]);
});

// ---------- находка: повтор восстановления после смерти шёл с маркером 'prepare' ----------
function died(o={}){
 const f=core.make(o),at=f.now()-200000;
 f.c.rt.rebirth={failedRun:{kind:'death',char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:5,runId:RUN,spawn:SPAWN,at}};f.c.rt.deathLog=[at];
 if(o.failedRestore!==false)f.c.rt.restoreRes={t:at+1000,ok:false};
 return f;
}
test('повтор восстановления после неудачного первого несёт маркер смерти, и удачный restore ставит restoredAt',async()=>{
 const f=died();await f.c.loopRebirth();
 same(f.reads,['/character']);assert.ok(f.events.includes('buff'));assert.equal(steps(f),0);
 const R=f.writes[0].tbuff.rebirthRecovery;
 assert.deepEqual(JSON.parse(JSON.stringify(R)),{kind:'death',char:'Hero',prof:'human_wizard',slot:0,kick:5,actor:'own-actor',runId:RUN,spawn:SPAWN,revision:100});
 assert.equal(core.E.rebirthBuffJob(f.c.cfg,f.c.rt,f.writes[0].tbuff),true,'маршрут остаётся собственным заданием Rebirth');
 // Тот же маркер у баффера: успешное восстановление закрывает именно эту смерть.
 const b=buffs.make();b.env.rt.manualKickAt=5;b.env.rt.tbuff={...b.env.rt.tbuff,rebirthRecovery:structuredClone(R),buffDone:true};
 b.env.rt.rebirth={failedRun:structuredClone(f.c.rt.rebirth.failedRun)};
 await b.B.townBuffStep();assert.equal(b.env.rt.restoreRes.ok,true);assert.ok(b.env.rt.rebirth.failedRun.restoredAt>0,'restoredAt поставлен');
});
test('HP отросло за время ожидания: свежий /character закрывает смерть без похода в город, затем ход получает поход',async()=>{
 const f=died();f.ch.hp=f.ch.maxHp;
 await f.c.loopRebirth();
 same(f.reads,['/character']);assert.ok(!f.events.includes('buff'));assert.equal(steps(f),1);
 assert.equal(f.c.rt.rebirth.failedRun.restoredAt,f.now());assert.equal(f.c.rt.rebirth.failedRun.runId,RUN);
 await f.c.loopRebirth();assert.equal(f.reads.length,1,'после закрытия лишних GET нет');assert.equal(steps(f),2);
});
test('пока не прошли 3 мин после неудачного восстановления — ждём, затем одна свежая сверка закрывает смерть',async()=>{
 const f=died();f.ch.hp=f.ch.maxHp;f.c.rt.restoreRes={t:f.now(),ok:false};
 await f.c.loopRebirth();assert.equal(f.reads.length,0);assert.equal(steps(f),0);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,undefined);
 f.tick(180000);await f.c.loopRebirth();same(f.reads,['/character']);assert.equal(steps(f),1);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,f.now());
});
for(const change of ['actor','kick','char','slot','closed','kind'])test('чужая/закрытая смерть не закрывается и не крутит лишние GET: '+change,async()=>{
 const f=died({failedRestore:false}),F=f.c.rt.rebirth.failedRun;f.ch.hp=f.ch.maxHp;
 if(change==='actor')F.actor='other';if(change==='kick')F.kick=4;if(change==='char')F.char='Other';if(change==='slot')F.slot=1;if(change==='closed')F.restoredAt=F.at+1;if(change==='kind')F.kind='victory';
 const before=F.restoredAt;
 for(let i=0;i<3;i++)await f.c.loopRebirth();
 assert.ok(f.reads.length<=1,'не больше одной внеплановой сверки: '+f.reads.length);assert.equal(steps(f),3);
 assert.equal(f.c.rt.rebirth.failedRun.restoredAt,before);assert.ok(!f.writes.some(w=>w.rebirth),'чужая смерть не трогается');
});
test('чужой сохранённый маршрут при полной шапке не превращает открытую смерть в новое ожидание',async()=>{
 const f=died({failedRestore:false});f.ch.hp=f.ch.maxHp;f.c.rt.tbuff={set:'mage',step:'town',back:'/map.html'};
 await f.c.loopRebirth();assert.equal(f.reads.length,0);assert.equal(steps(f),1);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,undefined);
});
test('сбой записи restoredAt держит круг (без похода), повтор при следующем круге',async()=>{
 const f=died({saveOk:false});f.ch.hp=f.ch.maxHp;await f.c.loopRebirth();assert.equal(steps(f),0);assert.equal(f.writes.length,1);assert.ok(f.writes[0].rebirth.failedRun.restoredAt>0);
});
test('чужой герой при открытой смерти — повторный маркер обычной подготовки, смерть не закрывается',async()=>{
 const f=died(),F=f.c.rt.rebirth.failedRun;F.actor='old-actor';await f.c.loopRebirth();
 const R=f.writes[0].tbuff.rebirthRecovery;assert.equal(R.kind,'prepare');assert.equal(R.runId,undefined);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,undefined);
});

// ---------- находка: обычная победа при выбранном Rebirth ждала ручного продолжения ----------
function foreign(){
 const f=route.won(),name=f.ctx.name,spawn='dense_1';f.location.href='https://l2wap.com/battle.html?spawnId='+spawn;
 const statuses=[];f.env.setStatus=s=>statuses.push(s);f.env.battleInfo=()=>f.S.meta||{t:1,spawn,name};
 return{...f,statuses,ctx:{name,spawnId:spawn}};
}
const quiet=f=>{assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);assert.equal(f.reads.length,0);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);};
for(const withCtx of [true,false])test('завершённая обычная победа при выбранном Rebirth — бесплатный выход в каталог, ctx='+withCtx,async()=>{
 const f=foreign();await f.api().nextFight(withCtx?f.ctx:undefined);
 assert.equal(f.location.pathname,'/rebirth-raids.html');quiet(f);assert.equal(f.storage.has('l2bot.rebirth-next'),false,'квитанция next не создаётся');
 assert.ok(!f.statuses.some(s=>/жду вашего продолжения/.test(s)));
});
for(const change of ['stop','owner','antibot','pvp','tvt','native','commit','commitCancel','rebirthMeta','rebirthCtx','twoIds','boundSpawn','notVictory'])test('чужая победа остаётся на месте без действий: '+change,async()=>{
 const f=foreign();let ctx=f.ctx;
 if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='antibot')f.env.antibotState=()=> 'check';if(change==='pvp')f.env.pvpPending=()=>true;
 if(change==='tvt')f.env.tvtSoon=()=>true;if(change==='native')f.S.native=true;if(change==='commit')f.S.saveOk=false;if(change==='commitCancel')f.S.hooks.commit=()=>{f.S.generation=2;};
 if(change==='rebirthMeta')f.S.meta={t:1,spawn:'rebirth_raid_'+RUN+'_2_1_25098_lv35_mob_1',name:f.ctx.name};
 if(change==='rebirthCtx')ctx={name:f.ctx.name,spawnId:'rebirth_raid_'+RUN+'_2_1_25098_lv35_mob_1'};
 if(change==='twoIds')f.location.href+='&spawnId=dense_2';if(change==='boundSpawn')f.env.rt.rebirth={battleSpawn:'dense_1'};if(change==='notVictory')f.env.victory=()=>false;
 await f.api().nextFight(ctx);assert.equal(f.location.pathname,'/battle.html');assert.ok(!f.statuses.some(s=>/вне подземелий/.test(s)),'бесплатный выход не взят');
 // ctx своего Rebirth-боя при другом URL — прежний путь сверки run (не новый выход), его клики проверяет v2072.
 if(change!=='rebirthCtx')quiet(f);
});
