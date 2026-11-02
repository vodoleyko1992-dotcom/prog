'use strict';
// Browser test harness for the OGX extensions (DESIGN.md section 5.2, specs/HARNESS.md).
//
//   const T = require('./lib');
//   T.test('name', async (t) => {
//     const env = await T.launch({ ext: 'live', scenario: 'vega' });
//     const page = await env.open('/overview');
//     ...
//   });
//
// Modes:
//   extension  real unpacked extension in Chromium (new headless, channel 'chromium'), content scripts in their
//              real worlds, chrome.storage via the background service worker.
//   inject     plain Chromium; the manifest's content scripts are evaluated in the same order through CDP:
//              MAIN-world files at document_start, isolated files at DOMContentLoaded in a named isolated
//              world, with a chrome.storage/chrome.runtime shim backed by a Node-side map.
// launch() uses OGX_TEST_MODE (default 'extension') and falls back to inject when the extension does not
// come up, unless { fallback: false }.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startServer, SCENARIOS } = require('./server');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures');
const OUT = path.join(__dirname, 'out');

const EXT_DIRS = { live: path.join(ROOT, 'ogamex-live'), infinity: path.join(ROOT, 'ogamex-infinity'), suite: path.join(ROOT, 'ogamex-suite') };

// ------------------------------------------------------------------ runner
const tests = [];
let scheduled = false;
const openEnvs = new Set();

function test(name, fn, opts = {}) {
  tests.push({ name, fn, timeout: opts.timeout || Number(process.env.OGX_TEST_TIMEOUT) || 90000, skip: !!opts.skip });
  if (!scheduled) { scheduled = true; setImmediate(runAll); }
}
test.skip = (name, fn) => test(name, fn, { skip: true });

async function runAll() {
  const filter = process.env.OGX_TEST_FILTER ? new RegExp(process.env.OGX_TEST_FILTER, 'i') : null;
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  const t0 = Date.now();
  for (const tc of tests) {
    if (tc.skip || (filter && !filter.test(tc.name))) { skipped++; console.log(`  - ${tc.name} (пропущен)`); continue; }
    const started = Date.now();
    const ctx = { name: tc.name, log: (...a) => console.log('    ', ...a) };
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => tc.fn(ctx)),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${tc.timeout} ms`)), tc.timeout); }),
      ]);
      passed++;
      console.log(`  ✓ ${tc.name} (${Date.now() - started} ms)`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${tc.name} (${Date.now() - started} ms)`);
      console.log(indent(String(e && e.stack || e), 6));
      for (const env of openEnvs) {
        const errs = env.ogxErrors();
        if (errs.length) console.log(indent('ogx errors:\n' + errs.map((x) => `${x.type}: ${x.text}`).join('\n'), 6));
        const shot = await env.screenshotAll(`FAIL-${slug(tc.name)}`).catch(() => []);
        if (shot.length) console.log(indent('screenshots: ' + shot.join(', '), 6));
      }
    } finally {
      clearTimeout(timer);
      for (const env of [...openEnvs]) await env.close().catch(() => {});
    }
  }
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(failed ? 1 : 0);
}

function indent(s, n) { return s.split('\n').map((l) => ' '.repeat(n) + l).join('\n'); }
function slug(s) { return String(s).replace(/[^\wЀ-ӿ-]+/g, '_').slice(0, 60); }

// ------------------------------------------------------------------ helpers
let synced = false;
function sync() {
  if (synced || process.env.OGX_NO_SYNC === '1') return;
  execFileSync('bash', [path.join(__dirname, 'sync.sh')], { stdio: ['ignore', 'pipe', 'inherit'] });
  synced = true;
}

function fixture(name) { return fs.readFileSync(path.join(FIX, name), 'utf8'); }
function fixtureJson(name) { return JSON.parse(fixture(name)); }

