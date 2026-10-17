'use strict';
// 20.12 (ревизия 17.10, аудит §3 / UI-1..UI-15): настоящее MV3-меню после сведения 12 разделов в 6.
// Старые имена разделов открывают нужный раздел и подраздел (TAB_GROUP), свёрнутое «Дополнительно» раскрывается ссылкой и поиском,
// строка «Задачи бота» в шапке открывает список задач в «Обзоре»; 800×600 — область настроек выше 170 px, 360 px — без горизонтальной прокрутки.
const assert = require('node:assert/strict');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');
const OLD = { limits: 'overview', autofarm: 'hunt', dungeon: 'hunt', dailies: 'hunt', epic: 'rb', rbtimer: 'rb', analyze: 'panel', roles: 'panel',
  pet: 'panel', warlock: 'panel', enchant: 'panel', fight: 'panel', supply: 'fish', mammon: 'fish', loot: 'fish', pvp: 'svc', tvtshop: 'svc', enemies: 'svc', log: 'svc' };
(async () => {
  const h = await harness(); try {
    const P = h.popup;
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']); await chrome.storage.local.set({ cfg: { ...cfg, autoTasks: ['fish', 'tvt'] }, rt: { ...rt, char: 'Warlock', lvl: 56, classCur: { prof: 'human_warlock' } } }); });
    await P.setViewportSize({ width: 800, height: 600 }); await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
    await P.evaluate(() => { try { localStorage.removeItem('ui5'); } catch (e) {} }); await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
    // 1. шесть кнопок, по умолчанию все «Дополнительно» свёрнуты
    assert.equal(await P.locator('#moduleNav button[data-tab]').count(), 6);
    assert.equal(await P.locator('.adv').count(), 6); assert.equal(await P.locator('.adv.closed').count(), 6);
    // 2. старые имена → раздел и видимая метка (в т.ч. внутри «Дополнительно»: анализ боя, диагностика, добыча)
    for (const [old, sec] of Object.entries(OLD)) {
      await P.evaluate(t => showTab(t), old); await delay(80);
      assert.equal(await P.locator('#tab-' + sec).evaluate(e => e.classList.contains('act')), true, old + ' → ' + sec);
      const vis = await P.locator('#tab-' + old).evaluate(e => { const r = (e.closest('.subsec-title') || e.parentElement).getBoundingClientRect(); return (r.height > 0 || r.width > 0) && !e.closest('.adv.closed, .card.closed'); }); assert.equal(vis, true, 'метка #tab-' + old + ' видна');
      assert.equal(await P.locator('nav [data-tab="' + sec + '"]').getAttribute('aria-current'), 'page');
    }
    assert.equal(await P.locator('#tab-panel .adv').evaluate(e => e.classList.contains('closed')), false, 'ссылка analyze раскрыла «Дополнительно»');
    // раскрытие помнится после перезагрузки меню
    await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
    assert.equal(await P.locator('#tab-panel .adv').evaluate(e => e.classList.contains('closed')), false, 'раскрытый блок помнится');
    await P.locator('#moduleNav [data-tab="panel"]').click(); await P.locator('#tab-panel .adv-h').click(); assert.equal(await P.locator('#tab-panel .adv').evaluate(e => e.classList.contains('closed')), true);
    // 3. поиск находит поле в свёрнутом «Дополнительно» и раскрывает его
    await P.locator('#moduleNav [data-tab="overview"]').click();
    assert.equal(await P.locator('#tab-hunt .adv').evaluate(e => e.classList.contains('closed')), true);
    await P.locator('#uiSearch').fill('страниц'); await until(() => P.locator('#uiResults [data-i]').count());
    await P.locator('#uiResults [data-i]').first().click(); await delay(120);
    assert.equal(await P.locator('#tab-hunt').evaluate(e => e.classList.contains('act')), true);
    assert.equal(await P.locator('#maxPages').isVisible(), true, 'найденное поле видно');
    // 4. «Задачи бота» в шапке: из любого раздела открывает список задач в «Обзоре», второе нажатие сворачивает
    assert.equal(await P.locator('#modeToggle').getAttribute('aria-expanded'), 'false');
    await P.locator('#modeToggle').click(); await delay(80);
    assert.equal(await P.locator('#tab-overview').evaluate(e => e.classList.contains('act')), true);
    assert.equal(await P.locator('#autoTaskSelection').isVisible(), true); assert.equal(await P.locator('#modeToggle').getAttribute('aria-expanded'), 'true');
    assert.match(await P.locator('#modeSummary').innerText(), /рыбалк|TvT/i);
    await P.locator('#modeToggle').click(); assert.equal(await P.locator('#autoTaskSelection').isVisible(), false);
    // 5. размеры: 800×600 — шапка ≤ 200 px, раздел > 170 px; 360 px (док) — без горизонтальной прокрутки ни в одном разделе
    const m = await P.evaluate(() => ({ header: document.querySelector('header').offsetHeight, sec: document.querySelector('section.act').clientHeight, h: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    assert.ok(m.header <= 200 && m.sec > 170 && !m.h, JSON.stringify(m));
    await P.setViewportSize({ width: 360, height: 740 }); await P.goto('chrome-extension://' + h.id + '/popup.html?dock=1'); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
    for (const t of ['overview', 'hunt', 'rb', 'panel', 'fish', 'svc']) {
      await P.locator('#moduleNav [data-tab="' + t + '"]').click(); await delay(80);
      await P.evaluate(() => document.querySelectorAll('section.act .adv.closed > .adv-h').forEach(b => b.click()));
      // широкие таблицы (маршрут автофарма и т.п.) листаются внутри своей рамки overflow:auto — это не прокрутка страницы
      const o = await P.evaluate(() => { const inScroller = e => { for (let p = e.parentElement; p && p.tagName !== 'SECTION'; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; }; return { doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('section.act *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1 && !inScroller(e)).slice(0, 3).map(e => e.tagName + '#' + e.id) }; });
      assert.ok(o.doc <= o.vw && !o.wide.length, t + ' 360px: ' + JSON.stringify(o));
    }
    assert.equal(await P.locator('#moduleNav [data-tab="svc"]').isVisible(), true);
    assert.deepEqual(h.errors, []);
    console.log('PASS v2012-nav-browser: 6 разделов, 19 старых ссылок → раздел и видимый подраздел, «Дополнительно» раскрывается ссылкой/поиском и помнится, «Задачи бота» открывает список, 800×600 раздел > 170 px, 360 px без прокрутки вбок');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL v2012-nav-browser:', e); process.exitCode = 1; });
