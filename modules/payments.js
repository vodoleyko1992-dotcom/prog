/* 15.10: намерение оплаты сохраняется ДО клика; потерянный ответ не разрешает повтор. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.payments = function create_payments(env) {
  let serial = 0, writing = false, permit = null;
  const local = new Map();
  const state = () => env.rt.actionPayments || {};
  const context = () => JSON.stringify([env.rt.char || '', +env.rt.manualKickAt || 0,
    env.autonomyMode?.() || '', env.rt.classCur || null, env.paymentContext?.() ?? null]);
  const active = () => env.on !== false && env.tabOwner !== false && env.canRun?.() !== false;
  const pending = key => { const p = state().pending; return p && (!key || p.key === key) ? p : null; };
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
      if (!await save({...state(),pending:p}) || !same(p) || !active() || context() !== p.context) { await cancel(p); return null; }
      return p;
    } finally { writing = false; }
  }
  // Между sent и fire/gamePost не должно быть await. Core обязан вызвать consumePermit перед действием:
  // разрешается ровно один клик, остальные действия при pending заблокированы. Durable prepared блокирует повтор после reload.
  function sent(p) {
    if (!same(p) || !active() || context() !== p.context || local.get(p.id) !== 'ready') return false;
    local.set(p.id,'sent'); permit=p.id; return true;
  }
  function consumePermit() { const p=pending(); if (!p || permit!==p.id || !same(p) || !active() || context()!==p.context) return false; permit=null; return true; }
  async function cancel(p, options = {}) {
    if (!same(p) || (local.get(p.id) !== 'ready' && !(local.get(p.id) === 'sent' && options.notSent === true))) return false;
    if (!await save({...state(),pending:null})) return false;
    local.delete(p.id); if(permit===p.id)permit=null; return true;
  }
  async function confirm(p, evidence) {
    if (!same(p) || !evidence?.kind) return false;
    const before = state(), row = {...p,phase:'confirmed',confirmedAt:Date.now(),confirmation:evidence};
    if (!await save({...before,pending:null,history:[row,...(before.history || [])].slice(0,40)})) {
      // setRt может обновить память до неудачного flush: неизвестный исход обязан остаться блокирующим.
      try { await env.setRt({actionPayments:before}); } catch (_) {} return false;
    }
    local.delete(p.id); if(permit===p.id)permit=null;
    env.rec?.('B','оплата',`${p.kind}: ${/satisfied|arrival/.test(evidence.kind)?'результат подтверждён, повтор не требуется':'получена квитанция'}; резерв ${p.quote.amount} ${p.quote.currency}`);
    return true;
  }
  return {prepare,sent,cancel,confirm,pending,consumePermit,matchesContext:p=>same(p)&&context()===p.context,blocked:()=>!!pending()};
 };
})(globalThis);
