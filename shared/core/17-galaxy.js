/* shared/core/17-galaxy.js — galaxy parsing, system cache and player index, polite scanner, row slots. Owner: core.
 * GALAXYZ (specs/galaxyz/galaxy.md): the system view is a full server-rendered page (table#galaxytableHead, tr.row x15);
 * galaxy.parseGz(doc) turns it into the same ParsedSystem as the OgameX JSON. Foreign-row markup (ids, flags, moon, debris,
 * alliance) is [INFERRED] from upstream 2Moons + the live style: every selector is optional and never throws.
 * OgameX (specs/galaxy.md §11.1): POST /ajax/galaxy JSON, piggyback on the game's own calls.
 * Store keys (server scope): galaxy.g<N> = { [system]: CompactSystem }, galaxy.players = { [id | 'n:<name>']: PlayerEntry }.
 * Deuterium guard (GALAXYZ): every foreign system view costs deuterium_cost_galaxy [UPSTREAM ShowGalaxyPage.class.php:56-67].
 * galaxy.fetch / galaxy.scan send nothing unless the caller passes userStarted: true (a user click started it); otherwise
 * they answer stoppedBy 'cost' without a request. A server refusal "not enough deuterium" answers stoppedBy 'deuterium'.
 * Late subscribers: galaxy.onSystem / galaxy.onRender replay the last event of this page (boot does not await galaxy.init). */
