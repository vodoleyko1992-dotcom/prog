/* L2wap v7: isolated survival feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.survival = function create_survival(env) {
async function restoreVitals(why) {
  if (Date.now() - (env.rt.restoreT || 0) < (env.rt.restoreRes?.ok ? 10000 : 45000)) return false;   // v4.41: прошлое удалось — снова можно через 10 с (раньше 45 с, и бот лечился на мобах)
  if (env.rt.restoreRes && !env.rt.restoreRes.ok && Date.now() - env.rt.restoreRes.t < 180000) return false;   // не вышло — 3 мин лечимся иначе
  await env.setRt({ restoreT: Date.now(), tbuff: { set: null, fa: [], step: 'restore', why, t: Date.now(), back: location.pathname === '/fishing.html' ? '/fishing.html' : '/map.html' } });
  env.rec('B', 'восстановление', `${why} — к бафферу «Восстановить HP|MP|CP»`);
  location.href = '/town-buffer.html'; await env.sleep(4000);
  return true;
}

async function lowHpEscape(me) {
  const now = Date.now(), lows = [...(env.rt.lowHp || []), now].filter(t => now - t < 20 * 60000);
  await env.setRt({ lowHp: lows, target: null });
  env.rec('B', 'мало HP', `HP ${me.pct | 0}% ≤ ${env.cfg.stopHp}% — выхожу из боя и восстанавливаюсь (${lows.length}/3 за 20 мин)`);
  if (lows.length >= 3) return env.halt(`Мало HP 3 раза за 20 мин — цели слишком сильные (проверьте уровни/банки)`);
  if (await restoreVitals(`мало HP (${me.pct | 0}%)`)) return;
  await env.toOutskirts();
}

async function onDeath() {
  const deaths = [...(env.rt.deaths || []), Date.now()].filter(t => Date.now() - t < 30 * 60000);
  const rbId = env.rt.target?.rb ? env.rt.rbCur : (/^l2dop_rb_/i.test(new URLSearchParams(location.search).get('spawnId') || '') ? new URLSearchParams(location.search).get('spawnId') : null);
  const epicD = env.epicOn() && rbId && env.epicById(rbId);   // 🐉 смерть на эпике — не «не по силам», а конец захода: запомнить его HP
  if (epicD) { const m = env.mobHp(); await env.setRt({ epic: { ...(env.rt.epic || {}), died: true, hpLog: [...((env.rt.epic || {}).hpLog || []).slice(-9), { t: Date.now(), cur: m?.cur ?? null, max: m?.max ?? null }] } }); }
  if (rbId && !epicD) await env.rbNote(rbId, { verdict: 'no', name: env.rt.rbDb?.[rbId]?.name || env.rt.rbSeen?.[rbId]?.name || env.mobName(), lvl: env.rt.rbDb?.[rbId]?.lvl || env.rt.rbSeen?.[rbId]?.lvl || 0, note: `убил героя ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` });
  await env.setRt({ deaths, lastTeleport: '', campaignDue: !!env.cfg.campaign, target: null, catIn: null, toggleOn: {}, toggleOff: {} });   // после смерти тогглы слетают   // v5.3: после смерти в подземелье — входим заново
  env.rec('B', 'смерть', `смертей за 30 мин: ${deaths.length}`);
  if (!env.cfg.autoRevive) return env.halt('Персонаж погиб');
  // 🐉 в фарме эпиков смерть — часть плана (заходы); предел — «смертей на эпика» в самом режиме, а общий стоп — 20 смертей за час
  if (env.epicOn() ? [...(env.rt.deaths1h || []), Date.now()].filter(t => Date.now() - t < 3600000).length >= 20 : deaths.length >= 3) return env.halt(env.epicOn() ? '20 смертей за час в фарме эпиков — бот остановлен' : '3 смерти за 30 минут — бот остановлен (проверьте уровень целей и настройки)');
  if (env.epicOn()) await env.setRt({ deaths1h: [...(env.rt.deaths1h || []), Date.now()].filter(t => Date.now() - t < 3600000) });
  env.setStatus(`Персонаж погиб (${deaths.length}/3 за 30 мин) — в город`);
  await env.sleep(env.rnd(1500, 2500));
  const btn = await env.waitFor(() => [env.$q('#battle-defeat-tocity'), env.$q('#map-defeat-tocity')].find(env.shown) || env.byText(/^(Вернуться в город|Повернутися до міста|В город|До міста)$/i, 'button,a'), 6000, 200);
  // v4.36: после смерти персонаж «без сознания», пока не зайти в город → магическую статую. До этого баффер отвечает
  // «Ти знепритомнів. Сначала натисни «В город»» и не восстанавливает HP/MP (бот стоял у баффера)
  await env.setRt({ revive: { t: Date.now(), url: location.pathname + location.search, revived: !!btn } });
  if (btn) { env.fire(btn); await env.waitFor(env.isCity, 8000); }   // не вышло — reviveStep повторит с экрана поражения
}

async function reviveStep() {
  // v4.43 (журнал 01:48): «без сознания», пока на экране поражения не нажата «Вернуться в город». Экран поражения — на странице
  // того боя, где погибли; «Город» может открыться и без него (тогда статуя и бафф не работают). Поэтому: страница боя →
  // «Вернуться в город» (отметка «воскрешён» — до нажатия) → город → «Магическая статуя» → бафф → «Восстановить»
  const R = env.rt.revive;
  const finish = async (why, toBuffer) => {
    env.rec('B', 'воскрешение', why);
    await env.setRt({ revive: null, ...(toBuffer ? { restoreT: Date.now(), restoreRes: null, tbuff: { set: null, fa: [], step: 'restore', why: 'после смерти', t: Date.now(), back: '/map.html', reviveTried: true } } : {}) });
  };
  if (Date.now() - (R.t || 0) > 150000) return finish('не уложился в 2,5 мин — продолжаю как есть');
  const defeatBtn = () => [env.$q('#battle-defeat-tocity'), env.$q('#map-defeat-tocity')].find(env.shown) || null;
  const toCity = defeatBtn();
  if (toCity) {
    env.setStatus('После смерти: «Вернуться в город»');
    await env.setRt({ revive: { ...R, revived: true } });
    await env.pause(); env.fire(toCity);
    await env.waitFor(env.isCity, 8000);
    env.rec('B', 'воскрешение', 'нажал «Вернуться в город»');
    return;
  }
  if (!R.revived) {
    if (env.isBattle() || env.isMap()) {                    // экран поражения может появиться не сразу
      if (await env.waitFor(defeatBtn, 4000, 200)) return;
      if (env.isBattle()) { env.rec('B', 'воскрешение', 'на странице боя поражения нет — персонаж в сознании'); await env.setRt({ revive: { ...R, revived: true } }); return; }
    }
    if ((R.hops || 0) >= 3) { env.rec('B', 'воскрешение', 'экран поражения не нашёл — пробую дальше как есть'); await env.setRt({ revive: { ...R, revived: true } }); return; }
    await env.setRt({ revive: { ...R, hops: (R.hops || 0) + 1 } });
    const url = R.url || env.rt.lastBattle;
    env.setStatus('После смерти: к экрану поражения');
    if (url && !(env.isBattle() && location.pathname + location.search === url)) location.href = url;
    else location.href = '/map.html';
    await env.sleep(4000);
    return;
  }
  if (env.isCity()) {
    env.setStatus('После смерти: «Магическая статуя» (баффер)');
    const st = await env.waitFor(() => [env.$q('a.l2-town-miru-item--buffer-statue'), ...document.querySelectorAll('a[href*="town-buffer"]')].find(env.shown) || null, 5000, 200);
    await finish('город → «Магическая статуя» — дальше бафф и «Восстановить»', true);   // до нажатия: оно уводит со страницы
    if (st) { await env.pause(); env.fire(st); await env.waitFor(() => /town-buffer/.test(location.pathname), 6000); }
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
