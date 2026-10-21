// ===== L2wap Lite — бот на странице игры (изолированный мир, document_idle) =====
// Lite 1.0 (20.10.2026, тред «Упрошенка под Дестра», просьба игрока John): облегчённая автономная версия для Destroyer/Titan.
// Один цикл: антибот → смерть → TvT → страница (бой, карта, телепорт, город, баффер). Настройки — только в меню расширения.
// Правила проекта сохранены: капчу не решаем (бот замирает и зовёт игрока), пароль не храним, Coin of Luck и FA не тратим
// (адена — только на телепорт к месту охоты), клик — только когда игра свободна (иначе она его теряет).
// Lite 1.1 (21.10, «на основе нового кода, внеси правки»): ход по ответу сервера и подстройка запаса клика из основного бота 20.36–20.41.
(() => {
  'use strict';
  if (window.__l2lite) return;
  window.__l2lite = 1;
  const L = globalThis.L2Lite, CDM = globalThis.L2BattleCooldown;
  const K_CFG = 'lite.cfg', K_RT = 'lite.rt', K_CMD = 'lite.cmd';
  const DEF_CFG = { on: false, zone: '', zoneName: '', killLimit: 0, tvt: true, skills: {}, hpPot: 50, mpPot: 25, maxDeaths: 3 };
  const DEF_RT = { k: { kills: 0 }, zone: null, status: '', statusT: 0, log: [], deaths: [], revive: null, goZone: '', tpTry: [], zoneBlockT: 0,
    tvtDone: '', tvtIn: '', tvtSkip: null, tvtRegT: 0, tvtRegN: null, tvtNoBtn: null, tvt: null, abChal: 0, abBlock: 0,
    char: null, bar: [], locs: [], locsT: 0, cmdDone: '', limitNoted: 0, beatT: 0 };
  let cfg = { ...DEF_CFG }, rt = { ...DEF_RT }, ready = false, owner = false, gen = 1, dead = false;

  // ---------- мелочи ----------
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const visible = el => !!el && el.getClientRects().length > 0;
  const shown = el => !!el && !el.hidden && !el.closest('[hidden]') && visible(el);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Lite 1.1 (ход по ответу сервера, основной бот 20.37/20.41): ожидание просыпается сразу по концу любого запроса игры, а не по таймеру.
  const waiters = new Set();
  const nap = ms => new Promise(r => { const done = () => { clearTimeout(t); waiters.delete(done); r(); }, t = setTimeout(done, ms); waiters.add(done); });
  const wakeAll = () => { for (const f of [...waiters]) f(); };
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const num = t => { const s = String(t ?? '').replace(/[\s  ]/g, ''); return /^\d+$/.test(s) ? +s : NaN; };
  const byText = (re, sel = 'a,button') => $$(sel).find(e => shown(e) && re.test((e.textContent || '').trim())) || null;
  const alive = g => !dead && cfg.on && owner && g === gen && !mainBotOn();
  async function waitFor(fn, ms, step = 100, g = 0) {
    const t0 = Date.now();
    for (;;) { let v = null; try { v = fn(); } catch (e) {} if (v) return v; if (Date.now() - t0 >= ms || (g && !alive(g))) return null; await nap(step); }
  }
  // Основной L2wap Bot ставит data-l2bot-on на <html>, пока он включён: два бота на одной странице мешали бы друг другу.
  const mainBotOn = () => document.documentElement?.dataset?.l2botOn === '1';
  const sess = { get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  // ---------- хранилище: настройки пишет меню, память — только вкладка-хозяин ----------
  let rtDirty = false, rtTimer = 0;
  function setRt(patch) {
    rt = { ...rt, ...patch };
    if (!owner) return;
    rtDirty = true;
    if (!rtTimer) rtTimer = setTimeout(flushRt, 400);
  }
  async function flushRt() {
    clearTimeout(rtTimer); rtTimer = 0;
    if (!rtDirty || !owner || dead) return;
    rtDirty = false;
    try { await chrome.storage.local.set({ [K_RT]: rt }); } catch (e) { rtDirty = true; if (/context invalidated/i.test(String(e?.message))) dead = true; }
  }
  function log(x) {
    const line = { t: Date.now(), x: String(x).slice(0, 300) };
    try { console.info('[L2wap Lite]', line.x); } catch (e) {}
    if (!owner) return;
    const lg = [...(rt.log || []), line];
    setRt({ log: lg.length > 400 ? lg.slice(-400) : lg });
  }
  let lastStatus = '';
  function status(x) { if (x === lastStatus) return; lastStatus = x; setRt({ status: x, statusT: Date.now() }); }
  const notify = (id, title, text) => { try { chrome.runtime.sendMessage({ cmd: 'notify', id, title, text }, () => void chrome.runtime.lastError); } catch (e) {} };

  function onCfg(prev) {
    if (prev.on !== cfg.on) { gen++; if (!cfg.on) { status('Выключен'); log('■ Стоп'); abBlink(false); } }
    if (prev.zone !== cfg.zone) {
      gen++;
      setRt({ zone: cfg.zone ? { id: cfg.zone, name: cfg.zoneName || cfg.zone } : null, goZone: '', tpTry: [], zoneBlockT: 0 });
      if (cfg.zone) log(`место охоты: «${cfg.zoneName || cfg.zone}»`);
    }
    if (prev.killLimit !== cfg.killLimit) setRt({ limitNoted: 0 });
  }
  // Команды меню (один раз каждая): start — новая точка отсчёта счётчика (убитое без бота не считаем), reset — счётчик в 0.
  function applyCmd(c) {
    if (!c || typeof c !== 'object' || !c.id || c.id === rt.cmdDone || !owner) return;
    if (c.type === 'start') {
      setRt({ cmdDone: c.id, k: { ...(rt.k || {}), lastK: null }, revive: null, goZone: '', tpTry: [], zoneBlockT: 0, deaths: [], limitNoted: 0,
        zone: cfg.zone ? { id: cfg.zone, name: cfg.zoneName || cfg.zone } : null });
      log(`▶ Старт: ${cfg.zone ? 'место охоты «' + (cfg.zoneName || cfg.zone) + '»' : 'охочусь там, где стоит герой'}, ${+cfg.killLimit > 0 ? 'цель ' + cfg.killLimit + ' мобов' : 'без лимита мобов'}, TvT ${cfg.tvt ? 'вкл.' : 'выкл.'}`);
      SNAP && onSnapZone(SNAP);
    } else if (c.type === 'reset') {
      setRt({ cmdDone: c.id, k: { ...(rt.k || {}), kills: 0, lastK: null }, limitNoted: 0 });
      log('счётчик мобов сброшен');
    } else setRt({ cmdDone: c.id });
    void flushRt();
  }
  async function load() {
    const s = await chrome.storage.local.get([K_CFG, K_RT, K_CMD]);
    cfg = { ...DEF_CFG, ...(s[K_CFG] || {}) }; rt = { ...DEF_RT, ...(s[K_RT] || {}) };
    ready = true;
    return s[K_CMD];
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ready) return;
    // Меню пишет настройки и команду одним set: сначала настройки (Старт берёт из них место охоты и цель), потом команда.
    if (ch[K_CFG]) { const prev = cfg; cfg = { ...DEF_CFG, ...(ch[K_CFG].newValue || {}) }; onCfg(prev); }
    if (ch[K_CMD] && owner) applyCmd(ch[K_CMD].newValue);
    if (ch[K_RT] && !owner) rt = { ...DEF_RT, ...(ch[K_RT].newValue || {}) };
  });

  // ---------- вкладка-хозяин: ведёт бота одна вкладка игры; сторож фона перезагрузит зависшую ----------
  async function beat() {
    if (dead) return;
    try {
      const r = await chrome.runtime.sendMessage({ cmd: 'beat', on: !!cfg.on, page: location.pathname });
      const was = owner; owner = !!r?.owner;
      if (owner && !was) {
        const s = await chrome.storage.local.get([K_RT, K_CMD]);
        rt = { ...DEF_RT, ...(s[K_RT] || {}), ...(lastStatus ? { status: lastStatus } : {}) };
        applyCmd(s[K_CMD]);
      }
      if (!owner && was) gen++;
    } catch (e) { if (/context invalidated/i.test(String(e?.message))) { dead = true; owner = false; } }
  }

  // ---------- сеть игры (hook.js) ----------
  const NET = { inflight: new Map(), starts: [], ends: new Map(), actEnd: 0, charEnd: 0 };
  const BUSY = /^\/character$|^\/game\/battle\/(?:action|hunt-continue)$|^\/game\/tvt\/action$/;
  let SNAP = null, TVT = null, TVTC = { actN: 0 }, TVTS = null, BINFO = null;
  const CD = CDM.createBattleCooldown();
  const tvtDead = new Map();
  function netStart(d) {
    const t = Date.now();
    if (BUSY.test(d.path)) NET.inflight.set(d.rid, { path: d.path, method: d.method, t });
    NET.starts.push({ rid: d.rid, path: d.path, method: d.method, t });
    if (NET.starts.length > 40) NET.starts.shift();
  }
  function netEnd(d) {
    const t = Date.now(), ok = d.status >= 200 && d.status < 300;
    NET.inflight.delete(d.rid);
    NET.ends.set(d.rid, { status: d.status, err: d.err || (d.bt && (d.bt.error || (!ok && d.bt.code))) || (d.tvt && d.tvt.error) || '', by: String(d.bt?.blockedBy || ''), t });
    if (NET.ends.size > 60) NET.ends.delete(NET.ends.keys().next().value);
    if (d.path === '/character') NET.charEnd = t;
    if (/^\/game\/(?:battle|tvt)\/action$/.test(d.path)) NET.actEnd = t;
    if (d.ch && ok) onSnap(d.ch);
    if (d.bt) {
      if (d.path === '/game/battle/action' && d.req && d.req.action) CD.observe({ action: d.req.action }, d.bt, d.status, '');
      else CD.observeSync(d.bt, '');
    }
    // Ход принят сервером — значит проверки активности уже нет (игрок решил её сам на этой или другой странице).
    if (d.path === '/game/battle/action' && ok && !d.err && rt.abChal) { setRt({ abChal: 0 }); log('проверка активности снята — продолжаю'); }
    if (d.bi && ok) BINFO = { ...d.bi, t };
    if (d.path === '/game/battle/leave' && d.method === 'POST' && ok) sess.set('l2lite.leftOk', { t });
    if (d.tvt) tvtNet(d);
    if (d.ab) abNet(d.ab, d.path);
    if (d.locs && owner && d.locs.length && JSON.stringify(d.locs) !== JSON.stringify(rt.locs)) setRt({ locs: d.locs, locsT: t });
    wakeAll();
  }
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || (d.__l2lite !== 'start' && d.__l2lite !== 'end')) return;
    if (d.__l2lite === 'start') netStart(d); else netEnd(d);
  });
  // Игра свободна: нет её запросов в полёте и прошёл запас после ответа на ход (A) / после её GET /character (B) (основной бот 8.0.3).
  // Lite 1.1: запасы подстраиваются, как в основном боте (A 60–400, B 30–200 мс): потерянный клик — запас растёт, клик впритык прошёл — чуть меньше.
  const LOCK_A = [60, 400, 120], LOCK_B = [30, 200, 50];
  const clampL = (v, L) => Math.min(L[1], Math.max(L[0], Number.isFinite(+v) ? +v : L[2]));
  let lockA = clampL(sess.get('l2lite.lockA', LOCK_A[2]), LOCK_A), lockB = clampL(sess.get('l2lite.lockB', LOCK_B[2]), LOCK_B);
  const ACT_PATH = /^\/game\/(?:battle|tvt)\/action$|^\/game\/battle\/hunt-continue$/;
  // → true — можно жать; false — наш прошлый ход всё ещё без ответа (второй ход до ответа на первый не шлём, основной бот 20.37).
  async function gameIdle(maxMs = 1500, g = 0) {
    const t0 = Date.now();
    for (;;) {
      const now = Date.now();
      let act = false, other = false;
      for (const [rid, x] of NET.inflight) {
        const isAct = ACT_PATH.test(x.path);
        if (now - x.t > (isAct ? 10000 : 4000)) NET.inflight.delete(rid); else if (isAct) act = true; else other = true;
      }
      if (act) { if (now - t0 > 8000 || (g && !alive(g))) return false; await nap(40); continue; }
      const need = other ? 40 : Math.max(NET.actEnd + lockA - now, NET.charEnd + lockB - now);
      if (need <= 0 || now - t0 > maxMs) return true;
      await nap(Math.min(Math.max(need, 15), 60));
    }
  }
  const lockSave = () => { sess.set('l2lite.lockA', lockA); sess.set('l2lite.lockB', lockB); };
  // Свои запросы к игре — с токеном страницы (без него сервер отвечает 401); токен никуда не пишем.
  async function gameGet(path, ms = 8000) {
    if (abHold()) throw new Error('antibot');
    const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
    let auth = {};
    try { const t = localStorage.getItem('token'); if (t) auth = { Authorization: 'Bearer ' + t }; } catch (e) {}
    try { return await fetch(path, { credentials: 'include', cache: 'no-store', headers: auth, signal: c.signal }); } finally { clearTimeout(tm); }
  }

  async function heroNow() {
    try {
      const r = await gameGet('/character', 6000), c = r.ok ? (await r.json())?.character : null;
      if (!c || typeof c !== 'object') return null;
      return { zone: String(c.currentZoneId || ''), inBattle: c.inBattle === true, city: c.locationType === 'city', adena: num(c.adena) };
    } catch (e) { return null; }
  }

  // ---------- герой: уровень, локация, счётчик мобов ----------
  function onSnap(ch) {
    SNAP = { ...ch, t: Date.now() };
    if (!owner) return;
    const lastK = rt.k?.lastK, r = L.killStep(rt.k, ch, !!cfg.on);
    if (r.st !== rt.k) setRt({ k: r.st });
    if (r.add > 0) { progress(); if (L.limitDone(r.st.kills, cfg.killLimit) && !rt.limitNoted) { setRt({ limitNoted: Date.now() }); log(`🎯 цель выполнена: убито ${r.st.kills} из ${cfg.killLimit} мобов — охоту остановил${cfg.tvt ? ', TvT продолжаю' : ''}`); notify('limit', 'L2wap Lite: цель выполнена', `Убито ${r.st.kills} мобов.`); } }
    if (r.why === 'jump') log(`счётчик игры вырос на ${ch.k - lastK} сразу — это не бот, считаю с этого места`);
    const c = { name: ch.name, lvl: ch.level || 0, prof: ch.prof || '' };
    if (JSON.stringify(c) !== JSON.stringify(rt.char)) setRt({ char: c });
    if (Array.isArray(ch.bar) && ch.bar.length) {
      const bar = [...new Set(ch.bar)].map(a => ({ a, n: (ch.names || {})[a] || (rt.bar || []).find(x => x.a === a)?.n || '' }));
      if (JSON.stringify(bar) !== JSON.stringify(rt.bar)) setRt({ bar });
    }
    onSnapZone(ch);
  }
  // «Где стоит герой при Старте» — запоминаем первую локацию после Старта (не в бою, не в городе и не в подземелье).
  // Окрестности города могут иметь свой номер зоны: после выхода из города места охоты запоминаем его как то же место.
  function onSnapZone(ch) {
    if (!owner || !cfg.on || !ch.zone || ch.inBattle || ch.dung || ch.locType === 'city') return;
    const z = rt.zone, out = sess.get('l2lite.outsk', null);
    if (z && out && Date.now() - out.t < 120000 && out.from === z.id && !zoneIs(ch.zone)) {
      sess.set('l2lite.outsk', null);
      setRt({ zone: { ...z, alias: [...(z.alias || []), ch.zone].slice(-4) } });
      log(`окрестности «${z.name}» — «${ch.zoneName || ch.zone}»: это то же место охоты`);
      return;
    }
    if (z || cfg.zone) return;
    setRt({ zone: { id: ch.zone, name: ch.zoneName || ch.zone } });
    log(`место охоты — где стоит герой: «${ch.zoneName || ch.zone}»`);
  }
  const zoneIs = id => !!rt.zone && (id === rt.zone.id || (rt.zone.alias || []).includes(id));
  const snapFresh = (ms = 60000) => (SNAP && Date.now() - SNAP.t < ms ? SNAP : null);
  const heroLvl = () => SNAP?.level || rt.char?.lvl || num($('#l2-hud-legacy-lvl')?.textContent) || 0;
  function meStats() {
    const hp = num($('#l2-hud-hp-cur')?.textContent), maxHp = num($('#l2-hud-hp-max')?.textContent), mp = num($('#l2-hud-mp-cur')?.textContent), maxMp = num($('#l2-hud-mp-max')?.textContent);
    const S = snapFresh(30000);
    return { hp: Number.isFinite(hp) ? hp : S?.hp, maxHp: maxHp > 0 ? maxHp : S?.maxHp, mp: Number.isFinite(mp) ? mp : S?.mp, maxMp: maxMp > 0 ? maxMp : S?.maxMp };
  }
  const limitDone = () => L.limitDone(rt.k?.kills || 0, cfg.killLimit);
  const zoneBlocked = () => Date.now() - (rt.zoneBlockT || 0) < 15 * 60000;
  const zoneWrong = () => { const S = snapFresh(60000), z = rt.zone; return !!(S && z && z.id && S.zone && !zoneIs(S.zone) && !S.inBattle && !S.dung && !zoneBlocked()); };

  // ---------- антибот: решает только человек ----------
  const abLayer = () => { const x = $('#l2-antibot-layer'); return shown(x) ? x : null; };
  function abState() {
    const x = abLayer();
    if (x && (x.querySelector('.l2-antibot-card--blocked') || (/заблок|недоступ|blocked/i.test(x.textContent) && !x.querySelector('.l2-antibot-card__options')))) return 'blocked';
    if (x && (x.querySelector('.l2-antibot-card__options') || /провер|символ|перевір/i.test(x.textContent))) return 'check';
    if ((rt.abBlock || 0) > Date.now()) return 'blocked';
    if (rt.abChal) return 'check';
    return null;
  }
  const abHold = () => abState() === 'check';
  function abNet(ab) {
    if (ab.code === 'anti_bot_challenge') {
      if (!rt.abChal) { log('⚠ игра выдала «Проверку активности» — бот замер: ни кликов, ни запросов, решите её сами'); notify('ab', '⚠ L2wap Lite: проверка активности', 'Игра просит нажать символы по порядку. Бот ждёт вас.'); }
      setRt({ abChal: Date.now() }); return;
    }
    if (ab.code === 'pve_farm_blocked') {
      const until = ab.until || (ab.left ? Date.now() + ab.left * 1000 : Date.now() + 3600000);
      if ((rt.abBlock || 0) < Date.now()) log(`⛔ игра заблокировала PvE-фарм до ${new Date(until).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} — жду, TvT не трогаю`);
      setRt({ abChal: 0, abBlock: until }); return;
    }
    if (ab.passed || ab.code === 'antibot_challenge_not_found') { if (rt.abChal) log('проверка активности пройдена — продолжаю'); setRt({ abChal: 0 }); }
  }
  let blinkT = 0, title0 = null;
  function abBlink(on) {
    if (on && !blinkT) { title0 = document.title; let k = 0; blinkT = setInterval(() => { document.title = k++ % 2 ? '⚠ КАПЧА — решите!' : (title0 || 'L2wap'); }, 800); }
    if (!on && blinkT) { clearInterval(blinkT); blinkT = 0; if (title0 != null) document.title = title0; }
  }

  // ---------- клик как у человека; только хозяин, только с включённым ботом, никогда во время проверки активности ----------
  function fire(el, g) {
    if (!el || !cfg.on || !owner || dead || mainBotOn() || (g && g !== gen)) return false;
    if (abHold() && !el.closest?.('.l2-antibot-card--blocked')) return false;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const p = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, ...p, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, ...p }));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  }
  async function go(url) { await flushRt(); progress(); location.href = url; await sleep(4000); }
  function pageKind() {
    const p = location.pathname;
    if (/\/battle\.html$/i.test(p)) return 'battle';
    if (/\/map\.html$/i.test(p)) return 'map';
    if (/\/teleport\.html$/i.test(p)) return 'teleport';
    if (/\/tvt-arena\.html$/i.test(p)) return 'arena';
    if (/\/town-buffer\.html$/i.test(p)) return 'buffer';
    if (/\/city\.html$/i.test(p)) return 'city';
    return 'other';
  }
  const loginPage = () => !$('#l2-hud-legacy-name') && $$('input[type="password"]').some(shown);

  // ---------- панель боя ----------
  const SLOT = '.l2-battle-hotbar-slot:not(.l2-battle-hotbar-slot--empty)';
  const slotAction = b => b.getAttribute('data-slot-cd') || b.querySelector('[data-slot-cd]')?.getAttribute('data-slot-cd') || '';
  const block = new Map(), pressAt = new Map(), frozenSince = new Map(), frozenLost = new Map(), lostN = new Map();
  let lastPot = { hp: 0, mp: 0 };
  // Рисунок отката на панели; застывший в фоне рисунок отпускаем по серверному дедлайну этого нажатия (основной бот 20.10, #232).
  function domBusy(b) {
    const cd = b.querySelector('.l2-battle-hotbar-slot-cd');
    if (!cd || cd.hidden || !cd.classList.contains('l2-battle-hotbar-slot-cd--on')) return false;
    const t = parseFloat((cd.querySelector('.l2-battle-hotbar-slot-cd__timer')?.textContent || '').replace(',', '.'));
    return !(t <= 0.1);
  }
  function slotReady(b, key, action) {
    const now = Date.now();
    if ((block.get(key) || 0) > now || CD.globalWait('') > 0) return false;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true' || /--disabled/.test(b.className)) return false;
    const known = !!action && CD.skillKnown(action, '', pressAt.get(action) || 0), left = action ? CD.skillWait(action, '') : 0;
    if (!domBusy(b)) { frozenSince.delete(key); return !(known && left > 0); }
    if (known && left <= 0 && (frozenLost.get(key) || 0) < 2 && !NET.inflight.size) {
      if (!frozenSince.has(key)) frozenSince.set(key, now);
      return now - frozenSince.get(key) >= 1200;
    }
    frozenSince.delete(key);
    return false;
  }
  // Висящие баффы: шапка игры, ответ /character и свои отметки после принятого нажатия (на время, пока шапка не обновилась).
  function activeIds() {
    const now = Date.now(), set = new Set();
    for (const el of $$('#l2-hud-active-buffs [data-skill-id]')) {
      const id = +el.getAttribute('data-skill-id'), v = el.getAttribute('data-expires-at') || '', exp = /^\d+$/.test(v) ? +v : Date.parse(v) || 0;
      if (id && (!exp || exp > now + 1000)) set.add(id);
    }
    const S = snapFresh(120000);
    for (const b of S?.buffs || []) if (b.id && (!b.until || b.until > now + 1000)) set.add(b.id);
    for (const [id, until] of Object.entries(sess.get('l2lite.buffs', {}))) if (until > now) set.add(+id);
    return set;
  }
  function markBuff(id, sec) { if (!id) return; const m = sess.get('l2lite.buffs', {}); m[id] = Date.now() + Math.max(5, Math.min(sec || 20, 600)) * 1000; sess.set('l2lite.buffs', m); }
  // Стойка: только подтверждённое игрой состояние (ответ /character после нашего нажатия), иначе null — не трогаем.
  function toggleState(info) {
    const S = snapFresh(60000);
    if (!S || !Array.isArray(S.toggles) || S.t < (pressAt.get(info.key) || 0) + 300) return null;
    const x = S.toggles.find(t => (t.a && t.a.toLowerCase() === info.key) || (info.id && t.id === info.id));
    return x ? x.on : false;                       // стойка на панели, но её нет в списке игры — значит выключена
  }
  const skillKey = (action, title) => L.skillInfo(action, title).key;
  // TvT: скиллы арены из /game/tvt/skills (MP, откат, на кого) — бьём только по врагу (как основной бот 10.0.11).
  function tvtSkill(action, name) {
    const a = String(action || '').toLowerCase(), n = String(name || '').toLowerCase();
    return (TVTS?.skills || []).find(x => (a && x.action && String(x.action).toLowerCase() === a) || (x.nameUk && n && n.startsWith(String(x.nameUk).toLowerCase()))) || null;
  }
  const tvtNow = () => Date.now() + (TVT?.off || 0);
  function slotsNow(tvt) {
    const act = activeIds(), out = [];
    $$(SLOT).forEach((b, i) => {
      const title = b.getAttribute('title') || '', action = slotAction(b), name = L.cleanTitle(title);
      const qEl = b.querySelector('.l2-battle-hotbar-slot-uqty'), qty = qEl ? num(qEl.textContent.replace(/\D/g, '')) : null;
      if (/l2-hotbar-shot--|shot/i.test(b.className) || /заряд|soulshot|spiritshot/i.test(title)) return;   // заряды не трогаем
      const pot = L.potKind(title);
      if (qEl || pot) {
        if (!pot) return;                                              // прочие предметы (свитки, еда) не жмём
        const key = 'item:' + (action || name.toLowerCase());
        out.push({ b, key, action: '', name, type: 'item', pot, qty: Number.isFinite(qty) ? qty : null, on: true, ready: slotReady(b, key, ''), i, tvtOk: true });
        return;
      }
      const src = b.querySelector('img')?.getAttribute('src') || '';
      if (!action && !/\/skills\//i.test(src)) return;                 // снаряжение: смену оружия бот не жмёт
      const info = L.skillUse(L.skillInfo(action, title), (cfg.skills || {})[skillKey(action, title)]);
      const s = { ...info, b, action: action.toLowerCase(), i, ready: slotReady(b, info.key, action.toLowerCase()) };
      if (s.type === 'buff' || s.type === 'lowhp') s.active = !!(s.id && act.has(s.id));
      if (s.type === 'toggle') s.active = toggleState(s);
      if (tvt) {
        const x = tvtSkill(action, name);
        if (x) { s.tvtOk = x.usable !== false && (s.type === 'basic' || !x.targetType || /enemy|enemies|opponent/i.test(x.targetType)); if (+x.mpCost > 0) s.mp = +x.mpCost; if (L.ms(x.readyAt) > tvtNow() + 50) s.ready = false; }
        else s.tvtOk = s.type === 'basic' || !TVTS?.skills;
        if (s.type === 'basic' && L.ms(TVTC.nextBasicAttackAt) > tvtNow() + 50) s.ready = false;
      }
      out.push(s);
    });
    return out;
  }
  // Меню видит скиллы и без боя (ответ /character), а на странице боя — точные имена с панели.
  function barFromDom() {
    if (!owner) return;
    const bar = [...(rt.bar || [])];
    for (const b of $$(SLOT)) {
      const a = slotAction(b).toLowerCase(), n = L.cleanTitle(b.getAttribute('title') || '');
      if (!a || a === 'attack' || b.querySelector('.l2-battle-hotbar-slot-uqty')) continue;
      const x = bar.find(y => y.a === a);
      if (!x) bar.push({ a, n }); else if (!x.n && n) x.n = n;
    }
    if (JSON.stringify(bar) !== JSON.stringify(rt.bar)) setRt({ bar });
  }
  async function rowsAll(g) {                       // все 3 ряда панели на виду (основной бот hotbarRows3)
    const hb = $('.l2-battle-hotbar'); if (!hb) return;
    const rows = () => $$('.l2-battle-hotbar__row').length, vis = () => +(hb.dataset.visibleRows || 0) || $$('.l2-battle-hotbar__row:not([hidden])').length;
    for (let i = 0; i < 3 && vis() < Math.min(3, rows()); i++) {
      const down = $('.l2-battle-hotbar__row-nav--down'); if (!down || down.disabled) return;
      const v = vis(); fire(down, g); await waitFor(() => vis() > v, 1500, 50, g);
    }
  }
  // Нажатие: ждём свободную игру, жмём, проверяем, что ход ушёл (≤ 0,45 с) и сервер его принял (≤ 6 с).
  // still() — план ещё тот же (Lite 1.1, основной бот 20.37): пока ждали игру, ответ мог назначить новый откат или сменить HP —
  // тогда не жмём старое, а сразу выбираем заново.
  let quick = false;                               // ход подтверждён сервером — следующий круг без «человеческой» паузы
  async function press(plan, g, tvt, still = null) {
    const s = plan.slot, key = s.key, path = tvt ? '/game/tvt/action' : '/game/battle/action';
    if (!(await gameIdle(1500, g)) || !alive(g) || !s.b.isConnected) return false;
    if (!tvt && (CD.globalWait('') > 0 || (s.action && CD.skillWait(s.action, '') > 0 && CD.skillKnown(s.action, '', pressAt.get(s.action) || 0)))) { quick = true; return false; }
    if (still && !still()) { quick = true; return false; }
    status(`${tvt ? 'TvT' : 'Бой'}: ${s.name} — ${plan.why}`);
    const t0 = Date.now(), frozen = frozenSince.has(key);
    const slackA = NET.actEnd ? t0 - (NET.actEnd + lockA) : 1e9, slackB = NET.charEnd ? t0 - (NET.charEnd + lockB) : 1e9, bindB = slackB < slackA, gap = Math.min(slackA, slackB);
    if (s.action) pressAt.set(s.action, t0);
    pressAt.set(key, t0);
    if (!fire(s.b, g)) return false;
    if (s.pot) lastPot = { ...lastPot, [s.pot]: t0 };
    const st = await waitFor(() => NET.starts.find(x => x.t >= t0 && x.path === path && x.method === 'POST'), 450, 15);
    if (!st) {                                       // игра клик не отправила: слот «занят» 0,7 с, запас, решавший впритык, растёт
      block.set(key, Date.now() + 700);
      if (frozen) frozenLost.set(key, (frozenLost.get(key) || 0) + 1);
      if (gap < 250) { if (bindB) lockB = Math.min(LOCK_B[1], lockB + 15); else lockA = Math.min(LOCK_A[1], lockA + 30); lockSave(); }
      const n = (lostN.get(key) || 0) + 1; lostN.set(key, n);
      if (n >= 3) { block.set(key, Date.now() + 3000); lostN.set(key, 0); }
      return false;
    }
    if (gap < 60) { if (bindB) lockB = Math.max(LOCK_B[0], lockB - 1); else lockA = Math.max(LOCK_A[0], lockA - 2); lockSave(); }   // прошёл впритык — чуть быстрее
    const end = await waitFor(() => NET.ends.get(st.rid), 6000, 20, g);
    if (!end) return false;
    lostN.set(key, 0);
    if (!(end.status >= 200 && end.status < 300) || end.err) {
      // Отказ сервера: общий откат держит модель откатов (не слот); откат этого скилла, который сервер прислал, — тоже модель.
      const cdErr = end.by === 'global' || end.by === 'skill' || /cooldown|перезаряд/i.test(end.err);
      if (end.by === 'global') { if (CD.globalWait('') <= 0) block.set(key, Date.now() + 300); quick = true; return false; }
      if (cdErr && s.action && CD.skillWait(s.action, '') > 0) { quick = true; return false; }
      block.set(key, Date.now() + (/mp|мана/i.test(end.err) ? 1500 : cdErr ? 700 : 1200));
      return false;
    }
    progress(); lastActOk = Date.now(); quick = true;
    if ((s.type === 'buff' || s.type === 'lowhp') && s.id) markBuff(s.id, s.dur || 20);
    if (s.type === 'trance') log(`Battle Trance: HP до 25 % — дальше ${plan.why.replace(/^транс → /, '')}`);
    if (s.type === 'lowhp') log(`${s.name} включён при HP ${Math.round(meStats().hp * 100 / (meStats().maxHp || 1))} %`);
    return true;
  }

  // ---------- бой ----------
  const mobHp = () => { const m = ($('#battle-mob-hp-val')?.textContent || '').match(/(\d[\d\s  ]*)\s*\/\s*(\d[\d\s  ]*)/); return m ? { hp: num(m[1]), maxHp: num(m[2]) } : null; };
  const victoryShown = () => shown($('#battle-victory-inline'));
  const defeatShown = () => shown($('#battle-defeat-root')) || shown($('#map-defeat-root'));
  const spawnId = () => new URLSearchParams(location.search).get('spawnId') || '';
  let rowsDone = false, lastActOk = Date.now(), pageT0 = Date.now(), battleWarn = '';
  // Противник — босс или чемпион: по номеру спавна в адресе, по ответу игры о начале этого боя или по приписке в заголовке.
  function specialFoe() {
    const id = spawnId(), title = ($('#battle-mob-title')?.textContent || '').trim(), row = L.mobRow(title, '');
    const bi = BINFO && Date.now() - BINFO.t < 600000 && (!row.name || !BINFO.name || row.name.toLowerCase().startsWith(BINFO.name.toLowerCase()) || BINFO.name.toLowerCase().startsWith(row.name.toLowerCase())) ? BINFO : null;
    const bossId = x => /^l2dop_(?:rb|eg)_/i.test(x || ''), champId = x => /^champ_/i.test(x || '');
    const boss = (bi ? bossId(bi.spawn) || /raid|epic|boss/i.test(bi.kind) : bossId(id)) || row.boss;
    const champ = (bi ? champId(bi.spawn) || /champion/i.test(bi.kind) || !!bi.tier : champId(id)) || row.champ;
    if (!boss && !champ) return null;
    return { key: (bi && bi.spawn) || id || title, name: (bi && bi.name) || row.name, what: boss ? 'рейд-босс или охрана эпика' : 'чемпион' };
  }
  // Почему не продолжать охоту цепочкой: цель выполнена, пора на TvT, герой ушёл из места охоты, PvE заблокирован.
  function stopFarm() {
    if (limitDone()) return 'limit';
    if (TVT_ACT) return 'tvt';
    if (zoneWrong()) return 'zone';
    if (abState() === 'blocked') return 'blocked';
    return '';
  }
  async function toMap(g) {
    await flushRt();
    const back = [$('#battle-back-map')].find(shown) || byText(/^(Назад на карту|Назад на мапу)$/i);
    if (back && fire(back, g) && await waitFor(() => pageKind() !== 'battle', 8000, 100, g)) return;
    if (alive(g)) await go('/map.html');
  }
  async function afterVictory(g) {
    progress();
    const s0 = SNAP;
    await waitFor(() => SNAP !== s0, 1500, 50, g);   // ответ /character игры после победы — свежий счётчик и локация
    if (!alive(g)) return;
    const why = stopFarm();
    if (!why) {
      const hunt = await waitFor(() => { const b = $('#battle-victory-hunt'); return shown(b) && !b.disabled ? b : null; }, 2500, 100, g);
      if (!alive(g)) return;
      if (hunt) {
        status('Охочусь дальше');
        await gameIdle();
        if (!alive(g) || !fire(hunt, g)) return;
        if (await waitFor(() => !victoryShown() && mobHp()?.hp > 0, 8000, 100, g)) { lastActOk = Date.now(); return; }
        if (!alive(g)) return;
        log('«Охотиться дальше» не начал новый бой — выбираю моба на карте');
      }
    } else if (why === 'limit') status(`Цель выполнена: ${rt.k?.kills || 0} / ${cfg.killLimit}`);
    await toMap(g);
  }
  async function battleStep(g) {
    if (shown($('#battle-load-err'))) { log(`бой не загрузился: ${($('#battle-load-err').textContent || '').trim().slice(0, 80)} — на карту`); await toMap(g); return; }
    if (victoryShown()) return afterVictory(g);
    const mob = mobHp(), sp = specialFoe();
    // РБ, охрана эпика и чемпион — не цель этого бота: цепочка «Охотиться дальше» может их подсунуть. Почти добитого — добиваем.
    const leaveN = sess.get('l2lite.leaveN', {});
    if (sp && !(mob && mob.maxHp > 0 && mob.hp / mob.maxHp < 0.3) && (leaveN[sp.key] || 0) < 2) {
      if (battleWarn !== sp.key) { battleWarn = sp.key; log(`${sp.name || 'противник'}: ${sp.what} — не моя цель, выхожу из боя на карту`); }
      sess.set('l2lite.leaveN', { ...Object.fromEntries(Object.entries(leaveN).slice(-20)), [sp.key]: (leaveN[sp.key] || 0) + 1 });
      sess.set('l2lite.left', { id: sp.key, t: Date.now() });
      await toMap(g); return;
    }
    if (sp && battleWarn !== sp.key + ':fight') { battleWarn = sp.key + ':fight'; log(`${sp.name || 'противник'}: ${(leaveN[sp.key] || 0) >= 2 ? 'выйти из боя не получилось' : 'почти добит'} — бьюсь`); }
    if (!mob) { if (Date.now() - pageT0 > 15000) { log('страница боя без моба 15 с — на карту'); await toMap(g); } else await sleep(200); return; }
    if (!rowsDone) { rowsDone = true; await rowsAll(g); barFromDom(); }
    if (Date.now() - Math.max(lastActOk, pageT0) > 45000) { log('45 с ни одного принятого хода — выхожу на карту'); lastActOk = Date.now(); await toMap(g); return; }
    const opt = () => ({ now: Date.now(), hpPot: cfg.hpPot, mpPot: cfg.mpPot, lastPot });
    const slots = slotsNow(false), plan = L.planTurn(slots, meStats(), mob, opt());
    // Lite 1.1: всё на откате — ждём ровно до ближайшей готовности по ответу сервера (не дольше 0,1 с), а не круг с паузой.
    if (!plan) { status('Бой: жду отката'); await nap(Math.max(10, Math.min(readyIn(slots) + 5, 100))); quick = true; return; }
    await press(plan, g, false, () => { const p = L.planTurn(slotsNow(false), meStats(), mobHp(), opt()); return !!p && p.slot.key === plan.slot.key; });
  }
  // Через сколько мс станет готов ближайший нужный слот — по модели откатов сервера и своим блокировкам (Infinity — не знаем).
  function readyIn(slots) {
    const now = Date.now(); let w = Infinity;
    for (const s of slots) {
      if (s.on === false || s.type === 'other') continue;
      const t = Math.max((block.get(s.key) || 0) - now, CD.globalWait(''), s.action ? CD.skillWait(s.action, '') : 0);
      if (t > 0) w = Math.min(w, t);
    }
    return w;
  }

  // ---------- карта: ближайший обычный моб; цепочка «Охотиться дальше» — в бою ----------
  function markerTypes() {
    const sig = $('#map-mob-markers')?.getAttribute('data-l2-marker-sig') || '', m = {};
    for (const part of sig.split('|').slice(1).join('|').split(',')) { const i = part.lastIndexOf(':'); if (i > 0) m[part.slice(0, i)] = part.slice(i + 1); }
    return m;
  }
  function mapRows() {
    const mk = markerTypes();
    return $$('#map-mob-list a.l2-map-mob-link').map(a => {
      const id = decodeURIComponent((a.getAttribute('href') || '').match(/spawnId=([^&#]+)/)?.[1] || '');
      return { ...L.mobRow(a.textContent, id, a.className + ' ' + (a.closest('li')?.className || ''), mk[id] || ''), a };
    }).filter(x => x.id);
  }
  async function mapReady(ms, g) {
    let prev = '', same = 0;
    return waitFor(() => {
      const rows = mapRows(); if (!rows.length) { same = 0; return null; }
      const k = ($('#map-mob-page-ind')?.textContent || '') + '|' + rows.map(r => r.id).join(',');
      same = k === prev ? same + 1 : 0; prev = k;
      return same >= 2 ? rows : null;
    }, ms, 250, g);
  }
  const badSpawn = new Map();
  let restT0 = 0, noMobT0 = 0;
  async function mapStep(g) {
    const S = snapFresh(20000), left = sess.get('l2lite.left', null), leftOk = sess.get('l2lite.leftOk', null);
    // Ушли из боя с боссом/чемпионом: старый снимок «в бою» не возвращает обратно; выход подтверждён — тем более.
    const leaving = left && Date.now() - left.t < 60000 && (S?.t <= left.t + 300 || (leftOk && leftOk.t >= left.t));
    if (S?.inBattle && S.spawn && !leaving) { log('бой на сервере не закончен — возвращаюсь в него'); await go('/battle.html?spawnId=' + encodeURIComponent(S.spawn)); return; }
    if (!rt.zone && S?.locType === 'city') return outskirts(g);
    if (!rt.zone) { status(snapFresh() ? 'Запоминаю место охоты' : 'Жду данные героя от игры'); await sleep(1000); if (Date.now() - pageT0 > 20000) location.reload(); return; }
    if (zoneWrong()) { setRt({ goZone: rt.zone.id }); log(`герой в «${SNAP.zoneName || SNAP.zone}», место охоты — «${rt.zone.name}»: лечу обратно`); await go('/teleport.html'); return; }
    if (S?.locType === 'city') return outskirts(g);
    if (limitDone()) { status(`Цель выполнена: убито ${rt.k?.kills || 0} из ${cfg.killLimit}${cfg.tvt ? ' · жду TvT' : ''}`); progress(); await sleep(3000); return; }
    if (abState() === 'blocked') { status('PvE-фарм заблокирован игрой — жду'); progress(); await sleep(5000); return; }
    const me = meStats(), pct = me.maxHp > 0 ? me.hp * 100 / me.maxHp : 100;
    if (pct < 30 && (!restT0 || Date.now() - restT0 < 90000)) { restT0 = restT0 || Date.now(); status(`HP ${Math.round(pct)} % — отдыхаю перед боем`); progress(); await sleep(1500); return; }
    if (pct >= 30) restT0 = 0;
    const tab = $('#map-list-mode-mobs');
    if (tab && !tab.classList.contains('is-active')) { fire(tab, g); await sleep(400); }
    let rows = await mapReady(10000, g);
    if (!alive(g)) return;
    if (!rows) { status('Карта: список мобов не загрузился — обновляю'); await sleep(3000); if (alive(g)) location.reload(); await sleep(3000); return; }
    for (const [id, t] of badSpawn) if (Date.now() - t > 120000) badSpawn.delete(id);
    let m = L.pickMob(rows, { hero: heroLvl(), skip: new Set(badSpawn.keys()) });
    for (let pg = 0; !m && pg < 3; pg++) {            // на первой странице только боссы/чемпионы — листаем дальше
      const next = $('#map-mob-page-next'); if (!shown(next) || next.disabled) break;
      const k0 = rows.map(r => r.id).join(','); fire(next, g);
      rows = await waitFor(() => { const r = mapRows(); return r.length && r.map(x => x.id).join(',') !== k0 ? r : null; }, 4000, 150, g);
      if (!rows) break;
      m = L.pickMob(rows, { hero: heroLvl(), skip: new Set(badSpawn.keys()) });
    }
    if (!m) {
      noMobT0 = noMobT0 || Date.now();
      status('Подходящих мобов рядом нет — обновлю карту через 15 с'); progress();
      await sleep(15000); if (alive(g)) location.reload(); await sleep(3000); return;
    }
    noMobT0 = 0;
    status(`Атакую ${m.name}${m.lvl ? ' (' + m.lvl + ' ур.)' : ''}`);
    await flushRt();
    if (!fire(m.a, g)) return;
    if (!(await waitFor(() => pageKind() === 'battle', 10000, 100, g)) && alive(g)) { badSpawn.set(m.id, Date.now()); log(`${m.name}: бой не начался — пропускаю его 2 мин`); }
  }

  // ---------- телепорт к месту охоты (только адена; Coin of Luck — никогда) ----------
  async function teleportStep(g) {
    const id = rt.goZone || (zoneWrong() ? rt.zone.id : '');
    if (!id) { await go('/map.html'); return; }
    const S = snapFresh(30000), name = rt.zone?.id === id ? rt.zone.name : id;
    if (S && (S.zone === id || (rt.zone?.id === id && zoneIs(S.zone))) && !S.inBattle) { setRt({ goZone: '' }); await go(S.locType === 'city' ? '/city.html' : '/map.html'); return; }
    const tries = (rt.tpTry || []).filter(t => Date.now() - t < 15 * 60000);
    const giveUp = async why => { log(`телепорт в «${name}»: ${why} — 15 мин охочусь там, где стою`); setRt({ goZone: '', zoneBlockT: Date.now() }); await go('/map.html'); };
    if (tries.length >= 3) return giveUp('3 попытки за 15 мин не привели на место');
    status(`Телепорт: ищу «${name}»`);
    let n0 = -1, same = 0;
    await waitFor(() => { const n = $$('.l2-teleport-miru-city-btn[data-surroundings-key]').length; same = n && n === n0 ? same + 1 : 0; n0 = n; return same >= 3; }, 12000, 250, g);
    if (!alive(g)) return;
    const tpBtn = () => { const b = $(`.l2-teleport-miru-tp-btn[data-teleport-id="${CSS.escape(id)}"]`); return shown(b) && !b.disabled ? b : null; };
    let btn = tpBtn();
    for (const cb of btn ? [] : $$('.l2-teleport-miru-city-btn[data-surroundings-key]')) {   // окрестности городов раскрываются по нажатию
      if (!alive(g)) return;
      fire(cb, g); btn = await waitFor(tpBtn, 2500, 100, g);
      if (btn) break;
    }
    if (!alive(g)) return;
    if (!btn) return giveUp('кнопки телепорта нет');
    const row = btn.closest('.l2-teleport-miru-surroundings-row, .l2-teleport-miru-city-row');
    const cost = L.teleportCost(row?.textContent, row?.querySelector('.l2-teleport-miru-price-num')?.textContent ?? null,
      [row?.querySelector('.l2-teleport-miru-price-currency')?.textContent || '', ...[...(row?.querySelectorAll('.l2-teleport-miru-price-currency img, .l2-teleport-miru-price-currency [title]') || [])].map(i => (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('title') || '') + ' ' + (i.getAttribute('src') || ''))].join(' '));
    if (cost.why) return giveUp(cost.why);
    // Перед оплатой — свежий ответ сервера: герой уже на месте (старый снимок) — не платим; адены не хватает — не жмём.
    const now0 = await heroNow();
    if (!alive(g)) return;
    if (now0 && !now0.inBattle && (now0.zone === id || (rt.zone?.id === id && zoneIs(now0.zone)))) { setRt({ goZone: '' }); await go(now0.city ? '/city.html' : '/map.html'); return; }
    const adena = now0 ? now0.adena : S?.adena;
    if (Number.isFinite(adena) && cost.price > adena) return giveUp(`не хватает адены (${cost.price} > ${adena})`);
    setRt({ tpTry: [...tries, Date.now()] }); await flushRt();
    log(`телепорт → «${name}»${cost.price ? ' за ' + cost.price + ' аден' : ' (бесплатно)'}`);
    await gameIdle();
    if (!fire(btn, g)) return;
    await waitFor(() => pageKind() !== 'teleport' || /недостат|not enough/i.test(document.body.innerText.slice(-4000)), 8000, 200, g);
    if (alive(g) && pageKind() === 'teleport') return giveUp('игра не перенесла героя');
  }

  // ---------- смерть: «Вернуться в город» → статуя (баффер) → бесплатный набор и «Восстановить» → назад на место охоты ----------
  async function deathStep(pg, g) {
    if (pg === 'arena') return false;
    const btn = [$('#battle-defeat-tocity'), $('#map-defeat-tocity')].find(shown);
    if (!btn && !defeatShown()) return false;
    if (!rt.revive || Date.now() - (rt.revive.t || 0) > 180000) {
      const deaths = [...(rt.deaths || []).filter(t => Date.now() - t < 30 * 60000), Date.now()];
      setRt({ deaths, revive: { t: Date.now(), step: 'city' } }); sess.set('l2lite.buffs', {});
      log(`☠ герой погиб (${deaths.length} за 30 мин)`);
      if (deaths.length >= Math.max(1, +cfg.maxDeaths || 3)) {
        log(`☠ ${deaths.length} смерти за 30 мин — останавливаю бота, чтобы не терять опыт. Проверьте место охоты и скиллы`);
        notify('death', 'L2wap Lite остановлен', `${deaths.length} смерти за 30 минут.`);
        await flushRt(); await chrome.storage.local.set({ [K_CFG]: { ...cfg, on: false } });
        return true;
      }
    }
    if (btn) { status('После смерти: «Вернуться в город»'); await gameIdle(); fire(btn, g); await waitFor(() => pageKind() === 'city' || !defeatShown(), 8000, 200, g); }
    else await sleep(1000);
    return true;
  }
  async function cityStep(g) {
    if (rt.revive) {
      status('После смерти: к магической статуе (баффер)');
      const st = await waitFor(() => [$('a.l2-town-miru-item--buffer-statue'), ...$$('a[href*="town-buffer"]')].find(shown) || null, 5000, 200, g);
      if (!alive(g)) return;
      setRt({ revive: { ...rt.revive, step: 'buffer' } }); await flushRt();
      if (st) { fire(st, g); await waitFor(() => pageKind() === 'buffer', 6000, 200, g); } else await go('/town-buffer.html');
      return;
    }
    if (zoneWrong()) { setRt({ goZone: rt.zone.id }); await go('/teleport.html'); return; }
    // Город — сам место охоты (или место ещё не выбрано): выйти в Окрестности.
    return outskirts(g);
  }
  async function outskirts(g) {
    const a = $('#l2-nav-bottom a[data-nav-role="outskirts"]') || $('a[data-nav-role="outskirts"]');
    if (rt.zone && SNAP && zoneIs(SNAP.zone)) sess.set('l2lite.outsk', { from: rt.zone.id, t: Date.now() });
    status('В Окрестности');
    const s0 = SNAP;
    if (a && fire(a, g)) { await waitFor(() => (pageKind() !== 'city' && pageKind() !== 'map') || (SNAP !== s0 && SNAP?.locType !== 'city'), 8000, 200, g); progress(); return; }
    if (pageKind() !== 'city') { await go('/city.html'); return; }
    status('В городе: кнопки «Окрестности» нет — жду'); await sleep(3000);
  }
  async function bufferStep(g) {
    if (!rt.revive) { await go('/map.html'); return; }
    const res = () => (($('#town-buffer-result-title')?.textContent || '') + ' ' + ($('#town-buffer-result-text')?.textContent || '')).trim();
    if (!rt.revive.buff) {                             // бесплатный городской набор «basic» (после смерти баффы слетели)
      const b = await waitFor(() => { const x = $('#town-buffer-sets .l2-town-buffer-set-apply[data-set-id="basic"]'); return shown(x) && !x.disabled ? x : null; }, 10000, 200, g);
      if (!alive(g)) return;
      setRt({ revive: { ...rt.revive, buff: Date.now() } });
      if (b) { await sleep(rnd(800, 1300)); fire(b, g); const ok = await waitFor(() => /накладено|наложен|applied/i.test(res()), 6000, 200, g); log(ok ? 'городской бафф «basic» наложен' : `городской бафф: ${res().slice(0, 80) || 'нет ответа'}`); }
    }
    const rb = await waitFor(() => $('#town-buffer-restore-btn'), 10000, 200, g);
    if (!alive(g)) return;
    const hpPct = () => { const m = meStats(); return m.maxHp > 0 ? m.hp * 100 / m.maxHp : 0; }, msg = () => ($('#town-buffer-msg')?.textContent || '').trim();
    if (rb) {                                          // сразу после смерти игра восстановление не даёт — повторы с паузами (основной бот v4.36)
      await sleep(rnd(1300, 1800));
      for (const w of [0, 5000, 8000, 12000, 15000]) {
        if (w) { status(`Восстановление: игра пока не даёт — повтор через ${w / 1000} с`); progress(); await sleep(w); }
        if (!alive(g)) return;
        fire(rb, g);
        await waitFor(() => hpPct() >= 99 || /не удалось|не вдалося|failed|восстановлен|відновлен|restored/i.test(msg()), 7000, 200, g);
        if (hpPct() >= 90) break;
      }
      log(hpPct() >= 90 ? `восстановление у баффера: HP ${Math.round(hpPct())} %` : `восстановить HP у баффера не вышло (${msg().slice(0, 60) || 'нет ответа'}) — иду дальше`);
    }
    if (!alive(g)) return;
    setRt({ revive: null });
    await go(rt.zone ? '/teleport.html' : '/map.html');
  }

  // ---------- TvT: запись сразу при открытии, бой на арене, итог и назад на место охоты ----------
  let TVT_ACT = null, tvtReadT = 0, tvtFail = 0, tvtReading = false, tvtSkillsT = 0;
  function tvtNoteState(o) {
    const t = Date.now(), s = L.ms(o.serverNow);
    TVT = { ...o, t, off: s ? s - t : 0 };
    const V = L.tvtView(TVT);
    if (owner && V) { const small = { phase: V.phase, id: V.id, reg: V.reg, start: V.start, regOpen: V.regOpen, off: V.off, t }; if (JSON.stringify({ ...small, t: 0 }) !== JSON.stringify({ ...(rt.tvt || {}), t: 0 })) setRt({ tvt: small }); }
  }
  function tvtNet(d) {
    const o = d.tvt, ok = d.status >= 200 && d.status < 300;
    if (o.kind === 'state' && ok && typeof o.phase === 'string') tvtNoteState(o);
    if (o.kind === 'combat') {
      if (ok && !o.error) TVTC = { ...TVTC, ...o, t: Date.now() };
      else if (o.error === 'tvt_target_dead' && d.req?.targetCharacterId) tvtDead.set(String(d.req.targetCharacterId), Date.now());
    }
    if (o.kind === 'skills' && ok) TVTS = { skills: o.skills, t: Date.now() };
    if (o.kind === 'action') {
      TVTC.actN = (TVTC.actN || 0) + 1; TVTC.actT = Date.now();
      if (ok && !o.error) {
        if (o.selfMp != null) TVTC.selfMp = o.selfMp;
        if (o.nextBasicAttackAt) TVTC.nextBasicAttackAt = o.nextBasicAttackAt;
        if (TVTC.selectedTarget) TVTC.selectedTarget = { ...TVTC.selectedTarget, hp: o.targetHp ?? TVTC.selectedTarget.hp, cp: o.targetCp ?? TVTC.selectedTarget.cp, alive: !o.targetDead };
      }
      const sk = o.skillId ?? d.req?.skillId, ent = sk != null && TVTS?.skills?.find(x => x.skillId === sk);
      if (ent) { if (o.skillReadyAt) ent.readyAt = o.skillReadyAt; else if (o.error === 'tvt_skill_cooldown') ent.readyAt = tvtNow() + 1200; }
      if (o.targetDead) tvtDead.set(String(o.targetCharacterId || TVTC.selectedTarget?.characterId || ''), Date.now());
    }
  }
  async function tvtPoll(force = false) {
    if (!cfg.tvt || tvtReading || abHold() || !owner) return;
    const V = L.tvtView(TVT), gap = L.tvtPollGap(V, tvtNow(), tvtFail);
    if (!force && Date.now() - tvtReadT < gap) return;
    tvtReading = true; tvtReadT = Date.now();
    try {
      const r = await gameGet('/game/tvt', 8000), d = r.ok ? await r.json() : null;
      if (typeof d?.phase !== 'string') { tvtFail++; return; }
      tvtFail = 0; tvtNoteState(d);
    } catch (e) { tvtFail++; } finally { tvtReading = false; }
  }
  async function tvtSkillsRefresh() {
    if (Date.now() - tvtSkillsT < (TVTS ? 30000 : 5000) || abHold()) return;
    tvtSkillsT = Date.now();
    try { const r = await gameGet('/game/tvt/skills', 5000), d = r.ok ? await r.json() : null; if (Array.isArray(d?.skills)) TVTS = { skills: d.skills.filter(x => x && typeof x === 'object'), t: Date.now() }; } catch (e) {}
  }
  function tvtDecideNow(pg) {
    const V = L.tvtView(TVT);
    return V ? L.tvtDecide(V, tvtNow(), { done: rt.tvtDone, skip: rt.tvtSkip, inTvt: rt.tvtIn, arena: pg === 'arena' }) : null;
  }
  async function tvtLeave(V, g) {
    const head = ($('.l2-tvt-result__headline')?.textContent || '').trim(), score = ($('.l2-tvt-result__score')?.textContent || '').replace(/\s+/g, ' ').trim();
    const rew = $$('.l2-tvt-result__reward-text').map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(', ');
    log(V.eliminated ? 'TvT: выбыл из боя — возвращаюсь к охоте' : `TvT: итог ${head || '—'} ${score}${rew ? ' · награда: ' + rew : ''} — возвращаюсь к охоте`);
    setRt({ tvtDone: rt.tvtIn || V.id, tvtIn: '' });
    await go('/map.html');
    return true;
  }
  async function tvtRegister(V, pg, g) {
    // Бой с мобом сначала добиваем (запись открыта 10 мин), если до конца записи больше минуты.
    if (pg === 'battle' && !victoryShown() && !defeatShown() && (!V.regEnd || V.regEnd - tvtNow() > 60000)) return false;
    if (pg !== 'arena') {
      if (rt.tvtRegN?.id !== V.id) log(`TvT: открыта запись (${V.count}/${V.max}) — иду записываться`);
      status('TvT: иду записываться');
      if (pg === 'battle') await toMap(g); else await go('/tvt-arena.html');
      if (alive(g) && pageKind() === 'map') await go('/tvt-arena.html');
      return true;
    }
    const n = rt.tvtRegN?.id === V.id ? rt.tvtRegN.n : 0, retry = [0, 3000, 5000, 10000, 30000][Math.min(4, n)];
    if (Date.now() - (rt.tvtRegT || 0) < retry) { status('TvT: жду подтверждения записи'); await sleep(300); return true; }
    const b = await waitFor(() => { const x = $('#tvt-register-btn'); return shown(x) && !x.disabled ? x : null; }, 6000, 200, g);
    if (!alive(g)) return true;
    setRt({ tvtRegT: Date.now(), tvtRegN: { id: V.id, n: n + 1 } });
    if (!b) {                                        // кнопки нет дважды — герой не подходит под событие: пропуск до конца записи
      const why = ($('#tvt-message')?.textContent || $('#tvt-phase-label')?.textContent || '').trim().slice(0, 80);
      const nb = rt.tvtNoBtn?.id === V.id ? rt.tvtNoBtn.n + 1 : 1;
      if (nb >= 2) { setRt({ tvtNoBtn: null, tvtSkip: { id: V.id, until: V.regEnd || V.start || tvtNow() + 600000 } }); log(`TvT: кнопки «Зарегистрироваться» нет и при повторе${why ? ' (' + why + ')' : ''} — это событие пропускаю`); await go('/map.html'); return true; }
      setRt({ tvtNoBtn: { id: V.id, n: nb } }); log(`TvT: кнопки «Зарегистрироваться» нет${why ? ' — ' + why : ''}`);
      return true;
    }
    await gameIdle();
    if (!fire(b, g)) return true;
    log(`TvT: регистрация отправлена (${V.count}/${V.max})`);
    await sleep(1500); await tvtPoll(true);
    if (!alive(g)) return true;
    if (L.tvtView(TVT)?.reg) { log('TvT: запись подтверждена — до старта охочусь'); setRt({ tvtNoBtn: null }); await go('/map.html'); }
    else status('TvT: запись пока не подтверждена — остаюсь на арене');
    return true;
  }
  let lastTgt = 0, lastTgtId = '', lastBack = 0;
  function tvtEnemies() {
    const R = [...(TVTC.combatRoster || []), ...(TVT?.combatRoster || [])];
    return $$('.l2-tvt-nick[data-target-kind="enemy"][data-character-id]').map(e => {
      const id = e.getAttribute('data-character-id'), r = R.find(x => String(x.characterId) === String(id)) || {};
      const deadT = tvtDead.get(String(id)) || 0;
      return { e, id, name: e.textContent.trim(), lvl: +(((e.title || '').match(/\d+/) || [0])[0]), hp: r.hp ?? null, cp: r.cp ?? 0, prot: L.ms(r.spawnProtectedUntil) || 0,
        alive: r.alive !== false && !/dead/i.test(e.className) && !(Date.now() - deadT < 45000) };
    }).filter(x => x.alive);
  }
  async function tvtFightTick(V, g) {
    const now = tvtNow();
    if (rt.tvtIn !== V.id) { setRt({ tvtIn: V.id }); log(`TvT: на арене — ${V.start > now ? 'до боя ' + L.fmtLeft(V.start - now) : 'бой идёт'}`); }
    progress();
    if (!/ACTIVE/.test(V.phase) && !(V.start && now >= V.start)) { status(`TvT: подготовка${V.start ? ', до боя ' + L.fmtLeft(V.start - now) : ''}`); await sleep(1000); return true; }
    if (shown($('#tvt-result-section'))) { status('TvT: итог'); void tvtPoll(true); await sleep(1000); return true; }
    if (shown($('#tvt-self-dead'))) { status(`TvT: погиб — ${($('#tvt-self-respawn')?.textContent || 'жду воскрешения').trim().slice(0, 60)}`); await sleep(1000); return true; }
    void tvtSkillsRefresh();
    // Цель: живой враг, которого быстрее добить (HP+CP из ответа игры, без цифр — по уровню).
    const en = tvtEnemies(), dn = ($('#tvt-target-name')?.textContent || '').trim(), dh = ($('#tvt-target-hp')?.textContent || '').match(/(\d[\d\s]*)\s*\/\s*(\d[\d\s]*)/);
    const domCur = dn && dn !== '—' && shown($('#tvt-battle-target-block')) ? { name: dn, characterId: en.find(x => x.name === dn)?.id, hp: dh ? num(dh[1]) : null, maxHp: dh ? num(dh[2]) : null, alive: !(dh && num(dh[1]) === 0) } : null;
    const cur = TVTC.selectedTarget && Date.now() - (TVTC.t || 0) < 15000 ? TVTC.selectedTarget : domCur;
    const score = x => (x.hp != null ? x.hp + (x.cp || 0) : x.lvl ? 130 * x.lvl : 1e9);
    const best = en.filter(x => !(x.prot > now)).sort((a, b) => score(a) - score(b) || a.lvl - b.lvl)[0];
    const curDead = !cur || cur.alive === false || cur.hp === 0 || !en.some(x => String(x.id) === String(cur.characterId));
    if (cur && curDead && cur.characterId) tvtDead.set(String(cur.characterId), Date.now());
    const back = $('#tvt-back-roster-btn');
    if (curDead && cur && domCur && shown(back) && Date.now() - lastBack > 4000) {
      lastBack = Date.now(); log(`TvT: ${cur.name || 'цель'} повержен — к списку врагов`); fire(back, g); await sleep(300); return true;
    }
    const better = best && cur && !curDead && best.hp != null && cur.hp != null && String(best.id) !== String(cur.characterId) && best.hp + best.cp < (cur.hp + (cur.cp || 0)) * 0.5;
    if (best && (curDead || better) && (best.id !== lastTgtId || Date.now() - lastTgt > 1000)) {
      lastTgt = Date.now(); lastTgtId = best.id; status(`TvT: цель ${best.name}${best.hp != null ? ' (HP ' + best.hp + ')' : best.lvl ? ' (' + best.lvl + ' ур.)' : ''}`);
      await gameIdle(); fire(best.e, g);
      await waitFor(() => String(TVTC.selectedTarget?.characterId || '') === String(best.id), 1000, 25, g); return true;
    }
    if (curDead) { status(best ? `TvT: выбираю цель — ${best.name}` : 'TvT: живых врагов нет — жду'); await sleep(best ? 300 : 800); return true; }
    const me = meStats();
    if (!Number.isFinite(me.mp) && TVTC.selfMp != null) me.mp = +TVTC.selfMp;
    if (!(me.maxMp > 0) && TVTC.selfMaxMp) me.maxMp = +TVTC.selfMaxMp;
    const plan = L.planTurn(slotsNow(true), me, cur && cur.maxHp ? { hp: cur.hp, maxHp: cur.maxHp } : null,
      { now: Date.now(), hpPot: Math.max(+cfg.hpPot || 0, 60), mpPot: Math.max(+cfg.mpPot || 0, 35), lastPot, tvt: true });
    if (!plan) { await sleep(150); return true; }
    await press(plan, g, true);
    return true;
  }
  async function tvtStep(pg, g) {
    const act = TVT_ACT, V = L.tvtView(TVT);
    if (!act || !V) return false;
    if (act === 'leave') return tvtLeave(V, g);
    if (act === 'register') return tvtRegister(V, pg, g);
    // hold — бой через ≤ 3 мин: текущего моба добиваем, новых не берём; fight — бой через ≤ 90 с или идёт: PvE бросаем.
    if (pg === 'battle') {
      if (act === 'hold' && !victoryShown()) return false;
      log(`TvT: бой ${V.start > tvtNow() ? 'через ' + L.fmtLeft(V.start - tvtNow()) : 'идёт'} — ${victoryShown() ? '' : 'прерываю охоту, '}иду на арену`);
      await toMap(g);
      return true;
    }
    if (pg !== 'arena') { status('TvT: иду на арену'); await go('/tvt-arena.html'); return true; }
    return tvtFightTick(V, g);
  }

  // ---------- главный цикл ----------
  let progT = Date.now(), lastPg = '';
  function progress() { progT = Date.now(); }
  async function locsRefresh() {                   // список локаций для меню (раз в 12 ч)
    if (!owner || abHold() || Date.now() - (rt.locsT || 0) < 12 * 3600000 || locsRefresh.busy) return;
    locsRefresh.busy = true;
    try {
      const r = await gameGet('/game/teleport/locations'), d = r.ok ? await r.json() : null;
      if (Array.isArray(d?.locations)) setRt({ locsT: Date.now(), locs: d.locations.filter(x => x && typeof x.teleportId === 'string').slice(0, 200)
        .map(x => ({ id: x.teleportId, name: x.labelUk || x.labelEn || x.teleportId, lo: x.mobLevelMin ?? null, hi: x.mobLevelMax ?? null, cost: x.adenaCost ?? null })) });
      else setRt({ locsT: Date.now() - 11 * 3600000 });
    } catch (e) { setRt({ locsT: Date.now() - 11 * 3600000 }); } finally { locsRefresh.busy = false; }
  }
  async function tick() {
    if (!ready || dead) { await sleep(500); return; }
    if (!owner) { await sleep(1000); return; }
    void locsRefresh();
    if (!cfg.on) { status('Выключен'); abBlink(false); progress(); await sleep(600); return; }
    if (mainBotOn()) { status('Включён основной L2wap Bot — выключите его: два бота мешают друг другу'); progress(); await sleep(3000); return; }
    const g = gen, pg = pageKind();
    if (pg !== lastPg) { lastPg = pg; pageT0 = Date.now(); rowsDone = false; }
    const ab = abState();
    if (ab === 'check') {
      abBlink(true);
      status(abLayer() ? '⚠ КАПЧА: решите проверку в окне игры — бот ждёт и ничего не нажимает' : '⚠ КАПЧА ждёт: откройте бой и сделайте ход сами — игра покажет символы');
      progress(); await sleep(1000); return;
    }
    abBlink(false);
    if (ab === 'blocked' && abLayer() && (rt.abBlock || 0) && rt.abBlock <= Date.now()) {   // блок истёк, окно-сообщение висит — закрыть
      const x = abLayer().querySelector('.l2-antibot-card__close, button'); if (x) fire(x, g); setRt({ abBlock: 0 }); await sleep(800); return;
    }
    if (loginPage()) { status('Нужен вход в игру — войдите сами (пароль бот не хранит)'); progress(); await sleep(3000); return; }
    if (await deathStep(pg, g)) return;
    if (cfg.tvt) void tvtPoll();                    // расписание TvT читаем сами: частота — по близости записи и боя
    TVT_ACT = cfg.tvt ? tvtDecideNow(pg) : null;
    if (TVT_ACT && await tvtStep(pg, g)) return;
    if (!alive(g)) return;
    if (pg === 'battle') return battleStep(g);
    if (pg === 'map') return mapStep(g);
    if (pg === 'teleport') return teleportStep(g);
    if (pg === 'city') return cityStep(g);
    if (pg === 'buffer') return bufferStep(g);
    // Арена без дела, чат (после TvT), сумка и прочие страницы — назад к охоте.
    if (Date.now() - pageT0 < 2500) { await sleep(300); return; }
    if (!$('#l2-hud-legacy-name') && Date.now() - pageT0 < 30000) { status('Жду страницу игры'); await sleep(1000); return; }
    await go('/map.html');
  }
  async function loop() {
    for (;;) {
      quick = false;
      try { await tick(); } catch (e) { if (dead) return; log('ошибка: ' + String(e?.message || e).slice(0, 160)); await sleep(1500); }
      // Сторож: 4 мин без продвижения (ход, победа, переход, честное ожидание) — карта заново.
      if (cfg.on && owner && !dead && Date.now() - progT > 240000) { log('4 мин без продвижения — начинаю с карты'); progress(); try { await go('/map.html'); } catch (e) {} }
      // Lite 1.1 (основной бот 20.37): после хода, подтверждённого сервером, следующий круг ждёт только сервер и готовность игры.
      await sleep(quick ? 0 : rnd(60, 140));
    }
  }

  (async () => {
    const cmd = await load();
    await beat();
    if (owner) applyCmd(cmd);
    setInterval(beat, 4000);
    window.addEventListener('pagehide', () => { void flushRt(); });
    loop();
  })().catch(e => { try { console.warn('[L2wap Lite] старт не удался', e); } catch (_) {} });
})();
