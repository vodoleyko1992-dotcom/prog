// Ядро выбора задач используется и сторожем MV3; в Firefox его подключает background.scripts.
if (typeof importScripts === 'function') importScripts('engine-core.js');
let hbMem = null;                                // последний пульс вкладки с ботом (сторож зависаний)
let hbPersistedAt = 0;                           // last successful storage commit
let hbPersistPending = Promise.resolve();
// v5.6.3: решение о владельце принимает один фоновый процесс, а не две вкладки,
// параллельно читающие и перезаписывающие один storage.lock.
const LOCK_TTL = 90000;
// 7.1.13: the popup has >120 fields. A full settings save must not reject Start.
const MAX_PATCH_KEYS = 400;
// An ownership epoch distinguishes old/new document instances in the same tab.
// Without it a stale page can renew/release another document's lease.
let leaseSeq = 0;
const makeLease = () => `${Date.now().toString(36)}-${(++leaseSeq).toString(36)}-${crypto.randomUUID()}`;
let lockQueue = Promise.resolve();
function serializeLock(fn) {
  const result = lockQueue.then(fn, fn);
  lockQueue = result.catch(() => {});
  return result;
}
async function lockCommand(m, sender) {
  const tab = sender?.tab?.id;
  if (!Number.isInteger(tab) || sender.frameId > 0) return { ok: false, reason: 'not_top_level_game_tab' };
  const key = 'tab' + tab;
  return serializeLock(async () => {
    const now = Date.now(), { lock } = await chrome.storage.local.get('lock');
    const mine = lock?.k === key;
    const valid = mine && lock?.epoch && m.epoch === lock.epoch && now - lock.t < LOCK_TTL;
    if (m.cmd === 'lockRelease') {
      if (valid) await chrome.storage.local.set({ lock: null });
      return { ok: !!valid };
    }
    if (m.cmd === 'lockCheck') return { ok: !!valid };
    if (m.cmd === 'lockRenew') {
      if (!valid) return { ok: false, reason: 'ownership_lost' };
      await chrome.storage.local.set({ lock: { ...lock, t: now,
        url: String(m.page || '').slice(0, 120), vis: m.vis === true } });
      return { ok: true, epoch: lock.epoch };
    }
    if (m.cmd !== 'lockAcquire') return { ok: false, reason: 'invalid_operation' };
    // Старый документ той же вкладки не может вернуть себе замок после reload нового документа.
    // У новой страницы epoch ещё нет; протухший, но совпадающий epoch остаётся допустимым.
    if (mine && m.epoch && lock?.epoch && m.epoch !== lock.epoch)
      return { ok: false, reason: 'ownership_lost' };
    if (lock && !mine && now - lock.t < LOCK_TTL &&
        !(lock.vis === false && m.vis === true && m.focus === true))
      return { ok: false, reason: 'other_tab', owner: lock.k };
    const changed = !valid;
    // 10.0 (аудит ядра): замок уходит видимой вкладке — прежнему хозяину сразу сообщаем (раньше узнавал через ≤ 5 с при продлении)
    if (lock && !mine && Number.isInteger(lock.tab) && lock.tab !== tab) try { chrome.tabs.sendMessage(lock.tab, { cmd: 'lockLost' }).catch(() => {}); } catch (e) {}
    // An old context may call acquire after navigation. Rotating epoch prevents
    // its in-flight actions and heartbeat from regaining the lease.
    const epoch = valid ? lock.epoch : makeLease();
    await chrome.storage.local.set({ lock: { k: key, epoch, t: now,
      url: String(m.page || '').slice(0, 120), vis: m.vis === true, tab } });
    if (changed) await noteAlive(tab, m.page || '');
    // 8.0 (аудит ядра): режим экономии памяти Chrome может выгрузить фоновую вкладку — вкладку бота не выгружать
    if (changed) try { await chrome.tabs.update(tab, { autoDiscardable: false }); } catch (e) {}
    // 20.13 (шаг 5, core-b/F6): тот же документ вернул свой же (только протухший) замок — между продлениями хозяина не было,
    // вкладка может дописать свою очередь записей, а не выбрасывать её
    const resumed = !!(mine && m.epoch && lock?.epoch === m.epoch);
    return { ok: true, key, epoch, changed, resumed };
  });
}
// A single process owns read/merge/write of runtime patches. Content pages
// cannot overwrite unrelated popup/character state using stale snapshots.
// 15.10: таймеры общих боссов приходят из импорта и вкладки одновременно.
// Запоздалый целый словарь не должен стирать свежие наблюдения или соседние строки.
function mergeTimerPatch(current, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !incoming.b || typeof incoming.b !== 'object' || Array.isArray(incoming.b)) return current || { b: {} };
  const b = { ...(current?.b || {}) };
  for (const [id, row] of Object.entries(incoming.b)) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || !row || typeof row !== 'object' || typeof row.al !== 'boolean') continue;
    if (!b[id] || (+row.ls || 0) >= (+b[id].ls || 0)) b[id] = row;
  }
  return { ...(current || {}), ...incoming, b };
}
// 20.8: лимиты фарма — свой прогресс, атомарное завершение только одной задачи.
const FARM_QUOTA = { auto: ['autoKillLimit', 'zoneAuto'], cat: ['catKillLimit', 'catMode'] };
const farmQuotaLimit = x => Number.isSafeInteger(+x) && +x > 0 ? +x : 0;
const dailyQuotaDay = now => new Date(now + 10 * 3600000).toISOString().slice(0,10);
const dailyQuotaToday = (rt,now) => rt.dailyQuota?.day === dailyQuotaDay(now) ? {...rt.dailyQuota} : {day:dailyQuotaDay(now),fish:0,auto:0,cat:0};
// 20.8: диапазон выбирается один раз; фактическая цель остаётся в прежнем cfg-ключе.
const RANGE_LIMITS = {dailyFishLimit:'daily',dailyKillLimit:'daily',autoKillLimit:'auto',catKillLimit:'cat',fishMaxCasts:'casts'};
const quotaRandom = (min,max) => Math.min(max,min+Math.floor(Math.random()*(max-min+1)));
function limitRangeChange(state,now,options={}) {
  const cfg={...(state.cfg||{})},rt={...(state.rt||{})},ranges={...(cfg.limitRanges||{})},rolls={...(rt.limitRolls||{})};
  const edit=options.edit;
  if(edit) {
    if(!Object.hasOwn(RANGE_LIMITS,edit.key) || !Number.isSafeInteger(edit.min) || edit.min<0 || !Number.isSafeInteger(edit.max) || edit.max<0 || edit.max>0 && (edit.min<1 || edit.max<edit.min)) return {ok:false,reason:'Диапазон: нужны целые числа от 1, «до» не меньше «от»'};
    if(edit.max)ranges[edit.key]={min:edit.min,max:edit.max};
    else {delete ranges[edit.key];delete rolls[edit.key];cfg[edit.key]=edit.min;}
  }
  for(const key of options.fixed||[]) {delete ranges[key];delete rolls[key];}
  const dropped=[];
  for(const [key,b] of Object.entries(ranges)) {
    // 20.12 (ревизия 17.10, аудит core-b/F2): старый/неизвестный ключ (импорт настроек ≤20.9: dailyAutoKillLimit и т.п.) или
    // испорченные границы раньше давали ok:false навсегда — цикл бота и все записи меню стояли. Теперь такой диапазон отбрасываем
    // (остаётся фиксированное значение лимита), остальные обрабатываем как прежде
    if(!Object.hasOwn(RANGE_LIMITS,key) || !b || !Number.isSafeInteger(b.min) || b.min<1 || !Number.isSafeInteger(b.max) || b.max<b.min) {delete ranges[key];delete rolls[key];dropped.push(key);continue;}
    const kind=RANGE_LIMITS[key],old=rolls[key],row=rt.farmQuota?.[kind],enabled=Array.isArray(cfg.autoTasks)?cfg.autoTasks.includes(kind):cfg[kind==='auto'?'zoneAuto':'catMode']===true;
    const renew=!old || old.min!==b.min || old.max!==b.max || old.value!==cfg[key] || old.value<b.min || old.value>b.max
      || kind==='daily' && !options.deferDaily && old.day!==dailyQuotaDay(now) || ['auto','cat'].includes(kind) && (options.resetFarmQuota===kind || row?.done && enabled)
      || kind==='casts' && options.resetCasts;
    if(!renew)continue;
    const value=quotaRandom(b.min,b.max);cfg[key]=value;
    rolls[key]={...b,value,day:kind==='daily'?dailyQuotaDay(now):'',t:now,seq:(old?.seq||0)+1};
    if(['auto','cat'].includes(kind))rt.farmQuota={...(rt.farmQuota||{}),[kind]:{run:(row?.run||0)+1,limit:value,got:0}};
  }
  cfg.limitRanges=ranges;rt.limitRolls=rolls;return {ok:true,cfg,rt,dropped};
}
// 20.12 (ревизия 17.10, UI-2): ключа дневного лимита нет в сохранённых настройках — у вкладки действует её заводское значение
// (DEF_CFG), фон сверяет с ним же. Раньше расхождение незаметно закрывала запись всей формы при Старте; без неё рыбалка и охота
// ждали «daily_fish_interrupted» / «quota_changed» вечно. Явно сохранённое число по-прежнему сверяется строго.
const dailyLimitOf = (cfg, key, tabLimit) => cfg?.[key] === undefined ? farmQuotaLimit(tabLimit) : farmQuotaLimit(cfg[key]);
function dailyFishChange(state,E,now) {
  const rt=state.rt||{},limit=dailyLimitOf(state.cfg,'dailyFishLimit',E?.limit);
  if(!state.on || !limit || limit!==E.limit || (rt.manualKickAt||0)!==(E.kick||0)) return {ok:false,reason:'daily_fish_interrupted'};
  const fish=rt.fish||{},t0=+fish.t0||0,caught=Math.max(0,+fish.caught||0),old=rt.dailyFishMark;
  const mark=!old || t0>old.t0 ? {t0,caught} : t0===old.t0 ? {t0,caught:Math.max(caught,old.caught)} : old;
  const delta=!old ? 0 : t0>old.t0 ? caught : t0===old.t0 ? Math.max(0,caught-old.caught) : 0;
  const dailyQuota=dailyQuotaToday(rt,now);dailyQuota.fish=(dailyQuota.fish||0)+delta;
  return {ok:true,dailyQuota,dailyFishMark:mark,rt:{...rt,dailyQuota,dailyFishMark:mark,_src:'daily-quota'}};
}
function farmQuotaChange(state, E, now) {
  const keys = FARM_QUOTA[E?.task], cfg = state.cfg || {}, rt = state.rt || {};
  if (!keys || !state.on || (rt.manualKickAt || 0) !== (E.kick || 0)) return { ok: false, reason: 'quota_interrupted' };
  const limit = farmQuotaLimit(cfg[keys[0]]), enabled = Array.isArray(cfg.autoTasks) ? cfg.autoTasks.includes(E.task) : cfg[keys[1]] === true;
  // 20.10: дневной лимит мобов общий для автофарма и катакомб — сумма auto+cat.
  const dailyLimit=dailyLimitOf(cfg,'dailyKillLimit',E?.dailyLimit),dailyMobs=q=>(q.auto||0)+(q.cat||0);   // 20.12: нет ключа — значение вкладки
  if (!enabled || !(limit || dailyLimit) || limit !== E.limit || dailyLimit !== (E.dailyLimit||0)) return { ok: false, reason: 'quota_changed' };
  const old = rt.farmQuota?.[E.task];
  let row = old, dailyQuota=dailyQuotaToday(rt,now);
  if (E.op === 'begin') {
    if (!Number.isSafeInteger(E.counter) || E.counter < 0 || !Number.isSafeInteger(E.revision) || typeof E.spawn !== 'string' || !E.spawn || E.spawn.length > 160) return { ok: false, reason: 'quota_snapshot' };
    if (!row || row.limit !== limit || row.done) row = { run: (old?.run || 0) + 1, limit, got: 0 };
    // Reload активного боя сохраняет исходную точку, включая уже убитых соседей.
    if (!row.pending || row.pending.spawn !== E.spawn) row = { ...row, pending: { spawn: E.spawn, counter: E.counter, revision: E.revision, kick: E.kick || 0 } };
    else row = { ...row, pending: { ...row.pending, kick: E.kick || 0 } };
  } else if (E.op === 'win') {
    if (!row || row.run !== E.run || row.done || row.pending?.spawn !== E.spawn || row.pending?.revision !== E.beforeRevision || row.pending.kick !== (E.kick || 0)) return { ok: false, reason: 'quota_battle_changed' };
    if (!Number.isSafeInteger(E.counter) || (E.lost ? E.counter < row.pending.counter : E.counter <= row.pending.counter) || !Number.isSafeInteger(E.revision) || E.revision <= row.pending.revision) return { ok: false, reason: 'quota_unconfirmed' };
    const delta=E.counter-row.pending.counter,got=row.got+delta;
    if(dailyLimit)dailyQuota[E.task]=(dailyQuota[E.task]||0)+delta;
    row = { ...row, got, pending: null, done: limit > 0 && got >= limit, ...(limit > 0 && got >= limit ? { doneT: now } : {}) };
  } else if (E.op === 'approx') {
    // 20.12 (ревизия 17.10): счётчик сервера недоступен/не подтвердил итог — бой засчитан по журналу боя (n убитых), с пометкой approx.
    // close — закрыть pending именно этого боя (иначе отказ: бой уже закрыт или заменён другим).
    if (!Number.isSafeInteger(E.n) || E.n < 0 || E.n > 200 || typeof E.spawn !== 'string' || !E.spawn) return { ok: false, reason: 'quota_snapshot' };
    if (E.close && (!row || row.done || row.pending?.spawn !== E.spawn)) return { ok: false, reason: 'quota_battle_changed' };
    if (!row || row.limit !== limit || row.done) row = { run: (old?.run || 0) + 1, limit, got: 0 };
    const got = row.got + E.n;
    if (dailyLimit) dailyQuota[E.task] = (dailyQuota[E.task] || 0) + E.n;
    row = { ...row, got, approx: (row.approx || 0) + E.n, pending: E.close || row.pending?.spawn === E.spawn ? null : row.pending || null, done: limit > 0 && got >= limit, ...(limit > 0 && got >= limit ? { doneT: now } : {}) };
  } else return { ok: false, reason: 'quota_operation' };
  const next = { ...cfg };
  if (row.done) {
    next[keys[1]] = false;
    if (Array.isArray(next.autoTasks)) next.autoTasks = next.autoTasks.filter(k => k !== E.task);
    else if (!['enchantMode','epicMode','rbHuntMode','fishMode','catMode','campaign','zoneAuto'].some(k => next[k])) next.taskOnly = true;
  }
  return { ok: true, row, dailyQuota, dailyDone: dailyLimit>0 && dailyMobs(dailyQuota)>=dailyLimit, cfg: next, rt: { ...rt, ...(dailyLimit?{dailyQuota}:{}), farmQuota: { ...(rt.farmQuota || {}), [E.task]: row }, _src: 'farm-quota' } };
}
async function statePatch(m, sender) {
  const tab = sender?.tab?.id;
  const patch = m?.patch || {}, config = m?.cfgPatch || {};
  const valid = p => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length <= MAX_PATCH_KEYS &&
    Object.keys(p).every(k => !['__proto__', 'constructor', 'prototype', '_src'].includes(k));
  if (!Number.isInteger(tab) || sender.frameId > 0 || !valid(patch) || !valid(config))
    return { ok: false, reason: 'invalid_patch' };
  // 7.1.14-fix: писать состояние от имени вкладки может только страница игры (content script), не вкладка с меню расширения
  let gamePage = false;
  try { gamePage = /(^|\.)l2wap\.com$/i.test(new URL(sender?.url || sender?.tab?.url || '').hostname); } catch (e) {}
  if (!gamePage) return { ok: false, reason: 'not_game_page' };
  return serializeLock(async () => {
    const now = Date.now();
    const state = await chrome.storage.local.get(['lock', 'on', 'rt', 'cfg']);
    // Поздний ответ со старой страницы не вправе дописать задания/покупки в профиль нового героя.
    if (String(m.expectedChar || '') !== String(state.rt?.char || '')) return { ok: false, reason: 'character_changed' };
    if (state.on && (state.lock?.k !== 'tab' + tab || !m.epoch || state.lock.epoch !== m.epoch ||
        now - state.lock.t >= LOCK_TTL)) return { ok: false, reason: 'ownership_lost' };
    if (!state.on && m.epoch && state.lock?.k === 'tab' + tab && state.lock.epoch !== m.epoch)
      return { ok: false, reason: 'ownership_lost' };
    if(m.resolveLimitRanges) {
      if(!state.on || (state.rt?.manualKickAt||0)!==(m.rangeKick||0))return {ok:false,reason:'ranges_interrupted'};
      const r=limitRangeChange(state,now);if(!r.ok)return r;
      await chrome.storage.local.set({cfg:r.cfg,rt:{...r.rt,_src:'limit-ranges'}});return {ok:true,cfg:r.cfg,limitRolls:r.rt.limitRolls,farmQuota:r.rt.farmQuota,dropped:r.dropped};
    }
    if (m.farmQuota) {
      const r = farmQuotaChange(state, m.farmQuota, now); if (!r.ok) return r;
      // 20.12 (ревизия 17.10, F9): cfg пишется только когда задача снята по лимиту — не на каждого моба
      await chrome.storage.local.set(r.row.done ? { rt: r.rt, cfg: r.cfg } : { rt: r.rt }); return { ok: true, row: r.row, cfg: r.cfg, dailyQuota:r.dailyQuota, dailyDone:r.dailyDone };
    }
    if(m.dailyFish) {
      const r=dailyFishChange(state,m.dailyFish,now);if(!r.ok)return r;
      await chrome.storage.local.set({rt:r.rt});return {ok:true,dailyQuota:r.dailyQuota,dailyFishMark:r.dailyFishMark};
    }
    // 17.10: завершение цели и снятие только рыбалки — одной записью, по свежему списку задач.
    if (m.finishFishGoal) {
      const T = state.rt?.fishTgt, E = m.finishFishGoal;
      if (!state.on || (state.rt?.manualKickAt || 0) !== (E.kick || 0)) return { ok: false, reason: 'fish_goal_interrupted' };
      if (!T || !['type','n','t'].every(k => T[k] === E[k])) return { ok: false, reason: 'fish_goal_changed' };
      if (!T.done && !(T.n > 0 && T.got >= T.n)) return { ok: false, reason: 'fish_goal_incomplete' };
      const fishTgt = T.done ? T : { ...T, done: true, doneT: now };
      const cfg = { ...(state.cfg || {}), fishMode: false };
      if (Array.isArray(cfg.autoTasks)) cfg.autoTasks = cfg.autoTasks.filter(k => k !== 'fish');
      await chrome.storage.local.set({ rt: { ...state.rt, fishTgt, fishService: null, _src: String(m.src || '').slice(0, 60) }, cfg });
      return { ok: true, fishTgt, cfg };
    }
    const change = {};
    const writePatch=pvpSeedPatch(patch,state.rt||{});
    if (Object.hasOwn(writePatch, 'rbTimer')) writePatch.rbTimer = mergeTimerPatch(state.rt?.rbTimer, writePatch.rbTimer);
    // Intent-only seed не содержит локального stale map; canonical echo принимается владельцем тоже.
    if (Object.keys(writePatch).length) change.rt = { ...(state.rt || {}), ...writePatch, _src: writePatch.pvpSeedDremia1410===true&&writePatch.pvpTargets ? 'pvp-seed' : String(m.src || '').slice(0, 60) };
    if (Object.keys(config).length) change.cfg = { ...(state.cfg || {}), ...config };
    if (Object.keys(change).length) await chrome.storage.local.set(change);
    return { ok: true };
  });
}
// Popup writes also go through the same queue as content-script patches.
// A stale popup snapshot can no longer roll back unrelated runtime keys.
// Меняем одну явную PvP-цель внутри serializeLock, не переписывая устаревший список из меню.
function pvpTargetChange(rt, edit) {
  const low=x=>String(x||'').trim().toLowerCase(),id=edit?.id,name=edit?.name;
  if(!['add','enabled','remove'].includes(edit?.action)||typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(id)
      ||['__proto__','constructor','prototype'].includes(id)||typeof name!=='string'||!name.trim()||name.length>100)
    return {ok:false,reason:'Нужны точный ID и имя известной цели'};
  const targets={...(rt.pvpTargets||{})},old=targets[id];
  if(edit.action==='add'){
    const e=Object.values(rt.enemies||{}).find(e=>e?.id===id&&low(e.name)===low(name));
    if(!e)return {ok:false,reason:'Запись врага изменилась — обновите список'};
    if(old)return {ok:false,reason:'Цель уже добавлена — измените её в списке'};
    targets[id]={id,name:e.name,enabled:true,source:'manual',t:Date.now()};
  }else{
    if(!old||old.id!==id||low(old.name)!==low(name))return {ok:false,reason:'Цель изменилась — обновите список'};
    if(edit.action==='remove')delete targets[id];
    else {if(typeof edit.enabled!=='boolean')return {ok:false,reason:'Неверное состояние цели'};targets[id]={...old,enabled:edit.enabled};}
  }
  return {ok:true,targets,seedHandled:id==='6f573aad-08ee-4713-9d76-33f5fd4afc93'};
}
// Одноразовый seed переносит только согласованную цель; поздняя whole-map пачка
// не восстанавливает удалённые цели и не стирает ручное добавление после её подготовки.
function pvpSeedPatch(patch,rt) {
  if(patch.pvpSeedDremia1410!==true)return patch;
  const D='6f573aad-08ee-4713-9d76-33f5fd4afc93',next={...patch};delete next.pvpTargets;delete next.pvpSeedDremia1410;
  const e=rt.enemies?.[D],t=patch.pvpTargets?.[D];
  if(rt.char!=='Warlock'||e?.id!==D||String(e.name).toLowerCase()!=='dremia'||!(e.kills>0)
    ||(patch.pvpTargets&&(t?.id!==D||String(t.name).toLowerCase()!=='dremia')))return next;
  const targets={...(rt.pvpTargets||{})};
  if(!rt.pvpSeedDremia1410&&!targets[D])targets[D]={id:D,name:e.name,enabled:true,source:'user-2026-10-14',t:Number.isFinite(t?.t)?t.t:Date.now()};
  return {...next,pvpSeedDremia1410:true,pvpTargets:targets};
}

