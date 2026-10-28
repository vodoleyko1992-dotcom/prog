'use strict';
// Лог28.10 04:59: после смерти собственное восстановление не должно терять маркер и уходить в обычную охоту.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function fixture({own=true,vip=false,paid=false}={}){
 let now=1793160000000,hp=20,mp=20,hook=async()=>{};const H={},fires=[],posts=[],reads=[],writes=[],logs=[];
 const marker={kind:'death',char:'Hero',prof:'human_wizard',slot:0,kick:1,actor:'own-actor',revision:100};
 const job={step:'restore',set:null,fa:[],t:now,back:own?'/rebirth-raids.html':'/map.html',reviveTried:true,...(own?{rebirthRecovery:marker}:{})};
 const loc={pathname:'/town-buffer.html',href:''},msg={textContent:''},result={textContent:''},basic={kind:'basic'},restore={kind:'restore'},close={kind:'close'};
 const skills=id=>[{skillId:id,level:2,durationSec:86400}],catalog={sets:[{id:'basic',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1040)},{id:'mage',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1059)}]};
 const ch={id:'own-actor',name:'Hero',revision:100,inBattle:false,hp:200,maxHp:1000,classBranch:'mystic',l2Profession:'human_wizard',classSlots:{activeSlot:0},activeBuffs:[],vip:{active:vip,vipUntil:new Date(now+86400000).toISOString()}};
 const env={on:true,tabOwner:true,leaseEpoch:'lease',cfg:{rebirthMode:own,autoTasks:own?['rebirth']:['farm'],townBuffSet:paid?'mage':'basic',vipBuffAuto:vip,faBuffs:paid?'1357':'',vipResists:false},
  rt:{char:'Hero',manualKickAt:1,classCur:{prof:'human_wizard',slot:0},tbuff:job},routeLocation:loc,TB_KEYS:{basic:[1040],mage:[1059]},FA_KNOWN:{},IL:{},DEAD_RE:/unconscious/,
  $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(H).map(([id,t])=>({dataset:{skillId:id,expiresAt:t},getAttribute:()=> 'Lv.2'}))}:
    s==='#town-buffer-restore-btn'?restore:s==='#town-buffer-msg'?msg:s==='#town-buffer-result-title'?result:s==='#town-buffer-result-text'?{textContent:''}:
    s.startsWith('#town-buffer-sets ')?basic:s.startsWith('#town-buffer-result-overlay')?close:null,
  meHp:()=>({pct:hp,cur:hp*10,max:1000}),meMp:()=>({pct:mp,cur:mp*10,max:1000}),autonomyMode:()=>own?'rebirth':'farm',
  setRt:async p=>{writes.push(p);Object.assign(env.rt,p);await hook('save',p);return{ok:true}},rtCommit:async()=>{await hook('commit');return true},
  setStatus:s=>logs.push(s),rec:(...a)=>logs.push(a.join(' ')),draw:()=>{},rnd:()=>1,
  waitX:async f=>{await hook('wait');return f()},sleep:async ms=>{now+=ms;await hook('sleep')},pause:async()=>hook('pause'),shown:()=>true,
  epicBuffPay:async()=>{throw Error('новый CoL запрещён')},faCost:()=>1,
  payments:{blocked:()=>false,pending:()=>null,prepare:async()=>{throw Error('новая платная квитанция запрещена')}},
  gameGet:async url=>{reads.push(url);await hook('get',url);return{ok:true,json:async()=>{await hook('json',url);return structuredClone(url==='/character'?{character:ch}:catalog)}}},
  gamePost:async(url,body)=>{await hook('post');posts.push({url,body});assert.equal(body.expectedFeeAdena,'0');assert.equal(body.expectedFeeCoinOfLuck,0);
    ch.revision++;ch.activeBuffs=catalog.sets.find(x=>x.id===body.set).skills.map(x=>({...x,expiresAtMs:now+86400000}));
    for(const x of ch.activeBuffs)H[x.skillId]=x.expiresAtMs;return{ok:true,status:200,json:async()=>({character:structuredClone(ch)})}},
  fire:b=>{fires.push(b.kind);if(b===basic){H[1040]=now+86400000;result.textContent='Бафф наложен';}if(b===restore){hp=100;mp=100;msg.textContent='Восстановлено';}return true}
 };
 const box={console,URLSearchParams,Date:class extends Date{static now(){return now}},Math,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(read('engine-core.js'),box);env.rebirthBuffAllowed=j=>box.L2EngineCore.rebirthBuffJob(env.cfg,env.rt,j);
 vm.runInNewContext(read('modules/buffs.js'),box);const B=box.L2V7Factories.buffs(env);
 return{env,B,loc,H,fires,posts,reads,writes,logs,ch,catalog,marker,job,restore,basic,get hp(){return hp},set hp(v){hp=v},set mp(v){mp=v},set hook(v){hook=v},tick:ms=>now+=ms};
}

