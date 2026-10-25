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
      if (m.onlyStopped) {
        const state = await chrome.storage.local.get(['on', 'rt']);
        if (state.on || String(state.rt?.char || '') !== String(m.expectedChar || '') || (+state.rt?.manualKickAt || 0) !== (+m.expectedKick || 0))
          return { ok: false, reason: 'session_changed' };
      }
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
    // 19.10.2026 (аудит автономности): возврат своего протухшего замка сохраняет epoch.
    // Иначе storage.onChanged до ответа IPC принимал его за чужую передачу и стирал очередь.
    // Новый документ без epoch и другая вкладка по-прежнему получают новое поколение.
    const resumed = !!(mine && m.epoch && lock?.epoch === m.epoch);
    const epoch = resumed ? lock.epoch : makeLease();
    await chrome.storage.local.set({ lock: { k: key, epoch, t: now,
      url: String(m.page || '').slice(0, 120), vis: m.vis === true, tab } });
    if (changed) await noteAlive(tab, m.page || '');
    // 8.0 (аудит ядра): режим экономии памяти Chrome может выгрузить фоновую вкладку — вкладку бота не выгружать
    if (changed) try { await chrome.tabs.update(tab, { autoDiscardable: false }); } catch (e) {}
    // 20.13 (шаг 5, core-b/F6): тот же документ вернул свой же (только протухший) замок — между продлениями хозяина не было,
    // вкладка может дописать свою очередь записей, а не выбрасывать её
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
const dailyQuotaDay = (now,rt) => L2EngineCore.dailyDay(now,rt);
const dailyQuotaToday = (rt,now) => L2EngineCore.dailyQuotaToday(rt,now);
// 20.8: диапазон выбирается один раз; фактическая цель остаётся в прежнем cfg-ключе.
const RANGE_LIMITS = {dailyFishLimit:'daily',dailyKillLimit:'daily',autoKillLimit:'auto',catKillLimit:'cat',fishMaxCasts:'casts'};
const quotaRandom = (min,max) => Math.min(max,min+Math.floor(Math.random()*(max-min+1)));
function limitRangeChange(state,now,options={}) {
  const cfg={...(state.cfg||{})},rt={...(state.rt||{})},ranges={...(cfg.limitRanges||{})},rolls={...(rt.limitRolls||{})};
  if(rt.dailyQuota)rt.dailyQuota=dailyQuotaToday(rt,now);
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
    const kind=RANGE_LIMITS[key];
    if(kind==='daily' && rolls[key]?.basis!=='server' && L2EngineCore.dailyCurrent(rolls[key],rt,now))rolls[key]={...rolls[key],day:dailyQuotaDay(now,rt),basis:'server'};
    const old=rolls[key],row=rt.farmQuota?.[kind],enabled=Array.isArray(cfg.autoTasks)?cfg.autoTasks.includes(kind):cfg[kind==='auto'?'zoneAuto':'catMode']===true;
    const renew=!old || old.min!==b.min || old.max!==b.max || old.value!==cfg[key] || old.value<b.min || old.value>b.max
      || kind==='daily' && !options.deferDaily && old.day!==dailyQuotaDay(now,rt) || ['auto','cat'].includes(kind) && (options.resetFarmQuota===kind || row?.done && enabled)
      || kind==='casts' && options.resetCasts;
    if(!renew)continue;
    const value=quotaRandom(b.min,b.max);cfg[key]=value;
    rolls[key]={...b,value,day:kind==='daily'?dailyQuotaDay(now,rt):'',...(kind==='daily'?{basis:'server'}:{}),t:now,seq:(old?.seq||0)+1};
    if(['auto','cat'].includes(kind))rt.farmQuota={...(rt.farmQuota||{}),[kind]:{run:(row?.run||0)+1,limit:value,got:0}};
  }
  cfg.limitRanges=ranges;rt.limitRolls=rolls;return {ok:true,cfg,rt,dropped};
}
// 20.12 (ревизия 17.10, UI-2): ключа дневного лимита нет в сохранённых настройках — у вкладки действует её заводское значение
// (DEF_CFG), фон сверяет с ним же. Раньше расхождение незаметно закрывала запись всей формы при Старте; без неё рыбалка и охота
// ждали «daily_fish_interrupted» / «quota_changed» вечно. Явно сохранённое число по-прежнему сверяется строго.
const dailyLimitOf = (cfg, key, tabLimit) => cfg?.[key] === undefined ? farmQuotaLimit(tabLimit) : farmQuotaLimit(cfg[key]);
// 19.10: перед новой охотой/рыбалкой учитываем полный score дейликов, включая добытое без бота.
function dailyServerChange(state,E,now) {
  const rt=state.rt||{},clock=L2EngineCore.serverClockNote(E?.clock,E?.clockAt),integer=x=>Number.isSafeInteger(x)&&x>=0;
  if(!state.on || (rt.manualKickAt||0)!==(E?.kick||0) || (rt.dailyStart||0)!==(E?.start||0))return {ok:false,reason:'daily_start_interrupted'};
  const next={...rt,serverClock:clock},day=clock&&L2EngineCore.dailyDay(now,next),key=String(E?.daily?.dayKey||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  const tasks=E?.daily?.tasks,mobs=tasks?.hunt_start_500?.score,fish=tasks?.fishing_catch_50?.score;
  if(!clock || !Number.isFinite(E.clockAt) || E.clockAt>now || now-E.clockAt>60000 || key!==day || !integer(mobs) || !integer(fish))return {ok:false,reason:'daily_start_snapshot'};
  const dailyQuota=dailyQuotaToday(next,now),local=(dailyQuota.auto||0)+(dailyQuota.cat||0)+(dailyQuota.raid||0);
  dailyQuota.server=Math.max(dailyQuota.server||0,mobs-local,0);dailyQuota.fish=Math.max(dailyQuota.fish||0,fish);
  const clean={};for(const [id,r] of Object.entries(tasks))if(r&&typeof r==='object'&&!['__proto__','prototype','constructor'].includes(id))clean[id]={have:+r.have||0,need:+r.need||0,score:+r.score||0,done:!!r.done,claimed:!!r.claimed,place:r.place??null};
  const daily={day:String(E.daily.dayKey),t:now,tasks:clean},dailyServerCheck={day,char:rt.char||'',start:rt.dailyStart||0,t:now};
  // 20.43: цель рыбалки — на игровые сутки. После сброса сервера (новый dayKey) — новая цель: диапазон «от–до» выбирает новое
  // число, счёт с нуля. Цель без дня (до 20.43): выполненная — обновляется, незавершённая — получает текущий день без сброса счёта.
  const T=rt.fishTgt;
  if(T&&typeof T==='object'&&T.day!==day) {
    if(T.day||T.done){const ranged=Number.isSafeInteger(T.min)&&Number.isSafeInteger(T.max)&&T.min>=1&&T.max>=T.min;
      next.fishTgt={type:T.type,n:ranged?quotaRandom(T.min,T.max):T.n,...(ranged?{min:T.min,max:T.max}:{}),got:0,t:now,day,renewFrom:T.day||null};}
    else next.fishTgt={...T,day};
  }
  return {ok:true,rt:{...next,dailyQuota,daily,dailyServerCheck,dailyFishMark:{t0:+rt.fish?.t0||0,caught:+rt.fish?.caught||0},_src:'daily-server'}};
}
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
  const dailyLimit=dailyLimitOf(cfg,'dailyKillLimit',E?.dailyLimit),dailyMobs=q=>(q.auto||0)+(q.cat||0)+(q.raid||0)+(q.server||0);   // 20.12: нет ключа — значение вкладки
  if (!enabled || !(limit || dailyLimit) || limit !== E.limit || dailyLimit !== (E.dailyLimit||0)) return { ok: false, reason: 'quota_changed' };
  const old = rt.farmQuota?.[E.task], count = x => Number.isSafeInteger(x) && x >= 0;
  // 18.10, журнал 13:34: подтверждённые дополнительные цели — нижняя граница. Общая отметка обеих охот
  // резервирует уже учтённых мобов: запоздавший рост сервера не считается второй раз после reload/сброса/полуночи.
  let mark = rt.farmKillMark, row = old, dailyQuota=dailyQuotaToday(rt,now), kills = count(rt.kills) ? rt.kills : 0;
  if (!mark || !count(mark.counter) || !Number.isSafeInteger(mark.revision) || !count(mark.floor) || mark.floor < mark.counter) mark = null;
  const startMark = (counter,revision) => !mark || revision > mark.revision && counter < mark.counter
    ? {counter,revision,floor:counter} : {...mark,counter,revision,floor:Math.max(mark.floor,counter)};
  const session = (baseline,t0,delta) => { if(count(baseline) && t0 === (rt.sessT0 ?? null) && count(baseline+delta))kills=Math.max(kills,baseline+delta); };
  if (E.op === 'begin') {
    if (!count(E.counter) || !Number.isSafeInteger(E.revision) || typeof E.spawn !== 'string' || !E.spawn || E.spawn.length > 160) return { ok: false, reason: 'quota_snapshot' };
    if (!row || row.limit !== limit || row.done) row = { run: (old?.run || 0) + 1, limit, got: 0 };
    // Reload активного боя сохраняет исходную точку, включая уже убитых соседей и начало счётчика сессии.
    if (!row.pending || row.pending.spawn !== E.spawn) {
      if (mark && (E.revision < mark.revision || E.revision === mark.revision && E.counter < mark.counter)) return {ok:false,reason:'quota_snapshot'};
      mark = startMark(E.counter,E.revision);
      row = { ...row, pending: { spawn:E.spawn,counter:E.counter,revision:E.revision,kick:E.kick||0,floor:mark.floor,...(count(E.sessionKills)?{sessionKills:E.sessionKills,sessionT0:E.sessionT0 ?? null}:{}) } };
    } else row = { ...row, pending: { ...row.pending, kick: E.kick || 0 } };
  } else if (E.op === 'win') {
    if (!row || row.run !== E.run || row.done || row.pending?.spawn !== E.spawn || row.pending?.revision !== E.beforeRevision || row.pending.kick !== (E.kick || 0)) return { ok: false, reason: 'quota_battle_changed' };
    const observed = count(E.seen) && E.seen <= 200 ? E.seen : 0, p = row.pending;
    if (E.seen !== undefined && (!count(E.seen) || E.seen > 200)) return {ok:false,reason:'quota_snapshot'};
    if (!count(E.counter) || !Number.isSafeInteger(E.revision) || E.revision <= p.revision || !E.lost && !observed && E.counter <= p.counter) return { ok: false, reason: 'quota_unconfirmed' };
    if (mark && E.revision < mark.revision) return {ok:false,reason:'quota_snapshot'};
    const reset = E.counter < p.counter, floor = Math.max(count(p.floor)?p.floor:p.counter,mark?.floor||0);
    const delta = Math.max(reset ? 0 : E.counter-floor,observed), got=row.got+delta;
    // При обнулении серверной статистики прежний прогресс квоты сохраняется, старая шкала больше неприменима.
    mark = {counter:E.counter,revision:E.revision,floor:reset?Math.max(E.counter,observed):Math.max(floor+delta,E.counter)};
    session(p.sessionKills,p.sessionT0 ?? null,delta);
    if(dailyLimit)dailyQuota[E.task]=(dailyQuota[E.task]||0)+delta;
    row = { ...row, got, pending: null, done: limit > 0 && got >= limit, ...(limit > 0 && got >= limit ? { doneT: now } : {}) };
  } else if (E.op === 'approx') {
    // Счётчик сервера недоступен: подтверждённые убийства не теряем, а поздний ответ не зачтёт их повторно.
    if (!count(E.n) || E.n > 200 || typeof E.spawn !== 'string' || !E.spawn) return { ok: false, reason: 'quota_snapshot' };
    if (E.approxId !== undefined && (typeof E.approxId !== 'string' || E.approxId.length > 240)) return {ok:false,reason:'quota_snapshot'};
    const duplicate = typeof E.approxId === 'string' && row?.approxIds?.includes(E.approxId);
    if (!duplicate && E.run !== undefined && row && E.run !== row.run && !(E.run === 0 && row.run === 1 && row.pending?.spawn === E.spawn && row.pending?.revision === E.beforeRevision)) return {ok:false,reason:'quota_battle_changed'};
    if (!duplicate) {
      if (E.close && (!row || row.done || row.pending?.spawn !== E.spawn || E.beforeRevision !== undefined && row.pending?.revision !== E.beforeRevision)) return { ok: false, reason: 'quota_battle_changed' };
      if (!row || row.limit !== limit || row.done) row = { run: (old?.run || 0) + 1, limit, got: 0 };
      const p = row.pending?.spawn === E.spawn ? row.pending : null;
      if (!p && count(E.beforeCounter) && Number.isSafeInteger(E.beforeRevision) && (!mark || E.beforeRevision >= mark.revision)) mark=startMark(E.beforeCounter,E.beforeRevision);
      const floor = Math.max(count(p?.floor)?p.floor:count(p?.counter)?p.counter:0,mark?.floor||0);
      if(mark || p)mark={counter:mark?.counter??p.counter,revision:mark?.revision??p.revision,floor:floor+E.n};
      session(p ? p.sessionKills : E.sessionKills,p ? p.sessionT0 ?? null : E.sessionT0 ?? null,E.n);
      const got = row.got + E.n;
      if (dailyLimit) dailyQuota[E.task] = (dailyQuota[E.task] || 0) + E.n;
      row = { ...row, got, approx:(row.approx||0)+E.n, ...(typeof E.approxId==='string'?{approxIds:[...(row.approxIds||[]),E.approxId].slice(-20)}:{}), pending:E.close||p?null:row.pending||null, done:limit>0&&got>=limit, ...(limit>0&&got>=limit?{doneT:now}:{}) };
    }
  } else return { ok: false, reason: 'quota_operation' };
  const next = { ...cfg };
  if (row.done) {
    next[keys[1]] = false;
    if (Array.isArray(next.autoTasks)) next.autoTasks = next.autoTasks.filter(k => k !== E.task);
    else if (!['enchantMode','craftMode','epicMode','rbHuntMode','fishMode','catMode','campaign','zoneAuto'].some(k => next[k])) next.taskOnly = true;
  }
  return { ok:true,row,kills,...(mark?{farmKillMark:mark}:{}),dailyQuota,dailyDone:dailyLimit>0&&dailyMobs(dailyQuota)>=dailyLimit,cfg:next,rt:{...rt,kills,...(mark?{farmKillMark:mark}:{}),...(dailyLimit?{dailyQuota}:{}),farmQuota:{...(rt.farmQuota||{}),[E.task]:row},_src:'farm-quota'} };
}
// 19.10, РБ: последовательность строк переживает reload/капчу; один и тот же сосед не считается заново.
function raidMobChange(state,E,now) {
  const rt=state.rt||{},cfg=state.cfg||{},integer=x=>Number.isSafeInteger(x)&&x>=0;
  if(!state.on || (rt.manualKickAt||0)!==(E?.kick||0))return {ok:false,reason:'raid_count_interrupted'};
  if(!E || !['begin','count'].includes(E.op) || typeof E.spawn!=='string' || E.spawn.length>160 || !/^l2dop_(?:rb|eg)_/i.test(E.spawn)
      || typeof E.prof!=='string' || E.prof.length>80 || E.prof!==(rt.classCur?.prof||'') || E.slot!==(rt.classCur?.slot??null)
      || !integer(E.seq) || !integer(E.rev) || !Array.isArray(E.deaths) || E.deaths.length>4096
      || E.deaths.some((x,i)=>!integer(x)||x<1||x>E.seq||i>0&&x<=E.deaths[i-1])
      || E.start!=null&&(typeof E.start!=='string'||E.start.length>120))return {ok:false,reason:'raid_count_snapshot'};
  const limit=dailyLimitOf(cfg,'dailyKillLimit',E.dailyLimit);
  if(limit!==E.dailyLimit)return {ok:false,reason:'raid_count_changed'};
  const key=JSON.stringify([E.prof,E.slot,E.spawn]),marks={...(rt.raidMobMarks||{})};let row=marks[key];
  if(row && (!integer(row.seq)||!integer(row.rev)))row=null;
  if(row && E.rev<row.rev)return {ok:false,reason:'raid_count_old'};
  const full=x=>integer(x?.fullN)&&integer(x?.fullSeq)&&x.fullSeq<=x.seq&&x.fullN<=x.fullSeq;
  const base=E.base&&integer(E.base.seq)&&integer(E.base.rev)&&E.base.seq<=E.seq&&E.base.rev<=E.rev?E.base:E;
  const restart=row&&E.rev>row.rev&&((E.start&&E.start!==row.start&&(row.start||E.seq<row.seq||row.done))||row.done&&!E.ended);
  const newEntry=!row||restart;
  if(newEntry)row={seq:base.seq,rev:base.rev,start:E.start||null,absolute:full(base)&&base.fullSeq===base.seq?base.fullN:null,t:now};
  const oldSeq=row.seq;let delta=0;
  if(E.op==='count'&&E.seq>=oldSeq){
    const fresh=E.deaths.filter(x=>x>oldSeq).length,complete=full(E)&&E.fullSeq>=oldSeq;
    const afterFull=complete?E.deaths.filter(x=>x>E.fullSeq).length:0;
    delta=Math.max(fresh,complete&&integer(row.absolute)?Math.max(0,E.fullN-row.absolute)+afterFull:0);
    row={...row,seq:E.seq,rev:E.rev,absolute:complete?Math.max(integer(row.absolute)?row.absolute+delta:0,E.fullN+afterFull):integer(row.absolute)?row.absolute+delta:null,done:!!E.ended,t:now};
  }
  if(!row.start&&E.start)row={...row,start:E.start};marks[key]=row;
  const kept=Object.fromEntries(Object.entries(marks).sort((a,b)=>(b[1]?.t||0)-(a[1]?.t||0)).slice(0,8));
  const dailyQuota=limit?dailyQuotaToday(rt,now):rt.dailyQuota;
  if(limit&&delta)dailyQuota.raid=(dailyQuota.raid||0)+delta;
  const kills=(integer(rt.kills)?rt.kills:0)+(E.sessT0===(rt.sessT0??null)?delta:0);
  // Уже учтённые соседи не должны затем попасть в delta незавершённой квоты автофарма.
  let mark=rt.farmKillMark;
  const counter=integer(E.counter)&&integer(E.counterRevision)&&E.counterRevision>=E.rev;
  if(!mark&&integer(base.counter)&&integer(base.counterRevision))mark={counter:base.counter,revision:base.counterRevision,floor:base.counter};
  if(mark&&integer(mark.counter)&&integer(mark.floor)&&integer(mark.revision)){
    const reset=counter&&E.counterRevision>mark.revision&&E.counter<mark.counter;
    const pending=Object.values(rt.farmQuota||{}).some(x=>x?.pending);
    const baseline=newEntry&&!pending&&integer(base.counter)?Math.max(mark.floor,base.counter):mark.floor;
    mark=reset?{counter:E.counter,revision:E.counterRevision,floor:Math.max(E.counter,delta)}:{...mark,floor:baseline+delta};
  }else mark=null;
  return {ok:true,delta,kills,raidMobMarks:kept,dailyQuota,...(mark?{farmKillMark:mark}:{}),rt:{...rt,kills,raidMobMarks:kept,...(dailyQuota?{dailyQuota}:{}),...(mark?{farmKillMark:mark}:{}),_src:'raid-mobs'}};
}
// 20.23: отмена снятой рейдовой сессии — условное намерение, а не старый снимок.
// Повтор после write_failed не вправе затереть новую сессию, запущенную из меню.
function retireRaidSessionPatch(patch, rt, cfg, now) {
  if (!Object.hasOwn(patch,'retireRaidSession')) return { patch, retired: false };
  const next = { ...patch }, intent = next.retireRaidSession, session = rt.rbSess;
  delete next.retireRaidSession;
  if (!Object.hasOwn(next,'rbSess') && session?.on && intent &&
      (intent.start === null || Number.isSafeInteger(intent.start)) && intent.start === (session.start ?? null) &&
      Array.isArray(cfg.autoTasks) && !cfg.autoTasks.includes('raid')) {
    next.rbSess = { ...session, on: false, end: now };
    return { patch: next, retired: true };
  }
  return { patch: next, retired: false };
}
// 20.35: уменьшение серии по доступным AA — одной записью с её настройкой.
function reduceLsAttemptsChange(state, edit) {
  const s=state.rt?.autoLs,c=state.cfg?.autoLs;
  if(!state.on || !s || !c || !edit || s.id!==edit.id || s.context!==edit.context || s.configSig!==edit.configSig ||
    s.status!=='running' || !s.hold || s.pending || s.maxAttempts!==edit.from || s.attempts!==edit.attempts ||
    (state.rt.manualKickAt||0)!==edit.kick || JSON.stringify(c)!==JSON.stringify(edit.expectedConfig))return {ok:false,reason:'ls_series_changed'};
  const targets=Array.isArray(c.targets)?[...new Set(c.targets)]:[],signature=n=>JSON.stringify([targets,n,typeof c.weaponKey==='string'?c.weaponKey:'']);
  if(c.maxAttempts!==s.maxAttempts || s.configSig!==signature(s.maxAttempts) || !Number.isSafeInteger(edit.to) ||
    edit.to<1 || edit.to<=s.attempts || edit.to>=s.maxAttempts || edit.to>10000)return {ok:false,reason:'invalid_ls_limit'};
  const autoLs={...s,maxAttempts:edit.to,configSig:signature(edit.to),reason:`Лимит снижен по доступным AA: ${s.maxAttempts} → ${edit.to}`};
  return {ok:true,autoLs,cfg:{...state.cfg,autoLs:{...c,maxAttempts:edit.to}}};
}
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): тайник классов rt.classStash (600–870 КБ) живёт в своём ключе stash/stash@Ник.
// Пакет вкладки со сменой класса (statePatch) и запись меню кладут classStash в парный ключ той же записью chrome.storage.local.set —
// атомарно с classCur и прочим (L2EngineCore.stashSplitSet); сам rt тайника больше не держит. Старый rt.classStash (до обновления)
// переносится разово: при обновлении расширения и запуске браузера (stashMigrate), заодно — при любой записи statePatch/меню.
// Остальные записи фона пишут rt из хранилища (уже без тайника) и его не касаются.
// Ревью 20.62: старое rt.classStash при уже заполненном ключе (откат на сборку без ключа stash в ту же папку) не заменяет ключ, а
// складывается с ним по классам (L2EngineCore.stashLegacyMerge) — классы, что есть только в ключе, остаются.
function stashMigrate(why) {
  return serializeLock(async () => {
    const { rt } = await chrome.storage.local.get('rt');
    if (!rt || typeof rt !== 'object' || !Object.hasOwn(rt, 'classStash')) return false;   // повтор безвреден: переносить нечего
    const change = { rt: { ...rt, _src: 'stash-move' } }; await L2EngineCore.stashLegacyMerge(change, { rt }, false, () => chrome.storage.local.get(['stash']));
    await chrome.storage.local.set(await L2EngineCore.stashRehome(L2EngineCore.stashSplitSet(change, 'stash-move'), k => chrome.storage.local.get(k)));
    buf.push({ t: Date.now(), src: 'S', kind: 'память', what: `тайник классов перенесён в отдельный ключ хранилища (${why}): обычная запись памяти героя меньше`, st: '' }); flush();
    return true;
  });
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
    // Финальный flush при OFF допустим после TTL, но не после передачи/освобождения lease.
    if (!state.on && m.epoch && (state.lock?.k !== 'tab' + tab || state.lock.epoch !== m.epoch))
      return { ok: false, reason: 'ownership_lost' };
    if(m.reduceLsAttempts) {
      const result=reduceLsAttemptsChange(state,m.reduceLsAttempts);if(!result.ok)return result;
      await chrome.storage.local.set({cfg:result.cfg,rt:{...state.rt,autoLs:result.autoLs,_src:String(m.src||'').slice(0,60)}});
      return result;
    }
    if(m.dailyServer) {
      const r=dailyServerChange(state,m.dailyServer,now);if(!r.ok)return r;
      await chrome.storage.local.set({rt:r.rt});return {ok:true,dailyQuota:r.rt.dailyQuota,daily:r.rt.daily,dailyServerCheck:r.rt.dailyServerCheck,dailyFishMark:r.rt.dailyFishMark,serverClock:r.rt.serverClock,fishTgt:r.rt.fishTgt??null};
    }
    if(m.resolveLimitRanges) {
      if(!state.on || (state.rt?.manualKickAt||0)!==(m.rangeKick||0))return {ok:false,reason:'ranges_interrupted'};
      const r=limitRangeChange(state,now);if(!r.ok)return r;
      await chrome.storage.local.set({cfg:r.cfg,rt:{...r.rt,_src:'limit-ranges'}});return {ok:true,cfg:r.cfg,limitRolls:r.rt.limitRolls,dailyQuota:r.rt.dailyQuota,farmQuota:r.rt.farmQuota,dropped:r.dropped};
    }
    if (m.farmQuota) {
      let r = farmQuotaChange(state, m.farmQuota, now);
      // 20.41: итог боя без ожидания (fallback) — вкладка могла уже уйти на другую страницу. Неподтверждённый итог засчитываем по журналу
      // боя здесь же, как approx close вкладки; иначе убитые этого боя не попали бы ни в задачу, ни в дневной лимит.
      if (!r.ok && m.farmQuota.op === 'win' && m.farmQuota.fallback === true) { const a = farmQuotaChange(state, { ...m.farmQuota, op: 'approx', n: m.farmQuota.seen, close: true }, now); if (a.ok) r = { ...a, approx: true }; }
      if (!r.ok) return r;
      // 20.12 (ревизия 17.10, F9): cfg пишется только когда задача снята по лимиту — не на каждого моба
      await chrome.storage.local.set(r.row.done ? { rt: r.rt, cfg: r.cfg } : { rt: r.rt }); return { ok:true,row:r.row,cfg:r.cfg,dailyQuota:r.dailyQuota,dailyDone:r.dailyDone,kills:r.kills,farmKillMark:r.farmKillMark,...(r.approx?{approx:true}:{}) };
    }
    if(m.dailyFish) {
      const r=dailyFishChange(state,m.dailyFish,now);if(!r.ok)return r;
      await chrome.storage.local.set({rt:r.rt});return {ok:true,dailyQuota:r.dailyQuota,dailyFishMark:r.dailyFishMark};
    }
    if(m.raidMobs){const r=raidMobChange(state,m.raidMobs,now);if(!r.ok)return r;await chrome.storage.local.set({rt:r.rt});const {rt:_,...reply}=r;return reply;}
    // 17.10: завершение цели и снятие только рыбалки — одной записью, по свежему списку задач.
    if (m.finishFishGoal) {
      const T = state.rt?.fishTgt, E = m.finishFishGoal;
      if (!state.on || (state.rt?.manualKickAt || 0) !== (E.kick || 0)) return { ok: false, reason: 'fish_goal_interrupted' };
      if (!T || !['type','n','t'].every(k => T[k] === E[k])) return { ok: false, reason: 'fish_goal_changed' };
      if (!T.done && !(T.n > 0 && T.got >= T.n)) return { ok: false, reason: 'fish_goal_incomplete' };
      // 20.43 (John 21.10: «смотрел ежедневно … сброс произошёл и наша цель»): цель рыбалки — на игровые сутки. В режиме задач
      // рыбалка остаётся выбранной и ждёт сброса (selectedTask её пропускает), новые сутки обновляют цель в dailyServerChange.
      // Старый плоский режим (fishMode) по-прежнему выключается.
      const day = globalThis.L2EngineCore?.dailyDay?.(now, state.rt || {}) || null;
      const fishTgt = T.done ? { ...T, day: T.day || day } : { ...T, done: true, doneT: now, day: T.day || day };
      const cfg = { ...(state.cfg || {}), fishMode: false };
      await chrome.storage.local.set({ rt: { ...state.rt, fishTgt, fishService: null, _src: String(m.src || '').slice(0, 60) }, cfg });
      return { ok: true, fishTgt, cfg };
    }
    const change = {};
    // 20.41 (ревью 2): пакет вкладки, собранный до сброса из меню (отложенная статистика до 8 с, пакет в очереди за записью меню),
    // не возвращает старые значения статистики (MENU_STAT_KEYS: ↺ сессии, сброс лута/памяти боя). menuRev — последняя увиденная
    // вкладкой запись меню. Прочие ключи (намерения, оплаты, маршруты, rbTimer) — как раньше, последней записью. Метки меню вкладка не пишет.
    const fresh = { ...patch }, menuRevs = state.rt?.menuKeyRev || {}; delete fresh.menuRev; delete fresh.menuKeyRev;
    // Смена класса (classCur другого класса с памятью боя из classStash) — замена набора, а не старая статистика.
    const classSwap = fresh.classCur && JSON.stringify([fresh.classCur.prof, fresh.classCur.slot]) !== JSON.stringify([state.rt?.classCur?.prof, state.rt?.classCur?.slot]);
    if (Number.isSafeInteger(m.menuRev) && !classSwap) for (const k of globalThis.L2EngineCore?.MENU_STAT_KEYS || []) if (Object.hasOwn(fresh, k) && (+menuRevs[k] || 0) > m.menuRev) delete fresh[k];
    const retirement=retireRaidSessionPatch(pvpSeedPatch(fresh,state.rt||{}),state.rt||{},{...(state.cfg||{}),...config},now),writePatch=retirement.patch;
    if (Object.hasOwn(writePatch, 'rbTimer')) writePatch.rbTimer = mergeTimerPatch(state.rt?.rbTimer, writePatch.rbTimer);
    // 20.41 (ревью): kills вкладки может прийти отложенным пакетом уже после итога квоты фона (max по серверу). Вкладка счёт сессии
    // только увеличивает (сброс — только из меню), поэтому меньшее значение сохранённое не понижает.
    if (Number.isSafeInteger(writePatch.kills) && Number.isSafeInteger(state.rt?.kills) && writePatch.kills < state.rt.kills) writePatch.kills = state.rt.kills;
    // Intent-only seed не содержит локального stale map; canonical echo принимается владельцем тоже.
    if (Object.keys(writePatch).length) change.rt = { ...(state.rt || {}), ...writePatch, _src: retirement.retired ? 'raid-session-policy' : writePatch.pvpSeedDremia1410===true&&writePatch.pvpTargets ? 'pvp-seed' : String(m.src || '').slice(0, 60) };
    if (Object.keys(config).length) change.cfg = { ...(state.cfg || {}), ...config };
    // 20.62: classStash — в ключ stash (stashSplitSet); пакет только с тайником (и rt без старого тайника) большой rt не переписывает
    const stashOnly = change.rt && Object.keys(writePatch).every(k => k === 'classStash') && !Object.hasOwn(state.rt || {}, 'classStash');
    if (change.rt && globalThis.L2EngineCore?.stashSplitSet) { await L2EngineCore.stashLegacyMerge?.(change, state, Object.hasOwn(writePatch, 'classStash'), () => chrome.storage.local.get(['stash'])); L2EngineCore.stashSplitSet(change, String(m.src || '').slice(0, 60)); await L2EngineCore.stashRehome?.(change, k => chrome.storage.local.get(k)); }
    if (stashOnly && change.stash) delete change.rt;
    if (Object.keys(change).length) await chrome.storage.local.set(change);
    return { ok: true };
  });
}
// Popup writes also go through the same queue as content-script patches.
// A stale popup snapshot can no longer roll back unrelated runtime keys.
// Меняем одну явную PvP-цель внутри serializeLock, не переписывая устаревший список из меню.
// 20.43 (ревью 21.10): список «скрафтить N штук» меняется по одной строке внутри serializeLock — два быстрых клика меню
// (✕ и ✕, ✕ и «+») больше не восстанавливают удалённую строку из старой копии списка.
function craftQueueChange(rt, edit) {
  const q = Array.isArray(rt.craftQueue) ? rt.craftQueue.filter(x => x && typeof x === 'object' && typeof x.id === 'string') : [];
  const okId = id => typeof id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(id) && !['__proto__','constructor','prototype'].includes(id);
  if (edit?.action === 'remove') return okId(edit.id) ? { ok: true, queue: q.filter(x => x.id !== edit.id) } : { ok: false, reason: 'Строка списка крафта не найдена' };
  if (edit?.action !== 'add') return { ok: false, reason: 'Неизвестное изменение списка крафта' };
  const r = edit.row || {}, n = Number(r.n), item = Number(r.item || 0);
  if (!okId(r.id) || typeof r.code !== 'string' || !/^[a-z0-9_.:-]{1,80}$/i.test(r.code) || !Number.isSafeInteger(n) || n < 1 || n > 1e6
      || !Number.isSafeInteger(item) || item < 0 || (r.nm != null && (typeof r.nm !== 'string' || r.nm.length > 100)))
    return { ok: false, reason: 'Строка списка крафта неверна' };
  if (q.some(x => x.id === r.id)) return { ok: true, queue: q };
  if (q.length >= 50) return { ok: false, reason: 'В списке крафта уже 50 строк — удалите лишние' };
  return { ok: true, queue: [...q, { id: r.id, code: r.code, nm: r.nm || r.code, item, n }] };
}
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
    const state = await chrome.storage.local.get(['rt', 'cfg', 'on']);   // 20.41: «on» — для afterOnWrite (новый отсчёт сторожа только при off→on)
    if (m.expectedChar != null && String(state.rt?.char || '') !== m.expectedChar) return { ok: false, reason: 'Персонаж изменился — обновите меню' };
    if (m.pvpTargetEdit) {
      if (!m.expectedChar) return {ok:false,reason:'Персонаж изменился — обновите меню'};
      const edit=pvpTargetChange(state.rt||{},m.pvpTargetEdit);if(!edit.ok)return edit;
      rtPatch.pvpTargets=edit.targets;if(edit.seedHandled)rtPatch.pvpSeedDremia1410=true;
    }
    if (m.craftQueueEdit) {
      if (!m.expectedChar) return {ok:false,reason:'Персонаж изменился — обновите меню'};
      const edit=craftQueueChange(state.rt||{},m.craftQueueEdit);if(!edit.ok)return edit;
      rtPatch.craftQueue=edit.queue;
    }
    if (Object.hasOwn(rtPatch, 'rbTimer')) rtPatch.rbTimer = mergeTimerPatch(state.rt?.rbTimer, rtPatch.rbTimer);
    // 8.0 (аудит ядра): переключатель в меню больше не переписывает всю память персонажа (163 КБ) — rt только если есть что писать.
    // Раньше вкладка после такой записи заменяла свою память и теряла то, что держала только в памяти (метки отката атаки и т. п.)
    const change = Object.keys(rtPatch).length ? { rt: { ...(state.rt || {}), ...rtPatch, _src: 'menu' } } : {};
    if(m.on===true)change.rt={...state.rt,...change.rt,dailyStart:(state.rt?.dailyStart||0)+1,_src:'menu'};
    if (Object.keys(cfgPatch).length) change.cfg = { ...(state.cfg || {}), ...cfgPatch };
    // 20.10: Start/Продолжить и включение тура требуют нового полного списка; старый fish fallback тоже недействителен.
    const raidOn = c => Array.isArray(c?.autoTasks) ? c.autoTasks.includes('raid') : !!(c?.rbHuntMode || c?.rbMode);
    const nextCfg = change.cfg || state.cfg;
    if (m.on === true || !raidOn(state.cfg) && raidOn(nextCfg) || rtPatch.rbSess?.on && rtPatch.rbSess.start !== state.rt?.rbSess?.start) {
      const next = { ...state.rt, ...change.rt };
      change.rt = { ...next, ...L2EngineCore.raidFreshStartPatch(next, nextCfg), _src:'menu' };
    }
    // 20.43 (лог 21.10 17:13): выполненная цель рыбалки снимает рыбалку с задач; новое явное включение рыбалки — новая работа,
    // а не продолжение старой цели (так же «Старт» с выбранной рыбалкой, если цель прошлых суток). Раньше «✅ Выполнено 1679 рыб» от 18.10 оставалось, и выбранная рыбалка молча не начиналась.
    const fishOn = c => Array.isArray(c?.autoTasks) ? c.autoTasks.includes('fish') : !!c?.fishMode;
    if (state.rt?.fishTgt?.done && !Object.hasOwn(rtPatch, 'fishTgt') && fishOn(nextCfg) && (!fishOn(state.cfg) || m.on === true && state.rt.fishTgt.day !== L2EngineCore.dailyDay(Date.now(), state.rt)))
      change.rt = { ...state.rt, ...change.rt, fishTgt: null, _src: 'menu' };
    if(m.setFishGoal) {
      const E=m.setFishGoal;
      if(!m.expectedChar || !['fish','proof'].includes(E.type) || !Number.isSafeInteger(E.min) || E.min<1 || !Number.isSafeInteger(E.max) || E.max<E.min)return {ok:false,reason:'Цель: нужен положительный диапазон «от … до …»'};
      change.rt={...state.rt,...change.rt,fishTgt:{type:E.type,n:quotaRandom(E.min,E.max),min:E.min,max:E.max,got:0,t:Date.now(),day:L2EngineCore.dailyDay(Date.now(),state.rt||{})},_src:'menu'};
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
      if(reset){rt.dailyQuota=dailyQuotaToday(rt,Date.now());for(const k of task==='fish'?['fish']:['auto','cat','raid','server'])rt.dailyQuota[k]=0;}
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
    // 20.41 (ревью 2): метка записи меню у статистики из самой команды меню (повторный ↺ тех же нулей — тоже сброс) и у изменённой по
    // значению другими шагами (см. statePatch); копии с прежним содержимым её не получают.
    const menuStat = change.rt ? (globalThis.L2EngineCore?.MENU_STAT_KEYS || []).filter(k => Object.hasOwn(change.rt, k) && (Object.hasOwn(rtPatch, k) || change.rt[k] !== state.rt?.[k] && JSON.stringify(change.rt[k]) !== JSON.stringify(state.rt?.[k]))) : [];
    if (menuStat.length) { const rev = (+state.rt?.menuRev || 0) + 1; change.rt = { ...change.rt, menuRev: rev, menuKeyRev: { ...(state.rt?.menuKeyRev || {}), ...Object.fromEntries(menuStat.map(k => [k, rev])) } }; }
    if (change.rt && globalThis.L2EngineCore?.stashSplitSet) { await L2EngineCore.stashLegacyMerge?.(change, state, Object.hasOwn(rtPatch, 'classStash'), () => chrome.storage.local.get(['stash'])); L2EngineCore.stashSplitSet(change, 'menu'); await L2EngineCore.stashRehome?.(change, k => chrome.storage.local.get(k)); }   // 20.62: старый rt.classStash — в ключ stash той же записью
    if (Object.keys(change).length) await chrome.storage.local.set(change);
    if (typeof m.on === 'boolean') await afterOnWrite(state.on, m.on);
    if (m.on === false) await stopAlert(change.stopMeta, state.cfg);   // 20.43: Стоп из меню снимает «!» самоостановки, уведомления нет
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
    const state = await chrome.storage.local.get(['on', 'lock', 'rt', 'cfg']);
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
    const stopMeta = { source: String(user ? 'content-user' : m.source || (popup ? 'popup-' : 'content-') + m.action).slice(0, 60), reason, t: now };
    await chrome.storage.local.set({ on: false, paused: m.action === 'pause' ? { t: now, why: reason.slice(0, 160) } : null, stopMeta });
    await afterOnWrite(state.on, false);
    await stopAlert(stopMeta, state.cfg);            // 20.43: после afterOnWrite — иначе пустой значок затёр бы «!»
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
    const current = await chrome.storage.local.get(['lock', 'on', 'rt', 'cfg', 'rt@' + nick, 'cfg@' + nick, 'stash', 'stash@' + nick]);
    // Даже если вкладка ещё получает события, только владелец вправе менять
    // глобальные ключи; при выключенном боте разрешена смена через открытую страницу.
    if (current.on && (current.lock?.k !== 'tab' + tab || !m.epoch || current.lock.epoch !== m.epoch || Date.now() - current.lock.t >= LOCK_TTL)) return { ok: false, reason: 'ownership_lost' };
    if (!current.on && (!sender.tab.active || m.vis !== true)) return { ok: false, reason: 'inactive_tab' };
    const prev = current.rt || {}, old = String(prev.char || '').trim(), previousCfg = current.cfg || {};
    // 20.62: тайник классов — в ключах stash (активный герой) / stash@Ник; вкладке возвращаем память вместе с ним (rt.classStash)
    const EC = globalThis.L2EngineCore?.stashValue ? globalThis.L2EngineCore : null, strip = r => EC ? EC.stashStrip(r) : r;
    const stashOf = (r, w) => EC ? EC.stashValue(r, w) : { has: false }, wrap = (k, who, s) => EC ? { [k]: EC.stashWrap(who, s.v, m.src) } : {};
    // Ревью 20.62: сборка без ключа stash (откат на старый ZIP) меняет героев, не трогая ключи stash* — «stash» может остаться у другого
    // героя, а тайник прежнего лежать в stash@Ник. Ищем обёртку по нику в обоих местах; нечего переносить — stash@Ник не затираем пустой
    const own = (who, ...ws) => ws.find(w => w && typeof w === 'object' && String(w.char || '') === who);
    if (old && old !== nick && String(current.stash?.char || '') !== old) Object.assign(current, await chrome.storage.local.get(['stash@' + old]));
    const prevWrap = own(old, current.stash, current['stash@' + old]), prevStash = stashOf(prev, prevWrap), withStash = (r, s) => s.has ? { ...strip(r), classStash: s.v } : r;
    if (old === nick) return { ok: true, rt: withStash(prev, prevStash), cfg: previousCfg, changed: false };
    if (!old) {
      const next = { ...strip(prev), char: nick, campaign: null, campaignUrl: '', lastTeleport: '',
        qAlias: {}, needChamps: false, wrongLoc: 0, campaignDue: !!previousCfg.campaign,
        questTargets: [], quests: {}, _src: m.src };
      await chrome.storage.local.set({ rt: next, ...(prevStash.has ? wrap('stash', nick, prevStash) : {}) });
      return { ok: true, rt: withStash(next, prevStash), cfg: previousCfg, changed: true, old: '' };
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
      nextCfg.autoLs = { targets: [], maxAttempts: 10, buyMaterials: true, aaBudget: 2000000, adenaBudget: 2000000, aaReserve: 0 }; // Чужая цель ЛС не переносится новому герою.
      nextCfg.craftMode = false; // 22.10: отдельный крафт новый герой выбирает сам.
      nextCfg.enchantMode = false; // 15.10: новый герой сам выбирает отдельный режим заточки.
      nextCfg.enchant = {"enabled":false,"queue":[],"scrollPolicy":"blessed","ordinaryUntil":3,"maxAttempts":0,"maxScrolls":0,"maxAdena":0,"maxConsecutiveFails":2,"maxDropFromStart":1,"maxDropFromPeak":2,"delayMs":1500,"purchase":false,"colBudget":0}; // У нового героя нет выбранных экземпляров чужой очереди.
      // 10.0 (аудит): вещь-цель Маммона — своя у каждого героя (иначе спойлер шлёт крафтеру своё сырьё на вещь Warlock)
      nextCfg.mmGoalItem = '';
    }
    const saved = { ...(m.defRt || {}), ...(current['rt@' + nick] || {}) }, nextStash = stashOf(saved, own(nick, current['stash@' + nick], current.stash));
    const nextRt = { ...strip(saved),
      char: nick, status: `Персонаж: ${nick}`, campaignDue: !!nextCfg.campaign, _src: m.src };
    // Таймеры боссов общие для сервера; старый кэш другого героя не отменяет импорт.
    if (prev.rbTimer || nextRt.rbTimer) nextRt.rbTimer = mergeTimerPatch(prev.rbTimer, nextRt.rbTimer);
    // 20.62: тайники меняются местами той же записью (stash всегда с ником нового героя — вкладка получает его в том же onChanged)
    // Ревью 20.62 (2): stash@Ник прежнего героя — всегда его зеркало (пустая обёртка после загрузки файла без тайника тоже: иначе
    // вернулся бы старый тайник); обёртки нет нигде (откат на старую сборку) — stash@Ник не трогаем
    await chrome.storage.local.set({ ['rt@' + old]: strip(prev), ...(prevStash.has || prevWrap ? wrap('stash@' + old, old, prevStash) : {}), ['cfg@' + old]: previousCfg,
      rt: nextRt, ...wrap('stash', nick, nextStash), cfg: nextCfg });
    // тайник нового героя теперь в «stash» — его копия в stash@Ник лишняя (600–870 КБ) и после следующего ухода устарела бы
    if (EC) try { await chrome.storage.local.remove('stash@' + nick); } catch (e) {}
    // 20.13 (ревизия 17.10, шаг 7, core-a/L1): живой статус героя (live@Ник) с прошлой сессии старее «Персонаж: …» — убираем,
    // меню покажет rt.status, пока вкладка не напишет свежий
    try { await chrome.storage.local.remove('live@' + nick); } catch (e) {}
    return { ok: true, rt: withStash(nextRt, nextStash), cfg: nextCfg, changed: true, old };
  });
}
// 8.0.6 (Firefox для Android): значка на панели там нет — вызовы под защитой, иначе фоновый скрипт ловит ошибку
const paint = on => {
  const warn = !on && attn;
  try { chrome.action?.setBadgeText?.({ text: on ? 'ON' : warn ? '!' : '' })?.catch?.(() => {}); chrome.action?.setBadgeBackgroundColor?.({ color: warn ? '#c0392b' : '#27ae60' })?.catch?.(() => {}); } catch (e) {}
};
// 20.41 (лог 20.10 21:09: память rt 1,3 МБ — каждая запись rt доставлялась двум слушателям storage.onChanged фона целиком, старое+новое
// значение, ≈100–190 мс на каждый цикл statePatch в том же потоке фона): слушателей хранилища в фоне больше нет. Их работу делают сами
// писатели «on» после удачной записи: значок, controlSeq (отмена ещё не отправленного восстановления сторожа) и новый отсчёт сторожа
// только при настоящем запуске off→on — Chrome не сообщал о неизменном «on», выбор режима при работающем боте сторожа не сбрасывал.
// Прямые записи on:false (модули, импорт памяти) зовут badgeSync; сторож и так перечитывает on/замок/эпоху под очередью перед reload.
let paintedOn = null;                              // что сейчас на значке: «работает/стоит» ('!' капчи это значение не меняет)
const paintOn = on => { paintedOn = !!on; paint(on); };
// 20.43 (разбор 21.10: бот ночью вставал сам — «Персонаж погиб», «3 смерти за 30 минут», сторож «3 перезагрузки … не помогли»,
// пауза «выход из Ashen Bastion не подтверждён», — а значок просто гас; уведомление было только у капчи и автовхода, причина — лишь
// в подсказке меню). Самоостановка и пауза от самого бота (content-halt/content-pause) и стоп сторожа фона (watchdog): одно системное
// уведомление с причиной и красный «!» на значке до следующего Старта/«▶ Продолжить». Ручной Стоп/Пауза из меню, Alt+Shift+B, Esc ×2
// (content-user) и импорт памяти — без уведомления. Галка cfg.notifyStops («Уведомлять об остановках», по умолчанию ВКЛ): выключена —
// всё как раньше. На Firefox для Android уведомлений и значка нет — вызовы под «?.», там остаётся строка причины в меню.
const SELF_STOP = new Set(['content-halt', 'content-pause', 'watchdog']);
const selfStop = meta => !!meta && SELF_STOP.has(String(meta.source || '')) && !meta.resumed;
const attnOf = s => !s?.on && selfStop(s?.stopMeta) && s?.cfg?.notifyStops !== false;
let attn = false;                                  // красный «!» самоостановки: paint рисует его вместо пустого значка (и после перезапуска фона)
// 20.43: уведомление — без requireInteraction, если браузер его не принимает (Firefox); шум — не чаще раза на ключ (причина/оплата) за ms.
// Отметки — в storage.session (переживают перезапуск фона MV3, не попадают в экспорт и память бота), без него — в памяти фона.
const notify = (id, title, message, sticky) => {
  const o = { type: 'basic', iconUrl: 'icons/128.png', title, message: String(message || '').slice(0, 400), priority: 2 };
  const plain = () => { try { chrome.notifications?.create?.(id, o)?.catch?.(() => {}); } catch (_) {} };
  try { const p = chrome.notifications?.create?.(id, sticky ? { ...o, requireInteraction: true } : o); if (sticky) p?.catch?.(plain); } catch (_) { if (sticky) plain(); }
};
let noteMem = {}, noteQ = Promise.resolve();
const noteOnce = (key, ms) => (noteQ = noteQ.then(async () => {
  const now = Date.now(), S = chrome.storage?.session;
  let seen = noteMem; try { if (S) seen = (await S.get('noteSeen'))?.noteSeen || {}; } catch (_) {}
  if (now - (+seen[key] || 0) < ms) return true;
  noteMem = Object.fromEntries(Object.entries({ ...seen, [key]: now }).filter(([, t]) => now - t < 86400000).slice(-40));
  try { await S?.set({ noteSeen: noteMem }); } catch (_) {}
  return false;
}).catch(() => false));
// Остановка/пауза записана (on:false + stopMeta): своя — «!» и одно уведомление на причину за 30 мин (цифры в причине не различают её:
// «бот молчит 160 с» и «… 172 с» — одна причина); чужая (игрок) снимает прежний «!» самоостановки
async function stopAlert(meta, cfg) {
  const own = selfStop(meta) && cfg?.notifyStops !== false;
  if (attn !== own) { attn = own; if (paintedOn === false) paint(false); }
  if (!own || await noteOnce('stop:' + String(meta.reason || '').replace(/\d+/g, '#').slice(0, 120), 30 * 60000)) return;
  const at = new Date(+meta.t || Date.now()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  notify('l2bot-stop', meta.source === 'content-pause' ? 'L2wap Bot сам встал на паузу' : 'L2wap Bot остановлен', `${at} · ${meta.source === 'watchdog' ? 'сторож: ' : ''}${meta.reason || 'причина не указана'}`, true);
}
// 20.43: неподтверждённая оплата висит дольше 15 мин — одно уведомление на её id (платные задачи стоят до сверки; бот её сам не снимает)
const PAY_NOTE_MS = 15 * 60000, PAY_KIND = { shop: 'закупка в магазине', fishing: 'покупка на рыбалке', 'cat-teleport': 'телепорт в катакомбы', 'raid-teleport': 'телепорт к РБ', mammon: 'Маммон', 'fa-buff': 'бафф за FA', 'town-buff': 'городской бафф', 'tvt-shop': 'магазин TvT', 'story-teleport': 'телепорт квеста' };
async function payAlert(rt, cfg, now = Date.now()) {
  const p = rt?.actionPayments?.pending;
  if (!p?.id || cfg?.notifyStops === false || !(now - (+p.at || now) >= PAY_NOTE_MS) || await noteOnce('pay:' + p.id, 86400000)) return false;
  const sum = Number.isFinite(+p.quote?.amount) ? ` · ${(+p.quote.amount).toLocaleString('ru')} ${p.quote.currency || ''}`.trimEnd() : '';
  notify('l2bot-pay', 'L2wap Bot: оплата без подтверждения', `${PAY_KIND[p.kind] || p.kind || 'оплата'}${sum} ждёт сверки ${Math.floor((now - p.at) / 60000)} мин. Проверьте адену; если списания не было — в меню бота кнопка «Считать оплату не прошедшей».`, false);
  return true;
}
async function afterOnWrite(prevOn, nextOn) {      // только внутри serializeLock и только после удачной записи «on»
  if (!!prevOn === !!nextOn) { if (paintedOn !== !!nextOn) paintOn(nextOn); return; }
  serializeLock.controlSeq = (serializeLock.controlSeq || 0) + 1; // Stop отменяет ещё не отправленное восстановление.
  if (nextOn) attn = false;                        // 20.43: Старт/«▶ Продолжить» снимает «!» самоостановки
  paintOn(nextOn);
  if (!nextOn) return;
  // 20.43: …и её уведомление; причина в меню больше не показывается (stopMeta.resumed; t прежнее — по нему stopPendRetry узнаёт
  // уже дошедшую остановку)
  try { chrome.notifications?.clear?.('l2bot-stop')?.catch?.(() => {}); } catch (_) {}
  try { const { stopMeta } = await chrome.storage.local.get('stopMeta'); if (stopMeta && !stopMeta.resumed) await chrome.storage.local.set({ stopMeta: { ...stopMeta, resumed: Date.now() } }); } catch (_) {}
  try {   // старт — отсчёт сторожа заново, в очереди владельца
    const { on, hbBg, lock } = await chrome.storage.local.get(['on', 'hbBg', 'lock']);
    if (!on) return; // Пока ждали хранилище, игрок мог уже остановить бота.
    const h = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
    if (!h || lock?.k !== 'tab' + h.tab) return;
    const nextHb = { ...h, t: Date.now() };
    await chrome.storage.local.set({ hbBg: { ...nextHb }, wdog: [], wdDown: null });
    hbMem = nextHb; hbPersistedAt = Date.now();
    await chrome.storage.local.set({ wdSilent: null });   // 20.43 (автономность): и серия тишины сторожа — старт начинает отсчёт заново
  } catch (_) {}
}
chrome.storage.local.get('on').then(s => paintOn(s.on)).catch(() => {});
// 20.43: перезапуск фона MV3 не стирает «!» самоостановки — он восстанавливается из stopMeta/cfg (в любом порядке с чтением «on» выше)
chrome.storage.local.get(['on', 'stopMeta', 'cfg']).then(s => { attn = attnOf(s); if (attn && paintedOn === false) paint(false); }).catch(() => {});

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
chrome.runtime.onStartup.addListener(() => { void applyBaseProfile('запуск браузера'); void stashMigrate('запуск браузера').catch(() => {}); });

chrome.runtime.onInstalled.addListener(async details => {
  await ensureWatchdogAlarm();
  if (details && ['install', 'update'].includes(details.reason)) await applyBaseProfile(details.reason === 'install' ? 'установка' : 'обновление');
  // 20.62: тайник классов из rt — в свой ключ до перезагрузки вкладок игры (они загрузятся уже с маленьким rt)
  if (details?.reason === 'update') try { await stashMigrate('обновление'); } catch (e) {}
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
    const { on = false, rt = {}, cfg = {} } = await chrome.storage.local.get(['on', 'rt', 'cfg']), now = Date.now();
    const change = { on: !on };
    if (!on) {
      // 19.10.2026: новый запуск отменяет старые release/ответы и требует сверки суточных лимитов, как Start в меню.
      const next = { ...rt, manualKickAt: Math.max(now, (+rt.manualKickAt || 0) + 1), dailyStart: (+rt.dailyStart || 0) + 1, _src: 'hotkey' };
      Object.assign(next, L2EngineCore.raidFreshStartPatch(next, cfg, now));
      change.rt = next;
      if (next.char) change['rt@' + next.char] = next;
    } else change.stopMeta = { source: 'hotkey', reason: 'Горячая клавиша Alt+Shift+B', t: now };
    await chrome.storage.local.set(change);
    await afterOnWrite(on, !on);
    if (on) await stopAlert(change.stopMeta, cfg);    // 20.43: ручной стоп клавишей — без уведомления, прежний «!» снят
  });
});

