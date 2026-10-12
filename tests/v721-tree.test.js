'use strict';
// 7.2.1: список «что фармить» как на форуме — разметка и защита от зацикливания перерисовки (полная проверка — v721-tree-browser.cjs)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), js = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
for (const id of ['farmSearch', 'farmTree', 'recipeSearch', 'recipeTree']) assert.match(html, new RegExp(`id="${id}"`));
assert.match(js, /if \(g\.open === treeOpen\[kind\]\.has\(id\)\) return;/, 're-render of an open group fires «toggle» — must not loop');
assert.match(js, /renderTree\('farm', rt, d\); renderTree\('recipe', rt, d\);/);
assert.match(js, /\$\(T\.input\)\.value = off \? '' : r\.name; await save\(\{ target: \$\(T\.input\) \}\);/, '«farm this» sets the goal through the normal save path');
// 9.2.6 (игрок 12.10: «не получается снять галочку»): ✓ у текущей цели снимает её
assert.match(js, /const off = go\.dataset\.treeGo === treeKey\(kind, \$\(T\.input\)\.value\);/, '✓ on the current goal clears it');
assert.match(js, /title="\$\{on \? 'Снять цель' : 'Фармить это'\}"/, 'current goal button says «Снять цель»');
assert.ok(!/\.fs\.far\{[^}]*opacity/.test(fs.readFileSync(path.join(root, 'ui-v7.css'), 'utf8')), 'out-of-level sources are not dimmed (player 10.10)');
console.log('PASS: forum-like farm/recipe list wired (markup, goal via save, no toggle loop)');
