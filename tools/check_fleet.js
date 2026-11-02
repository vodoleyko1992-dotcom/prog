// Verifies the parsing recipes of specs/fleet.md against fixtures/fleet-*.
// Usage: node ogx/tools/check_fleet.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// ---- recipes (copied verbatim into specs/fleet.md, section 12) -------------------------------
const RECIPES = String.raw`
const OGX_FLEET = {};
/** "1:42:8" from "[1:42:8]" (any whitespace) */
OGX_FLEET.coords = (s) => { const m = /\[?\s*(\d+):(\d+):(\d+)\s*\]?/.exec(s || ''); return m ? m[1] + ':' + m[2] + ':' + m[3] : null; };
/** Parses AppUtil::formatNumberLong() output: "31,200" -> 31200, "1.25Mn" -> 1250000, "106" -> 106 */
OGX_FLEET.num = (s) => {
  s = String(s || '').trim();
  const mn = /^([\d.]+)\s*Mn$/i.exec(s);
  if (mn) return Math.round(parseFloat(mn[1]) * 1e6);
  return parseInt(s.replace(/[^\d-]/g, ''), 10) || 0;
};
/** Tooltip HTML (title attribute) -> {ships:{name:count}, metal, crystal, deuterium} */
OGX_FLEET.parseFleetTooltip = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = { ships: {}, metal: 0, crystal: 0, deuterium: 0 };
  // Every value cell is td.value; the LAST 3 are Metal, Crystal, Deuterium (fixed order in the template),
  // all earlier ones are ships ("<td>Title:</td><td class=value>n</td>"). Labels are English ship titles.
  const vals = [...doc.querySelectorAll('table.fleetinfo td.value')];
  [out.metal, out.crystal, out.deuterium] = vals.slice(-3).map((td) => OGX_FLEET.num(td.textContent));
  for (const td of vals.slice(0, -3)) out.ships[td.previousElementSibling.textContent.replace(/:\s*$/, '').trim()] = OGX_FLEET.num(td.textContent);
  return out;
};
/** GET /ajax/fleet/eventlist/fetch body -> rows */
OGX_FLEET.parseEventList = (html, ownCoords /* Set of "g:s:p" */) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('#eventContent > tbody > tr.eventFleet:not(.partnerInfo)')];
  const ids = new Set(rows.map((tr) => tr.id.replace('eventRow-', '')));
  return rows.map((tr) => {
    const rawId = tr.id.replace('eventRow-', '');            // "1201", "1001200", "union7"
    const isUnion = rawId.startsWith('union');
    const id = isUnion ? null : parseInt(rawId, 10);
    const ret = tr.dataset.returnFlight === 'true';
    const recall = tr.querySelector('a.recallFleet');
    let realMissionId = recall ? parseInt(recall.dataset.fleetId, 10) : id;
    let synthetic = null;                                     // 'return' | 'holdEnd' | null
    if (!isUnion && ret && id > 999999 && (ids.has(String(id - 999999)) || ids.has(String(id - 999999 + 888888)))) { synthetic = 'return'; realMissionId = id - 999999; }
    else if (!isUnion && !ret && id > 888888 && ids.has(String(id - 888888 + 999999))) { synthetic = 'holdEnd'; realMissionId = id - 888888; }
    const txt = (sel) => (tr.querySelector(sel) || {}).textContent || '';
    const fig = (sel) => { const f = tr.querySelector(sel + ' figure.planetIcon'); return f ? (f.classList.contains('moon') ? 3 : f.classList.contains('tf') ? 2 : 1) : (tr.querySelector(sel + ' .deep-space-text') ? 4 : null); };
    // Display columns: for return rows the template swaps origin/destination, so
    // coordsOrigin is ALWAYS the side the fleet started from originally (own planet for own fleets).
    const left = OGX_FLEET.coords(txt('td.coordsOrigin a'));
    const right = OGX_FLEET.coords(txt('td.destCoords a'));
    const tipEl = tr.querySelector('td.icon_movement > span[title], td.icon_movement_reserve > span[title]');
    const tip = tipEl ? OGX_FLEET.parseFleetTooltip(tipEl.getAttribute('title')) : null;
    const own = ownCoords ? ownCoords.has(left) : null;
    const type = parseInt(tr.dataset.missionType, 10);
    const status = own === null ? null : own ? 'friendly' : ([1, 2, 6, 9, 10].includes(type) ? 'hostile' : 'neutral');
    return {
      rowId: isUnion ? rawId : id, realMissionId, synthetic, isUnion,
      missionType: type, returnFlight: ret,
      arrival: parseInt(tr.dataset.arrivalTime, 10),          // unix seconds (server clock)
      from: ret ? right : left, fromType: ret ? fig('td.destFleet') : fig('td.originFleet'),
      to: ret ? left : right, toType: ret ? fig('td.originFleet') : fig('td.destFleet'),
      units: parseInt(txt('td.detailsFleet span'), 10),
      recallable: !!recall, own, status, tooltip: tip,
    };
  });
};
/** /fleet/movement document -> rows */
OGX_FLEET.parseMovement = (doc) => [...doc.querySelectorAll('#movement .fleetDetails[id^="fleet"]')].map((el) => {
  const id = parseInt(el.id.slice(5), 10);
  const timer = el.querySelector('span.timer');
  const next = el.querySelector('span.nextTimer');
  const tsFromTitle = (t) => { const m = /(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d):(\d\d)/.exec(t || ''); return m ? Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]) / 1000 : null; };
  return {
    id, missionType: parseInt(el.dataset.missionType, 10), returnFlight: el.dataset.returnFlight === '1',
    arrival: parseInt(el.dataset.arrivalTime, 10),
    status: ['hostile', 'neutral', 'friendly'].find((c) => el.querySelector('span.mission').classList.contains(c)),
    timer: tsFromTitle(timer && timer.getAttribute('title')),           // server-local (UTC by default) wall clock
    returnArrival: next ? tsFromTitle(next.getAttribute('title')) : null,
    origin: OGX_FLEET.coords(el.querySelector('.originCoords a').textContent),
    destination: OGX_FLEET.coords(el.querySelector('.destinationCoords a').textContent),
    recallId: (el.querySelector('a.recallFleet') || { dataset: {} }).dataset.fleetId || null,
    tooltip: OGX_FLEET.parseFleetTooltip(el.querySelector('#bl' + id + ' .htmlTooltip').outerHTML),
  };
});
/** Inline vars of /fleet (no game JS needed): regex over the page HTML */
OGX_FLEET.parseDispatchInline = (html) => {
  const grab = (re) => { const m = re.exec(html); return m ? m[1] : null; };
  const json = (name) => { const s = grab(new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\});')); return s ? JSON.parse(s) : null; };
  const ships = [...(grab(/var shipsOnPlanet = \[([\s\S]*?)\];/) || '').matchAll(/"id":\s*(\d+),\s*"number":\s*(\d+)/g)].map((m) => ({ id: +m[1], number: +m[2] }));
  return {
    checkTargetUrl: grab(/var checkTargetUrl = "([^"]+)"/), sendFleetUrl: grab(/var sendFleetUrl = "([^"]+)"/),
    currentPlanet: json('currentPlanet'), targetPlanet: json('targetPlanet'), shipsOnPlanet: ships,
    mission: +grab(/var mission = (\d+);/), fleetCount: +grab(/var fleetCount = (\d+);/), maxFleetCount: +grab(/var maxFleetCount = (\d+);/),
    metalOnPlanet: +grab(/var metalOnPlanet = (\d+);/), crystalOnPlanet: +grab(/var crystalOnPlanet = (\d+);/), deuteriumOnPlanet: +grab(/var deuteriumOnPlanet = (\d+);/),
    speedFactors: { peaceful: +grab(/SPEEDFAKTOR_FLEET_PEACEFUL = ([\d.]+);/), war: +grab(/SPEEDFAKTOR_FLEET_WAR = ([\d.]+);/), holding: +grab(/SPEEDFAKTOR_FLEET_HOLDING = ([\d.]+);/) },
    maxGalaxy: +grab(/var MAX_GALAXY = (\d+);/), maxSystem: +grab(/var MAX_SYSTEM = (\d+);/),
  };
};
/** /fleet ship list from the DOM (#technologies li[data-technology]) */
OGX_FLEET.parseDispatchShips = (doc) => Object.fromEntries([...doc.querySelectorAll('#fleet1 #technologies li[data-technology]')].map((li) => [li.dataset.technology, parseInt(li.querySelector('span.amount').dataset.value, 10)]));
/** POST /ajax/phalanx/scan JSON -> rows */
OGX_FLEET.parsePhalanx = (json) => {
  if (json.is_error) return { error: json.error_message, rows: [] };
  const doc = new DOMParser().parseFromString(json.content_html, 'text/html');
  return { error: null, rows: [...doc.querySelectorAll('#phalanxEventContent > div.eventFleet')].map((el) => ({
    rowId: parseInt(el.id.replace('eventRow-', ''), 10), missionType: +el.dataset.missionType, returnFlight: el.dataset.returnFlight === 'true',
    arrival: +el.dataset.arrivalTime, direction: el.querySelector('li.descFleet').textContent.trim(),
    from: OGX_FLEET.coords(el.querySelector('li.coordsOrigin a').textContent), to: OGX_FLEET.coords(el.querySelector('li.destCoords a').textContent),
    units: parseInt(el.querySelector('li.detailsFleet span').textContent, 10), speed: +el.querySelector('li.baseSpeed').textContent,
    ships: Object.fromEntries([...doc.querySelectorAll('#' + el.querySelector('li.detailsFleet span').getAttribute('rel') + ' tr')].filter((tr) => tr.querySelector('td.value')).map((tr) => [tr.cells[0].textContent.replace(':', '').trim(), parseInt(tr.querySelector('td.value').textContent.replace(/\./g, ''), 10)])),
  })) };
};
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: RECIPES + '\nwindow.OGX_FLEET = OGX_FLEET;' });
  const expected = JSON.parse(read('fleet-expected-parse.json'));
  const res = await page.evaluate(([evl, mov, disp, pre, phal]) => {
    const own = new Set(['1:42:8', '2:118:12']);
    const doc = (h) => new DOMParser().parseFromString(h, 'text/html');
    return {
      eventlist: OGX_FLEET.parseEventList(evl, own),
      movement: OGX_FLEET.parseMovement(doc(mov)),
      dispatch: OGX_FLEET.parseDispatchInline(disp),
      prefill: OGX_FLEET.parseDispatchInline(pre),
      ships: OGX_FLEET.parseDispatchShips(doc(disp)),
      phalanx: OGX_FLEET.parsePhalanx(JSON.parse(phal)),
    };
  }, [read('fleet-eventlist.html'), read('fleet-movement.html'), read('fleet-dispatch-planet.html'), read('fleet-dispatch-prefill.html'), read('fleet-phalanx-scan.json')]);
  await browser.close();

  let fail = 0;
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log('FAIL', what, '\n  got     ', JSON.stringify(a), '\n  expected', JSON.stringify(b)); } };
  eq(res.eventlist.map((r) => r.rowId), expected.eventlist.map((r) => r.rowId), 'eventlist row ids');
  eq(res.eventlist.map((r) => r.realMissionId), expected.eventlist.map((r) => r.realMissionId), 'eventlist real ids');
  eq(res.eventlist.map((r) => r.arrival), expected.eventlist.map((r) => r.arrival), 'eventlist arrival');
  eq(res.eventlist.map((r) => r.returnFlight), expected.eventlist.map((r) => r.returnFlight), 'eventlist return');
  eq(res.eventlist.map((r) => r.units), expected.eventlist.map((r) => r.units), 'eventlist units');
  eq(res.eventlist.map((r) => r.recallable), expected.eventlist.map((r) => r.recallable), 'eventlist recall');
  const st = Object.fromEntries(res.eventlist.map((r) => [r.rowId, r.status]));
  eq(expected.eventlist.filter((r) => r.status).map((r) => [r.rowId, st[r.rowId]]), expected.eventlist.filter((r) => r.status).map((r) => [r.rowId, r.status]), 'eventlist status');
  eq(res.movement.map((r) => [r.id, r.missionType, r.returnFlight, r.arrival, r.status, r.timer, r.returnArrival, r.origin, r.destination]),
    expected.movement.map((r) => [r.id, r.missionType, r.returnFlight, r.arrival, r.status, r.timer, r.returnArrival, r.origin, r.destination]), 'movement');
  eq(res.eventlist.find((r) => r.rowId === 1203).tooltip, { ships: { 'Large Cargo': 5 }, metal: 50000, crystal: 30000, deuterium: 10790 }, 'tooltip 1203');
  eq(res.eventlist.find((r) => r.rowId === 1199).from, '1:42:9', 'return row from');
  eq(res.eventlist.find((r) => r.rowId === 1199).to, '1:42:8', 'return row to');
  eq(res.dispatch.shipsOnPlanet.length, 7, 'shipsOnPlanet');
  eq(res.prefill.targetPlanet, { galaxy: 1, system: 45, position: 6, type: 1, name: 'Homeworld' }, 'prefill target');
  eq(res.prefill.mission, 1, 'prefill mission');
  eq(res.ships['203'], 18, 'dom ships');
  eq(res.phalanx.rows.map((r) => [r.rowId, r.direction, r.units]), [[1001219, 'Friendly fleet', 8], [1201, 'Own fleet', 30], [1223, 'Enemy fleet', 45]], 'phalanx');
  console.log(JSON.stringify({ sampleEvent: res.eventlist[2], sampleMove: res.movement[0], dispatch: res.dispatch, phalanx: res.phalanx.rows[2] }, null, 1).slice(0, 3000));
  console.log(fail ? `${fail} check(s) failed` : 'all fleet checks passed');
  process.exit(fail ? 1 : 0);
})();
