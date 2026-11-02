# OgameX Suite «Бот» — shared contract (v1.2)

> v1.2 = v1 plus the binding amendments in **C8** (foundation integration) and **C9** (module integration). Where C8/C9 and C1–C7 differ, C9 wins, then C8.

Every bot agent gets this text verbatim. It is binding: names, shapes, defaults and event names below may not be changed
by one agent alone. Background, formulas and the per-module algorithms are in `specs/bot/BOT_DESIGN.md` (read it).
Core API: `specs/CORE_API.md`. GALAXYZ requests: `specs/galaxyz/fleet.md`, `buildings.md`, `messages.md`, `galaxy.md`.
Tags: [REAL] seen on saved live pages, [UPSTREAM] taken from upstream 2Moons only (`scratchpad/src/2Moons`).

Paths below are relative to the repo root `ogx/` (= `/tmp/claude-0/-home-claude/1ebb7366-d4fd-5fac-899e-5244b2310d13/scratchpad/ogx`).
Never write to `/mnt/project-files`. Commit nothing. Never skip or disable tests.

---

## C1. Files, module names, load order

| module name (OGX.module name = settings namespace) | file | owner agent | title (ru) |
|---|---|---|---|
| `botcore` | `ogamex-bot/modules/botcore/botcore.js` | runtime | «Бот: ядро» |
| `botsim` | `ogamex-bot/modules/botsim/botsim.js` | sim | «Бот: симулятор боя» |
| `botpanel` | `ogamex-bot/modules/botpanel/botpanel.js` | runtime | «Бот: панель» |
| `botsave` | `ogamex-bot/modules/botsave/botsave.js` | module agent 1 | «Бот: сейв флота и защита» |
| `botfarm` | `ogamex-bot/modules/botfarm/botfarm.js` | module agent 2 | «Бот: фарм неактивных» |
| `botdebris` | `ogamex-bot/modules/botdebris/botdebris.js` | module agent 3 | «Бот: обломки и логистика» |
| `botbuild` | `ogamex-bot/modules/botbuild/botbuild.js` | module agent 4 | «Бот: стройка и исследования» |
| `botexpo` | `ogamex-bot/modules/botexpo/botexpo.js` | module agent 5 | «Бот: экспедиции и колонизация» |

* `ogamex-suite/suite/00-suite.js` `SECTIONS.bot.modules` = exactly `['botcore', 'botsim', 'botpanel', 'botsave', 'botfarm', 'botdebris', 'botbuild', 'botexpo']`
  (this order = load and init order), `SECTIONS.bot.title` = `'Полная автоматизация'`, `dev: false`; TITLES get the titles above.
  `ogamex-suite/manifest.json` lists `modules/bot/<m>/<m>.js` in the same order after the Infinity modules and before `loader.js`.
  The runtime agent makes these registry edits and creates a placeholder for every listed file that does not exist yet
  (placeholder = `OGX.module({ name, title, init() {} })` plus a header comment `PLACEHOLDER — owned by <agent>`), only when the
  file is missing. The owning agent replaces the placeholder completely.
* Each file defines things at load time and starts work only in `init(ctx)` (CORE_API §1). `ctx.ext === 'bot'`.
* A bot module file may use only: the core (`window.OGX.*`, CORE_API), `OGX.bot` (C2), `OGX.botSim` (C4). It never calls
  `fetch`/`XMLHttpRequest`/`OGX.http`/`OGX.api` mutating calls/`OGX.fleet.send`/`fleet.gz.dispatch|step*`/`galaxy.fetch|scan`/
  `messages.fetchList|delete` directly: every game request goes through the runtime executor (`wctx.act`, C2.4). Pure parsers
  (`OGX.parse.*`, `parse.gz.*`, `OGX.messages.parse.*`, `OGX.flights.parse*`, `OGX.galaxy.parseGz`) on documents returned by actions are fine.
* Modules talk to each other only through `OGX.bot` registries (C2.7) and bus events (C6), never by reading another
  module's `ctx.store` keys.
* Russian UI text everywhere the user sees it; code comments English.

## C2. Runtime API `OGX.bot` (defined by `botcore.js` at load time; live after `botcore` init)

### C2.1 State

```js
OGX.bot.version                  // '1.0.0'
OGX.bot.ready -> Promise<void>   // resolves after botcore init (registries usable); modules `await OGX.bot.ready` in init
OGX.bot.status() -> BotStatus    // sync snapshot
BotStatus = {
  master: boolean, dryRun: boolean,
  leader: boolean,               // this tab runs the executor and workers
  leaderTab: string|null,        // storage.tabId of the leader
  state: 'off'|'idle'|'running'|'sleeping'|'paused'|'stopped',
  pauseReason: null|'user'|'errors'|'limit'|'threat'|'userActive',
  stopReason: null|'logout'|'captcha'|'vacation'|'unknownPage'|'errors'|'manual',
  sleepUntil: ServerMs|null, backoffUntil: ServerMs|null, consecutiveErrors: number,
  queue: [{ id, type, module, prio, at, state: 'queued'|'pre'|'running' }],
  limits: { actions: { used, max }, fleetSends: { used, max }, builds: { used, max }, galaxyViews: { used, max } },   // rolling 60 min
  workers: [{ id, on: boolean, nextAt: ServerMs|null, lastRun: ServerMs|null, lastResult: string|null }],
  timer: { mode: 'worker'|'timeout', degraded: boolean },
}
OGX.bot.onStatus(fn(BotStatus)) -> off           // fires on every status change in any tab (storage-backed)
OGX.bot.start() / OGX.bot.stop(reason='manual') / OGX.bot.pause(reason='user') / OGX.bot.resume() -> Promise
//   start() = settings botcore.master := true (does NOT change dryRun); stop() = master := false + cancels queued (not running) actions
```

### C2.2 Settings accessors

```js
OGX.bot.cfg(key) -> value        // 'botcore.<key>' or '<module>.<key>' via OGX.settings.get
OGX.bot.isActive(module) -> boolean   // master && settings '<module>.on' && module '<module>.enabled' !== false && state not stopped
OGX.bot.isDryRun() -> boolean
```

### C2.3 Workers (scheduler)

```js
OGX.bot.register(WorkerDef) -> { wake(reason, atMs?), stop(), id }
WorkerDef = {
  id: string,                    // = module name ('botfarm'); one worker per module (a module may register more: '<module>:<sub>')
  module: string,                // owning module (settings namespace)
  prio: 'defense'|'deadline'|'fleet'|'build',   // default priority of its actions
  startJitter: [minMs, maxMs],   // first run after start/wake-from-sleep/settings reload
  run: async (wctx) => RunResult,  // never throws to the runtime (runtime catches anyway -> backoff); returns when to run next
  wakeOn?: string[],             // bus events that wake it early: 'bot:fleet-returned', 'bot:threat', 'bot:battle-planned', 'flights:updated', ...
  allowDuringSleep?: boolean,    // default false (only botsave sets true)
}
RunResult = { nextInMs?: number, nextAt?: ServerMs, reason?: string }   // both missing -> random 240000..360000 ms
//   the runtime applies the minimum of nextAt and every wake(atMs); +-jitter is the worker's job (use OGX.bot.rand*)
```

