# OgameX Live + OgameX Infinity: design

> **Packaging update (2026-10-30):** Live and Infinity ship as sections of ONE extension, «OgameX Suite» (`ogamex-suite/`). See `specs/SUITE.md`; it supersedes §1.2 and the per-extension parts of §1 and §6.

This document is the contract for every implementation step. It defines the directory layout, the shared core API on `window.OGX`, the modules of both extensions (each file has exactly one owner), the test harness and the coding conventions.

Read together with the area specs, which hold the facts this design relies on:

| Spec | Short name used below |
|---|---|
| `ogx/specs/layout.md` | `L§n` |
| `ogx/specs/buildings.md` | `B§n` |
| `ogx/specs/fleet.md` | `F§n` |
| `ogx/specs/messages.md` | `M§n` |
| `ogx/specs/galaxy.md` | `G§n` |
| `ogx/specs/ogamelive.md` | `OL§n` |
| `ogame_knowledge_base.md` (scratchpad root) | `KB§n` |
| `ogx/specs/objects.jsonl` | object data (62 objects) |

Paths in this document are relative to `ogx/` unless they start with `src/`.

---

## 0. Decisions on the analysts' open questions

These decisions are binding for all steps.

| # | Question | Decision |
|---|---|---|
| 1 | Server timezone (`serverTime` string assumes UTC) | `OGX.time` parses the layout string as UTC, then **auto-calibrates** the first time any JSON `serverTime`/`server_time` (unix seconds) is seen. The difference is rounded to 15 min and stored as `server.tzOffsetMs`. The setting `core.tzOffsetMinutes` (`'auto'` default) can override it. All stored times are **server epoch ms** (true UTC epoch). |
| 2 | Detection vs Vite tags | Detection never looks at `<script src>`. It uses metas, `#planetList` and the OGameX comment or footer link (`L§1`). |
| 3 | Background `?cp=` switching | Never automatic. Only `OGX.state.refreshBodies()` switches `cp`, and only after an explicit user click (with a one-time confirmation that explains the side effect). It runs under a cross-tab lock and always restores the original body, also on `pagehide` (`fetch(..., {keepalive:true})`). |
| 4 | Locale | Parsers use ids, classes, `data-*` and number order. English regexes are a fallback only. UI is Russian; the server has no Russian, so game labels are never matched. |
| 5 | Energy | Energy production/consumption comes from the energy tooltip (read synchronously at `document_end`) and is refined from `/resources/settings` when visited. That is enough. |
| 6-8, 10 | Approximate fixture numbers | Tests compare **parsers** with the fixture values and **formulas** with hand-computed vectors from the OgameX source (`src/OGameX/app/...`) and `tools/buildings/model.js`. Never assert a formula against a fixture's production number. |
| 9 | Synthetic event-list ids | Use the same-response rule plus `a.recallFleet[data-fleet-id]` (`F§12.2`). No cross-check against `/fleet/movement`. |
| 11 | Ownership via home-side coordinates | Accepted. In debug log level, cross-check the hostile count with `/ajax/fleet/eventbox/fetch` and log a warning on mismatch. |
| 12 | Fuel formula variant | Budget checks ("enough deuterium?", raid pre-check) use `max(clientVariant, serverVariant)` (`F§2.7`). Displays show the client variant (what the game shows). |
| 13 | ACS union rows | Parsed as one flight with `isUnion: true`. No fixture, no test requirement. |
| 14 | Messages mark-as-read | Passive parsing on `/messages` is always on. Fetching the full report of an espionage message the user is looking at is on by default. Scanning whole subtabs is an explicit button with a warning (`M§1`). |
| 15 | Lossy ≥ 1 Mn values | Accepted. Values parsed from `x.yyyMn` carry `approx: true` and the UI prefixes them with `≈`. |
| 16 | Galaxy render crash on destroyed planets (`G§4.5`) | Core repairs it when the setting `core.galaxyRepair` is on (default on): MAIN-world `inProgress = false`, hide `#galaxyLoading`, `clearPosition(p)` for the rows the game did not reach. It does not draw the missing rows. |
| 17 | Galaxy scan pacing | Default 700 ms + 0-300 ms jitter, hard floor 500 ms, background cap 300 systems/hour (`G§10`). |
| 19 | Expedition top score | `OGX.state.ensureTopScore()` reads rank 1 from `/ajax/highscore`; Live's expedition module adds a user override and `expedition_reward_multiplier_resources` (default 1.0). |
| 20 | Fractional ship speed | Prefer check-target `shipsData` captured within the last 24 h with the same research levels and class; otherwise the local formula (`F§3.3`). |
| 21 | Half fuel in outbound deuterium | Own outbound flights whose fuel can be recomputed (ships known, distance known, one-way duration known from the synthetic return row) get the half-fuel removed; otherwise the value is kept and flagged `approx: true`. |

Safety rules that follow from the above and apply everywhere:

1. The extensions **never change game state without an explicit user click per action**: sending fleets, building, deleting messages and recalling are always triggered by a click. Nothing runs in a loop. Read-only background requests (event list, galaxy scans for tracked players, highscore) are rate limited.
2. No network request leaves the game origin. No CDN, no telemetry. External links (battle simulator) are only opened by the user.
3. Fetched HTML is parsed with `DOMParser` and never inserted into the page as HTML.

---

## 1. Directory layout

```
ogx/
  specs/                     analysis specs + this DESIGN.md
  fixtures/                  OgameX HTML/JSON samples (read-only for all steps)
  tools/                     fixture generators and recipe checkers (existing)
    gen_catalog.js           CORE: objects.jsonl + KB§16 + messages-object-titles.json -> shared/core/08-catalog-data.js
    gen_exptexts.js          CORE: fixtures/messages-expedition-texts.json -> shared/core/18-exptexts-data.js
    build-userscript.js      INTEGRATION: concatenates an extension into dist/<ext>.user.js
    package.sh               INTEGRATION: zips dist/<ext>-chrome.zip and dist/<ext>-firefox.zip
  shared/                    CORE, single source of truth (never edit the copies inside the extensions)
    main/page-hook.js        MAIN world, document_start: XHR hook + command bridge
    core/00-ogx.js ... core/20-style.js   (section 2.1); core/21-diaglib.js, 22-diag.js, 23-learn.js (diagnostics, DIAG.md)
    background/diag-bg.js    background part of the diagnostic journal (IndexedDB store)
    popup/diag-panel.js .css «Логи для разбора» panel (popup, options, Infinity side panel)
  ogamex-live/
    manifest.json            INTEGRATION
    background.js            INTEGRATION (minimal service worker; tests need it, section 5.2)
    loader.js                INTEGRATION: OGX.boot({ext:'live', modules:[...]})
    popup/ options/ _locales/{ru,en}/ icons/   INTEGRATION
    shared/                  GENERATED by tests/sync.sh (copy of ogx/shared), git-ignored
    modules/<name>/<name>.js MODULE (one directory per module, owned by that module)
  ogamex-infinity/           same structure as ogamex-live
  tests/
    sync.sh                  CORE (test infra)
    server.js lib.js run-all.js   CORE (test infra)
    core-*.test.js           CORE
    live-<module>.test.js    owned by that Live module
    infinity-<module>.test.js  owned by that Infinity module
  dist/                      INTEGRATION output, git-ignored
```

Module CSS is written inside the module's JS file and injected with `ctx.css(text)` (section 3.2). This keeps every module to one file, works the same in the userscript build, and means nothing is styled on sites where the extension exits early.

### 1.1 `tests/sync.sh`

```sh
#!/usr/bin/env bash
# Copy the shared core into both extensions and sanity-check the manifests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for EXT in ogamex-live ogamex-infinity; do
  rm -rf "$ROOT/$EXT/shared"
  mkdir -p "$ROOT/$EXT/shared"
  cp -R "$ROOT/shared/." "$ROOT/$EXT/shared/"
done
# Syntax check every JS file (node can parse browser scripts that do not use DOM at load time).
find "$ROOT/shared" "$ROOT/ogamex-live" "$ROOT/ogamex-infinity" -name '*.js' -not -path '*/node_modules/*' -print0 \
  | xargs -0 -n1 node --check
# Every file referenced by a manifest must exist.
node -e '
  const fs=require("fs"),path=require("path");let bad=0;
  for (const ext of ["ogamex-live","ogamex-infinity"]) {
    const dir=path.join(process.argv[1],ext), mf=path.join(dir,"manifest.json");
    if (!fs.existsSync(mf)) { console.warn("no manifest yet:",ext); continue; }
    const m=JSON.parse(fs.readFileSync(mf,"utf8"));
    for (const cs of m.content_scripts||[]) for (const f of [...(cs.js||[]),...(cs.css||[])])
      if (!fs.existsSync(path.join(dir,f))) { console.error("missing",ext,f); bad++; }
  }
  process.exit(bad?1:0);' "$ROOT"
echo "sync ok"
```

Every test run starts with `bash tests/sync.sh` (`tests/run-all.js` does it, and `tests/lib.js` does it once per process).

### 1.2 Manifest shape (INTEGRATION owns it; modules must not rely on anything else)

```jsonc
{
  "manifest_version": 3,
  "name": "__MSG_name__", "default_locale": "ru", "version": "0.1.0",
  "permissions": ["storage", "unlimitedStorage"],
  "background": { "service_worker": "background.js", "scripts": ["background.js"] },   // Firefox uses "scripts"
  "content_scripts": [
    { "matches": ["http://*/*", "https://*/*"], "exclude_matches": ["*://*.ogame.gameforge.com/*"],
      "js": ["shared/main/page-hook.js"], "run_at": "document_start", "world": "MAIN", "all_frames": false },
    { "matches": ["http://*/*", "https://*/*"], "exclude_matches": ["*://*.ogame.gameforge.com/*"],
      "js": ["shared/core/00-ogx.js", "...all shared/core files in numeric order...",
             "modules/<m1>/<m1>.js", "...modules in the loader order...", "loader.js"],
      "run_at": "document_end", "all_frames": false }
  ],
  "action": { "default_popup": "popup/popup.html" },
  "options_ui": { "page": "options/options.html", "open_in_tab": true },
  "browser_specific_settings": { "gecko": { "id": "ogamex-live@ogx.local", "strict_min_version": "128.0" } }
}
```

Firefox 128 is the first version with `"world": "MAIN"` content scripts. The background script answers `{type:'ogx:ping'}` (so the test harness can reach `chrome.storage`, section 5.2) and hosts the diagnostic journal store: Chrome `importScripts('shared/core/21-diaglib.js', 'shared/background/diag-bg.js')`, Firefox `"scripts": ["shared/core/21-diaglib.js", "shared/background/diag-bg.js", "background.js"]`. The popup mounts the shared «Логи для разбора» panel (`shared/popup/diag-panel.js`); Infinity also loads that file as a content script for its side-panel tab. Details: CORE_API.md §21, DIAG.md.

### 1.3 Script load order inside the isolated world

`shared/core/*.js` in numeric order, then the module files in the order of the loader's `modules` array, then `loader.js`. Core and module files only **define** things at load time (no DOM work, no storage access, no timers). All work starts in `OGX.boot()`, which `loader.js` calls. That is what makes the extension cost nothing on non-OgameX sites.

---

## 2. Shared core (`shared/`)

### 2.1 Files

| File | Namespace | Purpose |
|---|---|---|
| `main/page-hook.js` | (MAIN world) | XHR hook and command bridge (section 2.15). Idempotent: guarded by `window.__ogxHook`. |
| `core/00-ogx.js` | `OGX`, `OGX.log`, `OGX.safe`, `OGX.module`, `OGX.boot` | namespace, logger, error isolation, module registry, boot lifecycle |
| `core/01-util.js` | `OGX.util`, `OGX.fmt` | number parsing, Russian formatting, coords, debounce, sleep |
| `core/02-bus.js` | `OGX.bus` | event bus |
| `core/03-storage.js` | `OGX.storage` | namespaced async storage |
| `core/04-settings.js` | `OGX.settings` | settings registry with defaults and schema |
| `core/05-page.js` | `OGX.page` | OgameX detection and page routing |
| `core/06-time.js` | `OGX.time` | server clock, timezone calibration |
| `core/07-dom.js` | `OGX.dom` | DOM helpers and UI widgets (menu entry, side panel, modal, toast, table, tooltip, settings form) |
| `core/08-catalog-data.js` | `OGX.catalog._data` | GENERATED by `tools/gen_catalog.js` |
| `core/09-catalog.js` | `OGX.catalog` | object catalog lookups |
| `core/10-calc.js` | `OGX.calc` | game formulas (OgameX exact) |
| `core/11-parse.js` | `OGX.parse` | layout, buildings and fleet page parsers |
| `core/12-http.js` | `OGX.http`, `OGX.api` | HTTP helpers and endpoint wrappers |
| `core/13-bridge.js` | `OGX.bridge` | isolated-world side of the MAIN bridge |
| `core/14-state.js` | `OGX.state` | per-page snapshot, body store, data collection, refresh-all |
| `core/15-flights.js` | `OGX.flights` | event list, flights, in-flight resources, arrival projection |
| `core/16-fleet.js` | `OGX.fleet` | fleet selection math, dispatch prefill, guarded send |
| `core/17-galaxy.js` | `OGX.galaxy` | galaxy JSON parsing, piggyback, scanner, row slots, system cache, player index |
| `core/18-exptexts-data.js` | `OGX.messages._expTexts` | GENERATED by `tools/gen_exptexts.js` |
| `core/19-messages.js` | `OGX.messages` | message list/detail fetch, watcher, report parsers |
| `core/20-style.js` | (CSS string) | base CSS for `ogx-` widgets, injected by `OGX.boot` |

Shared code that only Infinity uses (galaxy, messages) still lives in the core, because it is used by more than one Infinity module and the core is the only owner of shared code. Live never calls those namespaces.

Conventions for all signatures below:
- `BodyKey` = `'p<planetId>'` or `'m<moonId>'` (real OgameX ids, never the `.smallplanet` index, `OL§2.2`).
- `Coords` = string `'g:s:p'`.
- `Res` = `{metal:number, crystal:number, deuterium:number}`.
- Times: `ServerMs` = server epoch milliseconds (true UTC epoch). Durations in seconds unless the name ends in `Ms`.
- `Ships` = `{[shipId:number]: count}`.
- Every async function returns a Promise and never throws for expected HTTP failures; it returns an error shape instead (documented per function). Programming errors may throw.

### 2.2 `00-ogx.js`: namespace, logger, lifecycle

```js
window.OGX = {
  version: '0.1.0',
  ext: null,                // 'live' | 'infinity' (set by boot)
  active: false,            // true after a successful isOgx() check
  modules: {},              // name -> definition (registered)
  errors: [],               // last 50 {t, where, message, stack}
};

OGX.log.create(tag: string) -> { debug(...a), info(...a), warn(...a), error(...a) }
//   prefix: `[OGX ${ext==='live'?'Live':'Infinity'}/${tag}]`; level from setting core.logLevel ('debug'|'info'|'warn'|'error', default 'warn').
//   error() also pushes into OGX.errors.
OGX.safe(fn: Function, where: string) -> Function
//   wraps sync or async fn; catches and logs errors (OGX.log 'error'), returns undefined on error. Used for every DOM/bus/timer callback.

OGX.module(def: ModuleDef) -> void          // registers; throws on duplicate name
ModuleDef = {
  name: string,                     // unique within the extension, kebab-free lowercase: 'planetbar'
  title: string,                    // Russian, shown in settings: 'Производство на планетах'
  pages: string[] | '*',            // OGX.page names (section 2.6) where init runs; '*' = every in-game page
  settings?: SettingsSchema,        // section 2.5; an `enabled` bool (default true) is added automatically
  init(ctx: ModuleCtx): void | Promise<void>,
  dispose?(ctx): void,              // called on pagehide (best effort)
};

OGX.boot({ ext: 'live'|'infinity', modules: string[] }) -> Promise<void>
```

`OGX.boot` sequence (the only place that starts work):

