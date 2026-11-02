'use strict';
// OGX.storage + OGX.settings: namespaces, coalescing, update serialisation, subscribe across two tabs,
// export/import with mergers, lock, nested settings shape, localStorage fallback.
//   node tests/core-storage.test.js
const T = require('./lib');
const { assert } = T;
const { coreExt } = require('./core-ext');

T.test('namespaces: player / server / global keys, copies', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    S.set('t.player', { a: 1 });
    S.set('t.server', 2, { scope: 'server' });
    S.set('t.global', 3, { scope: 'global' });
    await S.flush();
    return { ns: S.ns, keys: await S.keys('t.'), skeys: await S.keys('t.', { scope: 'server' }), gkeys: await S.keys('t.', { scope: 'global' }),
      full: [S.fullKey('x'), S.fullKey('x', { scope: 'server' }), S.fullKey('x', { scope: 'global' })], get: await S.get('t.player'), def: await S.get('missing', 7),
      namespaces: await S.namespaces() };
  });
  assert.deepEqual(r.ns, { ext: 'live', host: env.host, playerId: '108' });
  assert.deepEqual(r.full, [`${env.host}|108|x`, `${env.host}|*|x`, '*|*|x']);
  assert.deepEqual([r.keys, r.skeys, r.gkeys], [['t.player'], ['t.server'], ['t.global']]);
  assert.deepEqual([r.get, r.def], [{ a: 1 }, 7]);
  assert.ok(r.namespaces.some((n) => n.host === env.host && n.playerId === '108' && n.keys >= 1));
  assert.ok(r.namespaces.some((n) => n.host === env.host && n.playerId === '*'));
  const st = await env.storage();
  assert.deepEqual([st[env.key('t.player')], st[env.key('t.server', { scope: 'server' })], st[env.key('t.global', { scope: 'global' })]], [{ a: 1 }, 2, 3]);
  // boot wrote the player's bodies under the player namespace
  assert.ok(st[env.key('bodies')], 'bodies stored under <host>|108|');
  // get() returns copies
  const copy = await env.evalOgx(page, async () => { const a = await OGX.storage.get('t.player'); a.a = 99; return OGX.storage.get('t.player'); });
  assert.deepEqual(copy, { a: 1 });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('coalescing: many set() calls -> one backend write; update() is serialised per key', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    const fk = S.fullKey('t.coalesce');
    let writes = 0;
    chrome.storage.onChanged.addListener((ch) => { if (fk in ch) writes++; });
    for (let i = 1; i <= 10; i++) S.set('t.coalesce', i);
    const before = (await chrome.storage.local.get([fk]))[fk];
    const readBack = await S.get('t.coalesce');
    await new Promise((res) => setTimeout(res, 400));
    const after = (await chrome.storage.local.get([fk]))[fk];
    // update(): 25 concurrent increments must all land
    await Promise.all(Array.from({ length: 25 }, () => S.update('t.counter', (v) => v + 1, 0)));
    await S.flush();
    const counter = (await chrome.storage.local.get([S.fullKey('t.counter')]))[S.fullKey('t.counter')];
    // set() resolves when flushed
    await S.set('t.awaited', 'x');
    const awaited = (await chrome.storage.local.get([S.fullKey('t.awaited')]))[S.fullKey('t.awaited')];
    // remove
    await S.remove('t.awaited');
    const removed = (await chrome.storage.local.get([S.fullKey('t.awaited')]))[S.fullKey('t.awaited')];
    return { before: before === undefined ? null : before, readBack, after, writes, counter, awaited, removed: removed === undefined ? null : removed };
  });
  assert.deepEqual(r, { before: null, readBack: 10, after: 10, writes: 1, counter: 25, awaited: 'x', removed: null });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('failed backend write: the batch stays pending and is retried; a newer value wins; one journal line; degraded after 3 failures', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    const area = chrome.storage.local;
    const realSet = area.set.bind(area);
    let fail = 1; let calls = 0;
    const fake = function (obj, cb) { calls++; if (fail > 0) { fail--; return Promise.reject(new Error('QUOTA_BYTES quota exceeded')); } return realSet(obj, cb); };
    try { area.set = fake; } catch (e) { /* read-only */ }
    if (area.set !== fake) Object.defineProperty(area, 'set', { value: fake, configurable: true, writable: true });
    const fk = S.fullKey('t.retry');
    const events = [];
    OGX.bus.on('storage:degraded', () => events.push('degraded'));
    OGX.bus.on('storage:recovered', () => events.push('recovered'));
    await S.set('t.retry', { v: 1 });                                // the write fails
    const afterFail = { disk: (await chrome.storage.local.get([fk]))[fk] || null, get: await S.get('t.retry'), streak: S.failStreak() };
    await new Promise((res) => setTimeout(res, 1400));                // retried after 1 s
    const afterRetry = { disk: (await chrome.storage.local.get([fk]))[fk] || null, streak: S.failStreak() };
    // three failures in a row -> degraded once; a newer set() meanwhile is what lands
    fail = 3;
    await S.set('t.retry', { v: 2 });
    S.set('t.retry', { v: 3 });
    await new Promise((res) => setTimeout(res, 1300));
    await new Promise((res) => setTimeout(res, 2300));
    const midStreak = S.failStreak();
    await new Promise((res) => setTimeout(res, 5500));
    const final = { disk: (await chrome.storage.local.get([fk]))[fk] || null, streak: S.failStreak() };
    // a removed key is not resurrected by a failed write
    fail = 1;
    S.set('t.gone', 1);
    const pr = S.flush();
    await S.remove('t.gone');
    await pr;
    await new Promise((res) => setTimeout(res, 1400));
    const gone = (await chrome.storage.local.get([S.fullKey('t.gone')]))[S.fullKey('t.gone')];
    const journal = OGX.diag ? OGX.diag.recent({ s: 'S', k: 'storage' }).map((e) => e.w) : null;
    return { afterFail, afterRetry, midStreak, final, gone: gone === undefined ? null : gone, events, journal, calls };
  });
  assert.deepEqual(r.afterFail, { disk: null, get: { v: 1 }, streak: 1 }, 'failed write kept in memory');
  assert.deepEqual(r.afterRetry, { disk: { v: 1 }, streak: 0 }, 'persisted on the retry');
  assert.equal(r.midStreak, 3);
  assert.deepEqual(r.final, { disk: { v: 3 }, streak: 0 }, 'the newest value lands after the failures');
  assert.equal(r.gone, null, 'a removed key is not written back');
  assert.deepEqual(r.events.filter((e) => e === 'degraded'), ['degraded']);
  if (r.journal) assert.deepEqual(r.journal.filter((w) => w === 'write-failed').length, 3, 'one line per failure episode: ' + r.journal.join(','));
});

