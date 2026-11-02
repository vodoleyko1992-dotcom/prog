# OgameX fleet: spec for content scripts

Scope: everything fleet-related that the two extensions read or call. That is the `/fleet` dispatch page, the dispatch AJAX endpoints (check-target, send-fleet, send-mini-fleet, recall), fleet templates, the `/fleet/movement` page, the event box, the event list and checkevents, the phalanx scan, and a short section on the jump gate.

Read `layout.md` first. It covers page detection, CSRF, `?cp=` and server time, and this document uses those without repeating them.

Paths are relative to the OgameX checkout `src/OGameX/`. Short names used below:

| Name | File |
|---|---|
| `FC` | `app/Http/Controllers/FleetController.php` |
| `FEC` | `app/Http/Controllers/FleetEventsController.php` |
| `FMS` | `app/Services/FleetMissionService.php` |
| `GM` | `app/GameMissions/Abstracts/GameMission.php` |
| `idx` | `resources/views/ingame/fleet/index.blade.php` |
| `mov` / `row` | `resources/views/ingame/fleet/movement.blade.php` / `.../fleet/partials/movement-row.blade.php` |
| `el` / `er` / `eru` | `resources/views/ingame/fleetevents/eventlist.blade.php` / `eventrow.blade.php` / `eventrow-union.blade.php` |
| `main` | `resources/views/ingame/layouts/main.blade.php` |
| `bundle` | `resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js` (served as `/build/assets/ingame-<hash>.js`) |

## 0. Fixtures

All fixtures are in `ogx/fixtures/`. `ogx/tools/blade/gen_fleet_fixtures.php` renders them from the real Blade templates. It uses the same mini Blade compiler as the layout fixtures, extended with `@switch`, `@for` and `$loop`, and the layout fixtures still come out byte-identical. The controller logic (`FC::movement`, `FEC::fetchEventList`, `FEC::fetchEventBox`, `PhalanxService::scanPlanetFleets`) is ported line by line, so the view models are exactly what OgameX builds. JSON bodies use `json_encode($data, 0)`, which is what Laravel's `response()->json()` uses. So `/` is escaped as `\/`, and floats with a zero fraction print as integers (for example `20`, not `20.0`).

**Sample state.** "Now" is `1793321837` (2026-10-30 00:57:17 UTC). The player is Commander Vega (id 108, Collector). Homeworld is id 1 [1:42:8], its Moon is id 5 [1:42:8], and Colony is id 3 [2:118:12]. Research: combustion 6, impulse 4, hyperspace drive 0, hyperspace tech 2, computer 5, astrophysics 4. Active `fleet_missions` rows:

| id | owner | mission | route | timing |
|---|---|---|---|---|
| 1199 | own | 8 Harvest **return** (parent 1190) | DF [1:42:9] → Homeworld, 4 recyclers carrying 31,200 M and 18,900 C | arrives now+913 |
| 1201 | own | 1 Attack | Homeworld → Farmville [1:45:6] (Raider42), 20 LF and 10 LC | now+2340 |
| 1202 | own | 15 Expedition, 1 h hold | Homeworld → [1:42:16], 10 LC, 1 probe, 1 pathfinder | arrived now−1000, **in hold** until now+2600 |
| 1203 | own | 3 Transport | Colony → Homeworld, 5 LC carrying 50k M, 30k C and 10k D | now+8219 |
| 1210 | Raider42 | 6 Espionage (**hostile**) | Darkstar [1:40:11] → Homeworld, 3 probes | now+420 |
| 1211 | Nova | 3 Transport (**neutral**) | Haven [2:120:5] → Colony, 2 LC carrying 20k M and 10k C | now+3100 |

| Fixture | What it is |
|---|---|
| `fleet-dispatch-planet.html` | Full `/fleet?cp=1` page with ships on the planet. |
| `fleet-dispatch-prefill.html` | `/fleet?galaxy=1&system=45&position=6&type=1&mission=1`, which shows the prefilled `targetPlanet` and `mission` vars. |
| `fleet-dispatch-noships.html` | `/fleet?cp=5` on the moon with no ships, which renders `#warning` instead of the ship list. |
| `fleet-movement.html` | Full `/fleet/movement?cp=1` page with all 6 missions. |
| `fleet-eventlist.html` | Exact body of `GET /ajax/fleet/eventlist/fetch` (an HTML fragment). |
| `fleet-eventbox.json`, `fleet-eventbox-empty.json` | `GET /ajax/fleet/eventbox/fetch`. |
| `fleet-checkevents.json` | `POST /ajax/fleet/eventlist/checkevents` with `ids[]=1210&ids[]=890090`. It is served as `text/plain`. |
| `fleet-check-target-player.json` | check-target against a foreign planet with `am204=20&am203=10`. |
| `fleet-check-target-expedition.json` | check-target against [1:42:16]. |
| `fleet-check-target-empty-slot.json` | check-target against an empty colonisable slot (`status: failure`). |
| `fleet-check-target-invalid.json` | check-target with an out-of-range galaxy (failure, **no `shipsData`**). |
| `fleet-send-fleet-success.json`, `-error.json`, `-validation-error.json` | send-fleet responses. |
| `fleet-send-mini-fleet-success.json`, `-error.json` | send-mini-fleet responses. |
| `fleet-recall-success.json`, `fleet-recall-failure.json` | recall-fleet responses. The failure comes with HTTP 500. |
| `fleet-templates.json`, `fleet-template-save.json`, `fleet-template-delete.json` | Fleet template endpoints. |
| `fleet-phalanx-scan.json`, `fleet-phalanx-scan-error.json` | `POST /ajax/phalanx/scan` from the moon against Farmville. |
| `fleet-jumpgate-execute.json` | `POST /ajax/jumpgate/execute` success. |
| `fleet-expected-parse.json` | View-model values (row ids, arrivals, statuses, timers) that the recipes in section 12 must reproduce. |

`node ogx/tools/check_fleet.js` runs the section 12 recipes in Chromium (Playwright) against the fixtures and compares the results with `fleet-expected-parse.json`. It currently passes.

---

## 1. Endpoint map (`routes/web.php:120-157`)

All of these sit in the `auth, banned, globalgame, locale, firstlogin` middleware group (web.php:67). POST requests need CSRF: send `_token=<meta csrf-token>` or the header `X-CSRF-TOKEN` (layout.md section 7). `?cp=<planetId>` in the **query string** of any of these URLs switches and persists the current planet first (layout.md section 5). That is how to dispatch from a planet that is not current.

| Method | URL | Route name | Controller | Returns |
|---|---|---|---|---|
| GET | `/fleet` | fleet.index | FC::index (47-120) | full page |
| GET | `/fleet/movement` | fleet.movement | FC::movement (130-287) | full page, or a **302 to `/fleet`** when there are no missions (FC:136-138) |
| POST | `/ajax/fleet/dispatch/check-target` | fleet.dispatch.checktarget | FC::dispatchCheckTarget (299-460) | JSON |
| POST | `/ajax/fleet/dispatch/send-fleet` | fleet.dispatch.sendfleet | FC::dispatchSendFleet (472-645) | JSON |
| POST | `/ajax/fleet/dispatch/send-mini-fleet` | fleet.dispatch.sendminifleet | FC::dispatchSendMiniFleet (656-797) | JSON |
| POST | `/ajax/fleet/dispatch/recall-fleet` | fleet.dispatch.recallfleet | FC::dispatchRecallFleet (806-848) | JSON (HTTP 500 on failure) |
| POST | `/ajax/fleet/tactical-retreat` | fleet.tacticalretreat | FC::updateTacticalRetreat (1429-1456) | JSON |
| POST | `/ajax/fleet/union/create` | fleet.union.create | FC::createUnion (857-943) | JSON sent as `text/plain` |
| POST | `/ajax/fleet/union/join` | fleet.union.join | FC::joinUnion (1052-1095) | JSON |
| GET | `/ajax/fleet/union/available?galaxy&system&position&planet_type` | fleet.union.available | FC::getAvailableUnions (1102-1149) | JSON |
| GET | `/overlay/fleet/federation?fleet=<id>[&union=<id>]` | fleet.federation.overlay | FC::federationOverlay (1158) | HTML overlay |
| GET | `/ajax/fleet/templates` | fleet.templates.index | FC::getTemplates (1298-1313) | JSON |
| POST | `/ajax/fleet/templates` | fleet.templates.store | FC::saveTemplate (1321-1396) | JSON |
| DELETE | `/ajax/fleet/templates/{id}` | fleet.templates.delete | FC::deleteTemplate (1405-1424) | JSON |
| GET | `/ajax/fleet/eventbox/fetch` | fleet.eventbox.fetch | FEC::fetchEventBox (29-124) | JSON |
| GET | `/ajax/fleet/eventlist/fetch` | fleet.eventlist.fetch | FEC::fetchEventList (202-575) | HTML fragment |
| POST | `/ajax/fleet/eventlist/checkevents` | fleet.eventlist.checkevents | FEC::checkEvents (142-192) | JSON sent as `text/plain` |
| POST | `/ajax/phalanx/scan` | phalanx.scan | PhalanxController::scan (27-169) | JSON |
| GET | `/ajax/jumpgate` | jumpgate.index | JumpGateController::index (27-85) | HTML overlay |
| POST | `/ajax/jumpgate/execute` | jumpgate.execute | JumpGateController::executeJump (95-199) | JSON |
| POST | `/ajax/jumpgate/set-default-target` | jumpgate.setdefaulttarget | JumpGateController::setDefaultTarget (209-257) | JSON |

