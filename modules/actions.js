/* 10.0.24: один владелец служебного маршрута. Перезагрузка не меняет владельца. */
(function(root){'use strict';
 root.L2V7Factories=root.L2V7Factories||Object.create(null);
 root.L2V7Factories.actions=function(env){
 let frame=null, executing=null, busy=false, reconciliation=null;
 const context=()=>JSON.stringify([env.rt.char||'',env.mode(),+env.rt.manualKickAt||0,env.cfg.catDungeon||'',env.cfg.farmRes||'',env.cfg.recipeRes||'',env.cfg.autoTasks||null]);
 const live=()=>env.on&&env.tabOwner;
 const stamp=j=>String(j?.id||j?.t||j?.at||'legacy');
 const phase=j=>JSON.stringify([j?.phase||j?.step||'',j?.done?.length||0,j?.fa||[],j?.id||j?.target||'',j?.entry?.revision||0,j?.pending?.id||'',j?.page??j?.p??j?.cursor??'',typeof j==='object'?'':j]);
 function enterFrame(){frame={context:context(),lease:env.lease()};}
 function canAct(){return live()&&(!frame||frame.context===context()&&frame.lease===env.lease())&&(!executing||executing.context===context()&&!env.interrupted());}
 function owns(key){return executing?.key===key&&canAct();}
 async function save(p){const r=await env.setRt(p);return r?.ok!==false&&await env.rtCommit()&&live();}
 async function clear(O,why){
  const jobs=env.jobs(),patch={actionOwner:null};
  // Ручная смена режима отменяет старые маршруты, но никогда не удаляет квитанции платежей.
  if(why)for(const j of jobs){const value=env.rt[j.key];if(value&&(+value.t||+value.at||0)<=(+env.rt.manualKickAt||Date.now()))patch[j.key]=null;}
  if(why&&env.rt[O.key]&&stamp(env.rt[O.key])===O.stamp)patch[O.key]=null;
  if(why)patch.actionLast={key:O.key,reason:why,at:Date.now()};
  if(await save(patch))env.rec('B','действия',why?`${O.key}: ${why}; старый маршрут отменён`:`${O.key}: маршрут завершён`);
 }
 async function dispatch(){
  if(busy)return true;
  if(!live())return false;
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
    return true;
   }
   reconciliation=null;
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
   if(!O){O={id:env.id(),key:job.key,context:context(),stamp:stamp(value),at:now,phase:p,progressAt:now,page,visits:1,seen:{[JSON.stringify([page,p])]:1}};if(!await save({actionOwner:O})||!canAct())return true;env.rec('B','действия',`${job.key}: владелец маршрута (${env.mode()})`);}
   else{
    const changed=p!==O.phase;
    const node=JSON.stringify([page,p]),seen={...(O.seen||{})};
    if(changed||page!==O.page)seen[node]=(seen[node]||0)+1;
    const next={...O,phase:p,progressAt:changed?now:O.progressAt,page,visits:changed?1:(O.visits||1)+(page!==O.page?1:0),seen:Object.fromEntries(Object.entries(seen).slice(-64))};
    if(seen[node]>5){await env.halt(`Маршрут ${job.key}: повторяется цикл страниц и этапов; остановлено после 5 возвратов`,true);return true;}
    // Время ожидания TvT/сервера не ограничиваем. Ловим именно переходы без изменения этапа.
    if(next.visits>10){await env.halt(`Маршрут ${job.key}: более 10 переходов без продвижения этапа ${value.phase||value.step||''}`,true);return true;}
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
  const view={},navigate=()=>canAct()||(!env.on&&manualAllowed());
  for(const key of ['href','pathname','search','hash','origin','host','hostname','port','protocol'])Object.defineProperty(view,key,{get:()=>native[key],set:v=>{if(navigate())native[key]=v;}});
  for(const key of ['assign','replace','reload'])view[key]=(...args)=>{if(navigate())return native[key](...args);};
  view.toString=()=>String(native);return view;
 }

 return{dispatch,enterFrame,canAct,owns,context,locationProxy,hasPending:()=>!!env.paymentPending()};
 };
})(typeof globalThis!=='undefined'?globalThis:this);
