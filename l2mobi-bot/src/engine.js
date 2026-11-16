/* L2Mobi Bot 1.1 — движок: автофарм, отдых, бафф, Алтарь, умения, смена места кача.
   Работает во вкладке игры через fetch, пишет подробный журнал (L2MJournal). */
(function (root) {
  'use strict';
  var P = root.L2MParse, N = root.L2MNet;
  var J = root.L2MJournal || { ev: function () {} };
  var VERSION = '1.1';

  var DEFAULTS = {
    skills: '',          // id умений через запятую в порядке приоритета ('' = боевые с панели, сильнее — раньше)
    useAttack: true,     // бить обычной атакой, когда умения на откате
    maxLvlAbove: 9,      // моб не выше героя + N (John: −5…+9)
    maxLvlBelow: 5,      // моб не ниже героя − N
    whiteOnly: false,
    blacklist: '',
    loot: true,
    restHp: 40, restMp: 20, restUntil: 90,
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
    stopOnDeath: true
  };

  var S = {
    version: VERSION, running: false, status: 'остановлен', task: '', hero: null, me: {},
    kills: 0, adena: 0, deaths: 0, levelUps: 0, learned: 0,
    sess: null, lastBuff: 0, lastDaily: '', lastLearnLvl: 0, lastLearnT: 0,
    knownSkills: [], skillInfo: {}, cd: {}, log: [], lastFight: null, place: null
  };
  var cfg = Object.assign({}, DEFAULTS);
  var listeners = [];
  var stopReq = false;

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
      (function tick() { if (stopReq || Date.now() >= end) return r(); setTimeout(tick, Math.min(200, end - Date.now())); })();
    });
  }
  function jitter(ms, j) { return ms + Math.floor(Math.random() * (j == null ? 120 : j)); }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : 100; }
  function ids(str) { return String(str || '').split(/[\s,;]+/).filter(function (x) { return /^\d+$/.test(x); }); }
  function names(str) { return String(str || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
  function lvl() { return S.hero ? S.hero.level : (S.me.level || 1); }

  class Stop extends Error {}

  async function page(path, referer) {
    if (stopReq) throw new Stop();
    var t0 = Date.now(), r;
    try { r = await N.get(path, { referer: referer }); }
    catch (e) { J.ev('req', path, { err: String(e && e.message || e), ms: Date.now() - t0 }); throw e; }
    var al = P.detectAlerts(r.text);
    J.ev('req', String(path).slice(0, 160), { st: r.status, ms: Date.now() - t0, kb: Math.round(r.text.length / 1024), url: r.url.replace(location.origin, ''), end: r.battleEnd || undefined, al: al.length ? al : undefined });
    if (al.indexOf('captcha') >= 0) { snap('captcha', r); notify('Капча! Бот остановлен — пройдите проверку в игре.'); throw new Stop('капча'); }
    if (al.indexOf('ban') >= 0) { snap('ban', r); notify('Похоже на блокировку. Бот остановлен.'); throw new Stop('блокировка'); }
    if (al.indexOf('logout') >= 0) { notify('Вылетели из игры (страница входа). Бот остановлен.'); throw new Stop('вылет из игры'); }
    if (al.indexOf('dead') >= 0) {
      S.deaths++; if (S.sess) S.sess.deaths++; snap('dead', r); log('☠ Герой погиб', 'alert');
      if (cfg.stopOnDeath) { notify('Герой погиб. Бот остановлен.'); throw new Stop('смерть'); }
    }
    var h = P.parseHeroHeader(r.text);
    if (h) { if (S.hero && h.level > S.hero.level) onLevelUp(h.level); S.hero = h; }
    return r;
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
    if (p.maxHp) S.me = Object.assign(S.me, p);
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
    var failed = {}, learned = [];
    for (var step = 0; step < 25 && !stopReq; step++) {
      var r = await page('magister.php?learnskills');
      var m = P.parseMagister(r.text);
      var can = m.list.filter(function (x) { return (m.sp == null || x.sp <= m.sp) && !failed[x.id + ':' + x.level]; })
        .sort(function (a, b) { return (a.book ? 1 : 0) - (b.book ? 1 : 0) || a.sp - b.sp; });
      if (!can.length) break;
      var pick = can[0];
      var r2 = await page('magister.php?get=' + pick.id, 'magister.php?learnskills');
      var m2 = P.parseMagister(r2.text);
      var still = m2.list.some(function (x) { return x.id === pick.id && x.level === pick.level; });
      if (still) { failed[pick.id + ':' + pick.level] = 1; J.ev('learn', 'не выучено: ' + pick.name + ' ' + pick.level + (pick.book ? ' (нужна книга)' : ''), pick); continue; }
      learned.push(pick.name + ' ' + pick.level); S.learned++;
      J.ev('learn', 'выучено: ' + pick.name + ' ' + pick.level, pick);
      await sleep(jitter(150));
    }
    if (learned.length) log('📘 Выучено: ' + learned.join(', '), 'learn');
    S.lastLearnLvl = lvl(); S.lastLearnT = Date.now();
    await syncHotbar();
    save();
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
        if (used[sk.id] != null || inf.kind !== 'attack') continue;
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
  function pickMob(mobs) {
    var black = names(cfg.blacklist);
    return mobs.filter(function (m) {
      if (!inRange(m.level)) return false;
      if (black.indexOf(m.name.toLowerCase()) >= 0) return false;
      if (cfg.whiteOnly && m.color && !/^#?(fff|ffffff|white)$/.test(m.color)) return false;
      return true;
    }).sort(function (a, b) { return b.level - a.level; })[0] || null;
  }

  /* ---------- смена места кача ---------- */
  var moveFailed = {};
  async function relocate(mobsHere) {
    if (!cfg.autoMove) return false;
    setStatus('ищу место кача', 'Переход');
    var near = P.parseNearby((await page('help.php?top=8')).text);
    var black = names(cfg.blacklist), l = lvl();
    var here = {}; (mobsHere || []).forEach(function (m) { here[m.name] = 1; });
    var cand = near.filter(function (m) { return inRange(m.level) && !moveFailed[m.eid] && black.indexOf(m.name.toLowerCase()) < 0; })
      .sort(function (a, b) { return Math.abs(a.level - (l + 3)) - Math.abs(b.level - (l + 3)) || b.count - a.count; });
    J.ev('move', 'кандидаты', { near: near, cand: cand.map(function (c) { return c.name + ' ' + c.level; }) });
    for (var i = 0; i < cand.length && !stopReq; i++) {
      var d = P.parseDroplist((await page('droplist.php?eid=' + cand[i].eid, 'help.php?top=8')).text);
      if (cfg.avoidAgro && d.agro) { moveFailed[cand[i].eid] = 1; continue; }
      if (!d.run) { moveFailed[cand[i].eid] = 1; continue; }
      log('🏃 Иду к мобам: ' + cand[i].name + ' [' + cand[i].level + ']', 'move', { eid: cand[i].eid, x: d.x, y: d.y });
      S.place = cand[i].name + ' [' + cand[i].level + ']';
      await page(d.run, 'droplist.php?eid=' + cand[i].eid);
      return await walkUntilMobs(cand[i]);
    }
    J.ev('move', 'подходящих мобов рядом нет', { lvl: l });
    return false;
  }

  async function walkUntilMobs(target) {
    var last = null, same = 0, t0 = Date.now();
    while (!stopReq && Date.now() - t0 < 10 * 60000) {
      await sleep(4000);
      var m = await page('map.php');
      var mobs = P.parseMapMobs(m.text);
      var good = pickMob(mobs);
      var c = P.parseMapCoords(m.text);
      setStatus('в пути к ' + target.name + (c ? ' (' + c.x + ':' + c.y + ')' : ''), 'Переход');
      if (good) { log('Пришёл: рядом ' + good.name + ' [' + good.level + '] за ' + Math.round((Date.now() - t0) / 1000) + ' с', 'move'); return true; }
      var key = c ? c.x + ':' + c.y : '';
      if (key && key === last) { if (++same >= 3) { J.ev('move', 'стою на месте, мобов нет', { at: key }); moveFailed[target.eid] = 1; return false; } }
      else same = 0;
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
    if (f) { S.lastFight = { name: f.name, secs: +secs, hits: f.hits }; if (S.sess) S.sess.fightMs += Date.now() - f.t0; }
    log('✔ ' + (f ? f.name + ' за ' + secs + ' с, ' + f.hits + ' ударов' : 'Победа') + (loot.length ? ' — ' + loot.join(', ') : ''), 'win', { mob: f && f.name, secs: +secs, hits: f && f.hits, loot: loot, adena: adena, levelUp: end.levelUp });
    if (end.levelUp) { await refreshMe(); await learnSkills(true); }
    save();
  }

  function isEnd(r) { return r.battleEnd || /ЗАБРАТЬ ВСЕ|ДОБЫЧА\s*\(/.test(r.text); }

  /* Удары идут обычной страницей battle.php?…&go=ID / &attack — так же, как в игре без AJAX.
     battle_ajax.php не используем: сервер помечает ответ как gzip, а шлёт простой текст,
     и браузер отвечает ERR_CONTENT_DECODING_FAILED. */
  async function fight(mob) {
    setLockedHotbar();
    var f = { name: mob.name + ' [' + mob.level + ']', t0: Date.now(), hits: 0 };
    setStatus('бой: ' + f.name, 'Охота');
    var r = await page(mob.href, 'map.php');
    if (isEnd(r)) { await finishBattle(r.text, f); return 'end'; }
    var hb = P.parseHotbar(r.text);
    if (!hb.attack && !hb.skills.length && P.isEditMode(r.text)) { setLockedHotbar(); r = await page(mob.href, 'map.php'); hb = P.parseHotbar(r.text); }
    if (!hb.attack && !hb.skills.length) { log('Моб ' + mob.name + ' недоступен', 'lost'); snap('no-hotbar', r); return 'skip'; }
    rememberSkills(hb);
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
      var act = chooseAction(hb, now);
      var castWait = cast ? cast.casting * 1000 - now + 150 : 0;
      var wait = step === 0 ? castWait : Math.max(castWait, cfg.minDelay * 1000);
      if (act && !act.skill && cast && cast.PN) wait = Math.max(wait, step === 0 ? 0 : cast.PN * 1000 - 300);
      J.ev('hit', act ? act.label : 'жду', { step: step, me: [S.me.hp, S.me.maxHp, S.me.mp, S.me.maxMp], mob: hud ? [hud.hp, hud.maxHp] : null, wait: Math.round(wait), log: blog[0] });
      if (wait > 0) await sleep(jitter(wait));
      if (!act) { await sleep(500); r = await page(ref, ref); continue; }
      r = await page(act.href, ref);
      ref = act.href; f.hits++;
      if (isEnd(r)) { await finishBattle(r.text, f); return 'win'; }
      if (/\/map\.php/.test(r.url) || !/l2-target-hud/.test(r.text)) {
        S.kills++; if (S.sess) S.sess.kills++;
        log('✔ ' + f.name + ' — бой закончился без страницы добычи', 'win', { mob: f.name, secs: (Date.now() - f.t0) / 1000, hits: f.hits, noLoot: true });
        return 'lost';
      }
      var nhb = P.parseHotbar(r.text);
      if (nhb.attack || nhb.skills.length) hb = nhb;
    }
    return 'timeout';
  }

  /* ---------- главный цикл ---------- */
  async function loop() {
    log('▶ Старт (версия ' + VERSION + ')', 'log', { cfg: cfg });
    var empty = 0;
    try { await refreshMe(); } catch (e) { if (e instanceof Stop) return finish(e); }
    S.sess = { t0: Date.now(), kills: 0, adena: 0, deaths: 0, levels: 0, fightMs: 0, lvl0: lvl(), exp0: S.me.exp };
    while (!stopReq) {
      try {
        await dailyIfNeeded(false);
        await learnSkills(false);
        await buffIfNeeded(false);
        await restIfNeeded();
        setStatus('ищу моба', 'Охота');
        var m = await page('map.php');
        var mobs = P.parseMapMobs(m.text);
        var mob = pickMob(mobs);
        J.ev('pick', mob ? mob.name + ' [' + mob.level + ']' : 'нет подходящих', { all: mobs.map(function (x) { return x.name + ' ' + x.level; }), lvl: lvl() });
        if (!mob) {
          empty++;
          setStatus('мобов нет (' + mobs.length + ' рядом не подходят), попытка ' + empty, 'Охота');
          if (empty >= cfg.emptyTries && await relocate(mobs)) { empty = 0; continue; }
          await sleep(cfg.emptyWait * 1000);
          continue;
        }
        empty = 0;
        await fight(mob);
      } catch (e) {
        if (e instanceof Stop) return finish(e);
        log('Ошибка: ' + (e && e.message ? e.message : e), 'err', { stack: String(e && e.stack || '').slice(0, 800) });
        await sleep(4000);
      }
    }
    finish();
  }

  function finish(e) {
    S.running = false; stopReq = false;
    setStatus(e && e.message ? 'остановлен: ' + e.message : 'остановлен', '');
    log('■ Стоп', 'log', { sess: S.sess });
    save();
  }

  function start() {
    if (S.running) return;
    S.running = true; stopReq = false;
    save(); emit();
    loop();
  }
  function stop() { if (S.running) { stopReq = true; setStatus('останавливаюсь…'); } }

  /* ---------- хранение ---------- */
  var KEY = 'l2mobi_bot_v1';
  function save() {
    try {
      chrome.storage.local.set({ [KEY]: {
        v11: true, cfg: cfg, running: S.running, lastBuff: S.lastBuff, lastDaily: S.lastDaily, knownSkills: S.knownSkills, skillInfo: S.skillInfo,
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
            cfg = Object.assign({}, DEFAULTS, c);
            S.lastBuff = v.lastBuff || 0; S.lastDaily = v.lastDaily || ''; S.knownSkills = v.knownSkills || [];
            S.skillInfo = v.skillInfo || {}; S.lastLearnLvl = v.lastLearnLvl || 0; S.lastLearnT = v.lastLearnT || 0;
            var st = v.stats || {};
            S.kills = st.kills || 0; S.adena = st.adena || 0; S.deaths = st.deaths || 0; S.levelUps = st.levelUps || 0; S.learned = st.learned || 0;
            S.log = v.log || [];
          }
          res(v || {});
        });
      } catch (e) { res({}); }
    }).then(function (v) {
      try { var o = {}; o[KEY] = Object.assign({}, v, { cfg: cfg, v11: true }); chrome.storage.local.set(o); } catch (e) {}
      return v;
    });
  }
  function setCfg(patch) { cfg = Object.assign({}, cfg, patch); J.ev('cfg', 'настройка', patch); save(); emit(); }
  function resetStats() { S.kills = 0; S.adena = 0; S.deaths = 0; S.levelUps = 0; S.learned = 0; save(); emit(); }

  /** Сводка для файла логов. */
  function info() {
    return { version: VERSION, hero: S.hero, me: S.me, cfg: cfg, stats: { kills: S.kills, adena: S.adena, deaths: S.deaths, levelUps: S.levelUps, learned: S.learned },
      sess: S.sess, skills: S.knownSkills, skillInfo: S.skillInfo, ua: navigator.userAgent, page: location.pathname };
  }

  function wrap(fn, name) { return function () { if (S.running) { log('Сначала остановите бота'); return; } return fn(true).catch(function (e) { log(name + ': ' + (e && e.message || e), 'err'); }); }; }

  root.L2MEngine = {
    VERSION: VERSION, DEFAULTS: DEFAULTS, state: S, get cfg() { return cfg; }, setCfg: setCfg, start: start, stop: stop, load: load,
    onChange: onChange, log: log, resetStats: resetStats, info: info,
    buffNow: wrap(buffIfNeeded, 'Бафф'), dailyNow: wrap(dailyIfNeeded, 'Алтарь'), learnNow: wrap(learnSkills, 'Умения'),
    _test: { pickMob: pickMob, chooseAction: chooseAction, ids: ids, setHero: function (h) { S.hero = h; }, rotation: rotation }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
