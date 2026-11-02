# OgameX buildings, research, shipyard and defense: spec for content scripts

Scope: the pages and endpoints a production or empire add-on (OGame Live style) and a build helper (OGame Infinity / OGLight style) read or call:

- the list pages `/resources`, `/facilities`, `/research`, `/shipyard`, `/defense`
- `/resources/settings` (production percentages)
- `/overview` (planet info and the three queue boxes)
- the technology-details AJAX `GET /ajax/{resources|facilities|research|shipyard|defense}?technology=<id>`
- the techtree overlay `GET /ajax/techtree`
- build, downgrade, cancel and halve actions

The shared layout (planet list, resource bar, CSRF, server time, `?cp=`) is in `layout.md`. This spec does not repeat it.

Paths are relative to the OgameX checkout `src/OGameX/`. Short names:

| Short | File |
|---|---|
| `ABC` | `app/Http/Controllers/Abstracts/AbstractBuildingsController.php` |
| `AUC` | `app/Http/Controllers/Abstracts/AbstractUnitsController.php` |
| `OAT` | `app/Http/Traits/ObjectAjaxTrait.php` |
| `obj` | `resources/views/ingame/ajax/object.blade.php` |
| `bq/*` | `resources/views/ingame/shared/buildqueue/*.blade.php` |
| `bundle` | `resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js` |
| `web` | `routes/web.php` |

## 0. Fixtures

All fixtures are in `ogx/fixtures/` and are named `buildings-*`. Pages, AJAX bodies and the techtree were rendered from the real Blade templates by `ogx/tools/blade/gen_buildings_fixtures.php`. It uses `blade_b.php` and `stubs_b.php`, extended copies of the layout agent's mini-Blade that add `$loop`, `@for` and an unescaped `csrf_field()`.

The view variables come from `ogx/tools/buildings/export.js`, which re-implements OgameX's formulas (sections 11 and 12) on a sample account. Regenerate with:

```
node ogx/tools/buildings/export.js > /tmp/viewdata.json
php ogx/tools/blade/gen_buildings_fixtures.php /tmp/viewdata.json ogx/fixtures
```

The action responses are the exact arrays returned by the controllers, serialized with Laravel's default `json_encode` (slashes escaped, so a `/` comes out as `\/`).

Sample account:
- Origin `http://localhost`. Server time `1793322000` (2026-10-30 01:00:00 UTC). CSRF `Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe`.
- Economy speed 2, research speed 1.
- Player 1 "Commander Orion", class Collector, 8000 DM.
- Planet 4 "Homeworld" [1:102:8] (current), with moon 9. Planet 7 "Colony" [1:105:4], which is idle.
- Queues on planet 4:
  - Building: Metal Mine 22→23 is active (queue id 1287, 13984 s left), and Crystal Mine →20 is queued (id 1288).
  - Research: Plasma Technology 7→8 (id 342, 106200 s left).
  - Units: Large Cargo ×50 is active (id 5521, 47 left, 480 s per unit, 270 s until the next one, 22350 s total), and Light Fighter ×100 is queued (id 5522).

| Fixture | What it is |
|---|---|
| `buildings-overview.html` | `/overview` on planet 4, with all three queue boxes filled. |
| `buildings-overview-moon.html` | `/overview?cp=9` (moon). Research is shown because the research queue is player-wide. |
| `buildings-resources.html` | `/resources` on planet 4. Metal mine is active, and the building queue and unit queue are visible. |
| `buildings-resources-colony.html` | `/resources?cp=7`, an idle colony. |
| `buildings-resources-moon.html` | `/resources?cp=9`. Mines are `disabled` because their planet type is invalid. No crawler. |
| `buildings-facilities.html` | `/facilities` on planet 4, 8 planet stations. |
| `buildings-facilities-moon.html` | `/facilities?cp=9`, 5 moon stations. |
| `buildings-research.html` | `/research`, with plasma active. |
| `buildings-shipyard.html` | `/shipyard`, with large cargo active. |
| `buildings-defense.html` | `/defense`. |
| `buildings-resource-settings.html` | `/resources/settings` on planet 4. |
| `buildings-ajax-resources-{1,4,12,22,212,217}.json` | Technology details for metal mine, solar plant (with insufficient metal), fusion, metal storage, solar satellite and crawler. |
| `buildings-ajax-facilities-{21,33,44}.json`, `-43-moon.json` | Shipyard (disabled because ships are being built), terraformer (energy cost), missile silo (meter) and jump gate on the moon (week-long duration). |
| `buildings-ajax-research-{122,124}.json` | Plasma (being researched) and astrophysics (insufficient). |
| `buildings-ajax-shipyard-{203,218}.json`, `buildings-ajax-defense-{401,407,503}.json` | Units. 407 is disabled because max is 0. 503 is limited by silo space. |
| `buildings-techtree-tab{1-122,2-1,3-1,4-113}.html` | Techtree overlay bodies (HTML, no layout). |
| `buildings-addbuildrequest-*.json`, `buildings-cancelbuildrequest-success.json`, `buildings-halve-*.json` | Action responses (section 8). |

The page JS bundle is not part of the fixtures. Section 13 lists what Playwright parses from them.

---

## 1. Endpoints (web:69-118)

All of these sit in the `auth` and `web` middleware group. Every POST needs the CSRF token, either as an `X-CSRF-TOKEN` header or as a `_token` field, or Laravel answers 419. Any URL also accepts `?cp=<planetId>`, which switches the current planet persistently before the controller runs (see `layout.md` section 5). The AJAX and action endpoints all act on the *current* planet, so send `?cp=` or call them after a page load on the right planet.

