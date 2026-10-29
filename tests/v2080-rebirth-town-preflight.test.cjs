'use strict';
// Лог29.10 14:39: после моба300 бот ушёл за баффом кота в город и застрял в missing-run. Город — только до нового входа.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture:warlockFixture}=require('./warlock-fixture.cjs');
const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const same=(a,b,msg)=>assert.equal(JSON.stringify(a),JSON.stringify(b),msg);
function load(name){const file=path.join(__dirname,name),s=fs.readFileSync(file,'utf8'),cut=s.indexOf("\ntest('");assert.ok(cut>0);
 const c={require:require('node:module').createRequire(file),__dirname,path,console,URL,URLSearchParams,Date,structuredClone,process};
 vm.runInNewContext(s.slice(0,cut)+'\nthis.make=fixture;',c);return c.make;}
const core=load('v2073-rebirth-hero-core.test.cjs'),runtime=load('v2068-rebirth-runtime.test.cjs');
function own(o={}){
 const f=warlockFixture({...o,cfg:{petFullAuto:false,petAuto:false,...o.cfg}}),trips=[],nav=[];
 const raw={petFullAuto:true,petFullMaxPrice:10000000,petFullReserve:null,petFullRenew:true,shopReserve:200000,...o.raw};
 f.env.leaseEpoch='owner';f.env.canAct=()=>true;f.env.canRun=()=>true;f.env.rebirthCfg=()=>raw;
 f.env.townBufferStart=async p=>{trips.push(p);return true;};f.env.nativeNavigate=p=>nav.push(p);
 return{...f,trips,nav,prep:options=>f.api().rebirthPrepare({wanted:()=>true,returnPath:'/rebirth-raids.html',...options})};
}

for(const allowTown of [undefined,false])test('по умолчанию/allowTown='+allowTown+' полный набор не оплачивается посреди run',async()=>{
 const f=own(),before=f.ch.adena;await f.prep(allowTown===undefined?{}:{allowTown});
 same(f.calls,[]);same(f.trips,[]);same(f.nav,[]);same(f.gets,[],'каталог платного набора внутри run не читается');assert.equal(f.ch.adena,before);
});
test('allowTown=false не начинает поездку, даже когда покупка доступна только в городе',async()=>{
 const f=own();f.env.townBufferReady=()=>false;assert.equal(await f.prep({allowTown:false}),false);
 same(f.calls,[]);same(f.trips,[]);same(f.nav,[]);
});
test('allowTown=true перед новым входом сохраняет прежнюю разрешённую покупку',async()=>{
 const f=own();await f.prep({allowTown:true});assert.equal(f.calls.length,1);assert.equal(f.status(),'active');
 assert.equal(f.calls[0].body.expectedFeeAdena,'10000000');assert.equal(f.calls[0].body.expectedFeeCoinOfLuck,0);
});
test('allowTown=true сохраняет прежнюю поездку при необходимости подтверждённого входа в город',async()=>{
 const f=own();f.env.townBufferReady=()=>false;await f.prep({allowTown:true});assert.equal(f.trips.length,1);same(f.calls,[]);
});
test('неизвестная оплата и история сохраняются, но allowTown=false не повторяет покупку',async()=>{
 const f=own({post:()=>{throw Error('lost_response');}});await f.prep({allowTown:true});
 assert.equal(f.calls.length,1);assert.ok(f.env.rt.petFull.pending);const before=structuredClone(f.env.rt.petFull),reads=f.gets.length;
 f.tick(61000);await f.prep({allowTown:false});assert.equal(f.calls.length,1);same(f.env.rt.petFull,before);
 assert.equal(f.gets.length,reads,'отдельная сверка неизвестной оплаты остаётся прежнему обработчику');
});
test('родной призыв остаётся доступен внутри run при allowTown=false',async()=>{
 const f=own({cfg:{petAuto:true,petBuffAuto:false,nPetBuffs:''},char:{activeSummon:null,mp:5000}});let page='/rebirth-raid-dungeon.html';
 f.env.nativePanelPath=()=>page;f.env.nativeNavigate=p=>{f.nav.push(p);page=p;};f.env.nativeReturnPath=()=>'/map.html';
 assert.equal(await f.prep({allowTown:false}),true);same(f.nav,['/skill-panel.html']);assert.equal(f.env.rt.petPrep.back,'/rebirth-raids.html');
 same(f.calls,[]);same(f.trips,[]);
});

for(const allowTown of [undefined,false,true])test('ядро передаёт в суммона отдельное разрешение города: '+allowTown,async()=>{
 const f=core(),seen=[];f.ch.hp=f.ch.maxHp;
 f.c.L2V7Modules.warlock.rebirthPrepare=async p=>{seen.push(p);return false;};
 await f.c.rebirthPreparePet({character:f.ch,...(allowTown===undefined?{}:{allowTown})});
 assert.equal(seen.length,1);assert.equal(seen[0].allowTown,allowTown===true);assert.equal(seen[0].returnPath,'/rebirth-raids.html');
});

