'use strict';
// 8.0.3 (игрок 11.10: «купил почему-то сразу 9999 крючков»; выбор: «покупать по 100 пакетов — кончилась, бот докупит»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), popup = read('popup.js'), fishing = read('modules/fishing.js'), html = read('popup.html');
const def = content.slice(0, content.indexOf('const DEF_RT'));
assert.match(def, /fishBuyPacks: 100,/, 'core default 100 packs');
assert.doesNotMatch(def, /fishBuyPacks: 1000/);
assert.equal(JSON.parse(read('base-profile.json')).cfg.fishBuyPacks, 100, 'base profile');
assert.match(fishing, /await buy\('bait', 'bait_x10', env\.cfg\.fishBuyPacks \|\| 100, 'Fishing Lure ×10'\);/);
// миграция: только старое значение 1000 (из 7.2.4) → 100; своё число игрока не трогаем; идёт после fish724 (которая ставит 1000 на новой установке)
const mig = content.match(/  once\('fishBait803', \(\) => \{ if \(C\('fishBuyPacks'\) === 1000\) cf\.fishBuyPacks = 100; \}\);/);
assert.ok(mig, 'migration fishBait803');
assert.ok(content.indexOf("once('fish724'") < mig.index, 'runs after fish724');
const run = (cfg, cf = {}) => { const C = k => (k in cf ? cf[k] : cfg[k]); vm.runInNewContext(`(${'() => { if (C(\'fishBuyPacks\') === 1000) cf.fishBuyPacks = 100; }'})()`, { C, cf }); return cf.fishBuyPacks; };
assert.equal(run({ fishBuyPacks: 1000 }), 100, 'old 1000 → 100');
assert.equal(run({}, { fishBuyPacks: 1000 }), 100, 'fresh install: fish724 set 1000 in the same pass → 100');
assert.equal(run({ fishBuyPacks: 300 }), undefined, 'player value kept');
assert.match(html, /title="100 пакетов = 1000 шт\. ≈ 100 000 аден ≈ 1,5 ч рыбалки; кончилась — бот докупит"/);
assert.equal((popup.match(/fishBuyPacks: 100, fishShotPacks: 750/g) || []).length, 2, 'menu default and «best settings» button');
console.log('PASS: 8.0.3 bait bought 100 packs (1000 pcs ≈ 100k adena) at a time; old default 1000 migrated, own values kept');