| Method | Path | Handler | Params | Returns |
|---|---|---|---|---|
| GET | `/overview` | `OverviewController@index` | | page |
| GET | `/resources` | `ResourcesController@index` | `openTech=<id>` optional | page |
| GET | `/resources/settings` | `ResourcesController@settings` | | page |
| POST | `/resources/settings` | `ResourcesController@settingsUpdate` (:237-250) | `_token`, `last<id>=0..10` (`last217` 0..15) | 302 → `/resources/settings` |
| GET | `/facilities`, `/research`, `/shipyard`, `/defense` | `*Controller@index` | `openTech=<id>` | page |
| GET | `/ajax/resources` `/ajax/facilities` `/ajax/research` `/ajax/shipyard` `/ajax/defense` | `*Controller@ajax` → `OAT::ajaxHandler` (OAT:25-335) | `technology=<id>` | JSON (section 6) |
| GET | `/ajax/techtree` | `TechtreeController@ajax` | `tab=1..4`, `object_id=<id>` | HTML fragment (section 7) |
| POST, also GET | `/resources/add-buildrequest`, `/facilities/add-buildrequest` | `ABC::addBuildRequest` (ABC:227-279) | `technologyId`, `_token`, `mode` (`3` = downgrade) | JSON |
| POST, also GET | `/research/add-buildrequest` | `ResearchController@addBuildRequest` (:160-192) | `technologyId`, `_token` | JSON |
| POST | `/shipyard/add-buildrequest`, `/defense/add-buildrequest` | `ShipyardController@addBuildRequest` (:77-98) → `AUC::addBuildRequest` (AUC:135-169); Defense → AUC | `technologyId`, `amount`, `_token` | JSON |
| POST | `/resources/downgrade`, `/facilities/downgrade` | `ABC::downgradeBuildRequest` (ABC:288-322) | `technologyId`, `_token` | JSON |
| POST | `/resources/cancel-buildrequest`, `/facilities/cancel-buildrequest` | `ABC::cancelBuildRequest` (ABC:331-343) | `technologyId`, `listId`, `_token` | JSON |
| POST | `/research/cancel-buildrequest` | `ResearchController@cancelBuildRequest` (:203-214) | `technologyId`, `listId`, `_token` | JSON |
| POST | `/ajax/facilities/halve-building`, `/ajax/facilities/complete-building` | `FacilitiesController` (:111-150, :158-) | `queue_item_id`, `_token` | JSON |
| POST | `/ajax/research/halve-research` | `ResearchController@halveResearch` (:224) | `queue_item_id`, `_token` | JSON |
| POST | `/ajax/shipyard/halve-unit`, `/ajax/shipyard/complete-unit` | `ShipyardController` (:108, :157) | `queue_item_id`, `_token` | JSON |

Notes:

- **Token inside the body.** The add-buildrequest handlers (ABC:256, AUC:146, Research:171) also run `hash_equals(session token, $request->input('_token'))`. An `X-CSRF-TOKEN` header passes the middleware but fails this check and returns `{"success":false,"message":"Invalid token."}`. Always send `_token` as a form field (`application/x-www-form-urlencoded`), as the game does (bundle:31998-32003).
- **Order of checks in ABC::addBuildRequest:**
  1. Vacation mode returns `{"success":false}` (:231).
  2. `mode == 3` hands off to downgrade (:239).
  3. `technologyId` `'21'` or `'15'` while ships or defense are building on *this* planet returns `errors[]` "The Shipyard is still busy." (:244).
  4. `technologyId` `'212'` or `'217'` is forwarded to `ShipyardController::addBuildRequest` (:251), so satellites and crawlers can be ordered from `/resources/add-buildrequest`, and `amount` is honoured there.
  5. The token is checked (:256).
  6. `queue->add` runs. Exceptions come back as `{"success":false,"message":...}` (:268).

  The string comparisons are strict, so a JSON body with numeric `technologyId: 21` skips steps 3 and 4. Send strings, or use a form body.
- **GET variant.** `/resources|facilities|research/add-buildrequest` also accept GET with the same query params, including `_token`. The shipyard and defense endpoints are POST only.
- **The defense page posts to `/shipyard/add-buildrequest`** (`defense/index.blade.php:46`). `/defense/add-buildrequest` exists but has no "Shipyard is being upgraded" guard (DefenseController:71).
- **Building cancel** always posts to `/resources/cancel-buildrequest`, even on the facilities and overview pages (`bq/building-active:81`). Cancel has no `hash_equals` check, only the middleware CSRF check, and it always answers success (ABC:338-342, Research:210-213), even for an unknown `listId`.
- **Empty `technology`** on `/ajax/*` throws `Exception('No object ID provided.')` (OAT:30-32). An unknown id throws `RuntimeException` (ObjectService:181). Both give an HTML 500, not JSON.

## 2. Object map (id → machine_name → class_name)

`class_name` is the CSS class on the list `<li>` and on `.sprite` icons. `machine_name` is used in image file names (`/img/objects/<group>/<machine_name>_{small,micro}.jpg`) and in all server code. Source: the object definitions in `app/GameObjects/*Objects.php` (`BuildingObjects.php`, `StationObjects.php`, `ResearchObjects.php`, `MilitaryShipObjects.php`, `CivilShipObjects.php`, `DefenseObjects.php`), loaded by `ObjectService`. `ogx/specs/objects.jsonl` (written by another agent) lists the same ids with prices and requirements. The ids and class names below match the `data-technology` and `li` classes in the fixtures.

