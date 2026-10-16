/* L2wap runtime infrastructure v6.0.0.
 * This file has no DOM/chrome dependencies and is regression-tested in Node.
 */
(function (root) {
  'use strict';
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function createRecoveryController(clock = () => Date.now()) {
    const errors = new Map(), fatalSignatures = new Map();
    // Count failures per route rather than penalizing unrelated subsystems.
    function failure(route, error) {
      const now = clock(), key = String(route || 'unknown').slice(0, 128);
      let series = (errors.get(key) || []).filter(t => now - t < 30 * 60000);
      series.push(now); errors.set(key, series);
      const recent = series.filter(t => now - t < 10 * 60000).length;
      const total = series.length, message = String(error?.message || error || '').slice(0, 180);
      const network = /(?:failed to fetch|networkerror|network request failed|net::err_|fetch failed|timeout|background_timeout|502|503|504)/i.test(message);
      const programming = !network && (
        error instanceof ReferenceError || error instanceof SyntaxError || error instanceof TypeError ||
        /(?:cannot read properties|cannot set properties|is not (?:a )?function|is not defined|illegal invocation|undefined.*\.test)/i.test(message));
      // The same programming exception twice cannot be repaired by sleeping or reloading.
      let fatalRepeats = 0;
      if (programming) {
        const previous = fatalSignatures.get(key);
        fatalRepeats = previous?.message === message && now - previous.at < 10 * 60000 ? previous.count + 1 : 1;
        fatalSignatures.set(key, { message, count: fatalRepeats, at: now });
      }
      const delayMs = clamp(Math.round(1500 * Math.pow(1.7, Math.min(recent - 1, 8))), 1500, 30000);
      // 7.1.14-fix: «Cannot read properties of null/undefined» — обычно гонка с загрузкой страницы: 2-я подряд — перезагрузка,
      // стоп только на 4-й без прогресса. Настоящие ошибки кода («is not a function») — стоп со 2-го раза, как было
      const domRace = programming && /cannot (?:read|set) properties of (?:null|undefined)/i.test(message);
      const action = programming ? (domRace ? (fatalRepeats >= 4 ? 'halt' : fatalRepeats >= 2 ? 'reload' : 'retry') : fatalRepeats >= 2 ? 'halt' : 'retry') :
        total >= 18 ? 'halt' : recent >= 6 ? 'cooldown' :
        recent >= 3 && recent % 3 === 0 ? 'reload' : 'retry';
      return { route: key, action, delayMs: programming ? 1500 : delayMs, recent, total,
        error: message, programming, fatalRepeats, times: series.slice(-30) };
    }
    function restore(route, timestamps) {
      const key = String(route || 'unknown').slice(0, 128), now = clock();
      errors.set(key, (Array.isArray(timestamps) ? timestamps : []).filter(t => Number.isFinite(t) && t <= now && now - t < 30 * 60000).slice(-30));
    }
    function progress(route) { const k = String(route || 'unknown').slice(0, 128); errors.delete(k); fatalSignatures.delete(k); }
    function count(route) { return (errors.get(String(route || 'unknown').slice(0, 128)) || []).length; }
    // 8.0 (аудит ядра): счётчик повторов ошибки кода жил только в памяти страницы — после перезагрузки снова «1-й раз»,
    // и «Cannot read properties of undefined» перезагружал страницу бесконечно (раз в ≈7 с). Теперь его можно сохранить и вернуть
    function exportFatal(route) { const v = fatalSignatures.get(String(route || 'unknown').slice(0, 128)); return v ? { ...v } : null; }
    function restoreFatal(route, v) {
      const now = clock();
      if (v && typeof v.message === 'string' && Number.isFinite(v.count) && Number.isFinite(v.at) && v.at <= now && now - v.at < 10 * 60000)
        fatalSignatures.set(String(route || 'unknown').slice(0, 128), { message: v.message, count: v.count, at: v.at });
    }
    return { failure, progress, count, restore, exportFatal, restoreFatal };
  }

  function createTransitionMonitor(clock = () => Date.now()) {
    const pending = new Map();
    function expect(key, fromPage, timeoutMs = 20000) {
      pending.set(String(key), { fromPage, at: clock(), timeoutMs: clamp(timeoutMs, 1000, 120000) });
    }
    function check(key, page) {
      const k = String(key), p = pending.get(k);
      if (!p) return 'none';
      if (page !== p.fromPage) { pending.delete(k); return 'complete'; }
      if (clock() - p.at >= p.timeoutMs) { pending.delete(k); return 'timeout'; }
      return 'pending';
    }
    function clear(key) { pending.delete(String(key)); }
    return { expect, check, clear };
  }

  // Prevent background IPC from indefinitely freezing a navigation or state write.
  // Browser native timers require their Window receiver in some contexts.
  // Exposing them as bare object methods (timers.set = setTimeout) causes
  // TypeError: Illegal invocation in Chromium when called as timers.set(...).
  function withTimeout(promise, ms, timers = {
    set: (fn, delay) => setTimeout(fn, delay),
    clear: id => clearTimeout(id)
  }) {
    return new Promise((resolve, reject) => {
      const id = timers.set(() => reject(new Error('background_timeout')), ms);
      Promise.resolve(promise).then(
        v => { timers.clear(id); resolve(v); },
        e => { timers.clear(id); reject(e); }
      );
    });
  }

  // Detect a "live" loop with no observable progress. Unlike a heartbeat,
  // this requires a changing page, battle HP, objective or job state.
  function createProgressMonitor(clock = () => Date.now()) {
    let signature = null, changedAt = clock(), lastAlarm = 0;
    function tick(next, active, timeoutMs = 9 * 60000) {
      if (!active) { signature = null; changedAt = clock(); return 'idle'; }
      const s = String(next);
      if (signature !== s) { signature = s; changedAt = clock(); return 'progress'; }
      const now = clock();
      if (now - changedAt >= timeoutMs && now - lastAlarm >= timeoutMs) {
        lastAlarm = now; return 'stalled';
      }
      return 'waiting';
    }
    function snapshot() { return { signature, changedAt, lastAlarm }; }
    return { tick, snapshot };
  }

  // One exclusive autonomous mode controls navigation. Manual jobs, PvP and
  // combat remain higher-priority interrupts in the content-script dispatcher.
  function chooseMode({ enchant = false, epic = false, raid = false, fish = false, cat = false, campaign = false, tasks = false } = {}) {
    if (enchant) return 'enchant'; // 15.10: отдельный режим сильнее старых флагов импортированного профиля.
    if (epic) return 'epic';
    if (raid) return 'raid';
    if (fish) return 'fish';
    if (cat && !campaign) return 'cat';
    if (campaign) return 'campaign';
    if (tasks) return 'tasks';     // 10.0 (игрок 12.10: «старт без быстрого режима»): режима нет — только задачи (Маммон, квесты, цель фарма, TvT)
    return 'farm';
  }

  // 15.10: явный список задач ограничивает и старые флаги импортированных профилей.
  const TASK_KEYS = ['tvt','quests','fish','cat','raid','epic','farm','auto','enchant','mammon','dailies','clan','pvp','petbuff','resources'];
  const taskRaw = new WeakMap();
  const rawTaskConfig = c => taskRaw.get(c) || c;
  const taskList = c => Array.isArray(rawTaskConfig(c)?.autoTasks) ? TASK_KEYS.filter(k => rawTaskConfig(c).autoTasks.includes(k)) : null;
  const taskAllowed = (c, key) => taskList(c) === null || taskList(c).includes(key);
  function selectedTask(c, rt = {}, now = Date.now()) {
    const list = taskList(c); if (list === null) return null;
    const fishOpen = rt.fishCastActive === true || !rt.fishTgt?.done && !(+rawTaskConfig(c).fishMaxCasts > 0 && (+rt.fish?.casts || 0) >= +rawTaskConfig(c).fishMaxCasts);
    const wait = rt.rbFishWait, idleRaid = wait && rt.rbHunt?.phase === 'wait' && (!rt.rbHunt?.step || rt.rbHunt.step === 'pick') && !rt.rbHunt?.id && !rt.rbGo && !rt.rbPending;
    const fishBusy = rt.fishCastActive === true || !!rt.fishCastPending || rt.actionPayments?.pending?.kind === 'fishing';
    const raidPayment = !!rt.actionPayments?.pending && rt.actionPayments.pending.kind !== 'fishing';
    const freshRaid = rt.rbTourView?.at > (wait?.at || 0) && rt.rbTourView?.ready?.length > 0;
    return ['enchant','epic','raid','quests','fish','cat','auto','farm'].find(k => {
      if (!list.includes(k)) return false;
      if (k === 'enchant') return !['done','completed'].includes(rt.enchant?.status);
      if (k === 'raid' && list.includes('fish') && (fishOpen || fishBusy) && idleRaid && !raidPayment && (fishBusy || wait.until > now && !freshRaid)) return false;
      if (k === 'fish') return fishOpen || !!idleRaid && fishBusy;
      if (k === 'quests') {
        const live = [rt.storySaga,rt.dionCampaign].some(q => q && !q.completed && q.stage !== 'completed');
        return !(rt.campNoTasksUntil > now && !live && !(rt.questList || []).length); // Только подтверждённое отсутствие; ошибка главы не разрешает другую задачу.
      }
      return true;
    }) || 'tasks';
  }
  function taskConfig(input, runtime = () => ({})) {
    const raw = rawTaskConfig(input);
    if (!Array.isArray(raw?.autoTasks)) return raw;
    const groups = {
      mammon: ['mmOrders','mmUpgrade','mmShopBuy','mmSmithAuto','mmCraftSend','mmCraftNote','mmMailClaim','mmGoalFarm'],
      quests: ['storyTurnIn','campAuto','searchQuest'], dailies: ['dailyAuto'], clan: ['clanTasks'],
      pvp: ['enemyHunt','pvpOnSight'], petbuff: ['petFullAuto'], resources: ['subHelpMain','mmFarmBest','mmFarmGuide'],
    };
    const support = ['autoMagister','weaponScanAuto','weaponClassEquip','weaponAuto','shopAuto','townBuff','sealAuto','autoLearn'];
    const view = new Proxy(raw, { get(target, key) {
      const active = selectedTask(target, runtime()), allowed = k => taskAllowed(target, k);
      const primary = {enchantMode:'enchant',epicMode:'epic',rbHuntMode:'raid',rbMode:'raid',fishMode:'fish',catMode:'cat',zoneAuto:'auto',campaign:'quests'};
      if (Object.hasOwn(primary,key)) return primary[key] === active;
      if (key === 'tvtOn') return allowed('tvt');
      if (key === 'taskOnly') return active === 'tasks';
      if (key === 'tvtOverRb') return true;
      if (key === 'tsBuy') return false; // Покупка цели TvT — отдельная трата, не участие в событии.
      if (key === 'chain' && !['farm','auto','quests','cat'].includes(active)) return false;
      if (['farmRes','recipeRes','resQuests'].includes(key) && !allowed('resources')) return '';
      if (key === 'mmGoalItem' && !allowed('mammon')) return 0;
      if (key === 'mmGoalFarm' && !allowed('resources')) return false;
      for (const [group, keys] of Object.entries(groups)) if (keys.includes(key) && !allowed(group)) return false;
      if (key === 'campAuto') return false; // Кампания запускается только выбранной задачей.
      if (support.includes(key) && ['tasks','fish','enchant'].includes(active)) return false;
      return Reflect.get(target,key);
    }});
    taskRaw.set(view, raw); return view;
  }
  function taskJobAllowed(c, key, rt = {}) {
    if (taskList(c) === null) return true;
    if (['dailyFish','dailyRb'].includes(key)) return false; // Дейлики не владеют режимом строгого списка.
    const primary = {rbGo:'raid',rbHunt:'raid',fishSvc:'fish',fishService:'fish'}[key];
    // Ожидающий тур сохраняет место возврата после выбранной рыбалки; боевые маршруты не переносятся.
    if (key === 'rbHunt' && rt.rbFishWait && rt.rbHunt?.phase === 'wait' && (!rt.rbHunt.step || rt.rbHunt.step === 'pick') && !rt.rbHunt.id && selectedTask(c,rt) === 'fish') return true;
    if (primary) return selectedTask(c,rt) === primary;
    const group = {mmJob:'mammon',storyJob:'quests',dailyFish:'fish',dailyRb:'raid',petBufferTrip:'petbuff',rbGo:'raid',rbHunt:'raid',fishSvc:'fish',fishService:'fish',farmScan:'resources',recipeScan:'resources',rbScan:'raid'}[key];
    if (group) return taskAllowed(c,group);
    if (key === 'tsJob') return false;
    return !['tasks','fish','enchant'].includes(selectedTask(c,rt));
  }

  // Each update is a PATCH. Never rewrite a stale copy of the full runtime state.
  // Serial execution and retry preserve update ordering even if storage is down.
  function createPatchQueue(send, canWrite = () => true, onError = () => {}, clock = () => Date.now()) {
    let pending = {}, inflight = {}, flushing = null, retryAt = 0, gen = 0;   // 10.0: gen — поколение очереди (clear() после потери замка)
    async function drain() {
      while (Object.keys(pending).length) {
        if (!canWrite()) return { ok: false, reason: 'inactive' };
        const batch = pending, g0 = gen; pending = {}; inflight = batch;
        try {
          const response = await send(batch);
          if (!response?.ok) throw new Error(response?.reason || 'storage_patch_failed');
          retryAt = 0; inflight = {};
        } catch (e) {
          // Newer updates take precedence over the failed older batch.
          // 10.0 (аудит ядра): пакет из «до потери замка» (clear() был, пока он летел) обратно не ставим — иначе после возврата замка
          // старые kills/exp/zoneStat затёрли бы то, что за это время записала другая вкладка
          if (g0 === gen) pending = { ...batch, ...pending }; inflight = {};
          retryAt = clock() + 3000;
          onError(e);
          return { ok: false, reason: 'write_failed' };
        }
      }
      return { ok: true };
    }
    function enqueue(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
      Object.assign(pending, patch);
      if (retryAt > clock()) return Promise.resolve({ ok: false, reason: 'backoff' });
      if (!flushing) {
        flushing = Promise.resolve().then(drain).finally(() => { flushing = null; });
      }
      return flushing;
    }
    function peek() { return { ...inflight, ...pending }; }
    function recover() { return flushing || (!Object.keys(pending).length ? Promise.resolve({ ok: true }) : enqueue({})); }
    function clear() { pending = {}; inflight = {}; retryAt = 0; gen++; }
    return { enqueue, peek, recover, clear };
  }

  // 7.2.3 (игрок 10.10: «окно постоянно скачет, то больше, то меньше — нравится, когда больше»): свободное поле слева от игры
  // мерится по видимым элементам, а они на разных экранах (бой, победа, карта, загрузка) разные. Запоминаем самое широкое поле
  // для этой ширины окна браузера и не сужаем окно, пока ширина браузера та же (новая ширина — мерим заново)
  // 10.0.5 (игрок 13.10, спойлер WestSPOIL: «левая панель вышла за край»): «самое широкое поле» залезало на игру — на экране, где
  // рамка игры шире (или замер по узкому блоку дал лишнее поле), окно оставалось прежней ширины и закрывало левый край игры.
  // Теперь запоминаем самое УЗКОЕ поле, реально измеренное по рамке игры (measured): окно не прыгает и никогда не залезает на игру.
  // Без замера (игра ещё грузится) — прежнее значение. Старые записи «самого широкого» (без m) заменяются первым замером
  function stickyFree(stick, free, viewport, measured = true) {
    const cap = Math.max(0, Math.floor(viewport / 2) - 16);   // игра по центру: поле слева не шире половины экрана
    const f = Math.min(Math.max(0, free | 0), cap);
    const same = stick && stick.vw === viewport ? stick : null;
    if (!measured) return same || { vw: viewport, free: 0 };
    return same && same.m && same.free <= f ? same : { vw: viewport, free: f, m: 1 };
  }

  root.L2EngineCore = { TASK_KEYS, taskList, taskAllowed, selectedTask, taskConfig, rawTaskConfig, taskJobAllowed, stickyFree, createRecoveryController, createTransitionMonitor, createProgressMonitor, withTimeout, chooseMode, createPatchQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.L2EngineCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
