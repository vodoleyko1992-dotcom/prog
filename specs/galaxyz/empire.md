# GALAXYZ (ogamex.eu) empire data: imperium, resources settings, officers, economy model

Target: `https://ogamex.eu/Aeternum/game.php?page=imperium|resources|officier`, engine `GALAXYZ 1.8.git` (2Moons fork).
Replaces the lanedirt-OgameX parts of `specs/CORE_API.md` (`parse.inlineResources`, `calc.production`, `calc.storageCapacity`) and the data source of `modules/infinity/empire` for GALAXYZ.
Detection, header resources, planet list, number formats in general: see `specs/galaxyz/layout.md` (not repeated here).

Tags: **[REAL x.html]** = seen in `eu/pages/x.html` (saved 2026-10-30, account with 4 planets, no moon). **[UPSTREAM file:line]** = `src/2Moons/` (paths relative to it), not seen live.
**[DERIVED]** = computed from REAL values by an UPSTREAM formula and checked to match. **[GUESS]** = neither.

Companion files (all in `specs/galaxyz/`):

| file | what |
|---|---|
| `empire-recipes.js` | `GZEmpire.*` browser JS, no deps: `num, IMPERIUM_SECTIONS, parseImperium, parseResources, ticker, parseOfficier, OFFICER_BONUS, officerFactors, SERVER, production, storage`. Works on `document` and on a `DOMParser` document. |
| `tools/run_empire_snippets.js` | loads the real pages in Chromium with page JS **disabled**, injects `empire-recipes.js`, runs every recipe of this document and the model check. All "Observed output" blocks below are copied from it. Run: `cd specs/galaxyz && NODE_PATH=$(npm root -g) node tools/run_empire_snippets.js [--only=imperium,model]` |

Save times of the three real pages (server wall clock, `serverTime`): officier 10:05:07, imperium 10:05:33, resources 10:05:40. **Between officier and imperium the player spent 3 375 DM (3 981 -> 606) and the energy bonus went from +15 % to +20 %** (header `t="438 / 47.480"` on officier.html, `t="2.502 / 49.544"` on imperium/resources). So officier.html does not exactly describe the state of the other two pages (see section 7, open questions).

---

## 1. URLs and actions

| what | request | params | response / effect | tag |
|---|---|---|---|---|
| Empire page | GET `game.php?page=imperium` | none (`cp=` optional, switches the active planet) | full page, `<body id="imperium" class="full">`, title `Empire - ...`, menu link `a.Imperium[href*="page=imperium"]` | [REAL imperium.html] |
| Resource settings page | GET `game.php?page=resources[&cp=ID]` | | full page for the **current** planet, `<body id="resources">`, menu link `a.Resources` | [REAL resources.html] |
| Change production % | POST `game.php?page=resources` | `mode=send`, `prod[<id>]=0..10` (10 = 100 %), one per producer; ids 1,2,3,4,12,212 (+ any producer with level > 0). **No token** (form has only `input[name=mode]`). | updates the current planet (`cp` of the session), then 302 to `game.php?page=resources`. Values outside 0..10 are ignored. Refused silently in vacation mode. | [REAL resources.html form] + [UPSTREAM includes/pages/game/ShowResourcesPage.class.php:27-65] |
| Officers page | GET `game.php?page=officier` | | full page, `<body id="officier">`, menu link `a.menubutton[href*="page=officier"]` | [REAL officier.html] |
| Officer details | GET `game.php?page=CommanderDetailsAjax&technology=<601..615>&type=undefined` | (`&dm=1` instead of `technology` for the DM tile) | JSON `{content:{...}, target}`; `content[target]` = HTML of the panel (bonus text, price, buy button). Body never captured. | [REAL officier.html inline script] |
| Buy officer level | POST `game.php?page=officier` | `id=<601..615>` (dmfunc 701..707 the same way) | +1 level if accessible, affordable and below max; silent no-op otherwise. GALAXYZ may add a token inside the AJAX panel form: **unverified**. | [UPSTREAM ShowOfficierPage.class.php:86-99] |

Pitfall, `cp=` is sticky: any request with `cp=<id>` (also a background `fetch`) sets the session's active planet for **all tabs** [UPSTREAM includes/classes/Session.class.php:291-310]. Never fetch `page=resources&cp=<other>` in the background just to read another planet; use the imperium + model (section 5), or restore with a request carrying the original `cp`.

