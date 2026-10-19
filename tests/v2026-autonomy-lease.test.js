'use strict';
// 19.10.2026: связка фон → storage.onChanged → ответ IPC, а не изолированные mocks lease.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.L2_REPO || path.resolve(__dirname, '..');
const bgSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const { createPatchQueue } = require(path.join(root, 'engine-core.js'));
const clone = value => structuredClone(value);
const cut = (source, begin, end) => {
  const i = source.indexOf(begin), j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'Фрагмент исходника: ' + begin);
  return source.slice(i, j);
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(order = 'before') {
  let now = 1000000, seq = 0, failed = false, replyGate = null, clearing = 0;
  const state = { on: true, lock: { k: 'tab1', tab: 1, epoch: 'old', t: now - 120000, vis: false },
    rt: { char: 'Hero', kills: 8 }, cfg: {} };
  const events = [], sent = [];
  const page = { Date: { now: () => now }, on: true, tabOwner: true, tabIdle: false,
    leaseEpoch: 'old', documentLease: 'old', window: { __lockT: now },
    location: { pathname: '/map.html' }, document: { hasFocus: () => false }, tabVis: () => false, quietErr() {} };
  vm.createContext(page);
  const eventSource = cut(content, '  if (ch.lock &&', '  if (ch.learn');
  const deliver = change => { page.ch = change; vm.runInContext(eventSource, page); };
  const background = { Date: { now: () => now }, URL, crypto: { randomUUID: () => 'lease-' + (++seq) },
    noteAlive: async () => {}, console: { warn() {} },
    chrome: { storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, clone(state[k])])),
      set: async patch => {
        const old = clone(state.lock); Object.assign(state, clone(patch));
        if (Object.hasOwn(patch, 'lock')) {
          const change = { lock: { oldValue: old, newValue: clone(state.lock) } };
          if (order === 'before') deliver(change); else events.push(change);
        }
      }
    } }, tabs: { update: async () => {}, sendMessage: async () => {} } } };
  vm.createContext(background);
  vm.runInContext(cut(bgSource, 'const LOCK_TTL =', '// A single process owns') +
    cut(bgSource, 'function retireRaidSessionPatch(', '// Popup writes') +
    cut(bgSource, 'function pvpSeedPatch(', 'async function menuPatch('), background);
  const sender = id => ({ frameId: 0, url: 'https://l2wap.com/map.html', tab: { id } });
  page.ipc = async message => {
    const result = await background.lockCommand(message, sender(1));
    if (replyGate && message.cmd === 'lockAcquire') { replyGate.ready.resolve(); await replyGate.release.promise; }
    return result;
  };
  page.rtWriter = createPatchQueue(async patch => {
    sent.push(clone(patch));
    if (!failed) { failed = true; return { ok: false, reason: 'temporary_storage_failure' }; }
    return background.statePatch({ patch, expectedChar: 'Hero', epoch: page.leaseEpoch, src: 'test' }, sender(1));
  }, () => page.on && page.tabOwner && !!page.leaseEpoch, () => {}, () => now);
  const clear = page.rtWriter.clear;
  page.rtWriter.clear = () => { clearing++; clear(); };
  vm.runInContext(cut(content, 'async function renewResume(', 'setInterval(async () => {'), page);
  return { state, page, background, sent, sender, get clearing() { return clearing; },
    pending: async () => { assert.equal((await page.rtWriter.enqueue({ kills: 9 })).ok, false); now += 4000; },
    events: () => { while (events.length) deliver(events.shift()); },
    holdReply: () => (replyGate = { ready: deferred(), release: deferred() }),
    acquire: (id, message = {}) => background.lockCommand({ cmd: 'lockAcquire', page: '/map.html', ...message }, sender(id)) };
}

for (const order of ['before', 'after']) {
  test('Свой протухший lease: storage event ' + order + ' reply сохраняет и дописывает очередь', async () => {
    const f = fixture(order); await f.pending();
    assert.equal(await f.page.renewResume(), true);
    f.events(); await settle();
    assert.equal(f.clearing, 0); assert.equal(f.page.tabOwner, true);
    assert.equal(f.state.lock.epoch, f.page.leaseEpoch);
    assert.equal(f.state.rt.kills, 9); assert.deepEqual(f.page.rtWriter.peek(), {});
    assert.deepEqual(f.sent, [{ kills: 9 }, { kills: 9 }]);
  });
  test('Новый документ в той же вкладке: storage event ' + order + ' reply отзывает старый lease', async () => {
    const f = fixture(order); await f.pending();
    const next = await f.acquire(1, { epoch: null }); f.events();
    assert.equal(next.ok, true); assert.equal(next.resumed, false); assert.notEqual(next.epoch, 'old');
    assert.equal(f.page.tabOwner, false); assert.equal(f.clearing, 1);
    for (const cmd of ['lockAcquire', 'lockRenew', 'lockRelease', 'lockCheck'])
      assert.equal((await f.background.lockCommand({ cmd, epoch: 'old' }, f.sender(1))).ok, false, cmd);
    assert.equal((await f.background.statePatch({ patch: { kills: 999 }, expectedChar: 'Hero', epoch: 'old' }, f.sender(1))).ok, false);
    assert.equal(f.state.rt.kills, 8); assert.equal(f.state.lock.epoch, next.epoch);
  });
  test('Чужая передача во время ответа resume, event ' + order + ' reply, не возвращает старого хозяина', async () => {
    const f = fixture(order); await f.pending(); const gate = f.holdReply();
    const pending = f.page.renewResume(); await gate.ready.promise;
    const next = await f.acquire(2, { vis: true, focus: true }); f.events();
    assert.equal(next.ok, true); gate.release.resolve();
    assert.equal(await pending, 'moved'); await settle();
    assert.equal(f.page.tabOwner, false); assert.equal(f.page.leaseEpoch, null);
    assert.equal(f.state.lock.k, 'tab2'); assert.equal(f.state.lock.epoch, next.epoch);
    assert.equal(f.state.rt.kills, 8); assert.equal(f.sent.length, 1);
  });
}

test('Чужой живой lease не перехватывается возвратом своего старого', async () => {
  const f = fixture(); await f.pending();
  f.state.lock = { k: 'tab2', tab: 2, epoch: 'other', t: 1004000, vis: false };
  assert.equal(await f.page.renewResume(), false);
  assert.equal(f.state.lock.epoch, 'other'); assert.equal(f.state.rt.kills, 8);
});

test('После перезапуска worker свой протухший lease восстанавливается из storage', async () => {
  const f = fixture(); await f.pending();
  vm.runInContext('lockQueue = Promise.resolve(); leaseSeq = 0;', f.background);
  assert.equal(await f.page.renewResume(), true); await settle();
  assert.equal(f.state.lock.epoch, 'old'); assert.equal(f.state.rt.kills, 9); assert.equal(f.clearing, 0);
});
