'use strict';
// 20.61 (лог 25.10 09:11, John: «на спойле не хочет бить бастион, хотя может справиться»): Fortune Seeker 76 в Ashen Bastion —
// Dark Reaper 85 трижды «выше героя на 9 (предел +5) — не бью, на карту», бой → список → тот же бой. Вручную моб убит без потерь HP.
// В Ashen предел «до героя +» не действует: место и окно lvlMin/lvlMax выбрал игрок (ashenStep), обычная цепочка — по-прежнему с пределом
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const combat = fs.readFileSync(path.join(__dirname, '..', 'modules/combat.js'), 'utf8');
const i = combat.indexOf('выше героя на ${lv - hl}'), block = combat.slice(combat.lastIndexOf('{ const hl = env.heroLvl()', i), i);
assert.match(block, /const ashen = ctx\.ashen = \/\^ashen_bastion_mob_\/i\.test\(String\(spawnId \|\| ''\)\) \|\| \/\^ashen_bastion_mob_\/i\.test\(String\(ctx\.spawnId \|\| ''\)\);/, 'Ashen spawn detected');
assert.match(block, /if \(!isRb && !ashen && hl && lv && up < 99 && lv > hl \+ up/, 'Ashen exempt from the +N cap');
// поведение условия: Ashen 85 при герое 76 — бьём; обычный моб 85 из цепочки — нет
const ashenRe = /^ashen_bastion_mob_/i, skip = (sp, lv, hl, up = 5) => !ashenRe.test(sp) && lv > hl + up;
assert.equal(skip('ashen_bastion_mob_001', 85, 76), false); assert.equal(skip('l2dop_m_123', 85, 76), true); assert.equal(skip('l2dop_m_123', 80, 76), false);
// mobfarm.ashenStep выбирает только по окну lvlMin/lvlMax — предел +5 его не трогает
const mf = fs.readFileSync(path.join(__dirname, '..', 'modules/mobfarm.js'), 'utf8');
assert.match(mf, /const target = rows\.find\(r => r\.ready && r\.lvl >= min && r\.lvl <= max\);/);
console.log('PASS: 20.61 Ashen Bastion mobs are not refused by the «hero +5» cap; ordinary chain mobs still are');
// после победы в Ashen «≈N с на моба — 2 часа не выбираю» считается по урону по всем мобам пачки (ручной бой 25.10: 4 моба за ≈47 с)
assert.match(combat, /const ashen = ctx\.ashen = /, 'Ashen flag kept in ctx');
assert.match(combat, /ttkOne = ctx\.max \/ Math\.max\(ctx\.ashen \? Math\.max\(dps, totalDps\) : dps, 1\);/, 'Ashen per-mob time from total damage');
console.log('PASS: 20.61 Ashen per-mob time uses damage on the whole pack');
