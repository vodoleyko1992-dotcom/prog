# Test harness: how to write and run tests

This document is for module authors. It explains how to test a module of OgameX Live or OgameX Infinity against a mock OgameX server in a real Chromium. It complements DESIGN.md section 5. Where the two differ, this file describes what the code actually does.

Files (owner: core):

| File | What it is |
|---|---|
| `tests/server.js` | Mock OgameX. A Node `http` server with no dependencies. It serves the fixtures at the real OgameX URLs and records every request. |
| `tests/lib.js` | Harness. It provides a minimal test runner, `T.launch()` (server + Chromium + extension), and helpers. |
| `tests/sync.sh` | Copies all of `shared/` (`main/`, `core/`, `background/`, `popup/`) into `ogamex-live/shared` and `ogamex-infinity/shared`, runs `node --check` on every JS file, and checks that each file in a manifest exists (content scripts, background `service_worker`/`scripts`, popup, options page). |
| `tests/core-ext.js` | Builds a throw-away extension with the real shared core: content scripts `shared/core/*` + `shared/popup/diag-panel.js` + test modules + loader; a background that loads the diagnostic store (`shared/core/21-diaglib.js`, `shared/background/diag-bg.js`); `popup/popup.html` with the «Логи для разбора» panel. |
| `tests/core-diag.test.js` | Journal, redaction, ring buffer caps, self-learning alerts, exports, popup (see specs/DIAG.md). |
| `tests/run-all.js`, `tests/run-all.sh` | Run `sync.sh`, then every `tests/*.test.js` in its own process, and print a summary table. |
| `tests/harness.test.js` | Self-test of the harness, using the dummy extension. |
| `tests/dummy-ext/` | A tiny MV3 extension with the same manifest shape as the real ones. It is the reference for what the harness expects. |
| `tests/out/` | Screenshots (git-ignored). On a failure the runner saves one per open page. |

## 1. Running

```sh
bash tests/run-all.sh                 # everything
bash tests/run-all.sh live-           # only files whose name contains "live-"
node tests/live-planetbar.test.js     # one file (runs sync.sh once first)
OGX_TEST_FILTER=raid node tests/infinity-spy.test.js   # only tests whose name matches /raid/i
OGX_TEST_MODE=inject node tests/...   # force inject mode
OGX_HEADED=1 node tests/...           # visible browser (needs a display)
node tests/server.js --port 8080 --scenario orion [--game-js]   # manual browsing; log at /__ogx/requests
```

Environment variables:

| Variable | Effect |
|---|---|
| `OGX_TEST_MODE` | `extension` (default) or `inject` |
| `OGX_TEST_FILTER` | Regex on test names. Tests that do not match are skipped. |
| `OGX_TEST_TIMEOUT` | Timeout per test in ms (default 90000) |
| `OGX_NO_SYNC=1` | Skip `sync.sh` (run-all sets this for the child processes) |
| `OGX_HEADED=1` | Headed Chromium |
| `OGX_FILE_TIMEOUT` | run-all: wall-time budget per test file in ms |
| `OGX_WORLD_LANG=ru` | GALAXYZ world mode: every world of the run answers with John's Russian texts (§7.4), unless a spec sets `lang` |
| `OGX_QUEUE_MARKUP=live` | GALAXYZ world mode: every world renders the live Aeternum queue box (§7.4), unless a spec sets `queueMarkup` |

## 2. Loading modes (verified in this environment)

**`extension` works headless and is the default.** It runs `chromium.launchPersistentContext(tmpDir, { channel: 'chromium', headless: true, args: ['--disable-extensions-except=…', '--load-extension=…'] })` with Playwright 1.63 and its bundled Chromium (`/opt/pw-browsers/chromium-1243`). `channel: 'chromium'` selects the new headless mode, and it is required. Without it Playwright uses the headless shell, which loads nothing (checked: no service worker, no content scripts). In extension mode:

