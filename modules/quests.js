/* L2wap v7: isolated quests feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.quests = function create_quests(env) {
const location = env.routeLocation || root.location;
// 15.10 (лог 11:11): после ручного «Город» lastTeleport оставался Cruma, хотя герой уже в Дионе.
// Страница гильдии сама по себе не меняет координаты. Верим принятому снимку, а не URL/старому клику.
const CAMP_AT = 'l2bot.campaignAt';
let liveAt = null, locationCheck = null, pendingCheck = null;
const locationKey = s => JSON.stringify([s?.char, s?.id, s?.zone, s?.dung, s?.loc, s?.x, s?.y]);
function campSnapshot(ch) {
  if (!ch || ch.name !== env.rt.char || !ch.id || !Number.isSafeInteger(ch.revision) ||
      !['currentZoneId', 'locationType', 'worldX', 'worldY'].every(k => Object.hasOwn(ch, k))) return null; // частичный delta не означает ухода
  return { char: ch.name, id: ch.id, rev: ch.revision, zone: ch.currentZoneId == null ? null : String(ch.currentZoneId),
    dung: ch.activeDungeonId || null, loc: String(ch.locationType || ''),
    x: Number.isFinite(ch.worldX) ? ch.worldX : null, y: Number.isFinite(ch.worldY) ? ch.worldY : null, t: Date.now() };
}
function campLocationNote(path, d) {
  const pending = env.rt.campaignTp, isReply = pending && pending.char === env.rt.char && pending.url === location.pathname &&
    /^\/game\/story-quests\/(?:dion-campaign|starter-saga)\/(?:teleport|transport)$/.test(path) && d.method === 'POST' &&
    (d.req?.teleportId || d.req?.transportId) === pending.id && Number.isSafeInteger(d.req?.expectedRevision) && d.req.expectedRevision >= pending.rev;
  // 409 native UI повторяет самостоятельно: пока второй запрос не ответил, это ещё не доказанный отказ операции.
  if (isReply && !pending.ack && d.req.expectedRevision === pending.rev && !d.error && d.status !== 409 && d.status >= 200 && d.status < 500 && (d.res?.error || d.res?.ok === false) &&
      (!d.res?.character || d.res.character.id === pending.charId && d.res.character.name === pending.char)) {
    const ack = { ...pending, refused: { status: d.status, t: Date.now(), reason: String(d.res.error || 'отказ сервера').slice(0, 120) } };
    try { root.sessionStorage?.setItem('l2bot.campaignTp', JSON.stringify(ack)); } catch (_) {}
    if (env.tabOwner !== false) env.setRt({ campaignTp: ack });
    return;
  }
  if (d.error || d.status < 200 || d.status >= 300 || d.res?.error || d.res?.ok === false) return;
  const s = campSnapshot(d.res?.character); if (!s) return;
  let old = liveAt || env.rt.campaignAt;
  try { const saved = JSON.parse(root.sessionStorage?.getItem(CAMP_AT) || 'null'); if (saved?.char === s.char && (!old || saved.rev > old.rev)) old = saved; } catch (_) {}
  if (old?.char === s.char && (old.id !== s.id || old.rev > s.rev)) { liveAt = old; return; }
  liveAt = s;
  const q = d.res?.quest, points = [q?.npc, q?.scout, q?.townNpc].filter(p => p?.teleportId && Number.isFinite(p.worldX) && Number.isFinite(p.worldY)).map(p => ({ tp: p.teleportId, x: p.worldX, y: p.worldY }));
  if (points.length && env.tabOwner !== false && JSON.stringify(points) !== JSON.stringify(env.rt.campaignPoints)) env.setRt({ campaignPoints: points });
  try { root.sessionStorage?.setItem(CAMP_AT, JSON.stringify(s)); } catch (_) {}
  if (env.tabOwner !== false && locationKey(env.rt.campaignAt) !== locationKey(s)) env.setRt({ campaignAt: s });
  const p = env.rt.campaignTp;
  if (!p || p.char !== s.char || p.charId !== s.id || p.kick !== (+env.rt.manualKickAt || 0) || p.chapter !== chapterKey() || p.url !== location.pathname ||
      !/^\/game\/story-quests\/(?:dion-campaign|starter-saga)\/(?:teleport|transport)$/.test(path) || d.method !== 'POST' ||
      (d.req?.teleportId || d.req?.transportId) !== p.id || !Number.isSafeInteger(d.req?.expectedRevision) ||
      d.req.expectedRevision < p.rev || s.rev <= d.req.expectedRevision) return;
  // Native UI может единожды повторить 409 с новой ревизией. Только точный принятый POST подтверждает намерение.
  const ack = { ...p, ack: s, refused: null };
  try { root.sessionStorage?.setItem('l2bot.campaignTp', JSON.stringify(ack)); } catch (_) {}
  if (env.tabOwner !== false) env.setRt({ campaignTp: ack });
}
const samePoint = (a, b) => a?.id === b?.id && !b?.dung && a?.x != null && a?.y != null && a.x === b.x && a.y === b.y && (b.loc !== 'city' || a.loc === 'city');
const chapterKey = () => JSON.stringify([env.rt.storySaga?.stage, env.rt.dionCampaign?.chapter]);
function campReached(tp, s) {
  if (!s || s.char !== env.rt.char) return null;
  const a = env.rt.campaignAnchor;
  if (a?.tp === tp && a.at?.id === s.id && a.at.loc !== 'city' && s.loc === 'city') return false;
  if (s.zone === tp && !s.dung) return true;
  if (!s.dung && a?.tp === tp && samePoint(a.at, s)) return true;
  if (!s.dung && env.rt.campaignPoints?.some(p => p.tp === tp && p.x === s.x && p.y === s.y)) return true;
  if (s.zone || s.dung || /^(?:city|dungeon)$/.test(s.loc)) return false;
  return null;
}
function campGuard(requireEnabled = true) {
  const char = env.rt.char, kick = +env.rt.manualKickAt || 0, chapter = chapterKey(), enabled = !!env.cfg.campaign, auto = env.cfg.campAuto;
  return () => env.on !== false && env.tabOwner !== false && env.canAct?.() !== false && char === env.rt.char &&
    kick === (+env.rt.manualKickAt || 0) && chapter === chapterKey() && enabled === !!env.cfg.campaign && auto === env.cfg.campAuto && (!requireEnabled || campEnabled());
}
async function campReadAt(active, force = false) {
  const key = JSON.stringify([env.rt.char, +env.rt.manualKickAt || 0]);
  if (!force && liveAt?.char === env.rt.char && (!locationCheck || locationCheck.key === key) && Date.now() - liveAt.t < 15000) return liveAt;
  if (!force && locationCheck?.key === key && Date.now() - locationCheck.t < 5000) return locationCheck.at;
  locationCheck = { key, t: Date.now(), at: null };
  try {
    const r = await env.gameGet('/character'), j = r.ok ? await r.json() : null;
    if (!active()) return null;
    const s = campSnapshot(j?.character); if (!s) return null;
    campLocationNote('/character', { status: 200, res: j });
    if (liveAt?.id !== s.id || liveAt.rev > s.rev) return null;
    locationCheck.at = liveAt; return liveAt;
  } catch (_) { return null; }
}
async function campLocationStep() {
  if (location.pathname !== '/map.html' || env.rt.actionOwner || !campEnabled()) return false;
  const tp = campOpen().find(t => t.tp)?.tp; if (!tp) return false;
  const active = campGuard(), s = await campReadAt(active); if (!active()) return true;
  if (!s) { env.setStatus('Кампания: жду подтверждения текущей локации'); return true; }
  const reached = campReached(tp, s);
  if (reached === true && !env.rt.campaignTp) return false;
  // Не сканируем десятки страниц чужой карты, даже если там есть те же мобы.
  await env.setRt({ campaignDue: true }); if (!active()) return true;
  env.rec('B', 'кампания', `проверяю точку главы: ${s.zone || s.loc || '?'} → ${tp}`);
  await goCampaign(); return true;
}
// NPC: совпадение города/зоны не означает близость к конкретному квестовому NPC.
function campNpcReached(tp, s) {
  if (!s || s.char !== env.rt.char || s.dung) return false;
  const a = env.rt.campaignAnchor;
  return !!(a?.npc && a.tp === tp && samePoint(a.at, s) || env.rt.campaignPoints?.some(p => p.tp === tp && p.x === s.x && p.y === s.y));
}
async function campNpcTeleport(btn, active) {
  const tp = btn?.dataset?.questTeleportId || btn?.dataset?.questTransportId;
  if (!tp || !active()) return false;
  return campTeleport(tp, btn, active, { npc: true });
}
async function campTeleport(tp, btn, active, options = {}) {
  let p = env.rt.campaignTp;
  if (p) {
    try { const cancelled = JSON.parse(root.sessionStorage?.getItem('l2bot.campaignTpCancelled') || 'null');
      if (cancelled?.nonce === p.nonce && !!p.nonce && cancelled.charId === p.charId && cancelled.id === p.id) { await env.setRt({ campaignTp: null }); p = null; } } catch (_) {}
  }
  if (p) {
    try { const a = JSON.parse(root.sessionStorage?.getItem('l2bot.campaignTp') || 'null');
      if (a?.nonce === p.nonce && !!p.nonce && a.id === p.id && a.charId === p.charId && a.kick === p.kick) p = a; } catch (_) {}
    if (p.char !== env.rt.char) { env.setStatus('Кампания: неподтверждённый телепорт другого персонажа; повтор запрещён'); return false; }
  }
  const pendingKey = p && JSON.stringify([p.nonce, env.rt.char, +env.rt.manualKickAt || 0, chapterKey(), p.ack?.rev, p.refused?.reason, liveAt?.rev]);
  if (pendingKey && pendingCheck?.key === pendingKey && Date.now() - pendingCheck.t < 5000) { env.setStatus('Кампания: жду подтверждения телепорта; повторно не отправляю'); return false; }
  let s = await campReadAt(active, true); if (!active()) return false;
  const sameRoute = !p || p.id === tp && p.kick === (+env.rt.manualKickAt || 0) && p.chapter === chapterKey();
  if (sameRoute && p?.ack && (!s || p.ack.rev >= s.rev) && (!liveAt || liveAt.char !== p.char || p.ack.rev >= liveAt.rev)) s = p.ack;
  const destination = p?.id || tp, npc = p ? !!p.npc : !!options.npc;
  const confirmed = s && (!p || s.id === p.charId && s.rev > p.rev) && ((npc ? campNpcReached(destination, s) : campReached(destination, s)) === true ||
    p?.ack && p.ack.id === s.id && !s.dung && (locationKey(p.ack) === locationKey(s) || samePoint(p.ack, s)));
  if (confirmed) {
    // После Stop/смены главы только сверяем уже выполненное намерение; старую команду не повторяем.
    await env.setRt({ lastTeleport: destination, campaignAnchor: { tp: destination, at: s, ...(npc ? { npc: true } : {}) }, campaignTp: null, chainQ: [], chainWhy: '' });
    try { root.sessionStorage?.removeItem('l2bot.campaignTp'); } catch (_) {}
    if (!active()) return false;
    return destination === tp ? true : campTeleport(tp, btn, active, options);
  }
  if (p?.refused) {
    await env.setRt({ campaignTp: null, campaignTpRetry: { id: p.id, until: Date.now() + 30000, reason: p.refused.reason } });
    try { root.sessionStorage?.removeItem('l2bot.campaignTp'); } catch (_) {}
    env.setStatus(`Кампания: телепорт отклонён (${p.refused.reason}); проверю через 30 секунд`); return false;
  }
  if (p) { pendingCheck = { key: pendingKey, t: Date.now() }; env.setStatus('Кампания: результат телепорта не подтверждён; повторная отправка запрещена'); return false; }
  if (env.rt.campaignTpRetry?.id === tp && env.rt.campaignTpRetry.until > Date.now()) { env.setStatus('Кампания: жду повторной проверки после отказа телепорта'); return false; }
  if (!s || !btn || btn.disabled) { env.setStatus('Кампания: нет подтверждения позиции или доступной кнопки телепорта'); return false; }
  await env.pause(); if (!active()) return false;
  p = { ...(options.npc ? { npc: true } : {}), nonce: Date.now() + ':' + Math.random().toString(36).slice(2), id: tp, char: s.char, charId: s.id, rev: s.rev, kick: +env.rt.manualKickAt || 0, chapter: chapterKey(), url: location.pathname, t: Date.now() };
  const written = await env.setRt({ campaignTp: p });
  const notSent = async () => { // Достоверно знаем: fire ещё не вызывался (либо вернул false).
    try { root.sessionStorage?.setItem('l2bot.campaignTpCancelled', JSON.stringify(p)); } catch (_) {}
    if (env.rt.campaignTp?.nonce === p.nonce && env.rt.campaignTp?.charId === p.charId) await env.setRt({ campaignTp: null });
    return false;
  };
  if (written?.ok === false || env.rtCommit && !await env.rtCommit() || !active()) return notSent();
  if (env.fire(btn) === false) return notSent();
  await env.waitFor(() => env.rt.campaignTp?.ack || env.rt.campaignTp?.refused || !active(), 8000, 100);
  if (!active()) return false;
  // Повторный проход лишь сверяет ACK/GET; отправка уже сохранённого намерения невозможна.
  return campTeleport(tp, btn, active, options);
}

function questLinesInLog() {
  return env.logLines().map(l => l.match(env.QLINE)).filter(Boolean)
    .map(m => ({ label: m[1].replace(/[★·\s]+$/, '').trim(), done: +m[2], total: +m[3], left: m[4] != null ? +m[4] : Math.max(0, +m[3] - +m[2]) }));
}

// 10.0.10 (лог 13.10 18:17–18:58, alt1 Human Fighter 12→17): игрок взял «Путь новичка» руками, бот 20 скелетов не добил —
// кампания с 7.2.1 выключена (игрок на Warlock вёл квесты сам), кнопка «📜 Кампания» спрятана, автофарм улетел с точки квеста.
// Теперь: сюжетный квест новичка (GET /game/story-quests/starter-saga — карта опрашивает сама) не пройден, уровень подходит и герой
// ещё молодой (< 40) → кампания включается сама (cfg.campAuto, галка «★ Сюжетные квесты новичка — вести самому»); у Warlock 67 ничего не меняется
const CAMP_AUTO_MAX_LVL = 40;
// 10.0.27 (лог 15.10 20:25): принятая новая кампания отменяет адрес и цели старой.
const STARTER = '/starter-story-quest.html', DION = '/dion-campaign.html';
const campPath = () => (env.rt.campaignUrl || '').split('?')[0];
const activeDion = () => env.rt.dionCampaign?.stage === 'active' && !env.rt.dionCampaign.completed;
function resetChapter(url) {
  return { campaign: null, campaignUrl: url, campaignDue: true, sinceCamp: 0, questListT: 0,
    qAlias: {}, quests: {}, questTargets: [], questSeen: {}, needChamps: false, lastTeleport: '',
    campEmptyPage: 0, campSkipUntil: 0, campActTry: 0, campOpenTry: 0, npcTried: 0, campCompletionWait: null };
}
function dionNote(q) {
  if (!q || !['not_started', 'active', 'completed'].includes(q.stage)) return;
  const old = env.rt.dionCampaign, chapter = Number(q.chapter);
  if (!Number.isInteger(chapter) || chapter < 1) return;
  // Поздний ответ карты не возвращает уже сданную главу и завершённую цепочку.
  if (old && (chapter < old.chapter || old.completed && !(q.completed || q.stage === 'completed') || old.stage === 'active' && q.stage === 'not_started')) return;
  const S = { stage: q.stage, completed: !!q.completed || q.stage === 'completed', chapter,
    title: q.chapterTitleRu || q.chapterTitleUk || q.titleRu || '', minLevel: +q.minLevel || 20, t: Date.now(),
    level: Number.isSafeInteger(q.level) && q.level > 0 ? q.level : null, atNpc: typeof q.location?.atNpc === 'boolean' ? q.location.atNpc : null,
    owner: JSON.stringify([env.rt.char || '', env.rt.classCur?.prof || env.rt.prof || '', env.rt.classCur?.slot ?? null]) };
  const changed = !old || old.stage !== S.stage || old.chapter !== chapter || old.completed !== S.completed;
  const take = S.stage === 'active' && !S.completed && (changed || campPath() !== DION);
  env.setRt({ dionCampaign: S, ...(take ? resetChapter(DION) : S.completed && campPath() === DION ? resetChapter('') : {}) });
}
function staleCampaignPage() {
  return location.pathname === STARTER && (activeDion() || env.rt.storySaga?.completed || env.rt.storySaga?.stage === 'completed');
}
async function leaveOldCampaign() {
  if (!env.on) return;
  const url = activeDion() ? DION : '/character-quests.html';
  env.setStatus('Кампания: сверяю следующую главу');
  location.href = url; await env.sleep(1000);
}
function sagaNote(q) {                            // ответ /game/story-quests/starter-saga → rt.storySaga
  if (!q || typeof q !== 'object') return;
  const S = { id: q.questId || '', title: q.titleRu || q.titleUk || q.title || '', stage: q.stage || '', completed: !!q.completed,
              minLevel: +q.minLevel || 0, lvl: +q.effectiveLevel || 0, tp: q.scout?.teleportId || '', t: Date.now() };
  const o = env.rt.storySaga;
  if (o && o.stage === S.stage && o.completed === S.completed && o.minLevel === S.minLevel && o.lvl === S.lvl && Date.now() - (o.t || 0) < 600000) return;
  if (o?.completed && !S.completed) return;
  const owns = !campPath() || campPath() === STARTER;
  const changed = !o || o.stage !== S.stage || o.completed !== S.completed;
  env.setRt({ storySaga: S, ...(owns && changed ? resetChapter(activeDion() ? DION : S.completed ? '' : STARTER) : {}) });
}
function campAuto() {
  if (env.cfg.campAuto === false || env.cfg.campaign) return false;
  const S = activeDion() ? env.rt.dionCampaign : env.rt.storySaga; if (!S || S.completed || S.stage === 'completed') return false;
  const lvl = env.heroLvl() || S.lvl || 0;
  if (!lvl || lvl < (S.minLevel || 0) || lvl >= CAMP_AUTO_MAX_LVL) return false;
  if (env.rt.campAutoOn !== S.title) { env.setRt({ campAutoOn: S.title, campaignDue: true }); env.rec('B', 'квест', `сюжетный квест «${S.title}» не пройден (${S.stage || '?'}), герой ${lvl} ур. → веду кампанию сам (авто; снять: галка в «Охоте»)`); }
  return true;
}
const campEnabled  = () => !!env.cfg.campaign || campAuto();

// 27.10.2026 (лог 02:46): глава9 готова, но герой35/minLevel36 уже у NPC. Ожидание не превращает каждую победу в новую сдачу.
const CAMP_COMPLETE_RETRY = 120000, CAMP_STATE_FRESH = 60000;
const campCompletionOwner = () => JSON.stringify([env.rt.char || '', env.rt.classCur?.prof || env.rt.prof || '', env.rt.classCur?.slot ?? null]);
const campCompletionKey = () => JSON.stringify([campCompletionOwner(), campPath(), chapterKey(), +env.rt.manualKickAt || 0]);
function completionDion() {
  const D=env.rt.dionCampaign,now=Date.now();
  return campPath()===DION && D?.stage==='active' && !D.completed && D.owner===campCompletionOwner() && D.t<=now+1000 && now-D.t<=CAMP_STATE_FRESH ? D : null;
}
function campCompletionWait() {
  const W=env.rt.campCompletionWait;if(!W || !campEnabled() || W.key!==campCompletionKey())return null;
  const button=location.pathname===campPath() && env.$q('[data-action="complete-chapter"]');
  if(button && !button.disabled && env.shown(button))return null; // живая кнопка важнее прежнего предположения об уровне
  if(W.kind==='level') {
    const D=completionDion();if(D && D.minLevel!==W.minLevel)return null;
    const level=Math.max(+env.heroLvl?.()||0,D?.level||0);
    return Number.isSafeInteger(W.minLevel) && W.minLevel>0 && level<W.minLevel ? W : null;
  }
  return W.kind==='retry' && Number.isFinite(W.until) && W.until>Date.now() ? W : null;
}
const campActive   = () => campEnabled() && !campCompletionWait() && (env.rt.campaign?.targets || []).length > 0;

const campOpen     = () => (env.rt.campaign?.targets || []).filter(t => !t.ok);

const campMobOpen  = () => campEnabled() ? campOpen().filter(t => !t.objective && !t.rb).map(t => t.name.toLowerCase()) : [];

const campRbOpen   = () => campActive() ? campOpen().filter(t => t.rb) : [];

const campChampOpen = () => campOpen().some(t => t.champ);

const campChampMin  = () => campActive() ? Math.max(0, ...campOpen().filter(t => t.champ).map(t => t.minLvl || 0)) : 0;

function isQuestName(name, mapQuest = env.rt.questTargets || []) {   // моб — цель: по метке ★ карты или по условиям главы
  const n = (name || '').toLowerCase();
  if (!n) return false;
  if (campEnabled() && (env.rt.campaign?.targets || []).length) { // ожидание сдачи не возвращает готовым целям старые ★ метки карты
    const t = env.rt.campaign.targets.find(x => !x.objective && x.name.toLowerCase() === n);
    if (t) return !t.ok;                         // цель главы уже выполнена — больше не приоритет
  }
  // 7.1.30: цель уже набрана («Квест: Dire Wyrm 15 / 15», квест профессии) — ★ в списке карты остаётся, но бить её незачем
  const done = Object.entries(env.rt.quests || {}).find(([k, q]) => k.toLowerCase() === n && q && q.prof && q.total > 0 && q.left === 0 && Date.now() - (q.t || 0) < 12 * 3600000);
  if (done) return false;
  if (env.rt.questSeen?.[n] && Date.now() - env.rt.questSeen[n] < 6 * 3600000) return true;   // ★ из списка локации
  return mapQuest.some(q => q.toLowerCase() === n);
}

async function applyQuestLog(killed = [], champKill = false) {
  const out = { changes: [], closed: [], verify: false };
  const C = env.rt.campaign;
  if (!C?.targets?.length) return out;
  const targets = C.targets.map(t => ({ ...t })), alias = { ...(env.rt.qAlias || {}) };
  const kl = killed.filter(Boolean).map(k => k.toLowerCase());
  const best = {};                               // по каждой метке — максимальный прогресс в логе
  for (const q of questLinesInLog()) if (!best[q.label] || q.done > best[q.label].done) best[q.label] = q;
  let champLine = false;
  for (const q of Object.values(best)) {
    let t = alias[q.label] ? targets.find(x => x.name === alias[q.label]) : null;
    if (!t) {
      if (/чемпион|champion/i.test(q.label)) t = targets.find(x => x.champ);
      else {
        const pool = targets.filter(x => !x.objective && x.total === q.total && x.done < q.done);
        t = pool.find(x => kl.includes(x.name.toLowerCase())) || (pool.length === 1 ? pool[0] : null);
      }
      if (t) { alias[q.label] = t.name; out.changes.push(`«${q.label}» = ${t.name}`); }
    }
    if (!t || t.total !== q.total || q.done < t.done || (q.done === t.done && !t.est)) continue;
    if (t.champ) champLine = true;
    out.changes.push(`${t.name} ${t.done}→${q.done}/${q.total}`);
    t.done = q.done; t.est = false;
    if (!t.ok && (q.left === 0 || q.done >= q.total)) { t.ok = true; out.closed.push(t.name); }
  }
  // чемпионы: строки в логе может не быть — считаем сами (≈) и сверяем со страницей кампании, когда «должно хватить»
  const ch = targets.find(x => x.champ && !x.ok);
  if (champKill && ch && !champLine) {
    ch.done++; ch.est = true;
    out.changes.push(`${ch.name} ≈${ch.done}/${ch.total}`);
    if (ch.done >= ch.total) out.verify = true;
  }
  if (out.changes.length) await env.setRt({ campaign: { ...C, targets, live: Date.now() }, qAlias: alias, needChamps: targets.some(x => x.champ && !x.ok) });
  return out;
}

function questProgress() {                      // { done, total, left, label } или null
  const fresh = ['#battle-victory-inline', '#battle-victory-root'].map(x => env.$q(x)?.innerText || '').join('\n');
  const src = /(осталось|залишилось)\s*\d/i.test(fresh) ? fresh : ((env.$q('#battle-content') || document.body).innerText);
  const pm = src.match(/(\d+)\s*\/\s*(\d+)\s*·\s*(?:осталось|залишилось)\s*(\d+)/i);
  if (!pm) return null;
  const label = src.match(/Квест\s*[·:]\s*([^\n\d|]+)/i)?.[1].trim();   // v5.5.1: и «Квест: …»
  return { done: +pm[1], total: +pm[2], left: +pm[3], label, fresh: src === fresh };
}

const questRate  = q => (q.drops + 1) / (q.kills + 2);

const questFights = q => q.left > 0 ? Math.ceil(q.left / questRate(q)) : 0;

async function trackQuest(name, isQuestKill) {
  if (!name) return null;
  const quests = { ...(env.rt.quests || {}) };
  const prev = quests[name] || { kills: 0, drops: 0 };
  const q = questProgress();
  // прогресс засчитываем этому мобу, если он квестовый и число выросло (защита от старых строк лога)
  const ok = q && (isQuestKill || quests[name]) && (!prev.total || q.total === prev.total) &&
             (prev.done == null || q.done > prev.done || (q.left > 0 && prev.left === 0)) && (q.fresh || isQuestKill);   // v5.6: квест начался заново
  if (!isQuestKill && !ok) return null;
  const drop = ok ? (prev.done == null ? 1 : Math.max(q.done > prev.done ? q.done - prev.done : 1, 0)) : 0;
  quests[name] = { ...prev, kills: prev.kills + (isQuestKill ? 1 : 0), drops: prev.drops + drop, t: Date.now(),
                   ...(ok ? { done: q.done, total: q.total, left: q.left, label: q.label || prev.label || '' } : {}) };
  env.setRt({ quests })?.catch?.(() => {});   // 20.41: после победы не ждём запись памяти 1,3 МБ; память вкладки обновлена сразу
  const Q = quests[name];
  if (Q.total) console.log(env.TAG, `квест ${name}: ${Q.done}/${Q.total}, осталось ${Q.left}, дроп ${Q.drops}/${Q.kills}, ≈${questFights(Q)} боёв`);
  const tracked = Object.values(quests).filter(x => x.total);
  return tracked.length && tracked.every(x => x.left === 0) ? tracked.map(x => x.label || 'квест').join(', ') : null;
}

function questsFor(targets) {
  const names = (targets || []).filter(t => !t.objective).map(t => (t.name || '').toLowerCase()).filter(Boolean);
  const keep = {};
  for (const [mob, q] of Object.entries(env.rt.quests || {})) {
    const m = mob.toLowerCase();
    if (names.some(n => n === m || n.includes(m) || m.includes(n))) keep[mob] = q;
  }
  return keep;
}

function questSummary() {                        // для индикатора
  if (campActive()) {
    const short = n => n.split(/\s+/).slice(-1)[0];
    return ' · 📜 ' + env.rt.campaign.targets.map(t => `${t.objective ? t.name : short(t.name)} ${t.ok ? '✓' : (t.est ? '≈' : '') + t.done + '/' + t.total}`).join(' · ');
  }
  const qs = Object.values(env.rt.quests || {}).filter(q => q.total && q.left > 0);
  if (!qs.length) return '';
  return ' · ★ ' + qs.map(q => `${q.left} (≈${questFights(q)} б.)`).join(', ');
}

const isCampaignPage = () => !!env.rt.campaignUrl && location.pathname === env.rt.campaignUrl.split('?')[0];

const isQuests = () => /\/character-quests\.html/i.test(location.pathname);

const campOn = () => (campEnabled() && !campCompletionWait() && Date.now() >= (env.rt.campSkipUntil || 0)) || (!!env.rt.campOnce && !!env.rt.campaignDue);

// 23.10.2026, лог 12:47–12:48: Noblesse выбирался первым в «Мои квесты», но общая кампания не знает его DOM.
// Готовые части Noblesse/сабкласса сдаёт story, а ★ цели продолжаем бить на карте без отключения режима квестов.
const separateQuest = href => { try { return /^\/(?:noblesse|subclass)-quest\.html$/i.test(new URL(href, location.origin).pathname); } catch (_) { return false; } };
const separateOnly = list => list.length > 0 && list.every(q => separateQuest(q.href));
async function separateHunt(active, list) {
  if (!active()) return;
  const title = 'Квесты Noblesse / сабкласса', changed = env.rt.campaign?.title !== title;
  const saved = await env.setRt({ campaign: { title, targets: [], t: Date.now() }, campaignUrl: '', campaignDue: false,
    campaignViaMail: false, campOnce: false, sinceCamp: 0, campSkipUntil: 0, campOpenTry: 0, campActTry: 0,
    ...(list ? { questList: list, questListT: Date.now() } : {}) });
  if (!active() || saved?.ok === false) return;
  if (changed) env.rec('B', 'кампания', 'Noblesse / сабкласс: продолжаю ★ охоту на карте; готовую часть сдаёт отдельная служба квеста');
  if (location.pathname !== '/map.html') return env.goOutskirts();
}

async function goCampaign() {
  const active = campGuard(false); if (!active()) return;
  if(campCompletionWait() && !(env.rt.campOnce && env.rt.campaignDue))return;
  if (staleCampaignPage()) return leaveOldCampaign();
  if (activeDion() && campPath() !== DION) await env.setRt(resetChapter(DION));
  if (env.isCampaign() || /\/starter-story-quest\.html$/i.test(location.pathname)) return campaign();
  // v5.5.4 (лог 08.10 21:38): бот помнил адрес пройденной цепочки («Путь новичка», /starter-story-quest.html) и открывал
  // его по кругу, а активный квест — «Тень над Дионом» (/dion-campaign.html). Источник правды — «Персонаж → Мои квесты»:
  // туда — раз в 10 мин и всегда, когда запомненной главы в этом списке нет
  if (isQuests()) return questsStep();
  if (env.isMail() && env.rt.campaignViaMail) return mailStep();   // v5.6: «Мои квесты» пусты — путь через почту (раньше: квесты ↔ почта по кругу)
  // 10.0.10: сюжетный квест новичка ещё идёт (storySaga) и адрес главы не запомнен — сразу на его страницу, без «Мои квесты» и почты
  if ((!env.rt.campaignUrl || separateQuest(env.rt.campaignUrl)) && env.rt.storySaga && !env.rt.storySaga.completed) {
    env.setStatus('Кампания: открываю сюжетный квест новичка'); location.href = '/starter-story-quest.html'; await env.sleep(4000); return;
  }
  const pathOf = h => { try { return new URL(h, location.origin).pathname; } catch (e) { return String(h || '').split('?')[0]; } };
  const QL = env.rt.questList || [], inList = !!env.rt.campaignUrl && QL.some(q => q.href && pathOf(env.rt.campaignUrl) === pathOf(q.href));
  if (activeDion() && campPath() === DION && location.pathname !== DION) { if (!active()) return; location.href = DION; await env.sleep(1000); return; }
  if (separateQuest(location.pathname) || separateQuest(env.rt.campaignUrl)) {
    if (!QL.some(q => q.href && !separateQuest(q.href))) return separateHunt(active);
    // Старая специализированная страница не закрывает настоящую главу из смешанного списка.
    const saved = await env.setRt({ campaign: null, campaignUrl: '', campaignDue: true });
    if (!active() || saved?.ok === false) return;
    location.href = '/character-quests.html'; await env.sleep(1000); return;
  }
  // Повторный campaignDue не открывает тот же список до обычного срока перечитывания; ★ охота остаётся включена.
  if (separateOnly(QL) && env.rt.questListT && Date.now() - env.rt.questListT < 10 * 60000) return separateHunt(active);
  if (!env.rt.questListT || Date.now() - env.rt.questListT > 10 * 60000 || (env.rt.campaignUrl && !inList)) {
    env.setStatus('Кампания: открываю «Персонаж → Мои квесты»'); location.href = '/character-quests.html'; await env.sleep(4000); return;
  }
  // v5.5.1 (лог 08.10 20:33): страница сюжетного квеста открылась, но целей на ней нет — сначала надо нажать карточку NPC
  // («Старейшина Торен · Сюжетная цепочка»). Бот этого не знал и перезагружал страницу каждые 5 с, 47 с до ручного клика.
  // Теперь: уже на странице главы — ждём цели, жмём карточку NPC; не вышло 3 раза — фармим дальше, глава подождёт 10 мин
  if (env.rt.campaignUrl && location.pathname === env.rt.campaignUrl.split('?')[0]) {
    const got = await env.waitFor(env.isCampaign, 4000, 200);
    if (!active()) return;
    if (got) return campaign();
    // v5.5.2 (лог 08.10 21:14): «Первая цель выполнена. Найди полевого разведчика…» — глава ждёт кнопку действия
    // (#starter-story-actions: «Поговорить» data-action="meet-scout" и т.п.). Жмём её; игра ответила ошибкой (не у NPC) —
    // «Телепорт» к точке главы (.l2-starter-story-location [data-quest-teleport-id]), вернуться и нажать снова
    const actBtn = [...document.querySelectorAll('#starter-story-actions button[data-action], [id$="-actions"] button[data-action], .l2-captain-andrei-btn[data-action]')]
      .find(b => env.shown(b) && !b.disabled && b.dataset.action !== 'complete-chapter');
    if (actBtn && (env.rt.campActTry || 0) < 4) {
      if (await pressAction(actBtn) === 'ok' && env.isCampaign()) return campaign();   // 10.0.10: общий код с campaign()
      return;                                       // следующий проход: глава открыта / снова кнопка
    }
    if (actBtn) { env.rec('B', 'кампания', 'кнопка действия главы 4 раза не помогла — фармлю, проверю позже'); await env.setRt({ campActTry: 0, questListT: 0, campaignDue: false, sinceCamp: Math.max(0, (env.cfg.campaignEvery || 25) - 10) }); return env.goOutskirts(); }
    const npcCard = [...document.querySelectorAll('.l2-captain-andrei-npc, [class*="-npc"][role="button"], [class*="story"] [class*="npc"]')].find(env.shown);
    const n = (env.rt.campOpenTry || 0) + 1;
    await env.setRt({ campOpenTry: n });
    if (npcCard && n <= 3) {
      env.setStatus('Кампания: открываю главу у NPC');
      env.rec('B', 'кампания', `на странице главы целей нет — нажимаю карточку NPC «${(npcCard.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)}» (${n}/3)`);
      await env.pause(); if (!active()) return; env.fire(npcCard);
      if (await env.waitFor(env.isCampaign, 5000, 200) && active()) { await env.setRt({ campOpenTry: 0 }); return campaign(); }
      return;
    }
    if (n > 3) {
      env.rec('B', 'кампания', 'глава не открывается (целей на странице нет) — сверю «Мои квесты» через ~10 боёв');
      await env.setRt({ campOpenTry: 0, questListT: 0, campaignUrl: '', campaignDue: false, sinceCamp: Math.max(0, (env.cfg.campaignEvery || 25) - 10) });
      return env.goOutskirts();
    }
  }
  if (env.rt.campaignUrl) { env.setStatus('Кампания: открываю'); location.href = env.rt.campaignUrl; await env.sleep(5000); return; }
  if (isQuests()) return questsStep();
  if (env.isMail() && env.rt.campaignViaMail) return mailStep();
  env.setStatus('Кампания: ищу в «Мои квесты»'); location.href = '/character-quests.html'; await env.sleep(5000);
}

async function questsStep() {
  const active = campGuard(false); if (!active()) return;
  env.setStatus('Кампания: читаю «Мои квесты»');
  const links = await env.waitFor(() => { const a = [...document.querySelectorAll('a.l2-character-quests-entry__title')].filter(env.shown); return a.length ? a : env.shown(env.$q('#character-quests-list .l2-character-quests-empty')) ? [] : null; }, 8000, 300);
  if (!active()) return;
  const generic = (links || []).filter(a => !separateQuest(a.getAttribute('href')));
  const link = generic.find(a => /campaign/i.test(a.getAttribute('href') || '') && a.closest('[class*="entry--ready"]')) || generic.find(a => /campaign/i.test(a.getAttribute('href') || '')) || generic[0];
  // Сохраняем все записи, включая специализированные; они не означают пустой список или завершённые квесты.
  const entries = [...document.querySelectorAll('.l2-character-quests-entry')];
  const list = entries.length ? entries.map(e => ({
    title: e.querySelector('.l2-character-quests-entry__title')?.textContent.trim() || '',
    href: e.querySelector('.l2-character-quests-entry__title')?.getAttribute('href') || '',
    lines: [...e.querySelectorAll('.l2-character-quests-entry__line')].map(l => l.textContent.replace(/\s+/g, ' ').trim()) }))
    : (links || []).map(a => ({ title: a.textContent.trim(), href: a.getAttribute('href') || '', lines: [] }));
  if (!link && links?.length) return separateHunt(active, list);
  if (!link) {                                   // список пуст — старый путь через почту
    // 16.10, журналы 05:54/05:58: обе кампании сданы, список явно пуст; старая CTA почты не запускает Дион заново и не блокирует фарм.
    const closed = [env.rt.storySaga,env.rt.dionCampaign].every(q => q && (q.completed === true || q.stage === 'completed'));
    if (Array.isArray(env.cfg.autoTasks) && closed && env.shown(env.$q('#character-quests-list .l2-character-quests-empty'))) {
      await env.setRt({ campaignViaMail: false, questList: [], questListT: Date.now(), campaignDue: false, campNoTasksUntil: Date.now() + 10 * 60000 });
      env.rec('B', 'кампания', 'сюжетные кампании завершены, «Мои квесты» пусты — следующая выбранная задача; проверка через 10 мин');
      return; // Новый режим продолжит диспетчер: старый владелец не начинает переход после смены задачи.
    }
    await env.setRt({ campaignViaMail: true, questList: [], questListT: Date.now() });   // v5.6: отметка «смотрели» — иначе снова сюда
    if (!active()) return;
    location.href = '/mail.html'; await env.sleep(5000); return;
  }
  // прогресс прямо со страницы: «★ Cave Servant · Lv.46 — 0 / 80 (осталось 80)»
  await env.setRt({ questList: list, questListT: Date.now() });
  const selected = list.find(q => q.href === link.getAttribute('href'));
  env.rec('B', 'кампания', `«Мои квесты» → ${link.textContent.trim()}${selected?.lines.length ? ' · ' + selected.lines.join(' · ') : ''}`);
  const href = location.href;
  if (!active()) return;
  env.fire(link);
  if (!(await env.waitFor(() => location.href !== href || env.isCampaign(), 8000)) && active()) location.href = link.getAttribute('href');
}

async function mailStep() {
  const active = campGuard(false); if (!active()) return;                      // почта → карточка сюжетного квеста → страница кампании
  env.setStatus('Почта: ищу сюжетный квест');
  const cta = await env.waitFor(() => { const a = env.$q('a.l2-mail-starter-quest__cta, .l2-mail-starter-quest a, [class*="starter-quest"] a'); return env.shown(a) ? a : null; }, 8000, 300);
  if (!active()) return;
  if (!cta) {
    await env.setRt({ campaignDue: false, sinceCamp: 0, ...(Array.isArray(env.cfg.autoTasks) ? {campNoTasksUntil: Date.now() + 10 * 60000} : {}) });
    env.rec('B', 'кампания', 'в почте нет карточки сюжетного квеста');
    env.setStatus(Array.isArray(env.cfg.autoTasks) ? 'Доступных сюжетных квестов нет — следующая выбранная задача, проверка через 10 мин' : 'В почте нет сюжетного квеста — фармлю');
    return env.goOutskirts();
  }
  const href = location.href;
  env.fire(cta);
  if (!(await env.waitFor(() => location.href !== href || env.isCampaign(), 8000)) && active()) return env.goOutskirts();
}

const actionBtn = () => [...document.querySelectorAll('#starter-story-actions button[data-action], [id$="-actions"] button[data-action], .l2-captain-andrei-btn[data-action]')]
  .find(b => env.shown(b) && !b.disabled && b.dataset.action !== 'complete-chapter');

// 10.0.10: кнопка действия главы («Взять квест», «Поговорить»…): жмём, ждём цели / ошибку / смену текста; ошибка «не у NPC» →
// кнопка телепорта к точке главы и повтор на следующем проходе. Общий код для goCampaign и campaign
async function pressAction(actBtn) {
  const active = campGuard();
  if (!active()) return null;
  const lbl = (actBtn.textContent || '').trim().slice(0, 40), tries = (env.rt.campActTry || 0) + 1;
  await env.setRt({ campActTry: tries });
  env.setStatus(`Кампания: «${lbl}»`);
  env.rec('B', 'кампания', `глава ждёт действия — жму «${lbl}» (${actBtn.dataset.action}, ${tries}/4)`);
  const before = (document.querySelector('[class*="quest-body"]')?.textContent || '').length;
  await env.pause(); if (!active()) return null; env.fire(actBtn);
  const res = await env.waitFor(() => campaignState().targets.some(t => !t.ok) || env.shown(env.$q('[data-action="complete-chapter"]')) ? 'ok'
    : (() => { const e = env.$q('[id$="-err"]'); return env.shown(e) && e.textContent.trim() ? 'err' : null; })()
    || ((document.querySelector('[class*="quest-body"]')?.textContent || '').length !== before ? 'changed' : null), 6000, 200);
  if (!active()) return null;
  if (res === 'ok') { await env.setRt({ campActTry: 0, campOpenTry: 0 }); return 'ok'; }
  if (res === 'err') {
    const err = env.$q('[id$="-err"]').textContent.trim().slice(0, 100);
    const tpb = env.$q('.l2-starter-story-location [data-quest-teleport-id], .l2-starter-story-location [data-quest-transport-id]')
      || [...document.querySelectorAll('[data-quest-teleport-id], [data-quest-transport-id]')].find(env.shown);
    env.rec('B', 'кампания', `«${lbl}»: ${err}${tpb ? ' → телепорт к точке главы' : ''}`);
    if (tpb && await campNpcTeleport(tpb, active) && active() && !isCampaignPage() && env.rt.campaignUrl) { location.href = env.rt.campaignUrl; await env.sleep(4000); }
  }
  return res;
}

function campaignState() {
  const targets = [...document.querySelectorAll('li.l2-starter-story-target')].map(li => {
    const pr = (li.querySelector('.l2-starter-story-progress')?.textContent || li.textContent).match(/(\d+)\s*\/\s*(\d+)/);
    const name = (li.querySelector('strong')?.textContent || li.textContent.split(':')[0].replace('★', '')).trim();
    const tp = li.querySelector('[data-quest-teleport-id], [data-quest-transport-id]');
    // «★ Рейдовый босс: Емісар Нурки · Lv.33» (без счётчика) / «RB: …» — цель-РБ главы
    const rbM = li.textContent.replace(/\s+/g, ' ').match(/(?:^|[\s★])(?:Рейдов\S*\s+бос\S*|Рейд-бос\S*|RB|РБ)\s*:\s*([^·\n]+?)\s*(?:·|$)/i);
    if (rbM) return { name: rbM[1].trim(), rb: true, lvl: +(li.textContent.match(/Lv\.?\s*(\d+)/i)?.[1] || 0), done: pr ? +pr[1] : 0, total: pr ? +pr[2] : 1,
                      ok: !!li.querySelector('.l2-starter-story-done') || /✓/.test(li.textContent) || !!(pr && +pr[1] >= +pr[2]),
                      loc: (li.querySelector('small')?.textContent || '').replace(/^Локация:\s*/i, '').trim(), tp: tp?.dataset.questTeleportId || tp?.dataset.questTransportId || '' };
    // Общая цель главы бывает строкой списка; имя конкретного Champion-моба не становится общей целью.
    const genericChamp = /^(?:чемпионы|чемпіони|champions)(?:\s*[·:]?\s*(?:Lv\.?|ур\.?)\s*\d+\s*\+?)?$/i.test(name);
    return { name, ...(genericChamp ? { objective: true, champ: true, minLvl: +(name.match(/(?:Lv\.?|ур\.?)\s*(\d+)\s*\+/i)?.[1] || 0) } : {}), lvl: +(li.textContent.match(/Lv\.?\s*(\d+)/i)?.[1] || 0), done: pr ? +pr[1] : 0, total: pr ? +pr[2] : 0,
             ok: !!li.querySelector('.l2-starter-story-done') || (pr && +pr[1] >= +pr[2]),
             loc: (li.querySelector('small')?.textContent || '').replace(/^Локация:\s*/i, '').trim(), tp: tp?.dataset.questTeleportId || tp?.dataset.questTransportId || '' };
  });
  // доп. задачи главы вне списка: «★ Чемпионы: 0 / 6» (div.l2-starter-story-objective-line) — любые чемпионы
  document.querySelectorAll('.l2-starter-story-objective-line').forEach(el => {
    const pr = el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (!pr) return;
    const name = el.textContent.replace('★', '').split(':')[0].trim();
    targets.push({ name, lvl: 0, done: +pr[1], total: +pr[2], ok: +pr[1] >= +pr[2] || !!el.querySelector('.l2-starter-story-done'),
                   loc: '', tp: '', objective: true, champ: /чемпион|champion/i.test(name), minLvl: +(name.match(/Lv\.?\s*(\d+)\s*\+/i)?.[1] || 0) });
  });
  // «Нужно сдать:» — ресурсы главы (Iron Ore 2198 / 417 ✓); блок награды не трогаем
  document.querySelectorAll('.l2-starter-story-resource').forEach(el => {
    if (el.closest('.l2-starter-story-reward')) return;
    const pr = (el.querySelector('[class*="resource-qty"]')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!pr) return;
    targets.push({ name: el.querySelector('[class*="resource-name"]')?.textContent.trim() || 'ресурс', lvl: 0, done: +pr[1], total: +pr[2],
                   ok: +pr[1] >= +pr[2] || !!el.querySelector('.l2-starter-story-done') || el.classList.contains('l2-starter-story-done'),
                   loc: '', tp: '', objective: true, res: true });
  });
  const title = env.$q('[id$="-campaign-title"], .l2-captain-andrei-quest-title')?.textContent.trim() || '';
  return { title, targets, complete: env.$q('[data-action="complete-chapter"]') };
}

