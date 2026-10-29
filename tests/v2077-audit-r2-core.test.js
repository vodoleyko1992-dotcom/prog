'use strict';
// 20.76+ (ревизия кода 28.10, второй круг, группа core): пауза сверки возврата после бафа суммона, единое правило снятия РБ-сессии
// при выбранном Rebirth (фон = вкладка) и защита круга от повторной отмены, фактическая свёрнутость встроенного меню на Android
// (dockOver), MP при закрытии своей смерти Rebirth, пауза после неудачного чтения /character и пауза чужой победы при незавершённом запросе.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const content=read('content.js'),background=read('background.js'),popup=read('popup.js');
const E=require('../engine-core.js');
const cutOf=src=>(a,b)=>{const i=src.indexOf(a);assert.ok(i>=0,'нет: '+a);const j=src.indexOf(b,i);assert.ok(j>i,'нет: '+b);return src.slice(i,j);};
const cut=cutOf(content),cutPopup=cutOf(popup);
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const clockClass=get=>class extends Date{constructor(...a){super(...(a.length?a:[get()]))}static now(){return get()}};

// ---------- 1. возврат после бафа суммона: сбой/отказ сверки не крутит два GET каждые 0,2 с ----------
const tripSource=cut('// Поход за платным бафом:','const warlockShotContext =');
function trip({adena=205000,mode='zone',fail=null}={}){
 let now=1793160000000;const nav=[],gets=[];let clicks=0;
 const priceEl={textContent:'8 000'},curEl={textContent:'адена'};
 const row={querySelector:s=>s.includes('price-num')?priceEl:s.includes('price-currency')?curEl:s.includes('price-adena')?{textContent:'8 000 адена'}:null};
 const btn={disabled:false,closest:()=>row},S={adena,fail,dungeon:null};
 const box={console,Date:clockClass(()=>now),Number,JSON,Set,URLSearchParams,Promise,crypto:{randomUUID:()=> 'trip-local'},CSS:{escape:s=>s},CAT_URL:'/catacombs.html',on:true,tabOwner:true,
  rebirthModeSelected:()=>false,cfg:{petFullAuto:true,tvtOn:true,shopReserve:200000,petFullReserve:null,shopMaxSpend:2000000,catDungeon:'witch'},
  rt:{char:'hero',zone:'forest_of_mirrors',catIn:'cat_witch'},
  location:{pathname:'/teleport.html',search:'',reload:()=>nav.push('reload')},document:{querySelectorAll:()=>[]},heroNick:()=> 'hero',autonomyMode:()=>mode,warlockCanRun:()=>true,
  antibotState:()=>false,abHold:()=>false,isFishing:()=>false,fishState:()=>false,isBattle:()=>false,victory:()=>false,fishNow:()=>false,
  L2V7Modules:{tvt:{tvtHold:()=>false},warlock:{step:async()=>{throw Error('unexpected payment')}}},setStatus(s){box.lastStatus=s},rtCommit:async()=>true,
  $q:s=>s.includes('teleport-id="forest_of_mirrors"')?btn:null,shown:()=>true,heroAt:()=>null,fire:()=>{clicks++;return true},
  gameGet:async p=>{gets.push(p);if(S.fail==='throw')throw Error('net');if(S.fail==='html')return{ok:true,json:async()=>{throw SyntaxError('html')}};
   if(S.fail==='500')return{ok:false,json:async()=>({error:'srv'})};
   return{ok:true,json:async()=>p==='/character'?{character:{name:'hero',adena:S.adena,revision:200,...(S.dungeon?{activeDungeonId:S.dungeon}:{})}}:{locations:[{teleportId:'forest_of_mirrors',adenaCost:8000}]}};}};
 Object.defineProperty(box.location,'href',{set:s=>nav.push(s)});
 box.setRt=async p=>{Object.assign(box.rt,p);return{ok:true}};
 vm.createContext(box);vm.runInContext(tripSource+'\nglobalThis.api={warlockTownStart,warlockTripStep};',box);
 return{box,S,nav,gets,clicks:()=>clicks,tick:ms=>{now+=ms},api:box.api};
}
async function inReturn(o){const f=trip(o);assert.equal(await f.api.warlockTownStart({char:'hero',revision:100,price:10000000}),true);
 Object.assign(f.box.rt.petBufferTrip,{phase:'return',entry:{job:'trip-local',char:'hero',revision:101,at:Date.now()}});f.nav.length=0;return f;}