`wctx` (worker context, one per run):

```js
wctx.now() -> ServerMs                                   // = OGX.time.serverNow()
wctx.module, wctx.runId, wctx.dryRun
wctx.cfg(key) -> value                                   // '<module>.<key>' (no prefix) ; wctx.core(key) -> 'botcore.<key>'
wctx.rec(event, what, data?) -> void                     // OGX.log.rec('B', '<module>:<event>', what, data) + panel log line
wctx.decide(what, { why, inputs, chosen, alternatives }) // = rec('decision', what, {...}); call before every action
wctx.act(ActionSpec) -> Promise<ActionResult>            // C2.4; resolves when executed (or dry-run logged / refused)
wctx.slots() -> Promise<Slots>                           // C2.5, fresh from the last read (<= 60 s) or reads page=fleetTable
wctx.canSend(cls) -> Promise<{ ok, free, reserve, reason }>   // cls 'normal'|'force' (C2.5)
wctx.bodies() -> Promise<{ [BodyKey]: Body }>            // OGX.state.bodies() (+ projected amounts at now)
wctx.flights() -> Flight[]                               // OGX.flights.cached().flights (own + hostile)
wctx.threats() -> Threat[] ; wctx.locked(bodyKey) -> Threat|null   // C2.6
wctx.available(bodyKey, { forClass }) -> Res             // projected stock - reservations of others - botcore reserves (C2.7)
wctx.reserve(bodyKey, res, { ttlMs, label }) -> id ; wctx.release(id)
wctx.sleepCheck(returnAtMs) -> { ok, reason: null|'sleeping'|'returnsInSleep' }   // C3.5
wctx.store                                               // = ctx.store of the module (keys '<module>.*')
```

### C2.4 Actions (single queue, single executor)

```js
ActionSpec = {
  type: ActionType, module, prio?: 'defense'|'deadline'|'fleet'|'build'|'read',
  cls?: 'normal'|'force',            // slot class; 'force' only for: fleetsave, recall, recyclers for a planned battle, defense
  bodyId?: number,                   // cp for the request(s) (origin planet/moon id)
  params: object,                    // per type, below
  why: string,                       // ru, one line, shown in the panel and journal
  plan?: object,                     // the decision data (sim summary, etc.) stored with the journal event
  at?: ServerMs,                     // do not start before (queued until then)
  precise?: { at: ServerMs, tolMs: number },   // C3.4: the state-changing request must be processed by the server at `at` (+tolMs)
  deadline?: ServerMs,               // drop (result 'expired') when not started by then
  dedupeKey?: string,                // a queued/running action with the same key -> the new one is refused 'duplicate'
  returnAt?: ServerMs,               // fleet.send/fleet.ajax: planned return; re-checked against the sleep window (C3.5) when the
                                      // entry runs, shifted by its queue wait -> refused 'sleep' if it now falls inside
}
ActionType =
  'read.page'        // params { page, mode?, query? }            GET game.php?page=..&cp=bodyId   (free pages only; not galaxy)
| 'read.fleetTable'  // params {}                                 GET page=fleetTable&cp
| 'read.messages'    // params { cat, site? }                     GET page=messages&mode=view&messcat&site&ajax=1 (MARKS READ; needs botcore.readMessages)
| 'read.galaxy'      // params { galaxy, system }                 GET page=galaxy&galaxy&system (COSTS DEUTERIUM; botcore.galaxyViewsPerHour budget)
| 'read.statistics'  // params { type=1, range=1 }                GET page=statistics&who=1&type&range [UPSTREAM]
| 'probe.target'     // params { ships, target, speed }            POST fleetStep1 + fleetStep2, no step 3: returns offered missions/staytime/consumption (token discarded)
| 'fleet.send'       // params SendParams                         fleetTable(cp) -> fleetStep1 -> fleetStep2 -> fleetStep3
| 'fleet.recall'     // params { fleetId }                        POST page=fleetTable&action=sendfleetback fleetID
| 'fleet.ajax'       // params { mission: 6|8, planetId }         GET page=fleetAjax&ajax=1&mission&planetID (cp=bodyId)
| 'build.building'   // params { id, cmd: 'insert'|'cancel', listid? }  POST page=buildings cmd building (cp)
| 'build.research'   // params { id }                             POST page=research cmd=insert tech (cp = lab body)
| 'build.units'      // params { units: { [id]: n } }             POST page=shipyard&mode=fleet|defense fmenge[id]=n (cp)
| 'messages.delete'  // params { ids: number[], cat }             POST page=messages mode=action deletemarked (only own processed reports)
SendParams = { target: { galaxy, system, position, type /*1 planet 2 debris 3 moon*/ }, ships: { [id]: n }, mission,
               speed /*1..10*/, cargo?: Res, staytime?: number /*hours option for 5/11/15*/, expectArrival?: ServerMs, arrivalTolMs?: number }
ActionResult = {
  ok: boolean, dry: boolean,          // dry: dry-run, nothing sent (ok true when the plan was valid)
  refused?: 'dryRun'|'limit'|'slots'|'threat'|'sleep'|'duplicate'|'expired'|'stopped'|'notLeader'|'fuel'|'cargo'|'ships'|'userActive',
  error?: string, code?: number|string, message?: string,   // server text (info page / fleetAjax mess)
  verified: boolean,                  // the post-check (C3.3) confirmed the effect
  data?: object,                      // per type: fleet.send -> { fleetId|null, arrival, back, consumption, missions, result }
                                      //           read.* -> { doc, html } (doc = DOMParser document) ; fleet.ajax -> json ;
                                      //           probe.target -> { missions:[ids], stayOptions, consumption, data } ; build.* -> { doc }
  ms: number, at: ServerMs,           // executor time / server time at the state-changing request
  lateMs?: number,                    // precise actions: server-processed second minus requested `at` (ms, from the result page)
}
```

Executor rules (all enforced by botcore, modules rely on them): one action at a time across all tabs; random gap
`botcore.minGapMs..maxGapMs` between requests; priorities defense > deadline > fleet > build > read, FIFO inside one priority,
`precise` actions jump the queue at their time; every mutating action is refused in dry-run (`refused:'dryRun'`, `dry:true`, journal
`botcore:action-dry` with the full request that would have been sent); `read.galaxy` and `read.messages` are mutating for this rule;
`probe.target` is allowed in dry-run (it changes nothing in the game). Limits (C5 `botcore.max*`) refuse with `'limit'`.
Threat lock (C2.6) refuses any `fleet.send` from a locked body unless `cls:'force'` and module `botsave`. Fuel/cargo/ships
are checked on the fresh fleetTable/step-1 data before step 1 is posted (`'ships'`, `'fuel'`, `'cargo'`). After any action the
runtime restores `cp` to the user's current body when the queue drains (plain `GET page=overview&cp=<id>`; never `ajax=1`).

