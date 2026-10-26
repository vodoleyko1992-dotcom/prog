'use strict';
// 20.66 (лог Rebirth 26.10 21:15): уровень20 проверен при SP0, но после накопления SP ранг должен доучиться до21.
// Настоящий блок магистра; сессионный доход SP и серверный остаток намеренно разделены.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const content=fs.readFileSync(process.env.L2_MAGISTER_CONTENT||path.join(__dirname,'../content.js'),'utf8');
const begin=content.indexOf('const MAG_SKIP_DEF ='),end=content.indexOf('// ---------- выбило из игры:',begin);
assert.ok(begin>=0&&end>begin,'найден настоящий блок магистра');
const source=content.slice(begin,end),guard=content.slice(content.indexOf('function automationSnapshot()'),content.indexOf('async function automationFlush('));
const key='0:human_wizard',clone=x=>structuredClone(x);
function fixture(o={}){
 let now=1793000000000;
 const s={wallet:o.wallet??0,revision:100,rank:o.rank??1,max:o.max??2,cost:o.cost??240,minLevel:1,name:'Wind Strike',
  reason:'Недостатньо SP (потрібно 240, є 0).',blocked:false,weapon:false,hero:'hero',mode:'farm',canAct:true,payment:false,tvt:false,
  gets:[],posts:[],nav:[],writes:[],commits:0,hooks:{},url:'https://l2wap.com/magister.html?npcId=30344'};
 Object.assign(s,o.server);
 const location={get href(){return s.url},set href(v){s.nav.push(v);s.url=new URL(v,s.url).href},
  get pathname(){return new URL(s.url).pathname},set pathname(v){const u=new URL(s.url);u.pathname=v;s.url=u.href},
  get search(){return new URL(s.url).search}};
 const c={console,URL,URLSearchParams,Date:class extends Date{static now(){return now}},on:true,tabOwner:true,
  leaseEpoch:'lease-1',automationGeneration:1,pageLeaving:false,pageGone:false,
  cfg:{autoMagister:true,magisterSpReserve:0,tvtOn:true,...o.cfg},
  rt:{char:'hero',lvl:20,classCur:{prof:'human_wizard',slot:0},magEnabled:true,sp:0,sessT0:now-10000,manualKickAt:7,
   zone:'valley',panel:[{name:'Wind Strike'}],skills:{'wind strike':{dmgN:2}},...o.rt},location,
  heroNick:()=>s.hero,heroLevel:()=>c.rt.lvl,autonomyMode:()=>s.mode,modeSig:()=>s.mode,
  isBattle:()=>location.pathname==='/battle.html',victory:()=>s.win!==false,fishNow:()=>false,
  abHold:()=>!!c.rt.abChal,antibotState:()=>c.rt.abChal?'challenge':c.rt.pveBlockUntil?'blocked':null,
  names:v=>String(v??'').split(',').map(x=>x.trim().toLowerCase()),ilOf:n=>({n,c:'Маг. атака'}),petState:()=>null,
  rec(){},setStatus(){},sleep:async()=>{},actionWait:async valid=>valid(),
  toMap:async()=>{s.nav.push('map');location.pathname='/map.html'},catGo:async id=>s.nav.push('cat:'+id),
  setRt:async p=>{s.writes.push(clone(p));Object.assign(c.rt,p);await s.hooks.save?.(p);return{ok:s.saveOk!==false}},
  rtCommit:async()=>{s.commits++;await s.hooks.commit?.(s.commits);return s.commitOk!==false},
  L2V7Modules:{story:{charNote(){}},subclass:{charNote(){}},combat:{learnWeaponBarred:il=>s.weapon||!!s.barred?.includes(il.n)},
   tvt:{tvtHold:()=>s.tvt},payments:{blocked:()=>s.payment},actions:{canAct:()=>s.canAct}}};
 const character=()=>({name:'hero',level:20,l2Profession:'human_wizard',classSlots:{activeSlot:0},revision:s.revision,sp:s.wallet,inBattle:false,...s.character});
 const catalog=()=>({npc:{npcId:30344},profession:{l2Profession:'human_wizard'},characterSp:s.wallet,
  skills:[{battleId:'l2_1177',nameUk:s.name,kind:'active',minLevel:s.minLevel,spCost:s.cost,skillLevel:s.rank,maxSkillLevel:s.max,
   learnedMax:s.rank>=s.max,canLearn:!s.blocked&&s.wallet>=s.cost&&s.rank<s.max,
   canLearnBlockReasonUk:s.blocked?s.reason:s.wallet<s.cost?s.reason:'',...s.skill},...s.extraSkills||[]]});
 c.gameGet=async p=>{s.gets.push(p);await s.hooks.get?.(p,s.gets.length);return{ok:s.httpOk!==false,status:s.httpOk===false?503:200,
  json:async()=>{await s.hooks.json?.(p);return clone(p==='/character'?{character:character()}:catalog())}}};
 c.gamePost=async(p,body)=>{s.posts.push({path:p,body:clone(body)});assert.equal(p,'/character/skills/learn');assert.equal(body.battleId,'l2_1177');
  if(body.expectedRevision!==s.revision||s.wallet<s.cost||s.rank>=s.max)return{ok:false,status:409};
  s.wallet-=s.cost;s.rank++;s.revision++;await s.hooks.post?.();return{ok:true,status:200}};
 vm.createContext(c);vm.runInContext(guard+source,c);
 const seed=()=>c.rt.magister={t:now,char:'hero',key,prof:'human_wizard',slot:0,lvl:20,kick:c.rt.manualKickAt,home:{zone:'valley',mode:'farm'}};
 seed();return{c,s,seed,advance:n=>now+=n,start:(afterWin=true)=>c.magisterStart(afterWin),step:()=>c.magisterStep(),
  win:gain=>{c.rt.sp+=gain;s.wallet+=gain;s.revision++;location.pathname='/battle.html'},
  wait:()=>c.rt.magChecked?.[key]?.spWait,checked:()=>c.rt.magChecked?.[key],
  teacher:()=>{s.url='https://l2wap.com/magister.html?npcId=30344'}};
}
async function checked(o={}){
 const f=fixture(o);await f.step();assert.equal(f.s.posts.length,0,'первая проверка не покупает ранг без условий');
 assert.equal(f.c.rt.magister,null,'первый поход завершён');assert.equal(f.checked()?.lvl,20);return f;
}

