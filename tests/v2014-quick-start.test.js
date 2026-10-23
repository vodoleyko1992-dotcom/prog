'use strict';
// 18.10 (игрок: «непонятно, что где нажимать, как запускать»): быстрый запуск на первом экране —
// кнопки «На месте / Автофарм / Рыбалка / Катакомбы» в блоке состояния, пока бот стоит; одно нажатие = одно основное дело + «Старт».
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = R('popup.html'), js = R('popup.js'), css = R('ui-game.css');
const box = html.match(/<div id="quickStart"[^]*?<\/div>/)?.[0] || '';
assert.ok(box, 'блок #quickStart есть');
assert.ok(html.indexOf('id="quickStart"') > html.indexOf('id="activityPanel"') && html.indexOf('id="quickStart"') < html.indexOf('</header>'), 'кнопки в шапке, на первом экране');
// 22.10: к прежним четырём режимам добавлен быстрый запуск крафта.
assert.deepEqual([...box.matchAll(/data-quick-task="(\w+)"/g)].map(m => m[1]), ['farm', 'auto', 'fish', 'cat', 'craft']);
assert.match(box, /\shidden>/, 'по умолчанию скрыт до первой отрисовки');
// только основные дела, фоновые задачи сохраняются, кампания выключается вместе с квестами, затем обычный «Старт»
const fn = js.match(/async function quickStart\(key\) \{[^]*?\n\}/)?.[0] || '';
assert.match(fn, /was\.filter\(k => !AUTO_MAIN_TASKS\.includes\(k\)\), key\]/);
assert.match(fn, /was\.includes\('quests'\) \? \{ campaign: false, storyTurnIn: false \}/);
assert.match(fn, /await \$\('start'\)\.onclick\(\)/);
assert.match(fn, /\+\+controlGeneration/, 'Стоп во время записи отменяет запуск');
// видимость: только когда бот остановлен и не на паузе
assert.match(js, /quick:!st\.paused \};/);
assert.match(js, /\$\('quickStart'\)\.hidden = !activity\.quick;/);
// узкая панель: без значков и подписи, без горизонтальной прокрутки; 20.54: пять кнопок (с «Крафт» 22.10) в одну строку по ширине надписи
assert.match(css, /@media \(max-width:420px\)\{\.quick-start\{grid-template-columns:repeat\(5,auto\)\}/);
console.log('v2014-quick-start PASS');