| id | machine_name | class_name | page | planet type |
|---|---|---|---|---|
| 1 | metal_mine | metalMine | resources | planet |
| 2 | crystal_mine | crystalMine | resources | planet |
| 3 | deuterium_synthesizer | deuteriumSynthesizer | resources | planet |
| 4 | solar_plant | solarPlant | resources | planet |
| 12 | fusion_plant | fusionPlant | resources | planet |
| 212 | solar_satellite | solarSatellite | resources + shipyard (civil) | both |
| 217 | crawler | resbuggy | resources + shipyard (civil) | planet; Collector only |
| 22 | metal_store | metalStorage | resources | both |
| 23 | crystal_store | crystalStorage | resources | both |
| 24 | deuterium_store | deuteriumStorage | resources | both |
| 14 | robot_factory | roboticsFactory | facilities | both |
| 21 | shipyard | shipyard | facilities | both |
| 31 | research_lab | researchLaboratory | facilities | planet |
| 34 | alliance_depot | allianceDepot | facilities | planet |
| 44 | missile_silo | missileSilo | facilities | both (only listed on planets) |
| 15 | nano_factory | naniteFactory | facilities | planet |
| 33 | terraformer | terraformer | facilities | planet |
| 36 | space_dock | repairDock | facilities | planet |
| 41 | lunar_base | moonbase | facilities | moon |
| 42 | sensor_phalanx | sensorPhalanx | facilities | moon |
| 43 | jump_gate | jumpGate | facilities | moon |
| 113 | energy_technology | energyTechnology | research basic | |
| 120 | laser_technology | laserTechnology | research basic | |
| 121 | ion_technology | ionTechnology | research basic | |
| 114 | hyperspace_technology | hyperspaceTechnology | research basic | |
| 122 | plasma_technology | plasmaTechnology | research basic | |
| 115 | combustion_drive | combustionDriveTechnology | research drive | |
| 117 | impulse_drive | impulseDriveTechnology | research drive | |
| 118 | hyperspace_drive | hyperspaceDriveTechnology | research drive | |
| 106 | espionage_technology | espionageTechnology | research advanced | |
| 108 | computer_technology | computerTechnology | research advanced | |
| 124 | astrophysics | astrophysicsTechnology | research advanced | |
| 123 | intergalactic_research_network | researchNetworkTechnology | research advanced | |
| 199 | graviton_technology | gravitonTechnology | research advanced | |
| 109 | weapon_technology | weaponsTechnology | research combat | |
| 110 | shielding_technology | shieldingTechnology | research combat | |
| 111 | armor_technology | armorTechnology | research combat | |
| 204 | light_fighter | fighterLight | shipyard battle | |
| 205 | heavy_fighter | fighterHeavy | shipyard battle | |
| 206 | cruiser | cruiser | shipyard battle | |
| 207 | battle_ship | battleship | shipyard battle | |
| 215 | battlecruiser | interceptor | shipyard battle | |
| 211 | bomber | bomber | shipyard battle | |
| 213 | destroyer | destroyer | shipyard battle | |
| 214 | deathstar | deathstar | shipyard battle | |
| 218 | reaper | reaper | shipyard battle | General only |
| 219 | pathfinder | explorer | shipyard battle | Discoverer only |
| 202 | small_cargo | transporterSmall | shipyard civil | |
| 203 | large_cargo | transporterLarge | shipyard civil | |
| 208 | colony_ship | colonyShip | shipyard civil | |
| 209 | recycler | recycler | shipyard civil | |
| 210 | espionage_probe | espionageProbe | shipyard civil | |
| 401 | rocket_launcher | rocketLauncher | defense | |
| 402 | light_laser | laserCannonLight | defense | |
| 403 | heavy_laser | laserCannonHeavy | defense | |
| 404 | gauss_cannon | gaussCannon | defense | |
| 405 | ion_cannon | ionCannon | defense | |
| 406 | plasma_turret | plasmaCannon | defense | |
| 407 | small_shield_dome | shieldDomeSmall | defense | |
| 408 | large_shield_dome | shieldDomeLarge | defense | |
| 502 | anti_ballistic_missile | missileInterceptor | defense | |
| 503 | interplanetary_missile | missileInterplanetary | defense | |

Differences from official OGame:
- The ids and class names match official OGame, including `resbuggy`, `explorer`, `interceptor`, `repairDock` and `moonbase`.
- The machine names are OgameX's own (`metal_store`, not `metalStorage`), and image paths use them.
- There are no lifeform objects (ids 11101+), no `lfbuildings`/`lfresearch` pages, and no lifeform queue boxes. Those boxes are commented out in `overview/index.blade.php:294`, `:339`.

## 3. List pages

### 3.1 Containers and order

| Page | `body#` | List container | Order (ids) | Controller |
|---|---|---|---|---|
| `/resources` | `resources` | `#technologies ul#producers.icons` (`resources/index.blade.php:29`) | Planet: 1 2 3 4 12 212 217 22 23 24. Moon: the same without 217. | `ResourcesController:42-60` |
| `/facilities` | `station` | `#technologies ul.icons` | Planet: 14 21 31 34 44 15 33 36. Moon: 14 21 41 42 43. | `FacilitiesController:35-65` |
| `/research` | `research` | `#technologies_basic`, `#technologies_drive`, `#technologies_advanced`, `#technologies_combat` (`research/index.blade.php:21-48`), each with `ul.icons` | as in the section 2 table | `ResearchController:47-137` |
| `/shipyard` | `shipyard` | `#technologies_battle`, `#technologies_civil` (`shipyard/index.blade.php:21,30`) | battle 204..219, civil 202 203 208 209 210 212 217 (217 only on planets) | `ShipyardController:35-56` |
| `/defense` | `defense` | `#technologies ul.icons` | 401..408 502 503 | `DefenseController:32-61` |

Every page puts a header image `#planet` with style `background-image:url(/img/headers/<page>/<biome>_<suffix>.jpg)`. On the resources and facilities pages, the suffix lists the ids of built objects (ABC:170-174). It is not useful for parsing.

### 3.2 Item markup

Buildings (`resources/index.blade.php:32-100`, `facilities/index.blade.php:38-111`). The following is real output from `buildings-resources.html`:

```html
<li class="technology metalMine hasDetails tooltip hideTooltipOnMouseenter js_hideTipOnMobile ipiHintable tpd-hideOnClickOutside"
    data-technology="1" data-is-spaceprovider="" aria-label="Metal Mine" data-ipi-hint="ipiTechnologymetalMine"
    data-status="active" data-is-spaceprovider="" data-progress="26" data-start="1713521207" data-end="1713604880" data-total="61608"
    title="Metal Mine<br/>Under construction">
  <span class="icon sprite  sprite_medium medium  metalMine">
    <span class="targetlevel" data-value="23" data-bonus="0">23</span>
    <div class="cooldownBackground"></div>
    <time-counter><time class="countdown buildingCountdown" id="countdownbuildingDetails" data-segments="2">...</time></time-counter>
    <span class="level" data-value="22" data-bonus="0"><span class="stockAmount">22</span><span class="bonus"></span></span>
  </span></li>
```

