'use strict';
// 20.14.1 (лог 18.10 18:32–18:33): сторож взял городской «basic» (наложен, всё в шапке), через 30 с тур РБ попросил полный набор FA —
// бот записал «после баффера баффы так и не появились в шапке (1/3)» и ждал баффера 24 с. Прошлый поход удался, просто нужны другие баффы.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
let hud = [];
const box = { querySelectorAll: () => hud.map(([id, exp]) => ({ dataset: { skillId: String(id), expiresAt: String(exp) }, getAttribute: () => '' })) };
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html', href: '' } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/buffs.js'), 'utf8'), sb);
const recs = [], now = Date.now(), H24 = now + 24 * 3600000;
const env = { cfg: { townBuffSet: 'basic', faBuffs: '1388' }, rt: {}, $q: s => s === '#l2-hud-active-buffs' ? box : null, TB_KEYS: { basic: [1068, 1268, 1045] }, IL: {},
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), FA_KNOWN: { 1388: ['Greater Might', 1] }, faCost: () => 1, sleep: async () => {} };
const B = sb.L2V7Factories.buffs(env);
(async () => {
  // 1. сторож: городского набора нет → поход, запомнено, за чем шли
  hud = [];
  assert.equal(await B.townBuffStart('сторож: баффы слетели'), true);
  assert.deepEqual([...env.rt.tbWant].sort(), [1045, 1068, 1268, 1388].sort(), 'visit remembers what it went for');
  // 2. поход удался только частично для нового плана: городской висит, FA 1388 нет — после 41 с не «не появились», к бафферу сразу
  env.rt.tbWant = [1068, 1268, 1045]; env.rt.tbT = now - 41000; env.rt.tbOk = true; delete env.rt.tbChk; delete env.rt.tbFail; recs.length = 0;
  hud = [[1068, H24], [1268, H24], [1045, H24]];
  assert.equal(await B.townBuffStart('перед РБ Soulless Wild Boar', true), true, 'new need → buffer right away');
  assert.doesNotMatch(recs.join('\n'), /так и не появились|к бафферу через/);
  assert.ok(!env.rt.tbFail, 'not a failed visit');
  assert.match(recs.join('\n'), /перед РБ Soulless Wild Boar.*FA 1388/);
  // 3. прежнее правило сохранено: то, за чем шли, так и не появилось → неудача (1/3)
  env.rt.tbWant = [1068, 1268, 1045]; env.rt.tbT = now - 41000; delete env.rt.tbChk; delete env.rt.tbFail; delete env.rt.tbWaitSaid; recs.length = 0;
  hud = [[1068, H24]];
  assert.equal(await B.townBuffStart('сторож: баффы слетели'), false);
  assert.match(recs.join('\n'), /так и не появились в шапке \(1\/3\)/);
  console.log('PASS: 20.14.1 buffer visit that succeeded is not counted as failed when a new plan (FA before RB) needs other buffs; goes right away');
})().catch(e => { console.error(e); process.exit(1); });
