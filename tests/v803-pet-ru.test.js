'use strict';
// 8.0.3 (логи 11.10 10:37–10:44): выучена Summon Feline Queen (слот #4, раньше Kai #24) — незнакомого кота бот брал первым на панели;
// отказ дебаффа «Ціль опирається ефекту» засчитывался как успех; русское «атакует» в строке удара кота (на будущее)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
vm.runInNewContext(read('modules/combat.js'), sb);
const env = { rt: {}, cfg: {}, cleanTitle: s => String(s || '').trim() };
const C = sb.L2V7Factories.combat(env);
const slot = t => ({ title: t });
const panel = [slot('Summon Feline Queen'), slot('Summon Mew the Cat'), slot('Summon Kai the Cat')];   // порядок DOM: #4 королева раньше #24 Kai
assert.equal(C.petPick(panel, '').title, 'Summon Kai the Cat', 'unknown cat → best by the L2WAP magister multiplier (Kai +25 %), not the first slot');
assert.equal(C.petPick(panel, 'feline_queen').title, 'Summon Feline Queen', 'the cat of this page is kept');
env.rt.petLast = 'feline_queen';
assert.equal(C.petPick(panel, '').title, 'Summon Feline Queen', 'last live cat (summoned by the player) survives a reload');
env.rt.petLast = ''; env.rt.petAdvice = { best: 'mew_the_cat' };
assert.equal(C.petPick(panel, '').title, 'Summon Mew the Cat', 'measured advice beats the table');
env.rt.petAdvice = null; env.rt.skillDb = { 'summon feline queen': { desc: 'support-слуга; P.Atk отримує +30% від поточного M.Atk хазяїна' } };
assert.equal(C.petMul('feline_queen'), 30, 'multiplier read from the magister description when present');
assert.equal(C.petPick(panel, '').title, 'Summon Feline Queen');
const combat = read('modules/combat.js'), content = read('content.js'), html = read('popup.html');
assert.doesNotMatch(combat, /\|\| sums\[0\];/, 'no «first summon on the panel» fallback');
assert.match(content, /if \(s\?\.key && rt\.petLast !== s\.key && tabOwner\) setRt\(\{ petLast: s\.key \}\)/, 'last live cat remembered from activeSummon');
assert.match(html, /<option value="Summon Feline Queen">Feline Queen \(\+10 % от M\.Atk, бафф физ\. крита\)<\/option>/);
// дебафф: провал по-украински
const fail = combat.match(/fail = (\/не пройшов[^;]+?\/i)\.test\(added\)/)[1];
const re = vm.runInNewContext(fail);
assert.ok(re.test('Прокляття: слабкість. Ціль опирається ефекту (36%).'), '«Ціль опирається ефекту» = fail');
assert.ok(!re.test('Прокляття: слабкість. Ефект пройшов (72%).'));
assert.match(content, /once\('dbfGain803', \(\) => \{ if \(rt\.debuffGain\) rf\.debuffGain = \{\}; \}\);/, 'gain measured with the bug is reset');
// удар кота по-русски (сервер пока шлёт «атакує»)
const hits = C.petHits(['Слуга [Feline Queen] атакует [Hot Springs Flava] 1 228 урона.', 'Слуга [Kai the Cat] атакує [Unicorn] 1 409 урону.']);
assert.equal(hits.length, 2); assert.equal(hits[0].dmg, 1228); assert.equal(hits[1].dmg, 1409);
assert.match(content, /champMark: 'чемпион, чемпіон', bossMark:/, 'UA champion mark too');
assert.match(content, /once\('champMark803', \(\) => \{ if \(C\('champMark'\) === 'чемпион'\) cf\.champMark = 'чемпион, чемпіон'; \}\);/);
assert.equal(JSON.parse(read('base-profile.json')).cfg.champMark, 'чемпион, чемпіон');
console.log('PASS: 8.0.3 pet choice — unknown cat → Kai by the magister multiplier (not the first slot = Feline Queen), last live cat kept across reloads; debuff resist «Ціль опирається» counted as fail; RU «атакует» parsed; UA «чемпіон» mark');