- The MAIN-world script (`run_at: document_start`, `world: MAIN`) and the isolated-world scripts (`document_end`) run in their real worlds.
- `chrome.storage.local` is the real storage. The harness reads and writes it through the background service worker. It finds the worker by the extension id, which it computes from the directory path the way Chrome does for unpacked extensions. If the worker has stopped, the harness opens `chrome-extension://<id>/manifest.json` and uses that page instead.
- `exclude_matches` is the real Chrome behaviour.
- Startup (worker + probe) takes about 1 s.

**`inject` is the fallback, and also an option for fast tests.** It uses a plain `chromium.launch()`. For each `content_scripts` entry of the manifest, in manifest order, the harness does the following:

- **MAIN-world entries:** added with `context.addInitScript` (`document_start`).
- **Isolated entries:** added through CDP `Page.addScriptToEvaluateOnNewDocument({ worldName: 'ogx-<name>' })`. That is a real isolated world, separate from the page. The files run on `DOMContentLoaded`, one indirect `eval` per file, with `//# sourceURL=ogx-inject://<ext>/<file>`. A syntax error in one file does not stop the next one, as in Chrome.
- **Storage shim:** a `chrome.storage.local` (`get/set/remove/clear/getBytesInUse`, callback or promise), `chrome.storage.onChanged`, and `chrome.runtime` (`id`, `getManifest`, `getURL`, `sendMessage` answering `ogx:ping`, `onMessage`) are installed in that world. They are backed by a Node-side map per extension. The map survives navigations and is shared by all tabs. `onChanged` is broadcast to every tab of that extension.
- **URL guard:** `matches` and `exclude_matches` are compiled to regexes. `all_frames: false` is honoured (top frame only).

**Automatic fallback.** `T.launch()` in extension mode waits up to 10 s for every extension's service worker. It then runs a **probe**: it opens `/overview` and waits for `html[data-ogx-<name>="ready"]`. If either step fails, it logs `[harness] extension mode failed (...); falling back to inject mode` and relaunches in inject mode. Pass `fallback: false` to fail instead. After the probe the harness wipes everything it caused: extension storage, page `localStorage`/`sessionStorage`, the server log and the server state. So every test starts from a fresh profile.

Both modes behave the same for tests:
- `page.evaluate()` runs in the **page (MAIN) world**. It sees game globals (`fleetDispatcher`, `token`) and anything `page-hook.js` defines. It does **not** see `window.OGX`.
- `env.evalOgx(page, fn, arg, extName?)` runs in the extension's **isolated world**, where `window.OGX` and `chrome.*` live.

Diagnostic journal in the two modes: in `extension` mode the content scripts write to the background's IndexedDB (`OGX.diag.store().kind === 'bg'`) and the popup is reachable at `chrome-extension://<T.extensionId(dir)>/popup/popup.html`. In `inject` mode the `chrome.runtime` shim does not answer `ogx:diag:ping`, so the journal uses the page-origin IndexedDB (`kind 'idb'`) like a userscript; unsent events are spilled to `localStorage` on pagehide. IndexedDB is **not** wiped after the probe, so the probe's `/overview` visit is in the journal: select events by content, not by count from the start.

Firefox is not covered by the harness. Playwright's Firefox cannot load an unpacked MV3 extension. Firefox-specific manifest keys are only checked by `sync.sh` (the files exist).

## 3. Writing a module test

File name: `tests/<ext>-<module>.test.js` (`live-planetbar.test.js`, `infinity-spy.test.js`). Template:

```js
'use strict';
const T = require('./lib');
const { assert } = T;

T.test('planetbar: production overlay on overview', async () => {
  const env = await T.launch({ ext: 'live', scenario: 'vega' });
  const page = await env.open('/overview');                 // waits for html[data-ogx-live="ready"]
  await env.waitFor(page, '#planetList .ogx-l-planetbar');  // state 'attached', 10 s
  const n = await page.$$eval('#planetList .ogx-l-planetbar', (els) => els.length);
  assert.equal(n, 3);

  const stored = await env.get('planetbar.collapsed');       // = storage[env.key('planetbar.collapsed')]
  assert.equal(stored, null);

  // core API inside the isolated world
  const cost = await env.evalOgx(page, (lvl) => OGX.calc.cost(1, lvl), 10);
  assert.deepEqual(cost, { metal: 2306, crystal: 576, deuterium: 0 });

  // mandatory checks (DESIGN 5.2)
  assert.deepEqual(env.ogxErrors(), []);
  assert.deepEqual(env.server.unhandled.map((r) => r.method + ' ' + r.path), []);
  await env.close();                                         // optional: the runner closes leftovers
});

T.test('planetbar: safety on non-OgameX pages', async () => {
  const env = await T.launch({ ext: 'live' });
  const page = await env.open('/not-ogame', { waitReady: false });
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('[class*="ogx-"]', (e) => e.length), 0);
  assert.equal(await page.evaluate(() => [...document.documentElement.attributes].some((a) => a.name.startsWith('data-ogx'))), false);
  assert.deepEqual(env.server.requests.map((r) => r.path), ['/not-ogame']);
});
```

