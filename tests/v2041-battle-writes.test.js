'use strict';
// 20.41 (лог 20.10 21:09: память 1,3 МБ, «бот стал очень медленный»; замер цепочки катакомб в настоящем MV3 —
// tests/v2041-battle-writes-browser.cjs): каждая обычная запись rt — полный get+set памяти в фоне (0,4–1,3 с) и рассылка
// старого+нового значения всем страницам. Убраны лишние обычные записи обычного боя:
//  • слоты классов (subclass.charNote) переписывались после каждой чужой записи rt: хранилище Chrome отдаёт ключи по алфавиту;
//  • запасы клика (clickLockA/B), причина ожидания боя (combatWait) и минутная копия статуса — отложенным пакетом (до 8 с);
//  • при уходе со страницы очередь уходила дважды: pagehide (peek) и сразу за ним visibilitychange (recover) — флаг pageGone ядра (ревью 2);
//  • вкладка в фоне перед каждым продлением замка (vis:false — условие, при котором замок забирает видимая вкладка) дописывает отложенное.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const content=read('content.js'),combat=read('modules/combat.js'),core=require('../engine-core.js');
const slice=(src,a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return src.slice(i,j);};
// Как chrome.storage: после записи и чтения ключи объектов — по алфавиту (так rt приходит вкладке в onChanged после записи фона)
const viaStorage=v=>Array.isArray(v)?v.map(viaStorage):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,viaStorage(v[k])])):v;
// Настоящие setRt/setRtSoon ядра (RT_STAT_SOON) поверх настоящей очереди engine-core; send — одно сообщение statePatch в фон
function core20(){
 const sent=[],timers=[],c={rt:{char:'Hero'},rtSizeT:Date.now(),rtBigWarnT:0,RT_BULKY:['spawns'],rec(){},rtSizeTop:()=>'',tabIdle:false,document:{},Date,JSON,Object,Math,Promise};
 c.rtWriter=core.createPatchQueue(async b=>{sent.push(Object.keys(b).sort().join(','));return{ok:true}},()=>true,()=>{},()=>Date.now(),{set:f=>{timers.push(f);return timers.length},clear(){}});
 vm.runInNewContext(slice(content,'function setRt(p) {','const RECENT = [];')+';this.setRt=setRt;this.setRtSoon=setRtSoon;',c);
 return {c,sent,timers,settle:()=>new Promise(r=>setImmediate(r))};
}
function subclass(env){const box={console};vm.runInNewContext(read('modules/subclass.js'),box);return box.L2V7Factories.subclass(env);}
const ch=(lvl=71)=>({name:'Hero',classSlots:{activeSlot:1,secondAndThirdUnlocked:false,slots:[{slot:0,profession:'human_arcana_lord',active:false,owned:true,level:78},{slot:1,profession:'dwarf_bounty_hunter',active:true,owned:true,level:lvl},{slot:2,owned:false},{slot:3,owned:false}]}});

test('слоты классов: после записи фона (ключи по алфавиту) тот же /character память не переписывает',async()=>{
 const K=core20(),S=subclass({get rt(){return K.c.rt},setRt:p=>K.c.setRt(p),cfg:{}});
 assert.equal(S.charNote(ch()),true,'первый ответ — запись');await K.settle();assert.equal(K.sent.length,1);
 // Ловушка, из-за которой писалось каждый раз: та же строка, но другой порядок ключей
 assert.notEqual(JSON.stringify(K.c.rt.subSlots),JSON.stringify(viaStorage(K.c.rt.subSlots)));
 for(let mob=0;mob<6;mob++){K.c.rt=viaStorage(K.c.rt);for(let turn=0;turn<3;turn++)assert.equal(S.charNote(ch()),false);}   // чужая запись → rt из хранилища; GET /character после каждого хода
 await K.settle();assert.equal(K.sent.length,1,'6 мобов × 3 хода — ни одной новой записи');
 assert.equal(S.charNote(ch(72)),true,'новый уровень саба — запись');await K.settle();assert.equal(K.sent.length,2);
 assert.equal(JSON.stringify(K.c.rt.subSlots.map(x=>x.lvl)),'[78,72]');
 const E=subclass({rt:{subSlots:[]},setRt(){throw Error('нет записи')},cfg:{}});assert.throws(()=>E.charNote(ch()),/нет записи/,'без subUnlock — записать (прежнее поведение)');
});

