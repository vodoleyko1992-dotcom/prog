'use strict';
// 20.14 (лог 17.10–18.10): строка «состояние размер … — сброшены только временные кэши: нет» писалась раз в минуту (550 из 11 002
// событий журнала). Нечего сбросить — не чаще раза в 30 мин; сброс кэшей по-прежнему пишется сразу (не чаще раза в минуту).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const i = code.indexOf("rec('S', 'состояние', `размер"), part = code.slice(i - 600, i);
assert.ok(i > 0);
assert.match(part, /Date\.now\(\) - rtBigWarnT > \(cleared\.length \? 60000 : 30 \* 60000\)/);
console.log('v2014-log1810-state-size-log: PASS');
