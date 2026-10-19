'use strict';
// 20.10.2026: ручной апгрейд временно блокирует кнопку; это не отказ и не повод уходить с кузнеца.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.L2_REPO||path.join(__dirname,'..'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fixture(){
 let now=1792450324207,href='',level=4,commits=0,prepared=0,afterPrepare=null,afterJobCommit=null;
 const events=[],posts=[],gets=[],store=new Map();
 const route={pathname:'/mammon-blacksmith.html',search:'',get href(){return href},set href(value){href=value;events.push({kind:'navigate',value})}};
 const button={textContent:'Покращити до Lv.5',disabled:false,isConnected:true};
 const fields={'.l2-mammon-upgrade-card__name':{textContent:'Татуювання озера'},'.l2-mammon-upgrade-card__level':{textContent:'Lv.4'},'.l2-mammon-upgrade-card__meta':{textContent:'Одягнено'},'.l2-mammon-upgrade-card__btn':button};
 const card={isConnected:true,querySelector:selector=>fields[selector]||null};let cards=[card],extra=[];
 const document={querySelectorAll:()=>cards,querySelector:()=>null,contains:node=>node===card?cards.includes(card):node===button&&button.isConnected&&cards.includes(card),documentElement:{dataset:{}}};
 const box={console,Date:class extends Date{static now(){return now}},location:route,document,sessionStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}};
 vm.runInNewContext(read('modules/payments.js'),box);vm.runInNewContext(read('modules/mammon.js'),box);
 const ownItem=()=>({itemId:910624,targetInstanceId:'eq:tattoo',nameUk:'Татуювання озера',locationLabelUk:'Одягнено',level,max:level>=5,canAfford:true,cost:{adena:3e6,adenaOwned:5e8,coinOfLuck:5,coinOfLuckOwned:180,materials:[]}});
 const env={on:true,tabOwner:true,leaseEpoch:'lease-a',rt:{char:'AuditHero',manualKickAt:0},cfg:{mmGoalItem:910624,mmGoalLvl:5,mmUpgrade:true},routeLocation:route,
  autonomyMode:()=> 'fish',fishNow:()=>true,isBattle:()=>false,canRun:()=>true,lease:()=>env.leaseEpoch,ITEMS:{},FARM:{res:{}},invQty:()=>0,
  rec:(...text)=>events.push({kind:'log',text:text.join(' ')}),setStatus:text=>events.push({kind:'status',text}),
  setRt:async patch=>{Object.assign(env.rt,patch);return {ok:true}},
  rtCommit:async()=>{commits++;if(commits===2)afterJobCommit?.();return true},sleep:async()=>{},waitX:async fn=>fn(),
  $q:selector=>selector==='#mammon-blacksmith-upgrade-msg'?{textContent:posts.length?'Успіх':''}:null,
  fire:node=>{assert.equal(node,button);posts.push({targetInstanceId:'eq:tattoo',expectedLevel:4});level=5;return true},
  gameGet:async request=>{gets.push(request);assert.equal(request,'/game/mammon/blacksmith/upgrades');return {ok:true,status:200,json:async()=>({items:[...extra,ownItem()]})}}};
 env.payments=box.L2V7Factories.payments(env);
 const prepare=env.payments.prepare;env.payments.prepare=async spec=>{prepared++;const ticket=await prepare(spec);afterPrepare?.();return ticket};
 const M=box.L2V7Factories.mammon(env),job={kind:'smith',up:true,id:'up:910624:4',target:'eq:tattoo',step:'act',t:now,context:{char:'AuditHero',kick:0,mode:'fish'}};
 env.rt.mmJob=job;
 return {M,env,job,button,card,fields,events,posts,gets,route,prepared:()=>prepared,commits:()=>commits,
  setLevel:value=>{level=value;now++},advance:ms=>{now+=ms},setExtra:value=>{extra=value},afterPrepare:fn=>{afterPrepare=fn},afterCommit:fn=>{afterJobCommit=fn},
  replaceCard:()=>{button.isConnected=false;card.isConnected=false;cards=[]},
  manualStart:()=>{button.disabled=true;return env.payments.claimRequest({method:'POST',path:'/game/mammon/blacksmith/upgrade',rid:42,req:{targetInstanceId:'eq:tattoo',expectedLevel:4,expectedRevision:373562}})}};
}
function waitingWithoutFailure(f){
 assert.ok(f.env.rt.mmJob,'незавершённое улучшение сохраняется');
 assert.equal(f.route.href,'','бот не уходит во время неопределённого ручного действия');
 assert.equal(f.posts.length,0,'нет повторного native POST');
 assert.equal(f.env.rt.mmUpFail??null,null,'временная блокировка не увеличивает счётчик неудач');
 assert.equal(f.env.rt.mmLog?.length||0,0,'в журнале нет ложного завершения');
 assert.equal(f.env.payments.pending(),null,'заведомо не отправленная оплата не остаётся pending');
}
test('ручной POST: disabled до prepare сохраняет маршрут; свежий серверный Lv.5 завершает его без повторного клика',async()=>{
 const f=fixture();assert.equal(f.manualStart(),'','ручной запрос не присваивает квитанцию бота');
 await f.M.mmStep();waitingWithoutFailure(f);assert.equal(f.prepared(),0);assert.ok(f.events.some(x=>x.kind==='status'));
 f.setLevel(5);await f.M.mmStep();assert.equal(f.env.rt.mmJob,null);assert.equal(f.env.rt.mmLog[0].ok,true);assert.match(f.env.rt.mmLog[0].why,/Lv\.5/);assert.equal(f.posts.length,0);assert.equal(f.env.rt.mmUpFail,null);
 assert.ok(f.gets.length>=2,'завершение основано на повторном серверном чтении');
});
test('уровень 5 другого экземпляра не подтверждает ручное улучшение eq:tattoo',async()=>{
 const f=fixture();f.manualStart();f.setExtra([{itemId:910624,targetInstanceId:'bag:other-tattoo',nameUk:'Татуювання озера',locationLabelUk:'У сумці',level:5,max:true,canAfford:true}]);
 await f.M.mmStep();waitingWithoutFailure(f);assert.equal(f.prepared(),0);
});
test('постоянно disabled без платежа: ожидание сохраняет исходный дедлайн и заканчивается через 4 минуты без клика',async()=>{
 const f=fixture();f.button.disabled=true;const started=f.job.t;
 await f.M.mmStep();waitingWithoutFailure(f);
 f.advance(4*60000-1);await f.M.mmStep();waitingWithoutFailure(f);assert.equal(f.env.rt.mmJob.t,started);
 f.advance(2);await f.M.mmStep();assert.equal(f.env.rt.mmJob,null);assert.equal(f.posts.length,0);assert.equal(f.prepared(),0);
 assert.equal(f.env.rt.mmLog[0].ok,false);assert.match(f.env.rt.mmLog[0].why,/не уложился в 4 мин/);assert.equal(f.env.rt.mmUpFail.n,1);
});
for(const stage of ['prepare','commit'])test(`кнопка стала disabled во время ${stage}: отменяется только неотправленная квитанция, маршрут остаётся`,async()=>{
 const f=fixture();f[stage==='prepare'?'afterPrepare':'afterCommit'](()=>{f.button.disabled=true});
 await f.M.mmStep();assert.equal(f.prepared(),1);waitingWithoutFailure(f);assert.equal(f.env.rt.mmJob.payment??null,null);
 assert.equal(f.env.rt.actionPayments?.history?.length||0,0,'неотправленный клик не выдаётся за подтверждённую покупку');
});
for(const mutation of ['disconnected','next-level-label'])test(`DOM изменился перед кликом (${mutation}): старую кнопку не нажимаем`,async()=>{
 const f=fixture();f.afterCommit(()=>{if(mutation==='disconnected')f.replaceCard();else f.button.textContent='Покращити до Lv.6'});
 await f.M.mmStep();assert.equal(f.prepared(),1);waitingWithoutFailure(f);
});
for(const stage of ['prepare','commit'])for(const mutation of ['stop','lease','goal'])test(`${mutation} во время ${stage} не допускает поздний клик`,async()=>{
 const f=fixture();f[stage==='prepare'?'afterPrepare':'afterCommit'](()=>{if(mutation==='stop')f.env.on=false;else if(mutation==='lease')f.env.leaseEpoch='lease-b';else f.env.cfg.mmGoalItem=910625});
 await f.M.mmStep();assert.equal(f.prepared(),1);assert.equal(f.posts.length,0);assert.equal(f.route.href,'');
 assert.equal(f.env.payments.pending(),null,'подготовленная, но не отправленная квитанция отменена');
});
test('контроль: доступная неизменённая карточка отправляет ровно один клик и подтверждает выросший уровень',async()=>{
 const f=fixture();await f.M.mmStep();assert.equal(f.prepared(),1);assert.equal(f.posts.length,1);assert.equal(f.env.rt.mmJob,null);assert.equal(f.env.rt.mmLog[0].ok,true);assert.equal(f.env.payments.pending(),null);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.level,5);
});
