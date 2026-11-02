'use strict';
// Bot test helper (BOT_CONTRACT C7): the suite extension against the GALAXYZ mock in WORLD mode (tests/gz-server.js + tests/gz-world.js).
//
//   const T = require('./lib');
//   const B = require('./gz-bot-lib');
//   T.test('x', async () => {
//     const env = await B.launchBot({ world: 'basic', settings: { 'botcore.master': true }, page: 'overview' });
//     try {
//       env.world.clock.advance(60);                         // the live World (C7.2) the server uses
//       await env.waitJournal(/^bot-/, { timeoutMs: 20000 });
//       assert.equal(env.mutating().length, 0);
//     } finally { await env.close(); }
//   });
//
// launchBot(opts): opts.world = scenario name (fixtures/galaxyz/bot-scenarios/<name>.json) | WorldSpec | World; opts.clock 'now' (default:
// the world starts at the real time) | 'spec' (keep spec.startUnix); opts.settings seeded before
// the first page; opts.page first page (default 'overview', false = none); opts.cp; every other option goes to G.launch (tests/gz-lib.js).
// env (G.launch env plus): world, server, firstPage, journal(), waitJournal(), botStatus(), setSettings(), until(), mutating(), close().
// env.page / env.game / env.open are the ones of tests/gz-lib.js (env.page() = the current page).

const G = require('./gz-lib');
const { startGzServer } = require('./gz-server');
const W = require('./gz-world');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindMatch = (kind, k) => (kind === undefined || kind === null ? true : kind instanceof RegExp ? kind.test(String(k || '')) : String(k) === String(kind));

/** The world for a browser run. opts.clock 'now' (default): the scenario's startUnix is replaced by the real time, as on the live
 * server, so the core's timezone guess (server wall clock - local clock, CORE_API §7) is right before the first fleet countdown
 * calibrates it; a fixed startUnix far from the real clock leaves the core uncalibrated (ServerMs off by tzOffsetSec) until then.
 * opts.clock 'spec' keeps the scenario's startUnix. A ready World object is used as given. */
function worldFor(opts) {
  const w = opts.world || 'basic';
  if (w && typeof w === 'object' && w.clock && typeof w.process === 'function') return w;
  if ((opts.clock || 'now') === 'spec') return w;
  const spec = JSON.parse(JSON.stringify(typeof w === 'string' ? W.loadScenario(w) : w));
  spec.startUnix = Math.floor(Date.now() / 1000);
  return spec;
}

async function launchBot(opts = {}) {
  const server = await startGzServer({ world: worldFor(opts), gameJs: opts.gameJs, keepRefresh: opts.keepRefresh, universe: opts.universe });
  const rest = Object.assign({}, opts);
  for (const k of ['world', 'page', 'cp', 'clock']) delete rest[k];
  let env;
  try {
    env = await G.launch(Object.assign(rest, { server }));
  } catch (e) {
    await server.close().catch(() => {});
    throw e;
  }
  const t0 = Date.now();
  env.world = server.world;
  env.server = server;
  env.launchedAt = t0;

  /** Current page of the env (the one env.game / env.open used last), or null. */
  const current = async () => { try { return await env.page(false); } catch (e) { return null; } };

  /** Journal events: OGX.diag.recent() of the open page + the stored events (deduplicated), filtered by kind (e.k) and since (id or t). */
  env.journal = async ({ kind, since } = {}) => {
    const page = await current();
    if (!page) return [];
    let list = [];
    try {
      list = await env.evalOgx(page, async () => {
        const out = [];
        const D = OGX.diag;
        if (!D) return out;
        try { if (D.flush) await D.flush(); } catch (e) { /* ignore */ }
        try {
          const b = D.store ? await D.store() : null;
          if (b && b.query) { const r = await b.query({ last: 3000 }); for (const e of (r && r.events) || []) out.push(e); }
        } catch (e) { /* ignore */ }
        for (const e of (D.recent ? D.recent() : [])) out.push(e);
        return JSON.parse(JSON.stringify(out));
      });
    } catch (e) { list = []; }
    const seen = new Set(); const out = [];
    for (const e of list || []) {
      const key = [e.t, e.k, e.s, e.w, e.tab].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    out.sort((a, b) => (a.t - b.t) || ((a.id || 0) - (b.id || 0)));
    return out.filter((e) => kindMatch(kind, e.k) && (since === undefined || since === null || (e.id !== undefined ? e.id > since : e.t > since)));
  };

  /** Polls the journal until an event of `kind` (and pred) shows up; throws with the last 30 events. */
  env.waitJournal = async (kind, { pred, timeoutMs = 30000, stepMs = 300 } = {}) => {
    const end = Date.now() + timeoutMs;
    let last = [];
    for (;;) {
      last = await env.journal();
      const hit = last.find((e) => kindMatch(kind, e.k) && (!pred || pred(e)));
      if (hit) return hit;
      if (Date.now() > end) break;
      await sleep(stepMs);
    }
    const tail = last.slice(-30).map((e) => `${e.s || '?'} ${e.k} ${e.w || ''}${e.d ? ' ' + JSON.stringify(e.d).slice(0, 160) : ''}`).join('\n  ');
    throw new Error(`waitJournal(${kind}) timed out after ${timeoutMs} ms; last events:\n  ${tail}`);
  };

  /** OGX.bot.status() of the open page, or null when OGX.bot is absent. */
  env.botStatus = async () => {
    const page = await current();
    if (!page) return null;
    return env.evalOgx(page, () => (OGX.bot && typeof OGX.bot.status === 'function' ? JSON.parse(JSON.stringify(OGX.bot.status())) : null));
  };

  /** Live settings change through OGX.settings.set in the open page ({ 'ns.key': value }). */
  env.setSettings = async (obj) => {
    const page = await current();
    if (!page) throw new Error('setSettings: no page open');
    await env.evalOgx(page, async (o) => { for (const [k, v] of Object.entries(o)) await OGX.settings.set(k, v); }, obj);
  };

  /** Polls fn until it returns truthy. */
  env.until = async (fn, { timeoutMs = 30000, stepMs = 250, label } = {}) => {
    const end = Date.now() + timeoutMs;
    let lastErr = null;
    for (;;) {
      try { if (await fn()) return; } catch (e) { lastErr = e; }
      if (Date.now() > end) throw new Error(`until${label ? ' ' + label : ''}: timed out after ${timeoutMs} ms` + (lastErr ? ': ' + lastErr.message : ''));
      await sleep(stepMs);
    }
  };

  /** Requests since launch that change or cost something: POST, fleetAjax, galaxy views, messages mode=view. */
  env.mutating = () => server.requests.filter((r) => r.t >= t0 && (r.method === 'POST'
    || (r.page && /^(fleetajax|galaxy)$/i.test(r.page))
    || (r.page && /^messages$/i.test(r.page) && String(r.mode || '').toLowerCase() === 'view')));

  const baseClose = env.close.bind(env);
  env.close = async (o = {}) => {
    try { await baseClose(o); } finally { if (!o.keepServer) await server.close().catch(() => {}); }
  };

  if (opts.page !== false) {
    try {
      env.firstPage = await env.game(opts.page || 'overview', opts.cp ? { cp: opts.cp } : {});
    } catch (e) {
      await env.close().catch(() => {});
      throw e;
    }
  }
  return env;
}

module.exports = { launchBot, kindMatch };