// ===== журнал и снимки страниц — в IndexedDB (до 20 000 событий; снимков до 1000 и до 50 МБ разметки) =====
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
      db.onclose = () => { dbp = null; logN = null; recSent = undefined; };
      db.onversionchange = () => { db.close(); dbp = null; logN = null; recSent = undefined; };
      res(db);
    };
    r.onerror = () => { dbp = null; logN = null; recSent = undefined; rej(r.error); };
  });
}
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
// Удаляем именно N самых старых существующих строк. Диапазон ID небезопасен:
// после удаления/импорта в IndexedDB ключи могут быть разреженными.
// 20.65: range — только строки до этой границы (не трогать только что добавленный пакет); итог — сколько удалено и кончились ли строки
function trimOldest(store, excess, range) {
  const out = { deleted: 0, exhausted: false };
  if (excess <= 0) return out;
  let left = excess;
  store.openCursor(range).onsuccess = ev => {
    const cur = ev.target.result;
    if (!cur) { if (left > 0) out.exhausted = true; return; }
    if (left <= 0) return;
    cur.delete(); out.deleted++;
    left--;
    if (left > 0) cur.continue();
  };
  return out;
}


let buf = [], timer = null, writing = Promise.resolve();
// 20.65 (жалоба John 25.10 «бот грузит ЦП»; замер: count() по 20 000 строк — ≈21 мс на каждый сброс раз в 1,5 с): число строк
// журнала фон помнит сам (logN) и пересчитывает count() только после запуска фона, ошибки/переподключения базы, раз в 200 сбросов или
// 10 мин. Между пересчётами лишние строки удаляются строго до последнего ключа ДО этого пакета (K0) — новый пакет не тронут; пустой
// журнал до пакета (K0 нет — «Очистить журнал» в меню чистит базу напрямую) — счёт с нуля. reccount пишется при изменении и после count().
let logN = null, recSent, flushN = 0, logCntT = 0;
function flush() {
  timer = null;
  if (!buf.length) return;
  const chunk = buf; buf = [];
  writing = writing.then(async () => {
    const db = await idb();
    const tx = db.transaction('log', 'readwrite'), st = tx.objectStore('log');
    let total = 0, rc, cleared = false, counted = false;
    // Пакет не добавлен (исключение add) — транзакция отменяется целиком: ни части пакета, ни удаления старых строк
    const addAll = () => { try { chunk.forEach(ev => st.add(ev)); } catch (e) { try { tx.abort(); } catch (_) {} throw e; } };
    if (logN == null || ++flushN % 200 === 0 || Date.now() - logCntT > 600000) {
      addAll(); counted = true;
      st.count().onsuccess = e => {
        total = e.target.result;
        if (total > MAX_EV) trimOldest(st, total - MAX_EV);
      };
      await txDone(tx);
      logN = Math.min(total, MAX_EV); logCntT = Date.now(); rc = logN;
    } else {
      const pre = logN; let K0 = null, cut = null;
      // Запросы транзакции выполняются по порядку: последний ключ читается до добавления пакета
      st.openKeyCursor(null, 'prev').onsuccess = e => {
        K0 = e.target.result?.key ?? null;
        if (K0 == null) { cleared = true; return; }
        const excess = pre + chunk.length - MAX_EV;
        if (excess > 0) cut = trimOldest(st, excess, IDBKeyRange.upperBound(K0));
      };
      addAll();
      await txDone(tx);
      logN = cleared || cut?.exhausted ? chunk.length : pre + chunk.length - (cut?.deleted || 0);
      if (logN > MAX_EV) logN = null;            // пакет больше предела (буфер ≤ 10 000 — не бывает): следующий сброс пересчитает
      rc = Math.min(logN ?? MAX_EV, MAX_EV);
    }
    // Ревью 20.65: после пересчёта count() reccount пишется всегда — правит и внешнюю запись (очистка журнала из меню пишет 0)
    if (rc !== recSent || cleared || counted) { await chrome.storage.local.set({ reccount: rc }); recSent = rc; }
  }).catch(e => {
    logN = null; recSent = undefined;
    // Не терять пакет событий, если IndexedDB временно недоступен. Ревью 20.65: событие, которое база не может сохранить
    // (DataCloneError), выбрасываем — иначе один такой пакет повторялся бы каждые 3 с и журнал стоял бы целиком.
    if (e?.name === 'DataCloneError') chunk.splice(0, chunk.length, ...chunk.filter(ev => { try { structuredClone(ev); return true; } catch (_) { return false; } }));
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
// 20.13 (ревизия 17.10, шаг 7, аудит core-b/F13): предел был только по числу (1000 × 100–400 КБ = до 400 МБ в профиле Chrome).
// Теперь и по объёму разметки: больше 50 МБ — удаляем самые старые. Сумма хранится в storage «snapbytes» (один раз считается по
// уже лежащим снимкам), «Очистить журнал» в меню сбрасывает её в 0
const MAX_SNAP_BYTES = 50 * 1024 * 1024;
// 20.41 (лог 20.10 21:09, ревью): слушателя storage.onChanged для snapbytes у фона больше нет, сообщения от меню тоже не нужно —
// пустое хранилище снимков всегда 0 байт (см. addSnap): «Очистить журнал» (IndexedDB очищена, snapbytes:0) сбрасывает сумму сама,
// даже если меню закрылось сразу после записи или снимок уже стоял в очереди writing
let snapBytes = null;
async function snapBytesNow(db) {
  if (snapBytes != null) return snapBytes;
  const { snapbytes } = await chrome.storage.local.get('snapbytes');
  if (Number.isFinite(snapbytes)) return (snapBytes = snapbytes);
  return (snapBytes = await new Promise(res => {
    let sum = 0; const r = db.transaction('snaps').objectStore('snaps').openCursor();
    r.onsuccess = e => { const c = e.target.result; if (!c) return res(sum); sum += String(c.value?.html || '').length; c.continue(); };
    r.onerror = () => res(0);
  }));
}
function addSnap({ key, state, html }) {
  writing = writing.then(async () => {
    const db = await idb();
    let total = await snapBytesNow(db);
    const size = String(html || '').length, over = n => n > MAX_SNAPS || total > MAX_SNAP_BYTES;
    const tx = db.transaction('snaps', 'readwrite'), st = tx.objectStore('snaps');
    let added = 0, n = 0;
    st.count().onsuccess = e => {
      n = e.target.result; if (!n) total = 0;   // 20.41 (ревью): снимков нет — объём 0, а не старая сумма из памяти/хранилища (иначе 50 МБ «заняты» пустотой)
      st.getKey(key).onsuccess = g => {
        if (g.target.result != null) return;
        st.put({ key, state: state || '', t: Date.now(), html }); added = 1; n++; total += size;
        // v5.6: при заполнении — удаляем самые старые (раньше новые просто не сохранялись, а бот слал их снова и снова); 20.13: и по объёму
        if (over(n)) { const c = st.index('t').openCursor(); c.onsuccess = ev => { const cur = ev.target.result; if (!cur || !over(n)) return;
          if (cur.value?.key !== key) { total -= String(cur.value?.html || '').length; cur.delete(); n--; } cur.continue(); }; }
      };
    };
    await txDone(tx);
    snapBytes = Math.max(0, total);
    if (added) await chrome.storage.local.set({ snapcount: Math.min(n, MAX_SNAPS), snapbytes: snapBytes });
  }).catch(e => { snapBytes = null; console.warn('[L2bot] снимок:', e); });
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
// 20.43 (автономность, разбор 21.10): после 3 перезагрузок за 20 мин сторож выключал бота на всю ночь (исключение — рыбалка). Теперь для
// всех задач — редкая перезагрузка раз в 15 мин (рыбалка — по-прежнему раз в 5 мин на /fishing.html и без стопа); бот выключается
// (on=false, уведомление stopAlert) только после 2,5 ч непрерывной тишины вкладки. Серия тишины — wdSilent {since, n, last}:
// since — последний настоящий пульс до первой перезагрузки серии, n — перезагрузок в серии; пульс ≥ 3 мин после последней — серия окончена.
function wdPlan(o) {
  const { quiet, recent = [], fish, srv, downLast = 0, wasDown, now, silent = null } = o;
  const RARE_MS = 15 * 60000, SILENT_STOP_MS = 150 * 60000;   // 20.43: редкая перезагрузка и стоп после 2,5 ч непрерывной тишины
  if (quiet < 150000) return { act: 'none' };
  if (srv === 'down') return now - downLast >= 120000 ? { act: 'reload', down: true } : { act: 'none', down: true };
  if (wasDown) return { act: 'reload', back: true };                                   // сервер ожил — сразу на страницу задачи
  const last = Math.max(0, ...recent, +silent?.last || 0), series = recent.length >= 3 || +silent?.n >= 3;
  if (series && fish) return now - last < 5 * 60000 ? { act: 'none' } : { act: 'fishReload', count: true };
  if (series) {
    if (now - (+silent?.since || now) >= SILENT_STOP_MS) return { act: 'stop' };
    return now - last < RARE_MS ? { act: 'none' } : { act: 'rareReload', count: true };
  }
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
      const state = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown', 'rt', 'wdSilent']);
      if (!!state.on !== paintedOn) paintOn(state.on);   // 20.41: страховка значка раз в минуту; совпадает — не трогаем ('!' капчи остаётся)
      void payAlert(state.rt, state.cfg).catch(() => {});   // 20.43: оплата без сверки дольше 15 мин — и при остановленном боте; очередь не ждёт
      const hb = hbMem && hbMem.t >= (state.hbBg?.t || 0) ? hbMem : state.hbBg;
      if (!state.on || !Number.isInteger(hb?.tab) || state.lock?.k !== 'tab' + hb.tab) return null;
      const quiet = Date.now() - hb.t, wdDown = state.wdDown;
      if (quiet < 150000) {
        // 20.13 (шаг 5, core-b/F4): после перезагрузки бот снова пульсирует ≥3 мин — перезагрузка помогла, счётчик «3 за 20 мин» сбрасываем
        const healed = wdHealed(state.wdog, hb.t), patch = { ...(wdDown ? { wdDown: null } : {}), ...(healed ? { wdog: [] } : {}), ...wdSilentHeal(state.wdSilent, hb.t) };
        if (Object.keys(patch).length) await chrome.storage.local.set(patch);
        return;
      }
      return state;
    });
    if (!before) return;
    let { on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null, rt = {}, wdSilent = null } = before;
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
      ({ on = false, hbBg, wdog = [], cfg = {}, lock, wdDown = null, rt = {}, wdSilent = null } = await chrome.storage.local.get(['on', 'hbBg', 'wdog', 'cfg', 'lock', 'wdDown', 'rt', 'wdSilent']));
      hb = hbMem && hbMem.t >= (hbBg?.t || 0) ? hbMem : hbBg;
      if ((serializeLock.controlSeq || 0) !== generation || !on || lock?.k !== before.lock?.k || lock?.epoch !== before.lock?.epoch || lock?.k !== 'tab' + tab.id || hb?.tab !== tab.id || rt.char !== before.rt?.char || (rt.manualKickAt || 0) !== (before.rt?.manualKickAt || 0)) return;
      let currentTab; try { currentTab = await chrome.tabs.get(tab.id); } catch (_) { return; }
      if ((serializeLock.controlSeq || 0) !== generation || (currentTab.pendingUrl || currentTab.url) !== (tab.pendingUrl || tab.url)) return;
      now = Date.now(); quiet = now - hb.t;
      if (quiet < 150000) return;
      const recent = wdog.filter(t => now - t < 20 * 60000);
      const fishMode = Array.isArray(cfg.autoTasks) ? globalThis.L2EngineCore?.selectedTask(cfg, rt, now) === 'fish' : !!cfg.fishMode;
      const plan = wdPlan({ quiet, recent, fish: fishMode, srv: server, downLast: wdDown?.last || 0, wasDown: !!wdDown, now, silent: wdSilent });
      // 20.43: серия тишины — с последнего настоящего пульса до первой перезагрузки (hbBg.t потом сдвигается на время перезагрузки)
      const silentNext = () => ({ wdSilent: { since: +wdSilent?.since || hb.t, n: (+wdSilent?.n || 0) + 1, last: now } });
      if (plan.down) {                                     // сервер лежит: не попытка, не остановка
        if (plan.act !== 'reload') return;
        ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}), сервер игры не отвечает — перезагружаю вкладку раз в 2 мин, бота не останавливаю`;
        if (!wdDown) { buf.push(ev); flush(); }            // в журнал — только начало простоя
        await persist({ wdDown: { since: wdDown?.since || now, last: now }, wdSilent: null }, { tab: hb.tab, t: now - 60000, page: hb.page });   // 20.43: простой сервера — не тишина бота
        if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
        return;
      }
      if (plan.back) {
        ev.what = `сервер игры снова отвечает (простой ${Math.round((now - (wdDown.since || now)) / 60000)} мин) — перезагружаю вкладку, бот продолжает задачу`;
        buf.push(ev); flush();
        await persist({ wdDown: null, wdSilent: null }, { tab: hb.tab, t: now, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
        return;
      }
      // рыбалка (v4.49): не останавливаем никогда — после 3 перезагрузок за 20 мин просто перезагружаем реже (раз в 5 мин)
      if (plan.act === 'none') return;                // 20.43: рыбалка — не чаще раза в 5 мин, остальные задачи — раз в 15 мин
      if (plan.act === 'fishReload') {
        ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}) — рыбалка: перезагружаю вкладку (раз в 5 мин, не останавливаю)`;
        buf.push(ev); flush();
        await persist({ wdog: [...recent, now], ...silentNext() }, { tab: hb.tab, t: now, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.update(hb.tab, { url: origin + '/fishing.html' }); } catch (e) { if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e2) {} }
        return;
      }
      if (plan.act === 'stop') {
        // 20.43 (автономность): стоп — только после 2,5 ч непрерывной тишины (wdPlan), а не после 3 перезагрузок за 20 мин
        const since = +wdSilent?.since || hb.t;
        ev.what = `бот молчит ${Math.round((now - since) / 60000)} мин подряд (с ${new Date(since).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}), перезагрузки вкладки (${+wdSilent?.n || recent.length}) не помогли — останавливаю`;
        buf.push(ev); flush();
        const stopMeta = { source: 'watchdog', reason: ev.what, t: Date.now() };
        await chrome.storage.local.set({ on: false, wdog: recent, wdSilent: null, stopMeta });
        await afterOnWrite(on, false);
        await stopAlert(stopMeta, cfg);              // 20.43: уведомление и «!» — rt.status при стопе сторожа не меняется, меню читает stopMeta
        return;
      }
      if (plan.act === 'rareReload') {
        // 20.43: в журнал — только переход на редкие перезагрузки (начало серии), дальше молча до конца серии
        if (+wdSilent?.n === 3 || !wdSilent) { ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}), 3 перезагрузки не помогли — дальше перезагружаю раз в 15 мин, не останавливаю (стоп — после 2,5 ч тишины)`; buf.push(ev); flush(); }
        await persist({ wdog: [...recent, now], ...silentNext() }, { tab: hb.tab, t: now, page: hb.page });
        if (await stillCurrent()) try { await chrome.tabs.reload(hb.tab); } catch (e) {}
        return;
      }
      ev.what = `бот молчит ${Math.round(quiet / 1000)} с (${hb.page || '?'}) — перезагружаю вкладку ${recent.length + 1}/3`;
      buf.push(ev); flush();
      await persist({ wdog: [...recent, now], ...silentNext() }, { tab: hb.tab, t: now, page: hb.page }); // дать странице время загрузиться
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
// 20.43 (автономность): серия тишины окончена — пульс идёт ≥ 3 мин после последней перезагрузки; в журнал — конец серии (начало уже
// записано при переходе на редкие перезагрузки). Возвращает часть патча хранилища
function wdSilentHeal(S, hbT) {
  if (!S || !Number.isFinite(+S.last) || !Number.isFinite(hbT) || hbT - S.last < WD_HEAL_MS) return {};
  if (+S.n >= 3) { buf.push({ t: Date.now(), src: 'S', kind: 'сторож', what: `вкладка снова работает: тишина ${Math.round((hbT - (+S.since || hbT)) / 60000)} мин, перезагрузок ${S.n} — продолжаю как обычно`, st: '' }); flush(); }
  return { wdSilent: null };
}
// Release immediately when the owning tab is closed (no 90-second stale lock).
chrome.tabs.onRemoved.addListener(tabId => {
  serializeLock(async () => {
    const { lock } = await chrome.storage.local.get('lock');
    if (lock?.tab === tabId) await chrome.storage.local.set({ lock: null, hbBg: null });
    if (hbMem?.tab === tabId) { hbMem = null; hbPersistedAt = 0; }
  }).catch(e => console.warn('[L2bot] lock tab close', e));
});

// 20.10, лог06:56: чтение рюкзака из встроенного меню Firefox через фон, без запуска бота.
async function mammonBagDockAnalyze(m, sender) {
  const denied = reason => ({ ok: false, reason });
  try {
    const page = new URL(sender?.url || ''), menu = new URL(chrome.runtime.getURL('popup.html'));
    if (sender?.id !== chrome.runtime.id || page.protocol !== menu.protocol || page.host !== menu.host || page.pathname !== menu.pathname || page.searchParams.get('dock') !== '1'
      || !Number.isInteger(sender.frameId) || sender.frameId <= 0 || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0)
      return denied('Анализ доступен только из встроенного меню игры');
    if (typeof m.expectedChar !== 'string' || !m.expectedChar || !Number.isSafeInteger(m.goalItem) || m.goalItem < 0 || !Number.isSafeInteger(m.goalLvl) || m.goalLvl < 1 || m.goalLvl > 5)
      return denied('Некорректный запрос анализа рюкзака');
    const tab = await chrome.tabs.get(sender.tab.id), url = new URL(tab.url || '');
    if (url.protocol !== 'https:' || !/(^|\.)l2wap\.com$/i.test(url.hostname) || tab.pendingUrl)
      return denied('Вкладка игры закрыта или загружается — повторите анализ');
    const { rt = {}, cfg = {}, lock = null } = await chrome.storage.local.get(['rt', 'cfg', 'lock']);
    if (rt.char !== m.expectedChar) return denied('Персонаж изменился — обновите меню');
    if ((+cfg.mmGoalItem || 0) !== m.goalItem || (+cfg.mmGoalLvl || 5) !== m.goalLvl) return denied('Цель изменилась — обновите меню');
    if (Number.isInteger(lock?.tab) && Date.now() - (+lock.t || 0) < LOCK_TTL && lock.tab !== sender.tab.id)
      return denied('Управление у другой вкладки — откройте её меню');
    const command = { cmd: 'mammonBagAnalyze', expectedChar: m.expectedChar, goalItem: m.goalItem, goalLvl: m.goalLvl };
    let timer;
    try {
      const answer = await Promise.race([chrome.tabs.sendMessage(sender.tab.id, command, { frameId: 0 }),
        new Promise(resolve => { timer = setTimeout(() => resolve(denied('Вкладка игры не ответила на анализ — обновите страницу')), 20000); })]);
      return answer?.ok === true ? { ok: true } : denied(typeof answer?.reason === 'string' ? answer.reason.slice(0, 220) : 'Не удалось прочитать рюкзак — обновите вкладку игры');
    } finally { clearTimeout(timer); }
  } catch (_) { return denied('Не удалось передать анализ во вкладку игры — обновите страницу'); }
}

// 20.33 (скрин20.10 14:31): Firefox не даёт tabs встроенному меню; фон адресует только его родителя.
async function lifestoneDockCommand(m, sender) {
  const denied=reason=>({ok:false,reason});
  try {
    const page=new URL(sender?.url||''),menu=new URL(chrome.runtime.getURL('popup.html'));
    if(sender?.id!==chrome.runtime.id||page.protocol!==menu.protocol||page.host!==menu.host||page.pathname!==menu.pathname||page.searchParams.get('dock')!=='1'
      ||!Number.isInteger(sender.frameId)||sender.frameId<=0||!Number.isInteger(sender.tab?.id)||sender.tab.id<0)return denied('Команда ЛС доступна только из встроенного меню игры');
    if(!['scan','prepare','resume','pause','reconcile','acknowledge','close','wake'].includes(m.action)||typeof m.char!=='string'||!m.char)return denied('Некорректная команда ЛС');
    const tab=await chrome.tabs.get(sender.tab.id),url=new URL(tab.url||'');
    if(url.protocol!=='https:'||!/(^|\.)l2wap\.com$/i.test(url.hostname)||tab.pendingUrl)return denied('Вкладка игры закрыта или загружается — повторите команду ЛС');
    const state=await chrome.storage.local.get(['rt','on']);
    if(state.rt?.char!==m.char)return denied('Персонаж изменился — обновите раздел ЛС');
    const command={cmd:'lifestoneCommand',action:m.action,char:m.char};
    if(m.action==='wake'||m.startContext){
      const context=m.startContext;
      if(context?.on!==true||!Number.isSafeInteger(context?.kick)||context.kick<0||!state.on||context.kick!==(+(state.rt?.manualKickAt)||0))return denied('Запуск ЛС изменился — повторите команду');
      command.startContext={on:true,kick:context.kick};
    }
    if(m.action==='wake'){
      if(!state.on)return denied('Бот остановлен');
      Object.assign(command,{cmd:'kick',expectedChar:m.char,expectedKick:m.startContext.kick});delete command.action;delete command.char;delete command.startContext;
    }
    if(m.action==='scan'){
      const context=m.scanContext;
      if(typeof context?.on!=='boolean'||!Number.isSafeInteger(context?.kick)||context.kick<0
        ||context.on!==!!state.on||context.kick!==(+(state.rt?.manualKickAt)||0))return denied('Управление изменилось — обновите список оружия');
      command.scanContext={on:context.on,kick:context.kick};
    }
    let timer;
    try {
      const answer=await Promise.race([chrome.tabs.sendMessage(sender.tab.id,command,{frameId:0}),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(denied('Вкладка игры не ответила на команду ЛС — обновите страницу')),30000);})]);
      if(m.action==='wake'&&answer?.ok===true&&(!answer.running||!answer.owner||answer.v!==chrome.runtime.getManifest().version))return denied('Игра не подтвердила запуск — обновите её вкладку');
      return answer?.ok===true?{ok:true}:denied(typeof answer?.reason==='string'?answer.reason.slice(0,220):'Команда ЛС не выполнена — обновите вкладку игры');
    }finally{clearTimeout(timer);}
  }catch(_){return denied('Не удалось передать команду ЛС во вкладку игры — обновите страницу');}
}

// 20.43 (разбор 21.10): во встроенном меню Firefox (iframe с runtime/storage, без tabs) Старт, кнопки Warlock и проверки панели
// падали на chrome.tabs: kick не уходил (ложное «вкладка игры не отвечает»), неизвестную оплату кота нельзя было закрыть.
// Фон пересылает команду только родительской вкладке этого меню (frame 0) и только из белого списка; отправитель и герой —
// как у lifestoneDockCommand. Ответ — только поля, которые читает меню (роли «Предложить» — целиком: «Применить» пишет их в настройки).
// Ожидание ответа: kick 6 с (меню повторяет до 12 с, как в Chrome), кот 20 с, проверки панели 8–15 с.
const DOCK_GAME_WAIT = { kick: 6000, craftRead: 20000, warlockCommand: 20000, slots: 8000, suggest: 15000, dom: 15000 };
function dockGameAnswer(cmd, a) {
  if (!a || typeof a !== 'object') return null;
  const s = (x, n = 220) => typeof x === 'string' ? x.slice(0, n) : '', list = x => Array.isArray(x) ? x.slice(0, 400).map(y => s(y, 400)) : [];
  if (cmd === 'kick') return { ok: a.ok === true, v: s(a.v, 40), running: a.running === true, owner: a.owner === true, reason: s(a.reason) };
  if (cmd === 'warlockCommand' || cmd === 'craftRead') return { ok: a.ok === true, reason: s(a.reason) };
  if (cmd === 'slots') return { battle: a.battle === true, roles: list(a.roles), panel: list(a.panel) };
  if (cmd === 'suggest') return { battle: a.battle === true, roles: Object.fromEntries(Object.entries(a.roles && typeof a.roles === 'object' ? a.roles : {}).filter(([k]) => /^n[A-Z]\w{0,40}$/.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v : ''])),
    buffsNote: s(a.buffsNote, 400), why: list(a.why) };
  return { html: typeof a.html === 'string' ? a.html.slice(0, 1000000) : '', page: s(a.page, 80) };
}
async function dockGameCommand(m, sender) {
  const fail = (reason, retry = false) => ({ relayed: false, reason, retry });
  try {
    const page = new URL(sender?.url || ''), menu = new URL(chrome.runtime.getURL('popup.html'));
    if (sender?.id !== chrome.runtime.id || page.protocol !== menu.protocol || page.host !== menu.host || page.pathname !== menu.pathname || page.searchParams.get('dock') !== '1'
      || !Number.isInteger(sender.frameId) || sender.frameId <= 0 || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0) return fail('Команда доступна только из встроенного меню игры');
    const q = m?.message, cmd = q?.cmd;
    if (!q || typeof q !== 'object' || !Object.hasOwn(DOCK_GAME_WAIT, cmd) || typeof m.char !== 'string' || m.char.length > 64) return fail('Команда не поддерживается встроенным меню');
    let command = { cmd };
    if (cmd === 'craftRead') {
      if (!m.char || q.char !== m.char) return fail('Персонаж изменился — обновите крафт');
      command = { cmd, char: m.char };
    }
    if (cmd === 'warlockCommand') {
      const num = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
      if (!['preview', 'resetBudget', 'archiveUnknown'].includes(q.action) || typeof q.id !== 'string' || !q.id || q.id.length > 80 || !m.char || q.char !== m.char
        || !num(q.budgetEpoch) || !num(q.spent) || q.pendingId != null && (typeof q.pendingId !== 'string' || !q.pendingId || q.pendingId.length > 80)) return fail('Некорректная команда кота');
      command = { cmd, id: q.id, action: q.action, char: q.char, budgetEpoch: q.budgetEpoch, spent: q.spent, ...(q.pendingId != null ? { pendingId: q.pendingId } : {}) };
    }
    const tab = await chrome.tabs.get(sender.tab.id), url = new URL(tab.url || '');
    if (url.protocol !== 'https:' || !/(^|\.)l2wap\.com$/i.test(url.hostname) || tab.pendingUrl) return fail('Вкладка игры закрыта или загружается — повторите после загрузки', true);
    const { rt = {} } = await chrome.storage.local.get('rt');
    if ((rt.char || '') !== m.char) return fail('Персонаж изменился — обновите меню');
    const late = {}; let timer;
    try {
      const answer = await Promise.race([chrome.tabs.sendMessage(sender.tab.id, command, { frameId: 0 }),
        new Promise(resolve => { timer = setTimeout(() => resolve(late), DOCK_GAME_WAIT[cmd]); })]);
      if (answer === late) return fail(cmd === 'warlockCommand' ? 'Ответ ещё не получен. Команда могла быть принята; проверьте состояние перед повтором.' : 'Вкладка игры не ответила — обновите страницу', cmd !== 'warlockCommand');
      return { relayed: true, answer: dockGameAnswer(cmd, answer) };
    } finally { clearTimeout(timer); }
  } catch (_) { return fail('Не удалось передать команду во вкладку игры — обновите страницу', true); }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.cmd === 'dockGameCommand') {
    dockGameCommand(m, _s).then(reply).catch(() => reply({ relayed: false, reason: 'Команда не передана во вкладку игры', retry: false })); return true;
  }
  if (m?.cmd === 'mammonBagDockAnalyze') {
    mammonBagDockAnalyze(m, _s).then(reply).catch(() => reply({ ok: false, reason: 'Не удалось прочитать рюкзак' })); return true;
  }
  if(m?.cmd==='lifestoneDockCommand'){
    lifestoneDockCommand(m,_s).then(reply).catch(()=>reply({ok:false,reason:'Команда ЛС не выполнена'}));return true;
  }
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
  if (m?.cmd === 'alertClear') { try { chrome.notifications?.clear('l2bot-' + (m.id || 'alert')); chrome.storage.local.get('on').then(s => paintOn(s.on)).catch(() => {}); } catch (e) {} }   // v5.6: значок по факту «работает/стоит»
  // 20.41: прямая запись on:false (модуль/импорт памяти) — значок по факту; та же запись при уже остановленном боте значок не трогает
  // 20.43: …и «!» самоостановки по stopMeta (импорт памяти пишет свою причину — прежний «!» снимается)
  if (m?.cmd === 'badgeSync') chrome.storage.local.get(['on', 'stopMeta', 'cfg']).then(s => { const a = attnOf(s); if (!!s.on !== paintedOn || a !== attn) { attn = a; paintOn(s.on); } }).catch(() => {});
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