1. `if (!OGX.page.isOgx()) return;` before anything else (no storage, no logging above debug).
2. `const snap = OGX.state.snapshotSync(document);` **synchronously, before the first `await`**: it reads tooltip `title` attributes before the game's Tipped strips them (`L§4.2`).
3. `OGX.ext = ext; OGX.active = true; document.documentElement.dataset['ogx' + Ext] = 'boot';` (`data-ogx-live` / `data-ogx-infinity`).
4. `await OGX.storage.init({ ext, host: location.host, playerId: snap.player.id });`
5. `await OGX.settings.load();` `OGX.time.init(snap);` `OGX.dom.injectStyle('ogx-core', OGX.style.core);` `OGX.bridge.init();`
6. `await OGX.state.merge(snap);` then `OGX.galaxy.init()` and `OGX.fleet.initPrefill()` (each guarded by `OGX.safe`; they do nothing outside their pages).
7. For each name in `modules` (in order): skip if `!OGX.settings.get(name + '.enabled')` or the page does not match; otherwise `await OGX.safe(def.init, name)(ctx)`. A module's failure never stops the next one.
8. `dataset['ogx' + Ext] = 'ready'`; `OGX.bus.emit('ready')`; start the tick timer: `setInterval(() => OGX.bus.emit('tick', OGX.time.serverNow()), settings core.tickMs || 1000)` (skipped while `document.hidden`).
9. `addEventListener('pagehide', ...)`: flush storage writes, call `dispose`.

`ModuleCtx` (built by boot for each module):

```js
ctx = {
  ext, name,
  log,                               // OGX.log.create(name)
  page,                              // OGX.page.info()
  settings: { get(key), set(key, value) -> Promise, all() -> object, onChange(fn(key, value)) -> unsubscribe },  // keys WITHOUT the module prefix
  store: { get(key, def), set(key, v), update(key, fn, def), remove(key), subscribe(key, fn) },  // = OGX.storage with keys prefixed `${name}.`
  css(text) -> HTMLStyleElement,     // OGX.dom.injectStyle(`ogx-${ext[0]}-${name}`, text)
  on(target, type, handler, opts),   // addEventListener with OGX.safe wrapping, removed on dispose
  every(ms, fn),                     // runs fn on the shared tick when ms elapsed since last run (no own setInterval)
  bus: OGX.bus, state: OGX.state,
};
```

### 2.3 `01-util.js`: parsing and Russian formatting

```js
OGX.util.parseGameNumber(s: string) -> number
//   OgameX en formats: "152,347" -> 152347; "+4,128" -> 4128; "-2,754" -> -2754; "1.234Mn" -> 1234000; "1.5M" -> 1500000;
//   "2B" -> 2e9; "12K" -> 12000; "152347.29861111" (data-raw) -> 152347.29861111. (OL§9 OGX_LIVE.num, without rounding of plain floats)
OGX.util.parseGameNumberEx(s) -> { value: number, approx: boolean }   // approx = true for Mn/M/B/K suffixes
OGX.util.parseShortComma(s) -> number   // formatNumberShort with ',' decimal: "7,7K" -> 7700 (L§6.5; prefer data-value)
OGX.util.parseDotThousands(s) -> number // phalanx "1.250" -> 1250 (F§10)
OGX.util.parseIsoDuration(s) -> seconds // "PT1W4D2H40M" (B§6.2, W and D inside the time part)
OGX.util.coords(s) -> Coords|null       // from "[1:42:8]", "1:42:8", link text; takes the LAST match in the string
OGX.util.coordsArr(c: Coords) -> [g, s, p]
OGX.util.sameSystem(a, b) -> boolean
OGX.util.debounce(fn, ms), OGX.util.throttle(fn, ms), OGX.util.sleep(ms) -> Promise
OGX.util.uid() -> string                // short random id
OGX.util.clone(obj)                     // structuredClone fallback JSON
OGX.util.sum(res: Res) -> number

OGX.fmt.num(n) -> string        // Russian grouping with U+00A0: 1234567 -> "1 234 567"; negative "-1 234"; non-finite -> "—"
OGX.fmt.short(n) -> string      // "12,3 тыс.", "1,23 млн", "4,5 млрд"; |n| < 10000 -> fmt.num(n)
OGX.fmt.auto(n) -> string       // short or num depending on setting core.numberStyle ('full' | 'short', default 'full')
OGX.fmt.signed(n) -> string     // "+1 234" / "-1 234"
OGX.fmt.pct(x, digits=0) -> string   // 0.256 -> "26%"
OGX.fmt.duration(secs) -> string     // <=0 "Готово"; Infinity/NaN "∞"; <60 "45с"; "12:05" (mm:ss); "3:04:05"; "2д 03:04:05"; "5н 2д 03:04"
OGX.fmt.durationShort(secs) -> string // "2д 3ч", "3ч 4м", "4м 5с"
OGX.fmt.time(serverMs) -> string      // "ЧЧ:ММ:СС" in the zone of setting core.timeDisplay ('server' default | 'local')
OGX.fmt.dateTime(serverMs) -> string  // "30.10 01:36:17" (same zone rule); adds the year when it differs from now
OGX.fmt.coords(c: Coords, type?) -> string   // "[1:42:8]", moon adds " Л", debris " ПО"
OGX.fmt.res(res, {short}) -> string   // "М 1 234 · К 5 678 · Д 90"
OGX.fmt.plural(n, [one, few, many]) -> string   // Russian plural rules
OGX.fmt.ago(serverMs) -> string       // "5 мин назад", "2 ч назад", "3 д назад"
```

### 2.4 `02-bus.js`: event bus

```js
OGX.bus.on(event: string, fn) -> unsubscribe   // fn wrapped with OGX.safe
OGX.bus.once(event, fn) -> unsubscribe
OGX.bus.off(event, fn)
OGX.bus.emit(event, payload?) -> void           // synchronous fan-out
```

Core events (payload in parentheses). Modules may emit their own events named `'<module>:<what>'`.

