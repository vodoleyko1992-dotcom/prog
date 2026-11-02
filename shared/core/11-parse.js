/* shared/core/11-parse.js — layout, buildings and fleet page parsers (recipes from specs/layout.md, buildings.md, fleet.md,
 * ogamelive.md §9, galaxy.md §11; GALAXYZ: specs/galaxyz/*.md, section "GALAXYZ" below). Owner: core.
 * Parsers never throw on missing elements; they return null fields. The public parsers keep their OgameX return shapes and
 * switch to the GALAXYZ recipes when the document is a GALAXYZ page (meta generator), fetched documents included. */
(function (OGX) {
  'use strict';
  const parse = (OGX.parse = OGX.parse || {});
  const U = () => OGX.util;

  /** Document from a Document, an Element, or an HTML string (DOMParser, never inserted into the page). */
  function toDoc(x) {
    if (!x) return new DOMParser().parseFromString('', 'text/html');
    if (typeof x === 'string') return new DOMParser().parseFromString(x, 'text/html');
    return x;
  }
  /** Raw HTML text from a string or a Document (inline scripts included). */
  function toHtml(x) {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (x.documentElement) return x.documentElement.outerHTML;
    if (x.outerHTML) return x.outerHTML;
    return String(x);
  }
  parse._toDoc = toDoc;
  parse._toHtml = toHtml;
  const q = (root, sel) => { try { return root ? root.querySelector(sel) : null; } catch (e) { return null; } };
  const qa = (root, sel) => { try { return root ? Array.from(root.querySelectorAll(sel)) : []; } catch (e) { return []; } };
  const txt = (el) => (el ? el.textContent.trim() : '');
  const meta = (doc, n) => { const m = q(doc, `meta[name="${n}"]`); return m ? m.getAttribute('content') : null; };
  const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const numOrNull = (v) => { if (v === null || v === undefined || v === '') return null; const n = +v; return Number.isFinite(n) ? n : null; };

  // ------------------------------------------------------------------ GALAXYZ / 2Moons (specs/galaxyz/*.md)
  // Recipes from layout-recipes.js (GZLayout), tools/buildings/parse-buildings.js, fleet-recipes.js, empire-recipes.js.
  // Exact values first: resourceTicker(...) floats, data-real, t=, data-value; never the short forms ("2.064 M", "47.5K").
  // Pitfalls: duplicated ids on every page (#planetList x N, #OvfleetEvents, #technologies): select by class/structure.
  const gz = (parse.gz = parse.gz || {});
  const gzNum = (s) => (s == null ? null : U().parseGzNumber(s));
  const COORD_RE = /\[(\d+):(\d+):(\d+)\]/;
  const MOON_LABELS = ['Moon', 'Mond', 'Luna', 'Луна', 'Lune', 'Ay', 'Księżyc', 'Maan', 'Lua', 'Φεγγάρι'];
  const moonLabelRe = new RegExp('\\((?:' + MOON_LABELS.join('|') + ')\\)\\s*\\[', 'i');
  const moonLabelTail = new RegExp('\\s*\\((?:' + MOON_LABELS.join('|') + ')\\)\\s*$', 'i');
  const scriptsText = (doc) => qa(doc, 'script:not([src])').map((s) => s.textContent).join('\n');
  const cpOf = (a) => { try { return intOrNull(new URL(a.getAttribute('href'), 'http://x/game.php').searchParams.get('cp')); } catch (e) { return null; } };
  /** true for a GALAXYZ / 2Moons document (generator meta), also for fetched pages. */
  gz.is = (doc) => /^(GALAXYZ|2Moons)\b/i.test(meta(doc, 'generator') || '');
  const isGz = (doc) => gz.is(doc);

  /** Server clock: { wall: 'Y-m-d H:i:s' (server zone), userOffsetSec, renderUnix (exact, from an event countdown) | null }. */
  gz.serverTime = function (doc = document) {
    doc = toDoc(doc);
    const src = scriptsText(doc);
    const m = /serverTime\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/.exec(src);
    const off = /ServerTimezoneOffset\s*=\s*(-?\d+)/.exec(src);
    const p2 = (n) => String(n).padStart(2, '0');
    const wall = m ? `${m[1]}-${p2(+m[2] + 1)}-${p2(+m[3])} ${p2(+m[4])}:${p2(+m[5])}:${p2(+m[6])}` : null;
    let renderUnix = null;
    for (const el of qa(doc, '.fleets[data-fleet-end-time][data-fleet-time]')) {
      const end = +el.getAttribute('data-fleet-end-time'); const rest = +el.getAttribute('data-fleet-time');
      if (end > 1e9 && Number.isFinite(rest)) { renderUnix = end - rest; break; }
    }
    return { wall, userOffsetSec: off ? +off[1] : null, renderUnix };
  };

  // "20.000 km (288 / 405)" in any language: the unit word after the diameter is optional and never matched by name ("км" on the
  // Russian UI); the temperature words between the two °C values are skipped the same way ("32°C до 72°C", "-12°C to 28°C").
  const DIAMETER_RE = /([\d.,]+)\s*(?:[^\d\s()/]{1,12}\s*)?\(\s*(\d+)\s*\/\s*(\d+)/;
  const TEMP_RE = /(-?\d+)\s*°C\D+?(-?\d+)\s*°C/;
  /** Planet tooltip / title text -> { tempMin, tempMax, diameter, fieldsUsed, fieldsMax } | null when it holds neither. */
  function gzTooltip(t) {
    if (!t) return null;
    const temp = TEMP_RE.exec(t);
    const dia = DIAMETER_RE.exec(t);
    if (!temp && !dia) return null;
    return { tempMin: temp ? +temp[1] : null, tempMax: temp ? +temp[2] : null,
      diameter: dia ? gzNum(dia[1]) : null, fieldsUsed: dia ? +dia[2] : null, fieldsMax: dia ? +dia[3] : null };
  }
  gz.tooltip = gzTooltip;
  /** All bodies: #planetSelector (authoritative, incl. moons "(Moon)") merged with the planet list (#rechts .smallplanet). */
  gz.bodies = function (doc = document) {
    doc = toDoc(doc);
    const sel = qa(doc, '#planetSelector option').map((o) => {
      const t = o.textContent.trim(); const c = COORD_RE.exec(t);
      return { id: intOrNull(o.value), name: t.replace(/\s*\[\d+:\d+:\d+\]\s*$/, '').replace(moonLabelTail, '').trim(),
        coords: c ? `${c[1]}:${c[2]}:${c[3]}` : null, isMoon: moonLabelRe.test(t), selected: o.hasAttribute('selected') };
    });
    const list = new Map();
    for (const sp of qa(doc, '.smallplanet')) {
      const a = q(sp, 'a.planetlink');
      if (!a) continue;
      const id = cpOf(a);
      const img = q(sp, 'img.planetPic');
      const moonA = q(sp, 'a.moonlink');   // [GUESS] markup, never seen live
      list.set(id, {
        name: txt(q(sp, '.planet-name')) || null, coords: U().coords(txt(q(sp, '.planet-koords'))),
        image: img ? ((img.getAttribute('src') || '').match(/s_([a-z]+\d*)\.(?:gif|jpg|png)/i) || [])[1] || null : null,
        active: a.classList.contains('active') || a.classList.contains('active-planet'),
        building: !!q(sp, '.buildingIco, .bi-building-fill-up'),
        tip: gzTooltip(a.getAttribute('title')),
        moon: moonA ? { id: cpOf(moonA), active: moonA.classList.contains('active'), tip: gzTooltip(moonA.getAttribute('title')) } : null,
      });
    }
    const out = sel.map((s) => {
      const l = list.get(s.id) || null;
      return Object.assign({}, s, { isMoon: s.isMoon || !!(l && l.image === 'mond'), listed: !!l, name: (l && l.name) || s.name,
        coords: s.coords || (l && l.coords) || null, building: l ? l.building : null, active: l ? l.active : null, tip: l ? l.tip : null,
        moonLink: l && l.moon ? l.moon : null });
    });
    for (const [id, l] of list) if (!out.some((b) => b.id === id)) out.push({ id, name: l.name, coords: l.coords, isMoon: l.image === 'mond', selected: false, listed: true, building: l.building, active: l.active, tip: l.tip, moonLink: l.moon });
    for (const b of out) if (b.moonLink && b.moonLink.id && !out.some((x) => x.id === b.moonLink.id)) {
      out.push({ id: b.moonLink.id, name: null, coords: b.coords, isMoon: true, selected: false, listed: true, building: null, active: b.moonLink.active, tip: b.moonLink.tip, moonLink: null });
    }
    const cnt = /(\d+)\s*\/\s*(\d+)/.exec(txt(q(doc, '#countColonies')));
    return { list: out, count: cnt ? { used: +cnt[1], max: +cnt[2] } : null, hasList: list.size > 0 };
  };
  /** parse.planetList shape (planets with their moon), tooltips null on info pages / fleetStep3 (no #rechts). */
  gz.planetList = function (doc = document) {
    const { list } = gz.bodies(doc);
    const planets = list.filter((b) => !b.isMoon);
    const sel = (doc && doc.querySelector) ? q(toDoc(doc), '#planetSelector option[selected]') : null;
    const curId = sel ? intOrNull(sel.value) : null;
    return planets.map((p) => {
      const m = list.find((b) => b.isMoon && ((p.moonLink && b.id === p.moonLink.id) || b.coords === p.coords)) || null;
      const t = p.tip || {};
      const mt = (m && m.tip) || {};
      return {
        planetId: p.id, rowId: null, name: p.name, coords: p.coords,
        diameter: t.diameter ?? null, fieldsUsed: t.fieldsUsed ?? null, fieldsMax: t.fieldsMax ?? null, tempMin: t.tempMin ?? null, tempMax: t.tempMax ?? null,
        building: p.building, downgrading: null, isCurrent: curId !== null ? curId === p.id : !!p.active,
        moonId: m ? m.id : null,
        moon: m ? { id: m.id, name: m.name, diameter: mt.diameter ?? null, fieldsUsed: mt.fieldsUsed ?? null, fieldsMax: mt.fieldsMax ?? null, isCurrent: curId === m.id } : null,
      };
    });
  };
  gz.currentBody = function (doc = document) {
    doc = toDoc(doc);
    const { list } = gz.bodies(doc);
    const o = q(doc, '#planetSelector option[selected]');
    const id = o ? intOrNull(o.value) : ((list.find((b) => b.active) || {}).id ?? null);
    const b = list.find((x) => x.id === id) || null;
    const img = q(doc, '#planetImage img');
    const isMoon = b ? b.isMoon : /s_mond\./i.test(img ? img.getAttribute('src') || '' : '');
    const planet = isMoon && b ? list.find((x) => !x.isMoon && x.coords === b.coords) : null;
    return { key: id !== null ? (isMoon ? 'm' : 'p') + id : null, id, isMoon, planetId: isMoon ? (planet ? planet.id : null) : id,
      coords: b ? b.coords : null, name: txt(q(doc, '#planetNameHeader')) || (b ? b.name : null) };
  };

  /** Header resources: resourceTicker floats (amount, storage, production per hour), data-real, energy t="free / produced", DM. */
  gz.resources = function (doc = document) {
    doc = toDoc(doc);
    const src = scriptsText(doc);
    const tick = {};
    const re = /resourceTicker\(\{\s*available:\s*\(?\s*(-?[\d.eE+]+)\s*\)?\s*,\s*limit:\s*\[\s*-?[\d.]+\s*,\s*"?(-?[\d.eE+]+)"?\s*\]\s*,\s*production:\s*"?(-?[\d.eE+]+)"?\s*,\s*valueElem:\s*"current_(\w+)"/g;
    let m;
    while ((m = re.exec(src))) tick[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
    const out = { metal: null, crystal: null, deuterium: null, energy: null, darkmatter: null, tooltips: {} };
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const td = q(doc, '#current_' + k);
      const real = td ? numOrNull(td.getAttribute('data-real')) : null;
      const icon = q(doc, `img[data-currentname="current_${k[0].toUpperCase() + k.slice(1)}"]`);
      const tt = icon ? icon.getAttribute('title') || '' : '';
      const ttNum = (cls) => { const r = new RegExp(`class='[^']*\\b${cls}\\b[^']*'\\s*>\\s*(-?[\\d.]+)`).exec(tt); return r ? gzNum(r[1]) : null; };
      const t = tick[k] || {};
      const tip = tt ? { amount: ttNum('current'), storage: ttNum('storage'), perHour: ttNum('production') } : null;
      out.tooltips[k] = tip;
      const amount = t.amount ?? real;
      if (amount === null || amount === undefined) continue;
      const perHour = t.perHour ?? (tip ? tip.perHour : null);
      out[k] = { amount, storage: t.storage ?? (tip ? tip.storage : null), perHour, perSecond: perHour !== null && perHour !== undefined ? perHour / 3600 : null };
    }
    // energy: the cell in the column of img[data-currentname="current_Energy"]; t = "<free> / <produced>"
    let eTd = null;
    const eIcon = q(doc, 'img[data-currentname="current_Energy"]');
    if (eIcon && eIcon.closest('td') && eIcon.closest('table')) {
      const col = eIcon.closest('td').cellIndex; const table = eIcon.closest('table');
      eTd = Array.from(table.rows).slice(1).map((r) => r.cells[col]).find((c) => c && c.classList.contains('res_current')) || null;
    }
    if (!eTd) eTd = q(doc, '#resTable td.res_current[t]') || qa(doc, 'td.res_current').find((td) => !td.id) || null;
    if (eTd) {
      const raw = eTd.getAttribute('t') || eTd.getAttribute('data-tooltip-content') || eTd.textContent;
      const r = /(-?[\d.]+)\s*\/\s*(-?[\d.]+)/.exec(String(raw).replace(/&nbsp;| /g, ' '));
      if (r) { const free = gzNum(r[1]); const prod = gzNum(r[2]); out.energy = { available: free, production: prod, consumption: prod - free }; }
    }
    const dm = q(doc, '#current_darkmatter');
    out.darkmatter = dm ? numOrNull(dm.getAttribute('data-real')) : null;
    return out;
  };

  // tn_vacation_mode (language/*/INGAME.php) as rendered in the topnav infobox; en, ru, de + the fork's English wording.
  const VACATION_RE = /vacation mode|режиме? отпуска|urlaubsmodus|modo vacaciones|mode vacances|modalità vacanza/i;
  /**
   * Vacation mode [UPSTREAM main.topnav.tpl:75-101]: in vacation the whole topnav <script> block (with `var vacation`) is NOT
   * rendered and `<div class="infobox">{tn_vacation_mode} {until}</div>` is shown instead. So: infobox text -> true (+ until),
   * `var vacation = N` -> N != 0, neither -> false. { vacation, until: text | null, source: 'infobox'|'var'|'none' }.
   */
  gz.vacation = function (doc = document, src) {
    doc = toDoc(doc);
    for (const box of qa(doc, '.infobox')) {
      const t = txt(box).replace(/\s+/g, ' ');
      if (!VACATION_RE.test(t)) continue;
      const m = /(\d{1,2}\.\s*\S+\s+\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$/.exec(t);
      return { vacation: true, until: m ? m[1] : null, source: 'infobox' };
    }
    const vac = /var\s+vacation\s*=\s*(\d+)/.exec(src === undefined ? scriptsText(doc) : src);
    if (vac) return { vacation: vac[1] !== '0', until: null, source: 'var' };
    return { vacation: false, until: null, source: 'none' };
  };

  /** Player: { id (only where Dialog.Playercard(id, name) names this player, e.g. page=tournament) | null, name, rank, unreadMessages, vacation, authLevel, lang }. */
  gz.player = function (doc = document) {
    doc = toDoc(doc);
    const name = txt(q(doc, '#playerName .textBeefy a')) || txt(q(doc, '#playerName .textBeefy')) || null;
    const stat = qa(doc, '#bar a[href*="page=statistics"]').find((a) => /[?&]range=\d+/.test(a.getAttribute('href') || ''));
    const src = scriptsText(doc);
    let id = null;
    if (name) for (const a of qa(doc, 'a[onclick*="Dialog.Playercard("]')) {
      const pm = /Dialog\.Playercard\((\d+),\s*'([^']*)'/.exec(a.getAttribute('onclick') || '');
      if (pm && pm[2] === name) { id = +pm[1]; break; }
    }
    const msg = q(doc, '.messages-section .new-msg-count');
    const vm = gz.vacation(doc, src);
    return {
      id, name, rank: stat ? intOrNull((/[?&]range=(\d+)/.exec(stat.getAttribute('href')) || [])[1]) : null,
      unreadMessages: msg ? intOrNull(txt(msg)) || 0 : 0,
      vacation: vm.vacation, vacationUntil: vm.until,
      authLevel: +((/var\s+auth\s*=\s*(\d+)/.exec(src) || [])[1] || 0),
      lang: (/var\s+Lang\s*=\s*"([^"]*)"/.exec(src) || [])[1] || null,
    };
  };

  /** Drift alert through the learning module when it is loaded and active (parsers never depend on it). */
  const learnAlert = (key, kind, what, data) => { try { if (OGX.learn && OGX.learn.alert) OGX.learn.alert(key, what, { kind, data }); } catch (e) { /* ignore */ } };
  // Event style class -> mission id [UPSTREAM class.FlyingFleetsTable.php:155-173]. GALAXYZ styles expeditions 'expo' (REAL,
  // fixtures/galaxyz/queue/buildings-queue5-live.html); vanilla 2Moons styles missions 11 and 15 'transport' (to position 16).
  const STYLE_MISSION = { attack: 1, federation: 2, transport: 3, deploy: 4, hold: 5, espionage: 6, colony: 7, harvest: 8, destroy: 9, missile: 10, expo: 15 };
  gz.STYLE_MISSION = STYLE_MISSION;
  // Body type word printed before each coordinate link ($LNG['type_planet_1|2|3'] in every FlyingFleetsTable sentence, before the
  // body name). Case-sensitive on purpose: the lower-case sentence words ("back to planet", "к полю обломков") are no label.
  const BODY_TYPE_LABELS = {
    1: ['Planet', 'Планета', 'Planeta', 'Planète', 'Pianeta', 'Gezegen', 'Πλανήτης'],
    2: ['Debris Field', 'Debris field', 'Debris', 'Поле обломков', 'Trümmerfeld', 'Campo de escombros', 'Champ de débris', 'Campo detriti', 'Puinveld'],
    3: MOON_LABELS,
  };
  gz.BODY_TYPE_LABELS = BODY_TYPE_LABELS;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodyTypeRes = Object.entries(BODY_TYPE_LABELS).map(([type, labels]) => [+type, new RegExp('(?<![\\p{L}\\p{N}])(?:' + labels.map(reEsc).join('|') + ')(?![\\p{L}\\p{N}])', 'u')]);
  /** Body type 1|2|3 of the FIRST type label in a sentence segment (the type word precedes the body name), null when none. */
  function gzBodyTypeIn(text) {
    let best = null;
    for (const [type, re] of bodyTypeRes) {
      const m = re.exec(text || '');
      if (m && (!best || m.index < best.index)) best = { index: m.index, type };
    }
    return best ? best.type : null;
  }
  gz.bodyTypeIn = gzBodyTypeIn;
  /** Coordinate links of an event sentence with the body type word before each: [{ coords, type|null }] in document order.
   * The text buffer restarts at every link (fleet tooltip, Dialog.PM, coordinates) and skips the .textForBlind ship/cargo lists. */
  function gzEventLinks(span) {
    const out = []; let buf = '';
    const walk = (node) => {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) { buf += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.classList.contains('textForBlind')) { buf = ''; continue; }
        if (n.tagName === 'A') {
          const t = n.textContent;
          if (/page=galaxy/.test(n.getAttribute('href') || '') && COORD_RE.test(t)) out.push({ coords: U().coords(t), type: gzBodyTypeIn(buf) });
          buf = '';
          continue;
        }
        walk(n);
      }
    };
    walk(span);
    return out.filter((l) => l.coords);
  }
  /**
   * Fleet events of the event box (on every full page, layout.md §7), de-duplicated, sorted by end:
   * [{ key, fleetId, endUnix, restSec, status: 'flight'|'return'|'holding', own, style, mission, from, fromType, to, toType, hostile, ownerId, shipsText, cargoText, text }]
   * from = origin, to = target (the sentence order flips on return legs); fromType/toType = 1 planet | 2 debris | 3 moon from the type
   * word before each link, null when the sentence prints none (expedition positions, "reached the debris"). mission from the span
   * class (null + L-alert 'event-style:<class>' for an unknown class); a vanilla 'transport' to position 16 counts as mission 11.
   */
  gz.events = function (doc = document) {
    doc = toDoc(doc);
    const seen = new Set(); const out = [];
    for (const el of qa(doc, '.OvfleetEvents_ .fleets[id^="fleettime_"], table.table519 td.fleets[id^="fleettime_"]')) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      const box = el.closest('.OvfleetEvents_') || el.closest('tr');
      const span = box && q(box, 'span.flight, span.return, span.holding');
      if (!span) continue;
      const cls = Array.from(span.classList);
      const status = cls.find((c) => c === 'flight' || c === 'return' || c === 'holding');
      const type = cls.find((c) => c !== status) || '';
      const own = /^own/.test(type); const style = type.replace(/^own/, '');
      // only links whose text is a coordinate (the "Fleets" tooltip link points at page=galaxy# on the galaxy page), each with the
      // body type word printed before it
      const links = gzEventLinks(span);
      const o = status === 'return' ? links[1] : links[0]; const tg = status === 'return' ? links[0] : links[1];
      const from = o ? o.coords : null, to = tg ? tg.coords : null;
      const blind = qa(span, '.textForBlind').map((s) => s.textContent.trim().replace(/^\(|\)$/g, ''));
      const pm = /Dialog\.PM\((\d+)\)/.exec(span.innerHTML);
      const key = el.id.slice('fleettime_'.length);
      const end = +el.getAttribute('data-fleet-end-time');
      let mission = STYLE_MISSION[style] ?? null;
      const sample = () => ({ style: type, text: span.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) });
      // vanilla style of missions 11 and 15: a 'transport' to position 16 is no transport (GALAXYZ styles 15 'expo', so 11 remains)
      if (style === 'transport' && to && +to.split(':')[2] >= 16) { mission = 11; learnAlert('event-style:transport16', 'event-style', 'событие флота: класс transport на позицию 16 (принято за задание 11)', sample()); }
      if (mission === null && style) learnAlert('event-style:' + style, 'event-style', 'событие флота: неизвестный класс ' + type, sample());
      const endStr = String(end);
      out.push({
        key, fleetId: key.length > endStr.length && key.startsWith(endStr) ? +key.slice(endStr.length) : null, endUnix: end,
        restSec: +el.getAttribute('data-fleet-time'), status, own, style, mission, from: from || null, fromType: o ? o.type : null, to: to || null, toType: tg ? tg.type : null,
        hostile: !own && [1, 2, 6, 9, 10].includes(mission), ownerId: pm ? +pm[1] : null,
        shipsText: blind[0] ?? null, cargoText: blind[1] ?? null, text: span.textContent.replace(/\s+/g, ' ').trim(),
      });
    }
    return out.sort((a, b) => a.endUnix - b.endUnix);
  };

  /** Overview planet data (#planetDetails) + construction boxes. */
  gz.overview = function (doc = document) {
    doc = toDoc(doc);
    const t = (sel) => txt(q(doc, sel)).replace(/\s+/g, ' ');
    const d = DIAMETER_RE.exec(t('#diameterContentField'));
    const tp = TEMP_RE.exec(t('#temperatureContentField'));
    const st = /^([\d.]+)\s*\(\D*?(\d+)\D+?([\d.]+)\)/.exec(t('#scoreContentField'));
    const moonA = q(doc, '#moon a[href*="cp="]');
    const boxes = qa(doc, '.content-box-s').map((b) => {
      const link = q(b, 'a[href*="page="]');
      let pg = null;
      try { pg = link ? new URL(link.getAttribute('href'), 'http://x/').searchParams.get('page') : null; } catch (e) { pg = null; }
      // remaining seconds: the progress bar's data-time (#progressbar buildings, #progressbars research; REAL ru snapshot #56) or the
      // countdown's secs attribute (#time / #time1, whose data-time is the TOTAL time); .countdown[data-time] = [UPSTREAM] guess
      const bar = q(b, '#progressbar[data-time], #progressbars[data-time], .countdown[data-time]');
      const cd = q(b, '[secs]');
      const restSec = bar && Number.isFinite(+bar.getAttribute('data-time')) ? +bar.getAttribute('data-time')
        : cd && Number.isFinite(+cd.getAttribute('secs')) ? +cd.getAttribute('secs') : null;
      return { box: pg, title: txt(q(b, 'h3')) || null, idle: !!q(b, 'td.idle'), restSec,
        text: (q(b, '.content') || b).textContent.replace(/\s+/g, ' ').trim() };
    });
    return {
      planetName: t('#planetNameHeader') || null,
      diameter: d ? gzNum(d[1]) : null, fieldsUsed: d ? +d[2] : null, fieldsMax: d ? +d[3] : null,
      tempMin: tp ? +tp[1] : null, tempMax: tp ? +tp[2] : null,
      coords: U().coords(t('#positionContentField')),
      points: st ? gzNum(st[1]) : null, rank: st ? +st[2] : null, players: st ? gzNum(st[3]) : null,
      onlinePlayers: intOrNull(t('.online-title span')),
      moonId: moonA ? cpOf(moonA) : null,
      constructions: boxes,
    };
  };

  /** List pages buildings | research | shipyard (fleet/defense): REAL markup, buildings.md §3.5. */
  gz.techItems = function (doc = document) {
    doc = toDoc(doc);
    const out = []; const seen = new Set();
    for (const li of qa(doc, 'ul.icons > li.technology[data-technology]')) {
      const id = +li.getAttribute('data-technology');
      if (seen.has(id)) continue;
      seen.add(id);
      const icon = q(li, 'div.icon');
      const lv = q(li, 'span.level');
      const raw = lv ? lv.getAttribute('data-value') : null;
      const form = q(li, 'form.build_form');
      const fields = form ? Object.fromEntries(qa(form, 'input[name]').map((i) => [i.name, i.value])) : null;
      const off = (icon && icon.getAttribute('data-status') === 'off') || li.getAttribute('data-status') === 'off';
      const title = (icon && icon.getAttribute('title')) || (q(li, 'a.detail_button') || { getAttribute: () => '' }).getAttribute('title') || li.getAttribute('title') || '';
      const isUnit = id >= 200 && id < 600;
      out.push({
        id, name: String(title).split(/<br\s*\/?>/i)[0].trim() || null,
        cssKey: icon ? Array.from(icon.classList).find((c) => !/^(icon|sprite|sprite_medium|medium|tooltipTop|hideOthers|js_hideTipOnMobile)$/.test(c)) || null : null,
        value: raw !== null ? +raw : (lv ? intOrNull(lv.textContent.replace(/\D/g, '')) || 0 : 0),
        off, isUnit, hasForm: !!form, button: !!q(li, 'button.upgrade'),
        form: form ? { action: form.getAttribute('action'), fields } : null,
      });
    }
    return out;
  };
  /** "... under construction" box of a list page (first #technologies without ul.icons). REAL only empty.
   * items [UPSTREAM page.buildings.default.tpl / page.research.default.tpl]: one per queue form with a `building`/`tech` input:
   * { id, level (trailing number of the button) | null, restSec (head only: #progressbar(s) data-time, else the countdown's secs) | null,
   *   endUnix (span.timer data-time of that row) | null }. */
  gz.queueBox = function (doc = document) {
    doc = toDoc(doc);
    const box = qa(doc, '#technologies').find((t) => !q(t, 'ul.icons') && q(t, '.largebox'));
    if (!box) return null;
    const large = q(box, '.largebox');
    const empty = !large.textContent.trim() && !q(large, '*');
    const items = [];
    for (const f of qa(box, 'form')) {
      const inp = q(f, 'input[name="building"], input[name="tech"]');
      if (!inp) continue;
      const btn = q(f, 'button, input[type="submit"]');
      const m = /(\d+)\s*$/.exec(((btn && (btn.textContent || btn.value)) || '').trim());
      items.push({ id: +inp.value, level: m ? +m[1] : null, restSec: null, endUnix: null });
    }
    // GALAXYZ (live Aeternum, snapshots 2026-10-31/11-01): no building / tech input in the queue forms; the running item is
    // .build-info-row > img.build-icon[src=".../gebaeude/<id>.png"] + .build-level > span (target level), the queued ones are
    // a.construction-queue-item[style*="gebaeude/<id>.png"] > span (level). Without this every busy queue read as «unknown»:
    // botbuild waited 15 min per planet and never knew the research queue (log 2026-11-02). Units (200-599) are left out.
    if (!items.length) {
      const idOf = (x) => { const mm = /\/(\d{1,3})\.(?:png|gif|jpe?g|webp)\b/i.exec(String(x || '')); return mm ? +mm[1] : 0; };
      const lvOf = (x) => { const mm = /(\d+)/.exec(String(x || '').replace(/\s+/g, '')); return mm ? +mm[1] : null; };
      const okId = (id) => id > 0 && !(id >= 200 && id < 600);
      for (const img of qa(box, 'img.build-icon')) {
        const id = idOf(img.getAttribute('src'));
        if (!okId(id)) continue;
        const row = img.closest('.build-info-row') || img.parentElement;
        const lv = row ? q(row, '.build-level span') || q(row, '.build-level') : null;
        items.push({ id, level: lv ? lvOf(lv.textContent) : null, restSec: null, endUnix: null });
      }
      for (const a of qa(box, 'a.construction-queue-item')) {
        const id = idOf(a.getAttribute('style'));
        if (!okId(id)) continue;
        const sp = q(a, 'span');
        const it = { id, level: lvOf((sp && sp.textContent) || a.getAttribute('data-cancel-message')), restSec: null, endUnix: null };
        // the research page repeats the running item in the queued row (snapshot 2026-10-31: 106/21 twice)
        if (!items.some((x) => x.id === it.id && x.level === it.level)) items.push(it);
      }
    }
    // remaining seconds of the head: the progress bar's data-time, else the countdown's secs. Never #time's data-time: on GALAXYZ
    // it is the TOTAL build time (live: #progressbar data-time 461, span#time data-time 640 secs 461), so a selector list that
    // matched it first (template order, a re-render without the bar) put the queue end up to a full build time too late.
    if (items.length) {
      const bar = q(box, '#progressbar[data-time], #progressbars[data-time]');
      const cd = q(box, '.build-time[secs], #time[secs], #time1[secs]');
      const rest = bar && Number.isFinite(+bar.getAttribute('data-time')) ? +bar.getAttribute('data-time')
        : cd && Number.isFinite(+cd.getAttribute('secs')) ? +cd.getAttribute('secs') : null;
      if (rest !== null) items[0].restSec = rest;
    }
    qa(box, 'span.timer[data-time]').forEach((e, i) => { const u = +e.getAttribute('data-time'); if (items[i] && Number.isFinite(u)) items[i].endUnix = u; });
    return { title: txt(q(box, 'h3')) || null, empty, items,
      timers: qa(large, '[data-time]').map((e) => ({ cls: e.className, dataTime: +e.getAttribute('data-time'), text: txt(e) })) };
  };
  /** Shipyard queue: inline `data = {"Queue":[[name, count, secsPerUnit, id]...], "b_hangar_id_plus": s}` (buildings.md §5.2). */
  gz.shipyardQueue = function (doc = document) {
    const src = scriptsText(toDoc(doc));
    const m = /^\s*data\s*=\s*(\{.*"Queue".*\});\s*$/m.exec(src);
    if (!m) return null;
    let d;
    try { d = JSON.parse(m[1]); } catch (e) { return null; }
    const items = (Array.isArray(d.Queue) ? d.Queue : []).map((x) => ({ id: +x[3], name: x[0], count: +x[1], secsPerUnit: +x[2] }));
    const plus = +d.b_hangar_id_plus || 0;
    return { items, firstUnitElapsed: plus, totalSecs: Math.max(0, items.reduce((s, x) => s + x.count * x.secsPerUnit, 0) - plus) };
  };

  /** page=resources: production % per producer (select prod[ID] 0..10 -> 0..100) and the rows (empire.md §3). */
  gz.resourceSettings = function (doc = document) {
    doc = toDoc(doc);
    const percents = {};
    for (const s of qa(doc, 'select[name^="prod["]')) {
      const id = intOrNull((/\[(\d+)\]/.exec(s.name) || [])[1]);
      const o = q(s, 'option[selected]') || (s.options && s.options[s.selectedIndex]);
      if (id !== null && o) percents[id] = +o.value * 10;
    }
    const rows = qa(doc, 'table.listOfResourceSettingsPerPlanet tr').map((tr) => {
      const label = txt(q(tr, 'td.label'));
      const sel = q(tr, 'select[name^="prod["]');
      if (!label || !sel) return null;
      const tds = qa(tr, 'td').slice(1, 5).map((td) => gzNum(td.textContent));
      return { id: intOrNull((/\[(\d+)\]/.exec(sel.name) || [])[1]), label, level: gzNum((/\(([^)]*)\)\s*$/.exec(label) || [])[1]),
        metal: tds[0], crystal: tds[1], deuterium: tds[2], energy: tds[3] };
    }).filter(Boolean);
    return { percents, factor: null, rows };
  };

  /**
   * page=settings (2Moons ShowSettingsPage, account options) -> { spycount, form } | null when the page has no spycount field.
   * spycount = the account's spio_anz: how many probes every one-click spy sends (fleetAjax mission 6 sends
   * min(spio_anz, probes on the planet); the server clamps it to 1..4294967295) [UPSTREAM ShowSettingsPage / ShowFleetAjaxPage].
   * form = { action, method, fields: [[name, value], ...] } in browser submit order (checked checkboxes/radios only, selected
   * options); read-only here: nothing in the add-on posts it (no saved real markup of this page to verify a re-post against).
   */
  gz.settingsPage = function (doc = document) {
    doc = toDoc(doc);
    const inp = q(doc, '[name="spycount"]');
    if (!inp) return null;
    const v = parseInt(String(inp.value != null ? inp.value : inp.getAttribute('value') || '').replace(/[^\d]/g, ''), 10);
    const f = inp.form || inp.closest('form');
    let form = null;
    if (f) {
      const fields = [];
      for (const el of qa(f, 'input[name], select[name], textarea[name]')) {
        const t = String(el.type || el.getAttribute('type') || '').toLowerCase();
        if (el.disabled || t === 'submit' || t === 'button' || t === 'image' || t === 'reset' || t === 'file') continue;
        if ((t === 'checkbox' || t === 'radio') && !el.checked) continue;
        if (el.tagName === 'SELECT') {
          for (const o of qa(el, 'option')) if (o.selected) fields.push([el.name, o.value]);
          continue;
        }
        fields.push([el.name, el.value]);
      }
      form = { action: f.getAttribute('action') || '', method: String(f.getAttribute('method') || 'get').toLowerCase(), fields };
    }
    return { spycount: Number.isFinite(v) && v > 0 ? v : null, form };
  };

  // Imperium row order = ascending element id per section (empire.md §2.1, language independent).
  const IMPERIUM_SECTIONS = [
    { key: 'resources', ids: [901, 902, 903, 911] },
    { key: 'buildings', ids: [1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44, 71, 72, 73] },
    { key: 'research', ids: [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199] },
    { key: 'ships', ids: [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220] },
    { key: 'defense', ids: [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411] },
  ];
  /**
   * page=imperium -> { columns: [{ cp, name, coords, fieldsUsed, fieldsMax, image }], bodies: { [cp]: { resources, buildings, ships, defense } },
   * research: { id: level }, warnings } | null. Columns are NOT in planet-list order: key by cp. 911 = energy PRODUCTION; no 502/503.
   */
  gz.empire = function (doc = document) {
    doc = toDoc(doc);
    const table = q(doc, 'table.empire');
    if (!table || table.rows.length < 6) return null;
    const rows = Array.from(table.rows);
    const cells = (tr) => Array.from(tr.cells);
    const columns = cells(rows[1]).slice(2).map((td) => {
      const a = q(td, 'a[href*="cp="]'); const img = q(td, 'img');
      return { cp: a ? cpOf(a) : null, image: img ? ((img.getAttribute('src') || '').match(/s_([a-z]+\d*)\./i) || [])[1] || null : null };
    });
    cells(rows[2]).slice(2).forEach((td, i) => { if (columns[i]) columns[i].name = txt(td); });
    cells(rows[3]).slice(2).forEach((td, i) => { if (columns[i]) columns[i].coords = U().coords(td.textContent); });
    cells(rows[4]).slice(2).forEach((td, i) => {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(td.textContent);
      if (columns[i]) { columns[i].fieldsUsed = m ? +m[1] : null; columns[i].fieldsMax = m ? +m[2] : null; }
    });
    const bodies = {}; const research = {}; const warnings = [];
    for (const c of columns) if (c.cp) bodies[c.cp] = { resources: {}, buildings: {}, ships: {}, defense: {} };
    let sec = -1; let idx = 0;
    for (const tr of rows.slice(5)) {
      if (q(tr, 'th')) { sec++; idx = 0; continue; }
      const s = IMPERIUM_SECTIONS[sec];
      const tds = cells(tr);
      if (!s) { warnings.push('extra row: ' + txt(tds[0])); continue; }
      const id = s.ids[idx++];
      if (id === undefined) { warnings.push(s.key + ': extra row ' + txt(tds[0])); continue; }
      if (s.key === 'research') { research[id] = gzNum((tds[2] || tds[1] || { textContent: '' }).textContent); continue; }
      tds.slice(2).forEach((td, i) => { const c = columns[i]; if (c && c.cp) bodies[c.cp][s.key][id] = gzNum(td.textContent); });
    }
    IMPERIUM_SECTIONS.forEach((s, i) => { if (i > sec) warnings.push('missing section ' + s.key); });
    return { columns, bodies, research, warnings };
  };

  /** page=officier -> { darkMatter, officers: [{ id, name, level, max, locked }] } | null. */
  gz.officers = function (doc = document) {
    doc = toDoc(doc);
    const list = q(doc, '#offList');
    if (!list) return null;
    const dm = q(list, '#button_rpg_darkMatter .level');
    const officers = qa(list, 'a[data-technology]').map((a) => {
      const box = a.closest('.officers100');
      const m = /(\d+)\s*\/\s*(\d+)/.exec(txt(q(a, '.level')));
      return { id: +a.getAttribute('data-technology'), name: a.getAttribute('title'), level: m ? +m[1] : null, max: m ? +m[2] : null,
        locked: !!(box && box.getAttribute('data-status') === 'off') };
    });
    return { darkMatter: dm ? gzNum(dm.textContent) : null, officers };
  };

  // Localized mission names of the fleetTable list (fleet.md §1.2) -> mission id.
  const GZ_MISSION_NAMES = {
    1: ['attack', 'атака', 'angreifen'], 2: ['acs - attack on cooperation', 'alliance attack', 'совместная атака', 'verbandsangriff'],
    3: ['transport', 'транспорт'], 4: ['deploy', 'station', 'оставить', 'stationieren'], 5: ['transfer', 'hold', 'держаться', 'halten'],
    6: ['spying', 'spy', 'шпионаж', 'spionieren'], 7: ['colonize', 'colonisation', 'колонизировать', 'kolonisieren'],
    8: ['recycle', 'переработать', 'abbauen'], 9: ['destroy', 'уничтожить', 'zerstören'], 10: ['missile attack', 'ракетная атака', 'raketenangriff'],
    11: ['research of dark matter', 'dm investigation', 'поиск тёмной материи', 'dm untersuchung'], 15: ['expedition', 'экспедиция'],
  };
  gz.missionIdByName = function (name) {
    const n = String(name || '').trim().toLowerCase();
    for (const id of Object.keys(GZ_MISSION_NAMES)) if (GZ_MISSION_NAMES[id].includes(n)) return +id;
    return null;
  };
  const contentRoot = (doc) => q(doc, '#inhalt') || q(doc, '#content') || doc.body || doc;
  /**
   * page=fleetTable (fleet.md §1): { slots, expeditions, extraCounters, flights: [{ index, fleetId, missionName, missionId, returning, amount,
   * ships: { name: n }, origin, target, arrivalText, returnText, timerUnix, timerRestSec, recallable }], ships: [{ id, name, count, speed, selectable }],
   * prefill, canContinue, bonus, noShips }.
   */
  gz.fleetTable = function (doc = document) {
    doc = toDoc(doc);
    const root = contentRoot(doc);
    const head = qa(root, 'th[colspan="9"]')[0] || null;
    const table = head ? head.closest('table') : null;
    const counters = head ? qa(head, 'div').map((d) => {
      const t = txt(d); const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? { label: t.replace(/\d+\s*\/\s*\d+/, '').trim(), used: +m[1], max: +m[2] } : null;
    }).filter(Boolean) : [];
    const out = { slots: counters[0] ? { used: counters[0].used, max: counters[0].max } : null,
      expeditions: counters[1] ? { used: counters[1].used, max: counters[1].max } : null,
      extraCounters: counters.slice(2), flights: [], noFreeSlots: false, ships: [], prefill: null, canContinue: false, bonus: null,
      // the body has no ship at all: 2Moons prints a #warning box instead of the ship rows [UPSTREAM fleetTable.tpl]
      noShips: !!q(root, '#warning') };
    if (table) {
      for (const tr of qa(table, 'tr')) {
        const td = Array.from(tr.children).filter((c) => c.tagName === 'TD');
        if (td.length === 1 && td[0].colSpan === 9) { out.noFreeSlots = true; continue; }
        if (td.length !== 9 || txt(td[0]) === '-') continue;
        const missionName = (td[1].childNodes[0] ? td[1].childNodes[0].textContent : '').trim();
        const stateLink = q(td[1], 'a[title]');
        const amountA = q(td[2], 'a[data-tooltip-content]');
        const ships = {};
        if (amountA) {
          const d = new DOMParser().parseFromString(amountA.getAttribute('data-tooltip-content'), 'text/html');
          for (const r of qa(d, 'tr')) { const c = qa(r, 'td'); if (c.length === 2) ships[txt(c[0]).replace(/:$/, '')] = gzNum(txt(c[1])); }
        }
        const timer = td[7];
        const recallForm = q(td[8], 'form[action*="sendfleetback"]');
        const idInput = recallForm ? q(recallForm, 'input[name="fleetID"]') : q(td[8], 'input[name="fleetID"]');
        out.flights.push({
          index: intOrNull(txt(td[0])), fleetId: idInput ? intOrNull(idInput.value) : null,
          missionName, missionId: gz.missionIdByName(missionName),
          returning: stateLink ? /\((R|В)\)/.test(txt(stateLink)) : null,
          amount: gzNum(amountA ? txt(amountA) : txt(td[2])), ships,
          origin: U().coords(txt(td[3])), arrivalText: txt(td[4]), target: U().coords(txt(td[5])), returnText: txt(td[6]),
          timerUnix: timer.hasAttribute('data-fleet-end-time') ? +timer.getAttribute('data-fleet-end-time') : null,
          timerRestSec: timer.hasAttribute('data-fleet-time') ? +timer.getAttribute('data-fleet-time') : null,
          recallable: !!recallForm,
        });
      }
    }
    const form = q(root, 'form[action*="page=fleetStep1"]');
    if (form) {
      const v = (n) => { const i = q(form, 'input[name="' + n + '"]'); return i ? intOrNull(i.value) : null; };
      out.prefill = { galaxy: v('galaxy'), system: v('system'), planet: v('planet'), type: v('type'), mission: v('target_mission') };
      for (const cell of qa(form, 'td[id^="ship"][id$="_value"]')) {
        const id = intOrNull(cell.id.replace(/\D/g, ''));
        const tr = cell.closest('tr');
        const first = q(tr, 'td');
        const tip = q(first, '[data-tooltip-content]') || q(first, 'a[title]');
        const tipText = tip ? (tip.getAttribute('data-tooltip-content') || tip.getAttribute('title')) : '';
        out.ships.push({ id, name: tip ? txt(tip) : txt(first), count: gzNum(txt(cell)) || 0,
          speed: tipText ? gzNum(tipText.replace(/^[^\d]*/, '')) : null, selectable: !!q(tr, 'input[name="ship' + id + '"]') });
      }
      out.canContinue = !!q(form, 'input[type="submit"]');
    }
    const bon = qa(root, 'table').reverse().find((t) => /\+\s*-?\d+\s*%/.test(txt(t)) && qa(t, 'td').length === 6);
    if (bon) {
      const v = qa(bon, 'td').map((t) => gzNum(txt(t)));
      out.bonus = { attack: v[0], defense: v[1], shield: v[2], combustion: v[3], impulse: v[4], hyperspace: v[5] };
    }
    return out;
  };
  /** `data = {...};` of fleetStep1/2 (line-anchored: other scripts contain "data." and "data-"). */
  gz.inlineData = function (doc = document) {
    const m = /^\s*data\s*=\s*(\{.*\});\s*$/m.exec(scriptsText(toDoc(doc)));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  };
  /** fleetStep1: { token, fleetGroup, targetMission, target: { galaxy, system, planet, type }, data: { fleetroom, gamespeed, ships, ... }, colonies } | null */
  gz.fleetStep1 = function (doc = document) {
    doc = toDoc(doc);
    const form = q(contentRoot(doc), 'form[action*="page=fleetStep2"]');
    if (!form) return null;
    const val = (n) => { const e = q(form, '[name="' + n + '"]'); return e ? e.value : null; };
    const colonies = [];
    for (const a of qa(form, 'a[href^="javascript:setTarget("]')) {
      const m = /setTarget\((\d+),(\d+),(\d+),(\d+)\)/.exec(a.getAttribute('href'));
      if (m && !a.closest('.shortcut')) colonies.push({ galaxy: +m[1], system: +m[2], planet: +m[3], type: +m[4], name: txt(a).replace(/\s*(\([^)]*\))?\s*\[\d+:\d+:\d+\]\s*$/, '').trim() });
    }
    return { token: val('token'), fleetGroup: intOrNull(val('fleet_group')), targetMission: intOrNull(val('target_mission')),
      target: { galaxy: intOrNull(val('galaxy')), system: intOrNull(val('system')), planet: intOrNull(val('planet')), type: intOrNull(val('type')) },
      data: gz.inlineData(doc), colonies };
  };
  /** fleetStep2: { token, missions: [{ id, name, checked }], stayOptions, consumption, data } | null */
  gz.fleetStep2 = function (doc = document) {
    doc = toDoc(doc);
    const form = q(contentRoot(doc), 'form[action*="page=fleetStep3"]');
    if (!form) return null;
    const missions = qa(form, 'input[type="radio"][name="mission"]').map((r) => ({ id: +r.value, name: txt(q(form, 'label[for="' + r.id + '"]')), checked: r.checked }));
    const stay = q(form, 'select[name="staytime"]');
    return { token: (q(form, 'input[name="token"]') || {}).value || null, missions,
      stayOptions: stay ? Array.from(stay.options).map((o) => ({ value: +o.value, hours: parseFloat(o.textContent) })) : [],
      consumption: gzNum(txt(q(form, '#consumption'))), data: gz.inlineData(doc) };
  };
  /** fleetStep3: { success: true, missionId, distance, consumption, from, to, arrivalText, returnText, ships } or { success: false, message }. */
  gz.fleetStep3 = function (doc = document) {
    doc = toDoc(doc);
    const ok = q(contentRoot(doc), 'th.success');
    if (!ok) return { success: false, message: gz.infoMessage(doc) };
    const kv = []; const ships = {};
    let inShips = false;
    for (const tr of qa(ok.closest('table'), 'tr').slice(1)) {
      if (q(tr, 'th')) { inShips = true; continue; }
      const c = qa(tr, 'td');
      if (c.length !== 2) continue;
      if (inShips) ships[txt(c[0])] = gzNum(txt(c[1])); else kv.push(txt(c[1]));
    }
    return { success: true, title: txt(ok), missionName: kv[0] || null, missionId: gz.missionIdByName(kv[0]), distance: gzNum(kv[1]), maxSpeed: gzNum(kv[2]),
      consumption: gzNum(kv[3]), from: U().coords(kv[4]), to: U().coords(kv[5]), arrivalText: kv[6] || null, returnText: kv[7] || null, ships };
  };
  /** Text of a GALAXYZ info/error page (".headerRS + .mainRS p", upstream table.table519 td p) or null. */
  gz.infoMessage = function (doc = document) {
    doc = toDoc(doc);
    const root = contentRoot(doc);
    const p = q(root, '.mainRS td p') || q(root, 'table.table519 td > p');
    return p ? txt(p).replace(/\s+/g, ' ') : null;
  };
  /**
   * TechnologyDetailsAjax / ResearchDetailsAjax / ShipDetailsAjax panel HTML (json.content[json.target]) -> raw panel data.
   * [UNVERIFIED] selectors from the fork's base.js (buildings.md §4, R12); the response was never captured.
   */
  gz.techPanel = function (html) {
    const d = toDoc(html);
    const card = q(d, '#technologydetails') || d.body;
    const costs = q(card, '.costs');
    const forms = qa(card, 'form.build_form');
    const form = forms.find((f) => q(f, '.build-it_wrap .upgrade')) || forms[forms.length - 1] || null;
    const flag = (n) => (form ? form.getAttribute('data-' + n) === '1' : null);
    return {
      id: costs ? intOrNull(costs.getAttribute('data-tech-id')) : null, level: costs ? intOrNull(costs.getAttribute('data-level')) : null,
      cost: Object.fromEntries(qa(card, 'li.cost-item').map((li) => [li.getAttribute('data-res'), { base: numOrNull(li.getAttribute('data-base')), have: numOrNull(li.getAttribute('data-have')) }])),
      flags: { techOk: flag('tech-ok'), roomOk: flag('room-ok'), maxReached: flag('max-reached'), buyable: flag('buyable'), busy: flag('busy') },
      form: form ? { action: form.getAttribute('action'), fields: Object.fromEntries(qa(form, 'input[name]').map((i) => [i.name, i.value])) } : null,
      buttonDisabled: !!q(card, '.build-it_wrap .upgrade[disabled], .build-it_wrap .upgrade.is-disabled'),
    };
  };

  // ------------------------------------------------------------------ layout
  /** OgameX CSRF meta; '' on GALAXYZ (no CSRF; fleet forms carry their own token). */
  parse.csrf = (doc = document) => meta(toDoc(doc), 'csrf-token') || '';

  /** OgameX metas. GALAXYZ: version = generator version, speeds null (not in the page), player/planet from header + selector. */
  parse.metas = function (doc = document) {
    doc = toDoc(doc);
    if (isGz(doc)) {
      const cur = gz.currentBody(doc); const pl = gz.player(doc);
      const gen = meta(doc, 'generator') || '';
      return { version: gen.split(/\s+/)[1] || null, economySpeed: null, fleetSpeed: null, playerId: pl.id, playerName: pl.name,
        planetId: cur.id, planetName: cur.name, planetCoords: cur.coords, lang: pl.lang || (doc.documentElement && doc.documentElement.getAttribute('lang')) || null,
        generator: gen, engine: 'galaxyz' };
    }
    return {
      version: meta(doc, 'ogame-version'),
      economySpeed: numOrNull(meta(doc, 'ogame-universe-speed')),
      fleetSpeed: numOrNull(meta(doc, 'ogame-universe-speed-fleet')),
      playerId: intOrNull(meta(doc, 'ogame-player-id')),
      playerName: meta(doc, 'ogame-player-name'),
      planetId: intOrNull(meta(doc, 'ogame-planet-id')),
      planetName: meta(doc, 'ogame-planet-name'),
      planetCoords: U().coords(meta(doc, 'ogame-planet-coordinates')),
      lang: (doc.documentElement && doc.documentElement.getAttribute('lang')) || null,
    };
  };

  parse.serverTimeString = function (x = document) {
    let html;
    if (typeof x === 'string' && /serverTime\s*=\s*new Date\(\d/.test(x)) return gz.serverTime(x).wall;
    if (typeof x === 'string') html = x;
    else if (isGz(toDoc(x))) return gz.serverTime(x).wall;
    else {
      const d = toDoc(x);
      const s = qa(d, 'script').map((e) => e.textContent).find((t) => t.includes('var serverTime')) || '';
      html = s;
    }
    const m = /var serverTime = new Date\('([^']+)'\)/.exec(html || '');
    return m ? m[1] : null;
  };

  /** Planet list (layout.md §4.3). Reads raw title attributes: call before the game's Tipped strips them. */
  parse.planetList = function (doc = document, base = (typeof location !== 'undefined' ? location.href : 'http://localhost/')) {
    doc = toDoc(doc);
    if (isGz(doc)) return gz.planetList(doc);
    return qa(doc, '#planetList > .smallplanet').map((el) => {
      const a = q(el, 'a.planetlink');
      const t = (a && a.getAttribute('title')) || '';
      const f = t.match(/([\d,.]+)km \((\d+)\/(\d+)\)/);
      const temp = t.match(/(-?\d+)\s*°C?\D+?(-?\d+)\s*°C/) || t.match(/(-?\d+)\D+(-?\d+)°C/);
      const m = q(el, 'a.moonlink');
      const mt = m ? m.getAttribute('title') || '' : '';
      const mf = mt.match(/([\d,.]+)km \((\d+)\/(\d+)\)/);
      let moonId = null;
      if (m) { try { moonId = intOrNull(new URL(m.getAttribute('href'), base).searchParams.get('cp')); } catch (e) { moonId = null; } }
      const nameMoon = (mt.match(/<b>(.*?) \[/) || [])[1];
      return {
        planetId: intOrNull(el.dataset.planetId),
        rowId: el.id || null,
        name: txt(q(el, '.planet-name')),
        coords: U().coords(txt(q(el, '.planet-koords'))),
        diameter: f ? +f[1].replace(/\D/g, '') : null,
        fieldsUsed: f ? +f[2] : null, fieldsMax: f ? +f[3] : null,
        tempMin: temp ? +temp[1] : null, tempMax: temp ? +temp[2] : null,
        building: !!q(el, 'a.constructionIcon'),
        downgrading: !!q(el, 'a.constructionIcon .icon_wrench_red'),
        isCurrent: !!(a && a.classList.contains('active')),
        moonId,
        moon: m ? {
          id: moonId,
          name: nameMoon !== undefined ? decodeEntities(nameMoon) : null,
          diameter: mf ? +mf[1].replace(/\D/g, '') : null,
          fieldsUsed: mf ? +mf[2] : null, fieldsMax: mf ? +mf[3] : null,
          isCurrent: m.classList.contains('active'),
        } : null,
      };
    });
  };
  function decodeEntities(s) {
    const d = new DOMParser().parseFromString('<p>' + s + '</p>', 'text/html');
    return d.body.textContent;
  }

  /** Current body: metas + moonlink cp (ogame-planet-type is always "planet" in OgameX). */
  parse.currentBody = function (doc = document, base) {
    doc = toDoc(doc);
    if (isGz(doc)) return gz.currentBody(doc);
    const id = intOrNull(meta(doc, 'ogame-planet-id'));
    const rows = parse.planetList(doc, base);
    const asMoon = id !== null ? rows.find((r) => r.moonId === id) : null;
    const name = meta(doc, 'ogame-planet-name');
    if (asMoon) return { key: 'm' + id, id, isMoon: true, planetId: asMoon.planetId, coords: asMoon.coords, name };
    return { key: id !== null ? 'p' + id : null, id, isMoon: false, planetId: id, coords: U().coords(meta(doc, 'ogame-planet-coordinates')), name };
  };

  parse.player = function (doc = document) {
    doc = toDoc(doc);
    if (isGz(doc)) {
      const p = gz.player(doc);
      return { id: p.id, name: p.name, playerClass: 'none', darkMatter: gz.resources(doc).darkmatter, rank: p.rank, isAdmin: p.authLevel > 0,
        unreadMessages: p.unreadMessages, vacation: p.vacation, vacationUntil: p.vacationUntil ?? null, lang: p.lang };
    }
    const sprite = q(doc, '#characterclass .sprite.characterclass') || q(doc, '#characterclass .sprite');
    const cls = sprite ? ['miner', 'warrior', 'explorer', 'none'].find((c) => sprite.classList.contains(c)) || 'none' : 'none';
    const dmEl = q(doc, '#resources_darkmatter');
    let rank = null;
    const hsA = qa(doc, '#bar li a').find((a) => /\/highscore(\?|$)/.test(a.getAttribute('href') || ''));
    if (hsA) { const m = /\((\d+|-)\)/.exec(hsA.parentElement.textContent); rank = m && m[1] !== '-' ? +m[1] : null; }
    const unread = q(doc, '#message-wrapper a.comm_menu.messages .new_msg_count[data-new-messages]');
    return {
      id: intOrNull(meta(doc, 'ogame-player-id')),
      name: meta(doc, 'ogame-player-name'),
      playerClass: cls,
      darkMatter: dmEl ? numOrNull(dmEl.dataset.raw) : null,
      rank,
      isAdmin: !!q(doc, '#adminbar'),
      unreadMessages: unread ? intOrNull(unread.dataset.newMessages) || 0 : 0,
    };
  };

  /** Inline reloadResources({...}) (layout.md §6.3). Production is per second in the source. */
  parse.inlineResources = function (x = document) {
    if (typeof x === 'string' ? /resourceTicker\(\{/.test(x) : isGz(toDoc(x))) {
      const r = gz.resources(x);
      return { metal: r.metal, crystal: r.crystal, deuterium: r.deuterium, energy: r.energy ? r.energy.available : null, darkmatter: r.darkmatter };
    }
    let src = '';
    if (typeof x === 'string') src = (x.match(/reloadResources\(\{[\s\S]*?\}\);/) || [x])[0];
    else src = qa(toDoc(x), 'script').map((s) => s.textContent).find((t) => t.includes('reloadResources({')) || '';
    const num = '(-?[\\d.]+(?:[eE][-+]?\\d+)?)';
    const out = { metal: null, crystal: null, deuterium: null, energy: null, darkmatter: null };
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const m = src.match(new RegExp(`"${k}":\\s*\\{\\s*"amount":\\s*${num},\\s*"storage":\\s*${num},[\\s\\S]*?"production":\\s*${num}`));
      if (m) out[k] = { amount: +m[1], storage: +m[2], perSecond: +m[3], perHour: +m[3] * 3600 };
    }
    const e = src.match(new RegExp(`"energy":\\s*\\{\\s*"amount":\\s*${num}`));
    const dm = src.match(new RegExp(`"darkmatter":\\s*\\{\\s*"amount":\\s*${num}`));
    out.energy = e ? +e[1] : null;
    out.darkmatter = dm ? +dm[1] : null;
    return out;
  };

  /** Raw resource-bar tooltips (OL §9 parseResourceTooltips). */
  parse.resourceTooltips = function (doc = document) {
    doc = toDoc(doc);
    if (isGz(doc)) {
      const r = gz.resources(doc);
      return { metal: r.tooltips.metal || null, crystal: r.tooltips.crystal || null, deuterium: r.tooltips.deuterium || null, energy: r.energy };
    }
    const out = { metal: null, crystal: null, deuterium: null, energy: null };
    for (const [k, id] of [['metal', 'metal_box'], ['crystal', 'crystal_box'], ['deuterium', 'deuterium_box'], ['energy', 'energy_box']]) {
      const el = doc.getElementById ? doc.getElementById(id) : q(doc, '#' + id);
      const t = (el && el.getAttribute('title')) || '';
      const i = t.indexOf('|');
      if (i < 0) continue;
      const tip = new DOMParser().parseFromString(t.slice(i + 1), 'text/html');
      const v = qa(tip, 'tr td span').map((s) => U().parseGameNumber(s.textContent));
      out[k] = k === 'energy' ? { available: v[0] ?? null, production: v[1] ?? null, consumption: v[2] ?? null }
        : { amount: v[0] ?? null, storage: v[1] ?? null, perHour: v[2] ?? null };
    }
    return out;
  };

  // ------------------------------------------------------------------ buildings
  parse.techList = function (doc = document) {
    doc = toDoc(doc);
    // GALAXYZ: status 'off' = requirements unmet, 'on' = can start now (buildings/research: button.upgrade; units: order form),
    // 'disabled' = unaffordable / busy / no field (not distinguished by the list). No running state on the items.
    if (isGz(doc)) {
      return gz.techItems(doc).map((it) => ({ id: it.id, className: it.cssKey, status: it.off ? 'off' : (it.isUnit ? it.hasForm : it.button) ? 'on' : 'disabled',
        value: it.value, target: null, isUnit: it.isUnit, name: it.name }));
    }
    return qa(doc, '#technologies li.technology[data-technology]').map((li) => {
      const lv = q(li, 'span.level, span.amount');
      const tgt = q(li, 'span.targetlevel, span.targetamount');
      return {
        id: +li.dataset.technology,
        className: li.classList[1] || null,
        status: li.dataset.status || null,
        value: lv ? +lv.dataset.value || 0 : 0,
        target: tgt ? +tgt.dataset.value : null,
        isUnit: !!q(li, 'span.amount'),
      };
    });
  };

  /** Queue boxes: exact seconds from inline CountdownTimer calls (buildings.md §4.2-4.3). */
  parse.queueTimers = function (x = document) {
    if (isGz(toDoc(x))) {
      // GALAXYZ: the list-page "under construction" box (gz.queueBox: the running item with the head countdown, the queued ones)
      // gives the building or the research queue by the running item's id (100-199 = research); the shipyard queue comes from the
      // inline data.Queue. out.known.box: an empty box, or a box whose running item and countdown were read (unknown markup keeps
      // the stored queues). Before 0.3.2-audit a busy box always read as unknown: botbuild waited 15 min per planet.
      const d = toDoc(x);
      const box = gz.queueBox(d); const sq = gz.shipyardQueue(d);
      const first = box && box.items.length ? box.items[0] : null;
      let secs = first && first.restSec !== null ? first.restSec : null;
      if (first && secs === null && first.endUnix) { const now = gz.serverTime(d).renderUnix; if (now) secs = Math.max(0, first.endUnix - now); }
      const out = { building: null, research: null, unit: null, cancelIds: [], known: { box: !!box && (box.empty || (!!first && secs !== null)), unit: !!sq } };
      if (first && secs !== null) {
        const kind = first.id >= 100 && first.id < 200 ? 'research' : 'building';
        out[kind] = { secs, objectId: first.id, targetLevel: first.level, title: box.title, downgrade: false, listId: null,
          queued: box.items.slice(1).map((i) => ({ objectId: i.id, targetLevel: i.level, listId: null })) };
      }
      if (sq && sq.items.length) {
        const first = sq.items[0];
        out.unit = { totalSecs: sq.totalSecs, nextSecs: Math.max(0, first.secsPerUnit - sq.firstUnitElapsed), remaining: sq.items.reduce((n, i) => n + i.count, 0),
          techId: first.id, perUnitSecs: first.secsPerUnit, queued: sq.items.map((i) => ({ id: i.id, amount: i.count })) };
      }
      return out;
    }
    const html = toHtml(x);
    const doc = toDoc(typeof x === 'string' ? x : x);
    const timers = {};
    for (const m of html.matchAll(/new CountdownTimer\('(buildingCountdown|researchCountdown|unitCountdown)',\s*(\d+)/g)) timers[m[1]] = +m[2];
    const activeFor = (kind) => {
      // The active table is the last "construction active" table before the CountdownTimer call of this kind.
      const at = html.indexOf(`new CountdownTimer('${kind}'`);
      if (at < 0) return null;
      const start = html.lastIndexOf('class="construction active"', at);
      if (start < 0) return null;
      const seg = html.slice(start, at);
      const th = /<th colspan="2">([^<]+)<\/th>/.exec(seg);
      const lvl = /<span class="level">[^<\d]*(\d+)<\/span>/.exec(seg);
      const cancel = /cancelbuilding\((\d+),\s*(\d+),/.exec(seg);
      return {
        title: th ? decodeEntities(th[1].trim()) : null, targetLevel: lvl ? +lvl[1] : null,
        objectId: cancel ? +cancel[1] : null, listId: cancel ? +cancel[2] : null,
        downgrade: /Downgrade to/i.test(seg) || /icon_wrench_red/.test(seg),
      };
    };
    const out = { building: null, research: null, unit: null, cancelIds: [] };
    if (timers.buildingCountdown !== undefined) {
      const a = activeFor('buildingCountdown') || {};
      const queued = qa(doc, '#productionboxbuildingcomponent table.queue a.queue_link, #productionboxbuildingcomponent table.queue a[onclick*="cancelbuilding"]').map((link) => {
        const m = /cancelbuilding\((\d+),\s*(\d+)/.exec(link.getAttribute('onclick') || '');
        const lv = q(link, 'span');
        return m ? { objectId: +m[1], listId: +m[2], targetLevel: lv ? intOrNull(lv.textContent) : null } : null;
      }).filter(Boolean);
      out.building = { secs: timers.buildingCountdown, objectId: a.objectId ?? null, targetLevel: a.targetLevel ?? null, title: a.title ?? null,
        downgrade: !!a.downgrade, listId: a.listId ?? null, queued: dedupe(queued) };
    }
    if (timers.researchCountdown !== undefined) {
      const a = activeFor('researchCountdown') || {};
      out.research = { secs: timers.researchCountdown, objectId: a.objectId ?? null, targetLevel: a.targetLevel ?? null, title: a.title ?? null, listId: a.listId ?? null };
    }
    if (timers.unitCountdown !== undefined) {
      const u = html.match(/new CountdownTimerUnit\('shipyardCountdownUnit',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
      const queued = [];
      for (const td of qa(doc, '#productionboxshipyardcomponent table.queue td')) {
        const img = q(td, 'img.queuePic[alt]');
        if (!img) continue;
        const id = OGX.catalog.idFromTitle(img.getAttribute('alt'));
        const amount = parseInt(td.textContent.replace(/[^\d]/g, ''), 10);
        if (id && Number.isFinite(amount)) queued.push({ id, amount });
      }
      out.unit = { totalSecs: timers.unitCountdown, nextSecs: u ? +u[1] : null, remaining: u ? +u[2] : null, techId: u ? +u[3] : null,
        perUnitSecs: u ? +u[4] : null, queued };
    }
    out.cancelIds = dedupe([...html.matchAll(/cancelbuilding\((\d+),\s*(\d+),/g)].map((m) => ({ objectId: +m[1], listId: +m[2] })));
    return out;
  };
  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => { const k = x.objectId + ':' + x.listId; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /** /resources/settings (buildings.md §9). Percents are 0..150. */
  parse.resourceSettings = function (doc = document) {
    doc = toDoc(doc);
    if (isGz(doc)) return gz.resourceSettings(doc);   // percents 0..100 (selects 0..10), factor null, + rows
    const percents = {};
    for (const s of qa(doc, 'select[name^="last"]')) {
      const id = intOrNull(s.name.slice(4));
      if (id === null) continue;
      const sel = q(s, 'option[selected]');
      const v = s.value !== undefined && s.value !== '' ? s.value : sel ? sel.getAttribute('value') : null;
      if (v !== null) percents[id] = +v * 10;
    }
    const f = /(\d+)%/.exec(txt(q(doc, 'span.factorkey')));
    return { percents, factor: f ? +f[1] : null };
  };

  /** Overview planet info from the typewriter array (buildings.md §5). */
  parse.overviewInfo = function (x = document) {
    if (isGz(toDoc(x))) return gz.overview(x);
    const s = toHtml(x);
    const d = s.match(/textContent\[1\] = "([\d,.]+)km \(<span>(\d+)<\\\/span>\\\/<span>(\d+)/);
    const t = s.match(/textContent\[3\] = "(-?\d+)(?:\\u00b0|°)C to (-?\d+)(?:\\u00b0|°)C/);
    const c = s.match(/textContent\[5\] = ".*?\[(\d+):(\d+):(\d+)\]/);
    const p = s.match(/textContent\[7\] = ".*?>([\d,.]+) \(/);
    return {
      diameter: d ? +d[1].replace(/\D/g, '') : null, fieldsUsed: d ? +d[2] : null, fieldsMax: d ? +d[3] : null,
      tempMin: t ? +t[1] : null, tempMax: t ? +t[2] : null,
      coords: c ? `${c[1]}:${c[2]}:${c[3]}` : null,
      points: p ? U().parseGameNumber(p[1]) : null,
    };
  };

  /** check-target-like technology details JSON (or its inner HTML) -> TechDetails (buildings.md §6.2). */
  parse.techDetails = function (json) {
    let html = '';
    if (json && typeof json === 'object') html = (json.content && (json.content.technologydetails || (json.target && json.content[json.target]))) || '';
    else html = String(json || '');
    const d = toDoc(html);
    const el = q(d, '#technologydetails') || d.body;
    if (q(el, 'li.cost-item, .costs[data-tech-id]')) return gzTechDetails(gz.techPanel(html));   // GALAXYZ panel [UNVERIFIED]
    return parse.techDetailsElement(el);
  };
  parse.techDetailsElement = function (el) {
    const costs = {};
    for (const li of qa(el, '.costs li.resource')) {
      for (const k of ['metal', 'crystal', 'deuterium', 'energy']) {
        if (li.classList.contains(k)) costs[k] = { value: parseFloat(li.dataset.value) || 0, enough: !li.classList.contains('insufficient') };
      }
    }
    const dt = (q(el, 'li.build_duration time') || { getAttribute: () => '' }).getAttribute('datetime') || '';
    const btn = q(el, 'button.upgrade[data-technology], button.downgrade[data-technology]');
    const lvEl = q(el, '.information > span.level, .information > span.amount');
    const demolish = {};
    for (const k of ['metal', 'crystal', 'deuterium']) {
      const td = q(el, `#demolition_costs_tooltip table.demolition_costs tr.${k} td[data-value]`) || q(el, `#demolition_costs_tooltip tr.${k} td[data-value]`);
      demolish[k] = td ? parseFloat(td.dataset.value) || 0 : 0;
    }
    const current = lvEl ? parseInt(lvEl.textContent.replace(/[^\d]/g, ''), 10) : null;
    const elId = el && el.getAttribute ? intOrNull(el.getAttribute('data-technology-id')) : null;
    return {
      id: btn ? +btn.dataset.technology : elId,
      current: Number.isFinite(current) ? current : null,
      nextLevel: lvEl ? intOrNull(lvEl.dataset.value) : null,
      durationSecs: dt ? U().parseIsoDuration(dt) : null,
      costs,
      energyNeeded: +((q(el, 'li.additional_energy_consumption .value') || { dataset: {} }).dataset.value) || 0,
      energyProduction: +((q(el, 'li.energy_production .value') || { dataset: {} }).dataset.value) || 0,
      maxAmount: +((q(el, '#build_amount') || { getAttribute: () => 0 }).getAttribute('max')) || 0,
      canBuild: !!q(el, 'button.upgrade:not([disabled])'),
      canDowngrade: !!q(el, 'button.downgrade'),
      demolish,
    };
  };

  const GZ_RES = { 901: 'metal', 902: 'crystal', 903: 'deuterium', 911: 'energy', 921: 'darkmatter' };
  function gzTechDetails(p) {
    const costs = {};
    for (const [rid, c] of Object.entries(p.cost || {})) {
      const k = GZ_RES[rid];
      if (k) costs[k] = { value: c.base || 0, enough: c.have === null ? null : c.have >= (c.base || 0) };
    }
    return { id: p.id, current: p.level, nextLevel: p.level !== null ? p.level + 1 : null, durationSecs: null, costs,
      energyNeeded: 0, energyProduction: 0, maxAmount: 0, canBuild: p.flags.buyable === true && !p.buttonDisabled, canDowngrade: false,
      demolish: { metal: 0, crystal: 0, deuterium: 0 }, flags: p.flags, form: p.form };
  }

  /** GET /ajax/techtree?tab=2&object_id=<shipId>: visible text (data-* attributes are hard-coded constants). */
  parse.shipProps = function (html) {
    const doc = toDoc(html);
    const row = (cls) => { const s = q(doc, 'table.combat_unit_details tr.' + cls + ' td > span'); return s ? U().parseGameNumber(s.textContent) : null; };
    return { structural: row('structural_integrity'), shield: row('shield_strength'), attack: row('attack_strength'),
      speed: row('speed'), capacity: row('cargo_capacity'), consumption: row('fuel_consumption') };
  };

  /** GET /overlay/server-settings (layout.md §11), keyed by the icon class, never by the localized text. */
  parse.serverSettings = function (html) {
    const doc = toDoc(html);
    const rows = qa(doc, 'server-settings-icon');
    const byKey = {};
    for (const icon of rows) {
      const key = Array.from(icon.classList)[0];
      const row = icon.parentElement;
      const entry = { text: txt(q(row, 'span')), active: q(row, '.emoji.activated') ? true : q(row, '.emoji.deactivated') ? false : null };
      (byKey[key] = byKey[key] || []).push(entry);
    }
    const first = (k) => (byKey[k] && byKey[k][0]) || { text: '', active: null };
    const x = (k) => { const m = /x\s*([\d.]+)/i.exec(first(k).text); return m ? +m[1] : null; };
    const tail = (k) => { const m = /([\d,.]+)\s*$/.exec(first(k).text); return m ? U().parseGameNumber(m[1]) : null; };
    const pct = (k) => { const m = /([+-]?\d+)\s*%/.exec(first(k).text); return m ? Math.abs(+m[1]) : null; };
    return {
      universeName: txt(q(doc, 'thick-headline-header > p')) || null,
      economySpeed: x('speedfactor'),
      researchSpeed: x('speedfactor_research'),
      fleetSpeedWar: x('fleetspeed_war'),
      fleetSpeedHolding: x('fleetspeed_holding'),
      fleetSpeedPeaceful: x('fleetspeed_peace'),
      galaxies: tail('number_galaxies'),
      systems: 499,
      debrisFleetPct: pct('debris_fleet'),
      debrisDefensePct: pct('debris_defense'),
      debrisDeuterium: first('debris_deuterium').active === true,
      acs: first('acs_active').active === true,
      ignoreEmpty: first('ignore_empty').active === true,
      ignoreInactive: first('ignore_inactive').active === true,
      planetFieldBonus: tail('planetfield_bonus'),
      darkMatterBonus: tail('darkmatter_bonus'),
    };
  };

  /** Localized titles -> id from any list page (li.technology[aria-label][data-technology]). */
  parse.titles = function (doc = document) {
    doc = toDoc(doc);
    const out = {};
    if (isGz(doc)) {
      for (const it of gz.techItems(doc)) if (it.name) out[it.name] = it.id;
      for (const s of (q(doc, 'form[action*="page=fleetStep1"]') ? gz.fleetTable(doc).ships : [])) if (s.name && s.id) out[s.name] = s.id;
      return out;
    }
    for (const li of qa(doc, 'li.technology[data-technology][aria-label]')) out[li.getAttribute('aria-label').trim()] = +li.dataset.technology;
    return out;
  };

  // ------------------------------------------------------------------ fleet dispatch page (fleet.md §12.4)
  parse.fleetPage = function (x = document) {
    if (isGz(toDoc(x))) {
      // GALAXYZ: page=fleetTable (ships, slots, own flights) or fleetStep1/2 (inline data: gamespeed = fleet speed factor).
      const d = toDoc(x);
      const ft = gz.fleetTable(d); const s1 = gz.fleetStep1(d); const s2 = s1 ? null : gz.fleetStep2(d);
      const shipsOnPlanet = {};
      for (const sh of ft.ships) if (sh.id && sh.count > 0) shipsOnPlanet[sh.id] = sh.count;
      const gs = s1 && s1.data && Number.isFinite(+s1.data.gamespeed) ? +s1.data.gamespeed : null;
      const r = gz.resources(d);
      return {
        shipsOnPlanet, slots: ft.slots, expSlots: ft.expeditions,
        speedFactors: { peaceful: gs, war: gs, holding: gs },
        currentPlanet: null, targetPlanet: s1 ? s1.target : null, mission: s1 ? s1.targetMission : (ft.prefill ? ft.prefill.mission : null),
        ownBodies: [], maxGalaxy: null, maxSystem: null,
        resources: { metal: r.metal ? Math.floor(r.metal.amount) : null, crystal: r.crystal ? Math.floor(r.crystal.amount) : null, deuterium: r.deuterium ? Math.floor(r.deuterium.amount) : null },
        titles: parse.titles(d),
        noShips: !!q(d, 'form[action*="page=fleetStep1"]') && !ft.ships.some((sh) => sh.count > 0),
        gz: { fleetTable: ft, step1: s1, step2: s2 },
      };
    }
    const html = toHtml(x);
    const doc = toDoc(x);
    const grab = (re) => { const m = re.exec(html); return m ? m[1] : null; };
    const shipsOnPlanet = {};
    const src = grab(/var shipsOnPlanet = \[([\s\S]*?)\];/);
    if (src !== null) {
      for (const m of src.matchAll(/"id":\s*(\d+),\s*"number":\s*(\d+)/g)) shipsOnPlanet[+m[1]] = +m[2];
    } else {
      for (const li of qa(doc, '#fleet1 #technologies li[data-technology]')) {
        const a = q(li, 'span.amount');
        const n = a ? parseInt(a.dataset.value, 10) : 0;
        if (n > 0) shipsOnPlanet[+li.dataset.technology] = n;
      }
    }
    const json = (name) => { const s = grab(new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\});')); try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const pair = (el) => { const m = /(\d+)\s*\/\s*(\d+)/.exec(el ? el.textContent : ''); return m ? { used: +m[1], max: +m[2] } : null; };
    const slotsBox = q(doc, '#fleet1 #slots') || q(doc, '#slots');
    const spans = slotsBox ? qa(slotsBox, ':scope > .fleft > span.advice') : [];
    let slots = pair(spans[0]);
    if (!slots) { const u = grab(/var fleetCount = (\d+);/), mx = grab(/var maxFleetCount = (\d+);/); slots = u !== null && mx !== null ? { used: +u, max: +mx } : null; }
    let expSlots = pair(spans[1]);
    if (!expSlots) { const m = /Expeditions:<\/span>\s*(\d+)\/(\d+)/.exec(html); expSlots = m ? { used: +m[1], max: +m[2] } : null; }
    const sf = (k) => numOrNull(grab(new RegExp('SPEEDFAKTOR_FLEET_' + k + ' = ([\\d.]+);')));
    const ownBodies = qa(doc, '#slbox option[value*="#"]').map((o) => {
      const [g, s, p, t, ...n] = o.value.split('#');
      return { g: +g, s: +s, p: +p, type: +t, name: n.join('#') };
    });
    const res = (k) => numOrNull(grab(new RegExp('var ' + k + 'OnPlanet = (\\d+);')));
    return {
      shipsOnPlanet, slots, expSlots,
      speedFactors: { peaceful: sf('PEACEFUL'), war: sf('WAR'), holding: sf('HOLDING') },
      currentPlanet: json('currentPlanet'), targetPlanet: json('targetPlanet'),
      mission: intOrNull(grab(/var mission = (\d+);/)),
      ownBodies,
      maxGalaxy: intOrNull(grab(/var MAX_GALAXY = (\d+);/)), maxSystem: intOrNull(grab(/var MAX_SYSTEM = (\d+);/)),
      resources: { metal: res('metal'), crystal: res('crystal'), deuterium: res('deuterium') },
      titles: parse.titles(doc),
      noShips: !!q(doc, '#fleet1 #warning'),
    };
  };

  // ------------------------------------------------------------------ highscore (galaxy.md §11.1)
  function highscorePlayersOgx(html) {
    const s = toHtml(html);
    const doc = toDoc(html);
    const rows = qa(doc, '#ranks.userHighscore > tbody > tr[id^="position"], #ranks > tbody > tr[id^="position"]').filter((tr, i, arr) => arr.indexOf(tr) === i)
      .filter((tr) => q(tr, '.playername')).map((tr) => {
        const a = q(tr, '.highscoreNameHolder a[href*="/galaxy"]');
        let home = null;
        if (a) { try { const qs = new URL(a.getAttribute('href'), 'http://x').searchParams; home = `${qs.get('galaxy')}:${qs.get('system')}:${qs.get('position')}`; } catch (e) { home = null; } }
        const ally = q(tr, '.ally-tag a');
        const ships = q(tr, 'td.score span[title]');
        return {
          id: intOrNull(tr.id.slice(8)),
          rank: intOrNull(txt(q(tr, 'td.position'))),
          name: txt(q(tr, '.playername')),
          me: tr.classList.contains('myrank'),
          admin: !!q(tr, '.playername.status_abbr_admin'),
          homeCoords: home,
          allianceId: ally ? intOrNull((/\/alliance\/info\/(\d+)/.exec(ally.getAttribute('href') || '') || [])[1]) : null,
          allianceTag: ally ? txt(ally).replace(/^\[|\]$/g, '') : null,
          points: parseInt(txt(q(tr, 'td.score')).replace(/[^\d]/g, ''), 10) || 0,
          totalShips: ships ? parseInt(ships.getAttribute('title').split(':').pop().replace(/[^\d]/g, ''), 10) : null,
        };
      });
    const pages = qa(doc, 'select.changeSite option').length - 1;
    return { category: 1, type: intOrNull((/var currentType = (\d+);/.exec(s) || [])[1]), page: intOrNull((/var site = (\d+);/.exec(s) || [])[1]), pages: pages > 0 ? pages : null, rows };
  }

  parse.highscoreAlliances = function (html) {
    const s = toHtml(html);
    const doc = toDoc(html);
    const rows = qa(doc, '#ranks.allyHighscore > tbody > tr[id^="position"]').map((tr) => {
      const score = q(tr, 'td.score');
      return {
        id: intOrNull(tr.id.slice(8)),
        rank: intOrNull(txt(q(tr, 'td.position'))),
        name: txt(q(tr, '.ally-name span')),
        tag: txt(q(tr, '.ally-tag a')).replace(/^\[|\]$/g, ''),
        members: intOrNull(txt(q(tr, 'td.member_count'))),
        points: score && score.firstChild ? parseInt(score.firstChild.textContent.replace(/[^\d]/g, ''), 10) || 0 : 0,
        average: parseInt(txt(q(tr, 'td.score .small')).replace(/[^\d]/g, ''), 10) || 0,
      };
    });
    return { category: 2, type: intOrNull((/var currentType = (\d+);/.exec(s) || [])[1]), rows };
  };
  /** Rank-1 points from a highscore page or fragment (OL §5.6 top_score). */
  parse.topScore = function (html) {
    const doc = toDoc(html);
    if (isGzHighscore(doc, html)) {
      const hs = parse.highscorePlayers(doc);
      const top = hs.rows.find((r) => r.rank === 1) || null;
      return top && hs.source === 'statistics' && hs.gzType === 1 ? { playerId: top.id, rank: top.rank, points: top.points } : null;
    }
    const tr = q(doc, '#ranks tbody tr[id^="position"]');
    if (!tr) return null;
    const rankCell = intOrNull(txt(q(tr, 'td.position')));
    return { playerId: intOrNull(tr.id.slice(8)), rank: rankCell, points: U().parseGameNumber(txt(q(tr, 'td.score'))) };
  };

  // ------------------------------------------------------------------ GALAXYZ highscore / search / player card [UPSTREAM]
  // The fork's page=statistics, page=search and page=playerCard were not saved live: markup = upstream 2Moons 1.8 templates
  // (shared.statistics.playerTable.tpl, shared.statistics.allianceTable.tpl, page.search.result.*.tpl, page.playerCard.default.tpl),
  // recipes from specs/galaxyz/galaxy-recipes.js, checked against specs/galaxyz/fixtures/galaxy-upstream-*.html. Every result
  // carries unverified: true. A page without the expected table returns rows [] AND error (never a silent empty).
  const gzInt = (s) => { const m = String(s == null ? '' : s).replace(/ /g, ' ').match(/-?\d[\d.]*/); return m ? parseInt(m[0].replace(/\./g, ''), 10) : null; };
  const gzT = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const ampDecode = (v) => String(v || '').replace(/&amp;/g, '&');
  const firstInt = (re, v) => { const m = re.exec(v || ''); return m ? +m[1] : null; };
  const tipOf = (el) => (el && (el.getAttribute('data-tooltip-content') || el.getAttribute('title'))) || '';
  const PLAYERCARD_MARK = /<!--\s*ogx-playercard:(\d+)\s*-->/;
  /** GALAXYZ statistics type (1 points, 2 fleet, 3 research, 4 buildings, 5 defense) <-> OgameX highscore type (0 total, 1 economy, 2 research, 3 military). */
  gz.STAT_TYPE_FROM_OGX = { 0: 1, 1: 4, 2: 3, 3: 2, 5: 5 };
  gz.STAT_TYPE_TO_OGX = { 1: 0, 4: 1, 3: 2, 2: 3, 5: 5 };
  function isGzHighscore(doc, html) {
    if (typeof html === 'string' && PLAYERCARD_MARK.test(html)) return true;
    if (q(doc, 'form#stats select[name="who"], select[name="who"][id="who"]')) return true;
    return isGz(doc) && !q(doc, '#ranks');   // any other GALAXYZ page: parsed as statistics -> rows [] + error
  }
  parse._isGzHighscore = isGzHighscore;

  /**
   * page=statistics&who=1|2&type=1..5&range=N [UPSTREAM ShowStatisticsPage, shared.statistics.*Table.tpl] ->
   * { who, type, range, updated, rows: [player: { kind:'player', rank, change, id, name, me, allianceId, allianceName, points }
   *   | alliance: { kind:'alliance', rank, change, id, name, members, points, perMember }], pages, unverified: true, error? }.
   */
  gz.statistics = function (input) {
    const doc = toDoc(input);
    const sel = (name) => { const el = q(doc, 'select[name="' + name + '"]'); if (!el) return null; const o = q(el, 'option[selected]') || el.options && el.options[el.selectedIndex]; return o ? intOrNull(o.value) : intOrNull(el.value); };
    const out = { who: sel('who'), type: sel('type'), range: sel('range'), updated: null, pages: qa(doc, 'select[name="range"] option').length || null, rows: [], unverified: true };
    const th = qa(doc, 'th').map(gzT).find((t) => /\(.*\d{1,2}:\d{2}/.test(t));
    if (th) { const m = /:\s*(.+)\)\s*$/.exec(th); out.updated = m ? m[1].trim() : null; }
    for (const tr of qa(q(doc, '#content') || doc, 'tr')) {
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      if (tds.length < 4 || !q(tds[1], 'a')) continue;
      if (!/^\s*[\d.]+\s*$/.test(gzT(tds[0]))) continue;
      const rank = gzInt(gzT(tds[0]));
      const h = ampDecode(tr.innerHTML);
      const chTip = tipOf(q(tds[0], 'a')).replace(/<[^>]*>/g, '');
      const chM = /([+-]?\d+)/.exec(chTip);
      const change = /\*/.test(chTip) ? 0 : chM ? +chM[1] : null;
      const pc = /Dialog\.Playercard\(\s*(\d+)/.exec(h);
      if (pc || out.who === 1) {
        const allyA = tds[3] && q(tds[3], 'a[href*="mode=info"]');
        out.rows.push({ kind: 'player', rank, change, id: pc ? +pc[1] : null, name: gzT(tds[1]), me: /color:\s*lime/i.test(tds[1].innerHTML),
          allianceId: allyA ? firstInt(/[?&]id=(\d+)/, ampDecode(allyA.getAttribute('href'))) : null, allianceName: allyA ? gzT(allyA) : null,
          points: gzInt(gzT(tds[4] || tds[tds.length - 1])) });
      } else {
        const a = q(tds[1], 'a');
        out.rows.push({ kind: 'alliance', rank, change, id: a ? firstInt(/[?&]id=(\d+)/, ampDecode(a.getAttribute('href'))) : null,
          name: gzT(tds[1]), members: gzInt(gzT(tds[2])), points: gzInt(gzT(tds[3])), perMember: gzInt(gzT(tds[4])) });
      }
    }
    if (!out.rows.length) out.error = q(doc, 'select[name="who"]') ? 'statistics: no ranking rows (empty range?)' : 'statistics: not a statistics page';
    return out;
  };

  /**
   * page=search&mode=result&ajax=1&type=playername|planetname|allytag|allyname&search=TEXT [UPSTREAM page.search.result.*.tpl] ->
   * { kind: 'player'|'alliance'|null, rows: player [{ id, name, allianceId, allianceName, planetName, coords, rank }]
   *   | alliance [{ tag, name, members, points }], unverified: true, error? }. Planet searches use the player table (planetName = the hit).
   */
  gz.searchResult = function (input) {
    const doc = toDoc(input);
    const t = q(doc, '#resulttable');
    const out = { kind: null, rows: [], unverified: true };
    if (!t) { out.error = 'search: no #resulttable'; return out; }
    out.kind = qa(t, 'th').length >= 6 ? 'player' : 'alliance';
    for (const tr of qa(t, 'tr')) {
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      if (!tds.length) continue;
      if (out.kind === 'player') {
        const h = ampDecode(tr.innerHTML);
        const co = /\[(\d+):(\d+):(\d+)\]/.exec(gzT(tds[4]));
        const allyA = tds[2] && q(tds[2], 'a');
        out.rows.push({ id: firstInt(/Dialog\.Playercard\(\s*(\d+)/, h), name: gzT(tds[0]),
          allianceId: allyA ? firstInt(/[?&]id=(\d+)/, ampDecode(allyA.getAttribute('href'))) : null, allianceName: allyA ? gzT(allyA) : null,
          planetName: gzT(tds[3]) || null, coords: co ? co[1] + ':' + co[2] + ':' + co[3] : null, rank: gzInt(gzT(tds[5])) });
      } else {
        out.rows.push({ tag: gzT(tds[0]), name: gzT(tds[1]), members: gzInt(gzT(tds[2])), points: gzInt(gzT(tds[3])) });
      }
    }
    return out;
  };

  /**
   * page=playerCard&id=N popup [UPSTREAM page.playerCard.default.tpl] -> { id, name, homePlanet, homeCoords, allianceId, allianceName,
   * points: { buildings, research, fleet, defense, total }, ranks: {...}, fights: { won|draw|lost|total: { count, pct } },
   * units: { destroyed, lost }, debris: { metal, crystal }, unverified: true, error? }. The own card has no PM/Buddy link: id from
   * the `<!--ogx-playercard:N-->` mark api.highscore/api.playerCard put in front of the html, else null.
   */
  gz.playerCard = function (input) {
    const doc = toDoc(input);
    const html = typeof input === 'string' ? input : '';
    const table = q(doc, '#content table') || q(doc, 'table');
    const out = { id: null, name: null, homePlanet: null, homeCoords: null, allianceId: null, allianceName: null,
      points: {}, ranks: {}, fights: {}, units: {}, debris: {}, unverified: true };
    if (!table) { out.error = 'playerCard: no table'; return out; }
    const data = qa(table, ':scope > tbody > tr, :scope > tr').map((tr) => Array.from(tr.children).filter((c) => c.tagName === 'TD')).filter((r) => r.length >= 2);
    const h = ampDecode(table.innerHTML);
    out.id = firstInt(/Dialog\.(?:Buddy|PM)\(\s*(\d+)/, h) ?? firstInt(PLAYERCARD_MARK, html);
    if (data[0]) out.name = gzT(data[0][1]) || null;
    if (data[1]) {
      const co = /\[(\d+):(\d+):(\d+)\]/.exec(gzT(data[1][1]));
      out.homeCoords = co ? co[1] + ':' + co[2] + ':' + co[3] : null;
      out.homePlanet = gzT(data[1][1]).replace(/\s*\[\d+:\d+:\d+\]\s*$/, '') || null;
    }
    if (data[2]) {
      const a = q(data[2][1], 'a');
      out.allianceName = a ? gzT(a) : null;
      out.allianceId = a ? firstInt(/[?&]id=(\d+)/, ampDecode(a.getAttribute('onclick') || a.getAttribute('href'))) : null;
    }
    ['buildings', 'research', 'fleet', 'defense', 'total'].forEach((k, i) => { const r = data[3 + i]; if (r) { out.points[k] = gzInt(gzT(r[1])); out.ranks[k] = r[2] ? gzInt(gzT(r[2])) : null; } });
    ['won', 'draw', 'lost', 'total'].forEach((k, i) => { const r = data[9 + i]; if (r) out.fights[k] = { count: gzInt(gzT(r[1])), pct: r[2] ? parseFloat(gzT(r[2]).replace(',', '.')) : null }; });
    [['units', 'destroyed'], ['units', 'lost'], ['debris', 'metal'], ['debris', 'crystal']].forEach(([g, k], i) => { const r = data[13 + i]; if (r) out[g][k] = gzInt(gzT(r[1])); });
    if (!out.name || out.points.total === undefined) out.error = 'playerCard: profile rows not found';
    return out;
  };

  /**
   * Highscore players, both engines. OgameX: /ajax/highscore html. GALAXYZ: a page=statistics page (who=1) or a page=playerCard popup
   * (what api.highscore({ searchRelId }) fetches on GALAXYZ) -> the OgameX shape { category: 1, type, page, pages, rows: [{ id, rank,
   * name, me, admin, homeCoords, allianceId, allianceTag, points, totalShips }] } + engine 'galaxyz', source 'statistics'|'playerCard',
   * gzType, allianceName/change per row, unverified, and error when nothing was found (never a silent empty).
   * GALAXYZ shows alliance NAMES, not tags: allianceTag is undefined (not null), so the player index keeps a tag seen elsewhere.
   */
  parse.highscorePlayers = function (html) {
    const doc = toDoc(html);
    if (!isGzHighscore(doc, html)) return highscorePlayersOgx(html);
    const base = { category: 1, engine: 'galaxyz', unverified: true };
    if (!q(doc, 'select[name="who"]') && (PLAYERCARD_MARK.test(typeof html === 'string' ? html : '') || q(doc, 'body.popup'))) {
      const c = gz.playerCard(typeof html === 'string' ? html : doc);
      const ok = !c.error && c.ranks.total !== undefined;
      const row = ok ? { id: c.id, rank: c.ranks.total, name: c.name, me: false, admin: false, homeCoords: c.homeCoords, allianceId: c.allianceId,
        allianceTag: undefined, allianceName: c.allianceName, points: c.points.total, totalShips: null, change: null, card: c } : null;
      return Object.assign(base, { type: 0, gzType: 1, page: null, pages: null, source: 'playerCard', rows: row ? [row] : [] }, ok ? {} : { error: c.error || 'playerCard: not parsed' });
    }
    const st = gz.statistics(doc);
    const out = Object.assign(base, { type: st.type !== null && st.type in gz.STAT_TYPE_TO_OGX ? gz.STAT_TYPE_TO_OGX[st.type] : st.type, gzType: st.type,
      page: st.range ? Math.floor((st.range - 1) / 100) + 1 : null, pages: st.pages, source: 'statistics', updated: st.updated, rows: [] });
    if (st.who !== null && st.who !== 1) return Object.assign(out, { error: 'statistics: alliance ranking (who=' + st.who + '), use parse.gz.statistics' });
    out.rows = st.rows.filter((r) => r.kind === 'player').map((r) => ({ id: r.id, rank: r.rank, name: r.name, me: r.me, admin: false, homeCoords: null,
      allianceId: r.allianceId, allianceTag: undefined, allianceName: r.allianceName, points: r.points, totalShips: null, change: r.change }));
    if (!out.rows.length) out.error = st.error || 'statistics: no player rows';
    return out;
  };
})(window.OGX);