T.test('subscribe: a second tab sees the change (remote: true); own writes are local', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const a = await env.open('/overview');
  const b = await env.open('/overview', { newPage: true });
  await env.evalOgx(a, () => {
    window.__got = [];
    OGX.storage.subscribe('t.shared', (v, meta) => window.__got.push({ v, remote: meta.remote }));
    OGX.bus.on('storage:changed', (e) => { if (e.key === 't.shared') window.__got.push({ bus: e.value, remote: e.remote, scope: e.scope }); });
    return true;
  });
  await env.evalOgx(b, async () => { await OGX.storage.set('t.shared', { n: 1 }); return true; });
  await a.waitForTimeout(500);
  const remote = await env.evalOgx(a, async () => ({ got: window.__got, now: await OGX.storage.get('t.shared') }));
  assert.deepEqual(remote.got, [{ v: { n: 1 }, remote: true }, { bus: { n: 1 }, remote: true, scope: 'player' }]);
  assert.deepEqual(remote.now, { n: 1 }, 'cache updated from the other tab');
  const local = await env.evalOgx(a, async () => { window.__got = []; await OGX.storage.set('t.shared', { n: 2 }); await new Promise((r) => setTimeout(r, 300)); return window.__got; });
  assert.deepEqual(local, [{ v: { n: 2 }, remote: false }, { bus: { n: 2 }, remote: false, scope: 'player' }], 'own write: once, local, no echo');
  // settings follow the other tab too
  await env.evalOgx(b, async () => { await OGX.settings.set('core.tickMs', 2000); return true; });
  await a.waitForTimeout(500);
  assert.equal(await env.evalOgx(a, () => OGX.settings.get('core.tickMs')), 2000);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('export / import with mergers; locks are not exported; bad files are refused', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    S.registerMerger('t.list', (old, imp) => [...new Set([...old, ...imp])].sort());
    S.registerMerger('t.o', (old, imp) => Object.assign({}, old, imp));
    S.set('t.list', [1, 2]);
    S.set('t.obj', { a: 1, b: 1 });
    S.set('t.srv', 5, { scope: 'server' });
    const lock = await S.lock('exportTest', 5000);
    await S.flush();
    const file = await S.exportAll();
    const only = await S.exportAll({ scopes: ['player'], prefixes: ['t.list'] });
    // change local data, then merge the file back
    S.set('t.list', [3]);
    S.set('t.obj', { b: 2, c: 3 });
    const merged = await S.importAll(file);
    const afterMerge = { list: await S.get('t.list'), obj: await S.get('t.obj'), srv: await S.get('t.srv', null, { scope: 'server' }) };
    // replace mode ignores mergers
    S.set('t.list', [9]);
    const replaced = await S.importAll(file, { mode: 'replace' });
    const afterReplace = await S.get('t.list');
    // same data again: all skipped
    const again = await S.importAll(file, { mode: 'replace' });
    let bad = null;
    try { await S.importAll({ format: 'nope' }); } catch (e) { bad = e.message; }
    await lock.release();
    return { format: file.format, ext: file.ext, host: file.host, playerId: file.playerId, scopes: Object.keys(file.data), hasLock: Object.keys(file.data.player).some((k) => k.startsWith('lock.')),
      exported: [file.data.player['t.list'], file.data.player['t.obj'], file.data.server['t.srv']], only: only.data, merged, afterMerge, replaced: replaced.written, afterReplace, againWritten: again.written, bad };
  });
  assert.equal(r.format, 'ogx-export');
  assert.deepEqual([r.ext, r.host, r.playerId, r.scopes], ['live', env.host, '108', ['player', 'server']]);
  assert.equal(r.hasLock, false);
  assert.deepEqual(r.exported, [[1, 2], { a: 1, b: 1 }, 5]);
  assert.deepEqual(r.only, { player: { 't.list': [1, 2] } });
  assert.deepEqual(r.afterMerge, { list: [1, 2, 3], obj: { b: 1, c: 3, a: 1 }, srv: 5 });
  assert.ok(r.merged.written >= 2);
  assert.ok(r.replaced >= 2);
  assert.deepEqual(r.afterReplace, [1, 2]);
  assert.equal(r.againWritten, 0);
  assert.equal(r.bad, 'Неверный формат файла экспорта');
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('lock: one owner across tabs, release hands over, an expired lock is taken over', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const a = await env.open('/overview');
  const b = await env.open('/overview', { newPage: true });
  const r1 = await env.evalOgx(a, async () => { window.__lock = await OGX.storage.lock('scan', 60000); return !!window.__lock; });
  const r2 = await env.evalOgx(b, async () => !!(await OGX.storage.lock('scan', 60000)));
  const again = await env.evalOgx(a, async () => { const l = await OGX.storage.lock('scan', 60000); return !!l; }); // same tab: re-entrant
  const refreshed = await env.evalOgx(a, async () => window.__lock.refresh(60000));
  await env.evalOgx(a, async () => { await window.__lock.release(); return true; });
  const r3 = await env.evalOgx(b, async () => { window.__lock = await OGX.storage.lock('scan', 1000); return !!window.__lock; });
  const stolen = await env.evalOgx(a, async () => !!(await OGX.storage.lock('scan')));
  await a.waitForTimeout(1200);
  const expired = await env.evalOgx(a, async () => !!(await OGX.storage.lock('scan')));
  const lostRefresh = await env.evalOgx(b, async () => window.__lock.refresh());
  assert.deepEqual({ r1, r2, again, refreshed, r3, stolen, expired, lostRefresh }, { r1: true, r2: false, again: true, refreshed: true, r3: true, stolen: false, expired: true, lostRefresh: false });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('settings: nested storage shape, seeding, validation, onChange, reset', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega', settings: { 'core.logLevel': 'info', 'core.httpGapMs': 800, 'core.tickMs': 99999 } });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.settings;
    const seen = [];
    S.onChange('core', (k, v) => seen.push([k, v]));
    const seeded = [S.get('core.logLevel'), S.get('core.httpGapMs'), S.get('core.tickMs'), S.get('core.confirmActions')];
    await S.set('core.httpGapMs', 50);   // below min -> clamped
    await S.set('core.confirmActions', false);
    const after = [S.get('core.httpGapMs'), S.get('core.confirmActions')];
    await OGX.storage.flush();
    const stored = await OGX.storage.get('settings');
    await S.reset('core');
    await OGX.storage.flush();
    return { seeded, after, stored, seen, afterReset: [S.get('core.httpGapMs'), S.get('core.confirmActions')], storedAfterReset: await OGX.storage.get('settings'),
      schemaHasCore: !!S.schema('core').core.logLevel, all: Object.keys(S.all('core')).length > 5 };
  });
  assert.deepEqual(r.seeded.slice(0, 2), ['info', 800]);
  assert.ok(r.seeded[2] <= 5000, 'tickMs clamped or default: ' + r.seeded[2]);
  assert.equal(r.seeded[3], true);
  assert.deepEqual(r.after, [200, false]);
  assert.equal(r.stored.core.httpGapMs, 200);
  assert.equal(r.stored.core.confirmActions, false);
  assert.equal(r.stored.core.logLevel, 'info');
  assert.ok(!Object.keys(r.stored).some((k) => k.includes('.')), 'nested only: ' + Object.keys(r.stored));
  assert.deepEqual(r.seen.slice(0, 2), [['core.httpGapMs', 200], ['core.confirmActions', false]]);
  assert.deepEqual(r.afterReset, [400, true]);
  assert.equal(r.storedAfterReset.core, undefined);
  assert.ok(r.schemaHasCore && r.all);
  const raw = await env.get('settings');
  assert.equal(raw.core, undefined);
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('localStorage fallback backend: same API, keys prefixed ogx.<ext>.', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    await S.init({ ext: 'live', host: location.host, playerId: 108, backend: 'localStorage' });
    S._reset();
    await S.set('t.ls', { z: 1 });
    S.set('t.ls2', 2, { scope: 'global' });
    await S.flush();
    const raw = localStorage.getItem('ogx.live.' + location.host.toLowerCase() + '|108|t.ls');
    S._reset();
    return { backend: S.backendName, raw, get: await S.get('t.ls'), keys: await S.keys('t.'), g: await S.get('t.ls2', null, { scope: 'global' }) };
  });
  assert.deepEqual(r, { backend: 'localStorage', raw: '{"z":1}', get: { z: 1 }, keys: ['t.ls'], g: 2 });
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ogx.')) localStorage.removeItem(k); });
  assert.deepEqual(env.ogxErrors(), []);
});