When an item is not active, a `button.upgrade[data-technology][data-is-spaceprovider]` appears (resources:82, facilities:97). There is no `targetlevel`, `cooldownBackground` or `time-counter`. Note `data-is-spaceprovider` appears twice.

Research (`research/research-item.blade.php`):
- The same structure, but there is no `button.upgrade` and no closing `</li>`; the browser auto-closes it.
- `span.level[data-bonus]` is `"(+N)"` when there is a bonus level, otherwise empty.
- `span.targetlevel[data-value]` is `current_level + 1`, even if more levels are queued (:42).

Ships and defense (`shipyard/unit-item.blade.php`):
- The level span is `span.amount[data-value=<amount>]`, and its `span.stockAmount` holds the formatted amount (`1,234`, from `formatNumber`, :65).
- While the unit is in the active or queued unit list, `span.targetamount[data-value=amount + all queued units of that type]` is shown (:58). The fixture shows 120 + 47 remaining = 167 for large cargo.
- `getFormattedFull()` uses `,` as the thousands separator. `data-value` is always raw.

`data-status` (first match wins; resources:36-68, facilities:42-80, research-item:7-30, unit-item:16-48):

| value | when |
|---|---|
| `active` | this object is the currently running item of its queue (building: `$build_active->object->id`; research: active; units: the active unit item) |
| `disabled` | wrong planet type, character class missing, queue full (`build_queue_max`), not enough resources, research lab upgrading (research), research running (lab), ships building (shipyard/nanite), shipyard or nanite upgrading (units), fields exceeded (buildings), vacation mode, or `max_build_amount == 0` (units) |
| `off` | requirements not met |
| `on` | buildable now |

Do not use `data-progress`, `data-start`, `data-end` or `data-total`. They are hardcoded constants copied from an official OGame page (resources:39-43). The real remaining time is only in the queue box's inline JS (section 4.3).

`title` holds `"<Title><br/><reason>"` for every status except `on`, where it is just `"<Title>"` (resources:44-68, research-item:15-30). Active items read `"<Title><br/>Under construction"`. Tipped rewrites `title` after load, so read it early or use `aria-label` for the name.

### 3.3 Parsing recipe (verified on the fixtures)

```js
function parseTechList(doc = document) {
  const out = [];
  for (const li of doc.querySelectorAll('#technologies li.technology[data-technology]')) {
    const id = +li.dataset.technology;
    const lv = li.querySelector('span.level, span.amount');
    const tgt = li.querySelector('span.targetlevel, span.targetamount');
    out.push({
      id,
      className: li.classList[1],                 // e.g. "metalMine"
      status: li.dataset.status,                  // on|off|disabled|active
      value: lv ? +lv.dataset.value : 0,          // level, or unit amount (raw)
      target: tgt ? +tgt.dataset.value : null,    // only while queued/active
      isUnit: !!li.querySelector('span.amount'),
    });
  }
  return out;
}
```

Research and shipyard pages also have `#technologies` as the outer wrapper (`#technologies > #technologies_basic ...`), so the same selector works on all five pages.

## 4. Queue boxes

### 4.1 Where they are

| Box | Pages |
|---|---|
| `#productionboxbuildingcomponent` | overview (`overview/index.blade.php:276`), resources (:107), facilities (:119) |
| `#productionboxresearchcomponent` | overview (:327), research (:61) |
| `#productionboxshipyardcomponent` | overview (:372), resources (:124), shipyard (:44), defense (:33) |

The building queue is per planet or moon. The research queue is player-wide: one research at a time across all planets, and the moon overview shows it too. The unit queue is per planet.

### 4.2 Markup (`bq/building-active`, `bq/building-queue`, `bq/research-*`, `bq/unit-*`)

Active building (real output):

```html
<table cellspacing="0" cellpadding="0" class="construction active"><tbody>
 <tr><th colspan="2">Metal Mine</th></tr>
 <tr class="data"><td class="first" rowspan="3"><div>
   <a ... onclick="cancelbuilding(1, 1287, &quot;Cancel production of Metal Mine level 23?&quot;); return false;">
     <img class="queuePic" width="40" height="40" src="http://localhost/img/objects/buildings/metal_mine_small.jpg" alt="Metal Mine"></a>
   <a ... class="tooltip js_hideTipOnMobile abortNow" onclick="cancelbuilding(1, 1287, ...)">...</a></div></td>
   <td class="desc ausbau">Improve to <span class="level">Level 23</span></td></tr>
 <tr class="data"><td class="desc">Duration:</td></tr>
 <tr class="data"><td class="desc timer"><time class="countdown buildingCountdown" data-segments="2">3h 53m</time></td></tr>
 <tr class="data"><td colspan="2"><a class="build-faster ..." rel="http://localhost/ajax/facilities/halve-building?queue_item_id=1287">
   ... <span class="dm_cost">Costs: 5,827 DM</span></a></td></tr>
</tbody></table>
<script>... new CountdownTimer('buildingCountdown', 13984, 'http://localhost/resources', null, true, 3) ...</script>
<table class="queue"><tbody><tr>
  <td><a class="queue_link ..." onclick="cancelbuilding(2,1288,&quot;Cancel production of Crystal Mine level 20?&quot;); return false;">
      <img class="queuePic" src=".../crystal_mine_micro.jpg" height="28" width="28" alt="Crystal Mine"><span>20</span></a></td>
</tr></tbody></table>
```

- In a downgrade, `span.level` in `td.desc.ausbau` holds the target (lower) level.
- The research box is the same, with `researchCountdown`, and the halve link is `/ajax/research/halve-research?queue_item_id=`.
- Active unit (`bq/unit-active`):
  - `th` is the unit title.
  - `div.shipSumCount.shipyardCountdownUnit` holds the remaining count of the active batch.
  - `time.countdown.unitCountdown` holds the total remaining time for the *whole unit queue*, as text.
  - Queued units are `table.queue td` with `img.queuePic[alt]`, then `<br />`, then the amount as a bare text node (no span, no cancel link).
