/* GALAXYZ / 2Moons layout parsing recipes (spec companion of layout.md).
 * Plain browser JS, no dependencies, works on a live document or a DOMParser document.
 * Usage: GZLayout.parseLayout(document)  ->  see layout.md section 13 for the result shape.
 * Verified by tools/check_layout.js against eu/pages/overview.html [REAL] and fixtures/layout-*.html.
 */
(function (root) {
  'use strict';

  // ---------- numbers ----------
  // 2Moons pretty_number(): '.' thousands, ',' decimals  ("1.908.057.266", "41,7").
  function parseDe(s) {
    if (s == null) return null;
    s = String(s).replace(/&nbsp;| |\s/g, '');
    const m = s.match(/-?[\d.]+(?:,\d+)?/);
    if (!m) return null;
    return parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
  }
  // Display numbers with a unit. Two formatters exist:
  //  * 2Moons shortly_number (JS ticker + upstream PHP): LONG scale, unit index per 10^6 step:
  //    K=1e3, M=1e6, B=1e12, T=1e18;  "2.064 M" = 2 064 M = 2.064e9 ('.' is the THOUSANDS separator)
  //  * GALAXYZ server text seen on the live page: "41.7K", "4K" ('.' is a DECIMAL point, short scale).
  // Only use as a last resort; prefer data-real / data-tooltip-content / title tooltips.
  function parseShort(s) {
    if (s == null) return null;
    s = String(s).replace(/&nbsp;| /g, ' ').trim();
    const m = s.match(/^(-?[\d.,]+)\s*(K|M|B|T)?$/);
    if (!m) return null;
    const LONG = { K: 1e3, M: 1e6, B: 1e12, T: 1e18 };
    const SHORT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    if (!m[2]) return parseDe(m[1]);
    if (/\s/.test(s)) return parseDe(m[1]) * LONG[m[2]];            // "2.064 M" (2Moons, nbsp before unit)
    return parseFloat(m[1].replace(',', '.')) * SHORT[m[2]];          // "41.7K" (GALAXYZ server text)
  }

  const scriptsText = doc => [...doc.querySelectorAll('script')].map(s => s.textContent).join('\n');

  // ---------- 1. detection ----------
  function detect(doc = document, loc = doc.location || (typeof location !== 'undefined' ? location : null)) {
    const gen = doc.querySelector('meta[name="generator"]');
    const generator = gen ? gen.getAttribute('content') : null;
    const genOk = !!generator && /^(GALAXYZ|2Moons)\b/i.test(generator);
    const path = loc && loc.pathname ? loc.pathname : '';
    // live: /<Universe>/game.php ; saved/fixture files (file:) are accepted for tests
    const pathOk = !loc || loc.protocol === 'file:' || loc.protocol === 'about:' || /\/game\.php$/.test(path);
    const body = doc.body;
    const window = body ? (body.classList.contains('full') ? 'full' : body.classList.contains('popup') ? 'popup' : 'other') : null;
    const ingame = !!doc.querySelector('#planetSelector') && /\bserverTime\s*=\s*new Date\(/.test(scriptsText(doc));
    return {
      ok: genOk && ingame && pathOk,
      generator,
      engine: generator ? (/^GALAXYZ/i.test(generator) ? 'galaxyz' : '2moons') : null,
      version: generator ? (generator.split(/\s+/)[1] || null) : null,
      window,                                   // 'full' page | 'popup' (fancybox iframe / OpenPopup) | 'other'
      layout: doc.querySelector('#resTable, #planetSelect') ? 'galaxyz' : doc.querySelector('#resourceTable, #leftmenu') ? 'upstream' : null,
    };
  }

  // ---------- 2. routing ----------
  function route(doc = document, href) {
    href = href || (doc.location && doc.location.href) || '';
    let page = null, mode = null, cp = null;
    try {
      const u = new URL(href);
      page = u.searchParams.get('page'); mode = u.searchParams.get('mode'); cp = u.searchParams.get('cp');
    } catch (e) { /* ignore */ }
    const qs = (scriptsText(doc).match(/var\s+queryString\s*=\s*"([^"]*)"/) || [])[1];
    if (qs != null) {
      const q = new URLSearchParams(qs.replace(/\\\//g, '/'));
      if (!page && q.get('page')) page = q.get('page');
      if (!mode && q.get('mode')) mode = q.get('mode');
    }
    const bodyId = doc.body ? doc.body.id : null;
    page = page || bodyId || 'overview';
    return { page, pageKey: page.toLowerCase(), mode: mode || 'show', cp: cp ? +cp : null, bodyId, queryString: qs ?? null,
             universeBase: href ? href.replace(/[?#].*$/, '').replace(/game\.php$/, '') : null };
  }

  // ---------- 3. server time ----------
  function serverTime(doc = document) {
    const src = scriptsText(doc);
    const m = src.match(/serverTime\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
    const off = src.match(/ServerTimezoneOffset\s*=\s*(-?\d+)/);
    const wallMs = m ? Date.UTC(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : null;   // month already 0-based
    // Exact render time: every fleet countdown carries end (unix) and rest (s) computed from the same TIMESTAMP.
    let renderUnix = null;
    for (const el of doc.querySelectorAll('.fleets[data-fleet-end-time][data-fleet-time]')) {
      const end = +el.getAttribute('data-fleet-end-time'), rest = +el.getAttribute('data-fleet-time');
      if (end > 1e9 && Number.isFinite(rest)) { renderUnix = end - rest; break; }
    }
    const tzOffsetMs = wallMs != null && renderUnix != null
      ? Math.round((wallMs - renderUnix * 1000) / 900000) * 900000 : null;       // server tz vs UTC, 15-min rounding
    return { wallMs, userOffsetSec: off ? +off[1] : null, renderUnix, tzOffsetMs,
             clockText: (doc.querySelector('#clock, .servertime') || {}).textContent?.trim() ?? null };
  }

  // ---------- 4. planets ----------
  const COORD_RE = /\[(\d+):(\d+):(\d+)\]/;
  const MOON_LABELS = ['Moon', 'Mond', 'Luna', 'Луна', 'Lune', 'Ay', 'Księżyc', 'Maan', 'Lua', 'Φεγγάρι'];
  const moonLabelRe = new RegExp('\\((?:' + MOON_LABELS.join('|') + ')\\)\\s*\\[', 'i');     // "Name (Moon) [g:s:p]"
  const moonLabelTail = new RegExp('\\s*\\((?:' + MOON_LABELS.join('|') + ')\\)\\s*$', 'i');

  function parseTooltip(t) {
    if (!t) return null;
    const temp = t.match(/(-?\d+)\s*°C\D+?(-?\d+)\s*°C/);
    const dia = t.match(/([\d.,]+)\s*km\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
    if (!temp && !dia) return null;
    return { tempMin: temp ? +temp[1] : null, tempMax: temp ? +temp[2] : null,
             diameter: dia ? parseDe(dia[1]) : null, fieldsUsed: dia ? +dia[2] : null, fieldsMax: dia ? +dia[3] : null };
  }
  const cpOf = (a, base) => { try { return +new URL(a.getAttribute('href'), base).searchParams.get('cp') || null; } catch (e) { return null; } };

  function planets(doc = document) {
    const base = (doc.location && doc.location.href && doc.location.href !== 'about:blank') ? doc.location.href : 'http://x/game.php';
    // a) selector (all layouts): <option value=id>Name[ (Moon)] [g:s:p]</option>
    const sel = [...doc.querySelectorAll('#planetSelector option')].map(o => {
      const txt = o.textContent.trim(), c = txt.match(COORD_RE);
      const isMoon = moonLabelRe.test(txt);
      return { id: +o.value, name: txt.replace(/\s*\[\d+:\d+:\d+\]\s*$/, '').replace(moonLabelTail, '').trim(),
               coords: c ? `${c[1]}:${c[2]}:${c[3]}` : null, type: isMoon ? 'moon' : 'planet', selected: o.hasAttribute('selected') || o.selected };
    });
    // b) live planet list: one #planetList (duplicate id!) per planet, each with .smallplanet > a.planetlink
    const list = [...doc.querySelectorAll('.smallplanet')].map(sp => {
      const a = sp.querySelector('a.planetlink');
      if (!a) return null;
      const img = sp.querySelector('img.planetPic');
      const ko = (sp.querySelector('.planet-koords') || {}).textContent || '';
      const c = ko.match(COORD_RE);
      const moonA = sp.querySelector('a.moonlink');                     // GUESS (not seen on a real page yet)
      return {
        id: cpOf(a, base), name: (sp.querySelector('.planet-name') || {}).textContent?.trim() ?? null,
        coords: c ? `${c[1]}:${c[2]}:${c[3]}` : null,
        image: img ? (img.getAttribute('src').match(/s_([a-z]+\d*)\.(?:gif|jpg|png)/i) || [])[1] || null : null,
        active: a.classList.contains('active') || a.classList.contains('active-planet'),
        building: !!sp.querySelector('.buildingIco, .bi-building-fill-up'),
        tooltip: parseTooltip(a.getAttribute('title')),
        moon: moonA ? { id: cpOf(moonA, base), active: moonA.classList.contains('active'), tooltip: parseTooltip(moonA.getAttribute('title')),
                        name: (moonA.getAttribute('title') || '').match(/<b>\s*(.*?)\s*\[/)?.[1] ?? null } : null,
      };
    }).filter(Boolean);
    // merge: selector order is authoritative for the full set (it contains moons as their own options)
    const byId = new Map(list.map(p => [p.id, p]));
    const out = sel.map(s => {
      const l = byId.get(s.id);
      const isMoon = s.type === 'moon' || (l && l.image === 'mond');
      return { id: s.id, name: l?.name ?? s.name, coords: s.coords ?? l?.coords ?? null, type: isMoon ? 'moon' : 'planet',
               selected: s.selected, image: l?.image ?? null, active: l?.active ?? null, building: l?.building ?? null,
               tooltip: l?.tooltip ?? null, moonId: l?.moon?.id ?? null };
    });
    for (const l of list) if (!out.some(p => p.id === l.id)) out.push({ ...l, type: l.image === 'mond' ? 'moon' : 'planet', selected: null });
    for (const l of list) if (l.moon && l.moon.id) {                     // live a.moonlink (GUESS markup) enriches the moon entry
      let m = out.find(p => p.id === l.moon.id);
      if (!m) out.push(m = { id: l.moon.id, name: null, coords: l.coords, type: 'moon', selected: null, image: 'mond', building: null, moonId: null });
      m.type = 'moon'; m.name = l.moon.name || m.name; m.tooltip = l.moon.tooltip; m.active = l.moon.active;
    }
    // moons as children of their planet (same coords, type moon)
    for (const p of out) if (p.type === 'moon') {
      const parent = out.find(q => q.type === 'planet' && q.coords === p.coords);
      if (parent) { p.planetId = parent.id; parent.moonId = parent.moonId ?? p.id; }
    }
    const cnt = ((doc.querySelector('#countColonies') || {}).textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return { list: out, count: cnt ? { used: +cnt[1], max: +cnt[2] } : null };
  }

  function currentBody(doc = document, pl = planets(doc)) {
    const opt = doc.querySelector('#planetSelector option[selected]') || doc.querySelector('#planetSelector option:checked');
    const id = opt ? +opt.value : (pl.list.find(p => p.active) || {}).id ?? null;
    const p = pl.list.find(q => q.id === id) || null;
    const img = doc.querySelector('#planetImage img');
    const image = img ? (img.getAttribute('src').match(/s_([a-z]+\d*)\./i) || [])[1] || null : null;
    return { id, name: (doc.querySelector('#planetNameHeader, .planetname') || {}).textContent?.trim() || p?.name || null,
             coords: p?.coords ?? null, type: p ? p.type : (image === 'mond' ? 'moon' : 'planet'), image };
  }

  // ---------- 5. resources ----------
  function resources(doc = document) {
    const src = scriptsText(doc);
    const tick = {};
    const re = /resourceTicker\(\{\s*available:\s*\(?\s*(-?[\d.eE+]+)\s*\)?\s*,\s*limit:\s*\[\s*-?[\d.]+\s*,\s*"?(-?[\d.eE+]+)"?\s*\]\s*,\s*production:\s*"?(-?[\d.eE+]+)"?\s*,\s*valueElem:\s*"current_(\w+)"/g;
    let m;
    while ((m = re.exec(src))) tick[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
    const out = {};
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const td = doc.getElementById('current_' + k);
      const t = tick[k] || {};
      const icon = doc.querySelector(`img[data-currentname="current_${k[0].toUpperCase() + k.slice(1)}"]`);
      const tt = icon ? icon.getAttribute('title') || '' : '';
      const ttNum = cls => { const r = tt.match(new RegExp(`class='[^']*\\b${cls}\\b[^']*'\\s*>\\s*(-?[\\d.]+)`)); return r ? parseDe(r[1]) : null; };
      const maxTd = doc.getElementById('max_' + k);                     // upstream only
      out[k] = {
        amount: t.amount ?? (td ? parseFloat(td.getAttribute('data-real')) : null),
        storage: t.storage ?? ttNum('storage') ?? (maxTd ? parseDe(maxTd.getAttribute('data-tooltip-content') || maxTd.textContent) : null),
        perHour: t.perHour ?? ttNum('production'),
        dataReal: td ? parseFloat(td.getAttribute('data-real')) : null,
        tooltip: tt ? { available: ttNum('current'), storage: ttNum('storage'), production: ttNum('production') } : null,
      };
    }
    // energy: live -> td in the same column as img[data-currentname="current_Energy"], value in attribute t="free / total";
    // upstream -> td.res_current without id, text "free / total"
    let energy = null;
    const eIcon = doc.querySelector('img[data-currentname="current_Energy"]');
    let eTd = null;
    if (eIcon) {
      const col = eIcon.closest('td').cellIndex, table = eIcon.closest('table');
      eTd = [...table.rows].slice(1).map(r => r.cells[col]).find(c => c && c.classList.contains('res_current')) || null;
    }
    if (!eTd) eTd = [...doc.querySelectorAll('td.res_current')].find(td => !td.id) || null;
    if (eTd) {
      const raw = eTd.getAttribute('t') || eTd.getAttribute('data-tooltip-content') || eTd.textContent;
      const r = String(raw).replace(/&nbsp;| /g, ' ').match(/(-?[\d.]+)\s*\/\s*(-?[\d.]+)/);
      if (r) energy = { available: parseDe(r[1]), production: parseDe(r[2]), consumption: parseDe(r[2]) - parseDe(r[1]) };
    }
    out.energy = energy;
    const dm = doc.getElementById('current_darkmatter');
    out.darkmatter = dm ? parseFloat(dm.getAttribute('data-real')) : null;
    return out;
  }

  // amount at time t (ms) exactly as topnav.js resourceTicker does it (production per HOUR, frozen at/above storage)
  function amountAt(r, renderMs, nowMs) {
    if (!r || r.amount == null) return null;
    if (r.amount >= r.storage) return r.amount;
    const v = Math.max(0, Math.floor(r.amount + r.perHour / 3600 * (nowMs - renderMs) / 1000));
    return Math.min(v, Math.max(r.storage, r.amount));
  }

  // ---------- 6. player / header ----------
  function player(doc = document) {
    const name = (doc.querySelector('#playerName .textBeefy a, #playerName .textBeefy') || {}).textContent?.trim()
      || ((doc.querySelector('table.table519 th') || {}).textContent?.match(/\(([^()]+)\)\s*$/) || [])[1] || null;
    const stat = doc.querySelector('#bar a[href*="page=statistics"][href*="range="]');
    const rankFromBar = stat ? +new URL(stat.getAttribute('href'), 'http://x/').searchParams.get('range') : null;
    const msgEl = doc.querySelector('.messages-section .new-msg-count, #newmesnum');
    const src = scriptsText(doc);
    const vac = src.match(/var\s+vacation\s*=\s*(\d+)/);
    // player id is NOT in the header; only pages that list the player with Dialog.Playercard(id, 'name') expose it
    // (page=tournament [REAL], galaxy rows of OTHER players, statistics). Match by name.
    let id = null;
    if (name) for (const a of doc.querySelectorAll('a[onclick*="Dialog.Playercard("]')) {
      const pm = a.getAttribute('onclick').match(/Dialog\.Playercard\((\d+),\s*'([^']*)'/);
      if (pm && pm[2] === name) { id = +pm[1]; break; }
    }
    return { name, id, rank: rankFromBar, unreadMessages: msgEl ? parseInt(msgEl.textContent, 10) || 0 : 0,
             vacation: vac ? vac[1] !== '0' : !!doc.querySelector('.infobox'),
             authLevel: +((src.match(/var\s+auth\s*=\s*(\d+)/) || [])[1] || 0),
             lang: (src.match(/var\s+Lang\s*=\s*"([^"]*)"/) || [])[1] || doc.documentElement.lang || null,
             skin: (src.match(/var\s+Skin\s*=\s*"([^"]*)"/) || [])[1] || null };
  }

  // ---------- 7. overview ----------
  const STYLE_MISSION = { attack: 1, federation: 2, transport: 3, deploy: 4, hold: 5, espionage: 6, colony: 7, harvest: 8, destroy: 9, missile: 10 };

  function fleetEvents(doc = document) {
    const seen = new Set(), out = [];
    // live: event box #messages_collapsed (top of #inhalt on EVERY full page); upstream: overview table.table519.
    // Do NOT use a bare '.fleets' selector: page=fleetTable has td#fleettime_<1..n>.fleets rows too.
    for (const el of doc.querySelectorAll('.OvfleetEvents_ .fleets[id^="fleettime_"], table.table519 td.fleets[id^="fleettime_"]')) {
      if (seen.has(el.id)) continue;                                    // live page renders the first event twice
      seen.add(el.id);
      const box = el.closest('.OvfleetEvents_') || el.closest('tr');
      const span = box && box.querySelector('span.flight, span.return, span.holding');
      if (!span) continue;
      const cls = [...span.classList];
      const status = cls.find(c => c === 'flight' || c === 'return' || c === 'holding');
      const type = cls.find(c => c !== status) || '';
      const own = /^own/.test(type), style = type.replace(/^own/, '');
      const coords = [...span.querySelectorAll('a[href*="page=galaxy"]')].map(a => (a.textContent.match(COORD_RE) || []).slice(1, 4).join(':'));
      const [c1, c2] = coords;
      const from = status === 'return' ? c2 : c1, to = status === 'return' ? c1 : c2;
      const blind = [...span.querySelectorAll('.textForBlind')].map(s => s.textContent.trim().replace(/^\(|\)$/g, ''));
      const pm = span.innerHTML.match(/Dialog\.PM\((\d+)\)/);
      const key = el.id.slice('fleettime_'.length);
      const end = +el.getAttribute('data-fleet-end-time');
      let mission = STYLE_MISSION[style] ?? null;
      if (style === 'transport' && to && +to.split(':')[2] >= 16) mission = 15;   // expedition renders as *transport
      out.push({
        key, fleetId: key.length > 10 ? +key.slice(10) : null, endUnix: end, restSec: +el.getAttribute('data-fleet-time'),
        status, own, style, cssType: type, mission, from, to,
        hostile: !own && [1, 2, 6, 9, 10].includes(mission),
        ownerId: pm ? +pm[1] : null,
        acs: (span.innerHTML.match(/<br>\s*<br>/g) || []).length > 0,
        shipsText: blind[0] ?? null, cargoText: blind[1] ?? null,
        text: span.textContent.replace(/\s+/g, ' ').trim(),
      });
    }
    return out.sort((a, b) => a.endUnix - b.endUnix);
  }

  function overview(doc = document) {
    const txt = sel => ((doc.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    // live ids; upstream: same strings inside table.table519 rows
    const dia = txt('#diameterContentField') || [...doc.querySelectorAll('table.table519 td')].map(t => t.textContent).find(t => /km\s*\(/.test(t)) || '';
    const tmp = txt('#temperatureContentField') || [...doc.querySelectorAll('table.table519 td')].map(t => t.textContent).find(t => /°C/.test(t)) || '';
    const d = dia.match(/([\d.]+)\s*km\s*\(\s*(\d+)\s*\/\s*(\d+)/);
    const t = tmp.match(/(-?\d+)\s*°C\D+?(-?\d+)\s*°C/);
    const scoreEl = doc.querySelector('#scoreContentField') || [...doc.querySelectorAll('table.table519 td')].find(td => td.querySelector('a[href*="page=statistics"]'));
    const st = scoreEl ? scoreEl.textContent.replace(/\s+/g, ' ').match(/^([\d.]+)\s*\(\D*?(\d+)\D+?([\d.]+)\)/) : null;
    const moonA = doc.querySelector('#moon a[href*="cp="]') || doc.querySelector('table.table519 a[href*="cp="][href*="re=0"]');
    const online = doc.querySelector('.online-title span');
    const boxes = [...doc.querySelectorAll('.content-box-s')].map((b, i) => {
      const idle = b.querySelector('td.idle');
      const link = b.querySelector('a[href*="page="]');
      const page = link ? new URL(link.getAttribute('href'), 'http://x/').searchParams.get('page') : null;
      const timer = b.querySelector('[data-time], .timer, .countdown, [id^="bxx"]');   // active markup: GUESS
      return { box: page || ['buildings', 'research', 'shipyard'][i] || null, title: (b.querySelector('h3') || {}).textContent?.trim() ?? null,
               idle: !!idle, restSec: timer && timer.getAttribute('data-time') ? +timer.getAttribute('data-time') : null,
               text: (b.querySelector('.content') || b).textContent.replace(/\s+/g, ' ').trim() };
    });
    const upTimer = !boxes.length && doc.querySelector('table.table519 .timer[data-time]');      // upstream: building queue only
    if (upTimer) boxes.push({ box: 'buildings', title: null, idle: false, restSec: +upTimer.getAttribute('data-time'),
                              text: upTimer.parentElement.textContent.replace(/\s+/g, ' ').trim() });
    return {
      planetName: txt('#planetNameHeader') || txt('.planetname') || null,
      diameter: d ? parseDe(d[1]) : null, fieldsUsed: d ? +d[2] : null, fieldsMax: d ? +d[3] : null,
      tempMin: t ? +t[1] : null, tempMax: t ? +t[2] : null,
      coords: ((txt('#positionContentField') || [...doc.querySelectorAll('table.table519 td > a[href*="page=galaxy"]')].map(a => a.textContent).find(t => COORD_RE.test(t)) || '')
               .match(COORD_RE) || [])[0]?.slice(1, -1) || null,
      points: st ? parseDe(st[1]) : null, rank: st ? +st[2] : null, players: st ? parseDe(st[3]) : null,
      onlinePlayers: online ? +online.textContent.trim() : null,
      moonId: moonA ? cpOf(moonA, 'http://x/game.php') : null,
      constructions: boxes,
      events: fleetEvents(doc),
    };
  }

  // ---------- 8. insertion points ----------
  function anchors(doc = document) {
    return {
      menu: doc.querySelector('#menuTable') || doc.querySelector('#leftmenu > #menu'),          // append <li>
      menuBefore: doc.querySelector('#leftmenu > #menu > li.menu-footer'),                       // upstream: insertBefore this
      topBar: doc.querySelector('#bar > ul'),
      rightColumn: doc.querySelector('#rechts'),
      content: doc.querySelector('#inhalt') || doc.querySelector('#content'),
      footer: doc.querySelector('#siteFooter .fright') || doc.querySelector('#footer'),
    };
  }

  function parseLayout(doc = document) {
    const det = detect(doc);
    const pl = planets(doc);
    const r = route(doc);
    const res = {
      detect: det, route: r, time: serverTime(doc), player: player(doc),
      planets: pl.list, planetCount: pl.count, current: currentBody(doc, pl), resources: resources(doc),
    };
    res.events = fleetEvents(doc);                                       // event box is on every full page [REAL]
    if (r.pageKey === 'overview' && r.mode === 'show') res.overview = overview(doc);
    return res;
  }

  const api = { parseDe, parseShort, detect, route, serverTime, planets, currentBody, resources, amountAt, player,
                fleetEvents, overview, anchors, parseLayout, parseTooltip, STYLE_MISSION };
  root.GZLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