T.test('a rejected backend write: journaled once (S storage write-failed + toast), the batch stays pending and lands on a later flush', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    await S.init({ ext: 'live', host: location.host, playerId: 108, backend: 'localStorage' });
    S._reset();
    // the first two writes of the key fail like a full chrome.storage area (QUOTA_BYTES), the third goes through
    const orig = Storage.prototype.setItem;
    let fail = 2;
    Storage.prototype.setItem = function (k, v) {
      if (fail > 0 && /t\.quota/.test(k)) { fail--; const e = new Error('QUOTA_BYTES quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
      return orig.call(this, k, v);
    };
    const out = {};
    try {
      const p1 = S.set('t.quota', { big: 1 });
      await S.flush();                                   // fails: journaled + toast
      out.resolved = await Promise.race([p1.then(() => true), new Promise((res) => setTimeout(() => res(false), 300))]);
      out.cachedAfterFail = await S.get('t.quota');
      out.rawAfterFail = localStorage.getItem('ogx.live.' + location.host.toLowerCase() + '|108|t.quota');
      await S.flush();                                   // fails again: debug only
      out.rawAfterSecond = localStorage.getItem('ogx.live.' + location.host.toLowerCase() + '|108|t.quota');
      await S.flush();                                   // retry succeeds
      out.rawAfterRetry = localStorage.getItem('ogx.live.' + location.host.toLowerCase() + '|108|t.quota');
      out.failures = S._writeFailures();
      out.events = OGX.diag.recent({ s: 'S', k: 'storage' }).map((e) => [e.w, e.d && e.d.keys, e.d && e.d.sample, e.d && e.d.backend]);
      out.errorEvents = OGX.diag.recent({ s: 'S', k: 'error' }).filter((e) => /storage write failed/.test(e.d && e.d.msg || '')).length;
      out.toasts = [...document.querySelectorAll('.ogx-toast')].filter((t) => /Хранилище расширения не принимает запись/.test(t.textContent)).length;
    } finally { Storage.prototype.setItem = orig; }
    S._reset();
    return out;
  });
  assert.equal(r.resolved, true, 'set() still resolves after a failed flush (callers never hang)');
  assert.deepEqual(r.cachedAfterFail, { big: 1 }, 'the page keeps working on the new value');
  assert.equal(r.rawAfterFail, null);
  assert.equal(r.rawAfterSecond, null);
  assert.equal(r.rawAfterRetry, '{"big":1}', 'the pending batch is written by a later flush');
  assert.equal(r.failures, 2);
  assert.deepEqual(r.events, [['write-failed', 1, ['t.quota'], 'localStorage']], 'exactly one journal event for two failures');
  assert.equal(r.errorEvents, 1, 'one error-level log line, the second failure is debug only');
  assert.equal(r.toasts, 1, 'one toast');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ogx.')) localStorage.removeItem(k); });
  // the error line of the first failure is expected in the console; nothing else
  const errs = env.ogxErrors().map((e) => e.text);
  assert.deepEqual(errs.filter((t) => !/storage write failed/.test(t)), [], errs.join('\n'));
});