---

## 2. Empire page (`page=imperium`) [REAL imperium.html]

### 2.1 Structure

`div.imparatorluk_tab.mainRS > table.empire.statList.list.listOfResourceSettingsPerPlanet > tbody > tr` (only one `table.empire` per page; no ids, no `data-*` on rows or cells). Columns: `td[0]` = row label (translated text), `td[1]` = Σ (total), `td[2..]` = one per body. `colspan = bodies + 2` (here `6`).

| row index | content | sample (first body column) |
|---|---|---|
| 0 | `<th colspan=6>Empire</th>` | |
| 1 | label `Planet`, `Σ` (`font-size:50px`), then `<a href=".../game.php?page=overview&cp=254102"><img src="./10_files/s_dschjungelplanet07.gif" width=38></a>` | **the only place with the body id** |
| 2 | `Name`, `Total`, names | `Главная планета` |
| 3 | `Coordinates`, `-`, `<a href="...page=galaxy&galaxy=2&system=68">[2:68:5]</a>` | `[2:68:5]` |
| 4 | `Fields`, `-`, `used / max` | `259 / 405` |
| 5 | `<th>Resources</th>` then 4 rows: 901 Metal, 902 Crystal, 903 Deuterium, 911 Energy | `1.470.603.595`, `254.752.401`, `363.277.462`, `49.544` |
| | `<th>Buildings</th>` then 22 rows: 1,2,3,4,6,12,14,15,21,22,23,24,31,33,34,41,42,43,44,71,72,73 | Metal Mine `38` |
| | `<th>Technologies</th>` then 19 rows: 106,108,109,110,111,113,114,115,117,118,120,121,122,123,124,131,132,133,199 | Energy Technology `12` |
| | `<th>Ships</th>` then 19 rows: 202..220 | Solar Satellite `797` |
| | `<th>Defenses</th>` then 11 rows: 401..411 | `0` |

Row-to-id mapping (observed; the section header text and labels are translated, the order is not — server prints `$reslist` order = ascending element id [UPSTREAM includes/pages/game/ShowImperiumPage.class.php:85-105, styles/templates/game/page.empire.default.tpl:39-80]):

```
"== Resources, 901=Metal, 902=Crystal, 903=Deuterium, 911=Energy, == Buildings, 1=Metal Mine, 2=Crystal Mine, 3=Deuterium Refinery, 4=Solar Power plant, 6=University, 12=Deuterium Power Plant, 14=Robot Factory, 15=Nanite Factory, 21=Shipyard, 22=Metal Storage, 23=Crystal Storage, 24=Deuterium Storage, 31=Research Lab, 33=Terraformer, 34=Alliance Depot, 41=Moon base, 42=Phalax Sensor, 43=Jumpgate, 44=Missile Silo, 71=Light conveyor, 72=Average conveyor, 73=Heavy conveyor, == Technologies, 106=Spy Technology, 108=Computer Technology, 109=Weapons Technology, 110=Shield Technology, 111=Armour Technology, 113=Energy Technology, 114=Hyperspace Technology, 115=Combustion Engine, 117=Impulse Engine, 118=Hyperspace Engine, 120=Laser Technology, 121=Ion Technology, 122=Plasma Technology, 123=Intergalactic Research Network, 124=Expedition Research, 131=Mineral Research, 132=Semi-Crystals Research, 133=Fuel Research, 199=Graviton Research, == Ships, 202=Light Cargo, 203=Heavy Cargo, 204=Light Fighter, 205=Heavy Fighter, 206=Cruiser, 207=Battleship, 208=Colony Ship, 209=Recycler, 210=Spy Probe, 211=Planet Bomber, 212=Solar Satellite, 213=Star Fighter, 214=Battle Fortress, 215=Battle Cruiser, 216=Black Moon, 217=Battle Transporter, 218=Avatar, 219=Battle Recycler, 220=Dark Matter Collector, == Defenses, 401=Missile Launcher, 402=Light Laser Turret, 403=Heavy Laser Turret, 404=Gauss Cannon, 405=Ion Cannon, 406=Plasma Cannon, 407=Small Shield Dome, 408=Large Shield Dome, 409=Atmospheric Shield, 410=Gravitons Cannon, 411=Orbital Defence Platform"
```

