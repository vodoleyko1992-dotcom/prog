'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 10.0.5 (лог 12.10 01:29:58–01:30:25, игрок: «почему в режиме „только задачи“ автофармит мобов?»): без режима мобов бьём только на точке
// цели фарма ресурса/рецепта; на чужой точке (Окрестности, Vampire Soldier 71) — ждём перелёта; журнал говорит, что фармим цель и как снять
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = (read('defaults.js') + '\n' + read('content.js')), mobfarm = read('modules/mobfarm.js'), html = read('popup.html');
// 1. tasksGoalHere: цель есть и зона совпадает
const src = mobfarm.match(/function tasksGoalHere\(\) \{[^\n]+\}/)[0];
const here = (lg, zone) => vm.runInNewContext(`(env => { ${src}; return tasksGoalHere(); })`, {})({ lootGoal: () => lg, rt: { zone } });
assert.equal(here(null, 'wild_beast'), false, 'нет цели — мобов не бьём');
assert.equal(here({ kind: 'farm', name: 'Oriharukon Ore', zone: 'wild_beast' }, 'out:Ursus / Frost Iron Golem'), false, 'чужая точка (лог 01:30:03)');
assert.equal(here({ kind: 'farm', name: 'Oriharukon Ore', zone: 'wild_beast' }, null), false, 'зона неизвестна');
assert.equal(here({ kind: 'farm', name: 'Oriharukon Ore', zone: 'wild_beast' }, 'wild_beast'), true, 'на точке цели — бьём источники');
// 2. map(): после чтения зоны (absorb) без своей точки — не выбирает цель, ждёт; конец боя — на карту, не «Охотиться дальше»
const mapBody = mobfarm.slice(mobfarm.indexOf('async function map() {'));
const g = mapBody.indexOf("if (env.autonomyMode() === 'tasks' && !tasksGoalHere()) {");
assert.ok(g > mapBody.indexOf('let sig = aroundSig();\n  await env.absorb();') && g < mapBody.indexOf('candidates(rules, sig'), 'guard after zone read, before picking a mob');
assert.match(mobfarm, /if \(env\.autonomyMode\(\) === 'tasks' && !tasksGoalHere\(\)\) return env\.toMap\(\);/);
// 3. журнал и меню: цель фарма названа, «как снять» сказано
assert.match(content, /\(cfg\.farmRes \|\| ''\)\.trim\(\) && `цель фарма «\$\{cfg\.farmRes\.trim\(\)\}»`/);
assert.match(content, /else if \(autonomyMode\(\) === 'tasks' && \(tasksGoalNote\(lootGoal\(\)\), isMap\(\)\)\) await map\(\);/);
assert.match(content, /function tasksGoalNote\(g\) \{[\s\S]{0,400}снимите ✓/);
assert.match(html, /на её точке бьёт мобов-источники/);
console.log('PASS: 10.0.5 «Только задачи» — мобов бьёт только на точке цели фарма, на чужой точке ждёт перелёта, журнал называет цель и как её снять');
// 4. игрок 12.10 15:54: «убери эту цель в встроенных настройках на будущее» — разовая миграция снимает Oriharukon Ore; умолчания и базовый профиль без цели
const mig = content.match(/  once\('oriOff1005', \(\) => (\{[^\n]+\})\);/)[1];
const runMig = farmRes => { const cf = {}, cfg = { farmRes, farmNeed: 500 }, C = k => (k in cf ? cf[k] : cfg[k]); vm.runInNewContext(`(${mig})()`.replace(/^\(\{/, '(() => {').replace(/\}\)\(\)$/, '})()'), { cf, C, Object, String }); return cf; };
assert.deepEqual(runMig('Oriharukon Ore'), { farmRes: '', farmNeed: 0 });
assert.deepEqual(runMig(' oriharukon ore '), { farmRes: '', farmNeed: 0 });
assert.deepEqual(runMig('Mithril Ore'), {}, 'другую цель не трогаем');
assert.match(content, /farmRes: '', farmNeed: 0,/, 'умолчание без цели');
assert.equal(JSON.parse(read('base-profile.json')).cfg.farmRes, '', 'базовый профиль без цели');
console.log('PASS: 10.0.5 цель фарма Oriharukon Ore снимается разово, в умолчаниях и базовом профиле цели нет');
