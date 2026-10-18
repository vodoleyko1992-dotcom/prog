// 18.10.2026 (игрок: «расширить время боя со сложными РБ до 30 минут»): заводской предел долгого боя с РБ 20 → 30 мин.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const defs = read('defaults.js'), content = read('content.js'), raid = read('modules/raid.js');
assert.match(defs, /rbMaxKillMin: 30,/);
assert.equal(JSON.parse(read('base-profile.json')).cfg.rbMaxKillMin, 30);
assert.ok(!/rbMaxKillMin \?\? 20/.test(raid), 'raid.js: запасное значение тоже 30');
assert.ok((raid.match(/rbMaxKillMin \?\? 30/g) || []).length >= 4);
// миграция: только прежние заводские 20 → 30, своё число не трогаем
const line = content.match(/once\('rbKill30_20261018', (\(\) => \{[^\n]*?\})\);/)[1];
for (const [was, want] of [[20, 30], [0, 0], [25, 25], [45, 45], [undefined, undefined]]) {
  const cf = {}; const C = k => (k === 'rbMaxKillMin' ? was : undefined);
  vm.runInNewContext('(' + line + ')()', { cf, C });
  assert.equal('rbMaxKillMin' in cf ? cf.rbMaxKillMin : was, want, `migrate ${was}`);
}
console.log('PASS v2014-rb-kill-30min: RB long-fight cap 30 min by default, migration 20 → 30 only');