| Event | Payload | Emitted by |
|---|---|---|
| `ready` | — | boot |
| `tick` | `ServerMs` | boot timer (1 s) |
| `settings:changed` | `{key, value}` | settings |
| `storage:changed` | `{key, value, remote:boolean}` | storage (also other tabs) |
| `state:updated` | `{keys:string[]}` (store keys that changed: `'bodies'`, `'research'`, …) | state |
| `flights:updated` | `{t, flights}` | flights |
| `galaxy:system` | `{system: ParsedSystem, source:'page'|'scan'}` | galaxy |
| `galaxy:render` | `{galaxy, system, rows: Map<pos, Element>}` | galaxy (after the game rendered) |
| `messages:item` | `MessageItem` (section 2.18) | messages watcher |
| `xhr` | `XhrEvent` (section 2.15) | bridge |
| `fleet:sent` | `{request, response, ok}` | fleet / bridge (game's own sends too) |
| `techdetails:open` | `{id, el}` | state (on list pages, when `#technologydetails` is replaced) |

### 2.5 `03-storage.js` and `04-settings.js`

Backend: `chrome.storage.local` (or `browser.storage.local`); when neither exists (userscript, inject-mode tests without shim) `localStorage` with prefix `ogx.<ext>.` and change events from the `storage` window event. Values are JSON-serializable.

Key namespacing. The full stored key is `<scopePrefix><key>`:

| Scope | Prefix | Used for |
|---|---|---|
| `'player'` (default) | `<host>|<playerId>|` | everything about the account |
| `'server'` | `<host>|*|` | universe data shared by all accounts on the server: server settings, galaxy cache, player directory, titles, top score |
| `'global'` | `*|*|` | per-extension data independent of servers (rare) |

`host` is `location.host` lowercased (port included).

```js
OGX.storage.init({ ext, host, playerId }) -> Promise<void>   // also callable from the options page to pick a namespace
OGX.storage.get(key, def = null, { scope = 'player' } = {}) -> Promise<any>
OGX.storage.getMany(keys: string[], opts) -> Promise<{[key]: any}>
OGX.storage.set(key, value, opts) -> Promise<void>            // writes are coalesced per key (100 ms) and flushed on pagehide
OGX.storage.update(key, fn: (old) => new, def = null, opts) -> Promise<new>   // serialized per key (in-tab promise chain)
OGX.storage.remove(key, opts) -> Promise<void>
OGX.storage.keys(prefix = '', opts) -> Promise<string[]>       // keys without the scope prefix
OGX.storage.subscribe(key, fn(newValue, {remote}), opts) -> unsubscribe   // remote = changed by another tab
OGX.storage.namespaces() -> Promise<[{host, playerId, keys:number}]>      // for the options page
OGX.storage.exportAll({ scopes = ['player','server'], prefixes = null }) -> Promise<ExportFile>
OGX.storage.importAll(file: ExportFile, { mode = 'merge' | 'replace' }) -> Promise<{written:number, skipped:number}>
OGX.storage.registerMerger(keyPrefix, fn(oldValue, importedValue) -> mergedValue)   // used by 'merge' mode; default: imported wins
OGX.storage.lock(name, ttlMs) -> Promise<{ release(): Promise<void> } | null>     // cross-tab lock stored at `lock.<name>`; null if held

ExportFile = { format: 'ogx-export', ext, version: OGX.version, host, playerId, exportedAt: ServerMs,
               data: { player: {[key]: value}, server: {[key]: value} } }
```

Single-writer rule: **every storage key has exactly one writer** (table in section 2.19). Modules write only through `ctx.store` (prefix `<module>.`) and `ctx.settings`. Reading other keys is allowed. `importAll` is the only sanctioned exception.

Large data is chunked by the owner (for example the galaxy cache uses one key per galaxy). Keep any single value under about 2 MB.

Settings:

```js
SettingsSchema = { [key]: {
  type: 'bool'|'int'|'float'|'enum'|'string'|'color'|'hotkey'|'json',
  default: any, label: string /* Russian */, hint?: string, min?, max?, step?,
  options?: [{ value, label }],          // enum
  section?: string,                       // grouping in the form
  hidden?: boolean,                       // stored but not shown (UI state such as the open tab)
} }

OGX.settings.define(ns: string, schema) -> void       // OGX.module() calls it with ns = module name; core uses ns 'core'
OGX.settings.load() -> Promise<void>                  // reads key 'settings' (player scope), fills defaults
OGX.settings.get(path: 'ns.key') -> any               // synchronous after load; default when unset
OGX.settings.set(path, value) -> Promise<void>        // validates/clamps by schema, persists, emits settings:changed
OGX.settings.all(ns?) -> object
OGX.settings.schema(ns?) -> { [ns]: SettingsSchema }
OGX.settings.onChange(path | ns | '*', fn) -> unsubscribe
OGX.settings.reset(ns) -> Promise<void>
```

Core settings (`ns = 'core'`):

| key | type | default | label |
|---|---|---|---|
| `logLevel` | enum debug/info/warn/error | `warn` | Уровень журнала |
| `tickMs` | int 250..5000 | 1000 | Частота обновления таймеров, мс |
| `numberStyle` | enum full/short | `full` | Формат чисел |
| `timeDisplay` | enum server/local | `server` | Показывать время |
| `tzOffsetMinutes` | string (`auto` or integer) | `auto` | Часовой пояс сервера |
| `httpGapMs` | int 200..5000 | 400 | Пауза между фоновыми запросами, мс |
| `flightsPollSec` | int 0..600 | 60 | Опрос событий флота, с (0 = выкл.) |
| `galaxyScanDelayMs` | int 500..10000 | 700 | Пауза между системами при сканировании, мс |
| `galaxyScanPerHour` | int 10..3600 | 300 | Лимит фоновых сканов систем в час |
| `galaxyRepair` | bool | true | Исправлять зависание галактики на уничтоженных планетах |
| `backgroundWhenHidden` | bool | false | Фоновые запросы во вкладке в фоне |
| `confirmActions` | bool | true | Подтверждать отправку флота и постройки |
| `cpConfirmed` | bool hidden | false | the user accepted the `?cp=` side-effect notice |

### 2.6 `05-page.js`: detection and routing

```js
OGX.page.isOgx(doc = document, loc = location) -> boolean
//   1. /(^|\.)ogame\.gameforge\.com$/i.test(loc.hostname) -> false
//   2. no meta[name="csrf-token"] or no meta[name="ogame-version"] -> false
//   3. no #planetList -> false (out-game pages)
//   4. head comment matching /OGameX/ OR #siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i] -> true, else false
//   Cost: at most 5 DOM queries. No storage, no network. (L§1)
OGX.page.info() -> PageInfo   // cached after first call
PageInfo = { name: PageName, path: string, query: URLSearchParams, bodyId: string,
             isAdmin: boolean /* #adminbar */, origin: string }
OGX.page.is(...names: PageName[]) -> boolean
OGX.page.url(path, query = {}) -> string   // absolute on location.origin; query values undefined/null are dropped
OGX.page.go(path, query = {})              // location.assign
```

`PageName` is resolved from `location.pathname` without a trailing slash, longest prefix first (`L§10`):

| PageName | Path |
|---|---|
| `overview` | `/overview` (and `/`) |
| `resourceSettings` | `/resources/settings` |
| `resources` | `/resources` |
| `facilities` | `/facilities` |
| `research` | `/research` |
| `shipyard` | `/shipyard` |
| `defense` | `/defense` |
| `movement` | `/fleet/movement` |
| `fleet` | `/fleet` |
| `galaxy` | `/galaxy` |
| `messages` | `/messages` |
| `highscore` | `/highscore` |
| `buddies` | `/buddies` |
| `merchant` | `/merchant` and `/merchant/*` |
| `alliance` | `/alliance` and `/alliance/*` |
| `premium`, `shop`, `rewards`, `characterclass`, `chat`, `options` | same-named paths |
| `planetMove` | `/planet-move` |
| `admin` | `/admin/*` |
| `other` | anything else that passed `isOgx()` |

### 2.7 `06-time.js`: server clock

```js
OGX.time.init(snap) -> void           // uses snap.serverTimeString + snap.parsedAtMs (Date.now() at parse)
OGX.time.serverNow() -> ServerMs      // Date.now() + offsetMs
OGX.time.offsetMs -> number           // serverEpochMs - Date.now()
OGX.time.renderMs -> ServerMs         // server time when the current page was rendered
OGX.time.tzOffsetMs -> number         // (server wall clock) - UTC, auto-calibrated or from setting
OGX.time.calibrate(unixSeconds: number) -> void   // from any JSON serverTime/server_time; first call fixes tzOffsetMs (rounded to 15 min) and stores server.tzOffsetMs
OGX.time.parseServerWall(s: string) -> ServerMs|null
//   accepts "2026-10-30 00:57:17", "30.10.2026 01:36:17", "30.10.2026<br>01:30:37"; interprets as server wall clock minus tzOffsetMs
OGX.time.toLocalMs(serverMs) -> number    // serverMs - offsetMs (for setTimeout scheduling)
```

Sources (`L§8`): `var serverTime = new Date('Y-m-d H:i:s')` in an inline script. JSON `serverTime` comes from `/ajax/<page>?technology=` (`L§6.5`) and `server_time` from the phalanx. `OGX.http` calls `calibrate` automatically for every JSON body that has one.

### 2.8 `07-dom.js`: DOM helpers and widgets

```js
OGX.dom.$(sel, root = document) -> Element|null
OGX.dom.$$(sel, root = document) -> Element[]
OGX.dom.h(tag, attrs = {}, ...children) -> Element
//   attrs: class (string|array), style (object|string), dataset (object), on<Event> (function, wrapped with OGX.safe), title, any attribute.
//   children: Node | string (text node, never parsed as HTML) | array | null.
OGX.dom.waitFor(selectorOrFn, { root = document, timeout = 10000 } = {}) -> Promise<Element|null>   // MutationObserver based; null on timeout
OGX.dom.observe(target, cb, { debounce = 100, childList = true, subtree = true, attributes = false } = {}) -> disconnect
OGX.dom.injectStyle(id, cssText) -> HTMLStyleElement   // idempotent by id (replaces text)
OGX.dom.menuEntry({ id, label, iconText = '◆', title, onClick, badge }) -> { li, setBadge(text|null), setActive(bool) }
//   appends <li> to ul#menuTableTools with the game's markup (L§12): span.menu_icon > div.menuImage.ogx-menu-icon + a.menubutton > span.textlabel
OGX.dom.sidePanel(id, { title, width = 360, side = 'right' } = {}) -> SidePanel     // get-or-create singleton per id
SidePanel = {
  el, header, body,
  open(), close(), toggle(), isOpen() -> boolean,
  addTab({ id, label, order = 100, badge?, render(container: Element, panel) -> void | Promise<void>, onShow?(), onHide?() }) -> { setBadge(text|null), refresh() },
  selectTab(id), currentTab() -> string|null,
  setStatus(text|null),            // footer status line
}
//   fixed-position container appended to <body> (does not reflow #pageContent), z-index above game UI but below game dialogs;
//   open state and selected tab persist in settings core.panel.<id>.open / .tab (hidden settings). Width resizable by drag; <= 100vw on narrow screens.
OGX.dom.modal({ title, body: Node, buttons = [{ label, primary, danger, onClick(close) }], width = 520 }) -> { el, close() }
OGX.dom.confirm(text, { okLabel = 'Да', cancelLabel = 'Отмена', danger } = {}) -> Promise<boolean>
OGX.dom.toast(text, { type = 'info'|'ok'|'warn'|'error', ms = 3500 } = {}) -> void
OGX.dom.tooltip(el, content: string | Node | (() => Node), { side = 'auto' } = {}) -> detach   // own tooltip; game Tipped is not reachable
OGX.dom.table({ columns, rows, sortKey, sortDir = 'desc', rowKey, onRowClick, emptyText = 'Нет данных', maxRows }) -> { el, setRows(rows), sortBy(key, dir) }
//   columns: [{ key, label, title?, align?: 'left'|'right'|'center', sortable = true, value?(row) -> sortable, render?(row) -> Node|string, width? }]
OGX.dom.bar(fraction 0..1, { cls, title }) -> Element   // small horizontal fill bar (.ogx-bar > .ogx-bar-fill), colour classes ogx-ok/ogx-warn/ogx-bad
OGX.dom.countdown(serverMsEnd, { doneText = 'Готово' }) -> Element   // span.ogx-countdown[data-end]; updated by core on 'tick'
OGX.dom.settingsForm(nsList: string[], { onChange } = {}) -> Element   // form generated from OGX.settings.schema; enable toggles first
OGX.dom.download(filename, text, mime = 'application/json') -> void
OGX.dom.pickFile({ accept = '.json' } = {}) -> Promise<string|null>   // file text
OGX.dom.copy(text) -> Promise<boolean>
OGX.dom.icon(name) -> Element   // small inline-SVG icons: 'gear','refresh','star','eye','note','send','spy','trash','up','down','close','plus'
```

Core keeps every `.ogx-countdown[data-end]` in the document updated on `tick` (one global pass), so modules do not run timers of their own.

### 2.9 `08/09-catalog`: object catalog

`tools/gen_catalog.js` (core) reads `specs/objects.jsonl`, the class-name table in `B§2`, the Russian names in `KB§16`, `fixtures/messages-object-titles.json`, and the drive rules from `src/OGameX/app/GameObjects/Services/Properties/SpeedPropertyService.php` plus the object definitions. It writes `08-catalog-data.js` as `OGX.catalog._data = [...]`.

```js
CatalogObject = {
  id: number, machine: 'metal_mine', className: 'metalMine',
  type: 'building'|'station'|'research'|'ship'|'defense',
  page: 'resources'|'facilities'|'research'|'shipyard'|'defense',   // list page; 212/217 -> 'shipyard'
  planetType: 'planet'|'moon'|'both',
  classOnly: null|'miner'|'warrior'|'explorer',                    // 217 miner, 218 warrior, 219 explorer
  price: { metal, crystal, deuterium, energy, factor: number /* 1 for units */, round100: boolean },
  req: [[id, level]],
  rapidfire: { [targetId]: n },
  props: null | { structural, shield, attack, speed, cargo, fuel, fuelCapacity },   // ships/defense base values
  drive: null | { base: 'combustion'|'impulse'|'hyperspace', upgrades: [{ drive, level, speed }] },  // ships
  ru: 'Рудник металла', ruShort: 'Рудник М', en: 'Metal Mine',
};

OGX.catalog.get(idOrMachineOrClass) -> CatalogObject|null
OGX.catalog.list(type?) -> CatalogObject[]           // in game order
OGX.catalog.shipIds -> number[]                       // getShipObjects() order: 204,205,206,207,215,211,213,214,218,202,203,208,209,210,212,217,219
OGX.catalog.fleetShipIds -> number[]                  // ships that can fly (no 212, 217)
OGX.catalog.defenseIds, OGX.catalog.buildingIds(planetType), OGX.catalog.researchIds
OGX.catalog.idFromTitle(title: string) -> number|null // stored server titles (state.titles) first, then embedded English titles
OGX.catalog.name(id) -> string                        // Russian name
OGX.catalog.missionName(missionType) -> string        // Russian: 1 'Атака', 2 'САБ-атака', 3 'Транспорт', 4 'Оставить', 5 'Держать', 6 'Шпионаж', 7 'Колонизация', 8 'Переработка', 9 'Уничтожение луны', 10 'Ракетная атака', 15 'Экспедиция'
```

### 2.10 `10-calc.js`: formulas (OgameX exact)

Each formula cites its OgameX source; implementers port it line by line (`tools/buildings/model.js` is an existing port to compare with). Inputs that are missing default to 0 levels and `server` defaults (economy 1, all fleet speeds 1).

```js
// Costs and times (B§11, KB§2.3-2.4; src ObjectService::getObjectPrice 568-700, PlanetService time 1018-1240)
OGX.calc.cost(id, level) -> {metal, crystal, deuterium, energy}       // building/research: price of reaching `level`; units: per piece (level ignored)
OGX.calc.costRange(id, fromLevelExcl, toLevelIncl) -> {metal, crystal, deuterium, energy}
OGX.calc.unitCost(id, n) -> {metal, crystal, deuterium, energy}
OGX.calc.buildTime(id, targetLevel, { robotics, nanite, economySpeed }) -> seconds
OGX.calc.unitTime(id, { shipyard, nanite, economySpeed }) -> seconds per unit
OGX.calc.researchTime(id, targetLevel, { labLevel /* incl. IRN */, economySpeed, researchSpeed, playerClass }) -> seconds   // explorer x0.75
OGX.calc.halvingCost(remainingSecs, kind: 'building'|'research'|'unit') -> darkMatter   // HalvingService.php:48-68

// Economy (GameObjectProduction.php, PlanetService.php 2123-2440)
OGX.calc.storageCapacity(level) -> number             // 5000 * floor(2.5 * e^(20*L/33))
OGX.calc.production(input) -> ProductionResult
//   input = { levels: {[id]: level}, percents: {[id]: 0..150}, ships: {212: n, 217: n},
//             tempMin, tempMax, position, isMoon, research: {[id]: level}, playerClass, server: { economySpeed, basicIncome? } }
//   ProductionResult = { perHour: Res, energy: { production, consumption, balance }, factor: 0..1,
//                        breakdown: { [source: 'mines'|'position'|'plasma'|'class'|'crawler'|'base']: Res }, maxCrawlers }
OGX.calc.amountAt(r: { amount, storage, perHour, t: ServerMs }, at: ServerMs) -> number
//   a0 >= storage ? a0 : min(storage, a0 + perHour/3600 * (at - t)/1000); negative production floors at 0 (L§6.3, OL§5.1)
OGX.calc.secondsUntilFull(r, at) -> seconds (0 when full, Infinity when not growing)
OGX.calc.timeUntilAffordable(cost: Res, resources: { metal: r, crystal: r, deuterium: r }, at) -> seconds (0 now, Infinity never)
OGX.calc.costOverlay(cost: Res & {energy?}, resources, at, { capSC, capLC }) ->
//   { total, missingTotal, rows: { metal|crystal|deuterium: { need, have, diff, sc, lc } }, sc, lc, secondsUntilAffordable } (OL§5.5)

// Fleet (F§2.7, F§3.3, KB§3; src SpeedPropertyService, CapacityPropertyService, FleetMissionService 55-223)
OGX.calc.shipSpeed(id, research, playerClass) -> number
OGX.calc.cargoCapacity(id, research, playerClass) -> number   // per ship
OGX.calc.fuelCapacity(id, research) -> number
OGX.calc.shipStats(research, playerClass) -> { [shipId]: { speed, cargo, fuel, fuelCapacity } }   // all fleet ships
OGX.calc.distance(a: Coords, b: Coords, { galaxies = 9, systems = 499, emptySystems = 0, inactiveSystems = 0 } = {}) -> number
OGX.calc.missionSpeedFactor(mission, server) -> number    // war {1,2,6,9,10}, holding {5,15}, peaceful {3,4,7,8}
OGX.calc.flightDuration({ distance, maxSpeed, speedPct /* 1..10 */, speedFactor }) -> seconds
OGX.calc.fleetMaxSpeed(ships: Ships, stats) -> number     // slowest selected type
OGX.calc.fuel({ ships, stats, distance, duration, speedFactor, holdingHours = 0, playerClass,
                variant = 'client'|'server', fleetSpeed /* generic, server variant */ }) -> deuterium
OGX.calc.fleetCargo(ships, stats) -> number
OGX.calc.cargoNeeded(amount, shipId, stats, { reservePct = 0 } = {}) -> count    // ceil(amount*(1+reserve)/cap)
OGX.calc.slots({ computer, astrophysics, playerClass, bonusExpeditionSlots = 0 }) -> { fleet, expedition }

// Combat and loot (LootService.php, BattleEngine.php:67, KB§4)
OGX.calc.lootPct(attackerClass) -> 0.5 | 0.75       // explorer 0.75 against ANY target in OgameX
OGX.calc.loot(res: Res, { attackerClass, cargo = Infinity }) -> Res & { total }   // includes distributeLoot (LootService::distributeLoot port)
OGX.calc.debris(lostUnits: Ships, server) -> Res     // fleet % and defense % from server settings, deuterium only when enabled
OGX.calc.moonChance(debrisTotal, maxChance = 20) -> percent
OGX.calc.unitsValue(units: Ships) -> Res & { total, points }   // points = total/1000
OGX.calc.msu(res, rates = [1, 1.5, 3]) -> number      // metal standard units

// Expeditions (ExpeditionMission.php:1020-1137, OL§5.6)
OGX.calc.expeditionMaxFind({ topPoints, playerClass, economySpeed, hasPathfinder = false, rewardMultiplier = 1 }) ->
//   { base, min, normal: Res, rare: Res /* x3 */, exceptional: Res /* x10 */ }
OGX.calc.expeditionMinShips(maxMetal, stats) -> { 202: n, 203: n }

// Misc
OGX.calc.phalanxRange(level, playerClass) -> systems    // level^2 - 1, explorer x1.2 (F§10)
OGX.calc.missileRange(impulseLevel) -> systems           // 5*L - 1
```

### 2.11 `11-parse.js`: page parsers

All parsers accept a `Document` (live document or `DOMParser` result) or an HTML string where noted, and never throw on missing elements (they return `null` fields). Recipes are already written and verified in the specs; port them, do not reinvent.

```js
OGX.parse.planetList(doc, base = location.href) -> PlanetRow[]     // L§4.3, OL§9 parseBodies
PlanetRow = { planetId, rowId /* "planet-1" index */, name, coords, diameter, fieldsUsed, fieldsMax, tempMin, tempMax,
              building: boolean, downgrading: boolean, isCurrent: boolean,
              moon: null | { id, name, diameter, fieldsUsed, fieldsMax, isCurrent } }
OGX.parse.currentBody(doc, base) -> { key: BodyKey, id, isMoon, planetId, coords, name }   // metas + moonlink cp (OL§9)
OGX.parse.player(doc) -> { id, name, playerClass: 'miner'|'warrior'|'explorer'|'none', darkMatter, rank: number|null, isAdmin, unreadMessages }  // L§9
OGX.parse.csrf(doc) -> string
OGX.parse.serverTimeString(doc|html) -> string|null                // /var serverTime = new Date\('([^']+)'\)/ (L§8)
OGX.parse.metas(doc) -> { version, economySpeed, fleetSpeed, playerId, playerName, planetId, planetName, planetCoords, lang /* <html lang> */ }
OGX.parse.inlineResources(html) -> { metal|crystal|deuterium: { amount, storage, perSecond, perHour }, energy: number|null, darkmatter: number|null }  // L§6.3
OGX.parse.resourceTooltips(doc) -> { metal|crystal|deuterium: { amount, storage, perHour }, energy: { available, production, consumption } }   // raw title (OL§9)
OGX.parse.techList(doc) -> [{ id, className, status: 'on'|'off'|'disabled'|'active', value, target, isUnit }]   // B§3.3
OGX.parse.queueTimers(html) -> { building: { secs, objectId, targetLevel, title, downgrade } | null,
                                 research: { secs, objectId, targetLevel } | null,
                                 unit: { totalSecs, nextSecs, remaining, techId, perUnitSecs, queued: [{ id, amount }] } | null,
                                 cancelIds: [{ objectId, listId }] }   // B§4.2-4.3, OL§9 parseBuildTimers
OGX.parse.resourceSettings(doc) -> { percents: { [id]: 0..150 }, factor: 0..100 }   // B§9
OGX.parse.overviewInfo(html) -> { diameter, fieldsUsed, fieldsMax, tempMin, tempMax, coords, points }   // B§5
OGX.parse.fleetPage(doc|html) -> { shipsOnPlanet: Ships, slots: { used, max }, expSlots: { used, max }, speedFactors: { peaceful, war, holding },
                                   currentPlanet: { galaxy, system, position, type, name }, ownBodies: [{ g, s, p, type, name }],
                                   maxGalaxy, maxSystem, resources: Res, titles: { [title]: id } }   // F§2.3-2.4, F§12.4
OGX.parse.techDetails(json) -> { id, current, nextLevel, durationSecs, costs: { metal|crystal|deuterium|energy: { value, enough } },
                                 energyNeeded, energyProduction, maxAmount, canBuild, canDowngrade, demolish: Res }   // B§6
OGX.parse.techDetailsElement(el: Element) -> same shape          // the live #technologydetails on list pages
OGX.parse.shipProps(html) -> { structural, shield, attack, speed, capacity, consumption }   // techtree tab 2, visible text (OL§4.8)
OGX.parse.serverSettings(html) -> ServerSettings                 // L§11
ServerSettings = { universeName, economySpeed, researchSpeed, fleetSpeedWar, fleetSpeedHolding, fleetSpeedPeaceful, galaxies, systems: 499,
                   debrisFleetPct, debrisDefensePct, debrisDeuterium: boolean, acs: boolean, ignoreEmpty: boolean, ignoreInactive: boolean,
                   planetFieldBonus, darkMatterBonus }
OGX.parse.titles(doc) -> { [localizedTitle]: id }                 // li.technology[aria-label][data-technology]
OGX.parse.highscorePlayers(html) -> { category: 1, type, page, pages, rows: [{ id, rank, name, me, admin, homeCoords, allianceId, allianceTag, points, totalShips }] }  // G§11.1
OGX.parse.highscoreAlliances(html) -> { category: 2, type, rows: [...] }
OGX.parse.topScore(html) -> { playerId, points } | null
```

### 2.12 `12-http.js`: HTTP helpers and endpoint wrappers

```js
OGX.http.request(path, opts) -> Promise<HttpResult>
opts = { method = 'GET', query?: object, form?: object | URLSearchParams, headers?: object, cp?: number /* adds ?cp= */,
         expect = 'auto' | 'json' | 'text' | 'doc', timeout = 20000, keepalive = false, background = false }
HttpResult = { ok: boolean, status: number, url: string, redirected: boolean, loggedOut: boolean,
               json?: any, text?: string, doc?: Document, error?: string }
//   * absolute URL on location.origin; credentials 'include'; headers X-Requested-With: XMLHttpRequest, Accept, X-CSRF-TOKEN: csrf().
//   * form bodies are application/x-www-form-urlencoded and ALWAYS include _token (B§1: add-buildrequest checks the body token).
//   * Firefox: uses content.fetch when available (L§7).
//   * loggedOut = redirected to /login, or 401/419. A 419 refreshes the token from a GET /overview once and retries once.
//   * every JSON body: if it has newAjaxToken that is not the junk constant '91cf2833548771ba423894d1f3dddb3c' (F§1), csrf is updated;
//     if it has serverTime/server_time, OGX.time.calibrate() is called.
//   * background: true -> goes through the polite queue (one in flight, core.httpGapMs between requests,
//     paused while document.hidden unless core.backgroundWhenHidden).
OGX.http.get(path, opts), OGX.http.post(path, form, opts)
OGX.http.csrf() -> string
OGX.http.withPlanet(bodyId: number, fn: () => Promise<T>, { restoreTo } = {}) -> Promise<T>
//   cross-tab lock 'cp'; every request inside passes ?cp=bodyId; afterwards GET /overview?cp=<restoreTo ?? original current body id>.
//   On pagehide during the run, the restore request is sent with keepalive.

// Endpoint wrappers. All return parsed data or { error, status } (never throw on HTTP errors).
OGX.api.page(path, { cp, query }) -> Promise<{ html, doc, url } | { error, status }>       // full page GET (e.g. /fleet?cp=3)
OGX.api.techDetails(id, { cp } = {}) -> Promise<TechDetails | { error }>                 // GET /ajax/resources?technology=id
OGX.api.techtree(tab, objectId) -> Promise<string | { error }>                           // GET /ajax/techtree
OGX.api.serverSettings() -> Promise<ServerSettings | { error }>                          // GET /overlay/server-settings
OGX.api.eventList() -> Promise<string | { error }>                                       // GET /ajax/fleet/eventlist/fetch
OGX.api.eventBox() -> Promise<{ hostile, neutral, friendly, eventType, eventTime, eventText } | { error }>
OGX.api.movement() -> Promise<{ doc } | { empty: true } | { error }>                      // 302 to /fleet = no missions
OGX.api.checkTarget({ galaxy, system, position, type, ships, union = 0 }, { cp } = {}) -> Promise<json | { error }>
OGX.api.sendFleet(req: SendFleetRequest, { cp } = {}) -> Promise<{ success: boolean, message: string, errors?: [{ message, error }] }>
SendFleetRequest = { galaxy, system, position, type: 1|2|3, mission, ships: Ships, speed /* 1..10 step 0.5 */, cargo: Res, holdingtime = 0, union = 0 }
OGX.api.sendMiniFleet({ mission: 6|8, galaxy, system, position, type, shipCount }) -> Promise<{ success, message, shipsSent }>
OGX.api.recall(missionId) -> Promise<{ success }>
OGX.api.templates() -> Promise<[{ id, name, ships }] | { error }>
OGX.api.galaxy(galaxy, system) -> Promise<{ json } | { error, status }>                   // POST /ajax/galaxy; never with cp
OGX.api.highscore({ category = 1, type = 0, page, searchRelId }) -> Promise<string | { error }>
OGX.api.search(term, category /* 2 players, 3 planets, 4 alliances */) -> Promise<{ results: [...] } | { error }>
OGX.api.messagesList(tab, subtab, page = 1) -> Promise<{ doc } | { error }>
OGX.api.message(id, tab, subtab) -> Promise<{ doc } | { error }>
OGX.api.deleteMessage(id) -> Promise<boolean>
OGX.api.addBuild(page: 'resources'|'facilities'|'research'|'shipyard'|'defense', id, { amount = 1, downgrade = false, cp } = {}) ->
//   Promise<{ ok: boolean, message: string }>   (B§8; defense posts to /shipyard/add-buildrequest)
```

### 2.13 `13-bridge.js` and `main/page-hook.js`

`page-hook.js` runs in the page (MAIN) world at `document_start` on every matched site. To keep it harmless elsewhere it only wraps `XMLHttpRequest.prototype.open/send` and only acts for requests whose URL path matches the whitelist below, and only dispatches when `document.querySelector('meta[name="ogame-version"]')` exists. It installs once per page (`window.__ogxHook = {version}`), so with both extensions installed the first one serves both.

Whitelist: `/ajax/galaxy`, `/ajax/fleet/dispatch/(check-target|send-fleet|send-mini-fleet|recall-fleet)`, `/ajax/fleet/eventlist/fetch`, `/ajax/fleet/eventbox/fetch`, `/ajax/messages`, `/ajax/highscore`, `/ajax/search`, `/ajax/(resources|facilities|research|shipyard|defense)`, `/(resources|facilities|research|shipyard|defense)/add-buildrequest`.

Wire protocol (all `detail` values are **strings**, because objects do not cross worlds in Firefox, `G§11.2`):
- Hook → isolated: `document.dispatchEvent(new CustomEvent('ogx:xhr', { detail: JSON.stringify(XhrEvent) }))` on `load`, after the game's own callback.
- Isolated → hook: `CustomEvent('ogx:call', { detail: JSON.stringify({ id, method, args }) })`; reply `CustomEvent('ogx:reply', { detail: JSON.stringify({ id, ok, result, error }) })`.

```js
XhrEvent = { url, method, status, requestBody: string|null, responseText: string, t: Date.now() }

OGX.bridge.init() -> void                      // listens for ogx:xhr and re-emits as OGX.bus 'xhr' with parsed form fields
OGX.bridge.onXhr(pathRegex, fn(XhrEvent & { form: object, json: any|null })) -> unsubscribe
OGX.bridge.call(method, ...args) -> Promise<any>   // rejects after 3000 ms or when the hook is missing
```

Bridge methods (implemented in `page-hook.js`; each checks the global exists and returns `{ok:false}` otherwise):

| Method | Does (page world) |
|---|---|
| `fleet.state()` | `{ shipsToSend, targetPlanet, mission, speedPercent, cargoMetal, cargoCrystal, cargoDeuterium, expeditionTime, holdingTime, shipsData: fleetDispatcher.fleetHelper.shipsData, currentPage }` |
| `fleet.selectShips(ships)` | `fleetDispatcher.resetShips?.(); fleetDispatcher.selectShips(ships); fleetDispatcher.refresh()` |
| `fleet.setTarget({galaxy, system, position, type})` | set `targetPlanet`, `setTargetType(type)`, `refreshTarget()`, `updateTarget()` |
| `fleet.selectMission(m)` | `selectMission(m)` |
| `fleet.setCargo({metal, crystal, deuterium})` | sets cargo fields and inputs, `refresh()` |
| `fleet.setSpeed(pct10)` | `setFleetPercent(pct10)` |
| `fleet.setDuration(hours)` | sets `expeditionTime`/`holdingTime` and the selects |
| `fleet.goStep(2)` | `switchToPage('fleet2')` / `('fleet1')` |
| `fleet.submit()` | `trySubmitFleet2()`; only called from a user click handler |
| `galaxy.load(g, s)` | `loadContentNew(g, s)` |
| `galaxy.repair(fromPos)` | `inProgress = false; $('#galaxyLoading').hide(); for p >= fromPos: clearPosition(p)` (`G§4.5`) |
| `resources.live()` | `resourcesBar.resources` amounts (`L§6.3`) |

### 2.14 `14-state.js`: snapshot, body store, collection

```js
OGX.state.snapshotSync(doc = document) -> PageSnapshot     // synchronous; reads title attributes FIRST
PageSnapshot = {
  parsedAtMs: number /* Date.now() */, serverTimeString, page: PageName,
  player, metas, csrf, current: { key, id, isMoon, planetId, coords, name },
  planets: PlanetRow[], inline: InlineResources, tooltips: ResourceTooltips,
  techList?: [...], queues?: QueueTimers, resourceSettings?: {...}, overviewInfo?: {...},
  fleetPage?: {...}, titles?: {...}, movement?: Flight[]     // only on the pages that have them
}
OGX.state.merge(snap) -> Promise<void>     // updates the stores below; newer data never replaced by older (per-field timestamps); emits state:updated

OGX.state.bodies() -> Promise<{ [BodyKey]: Body }>
OGX.state.body(key) -> Promise<Body|null>
OGX.state.bodyList() -> Promise<[{ planet: Body, moon: Body|null }]>    // planet-list order
OGX.state.current() -> { key, id, isMoon, planetId, coords, name }      // synchronous, from the snapshot
OGX.state.research() -> Promise<{ levels: { [id]: level }, t, queue: { objectId, targetLevel, endsAt } | null }>
OGX.state.player() -> Promise<{ id, name, playerClass, darkMatter, rank, isAdmin, t }>
OGX.state.server() -> Promise<ServerSettings & { tzOffsetMs, t }>
OGX.state.ensureServer({ maxAgeMs = 86400000 }) -> Promise<ServerSettings>   // fetches /overlay/server-settings when stale (server scope)
OGX.state.shipStats() -> Promise<{ [shipId]: { speed, cargo, fuel, fuelCapacity, src: 'calc'|'checkTarget'|'techtree', t } }>
//   computed with OGX.calc.shipStats(research, class); replaced by check-target shipsData captured via the bridge (any page) when fresh (decision 20)
OGX.state.titles() -> Promise<{ [title]: id }>
OGX.state.ensureTopScore({ maxAgeMs = 3600000 }) -> Promise<{ points, playerId, t } | null>   // POST /ajax/highscore category=1 type=0 page=1
OGX.state.projected(body: Body, at: ServerMs, { flights } = {}) -> Body   // amounts projected with calc.amountAt; arrivals applied via OGX.flights.applyArrivals when flights given
OGX.state.refreshBodies({ keys = all, include = ['fleet'] /* 'fleet'|'resources'|'facilities'|'shipyard'|'defense'|'settings'|'research' */,
                          onProgress(done, total, key), signal } = {}) -> Promise<{ done, errors: [{ key, error }], restored: boolean }>
//   Needs settings core.cpConfirmed (the caller shows the notice, decision 3). For each body: OGX.http.withPlanet(id, ...) fetches
//   the pages in `include` (background queue), runs snapshot parsers on the fetched HTML and merges. One restore at the end.
OGX.state.onChange(keys: string[] | '*', fn) -> unsubscribe    // sugar over bus 'state:updated'
```

`Body` (stored in `bodies`, player scope):

```js
Body = {
  key: BodyKey, id, type: 'planet'|'moon', planetId /* parent planet id for moons */, name, coords,
  diameter, fieldsUsed, fieldsMax, tempMin, tempMax,                            // from the planet list tooltip
  res: { metal: { amount, storage, perHour }, crystal: {...}, deuterium: {...}, t: ServerMs } | null,
  energy: { available, production, consumption, t } | null,
  levels: { [id]: level }, levelsT: { resources?: ServerMs, facilities?: ServerMs },
  ships: Ships, shipsT: ServerMs|null, defense: { [id]: n }, defenseT: ServerMs|null,
  percents: { [id]: pct }, factor: number|null, percentsT: ServerMs|null,
  queues: {
    building: { objectId, targetLevel, endsAt: ServerMs, downgrade: boolean, queued: [{ objectId, targetLevel }] } | null,
    unit: { endsAt, nextAt, remaining, techId, perUnitSecs, queued: [{ id, amount }] } | null,
    t: ServerMs,
  },
  constructionFlag: boolean,    // planet list wrench, every page
  seenAt: ServerMs,             // last time this body was the current body
}
```

Collection rules (what `merge` takes from which page; the snapshot parsers are in `OGX.parse`):

| Page | Data merged |
|---|---|
| every page | planet list (names, coords, fields, temperature, wrench), current body `res` from inline resources (t = render time), energy from the tooltip, player (id, name, class, DM, rank), metas (economy speed, fleet speed) |
| `resources` | levels of 1-4, 12, 22-24 and amounts of 212/217 (as ships), building + unit queue |
| `facilities` | station levels, building queue |
| `research` | research levels, research queue (player-wide) |
| `shipyard` | all ship amounts incl. 212/217, unit queue |
| `defense` | defense amounts incl. 502/503, unit queue |
| `overview` | the three queues, overview planet info |
| `resourceSettings` | percents and factor |
| `fleet` | `shipsOnPlanet` (flying ships only; merged without wiping 212/217), slots, speed factors, ship titles |
| `movement` | flights (via `OGX.flights`) and slots |
| any page (bridge) | check-target `shipsData` -> ship stats; send-fleet success -> `fleet:sent` + flights invalidated |

Store keys owned by state: `bodies`, `research`, `player`, `slots` (`{ fleet: {used,max}, expedition: {used,max}, t }`), `shipStats` (player), and `server`, `titles`, `topScore` (server scope).

### 2.15 `15-flights.js`: flights

```js
Flight = {
  rowId: number|string, realMissionId: number|null, synthetic: null|'return'|'holdEnd', isUnion: boolean,
  missionType: number, returnFlight: boolean, arrival: ServerMs,
  from: Coords, fromType: 1|2|3|4, to: Coords, toType: 1|2|3|4,       // 4 = deep space
  originKey: BodyKey|null, destKey: BodyKey|null,                       // own body keys when the coords are own
  units: number, ships: Ships, cargo: Res & { approx: boolean }, recallable: boolean,
  own: boolean, status: 'friendly'|'neutral'|'hostile',
  departure: ServerMs|null,                                             // known when the synthetic return row gives the one-way time
}
OGX.flights.parseEventList(html, { ownCoords: Set<Coords>, bodies, titles }) -> Flight[]      // F§12.2, OL§9 eventListToFlights
OGX.flights.parseMovement(doc) -> Flight[]                                                     // F§12.3
OGX.flights.get({ maxAgeMs = 60000, force = false } = {}) -> Promise<{ t: ServerMs, flights: Flight[] } | { error }>
//   cached in store key 'flights'; concurrent callers share one request; emits flights:updated
OGX.flights.startPolling() -> stop        // eventbox poll every core.flightsPollSec while visible; refetch the list when counts change
                                          // or a known arrival passed; idempotent (one poller per tab)
OGX.flights.inFlight(flights) -> Res & { byMission: { [mission]: Res } }   // own missions only, one row per realMissionId (OL§5.7)
OGX.flights.incomingByBody(flights) -> { [BodyKey]: Flight[] }              // own and foreign rows arriving at own bodies
OGX.flights.hostile(flights) -> Flight[]
OGX.flights.applyArrivals(bodies: {[key]: Body}, flights, from: ServerMs, to: ServerMs) -> { [key]: Body }   // OL§5.7 table
```

### 2.16 `16-fleet.js`: fleet helpers and prefill

```js
OGX.fleet.pickCargoShips(amount, available: Ships, stats, { prefer = [203, 202], reservePct = 0 } = {}) -> { ships: Ships, capacity, short: number }
OGX.fleet.estimate({ from: Coords, to: Coords, ships, mission, speedPct = 10, holdingHours = 0 }) ->
  Promise<{ distance, duration, fuelClient, fuelServer, fuelBudget, cargo, arrival: ServerMs, back: ServerMs }>
  // uses state.server, state.shipStats, state.player
OGX.fleet.send(req: SendFleetRequest & { originId?: number, source: string }) -> Promise<{ success, message }>
  // validates speed/ships/cargo, checks known ships and fuel on the origin body (warn only), confirm dialog when core.confirmActions,
  // OGX.api.sendFleet with cp = originId (inside OGX.http.withPlanet when originId differs from the current body),
  // emits fleet:sent, invalidates flights. Must be called from a user click handler.
OGX.fleet.prefill.open(spec: PrefillSpec) -> void   // stores 'prefill' (player scope, 2-minute expiry) and navigates to
                                                    // /fleet?cp=<originId>&galaxy=&system=&position=&type=&mission=
PrefillSpec = { originId, target: { galaxy, system, position, type }, mission, ships: Ships, cargo?: Res, speed?: 1..10,
                holdingHours?: number, source: string /* 'infinity/spy' */, note?: string }
OGX.fleet.initPrefill() -> void   // called by boot; on /fleet with a matching, unexpired 'prefill': waits for #fleet1, applies it through
                                  // the bridge (selectShips -> setTarget -> selectMission -> goStep(2) -> setCargo -> setSpeed), removes the key
                                  // and shows a banner "Флот подготовлен: <note>. Проверьте и нажмите «Отправить»." It never submits.
```

Key owned by fleet: `prefill`.

### 2.17 `17-galaxy.js`: galaxy

```js
ParsedSystem = G§11.1 parseSystem output + { t: ServerMs }
OGX.galaxy.parseSystem(json) -> ParsedSystem|null
OGX.galaxy.activity(a) -> '*'|number|null ; OGX.galaxy.status(player) -> 'vIin…'
OGX.galaxy.init() -> void
//   on every page: OGX.bridge.onXhr(/\/ajax\/galaxy/) -> parse, cache, emit galaxy:system {source:'page'}
//   on /galaxy: after each page render emit galaxy:render; remove stale row slots; run repair when core.galaxyRepair and the
//   response had a destroyed body (G§4.5)
OGX.galaxy.fetch(g, s, { background = true } = {}) -> Promise<ParsedSystem | { error, stoppedBy?: 'auth'|'vacation'|'http' }>
OGX.galaxy.scan(systems: [g, s][], { delayMs, jitterMs = 300, maxPerHour, onSystem, signal } = {}) -> Promise<{ done, stoppedBy }>
//   G§11.1 scan, using settings core.galaxyScanDelayMs / galaxyScanPerHour; one scanner per tab, cross-tab lock 'galaxyScan'
OGX.galaxy.cached(g, s) -> Promise<ParsedSystem|null>        // server scope keys 'galaxy.g<g>' = { [s]: compact system }
OGX.galaxy.player(id) -> Promise<PlayerEntry|null>
OGX.galaxy.players({ nameLike } = {}) -> Promise<PlayerEntry[]>
PlayerEntry = { id, name, status, rank, allianceId, allianceTag, planets: [{ coords, planetId, moonId|null, lastSeenT }], homeCoords, points, t }
//   player index (server scope key 'galaxy.players') updated from every parsed system and every highscore page parsed by core
OGX.galaxy.rowSlot(rowEl, owner: string) -> Element     // span.ogx-gx-slot[data-owner] appended as a direct child of #galaxyRowN (survives cell re-render)
OGX.galaxy.headerSlot(owner) -> Element                 // container appended to #galaxyHeader .systembuttons
OGX.galaxy.current() -> { galaxy, system } | null       // #galaxy_input / #system_input
```

Keys owned by galaxy: `galaxy.g<N>`, `galaxy.players` (server scope).

### 2.18 `19-messages.js`: messages

Port `tools/messages_recipes.js` (the tested reference) into this file without behaviour changes, then add fetching and watching.

```js
MessageItem = { id, tab, subtab, li: Element, isNew: boolean, panel: Element }
OGX.messages.watch(fn(MessageItem)) -> unsubscribe
//   on /messages: observes #ui-id-2 (fleets) and the other tab panels (M§2); calls fn once per li.msg[data-msg-id] per page view;
//   subtab from the panel id (#ui-id-14 espionage, -16 combat_reports, -18 expeditions, -20 transport, -22 other; economy etc. by tab)
OGX.messages.fetchList(tab, subtab, page = 1) -> Promise<{ items: [{ id, li }], page, pages } | { error }>
OGX.messages.fetchDetail(id, tab, subtab) -> Promise<{ doc, html } | { error }>
OGX.messages.delete(id) -> Promise<boolean>
OGX.messages.classify(li, subtab) -> MessageKey   // M§3.4 (expedition index built lazily from 18-exptexts-data.js)

// Parsers (exact names and outputs of tools/messages_recipes.js; see fixtures/messages-expected-parse.json)
OGX.messages.parse.list(doc) -> [{ id, isNew, title, titleClass, date: ServerMs, sender, detailsUrl, li }]
OGX.messages.parse.placeLink(a) -> { coords, type: 'planet'|'moon'|'coordinates'|'debris', planetType, name }
OGX.messages.parse.espionageShort(li) -> { id, target, player, resources (approx), total, counterEspionage }
OGX.messages.parse.espionageFull(doc) -> SpyReport
SpyReport = { id, date: ServerMs, target: { coords, type, planetType, name }, attackParams: { galaxy, system, position, type },
              player, counterEspionage, resources: Res & { energy }, debris: Res,
              ships: { [id]: n }, defense: { [id]: n }, buildings: { [id]: lvl }, research: { [id]: lvl },
              known: { ships, defense, buildings, research } }
OGX.messages.parse.battleShort(li) -> { id, date, coords, attacker: { name, losses, mark }, defender: {...}, lootSum, lootPct, debrisSum, repaired, moonChance }
OGX.messages.parse.battleFull(doc, html) -> { loot: Res, debris: Res, recyclersNeeded, attacker, defender, rounds, unitsLost: { attacker: Ships, defender: Ships }, repaired, moonCreated }
OGX.messages.parse.expedition(li) -> { id, date, key, outcome, resources?: Res, darkMatter?, shipsByName?: { [title]: n }, ships?: Ships }
OGX.messages.parse.fleetMessage(li, key) -> { id, date, key, from, to, resources: Res, harvest?: { ships, capacity, field: Res, harvested: Res } }
OGX.messages.parse.espionageDetected(li) -> { id, date, from, to, spyName, chance }
```

Messages owns no storage keys (the consumers store their own records).

### 2.19 Storage key ownership (complete list)

| Key | Scope | Writer |
|---|---|---|
| `settings` | player | core settings (all modules through the settings API) |
| `bodies`, `research`, `player`, `slots`, `shipStats` | player | core state |
| `server`, `titles`, `topScore` | server | core state |
| `flights` | player | core flights |
| `prefill` | player | core fleet |
| `galaxy.g<N>`, `galaxy.players` | server | core galaxy |
| `lock.<name>` | player | core storage |
| `<module>.<key>` | player (or as noted per module) | that module only |

### 2.20 `20-style.js`

Exports `OGX.style.core` (CSS string): CSS variables on `.ogx-root` (dark, game-matching: background `#0d1014`, panel `#161c24`, border `#2b3846`, text `#cfd8e3`, accent `#6f9fd8`, ok `#4caf50`, warn `#ff9800`, bad `#f44336`, metal `#a9b5c4`, crystal `#79c2e8`, deuterium `#7fe0b4`), font 11px like the game, and styles for: side panel, tabs, tables (`.ogx-table`, sticky header, zebra, sortable arrows), buttons (`.ogx-btn`, `.ogx-btn-primary`, `.ogx-btn-danger`, `.ogx-btn-icon`), modal, toast stack, tooltip, bars, countdowns, badges, form controls, `.ogx-gx-slot`. Every core class starts with `ogx-`.

---

## 3. Coding conventions

### 3.1 File shape

Core files:

```js
/* shared/core/10-calc.js — OgameX formulas. Owner: core. */
(function (OGX) {
  'use strict';
  const calc = (OGX.calc = OGX.calc || {});
  // ...
})(window.OGX);
```

`00-ogx.js` starts with `window.OGX = window.OGX || {};`. In the userscript build everything is concatenated into one closure; `window.OGX` is then the userscript's sandbox window, which is fine.

Module files:

```js
/* ogamex-live/modules/planetbar/planetbar.js — Owner: live/planetbar. */
(function (OGX) {
  'use strict';
  OGX.module({
    name: 'planetbar',
    title: 'Производство на планетах',
    pages: '*',
    settings: {
      prodDisplay: { type: 'enum', default: 'hour', label: 'Показывать выработку', options: [{ value: 'hour', label: 'в час' }, { value: 'day', label: 'в сутки' }] },
    },
    async init(ctx) {
      ctx.css(CSS);
      // ... render, subscribe to ctx.bus 'tick' via ctx.every(...)
    },
  });
  const CSS = `.ogx-l-planetbar-row { ... }`;
})(window.OGX);
```

### 3.2 Rules

1. **ES2020, no bundler, no dependencies, no network outside the game origin.** No jQuery (the game's jQuery is in the page world and unreachable).
2. **Nothing runs at load time** except definitions. All work starts from `init(ctx)`.
3. **Error isolation:** `init` is wrapped by boot; every callback (DOM events, observers, bus, timers, bridge) goes through `ctx.on`, `OGX.bus.on`, `OGX.dom.observe` or `OGX.safe`, which catch and log. A module must never throw into game code and never call `preventDefault`/`stopPropagation` on game elements, except for keys it handles itself (3.3).
4. **Logging:** `ctx.log.debug/info/warn/error(...)`, prefix `[OGX Live/<module>]` or `[OGX Infinity/<module>]`. No bare `console.*`.
5. **CSS prefixes:** core `ogx-`; Live modules `ogx-l-<module>-`; Infinity modules `ogx-i-<module>-`. Element ids use the same prefixes. Injected style ids: `ogx-core`, `ogx-l-<module>`, `ogx-i-<module>`. Never restyle game elements globally; only scoped to own classes, or add own classes to game elements (and remove them when re-rendering).
6. **Russian UI.** All visible strings are Russian literals in the module (no i18n framework for content). Numbers and times only through `OGX.fmt`. Mission and object names through `OGX.catalog`.
7. **No `innerHTML` with data.** Build DOM with `OGX.dom.h`. Text from the game, the user (notes) or messages is always set as text.
8. **Timers:** use `ctx.every(ms, fn)` (driven by the shared 1 s tick) and `OGX.dom.countdown`. No own `setInterval` in modules. Heavy recomputation is debounced.
9. **Storage:** only `ctx.store` and `ctx.settings` for writes. Every stored object carries `v: <schemaVersion>`; the module migrates older versions on read. Cap growing collections (limits given per module).
10. **Game-state changes only on click** (section 0). Use `OGX.fleet.send` / `OGX.api.addBuild` / `OGX.api.deleteMessage`, which confirm when `core.confirmActions` is on.
11. **Network etiquette:** background reads go through `OGX.http` with `background: true`. No module issues requests on page load except through core caches (`flights.get`, `ensureServer`, `ensureTopScore`).
12. **Coexistence:** Live and Infinity can run together. Each injects only into its own containers or slots. Live's planet-list overlay and Infinity's planet-list badges must not overlap: Infinity's `panel` module skips its planet-list badges when `html[data-ogx-live]` exists.
13. **Accessibility basics:** buttons are `<button type="button">`, icons have `title`, panels are keyboard closable with `Esc`.

### 3.3 Keyboard handling

Shortcuts are only handled by Infinity's `prefs` module (section 4.2.10) and Live's `expedition` module (none by default). Handlers ignore events whose target is `input`, `textarea`, `select`, `[contenteditable]`, or is inside `.ui-dialog` or `#chatBar`. Arrow keys are never bound on `/galaxy` (`G§2.1`).

---

## 4. Modules

Every module owns exactly the files listed for it. Nobody else edits them. `manifest.json`, `loader.js`, `background.js`, `popup/`, `options/`, `_locales/`, `icons/` and the build tools belong to the integration step.

### 4.1 OgameX Live (`ogamex-live/`, loader order below)

Coverage of the OGame Live porting table (`OL§7`):

| OL# | Feature | Module |
|---|---|---|
| 1, 2, 3, 4, 5, 6, 9, 10, 11 | live stock bars, rates, warnings + time until full, energy and fusion, Σ, needed SC/LC, build timer, stationed ships, planets/moons switcher | `planetbar` |
| 7, 8 | resources in flight + grand totals, incoming-fleet tooltip per body | `inflight` |
| 12, 13 | cost overlay in technology details (+ time until affordable), next-level cost badges | `techcost` |
| 14, 15 | capacity/speed of the selection, speed badges, ship stats tooltip | `fleetinfo` |
| 16, 17 | one-click random expedition, expedition max find + minimum ships | `expedition` |
| 18 | flights timeline with slot counters and cargo bars | `timeline` |
| 21, 22, 23, 24 | galaxy clock, coexistence notice, settings modal, server data replacement, refresh all bodies | `menu` (24 is the core) |
| 19, 20 | lifeforms, empire shortcut | dropped (no lifeforms, no empire page) |

Loader order: `menu`, `planetbar`, `inflight`, `techcost`, `fleetinfo`, `expedition`, `timeline`.

#### 4.1.1 `menu`: menu entry, settings, refresh-all

- **Files:** `ogamex-live/modules/menu/menu.js`; test `tests/live-menu.test.js`.
- **Pages:** `*` (galaxy clock only on `galaxy`).
- **Does:**
  - Menu entry "OgameX Live" in `ul#menuTableTools` (`OGX.dom.menuEntry`) with a gear. Click opens a modal: version, data freshness per body (`Body.seenAt`, `res.t`, `shipsT`, `percentsT`, as `fmt.ago`), the settings form for all Live modules (`OGX.dom.settingsForm(['core', 'menu', 'planetbar', ...])`), and the button "Обновить данные всех планет".
  - "Обновить данные всех планет": first use shows the `?cp=` notice (decision 3) and sets `core.cpConfirmed`. Then `OGX.state.refreshBodies({ include: ['fleet', 'resources'] + optional 'settings' })` with a progress bar and a cancel button (AbortController).
  - Galaxy footer clock (setting `galaxyClock`, default on): server time `fmt.time` appended after `.ctGalaxyFooter #colonized` (`OL§4.1`).
  - Coexistence: if `html[data-ogx-infinity]` exists, show a one-line note in the modal (no behaviour change).
- **Settings:** `galaxyClock` (bool, true), `refreshIncludeSettings` (bool, false: also fetch `/resources/settings` per planet).
- **Data:** reads state; writes only settings.
- **Specs:** `L§10`, `L§12`, `OL§3`, `OL§4.1`, `OL§4.7`.
- **Fixtures:** `layout-overview-planet.html`, `galaxy-page.html`, `fleet-dispatch-planet.html` (refresh-all responses), `buildings-resources.html`.
- **Test:** menu entry exists once; modal opens and lists all Live module settings; toggling `planetbar.enabled` persists; refresh-all against the mock server requests `/fleet?cp=1`, `/fleet?cp=5`, `/fleet?cp=3` (and `/resources?cp=` for planets) sequentially and ends with a restore request `?cp=<original>`; galaxy page shows the clock.

#### 4.1.2 `planetbar`: production overlay in the planet list

- **Files:** `ogamex-live/modules/planetbar/planetbar.js`; test `tests/live-planetbar.test.js`.
- **Pages:** `*`.
- **Does** (`OL§4.11`, `OL§5.1-5.4`): for each `#planetList > .smallplanet` appends `div.ogx-l-planetbar-prod` with a planet part and a moon part:
  - M/C/D fill bars (`amount/storage`, 90% `warn`, 100% `bad`), the projected stock (`OGX.state.projected(body, now, {flights})`), `+X/ч` or `+X/сут`, tooltip "Ёмкость: …, заполнится через …" (`calc.secondsUntilFull`), rate class from the production percent (<70% warn, <40% or 0 bad);
  - energy bar (balance and share consumed) and the fusion warning when the fusion percent < 100 and fusion level > 0;
  - Σ per body; needed SC/LC for the body's stock with owned SC/LC (`owned/needed`, red when owned < needed), using `state.shipStats` cargo;
  - build timer: active building name (catalog) + target level + `OGX.dom.countdown(endsAt)`; for planets with a wrench but no known queue: "строится (данные устарели)"; moons only after a visit (`OL§4.5`);
  - stationed ships bar on `a.planetlink`/`a.moonlink`: ships excluding 212/217, width relative to the largest body, colour thresholds 50%/75% (`OL§4.11`);
  - switcher in `#countColonies`: "Планеты / Луны" toggles `.ogx-l-planetbar-moons` on `#planetList`; auto-selects moons when the current body is a moon (setting).
  - "raider" style (`gameStyle = 'raider'`): only stocks, planet and moon side by side.
  - Re-renders values on `tick` (only text and widths, no DOM rebuild) and fully on `state:updated` / `flights:updated`. Compact layout (`.smallplanet.smaller`, 6+ bodies) gets a one-line variant.
- **Settings:** `gameStyle` (enum miner/raider, miner), `prodDisplay` (enum hour/day, hour), `showEnergy` (bool, true), `showSum` (bool, true), `roundNumbers` (bool, false → `fmt.short`), `showNeededTransporters` (bool, true), `showStationedShips` (bool, true), `autoMoonView` (bool, true), `view` (enum planets/moons, hidden).
- **Data:** reads `bodies`, `shipStats`, `flights`; writes only settings.
- **Specs:** `L§4`, `L§6`, `L§12`, `B§4.3`, `B§11`, `OL§4.3-4.6`, `OL§4.11`, `OL§5.1-5.4`.
- **Fixtures:** `layout-overview-planet.html`, `layout-overview-moon.html`, `layout-overview-compact.html`, `buildings-overview.html`, `buildings-resources.html`, `buildings-resource-settings.html`, `fleet-dispatch-planet.html`, `ogamelive-expected-parse.json`.
- **Test:** on `layout-overview-planet.html` every `.smallplanet` gets exactly one overlay; the current planet shows metal ≈ 152,347 growing with production (re-read after 2 s, larger); storage tooltip text contains "Ёмкость"; after visiting `/fleet` the needed/owned LC count appears; compact fixture renders 6 rows without overflow (row height unchanged ± 2 px); switching to moons view shows the moon parts; with `planetbar.enabled=false` nothing is injected; no `[OGX` error logs.

#### 4.1.3 `inflight`: resources in flight, totals, incoming fleets

- **Files:** `ogamex-live/modules/inflight/inflight.js`; test `tests/live-inflight.test.js`.
- **Pages:** `*`.
- **Does** (`OL§4.9`, `OL§4.11` totals, `OL§5.7`):
  - Starts `OGX.flights.startPolling()` and `OGX.flights.get()` (cached 60 s).
  - Totals block appended at the end of `#planetList` (`div.ogx-l-inflight-totals`): "В полёте" M/C/D/Σ (`flights.inFlight`, approx marked with ≈), "Всего на планетах" with summed production per hour/day (planets only), "Итого" = bodies + in flight, needed SC/LC for the grand total with owned SC/LC summed over bodies.
  - Per body row: an incoming icon `span.ogx-l-inflight-in` when `flights.incomingByBody` has rows for that body; tooltip lists each flight: mission (catalog name), from, countdown to arrival, cargo; hostile rows in red (mission 1, 2, 6, 9, 10 from foreign owners). A hostile incoming flight also adds `.ogx-l-inflight-hostile` to the row.
  - Arrival projection is done by `OGX.state.projected(..., {flights})`, so planetbar values stay consistent; this module only triggers a re-fetch after an arrival passes (via the core poller).
- **Settings:** `showTotals` (bool, true), `showIncoming` (bool, true), `includeMoonsInTotals` (bool, true).
- **Data:** reads `flights`, `bodies`, `shipStats`; writes only settings.
- **Specs:** `F§9`, `F§12.2`, `F§13`, `OL§4.9`, `OL§5.7`, `L§4.1`.
- **Fixtures:** `fleet-eventlist.html`, `fleet-eventbox.json`, `fleet-eventbox-empty.json`, `layout-overview-planet.html`, `fleet-expected-parse.json`.
- **Test:** with the fixture event list the totals show the in-flight sum of missions 1199 (31,200 M / 18,900 C), 1201, 1202, 1203 counted once each and synthetic rows ignored; foreign transport 1211 is not in "В полёте"; Homeworld row has an incoming icon whose tooltip contains a hostile espionage row (1210); the eventbox poll requests `/ajax/fleet/eventbox/fetch` and re-fetches the list only when counts change (mock switches to the empty eventbox).

#### 4.1.4 `techcost`: cost overlay and cost badges

- **Files:** `ogamex-live/modules/techcost/techcost.js`; test `tests/live-techcost.test.js`.
- **Pages:** `resources`, `facilities`, `research`, `shipyard`, `defense`.
- **Does** (`OL§4.10`, `OL§4.12`, `OL§5.5`):
  - Badges on each `#technologies li.technology` icon: next-level cost computed locally (`calc.cost(id, level+1)`, units per piece), red when the projected stock of the current body is lower. No AJAX per item.
  - Technology details overlay: observe `#technologydetails_content` (`OGX.dom.observe`); on change read the id from `button.upgrade|downgrade[data-technology]` (never `#technologydetails[data-technology-id]`, which is always 3) and the costs from `.costs li.resource[data-value]`. Append a total row and, per resource, the difference (`have − need`), SC/LC needed for the missing part, and "Будет доступно через … (в ЧЧ:ММ)" (`calc.costOverlay`, `timeUntilAffordable`). For ships/defense multiply by the `#build_amount` value and update on `input`.
  - Values refresh every tick from the projection.
- **Settings:** `showBadges` (bool, true), `showOverlay` (bool, true), `transportShip` (enum 202/203/both, both).
- **Data:** reads `bodies`, `research`, `shipStats`; writes nothing.
- **Specs:** `B§3`, `B§6`, `B§11`, `OL§4.10`, `OL§4.12`, `OL§5.5`.
- **Fixtures:** `buildings-resources.html`, `buildings-facilities.html`, `buildings-research.html`, `buildings-shipyard.html`, `buildings-defense.html`, `buildings-ajax-resources-1.json`, `buildings-ajax-resources-4.json`, `buildings-ajax-shipyard-203.json`, `buildings-ajax-research-124.json`.
- **Test:** on `/resources` each list item gets one badge and the metal mine badge equals `calc.cost(1, 23)`; inserting the `buildings-ajax-resources-4.json` details HTML into `#technologydetails_content` (the test does what the game JS would do) produces the overlay with a finite "Будет доступно через"; on `/shipyard` changing `#build_amount` to 10 multiplies the shown need by 10.

#### 4.1.5 `fleetinfo`: fleet page info

- **Files:** `ogamex-live/modules/fleetinfo/fleetinfo.js`; test `tests/live-fleetinfo.test.js`.
- **Pages:** `fleet`.
- **Does** (`OL§4.13` first part, `OL§5.8`):
  - Table `#ogx-l-fleetinfo` after `#allornone`: selected ships count, total cargo, slowest speed, and when the target is set (step 2 or prefilled): distance, duration, fuel (client variant) and arrival/return times.
  - Speed badge on each ship icon (`li.technology .icon`), and a tooltip with speed, cargo, fuel consumption, structure, shield, attack.
  - The selection is read from the ship inputs (`input[name=<class_name>]`, events `keyup`, `change`, `focusout`, clicks on icons, `#sendall`, `#resetall`) and from `OGX.bridge.call('fleet.state')` when available.
  - Ship stats: `state.shipStats()`; check-target responses seen through the bridge refresh them (core does that).
- **Settings:** `showSpeedBadges` (bool, true), `showTable` (bool, true).
- **Data:** reads `shipStats`, `server`, `bodies`; writes nothing.
- **Specs:** `F§2`, `F§3`, `F§2.7`, `OL§4.8`, `OL§4.13`.
- **Fixtures:** `fleet-dispatch-planet.html`, `fleet-dispatch-prefill.html`, `fleet-check-target-player.json`, `ogamelive-techtree-tab2-203.html`.
- **Test:** on `fleet-dispatch-planet.html` every ship `li` gets a speed badge; typing 10 into the large cargo input updates the cargo total to `10 × shipStats[203].cargo`; on the prefill fixture (target 1:45:6) the table shows a positive duration and fuel.

#### 4.1.6 `expedition`: random expedition button, max find

- **Files:** `ogamex-live/modules/expedition/expedition.js`; test `tests/live-expedition.test.js`.
- **Pages:** `fleet`.
- **Does** (`OL§4.13` expedition part, `OL§5.6`):
  - Button `a.ogx-l-expedition-btn` "Экспедиция" in `#fleet2 #target .coords` with `±N` systems input. Click (user action): via the bridge set target `[g : s+rand(-N..N) wrapped to 1..499 : 16]`, mission 15, the remembered duration and speed, `goStep(2)`, and then `fleet.submit()` only if the setting `autoSubmit` is on (default **off**: the user presses "Отправить"). Duration/speed are remembered when the user sends a fleet to position 16 (bridge `xhr` on send-fleet with `position=16`).
  - Info box in `#fleet1` and `#fleet2`: top points (`state.ensureTopScore`, overridable), max find normal/rare/exceptional for metal/crystal/deuterium (`calc.expeditionMaxFind` with class, economy speed, pathfinder selected, reward multiplier), minimum LC/SC to carry the normal max (`calc.expeditionMinShips`), and whether the current selection's cargo covers it; expedition slots from `parse.fleetPage`.
- **Settings:** `randomSystems` (int 0..99, 0), `autoSubmit` (bool, false), `topPointsOverride` (int, 0 = auto), `rewardMultiplier` (float, 1.0), `rememberedDuration` (int, hidden, 1), `rememberedSpeed` (float, hidden, 10).
- **Data:** reads `topScore`, `shipStats`, `player`, `server`; writes settings.
- **Specs:** `OL§4.13`, `OL§5.6`, `F§2.3-2.6`, `G§6`.
- **Fixtures:** `fleet-dispatch-planet.html`, `galaxy-highscore-ajax-players-page2.html`, `galaxy-highscore-page.html`, `fleet-check-target-expedition.json`, `ogamelive-expected-parse.json` (expedition values).
- **Test:** the info box shows the max find matching `ogamelive-expected-parse.json` `expedition[0]` for a Collector with top points from the mock highscore; with `randomSystems=5` the button sets a system within ±5 (checked through a stubbed `fleetDispatcher` in the page world, which the test installs, because fixtures have no game JS); no send-fleet request is made with `autoSubmit=false`.

#### 4.1.7 `timeline`: flights timeline

- **Files:** `ogamex-live/modules/timeline/timeline.js`; test `tests/live-timeline.test.js`.
- **Pages:** `*`.
- **Does** (`OL§4.14`): `div#ogx-l-timeline` in `#left` (setting `position`: left under the menu, right under the planet list, off). Header with reload icon, slots `used/max` and expedition slots (from `slots`, `overmark` when full). Rows sorted by arrival: arrival time, countdown, mission icon (`/img/fleet/<type>.gif`, same origin), origin → destination with body type, unit count, three cargo fill bars (`cargo / fleetCargo(ships)`), hostile rows highlighted. Option to skip outbound expeditions (OGame Live behaviour). One row per `realMissionId` and direction.
- **Settings:** `position` (enum left/right/off, left), `skipOutboundExpeditions` (bool, true), `maxRows` (int 5..100, 30).
- **Data:** reads `flights`, `slots`, `shipStats`; writes settings.
- **Specs:** `OL§4.14`, `F§9.3`, `F§12.2`, `F§8`.
- **Fixtures:** `fleet-eventlist.html`, `fleet-movement.html`, `fleet-eventbox.json`, `layout-overview-planet.html`.
- **Test:** the timeline renders 1 row per mission and direction from the fixture (synthetic hold-end/return handled), the expedition outbound is hidden by default and visible when the setting is off, slots read `4/6`, the reload icon triggers a new `/ajax/fleet/eventlist/fetch`.

### 4.2 OgameX Infinity (`ogamex-infinity/`, loader order below)

Loader order: `panel`, `empire`, `targets`, `spy`, `stats`, `stalk`, `flights`, `fleethelp`, `todo`, `prefs`.

All Infinity panels are tabs of one side panel: `OGX.dom.sidePanel('infinity', { title: 'OgameX Infinity' })` (get-or-create, so modules do not depend on each other's init order). The `panel` module owns the menu entry that opens it.

| Required feature | Module |
|---|---|
| control panel shell + planet list | `panel` |
| empire view / data collection | `empire` |
| player search, target list, marks, notes | `targets` |
| spy-report table + quick raid (+ battle-sim link) | `spy` |
| statistics (battles, expeditions, harvest, transport) + message analysis | `stats` |
| activity tracking / stalk | `stalk` |
| flight visualisation | `flights` |
| keep N ships/resources, quick-collect, fleet-dispatch prefill | `fleethelp` |
| building to-do list | `todo` |
| keyboard shortcuts, settings, JSON export/import (PTRE replacement) | `prefs` |

#### 4.2.1 `panel`: control panel shell and planet list

- **Files:** `ogamex-infinity/modules/panel/panel.js`; test `tests/infinity-panel.test.js`.
- **Pages:** `*`.
- **Does:**
  - Menu entry "Infinity" in `ul#menuTableTools` toggling the side panel; panel header: player name, class (Russian name), rank, DM, server clock, and an attack indicator (red when `OGX.flights.hostile()` is not empty).
  - Tab "Планеты" (order 10): one row per body (planet and its moon indented): name, coords, fields `used/max` with a bar, temperature, projected M/C/D with fill colour, production per hour, active building with countdown, ships count; footer totals and in-flight sum. Click navigates to the same page with `?cp=`; Ctrl/middle click opens a new tab; small links to resources/facilities/fleet/galaxy. Data age shown when > 1 h.
  - Planet-list badges (setting, default on, skipped when Live is present): fields `used/max` under each `.smallplanet`.
- **Settings:** `openOnLoad` (bool, false), `planetbarFields` (bool, true), `showMoons` (bool, true).
- **Data:** reads `bodies`, `player`, `flights`; writes settings only.
- **Specs:** `L§3`, `L§4`, `L§6`, `L§8`, `L§9`, `L§12`, `B§4`, `B§5`.
- **Fixtures:** `layout-overview-planet.html`, `layout-overview-moon.html`, `layout-overview-compact.html`, `buildings-overview.html`.
- **Test:** menu entry toggles `#ogx-panel-infinity`; the planets tab lists 2 planets + 1 moon for the planet fixture and 6 planets for the compact one, with coords and fields from the tooltips; clicking a row navigates to `?cp=3`; the panel open state survives a reload.

#### 4.2.2 `empire`: empire view and data collection

- **Files:** `ogamex-infinity/modules/empire/empire.js`; test `tests/infinity-empire.test.js`.
- **Pages:** `*`.
- **Does:**
  - Tab "Империя" (order 20) with sub-views: Ресурсы (stock, storage, production, energy, factor), Постройки, Станции, Исследования, Флот, Оборона. Matrix of bodies (columns) × objects (rows) with levels/amounts, totals column, queued targets marked (`→23`), cells older than 24 h dimmed with the age in the title. Research is one column (player-wide).
  - "Обновить всё" button: `OGX.state.refreshBodies({ include: chosen sub-views → pages })` after the cp notice; progress, cancel. "Обновить эту планету" = the same for the current body only (no cp switch needed).
  - Production check: computed `calc.production` vs the reported `perHour`, shown as a hint when they differ by > 2%.
- **Settings:** `defaultView` (enum, 'resources'), `staleHours` (int, 24).
- **Data:** reads `bodies`, `research`, `player`, `server`; writes settings only.
- **Specs:** `B§2-5`, `B§9`, `B§11`, `F§12.4`, `L§5`, `OL§4.7`.
- **Fixtures:** `buildings-resources.html`, `buildings-resources-colony.html`, `buildings-resources-moon.html`, `buildings-facilities.html`, `buildings-facilities-moon.html`, `buildings-research.html`, `buildings-shipyard.html`, `buildings-defense.html`, `buildings-resource-settings.html`, `buildings-overview.html`, `fleet-dispatch-planet.html`.
- **Test (scenario `orion`):** after visiting `/resources`, `/facilities`, `/research`, `/shipyard`, `/defense` the matrix shows Metal Mine 22 (→23) on Homeworld, Plasma 7 (→8), Large Cargo 120 (→167); "Обновить всё" fetches the pages for bodies 4, 7, 9 with `?cp=` and restores `cp=4`; a module error injected into one view does not break the others.

#### 4.2.3 `targets`: player search, target list, marks, notes

- **Files:** `ogamex-infinity/modules/targets/targets.js`; test `tests/infinity-targets.test.js`.
- **Pages:** `*` (galaxy row tools on `galaxy`, rank marks on `highscore`).
- **Does:**
  - Marks: 6 colours + none, per planet (`coords` + body type) and per player. Notes (free text) per planet and per player. Galaxy integration via `galaxy:render`: a row slot with a colour dot (click → colour menu), a note icon (click → note editor), and a star "в цели"; the row gets `.ogx-i-targets-mark-<color>` (tinted background, removed on re-render). Highscore rows get a colour dot next to marked players.
  - Tab "Цели" (order 30): table of targets: coords (+Л), player, status letters, rank, mark, note, last spy report (from `spy.reports`: age and loot), last activity (from `stalk.log`), actions: spy (`OGX.api.sendMiniFleet({mission:6})` on click), attack (`OGX.fleet.prefill.open` with mission 1), open galaxy, remove. Filters by colour and text.
  - Tab "Поиск" (order 35): search box with category (игроки / планеты / альянсы) → `OGX.api.search`; player card: highscore data (`searchRelId`), known planets from `OGX.galaxy.player(id)` + search category 3 (`owner_id`), status/activity from the galaxy cache, buttons "В цели", "Следить" (writes nothing in stalk; it emits `targets:track` `{playerId}` which `stalk` handles), "Открыть в галактике".
- **Settings:** `markColors` (json, default 6 colours with Russian labels: красный, оранжевый, жёлтый, зелёный, голубой, фиолетовый), `showRowTools` (bool, true), `tintRows` (bool, true).
- **Data:** writes `targets.marks` = `{ v: 1, planets: { "<coords>:<1|3>": { color|null, note, playerId, playerName, addedAt, updatedAt, isTarget } }, players: { [id]: { color|null, note, updatedAt } } }` (cap 5000 planets); reads `galaxy.*`, `spy.reports`, `stalk.log`. Registers a storage merger for `targets.marks` (merge by `updatedAt`).
- **Specs:** `G§1-4`, `G§6`, `G§7`, `G§11`, `F§5`, `F§2.2`.
- **Fixtures:** `galaxy-page.html`, `galaxy-ajax-1-42.json`, `galaxy-ajax-1-45.json`, `galaxy-rendered-1-42.html`, `galaxy-highscore-page.html`, `galaxy-search-players.json`, `galaxy-search-planets.json`, `galaxy-search-alliances.json`, `galaxy-search-empty-term.json`, `fleet-send-mini-fleet-success.json`, `fleet-send-mini-fleet-error.json`.
- **Test:** on the galaxy page (the test simulates the game render by dispatching `ogx:xhr` with `galaxy-ajax-1-42.json` and inserting `galaxy-rendered-1-42.html` into `#galaxyContent`) each occupied row gets one slot; marking position 6 red persists and tints the row; a note survives reload; the search tab finds "Raider42" from the mock search; the spy button posts `send-mini-fleet` with `mission=6&galaxy=1&system=45&position=6&type=1` and shows the success toast.

#### 4.2.4 `spy`: spy-report table and quick raid

- **Files:** `ogamex-infinity/modules/spy/spy.js`; test `tests/infinity-spy.test.js`.
- **Pages:** `*` (message badges on `messages`).
- **Does:**
  - Collection: `OGX.messages.watch` on `/messages`; for each `espionage_report` item not yet stored: parse the short form, then fetch the full report (`OGX.messages.fetchDetail`, background queue) when `autoFetchFull` is on, and store `SpyReport` + derived values. Reports the user opens in the game's detail overlay are also captured through the bridge `xhr` (`/ajax/messages/<id>`).
  - Derived per report (recomputed on display with current class and stats): loot `calc.loot(resources, {attackerClass})` (50% / 75% Discoverer), cargo needed (SC or LC per setting, with reserve %), fleet and defense value (`calc.unitsValue`), debris value, distance/duration/fuel from the current body (`OGX.fleet.estimate`), profit = loot MSU − fuel MSU, flags (unknown fleet/defense sections, has fleet, has defense, moon).
  - Tab "Шпионаж" (order 40): sortable table: age, coords (+Л), player, loot, cargo needed, fleet, defense, debris, flight time, profit; row actions: **Рейд** (one click: `OGX.fleet.send({ mission: 1, ships: {[cargoShip]: n}, speed: 10, target, originId: current body })`; disabled with a reason when the current body has fewer ships), **Подготовить** (`OGX.fleet.prefill.open` instead of sending), **Шпионить** (mini fleet), **Симулятор** (opens the battle-sim URL template in a new tab), **Удалить** (`OGX.messages.delete`), **В цели** (`OGX.bus.emit('targets:add', {coords, type, playerName})`, handled by `targets`). Rows already raided show the time sent.
  - Message badges: in each espionage `li` add loot, cargo needed and a raid button.
  - Battle-sim link: setting `simUrl` default `https://trashsim.oplanet.eu/ru#prefill=` + base64 of the standard TrashSim prefill JSON (defender ships/defense/research from the report, attacker research from `state.research`). The link is only opened by the user.
- **Settings:** `autoFetchFull` (bool, true), `cargoShip` (enum 202/203, 203), `reservePct` (int 0..100, 10), `maxAgeHours` (int, 168), `simUrl` (string), `minLootToShow` (int, 0).
- **Data:** writes `spy.reports` = `{ v: 1, items: { [msgId]: SpyReport & { fetchedAt } } }` (cap 500, drop older than `maxAgeHours`), `spy.raids` = `{ v: 1, items: [{ reportId, coords, ships, sentAt, ok, message }] }` (cap 200); reads `bodies`, `shipStats`, `player`, `research`, `server`.
- **Specs:** `M§1-4`, `M§10`, `F§2.7`, `F§3`, `F§4`, `F§5`, `KB§3.4`, `KB§5`.
- **Fixtures:** `messages-page.html`, `messages-page-loaded-espionage.html`, `messages-ajax-tab-fleets.html`, `messages-ajax-fleets-espionage.html`, `messages-ajax-message-2051-espionage-full.html`, `messages-ajax-message-2044-espionage-moon-partial.html`, `messages-ajax-message-2038-espionage-debris.html`, `messages-post-delete-2047.json`, `messages-expected-parse.json`, `fleet-send-fleet-success.json`, `fleet-send-fleet-error.json`, `fleet-send-mini-fleet-success.json`, `fleet-dispatch-planet.html`.
- **Test:** opening `/messages` (`messages-page-loaded-espionage.html`) stores 3 reports with full details fetched from the mock (2051 resources 1,468,279/500,451/65,266); the table shows loot 50% for a Collector (734,139 metal before cargo); "Рейд" on 2051 (after the fleet page told the store the body has ≥ n LC) posts send-fleet with `mission=1`, `am203=<ceil(loot×1.1/cap)>`, `galaxy=1&system=45&position=9&type=1`, `speed=10`, `_token=<csrf>`, and shows "Флот отправлен"; the mock error fixture shows the server message; "Удалить" posts `messageId=2051&action=103`.

#### 4.2.5 `stats`: statistics and message analysis

- **Files:** `ogamex-infinity/modules/stats/stats.js`; test `tests/infinity-stats.test.js`.
- **Pages:** `*` (analysis badges on `messages`).
- **Does:**
  - Collection (passive): `OGX.messages.watch` for combat_reports, expeditions, transport, other, economy items; classify and parse; store records. Optional full combat details (`fetchFullCombat`, default off) for exact units lost and loot.
  - "Сканировать сообщения" button (explicit, with the mark-as-read warning): walks subtabs `combat_reports`, `expeditions`, `transport`, `other` page by page (background queue) until a page has only known ids.
  - Tab "Статистика" (order 50): period selector (сегодня, вчера, 7 дней, 30 дней, всё, свой интервал); sections:
    - Бои: count, wins/losses/draws by role (атака, защита, экспедиция), loot sum, own losses, enemy losses, debris created, moons, net result in MSU;
    - Экспедиции: count, outcome distribution (Russian outcome names) with a bar, resources and DM found, ships found by type, average per expedition, black holes;
    - Переработка: harvested M/C/D, harvest count;
    - Транспорт: received from other players, delivered, returns with resources.
    - Daily bar chart (inline SVG, no library) for the selected section.
  - Message analysis badges in the list: expedition outcome label and amounts, combat summary (result, loot, losses, profit), harvest summary; and a per-page summary line above the list.
- **Settings:** `fetchFullCombat` (bool, false), `defaultPeriod` (enum, '7d'), `msuRates` (string, '1:1.5:3').
- **Data:** writes `stats.combat` = `{ v: 1, items: { [msgId]: { t, coords, role, result, loot: Res, debris: Res, lossesOwn, lossesEnemy, opponent, moonChance, moonCreated, approx, full: boolean } } }`, `stats.expeditions` = `{ v: 1, items: { [msgId]: { t, key, outcome, resources: Res, darkMatter, ships: Ships } } }`, `stats.fleet` = `{ v: 1, items: { [msgId]: { t, key, from, to, resources: Res, harvest? } } }` (each cap 20,000, oldest dropped); registers mergers (union by id).
- **Specs:** `M§3`, `M§5-8`, `M§10`, `KB§4`, `KB§7`.
- **Fixtures:** `messages-ajax-fleets-combat_reports.html`, `messages-ajax-fleets-expeditions.html`, `messages-ajax-fleets-expeditions-page2.html`, `messages-ajax-fleets-transport.html`, `messages-ajax-fleets-other.html`, `messages-ajax-economy-economy.html`, `messages-ajax-message-2053-battle-attacker-win.html`, `messages-ajax-message-2050-battle-defender-loss.html`, `messages-ajax-message-2034-battle-expedition-pirates.html`, `messages-ajax-message-2054-expedition-resources.html`, `messages-expedition-texts.json`, `messages-object-titles.json`, `messages-expected-parse.json`.
- **Test:** the scan button (mock serves the subtab fixtures; page 2 for expeditions) stores 3 battles, 11 expeditions and the 'other' items; the stats tab shows 11 expeditions with one of each outcome, resources found 412,500 metal from the resources outcome, DM 1,850, ships Small Cargo 5 / Light Fighter 12 / Espionage Probe 3; battle 2050 counts as a defence loss; message badges appear on the expeditions page.

#### 4.2.6 `stalk`: player activity tracking

- **Files:** `ogamex-infinity/modules/stalk/stalk.js`; test `tests/infinity-stalk.test.js`.
- **Pages:** `*` (row "eye" on `galaxy`).
- **Does:**
  - Tracked players list (`stalk.players`); added from the galaxy row eye button, from `targets:track` events and from the tab.
  - Data intake: every `galaxy:system` event (page browsing, any scan) records activity for tracked players' planets and moons (`*`, minutes 15-60, none) with `scannedAt` and derived `lastSeen` (`G§5`, `G§10`); `espionage_detected` messages (via `OGX.messages.watch`) record the spy's planet as active.
  - Scheduler (only when `autoScan` is on): every `intervalMin` minutes (default 15, min 5), under the cross-tab lock, re-scan the systems of tracked players whose last scan is older than the interval, through `OGX.galaxy.scan` (core pacing and hourly cap). Paused while the user is on `/galaxy` (their own browsing feeds the log) and while the tab is hidden unless `core.backgroundWhenHidden`.
  - Self-caused activity: an activity sample at a body is flagged `self: true` when an own espionage/attack/missile/moon-destruction flight arrived there within 15 minutes before (from `flights` history).
  - Tab "Слежка" (order 60): per player: last seen (ago), planets with their last activity, a 24-hour strip (96 cells of 15 min, coloured when active), 7-day heat summary, buttons scan now / stop tracking. Toast "<игрок> активен" on a change from inactive to active (setting).
- **Settings:** `autoScan` (bool, false), `intervalMin` (int 5..240, 15), `notify` (bool, true), `keepDays` (int 1..60, 14).
- **Data:** writes `stalk.players` = `{ v: 1, items: { [playerId]: { name, addedAt, systems: ['g:s'], lastScanAt } } }` (cap 100 players), `stalk.log` = `{ v: 1, items: { [playerId]: [{ t, coords, body: 'p'|'m', activity: '*'|number|null, lastSeen: ServerMs|null, self: boolean }] } }` (samples older than `keepDays` dropped; consecutive identical inactive samples collapsed); reads `galaxy.*`, `flights`.
- **Specs:** `G§3`, `G§5`, `G§10`, `G§11`, `M§4.3`, `F§9`.
- **Fixtures:** `galaxy-page.html`, `galaxy-ajax-1-42.json`, `galaxy-ajax-1-45.json`, `galaxy-ajax-1-45-from-moon.json`, `galaxy-ajax-vacation-403.json`, `galaxy-search-planets.json`, `galaxy-highscore-page.html`, `messages-ajax-fleets-espionage.html`.
- **Test:** tracking Raider42 (233) and triggering "scan now" posts `/ajax/galaxy` for `1:45` only once, waits ≥ 500 ms between systems when more systems exist, records activity 18 for Farmville with `lastSeen = scannedAt − 18 min`; a 403 vacation response stops the scan with a message; Rookie (204) tracked from the galaxy eye button appears in the tab.

#### 4.2.7 `flights`: flight visualisation

- **Files:** `ogamex-infinity/modules/flights/flights.js`; test `tests/infinity-flights.test.js`.
- **Pages:** `*` (extra view on `movement`).
- **Does:**
  - Tab "Полёты" (order 70): a time-axis chart (inline SVG): one lane per own body plus "Дальний космос", a bar per mission from departure (when known, else now) to arrival, continuing to the return; colours by mission, hostile in red, own vs foreign styles; a "now" line moving on tick; hover tooltip with ships, cargo, from → to, absolute arrival and countdown; zoom 1 h / 6 h / 24 h / all.
  - Under the chart: list of hostile incoming flights first, then all flights; recall button for own recallable flights (`OGX.api.recall`, click + confirm).
  - On `/fleet/movement`: a compact chart above `#movement` built from the page itself (`OGX.flights.parseMovement`), which has return times for every outbound row.
  - Attack alert (setting): when hostile flights exist, the panel menu badge shows the count and the document title is prefixed with "⚠".
- **Settings:** `defaultZoom` (enum 1h/6h/24h/all, 6h), `titleAlert` (bool, true), `showOnMovement` (bool, true).
- **Data:** reads `flights`, `bodies`; writes settings only.
- **Specs:** `F§6`, `F§8`, `F§9`, `F§12.2`, `F§12.3`, `F§13`.
- **Fixtures:** `fleet-eventlist.html`, `fleet-movement.html`, `fleet-eventbox.json`, `fleet-recall-success.json`, `fleet-recall-failure.json`, `fleet-expected-parse.json`.
- **Test:** the chart has one bar group per real mission (6 missions in the fixture) and marks 1210 hostile; on `/fleet/movement` the extra chart shows 6 rows with return times; recall on 1201 posts `fleet_mission_id=1201` and handles the HTTP 500 failure fixture with an error toast.

#### 4.2.8 `fleethelp`: keep-N, quick-collect, dispatch prefill

- **Files:** `ogamex-infinity/modules/fleethelp/fleethelp.js`; test `tests/infinity-fleethelp.test.js`.
- **Pages:** `*` (buttons on `fleet`).
- **Does:**
  - Keep rules: per body (and a default) `{ ships: Ships, resources: Res }` to keep on the body. Edited in the tab and from a small "резерв" link on `/fleet`.
  - `/fleet` step 1 buttons (`#fleet1`, next to `#sendall`): "Всё, кроме резерва" (select all ships minus keep), "Транспорт для ресурсов" (select LC/SC to carry the body's resources minus keep, `OGX.fleet.pickCargoShips`); step 2 buttons: "Все ресурсы, кроме резерва" (cargo = resources minus keep, capped by cargo, deuterium minus fuel). All through the bridge `fleet.*` methods; the user still presses send.
  - Tab "Сбор" (order 80): choose the target body; table of source bodies with available resources (projected minus keep), cargo needed, available cargo ships (known `ships`), flight time and fuel (`OGX.fleet.estimate`), data age. Per row: "Подготовить" → `OGX.fleet.prefill.open({ originId, target, mission: 3, ships, cargo })`; "Отправить" (only when `allowDirectSend`, default off) → `OGX.fleet.send(...)` with confirm. "Подготовить следующий" walks the sources one by one.
  - Generic prefill links: other modules call `OGX.fleet.prefill.open` (core); this module adds nothing to that path.
- **Settings:** `allowDirectSend` (bool, false), `cargoShip` (enum 203/202/auto, auto), `keepDeuteriumForFuel` (bool, true).
- **Data:** writes `fleethelp.keep` = `{ v: 1, default: { ships, resources }, bodies: { [BodyKey]: { ships, resources } } }`; reads `bodies`, `shipStats`, `server`.
- **Specs:** `F§2`, `F§4`, `F§12.4`, `L§5`, `L§6`, `KB§3`.
- **Fixtures:** `fleet-dispatch-planet.html`, `fleet-dispatch-prefill.html`, `fleet-dispatch-noships.html`, `fleet-send-fleet-success.json`, `fleet-send-fleet-validation-error.json`, `fleet-check-target-player.json`, `layout-overview-planet.html`.
- **Test:** with a keep rule of 5 LC on body 1, "Всё, кроме резерва" calls the (test-stubbed) `fleetDispatcher.selectShips` with LC = amount − 5; the collect tab for target Homeworld lists Colony with cargo needed; "Подготовить" navigates to `/fleet?cp=3&galaxy=1&system=42&position=8&type=1&mission=3` and the core prefill applies ships and cargo through the stub; with `allowDirectSend` the send posts `mission=3` with `cp=3` and restores `cp`.

#### 4.2.9 `todo`: building to-do list

- **Files:** `ogamex-infinity/modules/todo/todo.js`; test `tests/infinity-todo.test.js`.
- **Pages:** `*` ("+" buttons on `resources`, `facilities`, `research`, `shipyard`, `defense`).
- **Does:**
  - Plans per body (research in a player-wide list): ordered items `{ id, objectId, targetLevel | amount }`. Added with a "+" button on each `li.technology` (adds next level, or `#build_amount` units for ships/defense) and in the technology details panel ("+ в план"), or from the tab.
  - Tab "План" (order 90): per body: items with cost, build time (`calc.buildTime` / `unitTime` / `researchTime` with known levels), affordable now (green) or "через …" (`calc.timeUntilAffordable` on the projection), running totals; reorder (up/down), remove; "Построить" button (click → `OGX.api.addBuild(page, id, { cp })`, shows `message`/`errors[0].message`); done items (level reached in `bodies`/`research`) are removed automatically with a toast.
  - Planet list dot `.ogx-i-todo-ready` on bodies whose first item is affordable now.
- **Settings:** `autoRemoveDone` (bool, true), `showReadyDot` (bool, true).
- **Data:** writes `todo.plans` = `{ v: 1, bodies: { [BodyKey]: [Item] }, research: [Item] }` (cap 50 items per list); reads `bodies`, `research`, `server`, `player`.
- **Specs:** `B§1`, `B§3`, `B§4.4`, `B§6`, `B§8`, `B§11`.
- **Fixtures:** `buildings-resources.html`, `buildings-facilities.html`, `buildings-research.html`, `buildings-shipyard.html`, `buildings-ajax-resources-1.json`, `buildings-addbuildrequest-success.json`, `buildings-addbuildrequest-error.json`, `buildings-addbuildrequest-invalid-token.json`, `buildings-addbuildrequest-unit-success.json`.
- **Test (scenario `orion`):** "+" on Crystal Mine adds level 20 to Homeworld's plan with the cost of `calc.cost(2, 20)`; "Построить" posts `/resources/add-buildrequest` with form `technologyId=2&amount=1&mode=1&_token=<csrf>` and shows "Building construction started."; the error fixture shows its message; visiting `/resources` with the level reached removes the item.

#### 4.2.10 `prefs`: settings, keyboard shortcuts, export/import

- **Files:** `ogamex-infinity/modules/prefs/prefs.js`; test `tests/infinity-prefs.test.js`.
- **Pages:** `*`.
- **Does:**
  - Tab "Настройки" (order 100): `OGX.dom.settingsForm(['core', 'panel', 'empire', 'targets', 'spy', 'stats', 'stalk', 'flights', 'fleethelp', 'todo', 'prefs'])` with per-module enable toggles first (change takes effect after reload; the form says so).
  - Export/import (PTRE replacement): "Экспорт всего" → `OGX.storage.exportAll()` downloaded as `ogamex-infinity-<host>-<playerId>-<YYYYMMDD>.json`; "Экспорт целей" → only `targets.*` and `stalk.*` (to share with allies); "Импорт" → pick file, preview counts per key, mode merge/replace, `OGX.storage.importAll`. Files from another host/player warn first.
  - Keyboard shortcuts (handled only here; rules in 3.3), each configurable (`hotkey` settings, empty disables):
    | Action | Default |
    |---|---|
    | open/close panel | `Alt+Shift+I` |
    | previous / next body (same page, `?cp=`) | `Alt+PageUp` / `Alt+PageDown` |
    | planet ↔ its moon | `Alt+Shift+M` |
    | overview, resources, facilities, research, shipyard, fleet, galaxy, messages | `Alt+Shift+1` … `Alt+Shift+8` |
    | fleet page: select all / reset | `Alt+Shift+A` / `Alt+Shift+R` |
    | panel tab 1..9 | none |
- **Settings:** the hotkeys above (`type: 'hotkey'`), `exportIncludeServer` (bool, true: include galaxy cache and player directory).
- **Data:** writes settings; import writes any key (sanctioned exception).
- **Specs:** this document §2.5, §3.3; `G§2.1` (arrow keys).
- **Fixtures:** `layout-overview-planet.html`, `galaxy-page.html`.
- **Test:** export produces a valid `ogx-export` file containing a mark created by `targets`; importing it into a fresh profile in merge mode restores the mark; `Alt+PageDown` on `/overview?cp=1` navigates to `?cp=3`; typing in an `input` does not trigger shortcuts; the settings form lists every Infinity module.

---

## 5. Test strategy

### 5.1 `tests/server.js`: mock OgameX

```js
const { startServer } = require('./server');
const srv = await startServer({ port = 0, scenario = 'vega' });
srv.origin            // 'http://localhost:<port>'
srv.requests          // [{ t, method, path, query: {}, form: {}, headers: {}, cp: number|null }]
srv.unhandled         // requests that matched no route (tests usually assert it is empty)
srv.state             // { currentBodyId, csrf, scenario, eventbox: 'normal'|'empty', sendFleet: 'success'|'error'|'validation' }
srv.route(method, pathOrRegex, handler(req, res, ctx))   // add/override a route for one test
srv.setScenario(name), srv.reset(), srv.close()
// CLI: node tests/server.js --port 8080 --scenario vega   (manual browsing with the unpacked extension)
```

Behaviour:
- **Fixture rewriting:** every served fixture has `http://localhost` and `http:\/\/localhost` (not followed by `:`) replaced by the server origin. Serve HTML with `text/html; charset=utf-8`, JSON with `application/json` (checkevents and union create as `text/plain`, as the real server does).
- **Scenarios** (fixtures come from two sample accounts; storage is namespaced per player id, so a test stays inside one scenario):
  - `vega` (player 108; planets 1 [1:42:8], 3 [2:118:12], moon 5; CSRF from `layout-overview-planet.html`): `/overview` → `layout-overview-planet.html` (`cp=5` → `-moon`), `/fleet` → `fleet-dispatch-planet.html` (`cp=5` → `-noships`; `galaxy&system&position` → `-prefill`), `/fleet/movement` → `fleet-movement.html`, `/galaxy` → `galaxy-page.html` (with `galaxy&system` → `galaxy-page-query.html`), `/messages` → `messages-page.html`, `/highscore` → `galaxy-highscore-page.html`, `/buddies` → `galaxy-buddies-page.html`.
  - `compact`: like `vega` but `/overview` → `layout-overview-compact.html`.
  - `orion` (player 1; planets 4, 7, moon 9; CSRF `Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe`): `/overview` → `buildings-overview.html` (`cp=9` → `-moon`), `/resources` (`cp=7` → `-colony`, `cp=9` → `-moon`), `/facilities` (`cp=9` → `-moon`), `/research`, `/shipyard`, `/defense`, `/resources/settings` → the matching `buildings-*.html`.
  - `vacation`: `vega` + `/galaxy` → `galaxy-page-vacation.html` and `POST /ajax/galaxy` → 403 `galaxy-ajax-vacation-403.json`.
  - Pages a scenario does not have fall back to the other account's fixture (the test must know it switches namespace) or 404.
- **`?cp=`** on any request sets `state.currentBodyId` when the id belongs to the scenario; requests are recorded with their `cp`.
- **CSRF:** every POST must carry `_token` or `X-CSRF-TOKEN` equal to the scenario token, else 419 `{"message":"CSRF token mismatch."}`. `add-buildrequest` additionally requires `_token` in the body (else `buildings-addbuildrequest-invalid-token.json`).
- **AJAX routes:**
  - `GET /ajax/(resources|facilities|research|shipyard|defense)?technology=<id>` → `buildings-ajax-<page>-<id>.json` (any page prefix with that id; `-43-moon` when `cp=9`), else `layout-ajax-resources-technology-1.json` when id = 1, else 500 HTML.
  - `GET /ajax/techtree?tab=2&object_id=203` → `ogamelive-techtree-tab2-203.html`; the four `buildings-techtree-*.html` for their params; others 404.
  - `GET /overlay/server-settings` → `layout-overlay-server-settings.html`; `GET /overlay/search` → `galaxy-search-overlay.html`.
  - `GET /ajax/fleet/eventlist/fetch` → `fleet-eventlist.html`; `GET /ajax/fleet/eventbox/fetch` → `fleet-eventbox.json` or `-empty.json` per `state.eventbox`; `POST /ajax/fleet/eventlist/checkevents` → `fleet-checkevents.json`.
  - `POST /ajax/fleet/dispatch/check-target` → `-invalid` when galaxy > 9 or any coordinate is 0, `-expedition` when position = 16, `-empty-slot` for coordinates without a planet in the galaxy fixtures, else `-player`.
  - `POST /ajax/fleet/dispatch/send-fleet` → validates (`am<id>` > 0 present, `mission` in 1-9/15, `speed` in 1..10 step 0.5, coords numeric) → `fleet-send-fleet-validation-error.json` when invalid, else per `state.sendFleet` the success/error fixture. Every request is in `srv.requests` with its parsed form.
  - `POST send-mini-fleet` → success fixture (error fixture when `shipCount` is 0 or `state.miniFleet='error'`); `POST recall-fleet` → success, or the failure fixture with **HTTP 500** for ids not in the event list.
  - `GET /ajax/fleet/templates`, `POST` (save), `DELETE /ajax/fleet/templates/:id` → the template fixtures.
  - `POST /ajax/galaxy` (galaxy, system) → `galaxy-ajax-<g>-<s>.json` (`-from-moon` when current body is 5; `-discoverer` variant via `srv.state.discoverer`), else `galaxy-ajax-1-44-empty.json` with `galaxy`/`system` rewritten.
  - `POST /ajax/highscore` → by `category`/`type`/`page`: `galaxy-highscore-ajax-alliances.html`, `-players-military.html`, `-players-page2.html`; page 1 type 0 → the `#ranks` fragment cut out of `galaxy-highscore-page.html`.
  - `POST /ajax/search` → by `category` (2/3/4) or the empty-term fixture.
  - `GET /ajax/messages?tab=&subtab=&pagination=` → `messages-ajax-<tab>-<subtab>[-page2].html`, `?tab=fleets` → `messages-ajax-tab-fleets.html`, other tabs without subtab → the tab fixtures (economy = empty body). `GET /ajax/messages/<id>` → `messages-ajax-message-<id>-*.html` (500 for unknown ids). `POST /messages` → `{"<messageId>":true}`.
  - `POST /(resources|facilities|research)/add-buildrequest`, `/shipyard/add-buildrequest` → success fixtures (unit success for 202-219, 401-503); `state.addBuild = 'error'|'busy'|'vacation'` selects the error fixtures; `POST /resources/cancel-buildrequest` → cancel success.
  - `GET /buddies/online`, `POST /buddies/send-request`, `GET /alliance/info/12` → the galaxy fixtures.
- **Non-OgameX pages:** `GET /not-ogame` → a plain HTML page; `GET /login` → a minimal out-game page with a `csrf-token` meta but no `#planetList`; `GET /gameforge-like` → a page with OGame metas but no OGameX markers. Extensions must do nothing there.

### 5.2 `tests/lib.js`: browser harness

```js
const T = require('./lib');
T.test(name, async (t) => { ... })      // minimal runner: runs tests in order, prints ✓/✗, exits 1 on any failure
T.assert                                 // node:assert/strict
const env = await T.launch({ ext: 'live'|'infinity'|'both', scenario = 'vega', mode = process.env.OGX_TEST_MODE || 'extension',
                             storage = {} /* seed: { '<host>|<pid>|<key>': value } */, settings = {} /* 'ns.key': value */ });
env.server                               // the mock server (started by launch)
env.mode                                 // 'extension' | 'inject' (after fallback)
await env.open(path, { waitReady = true }) -> Page   // navigates; waits for html[data-ogx-<ext>="ready"] (both: both attributes)
await env.storage() -> object            // all chrome.storage.local content of the extension (both: { live, infinity })
await env.setStorage(obj)
env.logs                                 // console messages and page errors; env.ogxErrors() -> entries with '[OGX' and level error, plus pageerrors from ogx code
await env.pageStub(page, 'fleetDispatcher')   // installs a recording stub of window.fleetDispatcher (methods record calls into window.__ogxStubCalls)
await env.close()
T.fixture(name) -> string                // raw fixture text
T.key(ext, scenario, key) -> string      // storage key for the scenario's host/player
```

Modes:
- **`extension` (default):** runs `tests/sync.sh` once, then `chromium.launchPersistentContext(tmpDir, { channel: 'chromium', headless: true, args: ['--disable-extensions-except=<dirs>', '--load-extension=<dirs>'] })`. **`channel: 'chromium'` is required**: the default headless shell does not load extensions (verified with Playwright 1.63 in this environment: content scripts in both worlds and `chrome.storage.local` work with `channel: 'chromium'`, and nothing loads without it). The extension id comes from the background service worker (`context.serviceWorkers()` / `waitForEvent('serviceworker')`); storage is read and seeded with `worker.evaluate(() => chrome.storage.local.get(null))`. The executable is Playwright's bundled Chromium under `/opt/pw-browsers/chromium-*`.
- **`inject` (fallback, and for fast unit-like tests):** `chromium.launch()`; `page.addInitScript()` installs a `chrome.storage.local` + `chrome.storage.onChanged` + `chrome.runtime` shim backed by `window.__ogxTestStore` (persisted across navigations through `context.exposeBinding` into a Node-side map) and the page hook, then a `DOMContentLoaded` listener that evaluates the content-script files in the exact order listed in the extension's `manifest.json` (so the test also validates the manifest order). If the extension mode fails to reach `ready` on `/overview` within 10 s, `launch` switches to inject mode and logs a warning.

Per-module test files: `tests/<ext>-<module>.test.js`, runnable with `node tests/live-planetbar.test.js`. Each file:
1. `T.launch({ ext, scenario })`, opens the pages it needs, performs the checks listed in the module's **Test** item;
2. always asserts `env.ogxErrors()` is empty and `env.server.unhandled` is empty;
3. always runs one **safety check**: `env.open('/not-ogame')` leaves no `ogx-` element, no `data-ogx-*` attribute and makes no request to the mock other than the page itself.

Core tests (owned by core): `core-detect.test.js` (isOgx on all page fixtures true, on `/not-ogame`, `/login`, `/gameforge-like` false; page names for every route), `core-parse.test.js` (all parsers against `layout-`, `fleet-`, `galaxy-`, `messages-`, `ogamelive-expected-parse.json`), `core-calc.test.js` (hand-computed vectors: costs of 1/2/3/12/22/124 at several levels incl. astrophysics rounding, storage, build/research/unit times vs `tools/buildings/model.js`, distance/duration/fuel vs `F§2.7` worked examples, loot distribution vs `LootService::distributeLoot` cases, expedition max find vs `ogamelive-expected-parse.json`), `core-storage.test.js` (namespaces, coalescing, subscribe across two pages, export/import + mergers, lock), `core-http.test.js` (CSRF, 419 retry, withPlanet restore order, background queue gap), `core-flights.test.js` (event list → flights incl. synthetic ids, inFlight, applyArrivals), `core-boot.test.js` (a module that throws in init does not stop the next one; tick; ready attribute; titles parsed before Tipped would strip them).

`tests/run-all.js`: runs `sync.sh`, then every `tests/*.test.js` sequentially in a child process, prints a summary table, exits 1 if any failed. Optional filter argument (`node tests/run-all.js live-`).

---

## 6. Ownership summary

| Owner | Files |
|---|---|
| core | `shared/main/page-hook.js`, `shared/core/00-ogx.js` … `shared/core/20-style.js`, `tools/gen_catalog.js`, `tools/gen_exptexts.js`, `tests/sync.sh`, `tests/server.js`, `tests/lib.js`, `tests/run-all.js`, `tests/core-*.test.js` |
| integration | `ogamex-live/{manifest.json,loader.js,background.js,popup/,options/,_locales/,icons/}`, `ogamex-infinity/{same}`, `tools/build-userscript.js`, `tools/package.sh` |
| live/menu | `ogamex-live/modules/menu/menu.js`, `tests/live-menu.test.js` |
| live/planetbar | `ogamex-live/modules/planetbar/planetbar.js`, `tests/live-planetbar.test.js` |
| live/inflight | `ogamex-live/modules/inflight/inflight.js`, `tests/live-inflight.test.js` |
| live/techcost | `ogamex-live/modules/techcost/techcost.js`, `tests/live-techcost.test.js` |
| live/fleetinfo | `ogamex-live/modules/fleetinfo/fleetinfo.js`, `tests/live-fleetinfo.test.js` |
| live/expedition | `ogamex-live/modules/expedition/expedition.js`, `tests/live-expedition.test.js` |
| live/timeline | `ogamex-live/modules/timeline/timeline.js`, `tests/live-timeline.test.js` |
| infinity/panel | `ogamex-infinity/modules/panel/panel.js`, `tests/infinity-panel.test.js` |
| infinity/empire | `ogamex-infinity/modules/empire/empire.js`, `tests/infinity-empire.test.js` |
| infinity/targets | `ogamex-infinity/modules/targets/targets.js`, `tests/infinity-targets.test.js` |
| infinity/spy | `ogamex-infinity/modules/spy/spy.js`, `tests/infinity-spy.test.js` |
| infinity/stats | `ogamex-infinity/modules/stats/stats.js`, `tests/infinity-stats.test.js` |
| infinity/stalk | `ogamex-infinity/modules/stalk/stalk.js`, `tests/infinity-stalk.test.js` |
| infinity/flights | `ogamex-infinity/modules/flights/flights.js`, `tests/infinity-flights.test.js` |
| infinity/fleethelp | `ogamex-infinity/modules/fleethelp/fleethelp.js`, `tests/infinity-fleethelp.test.js` |
| infinity/todo | `ogamex-infinity/modules/todo/todo.js`, `tests/infinity-todo.test.js` |
| infinity/prefs | `ogamex-infinity/modules/prefs/prefs.js`, `tests/infinity-prefs.test.js` |

Cross-module communication is only through the core API, storage reads of other modules' keys (read-only), and bus events. The module-level events used are: `targets:add` `{coords, type, playerId, playerName}` and `targets:track` `{playerId, playerName}` (`targets:add` is emitted by `spy` and handled by `targets`; `targets:track` is emitted by `targets` and handled by `stalk`). A handler that is not loaded (module disabled) simply never runs.
