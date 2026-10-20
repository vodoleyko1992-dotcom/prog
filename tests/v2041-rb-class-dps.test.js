'use strict';
// 20.41 (лог 20.10 21:09:44): Bounty Hunter 71 (слот 1) взял legacy rt.rbDps Warlock без контекста → Sobekk 3.6M «≈1:45»,
// реально ≈2,1k/с (≈23–25 мин). Общий ДПС/потери по РБ — только своего класса; основной слот сохраняет старый замер.
const assert = require('node:assert/strict');
const { mk } = require('./epic-harness.cjs');
const SOB = 'l2dop_rb_25202', ST = { hp: 3580306, patk: 11037, pdef: 7618, matk: 7213, mdef: 9663 };
const BH = { prof: 'dwarf_bounty_hunter', slot: 1 };
(async () => {
  // 1. legacy 40k/с без владельца при известном классе — не свой; осторожно 1150 × поправка
  const m = mk({ hero: 71, cfg: { epicMode: false, rbHuntMode: true }, meHp: () => ({ max: 21188, cur: 21188, pct: 100 }),
    rt: { classCur: BH, rbDps: 40000, rbDpsContext: null, rbLossK: 0.0134, rbList: { [SOB]: { lvl: 74, alive: true } }, rbDb: {} } });
  m.env.rt.rbStats = { [SOB]: { ...ST } };
  assert.ok(m.R.rbDpsOn(SOB) <= 1150, 'foreign legacy dps ignored: ' + m.R.rbDpsOn(SOB));
  assert.equal(m.R.rbDpsEvidence(SOB).source, 'unknown');
  const pc = m.R.rbPreCheck(SOB, { ...ST });
  assert.equal(pc.kind, 'slow', 'Sobekk 3.6M without own DPS → долгий бой: ' + pc.why);
  // 2. свой общий замер класса — используется
  Object.assign(m.env.rt, { rbDps: 2400, rbDpsOwner: BH.prof });
  assert.equal(Math.round(m.R.rbDpsOn(SOB)), Math.round(2400 * 0.85));
  // 3. класс неизвестен (старые профили/тесты) — прежнее поведение
  delete m.env.rt.classCur; m.env.rt.rbDps = 40000; delete m.env.rt.rbDpsOwner;
  assert.equal(Math.round(m.R.rbDpsOn(SOB)), Math.round(40000 * 0.85));
  // 4. CLASS_KEYS содержит общий ДПС/потери
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'modules/story.js'), 'utf8');
  for (const k of ['rbDps', 'rbDpsContext', 'rbDpsOwner', 'rbLossK', 'rbLossKOwner']) assert.match(src.match(/const CLASS_KEYS = \[[^\]]+\]/)[0], new RegExp(`'${k}'`));
  // 5. основной слот (0): замер без владельца — его собственный (до 20.41 владелец не писался)
  Object.assign(m.env.rt, { classCur: { prof: 'dwarf_warsmith', slot: 0 }, rbDps: 40000 });
  assert.equal(Math.round(m.R.rbDpsOn(SOB)), Math.round(40000 * 0.85));
  // 6. разовый перенос: замер без владельца у саба уходит в память основного класса
  const c = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(c, /once\('rbDpsClass2041'/);
  console.log('PASS v2041-rb-class-dps');
})().catch(e => { console.error(e); process.exit(1); });
