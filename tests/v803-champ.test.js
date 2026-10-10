'use strict';
// 8.0.3 (игрок 11.10: «пусть поиск чемпионов по умолчанию будет откл., с возможностью вкл»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), mobfarm = read('modules/mobfarm.js');
assert.match(content, /chain: true, searchQuest: true, searchChamp: false, deepEvery: 10,/, 'core default: off');
assert.match(popup, /chain: true, searchQuest: true, searchChamp: false,/, 'menu default: off');
assert.equal(JSON.parse(read('base-profile.json')).cfg.searchChamp, false, 'base profile: off');
assert.match(content, /once\('champ803', \(\) => \{ cf\.searchChamp = false; \}\);/, 'existing installs switched off once');
assert.match(html, /<label>⚔ Искать чемпионов по локации <input id="searchChamp" type="checkbox"><\/label>/, 'toggle to turn it on');
assert.match(popup, /const BOOL = \[[^\]]*'searchChamp'/, 'toggle is saved');
// без поиска — ни окна −8, ни ×3; с поиском — как в 8.0
assert.match(mobfarm, /const champOn = champRuleOn\(\);/);
assert.match(mobfarm, /const below = champ && champOn \? Math\.max\(env\.cfg\.lvlBelow \?\? 3, CHAMP_BELOW\) : \(env\.cfg\.lvlBelow \?\? 3\);/);
assert.match(mobfarm, /const ch = c\.champ && champOn;/);
assert.match(mobfarm, /return !!env\.cfg\.searchChamp;/, 'the [чемп] rule follows the toggle');
console.log('PASS: 8.0.3 champion search is OFF by default (core, menu, base profile, one-time migration), toggle turns it on; off = champions are ordinary mobs');
