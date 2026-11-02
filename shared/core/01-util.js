/* shared/core/01-util.js — number parsing, coords, helpers, Russian formatting. Owner: core. */
(function (OGX) {
  'use strict';
  const util = (OGX.util = OGX.util || {});
  const fmt = (OGX.fmt = OGX.fmt || {});

  // ------------------------------------------------------------------ number parsing (OgameX en formats)
  const SUFFIX = { mn: 1e6, m: 1e6, b: 1e9, k: 1e3 };
  /** Number dialect of the current page: 'ogamex' (',' thousands) or 'galaxyz' ('.' thousands, ',' decimals). Set by
   * OGX.page.detect(); parseGameNumber/parseGameNumberEx follow it. */
  util.numberDialect = util.numberDialect || 'ogamex';
  /** "152,347" -> 152347; "+4,128" -> 4128; "1.234Mn" -> 1234000; "2B" -> 2e9; "152347.29861111" -> 152347.29861111
   * (GALAXYZ pages: see parseGzNumberEx). */
  util.parseGameNumberEx = function (s) {
    if (typeof s === 'number') return { value: s, approx: false };
    if (util.numberDialect === 'galaxyz') return util.parseGzNumberEx(s);
    let str = String(s == null ? '' : s).replace(/[\s  ]+/g, '').replace(/^\+/, '');
    if (!str) return { value: 0, approx: false };
    const m = /^(-?)([\d,]*\.?\d+)(Mn|M|B|K)?$/i.exec(str);
    if (m) {
      const num = parseFloat(m[2].replace(/,/g, ''));
      const suf = m[3] ? SUFFIX[m[3].toLowerCase()] : 1;
      let v = num * suf;
      if (m[3]) v = Math.round(v);
      return { value: (m[1] ? -1 : 1) * v, approx: !!m[3] };
    }
    const n = parseInt(str.replace(/[^\d-]/g, ''), 10);
    return { value: Number.isFinite(n) ? n : 0, approx: false };
  };
  util.parseGameNumber = (s) => util.parseGameNumberEx(s).value;
  /** formatNumberShort with ',' as DECIMAL separator: "7,7K" -> 7700, "15K" -> 15000, "2Mn" -> 2000000, "999" -> 999 */
  util.parseShortComma = function (s) {
    const str = String(s == null ? '' : s).replace(/[\s ]+/g, '');
    const m = /^(-?\d+(?:,\d+)?)(Mn|M|B|K)?$/i.exec(str);
    if (!m) return util.parseGameNumber(str);
    const v = parseFloat(m[1].replace(',', '.'));
    return Math.round(v * (m[2] ? SUFFIX[m[2].toLowerCase()] : 1));
  };
  /** phalanx number_format(n, 0, ',', '.'): "1.250" -> 1250 */
  util.parseDotThousands = function (s) {
    const n = parseInt(String(s == null ? '' : s).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };
  // GALAXYZ / 2Moons (specs/galaxyz/layout.md §12): pretty_number "1.908.057.266" ('.' thousands, ',' decimals: "41,7").
  // Two short forms: JS shortly_number "2.064 M" (space/NBSP before the unit, '.' thousands, LONG scale: M=1e6, B=1e12,
  // T=1e18) and the server's header text "47.5K" / "4K" (no space, '.' DECIMAL, short scale). Prefer exact values
  // (data-real, t=, title tooltips, resourceTicker) whenever they exist.
  const GZ_LONG = { k: 1e3, m: 1e6, b: 1e12, t: 1e18 };
  const GZ_SHORT = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  /** GALAXYZ text -> { value, approx }: "1.908.057.266" 1908057266 · "-14.214" · "41,7" 41.7 · "2.064 M" 2.064e9 · "47.5K" 47500 · "4K" */
  util.parseGzNumberEx = function (s) {
    if (typeof s === 'number') return { value: s, approx: false };
    const raw = String(s == null ? '' : s).replace(/&nbsp;/g, ' ').replace(/[\u00a0\u202f]/g, ' ').trim().replace(/^\+/, '');
    if (!raw) return { value: 0, approx: false };
    const m = /^(-?[\d.,]*\d)(\s*)([KMBT])$/i.exec(raw);
    if (m) {
      const u = m[3].toLowerCase();
      const v = m[2] ? util.parseGzNumber(m[1]) * GZ_LONG[u] : parseFloat(m[1].replace(',', '.')) * GZ_SHORT[u];
      return { value: Math.round(v), approx: true };
    }
    const n = /-?\d[\d.]*(?:,\d+)?/.exec(raw.replace(/\s+/g, ''));
    if (!n) return { value: 0, approx: false };
    const v = parseFloat(n[0].replace(/\./g, '').replace(',', '.'));
    return { value: Number.isFinite(v) ? v : 0, approx: false };
  };
  util.parseGzNumber = (s) => util.parseGzNumberEx(s).value;
  /** GALAXYZ dates (php_tdformat 'd. M Y, H:i:s'): "30. Oct 2026, 10:20:01" -> wall-clock ms read as UTC (zone-free).
   * English, Russian and German month abbreviations. null when it does not match. */
  const GZ_MONTHS = ['jan|янв|jän', 'feb|фев', 'mar|мар|mär|mrz', 'apr|апр', 'may|май|mai', 'jun|июн', 'jul|июл', 'aug|авг', 'sep|сен', 'oct|окт|okt', 'nov|ноя', 'dec|дек|dez'];
  util.parseGzDate = function (s) {
    const m = /(\d{1,2})\.\s*([^\s\d.,]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const mon = m[2].toLowerCase().slice(0, 3);
    const mi = GZ_MONTHS.findIndex((alts) => alts.split('|').includes(mon));
    return mi < 0 ? null : Date.UTC(+m[3], mi, +m[1], +m[4], +m[5], +m[6]);
  };
  /** "PT1W4D2H40M" (W and D inside the time part) -> seconds */
  util.parseIsoDuration = function (s) {
    const m = /^P(?:T)?(?:(\d+)W)?(?:(\d+)D)?(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(s || '').trim());
    if (!m) return 0;
    return (+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + Math.floor(+m[5] || 0);
  };

  // ------------------------------------------------------------------ coords
  /** Coords 'g:s:p' from "[1:42:8]", "1:42:8" or any text; takes the LAST match. Arrays [g,s,p] are accepted too. */
  util.coords = function (s) {
    if (s == null) return null;
    if (Array.isArray(s)) return s.length >= 3 ? `${+s[0]}:${+s[1]}:${+s[2]}` : null;
    if (typeof s === 'object' && s.galaxy != null) return `${+s.galaxy}:${+s.system}:${+s.position}`;
    const all = [...String(s).matchAll(/(\d+):(\d+):(\d+)/g)];
    if (!all.length) return null;
    const m = all[all.length - 1];
    return `${+m[1]}:${+m[2]}:${+m[3]}`;
  };
  util.coordsArr = (c) => { const k = util.coords(c); return k ? k.split(':').map(Number) : null; };
  util.coordsObj = (c) => { const a = util.coordsArr(c); return a ? { galaxy: a[0], system: a[1], position: a[2] } : null; };
  util.sameSystem = (a, b) => {
    const x = util.coordsArr(a); const y = util.coordsArr(b);
    return !!(x && y && x[0] === y[0] && x[1] === y[1]);
  };

  // ------------------------------------------------------------------ helpers
  util.debounce = function (fn, ms) {
    let t = null;
    const d = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  };
  util.throttle = function (fn, ms) {
    let last = 0; let t = null; let pending = null;
    return function (...a) {
      const now = Date.now();
      pending = a;
      if (now - last >= ms) { last = now; fn.apply(this, a); pending = null; return; }
      if (!t) t = setTimeout(() => { t = null; last = Date.now(); if (pending) fn.apply(this, pending); pending = null; }, ms - (now - last));
    };
  };
  util.sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
  util.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  util.clone = function (o) {
    if (o === undefined || o === null || typeof o !== 'object') return o;
    try { if (typeof structuredClone === 'function') return structuredClone(o); } catch (e) { /* fall back */ }
    return JSON.parse(JSON.stringify(o));
  };
  util.sum = (r) => (r ? (+r.metal || 0) + (+r.crystal || 0) + (+r.deuterium || 0) : 0);
  util.res = (m = 0, c = 0, d = 0) => ({ metal: m, crystal: c, deuterium: d });
  util.isEmpty = (o) => !o || Object.keys(o).length === 0;
  util.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  util.shipsTotal = (ships) => Object.values(ships || {}).reduce((s, n) => s + (+n || 0), 0);
  /** Parse "a=1&b=2" (URL-encoded form body) into an object; repeated keys become arrays. */
  util.parseForm = function (body) {
    const out = {};
    if (body == null || body === '') return out;
    let params;
    try { params = new URLSearchParams(String(body)); } catch (e) { return out; }
    for (const [k, v] of params) {
      if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
    }
    return out;
  };

  // ------------------------------------------------------------------ Russian formatting
  const NBSP = ' ';
  function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  fmt.num = function (n) {
    n = +n;
    if (!Number.isFinite(n)) return '—';
    const t = Math.trunc(n);
    const s = group(String(Math.abs(t)));
    return (t < 0 ? '-' : '') + s;
  };
  fmt.short = function (n) {
    n = +n;
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a < 10000) return fmt.num(n);
    let v; let unit;
    // economy x22000 makes trillions common: «2,53 трлн», not «2530 млрд»; past the last unit the integer part is grouped
    if (a >= 1e15) { v = n / 1e15; unit = 'квадрлн'; } else if (a >= 1e12) { v = n / 1e12; unit = 'трлн'; } else if (a >= 1e9) { v = n / 1e9; unit = 'млрд'; }
    else if (a >= 1e6) { v = n / 1e6; unit = 'млн'; } else { v = n / 1e3; unit = 'тыс.'; }
    const av = Math.abs(v);
    const digits = av >= 100 ? 0 : av >= 10 ? 1 : 2;
    let s = (Math.trunc(v * 10 ** digits) / 10 ** digits).toFixed(digits);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (av >= 1000) s = fmt.num(Math.trunc(v));
    return s.replace('.', ',') + NBSP + unit;
  };
  fmt.auto = function (n) {
    let style = 'full';
    try { style = OGX.settings.get('core.numberStyle') || 'full'; } catch (e) { /* default */ }
    return style === 'short' ? fmt.short(n) : fmt.num(n);
  };
  fmt.signed = (n) => { n = +n; if (!Number.isFinite(n)) return '—'; return (n > 0 ? '+' : '') + fmt.num(n); };
  fmt.pct = (x, digits = 0) => { x = +x; if (!Number.isFinite(x)) return '—'; return (x * 100).toFixed(digits).replace('.', ',') + '%'; };
  const p2 = (n) => String(n).padStart(2, '0');
  fmt.duration = function (secs) {
    secs = +secs;
    if (!Number.isFinite(secs)) return '∞';
    if (secs <= 0) return 'Готово';
    secs = Math.floor(secs);
    if (secs < 60) return secs + 'с';
    const w = Math.floor(secs / 604800);
    const d = Math.floor((secs % 604800) / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (secs < 3600) return `${m}:${p2(s)}`;
    if (secs < 86400) return `${h}:${p2(m)}:${p2(s)}`;
    if (secs < 604800) return `${d}д ${p2(h)}:${p2(m)}:${p2(s)}`;
    return `${w}н ${d}д ${p2(h)}:${p2(m)}`;
  };
  fmt.durationShort = function (secs) {
    secs = +secs;
    if (!Number.isFinite(secs)) return '∞';
    if (secs <= 0) return 'Готово';
    secs = Math.floor(secs);
    const d = Math.floor(secs / 86400); const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60); const s = secs % 60;
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    if (m > 0) return `${m}м ${s}с`;
    return `${s}с`;
  };
  /** Wall-clock parts of a ServerMs in the display zone (core.timeDisplay: 'server' | 'local'). */
  function wallParts(serverMs) {
    let zone = 'server';
    try { zone = OGX.settings.get('core.timeDisplay') || 'server'; } catch (e) { /* default */ }
    if (zone === 'local') {
      const d = new Date(serverMs);
      return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
    }
    const tz = (OGX.time && +OGX.time.tzOffsetMs) || 0;
    const d = new Date(serverMs + tz);
    return { Y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  fmt._wallParts = wallParts;
  fmt.time = function (serverMs) {
    if (!Number.isFinite(+serverMs)) return '—';
    const p = wallParts(+serverMs);
    return `${p2(p.h)}:${p2(p.m)}:${p2(p.s)}`;
  };
  fmt.dateTime = function (serverMs) {
    if (!Number.isFinite(+serverMs)) return '—';
    const p = wallParts(+serverMs);
    const nowMs = OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now();
    const y = wallParts(nowMs).Y;
    return `${p2(p.D)}.${p2(p.M)}${p.Y !== y ? '.' + p.Y : ''} ${p2(p.h)}:${p2(p.m)}:${p2(p.s)}`;
  };
  fmt.coords = function (c, type) {
    const k = util.coords(c);
    if (!k) return '—';
    const t = type === 3 || type === 'moon' ? NBSP + 'Л' : type === 2 || type === 'debris' ? NBSP + 'ПО' : '';
    return `[${k}]${t}`;
  };
  fmt.res = function (r, { short = false } = {}) {
    const f = short ? fmt.short : fmt.num;
    r = r || {};
    return `М ${f(r.metal || 0)} · К ${f(r.crystal || 0)} · Д ${f(r.deuterium || 0)}`;
  };
  fmt.plural = function (n, forms) {
    const a = Math.abs(Math.trunc(+n)) % 100; const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };
  fmt.ago = function (serverMs) {
    if (!Number.isFinite(+serverMs)) return '—';
    const now = OGX.time && OGX.time.serverNow ? OGX.time.serverNow() : Date.now();
    const s = Math.max(0, Math.floor((now - serverMs) / 1000));
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    return Math.floor(s / 86400) + ' д назад';
  };
})(window.OGX);
