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
// Опрос и бой принадлежат одному герою, классу и запуску, даже когда ID события не изменился.
const identity = () => JSON.stringify([env.rt.char || '', env.rt.classCur?.prof || '', env.rt.classCur?.slot ?? null]);
const token = () => ({ identity: identity(), kick: +env.rt.manualKickAt || 0 });
const active = T => canRun() && T.identity === identity() && T.kick === (+env.rt.manualKickAt || 0);

function tvtState() {
  const T = env.TVT || env.rt.tvt; if (!T) return null;
  const nx = T.schedule?.next || {}, now = tvtNow(), regEnd = tvtMs(T.registrationEndsAt);
  // 20.17 (лог 18.10 21:30–21:55): во время регистрации schedule.next может уже показывать следующий слот — тогда старт берём
  // от конца регистрации (подготовка 30 с), иначе записанный герой не видел «бой вот-вот» и не шёл на арену
  const nxStart = tvtMs(nx.battleStartsAt), regStart = regEnd && /REGISTRATION/i.test(T.phase || '') ? regEnd + 30000 : 0;
  return { phase: T.phase || '', reg: !!(T.isRegistered || T.myTeam), team: T.myTeam, id: T.eventId || nx.slotKey || '',
    start: tvtMs(T.startsAt) || (regStart && !(nxStart >= regEnd && nxStart - regEnd < 10 * 60000) ? regStart : nxStart), end: tvtMs(T.endsAt), regEnd: tvtMs(T.registrationEndsAt), now, fresh: env.TVT && Date.now() - env.TVT.t < 120000,
    regOpen: tvtMs(nx.registrationOpensAt), count: +T.registeredCount || 0, max: +T.maxPlayers || 20, age: Date.now() - (+T.t || 0),
    eliminated: !!T.isRegistered && /^(ACTIVE|FINISHED)$/i.test(T.phase || '') && T.selfCombat?.alive === false };
}
// 20.13 (ревизия 17.10, шаг 5, pvp-misc/TVT-1): регистрацию, которую нельзя выполнить, не держим приоритетом всё окно —
// раньше при 20/20 мест или без кнопки «Зарегистрироваться» tvtStep каждый круг возвращал true и PvE стояло до 10 мин (у неподходящего
// героя — каждое событие). Нет мест — регистрация не «пора», пока фоновый опрос не увидит свободное место (тогда снова на арену);
// кнопки нет дважды подряд — пропуск до конца окна этого события (rt.tvtRegSkip, причина в журнале).
const regSkipped = s => { const K = env.rt.tvtRegSkip; return !!K && K.id === s.id && s.now < (+K.until || 0); };
const tvtRegistrationDue = () => { const s = tvtState(); return canRun() && !!s && /REGISTRATION/i.test(s.phase) && !s.reg && (!s.regEnd || s.now < s.regEnd) && s.count < s.max && !regSkipped(s); };
// 20.13 (ревизия 17.10, шаг 5, pvp-misc/TVT-6): фаза боя из старых данных (Stop посреди TvT, свой опрос не шёл, пока записаны) держала
// приоритет без предела по времени — бот уходил на арену и ждал врагов часами. Фаза «идёт» верна только до конца боя:
// известный endsAt (+5 мин запаса на итог сервера) или 20 мин от старта (бой ≈10 мин). Обычный путь — свежий опрос (stale в tvtRefresh).
const phaseLive = S => /ACTIVE|PREPAR|STARTING|COMBAT/i.test(S.phase) && !(S.end && S.now > S.end + 5 * 60000)
  && !(S.start && S.now - S.start > 20 * 60000 && !(S.end && S.now < S.end));
