/* L2wap v7: isolated tvt feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.tvt = function create_tvt(env) {
const location = env.routeLocation || root.location;
const tvtNow = () => Date.now() + (env.TVT?.off ?? env.rt.tvt?.off ?? 0);

const tvtMs = v => typeof v === 'number' ? v : (v && Date.parse(v)) || 0;
const canRun = () => env.on !== false && env.tabOwner !== false && !!env.cfg.tvtOn;

function tvtState() {
  const T = env.TVT || env.rt.tvt; if (!T) return null;
  const nx = T.schedule?.next || {}, now = tvtNow();
  return { phase: T.phase || '', reg: !!(T.isRegistered || T.myTeam), team: T.myTeam, id: T.eventId || nx.slotKey || '',
    start: tvtMs(T.startsAt) || tvtMs(nx.battleStartsAt), end: tvtMs(T.endsAt), regEnd: tvtMs(T.registrationEndsAt), now, fresh: env.TVT && Date.now() - env.TVT.t < 120000,
    regOpen: tvtMs(nx.registrationOpensAt), count: +T.registeredCount || 0, max: +T.maxPlayers || 20,
    eliminated: !!T.isRegistered && /^(ACTIVE|FINISHED)$/i.test(T.phase || '') && T.selfCombat?.alive === false };
}
const tvtRegistrationDue = () => { const s = tvtState(); return canRun() && !!s && /REGISTRATION/i.test(s.phase) && !s.reg && (!s.regEnd || s.now < s.regEnd); };
let readAt = 0, reading = false;
async function tvtRefresh(force = false) {
  if (!canRun() || !env.gameGet || reading) return;
  const s = tvtState(), now = Date.now(), opening = s?.regOpen && s.now >= s.regOpen - 5000 && s.now <= s.regOpen + 10000;
  // 10.0.22: после сна вкладки можно пропустить первые10с открытия; продолжаем читать до конца окна.
  const closes = s && (s.regEnd > s.regOpen ? s.regEnd : s.start > s.regOpen ? s.start : s.regOpen + 10 * 60000);
  const pendingWindow = s?.regOpen && s.now >= s.regOpen && s.now < closes;
  const due = !s || !s.reg && (opening || pendingWindow || tvtRegistrationDue());
  if (!force && (!due || now - readAt < (opening ? 1000 : 5000))) return;
  reading = true; readAt = now;
  try {
    const response = await env.gameGet('/game/tvt', 8000), data = response?.ok ? await response.json() : null;
    if (!canRun() || typeof data?.phase !== 'string') return;
    const t = Date.now();
    env.TVT = { ...data, t, off: tvtMs(data.serverNow) ? tvtMs(data.serverNow) - t : 0 };
    const T = env.TVT;
    await env.setRt({ tvt: { phase: T.phase, eventId: T.eventId, isRegistered: T.isRegistered, myTeam: T.myTeam,
      startsAt: T.startsAt, registrationEndsAt: T.registrationEndsAt, schedule: T.schedule, registeredCount: T.registeredCount,
      maxPlayers: T.maxPlayers, selfCombat: typeof T.selfCombat?.alive === 'boolean' ? { alive: T.selfCombat.alive } : null, t, off: T.off } });
  } catch (e) {} finally { reading = false; }
}

const isArena = () => /\/tvt-arena\.html/i.test(location.pathname);

// 9.2 (лог 11.10 03:00): убитый враг остаётся в списке команды как живой, пока открыта панель боя — игра перерисовывает
// список только после «← Вернуться на TvT» (POST /game/tvt/target/clear). Бот 20 с жал на xdesx: POST /game/tvt/target → 400
// tvt_target_dead, Blaze «Скилл сейчас недоступен». Павших помним по ответам сервера (action.targetDead, target → tvt_target_dead).
const DEAD_MS = 45000, tvtDead = new Map();       // id врага → когда пал (на случай воскрешения — забываем через 45 с)
function tvtDeadNote(id) { if (id != null && id !== '') tvtDead.set(String(id), Date.now()); }
const isDead = id => { const t = tvtDead.get(String(id)); return !!t && Date.now() - t < DEAD_MS; };

function tvtSoon() {                                // пора на арену: записаны и бой вот-вот / идёт
  if (!env.cfg.tvtOn) return false;
  const S = tvtState(); if (!S || !S.reg || S.eliminated) return false;
  // 7.1.30 (лог 10.10 15:00–15:03): бой закончился (FINISHED), а правило «до старта < 60 с / идёт < 11 мин» по времени держало
  // «пора на арену» — бот 40 раз бегал рыбалка ↔ арена. Закончился/отменён — не на арену, какое бы ни было время
  if (/FINISH|RESULT|ENDED|IDLE|CANCEL/i.test(S.phase)) return false;
  if (env.rt.tvtDone && env.rt.tvtDone === (S.id || String(S.start || ''))) return false;   // 10.0: пустой id события — по времени старта          // этот бой уже отыгран (итог записан)
  return /ACTIVE|PREPAR|STARTING|COMBAT/i.test(S.phase) || (S.start && S.start - S.now < 60000 && S.now - S.start < 11 * 60000);
}

// 10.0.11 (игрок 13.10 22:00: «во время TvT команды других задач подавляют TvT, а TvT важнее»): окно TvT — записаны, бой идёт
// или до старта меньше cfg.tvtHoldMin мин (3). В окне ядро не начинает задачи (закупка, магистр, баффы, Маммон, квесты, дейлики,
// туры РБ/эпиков, телепорты): они длятся минуты и бот опаздывал на арену или уходил с неё
function tvtHold() {
  if (!env.cfg.tvtOn) return false;
  if (tvtRegistrationDue()) return true;
  const S = tvtState(); if (!S || !S.reg || S.eliminated) return false;
  if (/FINISH|RESULT|ENDED|IDLE|CANCEL/i.test(S.phase)) return false;
  if (env.rt.tvtDone && env.rt.tvtDone === (S.id || String(S.start || ''))) return false;
  if (/ACTIVE|PREPAR|STARTING|COMBAT/i.test(S.phase)) return true;
  const hold = Math.max(1, +env.cfg.tvtHoldMin || 3) * 60000;
  return !!(S.start && S.start - S.now < hold && S.now - S.start < 11 * 60000);
}

async function tvtWait() {                          // окно TvT, дел на арене ещё нет — стоим на месте, задачи отложены
  const S = tvtState() || {}, left = S.start ? Math.max(0, Math.round((S.start - S.now) / 1000)) : 0;
  env.setStatus(`TvT через ${left} с — задачи отложены, жду на месте`);
  const k = S.id || String(S.start || '');
  if (env.rt.tvtHoldNote !== k) { env.rt.tvtHoldNote = k; env.rec('B', 'TvT', `до боя ${left} с — закупку, магистра, баффы, Маммона, квесты и туры откладываю до конца TvT`); }
  await env.sleep(1000);
}

async function tvtStep() {                          // true — шаг TvT сделан (главный цикл начинает заново)
  if (!canRun()) return false;
  // 10.0.22: GET статуса не блокирует удары при медленном сервере; известная регистрация прерывает бой сразу.
  if (env.isBattle()) void tvtRefresh(); else await tvtRefresh();
  if (!canRun()) return false;
  // 10.0.14 (public tvt-arena-combat.js, 14.10): павшего участника игра выводит в чат, а не воскрешает.
  // Статус привязан к событию в TVT/rt.tvt; старый TVTC.self от прошлого боя сюда не подмешиваем.
  const state = tvtState();
  const registration = tvtRegistrationDue();
  if (state?.eliminated) return env.rt.tvtDone === (state.id || String(state.start || '')) ? false : tvtLeave('выбыл из боя');
  tvtStep.leaveT = tvtStep.leaveT || 0;
  if (env.isBattle()) {
    // 10.0.11 (игрок 13.10: «TvT важнее»): бой TvT начался/вот-вот, а бот в PvE-бою — выходим на карту (следующий круг уведёт на арену).
    // 15.10: регистрация тоже прерывает PvE; по решению игрока включённый TvT важнее любого босса.
    if (!registration && !tvtSoon()) return false;
    if (env.victory?.()) { location.href = '/tvt-arena.html'; return true; }
    const rbFight = /l2dop_(rb|eg)_/i.test(location.search) || env.rt.rbHunt?.step === 'fight' || !!(env.rt.epic?.step && env.rt.epic.step !== 'pick');
    if (Date.now() - tvtStep.leaveT < (registration ? 3000 : 30000)) return false;
    tvtStep.leaveT = Date.now();
    const S = tvtState() || {};
    env.rec('B', 'TvT', `${registration ? `регистрация открыта, мест занято ${S.count}/${S.max}` : `бой TvT ${S.start && S.start > S.now ? 'через ' + Math.round((S.start - S.now) / 1000) + ' с' : 'идёт'}`} — прерываю ${rbFight ? 'бой с боссом' : 'фарм'}, иду на арену`);
    env.leaveMark?.((location.search || '').match(/[?&]spawnId=([^&]+)/)?.[1], 'TvT: освобождаю PvE-бой');
    await env.toMap(); await env.sleep(500); return true;
  }
  const pr = env.$q('#l2-tvt-registration-prompt'), yes = env.$q('#l2-tvt-registration-prompt-yes');
  if (!state && pr && !pr.hidden && env.shown(yes) && !isArena()) { location.href = '/tvt-arena.html'; await env.sleep(1000); return true; }
  const S = tvtState(); if (!S) return false;
  // Запись сразу после открытия; неподтверждённую попытку повторяем с backoff на арене, без циклов фарм↔арена.
  const regN = (env.rt.tvtRegN || {})[S.id] || 0;
  if (registration) {
    if (!isArena()) { env.setStatus('TvT: иду записываться'); location.href = '/tvt-arena.html'; await env.sleep(4000); return true; }
    if (S.count >= S.max) { env.setStatus(`TvT: заняты все ${S.max} мест — проверяю освобождение места`); await env.sleep(1000); return true; }
    const retry = [3000, 5000, 10000, 30000][Math.min(3, Math.max(0, regN - 1))];
    if (Date.now() - ((env.rt.tvtRegT || {})[S.id] || 0) < retry) { await env.sleep(200); return true; }
    const b = await env.waitX(() => { const x = env.$q('#tvt-register-btn'); return env.shown(x) ? x : null; }, 6000, 200);
    if (!canRun() || !tvtRegistrationDue() || tvtState()?.id !== S.id) return false;
    await env.setRt({ tvtRegT: { ...(env.rt.tvtRegT || {}), [S.id]: Date.now() }, tvtRegN: { [S.id]: regN + 1 } });
    if (!canRun()) return false;
    if (b) {
      await env.pause(); if (!canRun() || !tvtRegistrationDue() || tvtState()?.id !== S.id || b.disabled) return false; env.fire(b);
      env.rec('B', 'TvT', `регистрация отправлена (${S.count}/${S.max}); жду подтверждения сервера`);
      await env.sleep(1500); if (!canRun()) return false;
      if (!tvtState()?.reg) await tvtRefresh(true);
      if (!canRun()) return false;
      if (!tvtState()?.reg) { env.setStatus('TvT: регистрация пока не подтверждена — остаюсь на арене'); return true; }
      env.rec('B', 'TvT', `регистрация подтверждена (${S.id})`);
    }
    else env.rec('B', 'TvT', `кнопки «Зарегистрироваться» нет — ${(env.$q('#tvt-message')?.textContent || env.$q('#tvt-phase-label')?.textContent || '').trim().slice(0, 80)}`);
    if (!canRun()) return false;
    if (!b) return true;
    location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(3000); return true;
  }
  if (tvtSoon()) {
    if (!isArena()) { env.rec('B', 'TvT', `бой TvT ${S.start ? 'через ' + Math.max(0, Math.round((S.start - S.now) / 1000)) + ' с' : 'идёт'} — иду на арену`); location.href = '/tvt-arena.html'; await env.sleep(4000); return true; }
    await tvtFight(); return true;
  }
  // бой кончился, а мы на арене — итог в журнал и назад к делу
  if (isArena() && S.reg === false && env.rt.tvtIn) return tvtLeave();
  if (isArena() && env.rt.tvtIn && !/ACTIVE|PREPAR/i.test(S.phase)) return tvtLeave();
  return false;
}

async function tvtLeave(why) {
  if (!canRun()) return false;
  const head = (env.$q('.l2-tvt-result__headline')?.textContent || '').trim(), score = (env.$q('.l2-tvt-result__score')?.textContent || '').replace(/\s+/g, ' ').trim();
  const rew = [...document.querySelectorAll('.l2-tvt-result__reward-text')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(', ');
  const st = (env.$q('.l2-tvt-result__stats')?.textContent || '').trim();
  env.rec('B', 'TvT', why ? `${why} — возвращаюсь к прежнему режиму` : `итог: ${head || '—'} ${score} · ${st}${rew ? ' · награда: ' + rew : ''}`);
  await env.setRt({ tvtIn: null, tvtDone: (tvtState()?.id || String(tvtState()?.start || '')) || env.rt.tvtDone || null });   // 7.1.30: отыгранный бой больше не зовёт на арену
  if (canRun() && (isArena() || /\/chat\.html/i.test(location.pathname))) { location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
  return true;
}

function tvtEnemies() {                             // живые враги: из ответа игры (HP/CP/стан), иначе — список на странице
  const els = [...document.querySelectorAll('.l2-tvt-nick[data-target-kind="enemy"][data-character-id]')];
  const R = (env.TVT?.combatRoster || []).filter(x => x && typeof x === 'object');
  return els.map(e => { const id = e.dataset.characterId, r = R.find(x => String(x.characterId) === String(id)) || {};   // v5.6: id из API может быть числом
    return { e, id, name: e.textContent.trim(), lvl: +((e.title || '').match(/\d+/)?.[0] || 0), hp: r.hp ?? null, cp: r.cp ?? 0, prot: tvtMs(r.spawnProtectedUntil) || 0,
      alive: r.alive !== false && !e.className.includes('dead') && !isDead(id) }; })
    .filter(x => x.alive);
}

// 10.0.11 (лог 13.10 22:00:03–22:00:57, alt1 Knight 20): бот 30 с жал Power Strike (19 MP за 3 урона) → MP 234 → 6, потом 22 с
// молча жал тот же Power Strike без MP (страница клик не отправляла — в журнале ни одного запроса), обычная атака не нажималась.
// Теперь: скиллы TvT — из ответа /game/tvt/skills (mpCost, readyAt) и ответов ударов (selfMp, skillReadyAt); скилл дороже текущего MP
// не жмём; клик без ответа сервера 2 раза подряд → слот «залип» на 3 с, бьём другим; «Атака питомца» (кот/слуга) — своей кнопкой
const TVTS = () => (env.TVTS?.skills || []).filter(x => x && typeof x === 'object');
function skillInfo(b) {
  const key = String(env.slotAction?.(b) || '').toLowerCase(), t = env.cleanTitle(b?.title || '').toLowerCase();
  return TVTS().find(x => (key && x.action && String(x.action).toLowerCase() === key) || (x.nameUk && t && t.startsWith(String(x.nameUk).toLowerCase()))) || null;
}
function mpNow() { const m = env.meMp?.(); if (m && m.cur != null && !isNaN(+m.cur)) return +m.cur; const C = env.TVTC; return C && C.selfMp != null ? +C.selfMp : null; }
function mpOk(b, mp) { const s = skillInfo(b); return !s || !(+s.mpCost > 0) || mp == null || mp >= +s.mpCost; }
function srvReady(b) { const s = skillInfo(b); return !s || !s.readyAt || tvtMs(s.readyAt) <= tvtNow() + 50; }
function tvtSkillAllowed(b) {
  const s = skillInfo(b), key = String(env.slotAction?.(b) || '');
  if (s) return s.usable !== false && (!s.targetType || /enemy|enemies|opponent/i.test(s.targetType));
  return !env.TVTS?.complete || /^(?:attack|basic_attack|battle_potion)/.test(key);
}
let skillsReadAt = 0;
async function tvtSkillsRefresh() {
  if (!canRun() || !env.gameGet || env.TVTS?.complete && env.TVTS.event === tvtState()?.id || Date.now() - skillsReadAt < 5000) return;
  skillsReadAt = Date.now();
  try {
    const event = tvtState()?.id, r = await env.gameGet('/game/tvt/skills', 5000), data = r?.ok ? await r.json() : null;
    if (canRun() && tvtState()?.id === event && Array.isArray(data?.skills)) env.TVTS = { skills: data.skills.filter(x => x && typeof x === 'object'), complete: true, event, t: Date.now() };
  } catch (e) {}
}
const stuck = new Map(), misses = new Map();      // ключ слота → до какого времени не жмём / сколько кликов подряд без ответа
const slotKey = b => String(env.slotAction?.(b) || env.cleanTitle(b?.title || '') || '').toLowerCase();
const notStuck = b => (stuck.get(slotKey(b)) || 0) <= Date.now();
function stuckNote(b, mp) {
  const k = slotKey(b), n = (misses.get(k) || 0) + 1; misses.set(k, n);
  if (n >= 2) { stuck.set(k, Date.now() + 3000); misses.set(k, 0);
    if (Date.now() - (stuckNote.t || 0) > 60000) { stuckNote.t = Date.now(); env.rec('B', 'TvT', `клик «${env.cleanTitle(b?.title || '')}» игра не отправляет (MP ${mp ?? '?'}) — 3 с бью другим`); } }
}

async function tvtFight() {
  if (!canRun()) return false;
  if (!env.rt.tvtIn) { await env.setRt({ tvtIn: tvtState()?.id || 1 }); env.rec('B', 'TvT', 'на арене — жду старт'); }
  let lastPot = 0, lastTgt = 0, lastTgtId = '', lastBack = 0, lastPet = 0, lastMpNote = 0;
  const t0 = Date.now();
  while (canRun() && isArena() && Date.now() - t0 < 12 * 60000) {
    const S = tvtState() || {};
    if (S.eliminated) return tvtLeave('выбыл из боя');
    if (!/ACTIVE/i.test(S.phase) && !(S.start && tvtNow() >= S.start)) {   // подготовка: ждём, отмечаемся (страница сама шлёт presence)
      env.setStatus(`TvT: подготовка${S.start ? ', до боя ' + Math.max(0, Math.round((S.start - tvtNow()) / 1000)) + ' с' : ''}`); await env.sleep(1000);
      if (S.phase && !/PREPAR|REGISTRATION|ACTIVE/i.test(S.phase) && S.now - (S.start || 0) > 15000) return tvtLeave();
      continue;
    }
    if (/RESULT|FINISH|ENDED|IDLE|CANCEL/i.test(S.phase) || env.shown(env.$q('#tvt-result-section'))) return tvtLeave();
    if (env.shown(env.$q('#tvt-self-dead'))) { env.setStatus(`TvT: погиб — ${(env.$q('#tvt-self-respawn')?.textContent || 'жду воскрешения').trim()}`); await env.sleep(1000); continue; }
    // цель: живой враг, которого быстрее добить; текущая мертва/не выбрана — выбрать
    // цель: из ответа игры (selectedTarget), иначе — с панели боя (#tvt-target-name, #tvt-target-hp «x / y»)
    const C = env.TVTC || {}, en = tvtEnemies(), dn = (env.$q('#tvt-target-name')?.textContent || '').trim(), dh = (env.$q('#tvt-target-hp')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    const domCur = dn && dn !== '—' && env.shown(env.$q('#tvt-battle-target-block')) ? { name: dn, characterId: en.find(x => x.name === dn)?.id, hp: dh ? +dh[1] : null, maxHp: dh ? +dh[2] : null, alive: !(dh && +dh[1] === 0) } : null;
    const cur = C.selectedTarget && Date.now() - (C.t || 0) < 15000 ? C.selectedTarget : domCur;
    // 10.0.11: цифр HP у врага нет (игра отдаёт их только по выбранной цели) → по уровню (≈130 HP+CP на уровень: 27 ур. — 3 430, 43 — 5 775,
    // 80 — 10 500); раньше без цифр все были «равны» и бот после ambi-spoil (27) выбрал gnom2 (43), потом Existence (80)
    const score = x => (x.hp != null ? x.hp + (x.cp || 0) : (x.lvl ? 130 * x.lvl : 1e9));
    const best = en.filter(x => !(x.prot > tvtNow())).sort((a, b) => score(a) - score(b) || a.lvl - b.lvl)[0];
    if (cur && (cur.alive === false || cur.hp === 0) && cur.characterId) tvtDeadNote(cur.characterId);
    const curDead = !cur || cur.alive === false || cur.hp === 0 || !en.some(x => x.id === cur.characterId);
    const better = best && cur && best.hp != null && cur.hp != null && best.id !== cur.characterId && best.hp + best.cp < (cur.hp + (cur.cp || 0)) * 0.5;
    // цель пала, а на экране ещё панель боя с ней: «← Вернуться на TvT» — игра снимает цель и перерисовывает список врагов
    // (как сделал игрок в 03:00:26), затем выбираем следующего. Не чаще раза в 4 с — если кнопка не помогла, жмём врага напрямую
    const back = env.$q('#tvt-back-roster-btn');
    if (curDead && cur && domCur && env.shown(back) && Date.now() - lastBack > 4000) {
      lastBack = Date.now(); env.rec('B', 'TvT', `${cur.name || 'цель'} повержен — назад к списку врагов`); env.fire(back);
      await env.waitX(() => !env.TVTC?.selectedTarget || env.TVTC.selectedTarget.characterId !== cur.characterId, 1000, 25); await env.sleep(40); continue;
    }
    if (best && (curDead || better) && (best.id !== lastTgtId || Date.now() - lastTgt > 1000)) {
      lastTgt = Date.now(); lastTgtId = best.id; env.setStatus(`TvT: цель ${best.name}${best.hp != null ? ` (HP ${best.hp})` : best.lvl ? ` (${best.lvl} ур.)` : ''}`); env.fire(best.e);
      await env.waitX(() => String(env.TVTC?.selectedTarget?.characterId || '') === String(best.id), 1000, 25); await env.sleep(40); continue;
    }
    if (curDead) { env.setStatus(best ? `TvT: выбираю цель — ${best.name}` : 'TvT: живых врагов нет — жду'); await env.sleep(best ? 300 : 800); continue; }   // 9.2: по павшей цели скиллы не жмём
    await tvtSkillsRefresh();
    if (!canRun()) return false;
    const me = env.meHp();
    // банка HP: на арене — с 60 %, не чаще раза в 1,1 с
    if (me && me.pct <= 60 && Date.now() - lastPot > 1100) { const pot = env.hpPotPick(me.pct <= 35); if (pot) { lastPot = Date.now(); env.fire(pot); await env.sleep(env.rnd(150, 250)); continue; } }
    const sv = tvtNow(), stunned = (cur?.stunnedUntil || 0) > sv, mp = mpNow();
    const okB = b => b && tvtSkillAllowed(b) && env.ready(b) && notStuck(b) && srvReady(b) && mpOk(b, mp);
    const pickR = list => env.names(list).map(n => env.slotsBy(n)[0]).find(okB);
    let b = null, why = '';
    if (!stunned && (b = pickR(env.cfg.nStun))) why = 'стан';
    else if ((b = pickR(env.cfg.nUltra))) why = 'сверхсильный';
    else if ((b = env.forceCosts().map(c => ({ c, x: env.slotsBy(c.name)[0] })).filter(o => okB(o.x) && (env.hudForce() ?? env.forceNow()) >= o.c.cost).sort((p, q) => q.c.cost - p.c.cost)[0]?.x)) why = 'энергия';
    else if ((b = pickR(env.cfg.nPower))) why = 'удар';
    else if ((env.hudForce() ?? env.forceNow()) < Math.max(2, env.forceMax()) && (b = pickR(env.cfg.nCharge))) why = 'заряд';
    else if ((b = env.slotsBy(env.cfg.nAttack).find(x => okB(x) && !(tvtMs(env.TVTC?.nextBasicAttackAt) > sv + 50)))) why = 'атака';   // nextBasicAttackAt — откат обычной атаки по серверу
    if (b && why === 'атака' && mp != null && Date.now() - lastMpNote > 30000) {
      const cheap = Math.min(...env.names(env.cfg.nPower).map(n => +skillInfo(env.slotsBy(n)[0])?.mpCost || Infinity));
      if (cheap !== Infinity && mp < cheap) { lastMpNote = Date.now(); env.rec('B', 'TvT', `MP ${mp} — на силовые не хватает (самый дешёвый ${cheap} MP), бью обычной атакой`); }
    }
    if (!b) { await env.sleep(150); continue; }
    env.setStatus(`TvT: ${why} — ${env.cleanTitle(b.title)} → ${cur?.name || 'цель'}${cur?.hp != null ? ` (${cur.hp}/${cur.maxHp})` : ''}`);
    const actBefore = env.TVTC?.actN || 0, sentAt = Date.now();
    env.fire(b);
    // ждём ответ сервера на этот удар (≈0,3–0,6 с), не дольше 1 с; нет ответа — клик игра не отправила (MP, откат, панель)
    const got = await env.waitX(() => (env.TVTC?.actN || 0) !== actBefore && env.TVTC?.actT >= sentAt ? true : null, 1000, 40);
    if (!got) stuckNote(b, mp); else misses.set(slotKey(b), 0);
    await env.sleep(got ? 40 : env.rnd(120, 220)); // подтверждённый ответ уже завершил ход; лишняя фиксированная пауза не нужна
    if (env.TVTC?.actErr && Date.now() - env.TVTC.actErr.t < 1500) await env.sleep(300);   // сервер отказал (откат/MP) — не долбим
    if (!canRun()) return false;
    // 10.0.11: «Атака питомца» — у Warlock кот основной урон, на арене он бьёт только по своей кнопке (#tvt-summon-attack-btn)
    const petBtn = env.$q('#tvt-summon-attack-btn');
    if (env.cfg.tvtPet !== false && env.shown(petBtn) && !petBtn.disabled && env.TVTC?.selfSummon?.alive !== false && Date.now() - lastPet > 1500) {
      lastPet = Date.now(); env.fire(petBtn); await env.sleep(env.rnd(120, 200));
    }
  }
  // Stop, потеря вкладки, смена страницы и предел одного вызова — не серверный итог события.
  return false;
}
 return { tvtNow, tvtMs, tvtState, tvtRegistrationDue, tvtRefresh, tvtSkillAllowed, tvtSkillsRefresh, isArena, tvtSoon, tvtHold, tvtWait, tvtStep, tvtLeave, tvtEnemies, tvtFight, tvtDeadNote, skillInfo, mpNow };
 };
})(globalThis);
