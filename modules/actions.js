/* 10.0.24: один владелец служебного маршрута. Перезагрузка не меняет владельца. */
(function(root){'use strict';
 root.L2V7Factories=root.L2V7Factories||Object.create(null);
 root.L2V7Factories.actions=function(env){
 let frame=null, executing=null, busy=false, reconciliation=null, ownerNeedsCommit=false, ownerCommitKey=null;
 // 20.43 (автономность, ревью 21.10): режим в контексте — routeMode (выбор игрока без передышки и ожидания тура на рыбалке). Передышку бот
 // берёт и снимает сам; раньше её конец (и начало) менял autonomyMode и отменял начатый маршрут как «пользователь сменил режим или цель»
 const context=()=>JSON.stringify([env.rt.char||'',(env.routeMode||env.mode)(),+env.rt.manualKickAt||0,env.cfg.catDungeon||'',env.cfg.farmRes||'',env.cfg.recipeRes||'',env.cfg.autoTasks||null]);
 const live=()=>env.on&&env.tabOwner;
 const stamp=j=>String(j?.id||j?.t||j?.at||'legacy');
 // 20.43 (автономность): exitMiss — повтор бесплатного выхода тура из Ashen раз в минуту (raid.rbExitAshen) — новый этап, а не цикл
 const phase=j=>JSON.stringify([j?.phase||j?.step||'',j?.done?.length||0,j?.fa||[],j?.id||j?.target||'',j?.entry?.revision||0,j?.pending?.id||'',j?.page??j?.p??j?.cursor??'',typeof j==='object'?'':j,j?.exitMiss||0]);
 function enterFrame(){frame={context:context(),lease:env.lease(),generation:env.actionGeneration?.()};}
 function canAct(){return live()&&!env.challengeHold?.()&&(!frame||frame.context===context()&&frame.lease===env.lease()&&frame.generation===env.actionGeneration?.())&&(!executing||executing.context===context()&&!env.interrupted());}
 function owns(key){return executing?.key===key&&canAct();}
 // 17.10, реворк: setRt меняет память до подтверждения записи. Следующий тик не должен принять её за durable-владельца.
 async function save(p){
  if(Object.hasOwn(p,'actionOwner')){ownerNeedsCommit=true;ownerCommitKey=p.actionOwner?.key||env.rt.actionOwner?.key||ownerCommitKey;}
  try{const r=await env.setRt(p);if(r?.ok===false||!await env.rtCommit()||!live()){env.setStatus?.('Служебный маршрут: жду сохранения состояния');return false;}if(Object.hasOwn(p,'actionOwner')){ownerNeedsCommit=false;ownerCommitKey=null;}return true;}
  catch(_){env.setStatus?.('Служебный маршрут: жду сохранения состояния');return false;}
 }
 async function clear(O,why){
  const jobs=env.jobs(),patch={actionOwner:null};
  // Ручная смена режима отменяет старые маршруты, но никогда не удаляет квитанции платежей.
  if(why)for(const j of jobs){const value=env.rt[j.key];if(value&&!(j.key==='sealEx'&&value.manual===true&&+value.t>=(+env.rt.manualKickAt||0))&&(+value.t||+value.at||0)<=(+env.rt.manualKickAt||Date.now()))patch[j.key]=null;}
  if(why&&env.rt[O.key]&&stamp(env.rt[O.key])===O.stamp)patch[O.key]=null;
  if(why && patch.tbuff===null && env.rt.tbuff)patch.tbInterrupted={t:Date.now(),jobT:env.rt.tbuff.t};
  if(why)patch.actionLast={key:O.key,reason:why,at:Date.now()};
  if(await save(patch))env.rec('B','действия',why?`${O.key}: ${why}; старый маршрут отменён`:`${O.key}: маршрут завершён`);
 }
 // 20.13 (ревизия 17.10, шаг 5, аудит ACT-1): цикл одного служебного маршрута (магазин открывает не ту вкладку, сумка и т. п.)
 // раньше выключал бота целиком (halt hard) — вместе с рыбалкой, фармом и TvT. Теперь снимается только этот маршрут,
 // у магазина — пауза закупки (shopT/shopFail, 10 → 30 → 60 → 180 мин). Полная остановка — как прежде, если тот же маршрут
 // зациклился 3 раза за час, и всегда для выхода тура РБ (rbHunt — это состояние тура, а не одноразовый маршрут).
 const LOOP_WINDOW=3600000,LOOP_MAX=3,BAN_MS=2*3600000,RB_LOOP_SKIP_MS=3600000;
 // 20.43 (автономность, ревью 21.10): запрет длится 2 ч, поэтому 4-й запрет одного маршрута в окно передышек 6 ч не попадал никогда — маршрут
 // снова зацикливался после каждого запрета (с новой оплатой телепорта/баффов), без стопа и уведомления. Для запретов окно учёта — 12 ч
 const BAN_HOLD_WINDOW=12*3600000;
 // Создатель маршрута тоже должен знать о запрете, иначе он пересоздаёт маршрут каждый круг. Где у создателя есть своя отметка «была попытка»,
 // ставим её (на запрете и на каждом снятии): перелёт зоны/РБ — zoneGoT (автофарм 10 мин, цель ресурса 3 мин), чтение сумки в туре — invTourT,
 // магистр — magRetry до конца запрета, баффер — tbPauseUntil, закупка — shopT. Маммон и чтение сумки вне тура проверяют запрет сами (routeBanned)
 function rest(key,value,until,now){
  if(key==='tbuff')return{tbPauseUntil:Math.max(+env.rt.tbPauseUntil||0,until)};
  if(key==='shop')return{shopT:now};
  if(key==='zoneGo'||key==='rbGo')return{zoneGoT:now};
  if(key==='invScan')return{invTourT:now};
  if(key==='magister'&&value?.key)return{magRetry:{key:value.key,lvl:value.lvl,until}};
  return{};
 }
 // 20.43 (автономность, разбор 21.10): вместо полного стопа. Цикл выхода тура РБ (rbHunt) — текущий РБ откладывается на 60 мин (rbSkip
 // {until}), тур возвращается к выбору цели; третий цикл того же маршрута за час — маршрут запрещён на 2 ч (rt.actionBan), остальные задачи
 // идут. Полный стоп с причиной — 4-я такая отсрочка одного вида за 6 ч (env.selfHold, вид rbExit; route:<маршрут> — за 12 ч). Платежи не трогаем:
 // квитанции и неизвестная оплата (pending) живут отдельно, повторной оплаты отсрочка не делает.
 async function loopTrip(O,job,why){
  const now=Date.now();
  if(job.key==='rbHunt'){
   const H=env.rt.rbHunt||{},target=H.name||H.id||'цель тура';
   if(!env.selfHold){await env.halt(why,true);return;}
   if(await env.selfHold('rbExit',`${why} (${target})`,{noWait:true,hard:true})!=='defer'||!live())return;
   const patch={actionOwner:null,rbHunt:{step:'pick',phase:'learn',t:now,last:`${target}: цикл маршрута — отложен на 60 мин`,next:'выбираю следующего живого РБ'},rbWant:null,rbCur:null,
    actionLast:{key:job.key,reason:'цикл маршрута',at:now},...(H.id?{rbSkip:{...(env.rt.rbSkip||{}),[H.id]:{t:now,until:now+RB_LOOP_SKIP_MS,why:'цикл маршрута тура'}}}:{})};
   if(await save(patch))env.rec('B','действия',`${why}; ${target} отложен на 60 мин, тур выбирает следующую цель`);
   return;
  }
  const loops={...(env.rt.actionLoops||{})},list=(Array.isArray(loops[job.key])?loops[job.key]:[]).filter(t=>now-t<LOOP_WINDOW);
  list.push(now);loops[job.key]=list.slice(-LOOP_MAX);
  const ban=list.length>=LOOP_MAX;
  if(ban){
   if(!env.selfHold){await env.halt(`${why}; ${list.length}-й раз за час`,true);return;}
   if(await env.selfHold('route:'+job.key,`${why}; ${list.length}-й раз за час`,{noWait:true,hard:true,window:BAN_HOLD_WINDOW})!=='defer'||!live())return;
   loops[job.key]=[];
  }
  const value=env.rt[job.key],patch={actionOwner:null,[job.key]:null,actionLoops:loops,actionLast:{key:job.key,reason:'цикл маршрута',at:now}};
  if(ban)patch.actionBan={...(env.rt.actionBan||{}),[job.key]:{t:now,until:now+BAN_MS,why:String(why).slice(0,160)}};
  if(job.key==='tbuff'&&env.rt.tbuff)patch.tbInterrupted={t:now,jobT:env.rt.tbuff.t};
  if(ban)Object.assign(patch,rest(job.key,value,now+BAN_MS,now));   // сторож баффов, автофарм, магистр… сами не создают маршрут, пока запрет
  if(job.key==='shop'){const n=ban?4:Math.min(4,Math.floor(+env.rt.shopFail?.n||0)+1);patch.shopT=now;patch.shopFail={n,t:now,adena:env.rt.shopFail?.adena??null,keys:['цикл']};}
  if(await save(patch))env.rec('B','действия',ban?`${why}; ${list.length}-й раз за час — маршрут ${job.key} запрещён на 2 ч, остальные задачи продолжаются`:`${why}; маршрут ${job.key} снят (${list.length}/${LOOP_MAX} за час), остальные задачи продолжаются`);
 }
 // Запрет маршрута: созданный заново маршрут снимается до запуска (явная команда меню — urgent/manual, кнопка Маммона cmd — не запрещается).
 // В журнал — один раз на запрет. 20.43 (автономность, ревью 21.10): раньше 10-й запрос давал передышку текущей основной задаче (фарму), а не
 // той службе, что просит маршрут: фарм стоял до конца запрета, служба продолжала проситься, и круг уходил на «создать → снять» — бот и не
 // работал, и не останавливался. Теперь создатели знают о запрете (rest, routeBanned); если какой-то всё же пересоздаёт маршрут каждый круг
 // (BAN_ASK_MAX раз за BAN_ASK_WINDOW) — пауза с причиной и уведомлением (pauseBot fault: сервер лежит — сначала ждёт сервер), без передышки.
 // Создатель со своей паузой (перелёт тура «РБ между мобами» — раз в 8 с, автофарм — раз в 10 мин) в это окно не попадает: только снятие
 const BAN_ASK_MAX=10,BAN_ASK_WINDOW=60000,banSaid=new Set();
 function banned(key,value){const b=env.rt.actionBan?.[key];return b&&+b.until>Date.now()&&!(value&&typeof value==='object'&&(value.urgent===true||value.manual===true||value.cmd===true))?b:null;}
 async function banDrop(O,job,b){
  const now=Date.now(),hm=new Date(+b.until).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
  const burst=now-(+b.askT||0)<BAN_ASK_WINDOW,asks=burst?(+b.asks||0)+1:1,trip=asks>=BAN_ASK_MAX;
  const patch={[job.key]:null,actionBan:{...(env.rt.actionBan||{}),[job.key]:{...b,asks:trip?0:asks,askT:trip?0:burst?+b.askT:now}},...rest(job.key,env.rt[job.key],+b.until,now)};
  if(O&&O.key===job.key)patch.actionOwner=null;
  if(!await save(patch))return;
  const said=job.key+':'+b.t;
  if(!banSaid.has(said)){banSaid.add(said);env.rec('B','действия',`маршрут ${job.key} запрещён до ${hm} (${b.why||'цикл маршрута'}) — новый запрос снят, остальные задачи продолжаются`);}
  if(trip&&env.pauseBot&&live())await env.pauseBot(`Маршрут ${job.key} запрещён после циклов (до ${hm}), но его снова создают — ${BAN_ASK_MAX} раз за ${BAN_ASK_WINDOW/60000} мин; основная работа стоит. Пришлите журнал; ▶ Продолжить — попробовать снова`,{fault:true});
 }
 async function dispatch(){
  if(busy)return true;
  if(!live())return false;
  if(env.challengeHold?.())return true;
  busy=true;
  try{
   const jobs=env.jobs();let O=env.rt.actionOwner;
   const pending=env.paymentPending();
   if(pending){
    // Не задерживаем защиту в живом бою. После победы сверяем оплату здесь:
    // следующая охота запрещена pending, а страница всё ещё считается боевой.
    if(env.isBattle()&&!env.victory?.()){await env.runCombat();return true;}
    const key=String(pending.id||pending.kind)+':'+env.page(),now=Date.now();
    if(!reconciliation||reconciliation.key!==key||now-reconciliation.at>=15000){reconciliation={key,at:now};await env.reconcile(pending);}
    // 20.12 (ревизия 17.10, аудит PAY-1/H1): неизвестная оплата блокирует только платные шаги. Владелец маршрута и его
    // этап не трогаем, а бесплатную работу на месте (бой, цепочка, фарм точки, рыбалка из сумки) делает ядро.
    const still=env.paymentPending();
    if(still&&live()&&!env.challengeHold?.()&&env.freeWork)await env.freeWork(still);
    return true;
   }
   reconciliation=null;
   if(ownerNeedsCommit&&(!await save({actionOwner:env.rt.actionOwner||null})||!canAct()))return true;
   if(env.mode()==='enchant'&&!O)return false;
   if(O&&O.context!==context()){
    await clear(O,'пользователь сменил режим или цель');return true;
   }
   let job=O&&jobs.find(j=>j.key===O.key&&env.rt[j.key]);
   if(job&&job.key!=='tbuff'&&env.rt.tbuff?.step==='restore'){await clear(O);O=null;job=jobs.find(j=>j.key==='tbuff');}
   // Перелёт рейда может делегировать подготовку бафферу/снабжению, затем продолжится.
   if(job?.key==='rbGo'){const child=jobs.find(j=>['tbuff','petBufferTrip','shop','invScan'].includes(j.key)&&env.rt[j.key]);if(child){await clear(O);O=null;job=child;}}
   if(O&&!job){await clear(O);O=null;}
   if(!job)job=jobs.find(j=>env.rt[j.key]);
   if(!job)return false;
   {const b=banned(job.key,env.rt[job.key]);if(b){await banDrop(O,job,b);return true;}}
   if(env.isBattle()&&!env.rt.shop?.urgent)return false;
   if(env.rt.shop?.urgent){
    if(O&&O.key!=='shop'){await clear(O);O=null;}job=jobs.find(j=>j.key==='shop');
   }
   const now=Date.now(),value=env.rt[job.key],p=phase(value),page=env.page();
   // 20.43 (разбор 21.10): служебный маршрут (магазин, бафф, Маммон, телепорт зоны, сумка…) — разрыв охоты: время до следующей победы
   // не время на моба (content.trackEfficiency), прошлую победу забываем той же записью
   if(!O){O={id:env.id(),key:job.key,context:context(),stamp:stamp(value),at:now,phase:p,progressAt:now,page,visits:1,seen:{[JSON.stringify([page,p])]:1}};if(!await save({actionOwner:O,lastWinT:0})||!canAct())return true;env.rec('B','действия',`${job.key}: владелец маршрута (${env.mode()})`);}
   else{
    const changed=p!==O.phase;
    const node=JSON.stringify([page,p]),seen={...(O.seen||{})};
    if(changed||page!==O.page)seen[node]=(seen[node]||0)+1;
    const next={...O,phase:p,progressAt:changed?now:O.progressAt,page,visits:changed?1:(O.visits||1)+(page!==O.page?1:0),seen:Object.fromEntries(Object.entries(seen).slice(-64))};
    if(seen[node]>5){await loopTrip(O,job,`Маршрут ${job.key}: повторяется цикл страниц и этапов (5 возвратов)`);return true;}
    // Время ожидания TvT/сервера не ограничиваем. Ловим именно переходы без изменения этапа.
    if(next.visits>10){await loopTrip(O,job,`Маршрут ${job.key}: более 10 переходов без продвижения этапа ${value.phase||value.step||''}`);return true;}
    if(JSON.stringify(next)!==JSON.stringify(O)){if(!await save({actionOwner:next}))return true;O=next;}
   }
   if(!canAct()||env.interrupted())return true;
   executing=O;
   try{await job.run();}finally{executing=null;}
   if(canAct()&&!env.rt[job.key])await clear(O);
   return true;
  }finally{busy=false;}
 }
 // 20.50: ограниченный выход подготовки Detect при отказе записи. Не касается платежей и выполняющегося шага.
 function releaseExpired(key,id){
  if(key!=='detectOutside'||busy||executing||!live()||!canAct())return false;
  const J=env.rt[key],O=env.rt.actionOwner;
  if(J&&stamp(J)!==String(id)||O&&(O.key!==key||O.stamp!==String(id))||!J&&!O&&ownerCommitKey!==key)return false;
  env.rt[key]=null;if(O)env.rt.actionOwner=null;
  if(!ownerCommitKey||ownerCommitKey===key){ownerNeedsCommit=false;ownerCommitKey=null;}
  return true;
 }
 function locationProxy(native,manualAllowed=()=>false){
  const view={},navigate=()=>!env.challengeHold?.()&&(canAct()||(!env.on&&manualAllowed()));
  for(const key of ['href','pathname','search','hash','origin','host','hostname','port','protocol'])Object.defineProperty(view,key,{get:()=>native[key],set:v=>{if(navigate())native[key]=v;}});
  for(const key of ['assign','replace','reload'])view[key]=(...args)=>{if(navigate())return native[key](...args);};
  view.toString=()=>String(native);return view;
 }

 return{dispatch,enterFrame,canAct,owns,context,locationProxy,releaseExpired,banned:key=>!!banned(key),hasPending:()=>!!env.paymentPending()};
 };
})(typeof globalThis!=='undefined'?globalThis:this);
