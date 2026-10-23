'use strict';
// 20.54 (прогон смоуков 23.10, tests/v92-enemies-browser.cjs FAIL 3 vis:false): с 20.18 (PvP — отдельный раздел) метка «⚙ Дополнительно»
// стояла перед порогами нападения, а сам лист врагов #enemyBox — последним в разделе, и cardify() уносил его в свёрнутый блок:
// переход «☠ Лист врагов» (showTab('enemies'), поиск, «Подробнее ↗») показывал заголовок и галки, но не список убийц с кнопками
// «Не трогать»/«🗑». В 20.17 (вкладка «TvT/PvP и сервис») лист стоял до «Дополнительно». Тонкие пороги остаются в свёрнутом блоке.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const sec = html.match(/<section id="tab-pvp">[^]*?<\/section>/)?.[0] || '';
assert.ok(sec, 'раздел «TvT и PvP» есть');
const at = id => sec.indexOf('id="' + id + '"'), adv = sec.indexOf('<div class="adv-start" data-adv="pvp">');
assert.ok(adv > 0, 'у раздела есть «Дополнительно»');
assert.ok(at('tab-enemies') > 0 && at('tab-enemies') < adv, 'метка «☠ Лист врагов» до «Дополнительно»');
for (const id of ['enemyHunt', 'enemyFlagOnly', 'enemyBox']) assert.ok(at(id) > at('tab-enemies') && at(id) < adv, id + ' — на виду, до «Дополнительно»');
for (const id of ['enemyLvlAbove', 'enemyMinHits', 'enemyMaxLoss', 'enemyScanS']) assert.ok(at(id) > adv, id + ' — тонкая настройка в «Дополнительно»');
console.log('v2054-enemy-list-visible PASS');
