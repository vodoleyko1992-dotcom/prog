/* Авто-ЛС: точная цель из каталога игры, конечная серия, ограниченная докупка материалов.
   После перезагрузки продолжение вручную; неизвестная попытка никогда не отправляется повторно. */
(function(root){'use strict';
 root.L2V7Factories=root.L2V7Factories||Object.create(null);
 root.L2V7Factories.lifestone=function(env){
  const A=root.L2Aug, path='/character/weapon-augmentation';
  let busy=false, trusted=null, permit=null, supplyPermit=null, userPause=false;
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
  // 20.33 (лог20.10 04:24): свои GET не видны hook; только безопасная причина, без тела ответа/имени/токена.
  const scanNote=message=>{try{env.rec?.('B','ЛС',message);}catch(_){}};
  const scanReason=(part,why)=>`Не удалось прочитать ${part}: ${why}; прежний список сохранён`;
  async function scanRead(url,part){
   let timer;
   const read=async()=>{
    let response,data;
    try{response=await env.gameGet(url);}
    catch(e){return {error:scanReason(part,/AbortError|TimeoutError/.test(e?.name||'')||/timeout|timed out|aborted/i.test(e?.message||'')?'таймаут запроса':'ошибка соединения')};}
    if(!response?.ok)return {error:scanReason(part,Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?'HTTP '+response.status:'ответ не получен')};
    try{data=await response.json();}catch(_){return {error:scanReason(part,'некорректный JSON')};}
    return data&&typeof data==='object'&&!Array.isArray(data)?{data}:{error:scanReason(part,'JSON не содержит объект ответа')};
   };
   // fetch может вернуть заголовки, но тело JSON ещё не закончиться; список не блокирует кнопку навсегда.
   try{return await Promise.race([read(),new Promise(resolve=>{if(typeof setTimeout==='function')timer=setTimeout(()=>resolve({error:scanReason(part,'таймаут запроса или чтения JSON')}),8000);})]);}
   finally{if(timer!==undefined)clearTimeout(timer);}
  }
  async function scanWeapons(){
   let reason='Не удалось обновить список оружия; прежний список сохранён';
   scanNote('Обновляю список оружия из инвентаря и каталога; вставка не запускалась');
   try{
    const who=char(),context=stamp(),[character,catalog]=await Promise.all([scanRead('/character','инвентарь героя'),scanRead('/character/catalog-hints','каталог оружия')]);
    if(character.error||catalog.error){reason=character.error||catalog.error;throw Error(reason);}
    const s=character.data.character,h=catalog.data;
    if(!s||typeof s!=='object'){reason=scanReason('инвентарь героя','нет character');throw Error(reason);}
    if(typeof s.name!=='string'||!s.name){reason=scanReason('инвентарь героя','нет имени героя');throw Error(reason);}
    if(s.name!==who){reason=scanReason('инвентарь героя','имя героя не совпадает');throw Error(reason);}
    if(!Number.isSafeInteger(s.revision)||s.revision<0){reason=scanReason('инвентарь героя','нет корректной revision');throw Error(reason);}
    if(!s.inventory?.eq||typeof s.inventory.eq!=='object'||Array.isArray(s.inventory.eq)||!Array.isArray(s.inventory.stacks)){reason=scanReason('инвентарь героя','нет inventory.eq или inventory.stacks');throw Error(reason);}
    if(!h.itemGradeHints||typeof h.itemGradeHints!=='object'||Array.isArray(h.itemGradeHints)||!h.itemSlotHints||typeof h.itemSlotHints!=='object'||Array.isArray(h.itemSlotHints)){reason=scanReason('каталог оружия','нет itemGradeHints или itemSlotHints');throw Error(reason);}
    if(char()!==who||stamp()!==context||!own({char:who})){reason='Герой или управление изменились — обновите оружие';throw Error(reason);}
    const rows=weaponRows(s,h);reason='Не удалось сохранить список оружия';
    const r=await env.setRt({lsWeapons:{char:who,t:now(),items:rows}});
    if(r?.ok!==true)throw Error(reason);
    scanNote(`Оружие прочитано: ${rows.length} подходящих C/B/A/S вещей; вставка не запускалась`);return true;
   }catch(_){scanNote('Обновление оружия не выполнено: '+reason);throw Error(reason);}
  }
  const known=id=>typeof id==='string'&&Object.hasOwn(A.OUT,id);
  const money=v=>{const n=typeof v==='string'&&/^\d+$/.test(v)?+v:v;return Number.isSafeInteger(n)&&n>=0?n:null;};
  function config(){const c=env.cfg.autoLs||{},targets=Array.isArray(c.targets)?[...new Set(c.targets)]:[];
   return {weaponKey:typeof c.weaponKey==='string'?c.weaponKey:'',targets,maxAttempts:c.maxAttempts,delayMs:1500,
    buyMaterials:c.buyMaterials===undefined||c.buyMaterials===true,aaBudget:money(c.aaBudget??2000000),adenaBudget:money(c.adenaBudget??2000000),aaReserve:money(c.aaReserve??0),adenaReserve:money(env.cfg.shopReserve??200000),tpMax:money(env.cfg.mmTpMax??500000),
    valid:targets.length>0&&targets.every(known)&&Number.isSafeInteger(c.maxAttempts)&&c.maxAttempts>=1&&c.maxAttempts<=10000};}
  const sig=c=>JSON.stringify([c.targets,c.maxAttempts,c.weaponKey]);
  const stamp=()=>env.context();
  const allowed=s=>own(s)&&live()&&trusted===s.id&&s.status==='running'&&s.context===stamp()&&s.configSig===sig(config());
  async function save(s,eq){
   if(!own(s))return false;const before=current();let ok=false;
   // 20.43 (автономность, доводка 21.10, ревью): «Пауза» игрока, нажатая во время шага (POST попытки/закупки или снимок после него), только
   // сбрасывала trusted — пауза этого шага приходила из settle/settleSupply/отказа сервера («Состояние сверено; продолжение вручную»)
   // без userHold, и следующий шаг снимал удержание как паузу сбоя: бот уходил с аугментации, «Продолжить» становилось недоступно.
   // Теперь любая пауза с удержанием, записанная, пока действует «Пауза» игрока (userPause), — пауза игрока
   if(userPause&&s.status==='paused'&&s.hold===true&&s.userHold!==true)s={...s,userHold:true};
   const a=eq&&A.ofEq(eq),m=a&&A.info(a.o);
   try{ok=(await env.setRt({autoLs:s,...(a?{weaponAug:{...a,k:m?.k||'',n:m?.n||''}}:{})}))?.ok===true&&own(s);}catch(_){}
   if(!ok){trusted=null;permit=null;if(before?.pending&&own(before))try{await env.setRt({autoLs:{...before,status:'paused',reason:'Запись результата не подтверждена; требуется сверка'}});}catch(_){}}
   return ok;
  }
  const qty=(s,id)=>{const rows=s.inventory?.stacks;if(!Array.isArray(rows))return null;let total=0;for(const r of rows)if(+r.itemId===id){if(!Number.isSafeInteger(r.qty)||r.qty<0)return null;total+=r.qty;}return Number.isSafeInteger(total)?total:null;};
  async function get(p){try{const r=await env.gameGet(p);return r?.ok?await r.json():null;}catch(_){return null;}}
  async function snapshot(){const who=char(),j=await get('/character'),s=j?.character;
   return char()===who&&s?.name===who&&s.inventory?.eq&&Array.isArray(s.inventory.stacks)&&Number.isSafeInteger(s.revision)&&s.revision>=0?s:null;}
  // 20.43 (автономность, доводка 21.10): пауза серии сама (не прочитались цены материалов, неверные лимиты закупки, перезагрузка посреди
  // серии…) оставляла hold:true, а продолжить серию может только игрок: allowed() требует running и trusted, trusted сбрасывается и
  // перезагрузкой. loopGate держал главный цикл без срока — ни задач, ни сторожа, ни отметки остановки с уведомлением, только статус «ЛС: …».
  // Теперь такая пауза без неизвестной попытки/покупки (pending) снимает удержание, как finish/refusedSupply/yieldToUrgent: бот возвращается
  // к задачам, серия ждёт ручного «Продолжить». Держат по-прежнему: неизвестный исход (pending), ручная пауза игрока и подготовленная серия.
  // userHold — удержание выбрал игрок («Пауза»); подготовленная серия ждёт «Продолжить» (PREPARED) — тоже держит
  const PREPARED='Серия подготовлена; нажмите «Продолжить»';
  // userPause — «Пауза» нажата, пока шёл шаг (и «Сверить» игрока): пауза этого шага — игрока, а не сбоя; объявлена в начале фабрики (save)
  const freeNote=reason=>env.rec?.('B','ЛС',`${reason||'Серия на паузе'} — серия на паузе, возвращаюсь к задачам; продолжение вручную`);
  async function pause(reason,keep=false){trusted=null;permit=null;supplyPermit=null;const s=current();if(!own(s))return false;
   const user=keep||userPause,free=!user&&!s.pending&&s.hold===true;
   const ok=await save({...s,status:'paused',reason,...(user?{userHold:true}:{}),...(free?{hold:false}:{})});env.setStatus?.('ЛС: '+reason);if(ok&&free)freeNote(reason);return true;}
  // 20.43 (разбор 21.10): серия с целью/лимитом больше ничего не тратит — удержание снимаем, бот сам возвращается к рыбалке/фарму
  // (раньше стоял на аугментации до «Закончить серию»). Новая трата — только «Начать новую серию»; неизвестная попытка держит, как прежде.
  const DONE_NOTE='Серия завершена — возвращаюсь к задачам';
  async function finish(s,reason){trusted=null;permit=null;supplyPermit=null;const free=!s.pending&&!current()?.pending,ok=await save({...s,status:'done',reason,...(free?{hold:false}:{})});env.rec?.('B','ЛС',reason);if(ok&&free)env.rec?.('B','ЛС',DONE_NOTE);return true;}
  // 20.35: закупка на остаток серии; при нехватке AA предел уменьшается до доступного числа попыток.
  const policy=c=>JSON.stringify([c.buyMaterials,c.aaBudget,c.adenaBudget,c.aaReserve,c.adenaReserve,c.tpMax]);
  const policyValid=c=>[c.aaBudget,c.adenaBudget,c.aaReserve,c.adenaReserve,c.tpMax].every(x=>x!==null);
  const supplyActive=(s,p)=>current()?.id===s.id&&['attempts','maxAttempts','weapon','configSig','context'].every(k=>current()[k]===s[k])&&allowed(current())&&config().buyMaterials&&policyValid(config())&&policy(config())===p;
  const ledger=s=>{const r={spentAA:money(s.spentAA??0),spentAdena:money(s.spentAdena??0),reservedAA:money(s.reservedAA??0),reservedAdena:money(s.reservedAdena??0)};return Object.values(r).some(x=>x===null)?null:r;};
  const position=x=>x&&x.worldX!=null&&x.worldY!=null&&String(x.worldX).trim()&&String(x.worldY).trim()&&Number.isFinite(+x.worldX)&&Number.isFinite(+x.worldY)?{x:+x.worldX,y:+x.worldY}:null;
  const merchantTarget=j=>{const n=j?.mammonMerchant?.current,p=position(n);return p&&typeof n.id==='string'&&n.id?{...p,id:n.id}:null;};
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const at=(p,t)=>!!p&&!!t&&p.x===t.x&&p.y===t.y;
  // Сохранённое намерение недоверенное: импорт/сбой записи не должны создавать отрицательный расход.
  function validSupply(s,p){
   if(!p||p.kind!=='supply'||!A.LIFE_STONE[s.grade]||!Number.isSafeInteger(s.maxAttempts)||s.maxAttempts<1||s.maxAttempts>10000||!Number.isSafeInteger(s.attempts)||s.attempts<0||s.attempts>=s.maxAttempts||typeof p.id!=='string'||!p.id||typeof p.policy!=='string'||!Number.isSafeInteger(p.revision)||p.revision<0
    ||![p.amount,p.ls,p.gem,p.aa,p.adena,p.col,p.fa].every(x=>Number.isSafeInteger(x)&&x>=0)||!['aa','adena'].includes(p.currency)||p.amount>p[p.currency])return false;
   let body;
   if(p.action==='travel'){
    if(p.material!=='teleport'||p.currency!=='adena'||p.qty!==0||p.itemId!=null||!point(p.origin)||!point(p.target)||typeof p.target.id!=='string'||!p.target.id||p.path!=='/game/mammon/teleport')return false;
    body={kind:'merchant',expectedAdenaCost:p.amount,expectedRevision:p.revision};
   }else if(p.action==='buy'&&Number.isSafeInteger(p.qty)&&p.qty>=1&&p.qty<=9999&&Number.isSafeInteger(p.unitPrice)&&p.unitPrice>=0&&Number.isSafeInteger(p.unitPrice*p.qty)&&p.amount===p.unitPrice*p.qty){
    const stock=p.material==='ls'?p.ls:p.gem;if(p.qty!==Math.min(9999,s.maxAttempts-s.attempts-stock))return false;
    if(p.material==='ls'&&p.currency==='aa'&&p.itemId===A.LIFE_STONE[s.grade]&&p.path==='/game/mammon/merchant/buy')body={category:'life_stones',itemKey:s.grade.toLowerCase(),qty:p.qty,expectedRevision:p.revision};
    else if(p.material==='gem'&&p.currency==='adena'&&p.itemId===A.GEMSTONE[s.grade]&&p.path==='/game/drops-shop/buy')body={shopKey:'consumable/resource_gemstone_'+s.grade.toLowerCase(),qty:p.qty,expectedRevision:p.revision};
    else return false;
   }
   else return false;
   return fingerprint(p.body)===fingerprint(body);
  }
  async function supplyGet(url){let timer;const request=(async()=>{try{const r=await env.gameGet(url);if(!r?.ok)return null;const j=await r.json();return j&&typeof j==='object'&&!Array.isArray(j)?j:null;}catch(_){return null;}})();
   try{return await Promise.race([request,new Promise(resolve=>{if(typeof setTimeout==='function')timer=setTimeout(()=>resolve(null),8000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
  async function supplySnapshot(){const who=char(),j=await supplyGet('/character'),s=j?.character;return char()===who&&s?.name===who&&s.inventory?.eq&&Array.isArray(s.inventory.stacks)&&Number.isSafeInteger(s.revision)&&s.revision>=0?s:null;}
  // Firefox может повторить оборванный POST сам: видимый 409 не исключает успешный первый запрос.
  async function supplyPost(p){let timer;const request=(async()=>{const response=await env.gamePost(p.path,p.body,8000,p.id);return {response,result:[400,401,403,404,412,422,423,429].includes(response.status)?null:await response.json()};})();
   try{return await Promise.race([request,new Promise((_,reject)=>{if(typeof setTimeout==='function')timer=setTimeout(()=>reject(Error('supply_timeout')),8000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
  function quotes(grade,lsShop,gmShop){
   const lower=grade.toLowerCase(),out={};
   if(lsShop){const rows=(Array.isArray(lsShop.categories)?lsShop.categories:[]).filter(c=>c?.categoryId==='life_stones').flatMap(c=>Array.isArray(c.items)?c.items:[]).filter(r=>r?.categoryId==='life_stones'&&r.itemKey===lower&&+r.itemId===A.LIFE_STONE[grade]);
    if(rows.length!==1||money(rows[0].aaPrice)===null||rows[0].priceCoinOfLuck!=null&&money(rows[0].priceCoinOfLuck)!==0||rows[0].priceFastAden!=null&&money(rows[0].priceFastAden)!==0)return null;
    out.ls={action:'buy',material:'ls',itemId:A.LIFE_STONE[grade],name:'Life Stone '+grade,qty:1,currency:'aa',amount:money(rows[0].aaPrice),path:'/game/mammon/merchant/buy',body:{category:'life_stones',itemKey:lower,qty:1}};
   }
   if(gmShop){const rows=(Array.isArray(gmShop.grades)?gmShop.grades:[]).filter(g=>g?.grade===grade).flatMap(g=>Array.isArray(g.sections)?g.sections:[]).filter(c=>c?.category==='consumable').flatMap(c=>Array.isArray(c.items)?c.items:[])
     .filter(r=>r?.shopKey==='consumable/resource_gemstone_'+lower&&r.category==='consumable'&&r.grade===grade&&r.consumableSubtype==='resources'&&+r.itemId===A.GEMSTONE[grade]&&r.purchasable===true);
    if(rows.length!==1||money(rows[0].priceAdena)===null||rows[0].priceCoinOfLuck!=null&&money(rows[0].priceCoinOfLuck)!==0||rows[0].priceFastAden!=null&&money(rows[0].priceFastAden)!==0||rows[0].minPurchaseQty!=null&&rows[0].minPurchaseQty!==1)return null;
    out.gem={action:'buy',material:'gem',itemId:A.GEMSTONE[grade],name:'Gemstone '+grade,qty:1,currency:'adena',amount:money(rows[0].priceAdena),path:'/game/drops-shop/buy',body:{shopKey:rows[0].shopKey,qty:1}};
   }
   return out;
  }
  async function settleSupply(s,snap,merchant){
   const p=s.pending,L=ledger(s),ls=qty(snap,A.LIFE_STONE[s.grade]),gem=qty(snap,A.GEMSTONE[s.grade]),aa=qty(snap,5575),adena=money(snap.adena),col=qty(snap,4037),fa=qty(snap,920048);
   if(!validSupply(s,p)||!L||snap.revision!==p.revision+1||fingerprint(snap.inventory.eq.l1)!==s.weapon||adena===null||ls!==p.ls+(p.material==='ls'?p.qty:0)||gem!==p.gem+(p.material==='gem'?p.qty:0)
    ||aa!==p.aa-(p.currency==='aa'?p.amount:0)||adena!==p.adena-(p.currency==='adena'?p.amount:0)||col!==p.col||fa!==p.fa)return false;
   const fresh=p.action==='travel'?merchantTarget(merchant):null,pos=p.action==='travel'?position(snap):null,target=p.action==='travel'?(at(pos,p.target)?p.target:at(pos,fresh)?fresh:null):null;
   if(p.action==='travel'&&!target)return false;
   const key=p.currency==='aa'?'AA':'Adena';if(L['reserved'+key]<p.amount||!Number.isSafeInteger(L['spent'+key]+p.amount))return false;
   const running=allowed(s)&&p.policy===policy(config());
   const next={...s,...L,['reserved'+key]:L['reserved'+key]-p.amount,['spent'+key]:L['spent'+key]+p.amount,pending:null,status:running?'running':'paused',reason:running?'':'Покупка сверена; продолжение вручную',
    supplies:[{t:now(),id:p.id,action:p.action,itemId:p.itemId||0,name:p.name,qty:p.qty||0,currency:p.currency,amount:p.amount,revision:snap.revision,...(target?{target,targetSource:target===p.target?'quoted':'current'}:{}),status:'confirmed'},...(s.supplies||[])].slice(0,40)};
   if(!await save(next,snap.inventory.eq))return false;
   if(!running){trusted=null;permit=null;supplyPermit=null;}
   env.rec?.('B','ЛС',`${p.action==='travel'?'Прибытие к Маммону подтверждено':p.name+' +'+p.qty+' подтверждено'}: ${p.amount} ${p.currency==='aa'?'AA':'адены'}; попытки ${s.attempts}/${s.maxAttempts}`);return true;
  }
  // Оружие, материалы, AA/адена, CoL/FA и место (для телепорта) точно такие же, как до POST.
  const untouched=(s,snap)=>{const p=s.pending;return fingerprint(snap.inventory.eq.l1)===s.weapon&&qty(snap,A.LIFE_STONE[s.grade])===p.ls&&qty(snap,A.GEMSTONE[s.grade])===p.gem
   &&qty(snap,5575)===p.aa&&money(snap.adena)===p.adena&&qty(snap,4037)===p.col&&qty(snap,920048)===p.fa&&!(p.action==='travel'&&!at(position(snap),p.origin));};
  async function recoverSupply(s,snap){
   const p=s.pending,L=ledger(s);
   // Новая revision делает старый POST неприменимым; неизменные остатки доказывают отсутствие покупки.
   if(!validSupply(s,p)||!L||snap.revision<=p.revision||!untouched(s,snap))return false;
   const key=p.currency==='aa'?'AA':'Adena';if(L['reserved'+key]<p.amount)return false;
   trusted=null;permit=null;supplyPermit=null;
   return save({...s,...L,['reserved'+key]:L['reserved'+key]-p.amount,pending:null,status:'paused',reason:'Новая ревизия подтверждает отсутствие закупки; продолжение вручную',
    supplies:[{t:now(),id:p.id,action:p.action,itemId:p.itemId||0,name:p.name,qty:0,currency:p.currency,amount:0,revision:snap.revision,status:'not_applied'},...(s.supplies||[])].slice(0,40)});
  }
  // 20.43 (разбор 21.10): Gemstone идёт через тот же /game/drops-shop/buy, где 20.10 22:03 пришёл HTTP 500 {"message":"inventory_full"}.
  // Свой список 4xx его не знал: pending висел «неизвестным», сверка ждала новую ревизию (а при отказе она прежняя), «Закрыть»/«Учесть»
  // запрещены, и главный цикл крутил только шаг ЛС — ни задач, ни TvT, пока игрок сам что-то не сделает. Теперь точный код отказа
  // (L2PayOutcome.BIZ_REJECT, как у магазина в 20.41) + свежий GET с той же ревизией и неизменными остатками = покупки не было:
  // резерв снят, серия на ручной паузе, удержание снято (бот возвращается к задачам). Обычный 5xx, 409 и обрыв связи — по-прежнему неизвестно.
  const bizCode=c=>typeof c==='string'&&root.L2PayOutcome?.BIZ_REJECT?.test?.(c)===true?c:'';
  const refusal=(status,res)=>Number.isInteger(status)&&status>=500&&status<=599&&res&&typeof res==='object'&&!Array.isArray(res)?bizCode(res.message):'';
  const refusalWhy=c=>/inventory|space|slot/.test(c)?'сумка полна — освободите место в сумке':/ancient|_aa$/.test(c)?'не хватает AA':/aden/.test(c)?'не хватает адены':'отказ игры';
  async function refusedSupply(s,snap){
   const p=s.pending,L=ledger(s),code=bizCode(p?.refused);
   if(!code||!validSupply(s,p)||!L||snap.revision!==p.revision||!untouched(s,snap))return false;
   const key=p.currency==='aa'?'AA':'Adena';if(L['reserved'+key]<p.amount)return false;
   trusted=null;permit=null;supplyPermit=null;
   const why=refusalWhy(code),reason=`Игра отказала в закупке: ${why}. Покупки не было, резерв снят; серия на паузе, продолжение вручную`;
   // 20.43 (доводка 21.10, ревью): «Пауза»/«Сверить» игрока во время этой закупки — удержание остаётся (пауза игрока), иначе — снимаем
   const user=userPause||s.userHold===true;
   if(!await save({...s,...L,['reserved'+key]:L['reserved'+key]-p.amount,pending:null,status:'paused',hold:user,...(user?{userHold:true}:{}),reason,
    supplies:[{t:now(),id:p.id,action:p.action,itemId:p.itemId||0,name:p.name,qty:0,currency:p.currency,amount:0,revision:snap.revision,code,status:'rejected'},...(s.supplies||[])].slice(0,40)}))return false;
   env.rec?.('B','ЛС',`${p.action==='travel'?'Телепорт к Маммону':p.name+' ×'+p.qty}: ${why} (${code}); ревизия ${snap.revision} и остатки прежние — покупки не было. ${user?'Серия на паузе игрока; продолжение вручную':'Серия на паузе, возвращаюсь к задачам'}`);
   env.setStatus?.('ЛС: '+reason);return true;
  }
  function consumeSupplyPermit(id,path,body){const s=current(),p=s?.pending,c=config();
   if(!validSupply(s,p)||supplyPermit!==p.id||id!==p.id||!supplyActive(s,p.policy)||p.path!==path||fingerprint(body)!==fingerprint(p.body)||!policyValid(c))return false;
   supplyPermit=null;return true;
  }
  async function supply(s,initial){
   const c=config(),P=policy(c);if(!c.buyMaterials)return finish(s,'Закончились Life Stone или Gemstone '+s.grade+'; автодокупка выключена');
   if(!policyValid(c))return pause('Неверные лимиты или резервы закупки ЛС');
   const remaining=s.maxAttempts-s.attempts,missingLS=qty(initial,A.LIFE_STONE[s.grade])<remaining,missingGem=qty(initial,A.GEMSTONE[s.grade])<remaining;
   const [lsShop,gmShop,merchant]=await Promise.all([missingLS?supplyGet('/game/mammon/merchant/shop'):null,missingGem?supplyGet('/game/drops-shop'):null,missingLS?supplyGet('/game/mammon/merchant'):null]);
   if(!supplyActive(s,P)||current()?.pending)return true;
   if(missingLS&&(!lsShop||!merchant)||missingGem&&!gmShop)return pause('Не удалось прочитать свежие цены материалов ЛС');
   const Q=quotes(s.grade,lsShop,gmShop);if(!Q)return pause('Нет однозначной обычной цены нужного грейда; CoL и тестовые магазины запрещены');
   const snap=await supplySnapshot();if(!supplyActive(s,P)||current()?.pending)return true;
   if(!snap||fingerprint(snap.inventory.eq.l1)!==s.weapon)return pause('Оружие или герой изменились перед покупкой');
   if(s.attempts>=s.maxAttempts)return finish(s,'Достигнут лимит попыток');
   if(snap.inventory.eq.l1?.augmentation?.outcomeId&&s.targets.includes(snap.inventory.eq.l1.augmentation.outcomeId))return finish(s,'Нужный эффект уже на оружии');
   const ls=qty(snap,A.LIFE_STONE[s.grade]),gem=qty(snap,A.GEMSTONE[s.grade]),aa=qty(snap,5575),adena=money(snap.adena),col=qty(snap,4037),fa=qty(snap,920048),L=ledger(current());
   if([ls,gem,aa,adena,col,fa].some(x=>x===null)||!L||L.reservedAA||L.reservedAdena)return pause('Не прочитаны остатки, баланс или прежний резерв закупки');
   if(ls>=remaining&&gem>=remaining)return true;
   if(ls<remaining&&!Q.ls||gem<remaining&&!Q.gem)return pause('Материалы изменились во время чтения цен — повторите запуск');
   if(ls<remaining&&Q.ls.amount>0){
    const available=Math.max(0,Math.min(aa-c.aaReserve,c.aaBudget-L.spentAA)),extra=Math.floor(available/Q.ls.amount),possible=Math.min(remaining,ls+Math.min(remaining,extra));
    if(possible<1)return pause('AA не хватает ни на одну оставшуюся попытку с учётом резерва и лимита');
    if(possible<remaining){
     const maxAttempts=s.attempts+possible,next={...current(),maxAttempts,configSig:sig({...c,maxAttempts}),reason:`Лимит снижен по доступным AA: ${s.maxAttempts} → ${maxAttempts}`};
     if(!supplyActive(s,P)||current()?.pending)return true;
     let reduced=false;try{reduced=(await env.reduceAttempts?.(next))?.ok===true;}catch(_){}
     if(!reduced)return pause('Не удалось сохранить уменьшенный лимит попыток; закупка не выполнялась');
     if(current()?.id!==s.id||current()?.maxAttempts!==maxAttempts||config().maxAttempts!==maxAttempts||!allowed(current()))return pause('Лимит изменён, но управление остановлено; продолжение вручную');
     env.rec?.('B','ЛС',next.reason);return true;
    }
   }
   const batch=(q,n)=>{const qty=Math.min(9999,n);return {...q,qty,unitPrice:q.amount,amount:q.amount*qty,totalAmount:q.amount*n,body:{...q.body,qty}};};
   const plan=[];
   if(ls<remaining){const target=merchantTarget(merchant),pos=position(snap),cost=money(merchant?.teleport?.adenaCost);
    if(!target||!pos||cost===null)return pause('Не подтверждены положение Маммона или цена телепорта');
    if(Math.hypot(pos.x-target.x,pos.y-target.y)>10800){
     if(cost>c.tpMax)return pause('Телепорт к Маммону дороже разрешённого лимита');
     plan.push({action:'travel',material:'teleport',name:'Телепорт к Торговцу Маммона',qty:0,currency:'adena',amount:cost,path:'/game/mammon/teleport',body:{kind:'merchant',expectedAdenaCost:cost},target,origin:pos});
    }
    plan.push(batch(Q.ls,remaining-ls));
   }
   if(gem<remaining)plan.push(batch(Q.gem,remaining-gem));
   const costAA=plan.filter(x=>x.currency==='aa').reduce((n,x)=>n+(x.totalAmount??x.amount),0),costAdena=plan.filter(x=>x.currency==='adena').reduce((n,x)=>n+(x.totalAmount??x.amount),0);
   if(!Number.isSafeInteger(costAA)||!Number.isSafeInteger(costAdena)||!Number.isSafeInteger(L.spentAA+costAA)||!Number.isSafeInteger(L.spentAdena+costAdena))return pause('Сумма закупки не подтверждена');
   if(costAA>0&&L.spentAA+costAA>c.aaBudget||costAdena>0&&L.spentAdena+costAdena>c.adenaBudget)return pause('Лимит AA или адены для закупки серии исчерпан');
   if(costAA>0&&aa-costAA<c.aaReserve||costAdena>0&&adena-costAdena<c.adenaReserve)return pause('Недостаточно AA или адены с учётом резерва');
   const item=plan[0],key=item.currency==='aa'?'AA':'Adena',p={...item,kind:'supply',id:s.id+':supply:'+now()+':'+Math.random().toString(36).slice(2),t:now(),revision:snap.revision,ls,gem,aa,adena,col,fa,policy:P,body:{...item.body,expectedRevision:snap.revision}};
   if(!supplyActive(s,P)||current()?.pending)return true;
   if(!await save({...current(),...L,pending:p,['reserved'+key]:L['reserved'+key]+p.amount})){trusted=null;return true;}
   if(!supplyActive(s,P)||current()?.pending?.id!==p.id){await pause('Закупка остановлена до отправки; сначала сверить состояние');return true;}
   supplyPermit=p.id;let response,result;
   try{({response,result}=await supplyPost(p));}
   catch(_){await pause('Связь прервана при закупке; повтор запрещён, нужна сверка');return true;}
   finally{supplyPermit=null;}
   if(!own(s)||current()?.pending?.id!==p.id)return true;
   if([400,401,403,404,412,422,423,429].includes(response.status)){
    const cur=current(),funds=ledger(cur);if(!funds)return pause('Не подтверждён резерв отклонённой закупки');
    trusted=null;await save({...cur,pending:null,['reserved'+key]:Math.max(0,funds['reserved'+key]-p.amount),status:'paused',reason:`Игра отклонила закупку (${response.status}); продолжение вручную`});return true;
   }
   // 20.43 (разбор 21.10): 5xx с точным кодом отказа — сразу свежий GET; не подтвердился — код остаётся в pending для сверки раз в 15 с.
   const code=refusal(response.status,result);
   if(code){
    const snap=await supplySnapshot();if(!own(s)||current()?.pending?.id!==p.id)return true;
    const marked={...current(),pending:{...current().pending,refused:code}};
    if(snap&&await refusedSupply(marked,snap))return true;
    trusted=null;permit=null;supplyPermit=null;const reason=`Игра отказала в закупке (${code}), но свежее состояние героя это не подтвердило; повтор запрещён, нужна сверка`;
    await save({...marked,status:'paused',reason});env.setStatus?.('ЛС: '+reason);return true;
   }
   if(!response.ok||result?.error||result?.ok===false||!result?.character)return pause('Ответ не подтверждает закупку; повтор запрещён, нужна сверка');
   const after=await supplySnapshot(),freshMerchant=p.action==='travel'?await supplyGet('/game/mammon/merchant'):null;
   if(!own(s)||current()?.pending?.id!==p.id)return true;
   if(!after||!await settleSupply(current(),after,freshMerchant))await pause('Закупка и состояние героя расходятся; повтор запрещён');
   return true;
  }
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
   trusted=null;permit=null;supplyPermit=null;
   userPause=false;
   const row={id:`${now()}:${Math.random().toString(36).slice(2)}`,char:who,status:'paused',hold:true,reason:PREPARED,
    weaponKey:c.weaponKey,weaponName:chosen?.name||h?.itemNamesRu?.[id]||h?.itemNamesUk?.[id]||h?.itemNamesEn?.[id]||'#'+id,targets:c.targets,maxAttempts:c.maxAttempts,configSig:sig(c),attempts:0,grade,itemId:id,weapon:fingerprint(w),base:base(w),pending:null,history:[],nextAt:0,spentAA:0,spentAdena:0,reservedAA:0,reservedAdena:0,supplies:[]};
   if(!await save(row,s.inventory.eq))throw Error('Не удалось сохранить серию; расход не выполнялся');return true;
  }
  async function command(action){if(action==='pause'&&busy){trusted=null;permit=null;supplyPermit=null;userPause=true;return true;}if(busy)throw Error('Предыдущий шаг ЛС ещё выполняется');busy=true;
   try{
    if(action==='scan')return await scanWeapons();
    if(action==='prepare')return await prepare();
    const s=current();if(!own(s))throw Error('Нет серии этого персонажа');
    if(action==='pause')return await pause('Пауза игрока',true);
    // 20.43 (доводка 21.10, ревью): «Сверить» и «Учесть попытку» — команды игрока на странице серии: итоговая пауза («Состояние
    // сверено…», «Неизвестная попытка учтена…») держит удержание, как «Пауза», — иначе следующий шаг уводил бота к задачам и
    // «Продолжить» (нужна страница аугментации) становилось недоступно, оставалась только новая серия с обнулёнными тратами
    if(action==='reconcile'){if(s.pending)userPause=true;return await reconcile();}
    if(action==='acknowledge'){
     const p=s.pending;if(!p)throw Error('Нет неизвестной попытки');if(p.kind==='supply')throw Error('Неизвестную покупку нельзя учесть как попытку; сначала сверьте материалы и оплату');
     trusted=null;permit=null;const snap=await snapshot();
     if(!own(s)||current()?.pending?.id!==p.id||!snap||snap.revision<=p.revision||base(snap.inventory.eq.l1)!==s.base)throw Error('Нужна свежая ревизия героя и прежнее оружие. Сначала проверьте состояние в игре');
     const outcome=snap.inventory.eq.l1?.augmentation?.outcomeId;if(outcome&&!known(outcome))throw Error('На оружии неизвестный эффект');
     return await save({...s,pending:null,attempts:s.attempts+1,weapon:fingerprint(snap.inventory.eq.l1),status:'paused',userHold:true,reason:'Неизвестная попытка учтена в лимите; продолжение вручную',
      history:[{t:now(),attempt:s.attempts+1,status:'unknown',pending:p,checkedRevision:snap.revision},...s.history].slice(0,100)},snap.inventory.eq);
    }
    if(action==='close'){if(s.pending)throw Error('Результат попытки неизвестен — сначала сверить');trusted=null;return await save({...s,status:'closed',hold:false,reason:'Серия завершена игроком'});}
    if(action!=='resume')throw Error('Неизвестная команда ЛС');
    if(s.pending)throw Error('Сначала сверьте результат попытки');
    if(!live()||!env.canPrepare())throw Error('Запустите бота на странице аугментации, без других служебных задач');
    if(!config().valid||s.configSig!==sig(config()))throw Error('Цели или лимит изменились — подготовьте новую серию');
    if(s.attempts>=s.maxAttempts||s.status==='closed')throw Error('Серия завершена; подготовьте новую');
    const next={...s,status:'running',hold:true,userHold:false,reason:'',context:stamp()};
    userPause=false;if(!await save(next))throw Error('Не удалось сохранить запуск');trusted=s.id;return true;
   }finally{busy=false;}
  }
  // Одно разрешение только на конкретный долговечно записанный POST; чужие gamePost его не получают.
  function consumePermit(id,body){const s=current(),p=s?.pending;
   if(!p||p.kind==='supply'||permit!==p.id||id!==p.id||!allowed(s)||body?.operation!=='install'||body.expectedRevision!==p.revision)return false;
   permit=null;return true;
  }
  async function settle(s,snap,receipt){
   const p=s.pending,w=snap.inventory.eq.l1,a=w?.augmentation;
   if(base(w)!==s.base||snap.revision!==p.revision+1||!a||!known(a.outcomeId)||a.grade!==s.grade||typeof a.uid!=='string'||!a.uid||a.uid===p.uid||
    qty(snap,A.LIFE_STONE[s.grade])!==p.ls-1||qty(snap,A.GEMSTONE[s.grade])!==p.gem-1||receipt&&receipt!==a.outcomeId)return false;
   const attempts=s.attempts+1,matched=s.targets.includes(a.outcomeId),done=matched||attempts>=s.maxAttempts;
   const row={...s,attempts,weapon:fingerprint(w),pending:null,last:a.outcomeId,nextAt:now()+1500,
    history:[{t:now(),outcomeId:a.outcomeId,attempt:attempts},...s.history].slice(0,100),
    status:done?'done':allowed(s)?'running':'paused',reason:matched?'Получен выбранный эффект: '+A.OUT[a.outcomeId].n:done?'Достигнут лимит попыток':allowed(s)?'':'Состояние сверено; продолжение вручную',
    ...(done?{hold:false}:{})};   // 20.43 (разбор 21.10): попытка сверена, цель/лимит — серия отпускает бота (см. finish)
   if(!await save(row,snap.inventory.eq))return false;
   if(done)trusted=null;
   env.rec?.('B','ЛС',`${attempts}/${s.maxAttempts}: ${A.OUT[a.outcomeId].n}${done?' · '+row.reason:''}`);if(done)env.rec?.('B','ЛС',DONE_NOTE);return true;
  }
  async function reconcile(){const s=current(),p=s?.pending;if(!own(s)||!p)return false;
   trusted=null;permit=null;supplyPermit=null;
   if(p.kind==='supply'){
    const snap=await supplySnapshot(),merchant=p.action==='travel'?await supplyGet('/game/mammon/merchant'):null;
    if(!own(s)||current()?.pending?.id!==p.id)return false;
    if(snap&&(await settleSupply({...current(),status:'paused'},snap,merchant)||await recoverSupply(current(),snap)||await refusedSupply(current(),snap)))return true;
    await save({...current(),status:'paused',reason:'Закупка не подтверждена; повтор запрещён. Проверьте материалы и оплату',pending:{...p,lastCheck:now()}});return false;
   }
   const snap=await snapshot();if(!own(s)||current()?.pending?.id!==p.id)return false;
   if(snap&&await settle({...current(),status:'paused'},snap))return true;
   await save({...current(),status:'paused',reason:'Результат не подтверждён; повтор запрещён. Проверьте оружие и материалы в игре',pending:{...p,lastCheck:now()}});return false;
  }
  async function step(){if(busy)return true;const initial=current();if(!own(initial)||!initial.hold&&!initial.pending)return false;busy=true;
   try{
    let s=current();
    if(s.pending){if(now()-(s.pending.lastCheck||s.pending.t)<15000)return true;await reconcile();return true;}
    // 20.43 (разбор 21.10): серия, завершённая до обновления (done + удержание), тоже отпускает бота — после 'done' ЛС ничего не тратит.
    if(s.status==='done'){trusted=null;if(await save({...s,hold:false}))env.rec?.('B','ЛС',DONE_NOTE);return true;}
    // 20.43 (доводка 21.10): и серия на паузе после сбоя с удержанием (запись прежней версии) — пауза не игрока и не подготовка.
    // Ревью: пауза игрока помечена userHold во всех путях («Пауза», в т. ч. во время шага, «Сверить», «Учесть попытку»); пока действует
    // «Пауза» этой вкладки (userPause), не снимаем и неотмеченную запись
    if(s.status==='paused'&&s.hold===true&&!s.userHold&&!userPause&&s.reason!=='Пауза игрока'&&s.reason!==PREPARED){trusted=null;if(await save({...s,hold:false}))freeNote(s.reason);return true;}
    if(!allowed(s)){if(s.status==='running')await pause('Остановлено, страница или настройки изменились; продолжение вручную');env.setStatus?.('ЛС: '+(current()?.reason||'Ожидание команды'));return true;}
    if(now()<s.nextAt)return true;
    if(s.attempts>=s.maxAttempts)return await finish(s,'Достигнут лимит попыток');
    // 23.10: темп ждём до снимка и pending; таймаут отправки начинается только у самого POST.
    if(env.actionWait&&!await env.actionWait(()=>current()?.id===s.id&&allowed(current())))return true;
    if(current()?.id!==s.id||!allowed(current()))return true;
    const snap=await snapshot();if(current()?.id!==s.id||!allowed(s))return true;
    if(!snap)return await pause('Не удалось прочитать актуальное оружие и материалы');
    const w=snap.inventory.eq.l1;
    if(fingerprint(w)!==s.weapon)return await pause('Оружие или его эффект изменились вне серии — выберите заново');
    const outcome=w?.augmentation?.outcomeId;
    if(outcome&&s.targets.includes(outcome))return await finish(s,'Нужный эффект уже на оружии: '+A.OUT[outcome].n);
    const ls=qty(snap,A.LIFE_STONE[s.grade]),gem=qty(snap,A.GEMSTONE[s.grade]);
    if(ls==null||gem==null)return await pause('Количество материалов не прочитано');
    if(ls<1||gem<1||config().buyMaterials&&(ls<s.maxAttempts-s.attempts||gem<s.maxAttempts-s.attempts))return await supply(s,snap);
    const p={id:s.id+':'+s.attempts+':'+now(),t:now(),revision:snap.revision,ls,gem,uid:w?.augmentation?.uid||null};
    if(!await save({...s,pending:p})){trusted=null;return true;}
    // После любого сбоя сохранения pending остаётся блокировкой, даже если клик точно не отправлен.
    s=current();if(s?.pending?.id!==p.id||!allowed(s)){await pause('Остановлено до отправки; сначала сверить состояние');return true;}
    permit=p.id;
    let r,out;
    try{r=await env.gamePost(path,{expectedRevision:p.revision,operation:'install'},8000,p.id);out=await r.json();}
    catch(_){await pause('Связь прервана; результат попытки нужно сверить');return true;}
    if(!own(s)||current()?.pending?.id!==p.id)return true;
    if([400,401,403,404,412,422,423,429].includes(r.status)){
     await save({...current(),pending:null,status:'paused',reason:`Сервер отклонил попытку (${r.status}); продолжение вручную`});trusted=null;return true;}
    if(!r.ok||out?.error||out?.ok===false||out?.gemstonesSpent!==1||!known(out?.outcomeId))return await pause('Ответ игры не подтверждает попытку — нужна сверка');
    // Доверяем только свежему GET и точному расходу 1+1; ответ POST сам по себе не разрешает следующий расход.
    const after=await snapshot();if(!own(s)||current()?.pending?.id!==p.id)return true;
    if(!after||!await settle(current(),after,out.outcomeId))await pause('Результат и состояние оружия расходятся — повтор запрещён');
    return true;
   }finally{permit=null;supplyPermit=null;busy=false;}
  }
  // 20.43 (разбор 21.10): зовётся и при открытой записи на TvT (content loopGate), не только когда уже записаны.
  async function yieldToUrgent(){trusted=null;permit=null;const s=current();if(!own(s)||s.pending)return false;const done=s.status==='done';
   const ok=await save(done?{...s,hold:false}:{...s,status:'paused',hold:false,reason:'ЛС прерван для TvT; продолжение вручную'});if(ok)env.rec?.('B','ЛС',done?DONE_NOTE:'Серия прервана ради TvT; продолжение вручную');return ok;}
  return {command,step,reconcile,consumePermit,consumeSupplyPermit,yieldToUrgent,interrupt:()=>{trusted=null;permit=null;supplyPermit=null;},config};
 };
})(globalThis);