Meaning of the cells:

* **Resources 901-903**: stock of each body, recalculated by the server at render time (`CalcResource` for every body) [UPSTREAM ShowImperiumPage.class.php:58-65]. Integers (rounded with `number_format`).
* **Energy 911**: the body's energy **production** (`$Planet['energy']`, the sum of positive energy incl. officer bonus), **not** the free energy. Main planet `49.544` = header `t="2.502 / 49.544"` second number = resources page tooltip "Available". [REAL + UPSTREAM ShowImperiumPage.class.php:88]
* **Buildings / Ships / Defenses**: per body; Σ = sum.
* **Technologies**: account-wide; every body column and the Σ column repeat the **level** (Σ is NOT a sum) [UPSTREAM page.empire.default.tpl:63-70].
* **Missiles 502/503 are not in the imperium** (not in `$reslist['defense']`); read them from `page=shipyard&mode=defense`.
* No queues, no production per hour, no temperature, no production percentages here.

### 2.2 Column order != planet list order

Columns = **current planet first**, then the other bodies in an effectively random DB order: upstream builds `ORDER BY :order` with a bound string and an operator-precedence bug, so the planet-sort setting is ignored [UPSTREAM ShowImperiumPage.class.php:34-54]. Always key columns by the `cp=` of row 1, never by index or by name (names repeat: three bodies are called `Colony`).

```
{ "imperium": [ 254102, 254104, 254103, 254105 ], "planetList": [ 254102, 254103, 254104, 254105 ], "selector": [ 254102, 254103, 254104, 254105 ] }
```

Moons [UPSTREAM, no moon on the real account]: the query has no `planet_type` filter, so a moon is just another column (its own `cp=` id, coords identical to its planet). Tell planet from moon by the `#planetSelector option` text `... (Moon) [g:s:p]` or by the image name (see `layout.md`). Destroyed bodies are excluded (`destruyed = '0'`).

### 2.3 Recipe (RUN)

```js
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
```