The layout exposes some of these URLs as JS globals. They are absolute, so use them instead of hard-coding the origin: `ajaxEventboxURI` (main:916), `ajaxRecallFleetURI` (main:917), `eventlistLink` (main:1446) and `miniFleetLink` (main:881). The `/fleet` page also defines `checkTargetUrl` and `sendFleetUrl` (idx:21-22).

**Differences from official OGame.** OgameX uses clean paths instead of `index.php?page=ingame&component=fleetdispatch&action=checkTarget&ajax=1&asJson=1`. Dispatch is one endpoint, there is no `fleet3`, and the event list is `/ajax/fleet/eventlist/fetch`, not `page=componentOnly&component=eventList`. Official OGame sends `token` with each dispatch and rotates it. OgameX accepts the Laravel session token, and `newAjaxToken` is either the same token or a constant. check-target always returns the junk constant `91cf2833548771ba423894d1f3dddb3c` (FC:457). **Do not feed that back as CSRF.** The bundle's FleetDispatcher writes it into the global `token` (bundle:33749), and the next POST still works only because the layout sets the `X-CSRF-TOKEN` header for every jQuery AJAX call (main:1700-1704).

---

## 2. `/fleet` dispatch page

### 2.1 Structure

There is a single page with two steps that the bundle's `FleetDispatcher` switches by showing or hiding them. There is no fleet3 and nothing is reloaded between steps.

```
#middle > #eventlistcomponent > #eventboxContent               (layout, main:782-784)
#middle > #eventlistcomponent > #eventboxContent               (DUPLICATE id, idx:16; use the first one)
#middle > #eventlistcomponent > #fleetdispatchcomponent.maincontent   (idx:19)
    <script> inline vars </script>                             (idx:20-481)
    #fleet1                                                    (idx:483-980)  step 1: ships
        #inhalt > #zeuch666 (hidden fleet-template editor, idx:485-788)
                > #planet.planet-header h2 "Fleet Dispatch I - <planet>"
                > .fleetStatus #slots …                        (slot counters)
                > .fleetStatus (tactical retreat)
                > #warning (no ships)  OR  #statusBarFleet + #buttonz (ship list)
    #fleet2[style=display:none]                                (idx:981-1460) step 2: target, mission, cargo, speed
        #buttonz.sortable > #fleetboxdestination, #fleetboxmission, #fleetboxbriefingandresources
```

`body#ingamepage` is used on all fleet pages, so detect the page by path (`/fleet`) or by `#fleetdispatchcomponent`. See layout.md section 1.

### 2.2 URL prefill (FC:104-108, idx:233-260)

`GET /fleet?galaxy=G&system=S&position=P&type=T&mission=M` sets the inline vars `targetPlanet` and `mission`. Official OGame also accepts `am202=…` style ship amounts in the URL. **OgameX does not**, and it also does not jump to step 2 by itself. `targetPlanet.name` stays the *current* planet's name even after prefill (idx:238 uses `$targetPlanetName`, which is never passed). To preselect ships, call `fleetDispatcher.selectShips({203: 10})` from page context, or skip the UI entirely and POST to send-fleet (section 4).

### 2.3 Inline JS variables (idx:20-481), readable without game JS

| Var | Example (fixture) | Meaning, notes | idx line |
|---|---|---|---|
| `checkTargetUrl`, `sendFleetUrl` | `"http://localhost/ajax/fleet/dispatch/check-target"` | absolute URLs | 21-22 |
| `shipsData` | `{"204":{"id":204,"name":"Light Fighter","baseFuelCapacity":50,"baseCargoCapacity":50,"fuelConsumption":7,"speed":31250},…}` | **Hard-coded and wrong** (marked TODO). The values are neither base nor research-adjusted, for example LF speed 31250 and fuel 7, and 212 is missing. The real per-player values arrive in check-target `shipsData` (section 3). Do not use this. | 32-161 |
| `MAX_GALAXY`, `MAX_SYSTEM`, `MAX_POSITION` | `9`, `499`, `16` | universe bounds | 169-171 |
| `SPEEDFAKTOR_FLEET_PEACEFUL / _WAR / _HOLDING` | `1`, `1`, `1` | per-mission-class fleet speed (settings `fleet_speed_peaceful/war/holding`) | 172-174 |
| `PLANETTYPE_PLANET/DEBRIS/MOON` | `1`, `2`, `3` | target types | 175-177 |
| `missions` | `{"MISSION_ATTACK":1,…,"MISSION_EXPEDITION":15}` | mission ids | 187-200 |
| `orderNames` | `{"15":"Expedition",…}` | localized names | 201-212 |
| `currentPlanet` | `{"galaxy":1,"system":42,"position":8,"type":1,"name":"Homeworld"}` | origin. `type` is 1 or 3. | 226-232 |
| `targetPlanet` | the same as `currentPlanet` unless prefilled | | 233-239 |
| `shipsOnPlanet` | `[{"id":204,"number":40},…]` (only amounts > 0, in screen order) | **The best source for ships on the current body.** It is not valid JSON (whitespace, trailing comma), so use a regex (12.4). | 244-247 |
| `planets` | only the current planet | upstream bug, not a planet list | 250-256 |
| `mission` | `0` or the prefilled value | | 260 |
| `metalOnPlanet`, `crystalOnPlanet`, `deuteriumOnPlanet` | `152347` (floored) | resources at render time | 270-272 |
| `fleetCount` / `maxFleetCount` | `4` / `6` | fleet slots used / max | 275-276 |
| `expeditionCount` / `maxExpeditionCount` | **always `0` / `1`** | hard-coded; read the DOM instead (2.4) | 277-278 |
| `playerId` | `108` | | 282 |
| `hasAdmiral`, `hasCommander` | `false` | hard-coded | 283-284 |
| `planetCount` | `2` | number of planets (moons excluded) | 288 |
| `apiDataJson`, `apiTechData`, `apiShipBaseData`, … | | **hard-coded sample data**, ignore | 424-480 |
| `fleetDispatcher` | `FleetDispatcher` instance (page context only) | created on DOM ready from `window` (idx:419-422) | 412 |

### 2.4 DOM selectors (step 1, `#fleet1`)

| What | Selector | Notes / source |
|---|---|---|
| Slot counters | `#fleet1 #slots > .fleft:nth-child(1) > span.advice` → text `"Fleets: 4/6"`; `#fleet1 #slots > .fleft:nth-child(2) > span.advice` → `"Expeditions: 1/2"` | Regex `/(\d+)\s*\/\s*(\d+)/`. `.overmark` means full. The id `#slots` appears **twice** (idx:797, 822), so scope to the first `.fleetStatus`. idx:797-810 |
| Ship item | `#fleet1 #technologies li.technology[data-technology]` | `data-technology` is the ship id. `data-status` is `on` or `off` (amount 0). The class contains `class_name` (`fighterLight`, `transporterLarge`, `explorer` for the Pathfinder, …). idx:891-906, 915-933 |
| Amount on planet | `li[data-technology] span.amount[data-value]` | integer. The visible text is `formatNumberShort` for military ships and raw for civil ships. idx:898-902, 926-928 |
| Amount input | `li[data-technology="203"] input[type=text]` | **`name` = class_name** (for example `transporterLarge`), and there is no `id`. It is `disabled` when the amount is 0. The game reacts to `keyup`/`focusout` (bundle:32690-32704), so after setting `.value` dispatch `keyup` and `focusout`. Better: call `fleetDispatcher.selectShip(id, n); fleetDispatcher.refresh()` from page context. |
| Military / civil lists | `#military`, `#civil` | Military is LF, HF, cruiser, BS, BC, bomber, destroyer, RIP, reaper, pathfinder. Civil is SC, LC, colony ship, recycler, probe (FC:52-55). **Solar satellites and crawlers are not listed.** |
| Select all / none | `#sendall`, `#resetall` | idx:944, 949 |
| Continue | `a#continueToFleet2.continue.on/.off` | idx:967 |
| Standard fleet (template) select | `select#standardfleet` (options filled by AJAX from `/ajax/fleet/templates`) | idx:961, bundle:41054 |
| No ships | `#fleet1 #warning` exists | idx:861-868 |
| Tactical retreat | `form[name=tacticalRetreat] input[name=tacticalRetreat]:checked` (0, 5 or 3) | idx:826-847 |

### 2.5 DOM selectors (step 2, `#fleet2`)

