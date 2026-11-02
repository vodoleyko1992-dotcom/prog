// Test baseline for the bot switches. Since 0.3.2 every bot function is ON by default (John: maximum autonomy), so a page of
// the suite would start the bot at once. The e2e tests were written for the pre-0.3.2 defaults (bot off, dry-run on, every
// module off) and switch on exactly what they test, so the harness seeds those values unless a test passes
// botDefaults: 'auto' (then the packaged defaults apply). Seeded values are ordinary stored settings: a test's own settings win.
'use strict';
const BOT_TEST_BASE = {
  'botcore.master': false, 'botcore.dryRun': true, 'botcore.autoLogin': false, 'botcore.galaxyViewsPerHour': 0,
  'botbuild.on': false, 'botbuild.moons': false, 'botbuild.defense': false,
  'botsave.on': false, 'botsave.spyAttacker': false, 'botsave.sleepSave': false,
  'botexpo.on': false, 'botexpo.colonize': false, 'botexpo.buildColonizers': false,
  'botdebris.on': false, 'botdebris.logistics': false, 'botdebris.repatriate': false,
  'botfarm.on': false, 'botfarm.scanGalaxy': false, 'botfarm.buildShips': false, 'botfarm.useFleetAjax': false, 'botfarm.deleteReports': false,
  'botmissiles.on': false, 'botmissiles.buildMissiles': false, 'botmissiles.buildSilo': false,
};
/** Nested settings object { ns: { key: v } } with the baseline under the stored object and the flat test settings on top. */
function withBaseline(env, opts, stored, flat) {
  const out = {};
  const put = (p, v) => { const i = p.indexOf('.'); if (i < 0) throw new Error(`settings key must be 'ns.key': ${p}`); (out[p.slice(0, i)] = out[p.slice(0, i)] || {})[p.slice(i + 1)] = v; };
  const suite = Array.isArray(env.ext) && env.ext.includes('suite');
  if (suite && !(opts && opts.botDefaults === 'auto')) for (const [p, v] of Object.entries(BOT_TEST_BASE)) put(p, v);
  for (const [ns, o] of Object.entries(stored || {})) if (o && typeof o === 'object') out[ns] = Object.assign(out[ns] || {}, JSON.parse(JSON.stringify(o)));
  for (const [p, v] of Object.entries(flat || {})) put(p, JSON.parse(JSON.stringify(v === undefined ? null : v)));
  return out;
}
module.exports = { BOT_TEST_BASE, withBaseline };