const ticks=async(f,n)=>{for(let i=0;i<n;i++)await f.api.warlockTripStep();};

test('отказ резерва адены: 20 тактов без хода часов — одна пара GET, через 30 с — следующая, клика нет',async()=>{
 const f=await inReturn();await ticks(f,20);
 same(f.gets,['/character','/game/teleport/locations'],'одна сверка вместо 40 GET');assert.equal(f.box.rt.petBufferTrip.phase,'return');assert.equal(f.clicks(),0);
 assert.match(f.box.lastStatus,/резерв адены/);
 f.tick(29999);await ticks(f,5);assert.equal(f.gets.length,2,'до 30 с не повторяем');
 f.tick(1);await ticks(f,5);assert.equal(f.gets.length,4,'через 30 с — одна новая сверка');assert.equal(f.clicks(),0);
 // Адена выросла (например, игрок пополнил): следующая сверка проходит и жмёт штатный телепорт один раз.
 f.S.adena=500000;f.tick(30000);await ticks(f,3);assert.equal(f.clicks(),1);assert.equal(f.box.rt.petBufferTrip.phase,'returnSent');assert.equal(f.gets.length,6);
});
for(const fail of ['throw','html','500'])test('сбой сверки возврата ('+fail+'): пауза 5 → 10 → 20 с, затем успешная сверка без задержки',async()=>{
 const f=await inReturn({fail});await ticks(f,10);assert.equal(f.gets.length,2,'один сбой — одна пара GET');
 f.tick(4999);await ticks(f,3);assert.equal(f.gets.length,2);f.tick(1);await ticks(f,3);assert.equal(f.gets.length,4,'через 5 с');
 f.tick(9999);await ticks(f,3);assert.equal(f.gets.length,4,'второй сбой — пауза 10 с');f.tick(1);await ticks(f,3);assert.equal(f.gets.length,6);
 f.tick(19999);await ticks(f,3);assert.equal(f.gets.length,6,'третий — 20 с');
 f.S.fail=null;f.S.adena=500000;f.tick(1);await ticks(f,1);assert.equal(f.gets.length,8);assert.equal(f.clicks(),1);assert.equal(f.box.rt.petBufferTrip.phase,'returnSent');
});
test('сбой растёт не дальше 60 с',async()=>{
 const f=await inReturn({fail:'throw'});await ticks(f,1);
 for(const wait of [5000,10000,20000,40000,60000,60000]){f.tick(wait-1);await ticks(f,2);const n=f.gets.length;f.tick(1);await ticks(f,2);assert.equal(f.gets.length,n+2,'повтор через '+wait);}
});
test('достаточно адены: клик и returnSent на первом же такте, без задержки',async()=>{
 const f=await inReturn({adena:500000});await ticks(f,1);assert.equal(f.clicks(),1);assert.equal(f.box.rt.petBufferTrip.phase,'returnSent');assert.equal(f.gets.length,2);
});
test('returnEnter: ожидание activeDungeonId опрашивает /character не чаще раза в 3 с и завершает поход по подтверждению',async()=>{
 const f=trip({mode:'cat'});assert.equal(await f.api.warlockTownStart({char:'hero',revision:100,price:10000000}),true);
 Object.assign(f.box.rt.petBufferTrip,{phase:'returnEnter',entry:{job:'trip-local',char:'hero',revision:101,at:Date.now()},home:{...f.box.rt.petBufferTrip.home,mode:'cat',catIn:'cat_witch',catDungeon:'witch'}});
 Object.assign(f.box.location,{pathname:'/dungeon.html',search:'?dungeonId=cat_witch'});
 await ticks(f,20);same(f.gets,['/character']);assert.equal(f.box.rt.petBufferTrip.phase,'returnEnter');assert.match(f.box.lastStatus,/прежние катакомбы/);
 f.tick(2999);await ticks(f,5);assert.equal(f.gets.length,1);f.tick(1);await ticks(f,5);assert.equal(f.gets.length,2);
 f.S.dungeon='cat_witch';f.tick(3000);await ticks(f,1);assert.equal(f.gets.length,3);assert.equal(f.box.rt.petBufferTrip,null,'поход завершён подтверждением сервера');
 assert.equal(f.clicks(),0,'платный телепорт не повторялся');
});

