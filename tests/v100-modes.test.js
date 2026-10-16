'use strict';
// 10.0 часть 5 (игрок 12.10: «ребилд быстрых режимов и разделов», «кнопка старт без быстрого режима… не все задачи стоят на быстром режиме»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { chooseMode } = require('../engine-core.js');
const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), mobfarm = read('modules/mobfarm.js'), story = read('modules/story.js');
// 1. движок: без режима — 'tasks'; любой режим важнее
assert.equal(chooseMode({ tasks: true }), 'tasks');
assert.equal(chooseMode({}), 'farm');
assert.equal(chooseMode({ tasks: true, fish: true }), 'fish');
assert.match(content, /cat: !!cfg\.catMode, campaign: campEnabled\(\), tasks: !!cfg\.taskOnly/);   // 10.0.10: кампания из меню или авто (сюжетный квест новичка)
// 2. главный цикл: без режима и без цели фарма — стоим (задачи Маммона/квестов/TvT стоят выше в цикле)
assert.match(content, /else if \(autonomyMode\(\) === 'tasks' && !lootGoal\(\)\) await tasksIdle\(\);\n[^\n]*tasksGoalNote[^\n]*\n(?:[^\n]*ashen-bastion[^\n]*\n)?\s*else if \(isMap\(\)\)/);
assert.ok(content.lastIndexOf("await tasksIdle();") > content.indexOf('await L2V7Modules.mammon.mmStep()'), 'tasks run before idling');
assert.match(mobfarm, /if \(env\.autonomyMode\(\) === 'tasks' && !tasksGoalHere\(\)\) return env\.toMap\(\);/);
assert.match(story, /\['cat', 'tasks'\]\.includes\(env\.autonomyMode\(\)\)/);
// 3. Canonical selection is independent of Start; detailed commands retain setMode.
const cm = popup.match(/function currentMode\(d\) \{\n([\s\S]*?)\n\}/)[1];
const currentMode = new Function('d', cm);
assert.equal(currentMode({ taskOnly: true }), 'tasks'); assert.equal(currentMode({ taskOnly: true, fishMode: true }), 'fish'); assert.equal(currentMode({ zoneAuto: true }), 'auto');
assert.match(popup, /const MODES_OFF = \{[^}]*taskOnly: false \}/);
assert.match(popup, /if \(m === 'tasks'\) await menuPatch\([^\n]*taskOnly: true/, 'detailed mode removal neither starts nor stops the bot');
for (const task of ['mammon', 'quests', 'pvp', 'tvt', 'fish', 'farm']) assert.match(html, new RegExp(`data-auto-task="${task}"`));
for (const id of ['mmOrders', 'mmUpgrade', 'storyTurnIn', 'enemyHunt']) assert.match(html, new RegExp(`id="${id}"`), `detailed setting ${id} remains`);
assert.doesNotMatch(html, /id="tasksToggle"|data-mode="tasks"|data-task=/);
const edit = popup.slice(popup.indexOf('function editAutoTask('), popup.indexOf('function currentMode('));
assert.match(edit, /cfgPatch: autoTaskPatch/);
assert.doesNotMatch(edit, /on: true|setMode\(/, 'selection does not start the bot');
console.log('PASS: canonical task selection, retained detailed settings and commands, no implicit start');