Rules and pitfalls:

1. **Never pass a Playwright handle to `assert`.** `assert.equal(await page.$('x'), null)` crashes the process when it fails, because node's assert tries to diff the handle's object graph and runs out of memory (seen while building this harness). Compare counts or strings: `page.$$eval(sel, e => e.length)`, `page.getAttribute(sel, name)`, `page.textContent(sel)`.
2. Each test launches its own env. The runner closes every env that is still open when a test ends, also after a failure, and it takes screenshots of open pages into `tests/out/FAIL-*.png`.
3. The first navigation starts from `about:blank`. `env.open()` reuses one tab. Pass `{ newPage: true }` for a second tab (multi-tab and storage-subscription tests). Going from `/overview` to `/overview#x` is a fragment navigation and does not reload: call `page.reload()` after it.
4. `waitReady` waits only for the `ready` attribute. If your module renders after an `await` (storage, AJAX), wait for your own selector too.
5. The mock records only what the browser really sent. To test "no request was made", call `env.clearRequests()` first, do the action, wait, then check `env.requests()`.
6. The isolated world of a module starts at `document_end`. AJAX made by the game (with `gameJs: true`) can finish **before** `OGX.boot` has run your `init`. A module that needs those responses must cope with that: read the DOM, or wait for the next call. In tests, trigger the call after ready, for example `page.evaluate(() => loadContentNew(1, 45))`.
7. Assert texts as Russian UI strings. Game strings in fixtures are English.

## 4. `T.launch(options)` and the env

```js
const env = await T.launch({
  ext: 'live' | 'infinity' | 'both' | { name, dir } | [ ...those ],   // default 'live'
  scenario: 'vega' | 'compact' | 'vacation' | 'orion',              // default 'vega'
  mode: 'extension' | 'inject',             // default OGX_TEST_MODE || 'extension'
  fallback: true,                           // extension -> inject automatically
  gameJs: false,                            // serve OgameX's own ingame JS (see 5.3)
  storage: { '{host}|{pid}|targets.marks': {...} },   // seed before the first page; placeholders expanded
  settings: { 'planetbar.enabled': false, 'core.logLevel': 'debug' },  // seed of the 'settings' key, see below
  host: 'localhost',                        // host name of env.origin (any name resolves to the mock)
  server: srv,                              // reuse a server (launch resets its log/state during the probe)
  probe: true, probePath: '/overview', extTimeout: 10000,
  viewport: { width: 1400, height: 900 }, headless: true,
});
```

