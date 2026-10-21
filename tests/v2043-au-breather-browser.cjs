'use strict';
// 20.43 (автономность, разбор 21.10): настоящий MV3 — передышка вместо стопа. Вкладка объявляет передышку (rt.selfHold) — бот остаётся
// включённым (значок ON), меню показывает «Передышка до ЧЧ:ММ» у задачи; новый Старт игрока передышку снимает; 4-я передышка одного вида
// за 6 ч — полный стоп с причиной, «!» и строкой «Остановлен сам». HTTPS ответы только локальные (живую игру не открываем).
const assert = require('node:assert/strict');
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const h = await harness();
  try {
    const badge = () => h.sw.evaluate(() => chrome.action.getBadgeText({}));
    const board = async () => { await h.popup.evaluate(() => load()); return h.popup.evaluate(() => document.getElementById('taskBoard')?.textContent || ''); };
    await h.click('farmToggle');
    await until(() => h.g.core('on && running && tabOwner'), 30000); await until(async () => await badge() === 'ON');
    // 1) передышка (как после 3 восстановлений сторожа вкладки): задача фарма уступает, бот включён
    // запуск устоялся (Старт уже записан во вкладке) — иначе смена manualKickAt во время записи честно отменяет объявление (null)
    await until(() => h.g.core('L2V7Modules.actions.canAct() && rt.dailyStart > 0'), 30000); await delay(3000);
    const r = await h.g.core("selfHoldStart('stall', 'Тест: нет прогресса 9 мин после 3 восстановлений', {}).then(r => r || 'none')");
    assert.equal(r, 'hold', await h.g.core('JSON.stringify({on, tabOwner, canAct: L2V7Modules.actions.canAct(), hold: rt.selfHold, status: rt.status})'));
    // 20.43 (доводка 21.10): rt.selfHold — передышки по задаче ({задача: передышка}); проверка та же — передышка у фарма
    assert.equal(await h.g.core("L2EngineCore.selfHoldList(rt).map(x => x.task).join()"), 'farm');
    assert.equal(await h.g.core("Object.keys(rt.selfHold).join()"), 'farm');
    assert.equal(await h.g.core("L2EngineCore.selectedTask(cfg, rt)"), 'tasks', 'фарм на передышке — других задач нет, ожидание');
    await until(async () => /Передышка до \d\d:\d\d/.test(await board()), 20000);
    assert.match(await board(), /передышка до \d\d:\d\d: Тест: нет прогресса/);
    await delay(2500);
    assert.equal((await h.get(['on'])).on, true); assert.equal(await badge(), 'ON', 'передышка — не остановка');
    await until(() => h.g.core('/Передышка до \\d\\d:\\d\\d/.test(String(rt.status || ""))'), 20000);
    console.log('PASS передышка: бот включён, задача ждёт, в меню «Передышка до ЧЧ:ММ» и причина');
    // 2) новый Старт игрока снимает передышку (другой manualKickAt), строка в журнал — «снята новым запуском»
    await h.popup.locator('#start').click();
    await until(() => h.g.core('!rt.selfHold'), 30000);
    assert.equal((await h.get(['on'])).on, true);
    console.log('PASS новый Старт снимает передышку');
    // 3) 4-я передышка того же вида за 6 ч — стоп с причиной (жёсткий, как прежний стоп сторожа), «!» на значке
    await until(() => h.g.core('on && tabOwner'), 30000);
    const stop = await h.g.core("setRt({ selfHoldLog: { ...(rt.selfHoldLog || {}), stall: [Date.now() - 3e5, Date.now() - 2e5, Date.now() - 1e5] } }).then(() => selfHoldStart('stall', 'Тест: нет прогресса', { hard: true })).then(r => r || 'none')");
    assert.equal(stop, 'stop');
    await until(async () => !(await h.get(['on'])).on); await until(async () => await badge() === '!');
    const meta = (await h.get(['stopMeta'])).stopMeta; assert.equal(meta.source, 'content-halt'); assert.match(meta.reason, /Тест: нет прогресса — 3 передышки за 6 ч не помогли/);
    console.log('PASS 4-я передышка за 6 ч — стоп с причиной и «!»');
    assert.deepEqual(h.errors, []); console.log('PASS MV3: передышка вместо стопа');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
