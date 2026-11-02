/* GALAXYZ / 2Moons galaxy + player-lookup parsing recipes (spec companion of galaxy.md).
 * Plain browser JS, no dependencies. Every parser takes a Document (live page or DOMParser result)
 * or an HTML string, and never throws on missing markup.
 *
 *   GZGalaxy.parseSystem(docOrHtml, { me: { id, name } })   -> ParsedSystem   (page=galaxy, live AND upstream markup)
 *   GZGalaxy.parseStatistics(docOrHtml)                      -> { who, type, range, updated, rows }
 *   GZGalaxy.parseSearchResult(docOrHtml)                    -> { kind: 'player'|'alliance', rows }
 *   GZGalaxy.parsePlayerCard(docOrHtml)                      -> PlayerCard
 *   GZGalaxy.parsePhalanx(docOrHtml)                         -> { coords, name, error, fleets }
 *   GZGalaxy.urls.*                                          -> URL builders
 *
 * Verified by tools/check_galaxy.js on eu/pages/galaxy.html [REAL] and fixtures/galaxy-*.html.
 */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const toDoc = (d) => {
    if (d && typeof d === 'object' && d.nodeType === 9) return d;
    return new DOMParser().parseFromString(String(d || ''), 'text/html');
  };
  // integer from 2Moons pretty_number ("1.234.567", "-27", "8.944 km") -> number | null
  const int = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/ /g, ' ').match(/-?\d[\d.]*/);
    return m ? parseInt(m[0].replace(/\./g, ''), 10) : null;
  };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  // Tooltip HTML of an element. Live GALAXYZ: title attribute (tooltipRight/tooltipTop, new_tooltip.js / Tipped).
  // Upstream 2Moons: data-tooltip-content (class tooltip / tooltip_sticky, tooltip.js).
  // NOTE: Tipped empties the title attribute after the first hover (moves it to jQuery data), and on mobile
  // js_hideTipOnMobile titles are blanked. Parse a fresh fetch() or parse before the user hovers.
  const tipHtml = (el) => (el && (el.getAttribute('data-tooltip-content') || el.getAttribute('title'))) || '';
  const frag = (doc, html) => {
    const t = doc.createElement('template');
    t.innerHTML = html || '';
    return t.content;
  };
  // all tooltip HTML found on an element and its descendants, concatenated (for id regexes)
  const allTips = (el) => {
    if (!el) return '';
    const parts = [tipHtml(el), el.innerHTML];
    el.querySelectorAll('[title],[data-tooltip-content]').forEach((e) => parts.push(tipHtml(e)));
    return parts.join('\n');
  };
  const decodeAmp = (s) => String(s || '').replace(/&amp;/g, '&');
  const firstNum = (re, s) => { const m = re.exec(s); return m ? +m[1] : null; };

  // ---------- page=galaxy ----------
  const STATUS = ['vacation', 'banned', 'inactive', 'longinactive', 'noob', 'strong', 'enemy', 'friend', 'member'];
  const LETTER = { vacation: 'v', banned: 'b', inactive: 'i', longinactive: 'I', noob: 'n', strong: 's' };

  function parseActivity(name) {
    // "Главная планета (*)"  "Colony (49 min)"  (LNG gl_activity '(*)', gl_activity_inactive '(%d min)')
    const m = /\s*\((\*|(\d+)\s*\D{0,6})\)\s*$/.exec(name || '');
    if (!m) return { name: (name || '').trim(), activity: null };
    return { name: name.slice(0, m.index).trim(), activity: m[1] === '*' ? '*' : +m[2] };
  }

  function rowCells(tr) {
    const tds = [...tr.children].filter((c) => c.tagName === 'TD');
    const byClass = (c) => tr.querySelector(':scope > td.' + c);
    if (byClass('playername') || byClass('microplanet1') || byClass('position')) {
      // live GALAXYZ: classes; empty rows are pos + 7 bare <td>
      return {
        layout: 'galaxyz', pos: byClass('position') || tds[0],
        planet: byClass('microplanet1') || null, name: byClass('planetname1') || null, moon: byClass('moon') || null,
        debris: byClass('debris') || null, player: byClass('playername') || null, ally: byClass('allytag') || null,
        action: byClass('action') || null, tds,
      };
    }
    return { layout: 'upstream', pos: tds[0], planet: tds[1], name: tds[2], moon: tds[3], debris: tds[4],
      player: tds[5], ally: tds[6], action: tds[7], tds };
  }

  function findRows(doc) {
    const out = [];
    (doc.querySelector('#content') || doc).querySelectorAll('tr').forEach((tr) => {
      const tds = [...tr.children].filter((c) => c.tagName === 'TD');
      if (tds.length < 8) return;
      const p = txt(tds[0]);
      if (!/^\d{1,2}$/.test(p)) return;
      out.push({ tr, position: +p });
    });
    return out;
  }

  function parseColonize(posCell) {
    // live only: <a title="Planet fields: 215-244<br />Approximately220°Cto260°C<br />" href="...target_mission=7">
    const a = posCell && posCell.querySelector('a[href*="target_mission=7"]');
    if (!a) return null;
    const t = (a.getAttribute('title') || '').replace(/<[^>]*>/g, ' ');
    const f = /(\d+)\s*-\s*(\d+)/.exec(t);
    const temps = [...t.matchAll(/(-?\d+)\s*°\s*C/g)].map((m) => +m[1]);
    return { link: a.getAttribute('href'), fieldsMin: f ? +f[1] : null, fieldsMax: f ? +f[2] : null,
      tempMin: temps.length > 0 ? temps[0] : null, tempMax: temps.length > 1 ? temps[1] : null };
  }

  function linksIn(doc, html) {
    const f = frag(doc, html);
    return [...f.querySelectorAll('a')].map((a) => ({ text: txt(a), href: a.getAttribute('href') || '', onclick: a.getAttribute('onclick') || '' }));
  }

  function missionsFrom(links) {
    const set = new Set();
    for (const l of links) {
      const s = decodeAmp(l.href + ' ' + l.onclick);
      let m = /target_mission=(\d+)/.exec(s); if (m) set.add(+m[1]);
      m = /doit\(\s*(\d+)\s*,/.exec(s); if (m) set.add(+m[1]);
      if (/action=sendMiss?le/.test(s)) set.add(10);
    }
    return [...set].sort((a, b) => a - b);
  }

  function parsePlanetCell(doc, cell, coordsPrefix) {
    if (!cell) return null;
    const a = cell.querySelector('a');
    const img = cell.querySelector('img');
    const html = tipHtml(a);
    const links = linksIn(doc, html);
    const s = decodeAmp(html);
    const tipImg = /planeten\/small\/s_([a-z]+\d*)\./i.exec(s) || (img && /s_([a-z]+\d*)\./i.exec(img.getAttribute('src') || ''));
    const typeCls = /planetTooltip\s+([\w-]+)/.exec(s);
    const h = frag(doc, html).querySelector('h1, th');
    return {
      id: firstNum(/doit\(\s*6\s*,\s*(\d+)/, s) ?? firstNum(/doit\(\s*\d+\s*,\s*(\d+)/, s),
      image: tipImg ? tipImg[1] : null,          // "dschjungelplanet07"
      biome: typeCls ? typeCls[1] : null,        // live tooltip class, e.g. "jungle_2"
      tooltipTitle: h ? txt(h) : null,           // "Planet Главная планета" / upstream "Planet X [2:70:2]"
      missions: missionsFrom(links),             // e.g. [3,4] own, [1,3,5,6] foreign
      phalanx: /page=phalanx/.test(s),
      links,
    };
  }

  function parseMoonCell(doc, cell) {
    if (!cell) return null;
    const a = cell.querySelector('a');
    const img = cell.querySelector('img');
    if (!a && !img) return null;
    const html = tipHtml(a);
    const f = frag(doc, html);
    const s = decodeAmp(html);
    let diameter = null, temp = null;
    const nums = [];
    f.querySelectorAll('tr').forEach((tr) => {
      const c = tr.querySelectorAll(':scope > td');
      if (c.length !== 2 || c[0].querySelector('table') || c[1].querySelector('table')) return;
      const label = txt(c[0]); const v = int(txt(c[1]));
      if (v == null) return;
      if (/diam|durchm|диам/i.test(label)) diameter = v;
      else if (/temp/i.test(label)) temp = v;
      else nums.push(v);
    });
    const th = f.querySelector('th, h1');
    const title = th ? txt(th) : '';
    const nm = /^\S+\s+(.*?)\s*\[\d+:\d+:\d+\]\s*$/.exec(title);
    return {
      id: firstNum(/doit\(\s*6\s*,\s*(\d+)/, s),
      name: (img && img.getAttribute('alt')) || (nm ? nm[1] : null),
      diameter: diameter ?? nums[0] ?? null,
      tempMin: temp ?? nums[1] ?? null,
      missions: missionsFrom(linksIn(doc, html)),
    };
  }

  function parseDebrisCell(doc, cell) {
    if (!cell) return null;
    const a = cell.querySelector('a');
    const img = cell.querySelector('img');
    if (!a && !img) return null;
    const html = tipHtml(a);
    const f = frag(doc, html);
    const vals = [];
    f.querySelectorAll('tr').forEach((tr) => {
      const c = tr.querySelectorAll(':scope > td');
      if (c.length === 2 && !c[0].querySelector('table') && !c[1].querySelector('table')) { const v = int(txt(c[1])); if (v != null) vals.push({ label: txt(c[0]), v }); }
    });
    // order in upstream: metal (LNG tech 901), crystal (902); a fork may add deuterium (903)
    const pick = (re, i) => (vals.find((x) => re.test(x.label)) || vals[i] || {}).v ?? null;
    const s = decodeAmp(html);
    return {
      metal: pick(/metal|металл/i, 0), crystal: pick(/crystal|kristall|кристалл/i, 1),
      deuterium: vals.length > 2 ? pick(/deut|дейтер/i, 2) : null,
      recycleTargetId: firstNum(/doit\(\s*8\s*,\s*(\d+)/, s),   // upstream: id of the PLANET at that position
      canRecycle: /doit\(\s*8\s*,|target_mission=8/.test(s),
    };
  }

  function parsePlayerCell(doc, cell, actionCell) {
    if (!cell) return null;
    const nameEl = cell.querySelector('.galaxy-username') || cell.querySelector('a span') || cell.querySelector('a');
    const name = txt(nameEl);
    if (!name) return null;
    const classes = new Set();
    if (nameEl) nameEl.classList.forEach((c) => { const m = /^galaxy-username-(\w+)$/.exec(c); if (m) classes.add(m[1]); });
    cell.querySelectorAll('[class*="galaxy-short-"]').forEach((e) => e.classList.forEach((c) => {
      const m = /^galaxy-short-(\w+)$/.exec(c); if (m && STATUS.includes(m[1])) classes.add(m[1]);
    }));
    const s = decodeAmp(allTips(cell) + '\n' + allTips(actionCell));
    const id = firstNum(/Dialog\.Playercard\(\s*(\d+)/, s) ?? firstNum(/page=playerCard&id=(\d+)/i, s) ??
      firstNum(/Dialog\.(?:PM|Buddy)\(\s*(\d+)/, s) ?? firstNum(/mode=write&id=(\d+)/, s);
    const tipF = frag(doc, tipHtml(cell.querySelector('a')));
    const rankLi = tipF.querySelector('li.rank');
    const rank = (rankLi ? int(txt(rankLi)) : null) ??
      firstNum(/page=statistics[^'"]*?(?:start|range)=(\d+)/, s) ??
      firstNum(/\bpos\.\s*(\d+)/, txt(tipF.querySelector('th, h1')));
    const st = {};
    for (const k of ['vacation', 'banned', 'inactive', 'longinactive', 'noob', 'strong']) st[k] = classes.has(k);
    return {
      id, name, rank,
      status: st,
      statusLetters: Object.keys(LETTER).filter((k) => st[k] && !(k === 'inactive' && st.longinactive)).map((k) => LETTER[k]).join(''),
      classes: [...classes],
    };
  }

  function parseAllyCell(doc, cell) {
    if (!cell) return null;
    const tagEl = cell.querySelector('.galaxy-alliance') || cell.querySelector('a') || cell;
    const tag = txt(tagEl);
    if (!tag || tag === '-') return null;
    const s = decodeAmp(allTips(cell));
    const rel = [...(tagEl.classList || [])].map((c) => /^galaxy-alliance-(\w+)$/.exec(c)).filter(Boolean).map((m) => m[1])[0] || null;
    const f = frag(cell.ownerDocument, tipHtml(cell.querySelector('a')));
    const th = txt(f.querySelector('th, h1'));
    const mem = /(\d+)\s*\D*$/.exec(th);
    const web = [...f.querySelectorAll('a[target="allyweb"]')].map((a) => a.getAttribute('href'))[0] || null;
    return {
      tag, rel,
      id: firstNum(/mode=info&id=(\d+)/, s),
      rank: firstNum(/start=(\d+)&who=2/, s) ?? firstNum(/who=2&start=(\d+)/, s) ?? firstNum(/who=2&range=(\d+)/, s) ?? firstNum(/range=(\d+)&who=2/, s),
      members: mem ? +mem[1] : null,
      title: th || null,
      web,
    };
  }

  function parseActionCell(doc, cell) {
    const s = decodeAmp(cell ? cell.innerHTML : '');
    return {
      spy: /doit\(\s*6\s*,/.test(s),
      message: /Dialog\.PM\(/.test(s),
      buddy: /Dialog\.Buddy\(/.test(s),
      missile: /action=sendMiss?le/.test(s),
      phalanx: /page=phalanx/.test(s),
      empty: !cell || (!cell.querySelector('a') && (txt(cell) === '' || txt(cell) === '-')),
    };
  }

  function parseSystem(input, opts = {}) {
    const doc = toDoc(input);
    const me = opts.me || {};
    const out = { ok: false, layout: null, galaxy: null, system: null, maxPlanets: null, rows: [], positions: [], header: {}, error: null };
    const gIn = doc.querySelector('#galaxy_form input[name="galaxy"], input[name="galaxy"][type="text"]');
    const sIn = doc.querySelector('#galaxy_form input[name="system"], input[name="system"][type="text"]');
    // printMessage page (e.g. not enough deuterium): no form, a message box
    if (!gIn && !doc.querySelector('#galaxytableHead, table.table569')) {
      out.error = txt(doc.querySelector('#content')) || 'no galaxy table';
      return out;
    }
    out.galaxy = gIn ? +gIn.value : null;
    out.system = sIn ? +sIn.value : null;
    // fallbacks: live tfoot comment "<!--System 2:68-->", upstream th "System 2:70"
    if (out.galaxy == null || out.system == null) {
      const html = (doc.querySelector('#content') || doc.documentElement || {}).innerHTML || '';
      const m = /<!--\s*System\s+(\d+):(\d+)\s*-->/.exec(html) || /<th[^>]*>[^<]*?(\d+):(\d+)\s*<\/th>/.exec(html);
      if (m) { out.galaxy = +m[1]; out.system = +m[2]; }
    }
    const exp = doc.querySelector('#expeditionbutton a[href*="target_mission=15"], a[href*="target_mission=15"]');
    if (exp) { const m = /planet=(\d+)/.exec(decodeAmp(exp.getAttribute('href'))); if (m) out.maxPlanets = +m[1] - 1; }

    // header counters
    const n = (sel) => { const e = doc.querySelector(sel); return e ? int(txt(e)) : null; };
    const recy = doc.querySelectorAll('span#recycler');                 // live: DUPLICATE id (recycler, giga recycler)
    const slotsTxt = txt(doc.querySelector('#slotValue')) || '';
    let m = /(\d+)\s*\/\s*(\d+)/.exec(slotsTxt);
    if (!m) { const st = doc.querySelector('#slots'); m = st ? /(\d+)\s*\/\s*(\d+)/.exec(txt(st.parentElement)) : null; }
    out.header = {
      probes: n('#probes') ?? n('#elementID210'),
      recyclers: recy[0] ? int(txt(recy[0])) : n('#elementID209'),
      gigaRecyclers: recy[1] ? int(txt(recy[1])) : n('#elementID219'),
      missiles: n('#rockets') ?? n('#missiles'),
      slotsUsed: m ? +m[1] : null, slotsMax: m ? +m[2] : null,
      colonizedText: txt(doc.querySelector('#colonized')) || null,
      missileForm: !!doc.querySelector('form[action*="fleetMissile"]'),
    };

    for (const { tr, position } of findRows(doc)) {
      const c = rowCells(tr);
      out.layout = out.layout || c.layout;
      const coords = out.galaxy + ':' + out.system + ':' + position;
      const nameRaw = c.name ? txt(c.name) : '';
      const emptyRow = c.tds.slice(1).every((td) => txt(td) === '' && !td.querySelector('a,img'));
      const row = { position, coords, kind: 'empty', colonize: null, planet: null, moon: null, debris: null, player: null,
        alliance: null, actions: null, own: false, activity: null };
      if (emptyRow) {
        row.colonize = parseColonize(c.pos) || (c.pos.querySelector('a[href*="target_mission=7"]') ? { link: c.pos.querySelector('a').getAttribute('href') } : null);
      } else if (!c.planet || (!c.planet.querySelector('a,img') && !c.player?.querySelector('a,span'))) {
        row.kind = 'destroyed';
        row.destroyedText = nameRaw || null;
        row.debris = parseDebrisCell(doc, c.debris);
      } else {
        row.kind = 'planet';
        const act = parseActivity(nameRaw);
        row.activity = act.activity;          // '*' (< 15 min) | minutes 15..59 | null; max(planet, moon) last_update
        row.planet = { ...parsePlanetCell(doc, c.planet), name: act.name };
        row.moon = parseMoonCell(doc, c.moon);
        row.debris = parseDebrisCell(doc, c.debris);
        row.player = parsePlayerCell(doc, c.player, c.action);
        row.alliance = parseAllyCell(doc, c.ally);
        row.actions = parseActionCell(doc, c.action);
        row.own = !!row.player && ((me.id != null && row.player.id === me.id) || (me.name != null && row.player.name === me.name) ||
          (row.player.id == null && row.actions.empty && !row.planet.missions.some((x) => x === 1 || x === 6)));
        if (row.own && row.player && row.player.id == null && me.id != null) row.player.id = me.id;
      }
      out.rows.push(row);
      if (row.kind !== 'empty') out.positions.push(row);
    }
    out.ok = out.rows.length > 0;
    return out;
  }

  // ---------- page=statistics ----------
  function parseStatistics(input) {
    const doc = toDoc(input);
    const sel = (name) => { const s = doc.querySelector('select[name="' + name + '"]'); return s ? +s.value : null; };
    const out = { who: sel('who'), type: sel('type'), range: sel('range'), updated: null, rows: [] };
    const th = [...doc.querySelectorAll('th')].map(txt).find((t) => /\(.*\d{1,2}:\d{2}/.test(t));
    if (th) { const m = /:\s*(.+)\)\s*$/.exec(th); out.updated = m ? m[1].trim() : null; }
    (doc.querySelector('#content') || doc).querySelectorAll('tr').forEach((tr) => {
      const tds = [...tr.children].filter((c) => c.tagName === 'TD');
      if (tds.length < 4 || !tds[1].querySelector('a')) return;
      const rank = int(txt(tds[0]));
      if (rank == null || !/^\s*[\d.]+\s*$/.test(txt(tds[0]))) return;
      const s = decodeAmp(tr.innerHTML);
      const chTip = tipHtml(tds[0].querySelector('a'));
      const chM = /([+-]?\d+)/.exec(chTip.replace(/<[^>]*>/g, ''));
      const change = /\*/.test(chTip.replace(/<[^>]*>/g, '')) ? 0 : (chM ? +chM[1] : null);
      const pc = /Dialog\.Playercard\(\s*(\d+)/.exec(s);
      if (pc || out.who === 1) {
        const allyA = tds[3] && tds[3].querySelector('a[href*="mode=info"]');
        out.rows.push({ kind: 'player', rank, change, id: pc ? +pc[1] : null, name: txt(tds[1]),
          me: /color:\s*lime/i.test(tds[1].innerHTML),
          allianceId: allyA ? firstNum(/id=(\d+)/, decodeAmp(allyA.getAttribute('href'))) : null,
          allianceName: allyA ? txt(allyA) : null, points: int(txt(tds[4] || tds[tds.length - 1])) });
      } else {
        const a = tds[1].querySelector('a');
        out.rows.push({ kind: 'alliance', rank, change, id: a ? firstNum(/id=(\d+)/, decodeAmp(a.getAttribute('href'))) : null,
          name: txt(tds[1]), members: int(txt(tds[2])), points: int(txt(tds[3])), perMember: int(txt(tds[4])) });
      }
    });
    return out;
  }

  // ---------- page=search&mode=result&ajax=1 ----------
  function parseSearchResult(input) {
    const doc = toDoc(input);
    const t = doc.querySelector('#resulttable');
    const out = { kind: null, rows: [] };
    if (!t) return out;
    const heads = t.querySelectorAll('th').length;
    out.kind = heads >= 6 ? 'player' : 'alliance';
    t.querySelectorAll('tr').forEach((tr) => {
      const tds = [...tr.children].filter((c) => c.tagName === 'TD');
      if (!tds.length) return;
      if (out.kind === 'player') {
        const s = decodeAmp(tr.innerHTML);
        const co = /\[(\d+):(\d+):(\d+)\]/.exec(txt(tds[4]));
        const allyA = tds[2].querySelector('a');
        out.rows.push({ id: firstNum(/Dialog\.Playercard\(\s*(\d+)/, s), name: txt(tds[0]),
          allianceId: allyA ? firstNum(/id=(\d+)/, decodeAmp(allyA.getAttribute('href'))) : null,
          allianceName: allyA ? txt(allyA) : null, homePlanet: txt(tds[3]),
          coords: co ? co[1] + ':' + co[2] + ':' + co[3] : null, rank: int(txt(tds[5])) });
      } else {
        out.rows.push({ tag: txt(tds[0]), name: txt(tds[1]), members: int(txt(tds[2])), points: int(txt(tds[3])) });
      }
    });
    return out;
  }

  // ---------- page=playerCard&id=N (popup) ----------
  function parsePlayerCard(input) {
    const doc = toDoc(input);
    const table = doc.querySelector('#content table') || doc.querySelector('table');
    const out = { id: null, name: null, homePlanet: null, homeCoords: null, allianceId: null, allianceName: null,
      points: {}, ranks: {}, fights: {}, units: {}, debris: {} };
    if (!table) return out;
    const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].map((tr) => [...tr.children].filter((c) => c.tagName === 'TD'));
    const data = rows.filter((r) => r.length >= 2);
    const s = decodeAmp(table.innerHTML);
    out.id = firstNum(/Dialog\.(?:Buddy|PM)\(\s*(\d+)/, s);
    if (data[0]) out.name = txt(data[0][1]);
    if (data[1]) {
      const co = /\[(\d+):(\d+):(\d+)\]/.exec(txt(data[1][1]));
      out.homeCoords = co ? co[1] + ':' + co[2] + ':' + co[3] : null;
      out.homePlanet = txt(data[1][1]).replace(/\s*\[\d+:\d+:\d+\]\s*$/, '') || null;
    }
    if (data[2]) {
      const a = data[2][1].querySelector('a');
      out.allianceName = a ? txt(a) : null;
      out.allianceId = a ? firstNum(/id=(\d+)/, decodeAmp(a.getAttribute('onclick') || a.getAttribute('href'))) : null;
    }
    // fixed order (page.playerCard.default.tpl): builds, tech, fleet, defense, total; then won, draw, lost, total; then shot, lost units, metal, crystal
    const keys = ['buildings', 'research', 'fleet', 'defense', 'total'];
    keys.forEach((k, i) => { const r = data[3 + i]; if (r) { out.points[k] = int(txt(r[1])); out.ranks[k] = int(txt(r[2])); } });
    const fk = ['won', 'draw', 'lost', 'total'];
    // data[8] is the "&nbsp; | Fights | %" sub-header row
    fk.forEach((k, i) => { const r = data[9 + i]; if (r) out.fights[k] = { count: int(txt(r[1])), pct: r[2] ? parseFloat(txt(r[2]).replace(',', '.')) : null }; });
    const uk = [['units', 'destroyed'], ['units', 'lost'], ['debris', 'metal'], ['debris', 'crystal']];
    uk.forEach(([g, k], i) => { const r = data[13 + i]; if (r) out[g][k] = int(txt(r[1])); });
    return out;
  }

  // ---------- page=phalanx (popup) ----------
  function parsePhalanx(input) {
    const doc = toDoc(input);
    const th = [...doc.querySelectorAll('th')].map(txt).find((t) => /\[\d+:\d+:\d+\]/.test(t));
    const out = { coords: null, name: null, error: null, fleets: [] };
    if (!th) { out.error = txt(doc.querySelector('#content')) || null; return out; }
    const m = /\[(\d+:\d+:\d+)\]\s*\((.*)\)\s*$/.exec(th);
    if (m) { out.coords = m[1]; out.name = m[2]; }
    doc.querySelectorAll('td.fleets[data-fleet-time]').forEach((td) => {
      const t = td.nextElementSibling;
      const span = t && t.querySelector('span[class]');
      const cls = span ? span.className : '';
      const coords = t ? [...t.querySelectorAll('a')].map((a) => (/\[(\d+:\d+:\d+)\]/.exec(txt(a)) || [])[1]).filter(Boolean) : [];
      out.fleets.push({ key: td.id, endUnix: +td.getAttribute('data-fleet-end-time'), restSec: +td.getAttribute('data-fleet-time'),
        status: (/\b(flight|return|holding)\b/.exec(cls) || [])[1] || null, cls, coords, text: txt(t) });
    });
    return out;
  }

  // ---------- URLs ----------
  const urls = {
    // GET works (HTTP::_GP reads $_REQUEST). Costs deuterium_cost_galaxy (default 10) from the CURRENT planet
    // whenever (g,s) differs from the current planet's system. Never add cp unless you want to switch planet.
    galaxy: (g, s) => 'game.php?page=galaxy&galaxy=' + g + '&system=' + s,
    missileForm: (g, s, p, type = 1) => 'game.php?page=galaxy&action=sendMissle&galaxy=' + g + '&system=' + s + '&planet=' + p + '&type=' + type,
    fleetAjax: (mission, planetId) => 'game.php?page=fleetAjax&ajax=1&mission=' + mission + '&planetID=' + planetId,
    fleet: (g, s, p, type, mission) => 'game.php?page=fleetTable&galaxy=' + g + '&system=' + s + '&planet=' + p + '&planettype=' + type + '&target_mission=' + mission,
    phalanx: (g, s, p) => 'game.php?page=phalanx&galaxy=' + g + '&system=' + s + '&planet=' + p + '&planettype=1',
    playerCard: (id) => 'game.php?page=playerCard&id=' + id,
    statistics: ({ who = 1, type = 1, range = 1 } = {}) => 'game.php?page=statistics&who=' + who + '&type=' + type + '&range=' + range,
    searchResult: (type, text) => 'game.php?page=search&mode=result&ajax=1&type=' + type + '&search=' + encodeURIComponent(text),
    searchAutocomplete: (types, term) => 'game.php?page=search&mode=autocomplete&ajax=1&type=' + types + '&term=' + encodeURIComponent(term),
    allianceInfo: (id) => 'game.php?page=alliance&mode=info&id=' + id,
    buddyRequest: (id) => 'game.php?page=buddyList&mode=request&id=' + id,
    writeMessage: (id) => 'game.php?page=messages&mode=write&id=' + id,
  };

  const api = { parseSystem, parseActivity, parseStatistics, parseSearchResult, parsePlayerCard, parsePhalanx, urls, _int: int, _tipHtml: tipHtml };
  root.GZGalaxy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