test('свой restore→бесплатный basic→restore сохраняет маркер и возвращает только в каталог',async()=>{
 const f=fixture({paid:true});assert.equal(f.B.rebirthBuffNeed().set,'basic');
 await f.B.townBuffStep();assert.equal(f.env.rt.tbuff.step,'town');assert.equal(f.env.rt.tbuff.set,'basic');assert.equal(f.env.rt.tbuff.fa.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(f.env.rt.tbuff.rebirthRecovery)),f.marker);assert.equal(f.env.rt.tbuff.back,'/rebirth-raids.html');
 assert.equal(f.env.rt.tbuff.then.back,'/rebirth-raids.html');assert.equal(f.env.rt.tbuff.then.rebirthRecovery.actor,'own-actor');
 await f.B.townBuffStep();assert.equal(f.env.rt.tbuff.step,'restore');assert.equal(f.env.rt.tbuff.buffDone,true);
 assert.equal(f.B.rebirthBuffNeed(),null,'готовый basic не ждёт платный mage или FA');
 await f.B.townBuffStep();assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.restoreRes.ok,true);assert.equal(f.loc.href,'/rebirth-raids.html');
 assert.deepEqual(f.fires,['basic','close','restore']);assert.equal(f.posts.length,0);assert.deepEqual(f.reads,['/character','/character','/character/town/buffer/catalog','/character']);
});

test('выключенные городские баффы не включаются собственным восстановлением',async()=>{
 const f=fixture();f.env.cfg.townBuffSet='off';assert.equal(f.B.rebirthBuffNeed(),null);await f.B.townBuffStep();
 assert.deepEqual(f.fires,['restore']);assert.equal(f.loc.href,'/rebirth-raids.html');assert.deepEqual(f.reads,['/character']);
});

test('без кнопки восстановление не объявляется успешным, обычный маршрут возвращается на карту',async()=>{
 for(const own of [false,true]){const f=fixture({own});f.env.rt.tbuff.buffDone=true;const q=f.env.$q;f.env.$q=s=>s==='#town-buffer-restore-btn'?null:q(s);
 await f.B.townBuffStep();assert.equal(f.env.rt.restoreRes.ok,false);assert.equal(f.loc.href,own?'/rebirth-raids.html':'/map.html');assert.equal(f.fires.length,0);}
});

test('сохранённые платные set/FA собственного восстановления очищаются без расходов',async()=>{
 for(const step of ['town','fa']){const f=fixture({paid:true});Object.assign(f.env.rt.tbuff,{step,set:'mage',fa:[1357]});await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff.fa.length,0);assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.deepEqual(f.reads,['/character']);
 assert.equal(f.env.rt.tbuff.step,step==='fa'?'restore':'town');if(step==='town')assert.equal(f.env.rt.tbuff.set,'basic');}
});

for(const price of ['coin','adena','missing','unknownFee'])test('basic с ценой '+price+' не нажимается',async()=>{
 const f=fixture();await f.B.townBuffStep();const row=f.catalog.sets[0];if(price==='coin')row.feeCoinOfLuck=15;if(price==='adena')row.feeAdena='1';
 if(price==='missing')delete row.feeAdena;if(price==='unknownFee')row.feeFastAden=1;
 await f.B.townBuffStep();assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.step,'restore');
});

for(const point of ['get','json','wait','pause','sleep','save'])for(const change of ['stop','owner','lease','kick','class','slot','marker','mode'])test(`свой маршрут отменяется после ${point}: ${change}`,async()=>{
 const f=fixture();let changed=false;
 if(point==='get'||point==='json'||point==='pause'){await f.B.townBuffStep();}
 if(point==='wait'||point==='sleep'){f.env.rt.tbuff.buffDone=true;}
 f.hook=async p=>{if(p!==point||changed)return;changed=true;if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='lease')f.env.leaseEpoch='other';
  if(change==='kick')f.env.rt.manualKickAt=2;if(change==='class')f.env.rt.classCur.prof='other';if(change==='slot')f.env.rt.classCur.slot=1;
  if(change==='marker')f.env.rt.tbuff.rebirthRecovery={...f.env.rt.tbuff.rebirthRecovery,actor:'other'};if(change==='mode')f.env.cfg.autoTasks=['farm'];};
 await f.B.townBuffStep();assert.equal(changed,true);assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.equal(f.loc.href,'');
});

