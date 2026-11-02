'use strict';
// botfarm unit checks (node sandbox, no browser): the server's attacks-per-day limit on a target
// («Превышен лимит количества атак в сутки на данный пункт назначения.») -> 24 h pause of that target, journaled once, other targets
// go on; spy probes = the suite setting spy.probes (OGX.api.spyProbes, else OGX.settings, default 1100).
//   node tests/gz-bot-farm-limits.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('./lib');
const { assert } = T;

const ROOT = path.resolve(__dirname, '..');
const FILES = ['shared/core/00-ogx.js', 'shared/core/01-util.js', 'shared/core/08-catalog-data.js', 'shared/core/09-catalog.js', 'shared/core/10-calc.js',
  'ogamex-bot/modules/botsim/botsim.js', 'ogamex-bot/modules/botfarm/botfarm.js'];
function sandbox(pre) {
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
    if (f === 'shared/core/00-ogx.js' && pre) pre(sb.OGX);
  }
  return sb;
}
const LIMIT_MSG = 'Превышен лимит количества атак в сутки на данный пункт назначения.';
const H = 3600000;

function wctxAt(t) {
  const journal = [];
  return { journal, now: () => t.now, cfg: () => undefined, rec: (ev, what, data) => journal.push({ ev, what, data }) };
}

T.test('attack-per-day limit: target paused 24 h (state attackLimit, persisted on the target), journaled once, the cycle goes on', () => {
  const sb = sandbox();
  const L = sb.OGX.botFarm._lib;
  const clock = { now: Date.UTC(2026, 10, 1, 10) };
  const w = wctxAt(clock);
  const Tg = { key: '2:60:8:1', coords: '2:60:8', state: 'reported' };
  assert.equal(L.isAttackLimit({ ok: false, error: 'step3', message: LIMIT_MSG }), true);
  assert.equal(L.isAttackLimit({ ok: false, error: LIMIT_MSG }), true);
  assert.equal(L.isAttackLimit({ ok: false, message: 'Недостаточно топлива' }), false);
  const r1 = L.handleRefusal(w, Tg, { ok: false, error: 'step3', message: LIMIT_MSG }, 'атака');
  assert.equal(r1.stop, false, 'other targets are still planned');
  assert.equal(r1.attackLimit, true);
  assert.equal(Tg.state, 'attackLimit');
  assert.equal(Tg.cooldownUntil, clock.now + 24 * H, '24 h pause');
  assert.ok(/лимит атак/.test(Tg.note));
  const n = w.journal.length;
  assert.equal(w.journal.filter((e) => e.ev === 'cooldown').length, 1);
  clock.now += 60000;
  L.handleRefusal(w, Tg, { ok: false, message: LIMIT_MSG }, 'атака');
  assert.equal(w.journal.length, n, 'a second answer within the pause is not journaled again');
  assert.equal(Tg.cooldownUntil, clock.now - 60000 + 24 * H, 'the pause is not extended');
  // the limit wins over a botcore refusal class that would stop the whole cycle
  const T2 = { key: '2:60:9:1', coords: '2:60:9', state: 'reported' };
  assert.equal(L.handleRefusal(w, T2, { ok: false, refused: 'limit', message: LIMIT_MSG }, 'атака').stop, false);
  assert.equal(T2.state, 'attackLimit');
  // other errors keep their old handling
  const T3 = { key: '2:60:10:1', coords: '2:60:10', state: 'reported' };
  L.handleRefusal(w, T3, { ok: false, error: 'step3', message: 'что-то ещё' }, 'атака');
  assert.equal(T3.state, 'notSuitable');
  assert.equal(T3.cooldownUntil, clock.now + 30 * 60000);
});

T.test('planning skips a target in its attack-limit pause, and the pause ends after 24 h (source rules)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(/filter\(\(T\) => !\(T\.cooldownUntil && T\.cooldownUntil > now\)\)/.test(src), 'planning list drops paused targets');
  // 0.3.2: 'gone' is no longer reset by the timer (only a newer galaxy view that shows the planet); poor / needFleet are
  assert.ok(/\['notSuitable', 'vacation', 'probesLost', 'attackLimit', 'needFleet', 'poor'\]\.includes\(T\.state\)/.test(src), 'attackLimit returns to new after the pause');
});

T.test('spy probes = spy.probes: OGX.api.spyProbes, else OGX.settings.get(spy.probes), else 1100', () => {
  assert.equal(sandbox((O) => { O.api = { spyProbes: () => 555 }; }).OGX.botFarm._lib.spyProbesSetting(), 555);
  assert.equal(sandbox((O) => { O.settings = { get: (k) => (k === 'spy.probes' ? '33' : undefined) }; }).OGX.botFarm._lib.spyProbesSetting(), 33);
  assert.equal(sandbox((O) => { O.settings = { get: () => null }; }).OGX.botFarm._lib.spyProbesSetting(), 1100);
  const L = sandbox((O) => { O.settings = { get: (k) => (k === 'spy.probes' ? 1100 : undefined) }; }).OGX.botFarm._lib;
  assert.equal(L.probesFor({ ourSpy: 12, theirSpy: 3, theirSpyKnown: true }).probes, 1100, 'probesFor defaults to the setting');
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botfarm/botfarm.js'), 'utf8');
  assert.ok(!/probesFirst/.test(src), 'no module probe count (probesFirst) left');
});

T.test('botcore: the attack-limit answer of step 3 is a refusal (attackLimit), not an error that feeds the error streak', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ogamex-bot/modules/botcore/botcore.js'), 'utf8');
  const m = src.match(/function mapStep3Text\(text\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'mapStep3Text found');
  const map = vm.runInNewContext('(' + m[0] + ')');
  assert.equal(map(LIMIT_MSG), 'attackLimit');
  assert.equal(map('Нет свободных слотов флота'), 'slots');
  assert.equal(map('что-то ещё'), 'other');
  assert.ok(/\['slots', 'fuel', 'cargo', 'ships', 'attackLimit'\]\.includes\(kind\)/.test(src), 'step 3 returns attackLimit as refused (refusals never call registerError)');
});
