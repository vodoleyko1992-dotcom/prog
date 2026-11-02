# Bot scenarios (WorldSpec, BOT_CONTRACT C7.1)

World mode of the GALAXYZ mock: `startGzServer({ world: '<name>' })` (tests/gz-server.js) builds a stateful `World`
(tests/gz-world.js, C7.2) from `<name>.json`; `tests/gz-bot-lib.js` `launchBot({ world })` wraps it for browser tests.
All scenarios use the account of the saved pages: player `vodoleyko1992` (id 4377), planets 254102..254105 at 2:68:5-8,
colony 254106 at 2:70:8, `gamespeed` 2000 unless the table says otherwise (flights take seconds), server clock start 2026-10-30 10:03:37 (UTC+2 wall),
seed 1 (every random draw — counter-espionage, expedition, battle seed, moon — is deterministic).

| file | what it sets up |
|---|---|
| basic.json | 5 own planets; inactive `Txemin` (2:68:10, id 301140), vacation `Severian` (2:68:12), strong `Jon Snow` with moon and alliance (2:69:4); debris 2:68:11 |
| botsave-attack.json | basic + moon 254110 on 2:68:5; Jon Snow attacks 254102 (hostile created at +20 s, flight 180 s) |
| botfarm-inactives.json | five inactive targets (i, iI, I) in 2:67-70 with different loot/defense and production |
| botdebris-residual.json | debris fields from 300 metal (residual) to 60 M (more than the recyclers carry); 100 × 209 + 5 × 219 |
| botbuild-two-planets.json | two planets only, fixed 30 s build/research and 1 s unit times, perHour + energy from the spec |
| botexpo-slots.json | astrophysics 9 (3 expedition slots), haltSpeed 2 (staytime option 1 = 0.5 h), first five expedition outcomes queued |
| botsave-save.json | botsave tests: botsave-attack at gamespeed 7 (the Aeternum fleet speed), no production (exact cargo), silo 3 with 10 interceptors + 5 IPM on 254102, unit time 1 s; hostiles added per test |
| botfarm-three.json | gamespeed 40: empty inactive 2:68:10, defended 2:68:13 (20 LF + 50 RL), inactive in vacation 2:68:12, Jon Snow active 2:69:4; home 254102 holds every ship (10 × 217 loot carriers, 5 × 219; the 202/203/209 there must never be picked) |
| botfarm-build.json | gamespeed 40, unit time 1 s: the empty inactive 2:68:10 (100 M / 60 M / 20 M) needs 3 × 217, home has 1 (+5 large cargos never used, +20 probes); research/shipyard meet the 217 requirements -> buildShips orders 217 |
| botdebris-battle.json | 300 × 219 on 254102 and 300 × 219 on its moon 254110 (+ the same counts of 209, never used), 20 × 217 (+ 200 heavy cargo, never used); residual field 1000 metal at 2:68:10 (pre-send possible), own field 30 G / 20 G at 2:68:7 (1000 × the 209-era size, same recycler counts) |
| botbuild-payback.json | two planets with ample energy/storage/fields, lab 8 + energy 12 (131-133 open), 600 s build/research times |
| botbuild-energy.json | energy deficit 600 on 254102, shipyard 4 -> solar satellites (built satellites raise the world energy) |
| botbuild-storage.json | metal at the storage cap on 254102 -> metal storage first |
| botbuild-fields.json | exactly one free field on 254102 -> terraformer |
| botbuild-lab.json | lab 4 (131-133 need 8) and a running world research: lab 31 must wait; research 40 s |
| botbuild-colony.json | colony 254103 without stock or production -> waiting step, reservation, published need |
| botbuild-tactic.json | build-up tactic: main 45/40/39 (lab 22, shipyard 14), colony 254103 28/23/22 with storages short of 12 h, fresh colony 254104, no 217 research; 600 s times |
| botexpo-dm.json | astrophysics 6 = 2 expedition slots, haltSpeed 2; probes and light cargo on 254102 |
| botexpo-cycle.json | 2 expedition slots, haltSpeed 100 (hold 36..216 s); outcomes resources, black hole, 250 DM, nothing |
| botexpo-colonize.json | 5 of 6 planets, one colony ship; 2:68:10 occupied, 2:68:9 free |
| day.json | tests/gz-bot-scenario.test.js: every module on, gamespeed 40, haltSpeed 100, build/research 120 s, 8 fleet / 2 expedition slots; farm targets 2:68:10 (empty), 2:68:13 (defended -> debris), 2:68:14 (grows 50 HF after the attack left -> recall), 2:68:12 (vacation); moon 254110 with 3 × 219 (+ 60 × 209 never used), 10 × 217 at home; 254104 with 100 LF is attacked by Jon Snow at noon |