let lastEnv = null;
function key(ext, scenario, k, host) {
  const sc = SCENARIOS[scenario || 'vega'];
  const h = host || (lastEnv && lastEnv.host);
  if (!h) throw new Error('T.key: no host yet (call after T.launch, or pass host)');
  return `${h}|${sc.playerId}|${k}`;
}

function extensionId(dir) {
  const h = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return [...h].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// Chrome match pattern -> RegExp (scheme://host/path).
function matchPatternToRegExp(pat) {
  if (pat === '<all_urls>') return /^(https?|file|ftp):\/\//;
  const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pat);
  if (!m) throw new Error('bad match pattern ' + pat);
  const [, scheme, host, p] = m;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const sch = scheme === '*' ? 'https?' : esc(scheme);
  let hst;
  if (host === '*') hst = '[^/]*';
  else if (host.startsWith('*.')) hst = '(?:[^/]*\\.)?' + esc(host.slice(2)) + '(?::\\d+)?';
  else hst = esc(host) + '(?::\\d+)?';
  return new RegExp('^' + sch + ':\\/\\/' + hst + esc(p).replace(/\\\*/g, '.*').replace(/\*/g, '.*') + '$');
}

function resolveExts(ext) {
  const list = ext === 'both' ? ['live', 'infinity'] : Array.isArray(ext) ? ext : [ext];
  return list.map((e) => {
    if (typeof e === 'string') {
      if (!EXT_DIRS[e]) throw new Error(`unknown ext '${e}' (suite|live|infinity|both or {name, dir})`);
      return { name: e, dir: EXT_DIRS[e] };
    }
    if (!e || !e.name || !e.dir) throw new Error('ext object needs {name, dir}');
    return { name: e.name, dir: path.resolve(e.dir) };
  }).map((e) => {
    const mfPath = path.join(e.dir, 'manifest.json');
    if (!fs.existsSync(mfPath)) throw new Error(`no manifest: ${mfPath}`);
    const manifest = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
    const attr = 'ogx' + e.name[0].toUpperCase() + e.name.slice(1); // dataset key: data-ogx-<name>
    return { ...e, manifest, id: extensionId(e.dir), attr, attrName: 'data-ogx-' + e.name, worldName: 'ogx-' + e.name };
  });
}

// chrome.storage.local.get semantics
function storageGet(store, keys) {
  if (keys == null) return { ...store };
  if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
  if (Array.isArray(keys)) { const o = {}; for (const k of keys) if (k in store) o[k] = store[k]; return o; }
  const o = {};
  for (const k of Object.keys(keys)) o[k] = k in store ? store[k] : keys[k];
  return o;
}
const { withBaseline } = require('./bot-baseline');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Expand '{host}' / '{pid}' placeholders and the settings shortcut into a storage object.
function buildSeed(env, storage = {}, settings = {}, opts = {}) {
  const sc = SCENARIOS[env.server.state.scenario];
  const out = {};
  for (const [k, v] of Object.entries(storage || {})) out[k.replace('{host}', env.host).replace('{pid}', String(sc.playerId))] = clone(v);
  if (!sc) return out;   // GALAXYZ server: tests/gz-lib.js seeds in its own namespace
  const sk = `${env.host}|${sc.playerId}|settings`;
  const nested = withBaseline(env, opts, out[sk], settings);   // bot switches: pre-0.3.2 test baseline (tests/bot-baseline.js)
  if (Object.keys(nested).length) out[sk] = nested;
  return out;
}

