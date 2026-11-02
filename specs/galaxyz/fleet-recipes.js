/* GALAXYZ / 2Moons fleet recipes (spec companion of fleet.md).
 * Plain browser JS, no dependencies. Works on a live document or a DOMParser document.
 *   GZFleet.parseFleetTable(doc)  page=fleetTable  (slots, flights, ships on planet, prefill, ACS panel)
 *   GZFleet.parseStep1(doc)       page=fleetStep1  (token, inline `data`, colonies, shortcuts, ACS list)
 *   GZFleet.parseStep2(doc)       page=fleetStep2  (token, available missions, staytime options, consumption)
 *   GZFleet.parseStep3(doc)       page=fleetStep3  (result table) or an error page
 *   GZFleet.calc.*                PHP-exact distance / duration / consumption (class.FleetFunctions.php)
 *   GZFleet.api.*                 fetch() helpers: send (3 POSTs), recall, fleetAjax (spy/recycle), checkTarget, missile
 * Verified by tools/check_fleet.js against eu/pages/fleet*.html [REAL] and fixtures/fleet-*.html.
 */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  // pretty_number(): '.' thousands, ',' decimals
  function num(s) {
    if (s == null) return null;
    const m = String(s).replace(/\s|&nbsp;/g, '').match(/-?[\d.]+(?:,\d+)?/);
    return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : null;
  }
  function coords(s) {
    const m = /\[?\s*(\d+):(\d+):(\d+)\s*\]?/.exec(s || '');
    return m ? { galaxy: +m[1], system: +m[2], planet: +m[3] } : null;
  }
  const cstr = (c) => (c ? c.galaxy + ':' + c.system + ':' + c.planet : null);

  // _date($LNG['php_tdformat'] = 'd. M Y, H:i:s') -> wall-clock ms in the USER's timezone (treat as UTC fields).
  const MONTHS = ['jan|янв|jän', 'feb|фев', 'mar|мар|mär|mrz', 'apr|апр', 'may|май|mai', 'jun|июн', 'jul|июл', 'aug|авг', 'sep|сен', 'oct|окт|okt', 'nov|ноя', 'dec|дек|dez'];
  function parseTdDate(s) {
    const m = /(\d{1,2})\.\s*([^\s\d.,]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    const mon = m[2].toLowerCase().slice(0, 3);
    const mi = MONTHS.findIndex((alts) => alts.split('|').includes(mon));
    if (mi < 0) return null;
    return Date.UTC(+m[3], mi, +m[1], +m[4], +m[5], +m[6]);
  }

  // Mission ids (includes/classes/class.FlyingFleetHandler.php:22-35) and localized names (language/*/INGAME.php:27-44,
  // FLEET.php:196-206). The fleetTable list shows ONLY the localized name, so we need the reverse map.
  const MISSIONS = { 1: 'attack', 2: 'acs', 3: 'transport', 4: 'deploy', 5: 'hold', 6: 'spy', 7: 'colonize', 8: 'recycle',
    9: 'destroy', 10: 'missile', 11: 'dmSearch', 15: 'expedition' };
  const MISSION_NAMES = {
    1: ['Attack', 'Атака', 'Angreifen'],
    2: ['ACS - Attack on cooperation', 'Alliance Attack', 'Совместная атака', 'Verbandsangriff'],
    3: ['Transport', 'Транспорт'],
    4: ['Deploy', 'Station', 'Оставить', 'Stationieren'],
    5: ['Transfer', 'Hold', 'Держаться', 'Halten'],
    6: ['Spying', 'Spy', 'Шпионаж', 'Spionieren'],
    7: ['Colonize', 'Colonisation', 'Колонизировать', 'Kolonisieren'],
    8: ['Recycle', 'Переработать', 'Abbauen'],
    9: ['Destroy', 'Уничтожить', 'Zerstören'],
    10: ['Missile attack', 'Ракетная атака', 'Raketenangriff'],
    11: ['Research of Dark matter', 'DM Investigation', 'Поиск Тёмной материи', 'DM Untersuchung'],
    15: ['Expedition', 'Экспедиция'],
  };
  function missionIdByName(name) {
    const n = String(name || '').trim().toLowerCase();
    for (const id in MISSION_NAMES) if (MISSION_NAMES[id].some((x) => x.toLowerCase() === n)) return +id;
    return null;
  }
  // `data = {...};` style inline JSON (fleetStep1/2)
  function inlineData(doc) {
    for (const s of doc.querySelectorAll('script:not([src])')) {
      const m = /(?:^|[\s;])data\s*=\s*(\{[\s\S]*?\});\s*(?:\n|$)/.exec(s.textContent);
      if (m) { try { return JSON.parse(m[1]); } catch (e) { /* fall through */ } }
    }
    return null;
  }
  function inlineVar(doc, name) {
    const re = new RegExp('(?:^|[\\s;])' + name + '\\s*=\\s*([^;\\n]+);');
    for (const s of doc.querySelectorAll('script:not([src])')) { const m = re.exec(s.textContent); if (m) return m[1].trim(); }
    return null;
  }
  // Main content root: the live fork wraps everything in #inhalt; the upstream layout uses #content.
  const contentRoot = (doc) => doc.querySelector('#inhalt') || doc.querySelector('#content') || doc.body || doc;

  // ---------- page=fleetTable ----------
  function parseFleetTable(doc) {
    const rootEl = contentRoot(doc);
    // The flights table = the table that contains the sendfleetback forms or the counters header (first <th colspan=9>).
    const head = [...rootEl.querySelectorAll('th[colspan="9"]')][0] || null;
    const flightsTable = head ? head.closest('table') : null;
    const counters = head ? [...head.querySelectorAll('div')].map((d) => {
      const t = txt(d); const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? { label: t.replace(/\d+\s*\/\s*\d+/, '').replace(/ /g, ' ').trim(), used: +m[1], max: +m[2] } : null;
    }).filter(Boolean) : [];
    // [0] fleets, [1] expeditions (upstream order), extra fork counters after that (e.g. "Asteroids").
    const out = {
      slots: counters[0] ? { used: counters[0].used, max: counters[0].max } : null,
      expeditions: counters[1] ? { used: counters[1].used, max: counters[1].max } : null,
      extraCounters: counters.slice(2),
      flights: [], noFreeSlots: false, ships: [], prefill: null, canContinue: false, acs: null, bonus: null,
    };
    if (flightsTable) {
      for (const tr of flightsTable.querySelectorAll('tr')) {
        const td = [...tr.children].filter((c) => c.tagName === 'TD');
        if (td.length === 1 && td[0].colSpan === 9) { out.noFreeSlots = true; continue; }   // fl_no_more_slots row
        if (td.length !== 9 || txt(td[0]) === '-') continue;
        const missionName = (td[1].childNodes[0] ? td[1].childNodes[0].textContent : '').trim();
        const stateLink = td[1].querySelector('a[title]');
        const amountA = td[2].querySelector('a[data-tooltip-content]');
        const ships = {};
        if (amountA) {
          const d = new DOMParser().parseFromString(amountA.getAttribute('data-tooltip-content'), 'text/html');
          for (const r of d.querySelectorAll('tr')) {
            const c = r.querySelectorAll('td');
            if (c.length === 2) ships[txt(c[0]).replace(/:$/, '')] = num(txt(c[1]));
          }
        }
        const timer = td[7];
        const recallForm = td[8].querySelector('form[action*="sendfleetback"]');
        const acsForm = td[8].querySelector('form[action*="action=acs"]');
        const idInput = (recallForm || acsForm) ? (recallForm || acsForm).querySelector('input[name="fleetID"]') : null;
        const startText = txt(td[4]), endText = txt(td[6]);
        const endUnix = timer.hasAttribute('data-fleet-end-time') ? +timer.getAttribute('data-fleet-end-time') : null;
        const restSec = timer.hasAttribute('data-fleet-time') ? +timer.getAttribute('data-fleet-time') : null;
        const missionId = missionIdByName(missionName);
        const returning = stateLink ? /\((R|В)\)/.test(txt(stateLink)) : null;
        // timezone-free epochs: timer = arrival for an outbound deploy (end column '-'), else = return time
        const deployOut = missionId === 4 && endText === '-';
        const anchorWall = deployOut ? parseTdDate(startText) : parseTdDate(endText);
        const offsetMs = anchorWall != null && endUnix != null ? anchorWall - endUnix * 1000 : null; // = user tz offset
        const startWall = parseTdDate(startText);
        out.flights.push({
          index: +txt(td[0]),
          fleetId: idInput ? +idInput.value : null,             // only present while recallable (state != 1)
          missionName, missionId,
          returning,                                            // (R) = fleet_mess 1; (A) = outbound or holding
          amount: num(amountA ? txt(amountA) : txt(td[2])),
          ships,                                                // localized name -> count
          origin: cstr(coords(txt(td[3]))),
          arrivalText: startText,                               // "Arrival(Destination)" = fleet_start_time
          target: cstr(coords(txt(td[5]))),
          returnText: endText,                                  // "Arrival(Back)" = fleet_end_time, '-' for outbound deploy
          arrivalUnix: startWall != null && offsetMs != null ? Math.round((startWall - offsetMs) / 1000) : null,
          returnUnix: deployOut ? null : endUnix,
          timerUnix: endUnix, timerRestSec: restSec, tzOffsetMs: offsetMs,
          nextIsArrival: /lime/i.test(td[4].getAttribute('style') || ''),
          recallable: !!recallForm, canOpenAcs: !!acsForm,
        });
      }
    }
    // New mission form: hidden prefill + ships on planet
    const form = rootEl.querySelector('form[action*="page=fleetStep1"]');
    if (form) {
      const v = (n) => { const i = form.querySelector('input[name="' + n + '"]'); return i ? +i.value : null; };
      out.prefill = { galaxy: v('galaxy'), system: v('system'), planet: v('planet'), type: v('type'), target_mission: v('target_mission') };
      for (const cell of form.querySelectorAll('td[id^="ship"][id$="_value"]')) {
        const id = +cell.id.replace(/\D/g, '');
        const tr = cell.closest('tr');
        const first = tr.querySelector('td');
        const tip = first.querySelector('[data-tooltip-content]') || first.querySelector('a[title]');
        const tipText = tip ? (tip.getAttribute('data-tooltip-content') || tip.getAttribute('title')) : '';
        const input = tr.querySelector('input[name="ship' + id + '"]');
        out.ships.push({
          id, name: tip ? txt(tip) : txt(first), count: num(txt(cell)),
          speed: tipText ? num(tipText.replace(/^[^\d]*/, '')) : 0,       // per-ship speed with research ("Speed:  6000")
          selectable: !!input,                                           // false for speed 0 (Solar Satellite)
        });
      }
      out.canContinue = !!form.querySelector('input[type="submit"]');
    }
    // ACS panel (after action=acs)
    const acsForm = [...rootEl.querySelectorAll('form[action*="action=acs"]')].find((f) => f.querySelector('#acsName'));
    if (acsForm) {
      const st = [...acsForm.querySelectorAll('td[colspan="2"]')].filter((t) => t.id !== 'acsName');
      out.acs = {
        mainFleetId: +acsForm.querySelector('input[name="fleetID"]').value,
        name: txt(acsForm.querySelector('#acsName')),
        invited: [...acsForm.querySelectorAll('select option')].map((o) => ({ id: +o.value, name: txt(o) })),
        statusMessage: st.length ? txt(st[0]) : null,
      };
    }
    // Bonus table: Weapons/Defense/Shield, then Combustion/Impulse/Hyperspace (+N %)
    const bon = [...rootEl.querySelectorAll('table')].reverse().find((t) => /\+\s*-?\d+\s*%/.test(txt(t)) && t.querySelectorAll('td').length === 6);
    if (bon) {
      const v = [...bon.querySelectorAll('td')].map((t) => num(txt(t)));
      out.bonus = { attack: v[0], defense: v[1], shield: v[2], combustion: v[3], impulse: v[4], hyperspace: v[5] };
    }
    return out;
  }

  // ---------- page=fleetStep1 ----------
  function parseStep1(doc) {
    const rootEl = contentRoot(doc);
    const form = rootEl.querySelector('form[action*="page=fleetStep2"]');
    if (!form) return null;
    const val = (n) => { const e = form.querySelector('[name="' + n + '"]'); return e ? e.value : null; };
    const setTargetRe = /setTarget\((\d+),(\d+),(\d+),(\d+)\)/;
    const colonies = [], shortcuts = [], acs = [];
    for (const a of form.querySelectorAll('a[href^="javascript:setTarget("]')) {
      const m = setTargetRe.exec(a.getAttribute('href')); if (!m) continue;
      const item = { galaxy: +m[1], system: +m[2], planet: +m[3], type: +m[4], name: txt(a).replace(/\s*(\([^)]*\))?\s*\[\d+:\d+:\d+\]\s*$/, '').trim() };
      (a.closest('.shortcut') ? shortcuts : colonies).push(item);
    }
    for (const a of form.querySelectorAll('a[href^="javascript:setACSTarget("]')) {
      const m = /setACSTarget\((\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(a.getAttribute('href'));
      if (m) acs.push({ galaxy: +m[1], system: +m[2], planet: +m[3], type: +m[4], acsId: +m[5], name: txt(a).replace(/\s*-\s*\[.*$/, '') });
    }
    return {
      token: val('token'), fleetGroup: +val('fleet_group'), targetMission: +val('target_mission'),
      target: { galaxy: +val('galaxy'), system: +val('system'), planet: +val('planet'), type: +val('type') },
      speedOptions: [...form.querySelectorAll('select[name="speed"] option')].map((o) => +o.value),
      data: inlineData(doc),   // {fleetroom, gamespeed, fleetspeedfactor, planet, maxspeed, ships:{id:{consumption,speed,amount}}, fleetMinDuration}
      colonies, shortcuts, acs,
    };
  }

  // ---------- page=fleetStep2 ----------
  function parseStep2(doc) {
    const rootEl = contentRoot(doc);
    const form = rootEl.querySelector('form[action*="page=fleetStep3"]');
    if (!form) return null;
    const missions = [...form.querySelectorAll('input[type="radio"][name="mission"]')].map((r) => ({
      id: +r.value, name: txt(form.querySelector('label[for="' + r.id + '"]')), checked: r.checked,
    }));
    const stay = form.querySelector('select[name="staytime"]');
    const fp = form.querySelector('#fleetPoints');
    const h = doc.querySelector('#fleet2 h2') || rootEl.querySelector('th[colspan="2"]');
    return {
      token: (form.querySelector('input[name="token"]') || {}).value || null,
      missions, checkedMission: (missions.find((m) => m.checked) || {}).id || null,
      stayOptions: stay ? [...stay.options].map((o) => ({ value: +o.value, hours: parseFloat(o.textContent) })) : [],
      consumption: num(txt(form.querySelector('#consumption'))),
      fleetPoints: fp ? num(txt(fp)) : null,                      // fork-only
      heading: txt(h),                                           // "Send fleet 2:68:5 - Planet" = ORIGIN coords (upstream quirk)
      data: inlineData(doc),                                     // {fleetroom, consumption}
    };
  }

  // ---------- page=fleetStep3 / error pages ----------
  function parseStep3(doc) {
    const rootEl = contentRoot(doc);
    const ok = rootEl.querySelector('th.success');
    if (!ok) return { success: false, message: errorMessage(doc) };
    const table = ok.closest('table');
    const rows = [...table.querySelectorAll('tr')];
    const kv = [], ships = {};
    let inShips = false;
    for (const tr of rows.slice(1)) {
      const th = tr.querySelector('th');
      if (th) { inShips = true; continue; }
      const c = tr.querySelectorAll('td'); if (c.length !== 2) continue;
      if (inShips) ships[txt(c[0])] = num(txt(c[1])); else kv.push(txt(c[1]));
    }
    // Fixed row order (page.fleetStep3.default.tpl:247-278): mission, distance, speed, consumption, from, to, arrival, return
    return {
      success: true, title: txt(ok),
      missionName: kv[0], missionId: missionIdByName(kv[0]), distance: num(kv[1]), maxSpeed: num(kv[2]),
      consumption: num(kv[3]), from: kv[4], to: kv[5], arrivalText: kv[6], returnText: kv[7],
      arrivalWall: parseTdDate(kv[6]), returnWall: parseTdDate(kv[7]), ships,
      redirect: (() => { const m = doc.querySelector('meta[http-equiv="refresh" i]'); return m ? m.getAttribute('content') : null; })(),
    };
  }
  // printMessage() (error.default.tpl): <table class="table519"><tr><th>Info</th></tr><tr><td><p>MESSAGE</p>...buttons</td></tr></table>
  function errorMessage(doc) {
    const rootEl = contentRoot(doc);
    const p = rootEl.querySelector('table td > p') || rootEl.querySelector('td p');
    if (p) return txt(p);
    const t = rootEl.querySelector('.mainRS td, table.table519 td');
    return t ? txt(t) : null;
  }

  // ---------- calculations (PHP-exact, includes/classes/class.FleetFunctions.php) ----------
  const calc = {
    // GetTargetDistance (:87-99): no donut galaxy/system, no empty-system discount
    distance(a, b) {
      if (a.galaxy !== b.galaxy) return Math.abs(a.galaxy - b.galaxy) * 20000;
      if (a.system !== b.system) return Math.abs(a.system - b.system) * 95 + 2700;
      if (a.planet !== b.planet) return Math.abs(a.planet - b.planet) * 5 + 1000;
      return 5;
    },
    // GetGameSpeedFactor (:124-127) = fleet_speed / 2500 (data.gamespeed on fleetStep1)
    // GetMissionDuration (:101-114): float, NOT rounded; the DB stores round() (int columns)
    duration({ speed /* 1..10 */, maxSpeed, distance, gameSpeed, flyTimeFactor = 1, minDuration = 5 }) {
      const d = ((3500 / (speed * 0.1)) * Math.sqrt(distance * 10 / maxSpeed) + 10) / gameSpeed * Math.max(0, flyTimeFactor);
      return Math.max(d, minDuration);
    },
    // GetFleetConsumption (:162-176): uses round(duration); +1 at the end; no per-ship minimum
    consumption({ ships /* {id:{consumption, speed, amount}} as in fleetStep1 data.ships */, duration, distance, gameSpeed }) {
      let c = 0;
      for (const id in ships) {
        const s = ships[id];
        const spd = 35000 / (Math.round(duration) * gameSpeed - 10) * Math.sqrt(distance * 10 / +s.speed);
        c += (+s.consumption) * (+s.amount) * distance / 35000 * (spd / 10 + 1) * (spd / 10 + 1);
      }
      return Math.round(c) + 1;
    },
    // GetShipSpeed (:34-65) from elements.json fields (speed, speedTech); techs = {115, 117, 118}
    shipSpeed(el, techs) {
      let t = el.speedTech;
      if (t === 4) t = techs[117] >= 5 ? 2 : 1;
      if (t === 5) t = techs[118] >= 8 ? 3 : 2;
      if (t === 1) return el.speed * (1 + 0.1 * techs[115]);
      if (t === 2) return el.speed * (1 + 0.2 * techs[117]);
      if (t === 3) return el.speed * (1 + 0.3 * techs[118]);
      return 0;
    },
    // GetShipConsumption (:22-27)
    shipConsumption(id, el, techs) {
      return ((techs[117] >= 5 && id === 202) || (techs[118] >= 8 && id === 211)) ? el.consumption2 : el.consumption;
    },
    // Full estimate the way fleetStep3 books it. stayHours = StayBlock value (hold/expedition), 0 otherwise.
    estimate({ from, to, ships, speed = 10, gameSpeed, flyTimeFactor = 1, minDuration = 5, stayHours = 0, nowUnix }) {
      const distance = calc.distance(from, to);
      const maxSpeed = Math.min(...Object.values(ships).map((s) => +s.speed));
      const dur = calc.duration({ speed, maxSpeed, distance, gameSpeed, flyTimeFactor, minDuration });
      const consumption = calc.consumption({ ships, duration: dur, distance, gameSpeed });
      const d = Math.round(dur), stay = Math.round(stayHours * 3600);
      return { distance, maxSpeed, durationSec: d, durationRaw: dur, consumption,
        arrivalUnix: nowUnix != null ? nowUnix + d : null, returnUnix: nowUnix != null ? nowUnix + d + stay + d : null };
    },
    // Recall (SendFleetBack :345-349): return arrives at now + (now - start_time); mission 5 holding: now + flight time
    recallReturn({ nowUnix, departureUnix, mission, holding, arrivalUnix }) {
      return mission === 5 && holding ? nowUnix + (arrivalUnix - departureUnix) : nowUnix + (nowUnix - departureUnix);
    },
    expeditionSlots: (astrophysics) => Math.floor(Math.sqrt(astrophysics)),          // getExpeditionLimit (:67-70)
    fleetSlots: (computer, bonus = 0) => 1 + computer + bonus,                      // GetMaxFleetSlots (:129-133)
    missileRange: (impulse) => Math.max(impulse * 5 - 1, 0),                        // getMissileRange (:77-80)
    missileDuration: (fromSystem, toSystem, gameSpeed) => Math.max(Math.round((30 + 60 * Math.abs(fromSystem - toSystem)) / gameSpeed), 5),
  };

  // ---------- network (same-origin, cookie session, NO CSRF) ----------
  const base = () => (typeof location !== 'undefined' ? location.href.replace(/game\.php.*$/, '').replace(/[^/]*$/, '') : '');
  async function post(page, params, cp) {
    const url = base() + 'game.php?page=' + page + (cp ? '&cp=' + cp : '');
    const r = await fetch(url, { method: 'POST', credentials: 'include', body: new URLSearchParams(params) });
    const html = await r.text();
    return { url: r.url, redirected: r.redirected, status: r.status, doc: new DOMParser().parseFromString(html, 'text/html') };
  }
  // GotoFleetPage(): redirect to page=fleetTable&code=N (0/1, no message text)
  const redirectCode = (res) => { const m = /[?&]page=fleetTable\b.*[?&]code=(\d+)/.exec(res.url); return m ? +m[1] : null; };

  const api = {
    // 3-step dispatch. ships = {shipId: count}; target = {galaxy, system, planet, type}; speed 1..10;
    // res = {metal, crystal, deuterium}; staytime = KEY of the staytime <select> (hours for 5, level index for 15)
    async send({ cp, ships, target, mission, speed = 10, res = {}, staytime = 1, fleetGroup = 0 }) {
      const p1 = { galaxy: target.galaxy, system: target.system, planet: target.planet, type: target.type, target_mission: mission };
      for (const id in ships) if (ships[id] > 0) p1['ship' + id] = ships[id];
      const r1 = await post('fleetStep1', p1, cp);
      const s1 = parseStep1(r1.doc);
      if (!s1) return { success: false, step: 1, code: redirectCode(r1), message: errorMessage(r1.doc) };
      const r2 = await post('fleetStep2', { token: s1.token, fleet_group: fleetGroup, target_mission: mission,
        galaxy: target.galaxy, system: target.system, planet: target.planet, type: target.type, speed }, cp);
      const s2 = parseStep2(r2.doc);
      if (!s2) return { success: false, step: 2, code: redirectCode(r2), message: errorMessage(r2.doc) };
      if (!s2.missions.some((m) => m.id === mission)) return { success: false, step: 2, message: 'mission not available', missions: s2.missions };
      const r3 = await post('fleetStep3', { token: s1.token, mission, metal: res.metal || 0, crystal: res.crystal || 0,
        deuterium: res.deuterium || 0, staytime }, cp);
      const s3 = parseStep3(r3.doc);
      return Object.assign({ step: 3, code: redirectCode(r3), consumptionStep2: s2.consumption }, s3);
    },
    // Recall: POST page=fleetTable&action=sendfleetback fleetID=N -> full fleetTable page (re-parse to confirm)
    async recall(fleetId, cp) {
      const r = await post('fleetTable&action=sendfleetback', { fleetID: fleetId }, cp);
      const t = parseFleetTable(r.doc);
      const f = t.flights.find((x) => x.fleetId === fleetId);
      return { success: !f || !f.recallable, table: t };       // after recall the row shows (R) and has no form
    },
    // One-click spy (6) / recycle (8): GET page=fleetAjax&ajax=1&mission=M&planetID=<target planet DB id>
    async fleetAjax(mission, planetId, cp) {
      const url = base() + 'game.php?page=fleetAjax&ajax=1&mission=' + mission + '&planetID=' + planetId + (cp ? '&cp=' + cp : '');
      const r = await fetch(url, { credentials: 'include' });
      return r.json();   // {slots, ships?:{id:left}, code: 600 ok | 601..699 error, mess}
    },
    // Pre-check used by the step-1 form: JSON string "OK" or a localized error
    async checkTarget(target, cp) {
      const url = base() + 'game.php?page=fleetStep1&mode=checkTarget&galaxy=' + target.galaxy + '&system=' + target.system +
        '&planet=' + target.planet + '&planet_type=' + target.type + (cp ? '&cp=' + cp : '');
      const r = await fetch(url, { credentials: 'include' });
      const j = await r.json();
      return { ok: j === 'OK', message: j };
    },
    // Missile: POST page=fleetMissile galaxy,system,planet,type,SendMI,Target(0=all|defense id) -> printMessage page
    async missile({ cp, target, count, primary = 0 }) {
      const r = await post('fleetMissile', { galaxy: target.galaxy, system: target.system, planet: target.planet, type: target.type || 1, SendMI: count, Target: primary }, cp);
      return { message: errorMessage(r.doc) };
    },
  };

  const GZFleet = { num, coords, parseTdDate, missionIdByName, MISSIONS, MISSION_NAMES, inlineData, inlineVar,
    parseFleetTable, parseStep1, parseStep2, parseStep3, errorMessage, calc, api };
  root.GZFleet = GZFleet;
  if (typeof module !== 'undefined' && module.exports) module.exports = GZFleet;
})(typeof window !== 'undefined' ? window : globalThis);
