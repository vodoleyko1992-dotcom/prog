'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/rebirth.js'),'utf8');
const RUN='11111111-1111-4111-8111-111111111111',NEXT='22222222-2222-4222-8222-222222222222';
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(o={}){
 let now=1793060000000,api,href='https://l2wap.com'+(o.page||'/rebirth-raid-dungeon.html');const storage=new Map();
 const reads=[],clicks=[],writes=[],logs=[],posts=[],S={keys:100,entries:0,fights:1,page:1,quota:true,native:false,readFail:false,entryRun:true,saveOk:true,gates:0,bossEffect:true,bossLost:false,hooks:{},...o.state};
 const location={get href(){return href},set href(v){href=new URL(v,href).href},get pathname(){return new URL(href).pathname},get search(){return new URL(href).search}};
 const ch={id:'own-actor',name:'Hero',level:35,l2Profession:'human_wizard',classSlots:{activeSlot:0},revision:100,inBattle:false,hp:1000,rebirthStage:1,...copy(o.char||{})};
 const makeRun=(id=RUN)=>({id,difficulty:1,phase:'mobs',mobKills:0,mobKillTarget:300,participantCharacterIds:['own-actor'],partyId:null});
 const instance={enabled:true,rebirthStage:1,activeRun:o.noRun?null:makeRun(),...copy(o.instance||{})};
 const node=(role,text)=>({role,textContent:text,disabled:false,getAttribute:()=>null});
 const entry=node('entry','Войти в подземелье'),proceed=node('continue','Продолжить подземелье'),fight=node('fight','Бой');
 const card={get textContent(){return S.cardText||'1. Easy +1–20% Стоимость входа: 2 ключа';}};
 entry.closest=s=>s==='.l2-rraid-difficulty'?card:null;entry.parentElement=card;
 const pager=n=>node('page',String(n)),pagers=[pager(2),pager(9),pager(10)];
 const levels={get textContent(){return S.walletText||'Ключи подземелья: '+S.keys+' · вход оплачивает каждый участник';},querySelectorAll:()=>[entry]};
 const gates=Array.from({length:16},()=>node('gate','Войти'));
 const content={get textContent(){return S.gateText||'';},querySelectorAll:s=>s==='.l2-rraid-fight'?(S.fights?[fight]:[]):s==='.l2-rraid-pager-btn'?pagers:s==='.l2-rraid-gate__enter'?gates.slice(0,S.gates):[]};
 const env={on:true,tabOwner:true,leaseEpoch:'lease',browserTabKey:'tab1',cfg:{rebirthMode:true,rebirthDifficulty:1,rebirthAutoEnter:false,rebirthKeyReserve:0,...o.cfg},
  rt:{char:'Hero',lvl:35,classCur:{prof:'human_wizard',slot:0},...copy(o.rt||{})},routeLocation:location,
  actionGeneration:()=>S.generation||1,heroNick:()=>env.rt.char,heroLvl:()=>35,canAct:()=>true,canRun:()=>true,nativePending:()=>S.native,
  completedBoss:(after,c)=>c?.victory===true&&c.after===after&&after.startsWith('rebirth_raid_'+env.rt.rebirth?.runId+'_'+String(env.rt.rebirth?.selectedBossSpawnId||'').replace(/^l2dop_rb_/,'' )+'_'),
  dailyWorkReady:async()=>{await S.hooks.quota?.();return S.quota;},shown:b=>b.hidden!==true,
  $q:s=>s==='#rebirth-instance-content'&&location.pathname==='/rebirth-raid-dungeon.html'?content:s==='#rebirth-raid-levels'&&location.pathname==='/rebirth-raids.html'?levels:s==='.l2-rraid-main-button'&&location.pathname==='/rebirth-raids.html'?proceed:s==='.l2-rraid-fight'&&location.pathname==='/rebirth-raid-lair.html'&&S.fights?fight:null,
  setRt:async p=>{writes.push(copy(p));if(!S.saveOk)return{ok:false};Object.assign(env.rt,p);await S.hooks.save?.(p);return{ok:true};},
  rtCommit:async()=>{await S.hooks.commit?.();return S.saveOk;},sleep:async()=>{},pause:async()=>{},setStatus:()=>{},rec:(...x)=>logs.push(x.join(' ')),
  gamePost:async(url,body)=>{posts.push({url,body:copy(body)});assert.equal(url,'/game/rebirth-raids/enter-boss');assert.deepEqual(copy(body),{bossSlot:3});await S.hooks.post?.();
   if(S.bossEffect){Object.assign(instance.activeRun,{phase:'rb_active',selectedBossSlot:3,selectedBossSlotEncoded:true,selectedBossSpawnId:'l2dop_rb_25098'});ch.revision++;}
   if(S.bossLost)throw Error('private-boss-ack-token');return{ok:true,status:200,json:async()=>({run:copy(instance.activeRun)})};},
  gameGet:async url=>{reads.push(url);await S.hooks.read?.(url);if(S.readFail)throw Error('private-token-do-not-log');
   return{ok:true,json:async()=>{await S.hooks.json?.(url);if(url==='/character')return{character:copy(ch)};
    if(url==='/game/rebirth-raids?view=instance')return copy(instance);
    if(url.startsWith('/game/battle?'))return{character:copy(ch),battle:{spawnId:ch.battleSpawnId,mobHp:100,mobMaxHp:1000,kind:'passive'}};
    throw Error('неожиданный GET '+url);}};},
  fire:b=>{clicks.push(b.role);if(b.disabled)return false;
   if(b.role==='entry'){S.entries++;S.keys-=2;ch.revision++;if(S.entryRun)instance.activeRun=makeRun(S.entries===1?RUN:NEXT);}
   if(b.role==='continue')location.href='/rebirth-raid-dungeon.html';
   if(b.role==='fight'){ch.inBattle=true;ch.battleSpawnId='rebirth_raid_'+instance.activeRun.id+'_'+(instance.activeRun.phase==='champion'?'champion_1':instance.activeRun.phase==='rb_active'?'25098_lv35_raid_3':S.nextFight||'mob_149');location.href='/battle.html?spawnId='+ch.battleSpawnId;}
   if(b.role==='page'){S.page=+b.textContent;location.href='/rebirth-raid-dungeon.html?page='+S.page;S.fights=1;}
   S.hooks.fire?.(b);return true;
  }};
 function load(){const box={Date:class extends Date{static now(){return now}},URL,URLSearchParams,console,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(S.storageWriteFail)throw Error('storage');storage.set(k,v);},removeItem:k=>{if(S.storageRemoveFail)throw Error('storage');storage.delete(k);}}};vm.runInNewContext(source,box);api=box.L2V7Factories.rebirth(env);}load();
 return{S,ch,instance,env,location,reads,clicks,writes,logs,posts,storage,entry,proceed,fight,pagers,gates,makeRun,api:()=>api,step:()=>api.step(),tick:ms=>now+=ms,now:()=>now,reload:load};
}
const complete=f=>{const after='rebirth_raid_'+f.env.rt.rebirth.runId+'_25098_lv35_raid_3';return f.api().note('/game/rebirth-raids/next',{method:'GET',status:200,url:'/game/rebirth-raids/next?after='+after,res:{phase:'none',spawnId:null}},{victory:true,after});};