// ---------- 2. РБ-сессия при выбранном Rebirth: фон снимает по тому же правилу, что и вкладка ----------
function retireFn(withCore){
 const box=withCore?{L2EngineCore:E}:{};vm.runInNewContext(background.slice(background.indexOf('function retireRaidSessionPatch('),background.indexOf('// 20.35: уменьшение серии'))+'\nthis.apply=retireRaidSessionPatch;',box);return box.apply;
}
const session={on:true,start:111,bought:true,until:3000000,fa:152,sum:{kills:2}};
for(const [name,cfg,want] of [['старый rebirthMode без autoTasks',{rebirthMode:true},true],['autoTasks rebirth+raid',{autoTasks:['rebirth','raid']},true],
  ['только rebirth',{autoTasks:['rebirth']},true],['массив без raid',{autoTasks:['fish']},true],['массив с raid',{autoTasks:['raid','fish']},false],
  ['старый тур без массива',{rbHuntMode:true},false],['пустые настройки',{},false]])test('фон: '+name+' → сессия '+(want?'снимается':'остаётся'),()=>{
 const r=retireFn(true)({retireRaidSession:{start:111}},{rbSess:session},cfg,5000);
 assert.equal(r.retired,want);assert.equal(Object.hasOwn(r.patch,'retireRaidSession'),false,'ключ намерения не пишется');
 if(want){assert.equal(r.patch.rbSess.on,false);assert.equal(r.patch.rbSess.end,5000);for(const k of ['start','bought','until','fa','sum'])same(r.patch.rbSess[k],session[k],k);}
 else assert.equal(Object.hasOwn(r.patch,'rbSess'),false);
});
test('фон без ядра (стенды) — прежнее правило массива; новая сессия и чужой start не снимаются',()=>{
 const bare=retireFn(false);assert.equal(bare({retireRaidSession:{start:111}},{rbSess:session},{rebirthMode:true},1).retired,false);
 assert.equal(bare({retireRaidSession:{start:111}},{rbSess:session},{autoTasks:['rebirth']},1).retired,true);
 const full=retireFn(true);assert.equal(full({retireRaidSession:{start:110}},{rbSess:session},{rebirthMode:true},1).retired,false,'другая сессия');
 assert.equal(full({retireRaidSession:{start:111},rbSess:{on:true,start:222}},{rbSess:session},{rebirthMode:true},1).retired,false,'запись сессии в том же пакете важнее');
});
const policySource=cut('async function loopTaskList()','// 15.10: заточка — отдельный режим.');
function policy({cfg,withCore=true}){
 let now=1793160000000;const logs=[],writes=[],state={rt:{char:'Hero',manualKickAt:1,rbSess:{...session}}},apply=retireFn(withCore);
 const save=async p=>{writes.push(structuredClone(p));Object.assign(state.rt,apply(p,state.rt,cfg,now).patch);return{ok:true}};
 const core={Date:clockClass(()=>now),rebirthModeSelected:()=>E.rebirthSelected(cfg),sealQueue:async()=>false,on:true,tabOwner:true,L2EngineCore:E,L2V7Modules:{},taskPolicyNote(){},setRt:save,
  rec:(...a)=>logs.push(a.join(' ')),autonomyMode:()=> 'rebirth',isBattle:()=>false,isFishing:()=>false,fishState:()=>null,fishFight:async()=>{},battle:async()=>{},tasksIdle:async()=>{},sleep:async()=>{}};
 Object.defineProperties(core,{cfg:{get:()=>cfg},rt:{get:()=>state.rt}});vm.runInNewContext(policySource+'\nthis.step=loopTaskList;',core);
 return{state,logs,writes,step:core.step,tick:ms=>{now+=ms}};
}
for(const cfg of [{rebirthMode:true},{autoTasks:['rebirth','raid']}])test('круг задач: '+JSON.stringify(cfg)+' — сессия снимается с первого раза, второй круг идёт дальше',async()=>{
 const f=policy({cfg});assert.equal(await f.step(),true);assert.equal(f.state.rt.rbSess.on,false);assert.equal(f.state.rt.rbSess.start,111);
 assert.equal(f.logs.filter(x=>/retireRaidSession/.test(x)).length,1);
 assert.equal(await f.step(),undefined,'круг отдаёт управление Rebirth');assert.equal(f.writes.length,1);assert.equal(f.logs.length,1);
});
test('защита: если фон всё же не снял сессию — отмена не чаще раза в 5 с, круг между ними не держится',async()=>{
 const f=policy({cfg:{rebirthMode:true},withCore:false});
 const results=[];for(let i=0;i<10;i++)results.push(await f.step());
 assert.equal(results[0],true);assert.ok(results.slice(1).every(x=>x===undefined),'Rebirth получает ход: '+JSON.stringify(results));
 assert.equal(f.writes.length,1,'одна запись вместо десяти');assert.equal(f.logs.length,1,'одна строка журнала');assert.equal(f.state.rt.rbSess.on,true);
 f.tick(4999);await f.step();assert.equal(f.writes.length,1);f.tick(1);assert.equal(await f.step(),true);assert.equal(f.writes.length,2,'повтор через 5 с');
});
test('новая сессия (другой start) отменяется сразу, без ожидания 5 с',async()=>{
 const f=policy({cfg:{rebirthMode:true},withCore:false});await f.step();f.state.rt.rbSess={...session,start:222};
 assert.equal(await f.step(),true);assert.equal(f.writes.length,2);same(f.writes[1],{retireRaidSession:{start:222}});
});

