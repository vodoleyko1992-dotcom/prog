'use strict';
// 19.10.2026: финальный flush после Stop и гонки с новой сессией, без игры.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.L2_REPO || path.resolve(__dirname, '..');
const bgSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const E = require(path.join(root, 'engine-core.js')), { createPatchQueue } = E;
const clone = value => structuredClone(value);
const cut = (source, begin, end, from = 0) => {
  const i = source.indexOf(begin, from), j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'Фрагмент исходника: ' + begin); return source.slice(i, j);
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
  let now = 1000000, failures = 1, listener, tick, hotkey, writeGate = null, releaseGate = null;
  const state = { on: false, lock: { k: 'tab1', tab: 1, epoch: 'lease', t: now, vis: false }, rt: { char: 'Hero', kills: 7 }, cfg: {} };
  const releases = [], writes = [], errors = [];
  const page = { Date: { now: () => now }, on: false, tabOwner: true, tabIdle: false, leaseEpoch: 'lease',
    rt: clone(state.rt), cfg: {}, DEF_RT: {}, TAB_ID: 'test', automationGeneration: 0, window: {},
    enchantCommandBusy: false, warlockCommandBusy: false, lifestoneCommandBusy: false, mammonBagCommandBusy: false,
    L2V7Modules: { lifestone: { interrupt() {} }, mammon: { bagAuto: async () => {} } },
    enchantModePause: async () => {}, draw() {}, dock() {}, rec() {}, abBlink() {}, main() {},
    ownCfgChange: () => false, viewOnlyCfgChange: () => false, modeSig: () => '', mergeCfg: x => x,
    quietErr: (...args) => errors.push(args), setInterval: fn => { tick = fn; },
    chrome: { storage: { onChanged: { addListener: fn => { listener = fn; } } }, runtime: {} } };
  vm.createContext(page);
  const bg = { L2EngineCore: E, Date: { now: () => now }, URL, crypto: { randomUUID: () => 'new' }, noteAlive: async () => {},
    console: { warn() {} }, chrome: { storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, clone(state[k])])),
      set: async patch => {
        const changes = Object.fromEntries(Object.keys(patch).map(k => [k, { oldValue: clone(state[k]), newValue: clone(patch[k]) }]));
        Object.assign(state, clone(patch)); listener(changes);
      }
    } }, tabs: { update: async () => {}, sendMessage: async () => {} } } };
  vm.createContext(bg);
  vm.runInContext(cut(bgSource, 'const LOCK_TTL =', '// A single process owns') +
    cut(bgSource, 'function retireRaidSessionPatch(', '// Popup writes') +
    cut(bgSource, 'function pvpSeedPatch(', 'async function menuPatch('), bg);
  bg.chrome.commands = { onCommand: { addListener: fn => { hotkey = fn; } } };
  vm.runInContext(cut(bgSource, 'chrome.commands?.onCommand.addListener(', '// ===== журнал'), bg);
  const sender = id => ({ frameId: 0, url: 'https://l2wap.com/map.html', tab: { id } });
  page.rtWriter = createPatchQueue(async patch => {
    const message = { patch, expectedChar: page.rt.char || '', epoch: page.leaseEpoch, src: page.TAB_ID };
    writes.push(clone(message));
    if (writeGate) { const held = writeGate; writeGate = null; held.ready.resolve(); await held.release.promise; }
    if (failures > 0) { failures--; return { ok: false, reason: 'temporary_storage_failure' }; }
    return bg.statePatch(message, sender(1));
  }, () => !page.tabIdle && (!page.on || page.tabOwner && !!page.leaseEpoch), () => {}, () => now);
  page.chrome.runtime.sendMessage = async message => {
    releases.push(clone(message));
    if (releaseGate) { const held = releaseGate; releaseGate = null; held.ready.resolve(); await held.release.promise; }
    return bg.lockCommand(message, sender(1));
  };
  vm.runInContext(cut(content, 'chrome.storage.onChanged.addListener(ch => {\n', '// v5.5.9: игра заранее') +
    cut(content, 'setInterval(async () => {', '}, 5000);', content.indexOf('async function renewResume(')) + '}, 5000);', page);
  return { state, page, bg, releases, writes, errors, sender, tick: () => tick(), hotkey: () => hotkey('toggle-bot'),
    advance: (ms = 4000) => { now += ms; }, fail: n => { failures = n; },
    holdWrite: () => (writeGate = { ready: deferred(), release: deferred() }),
    holdRelease: () => (releaseGate = { ready: deferred(), release: deferred() }),
    event: patch => bg.chrome.storage.local.set(patch),
    pending: async () => { assert.equal((await page.rtWriter.enqueue({ kills: 8 })).ok, false); } };
}

