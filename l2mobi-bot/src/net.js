/* L2Mobi Bot — запросы к l2mobi.pro из вкладки игры (те же куки, что у игрока). */
(function (root) {
  'use strict';
  var decoder = null;
  function decode(buf) {
    try { decoder = decoder || new TextDecoder('windows-1251'); return decoder.decode(buf); }
    catch (e) { return new TextDecoder().decode(buf); }
  }
  var skewMs = 0; // серверное время − локальное

  /** GET страницы игры. path — относительный путь ('map.php', 'battle.php?...'). */
  async function get(path, opts) {
    opts = opts || {};
    var url = /^https?:/.test(path) ? path : location.origin + '/' + String(path).replace(/^\//, '');
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 20000) : null;
    try {
      // В Firefox content.fetch ходит от имени страницы (как в Chrome), обычный fetch — от расширения.
      var f = (typeof content !== 'undefined' && content && content.fetch) ? content.fetch.bind(content) : fetch;
      var res = await f(url, {
        method: opts.body ? 'POST' : 'GET',
        headers: opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
        body: opts.body || undefined,
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        referrer: opts.referer ? location.origin + '/' + String(opts.referer).replace(/^\//, '') : undefined,
        signal: ctrl ? ctrl.signal : undefined
      });
      var buf = await res.arrayBuffer();
      var date = res.headers.get('date');
      if (date) { var t = Date.parse(date); if (!isNaN(t)) skewMs = t + 500 - Date.now(); }
      return {
        status: res.status,
        url: res.url,
        text: decode(buf),
        battleEnd: !!res.headers.get('x-l2-battleend'),
        headers: res.headers
      };
    } finally { if (timer) clearTimeout(timer); }
  }

  /** POST формы игры. body — строка x-www-form-urlencoded (кириллицу кодировать в windows-1251). */
  function post(path, body, opts) { return get(path, Object.assign({}, opts || {}, { body: body })); }

  function serverNow() { return Date.now() + skewMs; }

  root.L2MNet = { get: get, post: post, serverNow: serverNow };
})(typeof globalThis !== 'undefined' ? globalThis : this);
