/* L2Mobi Bot 1.2 — ядро самостоятельной работы (перенесено из архитектуры старого бота l2wap):
   - планировщик задач с приоритетами (баффер, алтарь, учёба, отдых, переход, охота);
   - пауза сбойной задачи (selfHold): 3 сбоя подряд → задача отдыхает 30 мин, бот работает дальше;
   - откат при ошибках по маршрутам (1,5 с × 1,7ⁿ, не больше 30 с), остановка при повторяющейся ошибке кода;
   - сторож зависаний: нет прогресса N минут → смена места, потом остановка с причиной;
   - обучение по мобам: опыт и время боя по каждому мобу → «опыт в секунду»;
   - суточный лимит боёв.
   Без обращения к сети и DOM — проверяется Node-тестами. */
(function (root) {
  'use strict';
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- откат при ошибках ---------- */
  function createRecovery(clock) {
    clock = clock || Date.now;
    var errs = {}, sigs = {};
    function failure(route, error) {
      var now = clock(), key = String(route || '?').slice(0, 80);
      var list = (errs[key] || []).filter(function (t) { return now - t < 30 * 60000; });
      list.push(now); errs[key] = list;
      var recent = list.filter(function (t) { return now - t < 10 * 60000; }).length;
      var msg = String(error && error.message || error || '').slice(0, 180);
      var network = /failed to fetch|networkerror|network request|net::err_|abort|timeout|50[234]/i.test(msg);
      var code = !network && /is not a function|is not defined|cannot read|cannot set|undefined|syntaxerror|typeerror|referenceerror/i.test(msg);
      var rep = 0;
      if (code) { var p = sigs[key]; rep = p && p.msg === msg ? p.n + 1 : 1; sigs[key] = { msg: msg, n: rep }; }
      var delay = clamp(Math.round(1500 * Math.pow(1.7, Math.min(recent - 1, 8))), 1500, 30000);
      var action = code && rep >= 3 ? 'halt' : recent >= 8 ? 'halt' : 'retry';
      return { action: action, delay: delay, recent: recent, network: network, code: code, msg: msg };
    }
    function progress(route) { var k = String(route || '?').slice(0, 80); delete errs[k]; delete sigs[k]; }
    function snapshot() { return { errs: errs, sigs: sigs }; }
    return { failure: failure, progress: progress, snapshot: snapshot };
  }

  /* ---------- сторож зависаний ---------- */
  function createWatchdog(clock) {
    clock = clock || Date.now;
    var sig = null, at = clock(), alarms = 0;
    /** Отметить прогресс (новый бой, победа, уровень, переход). */
    function progress(s) { if (s !== sig) { sig = s; at = clock(); alarms = 0; } }
    /** 'ok' | 'relocate' | 'halt' */
    function check(limitMin) {
      var idle = clock() - at;
      if (idle < limitMin * 60000) return 'ok';
      alarms++; at = clock();
      return alarms >= 3 ? 'halt' : 'relocate';
    }
    function idleMs() { return clock() - at; }
    return { progress: progress, check: check, idleMs: idleMs, snapshot: function () { return { sig: sig, at: at, alarms: alarms }; } };
  }

  /* ---------- планировщик задач ---------- */
  /** service: { key, title, prio (больше — раньше), enabled(cfg), due(ctx) → true|false } */
  function createScheduler(services, clock) {
    clock = clock || Date.now;
    var st = {}; // key → { holdUntil, holdWhy, fails, lastRun, lastOk, lastErr, runs }
    function s(k) { return st[k] || (st[k] = { holdUntil: 0, holdWhy: '', fails: 0, lastRun: 0, lastOk: 0, lastErr: '', runs: 0 }); }
    function held(k, now) { return s(k).holdUntil > (now || clock()); }
    function next(cfg, ctx) {
      var now = clock();
      var list = services.filter(function (x) { return x.enabled(cfg) && !held(x.key, now); })
        .sort(function (a, b) { return b.prio - a.prio; });
      for (var i = 0; i < list.length; i++) { try { if (list[i].due(ctx, s(list[i].key))) return list[i]; } catch (e) {} }
      return null;
    }
    function ok(k) { var x = s(k); x.fails = 0; x.lastOk = x.lastRun = clock(); x.runs++; x.lastErr = ''; }
    /** Сбой задачи: после 3 подряд — пауза задачи (по умолчанию 30 мин). Возвращает true, если поставлена пауза. */
    function fail(k, why, holdMin) {
      var x = s(k); x.fails++; x.lastRun = clock(); x.lastErr = String(why || '').slice(0, 160);
      if (x.fails >= 3) { hold(k, holdMin || 30, '3 сбоя подряд: ' + x.lastErr); x.fails = 0; return true; }
      return false;
    }
    function hold(k, min, why) { var x = s(k); x.holdUntil = clock() + min * 60000; x.holdWhy = why || ''; }
    function release(k) { var x = s(k); x.holdUntil = 0; x.holdWhy = ''; }
    function view(cfg) {
      var now = clock();
      return services.map(function (x) {
        var y = s(x.key);
        return { key: x.key, title: x.title, prio: x.prio, on: !!x.enabled(cfg), held: y.holdUntil > now ? Math.ceil((y.holdUntil - now) / 60000) : 0,
          holdWhy: y.holdUntil > now ? y.holdWhy : '', lastOk: y.lastOk, lastErr: y.lastErr, runs: y.runs };
      });
    }
    function exportState() { return JSON.parse(JSON.stringify(st)); }
    function importState(o) { if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { st[k] = Object.assign(s(k), o[k]); }); }
    return { next: next, ok: ok, fail: fail, hold: hold, release: release, held: held, view: view, exportState: exportState, importState: importState };
  }

  /* ---------- обучение по мобам ---------- */
  function createMobStats() {
    var m = {}; // имя → { n, ms, exp, hits, deaths, last }
    function rec(name) { return m[name] || (m[name] = { n: 0, ms: 0, exp: 0, hits: 0, deaths: 0, last: 0 }); }
    function win(name, ms, exp, hits) {
      var r = rec(name); r.n++; r.ms += Math.max(0, ms || 0); r.exp += Math.max(0, exp || 0); r.hits += hits || 0; r.last = Date.now();
    }
    function death(name) { rec(name).deaths++; rec(name).last = Date.now(); }
    /** Опыт в секунду (null, пока меньше 2 боёв). Смерти режут оценку. */
    function rate(name) {
      var r = m[name]; if (!r || r.n < 2 || !r.ms) return null;
      return (r.exp / (r.ms / 1000)) / (1 + r.deaths * 2);
    }
    function avgSecs(name) { var r = m[name]; return r && r.n ? r.ms / r.n / 1000 : null; }
    function dangerous(name) { var r = m[name]; return !!r && r.deaths >= 2 && r.deaths * 10 > r.n; }
    function top(n) {
      return Object.keys(m).map(function (k) { var r = m[k]; return { name: k, n: r.n, secs: r.n ? +(r.ms / r.n / 1000).toFixed(1) : 0, exp: r.n ? Math.round(r.exp / r.n) : 0, rate: rate(k), deaths: r.deaths }; })
        .sort(function (a, b) { return (b.rate || 0) - (a.rate || 0) || b.n - a.n; }).slice(0, n || 30);
    }
    return { win: win, death: death, rate: rate, avgSecs: avgSecs, dangerous: dangerous, top: top,
      exportState: function () { return m; }, importState: function (o) { if (o && typeof o === 'object') m = o; } };
  }

  /* ---------- база мобов (droplist): опыт за единицу HP ---------- */
  function mobDbIndex(list) {
    var byName = {}, byEid = {};
    (list || []).forEach(function (r) { byEid[r[0]] = r; if (!byName[r[1]]) byName[r[1]] = r; });
    return {
      byName: function (n) { return byName[n] || null; },
      byEid: function (e) { return byEid[e] || null; },
      /** опыт / макс.HP — чем больше, тем выгоднее моб при равной силе героя */
      value: function (n) { var r = byName[n]; return r && r[4] ? r[3] / r[4] : null; },
      size: (list || []).length
    };
  }

  /* ---------- сутки и лимит ---------- */
  function dayKey(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
  /** День по серверу (МСК = UTC+3). */
  function serverDay(ms) { return dayKey((ms || Date.now()) + 3 * 3600000); }

  root.L2MCore = { createRecovery: createRecovery, createWatchdog: createWatchdog, createScheduler: createScheduler,
    createMobStats: createMobStats, mobDbIndex: mobDbIndex, serverDay: serverDay };
  if (typeof module !== 'undefined') module.exports = root.L2MCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
