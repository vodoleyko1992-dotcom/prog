# OgameX galaxy and players: spec for content scripts

Scope: the galaxy page `/galaxy` and its data endpoint `POST /ajax/galaxy`, player flags and activity, the highscore (`/highscore`, `POST /ajax/highscore`), the search overlay (`/overlay/search`, `POST /ajax/search`), the galaxy player/alliance tooltips, the alliance info page, and buddies (`/buddies*`). The last part is a recipe for scanning many systems without hurting the server.

Read `layout.md` first for page detection, CSRF, `?cp=`, server time and the URL map. Read `fleet.md` §5 for `send-mini-fleet`, which the galaxy's espionage and harvest links call.

Paths are relative to the OgameX checkout `src/OGameX/`. Short names used below:

| Name | File |
|---|---|
| `GC` | `app/Http/Controllers/GalaxyController.php` |
| `HC` / `HS` | `app/Http/Controllers/HighscoreController.php` / `app/Services/HighscoreService.php` |
| `SC` | `app/Http/Controllers/SearchController.php` |
| `BC` / `BS` | `app/Http/Controllers/BuddiesController.php` / `app/Services/BuddyService.php` |
| `PS` / `PlS` | `app/Services/PlayerService.php` / `app/Services/PlanetService.php` |
| `gi` | `resources/views/ingame/galaxy/index.blade.php` |
| `hi` / `hp` / `ha` | `resources/views/ingame/highscore/index.blade.php` / `players_points.blade.php` / `alliance_points.blade.php` |
| `so` | `resources/views/ingame/search/overlay.blade.php` |
| `bundle` | `resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js` (served inside `/build/assets/ingame-<hash>.js`) |
| `main` | `resources/views/ingame/layouts/main.blade.php` |
| `web` | `routes/web.php` |

## 0. Fixtures

All fixtures are in `ogx/fixtures/`. `ogx/tools/blade/gen_galaxy_fixtures.php` builds them. HTML is rendered from the real Blade templates with the shared mini Blade compiler. It gained `@forelse`/`@empty`, `request('key')` and an optional `app()` resolver, and the layout and fleet fixtures still come out byte-identical. JSON bodies come from a line-by-line port of the controller code, with the same key order and `json_encode($data, 0)`, which is what Laravel's `response()->json()` uses. So `/` is escaped as `\/`, and floats such as `12400.0` print as `12400`.

`ogx/tools/render_galaxy.js` loads `galaxy-page*.html` in Chromium with OgameX's **own** ingame JS (the `vite.config.js` script list, minus pusher, echo and chat). It answers `/ajax/galaxy` with the JSON fixtures and saves `#galaxyContent` after the game has rendered it. `ogx/tools/check_galaxy.js` runs every recipe in §11 against the fixtures, including the live DOM, and writes `galaxy-expected-parse.json`.

**Sample state.** This is the same account as the layout and fleet fixtures. "Now" is `1793321837` (2026-10-30 00:57:17 UTC). The player is Commander Vega (id 108, Collector, 48,213 points, rank 37 of 214, no alliance). The current planet is Homeworld (id 1) at [1:42:8], with 15 probes, 6 recyclers, 1 colony ship and 5 IPMs. Its Moon is id 5 (Sensor Phalanx 2, 9,000 deuterium). Research: impulse 4 (IPM range 19), espionage 4, astrophysics 4, hyperspace tech 2. Slots used 4/6. Nova (150) is a buddy.

| Player | id | Points (rank) | users.time | Flags in fixtures |
|---|---|---|---|---|
| Legor | 1 | 0 (NULL: admins are hidden) | −3 d | `isAdmin`, `isNewbie` (score 0 < 20 % of mine) |
| Nova | 150 | 412,870 (5), alliance 12 [NOVA], open | −2 min | `isStrong` (> 5× mine) |
| OldMiner | 201 | 31,020 (88) | −10 d | `isInactive` |
| Sleeper | 202 | 5,210 (150) | −40 d | `isInactive`, `isLongInactive`, `isOnVacation` |
| Rookie | 204 | 2,105 (201) | −37 min | `isNewbie` |
| Raider42 | 233 | 198,500 (12), alliance 7 [RAID], closed | −18 min | none |

| Fixture | What it is |
|---|---|
| `galaxy-page.html` | Full `GET /galaxy?cp=1` page (layout + galaxy shell, rows still empty, as the server sends it). |
| `galaxy-page-query.html` | `GET /galaxy?galaxy=1&system=45&position=6`. `var system = 45`; `position` is ignored. |
| `galaxy-page-vacation.html` | Galaxy page of a player in vacation mode (no rows, no inline JS; `gi:11-29`). |
| `galaxy-ajax-1-42.json` | `POST /ajax/galaxy` galaxy=1 system=42 from Homeworld. Pos 4 Nova (`*`, strong, alliance, buddy, so ACS Defend appears), 6 OldMiner (i), 8 own Homeworld + Moon (moon idle 23 min) + debris 12,400/7,800/0, 11 Sleeper (v, I), 13 Rookie (n, idle 37). The rest are empty. |
| `galaxy-ajax-1-45.json` | System 45. Pos 1 Legor (admin: only Transport), **3 destroyed planet + debris**, 6 Raider42 Farmville (idle 18) + moon (`*`), 9 Nova colony. |
| `galaxy-ajax-1-45-from-moon.json` | The same system with the Moon (id 5) as the current body: phalanx flags set, probes 0. |
| `galaxy-ajax-1-42-discoverer.json` | System 42 as a Discoverer: an extra position-16 row with expedition debris (`planets` is an **object**). |
| `galaxy-ajax-1-44-empty.json` | A system with no planets (15 empty rows, `slotsColonized` 0). |
| `galaxy-ajax-vacation-403.json` | Body of the HTTP 403 sent when the requesting player is in vacation mode. |
| `galaxy-rendered-1-42.html` | `#galaxyContent` **after** the game JS rendered `galaxy-ajax-1-42.json` (live DOM serialized; see the note in §4.3). |
| `galaxy-rendered-1-45.html` | The same for 1:45. Rendering **crashes at the destroyed planet** (§4.5): rows 4-15 stay empty and the spinner stays on. |
| `galaxy-highscore-page.html` | Full `GET /highscore` (players, points, page 1 = ranks 1-100, own row 37 `tr.myrank`). |
| `galaxy-highscore-ajax-players-military.html` | `POST /ajax/highscore?category=1&type=3&page=1` fragment (military, with the total-ships tooltip). |
| `galaxy-highscore-ajax-players-page2.html` | `POST /ajax/highscore?category=1&type=0&page=2` (ranks 101-200). |
| `galaxy-highscore-ajax-alliances.html` | `POST /ajax/highscore?category=2&type=0` (9 alliances). |
| `galaxy-search-overlay.html` | `GET /overlay/search` fragment (form + inline JS). |
| `galaxy-search-players.json`, `-planets.json`, `-alliances.json`, `-empty-term.json` | `POST /ajax/search` bodies for categories 2, 3 and 4, and for an empty term. |
| `galaxy-buddies-page.html` | Full `GET /buddies` (1 buddy, 1 received and 1 sent request, 1 ignored player). |
| `galaxy-buddies-request-dialog.html` | `GET /buddies/request-dialog?id=233&name=Raider42`. |
| `galaxy-buddies-online.json` | `GET /buddies/online`. |
| `galaxy-buddies-sendrequest-success.json` | `POST /buddies/send-request` success. |
| `galaxy-alliance-info.html` | `GET /alliance/info/12`: a stand-alone HTML page (no layout), opened in a new tab. |
| `galaxy-expected-parse.json` | Output of the §11 recipes on the fixtures. |

## 1. Endpoints (web:145-149, 183-185, 213-214, 226-232, 239-240)