### C2.5 Slots

```js
Slots = { fleet: { used, max }, expedition: { used, max }, asteroids: { used, max }|null, t: ServerMs, known: boolean, src: 'fleetTable'|'galaxy'|'cache' }
wctx.canSend(cls): free = fleet.max - fleet.used; reserve = botcore.slotsReserve;
  'normal' -> ok when free > reserve ; 'force' -> ok when free > 0 ; unknown slots -> ok false, reason 'unknown'
```
The executor re-reads slots inside `fleet.send` (the page=fleetTable GET of step 0) and refuses `'slots'` itself.

### C2.6 Threats (detection and lock are runtime duties; reactions belong to botsave)

```js
Threat = { key /* 'fleetId:arrivalUnix' */, fleetId, mission /* 1 2 6 9 10 */, arrival: ServerMs, from: 'g:s:p', to: 'g:s:p',
           bodyKey /* own target 'p<id>'|'m<id>' or null */, toType: 1|3, ownerId: number|null, ownerName: string|null,
           ships: Ships|null, units: number|null, probesOnly: boolean, firstSeen: ServerMs, updated: ServerMs }
OGX.bot.threats() -> Threat[]                    // current hostile events (event box of every page + fleetTable reads), arrival > now - 60 s
OGX.bot.lockedBodies() -> { [bodyKey]: Threat }  // lock = a non-probe-only threat arriving within botcore.threatLockSec (default 3600) on that body;
                                                 //   also locks own fleets RETURNING to that body before arrival+60 s (callers check with wctx.locked)
bus 'bot:threat' { added: Threat[], changed: Threat[], gone: Threat[] }
```

### C2.7 Registries shared between modules

```js
// planned battles (botfarm writes; botdebris and botsave read)
OGX.bot.battles.put(Battle) / remove(id) / list() -> Battle[] / get(id)
Battle = { id /* 'farm:<g:s:p:type>:<arrivalUnix>' */, owner: 'botfarm'|'botsave', target: { galaxy, system, position, type },
           arrival: ServerMs, fleetId: number|null, status: 'planned'|'flying'|'recalled'|'done',
           debris: { metal, crystal, p10: { metal, crystal }, p50: { metal, crystal } },   // botSim raid() summary
           existingDebris: { metal, crystal }|null, sim: object /* raid() result, trimmed */, updated: ServerMs }
bus 'bot:battle-planned' Battle ; 'bot:battle-cancelled' { id, reason }
// resource needs (botbuild writes; botdebris logistics reads)
OGX.bot.needs.set(owner, Need[]) / list() -> Need[]
Need = { id, owner, bodyKey, res: Res /* missing */, forItem: { id, level }, wantedBy: ServerMs, priority: number }
bus 'bot:needs' { owner, needs }
// resource reservations (any module; read by wctx.available)
OGX.bot.reservations.list() -> [{ id, module, bodyKey, res, until, label }]
// spy/report cache (botfarm writes after parsing a spy report; any module reads)
OGX.bot.intel.put(coordsKey /* 'g:s:p:type' */, Intel) / get(coordsKey) -> Intel|null / list()
Intel = { coordsKey, reportId, ts: ServerMs /* list date = arrival of probes */, res: Res, ships: Ships|null, defense: Ships|null,
          buildings: object|null, research: object|null, known: { ships, defense, buildings, research }, probesSent, probesLost: boolean|null }
```
Registries are stored in player-scope storage under `botcore.*` keys (single writer: botcore; modules call the methods).

### C2.8 Utilities

```js
OGX.bot.rand(min, max) -> number (uniform, integer when both are integers) ; OGX.bot.randMs([min, max]) -> ms
OGX.bot.INTERVALS = { tiny: [500, 1000], short: [1000, 5000], s15: [5000, 15000], s50: [20000, 50000], s140: [40000, 140000],
                      m6: [240000, 360000], m12: [540000, 720000], m16: [840000, 960000], m35: [1500000, 2100000], hour: [3000000, 4200000] }
OGX.bot.at(serverMs, fn, { label, payload }) -> { cancel() }   // precise timer (worker clock), fires in the leader tab only;
//   persisted as { label, payload, at } in botcore.timers: after a reload/leader change the runtime calls the handler registered
//   with OGX.bot.onTimer(label, fn(payload)) (modules register handlers in init); a late fire passes payload.lateMs (journal timer-late)
OGX.bot.onTimer(label, fn(payload)) -> off
OGX.bot.panelSection(module, render(container)) -> void       // module status UI drawn by botpanel inside the module's tab
OGX.bot.renderOverview(container) -> void                    // botpanel: the «Бот» overview tab (hub.js delegates to it)
OGX.bot.msu(res, { rateC = botcore.rateC, rateD = botcore.rateD }) -> number  // metal-equivalent
OGX.bot.coordsKey({ galaxy, system, position, type }) -> 'g:s:p:type'
OGX.bot.notify(textRu, { level: 'info'|'warn'|'alarm', sound }) -> void   // toast in every game tab + title flash + optional sound
OGX.bot.flightTime({ from, to, ships, speed, data? }) -> { duration, fuel, distance }   // 2Moons formulas (fleet.gz.duration/consumption)
```

## C3. Runtime behaviour every module relies on

C3.1 **Off by default.** `botcore.master` false, `botcore.dryRun` true, every `<module>.on` false. Nothing runs before the user
enables master in the panel. Turning master on with dryRun on runs every enabled worker in plan-only mode.

C3.2 **Leader.** `OGX.storage.lock('bot.leader', 15000)` refreshed every 5 s; released on `pagehide`. Only the leader runs workers,
the executor and timers. Prefer a visible tab: a hidden leader yields when a visible tab asks (`botcore.leaderWant` key). The queue
and timers are persisted (`botcore.queue`, `botcore.timers`), a new leader resumes them; an action found `running` after a leader
change is `uncertain` and is verified (C3.3) before any retry.

C3.3 **Verification** (per action type, done by the executor; `verified` in ActionResult):
fleet.send: step-3 page has `th.success` AND the event box of that page (or a fresh fleetTable) has an own event with the same
mission/target/arrival (+-2 s) -> `data.fleetId`; recall: the fleetTable answer lost that fleet's recall form; build.building /
build.research: the redirected list page shows the item in the queue box, else a re-read shows level+1 queued or the stock dropped by
the cost; build.units: shipyard inline `data.Queue` contains the id; fleet.ajax: `code === 600`; messages.delete: the ids are gone
from a re-list. A failed verification counts as an error for the backoff.