Seeding: `storage` keys may contain `{host}` (= `location.host` lowercased, for example `localhost:41233`) and `{pid}` (the scenario's player id). `settings` is stored as **nested** objects under `<host>|<pid>|settings`: `{ planetbar: { enabled: false }, core: { logLevel: 'debug' } }`. `OGX.settings.load()` (core, `04-settings.js`) must read this shape. With `ext: 'both'`, the seed goes to both extensions. Use `env.setStorage({ live: {...}, infinity: {...} })` to seed them separately.

| Member | Description |
|---|---|
| `env.mode` | `'extension'` or `'inject'` (after a fallback) |
| `env.origin`, `env.host` | `http://localhost:<port>`, `localhost:<port>` |
| `env.server` | the mock server (section 5) |
| `env.ext` | extension names, for example `['live']` |
| `await env.open(path \| url, { waitReady = true, newPage = false, page, readyTimeout = 10000, waitUntil = 'domcontentloaded' })` | navigates and returns the `Page`. When an extension does not get ready, the error names the attribute state and the first OGX errors. |
| `await env.page(newPage?)` | the shared tab, or a new one with the console and error listeners attached |
| `await env.waitReady(page)` | waits for `data-ogx-<name>="ready"` of every loaded extension |
| `await env.waitFor(page, sel, opts)` | `page.waitForSelector` with state `attached` and a 10 s timeout |
| `env.url(path)`, `env.urlOn(hostname, path)` | absolute URL on the mock, optionally under another host name. Use `env.urlOn('s1-en.ogame.gameforge.com', '/overview')` to prove that `exclude_matches` keeps the extension off gameforge, and `env.urlOn('ogame.example.org', …)` to prove it works on any domain. |
| `await env.storage(name?)` | all of `chrome.storage.local`. With several extensions and no name: `{ live: {...}, infinity: {...} }`. |
| `await env.setStorage(obj, name?)`, `await env.clearStorage(name?)` | write or wipe storage (inject mode also fires `onChanged`) |
| `env.key(key, { scope = 'player' \| 'server' \| 'global' })` | full storage key: `<host>\|<pid>\|key`, `<host>\|*\|key`, `*\|*\|key` |
| `await env.get(key, { scope, ext })` | `storage[env.key(key)]` |
| `await env.evalOgx(page, fn, arg, extName?)` | evaluates `fn(arg)` in the extension's isolated world (awaits promises; the result must be JSON-serialisable) |
| `env.logs` | `{ type: 'console' \| 'pageerror', level, text, stack?, url }` of every page |
| `env.ogxErrors()` | console errors containing `[OGX`, plus page errors whose stack is in extension code (`chrome-extension://` or `ogx-inject://`) or contains `[OGX` |
| `env.consoleErrors()`, `env.clearLogs()` | all errors, and a reset |
| `env.requests(method?, pathOrRegex?)`, `env.clearRequests()` | filtered `server.requests`, and a reset of the log |
| `env.setState(patch)` | `Object.assign(server.state, patch)`, for example `{ sendFleet: 'error' }` |
| `await env.pageStub(page, 'fleetDispatcher', fields?)` | replaces `window[name]` in the MAIN world with a Proxy. Data fields keep their values (defaults: `shipsToSend`, `targetPlanet`, `mission`, `speedPercent`, `cargo*`, `expeditionTime`, `holdingTime`, `fleetHelper.shipsData`, `currentPage`). Any other property is a function that records `{name, method, args}`. |
| `await env.stubCalls(page)` | the recorded calls |
| `await env.screenshot(page, name)` | `tests/out/<name>.png` |
| `env.worker(name)` | the extension's service worker (extension mode) |
| `await env.close()` | closes the browser, the server it started, and the temporary profile |

Other exports: `T.test(name, fn, { timeout, skip })`, `T.test.skip`, `T.assert` (`node:assert/strict`), `T.fixture(name)`, `T.fixtureJson(name)`, `T.key(ext, scenario, key, host?)` (uses the host of the last launched env), `T.startServer`, `T.sync()`, `T.extensionId(dir)`, `T.matchPatternToRegExp(p)`.

The runner prints `✓`/`✗` for each test and exits with code 1 if any test failed. The `t` argument has `t.name` and `t.log(...)`.

## 5. Mock server

### 5.1 API

```js
const { startServer } = require('./server');
const srv = await startServer({ port: 0, scenario: 'vega', gameJs: false });
srv.origin  srv.port
srv.requests     // [{ t, method, path, url, query, form, raw, headers, cp, host, fixture, csrf, unhandled?, fallback?, custom?, valid? }]
srv.unhandled    // requests that matched no route or had no fixture (tests assert it is empty)
srv.assets       // static asset requests (/build, /img, /fonts, favicon). Not in requests.
srv.state        // see 5.4
srv.find(method, pathOrRegex)
srv.route(method | '*', pathOrRegex, (req, res, ctx) => ...)   // takes priority; ctx: { form, query, state, origin, rec,
                 //   page(name), json(name, status, type), jsonBody(obj, status), html(name, status), send(status, body, type, headers), unhandled() }
srv.setScenario(name)   srv.reset()   srv.clearLog()   await srv.close()
```

Inspection endpoints (not recorded): `GET /__ogx/requests`, `GET /__ogx/unhandled`, `GET /__ogx/state`, `POST /__ogx/state` (JSON merged into the state), `POST /__ogx/reset`.

Every served fixture has `http://localhost` and `http:\/\/localhost` (when not followed by `:` or a host character) replaced by the **request's** origin, so links work under any host name. HTML is served as `text/html; charset=utf-8`, JSON as `application/json`, and checkevents as `text/plain`.

### 5.2 Scenarios and pages

| Scenario | Player | Bodies (`?cp=`) | CSRF token |
|---|---|---|---|
| `vega` | 108 "Commander Vega" | planets 1 [1:42:8], 3 [2:118:12], moon 5 | `Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e` |
| `compact` | like vega, `/overview` is always `layout-overview-compact.html` | | |
| `vacation` | like vega; `/galaxy` is `galaxy-page-vacation.html` and `POST /ajax/galaxy` returns 403 | | |
| `orion` | 1 "Commander Orion" | planets 4, 7, moon 9 | `Qm3c4p0tXgF9b2kLr8VwZy1sNuHdEj6aTo5iCxYe` |

`?cp=<id>` of the scenario sets `state.currentBodyId`. The choice **sticks** for later requests without `cp`, as on the real server. Pages:

| Path | vega family | orion |
|---|---|---|
| `/overview` | body 5: `layout-overview-moon`, body 3: `layout-overview-compact`, else `layout-overview-planet` | body 9: `buildings-overview-moon`, else `buildings-overview` |
| `/fleet` | body 5: `fleet-dispatch-noships`; with `galaxy&system&position`: `fleet-dispatch-prefill`; else `fleet-dispatch-planet` | (vega fixture) |
| `/fleet/movement`, `/messages`, `/highscore`, `/buddies` | `fleet-movement`, `messages-page`, `galaxy-highscore-page`, `galaxy-buddies-page` | (vega fixtures) |
| `/galaxy` | with `galaxy&system`: `galaxy-page-query`, else `galaxy-page` | (vega fixture) |
| `/resources` | (orion fixtures) | body 7: `-colony`, body 9: `-moon`, else `buildings-resources` |
| `/facilities` | (orion) | body 9: `-moon`, else `buildings-facilities` |
| `/research`, `/shipyard`, `/defense`, `/resources/settings` | (orion) | `buildings-research`, `-shipyard`, `-defense`, `buildings-resource-settings` |
| `/` | 301 to `/overview` | |
| `/not-ogame`, `/login`, `/gameforge-like` | non-OgameX pages: plain page; out-game page with csrf meta and the OGameX comment but no `#planetList`; OGame metas + `#planetList` but no OGameX markers | |

A page that the scenario's account does not have is served from the other account's fixture, and the request is marked `fallback: true`. **The player id in the page then changes** (108 ↔ 1), so the extension switches its storage namespace. A test that needs both kinds of pages must expect that.

### 5.3 Game JS

With `gameJs: true`, `/build/assets/ingame-*.js` serves OgameX's own ingame scripts from `src/OGameX/resources/js/ingame/`, in the vite list order without pusher, echo and chat, plus a stub for `ogame.chat`. The page then behaves like the real game: Tipped strips `title` attributes, `fleetDispatcher` exists on `/fleet`, the galaxy loads through `POST /ajax/galaxy`, and **the game itself polls `/ajax/fleet/eventbox/fetch` and `/ajax/fleet/eventlist/fetch` on every page**. Those game requests are in `srv.requests` too, so filter by path or call `clearRequests()` before the action you test. With `gameJs: false` (the default) the script is an empty stub. The page is then static, and every recorded request comes from the extension. The real `ingame-*.css` and `public/img` are always served when they exist (useful for screenshots).

### 5.4 State knobs (`srv.state` / `env.setState`)

| Key | Values | Effect |
|---|---|---|
| `currentBodyId` | body id | the current planet (also set by `?cp=`) |
| `eventbox` | `'normal'` \| `'empty'` | `fleet-eventbox.json` / `-empty.json` |
| `sendFleet` | `'success'` \| `'error'` \| `'validation'` | send-fleet answer (invalid input always gets the validation error) |
| `miniFleet` | `'success'` \| `'error'` | send-mini-fleet (`shipCount=0` is always an error) |
| `addBuild` | `'success'` \| `'error'` \| `'busy'` \| `'upgrading'` \| `'vacation'` | add-buildrequest |
| `downgrade` | `'success'` \| `'error'` | `/resources|facilities/downgrade` |
| `discoverer` | bool | `/ajax/galaxy` 1:42 returns the `-discoverer` variant |
| `latencyMs` | ms | delay for every non-asset response (loading states, races) |

### 5.5 AJAX routes

CSRF: every non-GET request must carry `_token` (form) or `X-CSRF-TOKEN` equal to the scenario token, or to the token of the last page served. Otherwise the answer is **419** `{"message":"CSRF token mismatch."}`. `add-buildrequest` also requires `_token` **in the body**, otherwise it returns `buildings-addbuildrequest-invalid-token.json`.

| Request | Answer |
|---|---|
| `GET /ajax/{resources,facilities,research,shipyard,defense}?technology=<id>` | `buildings-ajax-*-<id>.json` (same page preferred). Id 1 in vega: `layout-ajax-resources-technology-1.json`. Unknown id: 500 (unhandled). |
| `GET /ajax/techtree?tab=&object_id=` | `ogamelive-techtree-tab<t>-<id>.html` or `buildings-techtree-tab<t>-<id>.html`, else 404 |
| `GET /overlay/server-settings`, `GET /overlay/search` | layout and galaxy overlays |
| `GET /ajax/fleet/eventlist/fetch` | `fleet-eventlist.html` |
| `GET /ajax/fleet/eventbox/fetch` | per `state.eventbox` |
| `POST /ajax/fleet/eventlist/checkevents` | `fleet-checkevents.json` (`text/plain`) |
| `POST /ajax/fleet/dispatch/check-target` | `-invalid` (galaxy > 9, a 0/missing coordinate, position > 16), `-expedition` (position 16), `-player` (a player planet in a galaxy fixture), else `-empty-slot` |
| `POST /ajax/fleet/dispatch/send-fleet` | validates `am<id>` > 0, `mission` ∈ {1-9, 15}, `speed` 1-10 in 0.5 steps, numeric galaxy/system/position/type (`rec.valid`). Then per `state.sendFleet`. |
| `POST /ajax/fleet/dispatch/send-mini-fleet` | success or error |
| `POST /ajax/fleet/dispatch/recall-fleet` | success for `fleet_mission_id` in the event list (1201, 1203, row ids), else the failure fixture with **HTTP 500** |
| `GET/POST /ajax/fleet/templates`, `DELETE /ajax/fleet/templates/:id` | template fixtures |
| `POST /ajax/phalanx/scan` | scan fixture for 1:45, else the range error |
| `POST /ajax/jumpgate/execute` | jumpgate fixture |
| `POST /ajax/galaxy` | `galaxy-ajax-<g>-<s>.json` (`-from-moon` when the current body is 5, `-discoverer` per state). Otherwise the empty system with `galaxy`/`system` rewritten. 403 in `vacation`. |
| `POST /ajax/highscore` (query or form) | category 2: alliances; type 3: military; type 0 page 2: page 2; type 0 page 1 or `searchRelId`: the `#stat_list_content` inner HTML of the page fixture; else 404. `GET`: 405. |
| `POST /ajax/search` | by `category` 2/3/4; empty `searchtext`: the empty-term fixture |
| `GET /ajax/messages?tab=&subtab=&pagination=` | `messages-ajax-<tab>-<subtab>[-page<N>].html`. Without subtab: `messages-ajax-tab-<tab>.html`, or an empty body for economy/universe/system/favorites. A page past the last: empty. |
| `GET /ajax/messages/<id>` | `messages-ajax-message-<id>-*.html`, else 500 |
| `POST /messages` | `{"<messageId>": true}` |
| `POST /{resources,facilities,research,shipyard,defense}/add-buildrequest` | success (unit success for 202-219 and 401-503) or per `state.addBuild` |
| `POST /{resources,facilities,research}/cancel-buildrequest`, `/{resources,facilities}/downgrade`, `/ajax/{facilities/halve-building,research/halve-research,shipyard/halve-unit}` | the matching fixtures |
| `GET /buddies/online`, `GET /buddies/request-dialog`, `POST /buddies/send-request`, `GET /alliance/info/12` | galaxy fixtures |

To answer something else, or to simulate a server error, add a per-test route:

```js
env.server.route('POST', '/ajax/galaxy', (req, res, ctx) => ctx.jsonBody({ success: false }, 500));
env.server.route('GET', /^\/ajax\/messages$/, (req, res, ctx) => ctx.send(200, '', 'text/html'));
```

## 6. The dummy extension as reference

`tests/dummy-ext` shows the full contract in about 100 lines. It has a MAIN-world hook (`window.__ogxDummyHook`, XHR relay as `ogx:xhr` with a string `detail`). It has an isolated core with `isOgx()` (metas + `#planetList` + OGameX comment or footer link), `chrome.storage`, and a `localStorage` fallback. A module writes `<host>|<pid>|dummy.visits`, does a read-only GET, and POSTs send-fleet on click. A loader sets `data-ogx-dummy` to `boot` and then `ready`. `harness.test.js` exercises the following in both modes:

- seeding
- evalOgx
- `?cp=` switching
- the POST log
- error capture
- the non-OgameX safety check
- the gameforge host exclusion
- an arbitrary domain
- two extensions side by side with the game JS (XHR relay and separate storage)
- `pageStub`
- the automatic fallback

Run it after any change to the harness: `node tests/harness.test.js` (5 tests, about 12 s).

## 7. GALAXYZ mock, world mode and bot tests

Sections 4–6 describe the OgameX mock (`tests/server.js`). The suite's target server is GALAXYZ (ogamex.eu/Aeternum, a 2Moons
fork); its tests use `tests/gz-server.js` and `tests/gz-lib.js` (static mode) or `tests/gz-world.js` and `tests/gz-bot-lib.js`
(world mode). The binding API is BOT_CONTRACT §C7 (C7 helper, C7.1 WorldSpec, C7.2 World) with the amendments A12–A14; the
scenario files and every spec extension are listed in `fixtures/galaxyz/bot-scenarios/README.md`. This section states the rules a
new test must follow.

