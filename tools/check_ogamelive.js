// Verifies the parsing recipes and formulas of specs/ogamelive.md against existing fixtures.
// Usage: node ogx/tools/check_ogamelive.js            (prints results, exits 1 on mismatch)
//        node ogx/tools/check_ogamelive.js --write    (also writes fixtures/ogamelive-expected-parse.json)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// ---- recipes (copied verbatim into specs/ogamelive.md, section 9) ---------------------------
const RECIPES = String.raw`
const OGX_LIVE = {};

/** AppUtil::formatNumber / formatNumberLong / tooltip text -> number. "152,347" -> 152347, "+4,128" -> 4128,
 *  "-2,754" -> -2754, "1.25Mn" -> 1250000, "1.5M" -> 1500000, "2B" -> 2e9. Never use OGame Live's split('.'). */
OGX_LIVE.num = (s) => {
  s = String(s ?? '').replace(/\s+/g, '').replace(/^\+/, '');
  const m = /^(-?[\d,]*\.?\d+)(Mn|M|B|K)?$/i.exec(s);
  if (!m) return parseInt(s.replace(/[^\d-]/g, ''), 10) || 0;
  const v = parseFloat(m[1].replace(/,/g, ''));
  const mul = { mn: 1e6, m: 1e6, b: 1e9, k: 1e3 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(v * mul);
};

/** "g:s:p" from "[g:s:p]" */
OGX_LIVE.coords = (s) => { const m = /(\d+):(\d+):(\d+)/.exec(s || ''); return m ? m[1] + ':' + m[2] + ':' + m[3] : null; };

/** Planet list -> bodies. Storage key = "p<planetId>" / "m<moonId>" (NOT the .smallplanet id, which is an index). */
OGX_LIVE.parseBodies = (doc, base) => [...doc.querySelectorAll('#planetList > .smallplanet')].map((el) => {
  const ml = el.querySelector('a.moonlink');
  return {
    planetId: +el.dataset.planetId,
    rowId: el.id,                                                     // "planet-1" (index, use only for DOM lookups)
    name: el.querySelector('.planet-name').textContent.trim(),
    coords: OGX_LIVE.coords(el.querySelector('.planet-koords').textContent),
    moonId: ml ? +new URL(ml.getAttribute('href'), base).searchParams.get('cp') : null,
    building: !!el.querySelector('a.constructionIcon'),
  };
});

/** Current body from metas + planet list (ogame-planet-type is always "planet" in OgameX). */
OGX_LIVE.currentBody = (doc, base) => {
  const id = +doc.querySelector('meta[name="ogame-planet-id"]').content;
  const bodies = OGX_LIVE.parseBodies(doc, base);
  const asMoon = bodies.find((b) => b.moonId === id);
  return asMoon ? { key: 'm' + id, id, isMoon: true, planetId: asMoon.planetId, coords: asMoon.coords }
                : { key: 'p' + id, id, isMoon: false, planetId: id, coords: doc.querySelector('meta[name="ogame-planet-coordinates"]').content };
};

/** Resource-bar tooltips (raw title, read BEFORE Tipped strips it). Row order as in OGame:
 *  M/C/D: Available, Storage capacity, Current production (per HOUR), Den Capacity. Energy: Available, Production, Consumption. */
OGX_LIVE.parseResourceTooltips = (doc) => {
  const out = {};
  for (const [k, id] of [['M', 'metal_box'], ['C', 'crystal_box'], ['D', 'deuterium_box'], ['E', 'energy_box']]) {
    const t = doc.getElementById(id)?.getAttribute('title') || '';
    const i = t.indexOf('|'); if (i < 0) continue;
    const tip = new DOMParser().parseFromString(t.slice(i + 1), 'text/html');
    const v = [...tip.querySelectorAll('tr td span')].map((s) => OGX_LIVE.num(s.textContent));
    out[k] = k === 'E' ? { dispo: v[0], prod: v[1], conso: v[2] } : { dispo: v[0], capa: v[1], prod: v[2], cache: v[3] };
  }
  return out;
};

/** Inline reloadResources({...}) -> exact floats (production is PER SECOND). Preferred over tooltips. */
OGX_LIVE.parseInlineResources = (html) => {
  const src = (html.match(/reloadResources\(\{[\s\S]*?\}\);/) || [''])[0];
  const num = '(-?[\\d.]+(?:[eE][-+]?\\d+)?)';
  const out = {};
  for (const [k, n] of [['M', 'metal'], ['C', 'crystal'], ['D', 'deuterium']]) {
    const m = src.match(new RegExp('"' + n + '":\\s*\\{\\s*"amount":\\s*' + num + ',\\s*"storage":\\s*' + num + ',[\\s\\S]*?"production":\\s*' + num));
    if (m) out[k] = { dispo: +m[1], capa: +m[2], prod: +m[3] * 3600 };         // OGame Live keeps prod per hour
  }
  const e = src.match(new RegExp('"energy":\\s*\\{\\s*"amount":\\s*' + num));
  if (e) out.E = { dispo: +e[1] };
  return out;
};

/** Levels on /resources, /facilities, /research (key = class_name, same names as OGame Live constants). */
OGX_LIVE.parseLevels = (doc) => Object.fromEntries([...doc.querySelectorAll('#technologies li.technology[data-technology]')]
  .map((li) => [li.classList[1], +(li.querySelector('span.level, span.amount')?.dataset.value || 0)]));

/** Active build timers from inline JS (seconds from render time). data-start/data-end on the li are FAKE. */
OGX_LIVE.parseBuildTimers = (html) => {
  const t = {};
  for (const m of html.matchAll(/new CountdownTimer\('(buildingCountdown|researchCountdown|unitCountdown)',\s*(\d+)/g)) t[m[1]] = +m[2];
  const active = /<table[^>]*class="construction active"[\s\S]*?<th colspan="2">([^<]+)<\/th>[\s\S]*?<span class="level">[^<\d]*(\d+)<\/span>[\s\S]*?new CountdownTimer\('buildingCountdown'/.exec(html);
  const cancel = /cancelbuilding\((\d+),\s*(\d+),/.exec(html);
  return { ...t, buildingTitle: active ? active[1].trim() : null, buildingTarget: active ? +active[2] : null, buildingObjectId: cancel ? +cancel[1] : null };
};

/** /resources/settings -> {metal:100, cristal:100, deut:100, ces:100, cef:100, sat:100, foreuse:100} (select value 0..10, x10) */
OGX_LIVE.parseResourceSettings = (doc) => {
  const keys = { 1: 'metal', 2: 'cristal', 3: 'deut', 4: 'ces', 12: 'cef', 212: 'sat', 217: 'foreuse' };
  const out = {};
  for (const s of doc.querySelectorAll('table.listOfResourceSettingsPerPlanet select[name^="last"]')) {
    const id = +s.name.slice(4); if (keys[id]) out[keys[id]] = +s.value * 10;
  }
  const f = /(\d+)%/.exec(doc.querySelector('span.factorkey')?.textContent || '');
  out.factor = f ? +f[1] : null;
  return out;
};

/** /fleet -> ships on the current body (by class_name), slots. Use the FIRST #slots (the id is duplicated). */
OGX_LIVE.parseFleetPage = (doc) => {
  const fleet = {};
  for (const li of doc.querySelectorAll('#fleet1 #technologies li.technology[data-technology]'))
    fleet[li.classList[1]] = +li.querySelector('span.amount').dataset.value;
  const slots = doc.querySelector('#fleet1 #slots');
  const pair = (el) => { const m = /(\d+)\s*\/\s*(\d+)/.exec(el?.textContent || ''); return m ? { used: +m[1], max: +m[2], label: el.querySelector('span')?.textContent.trim() } : null; };
  const spans = slots ? slots.querySelectorAll(':scope > .fleft > span.advice') : [];
  return { fleet, slots: pair(spans[0]), expeSlots: pair(spans[1]) };
};

/** Localized ship title -> id, from any page listing ships (/shipyard, /fleet): li[aria-label]. Replaces localization.xml. */
OGX_LIVE.parseTitles = (doc) => Object.fromEntries([...doc.querySelectorAll('li.technology[data-technology][aria-label]')]
  .map((li) => [li.getAttribute('aria-label').trim(), +li.dataset.technology]));

/** GET /ajax/techtree?tab=2&object_id=<shipId> -> effective (research + class) ship values.
 *  The span data-value/-base-value/-bonus attributes are HARD-CODED constants: read the visible text. */
OGX_LIVE.parseShipProps = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const row = (cls) => { const s = doc.querySelector('table.combat_unit_details tr.' + cls + ' td > span'); return s ? OGX_LIVE.num(s.textContent) : null; };
  return { structural: row('structural_integrity'), shield: row('shield_strength'), attack: row('attack_strength'),
           speed: row('speed'), capacity: row('cargo_capacity'), consumption: row('fuel_consumption') };
};

/** GET /overlay/server-settings -> numbers OGame Live took from serverData.xml */
OGX_LIVE.parseServerSettings = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const txt = (k) => doc.querySelector('server-settings-icon.' + k)?.parentElement.querySelector('span')?.textContent || '';
  const x = (k) => +(/x\s*([\d.]+)/.exec(txt(k)) || [])[1] || null;
  return { economySpeed: x('speedfactor'), researchSpeed: x('speedfactor_research'), fleetSpeedWar: x('fleetspeed_war'),
           fleetSpeedHolding: x('fleetspeed_holding'), fleetSpeedPeaceful: x('fleetspeed_peace'),
           galaxies: +(/(\d+)\s*$/.exec(txt('number_galaxies').trim()) || [])[1] || null, systems: 499, lifeform: false };
};

/** POST /ajax/highscore (category=1,type=0,page=1) HTML -> points of rank 1 (OGame Live "top_score"). */
OGX_LIVE.parseTopScore = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tr = doc.querySelector('#ranks tbody tr[id^="position"]');
  return tr ? { rank: +tr.id.slice(8), points: OGX_LIVE.num(tr.querySelector('td.score').textContent) } : null;
};

/** Event list -> OGame Live "flights" objects (keyed by row id). ownBodies: [{planetId, coords, moonId}], titles: {title:id}. */
OGX_LIVE.eventListToFlights = (html, ownBodies, titles, serverOffsetMs) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const shipKey = { 202: 'transporterSmall', 203: 'transporterLarge', 204: 'fighterLight', 205: 'fighterHeavy', 206: 'cruiser', 207: 'battleship',
    208: 'colonyShip', 209: 'recycler', 210: 'espionageProbe', 211: 'bomber', 212: 'solarSatellite', 213: 'destroyer', 214: 'deathstar',
    215: 'interceptor', 217: 'resbuggy', 218: 'reaper', 219: 'explorer' };
  const rows = [...doc.querySelectorAll('#eventContent > tbody > tr.eventFleet:not(.partnerInfo)')];
  const ids = new Set(rows.map((tr) => tr.id.replace('eventRow-', '')));
  const flights = {};
  for (const tr of rows) {
    const rawId = tr.id.replace('eventRow-', '');
    if (rawId.startsWith('union')) continue;
    const id = +rawId, ret = tr.dataset.returnFlight === 'true';
    const syntheticReturn = ret && id > 999999 && (ids.has(String(id - 999999)) || ids.has(String(id - 999999 + 888888)));
    const holdEnd = !ret && id > 888888 && ids.has(String(id - 888888 + 999999));
    const typeOf = (sel) => { const f = tr.querySelector(sel + ' figure.planetIcon'); return f ? (f.classList.contains('moon') ? 'moon' : f.classList.contains('tf') ? 'debrisField' : 'planet') : 'deepSpace'; };
    const home = OGX_LIVE.coords(tr.querySelector('td.coordsOrigin a')?.textContent);   // left column = home side
    const far = OGX_LIVE.coords(tr.querySelector('td.destCoords a')?.textContent);
    const from = ret ? far : home, dest = ret ? home : far;
    const destType = ret ? typeOf('td.originFleet') : typeOf('td.destFleet');
    const body = ownBodies.find((b) => b.coords === dest);
    const tipEl = tr.querySelector('td.icon_movement > span[title], td.icon_movement_reserve > span[title]');
    const tip = new DOMParser().parseFromString(tipEl?.getAttribute('title') || '', 'text/html');
    const vals = [...tip.querySelectorAll('table.fleetinfo td.value')];
    const [M, C, D] = vals.slice(-3).map((td) => OGX_LIVE.num(td.textContent));
    const vaissels = {};
    for (const td of vals.slice(0, -3)) {
      const t = td.previousElementSibling.textContent.replace(/:\s*$/, '').trim();
      vaissels[shipKey[titles[t]] || t] = OGX_LIVE.num(td.textContent);
    }
    flights[id] = {
      eventId: id,
      realMissionId: syntheticReturn ? id - 999999 : holdEnd ? id - 888888 : id,
      synthetic: syntheticReturn ? 'return' : holdEnd ? 'holdEnd' : null,
      arrivalTime: +tr.dataset.arrivalTime * 1000 - serverOffsetMs,   // local ms; offset = serverEpochMs - Date.now()
      destination: body && destType !== 'debrisField' && destType !== 'deepSpace' ? (destType === 'moon' ? 'm' + body.moonId : 'p' + body.planetId) : null,
      destinationType: destType,
      coords: { from, dest, fromType: ret ? typeOf('td.destFleet') : typeOf('td.originFleet'), destType },
      missionType: +tr.dataset.missionType,
      returnFlight: ret,
      own: ownBodies.some((b) => b.coords === home),
      detailsFleet: parseInt(tr.querySelector('td.detailsFleet span')?.textContent, 10) || 0,
      resources: { M, C, D },
      vaissels,
    };
  }
  return flights;
};

/** OGame Live worker.js mainLoop, one body: project amounts from lastTime to now (prod is per hour). */
OGX_LIVE.project = (p, nowMs) => {
  const q = JSON.parse(JSON.stringify(p));
  const dt = q.lastTime > 0 ? (nowMs - q.lastTime) / 1000 : 0;
  for (const k of ['M', 'C', 'D']) {
    const r = q[k];
    if (r.dispo < r.capa && r.prod == 0 && r.lastprod > 0) r.prod = r.lastprod;
    r.dispo += r.prod / 3600 * dt;
    if (r.dispo >= r.capa && r.prod > 0) { r.dispo = r.capa; r.lastprod = r.prod; r.prod = 0; }
  }
  q.lastTime = nowMs;
  return q;
};

/** Seconds until storage is full (not in OGame Live; added for the port). Infinity when not growing. */
OGX_LIVE.secondsUntilFull = (r) => (r.dispo >= r.capa ? 0 : r.prod > 0 ? (r.capa - r.dispo) / (r.prod / 3600) : Infinity);

/** OGame Live dataManager.computeNeededShip */
OGX_LIVE.neededShips = (amount, capacity) => (capacity > 0 ? Math.ceil(amount / capacity) : 0);

/** Cost overlay (OGame Live planetsProductionDisplay.display, lines 677-710) + time until affordable (port addition). */
OGX_LIVE.costOverlay = (cost /* {M,C,D,E} */, prod /* body prod */, capSC, capLC) => {
  const out = { total: 0, missingTotal: 0, rows: {}, secondsUntilAffordable: 0 };
  for (const k of ['M', 'C', 'D']) {
    const need = cost[k] || 0; out.total += need;
    const diff = prod[k].dispo - need;                         // OGame Live "missing" (signed)
    const missing = Math.max(0, -diff);
    out.missingTotal += missing;
    out.rows[k] = { need, diff, sc: OGX_LIVE.neededShips(Math.abs(diff), capSC), lc: OGX_LIVE.neededShips(Math.abs(diff), capLC) };
    if (missing > 0) out.secondsUntilAffordable = Math.max(out.secondsUntilAffordable, prod[k].prod > 0 ? missing / (prod[k].prod / 3600) : Infinity);
  }
  out.sc = OGX_LIVE.neededShips(out.missingTotal, capSC); out.lc = OGX_LIVE.neededShips(out.missingTotal, capLC);
  return out;
};

/** Expedition max find, OgameX rules (ExpeditionMission.php:1020-1137). Upper bound of a NORMAL find of metal. */
OGX_LIVE.expeditionMaxFind = ({ topPoints, playerClass, economySpeed, hasPathfinder = false, rewardMultiplier = 1 }) => {
  const steps = [[1e4, 4e4], [1e5, 5e5], [1e6, 12e5], [5e6, 18e5], [25e6, 24e5], [5e7, 3e6], [75e6, 36e5], [1e8, 42e5]];
  let base = 5e6; for (const [lim, v] of steps) if (topPoints < lim) { base = v; break; }
  let max = Math.floor(base * (playerClass === 'explorer' ? 1.5 * economySpeed : 1));
  if (hasPathfinder) max *= 2;
  max = Math.floor(max * rewardMultiplier);
  return { metal: max, crystal: Math.floor(max * 2 / 3), deuterium: Math.floor(max / 3), min: Math.max(1, Math.floor(base * 0.1)) };
};
`;

