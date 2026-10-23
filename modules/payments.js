/* 15.10: намерение оплаты сохраняется ДО клика; потерянный ответ не разрешает повтор. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 // 20.12 (ревизия 17.10, аудит PAY-1..3/H2/M1): одно правило исхода платного запроса для всех модулей.
 // Явный отказ сервера (4xx из списка или 2xx с error / ok:false: «не хватает», не та цена, нет подтверждения) —
 // оплата точно не применилась, повтор разрешён. 5xx, обрыв связи, нет ответа — исход неизвестен, повтор запрещён.
 const REJECT = [400, 401, 403, 404, 409, 412, 422, 423, 429];
 // 20.41 (лог 20.10 22:03, Кристал C для пояса): сумка полна — игра отвечает HTTP 500 с явным кодом «inventory_full».
 // Это не сбой сервера, а отказ: адена не списана (ревизия героя та же), иначе бот держал «неизвестную оплату» и стоял в магазине.
 // Только точные коды отказа; обычный 500 («Internal server error» без кода) по-прежнему неизвестен.
 const BIZ_REJECT = /^(?:inventory_full|not_enough_[a-z_]+|insufficient_[a-z_]+)$/;
 const PROBE_AFTER = 120000, PROBE_WAIT = 15000, PROBE_GAP = 30000, PROBE_SLOW = 300000, PROBE_N = 20;
 function classify(d) {
  if (!d || typeof d !== 'object') return 'unknown';
  const s = +d.status;
  if (!Number.isInteger(s) || s <= 0) return 'unknown';
  if (REJECT.includes(s)) return 'rejected';
  if (s >= 200 && s < 300) {
   const r = d.res;
   // 20.26, аудит автономности: HTML/обрыв тела/пустой JSON не доказывают оплату.
   // Неизвестный исход остаётся в очереди до обычной сверки запаса/состояния.
   if (!r || typeof r !== 'object' || Array.isArray(r) || !Object.keys(r).length) return 'unknown';
   if (r && typeof r === 'object' && (r.error || r.ok === false)) return 'rejected';
   return d.error ? 'unknown' : 'applied';
  }
  if (s >= 500 && d.res && typeof d.res === 'object' && BIZ_REJECT.test(String(d.res.message || ''))) return 'rejected';
  return 'unknown';
 }
 const money = v => { const n = typeof v === 'string' && /^\d+$/.test(v) ? +v : v; return Number.isSafeInteger(n) && n >= 0 ? n : null; };
 // Состояние героя после оплаты не изменилось: та же ревизия и адены не меньше, чем до клика.
 function unchanged(before, ch) {
  if (!before || !ch || !Number.isSafeInteger(before.revision) || ch.revision !== before.revision) return false;
  if (before.adena == null) return true;
  const a = money(ch.adena); return a != null && a >= before.adena;
 }
 root.L2PayOutcome = { REJECT, BIZ_REJECT, classify, unchanged };
 root.L2V7Factories.payments = function create_payments(env) {
  let serial = 0, writing = false, permit = null, requestPermit = null, nativeClaim = null;
  const unsettled = new Map();
  const local = new Map();
  const state = () => env.rt.actionPayments || {};
  const context = () => JSON.stringify([env.rt.char || '', +env.rt.manualKickAt || 0,
    env.autonomyMode?.() || '', env.rt.classCur || null, env.paymentContext?.() ?? null, env.lease?.() ?? null]);
  const active = () => env.on !== false && env.tabOwner !== false && env.canRun?.() !== false;
  const pending = key => { const p = state().pending || unsettled.get(env.rt.char || '') || null; return p && (!key || p.key === key) ? p : null; };
  const same = p => !!p && pending()?.id === p.id && (env.rt.char || '') === p.char && env.tabOwner !== false;
  async function save(next) {
    try { const r = await env.setRt({actionPayments:next}); return r?.ok === true && typeof env.rtCommit === 'function' && await env.rtCommit() === true; }
    catch (_) { return false; }
  }
  async function prepare(spec) {
    if (writing || !active() || env.externalPending?.() || !spec?.key || !spec.kind || !spec.quote || !Number.isFinite(spec.quote.amount) || spec.quote.amount < 0 || !spec.quote.currency) return null;
    writing = true;
    try {
      const before = context();
      if (env.actionWait && !await env.actionWait(() => active() && context() === before)) return null;
      if (!active() || context() !== before || env.externalPending?.()) return null;
      const previous = pending();
      // В этой же вкладке точно знаем, что клик ещё не отправлялся. После reload такого доказательства нет.
      if (previous && local.get(previous.id) === 'ready') {
        if (!await save({...state(),pending:null})) return null;
        local.delete(previous.id);
      }
      if (pending()) return null;
      const p = {...spec, id:`${Date.now()}:${Math.random().toString(36).slice(2)}:${++serial}`, at:Date.now(), char:env.rt.char || '', kick:+env.rt.manualKickAt || 0, context:context(), phase:'prepared'};
      local.set(p.id,'ready');
      if (!await save({...state(),pending:p}) || !same(p) || !active() || context() !== p.context) { await cancelReady(p); return null; }
      return p;
    } finally { writing = false; }
  }
  // Между sent и fire/gamePost не должно быть await. Core обязан вызвать consumePermit перед действием:
  // разрешается ровно один клик, остальные действия при pending заблокированы. Durable prepared блокирует повтор после reload.
  function sent(p) {
    if (!same(p) || !active() || context() !== p.context || local.get(p.id) !== 'ready') return false;
    local.set(p.id,'sent'); permit=p.id; return true;
  }
  function consumePermit() { const p=pending(); if (!p || permit!==p.id || !same(p) || !active() || context()!==p.context) return false; permit=null; requestPermit={id:p.id,context:p.context,at:Date.now()}; return true; }
  // 15.10, ревью: pending сам по себе не доказывает происхождение запроса. Один native POST
  // связывается только с использованным разрешением клика; служебные GET его не забирают.
  function claimRequest(d) {
    const prior=nativeClaim,p0=pending();
    if(d?.method==='POST'&&prior&&d.retryOf===prior.rid&&p0?.id===prior.id&&p0.kind==='story-teleport'&&same(p0)&&context()===prior.context&&Number.isFinite(d.retryAt)&&d.retryAt<=Date.now()&&Date.now()-d.retryAt<=10000&&d.path===prior.path&&d.req?.targetId===p0.target&&Number.isSafeInteger(d.req?.expectedRevision)&&d.req.expectedRevision>=prior.revision){nativeClaim=null;return p0.id;}
    if(d?.method==='POST')nativeClaim=null;
    const p=pending(),a=requestPermit;if(!a||!p||a.id!==p.id||!same(p)||!active()||a.context!==context()||Date.now()-a.at>30000){requestPermit=null;return '';}
    if(d?.method!=='POST')return '';
    const e=p.evidence||{},expected=p.kind==='fishing'&&/^\/game\/fishing\/(?:action|buy-starter|buy-gear)$/.test(e.path||'')?e.path:
      p.kind==='cat-teleport'?'/game/catacombs/teleport':p.kind==='raid-teleport'?'/game/raid-boss/teleport':
      p.kind==='tvt-shop'?'/game/tvt/shop/purchase':p.kind==='shop'?'/game/drops-shop/buy':p.kind==='story-teleport'&&/^(?:noblesse|subclass)$/.test(p.questKind)?`/game/story-quests/${p.questKind}/teleport`:
      p.kind==='mammon'&&e.action==='transfer'?'/game/item-transfer/send':p.kind==='mammon'&&e.action==='upgrade'?'/game/mammon/blacksmith/upgrade':p.kind==='mammon'&&e.action==='teleport'?'/game/mammon/teleport':p.kind==='fa-buff'?'/character/town/fast-aden-buffer/apply':null;
    if(!expected||d.path!==expected)return '';
    if(p.kind==='fa-buff'&&(!e.set||d.req?.set!==e.set||e.ids?.length!==1||d.req?.skillId!==e.ids[0]||d.req?.expectedCostFastAden!==p.quote.amount||!Number.isSafeInteger(d.req?.expectedRevision)))return '';
    if(p.kind==='story-teleport'&&Number.isSafeInteger(d.rid)&&d.req?.targetId===p.target&&Number.isSafeInteger(d.req?.expectedRevision))nativeClaim={id:p.id,context:p.context,rid:d.rid,path:d.path,revision:d.req.expectedRevision,at:Date.now()};
    requestPermit=null;return p.id;
  }
  async function cancelReady(p, options = {}) {
    if (!same(p) || (local.get(p.id) !== 'ready' && !(local.get(p.id) === 'sent' && options.notSent === true))) return false;
    if (!await save({...state(),pending:null})) return false;
    local.delete(p.id); if(permit===p.id)permit=null; return true;
  }
  async function cancel(p, options = {}) {
    if (writing) return false;
    writing = true;
    try { return await cancelReady(p, options); } finally { writing = false; }
  }
  async function confirm(p, evidence) {
    if (writing || !same(p) || !evidence?.kind) return false;
    // 15.10, ревизия: setRt меняет память до flush. До durable квитанции сохраняем блокировку
    // и не выдаём новый prepare; откат старого flush не должен менять профиль другого героя.
    writing = true; unsettled.set(p.char,p); let durable=false;
    const lease = env.lease?.(), mine = () => (env.rt.char || '') === p.char && env.tabOwner !== false && env.lease?.() === lease;
    try {
      const before = state(), row = {...p,phase:'confirmed',confirmedAt:Date.now(),confirmation:evidence};
      if (!await save({...before,pending:null,history:[row,...(before.history || [])].slice(0,40)})) {
        if (mine() && !state().pending && state().history?.[0]?.id === p.id) {
          try { await env.setRt({actionPayments:before}); } catch (_) {}
        }
        return false;
      }
      durable=true;
      if (!mine()) return false;
      local.delete(p.id); if(permit===p.id)permit=null;
      // 20.12: отказ/«не применилась» — оплата не прошла, а не «получена квитанция».
      env.rec?.('B','оплата',evidence.kind==='free-unresolved'?`${p.kind}: бесплатный переход (0 ${p.quote.currency}) не подтверждён — списать ничего не могло, ожидание снято`
        :evidence.spent===0?`${p.kind}: оплата не прошла (${evidence.kind==='state-not-applied'?'состояние героя не изменилось':'сервер отклонил'+(evidence.status?' '+evidence.status:'')}); ${p.quote.amount} ${p.quote.currency} не списаны, задача может повторить`
        :`${p.kind}: ${/satisfied|arrival/.test(evidence.kind)?'результат подтверждён, повтор не требуется':'получена квитанция'}; резерв ${p.quote.amount} ${p.quote.currency}`);
      return true;
    } finally { if(durable&&unsettled.get(p.char)?.id===p.id)unsettled.delete(p.char); writing = false; }
  }
  // 20.12 (ревизия 17.10): сверка по состоянию героя — не чаще раза в 30 с, после 20 попыток раз в 5 мин.
  // «Не применилась» — только через ≥2 мин после оплаты и только если две сверки подряд (≥30 с) видят неизменное состояние.
  const probes = new Map();
  // Первые 15 с после оплаты ждём саму квитанцию ответа, лишних GET не делаем.
  function probeDue(p) { const r=p&&probes.get(p.id); return !!p && Date.now()-(+p.at||0) >= PROBE_WAIT && (!r || Date.now()-r.t >= (r.n>=PROBE_N?PROBE_SLOW:PROBE_GAP)); }
  function probeNote(p, absent) {
    if (!p) return false;
    const now=Date.now(), r=probes.get(p.id)||{n:0,t:0,since:0}, ok=absent===true&&now-p.at>=PROBE_AFTER;
    r.n++; r.t=now; r.since=ok?(r.since||now):0; probes.set(p.id,r);
    if (probes.size>20) probes.delete(probes.keys().next().value);
    return ok && now-r.since>=PROBE_GAP;
  }
  return {prepare,sent,cancel,confirm,pending,consumePermit,claimRequest,matchesContext:p=>same(p)&&context()===p.context,blocked:()=>writing||!!pending(),
   REJECT,classify,unchanged,probeDue,probeNote};
 };
})(globalThis);