// ---------- 3. Android поверх игры: меню в iframe — по фактической свёрнутости дока ----------
function menu(){
 let now=1000,seq=0;const timers=[],loads=[],listeners={},winListeners={},counts=[];let storeCb=null;
 const parent={postMessage(){}};
 const document={hidden:false,documentElement:{classList:{add(){}}},addEventListener:(t,f)=>{(listeners[t]||=[]).push(f)},dispatchEvent:e=>{(listeners[e.type]||[]).forEach(f=>f(e));return true},
  getElementById:()=>({classList:{contains:()=>false}}),querySelector:()=>({id:'tab-overview'})};
 const c={console,Object,Array,String,Math,JSON,Promise,Set,Date:{now:()=>now},document,DOCKED:true,parent,Event:class{constructor(t){this.type=t}},location:{search:'?dock=1'},
  addEventListener:(t,f)=>{(winListeners[t]||=[]).push(f)},setInterval:()=>0,
  setTimeout:(fn,ms)=>{const id=++seq;timers.push({id,at:now+Math.max(0,ms||0),fn});return id},clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1)},
  onStore:fn=>{storeCb=fn},load:()=>{loads.push(now);return Promise.resolve()},renderWorkspace(){},restoreTabScroll(){},showCounts:(r,s)=>counts.push([r,s]),huntOpen:()=>false,craftRt:{},
  chrome:{storage:{onChanged:{addListener:f=>{c.panelStore=f}}}}};
 for(const f of ['renderEpics','renderRbTimer','renderHunt','renderRb','renderMammon','renderCraft','renderZones'])c[f]=()=>{};
 vm.createContext(c);
 vm.runInContext(cutPopup('const DOCKED = /dock=1/','// 8.0.7 (игрок 11.10')+'\n'+cutPopup('const isLiveKey','async function liveStatusInto')+'\n'
  +cutPopup('function loadSoon(gap',"document.addEventListener('visibilitychange'")+'\n'+cutPopup('function panelShown(el)','panelRefresher($(')+'\nuserT=-1e9;',c);
 const advance=ms=>{const end=now+ms;for(;;){timers.sort((a,b)=>a.at-b.at);const t=timers[0];if(!t||t.at>end)break;timers.shift();now=t.at;t.fn();}now=end;};
 const msg=(data,source=parent)=>(winListeners.message||[]).forEach(f=>f({source,data}));
 return{c,loads,counts,advance,msg,parent,store:ch=>storeCb(ch),run:s=>vm.runInContext(s,c),listeners};
}
const botWrite={rt:{newValue:{char:'Hero',_src:'content'},oldValue:{char:'Hero'}}};
test('меню в iframe: cfg.dockMin=true, но страница сообщила «открыто язычком» — записи бота снова перерисовывают меню',async()=>{
 const D=menu();D.run('dockMin = dockMinNow(true)');assert.equal(D.run('dockMin'),true,'до сообщения — прежний cfg.dockMin');
 D.store(botWrite);D.advance(5000);assert.equal(D.loads.length,0,'свёрнутое не рисуем');assert.equal(D.run('loadPending'),true);
 D.msg({__l2dock:'min',min:false});assert.equal(D.run('dockMin'),false);D.advance(10);assert.equal(D.loads.length,1,'пропущенное догоняется сразу');assert.equal(D.counts.length,1,'счётчики журнала тоже');
 for(let i=0;i<5;i++){D.store(botWrite);D.advance(2000);}assert.equal(D.loads.length,6,'каждая запись бота видна');
 // Общая настройка с ПК не перекрывает фактическое состояние дока.
 D.store({cfg:{newValue:{dockMin:true}}});D.advance(1000);assert.equal(D.run('dockMin'),false);D.store(botWrite);D.advance(2000);assert.ok(D.loads.length>=8);
});
test('обратный случай: cfg.dockMin=false, а док свёрнут язычком — меню не перерисовывается невидимым',()=>{
 const D=menu();D.run('dockMin = dockMinNow(false)');D.msg({__l2dock:'min',min:true});assert.equal(D.run('dockMin'),true);
 for(let i=0;i<5;i++){D.store(botWrite);D.advance(2000);}assert.equal(D.loads.length,0);
});
test('чужой источник и неверная форма сообщения не меняют свёрнутость',()=>{
 const D=menu();D.run('dockMin = dockMinNow(true)');D.msg({__l2dock:'min',min:false},{postMessage(){}});D.msg({__l2dock:'min',min:'no'});D.msg({__l2dock:'hb'});
 assert.equal(D.run('dockMin'),true);assert.equal(D.run('dockView'),null);
});
test('панели Заточки/Warlock/PvP: раскрытие язычком обновляет устаревшую панель',()=>{
 const D=menu();D.run('dockMin = dockMinNow(true)');let refreshed=0;
 const el={closest:()=>null,contains:()=>false};D.c.panelEl=el;D.c.refreshPanel=async()=>{refreshed++};D.run('panelRefresher(panelEl, refreshPanel, 100)');
 D.c.panelStore({rt:{}});D.advance(500);assert.equal(refreshed,0,'свёрнутое не обновляется');
 D.msg({__l2dock:'min',min:false});D.advance(200);assert.equal(refreshed,1,'показали — обновили один раз');
});