C3.4 **Precise actions.** For `precise.at` the executor posts fleetStep1 and fleetStep2 up to 300 s before `at` (token lives 600 s),
measures RTT (median of the last 5 requests), and posts fleetStep3 at `at - RTT/2` with the worker clock; it reads the server's
arrival from the step-3 page and returns `lateMs`. If the token expired or the window is missed by more than `tolMs` it returns
`ok:false, refused:'expired'` and nothing is sent.

C3.5 **Sleep.** Window `botcore.sleepFrom..sleepTo` server wall time, each boundary shifted by random 40..140 s per night. While
asleep only workers with `allowDuringSleep` run. `wctx.sleepCheck(returnAt)` refuses sends whose return falls in the next window
(Deploy one-way; expedition 2T + stay; others 2T). Falling asleep is postponed until fleets that would return inside the window
are home (+20..50 s).

C3.6 **Stops.** logout (`loggedOut` / redirect to index.php), captcha (any page with a captcha form or text /captcha|recaptcha|hcaptcha/i),
vacation (`parse.gz.vacation`), unknown page (a game.php answer without `#planetSelector` that is not a known info page) -> state
`stopped`, all queued actions cancelled, `OGX.bot.notify(..., { level: 'alarm' })`, user must press «Старт» again.
Errors: consecutive failures -> backoff 5–15 s, 40–140 s, 4–6 min, 25–35 min; after `botcore.maxErrors` (default 5) -> `paused('errors')`
+ notify. Success resets the counter.

C3.7 **User first.** While the user interacted with a game tab in the last `botcore.userIdleSec` seconds, or any tab is on
fleetStep1/fleetStep2 (session token in use), non-`defense`/non-`deadline` actions wait (`refused` is not used; they stay queued).

C3.8 **Background tabs.** Timers run in a dedicated Worker (blob URL); fallback setTimeout with `timer.degraded = true` and a panel
warning. The bot runs only while at least one game tab is open (documented in the panel and README-RU).

## C4. Simulator API `OGX.botSim` (file `botsim.js`; UMD: `window.OGX.botSim` and `module.exports` in node)

```js
const S = OGX.botSim;      // node: require('<ogx>/ogamex-bot/modules/botsim/botsim.js')
S.version                  // '1.0.0'
S.rng(seed) -> { int(min, max) /* inclusive, like PHP mt_rand/rand */, float() /* [0,1) */, seed }   // deterministic (sfc32 seeded by xmur3(String(seed)))
S.unitTable(catalog = OGX.catalog) -> UnitTable       // node: S.unitTable(S.loadCatalog(path to shared/core/08-catalog-data.js))
S.loadCatalog(file) -> catalog                         // node only
UnitTable = { [id]: { id, metal, crystal, deuterium, attack, shield, hullBase /* (M+C)/10 */, capacity, rf: { [targetId]: shots }, isDefense, isShip } }

Side = { units: { [id]: n },                           // order of keys = PHP array order (sim sorts ships 202..220 then defense 401..411 unless keepOrder)
         tech: { weapons, shielding, armour } ,        // levels 109/110/111
         factor?: { Attack: 0, Defensive: 0, Shield: 0 },   // officer/boost factors (2Moons getFactors)
         bonusPct?: { attack, defense, shield },        // GALAXYZ fleetTable «Bonus» % : when given it REPLACES tech+factor: mult = 1 + pct/100
         storageFactor?: 0, carried?: Res }             // attackers: ShipStorage factor (607) and cargo on board for the loot capacity

S.battle({ attackers: Side[], defenders: Side[], fleetDebrisPct = 30, defDebrisPct = 0, rng | seed, units = default table, keepOrder = false })
  -> { won: 'a'|'r'|'w', rounds: number,
       attackers: [{ after: Ships, lost: Ships }], defenders: [{ after: Ships /* incl. rebuilt defense */, lost: Ships, rebuilt: Ships }],
       lostValue: { attacker: { metal, crystal, deuterium }, defender: { metal, crystal, deuterium } },
       debris: { metal, crystal },                     // floats as upstream (no rounding)
       moonChance: number }                            // min(round((metal+crystal)/100000 * moonFactor), moonMax) for planet targets; options moonFactor=1, moonMax=20
S.steal({ ships | capacity, storageFactor = 0, carried = {0,0,0}, planet: Res, units }) -> Res   // calculateSteal steps 1-5, floats
S.minCapacityForLoot(planet: Res) -> integer           // smallest capacity whose steal() takes metal/2+crystal/2+deut/2 (bisection)
S.raid({ attacker: Side, defender: Side, planet: Res /* at arrival */, runs = 100, seed, fleetDebrisPct, defDebrisPct, rates = { c: 1.5, d: 3 }, fuel = 0 })
  -> { runs, win: p, draw: p, loss: p,
       attackerLoss: { mean: Res&{msu}, p90: { msu } }, defenderLoss: { mean: Res&{msu} },
       debris: { mean: { metal, crystal }, p10: {..}, p50: {..}, p90: {..} },
       loot: { mean: Res&{msu}, p10: { msu } }, net: { mean /* loot+0 debris - loss - fuel, msu */, p10 },
       survivors: { mean: Ships }, moonChance: { mean } }
S.optimizeRaid({ defender: Side, planet: Res, available: Ships, attackerTech, storageFactor, cargoIds = [202, 203], combatIds,
                 stats: { [id]: { speed, cargo, fuel } }, winMin = 0.99, maxLossShare = 0.25, runs = 60, seed, fuelOf: (ships) -> deut,
                 rates, maxShips?: Ships /* build allowance on top of available */ })
  -> { ok, ships: Ships, missing: Ships /* to build */, sim: raid result, why: string /* ru */, tried: number }
S.expedition({ ships, cargoOnBoard = 0, topPoints, attackerTech, runs = 1000, seed, units, stayHours = 1 })
  -> { probs: { resources, darkMatter, ships, battle, blackHole, time, nothing },   // 1/9 each, nothing 3/9 [UPSTREAM]
       find: { capByCargo, capByPoints, expected: Res&{msu} }, dm: { expected }, shipsFound: { expected: Ships },
       battleLoss: { expectedMsu }, blackHoleLoss: { msu }, ev: { msu, dm }, fleetPoints, freeCargo }
S.expeditionFind({ ships, cargoOnBoard = 0, units }) -> { free, points, max /* min(free, 200*points) */ }
S.spyNeeded({ ourSpy, theirSpy, spyPower = 0, want: 'ships'|'defense'|'buildings'|'research' }) -> probes   // MissionCaseSpy thresholds
S.debrisForRecyclers({ metal, crystal }, { cap = 20000, storageFactor = 0, marginPct = 10 }) -> n
```
All functions are pure (no DOM, no storage, no network) and deterministic for a given seed. Upstream quirks are kept exactly
(per-element-type rand(80,120) attack, rand(0,200) loss, rapid-fire increments of the opposite side's total, defense rebuild
rand(56,84) %, 6 rounds, loot only when `won === 'a'`); see BOT_DESIGN §4.

