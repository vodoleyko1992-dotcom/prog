# OgameX Suite «Бот» — design (v1)

> Contract amendments after the foundation integration: `specs/bot/BOT_CONTRACT.md` §C8 (v1.1).

Target: GALAXYZ 1.8 (2Moons fork), ogamex.eu/Aeternum: fleet speed ×7 (`data.gamespeed`), resources ×22000, storage ×5,
loot 50 %, debris 30 % fleet / 0 % defense, no deuterium in debris, 9 × 499, server zone UTC+2. Account vodoleyko1992,
5 planets (254102..254106; 2:68:5-8 + new colony). The suite 0.2.0 already runs live.

Binding interface text: **`specs/bot/BOT_CONTRACT.md`** (C1..C7). This document explains it and gives the algorithms,
the exact GALAXYZ requests and how each effect is verified. Tags: **[REAL]** = seen on saved live pages
(`fixtures/galaxyz/pages`), **[UPSTREAM file:line]** = upstream 2Moons only (`scratchpad/src/2Moons`), **[SPEC]** = from
`BOT_TBOT_IDEAS.md` (its «Поправки проверки» override its rule text), **[NEW]** = decided here.

Sources read: `BOT_REQUIREMENTS.md`, `bot-spec/BOT_TBOT_IDEAS.md` (all 7 sections + corrections), `raid_rules.json` (+ sim/),
`expedition_rules.json` (+ sim/), `ogamex_strategy_plan.json` (schema ogamex-strategy-plan/1), `specs/CORE_API.md` (incl. §22),
`specs/galaxyz/fleet.md`, upstream `calculateAttack.php`, `calculateSteal.php`, `MissionCaseAttack/Expedition/Spy/Recycling`,
`class.FleetFunctions.php`, `ShowFleetStep2/3Page.class.php`, `GeneralFunctions.php` (CheckNoobProtec).

---

## 0. Engine facts that change the requirements (re-derived for 2Moons/GALAXYZ)

| # | fact | source | consequence for the bot |
|---|---|---|---|
| F1 | Mission 8 (recycle) is offered only when the debris row is **not empty** at send time: `!(der_metal == 0 && der_crystal == 0)`; step 2 renders an error page for an empty field | [UPSTREAM FleetFunctions.php:417, ShowFleetStep2Page:58, Step3:253] | Recyclers can be sent **before** a battle only if the target already has debris. Requirement 3 («arrive 1–2 s after the battle») is met by (a) **pre-send** when a residual field exists, (b) **keep-residual**: our own harvests leave `botdebris.residual` units so the next raid can pre-send, (c) **post-battle** send at battle+1 s from the nearest origin otherwise (arrival = battle + flight). The panel says which mode was used. |
| F2 | Battle = 2Moons aggregate model (per element type: total attack × rand(80..120)%, damage spread by share, losses `amount·min(dmg/hull·rand(0..200)%,1)` capped by `max_removePoints`), 6 rounds, hull = (M+C)/10 × (1+0.1·armour 111), shield × (1+0.1·shielding 110), attack × (1+0.1·weapons 109); no per-unit shots, no bounce, no explosion chance | [UPSTREAM calculateAttack.php:28-313] | The OgameX studies (raid_rules escort tables) are only start points. `OGX.botSim` reimplements upstream exactly (§4) and is checked against the PHP source with injected random numbers. |
| F3 | Loot only if `won === 'a'` (draw = 0); 5-step calculateSteal with capacity of the **surviving** fleet × (1+ShipStorage) minus carried cargo; defender keeps the rest | [UPSTREAM MissionCaseAttack:317, calculateSteal.php] | Cargo is sized with `minCapacityForLoot` (bisection over steal()), +`surplusPct`, after sim survivors. M = D example: capacity = sum of halves only takes 11/12. |
| F4 | Debris = 30 % of lost ships' M+C of both sides + `Defs_Cdr` % of defense lost **after** rebuild (rand(56..84)% rebuilt); deuterium never; moon chance `min(round(debris/100000·moon_factor), moon_chance)` | [UPSTREAM calculateAttack.php:280-311, MissionCaseAttack:341-351] | `debris_field_deuterium_on` does not exist in 2Moons; on Aeternum the defense share is 0 %. |
| F5 | Expedition (mission 15, position max_planets+1): event `mt_rand(1,9)`: 1 resources, 2 DM, 3 ships, 4 battle, 5 **black hole (whole fleet lost)**, 6 time change, 7–9 nothing. Resource find = `round(min(freeCargo, min(maxFactor, max(200, factor)) · fleetPoints))` = **min(free base cargo, Σ(M+C) of the fleet)** (factor ≤ 200, maxFactor ≥ 2400); resource metal 1/2, crystal 1/3, deuterium 1/6; free cargo = Σ pricelist capacity (no ShipStorage) − cargo on board. DM find 100..3000 regardless of fleet. | [UPSTREAM MissionCaseExpedition.php:36-140, 205-250, 383-388] | `expedition_rules.json` (1.5 × M_eff, top-1 table, Pathfinder) is wrong here and is **not** used. On ×22000 the resource find is negligible (≤ Σ(M+C) of the fleet per 9 trips) while 1/9 of trips lose the fleet: EV of a cargo expedition ≈ (find − fleet value)/9 ≈ 0. The value is **DM** and found ships. Default mode `dm`: smallest expendable fleet (1 probe or 1 small cargo) per slot (§9). |
| F6 | Expedition stay: `staytime` key 1..L124, hours = round(key / halt_speed, 2); Hold (5) {1,2,4,8,12,16,32}; DM mission (11) {1} | [UPSTREAM FleetFunctions:183-190, Step3:348-358; SPEC §1 correction] | Read the `<select name=staytime>` option texts on step 2 (hours) instead of assuming halt_speed = 1. |
| F7 | Spy: n = probes × (1+SpyPower); MinAmount = ±(Δspy·factor)² (− when we are better); fleet ≥ MinAmount, defense ≥ MinAmount+1, buildings +3, research +5 (×SPY_VIEW_FACTOR); counter-espionage chance mt_rand(0, min(n/4·(their/ours),100)) vs mt_rand(0,100); the report is sent **always**, probes may die afterwards (debris 30 % of probe cost) | [UPSTREAM MissionCaseSpy.php:75-205] | Probe count from the formula (C4 `spyNeeded`), not ×3/×9 escalation. «No report» ≠ «probes lost». Lost probes leave a small debris field (useful for F1: it enables pre-sending recyclers). |
| F8 | Inactive targets have no noob/strong protection (`onlinetime < now − INACTIVE` returns no protection); INACTIVE = 7 d, INACTIVE_LONG = 28 d; galaxy shows «(i)» / «(i I)» | [UPSTREAM GeneralFunctions.php:271-300, constants.php:70-73; SPEC §3] | Target filter = inactive class on the galaxy row, not vacation (`v`), not banned (`b`), not admin. |
| F9 | Recall: return time = `now + (now − start)`; Hold while holding: `now + (fleet_start_time − start)`; refused when already returning | [UPSTREAM FleetFunctions:298-384] | Recall must happen strictly before arrival (else the mission executes). Fleetsave recall at one-way/2 lands home after ≈ one-way. |
| F10 | Step 3 refuses (info page) instead of trimming: no slots, not enough deuterium, `metal+crystal+deut > fleetroom − consumption` (fl_not_enough_space), vacation target, bash, admin, noob/strong, mission not offered | [UPSTREAM Step3:44-375] | The bot computes cargo exactly (`data.fleetroom` − consumption); every refusal text is journaled and mapped to a reason. |
| F11 | `fleetAjax` spy/recycle needs the target **planet id** (spy reports and messages have none [REAL]); always 100 %, server-chosen count, 219 first for mission 8 (one 219 per field) | [UPSTREAM ShowFleetAjaxPage:38-219; fleet.md §3.3] | Main path = 3-step dispatch with coordinates. fleetAjax only when the id is known (`api.resolvePlanetId` cache) and `botfarm.useFleetAjax`. |
| F12 | Every galaxy view costs deuterium; listing a message category marks it read; every GET is a full page that marks the account online | [REAL; CORE_API §22] | Galaxy scanning is opt-in with a per-hour budget (`botcore.galaxyViewsPerHour`, default 0). Message reads need `botcore.readMessages`. No polling: the runtime reads data the pages already carry. |
| F13 | Plasma (122) does not raise production; 131/132/133 give +2 %/level of the mine part; storage ×5; satellites by temp_max; energy × (1 + Energy factor) | [UPSTREAM PlanetRessUpdate:291-302; SPEC §7] | `w_plasma` of the strategy plan is applied to 131–133. Crawlers, classes, Pathfinder: not on this server. |
| F14 | Slots: fleet `1 + 108 + FleetSlots` (Commander 611 +3/level on GALAXYZ per core), expeditions `floor(sqrt(124))`; GALAXYZ third counter «Asteroids 0/5» (probably mission 11, max_dm_missions=5) | [REAL fleetTable; UPSTREAM] | Slots only from page=fleetTable (C2.5). |
| F15 | The fleet session token lives 600 s from step 1 and binds the current planet; `cp` is sticky for the whole session | [UPSTREAM Step1:65, Step3:44-54] | One executor; the user's own fleetStep pages pause the bot (C3.7); pre-posting steps 1–2 enables second-precise step 3 (C3.4). |
| F16 | The step-2 mission list is a free probe: empty position → [7] (with 208), empty debris → error page, own body → [3,4], foreign → [3,6?,1,5] | [UPSTREAM FleetFunctions:408-452] | `probe.target` (C2.4) answers «is this position empty / does this field have debris» without a galaxy view (no deuterium). Used by colonization and recycler pre-send. |

