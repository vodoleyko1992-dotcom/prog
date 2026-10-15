/* L2wap v7: isolated survival feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.survival = function create_survival(env) {
const location = env.routeLocation || root.location;
// Переходы уже защищены ядром, но отложенная запись восстановления тоже
// принадлежит исходному персонажу, владельцу вкладки и команде игрока.
function contextGuard() {
  const char=env.rt.char,lease=env.leaseEpoch,kick=env.rt.manualKickAt;
  return () => env.on!==false && env.tabOwner!==false && env.rt.char===char && env.leaseEpoch===lease && env.rt.manualKickAt===kick;
}
async function restoreVitals(why) {
  const active=contextGuard();if(!active())return false;
  if (Date.now() - (env.rt.restoreT || 0) < (env.rt.restoreRes?.ok ? 10000 : 45000)) return false;   // v4.41: прошлое удалось — снова можно через 10 с (раньше 45 с, и бот лечился на мобах)
  if (env.rt.restoreRes && !env.rt.restoreRes.ok && Date.now() - env.rt.restoreRes.t < 180000) return false;   // не вышло — 3 мин лечимся иначе
  await env.setRt({ restoreT: Date.now(), tbuff: { set: null, fa: [], step: 'restore', why, t: Date.now(), back: location.pathname === '/fishing.html' ? '/fishing.html' : '/map.html' } });
  if(!active())return false;
  env.rec('B', 'восстановление', `${why} — к бафферу «Восстановить HP|MP|CP»`);
  location.href = '/town-buffer.html'; await env.sleep(4000);
  return true;
}

async function lowHpEscape(me) {
  const active=contextGuard();if(!active())return false;
  const now = Date.now(), lows = [...(env.rt.lowHp || []), now].filter(t => now - t < 20 * 60000);
  await env.setRt({ lowHp: lows, target: null });
  if(!active())return false;
  env.rec('B', 'мало HP', `HP ${me.pct | 0}% ≤ ${env.cfg.stopHp}% — выхожу из боя и восстанавливаюсь (${lows.length}/3 за 20 мин)`);
  if (lows.length >= 3) return env.halt(`Мало HP 3 раза за 20 мин — цели слишком сильные (проверьте уровни/банки)`);
  if (await restoreVitals(`мало HP (${me.pct | 0}%)`)) return;
  if(!active())return false;
  await env.toOutskirts();
}

async function onDeath() {
  const active=contextGuard();if(!active())return false;
  if (env.pvpPending?.()) return env.pvpRecoveryStep(); // PvP не учит силу оставшегося в URL РБ
  // 8.0.3 (лог 11.10 11:42:31 и 11:44:43: две смерти на Орфене за 2 мин — обе «1/3 за 30 мин»): «▶ Старт» стирает rt.deaths, а история
  // смертей за час (rt.deathLog) остаётся — счётчик «N/3 за 30 мин» и стоп после 3 смертей считаются по ней
  const now = Date.now(), deathLog = [...new Set([...(env.rt.deathLog || []), ...(env.rt.deaths || [])])].filter(t => now - t < 3600000).concat(now);
  const deaths = deathLog.filter(t => now - t < 30 * 60000);
  // 10.0 (аудит боя): spawnId РБ из адреса боя — точнее rt.rbCur (тот мог устареть); rbCur — запасной
  const urlRb = new URLSearchParams(location.search).get('spawnId') || '', rbId = /^l2dop_rb_/i.test(urlRb) ? urlRb : env.rt.target?.rb ? env.rt.rbCur : null;
  const epicD = env.epicOn() && rbId && env.epicById(rbId);   // 🐉 смерть на эпике — не «не по силам», а конец захода: запомнить его HP
  if (epicD) { const m = env.mobHp(); await env.setRt({ epic: { ...(env.rt.epic || {}), died: true, hpLog: [...((env.rt.epic || {}).hpLog || []).slice(-9), { t: Date.now(), cur: m?.cur ?? null, max: m?.max ?? null }] } });
    if(!active())return false;
    await env.epicDbSet(epicD.k, { deathsLife: ((env.rt.epicDb || {})[epicD.k]?.deathsLife || 0) + 1 }); }   // 8.0.3: смерти за это появление эпика
  if(!active())return false;
  // 8.0.3 (лог 11.10 10:31:48–10:32:18, Барда 55): ход висел 28,6 с (ответ 409), сервер молчал — герой погиб при «✅ победа вероятна»
  // (РБ 71 %, HP 62 %), а бот записал «не по силам» до 57 ур. и бросил недобитого. Сервер завис за 60 с до смерти (отметка l2bot.srvHang:
  // ход без ответа > 8 с или «нет ответа игры 20 с») — вердикт не ставим, только заметку; rbWound остаётся — тур вернётся добить
  let hang = null; try { hang = JSON.parse(sessionStorage.getItem('l2bot.srvHang') || 'null'); } catch (e) {}
  const srvHang = !!hang && now - (+hang.t || 0) < 60000;
  if (rbId && !epicD) {
    const nm = env.rt.rbDb?.[rbId]?.name || env.rt.rbSeen?.[rbId]?.name || env.mobName(), lvl = env.rt.rbDb?.[rbId]?.lvl || env.rt.rbSeen?.[rbId]?.lvl || 0, hm = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    if (srvHang) {
      await env.rbNote(rbId, { name: nm, lvl, note: `погиб при зависании сервера (${hang.why || 'ход без ответа'}) ${hm} — не «не по силам»` });
      if(!active())return false;
      env.rec('B', 'смерть', `${nm}: герой погиб, пока сервер не отвечал (${hang.why || 'ход без ответа'}) — «не по силам» не пишу, недобитого РБ добью позже`);
    } else {
      await env.rbNote(rbId, { verdict: 'no', name: nm, lvl, note: `убил героя ${hm}` });
      if(!active())return false;
      // 16.10: фактическая смерть запрещает немедленный повтор обычного РБ на30мин; модель силы такого запрета не даёт.
      if(!env.epicById(rbId))await env.setRt({rbPreSkip:{...(env.rt.rbPreSkip||{}),[rbId]:{t:Date.now(),kind:'death',safety:true}}});
    }
  }
  if(!active())return false;
  // 8.0.3 (лог 11.10 11:44:43): после смерти герой в городе, дальше — «Окрестности» другого места: прежняя зона и «мягкое окно» уровней
  // не годятся (автофарм решил «остаюсь здесь» по зоне эпика и бил мобов 15–35 героем 56) — зону определит карта заново
  await env.setRt({ deaths, deathLog, lastTeleport: '', campaignDue: !!env.cfg.campaign, target: null, catIn: null, toggleOn: {}, toggleOff: {}, zone: null, zonePend: null, lvlRelax: null, lvlRelaxDown: null });   // после смерти тогглы слетают   // v5.3: после смерти в подземелье — входим заново
  if(!active())return false;
  env.rec('B', 'смерть', `смертей за 30 мин: ${deaths.length}`);
  try { await env.rbRun?.death(); } catch (e) {}   // 10.0.6: смерть в серии РБ — в сводку «📦 Серия РБ»
  if(!active())return false;
  if (!env.cfg.autoRevive) return env.halt('Персонаж погиб');
  // 🐉 в фарме эпиков смерть — часть плана (заходы); предел — «смертей на эпика» в самом режиме. 8.0.3: общий стоп — пока эпик начат
  // (rt.epic.step ≠ «выбор»): 2 × «смертей на эпика» (не больше 20) за час; между эпиками (фарм мобов) — обычные 3 за 30 мин
  const epicNow = env.epicOn() && !!env.rt.epic?.k && env.rt.epic.step !== 'pick', epicCap = Math.min(20, 2 * Math.max(1, +env.cfg.epicMaxDeaths || 5));
  if (epicNow ? [...(env.rt.deaths1h || []), Date.now()].filter(t => Date.now() - t < 3600000).length >= epicCap : deaths.length >= 3) return env.halt(epicNow ? `${epicCap} смертей за час на эпиках — бот остановлен` : '3 смерти за 30 минут — бот остановлен (проверьте уровень целей и настройки)');
  // 8.0.3: смерть от любого босса (и в ручном бою, и в «Фарме РБ») — в счёт «2 смерти за час — за Coin of Luck не захожу» (epics)
  if (env.epicOn() || rbId) await env.setRt({ deaths1h: [...(env.rt.deaths1h || []), Date.now()].filter(t => Date.now() - t < 3600000) });
  if(!active())return false;
  env.setStatus(`Персонаж погиб (${deaths.length}/3 за 30 мин) — в город`);
  // Смерть уже учтена. Stop во время ожидания сохраняет только это намерение:
  // после Start продолжим воскрешение, а не посчитаем ту же смерть повторно.
  await env.setRt({ revive: { t: Date.now(), url: location.pathname + location.search, revived: false } });
  if(!active())return false;
  await env.sleep(env.rnd(1500, 2500));
  if(!active())return false;
  const btn = await env.waitFor(() => [env.$q('#battle-defeat-tocity'), env.$q('#map-defeat-tocity')].find(env.shown) || env.byText(/^(Вернуться в город|Повернутися до міста|В город|До міста)$/i, 'button,a'), 6000, 200);
  if(!active())return false;
  // v4.36: после смерти персонаж «без сознания», пока не зайти в город → магическую статую. До этого баффер отвечает
  // «Ти знепритомнів. Сначала натисни «В город»» и не восстанавливает HP/MP (бот стоял у баффера)
  await env.setRt({ revive: { t: Date.now(), url: location.pathname + location.search, revived: !!btn } });
  if(!active())return false;
  if (btn) { env.fire(btn); await env.waitFor(env.isCity, 8000); }   // не вышло — reviveStep повторит с экрана поражения
}

async function reviveStep() {
  const active=contextGuard();if(!active())return false;
  // v4.43 (журнал 01:48): «без сознания», пока на экране поражения не нажата «Вернуться в город». Экран поражения — на странице
  // того боя, где погибли; «Город» может открыться и без него (тогда статуя и бафф не работают). Поэтому: страница боя →
  // «Вернуться в город» (отметка «воскрешён» — до нажатия) → город → «Магическая статуя» → бафф → «Восстановить»
  let R = env.rt.revive;
  if(!R)return false;
  const finish = async (why, toBuffer) => {
    if(!active())return false;
    env.rec('B', 'воскрешение', why);
    await env.setRt({ revive: null, ...(toBuffer ? { restoreT: Date.now(), restoreRes: null, tbuff: { set: null, fa: [], step: 'restore', why: 'после смерти', t: Date.now(), back: '/map.html', reviveTried: true } } : {}) });
  };
  if (Date.now() - (R.t || 0) > 150000) return finish('не уложился в 2,5 мин — продолжаю как есть');
  const defeatBtn = () => [env.$q('#battle-defeat-tocity'), env.$q('#map-defeat-tocity')].find(env.shown) || null;
  // 8.0.3 (лог 11.10 11:44:46: бот стоял, игрок сам нажал «Вернуться в город» — отметки «воскрешён» не было, и после ▶ бот повёл героя
  // на страницу боя с Орфеном: battle/start → 400, ≈7 с впустую). Ответ POST /game/battle/return-to-town 2xx (content.js пишет время
  // во вкладке и при остановленном боте) позже смерти = воскрешён. Запись onDeath (revived: false) — считаем от времени смерти (игрок мог
  // нажать, пока бот ждал кнопку), запись «без сознания» от баффера — от её времени
  let toTown = 0; try { toTown = +sessionStorage.getItem('l2bot.toTown') || 0; } catch (e) {}
  const deathT = R.revived === false && env.rt.deathLog?.length ? Math.max(...env.rt.deathLog) : (R.t || 0) - 3000;
  if (!R.revived && toTown && toTown >= deathT) {
    R = { ...R, revived: true }; await env.setRt({ revive: R });
    if(!active())return false;
    env.rec('B', 'воскрешение', '«Вернуться в город» уже нажато (ответ игры) — к магической статуе');
  }
  const toCity = defeatBtn();
  if (toCity) {
    env.setStatus('После смерти: «Вернуться в город»');
    await env.setRt({ revive: { ...R, revived: true } });
    if(!active())return false;
    await env.pause();if(!active())return false;env.fire(toCity);
    await env.waitFor(env.isCity, 8000);
    if(!active())return false;
    env.rec('B', 'воскрешение', 'нажал «Вернуться в город»');
    return;
  }
  if (!R.revived) {
    // 8.0.3: смерть от босса — к экрану поражения через карту (там тот же «Вернуться в город»), а не на страницу боя с ним: она сама
    // шлёт battle/start — из города «слишком далеко» (лог 11:44:58), а рядом начала бы новый бой с тем, кто только что убил
    const url = R.url || env.rt.lastBattle, boss = /[?&]spawnId=l2dop_rb_/i.test(url || '');
    if (env.isBattle() || env.isMap()) {                    // экран поражения может появиться не сразу
      const found=await env.waitFor(defeatBtn, 4000, 200);if(!active())return false;if(found)return;
      if (env.isBattle()) { env.rec('B', 'воскрешение', 'на странице боя поражения нет — персонаж в сознании'); await env.setRt({ revive: { ...R, revived: true } }); return; }
      if (boss && (R.hops || 0) >= 1) { env.rec('B', 'воскрешение', 'на карте экрана поражения нет — персонаж в сознании'); await env.setRt({ revive: { ...R, revived: true } }); return; }
    }
    if ((R.hops || 0) >= 3) { env.rec('B', 'воскрешение', 'экран поражения не нашёл — пробую дальше как есть'); await env.setRt({ revive: { ...R, revived: true } }); return; }
    await env.setRt({ revive: { ...R, hops: (R.hops || 0) + 1 } });
    if(!active())return false;
    env.setStatus('После смерти: к экрану поражения');
    if (url && !boss && !(env.isBattle() && location.pathname + location.search === url)) location.href = url;
    else location.href = '/map.html';
    await env.sleep(4000);
    return;
  }
  if (env.isCity()) {
    env.setStatus('После смерти: «Магическая статуя» (баффер)');
    const st = await env.waitFor(() => [env.$q('a.l2-town-miru-item--buffer-statue'), ...document.querySelectorAll('a[href*="town-buffer"]')].find(env.shown) || null, 5000, 200);
    if(!active())return false;
    await finish('город → «Магическая статуя» — дальше бафф и «Восстановить»', true);   // до нажатия: оно уводит со страницы
    if(!active())return false;
    if (st) { await env.pause();if(!active())return false;env.fire(st);await env.waitFor(() => /town-buffer/.test(location.pathname), 6000); }
    else { location.href = '/town-buffer.html'; await env.sleep(3000); }
    return;
  }
  env.setStatus('После смерти: в город');
  const a = env.$q('#l2-nav-bottom a[data-nav-role="city"], a[data-nav-role="city"]');
  if (a) env.fire(a); else location.href = '/city.html';
  await env.waitFor(() => env.isCity() || !!defeatBtn(), 8000);
}
 return { restoreVitals, lowHpEscape, onDeath, reviveStep };
 };
})(globalThis);
