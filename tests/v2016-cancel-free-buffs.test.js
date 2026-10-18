'use strict';
// 20.16 (лог 18.10 19:55–21:25, игрок: «сильно замедлился в фарме»): в Necropolis of Devotion все виды снимают баффы. После шести снятий
// (последние три — уже без платных FA) бот записал «110 снимают баффы — жду» и полтора часа стоял в подземелье без боёв.
// Обычный моб опасен только платным баффам за FA: без них снятие стоит одного похода к бесплатному бафферу — такого моба бьём.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let hud = [];
const box = { querySelectorAll: () => hud.map(([id, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => '' })) };
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/dungeon.html', href: '' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/buffs.js'), 'utf8'), sb);
const recs = [], now = Date.now(), H3 = now + 3 * 3600000;
const env = { cfg: { noCancelMobs: true }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? box : null, TB_KEYS: { basic: [1068, 1268, 1086, 1045] }, IL: {},
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: { 1357: ['Prophecy of Water', 5] }, faCost: () => 1, sleep: async () => {} };
const B = sb.L2V7Factories.buffs(env);
// 1. снятие при платном FA: моб запомнен и не цель, пока FA висит
hud = [[1068, H3], [1357, H3]];
assert.equal(B.cancelNote(['[Nephilim Centurion] зняв з вас 3 бафи.'], 'Nephilim Centurion', { dungeon: 'necropolis_of_devotion' }), 3);
assert.match(recs.pop(), /платных за FA осталось 1; .*пока висят платные баффы за FA, такого не выбираю/);
assert.ok(B.cancelRisk('Nephilim Centurion', false), 'paid FA on → avoid');
// 2. платные кончились (как в логе после 19:47): тот же моб снова цель, снятие — только поход к бесплатному бафферу
hud = [[1068, H3]];
assert.equal(B.cancelRisk('Nephilim Centurion', false), null, 'no paid FA → fight');
assert.equal(B.cancelNote(['[Lilim Priest] зняв з вас 3 бафи.'], 'Lilim Priest'), 3);
assert.match(recs.pop(), /платных баффов за FA нет — таких мобов бью дальше/);
assert.ok(env.rt.buffCancel['lilim priest'], 'memory still kept for later paid sessions');
// платный FA с запасом < 10 мин не держит
hud = [[1357, now + 5 * 60000]];
assert.equal(B.cancelRisk('Lilim Priest', false), null);
// 3. шапку не прочитать — по-старому осторожно
env.$q = () => null;
assert.ok(B.cancelRisk('Lilim Priest', false), 'unknown HUD → avoid as before');
env.$q = s => s === '#l2-hud-active-buffs' ? box : null;
// 4. галка выключена — прежнее правило «избегать всегда»
hud = [[1068, H3]]; env.cfg.cancelFreeOk = false;
assert.ok(B.cancelRisk('Lilim Priest', false));
delete env.cfg.cancelFreeOk;
// 5. умолчание и меню
const def = fs.readFileSync(path.join(root, 'defaults.js'), 'utf8'), ph = fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), pj = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
assert.match(def, /cancelFreeOk: true/);
assert.match(ph, /id="cancelFreeOk" type="checkbox"/);
assert.match(pj, /'noCancelMobs', 'cancelFreeOk'/);
console.log('v2016-cancel-free-buffs PASS');
