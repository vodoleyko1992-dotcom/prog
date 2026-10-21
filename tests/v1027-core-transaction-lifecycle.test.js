'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
function load(name,env,globals={}){const box={console,URL,URLSearchParams,Date,...globals};vm.runInNewContext(read('modules/'+name+'.js'),box);return box.L2V7Factories[name](env)}
// 20.43 (ревью au/travel): квитанция перелёта — в отдельном rt.travelCheck (маршрут zoneGo снят той же записью до клика), её сверку
// ведёт ядро раньше диспетчера (content.loopTravel → navigation.travelStep) — tick повторяет этот порядок; проверки прежние
function teleportFixture(o={}){
 let href='/teleport.html',payments=0,disk={},rev=10;
 const loc={get href(){return href},set href(v){href=v},get pathname(){return href.split('?')[0]},get search(){return href.includes('?')?'?'+href.split('?')[1]:''}};
 const row={textContent:'50 000 аден',querySelector:s=>s.includes('currency')?{textContent:'аден',querySelectorAll:()=>[]}:s.includes('price-num')?{textContent:'50 000'}:null};
 const button={closest:()=>row},ch={id:'hero-1',name:'Hero',revision:10,adena:1000000,currentZoneId:null,cityId:'l2dop_dion',inBattle:false,activeDungeonId:null};
 const e={on:true,tabOwner:true,cfg:{shopReserve:200000},rt:{char:'Hero',zoneGo:{id:o.id||'cruma_marshlands',t:1},zoneCat:{cruma_marshlands:{name:'Cruma'}}},
  mode:()=> 'farm',lease:()=> 'lease-1',page:()=>loc.href,id:()=> 'owner-1',interrupted:()=>false,isBattle:()=>false,paymentPending:()=>null,
  setRt:async p=>{Object.assign(e.rt,p);disk=clone(e.rt);return {ok:true}},rtCommit:async()=>!(o.flushFail&&e.rt.travelCheck?.nativeTp),rec(){},setStatus(){},halt:async()=>{e.on=false},
  heroLvl:()=>38,shown:()=>true,$q:()=>button,sleep:async()=>{},waitX:async f=>f(),pauseBot:async()=>{e.on=false},
  gameGet:async()=>({ok:true,json:async()=>({character:{...ch}})}),
  fire:()=>{payments++;ch.revision=++rev;ch.adena-=50000;if(!o.noArrival)ch.currentZoneId='cruma_marshlands';if(o.receipt){const p=e.rt.travelCheck.nativeTp;N.onForumTeleportNet('/game/teleport',{method:'POST',status:200,nativeNonce:o.badNonce?'old':p.nonce,req:{teleportId:p.id,expectedRevision:rev-1,expectedAdenaCost:50000},res:{character:{...ch}}});}if(!o.noNavigation)loc.href='/map.html';return true}
 };
 const globals={location:loc,document:{querySelectorAll:()=>[{}],body:{innerText:''}}};
 let N=load('navigation',e,globals),A;e.jobs=()=>[{key:'zoneGo',run:()=>N.zoneGoStep()}];A=load('actions',e);e.canAct=()=>A.canAct();
 return{e,ch,loc,clicks:()=>payments,disk:()=>disk,async tick(){A.enterFrame();if(N.travelPending()){await N.travelStep();return true;}return A.dispatch()},reload(){e.on=true;e.rt=clone(disk);N=load('navigation',e,globals);A=load('actions',e)}};
}
// 20.43 (автономность, доводка 21.10): ревизия выросла и адены убыло на цену телепорта — вывод «оплата прошла» (navigation.travelPaid):
// квитанция закрыта, прибытие записано, повтора нет. Прежние проверки «потерянный/чужой ACK, город — не доказательство» оставлены
// для GET без адены (noAdenaAfterClick: вывода нет, квитанция и запрет повторной оплаты остаются); с аденой — проверяется, что вывод
// сделан по адене, а не по чужому ACK или городу (нет «прибытие подтверждено сервером»)
function noAdenaAfterClick(f){const get=f.e.gameGet;f.e.gameGet=async(...a)=>{const r=await get(...a);if(!f.clicks())return r;const j=await r.json();return{ok:true,json:async()=>({character:{...j.character,adena:undefined}})}};}
const logOf=f=>{const lines=[];f.e.rec=(...a)=>lines.push(a.join(' | '));return lines;};
test('обычный платный телепорт → native map → dispatcher: одна оплата и завершённый маршрут',async()=>{
 const f=teleportFixture();await f.tick();await f.tick();await f.tick();assert.equal(f.clicks(),1);assert.equal(f.e.rt.zoneGo,null);assert.equal(f.loc.pathname,'/map.html');
});
test('ошибка durable intent запрещает обычный платный телепорт',async()=>{
 const f=teleportFixture({flushFail:true});await f.tick();assert.equal(f.clicks(),0);
});
function paymentFixture(){
 let hold=false,release,enteredResolve;const entered=new Promise(r=>enteredResolve=r);
 const e={on:true,tabOwner:true,rt:{char:'Hero'},autonomyMode:()=> 'raid',setRt:async p=>{Object.assign(e.rt,p);return {ok:true}},rtCommit:async()=>{if(hold){hold=false;enteredResolve();return new Promise(r=>release=r)}return true},rec(){}};
 const P=load('payments',e);return{e,P,hold:()=>{hold=true},entered,release:v=>release(v)};
}
const spec={key:'shop:first',kind:'shop',quote:{amount:100,currency:'Adena'}};
test('подтверждение → задержанный flush: новая оплата ждёт, rollback не стирает чужое намерение',async()=>{
 const f=paymentFixture(),first=await f.P.prepare(spec);assert.ok(f.P.sent(first));assert.ok(f.P.consumePermit());f.hold();
 const confirm=f.P.confirm(first,{kind:'receipt'});await f.entered;
 const next=await f.P.prepare({...spec,key:'shop:second'});f.release(false);await confirm;
 assert.equal(next,null,'до durable подтверждения вторую оплату не выдаём');assert.equal(f.P.pending()?.id,first.id);
});
test('смена персонажа при неуспешном flush подтверждения не восстанавливает чужую квитанцию',async()=>{
 const f=paymentFixture(),first=await f.P.prepare(spec);f.P.sent(first);f.P.consumePermit();f.hold();const confirm=f.P.confirm(first,{kind:'receipt'});await f.entered;
 f.e.rt={char:'Other',actionPayments:{history:[{id:'other'}]}};f.release(false);await confirm;
 assert.equal(f.e.rt.actionPayments.pending,undefined);assert.equal(f.e.rt.actionPayments.history[0].id,'other');
});
function lockFixture(){
 const src=read('background.js'),state={on:true,rt:{char:'Hero'}};let id=0;
 const box={Date,URL,console,crypto:{randomUUID:()=>String(++id)},noteAlive:async()=>{},chrome:{storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,clone(state[k]??null)])),set:async p=>Object.assign(state,clone(p))}},tabs:{update:async()=>{},sendMessage:async()=>{}}}};
 vm.runInNewContext(src.slice(src.indexOf('const LOCK_TTL ='),src.indexOf('// A single process'))+'\nthis.lock=lockCommand',box);
 return{state,call:m=>box.lock(m,{frameId:0,url:'https://l2wap.com/map.html',tab:{id:1,active:true}})};
}
test('reload сменил epoch: запоздалый acquire старого документа не отбирает нового владельца',async()=>{
 const f=lockFixture(),req={cmd:'lockAcquire',vis:true,focus:true},old=await f.call(req),fresh=await f.call(req);
 const stale=await f.call({...req,epoch:old.epoch});assert.equal(stale.ok,false);assert.equal(f.state.lock.epoch,fresh.epoch);
});