Observed output (`parseImperium(document)` on imperium.html; only the main planet's body shown, others are the same shape):

```
{ "columns": [ { "cp": 254102, "image": "dschjungelplanet07", "name": "Главная планета", "coords": [ 2, 68, 5 ], "fieldsUsed": 259, "fieldsMax": 405 }, { "cp": 254104, "image": "normaltempplanet02", "name": "Colony", "coords": [ 2, 68, 7 ], "fieldsUsed": 78, "fieldsMax": 433 }, { "cp": 254103, "image": "dschjungelplanet10", "name": "Colony", "coords": [ 2, 68, 6 ], "fieldsUsed": 85, "fieldsMax": 347 }, { "cp": 254105, "image": "normaltempplanet02", "name": "Colony", "coords": [ 2, 68, 8 ], "fieldsUsed": 129, "fieldsMax": 514 } ], "research": { "106": 12, "108": 12, "109": 2, "110": 7, "111": 6, "113": 12, "114": 8, "115": 12, "117": 7, "118": 4, "120": 10, "121": 5, "122": 7, "123": 5, "124": 6, "131": 8, "132": 0, "133": 8, "199": 0 }, "warnings": [], "main": { "cp": 254102, "name": "Главная планета", "coords": [ 2, 68, 5 ], "fieldsUsed": 259, "fieldsMax": 405, "resources": { "901": 1470603595, "902": 254752401, "903": 363277462, "911": 49544 }, "buildings": { "1": 38, "2": 35, "3": 33, "4": 30, "6": 0, "12": 0, "14": 20, "15": 10, "21": 18, "22": 18, "23": 17, "24": 16, "31": 21, "33": 1, "34": 0, "41": 0, "42": 0, "43": 0, "44": 0, "71": 1, "72": 1, "73": 0 }, "ships": { "202": 0, "203": 0, "204": 0, "205": 0, "206": 0, "207": 0, "208": 2, "209": 0, "210": 102, "211": 0, "212": 797, "213": 0, "214": 0, "215": 0, "216": 0, "217": 0, "218": 0, "219": 0, "220": 0 }, "defense": { "401": 0, "402": 0, "403": 0, "404": 0, "405": 0, "406": 0, "407": 0, "408": 0, "409": 0, "410": 0, "411": 0 } }, "totals901to911": [ 1559340984, 290219872, 381393268, 56430 ], "totalsShips212": 874 }
```

A colony (`bodies[254103]`, zero entries filtered):

```
{ "name": "Colony", "coords": [ 2, 68, 6 ], "resources": { "901": 26775000, "902": 14600000, "903": 7471705, "911": 1276 }, "buildingsNonZero": { "1": 11, "2": 9, "3": 7, "4": 14, "14": 10, "21": 1, "22": 10, "23": 9, "24": 8, "31": 6 }, "ships": {} }
```

Σ check (`Σ == sum of body columns` for every non-research row):

```
{ "rowsChecked": 75, "sumMismatches": [ [ 903, 381393267, 381393268 ] ] }
```

Pitfall: **Σ can differ by 1** from the sum of the cells (903: 381.393.267 vs 381.393.268) because the server formats the sum of floats, each cell is rounded separately. Compute your own totals from the cells.

### 2.4 Pitfalls

* Labels are translated (`var Lang = "en"`; the names are GALAXYZ-specific, e.g. `Phalax Sensor`, `Star Fighter`, `Dark Matter Collector`), so map by section + position, and keep the label only for diagnostics. If GALAXYZ adds an element, row counts change: `parseImperium` puts a message in `warnings` instead of guessing; the sum check above catches a shift.
* Numbers: `.` thousands separator, integers; no short forms on this page. `GZEmpire.num` strips `.` and NBSP.
* Encoding UTF-8, names may be Cyrillic.
* Images are `.gif` 38x38 in GALAXYZ (upstream: `.jpg` 80x80); do not rely on the path.
* Stocks over storage are normal: colony 254104 has 12 862 389 metal with 7 950 000 storage (see section 5.4).

---

## 3. Resource settings page (`page=resources`) [REAL resources.html]

### 3.1 Structure

`form#resourceSettings[action$="page=resources"][method=post]` > `input[type=hidden][name=mode][value=send]` + `input.btn_blue[type=submit][value="Cost estimate"]` (the "calculate" button, at the top in GALAXYZ; upstream puts it in the bonus row) > `table.list.listOfResourceSettingsPerPlanet.selecttable`.
Header above the form: `#planet h2` = `Resources produced on the planet "Главная планета"`. The page is always about the **current** planet (`#planetSelector option[selected]`).

Rows (`tr`, 7 cells: label `td[colspan=2].label`, Metal, Crystal, Deuterium, Energy, select-or-empty, empty), in fixed template order [UPSTREAM styles/templates/game/page.resources.default.tpl:17-71]:

| row | label (en) | sample: Metal / Crystal / Deut / Energy | notes |
|---|---|---|---|
| th | `""`, Metal, Crystal, Deuterium, Energy | | `th` cells |
| basic | `Basic Production` | `440.000 / 220.000 / 0 / 0` | = basic income * resource multiplier; 0 on moons / in vacation |
| producer xN | `Metal Mine (Level 38)` | `938.100.934 / 0 / 0 / -14.214` | one row per producer with level/quantity > 0 [UPSTREAM ShowResourcesPage.class.php:120-126]; ships say `(Quantity 797)`. Cell = `<span style="color:lime|red|white">` |
| | `Crystal Mine (Level 35)` | `0 / 432.777.527 / 0 / -9.836` | |
| | `Deuterium Refinery (Level 33)` | `0 / 0 / 191.546.210 / -22.993` | |
| | `Solar Power plant (Level 30)` | `0 / 0 / 0 / 10.470` | |
| | `Solar Satellite (Quantity 797)` | `0 / 0 / 0 / 30.817` | |
| bonus | `Bonus (Officers/Bonus):` | `994.386.990 / 389.499.775 / 203.038.982 / 8.257` | = positive production * (Resource factor + 0.02 * plasma-like research 131/132/133); energy = positive energy * Energy factor |
| storage | `Storage capacity` | `3.417&nbsp;M / 1.864&nbsp;M / 1.017&nbsp;M / -` | **short form (long scale, NBSP)**, never parse; use the ticker `limit` |
| total | `Total:` | `1.932.927.923 / 822.497.302 / 394.585.192 / 2.502` | metal..deut per hour (basic + producers + bonus); energy = **free** energy |
| daily | `Daily Production:` | `46.390.270.157 / ... / 2.502` | total * 24; energy repeated |
| weekly | `Weekly Production:` | `324.731.891.099 / ... / 2.502` | total * 168 |

Production percentage select per producer: `select[name="prod[<id>]"]` with `option[value=10..0]` labelled `100%..0%`, the active one has the `selected` attribute (server rendered). Changing the select does nothing until the form is submitted (no `onchange` in the real page).
Producer cell values already include the % and the energy shortage factor (`prodLevel`) and the resource multiplier, but **not** the officer/research bonus (that is the bonus row).

### 3.2 Recipe (RUN)

```js
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
```

Observed output:

```
{ "cp": 254102, "header": "Resources produced on the planet \"Главная планета\"", "basic": { "901": 440000, "902": 220000, "903": 0, "911": 0 }, "producers": [ { "id": 1, "label": "Metal Mine (Level 38)", "level": 38, "percent": 100, "prod": { "901": 938100934, "902": 0, "903": 0, "911": -14214 } }, { "id": 2, "label": "Crystal Mine (Level 35)", "level": 35, "percent": 100, "prod": { "901": 0, "902": 432777527, "903": 0, "911": -9836 } }, { "id": 3, "label": "Deuterium Refinery (Level 33)", "level": 33, "percent": 100, "prod": { "901": 0, "902": 0, "903": 191546210, "911": -22993 } }, { "id": 4, "label": "Solar Power plant (Level 30)", "level": 30, "percent": 100, "prod": { "901": 0, "902": 0, "903": 0, "911": 10470 } }, { "id": 212, "label": "Solar Satellite (Quantity 797)", "level": 797, "percent": 100, "prod": { "901": 0, "902": 0, "903": 0, "911": 30817 } } ], "bonus": { "901": 994386990, "902": 389499775, "903": 203038982, "911": 8257 }, "storageShort": [ "3.417 M", "1.864 M", "1.017 M" ], "total": { "901": 1932927923, "902": 822497302, "903": 394585192, "911": 2502 }, "daily": { "901": 46390270157, "902": 19739935252, "903": 9470044600, "911": 2502 }, "weekly": { "901": 324731891099, "902": 138179546765, "903": 66290312203, "911": 2502 }, "form": { "action": "https://ogamex.eu/Aeternum/game.php?page=resources", "method": "post", "hidden": [ "mode=send" ] } }
```

Exact per-hour values (floats) and exact storage of the current planet are in the inline `resourceTicker({...}, true)` calls of every full page [REAL resources.html:449-467]:

```js
// Exact amount/storage/production of the current planet from the inline resourceTicker({...}) calls (every full page).
function ticker(doc) {
  doc = doc || document;
  const src = [...doc.scripts].map(s => s.textContent).join('\n'), out = {};
  for (const m of src.matchAll(/resourceTicker\(\{\s*available:\s*\(([-\d.eE+]+)\),\s*limit:\s*\[0,\s*"([-\d.eE+]+)"\],\s*production:\s*([-\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g))
    out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
  return out;
}
```

```
{ "metal": { "amount": 1474362065.6036885, "storage": 3416925000, "perHour": 1932927923.2055 }, "crystal": { "amount": 256351701.17604348, "storage": 1863925000, "perHour": 822497302.17436 }, "deuterium": { "amount": 364044711.3845243, "storage": 1016750000, "perHour": 394585191.6862 } }
```

Energy of the current planet: header `#resTable td.res_current.Imperium[t]` = `"<free> / <production>"` (`t="2.502 / 49.544"`); consumption = production - free = 47 042 (recipe in `layout.md` "energy"). The metal/crystal/deut header tooltips (`img[data-currentname="current_Metal"][title]`) also carry `storage` and `production` as full integers.

### 3.3 Pitfalls

* Only the **current** planet. Reading another planet needs `cp=` (sticky, section 1).
* Labels and the `(Level N)` / `(Quantity N)` word are translated; the id comes from `select[name]`, the level from the last parenthesis.
* A producer at level 0 has no row at all; a producer without a select does not exist (every row has one).
* Bonus/total/daily/weekly are found by position after the last producer row, not by label.
* On a moon all producers are absent and basic income is 0 [UPSTREAM ShowResourcesPage.class.php:72-78].

---

## 4. Officers page (`page=officier`) [REAL officier.html]

### 4.1 Structure

`#navcontainer.hard-table.__officier > ul#offList > li.button`:

* `li#button_rpg_darkMatter` > `.officers100.rpg_darkMatter[title="Dark Matter"]` > `a.detail_button[data-technologys="1"] .level` = `3.981&nbsp;` (DM balance; same as header `#current_darkmatter[data-real]`).
* `li#button<id>` for 601..615 > `div.officers100.<rpg_class>[title=<name>][data-status="off"]?` > `a.detail_button.has_details[data-technology=<id>][title=<name>] > span.ecke > span.level` = `level/max`, e.g. `18/20`.
* `data-status="off"` on the `.officers100` div = **requirements not met** (locked). Checked against upstream requirements (`603 needs 601>=5`, `605 needs 601>=10 & 603>=2`, `607 needs 605>=1`, `604 needs 602>=5`...) [UPSTREAM install/install.sql:1297-1324], snippet `lockedVsRequirements` in the runner: `{ "agree": "15 / 15", "disagree": [] }`
* No price, no bonus text, no timers on the page itself: they come from the details AJAX (body never captured).
* GALAXYZ shows **all 15 officers including locked ones** (upstream hides inaccessible ones, ShowOfficierPage.class.php:132) and **no** DM-timed extras (701..707) list.

| id | class | name | sample level/max | status |
|---|---|---|---|---|
| 601 | rpg_geologue | Geologist | 18/20 | |
| 602 | rpg_amiral | Admiral | 0/20 | |
| 603 | rpg_ingenieur | Engineer | 3/10 | |
| 604 | rpg_technocrate | Technocrat | 0/10 | off |
| 605 | rpg_constructeur | Constructor | 0/3 | |
| 606 | rpg_scientifique | Scientologist | 0/3 | |
| 607 | rpg_stockeur | Storage expert | 0/2 | off |
| 608 | rpg_defenseur | Minister of Defence | 0/2 | off |
| 609 | rpg_bunker | Guardian | 0/1 | off |
| 610 | rpg_espion | Spy | 0/2 | off |
| 611 | rpg_commandant | Commander | 0/3 | off |
| 612 | rpg_destructeur | Destroyer | 0/1 | off |
| 613 | rpg_general | General | 0/3 | off |
| 614 | rpg_raideur | Emperor | 0/1 | off |
| 615 | rpg_empereur | Raider | 0/1 | off |

(CSS class and title look swapped for 614/615: `614 .rpg_raideur` = "Emperor", `615 .rpg_empereur` = "Raider"; upstream has the same mismatch (install.sql:1031-1032 vs language/en/TECH.php:173-174). Key by `data-technology`.)

### 4.2 Recipe (RUN)

```js
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
```

```
{ "darkMatter": 3981, "officers": [ { "id": 601, "name": "Geologist", "level": 18, "max": 20, "locked": false }, { "id": 602, "name": "Admiral", "level": 0, "max": 20, "locked": false }, { "id": 603, "name": "Engineer", "level": 3, "max": 10, "locked": false }, { "id": 604, "name": "Technocrat", "level": 0, "max": 10, "locked": true }, { "id": 605, "name": "Constructor", "level": 0, "max": 3, "locked": false }, { "id": 606, "name": "Scientologist", "level": 0, "max": 3, "locked": false }, { "id": 607, "name": "Storage expert", "level": 0, "max": 2, "locked": true }, { "id": 608, "name": "Minister of Defence", "level": 0, "max": 2, "locked": true }, { "id": 609, "name": "Guardian", "level": 0, "max": 1, "locked": true }, { "id": 610, "name": "Spy", "level": 0, "max": 2, "locked": true }, { "id": 611, "name": "Commander", "level": 0, "max": 3, "locked": true }, { "id": 612, "name": "Destroyer", "level": 0, "max": 1, "locked": true }, { "id": 613, "name": "General", "level": 0, "max": 3, "locked": true }, { "id": 614, "name": "Emperor", "level": 0, "max": 1, "locked": true }, { "id": 615, "name": "Raider", "level": 0, "max": 1, "locked": true } ] }
```

### 4.3 Officer bonuses [UPSTREAM install/install.sql:1018-1032 (`vars.bonus*` columns, per level)]

The server keeps these in the DB, so GALAXYZ may have changed them; the ones checked against the real economy are marked.

```js
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
```

Observed (`officerFactors(parseOfficier(document).officers)` on officier.html):

```
{ "Resource": 0.9, "Attack": 0.15, "Defensive": 0.15, "Shield": 0, "Energy": 0.15, "ShipTime": 0, "BuildTime": 0, "ResearchTime": 0, "ShipStorage": 0, "DefensiveTime": 0, "SpyPower": 0, "FleetSlots": 0, "FlyTime": 0, "Planets": 0 }
```

* `Resource 0.9` (Geologist 18 x 5 %) **matches the real resources page exactly** (section 5) [DERIVED].
* `Energy 0.15` (Engineer 3 x 5 %) matches officier.html's own header (`47.480` production), but at imperium/resources time the factor is **0.20** (`49.544 = 41.287 * 1.2`) after the 3 375 DM purchase. Either Engineer went to 4 or a DM extra (705 "Energy Upgrade") was activated; not visible on any saved page.
* Upstream factors used by the economy (`getFactors`, includes/GeneralFunctions.php:18-55): level * bonus for officers; DM extras 701..707 add their bonus while active.

---

## 5. Real economy (for calculators) [DERIVED from REAL resources.html + imperium.html]

### 5.1 Server constants of ogamex.eu/Aeternum

| constant | value | evidence |
|---|---|---|
| `resource_multiplier` (economy speed) | **22 000** | metal mine 38: 938 100 934 / (30*38*1.1^38) = 22000.0000095; crystal 35: 21999.99998; deut 33 (tempMax 72): 22000.00005 |
| basic income | metal 20, crystal 10, deut 0, energy 0 (x 22 000 = `440.000 / 220.000 / 0 / 0`) | basic row |
| `energySpeed` | **1** | metal mine 38 energy -14 214 = -(10*38*1.1^38) exactly |
| storage factor (`storage_multiplier * (1 + ResourceStorage bonus)`) | **5** | metal storage 18: 3 416 925 000 / (floor(2.5*1.8331954764^18)*5000 = 683 385 000) = 5.000; crystal 17, deut 16: also 5.000 |
| `prodLevel` (energy shortage) | 1 (energy 49 544 >= used 47 042) | |
| plasma-like research | +2 % per level of 131 (metal), 132 (crystal), 133 (deut) | bonus row metal = 938 100 934 * (0.9 + 0.02*8) = 994 386 990 |
| fleet speed | 7 (`data.gamespeed` on fleetStep1, see fleet.md) | not used here |

Formulas (per hour, `L` = level, `f` = percent/10, `T` = planet max temperature, from the planet list title `32°C to 72°C`) [UPSTREAM install/install.sql:948-996 `vars.production*`, includes/classes/class.PlanetRessUpdate.php:240-305]:

```
metal mine 1      +30*L*1.1^L*0.1f  metal          -10*L*1.1^L*0.1f energy
crystal mine 2    +20*L*1.1^L*0.1f  crystal        -10*L*1.1^L*0.1f energy
deut synth 3      +10*L*1.1^L*(1.28-0.002T)*0.1f   -30*L*1.1^L*0.1f energy
solar plant 4     +20*L*1.1^L*0.1f energy
fusion 12         -10*L*1.1^L*0.1f deut            +30*L*(1.05+0.01*energyTech113)^L*0.1f energy
satellite 212     +(T+160)/6*0.1f*N energy
storage 22/23/24  floor(2.5*1.8331954764^L)*5000 * 5
energy production = round(sum(+energy) * energySpeed * (1 + factor.Energy))
prodLevel         = min(1, production / |consumption|)
perHour(r)        = (sum(+r)*(1 + factor.Resource + 0.02*research[131|132|133]) * prodLevel + sum(-r)) * 22000 + basic(r)*22000
```

### 5.2 Recipe (RUN)

```js
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
```

### 5.3 Check: model vs the real page (main planet 254102)

Inputs: levels from `parseImperium` (`buildings` + ships 212), percents from `parseResources`, `tempMax` 72 from the planet list title, research from `parseImperium`, factors from `officerFactors` (officier.html, i.e. Energy 0.15).

```
{"model":{"perHour":{"901":1932927923.2055407,"902":822497302.1743623,"903":394585191.6861972},"energy":{"production":47480,"consumption":-47042.40628152549,"free":437.59371847451257},"prodLevel":1},"page":{"total":{"901":1932927923,"902":822497302,"903":394585192,"911":2502},"ticker":{"metal":1932927923.2055,"crystal":822497302.17436,"deuterium":394585191.6862}}}
```

Metal/crystal/deut per hour match the ticker to the last decimal. Energy differs (47 480 vs 49 544) only because officier.html predates the energy-bonus change; it equals officier.html's own header `t="438 / 47.480"`. With `factor.Energy = 0.2`:

```
{"production":49544,"consumption":-47042.40628152549,"free":2501.5937184745126}
```

= the page (`49.544`, free `2.502` after rounding). Colony check: 254103 solar plant 14 -> 20*14*1.1^14 = 1062.6 * 1.2 = 1275 ~ imperium `1.276` energy (rounding).

### 5.4 Storage vs stock for every body (imperium + `storage()`)

```
[{"cp":254102,"coords":"2:68:5","storage":[3416925000,1863925000,1016750000],"stock":[1470603595,254752401,363277462],"full":[false,false,false]},{"cp":254104,"coords":"2:68:7","storage":[7950000,2350000,1275000],"stock":[12862389,6267471,2694100],"full":[true,true,true]},{"cp":254103,"coords":"2:68:6","storage":[26775000,14600000,7950000],"stock":[26775000,14600000,7471705],"full":[true,true,false]},{"cp":254105,"coords":"2:68:8","storage":[49100000,14600000,7950000],"stock":[49100000,14600000,7950000],"full":[true,true,true]}]
```

* Three colonies are full; production stops at storage (`max_overflow` = 1.0 upstream default, unknown live) [UPSTREAM class.PlanetRessUpdate.php:145-180].
* Colony 254104 holds **more than its storage** (12.86 M metal vs 7.95 M): deliveries/loot are not capped. Calculators must treat `stock >= storage` as "no growth", never clamp the stock down.

---

## 6. What a module gets from where (summary)

| datum | best source | fallback |
|---|---|---|
| all bodies: id, name, coords, fields | `parseImperium().columns` | planet list (layout.md) |
| stocks of all bodies | `parseImperium().bodies[cp].resources` (server-recalculated at render) | per-page header (current body only) |
| building / ship / defense counts of all bodies | `parseImperium()` | buildings/shipyard pages (buildings.md), current body only |
| research levels | `parseImperium().research` | research page |
| production per hour, storage, energy of the current body | `ticker()` + header `t=` | resources page totals |
| production per hour of other bodies | `GZEmpire.production()` with imperium levels, stored percents, planet-list tempMax, officer factors | `page=resources&cp=X` (sticky `cp`!) |
| production percentages | `parseResources().producers[].percent` (current body; store per body when the user visits it) | assume 100 % |
| officers, DM | `parseOfficier()`; DM also `#current_darkmatter[data-real]` on every page | |
| missiles 502/503 | shipyard defense page | (not in imperium) |
| temperature | planet list `a.planetlink[title]` `32°C to 72°C` (layout.md) | |

---

## 7. Open questions

1. What did the 3 375 DM buy between 10:05:07 and 10:05:33 (Engineer level 4, or DM extra 705 "Energy Upgrade")? Need `CommanderDetailsAjax` bodies (price per level, bonus text, buy form, token?) and a re-save of officier.html.
2. GALAXYZ officer bonuses other than Geologist (verified 5 %/level) and Engineer energy (5 %/level, consistent) are upstream defaults only (Admiral/Engineer combat bonus, Commander +3 slots, Raider +2 planets, ...).
3. `max_overflow` (storage overflow factor) is unknown; colony stocks equal exactly the storage, which suggests 1.0.
4. A moon column in the imperium and a moon's resources page were not seen (no moon on the account).
5. Does GALAXYZ require a token for `POST page=officier` / `page=resources`? The resources form has none [REAL]; the officier buy form lives in the AJAX panel (not captured).
6. Bodies with the same name (`Colony` x3): always key by `cp`.
