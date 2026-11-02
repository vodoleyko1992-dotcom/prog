/* shared/core/13-bridge.js — isolated-world side of the MAIN-world bridge (shared/main/page-hook.js). Owner: core.
 * ogx:xhr (hook -> here) is re-emitted as bus 'xhr' with parsed form fields and JSON; ogx:call/ogx:reply run page-world
 * commands. All event details are JSON strings.
 * GALAXYZ: every request goes to /<Universe>/game.php, so XhrEvent also carries page/mode (URL query or POST body) and
 * route = 'page=<page>[&mode=<mode>]' (lower case); onXhr regexes are tested against path AND route. */
(function (OGX) {
  'use strict';
  const bridge = (OGX.bridge = OGX.bridge || {});
  const log = OGX.log.create('bridge');
  const pending = new Map();
  let seq = 0;
  let inited = false;
  const handlers = []; // {re, fn}

  function parseForm(body) {
    const out = {};
    if (!body) return out;
    try {
      for (const [k, v] of new URLSearchParams(body)) {
        if (k.endsWith('[]')) { const kk = k.slice(0, -2); (out[kk] = out[kk] || []).push(v); } else out[k] = v;
      }
    } catch (e) { /* not a form */ }
    return out;
  }
  bridge._parseForm = parseForm;

  bridge.init = function () {
    if (inited) return;
    inited = true;
    document.addEventListener('ogx:xhr', OGX.safe(function (ev) {
      if (typeof ev.detail !== 'string') return;
      let x;
      try { x = JSON.parse(ev.detail); } catch (e) { return; }
      let u;
      try { u = new URL(x.url, location.href); } catch (e) { return; }
      if (u.origin !== location.origin) return;
      x.path = u.pathname.replace(/\/+$/, '');
      x.query = Object.fromEntries(u.searchParams);
      x.form = parseForm(x.requestBody);
      x.page = x.query.page || x.form.page || null;
      x.mode = x.query.mode || x.form.mode || null;
      x.route = x.page ? 'page=' + String(x.page).toLowerCase() + (x.mode ? '&mode=' + String(x.mode).toLowerCase() : '') : null;
      x.json = null;
      if (x.responseText && /^\s*[{[]/.test(x.responseText)) { try { x.json = JSON.parse(x.responseText); } catch (e) { x.json = null; } }
      if (x.json && typeof x.json === 'object') {
        const st = x.json.serverTime !== undefined ? x.json.serverTime : x.json.server_time;
        if (st !== undefined && Number.isFinite(+st)) OGX.safe(() => OGX.time.calibrate(+st), 'bridge:calibrate')();
      }
      OGX.bus.emit('xhr', x);
      for (const h of handlers.slice()) if (h.re.test(x.path) || (x.route && h.re.test(x.route))) h.fn(x);
    }, 'bridge:xhr'));
    document.addEventListener('ogx:reply', OGX.safe(function (ev) {
      if (typeof ev.detail !== 'string') return;
      let r;
      try { r = JSON.parse(ev.detail); } catch (e) { return; }
      const p = r && pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      clearTimeout(p.timer);
      if (r.ok) p.resolve(r.result); else p.reject(new Error(r.error || 'bridge call failed'));
    }, 'bridge:reply'));
  };

  /** Subscribe to relayed XHRs whose pathname (OgameX) or route 'page=x&mode=y' (GALAXYZ, lower case) matches.
   * fn gets XhrEvent & { path, query, form, json, page, mode, route }. Example: onXhr(/^page=fleetajax\b/, fn). */
  bridge.onXhr = function (pathRegex, fn) {
    const h = { re: pathRegex instanceof RegExp ? pathRegex : new RegExp(String(pathRegex)), fn: OGX.safe(fn, 'bridge:onXhr') };
    handlers.push(h);
    return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
  };

  /** Call a page-world method. Rejects after timeoutMs (default 3000) or when the hook is missing.
   * GALAXYZ: 'fleet.*' (state, selectShips, setTarget, selectMission, setCargo, setSpeed, setDuration, goStep, submit) are answered
   * in this world by OGX.fleet.gz.bridge (DOM form fillers of fleetTable / fleetStep1 / fleetStep2; never submit), since the
   * game has no fleetDispatcher object there. Results: OGX.fleet.gz shapes ({ ok, step, ... } / { ok: false, step, error }). */
  bridge.call = function (method, ...args) {
    const local = /^fleet\./.test(String(method)) && OGX.page && OGX.page.isGz && OGX.page.isGz() && OGX.fleet && OGX.fleet.gz && OGX.fleet.gz.bridge
      ? OGX.fleet.gz.bridge[method] : null;
    if (local) {
      try { return Promise.resolve(local(...args)); } catch (e) { return Promise.reject(e); }
    }
    if (!inited) bridge.init();
    const timeoutMs = 3000;
    return new Promise((resolve, reject) => {
      const id = 'c' + (++seq) + '_' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('bridge timeout: ' + method));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        document.dispatchEvent(new CustomEvent('ogx:call', { detail: JSON.stringify({ id, method, args }) }));
      } catch (e) {
        pending.delete(id); clearTimeout(timer); reject(e);
      }
    });
  };
  /** true when the page hook answers. */
  bridge.available = async function () {
    try { const r = await bridge.call('ping'); return !!(r && r.ok); } catch (e) { log.debug('hook missing', e.message); return false; }
  };
})(window.OGX);
