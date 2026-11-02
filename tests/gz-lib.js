'use strict';
// GALAXYZ flavour of the test harness: T.launch() (tests/lib.js: extension mode with inject fallback, storage, evalOgx,
// logs) against the GALAXYZ mock (tests/gz-server.js) that serves the real saved pages of ogamex.eu/Aeternum.
//
//   const T = require('./lib');
//   const G = require('./gz-lib');
//   T.test('x', async () => {
//     const env = await G.launch();                         // suite extension, host ogamex.eu:<port>, probe on page=overview
//     const page = await env.game('overview');              // = env.open('/Aeternum/game.php?page=overview')
//     const page2 = await env.game('shipyard', { mode: 'defense', cp: 254103 });
//     await env.openSaved('messages-spy');                   // a saved file by name
//     env.key('bodies')                                      // 'ogamex.eu:<port>/aeternum|n:vodoleyko1992|bodies'
//   });
//
// Options: everything T.launch takes (ext, mode, fallback, viewport, ...) plus
//   server       a running startGzServer() (reused; else one per env)
//   gameJs       false = jQuery stub instead of the game's JS (default true: the real live JS)
//   keepRefresh  keep the fleetStep3 <meta refresh>
//   storage      seed; placeholders '{ns}' (= '<host>/<universe>|n:<player>'), '{host}', '{pid}' expanded
//   settings     { 'ns.key': value } seeded as nested objects under '{ns}|settings'
// The env gets: server (the GZ mock), universe, player, gzHost, game(), openSaved(), gzUrl(), and GALAXYZ key()/get().

const T = require('./lib');
const { startGzServer, pageNames } = require('./gz-server');

const { withBaseline } = require('./bot-baseline');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

async function launch(opts = {}) {
  const server = opts.server || await startGzServer({ gameJs: opts.gameJs, keepRefresh: opts.keepRefresh, universe: opts.universe });
  const own = !opts.server;
  let env;
  try {
    env = await T.launch(Object.assign({}, opts, {
      ext: opts.ext || 'suite',
      server,
      host: opts.host || 'ogamex.eu',
      probePath: opts.probePath || server.gamePath('overview'),
      storage: undefined,
      settings: undefined,
      scenario: undefined,
    }));
  } catch (e) {
    if (own) await server.close().catch(() => {});
    throw e;
  }
  env.ownServer = own;
  env.universe = server.universe;
  env.player = server.account.player;
  // storage namespace of page.identity(): '<location.host>/<universe>' lower case, player 'n:<name>'
  env.gzHost = `${env.host}/${server.universe}`.toLowerCase();
  env.pid = 'n:' + env.player;
  env.key = (k, o = {}) => {
    const scope = o.scope || 'player';
    return scope === 'global' ? `*|*|${k}` : scope === 'server' ? `${env.gzHost}|*|${k}` : `${env.gzHost}|${env.pid}|${k}`;
  };
  env.get = async (k, o = {}) => { const s = await env.storage(o.ext || env.ext[0]); return s[env.key(k, o)]; };
  env.gzUrl = (q = {}) => env.url(server.gamePath(q));
  /** Opens game.php?page=<name>[&mode][&cp][&query...] and waits for ready (pass waitReady: false etc. like env.open). */
  env.game = (gzPage, o = {}) => {
    const q = Object.assign({ page: gzPage }, o.mode ? { mode: o.mode } : {}, o.cp ? { cp: o.cp } : {}, o.query || {});
    return env.open(server.gamePath(q), o);
  };
  /** Opens a saved page by its file name ('shipyard-defense', 'messages-spy'). */
  env.openSaved = (name, o = {}) => env.open(server.pathFor(name), o);

  const seed = buildSeed(env, opts.storage, opts.settings, opts);
  if (Object.keys(seed).length) await env.setStorage(seed);
  server.clearLog();
  return env;
}

function buildSeed(env, storage = {}, settings = {}, opts = {}) {
  const out = {};
  const ns = `${env.gzHost}|${env.pid}`;
  for (const [k, v] of Object.entries(storage || {})) out[k.replace('{ns}', ns).replace('{host}', env.gzHost).replace('{pid}', env.pid)] = clone(v);
  const sk = `${ns}|settings`;
  const nested = withBaseline(env, opts, out[sk], settings);   // bot switches: pre-0.3.2 test baseline (tests/bot-baseline.js)
  if (Object.keys(nested).length) out[sk] = nested;
  return out;
}

// Expected route of every saved page (05-page.js GZ_ROUTES; specs/galaxyz/layout.md §2).
const EXPECTED_ROUTES = {
  overview: { name: 'overview' },
  buildings: { name: 'buildings', aliases: ['resources', 'facilities'] },
  research: { name: 'research' },
  'shipyard-fleet': { name: 'shipyard', mode: 'fleet' },
  'shipyard-defense': { name: 'defense', mode: 'defense' },
  fleetTable: { name: 'fleet', aliases: ['movement'] },
  fleetStep1: { name: 'fleet', step: 1 },
  fleetStep2: { name: 'fleet', step: 2 },
  fleetStep3: { name: 'fleet', step: 3 },
  galaxy: { name: 'galaxy' },
  imperium: { name: 'empire' },
  resources: { name: 'resourceSettings' },
  officier: { name: 'premium' },
  trader: { name: 'merchant' },
  fleetDealer: { name: 'merchant' },
  techtree: { name: 'other' },
  tournament: { name: 'other' },
  transport: { name: 'other' },
  'messages-all': { name: 'messages' },
  'messages-spy': { name: 'messages' },
};

module.exports = { launch, buildSeed, startGzServer, pageNames, EXPECTED_ROUTES };