| What | Selector | Notes |
|---|---|---|
| Target inputs | `#fleet2 #galaxy`, `#system`, `#position` | The markup holds the junk default `7/158/10` (idx:1075-1088). JS overwrites it with `targetPlanet` on each refresh (bundle:33325-33328). |
| Target type | `#pbutton`, `#mbutton`, `#dbutton` (class `planet_selected`, `moon_selected` or `debris_selected` when active), plus hidden `input#type` | idx:1059-1066, bundle:33306-33323 |
| Shortcut list | `select#slbox option[value="g#s#p#type#name"]` | all own planets and moons except the current one (idx:1095-1107). **It is a good way to get every own body with its type.** |
| ACS unions | `select#aksbox option[value="g#s#p#type#name#unionId"]` | idx:1116-1124 |
| Mission buttons | `#missions li#button<N>` (class `on`/`off`/`selected`), `a#missionButton<N>[data-mission=N]` | N is 15, 7, 8, 3, 4, 6, 5, 1, 2 or 9 (idx:1152-1213) |
| Briefing | `#fleet2 #duration` (`"1:12:20 h"`), `#arrivalTime`, `#returnTime` (`"30.10.26 01:36:17"`), `#consumption` (`<span class=undermark>212 (1%)</span>`), `#storage` (free cargo), `#maxspeed` | idx:1277-1319 |
| Holding / expedition time | `select#holdingtime` (0, 1, 2, 4, 8, 16, 32), `select#expeditiontime` (1 to astrophysics level) | idx:1297-1314 |
| Cargo inputs | `input#metal`, `#crystal`, `#deuterium` (class `checkThousandSeparator`), max/min links `#selectMaxMetal` etc., all resources `#allresources` | The initial value is the raw float `planet->metal()->get()`, for example `152347.29861111` (idx:1333). JS resets it to 0. |
| Cargo bar | `#loadRoom .bar_container[data-capacity][data-current-amount]`, `#remainingresources`, `#maxresources` | idx:1409-1420 |
| Speed | `#speedPercentage.percentageBar[value][steps][stepsize][minvalue]`. `stepsize` is 10, or 5 for the General class. | idx:1426-1428 |
| Send | `a#sendFleet.start.on/.off` | idx:1443 |

### 2.6 FleetDispatcher (page context, bundle:32421-34383)

`window.fleetDispatcher` is the live state. Content scripts in an isolated world cannot see it, so inject a `<script>` to use it. The useful fields are `shipsToSend` (`[{id, number}]`), `targetPlanet`, `mission`, `speedPercent` (1-10, where 10 = 100%), `cargoMetal/Crystal/Deuterium`, `expeditionTime`, `holdingTime`, `union`, `orders` (from check-target) and `fleetHelper.shipsData` (replaced by check-target `shipsData`, bundle:33711).

The useful methods are `selectShip(id, n)` (32878), `selectShips({id: n})` (32992), `selectAllShips()`, `switchToPage('fleet2')` (32577), `updateTarget()` (33469, which debounces a check-target after 500 ms), `setTargetType(1|2|3)` (33527), `selectMission(m)` (34300), `selectMaxAll()` (34243), `setFleetPercent(1..10)` (33552), `refresh()`, `trySubmitFleet2()` (33266) and `submitFleet2()` (33811).

### 2.7 How the page computes distance, duration and consumption (bundle:34432-34528)

```
distance (FleetHelper.calcDistance, 34432):
  galaxy differs : 20000 * min(|dg|, |dg - MAX_GALAXY|)                (always "donut" galaxy, DONUT_GALAXY=1)
  system differs : 2700 + 95 * max(min(|ds|, |ds - MAX_SYSTEM|) - emptySystems - inactiveSystems, 1)
  position differs: 1000 + 5 * |dp|
  same coords    : 5
duration (calcDuration, 34471) [s]:
  max(round((35000 / speedPercent * sqrt(distance * 10 / maxSpeed) + 10) / speedFactor(mission)), 1)
  speedPercent is 1..10 (10 = 100 %), maxSpeed = slowest shipsData[id].speed of the selected ships
  speedFactor: peaceful {3,4,7,15} → SPEEDFAKTOR_FLEET_PEACEFUL; war {1,2,6,8,9,10} → _WAR; hold {5} → _HOLDING; none → 0 (→ Infinity)
consumption (calcConsumption, 34476):
  speedValue = max(0.5, duration * speedFactor - 10)
  per ship type: shipSpeedValue = 35000 / speedValue * sqrt(distance * 10 / ship.speed)
                 c += max(ship.fuelConsumption * n * distance / 35000 * (shipSpeedValue / 10 + 1)^2, 1)
  total = round(sum c) + (holdingHours > 0 ? max(floor(sum(fuelConsumption * n * holdingHours) / 10), 1) : 0)
cargo = floor(sum(baseCargoCapacity * n)), fuel capacity = sum(baseFuelCapacity * n)
arrival = serverTime + duration;  return = serverTime + 2 * duration + holdingHours * 3600
```

`emptySystems` and `inactiveSystems` come from check-target (the settings `ignore_empty_systems_on` and `ignore_inactive_systems_on`). They are 0 until the first check-target.

**Server-side differences**, which are what actually gets charged (FMS:55-223):

- Duration uses the per-mission speed factor (war, holding or peaceful), as the JS does (FMS:66-82). The empty and inactive systems are recomputed server-side (FMS:142-145).
- **Consumption uses the generic `settings.fleet_speed`, not the mission factor.** It calls `calculateFleetMissionDuration($…, null, …)` (FMS:189), and `speedValue = duration * fleetSpeed() - 10` (FMS:190). It uses the **raw** `fuel` property (FMS:201-205), and then multiplies the total by 0.5 for the General class (FMS:216-220). The JS uses `fuelConsumption` from check-target, which already includes the class multiplier (FC:303-315). On servers where `fleet_speed_war/peaceful` differ from `fleet_speed`, the JS consumption can differ from what is deducted.
- Hold costs: holdingHours × fuel / 10 (FMS:212-214).
- Ship speed, cargo and fuel capacity with research and class bonuses come from `app/GameObjects/Services/Properties/*` (see 3.3).

**Differences from official OGame.** There is no lifeform/food, and `FLEET_DEUTERIUM_SAVE_FACTOR` is unused. Official OGame's `shipsData` lives inline on fleetdispatch with correct values. In OgameX it is only correct after a check-target call.

---

## 3. `POST /ajax/fleet/dispatch/check-target` (FC:299-460)

### 3.1 Request (form-encoded, built by `fetchTargetPlayerData`, bundle:33683-33704)

| Param | Example | Notes |
|---|---|---|
| `galaxy`, `system`, `position`, `type` | `1`, `45`, `6`, `1` | `type`: 1 planet, 2 debris, 3 moon. **`type=4` is not used by the UI.** The JS skips the call if any of them is falsy. |
| `am<shipId>` | `am204=20&am203=10` | Every key starting with `am` is parsed as a ship id (FC:1220-1233). **An unknown id throws, which gives an HTTP 500.** |
| `union` | `0` | ACS union id. Mission 2 is enabled only when the union matches the target and the fleet can make it in time at 100% (FC:386-407). |
| `token` | | ignored by the controller. CSRF comes from the `X-CSRF-TOKEN` header or `_token`. |
| `cs=1`, `recycler=1` | | sent by the JS, ignored by the server |

### 3.2 Response, success (`fleet-check-target-player.json`)

```json
{"shipsData":{"204":{"id":204,"name":"Light Fighter","baseFuelCapacity":55,"baseCargoCapacity":55,"fuelConsumption":20,"speed":20000}, … 17 ships …},
 "status":"success","errors":[],"additionalFlightSpeedinfo":"",
 "targetInhabited":true,"targetIsStrong":false,"targetIsOutlaw":false,"targetIsBuddyOrAllyMember":true,
 "targetPlayerId":233,"targetPlayerName":"Raider42","targetPlayerColorClass":"active","targetPlayerRankIcon":"",
 "playerIsOutlaw":false,
 "targetPlanet":{"galaxy":1,"system":45,"position":6,"type":1,"name":"Farmville"},
 "emptySystems":0,"inactiveSystems":1,"bashingSystemLimitReached":false,"targetOk":true,"components":[],
 "newAjaxToken":"91cf2833548771ba423894d1f3dddb3c",
 "orders":{"1":true,"2":false,"3":true,"4":false,"5":false,"6":false,"7":false,"8":false,"9":false,"15":false}}
```

| Path | Meaning |
|---|---|
| `shipsData[id]` | **Per-player effective values.** `speed` includes drive research and class bonuses (Collector +100% for SC/LC, General +100% for combat ships and recyclers). `baseCargoCapacity` and `baseFuelCapacity` include +5% per hyperspace tech level and class cargo bonuses. `fuelConsumption` includes the class multiplier (General 0.5). The keys are in `getShipObjects()` order: 204, 205, 206, 207, 215, 211, 213, 214, 218, 202, 203, 208, 209, 210, 212, 217, 219. |
| `status` | `success`, or `failure` only when there are errors **and** no possible mission (FC:419-424) |
| `errors[]` | `{message, error}`. On success it is either empty or holds `{"message":"Colony ships must be sent to colonise this planet!","error":0}` for an empty slot at positions 1-15 (FC:377-381). Individual mission "not possible" reasons are **not** reported. |
| `targetInhabited` | false for an empty slot or position 16 |
| `targetPlayerId` / `targetPlayerName` | `99999` / `"Deep space"` for an empty slot, debris or position 16, and also for destroyed planets (FC:340-361) |
| `targetPlanet.name` | `"Deep space"` when empty. `type` echoes the request. |
| `orders` | **Which missions are allowed for this ship set and target.** The keys are always 1-9 and 15. |
| `targetIsStrong`, `targetIsOutlaw`, `bashingSystemLimitReached`, `targetPlayerColorClass`, `targetIsBuddyOrAllyMember`, `newAjaxToken` | **Constants.** OgameX has no noob/strong protection signal here. |