test('VIP собственного восстановления использует прежнее подтверждение нулевой цены',async()=>{
 const f=fixture({vip:true});f.B.vipNote(f.ch);assert.equal(f.B.rebirthBuffNeed().vipFree,true);await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff.vipFree,true);await f.B.townBuffStep();assert.equal(f.posts.length,1);
 assert.equal(f.posts[0].body.expectedFeeAdena,'0');assert.equal(f.posts[0].body.expectedFeeCoinOfLuck,0);assert.equal(f.env.rt.tbuff.step,'restore');
 await f.B.townBuffStep();assert.equal(f.loc.href,'/rebirth-raids.html');assert.equal(f.env.rt.restoreRes.ok,true);
});

test('потерянный VIP-ответ не повторяется, маркер и then сохраняются до сверки',async()=>{
 const f=fixture({vip:true});f.B.vipNote(f.ch);await f.B.townBuffStep();const post=f.env.gamePost;
 f.env.gamePost=async(...args)=>{await post(...args);throw Error('lost ACK')};await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff.vipRequest.phase,'sent');
 await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff.step,'restore');assert.equal(f.env.rt.tbuff.rebirthRecovery.actor,'own-actor');
});

for(const step of ['restore','town'])test('отказ записи завершения '+step+' не разрешает переход и сохраняет собственную задачу',async()=>{
 const f=fixture();f.env.rt.tbuff.buffDone=true;
 if(step==='town'){f.env.rt.tbuff.step='town';f.env.rt.tbuff.set='basic';}
 const save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);return p.tbuff===null?{ok:false}:r;};
 await f.B.townBuffStep();assert.equal(f.loc.href,'');assert.ok(f.env.rt.tbuff?.rebirthRecovery);assert.equal(f.posts.length,0);
});

for(const change of ['replacement','marker','Stop','class','slot','kick','mode'])test('завершение не обгоняет смену контекста после очистки задачи: '+change,async()=>{
 const f=fixture();f.env.rt.tbuff.buffDone=true;let changed=false;
 const replacement={t:999,step:'restore',marker:'new job'};
 f.hook=async(p,patch)=>{if(p!=='save'||patch.tbuff!==null||changed)return;changed=true;
  if(change==='replacement')f.env.rt.tbuff=replacement;if(change==='marker')f.marker.actor='other';if(change==='Stop')f.env.on=false;
  if(change==='class')f.env.rt.classCur.prof='other';if(change==='slot')f.env.rt.classCur.slot=1;if(change==='kick')f.env.rt.manualKickAt=2;if(change==='mode')f.env.cfg.autoTasks=['farm'];};
 await f.B.townBuffStep();assert.equal(changed,true);assert.equal(f.loc.href,'');
 if(change==='replacement')assert.equal(f.env.rt.tbuff,replacement);
});

for(const point of ['before','get','pause'])test('выключение баффера '+point+' не применяет собственный basic',async()=>{
 const f=fixture();await f.B.townBuffStep();
 if(point==='before')f.env.cfg.townBuffSet='off';else f.hook=async p=>{if(p===point)f.env.cfg.townBuffSet='off';};
 await f.B.townBuffStep();assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);
 if(point!=='before'){f.hook=async()=>{};await f.B.townBuffStep();}
 assert.equal(f.env.rt.tbuff.step,'restore');assert.equal(f.env.rt.tbuff.buffDone,true);
});

const withoutHud=f=>{const q=f.env.$q;f.env.$q=s=>s==='#l2-hud-active-buffs'?null:q(s);};
test('неизвестная шапка баффов отличается от готового героя; свежий свой снимок умеет планировать basic',()=>{
 const f=fixture();withoutHud(f);assert.equal(f.B.rebirthBuffNeed().unknown,true);
 assert.equal(f.B.rebirthBuffNeed(f.ch).set,'basic');f.ch.activeBuffs=[{skillId:1040,level:2,expiresAtMs:Date.now()+864000000}];
 assert.equal(f.B.rebirthBuffNeed(f.ch),null);assert.equal(f.B.rebirthBuffNeed().unknown,true,'временный снимок не становится вечной готовностью');
 f.ch.activeBuffs=[];assert.equal(f.B.rebirthBuffNeed(f.ch).set,'basic');
});

