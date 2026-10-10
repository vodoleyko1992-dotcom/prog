'use strict';
// 8.0.3 (игрок 11.10: «РБ между мобами по умолчанию выкл, с возможностью включения»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), popup = read('popup.js'), raid = read('modules/raid.js');
const base = JSON.parse(read('base-profile.json')).cfg;
assert.match(content, /rbMode: false, rbBetween: false,/, 'core defaults: off');
assert.match(popup, /rbMode: false, rbBetween: false, rbMaxAbove: 15,/, 'menu defaults: off');
assert.equal(base.rbBetween, false, 'base profile: the add-on is off (the tour mode itself may stay)');
assert.match(content, /once\('rbBetween803', \(\) => \{ cf\.rbBetween = false; if \(!C\('rbHuntMode'\)\) cf\.rbMode = false; \}\);/, 'one-time switch-off outside the tour');
// смена режима: вне тура rbMode = выбор игрока (раньше тур включал rbMode, а «Фарм на месте»/«Автофарм»/«Катакомбы» его не выключали)
assert.match(popup, /const rbB = !!cfg\.rbBetween;/);
assert.match(popup, /m === 'farm'\) await activateMode\([^)]*\{ \.\.\.MODES_OFF, zoneAuto: false, rbMode: rbB \}\)/);
assert.match(popup, /\{ \.\.\.MODES_OFF, zoneAuto: true, chain: true, rbMode: rbB \}\)/);
assert.match(popup, /\{ \.\.\.MODES_OFF, catMode: true, campaign: false, rbMode: rbB \}\)/);
assert.match(popup, /: \{ rbMode: !!cfg\.rbBetween \}\) \};   \/\/ 8\.0\.3: тур выключен/);
// кнопка: выбор игрока; во время тура тур не выключает; подсветка — по rbBetween
assert.match(popup, /const v = !cfg\.rbBetween;/);
assert.match(popup, /const mode = \{ rbBetween: v, rbMode: v \|\| !!cfg\.rbHuntMode,/);
assert.doesNotMatch(popup, /: \{ rbHuntMode: false \}\) \};/, 'turning the add-on off no longer kills the RB tour');
assert.equal((popup.match(/\$\('rbToggle'\)\.classList\.toggle\('on', !!d\.rbBetween\)/g) || []).length, 2);
assert.match(raid, /rbHuntMode: false, rbMode: !!env\.cfg\.rbBetween,/, 'RB session end → autofarm keeps the player choice');
console.log('PASS: 8.0.3 «РБ между мобами» OFF by default, toggle = player choice (rbBetween), mode switches restore it, tour unaffected');