test('уже оплаченный одиночный run продолжается с выключенными автоматическими входами и иной выбранной сложностью',async()=>{
 const f=fixture({cfg:{rebirthDifficulty:3}});await f.step();assert.deepEqual(f.clicks,['fight']);assert.equal(f.S.entries,0);
 assert.equal(f.env.rt.rebirth.runId,RUN);assert.equal(f.env.rt.rebirth.difficulty,1);assert.equal(f.env.rt.rebirth.fightPending.runId,RUN);
 assert.equal(await f.step(),false,'открытый бой передан общему ядру');
});
test('каталог существующего run нажимает нативное продолжение, затем первый доступный бой',async()=>{
 const f=fixture({page:'/rebirth-raids.html'});await f.step();assert.deepEqual(f.clicks,['continue']);await f.step();assert.deepEqual(f.clicks,['continue','fight']);assert.equal(f.S.keys,100);
});
test('с другой страницы режим сначала открывает каталог без нового входа',async()=>{
 const f=fixture({page:'/map.html'});await f.step();assert.equal(f.location.pathname,'/rebirth-raids.html');assert.deepEqual(f.clicks,[]);assert.equal(f.S.entries,0);
});
test('нетронутый ordinary бой завершается до какого-либо платного входа',async()=>{
 const f=fixture({page:'/map.html',noRun:true,cfg:{rebirthAutoEnter:true},char:{inBattle:true,battleSpawnId:'dense_21883'}});
 await f.step();assert.equal(f.location.pathname,'/battle.html');assert.equal(new URL(f.location.href).searchParams.get('spawnId'),'dense_21883');assert.equal(f.S.entries,0);
 assert.ok(!f.reads.includes('/game/rebirth-raids?view=instance'));
});
test('неподтверждённый или PvP-бой не разрешает новый вход и не открывает чужую цель',async()=>{
 for(const char of [{inBattle:true,battleSpawnId:'pvp_other'},{inBattle:true,battleSpawnId:null},{inBattle:true,battleSpawnId:'dense_1',isPvp:true}]){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},char});await f.step();assert.equal(f.S.entries,0);assert.equal(f.location.pathname,'/rebirth-raids.html');
 }
});
test('автовход выключен: отсутствие run ждёт ручного входа, ключи не расходуются',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true});await f.step();assert.equal(f.env.rt.rebirth.phase,'manual-entry');assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
});
test('явно включённый Easy: нативный вход за 2 ключа, durable sent до клика и подтверждение своим run',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});let observed;
 f.S.hooks.fire=b=>{if(b.role==='entry')observed=copy(f.env.rt.rebirth.pending);};
 await f.step();assert.equal(f.S.entries,1);assert.equal(f.S.keys,98);assert.equal(observed.phase,'sent');assert.equal(observed.noActiveRun,true);assert.equal(observed.difficulty,1);
 f.tick(3000);await f.step();assert.equal(f.env.rt.rebirth.pending,null);assert.equal(f.env.rt.rebirth.lastEntry.confirmation,'fresh-own-run');assert.equal(f.S.entries,1);assert.deepEqual(f.clicks,['entry','continue']);
});
test('потерянный ACK после Stop/reload сверяется по свежему своему run, без повторной оплаты',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});await f.step();f.env.on=false;f.reload();assert.equal(await f.step(),false);
 f.env.on=true;f.S.generation=2;f.env.cfg.rebirthDifficulty=3;await f.step();assert.equal(f.S.entries,1);assert.equal(f.env.rt.rebirth.pending,null);assert.equal(f.env.rt.rebirth.lastEntry.difficulty,1);
});
test('потерянный ACK без activeRun не повторяет вход ни после ожидания, ни после reload/Stop/Start',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});await f.step();assert.equal(f.S.entries,1);
 for(let i=0;i<10;i++){f.tick(12000);await f.step();}f.env.on=false;f.reload();f.env.on=true;f.S.generation=2;await f.step();
 assert.equal(f.S.entries,1);assert.equal(f.env.rt.rebirth.pending.phase,'sent');assert.equal(f.env.rt.rebirth.phase,'unknown');
});
test('завершение подтверждённого run позволяет следующий Easy при включённом автовходе',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});await f.step();f.tick(3000);await f.step();
 selected(f);f.tick(3000);await f.step();assert.equal(await complete(f),true);
 f.location.href='/rebirth-raids.html';f.instance.activeRun=null;f.ch.inBattle=false;f.tick(3000);await f.step();
 assert.equal(f.S.entries,2);assert.equal(f.S.keys,96);assert.equal(f.instance.activeRun.id,NEXT);
});
test('неизвестный старый, чужой или иной сложности run не снимает сохранённый запрет нового входа',async()=>{
 for(const kind of ['old','foreign','difficulty']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});await f.step();const p=f.env.rt.rebirth.pending;
  f.instance.activeRun=f.makeRun(kind==='old'?'33333333-3333-4333-8333-333333333333':RUN);
  if(kind==='old')p.previousRunId=f.instance.activeRun.id;if(kind==='foreign')f.instance.activeRun.participantCharacterIds=['other'];if(kind==='difficulty')f.instance.activeRun.difficulty=2;
  f.tick(3000);await f.step();assert.ok(f.env.rt.rebirth.pending,kind);assert.equal(f.S.entries,1,kind);
  f.location.href='/rebirth-raids.html';f.instance.activeRun=null;f.tick(3000);await f.step();assert.equal(f.S.entries,1,kind);
 }
});
test('native ACK связывается с difficulty/rid/временем/run; чужие и старые ответы отвергаются',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});await f.step();
 const d={method:'POST',status:200,ms:0,rid:1,req:{difficulty:1},res:{run:f.makeRun()}};
 assert.equal(await f.api().note('/game/rebirth-raids/start',{...d,req:{difficulty:2}}),false);
 assert.equal(await f.api().note('/game/rebirth-raids/start',{...d,ms:10000}),false);
 assert.equal(await f.api().note('/game/rebirth-raids/start',{...d,res:{run:{...f.makeRun(),participantCharacterIds:['other']}}}),false);
 assert.equal(await f.api().note('/game/rebirth-raids/start',d),true);assert.equal(f.env.rt.rebirth.pending.ack.runId,RUN);
});
test('bound4xx и свежий noRun заканчивают попытку отказом, не повторяя вход немедленно',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});await f.step();
 assert.equal(await f.api().note('/game/rebirth-raids/start',{method:'POST',status:409,ms:0,rid:1,req:{difficulty:1},res:{error:'in_battle'}}),true);
 f.tick(3000);await f.step();assert.equal(f.S.entries,1);assert.equal(f.env.rt.rebirth.pending,null);assert.equal(f.env.rt.rebirth.phase,'rejected');
});
test('моб148: нет живых строк на старой странице — нативный pager10, затем первый Fight149',async()=>{
 const f=fixture({page:'/rebirth-raid-dungeon.html?page=1',state:{fights:0}});f.instance.activeRun.mobKills=148;
 await f.step();assert.deepEqual(f.clicks,['page']);assert.equal(f.S.page,10);await f.step();assert.deepEqual(f.clicks,['page','fight']);
 assert.match(f.ch.battleSpawnId,/_mob_149$/);assert.ok(f.reads.every(p=>p==='/character'||p==='/game/rebirth-raids?view=instance'));
});
test('текущая страница10 с живым Fight не меняется на страницу1',async()=>{
 const f=fixture({page:'/rebirth-raid-dungeon.html?page=10'});f.instance.activeRun.mobKills=148;await f.step();assert.deepEqual(f.clicks,['fight']);
});
test('неизвестная фаза или выбор16РБ ждёт ручного выбора, новые кнопки и входы не нажимаются',async()=>{
 for(const phase of ['champion','boss-select','completed','unknown']){
  const f=fixture({cfg:{rebirthAutoEnter:true}});f.instance.activeRun.phase=phase;f.instance.bossChoices=Array.from({length:16},()=>({}));await f.step();
  assert.equal(f.env.rt.rebirth.phase,'manual');assert.deepEqual(f.clicks,[]);
 }
});
test('чужой герой, слот, неполный снимок, party и повреждённый UUID не разрешают действие',async()=>{
 for(const kind of ['hero','slot','revision','party','participants','uuid']){
  const f=fixture();if(kind==='hero')f.ch.name='Other';if(kind==='slot')f.ch.classSlots.activeSlot=1;if(kind==='revision')delete f.ch.revision;
  if(kind==='party')f.instance.activeRun.partyId='party';if(kind==='participants')f.instance.activeRun.participantCharacterIds.push('other');if(kind==='uuid')f.instance.activeRun.id='unsafe';
  await f.step();assert.deepEqual(f.clicks,[],kind);
 }
});
test('неизвестная цена/валюта/кошелёк/кнопка и недостаточный резерв никогда не оплачиваются',async()=>{
 for(const kind of ['price','col','wallet','disabled','reserve','malformed']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});
  if(kind==='price')f.S.cardText='1. Easy Стоимость входа: 3 ключа';if(kind==='col')f.S.cardText='1. Easy Стоимость входа: 2 ключа + 1 Coin of Luck';
  if(kind==='wallet')f.S.walletText='Ключи: неизвестно';if(kind==='disabled')f.entry.disabled=true;if(kind==='reserve')f.env.cfg.rebirthKeyReserve=99;if(kind==='malformed')delete f.instance.activeRun;
  await f.step();assert.equal(f.S.entries,0,kind);assert.deepEqual(f.clicks,[],kind);
 }
});
test('дневная квота запрещает новый вход, первое открытие боя и продолжение из каталога',async()=>{
 for(const opt of [{page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}},{},{page:'/rebirth-raids.html'}]){
  const f=fixture({...opt,state:{quota:false}});await f.step();assert.deepEqual(f.clicks,[]);assert.equal(f.env.rt.rebirth.phase,'quota');
 }
});
test('подготовка героя и кота вызывается лишь перед новым разрешённым входом; после подготовки данные читаются заново',async()=>{
 for(const opt of [{},{page:'/rebirth-raids.html',noRun:true}]){
  const f=fixture(opt);let calls=0;f.env.prepareEntry=async()=>{calls++;return true;};await f.step();assert.equal(calls,0);
 }
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});let preparing=true,calls=0;
 f.env.prepareEntry=async()=>{calls++;return preparing;};await f.step();assert.equal(calls,1);assert.equal(f.S.entries,0);
 const before=f.reads.length;preparing=false;f.tick(3000);await f.step();assert.ok(f.reads.length>=before+2);assert.equal(calls,2);assert.equal(f.S.entries,1);
});
test('Stop или смена класса во время подготовки не допускают новый платный вход',async()=>{
 for(const kind of ['Stop','class']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});
  f.env.prepareEntry=async()=>{if(kind==='Stop')f.env.on=false;else f.env.rt.classCur.prof='human_sorcerer';return false;};
  await f.step();assert.equal(f.S.entries,0,kind);assert.deepEqual(f.clicks,[],kind);
 }
});
test('после каждого await Stop/lease/class/slot/generation/page/taskcfg отменяют новый клик',async()=>{
 const changes={stop:f=>f.env.on=false,lease:f=>f.env.leaseEpoch='other',class:f=>f.env.rt.classCur.prof='human_sorcerer',slot:f=>f.env.rt.classCur.slot=1,
  generation:f=>f.S.generation=2,page:f=>f.location.href='/map.html',task:f=>f.env.cfg.rebirthMode=false,config:f=>f.env.cfg.rebirthAutoEnter=false};
 for(const stage of ['character','instance','prepared','sent','commit','quota'])for(const [name,change]of Object.entries(changes)){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});let done=false;
  const mutate=()=>{if(!done){done=true;change(f);}};
  if(stage==='character'||stage==='instance')f.S.hooks.json=url=>{if(stage==='character'?url==='/character':url.includes('rebirth-raids'))mutate();};
  if(stage==='prepared'||stage==='sent')f.S.hooks.save=p=>{if(p.rebirth?.pending?.phase===stage)mutate();};
  if(stage==='commit')f.S.hooks.commit=mutate;if(stage==='quota')f.S.hooks.quota=mutate;
  await f.step();assert.ok(done,stage+'/'+name);assert.equal(f.S.entries,0,stage+'/'+name);
 }
});
test('режим выключен/Stop/чужая вкладка и native-inflight не начинают действия',async()=>{
 for(const kind of ['mode','stop','owner','native']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});
  if(kind==='mode')f.env.cfg.rebirthMode=false;if(kind==='stop')f.env.on=false;if(kind==='owner')f.env.tabOwner=false;if(kind==='native')f.S.native=true;
  await f.step();assert.deepEqual(f.clicks,[],kind);if(kind!=='native')assert.equal(f.reads.length,0);
 }
});
test('неизвестное первое открытие боя не повторяет Fight после reload',async()=>{
 const f=fixture();f.S.hooks.fire=b=>{if(b.role==='fight'){f.ch.inBattle=false;f.location.href='/rebirth-raid-dungeon.html';}};
 await f.step();assert.deepEqual(f.clicks,['fight']);f.reload();await f.step();assert.deepEqual(f.clicks,['fight']);assert.equal(f.env.rt.rebirth.phase,'unknown');
});
test('сбой сохранения запрещает нативный платный вход',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{saveOk:false}});await f.step();assert.equal(f.S.entries,0);
});
test('ошибки чтения повторяются через3/6/12с без GET-спина и без секретов в журнале',async()=>{
 const f=fixture({state:{readFail:true}}),start=f.now(),counts=[];
 for(let t=0;t<=22;t++){f.tick(t?1000:0);const before=f.reads.length;await f.step();if(f.reads.length>before)counts.push((f.now()-start)/1000);}
 assert.deepEqual(counts,[0,3,9,21]);assert.deepEqual(f.clicks,[]);assert.ok(!f.logs.join('').includes('private-token'));
});

