# OGX core API (as implemented)

This is the reference for module authors. It documents `window.OGX` exactly as implemented in `ogx/shared/` (core `0.3.0`). Where the implementation goes beyond DESIGN.md §2, this file is authoritative. Members whose names start with `_` are internal. Do not use them in modules.

**Two engines.** The core serves **GALAXYZ** (ogamex.eu, a 2Moons fork: `/<Universe>/game.php?page=<name>[&mode=..][&cp=<bodyId>]`, the main target) and lanedirt **OgameX** (`/overview`, `/fleet`, ...). `OGX.page.engine` says which (`'galaxyz'` | `'ogamex'`). Public names and return shapes are the same for both; where a datum does not exist on GALAXYZ the field is `null` (never a guessed 0) or the call returns `{ error, unsupported: true }`. Every section below has a **GALAXYZ** note; **§22 is the module porting guide** (each OgameX assumption and its GALAXYZ replacement). Tags: **[REAL]** checked on the saved live pages (`tools/gz-snapshot.js`), **[UPSTREAM]** taken from upstream 2Moons only (not seen live), **[UNVERIFIED]** built from the fork's JS without a captured response. Specs: `specs/galaxyz/*.md`.

Conventions:
- `BodyKey` = `'p<planetId>'` / `'m<moonId>'`. `Coords` = `'g:s:p'`. `Res` = `{metal, crystal, deuterium}`. `Ships` = `{[id]: count}`.
- `ServerMs` = server epoch milliseconds (true UTC epoch). Durations are in seconds unless the name ends in `Ms`.
- Async functions never throw for expected HTTP failures. They return an error shape instead, usually `{ error, status, loggedOut }`; GALAXYZ adds `unsupported: true` for endpoints the engine does not have.
- GALAXYZ numbers: `.` thousands, `,` decimals (`1.908.057.266`, `41,7`). `ServerMs` is still true UTC (the server runs UTC+2 on Aeternum; calibrated per page, §7).
- Load order: `shared/main/page-hook.js` (MAIN world, `document_start`), then `shared/core/00..23` in numeric order, then (Infinity, optional elsewhere) `shared/popup/diag-panel.js`, then the modules, then `loader.js` (`document_end`). Files only define things at load time. All work starts in `OGX.boot`.
- Background: `shared/core/21-diaglib.js` + `shared/background/diag-bg.js` (see §21). Popup: `shared/popup/diag-panel.{js,css}`.

---

## 1. `00-ogx.js`: namespace, logger, modules, boot

```js
OGX.version        // '0.3.0'
OGX.ext            // 'live' | 'infinity' | null (set by boot)
OGX.active         // true after isOgx() passed
OGX.refused        // { reason, t } when boot refused a GALAXYZ page without a player name (see boot step 4), else undefined
OGX.modules        // { name: ModuleDef }
OGX.errors         // last 50 { t, where, message, stack }
OGX.style          // { core: cssString }

OGX.log.create(tag) -> { debug(...a), info(...a), warn(...a), error(...a) }
//   prefix "[OGX Live/<tag>]" / "[OGX Infinity/<tag>]"; level from core.logLevel (default 'warn'); error() also pushes to OGX.errors.
// Diagnostic journal (for bug reports: the user downloads it and hands it over):
//   every log call (any level, independent of core.logLevel) goes into an in-memory ring (last 500);
//   warn/error entries are also persisted (player scope, key 'diag.log', last 300, written 2 s after, flushed on pagehide).
//   Uncaught errors / rejections whose stack points at OGX code are logged under the tag 'uncaught'.
OGX.log.entries(minLevel='debug') -> [{ t, lvl, tag, msg, page }]   // this page only
OGX.log.persisted() -> Promise<entry[]>                             // saved warnings/errors, previous pages included
OGX.log.report() -> Promise<string>                                 // text: ext/version/url/UA/page/player/modules/core settings, errors with stacks, saved journal, this page's journal
OGX.log.download() -> Promise<string>                               // report() saved as ogx-<ext>-log-<stamp>.txt (modules put a «Скачать журнал» button in their settings)
OGX.log.clear() -> Promise                                          // empties ring, OGX.errors and 'diag.log'
OGX.log.rec(src, kind, what, data?) -> event|null      // event journal, see §21 (no-op until 22-diag.js is loaded)
OGX.log.wrap(moduleName, fn, label?) -> wrapped fn      // timed B event, errors recorded and rethrown, see §21
//   every warn/error of every logger also becomes a journal event S 'warn'/'error' (tags 'uncaught'/'rejection' -> kinds of the same name)
OGX.safe(fn, where?) -> wrapped fn
//   catches sync throws and async rejections, logs at error level, and returns undefined in that case.

OGX.module(def)    // throws on a missing name/init or a duplicate name. Adds the setting `<name>.enabled` (bool, true).
ModuleDef = { name, title /* ru */, pages: PageName[] | '*' (default '*'), settings?: SettingsSchema, init(ctx), dispose?(ctx) }
//   `pages` matches PageInfo.name or any PageInfo.aliases (GALAXYZ page=buildings matches 'resources' and 'facilities').

OGX.boot({ ext, modules: string[] }) -> Promise<void>
```

Boot sequence:
1. Run `OGX.page.detect()`. On a page that is not a game page, return; nothing else runs there. When the page carries a known generator meta (`candidate` with an `engine`) but was refused, one S `gated` event with `reason: 'not-detected'` and the detect reason goes to the background journal (`diag.recordGated`, no page data). Otherwise `OGX.page.setEngine(engine)` (also switches `util.numberDialect`).
2. Take `OGX.state.snapshotSync(document)` synchronously, before any `await`.
3. Set `html[data-ogx-<ext>]='boot'`.
4. Identity: `OGX.page.identity(snap)` (GALAXYZ: host `ogamex.eu/<Universe>`, player `n:<name>`; OgameX: host + numeric id). **GALAXYZ without a player name** (`#playerName` missing or empty): boot stops here, read-only. Storage is never initialised (no namespace `'0'`), no module starts, `html[data-ogx-<ext>]='refused'`, `OGX.refused = { reason, t }`, and one background-journal S `gated` event with `reason: 'no-player'` (`d.detail` = 'galaxyz: player name not found (#playerName) - storage namespace unknown'). OgameX unchanged. Then initialise storage with that identity, then settings (`load`), the journal (`diag.init(snap)`: S `page` event, error/network/game-message/click capture) and self-learning (`learn.init(snap)`), time (`init`, waiting for the stored tz), the `ogx-core` style and the bridge.
5. Run `state.merge(snap)`, then `state.init()`, `flights.init()`, `galaxy.init()` and `fleet.initPrefill()`, each isolated. On GALAXYZ `galaxy.init()` emits the page's `galaxy:system`/`galaxy:render` **before** the modules start (use `galaxy.onSystem`/`onRender`, which replay them), and `fleet.initPrefill()` schedules the fleetStep3 `fleet:sent` for after `ready`.
6. Initialise the modules in order. A module is skipped when `<name>.enabled === false` or its page does not match. `init` is awaited and isolated, so a failure never stops the next module. A failing `init` is journaled as S `module-init-fail` with the stack; afterwards S `ready` records the init time of every module, and `diag.publishContext()` saves the export header context.
7. Set `data-ogx-<ext>='ready'`, emit `ready` and start the tick: every `core.tickMs`, skipped while `document.hidden`, it emits `tick` with `serverNow()`, updates countdowns and runs the `ctx.every` callbacks.
8. On `pagehide`: run `storage.flush()` and each module's `dispose(ctx)`, then remove the `ctx.on` listeners.

`ctx` (one per module):

```js
ctx.ext, ctx.name, ctx.log, ctx.page /* PageInfo */, ctx.bus /* OGX.bus */, ctx.state /* OGX.state */
ctx.settings.get(key) / set(key, v) -> Promise / all() / onChange(fn(key, value)) -> unsubscribe   // keys WITHOUT '<name>.'
ctx.store.get(key, def=null, opts) / set(key, v, opts) / update(key, fn, def=null, opts) / remove(key, opts) / subscribe(key, fn, opts)
//   = OGX.storage with the key prefixed '<name>.'; opts = { scope: 'player'|'server'|'global' }
ctx.css(text) -> <style id="ogx-<l|i>-<name>">
ctx.on(target, type, handler, opts) -> off            // safe-wrapped, auto-removed on pagehide
ctx.every(ms, fn(serverNow)) -> off                    // runs on the shared tick when >= ms passed (no own timers)
```

## 2. `01-util.js`: `OGX.util`, `OGX.fmt`

```js
util.parseGameNumber(s) -> number             // "152,347" 152347 · "+4,128" · "-2,754" · "1.25Mn" 1250000 · "1.5M" · "2B" · "12K" · "152347.29" (float kept)
//   GALAXYZ (util.numberDialect === 'galaxyz', set by boot): same as parseGzNumber
util.numberDialect                            // 'ogamex' | 'galaxyz'
util.parseGzNumberEx(s) -> { value, approx }  // "1.908.057.266" · "-14.214" · "41,7" 41.7 · "2.064 M" 2.064e9 (space before unit: '.' thousands, LONG scale M=1e6 B=1e12 T=1e18)
                                              //   · "47.5K" 47500 / "4K" (no space: '.' decimal, short scale). Prefer exact sources (data-real, t=, tooltips, ticker).
util.parseGzNumber(s) -> number
util.parseGzDate(s) -> wall ms | null         // "30. Oct 2026, 10:20:01" (en/ru/de month abbreviations) read as UTC fields; convert with time.parseGameDate
util.parseGameNumberEx(s) -> { value, approx }  // approx = true for the Mn/M/B/K suffixes
util.parseShortComma(s) -> number             // "7,7K" -> 7700
util.parseDotThousands(s) -> number           // "1.250" -> 1250
util.parseIsoDuration(s) -> seconds           // "PT1W4D2H40M"
util.coords(s) -> Coords|null                 // LAST g:s:p found in the string ("[1:42:8]", link text, ...)
util.coordsArr(c) -> [g, s, p] | null ; util.coordsObj(c) -> { galaxy, system, position } | null
util.sameSystem(a, b) -> boolean
util.debounce(fn, ms) (has .cancel()), util.throttle(fn, ms), util.sleep(ms) -> Promise
util.uid() -> string ; util.clone(o) ; util.sum(res) -> number ; util.res(m, c, d) -> Res
util.isEmpty(o) ; util.clamp(v, a, b) ; util.shipsTotal(ships) -> number
util.parseForm(body) -> object                // urlencoded string -> { k: v | v[] }

fmt.num(n)            // "1 234 567" (U+00A0), "-1 234", non-finite "—"
fmt.short(n)          // "12,3 тыс.", "1,23 млн", "4,5 млрд"; |n| < 10000 -> fmt.num
fmt.auto(n)           // short or num per core.numberStyle
fmt.signed(n)         // "+1 234"
fmt.pct(x, digits=0)  // 0.256 -> "26%" (decimal comma)
fmt.duration(s)       // <=0 "Готово", ∞ "∞", "45с", "12:05", "3:04:05", "2д 03:04:05", "5н 2д 03:04"
fmt.durationShort(s)  // "2д 3ч", "3ч 4м", "4м 5с"
fmt.time(serverMs)    // "ЧЧ:ММ:СС" in the server zone (core.timeDisplay='server') or the local zone
fmt.dateTime(ms)      // "30.10 01:36:17" (+year when it differs)
fmt.coords(c, type?)  // "[1:42:8]", type 3/'moon' adds " Л", 2/'debris' adds " ПО"
fmt.res(res, { short }) // "М 1 234 · К 5 678 · Д 90"
fmt.plural(n, [one, few, many])
fmt.ago(serverMs)     // "5 мин назад", "2 ч назад", "3 д назад"
```

## 3. `02-bus.js`: `OGX.bus`

```js
bus.on(event, fn) -> unsubscribe   // fn is safe-wrapped
bus.once(event, fn) -> unsubscribe
bus.off(event, fn)
bus.emit(event, payload)           // synchronous
bus.count(event) -> number
```