async function menuPatch(m, sender) {
  const popupUrl = chrome.runtime.getURL('popup.html');
  let fromPopup = false;
  try {
    const src = new URL(sender?.url || ''), expected = new URL(popupUrl);
    fromPopup = src.origin === expected.origin && src.pathname === expected.pathname;
  } catch (e) {}
  if (!fromPopup) return { ok: false, reason: 'not_extension_popup' };
  const rtPatch = m.rtPatch || {}, cfgPatch = m.cfgPatch || {};
  const valid = p => p && typeof p === 'object' && !Array.isArray(p) &&
    Object.keys(p).length <= MAX_PATCH_KEYS && Object.keys(p).every(k => !['__proto__', 'constructor', 'prototype', '_src'].includes(k));
  if (!valid(rtPatch) || !valid(cfgPatch)) return { ok: false, reason: 'invalid_patch' };
  if (typeof m.on === 'boolean' || Object.hasOwn(rtPatch, 'manualKickAt')) serializeLock.controlSeq = (serializeLock.controlSeq || 0) + 1; // Stop отменяет ещё не отправленное восстановление.
  return serializeLock(async () => {
    const state = await chrome.storage.local.get(['rt', 'cfg']);
    if (m.expectedChar != null && String(state.rt?.char || '') !== m.expectedChar) return { ok: false, reason: 'Персонаж изменился — обновите меню' };
    if (m.pvpTargetEdit) {
      if (!m.expectedChar) return {ok:false,reason:'Персонаж изменился — обновите меню'};
      const edit=pvpTargetChange(state.rt||{},m.pvpTargetEdit);if(!edit.ok)return edit;
      rtPatch.pvpTargets=edit.targets;if(edit.seedHandled)rtPatch.pvpSeedDremia1410=true;
    }
    if (Object.hasOwn(rtPatch, 'rbTimer')) rtPatch.rbTimer = mergeTimerPatch(state.rt?.rbTimer, rtPatch.rbTimer);
    // 8.0 (аудит ядра): переключатель в меню больше не переписывает всю память персонажа (163 КБ) — rt только если есть что писать.
    // Раньше вкладка после такой записи заменяла свою память и теряла то, что держала только в памяти (метки отката атаки и т. п.)
    const change = Object.keys(rtPatch).length ? { rt: { ...(state.rt || {}), ...rtPatch, _src: 'menu' } } : {};
    if (Object.keys(cfgPatch).length) change.cfg = { ...(state.cfg || {}), ...cfgPatch };
    if(m.setFishGoal) {
      const E=m.setFishGoal;
      if(!m.expectedChar || !['fish','proof'].includes(E.type) || !Number.isSafeInteger(E.min) || E.min<1 || !Number.isSafeInteger(E.max) || E.max<E.min)return {ok:false,reason:'Цель: нужен положительный диапазон «от … до …»'};
      change.rt={...state.rt,...change.rt,fishTgt:{type:E.type,n:quotaRandom(E.min,E.max),min:E.min,max:E.max,got:0,t:Date.now()},_src:'menu'};
    }
    if(m.on!==false && (m.limitRangeEdit || Object.keys(state.cfg?.limitRanges||{}).length || Object.hasOwn(cfgPatch,'limitRanges'))) {
      if(m.limitRangeEdit && !m.expectedChar)return {ok:false,reason:'Персонаж изменился — обновите меню'};
      const fixed=Object.hasOwn(cfgPatch,'limitRanges')?[]:Object.keys(cfgPatch).filter(k=>Object.hasOwn(RANGE_LIMITS,k));
      const r=limitRangeChange({cfg:change.cfg||state.cfg,rt:change.rt||state.rt},Date.now(),{edit:m.limitRangeEdit,fixed,deferDaily:true,resetFarmQuota:m.resetFarmQuota,resetCasts:Object.hasOwn(rtPatch,'fish')&&rtPatch.fish===null});
      if(!r.ok)return r;
      // Последующие обработчики видят фактическую цель, а не устаревшее значение формы.
      for(const key of Object.keys(RANGE_LIMITS))if(r.cfg[key]!==state.cfg?.[key])cfgPatch[key]=r.cfg[key];
      change.cfg=r.cfg;change.rt={...r.rt,_src:'menu'};
    }
    // Новый лимит/явный сброс не наследуют старый бой и его поздний ответ.
    const quotaLimit = x => Number.isSafeInteger(+x) && +x > 0 ? +x : 0;
    for (const [task, key] of [['auto','autoKillLimit'],['cat','catKillLimit']]) {
      if (m.resetFarmQuota !== task && (!Object.hasOwn(cfgPatch, key) || quotaLimit(cfgPatch[key]) === quotaLimit(state.cfg?.[key]))) continue;
      const rows = change.rt?.farmQuota || state.rt?.farmQuota || {}, old = rows[task];
      change.rt = { ...state.rt, ...change.rt, _src: 'menu', farmQuota: { ...rows, [task]: { run: (old?.run || 0) + 1, limit: quotaLimit(change.cfg?.[key] ?? state.cfg?.[key]), got: 0 } } };
    }
    // 20.10: «mobs» — общий дневной лимит автофарма и катакомб: сброс обнуляет оба счётчика и незавершённые билеты обеих охот.
    for(const [task,key] of [['fish','dailyFishLimit'],['mobs','dailyKillLimit']]) {
      const reset=m.resetDailyQuota===task,edited=Object.hasOwn(cfgPatch,key)&&quotaLimit(cfgPatch[key])!==quotaLimit(state.cfg?.[key]);
      if(!reset&&!edited)continue;
      const rt={...state.rt,...change.rt,_src:'menu'};
      if(reset){rt.dailyQuota=dailyQuotaToday(rt,Date.now());for(const k of task==='fish'?['fish']:['auto','cat'])rt.dailyQuota[k]=0;}
      if(task==='fish')rt.dailyFishMark={t0:+rt.fish?.t0||0,caught:+rt.fish?.caught||0};
      else for(const k of ['auto','cat']){const row=rt.farmQuota?.[k];if(row)rt.farmQuota={...rt.farmQuota,[k]:{...row,run:(row.run||0)+1,pending:null}};}
      change.rt=rt;
    }
    // 15.10: выбор режима не продолжает старую серию; выход сразу запрещает новые попытки.
    // Берём подтверждённый снимок внутри очереди, чтобы поздний ответ не терял pending/историю.
    if (Object.hasOwn(cfgPatch, 'enchantMode') && state.rt?.enchant?.status === 'running') {
      change.rt = { ...(state.rt || {}), ...(change.rt || {}), _src: 'menu', enchant: { ...state.rt.enchant, status: 'paused',
        reason: cfgPatch.enchantMode === true ? 'Режим выбран — нажмите «Продолжить серию»' : 'Выбран другой режим — продолжение заточки только вручную' } };
    }
    if (typeof m.on === 'boolean') { change.on = m.on; if (!m.on) change.stopMeta = { source: 'popup-menu', reason: 'Команда остановки из панели', t: Date.now() }; }
    if (Object.keys(change).length) await chrome.storage.local.set(change);
    return { ok: true };
  });
}
// Реворк ядра: Stop/пауза проходят той же очередью, что замок и решение сторожа.
// Команды меню доступны даже с ошибочным диапазоном лимитов и неизвестной оплатой.
async function botControl(m, sender) {
  if (!['stop', 'pause'].includes(m.action)) return { ok: false, reason: 'invalid_control' };
  let popup = false, game = false;
  try {
    const url = new URL(sender?.url || sender?.tab?.url || ''), expected = new URL(chrome.runtime.getURL('popup.html'));
    popup = url.origin === expected.origin && url.pathname === expected.pathname;
    game = url.protocol === 'https:' && /(^|\.)l2wap\.com$/i.test(url.hostname) && Number.isInteger(sender?.tab?.id) && sender.frameId === 0;
  } catch (_) {}
  if ((!popup && !game) || sender?.id && sender.id !== chrome.runtime.id) return { ok: false, reason: 'invalid_sender' };
  serializeLock.controlSeq = (serializeLock.controlSeq || 0) + 1; // Stop отменяет ещё не отправленное восстановление.
  return serializeLock(async () => {
    const state = await chrome.storage.local.get(['on', 'lock', 'rt']);
    // 20.13 (ревизия 17.10, шаг 5, core-b/F3): (а) Esc ×2 — настоящая клавиша игрока (content проверил isTrusted) на любой вкладке игры:
    // это та же ручная остановка, что из меню; раньше вкладка без замка получала ownership_lost и бот продолжал работать в другой вкладке.
    // (б) «жёсткий» стоп самого бота (ошибка программы повторилась, 3 восстановления, аккаунт заблокирован) больше не отклоняется из-за нового
    // manualKickAt или протухшего замка — иначе после kick/F5 бот снова запускался. Отказ остаётся только если замок у другой живой вкладки.
    const user = !popup && m.user === true && m.action === 'stop';
    if (!popup && !user) {
      if (String(m.char || '') !== String(state.rt?.char || '')) return { ok: false, reason: 'character_changed' };
      if (!m.hard && m.kick != null && m.kick !== (state.rt?.manualKickAt || 0)) return { ok: false, reason: 'character_changed' };
      if (!state.on) return { ok: true };
      if (m.hard) {
        if (state.lock && state.lock.k !== 'tab' + sender.tab.id && Date.now() - state.lock.t < LOCK_TTL) return { ok: false, reason: 'ownership_lost' };
      } else if (state.lock?.k !== 'tab' + sender.tab.id || !m.epoch || state.lock.epoch !== m.epoch || Date.now() - state.lock.t >= LOCK_TTL) return { ok: false, reason: 'ownership_lost' };
    }
    if (user && !state.on) return { ok: true };
    const now = Date.now(), reason = String(m.reason || (m.action === 'pause' ? 'Пауза' : 'Команда остановки')).slice(0, 240);
    await chrome.storage.local.set({ on: false, paused: m.action === 'pause' ? { t: now, why: reason.slice(0, 160) } : null,
      stopMeta: { source: String(user ? 'content-user' : m.source || (popup ? 'popup-' : 'content-') + m.action).slice(0, 60), reason, t: now } });
    return { ok: true };
  });
}
// 20.12 (ревизия 17.10, аудит PAY-1): ручной выход игрока из неизвестной оплаты — только по кнопке меню
// «Считать оплату не прошедшей» и только для той оплаты, которую игрок видел (id и персонаж). Ожидание переносится
// в историю как «не прошла (решение игрока)», задача снова может заплатить. Сам бот такую оплату не снимает никогда.
function paymentDismissChange(rt, m, now) {
  const ap = rt?.actionPayments || {}, p = ap.pending;
  if (!p) return { ok: false, reason: 'Неподтверждённой оплаты уже нет' };
  if (!m?.expectedChar || String(rt.char || '') !== m.expectedChar || (p.char && p.char !== m.expectedChar)) return { ok: false, reason: 'Персонаж изменился — обновите меню' };
  if (!m.pendingId || p.id !== m.pendingId) return { ok: false, reason: 'Оплата уже изменилась — обновите меню' };
  const row = { ...p, phase: 'dismissed', confirmedAt: now, confirmation: { kind: 'player-dismissed', spent: 0 } };
  const note = { id: p.id, kind: String(p.kind || ''), amount: p.quote?.amount ?? null, currency: String(p.quote?.currency || ''), t: now };
  return { ok: true, note, rt: { ...rt, actionPayments: { ...ap, pending: null, history: [row, ...(ap.history || [])].slice(0, 40) }, paymentDismissed: note, _src: 'menu' } };
}
async function paymentDismiss(m, sender) {
  let popup = false;
  try { const url = new URL(sender?.url || ''), expected = new URL(chrome.runtime.getURL('popup.html')); popup = url.origin === expected.origin && url.pathname === expected.pathname; } catch (_) {}
  if (!popup || sender?.id && sender.id !== chrome.runtime.id) return { ok: false, reason: 'invalid_sender' };
  return serializeLock(async () => {
    const state = await chrome.storage.local.get(['rt']), now = Date.now(), r = paymentDismissChange(state.rt || {}, m, now);
    if (!r.ok) return r;
    await chrome.storage.local.set({ rt: r.rt });
    buf.push({ t: now, src: 'U', kind: 'оплата', what: `игрок нажал «Считать оплату не прошедшей»: ${r.note.kind} ${r.note.amount ?? '?'} ${r.note.currency} — ожидание снято по решению игрока, повтор снова разрешён`, sid: 'bg' });
    if (!timer) timer = setTimeout(flush, 1500);
    return { ok: true };
  });
}
async function switchCharacter(m, sender) {
  const tab = sender?.tab?.id, nick = String(m.nick || '').trim();
  if (!Number.isInteger(tab) || !nick || nick.length > 100 || /^[\s.\-–—…]*$/.test(nick)) return { ok: false, reason: 'invalid_character' };   // 14.10: заглушка HUD не создаёт профиль.
  return serializeLock(async () => {
    const current = await chrome.storage.local.get(['lock', 'on', 'rt', 'cfg', 'rt@' + nick, 'cfg@' + nick]);
    // Даже если вкладка ещё получает события, только владелец вправе менять
    // глобальные ключи; при выключенном боте разрешена смена через открытую страницу.
    if (current.on && (current.lock?.k !== 'tab' + tab || !m.epoch || current.lock.epoch !== m.epoch || Date.now() - current.lock.t >= LOCK_TTL)) return { ok: false, reason: 'ownership_lost' };
    if (!current.on && (!sender.tab.active || m.vis !== true)) return { ok: false, reason: 'inactive_tab' };
    const prev = current.rt || {}, old = String(prev.char || '').trim(), previousCfg = current.cfg || {};
    if (old === nick) return { ok: true, rt: prev, cfg: previousCfg, changed: false };
    if (!old) {
      const next = { ...prev, char: nick, campaign: null, campaignUrl: '', lastTeleport: '',
        qAlias: {}, needChamps: false, wrongLoc: 0, campaignDue: !!previousCfg.campaign,
        questTargets: [], quests: {}, _src: m.src };
      await chrome.storage.local.set({ rt: next });
      return { ok: true, rt: next, cfg: previousCfg, changed: true, old: '' };
    }
    let nextCfg = current['cfg@' + nick];
    if (!nextCfg) {
      // 20.12 (ревизия 17.10): эпики/Coin of Luck, тур РБ, бафф за FA, время рыбалки, улучшение у Маммона — новый герой включает сам (список в engine-core).
      nextCfg = globalThis.L2EngineCore?.newHeroCfg ? globalThis.L2EngineCore.newHeroCfg(previousCfg) : { ...previousCfg };
      for (const k of (Array.isArray(m.roles) ? m.roles : []))
        if (typeof k === 'string' && /^n[A-Z]/.test(k)) nextCfg[k] = '';
      // 7.2: игрок ходит и магом, и спойлером — профиль боя (маг/воин), выбранный у одного героя, не переносим на другого
      nextCfg.combatProfile = 'auto';
      Object.assign(nextCfg,{"petFullAuto":false,"petFullBudget":10000000,"petFullMaxPrice":10000000,"petFullReserve":null,"petFullRenew":true,"petHealPrefer":"heal"}); // Новый герой не наследует разрешение платной задачи.
      nextCfg.enchantMode = false; // 15.10: новый герой сам выбирает отдельный режим заточки.
      nextCfg.enchant = {"enabled":false,"queue":[],"scrollPolicy":"blessed","ordinaryUntil":3,"maxAttempts":0,"maxScrolls":0,"maxAdena":0,"maxConsecutiveFails":2,"maxDropFromStart":1,"maxDropFromPeak":2,"delayMs":1500,"purchase":false,"colBudget":0}; // У нового героя нет выбранных экземпляров чужой очереди.
      // 10.0 (аудит): вещь-цель Маммона — своя у каждого героя (иначе спойлер шлёт крафтеру своё сырьё на вещь Warlock)
      nextCfg.mmGoalItem = '';
    }
    const nextRt = { ...(m.defRt || {}), ...(current['rt@' + nick] || {}),
      char: nick, status: `Персонаж: ${nick}`, campaignDue: !!nextCfg.campaign, _src: m.src };
    // Таймеры боссов общие для сервера; старый кэш другого героя не отменяет импорт.
    if (prev.rbTimer || nextRt.rbTimer) nextRt.rbTimer = mergeTimerPatch(prev.rbTimer, nextRt.rbTimer);
    await chrome.storage.local.set({ ['rt@' + old]: prev, ['cfg@' + old]: previousCfg,
      rt: nextRt, cfg: nextCfg });
    return { ok: true, rt: nextRt, cfg: nextCfg, changed: true, old };
  });
}
// 8.0.6 (Firefox для Android): значка на панели там нет — вызовы под защитой, иначе фоновый скрипт ловит ошибку
const paint = on => {
  try { chrome.action?.setBadgeText?.({ text: on ? 'ON' : '' })?.catch?.(() => {}); chrome.action?.setBadgeBackgroundColor?.({ color: '#27ae60' })?.catch?.(() => {}); } catch (e) {}
};
chrome.storage.local.get('on').then(s => paint(s.on));
chrome.storage.onChanged.addListener(ch => {
  if (!ch.on) return;
  serializeLock.controlSeq = (serializeLock.controlSeq || 0) + 1; // Stop отменяет ещё не отправленное восстановление.
  paint(ch.on.newValue);
  if (ch.on.newValue) serializeLock(async () => {   // старт — отсчёт сторожа заново, в очереди владельца
    const { on, hbBg, lock } = await chrome.storage.local.get(['on', 'hbBg', 'lock']);
    if (!on) return; // Пока ждали хранилище, игрок мог уже остановить бота.
    const h = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
    if (!h || lock?.k !== 'tab' + h.tab) return;
    const nextHb = { ...h, t: Date.now() };
    await chrome.storage.local.set({ hbBg: { ...nextHb }, wdog: [], wdDown: null });
    hbMem = nextHb; hbPersistedAt = Date.now();
  }).catch(() => {});
});