T.test('a key that keeps failing: other keys of its batch still land, a remote write of it reaches subscribers and cancels the retry', async () => {
  const env = await T.launch({ ext: coreExt(), scenario: 'vega' });
  const page = await env.open('/overview');
  const r = await env.evalOgx(page, async () => {
    const S = OGX.storage;
    await S.init({ ext: 'live', host: location.host, playerId: 108, backend: 'localStorage' });
    S._reset();
    const pre = 'ogx.live.' + location.host.toLowerCase() + '|108|';
    const orig = Storage.prototype.setItem;
    let tries = 0;
    Storage.prototype.setItem = function (k, v) {
      if (/t\.poison/.test(k)) { tries++; throw new Error('QUOTA_BYTES quota exceeded'); }
      return orig.call(this, k, v);
    };
    const out = {};
    try {
      const got = [];
      S.subscribe('t.poison', (v, meta) => got.push([v, meta.remote]));
      S.set('t.poison', { n: 1 });
      S.set('t.ok', { n: 1 });
      await S.flush();
      out.okLanded = localStorage.getItem(pre + 't.ok');
      S.set('t.ok2', 2);
      await S.flush();                                   // the poison key is retried, the new small write lands anyway
      out.ok2Landed = localStorage.getItem(pre + 't.ok2');
      // another tab writes t.poison: the subscriber sees it, the failed older value is no longer retried
      window.dispatchEvent(new StorageEvent('storage', { key: pre + 't.poison', newValue: '{"n":9}', oldValue: null }));
      out.got = got.slice();
      out.now = await S.get('t.poison');
      const before = tries;
      await S.flush();
      out.retriedAfterRemote = tries - before;
    } finally { Storage.prototype.setItem = orig; }
    S._reset();
    return out;
  });
  assert.equal(r.okLanded, '{"n":1}', 'the healthy key of the failed batch is written');
  assert.equal(r.ok2Landed, '2', 'a later small write is not sunk by the failing key');
  assert.deepEqual(r.got, [[{ n: 1 }, false], [{ n: 9 }, true]], 'the remote write is not masked');
  assert.deepEqual(r.now, { n: 9 });
  assert.equal(r.retriedAfterRemote, 0, 'the stale value is dropped, not written over the remote one');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('ogx.')) localStorage.removeItem(k); });
  const errs = env.ogxErrors().map((e) => e.text);
  assert.deepEqual(errs.filter((t) => !/storage write failed/.test(t)), [], errs.join('\n'));
});
