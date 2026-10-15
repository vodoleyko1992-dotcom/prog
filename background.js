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
    return { ok: true, key, epoch, changed };
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
      nextCfg = { ...previousCfg };
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
  paint(ch.on.newValue);
  if (ch.on.newValue) chrome.storage.local.get('hbBg').then(({ hbBg }) => {   // старт — отсчёт сторожа заново
    const h = hbMem || hbBg; if (!h) return;
    hbMem = { ...h, t: Date.now() }; chrome.storage.local.set({ hbBg: { ...hbMem }, wdog: [], wdDown: null }).then(() => { hbPersistedAt = Date.now(); }).catch(() => {});   // ручной старт — счёт перезагрузок с нуля; 8.0: старая метка простоя сервера — не после нового старта (10.0: комментарий съедал .then/.catch)
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
    if (empty(cur.cfg)) { set.cfg = { ...base.cfg }; done.push('настройки'); }
    const curChar = String(cur.rt?.char || '').trim();
    for (const n of nicks) {
      let R = base.chars[n]?.rt; if (empty(R)) continue;
      // 7.2 (лог 10.10 20:08): снаряжение и панель из базового профиля устаревают (там было «надето: Посох життя D» — куплены D-заряды
      // при посохе C). Не переносим: бот сам прочитает инвентарь и панель до закупки
      R = Object.fromEntries(Object.entries(R).filter(([k]) => !['weapons', 'weaponRec', 'weaponEq', 'weaponNow', 'weaponsT', 'panel', 'panelSig'].includes(k)));
      if (empty(cur.rt) || (curChar === n && !cur.rt.skills)) {          // нет текущей памяти (или она пустая у этого же героя)
        set.rt = { ...(cur.rt || {}), ...R, char: n }; done.push('память ' + n);
      } else if (curChar !== n && empty(cur['rt@' + n])) {               // герой сейчас другой — его память ждёт в rt@Ник
        set['rt@' + n] = { ...R, char: n }; done.push('память ' + n + ' (для смены героя)');
      }
      if (curChar !== n && empty(cur['cfg@' + n])) set['cfg@' + n] = { ...base.cfg };
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
  const { on = false } = await chrome.storage.local.get('on');
  await chrome.storage.local.set({ on: !on, ...(!on ? {} : { stopMeta: { source: 'hotkey', reason: 'Горячая клавиша Alt+Shift+B', t: Date.now() } }) });
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
chrome.alarms?.onAlarm.addListener(async a => {
  if (a.name !== 'l2watch') return;
  const before = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown']);
  let { on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null } = before;
  let hb = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
  // Не перезагружать вкладку-ожидателя: сторож следит только за владельцем замка.
  if (!on || !Number.isInteger(hb?.tab) || lock?.k !== 'tab' + hb.tab) return;
  let now = Date.now(), quiet = now - hb.t;
  if (quiet < 150000) { if (wdDown) await chrome.storage.local.set({ wdDown: null }); return; }   // 7.2.5: вкладка ожила сама — простой окончен
  let tab = null;
  try { tab = await chrome.tabs.get(hb.tab); } catch (e) {}
  if (!tab || !/l2wap\.com/.test(tab.url || tab.pendingUrl || '')) return;     // вкладку закрыли или ушли с сайта — не трогаем
  const ev = { t: now, src: 'S', kind: 'сторож', what: '', st: '' };
  const origin = new URL(tab.url || tab.pendingUrl).origin;
  const server = await srvProbe(origin);
  // 15.10: сетевой probe может занять 8 с. Stop, новый хозяин или свежий heartbeat отменяют прежнее решение.
  ({ on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null } = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown']));
  hb = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
  if (!on || lock?.k !== before.lock?.k || lock?.epoch !== before.lock?.epoch || lock?.k !== 'tab' + tab.id || hb?.tab !== tab.id) return;
  now = Date.now(); quiet = now - hb.t;
  if (quiet < 150000) return;
  const recent = wdog.filter(t => now - t < 20 * 60000);
  const plan = wdPlan({ quiet, recent, fish: !!cfg.fishMode, srv: server, downLast: wdDown?.last || 0, wasDown: !!wdDown, now });
  if (plan.down) {                                     // сервер лежит: не попытка, не остановка
    if (plan.act !== 'reload') return;
    ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}), сервер игры не отвечает — перезагружаю вкладку раз в 2 мин, бота не останавливаю`;
    if (!wdDown) { buf.push(ev); flush(); }            // в журнал — только начало простоя
    hbMem = { tab: hb.tab, t: now - 60000, page: hb.page };
    await chrome.storage.local.set({ wdDown: { since: wdDown?.since || now, last: now }, hbBg: { ...hbMem } }); hbPersistedAt = Date.now();
    try { await chrome.tabs.reload(hb.tab); } catch (e) {}
    return;
  }
  if (plan.back) {
    ev.what = `сервер игры снова отвечает (простой ${Math.round((now - (wdDown.since || now)) / 60000)} мин) — перезагружаю вкладку, бот продолжает задачу`;
    buf.push(ev); flush();
    hbMem = { tab: hb.tab, t: now, page: hb.page };
    await chrome.storage.local.set({ wdDown: null, hbBg: { ...hbMem } }); hbPersistedAt = Date.now();
    try { await chrome.tabs.reload(hb.tab); } catch (e) {}
    return;
  }
  // рыбалка (v4.49): не останавливаем никогда — после 3 перезагрузок за 20 мин просто перезагружаем реже (раз в 5 мин)
  if (recent.length >= 3 && cfg.fishMode) {
    if (now - Math.max(...recent) < 5 * 60000) return;
    ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}) — рыбалка: перезагружаю вкладку (раз в 5 мин, не останавливаю)`;
    buf.push(ev); flush();
    hbMem = { tab: hb.tab, t: now, page: hb.page };
    await chrome.storage.local.set({ wdog: [...recent, now], hbBg: { ...hbMem } }); hbPersistedAt = Date.now();
    try { await chrome.tabs.update(hb.tab, { url: new URL(tab.url || tab.pendingUrl).origin + '/fishing.html' }); } catch (e) { try { await chrome.tabs.reload(hb.tab); } catch (e2) {} }
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
  hbMem = { tab: hb.tab, t: now, page: hb.page };      // дать странице время загрузиться
  await chrome.storage.local.set({ wdog: [...recent, now], hbBg: { ...hbMem } }); hbPersistedAt = Date.now();
  try { await chrome.tabs.reload(hb.tab); } catch (e) {}
});

// Release immediately when the owning tab is closed (no 90-second stale lock).
chrome.tabs.onRemoved.addListener(tabId => {
  serializeLock(async () => {
    const { lock } = await chrome.storage.local.get('lock');
    if (lock?.tab === tabId) await chrome.storage.local.set({ lock: null, hbBg: null });
    if (hbMem?.tab === tabId) { hbMem = null; hbPersistedAt = 0; }
  }).catch(e => console.warn('[L2bot] lock tab close', e));
});

chrome.runtime.onMessage.addListener((m, _s, reply) => {
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
