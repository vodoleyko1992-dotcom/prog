/* shared/core/09-catalog.js — object catalog lookups over the generated OGX.catalog._data (GALAXYZ elements). Owner: core. */
(function (OGX) {
  'use strict';
  const catalog = (OGX.catalog = OGX.catalog || {});
  let byKey = null;

  function index() {
    if (byKey) return byKey;
    byKey = new Map();
    for (const o of catalog._data || []) {
      byKey.set(o.id, o);
      byKey.set(String(o.id), o);
      byKey.set(o.machine, o);
      byKey.set(o.className, o);
    }
    return byKey;
  }

  catalog.get = (k) => (k === null || k === undefined ? null : index().get(typeof k === 'number' ? k : String(k)) || index().get(+k) || null);

  // Ship order for tables (ids ascending; the shipyard page itself lists 208 220 202 203 ...). 212 Solar Satellite never flies.
  catalog.shipIds = [202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220];
  catalog.fleetShipIds = catalog.shipIds.filter((id) => id !== 212);
  catalog.defenseIds = [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 502, 503];
  // Aeternum (user decision 2026-10-31): every transport calculation (collect, raids, needed ships, techcost, expeditions)
  // counts in Battle Transporters, RU «Улучшенный транспорт» (217). Modules read this id instead of 202/203.
  catalog.transportShip = 217;
  catalog.civilShipIds = [202, 203, 208, 209, 210, 212, 217, 219, 220];
  // page=research order [REAL research.html].
  catalog.researchIds = [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199];
  catalog.officerIds = [601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615];
  catalog.boostIds = [701, 702, 703, 704, 705, 706, 707];
  // page=buildings order [REAL buildings.html], split like OgameX into resource buildings and stations; moon buildings last.
  const RESOURCE_BUILDINGS = [1, 2, 3, 4, 12, 22, 23, 24];
  const STATIONS = [6, 14, 15, 21, 31, 33, 34, 44, 71, 72, 73, 41, 42, 43];

  /** Building ids (resource buildings then stations) available on 'planet' or 'moon'; no argument = all. */
  catalog.buildingIds = function (planetType) {
    const all = RESOURCE_BUILDINGS.concat(STATIONS);
    if (!planetType) return all;
    return all.filter((id) => { const o = catalog.get(id); return o && (o.planetType === 'both' || o.planetType === planetType); });
  };

  /** Objects of a type ('building'|'station'|'research'|'ship'|'defense'|'officer'|'boost') in game order;
   *  no type = buildings, stations, research, ships and defence (officers and boosts only when asked for). */
  catalog.list = function (type) {
    const order = {
      building: RESOURCE_BUILDINGS, station: STATIONS, research: catalog.researchIds, ship: catalog.shipIds, defense: catalog.defenseIds,
      officer: catalog.officerIds, boost: catalog.boostIds,
    };
    const types = type ? [type] : ['building', 'station', 'research', 'ship', 'defense'];
    const out = [];
    for (const t of types) {
      const ids = order[t] || [];
      for (const id of ids) { const o = catalog.get(id); if (o && o.type === t) out.push(o); }
      for (const o of catalog._data || []) if (o.type === t && !ids.includes(o.id)) out.push(o);
    }
    return out;
  };

  let titleIndex = null;
  function normTitle(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  /** Localized object title -> id. Stored server titles (OGX.state titles) first, then English and Russian catalog names. */
  catalog.idFromTitle = function (title) {
    const t = normTitle(title);
    if (!t) return null;
    try {
      const stored = OGX.state && typeof OGX.state.titlesSync === 'function' ? OGX.state.titlesSync() : null;
      if (stored) for (const [k, v] of Object.entries(stored)) if (normTitle(k) === t) return +v;
    } catch (e) { /* state not ready */ }
    if (!titleIndex) {
      titleIndex = new Map();
      for (const o of catalog._data || []) {
        for (const n of [o.en, o.ru, o.ruShort, o.machine, o.className]) if (n && !titleIndex.has(normTitle(n))) titleIndex.set(normTitle(n), o.id);
      }
    }
    return titleIndex.has(t) ? titleIndex.get(t) : null;
  };

  catalog.name = (id) => { const o = catalog.get(id); return o ? o.ru : String(id); };
  catalog.shortName = (id) => { const o = catalog.get(id); return o ? o.ruShort || o.ru : String(id); };

  // 2Moons mission ids (specs/galaxyz/fleet.md §3.1). 11 = dark matter expedition to an own moon (only ship 220).
  const MISSIONS = {
    1: 'Атака', 2: 'САБ-атака', 3: 'Транспорт', 4: 'Оставить', 5: 'Держать', 6: 'Шпионаж', 7: 'Колонизация',
    8: 'Переработка', 9: 'Уничтожение луны', 10: 'Ракетная атака', 11: 'Добыча ТМ', 15: 'Экспедиция',
  };
  catalog.missions = MISSIONS;
  catalog.missionName = (m) => MISSIONS[+m] || ('Миссия ' + m);
  catalog._resetIndex = () => { byKey = null; titleIndex = null; };
})(window.OGX);
