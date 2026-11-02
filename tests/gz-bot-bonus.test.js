'use strict';
// «Бонус за онлайн» (botcore.onlineBonus, John 2026-11-01) against the GALAXYZ mock: the game shows a star (.infobox «Online bonus.»
// -> game.php?page=bonus) while the bonus can be taken; his own claim was page=bonus, then page=bonus&action=claim.
//   (a) the star on the page: the botcore:bonus worker reads page=bonus and follows its claim link once; journal «получен»
//   (b) setting off, or no star: no request to page=bonus
//   node tests/gz-bot-bonus.test.js
const T = require('./lib');
const G = require('./gz-lib');
const { assert } = T;

if (process.env.OGX_NO_SYNC !== '1') T.sync();

const OTHER_BOT = ['botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo'];
const isolate = (extra = {}) => Object.assign(Object.fromEntries(OTHER_BOT.map((m) => [m + '.enabled', false])),
  { 'botcore.minGapMs': 300, 'botcore.maxGapMs': 500, 'botcore.master': true, 'botcore.dryRun': false }, extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 30000, stepMs = 250, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + what);
    await sleep(stepMs);
  }
}
function bonusRoutes(env) {
  const hits = [];
  let claimed = false;
  env.server.route('GET', 'bonus', (req, res, ctx) => {
    hits.push(Object.assign({}, ctx.query));
    if (ctx.query.action === 'claim') claimed = true;
    const body = claimed ? '<div class="bonus">Бонус получен. Следующий через 4 ч.</div>'
      : '<div class="bonus"><p>Бонус за онлайн доступен</p><a class="btn" href="game.php?page=bonus&amp;action=claim">Забрать</a></div>';
    // a full game page (menu, planet list, resources) with the bonus box, as GALAXYZ renders page=bonus
    ctx.sendPage('overview', (html) => html.replace('</body>', '<div id="bonusbox">' + body + '</div></body>'));
  });
  return hits;
}
/** The overview served with the star, as the game renders it while the bonus can be taken. */
const STAR = '<div class="infobox tooltip" data-tooltip-content="Online bonus."><a href="game.php?page=bonus"><img src="./styles/theme/gow/img/navigation/star.ico" alt=""></a></div>';
const starRoute = (env) => env.server.route('GET', 'overview', (req, res, ctx) => ctx.sendPage('overview', (html) => html.replace('</body>', STAR + '</body>')));

T.test('(a) the star: page=bonus, then its claim link once; journal «Бонус за онлайн получен»', async () => {
  const env = await G.launch({ settings: isolate() });
  try {
    const hits = bonusRoutes(env);
    starRoute(env);
    const page = await env.game('overview');
    try { await until(() => hits.some((h) => h.action === 'claim'), { timeoutMs: 90000, what: 'claim request' }); }
    catch (e) { console.log(JSON.stringify(hits), JSON.stringify(await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).filter((x) => /bonus|action|stop|pause/.test(x.k)).map((x) => x.k + ' ' + x.w).slice(-15)))); throw e; }
    await sleep(3000);
    assert.deepEqual(hits.map((h) => h.action || null), [null, 'claim'], 'one look, one claim');
    const j = await env.evalOgx(page, () => (OGX.diag.recent({ s: 'B' }) || []).filter((e) => e.k === 'botcore:bonus').map((e) => e.w));
    assert.ok(j.some((w) => /получен/.test(w)), 'journal: ' + JSON.stringify(j));
  } finally { await env.close(); }
}, { timeout: 150000 });

T.test('(b) setting off with the star, or no star: no request to page=bonus', async () => {
  const env = await G.launch({ settings: isolate({ 'botcore.onlineBonus': false }) });
  try {
    const hits = bonusRoutes(env);
    starRoute(env);
    await env.game('overview');
    await sleep(70000);
    assert.equal(hits.length, 0, 'off: nothing');
  } finally { await env.close(); }
  const env2 = await G.launch({ settings: isolate() });
  try {
    const hits = bonusRoutes(env2);
    await env2.game('overview');
    await sleep(70000);
    assert.equal(hits.length, 0, 'no star: nothing');
  } finally { await env2.close(); }
}, { timeout: 200000 });