// после установки/обновления расширения старый скрипт во вкладках игры «отключается» —
// перезагружаем открытые вкладки l2wap, чтобы бот подхватил новую версию
// 7.1.17: базовый профиль игрока (base-profile.json) — его настройки и память персонажа. По просьбе игрока: «каждый раз
// заполнять надоело». Применяется ТОЛЬКО туда, где своих данных нет: новая установка (новая папка = пустое хранилище),
// очищенное хранилище, персонаж без своей памяти. Существующие настройки и память не перезаписываются никогда.
async function applyBaseProfile(why) {
  try {
    const r = await fetch(chrome.runtime.getURL('base-profile.json'));
    if (!r.ok) return;
    const base = await r.json();
    if (!base?.l2botBase || !base.cfg) return;
    const nicks = Object.keys(base.chars || {});
    const cur = await chrome.storage.local.get(['cfg', 'rt', 'learn', ...nicks.flatMap(n => ['rt@' + n, 'cfg@' + n])]);
    const set = {}, done = [];
    const empty = o => !o || typeof o !== 'object' || !Object.keys(o).length;
    // 20.12 (ревизия 17.10): режимы («Тур РБ» и др.) и ручное оружие из профиля не переносим — чистая установка стоит, где оставили.
    const EC = globalThis.L2EngineCore, baseCfg = EC?.baseProfileCfg ? EC.baseProfileCfg(base.cfg) : { ...base.cfg };
    if (empty(cur.cfg)) { set.cfg = { ...baseCfg }; done.push('настройки'); }
    const curChar = String(cur.rt?.char || '').trim();
    for (const n of nicks) {
      let R = base.chars[n]?.rt; if (empty(R)) continue;
      // 7.2 (лог 10.10 20:08): снаряжение и панель из базового профиля устаревают (там было «надето: Посох життя D» — куплены D-заряды
      // при посохе C). Не переносим: бот сам прочитает инвентарь и панель до закупки
      // 20.12 (ревизия 17.10): и замеры боя Warlock 52 ур. (skills, rbK, rbDps, rbStats, hardMobs, zoneBad, lvl) — чужой состав, бот замерит сам.
      R = EC?.baseProfileRt ? EC.baseProfileRt(R) : Object.fromEntries(Object.entries(R).filter(([k]) => !['weapons', 'weaponRec', 'weaponEq', 'weaponNow', 'weaponsT', 'panel', 'panelSig'].includes(k)));
      // 20.12: без skills в профиле признак «память пустая» — нет ни замеров, ни кэша спавнов (иначе профиль ложился бы поверх при каждом запуске).
      if (empty(cur.rt) || (curChar === n && !cur.rt.skills && !cur.rt.spawns)) {          // нет текущей памяти (или она пустая у этого же героя)
        set.rt = { ...(cur.rt || {}), ...R, char: n }; done.push('память ' + n);
      } else if (curChar !== n && empty(cur['rt@' + n])) {               // герой сейчас другой — его память ждёт в rt@Ник
        set['rt@' + n] = { ...R, char: n }; done.push('память ' + n + ' (для смены героя)');
      }
      if (curChar !== n && empty(cur['cfg@' + n])) set['cfg@' + n] = { ...baseCfg };
    }
    if (empty(cur.learn) && base.learn) { set.learn = base.learn; done.push('автообучение'); }
    if (base.farmDb) { const { farmDb } = await chrome.storage.local.get('farmDb'); if (empty(farmDb)) { set.farmDb = base.farmDb; done.push('база ресурсов'); } }
    if (Object.keys(set).length) {
      await chrome.storage.local.set(set);
      buf.push({ t: Date.now(), src: 'S', kind: 'профиль', what: `базовый профиль применён (${why}): ${done.join(', ')}`, st: '' }); flush();
    }
  } catch (e) { console.warn('[L2bot] base profile:', String(e)); }
}
chrome.runtime.onStartup.addListener(() => { void applyBaseProfile('запуск браузера'); });

