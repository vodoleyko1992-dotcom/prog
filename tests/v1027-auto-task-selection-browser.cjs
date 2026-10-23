'use strict';
// Настоящее меню расширения; только локальный mock игры, без живого аккаунта.
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs'), assert = require('node:assert/strict');
(async () => {
  const h = await harness();
  try {
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']); await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['tvt'], fishMode: true, campaign: true }, rt: { ...rt, _src: 'selection-ui-test', enchant: { status: 'done', totals: { byScroll: {} }, items: [], history: [] } } }); });
    await h.popup.goto('chrome-extension://' + h.id + '/popup.html?dock=1');
    await until(() => h.popup.locator('#autoTaskSelection [data-auto-task="tvt"]').isChecked());
    await h.tasks();   // 20.12 (ревизия 17.10): список задач — в «Обзоре», свёрнут по умолчанию
    assert.equal(await h.popup.locator('#autoTaskSelection input:checked').count(), 1);
    // load() может завершить старый снимок между кликом и async menuPatch: Playwright check()
    // проверяет мгновенное состояние. Команда уже сохранена; ждём commit и окончательную отрисовку.
    // Клик ровно один: повтор мог бы инвертировать уже принятое изменение.
    const check = key => {
      const el = h.popup.locator('#autoTaskSelection [data-auto-task="' + key + '"]');
      const set = async enabled => {
        assert.equal(await el.isChecked(), !enabled, 'исходное состояние ' + key);
        await el.click();
        await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes(key) === enabled);
        await until(async () => await el.isChecked() === enabled);
      };
      return { check: () => set(true), uncheck: () => set(false) };
    };
    await check('fish').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
    // 20.54 (прогон смоуков 23.10): автозаточка временно убрана (19.10, после 20.25/#288, defaults.js AUTO_ENCHANT_DISABLED) — её галка
    // скрыта и отключена. Прежний смысл шага сохраняем: старый список задач с 'enchant' (завершённая серия) не выбирает её,
    // следующей остаётся рыбалка, а следующая правка списка из меню записывает его уже без 'enchant'.
    const ench = h.popup.locator('#autoTaskSelection [data-auto-task="enchant"]');
    assert.equal(await ench.isVisible(), false); assert.equal(await ench.isDisabled(), true);
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ cfg: { ...cfg, autoTasks: [...cfg.autoTasks, 'enchant'] } }); });
    await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('enchant'));
    await until(async () => /Следующая задача: Рыбалка/.test(await h.popup.locator('#modeSummary').innerText()));
    assert.equal(await ench.isChecked(), false); assert.equal(await h.popup.locator('#autoTaskSelection input:checked').count(), 2);
    await check('raid').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('raid'));
    let s = await h.get(['cfg', 'on']); assert.deepEqual(s.cfg.autoTasks, ['tvt', 'fish', 'raid']); assert.equal(s.on, false);
    await until(async () => /Тур по РБ/.test(await h.popup.locator('#modeSummary').innerText()));
    await h.popup.locator('[data-auto-task=fish]').uncheck(); await until(async () => !(await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
    s = await h.get(['cfg', 'on']); assert.deepEqual(s.cfg.autoTasks, ['tvt', 'raid']); assert.equal(s.on, false);
    await check('raid').uncheck(); await check('tvt').uncheck(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.length === 0);
    assert.equal((await h.get(['on'])).on, false);
    await until(async () => /бот ждёт/.test(await h.popup.locator('#autoTaskStatus').innerText()));
    assert.deepEqual(h.errors, []);
    console.log('PASS actual popup: only TvT, multiple tasks, quick toggle, empty wait, no implicit start');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
