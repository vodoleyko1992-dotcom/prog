'use strict';
// 10.0.8 → следующая (игрок 13.10 07:27: «почему в катакомбах бот часто не бьёт следующего, а идёт на окно выбора моба?»; лог 13.10
// 17:17:41–17:25, Necropolis of Martyrdom): банка MP отвечала 8,4 с, после неё 6 нажатий не ушли на сервер («урон 0 · MP 0», ни одного
// POST /game/battle/action) → через 15 с Purgatory Gargoyle (3444 HP, бот убивает за 1 с) получил «не пробиваю — урон ≈0.0/с» на 2 ч;
// «Охотиться дальше» в подземелье подсовывал его снова → 51 раз «Возврат в подземелье» за 8 мин. Вердикт — только по принятым ударам
// (≥ 5) и без зависания сервера (ответ > 5 с) в окне замера; ложные метки «урон ≈0.0/с» стирает миграция hard1008
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const combat = read('modules/combat.js'), content = read('content.js');

// 1. блок вердикта из combat.js — в vm
const i0 = combat.indexOf('      const N = env.actNet?.() || {}, okHits'), i1 = combat.indexOf('\n', combat.indexOf('const hopeless = ', i0));
assert.ok(i0 > 0 && i1 > i0, 'verdict block found');
const block = combat.slice(i0, i1);
const verdict = ({ okN = 0, okN0 = 0, slowT = 0, el = 20, ttk = Infinity, losing = false, hp0T = Date.now() - 20000 }) => {
  const sb = { env: { actNet: () => ({ okN, slowT }), rt: {}, antibotState: () => false }, ctx: { okN0, hp0T, questKill: false }, el, ttk, losing, Date };
  vm.runInNewContext(`this.r = (() => {\n${block}\n return { hopeless, okHits, lagged }; })();`, sb);
  return sb.r;
};
// как в логе: ни одного принятого удара за 15 с (клики не ушли) → не «не по зубам»
assert.equal(JSON.stringify(verdict({ okN: 3, okN0: 3 })), JSON.stringify({ hopeless: false, okHits: 0, lagged: false }), 'no accepted hits → no verdict');
// сервер висел в окне замера (банка 8,4 с) → не «не по зубам», даже если ударов хватает
assert.equal(verdict({ okN: 12, okN0: 2, slowT: Date.now() - 5000 }).hopeless, false, 'server lag in the window → no verdict');
assert.equal(verdict({ okN: 12, okN0: 2, slowT: Date.now() - 5000 }).lagged, true);
// лаг был до начала замера — не мешает
assert.equal(verdict({ okN: 12, okN0: 2, slowT: Date.now() - 60000 }).hopeless, true, 'old lag does not block a real verdict');
// настоящее «не пробиваю»: 10 принятых ударов, убить ≈400 с → вердикт как прежде
assert.equal(verdict({ okN: 10, okN0: 0, ttk: 400 }).hopeless, true, 'real hopeless fight still detected');
assert.equal(verdict({ okN: 4, okN0: 0, ttk: 400 }).hopeless, false, 'fewer than 5 accepted hits → wait');
assert.equal(verdict({ okN: 10, okN0: 0, ttk: 100, losing: true }).hopeless, true, 'losing + ttk > 90 as before');
assert.equal(verdict({ okN: 10, okN0: 0, ttk: 100, losing: false }).hopeless, false);

// 2. счётчики в сетевом обработчике content.js и стартовые отметки в бою
assert.match(content, /if \(ACT_NET\.ok\) ACT_NET\.okN = \(ACT_NET\.okN \|\| 0\) \+ 1;/, 'accepted actions counted');
assert.match(content, /if \(\+d\.ms > 5000\) ACT_NET\.slowT = Date\.now\(\);/, 'slow answers (> 5 s) remembered');
assert.equal((combat.match(/ctx\.okN0 = env\.actNet\?\.\(\)\?\.okN \|\| 0/g) || []).length, 2, 'okN0 set at fight start and when the main mob changes');

// 3. миграция hard1008 стирает только ложные метки «урон ≈0.0/с»
const m0 = content.indexOf("once('hard1008'"), m1 = content.indexOf('\n', m0);
const sb = { rf: { hardMobs: { 'purgatory gargoyle': { why: 'урон ≈0.0/с, моба убить ≈никогда' }, 'guardian basilisk': { why: 'урон ≈4.6/с, моба убить ≈402 с' } } }, once: (k, f) => f(), Object };
vm.runInNewContext(content.slice(m0, m1), sb);
assert.equal(JSON.stringify(Object.keys(sb.rf.hardMobs)), JSON.stringify(['guardian basilisk']), 'only the bogus 0-damage mark is dropped');
console.log('v1008-hardmob-lag: PASS');