// ------------------------------------------------------------------ inject-mode scripts
// Shim evaluated in the isolated world before the content scripts (inject mode).
function shimSource(ext) {
  return `(() => {
  const EXT = ${JSON.stringify(ext.name)};
  const MANIFEST = ${JSON.stringify(ext.manifest)};
  const ID = ${JSON.stringify(ext.id)};
  const pending = new Map(); let seq = 0;
  const listeners = new Set(); const msgListeners = new Set();
  const call = (op, args) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    globalThis.__ogxStore(JSON.stringify({ id, op, args }));
  });
  globalThis.__ogxStoreReply = (id, ok, value) => {
    const p = pending.get(id); if (!p) return; pending.delete(id);
    ok ? p.resolve(value) : p.reject(new Error(value));
  };
  globalThis.__ogxStoreChanged = (changes, area) => { for (const fn of [...listeners]) { try { fn(changes, area); } catch (e) { console.error('[OGX shim] onChanged listener', e); } } };
  const cb = (p, fn) => { if (typeof fn === 'function') { p.then((v) => fn(v), () => fn(undefined)); return undefined; } return p; };
  const local = {
    get: (keys, fn) => cb(call('get', [keys === undefined ? null : keys]), fn),
    set: (items, fn) => cb(call('set', [JSON.parse(JSON.stringify(items))]).then(() => undefined), fn),
    remove: (keys, fn) => cb(call('remove', [keys]).then(() => undefined), fn),
    clear: (fn) => cb(call('clear', []).then(() => undefined), fn),
    getBytesInUse: (keys, fn) => cb(call('bytes', [keys == null ? null : keys]), typeof keys === 'function' ? keys : fn),
    QUOTA_BYTES: 10485760,
  };
  const onChanged = { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f), hasListener: (f) => listeners.has(f) };
  const runtime = {
    id: ID,
    getManifest: () => JSON.parse(JSON.stringify(MANIFEST)),
    getURL: (p) => 'chrome-extension://' + ID + '/' + String(p).replace(/^\\//, ''),
    sendMessage: (msg, fn) => cb(Promise.resolve(msg && msg.type === 'ogx:ping' ? { ok: true, ext: EXT, shim: true } : undefined), fn),
    onMessage: { addListener: (f) => msgListeners.add(f), removeListener: (f) => msgListeners.delete(f), hasListener: (f) => msgListeners.has(f) },
    lastError: undefined,
  };
  const chromeObj = (typeof globalThis.chrome === 'object' && globalThis.chrome) || {};
  chromeObj.storage = { local, onChanged };
  chromeObj.runtime = runtime;
  globalThis.chrome = chromeObj;
  globalThis.__ogxInject = { ext: EXT };
})();`;
}

function urlGuard(matches, excludes) {
  return `(() => { if (window.top !== window) return false; const u = location.href;
    const inc = [${matches.map((m) => matchPatternToRegExp(m).toString()).join(',')}];
    const exc = [${excludes.map((m) => matchPatternToRegExp(m).toString()).join(',')}];
    return inc.some((r) => r.test(u)) && !exc.some((r) => r.test(u)); })()`;
}

