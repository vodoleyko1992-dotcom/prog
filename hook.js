// ===== L2wap Bot — сетевой «жучок» (мир страницы, document_start) =====
// Видит запросы игры к своему серверу (fetch / XMLHttpRequest) и передаёт боту краткую сводку:
// метод, путь, статус, время ответа, тело запроса и ответа (JSON, урезанно). Пароли, токены, сессии — вымарываются.
// Только свой сайт и только JSON; картинки, скрипты и стили не трогаем. Работу игры не меняет: ответ отдаётся как был.
(() => {
  if (window.__l2botHook) return;
  window.__l2botHook = 1;
  const SECRET = /pass|token|auth|session|sid\b|cookie|secret|csrf|sign|captcha|email|phone|login|user(?!.?id)|nick|account|jwt|bearer|ticket|api.?key|refresh/i;   // v5.6: + логин/ник/аккаунт; 8.0: + jwt/bearer/ticket/apikey/refresh
  const SKIP = /\.(png|jpe?g|gif|webp|svg|css|js|mjs|map|woff2?|ttf|ico|mp3|ogg|wav)(\?|$)/i;
  // v5.6: секреты и в адресе (?sid=…&sign=…) — значения таких параметров вымарываем
  const cleanUrl = u => { try { const q = new URLSearchParams(u.search); for (const k of [...q.keys()]) if (SECRET.test(k)) q.set(k, '***'); const t = q.toString(); return u.pathname + (t ? '?' + t : ''); } catch (e) { return u.pathname; } };
  const same = u => { try { const x = new URL(u, location.href); return x.host === location.host && !SKIP.test(x.pathname) ? x : null; } catch (e) { return null; } };
  const redact = (v, d = 0) => {
    if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (d > 5) return '…';
    if (Array.isArray(v)) return v.length > 8 ? [...v.slice(0, 8).map(x => redact(x, d + 1)), `…ещё ${v.length - 8}`] : v.map(x => redact(x, d + 1));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET.test(k) ? '***' : redact(x, d + 1);
    return o;
  };
  // 7.2.3: сумка из ответа (character.inventory.stacks) целиком — redact режет массивы до 8 элементов, а боту нужны все
  // количества (заряды, банки). Только [itemId, qty] — ничего личного
  const invOf = o => { try { const st = o?.character?.inventory?.stacks || o?.inventory?.stacks; return Array.isArray(st) ? st.filter(x => x && x.itemId).map(x => [+x.itemId, +x.qty || 0]) : undefined; } catch (e) { return undefined; } };
  // 8.0.3 (лог 11.10 11:41–11:44): /game/epic-bosses — ровно 8 эпиков, а redact режет массивы до 8: девятый эпик молча выключил бы разбор
  // (бот берёт список, только если в нём ровно total боссов). Список эпиков — целиком отдельным полем (как inv и sp), каждый — через redact
  const epicsOf = (u, o) => { try { return u.pathname === '/game/epic-bosses' && Array.isArray(o?.bosses) ? o.bosses.slice(0, 200).map(x => redact(x, 1)) : undefined; } catch (e) { return undefined; } };
  const reqBody = b => {
    try {
      if (b == null) return null;
      if (typeof b === 'string') { try { return redact(JSON.parse(b)); } catch (e) { const p = new URLSearchParams(b); const o = {}; for (const [k, v] of p) o[String(k).slice(0, 40)] = SECRET.test(k) ? '***' : v.slice(0, 120); const ks = Object.keys(o); return ks.length && !(ks.length === 1 && o[ks[0]] === '') ? o : '[текст]'; } }   // v5.6: строка-токен целиком не пишем
      if (b instanceof FormData) { const o = {}; for (const [k, v] of b) o[k] = SECRET.test(k) ? '***' : typeof v === 'string' ? v.slice(0, 120) : '[файл]'; return o; }
      if (b instanceof URLSearchParams) { const o = {}; for (const [k, v] of b) o[k] = SECRET.test(k) ? '***' : v.slice(0, 120); return o; }
    } catch (e) {}
    return '[данные]';
  };
  const post = d => { try { window.postMessage({ __l2bot: 'net', ...d }, location.origin); } catch (e) {} };
  const raw = (txt, ct) => { if (!/json/i.test(ct || '') && !/^\s*[[{]/.test(txt || '')) return null; try { return JSON.parse(txt); } catch (e) { return null; } };
  const parse = (txt, ct) => { const o = raw(txt, ct); return o == null ? null : redact(o); };
  // v5.6: список мобов локации (/game/map/spawns → nearbySpawns) — целиком, но кратко: [id, тип, имя, ур.]. Метки карты больше
  // не несут тип моба (остались только РБ), а redact режет массивы до 8 — бот не видел чемпионов вовсе
  const spawns = o => { try { const a = o && Array.isArray(o.nearbySpawns) ? o.nearbySpawns : null;
    return a ? a.slice(0, 3000).map(x => [String(x.id || ''), String(x.kind || ''), String(x.name || '').slice(0, 60), +x.level || 0, +x.distance || 0]) : undefined; } catch (e) { return undefined; } };

  // 8.0.3 (логи 11.10: 1302 потерянных нажатия за 10 боёв с РБ): пока игра ждёт свой GET /character (уходит ≈8 мс после ответа на ход,
  // идёт 0,25–0,56 с) и ≈30 мс после — клик по панели игра молча теряет. Боту нужны начало и конец этих запросов (rid, путь без query)
  const TRACK = /^\/(?:character|game\/battle\/(?:action|start|hunt-continue))$/;
  let ridN = 0;
  const start = (u, method) => { if (!TRACK.test(u.pathname)) return undefined; const rid = ++ridN; try { window.postMessage({ __l2bot: 'netStart', path: u.pathname, method, rid }, location.origin); } catch (e) {} return rid; };
  const ofetch = window.fetch;
  if (ofetch) window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const u = same(url);
    const p = ofetch.apply(this, arguments);
    if (!u) return p;
    const method = String(init?.method || input?.method || 'GET').toUpperCase(), t0 = performance.now(), req = reqBody(init?.body);
    const rid = start(u, method);   // 7.1.17: ход ушёл на сервер; 8.0.3: и GET /character, начало/конец боя
    p.then(res => {
      const ms = Math.round(performance.now() - t0), ct = res.headers.get('content-type') || '';
      if (!/json|text/i.test(ct)) return post({ url: cleanUrl(u), method, status: res.status, ms, req, ct, rid });
      res.clone().text().then(t => { const o = raw(t, ct); post({ url: cleanUrl(u), method, status: res.status, ms, req, res: o == null ? null : redact(o), sp: spawns(o), inv: invOf(o), len: t.length, eb: epicsOf(u, o), rid }); })
        .catch(() => post({ url: cleanUrl(u), method, status: res.status, ms, req, rid }));   // 8.0.3: конец запроса не теряем
    }, err => post({ url: cleanUrl(u), method, ms: Math.round(performance.now() - t0), req, error: String(err?.message || err).slice(0, 120), rid }));
    return p;
  };

  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__l2 = { method: String(m || 'GET').toUpperCase(), url }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__l2, u = info && same(info.url);
    if (u) {
      const t0 = performance.now(), req = reqBody(body);
      const rid = start(u, info.method);
      this.addEventListener('loadend', function onEnd() {
        let res = null, len = 0, o = null;
        try { if (!this.responseType || this.responseType === 'text') { len = (this.responseText || '').length; o = raw(this.responseText, this.getResponseHeader('content-type')); } else if (this.responseType === 'json') o = this.response; res = o == null ? null : redact(o); } catch (e) {}
        post({ url: cleanUrl(u), method: info.method, status: this.status, ms: Math.round(performance.now() - t0), req, res, sp: spawns(o), inv: invOf(o), len, eb: epicsOf(u, o), error: this.status ? undefined : 'нет ответа', rid });
      }, { once: true });                                // v5.6: повторно используемый XHR не копит слушателей
    }
    return XS.apply(this, arguments);
  };
})();
