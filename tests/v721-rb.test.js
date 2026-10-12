'use strict';
// 7.2.1 (логи 10.10 21:32–21:46): окно карты от другого РБ (смерть у Короля Тарлка), спецудар незнакомого РБ ×6,8 вместо замеренного,
// вечные «не по силам» по оценке, иммунитет РБ к дебаффам, информационное окно по левому краю
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let modal = { shown: true, title: 'Розпалений Голем', sub: 'ур. 44 · рейд-босс · агресивний · NPC 25431' };
const q = s => s === '#map-mob-modal' ? (modal.shown ? {} : null) : s === '#map-mob-modal-title' ? { textContent: modal.title } : s === '#map-mob-modal-sub' ? { textContent: modal.sub } : null;
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/raid.js'), 'utf8'), sb);
const env = { $q: q, shown: x => !!x, rt: { rbK: 0.144, rbStats: {}, rbDb: {} }, cfg: {}, meHp: () => ({ max: 4022, cur: 4022, pct: 100 }), potModel: () => ({ pool: 666000, rate: 600 }),
  fmtK: n => String(Math.round(n)), fmtT: t => String(Math.round(t)), setRt: async p => Object.assign(env.rt, p), heroLvl: () => 52 };
const R = sb.L2V7Factories.raid(env);
// 1. окно карты ещё от Розпаленого Голема — это НЕ Король Тарлк (номер NPC из spawnId)
assert.equal(R.rbModalIs({ id: 'l2dop_rb_25158', name: 'Король Тарлк' }), false, 'stale modal of another RB is rejected');
assert.equal(R.rbModalIs({ id: 'l2dop_rb_25431', name: 'Розпалений Голем' }), true);
modal = { shown: true, title: 'Король Тарлк', sub: '' };
assert.equal(R.rbModalIs({ id: 'x', name: 'Король Тарлк' }), true, 'by name when no NPC number');
// 2. множитель спецудара: замер Госмоса 1344 при P.Atk 2171 (обычный ≈313) → ×4,3 (+15 %), без замеров ×5,5
assert.equal(R.rbSpK(), 5.5);
env.rt.rbStats.g = { hp: 576831, patk: 2171 }; env.rt.rbDb.g = { sp: 1344 };
assert.ok(Math.abs(R.rbSpK() - 1344 / (2171 * 0.144) * 1.15) < 1e-9);
// 3. РБ, которого не видели (цифры — прикидка): отсекается только явно неподъёмный
const est = { hp: 700000, patk: 2600, est: true }, real = { ...est, est: false };
env.cfg.rbProbe = false;   // 9.2.5: без пробного захода — как раньше
const a = R.rbPreCheck('n', est), b = R.rbPreCheck('n', real);
assert.equal(b.ok, false, 'real numbers: special ≈1860 = 46 % HP → no');
delete env.cfg.rbProbe; assert.equal(R.rbPreCheck('n', real).probe, true, '9.2.5: estimate < 80 % HP → one probe');
assert.ok(a.ok || a.kind !== 'strong', 'estimate only: not rejected as «strong» — real numbers on the map decide');
// 4. код: оценка до боя — пропуск 30 мин, а не вечный вердикт; иммунитет к дебаффам; самопроверка HP; миграция
const raid = fs.readFileSync(path.join(root, 'modules/raid.js'), 'utf8'), combat = fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
assert.ok(!/verdict: 'no', name: r\.name, lvl: r\.lvl, note: 'оценка до боя/.test(raid), 'no permanent verdict from an estimate');
assert.match(combat, /if \(env\.rt\.debuffImmune\?\.\[ctx\.rb \? 'rb' : ctx\.champ \? 'champ' : 'mob'\]\) return null;/);
assert.match(combat, /\/імунітет\|иммунитет\|immune\/i\.test\(added\)/);
assert.match(combat, /в памяти были чужие цифры/);
assert.match(content, /once\('rbFix721'/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'base-profile.json'), 'utf8')).chars.Warlock.rt.debuffImmune.rb > 0, true);
// 5. информационное окно: по левому краю на всю высоту, шрифт крупнее
assert.match(content, /#l2bot-ind\.wide\{box-sizing:border-box;top:8px;bottom:8px;max-height:none;overflow:hidden;font-size:16px/);
assert.match(content, /ui\.classList\.toggle\('wide', free >= 300\)/);
console.log('PASS: RB — modal must show this RB, measured special multiplier, estimate-only RBs not rejected, no permanent verdict from estimates, debuff immunity, stale stats self-check; wide info window');