## C5. Settings (OGX.settings.define per module; key = '<module>.<key>'; section label in «»)

botcore («Бот: общие») — defined by botcore:
| key | type | default | label (ru) |
|---|---|---|---|
| master | bool | false | Бот включён (главный выключатель) |
| dryRun | bool | true | Пробный режим: планировать и писать в журнал, ничего не отправлять |
| maxActionsPerHour | int 1..2000 | 120 | Действий в час, не больше |
| maxFleetSendsPerHour | int 0..500 | 30 | Отправок флота в час, не больше |
| maxBuildsPerHour | int 0..500 | 30 | Заказов построек в час, не больше |
| galaxyViewsPerHour | int 0..300 | 0 | Просмотров галактики в час (стоят дейтерий; 0 = никогда) |
| slotsReserve | int 0..10 | 1 | Свободных слотов флота держать в резерве |
| minGapMs | int 300..60000 | 1500 | Пауза между запросами, мин. (мс) |
| maxGapMs | int 500..120000 | 4000 | Пауза между запросами, макс. (мс) |
| userIdleSec | int 0..600 | 20 | Ждать после действий пользователя в игре (с) |
| maxErrors | int 1..50 | 5 | Ошибок подряд до паузы |
| threatLockSec | int 0..86400 | 3600 | Блокировать отправки с атакуемого тела за (с) до удара |
| readMessages | bool | true | Бот может открывать сообщения (они станут прочитанными) |
| rateC | float 0.1..10 | 1.5 | Курс кристалла к металлу |
| rateD | float 0.1..20 | 3 | Курс дейтерия к металлу |
| sleepOn | bool | false | Режим сна |
| sleepFrom | string | '01:30' | Засыпать в (серверное время) |
| sleepTo | string | '07:30' | Просыпаться в |
| sleepPreventIfFleets | bool | true | Откладывать сон, пока флоты в полёте |
| runHidden | bool | true | Работать в фоновой вкладке |
| notifySound | bool | true | Звук при тревоге |
| deutReserve | int >=0 | 0 | Дейтерий, который бот не тратит ни на одном теле |

botsave («Бот: сейв и защита»): `on` false; `defense` true; `ignoreProbes` true; `weakIgnore` false; `weakRatio` 3;
`whitelist` json [] (names or ids); `minFleetPoints` 0; `saveLeadMinSec` 30; `saveLeadMaxSec` 90; `marginPct` 30;
`deutToLeave` 0; `missionOrder` json ['deploy','transport','harvest','expedition']; `moonsFirst` true; `recall` true;
`recallJitterMinSec` 40; `recallJitterMaxSec` 140; `abm` true; `spyAttacker` false (probes = suite setting `spy.probes`, default 1100); `sleepSave` false;
`sleepSaveOnlyMoons` true; `sleepDeutToLeave` 0; `resSave` true (load resources).

botfarm («Бот: фарм»): `on` false; `origins` json []; `scanGalaxy` false; `scanRadius` 15; `scanEveryH` 24;
`includeShortInactive` true; `minRank` 0; `minLoot` 10000000; `maxFlightSec` 7200; `maxFuelShare` 0.1; `maxReportAgeMin` 30;
`escort` true; `escortLeadSec` 60; `recallOnChange` true; `winMin` 0.99; `maxLossShare` 0.25; `simRuns` 60; `surplusPct` 10;
`maxSlots` 3; `buildShips` false; `buildMaxWaitMin` 30; `maxProbeRetries` 2; `useFleetAjax` false (probes per spy = suite setting `spy.probes`, default 1100; the 2Moons formula is only the minimum);
`deleteReports` false; `targetsPerCycle` 10; `exclude` json [].
0.3.2 additions (BOT_DESIGN §6.8): `scanScope` enum 'galaxy' ('galaxy' | 'radius'); `scanPerCycle` 40; `minWin` 0.8 (win share;
`winMin` is now «not lost» = win + draw); `mixedFleet` true; `regrowRespy` true; `needFleetPauseH` 6; `dbKeepDays` 14.
Target states add `poor` and `needFleet`; each target carries `db` (reports, raids, totals, profit, verdict).

botdebris («Бот: обломки и логистика»): `on` false; `followBattles` true; `arriveMinSec` 1; `arriveMaxSec` 2; `marginPct` 10;
`keepResidual` true; `residual` 1000; `postBattle` true; `ownDf` true; `minOwnDf` 10000000; `checkMinMin` 30; `checkMaxMin` 60;
`preferGiga` false; `logistics` false; `logisticsOrigin` ''; `cargoType` 203; `deutReserveH` 2; `repatriate` false;
`repatriateMin` 500000000; `overflowPct` 90.

botbuild («Бот: стройка»): `on` false; `policy` enum ['tactic','col_mine90','dis_exp90','custom'] 'tactic' (BOT_DESIGN §8.0); `policyJson` json {};
`buildings` true; `research` true; `energy` true; `storageHours` 12; `labTarget` int 22 (min 22); `shipyardTarget` int 14 (min 14);
`fieldsReserve` 1; `maxRetries` 3; `ensureExpoSlots` true;
`university` true; `randomOrder` true; `moons` false; `defense` false.

botexpo («Бот: экспедиции и колонизация»): `on` false; `expeditions` true; `mode` enum ['auto','dm','resources'] 'dm';
`fleetShare` 0.1; `ships` json []; `addCheapTypes` true; `stayHours` 1; `origins` json []; `betweenMinSec` 5; `betweenMaxSec` 15;
`afterReturnMinSec` 30; `afterReturnMaxSec` 300; `dmValueMsu` 0; `colonize` false; `colonizeTargets` json [];
`colonizeMinFields` json {}; `colonizePayload` true; `buildColonizers` false.

Every module also has the core-added `<module>.enabled` (true): it only loads the code; `<module>.on` is the bot switch.

## C6. Journal events (OGX.log.rec src 'B', kind '<module>:<event>', what = short ru text)

Every event's data carries `{ run?, action?, why? }` where known. Decisions: `<module>:decision` with
`{ why, inputs, chosen, alternatives }` before every action; `<module>:skip` `{ reason }` when a candidate is dropped.

