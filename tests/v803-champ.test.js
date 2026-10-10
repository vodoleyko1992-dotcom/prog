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
// 8.0.3 (проверка правок): вкладка, ждавшая замок, не возвращает старый пакет разовых миграций настроек
const vm = require('node:vm');
const migApplied = vm.runInNewContext(`(${content.match(/const migApplied = (\(patch, \.\.\.states\) => [^;]+);/)[1]})`);
const deferred = { champ803: 1, searchChamp: false, fishPack80: 1, fishTimePack: '6h' };
const freshCfg = { champ803: 1, fishPack80: 1, searchChamp: true };                 // хозяин уже применил, игрок потом включил чемпионов
assert.equal(migApplied(deferred, freshCfg, {}), true, 'stale deferred cfg patch is detected');
assert.equal(migApplied(deferred, {}, { champ803: 1 }), true, 'flag stored in rt also counts');
assert.equal(migApplied(deferred, { searchChamp: true }, {}), false, 'not applied yet — the patch is still written');
assert.match(content, /if \(Object\.keys\(deferredMigrations\.cfg\)\.length && migApplied\(deferredMigrations\.cfg, cfg, rt\)\) deferredMigrations\.cfg = \{\};/);
assert.match(content, /if \(migApplied\(deferredMigrations\.rt, rt\)\) deferredMigrations\.rt = \{\};/);
// меню: подсказка «Фарм на месте» не обещает чемпионов; правило [чемп] серое, пока галочка выключена
assert.match(html, /title="Стоять там, где оставили: ★ цели квестов и мобы этой локации \(чемпионы — если включено «Искать чемпионов» в «Охоте»\)"/);
assert.match(popup, /const ruleOff = r => !r\.neg && \(\(r\.champ && !\$\('searchChamp'\)\?\.checked\) \|\| \(r\.quest && !\$\('searchQuest'\)\?\.checked\)\);/);
assert.match(popup, /for \(const id of \['searchChamp', 'searchQuest'\]\) \$\(id\)\?\.addEventListener\('change', \(\) => renderPrio\(\$\('priority'\)\.value\)\);/);
console.log('PASS: 8.0.3 champion search is OFF by default (core, menu, base profile, one-time migration), toggle turns it on; off = champions are ordinary mobs');
