'use strict';
// 20.54 (прогон смоуков 23.10, tests/v2014-quick-start-browser.cjs): после кнопки «⚒ Крафт» (22.10, 337c33b) быстрых запусков пять,
// а сетка .quick-start оставалась на 4 колонки — пятая кнопка уходила на вторую строку, шапка меню 800×600 выросла до 214 px
// (правило 20.12: шапка ≤ 200 px). Узкое правило (≤ 420 px) стояло раньше общих .quick-start button и не действовало (11px/2px
// перебивались теми же по силе селекторами). Проверяем: колонок столько же, сколько кнопок, и узкое правило — после общих.
// 27.10: шестая кнопка Rebirth сохраняет прежнее требование одной строки на широкой и узкой панели.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = R('popup.html'), css = R('ui-game.css');
const box = html.match(/<div id="quickStart"[^]*?<\/div>/)?.[0] || '';
const n = [...box.matchAll(/data-quick-task="(\w+)"/g)].length;
assert.equal(n, 6, 'шесть кнопок быстрого запуска, включая Rebirth');
const wide = css.match(/^\.quick-start\{[^}]*grid-template-columns:auto repeat\((\d+),minmax\(0,1fr\)\)/m);
assert.ok(wide, 'общая сетка: подпись + колонки кнопок');
assert.equal(+wide[1], n, 'на широкой панели каждая кнопка — в своей колонке одной строки');
const narrowAt = css.indexOf('@media (max-width:420px){.quick-start{'), narrow = css.slice(narrowAt).match(/^@media \(max-width:420px\)\{\.quick-start\{grid-template-columns:repeat\((\d+),auto\)(?:;[^}]*)?\}/);
assert.ok(narrowAt >= 0 && narrow, 'узкая панель: колонки по ширине надписи');
assert.equal(+narrow[1], n, 'на узкой панели все кнопки в одну строку');
const baseBtn = css.search(/^\.quick-start button\{/m);
assert.ok(baseBtn >= 0 && narrowAt > baseBtn, 'узкое правило стоит после общих .quick-start button и меняет шрифт/отступы');
console.log('v2054-quick-start-row PASS');
