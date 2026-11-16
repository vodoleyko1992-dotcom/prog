/* L2Mobi Bot — движок: автофарм, отдых, бафф, Алтарь. Работает во вкладке игры через fetch. */
(function (root) {
  'use strict';
  var P = root.L2MParse, N = root.L2MNet;

  var DEFAULTS = {
    skills: '',          // id умений через запятую в порядке приоритета ('' = все найденные)
    useAttack: true,     // бить обычной атакой, когда умения на откате
    maxLvlAbove: 3,      // моб не выше героя + N
    maxLvlBelow: 9,      // моб не ниже героя − N (сервер даёт опыт при разнице ≤ 9)
    whiteOnly: false,    // только моб с белым именем
    blacklist: '',       // имена мобов через запятую, которых не трогать
    loot: true,          // забирать добычу
    restHp: 40,          // отдыхать, если HP ниже, %
    restMp: 20,          // отдыхать, если MP ниже, %
    restUntil: 90,       // отдых до, %
    fullRestore: false,  // вместо ожидания брать «Полное восстановление» у баффера
    buffs: '3',          // id баффов VIP-баффера через запятую (3 = Acumen)
    buffVip: true,       // VIP-баффер (100 аден, бесплатно до 40 ур.) вместо обычного (5000)
    buffEvery: 55,       // перебафф, минут
    daily: true,         // Алтарь: награда за вход, задания, колесо
    emptyWait: 6,        // пауза, если мобов нет, сек
    minDelay: 1.3,       // минимальная пауза между ударами, сек
    stopOnDeath: true
  };

  var S = {
    running: false, status: 'остановлен', hero: null, me: {}, kills: 0, adena: 0, exp: 0, deaths: 0,
    startedAt: 0, lastBuff: 0, lastDaily: '', knownSkills: [], cd: {}, log: []
  };
  var cfg = Object.assign({}, DEFAULTS);
  var listeners = [];
  var stopReq = false;

  function emit() { listeners.forEach(function (f) { try { f(S); } catch (e) {} }); }
  function onChange(f) { listeners.push(f); }

  function log(msg) {
    var d = new Date();
    var line = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + ' ' + msg;
    S.log.unshift(line); if (S.log.length > 300) S.log.length = 300;
    emit();
  }
  function setStatus(s) { S.status = s; emit(); }

  function sleep(ms) {
    return new Promise(function (r) {
      var end = Date.now() + ms;
      (function tick() { if (stopReq || Date.now() >= end) return r(); setTimeout(tick, Math.min(250, end - Date.now())); })();
    });
  }
  function jitter(ms) { return ms + Math.floor(Math.random() * 350); }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : 100; }
  function ids(str) { return String(str || '').split(/[\s,;]+/).filter(function (x) { return /^\d+$/.test(x); }); }
  function names(str) { return String(str || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }

  class Stop extends Error {}

  async function page(path, referer) {
    if (stopReq) throw new Stop();
    var r = await N.get(path, { referer: referer });
    var al = P.detectAlerts(r.text);
    if (al.indexOf('captcha') >= 0) { notify('Капча! Бот остановлен — пройдите проверку в игре.'); throw new Stop('captcha'); }
    if (al.indexOf('ban') >= 0) { notify('Похоже на блокировку. Бот остановлен.'); throw new Stop('ban'); }
    if (al.indexOf('logout') >= 0) { notify('Вылетели из игры (страница входа). Бот остановлен.'); throw new Stop('logout'); }
    if (al.indexOf('dead') >= 0) {
      S.deaths++; log('☠ Герой погиб');
      if (cfg.stopOnDeath) { notify('Герой погиб. Бот остановлен.'); throw new Stop('dead'); }
    }
    var h = P.parseHeroHeader(r.text); if (h) S.hero = h;
    return r;
  }

  function notify(text) {
    log('⚠ ' + text);
    try { chrome.runtime.sendMessage({ type: 'l2m-notify', text: text }); } catch (e) {}
  }

  function ensureHotbarCookie() {
    // Панель умений в «режиме редактирования» прячет ссылки атаки — закрываем её как кнопка 🔓 в игре.
    document.cookie = 'rr=1; path=/; max-age=31536000';
  }

  /* ---------- состояние героя ---------- */
  async function refreshMe() {
    var r = await page('player.php?parameters');
    var p = P.parseParameters(r.text);
    if (p.maxHp) S.me = Object.assign(S.me, p);
    if (p.level && S.hero) S.hero.level = p.level;
    emit();
    return S.me;
  }

  /* ---------- отдых ---------- */
  async function restIfNeeded() {
    var me = S.me;
    if (!me.maxHp) me = await refreshMe();
    var hp = pct(me.hp, me.maxHp), mp = pct(me.mp, me.maxMp);
    if (hp >= cfg.restHp && mp >= cfg.restMp) return;
    if (cfg.fullRestore) {
      setStatus('восстановление у баффера');
      await openBufferPage(false);
      await page('buffer2.php?buff=28', 'buffer2.php');
      me = await refreshMe();
      log('Полное восстановление: HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%');
      if (pct(me.hp, me.maxHp) >= cfg.restHp && pct(me.mp, me.maxMp) >= cfg.restMp) return;
    }
    log('Отдых: HP ' + hp + '% MP ' + mp + '%');
    var until = Date.now() + 15 * 60000;
    while (!stopReq && Date.now() < until) {
      setStatus('отдых HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%');
      await sleep(15000);
      me = await refreshMe();
      if (pct(me.hp, me.maxHp) >= cfg.restUntil && pct(me.mp, me.maxMp) >= cfg.restUntil) break;
    }
    log('Отдых окончен: HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%');
  }

  /* ---------- бафф ---------- */
  async function openBufferPage(vip) {
    var t = await page('town.php');
    var tk = P.townTokens(t.text);
    if (tk['1']) await page(tk['1'], 'town.php'); else await page('buffer2.php', 'town.php');
    if (vip) return page('buffer_vip_40.php', 'buffer2.php');
    return null;
  }

  async function buffIfNeeded(force) {
    var list = ids(cfg.buffs);
    if (!list.length) return;
    if (!force && Date.now() - S.lastBuff < cfg.buffEvery * 60000) return;
    setStatus('бафф');
    await openBufferPage(cfg.buffVip);
    var base = cfg.buffVip ? 'buffer_vip_40.php' : 'buffer2.php';
    for (var i = 0; i < list.length; i++) {
      await page(base + '?buff=' + list[i], base);
      await sleep(jitter(350));
    }
    S.lastBuff = Date.now();
    log('Бафф наложен (' + list.length + ')');
    save();
  }

  /* ---------- Алтарь ---------- */
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  async function dailyIfNeeded() {
    if (!cfg.daily || S.lastDaily === today()) return;
    setStatus('Алтарь');
    var r = await page('daily_altar.php');
    var claims = P.parseAltarClaims(r.text);
    for (var i = 0; i < claims.length; i++) {
      var x = await page(claims[i], 'daily_altar.php');
      var t = P.pageText(x.text).split('\n').find(function (l) { return /Получено|Награда:|Добавлено|выполнено/i.test(l); });
      log('Алтарь: ' + (t || claims[i]));
      await sleep(jitter(500));
    }
    S.lastDaily = today();
    save();
  }

  /* ---------- выбор моба ---------- */
  function pickMob(mobs) {
    var lvl = S.hero ? S.hero.level : 1, black = names(cfg.blacklist);
    return mobs.filter(function (m) {
      if (m.level > lvl + (+cfg.maxLvlAbove)) return false;
      if (m.level < lvl - (+cfg.maxLvlBelow)) return false;
      if (black.indexOf(m.name.toLowerCase()) >= 0) return false;
      if (cfg.whiteOnly && m.color && !/^#?(fff|ffffff|white)$/.test(m.color)) return false;
      return true;
    }).sort(function (a, b) { return b.level - a.level; })[0] || null; // ближе к уровню героя — больше опыта
  }

  /* ---------- бой ---------- */
  function rememberSkills(hb) {
    var changed = false;
    hb.skills.forEach(function (s) { if (S.knownSkills.indexOf(s.id) < 0) { S.knownSkills.push(s.id); changed = true; } });
    if (changed) save();
  }

  function chooseAction(hb, now) {
    var order = ids(cfg.skills);
    if (!order.length) order = hb.skills.map(function (s) { return s.id; });
    for (var i = 0; i < order.length; i++) {
      var sk = hb.skills.find(function (s) { return s.id === order[i]; });
      if (sk && !(S.cd[sk.id] > now)) return { href: sk.href, label: 'умение ' + sk.id, skill: sk.id };
    }
    if (cfg.useAttack && hb.attack) return { href: hb.attack, label: 'атака' };
    return null;
  }

  async function finishBattle(endText) {
    var end = P.parseBattleEnd(endText);
    var adena = end.adena;
    end.loot.forEach(function (l) { var m = /^Адена\s+([\d,]+)/.exec(l); if (m && !adena) adena = +m[1].replace(/\D/g, ''); });
    S.kills++; S.adena += adena; S.exp += end.exp;
    if (cfg.loot && end.takeAll) { await page('battle.php'); }
    log('✔ Победа' + (adena ? ', адена ' + adena : '') + (end.loot.length ? ', добыча: ' + end.loot.filter(function (x) { return x !== '⚔'; }).join(', ') : '') + (end.levelUp ? ' — НОВЫЙ УРОВЕНЬ!' : ''));
    if (end.levelUp) await refreshMe();
    save();
  }

  /* Удары идут обычной страницей battle.php?…&go=ID / &attack — так же, как в игре без AJAX.
     battle_ajax.php не используем: сервер помечает ответ как gzip, а шлёт простой текст,
     и браузер отвечает ERR_CONTENT_DECODING_FAILED. */
  function isEnd(r) { return r.battleEnd || /ЗАБРАТЬ ВСЕ|ДОБЫЧА\s*\(/.test(r.text); }

  async function fight(mob) {
    ensureHotbarCookie();
    setStatus('бой: ' + mob.name + ' [' + mob.level + ']');
    var r = await page(mob.href, 'map.php');
    if (isEnd(r)) { await finishBattle(r.text); return 'end'; }
    var hb = P.parseHotbar(r.text);
    if (!hb.attack && !hb.skills.length && P.isEditMode(r.text)) { ensureHotbarCookie(); r = await page(mob.href, 'map.php'); hb = P.parseHotbar(r.text); }
    if (!hb.attack && !hb.skills.length) { log('Моб ' + mob.name + ' недоступен'); return 'skip'; }
    rememberSkills(hb);
    var ref = mob.href, lastSig = '', still = 0, lastLog = '';
    for (var step = 0; step < 150 && !stopReq; step++) {
      var bars = P.parseBars(r.text); if (bars.maxHp) Object.assign(S.me, bars);
      var hud = P.parseTargetHud(r.text);
      var cds = P.parseCooldowns(r.text); for (var k in cds) S.cd[k] = cds[k] * 1000;
      var cast = P.parseCasting(r.text);
      emit();
      var sig = (hud ? hud.hp : '?') + '/' + S.me.hp;
      if (sig === lastSig) still++; else { still = 0; lastSig = sig; }
      if (still >= 10) { log('Бой без изменений 10 ходов — выхожу к карте'); return 'stuck'; }
      var bl = P.parseBattleLog(r.text)[0] || '';
      if (/не хватает|недостаточно|нельзя/i.test(bl) && bl !== lastLog) log('Игра: ' + bl);
      lastLog = bl;
      var wait = cast ? cast.casting * 1000 - N.serverNow() + 250 : 0;
      var pn = (cast && cast.PN ? cast.PN : 1.3) * 1000;
      if (step > 0) await sleep(jitter(Math.max(wait, pn, cfg.minDelay * 1000)));
      var act = chooseAction(hb, N.serverNow());
      if (!act) { await sleep(700); r = await page(ref, ref); continue; }
      r = await page(act.href, ref);
      ref = act.href;
      if (isEnd(r)) { await finishBattle(r.text); return 'win'; }
      if (/^https?:\/\/[^/]+\/map\.php/.test(r.url) || !/l2-target-hud/.test(r.text)) { log('Бой закончился без страницы добычи (моб убит или ушёл)'); return 'lost'; }
      var nhb = P.parseHotbar(r.text);
      if (nhb.attack || nhb.skills.length) hb = nhb;
    }
    return 'timeout';
  }

  /* ---------- главный цикл ---------- */
  async function loop() {
    log('▶ Старт');
    try { await refreshMe(); } catch (e) { if (e instanceof Stop) return finish(e); }
    while (!stopReq) {
      try {
        await dailyIfNeeded();
        await buffIfNeeded(false);
        await restIfNeeded();
        setStatus('ищу моба');
        var m = await page('map.php');
        var mobs = P.parseMapMobs(m.text);
        var mob = pickMob(mobs);
        if (!mob) {
          setStatus('мобов нет (' + mobs.length + ' рядом не подходят)');
          await sleep(cfg.emptyWait * 1000);
          continue;
        }
        await fight(mob);
        await sleep(jitter(400));
      } catch (e) {
        if (e instanceof Stop) return finish(e);
        log('Ошибка: ' + (e && e.message ? e.message : e));
        await sleep(5000);
      }
    }
    finish();
  }

  function finish(e) {
    S.running = false; stopReq = false;
    setStatus(e && e.message ? 'остановлен: ' + e.message : 'остановлен');
    log('■ Стоп');
    save();
  }

  function start() {
    if (S.running) return;
    S.running = true; stopReq = false; S.startedAt = Date.now();
    save(); emit();
    loop();
  }
  function stop() { if (S.running) { stopReq = true; setStatus('останавливаюсь…'); } }

  /* ---------- хранение ---------- */
  var KEY = 'l2mobi_bot_v1';
  function save() {
    try {
      chrome.storage.local.set({ [KEY]: {
        cfg: cfg, running: S.running, lastBuff: S.lastBuff, lastDaily: S.lastDaily, knownSkills: S.knownSkills,
        stats: { kills: S.kills, adena: S.adena, exp: S.exp, deaths: S.deaths }, log: S.log.slice(0, 100)
      } });
    } catch (e) {}
  }
  function load() {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get(KEY, function (o) {
          var v = o && o[KEY];
          if (v) {
            cfg = Object.assign({}, DEFAULTS, v.cfg || {});
            S.lastBuff = v.lastBuff || 0; S.lastDaily = v.lastDaily || ''; S.knownSkills = v.knownSkills || [];
            if (v.stats) { S.kills = v.stats.kills || 0; S.adena = v.stats.adena || 0; S.exp = v.stats.exp || 0; S.deaths = v.stats.deaths || 0; }
            S.log = v.log || [];
          }
          res(v || {});
        });
      } catch (e) { res({}); }
    });
  }
  function setCfg(patch) { cfg = Object.assign({}, cfg, patch); save(); emit(); }
  function resetStats() { S.kills = 0; S.adena = 0; S.exp = 0; S.deaths = 0; save(); emit(); }

  root.L2MEngine = {
    DEFAULTS: DEFAULTS, state: S, get cfg() { return cfg; }, setCfg: setCfg, start: start, stop: stop, load: load,
    onChange: onChange, log: log, resetStats: resetStats, buffNow: function () { return buffIfNeeded(true).catch(function (e) { log('Бафф: ' + e.message); }); },
    _test: { pickMob: pickMob, chooseAction: chooseAction, ids: ids, setHero: function (h) { S.hero = h; } }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