chrome.runtime.onInstalled.addListener(async details => {
  await ensureWatchdogAlarm();
  if (details && ['install', 'update'].includes(details.reason)) await applyBaseProfile(details.reason === 'install' ? 'установка' : 'обновление');
  // v5.6: только установка/обновление самого расширения (не обновление браузера — оно перезагружало игру посреди боя с РБ);
  // запись журнала включаем только при первой установке — при обновлении настройки игрока не трогаем
  if (details && !['install', 'update'].includes(details.reason)) return;
  if (details?.reason === 'install') try {
    const { cfg = {} } = await chrome.storage.local.get('cfg');
    await chrome.storage.local.set({ cfg: { ...cfg, rec: true, autoSnap: true } });
  } catch (e) {}
  // v7.1.5: migrate only the exact legacy defaults, preserving customized goals.
  // This runs once per installation and also updates the current character's saved preset.
  if (details?.reason === 'update') try {
    const migrationKey = 'v715FishingDefaultsApplied';
    const oldGoal = 'tattoo_d, cloak_d, belt_d';
    const current = await chrome.storage.local.get(['cfg', 'rt', migrationKey]);
    if (!current[migrationKey]) {
      const nick = String(current.rt?.char || '').trim();
      const characterKey = nick ? 'cfg@' + nick : null;
      const character = characterKey ? await chrome.storage.local.get(characterKey) : {};
      const changes = { [migrationKey]: true };
      for (const [key, value] of [['cfg', current.cfg], [characterKey, characterKey && character[characterKey]]]) {
        if (!key || !value || typeof value !== 'object') continue;
        const patch = {};
        if (value.fishGoal === oldGoal) patch.fishGoal = '';
        if (value.rodEnchantTo === 0 || value.rodEnchantTo == null) patch.rodEnchantTo = 10;
        if (Object.keys(patch).length) changes[key] = { ...value, ...patch };
      }
      await chrome.storage.local.set(changes);
    }
  } catch (e) { console.warn('[L2bot] fishing defaults migration:', String(e)); }
  try {
    const tabs = await chrome.tabs.query({ url: ['https://l2wap.com/*', 'https://*.l2wap.com/*'] });
    for (const t of tabs) chrome.tabs.reload(t.id);
  } catch (e) {}
});