Porting-guide exception (CORE_API §22 «nothing changes game state without an explicit user click»): the bot executor is the
**only** code allowed to act without a click per action, and only when the user turned on `botcore.master`, the module's `on`,
and turned off `botcore.dryRun` in the «Бот» panel. Modules never call `fleet.send` (it confirms) or `fleet.gz.*` fillers; the
executor calls `fleet.gz.step1/step2/step3` (forms exactly like the game), `api.recall`, `api.addBuild(…, { confirm: false })`,
`api.sendMiniFleet`, `galaxy.fetch(…, { userStarted: true })` and `messages.fetchList`.

---

## 1. Architecture

```
game tab(s) ──content scripts── core (OGX) ──┬─ botcore (runtime: leader, scheduler, queue+executor, timers, threats, registries)
                                              ├─ botsim  (pure library)
                                              ├─ botpanel (UI «Бот» in the suite side panel)
                                              └─ botsave · botfarm · botdebris · botbuild · botexpo  (workers)
storage (chrome.storage.local, player scope): settings, botcore.* (queue, timers, registries, status, limits), <module>.*
journal (IndexedDB via OGX.diag): every decision and action (B events) -> «Логи для разбора»
```

### 1.1 Runtime in a game tab
* The bot runs **only while at least one game tab is open** and logged in. There is no background-page automation (the manifest
  keeps `permissions: ["storage"]`; no alarms/offscreen/notifications). The panel and README-RU say so: «Бот работает, пока открыта
  вкладка с игрой. Закреплённая вкладка в отдельном окне — лучший вариант; отключите «Экономию памяти» для ogamex.eu».
* Page lifecycle: `freeze` → journal `botcore:frozen`, `resume` → `botcore:resumed` + re-plan (missed precise timers → `timer-late`,
  the module decides). `pagehide` releases the leader lock and marks a running action `uncertain`.

### 1.2 Leader election
* `OGX.storage.lock('bot.leader', 15000)`, `refresh()` every 5 s from the worker clock (not the core tick, which stops while hidden).
* Candidates: every game tab with `botcore.master` true. A visible tab that is not leader writes `botcore.leaderWant = { tab, t }`;
  a hidden leader with `botcore.runHidden` true keeps leading unless such a want is < 10 s old, then releases after the running action.
  With `runHidden` false a hidden leader releases immediately.
* Status (`botcore.status`, single writer = leader) is mirrored to all tabs through `storage.subscribe` → `OGX.bot.onStatus`.

### 1.3 Scheduler (workers)
* `OGX.bot.register(WorkerDef)`; each worker has `nextAt`; the leader's loop sleeps on the worker clock until `min(nextAt)`.
* Start (master on, wake from sleep, settings change, leader change): every worker's first run = now + `randMs(startJitter)`
  (defaults per prio: defense 5–15 s, build 5–15 s, deadline/fleet 20–50 s, farm 40–140 s) and a global 5–15 s pause before the
  first action [SPEC §1].
* `RunResult.nextAt/nextInMs`, `handle.wake(reason, atMs)`, and `wakeOn` bus events set `nextAt = min(...)`.
* Fleet-return wake [SPEC §1]: the runtime emits `bot:fleet-returned { fleetId, mission, body }` when an own flight from the stored list
  passes its return time (or vanished from a fresher list); modules waiting for ships/slots return `nextAt = minReturn + 20..50 s`
  (`Math.min` over `data-fleet-end-time` of all rows, not the first row [SPEC §1 correction]).
* Workers run concurrently, one run per worker at a time (BOT_CONTRACT C8 A1); the executor alone serializes requests.
* A worker exception = error for the backoff; the worker is rescheduled (never dies silently [SPEC §1 correction]).
* Settings change: wait for the running action, apply, re-check sleep, restart workers with jitter (events collapsed within 2 s).

### 1.4 Single action queue + executor
* Persisted queue `botcore.queue` (max 200 entries); an entry = ActionSpec + `{ id, state, created, tries }`.
* Order: `precise` entries at their time first; then prio defense(0) > deadline(1) > fleet(2) > build(3) > read(4); FIFO.
* Gap: random `minGapMs..maxGapMs` between two requests (the 3 steps of one send are 3 requests with gaps of 300–900 ms).
* Gates before a mutating request, in order: stopped/paused → leader → dry-run → limits (rolling 60 min counters) → user-first
  (C3.7, only non-defense/deadline) → sleep (C3.5, unless allowDuringSleep module + force) → threat lock (C2.6) → slots (fleet.send)
  → ships/fuel/cargo on fresh data.
* After the queue drains for 3 s: `cp` restore to the leader tab's current body with `GET page=overview&cp=<id>` (journal `cp-restore`).
* Every request's answer is checked for stop conditions (C3.6) before parsing.

### 1.5 Precise timer
* `OGX.bot.at(ms, fn)` uses a dedicated Worker created from a Blob URL (`setTimeout` inside a worker is not intensively throttled in
  hidden tabs); the worker posts at `target − 1500 ms`, the main thread then spins with `setTimeout(0)`/`MessageChannel` until the
  server-clock target. Fallback (Worker blocked): chained `setTimeout`, `status.timer.degraded = true`, panel warning
  «вкладка в фоне: точность таймера снижена, держите вкладку видимой».
* Server clock = `OGX.time.serverNow()` (calibrated on every page with an event countdown); RTT = median of the last 5 executor requests.
* Precise sends (C3.4): steps 1+2 posted at `at − 300..−60 s`, step 3 fired at `at − RTT/2`; the step-3 page gives «Target time»
  (arrival) → `lateMs = arrivalFromPage − expectedArrival` (1-s resolution). If the measured late exceeds tolerance on a recycler
  send that is still **before** the battle, the bot recalls it immediately (it would harvest the old field and leave).

### 1.6 Sleep window [SPEC §1, §2]
`sleepFrom..sleepTo` server wall time (`OGX.time`), each boundary + random 40–140 s per night, across midnight like ShouldSleep.
Before sleeping: if own fleets return (Deploy: arrive) inside the window, postpone to the latest such return + 20–50 s and block
new sends whose return would be inside the window. `botsave.sleepSave` (off by default): fleet-save from bodies by fleet value
(only moons when `sleepSaveOnlyMoons`), min one-way = until wake-up, recall at half (+40–140 s). In sleep only `botsave` (defense)
runs.

### 1.7 Slot accounting with reserve
`Slots` from page=fleetTable (`parse.gz.fleetTable`: fleet, expedition, extra counters) [REAL]; unknown → wait 5–15 s, never assume.
`normal` sends need `free > botcore.slotsReserve`; `force` (fleetsave, recall (needs no slot), recyclers for a planned battle,
defense) needs `free > 0`. Expeditions also need `expedition.used < expedition.max`. The executor re-reads slots in step 0 of every
send; refusal texts `fl_no_slots` / `fl_no_expedition_slot` (step 3 info page) or fleetAjax 612 → `refused: 'slots'`.

