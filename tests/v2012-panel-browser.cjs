'use strict';
// 20.12 (ревизия 17.10, UI-1/UI-3/UI-7/UI-8/UI-9): настоящее MV3-расширение, локальные ответы. Бот пишет cfg, пока фокус в поле меню, —
// клик по галке задачи и Старт не откатывают его запись; TvT в разделе PvP ведёт список задач; свёрнутый список задач и прокрутка
// раздела переживают перезагрузку меню; кнопки окна бота не пересоздаются перерисовкой, Маммон — только вторым нажатием.
const assert = require('node:assert/strict');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');
(async () => {
  const h = await harness(); try {
    const P = h.popup; await P.setViewportSize({ width: 800, height: 600 });
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, autoTasks: ['fish', 'tvt'], tvtOn: true, nPower: 'Blaze', shopReserve: 111, tsBuy: true } }); });
    await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick)); await until(() => P.locator('[data-auto-task="fish"]').isChecked());
    // UI-1: фокус в поле «Резерв адены», «бот» меняет nPower и shopReserve, затем клик по галке «Дейлики» (без id)
    await h.openTab('supply'); await P.locator('#shopReserve').focus();
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, nPower: 'Blaze, Aura Burn', shopReserve: 999 } }); });
    await delay(500);
    if (!await P.locator('#autoTaskSelection').isVisible()) await P.locator('#modeToggle').click();
    await P.locator('[data-auto-task="dailies"]').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('dailies'));
    let s = await h.get(['cfg', 'on']);
    assert.equal(s.cfg.nPower, 'Blaze, Aura Burn', 'галка задачи не вернула старое значение формы'); assert.equal(s.cfg.shopReserve, 999);
    // UI-11: пустое поле — умолчание (20.12: строка «Задачи бота» перевела меню в «Обзор» — возвращаемся к закупке)
    await h.openTab('supply');
    await P.locator('#shopReserve').fill(''); await P.locator('#shopReserve').blur(); await until(async () => (await h.get(['cfg'])).cfg.shopReserve === 200000);
    // UI-3: галка TvT в PvP ведёт список задач; tsBuy выключен с пояснением
    await h.openTab('tvt');   // 23.10: TvT — свой раздел
    await until(() => P.locator('#tvtOn').isChecked());
    await P.locator('#tvtOn').uncheck(); await until(async () => !(await h.get(['cfg'])).cfg.autoTasks.includes('tvt'));
    await until(async () => !await P.locator('[data-auto-task="tvt"]').isChecked(), 5000);   // галка задачи TvT синхронна после перерисовки
    assert.equal(await P.locator('#tsBuy').isDisabled(), true); assert.match(await P.locator('#tsBuy').evaluate(e => e.closest('label').nextElementSibling.textContent), /Задачи бота/);
    // UI-2: Старт не переписывает cfg формой
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, nPower: 'Bot Choice' } }); });
    await P.locator('#nPower').evaluate(e => { e.value = 'Stale'; }); await P.locator('#start').click(); await until(async () => (await h.get(['on'])).on === true);
    assert.equal((await h.get(['cfg'])).cfg.nPower, 'Bot Choice', 'Старт не отправил устаревшую форму');
    await P.locator('#stop').click(); await until(async () => (await h.get(['on'])).on === false);
    // UI-7: свёрнутый список задач и прокрутка раздела после перезагрузки меню
    await h.openTab('overview'); if (await P.locator('#autoTaskSelection').isVisible()) await P.locator('#modeToggle').click();
    await h.openTab('hunt'); await P.evaluate(() => { document.getElementById('tab-hunt').scrollTop = 900; document.getElementById('tab-hunt').dispatchEvent(new Event('scroll')); }); await delay(500);
    const top0 = await P.evaluate(() => document.getElementById('tab-hunt').scrollTop);
    await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick)); await delay(900);
    assert.equal(await P.locator('#autoTaskSelection').isVisible(), false, 'список задач остался свёрнутым'); assert.equal(await P.locator('#modeToggle').getAttribute('aria-expanded'), 'false');
    const top1 = await P.evaluate(() => document.getElementById('tab-hunt').scrollTop);
    /* браузер может сдвинуть позицию якорем прокрутки на высоту дорисованной строки */ assert.ok(top0 > 100 && Math.abs(top1 - top0) < 60, `прокрутка раздела сохранена: ${top0} → ${top1}`);
    // UI-8/UI-9: окно бота на странице игры
    const g = h.g.p; await g.setViewportSize({ width: 1600, height: 900 }); await g.reload(); await delay(2500);
    const mark = await g.evaluate(() => { const b = document.querySelector('#l2bot-ind [data-mmgo=order]'); if (!b) return false; b.__mark = 1; return true; });
    assert.ok(mark, 'кнопка Маммона есть');
    await h.sw.evaluate(async () => { const { rt } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, status: 'перерисовка ' + Date.now() } }); }); await delay(600);
    assert.equal(await g.evaluate(() => document.querySelector('#l2bot-ind [data-mmgo=order]').__mark), 1, 'перерисовка не пересоздала кнопку');
    const url0 = g.url(); await g.click('#l2bot-ind [data-mmgo=order]'); await delay(400);
    assert.equal(g.url(), url0, 'первое нажатие не уводит со страницы'); assert.match(await g.locator('#l2bot-ind [data-mmgo=order]').innerText(), /Ещё раз/);
    await g.click('#l2bot-ind [data-mmgo=order]'); await until(() => /mammon-merchant-loc/.test(g.url()), 8000);
    assert.deepEqual(h.errors, []);
    console.log('PASS v2012-panel-browser: поля не откатываются галкой задачи и Стартом, пустое поле — умолчание, TvT в PvP = задача TvT, свёрнутый список и прокрутка помнятся, кнопки окна не пересоздаются, Маммон — вторым нажатием');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL v2012-panel-browser:', e); process.exitCode = 1; });
