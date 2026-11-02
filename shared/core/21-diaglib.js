/* shared/core/21-diaglib.js — diagnostics library shared by the content scripts, the background service worker
 * (shared/background/diag-bg.js) and the popup (shared/popup/diag-panel.js). Owner: core.
 * Pure helpers (redaction, JSON key schema, path normalisation), the event/snapshot store (IndexedDB ring buffer with a
 * localStorage fallback) and the export formatters (TXT, JSONL, snapshots HTML, learning report).
 * Defines only. Works without DOM and without window.OGX: exported as self.OGXDiagLib (and OGX.diaglib when OGX exists). */
(function (root) {
  'use strict';
  if (root.OGXDiagLib) { if (root.OGX) root.OGX.diaglib = root.OGXDiagLib; return; }
  const L = {};
  L.version = '1';
  L.SOURCES = ['U', 'B', 'S', 'N', 'G', 'L'];
  L.SOURCE_NAMES = { U: 'клик пользователя', B: 'действие дополнения/бота', S: 'страница/сессия/ошибки', N: 'сеть игры', G: 'сообщения игры', L: 'самообучение' };
  L.MAX_EXPORT_BYTES = 6 * 1024 * 1024;

  // ------------------------------------------------------------------ redaction
  // Keys whose values are never stored. Matched against the key name (case-insensitive).
  const SENS_EXACT = /^(_token|token|csrf|csrf[-_]?token|x-csrf-token|x-xsrf-token|xsrf[-_]?token|newajaxtoken|ajaxtoken|password|password_confirmation|passwd|pwd|pass|email|e-mail|mail|cookie|cookies|set-cookie|session|sessionid|remember_token|api_key|apikey|secret|authorization|auth)$/i;
  // 'token' but not a key ending in the plural 'tokens' (the markup token lists of learn alerts: '#id', '.class', ...).
  const SENS_PART = /(password|passwd|token(?!s$)|cookie|secret|email|csrf|xsrf|session)/i;
  L.isSensitiveKey = (k) => { const s = String(k || ''); return SENS_EXACT.test(s) || SENS_PART.test(s); };
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const QS_SECRET_RE = /([?&;](?:_token|token|csrf[^=&]*|password[^=&]*|email[^=&]*|session[^=&]*|newAjaxToken)=)[^&#\s"']*/gi;
  // session cookies written out as name=value (a pasted Cookie header, an error text): 2Moons/GALAXYZ '2Moons', PHPSESSID, *_session
  const COOKIE_RE = /\b(PHPSESSID|2Moons|remember_[\w-]*|XSRF-TOKEN|[\w-]*_session|[\w-]*sessid|sid)=[^;&\s"'<>]+/gi;
  const extraSecrets = new Set();
  /** Register a secret string (the live CSRF token, ...) that must be masked wherever it appears. */
  L.addSecret = (s) => { if (typeof s === 'string' && s.length >= 12) extraSecrets.add(s); };
  L.redactString = function (s, max = 500) {
    if (typeof s !== 'string') return s;
    let out = s;
    if (max && out.length > 20000) out = out.slice(0, 20000);
    for (const sec of extraSecrets) if (out.includes(sec)) out = out.split(sec).join('<csrf>');
    out = out.replace(EMAIL_RE, '<email>').replace(QS_SECRET_RE, '$1<redacted>').replace(COOKIE_RE, '$1=<redacted>');
    if (max && out.length > max) out = out.slice(0, max) + '…(' + s.length + ')';
    return out;
  };
  /** Deep copy with sensitive keys masked, strings redacted/truncated, depth and size capped. Never throws. */
  L.redact = function (v, opts = {}) {
    const maxStr = opts.maxStr || 500;
    const seen = new Set();
    const walk = (x, depth) => {
      if (x === null || x === undefined) return x;
      const t = typeof x;
      if (t === 'string') return L.redactString(x, maxStr);
      if (t === 'number') return Number.isFinite(x) ? x : String(x);
      if (t === 'boolean') return x;
      if (t === 'bigint') return String(x);
      if (t === 'function' || t === 'symbol') return undefined;
      if (x instanceof Error) return { name: x.name, message: L.redactString(String(x.message), 1000), stack: L.redactString(String(x.stack || ''), 3000) };
      if (depth > 5) return '…';
      if (seen.has(x)) return '(cycle)';
      seen.add(x);
      try {
        if (typeof Node !== 'undefined' && x instanceof Node) return '<' + (x.nodeName || 'node').toLowerCase() + '>';
        if (Array.isArray(x)) {
          const a = x.slice(0, 50).map((e) => walk(e, depth + 1));
          if (x.length > 50) a.push('…+' + (x.length - 50));
          return a;
        }
        const o = {};
        let n = 0;
        for (const k of Object.keys(x)) {
          if (++n > 60) { o['…'] = Object.keys(x).length - 60; break; }
          o[k] = L.isSensitiveKey(k) ? '<redacted>' : walk(x[k], depth + 1);
        }
        return o;
      } catch (e) { return '(unreadable)'; } finally { seen.delete(x); }
    };
    try { return walk(v, 0); } catch (e) { return '(unreadable)'; }
  };
  /** Masks sensitive query parameters (and emails) of a URL or path; returns pathname+search (origin dropped). */
  L.redactUrl = function (url, base) {
    try {
      const u = new URL(url, base || 'http://x.invalid');
      for (const k of Array.from(u.searchParams.keys())) if (L.isSensitiveKey(k)) u.searchParams.set(k, '<redacted>');
      return L.redactString(decodeURIComponent(u.pathname) + (u.search ? decodeURIComponent(u.search) : ''), 300);
    } catch (e) { return L.redactString(String(url), 300); }
  };
  /** Request body (urlencoded string / object / URLSearchParams) -> { key: value } with secrets masked, values truncated. */
  L.formSummary = function (body) {
    if (body === null || body === undefined || body === '') return null;
    const out = {};
    let n = 0;
    const put = (k, v) => {
      if (++n > 40) { out['…'] = true; return; }
      const key = String(k);
      out[key] = L.isSensitiveKey(key) ? '<redacted>' : L.redactString(String(v), 60);
    };
    try {
      if (typeof body === 'string') {
        if (/^\s*[{[]/.test(body)) { try { return L.redact(JSON.parse(body), { maxStr: 60 }); } catch (e) { /* not json */ } }
        for (const [k, v] of new URLSearchParams(body)) put(k, v);
      } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        for (const [k, v] of body) put(k, v);
      } else if (typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) put(k, Array.isArray(v) ? v.join(',') : v);
      } else return null;
    } catch (e) { return null; }
    return out;
  };

  // ------------------------------------------------------------------ shapes
  /** '/ajax/messages/123/' -> '/ajax/messages/:id'. Digits-only, uuid and long hex segments become placeholders. */
  L.normalizePath = function (p) {
    let s = String(p || '/');
    try { if (/^[a-z]+:\/\//i.test(s)) s = new URL(s).pathname; } catch (e) { /* keep */ }
    s = s.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    return s.split('/').map((seg) => (/^\d+$/.test(seg) ? ':id' : /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[0-9a-f]{24,}$/i.test(seg) ? ':h' : seg)).join('/');
  };
  /** Sorted JSON key paths: 'a', 'a.b', 'list[].c'. Numeric keys become '#'. Depth 3, at most 200 paths. */
  L.jsonSchema = function (json, maxDepth = 3, max = 200) {
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
  };
  /** Small safe fields of a JSON response (never the payload): success flag, status, message/error texts. */
  L.safeFields = function (json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const o = {};
    const pick = (k) => { if (json[k] !== undefined && json[k] !== null && typeof json[k] !== 'object') o[k] = typeof json[k] === 'string' ? L.redactString(json[k], 200) : json[k]; };
    ['success', 'status', 'result', 'message', 'error', 'code'].forEach(pick);
    if (json.newAjaxToken !== undefined) o.newAjaxToken = '<redacted>';
    if (Array.isArray(json.errors)) o.errors = json.errors.slice(0, 5).map((e) => L.redactString(typeof e === 'string' ? e : (e && (e.message || e.error)) ? String(e.message || e.error) : JSON.stringify(e), 200));
    else if (json.errors && typeof json.errors === 'object') o.errors = Object.keys(json.errors).slice(0, 10);
    if (json.response && typeof json.response === 'object') { const r = L.safeFields(json.response); if (r && Object.keys(r).length) o.response = r; }
    return Object.keys(o).length ? o : null;
  };
  /** 'ok' | 'err' for a response: HTTP >= 400, success === false, status 'failure'/'error', or a non-empty errors list. */
  L.responseKind = function (status, json) {
    if (status === 0 || status >= 400) return 'err';
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      if (json.success === false) return 'err';
      if (typeof json.status === 'string' && /^(fail|failure|error)$/i.test(json.status)) return 'err';
      if (Array.isArray(json.errors) && json.errors.length) return 'err';
      if (json.response && typeof json.response === 'object' && json.response.success === false) return 'err';
    }
    return 'ok';
  };
  L.jsonSize = (v) => { try { return JSON.stringify(v).length; } catch (e) { return 0; } };
  L.utf8Len = function (s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  };

  // ------------------------------------------------------------------ stores
  // Store API (both backends): put(events) ; putSnap(snap) -> id ; query({ sinceId, sinceT, untilT, last, maxBytes }) ->
  //   { events (ascending id), total, cut } ; snaps({ last, maxBytes, sinceT }) -> { snaps (ascending), total, cut } ;
  //   stats() -> { events, snaps, snapBytes, minId, maxId, firstT, lastT, lastExportId } ; getMeta(k) ; setMeta(k, v) ; clear()
  const DEF = { cap: 100000, slack: 500, snapCap: 1000, snapBytes: 64 * 1024 * 1024, snapMax: 600 * 1024 };
  function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function txDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('abort')); }); }

  function idbStore(opts) {
    const o = Object.assign({}, DEF, opts);
    let dbp = null;
    let count = null; let snapCount = null; let snapBytes = null;
    const open = () => {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(o.name, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('ev')) db.createObjectStore('ev', { keyPath: 'id', autoIncrement: true }).createIndex('t', 't');
          if (!db.objectStoreNames.contains('snap')) db.createObjectStore('snap', { keyPath: 'id', autoIncrement: true }).createIndex('t', 't');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
        };
        r.onsuccess = () => { const db = r.result; db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } dbp = null; }; resolve(db); };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('idb blocked'));
      });
      dbp.catch(() => { dbp = null; });
      return dbp;
    };
    async function prune(db, storeName, keep) {
      const tx = db.transaction(storeName, 'readwrite');
      const st = tx.objectStore(storeName);
      const n = await req(st.count());
      if (n > keep) {
        const keys = await req(st.getAllKeys(null, n - keep));
        if (keys.length) st.delete(IDBKeyRange.upperBound(keys[keys.length - 1]));
      }
      await txDone(tx);
      return Math.min(n, keep);
    }
    const S = {
      kind: 'idb', name: o.name, cap: o.cap,
      async put(events) {
        if (!events || !events.length) return 0;
        const db = await open();
        const tx = db.transaction('ev', 'readwrite');
        const st = tx.objectStore('ev');
        for (const e of events) { const c = Object.assign({}, e); delete c.id; st.add(c); }
        await txDone(tx);
        if (count === null) count = await req(db.transaction('ev').objectStore('ev').count());
        else count += events.length;
        if (count > o.cap + o.slack) count = await prune(db, 'ev', o.cap);
        return events.length;
      },
      async putSnap(snap) {
        const db = await open();
        const c = Object.assign({}, snap);
        delete c.id;
        if (typeof c.html === 'string' && c.html.length > o.snapMax) c.html = c.html.slice(0, o.snapMax) + '\n<!-- OGX: snapshot truncated at ' + o.snapMax + ' chars -->';
        c.size = (c.html || '').length;
        const tx = db.transaction('snap', 'readwrite');
        const id = await req(tx.objectStore('snap').add(c));
        await txDone(tx);
        if (snapCount === null || snapBytes === null) { const s = await S.stats(); snapCount = s.snaps; snapBytes = s.snapBytes; } else { snapCount++; snapBytes += c.size; }
        if (snapCount > o.snapCap || snapBytes > o.snapBytes) {
          // drop the oldest until both caps hold
          const tx2 = db.transaction('snap', 'readwrite');
          const st = tx2.objectStore('snap');
          const all = await req(st.getAll());
          let n = all.length; let b = all.reduce((a, s) => a + (s.size || 0), 0);
          for (const s of all) { if (n <= o.snapCap && b <= o.snapBytes) break; st.delete(s.id); n--; b -= s.size || 0; }
          await txDone(tx2);
          snapCount = n; snapBytes = b;
        }
        return id;
      },
      async query(q = {}) {
        const db = await open();
        const tx = db.transaction('ev');
        const st = tx.objectStore('ev');
        let source = st; let range = null;
        if (q.sinceId) range = IDBKeyRange.lowerBound(+q.sinceId, true);
        else if (q.sinceT || q.untilT) { source = st.index('t'); range = q.untilT ? IDBKeyRange.bound(+q.sinceT || 0, +q.untilT) : IDBKeyRange.lowerBound(+q.sinceT); }
        const total = await req(source.count(range));
        const want = q.last ? Math.min(+q.last, total) : total;
        const maxBytes = q.maxBytes || Infinity;
        const out = [];
        let bytes = 0;
        await new Promise((resolve, reject) => {
          const cur = source.openCursor(range, 'prev');
          cur.onerror = () => reject(cur.error);
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c || out.length >= want) return resolve();
            const v = c.value;
            bytes += L.jsonSize(v) + 1;
            if (bytes > maxBytes && out.length) return resolve();
            out.push(v);
            c.continue();
          };
        });
        out.reverse();
        if (source !== st) out.sort((a, b) => a.id - b.id);
        return { events: out, total, cut: total - out.length };
      },
      async snaps(q = {}) {
        const db = await open();
        const st = db.transaction('snap').objectStore('snap');
        let all = await req(q.sinceT ? st.index('t').getAll(IDBKeyRange.lowerBound(+q.sinceT)) : st.getAll());
        all.sort((a, b) => a.id - b.id);
        const total = all.length;
        if (q.last) all = all.slice(-q.last);
        if (q.maxBytes) { let b = 0; let i = all.length; while (i > 0 && b + (all[i - 1].size || 0) <= q.maxBytes) { b += all[i - 1].size || 0; i--; } if (i === all.length && all.length) i = all.length - 1; all = all.slice(i); }
        return { snaps: all, total, cut: total - all.length };
      },
      async stats() {
        const db = await open();
        const tx = db.transaction(['ev', 'snap', 'meta']);
        const ev = tx.objectStore('ev');
        const events = await req(ev.count());
        const first = await new Promise((r) => { const c = ev.openCursor(); c.onsuccess = () => r(c.result ? c.result.value : null); c.onerror = () => r(null); });
        const last = await new Promise((r) => { const c = ev.openCursor(null, 'prev'); c.onsuccess = () => r(c.result ? c.result.value : null); c.onerror = () => r(null); });
        const snapsAll = await req(tx.objectStore('snap').getAll());
        const m = await req(tx.objectStore('meta').get('lastExportId'));
        count = events; snapCount = snapsAll.length; snapBytes = snapsAll.reduce((a, s) => a + (s.size || 0), 0);
        return { events, snaps: snapCount, snapBytes, minId: first ? first.id : 0, maxId: last ? last.id : 0, firstT: first ? first.t : 0, lastT: last ? last.t : 0, lastExportId: m ? m.v : 0 };
      },
      async getMeta(k) { const db = await open(); const r = await req(db.transaction('meta').objectStore('meta').get(k)); return r ? r.v : null; },
      async setMeta(k, v) { const db = await open(); const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ k, v }); await txDone(tx); return true; },
      async clear() {
        const db = await open();
        const tx = db.transaction(['ev', 'snap', 'meta'], 'readwrite');
        tx.objectStore('ev').clear(); tx.objectStore('snap').clear(); tx.objectStore('meta').delete('lastExportId');
        await txDone(tx);
        count = 0; snapCount = 0; snapBytes = 0;
        return true;
      },
    };
    return S;
  }

  // localStorage fallback (userscript on a browser without IndexedDB access). Small caps: localStorage holds ~5 MB.
  function lsStore(opts) {
    const o = Object.assign({}, DEF, opts);
    const cap = Math.min(o.cap, opts && opts.lsCap || 4000);
    const snapCap = Math.min(o.snapCap, 5);
    const K = (s) => o.name + '.' + s;
    const read = (k, d) => { try { const v = localStorage.getItem(K(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
    const write = (k, v) => { try { localStorage.setItem(K(k), JSON.stringify(v)); return true; } catch (e) { return false; } };
    const S = {
      kind: 'localStorage', name: o.name, cap,
      async put(events) {
        const list = read('ev', []);
        let id = read('seq', 0);
        for (const e of events) { const c = Object.assign({}, e); c.id = ++id; list.push(c); }
        let keep = list.length > cap ? list.slice(list.length - cap) : list;
        while (!write('ev', keep) && keep.length > 10) keep = keep.slice(Math.floor(keep.length / 2));
        write('seq', id);
        return events.length;
      },
      async putSnap(snap) {
        const list = read('snap', []);
        let id = read('snapSeq', 0);
        const c = Object.assign({}, snap, { id: ++id });
        if (typeof c.html === 'string' && c.html.length > 200000) c.html = c.html.slice(0, 200000) + '\n<!-- OGX: snapshot truncated -->';
        c.size = (c.html || '').length;
        list.push(c);
        let keep = list.slice(-snapCap);
        while (!write('snap', keep) && keep.length > 1) keep = keep.slice(1);
        write('snapSeq', id);
        return id;
      },
      async query(q = {}) {
        let list = read('ev', []);
        if (q.sinceId) list = list.filter((e) => e.id > q.sinceId);
        if (q.sinceT) list = list.filter((e) => e.t >= q.sinceT);
        if (q.untilT) list = list.filter((e) => e.t <= q.untilT);
        const total = list.length;
        if (q.last) list = list.slice(-q.last);
        if (q.maxBytes) { let b = 0; let i = list.length; while (i > 0 && b + L.jsonSize(list[i - 1]) + 1 <= q.maxBytes) { b += L.jsonSize(list[i - 1]) + 1; i--; } list = list.slice(Math.min(i, Math.max(0, list.length - 1))); }
        return { events: list, total, cut: total - list.length };
      },
      async snaps(q = {}) {
        let all = read('snap', []);
        const total = all.length;
        if (q.sinceT) all = all.filter((s) => s.t >= q.sinceT);
        if (q.last) all = all.slice(-q.last);
        return { snaps: all, total, cut: total - all.length };
      },
      async stats() {
        const list = read('ev', []); const sn = read('snap', []);
        return { events: list.length, snaps: sn.length, snapBytes: sn.reduce((a, s) => a + (s.size || 0), 0), minId: list.length ? list[0].id : 0, maxId: list.length ? list[list.length - 1].id : 0,
          firstT: list.length ? list[0].t : 0, lastT: list.length ? list[list.length - 1].t : 0, lastExportId: read('meta', {}).lastExportId || 0 };
      },
      async getMeta(k) { const m = read('meta', {}); return m[k] === undefined ? null : m[k]; },
      async setMeta(k, v) { const m = read('meta', {}); m[k] = v; return write('meta', m); },
      async clear() { for (const k of ['ev', 'snap', 'meta']) { try { localStorage.removeItem(K(k)); } catch (e) { /* ignore */ } } return true; },
    };
    return S;
  }

  /** Opens the IndexedDB ring store `name` (cap events, default 100 000); falls back to localStorage when IndexedDB fails. */
  L.openStore = async function (opts) {
    const o = Object.assign({ name: 'ogx-diag' }, opts);
    if (!o.forceLocal && typeof indexedDB !== 'undefined') {
      const s = idbStore(o);
      try { await s.stats(); return s; } catch (e) { /* blocked (private mode, sandboxed frame) */ }
    }
    if (typeof localStorage !== 'undefined') return lsStore(o);
    throw new Error('no storage for the diagnostic journal');
  };

  // ------------------------------------------------------------------ volatile markup tokens (self-learning)
  // Markup that comes and goes with normal play, never a layout change: the fleet event box (#OvfleetEvents /
  // #OvfleetContent, its rows, buttons and data-fleet-* attributes, #eventboxLoading when no fleet flies), the per-mission
  // classes of fleet rows (.ownattack, .owndeploy, .ownexpo, ...), the tooltip library (.t_Tooltip, .t_Content, ...),
  // the build-queue icon (.bi-building-fill-up / .buildingIco, other bootstrap icons), the unread-messages counter and
  // the "storage full" resource classes. Learning ignores them: no tokens-new / tokens-gone alerts.
  L.VOLATILE_TOKEN = /^(?:#(?:OvfleetEvents|OvfleetContent|eventboxLoading|eventboxBlank|eventbox[\w#-]*|fleettime_#)|\.(?:OvfleetButton|OvfleetEvents[\w#-]*|allFleetsEvent|fleet_static_time|textForBlind|fleets|flight|return|own[a-z]+|t_[\w#-]+|bi|bi-[\w#-]+|buildingIco|new-msg-count|res_current_[\w#-]+|visible)|\[data-(?:fleet-[\w#-]+|hide)\])$/;
  L.isVolatileToken = (t) => L.VOLATILE_TOKEN.test(String(t || ''));

  // ------------------------------------------------------------------ formatting
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  L.fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
  L.fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  L.fmtStamp = (t) => L.fmtDate(t) + ' ' + L.fmtTime(t).slice(0, 8);
  L.fileStamp = (t = Date.now()) => L.fmtDate(t).replace(/-/g, '') + '-' + L.fmtTime(t).slice(0, 8).replace(/:/g, '');
  L.tzLabel = (t = Date.now()) => { const m = -new Date(t).getTimezoneOffset(); return 'UTC' + (m >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(m) / 60)) + ':' + pad(Math.abs(m) % 60); };
  const json1 = (v) => { try { return JSON.stringify(v); } catch (e) { return '"(unprintable)"'; } };

  /** One event line: "HH:MM:SS.mmm [SRC] kind: what {json}". pg/tb (page, tab) are added when they change (see DIAG.md). */
  L.eventLine = function (e, prev) {
    let d = e.d && typeof e.d === 'object' ? Object.assign({}, e.d) : (e.d !== undefined && e.d !== null ? { v: e.d } : null);
    if (!prev || prev.p !== e.p) { d = d || {}; d.pg = e.p || '-'; }
    if (!prev || prev.tab !== e.tab) { d = d || {}; d.tb = e.tab || '-'; }
    return `${L.fmtTime(e.t)} [${e.s}] ${e.k}: ${String(e.w === undefined || e.w === null ? '' : e.w).replace(/\s+/g, ' ')}` + (d && Object.keys(d).length ? ' ' + json1(d) : '');
  };
  const isErrorEvent = (e) => (e.s === 'S' && /^(error|uncaught|rejection|module-init-fail|boot-fail)$/.test(e.k)) || (e.s === 'N' && e.d && (e.d.err || e.d.st >= 400 || e.d.st === 0))
    || (e.s === 'G' && e.d && e.d.failed) || (e.s === 'B' && e.d && e.d.ok === false) || e.s === 'L';
  L.isErrorEvent = isErrorEvent;
  /** Error counters of the last `ms` (default 10 min) by source. */
  L.errorCounters = function (events, now = Date.now(), ms = 600000) {
    const c = { U: 0, B: 0, S: 0, N: 0, G: 0, L: 0 };
    for (const e of events) if (e.t >= now - ms && isErrorEvent(e)) c[e.s] = (c[e.s] || 0) + 1;
    return c;
  };
  const top = (map, n) => Array.from(map.entries()).sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).slice(0, n);
  /** SUMMARY block lines. */
  L.summary = function (events) {
    const out = [];
    const bySrc = new Map();
    for (const e of events) {
      if (!bySrc.has(e.s)) bySrc.set(e.s, new Map());
      const m = bySrc.get(e.s);
      m.set(e.k, (m.get(e.k) || 0) + 1);
    }
    out.push('События по источникам/видам:');
    for (const s of L.SOURCES) {
      const m = bySrc.get(s);
      if (!m) continue;
      const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
      out.push(`  [${s}] ${total}: ` + Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', '));
    }
    const eps = new Map();
    for (const e of events) {
      if (e.s !== 'N') continue;
      const d = e.d || {};
      const r = eps.get(e.w) || { n: 0, ms: 0, msN: 0, err: 0, ogx: 0, last: 0, statuses: {} };
      r.n++; r.last = e.t;
      if (Number.isFinite(d.ms)) { r.ms += d.ms; r.msN++; }
      if (d.err || d.st >= 400 || d.st === 0) r.err++;
      if (d.by === 'ogx') r.ogx++;
      r.statuses[d.st] = (r.statuses[d.st] || 0) + 1;
      eps.set(e.w, r);
    }
    out.push('', 'Сеть (эндпоинт: кол-во, среднее мс, ошибок, из них наших запросов, статусы):');
    if (!eps.size) out.push('  —');
    for (const [w, r] of top(eps, 60)) out.push(`  ${w}  n=${r.n} avg=${r.msN ? Math.round(r.ms / r.msN) : '-'}ms err=${r.err} ogx=${r.ogx} st=${json1(r.statuses)}`);
    const gm = new Map();
    for (const e of events) if (e.s === 'G') { const k = e.k + ': ' + String(e.w).slice(0, 160); const r = gm.get(k) || { n: 0, last: 0 }; r.n++; r.last = e.t; gm.set(k, r); }
    out.push('', 'Сообщения игры (топ):');
    if (!gm.size) out.push('  —');
    for (const [k, r] of top(gm, 15)) out.push(`  ${r.n}× ${k}`);
    const em = new Map();
    for (const e of events) {
      if (!isErrorEvent(e) || e.s === 'L') continue;
      const d = e.d || {};
      const msg = d.msg || d.message || d.err || (d.error && (d.error.message || d.error)) || (d.st !== undefined ? 'HTTP ' + d.st : '') || '';
      const k = `[${e.s}] ${e.k}: ${e.w} — ${String(msg).split('\n')[0].slice(0, 160)}`;
      const r = em.get(k) || { n: 0, last: 0 }; r.n++; r.last = e.t; em.set(k, r);
    }
    out.push('', 'Ошибки (топ):');
    if (!em.size) out.push('  —');
    for (const [k, r] of top(em, 20)) out.push(`  ${r.n}× ${k}  (последняя ${L.fmtStamp(r.last)})`);
    const al = events.filter((e) => e.s === 'L').slice(-20);
    out.push('', 'Последние алерты самообучения (до 20):');
    if (!al.length) out.push('  —');
    for (const e of al) out.push(`  ${L.fmtStamp(e.t)} ${e.k}: ${e.w}` + (e.d ? ' ' + json1(e.d).slice(0, 300) : ''));
    return out;
  };

  /** Host allow-list match, same rules as ogamex-suite/loader.js: 'host', 'host:port', '*.domain'. */
  L.hostInList = function (host, list) {
    const h = String(host || '').toLowerCase(); const name = h.replace(/:\d+$/, '');
    return (list || []).some((raw) => {
      const e = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
      if (!e) return false;
      if (e.startsWith('*.')) { const base = e.slice(2); return name === base || name.endsWith('.' + base); }
      return e === h || e === name;
    });
  };
  /** Header lines from a context object ({ extName, extVersion, coreVersion, ua, host, playerId, playerClass, server, modules, settings, ... }). */
  L.headerLines = function (ctx, events, now = Date.now()) {
    const c = ctx || {};
    const out = [];
    out.push(`=== OGX журнал для разбора (формат ${L.version}) ===`);
    out.push(`Расширение: ${c.extName || c.ext || '-'} ${c.extVersion || ''} (ядро ${c.coreVersion || '-'})`);
    out.push(`Выгрузка: ${L.fmtStamp(now)} ${L.tzLabel(now)}  вид: ${c.exportKind || '-'}`);
    out.push(`Браузер: ${c.ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '-')}`);
    out.push(`Сервер: ${c.host || '-'}  хранилище журнала: ${c.storeKind || '-'}${c.otherHosts && c.otherHosts.length ? '  другие серверы: ' + c.otherHosts.join(', ') : ''}`);
    const eng = c.engine === 'galaxyz' ? 'GALAXYZ' : c.engine === 'ogamex' ? 'OgameX' : c.engine || '-';
    out.push(`Движок: ${eng}${c.engineVersion ? ' ' + c.engineVersion : ''}  вселенная ${c.universe || '-'}  страница ${c.gzPage || c.page || '-'}`
      + (c.resourceMultiplier ? `  добыча ресурсов x${c.resourceMultiplier}` : '') + (c.server && c.server.fleetSpeed ? `  скорость флота x${c.server.fleetSpeed}` : ''));
    // GALAXYZ has no player classes: 'none' is the internal placeholder
    const cls = !c.playerClass || c.playerClass === 'none' ? (c.engine === 'galaxyz' ? 'нет (в GALAXYZ классов нет)' : 'нет') : c.playerClass;
    out.push(`Игрок: id ${c.playerId || '-'}  класс ${cls}  контекст обновлён ${c.t ? L.fmtStamp(c.t) : '-'}`);
    if (c.ctxNote) out.push(c.ctxNote);
    if (c.allowHosts) out.push('Серверы (allow-list): ' + (c.allowHosts.length ? c.allowHosts.join(', ') : 'список пуст — работает на всех игровых страницах (GALAXYZ/2Moons и OgameX)') + (c.host && c.allowHosts.length && !L.hostInList(c.host, c.allowHosts) ? `  (!) ${c.host} не в списке — расширение на нём не запускается` : ''));
    if (c.globalOff) out.push('Выключено глобально (попап): ' + (c.globalOff.length ? c.globalOff.join(', ') : '—'));
    if (c.server) out.push('Настройки сервера: ' + json1(c.server));
    if (c.diag) out.push('Диагностика: ' + json1(L.redact(c.diag, { maxStr: 300 })));
    if (c.modules && c.modules.length) {
      out.push('Модули:');
      for (const m of c.modules) out.push(`  ${m.enabled === false ? '-' : '+'} ${m.name}${m.globalOff ? ' (выключен в попапе)' : ''}${m.active ? ' (активен на странице ' + (c.page || '?') + ')' : ''}${m.settings ? ' ' + json1(m.settings) : ''}`);
    }
    if (c.core) out.push('Настройки ядра: ' + json1(L.redact(c.core, { maxStr: 300 })));
    const ec = L.errorCounters(events || [], now);
    out.push('Ошибки за 10 мин: ' + L.SOURCES.map((s) => `${s}=${ec[s] || 0}`).join(' '));
    return out;
  };

  /**
   * Builds the TXT export. { ctx, events (ascending), cut (events not delivered by the store), exportKind, maxBytes=6 MB }
   * -> { text, included, dropped, firstT, lastT, maxId }. The newest events are kept; the header says what was cut.
   */
  L.buildTxt = function ({ ctx, events = [], cut = 0, exportKind = '', maxBytes = L.MAX_EXPORT_BYTES, now = Date.now() } = {}) {
    const c = Object.assign({}, ctx, { exportKind });
    const head = L.headerLines(c, events, now);
    const sum = ['', '=== SUMMARY ===', ...L.summary(events)];
    const lines = [];
    let prev = null; let day = null;
    for (const e of events) {
      const d = L.fmtDate(e.t);
      if (d !== day) { lines.push(`--- ${d} ---`); day = d; prev = null; }
      lines.push(L.eventLine(e, prev));
      prev = e;
    }
    const fixedBytes = L.utf8Len(head.join('\n') + sum.join('\n')) + 600;
    let budget = maxBytes - fixedBytes;
    let i = lines.length;
    while (i > 0) { const b = L.utf8Len(lines[i - 1]) + 1; if (budget - b < 0) break; budget -= b; i--; }
    // keep a day separator at the top of what is kept
    const kept = lines.slice(i);
    if (i > 0 && kept.length && !/^--- /.test(kept[0])) { const sep = lines.slice(0, i).reverse().find((l) => /^--- /.test(l)); if (sep) kept.unshift(sep); }
    const keptEvents = kept.filter((l) => !/^--- /.test(l)).length;
    const dropped = events.length - keptEvents;
    const firstKept = events[events.length - keptEvents];
    const info = [];
    if (cut > 0 || dropped > 0) {
      info.push(`ОБРЕЗАНО: ${cut + dropped} старых событий не вошли в файл (лимит ${(maxBytes / 1048576).toFixed(0)} МБ: ${dropped} отброшено при сборке, ${cut} не выгружено из хранилища).` +
        (firstKept ? ` Самое старое включённое: ${L.fmtStamp(firstKept.t)} (#${firstKept.id}).` : ''));
    }
    info.push(`Событий в файле: ${keptEvents}` + (events.length ? `, период ${L.fmtStamp((firstKept || events[0]).t)} — ${L.fmtStamp(events[events.length - 1].t)}` : ''));
    const text = [...head, ...info, ...sum, '', '=== EVENTS ===', ...kept, ''].join('\n');
    return { text, included: keptEvents, dropped: dropped + cut, firstT: firstKept ? firstKept.t : 0, lastT: events.length ? events[events.length - 1].t : 0, maxId: events.length ? events[events.length - 1].id || 0 : 0 };
  };
  /** JSONL: first line {"_header": ctx}, then one event per line (newest kept within maxBytes). */
  L.buildJsonl = function ({ ctx, events = [], cut = 0, maxBytes = L.MAX_EXPORT_BYTES } = {}) {
    const lines = events.map((e) => json1(e));
    const exportedAt = Date.now();
    const header = (c) => json1({ _header: Object.assign({}, ctx, { format: 'ogx-diag-jsonl', version: L.version, cut: c, exportedAt }) });
    // Budget = cap minus the real header (its 'cut' is at most cut + lines.length, so this length is an upper bound).
    let budget = maxBytes - (L.utf8Len(header(cut + lines.length)) + 1); let i = lines.length;
    while (i > 0) { const b = L.utf8Len(lines[i - 1]) + 1; if (budget - b < 0) break; budget -= b; i--; }
    const head = header(cut + i);
    return { text: [head, ...lines.slice(i)].join('\n') + '\n', included: lines.length - i, dropped: cut + i };
  };
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** One HTML file with every snapshot in a <template> (readable as text; the inline viewer renders one in a sandboxed iframe). */
  L.buildSnapshotsHtml = function ({ ctx, snaps = [], cut = 0, maxBytes = L.MAX_EXPORT_BYTES } = {}) {
    const keep = [];
    let b = 0;
    for (let i = snaps.length - 1; i >= 0; i--) { const s = snaps[i]; const sz = L.utf8Len(s.html || '') + 600; if (b + sz > maxBytes && keep.length) break; b += sz; keep.unshift(s); }
    const dropped = cut + snaps.length - keep.length;
    const rows = keep.map((s) => `<tr><td>#${s.id}</td><td>${escHtml(L.fmtStamp(s.t))}</td><td>${escHtml(s.page || '')}</td><td>${escHtml(s.reason || '')}</td><td>${escHtml(s.url || '')}</td><td>${s.size || 0}</td><td><button data-id="${s.id}">показать</button></td></tr>`).join('\n');
    const blocks = keep.map((s) => `<!-- ===== OGX SNAPSHOT #${s.id} t=${L.fmtStamp(s.t)} page=${escHtml(s.page || '')} reason=${escHtml(String(s.reason || '').replace(/--/g, '-'))} url=${escHtml(s.url || '')} ===== -->\n<template id="snap-${s.id}">\n${String(s.html || '').replace(/<\/template/gi, '<\\/template')}\n</template>`).join('\n');
    const c = ctx || {};
    const text = `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>OGX снимки страниц</title>
<style>body{font:13px sans-serif;background:#111;color:#ddd;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #444;padding:3px 6px}iframe{width:100%;height:70vh;background:#fff;border:0;margin-top:8px}</style></head><body>
<h1>OGX снимки страниц</h1>
<p>${escHtml(c.extName || c.ext || '')} ${escHtml(c.extVersion || '')} · сервер ${escHtml(c.host || '-')} · выгрузка ${escHtml(L.fmtStamp(Date.now()))} ${escHtml(L.tzLabel())} · снимков ${keep.length}${dropped ? ' (не вошли ' + dropped + ' старых)' : ''}</p>
<p>Снимки очищены: без скриптов, значений полей ввода и токенов. Причина снимка = ключ алерта самообучения или ручной снимок.</p>
<table><tr><th>id</th><th>время</th><th>страница</th><th>причина</th><th>url</th><th>символов</th><th></th></tr>
${rows}
</table><iframe id="view" sandbox></iframe>
<script>document.addEventListener('click',function(e){var id=e.target&&e.target.getAttribute&&e.target.getAttribute('data-id');if(!id)return;var t=document.getElementById('snap-'+id);document.getElementById('view').srcdoc=t?t.innerHTML:'';});</script>
${blocks}
</body></html>\n`;
    return { text, included: keep.length, dropped };
  };

  /** Learning report (TXT) from the learning state (23-learn.js). */
  L.learnReport = function (state, { host, now = Date.now() } = {}) {
    const s = state || {};
    const out = [];
    out.push(`=== OGX отчёт самообучения (формат ${L.version}) ===`);
    out.push(`Сервер: ${host || s.host || '-'}  выгрузка ${L.fmtStamp(now)} ${L.tzLabel(now)}  начало обучения ${s.t0 ? L.fmtStamp(s.t0) : '-'}  ответов API учтено ${s.apiTotal || 0}`);
    const pages = s.pages || {};
    out.push('', '=== СТРАНИЦЫ ===');
    for (const name of Object.keys(pages).sort()) {
      const p = pages[name];
      const v = p.visits || 0;
      const toks = Object.entries(p.tokens || {});
      const stable = toks.filter(([, a]) => v && a[0] / v >= 0.9).length;
      out.push(`--- ${name}: визитов ${v}, токенов ${toks.length} (стабильных ≥90%: ${stable}), последний визит ${p.lastT ? L.fmtStamp(p.lastT) : '-'}`);
      const missing = toks.filter(([t, a]) => !L.isVolatileToken(t) && a[1] > 0 && v >= 3 && (a[0] / Math.max(1, v)) >= 0.5).sort((a, b) => b[1][1] - a[1][1]).slice(0, 30);
      if (missing.length) out.push('  пропадают сейчас (подряд): ' + missing.map(([t, a]) => `${t}×${a[1]}`).join(', '));
      const fresh = toks.filter(([t, a]) => !L.isVolatileToken(t) && a[2] > 5 && a[0] < 4).slice(0, 30);
      if (fresh.length) out.push('  новые: ' + fresh.map(([t, a]) => `${t}(с визита ${a[2]}, ×${a[0]})`).join(', '));
      const sels = Object.entries(p.sels || {}).map(([sel, a]) => ({ sel, v: a[0], h: a[1], streak: a[2] })).sort((a, b) => (a.h / Math.max(1, a.v)) - (b.h / Math.max(1, b.v)) || b.v - a.v);
      // A selector never found on this page is not drift: the code probes markup of another page or engine (OgameX
      // tokens such as #cutty / #sendall on GALAXYZ). Listed once, compactly, after the selectors that matter.
      const seen = sels.filter((x) => x.h > 0);
      const never = sels.filter((x) => !(x.h > 0));
      if (seen.length) {
        out.push('  селекторы (визитов, попаданий, доля, промахов подряд):');
        for (const x of seen.slice(0, 80)) out.push(`    ${x.v ? Math.round(100 * x.h / x.v) : 0}%  ${x.h}/${x.v}  streak=${x.streak}  ${x.sel}`);
      }
      if (never.length) out.push(`  ни разу не найдены на этой странице (проверки чужой разметки, не поломка): ${never.length} — ` + never.slice(0, 40).map((x) => x.sel).join(', ') + (never.length > 40 ? ` …+${never.length - 40}` : ''));
    }
    out.push('', '=== API (эндпоинт → вид ответа → ключи с частотой) ===');
    const api = s.api || {};
    for (const ep of Object.keys(api).sort()) {
      const a = api[ep];
      out.push(`--- ${ep}: ответов ${a.n || 0}, впервые ${a.first ? L.fmtStamp(a.first) : '-'}, последний ${a.last ? L.fmtStamp(a.last) : '-'}`);
      for (const [kind, k] of Object.entries(a.kinds || {})) {
        const keys = Object.entries(k.keys || {}).sort((x, y) => y[1] - x[1]);
        out.push(`  ${kind} (${k.n}): ` + keys.slice(0, 60).map(([key, n]) => `${key}${n < k.n ? ' ' + Math.round(100 * n / k.n) + '%' : ''}`).join(', ') + (keys.length > 60 ? ` …+${keys.length - 60}` : ''));
      }
    }
    out.push('', '=== АЛЕРТЫ (последние) ===');
    const log = s.alertLog || [];
    if (!log.length) out.push('  —');
    for (const a of log.slice(-50)) out.push(`  ${L.fmtStamp(a.t)} ${a.kind}: ${a.what}` + (a.data ? ' ' + json1(a.data).slice(0, 400) : ''));
    return out.join('\n') + '\n';
  };

  // ------------------------------------------------------------------ one-file export («Выгрузить логи»)
  L.FULL_MAX_BYTES = 10 * 1024 * 1024;     // whole file
  L.FULL_SNAP_BYTES = 2.5 * 1024 * 1024;   // compressed snapshots inside it
  L.FULL_SNAP_MAX = 8;
  /** Events that are always kept when the journal is trimmed: user actions, page/session/errors, learning, failures. */
  L.isKeyEvent = (e) => e.s === 'U' || e.s === 'S' || e.s === 'L' || e.s === 'G' || isErrorEvent(e);
  /**
   * Journal lines within maxBytes: every key event (L.isKeyEvent) first, then the newest of the rest; chronological, with
   * a marker line where routine events were left out. -> { lines, included, dropped, firstT, lastT, maxId }
   */
  L.trimJournal = function (events, maxBytes) {
    const n = events.length;
    const line = new Array(n);
    const size = new Array(n);
    let prev = null;
    for (let i = 0; i < n; i++) { line[i] = L.eventLine(events[i], prev); size[i] = L.utf8Len(line[i]) + 1; prev = events[i]; }
    const keep = new Uint8Array(n);
    let budget = maxBytes;
    // key events, newest first (when even they do not fit, the oldest key events go)
    for (let i = n - 1; i >= 0; i--) if (L.isKeyEvent(events[i]) && size[i] <= budget) { keep[i] = 1; budget -= size[i]; }
    // then the newest routine events until the budget is used
    for (let i = n - 1; i >= 0 && budget > 0; i--) if (!keep[i] && !L.isKeyEvent(events[i])) { if (size[i] > budget) break; keep[i] = 1; budget -= size[i]; }
    const lines = [];
    let day = null; let gap = 0; let included = 0; let firstT = 0; let prevKept = null;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) { gap++; continue; }
      const e = events[i];
      const d = L.fmtDate(e.t);
      if (d !== day) { lines.push(`--- ${d} ---`); day = d; prevKept = null; }
      if (gap) { lines.push(`… пропущено рядовых событий: ${gap} …`); gap = 0; }
      // pg/tb are re-stated after a gap: the line must stand on its own
      lines.push(L.eventLine(e, prevKept && keep[i - 1] ? prevKept : null));
      prevKept = e; included++;
      if (!firstT) firstT = e.t;
    }
    if (gap) lines.push(`… пропущено рядовых событий: ${gap} …`);
    return { lines, included, dropped: n - included, firstT, lastT: n ? events[n - 1].t : 0, maxId: n ? events[n - 1].id || 0 : 0 };
  };
  /** Snapshot HTML made small for the one-file export: no <style>/<svg>/<script> bodies, comments or blank runs. */
  L.compactHtml = function (html) {
    return String(html || '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '<svg></svg>')
      .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>')
      .replace(/<!--(?! ogx)[\s\S]*?-->/g, '')
      .replace(/[ \t\r\f\v]*\n[\s]*/g, '\n')
      .replace(/[ \t]{2,}/g, ' ');
  };
  /** Newest relevant snapshots: one per (page, reason), newest first, today's preferred, within bytes/count. */
  L.pickSnaps = function (snaps, { now = Date.now(), maxBytes = L.FULL_SNAP_BYTES, max = L.FULL_SNAP_MAX } = {}) {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const today = (snaps || []).filter((x) => x.t >= d.getTime());
    const pool = (today.length ? today : (snaps || []).slice(-3)).slice().sort((a, b) => b.t - a.t);
    const seen = new Set(); const out = []; let bytes = 0;
    for (const sn of pool) {
      if (out.length >= max) break;
      const k = (sn.page || '') + '|' + String(sn.reason || '').replace(/\d+/g, '#');
      if (seen.has(k)) continue;
      let html = L.compactHtml(sn.html);
      // one snapshot larger than the whole budget: its start (head, menus, page content) is still useful
      if (!out.length && L.utf8Len(html) + 300 > maxBytes) html = html.slice(0, Math.floor((maxBytes - 400) / 3)) + '\n<!-- OGX: снимок обрезан для выгрузки -->';
      const b = L.utf8Len(html) + 300;
      if (bytes + b > maxBytes) continue;
      seen.add(k); bytes += b;
      out.push(Object.assign({}, sn, { html, size: html.length, origSize: (sn.html || '').length }));
    }
    return { snaps: out.reverse(), total: (snaps || []).length, bytes };
  };
  /**
   * The one file for debugging: header (extension, server, every module and core setting), contents, all settings and
   * bot data as JSON, the learning report, the journal of today (trimmed: key events + newest), compact snapshots.
   * { ctx, events, cut, learn, snaps, extras: { settings?, bot? }, now, maxBytes } -> { text, info }
   */
  L.buildFull = function ({ ctx, events = [], cut = 0, learn = null, snaps = [], extras = null, now = Date.now(), maxBytes = L.FULL_MAX_BYTES } = {}) {
    const c = Object.assign({}, ctx, { exportKind: 'всё в одном файле (журнал за сегодня, самообучение, снимки, настройки)' });
    const head = L.headerLines(c, events, now);
    head[0] = `=== OGX полная выгрузка для разбора (формат ${L.version}) ===`;
    const learnTxt = L.learnReport(learn, { host: c.host, now });
    const ps = L.pickSnaps(snaps, { now, maxBytes: Math.min(L.FULL_SNAP_BYTES, Math.floor(maxBytes / 4)) });
    const ex = extras || {};
    const jsonBlock = (title, v) => (v === undefined || v === null ? [] : ['', `=== ${title} ===`, json1(L.redact(v, { maxStr: 2000 }))]);
    const settingsPart = jsonBlock('НАСТРОЙКИ (все, JSON)', ex.settings);
    const botPart = ex.bot && Object.keys(ex.bot).length ? jsonBlock('БОТ (решения и состояние, JSON)', ex.bot) : ['', '=== БОТ ===', 'нет данных бота (модуль бота не установлен или ещё ничего не решал)'];
    const snapLines = ['', '=== СНИМКИ СТРАНИЦ ===', `Снимков в хранилище: ${ps.total}, в файле: ${ps.snaps.length} (новейшие, по одному на страницу и причину; сжаты: без style/svg/script и пустых строк)`];
    for (const sn of ps.snaps) {
      snapLines.push('', `----- СНИМОК #${sn.id} ${L.fmtStamp(sn.t)} страница=${sn.page || '-'} url=${sn.url || '-'} причина=${String(sn.reason || '').replace(/\s+/g, ' ').slice(0, 300)} (${sn.origSize} → ${sn.size} символов) -----`);
      snapLines.push(sn.html);
      snapLines.push(`----- КОНЕЦ СНИМКА #${sn.id} -----`);
    }
    const sum = ['', '=== SUMMARY (журнал за сегодня целиком) ===', ...L.summary(events)];
    const fixed = [...head, ...settingsPart, ...botPart, '', '=== ОТЧЁТ САМООБУЧЕНИЯ ===', learnTxt, ...sum, ...snapLines].join('\n');
    const journalBudget = Math.max(64 * 1024, Math.min(L.MAX_EXPORT_BYTES, maxBytes - L.utf8Len(fixed) - 2000));
    const j = L.trimJournal(events, journalBudget);
    const info = [];
    info.push(`Состав: журнал ${j.included} из ${events.length} событий за сегодня` + (j.dropped ? ` (не вошли ${j.dropped} рядовых: сохранены все действия пользователя, страницы, ошибки, алерты)` : '')
      + (cut ? `, ещё ${cut} событий не выгружено из хранилища` : '') + `; снимков ${ps.snaps.length}; отчёт самообучения; настройки` + (ex.bot && Object.keys(ex.bot).length ? '; данные бота' : '') + '.');
    if (events.length) info.push(`Период журнала: ${L.fmtStamp(events[0].t)} — ${L.fmtStamp(events[events.length - 1].t)}`);
    let text = [...head, ...info, ...settingsPart, ...botPart, '', '=== ОТЧЁТ САМООБУЧЕНИЯ ===', learnTxt, ...sum, '', '=== EVENTS ===', ...j.lines, ...snapLines, '', '=== КОНЕЦ ВЫГРУЗКИ ===', ''].join('\n');
    // last pass over the whole file: registered secrets (live CSRF token), emails, token/session query values, session cookies
    text = L.redactString(text, 0);
    // backstop: the journal keeps at least 64 KB, so the file may pass maxBytes by that much; a huge learn report / settings
    // block must never push it further (cut at the end, the header and journal stay)
    const hardMax = maxBytes + 128 * 1024;
    if (L.utf8Len(text) > hardMax) {
      let part = text.slice(0, hardMax);
      while (L.utf8Len(part) > hardMax - 300) part = part.slice(0, Math.floor(part.length * 0.95));
      text = part + '\n… выгрузка обрезана до ' + hardMax + ' байт …\n=== КОНЕЦ ВЫГРУЗКИ ===\n';
    }
    return { text, info: { events: j.included, dropped: j.dropped + cut, snaps: ps.snaps.length, maxId: j.maxId, bytes: L.utf8Len(text) } };
  };

  // ------------------------------------------------------------------ export (shared by the popup and the page)
  /**
   * Builds an export from a backend { flush?, context(), query(q), snaps(q), getMeta(k), setMeta(k, v), learnState(host), kind }.
   * what: 'full' (one file with everything: «Выгрузить логи») | 'new' (since the last export) | 'today' | 'last' (opts.n,
   * default 5000) | 'jsonl' | 'snaps' | 'learn'.
   * Event exports move the 'lastExportId' marker to the newest exported event. -> { text, filename, mime, info }
   */
  L.exportData = async function (b, what, opts = {}) {
    const now = opts.now || Date.now();
    if (b.flush) { try { await b.flush(); } catch (e) { /* ignore */ } }
    let ctx = {};
    try { ctx = (await b.context()) || {}; } catch (e) { ctx = {}; }
    ctx = Object.assign({}, ctx, opts.ctx || {});
    if (!ctx.storeKind) ctx.storeKind = typeof b.kind === 'function' ? b.kind() : b.kind;
    const ext = String(ctx.ext || 'ogx').replace(/[^a-z0-9-]+/gi, '_');
    const host = String(ctx.host || 'host').replace(/[^a-z0-9.-]+/gi, '_');
    const stamp = L.fileStamp(now);
    if (what === 'learn') {
      const st = b.learnState ? await b.learnState(ctx.host) : null;
      return { text: L.learnReport(st, { host: ctx.host, now }), filename: `ogx-${ext}-learn-${host}-${stamp}.txt`, mime: 'text/plain', info: { pages: st && st.pages ? Object.keys(st.pages).length : 0 } };
    }
    if (what === 'full') {
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      const r = await b.query({ sinceT: d0.getTime(), maxBytes: 64 * 1024 * 1024 });
      const events = r.events || [];
      let learnSt = null; let snaps = []; let extras = null;
      try { learnSt = b.learnState ? await b.learnState(ctx.host) : null; } catch (e) { learnSt = null; }
      try { snaps = (await b.snaps({ sinceT: d0.getTime() - 24 * 3600 * 1000, last: 40 })).snaps || []; } catch (e) { snaps = []; }
      try { extras = b.extras ? await b.extras(ctx.host) : null; } catch (e) { extras = null; }
      const out = L.buildFull({ ctx, events, cut: r.cut || 0, learn: learnSt, snaps, extras, now, maxBytes: opts.maxBytes || L.FULL_MAX_BYTES });
      if (out.info.maxId) { try { await b.setMeta('lastExportId', out.info.maxId); } catch (e) { /* ignore */ } }
      return { text: out.text, filename: `ogx-${ext}-logs-${host}-${stamp}.txt`, mime: 'text/plain', info: out.info };
    }
    if (what === 'snaps') {
      const r = await b.snaps({});
      const out = L.buildSnapshotsHtml({ ctx, snaps: r.snaps, cut: r.cut, maxBytes: opts.maxBytes || L.MAX_EXPORT_BYTES });
      return { text: out.text, filename: `ogx-${ext}-snapshots-${host}-${stamp}.html`, mime: 'text/html', info: { snaps: out.included, dropped: out.dropped } };
    }
    let q; let label;
    if (what === 'new') { const last = +(await b.getMeta('lastExportId')) || 0; q = { sinceId: last }; label = 'новое с прошлой выгрузки (после события #' + last + ')'; }
    else if (what === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); q = { sinceT: d.getTime() }; label = 'за сегодня'; }
    else if (what === 'last') { const n = Math.max(1, Math.min(100000, Math.floor(+opts.n || 5000))); q = { last: n }; label = 'последние ' + n; }
    else if (what === 'jsonl') { q = {}; label = 'JSONL'; }
    else throw new Error('unknown export ' + what);
    const maxBytes = opts.maxBytes || L.MAX_EXPORT_BYTES;
    q.maxBytes = Math.floor(maxBytes * 1.5);
    const r = await b.query(q);
    const events = r.events || [];
    const built = what === 'jsonl' ? L.buildJsonl({ ctx, events, cut: r.cut || 0, maxBytes }) : L.buildTxt({ ctx, events, cut: r.cut || 0, exportKind: label, now, maxBytes });
    const maxId = events.length ? events[events.length - 1].id || 0 : 0;
    if (maxId) { try { await b.setMeta('lastExportId', maxId); } catch (e) { /* ignore */ } }
    return { text: built.text, filename: `ogx-${ext}-log-${what}-${host}-${stamp}.${what === 'jsonl' ? 'jsonl' : 'txt'}`, mime: what === 'jsonl' ? 'application/x-ndjson' : 'text/plain',
      info: { events: built.included, dropped: built.dropped, maxId } };
  };
  /** Saves text as a file through a Blob and an <a download> click (no downloads permission needed). */
  L.download = function (filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) { /* ignore */ } }, 1500);
    return true;
  };

  root.OGXDiagLib = L;
  if (root.OGX) root.OGX.diaglib = L;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
