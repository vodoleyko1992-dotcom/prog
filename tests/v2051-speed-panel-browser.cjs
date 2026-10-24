'use strict';
// Настоящее MV3-меню, только локальные ответы: бегунок, сохранение, профиль и узкий док.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs');
(async () => {
  const h = await harness(); try {
    const P = h.popup, viewports = [];
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); const clean = { ...cfg }; delete clean.actionDelayMs; await chrome.storage.local.set({ cfg: clean }); });
    await P.evaluate(() => { document.activeElement?.blur(); return load(); });
    await P.locator('nav [data-tab="speed"]').click();
    // 20.59 (John 24.10): умолчание — 0,5 с
    assert.equal(await P.locator('#actionDelayValue').textContent(), '0,5 с');
    assert.equal(await P.locator('#actionDelayMs').inputValue(), '500');
    assert.equal(await P.locator('#actionDelayMs').getAttribute('aria-valuetext'), '0,5 с');
    await P.locator('#actionDelayMs').evaluate(input => { input.value = '2300'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await P.locator('#actionDelayValue').textContent(), '2,3 с');
    assert.equal((await h.get(['cfg'])).cfg.actionDelayMs, undefined, 'перетаскивание показывает значение до сохранения');
    await P.locator('#actionDelayMs').dispatchEvent('change');
    await until(async () => (await h.get(['cfg'])).cfg.actionDelayMs === 2300);
    await P.reload(); await until(() => P.locator('#actionDelayValue').textContent().then(value => value === '2,3 с'));
    assert.equal(await P.locator('#tab-speed').isVisible(), true, 'раздел и значение восстановлены после открытия меню');
    await P.locator('#actionDelayMs').focus(); await P.keyboard.press('ArrowRight');
    await until(async () => (await h.get(['cfg'])).cfg.actionDelayMs === 2400);
    assert.equal(await P.locator('#actionDelayMs').getAttribute('aria-valuetext'), '2,4 с');
    await P.locator('nav [data-tab="overview"]').click();
    await h.sw.evaluate(async () => { const { cfg } = await chrome.storage.local.get('cfg'); await chrome.storage.local.set({ 'cfg@OtherHero': { ...cfg, actionDelayMs: 4100 } }); });
    const switchHero = async nick => {
      await h.g.p.bringToFront();
      await h.g.p.evaluate(value => { document.getElementById('l2-hud-legacy-name').textContent = value; }, nick);
      const result = await h.g.core(`chrome.runtime.sendMessage({cmd:'charSwitch',nick:${JSON.stringify(nick)},vis:true,src:'speed-panel-fixture',roles:[],defRt:{}})`);
      assert.equal(result.ok, true, JSON.stringify(result));
      await P.bringToFront(); await P.evaluate(() => { document.activeElement?.blur(); return load(); });
    };
    await switchHero('OtherHero'); await P.locator('nav [data-tab="speed"]').click();
    await until(() => P.locator('#actionDelayValue').textContent().then(value => value === '4,1 с'));
    assert.equal((await h.get(['cfg@AuditHero']))['cfg@AuditHero'].actionDelayMs, 2400);
    await P.locator('#actionDelayMs').focus(); await P.keyboard.press('ArrowRight');
    await until(async () => (await h.get(['cfg'])).cfg.actionDelayMs === 4200);
    await switchHero('AuditHero');
    await until(() => P.locator('#actionDelayValue').textContent().then(value => value === '2,4 с'));
    assert.equal((await h.get(['cfg@OtherHero']))['cfg@OtherHero'].actionDelayMs, 4200);
    await P.locator('#actionDelayMs').focus(); await P.keyboard.press('Home');
    await until(async () => (await h.get(['cfg'])).cfg.actionDelayMs === 0);
    assert.equal(await P.locator('#actionDelayValue').textContent(), 'Без задержки');
    await P.reload(); await until(() => P.locator('#actionDelayValue').textContent().then(value => value === 'Без задержки'));
    assert.equal(await P.locator('#actionDelayMs').inputValue(), '0');
    for (const width of [800, 360, 280]) {
      await P.setViewportSize({ width, height: 740 });
      await P.goto('chrome-extension://' + h.id + '/popup.html?dock=1');
      await until(() => P.locator('#actionDelayValue').textContent().then(value => value === 'Без задержки'));
      const size = await P.locator('#actionDelayMs').evaluate(input => ({ left: input.getBoundingClientRect().left, right: input.getBoundingClientRect().right, width: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
      assert.ok(size.left >= 0 && size.right <= size.width && !size.overflow, width + ': ' + JSON.stringify(size));
      viewports.push({ viewportWidth: width, ...size });
    }
    assert.equal((await h.get(['on'])).on, false); assert.deepEqual(h.errors, []);
    assert.ok(h.requests.every(request => request.method === 'GET'));
    if (process.env.SPEED_PANEL_EVIDENCE) {
      const evidence = { checkedAt: new Date().toISOString(), browser: h.ctx.browser().version(), localResponsesOnly: true,
        defaultWithoutSetting: 0, defaultOutput: 'Без задержки', liveValue: '2,3 с', savedAfterRelease: 2300, keyboardValue: 2400,
        profiles: { AuditHero: 2400, OtherHero: 4200 }, savedZeroReopened: true, reopened: true, viewports, botOn: false, nonGetRequests: 0, pageErrors: h.errors };
      fs.mkdirSync(path.dirname(process.env.SPEED_PANEL_EVIDENCE), { recursive: true });
      fs.writeFileSync(process.env.SPEED_PANEL_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }
    console.log('PASS speed panel: default 0.5 s, live seconds, save on change, keyboard, reopen/profile, zero save/reopen, 800/360/280px dock, no actions or errors');
  } finally { await h.ctx.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
