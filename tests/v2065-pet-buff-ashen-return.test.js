'use strict';
// 20.65 (лог 26.10 13:50–13:57): принятый возврат после баффа кота пришёл в Ashen, а returnSent ждал только map.html.
// Настоящие функции похода из content.js, локальные ответы и часы; живой игры и повторной оплаты нет.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const core=fs.readFileSync(process.env.L2_PET_RETURN_SOURCE||path.join(__dirname,'../content.js'),'utf8');
const source=core.slice(core.indexOf('// Поход за платным бафом:'),core.indexOf('const warlockShotContext ='));
assert.ok(source.includes('async function warlockTripReturn('),'извлекается настоящий код возврата');
const guard=core.slice(core.indexOf('function automationSnapshot()'),core.indexOf('async function automationFlush('));
const clone=x=>structuredClone(x);
function fixture(o={}){
 let now=1793000000000;
 const state={mode:'farm',hero:'Hero',challenge:null,ab:false,tvt:false,pvp:false,canAct:true,otherJob:false,
  url:'https://l2wap.com'+(o.page||'/ashen-bastion.html'),httpOk:true,saveOk:true,commitOk:true,commits:0,gets:[],posts:[],fires:[],nav:[],writes:[],status:[],hooks:{}};
 const location={get href(){return state.url},set href(value){state.nav.push(value);state.url=new URL(value,state.url).href},
  get pathname(){return new URL(state.url).pathname},set pathname(value){const u=new URL(state.url);u.pathname=value;state.url=u.href},
  get search(){return new URL(state.url).search},set search(value){const u=new URL(state.url);u.search=value;state.url=u.href},reload(){throw Error('возврат не требует перезагрузки')}};
 const J={id:'pet-trip',char:'Hero',revision:500,kick:7,t:now-150000,phase:'returnSent',
  entry:{job:'pet-trip',char:'Hero',revision:501,at:now-140000},
  home:{mode:'farm',zone:'ashen_bastion',catIn:null,catDungeon:null,path:'/map.html'},
  returnQuote:{kind:'zone',id:'ashen_bastion',price:0,revision:502,t:now-5000}};
 const snap={id:'hero-id',name:'Hero',l2Profession:'human_arcana_lord',classSlots:{activeSlot:0},revision:503,inBattle:false,
  cityId:'ashen_bastion',currentZoneId:null,activeDungeonId:null,adena:'20000000'};
 const ledger={status:'active',spent:10000000,purchases:1,pending:null,reason:'Полный бафф подтверждён'};
 const c={console,Date:class extends Date{static now(){return now}},URL,URLSearchParams,Number,JSON,Set,Promise,encodeURIComponent,
  crypto:{randomUUID:()=> 'pet-trip'},CSS:{escape:x=>x},on:true,tabOwner:true,leaseEpoch:'lease-1',automationGeneration:1,
  cfg:{petFullAuto:true,tvtOn:true,catDungeon:'saints',shopReserve:200000,shopMaxSpend:2000000},
  rt:{char:'Hero',classCur:{prof:'human_arcana_lord',slot:0},manualKickAt:7,petBufferTrip:J,petFull:clone(ledger)},
  location,CAT_URL:'/catacombs.html',document:{querySelectorAll:()=>[]},window:{postMessage(){}},
  heroNick:()=>state.hero,autonomyMode:()=>state.mode,modeSig:()=>state.mode,warlockCanRun:()=>!state.otherJob,
  antibotState:()=>state.challenge,abHold:()=>state.ab,isFishing:()=>false,fishState:()=>false,fishNow:()=>false,
  isBattle:()=>location.pathname==='/battle.html',victory:()=>false,shown:x=>!!x,heroAt:()=>null,
  setStatus:x=>state.status.push(x),rec(){},sleep:async()=>{},
  L2V7Modules:{actions:{canAct:()=>state.canAct,owns:()=>false},tvt:{tvtHold:()=>state.tvt},pvp:{pending:()=>state.pvp},
   warlock:{step:async()=>{state.posts.push('unexpected-buff-step');throw Error('повтор баффа запрещён')}}},
  $q:selector=>selector==='#map-dungeon-enter-link'?{getAttribute:k=>k==='href'?'/dungeon.html?dungeonId=saints':null}:null,
  fire:x=>{state.fires.push(x);return true},
  setRt:async p=>{state.writes.push(clone(p));Object.assign(c.rt,p);await state.hooks.save?.(p);return{ok:state.saveOk}},
  rtCommit:async()=>{state.commits++;await state.hooks.commit?.(state.commits);return state.commitOk},
  gamePost:async p=>{state.posts.push(p);throw Error('подтверждение возврата не отправляет POST')},
  gameGet:async p=>{state.gets.push(p);await state.hooks.get?.();return{ok:state.httpOk,status:state.httpOk?200:503,
   json:async()=>{await state.hooks.json?.();return clone(state.reply??{character:snap})}}}};
 vm.createContext(c);vm.runInContext(guard+source,c);
 const f={c,state,snap,J,ledger,now:()=>now,advance:ms=>now+=ms,run:()=>vm.runInContext('warlockTripReturn(rt.petBufferTrip)',c),
  original:()=>vm.runInContext('warlockTripReturn(__originalJob)',c)};
 c.__originalJob=J;
 f.noSpend=()=>{assert.deepEqual(state.posts,[],'нет повторной оплаты или POST');assert.deepEqual(c.rt.petFull,ledger,'квитанция/счётчик купленного баффа не меняются');assert.deepEqual(state.nav,[],'подтверждение не запускает новый перелёт')};
 return f;
}

