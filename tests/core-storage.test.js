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