const expected = {
  bodiesPlanet: [
    { planetId: 1, rowId: 'planet-1', name: 'Homeworld', coords: '1:42:8', moonId: 5, building: false },
  ],
  currentPlanet: { key: 'p1', id: 1, isMoon: false, planetId: 1, coords: '1:42:8' },
  currentMoon: { key: 'm5', id: 5, isMoon: true, planetId: 1, coords: '1:42:8' },
  tooltips: { M: { dispo: 152347, capa: 255000, prod: 4128, cache: 0 } },
  inline: { M: { dispo: 152347.29861111, capa: 255000 } },
  costOverlay: { total: 7500, missingTotal: 4500, secondsUntilAffordable: 4000, sc: 1, lc: 1 },
  techtree203: { structural: 21600, shield: 40, attack: 8, speed: 22500, capacity: 41250, consumption: 50 },
  num: { '152,347': 152347, '+4,128': 4128, '-2,754': -2754, '1.25Mn': 1250000, '1.5M': 1500000, '2B': 2000000000 },
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const files = {
    planet: read('layout-overview-planet.html'), moon: read('layout-overview-moon.html'),
    bover: read('buildings-overview.html'), bres: read('buildings-resources.html'), bresearch: read('buildings-research.html'),
    bfac: read('buildings-facilities.html'), bset: read('buildings-resource-settings.html'), byard: read('buildings-shipyard.html'),
    fleet: read('fleet-dispatch-planet.html'), evl: read('fleet-eventlist.html'), tt: read('ogamelive-techtree-tab2-203.html'),
    ss: read('layout-overlay-server-settings.html'), hs: read('galaxy-highscore-ajax-players-page2.html'),
  };
  const res = await page.evaluate(([R, f]) => {
    eval(R + ';window.OGX_LIVE = OGX_LIVE;');
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    const L = window.OGX_LIVE;
    const base = 'http://localhost/overview';
    const own = L.parseBodies(P(f.planet), base);
    const titles = L.parseTitles(P(f.byard));
    const fleetDoc = P(f.fleet);
    const nums = {}; for (const s of ['152,347', '+4,128', '-2,754', '1.25Mn', '1.5M', '2B']) nums[s] = L.num(s);
    const prod = { M: { dispo: 1000, capa: 10000, prod: 3600 }, C: { dispo: 9990, capa: 10000, prod: 3600 }, D: { dispo: 0, capa: 10000, prod: 0 }, lastTime: 1000 };
    return {
      num: nums,
      bodiesPlanet: own,
      currentPlanet: L.currentBody(P(f.planet), base),
      currentMoon: L.currentBody(P(f.moon), base),
      tooltips: L.parseResourceTooltips(P(f.planet)),
      tooltipsMoon: L.parseResourceTooltips(P(f.moon)),
      inline: L.parseInlineResources(f.planet),
      levelsResources: L.parseLevels(P(f.bres)),
      levelsResearch: L.parseLevels(P(f.bresearch)),
      levelsFacilities: L.parseLevels(P(f.bfac)),
      timersOverview: L.parseBuildTimers(f.bover),
      timersResources: L.parseBuildTimers(f.bres),
      resourceSettings: L.parseResourceSettings(P(f.bset)),
      fleetPage: L.parseFleetPage(fleetDoc),
      titlesShipyard: titles,
      techtree203: L.parseShipProps(f.tt),
      serverSettings: L.parseServerSettings(f.ss),
      topScorePage2: L.parseTopScore(f.hs),
      flights: L.eventListToFlights(f.evl, own, titles, 0),
      project10s: L.project(prod, 11000),
      untilFull: { M: L.secondsUntilFull(prod.M), C: L.secondsUntilFull(prod.C) },
      costOverlay: L.costOverlay({ M: 5000, C: 2000, D: 500 }, { ...prod, D: { dispo: 0, capa: 10000, prod: 1800 } }, 6250, 41250),
      expedition: [
        L.expeditionMaxFind({ topPoints: 21339, playerClass: 'miner', economySpeed: 2 }),
        L.expeditionMaxFind({ topPoints: 21339, playerClass: 'explorer', economySpeed: 2, hasPathfinder: true }),
      ],
    };
  }, [RECIPES, files]);
  await browser.close();

  let bad = 0;
  const cmp = (k, exp, got) => {
    for (const kk of Object.keys(exp)) {
      const e = exp[kk], g = got?.[kk];
      if (e && typeof e === 'object' && !Array.isArray(e)) { cmp(k + '.' + kk, e, g); continue; }
      if (Array.isArray(e)) { e.forEach((x, i) => cmp(k + '.' + kk + '[' + i + ']', x, g?.[i])); continue; }
      if (e !== g) { bad++; console.log('MISMATCH', k + '.' + kk, 'expected', e, 'got', g); }
    }
  };
  for (const k of Object.keys(expected)) cmp(k, expected[k], res[k]);
  console.log(JSON.stringify(res, null, 1));
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(FIX, 'ogamelive-expected-parse.json'), JSON.stringify(res, null, 2) + '\n');
  console.error(bad ? `${bad} mismatches` : 'all expected values match');
  process.exit(bad ? 1 : 0);
})();
