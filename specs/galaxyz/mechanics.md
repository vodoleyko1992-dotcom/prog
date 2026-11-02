# GALAXYZ (ogamex.eu/Aeternum) game mechanics: universe constants and formulas for calculators and the bot

Target: `https://ogamex.eu/Aeternum/game.php?page=<name>`, `<meta name="generator" content="GALAXYZ 1.8.git">` (2Moons fork).
Read `layout.md` first (detection, duplicated ids, number formats). Fleet dispatch details and the flight formulas with all their checks are in `fleet.md` §4. Prices, factors and requirements per element are in `elements.json` (+ `buildings.md` §13).

Tags: **[REAL x.html]** = seen in `eu/pages/x.html` (saved 2026-10-30, 4 planets, no moon). **[UPSTREAM file:line]** = upstream 2Moons in `src/2Moons/` (paths relative to it), not seen live. **[DERIVED]** = computed from REAL numbers with an UPSTREAM formula, and the numbers match. **[UNKNOWN]** = no evidence on any saved page.
Confidence: **HIGH** = several REAL numbers match exactly; **MED** = one REAL number or indirect; **LOW** = upstream default only.

All recipes live in `mechanics-recipes.js` (plain functions `(doc[, arg]) => JSON`, no side effects). They were RUN on the real pages (Chromium, JS disabled, raw saved DOM):
`cd specs/galaxyz && NODE_PATH=$(npm root -g) node tools/mechanics/run_mechanics_snippets.js [--only=inferEconomy,...]`. Every "Observed" block below is copied from that run.

---

## 0. Summary table

