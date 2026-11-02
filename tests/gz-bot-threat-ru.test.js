'use strict';
// John's Russian UI against botcore's threat parsing (WORLD mode of the GALAXYZ mock, spec.lang 'ru' = the upstream
// language/ru cff_mission_* sentences, scenario botsave-attack with the moon named «Луна» as a new moon is in ru):
// a hostile fleet to the moon must be keyed to the moon. EXPECTED RED on 0.3.2 (kept apart from gz-bot-mock so that file stays
// green): botcore.threatFromEvent decides «moon» with /\b(moon|луна|mond)\b/i, and JS \b is ASCII-only, so «Луна» never matches.
//   node tests/gz-bot-threat-ru.test.js
const T = require('./lib');
const B = require('./gz-bot-lib');
const W = require('./gz-world');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

async function threatsAfter(env, page, n) {
  let th = [];
  await env.until(async () => { th = await env.evalOgx(page, () => (OGX.bot && OGX.bot.threats ? OGX.bot.threats() : [])); return th.length >= n; }, { timeoutMs: 30000, label: n + ' threats' });
  return th;
}
const keyOf = async (env, page, id) => env.evalOgx(page, async (bid) => { const b = (await OGX.state.bodies()) || {}; const x = Object.values(b).find((v) => +v.id === +bid); return x ? x.key : null; }, id);

T.test('bot env (lang ru): a hostile fleet to the MOON is keyed to the moon — EXPECTED RED until botcore threatFromEvent matches «Луна» (JS \\b is ASCII-only)', async () => {
  // botcore.threatFromEvent: /\b(moon|луна|mond)\b/i never matches a Cyrillic word, so in John's ru UI every attack on a moon is
  // keyed to the planet at the same coordinates (botsave would save the planet's fleet and leave the moon's). BOTCORE fix: a
  // Unicode-aware boundary, e.g. /(^|[^\p{L}\p{N}_])(moon|луна|mond)(?![\p{L}\p{N}_])/iu, or the target link's type segment.
  const spec = JSON.parse(JSON.stringify(W.loadScenario('botsave-attack'))); spec.lang = 'ru'; spec.hostile = [];
  spec.bodies.find((b) => b.id === 254110).name = 'Луна';     // the ru default name of a new moon (an English «Moon» would match)
  const env = await B.launchBot({ world: spec });
  try {
    const W0 = env.world;
    const hm = W0.addHostile({ toBodyId: 254110, ownerId: 3843, mission: 1, ships: { 204: 50 }, flightSec: 700 });
    const ov = await env.game('overview');
    const th = (await threatsAfter(env, ov, 1)).find((x) => x.fleetId === hm.id);
    assert.ok(th, 'threat registered');
    assert.equal(th.toType, 3, 'the moon (type 3): ' + JSON.stringify({ toType: th.toType, bodyKey: th.bodyKey }));
    assert.equal(th.bodyKey, await keyOf(env, ov, 254110), 'keyed to the moon 254110');
  } finally { await env.close(); }
});
