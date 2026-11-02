# OGame Live → OgameX Live: porting spec

Scope: a module-by-module study of OGame Live (open source, `src/ogameLive/`, MV3 extension by loclamor, about 3.5k lines of JS). For each module it gives what the module shows, where it injects UI, what it parses (with the original selector and file:line), how it stores data, every formula, its options, and the OgameX equivalent of each source (selector or endpoint, with the OgameX file:line). It ends with a feature-by-feature porting table and copy-ready recipes that were checked against the fixtures.

Other specs in `ogx/specs/` already cover the OgameX side in depth. This spec links to them instead of repeating them:
- `layout.md`: planet list, resource bar, `reloadResources` inline data, CSRF, server time, metas, `?cp=`, menu, `/overlay/server-settings`.
- `buildings.md`: list pages, queue timers, technology-details AJAX, resource settings, formulas.
- `fleet.md`: `/fleet` page, check-target `shipsData`, event list, synthetic ids.

Path prefixes:
- `OL/` = `src/ogameLive/` (OGame Live checkout)
- `OX/` = `src/OGameX/` (OgameX checkout)
- `main` = `OX/resources/views/ingame/layouts/main.blade.php`
- `bundle` = `OX/resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js`
- `FEC` = `OX/app/Http/Controllers/FleetEventsController.php`
- `EXM` = `OX/app/GameMissions/ExpeditionMission.php`
- `TTC` = `OX/app/Http/Controllers/TechtreeController.php`
- `fidx` = `OX/resources/views/ingame/fleet/index.blade.php`

## 0. Fixtures and verification

| File | What it is |
|---|---|
| `fixtures/ogamelive-techtree-tab2-203.html` | **New.** Exact body of `GET /ajax/techtree?tab=2&object_id=203` (Large Cargo), rendered by hand from `techinfo.blade.php`, `info/rapidfire.blade.php`, `info/properties.blade.php` and `info/property_tooltip.blade.php`. Sample player: Collector, armour 8, shielding 6, weapons 7, combustion drive 10, hyperspace technology 8. It replaces OGame Live's `component=technologytree&tab=2` source of ship speed and capacity. |
| `fixtures/ogamelive-expected-parse.json` | **New.** Output of every recipe in section 9 run on the existing fixtures (layout, buildings, fleet, galaxy) and on the new techtree fixture. Regenerate with `node ogx/tools/check_ogamelive.js --write`. |
| `tools/check_ogamelive.js` | **New.** Playwright check (`chromium.launch()`, DOMParser only, no game JS). `RECIPES` in that file is the source of truth for section 9. Exit code 1 on mismatch. |
| Reused | `layout-overview-planet.html`, `layout-overview-moon.html`, `layout-overlay-server-settings.html`, `buildings-overview.html`, `buildings-resources.html`, `buildings-research.html`, `buildings-facilities.html`, `buildings-resource-settings.html`, `buildings-shipyard.html`, `buildings-ajax-*.json`, `fleet-dispatch-planet.html`, `fleet-eventlist.html`, `galaxy-highscore-ajax-players-page2.html` |

A mock server for the content scripts can serve the full-page fixtures above as they are. The pages OGame Live acts on map to OgameX fixtures as follows: overview → `layout-overview-*.html`/`buildings-overview.html`; supplies → `buildings-resources.html`; facilities → `buildings-facilities.html`; research → `buildings-research.html`; shipyard → `buildings-shipyard.html`; resource settings → `buildings-resource-settings.html`; fleet dispatch → `fleet-dispatch-*.html`. AJAX: `/ajax/fleet/eventlist/fetch` → `fleet-eventlist.html`; `/ajax/<page>?technology=` → `buildings-ajax-*.json`; `/ajax/techtree?tab=2&object_id=203` → `ogamelive-techtree-tab2-203.html`; `/overlay/server-settings` → `layout-overlay-server-settings.html`; `POST /ajax/highscore` → `galaxy-highscore-ajax-*.html`. OgameX has no empire page.

---

## 1. OGame Live architecture

### 1.1 Manifest (`OL/manifest.json`)

- MV3. One content-script bundle on `https://*.ogame.gameforge.com/game/*` with `run_at: document_start`. The CSS `src/ogameLive.css` is injected by the manifest.
- Script order (it matters because everything is global): jQuery, `constants.js`, `dataManager.js`, `utilities.js`, `router.js`, `ogameLive.js`, `parameters.js`, observers, displays, parsers, `ogameLive.user.js` (bootstrap), `worker.js`. `worker.js` is also listed as a content script, but it only does real work as the MV3 `background.service_worker`.
- `web_accessible_resources`: `src/window.js` (page-world script), CSS, icons and `planet-targets.png`.
- `permissions: []`. All requests are same-origin jQuery `$.get` from the content script.
- The popup `src/ogameLive.html` only shows "Thank you".

**OgameX port:** match `http://*/*` and `https://*/*`, or use optional host permissions, and gate at runtime with `isOgxIngame()` (`layout.md` §1). Never run on `*.ogame.gameforge.com`. Use `document_idle` or wait for `DOMContentLoaded`, because the planet list must exist. Tooltips must be read before Tipped strips them (`layout.md` §4.2), so the safest choice is `document_end` plus reading `title` attributes synchronously at start.

### 1.2 Global objects

| Global | Defined at | Meaning |
|---|---|---|
| `OgameConstants` | `OL/src/constants.js:1-117` | ids: class names, resource-box ids → letters (`metal_box`→`M`, …), resource ids (`metal:1, cristal:2, deut:3, ces:4, cef:12, sat:212, foreuse:217`), research ids, lifeform ids, building ids by group, `fleet` (class_name → id), `missionType` |
| `PARAMS` | `OL/src/ogameLive.user.js:44-74` | user options merged with `DEFAULT_PARAMS`, plus server data (section 3) |
| `LOCALIZATIONS` | `ogameLive.user.js:76` | `{techs:{id↔name}, missions:{id↔name}, initialized}` from `localization.xml` |
| `PLUGINS` | `ogameLive.user.js:42` | detection of OGInfinity, OGLight, UniverseView, InfoCompte (`:259-284`) |
| `urlUnivers`, `numUnivers`, `langUnivers`, `prefix_GMData` | `ogameLive.user.js:29-35` | parsed from `https://s<num>-<lang>.ogame.gameforge.com`; storage prefix `ogameLive.<lang><num>.` |
| `Xpath` | `OL/src/utilities.js:126-148` | XPath helpers (`getNumberValue`, `getStringValue`, `getOrderedSnapshotNodes`, `getSingleNode`) |

**OgameX port:** `prefix_GMData` cannot be built from the hostname. Use `ogxlive:<location.origin>:<playerId>:` (player id from `meta[name=ogame-player-id]`, `layout.md` §3). Several accounts on one self-hosted server must not share data. Register everything on `window.OGX` (project rule) instead of globals.

### 1.3 Two worlds

