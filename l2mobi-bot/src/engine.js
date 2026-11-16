/* L2Mobi Bot 1.2 — движок: автофарм, отдых, бафф, Алтарь, умения, смена места кача, возврат после смерти.
   Работает во вкладке игры через fetch, пишет подробный журнал (L2MJournal).
   1.2: главный цикл — планировщик задач из ядра (L2MCore), как в старом боте l2wap:
   каждая задача сама решает, пора ли ей, сбойная задача уходит на паузу, ошибки — с откатом,
   сторож зависаний, обучение по мобам (опыт в секунду). */
(function (root) {
  'use strict';
  var P = root.L2MParse, N = root.L2MNet, C = root.L2MCore;
  var J = root.L2MJournal || { ev: function () {} };
  var VERSION = '1.5';

  var DEFAULTS = {
    skills: '',          // id умений через запятую в порядке приоритета ('' = боевые с панели, сильнее — раньше)
    useAttack: true,     // бить обычной атакой, когда умения на откате
    maxLvlAbove: 9,      // моб не выше героя + N (John: −5…+9)
    maxLvlBelow: 5,      // моб не ниже героя − N
    whiteOnly: false,
    blacklist: '',
    loot: true,
    restHp: 50, restMp: 20, restUntil: 90, // 1.2: 50% (смерть роняет вещи)
    fullRestore: false,
    buffs: '3', buffVip: true, buffEvery: 55,
    daily: true,
    autoLearn: true,     // учить новые умения у магистра
    autoHotbar: true,    // ставить новые боевые умения на панель
    autoMove: true,      // менять место кача, если рядом нет подходящих мобов
    avoidAgro: true,     // при смене места не идти к агрессивным мобам
    emptyTries: 3,       // сколько раз подряд «мобов нет», прежде чем идти на новое место
    emptyWait: 4,
    minDelay: 0.3,       // минимальная пауза между ударами, сек (дальше ждём только каст/откат игры)
    stopOnDeath: false,  // 1.2: после смерти бот сам возвращается и продолжает (стоп — только если вернуться не вышло)
    avoidAfterDeath: 120,// сколько минут не трогать моба, от которого погиб
    preferBest: true,    // выбирать мобов, на которых больше опыта в секунду (бот учится по своим боям)
    dailyKills: 0,       // суточный лимит боёв (0 — без лимита)
    stuckMin: 10,        // нет прогресса столько минут — сменить место; три раза подряд — стоп
    healAt: 45,          // в бою лечиться умением (Самолечение и т.п.), если HP ниже, %
    bookRetryH: 6,       // умение «нужна книга» не пробовать снова столько часов (или пока не будет нового уровня)
    buyBooks: true,      // 1.5: покупать книги заклинаний у Баринеля (Глудио) и сразу учить
    bookMaxPrice: 20000, // не дороже, аден за книгу
    adenaKeep: 0         // не тратить на книги, если адены меньше (0 — не проверять)
  };

  var S = {
    version: VERSION, running: false, status: 'остановлен', task: '', hero: null, me: {},
    kills: 0, adena: 0, deaths: 0, levelUps: 0, learned: 0,
    sess: null, lastBuff: 0, lastDaily: '', lastLearnLvl: 0, lastLearnT: 0,
    knownSkills: [], skillInfo: {}, cd: {}, log: [], lastFight: null, place: null,
    dead: false, avoid: {}, day: { key: '', kills: 0 }, needMove: false, curMob: null, beat: 0, now: '', next: '',
    noBook: {}, force: {}, pendingWin: null
  };
  var rec = C.createRecovery(), wd = C.createWatchdog(), mstats = C.createMobStats(), db = C.mobDbIndex(root.L2MMobs);
  var cfg = Object.assign({}, DEFAULTS);
  var listeners = [];
  var stopReq = false, gen = 0;

  function emit() { listeners.forEach(function (f) { try { f(S); } catch (e) {} }); }
  function onChange(f) { listeners.push(f); }

  function hhmmss(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  function log(msg, type, data) {
    S.log.unshift(hhmmss(new Date()) + ' ' + msg); if (S.log.length > 300) S.log.length = 300;
    J.ev(type || 'log', msg, data);
    emit();
  }
  function setStatus(s, task) { S.status = s; if (task !== undefined) S.task = task; emit(); }

  function sleep(ms) {
    return new Promise(function (r) {
      var end = Date.now() + Math.max(0, ms);
      (function tick() { S.beat = Date.now(); if (stopReq || Date.now() >= end) return r(); setTimeout(tick, Math.min(200, end - Date.now())); })();
    });
  }
  function jitter(ms, j) { return ms + Math.floor(Math.random() * (j == null ? 120 : j)); }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : 100; }
  function ids(str) { return String(str || '').split(/[\s,;]+/).filter(function (x) { return /^\d+$/.test(x); }); }
  function names(str) { return String(str || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
  function lvl() { return S.hero ? S.hero.level : (S.me.level || 1); }

  class Stop extends Error {}
  class Dead extends Error {}
  var myGen = 0; // поколение цикла: старый цикл после Стоп→Старт или перезапуска сторожем сам выходит

  async function page(path, referer, body) {
    if (stopReq) throw new Stop();
    if (myGen !== gen) throw new Stop('перезапуск');
    S.beat = Date.now();
    var t0 = Date.now(), r;
    try { r = body ? await N.post(path, body, { referer: referer }) : await N.get(path, { referer: referer }); }
    catch (e) { J.ev('req', path, { err: String(e && e.message || e), ms: Date.now() - t0 }); throw e; }
    var al = P.detectAlerts(r.text);
    J.ev('req', String(path).slice(0, 160), { st: r.status, ms: Date.now() - t0, kb: Math.round(r.text.length / 1024), url: r.url.replace(location.origin, ''), end: r.battleEnd || undefined, al: al.length ? al : undefined });
    if (al.indexOf('captcha') >= 0) { snap('captcha', r); notify('Капча! Бот остановлен — пройдите проверку в игре.'); throw new Stop('капча'); }
    if (al.indexOf('ban') >= 0) { snap('ban', r); notify('Похоже на блокировку. Бот остановлен.'); throw new Stop('блокировка'); }
    if (al.indexOf('logout') >= 0) { notify('Вылетели из игры (страница входа). Бот остановлен.'); throw new Stop('вылет из игры'); }
    if (al.indexOf('dead') >= 0 && !S.dead) markDead(r);
    var h = P.parseHeroHeader(r.text);
    if (h) { if (S.hero && h.level > S.hero.level) onLevelUp(h.level); S.hero = h; }
    return r;
  }

  /** Смерть героя: запомнить моба (не трогать N мин), перейти к задаче «возврат после смерти». */
  function markDead(r) {
    S.dead = true; S.deadPage = r ? r.text : '';
    S.deaths++; if (S.sess) S.sess.deaths++; if (r) snap('dead', r);
    var who = S.curMob;
    if (who) { mstats.death(who.name); S.avoid[who.name] = Date.now() + cfg.avoidAfterDeath * 60000; }
    log('☠ Герой погиб' + (who ? ' (' + who.name + ' [' + who.level + '] — не трогаю ' + cfg.avoidAfterDeath + ' мин)' : ''), 'alert');
    save();
    throw new Dead('смерть');
  }

  /** Снимок текста страницы в журнал для разбора непонятных ситуаций. */
  function snap(why, r) { J.ev('page', why, { url: r.url.replace(location.origin, ''), text: P.pageText(r.text).split('\nALL\n')[0].slice(0, 3000) }); } // без общего чата

  function notify(text) {
    log('⚠ ' + text, 'alert');
    try { chrome.runtime.sendMessage({ type: 'l2m-notify', text: text }); } catch (e) {}
  }

  function onLevelUp(nl) {
    S.levelUps++; if (S.sess) S.sess.levels++;
    log('⬆ Новый уровень: ' + nl, 'level');
  }

  function setLockedHotbar() { document.cookie = 'rr=1; path=/; max-age=31536000'; }
  function setEditHotbar() { document.cookie = 'rr=0; path=/; max-age=31536000'; }

  /* ---------- состояние героя ---------- */
  async function refreshMe() {
    var r = await page('player.php?parameters');
    var p = P.parseParameters(r.text);
    if (p.maxHp) { S.me = Object.assign(S.me, p); S.meAt = Date.now(); if (p.hp <= 0 && !S.dead) markDead(r); }
    if (p.level) { if (!S.hero) S.hero = { name: '', level: p.level }; else if (p.level > S.hero.level) { onLevelUp(p.level); S.hero.level = p.level; } }
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
      setStatus('восстановление у баффера', 'Отдых');
      await openBufferPage(false);
      await page('buffer2.php?buff=28', 'buffer2.php');
      me = await refreshMe();
      log('Полное восстановление: HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%', 'rest');
      if (pct(me.hp, me.maxHp) >= cfg.restHp && pct(me.mp, me.maxMp) >= cfg.restMp) return;
    }
    log('Отдых: HP ' + hp + '% MP ' + mp + '%', 'rest');
    var until = Date.now() + 15 * 60000, t0 = Date.now();
    while (!stopReq && Date.now() < until) {
      setStatus('отдых HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%', 'Отдых');
      wd.progress('rest:' + me.hp + ':' + me.mp);
      await sleep(10000);
      me = await refreshMe();
      if (pct(me.hp, me.maxHp) >= cfg.restUntil && pct(me.mp, me.maxMp) >= cfg.restUntil) break;
    }
    log('Отдых окончен за ' + Math.round((Date.now() - t0) / 1000) + ' с: HP ' + pct(me.hp, me.maxHp) + '% MP ' + pct(me.mp, me.maxMp) + '%', 'rest');
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
    setStatus('бафф', 'Бафф');
    await openBufferPage(cfg.buffVip);
    var base = cfg.buffVip ? 'buffer_vip_40.php' : 'buffer2.php';
    for (var i = 0; i < list.length; i++) { await page(base + '?buff=' + list[i], base); await sleep(jitter(200)); }
    S.lastBuff = Date.now();
    log('Бафф наложен (' + list.length + ')', 'buff', { ids: list, vip: cfg.buffVip });
    save();
  }

  /* ---------- Алтарь ---------- */
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  async function dailyIfNeeded(force) {
    if (!force && (!cfg.daily || S.lastDaily === today())) return;
    setStatus('Алтарь', 'Алтарь');
    var r = await page('daily_altar.php');
    var claims = P.parseAltarClaims(r.text);
    for (var i = 0; i < claims.length; i++) {
      var x = await page(claims[i], 'daily_altar.php');
      var t = P.pageText(x.text).split('\n').find(function (l) { return /Получено|Награда:|Добавлено|выполнено/i.test(l); });
      log('Алтарь: ' + (t || claims[i]), 'altar');
      await sleep(jitter(300));
    }
    if (!claims.length) J.ev('altar', 'забирать нечего');
    S.lastDaily = today();
    save();
  }

  /* ---------- умения: магистр и панель ---------- */
  async function skillInfo(id, level) {
    var k = String(id);
    if (S.skillInfo[k] && S.skillInfo[k].level >= (level || 1)) return S.skillInfo[k];
    var r = await page('magister.php?&des=' + id + '&dl=' + (level || 1), 'magister.php?learnskills');
    var d = P.parseSkillDesc(r.text);
    d.level = level || 1;
    S.skillInfo[k] = d;
    J.ev('skill', 'описание ' + id, d);
    return d;
  }

  async function learnSkills(force) {
    if (!cfg.autoLearn) return;
    if (!force && S.lastLearnLvl === lvl() && Date.now() - S.lastLearnT < 30 * 60000) return;
    setStatus('учу умения у магистра', 'Умения');
    var failed = {}, learned = [], boughtNow = {};
    for (var step = 0; step < 25 && !stopReq; step++) {
      var r = await page('magister.php?learnskills');
      var m = P.parseMagister(r.text);
      if (m.sp != null) S.sp = m.sp;
      var can = m.list.filter(function (x) { var k = x.id + ':' + x.level; return (m.sp == null || x.sp <= m.sp) && !failed[k] && !(S.noBook[k] > Date.now() - cfg.bookRetryH * 3600000); })
      // книжные: сначала боевые, потом лечение, потом остальное (вид — по описанию умения, кэшируется)
      if (cfg.buyBooks) for (var q = 0; q < can.length; q++) if (can[q].book && !S.skillInfo[can[q].id]) await skillInfo(can[q].id, can[q].level);
      var rank = function (x) { if (!x.book) return 0; var k = (S.skillInfo[x.id] || {}).kind; return k === 'attack' ? 1 : k === 'heal' ? 2 : 3; };
      can.sort(function (a, b) { return rank(a) - rank(b) || a.sp - b.sp; });
      if (!can.length) break;
      var pick = can[0];
      if (pick.book && cfg.buyBooks && !boughtNow[pick.book]) {
        var b = await buyBook(pick);
        boughtNow[pick.book] = 1;
        if (b === 'no') { failed[pick.id + ':' + pick.level] = 1; S.noBook[pick.id + ':' + pick.level] = Date.now(); continue; }
      }
      var r2 = await page('magister.php?get=' + pick.id, 'magister.php?learnskills');
      var m2 = P.parseMagister(r2.text);
      var still = m2.list.some(function (x) { return x.id === pick.id && x.level === pick.level; });
      if (still) { failed[pick.id + ':' + pick.level] = 1; S.noBook[pick.id + ':' + pick.level] = Date.now(); J.ev('learn', 'не выучено: ' + pick.name + ' ' + pick.level + (pick.book ? ' (нужна книга)' : ''), pick); continue; }
      learned.push(pick.name + ' ' + pick.level); S.learned++;
      J.ev('learn', 'выучено: ' + pick.name + ' ' + pick.level, pick);
      await sleep(jitter(150));
    }
    if (learned.length) log('📘 Выучено: ' + learned.join(', '), 'learn');
    var waitBook = Object.keys(S.noBook).length;
    if (waitBook) J.ev('learn', 'ждут книгу: ' + waitBook + ' (не пробую ' + cfg.bookRetryH + ' ч)');
    S.lastLearnLvl = lvl(); S.lastLearnT = Date.now();
    await syncHotbar();
    save();
  }

  /* ---------- книги заклинаний (1.5) ----------
     Продавец книг Баринель (Глудио): buy.php?nid=31417&bid=3141700 — список, покупка с любой точки карты:
     POST buy.php?bid=171&nid=31417&buy=<книга>&y, count=1 → «Успешно куплено!». Книга 75–1800 аден.
     Потом magister.php?get=<умение> учит (книга тратится). */
  var BOOK_SHOPS = ['buy.php?nid=31417&bid=3141700'];
  var shop = null, shopAt = 0;
  async function bookShop() {
    if (shop && Date.now() - shopAt < 3600000) return shop;
    shop = {};
    for (var i = 0; i < BOOK_SHOPS.length; i++) {
      var r = await page(BOOK_SHOPS[i], 'npc.php?nid=31417&tymop=npc');
      var list = P.parseBookShop(r.text);
      Object.keys(list).forEach(function (k) { if (!shop[k]) shop[k] = list[k]; });
    }
    shopAt = Date.now();
    J.ev('book', 'книг у продавца: ' + Object.keys(shop).length);
    return shop;
  }
  /** 'ok' — куплена, 'no' — купить нельзя (нет в продаже/дорого/нет адены). */
  async function buyBook(skill) {
    var sh = await bookShop(), b = sh[String(skill.book)];
    if (!b) { J.ev('book', 'книги нет у продавца: ' + skill.name, { book: skill.book }); return 'no'; }
    if (b.price > cfg.bookMaxPrice) { J.ev('book', 'дорого: ' + b.name + ' ' + b.price, b); return 'no'; }
    if (cfg.adenaKeep > 0 && S.me.adena != null && S.me.adena - b.price < cfg.adenaKeep) { J.ev('book', 'мало адены на ' + b.name, b); return 'no'; }
    setStatus('покупаю ' + b.name, 'Умения');
    var path = 'buy.php?bid=' + b.bid + '&nid=' + b.nid + '&buy=' + b.item + '&y';
    var r = await page(path, 'forms.php?bid=' + b.bid + '&nid=' + b.nid + '&bbuy=' + b.item, 'count=1&send=%C4%E0%EB%E5%E5'); // «Далее» в windows-1251
    var ok = /Успешно куплено/i.test(P.pageText(r.text));
    if (!ok) { snap('book-buy', r); log('📕 Не удалось купить ' + b.name + ' (' + b.price + ' аден)', 'book', b); return 'no'; }
    S.booksBought = (S.booksBought || 0) + 1;
    log('📗 Куплена ' + b.name + ' за ' + b.price + ' аден', 'book', b);
    return 'ok';
  }

  /** Новые боевые умения — на свободные ячейки панели боя. */
  async function syncHotbar() {
    if (!cfg.autoHotbar) return;
    setEditHotbar();
    try {
      var a = await page('actions.php');
      var slots = P.parseSlots(a.text);
      if (!slots.length) { J.ev('hotbar', 'ячейки не найдены'); return; }
      var used = {}; slots.forEach(function (s) { if (s.skill) used[s.skill] = s.slot; });
      var free = slots.filter(function (s) { return !s.skill; }).map(function (s) { return s.slot; });
      var list = P.parseSlotSkills((await page('actions.php?addsc=' + free[0] + '&skills', 'actions.php')).text);
      var added = [];
      for (var i = 0; i < list.length && free.length; i++) {
        var sk = list[i];
        var inf = await skillInfo(sk.id, sk.level);
        if (used[sk.id] != null || (inf.kind !== 'attack' && inf.kind !== 'heal')) continue;
        var slot = free.shift();
        await page('actions.php?addsc=' + slot + '&skill=' + sk.id, 'actions.php?addsc=' + slot + '&skills');
        added.push(sk.name);
        J.ev('hotbar', 'на панель: ' + sk.name + ' → ячейка ' + slot, { id: sk.id, slot: slot });
      }
      if (added.length) log('Панель боя: добавлено ' + added.join(', '), 'hotbar');
    } finally { setLockedHotbar(); }
  }

  /* ---------- выбор моба ---------- */
  function inRange(level) { var l = lvl(); return level <= l + (+cfg.maxLvlAbove) && level >= l - (+cfg.maxLvlBelow); }
  function avoided(name) { var t = S.avoid[name]; if (t && t > Date.now()) return true; if (t) delete S.avoid[name]; return mstats.dangerous(name); }
  /** Оценка моба: выученный «опыт в секунду», иначе опыт из базы ÷ средняя длина боя, иначе уровень. */
  function score(m) {
    var r = mstats.rate(m.name);
    if (r != null) return r;
    var d = db.byName(m.name), avg = S.sess && S.sess.kills ? S.sess.fightMs / 1000 / S.sess.kills : 8;
    if (d && d[3]) return d[3] / Math.max(1, avg) * 1.05; // чуть выше известных — чтобы бот пробовал новых мобов
    return m.level;
  }
  function pickMob(mobs) {
    var black = names(cfg.blacklist);
    var ok = mobs.filter(function (m) {
      if (!inRange(m.level)) return false;
      if (black.indexOf(m.name.toLowerCase()) >= 0) return false;
      if (avoided(m.name)) return false;
      if (cfg.whiteOnly && m.color && !/^#?(fff|ffffff|white)$/.test(m.color)) return false;
      return true;
    });
    if (cfg.preferBest) ok.sort(function (a, b) { return score(b) - score(a) || b.level - a.level; });
    else ok.sort(function (a, b) { return b.level - a.level; });
    return ok[0] || null;
  }

  /* ---------- смена места кача ---------- */
  var moveFailed = {};
  async function relocate(mobsHere) {
    if (!cfg.autoMove) return false;
    setStatus('ищу место кача', 'Переход');
    var near = P.parseNearby((await page('help.php?top=8')).text);
    var black = names(cfg.blacklist), l = lvl();
    var here = {}; (mobsHere || []).forEach(function (m) { here[m.name] = 1; });
    // 1.4: идти стоит только к мобам не ниже героя −2 — иначе бот «переходил» на то же место (лог 22:47).
    var cand = near.filter(function (m) { return inRange(m.level) && m.level >= l - 2 && !moveFailed[m.eid] && !here[m.name] && !avoided(m.name) && black.indexOf(m.name.toLowerCase()) < 0; })
      .sort(function (a, b) { return placeScore(b, l) - placeScore(a, l); });
    J.ev('move', 'кандидаты рядом', { near: near.map(function (c) { return c.name + ' ' + c.level; }), cand: cand.map(function (c) { return c.name + ' ' + c.level; }) });
    for (var i = 0; i < cand.length && !stopReq; i++) {
      var d = P.parseDroplist((await page('droplist.php?eid=' + cand[i].eid, 'help.php?top=8')).text);
      if (cfg.avoidAgro && d.agro) { moveFailed[cand[i].eid] = 1; continue; }
      if (!d.run) { moveFailed[cand[i].eid] = 1; continue; }
      log('🏃 Иду к мобам: ' + cand[i].name + ' [' + cand[i].level + ']', 'move', { eid: cand[i].eid, x: d.x, y: d.y });
      S.place = cand[i].name + ' [' + cand[i].level + ']';
      await page(d.run, 'droplist.php?eid=' + cand[i].eid);
      return await walkUntilMobs(cand[i], 10);
    }
    // Рядом ничего — дальний переход по базе мобов (уровень героя −1…+6, ближе и выгоднее — лучше).
    var far = dbCandidates(mobsHere || [], l)[0];
    if (far) {
      log('🧭 Рядом мобов по уровню нет — иду в новый район: ' + far.name + ' [' + far.level + ']' + (far.dist != null ? ', ~' + Math.round(far.dist / 1000) + ' тыс. шагов' : ''), 'move', far);
      S.place = far.name + ' [' + far.level + ']';
      await page('map.php?map&move_x=' + far.x + '&move_y=' + far.y, 'map.php');
      return await walkUntilMobs(far, 25);
    }
    J.ev('move', 'подходящих мест нет ни рядом, ни в базе', { lvl: l });
    return false;
  }

  /** Где герой сейчас: средние координаты (по базе) мобов на его карте. */
  function herePos(mobsHere) {
    var xs = 0, ys = 0, n = 0;
    (mobsHere || []).forEach(function (m) { var r = db.byName(m.name); if (r && r[6] != null) { xs += r[6]; ys += r[7]; n++; } });
    if (!n && S.lastPos) return S.lastPos;
    return n ? (S.lastPos = { x: xs / n, y: ys / n }) : null;
  }
  /** Кандидаты из базы мобов для дальнего перехода, лучшие первыми. */
  function dbCandidates(mobsHere, l) {
    var pos = herePos(mobsHere), black = names(cfg.blacklist), out = [];
    (root.L2MMobs || []).forEach(function (r) {
      var lv = r[2]; if (r[6] == null || lv < l - 1 || lv > l + Math.min(6, +cfg.maxLvlAbove)) return;
      if (cfg.avoidAgro && r[5]) return;
      if (moveFailed[r[0]] || avoided(r[1]) || black.indexOf(r[1].toLowerCase()) >= 0) return;
      var dist = pos ? Math.sqrt(Math.pow(r[6] - pos.x, 2) + Math.pow(r[7] - pos.y, 2)) : null;
      // соседи того же уровня рядом (в радиусе 6000) — значит, там целый район, а не один моб
      var nb = 0;
      (root.L2MMobs || []).forEach(function (q) { if (q !== r && q[6] != null && Math.abs(q[2] - (l + 2)) <= 4 && Math.abs(q[6] - r[6]) < 6000 && Math.abs(q[7] - r[7]) < 6000) nb++; });
      var sc = -Math.abs(lv - (l + 3)) + Math.min(nb, 6) * 0.4 + (r[4] ? Math.log(1 + r[3] / r[4] * 10) : 0) - (dist != null ? dist / 15000 : 0);
      out.push({ eid: r[0], name: r[1], level: lv, x: r[6], y: r[7], dist: dist, score: +sc.toFixed(2), db: true });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /** Место кача: чем выгоднее моб (опыт за HP из базы или выученный опыт/сек) и ближе к ур.+3, тем лучше. */
  function placeScore(m, l) {
    var s = -Math.abs(m.level - (l + 3)) + Math.min(m.count, 5) * 0.2;
    var r = mstats.rate(m.name), v = db.value(m.name);
    if (r != null) s += Math.log(1 + r);
    else if (v != null) s += Math.log(1 + v * 10);
    return s;
  }

  /** Ждём, пока герой дойдёт: пришёл, когда рядом целевой моб или моб не ниже героя −2 (не «мелочь» старого места). */
  async function walkUntilMobs(target, maxMin) {
    var last = null, same = 0, t0 = Date.now();
    while (!stopReq && Date.now() - t0 < (maxMin || 10) * 60000) {
      await sleep(4000);
      var m = await page('map.php');
      var mobs = P.parseMapMobs(m.text);
      var l = lvl();
      var good = pickMob(mobs.filter(function (x) { return x.name === target.name || x.level >= l - 2; }));
      var c = P.parseMapCoords(m.text);
      setStatus('в пути к ' + target.name + (c ? ' (' + c.x + ':' + c.y + ')' : '') + ', ' + Math.round((Date.now() - t0) / 1000) + ' с', 'Переход');
      var key = c ? c.x + ':' + c.y : '';
      if (good) { log('Пришёл: рядом ' + good.name + ' [' + good.level + '] за ' + Math.round((Date.now() - t0) / 1000) + ' с', 'move'); wd.progress('move:' + key); S.lastPos = null; return true; }
      if (key !== last) wd.progress('walk:' + key);
      if (key && key === last) {
        if (++same >= 3) {
          // дошли (стоим), но нужных мобов нет — пусть охота бьёт то, что есть; место не повторяем
          J.ev('move', 'стою на месте, нужных мобов нет', { at: key, mobs: mobs.map(function (x) { return x.name + ' ' + x.level; }) });
          moveFailed[target.eid] = 1; return pickMob(mobs) != null;
        }
      } else same = 0;
      last = key;
    }
    return false;
  }

  /* ---------- бой ---------- */
  function rememberSkills(hb) {
    var changed = false;
    hb.skills.forEach(function (s) { if (S.knownSkills.indexOf(s.id) < 0) { S.knownSkills.push(s.id); changed = true; } });
    if (changed) save();
  }

  function rotation(hb) {
    var order = ids(cfg.skills);
    if (order.length) return order;
    return hb.skills.map(function (s) { return s.id; }).filter(function (id) {
      var i = S.skillInfo[id]; return !i || i.kind === 'attack';
    }).filter(function (id) { return !(S.skillInfo[id] == null && id === '27'); })
      .sort(function (a, b) { return ((S.skillInfo[b] || {}).power || 0) - ((S.skillInfo[a] || {}).power || 0); });
  }

  function chooseAction(hb, now) {
    if (S.me.maxHp && pct(S.me.hp, S.me.maxHp) < cfg.healAt) {
      var heal = hb.skills.find(function (s) { var i = S.skillInfo[s.id]; return i && i.kind === 'heal' && !(S.cd[s.id] > now); });
      if (heal) return { href: heal.href, label: 'лечение ' + heal.id, skill: heal.id, heal: true };
    }
    var order = rotation(hb);
    for (var i = 0; i < order.length; i++) {
      var sk = hb.skills.find(function (s) { return s.id === order[i]; });
      if (sk && !(S.cd[sk.id] > now)) return { href: sk.href, label: 'умение ' + sk.id, skill: sk.id };
    }
    if (cfg.useAttack && hb.attack) return { href: hb.attack, label: 'атака' };
    return null;
  }

  async function finishBattle(endText, f) {
    var end = P.parseBattleEnd(endText);
    var adena = end.adena;
    end.loot.forEach(function (l) { var m = /^Адена\s+([\d,]+)/.exec(l); if (m && !adena) adena = +m[1].replace(/\D/g, ''); });
    S.kills++; S.adena += adena;
    if (S.sess) { S.sess.kills++; S.sess.adena += adena; }
    if (cfg.loot && end.takeAll) await page('battle.php');
    var loot = end.loot.filter(function (x) { return x !== '⚔'; });
    var secs = f ? ((Date.now() - f.t0) / 1000).toFixed(1) : '?';
    if (f) {
      S.lastFight = { name: f.name, secs: +secs, hits: f.hits }; if (S.sess) S.sess.fightMs += Date.now() - f.t0;
      winPending(f, end.exp);
    }
    dayCount();
    wd.progress('kill:' + S.kills);
    log('✔ ' + (f ? f.name + ' за ' + secs + ' с, ' + f.hits + ' ударов' : 'Победа') + (loot.length ? ' — ' + loot.join(', ') : ''), 'win', { mob: f && f.name, secs: +secs, hits: f && f.hits, loot: loot, adena: adena, levelUp: end.levelUp });
    if (end.levelUp) await refreshMe(); // учёбу запустит планировщик (новый уровень)
    save();
  }

  /* Опыт за бой l2mobi пишет не на странице добычи, а строкой «Вы получили N exp и M sp.»
     в журнале СЛЕДУЮЩЕГО боя (лог John 22:35: у всех мобов было exp 0). Победу держим «в ожидании»,
     опыт засчитываем, когда откроется следующий бой. */
  function winPending(f, exp) {
    flushPending(null);
    S.pendingWin = { mob: f.mob, ms: Date.now() - f.t0, hits: f.hits };
    if (exp) flushPending(exp);
  }
  function flushPending(exp) {
    var p = S.pendingWin; if (!p) return;
    S.pendingWin = null;
    mstats.win(p.mob, p.ms, exp || 0, p.hits);
    if (exp && S.sess) S.sess.expPts += exp;
    if (S.lastFight && exp) S.lastFight.exp = exp;
    if (exp) J.ev('exp', p.mob + ': ' + exp + ' exp');
  }
  function expFromLog(lines) {
    for (var i = 0; i < Math.min(lines.length, 10); i++) {
      var m = /получили\s*([\d\s]+?)\s*exp/i.exec(lines[i]);
      if (m) return +m[1].replace(/\D/g, '');
    }
    return 0;
  }

  function isEnd(r) { return r.battleEnd || /ЗАБРАТЬ ВСЕ|ДОБЫЧА\s*\(/.test(r.text); }

  /* Удары идут обычной страницей battle.php?…&go=ID / &attack — так же, как в игре без AJAX.
     battle_ajax.php не используем: сервер помечает ответ как gzip, а шлёт простой текст,
     и браузер отвечает ERR_CONTENT_DECODING_FAILED. */
  async function fight(mob) {
    setLockedHotbar();
    var f = { name: mob.name + ' [' + mob.level + ']', mob: mob.name, t0: Date.now(), hits: 0 };
    S.curMob = mob;
    setStatus('бой: ' + f.name, 'Охота');
    var r = await page(mob.href, 'map.php');
    if (isEnd(r)) { await finishBattle(r.text, f); return 'end'; }
    var hb = P.parseHotbar(r.text);
    if (!hb.attack && !hb.skills.length && P.isEditMode(r.text)) { setLockedHotbar(); r = await page(mob.href, 'map.php'); hb = P.parseHotbar(r.text); }
    if (!hb.attack && !hb.skills.length) { log('Моб ' + mob.name + ' недоступен', 'lost'); snap('no-hotbar', r); return 'skip'; }
    rememberSkills(hb);
    flushPending(expFromLog(P.parseBattleLog(r.text)));
    var ref = mob.href, lastSig = '', still = 0;
    for (var step = 0; step < 150 && !stopReq; step++) {
      var bars = P.parseBars(r.text); if (bars.maxHp) Object.assign(S.me, bars);
      var hud = P.parseTargetHud(r.text);
      var cds = P.parseCooldowns(r.text); for (var k in cds) S.cd[k] = cds[k] * 1000;
      var cast = P.parseCasting(r.text);
      var blog = P.parseBattleLog(r.text);
      emit();
      var sig = (hud ? hud.hp : '?') + '/' + S.me.hp;
      if (sig === lastSig) still++; else { still = 0; lastSig = sig; }
      if (still >= 10) { log('Бой без изменений 10 ходов — выхожу к карте', 'lost', { log: blog.slice(0, 5) }); snap('stuck', r); return 'stuck'; }
      var now = N.serverNow();
      var castWait = cast ? cast.casting * 1000 - now + 150 : 0;
      // «Цель слишком далеко»: удар не прошёл и каста нет — повторяем сразу, без паузы
      // (задержка первого удара из 1.2 не помогала и только удлиняла бои).
      var far = step > 0 && /слишком далеко/i.test(blog[0] || '');
      if (far) J.ev('far', 'повтор сразу');
      // Действие выбираем на момент конца каста: умение, которое к тому времени откатится, лучше слабой обычной атаки.
      var act = chooseAction(hb, now + Math.max(0, castWait));
      var wait = step === 0 || far ? Math.max(castWait, 0) : Math.max(castWait, cfg.minDelay * 1000);
      if (act && !act.skill && cast && cast.PN && step > 0 && !far) wait = Math.max(wait, cast.PN * 1000 - 300);
      J.ev('hit', act ? act.label : 'жду', { step: step, me: [S.me.hp, S.me.maxHp, S.me.mp, S.me.maxMp], mob: hud ? [hud.hp, hud.maxHp] : null, wait: Math.round(wait), log: blog[0] });
      if (wait > 0) await sleep(jitter(wait));
      if (!act) { await sleep(500); r = await page(ref, ref); continue; }
      r = await page(act.href, ref);
      ref = act.href; f.hits++;
      if (isEnd(r)) { await finishBattle(r.text, f); return 'win'; }
      if (/\/map\.php/.test(r.url) || !/l2-target-hud/.test(r.text)) {
        // Моб убит, добычи нет — игра сразу вернула на карту. (Смерть ловит page() по «Вас убили.»)
        S.kills++; if (S.sess) { S.sess.kills++; S.sess.fightMs += Date.now() - f.t0; } dayCount(); wd.progress('kill:' + S.kills);
        S.lastFight = { name: f.name, secs: +((Date.now() - f.t0) / 1000).toFixed(1), hits: f.hits };
        winPending(f, 0);
        log('✔ ' + f.name + ' за ' + S.lastFight.secs + ' с, ' + f.hits + ' ударов — добычи нет', 'win', { mob: f.name, secs: S.lastFight.secs, hits: f.hits, noLoot: true });
        save();
        return 'win';
      }
      var nhb = P.parseHotbar(r.text);
      if (nhb.attack || nhb.skills.length) hb = nhb;
    }
    return 'timeout';
  }

  /* ---------- после смерти ---------- */
  async function recoverDeath() {
    if (cfg.stopOnDeath) { notify('Герой погиб. Бот остановлен.'); throw new Stop('смерть'); }
    if ((S.deathTries = (S.deathTries || 0) + 1) > 2) { notify('Не удалось вернуться после смерти. Бот остановлен.'); throw new Stop('не вернулся после смерти'); }
    setStatus('возвращаюсь после смерти', 'Выживание');
    var hour = Date.now() - 3600000;
    S.deathTimes = (S.deathTimes || []).filter(function (t) { return t > hour; }); S.deathTimes.push(Date.now());
    if (S.deathTimes.length > 3) { notify('Больше 3 смертей за час. Бот остановлен — проверьте снаряжение и место кача.'); throw new Stop('много смертей'); }
    // Ссылка «воскреснуть / в город» со страницы смерти, иначе город.
    // l2mobi: «Вас убили.» и кнопка «В город» = index.php?doa=1 (снято 16.11).
    var lk = P.links(S.deadPage || '').filter(function (a) { return (/doa=1/.test(a.href) || /воскрес|возрод|в город|встать|вернуться/i.test(a.text)) && !/javascript:/i.test(a.href); });
    if (!lk.length) lk = [{ href: 'index.php?doa=1', text: 'В город' }];
    J.ev('death', 'ссылки на странице смерти', { links: lk.slice(0, 6) });
    S.dead = false; // page() снова поймает смерть, если она не прошла
    try {
      if (lk.length) await page(lk[0].href.replace(/^\//, ''), 'map.php');
      await page('town.php');
      var me = null;
      for (var i = 0; i < 18; i++) { // до 3 мин: на l2mobi герой с 0 HP понемногу восстанавливается
        try { me = await refreshMe(); } catch (e2) { if (!(e2 instanceof Dead)) throw e2; S.dead = false; me = S.me; }
        if (me.maxHp && me.hp > 0) break;
        setStatus('жду, пока вернётся HP после смерти', 'Выживание'); await sleep(10000);
      }
      if (!me || !me.maxHp || me.hp <= 0) throw new Error('герой всё ещё мёртв');
    } catch (e) {
      if (e instanceof Dead) throw new Error('герой всё ещё мёртв');
      throw e;
    }
    S.deathTries = 0;
    log('✚ Вернулся после смерти: HP ' + pct(S.me.hp, S.me.maxHp) + '%', 'death');
    S.needMove = true; // место, где погиб, опасно — ищем другое
    S.deadPage = null;
  }

  /* ---------- суточный лимит ---------- */
  function dayCount() {
    var k = C.serverDay(N.serverNow());
    if (S.day.key !== k) S.day = { key: k, kills: 0 };
    S.day.kills++;
  }
  function dayLimitReached() {
    var k = C.serverDay(N.serverNow());
    if (S.day.key !== k) S.day = { key: k, kills: 0 };
    return cfg.dailyKills > 0 && S.day.kills >= cfg.dailyKills;
  }

  /* ---------- задачи планировщика (как в старом боте: больше prio — раньше) ---------- */
  function hpPct() { return pct(S.me.hp, S.me.maxHp); }
  function mpPct() { return pct(S.me.mp, S.me.maxMp); }
  var SERVICES = [
    { key: 'survive', title: '✚ Возврат после смерти', prio: 100, enabled: function () { return true; }, due: function () { return S.dead; }, run: recoverDeath },
    { key: 'limit', title: '⏸ Суточный лимит боёв', prio: 95, enabled: function (c) { return c.dailyKills > 0; }, due: function () { return dayLimitReached(); },
      run: async function () { setStatus('суточный лимит ' + cfg.dailyKills + ' боёв — жду новых суток', 'Лимит'); wd.progress('limit:' + Math.floor(Date.now() / 300000)); await sleep(60000); } },
    { key: 'daily', title: '⚑ Алтарь (раз в день)', prio: 90, enabled: function (c) { return c.daily || S.force.daily; }, due: function () { return S.force.daily || S.lastDaily !== today(); }, run: function () { delete S.force.daily; return dailyIfNeeded(true); } },
    { key: 'learn', title: '✦ Учёба умений', prio: 80, enabled: function (c) { return c.autoLearn || S.force.learn; },
      due: function () { return S.force.learn || S.lastLearnLvl !== lvl() || Date.now() - S.lastLearnT > 30 * 60000; }, run: function () { delete S.force.learn; return learnSkills(true); } },
    { key: 'buff', title: '✚ Бафф', prio: 70, enabled: function (c) { return ids(c.buffs).length > 0; },
      due: function () { return S.force.buff || Date.now() - S.lastBuff >= cfg.buffEvery * 60000; }, run: function () { delete S.force.buff; return buffIfNeeded(true); } },
    { key: 'rest', title: '☕ Отдых', prio: 60, enabled: function () { return true; },
      due: function () { return !S.me.maxHp || hpPct() < cfg.restHp || mpPct() < cfg.restMp; }, run: restIfNeeded },
    { key: 'move', title: '🏃 Смена места кача', prio: 50, enabled: function (c) { return c.autoMove; }, due: function () { return S.needMove; },
      run: async function () { S.needMove = false; var ok = await relocate(S.mobsHere || []); if (!ok) { sched.hold('move', 10, 'новое место не найдено'); J.ev('move', 'пауза перехода 10 мин'); } } },
    { key: 'hunt', title: '⚔ Охота', prio: 10, enabled: function () { return true; }, due: function () { return true; }, run: huntStep }
  ];
  var sched = C.createScheduler(SERVICES);

  var empty = 0;
  async function huntStep() {
    setStatus('ищу моба', 'Охота');
    var m = await page('map.php');
    var mobs = P.parseMapMobs(m.text);
    S.mobsHere = mobs;
    var mob = pickMob(mobs);
    J.ev('pick', mob ? mob.name + ' [' + mob.level + ']' : 'нет подходящих', { all: mobs.map(function (x) { return x.name + ' ' + x.level; }), lvl: lvl(), score: mob ? +score(mob).toFixed(2) : undefined });
    if (!mob) {
      empty++;
      setStatus('мобов нет (' + mobs.length + ' рядом не подходят), попытка ' + empty, 'Охота');
      if (empty >= cfg.emptyTries && cfg.autoMove) { empty = 0; S.needMove = true; return; }
      await sleep(cfg.emptyWait * 1000);
      return;
    }
    empty = 0;
    // HP на карте не видно: если по последнему бою мало — сверить и отдохнуть ДО боя (смерть в логе 16.11: бой начат с 32% HP).
    if (S.me.maxHp && pct(S.me.hp, S.me.maxHp) < cfg.restHp + 25) {
      await refreshMe();
      if (pct(S.me.hp, S.me.maxHp) < cfg.restHp || pct(S.me.mp, S.me.maxMp) < cfg.restMp) return;
    }
    var res = await fight(mob);
    S.curMob = null;
    if (res === 'skip' || res === 'stuck') S.avoid[mob.name] = Date.now() + 10 * 60000;
  }

  /* ---------- главный цикл ---------- */
  async function loop() {
    var g = myGen = gen;
    log('▶ Старт (версия ' + VERSION + ')', 'log', { cfg: cfg });
    try { await refreshMe(); } catch (e) { if (e instanceof Stop) return finish(e); if (e instanceof Dead) { /* обработает планировщик */ } }
    if (!S.sess) S.sess = { t0: Date.now(), kills: 0, adena: 0, deaths: 0, levels: 0, fightMs: 0, expPts: 0, lvl0: lvl(), exp0: S.me.exp };
    wd.progress('start:' + Date.now());
    while (!stopReq && g === gen) {
      var svc = null;
      try {
        var w = wd.check(cfg.stuckMin);
        if (w === 'halt') { notify('Нет прогресса ' + (cfg.stuckMin * 3) + ' мин. Бот остановлен.'); throw new Stop('нет прогресса'); }
        if (w === 'relocate') { log('⏳ Нет прогресса ' + cfg.stuckMin + ' мин — меняю место', 'watchdog'); S.needMove = true; }
        svc = sched.next(cfg, S);
        if (!svc) { await sleep(2000); continue; }
        S.now = svc.title; emit();
        await svc.run();
        sched.ok(svc.key); rec.progress(svc.key);
      } catch (e) {
        if (e instanceof Stop) return g === gen ? finish(e) : undefined;
        if (e instanceof Dead) { continue; } // следующей задачей будет «возврат после смерти»
        var key = svc ? svc.key : 'loop';
        var f = rec.failure(key, e);
        var held = svc && svc.key !== 'hunt' && sched.fail(svc.key, f.msg);
        log('Ошибка (' + (svc ? svc.title : 'цикл') + '): ' + f.msg + (held ? ' — задача на паузе 30 мин' : '') + ', повтор через ' + Math.round(f.delay / 1000) + ' с', 'err',
          { stack: String(e && e.stack || '').slice(0, 800), recent: f.recent, network: f.network });
        if (f.action === 'halt') { notify('Повторяется ошибка: ' + f.msg + '. Бот остановлен.'); return finish(new Stop('ошибка повторяется')); }
        await sleep(f.delay);
      }
    }
    if (g === gen) finish();
  }

  function finish(e) {
    S.running = false; stopReq = false; S.now = '';
    setStatus(e && e.message ? 'остановлен: ' + e.message : 'остановлен', '');
    log('■ Стоп', 'log', { sess: S.sess });
    save();
  }

  function start() {
    if (S.running) return;
    S.running = true; stopReq = false; gen++; S.sess = null; S.beat = Date.now();
    save(); emit();
    loop();
  }
  function stop() { if (S.running) { stopReq = true; setStatus('останавливаюсь…'); } }
  /** Сторож вкладки: цикл завис (нет запросов и пауз 3 мин) — запустить новый, старый выйдет сам. */
  function kick(why) {
    if (!S.running) return;
    log('↻ Перезапуск цикла: ' + (why || 'завис'), 'watchdog');
    gen++; stopReq = false; S.beat = Date.now();
    loop();
  }
  function tasks() { return sched.view(cfg); }
  function releaseTask(k) { sched.release(k); J.ev('task', 'снята пауза: ' + k); emit(); }

  /* ---------- хранение ---------- */
  var KEY = 'l2mobi_bot_v1';
  function save() {
    try {
      chrome.storage.local.set({ [KEY]: {
        v11: true, v12: true, v13: true, v15: true, cfg: cfg, running: S.running, avoid: S.avoid, day: S.day, noBook: S.noBook, mobStats: mstats.exportState(), sched: sched.exportState(), lastBuff: S.lastBuff, lastDaily: S.lastDaily, knownSkills: S.knownSkills, skillInfo: S.skillInfo,
        lastLearnLvl: S.lastLearnLvl, lastLearnT: S.lastLearnT,
        stats: { kills: S.kills, adena: S.adena, deaths: S.deaths, levelUps: S.levelUps, learned: S.learned }, log: S.log.slice(0, 100)
      } });
    } catch (e) {}
  }
  function load() {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get(KEY, function (o) {
          var v = o && o[KEY];
          if (v) {
            var c = v.cfg || {};
            // 1.1: диапазон мобов −5…+9 и пауза 0,3 с по умолчанию (в 1.0 было −9…+3 и 1,3 с)
            if (!v.v11) { delete c.maxLvlAbove; delete c.maxLvlBelow; delete c.minDelay; delete c.emptyWait; }
            // 1.2: после смерти не стоять, а возвращаться
            if (!v.v12) { delete c.stopOnDeath; if (c.restHp === 40) delete c.restHp; }
            S.avoid = v.avoid || {}; S.day = v.day || { key: '', kills: 0 }; S.noBook = v.v15 ? (v.noBook || {}) : {}; // 1.5: книги теперь покупаются — пробуем заново
            if (v.v13) mstats.importState(v.mobStats); // 1.2 писал опыт 0 — начинаем учёт заново sched.importState(v.sched);
            cfg = Object.assign({}, DEFAULTS, c);
            S.lastBuff = v.lastBuff || 0; S.lastDaily = v.lastDaily || ''; S.knownSkills = v.knownSkills || [];
            S.skillInfo = v.skillInfo || {};
            Object.keys(S.skillInfo).forEach(function (k) { var i = S.skillInfo[k]; if (i && i.text) i.kind = P.skillKind(i.text, i.power); }); // 1.2: «Самолечение» — лечение S.lastLearnLvl = v.lastLearnLvl || 0; S.lastLearnT = v.lastLearnT || 0;
            var st = v.stats || {};
            S.kills = st.kills || 0; S.adena = st.adena || 0; S.deaths = st.deaths || 0; S.levelUps = st.levelUps || 0; S.learned = st.learned || 0;
            S.log = v.log || [];
          }
          res(v || {});
        });
      } catch (e) { res({}); }
    }).then(function (v) {
      try { var o = {}; o[KEY] = Object.assign({}, v, { cfg: cfg, v11: true, v12: true, v13: true, v15: true }); chrome.storage.local.set(o); } catch (e) {}
      return v;
    });
  }
  function setCfg(patch) { cfg = Object.assign({}, cfg, patch); J.ev('cfg', 'настройка', patch); save(); emit(); }
  function resetStats() { S.kills = 0; S.adena = 0; S.deaths = 0; S.levelUps = 0; S.learned = 0; save(); emit(); }

  /** Сводка для файла логов. */
  function info() {
    return { version: VERSION, hero: S.hero, me: S.me, cfg: cfg, stats: { kills: S.kills, adena: S.adena, deaths: S.deaths, levelUps: S.levelUps, learned: S.learned },
      sess: S.sess, skills: S.knownSkills, skillInfo: S.skillInfo, ua: navigator.userAgent, page: location.pathname,
      tasks: sched.view(cfg), recovery: rec.snapshot(), watchdog: wd.snapshot(), mobStats: mstats.top(40), avoid: S.avoid, day: S.day, mobDb: db.size };
  }

  /** Кнопки «сейчас»: бот стоит — делаем сразу; бот работает — ставим задачу первой в очередь (1.1 отвечал «Сначала остановите бота»). */
  function wrap(fn, name, key) {
    return function () {
      if (S.running) { S.force[key] = true; log(name + ': сделаю сразу после текущего боя'); return; }
      return fn(true).catch(function (e) { log(name + ': ' + (e && e.message || e), 'err'); });
    };
  }

  root.L2MEngine = {
    VERSION: VERSION, DEFAULTS: DEFAULTS, state: S, get cfg() { return cfg; }, setCfg: setCfg, start: start, stop: stop, load: load,
    onChange: onChange, log: log, resetStats: resetStats, info: info, kick: kick, tasks: tasks, releaseTask: releaseTask,
    mobTop: function (n) { return mstats.top(n); }, exportCfg: function () { return JSON.parse(JSON.stringify(cfg)); },
    importCfg: function (o) { var c = {}; Object.keys(DEFAULTS).forEach(function (k) { if (o && o[k] !== undefined && typeof o[k] === typeof DEFAULTS[k]) c[k] = o[k]; }); setCfg(c); return Object.keys(c).length; },
    buffNow: wrap(buffIfNeeded, 'Бафф', 'buff'), dailyNow: wrap(dailyIfNeeded, 'Алтарь', 'daily'), learnNow: wrap(learnSkills, 'Умения', 'learn'),
    _test: { pickMob: pickMob, chooseAction: chooseAction, ids: ids, setHero: function (h) { S.hero = h; }, rotation: rotation, buyBook: buyBook, mstats: mstats, sched: sched, expFromLog: expFromLog, winPending: winPending, flushPending: flushPending, placeScore: placeScore, services: SERVICES, dbCandidates: dbCandidates }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
