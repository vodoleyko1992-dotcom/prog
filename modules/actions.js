/* 10.0.24: один владелец служебного маршрута. Перезагрузка не меняет владельца. */
(function(root){'use strict';
 root.L2V7Factories=root.L2V7Factories||Object.create(null);
 root.L2V7Factories.actions=function(env){
 let frame=null, executing=null, busy=false, reconciliation=null, ownerNeedsCommit=false;
 const context=()=>JSON.stringify([env.rt.char||'',env.mode(),+env.rt.manualKickAt||0,env.cfg.catDungeon||'',env.cfg.farmRes||'',env.cfg.recipeRes||'',env.cfg.autoTasks||null]);
 const live=()=>env.on&&env.tabOwner;
 const stamp=j=>String(j?.id||j?.t||j?.at||'legacy');
 const phase=j=>JSON.stringify([j?.phase||j?.step||'',j?.done?.length||0,j?.fa||[],j?.id||j?.target||'',j?.entry?.revision||0,j?.pending?.id||'',j?.page??j?.p??j?.cursor??'',typeof j==='object'?'':j]);
 function enterFrame(){frame={context:context(),lease:env.lease(),generation:env.actionGeneration?.()};}
 function canAct(){return live()&&!env.challengeHold?.()&&(!frame||frame.context===context()&&frame.lease===env.lease()&&frame.generation===env.actionGeneration?.())&&(!executing||executing.context===context()&&!env.interrupted());}
 function owns(key){return executing?.key===key&&canAct();}
 // 17.10, реворк: setRt меняет память до подтверждения записи. Следующий тик не должен принять её за durable-владельца.
 async function save(p){
  if(Object.hasOwn(p,'actionOwner'))ownerNeedsCommit=true;
  try{const r=await env.setRt(p);if(r?.ok===false||!await env.rtCommit()||!live()){env.setStatus?.('Служебный маршрут: жду сохранения состояния');return false;}if(Object.hasOwn(p,'actionOwner'))ownerNeedsCommit=false;return true;}
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
 const LOOP_WINDOW=3600000,LOOP_MAX=3;
 async function loopTrip(O,job,why){
  if(job.key==='rbHunt'){await env.halt(why,true);return;}
  const now=Date.now(),loops={...(env.rt.actionLoops||{})},list=(Array.isArray(loops[job.key])?loops[job.key]:[]).filter(t=>now-t<LOOP_WINDOW);
  list.push(now);loops[job.key]=list.slice(-LOOP_MAX);
  if(list.length>=LOOP_MAX){await env.halt(`${why}; ${list.length}-й раз за час`,true);return;}
  const patch={actionOwner:null,[job.key]:null,actionLoops:loops,actionLast:{key:job.key,reason:'цикл маршрута',at:now}};
  if(job.key==='tbuff'&&env.rt.tbuff)patch.tbInterrupted={t:now,jobT:env.rt.tbuff.t};
  if(job.key==='shop'){const n=Math.min(4,Math.floor(+env.rt.shopFail?.n||0)+1);patch.shopT=now;patch.shopFail={n,t:now,adena:env.rt.shopFail?.adena??null,keys:['цикл']};}
  if(await save(patch))env.rec('B','действия',`${why}; маршрут ${job.key} снят (${list.length}/${LOOP_MAX} за час), остальные задачи продолжаются`);
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
 function locationProxy(native,manualAllowed=()=>false){
  const view={},navigate=()=>!env.challengeHold?.()&&(canAct()||(!env.on&&manualAllowed()));
  for(const key of ['href','pathname','search','hash','origin','host','hostname','port','protocol'])Object.defineProperty(view,key,{get:()=>native[key],set:v=>{if(navigate())native[key]=v;}});
  for(const key of ['assign','replace','reload'])view[key]=(...args)=>{if(navigate())return native[key](...args);};
  view.toString=()=>String(native);return view;
 }

 return{dispatch,enterFrame,canAct,owns,context,locationProxy,hasPending:()=>!!env.paymentPending()};
 };
})(typeof globalThis!=='undefined'?globalThis:this);
