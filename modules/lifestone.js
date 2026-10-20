/* Авто-ЛС: точная цель из каталога игры, конечная серия, только материалы в сумке.
   После перезагрузки продолжение вручную; неизвестная попытка никогда не отправляется повторно. */
(function(root){'use strict';
 root.L2V7Factories=root.L2V7Factories||Object.create(null);
 root.L2V7Factories.lifestone=function(env){
  const A=root.L2Aug, path='/character/weapon-augmentation';
  let busy=false, trusted=null, permit=null;
  const now=()=>Date.now(), current=()=>env.rt.autoLs, char=()=>String(env.rt.char||'');
  const own=s=>!!s&&s.char===char()&&env.tabOwner===true;
  const live=()=>env.on===true&&env.tabOwner===true&&env.canRun();
  const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
  const fingerprint=w=>JSON.stringify(canonical(typeof w==='number'?{itemId:w,enchant:0}:w));
  const base=w=>{const x=typeof w==='number'?{itemId:w,enchant:0}:{...w};delete x.augmentation;return fingerprint(x);};
  // Выбор сохраняет экземпляр при переносе рюкзак ↔ слот, но не зависит от меняющегося ЛС.
  const weaponKey=w=>{const x=typeof w==='number'?{itemId:w,enchant:0}:{...w};delete x.augmentation;delete x.qty;x.enchant=+x.enchant||0;return fingerprint(x);};
  function weaponRows(s,h){
   const rows=[],add=(w,equipped)=>{
    const id=typeof w==='number'?w:+w?.itemId,grade=String(h?.itemGradeHints?.[id]||'').toUpperCase();
    if(!id||!A.LIFE_STONE[grade]||!equipped&&h?.itemSlotHints?.[id]!=='rhand')return;
    const n=typeof w==='number'?1:w.qty??1;if(!Number.isSafeInteger(n)||n<1)return;
    rows.push({key:weaponKey(w),itemId:id,grade,enchant:+w?.enchant||0,equipped,ambiguous:n!==1,
     name:h?.itemNamesRu?.[id]||h?.itemNamesUk?.[id]||h?.itemNamesEn?.[id]||'#'+id});
   };
   add(s.inventory.eq.l1,true);for(const w of s.inventory.stacks)add(w,false);
   for(const r of rows)if(rows.filter(x=>x.key===r.key).length>1)r.ambiguous=true;
   return rows;
  }
  async function scanWeapons(){
   const who=char(),context=stamp(),[s,h]=await Promise.all([snapshot(),get('/character/catalog-hints')]);
   if(!s||!h?.itemGradeHints||!h?.itemSlotHints)throw Error('Не удалось прочитать оружие и каталог; прежний список сохранён');
   if(char()!==who||stamp()!==context||!own({char:who}))throw Error('Герой или управление изменились — обновите оружие');
   const rows=weaponRows(s,h),r=await env.setRt({lsWeapons:{char:who,t:now(),items:rows}});
   if(r?.ok!==true)throw Error('Не удалось сохранить список оружия');
   env.rec?.('B','ЛС',`Оружие прочитано: ${rows.length} подходящих C/B/A/S вещей; вставка не запускалась`);return true;
  }
  const known=id=>typeof id==='string'&&Object.hasOwn(A.OUT,id);
  function config(){const c=env.cfg.autoLs||{},targets=Array.isArray(c.targets)?[...new Set(c.targets)]:[];
   return {weaponKey:typeof c.weaponKey==='string'?c.weaponKey:'',targets,maxAttempts:c.maxAttempts,delayMs:1500,valid:targets.length>0&&targets.every(known)&&Number.isSafeInteger(c.maxAttempts)&&c.maxAttempts>=1&&c.maxAttempts<=10000};}
  const sig=c=>JSON.stringify([c.targets,c.maxAttempts,c.weaponKey]);
  const stamp=()=>env.context();
  const allowed=s=>own(s)&&live()&&trusted===s.id&&s.status==='running'&&s.context===stamp()&&s.configSig===sig(config());
  async function save(s,eq){
   if(!own(s))return false;const before=current();let ok=false;
   const a=eq&&A.ofEq(eq),m=a&&A.info(a.o);
   try{ok=(await env.setRt({autoLs:s,...(a?{weaponAug:{...a,k:m?.k||'',n:m?.n||''}}:{})}))?.ok===true&&own(s);}catch(_){}
   if(!ok){trusted=null;permit=null;if(before?.pending&&own(before))try{await env.setRt({autoLs:{...before,status:'paused',reason:'Запись результата не подтверждена; требуется сверка'}});}catch(_){}}
   return ok;
  }
  const qty=(s,id)=>{const rows=s.inventory?.stacks;if(!Array.isArray(rows))return null;let total=0;for(const r of rows)if(+r.itemId===id){if(!Number.isSafeInteger(r.qty)||r.qty<0)return null;total+=r.qty;}return Number.isSafeInteger(total)?total:null;};
  async function get(p){try{const r=await env.gameGet(p);return r?.ok?await r.json():null;}catch(_){return null;}}
  async function snapshot(){const who=char(),j=await get('/character'),s=j?.character;
   return char()===who&&s?.name===who&&s.inventory?.eq&&Array.isArray(s.inventory.stacks)&&Number.isSafeInteger(s.revision)&&s.revision>=0?s:null;}
  async function pause(reason){trusted=null;permit=null;const s=current();if(!own(s))return false;await save({...s,status:'paused',reason});env.setStatus?.('ЛС: '+reason);return true;}
  async function finish(s,reason){trusted=null;permit=null;await save({...s,status:'done',reason});env.rec?.('B','ЛС',reason);return true;}
  async function prepare(){
   const old=current(),c=config(),who=char();
   if(old?.pending)throw Error('Сначала сверьте неизвестную попытку');
   if(!c.valid)throw Error('Выберите эффекты и лимит от 1 до 10 000 попыток');
   if(Object.hasOwn(env.cfg.autoLs||{},'weaponKey')&&!c.weaponKey)throw Error('Выберите оружие для ЛС');
   if(!env.canPrepare())throw Error('Откройте аугментацию, завершите бой и служебные задачи');
   const [s,h]=await Promise.all([snapshot(),get('/character/catalog-hints')]);
   if(!s||char()!==who||current()!==old||!env.canPrepare()||sig(config())!==sig(c))throw Error('Состояние героя изменилось или не прочитано');
   const w=s.inventory.eq.l1,id=typeof w==='number'?w:w?.itemId,grade=String(h?.itemGradeHints?.[id]||'').toUpperCase();
   if(!A.LIFE_STONE[grade])throw Error('Нужно надеть оружие C/B/A/S грейда');
   let chosen=null;
   if(c.weaponKey){
    const rows=weaponRows(s,h);chosen=rows.find(x=>x.key===c.weaponKey);
    if(!chosen)throw Error('Выбранное оружие не найдено — обновите список и выберите заново');
    if(chosen.ambiguous)throw Error('Несколько одинаковых экземпляров — выбранную вещь нельзя определить точно');
    if(!chosen.equipped||weaponKey(w)!==c.weaponKey)throw Error('Сначала наденьте выбранное оружие: '+chosen.name+' +'+chosen.enchant+'. ЛС в другую вещь не вставляется');
   }
   const outcome=w?.augmentation?.outcomeId;if(outcome&&!known(outcome))throw Error('На оружии неизвестный эффект — обновите каталог');
   trusted=null;permit=null;
   const row={id:`${now()}:${Math.random().toString(36).slice(2)}`,char:who,status:'paused',hold:true,reason:'Серия подготовлена; нажмите «Продолжить»',
    weaponKey:c.weaponKey,weaponName:chosen?.name||h?.itemNamesRu?.[id]||h?.itemNamesUk?.[id]||h?.itemNamesEn?.[id]||'#'+id,targets:c.targets,maxAttempts:c.maxAttempts,configSig:sig(c),attempts:0,grade,itemId:id,weapon:fingerprint(w),base:base(w),pending:null,history:[],nextAt:0};
   if(!await save(row,s.inventory.eq))throw Error('Не удалось сохранить серию; расход не выполнялся');return true;
  }
  async function command(action){if(action==='pause'&&busy){trusted=null;permit=null;return true;}if(busy)throw Error('Предыдущий шаг ЛС ещё выполняется');busy=true;
   try{
    if(action==='scan')return await scanWeapons();
    if(action==='prepare')return await prepare();
    const s=current();if(!own(s))throw Error('Нет серии этого персонажа');
    if(action==='pause')return await pause('Пауза игрока');
    if(action==='reconcile')return await reconcile();
    if(action==='acknowledge'){
     const p=s.pending;if(!p)throw Error('Нет неизвестной попытки');
     trusted=null;permit=null;const snap=await snapshot();
     if(!own(s)||current()?.pending?.id!==p.id||!snap||snap.revision<=p.revision||base(snap.inventory.eq.l1)!==s.base)throw Error('Нужна свежая ревизия героя и прежнее оружие. Сначала проверьте состояние в игре');
     const outcome=snap.inventory.eq.l1?.augmentation?.outcomeId;if(outcome&&!known(outcome))throw Error('На оружии неизвестный эффект');
     return await save({...s,pending:null,attempts:s.attempts+1,weapon:fingerprint(snap.inventory.eq.l1),status:'paused',reason:'Неизвестная попытка учтена в лимите; продолжение вручную',
      history:[{t:now(),attempt:s.attempts+1,status:'unknown',pending:p,checkedRevision:snap.revision},...s.history].slice(0,100)},snap.inventory.eq);
    }
    if(action==='close'){if(s.pending)throw Error('Результат попытки неизвестен — сначала сверить');trusted=null;return await save({...s,status:'closed',hold:false,reason:'Серия завершена игроком'});}
    if(action!=='resume')throw Error('Неизвестная команда ЛС');
    if(s.pending)throw Error('Сначала сверьте результат попытки');
    if(!live()||!env.canPrepare())throw Error('Запустите бота на странице аугментации, без других служебных задач');
    if(!config().valid||s.configSig!==sig(config()))throw Error('Цели или лимит изменились — подготовьте новую серию');
    if(s.attempts>=s.maxAttempts||s.status==='closed')throw Error('Серия завершена; подготовьте новую');
    const next={...s,status:'running',hold:true,reason:'',context:stamp()};
    if(!await save(next))throw Error('Не удалось сохранить запуск');trusted=s.id;return true;
   }finally{busy=false;}
  }
  // Одно разрешение только на конкретный долговечно записанный POST; чужие gamePost его не получают.
  function consumePermit(id,body){const s=current(),p=s?.pending;
   if(!p||permit!==p.id||id!==p.id||!allowed(s)||body?.operation!=='install'||body.expectedRevision!==p.revision)return false;
   permit=null;return true;
  }
  async function settle(s,snap,receipt){
   const p=s.pending,w=snap.inventory.eq.l1,a=w?.augmentation;
   if(base(w)!==s.base||snap.revision!==p.revision+1||!a||!known(a.outcomeId)||a.grade!==s.grade||typeof a.uid!=='string'||!a.uid||a.uid===p.uid||
    qty(snap,A.LIFE_STONE[s.grade])!==p.ls-1||qty(snap,A.GEMSTONE[s.grade])!==p.gem-1||receipt&&receipt!==a.outcomeId)return false;
   const attempts=s.attempts+1,matched=s.targets.includes(a.outcomeId),done=matched||attempts>=s.maxAttempts;
   const row={...s,attempts,weapon:fingerprint(w),pending:null,last:a.outcomeId,nextAt:now()+1500,
    history:[{t:now(),outcomeId:a.outcomeId,attempt:attempts},...s.history].slice(0,100),
    status:done?'done':allowed(s)?'running':'paused',reason:matched?'Получен выбранный эффект: '+A.OUT[a.outcomeId].n:done?'Достигнут лимит попыток':allowed(s)?'':'Состояние сверено; продолжение вручную'};
   if(!await save(row,snap.inventory.eq))return false;
   if(done)trusted=null;
   env.rec?.('B','ЛС',`${attempts}/${s.maxAttempts}: ${A.OUT[a.outcomeId].n}${done?' · '+row.reason:''}`);return true;
  }
  async function reconcile(){const s=current(),p=s?.pending;if(!own(s)||!p)return false;
   trusted=null;permit=null;
   const snap=await snapshot();if(!own(s)||current()?.pending?.id!==p.id)return false;
   if(snap&&await settle({...current(),status:'paused'},snap))return true;
   await save({...current(),status:'paused',reason:'Результат не подтверждён; повтор запрещён. Проверьте оружие и материалы в игре',pending:{...p,lastCheck:now()}});return false;
  }
  async function step(){if(busy)return true;const initial=current();if(!own(initial)||!initial.hold&&!initial.pending)return false;busy=true;
   try{
    let s=current();
    if(s.pending){if(now()-(s.pending.lastCheck||s.pending.t)<15000)return true;await reconcile();return true;}
    if(!allowed(s)){if(s.status==='running')await pause('Остановлено, страница или настройки изменились; продолжение вручную');env.setStatus?.('ЛС: '+(current()?.reason||'Ожидание команды'));return true;}
    if(now()<s.nextAt)return true;
    if(s.attempts>=s.maxAttempts)return await finish(s,'Достигнут лимит попыток');
    const snap=await snapshot();if(current()?.id!==s.id||!allowed(s))return true;
    if(!snap)return await pause('Не удалось прочитать актуальное оружие и материалы');
    const w=snap.inventory.eq.l1;
    if(fingerprint(w)!==s.weapon)return await pause('Оружие или его эффект изменились вне серии — выберите заново');
    const outcome=w?.augmentation?.outcomeId;
    if(outcome&&s.targets.includes(outcome))return await finish(s,'Нужный эффект уже на оружии: '+A.OUT[outcome].n);
    const ls=qty(snap,A.LIFE_STONE[s.grade]),gem=qty(snap,A.GEMSTONE[s.grade]);
    if(ls==null||gem==null)return await pause('Количество материалов не прочитано');
    if(ls<1||gem<1)return await finish(s,'Закончились Life Stone или Gemstone '+s.grade);
    const p={id:s.id+':'+s.attempts+':'+now(),t:now(),revision:snap.revision,ls,gem,uid:w?.augmentation?.uid||null};
    if(!await save({...s,pending:p})){trusted=null;return true;}
    // После любого сбоя сохранения pending остаётся блокировкой, даже если клик точно не отправлен.
    s=current();if(s?.pending?.id!==p.id||!allowed(s)){await pause('Остановлено до отправки; сначала сверить состояние');return true;}
    permit=p.id;
    let r,out;
    try{r=await env.gamePost(path,{expectedRevision:p.revision,operation:'install'},8000,p.id);out=await r.json();}
    catch(_){await pause('Связь прервана; результат попытки нужно сверить');return true;}
    if(!own(s)||current()?.pending?.id!==p.id)return true;
    if([400,401,403,404,409,412,422,423,429].includes(r.status)){
     await save({...current(),pending:null,status:'paused',reason:`Сервер отклонил попытку (${r.status}); продолжение вручную`});trusted=null;return true;}
    if(!r.ok||out?.error||out?.ok===false||out?.gemstonesSpent!==1||!known(out?.outcomeId))return await pause('Ответ игры не подтверждает попытку — нужна сверка');
    // Доверяем только свежему GET и точному расходу 1+1; ответ POST сам по себе не разрешает следующий расход.
    const after=await snapshot();if(!own(s)||current()?.pending?.id!==p.id)return true;
    if(!after||!await settle(current(),after,out.outcomeId))await pause('Результат и состояние оружия расходятся — повтор запрещён');
    return true;
   }finally{permit=null;busy=false;}
  }
  async function yieldToUrgent(){trusted=null;permit=null;const s=current();if(!own(s)||s.pending)return false;return save({...s,status:'paused',hold:false,reason:'ЛС прерван для TvT; продолжение вручную'});}
  return {command,step,reconcile,consumePermit,yieldToUrgent,interrupt:()=>{trusted=null;permit=null;},config};
 };
})(globalThis);
