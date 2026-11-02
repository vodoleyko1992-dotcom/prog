// R-empire: page=imperium (REAL GALAXYZ markup, falls back to the upstream page.empire.default.tpl table). JS-free, no deps.
// Returns { planets: [{ id, name, coords:{g,s,p}, fieldsUsed, fieldsMax, image, resources:{901,902,903,911}, levels:{id:n} }],
//           research: {id: level}, totals: {...}, sections: [...labels], unmapped: [...] }
(doc = document) => {
  // Row order = upstream $reslist order (vars sorted by elementID) [REAL imperium.html confirms all five lists].
  const ORDER = {
    resources: [901, 902, 903, 911],
    buildings: [1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44, 71, 72, 73],
    research: [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199],
    ships: [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220],
    defense: [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411],
  };
  // English labels seen on the REAL page (fallback when a fork adds/removes a row). Lang is a user setting: order first.
  const NAMES = { 'Metal': 901, 'Crystal': 902, 'Deuterium': 903, 'Energy': 911, 'Metal Mine': 1, 'Crystal Mine': 2, 'Deuterium Refinery': 3,
    'Solar Power plant': 4, 'University': 6, 'Deuterium Power Plant': 12, 'Robot Factory': 14, 'Nanite Factory': 15, 'Shipyard': 21,
    'Metal Storage': 22, 'Crystal Storage': 23, 'Deuterium Storage': 24, 'Research Lab': 31, 'Terraformer': 33, 'Alliance Depot': 34,
    'Moon base': 41, 'Phalax Sensor': 42, 'Jumpgate': 43, 'Missile Silo': 44, 'Light conveyor': 71, 'Average conveyor': 72, 'Heavy conveyor': 73,
    'Spy Technology': 106, 'Computer Technology': 108, 'Weapons Technology': 109, 'Shield Technology': 110, 'Armour Technology': 111,
    'Energy Technology': 113, 'Hyperspace Technology': 114, 'Combustion Engine': 115, 'Impulse Engine': 117, 'Hyperspace Engine': 118,
    'Laser Technology': 120, 'Ion Technology': 121, 'Plasma Technology': 122, 'Intergalactic Research Network': 123, 'Expedition Research': 124,
    'Mineral Research': 131, 'Semi-Crystals Research': 132, 'Fuel Research': 133, 'Graviton Research': 199, 'Light Cargo': 202, 'Heavy Cargo': 203,
    'Light Fighter': 204, 'Heavy Fighter': 205, 'Cruiser': 206, 'Battleship': 207, 'Colony Ship': 208, 'Recycler': 209, 'Spy Probe': 210,
    'Planet Bomber': 211, 'Solar Satellite': 212, 'Star Fighter': 213, 'Battle Fortress': 214, 'Battle Cruiser': 215, 'Black Moon': 216,
    'Battle Transporter': 217, 'Avatar': 218, 'Battle Recycler': 219, 'Dark Matter Collector': 220, 'Missile Launcher': 401,
    'Light Laser Turret': 402, 'Heavy Laser Turret': 403, 'Gauss Cannon': 404, 'Ion Cannon': 405, 'Plasma Cannon': 406, 'Small Shield Dome': 407,
    'Large Shield Dome': 408, 'Atmospheric Shield': 409, 'Gravitons Cannon': 410, 'Orbital Defence Platform': 411 };
  const num = (t) => { const s = (t || '').replace(/[^\d-]/g, ''); return s === '' || s === '-' ? null : +s; };   // "1.559.340.984" -> 1559340984
  const table = doc.querySelector('table.empire') ||                       // REAL: div.imparatorluk_tab.mainRS > table.empire.statList.list...
    [...doc.querySelectorAll('#content table, #inhalt table, table')].find((t) => t.querySelector('a[href*="page=overview"][href*="cp="] img'));
  if (!table) return null;
  const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')];
  const SECT = ['empire', 'resources', 'buildings', 'research', 'ships', 'defense'];
  let sect = -1; const groups = {}; const sections = [];
  for (const tr of rows) {
    const th = tr.querySelector(':scope > th');
    if (th) { sect++; sections.push(th.textContent.trim()); groups[SECT[sect] || 'extra' + sect] = []; continue; }
    const cells = [...tr.querySelectorAll(':scope > td')];
    if (cells.length) groups[SECT[sect] || 'extra' + sect].push(cells);
  }
  const head = groups.empire || [];
  const planetCells = (head[0] || []).slice(2);                          // row 0: label, Σ, one cell per body
  const planets = planetCells.map((td) => {
    const a = td.querySelector('a[href*="cp="]'); const img = td.querySelector('img');
    return { id: a ? +(/[?&]cp=(\d+)/.exec(a.getAttribute('href')) || [])[1] : null, image: img ? img.getAttribute('src') : null };
  });
  const col = (r, i) => (r || [])[i + 2];
  planets.forEach((p, i) => {
    p.name = (col(head[1], i)?.textContent || '').trim();
    const m = /\[(\d+):(\d+):(\d+)\]/.exec(col(head[2], i)?.textContent || '');
    p.coords = m ? { g: +m[1], s: +m[2], p: +m[3] } : null;
    const f = /(\d+)\s*\/\s*(\d+)/.exec(col(head[3], i)?.textContent || '');
    p.fieldsUsed = f ? +f[1] : null; p.fieldsMax = f ? +f[2] : null;   // fieldsMax = field_max + 5 x Terraformer + 3 x Moon base
    p.resources = {}; p.levels = {};
  });
  const unmapped = []; const research = {}; const totals = {};
  for (const key of ['resources', 'buildings', 'research', 'ships', 'defense']) {
    const list = groups[key] || []; const order = ORDER[key];
    list.forEach((cells, ri) => {
      const label = cells[0].textContent.trim();
      const id = NAMES[label] != null ? NAMES[label] : (list.length === order.length ? order[ri] : null);
      if (id == null) { unmapped.push(label); return; }
      totals[id] = num(cells[1].textContent);                             // Σ column; research: the level itself, not a sum
      if (key === 'research') { research[id] = num(cells[2]?.textContent); return; }   // same value repeated in every column
      planets.forEach((p, i) => { const v = num(cells[i + 2]?.textContent); (key === 'resources' ? p.resources : p.levels)[id] = v; });
    });
  }
  // energy row = PRODUCED energy incl. bonus (planet.energy), not the balance (ShowImperiumPage.class.php:88)
  return { planets, research, totals, sections, unmapped, currentPlanetFirst: true };
}
