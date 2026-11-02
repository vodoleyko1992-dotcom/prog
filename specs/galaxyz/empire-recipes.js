// GZEmpire: copy-paste parsers for the GALAXYZ (ogamex.eu, 2Moons fork) empire / resources / officier pages.
// No dependencies. Every function takes a Document (live `document` or a DOMParser document from a background fetch).
// Spec: specs/galaxyz/empire.md. Verified by tools/run_empire_snippets.js against eu/pages/*.html (JS disabled).
(function (root) {
  'use strict';

  // "1.559.340.984" -> 1559340984, "-14.214" -> -14214, "1,5" -> 1.5. Not for short forms ("3.417 M").
  function num(s) {
    const t = String(s == null ? '' : s).replace(/\u00a0/g, ' ').trim().replace(/\./g, '').replace(',', '.');
    const m = t.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  // Element ids in the order the server prints the imperium rows (2Moons $reslist order = ascending id) [REAL imperium.html].
  const IMPERIUM_SECTIONS = [
    { key: 'resources', ids: [901, 902, 903, 911] },
    { key: 'buildings', ids: [1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44, 71, 72, 73] },
    { key: 'research', ids: [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199] },
    { key: 'ships', ids: [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220] },
    { key: 'defense', ids: [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411] },
  ];

  // page=imperium -> { columns: [{ cp, name, coords, fieldsUsed, fieldsMax, image }], bodies: { cp: {...} }, research, totals, warnings }
  function parseImperium(doc) {
    doc = doc || document;
    const table = doc.querySelector('table.empire');
    if (!table) return null;
    const rows = [...table.rows];
    const cells = tr => [...tr.cells].map(td => td);
    // Header rows: [0] th "Empire", [1] images+links, [2] names, [3] coords, [4] fields.
    const columns = cells(rows[1]).slice(2).map(td => {
      const a = td.querySelector('a[href*="cp="]');
      const img = td.querySelector('img');
      return { cp: Number((a.getAttribute('href').match(/[?&]cp=(\d+)/) || [])[1]),
        image: img ? (img.getAttribute('src').match(/s_([a-z]+\d*)\./i) || [])[1] || null : null };
    });
    cells(rows[2]).slice(2).forEach((td, i) => { columns[i].name = td.textContent.trim(); });
    cells(rows[3]).slice(2).forEach((td, i) => {
      columns[i].coords = (td.textContent.match(/\[(\d+):(\d+):(\d+)\]/) || []).slice(1).map(Number);
    });
    cells(rows[4]).slice(2).forEach((td, i) => {
      const m = td.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      columns[i].fieldsUsed = m ? +m[1] : null; columns[i].fieldsMax = m ? +m[2] : null;
    });

    const bodies = {}, research = {}, totals = {}, warnings = [];
    for (const c of columns) bodies[c.cp] = { cp: c.cp, name: c.name, coords: c.coords, fieldsUsed: c.fieldsUsed, fieldsMax: c.fieldsMax,
      resources: {}, buildings: {}, ships: {}, defense: {} };

    // Sections: every later <th> row starts the next section, in the fixed server order (language independent).
    let sec = -1, idx = 0;
    for (const tr of rows.slice(5)) {
      if (tr.querySelector('th')) { sec++; idx = 0; continue; }
      const s = IMPERIUM_SECTIONS[sec];
      const tds = cells(tr);
      if (!s) { warnings.push('extra section row: ' + tds[0].textContent.trim()); continue; }
      const id = s.ids[idx++];
      if (id == null) { warnings.push(s.key + ': unknown extra row ' + tds[0].textContent.trim()); continue; }
      totals[id] = num(tds[1].textContent);              // sum over planets; for research the level itself
      if (s.key === 'research') { research[id] = num(tds[2] ? tds[2].textContent : tds[1].textContent); continue; }
      tds.slice(2).forEach((td, i) => { bodies[columns[i].cp][s.key][id] = num(td.textContent); });
    }
    IMPERIUM_SECTIONS.forEach((s, i) => { if (i > sec) warnings.push('missing section ' + s.key); });
    return { columns, bodies, research, totals, warnings };
  }

  // page=resources -> production table of the CURRENT planet (the one selected in #planetSelector).
  function parseResources(doc) {
    doc = doc || document;
    const form = doc.querySelector('form#resourceSettings') || doc.querySelector('form[action*="page=resources"]');
    const table = form && form.querySelector('table.listOfResourceSettingsPerPlanet, table');
    if (!table) return null;
    const RES = [901, 902, 903, 911];
    const vals = tr => { const tds = [...tr.cells]; const o = {}; RES.forEach((r, i) => { o[r] = num(tds[1 + i].textContent); }); return o; };
    const rows = [...table.rows].filter(tr => tr.cells.length >= 5 && !tr.querySelector('th'));
    const firstSel = rows.findIndex(tr => tr.querySelector('select[name^="prod["]'));
    const lastSel = rows.length - 1 - [...rows].reverse().findIndex(tr => tr.querySelector('select[name^="prod["]'));
    const producers = rows.filter(tr => tr.querySelector('select[name^="prod["]')).map(tr => {
      const sel = tr.querySelector('select[name^="prod["]');
      const opt = sel.querySelector('option[selected]') || sel.options[sel.selectedIndex];
      const label = tr.cells[0].textContent.trim();
      return { id: +sel.name.match(/\[(\d+)\]/)[1], label, level: num((label.match(/\(([^)]*)\)\s*$/) || [])[1]),
        percent: Number(opt.value) * 10, prod: vals(tr) };
    });
    // Fixed order (template): basic, producers..., bonus, storage, total, daily, weekly.
    const after = firstSel < 0 ? rows.slice(1) : rows.slice(lastSel + 1);
    const opt = doc.querySelector('#planetSelector option[selected]') || doc.querySelector('#planetSelector option');
    return {
      cp: opt ? +opt.value : null,
      header: (doc.querySelector('#planet h2') || {}).textContent || null,
      basic: vals(rows[0]),
      producers,
      bonus: vals(after[0]),
      storageShort: [...after[1].cells].slice(1, 4).map(td => td.textContent.replace(/\u00a0/g, ' ').trim()),
      total: vals(after[2]),     // 901-903 per hour incl. basic+bonus; 911 = FREE energy (production - consumption)
      daily: vals(after[3]),
      weekly: vals(after[4]),
      form: { action: form.getAttribute('action'), method: form.getAttribute('method'),
        hidden: [...form.querySelectorAll('input[type=hidden]')].map(i => i.name + '=' + i.value) },
    };
  }

  // Exact amount/storage/production of the current planet from the inline resourceTicker({...}) calls (every full page).
  function ticker(doc) {
    doc = doc || document;
    const src = [...doc.scripts].map(s => s.textContent).join('\n'), out = {};
    for (const m of src.matchAll(/resourceTicker\(\{\s*available:\s*\(([-\d.eE+]+)\),\s*limit:\s*\[0,\s*"([-\d.eE+]+)"\],\s*production:\s*([-\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g))
      out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
    return out;
  }

  // page=officier -> { darkMatter, officers: [{ id, name, level, max, locked }] }
  function parseOfficier(doc) {
    doc = doc || document;
    const list = doc.querySelector('#offList');
    if (!list) return null;
    const dm = list.querySelector('#button_rpg_darkMatter .level');
    const officers = [...list.querySelectorAll('a[data-technology]')].map(a => {
      const box = a.closest('.officers100');
      const m = a.querySelector('.level').textContent.trim().match(/(\d+)\s*\/\s*(\d+)/);
      return { id: +a.dataset.technology, name: a.getAttribute('title'), level: m ? +m[1] : null, max: m ? +m[2] : null,
        locked: !!(box && box.getAttribute('data-status') === 'off') };
    });
    return { darkMatter: dm ? num(dm.textContent) : null, officers };
  }

  // Officer bonus per level [UPSTREAM install/install.sql:1018-1032, vars.bonus* columns]; unit 'abs' = absolute, else fraction.
  const OFFICER_BONUS = {
    601: { Resource: 0.05 },                                   // Geologist
    602: { Attack: 0.05, Defensive: 0.05, Shield: 0.05 },      // Admiral
    603: { Attack: 0.05, Defensive: 0.05, Energy: 0.05 },      // Engineer
    604: { ShipTime: -0.05 },                                  // Technocrat
    605: { BuildTime: -0.10 },                                 // Constructor
    606: { ResearchTime: -0.10 },                              // Scientologist
    607: { ShipStorage: 0.50 },                                // Storage expert
    608: { DefensiveTime: -0.25 },                             // Minister of Defence
    609: {},                                                   // Guardian
    610: { SpyPower: 0.35 },                                   // Spy
    611: { FleetSlots: 3 },                                    // Commander (absolute)
    612: {},                                                   // Destroyer
    613: { FlyTime: -0.10 },                                   // General
    614: {},                                                   // Emperor
    615: { Planets: 2 },                                       // Raider (absolute)
  };
  function officerFactors(officers) {
    const f = {};
    for (const o of officers) for (const [k, v] of Object.entries(OFFICER_BONUS[o.id] || {})) f[k] = (f[k] || 0) + v * o.level;
    for (const k in f) f[k] = Math.round(f[k] * 1e6) / 1e6;
    return f;
  }

  // Server constants of ogamex.eu/Aeternum DERIVED from the real resources page (see empire.md section 5).
  const SERVER = { resourceMultiplier: 22000, energySpeed: 1, storageMultiplier: 5, basicIncome: { 901: 20, 902: 10, 903: 0, 911: 0 } };

  // 2Moons production model (upstream vars.production*, class.PlanetRessUpdate.php:250-305), per hour.
  // p = { levels: {1,2,3,4,12,212,...}, percents: {id: 0..100}, tempMax, research: {113,131,132,133}, factor: { Resource, Energy } }
  function production(p, S) {
    S = S || SERVER;
    const L = id => p.levels[id] || 0, F = id => (p.percents[id] == null ? 100 : p.percents[id]) / 10;
    const g = (lv, f, fn) => (lv ? fn(lv, f) : 0);
    const raw = {
      1: { 901: g(L(1), F(1), (l, f) => 30 * l * 1.1 ** l * 0.1 * f), 911: g(L(1), F(1), (l, f) => -10 * l * 1.1 ** l * 0.1 * f) },
      2: { 902: g(L(2), F(2), (l, f) => 20 * l * 1.1 ** l * 0.1 * f), 911: g(L(2), F(2), (l, f) => -10 * l * 1.1 ** l * 0.1 * f) },
      3: { 903: g(L(3), F(3), (l, f) => 10 * l * 1.1 ** l * (-0.002 * p.tempMax + 1.28) * 0.1 * f), 911: g(L(3), F(3), (l, f) => -30 * l * 1.1 ** l * 0.1 * f) },
      4: { 911: g(L(4), F(4), (l, f) => 20 * l * 1.1 ** l * 0.1 * f) },
      12: { 903: g(L(12), F(12), (l, f) => -10 * l * 1.1 ** l * 0.1 * f), 911: g(L(12), F(12), (l, f) => 30 * l * (1.05 + (p.research[113] || 0) * 0.01) ** l * 0.1 * f) },
      212: { 911: g(L(212), F(212), (l, f) => (p.tempMax + 160) / 6 * 0.1 * f * l) },
    };
    const plus = { 901: 0, 902: 0, 903: 0, 911: 0 }, minus = { 901: 0, 902: 0, 903: 0, 911: 0 };
    for (const row of Object.values(raw)) for (const [r, v] of Object.entries(row)) (v > 0 ? plus : minus)[r] += v;
    const energy = Math.round(plus[911] * S.energySpeed * (1 + (p.factor.Energy || 0)));
    const used = minus[911] * S.energySpeed;
    const prodLevel = used !== 0 ? Math.min(1, energy / Math.abs(used)) : 0;
    const geo = { 901: 131, 902: 132, 903: 133 }, perHour = {};
    for (const r of [901, 902, 903])
      perHour[r] = (plus[r] * (1 + (p.factor.Resource || 0) + 0.02 * (p.research[geo[r]] || 0)) * prodLevel + minus[r]) * S.resourceMultiplier
        + S.basicIncome[r] * S.resourceMultiplier;
    return { perHour, energy: { production: energy, consumption: used, free: energy + used }, prodLevel };
  }

  // Storage capacity of one resource (upstream vars.storage90x = floor(2.5 * 1.8331954764^L) * 5000, PlanetRessUpdate.php:257,287).
  function storage(level, S) {
    S = S || SERVER;
    return Math.floor(2.5 * Math.pow(1.8331954764, level)) * 5000 * S.storageMultiplier;
  }

  root.GZEmpire = { num, IMPERIUM_SECTIONS, parseImperium, parseResources, ticker, parseOfficier, OFFICER_BONUS, officerFactors,
    SERVER, production, storage };
})(typeof window !== 'undefined' ? window : globalThis);
