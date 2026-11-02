/* shared/core/04-settings.js — settings registry with schema, defaults, validation and change events. Owner: core.
 * Stored in the player-scope key 'settings' as nested objects { ns: { key: value } } (HARNESS.md §4 seeds this shape).
 * Internally values are kept flat ('ns.key' -> value). */
(function (OGX) {
  'use strict';
  const st = (OGX.settings = OGX.settings || {});
  const schemas = {};          // ns -> { key: spec }
  let values = {};             // 'ns.key' -> stored value
  let loaded = false;
  const listeners = [];        // {sel, fn}
  const STORE_KEY = 'settings';

  const CORE = {
    logLevel: { type: 'enum', default: 'warn', label: 'Уровень журнала', section: 'Общие',
      options: [{ value: 'debug', label: 'Отладка' }, { value: 'info', label: 'Информация' }, { value: 'warn', label: 'Предупреждения' }, { value: 'error', label: 'Только ошибки' }] },
    tickMs: { type: 'int', default: 1000, min: 250, max: 5000, step: 250, label: 'Частота обновления таймеров, мс', section: 'Общие' },
    numberStyle: { type: 'enum', default: 'full', label: 'Формат чисел', section: 'Общие',
      options: [{ value: 'full', label: 'Полный (1 234 567)' }, { value: 'short', label: 'Краткий (1,23 млн)' }] },
    timeDisplay: { type: 'enum', default: 'server', label: 'Показывать время', section: 'Общие',
      options: [{ value: 'server', label: 'Время сервера' }, { value: 'local', label: 'Местное время' }] },
    tzOffsetMinutes: { type: 'string', default: 'auto', label: 'Часовой пояс сервера', section: 'Общие',
      hint: '«auto» — определить автоматически, иначе смещение от UTC в минутах (например 180)' },
    httpGapMs: { type: 'int', default: 400, min: 200, max: 5000, step: 100, label: 'Пауза между фоновыми запросами, мс', section: 'Запросы' },
    flightsPollSec: { type: 'int', default: 60, min: 0, max: 600, label: 'Опрос событий флота, с (0 = выкл.)', section: 'Запросы' },
    galaxyScanDelayMs: { type: 'int', default: 700, min: 500, max: 10000, step: 100, label: 'Пауза между системами при сканировании, мс', section: 'Запросы' },
    galaxyScanPerHour: { type: 'int', default: 300, min: 10, max: 3600, label: 'Лимит фоновых сканов систем в час', section: 'Запросы' },
    // OgameX /ajax/galaxy only (17-galaxy.js): GALAXYZ galaxy pages are full pages, nothing to repair -> not shown there
    galaxyRepair: { type: 'bool', default: true, label: 'Исправлять зависание галактики на уничтоженных планетах', section: 'Галактика', engines: ['ogamex'] },
    backgroundWhenHidden: { type: 'bool', default: false, label: 'Фоновые запросы во вкладке в фоне', section: 'Запросы' },
    confirmActions: { type: 'bool', default: true, label: 'Подтверждать отправку флота и постройки', section: 'Безопасность' },
    cpConfirmed: { type: 'bool', default: false, hidden: true, label: 'Предупреждение о смене текущей планеты принято' },
  };
  schemas.core = Object.assign({}, CORE);

  st.define = function (ns, schema) {
    schemas[ns] = Object.assign(schemas[ns] || {}, schema || {});
  };
  const split = (path) => { const i = String(path).indexOf('.'); return i < 0 ? [String(path), ''] : [path.slice(0, i), path.slice(i + 1)]; };
  function spec(path) { const [ns, key] = split(path); return schemas[ns] ? schemas[ns][key] : undefined; }

  /** Validate and clamp a value by its spec; returns { ok, value }. */
  function validate(sp, v) {
    if (!sp) return { ok: true, value: v };
    switch (sp.type) {
      case 'bool':
        if (typeof v === 'string') return { ok: true, value: v === 'true' || v === '1' || v === 'on' };
        return { ok: true, value: !!v };
      case 'int':
      case 'float': {
        let n = sp.type === 'int' ? parseInt(v, 10) : parseFloat(v);
        if (!Number.isFinite(n)) return { ok: false, value: sp.default };
        if (sp.min != null) n = Math.max(sp.min, n);
        if (sp.max != null) n = Math.min(sp.max, n);
        return { ok: true, value: n };
      }
      case 'enum': {
        const opts = sp.options || [];
        const hit = opts.find((o) => o.value === v) || opts.find((o) => String(o.value) === String(v));
        return hit ? { ok: true, value: hit.value } : { ok: false, value: sp.default };
      }
      case 'string':
        return { ok: true, value: v == null ? '' : String(v) };
      case 'color':
        return /^#[0-9a-f]{3,8}$/i.test(String(v)) ? { ok: true, value: String(v) } : { ok: false, value: sp.default };
      case 'hotkey':
        return { ok: true, value: normalizeHotkey(v) };
      case 'json':
        try { return { ok: true, value: v === undefined ? sp.default : JSON.parse(JSON.stringify(v)) }; } catch (e) { return { ok: false, value: sp.default }; }
      default:
        return { ok: true, value: v };
    }
  }
  /** "alt+shift+i" -> "Alt+Shift+I"; '' disables. Modifier order Ctrl, Alt, Shift, Meta. */
  function normalizeHotkey(v) {
    if (!v) return '';
    const parts = String(v).split('+').map((p) => p.trim()).filter(Boolean);
    const mods = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta' };
    const have = new Set(); let key = '';
    for (const p of parts) {
      const m = mods[p.toLowerCase()];
      if (m) have.add(m); else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
    }
    if (!key) return '';
    return ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => have.has(m)).concat(key).join('+');
  }
  st.normalizeHotkey = normalizeHotkey;

  /** Nested stored object -> flat map. Flat legacy keys ('ns.key' at top level) are accepted too. */
  function flatten(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [ns, v] of Object.entries(obj)) {
      if (ns.includes('.')) { out[ns] = v; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) out[ns + '.' + k] = x;
    }
    return out;
  }
  const nestPut = (o, path, v) => {
    const [ns, key] = split(path);
    const n = Object.assign({}, o || {});
    n[ns] = Object.assign({}, (n[ns] && typeof n[ns] === 'object') ? n[ns] : {}, { [key]: v });
    return n;
  };
  st._flatten = flatten;

  st.load = async function () {
    const v = await OGX.storage.get(STORE_KEY, {});
    values = flatten(v);
    loaded = true;
    if (!st._sub) {
      // Remote tabs and importAll() write the whole object; our own set() already updated `values`, so it fires nothing twice.
      st._sub = OGX.storage.subscribe(STORE_KEY, (nv) => {
        const old = values;
        values = flatten(nv);
        const keys = new Set([...Object.keys(old), ...Object.keys(values)]);
        for (const k of keys) if (JSON.stringify(old[k]) !== JSON.stringify(values[k])) fire(k, st.get(k));
      });
    }
  };
  st.isLoaded = () => loaded;
  st.get = function (path) {
    const sp = spec(path);
    if (Object.prototype.hasOwnProperty.call(values, path)) {
      const r = validate(sp, values[path]);
      return r.ok ? r.value : (sp ? sp.default : undefined);
    }
    return sp ? OGX.util.clone(sp.default) : undefined;
  };
  st.set = async function (path, value) {
    const r = validate(spec(path), value);
    const v = r.value;
    values[path] = v;
    await OGX.storage.update(STORE_KEY, (o) => nestPut(o, path, v), {});
    fire(path, v);
  };
  function fire(path, value) {
    OGX.bus.emit('settings:changed', { key: path, value });
    const [ns] = split(path);
    for (const l of listeners.slice()) {
      if (l.sel === '*' || l.sel === path || l.sel === ns) l.fn(path, value);
    }
  }
  st.all = function (ns) {
    if (ns) {
      const out = {};
      const keys = new Set(Object.keys(schemas[ns] || {}));
      for (const k of Object.keys(values)) if (k.startsWith(ns + '.')) keys.add(k.slice(ns.length + 1));
      for (const k of keys) out[k] = st.get(ns + '.' + k);
      return out;
    }
    const out = {};
    for (const n of Object.keys(schemas)) for (const k of Object.keys(schemas[n])) out[n + '.' + k] = st.get(n + '.' + k);
    for (const k of Object.keys(values)) if (!(k in out)) out[k] = st.get(k);
    return out;
  };
  st.schema = function (ns) {
    if (ns) return { [ns]: Object.assign({}, schemas[ns] || {}) };
    const out = {};
    for (const n of Object.keys(schemas)) out[n] = Object.assign({}, schemas[n]);
    return out;
  };
  st.onChange = function (sel, fn) {
    const l = { sel, fn: OGX.safe(fn, 'settings:' + sel) };
    listeners.push(l);
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  };
  st.reset = async function (ns) {
    const removed = Object.keys(values).filter((k) => k.startsWith(ns + '.'));
    for (const k of removed) delete values[k];
    await OGX.storage.update(STORE_KEY, (o) => {
      const n = Object.assign({}, o || {});
      delete n[ns];
      for (const k of Object.keys(n)) if (k.startsWith(ns + '.')) delete n[k];
      return n;
    }, {});
    for (const k of removed) fire(k, st.get(k));
  };
})(window.OGX);
