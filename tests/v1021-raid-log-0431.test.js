'use strict';
// Лог 15.10 04:31: победа доказана до дедлайна, запись rt задержалась; нельзя бросать РБ с 29% HP.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { mk } = require('./epic-harness.cjs');
const src = fs.readFileSync(__dirname + '/../modules/raid.js', 'utf8');
test('доказанная победа отменяет дедлайн пробы ещё до сохранения rt', () => {
 let now = 1000000;
 const Clock = class extends Date { static now() { return now; } };
 const m = mk({ hero: 77, cfg: { epicMode: false, rbHuntMode: false, rbMaxKillMin: 20, stopHp: 25, rbRetreatHp: 20 },
  rt: { rbDb: { boss: { probe: { kind: 'dps', t: now } } }, rbStats: { boss: { hp: 5500000, patk: 5000 } } },
  env: { epicOn: () => false, logLines: () => [], activeBuffs: () => [], potModel: () => ({ n: 850, H: 1200, C: 1, rate: 1200, pool: 1020000, est: false, items: [] }),
   warlock: { raidContext: () => ({ managed: true, key: 'same', powerKey: 'same' }) } } });
 const original = m.env.setRt;
 m.env.setRt = async patch => { if (patch.rbDb?.boss?.probe?.done) return; return original(patch); };
 const box = { console, Date: Clock, Math, Number }; vm.runInNewContext(src, box);
 const raid = box.L2V7Factories.raid(m.env);
 const ctx = { name: 'Boss', rb: { id: 'boss', samples: [], hits: [] } };
 let verdict;
 for (let i = 0; i <= 32; i++) {
  now = 1000000 + i * 1000;
  if (i && i % 3 === 0) ctx.rb.hits.push(210);
  verdict = raid.rbAssess(ctx, { max: 14917, cur: 14917 - i * 20, pct: 98 }, { max: 5500000, cur: 5500000 - i * 67000 });
  if (i === 27) assert.equal(ctx.rb.probeConfirmed, true);
 }
 assert.equal(m.env.rt.rbDb.boss.probe.done, undefined, 'запись подтверждения всё ещё ожидает');
 assert.equal(verdict.abort, undefined, 'старый дедлайн не заставляет покинуть выигрышный бой');
});
test('карта не нажимает ссылку другого РБ при активной цели тура', () => {
 assert.match(fs.readFileSync(__dirname + '/../modules/mobfarm.js', 'utf8'), /env\.cfg\.rbHuntMode && env\.rt\.rbHunt\?\.step === 'fight' && c\.id !== env\.rt\.rbHunt\.id/);
 assert.match(src, /active: \(\) => active\(\) && env\.rt\.rbHunt\?\.step === 'fight' && env\.rt\.rbHunt\?\.id === H\.id/);
});
