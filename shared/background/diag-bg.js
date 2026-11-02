/* shared/background/diag-bg.js — background side of the diagnostic journal. Owner: core.
 * Runs in the MV3 service worker (Chrome: importScripts('shared/core/21-diaglib.js', 'shared/background/diag-bg.js'))
 * or in the Firefox background scripts list (same two files before background.js). Owns the extension-origin IndexedDB
 * 'ogx-diag' (events ring buffer of 100 000, snapshots up to 1000 / 64 MB). The popup opens the same database directly.
 * Messages (chrome.runtime.sendMessage), all answered asynchronously:
 *   { type: 'ogx:diag:ping' }                 -> { ok: true, diag: true, kind }
 *   { type: 'ogx:diag:put', events: [...] }   -> { ok, n }
 *   { type: 'ogx:diag:snap', snap }           -> { ok, id }
 *   { type: 'ogx:diag:query', q }             -> { ok, events, total, cut }
 *   { type: 'ogx:diag:snaps', q }             -> { ok, snaps, total, cut }
 *   { type: 'ogx:diag:stats' }                -> { ok, stats }
 *   { type: 'ogx:diag:meta', k, v? }          -> { ok, v }   (sets when 'v' is present)
 *   { type: 'ogx:diag:clear' }                -> { ok }
 * Other message types are left to the other listeners (return false). */
(function (root) {
  'use strict';
  if (root.OGXDiagBG) return;
  const L = root.OGXDiagLib;
  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);
  let storeP = null;
  const store = () => {
    if (!storeP) { storeP = L.openStore({ name: 'ogx-diag' }); storeP.catch(() => { storeP = null; }); }
    return storeP;
  };
  const handlers = {
    'ogx:diag:ping': async () => ({ ok: true, diag: true, kind: (await store()).kind }),
    'ogx:diag:put': async (m) => {
      const ev = Array.isArray(m.events) ? m.events.filter((e) => e && typeof e === 'object').slice(0, 5000) : [];
      return { ok: true, n: await (await store()).put(ev) };
    },
    'ogx:diag:snap': async (m) => ({ ok: true, id: await (await store()).putSnap(m.snap || {}) }),
    'ogx:diag:query': async (m) => Object.assign({ ok: true }, await (await store()).query(m.q || {})),
    'ogx:diag:snaps': async (m) => Object.assign({ ok: true }, await (await store()).snaps(m.q || {})),
    'ogx:diag:stats': async () => ({ ok: true, stats: await (await store()).stats() }),
    'ogx:diag:meta': async (m) => {
      const s = await store();
      if (Object.prototype.hasOwnProperty.call(m, 'v')) { await s.setMeta(String(m.k), m.v); return { ok: true, v: m.v }; }
      return { ok: true, v: await s.getMeta(String(m.k)) };
    },
    'ogx:diag:clear': async () => { await (await store()).clear(); return { ok: true }; },
  };
  function onMessage(msg, sender, reply) {
    const h = msg && typeof msg.type === 'string' ? handlers[msg.type] : null;
    if (!h) return false;
    h(msg).then(reply, (e) => reply({ ok: false, error: String(e && e.message || e) }));
    return true; // async reply
  }
  if (api && api.onMessage) api.onMessage.addListener(onMessage);
  root.OGXDiagBG = { handlers, store };
})(typeof self !== 'undefined' ? self : this);
