'use strict';
// 7.2.2 (лог 10.10 23:17–23:19): городской набор не понижает баффы; недобитый РБ — первым в туре; призыв кота повторяется сразу
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let hud = [];
const box = { querySelectorAll: () => hud.map(([id, lv, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => `Бафф · Lv.${lv}` })) };
const load = f => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html' } }; sb.globalThis = sb; vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), sb); return sb; };
const recs = [];
const now = Date.now(), H3 = now + 3 * 3600000;
const env = { cfg: { townBuffSet: 'basic', faBuffs: '' }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? box : null, TB_KEYS: { basic: [1068, 1268, 1086, 1045] },
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: {}, faCost: () => 1 };
const B = load('modules/buffs.js').L2V7Factories.buffs(env);
// 1. Щит Lv.3 (как из набора мага/FA), а городской даёт Lv.2 — набор не берём, хотя Body Blessing (1045) пропал
hud = [[1040, 3, H3], [1068, 2, H3], [1268, 3, H3], [1086, 1, H3]];
assert.deepEqual([...B.tbDowngrade('basic', B.hudBuffs())].map(x => [x.id, x.have, x.give]), [[1040, 3, 2]]);
assert.equal(B.townBuffNeed(), null, 'town set would downgrade Shield Lv.3 → skipped');
assert.match(recs.join('\n'), /не беру — он понизит ваши баффы: .*Lv\.3→2/);
// уровни не выше — набор берётся как раньше
hud = [[1040, 2, H3], [1068, 2, H3], [1268, 3, H3], [1086, 1, H3]];
assert.equal(B.townBuffNeed()?.set, 'basic', 'nothing to downgrade, Body Blessing missing → take the set');
// 2. недобитый РБ — первым (даже если он rbCur и дальше по уровню)
const R = load('modules/raid.js').L2V7Factories.raid({ ...env, heroLvl: () => 54, cfg: { rbMaxBelow: 15, rbMaxAbove: 15 }, RB_WIN: 15, RB_TRY_MS: 0, RB_RETRY_MS: 0, meHp: () => ({ max: 4700 }),
  rt: { rbCur: 'w', rbList: { a: { name: 'Tarlk', lvl: 48, alive: true }, w: { name: 'Witch', lvl: 50, alive: true } }, rbWound: { w: { cur: 156417, max: 507285, t: Date.now() } }, rbDb: {} } });
const p = R.rbListPick();
assert.equal(p.id, 'w', 'wounded RB we fought goes first'); assert.ok(p.wounded);
// 3. призыв кота: клик не ушёл — повтор через ≈2 с; убит РБ — рана забыта
const combat = fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8');
assert.match(combat, /else await env\.setRt\(\{ petSummonT: Date\.now\(\) - 13000 \}\);/);
assert.match(combat, /delete W\[ctx\.rb\.id\]; await env\.setRt\(\{ rbWound: W \}\);/);
console.log('PASS: town set never downgrades active buffs, wounded RB first in the tour, cat summon retried in ~2 s');