// Builds the two init scripts of one extension: [{world: 'main'|'isolated', source}]
function injectScripts(ext) {
  const out = [];
  const isolatedParts = [];
  for (const cs of ext.manifest.content_scripts || []) {
    const guard = urlGuard(cs.matches || [], cs.exclude_matches || []);
    const files = (cs.js || []).map((f) => ({ f, src: fs.readFileSync(path.join(ext.dir, f), 'utf8') }));
    const runFiles = files.map(({ f, src }) => `try { (0, eval)(${JSON.stringify(src + `\n//# sourceURL=ogx-inject://${ext.name}/${f}`)}); } catch (e) { console.error('[OGX inject] ' + ${JSON.stringify(f)} + ':', e && e.stack || e); }`).join('\n');
    const runAt = cs.run_at || 'document_idle';
    const when = runAt === 'document_start' ? 'run();'
      : `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();`;
    const body = `(() => { if (!${guard}) return; const run = () => {\n${runFiles}\n}; ${when} })();`;
    if (cs.world === 'MAIN') out.push({ world: 'main', source: body });
    else isolatedParts.push(body);
  }
  if (isolatedParts.length) out.push({ world: 'isolated', source: shimSource(ext) + '\n' + isolatedParts.join('\n') });
  return out;
}

// ------------------------------------------------------------------ launch
async function launch(opts = {}) {
  const exts = resolveExts(opts.ext || 'live');
  if (exts.some((e) => e.dir === EXT_DIRS.live || e.dir === EXT_DIRS.infinity || e.dir === EXT_DIRS.suite)) sync();
  const requested = opts.mode || process.env.OGX_TEST_MODE || 'extension';
  const fallback = opts.fallback !== false;
  const server = opts.server || await startServer({ scenario: opts.scenario || 'vega', gameJs: !!opts.gameJs });
  const ownServer = !opts.server;
  if (opts.scenario && opts.server) server.setScenario(opts.scenario);
  let env;
  try {
    if (requested === 'extension') {
      try {
        env = await launchExtension(exts, server, opts);
      } catch (e) {
        if (!fallback) throw e;
        console.warn(`[harness] extension mode failed (${e.message.split('\n')[0]}); falling back to inject mode`);
      }
    }
    if (!env) env = await launchInject(exts, server, opts);
  } catch (e) {
    if (ownServer) await server.close();
    throw e;
  }
  env.ownServer = ownServer;
  const seed = buildSeed(env, opts.storage, opts.settings, opts);
  if (Object.keys(seed).length) await env.setStorage(seed);
  server.clearLog();
  openEnvs.add(env);
  lastEnv = env;
  return env;
}

function hostFor(opts, server) { return `${(opts.host || 'localhost').toLowerCase()}:${server.port}`; }
// Every host name resolves to the mock server, so tests can use any domain (e.g. 'ogamex.test', or a
// gameforge-like host to prove the extension stays off there). Nothing can reach the internet anyway.
function hostArgs() { return ['--host-resolver-rules=MAP * 127.0.0.1']; }

async function launchExtension(exts, server, opts) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogx-pw-'));
  const dirs = exts.map((e) => e.dir).join(',');
  const headless = opts.headless !== undefined ? opts.headless : process.env.OGX_HEADED !== '1';
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', // required: the default headless shell does not load extensions
    headless,
    viewport: opts.viewport || { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${dirs}`, `--load-extension=${dirs}`, ...hostArgs(opts)],
  });
  const env = makeEnv({ mode: 'extension', context, browser: null, server, exts, host: hostFor(opts, server), userDir, opts });
  try {
    // wait for every extension's service worker (proves the extension loaded)
    const deadline = Date.now() + (opts.extTimeout || 10000);
    for (const e of exts) {
      while (!env.worker(e.name)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`service worker of '${e.name}' (${e.id}) did not start`);
        await context.waitForEvent('serviceworker', { timeout: left }).catch(() => {});
      }
    }
    // readiness probe: content scripts must reach ready on /overview, then everything it did is wiped
    if (opts.probe !== false) {
      const page = await context.newPage();
      try {
        await page.goto(env.origin + (opts.probePath || '/overview'), { waitUntil: 'domcontentloaded' });
        await Promise.all(exts.map((e) => page.waitForSelector(`html[${e.attrName}="ready"]`, { timeout: opts.extTimeout || 10000 })));
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ } });
      } finally {
        await page.close();
      }
      for (const e of exts) await env.clearStorage(e.name);
      server.reset();
      env.logs.length = 0;
    }
  } catch (e) {
    await env.close({ keepServer: true });
    throw e;
  }
  return env;
}

async function launchInject(exts, server, opts) {
  const headless = opts.headless !== undefined ? opts.headless : process.env.OGX_HEADED !== '1';
  const browser = await chromium.launch({ headless, args: hostArgs(opts) });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
  const env = makeEnv({ mode: 'inject', context, browser, server, exts, host: hostFor(opts, server), userDir: null, opts });
  // MAIN-world files: Playwright init scripts (document_start, every page of the context)
  for (const e of exts) for (const s of e.inject.filter((x) => x.world === 'main')) await context.addInitScript({ content: s.source });
  context.on('page', (p) => { env._attach(p).catch((err) => console.warn('[harness] attach failed', err.message)); });
  return env;
}

// ------------------------------------------------------------------ env
function makeEnv({ mode, context, browser, server, exts, host, userDir, opts }) {
  for (const e of exts) e.inject = injectScripts(e);
  const stores = Object.fromEntries(exts.map((e) => [e.name, {}])); // inject mode storage
  const isoContexts = new Map(); // inject: ext -> Set of {session, contextId}
  const attached = new WeakMap(); // page -> Promise
  let mainPage = null;
  const origin = `http://${host}`;

  const env = {
    mode, context, browser, server, exts, host, origin,
    ext: exts.map((e) => e.name),
    logs: [],

    worker(name) {
      const e = exts.find((x) => x.name === name);
      return context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${e.id}/`)) || null;
    },

    url(p) { return /^https?:/.test(p) ? p : origin + (p.startsWith('/') ? p : '/' + p); },
    // same mock server under another host name: env.urlOn('s1-en.ogame.gameforge.com', '/overview')
    urlOn(hostname, p) { return `http://${hostname}:${server.port}${p.startsWith('/') ? p : '/' + p}`; },

    async page(newPage = false) {
      if (!newPage && mainPage && !mainPage.isClosed()) return mainPage;
      const p = await context.newPage();
      await env._attach(p);
      if (!newPage || !mainPage || mainPage.isClosed()) mainPage = p;
      return p;
    },

    async open(p, o = {}) {
      const page = o.page || await env.page(!!o.newPage);
      await page.goto(env.url(p), { waitUntil: o.waitUntil || 'domcontentloaded', timeout: o.timeout || 30000 });
      if (o.waitReady !== false) await env.waitReady(page, o);
      return page;
    },

    async waitReady(page, o = {}) {
      const timeout = o.readyTimeout || 10000;
      try {
        await Promise.all(exts.map((e) => page.waitForSelector(`html[${e.attrName}="ready"]`, { timeout, state: 'attached' })));
      } catch (err) {
        const st = await page.evaluate((names) => names.map((n) => n + '=' + document.documentElement.getAttribute(n)), exts.map((e) => e.attrName)).catch(() => []);
        const errs = env.ogxErrors().map((x) => x.text).slice(0, 5);
        throw new Error(`extension not ready on ${page.url()} (${st.join(', ')}; mode ${mode})` + (errs.length ? `\n  ogx errors:\n  ${errs.join('\n  ')}` : ''));
      }
    },

    waitFor(page, sel, o = {}) { return page.waitForSelector(sel, { state: 'attached', timeout: 10000, ...o }); },

    // ----- storage -----
    async storage(name) {
      if (!name && exts.length > 1) {
        const out = {};
        for (const e of exts) out[e.name] = await env.storage(e.name);
        return out;
      }
      const e = name ? exts.find((x) => x.name === name) : exts[0];
      if (mode === 'inject') return clone(stores[e.name]);
      return env._extEval(e, () => chrome.storage.local.get(null));
    },
    async setStorage(obj, name) {
      // obj: flat {key: value} (applied to every ext), or {<extName>: {...}} for several extensions
      const perExt = exts.length > 1 && Object.keys(obj).every((k) => exts.some((e) => e.name === k)) ? obj : null;
      for (const e of exts) {
        const items = perExt ? perExt[e.name] : obj;
        if (!items || (name && name !== e.name)) continue;
        if (mode === 'inject') { Object.assign(stores[e.name], clone(items)); await env._broadcast(e, Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: clone(v) }]))); }
        else await env._extEval(e, (it) => chrome.storage.local.set(it), items);
      }
    },
    async clearStorage(name) {
      for (const e of exts) {
        if (name && name !== e.name) continue;
        if (mode === 'inject') { for (const k of Object.keys(stores[e.name])) delete stores[e.name][k]; } else await env._extEval(e, () => chrome.storage.local.clear());
      }
    },
    key(k, o = {}) {
      const sc = SCENARIOS[server.state.scenario];
      const scope = o.scope || 'player';
      return scope === 'global' ? `*|*|${k}` : scope === 'server' ? `${host}|*|${k}` : `${host}|${sc.playerId}|${k}`;
    },
    async get(k, o = {}) { const s = await env.storage(o.ext || exts[0].name); return s[env.key(k, o)]; },

    // ----- evaluation inside the extension's isolated world (where window.OGX lives) -----
    async evalOgx(page, fn, arg, name) {
      const e = name ? exts.find((x) => x.name === name) : exts[0];
      const session = await context.newCDPSession(page);
      try {
        const ctxs = [];
        session.on('Runtime.executionContextCreated', (ev) => ctxs.push(ev.context));
        await session.send('Runtime.enable');
        const frameId = (await session.send('Page.getFrameTree')).frameTree.frame.id;
        const c = ctxs.find((x) => x.auxData && x.auxData.frameId === frameId && !x.auxData.isDefault
          && (x.name === e.worldName || (x.origin || '').startsWith(`chrome-extension://${e.id}`)));
        if (!c) throw new Error(`isolated world of '${e.name}' not found on ${page.url()}`);
        const expression = typeof fn === 'function' ? `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})` : String(fn);
        const r = await session.send('Runtime.evaluate', { expression, contextId: c.id, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error('evalOgx: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        return r.result.value;
      } finally {
        await session.detach().catch(() => {});
      }
    },

    // ----- logs -----
    ogxErrors() {
      return env.logs.filter((l) => (l.type === 'console' && l.level === 'error' && /\[OGX/.test(l.text))
        || (l.type === 'pageerror' && /chrome-extension:\/\/|ogx-inject:\/\/|\[OGX/.test(l.stack || l.text)));
    },
    consoleErrors() { return env.logs.filter((l) => (l.type === 'console' && l.level === 'error') || l.type === 'pageerror'); },
    clearLogs() { env.logs.length = 0; },

    // ----- server -----
    requests(method, pathOrRe) { return server.find(method, pathOrRe); },
    clearRequests() { server.clearLog(); },
    setState(patch) { Object.assign(server.state, patch); },

    // ----- page stubs (MAIN world) -----
    async pageStub(page, globalName, fields = {}) {
      await page.evaluate(([name, init]) => {
        window.__ogxStubCalls = window.__ogxStubCalls || [];
        const target = Object.assign({ shipsToSend: [], targetPlanet: {}, mission: 0, speedPercent: 10, cargoMetal: 0, cargoCrystal: 0, cargoDeuterium: 0, expeditionTime: 1, holdingTime: 1, fleetHelper: { shipsData: {} }, currentPage: 'fleet1' }, init);
        window[name] = new Proxy(target, {
          get(t, prop) {
            if (prop in t) return t[prop];
            if (typeof prop === 'symbol') return undefined;
            return (...args) => { window.__ogxStubCalls.push({ name, method: String(prop), args: JSON.parse(JSON.stringify(args)) }); return undefined; };
          },
        });
      }, [globalName, fields]);
    },
    stubCalls(page) { return page.evaluate(() => window.__ogxStubCalls || []); },

    // ----- screenshots -----
    async screenshot(page, name) {
      fs.mkdirSync(OUT, { recursive: true });
      const f = path.join(OUT, slug(name) + '.png');
      await page.screenshot({ path: f, fullPage: true });
      return f;
    },
    async screenshotAll(prefix) {
      const files = [];
      for (const [i, p] of context.pages().entries()) if (!p.isClosed() && /^http/.test(p.url())) files.push(await env.screenshot(p, `${prefix}-${i}`));
      return files;
    },

    async close(o = {}) {
      openEnvs.delete(env);
      await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (env.ownServer && !o.keepServer) await server.close().catch(() => {});
      if (userDir) fs.rmSync(userDir, { recursive: true, force: true });
    },

    // ----- internals -----
    async _extEval(e, fn, arg) {
      let w = env.worker(e.name);
      if (w) {
        try { return await w.evaluate(fn, arg); } catch (err) { w = null; }
      }
      // service worker gone: use an extension page (same origin, same chrome.storage)
      const p = await context.newPage();
      try {
        await p.goto(`chrome-extension://${e.id}/manifest.json`);
        return await p.evaluate(fn, arg);
      } finally { await p.close(); }
    },

    async _broadcast(e, changes) {
      const set = isoContexts.get(e.name);
      if (!set) return;
      for (const c of [...set]) {
        try {
          await c.session.send('Runtime.evaluate', { contextId: c.contextId, expression: `globalThis.__ogxStoreChanged && globalThis.__ogxStoreChanged(${JSON.stringify(changes)}, 'local')` });
        } catch (err) { set.delete(c); }
      }
    },

    _attach(page) {
      if (attached.has(page)) return attached.get(page);
      const pr = (async () => {
        page.on('console', (m) => env.logs.push({ type: 'console', level: m.type(), text: m.text(), url: page.url(), location: m.location() }));
        page.on('pageerror', (err) => env.logs.push({ type: 'pageerror', level: 'error', text: err.message, stack: err.stack || '', url: page.url() }));
        if (mode !== 'inject') return;
        const session = await context.newCDPSession(page);
        session.on('Runtime.executionContextCreated', (ev) => {
          const e = exts.find((x) => x.worldName === ev.context.name);
          if (!e) return;
          if (!isoContexts.has(e.name)) isoContexts.set(e.name, new Set());
          isoContexts.get(e.name).add({ session, contextId: ev.context.id });
        });
        session.on('Runtime.executionContextDestroyed', (ev) => {
          for (const set of isoContexts.values()) for (const c of [...set]) if (c.session === session && c.contextId === ev.executionContextId) set.delete(c);
        });
        session.on('Runtime.bindingCalled', async (ev) => {
          if (ev.name !== '__ogxStore') return;
          const ctxId = ev.executionContextId;
          let msg;
          try { msg = JSON.parse(ev.payload); } catch (err) { return; }
          const e = exts.find((x) => [...(isoContexts.get(x.name) || [])].some((c) => c.session === session && c.contextId === ctxId)) || exts[0];
          const store = stores[e.name];
          let ok = true;
          let value;
          let changes = null;
          try {
            const [a] = msg.args;
            if (msg.op === 'get') value = clone(storageGet(store, a));
            else if (msg.op === 'set') {
              changes = {};
              for (const [k, v] of Object.entries(a)) { changes[k] = { oldValue: clone(store[k]), newValue: clone(v) }; store[k] = clone(v); }
            } else if (msg.op === 'remove') {
              changes = {};
              for (const k of [].concat(a)) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
            } else if (msg.op === 'clear') {
              changes = {};
              for (const k of Object.keys(store)) { changes[k] = { oldValue: store[k] }; delete store[k]; }
            } else if (msg.op === 'bytes') {
              value = Buffer.byteLength(JSON.stringify(a == null ? store : storageGet(store, a)));
            } else throw new Error('unknown op ' + msg.op);
          } catch (err) { ok = false; value = String(err.message); }
          try {
            await session.send('Runtime.evaluate', { contextId: ctxId, expression: `globalThis.__ogxStoreReply(${msg.id}, ${ok}, ${JSON.stringify(value === undefined ? null : value)})` });
          } catch (err) { /* page navigated */ }
          if (changes && Object.keys(changes).length) await env._broadcast(e, changes);
        });
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        for (const e of exts) {
          await session.send('Runtime.addBinding', { name: '__ogxStore', executionContextName: e.worldName });
          for (const s of e.inject.filter((x) => x.world === 'isolated')) {
            await session.send('Page.addScriptToEvaluateOnNewDocument', { source: s.source, worldName: e.worldName });
          }
        }
      })();
      attached.set(page, pr);
      return pr;
    },
  };
  return env;
}

module.exports = {
  test,
  assert,
  launch,
  startServer,
  fixture,
  fixtureJson,
  key,
  sync,
  extensionId,
  matchPatternToRegExp,
  ROOT,
  FIX,
  OUT,
};