// Страница игры: сообщает фактическую свёрнутость дока и не мерит сторожа по cfg.dockMin.
function page({android=true,dockMin=true,open='1'}={}){
 let now=5000000;const posts=[],intervals=[],winListeners={},store={'l2bot-dockOpen':open},replaced=[];
 const el=tag=>{const e={tag,style:{},children:[],attrs:{},id:'',classList:{toggle(){},remove(){}},setAttribute(k,v){e.attrs[k]=v},addEventListener(){},append(...x){e.children.push(...x)},
  querySelector:s=>s==='#l2bot-dock-toggle'?e.children.find(x=>x.id==='l2bot-dock-toggle'):s==='#l2bot-dock-wide'?e.children.find(x=>x.id==='l2bot-dock-wide'):null,remove(){},
  cloneNode:()=>el(tag),replaceWith:n=>replaced.push(n)};if(tag==='iframe')e.contentWindow={postMessage:(m,o)=>posts.push([structuredClone(m),o])};return e;};
 let wrap=null;
 const document={hidden:false,body:null,documentElement:{clientWidth:800,appendChild:w=>{wrap=w}},createElement:el,getElementById:id=>id==='l2bot-dock'?wrap:null,
  querySelector:s=>s==='#l2bot-dock iframe'?wrap?.children.find(x=>x.tag==='iframe')||null:null};
 // URL Node даёт origin 'null' для chrome-extension://, браузер — сам адрес расширения.
 const c={console,URL:class{constructor(u){this.origin=String(u).match(/^[a-z-]+:\/\/[^/]+/)[0]}},Date:clockClass(()=>now),JSON,document,navigator:{userAgent:android?'Mozilla/5.0 (Android 14; Tablet)':'Mozilla/5.0 (X11; Linux)'},
  window:{},innerWidth:800,cfg:{dock:true,dockMin},tabOwner:true,rec(){},ui:{classList:{toggle(){},remove(){}}},draw(){},
  chrome:{runtime:{getURL:p=>'chrome-extension://abc/'+p}},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}},
  addEventListener:(t,f)=>{(winListeners[t]||=[]).push(f)},setInterval:fn=>{intervals.push(fn);return intervals.length},
  dockGameBounds:()=>({right:0,left:0,observed:[]}),layoutInd(){},scheduleDock(){},dockObserver:null,dockObserved:[],dockWaiter:null,MutationObserver:undefined,ResizeObserver:undefined};
 c.window.top=c.window;c.self=c.window;
 vm.createContext(c);vm.runInContext('window=globalThis.window;\n'+cut('let dockHb = 0, dockBorn = 0','// 7.2.1 (игрок 10.10')+'\n'+cut('const ANDROID = ',"addEventListener('resize', scheduleDock);"),c);
 // dock() сравнивает window.top с window — в стенде это один объект.
 // 20.78+: готовность подтверждает только пульс текущего iframe, а не произвольный объект с postMessage.
 const hb=(source=document.querySelector('#l2bot-dock iframe')?.contentWindow)=>(winListeners.message||[]).forEach(f=>f({data:{__l2dock:'hb'},origin:'chrome-extension://abc',source}));
 return{c,posts,store,replaced,hb,watch:()=>intervals.forEach(f=>f()),tick:ms=>{now+=ms},run:s=>vm.runInContext(s,c)};
}
test('страница: dockOver открыт язычком при cfg.dockMin=true — в iframe уходит «открыто», закрытие — «свёрнуто»',()=>{
 const P=page();P.run('dock()');same(P.posts,[],'20.78+: до пульса iframe ещё может иметь origin игры');
 P.hb();same(P.posts,[[{__l2dock:'min',min:false},'chrome-extension://abc']]);
 P.run('dock()');assert.equal(P.posts.length,1,'без изменений не шлём повторно');
 P.store['l2bot-dockOpen']='0';P.run('dock()');same(P.posts.at(-1),[{__l2dock:'min',min:true},'chrome-extension://abc']);
 // Пульс меню (iframe загрузился позже) получает текущее состояние ответом.
 P.hb();same(P.posts.at(-1),[{__l2dock:'min',min:true},'chrome-extension://abc']);
});
test('страница на ПК: свёрнутость по cfg.dockMin, как раньше, и тоже сообщается меню',()=>{
 const P=page({android:false,dockMin:true,open:'1'});P.run('dock()');same(P.posts,[],'20.78+: сначала загрузка собственного iframe');
 P.hb();same(P.posts.at(-1)[0],{__l2dock:'min',min:true});
 P.c.cfg={dock:true,dockMin:false};P.run('dock()');same(P.posts.at(-1)[0],{__l2dock:'min',min:false});
});
test('сторож дока: открытое язычком меню при cfg.dockMin=true перезапускается после 20 с тишины; свёрнутое — нет',()=>{
 const P=page();P.run('dock()');P.hb();P.tick(25000);P.watch();assert.equal(P.replaced.length,1,'упавшее открытое меню перезапущено');
 const Q=page({open:'0',dockMin:false});Q.run('dock()');Q.hb();Q.tick(25000);Q.watch();assert.equal(Q.replaced.length,0,'свёрнутое язычком не трогаем');
});

