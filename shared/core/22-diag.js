/* shared/core/22-diag.js — event journal ("логи"): OGX.log.rec / OGX.log.wrap, capture of page loads, errors, network
 * (game requests via the MAIN-world hook + our OGX.http requests), game messages (fadeBox, notifications, error boxes)
 * and clicks in our UI; transport to the background IndexedDB (fallback: page-origin IndexedDB/localStorage);
 * sanitized DOM snapshots; export helpers. Owner: core. Format of the exports: specs/DIAG.md. */
(function (OGX) {
  'use strict';
  const L = OGX.diaglib;
  const diag = (OGX.diag = OGX.diag || {});
  const SRC = { U: 1, B: 1, S: 1, N: 1, G: 1, L: 1 };
  const PRE_INIT_MAX = 1000;
  const BUF_MAX = 5000;
  const FLUSH_MS = 800;

  if (OGX.settings && OGX.settings.define) {
    OGX.settings.define('diag', {
      journal: { type: 'bool', default: true, label: 'Вести журнал событий (для разбора ошибок)', section: 'Диагностика' },
      network: { type: 'bool', default: true, label: 'Записывать сетевые запросы игры и дополнения', section: 'Диагностика' },
      learn: { type: 'bool', default: true, label: 'Самообучение: следить за изменениями вёрстки и ответов сервера', section: 'Диагностика' },
      snapshots: { type: 'bool', default: true, label: 'Сохранять снимок страницы при алерте самообучения', section: 'Диагностика' },
    });
  }
  const setting = (k, def = true) => { try { const v = OGX.settings.get('diag.' + k); return v === undefined ? def : v !== false; } catch (e) { return def; } };
  diag.enabled = (k) => setting(k);

  let inited = false;
  let buf = [];
  let flushTimer = null;
  let backend = null;          // { kind: 'bg' | 'idb' | 'localStorage', put, putSnap, query, snaps, stats, getMeta, setMeta, clear }
  let backendP = null;
  let recursion = 0;
  const recent = [];           // last 3000 events of this page (for counters, tests)
  const tab = () => { try { return String(OGX.storage.tabId || '').slice(0, 6) || '-'; } catch (e) { return '-'; } };
  const pageName = () => { try { return OGX.page.info().name; } catch (e) { return null; } };
  const extName = () => (OGX.ext === 'live' ? 'OgameX Live' : OGX.ext === 'infinity' ? 'OgameX Infinity' : OGX.ext === 'bot' ? 'OgameX Bot' : OGX.ext === 'suite' ? 'OgameX Suite' : 'OGX ' + (OGX.ext || 'core'));

  // ------------------------------------------------------------------ record
  /**
   * OGX.log.rec(src, kind, what, data?) -> event | null
   * src: U user click in our UI, B add-on/bot action, S page/session/errors/snapshots, N network, G game messages, L self-learning.
   */
  OGX.log.rec = function (src, kind, what, data) {
    if (recursion > 0) return null;
    recursion++;
    try {
      const s = SRC[src] ? src : 'S';
      if (inited && !setting('journal')) return null;
      if (inited && s === 'N' && !setting('network')) return null;
      const ev = { t: Date.now(), s, k: String(kind || '-').slice(0, 60), w: L.redactString(String(what === undefined || what === null ? '' : what), 300), p: pageName(), x: OGX.ext || null, tab: tab() };
      if (data !== undefined && data !== null) ev.d = L.redact(data);
      recent.push(ev);
      if (recent.length > 3000) recent.splice(0, recent.length - 3000);
      buf.push(ev);
      const cap = inited ? BUF_MAX : PRE_INIT_MAX;
      if (buf.length > cap) buf.splice(0, buf.length - cap);
      if (inited) schedule();
      return ev;
    } catch (e) { return null; } finally { recursion--; }
  };
  // Per-tick renders and timers (flights alert every second, planetbar/inflight/timeline renders, panel badges, ...)
  // are "quiet": recorded on their first call on a page and then only when the result changes; a repeated identical
  // result is counted and the count rides on the next recorded call as 'same'. Failures are always recorded.
  const QUIET_LABELS = /^(render|render-[\w-]+|badges|renderBadges|renderTable|alert|attachOverlay|movementChart|plan:sweep-done)$/;
  const quietLast = new Map();   // 'module|label' -> { sig, same }
  diag.QUIET_LABELS = QUIET_LABELS;
  /**
   * OGX.log.wrap(moduleName, fn, label?, opts?) -> wrapped fn. Times the call and records B '<module>' '<label>' { ms, ok, r? }.
   * Errors are recorded (B ok:false and S 'error' with the stack) and rethrown; the return value is unchanged.
   * opts.quiet: record only result changes (default: on for the per-tick labels of QUIET_LABELS).
   */
  OGX.log.wrap = function (moduleName, fn, label, opts) {
    if (typeof fn !== 'function') return fn;
    const what = label || fn.name || 'action';
    const quiet = opts && opts.quiet !== undefined ? !!opts.quiet : QUIET_LABELS.test(what);
    const qKey = moduleName + '|' + what;
    return function ogxWrapped(...args) {
      const t0 = Date.now();
      const done = (ok, r, err) => {
        const d = { ms: Date.now() - t0, ok };
        if (args.length) d.args = summarize(args);
        if (ok && r !== undefined) d.r = summarize(r);
        // a thrown error -> its message; a refusal returned as { success|ok: false } -> its message / error (never "undefined")
        if (!ok) d.err = err ? (err.message ? String(err.message) : String(err)) : String((r && typeof r === 'object' && (r.message || r.error)) || 'отказ');
        if (quiet) {
          let sig = '';
          // the call reason ('init' / 'update' / ...) is not a change of the result
          const rs = d.r && typeof d.r === 'object' && !Array.isArray(d.r) && 'reason' in d.r ? Object.assign({}, d.r, { reason: undefined }) : d.r;
          try { sig = ok ? JSON.stringify(rs === undefined ? null : rs) : '!err'; } catch (e) { sig = String(Math.random()); }
          const prev = quietLast.get(qKey);
          if (ok && prev && prev.sig === sig) { prev.same++; return; }
          if (prev && prev.same) d.same = prev.same;
          quietLast.set(qKey, { sig, same: 0 });
        }
        OGX.log.rec('B', moduleName, what, d);
        if (!ok) OGX.log.rec('S', 'error', moduleName + ':' + what, { msg: d.err, stack: err && err.stack ? String(err.stack) : null });
      };
      let r;
      try { r = fn.apply(this, args); } catch (e) { done(false, null, e); throw e; }
      if (r && typeof r.then === 'function') {
        return r.then((v) => { done(!(v && typeof v === 'object' && (v.success === false || v.ok === false)), v); return v; }, (e) => { done(false, null, e); throw e; });
      }
      done(true, r);
      return r;
    };
  };
  function summarize(v) {
    const r = L.redact(v, { maxStr: 120 });
    try { const s = JSON.stringify(r); if (s && s.length > 800) return s.slice(0, 800) + '…'; } catch (e) { return '(unprintable)'; }
    return r;
  }
  diag.recent = (filter) => recent.filter((e) => !filter || (!filter.s || e.s === filter.s) && (!filter.k || e.k === filter.k)).slice();

  // ------------------------------------------------------------------ transport
  function sendMsg(msg, timeoutMs = 4000) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => fin(null), timeoutMs);
      try {
        const rt = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) ? chrome.runtime
          : (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) ? browser.runtime : null;
        if (!rt || !rt.id) return fin(null);
        const p = rt.sendMessage(msg, (reply) => {
          const err = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          fin(err ? null : reply === undefined ? null : reply);
        });
        if (p && typeof p.then === 'function') p.then((v) => fin(v === undefined ? null : v), () => fin(null));
      } catch (e) { fin(null); }
    });
  }
  diag._sendMsg = sendMsg;
  function bgBackend() {
    const call = async (type, extra) => {
      const r = await sendMsg(Object.assign({ type }, extra || {}), 15000);
      if (!r || !r.ok) throw new Error('background: ' + (r && r.error || 'no answer'));
      return r;
    };
    return {
      kind: 'bg',
      put: async (events) => (await call('ogx:diag:put', { events })).n,
      putSnap: async (snap) => (await call('ogx:diag:snap', { snap })).id,
      query: async (q) => { const r = await call('ogx:diag:query', { q }); return { events: r.events, total: r.total, cut: r.cut }; },
      snaps: async (q) => { const r = await call('ogx:diag:snaps', { q }); return { snaps: r.snaps, total: r.total, cut: r.cut }; },
      stats: async () => (await call('ogx:diag:stats')).stats,
      getMeta: async (k) => (await call('ogx:diag:meta', { k })).v,
      setMeta: async (k, v) => (await call('ogx:diag:meta', { k, v })).v,
      clear: async () => { await call('ogx:diag:clear'); return true; },
    };
  }
  async function localBackend() {
    const s = await L.openStore({ name: 'ogx-diag-' + (OGX.ext || 'core') });
    return s;
  }
  /** Resolves the store: the extension background when it answers 'ogx:diag:ping', else page-origin IndexedDB/localStorage. */
  diag.store = function () {
    if (backend) return Promise.resolve(backend);
    if (!backendP) {
      backendP = (async () => {
        const pong = await sendMsg({ type: 'ogx:diag:ping' }, 2500);
        backend = pong && pong.diag ? bgBackend() : await localBackend();
        return backend;
      })();
      backendP.catch(() => { backendP = null; });
    }
    return backendP;
  };
  function schedule() {
    if (flushTimer || !buf.length) return;
    flushTimer = setTimeout(() => { flushTimer = null; diag.flush(); }, buf.length >= 200 ? 50 : FLUSH_MS);
  }
  let flushing = Promise.resolve();
  const inflight = new Set();
  // Page-origin stores (userscript, no background) cannot finish an IndexedDB write while the page unloads: on pagehide
  // the unsent events are spilled synchronously to localStorage and replayed by the next page of this origin.
  const spillKey = () => 'ogx-diag-spill-' + (OGX.ext || 'core');
  function spill() {
    if (backend && backend.kind === 'bg') return false;
    const list = [];
    for (const b of inflight) list.push(...b);
    list.push(...buf);
    if (!list.length) return false;
    try {
      const old = JSON.parse(localStorage.getItem(spillKey()) || '[]');
      localStorage.setItem(spillKey(), JSON.stringify(old.concat(list).slice(-3000)));
      buf = []; inflight.clear();
      return true;
    } catch (e) { return false; }
  }
  function unspill() {
    try {
      const v = localStorage.getItem(spillKey());
      if (!v) return;
      localStorage.removeItem(spillKey());
      const list = JSON.parse(v);
      if (Array.isArray(list) && list.length) buf = list.concat(buf);
    } catch (e) { /* ignore */ }
  }
  diag._spill = spill;
  /** Writes buffered events to the store. Resolves when written. */
  diag.flush = function () {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!inited || !buf.length) return flushing;
    const batch = buf; buf = [];
    inflight.add(batch);
    flushing = flushing.then(async () => {
      try {
        const st = await diag.store();
        try { await st.put(batch); inflight.delete(batch); } catch (e) {
          if (st.kind !== 'bg') throw e;
          // background gone (extension reloaded/updated): continue in the page-origin store
          backend = await localBackend(); backendP = Promise.resolve(backend);
          await backend.put(batch);
          inflight.delete(batch);
        }
      } catch (e) {
        try { console.warn('[OGX diag] journal write failed', e && e.message); } catch (x) { /* ignore */ }
      }
    });
    return flushing;
  };

  // ------------------------------------------------------------------ network
  const preLearn = diag._preLearn = [];   // [endpoint, observation] seen before OGX.learn exists
  function sameOriginUrl(u) { try { const x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch (e) { return null; } }
  /** cp (planet the request runs on: 2Moons/GALAXYZ ?cp=, OgameX ?cp=) from the query or the urlencoded form body. */
  function cpOf(u, body) {
    let cp = u ? u.searchParams.get('cp') : null;
    if (!cp && body && typeof body === 'string' && !/^\s*[{[]/.test(body)) { try { cp = new URLSearchParams(body).get('cp'); } catch (e) { /* ignore */ } }
    return cp && /^\d{1,12}$/.test(cp) ? +cp : null;
  }
  diag._cpOf = cpOf;
  function netEvent({ method, url, finalUrl, status, ms, size, error, json, keys, safe, body, by }) {
    // url = the URL as requested (with cp); finalUrl = where a redirect ended (2Moons drops cp when it redirects)
    const u = sameOriginUrl(url);
    if (!u) return;
    const m = String(method || 'GET').toUpperCase();
    let ep = m + ' ' + L.normalizePath(u.pathname);
    // GALAXYZ: every request is /<Universe>/game.php -> the endpoint is page (+ mode) from the query or the form body
    if (/\/game\.php$/i.test(u.pathname)) {
      let pg = u.searchParams.get('page'); let md = u.searchParams.get('mode');
      if ((!pg || !md) && body) { try { const b = new URLSearchParams(String(body)); pg = pg || b.get('page'); md = md || b.get('mode'); } catch (e) { /* ignore */ } }
      ep += '?page=' + (pg || 'overview') + (md ? '&mode=' + md : '');
    }
    const d = { st: status, ms: Number.isFinite(ms) ? Math.round(ms) : null, sz: Number.isFinite(size) ? size : null, by };
    const cp = cpOf(u, body);
    if (cp !== null) d.cp = cp;
    if (u.search) d.q = L.redactUrl(u.search).replace(/^\//, '');
    if (finalUrl && finalUrl !== url) {
      const f = sameOriginUrl(finalUrl);
      if (f && (f.pathname + f.search) !== (u.pathname + u.search)) d.to = L.redactUrl(f.pathname + f.search);
    }
    if (m !== 'GET' && body) { const f = L.formSummary(body); if (f) d.f = f; }
    const sf = safe !== undefined ? safe : L.safeFields(json);
    if (sf) d.r = sf;
    if (error) d.err = String(error).slice(0, 200);
    OGX.log.rec('N', 'req', ep, d);
    try {
      const obs = { status, json: keys ? undefined : json, keys: keys || (json ? undefined : null), kind: L.responseKind(status, json || (safe ? Object.assign({}, safe) : null)) };
      // the page hook replays its queue on 'ogx:net-ready' below, before 23-learn.js has loaded: keep those for learn (it drains diag._preLearn)
      if (OGX.learn && OGX.learn.api) OGX.learn.api(ep, obs);
      else if (preLearn.length < 500) preLearn.push([ep, obs]);
    } catch (e) { /* never break */ }
    if (status === 401 || (status === 419 && by === 'page')) OGX.log.rec('S', 'session', status === 401 ? 'logged-out' : 'csrf-expired', { ep });
  }
  /** Called by OGX.http for every request it makes (core 12-http). */
  diag._ogxNet = function (info) { try { netEvent(Object.assign({ by: 'ogx' }, info)); } catch (e) { /* ignore */ } };
  function onPageNet(ev) {
    if (typeof ev.detail !== 'string') return;
    let x;
    try { x = JSON.parse(ev.detail); } catch (e) { return; }
    netEvent({ method: x.m, url: x.u, status: x.st, ms: x.ms, size: x.sz, error: x.err, keys: Array.isArray(x.keys) ? x.keys : null, safe: x.safe || null, body: x.b, by: 'page' });
  }
  // The game's requests are journaled from the moment this file loads, not from diag.init: OGX.boot is async (gate,
  // storage, settings) and the game sends its first requests (/ajax/galaxy, /ajax/fleet/templates, check-target, ...)
  // while it waits. Before init the events wait in the pre-init buffer (PRE_INIT_MAX; dropped if boot is gated) and the
  // learn.api observations in its pendingApi. The page hook (0.3.0+) queues ogx:net events until it sees 'ogx:net-ready'
  // and then replays them, so even requests made before the content scripts ran are kept.
  try { const m = document.querySelector('meta[name="csrf-token"]'); if (m) L.addSecret(m.getAttribute('content')); } catch (e) { /* ignore */ }
  try {
    document.addEventListener('ogx:net', onPageNet);
    document.dispatchEvent(new CustomEvent('ogx:net-ready', { detail: '1' }));
  } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ game messages (G)
  let lastG = { text: '', t: 0 };
  function gameMessage(kind, text, data) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t === '-' || t === '.') return;
    const now = Date.now();
    if (t === lastG.text && now - lastG.t < 400) return;
    lastG = { text: t, t: now };
    OGX.log.rec('G', kind, t.slice(0, 300), data);
  }
  function watchGameMessages() {
    const watchText = (id, kind, extra) => {
      const el = document.getElementById(id);
      if (!el) return;
      const mo = new MutationObserver(() => { try { gameMessage(kind, el.textContent, extra ? extra() : undefined); } catch (e) { /* ignore */ } });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    };
    watchText('fadeBoxContent', 'fadeBox', () => {
      const st = document.getElementById('fadeBoxStyle');
      return { failed: !!(st && /failed/.test(st.className)) };
    });
    // OgameX also uses errorBoxNotify for success messages (logout, jump gate): only a box whose head is the game's
    // LocalizationStrings.error text is a failure; otherwise the head is kept and the event is not counted as an error.
    watchText('errorBoxNotifyContent', 'notify', () => {
      const head = ((document.getElementById('errorBoxNotifyHead') || {}).textContent || '').replace(/\s+/g, ' ').trim() || null;
      const d = { head };
      if (head && errorHeads().has(head.toLowerCase())) d.failed = true;
      return d;
    });
    watchText('errorBoxDecisionContent', 'decision', () => ({ head: (document.getElementById('errorBoxDecisionHead') || {}).textContent || null }));
    const nc = document.querySelector('notification-container');
    if (nc) {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const cls = String(n.className || '');
          const msg = n.querySelector ? n.querySelector('notification-message') : null;
          gameMessage('notification', (msg || n).textContent, { type: cls.replace(/^notification-/, '') || null, failed: /error|warning/.test(cls) });
        }
      });
      mo.observe(nc, { childList: true });
    }
  }
  diag._gameMessage = gameMessage;
  // 'Error' in every OgameX locale (resources/lang/*/t_ingame.php shared.error) + the page's LocalizationStrings.error.
  const ERROR_HEADS = ['Error', 'Erreur', 'Errore', 'Fout', '錯誤'];
  let errorHeadSet = null;
  function errorHeads() {
    if (errorHeadSet) return errorHeadSet;
    errorHeadSet = new Set(ERROR_HEADS.map((x) => x.toLowerCase()));
    try {
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const t = sc.textContent || '';
        const i = t.indexOf('LocalizationStrings');
        if (i < 0) continue;
        const m = /"error"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(t.slice(i, i + 20000));
        if (m) { const v = JSON.parse(m[1]); if (v) errorHeadSet.add(String(v).trim().toLowerCase()); break; }
      }
    } catch (e) { /* ignore */ }
    return errorHeadSet;
  }
  diag._errorHeads = () => Array.from(errorHeads());

  // ------------------------------------------------------------------ user clicks in our UI (U)
  function ourEl(el) {
    for (let x = el, i = 0; x && x.nodeType === 1 && i < 25; x = x.parentElement, i++) {
      if ((x.id && /^ogx-/.test(x.id)) || (typeof x.className === 'string' && /(^|\s)ogx-/.test(x.className))) return x;
    }
    return null;
  }
  function moduleOf(el) {
    for (let x = el, i = 0; x && x.nodeType === 1 && i < 25; x = x.parentElement, i++) {
      const m = /(?:^|\s)ogx-([li])-([a-z0-9]+)/.exec(typeof x.className === 'string' ? x.className : '') || /^ogx-([li])-([a-z0-9]+)/.exec(x.id || '');
      if (m) return (m[1] === 'l' ? 'live/' : 'infinity/') + m[2];
    }
    return null;
  }
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  function labelOf(el) {
    const a = el.getAttribute('data-ogx-act') || el.getAttribute('aria-label') || el.getAttribute('title');
    if (a) return a.slice(0, 80);
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 60) : el.tagName.toLowerCase();
  }
  function onClick(ev) {
    const t = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    if (!t || !ourEl(t)) return;
    const el = t.closest('button, a, [role="button"], [data-ogx-act], .ogx-btn, input[type="checkbox"], input[type="radio"], summary, th, .ogx-tab') || t;
    if (el.matches && el.matches('input[type="checkbox"], input[type="radio"]')) return; // recorded by 'change'
    OGX.log.rec('U', 'click', labelOf(el), { el: describe(el), mod: moduleOf(el) });
  }
  function onChange(ev) {
    const el = ev.target;
    if (!el || el.nodeType !== 1 || !ourEl(el) || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const name = el.name || el.getAttribute('data-key') || (el.closest('[data-key]') && el.closest('[data-key]').getAttribute('data-key')) || el.id || '';
    const d = { el: describe(el), mod: moduleOf(el) };
    if (el.type === 'checkbox' || el.type === 'radio') d.v = !!el.checked;
    else if (el.tagName === 'SELECT' || el.type === 'number' || el.type === 'range') d.v = L.isSensitiveKey(name) ? '<redacted>' : String(el.value).slice(0, 40);
    else d.len = String(el.value || '').length; // free text (notes, search) is never stored
    OGX.log.rec('U', 'change', name || labelOf(el), d);
  }

  // ------------------------------------------------------------------ errors
  const OURS = /chrome-extension:|moz-extension:|safari-web-extension:|ogx-inject:|\/shared\/core\/|\/modules\/[a-z]+\/|userscript|\.user\.js|\[OGX/i;
  diag._ours = (stack) => OURS.test(String(stack || ''));
  function onError(ev) {
    try {
      const err = ev && ev.error;
      const where = (err && err.stack) || (ev && ev.filename) || '';
      if (!OURS.test(where)) return;
      OGX.log.create('uncaught').error(err || (ev && ev.message));
    } catch (e) { /* ignore */ }
  }
  function onRejection(ev) {
    try {
      const r = ev && ev.reason;
      if (!r || !OURS.test(String(r.stack || ''))) return;
      OGX.log.create('rejection').error(r);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ snapshots
  /** Sanitized HTML of a document: no scripts, no input values, no tokens/emails; our own elements kept. */
  diag.sanitizeDom = function (doc = document) {
    const root = doc.documentElement.cloneNode(true);
    // <template> contents are separate fragments: sanitize them too (recursively)
    const roots = [root];
    for (let i = 0; i < roots.length && i < 500; i++) for (const t of Array.from(roots[i].querySelectorAll('template'))) if (t.content) roots.push(t.content);
    for (const r of roots) sanitizeTree(r);
    return L.redactString('<!doctype html>\n' + root.outerHTML, 0);
  };
  function sanitizeTree(root) {
    // commented-out markup may hold scripts with tokens: drop comments that contain tags
    try {
      const doc = root.ownerDocument || document;
      const tw = doc.createTreeWalker(root, 128 /* SHOW_COMMENT */);
      const drop = [];
      for (let n = tw.nextNode(); n; n = tw.nextNode()) if (/<[a-z!/]/i.test(n.data)) drop.push(n);
      for (const n of drop) n.replaceWith(doc.createComment(' ogx: commented-out markup removed '));
    } catch (e) { /* ignore */ }
    for (const s of Array.from(root.querySelectorAll('script'))) { const src = s.getAttribute('src'); s.textContent = ''; for (const a of Array.from(s.attributes)) if (a.name !== 'src' && a.name !== 'type') s.removeAttribute(a.name); if (!src) s.setAttribute('data-ogx-stripped', 'inline'); }
    for (const el of Array.from(root.querySelectorAll('input'))) { if (el.type === 'hidden' || el.hasAttribute('value')) el.setAttribute('value', el.type === 'checkbox' || el.type === 'radio' ? (el.getAttribute('value') || '') : ''); }
    for (const el of Array.from(root.querySelectorAll('textarea'))) el.textContent = '';
    for (const el of Array.from(root.querySelectorAll('iframe[srcdoc]'))) el.removeAttribute('srcdoc');
    for (const m of Array.from(root.querySelectorAll('meta[name="csrf-token"], meta[name*="token" i]'))) m.setAttribute('content', '<csrf>');
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name) && /token|csrf/i.test(a.value)) el.setAttribute(a.name, '<redacted>');
        else if (L.isSensitiveKey(a.name.replace(/^data-/, ''))) el.setAttribute(a.name, '<redacted>');
        else if (/^(href|src|action|data-url|data-href)$/i.test(a.name) && /[?&](_token|token|csrf)/i.test(a.value)) el.setAttribute(a.name, L.redactUrl(a.value, location.href));
      }
    }
  }
  let lastSnapT = 0;
  /** Stores a sanitized snapshot of the current page. reason: free text (alert keys). -> Promise<id|null> */
  diag.snapshot = async function (reason, { force = false } = {}) {
    if (!inited) return null;
    if (!force && !setting('snapshots')) return null;
    const now = Date.now();
    if (!force && now - lastSnapT < 30000) return null;
    lastSnapT = now;
    let html;
    try { html = diag.sanitizeDom(document); } catch (e) { OGX.log.rec('S', 'error', 'snapshot', { msg: String(e && e.message || e) }); return null; }
    const snap = { t: now, page: pageName(), reason: String(reason || 'manual').slice(0, 500), url: L.redactUrl(location.pathname + location.search), host: location.host, x: OGX.ext, html };
    try {
      const st = await diag.store();
      const id = await st.putSnap(snap);
      OGX.log.rec('S', 'snapshot', snap.reason.slice(0, 120), { id, size: html.length });
      return id;
    } catch (e) { return null; }
  };

  // ------------------------------------------------------------------ context (header of the export)
  diag.context = async function () {
    const ctx = { t: Date.now(), ext: OGX.ext, extName: extName(), extVersion: null, coreVersion: OGX.version, host: location.host, page: pageName() };
    try { ctx.engine = OGX.page.engine || null; const i = OGX.page.info(); if (i.raw) ctx.gzPage = i.raw + (i.mode ? '&mode=' + i.mode : ''); if (i.universe) ctx.universe = i.universe; } catch (e) { /* ignore */ }
    try { const mf = chrome.runtime.getManifest(); ctx.extVersion = mf.version; } catch (e) { /* userscript */ }
    try { if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) ctx.extVersion = ctx.extVersion || GM_info.script.version; } catch (e) { /* ignore */ }
    try { ctx.ua = navigator.userAgent; } catch (e) { /* ignore */ }
    try { const p = await OGX.state.player(); ctx.playerId = p && p.id || (OGX.storage.ns && OGX.storage.ns.playerId); ctx.playerClass = p && p.playerClass || null; } catch (e) { ctx.playerId = OGX.storage && OGX.storage.ns && OGX.storage.ns.playerId; }
    try {
      const s = await OGX.state.server();
      if (s) {
        const keep = ['engine', 'version', 'universeName', 'economySpeed', 'researchSpeed', 'fleetSpeed', 'fleetSpeedWar', 'fleetSpeedHolding', 'fleetSpeedPeaceful', 'galaxies', 'systems',
          'debrisFleetPct', 'debrisDefensePct', 'debrisDeuterium', 'acs', 'ignoreEmpty', 'ignoreInactive', 'planetFieldBonus', 'darkMatterBonus', 'tzOffsetMs', 'settingsT'];
        ctx.server = {};
        for (const k of keep) if (s[k] !== undefined) ctx.server[k] = s[k];
        if (s.universeName) ctx.universe = s.universeName;
        if (s.version) ctx.engineVersion = s.version;
      }
    } catch (e) { /* ignore */ }
    // GALAXYZ universe constants the calculations use (mechanics.md §0): the resource speed is not in state.server
    try { if (OGX.page.isGz && OGX.page.isGz() && OGX.calc && OGX.calc.gz) ctx.resourceMultiplier = OGX.calc.gz.resourceMultiplier; } catch (e) { /* ignore */ }
    try {
      const active = new Set((OGX._ctxs || []).map((c) => c.def.name));
      ctx.modules = Object.keys(OGX.modules).map((name) => {
        const all = OGX.settings.all(name) || {};
        const settings = Object.assign({}, all); delete settings.enabled;
        const sec = OGX._sectionOf && OGX._sectionOf[name];
        let enabled = all.enabled !== false;
        try { if (typeof OGX._moduleOn === 'function') enabled = OGX._moduleOn(name); } catch (e) { /* ignore */ }
        return { name: sec ? sec + '/' + name : name, enabled, active: active.has(name), settings: L.redact(settings, { maxStr: 60 }) };
      });
    } catch (e) { /* ignore */ }
    try { ctx.core = OGX.settings.all('core'); ctx.diag = OGX.settings.all('diag'); } catch (e) { /* ignore */ }
    // Suite: popup-level switches (host allow-list '*|*|suite.hosts', global module switches '*|*|suite.modules').
    try {
      const S = OGX.suite;
      if (S) {
        if (Array.isArray(S.allowHosts)) ctx.allowHosts = S.allowHosts.slice(0, 50);
        if (S.globalOff) ctx.globalOff = Array.from(S.globalOff).slice(0, 100);
      }
    } catch (e) { /* ignore */ }
    try { const st = await diag.store(); ctx.storeKind = st.kind; } catch (e) { ctx.storeKind = 'none'; }
    return ctx;
  };
  /** Saves the context to 'diag.ctx' (player scope) so the popup can build the export header. */
  diag.publishContext = async function () {
    try { const c = await diag.context(); await OGX.storage.set('diag.ctx', c); return c; } catch (e) { return null; }
  };

  // ------------------------------------------------------------------ export
  /** Backend for OGXDiagPanel (shared/popup/diag-panel.js) inside the game page (Infinity side panel, userscript). */
  diag.backend = function () {
    const st = () => diag.store();
    return {
      where: 'page',
      kind: () => (backend ? backend.kind : '?'),
      flush: () => diag.flush(),
      stats: async () => { await diag.flush(); return (await st()).stats(); },
      query: async (q) => { await diag.flush(); return (await st()).query(q); },
      snaps: async (q) => (await st()).snaps(q),
      getMeta: async (k) => (await st()).getMeta(k),
      setMeta: async (k, v) => (await st()).setMeta(k, v),
      clear: async () => { buf = []; recent.length = 0; await diag.flush(); return (await st()).clear(); },
      context: () => diag.context(),
      learnState: async () => (OGX.learn && OGX.learn.state ? OGX.learn.state() : null),
      extras: () => diag.extras(),
      snapshotNow: () => diag.snapshot('manual', { force: true }),
    };
  };
  /** Raw settings (player + server scope 'settings') and bot data for the one-file export: the live bot status, queue,
   * recent actions and bot journal (OGX.bot, when the bot section is loaded) plus the stored bot keys ('bot.*', 'botcore.*',
   * 'botsave.*', ... — one prefix per bot module). */
  diag.extras = async function () {
    const out = { settings: null, bot: {} };
    const botPrefixes = ['bot.', 'botcore.', 'botsim.', 'botpanel.', 'botsave.', 'botfarm.', 'botdebris.', 'botbuild.', 'botexpo.'];
    const B = OGX.bot;
    if (B && typeof B.status === 'function') {
      try {
        const st = B.status();
        if (st) {
          const live = Object.assign({}, st);
          delete live.queue;
          out.bot.status = live;
          out.bot.queue = Array.isArray(st.queue) ? st.queue : [];
        }
      } catch (e) { out.bot.status = { error: String(e && e.message || e) }; }
      try { if (typeof B.recentActions === 'function') out.bot.recentActions = B.recentActions(50); } catch (e) { /* ignore */ }
      try { if (typeof B.recentLines === 'function') out.bot.journal = B.recentLines(200); } catch (e) { /* ignore */ }
    }
    try {
      const f = await OGX.storage.exportAll({ scopes: ['player', 'server'], prefixes: ['settings', ...botPrefixes] });
      const d = f && f.data || {};
      out.settings = { player: (d.player || {}).settings || null, server: (d.server || {}).settings || null };
      for (const sc of ['player', 'server']) for (const [k, v] of Object.entries(d[sc] || {})) if (botPrefixes.some((x) => k.startsWith(x))) out.bot[sc + ':' + k] = v;
    } catch (e) { /* storage not ready */ }
    return out;
  };
  /** Builds an export in the page. what: 'full' | 'new' | 'today' | 'last' | 'jsonl' | 'snaps' | 'learn'. -> { text, filename, mime, info } */
  diag.export = function (what, opts = {}) { return L.exportData(diag.backend(), what, opts); };
  /** Builds and downloads an export (Blob + <a download>). */
  diag.download = async function (what, opts = {}) {
    const r = await diag.export(what, opts);
    if (r && r.text) L.download(r.filename, r.text, r.mime);
    return r;
  };
  /** Mounts the "Логи для разбора" panel (OGXDiagPanel) into a container, e.g. a side panel tab. */
  diag.mountPanel = function (container, opts = {}) {
    const P = (typeof self !== 'undefined' && self.OGXDiagPanel) || window.OGXDiagPanel;
    if (!P) { container.textContent = 'Панель диагностики не загружена (shared/popup/diag-panel.js).'; return null; }
    return P.mount(container, Object.assign({ backend: diag.backend(), title: 'Логи для разбора', settingsNode: OGX.dom && OGX.dom.settingsForm ? () => OGX.dom.settingsForm(['diag']) : null }, opts));
  };
  /** Adds the tab "Логи" to a side panel (OGX.dom.sidePanel). */
  diag.addPanelTab = function (panel, { order = 900 } = {}) {
    if (!panel || !panel.addTab) return null;
    return panel.addTab({ id: 'diag', label: 'Логи', order, render: (c) => diag.mountPanel(c) });
  };

  // ------------------------------------------------------------------ init (OGX.boot, after storage and settings)
  diag.init = function (snap) {
    if (inited) return;
    inited = true;
    try { L.addSecret(OGX.http && OGX.http.csrf ? OGX.http.csrf() : null); } catch (e) { /* ignore */ }
    try { if (snap && snap.csrf) L.addSecret(snap.csrf); } catch (e) { /* ignore */ }
    unspill();
    if (!setting('journal')) { buf = []; } else if (!setting('network')) { buf = buf.filter((e) => e.s !== 'N'); }
    // page load
    const d = { path: L.redactUrl(location.pathname + location.search) };
    try { if (document.referrer) { const r = sameOriginUrl(document.referrer); d.ref = r ? L.redactUrl(r.pathname + r.search) : 'external'; } } catch (e) { /* ignore */ }
    try { const n = performance.getEntriesByType('navigation')[0]; if (n) { d.nav = n.type; d.domMs = Math.round(n.domContentLoadedEventEnd || 0); } } catch (e) { /* ignore */ }
    try { d.player = snap && snap.player ? snap.player.id : null; d.body = snap && snap.current ? snap.current.key : null; } catch (e) { /* ignore */ }
    try {
      if (snap && snap.engine === 'galaxyz') {
        d.engine = 'galaxyz'; d.gz = snap.gzPage + (snap.mode ? '&mode=' + snap.mode : '') + (snap.step ? ' step ' + snap.step : '');
        d.events = (snap.events || []).length; d.anchor = snap.renderUnix ? 'event' : 'none';
        if (snap.info) d.info = true;
      }
    } catch (e) { /* ignore */ }
    OGX.log.rec('S', 'page', pageName(), d);
    // GALAXYZ shows results and errors as info pages (.headerRS + .mainRS p), not as fadeBox: journal the text as G 'info'
    try { if (snap && snap.infoMessage) gameMessage('info', snap.infoMessage, { page: snap.gzPage, failed: snap.gzPage !== 'fleetstep3' }); } catch (e) { /* ignore */ }
    // listeners
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    try { watchGameMessages(); } catch (e) { /* ignore */ }
    const t0 = Date.now();
    window.addEventListener('pagehide', () => {
      try { OGX.log.rec('S', 'leave', pageName(), { stayMs: Date.now() - t0 }); } catch (e) { /* ignore */ }
      if (!spill()) diag.flush();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) diag.flush(); });
    try { if (OGX.settings.onChange) OGX.settings.onChange('*', OGX.util.debounce(() => { diag.publishContext(); }, 2000)); } catch (e) { /* ignore */ }
    schedule();
  };
  diag.isInited = () => inited;
  /**
   * diag.recordGated(reason, data?) — boot was refused by the gate (e.g. the host is not in the popup allow-list) on an
   * OgameX page. Drops everything buffered on this page and sends ONE S 'gated' event (host + reason, no page data) to
   * the extension's background journal only. Nothing touches the page's storage: the once per host and reason guard
   * (GATED_EVERY_MS) is a meta key of the background journal, plus an in-memory flag for this page.
   */
  const GATED_EVERY_MS = 30 * 60 * 1000;
  let gatedSent = false;
  diag.recordGated = function (reason, data) {
    buf = []; recent.length = 0;
    if (gatedSent) return Promise.resolve(false);
    gatedSent = true;
    try {
      const why = String(reason || 'gate').slice(0, 80);
      const host = L.redactString(location.host, 120);
      const mk = 'gated|' + host + '|' + why;
      return sendMsg({ type: 'ogx:diag:meta', k: mk }, 3000).then((m) => {
        if (!m || !m.ok) return false;
        if (+m.v > 0 && Date.now() - +m.v < GATED_EVERY_MS) return false;
        const ev = { t: Date.now(), s: 'S', k: 'gated', w: host, p: null, x: OGX.ext || null, tab: tab() };
        ev.d = Object.assign({ reason: why }, data ? L.redact(data, { maxStr: 120 }) : {});
        return sendMsg({ type: 'ogx:diag:meta', k: mk, v: ev.t }, 3000)
          .then(() => sendMsg({ type: 'ogx:diag:put', events: [ev] }, 3000))
          .then((r) => !!(r && r.ok));
      }, () => false);
    } catch (e) { return Promise.resolve(false); }
  };

  // ------------------------------------------------------------------ core actions recorded as B
  // The guarded action helpers are wrapped so every add-on action (and later every bot action) shows up in the journal.
  if (OGX.api) {
    for (const name of ['sendFleet', 'sendMiniFleet', 'recall', 'addBuild', 'deleteMessage']) {
      if (typeof OGX.api[name] === 'function' && !OGX.api[name].__ogxWrapped) {
        const w = OGX.log.wrap('api', OGX.api[name], name);
        w.__ogxWrapped = true;
        OGX.api[name] = w;
      }
    }
  }
})(window.OGX);