// 8.0.6: в Firefox для Android нет горячих клавиш (chrome.commands === undefined) — без «?.» фоновый скрипт падал здесь,
// и всё ниже (журнал, замок вкладки, запись памяти) не регистрировалось
chrome.commands?.onCommand.addListener(async c => {
  if (c !== 'toggle-bot') return;
  serializeLock.controlSeq = (serializeLock.controlSeq || 0) + 1; // Stop отменяет ещё не отправленное восстановление.
  await serializeLock(async () => {
    const { on = false } = await chrome.storage.local.get('on');
    await chrome.storage.local.set({ on: !on, ...(!on ? {} : { stopMeta: { source: 'hotkey', reason: 'Горячая клавиша Alt+Shift+B', t: Date.now() } }) });
  });
});

// ===== журнал и снимки страниц — в IndexedDB (до 100 000 событий и 1000 страниц) =====
// IndexedDB: запись добавляется по одной, журнал не перезаписывается целиком и не нагружает вкладку игры.
const DB = 'l2bot', MAX_EV = 20000, MAX_SNAPS = 1000;
let dbp = null;
function idb() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('log')) d.createObjectStore('log', { autoIncrement: true });
      if (!d.objectStoreNames.contains('snaps')) d.createObjectStore('snaps', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('shots')) d.createObjectStore('shots', { autoIncrement: true });   // v5.1: скриншоты автообучения
      const ss = r.transaction.objectStore('snaps');
      if (!ss.indexNames.contains('t')) ss.createIndex('t', 't');      // время снимка — для «новых» без чтения разметки
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onclose = () => { dbp = null; };
      db.onversionchange = () => { db.close(); dbp = null; };
      res(db);
    };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
}
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
// Удаляем именно N самых старых существующих строк. Диапазон ID небезопасен:
// после удаления/импорта в IndexedDB ключи могут быть разреженными.
function trimOldest(store, excess) {
  if (excess <= 0) return;
  let left = excess;
  store.openCursor().onsuccess = ev => {
    const cur = ev.target.result;
    if (!cur || left <= 0) return;
    cur.delete();
    left--;
    if (left > 0) cur.continue();
  };
}


let buf = [], timer = null, writing = Promise.resolve();
function flush() {
  timer = null;
  if (!buf.length) return;
  const chunk = buf; buf = [];
  writing = writing.then(async () => {
    const db = await idb();
    const tx = db.transaction('log', 'readwrite'), st = tx.objectStore('log');
    let total = 0;
    chunk.forEach(ev => st.add(ev));
    st.count().onsuccess = e => {
      total = e.target.result;
      if (total > MAX_EV) trimOldest(st, total - MAX_EV);
    };
    await txDone(tx);
    await chrome.storage.local.set({ reccount: Math.min(total, MAX_EV) });
  }).catch(e => {
    // Не терять пакет событий, если IndexedDB временно недоступен.
    buf = [...chunk, ...buf].slice(-10000);
    console.warn('[L2bot] журнал: запись отложена, буфер до 10 000 событий', e);
    if (!timer) timer = setTimeout(flush, 3000);
  });
}