test('SP0→32 без запросов→356: свежая сверка, повтор уровня20 и ровно один подтверждённый ранг',async()=>{
 const f=await checked();
 f.win(32);f.advance(16000);let n=f.s.gets.length;assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n);
 f.win(324);f.advance(16000);n=f.s.gets.length;assert.equal(await f.start(),true);assert.deepEqual(f.s.gets.slice(n),['/character']);
 assert.equal(f.c.rt.magister.lvl,20);assert.equal(f.c.rt.magister.key,key);f.teacher();await f.step();
 assert.equal(f.s.posts.length,1);assert.equal(f.s.posts[0].body.expectedRevision,102);assert.equal(f.s.rank,2);assert.equal(f.s.wallet,116);
 assert.equal(f.c.rt.magPending?.[key],undefined);assert.equal(f.wait(),undefined,'максимальный ранг больше не ждёт SP');
 f.win(1000);f.advance(16000);n=f.s.gets.length;assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n);
});

test('точный порог учитывает текущий резерв, а не только накопленный доход',async()=>{
 for(const reserve of [0,100]){
  const f=await checked({cfg:{magisterSpReserve:reserve}});f.win(239+reserve);f.advance(16000);const n=f.s.gets.length;
  assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n,'до порога не делаем GET');
  f.win(1);f.advance(16000);assert.equal(await f.start(),true,'равенства cost+reserve достаточно');f.teacher();await f.step();
  assert.equal(f.s.posts.length,1);assert.equal(f.s.wallet,reserve);
 }
 const f=await checked();f.c.cfg.magisterSpReserve=200;f.win(300);f.advance(16000);const n=f.s.gets.length;
 assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n,'повышенный резерв применяется к старому ожиданию');
 f.win(140);f.advance(16000);assert.equal(await f.start(),true);
 const lower=await checked({wallet:300,cfg:{magisterSpReserve:100}});lower.c.cfg.magisterSpReserve=0;lower.win(0);lower.advance(16000);
 assert.equal(await lower.start(),true,'уменьшенный резерв тоже применяется к старому ожиданию');
});