let readAt = 0, readIdentity = '', reading = null;
// 20.13 (ревизия 17.10, шаг 7, pvp-misc/TVT-7): при пустом состоянии и нерабочем /game/tvt (нет доступа, 401/403/5xx) GET шёл каждые
// 5 с на каждом круге и ходе боя (≈720 в час). Подряд неудачи без известного состояния: 3 по 5 с, ещё 3 по 30 с, дальше раз в 5 мин.
// Известное состояние (окно регистрации, stale, записаны) опрашивается как прежде; удачный ответ сбрасывает счётчик
let readFail = 0;
const emptyGap = () => readFail < 3 ? 5000 : readFail < 6 ? 30000 : 300000;
async function tvtRefresh(force = false) {
  if (!canRun() || !env.gameGet) return;
  const T0 = token();
  if (reading?.identity === T0.identity && reading.kick === T0.kick) return;
  if (readIdentity !== T0.identity) { readIdentity = T0.identity; readAt = 0; readFail = 0; }
  const s = tvtState(), now = Date.now(), opening = s?.regOpen && s.now >= s.regOpen - 5000 && s.now <= s.regOpen + 10000;
  // 10.0.22: после сна вкладки можно пропустить первые10с открытия; продолжаем читать до конца окна.
  const closes = s && (s.regEnd > s.regOpen ? s.regEnd : s.start > s.regOpen ? s.start : s.regOpen + 10 * 60000);
  const pendingWindow = s?.regOpen && s.now >= s.regOpen && s.now < closes;
  // 20.13 (ревизия 17.10, шаг 5, pvp-misc/TVT-6): записанный герой тоже перечитывает статус, когда данные старше минуты, а бой идёт
  // или вот-вот начнётся, — иначе старая фаза ACTIVE после Stop жила, пока игра сама не опросит /game/tvt
  const hold = Math.max(1, +env.cfg.tvtHoldMin || 3) * 60000;
  const stale = !!s?.reg && s.age > 60000 && (/ACTIVE|PREPAR|STARTING|COMBAT/i.test(s.phase) || (s.start && s.start - s.now < hold && s.now - s.start < 20 * 60000)
    || (/REGISTRATION/i.test(s.phase) && s.regEnd && s.regEnd - s.now < hold));
  // 20.13 (шаг 5, pvp-misc, ревью): 20/20 мест — регистрация не «пора», но освобождение места ловим опросом и без известного
  // registrationOpensAt (раньше due держала сама tvtRegistrationDue, теперь она false при полной записи)
  const regFull = !!s && !s.reg && /REGISTRATION/i.test(s.phase) && (!s.regEnd || s.now < s.regEnd) && s.count >= s.max && !regSkipped(s);
  // 20.17 (лог 18.10 21:30–21:55): известное расписание устарело — окно его слота уже прошло (или слота нет), а свежих данных
  // нет дольше 5 мин. Раньше бот сам /game/tvt в этом случае не читал вовсе и ждал, пока игра опросит её сама: после рестарта
  // вкладки в rt.tvt лежал утренний слот, окно 21:50 открылось, а бот 5+ мин рыбачил/стоял в паузе и не записался
  const outdated = !!s && !s.reg && !/REGISTRATION|ACTIVE|PREPAR|STARTING|COMBAT/i.test(s.phase) && s.age > 300000 && !(s.regOpen && s.now < closes);
  const due = !s || stale || outdated || !s.reg && (opening || pendingWindow || regFull || tvtRegistrationDue());
  if (!force && (!due || now - readAt < (opening ? 1000 : !s ? emptyGap() : outdated ? 60000 : 5000))) return;
  reading = T0; readAt = now;
  try {
    const response = await env.gameGet('/game/tvt', 8000), data = response?.ok ? await response.json() : null;
    if (!active(T0)) return;
    if (typeof data?.phase !== 'string') { readFail++; return; }
    readFail = 0;
    const t = Date.now();
    env.TVT = { ...data, t, off: tvtMs(data.serverNow) ? tvtMs(data.serverNow) - t : 0 };
    const T = env.TVT;
    await env.setRt({ tvt: { phase: T.phase, eventId: T.eventId, isRegistered: T.isRegistered, myTeam: T.myTeam,
      startsAt: T.startsAt, registrationEndsAt: T.registrationEndsAt, schedule: T.schedule, registeredCount: T.registeredCount,
      maxPlayers: T.maxPlayers, selfCombat: typeof T.selfCombat?.alive === 'boolean' ? { alive: T.selfCombat.alive } : null, t, off: T.off } });
  } catch (e) { if (active(T0)) readFail++; } finally { if (reading === T0) reading = null; }
}