test('Ashen: свежий собственный cityId после точного возврата освобождает поход без повторного телепорта',async()=>{
 const f=fixture();assert.equal(await f.run(),true);assert.equal(f.c.rt.petBufferTrip,null,'поход завершён на специальной странице Ashen');
 assert.deepEqual(f.state.gets,['/character']);assert.deepEqual(f.state.fires,[]);f.noSpend();
});

test('одного URL Ashen или currentZoneId недостаточно: нужен собственный подтверждённый cityId',async()=>{
 for(const change of [s=>delete s.cityId,s=>s.cityId='giran',s=>{delete s.cityId;s.currentZoneId='ashen_bastion'}]){
  const f=fixture();change(f.snap);await f.run();assert.ok(f.c.rt.petBufferTrip,'чужая/неподтверждённая локация не закрывает поход');assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
});

test('чужие цель или квитанция не подтверждаются специальной страницей Ashen',async()=>{
 for(const change of [j=>j.home.zone='varka',j=>j.returnQuote.id='varka',j=>j.returnQuote.kind='cat',j=>delete j.returnQuote,
  j=>delete j.returnQuote.revision,j=>j.returnQuote.revision=-1]){
  const f=fixture();change(f.J);await f.run();assert.ok(f.c.rt.petBufferTrip);assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
});

test('герой, класс, слот, состояние и новая revision проверяются по свежему серверному ответу',async()=>{
 const changes=[s=>s.name='Other',s=>delete s.name,s=>s.l2Profession='human_sorcerer',s=>delete s.l2Profession,
  s=>s.classSlots.activeSlot=1,s=>delete s.classSlots.activeSlot,s=>delete s.classSlots,s=>s.inBattle=true,s=>delete s.inBattle,
  s=>s.revision=502,s=>s.revision=501,s=>delete s.revision,s=>s.revision=-1,s=>s.revision=503.5,s=>s.revision='503'];
 for(const change of changes){const f=fixture();change(f.snap);await f.run();assert.ok(f.c.rt.petBufferTrip);assert.deepEqual(f.state.fires,[]);f.noSpend();}
});

test('отказ HTTP/JSON или исключение чтения не закрывает returnSent и не повторяет оплату',async()=>{
 for(const change of [f=>f.state.httpOk=false,f=>f.state.reply={error:'failed',character:f.snap},f=>f.state.reply={ok:false,character:f.snap},
  f=>f.state.reply={},f=>f.state.hooks.get=()=>{throw Error('offline')},f=>f.state.hooks.json=()=>{throw Error('bad-json')}]){
  const f=fixture();change(f);await f.run();assert.ok(f.c.rt.petBufferTrip);assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
});

test('Stop, lease, kick, страница, режим и антибот отменяют подтверждение после каждого ожидания',async()=>{
 const changes={Stop:f=>f.c.on=false,owner:f=>f.c.tabOwner=false,lease:f=>f.c.leaseEpoch='lease-other',kick:f=>f.c.rt.manualKickAt++,
  hero:f=>f.state.hero='Other',character:f=>f.c.rt.char='Other',class:f=>f.c.rt.classCur.prof='human_sorcerer',slot:f=>f.c.rt.classCur.slot=1,
  page:f=>f.c.location.pathname='/char.html',map:f=>f.c.location.pathname='/map.html',search:f=>f.c.location.search='?other=1',mode:f=>f.state.mode='raid',antibot:f=>f.state.challenge='check',
  ab:f=>f.state.ab=true,canAct:f=>f.state.canAct=false,tvt:f=>f.state.tvt=true,generation:f=>f.c.automationGeneration++,
  job:f=>f.c.rt.petBufferTrip={...f.J,id:'new-trip'}};
 for(const stage of ['commit','get','json','save'])for(const[name,change]of Object.entries(changes)){
  const f=fixture();f.state.hooks[stage]=()=>change(f);await f.run();assert.ok(f.c.rt.petBufferTrip,stage+'/'+name+' сохраняет поход');
  assert.equal(f.state.writes.filter(p=>p.petBufferTrip===null).length,0,stage+'/'+name+' не стирает состояние после отмены');assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
});

test('неподтверждённый flush/запись не дают снять удерживающий поход',async()=>{
 for(const change of [f=>f.state.commitOk=false,f=>f.state.saveOk=false]){
  const f=fixture();change(f);await f.run();assert.equal(f.c.rt.petBufferTrip?.phase,'returnSent');
  f.advance(3100);await f.run();assert.equal(f.c.rt.petBufferTrip?.phase,'returnSent','следующий tick не обходит неуспешное сохранение через returned');
  assert.equal(f.state.writes.filter(p=>p.petBufferTrip===null).length,0);f.noSpend();
 }
});

test('контекст перепроверяется и после второго flush, повторно подтверждающего сохранение похода',async()=>{
 const changes={Stop:f=>f.c.on=false,lease:f=>f.c.leaseEpoch='other-lease',kick:f=>f.c.rt.manualKickAt++,page:f=>f.c.location.pathname='/char.html',map:f=>f.c.location.pathname='/map.html',
  mode:f=>f.state.mode='raid',antibot:f=>f.state.challenge='check',canAct:f=>f.state.canAct=false,job:f=>f.c.rt.petBufferTrip={...f.J,id:'new-trip'}};
 for(const[name,change]of Object.entries(changes)){
  const f=fixture();f.state.hooks.commit=n=>{if(n===2)change(f)};await f.run();
  assert.ok(f.state.commits>=2,'проверка достигла второго flush');assert.ok(f.c.rt.petBufferTrip,name+' сохраняет поход после поздней отмены');
  assert.equal(f.state.writes.filter(p=>p.petBufferTrip===null).length,0);assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
 const f=fixture();f.state.hooks.commit=n=>{if(n===2)f.state.commitOk=false};await f.run();
 assert.equal(f.c.rt.petBufferTrip?.phase,'returnSent','отказ второго flush запрещает очистку');f.advance(3100);await f.run();
 assert.equal(f.c.rt.petBufferTrip?.phase,'returnSent','следующий tick также ждёт подтверждение');assert.equal(f.state.writes.filter(p=>p.petBufferTrip===null).length,0);f.noSpend();
});

test('неудачная окончательная очистка остаётся в настоящей очереди записи и досылается без повторной оплаты',async()=>{
 const engine={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../engine-core.js'),'utf8'),engine);
 const f=fixture(),disk={petBufferTrip:clone(f.J)};let rejectClear=true;
 const writer=engine.L2EngineCore.createPatchQueue(async patch=>{
  if(patch.petBufferTrip===null&&rejectClear)return{ok:false,reason:'fixture_storage'};
  Object.assign(disk,clone(patch));return{ok:true};
 },()=>true,()=>{},()=>f.now());
 f.c.setRt=async p=>{f.state.writes.push(clone(p));Object.assign(f.c.rt,p);return writer.enqueue(p)};
 f.c.rtCommit=async()=>{f.state.commits++;return(await writer.recover()).ok===true};
 await f.run();assert.equal(f.c.rt.petBufferTrip,null,'локальная память меняется до ACK, как в setRt');
 assert.equal(disk.petBufferTrip.phase,'returnSent','непринятая очистка ещё не изменила хранилище');
 assert.ok(Object.hasOwn(writer.peek(),'petBufferTrip'));assert.equal(writer.peek().petBufferTrip,null,'намерение очистки не потеряно после отказа');
 f.noSpend();assert.deepEqual(f.state.fires,[]);rejectClear=false;f.advance(3100);
 assert.equal((await writer.recover()).ok,true);assert.equal(disk.petBufferTrip,null);assert.deepEqual(Object.keys(writer.peek()),[]);f.noSpend();
});

test('замена похода с тем же id или изменение квитанции во время GET не подтверждают прежнюю цель',async()=>{
 const changes=[f=>f.c.rt.petBufferTrip={...f.J,home:{...f.J.home,zone:'varka'}},
  f=>f.c.rt.petBufferTrip={...f.J,returnQuote:{...f.J.returnQuote,id:'varka'}},
  f=>f.c.rt.petBufferTrip={...f.J,returnQuote:{...f.J.returnQuote,revision:504}},
  f=>{f.J.returnQuote.id='varka'},f=>{f.J.returnQuote.revision=504}];
 for(const change of changes){const f=fixture();f.state.hooks.get=()=>change(f);await f.run();
  assert.ok(f.c.rt.petBufferTrip);assert.equal(f.state.writes.filter(p=>p.petBufferTrip===null).length,0);assert.deepEqual(f.state.fires,[]);f.noSpend();
 }
});

test('неподтверждённый возврат опрашивается с паузой, а после неё сверка возобновляется',async()=>{
 const f=fixture();f.state.httpOk=false;await f.run();assert.equal(f.state.gets.length,1);
 for(let i=0;i<12;i++)await f.run();assert.equal(f.state.gets.length,1,'быстрые ticks не повторяют GET');
 f.advance(1500);await f.run();assert.equal(f.state.gets.length,1,'через 1,5 с нового чтения ещё нет');
 f.advance(1499);await f.run();assert.equal(f.state.gets.length,1,'пауза не короче 3 с');
 f.advance(1);await f.run();assert.equal(f.state.gets.length,2,'ровно после паузы повторяется только сверка');
 assert.ok(f.c.rt.petBufferTrip);assert.deepEqual(f.state.fires,[]);f.noSpend();
});

test('прежний возврат обычной зоны на map.html завершается без платного клика',async()=>{
 const f=fixture({page:'/map.html'});f.J.home.zone='varka';f.J.returnQuote.id='varka';await f.run();assert.equal(f.c.rt.petBufferTrip,null);assert.deepEqual(f.state.fires,[]);f.noSpend();
});

test('прежний возврат к катакомбам сохраняет отдельный вход и серверное подтверждение',async()=>{
 const f=fixture({page:'/map.html'});f.state.mode='cat';Object.assign(f.J.home,{mode:'cat',zone:null,catIn:'saints',catDungeon:'saints'});Object.assign(f.J.returnQuote,{kind:'cat',id:'saints'});
 await f.run();assert.equal(f.c.rt.petBufferTrip.phase,'returnEnter');assert.equal(f.state.fires.length,1,'родной бесплатный вход в катакомбы сохранён');
 f.c.location.pathname='/dungeon.html';f.c.location.search='?dungeonId=saints';f.snap.activeDungeonId='saints';await f.run();assert.equal(f.c.rt.petBufferTrip,null);f.noSpend();
});
