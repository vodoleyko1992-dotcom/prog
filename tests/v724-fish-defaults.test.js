'use strict';
// 7.2.4 (скрин игрока 10.10): настройки рыбалки — базовые: наживка «Авто», заряды вкл., докупать вкл., 1000 пакетов наживки,
// заряды под наживку (авто, до 1000 пакетов), 750 пакетов зарядов, если авто выкл., без лимита забросов
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const want = { fishBait: 'auto', fishShots: true, fishAutoBuy: true, fishBuyPacks: 1000, fishShotAuto: true, fishShotPacks: 750, fishMaxCasts: 0 };
const content = read('content.js'), popup = read('popup.js'), fishing = read('modules/fishing.js');
const lit = v => typeof v === 'string' ? `'${v}'` : String(v);
for (const [k, v] of Object.entries(want)) {
  assert.ok(content.includes(`${k}: ${lit(v)}`), `content DEF_CFG ${k}`);
  assert.ok(popup.includes(`${k}: ${lit(v)}`), `popup DEF ${k}`);
}
assert.equal((popup.match(/fishBuyPacks: 1000, fishShotPacks: 750/g) || []).length, 2, 'menu defaults and the «best settings» button');
const base = JSON.parse(read('base-profile.json')).cfg;
for (const [k, v] of Object.entries(want)) assert.equal(base[k], v, `base profile ${k}`);
assert.match(content, /once\('fish724', \(\) => \{ Object\.assign\(cf, \{ fishBait: 'auto', fishShots: true, fishAutoBuy: true, fishBuyPacks: 1000, fishShotAuto: true, fishShotPacks: 750, fishMaxCasts: 0 \}\); \}\);/);
assert.match(fishing, /env\.cfg\.fishBuyPacks \|\| 1000/);
assert.match(fishing, /let sp = env\.cfg\.fishShotPacks \|\| 750/);
// авто-соотношение: на 1000 пакетов наживки (10 000 шт., ≈1,47 на рыбу, 5,5 заряда на рыбу) — ≈748 пакетов, потолок 1000 (было 400)
assert.match(fishing, /sp = Math\.max\(5, Math\.min\(1000, Math\.ceil\(fishLeft \* shotPerFish \/ 50\)\)\);/);
assert.equal(Math.max(5, Math.min(1000, Math.ceil(10000 / 1.47 * 5.5 / 50))), 749);
assert.match(read('popup.html'), /\(≈750 пакетов на 1000 пакетов наживки\)/);
console.log('PASS: player fishing settings are the defaults (auto bait, 1000 bait packs, 750 shot packs, auto ratio up to 1000 packs)');
