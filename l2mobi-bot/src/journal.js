/* L2Mobi Bot — подробный журнал для разбора: запросы, решения, бои, ошибки. Хранится в chrome.storage.local, выгружается файлом JSON. */
(function (root) {
  'use strict';
  var KEY = 'l2mobi_journal_v1', MAX = 6000, KEEP_BYTES = 4 * 1024 * 1024;
  var rows = [], loaded = false, dirty = false, seq = 0, meta = { exportedSeq: 0 };

  function load() {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get(KEY, function (o) {
          var v = o && o[KEY];
          if (v && Array.isArray(v.rows)) { rows = v.rows.concat(rows); meta = v.meta || meta; }
          seq = rows.reduce(function (m, r) { return Math.max(m, r.n || 0); }, seq);
          loaded = true; res();
        });
      } catch (e) { loaded = true; res(); }
    });
  }

  function trim() {
    if (rows.length > MAX) rows.splice(0, rows.length - MAX);
    var size = JSON.stringify(rows).length;
    while (size > KEEP_BYTES && rows.length > 100) { rows.splice(0, Math.ceil(rows.length / 10)); size = JSON.stringify(rows).length; }
  }

  function flush() {
    if (!dirty || !loaded) return;
    dirty = false; trim();
    try { var o = {}; o[KEY] = { rows: rows, meta: meta }; chrome.storage.local.set(o); } catch (e) {}
  }
  var iv = setInterval(flush, 4000); if (iv && iv.unref) iv.unref();
  try { window.addEventListener('pagehide', flush); } catch (e) {}

  /** Событие. type: log|req|pick|hit|win|lost|buff|rest|altar|alert|err|page */
  function ev(type, msg, data) {
    var r = { n: ++seq, t: Date.now(), type: type, msg: String(msg || '') };
    if (data !== undefined) r.data = data;
    rows.push(r); dirty = true;
    if (rows.length > MAX + 500) trim();
    return r;
  }

  function read(mode) {
    if (mode === 'new') return rows.filter(function (r) { return r.n > (meta.exportedSeq || 0); });
    if (mode === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return rows.filter(function (r) { return r.t >= d.getTime(); }); }
    if (typeof mode === 'number') return rows.slice(-mode);
    return rows.slice();
  }

  function fileName() {
    var d = new Date(), p = function (x) { return ('0' + x).slice(-2); };
    return 'l2mobi-log-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  /** Скачать журнал файлом. extra — сводка (версия, настройки, герой). Возвращает число событий. */
  function exportFile(mode, extra) {
    var list = read(mode);
    var body = {
      kind: 'l2mobi-bot-log', exportedAt: new Date().toISOString(), mode: mode, count: list.length,
      tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })(),
      info: extra || {}, events: list
    };
    var blob = new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName(); a.style.display = 'none';
    document.documentElement.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    if (list.length) { meta.exportedSeq = list[list.length - 1].n; dirty = true; flush(); }
    return list.length;
  }

  function clear() { rows = []; meta.exportedSeq = seq; dirty = true; flush(); }
  function count() { return rows.length; }
  function countNew() { return rows.filter(function (r) { return r.n > (meta.exportedSeq || 0); }).length; }

  root.L2MJournal = { load: load, ev: ev, read: read, exportFile: exportFile, clear: clear, count: count, countNew: countNew, flush: flush };
})(typeof globalThis !== 'undefined' ? globalThis : this);
