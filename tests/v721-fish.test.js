'use strict';
// 7.2.1: рыбалка — Proof с рыбы по видам (из разделки и курсов обмена), замер наживок «Авто», учёт без ожидания записи
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let goodOn = false;
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: s => /goodBait/.test(s) ? { className: goodOn ? 'l2-fishing-hotbar-slot--toggle-on' : '' } : null } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/fishing.js'), 'utf8'), sb);
const env = { rt: {}, cfg: { fishBait: 'auto' }, setRt: async p => Object.assign(env.rt, p), TAG: 't', $q: s => sb.document.querySelector(s) };
const F = sb.L2V7Factories.fishing(env);
// 1. реальные итоги разделки из лога 10.10 18:48
const bl = F.fishCutValue('Вы разрезали Black Fish ×110. Получено: Fish Oil ×327, Fish Gem ×21, Shiny Fish Gem ×6.');
assert.equal(bl.name, 'Black Fish'); assert.equal(bl.n, 110);
assert.ok(Math.abs(bl.proof - (327 / 25 + 21 / 4 + 6 * 2)) < 1e-9, 'Black Fish ×110 → 30,3 Proof');
const wh = F.fishCutValue('Вы разрезали White Fish ×154. Получено: Fish Oil ×407, Greater Fish Oil ×2, Fish Scale ×53, Shiny Fish Scale ×14.');
assert.ok(Math.abs(wh.proof / wh.n - 0.3633) < 0.001, 'White Fish ≈0,36 Proof');
// курсы из магазина важнее заводских
env.rt.fishRates = { fish_oil: [50, 1] };
assert.ok(F.fishCutValue('Вы разрезали Black Fish ×110. Получено: Fish Oil ×327.').proof < 7);
env.rt.fishRates = null;
assert.equal(F.fishCutValue('Вы открыли Old Box ×3'), null);
// 2. «Авто»: сперва замер хорошей (пока есть), потом обычной, потом — по Proof/ч
assert.equal(F.baitWant(), 'goodBait');
env.rt.fishBaitStat = { good: { casts: 60, bites: 40, caught: 38, ms: 300000, proof: 12 } };
assert.equal(F.baitWant(), 'basicBait');
env.rt.fishBaitStat.basic = { casts: 60, bites: 40, caught: 38, ms: 300000, proof: 12.6 };
assert.equal(F.baitWant(), 'basicBait', 'good not better → basic');
env.rt.fishBaitStat.good.proof = 20;
assert.equal(F.baitWant(), 'goodBait', 'good clearly better → use it while free ones last');
assert.match(F.baitVerdict(), /покупать за Proof \(0,3 за шт\.\) невыгодно/, '+0,12 Proof per cast < 0,3 price');
env.cfg.fishBait = 'basic'; assert.equal(F.baitWant(), 'basicBait'); env.cfg.fishBait = 'good'; assert.equal(F.baitWant(), 'goodBait');
// 3. код: после поимки — без ожидания записи; лишняя пауза после «не клюнула» убрана; наживка — та, что выбрана в игре
const src = fs.readFileSync(path.join(root, 'modules/fishing.js'), 'utf8');
assert.match(src, /  fishStat\(\{ caught: 1 \}, name\);\n  bg\(env\.setRt\(/);
assert.ok(!/await env\.waitFor\(\(\) => fOk\(fSlot\('fishing'\)\) \|\| fishState\(\), 3000, 50\);\n\s*await env\.sleep\(env\.rnd\(50, 150\)\);/.test(src));
assert.match(src, /const bait = curBait\(\), baitSlot = \(\) => fSlot\(bait \+ 'Bait'\);/);
assert.match(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), /once\('bait721'/);
console.log('PASS: fishing — Proof per species from cut results and shop rates, auto bait by measured Proof/h (buy verdict at 0.3 Proof), no blocking writes after a catch');