test('дешёвые запрещённые карточки не подменяют порог нужного ранга; после покупки учитывается новая цена',async()=>{
 const card={battleId:'other',nameUk:'Other',minLevel:1,spCost:1,skillLevel:0,maxSkillLevel:2,canLearn:false,canLearnBlockReasonUk:'Недостатньо SP'};
 const f=await checked({cfg:{magisterSkip:'Skip'},server:{barred:['Weapon'],extraSkills:[
  {...card,nameUk:'Skip'}, {...card,nameUk:'Weapon'}, {...card,nameUk:'Locked',canLearnBlockReasonUk:'Недостатньо умов'},
  {...card,nameUk:'Max',learnedMax:true}, {...card,nameUk:'High level',minLevel:21}]}});
 f.win(239);f.advance(16000);const n=f.s.gets.length;assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n);
 f.win(1);f.advance(16000);assert.equal(await f.start(),true);
 const next=fixture({wallet:356,max:3});next.s.hooks.post=()=>{next.s.cost=400};await next.step();
 assert.equal(next.s.posts.length,1);assert.equal(next.s.rank,2);assert.equal(next.wait().balance,116);
 next.win(283);next.advance(16000);const reads=next.s.gets.length;assert.equal(await next.start(),false);assert.equal(next.s.gets.length,reads);
 next.win(1);next.advance(16000);assert.equal(await next.start(),true);next.teacher();await next.step();
 assert.equal(next.s.posts.length,2);assert.equal(next.s.rank,3);assert.equal(next.s.wallet,0);
});

test('ожидание создаётся только для разрешённого ранга, которому мешает SP',async()=>{
 for(const reason of ['Недостатньо SP','Недостаточно SP','Insufficient SP','Not enough SP'])assert.ok((await checked({server:{reason}})).wait(),reason);
 assert.ok((await checked({wallet:300,cfg:{magisterSpReserve:100}})).wait(),'canLearn:true, но цена нарушает резерв');
 for(const [label,o] of Object.entries({max:{rank:2,max:2},skip:{cfg:{magisterSkip:'Wind Strike'}},weapon:{server:{weapon:true}},
  level:{server:{minLevel:21}},condition:{server:{blocked:true,reason:'Недостатньо умов'}},unknown:{server:{blocked:true,reason:''}},
  invalidCost:{server:{cost:NaN}},missingRank:{server:{rank:null}},flagMax:{server:{skill:{learnedMax:true}}}})){
  const f=await checked(o);assert.equal(f.wait(),undefined,label);f.win(10000);f.advance(16000);const n=f.s.gets.length;
  assert.equal(await f.start(),false,label);assert.equal(f.s.gets.length,n,label+' не создаёт лишний GET');
 }
});

test('доход только предлагает сверку: свежий остаток, revision и собственный класс подтверждают её',async()=>{
 for(const [label,patch] of Object.entries({SP:{sp:239},revision:{revision:99},hero:{name:'other'},class:{l2Profession:'human_warlock'},
  slot:{classSlots:{activeSlot:1}},missingSlot:{classSlots:{}},missingSP:{sp:undefined},missingRevision:{revision:undefined},level:{level:21},
  activeBattle:{inBattle:true},unknownBattle:{inBattle:undefined}})){
  const f=await checked();f.win(356);f.s.character=patch;f.advance(16000);const n=f.s.gets.length;
  assert.equal(await f.start(),false,label);assert.equal(f.s.gets.length,n+1,label+' прочитан свежий character');
  assert.equal(f.c.rt.magister,null,label);assert.equal(f.s.posts.length,0,label);
 }
});

test('обычный tick, чужая победа и временные блокировки не запускают SP-повтор',async()=>{
 for(const [label,change] of Object.entries({tick:f=>{},defeat:f=>{f.s.win=false},off:f=>{f.c.on=false},lease:f=>{f.c.tabOwner=false},
  captcha:f=>{f.c.rt.abChal=true},PvE:f=>{f.c.rt.pveBlockUntil=true},tvt:f=>{f.s.tvt=true},payment:f=>{f.s.payment=true},
  fish:f=>{f.c.fishNow=()=>true},travel:f=>{f.c.rt.travelCheck={}},manualOff:f=>{f.c.cfg.autoMagister=false}})){
  const f=await checked();f.win(356);f.advance(16000);change(f);const n=f.s.gets.length;
  assert.equal(await f.start(label!=='tick'),false,label);assert.equal(f.s.gets.length,n,label);assert.equal(f.s.posts.length,0,label);
 }
});