| Event | Payload |
|---|---|
| `ready` | — |
| `tick` | `ServerMs` |
| `settings:changed` | `{ key: 'ns.key', value }` |
| `storage:changed` | `{ key, value, remote, scope }` |
| `state:updated` | `{ keys: string[] }` (`bodies`, `research`, `player`, `server`, `titles`, `slots`, `shipStats`) |
| `flights:updated` | `{ t, flights }` |
| `galaxy:system` | `{ system: ParsedSystem, source: 'page' \| 'scan' }` (GALAXYZ: `'page'` once at boot on page=galaxy, before the modules init: subscribe with `galaxy.onSystem`, which replays it with `replay: true`) |
| `galaxy:render` | `{ galaxy, system, rows: Map<pos, Element> }` (GALAXYZ: once at boot; `galaxy.onRender` replays it with fresh `rows`) |
| `messages:item` | `MessageItem` (§18; GALAXYZ shape has `cat`, `rowCat`, `catName`, `kind`, `key`, `engine`, `body`) |
| `xhr` | `XhrEvent` (see §13) |
| `fleet:sent` | OGX sends (`fleet.send`, `api.sendFleet` callers): `{ request, response, ok, source }`. Game sends on GALAXYZ: `source: 'game'` plus `via`: **`'fleetStep3'`** (the user landed on the step-3 result page; once per result page, deduplicated by sessionStorage `ogx:fleetStep3:<from\|to\|arrival\|mission>`, fired after `ready`) = `{ request: { mission, galaxy, system, position, type: null, ships }, response: fleet.gz.parseResult, ok: true, source, via, mission, from, to /* 'g:s:p' */, ships: { id: n }, consumption, distance, arrival, back /* ServerMs \| null */, fleetId /* from the event box \| null */ }`; **`'fleetAjax'`** (the game's galaxy one-click spy/recycle answered code 600) = `{ request, response, ok: true, source, via, mission, from: null, to, ships: null, planetId, code }`. OgameX game sends: `{ request, response, ok, source: 'game' }`. OGX's own `api.sendMiniFleet` uses fetch (not relayed): no `fleet:sent` from it |
| `fleet:ajax` | GALAXYZ only, every game XHR to `page=fleetAjax`: `{ ok /* code === 600 */, code, message, mission, planetId, to /* 'g:s:p' from the message \| null */, slots, ships /* { id: n } left on the planet */, request /* query */, response /* JSON */, source: 'game' }` |
| `fleet:recalled` | `{ fleetId, ok }` (`fleet.recall`) |
| `techdetails:open` | `{ id, el }` |
| `time:calibrated` | `{ tzOffsetMs }` |
| `learn:alert` | `[{ t, key, kind, what, data }]` (one batch of self-learning alerts) |

Modules emit their own events as `'<module>:<what>'` (`targets:add`, `targets:track`).

## 4. `03-storage.js`: `OGX.storage`

Backend: `chrome.storage.local` or `browser.storage.local`. When neither exists, it falls back to `localStorage` (prefix `ogx.<ext>.`). Full key = scope prefix + key:

| Scope | Prefix |
|---|---|
| `player` (default) | `<host>\|<playerId>\|` |
| `server` | `<host>\|*\|` |
| `global` | `*\|*\|` |

```js
storage.init({ ext, host, playerId }) -> Promise
storage.ns -> { ext, host, playerId } ; storage.backendName ; storage.tabId
storage.get(key, def=null, { scope }) -> Promise<any>
storage.getMany(keys, { scope }) -> Promise<{ key: value }>
storage.set(key, value, { scope }) -> Promise          // coalesced per key (100 ms); resolves when written
storage.flush() -> Promise                             // writes pending values now (boot calls it on pagehide)
storage.update(key, fn(old) -> new, def=null, { scope }) -> Promise<new>   // serialized per key within the tab
storage.remove(key, { scope }) -> Promise
storage.keys(prefix='', { scope }) -> Promise<string[]>   // without the scope prefix
storage.subscribe(key, fn(newValue, { remote }), { scope }) -> unsubscribe   // remote = written by another tab
storage.namespaces() -> Promise<[{ host, playerId, keys }]>
storage.registerMerger(keyPrefix, fn(old, imported) -> merged)
storage.exportAll({ scopes=['player','server'], prefixes=null }) -> Promise<ExportFile>   // lock.* keys are never exported
storage.importAll(file, { mode: 'merge' | 'replace' }) -> Promise<{ written, skipped }>   // throws on a non-'ogx-export' file
storage.lock(name, ttlMs=60000) -> Promise<{ owner, refresh(ms?) -> Promise<bool>, release() -> Promise } | null>   // null = held elsewhere
ExportFile = { format: 'ogx-export', ext, version, host, playerId, exportedAt, data: { player: {}, server: {} } }
```

Each key has a single writer (DESIGN §2.19). A module writes only through `ctx.store` and `ctx.settings`.

GALAXYZ: boot passes `host = '<host>/<Universe>'` (stored lower case: `ogamex.eu/aeternum`, one namespace per universe) and `playerId = 'n:<player name>'` (the numeric id is not in the page header). Keys therefore look like `ogamex.eu/aeternum|n:vodoleyko1992|bodies`.

## 5. `04-settings.js`: `OGX.settings`

Settings are stored in the player-scope key `settings` as `{ ns: { key: value } }`.

```js
settings.define(ns, schema)        // schema: { key: { type: 'bool'|'int'|'float'|'enum'|'string'|'color'|'hotkey'|'json', default, label, hint?, min?, max?, step?, options?, section?, hidden? } }
settings.load() -> Promise ; settings.isLoaded() -> boolean
settings.get('ns.key') -> value | default
settings.set('ns.key', value) -> Promise   // validated and clamped by the schema; emits settings:changed
settings.all(ns?) -> object ; settings.schema(ns?) -> { ns: schema }
settings.onChange('ns.key' | 'ns' | '*', fn(path, value)) -> unsubscribe   // also fires for other tabs
settings.reset(ns) -> Promise
settings.normalizeHotkey(str) -> string   // "ctrl+shift+K" form
```

Core settings (`core.*`):

| Key | Default |
|---|---|
| `logLevel` | `warn` |
| `tickMs` | 1000 (range 250..5000) |
| `numberStyle` | `full` (or `short`) |
| `timeDisplay` | `server` (or `local`) |
| `tzOffsetMinutes` | `auto` (or minutes as a string) |
| `httpGapMs` | 400 |
| `flightsPollSec` | 60 (0 turns polling off) |
| `galaxyScanDelayMs` | 700 |
| `galaxyScanPerHour` | 300 |
| `galaxyRepair` | true |
| `backgroundWhenHidden` | false |
| `confirmActions` | true |
| `cpConfirmed` | false (hidden) |

Side panels add the hidden settings `core.panel.<id>.open`, `.tab` and `.width`.

Diagnostics settings (`diag.*`, section «Диагностика», defined by `22-diag.js`): `journal` (true: record events), `network` (true: N events), `learn` (true: self-learning), `snapshots` (true: DOM snapshot on alert).

## 6. `05-page.js`: `OGX.page`

```js
page.detect(doc=document, loc=location) -> { ok, engine: 'galaxyz'|'ogamex'|'2moons'|null, candidate, reason, generator, version, popup }
//   cheap (a few DOM queries, no storage/network); false on *.ogame.gameforge.com and on unrelated sites (candidate false).
//   GALAXYZ: meta generator /^(GALAXYZ|2Moons)/ + path /game.php (file:/about: and DOMParser docs exempt) + `serverTime = new Date(` in <head>
//            + #planetSelector (popups and login/error pages are refused with a reason). Plain 2Moons is served as 'galaxyz'.
//   OgameX: meta csrf-token + meta ogame-version + #planetList + (OGameX head comment or footer github link).
page.isOgx(doc, loc) -> boolean               // = detect().ok (name kept)
page.engine ; page.isGz() ; page.setEngine(engine)   // set by boot / the first page.info()
page.engineOf(doc) -> 'galaxyz'|'ogamex'|page.engine // for fetched documents (generator meta)
page.info() -> PageInfo   // cached
PageInfo = { name: PageName, aliases: PageName[], path, query: URLSearchParams, bodyId, isAdmin, origin, engine,
             GALAXYZ only: raw /* ?page= as sent, e.g. 'fleetTable' */, mode, step /* fleetStep 1..3 | null */, cp, universe, base /* absolute game.php */,
             info /* message/error page: no #rechts, .headerRS + .mainRS */ }
page.is(...names) -> boolean                  // name or any alias
page.nameFor(pathname) -> PageName ; page.ROUTES             // OgameX
page.nameForGz(page, mode) -> { name, aliases, step } ; page.GZ_ROUTES ; page.routeGz(doc, href?) -> { name, aliases, step, raw, mode, cp, queryString, info }
//   routeGz uses the URL of the live document, and `var queryString` for DOMParser documents and POST results.
page.url(path, query={}) -> absolute URL string (null/undefined values dropped)
//   GALAXYZ: OgameX paths are translated (page.GZ_PATHS): '/fleet' -> ?page=fleetTable (query position->planet, type->planettype,
//   mission->target_mission), '/galaxy' (position->planet), '/resources' and '/facilities' -> buildings, '/shipyard' -> shipyard&mode=fleet,
//   '/defense' -> shipyard&mode=defense, '/resources/settings' -> resources, '/fleet/movement' -> fleetTable, '/highscore' -> statistics,
//   '/premium' -> officier, '/merchant' -> trader, '/empire' -> imperium, ... ; 'game.php?page=..' / '?page=..' resolve against the universe;
//   a bare name ('fleetStep1', 'TechnologyDetailsAjax') becomes ?page=<name>. Unknown OgameX paths stay as they are (404).
//   GALAXYZ id paths (page.GZ_PATTERNS): '/alliance/info/<id>' -> page=alliance&mode=info&id, '/alliance/apply/<id>' -> page=alliance&mode=apply&id,
//   '/player/<id>' or '/playercard/<id>' -> page=playerCard&id, '/raport/<id>' or '/messages/raport/<id>' -> page=raport&raport=<id> [UPSTREAM 2Moons].
page.gzRoute(path) -> { page, query, rename, shared: string[] | null } | null   // GALAXYZ target of an OgameX path without building a URL;
//   shared = ['/resources', '/facilities'] for both of those (one page=buildings holds mines, storage and facilities); null for unknown paths
page.urlFor(pageName, query={}) -> absolute URL | null   // engine-neutral link by PageName: 'empire' -> ?page=imperium (GALAXYZ) / '/empire' (OgameX);
//   'buildings' -> the /resources path; 'movement' -> page=fleetTable; unknown name -> null
page.go(path, query={})
page.bodyUrl(id) -> absolute URL   // this page with cp=<id>, other query kept (the game's selector, base.js:282); GALAXYZ fleetStep1-3 ->
//   page=fleetTable, info pages and galaxy (costs deuterium) -> overview. Use it for "switch body" links.
page.gzBase() -> 'https://ogamex.eu/Aeternum/game.php'
page.identity(snap) -> { host, playerId }     // storage namespace (boot): GALAXYZ { host: 'ogamex.eu/Aeternum', playerId: 'n:<player name>' };
//   GALAXYZ without a player name -> playerId null and boot refuses the page (§1 step 4)
```

PageName is one of: `overview`, `resourceSettings`, `resources`, `facilities`, `buildings`, `research`, `shipyard`, `defense`, `movement`, `fleet`, `galaxy`, `messages`, `highscore`, `buddies`, `merchant`, `alliance`, `premium`, `shop`, `rewards`, `characterclass`, `chat`, `options`, `planetMove`, `admin`, `empire`, `other`.

GALAXYZ routing (`?page=` compared lower-case; `mode` defaults to none):

| `page[&mode]` | name | aliases | notes |
|---|---|---|---|
| `overview` (or none) | overview | | |
| `buildings` | buildings | resources, facilities | mines, storage and facilities are one page |
| `resources` | resourceSettings | | production % |
| `research` | research | | |
| `shipyard[&mode=fleet]` / `shipyard&mode=defense` | shipyard / defense | | both have `body#shipyard` |
| `fleetTable` | fleet | movement | ships, slots, own flights, new-mission form |
| `fleetStep1/2/3` | fleet | | `step` 1/2/3; step 3 = result page |
| `galaxy`, `messages` | galaxy, messages | | |
| `statistics` | highscore | | [UPSTREAM]; `playerCard`, `raport`, `search` are popups/fragments (name other) |
| `imperium` | empire | | all bodies in one table |
| `officier` | premium | | |
| `trader`, `fleetDealer` | merchant | | |
| `alliance`, `buddyList`, `settings`, `relocate` | alliance, buddies, options, planetMove | | |
| `techtree`, `tournament`, `transport`, others | other | | `raw` holds the page |

## 7. `06-time.js`: `OGX.time`

```js
time.init(snap) ; time.ready -> Promise (stored tz loaded)
time.serverNow() -> ServerMs ; time.toLocalMs(serverMs) -> local ms ; time.fromUnix(sec) -> ms
time.offsetMs, time.renderMs, time.tzOffsetMs, time.calibrated   // uncalibrated and nothing stored: tzOffsetMs = (layout wall - Date.now()) rounded to 15 min (a guess: not stored, calibrated stays false)
time.calibrate(unixSeconds)    // automatic for every JSON serverTime/server_time (http + bridge); the first call fixes tzOffsetMs (15-min rounding)
time.parseServerWall(s) -> ServerMs|null   // "2026-10-30 00:57:17", "30.10.2026 01:36:17", "30.10.2026<br>01:30:37", "30. Oct 2026, 10:20:01" (server zone)
time.calibrateRender(renderUnix)           // GALAXYZ: exact render instant -> tzOffsetMs (15-min rounding), renderMs; stores 'server'.tzOffsetMs when changed
time.userOffsetMs                          // GALAXYZ ServerTimezoneOffset * 1000 (user zone - server zone; 0 unless the player set a zone)
time.parseGameDate(s) -> ServerMs|null     // GALAXYZ dates printed in game text (fleetTable, fleetStep3, messages: USER zone)
```

GALAXYZ: `var serverTime = new Date(Y, M0, D, h, m, s)` is the server wall clock (no zone); the snapshot normalizes it to `serverTimeString = 'Y-m-d H:i:s'`. The exact render instant comes from any event countdown (`data-fleet-end-time - data-fleet-time`, `snap.renderUnix`); `time.init` calls `calibrateRender` on every page that has one (DST-safe). Pages without a flying fleet use the stored offset (`time.ready`); on a first install with no fleet the clock is uncalibrated (tz 0) until a page with an event is seen. There is no JSON `serverTime` on GALAXYZ (`calibrate` is not called).

## 8. `07-dom.js`: `OGX.dom`

```js
dom.$(sel, root), dom.$$(sel, root) -> Element[]   // both (and waitFor with a string) report hit/miss to OGX.learn.sel (live document only)
dom.h(tag, attrs, ...children)   // attrs: class (str|array), style (obj|str), dataset, on<Event> (safe-wrapped), any attribute; children: Node|string(text)|array|null
dom.waitFor(selectorOrFn, { root, timeout=10000 }) -> Promise<Element|null>
dom.observe(target, cb, { debounce=100, childList=true, subtree=true, attributes=false, characterData=false }) -> disconnect
dom.injectStyle(id, css) -> HTMLStyleElement   // idempotent by id
dom.root() -> div#ogx-root.ogx-root (created on demand; host for floating widgets)
dom.anchors() -> { menu, topBar, rightColumn, content, footer, leftColumn, menuEnd }   // insertion points; GALAXYZ: #menuTable, #bar > ul, #rechts (missing on info pages and fleetStep3), #inhalt, #siteFooter .fright
//   leftColumn = the floated left menu column (GALAXYZ #links, OgameX #left); menuEnd = insert AFTER it to sit under the left menu
//   (GALAXYZ #links > #menuTable, OgameX #left > #toolbarcomponent)
dom.planetRows() -> [{ row, link, planetId, moonLink, moonId }]   // planet list rows in page order; planetId from data-planet-id (OgameX) or a.planetlink cp= (GALAXYZ)
dom.planetLists() -> Element[] ; dom.planetListEnd() -> Element|null   // GALAXYZ has one #planetList per planet: place blocks after the LAST one
dom.menuEntry({ id, label, iconText='◆', title, onClick, badge }) -> { li, setBadge(text|null), setActive(bool) }
//   appended to #menuTableTools (OgameX) or #menuTable (GALAXYZ; same li > span.menu_icon + a.menubutton > span.textlabel markup)
dom.sidePanel(id, { title, width=360, maxWidth=0, side='right' }) -> SidePanel (singleton per id; with maxWidth > width and no user resize the width is min(max(width, 36vw), maxWidth))
  SidePanel = { el, header, body, open(), close(), toggle(), isOpen(),
                addTab({ id, label, order=100, badge, render(container, panel), onShow?, onHide? }) -> { setBadge(t|null), refresh() },
                selectTab(id), currentTab(), setStatus(text|null) }      // Esc closes; open/tab/width persisted
dom.modal({ title, body, buttons=[{ label, primary, danger, onClick(close) }], width=520, onClose }) -> { el, close() }
dom.confirm(textOrNode, { okLabel='Да', cancelLabel='Отмена', danger=false, title='Подтверждение' }) -> Promise<boolean>
dom.toast(text, { type: 'info'|'ok'|'warn'|'error', ms=3500 })
dom.tooltip(el, content: string|Node|(() => Node), { side='auto' }) -> detach
dom.table({ columns: [{ key, label, title?, align?, sortable=true, value?(row), render?(row), width? }], rows, sortKey, sortDir='desc',
            rowKey, onRowClick, emptyText='Нет данных', maxRows, className }) -> { el, setRows(rows), sortBy(key, dir) }
dom.bar(fraction, { cls: 'ogx-ok'|'ogx-warn'|'ogx-bad', title }) -> Element
dom.countdown(serverMsEnd, { doneText='Готово', short=false }) -> span.ogx-countdown[data-end]   // updated on every tick
dom.updateCountdowns(now?)
dom.settingsForm(nsList, { onChange, showHidden=false }) -> Element
dom.download(filename, text, mime='application/json') ; dom.pickFile({ accept='.json' }) -> Promise<string|null> ; dom.copy(text) -> Promise<boolean>
dom.icon(name) -> SVG element ; dom.ICONS   // gear refresh star eye note send spy trash up down close plus
```

## 9. `08/09-catalog`: `OGX.catalog`

GALAXYZ catalog (generated by `tools/gen_catalog.js` from `specs/galaxyz/elements.json`; 95 elements). Names, prices, factors and requirements are **[REAL]** (list pages, techtree, fleetDealer `CostInfo`); ship/defence stats and rapidfire **[UPSTREAM]** 2Moons. 2Moons ids: 213 Star Fighter … 220 Dark Matter Collector (217 Battle Transporter, 219 Battle Recycler), 6 University, 71-73 fork-only conveyors (price unknown: `priceKnown: false`, all zero), 124 Expedition Research, 131-133 resource research, 409-411, officers 601-615, dark matter boosts 701-707. The OgameX catalog is retired (`tools/legacy-ogamex/gen_catalog.js`).

```js
CatalogObject = { id, machine /* 2Moons key, e.g. 'small_ship_cargo' */, className /* camelCase key */,
                  type: 'building'|'station'|'research'|'ship'|'defense'|'officer'|'boost', page /* OgameX page name */, gzPage /* buildings|research|shipyard|officier */,
                  planetType: 'planet'|'moon'|'both', classOnly: null, price: { metal, crystal, deuterium, energy, darkMatter, factor, round100: false }, priceKnown,
                  maxLevel, onePerPlanet, req: [[id, lvl]], rapidfire: { [targetId]: n }, rapidfireFrom: { [shooterId]: n },
                  props: null|{ structural, shield, attack, speed, cargo, fuel, fuelCapacity, speed2?, fuel2?, speedTech? }, drive: null|{ base, upgrades: [{ drive, level, speed: null }] },
                  ru, ruShort, en /* real English page title */, missile?, civil?, bonus? /* officers/boosts: { Resource: 0.05, ... } per level */, forkOnly? }
catalog.get(id | machine | className) -> CatalogObject|null
catalog.list(type?) -> CatalogObject[]          // game order; no type = building, station, research, ship, defense (officers/boosts only on request)
catalog.shipIds   // 202..220 ; fleetShipIds (no 212) ; civilShipIds [202,203,208,209,210,212,217,219,220] ; defenseIds 401..411,502,503
catalog.researchIds (page order) ; catalog.officerIds ; catalog.boostIds ; catalog.buildingIds(planetType)
catalog.idFromTitle(title) -> id|null           // server titles (state.titles) first, then the embedded English/Russian names
catalog.name(id) -> ru ; catalog.shortName(id) -> ruShort
catalog.missions ; catalog.missionName(m)       // 1 Атака … 11 Добыча ТМ, 15 Экспедиция
```

## 10. `10-calc.js`: `OGX.calc` (GALAXYZ / 2Moons)

Formulas of upstream 2Moons with the Aeternum constants `calc.gz` (mechanics.md §0): production ×22000 (`resourceMultiplier`), storage ×5, basic income 20/10/0, energy speed 1, fleet speed 7 (`fleetStep1 gamespeed`), loot 50 %, debris 30 %/0 % [UPSTREAM], **`gameSpeed` (build/research/shipyard time) unknown = null**. No player classes, crawlers, plasma or position bonuses: those parameters are accepted and ignored. Officer effects come from `officers: { 601: 18, ... }` (or `boosts: [701, ...]`, or a ready `factors` object).

```js
calc.gz ; calc.config(server) -> calc.gz overridden by same-named server keys ; calc.factors({ officers, boosts }) -> { Resource, Energy, BuildTime, ShipStorage, FleetSlots, FlyTime, ... }
calc.cost(id, level) -> { metal, crystal, deuterium, energy }  // floor(cost x factor^(level-1)); units: per piece
calc.costRange(id, fromExcl, toIncl) ; calc.unitCost(id, n) ; calc.downgradeCost(id, level)   // tear-down = half price, no ion discount
calc.buildTime(id, targetLevel, { robotics, nanite, gameSpeed|economySpeed, officers|factors, destroy }) -> s   // (m+c)/(2500·speed·(1+robot))·0.5^nanite
calc.unitTime(id, { shipyard, nanite, gameSpeed|economySpeed, officers }) -> s per unit (>= 1)
calc.researchTime(id, targetLevel, { labLevel, university, gameSpeed|economySpeed, officers }) -> s ; calc.effectiveLab(id, currentLab, otherLabs, irnLevel)
//   speed = gameSpeed option, else calc.gz.gameSpeed (unknown), else economySpeed, else 1 — times are x1 estimates until the game speed is known
calc.halvingCost(remainingSecs, kind)            // OgameX rule kept; GALAXYZ halving unknown
calc.storageCapacity(level, server?)             // floor(2.5·1.8331954764^L)·5000·5 (L18 = 3 416 925 000)
calc.positionBonus() -> [1, 1, 1] ; calc.producerIds = [1, 2, 3, 4, 12, 212]
calc.production({ levels, percents (0..100), ships: {212}, tempMax, isMoon, research: {113,131,132,133}, officers, boosts, server })
  -> { perHour: Res (exact ticker float, incl. basic income and bonus), energy: { production, consumption, balance }, factor (0..1),
       breakdown: { base, mines, bonus, use, position: 0, plasma: 0, class: 0, crawler: 0 }, maxCrawlers: 0 }
calc.amountAt({ amount, storage, perHour, t }, at) ; calc.secondsUntilFull(r, at) ; calc.timeUntilAffordable(cost, { metal: r, crystal: r, deuterium: r }, at)
//   amountAt (2Moons ExecCalc): grows while the stock is <= storage (capped there); negative production always applies, floors at 0
calc.costOverlay(cost, resources, at, { capSC, capLC }) -> { total, missingTotal, rows, sc, lc, secondsUntilAffordable }
calc.shipSpeed(id, research) ; calc.shipFuel(id, research) ; calc.cargoCapacity(id, research, _, { officers }) ; calc.fuelCapacity(id, research, { officers })
//   speed: base·(1 + 0.1 combustion | 0.2 impulse | 0.3 hyperspace per level); 202 impulse from impulse 5, 211 hyperspace from hyperspace 8
//   cargo: base·(1 + 0.5·officer 607); NO hyperspace-tech cargo bonus
calc.shipStats(research, _, { officers }) -> { [id]: { speed, cargo, fuel, fuelConsumption, fuelCapacity } }
calc.statsFromShipsData(checkTargetShipsData) (OgameX) ; calc.statsFromStep1(fleetStep1 data.ships, { officers }) -> same shape
calc.distance(a, b) -> 20000·dg | 2700 + 95·ds | 1000 + 5·dp | 5   // no circular galaxies/systems, no empty-system skipping
calc.missionSpeedClass(m) ; calc.missionSpeedFactor(m, server) -> server.fleetSpeed || 7 (one factor for every mission)
calc.flightDuration({ distance, maxSpeed, speedPct (1..10), speedFactor (gamespeed), flyFactor = 1 }) -> s (>= 5; Infinity when no speed)
calc.fleetMaxSpeed(ships, stats)
calc.fuel({ ships, stats, distance, duration, speedFactor, variant: 'client'|'server', fleetSpeed, speedPct }) -> round(Σ ...) + 1; hold time costs nothing
calc.fleetCargo(ships, stats) ; calc.cargoNeeded(amount, shipId, stats, { reservePct })
calc.slots({ computer, astrophysics, bonusExpeditionSlots, officers }) -> { fleet: 1 + computer + 3·611, expedition: floor(sqrt(astro)) }
calc.lootPct() -> 0.5 ; calc.distributeLoot(lootRes, capacity) (calculateSteal fill order) ; calc.loot(res, { cargo=Infinity, pct? }) -> Res & { total }
calc.lootCapacity(lootRes) -> integer   // smallest capacity for which distributeLoot takes the whole loot (metal alone needs 1.5 x); 0 for no loot
calc.debris(lostUnits, server) -> Res ; calc.moonChance(debrisTotal, max=20, moonFactor=1) = min(round(debris/100000·f), max)
calc.unitsValue(units) -> Res & { total, points } ; calc.msu(res, rates)
calc.expeditionPoints(ships) ; calc.baseCargo(ships) -> sum(pricelist cargo x n)   // no Storage expert 607 (what MissionCaseExpedition counts)
calc.expeditionMaxFind({ ships, cargo?, cargoOnBoard=0 }) -> { metal, crystal, deuterium, min, base, points, free, cargoBase, limitedByCargo, normal, rare, exceptional }
//   = min(free cargo, 200 x expedition points) for every event size (upstream quirk); free = cargo when given, else baseCargo(ships) minus
//   cargoOnBoard (number or Res); 0 without ships. The old `stats` argument is ignored (officers never raise the find).
calc.expeditionShipFind({ points, topPoints }) -> { normal, rare, exceptional, cap, capKnown, capped }   // [UPSTREAM]
//   max(round(size x min(points, topPoints >= 5e6 ? 6000 : 4500)), 10000), size 50 / 100 / 200; topPoints null -> cap 4500, capKnown false
calc.expeditionMinShips(maxMetal, stats) -> { 202: n, 203: n }
calc.phalanxRange(level) (1 -> 1, else L²-1) ; calc.missileRange(impulseLevel)
```

Known values (tests/gz-catalog.test.js, all from real pages): buy buttons on buildings/research explained 34/34 by `cost(id, L+1)` vs stock (energy vs produced energy). `production` of the main planet = resourceTicker 1 932 927 923.2055 / 822 497 302.17436 / 394 585 191.6862 per hour; energy 49 544 / free 2 502 with Engineer 4 (pages saved later) and 47 480 / 438 with Engineer 3 (officier/overview). Colony ship from [2:68:5] at 100 %: [2:68:9] 1020 / 653 s / 118 deut, [3:68:5] 20000 / 2888 s / 2287. Recyclers (combustion 12) [2:68:5] -> [2:87:8] 1601 s. Slots 13 / 2.

## 11. `11-parse.js`: `OGX.parse`

Every parser accepts a `Document` or an HTML string and never throws on missing markup.

```js
parse.csrf(doc) ; parse.metas(doc) -> { version, economySpeed, fleetSpeed, playerId, playerName, planetId, planetName, planetCoords, lang }
parse.serverTimeString(doc|html) -> string|null
parse.planetList(doc, base) -> [{ planetId, rowId, name, coords, diameter, fieldsUsed, fieldsMax, tempMin, tempMax, building, downgrading, isCurrent,
                                  moon: null|{ id, name, diameter, fieldsUsed, fieldsMax, isCurrent } }]
parse.currentBody(doc, base) -> { key, id, isMoon, planetId, coords, name }
parse.player(doc) -> { id, name, playerClass, darkMatter, rank, isAdmin, unreadMessages }
parse.inlineResources(doc|html) -> { metal|crystal|deuterium: { amount, storage, perSecond, perHour }, energy, darkmatter }
parse.resourceTooltips(doc) -> { metal|crystal|deuterium: { amount, storage, perHour }, energy: { available, production, consumption } }
parse.techList(doc) -> [{ id, className, status: 'on'|'off'|'disabled'|'active', value, target, isUnit }]
parse.queueTimers(doc|html) -> { building, research, unit, cancelIds }     // DESIGN §2.11 shapes
parse.resourceSettings(doc) -> { percents: { [id]: pct }, factor }
parse.overviewInfo(doc|html) -> { diameter, fieldsUsed, fieldsMax, tempMin, tempMax, coords, points }
parse.fleetPage(doc|html) -> { shipsOnPlanet, slots, expSlots, speedFactors: { peaceful, war, holding }, currentPlanet, ownBodies, maxGalaxy, maxSystem, resources, titles }
parse.techDetails(json) / parse.techDetailsElement(el) -> { id, current, nextLevel, durationSecs, costs, energyNeeded, energyProduction, maxAmount, canBuild, canDowngrade, demolish }
parse.shipProps(html) -> { structural, shield, attack, speed, capacity, consumption }
parse.serverSettings(html) -> { universeName, economySpeed, researchSpeed, fleetSpeedWar, fleetSpeedHolding, fleetSpeedPeaceful, galaxies, systems,
                                debrisFleetPct, debrisDefensePct, debrisDeuterium, acs, ignoreEmpty, ignoreInactive, planetFieldBonus, darkMatterBonus }
parse.titles(doc) -> { [title]: id }
parse.highscorePlayers(html|doc) -> { category: 1, type, page, pages, rows: [{ id, rank, name, me, admin, homeCoords, allianceId, allianceTag, points, totalShips }] }
//   engine-aware, GALAXYZ shapes below
parse.highscoreAlliances(html) -> { category: 2, type, rows: [{ id, rank, name, tag, members, points, average }] }   // OgameX only (GALAXYZ: parse.gz.statistics)
parse.topScore(html) -> { playerId, points, rank? } | null   // GALAXYZ: a statistics page of type points (rank 1 row), else null
```

**GALAXYZ** (the same functions switch to the GALAXYZ recipes when the document has the GALAXYZ generator meta, fetched documents included):

| parser | GALAXYZ source / result | not available (null / empty) |
|---|---|---|
| `csrf` | `''` (no CSRF; fleet forms carry their own `token`) | |
| `metas` | `version` = generator version (`1.8.git`), `playerName`, `planetId/Name/Coords` from header + selector, `lang` (`var Lang`), `+ generator, engine` | `economySpeed`, `fleetSpeed`, `playerId` (unless on the page) |
| `serverTimeString` | `'Y-m-d H:i:s'` from `new Date(Y, M0, D, h, m, s)` | |
| `planetList` | `#planetSelector` (all bodies, moons "(Moon)") merged with `#rechts .smallplanet` (title tooltip: temp, diameter, fields; `i.buildingIco` = `building`) [REAL] | `rowId`, `downgrading`; tooltip fields and `building` are `null` on info pages and fleetStep3 (no `#rechts`); moon markup [UPSTREAM/GUESS] |
| `currentBody` | `#planetSelector option[selected]`; moon by "(Moon)" label | |
| `player` | `name` (`#playerName`), `rank` (`#bar` statistics `range`), `unreadMessages`, `darkMatter` (`#current_darkmatter[data-real]`), `isAdmin` (`var auth`), `+ vacation` (`parse.gz.vacation`: the vacation infobox wins, because in vacation the game omits `var vacation` entirely [UPSTREAM main.topnav.tpl]), `vacationUntil` (text or null), `lang` | `id` (only where `Dialog.Playercard(id, '<name>')` names the player: page=tournament [REAL]), `playerClass` = `'none'` |
| `inlineResources` | `resourceTicker({available, limit, production /h})` floats; `perSecond` = perHour/3600; `energy` = free energy; `darkmatter` | |
| `resourceTooltips` | icon `title` tooltips `{amount, storage, perHour}`; `energy` = `{available: free, production: produced, consumption}` from `t="free / produced"` | |
| `techList` | `ul.icons > li.technology[data-technology]`: `value` (level/amount), `status` `'off'` (requirements unmet) / `'on'` (buildings, research: `button.upgrade`; units: order form) / `'disabled'`; `+ name` | `target`, `'active'` (no running state on items) |
| `queueTimers` | `+ known: { box, unit }`; `unit` from the inline shipyard `data.Queue` (`[name, count, secsPerUnit, id]`) [REAL empty] | `building`, `research` (the list-page box was only seen empty: `known.box` false when it has content) |
| `resourceSettings` | `percents` 0..100 from `select[name=prod[ID]]` (0..10), `+ rows` | `factor` |
| `overviewInfo` | `#planetDetails`: diameter, fields, temp, coords, `points`, `+ rank, players, planetName, onlinePlayers, moonId, constructions` (3 boxes; active markup [UPSTREAM]) | |
| `fleetPage` | page=fleetTable: `shipsOnPlanet`, `slots`, `expSlots`, `titles`, `noShips`; fleetStep1: `speedFactors.*` = `data.gamespeed` (7 on Aeternum), `targetPlanet`, `mission`; `+ gz: { fleetTable, step1, step2 }` | `currentPlanet`, `ownBodies`, `maxGalaxy/System` |
| `techDetails(json)` | `{target, content: {[target]: html}}` of `*DetailsAjax`: `costs` (next level), `current`, `canBuild`, `+ flags, form` [UNVERIFIED panel markup] | `durationSecs`, energy, demolish |
| `titles` | list item names + fleetTable ship names -> id | |
| `highscorePlayers` | page=statistics (who=1) [UPSTREAM]: `{ category: 1, type /* OgameX-mapped */, gzType, page, pages, source: 'statistics', engine: 'galaxyz', unverified: true, updated, rows: [{ id, rank, name, me, admin: false, homeCoords: null, allianceId, allianceTag: undefined /* GZ shows names */, allianceName, points, totalShips: null, change }] }`; a playerCard html (from `api.highscore({searchRelId})`): `source: 'playerCard'`, one row `{ rank = total rank, points = total, homeCoords, allianceId, allianceName, card }` | an alliance page (who=2) or a page without a ranking table: `rows: []` **plus `error`** (never a silent empty list) |
| `topScore` | statistics page with `gzType` 1 (points): rank-1 row -> `{ playerId, rank, points }` | other pages: `null` |
| `shipProps`, `serverSettings`, `highscoreAlliances` | — | OgameX only |

GALAXYZ-only parsers (`OGX.parse.gz`, all take a Document or HTML):

```js
gz.is(doc) -> boolean
gz.serverTime(doc) -> { wall: 'Y-m-d H:i:s', userOffsetSec, renderUnix | null }
gz.bodies(doc) -> { list: [{ id, name, coords, isMoon, selected, listed, building, active, tip }], count: { used, max } | null, hasList }
gz.resources(doc) -> { metal|crystal|deuterium: { amount, storage, perHour, perSecond }, energy: { available, production, consumption }, darkmatter, tooltips }
gz.player(doc) -> { id|null, name, rank, unreadMessages, vacation, authLevel, lang }
gz.events(doc) -> [{ key, fleetId, endUnix, restSec, status: 'flight'|'return'|'holding', own, style, mission, from, to, hostile, ownerId, shipsText, cargoText, text }]
//   event box of every full page, de-duplicated by id, from = origin / to = target on both legs; expedition = *transport to position 16 -> 15.
//   Hostile/foreign markup (no 'own', Dialog.PM) [UPSTREAM].
gz.overview(doc) ; gz.techItems(doc) ; gz.queueBox(doc) ; gz.shipyardQueue(doc) ; gz.resourceSettings(doc)
//   queueBox -> { title, empty, timers, items: [{ id, level|null, restSec|null (head), endUnix|null }] } | null  (items markup [UPSTREAM])
gz.empire(doc) -> { columns: [{ cp, name, coords, fieldsUsed, fieldsMax, image }], bodies: { [cp]: { resources: {901,902,903,911}, buildings, ships, defense } }, research, warnings } | null
//   page=imperium; columns are NOT in planet-list order; 911 = energy production; missiles 502/503 are not in it
gz.officers(doc) -> { darkMatter, officers: [{ id, name, level, max, locked }] } | null
gz.fleetTable(doc) -> { slots, expeditions, extraCounters, flights: [{ index, fleetId, missionName, missionId, returning, amount, ships, origin, target, arrivalText, returnText, timerUnix, timerRestSec, recallable }], ships: [{ id, name, count, speed, selectable }], prefill, canContinue, bonus, noFreeSlots }
gz.fleetStep1(doc) -> { token, fleetGroup, targetMission, target, data: { fleetroom, gamespeed, fleetspeedfactor, planet, maxspeed, ships, fleetMinDuration }, colonies } | null
gz.fleetStep2(doc) -> { token, missions: [{ id, name, checked }], stayOptions, consumption, data } | null
gz.fleetStep3(doc) -> { success: true, missionId, distance, maxSpeed, consumption, from, to, arrivalText, returnText, ships } | { success: false, message }
gz.infoMessage(doc) -> text of an info/error page | null ; gz.inlineData(doc) ; gz.missionIdByName(name) ; gz.techPanel(html) [UNVERIFIED] ; gz.STYLE_MISSION
gz.vacation(doc) -> { vacation: boolean, until: text | null, source: 'infobox' | 'var' | 'none' }   // infobox tn_vacation_mode (en/ru/de) first, then `var vacation`
// [UPSTREAM 2Moons 1.8 templates, never saved live from the fork: every result has unverified: true; no table -> rows [] + error]
gz.statistics(doc|html) -> { who: 1|2, type /* 1 points 2 fleet 3 research 4 buildings 5 defense */, range, updated, pages,
                             rows: [{ kind: 'player', rank, change, id, name, me, allianceId, allianceName, points }
                                  | { kind: 'alliance', rank, change, id, name, members, points, perMember }], unverified, error? }
gz.searchResult(doc|html) -> { kind: 'player' | 'alliance', rows, unverified, error? }
gz.playerCard(doc|html) -> { id, name, homePlanet, homeCoords, allianceId, allianceName, points: { buildings, research, fleet, defense, total },
                             ranks: { ... }, fights: { won, draw, lost, total: { count, pct } }, units: { destroyed, lost }, debris: { metal, crystal }, unverified, error? }
gz.STAT_TYPE_FROM_OGX = { 0: 1, 1: 4, 2: 3, 3: 2, 5: 5 } ; gz.STAT_TYPE_TO_OGX   // OgameX highscore type <-> GALAXYZ statistics type
```

## 12. `12-http.js`: `OGX.http`, `OGX.api`

```js
http.request(path, { method='GET', query, form, headers, cp, expect: 'auto'|'json'|'text'|'doc', timeout=20000, keepalive, background }) -> Promise<HttpResult>
HttpResult = { ok, status, url, redirected, loggedOut, json?, text?, doc?, error? }
//   Same origin, credentials included, X-Requested-With, X-CSRF-TOKEN, X-OGX: 1 (so the page hook does not journal it twice), and form bodies always carry _token.
//   Every request is journaled (N, by 'ogx', form redacted) and its JSON key schema learned (OGX.learn.api); a 419 is journaled before the retry.
//   On 419 it refreshes the token from /overview and retries once. It adopts newAjaxToken (except the junk constant) and calibrates time.
//   background: true -> polite queue (one at a time, core.httpGapMs apart, paused while hidden unless core.backgroundWhenHidden)
http.get(path, opts) ; http.post(path, form, opts) ; http.csrf() ; http.queueLength()
http.withPlanet(bodyId, fn, { restoreTo, lockWaitMs=60000 }) -> Promise<fn result>
//   cross-tab lock 'cp'; requests inside get ?cp=bodyId; afterwards GET /overview?cp=<restoreTo ?? original>; keepalive restore on pagehide

api.page(path, { cp, query, background }) -> { html, doc, url, redirected } | { error, status, loggedOut }
api.techDetails(id, { cp, background }) -> TechDetails | error
api.techtree(tab, objectId) -> html | error
api.serverSettings() -> ServerSettings | error
api.eventList() -> html | error ; api.eventBox() -> { hostile, neutral, friendly, eventType, eventTime, eventText } | error
api.movement() -> { doc, html } | { empty: true } | error
api.checkTarget({ galaxy, system, position, type=1, ships, union=0 }, { cp }) -> json | error
api.sendFleet(SendFleetRequest, { cp }) -> { success, message, errors: [{ message, error }] }
  SendFleetRequest = { galaxy, system, position, type, mission, ships, speed (1..10, step 0.5), cargo: Res, holdingtime=0, union=0 }
api.sendMiniFleet({ mission: 6|8, galaxy, system, position, type=1, shipCount=1, planetId? }, { cp }) -> { success, message, shipsSent, ... }   // GALAXYZ shape below
api.resolvePlanetId(target, type?) -> { planetId, source, t, coords, type } | { planetId: null, error, suggestion, galaxyUrl, coords, type }   // GALAXYZ, never a request
api.recall(missionId) -> { success, status }
api.templates() -> [{ id, name, ships }] | error
api.galaxy(g, s, { background=false }) -> { json } | { error, status, loggedOut, json }    // never sends cp
api.highscore({ category=1, type=0, page, searchRelId, background }) -> html | error
api.search(term, category=2 /* 2 players, 3 planets, 4 alliance names, 5 alliance tags (GALAXYZ) */) -> json | error
api.playerCard(id, { background, raw }) -> parse.gz.playerCard result | marked html | error   // GALAXYZ only (OgameX: { error, unsupported: true })
api.raport(reportId, { background }) -> { doc, html, reportId } | error                       // GALAXYZ only (combat report popup)
api.messagesList(tab, subtab, page=1, { background }) -> { doc, html } | error ; api.message(id, tab, subtab) -> { doc, html } | error
api.deleteMessage(id, { confirm }) -> Promise<boolean>   // confirms when core.confirmActions; pass { confirm: false } after your own dialog
api.addBuild(page, id, { amount=1, downgrade=false, cp, confirm }) -> { ok, message, cancelled? }   // defense -> /shipyard/add-buildrequest
// sendFleet, sendMiniFleet, recall, addBuild, deleteMessage are wrapped by OGX.log.wrap('api', fn, name): each call is a B event.
```

**GALAXYZ** transport: every path goes through `OGX.page.url` (so `http.get('/fleet')`, `http.get('fleetTable')` and `http.get('game.php?page=fleetTable')` all work; `query` keys are renamed like page.url). No `_token`, no `X-CSRF-TOKEN`, no 419 retry. `loggedOut` = redirected away from `/game.php` (upstream sends expired sessions to `index.php?code=3`). AJAX answers are JSON text served as `text/html`: pass `expect: 'json'`. `cp` is sticky server-side (it switches the active planet of the whole session): pass it explicitly; `withPlanet` restores with `GET ?page=overview&ajax=1&cp=<original>` [UPSTREAM: cp is read with ajax=1 too].

| api | GALAXYZ |
|---|---|
| `page(path, {cp, query})` | any page (`'/defense'`, `'imperium'`) -> `{ html, doc, url }` |
| `techDetails(id)` | `TechnologyDetailsAjax` (<100) / `ResearchDetailsAjax` (1xx) / `ShipDetailsAjax` (2xx-5xx) / `CommanderDetailsAjax` (6xx, `type=undefined`) -> parse.techDetails + `html` [UNVERIFIED panel] |
| `techtree()` | page=techtree html |
| `eventList()` | page=fleetTable html (the event box is on every page; parse with `parse.gz.events`) |
| `movement()` | page=fleetTable `{ doc, html }` (never `{ empty }`) |
| `checkTarget({galaxy, system, position, type})` | `fleetStep1&mode=checkTarget` -> `{ ok, message }` (different shape: no shipsData) [REAL-JS] |
| `sendFleet(req, {cp})` | three POSTs fleetStep1 -> 2 -> 3 with `cp` on each (token from step 1; mission must be offered by step 2; `holdingtime` -> `staytime`, default first option) -> `{ success, step, message, errors, result? }` [REAL forms, not sent live] |
| `resolvePlanetId(target, type?)` | target = `{galaxy, system, position\|planet, type}` \| `'g:s:p'` \| `[g,s,p]`; type 1 planet, 2 debris (= the planet row id), 3 moon. Looks, in order, at the galaxy page open in this tab (`source: 'galaxy-page'`), the galaxy cache (`'galaxy-cache'`, filled by every galaxy page the user opened), the player index (`'player-index'`), the user's own bodies (`'own-body'`) -> `{ planetId, source, t /* ServerMs of that data \| null */, coords: 'g:s:p', type }`. **Never sends a request** (galaxy views cost deuterium). Unknown -> `{ planetId: null, error /* ru: «GALAXYZ: id цели g:s:p неизвестен» */, suggestion /* ru: open system g:s in the galaxy (costs deuterium), then retry */, galaxyUrl, coords, type }`. Spy reports and messages carry no planet ids [REAL] |
| `sendMiniFleet({mission, galaxy, system, position, type, planetId?}, {cp})` | GET `fleetAjax&ajax=1&mission&planetID` [UPSTREAM]. `planetId` optional: resolved from the coordinates via `resolvePlanetId` (mission 8 resolves type 2). The server picks the ship count (probe setting / debris size): `shipCount` is ignored. -> `{ success: code === 600, message, shipsSent /* number parsed from the server text; 0 on failure; null if the text has none */, code, slots, shipsLeft, planetId, resolvedBy: 'given' \| <source>, targetCoords /* from the text */, mismatch /* the server named other coords: stale cached id, the fleet WAS sent */ }`. Unresolved: `{ success: false, shipsSent: 0, code: null, unresolved: true, message, suggestion, galaxyUrl }` and **nothing is sent** |
| `recall(fleetId)` | POST `fleetTable&action=sendfleetback` `fleetID` -> success when the row lost its recall form [REAL form] |
| `addBuild(page, id, {amount, downgrade, cp})` | POST `buildings` `cmd=insert\|destroy&building`, `research` `cmd=insert&tech`, `shipyard` `fmenge[id]=amount` -> `{ ok: no info page, message, doc }`; page `'buildings'` accepted; one level per call |
| `messagesList(cat, _, site)` | `messages&mode=view&messcat=&site=&ajax=1` `{ doc, html }`. **Marks the category read** |
| `deleteMessage(id, {confirm, cat=100})` | POST `messages` `mode=action&ajax=1&messcat&side=1&actionTop=deletemarked&submitTop=Confirm&messageID[id]=1` -> `r.ok` (answer not captured) |
| `templates()` | `[]` |
| `highscore({category, type, page, searchRelId})` [UPSTREAM] | GET `statistics&who=(category 2 ? 2 : 1)&type=(OgameX type 0->1 points, 1->4 buildings, 2->3 research, 3->2 fleet, 5->5)&range=(page-1)*100+1` -> html (parse with `parse.highscorePlayers` / `parse.gz.statistics`). With `searchRelId`: GET `playerCard&id=N` -> html prefixed `<!--ogx-playercard:N-->`. A free background GET (no deuterium) |
| `playerCard(id, {raw})` [UPSTREAM] | GET `playerCard&id` -> `parse.gz.playerCard` result (raw: the marked html) |
| `search(term, category)` [UPSTREAM] | GET `search&mode=result&ajax=1&type=playername\|planetname\|allyname\|allytag&search=term` -> `{ status: 'success', engine: 'galaxyz', unverified: true, results }`; results: player `{ id, type: 'player', name, owner_id, owner_name, coordinates /* home */, planetName, allianceId, allianceName, rank }`, planet `{ id: null, type: 'planet', name /* planet */, owner_id, owner_name, coordinates, rank }`, alliance `{ id: null, type: 'alliance', name, tag, members, points }`. Empty term: `{ status: 'error', message: 'no search term', results: [] }`; unparsable page: `status: 'error'` + message |
| `raport(reportId)` [UPSTREAM] | GET `raport&raport=<id>` -> `{ doc, html, reportId }` (combat report; `messages.fetchRaport` parses it) |
| `galaxy(g, s)` | `{ error, unsupported: true, json: null }` on purpose: use `OGX.galaxy.fetch(g, s, { userStarted: true })` (each view costs deuterium, §17) |
| `serverSettings`, `eventBox`, `message` | `{ error, unsupported: true }` (`message`: use `messages.fetchDetail` / `messages.full`, §18) |

## 13. `13-bridge.js` and `main/page-hook.js`: `OGX.bridge`

The page hook (MAIN world, version `0.4.0`) installs once per page: a second copy (another extension of the suite) is detected with the synchronous CustomEvent `ogx:hook-probe` (`detail.found`), not with a window global. `window.__ogxHook` and the `ogx:call` replies exist **only on game pages** (OgameX `meta[name=ogame-version]`, or the GALAXYZ check below), checked lazily (positive answer cached). Caveat: an older already-installed hook does not answer the probe, so two extensions on different builds may relay XHRs twice; all three are built from this source. GALAXYZ: the hook is active when the generator meta says GALAXYZ/2Moons and the path is `/game.php`; it relays the game's XHRs (jQuery) whose `page[&mode]` (URL query or POST body, lower-cased) is `technologydetailsajax|researchdetailsajax|shipdetailsajax|commanderdetailsajax`, `fleetajax`, `messages&mode=view|action`, `fleetstep1&mode=checktarget`. XhrEvent gets `page`, `mode` and `route = 'page=<page>[&mode=<mode>]'`; `onXhr(re)` tests `re` against the path and the route, e.g. `bridge.onXhr(/^page=fleetajax\b/, fn)`. OgameX: it relays XHRs on these paths: `/ajax/galaxy`, `/ajax/fleet/dispatch/(check-target|send-fleet|send-mini-fleet|recall-fleet)`, `/ajax/fleet/eventlist/fetch`, `/ajax/fleet/eventbox/fetch`, `/ajax/messages[/<id>]`, `/ajax/highscore`, `/ajax/search`, `/ajax/(resources|facilities|research|shipyard|defense)`, and `/(resources|facilities|research|shipyard|defense)/add-buildrequest`. It relays only on pages with `meta[name=ogame-version]`. All event details are JSON strings.

Since hook `0.3.0` the `ogx:net` events sent before the isolated world listens are queued (max 300) and replayed when `22-diag.js` dispatches `ogx:net-ready` on `document` (it does so, and adds its listener, when the file loads — not in `diag.init`), so the game's first requests (`/ajax/galaxy`, `/ajax/fleet/templates`, `check-target`, ...) reach the journal; before `diag.init` they wait in the pre-init buffer and `learn.api`'s pending list, and are dropped when the boot gate refuses. `ping` answers `{ ok, version: '0.4.0' }`. Since hook `0.2.0` it also wraps `fetch` and `XMLHttpRequest` for **every same-origin request** of the page (requests with the header `X-OGX` excluded) and dispatches `ogx:net` with `{ m, u, st, ms, sz, err, b /* request body, max 4000 chars */, keys? /* JSON key schema */, safe? /* success/status/message/errors */ }` — never the response body. `22-diag.js` turns it into N events (redacted) and feeds `OGX.learn.api`.

```js
XhrEvent = { url, method, status, requestBody, responseText, t, path, query: {}, form: {}, json: any|null }
bridge.init()
bridge.onXhr(pathRegex /* matched against pathname */, fn(XhrEvent)) -> unsubscribe
bridge.call(method, ...args) -> Promise<result>     // rejects after 3000 ms or on a page-world error
//   GALAXYZ: 'fleet.*' resolve locally (isolated world) to OGX.fleet.gz.bridge (§16), same arguments as on OgameX, fleet.gz result shapes;
//   'fleet.setDuration' -> setStaytime; 'fleet.goStep' / 'fleet.submit' -> { ok: false, error: 'manual', message } (never act).
//   A direct page-world ogx:call to fleet.* on GALAXYZ returns { ok: false, error: 'gz' }.
bridge.available() -> Promise<boolean>
```

Page-world methods. Each returns `{ ok: false }` when the game global is missing.

| Method | What it does |
|---|---|
| `fleet.state()` | Reads the dispatcher state. OgameX: the page's `fleetDispatcher`. GALAXYZ: answered in the isolated world by `fleet.gz.state()` (three plain forms, no dispatcher object). |
| `fleet.selectShips(ships)` | Selects ships on fleet step 1. |
| `fleet.setTarget({ galaxy, system, position, type })` | Sets the target. |
| `fleet.selectMission(m)` | Selects the mission. |
| `fleet.setCargo(res)` | Fills the cargo fields. |
| `fleet.setSpeed(pct10)` | Sets the speed (1..10). |
| `fleet.setDuration(hours)` | Sets the holding or expedition time. |
| `fleet.goStep(1\|2)` | Switches the dispatch step. |
| `fleet.submit()` | Submits the fleet. Call it only from a user click. |
| `galaxy.load(g, s)` | Loads a galaxy system. |
| `galaxy.repair(fromPos)` | Repairs the galaxy render crash from that position on. |
| `resources.live()` | Returns `{ ok, metal\|crystal\|deuterium\|energy\|darkmatter: { amount, storage, production } }`. GALAXYZ: amount = ticked cell value (`data-tooltip-content`), storage/production (per hour) from `resourceTicker`, energy `{ amount: free, production }`. |
| `gz.globals()` | GALAXYZ: `{ ok, serverWall: [Y, M0, D, h, m, s], serverTimeMs, startTime, ServerTimezoneOffset, queryString, Lang, vacation, viewShortlyNumber, auth }`. |
| `ping` | Returns `{ ok, version }`. |

## 14. `14-state.js`: `OGX.state`

```js
state.snapshotSync(doc=document, pageName?) -> PageSnapshot   // { parsedAtMs, page, serverTimeString, metas, player, csrf, current, planets, tooltips, inline,
                                                               //   techList?, titles?, queueBoxes?, queues?, overviewInfo?, resourceSettings?, fleetPage?, movement?, movementSlots? }
state.snapshot() -> the boot snapshot ; state.current() -> { key, id, isMoon, planetId, coords, name }   // sync
state.merge(snap, { t }?) -> Promise          // per-field timestamps: older data never replaces newer data; emits state:updated
state.bodies() -> Promise<{ [BodyKey]: Body }> ; state.body(key) ; state.bodyList() -> [{ planet, moon|null }] (planet-list order)
state.research() -> { levels, t, queue: { objectId, targetLevel, endsAt } | null }
state.player() -> { id, name, playerClass, darkMatter, rank, isAdmin, unreadMessages, t }
//   GALAXYZ: id null until page=tournament was seen, playerClass 'none', + vacation, vacationUntil (text | null), officers { id: level } (page=officier), lang
state.slots() -> { fleet: { used, max }, expedition: { used, max }, t, fleetT, expeditionT, fleetSrc, expeditionSrc } | null
state.applySent({ originId, ships, cargo, consumption }) -> Promise<BodyKey|null>   // own send: ships, cargo and fuel leave the origin
//   (floored at 0, res.t and shipsT unchanged), slots.fleet.used + 1; emits state:updated ['bodies','slots']
state.cargoMeasured() -> { factor, t, ships, fleetroom, o607 } | null   // null when a newer officier page (player.officersT > t) shows another 607 level than o607
//   GALAXYZ state.shipStats(): with a measurement every cargo = round(props cargo x factor), src 'fleetroom' (wins over the 607 calc)
//   GALAXYZ fleetTable merge: every fleet ship type not listed is 0 (an empty list / #warning = known empty fleet); 212 kept unless listed
//   GALAXYZ sources: page=fleetTable (both kinds, src 'fleetTable') and the page=galaxy header "1/13 Fleet Slots" (fleet only, src 'galaxy');
//   a page showing one kind keeps the other with its own older <kind>T. Use <kind>T || t for the age of a kind.
state.combatBonus() -> { attack, defense, shield, combustion, impulse, hyperspace /* % */, t } | null   // GALAXYZ page=fleetTable «Bonus» table as last seen
state.server() -> ServerSettings & { fleetSpeed, fleetSpeedKnown, economySpeedKnown, researchSpeedKnown, galaxiesKnown, systemsKnown, tzOffsetMs, settingsT?, t }
//   galaxiesKnown / systemsKnown false = galaxies 9 / systems 499 are the 2Moons defaults (GALAXYZ shows no MAX_GALAXY on the saved pages)
//   defaults: OgameX economy/research 1, speeds 1; 9 galaxies, 499 systems, debris 30%/0%.
//   GALAXYZ: economySpeed and researchSpeed = null (unknown: no page shows them), economySpeedKnown/researchSpeedKnown false;
//   fleet speeds = calc.gz.fleetSpeed (7) until a fleetStep1 page stored data.gamespeed, fleetSpeedKnown = a stored fleetSpeed exists.
//   Consumers: use `+srv.economySpeed || 1` for math and the *Known flags for display (Number.isFinite(+null) is true: never print x0).
state.factors() -> calc.factors({ officers: player.officers, boosts: player.boosts })   // GALAXYZ officers from page=officier; boosts not parsed yet (only officers count)
state.calcSlots() -> { fleet, expedition, known /* research seen */, officersKnown /* page=officier seen */ }   // calc.slots with 108/124 + Commander 611 (+3/level)
state.ensureServer({ maxAgeMs=86400000 }) -> Promise<server>   // fetches /overlay/server-settings when stale (background queue)
state.shipStats() -> { [id]: { speed, cargo, fuel, fuelCapacity, src: 'calc'|'checkTarget', t } }   // check-target data used when < 24 h old and newer than research
//   GALAXYZ: always 'calc', with officers (Storage expert 607: cargo +50 %/level). Use this instead of calc.cargoCapacity(id, research) in modules.
state.titles() -> Promise<{ [title]: id }> ; state.titlesSync()
state.ensureTopScore({ maxAgeMs=3600000 }) -> { points, playerId, t } | null   // GALAXYZ: background GET page=statistics (points, range 1) [UPSTREAM markup], no deuterium; also indexes the rows (galaxy.indexHighscore)
state.projected(body, at=now, { flights }) -> Body   // amounts by calc.amountAt; arrivals applied when flights are given
state.refreshBodies({ keys, include=['fleet'] /* fleet resources facilities shipyard defense settings research empire */, onProgress(done,total,key), signal })
  -> { done, errors: [{ key, error }], restored }     // the ?cp= pages need core.cpConfirmed (the caller shows the notice first); one restore at the end
//   GALAXYZ 'empire' = ONE GET page=imperium without cp, first (every body in one page): needs no cpConfirmed; include ['empire'] alone
//   switches no planet (restored true: the selected planet never changed)
state.onChange(keys | '*', fn({ keys })) -> unsubscribe
```

`Body` = `{ key, id, type, planetId, name, coords, diameter, fieldsUsed, fieldsMax, fieldsT, tempMin, tempMax, res: { metal|crystal|deuterium: { amount, storage, perHour }, t, src? } | null, energy: { available, production, consumption, t } | null, levels, levelsT: { resources?, facilities? }, ships, shipsT, defense, defenseT, percents, factor, percentsT, queues: { building: { objectId, targetLevel, endsAt, downgrade, queued } | null, unit: { endsAt, nextAt, remaining, techId, perUnitSecs, queued } | null, t }, constructionFlag, seenAt, order, moonKey? }`.

**GALAXYZ snapshot** (`snapshotSync` detects the engine from the document and routes by its `queryString`, so fetched pages work; the `pageName` argument is ignored): the common fields above (`csrf` `''`) plus `engine: 'galaxyz'`, `gzPage` (raw page, lower case), `mode`, `step`, `info`, `infoMessage`, `userOffsetSec`, `renderUnix`, `events` (`parse.gz.events`, every full page), `planetCount` (`#countColonies`), `empire` (page=imperium), `officers` (page=officier). `techList`/`titles`/`queues` on buildings, research and shipyard; `overviewInfo` on overview; `resourceSettings` on page=resources; `fleetPage` on fleetTable and fleetStep1/2.

**GALAXYZ merge:** page=buildings sets `levels` and both `levelsT.resources`/`levelsT.facilities`; fleetTable sets `ships` (every listed ship); page=resources sets `percents` (0..100, `factor` null); page=imperium updates **every** body (levels, ships, defense except 502/503, fields, stock when a ticker value exists, energy production) and `research`; page=officier stores `player.officers = { id: level }` and `player.darkMatter` with their own time `player.officersT` (an officier page older than the stored header fields `player.t` still fills missing or older officers). `player` is stored by name too, and a null `id` never replaces a known one (the id is learned on page=tournament). `server` gets `engine: 'galaxyz'`, `version` and `fleetSpeed` = fleetStep1 `gamespeed`. Queues: only boxes the parser could read replace stored queues. `constructionFlag` stays unchanged on pages without the planet list. `ensureServer()` returns `state.server()` without a request; `ensureTopScore()` fetches page=statistics in the background when the stored value is older than `maxAgeMs` (unparsable page: the stored value or null). `refreshBodies` fetches page=buildings once per body for `resources`+`facilities`, and accepts `include: ['empire']` (one page=imperium for every body). A body seen only on page=imperium (never opened) gets `res = { t, src: 'imperium', metal|crystal|deuterium: { amount, storage: null, perHour: null } }`; `state.projected` holds that amount flat. **Consumers:** `res.src === 'imperium'` (or `storage`/`perHour` null) means storage and production are unknown: show the amount, never a `+0/ч` rate, a fill bar or «full». `fieldsUsed`/`fieldsMax` follow their own time `fieldsT`: an older page (planet list, overview) never overwrites newer page=imperium values. Ships follow `shipsT` the same way: a page=fleetTable list older than a stored page=imperium snapshot does not replace it (with live pages the newer page wins). page=fleetTable also stores `combatBonus`; page=galaxy stores the fleet slots of its header. Not on GALAXYZ: `economySpeed`/`researchSpeed` (null, `*Known` false), check-target `shipStats` (always `src: 'calc'`), `playerClass` (`'none'`).

Captures on any page (via the bridge): OgameX check-target `shipsData` is stored as `shipStats`; a game send-fleet emits `fleet:sent` with `source: 'game'` and invalidates the flight cache. GALAXYZ: every game XHR to page=fleetAjax emits `fleet:ajax`, and on code 600 also `fleet:sent` (`via: 'fleetAjax'`) and invalidates the flight cache; the fleetStep3 result page emits `fleet:sent` (`via: 'fleetStep3'`, §16). Payloads in §3. On list pages a newly opened `#technologydetails` emits `techdetails:open`.

## 15. `15-flights.js`: `OGX.flights`

GALAXYZ [REAL overview, fleetTable, fleetStep3; foreign/hostile UPSTREAM]: the event box of **every full page** is the list. `flights.init` stores it on each page load (`src: 'page'`; an empty box = no flights), so `get()` rarely fetches; when it does (and when polling finds a reason, `flights.gzPollReason`, background) it GETs page=fleetTable. `parseEventList`/`parseGz(doc)` take any GALAXYZ document; on page=fleetTable the movement list adds recall ids and the outward rows the box skips (Deploy, `rowId 'fleet_<id>'`, arrival from the printed date, cargo approx). Differences in the Flight fields:
* `rowId = 'fleettime_<endUnix><fleetId>'` (the event id), new `fleetId`, `realMissionId = fleetId`. No synthetic return rows: outward and return are two real events (`synthetic: null`, `returnFlight` true on the return); a `holding` event (end of a Hold/expedition stay) has `synthetic: 'holdEnd'`. `departure` = outward arrival - (return - outward/hold end).
* `from`/`to` follow the leg (return: target -> home). Types are not in the markup: target type from the mission (8 -> 2 debris, 15 -> 4, 9 -> 3, else 1), origin 1 (moons are not told apart yet).
* `ships` from `.textForBlind` (`8290 Recycler; ...`, names -> ids via titles/catalog); foreign fleets below espionage 8 give `units` and ship types without counts (`unknownShips: { title: null }`). `cargo` from the second `.textForBlind` (`Ressources: M; C; D[; DM]`, order not words, `darkmatter` when present); no resource part = empty (`approx: true` for foreign fleets).
* `own` from the `own*` class; `status` 'hostile' for foreign attack/ACS/spy/destroy/missile; `recallable` = own outward/holding, exact on page=fleetTable (recall form).
* `fixOutboundFuel` is a no-op (the event cargo is the real load). `parseMovement(doc)` on page=fleetTable -> rows with `id`/`recallId` (only while recallable), `timer` (row countdown: return, or arrival for Deploy), `returnArrival`, `cargo: null`. A game `fleetAjax` answer with code 600 invalidates the store.

```js
Flight = { rowId, realMissionId, synthetic: null|'return'|'holdEnd', isUnion, missionType, returnFlight, arrival: ServerMs,
           from, fromType: 1|2|3|4, to, toType, originKey, destKey, units, ships, unknownShips?, cargo: Res & { approx, fuelRemoved? },
           recallable, own, status: 'friendly'|'neutral'|'hostile', departure: ServerMs|null }
flights.parseEventList(html|doc, { ownCoords?: Set|array, bodies?, titles? }) -> Flight[]
flights.parseMovement(doc|html, { bodies?, titles?, ownCoords? }) -> rows (Flight fields + id, timer, returnArrival, origin, destination, missionClass, recallId)
flights.fixOutboundFuel(list, { stats, server, playerClass }) -> list
//   decision 21: own outbound deuterium minus half the server consumption when the one-way time matches a speed setting;
//   otherwise cargo.approx = true. get() and the passive updates apply it automatically.
flights.get({ maxAgeMs=60000, force=false, background=false }) -> { t, flights } | { error }   // stored in 'flights'; concurrent callers share one request
flights.cached() -> { t, flights, src } | null   // the stored list, no request on either engine (t 0 after invalidate()); modules read this, not the 'flights' key
flights._storeFromDoc(doc, src='doc') -> Flight[] | null   // GALAXYZ: stores the event box of a fetched full page (+ recall ids on fleetTable), emits flights:updated
flights.invalidate() -> Promise
flights.startPolling() -> stop        // OgameX: eventbox every core.flightsPollSec while visible; refetches the list when counts change or an arrival passed
//   GALAXYZ: no cheap probe (every GET is a full page that marks the account online): page=fleetTable is fetched (background) only while
//   the tab is visible and flights.gzPollReason gives a reason; core.flightsPollSec (0 = off) is the minimum spacing
flights.gzPollReason(cached, { now, sec, hasBox, hidden }) -> 'ended' | 'invalidated' | 'noBox' | 'empty' | null
//   'ended' a stored flight's time passed after the list was taken; 'invalidated' flights.invalidate() ran (own send/recall, game fleetAjax 600);
//   'noBox' this page has no event box and the list is older than max(600 s, 10 x sec); 'empty' nothing stored and no event box; null = no poll
flights.inFlight(list) -> Res & { byMission: { [mission]: Res } }   // own missions, once per realMissionId
flights.incomingByBody(list) -> { [BodyKey]: Flight[] } (sorted by arrival)
flights.hostile(list) -> Flight[]
flights.applyArrivals(bodies, list, fromMs, toMs) -> cloned bodies with arrivals in (from, to] applied
```

The game's own event-list XHR and a visit to `/fleet/movement` also refresh the `flights` store and emit `flights:updated`. GALAXYZ: every full page refreshes it from its event box (one `flights:updated` at boot, which may fire before a module's `init` subscribed), so modules read `flights.get()` in `init` and then listen to `flights:updated`; they never poll page=fleetTable themselves.

## 16. `16-fleet.js`: `OGX.fleet`

GALAXYZ [REAL forms of fleetTable/fleetStep1/2/3; not sent live]: `send()` runs `fleet.gz.dispatch` (three POSTs, `cp` on each; speed 1..10 in steps of 1; missions 1-9, 11, 15). `estimate()` uses the 2Moons formulas (fleet.md §4, no wrap-around, one game speed = stored `server.fleetSpeed` from fleetStep1 `gamespeed`, + `gameSpeedKnown`); fuelClient = fuelServer. Prefill: `prefill.open` goes to the native `?page=fleetTable&cp&galaxy&system&planet&planettype&target_mission`; `initPrefill` fills `ship<ID>` on fleetTable (capped at the count, banner names what is missing), the speed select on fleetStep1 (target must match) and the mission radio, cargo and stay time on fleetStep2 (same token); the record follows the steps (`stage`, `token`, expiry renewed) and is removed after step 2. The banners name the page's own submit button («Continue» on Aeternum, Lang dependent; fallback «Далее»/«Отправить»). On fleetStep1 `initPrefill` also remembers the step's ships for `fleet.gz.state()` on step 2. Nothing is submitted.

```js
// GALAXYZ dispatch, one function per form (fleet.md §2). Bodies exactly as the game's forms; never called by the core on its own.
fleet.gz.step1Form({ galaxy, system, position, type=1, mission=0, ships }) -> { galaxy, system, planet, type, target_mission, ship<ID> }
fleet.gz.step2Form(step1, { galaxy?, system?, position?, type?, mission?, speed=10, union? }) -> { token, fleet_group, target_mission, galaxy, system, planet, type, speed }
//   step1 = parse.gz.fleetStep1(doc); missing target fields come from the step-1 form; throws without a token
fleet.gz.step3Form(step2, { mission, cargo, holdingtime }) -> { token, mission, metal, crystal, deuterium, staytime? }
//   throws when step 2 does not offer the mission; staytime = option whose hours (or value) = holdingtime, else the first
fleet.gz.step1(req, { cp }) -> { ok, step: 1, token, target, data, colonies, url, room: { fleetroom, ships: { id: n } } } | { ok: false, success: false, step, message, errors, url?, status?, loggedOut? }
//   failure message is never empty: info page text, first .mainRS text, <title>, else 'шаг N: страница не распознана (size байт, url)';
//   step 1 redirected to fleetTable: «нет свободных слотов флота» or «корабли не найдены на планете (их меньше, чем запрошено?)»
fleet.gz.step2(step1, req, { cp }) -> { ok, step: 2, token, missions, stayOptions, consumption, data, stock /* header of the POST answer */, room: { fleetroom, consumption } } | failure
fleet.gz.step3(step2, req, { cp }) -> parseResult & { ok, step: 3 } | failure (the info page text)
fleet.gz.dispatch(req, { cp, fit=false }) -> { success, step, message, errors, missions?, result?, fit?, cargo }   // api.sendFleet shape
//   after step 1 stores the measured cargo factor (fleet.gz.measureCargo); fit: between step 2 and step 3 the cargo is cut by
//   fleet.gz.fitCargo (req.order, req.keepDeut, req.keepRes); no room at all -> step-2 failure «Нет места: топливо больше вместимости», no step 3
fleet.gz.fitCargo({ cargo, fleetroom, consumption, stock, order='dcm', keepDeut=0, keepRes }) -> { asked, sent, clamped: [res], free, fleetroom, consumption, stock } | { ..., error }
//   pure: each resource <= stock - keepRes (deuterium also - consumption - keepDeut), then refilled into fleetroom - consumption in `order`
fleet.gz.measureCargo(ships, fleetroom, { src }) -> Promise<{ factor, t, ships, fleetroom } | null>   // factor = fleetroom / props cargo, kept when 1..10;
//   storage cargoMeasured; learn fleet.cargoFactor; journal B fleet cargo:measured. Also called on the user's own fleetStep1 page.
fleet.gz.parseResult(doc|html) -> { success, message, missionId, missionName, distance, maxSpeed, consumption, from, to,
                                    arrival, back /* ServerMs */, ships: { id: n }, unknownShips? } | { success: false, message }
fleet.gz.distance(a, b) ; fleet.gz.duration(data, distance, speed10) -> s ; fleet.gz.consumption(data, distance, sec)
fleet.gz.dataFor(ships, shipStats, server, factors?) -> fleetStep1 `data` shape   // when the page's own data is not at hand;
//   fleetspeedfactor = max(0, 1 + factors.FlyTime) (General 613, boost 707); fleet.estimate passes state.factors() on GALAXYZ
fleet.status({ bodyId?, background, merge=false }) -> { slots, expeditions, extraCounters, ships: { id: n }, speeds: { id: v }, bonus, flights /* parseMovement rows */, t } | { error }
//   GALAXYZ only: this page when it is fleetTable, else GET page=fleetTable (another body -> withPlanet); merge: the fetched page goes through state.merge
fleet.recall(fleetId, { confirm }) -> { success, message, cancelled?, flightsUpdated }   // both engines; user click only; confirms (core.confirmActions);
//   emits fleet:recalled { fleetId, ok }; GALAXYZ success = the row lost its recall form, and the fleetTable page the POST answers is stored
//   as the flight list (flightsUpdated true, flights:updated): no second GET needed. Otherwise (OgameX) the store is invalidated.
```

**`OGX.fleet.gz` DOM API** for the game's own dispatch pages (the user's tab; replaces the OgameX `fleetDispatcher` / `#fleet1` / `#fleet2` page-world calls). It only fills fields and fires `input`/`change`/`keyup` (the game's inline handlers recompute their numbers); it **never submits**. Every call returns `{ ok, step, ... }` or `{ ok: false, step, error, message? }` with `error` one of `'step'` (field is on another step), `'notOffered'`, `'noForm'`, `'noStaytime'`, `'staytime'`. All take the live `document` unless a `doc` parameter is shown.

```js
fleet.gz.step(doc=document) -> 0 fleetTable | 1 fleetStep1 | 2 fleetStep2 | 3 fleetStep3 result | null
fleet.gz.state(doc=document) -> { ok, engine: 'galaxyz', step, page, token, ships: { id: n } /* selected / sent */, available: { id: n } | null,
    target: { galaxy, system, position, type }, mission, missions: [{ id, name, checked }] | null, speed /* 1..10 */, distance, duration /* s */,
    consumption, capacity /* data.fleetroom, officers included */, free /* capacity - consumption - cargo */, cargo: { metal, crystal, deuterium } | null,
    stayOptions, staytime, data /* inline data= */, result /* step 3: parseResult */,
    // step 0 adds slots, expeditions, capacityEstimate (base cargo without officers); step 1 adds colonies; step 2 adds origin ('g:s:p'),
    // fleetPoints (span#fleetPoints = calc.expeditionPoints of the fleet) and ships = the ships step 1 showed under the same token
    // (shipsSrc 'fleetStep1'; remembered in page-origin localStorage at boot of step 1; {} and shipsSrc null when not seen)
    // lanedirt-style aliases: shipsToSend, speedPercent, currentPage, cargoMetal, cargoCrystal, cargoDeuterium, targetPlanet
  } | { ok: false, step: null, error: 'noForm' }
fleet.gz.fillShips(ships, { reset=true }) [step 0] -> { ok, step: 0, ships /* as filled, clamped to the planet's count */, short: [{ id, want, have }], capacityEstimate }
fleet.gz.setTarget({ galaxy, system, position, type }) [step 0 hidden fields | step 1 inputs] -> { ok, step, target }
fleet.gz.setSpeed(1..10) [step 1] -> { ok, step: 1, speed, duration, consumption, free }
fleet.gz.selectMission(id) [step 2: checks an offered radio, else { ok: false, error: 'notOffered', missions: [ids], message }; step 0: hidden target_mission]
    -> { ok, step, mission, missions }
fleet.gz.fillCargo({ metal?, crystal?, deuterium? }, { clamp=true, reset=false }) [step 2] -> { ok, step: 2, cargo, free, clamped: [res] }
    // missing keys stay (reset: true -> missing keys are 0 and the current values do not count); each value cut to the header stock
    // (deuterium minus consumption) and to the free capacity, metal -> crystal -> deuterium
fleet.gz.maxCargo({ order=['metal','crystal','deuterium'] }) [step 2] -> { ok, step: 2, cargo, free }   // = the game's maxResources()
fleet.gz.setStaytime(hours) [step 2, select staytime] -> { ok, step, staytime, hours }
fleet.gz.stock(doc) -> { metal, crystal, deuterium }   // floored #current_<res> data-real, null if absent
fleet.gz.sentEvent(doc) -> the fleet:sent payload of a step-3 page (§3) | null
fleet.gz.bridge -> { 'fleet.state', 'fleet.selectShips', 'fleet.setTarget', 'fleet.selectMission', 'fleet.setCargo', 'fleet.setSpeed', 'fleet.setDuration', 'fleet.goStep', 'fleet.submit' }
```

Calc and officers on GALAXYZ: `state.shipStats()` cargo includes Storage expert 607; `state.calcSlots()` includes Commander 611; `fleet.estimate` applies General 613 and boost 707 through `fleetspeedfactor`; `calc.config(server)` ignores `server.fleetSpeed` when `fleetSpeedKnown === false` or it is not > 0 (so 7 stays).

```js
fleet.pickCargoShips(amount, available, stats, { prefer=[203,202], reservePct=0 }) -> { ships, capacity, short }
fleet.estimate({ from, to, ships, mission, speedPct=10, holdingHours=0 }) ->
  Promise<{ distance, duration, maxSpeed, speedFactor, fuelClient, fuelServer, fuelBudget, cargo, arrival, back }>
fleet.send(SendFleetRequest & { originId?, source }) -> Promise<{ success, message, cancelled? }>
//   validates, warns about known ships, fuel and cargo, confirms (core.confirmActions or any warning), uses withPlanet for a foreign origin,
//   emits fleet:sent, state.applySent on success and invalidates flights. GALAXYZ: gz.dispatch with fit. Call it only from a user click.
fleet.sendBatch(flights, { confirmed, signal, onEach(i, res, flight) }) -> Promise<{ results, sent, failed, aborted, abortReason?, unknown, refused? }>
//   flights: [{ originId, galaxy, system, position, type, mission, ships, speed, cargo, order?, keepDeut?, keepRes?, key?, source? }].
//   Refuses unless confirmed === true. One http.withPlanet around the batch (one restore GET), every POST names its origin cp,
//   core.httpGapMs between flights, GALAXYZ gz.dispatch(fit: true) per flight. Per flight: journal B fleet dispatch { i, originId, to, ships,
//   cargoAsked, cargoSent, clamped, fleetroom, consumption, stock, ok, step, message, arrival, back, fleetId, ms }, fleet:sent (via 'batch'),
//   state.applySent on success. Goes on only after a clean step-1/2 refusal (kind 'refusal': no ships, no slot, info message, no room);
//   stops on signal.aborted, 3 refusals in a row with the same key, and on the FIRST other failure (abortReason): 'step3' (any failure
//   after the step-3 POST; res.unknown = true and «неизвестно, проверьте флот: …» unless the page was a recognised refusal; flights
//   are invalidated), 'http' (status 0 / != 200), 'unrecognized' page, 'loggedOut', 'exception'. Journal B fleet batch:abort.
//   Step failures carry kind: 'http' | 'refusal' | 'unrecognized' and, for step 3, posted: true.
fleet.fillByOrder(avail, room, order='dcm') -> { metal, crystal, deuterium }   // 'dcm' | 'cmd' | 'mcd' | 'prop' | [res...]; never above avail
fleet.prefill.open({ originId, target: { galaxy, system, position, type }, mission, ships, cargo?, speed?, holdingHours?, source, note? }) -> Promise
//   stores 'prefill' (2-min expiry) and navigates to /fleet?cp=&galaxy=&system=&position=&type=&mission=
fleet.prefill.clear(why?) -> Promise<boolean>   // removes 'prefill'; journal B fleet prefill:clear { why }
fleet.initPrefill()   // boot: applies a matching prefill through the bridge, shows a banner and never submits; origin mismatch: banner
//   «Флот подготовлен для «X», а открыта «Y».» with «Перейти на X» (record kept), journal B fleet prefill:mismatch { want, have }
```

## 17. `17-galaxy.js`: `OGX.galaxy`

GALAXYZ [REAL page=galaxy 2:68, tournament; foreign rows INFERRED; info pages UPSTREAM]: the galaxy is a server-rendered page (`#galaxytableHead`, `tr.row` per position, no row ids). **Every system view costs deuterium** (taken from the current planet), so the core never views a system on its own: `galaxy.fetch` / `galaxy.scan` send nothing unless the caller passes `userStarted: true` (strictly), and `api.galaxy` stays unsupported. A galaxy page the user opens is parsed at boot (`galaxy.pageSystem`, `galaxy:system` `source: 'page'`, `galaxy:render`), stored in the cache and indexed (player index, own ids). Own rows carry no ids on the page: `planetId`/`moonId` come from the planet list, `playerId` from `state.player()` (numeric once page=tournament was seen, else null). A visited page=tournament links ids and names in the player index; a visited page=statistics is indexed (`indexHighscore`). Extra GALAXYZ fields: `ParsedSystem.engine: 'galaxyz'`, `free: [{ position, fieldsMin, fieldsMax, tempMin, tempMax }]`, `me.playerName`, `me.gigaRecyclers`, `existingPlanets`, `positions[].own`, `flags`, `allianceRelation`, `moon.size`; `pathfinders`, `canSystemPhalanx`, `expeditionDebris`, `debris.requiredShips` are null. Recipes: `specs/galaxyz/galaxy.md`.

```js
ParsedSystem = { galaxy, system, colonized, t, expeditionDebris: null|{ metal, crystal, deuterium, requiredShips },
                 me: { playerId, currentPlanetId, probes, recyclers, pathfinders, missiles, usedSlots, maxSlots, canSystemPhalanx } | null,
                 positions: [{ position, coords, planetId, planetName, destroyed, activity: '*'|minutes|null,
                               moon: null|{ id, name, size, destroyed, activity }, debris: null|{ metal, crystal, deuterium, requiredShips },
                               playerId, playerName, status /* 'vIinsAb' letters */, rank, allianceId, allianceTag, allianceName, missions: number[], canPhalanx, canMissile }] }
galaxy.parseSystem(json) -> ParsedSystem|null ; galaxy.parseRow(rowEl) -> rendered row essentials | null
galaxy.isOwnRow(position, me?) -> boolean   // positions[].own, else player id (snapshot / storage identity / me.id), else name for rows without id
galaxy.activity(a) ; galaxy.status(player)
galaxy.fetch(g, s, { background=true, userStarted=false }) -> ParsedSystem | { error, status?, stoppedBy, costsDeuterium? }
//   GALAXYZ: GET ?page=galaxy&galaxy&system (never with cp). Without userStarted === true NO request:
//   { error: 'galaxy view costs deuterium on GALAXYZ: only on a user action (pass userStarted: true)', stoppedBy: 'cost', costsDeuterium: true }.
//   stoppedBy: 'cost' (guard) | 'deuterium' (server info page "You dont have enough deuterium to view the galaxy") | 'vacation' | 'auth' | 'http'.
//   OgameX: userStarted ignored (the /ajax/galaxy piggyback is free). Success: stored, emits galaxy:system { source: 'scan' }.
galaxy.scan([[g, s]], { delayMs, jitterMs=300, maxPerHour, onSystem, signal, userStarted=false, confirm=false })
  -> { done, stoppedBy: null|'busy'|'abort'|'limit'|'cost'|'cancel'|'deuterium'|'auth'|'vacation'|'http' }
//   GALAXYZ: without userStarted: true -> { done: 0, stoppedBy: 'cost' }, nothing sent (schedulers / auto-scans must not run unless the user
//   confirmed). confirm: true asks first with OGX.dom.confirm (title «Сканирование галактики», OK «Сканирование», text names N systems and the
//   deuterium cost); declined -> { done: 0, stoppedBy: 'cancel' }. Each step calls fetch with userStarted: true and stops on the first error.
galaxy.viewCostsDeuterium() -> boolean   // true on GALAXYZ
galaxy.onSystem(fn, { replay=true }) -> off   // bus.on('galaxy:system') + async replay of this page's last payload with replay: true
galaxy.onRender(fn, { replay=true }) -> off   // bus.on('galaxy:render') + async replay of the last render { galaxy, system, rows: Map (re-read now), replay: true }
galaxy.last('system'|'render') -> last payload emitted on this page | null
galaxy.rows() -> Map<position 1..15, Element>   // GALAXYZ tr.row of #galaxytableHead, OgameX #galaxyRowN; empty Map off the galaxy page
galaxy.pageSystem -> Promise<ParsedSystem|null>  // the system this galaxy page shows (GALAXYZ parsed at boot; OgameX the first /ajax/galaxy); null elsewhere
galaxy.parseGz(doc=document, { playerName, playerId }) -> ParsedSystem + GALAXYZ extras | null (no galaxy table, e.g. an info page)
galaxy.gz.header(doc) ; galaxy.gz.row(tr, i) ; galaxy.gz.statusOf(flags) ; galaxy.gz.tournament(doc) -> { endsInSec, boards: [{ id, tab, title, prizes, rows: [{ pos, playerId, name, points }] }] }
galaxy.indexTournament(galaxy.gz.tournament(doc))
galaxy.cached(g, s) -> ParsedSystem|null (me = null)
galaxy.player(id) -> PlayerEntry|null ; galaxy.players({ nameLike }) -> PlayerEntry[] (by rank)
PlayerEntry = { id, name, status, rank, allianceId, allianceTag, allianceName?, planets: [{ coords, planetId, moonId, lastSeenT }], homeCoords, points, t }
//   GALAXYZ: keyed by numeric id, or 'n:<name>' until an id is seen (own rows, page=tournament merges); galaxy.player('name') finds both
galaxy.indexHighscore(parse.highscorePlayers(...))   // GALAXYZ rows have names, not tags: a tag learned from the galaxy is kept unless the alliance id changed
galaxy.current() -> { galaxy, system } | null
galaxy.rowSlot(rowEl, owner) -> span.ogx-gx-slot[data-owner]   // OgameX: cleared before each galaxy:render; GALAXYZ: inside td.action (occupied) or the last cell (free) - no <td> is added
galaxy.headerSlot(owner) -> span.ogx-gx-header[data-owner]
```

## 18. `19-messages.js`: `OGX.messages`

GALAXYZ [REAL messages-spy / messages-all; combat, expedition, transport, return, raport UPSTREAM]: messages live in one table `#messagestable` of `tr.message_head#message_<id>` + `tr.messages_body` rows inside a form with `input[name=messcat]`; the game loads a category by AJAX (`page=messages&mode=view&messcat&site&ajax=1`), and **listing a category marks its messages read on the server**. The whole body is in the list row: there is no per-message endpoint (combat reports are a separate popup, page=raport). The public functions below keep their names and OgameX shapes; GALAXYZ adds fields. Parsers: `specs/galaxyz/messages-recipes.js` (`GZMessages`, ported verbatim; oracle `fixtures/messages-expected-parse.json`).

Categories (`messcat`): 0 spy, 1 player, 2 alliance, 3 combat, 4 system, 5 transport, 15 expedition, 50 game, 99 construction, 100 all, 999 outbox. OgameX aliases (`messages.gz.aliasOf`): 0 -> `fleets/espionage`; 3 -> `fleets/combat_reports`; 15 -> `fleets/expeditions`; 5 -> `fleets/transport`; 4, 50, 99 -> `fleets/other`; 1, 2, 999 -> `communication/messages`; unknown -> `fleets/other`. Native kinds -> OgameX keys: `spy_report` -> `espionage_report`, `spy_detected` -> `espionage_detected`, `combat`/`combat_expedition` -> `battle_report`, `missile` -> `missile_defense_report`, `transport_arrival` -> `transport_arrived`, `recycle` -> `debris_field_harvest`, `deploy_arrival` -> `fleet_deployment_with_resources`, `return`/`return_expedition` -> `return_of_fleet_with_resources`, `return_empty`/`return_expedition_dm` -> `return_of_fleet`, `expedition` -> `expedition_gain_resources|_dark_matter|_ships`, `expedition_failed[_and_delay|_and_speedup]`, `expedition_battle_pirates|_aliens`, `expedition_loss_of_fleet`, `expedition_unknown`; other kinds keep their name.

Spy report values: the `im[]` floats of the Simulate link rounded like the shown cell (PHP `sprintf('%.0f')`: nearest, exact .5 ties to even), e.g. `675144412229.63 -> 675144412230`; `exact: true`. Without the link the cell values are used (`exact: false`). GALAXYZ spy reports have no player, no debris and **no planet id** (use `api.resolvePlanetId`).

The parsers keep the output of `tools/messages_recipes.js` (see `fixtures/messages-expected-parse.json`) and add aliases. Coordinates in message results are **arrays** `[g, s, p]`. Each place object also carries `coordsStr: 'g:s:p'`. `date` is the server wall text and `ts` is `ServerMs`.

```js
MessageItem = { id, tab, subtab, li, isNew, panel }   // OgameX
MessageItem (GALAXYZ) = { id, tab, subtab /* OgameX aliases: 'fleets'/'espionage', ... */, cat /* numeric messcat of the list, 100 = All */,
                          rowCat /* the row's own category, also in cat 100 lists */, catName /* 'spy','combat','expedition','transport','system',
                          'construction','game','player','alliance','outbox' */, kind /* native: 'spy_report','combat',... */, key /* OgameX classify key */,
                          engine: 'galaxyz', li /* tr.message_head (no data-msg-id: use .id / item.id) */, isNew, panel /* the form */, body /* td of tr.messages_body */ }
messages.watch(fn(MessageItem)) -> unsubscribe     // messages page only; once per row element (GALAXYZ: rows the game inserts after a category click too);
                                                   //   also emits messages:item
messages.fetchList(tab, subtab, page=1, { background }) -> { items: [{ id, li, item }], page, pages, cat? /* GALAXYZ */, doc } | { error }
//   GALAXYZ: tab/subtab = messcat number or an OgameX name (subtab wins when it maps: ('fleets','espionage') -> 0; nothing -> 100);
//   GET page=messages&mode=view&messcat&site&ajax=1 (never cp). MARKS THE LISTED MESSAGES READ. item = parse.list item (+ tab, subtab, catName, rowCat).
messages.fetchDetail(id, tab, subtab, { background, raport }) -> OgameX { doc, html } | { error }
//   GALAXYZ: no request for a spy report (whole report in the row). -> { id, kind, key, item, full, source: 'row'|'raport', doc, html, short?, reportId? }
//     spy: full = parse.espionageFull shape; doc = a document holding only that row (every parse.* accepts it).
//     combat: GET page=raport&raport=ID [UPSTREAM] (background when opts.background; raport: false = no request); full = parse.battleFull shape,
//       doc/html = the raport page, short = battleShort.
//     other kinds: full = expedition / fleetMessage / espionageDetected / gz.parseItem.
//     not in any list loaded in this tab: { error, status: 0, notFound: true } -> fetchList its category first (marks read).
messages.full(x, { background, raport=true, tab?, subtab? }) -> { id, kind, key, full, source: 'row'|'raport'|'detail', short? } | { error, notFound? }
//   both engines; x = MessageItem | li | tr.message_head | id. OgameX: espionage_report / battle_report via fetchDetail + espionageFull / battleFull,
//   other kinds parsed from the li. Prefer this over fetchDetail(...).doc in modules: the doc markup differs per engine.
messages.fetchRaport(reportId, { background }) -> { reportId, full /* battleFull shape */, doc, html } | { error }   // GALAXYZ only
messages.delete(id, opts) -> Promise<boolean>
messages.classify(li, subtab) -> key ('espionage_report', 'battle_report', 'expedition_gain_resources', 'transport_arrived', ...)
//   transport / return / deployment / debris-harvest / ACS-hold bodies are matched in every OgameX locale with its own
//   t_messages.php texts (en, fr, zh-TW; nl and it fall back to en), and parse.fleetMessage reads resources and harvest data
//   from the same localized templates. messages._matchFleetText(text) -> { key, locale, params } | null (internal, tests).

messages.parse.list(doc) -> items[] (+ .page, .totalPages): { id, unread, isNew, title, titleClass, date, ts, from, sender, detailsUrl, key, li }
messages.parse.placeLink(a) -> { coords: [g,s,p], coordsStr, type: 'planet'|'moon'|'coordinates'|'debris', planetType, name }
messages.parse.espionageShort(li) -> { id, target, player, resourcesApprox, resources, resourcesTotalInclEnergy, total, counterEspionage, detailsUrl }
messages.parse.espionageFull(doc|html) -> { id, title, date, ts, target, attackParams: { galaxy, system, position, type }, player, counterEspionage,
                                            resources: Res & { energy }, debris, ships, defense, buildings, research, known: { ships, defense, buildings, research } }
messages.parse.battleShort(li) -> { id, date, ts, coords, defenderPlace, attacker: { name, losses, lossesApprox, mark }, defender, winner,
                                    lootSum, lootPct, debrisSum, repaired, moonChance, detailsUrl }
messages.parse.battleFull(doc, html?) -> { id, date, ts, defenderPlanet, loot, debris, recyclersNeeded, moonCreated, attacker, defender, rounds, start, end,
                                           unitsLost: { attacker: Ships, defender: Ships } }
messages.parse.expedition(li) -> { id, ts, key, outcome, resources?, darkMatter?, shipsByName?, ships? }
messages.parse.fleetMessage(li, key?) -> { id, ts, key, from, to, resources, harvest?: { ship, ships, capacity, field, harvested } }
//   GALAXYZ missile impact (kind 'missile') [UPSTREAM MissionCaseMIP]: resources undefined, + missiles, intercepted (null = not readable),
//   destroyed { defenceId: n }, unknownTitles; from = launching planet, to = the hit planet (the same text goes to both players)
messages.parse.espionageDetected(li) -> { id, ts, from, target, to, attackerName, spyName, counterEspionage, chance }
// GALAXYZ: every parse.* accepts a tr.message_head, a tr/td of the body, a gz list item or a document; espionageFull adds exact, probesDestroyed,
//   reportDate (title time: another clock), simHref (the report's own page=battleSimulator link, im[] raw floats), gz (raw);
//   messages.full / fetchDetail of a combat message: full (page=raport) gets id = the message id and reportId; battleShort adds reportId; parse.list items add kind, key, cat, tab, subtab, catName, rowCat.

// GALAXYZ helpers (messages.gz; raw recipe shapes unless noted)
messages.gz.aliasOf(kind, cat) -> { cat, catName, tab, subtab } ; messages.gz.catOf(x) -> messcat | null ; messages.gz.CATEGORIES
messages.gz.findRow(id) -> tr.message_head | null   // this page first, then rows seen by fetchList / parse.list / watch (in memory, last 600)
messages.gz.list(doc) ; messages.gz.listItems(doc) ; messages.gz.item(x) ; messages.gz.classify(x, cat) -> kind ; messages.gz.keyOf(kind, data) -> key
messages.gz.parseItem(x, cat) ; messages.gz.spyReport(el) ; messages.gz.combatMessage(x) ; messages.gz.combatReport(doc) ; messages.gz.battleHall(doc)
messages.gz.expedition(x) ; messages.gz.fleetText(x, kind) ; messages.gz.categories(doc) -> [{ cat, unread, total, ... }] ; messages.gz.headerUnread(doc)
messages.gz.urls.{ view(cat, site), page(cat, side), raport(rid), actionBody(action, ids, cat, side) }   // no network
```

## 19. `20-style.js`

`OGX.style.core` is injected as `<style id="ogx-core">` at boot. Text, search and number inputs, selects and textareas under `.ogx-root` / `.ogx-panel` / `.ogx-settings-form` get the dark field style. It defines CSS variables on `.ogx-root` (`--ogx-bg`, `--ogx-panel`, `--ogx-border`, `--ogx-text`, `--ogx-muted`, `--ogx-accent`, `--ogx-ok`, `--ogx-warn`, `--ogx-bad`, `--ogx-metal`, `--ogx-crystal`, `--ogx-deuterium`, `--ogx-energy`) and the classes `.ogx-panel*`, `.ogx-tab*`, `.ogx-table`, `.ogx-btn`, `-primary`, `-danger`, `-icon`, `.ogx-modal*`, `.ogx-toast*`, `.ogx-tooltip`, `.ogx-bar*`, `.ogx-countdown`, `.ogx-badge`, the form controls, `.ogx-gx-slot`, `.ogx-banner`, `.ogx-ok`, `.ogx-warn` and `.ogx-bad`.

## 20. Storage keys owned by core

| Key | Scope | Writer |
|---|---|---|
| `settings` | player | settings |
| `diag.log` | player | log (00-ogx) |
| `diag.ctx` | player | diag (export header context, read by the popup) |
| `diag.learn` | server | learn (self-learning state) |
| `bodies`, `research`, `player`, `slots`, `shipStats`, `combatBonus` | player | state |
| `flights` | player | flights |
| `prefill` | player | fleet |
| `lock.<name>` | player | storage |
| `server` (incl. `tzOffsetMs`), `titles`, `topScore` | server | state / time |
| `galaxy.g<N>`, `galaxy.players` | server | galaxy |

Modules write only `<module>.<key>` through `ctx.store`.

Not in `chrome.storage`: the journal and the snapshots live in IndexedDB (`ogx-diag` in the extension origin, fallback `ogx-diag-<ext>` in the page origin) and, during an unload in the fallback mode, `localStorage['ogx-diag-spill-<ext>']`. GALAXYZ fleet: `localStorage['ogx:gzFleetShips']` (page origin) = the ships of the last fleetStep1 by token, for fleet.gz.state() on step 2.

## 21. Diagnostics: journal, self-learning, export (`21-diaglib.js`, `22-diag.js`, `23-learn.js`, `background/diag-bg.js`, `popup/diag-panel.js`)

Export formats and the reading guide for bug reports: **DIAG.md**.

### 21.1 Journal (`OGX.log`, `OGX.diag`)

```js
OGX.log.rec(src, kind, what, data?) -> Event | null
//   src: 'U' user click in our UI | 'B' add-on/bot action | 'S' page/navigation/session/errors/snapshots | 'N' network | 'G' game messages | 'L' learning alerts
//   kind <= 60 chars, what <= 300 chars, data redacted (secrets masked, strings <= 500, depth 5). Returns null when diag.journal is off
//   (or src 'N' with diag.network off). Buffered, written every 0.8 s; safe to call before boot (kept in memory, max 1000).
Event = { id, t, s, k, w, d?, p /* page */, x /* ext */, tab }
OGX.log.wrap(moduleName, fn, label = fn.name) -> fn'
//   records B <moduleName> <label> { ms, ok, args?, r? | err } after the call (Promise-aware; ok=false also for { success:false } / { ok:false }),
//   plus S 'error' '<module>:<label>' with the stack when it throws; the error is rethrown, the result returned unchanged.

OGX.diag.enabled('journal'|'network'|'learn'|'snapshots') -> boolean
OGX.diag.flush() -> Promise                         // write the buffer now
OGX.diag.store() -> Promise<Store>                  // 'bg' (background) or the page-origin store ('idb' | 'localStorage')
OGX.diag.recent({ s?, k? }?) -> Event[]             // this page's last 3000 events (also before they are written)
OGX.diag.snapshot(reason, { force=false }) -> Promise<id|null>   // sanitized DOM of this page; unforced: needs diag.snapshots, max 1 per 30 s
OGX.diag.sanitizeDom(doc=document) -> string
OGX.diag.context() -> Promise<ctx>                  // export header: ext, extName, extVersion, coreVersion, ua, host, page, playerId, playerClass, server, modules [{name, enabled, active, settings}], core, diag, storeKind
                                                    //   + (Suite, additive) allowHosts: string[] (popup allow-list), globalOff: string[] (popup global switches)
OGX.diag.recordGated(reason, data?) -> Promise<bool> // boot refused by the gate (reason 'allow-list') or by detection on a game-like page (reason 'not-detected', data { reason, engine, generator }): drops this page's buffer and sends ONE S 'gated' event (at most once per host and reason in 30 min, guard kept in the background journal meta, never in page storage)
                                                    //   (host + reason + data, no page data) to the background journal only; once per tab session and host
OGX.diag.publishContext() -> Promise<ctx>           // saves it as 'diag.ctx' (boot does it after the modules and on settings changes)
OGX.diag.export(what, { n }?) -> Promise<{ text, filename, mime, info }>   // what: 'new'|'today'|'last'|'jsonl'|'snaps'|'learn'
OGX.diag.download(what, opts?) -> Promise<same>     // export + Blob/<a download>
OGX.diag.backend() -> PanelBackend                  // page backend for OGXDiagPanel
OGX.diag.mountPanel(container, opts?) -> { el, refresh(), run(what) } | null   // needs shared/popup/diag-panel.js loaded
OGX.diag.addPanelTab(sidePanel, { order=900 }?)     // adds tab «Логи» to an OGX.dom.sidePanel (Infinity panel module)
OGX.diag.init(snap)                                 // boot only
```

GALAXYZ: the endpoint of a `game.php` request is `METHOD /<Universe>/game.php?page=<page>[&mode=<mode>]` (page/mode from the query or the form body), so N events and `learn.api` keep pages apart. The S `page` event carries `engine`, `gz` (page&mode, step), `events` (count) and `anchor` (`'event'` when the clock was calibrated on this page). Info pages (`.headerRS + .mainRS p`, e.g. "You need Admiral officier at level 10!!") become G `info` events (`failed: true` except on fleetStep3). The export context has `engine` and `gzPage`. `learn.pageKey` on GALAXYZ: name + `:<raw page>` when it differs (`fleet:fleetstep2`, `merchant:fleetdealer`, `defense:shipyard`) + `:info` on message pages; `other:<raw page>`.

The game's network requests (N, `by: 'page'`) are captured from the moment `22-diag.js` loads (see §13, hook 0.3.0). `#errorBoxNotifyContent` gets `failed: true` only when `#errorBoxNotifyHead` is the game's error head (`LocalizationStrings.error` of the page, or "Error"/"Erreur"/"Errore"/"Fout"/"錯誤"); OgameX also shows success messages (logout, jump gate) in that box, those keep `{ head }` only. Captured automatically after `diag.init`: S `page`/`ready`/`leave`/`module-init-fail`/`error`/`warn`/`uncaught`/`rejection`/`boot-fail`/`session`/`snapshot`; N for the game (page hook, `by: 'page'`) and for `OGX.http` (`by: 'ogx'`); G for `#fadeBoxContent` (`failed` from `#fadeBoxStyle.failed`), `#errorBoxNotifyContent`, `#errorBoxDecisionContent`, `notification-container`; U `click` and `change` on elements with an `ogx-*` id/class (module from `ogx-l-<m>-`/`ogx-i-<m>-`, use `data-ogx-act="<action>"` on buttons for a stable label); B for the wrapped `OGX.api` actions.

### 21.2 Self-learning (`OGX.learn`)

```js
OGX.learn.sel(selector) -> Element|null              // counted document.querySelector
OGX.learn.sel(selector, found, root?)                // report a query made elsewhere (core DOM helpers do this)
OGX.learn.api(endpoint 'METHOD /path', { status, json } | { status, keys: string[]|null, kind? })   // core HTTP and the page hook do this
OGX.learn.check(name, obj) -> boolean                // NaN/Infinity anywhere or negative resource/level values -> L 'implausible'
OGX.learn.value(name, number, { min=0, max=Infinity, int=false }) -> boolean
OGX.learn.tokens(doc=document) -> string[]           // '#id', '.class', '[data-x]', 'meta:name' (digits -> '#', ogx-* skipped)
OGX.learn.pageKey(doc=document) -> string            // learning key of a page: name, + ':moon' when the active body is a moon,
                                                     //   + ':noships' for /fleet without ships (#warning); planet pages keep the plain name
OGX.learn.endVisit() -> alerts[]                     // commit this visit now (automatic after 20 s and on pagehide)
OGX.learn.save({ flush }?) -> Promise ; OGX.learn.reset() -> Promise ; OGX.learn.state() -> State|null ; OGX.learn.isActive()
OGX.learn.config                                     // thresholds (DIAG.md §3)
OGX.learn.init(snap)                                 // boot only
```

The core parsers `inlineResources`, `resourceTooltips`, `planetList`, `overviewInfo`, `fleetPage`, `player`, `techList`, `resourceSettings`, `techDetails` are wrapped: their results are checked with `learn.check('parse.<name>', result)` (unchanged return values).

### 21.3 Library (`self.OGXDiagLib` = `OGX.diaglib`)

```js
L.redact(v, { maxStr }) ; L.redactString(s, max=500) ; L.redactUrl(url, base?) ; L.formSummary(body) ; L.addSecret(str) ; L.isSensitiveKey(k)
L.normalizePath(p) ; L.jsonSchema(json, depth=3, max=200) ; L.safeFields(json) ; L.responseKind(status, json) -> 'ok'|'err'
L.openStore({ name='ogx-diag', cap=100000, slack=500, snapCap=1000, snapBytes=64 MB, snapMax=600000, forceLocal, lsCap=4000 }) -> Promise<Store>
Store = { kind: 'idb'|'localStorage', put(events), putSnap(snap) -> id, query({ sinceId, sinceT, untilT, last, maxBytes }) -> { events, total, cut },
          snaps({ last, sinceT, maxBytes }) -> { snaps, total, cut }, stats() -> { events, snaps, snapBytes, minId, maxId, firstT, lastT, lastExportId },
          getMeta(k), setMeta(k, v), clear() }
L.buildTxt({ ctx, events, cut, exportKind, maxBytes=6 MB }) -> { text, included, dropped, firstT, lastT, maxId }
L.buildJsonl({ ctx, events, cut }) ; L.buildSnapshotsHtml({ ctx, snaps, cut }) ; L.learnReport(state, { host }) ; L.headerLines(ctx, events) ; L.summary(events)
L.exportData(backend, what, { n }) -> { text, filename, mime, info } ; L.download(filename, text, mime)
L.hostInList(host, list) -> boolean                  // allow-list rules of ogamex-suite/loader.js ('host', 'host:port', '*.domain')
// isSensitiveKey: a key ending in the plural 'tokens' (markup token lists of learn alerts) is not sensitive.
// buildJsonl reserves the real header length (not a fixed 4 KB), so the file never exceeds maxBytes.
// headerLines prints, when present: ctx.ctxNote, ctx.allowHosts ('Серверы (allow-list)', with a warning when ctx.host is not in it),
//   ctx.globalOff ('Выключено глобально (попап)'), and marks modules with m.globalOff as '(выключен в попапе)'.
```

### 21.4 Background and popup (integration)

- Chrome service worker `background.js`: `importScripts('shared/core/21-diaglib.js', 'shared/background/diag-bg.js')` before its own `ogx:ping` listener. Firefox: `"background": { "scripts": ["shared/core/21-diaglib.js", "shared/background/diag-bg.js", "background.js"] }` (and guard `importScripts` with `typeof importScripts === 'function' && !self.OGXDiagBG`). `diag-bg.js` answers only `ogx:diag:*` messages (`ping`, `put`, `snap`, `query`, `snaps`, `stats`, `meta`, `clear`) and leaves the rest to other listeners. Permissions stay `storage` (+ `unlimitedStorage`); no `downloads`.
- Popup/options page: `<div id="ogx-diag-panel"></div>`, `<link rel="stylesheet" href="../shared/popup/diag-panel.css">`, `<script src="../shared/core/21-diaglib.js">`, `<script src="../shared/popup/diag-panel.js">`. The panel mounts itself on extension pages, reads the extension IndexedDB directly and builds the header from the newest `*|diag.ctx` in `chrome.storage.local` plus the manifest name/version, plus — read at export time — the Suite popup's `*|*|suite.hosts` (`allowHosts`) and `*|*|suite.modules` (`globalOff`, those modules marked off) and a note on the age of the stored context (`ctxNote`). The Suite popup journals its own changes as U `popup` `modules`/`hosts` events in the same store. Downloads use Blob + `<a download>`.
- Infinity side panel: load `shared/popup/diag-panel.js` as a content script after the core files and call `OGX.diag.addPanelTab(panel)` (or `OGX.diag.mountPanel(container)`). The userscript build includes the same files; there the journal uses the page-origin store.
- `OGXDiagPanel.mount(container, { backend, title, settingsNode?, injectCss? })`; `OGXDiagPanel.extensionBackend()`; `OGXDiagPanel.CSS` (identical to `diag-panel.css`). Buttons carry `data-ogx-act="diag:new|today|last|jsonl|snaps|learn|clear|snapshot"`.


## 22. Module porting guide (GALAXYZ)

GALAXYZ 1.8 (ogamex.eu/Aeternum, a 2Moons fork) is what the user plays; lanedirt OgameX must keep working. Rules for every port:

* Branch on `OGX.page.isGz()` only where the engines really differ. Prefer the engine-neutral core calls below; they return the OgameX shapes with GALAXYZ extras, `null` for data the engine does not have, and `{ error, unsupported: true }` where an endpoint does not exist. Never treat `null` as 0 and never print `x0` or `NaN`: show «—» or «неизвестно».
* **Nothing changes game state without an explicit user click**: `fleet.send`, `api.sendFleet`, `api.sendMiniFleet`, `api.recall`/`fleet.recall`, `api.addBuild`, `api.deleteMessage` only from a click handler. The `fleet.gz.*` form fillers never submit; the user presses the game's button.
* **No background request may cost deuterium.** On GALAXYZ every galaxy view costs deuterium: `galaxy.fetch`/`galaxy.scan` need `{ userStarted: true }` and are called only from a user click (scans also with `confirm: true`). Schedulers and auto-scans get `stoppedBy: 'cost'` and must show «просмотр галактики стоит дейтерий» and stay off on GALAXYZ unless the user confirms.
* `cp` switches the active planet of the whole session on the server: pass it explicitly or use `http.withPlanet`; never add it to galaxy requests.
* Every GALAXYZ GET is a full page that marks the account online and costs server time: do not poll. Use the data each page already carries (event box on every full page, planet list, resources) through `state`, `flights` and the bus.
* Listing a message category on GALAXYZ marks its messages read on the server: `messages.fetchList` only on a user action or with a clear setting.
* Markup tagged [UPSTREAM] (statistics, search, playerCard, raport, combat/expedition/transport messages, hostile fleets) was never saved live from the fork; results carry `unverified: true`. Handle `error` fields and empty rows gracefully.

### 22.1 OgameX assumption -> GALAXYZ replacement

| OgameX assumption | GALAXYZ replacement |
|---|---|
| Page by path (`/fleet`, `/galaxy`, `location.pathname`) | `OGX.page.is(name)` / `page.info()` (`name`, `aliases`, GALAXYZ `raw`, `mode`, `step`, `cp`). page=buildings has aliases `resources` and `facilities`. `ModuleDef.pages` matches names and aliases |
| Building links as strings `'/fleet?galaxy=..'` | `OGX.page.url(path, query)` (translates paths and query keys; id paths `/alliance/info/<id>`, `/player/<id>`, `/raport/<id>`), `OGX.page.urlFor(pageName)` (`'empire'` -> page=imperium), `page.gzRoute(path)` (`shared` tells that `/resources` and `/facilities` are one page) |
| `#planetList` (one list, `data-planet-id`) | `OGX.dom.planetRows()` / `dom.planetLists()` / `dom.planetListEnd()` (GALAXYZ has one `#planetList` per planet: duplicate ids; ids only in `a.planetlink` `cp=`); data: `state.bodyList()`, `state.current()`. `#planetSelector` is the full list incl. moons. `#countColonies` = used/max |
| `#menuTableTools`, `#left`, `#inhalt`, `#rechts`, `#middle` as anchors | `OGX.dom.anchors()` -> `{ menu (#menuTable), topBar (#bar > ul), rightColumn (#rechts, missing on info pages and fleetStep3), content (#inhalt; #content only on galaxy), footer }`; menu entry: `dom.menuEntry()`; floating UI: `dom.root()` / `dom.sidePanel()` on body |
| `#resources_metal` etc., `#ab47bc`-style header boxes | `state.projected(body)` / `parse.inlineResources` / `parse.gz.resources(doc)` (exact `resourceTicker` floats); header cells are `#current_metal\|crystal\|deuterium\|darkmatter[data-real]`; energy cell has no id (`#resTable td.res_current[t]`) |
| `#movement`, `#movementcomponent`, `/fleet/movement`, `/ajax/fleet/eventlist\|eventbox` | `OGX.flights.get()` + bus `flights:updated` (every full page stores its event box `#messages_collapsed .OvfleetEvents_`; page=fleetTable adds recall ids); `fleet.status()` for slots/ships/flights rows; `parse.gz.fleetTable(doc)`. Do not poll page=fleetTable. Recall: `fleet.recall(fleetId)` on a click. `#OvfleetEvents` and `.fleets` are duplicated/ambiguous: never select them globally |
| `#fleet1`, `#fleet2`, `#fleetdispatchcomponent`, `#sendall`, `#resetall`, `#allornone`, `#speedPercentage`, `fleetDispatcher` | Dispatch is 3 plain form pages: fleetTable (step 0: ships, `input[name=ship<ID>]`), fleetStep1 (target, speed; content `#fleet1`), fleetStep2 (mission, cargo, stay time; content `#fleet2`), fleetStep3 (result info page, no `#rechts`). Use `OGX.fleet.gz.step()` / `state()` / `fillShips` / `setTarget` / `setSpeed` / `selectMission` / `fillCargo` / `maxCargo` / `setStaytime` (§16), or `OGX.bridge.call('fleet.*')` which maps to them on GALAXYZ. `fleet.goStep`/`fleet.submit` return `{ ok: false, error: 'manual' }`. Ship ids are 2Moons (`catalog.shipIds` 202..220) |
| Pre-filling another page: `/fleet?galaxy&system&position&type&mission` | `OGX.fleet.prefill.open({ originId, target, mission, ships, cargo?, speed?, holdingHours? })` (native `?page=fleetTable&cp&galaxy&system&planet&planettype&target_mission`; core fills the steps, never submits) |
| `#galaxyContent`, `#galaxyRow<N>`, `/ajax/galaxy` XHR, `galaxy.load`/`galaxy.repair` page calls | The galaxy is a server-rendered page: `galaxy.onSystem(fn)` / `galaxy.onRender(fn)` (replay the boot-time event: a plain `bus.on('galaxy:system')` in init misses it), `galaxy.rows()` (Map position -> `tr.row` of `#galaxytableHead`), `galaxy.pageSystem`, `galaxy.current()`, `galaxy.rowSlot(tr, owner)` (inside `td.action`, never a new `<td>`), `galaxy.headerSlot(owner)`. Other systems: `galaxy.cached(g, s)` (free) or `galaxy.fetch(g, s, { userStarted: true })` on a click (costs deuterium). `api.galaxy` is unsupported |
| One-click spy/recycle by coordinates (`send-mini-fleet` with g/s/p) | `api.sendMiniFleet({ mission, galaxy, system, position, type })` resolves the target's `planetID` from the galaxy page/cache/player index/own bodies; when it cannot (`unresolved: true`) show `message` + `suggestion` (open that system: costs deuterium) and the `galaxyUrl` link. `shipCount` is ignored (server setting). Check `mismatch` |
| `bridge.onXhr(/^\/ajax\/.../)` OgameX paths | GALAXYZ routes are matched on `route = 'page=<page>[&mode=<mode>]'` (lower case). Relayed: `page=fleetajax` (galaxy one-click spy/recycle; prefer bus `fleet:ajax` / `fleet:sent`), `page=messages&mode=view\|action`, `page=fleetstep1&mode=checktarget` (target check of step 1; no shipsData: `api.checkTarget` returns `{ ok, message }`), `page=(technology\|research\|ship\|commander)detailsajax`. Mapping: `/ajax/fleet/dispatch/send-fleet` -> no XHR (form POSTs): bus `fleet:sent` (`via: 'fleetStep3'`); `/ajax/fleet/dispatch/send-mini-fleet` -> `fleet:ajax` / `fleet:sent` (`via: 'fleetAjax'`); `/ajax/fleet/dispatch/check-target` -> `^page=fleetstep1&mode=checktarget`; `/ajax/fleet/eventbox/fetch`, `/ajax/fleet/eventlist/fetch` -> none (use `flights:updated`); `/ajax/messages[/<id>]` -> `^page=messages&mode=view` + `messages.watch`; `/ajax/highscore`, `/ajax/search`, `/ajax/galaxy` -> none (statistics/search/galaxy are full pages or popups); `/ajax/(resources\|...)`, `add-buildrequest` -> `^page=\w+detailsajax` / bus `techdetails:open` |
| `li.msg[data-msg-id]`, `.msg_new`, `#messages` tabs, `ui-id-*` panels, `/ajax/messages/<id>` | `messages.watch(fn)` (GALAXYZ item: `li` = `tr.message_head` without `data-msg-id`: use `item.id`; `body` = the body `td`; filter on `tab`/`subtab` aliases or `catName`/`kind`/`key`); `messages.full(item)` for the parsed message (spy: from the row, no request; combat: page=raport). Do not read `fetchDetail(...).doc` with OgameX selectors (`.detail_msg`, `fromFull(doc, html)`): use `res.full`. Combat report by id: `messages.fetchRaport(id)` |
| Spy report: player name/id, debris, `attackParams` -> planet id | GALAXYZ reports have no player, no debris, no planet id: `player: null`, `debris: null`; `attackParams` = coords + type; planet id via `api.resolvePlanetId` |
| Numeric player ids (`playerId`, `#playerId`, meta `ogame-player-id`) | GALAXYZ pages do not show the own id: `state.player().id` is null until page=tournament was visited (then 4377-style numbers). Storage keys use `n:<name>`. Index other players by `galaxy.player(idOrName)` (accepts a name; entries keyed `'n:<name>'` until an id is seen). Galaxy rows of other players carry ids; own rows get the id once known. Never key module data by numeric id alone |
| `playerClass` (collector/general/discoverer), class bonuses, crawlers, class-only ships | No classes on GALAXYZ: `playerClass === 'none'`, class parameters are ignored by `calc`. Hide class UI. Officer effects instead: `state.factors()` (607 cargo, 611 slots, 613 flight time, ...), `state.calcSlots()`, `state.shipStats()` |
| `server.economySpeed`, `researchSpeed` (always numbers) | GALAXYZ: `null` with `economySpeedKnown` / `researchSpeedKnown` false. Math: `+srv.economySpeed \|\| 1`; display: «—» unless the Known flag is true (`x(null)` would print `x0`). Fleet speed: `srv.fleetSpeed` (7 until fleetStep1 measured it; `fleetSpeedKnown`). Build/research times are x1 estimates until `calc.gz.gameSpeed` is known |
| `calc.slots({ computer, astrophysics })`, `calc.cargoCapacity(id, research)` without officers | `await OGX.state.calcSlots()` (Commander 611), `(await OGX.state.shipStats())[id].cargo` (Storage expert 607) |
| `/overlay/server-settings`, `state.ensureServer()` fetching | No settings page: `ensureServer()` returns `state.server()` without a request |
| Highscore `/ajax/highscore` (`#ranks`, `#stat_list_content`, `searchRelId`) | `api.highscore({ category, type, page })` -> page=statistics html -> `parse.highscorePlayers` / `parse.gz.statistics` (rows have `allianceName`, `allianceTag` undefined); one player: `api.playerCard(id)` (points by category, ranks, fights, home coords); top-1: `state.ensureTopScore()`. Errors come with `error`, never a silent `[]` |
| `/ajax/search` json | `api.search(term, 2\|3\|4\|5)` -> same `{ status, results }` json (+ `unverified`); planet results have `id: null` |
| Empire `/empire` | page=imperium (`page.urlFor('empire')`); data through `state.bodies()` (merged from page=imperium: levels, ships, defense, fields, stock) or `parse.gz.empire(doc)`; columns are not in planet-list order |
| `#technologies`, `#technologydetails`, `#build_amount`, `.technology[data-technology]` | GALAXYZ list items `ul.icons > li.technology[data-technology]` (`parse.techList`, `parse.gz.techItems`); the details panel is `#technologydetails_wrapper`/`_content` loaded by `page=<kind>DetailsAjax` [UNVERIFIED panel markup]: listen to bus `techdetails:open`; shipyard orders are `fmenge[id]`, use `api.addBuild` on a click |
| Vacation from `var vacation` | `state.player().vacation` / `vacationUntil` (`parse.gz.vacation`: infobox first; `var vacation` is absent in vacation mode) |
| Times from OgameX JSON `serverTime` | `OGX.time.serverNow()`; game dates in GALAXYZ text are user-zone wall clock: `time.parseGameDate(text)` |
| Numbers `1,234,567` / `1.5M` | GALAXYZ `.` thousands, `,` decimals, long-scale `2.064 M`: `util.parseGameNumber` follows `util.numberDialect` (set by boot); prefer exact sources (`data-real`, tickers, tooltips) |
| `meta[name=csrf-token]`, `_token` | No CSRF on GALAXYZ (`parse.csrf` = `''`); `OGX.http` handles both engines |
| Boot always has a player | A GALAXYZ page without `#playerName` is refused before storage (`OGX.refused`, `data-ogx-<ext>="refused"`): modules never run there |

### 22.2 Known module follow-ups (from the core changes)

* menu: `serverBlock` must check `srv.economySpeedKnown`/`researchSpeedKnown` (null prints `x0` now).
* timeline: `await OGX.state.calcSlots()` instead of `OGX.calc.slots(...)`. targets: `state.shipStats()[id].cargo` instead of `calc.cargoCapacity(203, ...)`.
* stalk (`autoScan`, «Сканировать») and targets scan buttons: pass `userStarted: true, confirm: true`; handle `stoppedBy: 'cost' | 'cancel' | 'deuterium'`; keep autoScan off on GALAXYZ unless the user confirms.
* targets / stalk: subscribe with `OGX.galaxy.onSystem` / `onRender` instead of `bus.on('galaxy:system'|'galaxy:render')` inside `init`.
* spy: use `messages.full(item).full` (or `fetchDetail(...).full`) instead of `fromFull(doc, html)`; send probes via `api.sendMiniFleet` with coordinates (no planet id in reports) and show `unresolved` suggestions.
* stats: `fromDetail` must use `res.full` (battleFull shape from page=raport); `parseLi` must not rely on `li.dataset.msgId` (use `item.id`).
* empire: link with `OGX.page.urlFor('empire')`, not `/resources` or `/facilities`.
* expedition / fleetinfo: replace `fleetDispatcher` / `#fleet1` / `#fleet2` reads with `OGX.fleet.gz.state()`; top-1 points via `state.ensureTopScore()` (works on GALAXYZ now).
