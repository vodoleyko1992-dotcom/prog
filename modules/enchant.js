/* Автозаточка: только выбранные экземпляры и имеющиеся свитки. Контракт публичного enchant.js от 14.10.2026.
   Все расходы идут через штатную кнопку игры, свой POST модуль не отправляет. */
(function(root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.enchant = function create_enchant(env) {
const location = env.routeLocation || root.location;
const DEFAULTS = Object.freeze({ enabled:false, queue:[], scrollPolicy:'blessed', ordinaryUntil:3, maxAttempts:0, maxScrolls:0, maxAdena:0,
  maxConsecutiveFails:2, maxDropFromStart:1, maxDropFromPeak:2, delayMs:1500, purchase:false, colBudget:0 });
const SCROLLS = Object.freeze(Object.fromEntries(['D','C','B','A','S'].flatMap((grade,i)=>['ordinary','blessed'].flatMap((kind,k)=>['armor','weapon'].map((target,j)=>
  [910510+i*2+k*10+j,{id:910510+i*2+k*10+j,grade,kind,target,chance:kind==='blessed'?1:0.6}])))));
const EQ_SLOTS = ['l1','l2','l3','l4','lh','lg','lf','neck','le1','le2','lr1','lr2'];
const TYPES = {rhand:'weapon',lhand:'armor',chest:'armor',legs:'armor',fullarmor:'armor',head:'armor',gloves:'armor',feet:'armor',neck:'jewelry',earring:'jewelry',ring:'jewelry'};
const NUM_KEYS = ['maxAttempts','maxScrolls','maxAdena','maxConsecutiveFails','maxDropFromStart','maxDropFromPeak','ordinaryUntil'];
const now = () => Date.now(), clone = x => JSON.parse(JSON.stringify(x)), num = x => Number.isFinite(+x) ? +x : null;
const nonneg = (x,f=0) => Number.isInteger(+x) && +x>=0 ? +x : f;
const policy = x => ['ordinary','blessed','mixed'].includes(x) ? x : null;
const cfgRaw = () => env.cfg?.enchant || {};
function normalizeConfig(raw=cfgRaw()) {
  const c={...DEFAULTS,...raw,enabled:raw.enabled===true,purchase:false,colBudget:0,queue:[]};
  for(const k of NUM_KEYS)c[k]=Math.min(k==='maxAdena'?1e12:100000,nonneg(raw[k],DEFAULTS[k]));
  c.delayMs=Math.max(500,Math.min(60000,nonneg(raw.delayMs,1500)));c.scrollPolicy=policy(raw.scrollPolicy||DEFAULTS.scrollPolicy);
  c.invalid=!c.scrollPolicy||raw.purchase===true||(+raw.colBudget||0)!==0;
  const keys=new Set(),targets=new Set();
  for(const q of Array.isArray(raw.queue)?raw.queue.slice(0,50):[]) {
    if(!q||typeof q.key!=='string'||!q.key||q.key.length>80||keys.has(q.key)){c.invalid=true;continue;}
    keys.add(q.key);const r={...q,key:q.key.slice(0,80),itemId:nonneg(q.itemId),targetInstanceId:String(q.targetInstanceId||''),targetLevel:nonneg(q.targetLevel),rules:{}};
    for(const k of NUM_KEYS)if(q.rules?.[k]!=null)r.rules[k]=Math.min(k==='maxAdena'?1e12:100000,nonneg(q.rules[k]));
    if(q.rules?.scrollPolicy!=null)r.rules.scrollPolicy=policy(q.rules.scrollPolicy);
    if(q.weaponMode!=null&&!['balanced','physical','magic'].includes(q.weaponMode))c.invalid=true;
    if(!r.itemId||!r.targetInstanceId||targets.has(r.targetInstanceId)||r.targetLevel<1||r.targetLevel>25||r.rules.scrollPolicy===null)c.invalid=true;
    targets.add(r.targetInstanceId);
    c.queue.push(r);
  }
  return c;
}
const signature = c => JSON.stringify({...c,enabled:true});
const settings = (q,c=normalizeConfig()) => ({...c,...q.rules});
const kindAt = (level,r) => r.scrollPolicy==='mixed'?(level<r.ordinaryUntil?'ordinary':'blessed'):r.scrollPolicy;
const charKey = () => String(env.rt.char??'');
const sameChar = s => s?.char===charKey();
const guard = () => (env.canRun==null || (typeof env.canRun==='function'?env.canRun():env.canRun===true)) && !(typeof env.antibotState==='function'?env.antibotState():env.antibotState);
const active = () => env.on===true && env.tabOwner!==false && env.cfg?.enchantMode===true && guard();
const allowed = S => active() && sameChar(S) && (!env.awayFree||env.awayFree()) && normalizeConfig().enabled && env.rt.enchant?.status==='running' && env.rt.enchant?.runId===S?.runId && signature(normalizeConfig())===S.cfgSig;
const current = () => env.rt.enchant;
const save = s => sameChar(s)?env.setRt({enchant:s}):Promise.resolve({ok:false,reason:'character changed'});
let busy=false, catalog=null, observed=new Map();
function totals() {return {attempts:0,successes:0,failures:0,scrolls:0,adena:0,col:0,unknown:0,reservedScrolls:0,latencyMs:0,samples:0,conflicts:0,byScroll:{}};}
function fingerprint(row) {return JSON.stringify([row.itemId,row.level,row.pb??null,row.mb??null,row.history||[],row.legacy||0,row.uid||'']);}
function rowOf(v) {
  if(typeof v==='number'&&v>0)v={itemId:v,enchant:0};
  if(!v||!Number.isInteger(+v.itemId)||+v.itemId<=0)return null;
  if(v.enchant!=null&&(!Number.isInteger(+v.enchant)||+v.enchant<0))return null;
  return {itemId:+v.itemId,level:+v.enchant||0,pb:v.enchantPAtkBonus==null?null:num(v.enchantPAtkBonus),mb:v.enchantMAtkBonus==null?null:num(v.enchantMAtkBonus),
    history:Array.isArray(v.weaponEnchantHistory)?v.weaponEnchantHistory.slice():[],legacy:nonneg(v.weaponEnchantLegacyLevels),
    uid:[v.clanArmorUid,v.clanWeaponUid,v.clanShieldUid,v.clanJewelryUid].filter(Boolean).join('|'),qty:v.qty==null?1:nonneg(v.qty)};
}
function bagToken(row,slot) {
  let t=`bag:${row.itemId}:${row.level}`;
  if(slot==='rhand'&&row.level>0){if(row.pb==null||row.mb==null)return null;t+=`:${row.pb}:${row.mb}`;
    if(row.history.some(x=>!['physical','magic','balanced'].includes(x)))return null;
    const track=(row.legacy?`L${row.legacy}`:'')+(row.history.length?'H'+row.history.map(x=>({physical:'p',magic:'m',balanced:'b'})[x]).join(''):'');if(track)t+=':'+track;}
  return t;
}
function snapshotItems(snap,hints=catalog) {
  if(!snap?.inventory||!hints?.itemSlotHints||!hints?.itemGradeHints)return [];
  const out=[];
  const add=(v,eqSlot)=>{const r=rowOf(v);if(!r||!r.qty||r.itemId===910600)return;
    const slot=hints.itemSlotHints[r.itemId],grade=hints.itemGradeHints[r.itemId],category=TYPES[slot];if(!category||!['D','C','B','A','S'].includes(grade))return;
    const token=eqSlot?'eq:'+eqSlot:bagToken(r,slot);if(!token)return;
    const item={...r,slot,eqSlot:eqSlot||'',grade,category,targetInstanceId:token,name:hints.itemNamesRu?.[r.itemId]||hints.itemNamesUk?.[r.itemId]||hints.itemNamesEn?.[r.itemId]||'#'+r.itemId};
    item.fingerprint=fingerprint(item);item.ambiguous=!eqSlot&&r.qty!==1;out.push(item);
  };
  for(const slot of EQ_SLOTS)add(snap.inventory.eq?.[slot],slot);
  for(const v of snap.inventory.stacks||[])add(v,'');
  const counts={};for(const r of out)counts[r.targetInstanceId]=(counts[r.targetInstanceId]||0)+1;
  for(const r of out)if(counts[r.targetInstanceId]>1)r.ambiguous=true;
  return out;
}
async function get(path) {try{const r=await env.gameGet(path);if(!r?.ok)return null;return await r.json();}catch(_){return null;}}
async function snapshot() {const char=charKey(),j=await get('/character'),s=j?.character;return char===charKey()&&s?.inventory&&Number.isSafeInteger(s.revision)&&(s.name===char||!char&&s.name==null)?s:null;}
async function readItems() {
  const char=charKey();
  const [s,h]=await Promise.all([snapshot(),get('/character/catalog-hints')]);
  if(charKey()!==char)return null;
  if(h?.itemSlotHints&&h?.itemGradeHints)catalog=h;
  if(!s||!catalog){await env.setRt({enchantScan:{t:now(),ok:false,reason:'Не прочитан герой или каталог предметов'}});return null;}
  const items=snapshotItems(s),scrolls={};for(const st of s.inventory.stacks||[])if(SCROLLS[st.itemId])scrolls[st.itemId]=(scrolls[st.itemId]||0)+nonneg(st.qty);
  await env.setRt({enchantScan:{char,t:now(),ok:true,revision:s.revision,items,scrolls}});return charKey()===char?{snap:s,items,scrolls}:null;
}
const quantity=(s,id)=>(s?.inventory?.stacks||[]).filter(x=>+x.itemId===+id).reduce((a,x)=>a+nonneg(x.qty),0);
const adena=s=>{const raw=s?.adena,value=typeof raw==='string'&&/^(?:0|[1-9]\d*)$/.test(raw)?Number(raw):raw;return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;};
function resolve(s,q,token=q.targetInstanceId) {const list=snapshotItems(s).filter(x=>x.targetInstanceId===token&&x.itemId===+q.itemId);return list.length===1&&!list[0].ambiguous?list[0]:null;}
async function pause(reason,extra={}) {const s=current();if(!s)return false;await save({...s,status:'paused',reason,...extra});env.rec?.('S','заточка',reason);return true;}
async function archive(s) {
  if(!s||!sameChar(s))return;
  const entry={runId:s.runId,startedAt:s.startedAt,finishedAt:s.finishedAt||now(),status:s.status,reason:s.reason,totals:clone(s.totals),items:clone(s.items),history:clone(s.history.slice(0,50))};
  await env.setRt({enchantArchive:[entry,...(env.rt.enchantArchive||[]).filter(x=>x.runId!==s.runId)].slice(0,20)});
}
function newItem(q,row) {return {key:q.key,itemId:q.itemId,name:row.name,targetInstanceId:row.targetInstanceId,slot:row.slot,category:row.category,grade:row.grade,
  level:row.level,start:row.level,peak:row.level,fingerprint:row.fingerprint,attempts:0,successes:0,failures:0,failStreak:0,scrolls:0,adena:0,unknown:0,reservedScrolls:0,done:row.level>=q.targetLevel};}
async function command(cmd,args={}) {
  if(cmd==='refresh')return readItems();
  if(cmd==='pause')return pause('Пауза по команде игрока');
  if(cmd==='reset') {const s=current(),char=charKey();if(s?.pending)return pause('Результат попытки неизвестен: сначала сверить состояние');await archive(s);
    if(charKey()!==char||current()!==s)return false;await env.setRt({enchant:null});return true;}
  if(cmd==='acknowledge')return acknowledgeUnknown();
  if(cmd==='archiveUnknown')return archiveUnknown(args);
  if(!['start','resume'].includes(cmd)||!active())return false;
  const c=normalizeConfig(),old=current(),char=charKey();
  if(old?.pending)return reconcile();
  if(c.invalid||!c.enabled||!c.queue.length||c.maxAttempts<1||c.maxScrolls<1){env.setStatus?.('Заточка: выбери вещи и положительные лимиты попыток/свитков');return false;}
  const recovery=env.rt.enchantRecovery;
  if(recovery?.char===char&&c.queue.some(q=>recovery.previousKeys?.includes(q.key))){env.setStatus?.('После неизвестного результата очисти план и заново выбери вещи из свежего инвентаря');return false;}
  if(cmd==='start'&&old&&old.status!=='done')return pause('Сначала продолжи или явно сбрось предыдущую сессию');
  const scan=await readItems();if(!scan||current()!==old||charKey()!==char||!active()||signature(normalizeConfig())!==signature(c))return false;
  if(recovery?.char===char&&scan.snap.revision<=recovery.attemptRevision){env.setStatus?.('Сервер ещё не сменил ревизию неизвестной попытки; новый запуск с этой ревизией заблокирован');return false;}
  const items=[];
  for(const q of c.queue){const prev=cmd==='resume'?old?.items.find(x=>x.key===q.key&&x.itemId===q.itemId):null;
    const row=resolve(scan.snap,q,prev?.targetInstanceId||q.targetInstanceId);
    if(!row||(!prev&&q.fingerprint!==row.fingerprint)||(prev&&prev.fingerprint!==row.fingerprint)){env.setStatus?.(`Заточка: экземпляр ${q.key} изменился или неоднозначен — выбери заново`);return false;}
    if(q.targetLevel>25||row.level>25)return false;
    items.push(prev?{...prev,done:row.level>=q.targetLevel}:newItem(q,row));}
  const s={v:1,char,runId:cmd==='resume'&&old?old.runId:`${now()}-${Math.random().toString(36).slice(2,9)}`,status:'running',reason:'',cfgSig:signature(c),
    startedAt:cmd==='resume'&&old?old.startedAt:now(),items,totals:cmd==='resume'&&old?old.totals:totals(),pending:null,history:cmd==='resume'&&old?old.history:[],nextAt:now(),conflicts:0,
    home:cmd==='resume'&&old?old.home:(typeof location!=='undefined'?location.pathname+location.search:'/char.html')};
  if(cmd==='start'&&old)await archive(old);
  if(current()!==old||!sameChar(s)||!active())return false;
  await save(s);return true;
}
function limits(s,item,q,c) {
  const r=settings(q,c),t=s.totals;
  if(t.attempts+t.unknown>=c.maxAttempts||item.attempts+item.unknown>=r.maxAttempts)return 'Лимит попыток';
  if(t.scrolls+t.reservedScrolls>=c.maxScrolls||item.scrolls+item.reservedScrolls>=r.maxScrolls)return 'Лимит свитков';
  if(t.adena>c.maxAdena||item.adena>r.maxAdena)return 'Лимит адены';
  if(r.maxConsecutiveFails>0&&item.failStreak>=r.maxConsecutiveFails)return 'Серия неудач';
  if(item.level<item.start&&item.start-item.level>=r.maxDropFromStart)return 'Просадка от начального уровня';
  if(item.level<item.peak&&item.peak-item.level>=r.maxDropFromPeak)return 'Просадка от максимума';
  if(kindAt(item.level,r)==='ordinary'&&item.level>0&&(r.maxDropFromStart===0&&item.level<=item.start||r.maxDropFromPeak===0&&item.level<=item.peak))return 'Обычный свиток может нарушить допустимую просадку';
  return '';
}
function plan() {
  const c=normalizeConfig(),s=current();if(!s)return {ready:false,reason:'Сессия не запущена'};
  if(s.pending)return {ready:false,reason:'Ожидание результата',pending:s.pending};
  const item=s.items.find(x=>!x.done),q=item&&c.queue.find(x=>x.key===item.key);if(!item||!q)return {ready:false,done:true,reason:'Цели достигнуты'};
  const reason=limits(s,item,q,c),r=settings(q,c),kind=kindAt(item.level,r),scroll=Object.values(SCROLLS).find(x=>x.kind===kind&&x.grade===item.grade&&x.target===(item.category==='weapon'?'weapon':'armor'));
  return {ready:!reason&&!!scroll,reason:reason||(!scroll?'Нет подтверждённого типа свитка':''),item,q,scroll,expected:expectedAttempts(item.level,q.targetLevel,r)};
}
const input=(el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
const Q=sel=>env.$q?env.$q(sel):document.querySelector(sel);
function urlFor(item,q) {return '/enchant.html?target='+encodeURIComponent(item.targetInstanceId)+(item.category==='weapon'?'&mode='+encodeURIComponent(q.weaponMode||'balanced'):'');}
async function prepareDom(P) {
  const panel=await env.waitX(()=>Q('#enchant-target-panel')&&!Q('#enchant-target-panel').hidden&&Q('#enchant-submit'),8000,150);if(!panel)return 'Не загрузилась панель заточки';
  const level=+(Q('.l2-enchant-selected-card__name')?.textContent||'').match(/^\s*\+(\d+)/)?.[1];if(!Number.isInteger(level)||level!==P.item.level)return 'Уровень в панели устарел';
  const radio=Q(`input[name="pay"][value="scroll:${P.scroll.id}"]`);if(!radio||radio.disabled)return 'Подходящих свитков нет в панели';
  if(!radio.checked)env.fire(radio);
  if(P.item.category==='weapon'){const mode=Q(`input[name="wmode"][value="${P.q.weaponMode||'balanced'}"]`);if(!mode)return 'Режим оружия недоступен';if(!mode.checked)env.fire(mode);}
  const count=Q('#enchant-count');if(!count)return 'Не найдено поле количества';input(count,1);
  const chance=+(Q('#enchant-scroll-chance')?.textContent||'').match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1];
  if(chance!==P.scroll.chance*100)return 'Шанс в игре изменился — нужна проверка правил';
  P.domSignature=domSignature();
  return '';
}
function domSignature(){const pay=Q('input[name="pay"]:checked');return JSON.stringify([Q('.l2-enchant-selected-card__name')?.textContent||'',
  Q('#enchant-scroll-chance')?.textContent||'',pay?.closest?.('label')?.textContent||'']);}
function domReady(P) {
  const p=new URLSearchParams(location.search),pay=Q('input[name="pay"]:checked'),mode=Q('input[name="wmode"]:checked'),btn=Q('#enchant-submit');
  const level=+(Q('.l2-enchant-selected-card__name')?.textContent||'').match(/^\s*\+(\d+)/)?.[1];
  if(level!==P.item.level||level>=P.q.targetLevel||P.domSignature!==domSignature())return false;
  return location.pathname==='/enchant.html'&&p.get('target')===P.item.targetInstanceId&&pay?.value===`scroll:${P.scroll.id}`&&+Q('#enchant-count')?.value===1&&
    (P.item.category!=='weapon'||mode?.value===(P.q.weaponMode||'balanced'))&&btn&&!btn.disabled;
}
async function step() {
  if(busy)return false;busy=true;
  try {
    let s=current();if(!s)return false;
    // 15.10: старое разрешение не запускает режим; уход/выключение сохраняет pending и требует ручного продолжения.
    if(s.status==='running'&&env.tabOwner!==false&&sameChar(s)&&(env.cfg?.enchantMode!==true||!normalizeConfig().enabled)) {
      await pause(env.cfg?.enchantMode!==true?'Выбран другой режим — продолжение заточки только вручную':'Заточка выключена — продолжение только вручную');
      s=current();if(!s)return false;
    }
    if(s.pending){if(s.pending.state==='unknown'&&now()-(s.pending.lastCheck||0)<15000)return true;
      const note=observed.get(s.pending.id);if(note)return settle(note);if(s.pending.state==='unknown'||now()-s.pending.t>15000)return reconcile();return true;}
    if(s.status!=='running')return false;
    if(!allowed(s)){if(active()&&sameChar(s)&&current()?.runId===s.runId&&signature(normalizeConfig())!==s.cfgSig)await pause('Настройки заточки изменены');return false;}
    if(env.awayFree&&!env.awayFree())return false;
    if(now()<(s.nextAt||0))return true;
    const P=plan();if(P.done){await save({...s,status:'done',reason:'Все цели достигнуты',finishedAt:now()});return true;}
    if(!P.ready)return pause(P.reason);
    if(!catalog){const h=await get('/character/catalog-hints');if(h?.itemSlotHints&&h?.itemGradeHints)catalog=h;}
    const snap=await snapshot();if(current()!==s||!allowed(s))return false;
    // После перехода каталог загружается заново. Короткий сбой GET не требует ручного
    // возобновления; повторяем только чтение, до намерения и расхода свитка.
    if(!snap||!catalog){
      const readFailures=(s.readFailures||0)+1;
      const missing=[!snap?'свежее состояние героя с подтверждённой личностью':'',!catalog?'каталог предметов':''].filter(Boolean).join(' и ');
      const reason=`Не удалось прочитать: ${missing} (проверка ${readFailures}/3)`;
      if(readFailures>=3)return pause(reason,{readFailures});
      await save({...s,readFailures,reason,nextAt:now()+2000});env.setStatus?.('Заточка: '+reason+' — повтор через 2 с');return true;
    }
    if(s.readFailures){s={...s,readFailures:0,reason:''};await save(s);if(current()!==s||!allowed(s))return false;}
    if(adena(snap)==null)return pause('Баланс Adena не прочитан — расход свитка не выполнялся');
    const row=resolve(snap,P.item);if(!row||row.fingerprint!==P.item.fingerprint)return pause('Выбранный экземпляр изменился вне этой сессии');
    if(quantity(snap,P.scroll.id)<1)return pause('Нет подходящего свитка в сумке');
    if(location.pathname!=='/enchant.html'||new URLSearchParams(location.search).get('target')!==P.item.targetInstanceId){
      if(!allowed(s))return false;location.href=urlFor(P.item,P.q);return true;}
    const err=await prepareDom(P);if(!allowed(s))return false;if(err)return pause(err);
    await env.pause?.();if(!allowed(s))return false;if(!domReady(P))return pause('Параметры страницы изменились до попытки');
    // Долговечное намерение до клика: после crash повторять его нельзя без результата/сверки.
    const pending={id:`${s.runId}:${s.totals.attempts+s.totals.unknown}:${now()}`,t:now(),state:'prepared',key:P.item.key,itemId:P.item.itemId,targetInstanceId:P.item.targetInstanceId,
      before:P.item.level,fingerprint:P.item.fingerprint,revision:snap.revision,scrollId:P.scroll.id,scrollBefore:quantity(snap,P.scroll.id),adenaBefore:adena(snap),
      colBefore:quantity(snap,4037),chance:P.scroll.chance,weaponMode:P.item.category==='weapon'?(P.q.weaponMode||'balanced'):null};
    const stored=await save({...s,pending});
    // recover пустой очереди не доказывает запись: inactive setRt меняет лишь локальный rt.
    const durable=stored?.ok===true;
    if(!durable){if(current()?.pending?.id===pending.id)await save({...current(),pending:null,status:'paused',reason:'Не удалось надёжно сохранить попытку; расход не выполнялся'});return false;}
    if(!allowed(s)||!domReady(P)){if(current()?.pending?.id===pending.id)await save({...current(),pending:null,status:'paused',reason:'Остановлено до клика'});return false;}
    const fired=env.fire(Q('#enchant-submit'));
    if(fired===false){await save({...current(),pending:null,status:'paused',reason:'Клик не разрешён владельцем вкладки'});return false;}
    // Не пишем состояние после fire: синхронный mock/быстрый net event уже мог сохранить результат.
    return true;
  } finally {busy=false;}
}
function note(req,res,status) {
  const p=current()?.pending;if(!sameChar(current())||!p||req?.payment!=='scroll'||+req.count!==1||req.targetInstanceId!==p.targetInstanceId||+req.scrollItemId!==p.scrollId||
    (p.weaponMode&&req.weaponEnchantMode!==p.weaponMode))return false;
  const recovery=env.rt.enchantRecovery;
  if(recovery?.char===charKey()&&+req.expectedRevision<=recovery.attemptRevision)return false;
  // Страница держит собственную ревизию. При stale она может быть меньше нашего свежего GET, это допустимый409.
  if(!Number.isSafeInteger(+req.expectedRevision)||+req.expectedRevision>p.revision)return false;
  const n={id:p.id,req:clone(req),res:res&&typeof res==='object'?clone(res):{},status:+status,t:now()};observed.set(p.id,n);
  // Ответ обрабатывается владельцем и сохраняется до следующей попытки, даже если игрок уже нажал Stop.
  if(env.tabOwner!==false)return settle(n);return true;
}
let settling=false;
async function settle(n) {
  if(settling)return false;settling=true;
  try{
    let s=current(),p=s?.pending;if(!p||p.id!==n.id)return false;
    if(env.tabOwner===false||!sameChar(s))return false;
    if(n.status===409){observed.delete(p.id);const t={...s.totals,conflicts:s.totals.conflicts+1},conflicts=(s.conflicts||0)+1;
      await save({...s,pending:null,totals:t,conflicts,nextAt:now()+1500,status:conflicts>=3?'paused':s.status,reason:conflicts>=3?'Повторяющийся конфликт ревизии':'Ревизия обновляется'});
      if(active()&&conflicts<3&&typeof location.reload==='function')location.reload();return true;}
    if(n.status===401||n.status===403||n.status===423){observed.delete(p.id);await save({...s,pending:null,status:'paused',reason:`Игра отклонила попытку (${n.status}); продолжение только вручную`});return true;}
    if(n.status<200||n.status>=300)return markUnknown('Ошибка сети/сервера: результат попытки не подтверждён');
    const r=n.res,attempted=+r.attemptedCount,success=+r.successCount,fail=+r.failCount,scrolls=+r.scrollConsumedCount,next=+r.currentEnchantLevel,prev=+r.previousEnchantLevel;
    if(+n.req.expectedRevision!==p.revision||attempted!==1||success+fail!==1||![0,1].includes(success)||![0,1].includes(fail)||scrolls!==1||prev!==p.before||
      next!==(success?prev+1:Math.max(0,prev-1))||r.coinConsumed===true||p.chance===1&&fail)return markUnknown('Ответ игры не соответствует подтверждённым правилам');
    // hook.js обрезает массивы ответа; проверяем полный свежий инвентарь своим read-only GET.
    let snap=await snapshot();
    s=current();if(s?.pending?.id!==p.id||!sameChar(s)||env.tabOwner===false)return false;
    if(!snap)return markUnknown('Есть результат, но не прочитан итоговый экземпляр');
    if(!catalog){const h=await get('/character/catalog-hints');if(h?.itemSlotHints)catalog=h;}
    if(current()?.pending?.id!==p.id||!sameChar(s)||env.tabOwner===false)return false;
    const token=typeof r.updatedTargetInstanceId==='string'?r.updatedTargetInstanceId:p.targetInstanceId;
    const item=s.items.find(x=>x.key===p.key),row=resolve(snap,item,token);
    let identity=null;try{identity=JSON.parse(p.fingerprint);}catch(_){}
    const spentA=p.adenaBefore!=null&&adena(snap)!=null?p.adenaBefore-adena(snap):null;
    if(!row||!Array.isArray(identity)||String(identity[6]||'')!==String(row.uid||'')||row.level!==next||snap.revision<=+n.req.expectedRevision||quantity(snap,p.scrollId)!==p.scrollBefore-1||quantity(snap,4037)!==p.colBefore||spentA!==0)
      return markUnknown('Результат и инвентарь расходятся — автоматическое повторение заблокировано');
    const t=clone(s.totals),latency=Math.max(0,n.t-p.t);t.attempts++;t.successes+=success;t.failures+=fail;t.scrolls++;t.latencyMs+=latency;t.samples++;
    const bucket=t.byScroll[p.scrollId]||{attempts:0,successes:0,failures:0,listed:p.chance};bucket.attempts++;bucket.successes+=success;bucket.failures+=fail;t.byScroll[p.scrollId]=bucket;
    const c=normalizeConfig(),q=c.queue.find(x=>x.key===p.key),updated={...item,targetInstanceId:row.targetInstanceId,level:next,peak:Math.max(item.peak,next),fingerprint:row.fingerprint,
      attempts:item.attempts+1,successes:item.successes+success,failures:item.failures+fail,scrolls:item.scrolls+1,failStreak:fail?item.failStreak+1:0,done:!!q&&next>=q.targetLevel};
    const event={id:p.id,t:n.t,key:p.key,itemId:p.itemId,scrollId:p.scrollId,before:prev,after:next,success:!!success,listed:p.chance,scrolls:1,adena:0,col:0,latencyMs:latency,status:'confirmed'};
    const nextState={...s,items:s.items.map(x=>x.key===p.key?updated:x),totals:t,pending:null,conflicts:0,history:[event,...s.history].slice(0,500),nextAt:now()+c.delayMs};
    const reason=!allowed(s)?'Остановлено или настройки изменены':q&&!updated.done?limits(nextState,updated,q,c):'';
    if(reason){nextState.status='paused';nextState.reason=reason;}
    else if(nextState.items.every(x=>x.done)){nextState.status='done';nextState.reason='Все цели достигнуты';nextState.finishedAt=now();}
    await save(nextState);observed.delete(p.id);env.rec?.('B','заточка',`${item.name}: +${prev} → +${next} · ${success?'успех':'неудача'} · свиток #${p.scrollId} ×1`);return true;
  }finally{settling=false;}
}
async function markUnknown(reason,evidence) {
  const s=current();if(!s?.pending||!sameChar(s)||env.tabOwner===false)return false;
  await save({...s,status:'paused',reason,pending:{...s.pending,state:'unknown',lastCheck:now(),...(evidence?{evidence}:{})}});return true;
}
async function reconcile() {
  const s=current(),p=s?.pending;if(!p||!sameChar(s)||env.tabOwner===false)return false;
  const n=observed.get(p.id);if(n&&n.status>=200&&n.status<300)return settle(n);
  const snap=await snapshot();if(current()?.pending?.id!==p.id||!sameChar(s)||env.tabOwner===false)return false;
  if(!catalog){const h=await get('/character/catalog-hints');if(h?.itemSlotHints)catalog=h;}
  const row=snap&&resolve(snap,{itemId:p.itemId,targetInstanceId:p.targetInstanceId});
  const evidence=snap?{revision:snap.revision,level:row?.level??null,fingerprint:row?.fingerprint??null,scrollBefore:p.scrollBefore,scrollNow:quantity(snap,p.scrollId),
    adenaDelta:p.adenaBefore!=null&&adena(snap)!=null?p.adenaBefore-adena(snap):null,colDelta:p.colBefore-quantity(snap,4037)}:{unavailable:true};
  return markUnknown('Неизвестен результат попытки. Повтор заблокирован; сверь инвентарь и подтверди вручную',evidence);
}
async function acknowledgeUnknown() {
  const s=current(),p=s?.pending;if(!p||p.state!=='unknown'||!active())return false;
  const scan=await readItems();if(!scan||current()?.pending?.id!==p.id)return false;
  let row=resolve(scan.snap,{itemId:p.itemId,targetInstanceId:p.targetInstanceId});
  // Не подбираем соседний уровень автоматически: это может быть другой предмет того же itemId.
  let beforeIdentity=null;try{beforeIdentity=JSON.parse(p.fingerprint);}catch(_){}
  if(!beforeIdentity||!Array.isArray(beforeIdentity)||String(beforeIdentity[6]||'')!==String(row?.uid||''))row=null;
  if(!row)return pause('Нельзя однозначно найти прежний экземпляр. Выбери его заново; расход зарезервирован');
  const t=clone(s.totals);t.unknown++;t.reservedScrolls++;
  const updated=s.items.map(x=>x.key===p.key?{...x,level:row.level,peak:Math.max(x.peak,row.level),fingerprint:row.fingerprint,targetInstanceId:row.targetInstanceId,unknown:x.unknown+1,reservedScrolls:x.reservedScrolls+1,done:false}:x);
  const event={id:p.id,t:now(),key:p.key,itemId:p.itemId,scrollId:p.scrollId,before:p.before,after:row.level,status:'unknown',reservedScrolls:1,scrolls:null,adena:null,col:null};
  await save({...s,items:updated,totals:t,pending:null,status:'paused',reason:'Состояние сверено игроком; неизвестная попытка засчитана в лимиты. Для продолжения нажми «Продолжить»',history:[event,...s.history].slice(0,500)});
  observed.delete(p.id);return true;
}
async function archiveUnknown(args) {
  let s=current(),p=s?.pending;
  if(!p||p.state!=='unknown'||!Number.isSafeInteger(p.revision)||args?.pendingId!==p.id||!sameChar(s)||env.tabOwner===false||settling)return false;
  const scan=await readItems();
  s=current();
  if(!scan||!sameChar(s)||env.tabOwner===false||settling||s?.pending?.id!==p.id||s.pending.state!=='unknown')return false;
  // Результат не угадывается: сохраняем исходное намерение и свежую сверку. Даже если предмет исчез,
  // завершить серию можно явно; новый запуск требует нового ручного выбора, прежние queue keys запрещены.
  const evidence={t:now(),revision:scan.snap.revision,scrollBefore:p.scrollBefore,scrollNow:quantity(scan.snap,p.scrollId),
    adenaDelta:p.adenaBefore!=null&&adena(scan.snap)!=null?p.adenaBefore-adena(scan.snap):null,colDelta:p.colBefore-quantity(scan.snap,4037),
    candidates:scan.items.filter(x=>x.itemId===p.itemId).map(x=>({targetInstanceId:x.targetInstanceId,fingerprint:x.fingerprint,level:x.level,ambiguous:x.ambiguous}))};
  const t=clone(s.totals);t.unknown++;t.reservedScrolls++;
  const event={id:p.id,t:now(),key:p.key,itemId:p.itemId,scrollId:p.scrollId,before:p.before,after:null,status:'unknown',source:'manual_archive',
    reservedAttempts:1,reservedScrolls:1,scrolls:null,adena:null,col:null};
  const items=s.items.map(x=>x.key===p.key?{...x,unknown:x.unknown+1,reservedScrolls:x.reservedScrolls+1}:x);
  const entry={runId:s.runId,char:s.char,startedAt:s.startedAt,finishedAt:now(),status:'closed_unknown',reason:'Серия завершена игроком с неизвестным результатом',
    totals:t,items:clone(items),pending:clone(p),evidence,history:[event,...s.history].slice(0,50)};
  const recovery={char:s.char,t:now(),runId:s.runId,pendingId:p.id,revision:scan.snap.revision,attemptRevision:p.revision,previousKeys:s.items.map(x=>x.key)};
  const patch={enchant:null,enchantArchive:[entry,...(env.rt.enchantArchive||[]).filter(x=>x.runId!==s.runId)].slice(0,20),enchantRecovery:recovery};
  const stored=await env.setRt(patch),durable=stored?.ok===true;
  if(!durable){
    // Не оставляем локально очищенный pending после неуспешной записи. Сохранённое намерение блокирует повтор.
    if(charKey()===s.char&&current()==null&&env.rt.enchantRecovery?.pendingId===p.id)await save({...s,status:'paused',reason:'Не удалось надёжно сохранить завершение серии; неизвестная попытка сохранена'});
    return false;
  }
  if(charKey()!==s.char)return false;
  observed.delete(p.id);return true;
}
// Точное среднее для birth-death с отражающей границей0: d[i]=(1+(1-p[i])*d[i-1])/p[i], E[L]=Σd[L..target-1].
// Это модель без stop-лимитов и дефицита свитков; наблюдаемая частота никогда не подменяет опубликованный шанс.
function expectedAttempts(level,target,r={scrollPolicy:'blessed',ordinaryUntil:3}) {
  if(!Number.isInteger(level)||!Number.isInteger(target)||level<0||target>25||target<0||!policy(r.scrollPolicy))return null;
  if(level>=target)return 0;let d=0,total=0;
  for(let i=0;i<target;i++){const p=kindAt(i,r)==='blessed'?1:.6;d=(1+(1-p)*d)/p;if(i>=level)total+=d;}
  return total;
}
function analytics() {
  const s=current();if(!s)return null;const c=normalizeConfig(),T=s.totals;
  const rates=Object.entries(T.byScroll).map(([id,b])=>{const n=b.attempts,p=n?b.successes/n:null,z=1.96,den=1+z*z/n,mid=n?(p+z*z/(2*n))/den:null,
    half=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den:null;return {scrollId:+id,...b,observed:p,n,interval95:n?[Math.max(0,mid-half),Math.min(1,mid+half)]:null};});
  const estimates=s.items.map(it=>{const q=c.queue.find(x=>x.key===it.key);const attempts=q?expectedAttempts(it.level,q.targetLevel,settings(q,c)):null;
    return {key:it.key,from:it.level,target:q?.targetLevel??null,expectedAttempts:attempts,expectedScrolls:attempts,
      estimatedMs:attempts!=null&&T.samples>=3?attempts*(T.latencyMs/T.samples+c.delayMs):null,model:'Опубликованные шансы, провал−1, минимум0; без stop-лимитов и нехватки свитков'};});
  return {status:s.status,reason:s.reason,totals:clone(T),pending:s.pending?clone(s.pending):null,rates,estimates,history:s.history.slice(),items:s.items.slice(),archive:clone(env.rt.enchantArchive||[]),
    remainingAttempts:Math.max(0,c.maxAttempts-T.attempts-T.unknown-(s.pending?1:0)),remainingScrolls:Math.max(0,c.maxScrolls-T.scrolls-T.reservedScrolls-(s.pending?1:0))};
}
return {DEFAULTS,SCROLLS,normalizeConfig,snapshotItems,readItems,command,step,note,plan,analytics,expectedAttempts,reconcile};
 };
})(globalThis);