// 20.43 (автономность, разбор 21.10): неизвестный исход — сверка по серверу без паузы (бот включён); повторного платежа по-прежнему нет
test('потерянный ACK и непроверенная карта → сверка без паузы → reload: повторного платежа нет',async()=>{
 const f=teleportFixture({noArrival:true});noAdenaAfterClick(f);await f.tick();assert.equal(f.clicks(),1);assert.equal(f.e.on,true);assert.ok(f.e.rt.travelCheck.nativeTp);assert.equal(f.e.rt.travelCheck.check.n,1);f.reload();await f.tick();assert.equal(f.clicks(),1);assert.equal(f.e.on,true);assert.ok(f.e.rt.travelCheck.nativeTp);
 // 20.43 (доводка 21.10): адены убыло на цену — «оплата прошла» с первой сверки, прибытие записано; после reload второго клика нет
 const g=teleportFixture({noArrival:true});const lines=logOf(g);await g.tick();assert.equal(g.clicks(),1);assert.equal(g.e.on,true);assert.equal(g.e.rt.travelCheck,null);assert.equal(g.e.rt.zone,'cruma_marshlands');
 assert.ok(lines.some(l=>/адены убыло на цену телепорта.+оплату считаю прошедшей/.test(l)));g.reload();await g.tick();await g.tick();assert.equal(g.clicks(),1);
});
test('обычная world-зона с currentZoneId=null подтверждается exact native ACK',async()=>{
 const f=teleportFixture({noArrival:true,receipt:true});await f.tick();assert.equal(f.clicks(),1);assert.equal(f.e.rt.zoneGo,null);assert.equal(f.e.on,true);
});
// 20.43: вместо паузы — сверка (бот включён), маршрут не завершён
test('запоздалый ACK другого native intent не завершает маршрут',async()=>{
 const f=teleportFixture({noArrival:true,receipt:true,badNonce:true});noAdenaAfterClick(f);await f.tick();assert.equal(f.clicks(),1);assert.ok(f.e.rt.travelCheck.nativeTp);assert.equal(f.e.on,true);assert.ok(f.e.rt.travelCheck.check);
 // 20.43 (доводка 21.10): с аденой вывод — по адене («оплата прошла»), а не по чужому ACK: «прибытие подтверждено сервером» нет
 const g=teleportFixture({noArrival:true,receipt:true,badNonce:true});const lines=logOf(g);await g.tick();assert.equal(g.clicks(),1);assert.equal(g.e.rt.travelCheck,null);
 assert.ok(lines.some(l=>/адены убыло на цену телепорта/.test(l)));assert.ok(!lines.some(l=>/прибытие подтверждено сервером/.test(l)),'чужой ACK не засчитан');
});
for(const change of ['stop','char','mode','lease'])test('изменение '+change+' во время durable intent запрещает клик',async()=>{
 const f=teleportFixture();f.e.rtCommit=async()=>{if(f.e.rt.travelCheck?.nativeTp){if(change==='stop')f.e.on=false;if(change==='char')f.e.rt={char:'Other'};if(change==='mode')f.e.rt.manualKickAt=100;if(change==='lease')f.e.lease=()=> 'lease-2';}return true};
 await f.tick();assert.equal(f.clicks(),0);
});

