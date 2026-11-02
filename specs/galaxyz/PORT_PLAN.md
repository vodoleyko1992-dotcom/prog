# OgameX Suite -> GALAXYZ (ogamex.eu, 2Moons fork): port plan

Status: plan only, no code changed. Inputs: `specs/CORE_API.md` (core 0.1.0), `ogamex-suite/shared/core/*`,
`ogamex-suite/suite/00-suite.js`, `ogamex-suite/modules/{live,infinity}/*`, and the GALAXYZ area specs in this folder:
`layout.md`, `buildings.md` (+ `elements.json`), `empire.md`, `fleet.md`, `galaxy.md`, `messages.md` (canonical; `messages-gzmessages.md` merged into it), `mechanics.md`
with their `*-recipes.js`, `mechanics-calc.js` and `fixtures/`.

Effort unit: **d** = one focused developer day including fixture tests. Estimates assume the recipes in this folder are lifted
into core almost verbatim (they already run on the real pages).

---

## 0. Summary

* The core API that modules see (`OGX.state`, `OGX.flights`, `OGX.fleet`, `OGX.galaxy`, `OGX.messages`, `OGX.calc`, `OGX.catalog`,
  `OGX.dom`, `OGX.storage`) is still the right shape. Most of the work is **under** it: new parsers, new transport, new formulas.
  The modules talk to the game DOM directly in only a few places (planet list, list items, fleet forms, galaxy rows, message rows).
* GALAXYZ has **no JSON API at all** (except the upstream `fleetAjax` one-click spy/recycle, unverified). Everything is a full
  HTML page or an HTML fragment (`&ajax=1`), driven by `game.php?page=<p>&mode=<m>`. There is no CSRF meta. Fleet dispatch takes three
  form POSTs that share a one-time token.
* There are big wins too. The fleet event box is on **every** full page, so flights update passively with no request. `page=imperium`
  returns stock, levels, ships and defence of **every** body in one request, with no `cp` switch. Prefill links
  (`page=fleetTable&galaxy=&system=&planet=&planettype=&target_mission=`) are native.
* Recommended design: an **engine adapter**. Core keeps one public API. Each engine (`ogamex`, `galaxyz`) supplies detection, identity,
  routing, URL building, parsers, transport, catalog data and the formula profile, plus a `caps` capability map that modules check to
  hide features the engine cannot support. Keeping OgameX working costs about 3.5 d more, spent moving the existing code behind the seam.
  That is worth it because the OgameX fixtures and tests then guard the refactor.
* Totals (estimate): GALAXYZ core **≈ 27.5 d**; modules **≈ 30 d**; OgameX kept working behind the seam **+3.5 d**; about **61 d** in all.
  About half of the module work can start now. The rest waits for the real pages listed in §6.

Module verdicts at a glance:

| Section | Module | Verdict | Effort | Blocked by real pages? |
|---|---|---|---|---|
| Live | menu | adapt | 0.5 d | no |
| Live | planetbar | adapt | 1.5 d | moons (P1) |
| Live | inflight | adapt | 1 d | hostile events (P5) for the alert part |
| Live | techcost | adapt | 2 d | details AJAX (P3) for the overlay; badges not blocked |
| Live | fleetinfo | rework | 2 d | step-2 hold/expedition (P6) |
| Live | expedition | rework | 2 d | expedition step 2 + messages (P6, P9) |
| Live | timeline | adapt | 1 d | no |
| Infinity | panel | adapt | 1 d | no |
| Infinity | empire | adapt (simpler) | 2 d | moon column (P1) |
| Infinity | targets | rework | 3 d | foreign galaxy (P2), statistics/search (P10) |
| Infinity | spy | rework | 3 d | foreign galaxy + fleetAjax (P2, P4) |
| Infinity | stats | rework | 3 d | combat/expedition/transport messages (P8, P9) |
| Infinity | stalk | rework, reduced | 2 d | foreign galaxy (P2), deuterium cost (P7) |
| Infinity | flights | adapt | 1.5 d | hostile/ACS events (P5) |
| Infinity | fleethelp | rework | 2.5 d | no (step 1/2 real); direct send needs a live test |
| Infinity | todo | adapt | 2 d | running queue (P3), game_speed (P7) |
| Infinity | prefs | as-is + small fixes | 0.5 d | no |

Nothing has to be dropped outright. Features that do not exist in this engine are hidden through `caps`: player class, lifeforms,
DM halving, OgameX TrashSim prefill, the exact per-unit battle simulator and the per-message detail fetch. Details are in §5.

---

## 1. Engine facts that drive the design (from the area specs)