botcore: `start`, `stop`, `leader`, `leader-lost`, `state`, `sleep`, `wake`, `pause`, `resume`, `backoff`, `limit`,
`action-queued`, `action-start`, `action-dry`, `action-done`, `action-fail`, `action-refused`, `action-verify-fail`,
`action-uncertain`, `timer-armed`, `timer-fired`, `timer-late`, `timer-degraded`, `slots`, `threat`, `threat-gone`, `lock`,
`unlock`, `logout`, `captcha`, `vacation`, `unknown-page`, `settings`, `cp-restore`, `frozen`, `resumed`.
botsim: none (pure library).
botpanel: `ui` (user commands from the panel: start/stop/pause/dry-run toggles; src 'U' for clicks is automatic).
botsave: `threat-seen`, `threat-ignored`, `save-planned`, `save-sent`, `save-failed`, `recall-planned`, `recall-done`,
`abm-ordered`, `spy-attacker`, `sleep-save`.
botfarm: `scan`, `target`, `state`, `spy-sent`, `report`, `sim`, `attack-planned`, `attack-sent`, `escort-spy`, `escort-report`,
`attack-recalled`, `build-ships`, `cooldown`.
botdebris: `debris-predicted`, `recyclers-planned`, `recyclers-sent`, `recyclers-late`, `harvest-own`, `transport-planned`,
`transport-sent`, `repatriate`.
botbuild: `candidates`, `choose`, `build-start`, `build-verify`, `research-start`, `energy`, `storage`, `fields`, `wait`, `stage` (tactic).
botexpo: `expo-ev`, `expo-sent`, `expo-result`, `colonize-target`, `colonize-sent`, `colonize-result`, `colonizer-build`.

## C6b. Bus events (OGX.bus, emitted in every tab where the runtime runs; payloads JSON-safe)

| event | emitter | payload |
|---|---|---|
| `bot:status` | botcore | BotStatus |
| `bot:action` | botcore | `{ id, module, type, phase: 'queued'|'start'|'done'|'fail'|'dry'|'refused', result? }` |
| `bot:threat` | botcore | `{ added, changed, gone }` (Threat[]) |
| `bot:fleet-returned` | botcore | `{ fleetId, mission, bodyKey, at }` |
| `bot:bodies-changed` | botcore | `{ added: BodyKey[], removed: BodyKey[] }` |
| `bot:battle-planned` | OGX.bot.battles.put | Battle |
| `bot:battle-cancelled` | OGX.bot.battles.remove | `{ id, reason }` |
| `bot:needs` | OGX.bot.needs.set | `{ owner, needs }` |

## C7. Mock helper API (`tests/gz-bot-lib.js`, owner: mock agent)

```js
const B = require('./gz-bot-lib');
const env = await B.launchBot({
  world: 'basic' | WorldSpec,         // scenario name in fixtures/galaxyz/bot-scenarios/<name>.json or an object (C7.1)
  settings: { 'botcore.master': true, 'botcore.dryRun': false, 'botfarm.on': true, ... },   // seeded before the first page
  page: 'overview',                   // first page opened (default overview)
  ...G.launch options
});
env.world                              // the live World (C7.2) of the mock server (same object the server uses)
env.server, env.page, env.game(...)    // as tests/gz-lib.js
await env.journal({ kind?: RegExp|string, since?: id }) -> Event[]           // OGX.diag.recent() of the open page + stored events
await env.waitJournal(kind: RegExp|string, { pred?: (e) => bool, timeoutMs = 30000 }) -> Event   // polls; throws with the last 30 events
await env.botStatus() -> BotStatus
await env.setSettings({ 'ns.key': v }) -> void                               // live, through OGX.settings.set in the page
await env.until(fn: async () => bool, { timeoutMs, stepMs }) -> void
env.mutating() -> request records (POST + fleetAjax + galaxy + messages view) since launch   // to assert dry-run sends nothing
env.close()
```

### C7.1 WorldSpec (JSON, fixtures/galaxyz/bot-scenarios/*.json)

```js
WorldSpec = {
  name, seed: 1, gamespeed: 7, haltSpeed: 1, startUnix /* server clock start; default now */, tzOffsetSec: 7200,
  universe: { galaxies: 9, systems: 499, maxPlanets: 15, fleetDebrisPct: 30, defDebrisPct: 0, resourceMultiplier: 22000,
              storageMultiplier: 5, maxDmMissions: 5, moonFactor: 1, moonChance: 20, topPoints: 1000000 },
  player: { name: 'vodoleyko1992', id: 4377, research: { [id]: level }, officers: { [id]: level }, darkMatter, vacation: false,
            spyMessagesMode: 0, maxPlanets: 6, bonusPct: { attack, defense, shield, combustion, impulse, hyperspace } },
  bodies: [{ id, type: 'planet'|'moon', planetId?, name, coords: 'g:s:p', tempMax, fieldsMax, fieldsUsed,
             res: { metal, crystal, deuterium }, levels: { [id]: level }, ships: { [id]: n }, defense: { [id]: n } }],
  others: [{ id, name, status: ''|'i'|'I'|'v'|'iI'|'b', rank, points, research: {...},
             planets: [{ id, coords, name, res, levels, ships, defense, moon?: { id, ... }, debris?: { metal, crystal } }] }],
  flights: [ ...own or hostile fleets at start (C7.2 Fleet) ],
  hostile: [{ at: secondsFromStart, from: 'g:s:p', toBodyId, mission: 1|6|10, ships: {...}, ownerId, ownerName, flightSec }],
  messages: [{ cat, kind, ... }],                   // pre-existing reports
  script: [{ at: sec, do: 'setOther'|'addHostile'|'setVacation'|'logout'|'captcha'|'setRes'|..., args }],
  combat: 'sim' | 'win' | 'lose' | 'draw',          // 'sim' = require('../ogamex-bot/modules/botsim/botsim.js'), else forced
}
```

### C7.2 World (server-side model, `tests/gz-world.js`)

```js
World = { spec, clock: { nowUnix(), advance(sec) /* shifts the server clock (page serverTime + events) */ , speedup: 1 },
          fleets: Fleet[], messages: Msg[], log: { sent: [], recalled: [], builds: [], ajax: [], galaxyViews: [], refusals: [] },
          body(id), other(idOrCoords), process(nowUnix) /* runs due events in time order: arrival, battle, spy report,
          harvest, return, deploy, colonize, expedition (outcome from spec.expeditionOutcomes[] or seeded), build completion */,
          addHostile(spec), setVacation(otherId, on), logout(), captcha(on) }
Fleet = { id, owner: 'me'|otherId, mission, ships, cargo: Res, from: { coords, type, bodyId }, to: { coords, type, bodyId|null },
          start: unix, arrival: unix, stayEnd: unix|null, back: unix|null, state: 'out'|'hold'|'back'|'done', recallable }
```
The world mode is opt-in: `startGzServer({ world })`; without it the mock keeps its current static behaviour (existing tests unchanged).
World pages are the saved real pages with dynamic parts replaced (server time, planet selector, resources, event box incl. hostile
events, fleetTable slots/movement/ships, fleetStep1 data JSON, fleetStep2 missions + staytime, step-3 result or info errors,
buildings/research/shipyard levels and queues, galaxy rows, messages, statistics). Markup that was never saved live follows the
upstream 2Moons templates and is listed in `fixtures/galaxyz/bot-scenarios/README.md` as [UPSTREAM].

