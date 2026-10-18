'use strict';
// 20.16 (игрок 18.10 21:45): «в подземелье не использовать бафы за ФА, не бафать их специально, если они уже висят на герое, то пусть».
// В режиме катакомб faWanted пуст (свой список, Noblesse), снимающий баффы моб — цель даже при висящих платных FA.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let hud = [], mode = 'cat';
const box = { querySelectorAll: () => hud.map(([id, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => '' })) };
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/dungeon.html', href: '' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/buffs.js'), 'utf8'), sb);
const recs = [], now = Date.now(), H3 = now + 3 * 3600000;
const env = { cfg: { noCancelMobs: true, faBuffs: '1357', rbMode: true }, rt: {}, autonomyMode: () => mode, $q: s => s === '#l2-hud-active-buffs' ? box : null, TB_KEYS: { basic: [1068] }, IL: {},
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: { 1357: ['Prophecy of Water', 5] }, faCost: () => 1, sleep: async () => {} };
const B = sb.L2V7Factories.buffs(env);
hud = [[1068, H3], [1357, H3]];
// 1. катакомбы: ничего за FA не хотим, моб со снятием — цель, хотя Prophecy of Water висит 3 ч
assert.deepEqual([...B.faWanted()], []);
assert.equal(B.catNoFa(), true);
B.cancelNote(['[Lilim Priest] зняв з вас 3 бафи.'], 'Lilim Priest', { dungeon: 'necropolis_of_devotion' });
assert.equal(B.cancelRisk('Lilim Priest', false), null);
assert.match(recs.pop(), /таких мобов бью дальше/);
// 2. вне катакомб — прежнее: свой список покупается, при платном FA такой моб не цель
mode = 'farm';
assert.ok(B.faWanted().includes(1357));
assert.ok(B.cancelRisk('Lilim Priest', false));
// 3. галка выключена — в катакомбах как везде
mode = 'cat'; env.cfg.catNoFa = false;
assert.ok(B.faWanted().includes(1357));
assert.ok(B.cancelRisk('Lilim Priest', false));
const def = fs.readFileSync(path.join(root, 'defaults.js'), 'utf8');
assert.match(def, /catNoFa: true/);
assert.match(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), /id="catNoFa" type="checkbox"/);
console.log('v2016-cat-no-fa PASS');
