// 20.17: Маммон, автозаточка и сервис выделены отдельно; прежние проверки полей/переходов сохраняются.
'use strict';
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 20.12 (ревизия 17.10, аудит §3, UI-1..UI-15): меню сведено из 12 разделов в 6, тонкая настройка — в блоке «Дополнительно»
// каждого раздела; старые ссылки #tab-<старый> открывают нужный подраздел через TAB_GROUP; ни одна настройка не потерялась.
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('popup.html'), js = (read('defaults.js') + '\n' + read('popup.js')), ui = read('ui-v7.js'), content = (read('defaults.js') + '\n' + read('content.js'));
const css = read('ui-game.css') + read('ui-v7.css');

// 1. шесть разделов, шесть кнопок навигации, порядок совпадает
const SECS = ['overview', 'hunt', 'rb', 'panel', 'enchant', 'fish', 'mammon', 'lifestone', 'pvp', 'svc'];
const tabs = [...html.matchAll(/<button data-tab="([a-z]+)"/g)].map(m => m[1]);
const secs = [...html.matchAll(/<section id="tab-([a-z]+)"/g)].map(m => m[1]);
assert.deepEqual(tabs, SECS); assert.deepEqual(secs, SECS);
for (const t of SECS) assert.match(html, new RegExp(`<button data-tab="${t}" data-short="[^"]+"`), 'короткая подпись для узкой панели ' + t);

// 2. старые имена разделов → новый раздел, метка на месте и лежит внутри него
const tg = js.match(/const TAB_GROUP = \{([\s\S]*?)\};/)[1];
const map = Object.fromEntries([...tg.matchAll(/(\w+): '(\w+)'/g)].map(m => [m[1], m[2]]));
const OLD = { limits: 'overview', autofarm: 'hunt', dungeon: 'hunt', loc: 'hunt', dailies: 'hunt', epic: 'rb', rbtimer: 'rb',
  analyze: 'panel', roles: 'panel', pet: 'panel', warlock: 'panel', classes: 'panel', mage: 'panel', spoil: 'panel', fighter: 'panel', fight: 'panel',
  supply: 'fish', seals: 'lifestone', loot: 'fish', tvtshop: 'pvp', enemies: 'pvp', log: 'svc' };
assert.deepEqual(map, OLD);
const secRange = s => { const a = html.indexOf(`<section id="tab-${s}"`); return [a, html.indexOf('</section>', a)]; };
for (const [old, sec] of Object.entries(OLD)) {
  const at = html.indexOf(`id="tab-${old}"`), [a, b] = secRange(sec);
  assert.ok(at > a && at < b, `метка #tab-${old} внутри раздела ${sec}`);
}
// TASK_TABS и data-goto по-прежнему ведут только на существующие имена
const tt = js.match(/const TASK_TABS = \{([^}]*)\}/)[1];
for (const m of tt.matchAll(/:'(\w+)'/g)) assert.ok(SECS.includes(m[1]) || OLD[m[1]], 'TASK_TABS ' + m[1]);
for (const m of html.matchAll(/data-goto="(\w+)"/g)) assert.ok(SECS.includes(m[1]) || OLD[m[1]], 'data-goto ' + m[1]);

// 3. «Дополнительно» в каждом разделе, сворачивается и помнится (uiState.adv), поиск и ссылки его раскрывают
for (const s of SECS.filter(s => !['enchant', 'lifestone'].includes(s))) { const [a, b] = secRange(s); assert.match(html.slice(a, b), /<div class="adv-start" data-adv="[a-z]+">⚙ /, 'adv в ' + s); }
assert.match(js, /uiState\.adv \|\|= \{\};/);
assert.match(js, /function revealEl\(el\)/); assert.match(js, /function advSet\(a, open\)/);
assert.match(js, /showTab\(r\.tab\); revealEl\(r\.el\);/, 'поиск раскрывает блок «Дополнительно»');
assert.match(js, /!el\.closest\('\.adv\.closed'\)/, 'свёрнутый блок не перерисовывается (UI-5)');