### 3.3 Effective ship values (useful without calling check-target)

These are the property services in `app/GameObjects/Services/Properties/`. The base values come from `objects.jsonl` (props: structural, shield, attack, speed, capacity, fuel, fuel_capacity).

- **Speed** (`SpeedPropertyService`). The base speed is replaced by `speed_upgrade` when the drive level threshold is met: SC uses impulse 5 → 10000, recycler uses impulse 17 → 4000 and hyperspace 15 → 6000, bomber uses hyperspace 8 → 5000, and reaper (hyperspace 4) and pathfinder (impulse 3, hyperspace 3) change only the drive. The drive bonus is 10%/20%/30% per level of combustion/impulse/hyperspace drive. It takes the last matching upgrade, or otherwise the last drive in the requirements. Class bonuses are added on the base value.
- **Cargo and fuel capacity**: `base + intdiv(base * 5 * hyperspaceTech, 100)`. Collector adds +25% cargo for SC and LC, and General adds +20% for recycler and pathfinder (cargo only).
- **Fuel**: the raw value. There is no research bonus (`FuelPropertyService` is a TODO).

### 3.4 Failure responses

- Coordinates out of range (`fleet-check-target-invalid.json`): `{"status":"failure","errors":[{"message":"Invalid galaxy coordinate. Must be between 1 and 9.","error":140020}]}`. **There is no `shipsData` and no `orders`.** The game JS then sets `fleetHelper.shipsData = undefined` (bundle:33711). The messages come from FC:1244-1268 (position range 1-16).
- Empty slot without a colony ship (`fleet-check-target-empty-slot.json`): the full body with `status: "failure"`, all `orders` false, and the colony error.

---

## 4. `POST /ajax/fleet/dispatch/send-fleet` (FC:472-645)

### 4.1 Request (`submitFleet2`, bundle:33811-33827)

| Param | Required | Notes |
|---|---|---|
| `am<shipId>` | yes | one per ship type, count > 0 |
| `galaxy`, `system`, `position`, `type` | yes | `type` 1, 2 or 3. For expeditions the UI sends `type=1` (bundle:33477-33479), and the server stores `type_to=4` (DeepSpace) (GM:335-349). |
| `mission` | yes | 1, 2, 3, 4, 5, 6, 7, 8, 9 or 15 |
| `speed` | yes | **1 to 10 in 0.5 steps** (10 = 100%). General may also use 0.5. Anything else returns the validation error "Fleet speed must be between 10% and 100% in 5% increments." (FC:529-538). The comparison is `in_array(float, …, true)`, so `"10"` works because the value is cast to float. |
| `metal`, `crystal`, `deuterium` | no (0) | cargo. A negative value is an error. |
| `holdingtime` | for 5 and 15 | hours. For an expedition it must be 1 to the astrophysics level, else "Expedition duration must be between 1 and N hours." (FC:554-562). For ACS Defend it is the hold hours. |
| `union` | no | union id to join (pre-checks for max fleets, max players and arrival delay, FC:571-602) |
| `retreatAfterDefenderRetreat` | no | 0 or 1 |
| `prioMetal`, `prioCrystal`, `prioDeuterium`, `lootFoodOnAttack`, `force`, `token` | | sent by the JS, **ignored** by the server (there are no loot priorities) |
| `_token` (or the `X-CSRF-TOKEN` header) | yes | CSRF |

### 4.2 Server checks, in order

1. Attack block: hostile missions are blocked while the admin attack block is active (FC:518-520).
2. Speed, coordinates, non-negative resources and holding time (FC:536-562).
3. Union pre-checks (FC:571-602).
4. `GM::start()`. It computes the consumption (4.3), then `startMissionSanityChecks` (GM:214-242). The checks are, in order: enough resources, which means **cargo + consumption deuterium** ("Not enough resources on the planet to send the fleet."); enough units ("Not enough units on the planet to send the fleet. Units required: light_fighter, large_cargo"); free fleet slots ("Maximum number of fleets reached."); and `isMissionPossible`, whose message or "This mission is not possible." is returned. After that: fuel capacity < consumption gives "You don't have sufficient storage capacity!", and cargo > capacity gives "Resources exceed fleet cargo capacity." (GM:289-298).

### 4.3 Responses

Success (`fleet-send-fleet-success.json`):

```json
{"success":true,"message":"Your fleet has been successfully sent.","components":[],"newAjaxToken":"<csrf>","redirectUrl":"http:\/\/localhost\/fleet"}
```

The response does not contain the new mission id or its times. To get them, re-fetch the event list or `/fleet/movement`.

Both the validation errors (FC:1277-1290) and the exceptions (FC:631-644) have this shape (`fleet-send-fleet-error.json`):

```json
{"success":false,"errors":[{"message":"Not enough units on the planet to send the fleet. Units required: light_fighter, large_cargo","error":140020}],"components":[],"newAjaxToken":"<csrf>"}
```

The HTTP status is 200 in both cases. An unknown `am<id>` or an invalid `type` (for example `PlanetType::from(0)`) throws outside the try block and gives an **HTTP 500** HTML page.

### 4.4 Recipe: one-click raid from a content script

```js
async function ogxSendFleet({ fromPlanetId, g, s, p, type = 1, mission = 1, ships, speed = 10, metal = 0, crystal = 0, deuterium = 0, holdingtime = 0 }) {
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const body = new URLSearchParams({ _token: csrf, galaxy: g, system: s, position: p, type, mission, speed, metal, crystal, deuterium, holdingtime, union: 0 });
  for (const [id, n] of Object.entries(ships)) if (n > 0) body.set('am' + id, n);
  // ?cp= in the QUERY STRING switches (and persists!) the current planet before dispatch (layout.md section 5)
  const url = new URL('/ajax/fleet/dispatch/send-fleet', location.origin);
  if (fromPlanetId) url.searchParams.set('cp', fromPlanetId);
  const r = await fetch(url, { method: 'POST', body, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf } });
  if (!r.ok) return { success: false, errors: [{ message: 'HTTP ' + r.status }] };
  return r.json();   // {success:true,...} | {success:false, errors:[{message, error:140020}]}
}
```

Check fuel before sending. Required deuterium on the planet is at least cargo deuterium plus the consumption from the 2.7 formulas, using check-target `shipsData`. To estimate the server's exact charge, use the server variant (generic `fleet_speed`).

---

## 5. `POST /ajax/fleet/dispatch/send-mini-fleet` (FC:656-797)

This is the fast espionage or recycle used from the galaxy view, messages and the event list. The JS callers are `sendShips(order, g, s, p, type, count)` (bundle:21849) and `sendShipsWithPopup` (bundle:21886). They POST `{mission, galaxy, system, position, type, shipCount, _token}` with `dataType: json`.

| `mission` | Ships sent |
|---|---|
| 6 (espionage) | **`users.espionage_probes_amount` probes, not `shipCount`** (FC:690-691). This is the player setting, falling back to 1 when it is null. |
| 8 (recycle) | `shipCount` recyclers, or `shipCount` **pathfinders** when `position == 16` (FC:693-701) |
| other | `{"response":{"message":"Invalid mission type"}}` (no `success` key) |

It always flies at 100% with no cargo (FC:756).

Success (`fleet-send-mini-fleet-success.json`):

```json
{"response":{"message":"Fleet dispatch","type":1,"slots":1,"probes":11,"recyclers":0,"explorers":9,"missiles":0,"shipsSent":3,
             "coordinates":{"galaxy":1,"system":45,"position":6},"planetType":1,"success":true},
 "newAjaxToken":"<csrf>","components":[]}
```

`slots`, `probes`, `recyclers`, `explorers` and `missiles` are **constants** (FC:764-769). Only `shipsSent` is real.

Failure: `{"response":{"message":"Error, no ships available","coordinates":{…},"success":false},"newAjaxToken":"…","components":[]}`. Other messages are "Invalid coordinates", the attack-block text, or an exception message such as "Maximum number of fleets reached." There is no error code.

**Differences from official OGame.** Official OGame uses `index.php?page=ingame&component=fleetdispatch&action=miniFleet&ajax=1&asJson=1` and puts the real slot and probe counts in `response`.

---

## 6. `POST /ajax/fleet/dispatch/recall-fleet` (FC:806-848)

- Request: `fleet_mission_id=<real mission id>` and `_token`. On event-list rows the id is `a.recallFleet[data-fleet-id]`, which is already the **real** id even on synthetic rows (er:312). On the movement page it is `a.recallFleet[data-fleet-id]` (row:56).
- Success: `{"components":[],"newAjaxToken":"<csrf>","success":true}`.
- Failure: the same body with `"success":false` and **HTTP 500**. This happens when the mission is not found, belongs to someone else, or is already canceled.
- `FMS::cancelMission` (FMS:652-703) **silently does nothing** for deployment-to-self relocations, for missions whose arrival time has passed (except ACS Defend during its hold), and for processed missions. It still returns `success:true`. Check the result by re-fetching the event list.
- The return trip after a recall takes as long as the elapsed outbound time. The UI tooltip "Recall: dd.mm.yyyy H:i:s" shows `now + (now - departure)` (FC:214, FEC:268).