test('допуск нового входа разрешает город, допуск текущего run явно запрещает его',async()=>{
 const begin=content.indexOf('L2V7Modules.rebirth = L2V7Factories.rebirth({'),end=content.indexOf('\n});',begin);
 assert.ok(begin>=0&&end>begin);const seen=[],c={L2V7Modules:{},L2V7Factories:{rebirth:env=>env},rebirthPreparePet:async p=>{seen.push(p);return false;}};
 vm.runInNewContext(content.slice(begin,end+4),c);const character={id:'own-actor'};
 await c.L2V7Modules.rebirth.prepareEntry({character,allowTown:false});await c.L2V7Modules.rebirth.prepareRun({character,allowTown:true});
 assert.equal(seen.length,2);assert.equal(seen[0].allowTown,true);assert.equal(seen[1].allowTown,false);
 assert.equal(seen[0].character,character);assert.equal(seen[1].character,character);
});

test('fresh missing-run снимает старую собственную поездку, но не разрешает повторный платный вход',async()=>{
 const RUN='11111111-1111-4111-8111-111111111111';
 const f=runtime({page:'/city.html',noRun:true,cfg:{rebirthAutoEnter:true},rt:{manualKickAt:1,rebirth:{observedRun:{id:RUN,char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:1}}}});
 let cancelled=0;f.env.cancelRunPreparation=async p=>{cancelled++;assert.equal(p.character.id,'own-actor');return false;};
 await f.step();assert.equal(cancelled,1);assert.equal(f.env.rt.rebirth.phase,'missing-run');same(f.clicks,[]);same(f.posts,[]);assert.equal(f.S.entries,0);assert.equal(f.S.keys,100);
});
test('missing-run при неизвестном исходе отмены ждёт и не вызывает подготовку нового входа',async()=>{
 const RUN='11111111-1111-4111-8111-111111111111';
 const f=runtime({page:'/city.html',noRun:true,cfg:{rebirthAutoEnter:true},rt:{manualKickAt:1,rebirth:{observedRun:{id:RUN,char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:1}}}});
 let cancelled=0,entries=0;f.env.cancelRunPreparation=async()=>{cancelled++;return true;};f.env.prepareEntry=async()=>{entries++;return false;};
 await f.step();assert.equal(cancelled,1);assert.equal(entries,0);assert.equal(f.S.entries,0);same(f.clicks,[]);same(f.posts,[]);assert.equal(f.S.keys,100);
});