| Topic | OgameX (old core assumption) | GALAXYZ | Spec |
|---|---|---|---|
| URL scheme | `/overview`, `/fleet/movement`, `/ajax/...` | `/<Universe>/game.php?page=<p>[&mode=<m>][&cp=<id>]`; page names are case-sensitive (`fleetTable`) | layout §2 |
| Detection | `meta[csrf-token]` + `meta[ogame-version]` + OgameX marker | `meta[name=generator]` `^(GALAXYZ\|2Moons)`, path `/game.php`, inline `serverTime = new Date(` | layout §1 |
| Identity | host + player id from metas | host + **universe path segment**. The player id is **not** in the layout (only `Dialog.Playercard(4377,…)` on tournament/statistics). The name is in `#playerName .textBeefy` | layout §8 |
| Auth / CSRF | `_token`, `X-CSRF-TOKEN`, 419 retry | none. Fleet steps carry their own one-time `token` (600 s). A logout shows up as a redirect to `index.php` | layout §14, fleet §2 |
| Current body | `?cp=` sticky server-side | the same (`Session.class.php:291-310`): sticky for **every tab**. Invalid `cp` is ignored silently | layout §4.4 |
| Body list | `#planetList .smallplanet[data-planet-id]` + `a.moonlink` | `#planetSelector option` = the authoritative list incl. moons (`(Moon)` guessed). `#planetList` repeated per planet, id only in `a.planetlink` `cp=`. Moons in the list unknown | layout §4 |
| Resources | inline `reloadResources` JSON, tooltips | `resourceTicker({...})` inline calls, `#current_<res>[data-real]`, per hour, `.` thousands, ticker `B` = 1e12 | layout §5 |
| Server time | JSON `serverTime` unix | wall clock `new Date(Y,M0,D,h,m,s)` with no zone. Instant = event `data-fleet-end-time - data-fleet-time`. Aeternum = UTC+2 | layout §6 |
| Fleet events | `GET /ajax/fleet/eventlist/fetch`, eventbox JSON | server-rendered `#messages_collapsed .OvfleetEvents_` on every full page (first event duplicated). Foreign fleets: no `own` prefix, outward only | layout §7, fleet §6 |
| Own fleets / recall | `/fleet/movement`, `POST recall-fleet` JSON | `page=fleetTable` table (return countdown; fleet id only while recallable), `POST page=fleetTable&action=sendfleetback fleetID=` | fleet §1 |
| Dispatch | `POST /ajax/fleet/dispatch/send-fleet` JSON | `fleetStep1` -> `fleetStep2` -> `fleetStep3` form POSTs with a shared token; origin = current body at step 3; `ship<ID>`, `planet`, `type`, `speed` 1..10, `staytime` | fleet §2 |
| Mini fleet | `send-mini-fleet` JSON | `GET page=fleetAjax&ajax=1&mission=6\|8&planetID=<target DB id>` -> `{code 600..699}` [UPSTREAM] | galaxy §1, fleet §3.3 |
| Galaxy | `POST /ajax/galaxy` JSON, free | full HTML page per system, `tr.row` cells, **costs deuterium** per foreign system (10 upstream), activity as text `(*)` / `(N min)` | galaxy §0-3 |
| Highscore / search | `/ajax/highscore`, `/ajax/search` JSON | `page=statistics&who&type&range` HTML; `page=search&mode=result&ajax=1` HTML fragment [UPSTREAM] | galaxy §1, §7 |
| Messages | tabs/subtabs, `/ajax/messages/{id}` detail, CSRF delete | numeric `messcat`, `mode=view&messcat&site&ajax=1` fragment (**marks read**), full body in the list, no detail; `GET page=messages` alone = category grid only, no list; delete = form POST `mode=action&ajax=1&messcat&side=1&actionTop=deletemarked&submitTop=Confirm&messageID[id]=1` (no token) | messages §0.1, §1 |
| Build actions | `POST /<page>/add-buildrequest` JSON | `POST page=buildings cmd=insert&building=`, `page=research cmd=insert&tech=`, `page=shipyard fmenge[id]=n`; 302 back, no message. Confirm by re-parsing | buildings §2, §6 |
| List pages | `li.technology[data-technology]`, timers on items | `.technologyContainer`, `button.upgrade` = can build, research level as text only, no timers; all buildings on one page; defence = `shipyard&mode=defense` | buildings §3 |
| Empire | none (refresh = 6 pages × bodies with `cp`) | `page=imperium`: one table, every body | empire §2 |
| Ids | OGame ids | 2Moons ids: 217 Battle Transporter, 218 Avatar, 219 Battle Recycler, 213-216 differ, new 6, 131-133, 220, 409-411, fork 71-73; no 36, no lifeforms | buildings §1, `elements.json` |
| Economy | `economySpeed`, classes, plasma, position bonus | `resource_multiplier` 22000, `storage_multiplier` 5, `fleet_speed` ×7, `game_speed` unknown; no classes/plasma/position; Geologist and 131-133 bonuses | mechanics §1 |
| Flight | wrap-around, per-mission speed factors, classes | no wrap, one factor (×7), fuel `round(Σ)+1`, 10 % steps | fleet §4, mechanics §7 |
| Combat / loot | OGame per-unit engine, 50/75 % loot | "xnova" stack engine, loot always 50 %, a new moon wipes the debris | mechanics §8-9 |

---

## 2. Engine-adapter design

### 2.1 Shape

```
shared/core/00..04, 06-time, 07-dom, 20-style, 21..23-diag   engine-neutral (small changes, §3)
shared/core/05-page.js        -> thin: OGX.page delegates to OGX.engine.page
shared/core/08/09-catalog     -> data comes from OGX.engine.catalogData
shared/core/10-calc.js        -> facade over OGX.engine.calc (formula profile)
shared/core/11-parse.js       -> facade: OGX.parse.<x> = OGX.engine.parse.<x> (same return shapes, see 2.3)
shared/core/12-http.js        -> transport neutral; api.* moved into engines
shared/core/13-bridge.js      -> onXhr matcher on (path, query) instead of pathname only
shared/core/14..17, 19        -> keep public API; data acquisition via OGX.engine.sources
shared/engines/00-registry.js -> OGX.engines = {}, OGX.engine = null, OGX.engineFor(doc, loc)
shared/engines/ogamex/*.js    -> current OgameX code moved here (detect, routes, parse, api, catalog-data, calc)
shared/engines/galaxyz/*.js   -> new: detect.js, routes.js, parse-layout.js, parse-lists.js, parse-fleet.js, parse-galaxy.js,
                                 parse-messages.js, api.js, catalog-data.js (from elements.json), calc.js (from mechanics-calc.js)
```

Load order in `manifest.json`: `00-ogx`…`04-settings`, then `engines/00-registry.js`, `engines/ogamex/*`, `engines/galaxyz/*`,
then `05-page`…`23-learn`. Engines only **define** objects at load time. `OGX.boot` picks one.

### 2.2 Engine interface

```js
OGX.engines.galaxyz = {
  id: 'galaxyz', label: 'GALAXYZ / 2Moons',
  detect(doc, loc) -> boolean,                 // cheap; layout §1 rule
  identity(doc, loc) -> { host, universe, nsHost /* 'ogamex.eu/Aeternum' */, playerKey, playerId|null, playerName },
  caps: { /* §2.4 */ },
  page: { route(doc, loc) -> PageInfo, url(name, params) -> string, go(name, params) },
  time: { anchor(doc) -> { wallMs, renderUnix|null } },           // §3 06-time
  num:  { parse(s), parseShort(s) },                                 // '.' thousands, ',' decimal; B = 1e12
  parse: { /* same names and return shapes as OGX.parse today, + new ones (2.3) */ },
  sources: { /* how state/flights/galaxy/messages obtain data (2.5) */ },
  api:   { /* actions (2.5) */ },
  hook:  { relay: [{ page, mode?, kind }] },                         // what page-hook.js relays (§3 13-bridge)
  catalogData, calc,
};
```