test('бой: запасы клика — отложенной записью, без обычной записи (act после потерянного клика)',async()=>{
 const actSrc=combat.slice(combat.indexOf('  let lastHpPot = 0, lastMpPot = 0'),combat.indexOf('  const t0 = Date.now();\n  let progSig'));
 const consts=combat.match(/const LOCK_A = \[60, 500, 120\], LOCK_B = \[30, 200, 50\];/)[0];
 let now=1_000_000,getEnd=now+300;const NET={start:1,done:1,doneT:now-5,ok:true,action:'l2_1220'},reg=[],soon=[];
 const env={cfg:{nDrain:''},names:()=>[],on:true,tabOwner:true,isBattle:()=>true,rt:{},setRt:p=>{reg.push(p);return Promise.resolve()},setRtSoon:p=>{soon.push(p);Object.assign(env.rt,p);return Promise.resolve({ok:true,deferred:true})},
  gameBusy:()=>getEnd&&now<getEnd?{busy:true,end:0}:{busy:false,end:getEnd},combatCooldown:{globalWait:()=>0,skillWait:()=>0,recentlyGlobalRejected:()=>false},slotAction:()=>'l2_1220',cdSpawn:()=>'sp',battleSpawn:()=>'sp',
  observeSlot:()=>{},actNet:()=>NET,fire:()=>true,sleep:async ms=>{now+=ms},waitFor:async(fn,ms)=>{const r=fn();if(!r)now+=ms;return r},setStatus:()=>{},skKey:()=>'blaze',
  slotCd:()=>null,petState:()=>null,pause:async()=>{},rnd:a=>a,rec:()=>{},TAG:'',cleanTitle:s=>s,memLeft:()=>0,FORCE_NEED:/x^/,UNAVAIL:/x^/,CD_RE:/x^/};
 const sb={env,Date:{now:()=>now},Math,Map,console,ctx:{pet:null},lostUntil:new Map(),pressAt:new Map(),victory:()=>false,defeat:()=>false,noticeText:()=>'',uiReady:()=>true,mobHp:()=>({cur:100}),rememberCd:async()=>{},mageCombat:()=>true};
 vm.runInNewContext(`${consts}\n${actSrc}\nthis.act = act;`,sb);
 assert.equal(await sb.act({title:'Blaze'},'Blaze'),'lock','клик потерян сразу после конца GET игры');
 assert.equal(soon.at(-1)?.clickLockB,65,'выученный запас B — в отложенной записи');assert.equal(env.rt.clickLockB,65,'память вкладки обновлена сразу');
 assert.deepEqual(reg.filter(p=>'clickLockA' in p||'clickLockB' in p),[],'обычной записи запасов нет');
 // Читатель запасов — только act() этой же страницы (память вкладки); меню и фон их не читают
 for(const f of ['popup.js','background.js','content.js'])assert.doesNotMatch(read(f),/clickLock[AB]/,f);
});

