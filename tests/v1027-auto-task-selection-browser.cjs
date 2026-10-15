'use strict';
// Настоящее меню расширения; только локальный mock игры, без живого аккаунта.
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs'), assert = require('node:assert/strict');
(async () => {
  const h = await harness();
  try {
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']); await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['tvt'], fishMode: true, campaign: true }, rt: { ...rt, _src: 'selection-ui-test', enchant: { status: 'done', totals: { byScroll: {} }, items: [], history: [] } } }); });
    await h.popup.goto('chrome-extension://' + h.id + '/popup.html?dock=1');
    await until(() => h.popup.locator('#autoTaskSelection [data-auto-task="tvt"]').isChecked());
    assert.equal(await h.popup.locator('#autoTaskSelection input:checked').count(), 1);
    const check = key => h.popup.locator('#autoTaskSelection [data-auto-task="' + key + '"]');
    await check('fish').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
    await check('enchant').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('enchant'));
    await until(async () => /Следующая задача: Рыбалка/.test(await h.popup.locator('#modeSummary').innerText()));
    await check('enchant').uncheck(); await until(async () => !(await h.get(['cfg'])).cfg.autoTasks.includes('enchant'));
    await check('raid').check(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.includes('raid'));
    let s = await h.get(['cfg', 'on']); assert.deepEqual(s.cfg.autoTasks, ['tvt', 'fish', 'raid']); assert.equal(s.on, false);
    await until(async () => /Тур по РБ/.test(await h.popup.locator('#modeSummary').innerText()));
    await h.popup.locator('#fishToggle').click(); await until(async () => !(await h.get(['cfg'])).cfg.autoTasks.includes('fish'));
    s = await h.get(['cfg', 'on']); assert.deepEqual(s.cfg.autoTasks, ['tvt', 'raid']); assert.equal(s.on, false);
    await check('raid').uncheck(); await check('tvt').uncheck(); await until(async () => (await h.get(['cfg'])).cfg.autoTasks.length === 0);
    assert.equal((await h.get(['on'])).on, false);
    await until(async () => /бот ждёт/.test(await h.popup.locator('#autoTaskStatus').innerText()));
    assert.deepEqual(h.errors, []);
    console.log('PASS actual popup: only TvT, multiple tasks, quick toggle, empty wait, no implicit start');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
