'use strict';
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память», ревью perf/dock-menu): тяжёлые разделы меню (РБ, эпики, Маммон, крафт, зоны
// «Охоты») рисуются только открытыми. Свежее меню (встроенное окно перезагружается на каждой странице игры) открыто на «Обзоре»:
// переход в «РБ и эпики» рисует раздел сразу — сохранённая прокрутка глубже статичной части не урезается и не затирается,
// переход к подразделу «⏱ Таймеры боссов» (Alt+W) не уезжает вниз после дорисовки очереди тура.
const assert = require('node:assert/strict');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');
(async () => {
  const h = await harness(); try {
    const P = h.popup; await P.setViewportSize({ width: 800, height: 600 });
    await h.sw.evaluate(async () => {
      const { rt = {}, cfg = {} } = await chrome.storage.local.get(['rt', 'cfg']);
      const rbSeen = {}, rbList = {}, blocked = [], listT = Date.now();
      for (let i = 0; i < 120; i++) rbSeen['rb' + i] = { name: 'Тестовый РБ ' + i, lvl: 40 + i % 15, inRange: true, seenT: Date.now() };
      for (let i = 0; i < 10; i++) rbList['l' + i] = { name: 'РБ ' + i, lvl: 45, alive: true };
      for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) blocked.push({ name: 'Пропуск ' + i + '-' + j, lvl: 45, why: 'причина ' + i });
      await chrome.storage.local.set({ cfg: { ...cfg, rbMaxBelow: 10, rbMaxAbove: 5, rbValueTour: false, rbOrder: 'up' },
        rt: { ...rt, lvl: 50, rbSeen, rbList, rbListT: listT, rbTourView: { at: Date.now(), heroLvl: 50, lo: 40, hi: 55, mode: 'up', listT, ready: [], blocked } } });
    });
    const fresh = async () => { await h.openTab('overview'); await P.reload(); await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick)); await delay(900); };
    const rbN = () => P.evaluate(() => document.querySelectorAll('#rbList .rb').length);
    // 1) закрытый раздел не рисуется; открытый — сразу
    await fresh();
    assert.equal(await rbN(), 0, 'на «Обзоре» список РБ не рисуется');
    await h.openTab('rb'); assert.equal(await rbN(), 120, 'раздел нарисован сразу при переходе');
    assert.match(await P.locator('#huntQueue').innerText(), /Пропуски при расчёте/);
    // 2) прокрутка глубже статичной части раздела: карточка списка РБ раскрыта (запоминается), позиция — в самом списке
    const stat = await P.evaluate(() => { const s = document.getElementById('tab-rb'), r = document.getElementById('rbList'); revealEl(r); const h0 = s.scrollHeight - r.offsetHeight; return { h0, sh: s.scrollHeight }; });
    const top0 = await P.evaluate(() => { const s = document.getElementById('tab-rb'); s.scrollTop = s.scrollHeight - s.clientHeight - 40; s.dispatchEvent(new Event('scroll')); return s.scrollTop; });
    await delay(500);
    const saved0 = await P.evaluate(() => JSON.parse(localStorage.getItem('l2bot-dockUi') || '{}').scroll?.['tab-rb']);
    assert.ok(top0 > stat.h0 + 500 && Math.abs(saved0 - top0) < 2, `позиция сохранена глубже статичной части (${stat.h0} из ${stat.sh}): ${top0} / ${saved0}`);
    await fresh();
    assert.equal(await rbN(), 0, 'свежее меню: раздел РБ ещё не нарисован');
    await h.openTab('rb');
    const top1 = await P.evaluate(() => document.getElementById('tab-rb').scrollTop);
    await delay(800);
    const top2 = await P.evaluate(() => document.getElementById('tab-rb').scrollTop), saved1 = await P.evaluate(() => JSON.parse(localStorage.getItem('l2bot-dockUi') || '{}').scroll?.['tab-rb']);
    assert.ok(Math.abs(top1 - top0) < 60 && Math.abs(top2 - top0) < 60, `прокрутка раздела РБ вернулась: ${top0} → ${top1} → ${top2}`);
    assert.ok(Math.abs(saved1 - top0) < 60, `сохранённая позиция не затёрта урезанной: ${saved0} → ${saved1}`);
    // 3) Alt+W / подраздел: «⏱ Таймеры боссов» остаётся вверху и после дорисовки очереди тура над ним
    await fresh();
    await P.evaluate(() => showTab('rbtimer')); await delay(700);
    const off = await P.evaluate(() => { const s = document.getElementById('tab-rb'), t = document.getElementById('tab-rbtimer').closest('.subsec-title'); return Math.round(t.getBoundingClientRect().top - s.getBoundingClientRect().top); });
    assert.ok(Math.abs(off) < 30, `подраздел у верхнего края: ${off}px`);
    // 4) уход из «Крафта» отпускает его снимок rt; возврат рисует снова
    await h.openTab('craft'); assert.equal(await P.evaluate(() => !!craftRt.char || Object.keys(craftRt).length > 0), true);
    await h.openTab('overview'); assert.equal(await P.evaluate(() => Object.keys(craftRt).length), 0, 'снимок rt крафта отпущен');
    assert.deepEqual(h.errors, []);
    console.log('PASS v2062-dock-scroll-browser: раздел РБ рисуется сразу при переходе, прокрутка свежего меню не урезается и не затирается, подраздел таймеров остаётся вверху, крафт отпускает rt');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL v2062-dock-scroll-browser:', e); process.exitCode = 1; });