// Старый pending не содержит revision: журнал даёт только узкую привязку к одному запросу.
// В старых строках нет героя; любой разрыв контекста или неоднозначность запрещает восстановление.
function fishingCastRevision(events, at) {
  if (!Number.isSafeInteger(at) || at <= 0 || !Array.isArray(events)) return null;
  const rows = events.filter(e => e && Number.isSafeInteger(e.t) && e.t >= at - 300 && e.t <= at + 30000);
  const cast = e => e.src === 'B' && e.what === 'Рыбалка: заброс';
  const starts = rows.filter(e => cast(e) && at - e.t >= 0 && at - e.t <= 300);
  if (starts.length !== 1) return null;
  const b = starts[0], sid = b.sid;
  if (typeof sid !== 'string' || !sid || b.st?.page !== 'fishing') return null;
  const next = Math.min(Infinity, ...rows.filter(e => cast(e) && e.t > b.t).map(e => e.t));
  const requests = rows.filter(e => e.src === 'N' && /^POST \/game\/fishing\/action(?: \?[^→]*)? →/.test(e.what || '') && e.data?.q?.action === 'cast');
  const candidates = requests.map(e => {
    const m = String(e.what).match(/ · ([0-9]+(?:\.[0-9]+)?) мс(?: |$)/), ms = m ? Number(m[1]) : NaN;
    return { e, start: e.t - ms, ms };
  }).filter(x => Number.isFinite(x.ms) && x.ms >= 0 && x.start >= at && x.start <= at + 2000 && x.start < next);
  if (candidates.length !== 1) return null;
  const { e, start } = candidates[0], revision = e.data.q.expectedRevision;
  if (e.sid !== sid || e.st?.page !== 'fishing' || !Number.isSafeInteger(revision) || revision < 0) return null;
  // Лишний cast без измеренной длительности тоже оставляет неоднозначность.
  if (requests.some(x => x !== e && x.t >= b.t && x.t <= e.t)) return null;
  if (rows.some(x => x !== b && x.t >= b.t && x.t <= start &&
    (x.src === 'U' || x.src === 'S' || x.src === 'B' || x.st?.page && x.st.page !== 'fishing' || x.sid && x.sid !== sid))) return null;
  return { revision };
}
async function fishingCastEvidence(at) {
  if (!Number.isSafeInteger(at) || at <= 0) return null;
  flush(); await writing;
  if (buf.length) return null; // Не читаем неполный журнал после ошибки записи.
  const db = await idb(), rows = await new Promise((resolve, reject) => {
    // Разовая миграция читает не больше штатного объёма + одной строки для проверки переполнения.
    let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(deadline); resolve(value); } };
    const deadline = setTimeout(() => finish(null), 1500);
    const r = db.transaction('log').objectStore('log').getAll(null, MAX_EV + 1);
    r.onsuccess = () => finish(r.result.length > MAX_EV ? null : r.result.filter(e => e && Number.isSafeInteger(e.t) && e.t >= at - 300 && e.t <= at + 30000));
    r.onerror = () => finish(null);
  });
  return fishingCastRevision(rows, at);
}

function faBuffPendingSpec(p) {
  const e = p?.evidence, amount = p?.quote?.amount;
  if (p?.kind !== 'fa-buff' || typeof p.id !== 'string' || !p.id || p.id.length > 256 ||
    typeof p.char !== 'string' || !p.char || p.char.length > 128 || !Number.isSafeInteger(p.at) || p.at <= 0 ||
    p.quote?.currency !== 'FA' || !Number.isSafeInteger(amount) || amount <= 0 ||
    !Array.isArray(e?.ids) || e.ids.length !== 1 || !Number.isSafeInteger(e.ids[0]) || e.ids[0] <= 0 ||
    !Number.isSafeInteger(e.balance) || e.balance < amount) return null;
  return { at:p.at, char:p.char, skill:e.ids[0], spent:amount, balance:e.balance - amount };
}
// Старые ответы сети обрезаны до 800 символов. Читаем только завершённое поле имени
// в известном начале character; квитанцию доказывают отдельные новые строки страницы.
function faBuffJournalReceipt(events, p) {
  const spec = faBuffPendingSpec(p);
  if (!spec || !Array.isArray(events) || events.length > MAX_EV) return null;
  const { at, char, skill, spent, balance } = spec;
  const rows = events.filter(e => e && Number.isSafeInteger(e.t) && e.t >= at - 30000 && e.t <= at + 30000);
  const faPost = e => e.src === 'N' && /^POST \/character\/town\/fast-aden-buffer\/apply(?: \?[^→]*)? →/.test(e.what || '');
  const posts = rows.filter(faPost);
  const candidates = posts.map(e => {
    const m = String(e.what).match(/^POST \/character\/town\/fast-aden-buffer\/apply → 200 · ([0-9]+(?:\.[0-9]+)?) мс · [0-9]+ б$/);
    const ms = m ? Number(m[1]) : NaN;
    return { e, start:e.t - ms, ms };
  }).filter(x => Number.isFinite(x.ms) && x.ms >= 0 && x.start >= at && x.start <= at + 2000 && x.e.t <= at + 25000);
  if (candidates.length !== 1) return null;
  const { e } = candidates[0], q = e.data?.q, sid = e.sid;
  if (typeof sid !== 'string' || !sid || sid.length > 128 || e.st?.page !== 'fast-aden-buffer' ||
    q?.skillId !== skill || q.expectedCostFastAden !== spent || !['warrior','mage','resist','resists','greater'].includes(q.set) ||
    !Number.isSafeInteger(q.expectedRevision) || q.expectedRevision < 0) return null;
  const prefix = typeof e.data?.r === 'string' ? e.data.r.slice(0,800) : '';
  const identity = prefix.match(/^\{"character":\{"id":("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"),"name":("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")(?=,|\})/);
  if (!identity) return null;
  try { if (JSON.parse(identity[2]) !== char) return null; } catch (_) { return null; }
  const starts = rows.filter(x => x.src === 'B' && x.what === 'Бафф: Fast Aden' && x.t <= at && x.t >= at - 30000);
  if (starts.length !== 1 || starts[0].sid !== sid || starts[0].st?.page !== 'fast-aden-buffer') return null;
  const b = starts[0];
  const receiptRows = rows.filter(x => x.t > e.t && x.t <= e.t + 5000 && Array.isArray(x.added) &&
    x.added.some(s => typeof s === 'string' && /^Баф наложен\. Списано [0-9]+ FA\.$/.test(s)));
  if (receiptRows.length !== 1) return null;
  const receipt = receiptRows[0], paid = receipt.added.filter(s => typeof s === 'string' && /^Баф наложен\. Списано [0-9]+ FA\.$/.test(s)),
    balances = receipt.added.filter(s => typeof s === 'string' && /^Fast Aden: [0-9]+ FA$/.test(s));
  if (!['B','S'].includes(receipt.src) || receipt.sid !== sid || receipt.st?.page !== 'fast-aden-buffer' || paid.length !== 1 || balances.length !== 1 ||
    paid[0] !== `Баф наложен. Списано ${spent} FA.` || balances[0] !== `Fast Aden: ${balance} FA`) return null;
  const interval = rows.filter(x => x.t >= b.t && x.t <= receipt.t);
  if (interval.some(x => x.src === 'U' || x.sid !== sid || x.st?.page !== 'fast-aden-buffer' ||
    (x.src === 'S' && /управление вкладкой|бот (?:запущен|остановлен)|пауза|перезапуска|перезагружа|смена героя|сессия|сессии/i.test(x.what || '')) ||
    (x !== b && x.src === 'B' && x.what === 'Бафф: Fast Aden') || (faPost(x) && x !== e))) return null;
  return { kind:'journal-receipt', eventKey:`${sid}:${e.t}`, requestRevision:q.expectedRevision, spent, balance };
}
async function faBuffEvidence(p) {
  if (!faBuffPendingSpec(p)) return null;
  flush(); await writing;
  if (buf.length) return null;
  const db = await idb(), rows = await new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(deadline); resolve(value); } };
    const deadline = setTimeout(() => finish(null), 1500);
    const r = db.transaction('log').objectStore('log').getAll(null, MAX_EV + 1);
    r.onsuccess = () => finish(r.result.length > MAX_EV ? null : r.result);
    r.onerror = () => finish(null);
  });
  return faBuffJournalReceipt(rows, p);
}

// снимок: ключ = хэш структуры страницы (без текста и чисел) — одно и то же состояние не сохраняется дважды
function addSnap({ key, state, html }) {
  writing = writing.then(async () => {
    const db = await idb();
    const tx = db.transaction('snaps', 'readwrite'), st = tx.objectStore('snaps');
    let added = 0, n = 0;
    st.count().onsuccess = e => {
      n = e.target.result;
      st.getKey(key).onsuccess = g => {
        if (g.target.result != null) return;
        // v5.6: при заполнении — удаляем самый старый снимок (раньше новые просто не сохранялись, а бот слал их снова и снова)
        if (n >= MAX_SNAPS) { const c = st.index('t').openCursor(); c.onsuccess = ev => { const cur = ev.target.result; if (cur) { cur.delete(); n--; } }; }
        st.put({ key, state: state || '', t: Date.now(), html }); added = 1;
      };
    };
    await txDone(tx);
    if (added) await chrome.storage.local.set({ snapcount: Math.min(n + 1, MAX_SNAPS) });
  }).catch(e => console.warn('[L2bot] снимок:', e));
}

// скриншот экрана для автообучения — только с разрешения игрока (необязательное право «<all_urls>») и только если вкладка игры
// сейчас на экране (иначе снимется чужая вкладка); храним 150 последних
const MAX_SHOTS = 150;
function addShot(tab, m) {
  writing = writing.then(async () => {
    if (!chrome.tabs.captureVisibleTab || !(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) return;   // 8.0.6: в Firefox для Android снимка экрана нет
    const [act] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!act || act.id !== tab.id) return;
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 });
    const db = await idb();
    const tx = db.transaction('shots', 'readwrite'), st = tx.objectStore('shots');
    st.add({ t: Date.now(), page: m.page || '', reason: m.reason || '', url });
    st.count().onsuccess = e => { const n = e.target.result; if (n > MAX_SHOTS) trimOldest(st, n - MAX_SHOTS); };
    await txDone(tx);
  }).catch(e => console.warn('[L2bot] скриншот:', e));
}