const isArena = () => /\/tvt-arena\.html/i.test(location.pathname);
const LEAVE_KEY = 'l2bot.tvtLeaveT';
const leaveRead = () => { try { return +root.sessionStorage?.getItem(LEAVE_KEY) || 0; } catch (e) { return 0; } };
const leaveSave = t => { try { root.sessionStorage?.setItem(LEAVE_KEY, String(t)); } catch (e) {} };

// 9.2 (лог 11.10 03:00): убитый враг остаётся в списке команды как живой, пока открыта панель боя — игра перерисовывает
// список только после «← Вернуться на TvT» (POST /game/tvt/target/clear). Бот 20 с жал на xdesx: POST /game/tvt/target → 400
// tvt_target_dead, Blaze «Скилл сейчас недоступен». Павших помним по ответам сервера (action.targetDead, target → tvt_target_dead).
const DEAD_MS = 45000, tvtDead = new Map();       // id врага → когда пал (на случай воскрешения — забываем через 45 с)
const deadKey = id => `${identity()}:${tvtState()?.id || ''}:${id}`;
function tvtDeadNote(id) { if (id != null && id !== '') tvtDead.set(deadKey(id), Date.now()); }
const isDead = id => { const t = tvtDead.get(deadKey(id)); return !!t && Date.now() - t < DEAD_MS; };

function tvtSoon() {                                // пора на арену: записаны и бой вот-вот / идёт
  if (!env.cfg.tvtOn) return false;
  const S = tvtState(); if (!S || !S.reg || S.eliminated) return false;
  // 7.1.30 (лог 10.10 15:00–15:03): бой закончился (FINISHED), а правило «до старта < 60 с / идёт < 11 мин» по времени держало
  // «пора на арену» — бот 40 раз бегал рыбалка ↔ арена. Закончился/отменён — не на арену, какое бы ни было время
  if (/FINISH|RESULT|ENDED|IDLE|CANCEL/i.test(S.phase)) return false;
  if (env.rt.tvtDone && env.rt.tvtDone === (S.id || String(S.start || ''))) return false;   // 10.0: пустой id события — по времени старта          // этот бой уже отыгран (итог записан)
  return phaseLive(S) || (S.start && S.start - S.now < 60000 && S.now - S.start < 11 * 60000);
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
  if (phaseLive(S)) return true;
  const hold = Math.max(1, +env.cfg.tvtHoldMin || 3) * 60000;
  return !!(S.start && S.start - S.now < hold && S.now - S.start < 11 * 60000);
}

// 20.13 (ревизия 17.10, шаг 7, pvp-misc/TVT-8): метка «уже написали про это окно» — в замыкании модуля, а не прямой записью в env.rt мимо setRt
// (та тоже жила только до перезагрузки вкладки, так что поведение прежнее)
let holdNote = '';
async function tvtWait() {                          // окно TvT, дел на арене ещё нет — стоим на месте, задачи отложены
  const S = tvtState() || {}, left = S.start ? Math.max(0, Math.round((S.start - S.now) / 1000)) : 0;
  env.setStatus(`TvT через ${left} с — задачи отложены, жду на месте`);
  const k = S.id || String(S.start || '');
  if (holdNote !== k) { holdNote = k; env.rec('B', 'TvT', `до боя ${left} с — закупку, магистра, баффы, Маммона, квесты и туры откладываю до конца TvT`); }
  await env.sleep(1000);
}