test('бой: причина ожидания навыков (combatWait) — отложенной записью; меню показывает её 120 с',()=>{
 assert.match(combat,/rtSoon\(\{ combatWait: \{ t: Date\.now\(\), text: waitText\.slice\(0, 200\) \} \}\); \}/);
 assert.doesNotMatch(combat,/env\.setRt\(\{ combatWait/);
 assert.match(combat,/const rtSoon = p => \(env\.setRtSoon \|\| env\.setRt\)\(p\)\?\.catch\?\.\(\(\) => \{\}\);/);
 assert.match(read('popup.js'),/rt\.combatWait && now - \(\+rt\.combatWait\.t \|\| 0\) < 120000/);
 for(const f of ['background.js','content.js'])assert.doesNotMatch(read(f),/rt\.combatWait/,f);
});

test('счёт на моба: слоты + статистика + запасы клика + причина ожидания — ни одной обычной записи, пакет раз в 8 с',async()=>{
 const K=core20(),S=subclass({get rt(){return K.c.rt},setRt:p=>K.c.setRt(p),cfg:{}});S.charNote(ch());await K.settle();K.sent.length=0;
 for(let mob=1;mob<=6;mob++){
  K.c.rt=viaStorage(K.c.rt);                              // итог квоты фона — чужая запись rt, вкладка берёт rt из хранилища
  for(let turn=0;turn<3;turn++)S.charNote(ch());          // GET /character после каждого хода
  K.c.setRtSoon({clickLockA:60+mob*20,clickLockB:30});    // lockSave
  K.c.setRtSoon({combatWait:{t:mob,text:'Атака: готов'}}); // «ожидание навыков»
  K.c.setRt({kills:mob,exp:mob*1000,sp:mob*100,adena:mob*100,lastWinT:mob,dps:{n:mob},target:null,sinceDeep:mob,lootStat:{},mobKills:{},via:'chain',catInT:mob});
  await K.settle();
 }
 assert.deepEqual(K.sent,[],'обычных записей на моба нет');assert.equal(K.timers.length,1,'один таймер отложенного пакета');
 K.timers[0]();await K.settle();assert.equal(K.sent.length,1,'один пакет на 6 мобов');
 for(const k of ['clickLockA','combatWait','kills','lootStat'])assert.ok(K.sent[0].split(',').includes(k),k);
});

test('статус: живой статус в live@Ник — минутная копия rt.status отложенно; без live — обычной записью',()=>{
 const src=slice(content,'const RECENT = [];','// Команда остановки сериализуется');
 const box=live=>{const reg=[],soon=[],c={rt:{char:'Hero',status:''},tabIdle:false,on:true,tabOwner:live,leaseEpoch:live?'e1':null,document:{prerendering:false},Date,String,chrome:{storage:{local:{set:async()=>{}}}},quietErr(){},recBot(){},draw(){},
  setRt:p=>{reg.push(p);c.rt={...c.rt,...p};return Promise.resolve({ok:true})},setRtSoon:p=>{soon.push(p);c.rt={...c.rt,...p};return Promise.resolve({ok:true})}};vm.runInNewContext(src+';this.S=setStatus;',c);return {c,reg,soon};};
 const a=box(true);a.c.S('Бой: загрузка');assert.equal(a.soon.length,1);assert.equal(a.reg.length,0);assert.equal(a.c.rt.status,'Бой: загрузка');
 const b=box(false);b.c.S('Загрузка');assert.equal(b.reg.length,1,'live не записан — rt.status обычной записью');assert.equal(b.soon.length,0);
});

// 20.41 (ревью battle-write-count): вторую запись при уходе отсекает флаг ядра pageGone (ревью 2, v2041-menu-reset-race). Здесь — поведение
// с настоящей очередью без привязки к имени флага: вырезка от комментария 8.0 до setRt, слушатели одного события вызываются по порядку регистрации.
test('уход со страницы: pagehide шлёт всю очередь один раз, следующий visibilitychange её не повторяет',async()=>{
 const sends=[],ipcs=[];let L={},D={};
 const fire=(map,t,e={})=>(map[t]||[]).forEach(f=>f(e));
 const run=()=>{L={};D={};const c={tabOwner:true,leaseEpoch:'e1',tabIdle:false,TAB_ID:'t1',rt:{char:'Hero'},quietErr(){},L2V7Modules:{fightlab:{flush(){}}},
  addEventListener:(t,f)=>{(L[t]||(L[t]=[])).push(f)},document:{hidden:false,addEventListener:(t,f)=>{(D[t]||(D[t]=[])).push(f)}},
  chrome:{runtime:{sendMessage:(m,cb)=>{sends.push(Object.keys(m.patch).sort().join(','));cb?.()},lastError:null}}};
  c.rtWriter=core.createPatchQueue(async b=>{ipcs.push(Object.keys(b).sort().join(','));return{ok:true}},()=>true,()=>{},()=>Date.now(),{set:()=>1,clear(){}});
  vm.runInNewContext(slice(content,'// 8.0 (аудит ядра/боя): часть записей в бою','function setRt(p) {'),c);return c;};
 const c=run();assert.ok((L.pagehide||[]).length>=1&&(D.visibilitychange||[]).length===1,'слушатели ухода со страницы и скрытия');
 c.rtWriter.defer({lootStat:{a:1},kills:5});
 fire(L,'pagehide',{persisted:false});c.document.hidden=true;fire(D,'visibilitychange');await new Promise(r=>setImmediate(r));   // порядок Chrome: pagehide, затем hidden
 assert.deepEqual(sends,['kills,lootStat'],'pagehide отправил очередь');assert.deepEqual(ipcs,[],'visibilitychange не повторил ту же запись');
 // Возврат из bfcache и обычный уход вкладки в фон (без pagehide) по-прежнему сразу пишут отложенное — 20.41 (ревью): замок уходит к другой вкладке
 fire(L,'pageshow',{persisted:true});c.document.hidden=false;c.rtWriter.defer({exp:7});c.document.hidden=true;fire(D,'visibilitychange');await new Promise(r=>setImmediate(r));
 assert.deepEqual(ipcs,['exp,kills,lootStat'],'вкладка в фоне — отложенное записано');
 const fresh=run();fresh.rtWriter.defer({exp:1});fresh.document.hidden=true;fire(D,'visibilitychange');await new Promise(r=>setImmediate(r));
 assert.ok(ipcs.includes('exp'),'без pagehide — запись при скрытии вкладки');assert.equal(sends.length,1);
});

test('не откладываются: квота/итог боя, оплаты, РБ, перезагрузка боя, сброс петли перехода и buffAt (читает следующая страница)',()=>{
 const soon=content.match(/const RT_STAT_SOON = new Set\(\[([\s\S]*?)\]\)/)[1];
 for(const k of ['farmQuota','dailyQuota','farmKillMark','raidMobMarks','actionPayments','actionOwner','epic','rbCur','rbPending','rbWound','rbSkip','battleReload','mobClickAt','bounce','buffAt','status','clickLockA','combatWait','subSlots'])
  assert.doesNotMatch(soon,new RegExp(`'${k}'`),k);
 assert.match(combat,/env\.setRt\(\{ buffAt: \{ \.\.\.\(env\.rt\.buffAt \|\| \{\}\), \[bn\]: Date\.now\(\) \} \}\)/,'buffAt — обычной записью: следующая страница боя решает по нему, не повторить ли бафф');
 // 20.43 (лог 21.10 15:47–15:51): сброс петли — отложенной записью (rtSoon); память вкладки обновлена сразу, уход со страницы (pagehide → peek)
 // отправляет его раньше, чем новая страница возьмёт замок — карта не примет свежий mobClickAt за отскок
 assert.match(combat,/if \(env\.rt\.bounce \|\| env\.rt\.mobClickAt\) rtSoon\(\{ bounce: 0, mobClickAt: 0 \}\);/,'сброс петли — отложенной записью без ожидания');
 assert.match(content,/\(live \? setRtSoon : setRt\)\(\{ status: s \}\)/);assert.match(content,/function statusSave\(s\) \{ liveStatus\(s\); rtStatusW = Date\.now\(\); return setRt\(\{ status: s \}\); \}/,'разовая запись статуса (остановка) — обычной');
});

// 20.41 (ревью battle-write-count): в цепочке «Охотиться дальше» обычных записей вкладки на моба больше нет (слоты классов не переписываются),
// поэтому статистика лежит в отложенной очереди до 8 с. Вкладка ушла в фон и продолжает бой → продление замка публикует vis:false →
// видимая вкладка с фокусом забирает замок → у прежней rtWriter.clear(). Перед продлением в фоне отложенное должно быть уже записано.
// Настоящие: фон (lockCommand/statePatch), слушатель storage ядра, тик замка ядра, очередь engine-core (таймер отложенного не срабатывает).
const bgSource=read('background.js');
function leaseFixture(){
 let now=1_000_000,listener,tick;const clone=v=>structuredClone(v),log=[];
 const state={on:true,lock:{k:'tab1',tab:1,epoch:'lease',t:now,vis:true},rt:{char:'Hero',exp:100,adena:10},cfg:{}};
 const page={Date:{now:()=>now},on:true,tabOwner:true,tabIdle:false,leaseEpoch:'lease',rt:clone(state.rt),cfg:{},DEF_RT:{},TAB_ID:'test',automationGeneration:0,window:{},lockMine:0,
  enchantCommandBusy:false,warlockCommandBusy:false,lifestoneCommandBusy:false,mammonBagCommandBusy:false,L2EngineCore:core,location:{pathname:'/battle.html'},document:{visibilityState:'visible'},
  L2V7Modules:{lifestone:{interrupt(){}},mammon:{bagAuto:async()=>{}}},enchantModePause:async()=>{},draw(){},dock(){},rec(){},abBlink(){},main(){},
  ownCfgChange:()=>false,viewOnlyCfgChange:()=>false,modeSig:()=>'',mergeCfg:x=>x,quietErr(){},setInterval:fn=>{tick=fn},renewResume:async()=>false,
  chrome:{storage:{onChanged:{addListener:fn=>{listener=fn}}},runtime:{}}};
 page.tabVis=()=>page.document.visibilityState==='visible';
 vm.createContext(page);
 const bg={L2EngineCore:core,Date:{now:()=>now},URL,crypto:{randomUUID:()=>'leaseB'},noteAlive:async()=>{},console:{warn(){}},chrome:{storage:{local:{
  get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,clone(state[k])])),
  set:async patch=>{const changes=Object.fromEntries(Object.keys(patch).map(k=>[k,{oldValue:clone(state[k]),newValue:clone(patch[k])}]));Object.assign(state,clone(patch));listener(changes);}}},
  tabs:{update:async()=>{},sendMessage:async()=>{}}}};
 vm.createContext(bg);
 vm.runInContext(slice(bgSource,'const LOCK_TTL =','// A single process owns')+slice(bgSource,'function retireRaidSessionPatch(','// Popup writes')+slice(bgSource,'function pvpSeedPatch(','async function menuPatch('),bg);
 const sender=id=>({frameId:0,url:'https://l2wap.com/battle.html',tab:{id}});
 page.rtWriter=core.createPatchQueue(async patch=>{log.push('statePatch:'+Object.keys(patch).sort().join(','));return bg.statePatch({patch,expectedChar:page.rt.char||'',epoch:page.leaseEpoch,src:page.TAB_ID},sender(1));},
  ()=>!page.tabIdle&&(!page.on||page.tabOwner&&!!page.leaseEpoch),()=>{},()=>now,{set:()=>1,clear(){}});
 page.ipc=async m=>{log.push(m.cmd+':vis='+m.vis);return bg.lockCommand(m,sender(1));};
 const from=content.indexOf('async function renewResume('),tickSrc=slice(content.slice(from),'setInterval(async () => {','}, 5000);')+'}, 5000);';
 vm.runInContext(slice(content,'chrome.storage.onChanged.addListener(ch => {\n','// v5.5.9: игра заранее')+tickSrc,page);
 return {state,page,log,tick:()=>tick(),advance:(ms=5000)=>{now+=ms},other:()=>bg.lockCommand({cmd:'lockAcquire',page:'/map.html',vis:true,focus:true},sender(2))};
}
test('вкладка в фоне: перед продлением замка (vis:false) отложенная статистика записана — её не стирает переход замка к видимой вкладке',async()=>{
 const f=leaseFixture();
 // Видимая вкладка: продление ничего не досылает (статистика ждёт свой пакет раз в 8 с), чужая вкладка замок не забирает
 f.page.rtWriter.defer({exp:200});await f.tick();
 assert.deepEqual(f.log,['lockRenew:vis=true']);assert.equal(f.state.rt.exp,100);assert.equal(f.state.lock.vis,true);
 assert.equal((await f.other()).reason,'other_tab');assert.equal(f.page.tabOwner,true);
 // Ушла в фон (visibilitychange уже дописал очередь) и бьёт дальше в том же документе: новая статистика снова в отложенной очереди
 f.page.document.visibilityState='hidden';f.page.rtWriter.defer({exp:900,adena:77,mobKills:{m:3}});f.log.length=0;f.advance();await f.tick();
 assert.deepEqual(f.log,['statePatch:adena,exp,mobKills','lockRenew:vis=false'],'сначала запись, потом vis:false');
 assert.equal(f.state.rt.exp,900);assert.equal(f.state.rt.adena,77);assert.equal(f.state.lock.vis,false);assert.deepEqual(f.page.rtWriter.peek(),{});
 // Видимая вкладка с фокусом забирает замок — прежняя чистит очередь, но статистика уже в хранилище
 const b=await f.other();assert.equal(b.ok,true);assert.equal(f.page.tabOwner,false);assert.equal(f.state.rt.exp,900);assert.deepEqual(f.state.rt.mobKills,{m:3});
 // Пустая очередь в фоне — продление без записи
 const g=leaseFixture();g.page.document.visibilityState='hidden';await g.tick();assert.deepEqual(g.log,['lockRenew:vis=false']);
});
test('вкладка в фоне: замок потерян, пока дописывалась очередь — продления старым замком нет',async()=>{
 const f=leaseFixture();f.page.document.visibilityState='hidden';f.page.rtWriter.defer({exp:300});
 // Замок отобран между решением дописать очередь и самой записью: очередь не пишется (canWrite), продления нет
 const w=f.page.rtWriter.recover;f.page.rtWriter.recover=()=>{f.page.tabOwner=false;f.page.leaseEpoch=null;return w();};
 await f.tick();assert.ok(!f.log.some(x=>x.startsWith('lockRenew')),f.log.join(' | '));assert.equal(f.state.rt.exp,100);
 assert.match(content,/if \(!tabVis\(\)\) \{ await L2EngineCore\.withTimeout\(rtWriter\.recover\(\), 3000\)\.catch\(e => quietErr\('запись памяти', e\)\); if \(!\(tabOwner && on\)\) return; \}\n\s+const r = await ipc\(\{ cmd: 'lockRenew'/);
});