- An empty box contains `table.construction` with a "no ... in progress" text in `td.idle` (`bq/building-active:97`), and no `.active`.
- A downgrade shows `Downgrade to` instead of `Improve to` (`bq/building-active:27-28`).

### 4.3 Remaining time (inline JS only)

The countdown `<time>` elements contain formatted text such as `3h 53m` (`AppUtil::formatTimeDuration`), which is not exact. The exact seconds are arguments to inline constructors:

| Source | Call | Meaning |
|---|---|---|
| `bq/building-active:84` | `new CountdownTimer('buildingCountdown', <secs>, '<url>', null, true, 3)` | seconds until the active building finishes |
| `bq/research-active:81` | `new CountdownTimer('researchCountdown', <secs>, ...)` | seconds until the active research finishes |
| `bq/unit-active:77` | `new CountdownTimer('unitCountdown', <secs>, ...)` | seconds until the whole unit queue is done |
| `bq/unit-active:78` | `new CountdownTimerUnit('shipyardCountdownUnit', <nextSecs>, <remaining>, <techId>, <perUnitSecs>, null, 3)` | seconds to the next unit, units left in the active batch, its id, and the build time of one unit |

The `<secs>` values are relative to page render time. Add them to `serverTime` (`layout.md` section 8) or to `Date.now()` taken when the page was parsed.

```js
const html = document.documentElement.innerHTML;          // or the raw response text
const timers = {};
for (const m of html.matchAll(/new CountdownTimer\('(buildingCountdown|researchCountdown|unitCountdown)',\s*(\d+)/g))
  timers[m[1]] = +m[2];
const u = html.match(/new CountdownTimerUnit\('shipyardCountdownUnit',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
const unit = u && { nextSecs: +u[1], remaining: +u[2], techId: +u[3], perUnitSecs: +u[4] };
// queue ids for cancel: onclick="cancelbuilding(<objectId>, <queueId>, ..."
const cancelIds = [...html.matchAll(/cancelbuilding\((\d+),\s*(\d+),/g)].map(m => ({ objectId: +m[1], listId: +m[2] }));
```

On the overview fixture this gives building 13984, research 106200, unit 22350, and unit `{270, 47, 203, 480}`.

### 4.4 Queue limits

- Buildings: index pages set `build_queue_max` when the number of *queued* (not active) items is 4 or more (ABC:183-187). The AJAX path and the server's `add` use `QueueListViewModel::isQueueFull()`, which is all items ≥ 5 (`app/ViewModels/Queue/Abstracts/QueueListViewModel.php:35`, `BuildingQueueService:75-77`). So 1 active plus 4 queued is the real maximum. The error is `"Maximum number of items already in queue."`.
- Research: the same limit (`ResearchQueueService:118`).
- Units: never full (`UnitQueueListViewModel:22`).
- Unit orders are silently clamped to what the planet can afford and to max-build limits (`UnitQueueService:160-240`). Resources are deducted at order time. The server answers success even if 0 units were added.
- Buildings and research deduct resources when the item *starts*, not when it is queued. A queued item that cannot be paid when its turn comes is cancelled.

## 5. Overview page (`overview/index.blade.php`, `OverviewController:32-143`)

The planet info block is filled by a typewriter effect from an inline array. The target spans (`#diameterContentField`, `#temperatureContentField`, `#positionContentField`, `#scoreContentField`, `#honorContentField`; :145-) are empty in the HTML.

```
textContent[1] = "12800km (<span>142<\/span>\/<span>163<\/span>)";       // :16  diameter raw (no separator), fields used / max
textContent[3] = "23°C to 63°C";                                // :18  min, max temperature
textContent[5] = "<a  href=\"http://localhost/galaxy?galaxy=4&system=4&position=4\" >[1:102:8]<\/a>"; // :20 link is hardcoded 4:4:4
textContent[7] = "<a href='http://localhost/highscore'>1,284,551 (Place 3 of 57)<\/a>";  // :22
textContent[9] = "0";                                                        // honour, constant
```

```js
const s = html;
const d = s.match(/textContent\[1\] = "(\d+)km \(<span>(\d+)<\\\/span>\\\/<span>(\d+)/);   // diameter, used, max
const t = s.match(/textContent\[3\] = "(-?\d+)\\u00b0C to (-?\d+)\\u00b0C/);              // tmin, tmax
const c = s.match(/textContent\[5\] = ".*?\[(\d+):(\d+):(\d+)\]/);                         // coords (do NOT use the href)
const p = s.match(/textContent\[7\] = ".*?>([\d,.]+) \(/);                                 // points, formatted
```

The same data is also in the planet-list tooltip on every page (`layout.md` 4.2). Prefer that one: `"<diam>km (<used>/<max>)<br>-17°C to 23°C"`.

On the overview fixture the regexes give `12800 / 142 / 163` and `23 / 63`, and on the moon `8366 / 9 / 10`. For a moon, `max` already includes the lunar base fields.

The overview has no list of buildings or levels. Use the list pages, or the empire data an add-on collects itself.

## 6. Technology details AJAX

`GET /ajax/<page>?technology=<id>`, called by `TechnologyDetails.show()` (bundle:41193-41420) as `$.ajax({url: technologyDetailsEndpoint, data: {technology: id}})`. The endpoint variable is set inline on each list page (resources:161, facilities:1068, research:105, shipyard:80, defense:69). All five endpoints run the same trait, so any of them returns details for any id. Only the `?cp=` planet matters.

### 6.1 Envelope (OAT:318-334)

```json
{"target":"technologydetails",
 "content":{"technologydetails":"<div id=\"technologydetails\" data-technology-id=\"3\">..."},
 "files":{"js":[],"css":[]},
 "newAjaxToken":"<csrf>",
 "page":{"stateObj":[],"title":"OGameX","url":"http:\/\/localhost\/resources"},
 "serverTime":1793322000}
```

