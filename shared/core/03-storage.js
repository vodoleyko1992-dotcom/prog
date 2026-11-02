/* shared/core/03-storage.js — namespaced async storage on chrome.storage.local (localStorage fallback). Owner: core.
 * Full key = <scopePrefix><key>: player '<host>|<playerId>|', server '<host>|*|', global '*|*|'.
 * Writes are coalesced per key (100 ms) and flushed on pagehide; update() is serialized per key; subscribe() sees other tabs. */
(function (OGX) {
  'use strict';
  const S = (OGX.storage = OGX.storage || {});
  const util = OGX.util;
  const COALESCE_MS = 100;

  let ns = { ext: null, host: '', playerId: '0' };
  let backend = null;
  const cache = new Map();          // fullKey -> value (as stored)
  const pending = new Map();        // fullKey -> value awaiting flush
  // fullKey -> JSON of our own recent writes (to recognise our echo). Several writes of one key can be in flight: the change
  // event of an older one arrives after a newer one was flushed, so one remembered value would let that echo pass as «remote».
  const lastWritten = new Map();
  function markWritten(fk, json) {
    const a = lastWritten.get(fk) || [];
    a.push(json);
    if (a.length > 16) a.splice(0, a.length - 16);
    lastWritten.set(fk, a);
  }
  function unmarkWritten(fk, json) {
    const a = lastWritten.get(fk);
    if (!a) return;
    const i = a.lastIndexOf(json);
    if (i >= 0) a.splice(i, 1);
    if (!a.length) lastWritten.delete(fk);
  }
  /** True (and forgets it plus every older entry) when json is one of our own recent writes of fk. */
  function takeEcho(fk, json) {
    const a = lastWritten.get(fk);
    if (!a) return false;
    const i = a.lastIndexOf(json);
    if (i < 0) return false;
    a.splice(0, i + 1);
    if (!a.length) lastWritten.delete(fk);
    return true;
  }
  const subs = new Map();           // fullKey -> Set(fn)
  const chains = new Map();         // fullKey -> Promise (update serialization)
  const mergers = [];               // [{prefix, fn}]
  const exportFilters = new Map();  // key -> fn(value, { local, mode }) -> value to export/import (undefined = leave the key out)
  let flushTimer = null;
  let flushWaiters = [];
  // failed backend writes (quota, MAX_WRITE_OPERATIONS_PER_MINUTE, invalidated context during an extension reload): the batch
  // goes back to pending and is retried with a backoff; one journal line per failure episode, 'storage:degraded' after 3
  const RETRY_MS = [1000, 2000, 5000, 10000, 30000, 60000];
  let retryTimer = null;
  let failStreak = 0;
  const tabId = util.uid();
  S.tabId = tabId;

  // ------------------------------------------------------------------ backends
  function promisify(area, method, arg) {
    return new Promise((resolve, reject) => {
      let done = false;
      const cb = (v) => {
        if (done) return; done = true;
        const err = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err))); else resolve(v);
      };
      try {
        const r = arg === undefined ? area[method](cb) : area[method](arg, cb);
        if (r && typeof r.then === 'function') r.then((v) => { if (!done) { done = true; resolve(v); } }, (e) => { if (!done) { done = true; reject(e); } });
      } catch (e) { if (!done) { done = true; reject(e); } }
    });
  }
  function extensionArea() {
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) return { area: browser.storage.local, events: browser.storage.onChanged };
    } catch (e) { /* not firefox */ }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return { area: chrome.storage.local, events: chrome.storage.onChanged };
    } catch (e) { /* no chrome api */ }
    return null;
  }
  function makeChromeBackend(x) {
    return {
      name: 'chrome',
      get: (keys) => promisify(x.area, 'get', keys === undefined ? null : keys).then((r) => r || {}),
      set: (obj) => promisify(x.area, 'set', obj),
      remove: (keys) => promisify(x.area, 'remove', keys),
      listen(fn) {
        if (x.events && x.events.addListener) {
          x.events.addListener((changes, areaName) => { if (!areaName || areaName === 'local') fn(changes); });
        }
      },
    };
  }
  function makeLocalBackend(ext) {
    const pre = 'ogx.' + (ext || 'core') + '.';
    const ls = () => window.localStorage;
    return {
      name: 'localStorage',
      async get(keys) {
        const out = {};
        const st = ls();
        const want = keys == null ? null : [].concat(keys);
        if (want) {
          for (const k of want) { const v = st.getItem(pre + k); if (v != null) { try { out[k] = JSON.parse(v); } catch (e) { /* skip */ } } }
        } else {
          for (let i = 0; i < st.length; i++) {
            const fk = st.key(i);
            if (fk && fk.startsWith(pre)) { try { out[fk.slice(pre.length)] = JSON.parse(st.getItem(fk)); } catch (e) { /* skip */ } }
          }
        }
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) ls().setItem(pre + k, JSON.stringify(v)); },
      async remove(keys) { for (const k of [].concat(keys)) ls().removeItem(pre + k); },
      listen(fn) {
        window.addEventListener('storage', (ev) => {
          if (!ev.key || !ev.key.startsWith(pre)) return;
          let nv; let ov;
          try { nv = ev.newValue == null ? undefined : JSON.parse(ev.newValue); } catch (e) { nv = undefined; }
          try { ov = ev.oldValue == null ? undefined : JSON.parse(ev.oldValue); } catch (e) { ov = undefined; }
          fn({ [ev.key.slice(pre.length)]: { newValue: nv, oldValue: ov } });
        });
      },
    };
  }

  // ------------------------------------------------------------------ keys
  function scopePrefix(scope) {
    if (scope === 'global') return '*|*|';
    if (scope === 'server') return ns.host + '|*|';
    return ns.host + '|' + ns.playerId + '|';
  }
  const full = (key, opts) => scopePrefix((opts && opts.scope) || 'player') + key;
  S.fullKey = (key, opts) => full(key, opts);
  S.scopePrefix = scopePrefix;
  function splitFull(fk) {
    for (const scope of ['player', 'server', 'global']) {
      const p = scopePrefix(scope);
      if (fk.startsWith(p)) return { scope, key: fk.slice(p.length) };
    }
    return null;
  }

  // ------------------------------------------------------------------ change fan-out
  function notify(fk, value, remote) {
    const set = subs.get(fk);
    if (set) for (const fn of [...set]) fn(util.clone(value), { remote });
    const sk = splitFull(fk);
    // the bus event carries the exportable form of a filtered key (no secrets); subscribers of the key get the stored value
    if (sk && OGX.bus) OGX.bus.emit('storage:changed', { key: sk.key, scope: sk.scope, value: exportFilters.has(sk.key) ? filtered(sk.key, value, { local: null, mode: 'export' }) : value, remote });
  }
  function onBackendChanged(changes) {
    for (const [fk, ch] of Object.entries(changes || {})) {
      const nv = ch ? ch.newValue : undefined;
      const json = nv === undefined ? '__undef__' : JSON.stringify(nv);
      if (takeEcho(fk, json)) continue;
      if (pending.has(fk)) continue; // our newer value wins locally; it is flushed shortly
      if (nv === undefined) cache.delete(fk); else cache.set(fk, nv);
      notify(fk, nv, true);
    }
  }

  // ------------------------------------------------------------------ API
  S.init = async function ({ ext, host, playerId, backend: forced } = {}) {
    ns = {
      ext: ext || null,
      host: String(host || (typeof location !== 'undefined' ? location.host : '')).toLowerCase(),
      playerId: playerId == null || playerId === '' ? '0' : String(playerId),
    };
    if (!backend || forced) {
      const x = forced === 'localStorage' ? null : extensionArea();
      backend = x ? makeChromeBackend(x) : makeLocalBackend(ext);
      backend.listen(onBackendChanged);
    }
    S.backendName = backend.name;
    S.ns = Object.assign({}, ns);
  };
  function need() { if (!backend) throw new Error('OGX.storage not initialised'); }

  S.get = async function (key, def = null, opts) {
    need();
    const fk = full(key, opts);
    if (pending.has(fk)) { const v = pending.get(fk); return v === undefined ? def : util.clone(v); }
    if (cache.has(fk)) { const v = cache.get(fk); return v === undefined ? def : util.clone(v); }
    const r = await backend.get([fk]);
    if (pending.has(fk)) { const v = pending.get(fk); return v === undefined ? def : util.clone(v); }
    if (!(fk in r)) return def;
    cache.set(fk, r[fk]);
    return util.clone(r[fk]);
  };
  S.getMany = async function (keys, opts) {
    const out = {};
    for (const k of keys) out[k] = await S.get(k, null, opts);
    return out;
  };
  S.set = function (key, value, opts) {
    need();
    const fk = full(key, opts);
    const v = util.clone(value);
    pending.set(fk, v);
    cache.set(fk, v);
    notify(fk, v, false);
    return scheduleFlush();
  };
  function scheduleFlush() {
    const p = new Promise((resolve) => flushWaiters.push(resolve));
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; S.flush(); }, COALESCE_MS);
    return p;
  }
  S.flush = async function () {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const waiters = flushWaiters; flushWaiters = [];
    if (!pending.size) { waiters.forEach((w) => w()); return; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    const obj = {}; const jsons = {};
    // marked before the write: the change event can arrive before set() resolves
    for (const [fk, v] of pending) { obj[fk] = v; jsons[fk] = JSON.stringify(v); markWritten(fk, jsons[fk]); }
    pending.clear();
    try {
      await backend.set(obj);
      if (failStreak) {
        failStreak = 0;
        try { OGX.log && OGX.log.rec && OGX.log.rec('S', 'storage', 'write-ok', { keys: Object.keys(obj).length }); } catch (e) { /* ignore */ }
        try { OGX.bus && OGX.bus.emit('storage:recovered', {}); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // keep what failed unless a newer set()/remove() replaced it meanwhile (cache holds the very object we tried to write)
      for (const fk of Object.keys(obj)) {
        unmarkWritten(fk, jsons[fk]);
        if (!pending.has(fk) && cache.get(fk) === obj[fk]) pending.set(fk, obj[fk]);
      }
      failStreak++;
      if (failStreak === 1) {
        OGX._log && OGX._log.error('storage write failed (will retry)', e);
        try { OGX.log && OGX.log.rec && OGX.log.rec('S', 'storage', 'write-failed', { err: String((e && e.message) || e).slice(0, 200), keys: Object.keys(obj).length }); } catch (e2) { /* ignore */ }
      }
      if (failStreak === 3) { try { OGX.bus && OGX.bus.emit('storage:degraded', { err: String((e && e.message) || e).slice(0, 200) }); } catch (e2) { /* ignore */ } }
      if (pending.size && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; S.flush(); }, RETRY_MS[Math.min(failStreak, RETRY_MS.length) - 1]);
      }
    }
    waiters.forEach((w) => w());
  };
  /** Consecutive failed backend writes (0 = healthy). */
  S.failStreak = () => failStreak;
  S.update = function (key, fn, def = null, opts) {
    const fk = full(key, opts);
    const prev = chains.get(fk) || Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const old = await S.get(key, def, opts);
      const nv = await fn(old);
      S.set(key, nv, opts);
      return util.clone(nv);
    });
    chains.set(fk, next.catch(() => undefined));
    return next;
  };
  S.remove = async function (key, opts) {
    need();
    const fk = full(key, opts);
    pending.delete(fk);
    cache.delete(fk);
    markWritten(fk, '__undef__');
    notify(fk, undefined, false);
    try { await backend.remove([fk]); } catch (e) { OGX._log && OGX._log.error('storage remove failed', e); }
  };
  async function allRaw() {
    const r = await backend.get(null);
    for (const [fk, v] of pending) r[fk] = v;
    return r;
  }
  S.keys = async function (prefix = '', opts) {
    need();
    const p = full(prefix, opts);
    const sp = full('', opts);
    return Object.keys(await allRaw()).filter((k) => k.startsWith(p)).map((k) => k.slice(sp.length)).sort();
  };
  S.subscribe = function (key, fn, opts) {
    const fk = full(key, opts);
    const wrapped = OGX.safe(fn, 'storage:' + key);
    if (!subs.has(fk)) subs.set(fk, new Set());
    subs.get(fk).add(wrapped);
    return () => { const s = subs.get(fk); if (s) s.delete(wrapped); };
  };
  S.namespaces = async function () {
    need();
    const groups = new Map();
    for (const fk of Object.keys(await allRaw())) {
      const m = /^([^|]*)\|([^|]*)\|/.exec(fk);
      if (!m) continue;
      const id = m[1] + '|' + m[2];
      if (!groups.has(id)) groups.set(id, { host: m[1], playerId: m[2], keys: 0 });
      groups.get(id).keys++;
    }
    return [...groups.values()];
  };
  S.registerMerger = function (keyPrefix, fn) {
    mergers.push({ prefix: String(keyPrefix), fn });
    mergers.sort((a, b) => b.prefix.length - a.prefix.length);
  };
  /** A key whose value must not leave or enter the browser as stored (passwords inside 'settings', credentials in a pending
   *  record): fn(value, { local, mode: 'export' | 'import' }) returns what is exported / imported instead, undefined drops the key. */
  S.registerExportFilter = function (key, fn) { if (typeof fn === 'function') exportFilters.set(String(key), fn); };
  function filtered(key, value, ctx) {
    const f = exportFilters.get(key);
    if (!f) return value;
    try { return f(util.clone(value), ctx); } catch (e) { OGX._log && OGX._log.error('export filter failed for ' + key, e); return undefined; }
  }
  S.exportAll = async function ({ scopes = ['player', 'server'], prefixes = null } = {}) {
    need();
    const all = await allRaw();
    const data = {};
    for (const scope of scopes) {
      const p = scopePrefix(scope);
      data[scope] = {};
      for (const [fk, v] of Object.entries(all)) {
        if (!fk.startsWith(p)) continue;
        const key = fk.slice(p.length);
        if (key.startsWith('lock.')) continue;
        if (prefixes && !prefixes.some((x) => key.startsWith(x))) continue;
        const out = filtered(key, v, { local: null, mode: 'export' });
        if (out === undefined) continue;
        data[scope][key] = out;
      }
    }
    const now = OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now();
    return { format: 'ogx-export', ext: ns.ext, version: OGX.version, host: ns.host, playerId: ns.playerId, exportedAt: now, data };
  };
  S.importAll = async function (file, { mode = 'merge' } = {}) {
    need();
    if (!file || file.format !== 'ogx-export' || !file.data || typeof file.data !== 'object') throw new Error('Неверный формат файла экспорта');
    let written = 0; let skipped = 0;
    for (const scope of ['player', 'server', 'global']) {
      const part = file.data[scope];
      if (!part || typeof part !== 'object') continue;
      for (const [key, imported] of Object.entries(part)) {
        if (key.startsWith('lock.')) { skipped++; continue; }
        const opts = { scope };
        const old = await S.get(key, null, opts);
        let value = imported;
        if (mode === 'merge' && old !== null && old !== undefined) {
          const m = mergers.find((x) => key.startsWith(x.prefix));
          if (m) {
            try { value = m.fn(util.clone(old), util.clone(imported)); } catch (e) { OGX._log && OGX._log.error('merger failed for ' + key, e); value = imported; }
          }
        }
        if (exportFilters.has(key)) {
          value = filtered(key, value, { local: old, mode: 'import' });
          if (value === undefined) { skipped++; continue; }
        }
        if (JSON.stringify(value) === JSON.stringify(old)) { skipped++; continue; }
        S.set(key, value, opts);
        written++;
      }
    }
    await S.flush();
    return { written, skipped };
  };
  S.lock = async function (name, ttlMs = 60000) {
    need();
    const fk = full('lock.' + name);
    const read = async () => { const r = await backend.get([fk]); return r[fk]; };
    const now = Date.now();
    const cur = await read();
    if (cur && cur.owner !== tabId && +cur.expires > now) return null;
    const rec = { owner: tabId, expires: now + Math.max(1000, +ttlMs || 60000), t: now };
    markWritten(fk, JSON.stringify(rec));
    await backend.set({ [fk]: rec });
    await util.sleep(30 + Math.floor(Math.random() * 30));
    const chk = await read();
    if (!chk || chk.owner !== tabId) return null;
    let released = false;
    return {
      owner: tabId,
      async refresh(ms = ttlMs) {
        if (released) return false;
        const c = await read();
        if (!c || c.owner !== tabId) return false;
        const r = { owner: tabId, expires: Date.now() + ms, t: Date.now() };
        markWritten(fk, JSON.stringify(r));
        await backend.set({ [fk]: r });
        return true;
      },
      async release() {
        if (released) return;
        released = true;
        const c = await read();
        if (c && c.owner === tabId) { markWritten(fk, '__undef__'); await backend.remove([fk]); }
      },
    };
  };
  S._reset = function () { cache.clear(); pending.clear(); lastWritten.clear(); };
})(window.OGX);