All endpoints sit behind the in-game middleware (`auth, banned, globalgame, locale, firstlogin`). Every request, including AJAX, runs `GlobalGame` (`app/Http/Middleware/GlobalGame.php:44-61`). It handles `?cp=`, sets **your own** `users.time = now`, updates your **current planet** (its activity becomes `*`) and processes your fleet missions. There is **no rate limiting** on these routes (only Fortify's login limiter exists).

| Method | URL | Controller | Returns |
|---|---|---|---|
| GET | `/galaxy` (`?galaxy=&system=`; both must be non-empty to apply) | `GC::index` 53-84 | HTML page, `body#ingamepage` |
| POST | `/ajax/galaxy` (`galaxy`, `system`, `_token`) | `GC::ajax` 724-789 | JSON (§3) |
| GET | `/overlay/galaxy/missile-attack?galaxy=&system=&position=&type=` | `GC::missileAttackOverlay` 878-958 | HTML overlay |
| POST | `/ajax/galaxy/missile-attack` (`galaxy, system, position, type, missile_count, target_priority 0-7`) | `GC::missileAttack` 968-1089 | JSON `{success, message, mission_id, arrival_time}` or `{success:false, error}` with 400/403 |
| POST | `/ajax/phalanx/scan` | see `fleet.md` | JSON |
| GET | `/highscore` (`?category=1|2&type=0-3&page=N&searchRelId=id`) | `HC::index` 20-27 | HTML page, `body#highscore` |
| POST | `/ajax/highscore` (same params, query string or form) | `HC::ajax` 37-54 | **HTML fragment** (§6) |
| GET | `/overlay/search` (`?category=2|3|4`) | `SC::overlay` 19-22 | HTML fragment |
| POST | `/ajax/search` (`searchtext`, `category`, `_token`) | `SC::search` 30-55 | JSON (§7) |
| GET | `/alliance/info/{id}` | `AllianceController::info` 1093-1117 | stand-alone HTML |
| GET | `/buddies` | `BC::index` 25-48 | HTML page, `body#buddies` |
| POST | `/buddies` (`action`, `id`, `ajax=1`, `search`) | `BC::post` 57-112 | JSON or HTML partial |
| GET | `/buddies/request-dialog?id=&name=` | `BC::showRequestDialog` 153-162 | HTML fragment |
| POST | `/buddies/send-request` (`receiver_id`, `message`) | `BC::sendRequest` 171-198 | JSON |
| POST | `/buddies/ignore`, `/buddies/unignore` (`ignored_user_id`) | `BC` 207-244 | **302 redirect** to `/buddies` (not JSON) |
| GET | `/buddies/online` | `BC::getOnlineBuddies` 252-366 | JSON (§9) |

**Differences from official OGame.** There is no `index.php?page=ingame&component=galaxy&action=fetchGalaxyContent`, no `galaxyContent` HTML, no XML API (`players.xml`, `universe.xml`, `highscore.xml`, `alliances.xml`) and no player-info overlay. Player data comes only from `/ajax/galaxy` (flags, rank, alliance), `/ajax/highscore` (id, name, points, home coordinates) and `/ajax/search`.

## 2. Galaxy page `/galaxy` (gi)

### 2.1 Inline JS globals (gi:32-149, 553-557)

| Global | Value | Line |
|---|---|---|
| `galaxy`, `system` | current coordinates (ints at load; the game turns them into **strings** after input/keyboard navigation) | gi:33-34 |
| `maxGalaxies` | `numberOfGalaxies()` setting (default 9) | gi:35 |
| `maxSystems` | **hard-coded `499`** | gi:36 |
| `spionageAmount` | hard-coded `3` (not the player setting) | gi:37 |
| `contentLink`, `galaxyContentLink` | absolute `…/ajax/galaxy` | gi:38-39 |
| `galaxyLoca`, `loca` | UI strings (`loca.LOCA_ALL_ACTIVITY`, `LOCA_GALAXY_PLAYER_STATUS_*` letters, …) | gi:41-139 |
| `missleAttackLink` | `…/overlay/galaxy/missile-attack?width=669&height=250` | gi:143 |
| `canSwitchGalaxy`, `inProgress`, `shipsendingDone`, `expeditionFleetTemplates` | state | gi:140-149 |
| `checkTargetUrl`, `missionExpedition = 15`, `spaceObjectTypePlanet = 1`, `expeditionPosition = 16` | | gi:554-557 |
| Functions | `initGalaxyNew()`, `trySubmit()`, `doExpedition()` (→ `/fleet?mission=15&galaxy=&system=&position=16&type=1`), `scanWithPhalanx(g,s,p)`, `sendBuddyRequestDialog(id,name)` | gi:187-242, 571, 833 |
| Bundle | `loadContentNew(g,s)` 35986, `renderContentGalaxy(json)` 34800, `submitOnKey(key)` 34572, `keyevent` 34610, `sendShips(mission,g,s,p,type,count)` 21849 | bundle |

On load, `initGalaxyNew()` (gi:752) calls `loadContentNew(galaxy, system)` once. Arrow keys move ±1 system (Left/Right) or ±1 galaxy (Down/Up) and wrap 1↔499 / 1↔maxGalaxies (`bundle:34572-34608`). The handler is bound to `keyup` on `document.documentElement` (gi:753-754) and ignored only inside `.ui-dialog` and the chat textarea (bundle:34610-34630). **Extension keyboard shortcuts on the galaxy page must not use the arrow keys.** If you bind keys yourself, call `ev.stopPropagation()` or check `location.pathname`.

**`window.token` becomes `undefined`** after the first render, because `renderContentGalaxy` sets `token = json.token` but the response field is `newAjaxToken` (bundle:34801). The game keeps working because the layout sets the `X-CSRF-TOKEN` header for jQuery (main:1700-1704). Read the token from `meta[name="csrf-token"]` (layout.md §7).

### 2.2 Static markup (server HTML)

```
#galaxycomponent.maincontent
  script (globals above)
  #inhalt
    #expeditionFleetOverlay (hidden)
    #galaxyHeader.ct_head_row > form[name=galaform]
        span.galaxy_icons.prev/next, input#galaxy_input, input#system_input, div.btn_blue (Go, onclick=submitForm())
        .systembuttons > a.phalanxlink.btn_system_action, a.spysystemlink.btn_system_action, #discoverSystemBtn   ← system-level buttons
    #galaxyLoading (spinner; display:none when idle)
    #galaxyContent > .galaxyTable
        .galaxyRow.ctGalaxyHead > .galaxyCell.span11 > #probes #probeValue, #recycler #recyclerValue, #rockets #missileValue,
                                                         #slots #slotUsed / #slotValue, #galaxyHeaderDiscoveryCount
                                  #filterCell > #filter_empty #filter_inactive #filter_newbie #filter_strong #filter_vacation
        .galaxyRow.ctGalaxyHead.headBold (column titles)
        .galaxyRow.ctContentRow#galaxyRow1 … #galaxyRow15  (gi:319-468)
            > .galaxyCell.cellPosition (text "N"), .cellPlanet, .cellPlanetName, .cellMoon, .cellDebris,
              .cellPlayerName, .cellAlliance, .cellAction            ← all empty in the server HTML
        .expeditionDebrisSlotBoxRow > .expeditionDebrisSlotBoxCell.cellPosition "16"
            + .expeditionDebrisSlotBox#galaxyRow16 > #expeditionDebrisSlotDebrisContainer, #expeditionDebrisSlotActions
              (#galaxyExpeditionFleetTemplateContainer, #expeditionbutton → doExpedition(), #sendExpeditionFleetTemplateFleet)
        .galaxyRow.ctGalaxyFleetInfo#fleetstatusrow (empty)
        .galaxyRow.ctGalaxyFooter > #colonized > #amountColonized ; #legend
    #legendTT (status legend tooltip, gi:519-550)
```

The vacation variant (gi:11-29) has `#galaxycomponent > #inhalt > #galaxyContent` with only `#fleetstatusrow` and a warning. It has no rows, no `#galaxyHeader` and no inline JS. Detect it with `!document.getElementById('galaxy_input')`.

## 3. `POST /ajax/galaxy` (GC::ajax 724-789)

**Request**: `application/x-www-form-urlencoded`, with `galaxy=<g>&system=<s>&_token=<csrf>` (bundle:36006-36010). Send the CSRF token as `_token` or as the `X-CSRF-TOKEN` header. There is no validation:

- `galaxy` or `system` missing or non-numeric → PHP `TypeError` → **HTTP 500**.
- Out-of-range values (galaxy 0, system 500) → 15 empty rows.
- `?cp=` on this URL **changes your current planet** (layout.md §5). Never add it.

**Errors**: if *you* are in vacation mode → **HTTP 403** `{"success":false,"error":"<vacation_error text>"}` (GC:729-734, `galaxy-ajax-vacation-403.json`). Logged out → 302 to `/login`. Bad CSRF → 419 (Laravel).

**The response depends on the requesting planet** (`?cp`-selected current planet): `availableProbes/Recyclers/Missiles`, `canEspionage`, the phalanx flags and `canMissileAttack` are all computed from it. Player flags, activity, debris and moons do not depend on it.

### 3.1 Top level

```jsonc
{
  "components": [], "filterSettings": [], "lifeformEnabled": false,
  "newAjaxToken": "<csrf>",               // same per-session token (layout.md §7)
  "reservedPositions": [],                // [] when none, else an OBJECT keyed by position: {"7":{"isReserved":true,"user_id":108,"cooldown":3600}} (GC:852-868)
  "success": true,
  "system": { … }
}
```

### 3.2 `system` (GC:759-787)

| Key | Type | Meaning |
|---|---|---|
| `availableMissiles`, `availablePathfinders`, `availableProbes`, `availableRecyclers` | int | units on the **current** planet or moon |
| `canColonize` | bool | astrophysics > 0 |
| `canExpedition`, `canSendSystemDiscovery`, `canSwitchGalaxy` | bool | always `true` |
| `canSystemEspionage` | bool | always `false` |
| `canFly` | bool | used slots < max slots |
| `canSystemPhalanx` | bool | current body is a moon with phalanx > 0 |
| `currentPlanetId` | int | id of the current planet or moon |
| `deuteriumInDebris` | bool | always `true` |
| `galaxy`, `system` | **string** | echo of the POSTed values (`"1"`, `"42"`); the row values below are ints |
| `galaxyContent` | array | 15 rows (pos 1-15), plus pos 16 for Discoverers with expedition debris |
| `hasAdmiral`, `hasBirthdayPlanet` (false), `isOutlaw` (false), `showOutlawWarning` (true) | bool | |
| `maximumFleetSlots`, `usedFleetSlots` | int | |
| `playerId` | int | **your** id. Use it to recognise your own rows. |
| `settingsProbeCount` | int | always `3` |
| `slotsColonized` | int | planets **and moons** in the system (not destroyed, `playerId` set; debris has no playerId) (GC:829-843) |
| `switchGalaxyDeuteriumCosts` | int | always `10` (not charged) |
| `toGalaxyLink` | string | `…/galaxy?galaxy=1&system=42` |

### 3.3 Row (`galaxyContent[i]`)

Every row has `galaxy` (int), `system` (int), `position` (int), `playerId`, `playerName`, `player`, `planets`, `actions`, `availableMissions` and `positionFilters`.

| Row kind | Source | `planets` | `player` | `playerId` / `playerName` | `positionFilters` | `actions` | row `availableMissions` |
|---|---|---|---|---|---|---|---|
| Occupied | GC:149-171 | array: planet (type 1), then debris (type 2) if any, then moon (type 3) if any | full player object (§3.5) | owner id / name | `""` | actions object (§3.6) | `[]` |
| Destroyed planet | GC:151-169 | `[planet{isDestroyed:true, activity:null, planetName:"Destroyed Planet", playerId:99999}, debris?]` | `{"playerId":99999,"playerName":"Deep space"}` | 99999 / `"Deep space"` | `""` | `[]` | `[]` |
| Empty | GC:606-674 | `[]` | `{"playerId":99999,"playerName":"Deep space"}` | 99999 / `"Deep space"` | `"empty_filter"` | `[]` | `[{missionType:0 (relocate), planetMovePossible, moveAction:"prepareMove", moveLink:"…/ajax/planet-move", galaxyLink, title}, {missionType:7, link:"/fleet?galaxy=…&type=1&mission=7" or "#", description:"Colonize<br>…"}]` |
| Pos 16 (Discoverer only, only if debris) | GC:685-713, 127-134 | **object** = one debris entry (not an array) | `{99999,"Deep space"}` | 99999 | `"expedition_debris"` | `[]` | `[]` |

- `playerId` 99999 means "nobody". Destroyed planets keep their real owner in the database but are sent as 99999. `CleanupDestroyedPlanets` purges them daily at 03:00 once they are 24 h old (`routes/console.php:38-39`).
- **A debris field on an empty position is never sent.** Debris is only looked up for occupied positions (GC:198-202). Position 17 (event planets, rendered by the JS) never appears.
- `planets` key order is planet, debris, moon. Select by `planetType`, not by index.

### 3.4 Planet, moon and debris entries

```jsonc
// planet (GC:184-196)
{ "activity": {"showMinutes":true,"idleTime":null,"showActivity":15} /* null if destroyed */,
  "availableMissions": [ …§3.7… ], "fleet": [] /* always empty */,
  "imageInformation": "dry_7" /* biome_type, CSS class of .microplanet */,
  "isDestroyed": false, "planetId": 61, "planetName": "Nova Prime", "playerId": 150, "planetType": 1 }
// moon (GC:267-283)
{ "activity": {…}, "availableMissions": [ … ], "fleet": [], "imageInformation": "moon_a" /* "moon_c" if destroyed */,
  "isDestroyed": false, "planetId": 78, "planetName": "Moon", "playerId": 233, "planetType": 3,
  "size": 7450, "tooltipInfo": {"diameter": 7450, "name": "Moon"} }
// debris (GC:217-249), also the pos-16 object
{ "planetId": 0, "planetName": "debris_field", "imageInformation": "debris_1",
  "availableMissions": [{"missionType": 8, "name": "Harvest"}],
  "requiredShips": 1 /* ceil(total / YOUR recycler capacity incl. hyperspace tech) */, "planetType": 2,
  "resources": {"metal":{"name":"Metal","amount":12400},"crystal":{"name":"Crystal","amount":7800},"deuterium":{"name":"Deuterium","amount":0}},
  "recyclePossible": true }
```

For position 16 the JS labels `requiredShips` as "Pathfinders needed" and sends `min(requiredShips, availablePathfinders)` pathfinders (bundle:35310). The value itself is computed with **recycler** capacity (`DebrisFieldService::calculateRequiredRecyclers`).

### 3.5 Player object (GC:474-596)

```jsonc
{
  "actions": {
    "alliance":  {"available": false}  // or, when in an alliance:
                 // {"available":true,"allianceId":12,"allianceTag":"NOVA","allianceName":"Nova Collective","memberCount":8,
                 //  "highscoreLink":"…/highscore?category=2&page=1","highscoreTitle":"3" /* string, "?" if unranked */,
                 //  "infoPageLink":"…/alliance","infoPageTitle":"Alliance Page","allianceClassName":null,"allianceClassCss":null,
                 //  "applicationLink":"…/alliance?alliance_id=12" | null, "applicationTitle":"Apply" | null}
    "buddies":   {"available": bool /* foreign && !admin */, "playerId", "link":"javascript:void(0);", "title", "playerName"},
    "ignore":    {"available": bool, "playerId", "link", "title", "playerName"},
    "support":   {"available": bool /* target is admin */, "playerId", "link", "title", "playerName"},
    "highscore": {"available": rank !== null, "rank": 5 /* general rank or null */, "title":"Ranking", "link":"…/highscore?category=1&page=1"},
    "message":   {"available": bool, "disabledChatBar": false, "title", "link", "playerId"}
  },
  "playerId": 150, "playerName": "Nova",
  "isAdmin": false, "isInactive": false, "isLongInactive": false, "isNewbie": false, "isStrong": true,
  "isOnVacation": false, "allianceId": 12, "allianceTag": "NOVA", "allianceName": "Nova Collective",
  "isAllianceMember": false /* same alliance as you */, "isBanned": false
}
```

Not sent: `isBuddy`, `isOutlaw`, `isHonorableTarget`, `rank.hasRank` and `selectedLanguageIcon`, although the JS reads them (it treats them as falsy). To detect buddies, use availableMission 5 (ACS Defend), which is only offered to buddies (GC:339-348). The admin `Legor` gets no Espionage/Attack missions (GC:314).

| Flag | Rule (source) | Note |
|---|---|---|
| `isAdmin` | user has role `admin` (PS:190-193) | |
| `isBanned` | `User::isBanned()` (PS:200-203) | |
| `isOnVacation` | `users.vacation_mode` (PS:1010-1013) | |
| `isInactive` | `users.time` ≥ **7 days** ago (PS:210-220) | `users.time` = time of the player's last HTTP request of any kind |
| `isLongInactive` | `users.time` ≥ **28 days** ago (PS:227-237) | `isInactive` is also true then |
| `isNewbie` | not inactive **and** target points < **20 %** of **your** points (PS:245-261) | Relative to you; an admin with 0 points is a "newbie" |
| `isStrong` | not inactive **and** target points > **5×** your points (PS:269-285) | |

Points are `highscores.general`, which the scheduler recomputes **every 5 minutes** (`routes/console.php:23-27`). Ranks are `general_rank` (NULL for unranked players and for admins hidden from the highscore).

**Bug, keep it in mind:** when the player has an alliance, `actions.highscore.link` uses the alliance's page number instead of the player's (GC:509 overwrites `$highscorePage`). Compute the page yourself: `Math.ceil(rank / 100)`.

### 3.6 Row `actions` (GC:380-466)

| Key | Meaning |
|---|---|
| `canEspionage` = `canSendProbes` | your current body has ≥ 1 probe and espionage tech > 0 |
| `canMissileAttack` | foreign planet, same galaxy, `|Δsystem| ≤ impulse*5-1` (PS:481-492); **0 missiles is allowed** |
| `missileAttackLink` | `…/overlay/galaxy/missile-attack?galaxy=&system=&position=&type=1`, or `…/galaxy` when not possible |
| `canPhalanx` / `phalanxActive` / `phalanxInactive` / `phalanxInactiveReason` | current body is a moon with phalanx, the target is a foreign non-admin **planet**, and it is in range `level²−1` (Discoverer +20 % is not applied here). Active if the moon has ≥ 5,000 deuterium (PhalanxService:52-110) |
| `canBuddyRequests` | foreign and not admin |
| `canBeIgnored`, `canWrite` | always `false` |
| `discoveryUnlocked` | constant locale string |

### 3.7 `availableMissions` on a planet or moon (GC:295-368)

The order is fixed:

1. `{missionType:3, link:"…/fleet?galaxy&system&position&type&mission=3", name}` (always).
2. Foreign and not Legor: `{missionType:6, canSpy:true, reportId:"", reportLink:"", link:"…/ajax/fleet/dispatch/send-fleet?…&mission=6&am210=1", name}` and `{missionType:1, link, name}`.
3. Buddy: `{missionType:5, …}`.
4. Foreign moon: `{missionType:10, …}`. **10 here is "moon destruction" in the link, but mission type 10 is Missile Attack elsewhere in OgameX. Moon destruction is mission 9 (`fleet.md`).**
5. Own body: `{missionType:4, …}` (deploy).

`reportId` is always empty: OgameX never links the last espionage report from the galaxy.

## 4. How the game JS renders a system (bundle:34800-35920)

### 4.1 Request/render cycle

`loadContentNew(g, s)` (bundle:35986-36013) shows `#galaxyLoading`, sets the inputs and, **only if `inProgress === false`**, sets `inProgress = true` and calls `$.post(galaxyContentLink, {galaxy, system, _token: token}, renderContentGalaxy)`. `renderContentGalaxy(json)` (34800-34906) then:

1. fills `#amountColonized`, `#probeValue`, `#recyclerValue`, `#missileValue`, `#slotUsed` and `#slotValue`, and sets the inputs;
2. for each row: `clearPosition(pos)` (35895-35916) empties all 7 cells and removes the filter classes, then adds `positionFilters` as a class on `#galaxyRowN`;
3. for each planet entry it calls `renderPlanet`/`renderDebris`/`renderMoon` by `planetType`, then `renderPlayer`, `renderPhalanx`, `renderAlliance` and `renderActions`. Empty rows get `renderEmptySlot`;
4. hides `#galaxyLoading` and sets `inProgress = false`.

The row containers `#galaxyRow1..15` are never recreated, only their cells' `innerHTML`. Your injected nodes inside cells are wiped on every navigation, but nodes appended **after** the cells (direct children of `#galaxyRowN`) survive. Remove those yourself.

### 4.2 Rendered cell markup (verified live, `galaxy-rendered-1-42.html`)

| Cell | Markup after render |
|---|---|
| `.cellPlanet` | `a[onclick="sendShips(6,g,s,p,1,3);return false;"] > div.microplanet.<imageInformation>.planetTooltip.tooltipRel…[data-planet-id=<id>][rel=planet<pos>]`. Children: the activity div (§5), `div#ownFleetStatus_<pos>_1.fleetAction` and the tooltip `div#planet<pos>.htmlTooltip.galaxyTooltip` (coords `[g:s:p]`, an activity `<li>`, mission links) |
| `.cellPlanetName` | `span` (planet name; class `status_abbr_buddy` never set), then a phalanx link `a.phalanxlink > div.phalanxActive` or `div.phalanxInctive[title]` |
| `.cellMoon` | `a > div.micromoon.moon_a[data-moon-id=<id>][rel=moon<pos>]` with the activity div and tooltip `#moon<pos>` (`#moonsize` "7450 km") |
| `.cellDebris` | `a > div.microdebris.debris_1[rel=debris<pos>]` with tooltip `#debris<pos>`: `li.debris-content` ×3 ("Metal: 12,400"), `li.debris-recyclers`, harvest link `sendShips(8,…)` |
| `.cellPlayerName` | foreign: `span.playerName.tooltipRel.<colorClass>[rel=player<id>]` (text = name) + tooltip `div#player<id>` (`li.rank > a` rank, `.sendMail.js_openChat[data-playerid]`, `.sendBuddyRequestLink[data-playerid][data-playername]`, `.ignorePlayerLink`). Own: `span.<colorClass>.ownPlayerRow`. Then `<pre> (<span class="status_abbr_X">letter</span>,…)</pre>` |
| `.cellAlliance` | `span[rel=alliance<id>]` (class `status_abbr_ally_own` if same alliance) with text = tag + tooltip `div#alliance<id>` (rank link, members, `/alliance/info/<id>` link, Apply link) |
| `.cellAction` | foreign: `a.espionage > span.icon_eye` (`.grayscale` if no probes), `a.sendMail.js_openChat > span.icon_chat`, `a.buddyrequest[data-playerid][data-playername] > span.icon_user`, `a.missleattack[.overlay] > span.icon_missile[.grayscale]`. Admin: `.emptyAction` placeholders and support link. Own: 4× `div.emptyAction`. Empty slot: `.colonize-inactive`/`a.colonize-active` and `.planetMoveDefault`/`.planetMoveInactive` |

Colour class (`getPlayerColorClass`, bundle:35042-35073), first match wins: `status_abbr_admin` > `_banned` > `_vacation` > `_longinactive` > `_inactive` > `_outlaw` > `_noob` > `_strong` > `_honorableTarget`, else `status_abbr_active`. Status letters (`getPlayerAbbreviations`, 35075-35111): `A` (admin, exclusive), `b`, `v`, `I` or `i`, `n`, `s` (English locale letters from `t_ingame.galaxy.status_*_abbr`; they are localized, so match the classes, not the letters).

### 4.3 Serialized vs live DOM

The game appends tooltip HTML that contains `<a>` into an element that is already inside `<a>`. The live DOM therefore has nested anchors. **Re-parsing the serialized `galaxy-rendered-*.html` with an HTML parser restructures it** (the outer `<a>` gets closed). Use those files for reading. Test content scripts against the live render: `galaxy-page.html` + the bundle + routed AJAX, as in `render_galaxy.js` and `check_galaxy.js`.

Tipped (`initTooltips`) removes `title` attributes once the page is ready (layout.md §4.2). Do not parse `title`.

### 4.4 Where to inject UI

| Purpose | Where | Note |
|---|---|---|
| System-level buttons ("scan range", "stalk system") | append to `#galaxyHeader .systembuttons` | static, survives navigation |
| Counters / summary | `#galaxyContent .ctGalaxyHead .galaxyCell.span11` (append a `div`) or `#galaxyContent .ctGalaxyFooter` | static |
| Per-row buttons (target list, colour mark, note) | append to `#galaxyRow<N> .cellAction` or after `.cellPlayerName pre` | **re-apply after every render** |
| Row highlight | add a class to `#galaxyRow<N>` | the game removes only its own filter classes, so remove yours on re-render |
| Status messages | `#fleetstatusrow` | the game does not write to it on the desktop path |

Re-render trigger: listen for the XHR hook event (§11.2), which fires after the game's render, or observe `#galaxyLoading` going to `display: none`. A `MutationObserver` on `#galaxyContent` (`childList, subtree`) also works but fires ~100 times per render, so debounce it.

### 4.5 Rendering crash on destroyed bodies (verified)

For a destroyed planet `activity` is `null`. `renderPlanet → getActivityStar(null)` then throws `TypeError: Cannot read properties of null (reading 'showActivity')` (bundle:35123), and so does `getActivityElement`. A destroyed moon behaves the same way. The loop aborts, and the consequences are:

- rows after the destroyed one are **not cleared** and keep the **previous system's content**;
- `#galaxyLoading` stays visible, and `inProgress` stays `true`, so **every further `loadContentNew` is ignored** until the page is reloaded (`galaxy-rendered-1-45.html`; reproduced in Chromium).

Consequences for the extensions:

1. Never read galaxy data from the DOM. Use the JSON (hook or own request).
2. Optionally repair the page from the MAIN world after detecting the error: `window.inProgress = false; $('#galaxyLoading').hide();` and draw the missing rows yourself. This is an OgameX bug, so report it upstream rather than relying on it staying.

## 5. Activity: what `*` and minutes mean

Server side (GC:801-821) uses `PlanetService::getMinutesSinceLastUpdate()` = whole minutes since `planets.time_last_update` (PlS:1370-1384):

| Minutes since last update | `activity` JSON | Game DOM | Normalised (§11) |
|---|---|---|---|
| 0-14 | `{"showMinutes":true,"idleTime":null,"showActivity":15}` | `div.activity.minute15` (red star) | `'*'` |
| 15-60 (60 inclusive) | `{"showMinutes":true,"idleTime":37,"showActivity":60}` | `div.activity.showMinutes` with text `37` | `37` |
| > 60 | `{"showMinutes":true,"idleTime":null,"showActivity":false}` | no activity div | `null` |
| destroyed body | `null` | (render crash, §4.5) | `null` |

`showMinutes` is always `true` (the player option is not implemented, GC:806). The planet tooltip adds `<li>Activity: 37 min</li>` or `<li>Activity:<div class="alert_triangle">…</div></li>` (bundle:35874-35893).

**What sets `time_last_update` (= activity):**

- the owner loading **any** page or AJAX call while that planet/moon is their *current* body (`GlobalGame:58` → `PlanetService::update()` → `updateResourcesUntil`, PlS:1318, 1420-1485). Planet and moon have **separate** timestamps;
- the arrival of **Espionage, Attack, Missile Attack or Moon Destruction** at that body, by **anyone** (`EspionageMission.php:110`, `AttackMission.php:110`, `MissileMission.php:155,178`, `MoonDestructionMission.php:130` call `->update()` on the target). **Your own probes therefore make the target show `*`**, unlike official OGame. A stalker must ignore activity shortly after its own espionage/attack landed;
- your own galaxy scan sets **your** current planet's activity to `*` and your `users.time` (the middleware runs on every request).

Transports, deployments, harvests and expeditions arriving at a planet do **not** touch `time_last_update`.

The player-level "online" signal is separate: `users.time` (any request) drives `isInactive`/`isLongInactive` (days) and `User::isOnline()` (≤ 900 s, `app/Models/User.php:179-191`). The latter is exposed only for buddies and alliance members (§9).

**Differences from official OGame.** Official shows `*` for < 15 min and minutes 15-59; OgameX shows minutes up to 60 inclusive. Official activity is per body and caused by owner actions; OgameX also triggers it with hostile missions, including espionage.

## 6. Highscore

### 6.1 Request

`POST /ajax/highscore?category=<1|2>&type=<0-3>&page=<n>` (the game sends the parameters in the **query string** with an empty body and the CSRF header; `ajaxCall` bundle:28794-28812, `initHighscore` bundle:20930-20990). Form fields work too (`$request->input()` merges both). There is **no GET route** for `/ajax/highscore` (GET → 405).

| Param | Values (HC:42-75, `app/Enums/HighscoreTypeEnum.php`) |
|---|---|
| `category` | `1` players (default), anything else alliances (`2`) |
| `type` | `0` general (points), `1` economy, `2` research, `3` military. **4-7 (the military sub-buttons built/destroyed/lost/honour, hi:69-86) are not implemented: `HighscoreTypeEnum::cases()[4]` → HTTP 500.** |
| `page` | 1-based, 100 rows per page. Omitted → the page of your own **general** rank: `floor(rank/100)+1` (off by one: rank 100 → page 2) |
| `searchRelId` | player id (category 1) or alliance id (category 2): jump to that page (always by **general** rank, HC:80-85, 144-148) |

The response is the HTML fragment `ingame.highscore.players_points` or `alliance_points`. It contains `<script>` blocks, which DOMParser does not execute. Data is cached for 5 minutes per type and page (`HS:313`, `HS:431`) and recomputed by the scheduler every 5 minutes.

Points (`HS:189-264`): general = buildings + units on planets + research + ships in flight (`sum(cost)/1000`). Economy and military follow `HS:112-180`. Only players with all four ranks > 0 are listed (`Highscore::scopeValidRanks`). Admins are listed only when `highscore_admin_visible` is set.

### 6.2 Player rows (hp:48-136)

```
script: var currentCategory = 1; var currentType = T; var searchPosition = <myId>; var site = <page>; var searchSite; var resultsPerPage = 100; var searchRelId = <myId>;
.pagebar (top + bottom), select.changeSite > option (first = "Own position" → my page, then one per page: "1 - 100", …)
#highscoreHeadline
table#ranks.userHighscore > tbody > tr#position<playerId>[.myrank|.alt]
   td.position            "37"
   td.movement            always the "stay" icon (no rank history)
   td.name  .highscoreNameHolder > [span.ally-tag > a[href=…/alliance/info/<aid>] "[TAG]"]
                                  a[href=…/galaxy?galaxy=G&system=S&position=P]   ← coordinates of the player's FIRST planet
                                    > span.playername[.status_abbr_admin] "Name"
            .honorScore > span "0" (always 0)
   td.sendmsg  a.sendMail.js_openChat[data-playerid]; a.sendBuddyRequest[data-playerid][data-playername] (not for self/admin)
   td.score    "48,213"  (type 3: span.tooltip[title="Total ships: 1,234"] around the number)
```

`tr.id` gives the **player id** and the galaxy link gives the home coordinates. Together with `/ajax/galaxy` this is the full player directory. 214 players means 3 requests per type.

### 6.3 Alliance rows (ha:49-102)

```
table#ranks.allyHighscore > tbody > tr#position<allianceId>[.myrank][.alt]
   td.position "3"; td.movement (stay icon)
   td.name > .ally-name > span "Nova Collective" ; .ally-tag > a.txt_link[href=…/alliance/info/12] "[NOVA]"
   td.member_count "8"
   td.score "2,154,300" <div class="small">ø269,288</div>
```

An empty list renders one `tr > td[colspan=5]` "no alliances". There are no `tr#position…` rows then.

## 7. Search: `/overlay/search` + `POST /ajax/search` (SC, so)

The overlay is a plain fragment: `form#searchForm > input#searchText[name=searchtext]` plus tabs `.searchTabs .tab[data-category=2|4|3]` and the result area `.ajaxContent`. The inline JS posts `{searchtext, category, _token}` (so:117-124) and renders `table.searchresults`.

| Category | Query (SC) | Result item |
|---|---|---|
| `2` players (default) | `users.username LIKE %term%`, limit 50 (SC:63-79) | `{"id":233,"name":"Raider42","type":"player"}`, with **no** rank, coordinates or alliance |
| `3` planets | `planets.planet_name LIKE %term%`, `planet_type = 1`, limit 50 (SC:87-106) | `{"id":77,"name":null,"coordinates":"[1:45:6]","owner_id":233,"type":"planet"}`. **`name` is always `null`** (it reads `$planet->name`, which is not a column). Destroyed planets are included. |
| `4` alliances | name **or** tag LIKE, limit 50 (SC:114-138) | `{"id":12,"name":"Nova Collective","tag":"NOVA","member_count":8,"rank":3 /* or "?" */,"points":2154300,"is_open":true,"type":"alliance"}` |

Envelope: `{"status":"success","results":[…],"category":2}`. An empty term gives `{"status":"error","message":"No search term entered","results":[]}` (HTTP 200). `%` and `_` in the term are SQL wildcards and are not escaped. Admins are included in player results.

Player info needs three calls: search (id/name) → highscore `searchRelId=<id>` (rank, points, home coordinates) → `/ajax/galaxy` of the home system (flags, activity, alliance).

## 8. Player and alliance "overlays"

OgameX has no player-info overlay. The player card is the galaxy tooltip `#player<id>` (§4.2) built from the JSON. The alliance card is the tooltip `#alliance<id>`. Its "Alliance Page" link goes to `GET /alliance/info/<id>`, which opens in a new tab (`target="_blank"`) as a stand-alone HTML document (`resources/views/ingame/alliance/info.blade.php`; `galaxy-alliance-info.html`). It shows a table with tag, name, member count, rank ("-" when unranked), the external text (BBCode, parsed client-side), the homepage and an Apply button. It contains **no member list**: OgameX has no public alliance member list.

## 9. Buddies

| What | Detail |
|---|---|
| Page `/buddies` | `#buddyRequests` (received `#tabs-reqReveived li.msg[data-msg-id]`, sent `#tabs-reqSent`), `.buddylistContent .online_count` "(1 / 1 online)", `table#buddylist > tbody.zebra > tr` (cells: index, `span.playerstatus.online|offline` + `.buddylist_playername`, points, rank link `highscore?searchRelId=<id>&category=1`, alliance always "-", home coords link `[g:s:p]`, actions `.sendMail[data-playerid]` and `span.deleteBuddy#<buddyUserId>`), ignored players table. The buddy **user id** is only in `.sendMail[data-playerid]` / `.deleteBuddy[id]`. |
| `POST /buddies` | `action` = 3 cancel, 4 reject, 5 accept (`id` = buddy_request id; JSON `{success,message}` with `ajax=1`), 9 list (HTML `tr`s), 10 delete (`id` = **user** id; with `ajax=1` returns the list HTML), 15 search (`search`; HTML `tr`s `<td>id</td><td>name</td>`) (BC:57-112) |
| `GET /buddies/online` | `{"success":true,"buddies":[{"id":150,"username":"Nova","isOnline":true,"hasActiveChat":true}],"count":1,"alliance":null|{id,name,tag},"allianceMembers":[{id,username,isOnline,hasActiveChat}],"recentPartners":[{id,username,isOnline}]}`. `isOnline` = last request ≤ 15 min. This is the only exact online signal, and only for buddies and alliance members (`recentPartners` online only if same alliance). |
| Buddy request | Dialog `GET /buddies/request-dialog?id=&name=` → `form#buddyRequestForm[action=…/buddies/send-request]` with `@csrf`, `receiver_id`, `textarea[name=message]`; `POST` → `{"success":true,"message":…,"request_id":59}` or 400 `{"success":false,"message":…}` (validation 422). |
| Ignore | `POST /buddies/ignore {ignored_user_id}` → **302 to /buddies**. The galaxy JS expects JSON, so it always shows the failure fadeBox (gi:902-935). Check success by reloading `/buddies`. |
| In galaxy data | buddies have mission 5 (ACS Defend) in `availableMissions`. `player.isBuddy` is never sent. |

## 10. Scanning many systems efficiently and politely

There is **no bulk endpoint**: one system per `POST /ajax/galaxy`, 15 positions each. A universe has `maxGalaxies × 499` systems (9 × 499 = 4,491 requests). Each request costs the server the full middleware (player row lock, current-planet update, fleet-mission processing). It then loads every planet in the system with its owner, highscore and alliance (several queries per occupied position). The server has no rate limit, so the extension must limit itself:

1. **Strictly sequential**: one request in flight, never `Promise.all`. Wait **≥ 700 ms + random 0-300 ms** between requests (≈ 1 system/s, so a whole universe takes ≈ 75 min). Stop at once on 401/419 (logged out / CSRF), 403 (vacation) or 5xx, or on 3 consecutive network errors. Back off ×2 on slow responses (> 2 s).
2. **Do not send `cp`.** Scans run against the current planet. The data you need (players, activity, debris, moons) does not depend on it.
3. **Cache per system** with a timestamp: key `"g:s"` → parsed snapshot (§11 `parseSystem`). Use per-purpose TTLs:
   - player directory / inactives: 24 h (inactive flags have day granularity; points change every 5 min but slowly);
   - debris search: 1 h;
   - stalking (activity): 5-10 min per tracked system. Activity has 1-minute resolution between 15 and 60 min, and `*` covers 0-14 min, so polling faster than every 5 min adds little. A 15-minute cadence with the minute value reconstructs the last-activity time to ±1 min whenever it is ≤ 60 min old.
4. **Order**: scan your own systems ±N first, then the rest. The ≈ 1 system/s pace is for scans the user starts and watches. Unattended background refreshes should stay at ≤ ~300 systems per hour. Pause the background scan while the user browses the galaxy page themselves (their requests also hit the server), and reuse their responses instead (item 7).
5. **Stalk only what you need.** Find the systems of a tracked player from earlier scans, from `/ajax/search` category 3 (`owner_id` + coordinates; planet names are null), or from the highscore home coordinates. Then re-scan only those systems. Record `activity` of planet and moon separately with `scannedAt` (server time, layout.md §8) to get `lastSeen ≈ scannedAt − idleTime·60 s` (or `scannedAt` for `*`).
6. **Discount self-caused activity**: for 15 min after one of your espionage, attack or missile missions arrives at a target body, its `*` is your own doing (§5).
7. **Piggyback**: when the user browses the galaxy, capture the game's own responses (§11.2) instead of fetching again.

Do not use the highscore for activity. It is cached, updated every 5 minutes and has no activity data.

## 11. Parsing recipes (verified by `ogx/tools/check_galaxy.js`)

### 11.1 Recipes (isolated world; DOMParser + fetch)

```js
const OGX_GALAXY = {};

/** POST helper for OgameX AJAX endpoints (same-origin, session cookie + CSRF). Returns {status, json|text}. */
OGX_GALAXY.post = async (pathAndQuery, params = {}) => {
  const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const body = new URLSearchParams({ ...params, _token: token });
  const res = await fetch(new URL(pathAndQuery, location.origin), {
    method: 'POST', credentials: 'same-origin', redirect: 'follow',
    headers: { 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  const type = res.headers.get('content-type') || '';
  // Logged out: Laravel redirects to /login (fetch follows -> HTML page, res.redirected = true). CSRF mismatch: 419.
  if (res.redirected && /\/login/.test(res.url)) return { status: 401, text: '' };
  return type.includes('json') ? { status: res.status, json: await res.json() } : { status: res.status, text: await res.text() };
};

/** activity object of /ajax/galaxy -> '*' (< 15 min), 15..60 (idle minutes), null (> 60 min or none) */
OGX_GALAXY.activity = (a) => {
  if (!a || a.showActivity === false) return null;
  if (a.showActivity === 15) return '*';
  if (a.showActivity === 60) return a.idleTime;
  return null;
};

/** OGame-style status letters from galaxy player flags. */
OGX_GALAXY.status = (p) => [
  p.isAdmin && 'A', p.isBanned && 'b', p.isOnVacation && 'v', p.isLongInactive ? 'I' : (p.isInactive && 'i'),
  p.isNewbie && 'n', p.isStrong && 's',
].filter(Boolean).join('');

const ogxDebris = (d) => d && { metal: d.resources.metal.amount, crystal: d.resources.crystal.amount,
  deuterium: d.resources.deuterium.amount, requiredShips: d.requiredShips };

/** POST /ajax/galaxy JSON -> {galaxy, system, positions:[...], colonized, me:{...}} (null on error). */
OGX_GALAXY.parseSystem = (json) => {
  if (!json || json.success !== true || !json.system) return null;
  const s = json.system;
  const out = { galaxy: +s.galaxy, system: +s.system, colonized: s.slotsColonized, positions: [], expeditionDebris: null,
    me: { playerId: s.playerId, currentPlanetId: s.currentPlanetId, probes: s.availableProbes, recyclers: s.availableRecyclers,
      pathfinders: s.availablePathfinders, missiles: s.availableMissiles, usedSlots: s.usedFleetSlots, maxSlots: s.maximumFleetSlots,
      canSystemPhalanx: s.canSystemPhalanx } };
  for (const row of s.galaxyContent) {
    if (row.position === 16) { out.expeditionDebris = ogxDebris(row.planets); continue; } // planets is an OBJECT here
    const list = Array.isArray(row.planets) ? row.planets : [];
    const planet = list.find((p) => p.planetType === 1);
    const debris = list.find((p) => p.planetType === 2);
    const moon = list.find((p) => p.planetType === 3);
    if (!planet) continue;                                   // empty slot (debris without a planet is never sent)
    const pl = row.player || {};
    const destroyed = !!planet.isDestroyed;
    out.positions.push({
      position: row.position,
      coords: row.galaxy + ':' + row.system + ':' + row.position,
      planetId: planet.planetId, planetName: planet.planetName, destroyed,
      activity: OGX_GALAXY.activity(planet.activity),
      moon: moon ? { id: moon.planetId, name: moon.planetName, size: moon.size, destroyed: !!moon.isDestroyed,
        activity: OGX_GALAXY.activity(moon.activity) } : null,
      debris: ogxDebris(debris),
      playerId: destroyed ? null : row.playerId, playerName: destroyed ? null : row.playerName,
      status: destroyed ? '' : OGX_GALAXY.status(pl),
      rank: pl.actions?.highscore?.rank ?? null,
      allianceId: pl.allianceId ?? null, allianceTag: pl.allianceTag ?? null, allianceName: pl.allianceName ?? null,
      missions: (planet.availableMissions || []).map((m) => m.missionType),
      canPhalanx: !!row.actions?.phalanxActive, canMissile: !!row.actions?.canMissileAttack,
    });
  }
  return out;
};

/** Rendered DOM row (#galaxyRow1..15 after the game's renderContentGalaxy) -> same essentials, or null if empty. */
OGX_GALAXY.parseRow = (rowEl) => {
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
  const debrisLis = [...rowEl.querySelectorAll('.cellDebris .debris-content')].map((li) => parseInt(li.textContent.replace(/\D/g, ''), 10));
  const status = [...rowEl.querySelectorAll('.cellPlayerName pre > span[class^="status_abbr_"]')].map((s) => s.className.match(/status_abbr_(\w+)/)[1]);
  return {
    position: pos,
    planetId: +planet.dataset.planetId,
    planetName: rowEl.querySelector('.cellPlanetName > span')?.textContent.trim() ?? null,
    activity: act(planet),
    moonId: moonEl ? +moonEl.dataset.moonId : null,
    moonActivity: act(moonEl),
    playerId: nameEl ? +nameEl.getAttribute('rel').slice(6) : null,
    playerName: nameEl ? nameEl.firstChild.textContent.trim() : (own ? own.textContent.trim() : null),
    own: !!own,
    status,
    allianceId: ally ? +ally.getAttribute('rel').slice(8) : null,
    allianceTag: ally ? ally.firstChild.textContent.trim() : null,
    debris: debrisLis.length ? { metal: debrisLis[0], crystal: debrisLis[1], deuterium: debrisLis[2] } : null,
  };
};

/** POST /ajax/highscore?category=1 HTML fragment (or the /highscore page) -> players */
OGX_GALAXY.parseHighscorePlayers = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const type = +(/var currentType = (\d+);/.exec(html) || [])[1];
  const page = +(/var site = (\d+);/.exec(html) || [])[1];
  const rows = [...doc.querySelectorAll('#ranks.userHighscore > tbody > tr[id^="position"]')].map((tr) => {
    const a = tr.querySelector('.highscoreNameHolder a[href*="/galaxy"]');
    const q = new URL(a.getAttribute('href'), 'http://x').searchParams;
    const ally = tr.querySelector('.ally-tag a');
    const ships = tr.querySelector('td.score span[title]');
    return {
      id: +tr.id.slice(8),
      rank: +tr.querySelector('td.position').textContent.trim(),
      name: tr.querySelector('.playername').textContent.trim(),
      me: tr.classList.contains('myrank'),
      admin: !!tr.querySelector('.playername.status_abbr_admin'),
      homeCoords: q.get('galaxy') + ':' + q.get('system') + ':' + q.get('position'),
      allianceId: ally ? +(/\/alliance\/info\/(\d+)/.exec(ally.getAttribute('href')) || [])[1] : null,
      allianceTag: ally ? ally.textContent.trim().replace(/^\[|\]$/g, '') : null,
      points: parseInt(tr.querySelector('td.score').textContent.replace(/[^\d]/g, ''), 10),
      totalShips: ships ? parseInt(ships.getAttribute('title').split(':').pop().replace(/[^\d]/g, ''), 10) : null,
    };
  });
  const pages = doc.querySelectorAll('select.changeSite option').length - 1; // first option = "own position"
  return { category: 1, type, page, pages, rows };
};

/** POST /ajax/highscore?category=2 HTML fragment -> alliances */
OGX_GALAXY.parseHighscoreAlliances = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('#ranks.allyHighscore > tbody > tr[id^="position"]')].map((tr) => ({
    id: +tr.id.slice(8),
    rank: +tr.querySelector('td.position').textContent.trim(),
    name: tr.querySelector('.ally-name span').textContent.trim(),
    tag: tr.querySelector('.ally-tag a').textContent.trim().replace(/^\[|\]$/g, ''),
    members: +tr.querySelector('td.member_count').textContent.trim(),
    points: parseInt(tr.querySelector('td.score').firstChild.textContent.replace(/[^\d]/g, ''), 10),
    average: parseInt(tr.querySelector('td.score .small').textContent.replace(/[^\d]/g, ''), 10),
  }));
  return { category: 2, type: +(/var currentType = (\d+);/.exec(html) || [])[1], rows };
};

/**
 * Polite sequential galaxy scanner. One request in flight, fixed delay + jitter, stops on auth/CSRF/vacation errors.
 * systems: array of [galaxy, system]. onSystem(parsed) is called per system. Returns {done, stoppedBy}.
 */
OGX_GALAXY.scan = async (systems, { delayMs = 700, jitterMs = 300, onSystem = () => {}, signal } = {}) => {
  let done = 0;
  for (const [g, s] of systems) {
    if (signal?.aborted) return { done, stoppedBy: 'abort' };
    let r;
    try { r = await OGX_GALAXY.post('/ajax/galaxy', { galaxy: g, system: s }); } catch (e) { return { done, stoppedBy: 'network' }; }
    if (r.status === 403) return { done, stoppedBy: 'vacation' };
    if (r.status === 401 || r.status === 419) return { done, stoppedBy: 'auth' };
    if (r.status !== 200 || !r.json) return { done, stoppedBy: 'http' + r.status };
    onSystem(OGX_GALAXY.parseSystem(r.json));
    done++;
    await new Promise((ok) => setTimeout(ok, delayMs + Math.random() * jitterMs));
  }
  return { done, stoppedBy: null };
};
```

Expected outputs are in `galaxy-expected-parse.json`. For 1:42, `positions` gives `[4,'*','s'] [6,null,'i'] [8,'*',''] [11,null,'vI'] [13,37,'n']`, and pos 8 has `moon {id:5, activity:23}` and debris `{12400, 7800, 0, requiredShips:1}`. The highscore page gives `pages: 3`, and the own row is `{id:108, rank:37, homeCoords:'1:42:8', points:48213}`.

Firefox: content-script `fetch` is not same-origin there. Use `content.fetch` or `credentials: 'include'` (layout.md §7).

### 11.2 Capturing the game's own galaxy responses (MAIN world, `run_at: document_start`)

The first `loadContentNew` runs while the page is being parsed (gi:752), and `$.post` captures `renderContentGalaxy` by value. Patching that function therefore misses the first response. Wrap XHR before the bundle loads instead:

```js
// MAIN world (MV3 content_scripts "world": "MAIN", or an injected <script> at document_start)
(() => {
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) { this.__ogxUrl = String(url); return open.apply(this, arguments); };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (/\/ajax\/galaxy(\?|$)/.test(this.__ogxUrl || '')) {
      this.addEventListener('load', () => {
        try { document.dispatchEvent(new CustomEvent('ogx:galaxy', { detail: this.responseText })); } catch (e) {}
      });
    }
    return send.apply(this, arguments);
  };
})();
// isolated world:
document.addEventListener('ogx:galaxy', (e) => { const sys = OGX_GALAXY.parseSystem(JSON.parse(e.detail)); /* store, then re-inject row UI */ });
```

Verified in Chromium: the `load` listener fires **after** jQuery's success callback, so the rows are already rendered when the event arrives (unless the render crashed, §4.5). Pass a string in `detail`, because objects do not cross worlds in Firefox.

### 11.3 Other quick paths

| Want | Recipe |
|---|---|
| Current galaxy/system on the page | `#galaxy_input`.value / `#system_input`.value (updated on every load), or the last `ogx:galaxy` payload `system.galaxy/system` |
| Navigate the page programmatically | MAIN world: `loadContentNew(g, s)` (no-op while `inProgress`), or set the inputs and click `#galaxyHeader .btn_blue` |
| Number of galaxies | `maxGalaxies` (galaxy page) or `/overlay/server-settings` (layout.md §11); systems = 499 |
| My player id | `system.playerId` in the JSON, or `meta[name="ogame-player-id"]` (layout.md §3) |
| Espionage from your own button | `POST /ajax/fleet/dispatch/send-mini-fleet {mission:6, galaxy, system, position, type:1|3, shipCount, _token}` (`fleet.md` §5), same as `sendShips(6,…)` |
| Harvest debris | `send-mini-fleet {mission:8, …, type:2, shipCount: requiredShips}` |
| Home coordinates of every ranked player | `parseHighscorePlayers(...).rows[].homeCoords` (first planet by id) |

## 12. Differences from official OGame (porting checklist)

1. JSON only (`POST /ajax/galaxy`, path-based URL), no `?page=ingame&component=galaxy`, no XML API, no player-info overlay, no `galaxyContent` HTML.
2. `system.galaxy/system` are strings; rows are ints. Position 16 `planets` is an object, and only Discoverers get it.
3. Destroyed bodies send `activity: null` and crash the game's renderer (§4.5).
4. Activity is shown up to 60 min inclusive and is also caused by hostile espionage, attack and missile arrivals (§5).
5. `isNewbie`/`isStrong` are relative to *your* points (20 % / 500 %) and are never set for inactive players. There is no outlaw or honour system (`isOutlaw`/`isHonorableTarget` absent, honour always 0).
6. `isBuddy` is not sent. Buddies are recognisable only by mission 5.
7. The highscore is an HTML fragment via POST, cached 5 min, without rank movement. Sub-categories 4-7 give HTTP 500. The player id is in `tr#position<id>` and home coordinates are in the galaxy link.
8. Search returns `name: null` for planets and gives no coordinates for players.
9. `/buddies/ignore` returns a redirect, not JSON.
10. `spionageAmount` and `settingsProbeCount` are hard-coded to 3.
11. The `missionType: 10` link on foreign moons is labelled "moon destruction". The real moon destruction mission is 9, and 10 is Missile Attack.
12. Arrow keys navigate the galaxy, bound on `keyup` of `document.documentElement`.

## 13. Open points

- `isBanned` styling and the `b` letter come from `t_ingame.galaxy.status_banned_abbr`. No banned player is in the fixtures.
- `reservedPositions` with entries (pending planet relocation) is described from the code (GC:852-868) only; no fixture has it.
- The phalanx range ignores the Discoverer +20 % bonus in the galaxy flags (GC:404 passes no player id), while the scan endpoint may apply it. Check before trusting `phalanxActive` at the range edge.
- Real response times of `/ajax/galaxy` on a populated server are unknown. The 700 ms pacing is a conservative default; measure and adapt.