test('Stop: backoff сохраняет очередь; следующий тик дописывает её и освобождает lease', async () => {
  const f = fixture(); await f.pending(); await f.tick();
  assert.deepEqual(f.page.rtWriter.peek(), { kills: 8 }); assert.equal(f.page.tabOwner, true); assert.equal(f.releases.length, 0);
  f.advance(); await f.tick();
  assert.equal(f.state.rt.kills, 8); assert.equal(f.page.tabOwner, false); assert.equal(f.state.lock, null);
  assert.deepEqual(f.page.rtWriter.peek(), {}); assert.equal(f.writes.length, 2); assert.equal(f.releases.length, 1);
});

test('Новая запись после успешного recover сохраняется при повторном отказе до release', async () => {
  const f = fixture(); f.fail(0); const held = f.holdWrite(); let followup;
  const first = f.page.rtWriter.enqueue({ kills: 8 });
  first.then(() => { f.fail(1); followup = f.page.rtWriter.enqueue({ fish: { casts: 9 } }); });
  await held.ready.promise; const stopped = f.tick(); held.release.resolve();
  await stopped; assert.equal((await followup).reason, 'write_failed');
  assert.equal(f.state.rt.kills, 8); assert.equal(f.state.rt.fish, undefined);
  assert.deepEqual(f.page.rtWriter.peek(), { fish: { casts: 9 } });
  assert.equal(f.page.tabOwner, true); assert.equal(f.releases.length, 0);
  f.advance(); await f.tick();
  assert.deepEqual(f.state.rt.fish, { casts: 9 }); assert.deepEqual(f.page.rtWriter.peek(), {});
  assert.equal(f.page.tabOwner, false); assert.equal(f.state.lock, null); assert.equal(f.releases.length, 1);
});

test('Start во время recover сохраняет владельца новой сессии', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdWrite();
  const work = f.tick(); await held.ready.promise; await f.event({ on: true }); held.release.resolve(); await work;
  assert.equal(f.page.tabOwner, true); assert.equal(f.page.leaseEpoch, 'lease'); assert.equal(f.releases.length, 0);
  assert.equal(f.state.rt.kills, 8); assert.equal(f.state.lock.epoch, 'lease');
});

test('Поздний release после нового Start отклоняется фоном и не стирает локальный epoch', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdRelease();
  const work = f.tick(); await held.ready.promise; await f.event({ on: true });
  f.page.tabOwner = true; f.page.leaseEpoch = 'lease'; held.release.resolve(); await work;
  assert.equal(f.state.lock.epoch, 'lease'); assert.equal(f.page.tabOwner, true); assert.equal(f.page.leaseEpoch, 'lease');
});

test('Старый release после Start → Stop не очищает очередь нового запуска с тем же epoch', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdRelease();
  const oldStop = f.tick(); await held.ready.promise;
  await f.event({ on: true, rt: { ...f.state.rt, manualKickAt: 99, _src: 'menu' } });
  const next = await f.bg.lockCommand({ cmd: 'lockAcquire', epoch: 'lease', vis: true, focus: true }, f.sender(1));
  assert.equal(next.ok, true); assert.equal(next.epoch, 'lease');
  f.page.tabOwner = true; f.page.leaseEpoch = next.epoch;
  await f.event({ on: false }); f.fail(1);
  assert.equal((await f.page.rtWriter.enqueue({ fish: { casts: 9 } })).ok, false);
  held.release.resolve(); await oldStop;
  assert.equal(f.state.lock?.epoch, 'lease'); assert.equal(f.page.tabOwner, true);
  assert.deepEqual(f.page.rtWriter.peek(), { fish: { casts: 9 } });
  f.advance(); await f.tick();
  assert.deepEqual(f.state.rt.fish, { casts: 9 }); assert.equal(f.state.lock, null);
});

test('Горячая клавиша Start → Stop тоже отменяет release прежнего запуска', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdRelease();
  const oldStop = f.tick(); await held.ready.promise; await f.hotkey();
  const next = await f.bg.lockCommand({ cmd: 'lockAcquire', epoch: 'lease', vis: true, focus: true }, f.sender(1));
  assert.equal(next.ok, true); f.page.tabOwner = true; f.page.leaseEpoch = next.epoch;
  await f.hotkey(); f.fail(1); await f.page.rtWriter.enqueue({ fish: { casts: 9 } });
  held.release.resolve(); await oldStop;
  assert.equal(f.state.lock?.epoch, 'lease'); assert.equal(f.page.tabOwner, true);
  assert.deepEqual(f.page.rtWriter.peek(), { fish: { casts: 9 } });
  f.advance(); await f.tick(); assert.deepEqual(f.state.rt.fish, { casts: 9 }); assert.equal(f.state.lock, null);
});

