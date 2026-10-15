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
// 3. меню: currentMode, снятие режима повторным нажатием, кнопка «Только задачи», кнопки задач
const cm = popup.match(/function currentMode\(d\) \{\n([\s\S]*?)\n\}/)[1];
const currentMode = new Function('d', cm);
assert.equal(currentMode({ taskOnly: true }), 'tasks'); assert.equal(currentMode({ taskOnly: true, fishMode: true }), 'fish'); assert.equal(currentMode({ zoneAuto: true }), 'auto');
assert.match(popup, /const MODES_OFF = \{[^}]*taskOnly: false \}/);
assert.match(popup, /currentMode\(\{ \.\.\.DEF, \.\.\.cfg \}\) === b\.dataset\.mode \? 'tasks' : b\.dataset\.mode/);
assert.match(popup, /if \(m === 'tasks'\) await menuPatch\([^\n]*taskOnly: true/, 'removing the mode neither starts nor stops the bot');
assert.match(html, /<button id="tasksToggle" data-mode="tasks"[^>]*>⏹ Только задачи<\/button>/);
for (const k of ['mmOrders', 'mmUpgrade', 'mmCraftSend', 'storyTurnIn', 'enemyHunt']) assert.match(html, new RegExp(`data-task="${k}"`));
assert.ok(html.indexOf('data-task="mmOrders"') < html.indexOf('id="tvtToggle"'), 'TvT is in the task group');
console.log('PASS: 10.0 quick modes — no mode = tasks only (Mammon, crafter, mail, quests, farm goal, TvT; stands between them), re-click removes a mode, task toggles in the quick panel');
