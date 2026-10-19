'use strict';
// 19.10: настоящий Маммон + invRefresh + ручная IPC-команда; все ответы синтетические, живой игры нет.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),content=read('content.js'),source=read('modules/mammon.js');
const inventory=content.slice(content.indexOf('let INV_NET ='),content.indexOf('// 15.10, MV3 startup:',content.indexOf('let INV_NET =')));
const command=content.slice(content.indexOf('let mammonBagCommandBusy ='),content.indexOf('chrome.runtime.onMessage.addListener',content.indexOf('let mammonBagCommandBusy =')));
const claimStart=content.indexOf("    if (path === '/game/item-transfer/claim' && d.status === 200"),claimEnd=content.indexOf('   // Успешное получение:',claimStart);
const claimObserver=content.slice(claimStart,claimEnd);
assert.ok(inventory.includes('async function invRefresh(active'));
assert.ok(command.includes('async function mammonBagCommand'));
function fixture({on=false,goal=910624,to=5,level=4,rt:extra={},fresh=false}={}){
 let now=1800000000000,reader=null,actor='Hero',lockOk=true,saving=true;const gets=[],writes=[],locks=[],logs=[],ss=new Map();
 class Clock extends Date { static now(){return now} }
 const state={on,cfg:{autoTasks:['mammon'],mmGoalItem:goal,mmGoalLvl:to,mmGoalFarm:false,mmOrders:false,mmMailClaim:false,mmSmithAuto:false,mmUpgrade:true},
  rt:{char:'Hero',manualKickAt:1,classCur:{prof:'dwarf_bounty_hunter',slot:1},mmEq:{tattoo:[910624,4]},mmEqT:now-1000,
   mmCost:{'910624:4':{a:3000000,c:5,m:[[1893,'Oriharukon',13]]},'910624:3':{a:2000000,c:4,m:[[1893,'Oriharukon',7]]}},...extra}};
 let stocks={1874:11891,1873:30675,1871:117,1870:117,1893:0,4037:10},eq={tattoo:{itemId:910624,specialGearLevel:level}};
 const box={console,Date:Clock,Math,JSON,Map,Set,Promise,Object,URL,URLSearchParams,location:{pathname:'/mail.html',search:'',href:'',origin:'https://l2wap.com'},
  automationGeneration:1,leaseEpoch:on?'lease':null,tabOwner:on,tabIdle:false,documentLease:null,lockMine:0,document:{querySelector:()=>null,querySelectorAll:()=>[]},
  sessionStorage:{getItem:k=>ss.get(k)||null,setItem:(k,v)=>ss.set(k,String(v))},heroNick:()=>actor,tabVis:()=>true,quietErr(){},
  chrome:{runtime:{getURL:f=>f},storage:{local:{get:async()=>structuredClone(state)}}},mergeCfg:x=>x,
  ipc:async m=>{locks.push(structuredClone(m));return m.cmd==='lockAcquire'?{ok:lockOk,epoch:'manual-lease'}:{ok:true}},
  rtWriter:{recover:async()=>({ok:true})},L2V7Modules:{warlock:{noteSnapshot(){}},tvtshop:{shilNote(){}}},
  fetch:async()=>({ok:true,json:async()=>({})}),gameGet:async p=>{gets.push(p);assert.equal(p,'/character');return reader?reader():{ok:true,json:async()=>({character:character()})}},
  setRt:async p=>{writes.push(structuredClone(p));Object.assign(state.rt,structuredClone(p));return {ok:saving}}};
 for(const k of ['rt','cfg','on'])Object.defineProperty(box,k,{get:()=>state[k],set:v=>{state[k]=v},configurable:true});
 const character=()=>({name:'Hero',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},inventory:{eq:structuredClone(eq),stacks:Object.entries(stocks).map(([itemId,qty])=>({itemId:+itemId,qty}))}});
 vm.createContext(box);vm.runInContext(inventory+'\nthis.qty=invQty;this.refresh=invRefresh;this.snapshot=()=>INV_READY===invContext()&&invQty(0)!==null?INV_NET:null;this.cache=()=>INV_NET;',box);
 const env={get cfg(){return state.cfg},get rt(){return state.rt},get on(){return state.on},get tabOwner(){return box.tabOwner},get leaseEpoch(){return box.leaseEpoch},
  actionGeneration:()=>box.automationGeneration,bagAllowed:()=>state.cfg.autoTasks.includes('mammon'),heroNick:box.heroNick,invQty:id=>box.qty(id),invRefresh:a=>box.refresh(a),invSnapshot:()=>box.snapshot(),
  setRt:box.setRt,rec:(...x)=>logs.push(x),setStatus(){},ITEMS:{},FARM:{res:{}},routeLocation:box.location,autonomyMode:()=> 'tasks',isBattle:()=>false,isFishing:()=>false,fishState:()=>null,fishNow:()=>false,
  payments:{blocked:()=>!!state.rt.actionPayments?.pending},gameGet:box.gameGet,sleep:async()=>{}};
 const reload=()=>{vm.runInContext(source,box);box.L2V7Modules.mammon=box.L2V7Factories.mammon(env);return box.L2V7Modules.mammon};reload();
 vm.runInContext(command+'\nthis.manual=mammonBagCommand;',box);
 return {state,box,env,gets,writes,locks,logs,get M(){return box.L2V7Modules.mammon},get stocks(){return stocks},set stocks(v){stocks=v},set eq(v){eq=v},set actor(v){actor=v},set lockOk(v){lockOk=v},set saving(v){saving=v},set reader(v){reader=v},character,
  tick(ms){now+=ms},reload,manual:()=>box.manual({expectedChar:'Hero',goalItem:state.cfg.mmGoalItem,goalLvl:state.cfg.mmGoalLvl}),
  async claim(receipt='mail-1',override={}){box.path='/game/item-transfer/claim';box.d={status:200,req:{attachmentId:receipt},res:{attachmentId:receipt},...override};vm.runInContext(claimObserver,box);for(let i=0;i<20;i++)await Promise.resolve()},
  async seed(){if(fresh)await box.refresh()}};
}
const row=(a,id,field='items')=>a[field].find(x=>x.id===id);
test('ручная IPC при OFF всегда читает весь рюкзак и различает Oriharukon Ore/готовый Oriharukon',async()=>{
 const f=fixture();f.stocks={...f.stocks,...Object.fromEntries(Array.from({length:20},(_,i)=>[10000+i,1]))};const r=await f.manual();
 assert.equal(r.ok,true);assert.equal(f.state.on,false);assert.deepEqual(f.gets,['/character']);assert.equal(f.box.tabOwner,false);assert.equal(f.box.leaseEpoch,null);assert.deepEqual(f.locks.map(x=>x.cmd),['lockAcquire','lockRelease']);assert.equal(f.locks[0].focus,false);
 assert.equal(row(r.analysis,1893).have,0);assert.equal(row(r.analysis,1893).need,13);assert.equal(row(r.analysis,1893).missing,13);assert.equal(row(r.analysis,1874,'raw').have,11891);assert.equal(row(r.analysis,1874,'raw').need,65);assert.equal(r.analysis.readyMaterials,false);
 assert.equal(r.analysis.resources[10019],1,'полный инвентарь, не первые8/20строк');assert.equal(r.analysis.levelVerified,true);assert.equal(r.analysis.goal.lvl,4);assert.equal(f.state.rt.mmJob,undefined);assert.equal(f.state.rt.mmSmithReq,undefined);assert.equal(f.state.rt.mmGoReq,undefined);assert.equal(f.logs.length,0);
 f.stocks={...f.stocks,1893:13};const r2=await f.manual();assert.equal(r2.ok,true);assert.equal(r2.analysis.readyMaterials,true);assert.equal(row(r2.analysis,1893).missing,0);assert.equal(f.gets.length,2,'ручная команда не читает прошлый кэш');
});
test('при OFF актуальная экипировка исправляет старый уровень цели; достигнутая цель не строит лишний уровень',async()=>{
 const f=fixture({level:3});const r=await f.manual();assert.equal(r.analysis.goal.lvl,3);assert.equal(row(r.analysis,1893).need,7);assert.equal(f.state.rt.mmGoalPlan.lvl,3);
 f.eq={tattoo:{itemId:910624,specialGearLevel:5}};const done=await f.manual();assert.equal(done.analysis.goal.lvl,5);assert.equal(done.analysis.readyMaterials,true);assert.equal(done.analysis.items.length,0);assert.equal(done.analysis.raw.length,0);assert.equal(f.state.rt.mmGoalPlan,null);
});
test('без цели — полный свежий снимок и известные ресурсы, без запуска задания',async()=>{
 const f=fixture({goal:0});f.stocks={...f.stocks,999999:8};const r=await f.manual();assert.equal(r.ok,true);assert.equal(r.analysis.goal,null);assert.equal(r.analysis.items.length,0);assert.equal(r.analysis.resources[999999],8);assert.equal(r.analysis.resourceCount,r.analysis.known.length);assert.equal(r.analysis.known.some(x=>x.id===999999),false);assert.equal(f.state.rt.mmJob,undefined);
});
test('ошибка GET сохраняет последний успех, его время/строки и явную ошибку попытки',async()=>{
 const f=fixture();const good=(await f.manual()).analysis;f.tick(1000);f.reader=async()=>({ok:false,status:500});const r=await f.manual();assert.equal(r.ok,false);assert.equal(r.analysis.status,'error');assert.equal(r.analysis.t,good.t);assert.equal(r.analysis.attemptAt,good.t+1000);assert.deepEqual(JSON.parse(JSON.stringify(r.analysis.items)),JSON.parse(JSON.stringify(good.items)));assert.match(r.analysis.error,/прочитать/);assert.equal(f.state.on,false);
});
test('чужая активная вкладка/аренда не получает ручной GET или запись',async()=>{
 const f=fixture({on:true});f.box.tabOwner=false;assert.equal((await f.manual()).ok,false);assert.equal(f.gets.length,0);assert.equal(f.writes.length,0);
 const g=fixture();g.lockOk=false;assert.equal((await g.manual()).ok,false);assert.equal(g.gets.length,0);assert.equal(g.writes.length,0);
});
for(const mutation of ['goal','char','class','slot','lease','Stop','Start','hud'])test('поздний GET после '+mutation+' не меняет сумку/план',async()=>{
 const f=fixture({on:true});let release,entered;const waiting=new Promise(r=>entered=r),reply=f.character();f.reader=()=>{entered();return new Promise(r=>release=r)};const p=f.M.bagAnalyze();await waiting;
 if(mutation==='goal')f.state.cfg.mmGoalItem=920018;if(mutation==='char')f.state.rt.char='Other';if(mutation==='class')f.state.rt.classCur.prof='dwarf_artisan';if(mutation==='slot')f.state.rt.classCur.slot=0;if(mutation==='lease')f.box.leaseEpoch='lease2';if(mutation==='Stop'){f.state.on=false;f.box.automationGeneration++}if(mutation==='Start'){f.state.rt.manualKickAt++;f.box.automationGeneration++}if(mutation==='hud')f.actor='Other';
 release({ok:true,json:async()=>({character:reply})});assert.equal((await p).ok,false);assert.equal(f.box.cache(),null);assert.equal(f.state.rt.mmBagAnalysis,undefined);assert.equal(f.writes.length,0);
});
test('ответ сервера с другим персонажем/классом не принимается',async()=>{
 for(const change of [{name:'Other'},{l2Profession:'dwarf_artisan'},{classSlots:{activeSlot:0}}]){const f=fixture({on:true});f.reader=async()=>({ok:true,json:async()=>({character:{...f.character(),...change}})});assert.equal((await f.M.bagAnalyze()).ok,false);assert.equal(f.box.cache(),null);assert.equal(f.state.rt.mmBagAnalysis.t,0)}
});
test('singleflight объединяет одновременные анализы текущего контекста',async()=>{
 const f=fixture({on:true});let release,entered;const waiting=new Promise(r=>entered=r);f.reader=()=>{entered();return new Promise(r=>release=r)};const p=f.M.bagAnalyze();await waiting;const p2=f.M.bagAnalyze();assert.equal(p,p2);release({ok:true,json:async()=>({character:f.character()})});assert.equal((await p).ok,true);assert.equal((await p2).ok,true);assert.equal(f.gets.length,1);
});
test('ручная кнопка не принимает auto snapshot-flight: после его сохранения делает новый GET',async()=>{
 const f=fixture({on:true});await f.box.refresh();f.tick(60000);f.stocks={...f.stocks,1893:13};let entered,release;const waiting=new Promise(r=>entered=r),save=f.env.setRt;let hold=true;
 f.env.setRt=async p=>{if(p.mmBagAnalysis&&hold){hold=false;entered();await new Promise(r=>release=r)}return save(p)};
 const auto=f.M.bagAuto();await waiting;const manual=f.M.bagAnalyze();assert.equal(f.gets.length,1);release();await auto;const r=await manual;assert.equal(f.gets.length,2);assert.equal(r.analysis.source,'manual');assert.equal(row(r.analysis,1893).have,13);
});
test('план/ready/missing используют один returned snapshot, а не новый mutable invQty',async()=>{
 const f=fixture({on:true});f.env.invRefresh=async()=>({1893:0,1874:65,1873:156,1871:117,1870:117});f.env.invQty=()=>100000;const r=await f.M.bagAnalyze();assert.equal(row(r.analysis,1893).have,0);assert.equal(row(r.analysis,1893).missing,13);assert.equal(r.analysis.readyMaterials,false);assert.equal(row(r.analysis,1874,'raw').need,65);
});
test('auto использует подтверждённый GET inventoryReady; reload/навигация не создают повторный анализ',async()=>{
 const f=fixture({on:true});await f.box.refresh();assert.equal(f.gets.length,1);await f.M.bagAuto();assert.equal(f.gets.length,1);assert.equal(f.state.rt.mmBagAnalysis.status,'ok');await f.M.bagAuto();f.reload();f.box.leaseEpoch='next-page';await f.M.bagAuto();assert.equal(f.gets.length,1,'свежий durable план переживает смену аренды');
 f.tick(300001);await f.M.bagAuto();assert.equal(f.gets.length,2);f.state.rt.manualKickAt++;await f.box.refresh();const n=f.gets.length;await f.M.bagAuto();assert.equal(f.gets.length,n,'новый Start использует уже прочитанный inventoryReady');
});
test('auto выключен без Маммона/цели/owner/OFF; ошибка повторяется через60с, новая цель не наследует backoff',async()=>{
 const f=fixture({on:true});f.state.cfg.autoTasks=[];await f.M.bagAuto();f.state.cfg.autoTasks=['mammon'];f.state.cfg.mmGoalItem=0;await f.M.bagAuto();f.state.cfg.mmGoalItem=910624;f.box.tabOwner=false;await f.M.bagAuto();f.box.tabOwner=true;f.state.on=false;await f.M.bagAuto();assert.equal(f.gets.length,0);
 f.state.on=true;f.reader=async()=>({ok:false});await f.M.bagAuto();assert.equal(f.gets.length,1);await f.M.bagAuto();f.reload();f.box.leaseEpoch='next-page';f.tick(59999);await f.M.bagAuto();assert.equal(f.gets.length,1,'backoff переживает reload/аренду');f.tick(2);await f.M.bagAuto();assert.equal(f.gets.length,2);f.state.cfg.mmGoalLvl=4;await f.M.bagAuto();assert.equal(f.gets.length,3);
});
test('успешный claim forceGET; failed/duplicate claim не сбрасывают свежесть и паузы кузнеца',async()=>{
 const f=fixture({on:true,rt:{mmSmithOk:{id:910624,lvl:4,ok:false,t:1800000000000},mmUpFail:{k:'910624:4',n:2,t:1800000000000},mmUpT:1800000000000,actionPayments:{pending:{id:'uncertain',state:'sent'}}}});
 await f.M.bagAuto();const before=structuredClone(f.state.rt);f.stocks={...f.stocks,1893:13};await f.claim('failed',{res:{error:'revision_mismatch'}});await f.claim('duplicate',{res:{duplicate:true}});assert.equal(f.gets.length,1);await f.claim();assert.equal(f.gets.length,2);assert.equal(f.state.rt.mmBagAnalysis.readyMaterials,true);
 for(const k of ['mmSmithOk','mmUpFail','mmUpT','actionPayments'])assert.deepEqual(f.state.rt[k],before[k],k+' сохранён');assert.equal(f.state.rt.mmJob,undefined);assert.equal(f.state.rt.mmSmithReq,undefined);await f.M.bagAfterClaim('mail-1');assert.equal(f.gets.length,2,'native DOM fallback той же квитанции не дублирует GET');
});
test('claim во время старого GET отменяет preclaim snapshot и гарантирует новый GET после него',async()=>{
 const f=fixture({on:true});let release,entered;const waiting=new Promise(r=>entered=r),old=f.character();let first=true;f.reader=()=>{if(first){first=false;entered();return new Promise(r=>release=r)}return {ok:true,json:async()=>({character:f.character()})}};
 const oldRead=f.M.bagAuto();await waiting;f.stocks={...f.stocks,1893:13};const mail=f.M.bagAfterClaim('mail-race');release({ok:true,json:async()=>({character:old})});assert.equal((await oldRead).ok,false);await mail;assert.equal(f.gets.length,2);assert.equal(row(f.state.rt.mmBagAnalysis,1893).have,13);assert.equal(f.state.rt.mmBagAnalysis.readyMaterials,true);await f.M.bagAuto();assert.equal(f.gets.length,2);
});
test('настоящий claimStep после нативного подтверждения обновляет сумку без hook, observer той же квитанции не дублирует GET',async()=>{
 const f=fixture({on:true});const msg={textContent:'',offsetParent:{}},card={dataset:{attachmentId:'native-mail'},querySelector:()=>null},button={closest:()=>card};
 f.state.rt.mmMail={unc:[{a:'native-mail',n:'Oriharukon',q:13,s:'Crafter'}]};
 f.box.document.querySelector=s=>s.includes('[data-mail-tab="items"]')?{classList:{contains:()=>true}}:s.includes('.l2-mail-item__claim')?button:s.includes('.l2-mail-items-msg')?msg:null;
 f.env.waitX=async fn=>fn();f.env.fire=()=>{msg.textContent='Предмет в сумке';f.stocks={...f.stocks,1893:13}};
 await f.M.claimStep({kind:'claim',t:1800000000000,mailStarted:true,got:[]});for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(f.state.rt.mmJob.got.length,1);assert.equal(f.gets.length,1);assert.equal(f.state.rt.mmBagAnalysis.readyMaterials,true);await f.claim('native-mail');assert.equal(f.gets.length,1);
});
test('старые ресурсы у крафтера не считаются содержимым рюкзака',async()=>{
 const f=fixture({on:true,rt:{mmCraft:{at:{1874:1000,1873:1000,1871:1000,1870:1000}}}});f.stocks={1893:0};const r=await f.M.bagAnalyze();assert.equal(row(r.analysis,1874,'raw').missing,65);assert.equal(row(r.analysis,1873,'raw').missing,156);assert.equal(r.analysis.readyMaterials,false);
});
test('уровень вне экипировки отмечен как неподтверждённый; полный инвентарь при этом прочитан',async()=>{
 const f=fixture({rt:{mmGear:[{id:910624,lvl:4}],mmGearT:1799999999999}});f.eq={};const r=await f.manual();assert.equal(r.ok,true);assert.equal(r.analysis.levelVerified,false);assert.equal(r.analysis.goal.lvl,4);assert.equal(r.analysis.resources[1874],11891);
});