// ---------- 4. Rebirth: закрытие своей смерти по MP и пауза после неудачного чтения /character ----------
function load(name,cutAt,tail){const file=path.join(__dirname,name),src=fs.readFileSync(file,'utf8');
 const box={require:require('node:module').createRequire(file),__dirname,path,console,URL,URLSearchParams,Date,structuredClone,process};
 vm.runInNewContext(src.slice(0,src.indexOf(cutAt))+'\n'+tail,box);return box;}
const core=load('v2073-rebirth-hero-core.test.cjs',"\ntest('",'this.make=fixture;');
const RUN='11111111-1111-4111-8111-111111111111',SPAWN='rebirth_raid_'+RUN+'_2_1_25394_lv38_mob_9';
function died(o={}){
 const f=core.make(o),at=f.now()-200000;
 f.c.rt.rebirth={failedRun:{kind:'death',char:'Hero',actor:'own-actor',prof:'human_wizard',slot:0,kick:5,runId:RUN,spawn:SPAWN,at}};f.c.rt.deathLog=[at];
 return f;
}
const steps=f=>f.events.filter(x=>x==='paid-run-step').length;
test('своя смерть, HP полное, MP 10 % — не закрывается по шапке: восстановление у баффера с маркером смерти',async()=>{
 const f=died();Object.assign(f.ch,{hp:f.ch.maxHp,mp:100,maxMp:1000});await f.c.loopRebirth();
 same(f.reads,['/character']);assert.ok(f.events.includes('buff'),'идём к бесплатному «Восстановить»');assert.equal(steps(f),0,'AutoEnter не получает ход');
 assert.equal(f.c.rt.rebirth.failedRun.restoredAt,undefined);assert.equal(f.writes[0].tbuff.rebirthRecovery.kind,'death');
});
test('своя смерть, HP и MP полные — закрывается свежим сервером, как раньше',async()=>{
 const f=died();Object.assign(f.ch,{hp:f.ch.maxHp,mp:995,maxMp:1000});await f.c.loopRebirth();
 assert.ok(!f.events.includes('buff'));assert.equal(steps(f),1);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,f.now());
});
test('обычная подготовка (без смерти) по-прежнему смотрит только на HP',async()=>{
 const f=core.make();Object.assign(f.ch,{hp:f.ch.maxHp,mp:10,maxMp:1000});assert.equal(await f.c.rebirthPrepareHero(f.ch),false);assert.ok(!f.events.includes('buff'));
});
for(const kind of ['throw','http','error'])test('неудачное чтение /character ('+kind+') при открытой смерти: следующий GET через 3 с, поход не начинается',async()=>{
 const f=died();f.ch.hp=f.ch.maxHp;
 if(kind==='throw')f.S.throwRead=true;if(kind==='http')f.S.readOk=false;
 if(kind==='error'){const get=f.c.gameGet;f.c.gameGet=async(...a)=>{const r=await get(...a);return{ok:true,json:async()=>({error:'srv'})};};}
 for(let i=0;i<10;i++)await f.c.loopRebirth();
 same(f.reads,['/character'],'одна попытка вместо десяти');assert.equal(steps(f),0,'смерть не закрыта — ход похода не дан');
 f.tick(2999);await f.c.loopRebirth();assert.equal(f.reads.length,1);f.tick(1);await f.c.loopRebirth();assert.equal(f.reads.length,2,'повтор через 3 с');
 f.S.throwRead=false;f.S.readOk=true;if(kind==='error')delete f.c.gameGet;
});
test('чтение удалось после паузы — смерть закрывается, как обычно',async()=>{
 const f=died();f.ch.hp=f.ch.maxHp;f.S.throwRead=true;await f.c.loopRebirth();f.S.throwRead=false;
 await f.c.loopRebirth();assert.equal(f.reads.length,1);f.tick(3000);await f.c.loopRebirth();assert.equal(f.reads.length,2);assert.equal(f.c.rt.rebirth.failedRun.restoredAt,f.now());assert.equal(steps(f),1);
});
test('низкое HP и сбой чтения: тоже не чаще раза в 3 с',async()=>{
 const f=core.make();f.S.throwRead=true;for(let i=0;i<6;i++)await f.c.loopRebirth();assert.equal(f.reads.length,1);assert.ok(!f.events.includes('buff'));
});