| constant | value on Aeternum | evidence | conf. |
|---|---|---|---|
| `resource_multiplier` (economy speed for mines/basic income) | **22000** | resources.html: metal mine 38 = 938.100.934 = 30·38·1.1^38 × 22000.00; crystal 35, deut 33, basic income 440.000/220.000 = 20/10 × 22000 | HIGH |
| `energySpeed` | **1** | solar plant 30 = 10.470 = 20·30·1.1^30; mine consumption -14.214 = 10·38·1.1^38; 797 sats = 30.817 | HIGH |
| `fleet_speed` | **17500** (= ×7) | fleetStep1 inline `data.gamespeed: 7` (= fleet_speed/2500); flight times reproduced (fleet.md §4; recycler flight below) | HIGH |
| `game_speed` (build/research/shipyard time) | **UNKNOWN** | no build/research/ship time appears on any saved page (details AJAX not captured) | - |
| `storage_multiplier` | **5** (× (1 + ResourceStorage factor), here 0) | ticker limits 3.416.925.000 / 1.863.925.000 / 1.016.750.000 = exactly 5 × upstream formula at levels 18/17/16; two other planets' spied resources sit at exactly 5 × formula (L 19, 20, 29) | HIGH |
| `max_overflow` | **1.0** | spied foreign planets hold exactly 5 × formula(L) (production stops at 100 % of storage) | HIGH |
| basic income | 20 / 10 / 0 metal/crystal/deut × multiplier | resources.html "Basic Production 440.000 220.000 0" | HIGH |
| Geologist 601 | **+5 % resources per level** (max 20) | officier 18/20; bonus row crystal = 0.900 × mine output (132 = 0) | HIGH |
| Mineral/Semi-Crystal/Fuel research 131/132/133 | **+2 % per level** of that resource | 131 = 8, 133 = 8: bonus metal and deut = 1.06 = 0.90 + 0.16 | HIGH |
| Engineer 603 | +5 % attack, +5 % armour per level | fleetTable bonus attack 35 = 2×10 + 15, defence 85 = 7×10 + 15 | HIGH |
| energy bonus | **+20 %** on produced energy | bonus row 8.257 = 0.19999 × (10.470 + 30.817); upstream would give 0.15 (Engineer 3 × 5 %) | MED (source of the extra 5 % unknown) |
| solar satellite | `(Tmax + 160) / 6` per unit (2Moons, not OGame's +140) | 797 × (72+160)/6 = 30.817 | HIGH |
| deuterium refinery | `10·L·1.1^L·(1.28 − 0.002·Tmax)` (2Moons, not OGame's Tavg form) | L 33, Tmax 72 → 191.546.210 / 22000 exact | HIGH |
| storage formula | `5000 · floor(2.5 · 1.8331954764^L) × 5` | see above | HIGH |
| cost formula | `cost · factor^L` for the step L → L+1 (= `cost · factor^(target−1)`) | buildings.md §3: 35/35 buy buttons explained with upstream factors | HIGH |
| unit prices | upstream 2Moons for all 26 tradeable units (202-220, 401-406, 410) | fleetDealer `CostInfo` = elements.json, diff `[]` | HIGH |
| cargo | upstream capacities; **no** cargo bonus from Hyperspace Tech 114 | fleetStep1 `fleetroom: "7500"` for 1 colony ship with 114 = 8 | HIGH (for 208), MED (others) |
| fleet slots | `1 + Computer(108) + FleetSlots factor` | 108 = 12 → "Fleet 1 / 13" | HIGH |
| expedition slots | `floor(sqrt(Astrophysics 124))` | 124 = 6 → "0 / 2 expedition" | HIGH |
| expedition position | 16 (`max_planets` = 15) | galaxy prefill link `planet=16&target_mission=15` | HIGH |
| ship speed techs | combustion +10 %, impulse +20 %, hyperspace +30 % per level | bonus table 120/140/120 = 12×10, 7×20, 4×30; tooltips 208 = 6000, 210 = 2.2e8 | HIGH |
| fuel | 2Moons `GetFleetConsumption` | fleet.md §4: 2 / 118 deut reproduced | HIGH |
| loot | 50 % of each resource, 2Moons fill order (1/3 M, 1/2 C, rest D, then top-up) | [UPSTREAM missions/functions/calculateSteal.php:60-77] | LOW (no real combat report) |
| debris | `Fleet_Cdr` % of destroyed ships' metal+crystal (default 30), `Defs_Cdr` % of defence (default 0); no deuterium | [UPSTREAM calculateAttack.php:266-311] | LOW |
| defence rebuild | 56..84 % per defence type (random) | [UPSTREAM calculateAttack.php:291] | LOW |
| moon chance | `min(round(debris/100000 × moon_factor), moon_chance)` = capped 20 % at this economy | [UPSTREAM MissionCaseAttack.class.php:341-352] | LOW |
| trader | rate 4/2/1 (metal:crystal:deut value 1:2:4), merchant fee 100 DM | trader.html text | HIGH |

---

## 1. Production (page=resources) [REAL resources.html]

### 1.1 Where the numbers are

| datum | selector / source | sample (copied) |
|---|---|---|
| production table | `form#resourceSettings table.listOfResourceSettingsPerPlanet tr` with `td.label` (first cell, `colspan=2`), then 4 cells metal/crystal/deut/energy; producer rows have `select[name="prod[<id>]"]` (value 0..10 = 0..100 %) | `Metal Mine (Level 38)` · `938.100.934` · `0` · `0` · `-14.214` |
| satellites row | label `Solar Satellite (Quantity 797)`, `select[name="prod[212]"]` | `30.817` energy |
| bonus row | label `Bonus (Officers/Bonus):` (5th row from the end) | `994.386.990` `389.499.775` `203.038.982` `8.257` |
| storage row | label `Storage capacity` (4th from the end), **short JS form** | `3.417&nbsp;M` = 3 417 000 000 (rounded!) |
| total / day / week | 3rd, 2nd, last row; energy is NOT multiplied by 24/168 | `1.932.927.923`, `46.390.270.157`, `324.731.891.099` |
| exact production and storage | inline `resourceTicker({available: (…), limit: [0, "3416925000"], production: 1932927923.2055, valueElem: "current_metal"}, true)` x3, on **every** full page | see R2 |
| same, as text | `#resTable img.tooltipHTML[title]`: title = `Metal:|<table>… .current … .storage … .production` (HTML-escaped in the attribute) | `Storage capacity: 3.416.925.000` |
| planet temperature | planet list `.smallplanet a.planetlink[title]` (`#planetList` is duplicated, dedupe by `cp`): `32°C to 72°C`, fields `(259 / 405)` | Tmax 72 |

Pitfalls: labels are localized (use `select[name^=prod]` ids and row positions); numbers use `.` thousands; the storage row is a JS short form (`.` = thousands, long scale, NBSP); energy row values are not multiplied by `resource_multiplier`; the production table only lists producers that exist on the planet (no fusion plant row here, 12 = 0).

### 1.2 R1 `productionTable(doc)` (RUN)

```js
const productionTable = (doc) => [...doc.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')]
  .filter((tr) => tr.querySelector('td.label'))
  .map((tr) => {
    const td = tr.querySelectorAll('td');
    const label = td[0].textContent.replace(/\s+/g, ' ').trim();
    const lv = label.match(/\((?:Level|Quantity)\s+(\d+)\)/);
    const sel = tr.querySelector('select[name^="prod["]');
    return { label, id: sel ? +sel.name.match(/\d+/)[0] : null, level: lv ? +lv[1] : null,
      metal: gzNum(td[1].textContent), crystal: gzNum(td[2].textContent), deuterium: gzNum(td[3].textContent), energy: gzNum(td[4].textContent),
      percent: sel ? +sel.value * 10 : null };
  });
// gzNum: see mechanics-recipes.js ("1.932.927.923" -> 1932927923, "3.417 M" -> 3417000000, "-" -> null)
```

Observed (resources.html):
```
{"label":"Basic Production","id":null,"level":null,"metal":440000,"crystal":220000,"deuterium":0,"energy":0,"percent":null}
{"label":"Metal Mine (Level 38)","id":1,"level":38,"metal":938100934,"crystal":0,"deuterium":0,"energy":-14214,"percent":100}
{"label":"Crystal Mine (Level 35)","id":2,"level":35,"metal":0,"crystal":432777527,"deuterium":0,"energy":-9836,"percent":100}
{"label":"Deuterium Refinery (Level 33)","id":3,"level":33,"metal":0,"crystal":0,"deuterium":191546210,"energy":-22993,"percent":100}
{"label":"Solar Power plant (Level 30)","id":4,"level":30,"metal":0,"crystal":0,"deuterium":0,"energy":10470,"percent":100}
{"label":"Solar Satellite (Quantity 797)","id":212,"level":797,"metal":0,"crystal":0,"deuterium":0,"energy":30817,"percent":100}
{"label":"Bonus (Officers/Bonus):","id":null,"level":null,"metal":994386990,"crystal":389499775,"deuterium":203038982,"energy":8257,"percent":null}
{"label":"Storage capacity","id":null,"level":null,"metal":3417000000,"crystal":1864000000,"deuterium":1017000000,"energy":null,"percent":null}
{"label":"Total:","id":null,"level":null,"metal":1932927923,"crystal":822497302,"deuterium":394585192,"energy":2502,"percent":null}
{"label":"Daily Production:",…,"metal":46390270157,"crystal":19739935252,"deuterium":9470044600,"energy":2502}
{"label":"Weekly Production:",…,"metal":324731891099,"crystal":138179546765,"deuterium":66290312203,"energy":2502}
```

### 1.3 R2 `resourceTickers(doc)` / R3 `resourceBarTooltips(doc)` (RUN)

```js
const resourceTickers = (doc) => [...doc.scripts].map((s) => s.textContent).join('\n')
  .split('resourceTicker({').slice(1).map((chunk) => {
    const get = (k) => { const m = chunk.match(new RegExp(k + '\\s*:\\s*\\(?\\s*([^,)\\n]+)')); return m ? m[1].trim() : null; };
    const lim = chunk.match(/limit\s*:\s*\[\s*([\d.]+)\s*,\s*"?([\d.]+)"?\s*\]/);
    return { valueElem: (get('valueElem') || '').replace(/["']/g, ''), available: +get('available'),
      limitMin: lim ? +lim[1] : null, limit: lim ? +lim[2] : null, production: +get('production') };
  });
const resourceBarTooltips = (doc) => [...doc.querySelectorAll('#resTable img.tooltipHTML[title]')].map((img) => {
  const [name, html] = img.getAttribute('title').split('|');
  const t = new DOMParser().parseFromString(html || '', 'text/html');
  const val = (sel) => { const e = t.querySelector(sel); return e ? gzNum(e.textContent) : null; };
  return { name: name.replace(/[:\s]+/g, ' ').trim(), current: val('.current'), storage: val('.storage'), production: val('.production') };
});
```

Observed:
```
resourceTickers resources.html
[{"valueElem":"current_metal","available":1474362065.6036885,"limitMin":0,"limit":3416925000,"production":1932927923.2055},
 {"valueElem":"current_crystal","available":256351701.17604348,"limitMin":0,"limit":1863925000,"production":822497302.17436},
 {"valueElem":"current_deuterium","available":364044711.3845243,"limitMin":0,"limit":1016750000,"production":394585191.6862}]
resourceBarTooltips overview.html
[{"name":"Metal","current":1408320362,"storage":3416925000,"production":1932927923},{"name":"Crystal","current":228249710,"storage":1863925000,"production":822497302},
 {"name":"Deuterium","current":350563051,"storage":1016750000,"production":394585192},{"name":"Energy","current":47480,"storage":null,"production":438},
 {"name":"Dark Matter","current":3981,"storage":null,"production":null}]
```
Note: `production` in the ticker is **per hour**, a float; `limit[1]` is a **string** in the source. The energy tooltip swaps the meaning (`.current` = produced 47 480, `.production` = free 438; see layout.md `t="438 / 47.480"`).

### 1.4 R7 `inferEconomy(doc)` — the multipliers (RUN)

Upstream formulas (vars `production901..911`, [UPSTREAM install/install.sql:948-951,953,996]; per-hour assembly [UPSTREAM includes/classes/class.PlanetRessUpdate.php:287-302]; basic income [PlanetRessUpdate.php:149,160,170]):

```
metal/h   = (30·L·1.1^L · pct) · (1 + factor.Resource + 0.02·lvl131) · resource_multiplier       (+ energy factor if short)
crystal/h = (20·L·1.1^L · pct) · (1 + factor.Resource + 0.02·lvl132) · resource_multiplier
deut/h    = (10·L·1.1^L·(1.28 − 0.002·Tmax) · pct) · (1 + factor.Resource + 0.02·lvl133) · resource_multiplier − fusion use
energy    = round((20·L·1.1^L [solar] + 30·L·(1.05+0.01·E)^L [fusion] + n·(Tmax+160)/6 [sats]) · energySpeed · (1 + factor.Energy))
energy use: metal 10·L·1.1^L, crystal 10·L·1.1^L, deut 20·L·1.1^L  (· energySpeed, NOT · resource_multiplier)
basic     = 20 / 10 / 0 per hour · resource_multiplier (always, even at 0 % or without mines)
pct       = prod select value / 10; production is additionally scaled by min(1, energy produced / used) [PlanetRessUpdate.php:293-302]
```

```js
const inferEconomy = (doc) => {
  const rows = productionTable(doc), tickers = resourceTickers(doc);
  const tMax = planetFacts(doc).find((p) => p.active).tMax;
  const f = (k, L) => k * L * Math.pow(1.1, L);
  const row = (id) => rows.find((r) => r.id === id);
  const m = row(1), c = row(2), d = row(3), s = row(4), sat = row(212);
  const basic = rows[0], bonus = rows[rows.length - 5], total = rows[rows.length - 3];
  return { tMax,
    resourceMultiplier: { fromMetalMine: m.metal / f(30, m.level), fromCrystalMine: c.crystal / f(20, c.level),
      fromDeutRefinery: d.deuterium / (f(10, d.level) * (-0.002 * tMax + 1.28)), fromBasicIncome: [basic.metal / 20, basic.crystal / 10] },
    energySpeed: { fromSolarPlant: s.energy / f(20, s.level), fromMetalMineUse: m.energy / -f(10, m.level),
      fromSatellites: sat.energy / ((tMax + 160) / 6 * sat.level) },
    bonusShare: { metal: bonus.metal / m.metal, crystal: bonus.crystal / c.crystal, deuterium: bonus.deuterium / d.deuterium,
      energy: bonus.energy / (s.energy + sat.energy) },
    totalCheck: { metalRowsSum: basic.metal + m.metal + bonus.metal, metalTotalRow: total.metal, tickerProduction: tickers[0].production } };
};
```

Observed (resources.html):
```
{"tMax":72,
 "resourceMultiplier":{"fromMetalMine":22000.000009499727,"fromCrystalMine":21999.99997660647,"fromDeutRefinery":22000.00005094885,"fromBasicIncome":[22000,22000]},
 "energySpeed":{"fromSolarPlant":1.0000342551053807,"fromMetalMineUse":1.000024588404351,"fromSatellites":0.9999891835763424},
 "bonusShare":{"metal":1.0599999999573606,"crystal":0.9000000016174592,"deuterium":1.0599999968675966,"energy":0.19999031172039625},
 "totalCheck":{"metalRowsSum":1932927924,"metalTotalRow":1932927923,"tickerProduction":1932927923.2055}}
```

Reading: `resource_multiplier = 22000` (rounding noise only from the displayed integers); `energySpeed = 1`; the bonus row = mine output × (Geologist 18 × 0.05 = 0.90 + 0.02 × level of 131/132/133), with 131 = 8, 132 = 0, 133 = 8 from research.html → 1.06 / 0.90 / 1.06 exactly. Energy bonus is 0.20 while upstream Engineer 3 gives 0.15 (open question 2). Total = basic + mine + bonus (off by 1 from rounding of each row: use the ticker float for exact values).

Levels and officers used above (RUN, R5 `elementLevels`, R6 `officerLevels`):
```
elementLevels buildings.html {"1":38,"2":35,"3":33,"4":30,"6":0,"12":0,"14":20,"15":10,"21":18,"22":18,"23":17,"24":16,"31":21,"33":1,"34":0,"44":0,"71":1,"72":1,"73":0}
elementLevels research.html  {"106":12,"108":12,"109":2,"110":7,"111":6,"113":12,"114":8,"115":12,"117":7,"118":4,"120":10,"121":5,"122":7,"123":5,"124":6,"131":8,"132":0,"133":8,"199":0}
officerLevels officier.html  {"601":{"name":"Geologist","level":18,"max":20},"602":{"name":"Admiral","level":0,"max":20},"603":{"name":"Engineer","level":3,"max":10},
  "604":{"name":"Technocrat",…0/10},"605":{"name":"Constructor",…0/3},"606":{"name":"Scientologist",…0/3},"607":{"name":"Storage expert",…0/2},"608":{"name":"Minister of Defence",…0/2},
  "609":{"name":"Guardian",…0/1},"610":{"name":"Spy",…0/2},"611":{"name":"Commander",…0/3},"612":{"name":"Destroyer",…0/1},"613":{"name":"General",…0/3},
  "614":{"name":"Emperor","level":0,"max":1},"615":{"name":"Raider","level":0,"max":1}}
```
```js
const elementLevels = (doc) => { const out = {};
  for (const li of doc.querySelectorAll('li.technology[data-technology]')) {
    const id = +li.dataset.technology, lv = li.querySelector('span.level'); if (!lv) continue;
    out[id] = lv.dataset.value != null ? +lv.dataset.value : gzNum(lv.textContent); }   // buildings: data-value; research: text only
  return out; };
const officerLevels = (doc) => Object.fromEntries([...doc.querySelectorAll('a.detail_button[data-technology]')]
  .map((a) => [a, (a.querySelector('.level') || {}).textContent || '']).filter(([, t]) => /\d+\s*\/\s*\d+/.test(t))
  .map(([a, t]) => { const m = t.match(/(\d+)\s*\/\s*(\d+)/); return [+a.dataset.technology, { name: a.title, level: +m[1], max: +m[2] }]; }));
```
Pitfall: the fork labels 614 "Emperor" and 615 "Raider"; upstream ids are 614 `rpg_raideur`, 615 `rpg_empereur` [UPSTREAM install/install.sql:1031-1032]. Key officers by id and verify effects before trusting either name. Research `span.level` has no `data-value` (text only); buildings have `data-value`.

Officer effects per level (upstream vars, [UPSTREAM install/install.sql:1018-1032]): 601 Resource +5 % (max 20), 602 attack/armour/shield +5 % (max 20), 603 attack +5 %, armour +5 %, energy +5 % (max 10), 604 ship build time −5 %, 605 build time −10 %, 606 research time −10 %, 607 "Storage expert" = **ship cargo** +50 % (ShipStorage, not resource storage), 608 defence build time −25 %, 610 spy +35 %, 611 +3 fleet slots, 613 flight time −10 %, 615 (upstream empereur) +2 planets. Verified on REAL numbers: 601 (resources), 603 attack/armour (fleetTable bonus 35/85). Upstream max levels = the `max` shown on officier.html for all 15 → the vars are likely untouched.

---

## 2. Storage [REAL resources.html, overview.html, messages-spy.html]

Upstream: `storage = floor(2.5 · 1.8331954764^L) · 5000` [UPSTREAM install/install.sql:957-959 (storage901..903 of 22/23/24)], × `storage_multiplier` × (1 + factor.ResourceStorage) [UPSTREAM class.PlanetRessUpdate.php:287-289]; production stops at `storage · max_overflow` [PlanetRessUpdate.php:145-158]. Level 0 → 10 000 × 5 = **50 000**.

R8 `storageMultiplier(doc, levels)` (RUN with `{22:18, 23:17, 24:16}` from buildings.html):
```js
const storageMultiplier = (doc, levels) => {
  const st = (L) => Math.floor(2.5 * Math.pow(1.8331954764, L)) * 5000;
  return resourceTickers(doc).slice(0, 3).map((t, i) => { const L = levels[22 + i];
    return { res: 901 + i, storageLevel: L, limit: t.limit, upstreamFormula: st(L), multiplier: t.limit / st(L) }; });
};
// resources.html ->
// [{"res":901,"storageLevel":18,"limit":3416925000,"upstreamFormula":683385000,"multiplier":5},
//  {"res":902,"storageLevel":17,"limit":1863925000,"upstreamFormula":372785000,"multiplier":5},
//  {"res":903,"storageLevel":16,"limit":1016750000,"upstreamFormula":203350000,"multiplier":5}]
```

R9 `spyResourceCaps(doc)` — other players' planets (RUN, messages-spy.html):
```js
const spyResourceCaps = (doc) => [...doc.querySelectorAll('.spyRaport')].map((rep) => {
  const st = (L) => Math.floor(2.5 * Math.pow(1.8331954764, L)) * 5000;
  const head = rep.querySelector('.spyRaportHead').textContent.trim();
  const cells = [...rep.querySelector('.spyRaportContainerHeadClass900').parentElement.querySelectorAll('.spyRaportContainerCell')].map((c) => c.textContent.trim());
  const res = {}; for (let i = 0; i + 1 < cells.length; i += 2) res[cells[i]] = gzNum(cells[i + 1]);
  const capLevel = (v) => { for (let L = 0; L < 60; L++) if (5 * st(L) === v) return L; return null; };
  return { head, res, atCap5xLevel: Object.fromEntries(['Metal', 'Crystal', 'Deuterium'].map((k) => [k, capLevel(res[k])])) };
});
// [{"head":"Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44","res":{"Metal":2684939750000,"Crystal":1700557697522,"Deuterium":675144412230,"Energy":356568},
//   "atCap5xLevel":{"Metal":29,"Crystal":null,"Deuterium":null}},
//  {"head":"Spy Report Colony [2:72:6] on 30. Oct 2026, 09:53:28","res":{"Metal":11483000000,"Crystal":11483000000,"Deuterium":6263925000,"Energy":3391},
//   "atCap5xLevel":{"Metal":20,"Crystal":20,"Deuterium":19}}]
```
Four spied values equal `5 × formula(L)` to the unit, on planets of other players → the ×5 is the universe `storage_multiplier` (no upstream officer raises ResourceStorage at all; 607 "Storage expert" is ship cargo, and it is 0 here) and `max_overflow = 1.0`. A full storage in a spy report is the normal state of inactive targets here; loot calculators must cap at the report value, not at production × time.

Selector pitfalls: `.spyRaportContainerHeadClass900` is the resources section; cell pairs are name/value; values can be trillions (above 2^31, fine in JS doubles, still exact < 2^53).

---

## 3. Costs [REAL buildings.html, research.html, fleetDealer.html]

* Buildings and research: price of the step current level `L` → `L+1` = `cost · factor^L` per resource (`= cost · factor^(target−1)`), no rounding in PHP, floor for display [UPSTREAM includes/classes/class.BuildFunctions.php:94-96]. Destroy: half the price of the current level [BuildFunctions.php:102-104]. Factors: elements.json (`1.5` for 1-4 incl. crystal mine, `2.0` for 12, storages, most research, `1.75` for 124). Verified on 35 buy buttons, see buildings.md §3 [DERIVED, HIGH].
* Units: fixed price per unit. The server's own list `var CostInfo = {id:[amountOnPlanet, name, {901..921: "cost"}]}` on page=fleetDealer.

R13 `costInfo(doc)` (RUN, fleetDealer.html; the runner then diffs it against elements.json):
```js
const costInfo = (doc) => {
  const s = [...doc.scripts].find((x) => /CostInfo\s*=/.test(x.textContent));
  const m = s && s.textContent.match(/CostInfo\s*=\s*(\{.*?\});/s);
  return m ? Object.fromEntries(Object.entries(JSON.parse(m[1])).map(([id, [n, name, c]]) =>
    [id, { name, cost: Object.fromEntries(Object.entries(c).filter(([, v]) => +v).map(([k, v]) => [k, +v])) }])) : null;
};
// {"202":{"name":"Light Cargo","cost":{"901":2000,"902":2000}}, … ,"218":{"name":"Avatar","cost":{"901":275000000,"902":130000000,"903":60000000}},
//  "219":{"name":"Battle Recycler","cost":{"901":1000000,"902":600000,"903":200000}}, … ,"410":{"name":"Gravitons Cannon","cost":{"901":15000000,"902":15000000}}}
// costInfo-vs-elements.json {"ids":26,"diff":[]}
```
So upstream 2Moons unit prices are in force for 202-220, 401-406, 410 (407-409, 411, 502, 503 not listed there; assume upstream).

Statistics points: overview shows `489 (Position 194 of 547)` for an account with metal mine 38; upstream `stat_settings` (resources per point) default 1000 cannot produce that → the fork uses a much larger divisor or a different points formula [UNKNOWN; not needed by calculators, do not use points × 1000 as "resources spent"].

---

## 4. Build, research and shipyard time [UPSTREAM only — game_speed UNKNOWN]

No saved page shows any duration: the list pages have no times (buildings.md §5), the details panel comes from `page=TechnologyDetailsAjax|ShipDetailsAjax` (not captured), and all queues were empty. Upstream [UPSTREAM includes/classes/class.BuildFunctions.php:131-179]:

```
cost      = metal + crystal of that step (deut and DM ignored)
building  : h = cost / (game_speed · (1 + Robotics14)) · 0.5^Nanite15 · (1 + factor.BuildTime)
ship      : h = cost / (game_speed · (1 + Shipyard21)) · 0.5^Nanite15 · (1 + factor.ShipTime)          (per unit)
defence   : h = cost / (game_speed · (1 + Shipyard21)) · 0.5^Nanite15 · (1 + factor.DefensiveTime)     (per unit)
research  : h = cost / (1000 · (1 + labLevel)) / (game_speed / 2500) · (1 − factor_university/100)^University6 · (1 + factor.ResearchTime)
            labLevel = this planet's lab, or with IRN 123 the sum of the best labs that meet the requirement
seconds   = floor(h · 3600) (destroy: floor(h · 1300)); at least min_build_time (default 1 s)
```
`game_speed` is stored ×2500 (2500 = speed 1); `factor_university` default 8 [UPSTREAM install/install.sql:160,262]. Unlike OGame there is no `max(4 − L/2, 1)` divisor and no separate research speed.

Hypotheses (do not hard-code): admins often set `game_speed = fleet_speed` (17500 = ×7) or scale it like `resource_multiplier` (22000 = ×8.8 with 2500 = ×1 would be odd). Example, metal mine 38→39 here (294 862 195 M + 73 715 548 C, Robotics 20, Nanite 10): at ×1 = 24 681 s; at ×7 ≈ 3 526 s. **Capture one real time and solve for it** (open question 1):

```js
// game_speed from one observed building time (seconds shown in the details panel or queue)
const gameSpeedFromBuilding = (metal, crystal, seconds, robot, nanite, buildTimeFactor = 0) =>
  (metal + crystal) * 3600 / (seconds * (1 + robot)) * Math.pow(0.5, nanite) * (1 + buildTimeFactor);   // ~2500·k
// NOT RUN on a real page (no time exists on any saved page). Self-check: gameSpeedFromBuilding(294862195, 73715548, 24681, 20, 10) = 2500.06
```

---

## 5. Fleet: speed, flight time, fuel, cargo, slots [REAL fleetStep1.html, fleetTable.html, overview.html]

Formulas and their verification are in fleet.md §4 (distance, duration, consumption reproduce 5 / 1020 / 47 s / 653 s / 2 / 118 deut). Constants:

R10 `fleetStep1Data(doc)` (RUN):
```js
const fleetStep1Data = (doc) => {
  const m = [...doc.scripts].map((s) => s.textContent).join('\n').match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
  const data = m ? JSON.parse(m[1]) : null;
  return data && { gamespeed: data.gamespeed, fleetSpeedConfig: data.gamespeed * 2500, fleetspeedfactor: data.fleetspeedfactor,
    fleetMinDuration: data.fleetMinDuration, fleetroom: +data.fleetroom, ships: data.ships };
};
// fleetStep1.html -> {"gamespeed":7,"fleetSpeedConfig":17500,"fleetspeedfactor":1,"fleetMinDuration":5,"fleetroom":7500,
//                     "ships":{"208":{"consumption":"1000","speed":6000.000000000001,"amount":"1"}}}
```
`gamespeed` = `fleet_speed / 2500` [UPSTREAM class.FleetFunctions.php:124-127]; `fleetspeedfactor` = `max(0, 1 + factor.FlyTime)` (General 613 −10 %/level); `fleetroom` = Σ capacity × (1 + factor.ShipStorage) (607 Storage expert +50 %/level, 0 here). 7500 for one colony ship with Hyperspace Tech 114 = 8 → **no per-level cargo bonus** (OGame gives +5 %/level).

R11 `harvestFlight(doc)` — independent check of `fleet_speed` with a different ship (RUN, overview.html):
```js
const harvestFlight = (doc) => {
  const seen = new Map();
  for (const s of doc.querySelectorAll('span.fleets[id^="fleettime_"][data-fleet-end-time]')) {
    const line = s.parentElement.querySelector('span.flight, span.return');
    if (!line || !/harvest/.test(line.className) || seen.has(s.id)) continue;      // each event is rendered twice (duplicated ids)
    seen.set(s.id, { end: +s.dataset.fleetEndTime, status: line.classList.contains('return') ? 'return' : 'flight',
      blind: (line.querySelector('.textForBlind') || {}).textContent, coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map((a) => a.textContent) });
  }
  const ev = [...seen.values()], out = ev.find((e) => e.status === 'flight'), back = ev.find((e) => e.status === 'return');
  return { events: ev, oneWaySeconds: out && back ? back.end - out.end : null };
};
// {"events":[{"end":1793348429,"status":"flight","blind":" (8290 Recycler)","coords":["[2:68:5]","[2:87:8]"]},
//            {"end":1793350031,"status":"return","blind":" (8290 Recycler)","coords":["[2:87:8]","[2:68:5]"]}],"oneWaySeconds":1602}
```
Check: distance 2700 + 95·19 = 4505; recycler 209 speed 2000 × (1 + 0.1 × combustion 12) = 4400; `(3500·sqrt(45050/4400) + 10) / 7 = 1601.32 s`. The server does not round the duration (PHP float, [UPSTREAM class.FleetFunctions.php:100-113]); start = now + 1601.32 and end = now + 3202.64 are stored in INT columns (MySQL rounds) → 1601 and 3203 → difference 1602 observed. **Expect ±1 s between the JS prediction and server times.**

R12 `fleetTableFacts(doc)` (RUN, fleetTable.html):
```js
const fleetTableFacts = (doc) => {
  const divs = [...doc.querySelectorAll('.fleetTablemain th[colspan="9"] > div.transparent')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());
  const pair = (s) => (s.match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).map(Number);
  const bonus = Object.fromEntries([...doc.querySelectorAll('.fleetTablemain table.hard-table img.tooltipTop[title]')]
    .map((i) => [i.getAttribute('src').match(/([a-z]+)\.png$/)[1], +i.title.match(/(-?\d+)\s*%$/)[1]]));
  const speeds = Object.fromEntries([...doc.querySelectorAll('td[id^="ship"][id$="_value"]')].map((td) => {
    const sp = td.parentElement.querySelector('span.tooltip[data-tooltip-content]');
    return [+td.id.match(/\d+/)[0], sp ? +sp.dataset.tooltipContent.replace(/\D/g, '') : null]; }));
  return { slots: pair(divs[0]), expeditions: pair(divs[1]), asteroids: pair(divs[2]), bonus, speeds };
};
// {"slots":[1,13],"expeditions":[0,2],"asteroids":[0,5],"bonus":{"attack":35,"defence":85,"shield":60,"combustion":120,"impulse":140,"hiperspace":120},
//  "speeds":{"208":6000,"210":220000000,"212":null}}
```
Derivations [UPSTREAM includes/pages/game/ShowFleetTablePage.class.php:281-286, class.FleetFunctions.php:67-70,129-133]:
* bonus attack = 109·10 + factor.Attack·100 = 2·10 + 15 → 35; defence = 110·10 + factor.Defensive·100 = 7·10 + 15 → 85; shield = 111·10 = 6·10 → 60. (Key by icon file name `attack/defence/shield` = tech 109/110/111 as upstream maps them; 2Moons calls 110 `defence_tech` and 111 `shield_tech`, OGame's ids name them shielding/armour, so do not trust labels.) All three match → upstream Engineer bonuses.
* engines: 115·10 = 120, 117·20 = 140, 118·30 = 120 → speed per level +10/+20/+30 %.
* slots `1 + 108 + factor.FleetSlots` = 1 + 12 = 13; expeditions `floor(sqrt(124))` = floor(√6) = 2; asteroid counter `0 / 5` is GALAXYZ-only (rule unknown).

Cargo / fuel / speed base values per ship: elements.json (`capacity`, `consumption`, `consumption2`, `speed`, `speed2`, `speedTech`), upstream [install/install.sql:986-1004]. Notable 2Moons extras: 217 Battle Transporter cap 400 000 000 upstream, but 40 000 000 on Aeternum (reported by the user from the live game 2026-10-31; the catalog uses the live value), 219 Battle Recycler cap 200 000 000 (recycles), 220 DM Collector cap 6 000 000, 214 cap 1 000 000. Only 208 and 210 are verified live (speeds and the 7500 cargo); others MED.

Fuel [UPSTREAM class.FleetFunctions.php:162-176 / scripts/game/flotten.js]: `Σ consumption · amount · d/35000 · (spd/10 + 1)²` with `spd = 35000/(round(duration)·gamespeed − 10) · sqrt(10·d/speed)`, rounded, `+ 1`. Hold (mission 5) and expedition do not add holding fuel in upstream. Return trip needs no fuel. Consumption is part of cargo (`fleetroom − consumption`).

---

## 6. Combat economics: loot, debris, moon, defence rebuild [UPSTREAM only]

No combat report is saved (messages-all has none) → all LOW confidence; first real report should confirm `reportSteal` and debris lines.

* **Loot** [UPSTREAM includes/classes/missions/functions/calculateSteal.php:36-77]: capacity = Σ capacity · amount · (1 + ShipStorage) − resources already carried. Then
  `M = min(cap/3, metal/2)`; `C = min((cap−M)/2, crystal/2)`; `D = min(cap−M−C, deut/2)`; then top-up `M += min(rest/2, metal/2 − M)`; `C += min(rest, crystal/2 − C)`. Max loot = **50 %** of each resource; no class bonus (2Moons has no classes). Split among ACS fleets by capacity share.
* **Debris** [UPSTREAM missions/functions/calculateAttack.php:266-311, MissionCaseAttack.class.php:178-179]: `Fleet_Cdr` % (default **30**) of metal+crystal of destroyed ships (both sides), `Defs_Cdr` % (default **0**) of destroyed and not rebuilt defence; deuterium never. Values are config; Aeternum's unknown.
* **Defence rebuild** [calculateAttack.php:287-293]: `round(lost · rand(56, 84)/100)` per defence type (mean 70 %).
* **Moon chance** [MissionCaseAttack.class.php:341-352]: `min(round(debrisTotal / 100000 · moon_factor), moon_chance)`, defaults 1.0 and 20 % → at this economy every real fight has the maximum chance. Only planet targets without a moon.
* **Spy debris**: destroyed probes go to debris with `Fleet_Cdr` [MissionCaseSpy.class.php:201-202].
* Spy report discovery line `The spy probes discovery chance was: 0 %` [REAL messages-spy.html].

---

## 7. Expeditions [REAL galaxy.html, fleetTable.html; rules UPSTREAM]

* Target: position **16** (`max_planets + 1`), mission 15; prefill `page=fleetTable&galaxy=2&system=68&planet=16&planettype=1&target_mission=15` [REAL galaxy.html]. R15 `expeditionPosition(doc)` (RUN) → `[16]`:
  `[...new Set([...doc.querySelectorAll('a[href*="target_mission=15"]')].map((a) => +new URL(a.href).searchParams.get('planet')))]`
* Slots `floor(sqrt(Astrophysics 124))` = 2 here [REAL "0 / 2 expedition"]; they also use normal fleet slots.
* Stay time options: `staytime` = 1..level(124), hours = `round(i / halt_speed, 2)` (default `halt_speed` 1) [UPSTREAM class.FleetFunctions.php:184-191]. Expedition fleetStep2 was not saved → `halt_speed` UNKNOWN.
* Outcome [UPSTREAM includes/classes/missions/MissionCaseExpedition.class.php:36-500]: `mt_rand(1, 9)`: 1 resources, 2 dark matter (100-300, rarely up to 3000), 3 ships, 4 pirates/aliens fight, 5 fleet lost, 6 return time changed (75 %: later by stay+return+2..5 s; else earlier), 7-9 nothing — each 1/9.
* Resources found (event 1): resource 901 (50 %), 902 (33 %, /2), 903 (17 %, /3); amount = `round(min(freeCapacity, min(maxFactor, max(200, factor)) · fleetPoints))`, `fleetPoints = Σ amount · (metal+crystal cost) · 5/1000`, `maxFactor` 2400/6000/9000/12000 by top player points (<100k / >100k / >1M / >5M). Upstream quirk: `factor` is 10..200, so `max(200, factor)` is always 200 → **found = min(free cargo, 200 · fleetPoints)** (the /2, /3 are lost). Expedition yields do not scale with `resource_multiplier` → negligible next to 1.9 B metal/h, cargo is the limit.
* Ships found (event 3): `max(round(size · min(fleetPoints, 4500|6000)), 10000)` worth of units [MissionCaseExpedition.class.php:147-215].
* GALAXYZ also shows `0 / 5 Asteroids` (fleetTable) and has DM-collector mission 11 to own moons [UPSTREAM]; asteroid rules UNKNOWN.

---

## 8. Trader [REAL trader.html]

R14 `traderFacts(doc)` (RUN) → `{"rate":"4/2/1","fee":"100"}`. Upstream charge table `{901:{902:2, 903:4}, 902:{901:0.5, 903:2}, 903:{901:0.25, 902:0.5}}` (value metal:crystal:deut = 1:2:4) [UPSTREAM includes/pages/game/ShowTraderPage.class.php:28-32]; the fork prints "4/2/1" and charges 100 DM per trade (upstream default 750). Details in buildings.md §9.

---

## 9. Comparison with OGame / lanedirt OgameX (`ogame_knowledge_base.md`)

| topic | OGame / OgameX | GALAXYZ (Aeternum) |
|---|---|---|
| economy speed | one `economy_speed` for production and build time | production ×22000 via `resource_multiplier`; build time uses separate `game_speed` (unknown) |
| basic income | 30 / 15 | 20 / 10 (× multiplier) |
| deuterium | `10·L·1.1^L·(1.44 − 0.004·Tavg)` | `10·L·1.1^L·(1.28 − 0.002·Tmax)` |
| satellite | `(Tmax+140)/6` | `(Tmax+160)/6`, not floored per unit |
| production boosts | plasma tech, geologist +10 %, classes, crawlers, position bonus | Geologist +5 %/level (×20), 131/132/133 +2 %/level, no plasma/classes/crawlers/position bonus |
| storage | `5000·floor(2.5·e^(20L/33))` | same × 5 (`storage_multiplier`), overflow cap 1.0 |
| crystal mine cost factor | 1.6 | 1.5; fusion 2.0 (OGame 1.8) |
| building time | `(M+C)/(2500·max(4−L/2,1)·(1+robot)·2^nanite·speed)` | no `max(4−L/2,1)`; `/(game_speed·(1+robot))·0.5^nanite` |
| research time | `/(1000·(1+lab)·speed)` | same shape, `·(1−8 %)^University6`, IRN 123 lab sum |
| fleet speed | `fleet_speed` per mission type (OgameX) | single `fleet_speed` 17500 (×7), `fleetMinDuration` 5 s |
| distance | donut galaxies/systems, empty-system skipping | **no** donut, no skipping (fleet.md §4) |
| fuel | per ship `max(…,1)`, round | Σ then `round + 1` |
| cargo | Hyperspace Tech +5 %/level, class bonus | no tech bonus (verified) |
| loot | 50 % (75 % Discoverer), 1/3 split | 50 %, old 2Moons step split |
| debris | 30 % ships, 0 % defence (OgameX settings) | same defaults (config, not verified) |
| moon chance | 1 %/100k, max 20 % | same rule, `moon_factor` × |
| expeditions | weighted outcomes, find scaled by top points, Pathfinder | 1/9 each, `200 · fleetPoints` capped by cargo |
| slots | `1 + computer` (+class/officer), expeditions `floor(√astro)` | same (verified), Commander 611 +3 |
| trader | ratio 3:2:1, fee in DM | 4/2/1, fee 100 DM, DM sellable |

---

## 10. Pitfalls

* Two number dialects: dot-thousands integers (`1.932.927.923`); JS short `3.417&nbsp;M` (= 3.417e9, **dot is thousands**, long scale B = 1e12); PHP short `47.5K` (dot is decimal). Always prefer `resourceTicker` / tooltip / `data-real` exact values.
* `resourceTicker` `production` is per **hour** and a float; `limit[1]` is a string.
* `#planetList`, `#OvfleetEvents`, `fleettime_<id>` etc. are duplicated ids (layout.md); events appear twice in the DOM — dedupe by id.
* Officer names 614/615 are swapped relative to upstream keys; trust ids + measured effects.
* Research levels: text in `.level`, no `data-value`; officer levels `"18/20"`.
* Flight times: server keeps float durations, DB rounds start/end separately → ±1 s.
* Energy shown on overview (`438 / 47.480`, free/produced) differs from resources.html Total (2.502) on the saved pages; they were saved 2 min apart and the fork's conveyors 71/72 may consume energy — do not cross-check them blindly.
* UTF-8 pages; planet names may be Cyrillic (`Главная планета`) or Hungarian (`2 bolygó`): never match on names.

## 11. Open questions (capture these pages to close them)

1. **`game_speed`** (build/research/shipyard time): open one TechnologyDetailsAjax response or start a build and save page=buildings / overview with the timer; solve with `gameSpeedFromBuilding`.
2. Energy bonus is +20 % where Engineer 3 explains +15 %: GALAXYZ-modified engineer, a hidden bonus (`GiveBonus`/tournament/DM item) or energy tech? A resources page with a different engineer level would tell.
3. `Fleet_Cdr`, `Defs_Cdr`, `moon_factor`, loot %: need one real combat report (category 3) and the galaxy debris before/after.
4. `halt_speed` and expedition outcome texts: need fleetStep2 for position 16 and expedition messages (category 15).
5. Asteroid mission (`0 / 5 Asteroids`) rules and mission id.
6. Statistics points formula (489 points for this account).