`OGX.boot`: `const eng = OGX.engineFor(document, location)`. If there is none, return (same cost as today's `isOgx`).
Then `OGX.engine = eng`, `storage.init({ host: id.nsHost, playerId: id.playerKey })`, and the boot continues as before.
`OGX.page.isOgx()` stays as an alias that returns `!!OGX.engineFor(...)`.

### 2.3 Canonical shapes are kept; engines fill what they can

Modules keep reading `Body`, `Flight`, `ParsedSystem`, `MessageItem`, `TechDetails` and the rest. GALAXYZ fills only the fields it can.
Missing data stays `null`, never a guessed 0. Additions to the canonical shapes:

* `Body.order` comes from `#planetSelector` order. `Body.empireCol` is the imperium column (empire §2.2, a different order).
* `Flight.fleetId` is the real GALAXYZ fleet id from the event key. `realMissionId = fleetId`. `rowId = 'fleettime_<end><id>'`. There are
  no synthetic rows: the outward and return legs are two events with the same id.
* `Flight.cargo.approx = false` when `.textForBlind` #2 is present. Otherwise cargo is `null` (foreign fleets, or own fleets with no cargo).
* `ParsedSystem.positions[].planetId` and `.playerId` may be `null` (own rows always, foreign rows when no `doit(`/`Playercard(` link exists).
  `activity` has the same encoding, but planet and moon share one value. New field `activitySource: 'combined'`.
* `MessageItem.cat` (numeric `messcat`) replaces `tab/subtab`. `messages.classify()` returns the same keys (`espionage_report`, …).
* `PageInfo.name` is a canonical PageName. `PageInfo.aliases` lets one GALAXYZ page satisfy several old names (2.6).

### 2.4 Capability map (modules gate features on it)

| cap | ogamex | galaxyz | used by |
|---|---|---|---|
| `jsonApi` | true | false | core only |
| `playerClass` | true | false | panel, spy, expedition, calc |
| `lifeforms`, `crawlers`, `plasmaBonus`, `positionBonus` | partly | false | planetbar, empire, techcost |
| `eventListAjax` | true | false (events in every page) | flights |
| `foreignFleetDetails` | true | partial (ship counts depend on espionage tech) | inflight, flights |
| `galaxyAjax` / `galaxyFree` | true / true | false / false (deuterium per view) | stalk, targets |
| `galaxyIds` | true | partial (foreign rows only, via links) | targets, spy |
| `messageDetail` | true | false (full body in the list; combat = `page=raport`) | spy, stats |
| `messageReadOnList` | false | **true** (listing marks read) | spy, stats |
| `exactSpyValues` | true | partial (exact only via Simulate `im[ID]=`) | spy |
| `dispatch` | `'json'` | `'steps3'` | fleet |
| `miniFleet` | `'json'` | `'fleetAjax'` (needs target DB id) | spy, targets |
| `empirePage` | false | true | empire, state.refreshBodies |
| `buildQueueOnItems` | true | false | techcost, todo |
| `techDetailsJson` | true | false (HTML in JSON wrapper, unverified) | techcost, todo |
| `halving` | true | false | todo |
| `cpSticky` | true | true | menu, empire, todo, fleethelp |
| `serverSettingsPage` | true | unknown (`page=Serverinfo`) | state.ensureServer |
| `nativePrefillUrl` | false | true | fleet.prefill |

### 2.5 Sources and actions per engine

| Core need | OgameX source | GALAXYZ source |
|---|---|---|
| snapshot of current page | metas + `#planetList` + inline JSON | `GZLayout.parseLayout(doc)` (layout-recipes.js) |
| all bodies refresh | 6 pages × bodies with `cp` | **one** `GET page=imperium` (no `cp`); production % per body only from `page=resources&cp=X` (sticky) |
| research levels | research page | imperium (research row) or research page text levels |
| flights list | `/ajax/fleet/eventlist/fetch` | events from **any** full page already loaded. Refresh = `GET page=fleetTable` (event box + own list + slots) |
| hostile poll | eventbox JSON every 60 s | `GET page=fleetTable` (full page) every `core.flightsPollSec` (default raised to 120 s), skipped when a page load in the last N s already gave events |
| slots | `/fleet` | `page=fleetTable` header (fleet / expedition / asteroids), galaxy `#slotValue` |
| ship stats | check-target `shipsData` | computed from `elements.json` + research bonus %. `fleetTable` shows engine bonus % (`img.tooltipTop[title*="+140 %"]`). `fleetStep1` `data.ships[id].speed` is exact for the chosen ships |
| server settings | `/overlay/server-settings` | `fleetStep1` `data.gamespeed` (fleet ×7) + derive from `page=resources` (resource_multiplier, storage ×5) + `page=Serverinfo` when it is confirmed (P7) |
| top score | `/ajax/highscore` | `page=statistics&who=1&type=1&range=1` (only used by expedition today; not needed on GALAXYZ, see §5) |
| galaxy system | `POST /ajax/galaxy` | `GET page=galaxy&galaxy=&system=` (no `cp`), parse with `GZGalaxy` |
| player search | `/ajax/search` | `GET page=search&mode=result&ajax=1&type=&search=` |
| messages list | `/ajax/messages?tab&subtab&pagination` | `GET page=messages&mode=view&messcat=N&site=P&ajax=1` |
| send fleet | JSON | `GZFleet.send` (step1 -> step2 -> step3), origin by `cp` on step 1 and every following step |
| recall | JSON | `POST page=fleetTable&action=sendfleetback` `fleetID` |
| mini fleet | JSON | `GET page=fleetAjax&ajax=1&mission&planetID` |
| build / research / units | JSON add-buildrequest | form POSTs (buildings §6), then re-parse the returned page |
| delete message | CSRF POST | `POST page=messages` `mode=action&actionTop=deletemarked&messageID[id]=1` (never `deleteunmarked` with an empty list) |

### 2.6 Page names

`route()` returns `{ name, aliases, step?, mode? }`. `page.is(...names)` matches `name` or any alias, so module `pages:` filters keep
working unchanged:

| GALAXYZ `page[&mode]` | canonical | aliases (old module filters) |
|---|---|---|
| `overview` (or no `page`) | overview | |
| `buildings` | buildings | `resources`, `facilities` |
| `resources` | resourceSettings | |
| `research` | research | |
| `shipyard&mode=fleet` (default) | shipyard | |
| `shipyard&mode=defense` | defense | |
| `fleetTable` | fleet | `movement` |
| `fleetStep1` / `fleetStep2` / `fleetStep3` | fleet | step = 1 / 2 / 3 (`fleetinfo` reads `step`) |
| `galaxy` | galaxy | |
| `messages` | messages | |
| `statistics` | highscore | |
| `imperium` | empire (new) | |
| `officier` | premium | |
| `trader` / `fleetDealer` | merchant | |
| `techtree`, `tournament`, `transport`, `alliance`, `buddyList`, `battleHall`, `raport`, `Serverinfo`, popups | `other` (+ `raw: page`) | |

Info/error pages (no `#rechts`, `.headerRS + .mainRS`) get `info: true`. Popups (`body.popup`) get `popup: true`, and boot runs in a
reduced mode there: no modules, journal only.

---

## 3. Core changes, file by file

Effort shown as `ogamex-keep / galaxyz-new`.

| File | Change | Effort |
|---|---|---|
| `manifest.json`, `loader.js` | add `shared/engines/**`. The description stops saying "OgameX only". `exclude_matches` stays. Suggest a default allow-list entry `ogamex.eu` in the popup hint. Loader is unchanged (gate/filter are generic) | 0.25 d |
| `00-ogx.js` (boot) | engine selection and identity before `storage.init`. Popup mode. `ctx.engine = OGX.engine`, `ctx.caps`. Module defs may declare `requires: ['empirePage', …]` (skip with an S `module-skip-caps` event when missing) | 0.5 d |
| `01-util.js` | `parseGameNumber` becomes engine-aware: `OGX.util.num = OGX.engine.num`. GALAXYZ: `.` thousands, `,` decimal, JS short `1.411 M` (long scale, B=1e12) vs PHP `47.5K` (short scale, `.` decimal). Rule from layout pitfalls: never parse short forms when `data-real`/`title`/ticker exist. Add `parseGzDate('30. Oct 2026, 10:20:01')` with month names per `Lang` | 0.5 d |
| `03-storage.js` | no API change. `host` passed by boot = `ogamex.eu/Aeternum` (universe-scoped). `playerId` = `n:<playerName>` until the numeric id is learned (tournament/statistics `Dialog.Playercard(id,'name')`), then migrate once with `registerMerger`-style key copy and store `player.id`. Names are unique per universe, so the name key is a safe interim | 0.5 d |
| `05-page.js` | delegate to `OGX.engine.page` (2.6). `page.url(name, params)` is name-based: GALAXYZ builds `location.origin + /<Universe>/game.php?page=…`. Modules currently pass OgameX paths (`'/fleet'`, `'/galaxy'`), so add a path->name shim for the OgameX names to keep modules unchanged | 0.5 / 0.5 d |
| `06-time.js` | add `calibrateWall(wallMs, renderUnix)`: tzOffset = round15(wall - unix). Anchor sources: event box `data-fleet-end-time - data-fleet-time`, fleetTable timers. Store the offset (server scope) and recalibrate on every page with an event (DST). Without an anchor, use the stored offset; on first install with no fleet, show the clock as "approx." `parseServerWall` learns the GALAXYZ formats (`D. Mon YYYY, HH:MM:SS`, `HH:MM:SS` + date of render) | 0.5 d |
| `07-dom.js` | `menuEntry` for GALAXYZ: `#menuTable` `li > span.menu_icon + a.menubutton > span.textlabel` (layout §10). Floating root on `body` (z-index > 5, < fancybox). `waitFor` unchanged | 0.5 d |
| `08-catalog-data.js`, `09-catalog.js` | data per engine. GALAXYZ data generated from `elements.json` (95 elements: prices, factors, req, rapidfire, stats). Russian names for the 2Moons/fork ids (6, 71-73, 131-133, 213-220, 409-411). `shipIds`/`fleetShipIds`/`civilShipIds` per engine (212 satellite stays civil, 217 is now a **combat transporter**, 219 a recycler). `missions` add 11 (DM expedition) and the fork "asteroids" placeholder. `idFromTitle` uses page names (spy reports have names only) | 0.25 / 1 d |
| `10-calc.js` | facade over `engine.calc`. GALAXYZ = `GZCalc` from `mechanics-calc.js` (production ×22000, storage ×5, no `max(4-L/2,1)`, University, distance without wrap, one speed factor, fuel `round(Σ)+1`, loot 50 %, xnova battle, expedition = fleet cost). Same function names, so modules keep calling `calc.production`, `calc.fuel` and the rest. `normClass` always returns `'none'`. `halvingCost` returns `null` | 0.5 / 2 d |
| `11-parse.js` | facade. GALAXYZ parsers from the recipes: `planetList`/`currentBody`/`inlineResources`/`player`/`overviewInfo` <- `GZLayout`; `techList`/`queueTimers`/`resourceSettings` <- `tools/buildings/parse-buildings.js`; `fleetPage` <- `GZFleet` (fleetTable + steps); new `empire(doc)` <- `GZEmpire`; `highscorePlayers` <- `GZGalaxy` statistics; `serverSettings` <- Serverinfo (stub until P7). `csrf()` returns `''` | 0.5 / 3 d |
| `12-http.js` | split transport (neutral) from `api` (per engine). GALAXYZ transport: no `_token`, no `X-CSRF-TOKEN`, no 419 path. `loggedOut` = final URL not `/game.php`, or body with a login form. Every request must state `cp` explicitly (`cp: null` = omit) because of the sticky session. `withPlanet` restores with `game.php?page=overview&cp=<orig>&ajax=1` (cheaper; verify `ajax=1` keeps the cp switch — it should, `cp` is read in common.php) and keeps the cross-tab lock. `api.*` per 2.5 | 1 / 2.5 d |
| `13-bridge.js`, `main/page-hook.js` | gate on `engine.detect` (the hook runs in MAIN world at document_start, before the body; use `meta[name=generator]` + `/game.php` path). The relay list matches on the **query** (`page`, `mode`): `messages&mode=view` (game's own list load -> `messages.watch`), `fleetAjax` (spy/recycle click -> `fleet:sent`, slots), `fleetStep1&mode=checkTarget`, `*DetailsAjax` (-> `techdetails:open`). `onXhr(matcher)` accepts `{ page, mode }` or a function. Page-world methods: `fleet.*` (the OgameX `fleetDispatcher`) do not exist. GALAXYZ fleet prefill is plain DOM (inputs `ship<ID>`, `#galaxy/#system/#planet/#type/#speed`, step-2 `input[name=mission]`, `metal/crystal/deuterium`), so these move to a content-world helper `engine.fleetForm`. `resources.live()` -> DOM `#current_<res>[data-real]` + ticker args (no page world needed) | 0.5 / 1 d |
| `14-state.js` | `snapshotSync` from `GZLayout.parseLayout` (current, planets, resources, player, events, overview) + page-specific parsers (lists, imperium, resources settings, fleetTable). `merge` unchanged (per-field timestamps). `refreshBodies`: if `caps.empirePage`, then **one** imperium fetch for levels/ships/defence/stock of all bodies (no cp, no notice); percents/energy still need `page=resources&cp=X` (sticky, behind `core.cpConfirmed`). `server()` gets the four GALAXYZ numbers (`resource_multiplier`, `storage_multiplier`, `fleet_speed`, `game_speed`) plus the old fields mapped (`economySpeed` = null). `ensureServer` = derive from pages + Serverinfo. `shipStats` = computed. `ensureTopScore` unused on GALAXYZ | 0.5 / 2.5 d |
| `15-flights.js` | new `parseEvents(doc)` (layout §7 / fleet §6 recipe: de-duplicate by id, `own`, status flight/return/holding, style -> mission id, fleetId, coords normalised, `.textForBlind` ships/cargo), `parseFleetTable(doc)` (own list, recall ids). Merge rule: the event box is authoritative for times (unix), fleetTable adds the recall id and ship names. Ship names -> ids via `catalog.idFromTitle`. Expeditions show as style `transport` to position 16: mission 15 is inferred from position 16. Passive capture on **every** page load (bus `flights:updated`), so `get()` rarely fetches. `fixOutboundFuel` -> no-op (fuel is not in the event) | 0.25 / 2 d |
| `16-fleet.js` | `send()` -> `engine.api.sendFleet` = three POSTs with `cp` on every step. Errors are read from the info page text. Success = `th.success` on step 3. `prefill.open()` -> native URL `page=fleetTable&cp=&galaxy=&system=&planet=&planettype=&target_mission=`, plus stored ships/cargo applied by `initPrefill` with DOM filling on fleetTable (ships) and step 2 (mission radio, resources). The game JS then computes distance/duration itself. `estimate()` uses `GZCalc` (verified to the second on the real send) | 0.25 / 2 d |
| `17-galaxy.js` | `fetch(g,s)` = HTML page (no cp), parse with `GZGalaxy`. **Every fetch costs deuterium on the current body**: `scan()` gets a `costPerSystem` (from `server.deuterium_cost_galaxy`, default 10 until P7), a hard per-day budget and a confirm that shows the total. It stops on the "not enough deuterium" page. `galaxy:render` is emitted once on page load (no XHR re-render). `rowSlot` appends to the last cell of `tr.row` (rows have no id; position = row index + 1). `current()` from `form#galaxy_form` inputs. Player index fed by foreign rows + statistics | 0.25 / 2 d |
| `18-exptexts-data.js` | GALAXYZ: 2Moons expedition texts (en + ru) from `fixtures/messages-texts.json`, until real expedition messages arrive (P9) | 0.5 d |
| `19-messages.js` | `fetchList(cat, site)` via the view fragment. **Warn: it marks read** (`caps.messageReadOnList`). `fetchDetail()` -> `null` on GALAXYZ except combat (`page=raport&raport=<md5>`). `watch()` observes `#messagestable` replacement (the game's `Message.getMessages` swaps the table; there is **no** server-rendered list on the full page: the "inline cat-0 list" was a DOM snapshot after a click, messages §0.1). Scope from `table#messagestable` (an empty old form stays below it). `classify()` by `messcat` + subject + body structure. Parsers: lift `messages-recipes.js` (`GZMessages`, canonical, validated on the REAL pages; the merge is done). Convert its `{galaxy,system,planet}` coords to arrays, as today | 0.25 / 2.5 d |
| `20-style.js` | colours tuned for the dark `gow` theme. Class names unchanged | 0.25 d |
| `21-23` diag/learn | `learn.pageKey` uses route name + `:moon`. Journal G events: GALAXYZ shows info pages instead of fadeBox; capture `.headerRS + .mainRS p` text on info pages as G `game-message`. Redaction: the fleet `token` and message bodies count as secrets | 0.5 d |
| `suite/00-suite.js`, `hub.js`, popup | titles/description mention GALAXYZ. Hub menu entry via `dom.menuEntry` | 0.25 d |
| Tests | `tests/engines/galaxyz/*.test.js` run every core parser on `specs/galaxyz/fixtures/*` against the `*-expected-parse.json` files (already produced by the area check scripts). The OgameX fixture tests keep running against the ogamex engine | 1.5 d |

**Core total ≈ 27.5 d** (GALAXYZ, message-spec merge already done, incl. 1.5 d tests) + **≈ 3.5 d** (move OgameX code behind the seam, keep its tests green).

Sequencing inside core: registry/detect/identity/storage/time (2 d) -> layout parse + state snapshot (3 d) -> catalog + calc (3 d) ->
http transport + api read side (2 d) -> flights (2 d) -> fleet send/prefill (2 d) -> galaxy (2 d) -> messages (3 d) -> the rest.

---

## 4. Cross-cutting rules for GALAXYZ (all code)

1. **Never add `cp` implicitly.** Any request with `cp` moves the user's planet in every tab. Background reads use no `cp`. Writes for
   another body go through `http.withPlanet`, which restores the body. The `core.cpConfirmed` notice stays.
2. **Listing messages marks them read.** Background message scans are opt-in, behind the same warning OgameX already shows.
3. **Galaxy views cost deuterium.** No automatic scanning by default. Show the cost before any scan.
4. **No JSON means confirm by re-parsing.** After every POST, parse the returned page (queue box, level, `th.success`, info text). Never trust the HTTP status.
5. **Duplicated ids** (`#planetList`, `#OvfleetEvents`, `#fleettime_*`, `#recycler`, `#technologies`): only `querySelectorAll('[id=…]')` or structure.
6. **Tooltips in `title`** get emptied by the tooltip library on first hover. Read them at boot (document_end) and cache them. Prefer `data-*`/text.
7. **Language is a user setting** (`var Lang`). Match by structure, class, order or URL params, not by English words. Where text is unavoidable
   (message subjects, `(Moon)`), keep en + ru tables.
8. Number and date formats come only through `OGX.util.num` / `parseGzDate`.
9. Actions (send, build, delete, recall, fleetAjax) only on an explicit user click, as today. The bot section keeps its own rules.

---

## 5. Modules (7 Live + 10 Infinity)

Legend: **as-is** = runs with core changes only; **adapt** = DOM selectors / small logic changes; **rework** = significant rewrite of
acquisition or UI flow; **drop** = feature removed for this engine (hidden by caps).

### 5.1 Live

| Module | Verdict | What changes | Effort | Blocked |
|---|---|---|---|---|
| **menu** | adapt | Entry in `#menuTable` (core `dom.menuEntry`). "Обновить данные всех планет" -> imperium refresh (one request, no `cp` notice needed for levels; the notice stays for production %). Galaxy footer clock: `#colonized` exists (galaxy §2). Server-data block shows the four GALAXYZ numbers | 0.5 d | no |
| **planetbar** | adapt | Planet-list markup: `[id=planetList] .smallplanet`, `a.planetlink` `cp=`, `i.buildingIco` (= build icon; the planet list carries no countdown, so the timer comes from state queues when known). Moon switcher: moons are in `#planetSelector`, list markup unknown -> moon rows only from the selector until P1. Drop crawler and class lines (caps). Production per hour from the ticker (exact), so no `calc.production` guess is needed for the current body | 1.5 d | moons P1 |
| **inflight** | adapt | Works on core `flights`. Incoming icons go into `.smallplanet` (no `data-planet-id`, use `cp` from the link). Click -> `page=fleetTable`. Foreign cargo is unknown (`null`), so show "?" instead of 0. Hostile detection depends on the non-`own` class mapping (fleet §6, unverified) | 1 d | P5 for hostile |
| **techcost** | adapt | Badges: GALAXYZ list items (`.technologyContainer` items, `span.level[data-value]` for buildings/units, **text** level for research, `button.upgrade`/`data-status="off"`). Cost from `calc.cost` with `elements.json`. Red/green from the projected stock. Overlay: the details panel comes from `TechnologyDetailsAjax|ResearchDetailsAjax|ShipDetailsAjax` (JSON wrapper with HTML, never captured) -> ship badges now, overlay after P3. `#build_amount` equivalent unknown | 2 d | P3 for overlay |
| **fleetinfo** | rework | Three pages instead of one dispatcher. **fleetTable**: ship inputs `ship<ID>`, speed from the `span.tooltip` `Speed:` text -> selected count / cargo / slowest speed table under the form. **fleetStep1**: the game already shows distance, duration, arrival, return and consumption (flotten.js). Add only what is missing (cargo vs resources on the body, fuel budget, speed table per %) using `data={...}` JSON and `GZCalc`. **fleetStep2**: capacity left, consumption, `#fleetPoints`; arrival/return for the chosen `staytime` (hold/expedition markup unseen). Remove check-target capture and the per-mission speed factor | 2 d | P6 |
| **expedition** | rework | Button in fleetStep1 next to `#galaxy/#system/#planet`: sets `planet=16`, random system ±N **without wrap** (clamp 1..max_system, unknown -> from the galaxy input bounds), `type=1`, speed. Mission 15 is selected on step 2 (radio), `staytime` is remembered. The max-find box is **replaced**: GALAXYZ finds = fleet cost capped by free cargo, plus 1/9 total-loss risk (mechanics §11). Show "cargo free vs fleet value" and the risk instead of top-1 points. Expedition slots from fleetTable | 2 d | P6, P9 |
| **timeline** | adapt | Under `#menuTable` (left) or after `#myWorlds` (right). Data from core flights (no event-list XHR). Slots from fleetTable/galaxy `#slotValue` when fresh, otherwise `GZCalc.fleetSlots`. Mission icons: the game's event classes (`ownharvest`…) or our own SVG; skip OgameX `/img/fleet/*.gif`. Row click -> `page=fleetTable`. No synthetic return rows: GALAXYZ events already have both legs | 1 d | no |

### 5.2 Infinity

| Module | Verdict | What changes | Effort | Blocked |
|---|---|---|---|---|
| **panel** | adapt | Menu entry via core. Header: name `#playerName`, rank `#bar a[href*=statistics]` `range`, DM `#current_darkmatter[data-real]`, **no class** (caps), attack indicator from core flights (no `#attack_alert`). Planets tab from state, row click `?cp=` through `page.url` | 1 d | no |
| **empire** | adapt (gets simpler) | Data source = `parse.empire` (imperium, all bodies in one fetch, no `cp`). "Обновить всё" = one request. Sub-views: buildings are one list here (split into resources/stations by catalog type). Research is player-wide from imperium. Ships/defence from imperium; missiles 502/503 only from the defence page. Production check with `GZCalc.production` vs ticker; % per body only from visited `page=resources`. Store by body id, not column (column order differs from the selector) | 2 d | P1 moon column |
| **targets** | rework | Galaxy: `galaxy:render` once per page load, row slot in `tr.row`. The mark key `g:s:p:1|3` is unchanged. Player id only from foreign-row links (`Dialog.Playercard`, `doit`), so key players by id when known and otherwise by name. Highscore dots on `page=statistics` rows (`Dialog.Playercard(ID,'name')`). Search tab -> `page=search&mode=result&ajax=1` HTML. Player card -> `page=playerCard&id=` popup HTML. Spy action -> `fleetAjax` with the **planet DB id** (from the galaxy cache; disabled when unknown). Attack -> native prefill URL. Loot always 50 % | 3 d | P2, P10 |
| **spy** | rework | Collection: spy reports sit in `messcat=0` (spy) fragments with the full body, so **no detail fetch**. Parser: `GZMessages.parseSpyReport` — `spyRaportContainerHeadClass*` sections (only own cells: sections nest), ids **by position** from the Simulate link `im[ID]=` (exact floats), names -> ids via catalog only when the link is missing; a missing section = not revealed. Fields that no longer exist: player name, activity, class, debris, counter-espionage % (only "discovery chance"). Derived: loot 50 %, cargo needed (`GZCalc.cargo`), value, distance/time/fuel from `GZCalc`. Actions: Рейд -> `fleet.send` (3 steps), Подготовить -> native prefill (`target_mission=1`), Шпионить -> `fleetAjax` (needs the planet id; else prefill with mission 6), Симулятор -> the server's own `page=battleSimulator&im[...]` link (**drop** TrashSim), Удалить -> deletemarked POST. "Загрузить все отчёты" keeps its warning (listing marks read) | 3 d | P2, P4 |
| **stats** | rework | Categories: 3 combat, 4 return, 5 transport/recycle, 15 expedition. Combat summary: `.raportMessage` `raportWin/Lose/Draw` (relative to the reader), full report only via `page=raport` (text tables, names only, no `combatData`). Expedition amounts **only in the return message** (cat 4), so stats has to pair result and return by fleet/time. Recycle: M+C only, no field size. Parsers are UPSTREAM-only until P8/P9. The daily chart and UI stay | 3 d | P8, P9 |
| **stalk** | rework, reduced | Activity is text after the name, one value for planet+moon (`(*)` <15 min, `(N min)`), and our own espionage/attack arrival also sets it (keep the `self` filter, sourced from core flights and `fleetAjax` relays). **Auto-scan off and hidden by default** (deuterium per system). Manual scan shows the cost and keeps a daily budget. Passive intake from every galaxy page the user opens stays. "Espionage detected" message wording: UPSTREAM only | 2 d | P2, P7 |
| **flights** | adapt | SVG timeline works on core flights (both legs present, no synthetic rows). Lanes from state body order. The `/fleet/movement` mini chart moves to `page=fleetTable` (own list, return countdown). «Отозвать» -> `POST page=fleetTable&action=sendfleetback fleetID` (id only while recallable; GALAXYZ fleet id from the event key). Title alert unchanged. Foreign fleets appear only outward | 1.5 d | P5 |
| **fleethelp** | rework | Keep rules unchanged (state). fleetTable buttons «Всё, кроме резерва» / «Транспорт для ресурсов» fill `input[name=ship<ID>]` (`#ship<ID>_input`) and fire the game's change handlers. Step 2 «Все ресурсы, кроме резерва» fills `metal/crystal/deuterium` (capacity = `data.fleetroom` - `data.consumption`; GALAXYZ holding costs no extra fuel). «Сбор» tab: `fleet.estimate` (GZCalc), prefill = native URL + stored ships, applied on fleetTable. The walk keeps working. Direct send (`allowDirectSend`) = core 3-step send with `cp`, never automatic | 2.5 d | no (needs one live send test) |
| **todo** | adapt | «+» on GALAXYZ list items (buildings one page; defence = `shipyard&mode=defense`). «Построить» -> form POST (`cmd=insert&building|tech`, `fmenge[id]=n`) with `cp` inside `withPlanet`, then re-parse the returned page to confirm (no server message). Times from `GZCalc.buildTime` need `game_speed` (unknown, so times show "≈" with a settable override until P7). Research blocked while 6/31 build (server rule) -> show the hint. Queue limits 5/2/10 upstream. No halving | 2 d | P3 (running queue), P7 |
| **prefs** | as-is + small fixes | Hotkey page jumps via the `page.url` name map. Prev/next body from `#planetSelector` order (moons included) with `cp` (the same sticky behaviour as the game's own selector). Planet↔moon toggle via the selector (coords match). Fleet select-all/reset: fleetTable has no `#sendall` (use the game's "all ships" link if present, else our own fill). Arrow keys on galaxy: the game binds `keydown` (galaxy §1), so keep them unhandled there. Export/import unchanged (namespace host now includes the universe) | 0.5 d | no |

**Modules total ≈ 30 d** (Live 10 d, Infinity 20.5 d).

### 5.3 Features dropped or replaced on GALAXYZ (hidden through caps, not deleted)

* Player-class logic everywhere (loot 75 %, class speed/cargo, Discoverer expedition bonus, explorer research ×0.75).
* Crawler and plasma lines (planetbar, empire), lifeforms.
* OgameX expedition max-find table (top-1 points), replaced by the fleet-cost rule.
* TrashSim prefill, replaced by the server simulator link from the spy report.
* Per-message detail fetch (spy/stats), replaced by list bodies plus `page=raport` for combat.
* DM halving cost (todo).
* `check-target` ship-stat capture, replaced by calc from `elements.json` + research, cross-checked with `fleetStep1` `data.ships`.

### 5.4 Bot (future section)

The bot API needs the same core actions: `fleet.send` (3 steps), `api.addBuild` (form POST), `fleetAjax`, `messages.delete`. The sticky `cp`
and the deuterium-priced galaxy make the "farming with auto-espionage" loop expensive. Plan bot features on `caps` from day one, and run
every bot write inside `withPlanet` under the existing `cp` lock.

---

## 6. Real pages still needed (and what each confirms)

Saved already (20): overview, buildings, research, shipyard fleet/defense, resources, techtree, imperium, officier, trader, fleetDealer,
fleetTable, fleetStep1/2/3 (a colony send), galaxy (own system only), messages (spy + all), tournament, transport (info page).

Save with Chrome "Save page as -> complete". Where noted, also save a **network capture (HAR)**, because several answers are XHR bodies,
not pages. Priority = how many modules wait on it.

| # | What to save | Confirms | Unblocks | Prio |
|---|---|---|---|---|
| P1 | An account/body **with a moon**: overview with the moon active, any page with the planet active, imperium, `page=resources` on the moon | `#planetSelector` moon text `(Moon)`, planet-list moon entry (`a.moonlink`?), `#planetImage` `s_mond`, imperium moon column, moon buildings list | planetbar, empire, prefs, state body model | high |
| P2 | **Foreign galaxy systems**: one with an inactive (i/I), vacation, an alliance member, a moon, a debris field, a destroyed planet; ideally noob/strong flags | foreign row markup (moon/debris/ally/action cells), tooltip slot order, whether `doit(6,ID)` / `Dialog.Playercard(ID)` carry ids, `#colonized` meaning, activity for planet vs moon | targets, spy, stalk, core galaxy | high |
| P3 | **Running queues**: overview + buildings + research + shipyard while something builds (2+ items queued), plus a HAR when opening one item's details (`TechnologyDetailsAjax`, `ResearchDetailsAjax`, `ShipDetailsAjax`) | queue box markup and countdown source, cancel/remove forms, details JSON/HTML (cost, time, max amount field), whether the cancel commands still work | techcost overlay, todo, state queues, planetbar build timer | high |
| P4 | HAR of a **one-click spy** from the galaxy page and the saved live `galaxy.js` | `fleetAjax` URL/method, token or not, JSON codes, the `doit` implementation (`#slotValue` update) | spy, targets, stalk self-activity | high |
| P5 | Overview while **under attack / being spied**, and with an own **ACS**, **hold** and **expedition** fleet in the air (fleetTable too) | foreign event classes (no `own`), `Dialog.PM` owner link, `holding` status, how expeditions show (`owntransport` to pos 16?), foreign ship detail vs espionage tech, ACS rows | inflight, flights, timeline, panel attack alert | high |
| P6 | **fleetStep2 for attack, hold and expedition** (and step 1 from a spy-report "Attack" link), plus one step-2/3 **error** page (no slots, no deuterium) and a `fleetTable&code=N` redirect | `staytime` select (name/values), mission radios and pre-checked `target_mission`, error markup, Asteroids mission | fleetinfo, expedition, fleethelp, core fleet.send error handling | high |
| P7 | `game.php?page=Serverinfo` (footer "Game information") | `game_speed`, deuterium per galaxy view, debris %, moon chance, noob protection, universe size, queue limits | calc times (todo), stalk/targets scan cost, empire, catalog bounds | high |
| P8 | **Combat**: a combat message in cat 3 (won and lost) + its `page=raport` popup; one expedition battle | `.raportMessage` markup, result class, raport layout, ship names vs short names, unit stats/engine (mechanics Q4) | stats, spy (loot/debris check), calc battle | medium |
| P9 | **Expedition** result (cat 15) + its return (cat 4); transport arrival own/foreign; recycle report; deploy; spy-detected message; a ru-language account sample if available | texts the classifier keys on, where amounts appear, recycle details, spy-detected wording | stats, expedition, stalk, `18-exptexts-data` | medium |
| P10 | `page=statistics` (players and alliances), a search result (`page=search&mode=result`), a `page=playerCard` popup | highscore rows with ids, search fragment shape, player-card fields | targets, stalk player index, storage player-id migration | medium |
| P11 | Spy report revealing **defence, buildings, research**, and one with **destroyed probes**; a spy report of a moon | section nesting, Simulate link ids for 4xx/1xx, `planettype=3` | spy | medium |
| P12 | Saved live `message.js` + HAR of a category click and a delete (`POST mode=action`) | whether the live `message.js` still swaps `#messagestable` and rewrites `#unread_N` like upstream (the cat-0 "inline render" was a click), `MESSAGES_PER_PAGE`, redirect target, soft/hard delete | core messages.watch/fetchList/delete | medium |
| P13 | Vacation-mode banner page; negative-energy page | `var vacation = 1` effects, ticker with negative production | state, planetbar warnings | low |
| P14 | A popup (`body.popup`) page, e.g. `page=notes` or a details iframe | boot must not crash; reduced mode | core boot | low |
| P15 | `page=transport` with Admiral 10 (if anyone has it), and the Asteroids UI | fork-only features | fleet (later) | low |
| P16 | `page=battleSimulator` (empty and prefilled from a spy report) | server simulator form/result for "simulate" button and calc cross-check | spy, bot | low |

Each saved page goes into `eu/pages/`. Re-run the area check scripts (`tools/check_*.js`) and update `fixtures/*-expected-parse.json`.
Any [UPSTREAM]/[GUESS] tag that a page confirms becomes [REAL] in the area spec.

---

## 7. Phases

| Phase | Content | Effort | Exit test |
|---|---|---|---|
| 0 | Engine seam, OgameX moved behind it, OgameX tests green | 3.5 d | existing OgameX fixture suite passes unchanged |
| 1 | GALAXYZ core read side: detect/identity/storage/time/route, layout snapshot, catalog/calc, imperium, list parsers, events/flights, http transport, tests | 17 d | all `layout-*`, `buildings-*`, `mechanics-*`, `fleet-real-*` fixtures parse to the expected JSON through `OGX.parse`/`OGX.state` |
| 2 | Passive modules: menu, planetbar, inflight, timeline, panel, empire, prefs, techcost badges | 8.5 d | manual run on the live server (user), journal export reviewed |
| 3 | Core write side (fleet send/prefill/recall, build POSTs; 4 d) + modules fleetinfo, fleethelp, todo, flights, techcost overlay | 13 d | one real colony/transport send and one build through the add-on, confirmed by re-parse |
| 4 | Core galaxy + messages (6 d) + modules targets, spy, stats, stalk, expedition (after P2, P4, P6, P8-P11) | 19 d | fixtures from the new real pages |

Phases 0-2 need no further real pages beyond P1 (moons) for full planetbar/empire coverage.

---

## 8. Risks

* **Sticky `cp`**: a bug that leaves the user on another planet is visible and annoying. Keep the lock, the restore with `keepalive` on
  pagehide, and a journal event per switch.
* **Deuterium cost of galaxy views** can drain a small account. Scans are off by default, need a budget, and stop on the error page.
* **Read-on-list for messages**: a background scan erases "unread". Opt-in only.
* **Token flow**: a step-1 token lives 600 s and is single-use. Never reuse it, and never start a second dispatch while one is pending in the same flow.
* **Fork drift**: GALAXYZ changed upstream markup in several places (galaxy, fleetTable, info pages). The `learn` self-learning selectors
  (`23-learn.js`) should get GALAXYZ baselines from the fixtures so drift raises L alerts early.
* ~~**Two message specs**~~: merged. `messages-recipes.js` (`GZMessages`) is canonical; `GZMessagesB` stays as a cross-check only.
