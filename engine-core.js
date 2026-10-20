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
  // 19.10: дневные квоты сбрасываются в полночь сервера; /game/time задаёт часы и зону (с учётом DST).
  // 20.10 (игрок 17.10 04:33: «мобы на автофарм и каты — общие!»): один дневной лимит мобов на обе охоты, счётчики auto/cat складываются.
  const dailyKeys = {fish:'dailyFishLimit',auto:'dailyKillLimit',cat:'dailyKillLimit'};
  const dayFormats = new Map();
  const serverDay = (now,zone='Europe/Kyiv') => {
    if(!dayFormats.has(zone))dayFormats.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}));
    const p=Object.fromEntries(dayFormats.get(zone).formatToParts(now).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
  };
  const serverClockNote = (data,at=Date.now()) => {
    if(!data || !Number.isSafeInteger(data.serverNowMs) || !Number.isSafeInteger(data.nextDailyResetAt) || data.nextDailyResetAt<=data.serverNowMs || data.nextDailyResetAt-data.serverNowMs>26*3600000 || typeof data.timeZone!=='string')return null;
    const key=String(data.gameDayKey||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    try {if(serverDay(data.serverNowMs,data.timeZone)!==key)return null;}catch(_){return null;}
    return {at,serverNowMs:data.serverNowMs,timeZone:data.timeZone,gameDayKey:key,nextDailyResetAt:data.nextDailyResetAt};
  };
  const dailyDay = (now=Date.now(),rt={}) => {
    const c=rt.serverClock;
    if(c && Number.isFinite(c.at) && Number.isFinite(c.serverNowMs) && now>=c.at) {
      const serverNow=c.serverNowMs+(now-c.at);
      if(serverNow<c.nextDailyResetAt && /^\d{4}-\d{2}-\d{2}$/.test(c.gameDayKey))return c.gameDayKey;
      try{return serverDay(serverNow,c.timeZone);}catch(_){}
    }
    return serverDay(now);
  };
  // Однократно переносим старые сутки UTC+10 без выдачи дополнительного дневного бюджета.
  const dailyCurrent = (row,rt={},now=Date.now()) => !!row && (row.day===dailyDay(now,rt) || row.basis!=='server' && row.day===new Date(now+10*3600000).toISOString().slice(0,10));
  const dailyQuotaToday = (rt={},now=Date.now()) => ({...(dailyCurrent(rt.dailyQuota,rt,now)?rt.dailyQuota:{fish:0,auto:0,cat:0,raid:0}),day:dailyDay(now,rt),basis:'server'});
  const dailyLimit = (c,k) => { const n = +rawTaskConfig(c)?.[dailyKeys[k]]; return Number.isSafeInteger(n) && n > 0 ? n : 0; };
  const dailyCount = (rt,k,now = Date.now()) => !dailyCurrent(rt.dailyQuota,rt,now) ? 0 : k === 'fish' ? Math.max(0,+rt.dailyQuota.fish || 0) : Math.max(0,+rt.dailyQuota.auto || 0) + Math.max(0,+rt.dailyQuota.cat || 0) + Math.max(0,+rt.dailyQuota.raid || 0) + Math.max(0,+rt.dailyQuota.server || 0);
  const dailyBlocked = (c,rt,k,now = Date.now()) => dailyLimit(c,k) > 0 && dailyCount(rt,k,now) >= dailyLimit(c,k);
  // 19.10, автономность: подтверждённая пауза рыбалки не удерживает другие выбранные занятия.
  function fishTaskWaitKey(c,rt={},now=Date.now()) {
    const raw=rawTaskConfig(c)||{};
    const keys=Object.keys(raw).filter(k=>/^(fish|rod)/.test(k)||['shopReserve','shopMaxSpend','dailyFishLimit'].includes(k)).sort();
    return JSON.stringify([rt.char||'',+rt.manualKickAt||0,rt.dailyStart||0,dailyDay(now,rt),taskList(c),keys.map(k=>[k,raw[k]])]);
  }
  function fishTaskWait(c,rt={},now=Date.now()) {
    const w=rt.taskWait?.fish,list=taskList(c);
    if(!w||!list?.includes('fish')||!list.some(k=>['raid','epic','quests','cat','auto','farm'].includes(k))||w.key!==fishTaskWaitKey(c,rt,now)
      ||!Number.isFinite(w.at)||!Number.isFinite(w.until)||now<w.at||w.until<=w.at||w.until-w.at>300000
      ||rt.fishCastActive===true||rt.fishCastPending||rt.actionPayments?.pending?.kind==='fishing'||rt.fishService||rt.fishSvc||rt.dailyFish)return null;
    // Уже начатая закупка/дорога запасной задачи завершается до возврата: короткая пауза не обрывает её на полпути.
    return w.until>now||rt.actionOwner||rt.actionPayments?.pending?w:null;
  }
  // 20.10: явный запуск тура выбрасывает прежний список живых/мёртвых, а не боевую память и платежи.
  function raidFreshStartPatch(rt = {}, c = {}, now = Date.now()) {
    const raw = rawTaskConfig(c) || {}, list = taskList(c);
    if (!(list ? list.includes('raid') : raw.rbHuntMode || raw.rbMode)) return {};
    const protective = rt.rbHuntIdle > now && rt.rbRefuse?.n >= 2 && now - (rt.rbRefuse.t || 0) < 600000;
    const seq = Number.isSafeInteger(rt.rbListStartSeq) && rt.rbListStartSeq >= 0 && rt.rbListStartSeq < Number.MAX_SAFE_INTEGER ? rt.rbListStartSeq + 1 : 1;
    return { rbList:{}, rbListT:0, rbListVerifiedAt:0, rbListIncomplete:true,
      rbListReadStart:null, rbListStartSeq:seq, rbListStartRequired:`${rt.dailyStart || 0}:${rt.manualKickAt || 0}:${seq}`,
      rbTourView:null, rbFishWait:null, rbListVerifyNextAt:0,
      ...(protective ? {} : { rbHuntIdle:0, rbIdleMark:null, rbIdleN:0 }) };
  }
  function selectedTask(c, rt = {}, now = Date.now()) {
    const list = taskList(c); if (list === null) return null;
    const fishWait=fishTaskWait(c,rt,now);
    const fishOpen = rt.fishCastActive === true || !fishWait && !dailyBlocked(c,rt,'fish',now) && !rt.fishTgt?.done && !(+rawTaskConfig(c).fishMaxCasts > 0 && (+rt.fish?.casts || 0) >= +rawTaskConfig(c).fishMaxCasts);
    const wait = rt.rbListStartRequired != null && rt.rbListReadStart !== rt.rbListStartRequired ? null : rt.rbFishWait, idleRaid = wait && rt.rbHunt?.phase === 'wait' && (!rt.rbHunt?.step || rt.rbHunt.step === 'pick') && !rt.rbHunt?.id && !rt.rbGo && !rt.rbPending;
    const fishBusy = rt.fishCastActive === true || !!rt.fishCastPending || rt.actionPayments?.pending?.kind === 'fishing';
    // 20.28 (лог 20.10 08:51): подготовка услуги Маммона не возвращает отложенный рейд.
    // Сам pending по-прежнему запрещает повторную оплату; удерживать рейд должен его собственный телепорт.
    const raidPayment = rt.actionPayments?.pending?.kind === 'raid-teleport';
    const freshRaid = rt.rbTourView?.at > (wait?.at || 0) && rt.rbTourView?.ready?.length > 0;
    return ['enchant','epic','raid','quests','fish','cat','auto','farm'].find(k => {
      if (!list.includes(k) || dailyBlocked(c,rt,k,now) && !(k === 'fish' && fishBusy)) return false;
      if (k === 'enchant') return !['done','completed'].includes(rt.enchant?.status);
      if (k === 'raid' && list.includes('fish') && (fishOpen || fishBusy || fishWait) && idleRaid && (!raidPayment || fishWait && rt.actionOwner) && (fishBusy || fishWait && rt.actionOwner || wait.until > now && !freshRaid)) return false;
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
    if (!Array.isArray(raw?.autoTasks)) {
      if (!Object.keys(dailyKeys).some(k => dailyLimit(raw,k))) return raw;
      const view = new Proxy(raw,{get(target,key){
        const rt=runtime(), tasks={fishMode:'fish',catMode:'cat',zoneAuto:'auto'};
        if (Object.hasOwn(tasks,key) && dailyBlocked(target,rt,tasks[key]) && !(key==='fishMode' && rt.fishCastActive)) return false;
        if (key==='taskOnly' && Object.entries(tasks).some(([flag,k])=>target[flag] && dailyBlocked(target,rt,k)) && !['enchantMode','epicMode','rbHuntMode','campaign'].some(k=>target[k]) && !Object.entries(tasks).some(([flag,k])=>target[flag] && !dailyBlocked(target,rt,k))) return true;
        return Reflect.get(target,key);
      }}); taskRaw.set(view,raw); return view;
    }
    const groups = {
      mammon: ['mmOrders','mmUpgrade','mmShopBuy','mmSmithAuto','mmCraftSend','mmCraftNote','mmMailClaim','mmGoalFarm'],
      quests: ['storyTurnIn','campAuto'], dailies: ['dailyAuto'], clan: ['clanTasks'], // searchQuest — приоритет местных ★ мобов, а не разрешение вести кампанию.
      pvp: ['enemyHunt','pvpOnSight'], petbuff: ['petFullAuto'], resources: ['subHelpMain','mmFarmBest','mmFarmGuide'],
    };
    const support = ['autoMagister','weaponScanAuto','weaponClassEquip','weaponAuto','shopAuto','townBuff','autoLearn'];
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
  // 20.12 (ревизия 17.10): режимы и платные разрешения — в одном месте. Базовый профиль не включает режимы
  // (чистая установка = «стоять, где оставили»), новый герой (ещё нет cfg@Ник) не наследует платные режимы предыдущего.
  const MODE_KEYS = ['enchantMode','epicMode','rbHuntMode','rbMode','rbBetween','fishMode','catMode','zoneAuto','campaign','autoTasks','taskOnly'];
  const BASE_CFG_SKIP = [...MODE_KEYS, 'weaponManual', 'nWeaponMain'];  // ручной выбор оружия из профиля устаревает вместе со снаряжением
  const BASE_RT_SKIP = ['weapons','weaponRec','weaponEq','weaponNow','weaponsT','panel','panelSig','skills','rbK','rbDps','rbStats','hardMobs','zoneBad','lvl'];
  const NEW_HERO_PAID = {epicMode:false, epicCoinDailyMax:0, epicAdenaDailyMax:0, rbHuntMode:false, rbMode:false, rbFaFull:false, epicFaFull:false, fishTimeAuto:false, mmUpgrade:false};
  const baseProfileCfg = c => Object.fromEntries(Object.entries(c || {}).filter(([k]) => !BASE_CFG_SKIP.includes(k)));
  const baseProfileRt = r => Object.fromEntries(Object.entries(r || {}).filter(([k]) => !BASE_RT_SKIP.includes(k)));
  function newHeroCfg(prev) {
    const next = { ...(prev || {}), ...NEW_HERO_PAID };
    // Явный список задач тоже выбирает режим: тур РБ и эпики новый герой включает сам.
    if (Array.isArray(next.autoTasks)) next.autoTasks = next.autoTasks.filter(k => k !== 'raid' && k !== 'epic');
    return next;
  }
  const MANUAL_JOBS = ['shop','invScan','bagCheck','faScan','recipeScan','farmScan','zoneScan'];
  function taskJobAllowed(c, key, rt = {}) {
    if (taskList(c) === null) return true;
    if (['dailyFish','dailyRb'].includes(key)) return false; // Дейлики не владеют режимом строгого списка.
    // 20.12 (ревизия 17.10, core-a/M2): разовые кнопки меню («🛒 Закупить сейчас», «Пересчитать в сумке», «Обновить список баффов FA»,
    // «Проверить оружие», чтение баз/телепорта) — явная команда игрока; раньше при выбранной рыбалке/«только задачах» их молча стирали.
    const job = rt[key];
    if (key === 'sealEx') return !!job && (job.auto !== true || c.sealAuto === true);
    if (MANUAL_JOBS.includes(key) && job && typeof job === 'object' && (job.urgent === true || job.manual === true)) return true;
    const primary = {rbGo:'raid',rbHunt:'raid',fishSvc:'fish',fishService:'fish'}[key];
    // Ожидающий тур сохраняет место возврата после выбранной рыбалки; боевые маршруты не переносятся.
    if (key === 'rbHunt' && rt.rbFishWait && rt.rbHunt?.phase === 'wait' && (!rt.rbHunt.step || rt.rbHunt.step === 'pick') && !rt.rbHunt.id && (selectedTask(c,rt) === 'fish' || fishTaskWait(c,rt))) return true;
    if (primary) return selectedTask(c,rt) === primary;
    const group = {mmJob:'mammon',storyJob:'quests',dailyFish:'fish',dailyRb:'raid',petBufferTrip:'petbuff',rbGo:'raid',rbHunt:'raid',fishSvc:'fish',fishService:'fish',farmScan:'resources',recipeScan:'resources',rbScan:'raid'}[key];
    if (group) return taskAllowed(c,group);
    if (key === 'tsJob') return false;
    // 17.10 (лог 15:10, West): перелёт цели «Фарм ресурсов»/рецепта — работа задачи «ресурсы», а не чужой маршрут; иначе «Только задачи» отменял его каждые 4 с.
    if (key === 'zoneGo' && (rt.zoneGo?.task === 'resources' || rt.zoneGo?.res)) return taskAllowed(c,'resources');
    return !['tasks','fish','enchant'].includes(selectedTask(c,rt));
  }

  // Each update is a PATCH. Never rewrite a stale copy of the full runtime state.
  // Serial execution and retry preserve update ordering even if storage is down.
  function createPatchQueue(send, canWrite = () => true, onError = () => {}, clock = () => Date.now(),
    timers = { set: (f, ms) => setTimeout(f, ms), clear: t => clearTimeout(t) }) {
    // Реворк ядра: каждая выдача замка получает свою очередь. Ответ старого запроса
    // после clear() не подтверждает новую запись и не задерживает её своим backoff.
    // 20.41 (лог 20.10 21:09, память 1,3 МБ: каждая запись ≈0,5 с и подвисание страницы): later — отложенные патчи (замеры
    // навыков после каждого удара). Они новее pending и уходят вместе с любой обычной записью, recover() или по таймеру.
    const fresh = () => ({ pending: {}, inflight: {}, flushing: null, retryAt: 0, later: {}, laterT: null });
    function promote(state) {
      if (state.laterT != null) { timers.clear(state.laterT); state.laterT = null; }
      if (Object.keys(state.later).length) { state.pending = { ...state.pending, ...state.later }; state.later = {}; }
    }
    let current = fresh();
    const cleared = () => ({ ok: false, reason: 'cleared' });
    async function drain(state) {
      while (Object.keys(state.pending).length) {
        if (state !== current) return cleared();
        if (!canWrite()) return { ok: false, reason: 'inactive' };
        const batch = state.pending; state.pending = {}; state.inflight = batch;
        try {
          const response = await send(batch);
          if (state !== current) return cleared();
          if (!response?.ok) throw new Error(response?.reason || 'storage_patch_failed');
          state.retryAt = 0; state.inflight = {};
        } catch (e) {
          if (state !== current) return cleared();
          // Более свежие значения заменяют неудачный старый пакет.
          state.pending = { ...batch, ...state.pending }; state.inflight = {};
          state.retryAt = clock() + 3000;
          onError(e);
          return { ok: false, reason: 'write_failed' };
        }
      }
      return { ok: true };
    }
    function flush(state) {
      if (!state.flushing) state.flushing = Promise.resolve().then(() => drain(state)).then(result => {
        state.flushing = null;
        if (state !== current) return cleared();
        // enqueue может попасть между последним await в drain и завершением promise.
        // Тогда его подтверждение тоже ждёт фактической записи, а не пустой старой очереди.
        return result.ok && Object.keys(state.pending).length ? flush(state) : result;
      }, error => { state.flushing = null; throw error; });
      return state.flushing;
    }
    function enqueue(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
      const state = current;
      promote(state);
      Object.assign(state.pending, patch);
      if (state.retryAt > clock()) return Promise.resolve({ ok: false, reason: 'backoff' });
      return flush(state);
    }
    function defer(patch, ms = 8000) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
      const state = current;
      Object.assign(state.later, patch);
      if (state.laterT == null) state.laterT = timers.set(() => {
        state.laterT = null;
        if (state !== current) return;
        promote(state);
        if (state.retryAt <= clock()) flush(state).catch(onError);
      }, ms);
      return Promise.resolve({ ok: true, deferred: true });
    }
    function peek() { return { ...current.inflight, ...current.pending, ...current.later }; }
    function recover() { promote(current); return current.flushing || (!Object.keys(current.pending).length ? Promise.resolve({ ok: true }) : enqueue({})); }
    function clear() { if (current.laterT != null) timers.clear(current.laterT); current = fresh(); }
    // 20.41 (ревью): изменение из меню новее ещё не отправленных значений тех же ключей (отложенная статистика держится до 8 с).
    function drop(keys) { for (const k of keys) { delete current.pending[k]; delete current.later[k]; } }
    return { enqueue, defer, peek, recover, clear, drop };
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

  root.L2EngineCore = { MODE_KEYS, BASE_CFG_SKIP, BASE_RT_SKIP, NEW_HERO_PAID, baseProfileCfg, baseProfileRt, newHeroCfg, serverClockNote, dailyCurrent, dailyQuotaToday, dailyDay, dailyLimit, dailyCount, dailyBlocked, fishTaskWaitKey, fishTaskWait, raidFreshStartPatch, TASK_KEYS, taskList, taskAllowed, selectedTask, taskConfig, rawTaskConfig, taskJobAllowed, stickyFree, createRecoveryController, createTransitionMonitor, createProgressMonitor, withTimeout, chooseMode, createPatchQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.L2EngineCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