(function (OGX) {
  'use strict';
  const galaxy = (OGX.galaxy = OGX.galaxy || {});
  const log = OGX.log.create('galaxy');
  const SRV = { scope: 'server' };

  /** activity object -> '*' (< 15 min), 15..60 (idle minutes), null (> 60 min or none). */
  galaxy.activity = function (a) {
    if (!a || a.showActivity === false) return null;
    if (a.showActivity === 15) return '*';
    if (a.showActivity === 60) return a.idleTime;
    return null;
  };
  /** OGame-style status letters from galaxy player flags. */
  galaxy.status = (p) => [
    p.isAdmin && 'A', p.isBanned && 'b', p.isOnVacation && 'v', p.isLongInactive ? 'I' : (p.isInactive && 'i'),
    p.isNewbie && 'n', p.isStrong && 's',
  ].filter(Boolean).join('');

  const debrisOf = (d) => d && d.resources ? { metal: d.resources.metal.amount, crystal: d.resources.crystal.amount,
    deuterium: d.resources.deuterium.amount, requiredShips: d.requiredShips } : null;

  /** POST /ajax/galaxy JSON -> ParsedSystem (null on error). */
  galaxy.parseSystem = function (json) {
    if (!json || json.success !== true || !json.system) return null;
    const s = json.system;
    const out = { galaxy: +s.galaxy, system: +s.system, colonized: s.slotsColonized, positions: [], expeditionDebris: null,
      me: { playerId: s.playerId, currentPlanetId: s.currentPlanetId, probes: s.availableProbes, recyclers: s.availableRecyclers,
        pathfinders: s.availablePathfinders, missiles: s.availableMissiles, usedSlots: s.usedFleetSlots, maxSlots: s.maximumFleetSlots,
        canSystemPhalanx: s.canSystemPhalanx },
      t: OGX.time.serverNow() };
    for (const row of s.galaxyContent || []) {
      if (row.position === 16) { out.expeditionDebris = debrisOf(row.planets); continue; }
      const list = Array.isArray(row.planets) ? row.planets : [];
      const planet = list.find((p) => p.planetType === 1);
      const debris = list.find((p) => p.planetType === 2);
      const moon = list.find((p) => p.planetType === 3);
      if (!planet) continue;
      const pl = row.player || {};
      const destroyed = !!planet.isDestroyed;
      out.positions.push({
        position: row.position,
        coords: row.galaxy + ':' + row.system + ':' + row.position,
        planetId: planet.planetId, planetName: planet.planetName, destroyed,
        activity: galaxy.activity(planet.activity),
        moon: moon ? { id: moon.planetId, name: moon.planetName, size: moon.size, destroyed: !!moon.isDestroyed, activity: galaxy.activity(moon.activity) } : null,
        debris: debrisOf(debris),
        playerId: destroyed ? null : row.playerId, playerName: destroyed ? null : row.playerName,
        status: destroyed ? '' : galaxy.status(pl),
        rank: pl.actions && pl.actions.highscore ? pl.actions.highscore.rank ?? null : null,
        allianceId: pl.allianceId ?? null, allianceTag: pl.allianceTag ?? null, allianceName: pl.allianceName ?? null,
        missions: (planet.availableMissions || []).map((m) => m.missionType),
        canPhalanx: !!(row.actions && row.actions.phalanxActive), canMissile: !!(row.actions && row.actions.canMissileAttack),
      });
    }
    return out;
  };

  /** Rendered DOM row (#galaxyRow1..15) -> essentials, or null if empty (live DOM only; galaxy.md §4.3). */
  galaxy.parseRow = function (rowEl) {
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
    const debrisLis = Array.from(rowEl.querySelectorAll('.cellDebris .debris-content')).map((li) => parseInt(li.textContent.replace(/\D/g, ''), 10));
    const status = Array.from(rowEl.querySelectorAll('.cellPlayerName pre > span[class^="status_abbr_"]')).map((s) => s.className.match(/status_abbr_(\w+)/)[1]);
    const pn = rowEl.querySelector('.cellPlanetName > span');
    return {
      position: pos, planetId: +planet.dataset.planetId, planetName: pn ? pn.textContent.trim() : null, activity: act(planet),
      moonId: moonEl ? +moonEl.dataset.moonId : null, moonActivity: act(moonEl),
      playerId: nameEl ? +nameEl.getAttribute('rel').slice(6) : null,
      playerName: nameEl ? nameEl.firstChild.textContent.trim() : (own ? own.textContent.trim() : null),
      own: !!own, status,
      allianceId: ally ? +ally.getAttribute('rel').slice(8) : null,
      allianceTag: ally ? ally.firstChild.textContent.trim() : null,
      debris: debrisLis.length ? { metal: debrisLis[0], crystal: debrisLis[1], deuterium: debrisLis[2] } : null,
    };
  };

  // ------------------------------------------------------------------ GALAXYZ page (galaxy.md §2-4, §7 recipes)
  // [REAL galaxy.html] skeleton, header, free and own rows. [INFERRED] foreign rows: Dialog.Playercard/PM/Buddy(ID) = player id,
  // doit(6|8, ID) = planet/moon DB id, span.galaxy-username-<flag>, td.moon / td.debris links, span.galaxy-alliance + tooltip.
  const gz = (galaxy.gz = galaxy.gz || {});
  const gzInt = (s) => { const m = String(s == null ? '' : s).match(/-?\d[\d.]*/); return m ? parseInt(m[0].replace(/\./g, ''), 10) : null; };
  const gzText = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const gzParams = (href) => new URLSearchParams(String(href || '').replace(/^[^?]*\?/, '').replace(/#.*$/, ''));
  /** Tooltip HTML lives in the title attribute (Tipped/new_tooltip.js) or data-tooltip-content: parsed, never inserted. */
  function gzTip(el) {
    const html = el ? (el.getAttribute('title') || el.getAttribute('data-tooltip-content') || '') : '';
    return new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  }
  const idIn = (s, re) => { const m = re.exec(String(s || '')); return m ? +m[1] : null; };
  const PLAYER_ID_RE = /Dialog\.(?:Playercard|PM|Buddy)\(\s*(\d+)/;
  // span.galaxy-username-<flag> -> status letter (galaxy.status order); member/friend/enemy are alliance classes [UPSTREAM GalaxyRows.php:174-219]
  const FLAG_LETTER = { admin: 'A', banned: 'b', vacation: 'v', longinactive: 'I', inactive: 'i', noob: 'n', strong: 's' };
  gz.statusOf = (flags) => {
    const f = new Set(flags || []);
    return ['admin', 'banned', 'vacation', 'longinactive', 'inactive', 'noob', 'strong']
      .filter((k) => f.has(k) && !(k === 'inactive' && f.has('longinactive'))).map((k) => FLAG_LETTER[k]).join('');
  };

  /** Header of the system view: { galaxy, system, probes, recyclers, gigaRecyclers, missiles, slotsUsed, slotsMax, existingPlanets } (null = not found). */
  gz.header = function (doc = document) {
    const form = doc.querySelector('form#galaxy_form');
    const field = (n) => { const i = form && form.querySelector(`input[name="${n}"]`); return i ? gzInt(i.value) : null; };
    const info = gzText(doc.querySelector('#galaxytableHead tr.info_header'));
    const pick = (re) => { const m = info.match(re); return m ? gzInt(m[1]) : null; };
    const slots = gzText(doc.querySelector('#slotValue')).match(/(\d+)\s*\/\s*(\d+)/);
    return {
      galaxy: field('galaxy'), system: field('system'),
      // labels are English on the saved pages; numbers before them may carry '.' thousands
      probes: pick(/([\d.]+)\s+Spy Probes?/i), recyclers: pick(/([\d.]+)\s+Recyclers?(?![\w-])/), gigaRecyclers: pick(/([\d.]+)\s+Giga Recyclers?/i),
      missiles: pick(/([\d.]+)\s+Available Missiles/i),
      slotsUsed: slots ? +slots[1] : null, slotsMax: slots ? +slots[2] : null,
      existingPlanets: gzInt(gzText(doc.querySelector('#colonized'))),   // NOT the row count (galaxy.md §0.6)
    };
  };

  /** One tr.row -> raw row ({ position, empty, el, ... }); free slots carry the colonisation hint (fields, temperature). */
  gz.row = function (tr, i) {
    const posCell = tr.querySelector('td.position');
    const position = gzInt(gzText(posCell)) || i + 1;
    const planetCell = tr.querySelector('td[class^="microplanet"]');
    if (!planetCell) {
      const a = posCell && posCell.querySelector('a[href*="target_mission=7"]');
      const t = a ? (a.getAttribute('title') || '') : '';
      const f = t.match(/fields:\s*(\d+)\s*-\s*(\d+)/i);
      const c = t.match(/(-?\d+)\s*°C\s*to\s*(-?\d+)\s*°C/i);
      return { position, empty: true, el: tr, colonize: !!a,
        fieldsMin: f ? +f[1] : null, fieldsMax: f ? +f[2] : null, tempMin: c ? +c[1] : null, tempMax: c ? +c[2] : null };
    }
    const pTip = gzTip(planetCell.querySelector('a'));
    const links = (doc) => Array.from(doc.querySelectorAll('ul.ListLinks a')).map((a) => {
      const href = a.getAttribute('href') || '';
      const doit = /doit\(\s*(\d+)\s*,\s*(\d+)/.exec(href);
      const q = gzParams(href);
      return { mission: doit ? +doit[1] : gzInt(q.get('target_mission')), targetId: doit ? +doit[2] : null,
        planettype: gzInt(q.get('planettype')), phalanx: /page=phalanx/.test(href), missile: /action=sendMissle/.test(href) };
    });
    const pLinks = links(pTip);
    const nameRaw = gzText(tr.querySelector('td[class^="planetname"]'));
    const act = nameRaw.match(/\((\*|\d+\s*min)\)\s*$/);
    const destroyed = !pTip.querySelector('#pos-planet') && /destroyed|уничтож/i.test(nameRaw);
    // player: name span + flags; id from Dialog.Playercard/Buddy/PM in the tooltip or the action cell
    const playerA = tr.querySelector('td.playername a');
    const userSpan = tr.querySelector('td.playername .galaxy-username');
    const plTip = gzTip(playerA);
    let playerId = null;
    for (const a of plTip.querySelectorAll('a[onclick]')) if ((playerId = idIn(a.getAttribute('onclick'), PLAYER_ID_RE)) !== null) break;
    if (playerId === null) for (const a of tr.querySelectorAll('td.action a[onclick], td.playername a[onclick]')) if ((playerId = idIn(a.getAttribute('onclick'), PLAYER_ID_RE)) !== null) break;
    const flags = userSpan ? Array.from(userSpan.classList).filter((c) => c.startsWith('galaxy-username-')).map((c) => c.slice(16)) : [];
    // moon: tooltip "Moon NAME", Diameter row, doit(6, MOONID) [UPSTREAM tpl:110-116]
    const moonA = tr.querySelector('td.moon a');
    let moon = null;
    if (moonA || tr.querySelector('td.moon img')) {
      const mTip = gzTip(moonA);
      const mLinks = links(mTip);
      const spy = mLinks.find((l) => l.targetId !== null);
      const dia = Array.from(mTip.querySelectorAll('tr')).find((r) => /diam|диам/i.test(gzText(r)));
      moon = { id: spy ? spy.targetId : null, name: gzText(mTip.querySelector('h1')).replace(/^(Moon|Луна)\s*/i, '').replace(/\s*\[\d+:\d+:\d+\]\s*$/, '') || null,
        size: dia ? gzInt(gzText(dia.lastElementChild)) : null, destroyed: false, activity: null };
    }
    // debris: tooltip "Metal: N" / "Crystal: N" + doit(8, PLANETID)
    const debrisA = tr.querySelector('td.debris a');
    let debris = null;
    if (debrisA || tr.querySelector('td.debris img')) {
      const dTip = gzTip(debrisA);
      const dt = gzText(dTip.body);
      const dm = dt.match(/Metal:?\s*(-?[\d.]+)/i) || dt.match(/Металл:?\s*(-?[\d.]+)/i);
      const dc = dt.match(/Crystal:?\s*(-?[\d.]+)/i) || dt.match(/Кристалл:?\s*(-?[\d.]+)/i);
      const rec = links(dTip).find((l) => l.mission === 8 && l.targetId !== null);
      debris = { metal: dm ? gzInt(dm[1]) : null, crystal: dc ? gzInt(dc[1]) : null, deuterium: 0, requiredShips: null, recycleId: rec ? rec.targetId : null };
    }
    // alliance: span.galaxy-alliance[-member|-friend|-enemy] tag; tooltip "Alliance NAME N Members", ?page=alliance&mode=info&id=ID
    const allyA = tr.querySelector('td.allytag a');
    const allySpan = tr.querySelector('td.allytag .galaxy-alliance');
    let alliance = null;
    const allyTag = allySpan ? gzText(allySpan) : (gzText(tr.querySelector('td.allytag')).replace(/^-$/, '') || null);
    if (allyTag) {
      const aTip = gzTip(allyA);
      const info = aTip.querySelector('a[href*="mode=info"]');
      const h1 = gzText(aTip.querySelector('h1'));
      const mm = h1.match(/^(?:Alliance|Альянс)\s+(.*?)(?:\s+(\d+)\s+\S+)?$/i);
      alliance = { id: info ? gzInt(gzParams(info.getAttribute('href')).get('id')) : null, tag: allyTag, name: mm ? mm[1] : null,
        members: mm && mm[2] ? +mm[2] : null,
        relation: allySpan ? (Array.from(allySpan.classList).map((c) => /^galaxy-alliance-(\w+)$/.exec(c)).find(Boolean) || [])[1] || null : null };
    }
    const actions = Array.from(tr.querySelectorAll('td.action a')).map((a) => (a.getAttribute('href') || '') + ' ' + (a.getAttribute('onclick') || ''));
    const spyLink = pLinks.find((l) => l.mission === 6 && l.targetId !== null);
    const actionSpy = actions.map((h) => idIn(h, /doit\(\s*6\s*,\s*(\d+)/)).find((x) => x !== null);
    const rank = plTip.querySelector('li.rank');
    return {
      position, empty: false, el: tr,
      coords: (gzText(pTip.querySelector('#pos-planet')).match(/\d+:\d+:\d+/) || [null])[0],
      planetId: spyLink ? spyLink.targetId : (actionSpy ?? (debris ? debris.recycleId : null)),
      planetName: nameRaw.replace(/\s*\((\*|\d+\s*min)\)\s*$/, '').trim() || null,
      activity: act ? (act[1] === '*' ? '*' : gzInt(act[1])) : null, destroyed,
      planetImg: (pTip.querySelector('img.planetTooltip') || { className: null }).className || null,
      missions: pLinks.filter((l) => l.mission !== null).map((l) => l.mission),
      canPhalanx: pLinks.some((l) => l.phalanx), canMissile: pLinks.some((l) => l.missile) || actions.some((h) => /action=sendMissle/.test(h)),
      playerName: userSpan ? gzText(userSpan) : (gzText(plTip.querySelector('h1 span')) || null),
      playerId, flags, rank: rank ? gzInt(gzText(rank)) : null,
      statsHref: (plTip.querySelector('a[href*="page=statistics"]') || { getAttribute: () => null }).getAttribute('href'),
      moon, debris, alliance, actions,
    };
  };

  /**
   * GALAXYZ system page (document or fetched/DOMParser doc) -> ParsedSystem (same shape as parseSystem) + GALAXYZ extras:
   * engine, free [{ position, fieldsMin, fieldsMax, tempMin, tempMax }], positions[].own / flags / allianceRelation / moon.size.
   * Own rows carry no ids on the page: planetId comes from the planet list of the same document, playerId from `me.playerId`.
   * null when the document has no galaxy table (info page, e.g. "not enough deuterium").
   */
  galaxy.parseGz = function (doc = document, { playerName, playerId } = {}) {
    const table = doc && doc.querySelector && doc.querySelector('#galaxytableHead');
    if (!table) return null;
    const head = gz.header(doc);
    if (!head.galaxy || !head.system) return null;
    let me = { name: playerName || null, id: playerId ?? null };
    let bodies = [];
    try {
      const P = OGX.parse && OGX.parse.gz;
      if (P) {
        if (!me.name) me.name = P.player(doc).name;
        bodies = P.bodies(doc).list;
      }
    } catch (e) { /* layout parts missing in a fragment */ }
    let cur = null;
    try { cur = OGX.parse.gz.currentBody(doc).id; } catch (e) { cur = null; }
    const out = { engine: 'galaxyz', galaxy: head.galaxy, system: head.system, colonized: 0, positions: [], free: [], expeditionDebris: null,
      me: { playerId: me.id, playerName: me.name, currentPlanetId: cur, probes: head.probes, recyclers: head.recyclers, gigaRecyclers: head.gigaRecyclers,
        pathfinders: null, missiles: head.missiles, usedSlots: head.slotsUsed, maxSlots: head.slotsMax, canSystemPhalanx: null },
      existingPlanets: head.existingPlanets, t: OGX.time.serverNow() };
    const rows = Array.from(table.querySelectorAll(':scope > tbody > tr.row'));
    rows.forEach((tr, i) => {
      let r;
      try { r = gz.row(tr, i); } catch (e) { log.warn('galaxy row not parsed', i + 1, e && e.message); return; }
      if (r.empty) {
        if (r.colonize || r.fieldsMin !== null) out.free.push({ position: r.position, fieldsMin: r.fieldsMin, fieldsMax: r.fieldsMax, tempMin: r.tempMin, tempMax: r.tempMax });
        return;
      }
      const coords = r.coords || `${head.galaxy}:${head.system}:${r.position}`;
      const own = !!(me.name && r.playerName === me.name) || (!r.playerId && !r.actions.some((h) => /\S/.test(h)) && r.missions.includes(4));
      let planetId = r.planetId;
      let moonId = r.moon ? r.moon.id : null;
      if (own) {
        const b = bodies.filter((x) => x.coords === coords);
        const pl = b.find((x) => !x.isMoon); const mo = b.find((x) => x.isMoon);
        if (planetId === null && pl) planetId = pl.id;
        if (moonId === null && mo) moonId = mo.id;
      }
      out.colonized++;
      out.positions.push({
        position: r.position, coords, planetId, planetName: r.planetName, destroyed: r.destroyed, activity: r.activity,
        moon: r.moon ? Object.assign({}, r.moon, { id: moonId }) : null,
        debris: r.debris ? { metal: r.debris.metal, crystal: r.debris.crystal, deuterium: r.debris.deuterium, requiredShips: null } : null,
        playerId: r.playerId ?? (own ? me.id : null), playerName: r.destroyed ? null : r.playerName,
        status: gz.statusOf(r.flags), flags: r.flags, rank: r.rank,
        allianceId: r.alliance ? r.alliance.id : null, allianceTag: r.alliance ? r.alliance.tag : null, allianceName: r.alliance ? r.alliance.name : null,
        allianceRelation: r.alliance ? r.alliance.relation : null,
        missions: r.missions, canPhalanx: r.canPhalanx, canMissile: r.canMissile, own,
      });
    });
    return out;
  };

  /** page=tournament (galaxy.md §6): { endsInSec, boards: [{ id, tab, title, prizes, rows: [{ pos, playerId, name, points }] }] } — an id <-> name directory. */
  gz.tournament = function (doc = document) {
    const cd = doc.querySelector('.countdown2');
    const out = { endsInSec: cd ? gzInt(cd.getAttribute('secs')) : null, boards: [] };
    for (const box of doc.querySelectorAll('div.ach_content_box[id^="skils"]')) {
      const n = box.id.replace('skils', '');
      const rows = Array.from(box.querySelectorAll('tr')).filter((tr) => tr.querySelector('span.ticket_row_linck_id')).map((tr) => {
        const a = tr.querySelector('span.ticket_row_linck_subject a');
        return { pos: gzInt(gzText(tr.querySelector('.ticket_row_linck_id'))), playerId: idIn(a && a.getAttribute('onclick'), /Playercard\((\d+)/),
          name: gzText(a) || null, points: gzInt(gzText(tr.querySelector('.ticket_row_linck_status'))) };
      });
      out.boards.push({ id: box.id, tab: gzText(doc.querySelector('.ach_menu li.skils' + n + ' a')) || null, title: gzText(box.querySelector('center b')) || null,
        prizes: Array.from(box.querySelectorAll('.record_name_utits')).map(gzText), rows });
    }
    return out;
  };

  // ------------------------------------------------------------------ cache (compact rows keep each galaxy key small)
  const F = ['position', 'planetId', 'planetName', 'destroyed', 'activity', 'playerId', 'playerName', 'status', 'rank', 'allianceId', 'allianceTag', 'allianceName', 'missions'];
  function compact(sys) {
    return {
      t: sys.t, c: sys.colonized, x: sys.expeditionDebris,
      p: sys.positions.map((p) => F.map((k) => p[k]).concat([p.moon ? [p.moon.id, p.moon.name, p.moon.size, p.moon.destroyed, p.moon.activity] : null,
        p.debris ? [p.debris.metal, p.debris.crystal, p.debris.deuterium, p.debris.requiredShips] : null, p.canPhalanx ? 1 : 0, p.canMissile ? 1 : 0,
        // GALAXYZ extras appended last, so older compact rows still expand
        p.own !== undefined || p.allianceRelation ? [p.own ? 1 : 0, p.allianceRelation || null] : null])),
      ...(sys.engine ? { e: sys.engine } : {}), ...(sys.free && sys.free.length ? { f: sys.free } : {}),
    };
  }
  function expand(g, s, c) {
    if (!c) return null;
    return {
      galaxy: g, system: s, colonized: c.c, expeditionDebris: c.x || null, t: c.t, me: null, ...(c.e ? { engine: c.e, free: c.f || [] } : {}),
      positions: (c.p || []).map((a) => {
        const p = {};
        F.forEach((k, i) => { p[k] = a[i]; });
        p.coords = `${g}:${s}:${p.position}`;
        const m = a[F.length], d = a[F.length + 1];
        p.moon = m ? { id: m[0], name: m[1], size: m[2], destroyed: m[3], activity: m[4] } : null;
        p.debris = d ? { metal: d[0], crystal: d[1], deuterium: d[2], requiredShips: d[3] } : null;
        p.canPhalanx = !!a[F.length + 2]; p.canMissile = !!a[F.length + 3];
        const x = a[F.length + 4];
        if (x) { p.own = !!x[0]; p.allianceRelation = x[1] || null; }
        return p;
      }),
    };
  }
  galaxy._compact = compact;
  galaxy._expand = expand;

  async function remember(sys) {
    if (!sys) return;
    await OGX.storage.update('galaxy.g' + sys.galaxy, (o) => Object.assign({}, o || {}, { [sys.system]: compact(sys) }), {}, SRV);
    await indexSystem(sys);
  }
  galaxy.cached = async function (g, s) {
    const all = await OGX.storage.get('galaxy.g' + g, null, SRV);
    return all ? expand(+g, +s, all[s]) : null;
  };

  // ------------------------------------------------------------------ player index
  // Key = numeric id; GALAXYZ rows without an id (own rows, [INFERRED] foreign markup missing) are keyed 'n:<name>' until
  // an id for that name is seen (foreign row, page=tournament), then the name entry is merged into the id entry.
  const playerKey = (id, name) => (id !== null && id !== undefined ? String(id) : name ? 'n:' + name : null);
  const newEntry = (id, name) => ({ id: id ?? null, name: name || null, status: '', rank: null, allianceId: null, allianceTag: null, planets: [], homeCoords: null, points: null, t: null });
  const coordKey = (c) => (OGX.util.coordsArr(c) || []).map((n) => String(n).padStart(3, '0')).join(':');
  /** idx[key] for (id, name), moving a name-keyed entry under its id once the id is known. */
  function entryFor(idx, id, name) {
    const key = playerKey(id, name);
    if (!key) return null;
    const byName = name ? idx['n:' + name] : null;
    if (byName && key !== 'n:' + name) {
      const merged = Object.assign(newEntry(id, name), byName, idx[key] || {});
      const seen = new Set((merged.planets || []).map((x) => x.coords));
      merged.planets = (merged.planets || []).concat((byName.planets || []).filter((x) => !seen.has(x.coords)));
      delete idx['n:' + name];
      idx[key] = merged;
    }
    const e = idx[key] = Object.assign(newEntry(id, name), idx[key] || {});
    if (id !== null && id !== undefined) e.id = id;
    return e;
  }
  galaxy._playerKey = playerKey;
  async function indexSystem(sys) {
    const here = `${sys.galaxy}:${sys.system}:1`;
    await OGX.storage.update('galaxy.players', (o) => {
      const idx = Object.assign({}, o || {});
      // drop planets of this system that their recorded owner no longer has
      for (const [k, e] of Object.entries(idx)) {
        if (!e || !Array.isArray(e.planets)) continue;
        e.planets = e.planets.filter((x) => !OGX.util.sameSystem(x.coords, here)
          || sys.positions.some((q) => q.coords === x.coords && (playerKey(q.playerId, q.playerName) === k || (q.playerId !== null && q.playerId !== undefined && q.playerId === e.id))));
      }
      for (const p of sys.positions) {
        const e = entryFor(idx, p.playerId ?? null, p.playerName);
        if (!e) continue;
        Object.assign(e, { name: p.playerName || e.name, status: p.status, rank: p.rank ?? e.rank, allianceId: p.allianceId, allianceTag: p.allianceTag, allianceName: p.allianceName ?? (p.allianceId === e.allianceId ? e.allianceName ?? null : null), t: sys.t });
        const planets = (e.planets || []).filter((x) => x.coords !== p.coords);
        planets.push({ coords: p.coords, planetId: p.planetId, moonId: p.moon ? p.moon.id : null, lastSeenT: sys.t });
        planets.sort((x, y) => coordKey(x.coords).localeCompare(coordKey(y.coords)));
        e.planets = planets;
      }
      return idx;
    }, {}, SRV);
  }
  /** GALAXYZ page=tournament -> id <-> name directory (no rank/points/alliance there). */
  galaxy.indexTournament = async function (tour) {
    const rows = tour && tour.boards ? [].concat(...tour.boards.map((b) => b.rows)) : [];
    if (!rows.some((r) => r.playerId && r.name)) return;
    const T = OGX.time.serverNow();
    await OGX.storage.update('galaxy.players', (o) => {
      const idx = Object.assign({}, o || {});
      for (const r of rows) {
        if (!r.playerId || !r.name) continue;   // some players have an empty name: nothing to link
        const e = entryFor(idx, r.playerId, r.name);
        e.name = r.name;
        e.t = Math.max(+e.t || 0, T);
      }
      return idx;
    }, {}, SRV);
  };
  /** Highscore rows (parse.highscorePlayers) -> player index (points, rank, home coords). */
  galaxy.indexHighscore = async function (hs) {
    if (!hs || !hs.rows || !hs.rows.length) return;
    const T = OGX.time.serverNow();
    await OGX.storage.update('galaxy.players', (o) => {
      const idx = Object.assign({}, o || {});
      for (const r of hs.rows) {
        if (!r.id) continue;
        const e = entryFor(idx, r.id, r.name);
        e.name = r.name;
        if (hs.type === 0 || hs.type === undefined || hs.type === null) { e.points = r.points; e.rank = r.rank; }
        if (r.homeCoords) e.homeCoords = r.homeCoords;
        if (r.allianceId !== undefined) {
          // GALAXYZ statistics show alliance NAMES, not tags (allianceTag undefined): keep a tag learned from the galaxy unless the alliance changed
          if (r.allianceTag !== undefined) e.allianceTag = r.allianceTag;
          else if (r.allianceId !== e.allianceId) e.allianceTag = null;
          e.allianceId = r.allianceId;
          if (r.allianceName !== undefined) e.allianceName = r.allianceName;
        }
        e.t = Math.max(+e.t || 0, T);
      }
      return idx;
    }, {}, SRV);
  };
  /** PlayerEntry by numeric id, or by name (GALAXYZ: own player and rows without an id). */
  galaxy.player = async function (idOrName) {
    const idx = (await OGX.storage.get('galaxy.players', {}, SRV)) || {};
    if (idOrName === null || idOrName === undefined || idOrName === '') return null;
    if (idx[idOrName]) return idx[idOrName];
    if (typeof idOrName === 'string' && !/^\d+$/.test(idOrName)) {
      const name = idOrName.replace(/^n:/, '');
      return idx['n:' + name] || Object.values(idx).find((e) => e && e.name === name) || null;
    }
    return null;
  };
  galaxy.players = async function ({ nameLike } = {}) {
    const idx = (await OGX.storage.get('galaxy.players', {}, SRV)) || {};
    let list = Object.values(idx);
    if (nameLike) { const n = String(nameLike).toLowerCase(); list = list.filter((p) => p.name && p.name.toLowerCase().includes(n)); }
    return list.sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
  };

  // ------------------------------------------------------------------ fetch / scan
  /** Own numeric player id: the boot snapshot (sync) or the stored player (state.player() is async). null on GALAXYZ until learned. */
  async function ownId() {
    try { const sn = OGX.state.snapshot && OGX.state.snapshot(); if (sn && sn.player && sn.player.id) return sn.player.id; } catch (e) { /* no snapshot */ }
    try { const p = await OGX.state.player(); return p && p.id ? p.id : null; } catch (e) { return null; }
  }
  galaxy._ownId = ownId;
  /**
   * GALAXYZ: GET ?page=galaxy&galaxy=G&system=S (never with cp: it would switch the session's planet). Every foreign system view
   * costs deuterium on the server (galaxy.md §0.8): call it on a user action or from a scan the user started.
   */
  async function fetchGz(g, s, background) {
    const r = await OGX.http.get('galaxy', { query: { galaxy: g, system: s }, cp: null, noCp: true, expect: 'text', background });
    if (!r.ok) return { error: r.error || 'http ' + r.status, status: r.status, stoppedBy: r.loggedOut ? 'auth' : 'http' };
    const doc = new DOMParser().parseFromString(r.text || '', 'text/html');
    const sys = galaxy.parseGz(doc, { playerId: await ownId() });
    if (!sys) {
      let msg = null;
      try { msg = OGX.parse.gz.infoMessage(doc); } catch (e) { msg = null; }
      // "You dont have enough deuterium to view the galaxy" [UPSTREAM ShowGalaxyPage.class.php:56-67]
      const stoppedBy = /deuter|дейтер/i.test(msg || '') ? 'deuterium' : /vacation|отпуск/i.test(msg || '') ? 'vacation' : 'http';
      return { error: msg || 'parse', status: r.status, stoppedBy };
    }
    return sys;
  }

  /** GALAXYZ: true = system views cost deuterium (amount unknown on ogamex.eu, galaxy.md open question #3). */
  galaxy.viewCostsDeuterium = () => OGX.page.isGz();
  const COST_REFUSAL = 'galaxy view costs deuterium on GALAXYZ: only on a user action (pass userStarted: true)';
  /**
   * galaxy.fetch(g, s, { background=true, userStarted=false }) -> ParsedSystem | { error, status?, stoppedBy }
   * GALAXYZ: without userStarted: true nothing is sent -> { error, stoppedBy: 'cost', costsDeuterium: true }.
   * stoppedBy: 'cost' (guard) | 'deuterium' (server: not enough deuterium) | 'vacation' | 'auth' | 'http'.
   */
  galaxy.fetch = async function (g, s, { background = true, userStarted = false } = {}) {
    if (OGX.page.isGz()) {
      if (userStarted !== true) return { error: COST_REFUSAL, stoppedBy: 'cost', costsDeuterium: true };
      const sys = await fetchGz(g, s, background);
      if (sys.error) return sys;
      await remember(sys);
      emitSystem({ system: sys, source: 'scan' });
      return sys;
    }
    const r = await OGX.api.galaxy(g, s, { background });
    if (r.error) {
      const stoppedBy = r.status === 403 ? 'vacation' : (r.loggedOut || r.status === 401 || r.status === 419) ? 'auth' : 'http';
      return { error: r.error, status: r.status, stoppedBy };
    }
    const sys = galaxy.parseSystem(r.json);
    if (!sys) return { error: 'parse', stoppedBy: 'http' };
    await remember(sys);
    emitSystem({ system: sys, source: 'scan' });
    return sys;
  };

  const scanTimes = [];
  let scanning = false;
  /**
   * galaxy.scan([[g, s]], { delayMs, jitterMs=300, maxPerHour, onSystem, signal, userStarted=false, confirm=false })
   *   -> { done, stoppedBy: null|'busy'|'abort'|'limit'|'cost'|'cancel'|'deuterium'|'auth'|'vacation'|'http' }
   * GALAXYZ: each system costs deuterium. Without userStarted: true -> { done: 0, stoppedBy: 'cost' } and no request
   * (a scheduler/auto-scan must not run on GALAXYZ unless the user confirmed it). confirm: true asks first with
   * OGX.dom.confirm (number of systems, deuterium warning); declined -> stoppedBy 'cancel'.
   */
  galaxy.scan = async function (systems, { delayMs, jitterMs = 300, maxPerHour, onSystem, signal, userStarted = false, confirm = false } = {}) {
    systems = Array.isArray(systems) ? systems : [];
    if (OGX.page.isGz()) {
      if (userStarted !== true) return { done: 0, stoppedBy: 'cost' };
      if (confirm && systems.length) {
        let ok = false;
        try {
          ok = await OGX.dom.confirm(`Просмотр ${systems.length} ${OGX.fmt.plural(systems.length, ['системы', 'систем', 'систем'])} галактики. ` +
            'На этом сервере каждый просмотр чужой системы стоит дейтерий (списывается с текущей планеты). Продолжить?', { okLabel: 'Сканировать', title: 'Сканирование галактики' });
        } catch (e) { ok = false; }
        if (!ok) return { done: 0, stoppedBy: 'cancel' };
      }
    }
    if (scanning) return { done: 0, stoppedBy: 'busy' };
    const lock = await OGX.storage.lock('galaxyScan', 120000);
    if (!lock) return { done: 0, stoppedBy: 'busy' };
    scanning = true;
    const delay = delayMs !== undefined ? delayMs : (+OGX.settings.get('core.galaxyScanDelayMs') || 700);
    const perHour = maxPerHour !== undefined ? maxPerHour : (+OGX.settings.get('core.galaxyScanPerHour') || 300);
    let done = 0;
    let stoppedBy = null;
    try {
      for (let i = 0; i < systems.length; i++) {
        const [g, s] = systems[i];
        if (signal && signal.aborted) { stoppedBy = 'abort'; break; }
        const now = Date.now();
        while (scanTimes.length && now - scanTimes[0] > 3600000) scanTimes.shift();
        if (scanTimes.length >= perHour) { stoppedBy = 'limit'; break; }
        scanTimes.push(now);
        const r = await galaxy.fetch(g, s, { background: true, userStarted: true });
        if (r.error) { stoppedBy = r.stoppedBy || 'http'; break; }
        done++;
        if (onSystem) OGX.safe(onSystem, 'galaxy:scan:onSystem')(r);
        if (i % 10 === 9) lock.refresh().catch(() => {});
        if (i < systems.length - 1) await OGX.util.sleep(delay + Math.random() * jitterMs);
      }
    } finally {
      scanning = false;
      await lock.release();
    }
    return { done, stoppedBy };
  };

  // ------------------------------------------------------------------ page integration
  galaxy.current = function () {
    if (OGX.page.isGz()) {
      const h = gz.header(document);
      return h.galaxy && h.system ? { galaxy: h.galaxy, system: h.system } : null;
    }
    const g = document.getElementById('galaxy_input'), s = document.getElementById('system_input');
    if (!g || !s) return null;
    const gv = parseInt(g.value, 10), sv = parseInt(s.value, 10);
    return Number.isFinite(gv) && Number.isFinite(sv) ? { galaxy: gv, system: sv } : null;
  };
  /**
   * Module slot in a galaxy row. OgameX: appended to #galaxyRowN. GALAXYZ: rows have 8 (free) or 11 cells and no ids, so no <td>
   * is added (galaxy.md §5): the slot goes into td.action (occupied) or the last cell (free).
   */
  galaxy.rowSlot = function (rowEl, owner) {
    if (!rowEl) return null;
    let host = rowEl;
    if (rowEl.tagName === 'TR') host = rowEl.querySelector('td.action') || rowEl.lastElementChild || rowEl;
    let el = Array.from(host.children).find((c) => c.classList && c.classList.contains('ogx-gx-slot') && c.dataset.owner === owner);
    if (!el) {
      el = OGX.dom.h('span', { class: 'ogx-gx-slot', dataset: { owner } });
      host.appendChild(el);
    }
    return el;
  };
  galaxy.headerSlot = function (owner) {
    const host = OGX.page.isGz() ? document.querySelector('#galaxytableHead tr.info_header > td') : document.querySelector('#galaxyHeader .systembuttons');
    if (!host) return null;
    let el = host.querySelector(`.ogx-gx-header[data-owner="${CSS.escape(owner)}"]`);
    if (!el) {
      el = OGX.dom.h('span', { class: 'ogx-gx-header', dataset: { owner } });
      host.appendChild(el);
    }
    return el;
  };
  function rowsMap() {
    const m = new Map();
    if (OGX.page.isGz()) {
      Array.from(document.querySelectorAll('#galaxytableHead > tbody > tr.row')).forEach((tr, i) => {
        const p = gzInt(gzText(tr.querySelector('td.position'))) || i + 1;
        m.set(p, tr);
      });
      return m;
    }
    for (let p = 1; p <= 15; p++) { const el = document.getElementById('galaxyRow' + p); if (el) m.set(p, el); }
    return m;
  }
  galaxy._rowsMap = rowsMap;
  /** Rows of the galaxy table on this page: Map<position 1..15, Element> (GALAXYZ tr.row, OgameX #galaxyRowN); empty elsewhere. */
  galaxy.rows = () => (OGX.page.is('galaxy') ? rowsMap() : new Map());
  /** Is a galaxy position (galaxy:system positions[]) the user's own? The row's own flag (GALAXYZ marks it), else the player id
   * (snapshot metas / player, storage identity, or me.id) or, for a row without id, the player name (GALAXYZ identity).
   * me = optional { id, name } the caller already knows (e.g. the stored state.player()). */
  galaxy.isOwnRow = function (p, me) {
    if (!p) return false;
    if (p.own === true) return true;
    let id = me && +me.id > 0 ? +me.id : null, name = (me && me.name) || null;
    try {
      const s = OGX.state.snapshot();
      if (s && s.metas && +s.metas.playerId) id = id || +s.metas.playerId;
      if (s && s.player) { id = id || +s.player.id || null; name = name || s.player.name || null; }
    } catch (e) { /* no snapshot */ }
    if (!id && OGX.storage.ns && +OGX.storage.ns.playerId) id = +OGX.storage.ns.playerId;
    if (id && +p.playerId === id) return true;
    return !!(name && !(+p.playerId > 0) && p.playerName === name);
  };

  // Last galaxy:system / galaxy:render of this page, replayed to late subscribers (modules init after galaxy.init has
  // already emitted on GALAXYZ, where the page itself is the system).
  const last = { system: null, render: null };
  function emitSystem(ev) { last.system = ev; OGX.bus.emit('galaxy:system', ev); }
  function emitRender(ev) { last.render = ev; OGX.bus.emit('galaxy:render', ev); }
  function subscribeReplay(event, key, fn, replay) {
    const off = OGX.bus.on(event, fn);
    if (replay !== false && last[key]) {
      const ev = last[key];
      const safe = OGX.safe(fn, 'galaxy:' + key + ':replay');
      Promise.resolve().then(() => safe(Object.assign({ replay: true }, ev)));
    }
    return off;
  }
  /** galaxy.onSystem(fn, { replay=true }) -> off. Like bus.on('galaxy:system') + the last event of this page (payload.replay = true). */
  galaxy.onSystem = (fn, { replay = true } = {}) => subscribeReplay('galaxy:system', 'system', fn, replay);
  /** galaxy.onRender(fn, { replay=true }) -> off. Like bus.on('galaxy:render') + the last render of this page (rows re-read now). */
  galaxy.onRender = (fn, { replay = true } = {}) => {
    const off = OGX.bus.on('galaxy:render', fn);
    if (replay !== false && last.render) {
      const ev = Object.assign({}, last.render, { rows: rowsMap(), replay: true });
      const safe = OGX.safe(fn, 'galaxy:render:replay');
      Promise.resolve().then(() => safe(ev));
    }
    return off;
  };
  /** Last galaxy:system / galaxy:render payload of this page (null before). */
  galaxy.last = (what = 'system') => last[what === 'render' ? 'render' : 'system'];
  let pageSys = null;
  let pageReadyResolve;
  /** Promise -> ParsedSystem of the galaxy page this tab shows (GALAXYZ: parsed at boot; OgameX: the first /ajax/galaxy), null elsewhere. */
  galaxy.pageSystem = new Promise((r) => { pageReadyResolve = r; });
  galaxy._emitSystem = emitSystem;

  /** GALAXYZ: the page itself is the system (server-rendered, read once at boot); page=tournament feeds the id <-> name index. */
  async function initGz() {
    const raw = String((OGX.page.info() || {}).raw || '').toLowerCase();
    if (raw === 'tournament') { pageReadyResolve(null); await galaxy.indexTournament(gz.tournament(document)); return; }
    if (OGX.page.is('highscore')) {   // page=statistics viewed by the user: points / rank / alliance into the player index [UPSTREAM markup]
      pageReadyResolve(null);
      try { await galaxy.indexHighscore(OGX.parse.highscorePlayers(document)); } catch (e) { log.warn('statistics page not indexed', e && e.message); }
      return;
    }
    if (!OGX.page.is('galaxy')) { pageReadyResolve(null); return; }
    const sys = galaxy.parseGz(document, { playerId: await ownId() });
    pageSys = sys;
    pageReadyResolve(sys);
    if (!sys) return;
    // events first (replayed to modules that subscribe later), storage after: a slow store never delays the page modules
    emitSystem({ system: sys, source: 'page' });
    emitRender({ galaxy: sys.galaxy, system: sys.system, rows: rowsMap() });
    await remember(sys);
  }

  galaxy.init = function () {
    if (OGX.page.isGz()) return initGz().catch((e) => log.warn('galaxy page not stored', e && e.message));
    OGX.bridge.onXhr(/^\/ajax\/galaxy$/, async (x) => {
      if (x.status === 403 || !x.json) return;
      const sys = galaxy.parseSystem(x.json);
      if (!sys) return;
      await remember(sys);
      if (!pageSys) { pageSys = sys; pageReadyResolve(sys); }
      emitSystem({ system: sys, source: 'page' });
      if (!OGX.page.is('galaxy')) return;
      // the relay fires after the game's render callback: clean stale slots, repair, then announce the render
      const rows = rowsMap();
      for (const el of rows.values()) for (const slot of Array.from(el.querySelectorAll(':scope > .ogx-gx-slot'))) slot.remove();
      const destroyed = sys.positions.filter((p) => p.destroyed || (p.moon && p.moon.destroyed)).map((p) => p.position);
      let repair = true;
      try { repair = OGX.settings.get('core.galaxyRepair') !== false; } catch (e) { repair = true; }
      if (destroyed.length && repair) {
        const from = Math.min(...destroyed) + 1;
        try { await OGX.bridge.call('galaxy.repair', from); } catch (e) { log.warn('repair failed', e.message || e); }
      }
      emitRender({ galaxy: sys.galaxy, system: sys.system, rows });
    });
    OGX.bridge.onXhr(/^\/ajax\/highscore$/, (x) => {
      if (x.status !== 200 || !x.responseText) return;
      const cat = +(x.form.category || x.query.category || 1);
      if (cat !== 1) return;
      galaxy.indexHighscore(OGX.parse.highscorePlayers(x.responseText));
    });
    if (!OGX.page.is('galaxy')) pageReadyResolve(null);
    if (OGX.page.is('highscore')) {
      OGX.safe(() => galaxy.indexHighscore(OGX.parse.highscorePlayers(document)), 'galaxy:highscorePage')();
    }
  };
})(window.OGX);
