'use strict';
// после 20.13 (игрок 18.10: «вот это надо расширить»): во встроенном меню 601–899 px имена разделов обрезались («Об…», «Ох…»),
// в боковой колонке ≥900 px — «Рыбалка и снабжен…». Игрок выбрал «левый вариант»: от 601 px разделы колонкой слева (220 px) и во встроенном меню, и в окне меню.
const assert = require('node:assert/strict');
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs');
(async () => {
  const h = await harness(); try {
    const P = h.popup;
    const look = async (w, dock) => {
      await P.setViewportSize({ width: w, height: 600 }); await P.goto('chrome-extension://' + h.id + '/popup.html' + (dock ? '?dock=1' : ''));
      await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
      return P.evaluate(() => { const b = [...document.querySelectorAll('#moduleNav button')], lb = b.map(x => x.querySelector('.lb'));
        return { cut: lb.filter(e => getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
          rows: new Set(b.map(x => Math.round(x.getBoundingClientRect().top))).size, over: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    };
    for (const w of [601, 640, 700, 760, 899, 900, 1200]) { const r = await look(w, true); assert.deepEqual(r.cut, [], 'док ' + w + ': ' + JSON.stringify(r)); assert.equal(r.rows, 6, 'док ' + w + ' — колонка'); assert.equal(r.over, false); }
    const p = await look(760, false); assert.deepEqual(p.cut, [], 'окно меню: ' + JSON.stringify(p)); assert.equal(p.rows, 6, 'окно меню — колонка');
    const n = await look(360, true); assert.equal(n.rows, 1, '360 px — прежняя строка коротких имён');
    assert.deepEqual(h.errors, []);
    console.log('PASS v2013-nav-names-browser: имена шести разделов целиком — колонка слева от 601 px во встроенном меню и в окне 760 px, 360 px — прежняя строка');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL v2013-nav-names-browser:', e); process.exitCode = 1; });
