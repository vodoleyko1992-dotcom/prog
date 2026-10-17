'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0 часть 6 (игрок: «ребаланс настроек с целью повышения КПД»): заводские значения и разовая миграция только заводских значений
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = (read('defaults.js') + '\n' + read('content.js')), popup = (read('defaults.js') + '\n' + read('popup.js')), eco = read('modules/economy.js'), base = JSON.parse(read('base-profile.json'));
const defOf = (src, k) => (src.match(new RegExp(`\\b${k}: ([^,]+),`)) || [])[1];
for (const src of [content, popup]) {
  assert.equal(defOf(src, 'shopMp'), "'200/1000'"); assert.equal(defOf(src, 'rbMaxBelow'), '9'); assert.equal(defOf(src, 'rbTour'), 'false');
}
assert.match(content, /weaponClassEquip: true, weaponManual: false,/);
assert.equal((eco.match(/cfg\.shopMp, '200\/1000'\)/g) || []).length, 2);
assert.equal(base.cfg.rbMaxBelow, 9);
// миграция трогает только заводские значения
const mig = content.match(/once\('rebal100', \(\) => \{([^\n]+)\}\);/)[1];
const run = cfg => { const cf = {}, C = k => (k in cf ? cf[k] : cfg[k]); new Function('cf', 'C', mig)(cf, C); return cf; };
assert.deepEqual(run({ shopMp: '20/100', rbMaxBelow: 15 }), { shopMp: '200/1000', rbMaxBelow: 9 });
assert.deepEqual(run({ shopMp: '50/300', rbMaxBelow: 5 }), {}, 'player values kept');
console.log('PASS: 10.0 settings rebalance — MP pots 200/1000, RB window down 9, tour off by default, weaponManual in defaults; migration only touches factory values');