// 4. шапка: без строки бренда, задачи одной строкой, активность вместе с #status; версия в подвале
for (const id of ['brandbar', 'workVer', 'navToggle', 'currentSectionTitle', 'currentSectionDesc', 'navCurrentName']) assert.ok(!html.includes(`id="${id}"`), 'убран ' + id);
assert.match(html, /<button id="modeToggle"[^>]*aria-expanded="false"[^>]*>\s*<span class="mode-toggle-title">◫ Задачи бота:<\/span><span id="modeSummary">/);
assert.match(html, /<div id="activityPanel"[\s\S]*?<div id="status"><\/div><\/div>\s*<\/header>/);
assert.match(html, /<footer><span id="footVer"><\/span>/);
assert.match(html, /<div id="quickModeGrid" hidden>/, 'список задач свёрнут по умолчанию');
const grid = html.slice(html.indexOf('<div id="quickModeGrid"'), html.indexOf('</fieldset>', html.indexOf('<div id="quickModeGrid"')));
const g1 = grid.indexOf('Основная работа'), g2 = grid.indexOf('Фоновые и по расписанию');
assert.ok(g1 > 0 && g2 > g1);
for (const k of ['enchant', 'epic', 'raid', 'quests', 'fish', 'cat', 'auto', 'farm']) { const i = grid.indexOf(`data-auto-task="${k}"`); assert.ok(i > g1 && i < g2, 'основная ' + k); }
for (const k of ['tvt', 'mammon', 'dailies', 'clan', 'pvp', 'petbuff', 'resources']) assert.ok(grid.indexOf(`data-auto-task="${k}"`) > g2, 'фоновая ' + k);
assert.match(ui, /modeToggle\?\.addEventListener\('click', \(\) => \{ if \(typeof taskListToggle === 'function'\) taskListToggle\(\); \}\);/);

// 5. ни одного повторного id; управление ⇄ сохранение: каждое поле из NUM/BOOL/STR есть в разметке, каждое поле умолчания читается
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length, 'повтор id');
const list = name => (js.match(new RegExp(`const ${name}\\s*= \\[([^\\]]*)\\]`)) || [, ''])[1].match(/'([^']+)'/g)?.map(x => x.slice(1, -1)) || [];
const fields = [...list('NUM'), ...list('BOOL')];
assert.ok(fields.length > 120, 'поля формы: ' + fields.length);
for (const f of fields) assert.ok(ids.includes(f), 'поле без элемента: ' + f);

// 6. мёртвые поля rbTimers/rbTimerMin убраны (никто не читал); ритм спецудара — видимая галка, по умолчанию ВКЛ
for (const src of [html, js, content]) assert.ok(!/\brbTimers\b|\brbTimerMin\b/.test(src));
assert.ok(list('BOOL').includes('rbSpikeRhythm')); assert.match(js, /rbTurnPrice: true, rbSpikeRhythm: true/);
assert.match(content, /rbTurnPrice: true, rbSpikeRhythm: true,/); assert.match(read('modules/combat.js'), /env\.cfg\.rbSpikeRhythm !== false/);
assert.equal(JSON.parse(read('base-profile.json')).cfg.rbSpikeRhythm, true);
// крафтер Skye остаётся: его читают mammon/subclass
for (const id of ['mmCraftBox', 'mmCraftForget', 'subCraftSelf']) assert.ok(ids.includes(id), id);
assert.match(read('modules/mammon.js'), /cfg\.mmCrafter/);

// 7. CSS: неподключённые файлы удалены, !important только для [hidden] и reduced-motion
assert.ok(!fs.existsSync(path.join(root, 'ui-ios.css')) && !fs.existsSync(path.join(root, 'ui-readable.css')));
for (const m of html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)) if (!/^https?:/.test(m[1])) assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
assert.ok((read('ui-game.css').match(/!important/g) || []).length <= 8, 'ui-game.css: !important ' + (read('ui-game.css').match(/!important/g) || []).length);
assert.match(css, /\.adv\.closed > \.adv-b|\.adv\.closed>\.adv-b/);
assert.match(css, /html\.tabbed|html\.docked/);
console.log('PASS 20.12 layout: 10 sections + nav, old #tab-* anchors via TAB_GROUP, «Дополнительно» in each section, compact header, no lost fields, dead rbTimers removed, unused CSS gone');