### 1.8 Threat lock per body
Detection (runtime, on every page's event box via `flights:updated` and on every executor page): hostile events =
`parse.gz.events` with `hostile` true or flights `status: 'hostile'` (no `own` prefix and style attack/federation/espionage/
destroy/missile [UPSTREAM FlyingFleetsTable]); fleet id = key without the 10-digit end time; ACS key = (first fleet id, arrival).
A body is **locked** from `arrival − threatLockSec` to `arrival + 60 s` for non-probe-only threats: no `fleet.send` from it except
`botsave` force sends; modules must not plan returns to it inside that interval (`wctx.locked`). Missile threats (10) lock nothing
(they hit defense) but are reported. Events: `botcore:threat`, `threat-gone`, `lock`, `unlock`; bus `bot:threat`.

### 1.9 Dry-run
`botcore.dryRun` (default **on**): workers run normally, read free pages (`read.page`, `read.fleetTable`, `read.statistics`, `probe.target`),
but every mutating action returns `{ ok: true, dry: true, refused: 'dryRun' }` and journals `botcore:action-dry` with the exact
request(s) that would be sent (`method`, `page`, form fields, cp). Galaxy views and message listing are mutating here. Modules
must continue their plan as if the action had happened only where safe (e.g. not «wait for the fleet to return»): a dry send is
followed by `nextAt` = normal cycle.

### 1.10 Limits
Rolling 60-min counters: all executed requests (`maxActionsPerHour`), fleet sends incl. fleetAjax (`maxFleetSendsPerHour`),
build orders (`maxBuildsPerHour`), galaxy views (`galaxyViewsPerHour`). Hitting a limit → `refused: 'limit'`, `botcore:limit`
once per 10 min, the worker reschedules at the window's reopening. Defense actions are exempt from fleet/action limits
(never from 0 = off).

### 1.11 Stops and backoff
See C3.6. Detection: `HttpResult.loggedOut` or redirect to `index.php` → logout; captcha regex on any answer → captcha;
`parse.gz.vacation(doc).vacation` → vacation; a game.php answer without `#planetSelector` and without a known info layout
(`.headerRS` + `.mainRS p`, fleetStep3 success table, AJAX JSON) → unknown page. All → `stopped` + `notify(alarm)`.
Info pages are errors only for the action that produced them (journal `action-fail` with the text). Backoff ladder 5–15 s,
40–140 s, 4–6 min, 25–35 min; `maxErrors` consecutive → `paused('errors')` + notify.

### 1.12 Resource arbiter
`wctx.available(body)` = `state.projected(body, now)` stock − active reservations of other modules on that body − `botcore.deutReserve`
(deuterium). Priorities by who reserves first; botsave never reserves (it may take everything). Reservations expire (`ttlMs`, max 2 h).
botbuild reserves the cost of the chosen step while it waits; botfarm reserves fuel + ships build costs; botexpo reserves colonizer cost.

### 1.13 Journal
Every decision (`<m>:decision` with why/inputs/chosen/alternatives), every action (`botcore:action-*` with module, type, params,
request summary, result, ms, lateMs), every state change. Event names: C6. `OGX.log.wrap` is not used for actions (the executor
records them itself, with redacted forms). The panel's «Журнал» tab shows the last 200 B events of this page and links
«Логи для разбора» (OGX.diag export).

### 1.14 Panel «Бот» (botpanel)
Tab group `bot` of `OGX.suite.panel()`:
* «Бот» (order 1): big master switch «Старт/Стоп», «Пробный режим» toggle (with a red banner while off: «Пробный режим выключен —
  бот действует в игре»), state line (leader tab, state, next worker, queue length, limits used/max, timer mode), «Пауза»,
  last 10 actions, threats list with countdowns, a one-time explainer of the safety rules.
* One tab per module: on/off switch + its settings (`dom.settingsForm(['<m>'])`) + module status text supplied by the module via
  `OGX.bot.panelSection(module, render(container))` (botcore stores renderers; botpanel draws them).
* «Журнал»: filtered B events (module filter), export button (OGX.diag.download('today')).
* Turning off dry-run or turning on master the first time asks `dom.confirm` with a Russian summary of what will act.
hub.js «Бот» placeholder is replaced by `OGX.bot.renderOverview(container)` from botpanel.

---

## 2. Exact GALAXYZ requests per action and verification

Base `https://ogamex.eu/Aeternum/game.php`. Form bodies `application/x-www-form-urlencoded`, no CSRF. `cp` on every request
of an action that is bound to a body.

| action | requests (in order) | verification | refusal mapping |
|---|---|---|---|
| read.fleetTable | `GET ?page=fleetTable&cp=<id>` [REAL] | `parse.gz.fleetTable` non-null | — |
| read.page | `GET ?page=<p>[&mode=<m>]&cp=<id>` (buildings, research, shipyard&mode=fleet/defense, resources, imperium (no cp), overview, officier) [REAL] | page parsed (`state.merge(snapshotSync(doc))`) | — |
| read.messages | `GET ?page=messages&mode=view&messcat=<c>&site=<s>&ajax=1` (marks read) [REAL list, UPSTREAM ajax] | `messages.gz.listItems(doc)` | needs `readMessages` |
| read.galaxy | `GET ?page=galaxy&galaxy=<g>&system=<s>` (never cp) [REAL] | `galaxy.parseGz(doc)` non-null; info «not enough deuterium» → error | budget |
| read.statistics | `GET ?page=statistics&who=1&type=1&range=1` [UPSTREAM] | `parse.gz.statistics` rows | — |
| probe.target | `GET fleetTable&cp` → `POST fleetStep1` (`galaxy,system,planet,type,target_mission=0,ship<ID>=n`) → `POST fleetStep2` (`token,fleet_group=0,target_mission=0,galaxy,system,planet,type,speed`) [REAL forms] | step-2 form present → missions; info page → text | allowed in dry-run |
| fleet.send | `GET fleetTable&cp` (slots, ships, `data` not here) → `POST fleetStep1&cp` → `POST fleetStep2&cp` → `POST fleetStep3&cp` (`token, mission, metal, crystal, deuterium[, staytime]`) [REAL forms; fleet.md §2] | `th.success` on step 3 [REAL] + own event with same mission/target/arrival ±2 s in that page's event box (Deploy outward is not in the box [UPSTREAM]: then `GET fleetTable` row) → fleetId | step-1 redirect to fleetTable → `ships`; step-2 info → `target`/`mission`; step-3 info text → `slots`/`fuel`/`cargo`/`vacation`/`noob`/`other` (raw text kept) |
| fleet.recall | `POST ?page=fleetTable&action=sendfleetback` body `fleetID=<id>` [REAL form] | answer page has no recall form for that id and the row shows (R) [REAL markup, UPSTREAM behaviour] | form still there → fail |
| fleet.ajax | `GET ?page=fleetAjax&ajax=1&mission=6\|8&planetID=<id>&cp=<origin>` [UPSTREAM] | JSON `code === 600`; `fleet:sent` via fleetAjax | 601…699 table (fleet.md §3.3) |
| build.building | `POST ?page=buildings&cp=<id>` `cmd=insert&building=<id>` (cancel: `cmd=cancel&listid=<n>`) [REAL form, UPSTREAM redirect] | 302 → page=buildings: queue box lists the id at level L+1 [UPSTREAM box markup; box seen only empty]; else next `read.page` shows the stock dropped by cost(L+1) or `parse.gz.overview` constructions | info page text → fail; no change → `build-verify` fail, retry ≤ `maxRetries` |
| build.research | `POST ?page=research&cp=<lab body>` `cmd=insert&tech=<id>` | same on page=research (one research per player) | idem |
| build.units | `POST ?page=shipyard&mode=fleet\|defense&cp=<id>` `fmenge[<id>]=<n>` (+ `cmd=insert` like the form) [REAL form names] | answer page inline `data.Queue` [REAL empty] contains `[name, count, secs, id]` with the id; else stock dropped | info text → fail |
| messages.delete | `POST ?page=messages` `mode=action&ajax=1&messcat=<c>&side=1&actionTop=deletemarked&submitTop=Confirm&messageID[<id>]=1…` [UPSTREAM] | re-list does not contain the ids | — |

Fuel/cargo pre-check for `fleet.send` uses the fleetStep1 `data` of the same token (fleetroom, gamespeed, fleetspeedfactor,
ships[id].speed/consumption [REAL]): `duration = fleet.gz.duration(data, distance, speed)`, `fuel = fleet.gz.consumption(data, distance, duration)`;
require `deuterium_on_body − fuel ≥ cargo.deuterium + botcore.deutReserve` and `cargo total ≤ fleetroom − fuel`, else the executor
does not post step 2 (`refused: 'fuel'|'cargo'`). The executor trims nothing on its own: cargo is the module's decision.

---

## 3. Data the runtime keeps (storage keys, single writer botcore)

`botcore.status`, `botcore.queue`, `botcore.timers` (persisted `OGX.bot.at` entries with module + payload for re-arming after reload;
the module re-registers its handler by label via `OGX.bot.onTimer(label, fn)` in init), `botcore.limits` (timestamps),
`botcore.threats`, `botcore.battles`, `botcore.needs`, `botcore.reservations`, `botcore.intel` (≤ 2000 entries, LRU),
`botcore.leaderWant`, `botcore.userBusy` (`{ tab, until, why: 'click'|'fleetStep' }`, written by every game tab: game clicks/keys
and fleetStep1/2 pages), `botcore.sleepPlan` (tonight's shifted boundaries).

Add to the contract API (C2.8 companions, defined by botcore): `OGX.bot.onTimer(label, fn(payload))` and
`OGX.bot.at(ms, fn, { label, payload })` persist `{ label, payload, at }`; after a reload the runtime calls the handler registered
for the label (late → `timer-late` with `lateMs`, handler gets `payload.lateMs`). `OGX.bot.panelSection(module, render)`.

---

## 4. Battle / debris / loot simulator (`OGX.botSim`)

Pure JS, UMD, deterministic. Source of truth: upstream `calculateAttack.php`, `calculateSteal.php`, `MissionCaseAttack.php`,
`MissionCaseExpedition.php`, `MissionCaseSpy.php`. API: C4.

### 4.1 Units
`unitTable(catalog)`: for every ship/defense id: `metal, crystal, deuterium` (catalog price, level 1), `attack`, `shield` (catalog
props, [UPSTREAM] 2Moons CombatCaps), `hullBase = (metal + crystal) / 10`, `capacity` (pricelist capacity, no 607),
`rf[target] = shots` from catalog `rapidfire` (2Moons `sd`: shooter → target). 407/408/409 attack forced 0 [UPSTREAM :120].
Missiles 502/503 never take part (MissionCaseAttack merges only fleet + defense lists).

### 4.2 battle() — exact port
Per side `i` (one Side = one 2Moons fleetID): `attTech = 1 + 0.1·weapons + factor.Attack`, `defTech = 1 + 0.1·shielding + factor.Defensive`,
`hullTech = 1 + 0.1·armour + factor.Shield`; with `bonusPct` given: `1 + pct/100` for each (GALAXYZ «Bonus» table is the total).
Loop `ROUNDC = 0..6`:
1. For every side and element in order: `att = n·attack·attTech·rand(80,120)/100`, `def = n·shield·defTech`, `hull = n·hullBase·10/10…`
   precisely `n·(M+C)/10·hullTech`; totals per side and overall; amounts.
2. Record round; break when `ROUNDC ≥ 6` or a side total amount ≤ 0.
3. `attackPct[f] = amount[f]/total` (defender likewise).
4. Attacker losses, for each fleet f, element e with n>0, in order:
   `moc = n · (defenseDamageTotal · attackPct[f]) / attackAmount[f]`;
   for every shooter s with `RF[e][s]` and every defender fleet fID with `def[fID][s].att` non-empty and `attackAmount[f] > 0`:
   `moc += def[fID][s].att · shots / (n / attackAmount[f] · attackPct[f])`; `defenseAmountTotal += defenders[fID].unit[s] · shots` (mutates, used below).
   If `def[f][e].def / n ≥ moc` → no loss. Else `maxRemove = floor(n · defenseAmountTotal / attackAmount[f] · attackPct[f])`;
   `moc −= min(def, moc)`; `remove = max(min(maxRemove, n · min(moc / hull[f][e] · rand(0,200)/100, 1)), 0)`; `n' = max(ceil(n − remove), 0)`.
5. Defender losses symmetric with `attackDamageTotal`, `attackAmountTotal` (mutated by RF).
6. `units = round(n')` for all.
Result `won`: from the amounts of the last computed round: attacker 0 & defender > 0 → 'r'; attacker > 0 & defender 0 → 'a'; else 'w'.
Debris: attacker lost M/C × fleetPct; defender ships (<300) lost × fleetPct; defense: `lost = start − end`, `giveback = round(lost·rand(56,84)/100)`
added back, `(lost − giveback)·cost × defPct`. Note the rebuild happens for every side 0 defense (also on win).
RNG call order must match PHP: per round, attackers' elements (rand 80..120 each), then defenders' elements, then per attacker
element with a loss rand(0,200), then per defender element rand(0,200); defense rebuild rand(56,84) per defense element at the end.
`moonChance` for a planet target (type 1) without moon.

### 4.3 steal() and minCapacityForLoot()
calculateSteal 5 steps with capacity `Σ capacity·n · (1 + storageFactor) − carried(M+C+D)` of survivors; returns floats (2Moons stores
floats). `minCapacityForLoot(res)`: bisection on integer capacity in `[0, 1.5·Σ halves]` until steal() takes ≥ halves − 1e-6 for each
resource.

### 4.4 raid() multi-run
`runs` battles with `rng = rng(seed)` shared sequentially (run k uses the same generator → deterministic). Per run: loot =
steal(survivors) if won 'a' else 0; attacker loss = lost value; debris; net (MSU) = loot + 0 (debris counted separately by the
caller) − attackerLoss − fuel. Percentiles by sorting. `msu = M + C·rates.c + D·rates.d`.

### 4.5 optimizeRaid()
Search space: cargo type (each of `cargoIds` that is available or buildable), combat escort (each id in `combatIds`, default
`[204,205,206,207,211,213,215]` ∩ known), escort count by doubling then bisection on win probability ≥ `winMin` with `runs`,
then cargo count = `ceil((minCapacityForLoot(planet) · (1+surplus) − escortCapacity) / cargoCap)` re-checked with survivors (loop
until steal(survivors at p10) ≥ 95 % of halves or 3 iterations). Candidate rejected if `attackerLoss.mean.msu > maxLossShare ·
loot.mean.msu` or `net.mean ≤ 0`. Score = `net.mean / roundtripHours` (roundtrip from `stats` speeds — given by caller through
`fuelOf` and an optional `timeOf`). Undefended target (no ships/defense units at all, including 210/212/220/208): cargo only, no sim
needed (`tried: 0`). Ships above `available` are reported in `missing` when `maxShips` allows.

### 4.6 expedition()
Monte Carlo over `mt_rand(1,9)` with upstream branches: resources (size buckets 10<s: factor 10..50; 0<s≤10: 50..100; 0: 100..200 —
size irrelevant for the amount since `min(maxFactor, max(200, factor)) = 200`), DM sizes 100–300 / 301–600 / 601–3000, ships (FoundShips
`max(round(Size·min(points, top ≥ 5e6 ? 6000 : 4500)), 10000)`, per type in fleet except 208/209/214: `mt_rand(0, floor(budget/(M+C)))`),
battle (pirates/aliens: attackFactor buckets, one fixed group per size, techs `min(sender + bonus, 0)` [UPSTREAM :270-330] — simulated
with battle()), black hole (fleet lost), time (≈74 % slower / ≈26 % instant return quirk), nothing. Output EV in MSU and DM.

### 4.7 Tests (sim agent)
* `tests/bot-sim-php/run.php` loads upstream `calculateAttack.php`/`calculateSteal.php` with `rand(`/`mt_rand(` rewritten to read
  a given number list (text preprocessing into a temp file; the upstream tree is never edited), stub `$pricelist/$CombatCaps` built
  from the same unit table JSON; the JS sim consumes the same number list through an injected rng → **exact equality** of
  units after battle, won, debris, steal on ≥ 30 golden cases (`fixtures/bot/sim-golden/*.json`, generated by
  `tests/bot-sim-php/make-golden.js`), covering: RF chains (cruiser→LF, 214), shield domes, draw at 6 rounds, defense rebuild, ACS
  (2 attacker sides), empty defender, attacker wipe, M=D steal 11/12, capacity < halves.
* Hand-checked cases in comments (one battle round computed by hand for 10 LF vs 5 RL).
* Statistical: `raid()` with 1000 runs stable to ±1 % between seeds; `optimizeRaid` returns cargo-only for an undefended target and a
  fleet with win ≥ 0.99 for a defended one; `expedition()` frequencies 1/9 ±1 %.

---

## 5. Module botsave — fleetsave + defense

### 5.1 Threat handling (worker prio defense, `allowDuringSleep`, wakeOn `bot:threat`)
For each threat (dedupe by `Threat.key`; re-evaluate on `changed`):
1. Filters in order [SPEC §4 corrections]: whitelist (owner id/name) → missiles (10): if `abm` → order 502 on the hit planet
   (planet of a moon) `min(free silo = silo·10·max(silo_factor,1) − 502 − 2·503 − queued, needed = missile count from the event text,
   affordable)` when the build finishes before arrival (`calc.unitTime`) and requirements met (502: silo 2, shipyard 1;
   no 15/21 in the building queue [UPSTREAM ShowShipyardPage:148-167]), then done → espionage-only (`probesOnly` or mission 6) → ignore
   → weak attack (`weakIgnore` true and attacker points < (our fleet + defense points)/weakRatio; points = Σ(M+C+D)/1000 by catalog;
   unknown composition → never weak) → nothing to lose (fleet points < `minFleetPoints` and resources small) → **save**.
2. `notify(alarm)` once per key: «Атака на [2:68:5] через 12:30 от <name>: решение — сейв».
3. Save planning: `start ∈ [arrival − saveLeadMaxSec, arrival − saveLeadMinSec]` (latest feasible; queued as `precise`-free deadline
   action prio defense with `deadline = arrival − 10 s`); one-way target `≥ (arrival − now)·(1 + marginPct/100)/2 + 20..50 s`
   (circular missions ≥ min/2, Deploy ≥ min) [SPEC §2, §4].
4. Destination search [SPEC §2 corrections]: candidates in `missionOrder`:
   * deploy (4) to own moons first (`moonsFirst`) then own planets, excluding the source, any body with its own threat lock, and bodies
     whose own threat arrives before our return;
   * transport (3) to own body (self-returning; resources stay at the target — prefer moons), needs cargo ≥ 1;
   * harvest (8) to a non-empty debris field within ±5 systems (needs one 209/219 in the fleet; check emptiness with `probe.target`);
   * expedition (15) to `g:s:16` (risk: 1/9 fleet loss — last resort, journal a warning).
   For each target: speeds 10..1 (100 %..10 %), first speed whose one-way ≥ threshold and fuel ≤ deut − deutToLeave and fuel ≤ fleetroom;
   collect hypotheses, sort by fuel asc, tie → shorter duration. Try in order; each failure (refusal) → next hypothesis, then next mission;
   all fail → `notify(alarm, «Флот спасти нельзя»)`.
5. Payload (`resSave`): ships = all flyable ships (not 212); room = `min(fleetroom − fuel, count(217) × 217 cargo × 0.98)` — resources
   ride only in Battle Transporters (John's rule; no 217 -> no resources, journaled `warning: 'noTransport'`); cargo = all
   metal/crystal, deuterium = `min(deut − fuel − deutToLeave, room − M − C)`, priority D > C > M when capacity is short; exact
   (step 3 refuses overflow, F10).
6. Send with `cls: 'force'`, `module: 'botsave'`; verify; record fleetId.
7. Recall (`recall` true): `OGX.bot.at(start + oneWay/2 + rand(40..140) s, label 'botsave:recall')` but strictly before arrival − 5 s;
   if a later threat on the same body exists, move the recall so the return lands after the last threat's arrival + 30 s
   [SPEC §2]. Recall = `fleet.recall` (force, no slot). If the recall is late (arrived), journal `recall-done` with `late`.
8. After the threat passed: wake botdebris (own DF after the battle) via bus `bot:battle-planned` with `owner: 'botsave'` only when we
   stayed to fight (no save).
9. `spyAttacker` (off): one `fleet.send` mission 6 with `min(probes on the body, spy.probes)` (suite setting, default 1100) to the attacker's origin, only if a normal slot
   remains after reserving one for the save.

### 5.2 Sleep save (`sleepSave`, off)
At falling asleep: bodies sorted by fleet value; each → same destination search with min one-way = time to wake-up; recall at half
+40–140 s so the fleet is home after wake-up.

### 5.3 Requests and verification
fleet.send (3 steps) and fleet.recall as §2; ABM `build.units` on shipyard&mode=defense. Verification by the executor; botsave in
addition re-reads the event box after the save and journals `save-sent { fleetId, arrival, back, recallAt }`.

### 5.4 Tests (`tests/gz-bot-save.test.js`, world scenarios `botsave-*.json`)
hostile attack on 2:68:5 arriving in 120 s (mock gamespeed high) → save sent in window to own planet/moon, cargo exact, recall fired at
half, fleet back after the attack; dry-run → nothing POSTed, `action-dry` with the step-3 form; probes-only → ignored; whitelist; weak
attack ignored only when enabled; missile → ABM order with silo math; two waves → recall after the second; no slots except reserve → force
send uses the reserve; locked body: botfarm-like test action from that body refused `threat`; logout during the save → stopped.

---

## 6. Module botfarm — autofarm inactives + spy escort + composition + build missing ships + auto-recall

### 6.1 Target discovery
* Galaxy rows from `galaxy.cached(g,s)` (free; filled by user views and by bot views) and, when `scanGalaxy` and the galaxy budget
  allow, `read.galaxy` around each origin ±`scanRadius` systems every `scanEveryH` (systems ordered by distance, at most the hourly budget).
* Filter: `status` contains `i` (and `I`), not `v`/`b`, not admin; rank ≥ `minRank` when set; not in `exclude`; moons optional later.
* Each target → state machine (stored `botfarm.targets[coordsKey]`):
  `new → probing → reported → (attackPlanned → attackFlying → escort → done(cooldown)) | needMoreProbes | notSuitable(cooldown) | vacation(cooldown 24 h)`.

### 6.2 Espionage
* Probes = the suite setting `spy.probes` (OGX.api.spyProbes, default 1100; the same count as Infinity «Шпионаж», «Почта» and the
  game's spycount). `OGX.botSim.spyNeeded({ ourSpy: research 106, theirSpy: known from a prior report section 100 else estimate
  (ours − 2 first, +2 per retry), spyPower: factors.SpyPower, want: 'defense' })` is only the minimum: n = max(spy.probes, formula);
  an origin with fewer probes than n but at least the formula sends what it has (like the game's min(spycount, probes there)).
* Send: `fleet.send` mission 6 with only probes, speed 10, from the nearest origin with probes (moon wins ties) [SPEC §3]; or
  `fleet.ajax` mission 6 when `useFleetAjax` and the planet id is known (server count = account setting spio_anz).
* Report: after the probes' arrival + 5–15 s, `read.messages` cat 0 (marks read); match the report by coordinates and list date
  (`MessageItem.ts` = arrival [SPEC §3 correction]); parse with `messages.parse.espionageFull` (`exact: true` values from the simulate link).
  Missing section 200 or 400 → `needMoreProbes` (raise the estimate of Δspy, not +constant), ≤ `maxProbeRetries`.
  Store `OGX.bot.intel.put`. Probe loss = the spy flight never returned (not «no report», F7).

### 6.3 Attack decision
* Expected resources at arrival: `report.res + production(levels from section 0, at ×22000 via calc.production with temp from galaxy/report
  if known else default) × Δt`, capped at storage capacity (`calc.storageCapacity`) [raid_rules cargo_sizing idea, 2Moons formulas].
* Loot = steal halves; skip when loot MSU < `minLoot` (raw metal-equivalent threshold).
* Composition: undefended (no units at all in 200 and 400) → cargo only (`minCapacityForLoot` × (1+surplusPct)); otherwise
  `OGX.botSim.optimizeRaid` with defender Side from the report (tech from section 100 when known, else assume ours + 2 — conservative),
  attacker `bonusPct` from `state.combatBonus()` [REAL fleetTable Bonus], `winMin`, `maxLossShare`, `simRuns`, available ships of
  the origin minus `MinCargosToKeep` (0), fuel by `OGX.bot.flightTime`.
* Speed: fastest of 10..1 with `fuel ≤ maxFuelShare · loot MSU` and duration ≤ `maxFlightSec`; none → skip (never fall back to 100 %) [SPEC §3].
* Order of attacks: by `net / roundtrip` (slot-time profit) [SPEC §3, raid_rules priority].
* Fresh intel: if the report is older than `maxReportAgeMin` at send → re-spy first (1–2 probes, same origin) and recompute.
* Slots: own farm attacks in flight (own registry, not all attacks) < `maxSlots`; `canSend('normal')`.
* Sleep: `wctx.sleepCheck(back)`; threat: origin not locked and return not into a lock.
* Send `fleet.send` mission 1 with `expectArrival`; on success `OGX.bot.battles.put({ owner: 'botfarm', arrival, debris: sim.debris,
  existingDebris: galaxy row debris or null, fleetId })` and emit `bot:battle-planned`.

### 6.4 Build missing ships (`buildShips`)
If `optimizeRaid.missing` is non-empty and: shipyard free of 15/21 in the building queue, cost affordable with `wctx.available` after
reservations, build time (`calc.unitTime`, game speed calibrated from the shipyard queue `secsPerUnit` [REAL inline data]) +
flight ≤ `buildMaxWaitMin`, and the report will still be fresh at arrival (`age at arrival ≤ maxReportAgeMin + buildMaxWaitMin`):
reserve the cost, `build.units` on the origin, state `waitShips` until the queue ends, then re-spy (if stale) and attack.

### 6.5 Spy escort and auto-recall (requirement 2)
* `escort`: `OGX.bot.at(arrival − escortLeadSec, 'botfarm:escort')`: send 1–n probes (n from intel) so the probes arrive at
  `arrival − 20..30 s` (probe flight is short; start = that minus probe duration); read the report (+5 s).
* Compare with the plan: new ships/defense such that `raid()` with the flying fleet gives `win < winMin` or loss > maxLossShare;
  vacation (step 3 refusal text or fleetAjax 605); moon appeared (galaxy/report title type); resources dropped so net ≤ 0;
  planet gone (step 2 offers 7). Any → `fleet.recall` (prio deadline, must happen before arrival − 3 s) when `recallOnChange`;
  `battles.remove` + `bot:battle-cancelled`.
* Also recall when a hostile threat appears on the attack's home body for the return time (lock) — the module plans a later return
  instead: recall only if the return would be safer (journal the reasoning).

### 6.6 Requests and verification
fleet.send missions 6 and 1 (§2), fleet.ajax 6, read.messages 0, read.galaxy, build.units, fleet.recall, messages.delete (own processed
reports only when `deleteReports`). Attack result: combat message cat 3 (when readMessages) → `messages.full` (page=raport [UPSTREAM]) →
journal `report` with loot/debris for calibration (actual loot vs predicted).

### 6.7 Tests (`tests/gz-bot-farm.test.js`, scenarios `botfarm-*.json`)
world with 3 inactive targets (one empty, one with LF + RL, one vacation), cached galaxy rows: spy sent with formula count; report
parsed; empty target → cargo-only attack with exact capacity; defended → composition from optimizeRaid, sim summary in the journal;
vacation → skipped; escort spy before arrival; scripted change (target gets 50 HF after the attack starts) → recall before arrival;
build missing ships when enabled; dry-run sends nothing; limits respected; battles registry entry created.

---

### 6.8 Target database, galaxy sweep, payback (0.3.2, John 2026-11-01)
Live log 2026-11-01 21:56 (0.3.0): 19 targets from the galaxy cache (±15 systems, 16 of 31 cached), 4 rich defended targets
(loot 0.1–2.1 T MSU) never attacked: the build variant (one combat type, e.g. «215×84784, build 46 496») replaced the own-ships
plan and then failed `buildMaxWaitMin` (786–93 858 min) every cycle; empty targets (50k/50k/5k, no mines) re-spied every 3 h.
* `optimizeRaid` options `minWin` (default winMin) / `maxDefeat` (default 1 − winMin): pass = win ≥ minWin ∧ defeat ≤ maxDefeat
  (2Moons draw: the fleet comes home, no loot — net.mean already carries it). botfarm passes minWin (0.8) and 1 − winMin (0.99).
  `mixed: true`: every available combat type scaled together by k/1000 (bisection) + cargo 'need' or 'all' available 217
  (damage is spread by unit count, F2, so 217 are hull for the warships); two sizes (smallest passing, whole hangar), the
  score (net per hour) picks. Own ships only. [2:56:7] with 215×38 288 + 217×101 302: win ≈ 99 %, loot ≈ 2.08 T, losses ≈ 41 M.
* Build fallback: `buildMissing` returns `skipped` (buildTooLong / buildCost / shipyardBusy / unitTimeUnknown / buildOff) →
  `planAttack(…, { noBuild: true })`; a plan without missing ships is attacked, else state `needFleet` (T.need, pause
  `needFleetPauseH`).
* Poor targets (loot < minLoot): state `poor`, cooldown until `regrowAt` (bisection of expectedAt: production x22000 capped by
  storage) clamped 30 min..7 d; null (no production / storage too small) → 7 d.
* `scanScope` 'galaxy' (default) = every system 1..499 of each galaxy with an origin, by distance; `scanPerCycle` (40) views per
  pass within `botcore.galaxyViewsPerHour`. Discovery reads `galaxy.g<g>` once per pass (`galaxy._expand`), not galaxy.cached per
  system. A database planet missing from a NEWER galaxy view → `gone` (not reset by the cooldown; back only with a newer view
  that shows it); removed after `dbKeepDays`.
* `T.db` (inside botfarm.targets): reports (last 10: resMsu, defMsu, fleetMsu, prodMsuH), raids (last 20: pred / actual loot,
  fuel, losses, result), totals (spies, probesLostMsu, raids, lootMsu, fuelMsu, lossMsu), profit (loot, net, per hour, ROI =
  loot / (fuel + losses)), verdict (farm / needFleet / shortage / poor / tooStrong / gone). Panel table sorted by verdict and
  net per hour; CSV export. Attack limit per day: learnt from the refusal (own attacks in the last 24 h) → `cal.attackLimit`,
  checked before every attack.

## 7. Module botdebris — debris prediction, recyclers at battle + 1–2 s, resource logistics

### 7.1 Recyclers for planned battles (wakeOn `bot:battle-planned`, `bot:battle-cancelled`)
1. Expected field = `battle.existingDebris + battle.debris.p50` (metal + crystal); recyclers
   `n = botSim.debrisForRecyclers(field, { cap: state.shipStats()[209].cargo (Storage expert incl.), marginPct })` (fuel does not reduce
   harvested amount [SPEC §5 correction]); 219 only when `preferGiga` and its capacity is known from fleetStep1 `fleetroom`.
   `keepResidual`: if this is a farm target, size capacity so `residual` units stay (n from `field − residual`; recyclers take min(capacity, field), so n is floored to `floor((field − residual)/cap)` whenever the margin would take the residual).
2. Origin: nearest body with enough recyclers and fuel, moon first on ties [SPEC §5]; slot class `force` (C2.5 privilege).
3. Mode:
   * **pre-send** (`existingDebris > 0` now, confirmed by `probe.target` type 2 offering mission 8 — free): departure second
     `D = arrival + rand(arriveMinSec..arriveMaxSec) − duration(speed)`; choose the speed (10..1) with the cheapest fuel whose `D ≥ now + 90 s`
     (time for steps 1–2); action `fleet.send` with `precise: { at: D, tolMs: 1000 }`, `expectArrival`. After the step-3 page:
     arrival < battle arrival → immediate recall + `recyclers-late` (would harvest the old field); arrival > battle + arriveMaxSec + 5 → keep
     (still fine) and journal `recyclers-late`.
   * **post-battle** (`postBattle`): `OGX.bot.at(arrival + 1 s)` → `fleet.send` at 100 % from the nearest origin (deadline prio); arrival =
     battle + 1 s + RTT + duration.
   * `battle-cancelled` before departure → cancel; after departure → recall (pre-send only).
4. Verification: step-3 success + arrival second; later the harvest message (cat 4/5 «Recycling report» [UPSTREAM]) when readMessages
   → journal predicted vs harvested (`harvest-own`/`recyclers-sent` result).

### 7.2 Own debris fields
Every `checkMinMin..checkMaxMin` minutes (or on `bot:threat` gone after a fight on our body): fields at own coordinates from the galaxy
cache or the last `galaxy:system` seen on the bus (any module's bot read, the player's page), at most ONE `read.galaxy` per system
per `checkMinMin` and only when the data is older than `checkMaxMin`; planets of one system share the read (`M.meta.ownRead`). Root
cause of the preview-2 loop (a read every 4–5 s): botcore's `read.galaxy` does not store the system in the galaxy cache, and its
`galaxy:system` (source 'scan') woke the module as «user viewed an own system»; now only a non-scan event wakes it, a scan just feeds
the data. Fields after own battles; send when ≥ `minOwnDf`, origin order moon full → moon any → planet full →
planet any; no duplicate if an own recycle fleet already flies there (compare by value `g:s:p:2`) [SPEC §5].

### 7.3 Logistics (`logistics`)
* Reads `OGX.bot.needs.list()` (from botbuild, 8.8): for each need ONE 217 trip for the whole chain (`need.res`) from `logisticsOrigin`,
  else from the body with the largest spare (all of John's planets are in one system: alike flight times, fewest trips); bodies with an
  open need never give. Spare = available − the body's botbuild `keep` − `deutReserveH` hours of its deuterium production; load =
  min(need.res, spare) and at least `need.min` (else the next source; none → skip «не хватает …»); `ceil(load / cap)` of 217 (fuel
  inside the cargo check: `(cargo + fuel) ≤ capacity` [SPEC §5]), 217 short → the next source / skip «не хватает N Ул. трансп.»; skip
  if the target produces the load within the one-way flight time and it fits its storage; one trip per planet: skip while an own
  transport flies there.
* `repatriate`: colonies with stock ≥ `repatriateMin` → the main storage body, D > C > M when ships are short, leaving the body's own
  `keep` (its plan for the next needAheadMin); never from a body with an open need (no ping-pong main → colony → main); skip bodies with
  incoming transports; skip when the destination's threat lock covers the arrival.
* Overflow: a resource ≥ `overflowPct` % of capacity and botbuild cannot raise the storage → move the surplus.
* All transports `fleet.send` mission 3 (normal class), verify by step 3 + event.

### 7.4 Tests (`tests/gz-bot-debris.test.js`)
battle registry entry with existing residual field (world debris at target) → pre-send precise: mock records the step-3 server second;
assert arrival ∈ [battle+1, battle+2]; no residual → post-battle send at battle+1 s; `probe.target` used instead of a galaxy view;
recycler count = ceil(field·1.1/cap), with keepResidual min(ceil((field−residual)/cap·1.1), floor((field−residual)/cap)) so the residual stays; battle cancelled → recall; own DF harvest; logistics need → exact transport; dry-run.

---

## 8. Module botbuild — John's build-up tactic (default) + strategy-plan payback rule + TBot build rules + research

### 8.0 Build-up tactic (v2, `policy` 'tactic', the default)
Source: `/mnt/project-files/ogamex-strategy/galaxyz/planet_buildup_rules.json` (schema ogamex-galaxyz-buildup/2) + `buildup_sim.py`,
copied into botbuild.js as the constant `BUILDUP` (never read at runtime); John's overrides win. Server economy: x22000 production,
build speed ~x3000 → resources are the bottleneck, not queue time; 2Moons has no position bonus. The tactic is a hard order before (and
instead of) the payback ranking; queue rules, empty-queue-only orders, storage-first, reservations/needs, verification, cooldowns, the
game-speed solve and the safety gates stay as below. Per planet, in this order:
1. energy deficit (and the extra use of the next mine) → solar satellites only (never solar plant 4 / fusion 12);
2. storages: capacity < `storageHours` (default and minimum 12) × real production of that resource (ticker perHour: x22000, officers,
   131-133) → that storage (D, C, M); a resource at the cap → its storage;
3. foundation: robots 10, nanites 10, shipyard `shipyardTarget` (default and minimum 14), in this order;
4. lab to `labTarget` (default and minimum 22) once the planet met its stage mine targets or the empire is in S2+ (no lab start while
   research runs — the tactic then holds a research start for up to 30 min while a lab step is ordered or about to be affordable);
5. nanites +1 when the next mine takes > 60 min (needs the solved game speed);
6. mines below the stage target, ranked across ALL planets by level + offset (metal 0, crystal 5, deuterium 11 — no-trader ranks; the
   trader is never used automatically); ties: colonies before the main planet (highest mine sum), then lower production. A higher-ranked
   mine waits while the lowest is ordered, being built or affordable within 2 h ("сначала самая низкая шахта") — but only on the
   lowest mine's own planet: another planet whose building queue is free still orders its own lowest mine when its own stock pays it
   now (John 2026-11-01 «планеты не ждут друг друга»: resources are per planet); a higher mine it cannot pay now is skipped (no wait,
   no reservation, no delivery request);
7. terraformer when free fields reach `fieldsReserve`.
Research (lab planet = highest lab): first the missing research of the 217 «Улучшенный транспорт» unlock (110 >= 14, 111 >= 10,
114 >= 10, 117 >= 15; shipyard 14 is a planet target), then 219 (109/110/111 >= 15, 118 >= 8; it needs shipyard 15 — shown, not
built unless `shipyardTarget` is raised); then astrophysics while the planet cap is not reached (cap = 2 astrophysics levels without a
higher y in the planet list [x / y]; the file's 3 + astro/2 is unverified); then 131-133 and the lab network 123 (target = planets with
lab >= labTarget minus 1, time / 2), those below the stage research targets first, shortest (metal + crystal of the next level) first.
Stages: S0 per planet (foundation), S1 «Догнать колонии до главной» 45/45/41, S2 50/50/46, S3 55/55/51, S4 60/60/56, S5 65/65/61,
then +5 per stage; the empire stage is the first one some planet has not met. Journal kind `botbuild:stage` each run.
Pure API: `OGX.botBuild.plan(input)` (one cycle) and `OGX.botBuild.longTermPlan(input)` (staged plan: per planet the next N steps with
price and ETA at the current production, stage targets with progress, research path with ETA at the pooled production, unlock status,
blockers: energy, storage < 12 h, fields, missing research, missing resources, busy queue). The botbuild tab shows it as «План застройки»
(collapsible per planet) from cached data only — the bot's stored views, else the core state (pages the player opened) — with zero
requests, also while the bot is off or in dry-run. The executor builds only when master + botbuild are on and dry-run is off; in
dry-run every next order is journaled (`botcore:action-dry`, `botbuild:build-start` dry). The payback policies below stay selectable.
Tests: `tests/gz-bot-mod-buildplan.test.js` (pure planner on John's empire), `tests/gz-bot-buildplan.test.js` (mock world: dry-run
journal, panel with the bot off and zero requests).

### 8.1 Policy
`policy` 'tactic' (8.0, default), 'col_mine90' (mines only) or 'dis_exp90' (with expeditions) params from the plan's `strategies[<name>].policy.params`
**embedded in botbuild.js as constants at build time** (copy the two param objects; never read /mnt/project-files at runtime);
'custom' reads `policyJson`. Only the algorithm of `bot_algorithm` is used; `build_order` is never replayed.

### 8.2 Candidates (each time a queue on a body is free, research is free, or resources accrue; wake by the next event)
Per planet: next level of 1/2/3 (mines), energy fix (solar 4 / satellites 212 / fusion 12, priced by w_sat/w_fus), storages 22/23/24,
infrastructure 14/15/21/31 (robots/nanite/shipyard/lab), terraformer 33 when 1 field left; per player: research 131/132/133 (production
research — replaces plasma, weight w_plasma), 124 (colony slots: next odd level → price of two levels when the current level is odd
[SPEC §7 correction] → weight w_col with colony value = beta_col · home mines), 108 (fleet slots when `ensureExpoSlots` and
floor(sqrt(124)) + 1 > fleet slots), 113 energy, 123 IRN (when policy irn = 1 and next research time > IRN time), University 6
(`university`; −8 %/level research time, never queued while research blocked by it [UPSTREAM BuildFunctions:170]).
Expedition targets (w_exp) only with policy dis_exp90 and botexpo on (slots via 108/124).

### 8.3 Payback
`gain/h (MSU)` = Δ`calc.production` (all planets, with energy factor recomputed, ×22000 multiplier, officers) priced with policy vC/vD;
`cost (MSU)` = M + C·vC + D·vD; `payback_h = cost / gain × weight` (wM/wC/wD for mines, w_plasma for 131–133, w_col, w_exp, w_sat/w_fus
inside the energy fix). Sort ascending; first candidate whose first step can start: queue free, requirements met, fields OK, energy ≥ 100 %
(else energy fix first). Infrastructure: robots/nanite if `build time > rho_R × time to earn its price` and price ≤ psi × price of the
step it speeds up; lab/IRN with rho_L likewise; storage first when step price > capacity or (overflow = 1) the resource would hit the cap
while waiting. Parallel queue: allow a step in another queue if it delays the best step by ≤ par_tol × wait.

### 8.4 TBot build rules [SPEC §7, corrections applied]
storage by hours (`storageHours` of current production; order D, C, M; capacity from the ticker `limit`); resource at cap → that storage
next; energy chain: satellites `ceil(deficit / per-satellite output)` with the per-satellite output read from page=resources (production
of 212 / count) else `(Tmax+160)/6 × (1+Energy factor)`, only when shipyard ≥ 1, no 15/21 in the building queue, queue < max_elements;
fields: skip at 0 free (no exception); terraformer/moon base when exactly 1 free incl. queue; queue rules: only paid items, no 31 while
any research runs (player-wide), no research while 6/31 in this body's queue, no 15/21 while the shipyard queue is non-empty; build start
verification (≤ `maxRetries`, then cooldown 30 min for that item); wake timer = min(time to afford, end of build/research, first incoming
transport, first expedition return (+1–2 min)) + 5–30 s; random planet order (`randomOrder`).
Missing resources on a colony → `OGX.bot.needs.set('botbuild', [...])` (logistics may deliver), with `wantedBy` (stable while the need
lasts); see 8.8 for the chain need.

### 8.8 Chain delivery and reservations (John 2026-11-01, preview 2: colonies waited ~5.5 min per level for a 217 trip)
* One need per waiting planet, id `botbuild:p<id>:<item>:<level>` of its first waiting step, `planKey` `botbuild:p<id>`: the planet's
  chain for the next `needAheadMin` minutes of build time (setting, default 45; 0 = the waiting step only) = the waiting step, then the
  planet's own steps of `longTermPlan()` (the «План застройки» simulation, not a second planner; queued / reached levels skipped,
  research never) while the summed `calc.buildTime` (robots / nanites raised along the chain) fits. `res` per resource =
  max(`min`, min(chain price − stock usable now, storage − stock)); `min` = what the waiting step(s) miss. 2Moons keeps a delivered
  stock above the storage but stops production there, so a delivery never fills above the storage.
* While an own transport / deployment flies to the planet no need is published for it (matched by planet, not by step); only then the
  waiting steps are reserved (`wctx.reserve`, until arrival + 10 min). A waiting planet without a delivery reserves nothing, so its
  stock stays usable. After the arrival the planet's page is read once (the stock changed).
* One `kind: 'keep'` entry per planet (`res: null`, `keep`: the price of its own chain): logistics never ships that away.
* Needs are re-published only when they change (each publish wakes logistics).
* Shipyard / defense pages: the cached shipyard queue plans; the page is read only when the 15 / 21 / units / dome step is affordable
  and an order follows in the same run (a failed read is not retried for 10 min), never per run for a waiting step.

### 8.5 Game speed
Build/research times need the server game speed (unknown, CORE_API §10): after the first own build, read the queue end time from the page
(queue box / overview constructions) and solve `calc.buildTime(..., { gameSpeed })` → store `botbuild.gameSpeed`, journal it; until then
assume the times are unknown (wake by fallback 10–20 min).

### 8.6 Requests and verification
`read.page` buildings/research/resources/shipyard per body (cp), `read.page imperium` once per cycle (all bodies), `build.building`,
`build.research`, `build.units` (satellites). Verification C3.3.

### 8.7 Tests (`tests/gz-bot-build.test.js`)
world with 2 planets: candidates and payback order journaled (`candidates` with top 5), first step = metal mine with dis_exp90 params
→ POST buildings cmd=insert building=1 with cp; energy deficit → satellites; storage full → storage; fields 1 left → terraformer;
research 131 chosen over plasma; 31 not queued while research runs; verification failure → retry limit; colony missing resources → need
published; dry-run sends nothing.

---

## 9. Module botexpo — expeditions + colonization

### 9.1 Expeditions (F5, F6)
* Slots: send `min(expFree, fleetFree − reserve)`; re-read slots before each fleet; between fleets 5–15 s; next round at the first
  expedition return + 30–300 s; slot still free → retry in 4–6 min [SPEC §6].
* EV (`OGX.botSim.expedition`) with policy rates and `dmValueMsu`: journal `expo-ev` per round.
* Mode `dm` (default): per slot the cheapest flyable ship (210 probe if allowed by step 2, else 202), staytime = `stayHours` (lowest option
  in hours), speed 10; payload 0. Mode `resources`: ships with capacity ≥ their M+C (202, 203, 217) sized `fleetShare` of the origin's
  cargo fleet split evenly over the free slots, + `addCheapTypes` (1 × 210, 1 × 202 when present) for ship finds; never load resources.
  Mode `auto`: choose the mode with the higher EV per slot-hour; tie → dm.
* Target `g:s:16` of the origin (own system) [SPEC §6]; mission 15; `staytime` option from step 2 (hours text).
* Return handling: read cat 15 messages (when readMessages) → `messages.parse.expedition` → journal `expo-result` (outcome stats kept in
  `botexpo.stats` to verify F5 on the live server: black hole frequency, find = Σ(M+C)).
* Sleep: `sleepCheck(2T + stay)`.

### 9.2 Colonization (`colonize`)
* Targets `colonizeTargets` = `[{ galaxy, systems: [from, to], positions: [8,7,9,6,10] }]`; allowed positions by 124 level (1/15 ≥ 8,
  2/14 ≥ 6, 3/13 ≥ 4, else ≥ 1 [UPSTREAM PlayerUtil allowPlanetPosition; SPEC §6]); max planets from `#countColonies` [REAL `[4 / 6]`];
  colonizers in flight count against free planet slots.
* Emptiness check: `probe.target` with one 208 → step 2 offers 7 (free, no deuterium) [F16]; positions in a blacklist with TTL
  (failure 1 d, abandoned position 24 h+) [SPEC §6 corrections].
* Send mission 7 with 208, payload `colonizePayload` = fleetroom − fuel filled metal then crystal (StoreGoodsToPlanet [UPSTREAM]).
* Result: planet list count increases (`parse.gz.bodies`) or a colonization message → `colonize-result`; new body → `OGX.bot` emits
  `bot:bodies-changed` (runtime, from state) so botbuild includes it; fields below `colonizeMinFields[position]` → journal only
  (abandon is not automated: irreversible).
* `buildColonizers`: build 208 on the origin when none (shipyard 4, impulse 3 requirements), reserve the cost.

### 9.3 Tests (`tests/gz-bot-expo.test.js`)
2 expedition slots, mode dm → two 1-ship expeditions to g:s:16 with staytime option chosen by hours text (mock haltSpeed 2 → "0.5"/"1"
texts); slot re-read between fleets; return → next round; EV journaled; colonize: probe.target empty → mission 7 with payload; occupied →
next position; max planets reached → stop; dry-run.

---

## 10. Mock server extensions (`tests/gz-server.js` world mode + `tests/gz-world.js`)

Everything opt-in via `startGzServer({ world })`; the static mode stays byte-identical for existing tests.

1. **Clock**: world server time drives `var serverTime = new Date(...)`, every `data-fleet-end-time`/`data-fleet-time`, fleetTable dates,
   step-3 «Target time», report dates; `world.clock.advance(sec)`; `gamespeed` configurable (tests use e.g. 2000 so flights take seconds);
   `haltSpeed` changes staytime option texts.
2. **Bodies & planet selector**: `#planetSelector`, `#rechts` planet list, `#countColonies`, header resources (`resourceTicker`,
   `#current_<res>[data-real]`), resources grow by production (simple per-body perHour from spec).
3. **Stateful fleets**: step1 validates ships on the cp body (redirect when none), embeds `data = {fleetroom, gamespeed, fleetspeedfactor,
   planet, maxspeed, ships, fleetMinDuration}` computed from the world; step2 offers missions by GetAvailableMissions [UPSTREAM 408-452]
   incl. empty-debris error page, staytime select for 5/11/15 (`<select name="staytime">` option texts in hours); step3 performs upstream
   checks (token, slots, expedition slots, deuterium, cargo space, vacation, mission offered, bash off, noob for non-inactive) and renders the
   success table with world times or the info page; creates a Fleet, deducts ships/fuel/cargo. Session token single-use, 600 s.
4. **Event processing** (`world.process(now)` on every request, in time order): attack (battle via botsim when present, else scripted),
   loot to the fleet, debris to the target row, combat message (cat 3, raport page [UPSTREAM]); spy (report message cat 0 in the REAL
   messages-spy markup with simulate link values, section visibility by the F7 formula; counter-espionage deterministic by seed);
   recycle (proportional harvest, recycling message); transport/deploy (unload, deploy stays); colonize (new body, or fail message when
   occupied/max planets); expedition (outcome from `spec.expeditionOutcomes` queue or seeded F5, message cat 15); hold; return (ships + cargo
   back); hostile arrivals (battle against our body, losses applied); build/research/shipyard queue completions.
5. **Recall**: `sendfleetback` with upstream return-time rule; returning rows lose the form.
6. **Hostile events on overview and every page**: event box spans without `own` prefix, `Dialog.PM(<id>)` owner link, textForBlind ships
   [UPSTREAM FlyingFleetsTable]; ACS groups; missiles.
7. **fleetTable**: slots/expeditions/asteroids header, movement rows with recall forms and fleet ids, ships on the cp body with speeds, Bonus
   table from `player.bonusPct`.
8. **Galaxy**: rows for world bodies and others (inactive i/I, vacation v, banned b, rank tooltip, planet ids, moons, debris with
   recycle link [UPSTREAM doit(8)]); each view deducts deuterium (configurable cost) and is logged; «not enough deuterium» info page.
9. **Messages**: list/view per category from world messages (spy 0, combat 3, recycle/return 4/5, expedition 15), `mode=action
   deletemarked`, marks read.
10. **Build queue**: buildings/research/shipyard pages render levels and queue box ([UPSTREAM templates] for non-empty boxes), POST orders
    deduct cost, schedule completion, refusals (fields, 31 during research, 15/21 vs shipyard, resources).
11. **fleetAjax**: real logic for 6/8 with codes 600–620.
12. **Statistics**: page=statistics (who=1, type 1) with world players ([UPSTREAM template]).
13. **Session faults**: `logout()` (game.php → 302 index.php), `captcha(on)` (captcha page), vacation infobox, 503 on `overview&ajax=1` kept.
14. **Inspection**: `/__ogx/world` GET (JSON snapshot) and POST (script command), `srv.world` in-process.
15. **Scenario fixtures**: `fixtures/galaxyz/bot-scenarios/{basic,botsave-attack,botfarm-inactives,botdebris-residual,botbuild-two-planets,
    botexpo-slots}.json` + README listing the [UPSTREAM] markup used.
16. **Helper** `tests/gz-bot-lib.js` (C7) and its own test `tests/gz-bot-mock.test.js` (world sanity: send/arrive/return/recall, spy report
    parsed by the core parser, battle debris visible in galaxy, staytime texts, hostile events parsed by `parse.gz.events` as hostile).

---

## 11. Test plan (all agents)

* Node-only: `tests/bot-sim.test.js` (sim + PHP goldens; skips nothing: PHP 8.3 is installed).
* Browser (Playwright, suite extension, world mock): `tests/gz-bot-core.test.js` (runtime, may use static mock + routes),
  `tests/gz-bot-mock.test.js`, `tests/gz-bot-{save,farm,debris,build,expo}.test.js`.
* Mandatory checks in every bot browser test: defaults → master off, nothing POSTed and no galaxy/messages views after 20 s on several
  pages; master on + dry-run → `action-dry` events, still nothing mutating (`env.mutating()` empty); no `[OGX` errors; journal explains each
  action (`decision` before `action-start`).
* `node tests/run-all.js gz-bot` and `node tests/run-all.js bot-sim` must pass; the full `node tests/run-all.js` must stay green.

## 12. Live checks to do with the user (journaled, nothing automated)

1. Hostile event markup on overview (first real attack/spy): confirm F-classes; until then detection is [UPSTREAM].
2. One recycler send to a residual field (F1 pre-send) and one post-battle: compare arrival seconds.
3. 20+ expedition results: black-hole frequency and find = Σ(M+C) (F5) — `botexpo.stats`.
4. halt_speed via the staytime option texts.
5. A queue box with content on buildings/research (verification markup).
6. «Asteroids 0/5» mission id.
7. Galaxy rows of inactive/vacation players and debris links on GALAXYZ.

## 13. Build split

Foundation (parallel, disjoint): **runtime** (botcore, botpanel, suite registry, hub bot tab, placeholders, README-RU bot section,
`tests/gz-bot-core.test.js`), **sim** (botsim, PHP golden harness, `tests/bot-sim.test.js`, `fixtures/bot/sim-golden/`), **mock**
(world mode in `tests/gz-server.js`, `tests/gz-world.js`, scenarios, `tests/gz-bot-lib.js`, `tests/gz-bot-mock.test.js`).
Modules (parallel, disjoint, after foundation): botsave, botfarm, botdebris, botbuild, botexpo — one file + one test file + own
scenario fixtures prefixed with the module name each.
