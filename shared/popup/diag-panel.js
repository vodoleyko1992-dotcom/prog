/* shared/popup/diag-panel.js — reusable "Логи для разбора" panel. Owner: core.
 * Needs shared/core/21-diaglib.js loaded first. Plain DOM, no OGX core required.
 *   Extension popup / options page: put <div id="ogx-diag-panel"></div> in the page and load
 *     <link rel="stylesheet" href="../shared/popup/diag-panel.css">
 *     <script src="../shared/core/21-diaglib.js"></script> <script src="../shared/popup/diag-panel.js"></script>
 *   The panel mounts itself there (extension pages only) and reads the extension-origin IndexedDB 'ogx-diag' directly.
 *   In the game page (Infinity side panel, userscript): OGX.diag.mountPanel(container) — page backend, CSS injected.
 * OGXDiagPanel.mount(container, { backend, title, settingsNode?: () => Node, injectCss? }) -> { el, refresh() } */
(function (root) {
  'use strict';
  if (root.OGXDiagPanel) { if (root.OGX) root.OGX.diagPanel = root.OGXDiagPanel; return; }
  const P = {};
  // stored bot keys: 'bot.*' plus one prefix per bot module (botcore.status, botfarm.targets, botbuild.plan, ...)
  const BOT_KEY = /^bot(?:core|sim|panel|save|farm|debris|build|expo)?\./;
  P.CSS = `.ogx-diag{font:12px/1.4 Arial,Helvetica,sans-serif;color:#cfd8e3;background:#0d1014;padding:10px;min-width:300px;box-sizing:border-box}
.ogx-diag *{box-sizing:border-box}
.ogx-panel .ogx-diag{background:transparent;padding:2px 0;min-width:0}
.ogx-diag-title{font-size:14px;font-weight:bold;margin:0 0 6px;color:#6f9fd8}
.ogx-diag-stats{color:#8a99ab;margin:0 0 8px;min-height:16px}
.ogx-diag-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ogx-diag-btn{display:block;width:100%;padding:6px 8px;border:1px solid #2b3846;border-radius:3px;background:#161c24;color:#cfd8e3;cursor:pointer;font:inherit;text-align:center}
.ogx-diag-btn:hover{border-color:#6f9fd8;color:#fff}
.ogx-diag-btn:disabled{opacity:.5;cursor:wait}
.ogx-diag-btn-primary{background:#1d3550;border-color:#6f9fd8}
.ogx-diag-btn-danger{border-color:#7a2a2a;color:#f0a0a0}
.ogx-diag-last{display:flex;gap:4px;grid-column:span 2}
.ogx-diag-last .ogx-diag-btn{flex:1}
.ogx-diag-n{width:80px;padding:4px;border:1px solid #2b3846;background:#0d1014;color:#cfd8e3;border-radius:3px;font:inherit}
.ogx-diag-wide{grid-column:span 2}
.ogx-diag-status{margin-top:8px;min-height:16px;color:#4caf50;word-break:break-all}
.ogx-diag-status.ogx-diag-err{color:#f44336}
.ogx-diag-hint{margin-top:8px;color:#8a99ab;font-size:11px}
.ogx-diag-settings{margin-top:10px;border-top:1px solid #2b3846;padding-top:8px}
.ogx-diag-full{display:block;width:100%;padding:10px 8px;margin:0 0 4px;font-size:14px;font-weight:bold;background:#1d3550;border-color:#6f9fd8;color:#fff}
.ogx-diag-full-note{color:#8a99ab;font-size:11px;margin:0 0 6px}
.ogx-diag-more{margin-top:8px;border-top:1px solid #2b3846;padding-top:6px}
.ogx-diag-more>summary{cursor:pointer;color:#6f9fd8;margin-bottom:6px}
`;
  const L = () => root.OGXDiagLib;
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids) if (c !== null && c !== undefined) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    if (tag === 'button') e.type = 'button';
    return e;
  }
  function injectCss() {
    if (document.getElementById('ogx-diag-panel-css')) return;
    const s = document.createElement('style');
    s.id = 'ogx-diag-panel-css';
    s.textContent = P.CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------------ extension-page backend
  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      try {
        const area = (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local : chrome.storage.local;
        const r = area.get(keys, (v) => resolve(v || {}));
        if (r && typeof r.then === 'function') r.then((v) => resolve(v || {}), () => resolve({}));
      } catch (e) { resolve({}); }
    });
  }
  function manifest() {
    try { return (typeof browser !== 'undefined' && browser.runtime ? browser.runtime : chrome.runtime).getManifest(); } catch (e) { return {}; }
  }
  function extDisplayName(mf) {
    let n = mf.name || '';
    const m = /^__MSG_(\w+)__$/.exec(n);
    if (m) { try { n = (chrome.i18n && chrome.i18n.getMessage(m[1])) || n; } catch (e) { /* ignore */ } }
    return n;
  }
  /** Backend for extension pages (popup/options): extension-origin IndexedDB + chrome.storage contexts. */
  P.extensionBackend = function () {
    let storeP = null;
    const store = () => (storeP || (storeP = L().openStore({ name: 'ogx-diag' })));
    let cachedAll = null;
    const all = async () => (cachedAll || (cachedAll = await chromeStorageGet(null)));
    return {
      where: 'extension',
      kind: 'bg',
      stats: async () => (await store()).stats(),
      query: async (q) => (await store()).query(q),
      snaps: async (q) => (await store()).snaps(q),
      getMeta: async (k) => (await store()).getMeta(k),
      setMeta: async (k, v) => (await store()).setMeta(k, v),
      clear: async () => (await store()).clear(),
      async context() {
        cachedAll = null;
        const a = await all();
        let best = null; const hosts = new Set();
        for (const [k, v] of Object.entries(a)) if (/\|diag\.ctx$/.test(k) && v && v.t) { hosts.add(v.host); if (!best || v.t > best.t) best = v; }
        const mf = manifest();
        const ctx = Object.assign({}, best || {}, { extName: extDisplayName(mf) || (best && best.extName), extVersion: mf.version || (best && best.extVersion), storeKind: 'extension IndexedDB' });
        ctx.otherHosts = Array.from(hosts).filter((h) => h !== ctx.host);
        if (best) ctx.ctxNote = `Контекст страницы: сохранён игрой ${L().fmtStamp(best.t)} (может быть устаревшим; настройки попапа ниже — текущие)`;
        else ctx.ctxNote = 'Контекст страницы: нет (страница игры ещё ни разу не загрузила расширение — см. allow-list и событие S gated)';
        // Popup-level switches (OgameX Suite): host allow-list and global module switches, read now (not from diag.ctx).
        const hl = a['*|*|suite.hosts'];
        ctx.allowHosts = Array.isArray(hl) ? hl.filter(Boolean).map(String) : [];
        const gm = a['*|*|suite.modules'];
        ctx.globalOff = gm && typeof gm === 'object' ? Object.keys(gm).filter((k) => gm[k] === false) : [];
        if (Array.isArray(ctx.modules)) {
          const off = new Set(ctx.globalOff);
          ctx.modules = ctx.modules.map((m) => {
            const bare = String(m.name || '').replace(/^.*\//, '');
            return off.has(bare) ? Object.assign({}, m, { enabled: false, globalOff: true }) : m;
          });
        }
        try { ctx.ua = navigator.userAgent; } catch (e) { /* ignore */ }
        return ctx;
      },
      async learnState(host) { const a = await all(); return host ? a[host + '|*|diag.learn'] || null : null; },
      /** Raw settings of that server (every player seen + server scope), popup-level suite keys and the stored bot data: one
       *  prefix per bot module ('bot.', 'botcore.', 'botsave.', 'botfarm.', ... — same list as the in-game export, 22-diag.js). */
      async extras(host) {
        const a = await all();
        const out = { settings: {}, bot: {} };
        for (const [k, v] of Object.entries(a)) {
          const m = /^([^|]*)\|([^|]*)\|(.*)$/.exec(k);
          if (!m) continue;
          if (m[1] === '*' && /^suite\./.test(m[3])) out.settings[k] = v;
          else if (host && m[1] === host && m[3] === 'settings') out.settings[k] = v;
          else if ((!host || m[1] === host) && BOT_KEY.test(m[3])) out.bot[k] = v;
        }
        return out;
      },
    };
  };

  // ------------------------------------------------------------------ panel
  P.mount = function (container, opts = {}) {
    if (!container) return null;
    if (opts.injectCss !== false) injectCss();
    const b = opts.backend || P.extensionBackend();
    const status = el('div', { class: 'ogx-diag-status', role: 'status' });
    const stats = el('div', { class: 'ogx-diag-stats' }, 'Загрузка…');
    const nInput = el('input', { class: 'ogx-diag-n', type: 'number', min: '1', max: '100000', step: '100', value: String(opts.defaultN || 5000), title: 'Сколько последних событий выгрузить', 'aria-label': 'Количество событий' });
    const buttons = [];
    const say = (text, err) => { status.textContent = text; status.className = 'ogx-diag-status' + (err ? ' ogx-diag-err' : ''); };
    async function refresh() {
      try {
        const s = await b.stats();
        let fresh = s.events;
        try { fresh = (await b.query({ sinceId: s.lastExportId || 0, last: 1 })).total; } catch (e) { /* ignore */ }
        stats.textContent = `Событий: ${s.events} (новых с прошлой выгрузки: ${fresh}) · снимков: ${s.snaps} · ${s.lastT ? 'последнее ' + L().fmtStamp(s.lastT) : 'журнал пуст'}`;
      } catch (e) { stats.textContent = 'Журнал недоступен: ' + (e && e.message || e); }
    }
    async function run(what, btn) {
      for (const x of buttons) x.disabled = true;
      say('Готовлю файл…');
      try {
        const r = await L().exportData(b, what, { n: +nInput.value || 5000 });
        L().download(r.filename, r.text, r.mime);
        const i = r.info || {};
        const parts = [];
        if (i.events !== undefined) parts.push('событий ' + i.events);
        if (i.snaps !== undefined) parts.push('снимков ' + i.snaps);
        if (i.dropped) parts.push((what === 'full' ? 'пропущено рядовых ' : 'обрезано старых ') + i.dropped);
        if (i.bytes) parts.push((i.bytes / 1048576).toFixed(1) + ' МБ');
        say(`Сохранено: ${r.filename}` + (parts.length ? ' (' + parts.join(', ') + ')' : ''));
        if (opts.onExport) opts.onExport(what, r);
      } catch (e) { say('Ошибка: ' + (e && e.message || e), true); } finally { for (const x of buttons) x.disabled = false; refresh(); }
      return btn;
    }
    async function clearAll() {
      let ok = true;
      try { ok = window.confirm('Очистить журнал событий и снимки страниц? Отчёт самообучения сохранится.'); } catch (e) { ok = true; }
      if (!ok) return;
      try { await b.clear(); say('Журнал очищен'); } catch (e) { say('Ошибка: ' + (e && e.message || e), true); }
      refresh();
    }
    const btn = (label, what, cls, title) => {
      const x = el('button', { class: 'ogx-diag-btn' + (cls ? ' ' + cls : ''), 'data-ogx-act': 'diag:' + what, title: title || null, onclick: () => (what === 'clear' ? clearAll() : run(what, x)) }, label);
      buttons.push(x);
      return x;
    };
    const full = el('button', { class: 'ogx-diag-btn ogx-diag-full', 'data-ogx-act': 'diag:full', title: 'Один файл со всем для разбора: журнал за сегодня, отчёт самообучения, снимки страниц, все настройки, версия', onclick: () => run('full', full) }, 'Выгрузить логи');
    buttons.push(full);
    const root = el('div', { class: 'ogx-diag ogx-root' },
      el('div', { class: 'ogx-diag-title' }, opts.title || 'Логи для разбора'),
      stats,
      full,
      el('div', { class: 'ogx-diag-full-note' }, 'Один файл: журнал за сегодня, самообучение, снимки страниц, настройки и версия. Его и пришлите.'),
      status,
      el('details', { class: 'ogx-diag-more' }, el('summary', null, 'Ещё'),
      el('div', { class: 'ogx-diag-grid' },
        btn('Новое с прошлой выгрузки', 'new', 'ogx-diag-btn-primary ogx-diag-wide', 'События после предыдущей выгрузки (TXT)'),
        btn('За сегодня', 'today', null, 'События с 00:00 (TXT)'),
        btn('JSONL', 'jsonl', null, 'Весь журнал, одно событие в строке'),
        el('div', { class: 'ogx-diag-last' }, btn('Последние N', 'last', null, 'Последние N событий (TXT)'), nInput),
        btn('Снимки страниц (HTML)', 'snaps', null, 'Очищенные снимки страниц, сделанные при алертах'),
        btn('Отчёт самообучения', 'learn', null, 'Что дополнение знает о вёрстке и API сервера'),
        btn('Очистить', 'clear', 'ogx-diag-btn-danger ogx-diag-wide', 'Удалить журнал и снимки'))),
      el('div', { class: 'ogx-diag-hint' }, 'Если что-то сломалось: нажмите «Выгрузить логи» и передайте файл для разбора. Отдельные выгрузки (новое, за сегодня, JSONL, снимки, самообучение) — в «Ещё». Пароли, токены, cookies и e-mail в журнал не попадают.'));
    if (b.snapshotNow) {
      const x = el('button', { class: 'ogx-diag-btn ogx-diag-wide', 'data-ogx-act': 'diag:snapshot', onclick: async () => { const id = await b.snapshotNow(); say(id ? 'Снимок страницы сохранён (#' + id + ')' : 'Снимок не сохранён', !id); refresh(); } }, 'Сделать снимок этой страницы');
      buttons.push(x);
      root.querySelector('.ogx-diag-grid').appendChild(x);
    }
    if (opts.settingsNode) { try { const n = opts.settingsNode(); if (n) root.appendChild(el('div', { class: 'ogx-diag-settings' }, n)); } catch (e) { /* ignore */ } }
    container.textContent = '';
    container.appendChild(root);
    refresh();
    return { el: root, refresh, run };
  };

  // Auto-mount in extension pages that contain #ogx-diag-panel.
  try {
    if (typeof document !== 'undefined' && typeof location !== 'undefined' && /^(chrome|moz|safari-web)-extension:$/.test(location.protocol)) {
      const go = () => { const c = document.getElementById('ogx-diag-panel'); if (c && !c.firstChild) P.mount(c, { injectCss: !document.querySelector('link[href*="diag-panel.css"]') }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    }
  } catch (e) { /* ignore */ }

  root.OGXDiagPanel = P;
  if (root.OGX) root.OGX.diagPanel = P;
})(typeof self !== 'undefined' ? self : this);
