'use strict';
// 8.0.3 (игрок 11.10: «РБ между мобами по умолчанию выкл, с возможностью включения»).
// После проверки правки: rbMode — не хранимый флаг, а вычисляемый (тур по РБ, или выбор игрока rbBetween вне рыбалки/эпиков/кампании)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), popup = read('popup.js'), html = read('popup.html'), mobfarm = read('modules/mobfarm.js');
const base = JSON.parse(read('base-profile.json')).cfg;
assert.match(content, /rbMode: false, rbBetween: false,/, 'core defaults: off');
assert.match(popup, /rbMode: false, rbBetween: false, rbMaxAbove: 15,/, 'menu defaults: off');
assert.equal(base.rbBetween, false, 'base profile: the add-on is off (the tour mode itself may stay)');
assert.doesNotMatch(content, /once\('rbBetween803'/, 'no migration needed: a stored rbMode is ignored');

// ядро: одна формула; mergeCfg (все чтения хранилища), setCfg и разовые миграции её применяют
const rbSrc = content.match(/const rbEff = (c => [^;]+);/)[1];
assert.equal(popup.match(/const rbEff = (d => [^;]+);/)[1].replace(/\bd\b/g, 'c'), rbSrc, 'menu uses the same formula as the core');
const sb = vm.createContext({ DEF_CFG: { rbMode: false, rbBetween: false, rbHuntMode: false, fishMode: false, epicMode: false, campaign: false } });
vm.runInContext(`const rbEff = ${rbSrc}; ${content.match(/const withRb = [^;]+;/)[0]} ${content.match(/const mergeCfg = [^;]+;/)[0]} this.r = { rbEff, withRb, mergeCfg };`, sb);
const { mergeCfg, withRb } = sb.r;
const eff = c => mergeCfg(c).rbMode;
assert.equal(eff({}), false, 'fresh install: off');
assert.equal(eff({ rbMode: true }), false, 'old stored/imported rbMode:true without the choice — off (was: re-enabled the add-on)');
assert.equal(eff({ rbBetween: true }), true, 'player turned it on');
assert.equal(eff({ rbBetween: true, fishMode: true }), false, 'fishing suspends it');
assert.equal(eff({ rbBetween: true, epicMode: true }), false, 'epics suspend it');
assert.equal(eff({ rbBetween: true, campaign: true }), false, 'campaign suspends it');
assert.equal(eff({ rbBetween: true, epicMode: false }), true, 'epics off → the choice is back by itself (was: lost)');
assert.equal(eff({ rbHuntMode: true }), true, 'RB tour needs it');
assert.equal(eff({ rbHuntMode: true, rbBetween: false, rbMode: false }), true, 'tour wins over a stale stored value');
assert.equal(withRb({ rbBetween: false, rbHuntMode: false, rbMode: true }).rbMode, false);
assert.match(content, /  cfg = withRb\(\{ \.\.\.cfg, \.\.\.patch \}\);\n\}/, 'setCfg derives');
assert.match(content, /    cfg = withRb\(\{ \.\.\.cfg, \.\.\.cf \}\);\n    if \(on && !tabOwner\) deferredMigrations\.cfg/, 'one-time migrations derive');
assert.doesNotMatch(content, /Object\.assign\(cfg, cf\)/);
for (const re of [/cfg = mergeCfg\(result\.cfg\)/, /cfg = mergeCfg\(fresh\.cfg\)/, /cfg = mergeCfg\(state\.cfg\)/, /cfg = mergeCfg\(ch\.cfg\.newValue\)/, /cfg = mergeCfg\(s\.cfg\)/])
  assert.match(content, re, 'every storage read goes through mergeCfg');

// дополнение не держит автофарм/поход за ресурсом на месте — держит только тур или РБ, который ждёт здесь
const rbHoldSrc = mobfarm.match(/const rbHold = (\(\) => [^;]+);/)[1];
const hold = (cfg, rt) => vm.runInNewContext(`(${rbHoldSrc})()`, { env: { cfg, rt } });
assert.equal(hold({ rbMode: true, rbBetween: true }, {}), false, 'add-on alone: autofarm may change zones');
assert.equal(hold({ rbMode: true }, { rbPending: true }), true, 'RB waiting here: stay');
assert.equal(hold({ rbHuntMode: true, rbMode: true }, {}), true, 'tour: stay with the tour');
assert.equal((mobfarm.match(/!rbHold\(\)/g) || []).length, 5, 'farmRes / recipe / zonePick / lootGoal / autofarm kick');
assert.doesNotMatch(mobfarm, /!env\.cfg\.rbMode/, 'no raw rbMode gate left');
assert.match(content, /!fishNow\(\) && !\(cfg\.rbMode && rt\.rbPending\) && !huntOn\(\)\) \{ await invScanStart\(\)/, 'bag scan is not blocked by the add-on');

// меню: кнопка — выбор игрока; при рыбалке/эпиках — пунктир «ждёт»; сводки по той же формуле
assert.match(popup, /const v = !cfg\.rbBetween;/);
assert.doesNotMatch(popup, /: \{ rbHuntMode: false \}\) \};/, 'turning the add-on off no longer kills the RB tour');
assert.equal((popup.match(/paintRbToggle\(d\);/g) || []).length, 2);
assert.match(popup, /b\.classList\.toggle\('on', !!d\.rbBetween\); b\.classList\.toggle\('susp', susp\);/);
assert.match(popup, /const mods = \[rbEff\(d\) && m !== 'rb' && 'РБ между мобами'/);
assert.match(popup, /const mods = \[d\.campaign && '📜 кампания', rbEff\(d\) && m !== 'rb' && '👑 РБ между мобами'/);
assert.match(popup, /tile\('modeRbState', m === 'rb' \|\| rbEff\(d\)\);/);
assert.doesNotMatch(popup, /d\.rbMode/, 'no summary reads the stored flag');
assert.match(read('ui-v7.css'), /#rbToggle\.on\.susp\{/);
assert.doesNotMatch(html, /«РБ между мобами» включится сам|выключение «РБ между мобами» выключает тур/, 'outdated hints removed');
console.log('PASS: 8.0.3 «РБ между мобами» OFF by default; rbMode derived (tour or player choice outside fishing/epics/campaign) — epics off / import / migrations cannot desync it; add-on does not freeze autofarm');