Spec extensions beyond C7.1 (all optional): `universe.galaxyDeuteriumCost` (10), `universe.debrisMoon` (1 = a moon created by a battle erases the whole debris field [UPSTREAM MissionCaseAttack:380-386, install.sql debris_moon DEFAULT 1]; 0 keeps it), `universe.buildTimeSec` / `researchTimeSec` /
`unitTimeSec` (fixed times), `universe.ecoSpeed`, `bodies[].perHour` / `storage` / `energy` / `image` / `diameter`,
`others[].protection` (`'noob'|'strong'`), `others[].allyId|allyName|allyTag`, `others[].planets[].lastActivity` (minutes) /
`perHour`, top-level `debris: [{ coords, metal, crystal }]`, `expeditionOutcomes: [{ type: 'resources'|'darkMatter'|'ships'|
'nothing'|'blackHole'|'battle'|'time', amount?, res?, ships?, lossPct?, delaySec? }]`, `player.spyProbes`, `player.extraSlots`,
`player.bonusPct`, `player.storageFactor`. Energy: solar satellites (212) built after the start add 30817/797 energy each to the
production (`bodies[].energy` or the solar-plant estimate), the per-satellite output of the saved resources page [REAL]. Script commands (`script[].do` and `POST /__ogx/world {cmd, args}`): advance,
setSpeedup, addHostile, setVacation, setPlayerVacation, logout, login, captcha, setRes, setShips, setOther, setDebris,
setResearch, expeditionOutcome, message.

## Markup sources

The world pages are the REAL saved pages (`fixtures/galaxyz/pages`) with their dynamic parts regenerated in the same markup:
server time + `#clock`, `#planetSelector`, planet image/name, `#current_*` + `resourceTicker`, energy `t`, dark matter,
`var vacation`, `.new-msg-count`, `#countColonies`, `#planetList` items, the event box (`#messages_collapsed`: OvfleetContent +
first event + `.allFleetsEvent` copies, as on the saved overview), fleetTable (header counters, movement rows with recall forms,
ships with speed tooltips, bonus table), fleetStep1 (token, target, type select, info cells, `data = {...}`, own planets list),
fleetStep2 (mission radios, consumption, `data`), fleetStep3 success table, galaxy own-system rows (REAL style), building /
research / shipyard levels (buildings: `span.level[data-value]`; research.html: `a.detail_button[data-technology] span.level`), page=imperium (`table.empire` regenerated from the world's bodies and research, same section/row layout as the REAL imperium.html), message rows (`tr.message_head` + `tr.messages_body` of the REAL messages pages), spy report (REAL
`.spyRaport` markup of messages-spy.html, incl. the simulate link).

Markup that was never saved live and follows upstream 2Moons templates or synthetic fixtures — [UPSTREAM]:

| markup | template / source |
|---|---|
| foreign galaxy rows (planet tooltip with `doit(6,ID)`, player tooltip with rank/Buddy/Playercard, `galaxy-username-<flag>` + `galaxy-short` flags, debris tooltip with `doit(8,ID)`, action cell) | specs/galaxyz/fixtures/galaxy-live-synthetic-system.html (rows written in the live style from 2Moons `page.galaxy.default.tpl`) |
| galaxy moon cell (tooltip h1 `Moon NAME [coords]`, Diameter row, `doit(6,MOONID)`) and alliance cell (`span.galaxy-alliance`, `mode=info&id=`) | 2Moons `page.galaxy.default.tpl:110-140`, live style as in the synthetic fixture |
| `a.moonlink` in the planet list | 2Moons `main.navigation.tpl` (parser marks it [GUESS]); specs/galaxyz/fixtures/layout-live-synthetic-moon.html |
| hostile / holding / expedition / recycle event texts, `Dialog.PM(ID)`, foreign-fleet textForBlind | 2Moons `class.FlyingFleetsTable.php` + English `FLEET.php` (`cff_*` strings) |
| fleetStep2 staytime block (`<th>At Flying</th>`, `<select name="staytime">`, option text = hours) | 2Moons `page.fleetStep2.default.tpl:222-231`; specs/galaxyz/fixtures/fleet-live-synthetic-fleetStep2-expedition.html |
| fleetStep2/3 error pages (`table.table519` Info) | 2Moons `error.default.tpl` via `infoPage()` of gz-server.js |
| buildings / research queue box (`#buildlist`, `#progressbar[data-time]`, `#time`, cancel/remove forms, `span.timer[data-time]`) | 2Moons `page.buildings.default.tpl` / `page.research.default.tpl`; specs/galaxyz/fixtures/buildings-upstream-buildings.html |
| shipyard queue (`data = {"Queue":[[name,count,secs,id]],"b_hangar_id_plus":s,"pretty_time_b_hangar":...}`) | 2Moons `page.shipyard.default.tpl` |
| statistics page (`form#stats`, who/type/range selects, player rows with `Dialog.Playercard(ID, 'name')`, own row lime) | 2Moons `page.statistics.default.tpl` + `shared.statistics.playerTable.tpl`; specs/galaxyz/fixtures/galaxy-upstream-statistics-players.html |
| combat message (`.raportMessage`, raportWin/Lose/Draw, reportSteal/reportDebris) | 2Moons `MissionCaseAttack.class.php:395-476`; fixtures/galaxyz/upstream/messages-view-cat3.html |
| raport popup (`page=raport&raport=RID`, condensed: fleets before/after, result, losses, debris, moon chance) | 2Moons `shared.mission.raport.tpl` (condensed) |
| transport / deploy / return / colonisation / recycling / expedition message texts | 2Moons English `FLEET.php` (`sys_*`) and fixtures/galaxyz/upstream/messages-view-cat{4,5,15}.html |
| spy-detected message (`Room monitoring`) | 2Moons `MissionCaseSpy.class.php:163-188` |
| captcha page | mock only (no live sample): `table.table519` info + `form#captcha` |
| fleetAjax JSON `{slots, ships, code, mess}` codes 600-620 | 2Moons `ShowFleetAjaxPage.class.php` |