---

## 7. Fleet templates, tactical retreat, unions

### 7.1 Templates ("standard fleets", FC:1298-1424, JS bundle:40734-41100)

| Call | Request | Response |
|---|---|---|
| `GET /ajax/fleet/templates` | | `{"templates":[{"id":3,"name":"Raid LC","ships":{"204":20,"205":0,…,"203":10,…}}]}`, ordered by id |
| `POST /ajax/fleet/templates` | `template_id` (0 = new), `template_name`, `ship[<id>]=<n>` | `{"success":true,"message":"Template saved successfully.","template":{id,name,ships}}`. Errors: `{"success":false,"message":"Template name is required." / "Template must contain at least one ship." / "Template not found." / "Maximum number of templates reached (10)."}` |
| `DELETE /ajax/fleet/templates/{id}` | header `X-CSRF-TOKEN` | `{"success":true,"message":"Template deleted successfully."}` or `{"success":false,"message":"Template not found."}` |

The allowed ship ids are 202-215, 218 and 219 (FC:1336). `ships` keeps **every posted id, zeros included**, in posted order. The game form posts 204, 205, 206, 207, 215, 211, 213, 214, 218, 219, 202, 203, 208, 209, 210. There are at most 10 templates per user. The JS applies a template with `fleetDispatcher.selectShips(template.ships)`. On the server they are named "standard fleets" with no per-template speed or mission (official OGame has more fields).

### 7.2 Tactical retreat

`POST /ajax/fleet/tactical-retreat` with `tacticalRetreatState` (or `tacticalRetreat`) set to 0, 3 or 5. 3 needs Admiral. The response is `{"success":true,"tacticalRetreatRatio":5,"newAjaxToken":"…"}`, or HTTP 422 with `{"success":false,"message":…}`.

### 7.3 ACS unions (brief)

- `POST /ajax/fleet/union/create` with `fleetID` (or `fleet_mission_id`), `groupname`, and `unionUsers` (usernames separated by `;`). It returns `text/plain` JSON `{fleetID, unionID, targetID:"g:s:p", token, errorbox:{type:"fadeBox",text,failed:false}}`. The union name shown is `KV<unionId>`.
- `POST /ajax/fleet/union/join` with `fleet_mission_id` and `union_id`. It returns `{success:true,time_arrival,newAjaxToken}`, or HTTP 400 or 404 with `{error}`.
- `GET /ajax/fleet/union/available?galaxy&system&position&planet_type` returns `{unions:[{id,name,creator,time_arrival,participant_count,max_fleets,can_join}],newAjaxToken}`.

---

## 8. `/fleet/movement` page (FC:130-287, mov, row)

### 8.1 Data

The page uses the same query as the event list: **own missions plus all foreign missions targeting any own planet or moon** (`FMS::getActiveFleetMissionsForCurrentPlayer`, FMS:272-310). Official OGame lists only own fleets here. The rows are sorted by `time_arrival` (FC:274-276). Synthetic return rows do not exist on this page. Instead each outbound row carries its return time (`.nextTimer`).

If there are no missions, the server redirects (302) to `/fleet`. A `fetch()` then ends on `/fleet` (`response.redirected`, or `response.url` ending in `/fleet`).

### 8.2 Page skeleton (mov:15-51)

```
#movementcomponent.maincontent > #movement > #inhalt
    header#planet.planet-header h2 "Fleet movement - <planet>"
    .fleetStatus  .reload a[onclick=reloadPage()]
                  .fleetSlots  "Fleets: <span.current>4</span> / <span.all>6</span>"
                  .expSlots    "Expeditions: <span.current>1</span> / <span.all>2</span>"
                  .closeAll a.all_open
    div.fleetDetails#fleet<id> …  (one per mission)
    .placeholder
<script> currentMovementTabExtensionStates = {"<id>":[1,<time_arrival>],…}; countdown init … </script>   (mov:69)
```

`currentMovementTabExtensionStates` (mov:69) is a quick machine-readable list of `id → [1, time_arrival]`.

### 8.3 One row (row:13-197)

```html
<div id="fleet1201" class="fleetDetails detailsOpened"
     data-mission-type="1" data-return-flight="" data-arrival-time="1793324177">
  <span class="timer tooltip" title="30.10.2026 01:36:17" id="timer_1201">load...</span>
  <span class="absTime">01:36:17 Clock</span>
  <span class="mission hostile textBeefy">Attack</span>
  <span class="allianceName"></span>
  <span class="originData">
     <span class="originCoords tooltip" title=""><a href="http://localhost/galaxy?galaxy=1&amp;system=42">[1:42:8]</a></span>
     <span class="originPlanet"><figure class="planetIcon planet"></figure>Homeworld</span></span>
  <span class="marker01"></span><span class="marker02"></span>
  <span class="fleetDetailButton"><a href="#bl1201" rel="bl1201" … class="tooltipRel tooltipClose fleet_icon_forward"></a></span>
  <span class="reversal reversal_time" ref="1201"><a class="icon_link tooltipHTML recallFleet" data-fleet-id="1201" title="Recall:| 30.10.2026<br>01:30:37">…</a></span>
  <span class="starStreak"> … <a id="route_1201" …> <div style="display:none;" id="bl1201"><div class="htmlTooltip"> … table.fleetinfo … </div></div> … </span>
  <span class="destinationData">
     <span class="destinationPlanet"><span><figure class="planetIcon planet"></figure>Farmville</span></span>
     <span class="destinationCoords tooltip" title="Farmville"><a href="…galaxy=1&amp;system=45">[1:45:6]</a></span></span>
  <span class="nextTimer tooltip" title="30.10.2026 02:48:37" id="timerNext_1201">load...</span>
  <span class="nextabsTime">02:48:37 Clock</span>
  <span class="nextMission friendly textBeefy">Return</span>
  <span class="fedAttack" id="federation_1201"><a href="http://localhost/overlay/fleet/federation?fleet=1201" class="openOverlay tooltip icon" …></a></span>
  <span class="openDetails"><a … class="openCloseDetails" data-mission-id="1201" data-end-time="1793324177">…</a></span>
</div>
```