## C8. Amendments v1.1 (foundation integration; binding for every module agent)

Runtime (`botcore`):
* **A1 Workers run concurrently**, at most one run per worker at a time (a wake during a run re-runs it right after). A worker
  that awaits `wctx.act()` never holds back another module's worker. Requests stay strictly serialized by the single executor.
  Consequence: a module must not assume no other module acts between two of its own `act()` calls; re-read slots/stock
  (`wctx.slots()`, `wctx.available()`) and use `wctx.reserve()` for anything it plans across awaits.
* **A2 Automatic stops** (logout, captcha, vacation, unknown page) also set `botcore.master := false`; status `state:'stopped'`
  with `stopReason`; the user must press «Старт».
* **A3 Limits.** `limits.actions` counts every HTTP request the executor makes (fleetTable read, step 1, step 2, step 3, verify
  reads and the cp restore; `probe.target` steps too). `fleetSends` counts step-3 posts and fleetAjax; `builds` every build.* post. Actions with `prio:'defense'` are exempt from
  the `actions` and `fleetSends` limits (never from dry-run).
* **A4 Refusals vs errors.** Step-3 / info texts about slots, fuel/deuterium, cargo/capacity/raw materials, ships -> `refused`
  (`'slots'|'fuel'|'cargo'|'ships'`), no backoff. Any other server text -> `ok:false, error:<kind>, code:'step3', message`
  and counts for the backoff. A Transport (mission 3) with no cargo is refused `'cargo'` before step 1 ([UPSTREAM]
  ShowFleetStep3 `fl_no_noresource`) — modules never send empty transports.
  A step-2 server info text (target state: empty debris field, vacation, noob protection, no planet) -> `ok:false, code:'step2'`,
  `error:'noDebris'` for an empty debris field (mission 8 / type 2), else `error:'target'`; **no backoff** (a battle without
  debris is normal). A step-2 page without a form AND without a text still counts for the backoff.
  Precise sends: `precise.tolMs` is also checked right before the step-3 request leaves (`refused:'expired'`, nothing sent);
  `tolMs` 0 is honoured (no default of 1000 then). botdebris caps it so the arrival second stays inside battle+arriveMaxSec.
  The executor fires precise steps on a sub-second server clock refined from every fetched page (page server second S rendered
  between send and receipt: `S - tRecv <= offset < S + 1000 - tSend`); OGX.time alone lags by up to ~1 s (floored second +
  transfer), which put step 3 into the next server second. Journal `timer-armed.clock` shows `{ offMs, widthMs, samples, coarseDiffMs }`.
* **A5** `read.messages` with `botcore.readMessages` off -> `{ ok:false, error:'readMessagesOff' }`, no backoff.
* **A6** Any `botcore.*` setting change restarts the workers with their start jitter (2 s debounce).
* **A7 Build verification.** GALAXYZ refuses an unaffordable/forbidden build **silently** (redirect to the list). The executor then
  returns `ok:true, verified:false` (journal `botcore:action-verify-fail`, counts as an error). Upstream charges a building only
  when it starts: a 2nd+ queued item is accepted without resources — botbuild must check affordability itself.
* **A8 Deploy (mission 4)**: the outward row is not in the event box [UPSTREAM]; the executor verifies it with a fleetTable read.
* Extra API (additive): `OGX.bot.recentActions(n)`, `OGX.bot.recentLines(n)`; underscored `OGX.bot._*` hooks are test-only, modules
  must not use them. Extra storage keys `botcore.stopped|paused|recent|lines|notify` (botcore-owned).

Simulator (`botsim`):
* **A9 `bonusPct`** (fleetTable «Bonus») maps as upstream ShowFleetTablePage: `attack` -> attack multiplier, `defense` (alias
  `defence`) -> **shield** multiplier, `shield` -> **hull** multiplier, each `1 + pct/100`.
* **A10** `keepOrder` needs units as `[[id, n], ...]`; zero counts and missiles 502/503 are dropped. Additive exports `stealFleets`,
  `phpRound`, `msu`; additive `battle()` options `targetType`, `hasMoon`, `moonFactor`, `moonMax`, `trace` and outputs `debrisDetail`,
  `unitLost`, `order`. `raid()` takes `fuel` in deuterium (converted with `rates.d`), also `defenders: Side[]`, and returns
  `survivors.capacityP10`; percentiles = `sorted[floor(p*(n-1))]`. `optimizeRaid()` also takes `surplusPct`, `timeOf(ships)` ->
  round-trip seconds (score = net per hour), `hint`. UnitTable rows also carry `speed`, `fuel`; domes 407–409 have `attack` 0.
* **A11 Expedition** (verified in upstream MissionCaseExpedition): resource find = `min(free cargo, Σ(M+C) of the fleet)`; free
  cargo excludes the cargo bonus and counts dark matter on board; `expected` values are per trip. The `1.5×M_eff` formula of
  expedition_rules.json is wrong for this engine. Pirate/alien techs = `min(sender + bonus, 0)`.

Mock (`tests/gz-world.js`, `tests/gz-bot-lib.js`):
* **A12** `env.page` stays the tests/gz-lib.js function (`await env.page()` = current page); the first page is `env.firstPage`.
* **A13** `launchBot({ clock })`: `'now'` (default) starts the world at the real time (the scenario's `startUnix` is replaced) so the
  core's timezone guess matches the live server; `'spec'` keeps `startUnix` (then ServerMs in the page is off by `tzOffsetSec`
  until a fleet countdown calibrates it). Scenario `at`/`flightSec` values are relative, so scenarios work with both.
* **A14** Step 1 redirects to fleetTable only when none of the posted ships exist on the cp body; counts are checked at step 3
  (upstream order). Fleet slots = 1 + research 108 + `player.extraSlots`; expedition slots = floor(sqrt(research 124)).
  Build refusals are silent redirects, reasons in `world.log.refusals`. fleetAjax mission 8 targets type 2. World log also has
  `events`, `script`. Spec extensions are listed in `fixtures/galaxyz/bot-scenarios/README.md`.
* Markup never saved live and built from upstream templates ([UPSTREAM], may differ on the live server): hostile/holding event
  texts, building/research queue boxes, shipyard queue data, staytime block, statistics, raport popup, captcha page, foreign
  galaxy rows, moon/alliance cells. Modules must parse through the core parsers only, so one fix in the core covers them.
* End-to-end proof that runtime + sim + mock fit: `tests/gz-bot-integrate.test.js` (dry-run in the world; live send verified with
  the world fleet id, recall, build, `bot:fleet-returned`; a world hostile attack -> Threat + lock).


