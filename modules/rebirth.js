/* Rebirth: отдельный режим, продолжение своего похода и только явно разрешённые нативные входы. */
(function(root){'use strict';
root.L2V7Factories=root.L2V7Factories||Object.create(null);
root.L2V7Factories.rebirth=function create_rebirth(env){
 const location=env.routeLocation||root.location,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const state=()=>env.rt.rebirth||{},on=()=>env.on===true&&env.tabOwner===true&&env.cfg.rebirthMode===true;
 const config=()=>JSON.stringify([env.cfg.rebirthMode,env.cfg.rebirthDifficulty??1,env.cfg.rebirthAutoEnter===true,env.cfg.rebirthKeyReserve??0,env.cfg.rebirthBossChoice||'manual']);
 const path=()=>String(location.pathname||''),shown=b=>!!b&&env.shown?.(b)!==false&&!b.disabled&&b.getAttribute?.('aria-disabled')!=='true';
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 const special=c=>!!c&&(['pvp','isPvp','inPvp','tvt','isTvt','inTvt'].some(k=>c[k]===true)
  ||['battleMode','battleType','mode','kind','type'].some(k=>/^(?:pvp|tvt)(?:_|-|:|$)/i.test(String(c[k]||''))));
 let busy=false,serial=0,gate={key:'',until:0,failures:0};
 const token=()=>({char:env.rt.char,prof:env.rt.classCur?.prof,slot:env.rt.classCur?.slot,level:env.heroLvl?.()||env.rt.lvl,
  lease:env.leaseEpoch,generation:env.actionGeneration?.(),kick:env.rt.manualKickAt||0,page:location.href,config:config()});
 const current=T=>on()&&env.canAct?.()!==false&&env.canRun?.()!==false&&env.heroNick?.()===T.char&&env.rt.char===T.char
  &&env.rt.classCur?.prof===T.prof&&env.rt.classCur?.slot===T.slot&&(env.heroLvl?.()||env.rt.lvl)===T.level
  &&env.leaseEpoch===T.lease&&env.actionGeneration?.()===T.generation&&(env.rt.manualKickAt||0)===T.kick&&location.href===T.page&&config()===T.config;
 const own=(c,T,min=0,id)=>c?.name===T.char&&typeof c.id==='string'&&!!c.id&&(!id||c.id===id)&&c.l2Profession===T.prof
  &&c.classSlots?.activeSlot===T.slot&&c.level===T.level&&integer(c.revision)&&c.revision>=min&&typeof c.inBattle==='boolean'&&c.hp>0&&!special(c);
 const solo=(run,actor)=>UUID.test(run?.id||'')&&run.partyId===null&&Array.isArray(run.participantCharacterIds)
  &&run.participantCharacterIds.length===1&&run.participantCharacterIds[0]===actor;
 const pendingSame=(P,field='pending')=>state()[field]?.id===P?.id;
 const browserTab=()=>{const key=typeof env.browserTabKey==='function'?env.browserTabKey():env.browserTabKey;return /^tab\d+$/.test(key||'')?key:'';};
 const markerKey=(P,field)=>'l2bot.rebirth-unsent.'+field+'.'+P.actor;
 function markUnsent(P,field){const tab=browserTab();if(!tab)return false;try{root.sessionStorage.setItem(markerKey(P,field),JSON.stringify({id:P.id,char:P.char,actor:P.actor,prof:P.prof,slot:P.slot,tab}));return true;}catch(_){return false;}}
 function unmark(P,field){try{root.sessionStorage.removeItem(markerKey(P,field));return true;}catch(_){return false;}}
 function knownUnsent(P,field,ch,T){
  if(!P||P.char!==T.char||P.actor!==ch.id||P.prof!==T.prof||P.slot!==T.slot||ch.revision<P.revision)return false;
  const tab=browserTab();if(!tab)return false;
  try{const m=JSON.parse(root.sessionStorage.getItem(markerKey(P,field))||'null');return m?.tab===tab&&m.id===P.id&&m.char===P.char&&m.actor===P.actor&&m.prof===P.prof&&m.slot===P.slot;}catch(_){return false;}
 }
 const completedKey=actor=>'l2bot.rebirth-completed.'+actor;
 function completion(ch,T,run){
  const valid=m=>m?.char===T.char&&m.actor===ch.id&&m.prof===T.prof&&m.slot===T.slot&&m.runId===run.id&&Number.isFinite(m.at)&&m.at<=Date.now();
  if(valid(state().completed))return true;
  try{return valid(JSON.parse(root.sessionStorage.getItem(completedKey(ch.id))||'null'));}catch(_){return false;}
 }
 async function save(T,p){if(!current(T))return false;return(await env.setRt({rebirth:{...state(),...p}}))?.ok===true&&current(T);}
 async function status(T,phase,reason,p={}){
  if(!current(T))return false;env.setStatus?.('Rebirth: '+reason);
  const s=state();if(s.char!==T.char||s.phase!==phase||s.reason!==reason||Object.keys(p).some(k=>JSON.stringify(s[k])!==JSON.stringify(p[k])))
   return save(T,{char:T.char,phase,reason,...p});
  return true;
 }
 async function read(url,T){const r=await env.gameGet(url,4000);if(!current(T))return null;if(!r.ok)throw Error('read_failed');const d=await r.json();return current(T)?d:null;}
 async function quota(T){const ok=!env.dailyWorkReady||await env.dailyWorkReady('mobs');return current(T)&&ok===true;}
 async function navigate(T,url){if(!current(T)||env.nativePending?.())return false;if(!await env.rtCommit?.()||!current(T))return false;location.href=url;return true;}
 function observed(run,ch){return{id:run.id,char:ch.name,actor:ch.id,prof:ch.l2Profession,slot:ch.classSlots.activeSlot,phase:run.phase,kick:env.rt.manualKickAt||0,at:Date.now()};}
 function runFields(run,ch){return{actor:ch.id,prof:ch.l2Profession,slot:ch.classSlots.activeSlot,runId:run.id,runPhase:run.phase,difficulty:run.difficulty,
  mobKills:run.mobKills,mobKillTarget:run.mobKillTarget,checkedAt:Date.now(),observedRun:observed(run,ch),
  selectedBossSlot:run.phase==='rb_active'?run.selectedBossSlot??null:null,selectedBossSlotEncoded:run.phase==='rb_active'?run.selectedBossSlotEncoded===true:false,
  selectedBossSpawnId:run.phase==='rb_active'?run.selectedBossSpawnId||null:null};}
 function entryQuote(){
  const levels=env.$q?.('#rebirth-raid-levels'),wallet=String(levels?.textContent||'').match(/(?:Ключи подземелья|Ключі підземелля)\s*:\s*([\d\s\u00a0]+)/i);
  const keys=wallet?Number(wallet[1].replace(/\s/g,'')):NaN,difficulty=env.cfg.rebirthDifficulty??1,reserve=env.cfg.rebirthKeyReserve??0;
  if(!levels||!shown(levels)||!integer(keys)||![1,2,3].includes(difficulty)||!integer(reserve))return null;
  const label=['','Easy','Medium','Hard'][difficulty],prices={1:2,2:4,3:6};
  const cards=[...(levels.querySelectorAll?.('.l2-rraid-difficulty__button')||[])].map(button=>{
   const card=button.closest?.('.l2-rraid-difficulty')||button.closest?.('section, article, li')||button.parentElement;
   const text=String(card?.textContent||'').replace(/\s+/g,' ').trim();
   const matches=['Easy','Medium','Hard'].filter(n=>new RegExp('\\b'+n+'\\b','i').test(text));
   const cost=text.match(/(?:Стоимость|Вартість)\s*(?:входа|входу)\s*[:—-]?\s*(\d+)\s*(?:ключ|key)/i);
   if(!shown(button)||matches.length!==1||matches[0]!==label||!cost||Number(cost[1])!==prices[difficulty]
    ||/coin\s*of\s*luck|fast\s*aden|\bcol\b|\bFA\b|аден[аыі]|adena/i.test(text))return null;
   return{button,keys,cost:Number(cost[1]),difficulty,reserve,text};
  }).filter(Boolean);
  return cards.length===1?cards[0]:null;
 }
 const quoteSame=q=>{const n=entryQuote();return n&&n.button===q.button&&n.keys===q.keys&&n.cost===q.cost&&n.difficulty===q.difficulty&&n.reserve===q.reserve&&n.text===q.text;};
 async function native(T,button,kind,ch,run,quote){
  if(!current(T)||!shown(button)||env.nativePending?.()||!await quota(T))return false;
  const field=kind==='entry'?'pending':'fightPending';
  const P={id:Date.now()+':'+(++serial),kind,phase:'prepared',at:Date.now(),char:T.char,actor:ch.id,prof:T.prof,slot:T.slot,
   revision:ch.revision,kick:T.kick,runId:run?.id||null,runPhase:run?.phase||null,mobKills:run?.mobKills??null,difficulty:quote?.difficulty??run?.difficulty,
   ...(quote?{cost:quote.cost,keys:quote.keys,noActiveRun:true,baselineAt:Date.now(),previousRunId:quote.previousRunId||state().runId||state().lastEntry?.runId||null}:{}),page:T.page};
  if(!await save(T,{char:T.char,[field]:P})||!await env.rtCommit?.()||!current(T)||!pendingSame(P,field))return false;
  if(!shown(button)||quote&&!quoteSame(quote)||env.nativePending?.()||!await quota(T)){
   if(current(T)&&pendingSame(P,field))await save(T,{[field]:null});return false;
  }
  // Метка удаляется синхронно перед фактическим кликом: Stop после durable sent не превращает несделанный вход в вечную неопределённость.
  if(!markUnsent(P,field))return false;
  if(!await save(T,{[field]:{...P,phase:'sent',sentAt:Date.now()}})||!await env.rtCommit?.()||!current(T)||!pendingSame(P,field))return false;
  if(!await quota(T)||!current(T)||!shown(button)||quote&&!quoteSame(quote)||env.nativePending?.()){
   if(current(T)&&pendingSame(P,field))await save(T,{[field]:null});return false;
  }
  if(!unmark(P,field))return false;
  if(!env.fire(button)){
   markUnsent(P,field);if(current(T)&&pendingSame(P,field)&&await save(T,{[field]:null}))unmark(P,field);return false;
  }
  env.rec?.('B','Rebirth',kind==='entry'?'Нативный вход: '+quote.cost+' ключа; жду подтверждения своего похода':'Открываю бой в текущем оплаченном походе');
  return true;
 }
 const selectedBoss=run=>run?.phase==='rb_active'&&integer(run.selectedBossSlot)&&run.selectedBossSlotEncoded===true&&/^l2dop_rb_\d+$/.test(run.selectedBossSpawnId||'');
 function gateProof(){
  if(path()!=='/rebirth-raid-dungeon.html')return null;
  const content=env.$q?.('#rebirth-instance-content'),text=String(content?.textContent||'').replace(/\s+/g,' ').trim();
  const buttons=[...(content?.querySelectorAll?.('.l2-rraid-gate__enter')||[])];
  return content&&/Чемпион\s+побежд[её]н|Чемпіон\s+переможений|Чемпіона\s+переможено/i.test(text)&&buttons.length===16&&buttons.every(shown)?{content,text,buttons}:null;
 }
 const sameGate=q=>{const n=gateProof();return n&&n.content===q.content&&n.text===q.text&&n.buttons.every((b,i)=>b===q.buttons[i]);};
 async function chooseBoss(T,ch,run){
  const proof=gateProof();if(!proof||env.cfg.rebirthBossChoice!=='staff1h'||typeof env.gamePost!=='function'||!await quota(T)||env.nativePending?.())return false;
  const P={id:Date.now()+':'+(++serial),phase:'prepared',char:T.char,actor:ch.id,prof:T.prof,slot:T.slot,runId:run.id,revision:ch.revision,bossSlot:3,at:Date.now()};
  if(!await save(T,{bossPending:P})||!await env.rtCommit?.()||!current(T)||!pendingSame(P,'bossPending')||!sameGate(proof))return false;
  if(!await quota(T)||!current(T)||!sameGate(proof)||env.nativePending?.())return false;
  if(!markUnsent(P,'bossPending'))return false;
  if(!await save(T,{bossPending:{...P,phase:'sent',sentAt:Date.now()}})||!await env.rtCommit?.()||!current(T)||!pendingSame(P,'bossPending'))return false;
  if(!await quota(T)||!current(T)||!sameGate(proof)||env.nativePending?.())return false;
  // 27.10, лог03:20: подтверждён именно encoded bossSlot3 для одноручного посоха. Это не индекс DOM-кнопки.
  try{
   if(!unmark(P,'bossPending'))return false;
   const response=await env.gamePost('/game/rebirth-raids/enter-boss',{bossSlot:3},8000);
   if(!current(T)||!pendingSame(P,'bossPending'))return true;
   const body=await response.json();if(!current(T)||!pendingSame(P,'bossPending'))return true;
   const r=body?.run,ack={status:response.status,ok:response.ok&&!body?.error&&r?.id===run.id&&selectedBoss(r)&&r.selectedBossSlot===3&&r.selectedBossSpawnId==='l2dop_rb_25098'};
   await save(T,{bossPending:{...state().bossPending,ack}});
   await status(T,ack.ok?'boss-selected':'manual',ack.ok?'выбор РБ принят — сверяю своё логово':'выбор РБ не подтверждён — требуется ручная проверка');
  }catch(_){if(current(T)&&pendingSame(P,'bossPending'))await status(T,'unknown','ответ выбора РБ потерян — повторно не выбираю');}
  return true;
 }
 async function note(url,d,context){
  if(url==='/game/rebirth-raids/next'&&d?.method==='GET'){
   const s=state(),r=d.res;
   if(env.tabOwner!==true||s.char!==env.rt.char||env.heroNick?.()!==s.char||s.prof!==env.rt.classCur?.prof||s.slot!==env.rt.classCur?.slot
    ||typeof s.actor!=='string'||!s.actor||!UUID.test(s.runId||'')||!selectedBoss({...s,phase:s.runPhase||s.phase})||!(d.status>=200&&d.status<300)
    ||d.error||r?.error||r?.phase!=='none'||r.spawnId!==null)return false;
   let request;try{request=new URL(d.url,'https://l2wap.com');}catch(_){return false;}
   const after=request.searchParams.get('after');
   if(request.origin!=='https://l2wap.com'||request.pathname!=='/game/rebirth-raids/next'||request.searchParams.getAll('after').length!==1
    ||typeof after!=='string'||!after.startsWith('rebirth_raid_'+s.runId+'_')||!/_raid_\d+$/.test(after))return false;
   // Сам ответ none не доказывает победу. Ядро передаёт захваченное до запроса доказательство точной победы над выбранным своим РБ.
   try{if(env.completedBoss?.(after,context)!==true)return false;}catch(_){return false;}
   const mark={char:s.char,actor:s.actor,prof:s.prof,slot:s.slot,runId:s.runId,at:Date.now()};
   // Навигация каталога может обогнать async-запись rt: компактная квитанция итога сначала сохраняется синхронно.
   try{root.sessionStorage.setItem(completedKey(s.actor),JSON.stringify(mark));}catch(_){return false;}
   return(await env.setRt({rebirth:{...state(),completed:mark}}))?.ok===true;
  }
  if(url!=='/game/rebirth-raids/start'||d?.method!=='POST')return false;
  const s=state(),P=s.pending;
  if(!P||P.kind!=='entry'||P.phase!=='sent'||env.tabOwner!==true||env.rt.char!==P.char||env.heroNick?.()!==P.char
   ||env.rt.classCur?.prof!==P.prof||env.rt.classCur?.slot!==P.slot||d.req?.difficulty!==P.difficulty||!Number.isFinite(P.sentAt)||P.sentAt>Date.now()+100||!Number.isFinite(d.ms)||d.ms<0
   ||Date.now()-d.ms<P.sentAt-100||!Number.isSafeInteger(d.rid)||d.rid<=0)return false;
  const r=d.res,run=r?.run,success=d.status>=200&&d.status<300&&!d.error&&!r?.error&&solo(run,P.actor)&&run.difficulty===P.difficulty;
  const rejected=d.status>=400&&d.status<500&&!d.error;
  if(!success&&!rejected)return false;
  const ack={rid:d.rid,at:Date.now(),status:d.status,ok:success,...(success?{runId:run.id}:{})};
  if(!pendingSame(P))return false;
  return(await env.setRt({rebirth:{...state(),pending:{...state().pending,ack},...(success?{observedRun:{id:run.id,char:P.char,actor:P.actor,prof:P.prof,slot:P.slot,phase:run.phase,kick:env.rt.manualKickAt||0,at:Date.now()}}:{})}}))?.ok===true;
 }
 // 20.71: продолжение принадлежит подземельям и не использует правила/цепочку обычной охоты.
 let rebirthAttempt = null;
async function nextFight(ctx) {
  if (!env.victory() || !on() || env.autonomyMode?.() !== 'rebirth') return; // старое продолжение победы не трогает уже начатый игроком бой
  const char = env.rt.char, prof = env.rt.classCur?.prof, slot = env.rt.classCur?.slot, page = location.href;
  const owner = env.evidenceOwner?.(), scan = env.scanContext?.(), generation = env.actionGeneration?.(), mode = env.autonomyMode(), level = env.heroLvl();
  const info = env.battleInfo?.(), infoSig = JSON.stringify(info || null), title = env.$q('#battle-mob-title')?.textContent || '';
  const name = title.replace(/\s*[·•]\s*ур\.?\s*\d+[\s\S]*$/i, '').trim();
  const fresh = info && Date.now() - info.t >= 0 && Date.now() - info.t < 60000 && String(info.name || '').toLowerCase() === name.toLowerCase();
  // 20.72 (лог28.10 03:12): таймаут повторяется через60с, когда прежняя метка уже устарела; после reload ctx тоже нет.
  // URL — только указатель: восстановление требует сохранённого своего боя, свежего героя/run и ведёт в каталог без next-клика.
  const ids = new URLSearchParams(location.search || '').getAll('spawnId'), route = ids.length === 1 ? ids[0] : '', parts = spawnParts(route);
  const lineage = s => JSON.stringify([s.actor,s.prof,s.slot,s.runId,s.battleSpawn,s.battleRole,s.observedRun?.char,s.observedRun?.kick]);
  const previousFight = state(), lineageSig = lineage(previousFight);
  const boundLineage = path() === '/battle.html' && parts
    && previousFight.battleSpawn === route && typeof previousFight.runId === 'string' && previousFight.runId.toLowerCase() === parts[1].toLowerCase()
    && previousFight.battleRole === parts[6].toLowerCase() && previousFight.prof === prof && previousFight.slot === slot
    && typeof previousFight.actor === 'string' && !!previousFight.actor && previousFight.observedRun?.char === char
    && previousFight.observedRun?.kick === (env.rt.manualKickAt || 0)
    && (!info?.spawn || info.spawn === route) && (!info?.name || String(info.name).toLowerCase() === name.toLowerCase())
    && (!ctx || ctx.spawnId === route && ctx.name === name);
  const recover = !fresh && !(ctx?.name === name && ctx.spawnId) && boundLineage;
  let receiptRecovery = false, pendingReceiptRaw = null;
  const sameReceipt = () => { try { return root.sessionStorage.getItem('l2bot.rebirth-next') === pendingReceiptRaw; } catch (_) { return false; } };
  const after = fresh && info.spawn || ctx?.name === name && ctx.spawnId || recover && route || '';
  const victory = env.$q('#battle-victory-inline'), hunt = env.$q('#battle-victory-hunt'), ctxSpawn = ctx?.spawnId;
  const active = () => on() && env.canRun?.() !== false && env.tabOwner === true && env.canAct?.() !== false && env.heroNick?.() === char
    && env.rt.char === char && env.rt.classCur?.prof === prof && env.rt.classCur?.slot === slot && location.href === page
    && env.evidenceOwner?.() === owner && env.scanContext?.() === scan && env.actionGeneration?.() === generation
    && env.autonomyMode() === mode && env.heroLvl() === level && !env.pvpPending?.() && !env.antibotState?.() && !env.tvtSoon();
  const current = () => active() && env.victory() && ctx?.spawnId === ctxSpawn
    && env.$q('#battle-victory-inline') === victory && env.$q('#battle-victory-hunt') === hunt
    && (env.$q('#battle-mob-title')?.textContent || '') === title && JSON.stringify(env.battleInfo?.() || null) === infoSig
    && (!(recover || receiptRecovery) || lineage(state()) === lineageSig) && (!receiptRecovery || sameReceipt() && !env.nativePending?.());
  const huntReady = () => current() && !!hunt && env.shown(hunt) && !hunt.disabled;
  const hold = async why => { if (active()) { env.setStatus('Rebirth: ' + why); await env.sleep(1000); } };
  if (!active()) return;
  if (mode !== 'rebirth') return hold('выберите отдельный режим подземелий');
  // 20.76+ (ревизия 28.10): победа обычного моба/РБ тура при выбранном Rebirth (Start или смена режима на экране победы) держала
  // «жду вашего продолжения» до сторожа (~36 мин): rebirthReturn принимает только свои страницы. Точно чужой завершённый бой (URL,
  // метаданные, ctx и сохранённая связь — не Rebirth) бесплатно выходит в каталог: hunt не жмём, run/квитанции/оплаты не трогаем.
  const foreign = path() === '/battle.html' && ids.length === 1 && !!route && !/^rebirth_raid_/i.test(route)
    && !/^rebirth_raid_/i.test(info?.spawn || '') && !/^rebirth_raid_/i.test(ctxSpawn || '') && state().battleSpawn !== route;
  if (foreign) {
    const leave = () => current() && !env.nativePending?.();
    if (leave() && await env.rtCommit?.() && leave()) { env.setStatus('Rebirth: завершённый бой вне подземелий — открываю каталог'); location.href = '/rebirth-raids.html'; return; }
    // 20.76+ (ревизия 28.10): запрос игры ещё идёт или запись не сохранилась — пауза 1 с с причиной, а не холостой круг каждые ~0,2 с
    return hold('жду завершения запроса игры перед выходом в каталог');
  }
  if (!current() || !/^rebirth_raid_/i.test(after) || !owner || !scan || !Number.isFinite(generation)
      || !prof || !Number.isInteger(slot) || slot < 0 || fresh && ctxSpawn && ctxSpawn !== after)
    return hold('текущая победа не подтверждена — жду вашего продолжения');
  const key = JSON.stringify([char, prof, slot, after]), receiptKey = 'l2bot.rebirth-next';
  const receipt = () => JSON.parse(root.sessionStorage.getItem(receiptKey) || 'null');
  const clear = () => { try { if (receipt()?.key === key) root.sessionStorage.setItem(receiptKey, 'null'); } catch (_) {} };
  try {
    pendingReceiptRaw = root.sessionStorage.getItem(receiptKey);
    const pendingNext = JSON.parse(pendingReceiptRaw || 'null');
    if (pendingNext?.key === key) {
      // 20.74 (лог28.10 05:58): next уже ответил, но start/переход мог не состояться; старый hunt не повторяем.
      // Сохраняем квитанцию. После окончания нативного ожидания разрешена лишь свежая сверка своего run и бесплатный каталог.
      if (!boundLineage || route !== after || !Number.isFinite(pendingNext.t) || pendingNext.t < 0 || Date.now() - pendingNext.t < 8000)
        return hold('исход продолжения ещё не подтверждён — повторно не нажимаю');
      receiptRecovery = true;
      if (env.nativePending?.()) return hold('жду завершения запроса игры перед сверкой продолжения');
    }
  }
  catch (_) { return hold('не удалось прочитать отметку продолжения'); }
  if (rebirthAttempt?.key === key && (rebirthAttempt.busy || Date.now() < rebirthAttempt.until)) return hold('жду повторной серверной сверки');
  // 20.71 (лог27.10 05:49): отменённый до клика await не является отказом сервера и не оставляет паузу15с.
  // Параллельный вызов удерживает busy; задержка появляется только после фактического отказа сверки.
  const attempt = rebirthAttempt = { key, busy: true, until: 0 };
  const retry = async (why, ms = 15000) => {
    if (rebirthAttempt !== attempt || !current()) return;
    attempt.until = Date.now() + ms;
    return hold(why);
  };
  let reading = false;
  try {
    if (await env.tvtHoldWait?.() || !current()) return;
    const ready = !env.dailyWorkReady || await env.dailyWorkReady('mobs');
    if (!current()) return;
    if (!ready) return hold('лимит охоты проверяется или достигнут');
    if (env.actionWait && !await env.actionWait(current) || !current()) return;
    if (typeof env.gameGet !== 'function' || !await env.rtCommit?.() || !current()) return hold('не удалось подтвердить память перед продолжением');
    reading = true;
    // 20.71 (лог28.10 01:32): независимые свежие сверки героя и похода читаем вместе; до обеих нет native-клика.
    const snapshots = await Promise.allSettled(['/character','/game/rebirth-raids?view=instance'].map(async url => {
      const response = await env.gameGet(url, 4000);
      if (!current()) return null;
      return { ok: response.ok, data: response.ok ? await response.json() : null };
    }));
    if (!current()) return;
    if (snapshots.some(r => r.status !== 'fulfilled')) throw Error('read_failed');
    const [characterRead, instanceRead] = snapshots.map(r => r.value);
    if (!characterRead?.ok) return retry('персонаж не подтверждён сервером', 60000);
    const data = characterRead.data, ch = data?.character || data;
    reading = false;
    if (data?.error || data?.ok === false || ch?.name !== char || typeof ch.id !== 'string' || !ch.id || ch.l2Profession !== prof
        || ch.classSlots?.activeSlot !== slot || ch.level !== level || !Number.isSafeInteger(ch.revision) || ch.revision < 0 || ch.inBattle !== false
        || !Number.isSafeInteger(ch.rebirthStage) || ch.rebirthStage <= 0 || !(ch.hp > 0) || special(data) || special(ch))
      return retry('свой персонаж вне боя не подтверждён');
    if (!instanceRead?.ok) return retry('оплаченный поход не подтверждён сервером', 60000);
    const instance = instanceRead.data;
    const run = instance?.activeRun;
    if (instance?.error || instance?.ok === false || instance?.enabled !== true || !(instance.rebirthStage > 0))
      return retry('принадлежность текущего оплаченного похода не подтверждена');
    // 20.74 (лог28.10 06:10): устаревшая победа не должна удерживать уже исчезнувший поход на странице боя.
    // Каталог бесплатен; исход похода/повторный вход он проверяет отдельно, квитанцию next здесь не снимаем.
    if (run === null && boundLineage && (recover || receiptRecovery || parts[6].toLowerCase() !== 'raid')
        && ch.id === previousFight.actor && instance.rebirthStage === ch.rebirthStage
        && !env.nativePending?.()) return env.rebirthReturn?.(() => current() && lineage(state()) === lineageSig && !env.nativePending?.());
    if (receiptRecovery && (!run || !solo(run,ch.id) || ![1,2,3].includes(run.difficulty)
        || run.id.toLowerCase() !== parts[1].toLowerCase() || ch.id !== previousFight.actor || instance.rebirthStage !== ch.rebirthStage))
      return retry('свой текущий оплаченный поход после продолжения не подтверждён');
    // 20.68 (лог27.10 13:20): после РБ native next возвращает none; известная победа своего похода доводится до каталога.
    const previous=env.rt.rebirth,closed=mode==='rebirth'&&run===null&&previous?.char===char&&previous.actor===ch.id
      &&previous.prof===prof&&previous.slot===slot&&typeof previous.runId==='string'&&after.startsWith('rebirth_raid_'+previous.runId+'_')&&/_raid_\d+$/i.test(after);
    if (!closed && (typeof run?.id !== 'string' || !run.id || !after.startsWith('rebirth_raid_' + run.id + '_')
        || !Array.isArray(run.participantCharacterIds) || !run.participantCharacterIds.includes(ch.id)
        || mode==='rebirth' && (run.partyId!==null || run.participantCharacterIds.length!==1 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(run.id))))
      return retry('принадлежность текущего оплаченного похода не подтверждена');
    if ((recover || receiptRecovery) && (ch.id !== previousFight.actor || instance.rebirthStage !== ch.rebirthStage)) return retry('свой поход после потери метки победы не подтверждён');
    if (receiptRecovery && env.nativePending?.()) return hold('жду завершения запроса игры перед сверкой продолжения');
    const progress=run&&Number.isSafeInteger(run.mobKillTarget)&&run.mobKillTarget>0&&Number.isSafeInteger(run.mobKills)&&run.mobKills>=0;
    const nextStage=progress&&(run.phase==='mobs'&&(run.mobKills<run.mobKillTarget||mode==='rebirth'&&run.mobKills===run.mobKillTarget)
      ||mode==='rebirth'&&['champion','rb_active'].includes(run.phase)&&run.mobKills>=run.mobKillTarget);
    if (!closed&&!nextStage) {
      if(mode==='rebirth'&&typeof env.rebirthReturn==='function')return env.rebirthReturn(current);
      return hold('этап требует вашего выбора — новый вход и логово не открываю');
    }
    if (env.nativePending?.()) return hold('жду завершения запроса игры перед продолжением');
    if (recover || receiptRecovery) {
      // Только бесплатный возврат: свежий каталог сам продолжит этот оплаченный run, не повторяя неизвестный native next.
      return env.rebirthReturn?.(current);
    }
    // Новый большой этап проходит свою подготовку в каталоге; победу над самим РБ доводим до native next:none.
    const completedRole=after.match(/_(mob|champion|raid)_\d+$/i)?.[1].toLowerCase();
    // 20.76+ (ревизия 28.10, после ревью): mobs 300/300 с нужной подготовкой тоже уходит в каталог — next?after=mob_300 сразу открывает
    // чемпиона (312 тыс. HP), а решение 20.73/20.74 — вход/Fight только после подготовки HP/баффов/кота. Продолжение 300/300 из каталога ведёт step.
    if (!closed && (run.phase==='champion' && completedRole!=='champion' || run.phase==='rb_active' && completedRole!=='raid'
        || run.phase==='mobs' && env.needsPetPreparation?.())) return env.rebirthReturn?.(current);
    if (!huntReady()) return env.rebirthReturn?.(current);
    const stillReady = !env.dailyWorkReady || await env.dailyWorkReady('mobs');
    if (!current()) return;
    if (!stillReady) return hold('лимит охоты проверяется или достигнут');
    const saved = await env.setRt({ via: 'chain' });
    if (saved?.ok !== true || !current() || !await env.rtCommit?.() || !current()) return;
    if (env.nativePending?.()) return hold('жду завершения запроса игры перед продолжением');
    // Синхронная отметка переживает reload: неизвестный native next/start не разрешает второй клик.
    try { root.sessionStorage.setItem(receiptKey, JSON.stringify({ key, t: Date.now() })); }
    catch (_) { return hold('не удалось сохранить отметку продолжения'); }
    if (!huntReady()) { clear(); return; }
    env.setStatus('Rebirth: продолжаю оплаченный поход');
    if (!env.fire(hunt)) { clear(); return hold('кнопка продолжения не сработала'); }
    await env.waitFor(() => !active() || !env.victory() || JSON.stringify(env.battleInfo?.() || null) !== infoSig, 8000, 50);
    if (current()) return hold('исход продолжения ещё не подтверждён — повторно не нажимаю');
  } catch (_) {
    return reading ? retry('серверная сверка не ответила — жду без повторного входа', 60000)
      : hold('продолжение прервано до подтверждения — сверю состояние без нового входа');
  }
  finally { attempt.busy = false; }
}

 // 20.71: моб, обязательный чемпион и выбранный РБ — роли своего похода, а не цели обычной охоты.
 // Допуск всегда читает собственный живой бой и одиночный run; имя или один суффикс ID разрешением не служат.
 const spawnParts=sid=>{const p=typeof sid==='string'?sid.match(/^rebirth_raid_([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})_([1-9]\d*)_([1-9]\d*)_([1-9]\d*)_lv([1-9]\d*)_(mob|champion|raid)_(0|[1-9]\d*)$/i):null;
  return p&&(p[6].toLowerCase()==='raid'||Number(p[7])>0)?p:null;};
 let battleGate={key:'',until:0,busy:false,failures:0};
 async function battleProof({name,max,title,valid}={}){
  const T=token(),still=()=>current(T)&&env.autonomyMode?.()==='rebirth'&&typeof valid==='function'&&valid()===true;
  if(!still()||path()!=='/battle.html')return null;
  const level=Number(String(title||'').match(/[·•]\s*ур\.?\s*(\d+)/i)?.[1]),key=JSON.stringify([T,name,max,title]);
  if(battleGate.key!==key)battleGate={key,until:0,busy:false,failures:0};
  const G=battleGate;
  const hold=async reason=>{if(still()){env.setStatus?.('Подземелья Rebirth: '+reason);await env.sleep?.(700);}return null;};
  if(G.busy||Date.now()<G.until)return hold('жду подтверждение собственного боя');
  if(!T.lease||!Number.isInteger(T.slot)||T.slot<0||!Number.isFinite(T.generation)||!Number.isFinite(max)||!(max>0&&level>0)
   ||typeof name!=='string'||!name.trim()||typeof env.gameGet!=='function')return hold('контекст героя или цели ещё не готов');
  G.busy=true;G.until=Date.now()+15000;
  const readBattle=async url=>{const response=await env.gameGet(url,4000);if(!still())return null;if(!response.ok)throw Error('read_failed');
   const body=await response.json();return still()?body:null;};
  try{
   if(!await env.rtCommit?.()||!still())return null;
   const first=await readBattle('/character');if(!still())return null;
   const ch=first?.character||first,sid=ch?.battleSpawnId,parts=spawnParts(sid);
   if(first?.error||first?.ok===false||special(first)||!own(ch,T)||ch.inBattle!==true||!Number.isSafeInteger(ch.rebirthStage)||ch.rebirthStage<=0||!parts)
    return hold('свой текущий бой подземелья не подтверждён');
   // 20.71 (лог28.10 01:32): бой зависит от свежего character, но instance — независимый GET; ждём оба, сохраняя все проверки.
   const snapshots=await Promise.allSettled([
    readBattle('/game/battle?characterId='+encodeURIComponent(ch.id)+'&spawnId='+encodeURIComponent(sid)),
    readBattle('/game/rebirth-raids?view=instance')]);
   if(!still())return null;
   if(snapshots.some(r=>r.status!=='fulfilled'))throw Error('read_failed');
   const [result,instance]=snapshots.map(r=>r.value);
   const c=result?.character,b=result?.battle,role=parts[6].toLowerCase();
   if(result?.error||result?.ok===false||!own(c,T,ch.revision,ch.id)||c.inBattle!==true||c.battleSpawnId!==sid||c.rebirthStage!==ch.rebirthStage
    ||!b||b.spawnId!==sid||String(b.mobName||'').trim().toLowerCase()!==name.trim().toLowerCase()||b.mobLevel!==level||Number(parts[5])!==level
    ||b.mobMaxHp!==max||!Number.isFinite(b.mobHp)||b.mobHp<=0||b.mobHp>max||b.ended===true||b.finished===true||result.victory||result.defeat
    ||/^(?:ended|finished|victory|defeat)$/i.test(String(b.status||b.state||''))||special(result)||special(b)
    ||!(b.kind==='dungeon'||role==='raid'&&/^(?:raid|boss|raid_boss)$/.test(b.kind||'')))return hold('живая цель, тип или снимок героя не совпали');
   const run=instance?.activeRun,progress=integer(run?.mobKills)&&integer(run?.mobKillTarget)&&run.mobKillTarget>0;
   if(instance?.error||instance?.ok===false||instance?.enabled!==true||instance.rebirthStage!==ch.rebirthStage||!solo(run,ch.id)
    ||run.id.toLowerCase()!==parts[1].toLowerCase()||![1,2,3].includes(run.difficulty)||!progress)return hold('принадлежность текущего одиночного похода не подтверждена');
   const phase=role==='mob'?run.phase==='mobs'&&run.mobKills<run.mobKillTarget
    :role==='champion'?run.phase==='champion'&&run.mobKills>=run.mobKillTarget
    :selectedBoss(run)&&run.mobKills>=run.mobKillTarget&&run.selectedBossSpawnId==='l2dop_rb_'+parts[4]&&run.selectedBossSlot===Number(parts[7]);
   if(!phase)return hold('роль цели не совпала с этапом собственного похода');
   const F=state().fightPending,clearFight=F&&F.runId===run.id&&F.actor===ch.id&&F.char===T.char&&F.prof===T.prof&&F.slot===T.slot;
   if(!await save(T,{...runFields(run,c),phase:'battle',battleRole:role,battleSpawn:sid,...(clearFight?{fightPending:null}:{})})||!still())return null;
   if(battleGate!==G)return null;
   G.until=0;G.failures=0;
   return{spawn:sid,name:String(b.mobName).trim(),lvl:b.mobLevel,role,runId:run.id,
    current:()=>still()&&state().runId===run.id&&state().actor===ch.id&&state().prof===T.prof&&state().slot===T.slot};
  }catch(_){
   if(battleGate===G&&still()){G.failures=Math.min(3,G.failures+1);G.until=Date.now()+3000*2**(G.failures-1);}
   return hold('серверная сверка боя не ответила — повторю без смены режима');
  }finally{G.busy=false;}
 }
 async function step(){
  if(busy||!on()||env.canAct?.()===false||env.canRun?.()===false)return false;
  // Открытый бой и его победу ведёт общее боевое ядро, включая уже начатый игроком бой с выбранным РБ.
  if(path()==='/battle.html')return false;
  const T=token(),key=JSON.stringify(T);if(!current(T))return false;
  if(gate.key!==key)gate={key,until:0,failures:0};
  if(Date.now()<gate.until)return true;
  busy=true;gate.until=Date.now()+3000;
  try{
   const characterReadAt=Date.now(),data=await read('/character',T);if(!current(T))return true;
   const ch=data?.character||data;
   if(data?.error||data?.ok===false||!own(ch,T)||!T.lease||!Number.isInteger(T.slot)||T.slot<0||!Number.isFinite(T.generation))return status(T,'wait','свой герой, класс или состояние боя не подтверждены');
   if(ch.inBattle){
    const sid=ch.battleSpawnId;
    if(!spawnParts(sid))return status(T,'wait','открыт бой вне подземелья Rebirth — завершите его вручную или выберите другой режим');
    const battle=await read('/game/battle?characterId='+encodeURIComponent(ch.id)+'&spawnId='+encodeURIComponent(sid),T);if(!current(T))return true;
    const c=battle?.character,b=battle?.battle;
    if(battle?.error||battle?.ok===false||!own(c,T,ch.revision,ch.id)||c.inBattle!==true||c.battleSpawnId&&c.battleSpawnId!==sid
     ||!b||b.spawnId!==sid||!Number.isFinite(b.mobHp)||b.mobHp<=0||!Number.isFinite(b.mobMaxHp)||b.mobMaxHp<b.mobHp
     ||b.ended||b.finished||battle.victory||battle.defeat||special(battle)||special(b))return status(T,'wait','текущий живой бой не подтверждён');
    const F=state().fightPending;if(F&&sid.startsWith('rebirth_raid_'+F.runId+'_'))await save(T,{fightPending:null});
    await status(T,'battle','возвращаюсь в незавершённый бой');await navigate(T,'/battle.html?spawnId='+encodeURIComponent(sid));return true;
   }
   const instance=await read('/game/rebirth-raids?view=instance',T);if(!current(T))return true;
   if(instance?.error||instance?.ok===false||instance?.enabled!==true||!(instance.rebirthStage>0)||!(ch.rebirthStage>0)
    ||!Object.hasOwn(instance,'activeRun'))return status(T,'wait','состояние подземелья не подтверждено');
   const run=instance.activeRun;let P=state().pending;
   gate.failures=0;
   if(run){
    if(!solo(run,ch.id)||![1,2,3].includes(run.difficulty))return status(T,'wait','принадлежность одиночного похода не подтверждена');
    // Если после восстановления поход всё ещё существует, та смерть не подтверждает его последующее исчезновение.
    if(state().failedRun?.restoredAt&&state().failedRun.runId===run.id)await save(T,{failedRun:null});
    const info=runFields(run,ch);
    if(P&&knownUnsent(P,'pending',ch,T)&&await save(T,{pending:null})){unmark(P,'pending');P=null;}
    if(P?.kind==='entry'){
     const match=P.actor===ch.id&&P.prof===T.prof&&P.slot===T.slot&&P.char===T.char&&P.difficulty===run.difficulty
      &&P.noActiveRun===true&&Number.isFinite(P.baselineAt)&&P.baselineAt<=characterReadAt&&P.at<=characterReadAt&&P.previousRunId!==run.id
      &&ch.revision>=P.revision&&P.ack?.ok!==false&&(!P.ack?.runId||P.ack.runId===run.id);
     if(match)await save(T,{pending:null,lastEntry:{runId:run.id,difficulty:run.difficulty,cost:P.cost,at:Date.now(),confirmation:P.ack?.ok?'native-ack':'fresh-own-run'}});
    }
    const F=state().fightPending;
    if(F&&(F.runId!==run.id||integer(run.mobKills)&&run.mobKills>F.mobKills||F.runPhase&&F.runPhase!==run.phase
     ||F.phase==='prepared'&&F.actor===ch.id&&F.char===T.char&&F.prof===T.prof&&F.slot===T.slot||knownUnsent(F,'fightPending',ch,T)))
     if(await save(T,{fightPending:null}))unmark(F,'fightPending');
    const B=state().bossPending;
    if(B&&B.runId===run.id&&B.actor===ch.id&&B.char===T.char&&B.prof===T.prof&&B.slot===T.slot&&ch.revision>=B.revision){
     if(selectedBoss(run))await save(T,{bossPending:null,lastBossChoice:{runId:run.id,bossSlot:run.selectedBossSlot,spawnId:run.selectedBossSpawnId,
      choice:run.selectedBossSlot===3&&run.selectedBossSpawnId==='l2dop_rb_25098'?'staff1h':'manual-other',confirmation:'fresh-own-run'}});
     else if(B.phase==='prepared'||knownUnsent(B,'bossPending',ch,T)){if(await save(T,{bossPending:null}))unmark(B,'bossPending');}
    }
    if(!current(T))return true;
    const progress=integer(run.mobKills)&&integer(run.mobKillTarget)&&run.mobKillTarget>0;
    // 20.76+ (ревизия 28.10): mobs 300/300 до серверного перехода в champion — продолжаемый этап (prepareRun → «Продолжить» → нативный «Бой»
    // или ожидание кнопки чемпиона), а не ручной выбор: сюда приводит возврат в каталог с победы над mob_300 ради подготовки.
    const known=progress&&(run.phase==='mobs'&&run.mobKills<=run.mobKillTarget||run.phase==='champion'&&run.mobKills>=run.mobKillTarget||selectedBoss(run));
    if(!known){
     if(path()!=='/rebirth-raid-dungeon.html'){
      await status(T,'manual','открываю текущий поход для ручного выбора',info);await navigate(T,'/rebirth-raid-dungeon.html');return true;
     }
     if(state().bossPending)return status(T,'unknown','исход выбора РБ не подтверждён — повторно не выбираю',info);
     if(env.cfg.rebirthBossChoice==='staff1h'&&progress&&run.mobKills>=run.mobKillTarget&&typeof run.phase==='string'&&run.phase
      &&!['mobs','champion','rb_active','none','completed','finished'].includes(run.phase)&&gateProof()){
      if(!await quota(T))return current(T)?status(T,'quota','лимит охоты проверяется или достигнут',info):true;
      await status(T,'boss-choice','выбираю подтверждённого РБ с одноручным посохом',info);await chooseBoss(T,ch,run);return true;
     }
     return status(T,'manual','этап требует вашего выбора; выберите цель в подземелье вручную',info);
    }
    if(!await quota(T))return current(T)?status(T,'quota','лимит охоты проверяется или достигнут',info):true;
    if(typeof env.prepareRun==='function'){
     const preparing=await env.prepareRun({character:ch});if(!current(T))return true;
     if(preparing){await status(T,'prepare','готовлю героя и суммона перед боем текущего похода',info);return true;}
    }
    const wantedPage=run.phase==='rb_active'?'/rebirth-raid-lair.html':'/rebirth-raid-dungeon.html';
    if(path()!==wantedPage){
     await status(T,'resume','продолжаю существующий оплаченный поход',info);
     if(run.phase==='rb_active'&&path()==='/rebirth-raid-dungeon.html'){await navigate(T,wantedPage);return true;}
     if(path()!=='/rebirth-raids.html'){await navigate(T,'/rebirth-raids.html');return true;}
     const button=env.$q?.('.l2-rraid-main-button');
     if(!shown(button)||!/продолжить подземелье|продовжити підземелля/i.test(button.textContent||''))return status(T,'wait','жду нативную кнопку продолжения',info);
     if(current(T)&&!env.nativePending?.())env.fire(button);return true;
    }
    // 20.76+ (ревизия 28.10): sent-квитанция боя, который сервер не открыл (500 invalid_spawn/незагрузка боя → каталог), держала оплаченный поход вечно:
    // Start/сторож её не снимали. Fight бесплатен (оплачен вход): через 30 с без запроса игры в полёте, по свежему «вне боя» и тому же run/этапу/счёту —
    // до двух повторов на этот счёт; затем ожидание ручного «Бой» или нового Старта (Start даёт ещё два).
    const FP=state().fightPending;
    if(FP){
     const R=state().fightRetry,tries=R?.runId===run.id&&R.runPhase===run.phase&&R.mobKills===run.mobKills&&R.kick===T.kick&&integer(R.n)?R.n:0;
     const stale=FP.phase==='sent'&&Number.isFinite(FP.sentAt)&&FP.sentAt<=characterReadAt-30000&&!env.nativePending?.()&&ch.inBattle===false&&ch.revision>=FP.revision
      &&FP.runId===run.id&&FP.runPhase===run.phase&&FP.mobKills===run.mobKills&&FP.actor===ch.id&&FP.char===T.char&&FP.prof===T.prof&&FP.slot===T.slot;
     if(!stale||tries>=2)return status(T,'unknown',stale?'бой дважды не открылся — откройте его вручную или нажмите Старт':'исход открытия боя не подтверждён — повторно не нажимаю',info);
     if(!await save(T,{fightPending:null,fightRetry:{runId:run.id,runPhase:run.phase,mobKills:run.mobKills,kick:T.kick,n:tries+1}}))return true;
     env.rec?.('B','Rebirth','Бой не открылся за 30 с: свежий герой вне боя, поход и счёт прежние — бесплатный повтор «Бой» '+(tries+1)+'/2');
    }
    const content=env.$q?.('#rebirth-instance-content'),button=[...(content?.querySelectorAll?.('.l2-rraid-fight')||[])].find(shown)
     ||run.phase==='rb_active'&&env.$q?.('.l2-rraid-fight');
    if(!button){
     if(run.phase!=='mobs')return status(T,'wait','жду нативную кнопку боя текущего этапа',info);
     // 20.76+ (ревизия 28.10): все мобы этапа убиты — страницы мобов не листаем (hint 21 > 20 страниц), ждём кнопку чемпиона.
     if(run.mobKills>=run.mobKillTarget)return status(T,'wait','все мобы этапа убиты — жду нативную кнопку чемпиона (или откройте его вручную)',info);
     const currentPage=Number(new URLSearchParams(location.search||'').get('page')||1),hint=Math.floor(run.mobKills/15)+1,maxPage=Math.ceil(run.mobKillTarget/15);
     const pages=[...(content?.querySelectorAll?.('.l2-rraid-pager-btn')||[])].filter(shown).map(b=>({b,n:Number(String(b.textContent||'').trim())}))
      .filter(x=>Number.isSafeInteger(x.n)&&x.n>0&&x.n<=maxPage&&x.n!==currentPage);
     const next=pages.find(x=>x.n===hint)||pages.filter(x=>x.n>currentPage).sort((a,b)=>a.n-b.n)[0];
     if(next){await status(T,'page','открываю страницу оставшихся мобов',info);if(current(T)&&!env.nativePending?.()&&shown(next.b))env.fire(next.b);return true;}
     return status(T,'wait','жду доступную нативную кнопку «Бой» на текущей странице',info);
    }
    await status(T,run.phase,run.phase==='champion'?'открываю чемпиона текущего похода':run.phase==='rb_active'?'открываю выбранного РБ':'продолжаю мобов текущего похода',info);await native(T,button,'fight',ch,run);return true;
   }
   if(run!==null)return status(T,'wait','отсутствие активного похода не подтверждено');
   if(state().fightPending)await save(T,{fightPending:null});
   if(state().bossPending)await save(T,{bossPending:null});
   if(P&&knownUnsent(P,'pending',ch,T)&&await save(T,{pending:null})){unmark(P,'pending');P=null;}
   if(P){
    if(P.kind==='entry'&&P.phase==='prepared')await save(T,{pending:null});
    else if(P.kind==='entry'&&P.ack?.ok===false){await save(T,{pending:null});gate.until=Date.now()+15000;return status(T,'rejected','нативный вход отклонён — перечитаю состояние');}
    else return status(T,'unknown','исход предыдущего входа или боя неизвестен — новый вход запрещён');
   }
   if(!current(T))return true;
   if(env.cfg.rebirthAutoEnter!==true)return status(T,'manual-entry','поход не активен — войдите вручную или разрешите автоматические входы',{runId:null,mobKills:0,mobKillTarget:0});
   const previous=state().observedRun;
   const failed=state().failedRun;
   const deathRestart=failed?.kind==='death'&&failed.char===T.char&&failed.actor===ch.id&&failed.prof===T.prof&&failed.slot===T.slot
    &&failed.kick===T.kick&&UUID.test(failed.runId||'')&&failed.runId===previous?.id
    &&spawnParts(failed.spawn)?.[1]?.toLowerCase()===failed.runId.toLowerCase()
    &&Number.isFinite(failed.at)&&failed.at<=characterReadAt&&env.rt.deathLog?.includes(failed.at)
    &&Number.isFinite(failed.restoredAt)&&failed.restoredAt>=failed.at&&failed.restoredAt<=characterReadAt
    &&instance.rebirthStage===ch.rebirthStage;
   if(previous?.char===T.char&&previous.actor===ch.id&&UUID.test(previous.id||'')
    &&previous.kick===T.kick&&!completion(ch,T,previous)&&!deathRestart){
    // 20.79+ (лог 29.10 14:39): старый городской маршрут иначе не достигает prepareEntry/return и остаётся навсегда. Нового входа это не разрешает.
    if(typeof env.cancelRunPreparation==='function'){const waiting=await env.cancelRunPreparation({character:ch});if(!current(T)||waiting)return true;}
    return status(T,'missing-run','прошлый поход исчез без подтверждённого завершения — нужен новый Старт или ручной вход');
   }
   if(!await quota(T))return current(T)?status(T,'quota','лимит охоты проверяется или достигнут'):true;
   // Подготовка может вести героя в город: только перед новым разрешённым входом, никогда посреди оплаченного похода.
   if(typeof env.prepareEntry==='function'){
    const preparing=await env.prepareEntry({character:ch});if(!current(T))return true;
    if(preparing){await status(T,'prepare','подготовка героя и суммона перед новым входом');return true;}
   }
   if(path()!=='/rebirth-raids.html'){await status(T,'catalog','открываю каталог подземелий');await navigate(T,'/rebirth-raids.html');return true;}
   const quote=entryQuote();
   if(!quote)return status(T,'price','нативная цена, валюта или кнопка выбранного входа не подтверждены');
   if(quote.keys-quote.cost<quote.reserve)return status(T,'keys','не хватает ключей с учётом резерва');
   quote.previousRunId=state().runId||state().lastEntry?.runId||null;
   await status(T,'entry','подтверждены цена и ключи; готовлю нативный вход',{actor:ch.id,prof:T.prof,slot:T.slot,runId:null});
   await native(T,quote.button,'entry',ch,null,quote);return true;
  }catch(_){
   if(current(T)){gate.failures=Math.min(3,gate.failures+1);gate.until=Date.now()+3000*2**(gate.failures-1);await status(T,'read','серверная сверка не ответила — повторю без нового входа');}
   return true;
  }finally{busy=false;}
 }
 return{on,step,note,nextFight,battleProof,summary:()=>({...state(),enabled:on()})};
};
})(globalThis);