test('после await старый повтор не переживает Stop, аренду, героя, класс, слот, новый Start или страницу',async()=>{
 const changes={Stop:f=>{f.c.on=false},owner:f=>{f.c.tabOwner=false},lease:f=>{f.c.leaseEpoch='lease-2'},
  hero:f=>{f.c.rt.char='other';f.s.hero='other'},class:f=>{f.c.rt.classCur.prof='human_warlock'},slot:f=>{f.c.rt.classCur.slot=1},
  start:f=>{f.c.automationGeneration++},kick:f=>{f.c.rt.manualKickAt++},page:f=>{f.c.location.pathname='/mail.html'},
  mode:f=>{f.s.mode='cat'},canAct:f=>{f.s.canAct=false},captcha:f=>{f.c.rt.abChal=true},payment:f=>{f.s.payment=true},tvt:f=>{f.s.tvt=true},
  reserve:f=>{f.c.cfg.magisterSpReserve=1000},skip:f=>{f.c.cfg.magisterSkip='Wind Strike'},weapon:f=>{f.s.weapon=true}};
 for(const stage of ['get','json','save','commit'])for(const [label,change] of Object.entries(changes)){
  const f=await checked();f.win(356);f.advance(16000);let fired=false;
  f.s.hooks[stage]=async()=>{if(!fired){fired=true;change(f)}};
  const nav=f.s.nav.length;await f.start();assert.ok(fired,stage+': '+label+' hook выполнен');
  assert.equal(f.s.posts.length,0,stage+': '+label);assert.equal(f.s.nav.length,nav,stage+': '+label+' не уходит с поля боя');
 }
});

test('смена сессии и сброс дохода требуют нового остатка, старую дельту не считают кошельком',async()=>{
 for(const reset of [f=>{f.c.rt.sessT0++},f=>{f.c.rt.manualKickAt++},f=>{f.c.rt.sp=0}]){
  const f=await checked({rt:{sp:100}});reset(f);f.s.wallet=239;f.s.revision++;f.c.location.pathname='/battle.html';f.advance(16000);
  const n=f.s.gets.length;assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n+1,'смена basis разрешает только сверку');
  assert.equal(f.c.rt.magister,null);f.win(1);f.advance(16000);assert.equal(await f.start(),true,'после новой базы нужен реальный SP');
 }
 for(const invalid of [undefined,NaN,-1]){
  const f=await checked();f.win(356);f.c.rt.sp=invalid;f.advance(16000);const n=f.s.gets.length;
  assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n,'неизвестный счётчик не считается доходом');
 }
});

test('поздний commit и замена ожидаемого навыка не позволяют уйти по устаревшей сверке',async()=>{
 for(const change of [f=>{f.c.on=false},f=>{f.c.leaseEpoch='lease-2'},f=>{f.c.automationGeneration++},f=>{f.c.location.pathname='/mail.html'},
  f=>{f.c.rt.magChecked={...f.c.rt.magChecked,[key]:{...f.checked(),spWait:{...f.wait(),balance:999}}}},
  f=>{f.wait().skills[0].spCost=999}]){
  const f=await checked();f.win(356);f.advance(16000);let calls=0;f.s.hooks.commit=()=>{if(++calls===2)change(f)};
  const nav=f.s.nav.length;await f.start();assert.equal(calls,2,'проверяется flush после создания job');
  assert.equal(f.s.nav.length,nav);assert.equal(f.s.posts.length,0);
 }
 const f=await checked();f.win(356);f.advance(16000);f.s.hooks.commit=()=>{if(f.c.rt.magister)f.s.commitOk=false};
 const nav=f.s.nav.length;await f.start();assert.equal(f.s.nav.length,nav,'неудачный поздний commit не разрешает переход');
});

test('реальный inactive setRt и пустой recover не подтверждают сохранение нового SP-похода',async()=>{
 const f=await checked();f.win(356);f.advance(16000);
 Object.assign(f.c,{tabIdle:true,document:{prerendering:false},RT_BULKY:[],rtSizeT:f.c.Date.now(),
  rtWriter:require('../engine-core.js').createPatchQueue(async()=>({ok:true}))});
 const a=content.indexOf('function setRt(p)'),b=content.indexOf('const RECENT',a),d=content.indexOf('async function rtCommit('),e=content.indexOf('const rodLvlOf',d);
 vm.runInContext(content.slice(a,b)+content.slice(d,e),f.c);assert.equal(await f.c.rtCommit(),true,'пустая очередь не доказывает запись');
 const nav=f.s.nav.length;await f.start();assert.equal(f.s.nav.length,nav);assert.equal(f.s.posts.length,0);assert.equal(Object.keys(f.c.rtWriter.peek()).length,0);
});