## C9. Amendments v1.2 (module integration; binding)

Runtime (`botcore`):
* **B1 `wctx.flights()`** is a synchronous mirror of the core flight cache (filled at init from `OGX.flights.cached()`, updated on
  `flights:updated` and on storage changes from other tabs). Modules use it instead of awaiting `OGX.flights.cached()` themselves.
* **B2 `probe.target`** returns `data.data` = the fleetStep1 data (ships with speed/consumption/capacity, `maxspeed`, `gamespeed`)
  merged with the fleetStep2 inline data (`fleetroom`, `consumption`). Every executor step 1 also stores the server fleet speed
  (`data.gamespeed`) in `state.server()` (`fleetSpeedKnown` true from the first bot dispatch).
* **B3** Pages fetched by the executor are merged into the state with their own time and never replace the live snapshot of the tab
  (`OGX.state.current()` stays the body the user sees, so the cp restore is right).
* **B4 Target claims.** A `fleet.send` with mission 1, 2, 7, 8 or 9 claims `'<mission>:<g:s:p:type>'` when the executor starts it; the
  claim lives until arrival + 120 s (or is dropped on failure / a verified recall). A send of ANOTHER module to a claimed target is
  refused `'duplicate'` (journal `botcore:action-refused`); `prio:'defense'` sends are never refused but still claim. Additive
  `OGX.bot.claims()` lists them (storage key `botcore.claims`).
* **B5 `wctx.cancel(dedupeKey)`** (additive) drops this module's queued or precise-prepared actions with that key before step 3; their
  `act()` resolves `{ ok:false, refused:'expired', message:'отменено модулем' }`. Returns the count.
* **B6 `bot:bodies-changed`** `{ added, removed }` is emitted when the body list changes (journal `botcore:state`).
* **B7** Threat `ownerName` is the full player name (`'Jon Snow'`); botsave's whitelist compares whole names (ids always work).
* **B8** The user-first mark of an open fleetStep1/2 page is a 90 s lease refreshed every 30 s (a tab that dies without `pagehide`
  no longer stalls the queue for 10 minutes).

* **B9 Slot holds** (additive): `wctx.holdSlot({ until, label }) -> id` / `wctx.releaseSlot(id)`. While a hold lives, every
  `normal` send of ANOTHER module counts it as a used slot (`canSend` returns `held`; the executor refuses `'slots'` with
  «занято другими модулями»). botfarm holds one slot per flying attack for its escort probe; botexpo counts holds.
* **B10 Ship counts:** after a successful step 3 the executor takes the sent ships off the origin in `OGX.state` bodies (fresh
  `shipsT`); `bot:fleet-returned` marks the landing body's counts stale (`shipsT` 0) so modules re-read them.
* **B11** botfarm's escort re-simulation recalls only when the target got stronger than the plan assumed (or the plan's
  composition is unknown) or its resources fell; sampling noise of an unchanged target never recalls.
* Core: `OGX.parse.gz.queueBox(doc).items` = `[{ id, level, restSec, endUnix }]` (botbuild uses it). Infinity «Полёты» no longer
  journals its per-second title-alert tick.

Mock: solar satellites built in the world raise its energy (README). Integration proof over a compressed day with every module on:
`tests/gz-bot-scenario.test.js` (scenario `day.json`).

## C10. Amendments v1.3 (John's ship rules; binding, win over C4/C5/BOT_DESIGN where they differ)

* **S1 Loot / transport / resource carriers = Battle Transporters 217 only** (`OGX.catalog.transportShip`, catalog cargo
  40 000 000 x (1 + 0.5 x officer 607), the core's measured factor `state.cargoMeasured` wins; capacity = `state.shipStats()[217].cargo`).
  No fallback ship (202/203 are never picked). Short -> journal «не хватает N Ул. трансп.» and skip.
  * botfarm: `CARGO_IDS = [217]`. The escort's hold never counts as a carrier: `transportShort` counts only the 217 hold, and a
    plan without one 217 (optimizeRaid's combat-only fallback on a defended target) is skipped «не хватает N Ул. трансп.». New settings
    `partialLoot` bool true («Не хватает Ул. трансп.: отправлять сколько есть»), `minLootShare` float 0.5: with too few 217 the raid
    is sent with the 217 at hand only when partialLoot is on and they carry >= minLootShare of the expected loot (half of the
    expected stock), else the target is skipped (`botfarm:skip` reason `transport`, shortage cooldown). The simulator's storage
    factor = `shipStats[217].cargo / 40 M - 1`.
  * botdebris logistics / repatriation: transports are 217; setting `cargoType` removed.
  * botexpo mode «Ресурсы»: 217 only (`ships` list is cut to 217; `addCheapTypes` adds one probe 210, no 202). Mode dm unchanged.
  * botsave: a save moves all ships; the resources go only into the 217 of that fleet (payload room = min(fleetroom − fuel,
    count(217) x 217 cargo x 0.98); no 217 -> no resources, journaled). No separate transport is ever added.
  * `OGX.botSim.optimizeRaid` default `cargoIds` = [217].
* **S2 Debris = Battle Recyclers 219 only** (catalog cargo 20 000 000, same cargo factor). No 209 fallback; none free -> skip +
  journal. botdebris: setting `preferGiga` removed (219 is the recycler); botfarm's recycler timing counts 219; botsave offers the
  harvest save destination only when the fleet holds 219.
* **S3 Moon risk [UPSTREAM MissionCaseAttack:341-386, debris_moon 1]:** a battle on a planet without a moon creates one with chance
  min(round(debris / 100000 x moon_factor), moon_chance) % and a new moon erases the whole field. botdebris expects
  field x (1 - chance/100) (`targetHasMoon` from botfarm); a pre-send whose expectation is below the new setting `minBattleDf`
  (int, default 1 000 000) is not made (post-battle sees the real field). `optimizeRaid` passes `targetType`/`hasMoon` to `raid`
  (the sim summary carries `moonChance`). The world mock erases the field when it creates a moon (`universe.debrisMoon` 1).
* Probes 210 are exempt from S1/S2. Probes per spy (botfarm, botsave spyAttacker) = the suite setting `spy.probes`
  (`OGX.api.spyProbes()`, default 1100); the 2Moons formula is only the minimum (settings `probesFirst`, `spyAttackerProbes` removed).
* **S4 Module off = its actions off.** Every queued, prepared (precise `pre`) or newly requested action of a module that is not
  `bot.isActive(module)` is refused `stopped` («модуль … выключен»): `enqueue`, `pick`, `runAction` and `preciseGate` check it,
  and a `<module>.on` / `<module>.enabled` change drops that module's entries at once (also entries restored by a new leader).
  Entries in state `uncertain` (read-only verification) stay.