// ---------- 5. чужая завершённая победа: незавершённый запрос игры — пауза с причиной, а не холостой круг ----------
const routeFile=path.join(__dirname,'v2071-rebirth-route-isolation.test.cjs'),routeSrc=fs.readFileSync(routeFile,'utf8');
const route={require:require('node:module').createRequire(routeFile),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(routeSrc.slice(0,routeSrc.indexOf("\ntest('"))+routeSrc.slice(routeSrc.indexOf('function victoryFixture('),routeSrc.indexOf("test('отдельное продолжение"))+'\nthis.won=victoryFixture;',route);
function foreign(){
 const f=route.won(),name=f.ctx.name,spawn='dense_1';f.location.href='https://l2wap.com/battle.html?spawnId='+spawn;
 const statuses=[],sleeps=[];f.env.setStatus=s=>statuses.push(s);f.env.sleep=async ms=>{sleeps.push(ms)};f.env.battleInfo=()=>({t:1,spawn,name});
 return{...f,statuses,sleeps,ctx:{name,spawnId:spawn}};
}
for(const change of ['native','commit'])test('чужая победа: '+change+' — пауза 1 с со статусом, без кликов и перехода',async()=>{
 const f=foreign();if(change==='native')f.S.native=true;if(change==='commit')f.S.saveOk=false;
 await f.api().nextFight(f.ctx);
 assert.equal(f.location.pathname,'/battle.html');same(f.sleeps,[1000]);assert.ok(f.statuses.some(s=>/жду завершения запроса игры перед выходом в каталог/.test(s)),JSON.stringify(f.statuses));
 assert.equal(f.clicks.length,0);assert.equal(f.posts.length,0);
});
test('чужая победа без помех — выход в каталог сразу, без паузы',async()=>{
 const f=foreign();await f.api().nextFight(f.ctx);assert.equal(f.location.pathname,'/rebirth-raids.html');same(f.sleeps,[]);
});
test('Stop во время чужой победы — без паузы и статуса',async()=>{
 const f=foreign();f.env.on=false;await f.api().nextFight(f.ctx);same(f.sleeps,[]);assert.ok(!f.statuses.some(s=>/жду завершения/.test(s)));
});
