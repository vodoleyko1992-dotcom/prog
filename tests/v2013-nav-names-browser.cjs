'use strict';
// после 20.13 (игрок 18.10: «вот это надо расширить»): во встроенном меню 601–899 px имена разделов обрезались («Об…», «Ох…»),
// «верни строку поиска настроек»: поиск снова строкой во всю ширину над настройками (в 20.12 был мелким полем в шапке).
// в боковой колонке ≥900 px — «Рыбалка и снабжен…». Игрок выбрал «левый вариант»: от 601 px разделы колонкой слева (220 px) и во встроенном меню, и в окне меню.
const assert = require('node:assert/strict');
const { harness, until } = require('./v1014-core-lifecycle-browser.cjs');
// 20.54 (прогон смоуков 23.10): разделов уже не шесть — 20.18 (10), 19.10 «Лимиты»/«Снабжение» (12), «Сабкласс» (20.43), «Крафт» (PR #358),
// «Скорость» (PR #371); «Автозаточка» скрыта (19.10, кнопка hidden). Колонка = по строке на каждую видимую кнопку; скрытая не считается.
const VISIBLE = ['overview', 'hunt', 'craft', 'rb', 'panel', 'fish', 'mammon', 'lifestone', 'pvp', 'svc', 'limits', 'supply', 'sub', 'speed', 'tvt', 'epic'];   // 23.10 (#378): «TvT» — отдельный раздел; 23.10: «Эпики» — отдельно от «РБ»
(async () => {
  const h = await harness(); try {
    const P = h.popup;
    const look = async (w, dock) => {
      await P.setViewportSize({ width: w, height: 600 }); await P.goto('chrome-extension://' + h.id + '/popup.html' + (dock ? '?dock=1' : ''));
      await until(() => P.evaluate(() => !!document.querySelector('#start')?.onclick));
      return P.evaluate(() => { const b = [...document.querySelectorAll('#moduleNav button')].filter(x => !x.hidden && x.offsetParent), lb = b.map(x => x.querySelector('.lb'));
        return { cut: lb.filter(e => getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
          search: (() => { const r = document.querySelector('#uiSearch').getBoundingClientRect(), wa = document.querySelector('.workarea').getBoundingClientRect(); return r.height > 0 && r.top >= wa.top && r.width >= wa.width - 40; })(),
          rows: new Set(b.map(x => Math.round(x.getBoundingClientRect().top))).size, over: document.documentElement.scrollWidth > document.documentElement.clientWidth, tabs: b.map(x => x.dataset.tab) }; });
    };
    for (const w of [601, 640, 700, 760, 899, 900, 1200]) { const r = await look(w, true); assert.deepEqual(r.cut, [], 'док ' + w + ': ' + JSON.stringify(r)); assert.deepEqual(r.tabs, VISIBLE); assert.equal(r.rows, VISIBLE.length, 'док ' + w + ' — колонка'); assert.equal(r.over, false); assert.equal(r.search, true, 'строка поиска во всю ширину над настройками ' + w); }
    const p = await look(760, false); assert.deepEqual(p.cut, [], 'окно меню: ' + JSON.stringify(p)); assert.equal(p.rows, VISIBLE.length, 'окно меню — колонка');
    const n = await look(360, true); // 20.54: в 360 px короткие имена — сетка по 5 в ряд (20.18: десять разделов → две строки), сейчас ceil(14/5) = 3 строки, без обрезки и прокрутки вбок
    assert.deepEqual(n.tabs, VISIBLE); assert.equal(n.rows, Math.ceil(VISIBLE.length / 5), '360 px — короткие имена сеткой по 5'); assert.deepEqual(n.cut, []); assert.equal(n.over, false); assert.equal(n.search && p.search, true, 'строка поиска видна в 360 px и в окне меню');
    assert.deepEqual(h.errors, []);
    console.log('PASS v2013-nav-names-browser: имена ' + VISIBLE.length + ' разделов целиком — колонка слева от 601 px во встроенном меню и в окне 760 px, 360 px — короткие имена по 5 в ряд');
  } finally { await h.ctx.close(); }
})().catch(e => { console.error('FAIL v2013-nav-names-browser:', e); process.exitCode = 1; });