`page.url` is always the resources route, and `serverTime` is `time()`. `newAjaxToken` is the session CSRF token, the same as `meta[name=csrf-token]`.

### 6.2 Inner HTML (obj:1-423)

| Data | Selector | Source | Notes |
|---|---|---|---|
| object id | `button.upgrade[data-technology]` or `button.downgrade[data-technology]` | obj:221, :244 | `#technologydetails[data-technology-id]` is **hardcoded `3`** (obj:3) |
| title | `h3` | obj:30 | |
| current level or amount | text of `.information > span.level` ("Level 22") or `span.amount` ("Number: 120") | obj:33-40 | `data-value` is **current + 1**, also for units (OAT:44): 400 rocket launchers give `data-value="401"` |
| build time (seconds) | `li.build_duration time[datetime]` | obj:44-46 | Format `PT[nW][nD][nH][nM][nS]`. W and D sit inside the time part, which is not ISO 8601 (`AppUtil::formatDateTimeDuration`). Examples: `PT1M20S`, `PT1D8H`, `PT1W4D2H40M`. For units this is the time for **one** unit. |
| energy needed | `li.additional_energy_consumption .value[data-value]` | obj:55-61 | the extra energy of the next level, for mines and fusion |
| energy produced | `li.energy_production .value[data-value]` (total at the next level), `.bonus[data-value]` (difference) | obj:62-70 | solar plant, satellite (per unit) |
| costs | `.costs li.resource.{metal,crystal,deuterium,energy}[data-value]` | obj:84-121 | the class list **always** contains `sufficient`; a missing resource **adds** `insufficient`. Test `classList.contains('insufficient')`. Zero-cost resources are omitted. |
| downgrade cost | `#demolition_costs_tooltip td[data-value]` (metal, crystal, deuterium) | obj:132-170 | already reduced by ion technology at 4% per level |
| can downgrade | `button.downgrade` exists | obj:221 | buildings only, level > 0, not blocked by dependents |
| max units | `#build_amount[max]` | obj:216 | only for ships and defense when max > 0 |
| buildable | `!button.upgrade.disabled` | obj:234-244 | the same conditions as `data-status="disabled"`, plus `max_build_amount == 0` |
| storage fill | `meter[value][max]` | obj:288 | storages: current resource and capacity at the current level |
| silo fill | `meter[value][max]` | obj:306 | missile silo: used and total slots |

Parse with `DOMParser` (`text/html`) on `json.content.technologydetails`. The HTML has a stray `)` text node after one `@if` (obj:350). It is harmless.