async function tvtStep() {                          // true — шаг TvT сделан (главный цикл начинает заново)
  if (!canRun()) return false;
  const T0 = token();
  // 10.0.22: GET статуса не блокирует удары при медленном сервере; известная регистрация прерывает бой сразу.
  if (env.isBattle()) void tvtRefresh(); else await tvtRefresh();
  if (!active(T0)) return false;
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
    // 20.13 (ревизия 17.10, шаг 5, pvp-misc/TVT-3): метка прошлого выхода переживает перезагрузку (sessionStorage). Раньше она жила
    // только в странице: выход не подтверждён → leaveCheck вернул в бой → новая страница сразу снова уходила (пинг-понг каждые 3 с,
    // по РБ почти без ударов). Вернулись в бой после своего же выхода — следующая попытка не раньше чем через 30 с.
    const prevLeave = leaveRead(), returned = prevLeave > tvtStep.leaveT && Date.now() - prevLeave < 120000;
    const gap = returned ? 30000 : registration ? 3000 : 30000;
    if (Date.now() - Math.max(tvtStep.leaveT, returned ? prevLeave : 0) < gap) return false;
    tvtStep.leaveT = Date.now(); leaveSave(tvtStep.leaveT);
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
    const retry = [3000, 5000, 10000, 30000][Math.min(3, Math.max(0, regN - 1))];
    if (Date.now() - ((env.rt.tvtRegT || {})[S.id] || 0) < retry) { await env.sleep(200); return true; }
    const b = await env.waitX(() => { const x = env.$q('#tvt-register-btn'); return env.shown(x) ? x : null; }, 6000, 200);
    if (!active(T0) || !tvtRegistrationDue() || tvtState()?.id !== S.id) return false;
    await env.setRt({ tvtRegT: { ...(env.rt.tvtRegT || {}), [S.id]: Date.now() }, tvtRegN: { [S.id]: regN + 1 } });
    if (!active(T0)) return false;
    if (b) {
      if (env.rt.tvtRegNoBtn) await env.setRt({ tvtRegNoBtn: null });
      if (!active(T0)) return false;
      await env.pause(); if (!active(T0) || !tvtRegistrationDue() || tvtState()?.id !== S.id || b.disabled) return false; env.fire(b);
      env.rec('B', 'TvT', `регистрация отправлена (${S.count}/${S.max}); жду подтверждения сервера`);
      await env.sleep(1500); if (!active(T0)) return false;
      if (!tvtState()?.reg) await tvtRefresh(true);
      if (!active(T0)) return false;
      if (!tvtState()?.reg) { env.setStatus('TvT: регистрация пока не подтверждена — остаюсь на арене'); return true; }
      env.rec('B', 'TvT', `регистрация подтверждена (${S.id})`);
    }
    else {
      // 20.13 (ревизия 17.10, шаг 5, pvp-misc/TVT-1): кнопки нет второй раз подряд — герой не подходит под условия события;
      // до конца окна регистрации этого события PvE не держим (раньше повтор раз в 30 с все 10 мин, каждое событие)
      const why = (env.$q('#tvt-message')?.textContent || env.$q('#tvt-phase-label')?.textContent || '').trim().slice(0, 80);
      const nb = env.rt.tvtRegNoBtn?.id === S.id ? (+env.rt.tvtRegNoBtn.n || 0) + 1 : 1;
      if (nb >= 2) {
        const until = S.regEnd || S.start || (S.now + 10 * 60000);
        await env.setRt({ tvtRegNoBtn: null, tvtRegSkip: { id: S.id, until, why: why || 'нет кнопки «Зарегистрироваться»' } });
        if (!active(T0)) return false;
        env.rec('B', 'TvT', `кнопки «Зарегистрироваться» нет и при повторе${why ? ` (${why})` : ''} — это событие пропускаю до конца регистрации, возвращаюсь к делу`);
        location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(3000); return true;
      }
      await env.setRt({ tvtRegNoBtn: { id: S.id, n: nb } });
      env.rec('B', 'TvT', `кнопки «Зарегистрироваться» нет — ${why}`);
    }
    if (!active(T0)) return false;
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
  const T0 = token(), event = tvtState()?.id;
  const head = (env.$q('.l2-tvt-result__headline')?.textContent || '').trim(), score = (env.$q('.l2-tvt-result__score')?.textContent || '').replace(/\s+/g, ' ').trim();
  const rew = [...document.querySelectorAll('.l2-tvt-result__reward-text')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(', ');
  const st = (env.$q('.l2-tvt-result__stats')?.textContent || '').trim();
  env.rec('B', 'TvT', why ? `${why} — возвращаюсь к прежнему режиму` : `итог: ${head || '—'} ${score} · ${st}${rew ? ' · награда: ' + rew : ''}`);
  await env.setRt({ tvtIn: null, tvtDone: (tvtState()?.id || String(tvtState()?.start || '')) || env.rt.tvtDone || null });   // 7.1.30: отыгранный бой больше не зовёт на арену
  if (active(T0) && tvtState()?.id === event && (isArena() || /\/chat\.html/i.test(location.pathname))) { location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(3000); }
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
const skillSnapshot = () => env.TVTS?.identity && env.TVTS.identity !== identity() ? null : env.TVTS;
const TVTS = () => (skillSnapshot()?.skills || []).filter(x => x && typeof x === 'object');
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
  return !skillSnapshot()?.complete || /^(?:attack|basic_attack|battle_potion)/.test(key);
}
let skillsReadAt = 0, skillsIdentity = '';
async function tvtSkillsRefresh() {
  const key = identity() + ':' + (tvtState()?.id || '');
  if (skillsIdentity !== key) { skillsIdentity = key; skillsReadAt = 0; }
  if (!canRun() || !env.gameGet || env.TVTS?.complete && env.TVTS.event === tvtState()?.id && env.TVTS.identity === identity() || Date.now() - skillsReadAt < 5000) return;
  skillsReadAt = Date.now();
  try {
    const T0 = token(), event = tvtState()?.id, r = await env.gameGet('/game/tvt/skills', 5000), data = r?.ok ? await r.json() : null;
    if (active(T0) && tvtState()?.id === event && Array.isArray(data?.skills)) env.TVTS = { identity: T0.identity, skills: data.skills.filter(x => x && typeof x === 'object'), complete: true, event, t: Date.now() };
  } catch (e) {}
}
const stuck = new Map(), misses = new Map();      // ключ слота → до какого времени не жмём / сколько кликов подряд без ответа
const slotKey = b => `${identity()}:${tvtState()?.id || ''}:` + String(env.slotAction?.(b) || env.cleanTitle(b?.title || '') || '').toLowerCase();
const notStuck = b => (stuck.get(slotKey(b)) || 0) <= Date.now();
function stuckNote(b, mp) {
  const k = slotKey(b), n = (misses.get(k) || 0) + 1; misses.set(k, n);
  if (n >= 2) { stuck.set(k, Date.now() + 3000); misses.set(k, 0);
    if (Date.now() - (stuckNote.t || 0) > 60000) { stuckNote.t = Date.now(); env.rec('B', 'TvT', `клик «${env.cleanTitle(b?.title || '')}» игра не отправляет (MP ${mp ?? '?'}) — 3 с бью другим`); } }
}

// 20.11 (лог 17.10 15:00–15:02, West Tyrant 57 на TvT): Focused Force 69 раз ответил «+1 енергія (1/4)» — на арене энергия не копится,
// бот сжёг на заряды ≈345 MP; к 15:01:01 MP 2, обычная атака бьёт по 1 урону, и 57 с бот «бил» luk без урона, хотя на панели
// 1013 банок MP (#728). Банки арены подписаны «#728 — зілля …» без имени, поэтому nMpPot и HP_POT_RE их не узнавали.
// Теперь: энергию берём из ответа сервера (skillLine «(n/max)»), заряд, который не растёт два нажатия подряд, до конца события не жмём;
// банки арены узнаём по ID предмета (и по restoredHp/restoredMp ответа), MP пьём при нехватке на силовые или ≤35 %.
const POT_MP = new Set([726, 728]), POT_HP = new Set([725, 727, 1060, 1061, 1073, 1539, 1540]);
const potLearned = new Map();                     // itemId → 'hp' | 'mp' по ответу сервера на глоток
const charge = { key: '', n: null, max: null, flat: 0, off: false, last: null, prevSkill: null };
const chargeKey = () => identity() + ':' + (tvtState()?.id || '');
function chargeState() { const k = chargeKey(); if (charge.key !== k) Object.assign(charge, { key: k, n: null, max: null, flat: 0, off: false, last: null, prevSkill: null }); return charge; }
const CHARGE_LINE = /(?:енергі|энерги|energy|заряд)[^()]*\((\d+)\s*\/\s*(\d+)\)/i;
function tvtActNote(req, res) {
  const c = chargeState();
  if (!res || res.error) return;
  if (req?.action === 'potion' && req.itemId != null) {
    const kind = +res.restoredMp > 0 ? 'mp' : +res.restoredHp > 0 ? 'hp' : null; if (kind) potLearned.set(+req.itemId, kind);
    return;
  }
  const sk = res.skillId ?? req?.skillId ?? null, m = String(res.skillLine || '').match(CHARGE_LINE);
  if (m) {
    const n = +m[1], max = +m[2];
    if (c.prevSkill === sk && c.last != null && n <= c.last && n < max) c.flat++; else c.flat = 0;
    c.n = n; c.max = max; c.last = n; c.prevSkill = sk;
    if (c.flat >= 2 && !c.off) { c.off = true; env.rec('B', 'TvT', `заряд не копит энергию (${n}/${max} после каждого нажатия) — до конца боя не жму, MP на удары`); }
  } else if (sk != null) c.prevSkill = sk;
}
const SLOT_SEL = '.l2-battle-hotbar-slot';
const slotQty = b => { const t = b?.querySelector?.('.l2-battle-hotbar-slot-uqty')?.textContent; return t ? parseInt(t.replace(/\D/g, ''), 10) : null; };
function potKindOf(b) {
  const t = String(b?.title || ''), id = +(t.match(/^#(\d+)\s*[—–-]/)?.[1] || 0);
  if (id && potLearned.has(id)) return potLearned.get(id);
  if (id && POT_MP.has(id)) return 'mp';
  if (id && POT_HP.has(id)) return 'hp';
  if (!/зілля|зелье|potion/i.test(t)) return null;
  return /ман|mana|\bmp\b/i.test(t) ? 'mp' : /hp|зцілен|исцелен|лікуван|лечен|healing|здоров/i.test(t) ? 'hp' : null;
}
function arenaPot(kind) {
  const all = [...(document.querySelectorAll?.(SLOT_SEL) || [])];
  const own = kind === 'mp' ? env.names(env.cfg.nMpPot || '').flatMap(n => env.slotsBy(n)) : [];
  const slow = b => /^#726\b/.test(String(b?.title || '')) ? 1 : 0;   // Mana Drug восстанавливает медленно — только если другой нет
  return [...new Set([...own, ...all.filter(b => potKindOf(b) === kind)])].filter(b => slotQty(b) !== 0 && env.ready(b)).sort((a, b) => slow(a) - slow(b))[0] || null;
}
function mpMax() { const m = env.meMp?.(); return +m?.max || +env.TVTC?.selfMaxMp || 0; }

async function tvtFight() {
  if (!canRun()) return false;
  const T0 = token(), event = tvtState()?.id;
  const fighting = () => active(T0) && tvtState()?.id === event;
  if (!env.rt.tvtIn) { await env.setRt({ tvtIn: tvtState()?.id || 1 }); env.rec('B', 'TvT', 'на арене — жду старт'); }
  let lastPot = 0, lastMpPot = 0, lastTgt = 0, lastTgtId = '', lastBack = 0, lastPet = 0, lastMpNote = 0;
  const t0 = Date.now();
  while (fighting() && isArena() && Date.now() - t0 < 12 * 60000) {
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
    if (!fighting()) return false;
    const me = env.meHp();
    // банка HP: на арене — с 60 %, не чаще раза в 1,1 с
    if (me && me.pct <= 60 && Date.now() - lastPot > 1100) { const pot = env.hpPotPick(me.pct <= 35) || arenaPot('hp'); if (pot) { lastPot = Date.now(); env.fire(pot); await env.sleep(env.rnd(150, 250)); continue; } }
    const sv = tvtNow(), stunned = (cur?.stunnedUntil || 0) > sv, mp = mpNow();
    // 20.11: банка MP — не хватает на самый дешёвый силовой/стан или MP ≤ 35 %; не чаще раза в 1,1 с
    if (mp != null && Date.now() - lastMpPot > 1100) {
      const costs = env.names(`${env.cfg.nPower || ''}, ${env.cfg.nStun || ''}, ${env.cfg.nUltra || ''}`).map(n => +skillInfo(env.slotsBy(n)[0])?.mpCost).filter(x => x > 0);
      const mx = mpMax(), low = (costs.length && mp < Math.min(...costs)) || (mx && mp <= mx * 0.35);
      const pot = low ? arenaPot('mp') : null;
      if (pot) { lastMpPot = Date.now(); if (Date.now() - lastMpNote > 30000) { lastMpNote = Date.now(); env.rec('B', 'TvT', `MP ${mp}${mx ? '/' + mx : ''} — пью банку MP (${env.cleanTitle(pot.title || '').slice(0, 40)})`); }
        env.fire(pot); await env.sleep(env.rnd(150, 250)); continue; }
    }
    const ch = chargeState(), force = ch.n ?? env.hudForce() ?? env.forceNow(), fMax = ch.max || env.forceMax();
    const okB = b => b && tvtSkillAllowed(b) && env.ready(b) && notStuck(b) && srvReady(b) && mpOk(b, mp);
    const pickR = list => env.names(list).map(n => env.slotsBy(n)[0]).find(okB);
    let b = null, why = '';
    if (!stunned && (b = pickR(env.cfg.nStun))) why = 'стан';
    else if ((b = pickR(env.cfg.nUltra))) why = 'сверхсильный';
    else if ((b = env.forceCosts().map(c => ({ c, x: env.slotsBy(c.name)[0] })).filter(o => okB(o.x) && force >= o.c.cost).sort((p, q) => q.c.cost - p.c.cost)[0]?.x)) why = 'энергия';
    else if ((b = pickR(env.cfg.nPower))) why = 'удар';
    else if (!ch.off && force < Math.max(2, fMax) && (b = pickR(env.cfg.nCharge))) why = 'заряд';
    else if ((b = env.slotsBy(env.cfg.nAttack).find(x => okB(x) && !(tvtMs(env.TVTC?.nextBasicAttackAt) > sv + 50)))) why = 'атака';   // nextBasicAttackAt — откат обычной атаки по серверу
    if (b && why === 'атака' && mp != null && Date.now() - lastMpNote > 30000) {
      const cheap = Math.min(...env.names(env.cfg.nPower).map(n => +skillInfo(env.slotsBy(n)[0])?.mpCost || Infinity));
      if (cheap !== Infinity && mp < cheap) { lastMpNote = Date.now(); env.rec('B', 'TvT', `MP ${mp} — на силовые не хватает (самый дешёвый ${cheap} MP), банки MP на панели нет — бью обычной атакой`); }
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
    if (!fighting()) return false;
    // 10.0.11: «Атака питомца» — у Warlock кот основной урон, на арене он бьёт только по своей кнопке (#tvt-summon-attack-btn)
    const petBtn = env.$q('#tvt-summon-attack-btn');
    if (env.cfg.tvtPet !== false && env.shown(petBtn) && !petBtn.disabled && env.TVTC?.selfSummon?.alive !== false && Date.now() - lastPet > 1500) {
      lastPet = Date.now(); env.fire(petBtn); await env.sleep(env.rnd(120, 200));
    }
  }
  // Stop, потеря вкладки, смена страницы и предел одного вызова — не серверный итог события.
  return false;
}
 return { tvtNow, tvtMs, tvtState, tvtRegistrationDue, tvtRefresh, tvtSkillAllowed, tvtSkillsRefresh, isArena, tvtSoon, tvtHold, tvtWait, tvtStep, tvtLeave, tvtEnemies, tvtFight, tvtDeadNote, tvtActNote, skillInfo, mpNow, arenaPot, potKindOf };
 };
})(globalThis);
