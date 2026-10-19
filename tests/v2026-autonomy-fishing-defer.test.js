'use strict';
// 19.10, автономность: недоступная рыбалка уступает явно выбранной работе, не теряя улов, оплату или настройки.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {world}=require('./v1014-fishing-controls.test.js');
const engine=fs.readFileSync(path.join(__dirname,'../engine-core.js'),'utf8');
function fixture(autoTasks=['fish','auto']){
 const W=world({cfg:{autoTasks,fishMode:true,fishTimeAuto:false}}),e=W.env;
 vm.runInNewContext(engine,W.box);const E=W.E=W.box.L2EngineCore;W.raw=e.cfg;
 Object.assign(e.rt,{char:'Hero',manualKickAt:10,dailyStart:1});W.generation=1;
 e.cfg=E.taskConfig(W.raw,()=>e.rt);e.autonomyMode=()=>{const k=E.selectedTask(e.cfg,e.rt,W.box.Date.now());return k==='auto'?'farm':k||'fish'};
 Object.assign(e,{tabOwner:true,leaseEpoch:7,actionGeneration:()=>W.generation,canAct:()=>true,payments:{blocked:()=>false},fishTaskWaitKey:()=>E.fishTaskWaitKey(e.cfg,e.rt,W.box.Date.now())});
 W.state={revision:100,target:null};W.character={name:'Hero',id:'hero-id',revision:100,inBattle:false};W.gets=[];W.idles=[];W.redirects=[];
 e.gameGet=async p=>{W.gets.push(p);return{ok:true,json:async()=>p==='/character'?{character:W.character}:W.state}};
 e.setRt=async p=>{Object.assign(e.rt,p);return{ok:true}};
 e.idle=async(ms,label)=>{W.idles.push({ms,label});await e.sleep(ms)};
 let href=W.location.href;Object.defineProperty(W.location,'href',{get:()=>href,set:v=>{href=v;W.redirects.push(v)}});
 W.mode=()=>E.selectedTask(e.cfg,e.rt,W.box.Date.now());W.wait=()=>E.fishTaskWait(e.cfg,e.rt,W.box.Date.now());
 W.reload=()=>{W.F=W.box.L2V7Factories.fishing(e)};return W;
}
test('время закончилось и докупка выключена: весь fishing уступает выбранному auto без кликов',async()=>{
 const W=fixture();assert.equal(W.mode(),'fish');await W.F.fishing();
 assert.equal(W.mode(),'auto');assert.equal(W.idles.length,0);assert.equal(W.redirects.length,0);assert.equal(W.clicks.length,0);
 assert.match(W.wait().why,/время закончилось.*выключена/);assert.deepEqual(W.raw.autoTasks,['fish','auto']);assert.equal(W.wait().until-W.wait().at,5000);
});
test('на оплату времени не хватает адены: отказ не блокирует выбранный автофарм',async()=>{
 const W=fixture();W.raw.fishTimeAuto=true;W.adena=100000;await W.F.fishing();
 assert.equal(W.mode(),'auto');assert.match(W.wait().why,/не хватает аден/);assert.equal(W.clicks.length,0);assert.ok(W.env.rt.fishTimeFailAt);
});
test('наживка закончилась без автопокупки: после сверки серверного target очередь получает auto',async()=>{
 const W=fixture();W.remain='01:00:00';W.slots.basicBait.n=W.slots.goodBait.n=0;
 await W.F.fishing();assert.equal(W.mode(),'auto');assert.match(W.wait().why,/наживк/);assert.equal(W.clicks.filter(x=>x.kind==='fishing').length,0);
});
test('срок истёк: рыбалка сама возвращается и может сделать заброс после исправления причины',async()=>{
 const W=fixture();await W.F.fishSoft('нет времени');W.reload();assert.equal(W.mode(),'auto');
 await W.env.sleep(5001);assert.equal(W.mode(),'fish');W.remain='01:00:00';
 const fire=W.env.fire;W.env.fire=b=>{const r=fire(b);if(b?.kind==='fishing')W.env.on=false;return r};
 await W.F.fishing();assert.equal(W.clicks.filter(x=>x.kind==='fishing').length,1);
});
test('повторный отказ сохраняет существующую лесенку ожидания до пяти минут',async()=>{
 const W=fixture();const delays=[];
 for(let i=0;i<12;i++){await W.F.fishSoft('нет времени');const w=W.wait();delays.push((w.until-w.at)/1000);await W.env.sleep(w.until-W.box.Date.now()+1);W.reload();}
 assert.deepEqual(delays,[5,10,20,30,40,60,120,180,240,300,300,300]);assert.deepEqual(W.raw.autoTasks,['fish','auto']);
});
for(const [name,change] of Object.entries({kick:W=>W.env.rt.manualKickAt++,start:W=>W.env.rt.dailyStart++,actor:W=>W.env.rt.char='Other',timePermission:W=>W.raw.fishTimeAuto=true,baitPermission:W=>W.raw.fishAutoBuy=true,budget:W=>W.raw.shopReserve=0,tasks:W=>W.raw.autoTasks=['fish','cat']}))test('новое решение снимает ожидание немедленно: '+name,async()=>{
 const W=fixture();await W.F.fishSoft('нет времени');assert.equal(W.mode(),'auto');change(W);assert.equal(W.wait(),null);assert.equal(W.mode(),'fish');
});
for(const list of [['fish'],['fish','tvt'],undefined])test('без альтернативного занятия прежняя пауза сохранена: '+JSON.stringify(list),async()=>{
 const W=fixture(list);if(list===undefined){delete W.raw.autoTasks;W.env.cfg=W.raw}
 await W.F.fishSoft('нет времени');assert.equal(W.env.rt.taskWait,undefined);assert.equal(W.idles.length,1);assert.equal(W.idles[0].ms,5000);assert.equal(W.gets.length,0);
});
for(const [name,change] of Object.entries({active:W=>W.env.rt.fishCastActive=true,pendingCast:W=>W.env.rt.fishCastPending={at:1},fishingPayment:W=>W.env.rt.actionPayments={pending:{kind:'fishing'}},otherPayment:W=>W.env.rt.actionPayments={pending:{kind:'cat-teleport'}},paymentGuard:W=>W.env.payments.blocked=()=>true,service:W=>W.env.rt.fishService='cut',manualService:W=>W.env.rt.fishSvc={at:1},owner:W=>W.env.rt.actionOwner={key:'shop'},daily:W=>W.env.rt.dailyFish={at:1},visibleFish:W=>W.active=true}))test('незавершённое действие не передаёт очередь: '+name,async()=>{
 const W=fixture();change(W);await W.F.fishSoft('не готово');assert.equal(W.env.rt.taskWait,undefined);assert.equal(W.gets.length,0);assert.equal(W.idles.length,1);
});
for(const [name,change] of Object.entries({live:W=>W.state.target={name:'White Fish'},missingTarget:W=>delete W.state.target,revision:W=>W.character.revision++,actor:W=>W.character.name='Other',battle:W=>W.character.inBattle=true,network:W=>W.env.gameGet=async()=>{throw Error('offline')}}))test('без согласованного доказательства отсутствия рыбы defer запрещён: '+name,async()=>{
 const W=fixture();change(W);await W.F.fishSoft('панель не загрузилась');assert.equal(W.env.rt.taskWait,undefined);assert.equal(W.mode(),'fish');assert.equal(W.idles.length,1);
});
for(const [name,change] of Object.entries({stop:W=>W.env.on=false,lease:W=>W.env.leaseEpoch++,generation:W=>W.generation++,kick:W=>W.env.rt.manualKickAt++,permission:W=>W.raw.fishTimeAuto=true}))test('смена контекста во время GET отменяет старую паузу: '+name,async()=>{
 const W=fixture(),read=W.env.gameGet;W.env.gameGet=async p=>{const r=await read(p);if(p==='/character')change(W);return r};
 await W.F.fishSoft('нет времени');assert.equal(W.env.rt.taskWait,undefined);assert.equal(W.idles.length,0);assert.equal(W.redirects.length,0);
});
test('ошибка commit откатывает локальную передачу очереди',async()=>{
 const W=fixture();W.env.rtCommit=async()=>false;await W.F.fishSoft('нет времени');assert.equal(W.mode(),'fish');assert.equal(W.wait(),null);assert.equal(W.redirects.length,0);
});
test('действующий лимит/выполненная цель после срока не отменяются ожиданием',async()=>{
 const W=fixture();await W.F.fishSoft('нет времени');await W.env.sleep(5001);W.env.rt.fishTgt={done:true};assert.equal(W.mode(),'auto');
});
test('незаконченная закупка альтернативной задачи завершается даже после срока',async()=>{
 const W=fixture();await W.F.fishSoft('нет времени');W.env.rt.actionOwner={key:'shop'};await W.env.sleep(6000);assert.equal(W.mode(),'auto');
 W.env.rt.actionOwner=null;assert.equal(W.mode(),'fish');
});
test('новый неизвестный заброс/оплата рыбалки не скрываются ранее созданным defer',async()=>{
 for(const patch of [{fishCastActive:true},{fishCastPending:{at:2}},{actionPayments:{pending:{kind:'fishing'}}}]){
  const W=fixture();await W.F.fishSoft('нет времени');Object.assign(W.env.rt,patch);assert.equal(W.wait(),null);assert.equal(W.mode(),'fish');
 }
});
test('ожидающий рейд и недоступная рыбалка уступают auto, сохраняя parked rbHunt',async()=>{
 const W=fixture(['raid','fish','auto']),now=W.box.Date.now();
 Object.assign(W.env.rt,{rbFishWait:{at:now-100,until:now+300000},rbHunt:{step:'pick',phase:'wait',id:null}});assert.equal(W.mode(),'fish');
 await W.F.fishSoft('нет времени');assert.equal(W.mode(),'auto');assert.equal(W.E.taskJobAllowed(W.env.cfg,'rbHunt',W.env.rt),true);
 W.env.rt.rbTourView={at:now+1,ready:[{id:'alive'}]};assert.equal(W.mode(),'raid');
});
test('появившийся рейд не отменяет начатую закупку запасной задачи',async()=>{
 const W=fixture(['raid','fish','auto']),now=W.box.Date.now();Object.assign(W.env.rt,{rbFishWait:{at:now-100,until:now+300000},rbHunt:{step:'pick',phase:'wait',id:null}});
 await W.F.fishSoft('нет времени');W.env.rt.actionOwner={key:'shop'};W.env.rt.rbTourView={at:now+1,ready:[{id:'alive'}]};await W.env.sleep(6000);
 assert.equal(W.mode(),'auto');W.env.rt.actionOwner=null;assert.equal(W.mode(),'raid');
});
test('неизвестная оплата начатой запасной закупки остаётся в её режиме до сверки',async()=>{
 const W=fixture(['raid','fish','auto']),now=W.box.Date.now();Object.assign(W.env.rt,{rbFishWait:{at:now-100,until:now+300000},rbHunt:{step:'pick',phase:'wait',id:null}});
 await W.F.fishSoft('нет времени');W.env.rt.actionOwner={key:'shop'};W.env.rt.actionPayments={pending:{kind:'shop'}};await W.env.sleep(6000);
 assert.equal(W.mode(),'auto');W.env.rt.actionPayments.pending=null;assert.equal(W.mode(),'auto');W.env.rt.actionOwner=null;assert.equal(W.mode(),'fish');
});
test('окончание подтверждённого ожидания рейда возвращает проверку рейда',async()=>{
 const W=fixture(['raid','fish','auto']),now=W.box.Date.now();Object.assign(W.env.rt,{rbFishWait:{at:now-100,until:now+1000},rbHunt:{step:'pick',phase:'wait',id:null}});
 await W.F.fishSoft('нет времени');assert.equal(W.mode(),'auto');await W.env.sleep(1001);assert.equal(W.mode(),'raid');
});
test('tasksIdle показывает причину и срок рыбной паузы вместо «ни одна задача не включена»',async()=>{
 const W=fixture();await W.F.fishSoft('Рыбалка: оплаченное время закончилось');
 const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),start=source.indexOf('async function tasksIdle()'),end=source.indexOf('// 10.0.5',start);let status='',slept=0;
 assert.ok(start>0&&end>start);
 const run=vm.runInNewContext(source.slice(start,end)+';tasksIdle;',{L2EngineCore:W.E,cfg:W.env.cfg,rt:W.env.rt,Date:W.box.Date,setStatus:s=>status=s,sleep:async n=>{slept=n},window:{},rec(){}});
 await run();assert.match(status,/оплаченное время закончилось/);assert.match(status,/повтор через 5 с/);assert.doesNotMatch(status,/ни одна не включена/);assert.equal(slept,2000);
 await W.env.sleep(5001);await run();assert.match(status,/Без режима/);assert.doesNotMatch(status,/оплаченное время закончилось/);
});
test('runtime getter передаёт ключ актуальных raw-настроек и персонажа модулю fishing',()=>{
 const W=fixture(),source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 const getter=source.match(/get fishTaskWaitKey\(\)\{return \(\)=>L2EngineCore\.fishTaskWaitKey\(cfg,rt\)\}/)?.[0];assert.ok(getter);
 const adapter=vm.runInNewContext('({'+getter+'})',{L2EngineCore:W.E,cfg:W.env.cfg,rt:W.env.rt});
 assert.equal(adapter.fishTaskWaitKey(),W.env.fishTaskWaitKey());W.raw.fishTimeAuto=true;assert.equal(adapter.fishTaskWaitKey(),W.env.fishTaskWaitKey());
});
