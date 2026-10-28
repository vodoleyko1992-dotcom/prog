'use strict';
// 20.76+ (ревизия 28.10, группа rebirth): (1) sent-квитанция бесплатного Fight, который сервер не открыл, больше не держит поход вечно;
// (2) mobs 300/300 до серверного перехода в champion продолжается native next с победы и не считается «ручным выбором» в step.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2068-rebirth-runtime.test.cjs'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.fixture=fixture;',box);
const RUN='11111111-1111-4111-8111-111111111111';
const fights=f=>f.clicks.filter(x=>x==='fight').length;
const lost=f=>{f.S.hooks.fire=b=>{if(b.role==='fight'){f.ch.inBattle=false;delete f.ch.battleSpawnId;f.location.href='/rebirth-raid-dungeon.html';}};};
const noSpend=(f,m)=>{assert.equal(f.S.entries,0,m);assert.equal(f.S.keys,100,m);assert.equal(f.posts.length,0,m);};

test('Fight без открытого боя: сразу и до 30 с не повторяется, затем до двух бесплатных повторов и ожидание',async()=>{
 const f=box.fixture();f.instance.activeRun.mobKills=120;lost(f);
 await f.step();assert.equal(fights(f),1);assert.equal(f.env.rt.rebirth.fightPending.phase,'sent');
 f.reload();await f.step();assert.equal(fights(f),1,'сразу после reload — прежний запрет');assert.equal(f.env.rt.rebirth.phase,'unknown');
 f.tick(29000);await f.step();assert.equal(fights(f),1,'29 с — ещё рано');
 f.tick(3000);f.S.native=true;await f.step();assert.equal(fights(f),1,'запрос игры в полёте — не повторяем');
 f.tick(3000);f.S.native=false;await f.step();assert.equal(fights(f),2,'один бесплатный повтор');
 assert.equal(f.env.rt.rebirth.fightRetry.n,1);assert.ok(f.logs.some(x=>/бесплатный повтор «Бой» 1\/2/.test(x)));
 f.tick(3000);await f.step();assert.equal(fights(f),2,'свежая квитанция повтора снова ждёт 30 с');
 f.tick(30000);await f.step();assert.equal(fights(f),3,'второй повтор');
 for(let i=0;i<10;i++){f.tick(31000);await f.step();}
 assert.equal(fights(f),3,'после двух повторов — только ожидание');assert.equal(f.env.rt.rebirth.phase,'unknown');
 assert.match(f.env.rt.rebirth.reason,/дважды не открылся/);noSpend(f);
 // Новый Старт игрока даёт ещё два повтора того же бесплатного боя.
 f.env.rt.manualKickAt=999;f.S.generation=2;f.reload();f.tick(3000);await f.step();assert.equal(fights(f),4,'Start снимает лимит повторов');noSpend(f,'после Start');
});

test('повтор Fight требует того же героя/слота, run, этапа и счёта; открытый бой или рост счёта снимают квитанцию без повтора',async()=>{
 const slot=box.fixture();lost(slot);await slot.step();slot.env.rt.classCur.slot=1;slot.ch.classSlots.activeSlot=1;
 slot.tick(31000);await slot.step();assert.equal(fights(slot),1,'другой слот');assert.equal(slot.env.rt.rebirth.fightPending.phase,'sent');noSpend(slot);
 const count=box.fixture();lost(count);await count.step();count.tick(31000);
 const F=count.env.rt.rebirth.fightPending;count.env.rt.rebirth={...count.env.rt.rebirth,fightPending:{...F,mobKills:F.mobKills+1}};
 await count.step();assert.equal(fights(count),1,'счёт квитанции не совпал с run');noSpend(count);
 const opened=box.fixture({state:{nextFight:'2_1_25098_lv35_mob_149'}});await opened.step();assert.equal(fights(opened),1);opened.location.href='/rebirth-raid-dungeon.html';opened.tick(31000);
 await opened.step();assert.equal(opened.env.rt.rebirth.fightPending,null,'свежий собственный бой снимает квитанцию');assert.equal(fights(opened),1);
 assert.equal(opened.location.pathname,'/battle.html');noSpend(opened);
 const grown=box.fixture();lost(grown);await grown.step();grown.instance.activeRun.mobKills=5;grown.tick(3000);
 await grown.step();assert.equal(fights(grown),2,'рост счёта — обычный следующий Fight');assert.equal(grown.env.rt.rebirth.fightRetry,undefined);noSpend(grown);
});

