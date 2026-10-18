'use strict';
// 20.14 (лог 17.10 13:29–13:35, сборка 20.9): по старой метке «много пакетов не проходит» бот покупал заряды рыбалки по 1 пакету
// (50 шт. ≈ 6 рыб) при нужных ≈35; заряды кончались за минуту, а повтор ждал 2 мин — ловил без зарядов (урон 35 вместо 70).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'modules/fishing.js'), 'utf8');
const buy = code.slice(code.indexOf('const buy = async (k, offer, packs, what)'), code.indexOf('const isOn = kind =>'));
assert.ok(buy.length > 200, 'функция покупки найдена');
// метка ограничивает покупку, только если она меньше нужного и свежая (10 мин, было 30)
assert.match(buy, /useCap = cap && cap\.n < packs && Date\.now\(\) - cap\.t < 10 \* 60000/);
assert.doesNotMatch(buy, /30 \* 60000/);
// сколько пакетов реально прошло — запоминается для страховки повтора
assert.match(buy, /lastPacks = ok \? \(useCap \? cap\.n : packs\) : 0/);
assert.match(buy, /if \(ok\) \{ lastPacks = 1;/);
// малая покупка (< 5 пакетов) — повтор через 20 с, крупная — прежние 2 мин
assert.match(code, /Date\.now\(\) - shotBuyT > 120000 \|\| shotBuyN < 5 && Date\.now\(\) - shotBuyT > 20000/);
assert.match(code, /shotBuyT = Date\.now\(\); shotBuyN = lastPacks;/);
// поведение: простая модель тех же правил на ленте событий лога
const allow = (now, t, n) => now - t > 120000 || n < 5 && now - t > 20000;
assert.equal(allow(60000, 0, 1), true, '1 пакет куплен минуту назад, заряды кончились — докупаем сразу');
assert.equal(allow(10000, 0, 1), false, 'не чаще раза в 20 с даже при малых покупках');
assert.equal(allow(60000, 0, 35), false, 'после крупной покупки — прежняя страховка 2 мин');
console.log('v2014-log1810-fish-shots: PASS');