### 7.1 Static mode (`tests/gz-server.js`, `G.launch()` of `tests/gz-lib.js`)

The REAL pages saved on Aeternum (`fixtures/galaxyz/pages`) are served as they are; `srv.state` knobs (`fleetError`,
`fleetErrorAt`, `bodyShips`, `bodyRes`, `planets`, `missions`, `buildError`, `spycount`, `lang`, `latencyMs`, …; the list with
comments is `defaultState()` in the file) change the answers. Fleet dispatch follows upstream: step 1 accepts any posted count,
step 3 refuses with an info page (`Not all ships present.` / `Не все корабли доступны.` by `state.lang`; the en/ru texts of the
other refusals are exported as `STEP3_TEXTS`). Every page shows the same saved body: use it for parser and UI tests, not for
bot behaviour.

### 7.2 World mode (`B.launchBot()` of `tests/gz-bot-lib.js`)

`launchBot({ world: '<scenario>' | WorldSpec, settings, page, clock, botDefaults })` starts `gz-server` with a stateful `World`
built from the scenario and a browser with the suite. Pages are the same REAL pages with their dynamic parts regenerated from the
world (bodies, stock, event box, fleetTable, steps 1–3, galaxy, messages, spy reports, queues). Fleets fly, arrive, fight (via
`OGX.botSim`), return and write messages on the world clock; `env.world` is the live World of the server.

