/* shared/main/page-hook.js — MAIN world, document_start. XHR relay (ogx:xhr), network journal (ogx:net: every same-origin
 * fetch/XHR of the game with method, url, status, duration, size, error, JSON key schema and small safe fields — never the
 * body) and command bridge (ogx:call/ogx:reply).
 * Owner: core. Idempotent (ogx:hook-probe; window.__ogxHook only on game pages): with both extensions installed the first one serves both.
 * Harmless elsewhere: fetch/XHR are patched only once the page is a game page (patchWhenGame); other sites keep native ones.
 * GALAXYZ (ogamex.eu, meta generator "GALAXYZ ..." + /game.php): relays the game's jQuery XHRs of whitelisted
 * ?page=[&mode=] (details panels, fleetAjax, messages view/action, checkTarget); page-world method gz.globals.
 * All CustomEvent details are strings (objects do not cross worlds in Firefox). */
(function () {
  'use strict';
  // Idempotency without a global on every site: an installed hook answers the synchronous 'ogx:hook-probe' event (same MAIN
  // world, so the detail object is shared). window.__ogxHook (older hooks check it too) is defined only once the page is known
  // to be a game page (lazy isGamePage(), see ensureMarker); on other sites nothing is exposed and ogx:call is not answered.
  if (window.__ogxHook) return;
  try {
    const probe = { found: false };
    document.dispatchEvent(new CustomEvent('ogx:hook-probe', { detail: probe }));
    if (probe.found) return;
  } catch (e) { /* ignore */ }
  const VERSION = '0.4.0';
  try { document.addEventListener('ogx:hook-probe', function (ev) { try { if (ev.detail && typeof ev.detail === 'object') ev.detail.found = true; } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  let marked = false;
  function ensureMarker() {
    if (marked) return;
    marked = true;
    try { Object.defineProperty(window, '__ogxHook', { value: { version: VERSION }, configurable: false, enumerable: false }); } catch (e) { try { window.__ogxHook = { version: VERSION }; } catch (x) { /* ignore */ } }
  }

  const WHITELIST = [
    /^\/ajax\/galaxy$/,
    /^\/ajax\/fleet\/dispatch\/(check-target|send-fleet|send-mini-fleet|recall-fleet)$/,
    /^\/ajax\/fleet\/eventlist\/fetch$/,
    /^\/ajax\/fleet\/eventbox\/fetch$/,
    /^\/ajax\/messages(\/\d+)?$/,
    /^\/ajax\/highscore$/,
    /^\/ajax\/search$/,
    /^\/ajax\/(resources|facilities|research|shipyard|defense)$/,
    /^\/(resources|facilities|research|shipyard|defense)\/add-buildrequest$/,
  ];
  // GALAXYZ: game.php?page=<name>[&mode=<mode>] (page/mode may also come in a POST body)
  const GZ_WHITELIST = [
    /^page=(technologydetailsajax|researchdetailsajax|shipdetailsajax|commanderdetailsajax)(&|$)/,
    /^page=fleetajax(&|$)/,
    /^page=messages&mode=(view|action)$/,
    /^page=fleetstep1&mode=checktarget$/,
  ];
  const isGz = () => {
    try {
      const m = document.querySelector('meta[name="generator"]');
      return !!m && /^(GALAXYZ|2Moons)\b/i.test(m.getAttribute('content') || '') && /\/game\.php$/i.test(location.pathname);
    } catch (e) { return false; }
  };
  // Positive answers are cached (a game page stays one); negative ones are re-checked (metas may not be parsed yet at document_start).
  let gameKnown = false;
  const isGamePage = () => {
    if (gameKnown) return true;
    try { gameKnown = !!document.querySelector('meta[name="ogame-version"]') || isGz(); } catch (e) { gameKnown = false; }
    if (gameKnown) ensureMarker();
    return gameKnown;
  };
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { isGamePage(); }, { once: true });
    else isGamePage();
  } catch (e) { /* ignore */ }
  function gzRoute(u, body) {
    let p = u.searchParams.get('page'); let m = u.searchParams.get('mode');
    if ((!p || !m) && typeof body === 'string' && body) {
      try { const b = new URLSearchParams(body); p = p || b.get('page'); m = m || b.get('mode'); } catch (e) { /* not a form */ }
    }
    return 'page=' + String(p || 'overview').toLowerCase() + (m ? '&mode=' + String(m).toLowerCase() : '');
  }
  function relayable(url, body) {
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return false;
      const p = u.pathname.replace(/\/+$/, '');
      if (/\/game\.php$/i.test(p)) return isGz() && GZ_WHITELIST.some((re) => re.test(gzRoute(u, body)));
      return WHITELIST.some((re) => re.test(p));
    } catch (e) { return false; }
  }
  function bodyString(b) {
    if (b === undefined || b === null) return null;
    if (typeof b === 'string') return b;
    try {
      if (b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        const u = new URLSearchParams();
        for (const [k, v] of b.entries()) if (typeof v === 'string') u.append(k, v);
        return u.toString();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------------ network journal (ogx:net)
  // Requests made by OGX itself carry the header X-OGX and are journaled by OGX.http instead.
  function sameOrigin(url) { try { const u = new URL(url, location.href); return u.origin === location.origin ? u : null; } catch (e) { return null; } }
  function hasOgxHeader(h) {
    try {
      if (!h) return false;
      if (typeof Headers !== 'undefined' && h instanceof Headers) return h.has('X-OGX');
      if (Array.isArray(h)) return h.some((p) => p && String(p[0]).toLowerCase() === 'x-ogx');
      return Object.keys(h).some((k) => k.toLowerCase() === 'x-ogx');
    } catch (e) { return false; }
  }
  // Same algorithm as OGXDiagLib.jsonSchema (shared/core/21-diaglib.js): keep them identical.
  function jsonSchema(json, maxDepth = 3, max = 200) {
    const out = new Set();
    const walk = (v, prefix, depth) => {
      if (out.size >= max || depth > maxDepth || v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) {
        const first = v.find((e) => e !== null && typeof e === 'object');
        if (first !== undefined) walk(first, prefix + '[]', depth + 1);
        return;
      }
      for (const k of Object.keys(v)) {
        if (out.size >= max) return;
        const key = /^-?\d+$/.test(k) ? '#' : k;
        const path = prefix ? prefix + '.' + key : key;
        out.add(path);
        walk(v[k], path, depth + 1);
      }
    };
    try { walk(json, '', 1); } catch (e) { /* ignore */ }
    return Array.from(out).sort();
  }
  function safeFields(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const o = {};
    for (const k of ['success', 'status', 'result', 'message', 'error', 'code']) if (j[k] !== undefined && j[k] !== null && typeof j[k] !== 'object') o[k] = typeof j[k] === 'string' ? j[k].slice(0, 200) : j[k];
    if (j.newAjaxToken !== undefined) o.newAjaxToken = '<redacted>';
    if (Array.isArray(j.errors)) o.errors = j.errors.slice(0, 5).map((e) => String(typeof e === 'string' ? e : e && (e.message || e.error) || JSON.stringify(e)).slice(0, 200));
    else if (j.errors && typeof j.errors === 'object') o.errors = Object.keys(j.errors).slice(0, 10);
    if (j.response && typeof j.response === 'object') { const r = safeFields(j.response); if (r) o.response = r; }
    return Object.keys(o).length ? o : null;
  }
  function emitNet(info, st, text, sizeHint, err) {
    try {
      if (!isGamePage()) return;
      const d = { m: info.m, u: info.u, st, ms: Date.now() - info.t0, sz: typeof text === 'string' ? text.length : sizeHint, err: err || null, b: info.b ? String(info.b).slice(0, 4000) : null };
      if (typeof text === 'string' && /^\s*[{[]/.test(text)) {
        try { const j = JSON.parse(text); d.keys = jsonSchema(j); d.safe = safeFields(j); } catch (e) { /* not json */ }
      }
      const detail = JSON.stringify(d);
      if (netReady) document.dispatchEvent(new CustomEvent('ogx:net', { detail }));
      else if (netQueue.length < NET_QUEUE_MAX) netQueue.push(detail);
    } catch (e) { /* never break the game */ }
  }
  // Requests sent before the isolated world listens (content scripts run at document_end, OGX.boot is async) are queued
  // and replayed once 22-diag.js dispatches 'ogx:net-ready'.
  const NET_QUEUE_MAX = 300;
  let netReady = false;
  const netQueue = [];
  document.addEventListener('ogx:net-ready', function () {
    if (netReady) return;
    netReady = true;
    for (const detail of netQueue.splice(0)) {
      try { document.dispatchEvent(new CustomEvent('ogx:net', { detail })); } catch (e) { /* ignore */ }
    }
  });
  // fetch / XHR are patched only on a game page (patchWhenGame below): other sites keep their native fetch and XHR, and their
  // XHR instances get no expando.
  function patchFetch() {
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    const wrapped = function (input, init) {
      let info = null;
      try {
        const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
        const u = isGamePage() ? sameOrigin(url) : null;   // other sites: untouched (no clone, no listener)
        if (u && !hasOgxHeader(init && init.headers) && !hasOgxHeader(input && input.headers)) {
          info = { m: String((init && init.method) || (input && input.method) || 'GET').toUpperCase(), u: u.toString(), t0: Date.now(), b: bodyString(init && init.body) };
        }
      } catch (e) { info = null; }
      const p = origFetch.apply(this, arguments);
      if (!info) return p;
      try {
        p.then((res) => {
          try {
            const ct = String(res.headers.get('content-type') || '');
            const cl = +res.headers.get('content-length') || null;
            if (/json|text\/plain/i.test(ct) && res.type !== 'opaque') {
              res.clone().text().then((t) => emitNet(info, res.status, t, cl), () => emitNet(info, res.status, null, cl));
            } else emitNet(info, res.status, null, cl);
          } catch (e) { /* ignore */ }
        }, (e) => emitNet(info, 0, null, null, String(e && e.name === 'AbortError' ? 'aborted' : e && e.message || e)));
      } catch (e) { /* ignore */ }
      return p;
    };
    try { window.fetch = wrapped; } catch (e) { /* read-only */ }
  }
  }

  // ------------------------------------------------------------------ XHR relay
  function patchXhr() {
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (method, url) {
      try { this.__ogx = { method: String(method || 'GET').toUpperCase(), url: String(url) }; } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };
    const origSetHeader = XHR.setRequestHeader;
    XHR.setRequestHeader = function (name) {
      try { if (this.__ogx && String(name).toLowerCase() === 'x-ogx') this.__ogx.ours = true; } catch (e) { /* ignore */ }
      return origSetHeader.apply(this, arguments);
    };
    XHR.send = function (body) {
      try {
        const info = this.__ogx;
        const u = info && !info.ours && isGamePage() ? sameOrigin(info.url) : null;
        if (u) {
          const net = { m: info.method, u: u.toString(), t0: Date.now(), b: bodyString(body) };
          const x = this;
          this.addEventListener('loadend', function () {
            let text = null;
            try { text = x.responseType === '' || x.responseType === 'text' ? x.responseText : x.responseType === 'json' ? JSON.stringify(x.response) : null; } catch (e) { text = null; }
            emitNet(net, x.status, text, null, x.status === 0 ? 'network error/aborted' : null);
          });
        }
      } catch (e) { /* ignore */ }
      try {
        const info = this.__ogx;
        if (info && relayable(info.url, bodyString(body))) {
          info.body = bodyString(body);
          const xhr = this;
          this.addEventListener('load', function () {
            // after the game's own callback (handlers registered before send run first; the timeout makes it certain)
            setTimeout(function () {
              try {
                if (!isGamePage()) return;
                let text = '';
                try { text = xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : (typeof xhr.response === 'string' ? xhr.response : JSON.stringify(xhr.response)); } catch (e) { text = ''; }
                const detail = JSON.stringify({ url: new URL(info.url, location.href).toString(), method: info.method, status: xhr.status,
                  requestBody: info.body, responseText: text, t: Date.now() });
                document.dispatchEvent(new CustomEvent('ogx:xhr', { detail }));
              } catch (e) { /* never break the game */ }
            }, 0);
          });
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }
  }

  /** Patches fetch/XHR once the page is known to be a game page. At document_start the metas are usually not parsed yet: a
   * MutationObserver re-checks on every parsed node until DOMContentLoaded. Its records are delivered at the microtask
   * checkpoint the parser performs before running each parser-inserted script, so the game's own scripts (after the
   * generator / ogame-version meta in <head>) already see the patched fetch/XHR. */
  let patched = false;
  function patchNow() {
    if (patched) return;
    patched = true;
    try { patchFetch(); } catch (e) { /* ignore */ }
    try { patchXhr(); } catch (e) { /* ignore */ }
  }
  (function patchWhenGame() {
    try {
      if (isGamePage()) { patchNow(); return; }
      if (document.readyState !== 'loading' || typeof MutationObserver !== 'function') return;
      const mo = new MutationObserver(function () { if (isGamePage()) { mo.disconnect(); patchNow(); } });
      mo.observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', function () { mo.disconnect(); if (isGamePage()) patchNow(); }, { once: true });
    } catch (e) { /* ignore */ }
  })();

  // ------------------------------------------------------------------ command bridge
  const g = (name) => { try { return window[name]; } catch (e) { return undefined; } };
  const fd = () => g('fleetDispatcher');
  const has = (o, m) => o && typeof o[m] === 'function';
  const clone = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch (e) { return null; } };
  function setInput(sel, value) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = String(value);
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
  }

  // GALAXYZ has no fleetDispatcher: OGX.bridge.call answers 'fleet.*' there in the isolated world (OGX.fleet.gz.bridge); a
  // direct ogx:call on GALAXYZ gets { ok: false, error: 'gz' }.
  const noFd = () => (isGz() ? { ok: false, error: 'gz' } : { ok: false });
  const METHODS = {
    'fleet.state': () => {
      const f = fd();
      if (!f) return noFd();
      return {
        ok: true, shipsToSend: clone(f.shipsToSend), targetPlanet: clone(f.targetPlanet), mission: f.mission, speedPercent: f.speedPercent,
        cargoMetal: f.cargoMetal, cargoCrystal: f.cargoCrystal, cargoDeuterium: f.cargoDeuterium, expeditionTime: f.expeditionTime,
        holdingTime: f.holdingTime, shipsData: clone(f.fleetHelper && f.fleetHelper.shipsData), currentPage: f.currentPage,
      };
    },
    'fleet.selectShips': (ships) => {
      const f = fd();
      if (!f || !has(f, 'selectShips')) return { ok: false };
      if (has(f, 'resetShips')) f.resetShips();
      const clean = {};
      for (const [id, n] of Object.entries(ships || {})) if (+n > 0) clean[id] = Math.floor(+n);
      f.selectShips(clean);
      if (has(f, 'refresh')) f.refresh();
      return { ok: true };
    },
    'fleet.setTarget': (t) => {
      const f = fd();
      if (!f || !t) return { ok: false };
      f.targetPlanet = Object.assign({}, f.targetPlanet || {}, { galaxy: +t.galaxy, system: +t.system, position: +t.position, type: +t.type || 1 });
      if (t.name !== undefined) f.targetPlanet.name = t.name;
      if (has(f, 'setTargetType')) f.setTargetType(+t.type || 1);
      if (has(f, 'refreshTarget')) f.refreshTarget();
      if (has(f, 'updateTarget')) f.updateTarget();
      return { ok: true };
    },
    'fleet.selectMission': (m) => {
      const f = fd();
      if (!f || !has(f, 'selectMission')) return { ok: false };
      f.selectMission(+m);
      return { ok: true };
    },
    'fleet.setCargo': (c) => {
      const f = fd();
      if (!f || !c) return { ok: false };
      const v = (x) => Math.max(0, Math.floor(+x || 0));
      f.cargoMetal = v(c.metal); f.cargoCrystal = v(c.crystal); f.cargoDeuterium = v(c.deuterium);
      setInput('#metal', f.cargoMetal); setInput('#crystal', f.cargoCrystal); setInput('#deuterium', f.cargoDeuterium);
      if (has(f, 'updateCargo')) f.updateCargo();
      if (has(f, 'refresh')) f.refresh();
      return { ok: true };
    },
    'fleet.setSpeed': (pct10) => {
      const f = fd();
      if (!f || !has(f, 'setFleetPercent')) return { ok: false };
      f.setFleetPercent(+pct10);
      return { ok: true };
    },
    'fleet.setDuration': (hours) => {
      const f = fd();
      if (!f) return { ok: false };
      const h = Math.max(0, Math.floor(+hours || 0));
      f.expeditionTime = h; f.holdingTime = h;
      setInput('#expeditiontime', h); setInput('#holdingtime', h);
      if (has(f, 'refresh')) f.refresh();
      return { ok: true };
    },
    'fleet.goStep': (n) => {
      const f = fd();
      if (!f || !has(f, 'switchToPage')) return { ok: false };
      f.switchToPage(+n === 2 ? 'fleet2' : 'fleet1');
      return { ok: true };
    },
    'fleet.submit': () => {
      const f = fd();
      if (!f || !has(f, 'trySubmitFleet2')) return { ok: false };
      f.trySubmitFleet2();
      return { ok: true };
    },
    'galaxy.load': (gal, sys) => {
      const fn = g('loadContentNew');
      if (typeof fn !== 'function') return { ok: false };
      fn(+gal, +sys);
      return { ok: true };
    },
    'galaxy.repair': (fromPos) => {
      const clear = g('clearPosition');
      try { window.inProgress = false; } catch (e) { /* ignore */ }
      const loading = document.getElementById('galaxyLoading');
      if (loading) loading.style.display = 'none';
      if (typeof clear === 'function') for (let p = Math.max(1, +fromPos || 1); p <= 15; p++) { try { clear(p); } catch (e) { /* ignore */ } }
      return { ok: typeof clear === 'function' };
    },
    'resources.live': () => {
      const rb = g('resourcesBar');
      if ((!rb || !rb.resources) && isGz()) return gzResources();
      if (!rb || !rb.resources) return { ok: false };
      const out = { ok: true };
      for (const k of ['metal', 'crystal', 'deuterium', 'energy', 'darkmatter']) {
        const r = rb.resources[k];
        if (r) out[k] = { amount: +r.amount, storage: r.storage !== undefined ? +r.storage : null, production: r.production !== undefined ? +r.production : null };
      }
      return out;
    },
    // GALAXYZ page globals (main.header.tpl + #links script): serverTime is the server WALL clock built in the browser zone
    'gz.globals': () => {
      if (!isGz()) return { ok: false };
      const st = g('serverTime');
      const isDate = st && typeof st.getFullYear === 'function';
      const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? null : +v);
      return {
        ok: true,
        serverWall: isDate ? [st.getFullYear(), st.getMonth(), st.getDate(), st.getHours(), st.getMinutes(), st.getSeconds()] : null,
        serverTimeMs: isDate ? st.getTime() : null, startTime: num(g('startTime')),
        ServerTimezoneOffset: num(g('ServerTimezoneOffset')), queryString: typeof g('queryString') === 'string' ? g('queryString') : null,
        Lang: typeof g('Lang') === 'string' ? g('Lang') : null, vacation: num(g('vacation')), viewShortlyNumber: num(g('viewShortlyNumber')), auth: num(g('auth')),
      };
    },
    ping: () => ({ ok: true, version: VERSION }),
  };

  // GALAXYZ: live header values. Amounts = the ticked text of the cells (data-tooltip-content, '.' thousands), storage and
  // production from the inline resourceTicker({...}) calls (per hour); energy t="free / produced"; DM data-real.
  function gzResources() {
    const out = { ok: true };
    const grp = (s) => { const n = parseInt(String(s || '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
    let src = '';
    try { for (const sc of document.querySelectorAll('script:not([src])')) if (sc.textContent.indexOf('resourceTicker(') >= 0) src += sc.textContent + '\n'; } catch (e) { /* ignore */ }
    const re = /resourceTicker\(\{\s*available:\s*\(?\s*(-?[\d.eE+]+)\s*\)?\s*,\s*limit:\s*\[\s*-?[\d.]+\s*,\s*"?(-?[\d.eE+]+)"?\s*\]\s*,\s*production:\s*"?(-?[\d.eE+]+)"?\s*,\s*valueElem:\s*"current_(\w+)"/g;
    const tick = {};
    let m;
    while ((m = re.exec(src))) tick[m[4]] = { storage: +m[2], production: +m[3] };
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const td = document.getElementById('current_' + k);
      if (!td) continue;
      const live = grp(td.getAttribute('data-tooltip-content'));
      out[k] = { amount: live !== null ? live : +td.getAttribute('data-real'), storage: tick[k] ? tick[k].storage : null, production: tick[k] ? tick[k].production : null };
    }
    const e = document.querySelector('#resTable td.res_current[t]');
    const em = e ? /(-?[\d.]+)\s*\/\s*(-?[\d.]+)/.exec(e.getAttribute('t') || '') : null;
    if (em) out.energy = { amount: grp(em[1]), storage: null, production: grp(em[2]) };
    const dm = document.getElementById('current_darkmatter');
    if (dm) out.darkmatter = { amount: +dm.getAttribute('data-real'), storage: null, production: null };
    return out;
  }

  // Commands are answered on game pages only (checked lazily per call: the isolated world calls after the DOM is parsed).
  document.addEventListener('ogx:call', function (ev) {
    if (!isGamePage()) return;
    let msg;
    try { msg = JSON.parse(ev.detail); } catch (e) { return; }
    if (!msg || msg.id === undefined) return;
    let reply;
    try {
      const fn = METHODS[msg.method];
      if (!fn) reply = { id: msg.id, ok: false, error: 'unknown method ' + msg.method };
      else reply = { id: msg.id, ok: true, result: fn.apply(null, Array.isArray(msg.args) ? msg.args : []) };
    } catch (e) {
      reply = { id: msg.id, ok: false, error: String(e && e.message || e) };
    }
    try { document.dispatchEvent(new CustomEvent('ogx:reply', { detail: JSON.stringify(reply) })); } catch (e) { /* ignore */ }
  });
})();
