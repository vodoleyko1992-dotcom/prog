'use strict';
// 20.28, лог20.10 08:51:42/59: подготовка оплаты Маммона не должна сама менять fish→raid и отменять свой клик.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function fixture(){
 let now=1_800_000_000_000;const Clock=class extends Date{static now(){return now}},store=new Map(),events=[],writes=[],clicks=[];
 const location={pathname:'/mammon-blacksmith-loc.html',search:'',href:''},doc={documentElement:{dataset:{}},querySelectorAll:()=>[]};
 const box={Date:Clock,console,Math,JSON,URLSearchParams,location,document:doc,sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))}};
 for(const file of ['engine-core.js','modules/actions.js','modules/payments.js','modules/mammon.js'])vm.runInNewContext(read(file),box);
 const E=box.L2EngineCore,raw={autoTasks:['tvt','mammon','fish','raid','auto'],catDungeon:'auto',mmGoalItem:910624,mmGoalLvl:5,mmUpgrade:true,mmTpMax:500000};
 const env={rt:{char:'Hero',manualKickAt:1,rbFishWait:{at:now-100,until:now+300000},rbHunt:{step:'pick',phase:'wait',id:null}},on:true,tabOwner:true,leaseEpoch:7,generation:1,
  routeLocation:location,isBattle:()=>false,rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),sleep:async()=>{},waitX:async f=>f(),$q:()=>null,
  setRt:async p=>{env.rt={...env.rt,...p};writes.push({pending:env.rt.actionPayments?.pending?.kind||null,mode:env.autonomyMode()});await W.afterWrite?.(p);return{ok:true}},rtCommit:async()=>true};
 env.cfg=E.taskConfig(raw,()=>env.rt);env.autonomyMode=()=>E.selectedTask(env.cfg,env.rt,now);env.fishNow=()=>env.autonomyMode()==='fish';
 let runs=0,reconciles=0;
 const A=box.L2V7Factories.actions({get rt(){return env.rt},get cfg(){return env.cfg},get on(){return env.on},get tabOwner(){return env.tabOwner},mode:env.autonomyMode,lease:()=>env.leaseEpoch,actionGeneration:()=>env.generation,
  page:()=>location.pathname,id:()=> 'owner',challengeHold:()=>false,interrupted:()=>false,isBattle:()=>false,paymentPending:()=>env.payments.pending(),reconcile:async()=>{reconciles++},freeWork:async()=>{},
  setRt:env.setRt,rtCommit:env.rtCommit,setStatus:env.setStatus,rec:env.rec,jobs:()=>[{key:'mmJob',run:async()=>{runs++}}]});
 const P=env.payments=box.L2V7Factories.payments({get rt(){return env.rt},get on(){return env.on},get tabOwner(){return env.tabOwner},autonomyMode:env.autonomyMode,lease:()=>env.leaseEpoch,paymentContext:A.context,canRun:A.canAct,externalPending:()=>false,setRt:env.setRt,rtCommit:env.rtCommit,rec:env.rec});
 const job={kind:'smith',up:true,id:'up:910624:4',step:'go',t:now,context:{char:'Hero',kick:1,mode:'fish'}};
 env.rt.mmJob=job;env.rt.actionOwner={key:'mmJob',context:A.context(),at:now,stamp:String(now),phase:'go',page:location.pathname};A.enterFrame();
 const char={id:'hero-id',name:'Hero',revision:10,adena:10000000},item={itemId:910624,targetInstanceId:'eq:tattoo',nameUk:'Татуювання озера',locationLabelUk:'Одягнено',level:4,canAfford:true,cost:{adena:3000000,adenaOwned:10000000,coinOfLuck:5,coinOfLuckOwned:180,materials:[]}};
 const button={disabled:false,textContent:'Покращити до Lv.5'},fields={'.l2-mammon-upgrade-card__name':{textContent:item.nameUk},'.l2-mammon-upgrade-card__level':{textContent:'Lv.4'},'.l2-mammon-upgrade-card__meta':{textContent:'Тату · Одягнено'},'.l2-mammon-upgrade-card__btn':button},card={querySelector:s=>fields[s]||null};
 doc.querySelectorAll=()=>[card];env.$q=s=>s==='#mammon-loc-teleport-btn'?button:s==='#mammon-loc-cost'?{textContent:'Безкоштовно'}:null;
 env.gameGet=async p=>({ok:true,status:200,json:async()=>p==='/character'?{character:{...char}}:{items:[{...item}]}});
 env.fire=b=>{if(!P.consumePermit())return false;clicks.push(b);if(location.pathname==='/mammon-blacksmith.html')item.level=5;else location.pathname='/map.html';return true};
 const M=box.L2V7Factories.mammon(env);
 const W={E,A,P,M,env,raw,job,location,item,button,clicks,writes,events,now:()=>now,tick:ms=>now+=ms,runs:()=>runs,reconciles:()=>reconciles,
  spec:(kind='mammon',action='teleport')=>({key:kind+':'+action,kind,quote:{amount:action==='teleport'?0:5,currency:action==='teleport'?'adena':'coin_of_luck'},evidence:{action}})};
 return W;
}
for(const action of ['teleport','upgrade'])test(`Маммон ${action}: настоящий модуль отправляет один клик после оплаты в выбранной рыбалке`,async()=>{
 const W=fixture();if(action==='upgrade'){W.location.pathname='/mammon-blacksmith.html';W.job.step='act';await W.M.upgrade(W.job,[W.item]);}else await W.M.teleport(W.job);
 assert.equal(W.clicks.length,1);assert.ok(W.writes.every(w=>w.mode==='fish'));assert.equal(W.env.autonomyMode(),'fish');assert.ok(!W.events.some(s=>s.includes('исход оплаты неизвестен')));
 if(action==='upgrade'){assert.equal(W.item.level,5);assert.equal(W.P.pending(),null);assert.equal(W.env.rt.mmLog[0].ok,true)}else assert.equal(W.P.pending().kind,'mammon');
});
for(const kind of ['mammon','shop','fa-buff','town-buff','tvt-shop','story-teleport','cat-teleport','summon-buff','enchant'])test(`${kind}: служебная оплата не становится оплатой рейда`,async()=>{
 const W=fixture(),p=await W.P.prepare(W.spec(kind));assert.ok(p,'подготовка оплаты должна завершиться');assert.equal(W.env.autonomyMode(),'fish');assert.ok(W.A.canAct());assert.ok(W.P.sent(p));assert.ok(W.P.consumePermit());assert.equal(W.P.consumePermit(),false);
});
test('неизвестная служебная оплата после reload сохраняется и не допускает новую prepare или запуск услуги',async()=>{
 const W=fixture(),p={id:'old-payment',char:'Hero',kind:'mammon',key:'old',at:W.now()-30000,quote:{amount:5,currency:'coin_of_luck'}};
 W.env.rt.actionPayments={pending:p};assert.equal(W.env.autonomyMode(),'fish');assert.equal(await W.P.prepare(W.spec('shop')),null);assert.equal(W.P.pending().id,p.id);
 await W.A.dispatch();assert.equal(W.reconciles(),1);assert.equal(W.runs(),0);assert.equal(W.clicks.length,0);assert.equal(W.P.pending().id,p.id);
});
test('после отправки неизвестный исход запрещает второй клик и повторную prepare',async()=>{
 const W=fixture(),p=await W.P.prepare(W.spec());assert.ok(p);assert.ok(W.P.sent(p));assert.ok(W.P.consumePermit());assert.equal(await W.P.prepare(W.spec()),null);assert.equal(W.P.pending().id,p.id);assert.equal(W.P.sent(p),false);
});
test('только raid-teleport удерживает рейд при сохранённом rbFishWait',()=>{
 const W=fixture();W.env.rt.actionPayments={pending:{kind:'raid-teleport',id:'raid'}};assert.equal(W.env.autonomyMode(),'raid');assert.equal(W.A.canAct(),false);
});
test('сверка fishing удерживает рыбалку даже после срока ожидания рейда',()=>{
 const W=fixture();W.tick(300001);W.env.rt.actionPayments={pending:{kind:'fishing',id:'fish'}};assert.equal(W.env.autonomyMode(),'fish');
});
for(const wake of ['deadline','freshRaid','dailyLimit','fishGoal'])test(`${wake}: служебный владелец не обходит обычные границы выбора рыбалки`,()=>{
 const W=fixture();W.env.rt.actionPayments={pending:{kind:'mammon',id:'unknown'}};
 if(wake==='deadline')W.tick(300001);if(wake==='freshRaid')W.env.rt.rbTourView={at:W.now(),ready:[{id:'alive'}]};
 if(wake==='dailyLimit'){W.raw.dailyFishLimit=1;W.env.rt.dailyQuota={day:W.E.dailyDay(W.now(),W.env.rt),fish:1};}
 if(wake==='fishGoal')W.env.rt.fishTgt={done:true};assert.equal(W.env.autonomyMode(),'raid');assert.equal(W.P.pending().id,'unknown');
});
for(const change of ['char','kick','tasks','lease','stop','owner','generation'])test(`${change} во время durable prepare отменяет старое действие без клика`,async()=>{
 const W=fixture();let changed=false;W.afterWrite=p=>{if(changed||!p.actionPayments?.pending)return;changed=true;
  if(change==='char')W.env.rt={char:'Other',manualKickAt:1,marker:'preserved'};if(change==='kick')W.env.rt.manualKickAt++;
  if(change==='tasks')W.raw.autoTasks=['auto'];if(change==='lease')W.env.leaseEpoch++;if(change==='stop')W.env.on=false;if(change==='owner')W.env.tabOwner=false;if(change==='generation')W.env.generation++;
 };
 const p=await W.P.prepare(W.spec());assert.equal(p,null);assert.equal(W.P.consumePermit(),false);assert.equal(W.clicks.length,0);if(change==='char')assert.equal(W.env.rt.marker,'preserved');
});
