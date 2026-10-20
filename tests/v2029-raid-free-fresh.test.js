'use strict';
// 20.10: Tiphon найден, но бесплатный переход ошибочно отклонён; новый Start обязан читать весь список.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(process.env.RAID_FRESH_SOURCE||path.join(root,'modules/raid.js'),'utf8');
function fixture(){
 let now=1800000000000,page=1,rows=[{id:'tiphon',price:'Бесплатно',alive:true}],lastPage=1,waitHook=null,mapRows=[];
 const writes=[],clicks=[],recs=[],loc={pathname:'/rb-bosses.html',search:'',href:''},rt={char:'Hero',classCur:{prof:'dwarf_bounty_hunter',slot:1},dailyStart:10,manualKickAt:20,rbListStartRequired:'10:20',rbListReadStart:'old',rbScan:{start:'10:20'},rbListT:now,rbListVerifiedAt:now,rbListIncomplete:false,rbList:{old:{alive:false}},rbDb:{},rbStats:{},rbHunt:{step:'pick',phase:'wait'},rbHuntIdle:now+600000,rbFishWait:{until:now+600000},adenaSeen:{v:0,t:now},rbPaidAt:0};
 const makeRow=data=>{const button={dataset:{spawnId:data.id},closest:()=>row};const fields={'.l2-rb-row__tp[data-spawn-id]':button,'.l2-rb-row__label':{textContent:data.id},'.l2-rb-row__level':{textContent:'65'},'.l2-rb-row__price':{textContent:data.price},'.l2-rb-row__status':{className:data.alive?'l2-rb-row__status--alive':'dead',textContent:data.alive?'жив':'мёртв'}};const row={querySelector:s=>fields[s]||null};return row};
 const document={querySelectorAll:s=>s==='#rb-list .l2-rb-row'?rows.map(makeRow):s==='.l2-map-mob-pin--raid[data-spawn-id]'?mapRows.map(r=>({dataset:{spawnId:r.id},getAttribute:()=>`${r.id} · ур. ${r.lvl}`})):[]};
 const env={rt,cfg:{rbHuntMode:true,rbMaxBelow:15,rbMaxAbove:15,rbFaFull:false,rbSess:false,rbMaxKillMin:0,shopMaxSpend:0,shopReserve:200000},on:true,tabOwner:true,leaseEpoch:1,canAct:()=>true,RB_WIN:15,routeLocation:loc,
  $q:s=>s==='#rb-pager-ind'?{querySelectorAll:()=>Array.from({length:lastPage},(_,i)=>({textContent:String(i+1),disabled:page===i+1,getAttribute:()=>page===i+1?'page':null})),textContent:`${page}/${lastPage}`}:s==='#rb-list .l2-rb-row'?rows[0]||null:null,
  waitX:async p=>{if(waitHook){const h=waitHook;waitHook=null;await h()}return p()},sleep:async()=>{},rnd:()=>0,fire:b=>{clicks.push(b);if(/^\d+$/.test(b.textContent||'')){page=+b.textContent;rows=[{id:'next'+page,price:'0 аден',alive:false}]}return true},
  heroLvl:()=>68,aroundSig:()=>({ids:mapRows.map(r=>r.id)}),LV_RE:/(^)(.+) · ур\. (\d+)/,setStatus:s=>recs.push(s),rec:(...a)=>recs.push(a.join(' ')),recBot:s=>recs.push(s),setRt:async p=>{writes.push(p);Object.assign(rt,p);return{ok:true}},
  epicOn:()=>false,epicById:()=>null,meHp:()=>({cur:15000,max:15000,pct:100}),potModel:()=>({pool:600000,rate:600,H:600,C:1,n:1000,est:false,items:[]}),isMap:()=>false,
  warlock:{raidContext:()=>({managed:false,prepared:true})},payments:{blocked:()=>false},isBattle:()=>false,rbTimer:{domNote:()=>Promise.resolve()},fmtK:String,fmtT:String};
 const box={console,Date:class extends Date{static now(){return now}},Math,Number,URLSearchParams,setTimeout,clearTimeout,CSS:{escape:String},document,location:loc,performance:{timeOrigin:1}};vm.runInNewContext(source,box);let R=box.L2V7Factories.raid(env);
 return{env,rt,get R(){return R},loc,writes,clicks,recs,timer:f=>{box.setTimeout=f;box.clearTimeout=()=>{}},reload:()=>{box.performance.timeOrigin++;R=box.L2V7Factories.raid(env)},rows:v=>rows=v,map:v=>{mapRows=v;env.isMap=()=>true},pages:n=>lastPage=n,page:n=>page=n,wait:f=>waitHook=f,now:()=>now,time:v=>now=v,fresh:()=>{rt.rbListReadStart=rt.rbListStartRequired;rt.rbListT=rt.rbListVerifiedAt=now;rt.rbListIncomplete=false}};
}
for(const label of ['Бесплатно','Безкоштовно','Free',' ( Бесплатно ) ','Бесплатно (VIP)','Безкоштовно · VIP','VIP: Free','Бесплатно для VIP','Free for VIP','0 аден','(Аден 0)'])test('подтверждённая цена '+label+' разрешает переход без бюджета расходов',()=>{
 const f=fixture();f.rows([{id:'tiphon',price:label,alive:true}]);const row=f.R.rbRowsParse().tiphon;
 assert.equal(row.price,0);assert.equal(row.unit,'аден');assert.equal(f.R.rbTravelBudget(row),'');f.fresh();assert.notEqual(f.R.rbEntryDecision('tiphon',row).kind,'currency');
});
for(const label of ['', 'VIP', '0', '0 Coin of Luck', '0 FA', 'не бесплатно', 'not free', 'free after 5 CoL', 'Free (5 FA)', 'бесплатно 10 аден'])test('неизвестная или другая цена не становится бесплатной: '+label,()=>{
 const f=fixture();f.rows([{id:'tiphon',price:label,alive:true}]);const row=f.R.rbRowsParse().tiphon;
 assert.ok(f.R.rbTravelBudget(row));
});
test('положительная адена по-прежнему требует свежий кошелёк, лимит и резерв',()=>{
 const f=fixture(),row={price:100,unit:'аден'};assert.match(f.R.rbTravelBudget(row),/лимита/);
 f.env.cfg.shopMaxSpend=100;assert.match(f.R.rbTravelBudget(row),/резерва/);f.rt.adenaSeen.v=200100;assert.equal(f.R.rbTravelBudget(row),'');f.rt.adenaSeen.t-=60001;assert.match(f.R.rbTravelBudget(row),/свежий/);
});
test('старый готовый список не разрешает выбор или прямую проверку перехода после Start',()=>{
 const f=fixture(),row={lvl:65,alive:true,price:0,unit:'аден',t:f.now()};f.rt.rbList.tiphon=row;
 assert.equal(f.R.rbEntryDecision('tiphon',row).kind,'stale');assert.ok(f.R.rbTeleportCheck('tiphon',row,true));assert.equal(f.R.rbTourPlan().ready.length,0);
});
test('старый простой и шаг go сначала читают с первой страницы; 0 телепортов',async()=>{
 for(const step of ['pick','go']){const f=fixture();f.rt.rbHunt={step,phase:'wait',id:step==='go'?'tiphon':null,t:1};f.page(3);await f.R.rbHuntStep();assert.equal(f.loc.href,'/rb-bosses.html?page=1');assert.equal(f.clicks.length,0);assert.equal(f.rt.rbListReadStart,'old');assert.equal(f.rt.rbHuntIdle,0)}
});
test('все страницы заменяют старый список и подтверждают именно текущий Start',async()=>{
 const f=fixture();f.pages(3);await f.R.rbListScan();assert.deepEqual(Object.keys(f.rt.rbList),['tiphon','next2','next3']);assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.rt.rbListVerifiedAt,f.rt.rbListT);assert.equal(f.rt.rbListIncomplete,false);assert.equal(f.rt.rbListVerifyNextAt,0);assert.equal(f.clicks.length,2);
});
for(const mode of ['empty','partial'])test('неполный список '+mode+' не разрешает выбор, повтор ограничен тремя минутами',async()=>{
 const f=fixture();if(mode==='empty')f.rows([]);else{f.pages(2);f.env.fire=()=>false}await f.R.rbListScan();assert.equal(f.rt.rbListReadStart,null);assert.equal(f.rt.rbListVerifiedAt,0);assert.equal(f.rt.rbListIncomplete,true);assert.equal(f.rt.rbListVerifyNextAt,f.now()+180000);assert.equal(f.rt.rbList.old,undefined);
 const count=f.writes.length;await f.R.rbHuntStep();assert.equal(f.writes.length,count);assert.equal(f.clicks.length,0);assert.match(f.recs.at(-1),/180 с/);
 f.time(f.now()+180001);f.pages(1);f.rows([{id:'recovered',price:'Free',alive:true}]);await f.R.rbHuntStep();assert.equal(f.loc.href,'/rb-bosses.html?page=1');f.reload();await f.R.rbHuntStep();assert.equal(f.rt.rbListReadStart,'10:20');assert.deepEqual(Object.keys(f.rt.rbList),['recovered']);
});
for(const [name,change]of Object.entries({start:f=>f.rt.rbListStartRequired='11:21',kick:f=>f.rt.manualKickAt++,day:f=>f.rt.dailyStart++,char:f=>f.rt.char='Other',class:f=>f.rt.classCur.slot++,lease:f=>f.env.leaseEpoch++,stop:f=>f.env.on=false,owner:f=>f.env.tabOwner=false,cancel:f=>f.env.canAct=()=>false}))test('чтение отменяется при '+name+' во время ожидания',async()=>{
 const f=fixture();f.wait(()=>change(f));await f.R.rbListScan();assert.equal(f.writes.length,0);assert.equal(f.clicks.length,0);assert.equal(f.rt.rbListReadStart,'old');
});
test('поздний queued patch старого чтения не подтверждает новый Start',async()=>{
 const f=fixture();let queued;f.env.setRt=async p=>{queued=p;f.rt.rbListStartRequired='11:21';return{ok:true}};await f.R.rbListScan();Object.assign(f.rt,queued);
 assert.equal(f.rt.rbListStartRequired,'11:21');assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.R.rbEntryDecision('tiphon',f.rt.rbList.tiphon).kind,'stale');
});
test('неизвестный платёж сверяется до чтения списка и не удаляется',async()=>{
 const f=fixture(),p={kind:'mammon',id:'unknown'};f.rt.actionPayments={pending:p};f.env.payments={blocked:()=>true,pending:()=>p};await f.R.rbHuntStep();assert.equal(f.writes.length,0);assert.equal(f.clicks.length,0);assert.equal(f.rt.actionPayments.pending,p);
});
function quote(f,patch={}){return f.R.listPriceNote('/game/raid-bosses',{method:'GET',status:200,url:'/game/raid-bosses?page=1',res:{page:1,adenaCost:0,vipFreeApplied:true},eb:[{spawnId:'tiphon',bossType:'raid',adenaCost:0,vipFreeApplied:true}],...patch},{at:f.now(),char:f.rt.char,classKey:JSON.stringify([f.rt.classCur.prof,f.rt.classCur.slot]),lease:f.env.leaseEpoch,raidStart:f.rt.rbListStartRequired})}
test('реальный серверный контракт подтверждает нулевую адену для неизвестной подписи цены',()=>{
 const f=fixture();f.rows([{id:'tiphon',price:'VIP',alive:true},{id:'other',price:'VIP',alive:true}]);assert.equal(quote(f),true);
 const rows=f.R.rbRowsParse();assert.equal(rows.tiphon.unit,'аден');assert.equal(rows.tiphon.price,0);assert.equal(f.R.rbTravelBudget(rows.tiphon),'');assert.ok(f.R.rbTravelBudget(rows.other));assert.match(rows.tiphon.priceText,/сервер VIP/);
});
for(const [name,change] of Object.entries({expired:f=>f.time(f.now()+60001),page:f=>f.page(2),char:f=>f.rt.char='Other',class:f=>f.rt.classCur.slot++,lease:f=>f.env.leaseEpoch++,start:f=>f.rt.rbListStartRequired='new',kick:f=>f.rt.manualKickAt++}))test('серверная бесплатная цена теряет силу при '+name,()=>{
 const f=fixture();f.rows([{id:'tiphon',price:'VIP',alive:true}]);quote(f);change(f);assert.ok(f.R.rbTravelBudget(f.R.rbRowsParse().tiphon));
});
for(const patch of [{status:503},{method:'POST'},{error:'failed'},{res:{page:1,error:'failed'}},{res:{page:2}},{eb:[{spawnId:'tiphon',bossType:'raid',adenaCost:0}]},{eb:[{spawnId:'tiphon',bossType:'raid',adenaCost:null,vipFreeApplied:true}]},{eb:[{spawnId:'tiphon',bossType:'raid',adenaCost:0,vipFreeApplied:true,coinOfLuckCost:1}]}])test('неполный или противоречивый ответ не выдаёт бесплатное разрешение '+JSON.stringify(patch),()=>{
 const f=fixture();f.rows([{id:'tiphon',price:'VIP',alive:true}]);quote(f,patch);assert.ok(f.R.rbTravelBudget(f.R.rbRowsParse().tiphon));
});
test('явная CoL/FA в DOM остаётся запрещена даже при нулевой серверной адене',()=>{
 for(const label of ['0 Coin of Luck','0 FA','не бесплатно','500 жетонов']){const f=fixture();f.rows([{id:'tiphon',price:label,alive:true}]);quote(f);assert.ok(f.R.rbTravelBudget(f.R.rbRowsParse().tiphon))}
});
test('поздний бесплатный ответ после более нового отказа не возвращает разрешение',()=>{
 const f=fixture();f.rows([{id:'tiphon',price:'VIP',alive:true}]);const old=f.now();quote(f);f.time(old+1000);quote(f,{status:503});
 f.time(old);quote(f);f.time(old+1000);assert.ok(f.R.rbTravelBudget(f.R.rbRowsParse().tiphon));
});
test('Start на уже открытой page1 обновляет документ до чтения прежних строк',async()=>{
 const f=fixture();f.rt.rbScan=null;await f.R.rbListScan();assert.equal(f.loc.href,'/rb-bosses.html?page=1');assert.equal(f.rt.rbListReadStart,'old');assert.equal(f.rt.rbList.old.alive,false);assert.equal(f.rt.rbScan.start,'10:20');assert.equal(f.clicks.length,0);
 await f.R.rbListScan();assert.equal(f.rt.rbListReadStart,'old');assert.ok(f.rt.rbList.old);f.reload();await f.R.rbListScan();assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.rt.rbList.old,undefined);
});
test('отменённая навигация не подтверждает старый DOM и ограничена тайм-аутом с повтором',async()=>{
 const f=fixture();f.rt.rbScan=null;await f.R.rbListScan();f.time(f.now()+15001);await f.R.rbListScan();assert.equal(f.rt.rbListReadStart,null);assert.equal(f.rt.rbScan,null);assert.equal(f.rt.rbListVerifyNextAt,f.now()+180000);assert.equal(f.rt.rbListVerifiedAt,0);assert.equal(f.clicks.length,0);
});
test('реальный freshStart сохраняет текущий прилёт/бой; вход по точной цели на карте без повторного телепорта',()=>{
 const E=require('../engine-core.js');
 for(const step of ['arrive','fight']){const f=fixture();f.rt.rbHunt={step,id:'tiphon',at:f.now(),t:f.now()};Object.assign(f.rt,E.raidFreshStartPatch(f.rt,f.env.cfg,f.now()));f.map([{id:'tiphon',lvl:65}]);
  assert.deepEqual(Object.keys(f.rt.rbList),[]);assert.equal(f.R.rbEntryDecision('tiphon').ok,true);assert.ok(f.R.rbTeleportCheck('tiphon',undefined,true));assert.equal(f.rt.rbHunt.step,step);
 }
});
for(const [name,change] of Object.entries({missing:f=>f.map([]),other:f=>f.map([{id:'other',lvl:65}]),outside:f=>f.map([{id:'tiphon',lvl:10}]),denied:f=>f.rt.rbStats.tiphon={canAttack:false},skip:f=>f.rt.rbSkip={tiphon:f.now()},exit:f=>f.rt.rbDb.tiphon={leaveBadUntil:f.now()+10000}}))test('прилёт после freshStart не обходит '+name,()=>{
 const f=fixture();f.rt.rbHunt={step:'arrive',id:'tiphon'};Object.assign(f.rt,require('../engine-core.js').raidFreshStartPatch(f.rt,f.env.cfg,f.now()));f.map([{id:'tiphon',lvl:65}]);change(f);assert.equal(f.R.rbEntryDecision('tiphon').ok,false);
});
function paidFixture(){
 const f=fixture();f.fresh();f.rt.rbHunt={step:'go',id:'tiphon',t:f.now()};f.rows([{id:'tiphon',price:'VIP',alive:true}]);quote(f);
 const b={dataset:{spawnId:'tiphon'},isConnected:true},box={Date:class extends Date{static now(){return f.now()}},Math};
 f.env.canRun=()=>f.env.canAct()&&f.env.on&&f.env.tabOwner;f.env.lease=()=>f.env.leaseEpoch;f.env.autonomyMode=()=> 'raid';f.env.rtCommit=async()=>true;
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules/payments.js'),'utf8'),box);f.env.payments=box.L2V7Factories.payments(f.env);
 f.env.gameGet=async()=>({ok:true,json:async()=>({character:{name:f.rt.char,revision:1,adena:0}})});
 const patch={rbHunt:{step:'arrive',id:'tiphon',price:0,t:f.now()+1},rbWant:'tiphon'};
 return{...f,b,patch,run:()=>f.R.rbTeleportFire(b,patch)};
}
test('последняя проверка подтверждает один бесплатный переход настоящим payments и сохраняет неизвестный исход',async()=>{
 const f=paidFixture();assert.equal(await f.run(),true);assert.equal(f.clicks.length,1);assert.equal(f.env.payments.pending().quote.amount,0);assert.equal(f.rt.rbHunt.step,'arrive');assert.equal(await f.run(),false);assert.equal(f.clicks.length,1);
});
for(const when of ['get','prepare','commit'])test('серверная цена истекла во время '+when+' — 0 кликов, непосланный резерв отменён',async()=>{
 const f=paidFixture();let n=0;
 if(when==='get')f.env.gameGet=async()=>{f.time(f.now()+60001);return{ok:true,json:async()=>({character:{name:f.rt.char,revision:1,adena:0}})}};
 else f.env.rtCommit=async()=>{if(++n===(when==='prepare'?1:2))f.time(f.now()+60001);return true};
 assert.equal(await f.run(),false);assert.equal(f.clicks.length,0);assert.equal(f.env.payments.pending(),null);assert.equal(f.rt.rbHunt.step,'go');
});
for(const [name,change]of Object.entries({price:f=>f.rows([{id:'tiphon',price:'1 аден',alive:true}]),dead:f=>f.rows([{id:'tiphon',price:'Free',alive:false}]),missing:f=>f.rows([]),detached:f=>f.b.isConnected=false,disabled:f=>f.b.disabled=true,stopped:f=>f.env.on=false,kick:f=>f.rt.manualKickAt++,lease:f=>f.env.leaseEpoch++,cancel:f=>f.env.canAct=()=>false}))test('после последнего commit ещё проверяется '+name,async()=>{
 const f=paidFixture();let n=0;f.env.rtCommit=async()=>{if(++n===2)change(f);return true};assert.equal(await f.run(),false);assert.equal(f.clicks.length,0);
});
function priceReadFixture(){const f=fixture(),reads=[];f.rows([{id:'tiphon',price:'VIP',alive:true}]);f.env.gameGet=async url=>{reads.push(url);return{ok:true,status:200,json:async()=>({page:1,bosses:[{spawnId:'tiphon',bossType:'raid',adenaCost:0,vipFreeApplied:true}]})}};return{...f,reads}}
test('потерянный ранний native GET восполняется одним GET после аренды при полном чтении',async()=>{
 const f=priceReadFixture();await f.R.rbListScan();assert.deepEqual(f.reads,['/game/raid-bosses?page=1']);assert.equal(f.rt.rbList.tiphon.unit,'аден');assert.equal(f.rt.rbList.tiphon.price,0);assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.clicks.length,0);
});
test('при готовой native цене или известной цене нужного id дополнительный GET не нужен',async()=>{
 const f=priceReadFixture();quote(f);assert.equal(await f.R.rbPriceRefresh(()=>true),true);assert.equal(f.reads.length,0);
 const g=priceReadFixture();g.rows([{id:'tiphon',price:'0 аден',alive:true},{id:'other',price:'VIP',alive:true}]);assert.equal(await g.R.rbPriceRefresh(()=>true,'tiphon'),true);assert.equal(g.reads.length,0);
});
test('сбой цены даёт backoff15с и не выдаёт полный список/передачу рыбалке',async()=>{
 const f=priceReadFixture();f.env.gameGet=async url=>{f.reads.push(url);return{ok:false,status:503}};
 assert.equal(await f.R.rbPriceRefresh(()=>true),false);assert.equal(await f.R.rbPriceRefresh(()=>true),false);assert.equal(f.reads.length,1);
 f.time(f.now()+15001);await f.R.rbListScan();assert.equal(f.reads.length,2);assert.equal(f.rt.rbListVerifiedAt,0);assert.equal(f.rt.rbListReadStart,null);assert.equal(f.rt.rbListIncomplete,true);assert.equal(f.rt.rbListVerifyNextAt,f.now()+180000);
});
for(const [name,change]of Object.entries({char:f=>f.rt.char='Other',class:f=>f.rt.classCur.slot++,lease:f=>f.env.leaseEpoch++,start:f=>f.rt.rbListStartRequired='new',kick:f=>f.rt.manualKickAt++,generation:f=>f.env.actionGeneration=()=>2,page:f=>f.page(2),stop:f=>f.env.on=false,owner:f=>f.env.tabOwner=false,cancel:f=>f.env.canAct=()=>false}))test('own GET не подтверждает цену после '+name,async()=>{
 const f=priceReadFixture(),read=f.env.gameGet;f.env.actionGeneration=()=>1;f.env.gameGet=async url=>{const r=await read(url);change(f);return r};
 assert.equal(await f.R.rbPriceRefresh(()=>f.env.on&&f.env.tabOwner),false);assert.equal(f.R.rbRowsParse().tiphon.unit,'');assert.equal(f.clicks.length,0);
});
test('реальный go сам перечитывает неизвестную VIP-цену и отправляет ровно один бесплатный переход',async()=>{
 const f=paidFixture(),reads=[];quote(f,{status:503});Object.assign(f.rt.rbHunt,{name:'Tiphon',lvl:65,page:1,price:0});f.rt.rbList={tiphon:{lvl:65,alive:true,price:0,unit:'аден',t:f.now()}};
 const q=f.env.$q;f.env.$q=s=>s.startsWith('.l2-rb-row__tp[')?f.b:q(s);f.env.pause=async()=>{};
 f.env.gameGet=async url=>{reads.push(url);return{ok:true,status:200,json:async()=>url.startsWith('/game/raid-bosses')?{page:1,bosses:[{spawnId:'tiphon',bossType:'raid',adenaCost:0,vipFreeApplied:true}]}:{character:{name:f.rt.char,revision:1,adena:0}}}};
 await f.R.rbHuntStep();assert.equal(reads.filter(x=>x==='/game/raid-bosses?page=1').length,1);assert.equal(f.clicks.length,1);assert.equal(f.rt.rbHunt.step,'arrive');assert.equal(f.env.payments.pending().quote.amount,0);
});
for(const rows of [[],[{spawnId:'other',bossType:'raid',adenaCost:0,vipFreeApplied:true}],[{spawnId:'tiphon',bossType:'raid'}]])test('успешный HTTP с неполной ценой живой цели не подтверждает весь список '+JSON.stringify(rows),async()=>{
 const f=priceReadFixture();f.env.gameGet=async()=>({ok:true,status:200,json:async()=>({page:1,bosses:rows})});await f.R.rbListScan();assert.equal(f.rt.rbListVerifiedAt,0);assert.equal(f.rt.rbListIncomplete,true);assert.equal(f.rt.rbListReadStart,null);assert.equal(f.rt.rbListVerifyNextAt,f.now()+180000);
});
test('явно платная серверная цена покрывает чтение, но не выдаёт бесплатное разрешение',async()=>{
 const f=priceReadFixture();f.env.gameGet=async()=>({ok:true,status:200,json:async()=>({page:1,bosses:[{spawnId:'tiphon',bossType:'raid',adenaCost:100000,vipFreeApplied:false}]})});await f.R.rbListScan();assert.equal(f.rt.rbListVerifiedAt,f.rt.rbListT);assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.rt.rbList.tiphon.unit,'');assert.ok(f.R.rbTravelBudget(f.rt.rbList.tiphon));
});
test('все строки мертвы: неизвестная цена не требует GET и не мешает полному чтению',async()=>{
 const f=priceReadFixture();f.rows([{id:'tiphon',price:'VIP',alive:false}]);f.env.gameGet=async()=>{throw Error('цена мёртвой цели не нужна')};await f.R.rbListScan();assert.equal(f.rt.rbListVerifiedAt,f.rt.rbListT);assert.equal(f.rt.rbListReadStart,'10:20');assert.equal(f.rt.rbListIncomplete,false);assert.equal(f.rt.rbList.tiphon.alive,false);
});
test('зависшее тело JSON ограничено6с; позднее тело не применяет цену и сохраняется backoff',async()=>{
 const f=priceReadFixture();let expire,finish,reads=0;f.timer((fn,ms)=>{assert.equal(ms,6000);expire=fn;return 1});
 f.env.gameGet=async()=>{reads++;return{ok:true,status:200,json:()=>new Promise(resolve=>finish=resolve)}};
 const running=f.R.rbPriceRefresh(()=>true);await new Promise(setImmediate);assert.ok(finish);f.time(f.now()+6000);expire();assert.equal(await running,false);assert.equal(f.R.rbRowsParse().tiphon.unit,'');
 finish({page:1,bosses:[{spawnId:'tiphon',bossType:'raid',adenaCost:0,vipFreeApplied:true}]});await Promise.resolve();await Promise.resolve();assert.equal(f.R.rbRowsParse().tiphon.unit,'');assert.equal(await f.R.rbPriceRefresh(()=>true),false);assert.equal(reads,1);
});