function legacy(o={}){
 const f=core(o);f.ch.hp=f.ch.maxHp;f.c.cfg.petFullAuto=true;
 const a=content.indexOf('const rebirthPetTrip = '),b=content.indexOf('const petFullAllowed = ',a);assert.ok(a>=0&&b>a);
 vm.runInNewContext(content.slice(a,b).replace('const rebirthPetTrip = ','this.rebirthPetTrip = '),f.c);
 const J={id:'legacy-trip',rebirth:true,char:'Hero',prof:'human_wizard',slot:0,kick:5,revision:90,phase:'city',price:10000000,
  home:{mode:'rebirth',path:'/rebirth-raids.html'}};
 f.c.rt.petBufferTrip=J;f.c.rt.rebirth={actor:'own-actor',runId:'11111111-1111-4111-8111-111111111111'};
 f.c.rt.petFull={status:'active',spent:20000000,lifetimeSpent:30000000,purchases:3,lastReceipt:{id:'paid-before-run',revision:80,expiresAt:f.now()+3600000}};
 return{...f,J,cancel:()=>{assert.equal(typeof f.c.rebirthCancelRunPreparation,'function','настоящая отмена старой поездки найдена');return f.c.rebirthCancelRunPreparation({character:f.ch});}};
}
for(const phase of ['city','pay','return'])test('своя старая поездка '+phase+' снимается без города, покупки и изменения истории',async()=>{
 const f=legacy();f.J.phase=phase;const history=structuredClone(f.c.rt.petFull),page=f.location.href;
 assert.equal(await f.cancel(),false);assert.equal(f.c.rt.petBufferTrip,null);same(f.c.rt.petFull,history);
 assert.equal(f.location.href,page);assert.ok(!f.events.includes('pet-trip'));assert.ok(!f.events.includes('pet'));
 assert.ok(f.writes.some(p=>p.petBufferTrip===null));
});
test('native-подготовка текущего run сначала отменяет старую поездку, затем готовит кота без города',async()=>{
 const f=legacy(),seen=[];f.c.L2V7Modules.warlock.rebirthPrepare=async p=>{seen.push(p);return false;};
 assert.equal(await f.c.rebirthPreparePet({character:f.ch,allowTown:false}),false);assert.equal(f.c.rt.petBufferTrip,null);
 assert.ok(!f.events.includes('pet-trip'));assert.equal(seen.length,1);assert.equal(seen[0].allowTown,false);
});
test('неподтверждённая отмена старой поездки удерживает бой без native-подготовки',async()=>{
 const f=legacy({saveOk:false});assert.equal(await f.c.rebirthPreparePet({character:f.ch,allowTown:false}),true);
 assert.equal(f.c.rt.petBufferTrip,f.J);assert.ok(!f.events.includes('pet'));assert.ok(!f.events.includes('pet-trip'));
});
for(const pending of ['payment','blocked','summon'])test('неизвестная оплата '+pending+' удерживает поездку и историю без новой покупки',async()=>{
 const f=legacy();if(pending==='payment')f.S.payment={id:'unknown-payment',kind:'town-buff'};
 if(pending==='blocked')f.S.pending=true;if(pending==='summon')f.c.rt.petFull.pending={id:'unknown-summon',phase:'sent'};
 const before=structuredClone(f.c.rt.petFull);assert.equal(await f.cancel(),true);assert.equal(f.c.rt.petBufferTrip,f.J);same(f.c.rt.petFull,before);
 assert.equal(f.writes.length,0);assert.ok(!f.events.includes('pet-trip'));
});
for(const change of ['actor','name','prof','slot','level','revision','inBattle','hp','emptyActor'])test('отмена требует свежего своего героя: '+change,async()=>{
 const f=legacy();if(change==='actor')f.ch.id='other-actor';if(change==='name')f.ch.name='Other';if(change==='prof')f.ch.l2Profession='other';
 if(change==='slot')f.ch.classSlots.activeSlot=1;if(change==='level')f.ch.level++;if(change==='revision')f.ch.revision=89;
 if(change==='inBattle')f.ch.inBattle=true;if(change==='hp')f.ch.hp=0;if(change==='emptyActor')f.ch.id='';
 assert.equal(await f.cancel(),true);assert.equal(f.c.rt.petBufferTrip,f.J);assert.equal(f.writes.length,0);assert.ok(!f.events.includes('pet-trip'));
});
for(const change of ['foreign','char','prof','slot','kick'])test('чужая или устаревшая поездка не присваивается отменой Rebirth: '+change,async()=>{
 const f=legacy();if(change==='foreign')f.J.rebirth=false;if(change==='char')f.J.char='Other';if(change==='prof')f.J.prof='other';
 if(change==='slot')f.J.slot=1;if(change==='kick')f.J.kick=4;
 assert.equal(await f.cancel(),false);assert.equal(f.c.rt.petBufferTrip,f.J);assert.equal(f.writes.length,0);
});
for(const change of ['stop','owner','mode','lease','generation','page','class','slot','kick','replacement'])test('отмена после commit не стирает состояние при смене '+change,async()=>{
 const f=legacy(),replacement={...f.J,id:'new-trip'};
 f.S.hooks.commit=()=>{if(change==='stop')f.c.on=false;if(change==='owner')f.c.tabOwner=false;if(change==='mode')f.S.mode=false;
  if(change==='lease')f.c.leaseEpoch='new-lease';if(change==='generation')f.S.generation++;if(change==='page')f.location.href='/map.html';
  if(change==='class')f.c.rt.classCur.prof='other';if(change==='slot')f.c.rt.classCur.slot=1;if(change==='kick')f.c.rt.manualKickAt++;
  if(change==='replacement')f.c.rt.petBufferTrip=replacement;
 };
 await f.cancel();assert.equal(f.c.rt.petBufferTrip,change==='replacement'?replacement:f.J);assert.equal(f.writes.length,0);
 assert.ok(!f.events.includes('pet-trip'));assert.ok(!f.events.includes('pet'));
});
test('отказ storage ACK после локального null возвращает только собственную поездку',async()=>{
 const f=legacy({saveOk:false,localBeforeAck:true});f.c.rtCommit=async()=>true;
 assert.equal(await f.cancel(),true);same(f.c.rt.petBufferTrip,f.J);same(f.c.rt.petFull.lastReceipt,{id:'paid-before-run',revision:80,expiresAt:f.now()+3600000});
 assert.ok(f.writes.some(p=>p.petBufferTrip===null));assert.ok(f.writes.some(p=>p.petBufferTrip?.id===f.J.id));
});
test('замена поездки во время записи null не затирается откатом',async()=>{
 const f=legacy({saveOk:false,localBeforeAck:true}),replacement={...f.J,id:'new-trip'};f.c.rtCommit=async()=>true;
 f.S.hooks.save=p=>{if(p.petBufferTrip===null)f.c.rt.petBufferTrip=replacement;};
 assert.equal(await f.cancel(),true);assert.equal(f.c.rt.petBufferTrip,replacement);assert.equal(f.writes.length,1);
});