for(const change of ['name','actor','foreignActor','revision','prof','slot','battle','hp','array','effectId','expiry','level'])test('чужой/неполный свежий снимок не доказывает готовность баффов: '+change,()=>{
 const f=fixture();const c=structuredClone(f.ch);
 if(change==='name')c.name='Other';if(change==='actor')c.id='';if(change==='foreignActor')c.id='other-actor';if(change==='revision')delete c.revision;if(change==='prof')c.l2Profession='other';
 if(change==='slot')c.classSlots.activeSlot=1;if(change==='battle')c.inBattle=true;if(change==='hp')c.hp=0;if(change==='array')c.activeBuffs=null;
 if(change==='effectId')c.activeBuffs=[{skillId:'bad'}];if(change==='expiry')c.activeBuffs=[{skillId:1040,expiresAt:'bad'}];if(change==='level')c.activeBuffs=[{skillId:1040,level:'bad'}];
 assert.equal(f.B.rebirthBuffNeed(c).unknown,true);
});

test('ownrestore без шапки заново читает своего героя и планирует бесплатный бафф',async()=>{
 const f=fixture();withoutHud(f);await f.B.townBuffStep();assert.deepEqual(f.reads,['/character']);assert.equal(f.env.rt.tbuff.step,'town');
 assert.equal(f.env.rt.tbuff.set,'basic');assert.equal(f.env.rt.tbuff.fa.length,0);assert.equal(f.fires.length,0);
});

test('сбой свежей сверки при неизвестной шапке не очищает ownrestore и не объявляет героя готовым',async()=>{
 const f=fixture();withoutHud(f);f.env.gameGet=async()=>({ok:false,status:503,json:async()=>null});await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff.step,'restore');assert.equal(f.env.rt.restoreRes,undefined);assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.equal(f.loc.href,'');
});

test('неизвестная шапка с подтверждёнными basic-баффами разрешает только восстановление HP',async()=>{
 const f=fixture();withoutHud(f);f.ch.activeBuffs=[{skillId:1040,level:2,expiresAtMs:Date.now()+864000000}];await f.B.townBuffStep();
 assert.equal(f.env.rt.restoreRes.ok,true);assert.deepEqual(f.fires,['restore']);assert.equal(f.loc.href,'/rebirth-raids.html');
});

test('свежий VIP снимок без шапки выбирает бесплатный mage, не платную настройку и не FA',()=>{
 const f=fixture({vip:true,paid:true});withoutHud(f);const n=f.B.rebirthBuffNeed(f.ch);assert.equal(n.set,'mage');assert.equal(n.vipFree,true);assert.equal(n.fa.length,0);
 assert.equal(f.env.rt.vipBuff,undefined,'планирование не пишет постоянную VIP-память');
});

for(const step of ['restore','basic','vip'])for(const change of ['actor','prof','slot','inBattle','oldRevision'])test('свежая личность перед own-'+step+' обязательна: '+change,async()=>{
 const f=fixture({vip:step==='vip'});if(step==='vip')f.B.vipNote(f.ch);
 if(step!=='restore')await f.B.townBuffStep();else f.env.rt.tbuff.buffDone=true;
 if(change==='actor')f.ch.id='other-actor';if(change==='prof')f.ch.l2Profession='other';if(change==='slot')f.ch.classSlots.activeSlot=1;
 if(change==='inBattle')f.ch.inBattle=true;if(change==='oldRevision')f.ch.revision=99;
 await f.B.townBuffStep();assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.equal(f.loc.href,'');assert.ok(f.env.rt.tbuff?.rebirthRecovery);
});

for(const change of ['actor','prof','slot','inBattle','oldRevision'])test('вторая свежая VIP-сверка не подменяет владельца собственного маршрута: '+change,async()=>{
 const f=fixture({vip:true});f.B.vipNote(f.ch);await f.B.townBuffStep();const get=f.env.gameGet;let chars=0;
 f.env.gameGet=async url=>{const r=await get(url);if(url!=='/character'||++chars!==2)return r;
  const ch=structuredClone(f.ch);if(change==='actor')ch.id='other-actor';if(change==='prof')ch.l2Profession='other';if(change==='slot')ch.classSlots.activeSlot=1;
  if(change==='inBattle')ch.inBattle=true;if(change==='oldRevision')ch.revision=99;return{...r,json:async()=>({character:ch})};};
 await f.B.townBuffStep();assert.equal(chars,2);assert.equal(f.fires.length,0);assert.equal(f.posts.length,0);assert.equal(f.loc.href,'');
});