```js
async function techDetails(id, cp) {
  const r = await fetch(`/ajax/resources?technology=${id}${cp ? `&cp=${cp}` : ''}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const j = await r.json();
  const d = new DOMParser().parseFromString(j.content.technologydetails, 'text/html');
  const num = s => s ? +s.replace(/\D/g, '') : 0;
  const costs = {};
  for (const li of d.querySelectorAll('.costs li.resource'))
    for (const k of ['metal', 'crystal', 'deuterium', 'energy'])
      if (li.classList.contains(k)) costs[k] = { value: +li.dataset.value, enough: !li.classList.contains('insufficient') };
  const dt = d.querySelector('li.build_duration time')?.getAttribute('datetime') || '';
  const m = dt.match(/^PT(?:(\d+)W)?(?:(\d+)D)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/) || [];
  const secs = (+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0);
  return {
    id: +d.querySelector('button.upgrade, button.downgrade')?.dataset.technology || id,
    current: num(d.querySelector('.information > span.level, .information > span.amount')?.textContent),
    durationSecs: secs, costs,
    energyNeeded: +d.querySelector('li.additional_energy_consumption .value')?.dataset.value || 0,
    energyProduction: +d.querySelector('li.energy_production .value')?.dataset.value || 0,
    maxAmount: +d.querySelector('#build_amount')?.getAttribute('max') || 0,
    canBuild: !!d.querySelector('button.upgrade:not([disabled])'),
    canDowngrade: !!d.querySelector('button.downgrade'),
    token: j.newAjaxToken,
  };
}
```

Fixture results (from `check3.js`):

| Fixture | Current level / amount | Duration | Costs | Notes |
|---|---|---|---|---|
| resources-1 | 22 | `PT5H6M4S` | m=448909, c=112227 | energy needed 269 |
| resources-4 | 24 | `PT16H4M8S` | m=1262558 (insufficient), c=505023 | disabled |
| facilities-43-moon | 1 | `PT1W4D2H40M` | | |
| shipyard-203 | 120 | `PT8M` | | max 85 |
| defense-407 | 1 | | | disabled because max is 0 |

## 7. Techtree overlay (`TechtreeController@ajax`, `resources/views/ingame/techtree/*`)

`GET /ajax/techtree?tab=<n>&object_id=<id>` returns an **HTML fragment**: no layout and no JSON envelope. Each tab starts with the same `nav` of 4 `a.overlay[data-action]` links.

| tab | View | Content |
|---|---|---|
| 1 | `techtree.techtree` | Requirement graph: `.graph.columns_<n> > .techWrapper.depth<k> > .techtreeNode`, each with a `.techImage.tech<id>.techt<id>l<level>` and the class `built` or `notBuilt`, plus `a[data-tech-id][data-tech-name]`. An inline `endpoints = ["t122l1", ...]` array follows. |
| 2 | `techtree.techinfo` | Description and, for producers, `table.general_details` rows per level from `techtree/info/production.blade.php` (level, production, difference, energy). |
| 3 | `techtree.technology` | The list of requirements as text. |
| 4 | `techtree.applications` | What this object unlocks: `.techWrapper .techtreeNode` icons. |

These are rarely needed by add-ons, because the requirements are static. Fixtures: `buildings-techtree-tab1-122.html`, `-tab2-1`, `-tab3-1`, `-tab4-113`.

## 8. Actions: requests and responses

Client reference: `buildListActionBuild` (bundle:31990), `buildListActionDemolish`, `buildListActionCancel` (bundle:32103). The client sends `{technologyId, amount: amount||1, mode: mode||1, _token: token[, planetId]}` as a form POST to `scheduleBuildListEntryUrl`. It treats `json.status === "success"` as success and reloads the page. Otherwise it sets `token = json.newAjaxToken`, which is `undefined` on these endpoints, and shows only `json.errors[0].message`. So `{"success":false,"message":...}` failures are invisible in the stock UI. An add-on should show both `message` and `errors[0].message`.

`planetId` is sent but ignored by every handler. Use `?cp=`.

| Fixture | Body | When (source) |
|---|---|---|
| `buildings-addbuildrequest-success.json` | `{"status":"success","message":"Building construction started."}` | building or research added (ABC:274-277, Research:189) |
| `-unit-success.json` | `{"status":"success","message":"Added to build order."}` | ships or defense (AUC:165-168), also for 212/217 via `/resources/add-buildrequest` |
| `-downgrade-success.json` | `{"status":"success","message":"Building downgrade started."}` | `mode=3` or `/…/downgrade` (ABC:311-314) |
| `-invalid-token.json` | `{"success":false,"message":"Invalid token."}` | `_token` missing in the body or wrong (ABC:256-261) |
| `-error.json` | `{"success":false,"message":"Maximum number of items already in queue."}` | any `queue->add` exception (ABC:268-271). Other messages: `"Requirements not met to build this object."`, `"Not enough fields on this planet. Upgrade your Terraformer or use a planet field item to get more fields."`, `"…moon…Moon Base…"`, `"This building can not be built on this planet type (planet or moon specific)."` (BuildingQueueService:77-131) |
| `-shipyard-busy.json` | `{"success":false,"errors":[{"message":"The Shipyard is still busy."}]}` | upgrading 21 or 15 while units are building (ABC:244-248) |
| `-shipyard-upgrading.json` | `{"success":false,"errors":[{"message":"Shipyard is being upgraded."}]}` | unit order while the shipyard is upgrading (ShipyardController:83). Also `"Nanite Factory is being upgraded."` (:90). |
| `-downgrade-error.json` | `{"success":false,"errors":[{"message":"Cannot downgrade building: other buildings or research depend on this level."}]}` | downgrade exceptions (ABC:316-319, BuildingQueueService:176-237) |
| `-vacation.json` | `{"success":false}` | vacation mode (ABC:231) |
| `buildings-cancelbuildrequest-success.json` | `{"status":"success","message":"Building construction canceled."}` | cancel, always (ABC:338) |
| `buildings-halve-building-success.json` | `{"success":true,"error":false,"newAjaxToken":"…","new_time_end":<unix>,"cost":<DM>,"new_balance":<DM>,"remaining_time":<secs>}` | FacilitiesController:131-139 (research and unit halve use the same shape) |
| `buildings-halve-error.json` | `{"success":false,"error":true,"message":"Invalid queue item ID","newAjaxToken":"…"}` | FacilitiesController:116-122, and exceptions (:140-147) |

Success test: `json.status === 'success' || json.success === true`. Error text: `json.message || json.errors?.[0]?.message || 'error'`.

```js
async function addBuild(page, technologyId, { amount = 1, downgrade = false, cp } = {}) {
  const token = document.querySelector('meta[name="csrf-token"]').content;
  const body = new URLSearchParams({ technologyId: String(technologyId), amount: String(amount), mode: downgrade ? '3' : '1', _token: token });
  const ep = { resources: 'resources', facilities: 'facilities', research: 'research', shipyard: 'shipyard', defense: 'shipyard' }[page];
  const r = await fetch(`/${ep}/add-buildrequest${cp ? `?cp=${cp}` : ''}`, { method: 'POST', body, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
  const j = await r.json();                                   // 419 = page expired -> reload token
  return { ok: j.status === 'success', message: j.message || j.errors?.[0]?.message || '' };
}
```

## 9. Resource settings (`resources/settings.blade.php`, `ResourcesController:107-226`)

`body#resourceSettings`. A `<form method="POST" action="/resources/settings">` (:20) wraps `table.list.listOfResourceSettingsPerPlanet` (:24).

- `span.factorkey` holds `"Production factor: <N>%"` (:31). N is the planet's energy factor (0-100).
- There is one row per producer: mines 1/2/3, solar 4, fusion 12, satellite 212 and crawler 217. The crawler row only appears on Collector planets with crawlers.
- In each row, `select[name=last<id>]` has options `value="10".."0"` for 100%..0% (:98-140, :165-). The selected option is the current setting.
- For the crawler, `select[name=last217]` adds options 11..15 (110%..150%) for Collector (:256-262).
- The production cells are `td` with `span.tooltipCustom[title]`, where `title` holds the formatted number and the text is the abbreviated number. Rows also cover the base income, plasma, geologist, Collector bonus and the "Total per hour/day/week" lines.
- The update handler takes every input whose name contains `last`, so any subset may be posted (:241-247). It then redirects. The response gives no confirmation.

```js
const settings = Object.fromEntries([...document.querySelectorAll('select[name^="last"]')].map(s => [+s.name.slice(4), +s.value * 10])); // {1:100, 2:100, ...}
const factor = +(document.querySelector('span.factorkey')?.textContent.match(/(\d+)%/) || [])[1];
```

The fixture gives `last1..last217 = 10` (100%) for all producers and `Production factor: 100%`.

## 10. Differences from official OGame (porting checklist)

1. The countdowns in the list `li` (`data-start`, `data-end`, `data-total`) are fake constants. In official OGame they are real. Use the inline `CountdownTimer` arguments (4.3).
2. The `#technologydetails[data-technology-id]` attribute is always `3`. Use `button.upgrade[data-technology]`.
3. `.information span.level[data-value]` is the *next* level in both games. The visible text is the current level.
4. The AJAX details come from separate per-page endpoints that return the same envelope. Official OGame uses `?page=ingame&component=technologydetails&ajax=1&action=getDetails&technology=` instead. URL-based page detection (`component=`) never matches. Use `body#id` (`resources`, `station`, `research`, `shipyard`, `defense`, `resourceSettings`, `overview`).
5. Build requests: official OGame uses `component=buildlistactions&action=scheduleEntry` with `token`. OgameX uses `/<page>/add-buildrequest` with `_token`. The overview page still sets `scheduleBuildListEntryUrl = '#TODOpage=componentOnly&component=buildlistactions&action=scheduleEntry&asJson=1'`, which is dead.
6. There are no lifeform pages, ids or queue boxes. OGLight or Infinity code that touches `#productionboxlfbuildingcomponent` and similar must tolerate their absence.
7. The time format is `PT1W4D2H40M`-style. Official OGame emits `PT…H…M…S` (hours can exceed 24). Parse W and D.
8. Numbers: list `stockAmount` and costs use `,` thousands separators (en locale). Always read `data-value`.
9. Research queue limit: 1 active plus 4 queued (as in official OGame without Commander). There is no Commander-dependent limit.
10. The unit queue silently clamps amounts and deducts resources immediately.
11. The overview planet-info coordinates link is hardcoded to 4:4:4. Read the coordinates from the text.
12. `meta[name=ogame-planet-type]` is always `planet` (`layout.md`). To detect a moon, use the planet list (`a.moonlink.active`) or the facilities order (41/42/43 present).

## 11. Formulas (to reproduce real-time production and timers)

Source: `app/Services/PlanetService.php` (time 1018-1240, production 2123-2440), `app/Services/ObjectService.php` (price 568-700, max build 465-560) and `app/GameObjects/Models/Fields/GameObjectProduction.php`. Integer truncation is noted where it applies.

- Price at level L: `floor(base × factor^(L−1))` per resource. Astrophysics prices are rounded to the nearest 100. Units cost `base × amount`.
- Building time (s): `floor((M + C) / (2500 × max(4 − L/2, 1) × (1 + robotics) × economySpeed × 2^nanite) × 3600)`. For the nanite factory the `max(…)` term is dropped. Minimum 1 s.
- Unit time per unit (s): `floor(structuralIntegrity / (2500 × (1 + shipyard) × economySpeed × 2^nanite) × 3600)`, where structural integrity is M + C.
- Research time (s): `floor((M + C) / (1000 × (1 + labLevelWithIRN) × economySpeed × researchSpeed) × 3600)`.
- Storage capacity: `5000 × floor(2.5 × e^(20 L / 33))`.
- Production per hour = formula(L, temperature, position) × percent/100 × energyFactor × economySpeed, plus bonuses:
  - position bonus (`PlanetService.php:2240-2253`, applied to mines in `GameObjectProduction.php:226` and to base income in `PlanetService.php:2214-2229`): crystal ×1.4/1.3/1.2 at positions 1/2/3; metal ×1.17/1.23/1.35/1.23/1.17 at positions 6/7/8/9/10;
  - plasma +1% metal, +0.66% crystal, +0.33% deuterium per level;
  - Collector +25% mine production and +10% energy;
  - crawler +0.02% per crawler × percent (×1.5 for Collector), capped by the max-crawler rule; each crawler uses 50 energy.

  Base income (`PlanetService.php:2166-2192`) is `SettingsService::basicIncome*()` × economy speed × the position bonus. It is 0 on moons and in vacation mode, and it is not scaled by the energy factor.
- Energy factor = `min(1, produced / consumed)`.
- Halving cost in DM: `max(750, ceil(remainingMinutes / 30 × 750))`, capped at 72000 (buildings and units) or 108000 (research) (`HalvingService.php:48-68`).

The layout's resource ticker (`reloadResources(...)`, `layout.md` 6.3) already holds the per-second production of the current planet, which is the easiest source for live production.

## 12. Fixture generator notes

- `ogx/tools/blade/blade_b.php` and `stubs_b.php` are copies of the layout agent's tools with additions: `@for`, `$loop`, `@props` ignored, `csrf_field()` unescaped, a real `HalvingService::calculateHalvingCost`, and the `PlanetService` energy and amount stubs. The shared `blade.php` is unchanged.
- Production numbers in the settings fixture and the resource bar come from `export.js` approximating `PlanetService::updateResourceProductionStats`. The markup is exact. Values for unusual mixes (crawler overload, geologist) are approximate.
- The tab1 techtree fixture shows a requirement graph of depth 1 (plasma ← its direct requirements). The real controller recurses deeper. The structure is identical.

## 13. Verified parse results (Playwright, `chromium.launch()`)

| Fixture | Items `id:class:status:value>target` (excerpt) | Timers |
|---|---|---|
| resources | `1:metalMine:active:22>23`, `4:solarPlant:disabled:24`, `217:resbuggy:on:20` | building 13984, unit 22350, unit-next `270,47,203,480` |
| resources-moon | `1:metalMine:disabled:0`, `12:fusionPlant:off:0`, no 217 | — |
| facilities | `21:shipyard:disabled:8` (ships building), `15:naniteFactory:disabled:1`, `31:researchLaboratory:disabled:10` (research running) | building 13984 |
| facilities-moon | `41:moonbase:disabled:3`, `43:jumpGate:disabled:1` | — |
| research | `122:plasmaTechnology:active:7>8`, `199:gravitonTechnology:off:0` | research 106200 |
| shipyard | `203:transporterLarge:active:120>167`, `218:reaper:disabled:0` | unit 22350 |
| defense | `401:rocketLauncher:on:400`, `407:shieldDomeSmall:disabled:1`, `503:missileInterplanetary:off:0` | unit 22350 |
| resource-settings | `last1..last217 = 10` | — |
| overview / overview-moon | queue boxes: Metal Mine, Plasma Technology, Large Cargo / research only | diameter `12800/142/163`, temp `23/63`; moon `8366/9/10` |