async function campaign() {
  const guarded=campGuard(false),owner=campCompletionOwner(),active=()=>guarded()&&campCompletionOwner()===owner;
  if (!active()) return;
  if(campCompletionWait() && !(env.rt.campOnce && env.rt.campaignDue))return;
  if (staleCampaignPage()) return leaveOldCampaign();
  if (/teleport=/i.test(location.search)) {
    env.setStatus('Кампания: жду телепорт к NPC (страница перезагрузится)');
    await env.waitFor(() => !/teleport=/i.test(location.search), 6000, 100);
    await env.sleep(env.rnd(200, 400));
    if (!active()) return;
  }
  env.setStatus('Кампания: читаю главу');
  await env.waitFor(() => env.$q('li.l2-starter-story-target, [data-action="complete-chapter"], .l2-starter-story-objective-line, .l2-starter-story-resources, #starter-story-actions button[data-action], .l2-starter-story-location [data-quest-teleport-id]'), 10000, 300);
  if (!active()) return;
  if (staleCampaignPage()) return leaveOldCampaign();
  const chapterMark = JSON.stringify([env.rt.storySaga?.stage, env.rt.dionCampaign?.chapter]);
  let st = campaignState();
  // 14.10 (полный аудит): «Проверить кампанию» при выключенной автоматике только читает; guard — до accept/перехода к NPC.
  if (!campEnabled()) {
    await env.setRt({ campaign: { title: st.title, targets: st.targets, t: Date.now() }, campaignDue: false, campOnce: false, sinceCamp: 0,
                  campaignUrl: location.pathname + location.search });
    env.rec('B', 'кампания', `разовая проверка: ${st.title || '?'} · ` + st.targets.map(t => `${t.name} ${t.done}/${t.total}${t.ok ? ' ✓' : ''}`).join(' · '));
    env.setStatus(`Кампания проверена: ${st.title || '—'}${env.shown(st.complete) ? ' · можно завершить главу' : ''}`);
    return env.goOutskirts();
  }
  // 10.0.10 (лог 13.10 18:17:15): страница «Путь новичка» до принятия — целей нет, только «Взять квест» (#starter-story-actions
  // button[data-action=accept]); между этапами — «Поговорить» и т.п. Раньше такая страница считалась «главой без целей» и кампания
  // замирала на 10 мин (кнопку жал только goCampaign, а сюда ведёт сам адрес страницы). Жмём кнопку сами, до 4 раз
  if (!st.targets.some(t => !t.ok) && !env.shown(st.complete)) {
    const btn = actionBtn();
    if (btn && (env.rt.campActTry || 0) < 4) { await pressAction(btn); return; }
    // 14.10: starter-story-quest.js вне NPC не рисует кнопку действия. Встреча/возврат — только location-телепорт, без targets.
    // Отсутствие такой кнопки раньше считалось пустой главой и оставляло квест после hunt_1 навсегда. Четыре отказа — пауза.
    const saga = env.rt.storySaga, npcStage = /^(not_started|meet_scout|return_scout|return_home)$/.test(saga?.stage || '');
    const tp = !btn && /\/starter-story-quest\.html$/i.test(location.pathname) && npcStage && !saga?.completed
      && (env.heroLvl() || saga?.lvl || 0) >= (saga?.minLevel || 0)
      ? env.$q('.l2-starter-story-location [data-quest-teleport-id], .l2-starter-story-location [data-quest-transport-id]') : null;
    if (env.shown(tp) && !tp.disabled && ((env.rt.campActTry || 0) < 4 || env.rt.campaignTp)) {
      const n = (env.rt.campActTry || 0) + (env.rt.campaignTp ? 0 : 1);
      await env.setRt({ campActTry: n, campEmptyPage: 0, campaignUrl: location.pathname + location.search });
      env.setStatus('Кампания: телепорт к NPC текущего этапа');
      env.rec('B', 'кампания', `этап ${saga.stage}: к NPC (${n}/4)`);
      if (!await campNpcTeleport(tp, active) || !active()) return;
      const res = await env.waitFor(() => actionBtn() ? 'ready' : (() => { const e = env.$q('[id$="-err"]'); return env.shown(e) && e.textContent.trim() ? 'err' : null; })(), 8000, 200);
      if (!active()) return;
      if (res === 'ready') await env.setRt({ campActTry: 0, lastTeleport: '' });
      if (res === 'err') env.rec('B', 'кампания', `телепорт к NPC: ${env.$q('[id$="-err"]').textContent.trim().slice(0, 100)}`);
      return;
    }
    if (btn || env.shown(tp)) { env.rec('B', 'кампания', 'кнопка действия главы 4 раза не помогла — фармлю, проверю через 10 мин'); await env.setRt({ campActTry: 0, campaignDue: false, campSkipUntil: Date.now() + 10 * 60000 }); return env.goOutskirts(); }
  }
  if (env.rt.campOpenTry || env.rt.campActTry) env.setRt({ campOpenTry: 0, campActTry: 0 });
  if (!st.targets.length && !env.shown(st.complete)) {
    const count = (env.rt.campEmptyPage || 0) + 1;
    await env.setRt({ campEmptyPage: count, campaignDue: false,
      ...(count >= 2 ? { campSkipUntil: Date.now() + 10 * 60000 } : {}) });
    env.rec('B', 'кампания', `страница главы без целей (${count}/2) — ${count >= 2 ? 'приостанавливаю кампанию на 10 мин' : 'возвращаюсь на карту'}`);
    return env.goOutskirts();
  }
  if (env.rt.campEmptyPage) await env.setRt({ campEmptyPage: 0, campSkipUntil: 0 });
  if (env.shown(st.complete)) {                      // все цели выполнены → «Завершить главу»
    if(env.rt.campCompletionWait)await env.setRt({campCompletionWait:null});
    if(!active())return;
    const was = st.title;
    env.setStatus(`Кампания: завершаю «${was}»`);
    await env.pause();
    if (!active()) return;
    env.fire(st.complete);
    let ok = await env.waitFor(() => campaignState().title !== was, 8000, 300);
    if (!ok && active()) {                              // «вернись к указанному NPC» — телепорт к NPC главы и повтор
      const err = env.$q('[id$="-campaign-err"]');
      const npc = env.$q('.l2-starter-story-location [data-quest-teleport-id], .l2-starter-story-location [data-quest-transport-id]');
      env.rec('B', 'кампания', `глава не завершилась${env.shown(err) ? ': ' + err.textContent.trim() : ''} → к NPC`);
      if (npc) {
        env.setStatus('Кампания: телепорт к NPC главы');
        if (!await campNpcTeleport(npc, active) || !active()) return;
        await env.waitFor(() => env.shown(env.$q('[data-action="complete-chapter"]')), 2500, 50);   // телепорт мгновенный — ждём только кнопку
        if (!active()) return;
        await env.setRt({ lastTeleport: '' });
        const btn = env.$q('[data-action="complete-chapter"]');
        if (active() && env.shown(btn)) { env.fire(btn); ok = await env.waitFor(() => campaignState().title !== was, 8000, 300); }
      }
    }
    if (!active()) return;
    env.rec('B', 'кампания', ok ? `глава завершена: ${was} → ${campaignState().title}` : `не удалось завершить «${was}»`);
    if (ok) await env.setRt({ npcTried: 0, lastTeleport: '', quests: {} });   // учёт прошлой главы больше не нужен
    await env.sleep(env.rnd(800, 1500));
    st = campaignState();
    if (!active()) return;
    if (staleCampaignPage()) return leaveOldCampaign();
    if (chapterMark !== JSON.stringify([env.rt.storySaga?.stage, env.rt.dionCampaign?.chapter])) return;
    if (!ok) { await env.setRt({ campaignDue: false, sinceCamp: 0 }); env.setStatus('Кампания: главу завершить не удалось — продолжаю фарм'); return env.goOutskirts(); }
  }
  if (!active()) return;
  if (staleCampaignPage()) return leaveOldCampaign();
  if (chapterMark !== JSON.stringify([env.rt.storySaga?.stage, env.rt.dionCampaign?.chapter])) return; // ответ новой главы важнее старого DOM
  const open = st.targets.filter(t => !t.ok);
  if (env.rt.campaign?.title && env.rt.campaign.title !== st.title) env.rec('B', 'кампания', `новая глава: «${env.rt.campaign.title}» → «${st.title}» — учёт прошлой главы сброшен`);
  await env.setRt({ needChamps: open.some(t => t.champ), quests: questsFor(st.targets), campaign: { title: st.title, targets: st.targets, t: Date.now() }, campaignDue: false, sinceCamp: 0,
                campaignUrl: location.pathname + location.search });
  if (!active()) return;
  if (!st.targets.length) { env.setStatus('Кампания: целей нет (кампания пройдена?)'); return env.goOutskirts(); }
  if (!open.length) {
    const D=completionDion(),level=Math.max(+env.heroLvl?.()||0,D?.level||0);
    const levelWait=D && D.level>0 && Number.isSafeInteger(D.minLevel) && D.minLevel>level;
    const wait=async()=>{
      if(!active())return;
      const W={key:campCompletionKey(),kind:levelWait?'level':'retry',t:Date.now(),...(levelWait?{minLevel:D.minLevel}:{until:Date.now()+CAMP_COMPLETE_RETRY})};
      await env.setRt({campCompletionWait:W,campaignDue:false,sinceCamp:0,campOnce:false});if(!active())return;
      env.setStatus(levelWait?`Кампания: цели выполнены; герой ${level} ур., в данных главы указан ${D.minLevel} — продолжаю охоту до нового уровня`:'Кампания: цели выполнены, кнопки завершения нет — продолжаю охоту; проверю через 2 мин');
      return env.goOutskirts();
    };
    if(levelWait || D?.atNpc===true)return wait();
    // всё выполнено, а «Завершить этап» нет — кнопка появляется только у NPC главы: «К NPC» → снова открыть главу
    const npc = [...document.querySelectorAll('[data-quest-teleport-id], [data-quest-transport-id]')].find(b => /npc/i.test(b.textContent))
      || env.$q('.l2-starter-story-location [data-quest-teleport-id], .l2-starter-story-location [data-quest-transport-id]');
    if (npc && Date.now() - (env.rt.npcTried || 0) > 120000) {
      env.setStatus('Кампания: всё выполнено — телепорт к NPC, чтобы сдать главу');
      await env.setRt({ npcTried: Date.now(), campaignDue: true, lastTeleport: '' });
      env.rec('B', 'кампания', `цели выполнены, кнопки сдачи нет → «${npc.textContent.trim()}»`);
      if (!await campNpcTeleport(npc, active) || !active()) return;
      await env.sleep(env.rnd(150, 300));
      if (active()) { location.href = env.rt.campaignUrl || location.pathname; await env.sleep(4000); }
      return;
    }
    return wait();
  }
  env.rec('B', 'кампания', `${st.title}: ` + open.map(t => `${t.name} ${t.done}/${t.total}${t.loc ? ' @' + t.loc : ''}`).join(' · '));
  // телепорт к локации первой невыполненной цели (если ещё не там)
  const tp = open.find(t => t.tp)?.tp;
  if (tp) {
    const all = [...document.querySelectorAll('[data-quest-teleport-id], [data-quest-transport-id]')].filter(b => (b.dataset.questTeleportId || b.dataset.questTransportId) === tp);
    const btn = all.find(b => !/npc/i.test(b.textContent)) || all[0];
    env.setStatus(`Кампания: проверяю локацию → ${open.find(t => t.tp === tp)?.loc || tp}`);
    if (!await campTeleport(tp, btn, campGuard())) return;
  }
  return env.goOutskirts();
}
 return { campLocationNote, campLocationStep, campReached, campTeleport, campGuard, questLinesInLog, sagaNote, dionNote, campAuto, campEnabled, campCompletionWait, CAMP_AUTO_MAX_LVL, actionBtn, pressAction, campActive, campOpen, campMobOpen, campRbOpen, campChampOpen, campChampMin, isQuestName, applyQuestLog, questProgress, questRate, questFights, trackQuest, questsFor, questSummary, isCampaignPage, isQuests, campOn, goCampaign, questsStep, mailStep, campaignState, campaign };
 };
})(globalThis);
