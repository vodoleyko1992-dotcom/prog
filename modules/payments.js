/* 15.10: намерение оплаты сохраняется ДО клика; потерянный ответ не разрешает повтор. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
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
      p.kind==='mammon'&&e.action==='transfer'?'/game/item-transfer/send':null;
    if(!expected||d.path!==expected)return '';
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
      env.rec?.('B','оплата',`${p.kind}: ${/satisfied|arrival/.test(evidence.kind)?'результат подтверждён, повтор не требуется':'получена квитанция'}; резерв ${p.quote.amount} ${p.quote.currency}`);
      return true;
    } finally { if(durable&&unsettled.get(p.char)?.id===p.id)unsettled.delete(p.char); writing = false; }
  }
  return {prepare,sent,cancel,confirm,pending,consumePermit,claimRequest,matchesContext:p=>same(p)&&context()===p.context,blocked:()=>writing||!!pending()};
 };
})(globalThis);
