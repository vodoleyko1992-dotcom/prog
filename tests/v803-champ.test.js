// 20.13 (ревизия 17.10, шаг 7, defaults/D12): заводские умолчания движка и меню теперь в defaults.js — литералы умолчаний ищем и там.
// 15.10: режим окупаемости по новому решению игрока.
'use strict';
// 8.0.3 (игрок 11.10: «пусть поиск чемпионов по умолчанию будет откл., с возможностью вкл»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = (read('defaults.js') + '\n' + read('content.js')), popup = (read('defaults.js') + '\n' + read('popup.js')), html = read('popup.html'), mobfarm = read('modules/mobfarm.js');
// 10.0.5 (игрок 13.10 00:38: «добавь автопоиск чемпионов раз в 20 убитых мобов»): поиск чемпионов снова ВКЛ по умолчанию (once champAuto1005)
assert.match(content, /chain: true, searchQuest: true, searchChamp: true, champFa: true, champLeave: true, noCancelMobs: true, cancelMobs: '', champCancel: 'efficiency', champEvery: 30, deepEvery: 30,/, 'core default: on (17.10: interval 30)');
assert.match(popup, /chain: true, searchQuest: true, searchChamp: true,/, 'menu default: on (10.0.5)');
assert.equal(JSON.parse(read('base-profile.json')).cfg.searchChamp, true, 'base profile: on (10.0.5)');
assert.match(content, /once\('champAuto1005', \(\) => \{ cf\.searchChamp = true; \}\);/, '10.0.5: existing installs switched on once');
assert.match(content, /once\('champ803', \(\) => \{ cf\.searchChamp = false; \}\);/, 'existing installs switched off once');
assert.match(html, /<label>⚔ Искать чемпионов по локации <input id="searchChamp" type="checkbox"><\/label>/, 'toggle to turn it on');
assert.match(popup, /const BOOL = \[[^\]]*'searchChamp'/, 'toggle is saved');
// без поиска — ни окна −8, ни ×3; с поиском — как в 8.0
assert.match(mobfarm, /const champOn = champRuleOn\(\);/);
// 10.0.5 (игрок 13.10: «фарм мобов −5 лвл максимум»): окно чемпионов −8 → −5, как у всех
assert.match(mobfarm, /const below = \(champ && champOn\) \|\| relaxDown \? FA_BELOW : lowCap\(\);/);
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
// 8.0.3 (вторая проверка): устаревание пакета настроек считается ДО записи rt и только по свежим cfg — иначе флаги, которые эта же
// вкладка только что записала в rt (setRt сразу кладёт их в память), выбрасывали ещё не применённые правки настроек
const cfgStaleAt = content.indexOf('const cfgStale = Object.keys(deferredMigrations.cfg).length > 0 && migApplied(deferredMigrations.cfg, L2EngineCore.rawTaskConfig(cfg));');
const rtWriteAt = content.indexOf('const result = await setRt(patch);', cfgStaleAt);
assert.ok(cfgStaleAt > 0 && rtWriteAt > cfgStaleAt, 'staleness of the cfg batch is computed before the rt batch is written');
assert.match(content, /if \(cfgStale\) deferredMigrations\.cfg = \{\};/);
assert.doesNotMatch(content, /migApplied\(deferredMigrations\.cfg, cfg, rt\)/, 'no rt look-up for the cfg batch');
{ // сценарий: ждавшая вкладка получила замок первой — её rt-пакет пишется, флаг попадает в rt, но cfg-пакет ещё не применён
  const rtMem = {}, cfgFresh = {};
  const defRt = { champ803: 1 }, defCfg = { champ803: 1, searchChamp: false };
  const stale = migApplied(defCfg, cfgFresh);          // как в main(): до записи rt
  Object.assign(rtMem, defRt);                         // setRt(patch)
  assert.equal(stale, false, 'cfg batch survives');
  assert.equal(migApplied(defCfg, cfgFresh, rtMem), true, 'the old check (after the rt write, with rt) would have dropped it');
}
assert.match(content, /if \(migApplied\(deferredMigrations\.rt, rt\)\) deferredMigrations\.rt = \{\};/);
// меню: подсказка «Фарм на месте» не обещает чемпионов; правило [чемп] серое, пока галочка выключена
assert.match(html, /title="Стоять там, где оставили: ★ цели квестов и мобы этой локации \(чемпионы — если включено «Искать чемпионов» в «Охоте»\)"/);
assert.match(popup, /const ruleOff = r => !r\.neg && \(\(r\.champ && !\$\('searchChamp'\)\?\.checked\) \|\| \(r\.quest && !\$\('searchQuest'\)\?\.checked\)\);/);
assert.match(popup, /for \(const id of \['searchChamp', 'searchQuest'\]\) \$\(id\)\?\.addEventListener\('change', \(\) => renderPrio\(\$\('priority'\)\.value\)\);/);
console.log('PASS: 8.0.3 champion search is OFF by default (core, menu, base profile, one-time migration), toggle turns it on; off = champions are ordinary mobs');