test('подготовленное разрешение оплаты не переживает смену lease',async()=>{const f=paymentFixture();f.e.lease=()=> 'one';const p=await f.P.prepare(spec);assert.ok(p);f.e.lease=()=> 'two';assert.equal(f.P.sent(p),false);assert.equal(f.P.consumePermit(),false)});

test('контент не забывает retired epoch и не отбирает новый документ при повторном acquire',async()=>{
 const f=lockFixture(),old=await f.call({cmd:'lockAcquire',vis:true,focus:true}),src=read('content.js');
 const box={TAB_KEY_READY:Promise.resolve(),ipc:f.call,leaseEpoch:old.epoch,location:{pathname:'/map.html'},tabVis:()=>true,document:{hasFocus:()=>true},Date};
 vm.runInNewContext(src.slice(src.indexOf('let lockMine ='),src.indexOf('setInterval(async () => {',src.indexOf('let lockMine ='))),box);
 assert.equal(await box.tabLock(),true);const fresh=await f.call({cmd:'lockAcquire',vis:true,focus:true});
 assert.equal(await box.tabLock(),false);assert.equal(await box.tabLock(),false);assert.equal(f.state.lock.epoch,fresh.epoch);
});
test('lease сменился при failed confirmation flush: платёж остаётся неизвестным до durable retry',async()=>{
 const f=paymentFixture();let lease='one';f.e.lease=()=>lease;const p=await f.P.prepare(spec);f.P.sent(p);f.P.consumePermit();f.hold();const confirm=f.P.confirm(p,{kind:'receipt'});await f.entered;lease='two';f.release(false);assert.equal(await confirm,false);
 assert.equal(await f.P.prepare({...spec,key:'second'}),null);assert.equal(f.P.pending()?.id,p.id);
 assert.equal(await f.P.confirm(p,{kind:'receipt'}),true);assert.equal(f.P.pending(),null);assert.ok(await f.P.prepare({...spec,key:'second'}));
});

test('BFCache восстановление перечитывает runtime в новом документе, обычный pageshow не трогает lease',()=>{
 const src=read('content.js'),listeners={},calls=[];const box={addEventListener:(n,f)=>listeners[n]=f,tabOwner:true,tabIdle:false,leaseEpoch:'old',rtWriter:{clear:()=>calls.push('clear')},location:{reload:()=>calls.push('reload')}};
 const a=src.indexOf('let pageLeaving = false;'),end=src.indexOf("});",src.indexOf("addEventListener('pageshow'",a))+3;vm.runInNewContext(src.slice(a,end),box);
 listeners.pageshow({isTrusted:true,persisted:false});assert.equal(box.leaseEpoch,'old');listeners.pageshow({isTrusted:false,persisted:true});assert.equal(box.tabOwner,true);
 listeners.pageshow({isTrusted:true,persisted:true});assert.equal(box.tabOwner,false);assert.equal(box.leaseEpoch,null);assert.deepEqual(calls,['clear','reload']);
});

// 20.43: вместо паузы — сверка (бот включён); тот же город до и после клика не считается «герой уже в другом месте»
test('город Heine не доказывает точную обычную локацию при lost ACK',async()=>{const f=teleportFixture({id:'heine',noArrival:true});f.ch.cityId='l2dop_heine';noAdenaAfterClick(f);await f.tick();assert.equal(f.clicks(),1);assert.ok(f.e.rt.travelCheck.nativeTp);assert.equal(f.e.on,true);assert.ok(f.e.rt.travelCheck.check);
 // 20.43 (доводка 21.10): с аденой — «оплата прошла» по адене (не «прибытие подтверждено» по городу); повторного клика нет
 const g=teleportFixture({id:'heine',noArrival:true});g.ch.cityId='l2dop_heine';const lines=logOf(g);await g.tick();assert.equal(g.clicks(),1);assert.equal(g.e.rt.travelCheck,null);
 assert.ok(lines.some(l=>/адены убыло на цену телепорта/.test(l)));assert.ok(!lines.some(l=>/прибытие подтверждено сервером/.test(l)),'город не засчитан прибытием');});
