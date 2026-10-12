/* L2wap 10.0: дейлики и клановые задания (игрок 12.10: «клановые задания — делать на авто и получать бонусы; есть квесты общие ежедневные, типо дейлики»).
   Ежедневные задания игра засчитывает и выдаёт сама (claimed — сервер); боту остаётся дотянуть то, чего обычный фарм не даёт: 50 рыб и 1 РБ в день.
   Клановые задания: один активный таск на игрока, взять/помочь/сдать — свои POST с токеном страницы (как магазин TvT, без переходов). Зависимости только через env. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.dailies = function create_dailies(env) {
const DAILY_POLL = 10 * 60000, CLAN_POLL = 10 * 60000, FRESH = 20 * 60000, POST_GAP = 60000, FAIL_WAIT = 30 * 60000;
const FISH_MAX = 45 * 60000, RB_MAX = 90 * 60000;
const MODE_KEYS = ['fishMode', 'rbHuntMode', 'epicMode', 'catMode', 'zoneAuto'];
// клановые задания: что бот берёт сам, в порядке выгоды (kill_monsters — 1 Coin of Luck); штурм стены — никогда (осада)
const CLAN_TYPES = ['kill_monsters', 'earn_sp_from_monsters', 'earn_adena', 'kill_raid_boss'];
const DAILY_RU = { hunt_start_500: 'Убей 500 монстров', strong_enemy_20: 'Убей 1 РБ', raid_boss_participate: 'Участие в РБ', skill_master_50: '50 умений в бою',
  daily_playtime_2h: '2 часа в игре', chat_social_10: '10 сообщений в чате', damage_dealer_500k: '500 000 урона', fishing_catch_50: '50 рыб' };
const ssNum = k => { try { return +sessionStorage.getItem(k) || 0; } catch (e) { return 0; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) {} };
let dailyT = ssNum('l2bot-dqT'), clanT = ssNum('l2bot-ctT'), postT = 0, busy = null;
const rbAllowed = () => !!(env.cfg.rbHuntMode || env.cfg.rbBetween || env.cfg.dailyAuto !== false);
// ---------- заметки из ответов игры (страница или свой GET) ----------
function dailyNote(res) {
  if (!res || typeof res.tasks !== 'object') return false;
  const tasks = {};
  for (const [id, r] of Object.entries(res.tasks)) if (r && typeof r === 'object') tasks[id] = { have: +r.have || 0, need: +r.need || 0, done: !!r.done, claimed: !!r.claimed, score: +r.score || 0, place: r.place ?? null };
  const day = String(res.dayKey || '');
  const old = env.rt.daily;
  env.setRt({ daily: { day, t: Date.now(), tasks } });
  if (old?.day && old.day !== day) env.rec('B', 'дейлики', `новый игровой день ${day}`);
  for (const [id, r] of Object.entries(tasks)) if (r.done && !(old?.day === day && old.tasks?.[id]?.done)) env.rec('B', 'дейлики', `✓ ${DAILY_RU[id] || id}`);
  return true;
}
function clanNote(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.error === 'clan_required' || (!res.clan && !Array.isArray(res.taskDefinitions))) { env.setRt({ clanTasks: { t: Date.now(), noClan: true } }); return true; }
  const defs = (res.taskDefinitions || []).map(d => ({ id: d.id, n: d.nameRu || d.name || d.id, target: +d.target || 0, canTake: !!d.canTake, why: d.blockedReason || null, cdAt: d.cooldownEndsAt ? Date.parse(d.cooldownEndsAt) : null,
    reward: d.personalReward || {}, diamonds: +d.clanRewardDiamonds || 0 }));
  const active = (res.activeClanTasks || []).map(t => ({ id: t.id, type: t.taskType, progress: +t.progress || 0, target: +t.target || 0, owner: t.owner?.name || t.owner?.characterName || '', ownerId: t.owner?.id || t.owner?.characterId || '',
    helper: t.helper?.name || t.helper?.characterName || '', canHelp: !!t.canHelp, canClaim: !!t.canClaim, canCancel: !!t.canCancel, diamonds: +t.clanRewardDiamonds || 0 }));
  const old = env.rt.clanTasks;
  env.setRt({ clanTasks: { t: Date.now(), clan: { name: res.clan?.name || '', diamonds: +res.clan?.diamonds || 0 }, me: { active: res.me?.activeTaskId || null, id: res.me?.characterId || '' }, defs, active } });
  if (old?.clan && old.clan.diamonds != null && res.clan && +res.clan.diamonds > old.clan.diamonds) env.rec('B', 'клан', `алмазы клана: ${old.clan.diamonds} → ${res.clan.diamonds}`);
  return true;
}
// ---------- фоновый опрос (только GET) ----------
async function tick() {
  if (busy) return busy;
  const now = Date.now(), wantDaily = env.cfg.dailyAuto !== false && now - dailyT > DAILY_POLL, wantClan = env.cfg.clanTasks !== false && now - clanT > CLAN_POLL && !env.rt.clanTasks?.noClan;
  if (!wantDaily && !wantClan) return null;
  busy = (async () => {
    try {
      if (wantDaily) { dailyT = Date.now(); ssSet('l2bot-dqT', dailyT); const r = await env.gameGet('/game/daily-quests'); if (r?.ok) dailyNote(await r.json().catch(() => null)); }
      if (wantClan) { clanT = Date.now(); ssSet('l2bot-ctT', clanT); const r = await env.gameGet('/game/clan-tasks'); if (r) { const b = await r.json().catch(() => null); if (r.ok || r.status === 403) clanNote(r.ok ? b : { error: 'clan_required' }); } }
    } catch (e) {} finally { busy = null; }
  })();
  return busy;
}
// ---------- клановые задания: сдать → помочь → взять ----------
function clanPlan() {
  const C = env.rt.clanTasks; if (!C || C.noClan || Date.now() - (C.t || 0) > FRESH) return null;
  const mine = C.active.find(t => t.id === C.me.active) || null;
  const claim = C.active.find(t => t.canClaim && (t.id === C.me.active || t.ownerId === C.me.id)); if (claim) return { kind: 'claim', task: claim, why: `сдать «${nameOf(C, claim.type)}» (${claim.progress}/${claim.target})` };
  if (mine) return null;
  const okType = t => CLAN_TYPES.includes(t) && (t !== 'kill_raid_boss' || rbAllowed());
  for (const ty of CLAN_TYPES) { const d = C.defs.find(x => x.id === ty && x.canTake); if (d && okType(ty)) return { kind: 'take', def: d, why: `взять «${d.n}»${d.reward.coinOfLuck ? ' (+' + d.reward.coinOfLuck + ' CoL)' : ''}` }; }
  const help = C.active.find(t => t.canHelp && okType(t.type)); if (help) return { kind: 'help', task: help, why: `помочь ${help.owner || 'соклановцу'} с «${nameOf(C, help.type)}»` };
  return null;
}
const nameOf = (C, type) => C.defs.find(d => d.id === type)?.n || type;
async function clanStep() {
  if (env.cfg.clanTasks === false || env.isBattle() || Date.now() - postT < POST_GAP) return false;
  const F = env.rt.clanTaskFail; if (F && Date.now() - (F.t || 0) < FAIL_WAIT) return false;
  const p = clanPlan(); if (!p) return false;
  postT = Date.now();
  const path = p.kind === 'take' ? `/game/clan-tasks/${encodeURIComponent(p.def.id)}/take` : `/game/clan-tasks/${encodeURIComponent(p.task.id)}/${p.kind}`;
  const r = await env.gamePost(path, {}).catch(() => null);
  const body = r ? await r.json().catch(() => ({})) : {};
  if (r?.ok) { clanNote(body); clanT = Date.now(); env.rec('B', 'клан', `✓ ${p.why}${p.kind === 'claim' ? ` — клану +${p.task.diamonds} алмазов` : ''}`); return true; }
  const msg = body?.messageRu || body?.messageUk || body?.error || (r ? 'HTTP ' + r.status : 'нет ответа');
  env.rec('S', 'клан', `✗ ${p.why}: ${msg} — повтор через 30 мин`);
  await env.setRt({ clanTaskFail: { t: Date.now(), why: String(msg).slice(0, 120) } });
  if (r?.status === 409) { clanT = 0; }                 // состояние устарело — перечитать
  return true;
}
// ---------- дейлики: дотянуть 50 рыб и 1 РБ ----------
const snap = () => Object.fromEntries(MODE_KEYS.map(k => [k, !!env.cfg[k]]));
const dailyTask = id => { const D = env.rt.daily; return D && Date.now() - (D.t || 0) < FRESH ? D.tasks?.[id] || null : null; };
const doneDay = kind => env.rt.dailyDone?.[kind] === env.rt.daily?.day;
function fishLack() { const t = dailyTask('fishing_catch_50'); return t && !t.done ? Math.max(1, t.need - t.have) : 0; }
function rbWanted() {
  const a = dailyTask('strong_enemy_20'), b = dailyTask('raid_boss_participate');
  const C = env.rt.clanTasks, mine = C?.active?.find(t => t.id === C.me?.active);
  return !!((a && !a.done) || (b && !b.done) || (mine && mine.type === 'kill_raid_boss' && mine.progress < mine.target));
}
async function dailyStep() {
  const F = env.rt.dailyFish, R = env.rt.dailyRb;
  if (F) {
    const done = (F.got || 0) >= F.need, late = Date.now() - (F.t || 0) > FISH_MAX, dq = dailyTask('fishing_catch_50');
    if (done || late || (dq && dq.done)) { await detourEnd('dailyFish', F, done || dq?.done ? `рыба на дейлик поймана (${F.got}/${F.need})` : 'рыбалка по дейлику: 45 мин вышли'); return true; }
    return false;
  }
  if (R) {
    const killed = (env.rt.rbKills || 0) > (R.k0 || 0), late = Date.now() - (R.t || 0) > RB_MAX;
    if (killed || late || !rbWanted()) { await detourEnd('dailyRb', R, killed ? 'РБ по дейлику убит' : late ? 'РБ по дейлику: 90 мин вышли' : 'дейлик по РБ уже засчитан'); return true; }
    return false;
  }
  if (env.cfg.dailyAuto === false || !env.rt.daily?.day || env.isBattle() || !env.awayFree?.() || env.fishNow()) return false;
  const lack = fishLack();
  if (lack && !doneDay('fish') && !env.cfg.fishMode) {
    await env.setRt({ dailyFish: { day: env.rt.daily.day, need: lack, got: 0, t: Date.now(), prev: snap() }, dailyDone: { ...(env.rt.dailyDone || {}), fish: env.rt.daily.day } });
    await env.setCfg({ fishMode: true, rbHuntMode: false, epicMode: false, catMode: false, zoneAuto: false });
    env.rec('B', 'дейлики', `«50 рыб»: не хватает ${lack} — иду на рыбалку (+1 Coin of Luck, 300 000 аден, 50 000 EXP), потом назад`);
    return true;
  }
  if (rbWanted() && !doneDay('rb') && !env.cfg.rbHuntMode && !env.cfg.epicMode && (+env.heroLevel?.() || 0) >= 40) {
    await env.setRt({ dailyRb: { day: env.rt.daily.day, k0: env.rt.rbKills || 0, t: Date.now(), prev: snap() }, dailyDone: { ...(env.rt.dailyDone || {}), rb: env.rt.daily.day }, rbHunt: { step: 'pick', t: Date.now(), last: 'РБ по дейлику' } });
    await env.setCfg({ rbHuntMode: true, fishMode: false, epicMode: false, catMode: false });
    env.rec('B', 'дейлики', 'РБ за день не убит — один тур по РБ (дейлики «Убей 1 РБ» и «Участие в РБ», клановый «Вызов рейдового босса»), потом назад');
    return true;
  }
  return false;
}
async function detourEnd(key, D, why) {
  await env.setRt({ [key]: null, ...(key === 'dailyRb' ? { rbHunt: { step: 'pick', t: Date.now(), last: 'дейлик по РБ окончен' }, rbGo: null } : {}) });
  await env.setCfg({ ...(D.prev || {}) });
  env.rec('B', 'дейлики', `${why} — возвращаюсь к прежнему режиму`);
  env.setStatus?.('Дейлик выполнен — возвращаюсь');
  if (key === 'dailyFish' && /fishing/.test(location.pathname)) { location.href = '/map.html'; await env.sleep(3000); }
}
async function fishNote() { const F = env.rt.dailyFish; if (!F) return; await env.setRt({ dailyFish: { ...F, got: (F.got || 0) + 1 } }); }
// ---------- текст для меню ----------
function text() {
  const D = env.rt.daily, C = env.rt.clanTasks, out = [];
  if (D?.tasks) out.push(`📅 Дейлики (день ${D.day}): ` + Object.entries(D.tasks).map(([id, t]) => `${t.done ? '✓' : '○'} ${DAILY_RU[id] || id}${t.done ? '' : ` ${t.have}/${t.need}`}`).join(' · '));
  else out.push('📅 Дейлики: ещё не читал (опрос раз в 10 мин)');
  if (env.rt.dailyFish) out.push(`🎣 ловлю рыбу на дейлик: ${env.rt.dailyFish.got || 0}/${env.rt.dailyFish.need}`);
  if (env.rt.dailyRb) out.push('🏹 иду убить РБ на дейлик');
  if (C?.noClan) out.push('🏰 Клан: героя нет в клане');
  else if (C?.defs) {
    const mine = C.active.find(t => t.id === C.me.active);
    out.push(`🏰 ${C.clan.name}: алмазов ${C.clan.diamonds}` + (mine ? ` · моё задание: «${nameOf(C, mine.type)}» ${mine.progress}/${mine.target}${mine.canClaim ? ' — готово к сдаче' : ''}` : ' · задания нет'));
    const others = C.active.filter(t => t.id !== C.me.active); if (others.length) out.push('   соклановцы: ' + others.map(t => `${t.owner}: «${nameOf(C, t.type)}» ${t.progress}/${t.target}`).join('; '));
    out.push('   доступно: ' + C.defs.map(d => `${d.canTake ? '✓' : d.why === 'cooldown' && d.cdAt ? '⏳ ' + new Date(d.cdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '○'} ${d.n} (+${d.diamonds}💎${d.reward.coinOfLuck ? ', ' + d.reward.coinOfLuck + ' CoL' : d.reward.adena ? ', ' + d.reward.adena.toLocaleString('ru') + ' аден' : d.reward.exp ? ', ' + d.reward.exp.toLocaleString('ru') + ' EXP' : ''})`).join(' · '));
  } else out.push('🏰 Клановые задания: ещё не читал');
  return out.join('\n');
}
return { DAILY_RU, CLAN_TYPES, dailyNote, clanNote, tick, clanPlan, clanStep, dailyStep, detourEnd, fishNote, fishLack, rbWanted, text };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
