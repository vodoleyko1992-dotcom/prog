'use strict';
// 8.0.7 (игрок 11.10, планшет с Firefox для Android: «всё немного криво косо»): меню поверх игры свёрнуто по умолчанию,
// индикатор не налезает на открытое меню, меню вкладкой — на всю вкладку, без «раздувания шрифта» Firefox для Android
// (поведение в браузере — tests/v807-tablet-browser.cjs)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const c = read('content.js'), pj = read('popup.js'), ph = read('popup.html'), ug = read('ui-game.css');
assert.match(c, /dockOver = !\(bounds\.right > 0 && available >= 300\);\n  const min = dockOver \? !dockOverOpen\(\) : !!cfg\.dockMin;/, 'no room beside the game → folded unless opened on this device');
assert.match(c, /if \(dockOver\) \{ try \{ localStorage\.setItem\('l2bot-dockOpen'/, 'tab toggles a per-device flag, not the shared cfg.dockMin');
assert.match(c, /ui\.classList\.toggle\('hid', dockOver && !min\)/, 'indicator hidden while the menu is open over the game');
assert.match(c, /mode === 'mini' \|\| ui\.classList\.contains\('over'\) \? L\.slice\(0, 3\)/, 'indicator 3 lines over the game');
assert.match(c, /#l2bot-ind\{-moz-text-size-adjust:none/, 'no font inflation in the indicator');
assert.match(c, /const w = !dockOver \? available : Math\.min\(460/, 'menu over the game up to 460 px');
assert.match(ph, /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'menu as a tab: mobile viewport');
assert.match(ph, /-moz-text-size-adjust:none/, 'menu: no font inflation');
assert.match(pj, /chrome\.tabs\?\.getCurrent\?\.\(\)\?\.then\(t => \{ if \(t\) document\.documentElement\.classList\.add\('docked', 'tabbed'\)/, 'menu as a tab → full-tab layout; toolbar popup unchanged');
assert.match(ug, /html\.tabbed body\{max-width:960px;margin:0 auto/);
console.log('PASS: tablet — menu folded over the game (per-device), indicator hidden under an open menu, menu-as-tab full layout, no font inflation');