| Field | Selector | Notes |
|---|---|---|
| Mission id | `div.fleetDetails` `id="fleet<id>"` | the real mission id. `#fleet1` and `#fleet2` are not a conflict here because this page has no dispatch divs. |
| Mission type | `[data-mission-type]` | ACS-attack outbound members are shown as type **1** with `.allianceName` = `KV<id>` (FC:230-234) |
| Return flight | `[data-return-flight]` is `"1"` or `""` | **Not `true`/`false`** as in the event list |
| Arrival | `[data-arrival-time]` | unix seconds of `time_arrival`. For an expedition this is the *physical arrival*, not the hold end. |
| Main timer target | `span.timer[title]` = `d.m.Y H:i:s` in the server timezone (UTC by default) | `timer_time`, which is the arrival, or for a fleet in its hold period (`is_at_destination`) the hold end (FC:251-262). The text is "load..." until the game JS runs, or `-` when it has already passed. |
| Status class | `span.mission.hostile` / `.neutral` / `.friendly` | **Mission class, not ownership.** Attack, espionage, moon destruction and missile are hostile; transport, deploy, colonise, harvest and expedition are neutral; ACS defend is friendly (`GameMissions/*Mission.php::$friendlyStatus`). Your own attack is "hostile" here, and an incoming foreign transport is "neutral". |
| Label | `span.mission` text | English `GameMission::$name` ("Attack", "Harvest", "Expedition", …) with `" (R)"` appended for returns. It is **not localized**, so use `data-mission-type`. |
| Origin / destination | `.originCoords a`, `.destinationCoords a` → `[g:s:p]`. Planet type from `.originPlanet figure.planetIcon.planet|.moon|.tf`. For deep space there is no figure. | For a **return** row (an existing return mission, `from` = old target, `to` = home), FC:152-179 swaps the fields back. Origin shows the **home** planet and destination shows the original target, so origin is always the home side, as in outbound rows. In the fixture, row 1199 has origin `[1:42:8]` and destination `[1:42:9]`, and the fleet is flying from destination to origin. |
| Ships and cargo | `#bl<id> .htmlTooltip table.fleetinfo` with rows `<td>Large Cargo:</td><td class="value">10</td>`, then `th` "Shipment:", then Metal, Crystal and Deuterium `td.value` | Ship amounts use `number_format` (`1,250`). Resources use `getFormattedLong()` (`31,200`, `1.25Mn`). **Outbound deuterium = cargo deuterium + deuterium_consumption / 2** (FMS:394-401, for every mission type). |
| Return | `span.nextTimer[title]`, `.nextabsTime`, `.nextMission` | present when the mission type has a return and the row is not a return. Also shown for **foreign** missions (for example the enemy probes' "return"). |
| Recall | `.reversal a.recallFleet[data-fleet-id]` | shown when `is_recallable && !return && !at_destination`. `is_recallable` only excludes missiles and self-relocations (FC:221-222), so **foreign missions show a recall link too**. It fails with HTTP 500 because the owner check fails. |
| ACS | `.fedAttack#federation_<id> a` | own attack outbound rows (FC:238-241) |
| Fleet icon | `.fleetDetailButton a` class `fleet_icon_forward`, `fleet_icon_forward_end` (at destination) or `fleet_icon_reverse` (return) | row:4-10 |

**Differences from official OGame.** `data-arrival-time`, `.timer`, `.absTime` and `.nextTimer` match. There is no `.fleetDetails .fleetinfo` with "Shipment" food. The ship titles come from `__('t_resources.<name>.title')` and follow the server language (en/fr/it/nl/zh-TW, with no ru). The status classes mean the mission class, not "own/enemy".

---

## 9. Event box, event list, checkevents

### 9.1 Where they live in the layout

- `#messages_collapsed > #eventboxFilled.eventToggle` (main:351) shows the summary, `#eventboxLoading` (main:361) the loading state, and `#eventboxBlank` (main:365) "no fleet movement".
- The list container is `#eventlistcomponent > #eventboxContent` (main:782-784). It is hidden until toggled. **The fleet pages add a second `#eventboxContent` (idx:16, mov:11). Always use the first one, `#eventlistcomponent > #eventboxContent`.**
- The bundle calls `getAjaxEventbox()` (bundle:25625), which does `$.get(ajaxEventboxURI)` and renders the result with `reloadEventbox` (bundle:25635-25710). `toggleEvents()` (bundle:19831) and `refreshFleetEvents(force)` (bundle:19853) load `eventlistLink` into `#eventboxContent` with `.html(response)`. Watch `#eventboxContent` with a MutationObserver to react when the game loads it.
- `#attack_alert.soon` (main:394) is the "under attack" indicator. It is true when a foreign mission of type 1, 2, 6 or 9 targets an own planet (FMS:316-334). Missile (10) does not count.

### 9.2 `GET /ajax/fleet/eventbox/fetch` (FEC:29-124)

```json
{"components":[],"hostile":1,"neutral":1,"friendly":4,"eventType":"hostile","eventTime":420,"eventText":"Espionage","newAjaxToken":"<csrf>"}
```

| Key | Meaning |
|---|---|
| `friendly` / `neutral` / `hostile` | counts over active missions, using **ownership-based** classification (FEC:585-609). Own missions are friendly. Foreign missions of type 1, 2, 6, 9 or 10 are hostile, and foreign 3 or 5 are neutral. Each mission counts **once**, without return rows. |
| `eventTime` | seconds until the next event. It uses the physical arrival for ACS Defend while travelling and the hold end while holding (FEC:50-91). |
| `eventType` | the status of the next event (`friendly`, `neutral` or `hostile`) |
| `eventText` | English mission name, with `" (R)"` for return missions |

With no missions it returns `{"components":[],"hostile":0,"neutral":0,"friendly":0,"eventType":"friendly","eventTime":0,"eventText":"","newAjaxToken":"…"}`. **This is the cheapest poll for "am I under attack"** (`hostile > 0`).

### 9.3 `GET /ajax/fleet/eventlist/fetch` (FEC:202-575, el, er, eru)

The response is an HTML fragment with no layout. Its parts are: `#eventListWrap > #eventHeader`, then `table#eventContent > tbody > tr.eventFleet…` with an inline `<script>` after each row, then `#eventFooter`, then a final `<script>` (`timeDelta`, `LocalizationStrings`, recall handler).

**Rows.** The list is built from the same query as the movement page, then:

1. Every active mission gives one row with **id = mission id**. The exception is a mission currently in its hold period (expedition, or ACS Defend while holding), whose arrival row is dropped (FEC:313-320).
2. For own or neutral missions with a hold time (and not a return), an extra **hold-end row** is added with **id = mission id + 888888** and arrival = hold end (FEC:324-349). For an expedition that is `time_arrival + time_holding`.
3. For **own** outbound missions with a return trip, a synthetic **return row** is added with **id = mission id + 999999**, `data-return-flight="true"`, arrival = return departure + one-way time, and **zero cargo** (FEC:353-387). The real return mission (a separate DB row with `parent_id`) only appears once the outbound mission is processed, and then it has its own id.
4. ACS attack (type 2) members sharing a `union_id` are collapsed into one `tr.allianceAttack.eventFleet#eventRow-union<unionId>` and hidden `tr.partnerInfo.eventFleet.union<unionId>` member rows (eru).
5. Everything is sorted by `data-arrival-time`.

In the fixture the ids are 1210, 1199, 1201, **890090** (the 1202 hold end), 1211, **1001201** (the 1202 return), **1001200** (the 1201 return), 1203 and **1001202** (the 1203 return).

**Row markup, outbound branch (er:195-328):**

```html
<tr class="eventFleet" id="eventRow-1201" data-mission-type="1" data-return-flight="false" data-arrival-time="1793324177">
  <td class="countDown"><span id="counter-eventlist-1201" class="friendly textBeefy">load...</span></td>
  <td class="arrivalTime">01:36:17 Clock</td>
  <td class="missionFleet"><img src="/img/fleet/1.gif" class="tooltipHTML" title="Own fleet | Attack" alt=""/></td>
  <td class="originFleet"><figure class="planetIcon planet js_hideTipOnMobile" title="Planet"></figure>Homeworld</td>
  <td class="coordsOrigin"><a href="http://localhost/galaxy?galaxy=1&amp;system=42" target="_top">[1:42:8]</a></td>
  <td class="detailsFleet"><span>30</span></td>
  <td class="icon_movement"><span class="tooltip tooltipRight tooltipClose" title="&lt;div class=&quot;htmlTooltip&quot;&gt; … table.fleetinfo …">&nbsp;</span></td>
  <td class="destFleet"><figure class="planetIcon planet js_hideTipOnMobile" title="Planet"></figure>Farmville</td>
  <td class="destCoords"><a href="…galaxy=1&amp;system=45" target="_top">[1:45:6]</a></td>
  <td class="sendMail"><span class="reversal reversal_time" ref="1201"><a class="icon_link tooltipHTML recallFleet" data-fleet-id="1201" title="Recall:| 30.10.2026<br> 01:30:37">…</a></span></td>
  <td class="sendProbe"></td>
  <td class="sendMail"><a href="javascript:void(0)" class="sendMail js_openChat tooltip" data-playerid="233" title="Raider42"><span class="icon icon_chat"></span></a></td>
</tr>
<script> … new eventboxCountdown($("#counter-eventlist-1201"), 1793324177 - 1793321837, $("#eventListWrap"), "http://localhost/ajax/fleet/eventlist/checkevents", [1201]); … </script>
```

**Return branch (er:70-194).** `data-return-flight="true"`, the cell `td.icon_movement_reserve` (instead of `icon_movement`), and the title `"Own fleet | Harvest (R)"`. The template **swaps** the columns. `originFleet`/`coordsOrigin` show the *destination* of the return trip, which is the home planet, and `destFleet`/`destCoords` show where the fleet is coming back *from*. This is the same convention as official OGame. There is never a recall link in this branch.

| Field | Selector | Notes |
|---|---|---|
| Row id | `tr.eventFleet[id^="eventRow-"]` | numeric, or `union<id>` for ACS. The synthetic offsets are +888888 and +999999 (see the list above). Recover the real id with recipe 12.2. |
| Mission type | `[data-mission-type]` | union summary rows say 2. Member rows (`tr.partnerInfo`) use the summary's type. |
| Return | `[data-return-flight]` is `"true"` or `"false"` | |
| Arrival | `[data-arrival-time]` | unix seconds. For ACS Defend outbound it is the physical arrival (`time_arrival - time_holding`, FEC:217-219). `td.arrivalTime` is `H:i:s Clock` in the server timezone, with no date. |
| Countdown | `span#counter-eventlist-<id>` | **class is always `friendly`**, even for hostile fleets. Official OGame uses `hostile`/`neutral`/`friendly` here. Hostile detection is in 12.2. Only union summary rows use the real status class (eru:10). |
| Mission tooltip | `td.missionFleet img[title]` | **always "Own fleet \| …"**, even for foreign fleets (er:84, 209) |
| Origin / destination | `td.originFleet`, `td.coordsOrigin a`, `td.destFleet`, `td.destCoords a` | The type comes from `figure.planetIcon.planet` (1), `.moon` (3) or `.tf` (2), or `span.deep-space-text` "Deep space" (4, expeditions) with no figure. The planet name is a text node after the figure. Debris shows the literal text `debris field`. |
| Ship count | `td.detailsFleet > span` | the total units, missiles included |
| Ships and cargo | `td.icon_movement > span[title]` or `td.icon_movement_reserve > span[title]` | The attribute holds tooltip HTML: `table.fleetinfo` rows `<td colspan="2">Light Fighter:</td><td class="value">20</td>`, then `th` "Shipment:", then `Metal:`, `Crystal:`, `Deuterium:` values. **Ship amounts are raw integers. Resources use `getFormattedLong`: `31,200`, `1.25Mn`.** Outbound deuterium includes half the fuel consumption. Synthetic return rows show 0 cargo. |
| Recall | `td.sendMail a.recallFleet[data-fleet-id]` | own outbound only (and ACS Defend hold-end rows). `data-fleet-id` is the real id. |
| Chat | `td.sendMail a.js_openChat[data-playerid]` | the other player (destination owner, or the original target for returns). Hidden when that is yourself. |
| Probe | `td.sendProbe` | empty, except in union member rows (`sendShips(6, g, s, p, type, n)`) |

**The final script (el:21-65).** It contains `var timeDelta = 1713793145000 - (new Date()).getTime();`. **The constant is hard-coded and wrong.** OGame Live computes server time from it (`flyingFleetObserver.js:6-9`), so a port must take server time from the layout instead (layout.md section 8). The `LocalizationStrings` there are also static.

**Differences from official OGame**, which break OGame Live's parser as it stands:

- The status class is always `friendly`, and `missionFleet` always says "Own fleet".
- Return rows are matched by `id = eventId - 1` in OGame Live. In OgameX the synthetic returns are `id + 999999`.
- Numbers use `,` as the thousands separator and `Mn` for millions. OGame Live does `split('.').join('')`, which breaks.
- Deep-space rows have no `figure`, so OGame Live falls back to `debrisField`.
- `timeDelta` is a constant.
- Foreign transport and ACS-defend rows look like own rows.

### 9.4 `POST /ajax/fleet/eventlist/checkevents` (FEC:142-192)

The request is `ids[]=<rowId>…`, which `eventboxCountdown` sends 2.5 s after a countdown reaches 0 (bundle:18901-18948). The response, with `Content-Type: text/plain`, is `{"rows":["1210","890090"]}`. It lists the requested ids that are no longer displayed, and **the ids are echoed back as strings**. Synthetic ids (+888888, +999999) are always reported as removable. The bundle then removes `#eventRow-<id>` and `.union<id>`.

---

## 10. Phalanx (`POST /ajax/phalanx/scan`, PhalanxController:27-169, `app/Services/PhalanxService.php`)

- Request: `galaxy`, `system`, `position` (validated 1-499 and 1-15) and `_token`. It runs from the **current** body, which must be a moon with `sensor_phalanx > 0`. Use `?cp=<moonId>` in the URL to scan from a specific moon.
- Cost: **5000 deuterium per scan** (`PhalanxService::SCAN_COST`, :26), deducted only on success. Range: `level² − 1` systems in the same galaxy, ×1.2 for Discoverer (:52-66). Level 1 can only scan its own system.
- The galaxy page caller is `resources/views/ingame/galaxy/index.blade.php:559-740`. It wraps `content_html` in its own `#phalanx-dialog > #phalanxWrap`.

Success (`fleet-phalanx-scan.json`):

```json
{"success":true,"server_time":1793321837,
 "target":{"galaxy":1,"system":45,"position":6,"planet_name":"Farmville","player_name":"Raider42"},
 "scan_cost":5000,"fleet_count":3,"content_html":"\n<div id=\"phalanxEventContent\"> … "}
```

Error (`fleet-phalanx-scan-error.json`). **Note that `success` is still true:**

```json
{"success":true,"server_time":…,"target":{…,"planet_name":"","player_name":""},"is_error":true,"error_message":"Target is out of range. Your sensor phalanx (Level 2) can scan up to 3 systems away."}
```

The other error messages are: "Sensor Phalanx can only be used from a moon.", "No Sensor Phalanx built on this moon.", "Not enough Deuterium!", "No planet found at these coordinates.", "Moons cannot be scanned with Sensor Phalanx.", "Administrator planets cannot be scanned." and "You cannot scan your own planets." A validation failure gives a Laravel 422 (or a 302 for non-AJAX requests).

`content_html` comes from `resources/views/ingame/phalanx/content.blade.php`:

```html
<div id="phalanxEventContent">
  <div id="fleet-tooltip-1223" style="display: none;"><div class="htmlTooltip"><h1>Fleet details:</h1> … <table class="fleetinfo">
      <tr><th colspan="2">Ships:</th></tr><tr><td>Cruiser:</td><td class="value">30</td></tr> …</table></div></div>
  <div class="eventFleet even" id="eventRow-1223" data-mission-type="1" data-return-flight="false" data-arrival-time="1793324537">
    <ul>
      <li class="countDown"><span class="friendly textBeefy" id="counter-phalanx-1223">Loading...</span></li>
      <li class="arrivalTime">01:42:17 Clock</li>
      <li class="descFleet">Enemy fleet</li>
      <li class="missionFleet"><img src="/img/fleet/1.gif"><span>Attack</span></li>
      <li class="originFleet"><figure class="planetIcon planet"></figure><span class="planetName">Vortex Prime</span></li>
      <li class="coordsOrigin"><a class="dark_highlight_tablet" href="…" target="_top">[1:47:3]</a></li>
      <li class="detailsFleet"><span class="dark_highlight_tablet tooltipClose tooltipRight tooltipRel" rel="fleet-tooltip-1223">45 <img …></span></li>
      <li class="destFleet"><figure class="planetIcon planet"></figure><span class="planetName">Farmville</span></li>
      <li class="destCoords"><a …>[1:45:6]</a></li>
      <li class="descSpeed">Speed</li><li class="baseSpeed">12000</li>
      <li class="sendMail"><a … class="sendMail js_openChat tooltip" data-playerid="301" …></a></li>
    </ul>
  </div> …
</div>
```

Notes on this markup:

- Only fleets **arriving at** the scanned planet are shown. For fleets that left it, the predicted return is shown as id `mission_id + 999999` with `data-return-flight="true"`. Missions to its moon or debris field are skipped.
- `descFleet` is "Own fleet" (the scanner owns it), "Enemy fleet" (only mission type 1) or "Friendly fleet" (everything else, including foreign espionage).
- Ship names are `ucwords(machine_name with _ → space)`, so the battleship is "Battle Ship", **not** the localized title. Amounts use `number_format($n, 0, ',', '.')`, which gives `1.250`.
- `baseSpeed` is the fleet's slowest speed with the owner's research.
- The rows are in DB `time_arrival` order of the underlying missions, **not** re-sorted after inserting predicted returns.
- The `odd`/`even` class alternates (`$loop->even`).

---

## 11. Jump gate (brief, `JumpGateController`, `resources/views/ingame/jumpgate/dialog.blade.php`)

- `GET /ajax/jumpgate` returns an HTML overlay. It requires the current body to be a moon with a jump gate, else `#jumpgate > #jumpgateError > p.error`. Main parts:
  - Form `#jumpgateForm` with hidden `_token`.
  - Target `select#targetMoonId` (`option[value=<moonId>]` "[g:s:p]").
  - Ship inputs `input[name="ship_<id>"]` (`rel` = available amount). Unavailable ships render as `input#<id>.disabled`.
  - Cooldown `#jumpgateNotReady #cooldown` ("12m 30s").
  - Default target `select#defaultJumpgateTarget`.
- `POST /ajax/jumpgate/execute` takes `targetMoonId`, `ship_<id>=<n>` and `_token`. It returns `{"success":true,"message":"Jump has been executed successfully.","redirect":"http:\/\/localhost\/facilities?cp=<targetMoonId>"}`. **Errors are thrown exceptions**, giving HTTP 500, or JSON `{"message": "…"}` when the request sends `Accept: application/json`. Examples: "Jump Gate is not ready yet.", "No ships were selected!", "Target Jump Gate is not ready yet.".
- `POST /ajax/jumpgate/set-default-target` takes `targetMoonId` (empty clears it). It returns `{"success":true,"message":"Default target has been set."}`.

---

## 12. Parsing recipes

These are verified by `ogx/tools/check_fleet.js`, whose `RECIPES` string is the source of truth. All of them are plain DOM code and need no game JS.

### 12.1 Helpers

```js
const coords = (s) => { const m = /\[?\s*(\d+):(\d+):(\d+)\s*\]?/.exec(s || ''); return m ? `${m[1]}:${m[2]}:${m[3]}` : null; };
// AppUtil::formatNumberLong(): "31,200" → 31200, "1.25Mn" → 1250000 (also accepts phalanx "1.250" → 1250)
const num = (s) => { s = String(s || '').trim(); const mn = /^([\d.]+)\s*Mn$/i.exec(s); return mn ? Math.round(parseFloat(mn[1]) * 1e6) : (parseInt(s.replace(/[^\d-]/g, ''), 10) || 0); };
// Tooltip HTML → {ships:{"Light Fighter":20}, metal, crystal, deuterium}. The LAST 3 td.value are M/C/D.
function parseFleetTooltip(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const vals = [...doc.querySelectorAll('table.fleetinfo td.value')];
  const out = { ships: {} };
  [out.metal, out.crystal, out.deuterium] = vals.slice(-3).map((td) => num(td.textContent));
  for (const td of vals.slice(0, -3)) out.ships[td.previousElementSibling.textContent.replace(/:\s*$/, '').trim()] = num(td.textContent);
  return out;
}
```

Ship labels are localized titles, so map them to ids with a title → id table built from `objects.jsonl` and the server language. Alternatively take the order from the template: ships appear in `getShipObjects()` order.

### 12.2 Event list → flights

```js
function parseEventList(html, ownCoords /* Set("1:42:8", …) from the layout planet list */) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('#eventContent > tbody > tr.eventFleet:not(.partnerInfo)')];
  const ids = new Set(rows.map((tr) => tr.id.replace('eventRow-', '')));
  return rows.map((tr) => {
    const rawId = tr.id.replace('eventRow-', ''), isUnion = rawId.startsWith('union');
    const id = isUnion ? null : parseInt(rawId, 10), ret = tr.dataset.returnFlight === 'true';
    const recall = tr.querySelector('a.recallFleet');
    let realMissionId = recall ? +recall.dataset.fleetId : id, synthetic = null;
    if (!isUnion && ret && id > 999999 && (ids.has(String(id - 999999)) || ids.has(String(id - 999999 + 888888)))) { synthetic = 'return'; realMissionId = id - 999999; }
    else if (!isUnion && !ret && id > 888888 && ids.has(String(id - 888888 + 999999))) { synthetic = 'holdEnd'; realMissionId = id - 888888; }
    const txt = (sel) => (tr.querySelector(sel) || {}).textContent || '';
    const type = (sel) => { const f = tr.querySelector(sel + ' figure.planetIcon'); return f ? (f.classList.contains('moon') ? 3 : f.classList.contains('tf') ? 2 : 1) : (tr.querySelector(sel + ' .deep-space-text') ? 4 : null); };
    const left = coords(txt('td.coordsOrigin a')), right = coords(txt('td.destCoords a'));   // left = home side
    const tip = tr.querySelector('td.icon_movement > span[title], td.icon_movement_reserve > span[title]');
    const missionType = +tr.dataset.missionType, own = ownCoords ? ownCoords.has(left) : null;
    return {
      rowId: isUnion ? rawId : id, realMissionId, synthetic, isUnion, missionType, returnFlight: ret,
      arrival: +tr.dataset.arrivalTime,                                  // unix seconds, server clock
      from: ret ? right : left, fromType: ret ? type('td.destFleet') : type('td.originFleet'),
      to: ret ? left : right, toType: ret ? type('td.originFleet') : type('td.destFleet'),
      units: parseInt(txt('td.detailsFleet span'), 10), recallable: !!recall, own,
      status: own === null ? null : own ? 'friendly' : ([1, 2, 6, 9, 10].includes(missionType) ? 'hostile' : 'neutral'),
      tooltip: tip ? parseFleetTooltip(tip.getAttribute('title')) : null,
    };
  });
}
```

- **Ownership.** Use the "home side" column (`coordsOrigin`), which holds the own planet for own outbound and return rows, and a foreign planet for foreign fleets. Compare it with the own coordinates from the layout planet list. Foreign status follows `FEC::determineFriendly`: types 1, 2, 6, 9 and 10 are hostile, everything else is neutral. You can cross-check the totals against `/ajax/fleet/eventbox/fetch`.
- **Synthetic ids.** The rule only uses ids in the same response, so it does not need the offsets to be smaller than real ids. The heuristic can still be fooled on a server with more than 888888 missions, if a real id happens to equal another row's id plus the offset.
- **Resources in flight** (OGame Live "resources in flight"):
  - Take outbound rows only (`!returnFlight && synthetic === null`), and add the real return missions (`returnFlight && synthetic === null`), which carry the loot or harvest.
  - Subtract `deuterium_consumption / 2` if you need exact cargo. The value is not exposed, so recompute it from 2.7 or accept the overstatement.
  - Count each mission once (`realMissionId`).

### 12.3 Movement page

```js
const parseMovement = (doc) => [...doc.querySelectorAll('#movement .fleetDetails[id^="fleet"]')].map((el) => {
  const id = +el.id.slice(5), ts = (t) => { const m = /(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d):(\d\d)/.exec(t || ''); return m ? Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]) / 1000 : null; };
  return { id, missionType: +el.dataset.missionType, returnFlight: el.dataset.returnFlight === '1', arrival: +el.dataset.arrivalTime,
    status: ['hostile', 'neutral', 'friendly'].find((c) => el.querySelector('span.mission').classList.contains(c)),
    timer: ts(el.querySelector('span.timer')?.getAttribute('title')), returnArrival: ts(el.querySelector('span.nextTimer')?.getAttribute('title')),
    origin: coords(el.querySelector('.originCoords a').textContent), destination: coords(el.querySelector('.destinationCoords a').textContent),
    recallId: el.querySelector('a.recallFleet')?.dataset.fleetId ?? null,
    tooltip: parseFleetTooltip(el.querySelector('#bl' + id + ' .htmlTooltip').outerHTML) };
});
```

`Date.UTC` assumes the server timezone is UTC, which is the default `APP_TIMEZONE`. Otherwise compute the offset from the layout server time. Prefer `data-arrival-time` (epoch) where it is enough.

### 12.4 Dispatch page without game JS

```js
const html = document.documentElement.innerHTML;                                // or a fetched /fleet?cp=N body
const shipsOnPlanet = [...(/var shipsOnPlanet = \[([\s\S]*?)\];/.exec(html)?.[1] || '').matchAll(/"id":\s*(\d+),\s*"number":\s*(\d+)/g)].map((m) => ({ id: +m[1], number: +m[2] }));
const currentPlanet = JSON.parse(/var currentPlanet = (\{[\s\S]*?\});/.exec(html)[1]);   // valid JSON
const fleetSlots = { used: +/var fleetCount = (\d+);/.exec(html)[1], max: +/var maxFleetCount = (\d+);/.exec(html)[1] };
const expSlots = /Expeditions:<\/span>\s*(\d+)\/(\d+)/.exec(html);              // DOM text; the JS vars are hard-coded 0/1
const speedFactors = ['PEACEFUL', 'WAR', 'HOLDING'].map((k) => +new RegExp('SPEEDFAKTOR_FLEET_' + k + ' = ([\\d.]+);').exec(html)[1]);
const domShips = Object.fromEntries([...document.querySelectorAll('#fleet1 #technologies li[data-technology]')].map((li) => [li.dataset.technology, +li.querySelector('span.amount').dataset.value]));
const ownBodies = [...document.querySelectorAll('#slbox option[value*="#"]')].map((o) => { const [g, s, p, t, ...n] = o.value.split('#'); return { g: +g, s: +s, p: +p, type: +t, name: n.join('#') }; });
```

`ownBodies` excludes the current body. Note that a planet name containing `#` breaks the split, which is why the code rejoins the rest.

### 12.5 Phalanx

```js
const res = await (await fetch('/ajax/phalanx/scan?cp=' + moonId, { method: 'POST', credentials: 'include', body: new URLSearchParams({ _token: csrf, galaxy, system, position }) })).json();
if (res.is_error) { /* res.error_message */ }
const doc = new DOMParser().parseFromString(res.content_html, 'text/html');
const rows = [...doc.querySelectorAll('#phalanxEventContent > div.eventFleet')].map((el) => ({
  rowId: +el.id.replace('eventRow-', ''), missionType: +el.dataset.missionType, returnFlight: el.dataset.returnFlight === 'true', arrival: +el.dataset.arrivalTime,
  direction: el.querySelector('li.descFleet').textContent.trim(), from: coords(el.querySelector('li.coordsOrigin a').textContent), to: coords(el.querySelector('li.destCoords a').textContent),
  units: parseInt(el.querySelector('li.detailsFleet span').textContent, 10), speed: +el.querySelector('li.baseSpeed').textContent,
  ships: Object.fromEntries([...doc.querySelectorAll('#' + el.querySelector('li.detailsFleet span').getAttribute('rel') + ' tr')].filter((tr) => tr.querySelector('td.value')).map((tr) => [tr.cells[0].textContent.replace(':', '').trim(), parseInt(tr.querySelector('td.value').textContent.replace(/\./g, ''), 10)])),
}));
```

---

## 13. Gotchas (quick list)

1. In the event list the countdown class is always `friendly` and the mission tooltip always says "Own fleet". Determine hostility from ownership (12.2) or from the eventbox counts.
2. On the movement page, `.mission.hostile` means the mission class. Your own attacks are hostile there, and foreign missions to your planets are listed (with a useless recall link).
3. Synthetic event-list ids: hold end = id + 888888, return = id + 999999. Use `a.recallFleet[data-fleet-id]` for the real id when present.
4. `data-return-flight` is `"true"`/`"false"` in the event list and phalanx, but `"1"`/`""` on the movement page.
5. Expeditions: `type_to = 4` (deep space), and the destination cell has `span.deep-space-text` and no figure. During the hold, the arrival row disappears from the event list and is replaced by the hold-end row.
6. Outbound tooltip deuterium = cargo + consumption / 2.
7. Number formats: event-list and movement resources use `1,234` and `1.5Mn`. Movement ship amounts use `1,234`. Event-list ship amounts are raw `1234`. Phalanx uses `1.234`.
8. Mission labels are English `GameMission::$name` values on every surface. Use `data-mission-type`.
9. Inline `shipsData`, `apiDataJson`, `expeditionCount/maxExpeditionCount`, `hasAdmiral`, `planets` and the `#galaxy/#system/#position` defaults on `/fleet` are hard-coded.
10. check-target `newAjaxToken` is a constant and not CSRF. Always take CSRF from `meta[name=csrf-token]`.
11. `?cp=` on any AJAX URL persists the current planet. Restore it afterwards (layout.md section 5).
12. `timeDelta` in the event-list fragment is a constant. Take server time from the layout.
13. The send-mini-fleet espionage probe count comes from the player setting, not from `shipCount`.
14. Recall returns `success: true` even when nothing happened (for example the fleet already arrived).
