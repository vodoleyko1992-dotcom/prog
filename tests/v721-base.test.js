'use strict';
// 7.2.1: базовый профиль из экспортов игрока 10.10 22:40 — актуальные настройки + опыт (РБ, добыча, зоны, скиллы), без сиюминутного и без пароля
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'base-profile.json'), 'utf8'), B = JSON.parse(raw), rt = B.chars.Warlock.rt, c = B.cfg;
assert.equal(/passw|"auth"/i.test(raw), false, 'no password / auth');
assert.equal(c.nHeal, 'Corpse Life Drain'); assert.equal(c.nBuffs, ''); assert.equal('nWeaponMain' in c, false, '20.12: ручное оружие не в профиле'); assert.equal(c.fishBait, 'auto'); assert.equal(c.tvtOn, true);
// 20.12 (ревизия 17.10): замеры боя Warlock 52 (rbStats, rbK, rbDps, skills) больше не переносятся — проверка в v2012-spending-defaults
for (const k of ['rbDb', 'rbList', 'lootStat', 'loot', 'zoneStat', 'spawns', 'faCat', 'petStat', 'debuffImmune']) assert.ok(rt[k] != null, 'experience kept: ' + k);
assert.ok(Object.values(rt.rbDb).filter(d => d.verdict === 'ok' && d.kills).length >= 8, '8 killed RBs from the FA session');
for (const k of ['rbHunt', 'rbGo', 'rbCur', 'rbPreSkip', 'target', 'status', 'cdUntil', 'tbuff', 'shop', 'weapons', 'panel', 'rb', 'quests', 'faBal', 'kills', 'exp']) assert.equal(k in rt, false, 'transient not in base: ' + k);
assert.ok(JSON.stringify(rt).length < 250000, 'rt stays small (rewritten on every status update)');
assert.equal(Object.keys(B.farmDb.res).length, 378);
assert.ok(Object.keys(B.learn.pages).includes('fast-aden-buffer') && Object.keys(B.learn.pages).includes('rb-bosses'));
console.log('PASS: base profile — current settings, RB/loot/zone experience, no transient state, no password');
