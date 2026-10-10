'use strict';
// 8.0 (аудит боя, лог 13-30): устаревшая граница отката тормозила Aura Burn/VT; записи в бою без ожидания; вампирик раньше банки
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const combat = read('modules/combat.js'), content = read('content.js');
// 1. ownLeft: граница cdFloor только свежая, откат — по последнему замеру с экрана
const src = combat.slice(combat.indexOf('const lostUntil = new Map();'), combat.indexOf('function localCdLeft(b)'));
const now = Date.now();
const env = { skKey: b => b, slotKind: () => 'скилл', rt: { cdUse: { 'aura burn': now - 1100, 'vampiric touch': now - 1500, blaze: now - 1000 },
  skills: { 'aura burn': { cd: 1.1, cdS: [1.1, 1.3, 1.1], cdFloor: 3.4, cdFloorAt: now - 11 * 3600000 },
            'vampiric touch': { cdFloor: 3.9 },                                 // без cdFloorAt — как в базовом профиле
            blaze: { cd: 3.1, cdS: [3.1, 3.0, 2.2], cdFloor: 3.3, cdFloorAt: now - 5000 } } } };
const ownLeft = vm.runInNewContext(`${src}; ownLeft`, { env, Date, Math, Map });
assert.equal(ownLeft('aura burn'), 0, 'Aura Burn ready 1.1 s after use despite stale floor 3.4');
assert.equal(ownLeft('vampiric touch'), 0, 'VT: floor without timestamp is ignored');
assert.ok(Math.abs(ownLeft('blaze') - (3.3 * 0.85 - 1)) < 0.05, 'fresh floor (5 s old) still respected: ' + ownLeft('blaze'));
// 2. миграция стирает старые границы; в базовом профиле их нет
assert.match(content, /once\('cdFloor80', \(\) => \{ for \(const \[k, p\] of Object\.entries\(S\)\) if \(p && \(p\.cdFloor \|\| p\.cdFloorAt\)\) \{ S\[k\] = \{ \.\.\.p, cdFloor: 0, cdFloorAt: 0 \}; sk = true; \} \}\);/);
const skills = JSON.parse(read('base-profile.json')).chars.Warlock.rt.skills;
assert.ok(Object.values(skills).every(s => !s.cdFloor && !s.cdFloorAt), 'base profile has no cdFloor');
// 3. записи без ожидания на ходе и после победы; остаток очереди уходит при уходе со страницы
assert.match(combat, /env\.setRt\(\{ cdUse: use, cdUntil: until \}\);   \/\/ 8\.0/);
assert.doesNotMatch(combat, /await env\.setRt\(\{ dps: \{ n: d\.n \+ 1/);
assert.doesNotMatch(combat, /await env\.trackEfficiency\(|await env\.trackLoot\(/);
assert.match(combat, /env\.setRt\(\{\s+kills: env\.rt\.kills \+ 1,/);
assert.match(combat, /const ans = dead\(\) \|\| \(done === true && netOk\) \? null : await env\.waitFor\(/, 'no 250 ms toast wait after an accepted action');
assert.match(content, /addEventListener\('pagehide', \(\) => \{[\s\S]{0,200}const p = rtWriter\.peek\(\);[\s\S]{0,200}chrome\.runtime\.sendMessage\(\{ cmd: 'statePatch', patch: p, src: TAB_ID, epoch: leaseEpoch \}/);
assert.match(content, /const now = Date\.now\(\), dt = rt\.lastWinT \? \(now - rt\.lastWinT\) \/ 1000 : 0, via0 = rt\.via;/, 'chain/map attribution captured before nextFight changes via');
// 4. на РБ с включённой полосой банок вампирик раньше банки
assert.match(combat, /me\.pct <= \(ctx\.rb\?\.potOn \? 100 : env\.cfg\.drainHp \?\? 85\)/);
console.log('PASS: stale cdFloor no longer throttles Aura Burn/VT, migration + clean base profile, no awaited writes on action/victory + pagehide flush, VT before potion in RB band');