* **Clock.** `clock: 'now'` (default, A13) starts the world at the real time; `'spec'` keeps `startUnix`. Use the world clock for
  anything time based: `env.world.clock.nowUnix()`, `env.world.clock.advance(sec)`, `setSpeedup`, scenario `script[]`. Never
  compute game times from `Date.now()` — that only works with `'now'` and breaks as soon as a test advances the clock.
* **Journal.** `env.journal({ kind, since })` reads the bot journal (stored + recent events); `env.waitJournal(kind, { pred,
  timeoutMs, failMs })` polls it. A journal that cannot be read (closed page, CDP session gone, store errors) fails
  `waitJournal` after `failMs` (15 s) with the error, and every timeout text names the last read error and OGX console errors
  (`env.journalErr`). Prefer `waitJournal` + `clock.advance` over fixed sleeps.
* **Requests.** `env.mutating()` = POSTs, fleetAjax, galaxy views and message reads since launch; `env.server.requests` has
  everything. `env.world.log` has `events`, `refusals` (step-3 and build refusals with their reason) and `script`.
* **Ground truth.** Assert on the world (fleets, `world.snapshot()`, refusals) and on the journal, not on the bot's own status.

### 7.3 Bot switches: the test baseline and `botDefaults: 'auto'`

Since 0.3.2 every bot function is ON by default. `tests/bot-baseline.js` therefore seeds the pre-0.3.2 values (master off,
dry-run on, autoLogin off, `galaxyViewsPerHour` 0, every module switch off) into the profile of every `G.launch` / `T.launch` /
`launchBot` that loads the suite; a test's own `settings` override them. Such a test proves one module with the switches it turns
on — it does NOT prove the packaged defaults.