test('Горячая клавиша Start задаёт новый kick и dailyStart, сохраняя профиль и резерв оплаты', async () => {
  const f = fixture(), reserve = { pending: { id: 'unknown', char: 'Hero', phase: 'prepared' } };
  await f.event({ rt: { ...f.state.rt, manualKickAt: 2000000, dailyStart: 3,
    dailyServerCheck: { day: '2026-10-19', char: 'Hero', start: 3 }, actionPayments: reserve, _src: 'menu' } });
  await f.event({ rt: { ...f.state.rt, _src: f.page.TAB_ID } });
  const cfg = clone(f.state.cfg), previousCheck = clone(f.state.rt.dailyServerCheck);
  await f.hotkey();
  assert.equal(f.state.on, true); assert.equal(f.state.rt.manualKickAt, 2000001);
  assert.equal(f.page.rt.manualKickAt, 2000001, 'свой прежний _src не скрывает новый kick');
  assert.equal(f.state.rt.dailyStart, 4); assert.equal(f.page.rt.dailyStart, 4);
  assert.notEqual(f.state.rt.dailyServerCheck.start, f.state.rt.dailyStart, 'Start требует новой серверной сверки');
  assert.deepEqual(f.state.rt.dailyServerCheck, previousCheck); assert.deepEqual(f.state.rt.actionPayments, reserve);
  assert.deepEqual(f.state['rt@Hero'], f.state.rt); assert.deepEqual(f.state.cfg, cfg);
  await f.hotkey(); assert.equal(f.state.on, false); assert.equal(f.state.rt.dailyStart, 4);
  await f.hotkey(); assert.equal(f.state.rt.manualKickAt, 2000002); assert.equal(f.state.rt.dailyStart, 5);
  assert.deepEqual(f.state['rt@Hero'], f.state.rt);
});

test('Чужой lease во время OFF-recover отзывает очередь и отклоняет старую запись на фоне', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdWrite();
  const work = f.tick(); await held.ready.promise;
  const other = await f.bg.lockCommand({ cmd: 'lockAcquire', vis: true, focus: true }, f.sender(2));
  assert.equal(other.ok, true); held.release.resolve(); await work;
  assert.equal(f.state.lock.epoch, other.epoch); assert.equal(f.state.rt.kills, 7);
  assert.equal(f.page.tabOwner, false); assert.equal(f.page.leaseEpoch, null); assert.equal(f.releases.length, 0);
});

test('Смена героя во время recover не освобождает lease и не дописывает чужие счётчики', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdWrite();
  const work = f.tick(); await held.ready.promise;
  await f.event({ rt: { char: 'Other', kills: 100, _src: 'other' } }); held.release.resolve(); await work;
  assert.equal(f.state.rt.kills, 100); assert.equal(f.state.lock.epoch, 'lease'); assert.equal(f.releases.length, 0);
});

test('Постоянный отказ storage при OFF не продлевает lock: другая вкладка получает его после TTL', async () => {
  const f = fixture(); f.fail(100); await f.pending();
  for (let i = 0; i < 3; i++) { f.advance(35000); await f.tick(); }
  assert.equal(f.state.lock.t, 1000000); assert.deepEqual(f.page.rtWriter.peek(), { kills: 8 });
  const other = await f.bg.lockCommand({ cmd: 'lockAcquire', vis: false, focus: false }, f.sender(2));
  assert.equal(other.ok, true); assert.equal(f.page.tabOwner, false); assert.deepEqual(f.page.rtWriter.peek(), {});
});

test('Фон разрешает OFF flush после TTL без нового владельца, но не после освобождения lock', async () => {
  const f = fixture(); f.fail(0); f.advance(120000);
  assert.equal((await f.page.rtWriter.enqueue({ kills: 8 })).ok, true); assert.equal(f.state.rt.kills, 8);
  await f.event({ lock: null });
  const stale = await f.bg.statePatch({ patch: { kills: 999 }, expectedChar: 'Hero', epoch: 'lease' }, f.sender(1));
  assert.equal(stale.ok, false); assert.equal(f.state.rt.kills, 8);
});

test('Фон не освобождает lease после смены героя между flush и release', async () => {
  const f = fixture(); await f.pending(); f.advance(); const held = f.holdRelease();
  const work = f.tick(); await held.ready.promise;
  await f.event({ rt: { char: 'Other', kills: 100, _src: 'other' } }); held.release.resolve(); await work;
  assert.equal(f.state.lock.epoch, 'lease'); assert.equal(f.state.rt.kills, 100);
});