- Content script (isolated world): everything except `window.js`.
- `OL/src/window.js` is injected as `<script src=chrome-extension://…/window.js>` (`ogameLive.user.js:214-218`). It runs in the page world to reach `window.fleetDispatcher`. It does two things: it shows a ping value in `.ogk-ping` (`window.js:12-18`), and it handles the expedition button (§4.13).
- Communication: `localStorage['ogameLive.expeparams']` (shared because both worlds see the same origin's `localStorage`) and a `CustomEvent('ogameLive.fleetDispatcher.selectExpedition')` listener (`window.js:45`). The button itself uses `href="javascript:sendRandomExpe(...)"` (`betterFleetDisplay.js:74`).

**OgameX port:** the same pattern works. OgameX sends no CSP header that blocks extension scripts (Laravel default). `window.fleetDispatcher` exists on `/fleet` (`fleet.md` §2.6). Prefer a `CustomEvent` over `javascript:` URLs.

### 1.4 Start-up sequence

1. `ogameLive.user.js` top level, at `document_start`: read params; once a day fetch `serverData.xml` and `localization.xml` (`:80-136`). Read the character class from `#characterclass` (`:82-94`).
2. `DOMContentLoaded` (`:142`):
   1. Add body classes (`:144-150`).
   2. `new OgameLive().start()` (`OL/src/ogameLive.js:16-77`):
      - `new FlyingFleetObserver()`: fetches the event list (§4.9).
      - `new PlanetProductionParser()`: parses the current body's resource tooltips (§4.4).
      - `PlanetsProductionDisplay.initialize()` if `show_production == 1` (§4.11).
      - `FlightsDisplay.initialize()` in a `setTimeout(0)` if `show_flights > 0` (§4.14).
      - First `display()` in a `setTimeout(0)`.
      - Every `main_refresh` seconds (`setInterval`, `:49-74`): re-run both `display()`s and update every `.ogamelivecountdown[data-countend]` element with `formatTime(countend - now)`. It sets the attribute `finished="true"` when the countdown reaches 0.
      - `router.handlePage(location.href)` (§4.2).
   3. Inject the dynamic CSS (`:161-164`), the base HTML (production switcher, `.prod` divs, `#flights`) (`:168-202`), `window.js` (`:215-218`), the menu entry (`:223-235`), the empire planet/moon buttons (`:238-242`) and the params button (`:245-251`). Toggle tooltip side classes (`:254`). Add a clock in the galaxy footer (`:257`).
   4. After 2 s, detect other plugins (`:259-284`).
3. The background worker runs its 1 s loop all the time (§4.15).

---

## 2. Storage model

### 2.1 OGame Live

Two stores are used in parallel:

| Store | API | Used for | Source |
|---|---|---|---|
| `localStorage` (game origin) | `GM_getValue/GM_setValue/GM_getJsonValue/GM_setJsonValue` | params, plugins, localizations, `data.fleet` (ship stats), `techdetail`, `data.last_fleetdata_time`, `production.last_render_time`, `debug.loglevel`, sync read caches of `data.<planet>` / `production.<planet>` | `utilities.js:7-32` |
| Service worker + IndexedDB `ogameLiveDB` / store `ogameLiveStorage` (`keyPath: key`) | `storeValue(key, value, force, timestamp)` → `chrome.runtime.sendMessage({type:'setvalue'})`; `retrieveValue`, `retrieveMultipleValues` → `readvalue` / `readmultiplevalues` | per-body `data.*`, `production.*`, `flights`, `globaldata`, `params` | `utilities.js:41-86`, `worker.js:101-210` |

The worker keeps an in-memory `tempStore` split by key substring (`production`, `data`, `params`, `flights`, `others`) (`worker.js:26-32, 64-79`). It loads everything from IndexedDB at start. **Production values are only held in memory and are written to IndexedDB every 10 iterations (10 s)** (`worker.js:374-376`). `setValue` for `production.*` without `force` only replaces the stored value when its `lastTime` is newer (`worker.js:130-141`).

Key layout (each prefixed by `ogameLive.<lang><num>.`):

| Key | Shape | Writer |
|---|---|---|
| `planetsIdToCoords` / `planetsCoordsToId` | `{"planet-33620000": "1:42:8"}` and the reverse | `dataManager.js:17-33` |
| `data.<planetId>` and `data.<planetId>-moon` | `{resources:{metalMine:22,…}, installations:{…}, lifeform:{…}, currentBuild:{building, targetLevel, start(ms), end(ms)}, currentLifeBuild, prodPercents:{metal,cristal,deut,ces,cef,sat,foreuse}, fleet:{fighterLight:n,…}, vaissels:<n ships except 212/217>}` | parsers §4.5-4.8 |
| `production.<planetId>[-moon]` | `{M:{dispo,capa,prod,cache,lastprod?}, C:{…}, D:{…}, E:{dispo,prod}, F:{dispo,capa,surprod,conso,durability,lastprod?}, P:{…}, lastTime(ms)}`. `prod` is **per hour**; `F.surprod` is **per second**. | §4.4, §4.7, worker |
| `data.research` | `{energy:12, laser:…, combustionDrive:…}` (short keys from `OgameConstants.research`) | §4.5 |
| `data.fleet` (localStorage) | `{fighterLight:{speed:{value,…dataset}, structural, shield, attack, capacity, consumption}}`: the **dataset objects** of the techtree spans | §4.8 |
| `globaldata` | `{slots, usedSlots, textSlots, expeSlots, usedExpeSlots, textExpeditions}` | §4.8 |
| `flights` | `{<eventId>: flight}` (§4.9) | §4.9, worker |
| `techdetail` (localStorage) | `{<techId>: {<level>: {cost:{M,C,D,lastParsedTime}, boost:{}}}}`; template `OL/techDetail.json` | §4.10 |
| `params`, `plugins`, `data.localizations` | see §3 | bootstrap |
| `ogameLive.expeparams` (raw localStorage, no prefix) | `{expeditionTime, speedPercent}` | `window.js:25-28` |

### 2.2 OgameX port (recommended)

- Use one store, `chrome.storage.local`, with a `localStorage` fallback for the userscript build (project rule). Do not port the IndexedDB worker or the 1 s background loop.
- Store **snapshots** `{amount, storage, perHour, t}`, where `t` is server epoch ms. Compute current amounts on render with the projection in §5.1. This is exactly what the worker loop computes, without background writes or the 10 s loss window.
- Keys: `ogxlive:<origin>:<playerId>:body:<p|m><id>`, `…:research`, `…:ships` (effective ship stats), `…:flights`, `…:global`, `…:params`, `…:titles`.
- **Key bodies by the real OgameX ids**: `p<planetId>` from `.smallplanet[data-planet-id]`, and `m<moonId>` from the moonlink `?cp=` (`layout.md` §4.1). The `.smallplanet` id is a 1-based **index** (`planet-1`, `planet-2`) that shifts when a planet is added or abandoned.

---

## 3. Parameters and server data

### 3.1 User options (`OL/src/parameters.js:6-95`, defaults `ogameLive.user.js:44-64`)

| Key | Default | Label | Values | Effect |
|---|---|---|---|---|
| `game_style` | `'miner'` | Game style | `raider`, `miner` | `miner`: per-planet production rates, the needed-transporter counter and the planets/moons switcher. `raider`: only stocks, with planet and moon columns shown side by side (CSS) (`planetsProductionDisplay.js:231-274`, `ogameLive.user.js:169-189`) |
| `show_production` | `1` | Activate production display | 1/0 | `PlanetsProductionDisplay` on and off; adds `noprod` to `#planetbarcomponent` |
| `prod_display` | `'hour'` | Production display | `hour`, `day` | shows `+x/h` or `+x/d` (both are rendered; one gets the class `hidden`) |
| `energie_display` | `1` | Energy per planet | 1/0 | `#e_dispo` bar |
| `sum_display` | `1` | Sum per planet | 1/0 | `#s_dispo` Σ line |
| `prod_round` | `0` | Production round | 1/0 | `formatInt` uses `readablize` (`1.23M`) instead of dotted integers |
| `show_needed_transporters` | `1` | Needed transporters | 1/0 | `PT x/y - GT x/y` per body (miner only) |
| `show_fleet_speed` | `1` | Fleet speed | 1/0 | speed badge on the ship icons on the fleet page |
| `main_refresh` | `1` | Refresh interval (s) | 0..120 | `setInterval` period; 0 means no refresh |
| `random_system` | `0` | Random systems | 0..99 | ± systems for the expedition button |
| `show_cost_overlay` | `1` | Cost overlay | 1/0 | `BetterTechDisplay` |
| `show_stationed_ships` | `1` | Stationed ships | 1/0 | `.aquai` fleet bar on planet and moon links |
| `show_flights` | `1` | Custom flight component | 2 right, 1 left, 0 off | `#flights` container in the left menu or in the planet bar |

The modal is `#ogameliveparameters` (`parameters.js:99-142`), opened from `#ogameliveparamsbutton` (⚙ in the menu entry). Every change is saved at once. Closing the modal reloads the page.

### 3.2 Server data (hidden params, refreshed daily, `ogameLive.user.js:80-116`)

| Param | Official source | Used by | OgameX replacement |
|---|---|---|---|
| `class` | `#characterclass a div.<explorer|warrior|miner>` | (not used afterwards; `computeMaxExpeRessources` reads the undefined `PARAMS.player_class`) | Same markup: `#characterclass .sprite.characterclass.<miner|warrior|explorer|none>` (`main:287-306`, `layout.md` §9.3). The OGame Live XPath works as is. |
| `lifeform` | `serverData.xml <lifeformSettings>` exists | gates all food/population code | Always `false`. OgameX has no lifeforms (population and food tiles are commented out, `layout.md` §6.1). |
| `nb_systems` | `serverData.xml <systems>` | random expedition system wrap | `499`, the constant `UniverseConstants::MAX_SYSTEM_COUNT`, emitted as `var MAX_SYSTEM = 499;` on `/fleet` (`fidx:170`). |
| `top_score` | `serverData.xml <topScore>` | expedition table (dead code) | Rank-1 points: `POST /ajax/highscore` with `category=1&type=0&page=1&_token=…` → `#ranks tbody tr[id^="position"]:first-child td.score` (formatted `21,339`) (`HighscoreController::ajaxPlayer`, `web.php:214`). Cached 5 min server-side. |
| `speed` | `serverData.xml <speed>` | expedition multiplier | `meta[name="ogame-universe-speed"]` (`main:32`) on every page, or `/overlay/server-settings` `speedfactor` `x<N>` (`layout.md` §11). |
| `lastServerData` | timestamp | daily refresh | keep (daily or on version change) |

---

## 4. Modules

Every subsection gives: **Shows**, **Injects at**, **Parses** (OL selector, file:line), **Stores**, and **OgameX**.

### 4.1 Bootstrap UI (`OL/src/ogameLive.user.js`)

| Element | OL code | OgameX target | Notes |
|---|---|---|---|
| Body classes `ogamelive [ogameinfinity] [oglight] …` | `:144-150`, `:277-283` | `body` | harmless; plugin detection is irrelevant (detect our own Infinity port instead) |
| Production switcher "Planets productions / moons ▶" (miner) or "Planets / Moons" labels (raider) | `:169-189` → `jQuery('#countColonies').append(...)`; click toggles `#planetbarcomponent #rechts #planetList.displayMoonProd` | `#countColonies` exists (`main:1724`; `p.textCenter > span` "2/8" inside) | Auto-switch when the current body is a moon: OL tests `getCurrentPlanetId().endsWith('moon')` (works only on official OGame; see 4.3) |
| `.prod.<game_style>` container per planet | `:191` → `jQuery(".smallplanet").append('<div class="prod miner"></div>')` | `#planetList > .smallplanet` (`main:1737-1738`) | Compact layout with 6 or more planets (`.smaller`, 33 px rows) needs its own CSS (`layout.md` §4.1) |
| Planet-bar classes `energie/noenergie sum/nosum noprod` | `:192-196` | `#planetbarcomponent` | CSS hooks |
| `#flights` container | `:198-202`: `#left, #leftMenu` (show_flights=1) or `#planetbarcomponent` (=2) | `#left` (`main:496`) exists; there is no `#leftMenu` | |
| Menu entry `li#ogamelive-menu-button` with logo, version and ⚙ | `:223-235` → `#menuTable` | `ul#menuTableTools` (empty, made for tools, `layout.md` §12) or `#menuTable` (`main:514`) | Link targets: GitHub issues or board, replace with nothing or the params |
| Empire planet/moon icon links | `:238-242` → `li>span.menu_icon>span.empire` | **No empire page in OgameX** (no route in `web.php`) | drop |
| Tooltip side toggle | `:254` `.smallplanet > a` toggle `tooltipRight tooltipLeft` | planet links have `tooltipRight` (`main:1754`) | cosmetic |
| Galaxy footer clock and ping | `:257` → `.ctGalaxyFooter #colonized` after; `window.js:12-18` writes `.ogk-ping` | `OX/resources/views/ingame/galaxy/index.blade.php:505-506` has `.galaxyRow.ctGalaxyFooter > #colonized` | optional |
| Seasonal text in `#eventboxBlank` | `ogameLive.js:9-13` | `#eventboxBlank` (`main:365`) | drop |

### 4.2 Router (`OL/src/router.js:4-75`)

| OL regex on `location.href` | Handler | OgameX page (path; `body#id`) |
|---|---|---|
| `component=overview` | `dataManager.getPlanetCoords()` (store the coords map) | `/overview`; `overview` |
| `page=resourceSettings` or `component=resourcesettings` | `ResourceSettingsParser` | `/resources/settings`; `resourceSettings` |
| `component=research` | `ResearchParser`, `TechDetailObserver`, `BetterTechDisplay` | `/research`; `research` |
| `component=supplies` | `ResourcesParser`, `TechDetailObserver`, `BetterTechDisplay` | `/resources`; `resources` |
| `component=facilities` | `InstallationsParser`, … | `/facilities`; `station` |
| `component=lfbuildings` / `lfresearch` (if lifeform) | `LifeParser`, … | none |
| `component=shipyard` | `FleetParser.parse(false)`, `TechDetailObserver`, `BetterTechDisplay` | `/shipyard`; `shipyard` (also `/defense`; `defense` for the cost overlay) |
| `component=fleetdispatch` | `FleetParser.parse(true)`, `BetterFleetDisplay` | `/fleet`; **`ingamepage`**, so detect by path or by `#fleetdispatchcomponent` (`fleet.md` §2.1) |
| `component=empire` | `EmpireParser`, which disables the timer | none (see 4.7) |

**OgameX:** route on `location.pathname` (exact match after removing a trailing `/`), not on the query string (`layout.md` §2, §10). Note `/resources/settings` starts with `/resources`, so test the longer path first. The OL regexes are unanchored, so `component=research` would also match `lfresearch`.

### 4.3 DataManager (`OL/src/dataManager.js`)

- `getPlanetCoords()` (`:17-33`): XPath `//div[contains(@id,"planetList")]/div[contains(@class,"smallplanet")]` → `id` and `a/span[contains(@class,"planet-koords")]`. In OgameX the same nodes exist, but `id` is `planet-<index>`, and `contains(@id,"planet-1")` also matches `planet-10`. **Use** `#planetList > .smallplanet[data-planet-id]` and `.planet-koords` (`layout.md` §4.3; recipe `parseBodies`).
- `getCurrentPlanetId()` (`:44-59`): `.smallplanet.hightlightPlanet` id, otherwise `.hightlightMoon` id + `-moon`. With a single planet it forces `hightlightPlanet`. **OgameX has no `hightlightMoon`**, and highlights nothing when the account has a single body (`layout.md` §4.1 items 2-3). **Use** `meta[name=ogame-planet-id]` and check it against the moonlink `cp` ids (recipe `currentBody`).
- `computeNeededPT/GT(amount)` (`:102-118`) = `ceil(amount / capacity)`, where capacity is `data.fleet.transporterSmall|Large.capacity.value`, or 0 when ship data was never fetched.
- Default production object (`:124-148`): `M/C/D {dispo:0, capa:0, prod:0, cache:0}`, `F {…, surprod:0}`, `E {dispo:0, prod:0}`.

### 4.4 PlanetProductionParser: live data of the current body (`OL/src/parsers/planetProductionParser.js`)

- **Runs on every page.** Parses `//div[contains(@id,"resources")]/div[contains(@class,"resource_tile")]/div` (`:8`). For each box it takes the id (`metal_box`…) → a letter, then `data-tooltip-title` or `title`, split on `|`, and parses the right part as HTML. It reads the `//tr/td/span` values in order (`:12-25`).
  - M/C/D: `[dispo, capa, prod(per hour), cache]` (`:28-37`)
  - E: `[dispo, prod]` (`:72-77`)
  - P/F: lifeform rows (`:38-71`)
  - Numbers: `parseInt(text.split('.').join(''))`
- Stores `production.<currentPlanetId>` with `force=true`, `timestamp = page load time` (`:82`). This snapshot is the anchor of the live projection.

**OgameX:**
- The same boxes exist: `#resources > .resource_tile.<res> > #<res>_box[title]` (`main:190-278`). The tooltip row order is the same (Available, Storage capacity, Current production, Den Capacity; energy: Available, Current production, Consumption) (`layout.md` §6.2).
- Two differences:
  - **Numbers use `,` as thousands separator** (`152,347`, `+4128` in the raw title, `+4,128` after the first refresh). OL's `split('.')` gives 152 for `152,347`. Use `OGX_LIVE.num`.
  - The `title` is removed by Tipped after DOM ready (`layout.md` §4.2), so read it at `document_end`.
- **Preferred source:** the inline `reloadResources({...})` script on every page (`main:1363-1432`, `layout.md` §6.3). It holds exact floats: `amount`, `storage`, and `production` **per second** (×3600 for OL's per-hour `prod`). Recipe `parseInlineResources`. Energy: `energy.amount` there, and production/consumption from the energy tooltip.
- **Time anchor:** the server time `var serverTime = new Date('Y-m-d H:i:s')` (`main:839`, `layout.md` §8), not `Date.now()`. Better still: only the current planet is recalculated on each request (`GlobalGame:58`), so the inline amount is exactly "now" at render time.
- Moons in OgameX produce nothing (production 0) and have storage capacity (default 10,000).

### 4.5 Level parsers: ResourcesParser, InstallationsParser, ResearchParser, LifeParser

| Parser | OL selector | Stores |
|---|---|---|
| `ResourcesParser` (`OL/src/parsers/resourcesParser.js:18-32`) | `//div[contains(@id,"technologies")]/ul/li[contains(@class,"<k>")]/span/span[contains(@class,"level")]/@data-value` for `k` in `buildings.resources` (metalMine, crystalMine, deuteriumSynthesizer, solarPlant, fusionPlant, solarSatellite, resbuggy, metalStorage, crystalStorage, deuteriumStorage); build timer `…/span/time[contains(@id,"countdownbuildingDetails")]` `data-start`/`data-end` (s → ms), target `span.targetlevel/@data-value` | `data.<id>.resources`, `.currentBuild` |
| `InstallationsParser` (`installationsParser.js:18-32`) | the same for `buildings.installations` | `.installations`, `.currentBuild` (bug: the init guard at `:10` tests `installations` instead of `currentBuild`) |
| `ResearchParser` (`researchParser.js:7-10`) | `//div[contains(@id,"technologies")]/div/ul/li[contains(@class,"<k>Technology")]/span/span[contains(@class,"level")]/@data-value` | `data.research` |
| `LifeParser` (`lifeParser.js`) | lifeform 11101..11112 | drop |

**OgameX:**
- The class names are identical to OL's constants. OgameX `class_name` values are metalMine…deuteriumStorage, roboticsFactory, shipyard, researchLaboratory, allianceDepot, missileSilo, naniteFactory, terraformer, repairDock, moonbase, sensorPhalanx, jumpGate, energyTechnology, …, armorTechnology, fighterLight…explorer (`buildings.md` §2).
- **Use** `#technologies li.technology[data-technology]` with `span.level` or `span.amount` `[data-value]` (`buildings.md` §3.3). On `/resources` the `ul#producers` is a direct child of `#technologies`, so the OL XPath works there. On research the `div/ul/li` path also works. The recipe `parseLevels` covers all pages.
- **Build timers:** `li[data-start/data-end]` and the `time` inside the `li` hold **fake constants** in OgameX (`buildings.md` §3.2, §10.1). Use `new CountdownTimer('buildingCountdown', <secs>, …)` from the inline queue-box script, which appears on `/overview`, `/resources` and `/facilities`. The target level is in `#productionboxbuildingcomponent table.construction.active td.desc.ausbau span.level` (`buildings.md` §4.2-4.3; recipe `parseBuildTimers`). Then `end = serverNow + secs*1000`.
- **Moons:** OgameX never shows a `.constructionIcon` for moons (`layout.md` §4.1 item 5). A moon build timer is only known from a visit to that moon's `/overview` or `/facilities`.

### 4.6 ResourceSettingsParser (`OL/src/parsers/resourceSettingsParser.js:10-13`)

- OL: `//table[contains(@class,"listOfResourceSettingsPerPlanet")]/tbody/tr[contains(@class,"<resId>")]/td/select` `.value`, which is a percent (0-100), for ids 1, 2, 3, 4, 12, 212, 217. Stored in `data.<id>.prodPercents`.
- Used for warnings: fusion % below 100 (`planetsProductionDisplay.js:110-122`), and the per-mine `middlemark` (<70%) / `overmark` (<40%) classes.
- **OgameX** (`OX/resources/views/ingame/resources/settings.blade.php:24-200`; `buildings.md` §9): the rows have **no id class**. Use `select[name="last<id>"]`, whose value is `0..10` (×10 = percent; crawler up to 15). The energy factor is `span.factorkey` "Production factor: N%". Recipe `parseResourceSettings`. This page also shows production per source, totals per hour/day/week, and storage capacity.

### 4.7 EmpireParser (`OL/src/parsers/empireParser.js`)

- Official `component=empire` (planets) and `&planetType=1` (moons). A MutationObserver on `#mainWrapper` waits for the AJAX-built table (`:20-152`). For each `//div[contains(@class,"planetWrapper")]/div/@id` it reads:
  - `resources/div.metal/span` and `storage/div.metalStorage`, and the same for crystal, deuterium and food (`:64-85`);
  - ships `div.ships/div.<shipId>` (`:134-145`).
- It updates `production.*` (dispo, capa) and `data.*.fleet`/`vaissels` for **all** bodies at once, and disables the main timer (`router.js:73`).
- **OgameX has no empire view** (no route; `web.php`). Replacement ("refresh all bodies"):
  1. For each body from the planet list (`p<id>`, `m<id>`), `GET /fleet?cp=<id>` and parse:
     - inline `reloadResources` (amount, storage, per-second production; `layout.md` §6.3);
     - `var shipsOnPlanet = [...]` (`fleet.md` §2.3, §12.4);
     - `#fleet1 #slots`.
  2. `GET /resources/settings?cp=<id>` (planets only, optional) for percentages.
  3. Restore the user's body with one final request `?cp=<originalId>`. `cp` is persisted server-side for every request, AJAX included (`GlobalGame:43-46`, `layout.md` §5).
  4. Throttle (for example 1 request every 300 ms). Fetching a body also triggers its server-side resource update, so its numbers are exact at fetch time.

  Without this, data accumulates per body as the user visits pages (OL's main mechanism anyway).

### 4.8 FleetParser (`OL/src/parsers/fleetParser.js`)

- Ships on the current body (`:43-53`): `//div[contains(@id,"technologies")]/div/ul/li[contains(@class,"<k>")]/span/span[contains(@class,"amount")]/@data-value` for each `k` in `OgameConstants.fleet`. `vaissels` = sum, excluding resbuggy and solarSatellite.
- Slots (`withFleetSlots`, fleet page) (`:24-41`):
  - `//div[contains(@id,"slots")]/div[1]/span` string minus its inner span text → `"4/6"`; inner text `"Fleets:"`;
  - `div[2]` → expeditions.
  - Stored in `globaldata`.
- Ship stats, at most every 30 min (`:4-16`, `:54-69`): for each ship `GET ?page=ajax&component=technologytree&ajax=1&technologyId=<id>&tab=2`. It stores the `dataset` of `table.combat_unit_details tr.<structural_integrity|shield_strength|attack_strength|speed|cargo_capacity|fuel_consumption> td span`, and later reads `.value` (`data-value`).

**OgameX:**
- Ships: on `/fleet`, `#fleet1 #technologies li.technology[data-technology] span.amount[data-value]`. The `li` class contains the same `class_name` (`fidx:891-933`). Solar satellites and crawlers are **not listed** on `/fleet` (`fleet.md` §2.4). On `/shipyard` all ships are listed (`buildings.md` §3). `shipsOnPlanet` inline is the cheapest (`fleet.md` §12.4). Recipe `parseFleetPage`.
- Slots: `#fleet1 #slots > .fleft > span.advice`. The text is `Fleets: 4/6` and `Expeditions: 1/2` (`fidx:797-810`). The id `#slots` appears **twice** (`fidx:797, 822`), so scope to the first one. OL's XPath happens to work because `getStringValue` returns the first match. The inline `expeditionCount/maxExpeditionCount` are hard-coded `0/1` (`fleet.md` §2.3).
- **Ship stats endpoint:** `GET /ajax/techtree?tab=2&object_id=<shipId>` (`web.php:118`, `TTC:27-82`). It returns an HTML fragment (no JSON), with the same `table.combat_unit_details tr.<class> td > span` structure (`OX/resources/views/ingame/techtree/info/properties.blade.php:2-80`). **But `data-value`, `data-base-value`, `data-bonus` and `data-bonus-formula` are hard-coded literals** (`properties.blade.php:14-15, 26, 37-38, 49-50, 61-62, 73`: speed `data-value="32500"`, capacity `"57"`, fuel `"7"`, …). OL would store the same wrong numbers for every ship. **Read the visible text** (`AppUtil::formatNumber`, `,` thousands) or the tooltip's `td.sum`. Values are effective for this player: research bonus + class bonus (`TTC:276-323`; `OX/app/GameObjects/Services/Properties/*.php`). Speed and capacity rows exist only for ships (`TTC:302-306`). Fixture `ogamelive-techtree-tab2-203.html`; recipe `parseShipProps` gives `{speed:22500, capacity:41250, consumption:50, structural:21600, shield:40, attack:8}`.
- **Alternatives without 17 requests:**
  - check-target `shipsData` (`POST /ajax/fleet/dispatch/check-target`). One request returns all 17 ships with `speed`, `baseCargoCapacity`, `fuelConsumption` (`fleet.md` §3.2), but it needs valid target coordinates (use the current planet's own coordinates, `type=1`).
  - Local computation from `objects.jsonl` plus research levels (`fleet.md` §3.3):
    - cargo `base + intdiv(base*5*hyperspaceTech,100) + intdiv(base*classPct,100)`, where Collector gives +25% for SC/LC and General +20% for recycler and pathfinder (`CapacityPropertyService.php`);
    - speed `effectiveBase × (1 + drivePct·level/100) + effectiveBase × classPct/100` (`SpeedPropertyService.php`).

  Recommended: compute locally, and refresh from check-target or techtree when the fleet page is open.

### 4.9 FlyingFleetObserver: flights (`OL/src/observers/flyingFleetObserver.js`)

- `GET ?page=componentOnly&component=eventList&ajax=1` on **every page load** (`:4`). The parse:
  - Server time: `/var timeDelta = (\d{13}) - \(new Date\(\)\)\.getTime\(\);/` → `timeDelta = ts - Date.now()` (`:6-9`).
  - Rows: `//table[contains(@id,"eventContent")]/tbody/tr` (`:13`). `eventId = id.split('-')[1]`; `data-mission-type`; `data-return-flight`; `data-arrival-time` (s).
    - Mission icon `td.missionFleet img/@src`.
    - Status class `td.countDown span/@class`.
    - `td.arrivalTime` text.
    - `td.destCoords a` text and `@href`, with `td.destFleet figure` (or `span/figure`) class `planet`/`moon`, else `debrisField`. The same for `coordsOrigin`/`originFleet` (`:17-40`).
  - Return flight (`:42-64`): swaps from and dest. It sets `hasPrevious = true` when the row `eventRow-<id-1>` exists (the official outbound row has id − 1), and flags `hasNext` on that row.
  - Tooltip `td.icon_movement span/@title` → `table.fleetinfo td.value` and `td[colspan=2]` names (`:66-70`).
    - Resources = the **last 3** values (4 with lifeform) (`:123-142`).
    - Ships = the earlier rows; the name maps to an id through `LOCALIZATIONS.techs[name]`, then to a key through `OgameConstants.fleet` (`:147-159`).
  - Flight object (`:97-121`): `{eventId, arrivalTime: data-arrival-time*1000 - timeDelta, arrivalTimeStr, destination: getPlanetId(destCoords) (own planet id or undefined), destinationType, coords:{from, fromlink, fromType, dest, destlink, destType}, missionType, missionClass, missionTypeIco, tooltipContent, detailsFleet (ship count), returnFlight ("true"/"false" string), hasPrevious, hasNext, resources:{M,C,D[,F]}, vaissels:{key:n}}`.
  - Stores `flights`, keyed by eventId.
- `FlyingFleetParser` (`OL/src/parsers/flyingFleetParser.js`) clicks `#js_eventDetailsClosed` twice. It is unused (`@Todo`).

**OgameX:** `GET /ajax/fleet/eventlist/fetch` (`web.php:142`, `FEC:202-575`). The markup is close to OGame's (`fleet.md` §9.3). The differences OL's parser trips on:

| OL assumption | OgameX reality | Fix |
|---|---|---|
| `timeDelta` literal is the server time | `var timeDelta = 1713793145000 - …` is a **constant** (`OX/resources/views/ingame/fleetevents/eventlist.blade.php:22`) | Server offset from the layout `serverTime` (`main:839`, `layout.md` §8) or from any JSON `serverTime` |
| Return row id = outbound id − 1 | Synthetic return row id = mission id + **999999**, hold-end row = id + **888888** (`FEC:324-387`). The real return mission appears only after the outbound is processed. | Recipe `eventListToFlights` (`synthetic`, `realMissionId`) |
| `td.countDown span` class tells friendly/hostile | always `friendly`; `missionFleet` title always "Own fleet" | ownership: compare `td.coordsOrigin` (home side) with own coordinates (`fleet.md` §12.2) |
| Numbers `1.234.567` | `31,200` / `1.25Mn` (resources), raw `20` (ships) | `OGX_LIVE.num` |
| Ship names via `localization.xml` | Names are localized `t_resources.<machine>.title` (`eventrow.blade.php:60`, `CivilShipObjects.php:29`) | Title → id map from `li.technology[aria-label]` on `/shipyard` or `/fleet` (recipe `parseTitles`), stored per locale; English fallback `fixtures/messages-object-titles.json` |
| Deep space dest has a figure | expedition dest has `span.deep-space-text`, no figure (`fleet.md` §13.5) | type `deepSpace` |
| Outbound cargo | Outbound tooltip deuterium = cargo + half the fuel (`fleet.md` §13.6); synthetic returns show 0 cargo | see 5.7 |
| Debris `figure.debrisField` | `figure.planetIcon.tf` | map `tf` → `debrisField` |

`destination` (own body key) must use OgameX ids: `p<planetId>` or `m<moonId>`. Coordinates map to the planet; `destType === 'moon'` → its moon.

**Polling:** OL fetches on every page load and on the reload icon. OgameX's cheap change detector is `GET /ajax/fleet/eventbox/fetch` (JSON counts, `fleet.md` §9.2). Re-fetch the list when `friendly+neutral+hostile` changes, or when a known arrival passes.

### 4.10 TechDetailObserver and TechDetailParser (`OL/src/observers/techDetailObserver.js`, `OL/src/parsers/techDetailParser.js`)

- Observer: a MutationObserver on `#technologydetails_wrapper #technologydetails_content` (`childList`). When `addedNodes.length > 1`, it parses the details panel and appends:
  - `<li class="resource total icon">TOTAL</li>` to `#technologydetails .content .information .costs ul`;
  - `<span class="ol-value"></span>` to every `li.resource`.

  It then sets `dataManager.currentTechDetail = {$elts, neededResources}`, which `PlanetsProductionDisplay.display()` fills every tick (4.11).
- Parser:
  - level = `#technologydetails .content .information span.level/@data-value` (next level);
  - techId = `#technologydetails/@data-technology-id`;
  - costs = `…/.costs/ul/li` classes `metal|crystal|deuterium|energy` `data-value`; `total` = M+C+D.
  - Caches `techdetail[techId][level].cost = {M,C,D,lastParsedTime}`.

**OgameX:**
- The same containers exist on all five list pages (`OX/resources/views/ingame/resources/index.blade.php:22-23`; facilities:28-29; research, shipyard, defense:16-17). The game JS replaces `#technologydetails` inside `#technologydetails_content` (`bundle:41365-41395`).
- **`#technologydetails[data-technology-id]` is hard-coded `3`** (`OX/resources/views/ingame/ajax/object.blade.php:3`, `buildings.md` §6.2). OL would file every cost under tech 3. Take the id from `button.upgrade[data-technology]` or `button.downgrade[data-technology]`, or from `li.technology.showsDetails[data-technology]` in the list.
- `.information > span.level[data-value]` = current + 1 (both games). Units: `span.amount`.
- `.costs li.resource.<res>[data-value]` (float string, `parseFloat`); the class always contains `sufficient` and adds `insufficient` when the planet cannot pay (`buildings.md` §6.2). The `.costs` `ul` is `ul.ipiHintable` (`object.blade.php:82`), so `#technologydetails .costs ul` still matches.
- Ships and defense show the cost **per piece**. OL's overlay then gives "missing for 1 unit". The port can multiply by the `#build_amount` input value.

### 4.11 PlanetsProductionDisplay: the planet-bar overlay (`OL/src/displays/planetsProductionDisplay.js`)

**initialize()** (`:14-347`) runs once per page. For each `//div[contains(@id,"planetList")]/div/@id` it loads `data`, `data-moon`, `production` and `production-moon` (`dataManager.loadFullPlanet`, `dataManager.js:244-275`):
- Construction (`:63-100`): if `.smallplanet a.constructionIcon` exists, it appends `<span class="planet_construction">{icon title}&nbsp;({targetLevel})<br/><span class="timer"></span></span>`. For `a.constructionIcon.moon` it appends `.planet_construction_moon`. Otherwise it clears `currentBuild` for planet and moon.
- Energy warnings (`:103-108`): `middlemark` if `E.dispo <= 5% of E.prod`, `overmark` if `E.dispo <= 0`.
- Fusion warning (`:109-122`): if `prodPercents.cef < 100` and the fusion level > 0, show `(fusion N%)`, with `middlemark` below 70 and `overmark` below 40.
- Rate classes per resource (`:124-224`): `middlemark` if the setting % < 70, `overmark` if < 40 or if `prod == 0` (a full storage sets prod to 0).
- Injected HTML into `#<rowId> > .prod` (`:227-278`):
  - `div.planet_prod`, containing:
    - `span#m_dispo.dispo[title="Capacity : X"] > span.dispo_percent` (a filled bar), then `span.prod_per_hour|prod_per_day` (`+X/h`, `+X*24/d`) when miner. The same for `#c_dispo` and `#d_dispo`.
    - optional `span#s_dispo` (Σ) and `span.needed_fleet > span.pt, span.gt` (miner).
    - optional `span#e_dispo.dispo[title="Production : X"] > span.<warnE>[style=width:pct]` "E: dispo", where the width is `percent(E.prod - E.dispo, E.prod)`.
    - the fusion text.
  - `div.moon_prod` with the same set for the moon. The moon deuterium rate is always rendered.
  - **Duplicate ids** `#m_dispo` and the others repeat for every planet and moon (OL scopes with `#<rowId> .planet_prod #m_dispo`). Use classes in the port.
- `span.incomming_fleet` appended to the row (`:280`).
- Stationed ships (`:310-320`): `a.planetlink` / `a.moonlink` gets `<span class="aquai" title="N ships"><span class="percent"></span></span>`.
- Totals block appended to `#planetList` (`:323-346`), in French:
  - "En vol :" (in flight) M/C/D/Σ;
  - "Totaux :" (totals) M/C/D with summed hourly or daily production, and Σ with `needed_fleet` PT/GT.

**display()** runs each tick (`:359-716`):
- Flights (`:376-394`): for each flight **without** `hasPrevious`, add its resources to the in-flight totals. It groups flights by `destination` (an own planet id) to build the incoming tooltip.
- Per body (`:399-636`):
  - Reload the stored production. The worker has already projected it.
  - Build timer text `formatTime(end - now)` or `Terminé`.
  - Bars (§5.4).
  - Sum and needed transporters (§5.3).
  - Incoming tooltip `span.icon_movement_reserve.tooltip` with `title` = `div.htmlTooltip > h1 "Détails des flottes:" + table.fleetinfo` rows: "Arrive dans <span class=ogamelivecountdown data-countend=ms>", M, C, D. It is skipped if OGLight is present.
- Stationed-ships bar (`:638-648`): `width = vaissels*100/maxShips` %, colour red above 75%, orange above 50%, otherwise green, `min-width` 8 px when > 0.
- Totals (`:650-675`): in flight, and grand totals = Σ bodies + in flight. Needed transporters for the grand total, and owned PT/GT summed over bodies.
- Cost overlay (`:677-710`): when `currentTechDetail` is set (§5.5).
- `production.last_render_time` (`:713-715`, unused elsewhere).

**OgameX injection points** (`layout.md` §4.1):
- `#planetList > .smallplanet` (append `.prod`); `a.planetlink`, `a.moonlink` (append the bar); `a.constructionIcon` (planets only, `main:1774-1785`). **Its `title` is empty in OgameX**, while OL copies the official title (building name) into its label. Take the name from the stored queue data (§4.5). Totals go at the end of `#planetList`.
- Compact layout (6 or more planets): `#cutty #myPlanets`, `.smallplanet.smaller`.

### 4.12 BetterTechDisplay: cost badges on list items (`OL/src/displays/betterTechDisplay.js`)

- For every `#technologies li.technology` (`data-technology`, `.level[data-value]` = current level):
  - It uses the cached `techdetail[id][level+1].cost` if that is younger than 24 h.
  - Otherwise it fetches `?page=ajax&component=technologydetails&ajax=1&action=getDetails&technology=<id>` and parses it (`:7-29`).
- It appends to `li .icon` `<span class="oglive nextlevelresources"><span class="overmark?">M:1.2k</span><br/>C:…<br/>D:…</span>`. `overmark` when the current body's projected `dispo` < cost (`:33-46`). It uses `readablize`.

**OgameX:**
- The details endpoint is `GET /ajax/<resources|facilities|research|shipyard|defense>?technology=<id>` (JSON envelope, HTML in `content.technologydetails`; `buildings.md` §6). Any of the five works for any id. A missing `technology` gives HTTP 500.
- **Do not fire 10-16 requests per page.** Compute costs locally (`objects.jsonl` `price` = `"M, C, D, E, factor"`; `cost(L) = floor(base × factor^(L−1))`; astrophysics rounded to 100; units `base × 1`; `buildings.md` §11). Use the AJAX only to verify, with the same 24 h cache.
- `li .icon` = `span.icon.sprite` inside each list `li` (`buildings.md` §3.2). Use `li[data-technology] span.level[data-value]` for the current level.

### 4.13 BetterFleetDisplay and the expedition button (`OL/src/displays/betterFleetDisplay.js`, `OL/src/window.js`)

- `#moreInfoTable` (Capacity / Speed of the selected ships) inserted after `#allornone .show_fleet_apikey` (`:9-15`). `updateMoreInfoTable` runs on `change keyup keydown` of `#technologies li.<k> input` and on icon click (`:18-61`):
  - capacity = Σ n × capacity;
  - speed = min speed of the selected ship types.
- Each ship `li` `title` gets `Speed/Capacity/Consumption/Struct/Attack/Shield` appended (`:41-49`).
- `show_fleet_speed`: `<span class="speed">X</span>` prepended into `li.<k> .icon` (`:51-55`).
- **Expedition button** (`:64-95`): `a.explo#ebutton` "Exploration" with `expeditionTime h` and `speedPercent*10 %` from `localStorage['ogameLive.expeparams']` (default 1 h / `"10"`), plus `+/- <input#random_system> systems`, inside `div.custom-coords` appended to `#fleet2 #target .coords`. The `href` calls the page-world `sendRandomExpe({detail:{nb_systems}})`.
  - `window.js:20-38`: on `#sendFleet` click, if `fleetDispatcher.targetPlanet.position == 16`, save `{expeditionTime, speedPercent}`.
  - `window.js:46-88` `sendRandomExpe`:
    1. observe `.ajax_loading` until `display:none`;
    2. set `targetPlanet.position = 16`; `system += random in [-n, n]` with `n = #random_system`; wrap `system % nb_systems` (negative → `+nb_systems`);
    3. `selectMission(MISSION_EXPEDITION)`, `refreshFleet2()`, `updateTarget(true)`;
    4. when the loader hides: restore `expeditionTime` (min 1) and `speedPercent`, then `trySubmitFleet2()`.
- `computeMaxExpeRessources()` (`:115-162`) is **dead code**. It is never called, and it reads the undefined `PARAMS.player_class` / `PLAYER_CLASS_EXPLORER`. Its table is reproduced in §5.6.

**OgameX** (`fidx`, `bundle`, `fleet.md` §2):
- `#allornone` (`fidx:940`), `.show_fleet_apikey` (`fidx:965`), `#fleet2 #target .coords` (`fidx:1070`), `#sendFleet` (`fidx:1443`), `#fleetdispatchcomponent .ajax_loading` (`fidx:1022`; toggled by `startLoading/stopLoading`, `bundle:32618-32623`), `select#expeditiontime` (1..astrophysics, `fidx:1310`) all exist.
- Ship `li.technology.<class_name>` with `span.icon` and `input[name=<class_name>]` (`fidx:891-906`). The game listens on `keyup`/`focusout`.
- `FleetDispatcher` has `targetPlanet`, `selectMission`, `refreshFleet2` (`bundle:33298`), `updateTarget(fetch)` (`bundle:33469`, which reads `#galaxy/#system/#position` written by `refreshTarget`), `trySubmitFleet2` (`bundle:33266`), `expeditionTime`, `speedPercent` (1..10), `fleetHelper.MISSION_EXPEDITION` (`bundle:34405`). `getHoldingTime()` returns `expeditionTime` for mission 15 (`bundle:33595-33606`). **OL's flow works unchanged**, provided:
  - systems wrap to **1..499**: `((s - 1 + r) % 499 + 499) % 499 + 1`. OL's `% nb_systems` can give 0, which `updateTarget` clamps to 1;
  - position 16 = `EXPEDITION_POSITION` (`fidx:178`).
- Capacity and speed per ship: §4.8 sources. The `shipsData` inline on `/fleet` is **wrong** (`fleet.md` §2.3), and `fleetDispatcher.fleetHelper.shipsData` is correct only after a check-target.

### 4.14 FlightsDisplay: flights timeline (`OL/src/displays/awesomeFlightsDisplay.js`)

- `table#OGameLiveEvents.live-flights` inside `#flights` (`:14-28`). The `thead.fleetStatus` holds a reload icon (re-runs `FlyingFleetObserver` and redraws), `#OGameLiveEvents_slots` and `#OGameLiveEvents_expeSlots`.
- `display()` (`:44-195`):
  - Flights are sorted by `arrivalTime`.
  - It **skips outbound expeditions** (missions 15 and 18 with `returnFlight=='false'`).
  - Rows are added incrementally (`knowEvents`), keeping arrival order (insert after the previous id).
  - Each row is `tr.eventFleet#OGameLiveEventRow-<id>[data-mission-type][data-return-flight][data-has-previous][data-has-next]` with:
    - `td.arrivalTime`: `HH:MM:SS` local time, and `div.flying-res` with three bars `span.metal|cristal|deuterium[width=res*100/capa%]`, where `capa = Σ ships × capacity`;
    - `td.countDown span#counter-ogameliveeventlist-<id>.<missionClass>.ogamelivecountdown[data-countend]`;
    - `td.missionFleet img`;
    - origin `figure.planetIcon.<type>` + link;
    - `td.detailsFleet`;
    - `td.icon_movement[_reserve]` with the original tooltip;
    - destination.
  - Slot counters: `usedSlots` counts each shown flight whose `eventId-1` is not already shown; `usedExpeSlots` counts mission-15 rows. Displayed as `<span>{textSlots}</span>{used}/{max}` from `globaldata`, with `overmark` when full.
- **OgameX:** use the parsed flights from §4.9 and `globaldata` from §4.8. Slot counting must use `realMissionId` and count each own mission once, not "eventId−1". Better: take `used/max` straight from `/fleet` `#slots` when fresh, and decrement as own missions finish. The mission icon `src` is `/img/fleet/<type>.gif` (`fleet.md` §9.3) and can be reused.

### 4.15 worker.js: the live projection engine (`OL/src/worker.js`)

- `mainLoop` every 1000 ms (`:84`, `:234-379`):
  1. **Flights** (`:236-304`): for each flight with `arrivalTime <= now`, delete it. If it has a `destination` and the type is not debris:
     - add `resources.M/C/D[/F]` to the destination body's `dispo`; when `dispo >= capa`, move `prod` to `lastprod` and set `prod = 0`;
     - set `lastTime = now`;
     - `vaissels += detailsFleet` (except mission 18).
     - It does **not** check the mission type or ownership: a foreign spy probe "adds" its deuterium, and an outbound attack "adds" its cargo to the target if that target is own.
  2. **Production** (`:309-378`) per `production.*` key: §5.1. It stores the result in memory if no newer value arrived meanwhile, and persists every 10 iterations.
- **OgameX port:** replace it with pure functions run on render (§5.1, §5.7). Resource arrival rules must be mission-aware (§5.7).

### 4.16 utilities.js formatters

| Function | Line | Behaviour |
|---|---|---|
| `formatInt(v)` | `:150-155` | `prod_round==1` → `readablize`; else `parseInt(v)` with `.` thousands (`1.234.567`) |
| `formatTime(ms)` | `:157-175` | `<=0` → `Terminé`; else `[HH:]MM:SS` (hours omitted if 0, not capped at 24) |
| `readablize(n)` | `:177-184` | `e = floor(log(n)/log(1000))`; `round(n/1000^e*100)/100 + ['', 'k', 'M', 'Md', 'T', 'P'][e]`; **NaN/garbage for n<1 or negative** |
| `cleanCoords` | `:191-193` | strip spaces and `[]` |

**Port:** Russian UI (project rule). Use `toLocaleString('ru-RU')` (thin-space thousands), the suffixes `тыс.`/`млн`/`млрд` (or `k`/`M`/`B`), `Готово` instead of `Terminé`, and guard `n<=0` in `readablize`.

### 4.17 CSS hooks (`OL/src/ogameLive.css`, 857 lines)

Classes worth keeping: `.prod.miner/.raider`, `.planet_prod/.moon_prod`, `.dispo > .dispo_percent` (bar), `.middlemark/.overmark` (OGame colours, which also exist in OgameX CSS), `.needed_fleet .pt/.gt`, `.total_prod`, `.incomming_fleet`, `span.aquai .percent`, `#moreInfoTable`, `#technologies li .icon .speed`, `#technologydetails li.resource.total.icon:before`, `.ol-value`, `span.oglive.nextlevelresources`, `#fleet2 #target .coords a.explo`, `.productionSwitcher` (slide animation), `#ogameliveparameters`. OL also restyles `#planetList` to a wide "Infinity-like" layout (`ogameLive.css:28-200`); OgameX's `#rechts` has the same structure (`layout.md` §4.1).

---

## 5. Formulas

All OL formulas, with the OgameX source of each input. `prod` is per hour unless stated.

### 5.1 Live projection of stock (`worker.js:319-368`; `planetProductionParser` gives the anchor)

```
elapsed = (now - lastTime) / 1000                                    // s; lastTime = time the snapshot was taken
for r in M,C,D:
  if dispo < capa and prod == 0 and lastprod > 0: prod = lastprod     // storage freed (spent or transported): resume
  dispo += prod / 3600 * elapsed
  if dispo >= capa and prod > 0: dispo = capa; lastprod = prod; prod = 0   // cap, remember rate
F (lifeform): dispo += surprod * elapsed  (surprod per second) — drop for OgameX
lastTime = now
```

- OgameX server rule (`OX/app/Services/PlanetService.php:1443-1460`): resources grow only while `current < storage`, and they are capped at storage. Values above storage (from transports or expeditions) are kept but do not grow. This is the same as OL's rule. The page ticker does the same (`layout.md` §6.3).
- Closed form, no state, for the port: `amount(t) = a0 >= cap ? a0 : min(cap, a0 + perSec × (t − t0)/1000)`. Here `a0` and `perSec` come from `reloadResources` (production is already per second), and `t0` is the server render time.
- Negative deuterium production (fusion higher than the synthesizer) floors at 0 in the ticker (`layout.md` §6.3). Mirror that.

### 5.2 Storage capacity and time until full

- OL never computes capacity; it parses it (tooltip "Storage capacity", empire `storage`). OgameX: `reloadResources … "storage"` or the tooltip, or the formula `5000 × floor(2.5 × e^(20·L/33))` (`buildings.md` §11; levels from `/resources`: metalStorage 22, crystalStorage 23, deuteriumStorage 24). It is not scaled by economy speed.
- **Time until full** (not in OL; asked for the port): `t = dispo >= capa ? 0 : prod > 0 ? (capa − dispo) / (prod/3600) : ∞` seconds (recipe `secondsUntilFull`). Show it as a countdown in the bar `title`.
- Fill bar (`planetsProductionDisplay.js:349-357`): `pct = min(100, dispo×100/capa)` (0 if dispo = 0). Warnings: `middlemark` if `dispo >= 0.9·capa`, `overmark` if `dispo >= capa` (`:441-468`). OgameX's resource bar uses the same 90%/100% rule (`layout.md` §6.1).
- Energy bar: `width = min(100, (E.prod − E.dispo)×100/E.prod)` (share of energy consumed); `E.dispo` = net energy. OgameX energy tooltip: Available (net), Current production, Consumption.

### 5.3 Needed transporters (`dataManager.js:102-118`, `planetsProductionDisplay.js:481-503, 559-581, 673-675`)

```
sum      = M.dispo + C.dispo + D.dispo
neededPT = ceil(sum / cap(202))      neededGT = ceil(sum / cap(203))     // 0 if cap unknown
shown    = "<owned PT>/<neededPT> PT - <owned GT>/<neededGT> GT"
class    = owned < needed ? overmark : (owned < 0.9·needed ? middlemark : "")   // the 2nd branch is unreachable in OL
grand total: same with Σ all bodies (+ in-flight resources), owned = Σ bodies
```

- `cap(id)` = effective cargo capacity for this player (research + class), §4.8. The sample Collector with hyperspace 8 gives LC 41,250 and SC 8,250.
- Owned PT/GT = `data.fleet.transporterSmall/Large` of that body (from `/fleet`, `/shipyard` or the refresh-all of §4.7).

### 5.4 Production rates shown

```
+X/h = prod                         +X/d = prod × 24
totals = Σ planets prod (moons not added)
rate class: setting% < 70 → middlemark; < 40 → overmark; prod == 0 → overmark
fusion: shown when cef% < 100 and fusionPlant > 0
```

OgameX hourly production: `reloadResources production × 3600` (exact), or the tooltip "Current production". The per-source breakdown is on `/resources/settings`. Production rules: `buildings.md` §11 (economy speed, plasma, Collector +25%, crawler, position bonus, energy factor). There are no officers (`layout.md` §9.5).

### 5.5 Cost overlay (`techDetailObserver.js:10-15`, `planetsProductionDisplay.js:677-710`, `betterTechDisplay.js:33-46`)

```
cost = {M,C,D,E} of the next level (or per unit)
total = M + C + D                                           // shown in the extra li.total
for r in M,C,D: diff_r = dispo_r(now) − cost_r
  shown: |diff_r|  and  "(ceil(|diff_r|/cap202) PT - ceil(|diff_r|/cap203) GT)"
  (OL shows |diff| even when diff>0, i.e. the surplus; colour comes from OgameX's insufficient class)
E: |E.dispo − cost_E|
missingTotal = Σ max(0, −diff_r)  → total li: |missingTotal| and its PT/GT
list badge: "M:<readablize(cost)>" with overmark if dispo < cost
```

**Time until affordable** (not in OL; asked for the port):
`t = max over r with diff_r < 0 of (−diff_r) / (prod_r/3600)`, which is ∞ if one of those has `prod_r = 0`. Show it as `ДД ЧЧ:ММ:СС` and as an absolute server time. Recipe `costOverlay`. It is per body: use the current body's projection.

### 5.6 Expedition max find

**OL table** (`betterFleetDisplay.js:115-162`, dead code). Thresholds on `top_score` (rank-1 points):

| top score < | maxTotal | minPT | minGT |
|---|---|---|---|
| 10,000 | 40,000 | 273 | 91 |
| 100,000 | 500,000 | 423 | 141 |
| 1,000,000 | 1,200,000 | 423 | 191 |
| 5,000,000 | 1,800,000 | 423 | 191 |
| 25,000,000 | 2,400,000 | 573 | 191 |
| 50,000,000 | 3,000,000 | 723 | 241 |
| 75,000,000 | 3,600,000 | 873 | 291 |
| 100,000,000 | 4,200,000 | 1,023 | 341 |
| otherwise | 5,000,000 | 1,223 | 417 |

Then `maxTotal × 3 × speed` for Discoverer, otherwise `× 2`. The minPT/minGT values are hard-coded official-OGame numbers and are never shown.

**OgameX actual rule** (`EXM:1020-1137`, `EXM:337-390`, `OX/app/Services/CharacterClassService.php:502-508`, `SettingsService.php` `expedition_reward_multiplier_resources`):

```
base   = same 9-step table on the rank-1 Highscore.general points (EXM:1033-1054)
roll   = random_int(max(1, floor(base×0.1)), base)                  // 10%..100% of base
roll  ×= Discoverer ? 1.5 × economySpeed : 1                         (int)
roll  ×= hasPathfinder ? 2 : 1
roll  ×= setting expedition_reward_multiplier_resources (default 1.0; admin-only, not exposed to players)
roll  ×= variant: normal ×1 (89%), rare ×2..3 (10%), exceptional ×5..10 (1%)   (EXM:929-940)
found  = metal: min(freeCargo, roll); crystal: min(freeCargo, roll×2/3); deuterium: min(freeCargo, roll/3)   (type uniform 1/3 each)
freeCargo = Σ effective cargo of the expedition fleet − cargo already loaded
ships found use the same base with expedition_reward_multiplier_ships (EXM:1108-1137)
```

Differences from OL: there is no ×2 for non-Discoverers; Discoverer is ×1.5·speed, not ×3·speed; Pathfinder doubles; the server multiplier and the find variants exist. **Minimum ships to carry a normal max find**: `ceil(maxMetal / cap203)` LC or `ceil(maxMetal / cap202)` SC. Optionally show rare (×3) and exceptional (×10) caps. Recipe `expeditionMaxFind`. Expedition slots: astrophysics formula + `bonus_expedition_slots` setting + Discoverer +2 (`OX/app/Services/PlayerService.php:607-623`). Use the DOM `#slots` instead.

**Top points source:** `POST /ajax/highscore` `category=1&type=0&page=1` → first `#ranks tbody tr[id^=position]` `td.score` (recipe `parseTopScore`). Caveat: `EXM:1033` takes the highest `general` over **all** players, including admins and NPCs, while the highscore list hides admins unless `highscore_admin_visible` is set. The two can differ (open question 1).

### 5.7 Flights and in-flight resources (`planetsProductionDisplay.js:376-394, 650-672`; `worker.js:236-304`)

OL: `inFlight = Σ resources of flights with !hasPrevious`; grand total = Σ bodies + inFlight.

OgameX rules (with the `eventListToFlights` output):

```
per real mission (group rows by realMissionId), own only (flight.own):
  take ONE row: the outbound row (synthetic==null && !returnFlight) or, if absent, the holdEnd row,
                or a real return row (synthetic==null && returnFlight)
  inFlight += its M,C (+ D minus half the fuel; the fuel is not exposed, so accept the overstatement or recompute it, fleet.md §2.7)
synthetic return rows (+999999) carry 0 cargo: never sum them
foreign rows (own==false): ignore for inFlight; show them as incoming (hostile when missionType ∈ {1,2,6,9,10})
```

Arrival application, to project stock before the next server refresh:

| Row | On arrival at own body (`destination`) |
|---|---|
| own outbound transport (3) / deploy (4) | `dispo += M,C,D` (the tooltip deuterium includes half the fuel, so subtract it if it was recomputed); for 4 also `ships += detailsFleet` |
| own real return row (any mission) | `dispo += M,C,D`; `ships += detailsFleet` |
| own synthetic return (+999999) | `ships += detailsFleet`; resources unknown (0) until the event list is re-fetched |
| foreign transport (3) to own body | `dispo += M,C,D` |
| foreign attack/spy, own outbound attack/spy/harvest/expedition outbound or holdEnd | nothing |

After any arrival, re-fetch `/ajax/fleet/eventlist/fetch` (the server creates the real return with loot). Arrival time in local ms = `data-arrival-time × 1000 − serverOffset`, where `serverOffset = serverEpochMs − Date.now()` (`layout.md` §8).

### 5.8 Fleet speed and capacity display (`betterFleetDisplay.js:18-36`)

```
capacity(selection) = Σ n_i × cap_i
speed(selection)    = min over selected types of speed_i
per-ship badge      = speed_i
```

OgameX: `cap_i`, `speed_i` effective (§4.8). Flight time and fuel, if the port wants to show them (OL does not): `fleet.md` §2.7 (`duration = max(round((35000/speedPct × sqrt(distance×10/maxSpeed) + 10)/speedFactor), 1)`, with speed factor per mission class).

### 5.9 Timers

- Build countdown: `end − now` → `formatTime`. OgameX `end = serverRender + CountdownTimer secs` (§4.5).
- Flight countdown: `arrivalTime − now`, updated every `main_refresh` s through `.ogamelivecountdown[data-countend]`.

---

## 6. Official-only sources → OgameX replacements

| OL source | Where used | OgameX replacement (endpoint / selector, source) |
|---|---|---|
| `GET /api/serverData.xml` (`ogameLive.user.js:96-116`) | lifeform, systems, topScore, speed, version | economy speed `meta[name=ogame-universe-speed]` (`main:32`); fleet speeds `/overlay/server-settings` `fleetspeed_war/holding/peace` (`web.php:257`, `layout.md` §11) or inline `SPEEDFAKTOR_FLEET_*` on `/fleet` (`fidx:172-174`); galaxies `number_galaxies` or `MAX_GALAXY` (`fidx:169`); systems `499` (`fidx:170`); lifeform `false`; topScore `POST /ajax/highscore` (§5.6); version `meta[name=ogame-version]` |
| `GET /api/localization.xml` (`:119-135`) | ship name → id in the event tooltip; mission names | `li.technology[data-technology][aria-label]` on `/shipyard`, `/fleet`, `/defense`, `/research` (localized titles, recipe `parseTitles`); missions: `data-mission-type`, names in `orderNames` inline on `/fleet` (`fleet.md` §2.3) |
| `?page=componentOnly&component=eventList&ajax=1` (`flyingFleetObserver.js:4`) | flights | `GET /ajax/fleet/eventlist/fetch` (`web.php:142`) + `GET /ajax/fleet/eventbox/fetch` for change detection (`fleet.md` §9) |
| `component=empire` (+`planetType=1`) | all bodies' stock, storage, ships | none; per-body `GET /fleet?cp=<id>` (+ restore `cp`) (§4.7) |
| `?page=ajax&component=technologytree&ajax=1&technologyId=<id>&tab=2` | ship speed/capacity/fuel | `GET /ajax/techtree?tab=2&object_id=<id>` (visible text, not data-value) or check-target `shipsData`, or local formula (§4.8) |
| `?page=ajax&component=technologydetails&ajax=1&action=getDetails&technology=<id>` | next-level cost | `GET /ajax/resources?technology=<id>` (JSON `content.technologydetails`, `buildings.md` §6) or local formula from `objects.jsonl` |
| `page=resourceSettings` / `component=resourcesettings` | production % | `GET /resources/settings` `select[name^=last]` ×10 (§4.6) |
| `timeDelta` in the event list | server clock | layout `serverTime` (`main:839`) / JSON `serverTime` |
| `.hightlightMoon`, `.constructionIcon.moon` | current body, moon build | metas + moonlink `cp`; moon builds only from moon pages |
| `.smallplanet` id `planet-<id>` | storage keys | `data-planet-id`; moon id from `a.moonlink` `?cp=` |
| `data-start/data-end` on build `time` | build end | inline `new CountdownTimer('buildingCountdown', secs…)` |
| URL `s<n>-<lang>.ogame.gameforge.com` | storage prefix | `location.origin` + player id |
| board / GitHub links | menu | none |

---

## 7. Feature-by-feature porting table

| # | Feature (OL) | OL module | OgameX data source | Port status | Notes |
|---|---|---|---|---|---|
| 1 | Live stock per planet and moon in the planet list (M/C/D bars, capacity tooltip) | `PlanetsProductionDisplay`, `PlanetProductionParser`, worker | `reloadResources` inline per visit; refresh-all via `/fleet?cp=` | **Port as is** (with fixes) | key by `data-planet-id`/moon `cp`; closed-form projection; `,` numbers |
| 2 | Production rate +X/h or +X/d per body, totals | same | `production×3600`; settings % from `/resources/settings` | Port | moons produce 0 |
| 3 | 90%/100% storage warnings; time until full | same | storage from inline/tooltip | Port + add time-until-full | §5.2 |
| 4 | Energy per planet bar, fusion % warning | same | energy tooltip; `last12` setting | Port | |
| 5 | Σ per body | same | — | Port | |
| 6 | Needed PT/GT per body and total, owned PT/GT | same | effective cargo (§4.8); ships per body (`/fleet`, `/shipyard`, refresh-all) | Port | |
| 7 | Resources in flight (M/C/D/Σ), grand totals | same | event list | Port with the §5.7 rules | |
| 8 | Incoming-fleet tooltip per planet | same | event list (own and foreign) | Port, mark hostile | ownership by coordinates |
| 9 | Build timer per planet (and moon) | same + level parsers | inline `CountdownTimer` on overview/resources/facilities | Port; moon only after visiting it | `constructionIcon` exists for planets only |
| 10 | Stationed ships bar per planet and moon | same + `FleetParser`/`EmpireParser` | `/fleet` `shipsOnPlanet`, `/shipyard` amounts | Port | exclude 212/217 |
| 11 | Planets/moons production switcher | bootstrap | `#countColonies` | Port | |
| 12 | Cost overlay in tech details (missing per resource, PT/GT, total) | `TechDetailObserver/Parser` + display | `#technologydetails` (id from `button.upgrade`) | Port + add time-until-affordable | §5.5 |
| 13 | Next-level cost badges on list icons | `BetterTechDisplay` | local formula (`objects.jsonl`) or `/ajax/<page>?technology=` | Port (local calculation) | avoid N requests |
| 14 | Capacity and speed of the selected fleet | `BetterFleetDisplay` | ship stats §4.8 | Port | |
| 15 | Speed badge on ship icons, stats in the ship tooltip | `BetterFleetDisplay` | same | Port | |
| 16 | One-click random expedition (±N systems, remembered duration and speed) | `BetterFleetDisplay` + `window.js` | `fleetDispatcher` page API | Port (page-world script) | wrap 1..499 |
| 17 | Expedition max find and minimum ships | dead code | §5.6 (highscore + class + speed) | **Implement anew** using OgameX rules | show normal, rare and exceptional caps |
| 18 | Flights timeline with slot counters and cargo-fill bars | `FlightsDisplay` | event list + `/fleet` `#slots` | Port | skip expedition outbound like OL; use `realMissionId` |
| 19 | Lifeform food and population | several | — | **Drop** | no lifeforms |
| 20 | Empire planet/moon shortcut icons | bootstrap | — | **Drop** | no empire page |
| 21 | Galaxy footer clock and ping | bootstrap, `window.js` | `.ctGalaxyFooter #colonized` | Optional | |
| 22 | Plugin detection (Infinity, OGLight, …) | bootstrap | — | Replace with detection of our own Infinity port (avoid two planet-list overlays) | |
| 23 | Params modal (13 options) | `Parameters` | — | Port, Russian labels | add `expedition_reward_multiplier` (default 1) and "refresh all bodies" |
| 24 | Daily server data and localization | bootstrap | §6 | Replace | no XML API |

---

## 8. OgameX endpoint and selector cheat sheet (for this add-on)

| Need | Request / selector | Response / notes | Source |
|---|---|---|---|
| Is OgameX | `isOgxIngame()` | | `layout.md` §1 |
| Current body | `meta[name=ogame-planet-id]`, `-coordinates`, moonlink `cp` | `ogame-planet-type` is always `planet` | `main:23-46` |
| Bodies | `#planetList > .smallplanet[data-planet-id]`, `.planet-koords`, `a.moonlink[href*=cp=]`, `a.constructionIcon` | | `main:1713-1858` |
| Stock, storage, production (current body) | inline `reloadResources({...})` | floats; production per second; not JSON (comments, trailing commas) | `main:1363-1432` |
| Same via tooltip | `#metal_box[title]` … | `,` thousands; read before Tipped | `main:190-278` |
| Economy and fleet speed | `meta[name=ogame-universe-speed]`, `meta[name=ogame-universe-speed-fleet]` | int | `main:32-33` |
| Universe settings | `GET /overlay/server-settings` | HTML fragment | `web.php:257` |
| Server clock | `var serverTime = new Date('Y-m-d H:i:s')` (UTC by default) | | `main:839` |
| CSRF | `meta[name=csrf-token]` | `_token` form field | `main:23` |
| Levels | `#technologies li.technology[data-technology]` + `span.level[data-value]` / `span.amount[data-value]` | | `buildings.md` §3 |
| Build/research/unit timers | `/new CountdownTimer\('(building|research|unit)Countdown',\s*(\d+)/` | secs from render | `buildings.md` §4.3 |
| Production % | `GET /resources/settings` `select[name^=last]` ×10, `span.factorkey` | | `buildings.md` §9 |
| Tech cost | `GET /ajax/resources?technology=<id>` | JSON `{target, content:{technologydetails: html}, serverTime}` | `web.php:75`, `buildings.md` §6 |
| Ship stats | `GET /ajax/techtree?tab=2&object_id=<id>` | HTML; read `tr.<row> td > span` **text** | `web.php:118`, `TTC:68-76, 276-323` |
| Ships on body, slots | `GET /fleet[?cp=]`: `var shipsOnPlanet`, `#fleet1 #slots` | | `fidx:244-247, 797-810` |
| Effective ship stats (all) | `POST /ajax/fleet/dispatch/check-target` | `shipsData` | `fleet.md` §3 |
| Flights | `GET /ajax/fleet/eventlist/fetch` | HTML fragment | `web.php:142`, `FEC:202-575` |
| Flight-change poll | `GET /ajax/fleet/eventbox/fetch` | JSON counts | `web.php:141` |
| Rank-1 points | `POST /ajax/highscore` `category=1&type=0&page=1&_token` | HTML `#ranks` | `web.php:214` |
| Character class | `#characterclass .sprite.characterclass.<cls>` | `miner`/`warrior`/`explorer`/`none` | `main:287-306` |
| Ship titles (locale) | `li.technology[aria-label][data-technology]` | | `fidx:891-933`, shipyard |

All in-game endpoints need the session cookie (same-origin `fetch`, `credentials:'same-origin'`; Firefox content scripts: `content.fetch` or `credentials:'include'`, `layout.md` §7). Any `?cp=` switches the current body persistently.

---

## 9. Parsing recipes (verified)

Run `node ogx/tools/check_ogamelive.js`. The results are in `fixtures/ogamelive-expected-parse.json`. Highlights:
- `parseBodies` on `layout-overview-planet.html` gives `[{planetId:1, rowId:"planet-1", coords:"1:42:8", moonId:5}, {planetId:3, rowId:"planet-2", coords:"2:118:12", moonId:null, building:true}]`.
- `currentBody` on the moon fixture gives `{key:"m5", isMoon:true, planetId:1}`.
- `parseResourceTooltips` gives `M {dispo:152347, capa:255000, prod:4128}`, `E {dispo:106, prod:2860, conso:-2754}`.
- `parseShipProps` on the new fixture gives `{speed:22500, capacity:41250, consumption:50}`.
- `parseFleetPage` gives slots `4/6`, expeditions `1/2`.
- `eventListToFlights` resolves 890090 → holdEnd of 1202 and 1001201 → return of 1202, maps `Large Cargo` → `transporterLarge`, and marks 1210 (spy) and 1211 (transport) as foreign.

```js
const OGX_LIVE = {};

/** AppUtil::formatNumber / formatNumberLong / tooltip text -> number. "152,347" -> 152347, "+4,128" -> 4128,
 *  "-2,754" -> -2754, "1.25Mn" -> 1250000, "1.5M" -> 1500000, "2B" -> 2e9. Never use OGame Live's split('.'). */
OGX_LIVE.num = (s) => {
  s = String(s ?? '').replace(/\s+/g, '').replace(/^\+/, '');
  const m = /^(-?[\d,]*\.?\d+)(Mn|M|B|K)?$/i.exec(s);
  if (!m) return parseInt(s.replace(/[^\d-]/g, ''), 10) || 0;
  const v = parseFloat(m[1].replace(/,/g, ''));
  const mul = { mn: 1e6, m: 1e6, b: 1e9, k: 1e3 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(v * mul);
};

/** "g:s:p" from "[g:s:p]" */
OGX_LIVE.coords = (s) => { const m = /(\d+):(\d+):(\d+)/.exec(s || ''); return m ? m[1] + ':' + m[2] + ':' + m[3] : null; };

/** Planet list -> bodies. Storage key = "p<planetId>" / "m<moonId>" (NOT the .smallplanet id, which is an index). */
OGX_LIVE.parseBodies = (doc, base) => [...doc.querySelectorAll('#planetList > .smallplanet')].map((el) => {
  const ml = el.querySelector('a.moonlink');
  return {
    planetId: +el.dataset.planetId,
    rowId: el.id,                                                     // "planet-1" (index, use only for DOM lookups)
    name: el.querySelector('.planet-name').textContent.trim(),
    coords: OGX_LIVE.coords(el.querySelector('.planet-koords').textContent),
    moonId: ml ? +new URL(ml.getAttribute('href'), base).searchParams.get('cp') : null,
    building: !!el.querySelector('a.constructionIcon'),
  };
});

/** Current body from metas + planet list (ogame-planet-type is always "planet" in OgameX). */
OGX_LIVE.currentBody = (doc, base) => {
  const id = +doc.querySelector('meta[name="ogame-planet-id"]').content;
  const bodies = OGX_LIVE.parseBodies(doc, base);
  const asMoon = bodies.find((b) => b.moonId === id);
  return asMoon ? { key: 'm' + id, id, isMoon: true, planetId: asMoon.planetId, coords: asMoon.coords }
                : { key: 'p' + id, id, isMoon: false, planetId: id, coords: doc.querySelector('meta[name="ogame-planet-coordinates"]').content };
};

/** Resource-bar tooltips (raw title, read BEFORE Tipped strips it). Row order as in OGame:
 *  M/C/D: Available, Storage capacity, Current production (per HOUR), Den Capacity. Energy: Available, Production, Consumption. */
OGX_LIVE.parseResourceTooltips = (doc) => {
  const out = {};
  for (const [k, id] of [['M', 'metal_box'], ['C', 'crystal_box'], ['D', 'deuterium_box'], ['E', 'energy_box']]) {
    const t = doc.getElementById(id)?.getAttribute('title') || '';
    const i = t.indexOf('|'); if (i < 0) continue;
    const tip = new DOMParser().parseFromString(t.slice(i + 1), 'text/html');
    const v = [...tip.querySelectorAll('tr td span')].map((s) => OGX_LIVE.num(s.textContent));
    out[k] = k === 'E' ? { dispo: v[0], prod: v[1], conso: v[2] } : { dispo: v[0], capa: v[1], prod: v[2], cache: v[3] };
  }
  return out;
};

/** Inline reloadResources({...}) -> exact floats (production is PER SECOND). Preferred over tooltips. */
OGX_LIVE.parseInlineResources = (html) => {
  const src = (html.match(/reloadResources\(\{[\s\S]*?\}\);/) || [''])[0];
  const num = '(-?[\\d.]+(?:[eE][-+]?\\d+)?)';
  const out = {};
  for (const [k, n] of [['M', 'metal'], ['C', 'crystal'], ['D', 'deuterium']]) {
    const m = src.match(new RegExp('"' + n + '":\\s*\\{\\s*"amount":\\s*' + num + ',\\s*"storage":\\s*' + num + ',[\\s\\S]*?"production":\\s*' + num));
    if (m) out[k] = { dispo: +m[1], capa: +m[2], prod: +m[3] * 3600 };         // OGame Live keeps prod per hour
  }
  const e = src.match(new RegExp('"energy":\\s*\\{\\s*"amount":\\s*' + num));
  if (e) out.E = { dispo: +e[1] };
  return out;
};

/** Levels on /resources, /facilities, /research (key = class_name, same names as OGame Live constants). */
OGX_LIVE.parseLevels = (doc) => Object.fromEntries([...doc.querySelectorAll('#technologies li.technology[data-technology]')]
  .map((li) => [li.classList[1], +(li.querySelector('span.level, span.amount')?.dataset.value || 0)]));

/** Active build timers from inline JS (seconds from render time). data-start/data-end on the li are FAKE. */
OGX_LIVE.parseBuildTimers = (html) => {
  const t = {};
  for (const m of html.matchAll(/new CountdownTimer\('(buildingCountdown|researchCountdown|unitCountdown)',\s*(\d+)/g)) t[m[1]] = +m[2];
  const active = /<table[^>]*class="construction active"[\s\S]*?<th colspan="2">([^<]+)<\/th>[\s\S]*?<span class="level">[^<\d]*(\d+)<\/span>[\s\S]*?new CountdownTimer\('buildingCountdown'/.exec(html);
  const cancel = /cancelbuilding\((\d+),\s*(\d+),/.exec(html);
  return { ...t, buildingTitle: active ? active[1].trim() : null, buildingTarget: active ? +active[2] : null, buildingObjectId: cancel ? +cancel[1] : null };
};

/** /resources/settings -> {metal:100, cristal:100, deut:100, ces:100, cef:100, sat:100, foreuse:100} (select value 0..10, x10) */
OGX_LIVE.parseResourceSettings = (doc) => {
  const keys = { 1: 'metal', 2: 'cristal', 3: 'deut', 4: 'ces', 12: 'cef', 212: 'sat', 217: 'foreuse' };
  const out = {};
  for (const s of doc.querySelectorAll('table.listOfResourceSettingsPerPlanet select[name^="last"]')) {
    const id = +s.name.slice(4); if (keys[id]) out[keys[id]] = +s.value * 10;
  }
  const f = /(\d+)%/.exec(doc.querySelector('span.factorkey')?.textContent || '');
  out.factor = f ? +f[1] : null;
  return out;
};

/** /fleet -> ships on the current body (by class_name), slots. Use the FIRST #slots (the id is duplicated). */
OGX_LIVE.parseFleetPage = (doc) => {
  const fleet = {};
  for (const li of doc.querySelectorAll('#fleet1 #technologies li.technology[data-technology]'))
    fleet[li.classList[1]] = +li.querySelector('span.amount').dataset.value;
  const slots = doc.querySelector('#fleet1 #slots');
  const pair = (el) => { const m = /(\d+)\s*\/\s*(\d+)/.exec(el?.textContent || ''); return m ? { used: +m[1], max: +m[2], label: el.querySelector('span')?.textContent.trim() } : null; };
  const spans = slots ? slots.querySelectorAll(':scope > .fleft > span.advice') : [];
  return { fleet, slots: pair(spans[0]), expeSlots: pair(spans[1]) };
};

/** Localized ship title -> id, from any page listing ships (/shipyard, /fleet): li[aria-label]. Replaces localization.xml. */
OGX_LIVE.parseTitles = (doc) => Object.fromEntries([...doc.querySelectorAll('li.technology[data-technology][aria-label]')]
  .map((li) => [li.getAttribute('aria-label').trim(), +li.dataset.technology]));

/** GET /ajax/techtree?tab=2&object_id=<shipId> -> effective (research + class) ship values.
 *  The span data-value/-base-value/-bonus attributes are HARD-CODED constants: read the visible text. */
OGX_LIVE.parseShipProps = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const row = (cls) => { const s = doc.querySelector('table.combat_unit_details tr.' + cls + ' td > span'); return s ? OGX_LIVE.num(s.textContent) : null; };
  return { structural: row('structural_integrity'), shield: row('shield_strength'), attack: row('attack_strength'),
           speed: row('speed'), capacity: row('cargo_capacity'), consumption: row('fuel_consumption') };
};

/** GET /overlay/server-settings -> numbers OGame Live took from serverData.xml */
OGX_LIVE.parseServerSettings = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const txt = (k) => doc.querySelector('server-settings-icon.' + k)?.parentElement.querySelector('span')?.textContent || '';
  const x = (k) => +(/x\s*([\d.]+)/.exec(txt(k)) || [])[1] || null;
  return { economySpeed: x('speedfactor'), researchSpeed: x('speedfactor_research'), fleetSpeedWar: x('fleetspeed_war'),
           fleetSpeedHolding: x('fleetspeed_holding'), fleetSpeedPeaceful: x('fleetspeed_peace'),
           galaxies: +(/(\d+)\s*$/.exec(txt('number_galaxies').trim()) || [])[1] || null, systems: 499, lifeform: false };
};

/** POST /ajax/highscore (category=1,type=0,page=1) HTML -> points of rank 1 (OGame Live "top_score"). */
OGX_LIVE.parseTopScore = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tr = doc.querySelector('#ranks tbody tr[id^="position"]');
  return tr ? { rank: +tr.id.slice(8), points: OGX_LIVE.num(tr.querySelector('td.score').textContent) } : null;
};

/** Event list -> OGame Live "flights" objects (keyed by row id). ownBodies: [{planetId, coords, moonId}], titles: {title:id}. */
OGX_LIVE.eventListToFlights = (html, ownBodies, titles, serverOffsetMs) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const shipKey = { 202: 'transporterSmall', 203: 'transporterLarge', 204: 'fighterLight', 205: 'fighterHeavy', 206: 'cruiser', 207: 'battleship',
    208: 'colonyShip', 209: 'recycler', 210: 'espionageProbe', 211: 'bomber', 212: 'solarSatellite', 213: 'destroyer', 214: 'deathstar',
    215: 'interceptor', 217: 'resbuggy', 218: 'reaper', 219: 'explorer' };
  const rows = [...doc.querySelectorAll('#eventContent > tbody > tr.eventFleet:not(.partnerInfo)')];
  const ids = new Set(rows.map((tr) => tr.id.replace('eventRow-', '')));
  const flights = {};
  for (const tr of rows) {
    const rawId = tr.id.replace('eventRow-', '');
    if (rawId.startsWith('union')) continue;
    const id = +rawId, ret = tr.dataset.returnFlight === 'true';
    const syntheticReturn = ret && id > 999999 && (ids.has(String(id - 999999)) || ids.has(String(id - 999999 + 888888)));
    const holdEnd = !ret && id > 888888 && ids.has(String(id - 888888 + 999999));
    const typeOf = (sel) => { const f = tr.querySelector(sel + ' figure.planetIcon'); return f ? (f.classList.contains('moon') ? 'moon' : f.classList.contains('tf') ? 'debrisField' : 'planet') : 'deepSpace'; };
    const home = OGX_LIVE.coords(tr.querySelector('td.coordsOrigin a')?.textContent);   // left column = home side
    const far = OGX_LIVE.coords(tr.querySelector('td.destCoords a')?.textContent);
    const from = ret ? far : home, dest = ret ? home : far;
    const destType = ret ? typeOf('td.originFleet') : typeOf('td.destFleet');
    const body = ownBodies.find((b) => b.coords === dest);
    const tipEl = tr.querySelector('td.icon_movement > span[title], td.icon_movement_reserve > span[title]');
    const tip = new DOMParser().parseFromString(tipEl?.getAttribute('title') || '', 'text/html');
    const vals = [...tip.querySelectorAll('table.fleetinfo td.value')];
    const [M, C, D] = vals.slice(-3).map((td) => OGX_LIVE.num(td.textContent));
    const vaissels = {};
    for (const td of vals.slice(0, -3)) {
      const t = td.previousElementSibling.textContent.replace(/:\s*$/, '').trim();
      vaissels[shipKey[titles[t]] || t] = OGX_LIVE.num(td.textContent);
    }
    flights[id] = {
      eventId: id,
      realMissionId: syntheticReturn ? id - 999999 : holdEnd ? id - 888888 : id,
      synthetic: syntheticReturn ? 'return' : holdEnd ? 'holdEnd' : null,
      arrivalTime: +tr.dataset.arrivalTime * 1000 - serverOffsetMs,   // local ms; offset = serverEpochMs - Date.now()
      destination: body && destType !== 'debrisField' && destType !== 'deepSpace' ? (destType === 'moon' ? 'm' + body.moonId : 'p' + body.planetId) : null,
      destinationType: destType,
      coords: { from, dest, fromType: ret ? typeOf('td.destFleet') : typeOf('td.originFleet'), destType },
      missionType: +tr.dataset.missionType,
      returnFlight: ret,
      own: ownBodies.some((b) => b.coords === home),
      detailsFleet: parseInt(tr.querySelector('td.detailsFleet span')?.textContent, 10) || 0,
      resources: { M, C, D },
      vaissels,
    };
  }
  return flights;
};

/** OGame Live worker.js mainLoop, one body: project amounts from lastTime to now (prod is per hour). */
OGX_LIVE.project = (p, nowMs) => {
  const q = JSON.parse(JSON.stringify(p));
  const dt = q.lastTime > 0 ? (nowMs - q.lastTime) / 1000 : 0;
  for (const k of ['M', 'C', 'D']) {
    const r = q[k];
    if (r.dispo < r.capa && r.prod == 0 && r.lastprod > 0) r.prod = r.lastprod;
    r.dispo += r.prod / 3600 * dt;
    if (r.dispo >= r.capa && r.prod > 0) { r.dispo = r.capa; r.lastprod = r.prod; r.prod = 0; }
  }
  q.lastTime = nowMs;
  return q;
};

/** Seconds until storage is full (not in OGame Live; added for the port). Infinity when not growing. */
OGX_LIVE.secondsUntilFull = (r) => (r.dispo >= r.capa ? 0 : r.prod > 0 ? (r.capa - r.dispo) / (r.prod / 3600) : Infinity);

/** OGame Live dataManager.computeNeededShip */
OGX_LIVE.neededShips = (amount, capacity) => (capacity > 0 ? Math.ceil(amount / capacity) : 0);

/** Cost overlay (OGame Live planetsProductionDisplay.display, lines 677-710) + time until affordable (port addition). */
OGX_LIVE.costOverlay = (cost /* {M,C,D,E} */, prod /* body prod */, capSC, capLC) => {
  const out = { total: 0, missingTotal: 0, rows: {}, secondsUntilAffordable: 0 };
  for (const k of ['M', 'C', 'D']) {
    const need = cost[k] || 0; out.total += need;
    const diff = prod[k].dispo - need;                         // OGame Live "missing" (signed)
    const missing = Math.max(0, -diff);
    out.missingTotal += missing;
    out.rows[k] = { need, diff, sc: OGX_LIVE.neededShips(Math.abs(diff), capSC), lc: OGX_LIVE.neededShips(Math.abs(diff), capLC) };
    if (missing > 0) out.secondsUntilAffordable = Math.max(out.secondsUntilAffordable, prod[k].prod > 0 ? missing / (prod[k].prod / 3600) : Infinity);
  }
  out.sc = OGX_LIVE.neededShips(out.missingTotal, capSC); out.lc = OGX_LIVE.neededShips(out.missingTotal, capLC);
  return out;
};

/** Expedition max find, OgameX rules (ExpeditionMission.php:1020-1137). Upper bound of a NORMAL find of metal. */
OGX_LIVE.expeditionMaxFind = ({ topPoints, playerClass, economySpeed, hasPathfinder = false, rewardMultiplier = 1 }) => {
  const steps = [[1e4, 4e4], [1e5, 5e5], [1e6, 12e5], [5e6, 18e5], [25e6, 24e5], [5e7, 3e6], [75e6, 36e5], [1e8, 42e5]];
  let base = 5e6; for (const [lim, v] of steps) if (topPoints < lim) { base = v; break; }
  let max = Math.floor(base * (playerClass === 'explorer' ? 1.5 * economySpeed : 1));
  if (hasPathfinder) max *= 2;
  max = Math.floor(max * rewardMultiplier);
  return { metal: max, crystal: Math.floor(max * 2 / 3), deuterium: Math.floor(max / 3), min: Math.max(1, Math.floor(base * 0.1)) };
};
```

---

## 10. OGame Live bugs and quirks not to port

1. `InstallationsParser` initializes `currentBuild` only when `installations` is missing (`installationsParser.js:10`).
2. Food warning tests `prodPercents.deut < 40` instead of `food` (`planetsProductionDisplay.js:167, 218`).
3. `percent()` returns 0 only for `dispo === 0`; negative values give negative widths.
4. `planet.prod.M.prod` is used before `F` is initialized for old data (`:50-61`). The order is harmless but fragile.
5. Moon `#d_dispo` production is rendered even for raiders (`:266-268`, missing the `game_style` check).
6. `computeMaxExpeRessources` is never called and references undefined globals (§5.6).
7. `typeFrom` tests `destCoordsTypeNode != null` instead of `fromCoordsTypeNode` (`flyingFleetObserver.js:86`).
8. The worker adds the cargo of every arriving flight, including foreign spies and own outbound attacks (§4.15).
9. `% nb_systems` gives system 0 (§4.13).
10. Duplicate element ids (`#m_dispo` and others) per planet.
11. `readablize` breaks for `n < 1`.
12. `GM_deleteValue` ignores the prefix (`utilities.js:88-90`).
13. Countdown classes are added from `missionClass`; in OgameX that class is always `friendly`.
14. `formatTime` shows over-24 h durations as `HH:MM:SS` with large hours. Add days for the port.

## 11. Open questions

1. Expedition top score: `EXM:1033` uses the max `general` over all `highscores` rows (admins and NPC players included), while `POST /ajax/highscore` hides admins unless `highscore_admin_visible` is set. Should the port let the user override the value?
2. `expedition_reward_multiplier_resources` / `_ships` are admin-only settings that are not shown in `/overlay/server-settings`. The port needs a user option (default 1.0) or an admin-page scrape (`/admin/server-settings`, admins only).
3. Refresh-all (§4.7) issues 1 request per body and changes `cp` server-side for the duration. Should it be opt-in, and is the "restore `cp`" race (the user navigating meanwhile) acceptable?
4. `APP_TIMEZONE` other than UTC breaks the `serverTime` string parse. Calibrate once against a JSON `serverTime` (for example from `/ajax/resources?technology=1`).
5. Deuterium in outbound tooltips includes half the fuel consumption. Recompute the fuel (`fleet.md` §2.7) for exact in-flight sums, or accept the overstatement?
6. Speed values from `SpeedPropertyService` can be fractional (`(base/100) × pct`) and are truncated by `formatNumber`. Check-target `shipsData.speed` may carry the unrounded value. Use whichever is fresher.
