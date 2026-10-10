'use strict';
// 8.0.1 (обновление L2WAP 11.10): пояса — сила физ./маг. крита по грейду (D 2 %, C 3 %, B 5 %, A 7 %, S 10 %), плащи — бонусы от баффов
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const info = popup.slice(popup.indexOf('const GEAR_INFO = {'), popup.indexOf('const goalList'));
for (const [g, pct] of [['d', 2], ['c', 3], ['b', 5], ['a', 7], ['s', 10]]) {
  assert.match(info, new RegExp(`belt_${g}: \\['[^']+', '[^']*сила крита \\+${pct}%'\\]`), `belt ${g}`);
  assert.match(info, new RegExp(`cloak_${g}: \\['[^']+', '[^']*\\(усиливается баффами\\)'\\]`), `cloak ${g}`);
}
assert.doesNotMatch(info, /крит \+\d+\.\d%/, 'old crit-chance texts removed');
console.log('PASS: 8.0.1 gear texts — belts give crit power by grade, cloaks scale with buffs');
