/* L2wap v7: isolated tvt feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.tvt = function create_tvt(env) {
const tvtNow = () => Date.now() + (env.TVT?.off || 0);

const tvtMs = v => typeof v === 'number' ? v : (v && Date.parse(v)) || 0;

function tvtState() {
  const T = env.TVT || env.rt.tvt; if (!T) return null;
  const nx = T.schedule?.next || {}, now = tvtNow();
  return { phase: T.phase || '', reg: !!(T.isRegistered || T.myTeam), team: T.myTeam, id: T.eventId || nx.slotKey || '',
    start: tvtMs(T.startsAt) || tvtMs(nx.battleStartsAt), end: tvtMs(T.endsAt), regEnd: tvtMs(T.registrationEndsAt), now, fresh: env.TVT && Date.now() - env.TVT.t < 120000 };
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
  const S = tvtState(); if (!S || !S.reg) return false;
  // 7.1.30 (лог 10.10 15:00–15:03): бой закончился (FINISHED), а правило «до старта < 60 с / идёт < 11 мин» по времени держало
  // «пора на арену» — бот 40 раз бегал рыбалка ↔ арена. Закончился/отменён — не на арену, какое бы ни было время
  if (/FINISH|RESULT|ENDED|IDLE|CANCEL/i.test(S.phase)) return false;
  if (env.rt.tvtDone && env.rt.tvtDone === S.id) return false;          // этот бой уже отыгран (итог записан)
  return /ACTIVE|PREPAR|STARTING|COMBAT/i.test(S.phase) || (S.start && S.start - S.now < 60000 && S.now - S.start < 11 * 60000);
}

async function tvtStep() {                          // true — шаг TvT сделан (главный цикл начинает заново)
  if (!env.cfg.tvtOn || env.isBattle()) return false;
  const pr = env.$q('#l2-tvt-registration-prompt'), yes = env.$q('#l2-tvt-registration-prompt-yes');
  if (pr && !pr.hidden && env.shown(yes)) { env.rec('B', 'TvT', 'окно «Зарегистрироваться на TvT?» — да'); await env.pause(); env.fire(yes); await env.sleep(1200); return true; }
  const S = tvtState(); if (!S) return false;
  // запись: регистрация открыта, нас нет — на арену, «Зарегистрироваться» (на одно событие — не чаще раза в 2 мин)
  const regN = (env.rt.tvtRegN || {})[S.id] || 0;   // 7.1.30: не больше 3 попыток записи на одно событие (иначе рыбалка ↔ арена каждые 2 мин)
  if (/REGISTRATION/i.test(S.phase) && !S.reg && regN < 3 && Date.now() - ((env.rt.tvtRegT || {})[S.id] || 0) > 120000) {
    if (!isArena()) { env.setStatus('TvT: иду записываться'); location.href = '/tvt-arena.html'; await env.sleep(4000); return true; }
    const b = await env.waitX(() => { const x = env.$q('#tvt-register-btn'); return env.shown(x) ? x : null; }, 6000, 200);
    await env.setRt({ tvtRegT: { ...(env.rt.tvtRegT || {}), [S.id]: Date.now() }, tvtRegN: { [S.id]: regN + 1 } });
    if (b) { await env.pause(); env.fire(b); env.rec('B', 'TvT', `записался на TvT (${S.id})`); await env.sleep(1500); }
    else env.rec('B', 'TvT', `кнопки «Зарегистрироваться» нет — ${(env.$q('#tvt-message')?.textContent || env.$q('#tvt-phase-label')?.textContent || '').trim().slice(0, 80)}`);
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

async function tvtLeave() {
  const head = (env.$q('.l2-tvt-result__headline')?.textContent || '').trim(), score = (env.$q('.l2-tvt-result__score')?.textContent || '').replace(/\s+/g, ' ').trim();
  const rew = [...document.querySelectorAll('.l2-tvt-result__reward-text')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(', ');
  const st = (env.$q('.l2-tvt-result__stats')?.textContent || '').trim();
  env.rec('B', 'TvT', `итог: ${head || '—'} ${score} · ${st}${rew ? ' · награда: ' + rew : ''}`);
  await env.setRt({ tvtIn: null, tvtDone: tvtState()?.id || env.rt.tvtDone || null });   // 7.1.30: отыгранный бой больше не зовёт на арену
  location.href = env.autonomyMode() === 'fish' ? '/fishing.html' : '/map.html'; await env.sleep(3000); return true;
}

function tvtEnemies() {                             // живые враги: из ответа игры (HP/CP/стан), иначе — список на странице
  const els = [...document.querySelectorAll('.l2-tvt-nick[data-target-kind="enemy"][data-character-id]')];
  const R = (env.TVT?.combatRoster || []).filter(x => x && typeof x === 'object');
  return els.map(e => { const id = e.dataset.characterId, r = R.find(x => String(x.characterId) === String(id)) || {};   // v5.6: id из API может быть числом
    return { e, id, name: e.textContent.trim(), lvl: +((e.title || '').match(/\d+/)?.[0] || 0), hp: r.hp ?? null, cp: r.cp ?? 0, alive: r.alive !== false && !e.className.includes('dead') && !isDead(id) }; })
    .filter(x => x.alive);
}

async function tvtFight() {
  if (!env.rt.tvtIn) { await env.setRt({ tvtIn: tvtState()?.id || 1 }); env.rec('B', 'TvT', 'на арене — жду старт'); }
  let lastPot = 0, lastTgt = 0, lastBack = 0;
  const t0 = Date.now();
  while (env.on && env.tabOwner && isArena() && Date.now() - t0 < 12 * 60000) {
    const S = tvtState() || {};
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
    const best = en.sort((a, b) => ((a.hp ?? 1e9) + a.cp) - ((b.hp ?? 1e9) + b.cp) || a.lvl - b.lvl)[0];
    if (cur && (cur.alive === false || cur.hp === 0) && cur.characterId) tvtDeadNote(cur.characterId);
    const curDead = !cur || cur.alive === false || cur.hp === 0 || !en.some(x => x.id === cur.characterId);
    const better = best && cur && best.hp != null && cur.hp != null && best.id !== cur.characterId && best.hp + best.cp < (cur.hp + (cur.cp || 0)) * 0.5;
    // цель пала, а на экране ещё панель боя с ней: «← Вернуться на TvT» — игра снимает цель и перерисовывает список врагов
    // (как сделал игрок в 03:00:26), затем выбираем следующего. Не чаще раза в 4 с — если кнопка не помогла, жмём врага напрямую
    const back = env.$q('#tvt-back-roster-btn');
    if (curDead && cur && domCur && env.shown(back) && Date.now() - lastBack > 4000) {
      lastBack = Date.now(); env.rec('B', 'TvT', `${cur.name || 'цель'} повержен — назад к списку врагов`); env.fire(back); await env.sleep(env.rnd(350, 550)); continue;
    }
    if (best && (curDead || better) && Date.now() - lastTgt > 1500) {
      lastTgt = Date.now(); env.setStatus(`TvT: цель ${best.name}${best.hp != null ? ` (HP ${best.hp})` : ''}`); env.fire(best.e); await env.sleep(env.rnd(350, 550)); continue;
    }
    if (curDead) { env.setStatus(best ? `TvT: выбираю цель — ${best.name}` : 'TvT: живых врагов нет — жду'); await env.sleep(best ? 300 : 800); continue; }   // 9.2: по павшей цели скиллы не жмём
    const me = env.meHp();
    // банка HP: на арене — с 60 %, не чаще раза в 1,1 с
    if (me && me.pct <= 60 && Date.now() - lastPot > 1100) { const pot = env.hpPotPick(me.pct <= 35); if (pot) { lastPot = Date.now(); env.fire(pot); await env.sleep(env.rnd(150, 250)); continue; } }
    const sv = tvtNow(), stunned = (cur?.stunnedUntil || 0) > sv;
    const pickR = list => env.names(list).map(n => env.slotsBy(n)[0]).find(b => b && env.ready(b));
    let b = null, why = '';
    if (!stunned && (b = pickR(env.cfg.nStun))) why = 'стан';
    else if ((b = pickR(env.cfg.nUltra))) why = 'сверхсильный';
    else if ((b = env.forceCosts().map(c => ({ c, x: env.slotsBy(c.name)[0] })).filter(o => o.x && env.ready(o.x) && (env.hudForce() ?? env.forceNow()) >= o.c.cost).sort((p, q) => q.c.cost - p.c.cost)[0]?.x)) why = 'энергия';
    else if ((b = pickR(env.cfg.nPower))) why = 'удар';
    else if ((env.hudForce() ?? env.forceNow()) < Math.max(2, env.forceMax()) && (b = pickR(env.cfg.nCharge))) why = 'заряд';
    else if ((b = env.slotsBy(env.cfg.nAttack).find(env.ready))) why = 'атака';
    if (!b) { await env.sleep(150); continue; }
    env.setStatus(`TvT: ${why} — ${env.cleanTitle(b.title)} → ${cur?.name || 'цель'}${cur?.hp != null ? ` (${cur.hp}/${cur.maxHp})` : ''}`);
    env.fire(b); await env.sleep(env.rnd(380, 560));
  }
  return tvtLeave();
}
 return { tvtNow, tvtMs, tvtState, isArena, tvtSoon, tvtStep, tvtLeave, tvtEnemies, tvtFight, tvtDeadNote };
 };
})(globalThis);
