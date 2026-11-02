// Verifies the parsing recipes of specs/galaxy.md against fixtures/galaxy-*.
// Runs the recipes inside Chromium (DOMParser, fetch) on http://localhost with routed fixture responses.
// Writes fixtures/galaxy-expected-parse.json.
// Usage: node ogx/tools/check_galaxy.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// ---- recipes (copied verbatim into specs/galaxy.md, section 11) -------------------------------
const RECIPES = String.raw`
const OGX_GALAXY = {};

/** POST helper for OgameX AJAX endpoints (same-origin, session cookie + CSRF). Returns {status, json|text}. */
OGX_GALAXY.post = async (pathAndQuery, params = {}) => {
  const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const body = new URLSearchParams({ ...params, _token: token });
  const res = await fetch(new URL(pathAndQuery, location.origin), {
    method: 'POST', credentials: 'same-origin', redirect: 'follow',
    headers: { 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  const type = res.headers.get('content-type') || '';
  // Logged out: Laravel redirects to /login (fetch follows -> HTML page, res.redirected = true). CSRF mismatch: 419.
  if (res.redirected && /\/login/.test(res.url)) return { status: 401, text: '' };
  return type.includes('json') ? { status: res.status, json: await res.json() } : { status: res.status, text: await res.text() };
};

/** activity object of /ajax/galaxy -> '*' (< 15 min), 15..60 (idle minutes), null (> 60 min or none) */
OGX_GALAXY.activity = (a) => {
  if (!a || a.showActivity === false) return null;
  if (a.showActivity === 15) return '*';
  if (a.showActivity === 60) return a.idleTime;
  return null;
};

/** OGame-style status letters from galaxy player flags. */
OGX_GALAXY.status = (p) => [
  p.isAdmin && 'A', p.isBanned && 'b', p.isOnVacation && 'v', p.isLongInactive ? 'I' : (p.isInactive && 'i'),
  p.isNewbie && 'n', p.isStrong && 's',
].filter(Boolean).join('');

const ogxDebris = (d) => d && { metal: d.resources.metal.amount, crystal: d.resources.crystal.amount,
  deuterium: d.resources.deuterium.amount, requiredShips: d.requiredShips };

/** POST /ajax/galaxy JSON -> {galaxy, system, positions:[...], colonized, me:{...}} (null on error). */
OGX_GALAXY.parseSystem = (json) => {
  if (!json || json.success !== true || !json.system) return null;
  const s = json.system;
  const out = { galaxy: +s.galaxy, system: +s.system, colonized: s.slotsColonized, positions: [], expeditionDebris: null,
    me: { playerId: s.playerId, currentPlanetId: s.currentPlanetId, probes: s.availableProbes, recyclers: s.availableRecyclers,
      pathfinders: s.availablePathfinders, missiles: s.availableMissiles, usedSlots: s.usedFleetSlots, maxSlots: s.maximumFleetSlots,
      canSystemPhalanx: s.canSystemPhalanx } };
  for (const row of s.galaxyContent) {
    if (row.position === 16) { out.expeditionDebris = ogxDebris(row.planets); continue; } // planets is an OBJECT here
    const list = Array.isArray(row.planets) ? row.planets : [];
    const planet = list.find((p) => p.planetType === 1);
    const debris = list.find((p) => p.planetType === 2);
    const moon = list.find((p) => p.planetType === 3);
    if (!planet) continue;                                   // empty slot (debris without a planet is never sent)
    const pl = row.player || {};
    const destroyed = !!planet.isDestroyed;
    out.positions.push({
      position: row.position,
      coords: row.galaxy + ':' + row.system + ':' + row.position,
      planetId: planet.planetId, planetName: planet.planetName, destroyed,
      activity: OGX_GALAXY.activity(planet.activity),
      moon: moon ? { id: moon.planetId, name: moon.planetName, size: moon.size, destroyed: !!moon.isDestroyed,
        activity: OGX_GALAXY.activity(moon.activity) } : null,
      debris: ogxDebris(debris),
      playerId: destroyed ? null : row.playerId, playerName: destroyed ? null : row.playerName,
      status: destroyed ? '' : OGX_GALAXY.status(pl),
      rank: pl.actions?.highscore?.rank ?? null,
      allianceId: pl.allianceId ?? null, allianceTag: pl.allianceTag ?? null, allianceName: pl.allianceName ?? null,
      missions: (planet.availableMissions || []).map((m) => m.missionType),
      canPhalanx: !!row.actions?.phalanxActive, canMissile: !!row.actions?.canMissileAttack,
    });
  }
  return out;
};

/** Rendered DOM row (#galaxyRow1..15 after the game's renderContentGalaxy) -> same essentials, or null if empty. */
OGX_GALAXY.parseRow = (rowEl) => {
  const pos = parseInt(rowEl.id.replace('galaxyRow', ''), 10);
  const planet = rowEl.querySelector('.cellPlanet .microplanet[data-planet-id]');
  if (!planet) return null;
  const act = (el) => {
    const a = el && el.querySelector(':scope > .activity');
    if (!a) return null;
    return a.classList.contains('minute15') ? '*' : parseInt(a.textContent, 10);
  };
  const moonEl = rowEl.querySelector('.cellMoon .micromoon[data-moon-id]');
  const nameEl = rowEl.querySelector('.cellPlayerName .playerName[rel^="player"]');
  const own = rowEl.querySelector('.cellPlayerName .ownPlayerRow');
  const ally = rowEl.querySelector('.cellAlliance [rel^="alliance"]');
  const debrisLis = [...rowEl.querySelectorAll('.cellDebris .debris-content')].map((li) => parseInt(li.textContent.replace(/\D/g, ''), 10));
  const status = [...rowEl.querySelectorAll('.cellPlayerName pre > span[class^="status_abbr_"]')].map((s) => s.className.match(/status_abbr_(\w+)/)[1]);
  return {
    position: pos,
    planetId: +planet.dataset.planetId,
    planetName: rowEl.querySelector('.cellPlanetName > span')?.textContent.trim() ?? null,
    activity: act(planet),
    moonId: moonEl ? +moonEl.dataset.moonId : null,
    moonActivity: act(moonEl),
    playerId: nameEl ? +nameEl.getAttribute('rel').slice(6) : null,
    playerName: nameEl ? nameEl.firstChild.textContent.trim() : (own ? own.textContent.trim() : null),
    own: !!own,
    status,
    allianceId: ally ? +ally.getAttribute('rel').slice(8) : null,
    allianceTag: ally ? ally.firstChild.textContent.trim() : null,
    debris: debrisLis.length ? { metal: debrisLis[0], crystal: debrisLis[1], deuterium: debrisLis[2] } : null,
  };
};

/** POST /ajax/highscore?category=1 HTML fragment (or the /highscore page) -> players */
OGX_GALAXY.parseHighscorePlayers = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const type = +(/var currentType = (\d+);/.exec(html) || [])[1];
  const page = +(/var site = (\d+);/.exec(html) || [])[1];
  const rows = [...doc.querySelectorAll('#ranks.userHighscore > tbody > tr[id^="position"]')].map((tr) => {
    const a = tr.querySelector('.highscoreNameHolder a[href*="/galaxy"]');
    const q = new URL(a.getAttribute('href'), 'http://x').searchParams;
    const ally = tr.querySelector('.ally-tag a');
    const ships = tr.querySelector('td.score span[title]');
    return {
      id: +tr.id.slice(8),
      rank: +tr.querySelector('td.position').textContent.trim(),
      name: tr.querySelector('.playername').textContent.trim(),
      me: tr.classList.contains('myrank'),
      admin: !!tr.querySelector('.playername.status_abbr_admin'),
      homeCoords: q.get('galaxy') + ':' + q.get('system') + ':' + q.get('position'),
      allianceId: ally ? +(/\/alliance\/info\/(\d+)/.exec(ally.getAttribute('href')) || [])[1] : null,
      allianceTag: ally ? ally.textContent.trim().replace(/^\[|\]$/g, '') : null,
      points: parseInt(tr.querySelector('td.score').textContent.replace(/[^\d]/g, ''), 10),
      totalShips: ships ? parseInt(ships.getAttribute('title').split(':').pop().replace(/[^\d]/g, ''), 10) : null,
    };
  });
  const pages = doc.querySelectorAll('select.changeSite option').length - 1; // first option = "own position"
  return { category: 1, type, page, pages, rows };
};

/** POST /ajax/highscore?category=2 HTML fragment -> alliances */
OGX_GALAXY.parseHighscoreAlliances = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('#ranks.allyHighscore > tbody > tr[id^="position"]')].map((tr) => ({
    id: +tr.id.slice(8),
    rank: +tr.querySelector('td.position').textContent.trim(),
    name: tr.querySelector('.ally-name span').textContent.trim(),
    tag: tr.querySelector('.ally-tag a').textContent.trim().replace(/^\[|\]$/g, ''),
    members: +tr.querySelector('td.member_count').textContent.trim(),
    points: parseInt(tr.querySelector('td.score').firstChild.textContent.replace(/[^\d]/g, ''), 10),
    average: parseInt(tr.querySelector('td.score .small').textContent.replace(/[^\d]/g, ''), 10),
  }));
  return { category: 2, type: +(/var currentType = (\d+);/.exec(html) || [])[1], rows };
};

/**
 * Polite sequential galaxy scanner. One request in flight, fixed delay + jitter, stops on auth/CSRF/vacation errors.
 * systems: array of [galaxy, system]. onSystem(parsed) is called per system. Returns {done, stoppedBy}.
 */
OGX_GALAXY.scan = async (systems, { delayMs = 700, jitterMs = 300, onSystem = () => {}, signal } = {}) => {
  let done = 0;
  for (const [g, s] of systems) {
    if (signal?.aborted) return { done, stoppedBy: 'abort' };
    let r;
    try { r = await OGX_GALAXY.post('/ajax/galaxy', { galaxy: g, system: s }); } catch (e) { return { done, stoppedBy: 'network' }; }
    if (r.status === 403) return { done, stoppedBy: 'vacation' };
    if (r.status === 401 || r.status === 419) return { done, stoppedBy: 'auth' };
    if (r.status !== 200 || !r.json) return { done, stoppedBy: 'http' + r.status };
    onSystem(OGX_GALAXY.parseSystem(r.json));
    done++;
    await new Promise((ok) => setTimeout(ok, delayMs + Math.random() * jitterMs));
  }
  return { done, stoppedBy: null };
};
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const seen = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/blank') return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head><meta name="csrf-token" content="Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e"></head><body></body></html>' });
    if (u.pathname === '/ajax/galaxy') {
      const p = new URLSearchParams(req.postData());
      seen.push({ path: u.pathname, body: req.postData(), csrfHeader: req.headers()['x-csrf-token'] });
      const f = { '1:42': 'galaxy-ajax-1-42.json', '1:44': 'galaxy-ajax-1-44-empty.json', '1:45': 'galaxy-ajax-1-45.json' }[p.get('galaxy') + ':' + p.get('system')];
      if (p.get('system') === '46') return route.fulfill({ status: 403, contentType: 'application/json', body: read('galaxy-ajax-vacation-403.json') });
      return route.fulfill({ contentType: 'application/json', body: read(f) });
    }
    if (u.pathname === '/ajax/highscore') {
      seen.push({ path: u.pathname + u.search, body: req.postData() });
      return route.fulfill({ contentType: 'text/html; charset=UTF-8', body: read(u.searchParams.get('category') === '2' ? 'galaxy-highscore-ajax-alliances.html' : 'galaxy-highscore-ajax-players-military.html') });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://localhost/blank');
  await page.addScriptTag({ content: RECIPES + '\nwindow.OGX_GALAXY = OGX_GALAXY;' });

  const fixtures = {
    j4242: JSON.parse(read('galaxy-ajax-1-42.json')),
    j4545: JSON.parse(read('galaxy-ajax-1-45.json')),
    jMoon: JSON.parse(read('galaxy-ajax-1-45-from-moon.json')),
    jDisc: JSON.parse(read('galaxy-ajax-1-42-discoverer.json')),
    jEmpty: JSON.parse(read('galaxy-ajax-1-44-empty.json')),
    hsPage: read('galaxy-highscore-page.html'),
    hsAllies: read('galaxy-highscore-ajax-alliances.html'),
  };
  const result = await page.evaluate(async (fx) => {
    const G = window.OGX_GALAXY;
    const hs = G.parseHighscorePlayers(fx.hsPage);
    const scanned = [];
    const scan = await G.scan([[1, 42], [1, 44], [1, 45], [1, 46], [1, 47]], { delayMs: 10, jitterMs: 0, onSystem: (s) => scanned.push(s.galaxy + ':' + s.system + '=' + s.positions.length) });
    const fetched = await G.post('/ajax/highscore?category=1&type=3&page=1');
    return {
      'galaxy-ajax-1-42.json': G.parseSystem(fx.j4242),
      'galaxy-ajax-1-45.json': G.parseSystem(fx.j4545),
      'galaxy-ajax-1-45-from-moon.json': G.parseSystem(fx.jMoon).positions.map((p) => ({ position: p.position, canPhalanx: p.canPhalanx, canMissile: p.canMissile })),
      'galaxy-ajax-1-42-discoverer.json (expeditionDebris)': G.parseSystem(fx.jDisc).expeditionDebris,
      'galaxy-ajax-1-44-empty.json': G.parseSystem(fx.jEmpty),
      'galaxy-highscore-page.html (first 3 + me)': { ...hs, rows: hs.rows.filter((r) => r.rank <= 3 || r.me) },
      'galaxy-highscore-ajax-alliances.html': G.parseHighscoreAlliances(fx.hsAllies),
      'scan 1:42..1:47 (1:46 answers 403)': { scan, scanned },
      'post /ajax/highscore military (first row)': G.parseHighscorePlayers(fetched.text).rows[0],
    };
  }, fixtures);

  // Live DOM: galaxy-page.html + OgameX's own JS bundle + routed /ajax/galaxy (same harness as render_galaxy.js).
  // (Do not parse the serialized galaxy-rendered-*.html: the game nests <a> inside <a>, which an HTML parser restructures.)
  const SRC = '/tmp/claude-0/-home-claude/1ebb7366-d4fd-5fac-899e-5244b2310d13/scratchpad/src/OGameX/resources/js/ingame/';
  const bundle = ['jquery-1.12.4.min.js', 'vendor/jquery-ui-1.12.1.js', 'vendor/anythingslider-1.9.7.js', 'vendor/jquery.ba-bbq-1.4pre.js',
    'vendor/jquery.colorpicker.js', 'jquery.js', 'inventory.js', 'jquery-spinners.js', 'messages.js', 'tooltips.js', 'trader.js',
    'timerhandler.js', 'e7c74974620fa35b197315ebdbb8c2.js', 'messages-pagination.js'].map((f) => fs.readFileSync(SRC + f, 'utf8')).join('\n;\n');
  const live = await browser.newPage();
  await live.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/galaxy') return route.fulfill({ contentType: 'text/html; charset=UTF-8', body: read('galaxy-page.html') });
    if (/^\/build\/assets\/ingame-.*\.js$/.test(u.pathname)) return route.fulfill({ contentType: 'application/javascript', body: bundle });
    if (u.pathname === '/ajax/galaxy') return route.fulfill({ contentType: 'application/json', body: read('galaxy-ajax-1-42.json') });
    return route.fulfill({ status: 204, body: '' });
  });
  await live.goto('http://localhost/galaxy?cp=1');
  await live.waitForSelector('#galaxyRow8 .microplanet[data-planet-id]', { state: 'attached' });
  await live.addScriptTag({ content: RECIPES + '\nwindow.OGX_GALAXY = OGX_GALAXY;' });
  result['galaxy-page.html + galaxy-ajax-1-42.json (live DOM)'] = await live.evaluate(() =>
    [...document.querySelectorAll('#galaxyContent .galaxyRow.ctContentRow[id^="galaxyRow"]')].map(window.OGX_GALAXY.parseRow).filter(Boolean));
  await browser.close();

  // ---- assertions ----
  const s42 = result['galaxy-ajax-1-42.json'];
  assert.deepStrictEqual(s42.positions.map((p) => [p.position, p.activity, p.status]),
    [[4, '*', 's'], [6, null, 'i'], [8, '*', ''], [11, null, 'vI'], [13, 37, 'n']]);
  assert.deepStrictEqual(s42.positions[2].moon, { id: 5, name: 'Moon', size: 8660, destroyed: false, activity: 23 });
  assert.deepStrictEqual(s42.positions[2].debris, { metal: 12400, crystal: 7800, deuterium: 0, requiredShips: 1 });
  const s45 = result['galaxy-ajax-1-45.json'];
  assert.deepStrictEqual(s45.positions.map((p) => [p.position, p.playerId, p.activity, p.status]),
    [[1, 1, null, 'An'], [3, null, null, ''], [6, 233, 18, ''], [9, 150, '*', 's']]);
  assert.strictEqual(s45.positions[2].moon.activity, '*');
  assert.deepStrictEqual(s45.positions[2].missions, [3, 6, 1]);
  assert.deepStrictEqual(s45.positions[3].missions, [3, 6, 1, 5]);
  assert.deepStrictEqual(result['galaxy-ajax-1-45-from-moon.json'].map((p) => p.canPhalanx), [false, false, true, true]);
  assert.deepStrictEqual(result['galaxy-ajax-1-42-discoverer.json (expeditionDebris)'], { metal: 8800, crystal: 5600, deuterium: 1200, requiredShips: 1 });
  assert.strictEqual(result['galaxy-ajax-1-44-empty.json'].positions.length, 0);
  const rr = result['galaxy-page.html + galaxy-ajax-1-42.json (live DOM)'];
  assert.deepStrictEqual(rr.map((r) => [r.position, r.planetId, r.activity, r.playerId, r.status.join(',')]),
    [[4, 61, '*', 150, 'strong'], [6, 62, null, 201, 'inactive'], [8, 1, '*', null, ''], [11, 63, null, 202, 'vacation,longinactive'], [13, 64, 37, 204, 'noob']]);
  assert.deepStrictEqual([rr[2].moonId, rr[2].moonActivity, rr[2].own, rr[2].playerName], [5, 23, true, 'Commander Vega']);
  assert.deepStrictEqual(rr[2].debris, { metal: 12400, crystal: 7800, deuterium: 0 });
  assert.deepStrictEqual([rr[0].allianceId, rr[0].allianceTag], [12, 'NOVA']);
  const hs = result['galaxy-highscore-page.html (first 3 + me)'];
  assert.strictEqual(hs.pages, 3);
  assert.deepStrictEqual(hs.rows.find((r) => r.me), { id: 108, rank: 37, name: 'Commander Vega', me: true, admin: false, homeCoords: '1:42:8', allianceId: null, allianceTag: null, points: 48213, totalShips: null });
  assert.strictEqual(result['galaxy-highscore-ajax-alliances.html'].rows[2].tag, 'NOVA');
  assert.deepStrictEqual(result['scan 1:42..1:47 (1:46 answers 403)'].scan, { done: 3, stoppedBy: 'vacation' });
  assert.ok(result['post /ajax/highscore military (first row)'].totalShips > 0);
  assert.ok(seen.every((r) => r.path !== '/ajax/galaxy' || (r.csrfHeader && /_token=/.test(r.body))));

  fs.writeFileSync(path.join(FIX, 'galaxy-expected-parse.json'), JSON.stringify(result, null, 1) + '\n');
  console.log('OK: all galaxy recipe assertions passed; wrote fixtures/galaxy-expected-parse.json');
})().catch((e) => { console.error(e); process.exit(1); });