function gateFixture(o={}){
 const f=fixture({page:'/rebirth-raid-dungeon.html',...o,cfg:{rebirthBossChoice:'staff1h',...o.cfg},state:{fights:0,gates:16,gateText:'Чемпион побеждён. Выберите одного из 16 РБ.',...o.state}});
 Object.assign(f.instance.activeRun,{phase:'opaque-choice-stage',mobKills:300});return f;
}
function selected(f,slot=3,id='l2dop_rb_25098'){
 Object.assign(f.instance.activeRun,{phase:'rb_active',mobKills:300,selectedBossSlot:slot,selectedBossSlotEncoded:true,selectedBossSpawnId:id});
}
test('подтверждённый champion после300 открывается нативным Fight без нового входа',async()=>{
 const f=fixture();Object.assign(f.instance.activeRun,{phase:'champion',mobKills:300});await f.step();
 assert.deepEqual(f.clicks,['fight']);assert.match(f.ch.battleSpawnId,/_champion_1$/);assert.equal(f.S.entries,0);assert.equal(f.posts.length,0);
});
test('rb_active продолжает выбранное своё логово и его нативный бой',async()=>{
 const f=fixture();selected(f);await f.step();assert.equal(f.location.pathname,'/rebirth-raid-lair.html');assert.deepEqual(f.clicks,[]);
 await f.step();assert.deepEqual(f.clicks,['fight']);assert.match(f.ch.battleSpawnId,/_raid_3$/);assert.equal(f.posts.length,0);assert.equal(f.S.keys,100);
});
test('неизвестный этап из карты открывает текущий instance для ручного выбора, не новый run',async()=>{
 const f=gateFixture({page:'/map.html',cfg:{rebirthBossChoice:'manual',rebirthAutoEnter:true}});await f.step();assert.equal(f.location.pathname,'/rebirth-raid-dungeon.html');
 await f.step();assert.equal(f.env.rt.rebirth.phase,'manual');assert.deepEqual(f.clicks,[]);assert.equal(f.posts.length,0);assert.equal(f.S.entries,0);
});
test('ручной выбор по умолчанию оставляет все16вариантов игроку',async()=>{
 const f=gateFixture({cfg:{rebirthBossChoice:'manual'}});await f.step();assert.equal(f.env.rt.rebirth.phase,'manual');assert.equal(f.posts.length,0);assert.deepEqual(f.clicks,[]);
});
test('staff1h: только наблюдённый encodedbody3, durable sent до POST и freshownrun подтверждает выбор',async()=>{
 const f=gateFixture();let sent;
 f.S.hooks.post=()=>{sent=copy(f.env.rt.rebirth.bossPending);};await f.step();assert.equal(f.posts.length,1);assert.equal(sent.phase,'sent');assert.equal(sent.bossSlot,3);
 assert.equal(f.env.rt.rebirth.bossPending.ack.ok,true);f.tick(3000);await f.step();assert.equal(f.env.rt.rebirth.bossPending,null);
 assert.equal(f.env.rt.rebirth.lastBossChoice.choice,'staff1h');assert.equal(f.location.pathname,'/rebirth-raid-lair.html');assert.equal(f.posts.length,1);assert.equal(f.S.entries,0);
});
test('потерянный ACK выбора с rb_active восстанавливается после reload, без второго выбора',async()=>{
 const f=gateFixture({state:{bossLost:true}});await f.step();assert.equal(f.posts.length,1);assert.equal(f.env.rt.rebirth.bossPending.phase,'sent');
 f.reload();await f.step();assert.equal(f.posts.length,1);assert.equal(f.env.rt.rebirth.bossPending,null);assert.equal(f.location.pathname,'/rebirth-raid-lair.html');
});
test('неизвестный исход выбора без rb_active не повторяется после ожидания/Stop/Start/reload',async()=>{
 const f=gateFixture({state:{bossLost:true,bossEffect:false}});await f.step();assert.equal(f.posts.length,1);
 for(let i=0;i<5;i++){f.tick(12000);await f.step();}f.env.on=false;f.reload();f.env.on=true;f.S.generation=2;await f.step();
 assert.equal(f.posts.length,1);assert.equal(f.env.rt.rebirth.phase,'unknown');assert.equal(f.env.rt.rebirth.bossPending.phase,'sent');
});
test('после неизвестного выбора ручной иной РБ продолжается фактически выбранным, без принужденияк3',async()=>{
 const f=gateFixture({state:{bossLost:true,bossEffect:false}});await f.step();selected(f,7,'l2dop_rb_25099');f.tick(3000);await f.step();
 assert.equal(f.posts.length,1);assert.equal(f.env.rt.rebirth.bossPending,null);assert.equal(f.env.rt.rebirth.lastBossChoice.choice,'manual-other');
 assert.equal(f.location.pathname,'/rebirth-raid-lair.html');f.S.fights=1;await f.step();assert.deepEqual(f.clicks,['fight']);assert.equal(f.posts.length,1);
});
test('частичный rb_active не считается выбранным и не разрешает повторный enter-boss по старым gates',async()=>{
 for(const kind of ['encoded','spawn','slot']){
  const f=gateFixture();selected(f);if(kind==='encoded')f.instance.activeRun.selectedBossSlotEncoded=false;if(kind==='spawn')delete f.instance.activeRun.selectedBossSpawnId;if(kind==='slot')delete f.instance.activeRun.selectedBossSlot;
  await f.step();assert.equal(f.posts.length,0,kind);assert.deepEqual(f.clicks,[],kind);
 }
});
test('выбор3 требует одновременно300побед,16доступныхgates,побеждённогочемпиона и квоты',async()=>{
 for(const kind of ['kills','count','text','disabled','quota','terminal']){
  const f=gateFixture();if(kind==='kills')f.instance.activeRun.mobKills=299;if(kind==='count')f.S.gates=15;if(kind==='text')f.S.gateText='Чемпион ещё жив';
  if(kind==='disabled')f.gates[5].disabled=true;if(kind==='quota')f.S.quota=false;if(kind==='terminal')f.instance.activeRun.phase='completed';
  await f.step();assert.equal(f.posts.length,0,kind);assert.deepEqual(f.clicks,[],kind);
 }
});
test('Stop/смена класса/слота/режима/выбора/lease на сохранении и flush запрещают enter-boss',async()=>{
 const changes={Stop:f=>f.env.on=false,class:f=>f.env.rt.classCur.prof='human_sorcerer',slot:f=>f.env.rt.classCur.slot=1,mode:f=>f.env.cfg.rebirthMode=false,
  choice:f=>f.env.cfg.rebirthBossChoice='manual',lease:f=>f.env.leaseEpoch='other',generation:f=>f.S.generation=2};
 for(const stage of ['prepared','sent','commit'])for(const[k,change]of Object.entries(changes)){
  const f=gateFixture();let done=false;const mutate=()=>{if(!done){done=true;change(f);}};
  if(stage==='commit')f.S.hooks.commit=mutate;else f.S.hooks.save=p=>{if(p.rebirth?.bossPending?.phase===stage)mutate();};
  await f.step();assert.ok(done,stage+'/'+k);assert.equal(f.posts.length,0,stage+'/'+k);
 }
});
test('prepared Fight после несохранённого flush можно подготовить заново; sent Fight не повторяется',async()=>{
 const f=fixture();f.S.hooks.save=p=>{if(p.rebirth?.fightPending?.phase==='prepared')f.S.saveOk=false;};await f.step();assert.deepEqual(f.clicks,[]);assert.equal(f.env.rt.rebirth.fightPending.phase,'prepared');
 f.S.saveOk=true;f.S.hooks.save=null;f.reload();await f.step();assert.deepEqual(f.clicks,['fight']);
});
test('prepared выборРБ после несохранённого flush не превращается в вечное ожидание',async()=>{
 const f=gateFixture();f.S.hooks.save=p=>{if(p.rebirth?.bossPending?.phase==='prepared')f.S.saveOk=false;};await f.step();assert.equal(f.posts.length,0);
 f.S.saveOk=true;f.S.hooks.save=null;f.reload();await f.step();assert.equal(f.posts.length,1);
});
test('полный этап300→champion→ручныегейты→staff1h→lair→none→разрешённыйследующийEasy',async()=>{
 const f=fixture({page:'/rebirth-raid-dungeon.html?page=20',cfg:{rebirthAutoEnter:true,rebirthBossChoice:'manual'},state:{nextFight:'mob_300'}});f.instance.activeRun.mobKills=299;
 await f.step();assert.match(f.ch.battleSpawnId,/_mob_300$/);
 f.ch.inBattle=false;f.location.href='/rebirth-raid-dungeon.html';Object.assign(f.instance.activeRun,{phase:'champion',mobKills:300});f.tick(3000);await f.step();assert.match(f.ch.battleSpawnId,/_champion_1$/);
 f.ch.inBattle=false;f.location.href='/rebirth-raid-dungeon.html';f.instance.activeRun.phase='opaque-choice-stage';f.S.gates=16;f.S.gateText='Чемпион побеждён';f.S.fights=0;f.tick(3000);await f.step();assert.equal(f.posts.length,0);assert.equal(f.env.rt.rebirth.phase,'manual');
 f.env.cfg.rebirthBossChoice='staff1h';await f.step();assert.equal(f.posts.length,1);f.tick(3000);await f.step();assert.equal(f.location.pathname,'/rebirth-raid-lair.html');
 f.S.fights=1;await f.step();assert.match(f.ch.battleSpawnId,/_raid_3$/);assert.equal(f.S.entries,0);
 f.ch.inBattle=false;assert.equal(await complete(f),true);f.instance.activeRun=null;f.location.href='/rebirth-raids.html';f.tick(3000);await f.step();assert.equal(f.S.entries,1);assert.equal(f.S.keys,98);assert.equal(f.posts.length,1);
});
test('исчезновение известного run без финального next-none не расходует новые ключи',async()=>{
 const f=fixture({cfg:{rebirthAutoEnter:true}});await f.step();f.ch.inBattle=false;f.instance.activeRun=null;f.location.href='/rebirth-raids.html';f.tick(3000);await f.step();
 assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);assert.equal(f.env.rt.rebirth.phase,'missing-run');f.reload();f.S.generation=2;await f.step();assert.equal(f.S.entries,0,'одно возобновление документа не разрешает новый вход');
});
test('новый явный Start разрешает новый заход после исчезновения известного run',async()=>{
 const f=fixture({cfg:{rebirthAutoEnter:true}});await f.step();f.ch.inBattle=false;f.instance.activeRun=null;f.location.href='/rebirth-raids.html';f.tick(3000);await f.step();assert.equal(f.S.entries,0);
 f.env.rt.manualKickAt=123;f.S.generation=2;await f.step();assert.equal(f.S.entries,1);assert.equal(f.S.keys,98);
});
test('смена класса без нового Start не обходит запрет входа после исчезновения известного run',async()=>{
 const f=fixture({cfg:{rebirthAutoEnter:true}});await f.step();f.ch.inBattle=false;f.instance.activeRun=null;f.location.href='/rebirth-raids.html';
 f.env.rt.classCur.prof=f.ch.l2Profession='human_sorcerer';f.env.rt.classCur.slot=f.ch.classSlots.activeSlot=1;f.S.generation=2;f.tick(3000);await f.step();
 assert.equal(f.S.entries,0);assert.equal(f.env.rt.rebirth.phase,'missing-run');
});
test('новый Start никогда не снимает неизвестный реально отправленный вход',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});await f.step();assert.equal(f.S.entries,1);
 f.env.rt.manualKickAt=123;f.S.generation=2;f.reload();await f.step();assert.equal(f.S.entries,1);assert.equal(f.env.rt.rebirth.phase,'unknown');
});
test('финальный next-none связывается с собственным rb_active и точным raid-run; чужие/неполные ответы игнорируются',async()=>{
 for(const kind of ['run','champion','origin','path','duplicate','spawn','http','method','class','phase']){
  const f=fixture();selected(f);await f.step();const s=f.env.rt.rebirth;
  const d={method:'GET',status:200,url:'/game/rebirth-raids/next?after=rebirth_raid_'+RUN+'_25098_lv35_raid_3',res:{phase:'none',spawnId:null}};
  if(kind==='run')d.url=d.url.replace(RUN,NEXT);if(kind==='champion')d.url=d.url.replace('25098_lv35_raid_3','champion_1');if(kind==='origin')d.url='https://other.invalid'+d.url;
  if(kind==='path')d.url=d.url.replace('/next?','/start?');if(kind==='duplicate')d.url+='&after=other';if(kind==='spawn')d.res.spawnId='next';if(kind==='http')d.status=500;if(kind==='method')d.method='POST';
  if(kind==='class')f.env.rt.classCur.prof='human_sorcerer';if(kind==='phase')s.runPhase='champion';
  assert.equal(await f.api().note('/game/rebirth-raids/next',d),false,kind);assert.ok(!f.env.rt.rebirth.completed,kind);
 }
});
test('синхронная квитанция завершения переживает навигацию, даже если запись rt не прошла',async()=>{
 const f=fixture({cfg:{rebirthAutoEnter:true}});selected(f);await f.step();f.S.saveOk=false;assert.equal(await complete(f),false);assert.ok(!f.env.rt.rebirth.completed);
 assert.ok([...f.storage.keys()].some(k=>k.startsWith('l2bot.rebirth-completed.')));
 f.S.saveOk=true;f.instance.activeRun=null;f.location.href='/rebirth-raids.html';f.reload();await f.step();assert.equal(f.S.entries,1);
});
test('Stop после durable sent, но до фактического клика/POST, восстанавливает только доказанно неотправленные действия',async()=>{
 for(const field of ['pending','fightPending','bossPending']){
  const f=field==='pending'?fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}}):field==='bossPending'?gateFixture():fixture();
  f.S.hooks.save=p=>{if(p.rebirth?.[field]?.phase==='sent')f.env.on=false;};await f.step();assert.equal(f.S.entries,0,field);assert.equal(f.posts.length,0,field);assert.deepEqual(f.clicks,[],field);
  assert.equal(f.env.rt.rebirth[field].phase,'sent');f.S.hooks.save=null;f.env.on=true;f.S.generation=2;f.reload();await f.step();
  assert.equal(field==='pending'?f.S.entries:field==='bossPending'?f.posts.length:f.clicks.filter(x=>x==='fight').length,1,field);
 }
});
test('невозможность сохранить или снять метку неотправленного входа запрещает расход ключей',async()=>{
 for(const kind of ['write','remove']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});f.S[kind==='write'?'storageWriteFail':'storageRemoveFail']=true;await f.step();assert.equal(f.S.entries,0,kind);assert.equal(f.S.keys,100,kind);
 }
});
test('fire отказал до отправки вместе со Stop: синхронная метка позволяет безопасный повтор после Start',async()=>{
 const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}}),fire=f.env.fire;
 f.env.fire=()=>{f.env.on=false;return false;};await f.step();assert.equal(f.S.entries,0);assert.equal(f.env.rt.rebirth.pending.phase,'sent');
 f.env.fire=fire;f.env.on=true;f.S.generation=2;f.reload();await f.step();assert.equal(f.S.entries,1);
});
test('копия sessionStorage в новом browser-tab не доказывает, что реально отправленный старой вкладкой вход не был выдан',async()=>{
 const a=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false}});let copied;
 a.S.hooks.save=p=>{if(p.rebirth?.pending?.phase==='sent')copied=[...a.storage.entries()];};await a.step();assert.equal(a.S.entries,1);assert.ok(copied?.length);
 const b=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true},state:{entryRun:false,keys:98},rt:{rebirth:copy(a.env.rt.rebirth)}});
 b.ch.revision=a.ch.revision;b.env.browserTabKey='tab2';b.env.leaseEpoch='new-lease';b.S.generation=2;for(const[k,v]of copied)b.storage.set(k,v);
 await b.step();assert.equal(b.S.entries,0);assert.equal(b.S.keys,98);assert.equal(b.env.rt.rebirth.phase,'unknown');assert.equal(b.env.rt.rebirth.pending.id,a.env.rt.rebirth.pending.id);
});
test('нет стабильного browser-tab identity — метка неотправленного входа не создаётся и ключи не расходуются',async()=>{
 for(const key of ['',undefined,'random-session-copy','tab-not-a-browser-id']){
  const f=fixture({page:'/rebirth-raids.html',noRun:true,cfg:{rebirthAutoEnter:true}});f.env.browserTabKey=key;await f.step();assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
 }
});
test('next-none без доказанной победы или с другим боссом не подтверждает завершение',async()=>{
 for(const kind of ['no-proof','no-victory','wrong-boss','no-callback']){
  const f=fixture({cfg:{rebirthAutoEnter:true}});selected(f);await f.step();assert.equal(f.clicks.length,0,'одно открытие логова не является победой');
  const after='rebirth_raid_'+RUN+'_'+(kind==='wrong-boss'?'99999':'25098')+'_lv35_raid_3',context={victory:kind!=='no-victory',after};
  if(kind==='no-callback')delete f.env.completedBoss;
  const answer=await f.api().note('/game/rebirth-raids/next',{method:'GET',status:200,url:'/game/rebirth-raids/next?after='+after,res:{phase:'none',spawnId:null}},kind==='no-proof'?undefined:context);
  assert.equal(answer,false,kind);assert.ok(!f.env.rt.rebirth.completed,kind);
  f.ch.inBattle=false;f.instance.activeRun=null;f.location.href='/rebirth-raids.html';f.tick(3000);await f.step();assert.equal(f.S.entries,0,kind);
 }
});