// --- (2) mobs 300/300 ---
const sid=(role='mob',n=300)=>'rebirth_raid_'+RUN+'_2_1_25098_lv35_'+role+'_'+n;
function victoryFixture(){
 const f=box.fixture({page:'/battle.html?spawnId='+sid()}),name='Rebirth · Wyrm',title={textContent:name+' · ур.35'},win={},hunt={hidden:false,disabled:false},q=f.env.$q;
 Object.assign(f.instance.activeRun,{phase:'mobs',mobKills:300});f.env.autonomyMode=()=>'rebirth';
 f.env.gameGet=async url=>{f.reads.push(url);return{ok:true,status:200,json:async()=>structuredClone(url==='/character'?{character:f.ch}:f.instance)};};
 f.env.victory=()=>true;f.env.battleInfo=()=>({t:f.now(),spawn:sid(),name});
 f.env.$q=s=>s==='#battle-mob-title'?title:s==='#battle-victory-inline'?win:s==='#battle-victory-hunt'?hunt:q(s);
 f.env.evidenceOwner=()=>'owner';f.env.scanContext=()=>'scan';f.env.pvpPending=()=>false;f.env.antibotState=()=>false;
 f.env.tvtSoon=()=>false;f.env.tvtHoldWait=async()=>false;f.env.actionWait=async valid=>valid();f.env.waitFor=async valid=>valid();
 f.S.returns=0;f.env.fire=b=>{assert.equal(b,hunt);f.clicks.push('hunt');return true;};f.env.rebirthReturn=async valid=>{f.S.returns++;if(valid())f.location.href='/rebirth-raids.html';};
 return{...f,ctx:{name,spawnId:sid()}};
}

test('победа над mob_300 при mobs 300/300 и нужной подготовке жмёт native next, а не уводит в каталог',async()=>{
 const f=victoryFixture();f.env.needsPetPreparation=()=>true;await f.api().nextFight(f.ctx);
 assert.equal(f.clicks.filter(x=>x==='hunt').length,1);assert.equal(f.S.returns,0);assert.equal(f.location.pathname,'/battle.html');
 assert.ok(f.storage.get('l2bot.rebirth-next'),'квитанция next записана до клика');noSpend(f);
 // Контроль: до 300 подготовка по-прежнему возвращает в каталог.
 const early=victoryFixture();early.instance.activeRun.mobKills=299;early.env.needsPetPreparation=()=>true;await early.api().nextFight(early.ctx);
 assert.equal(early.clicks.length,0);assert.equal(early.S.returns,1);assert.equal(early.location.pathname,'/rebirth-raids.html');noSpend(early);
});

test('step: mobs 300/300 — подготовка и продолжение похода вместо «выберите цель вручную»',async()=>{
 const f=box.fixture({page:'/rebirth-raids.html'});Object.assign(f.instance.activeRun,{phase:'mobs',mobKills:300});let prepared=0;
 f.env.prepareRun=async()=>{prepared++;return false;};
 await f.step();assert.equal(prepared,1);assert.equal(JSON.stringify(f.clicks),'["continue"]');assert.notEqual(f.env.rt.rebirth.phase,'manual');
 f.tick(3000);await f.step();assert.equal(JSON.stringify(f.clicks),'["continue","fight"]','нативная кнопка боя на странице похода');noSpend(f);
 const none=box.fixture({page:'/rebirth-raid-dungeon.html?page=20',state:{fights:0}});Object.assign(none.instance.activeRun,{phase:'mobs',mobKills:300});
 await none.step();assert.equal(none.clicks.length,0,'страницы мобов не листаются');assert.equal(none.env.rt.rebirth.phase,'wait');
 assert.match(none.env.rt.rebirth.reason,/кнопку чемпиона/);noSpend(none);
});