// ===== сторож: вкладка с работающим ботом «молчит» > 150 с — перезагружаем (не чаще 3 раз за 20 мин) =====
// Пульс шлёт сам бот (из своих пауз). Будильник раз в минуту будит фоновый скрипт, даже если вкладка умерла.
function persistHeartbeat(snapshot) {
  // Queue snapshots; an older, slower storage commit must not overwrite a newer heartbeat.
  hbPersistPending = hbPersistPending.catch(() => {}).then(async () => {
    // Ownership can change while an earlier storage operation is pending.
    if (!hbMem || hbMem.tab !== snapshot.tab || hbMem.t > snapshot.t) {
      if (hbMem?.tab !== snapshot.tab) return;
      snapshot = { ...hbMem };
    }
    await chrome.storage.local.set({ hbBg: { ...snapshot } });
    hbPersistedAt = Date.now(); // only successful writes suppress the next attempt
  });
  return hbPersistPending;
}
function noteAlive(tabId, page) {
  if (tabId == null) return;
  const now = Date.now(), changedTab = hbMem?.tab !== tabId;
  hbMem = { tab: tabId, t: now, page: String(page || '').slice(0, 120) };
  if (changedTab || now - hbPersistedAt >= 10000) return persistHeartbeat({ ...hbMem });
  return Promise.resolve();
}
// Chrome MV3: scheduled alarms may be absent after browser restart/update.
// Ensure watchdog scheduling on worker wake-up, browser start and extension install.
async function ensureWatchdogAlarm() {
  try {
    const alarm = await chrome.alarms.get('l2watch');
    if (!alarm) await chrome.alarms.create('l2watch', { periodInMinutes: 1 });
  } catch (e) { console.warn('[L2bot] watchdog alarm:', e); }
}
void ensureWatchdogAlarm();
// 7.2.5 (игрок 10.10, скрин 502: «сервер уходит в перезагрузку — бот должен восстанавливаться и продолжать задачу»):
// при долгом простое браузер может показать свою страницу ошибки — там скрипт бота не работает, вкладка «молчит», и сторож
// после 3 перезагрузок за 20 мин ВЫКЛЮЧАЛ бота. Теперь сторож сначала спрашивает сервер: лежит — перезагружает вкладку раз
// в 2 мин и не считает это попыткой (бота не выключает никогда); сервер снова ответил — перезагружает сразу, задача продолжается
// (вкладка открывается на той же странице, состояние задачи в памяти бота)
function wdPlan(o) {
  const { quiet, recent = [], fish, srv, downLast = 0, wasDown, now } = o;
  if (quiet < 150000) return { act: 'none' };
  if (srv === 'down') return now - downLast >= 120000 ? { act: 'reload', down: true } : { act: 'none', down: true };
  if (wasDown) return { act: 'reload', back: true };                                   // сервер ожил — сразу на страницу задачи
  if (recent.length >= 3 && fish) return now - Math.max(...recent) < 5 * 60000 ? { act: 'none' } : { act: 'fishReload', count: true };
  if (recent.length >= 3) return { act: 'stop' };
  return { act: 'reload', count: true };
}
async function srvProbe(origin) {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), 8000);
  try { const r = await fetch(origin + '/game/time', { cache: 'no-store', credentials: 'include', signal: c.signal }); return r.status < 500 && !(r.status === 200 && !/json/i.test(r.headers.get('content-type') || '')) ? 'up' : 'down'; }   // 8.0: 200 + HTML = страница техработ
  catch (e) { return 'down'; } finally { clearTimeout(tm); }
}
chrome.runtime.onStartup.addListener(() => { void ensureWatchdogAlarm(); });
let watchdogRunning = false;
chrome.alarms?.onAlarm.addListener(async a => {
  if (a.name !== 'l2watch' || watchdogRunning) return;
  watchdogRunning = true;
  const generation = serializeLock.controlSeq || 0;
  try {
    const before = await serializeLock(async () => {
      const state = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown', 'rt']);
      const hb = hbMem && hbMem.t >= (state.hbBg?.t || 0) ? hbMem : state.hbBg;
      if (!state.on || !Number.isInteger(hb?.tab) || state.lock?.k !== 'tab' + hb.tab) return null;
      const quiet = Date.now() - hb.t, wdDown = state.wdDown;
      if (quiet < 150000) {
        // 20.13 (шаг 5, core-b/F4): после перезагрузки бот снова пульсирует ≥3 мин — перезагрузка помогла, счётчик «3 за 20 мин» сбрасываем
        const healed = wdHealed(state.wdog, hb.t), patch = { ...(wdDown ? { wdDown: null } : {}), ...(healed ? { wdog: [] } : {}) };
        if (Object.keys(patch).length) await chrome.storage.local.set(patch);
        return;
      }
      return state;
    });
    if (!before) return;
    let { on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null, rt = {} } = before;
    let hb = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
    let now = Date.now(), quiet = now - hb.t, tab;
    try { tab = await chrome.tabs.get(hb.tab); } catch (_) { return; }
    let origin;
    try {
      const url = new URL(tab.pendingUrl || tab.url);
      if (url.protocol !== 'https:' || !/(^|\.)l2wap\.com$/i.test(url.hostname)) return;
      origin = url.origin;
    } catch (_) { return; }
    const ev = { t: now, src: 'S', kind: 'сторож', what: '', st: '' };
    // Сеть не держит очередь записей: Stop/heartbeat/новый хозяин обрабатываются сразу.
    const server = await srvProbe(origin);
    await serializeLock(async () => {
      const stillCurrent = async () => {
        if ((serializeLock.controlSeq || 0) !== generation) return false;
        let latestTab; try { latestTab = await chrome.tabs.get(tab.id); } catch (_) { return false; }
        if ((latestTab.pendingUrl || latestTab.url) !== (tab.pendingUrl || tab.url)) return false;
        const state = await chrome.storage.local.get(['on', 'lock', 'rt', 'hbBg']);
        const h = hbMem && hbMem.t >= (state.hbBg?.t || 0) ? hbMem : state.hbBg;
        return (serializeLock.controlSeq || 0) === generation && !!state.on && state.lock?.k === lock?.k && state.lock?.epoch === lock?.epoch && h?.tab === hb.tab && h.t === hbMem?.t
          && state.rt?.char === rt.char && (state.rt?.manualKickAt || 0) === (rt.manualKickAt || 0);
      };
      const persist = async (patch, nextHb) => {
        await chrome.storage.local.set({ ...patch, hbBg: { ...nextHb } });
        hbMem = nextHb; hbPersistedAt = Date.now();
      };
      // 15.10: сетевой probe может занять 8 с. Stop, новый хозяин или свежий heartbeat отменяют прежнее решение.
      ({ on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null, rt = {} } = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown', 'rt']));
      hb = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
      if ((serializeLock.controlSeq || 0) !== generation || !on || lock?.k !== before.lock?.k || lock?.epoch !== before.lock?.epoch || lock?.k !== 'tab' + tab.id || hb?.tab !== tab.id || rt.char !== before.rt?.char || (rt.manualKickAt || 0) !== (before.rt?.manualKickAt || 0)) return;
      let currentTab; try { currentTab = await chrome.tabs.get(tab.id); } catch (_) { return; }
      if ((serializeLock.controlSeq || 0) !== generation || (currentTab.pendingUrl || currentTab.url) !== (tab.pendingUrl || tab.url)) return;
      now = Date.now(); quiet = now - hb.t;
      if (quiet < 150000) return;
      const recent = wdog.filter(t => now - t < 20 * 60000);
      const fishMode = Array.isArray(cfg.autoTasks) ? globalThis.L2EngineCore?.selectedTask(cfg, rt, now) === 'fish' : !!cfg.fishMode;
      const plan = wdPlan({ quiet, recent, fish: fishMode, srv: server, downLast: wdDown?.last || 0, wasDown: !!wdDown, now });
      if (plan.down) {                                     // сервер лежит: не попытка, не остановка
        if (plan.act !== 'reload') return;
        ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}), сервер игры не отвечает — перезагружаю вкладку раз в 2 мин, бота не останавливаю`;
        if (!wdDown) { buf.push(ev); flush(); }            // в журнал — только начало простоя
        await persist({ wdDown: { since: wdDown?.since || now, last: now } }, { tab: hb.tab, t: now - 60000, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
        return;
      }
      if (plan.back) {
        ev.what = `сервер игры снова отвечает (простой ${Math.round((now - (wdDown.since || now)) / 60000)} мин) — перезагружаю вкладку, бот продолжает задачу`;
        buf.push(ev); flush();
        await persist({ wdDown: null }, { tab: hb.tab, t: now, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
        return;
      }
      // рыбалка (v4.49): не останавливаем никогда — после 3 перезагрузок за 20 мин просто перезагружаем реже (раз в 5 мин)
      if (recent.length >= 3 && fishMode) {
        if (now - Math.max(...recent) < 5 * 60000) return;
        ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}) — рыбалка: перезагружаю вкладку (раз в 5 мин, не останавливаю)`;
        buf.push(ev); flush();
        await persist({ wdog: [...recent, now] }, { tab: hb.tab, t: now, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.update(hb.tab, { url: origin + '/fishing.html' }); } catch (e) { if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e2) {} }
        return;
      }
      if (recent.length >= 3) {
        ev.what = `бот молчит ${Math.round(quiet / 1000)} с, 3 перезагрузки за 20 мин не помогли — останавливаю`;
        buf.push(ev); flush();
        await chrome.storage.local.set({ on: false, wdog: recent, stopMeta: { source: 'watchdog', reason: ev.what, t: Date.now() } });
        return;
      }
      ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}) — перезагружаю вкладку ${recent.length + 1}/3`;
      buf.push(ev); flush();
      await persist({ wdog: [...recent, now] }, { tab: hb.tab, t: now, page: hb.page }); // дать странице время загрузиться
      if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
    });
  } catch (e) { console.warn('[L2bot] сторож: восстановление отложено', e); }
  finally { watchdogRunning = false; }
});

// 20.13 (ревизия 17.10, шаг 5, core-b/F4): Chrome Energy/Memory Saver или игра подвешивали скрытую вкладку раз в несколько минут —
// каждая перезагрузка возвращала работу, но третья за 20 мин выключала бота на всю ночь. Перезагрузка, после которой пульс шёл ещё
// ≥ 3 мин, считается удачной и из счётчика уходит; стоп остаётся для перезагрузок подряд, которые не помогли.
const WD_HEAL_MS = 180000;
function wdHealed(wdog, hbT) {
  if (!Array.isArray(wdog) || !wdog.length || !Number.isFinite(hbT)) return false;
  return hbT - Math.max(...wdog) >= WD_HEAL_MS;
}
// Release immediately when the owning tab is closed (no 90-second stale lock).
chrome.tabs.onRemoved.addListener(tabId => {
  serializeLock(async () => {
    const { lock } = await chrome.storage.local.get('lock');
    if (lock?.tab === tabId) await chrome.storage.local.set({ lock: null, hbBg: null });
    if (hbMem?.tab === tabId) { hbMem = null; hbPersistedAt = 0; }
  }).catch(e => console.warn('[L2bot] lock tab close', e));
});

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'faBuffEvidence') {
    let game = false; try { game = /(^|\.)l2wap\.com$/i.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (_) {}
    if (!game || !Number.isInteger(_s?.tab?.id) || _s.frameId > 0 || (_s.id && _s.id !== chrome.runtime.id)) { reply(null); return true; }
    faBuffEvidence(m.p).then(reply).catch(() => reply(null));
    return true;
  }
  if (m?.cmd === 'fishingCastEvidence') {
    let game = false; try { game = /(^|\.)l2wap\.com$/i.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (_) {}
    if (!game || !Number.isInteger(_s?.tab?.id) || _s.frameId > 0 || (_s.id && _s.id !== chrome.runtime.id)) { reply(null); return true; }
    fishingCastEvidence(m.at).then(reply).catch(() => reply(null));
    return true;
  }
  if (m?.cmd?.startsWith('lock') && ['lockAcquire', 'lockRenew', 'lockRelease', 'lockCheck'].includes(m.cmd)) {
    lockCommand(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'statePatch') {
    statePatch(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  // 10.0.3: Alt+R на странице игры — таймеры боссов из файла слежки (только ключ rbTimer, только со страницы игры)
  if (m?.cmd === 'rbtImport') {
    let game = false; try { game = /(^|\.)l2wap\.com$/.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (e) {}
    const T = m.rbTimer;
    if (!game || !T || typeof T !== 'object' || Array.isArray(T) || !T.b || typeof T.b !== 'object') { reply({ ok: false, reason: 'invalid' }); return true; }
    serializeLock(async () => { const { rt = {} } = await chrome.storage.local.get('rt');
      if (m.expectedChar != null && String(rt.char || '') !== m.expectedChar) return { ok: false, reason: 'Персонаж изменился — повторите импорт' };
      const rbTimer = mergeTimerPatch(rt.rbTimer, T);
      await chrome.storage.local.set({ rt: { ...rt, rbTimer, _src: 'menu' } }); return { ok: true, rbTimer }; })
      .then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  // 10.0.6: «↺ Новая серия» в окне бота на странице игры — сводка «📦 Серия РБ» обнуляется и без замка вкладки (бот на паузе/стоит);
  // только ключ rbRun и только с l2wap.com (как rbtImport)
  // 10.0.9: кнопки «Торговец/Кузнец Маммона» в окне бота — разовая команда rt.mmGoReq и без замка вкладки; только с l2wap.com, только этот ключ
  if (m?.cmd === 'mmGoSet') {
    let game = false; try { game = /(^|\.)l2wap\.com$/.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (e) {}
    const R = m.mmGoReq;
    if (!game || !R || typeof R !== 'object' || Array.isArray(R) || R.kind !== 'visit' || !['order', 'smith'].includes(R.npc) || !(+R.t > 0)) { reply({ ok: false, reason: 'invalid' }); return true; }
    serializeLock(async () => { const { rt = {} } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, mmGoReq: { kind: 'visit', npc: R.npc, t: +R.t }, mmGoSay: null, _src: 'menu' } }); return { ok: true }; })
      .then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  // 20.12 (ревизия 17.10, UI-10): ◀/▶ дока во вкладке без замка (бот работает в другой вкладке или аренда истекла) — statePatch отвечал
  // ownership_lost, и меню молча не сворачивалось. Свёрнутость — настройка вида, пишется отдельно, только этот ключ, только со страницы игры.
  if (m?.cmd === 'dockMinSet') {
    let game = false; try { game = /(^|\.)l2wap\.com$/.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (e) {}
    if (!game || typeof m.dockMin !== 'boolean') { reply({ ok: false, reason: 'invalid' }); return true; }
    serializeLock(async () => { const { cfg = {} } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, dockMin: m.dockMin } }); return { ok: true }; })
      .then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  // 20.12 (ревизия 17.10, UI-4): импорт файла настроек — через ту же очередь фона, что и записи меню и вкладки (раньше напрямую в storage
  // мимо очереди: работающий бот затирал импорт или импорт — свежие записи бота). Ключи проверяет меню по своему списку (cfgImportClean).
  if (m?.cmd === 'cfgImport') {
    let fromPopup = false;
    try { const src = new URL(_s?.url || ''), expected = new URL(chrome.runtime.getURL('popup.html')); fromPopup = src.origin === expected.origin && src.pathname === expected.pathname; } catch (e) {}
    const okObj = p => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length <= MAX_PATCH_KEYS && Object.keys(p).every(k => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k));
    const per = m.perChar && typeof m.perChar === 'object' && !Array.isArray(m.perChar) ? m.perChar : {};
    if (!fromPopup || !okObj(m.cfg) || Object.keys(per).length > 50 || !Object.entries(per).every(([k, v]) => /^cfg@[^\s]{1,100}$/.test(k) && okObj(v))) { reply({ ok: false, reason: 'invalid' }); return true; }
    serializeLock(async () => {
      const keys = ['cfg', ...Object.keys(per)], state = await chrome.storage.local.get(keys), change = { cfg: { ...(state.cfg || {}), ...m.cfg } };
      for (const [k, v] of Object.entries(per)) change[k] = { ...(state[k] && typeof state[k] === 'object' ? state[k] : {}), ...v };
      await chrome.storage.local.set(change); return { ok: true };
    }).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'rbRunSet') {
    let game = false; try { game = /(^|\.)l2wap\.com$/.test(new URL(_s?.url || _s?.tab?.url || '').hostname); } catch (e) {}
    const R = m.rbRun;
    if (!game || !R || typeof R !== 'object' || Array.isArray(R) || !(+R.t0 > 0) || Object.keys(R).length > 20) { reply({ ok: false, reason: 'invalid' }); return true; }
    serializeLock(async () => { const { rt = {} } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, rbRun: R, _src: 'menu' } }); return { ok: true }; })
      .then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'menuPatch') {
    menuPatch(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'paymentDismiss') {
    paymentDismiss(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'botControl') {
    botControl(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'charSwitch') {
    switchCharacter(m, _s).then(reply).catch(e => reply({ ok: false, reason: String(e) }));
    return true;
  }
  if (m?.cmd === 'hb') {
    serializeLock(async () => {
      const { lock, on } = await chrome.storage.local.get(['lock', 'on']);
      const valid = !!on && _s?.tab && _s.frameId === 0 && lock?.k === 'tab' + _s.tab.id &&
        !!m.epoch && m.epoch === lock.epoch && Date.now() - lock.t < LOCK_TTL;
      if (valid) await noteAlive(_s.tab.id, m.page);
      // 8.0 (аудит ядра): во вкладке в фоне таймер продления замка срабатывает раз в минуту — долгий бой с РБ/рыбалка могли не успеть
      // продлить замок до 90 с. Сигнал «жив» от хозяина продлевает замок сам (не чаще раза в 20 с)
      if (valid && Date.now() - lock.t > 20000) await chrome.storage.local.set({ lock: { ...lock, t: Date.now() } });
      return { ok: !!valid };
    }).then(reply).catch(() => reply({ ok: false }));
    return true;
  }
  if (m?.cmd === 'tabId') { try { reply(_s?.tab?.id ?? null); } catch (e) {} return; }   // v5.6: ключ вкладки для замока «один бот»
  if (m?.cmd === 'sleep') { setTimeout(() => { try { reply(true); } catch (e) {} }, Math.min(Math.max(+m.ms || 0, 0), 120000)); return true; }
  // v5.5.6: «позвать игрока» — антибот-проверка игры (её решает только человек) / блок PvE-фарма
  if (m?.cmd === 'alert') {
    try { chrome.notifications?.create('l2bot-' + (m.id || 'alert'), { type: 'basic', iconUrl: 'icons/128.png', title: m.title || 'L2wap Bot', message: m.text || '', priority: 2, requireInteraction: !!m.sticky }); } catch (e) {}
    try { chrome.action?.setBadgeText?.({ text: m.badge || '!' })?.catch?.(() => {}); chrome.action?.setBadgeBackgroundColor?.({ color: '#c0392b' })?.catch?.(() => {}); } catch (e) {}
  }
  if (m?.cmd === 'alertClear') { try { chrome.notifications?.clear('l2bot-' + (m.id || 'alert')); chrome.storage.local.get('on').then(s => paint(s.on)); } catch (e) {} }   // v5.6: значок по факту «работает/стоит»
  if (m?.cmd === 'rec') { buf.push(m.ev); if (!timer) timer = setTimeout(flush, 1500); }
  if (m?.cmd === 'snap' && m.key && m.html) addSnap(m);
  if (m?.cmd === 'shot' && _s?.tab) addShot(_s.tab, m);
  if (m?.cmd === 'snapHas') {                  // есть ли уже такой снимок (чтобы не гонять разметку зря)
    idb().then(db => {
      const r = db.transaction('snaps').objectStore('snaps').getKey(m.key);
      r.onsuccess = () => reply(r.result != null);
      r.onerror = () => reply(true);
    }).catch(() => reply(true));
    return true;
  }
});

// перенос журнала и снимков из старых версий (chrome.storage → IndexedDB)
(async () => {
  const { reclog, snaps } = await chrome.storage.local.get(['reclog', 'snaps']);
  if (Array.isArray(reclog) && reclog.length) { buf = reclog.concat(buf); flush(); }
  if (snaps && typeof snaps === 'object') Object.entries(snaps).forEach(([k, v]) => v?.html && addSnap({ key: 'v1:' + k, state: k, html: v.html }));
  if (reclog || snaps) await chrome.storage.local.remove(['reclog', 'snaps']);
})();