`botDefaults: 'auto'` skips the baseline: the profile starts with the packaged defaults, exactly as John's install. It is
mandatory for any test that claims "works with the defaults" — default limits (`maxFleetSendsPerHour`, `maxBuildsPerHour`,
`galaxyViewsPerHour`), default module switches, the 0.3.1 → 0.3.2 migration. Do not add limit overrides to such a test. Current
users: `gz-bot-autoall` (c), `gz-bot-defaults` (scenario `aeternum-day`, one simulated day with every module on).

### 7.4 World options worth knowing

* `lang: 'ru'` — event box sentences, ship and mission names and step-3 refusals in Russian (John's UI) [UPSTREAM language/ru].
* `queueMarkup: 'live'` — the build/research queue box in the live Aeternum markup (`fixtures/galaxyz/queue/*-live.html`)
  instead of the upstream `#buildlist`.
* `fleetHandlerOnAjax: false` — like upstream, an ajax request does not process fleets (arrivals show with the next full page).
* `universe.resourceMultiplier` 22000 and `universe.ecoScale` (1 = the live economy; old scenarios pin 0.001 = the former ×22),
  `universe.bashOn/bashCount/bashTime` (6 attacks per target per 24 h), `player.spyProbes` (account spycount).
* `universe.expeditionModel: 'upstream'` / `universe.dmMission: 'upstream'` — the upstream expedition tiers, battle losses and lost
  fleets, and the upstream mission-11 chance (trips that find nothing, collectors that come home).
* `expeditionOutcomes` forces expedition results in order; the random draw is seeded (`spec.seed`), so a run is deterministic.

### 7.5 What the mocks guess

Parts never captured live and built from upstream 2Moons or invented: the hostile/holding event texts (the en/ru upstream
sentences), the queue boxes of the upstream markup, shipyard queue data, the staytime block, the settings page
([HYPOTHETICAL]), the login form, captcha and info pages ([HYPOTHETICAL]: a real logged-out `index.php` was never saved, so
`gz-bot-autologin` proves autoLogin only against an invented `form#login`), the details panels, foreign galaxy rows, expedition
and dark-matter mission outcomes ([GUESS] by default: one amount per type, DM 100–300, collectors always scrapped; the upstream
rules are opt-in through `universe.expeditionModel` / `universe.dmMission` 'upstream'; no real GALAXYZ text was captured),
and every Russian text except the saved pages. A test passing against these parts proves the bot against upstream, not against
GALAXYZ; when a live page is captured, replace the guess and keep the old markup only as an extra variant.