test('нехватка свежего SP переустанавливает базу и не опрашивает сервер каждый tick',async()=>{
 const f=await checked();f.win(356);f.s.wallet=100;f.advance(16000);assert.equal(await f.start(),false);const n=f.s.gets.length;
 f.advance(16000);assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n,'тот же доход не даёт повторный GET');
 f.win(139);f.advance(16000);assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n);
 f.win(1);f.advance(16000);assert.equal(await f.start(),true);
});

test('ошибка чтения имеет backoff; неизвестный receipt не разрешает новый расход SP',async()=>{
 const f=await checked();f.win(356);f.advance(16000);f.s.httpOk=false;assert.equal(await f.start(),false);const n=f.s.gets.length;
 f.s.httpOk=true;f.advance(16000);assert.equal(await f.start(),false);assert.equal(f.s.gets.length,n,'HTTP-отказ не крутит частые GET');
 f.advance(45000);assert.equal(await f.start(),true);
 const p=await checked();p.win(356);p.c.rt.magPending={[key]:{id:'l2_1177',name:'Wind Strike',rank:1,revision:100,sp:1000,t:p.c.Date.now(),phase:'sent'}};
 p.advance(16000);await p.start();p.teacher();await p.step();assert.equal(p.s.posts.length,0,'неподтверждённый предыдущий ранг не оплачивается снова');
 assert.ok(p.c.rt.magPending[key]);
});

test('accepted rank с потерянным ответом восстанавливается в новом экземпляре без повторного POST',async()=>{
 const f=await checked();f.win(356);f.advance(16000);assert.equal(await f.start(),true);f.teacher();
 f.s.hooks.post=()=>{throw Error('ответ обучения потерян после принятия сервером')};await f.step();
 assert.equal(f.s.posts.length,1);assert.equal(f.s.rank,2);assert.equal(f.s.wallet,116);
 assert.ok(f.c.rt.magPending[key]);assert.equal(f.c.rt.magister,null);assert.ok(f.wait(),'отметка уровня и SP-ожидание ещё сохранены');
 const fresh=fixture({wallet:f.s.wallet,rank:f.s.rank,server:{revision:f.s.revision},rt:clone(f.c.rt)});fresh.c.rt.magister=null;
 fresh.c.location.pathname='/battle.html';fresh.advance(100000);assert.equal(await fresh.start(),true,'receipt того же класса проходит к сверке несмотря на checked20');
 fresh.teacher();await fresh.step();assert.equal(fresh.s.posts.length,0,'выученный ранг повторно не оплачивается');
 assert.equal(fresh.c.rt.magPending[key],undefined,'свежий точный ранг закрывает receipt');assert.equal(fresh.wait(),undefined);
});

test('неподтверждённый ранг после SP-retry остаётся receipt, чужой pending не обходит отметку уровня',async()=>{
 const f=await checked();f.win(356);f.advance(16000);assert.equal(await f.start(),true);f.teacher();
 f.s.hooks.post=()=>{throw Error('ответ потерян')};await f.step();const pending=clone(f.c.rt.magPending[key]);
 const fresh=fixture({wallet:116,rank:1,server:{revision:102},rt:clone(f.c.rt)});fresh.c.rt.magister=null;
 fresh.c.location.pathname='/battle.html';fresh.advance(100000);assert.equal(await fresh.start(),true,'неопределённый исход получает сверку');
 fresh.teacher();await fresh.step();assert.equal(fresh.s.posts.length,0,'списание без точного роста ранга не разрешает второй расход');
 assert.equal(fresh.c.rt.magPending[key].revision,pending.revision);assert.equal(fresh.c.rt.magPending[key].rank,pending.rank);
 const other=await checked();other.c.rt.magPending={'1:human_warlock':pending};other.c.location.pathname='/battle.html';
 other.advance(100000);const n=other.s.gets.length;assert.equal(await other.start(),false);assert.equal(other.s.gets.length,n,'receipt другого класса не обходит проверенный уровень');
});

test('без SP-ожидания сохраняется прежняя политика уровней и отключённого автомагистра',async()=>{
 const f=fixture({rt:{magChecked:{[key]:{lvl:20,t:1}}}});f.c.rt.magister=null;
 f.win(10000);assert.equal(await f.start(),false);assert.equal(f.s.gets.length,0);
 f.c.rt.lvl=21;assert.equal(await f.start(),true);assert.equal(f.c.rt.magister.lvl,21);
 const off=await checked();off.c.cfg.autoMagister=false;off.win(10000);assert.equal(await off.start(),false);assert.equal(off.s.posts.length,0);
});
