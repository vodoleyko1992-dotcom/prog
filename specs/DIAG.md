# Diagnostics: event journal, self-learning, exports

This file is for two readers:

- the module, integration and bot authors who call the API (summary here, full signatures in CORE_API.md "Diagnostics");
- **Claude (or any developer) who receives an export from John** and has to find and fix the bug. Section 5 is the reading guide.

The idea: the add-ons record what happened (journal) and what the server's pages and AJAX answers normally look like (self-learning). When something breaks, John presses "Логи для разбора" in the popup (or in the Infinity side panel) and hands over the files. The files say what the user clicked, what the add-on did, what the game answered, what errors were thrown (with stacks), and whether the OgameX markup or API drifted from what was learned.

## 1. Architecture

| Part | File | Runs in |
|---|---|---|
| Library: redaction, JSON key schema, store (IndexedDB ring buffer + localStorage fallback), export formatters | `shared/core/21-diaglib.js` (`self.OGXDiagLib`, `OGX.diaglib`) | content scripts, background, popup |
| Journal: `OGX.log.rec`, `OGX.log.wrap`, capture, transport, snapshots, export entry points | `shared/core/22-diag.js` (`OGX.diag`) | content scripts |
| Self-learning | `shared/core/23-learn.js` (`OGX.learn`) | content scripts |
| Background store | `shared/background/diag-bg.js` (`self.OGXDiagBG`) | MV3 service worker / Firefox background scripts |
| Network capture of the game's own requests | `shared/main/page-hook.js` (event `ogx:net`) | MAIN world |
| Panel "Логи для разбора" | `shared/popup/diag-panel.js` + `.css` (`self.OGXDiagPanel`) | popup / options page, and the game page (side panel) |

Data flow:

```
page hook (MAIN) --ogx:net--> 22-diag --OGX.log.rec--> buffer (0.8 s) --chrome.runtime 'ogx:diag:put'--> background IndexedDB 'ogx-diag'
OGX.http (ours) ----_ogxNet--^      \--> OGX.learn.api (schema)                      \-- fallback: page-origin IndexedDB 'ogx-diag-<ext>'
logger warn/error, boot, clicks, fadeBox ... --^                                           (localStorage when IndexedDB fails; spill on pagehide)
23-learn: tokens + selector hits per visit, API schemas --> chrome.storage '<host>|*|diag.learn' ; alerts --> journal L + snapshot store
popup: reads the background IndexedDB directly (same extension origin) + chrome.storage '<host>|<pid>|diag.ctx' for the header
```

- Store choice: at `diag.init` the content script sends `{type:'ogx:diag:ping'}`. If the background answers `{diag:true}`, events go there (`kind: 'bg'`), else to the page-origin store (userscript, or an extension whose background does not include `diag-bg.js`). If the background disappears later (extension reloaded), the journal continues in the page-origin store.
- Events: ring buffer of 100 000 (pruned in one step when 500 over the cap). Snapshots: 1000 or 64 MB, each at most 600 000 chars (localStorage fallback: 4000 events, 5 snapshots).
- Nothing is recorded or stored on non-OgameX pages: `diag.init` / `learn.init` run only from `OGX.boot` after `isOgx()`.

## 2. Event model

```js
{ id, t /* epoch ms, local clock */, s /* source */, k /* kind */, w /* what */, d? /* data */, p /* page */, x /* ext */, tab /* 6 chars */ }
```

| Source | Meaning | Kinds written by core |
|---|---|---|
| `U` | user click/change in our UI (any element under an `ogx-*` id/class) | `click` (label = `data-ogx-act` / aria-label / title / text), `change` (checkbox state, select/number value; free text only as `len`), `popup` (Suite popup: `w` = `modules` with `d.globalOff`, or `hosts` with `d.allowHosts`) |
| `B` | add-on or bot action | `api` (`sendFleet`, `sendMiniFleet`, `recall`, `addBuild`, `deleteMessage`), `<module>` from `OGX.log.wrap(module, fn, label, opts?)`; `d = { ms, ok, args?, r?, err?, same? }`. Per-tick labels (`render`, `render-*`, `badges`, `renderBadges`, `renderTable`, `alert`, `attachOverlay`, `movementChart`, `plan:sweep-done`, or `opts.quiet`) are quiet: recorded on the first call of a page and then only when the result `r` changes (the call reason `r.reason` ignored); `same` = identical calls skipped before this one. Failures are always recorded |
| `S` | page, navigation, session, errors, snapshots | `page` (`d.path, ref, nav, domMs, player, body`), `ready` (`d.ms`, `d.modules` = init ms per module), `leave` (`d.stayMs`), `module-init-fail` (`d.error` with stack), `error` / `warn` (every `log.error/warn` of any logger, `d.msg`, `d.stack`), `uncaught`, `rejection` (errors whose stack points at our code), `boot-fail`, `session` (`logged-out`, `csrf-expired`), `snapshot` (`d.id`, `d.size`), `gated` (`w` = host; boot refused by the Suite allow-list: `d.reason`, `d.allowHosts`; one per tab session, background journal only) |
| `N` | network | `req`, `w` = `METHOD /normalized/path` (`/ajax/messages/123` -> `/ajax/messages/:id`); `d = { st, ms, sz, by: 'page'|'ogx', cp?, q?, to?, f?, r?, err? }` |
| `G` | game messages shown to the player | `fadeBox` (`d.failed`), `notify` (`#errorBoxNotify`: `d.head`; `d.failed` only when the head is the game's error text — OgameX also shows success messages there), `decision` (yes/no box), `notification` (`d.type`) |
| `L` | self-learning alerts | `selector-miss`, `tokens-gone`, `tokens-new`, `api-key-lost`, `api-key-new`, `api-new`, `implausible`; `d.key` = dedup key |

`N` fields: `st` HTTP status (0 = network error/abort), `ms` duration, `sz` response length in chars, `by` who sent it (`page` = the game's own JS, `ogx` = our `OGX.http`), `cp` the planet of the request (query or form `cp`, from the URL as requested: a 2Moons redirect drops it), `q` query string of the requested URL (redacted), `to` where a redirect ended (when it differs), `f` request form (POST; values cut to 60 chars, secrets masked), `r` small safe fields of a JSON answer (`success`, `status`, `result`, `message`, `error`, `code`, `errors[]` texts, nested `response`), `err`.

### Privacy (applied to every event, every snapshot)

- Never stored: passwords, CSRF tokens (`_token`, `X-CSRF-TOKEN`, `csrf*`, `newAjaxToken`), cookies, sessions, secrets, e-mail addresses. Keys matching `password|passwd|token|cookie|secret|email|csrf|xsrf|session` are replaced by `<redacted>` (except a key ending in the plural `tokens`, e.g. the markup token list `d.tokens` of `tokens-gone/new` alerts, which holds selectors like `#id`/`.class`, never secrets); the live CSRF token string is replaced by `<csrf>` wherever it appears; e-mails by `<email>`; sensitive query parameters by `<redacted>`.
- Response bodies are never stored, only the JSON key schema (learning) and the safe fields above.
- Free text typed into our inputs is stored only as its length.
- Strings are cut at 500 chars (`what` at 300), objects at depth 5 / 60 keys / 50 array items.
- Snapshots: scripts emptied (only `src` kept; inline ones marked `data-ogx-stripped="inline"`), input values and textareas cleared, `meta[name*=token]` content `<csrf>`, sensitive attributes masked, comments that contain markup removed, `<template>` contents sanitized too.

## 3. Self-learning

State per server (`chrome.storage` key `<host>|*|diag.learn`, saved at most every 5 s and on pagehide):

```js
{ v: 1, t0, apiTotal,
  // <page> = OGX.learn.pageKey(): page name, + ':moon' on a moon, + ':noships' for /fleet without ships
  pages: { <page>: { visits, lastT, tokens: { <tok>: [present, missStreak, firstVisit, lastVisit] }, sels: { <sel>: [visits, hits, missStreak] } } },
  api: { 'METHOD /path': { n, first, last, kinds: { ok|err|ok-raw|err-raw: { n, keys: { <path>: count } } } } },
  alerts: { <key>: lastT }, alertLog: [ { t, key, kind, what, data } ] /* last 200 */ }
```

- Page = `OGX.page.info().name` (`other:<path>` for unknown pages). A visit is committed 20 s after boot, and again on pagehide for selectors first used later.
- Tokens (static markup at boot, our `ogx-*` subtrees skipped, digits -> `#`): `#id`, `.class`, `[data-attr]`, `meta:name`. Volatile tokens (`OGXDiagLib.VOLATILE_TOKEN`: the fleet event box `#OvfleetEvents`/`#OvfleetContent`/`#eventboxLoading`/`.OvfleetButton`/`[data-fleet-*]`/its row classes, mission classes `.own*`, tooltip classes `.t_*`, bootstrap icons `.bi`/`.bi-*`, `.buildingIco`, `.new-msg-count`, `.res_current_*`) come and go with normal play: never collected, dropped from older states, never alerted or reported.
- Selectors: everything queried through `OGX.dom.$`, `$$`, `waitFor` (string) or `OGX.learn.sel` against the live document. Hit = found at least once during the visit. Selectors containing `ogx` and queries on fetched documents are ignored.
- API: every response of `OGX.http` and of the game (page hook). Key schema: sorted paths, depth 3, `[]` for the first object of an array, numeric keys -> `#`. Kind: `err` when HTTP >= 400 / 0, `success: false`, `status: failure|error`, non-empty `errors`; `-raw` suffix for non-JSON answers.

Alert rules (each deduplicated per key for 6 h; one sanitized DOM snapshot per alert batch, at most one per 30 s):

| Kind | Rule |
|---|---|
| `selector-miss` | a selector found in >= 85 % of >= 6 earlier visits misses 3 visits in a row |
| `tokens-gone` | tokens present in >= 90 % of >= 5 visits are missing 2 visits in a row |
| `tokens-new` | tokens first seen after the page had >= 5 visits appear on a 2nd visit |
| `api-key-lost` | a key present in >= 95 % of >= 5 responses of that endpoint and kind is missing |
| `api-key-new` | an endpoint/kind with >= 5 responses returns a key never seen |
| `api-new` | an endpoint never seen, once >= 30 responses were learned in total |
| `implausible` | core parser results (`inlineResources`, `resourceTooltips`, `planetList`, `overviewInfo`, `fleetPage`, `player`, `techList`, `resourceSettings`, `techDetails`), the boot snapshot, or `OGX.learn.check/value` calls contain NaN/Infinity, or negatives in `amount, storage, metal, crystal, deuterium, darkMatter, fieldsUsed, fieldsMax, diameter, level, value, target, current, count, points, rank, capacity, cargo` (production, energy and temperatures may be negative) |

Thresholds live in `OGX.learn.config` (tests may lower them).

## 4. Exports ("Логи для разбора")

Buttons (popup of each extension, Infinity side panel tab "Логи", `OGX.diag.mountPanel(container)` anywhere):

| Button | File | Content |
|---|---|---|
| **Выгрузить логи** (top of the panel; the rest is under «Ещё») | `ogx-<ext>-logs-<host>-<YYYYMMDD-HHMMSS>.txt` | ONE file for debugging: header (versions, server, every module + core setting), `=== НАСТРОЙКИ (все, JSON) ===` (raw `settings` of player + server scope; popup: every player of that host and the `*\|*\|suite.*` keys), `=== БОТ … ===` (`bot.*` keys, or a line saying there is none), `=== ОТЧЁТ САМООБУЧЕНИЯ ===`, `=== SUMMARY (журнал за сегодня целиком) ===`, `=== EVENTS ===` (today; when over 6 MB every key event — U, S, G, L and errors — is kept, then the newest routine ones; gaps are marked `… пропущено рядовых событий: N …`), `=== СНИМКИ СТРАНИЦ ===` (today's newest, one per page + reason, at most 8 / 2.5 MB, compacted: no style/svg/script bodies, comments or blank runs; each between `----- СНИМОК #id … -----` and `----- КОНЕЦ СНИМКА #id -----`). File at most 10 MB |
| Новое с прошлой выгрузки | `ogx-<ext>-log-new-<host>-<YYYYMMDD-HHMMSS>.txt` | events after the marker `lastExportId` |
| За сегодня | `ogx-<ext>-log-today-…txt` | events since local midnight |
| Последние N | `ogx-<ext>-log-last-…txt` | the N newest events (default 5000) |
| JSONL | `ogx-<ext>-log-jsonl-…jsonl` | line 1 `{"_header": context}`, then one raw event object per line |
| Снимки страниц (HTML) | `ogx-<ext>-snapshots-<host>-…html` | index table + every snapshot as `<template id="snap-<id>">` preceded by `<!-- ===== OGX SNAPSHOT #id t=… page=… reason=… url=… ===== -->` (inner `</template` written as `<\/template`) |
| Отчёт самообучения | `ogx-<ext>-learn-<host>-…txt` | the learning state in readable form |
| Очистить | — | deletes events, snapshots and the export marker (learning state stays; `OGX.learn.reset()` clears that) |

Every event export moves the marker to its newest event. Every file is at most 6 MB; the newest events are kept.

### TXT layout

```
=== OGX журнал для разбора (формат 1) ===
Расширение: OgameX Live 0.1.0 (ядро 0.1.0)
Выгрузка: 2026-10-30 03:41:12 UTC+03:00  вид: новое с прошлой выгрузки (после события #18234)
Браузер: Mozilla/5.0 …
Сервер: ogx.example.org  хранилище журнала: bg|idb|localStorage|extension IndexedDB  другие серверы: …
Игрок: id 108  класс miner  контекст обновлён 2026-10-30 03:40:58
Настройки сервера: {"economySpeed":8,"researchSpeed":8,"fleetSpeedWar":2,…,"tzOffsetMs":10800000}
Диагностика: {"journal":true,"network":true,"learn":true,"snapshots":true}
Модули:
  + planetbar (активен на странице overview) {"prodDisplay":"hour"}
  - timeline {}
Настройки ядра: {"logLevel":"warn",…}
Ошибки за 10 мин: U=0 B=1 S=2 N=0 G=1 L=0
ОБРЕЗАНО: … (only when something was cut: how many old events, and the oldest included one)
Событий в файле: 812, период 2026-10-30 01:02:03 — 2026-10-30 03:41:11

=== SUMMARY ===
События по источникам/видам:
  [S] 40: page×12, leave×11, ready×12, error×3, snapshot×2
  [N] 700: req×700
Сеть (эндпоинт: кол-во, среднее мс, ошибок, из них наших запросов, статусы):
  GET /ajax/fleet/eventbox/fetch  n=380 avg=35ms err=0 ogx=10 st={"200":380}
Сообщения игры (топ):
  3× fadeBox: Not enough deuterium!
Ошибки (топ):
  2× [S] error: spy — spy failed: TypeError: Cannot read properties of null (reading 'textContent')  (последняя 2026-10-30 03:12:44)
Последние алерты самообучения (до 20):
  2026-10-30 03:12:40 selector-miss: fleet: селектор «#continue» не найден 3 визита подряд … {"key":"sel-miss:fleet:#continue",…}

=== EVENTS ===
--- 2026-10-30 ---
03:12:39.120 [S] page: fleet {"path":"/fleet?cp=3","ref":"/overview","nav":"navigate","domMs":412,"player":108,"body":"p3","pg":"fleet","tb":"k2x9qa"}
03:12:39.530 [N] req: POST /ajax/fleet/dispatch/check-target {"st":200,"ms":88,"sz":2140,"by":"page","f":{"galaxy":"1",…,"_token":"<redacted>"},"r":{"status":"success"}}
03:12:44.002 [S] error: spy {"msg":"failed: TypeError: …","stack":"TypeError: …\n    at chrome-extension://…/modules/spy/spy.js:120:17"}
```

Event lines: `HH:MM:SS.mmm [SRC] kind: what {json}`. Time is the user's local clock (zone in the header). The JSON is `d` plus `pg` (page) and `tb` (tab) **only when they change from the previous line** (several tabs interleave; follow `tb`). A `--- YYYY-MM-DD ---` line starts each day.

## 5. How Claude should read an export

1. **Header first.** Extension/core version (match the code you have), browser, server host, player class (miner/warrior/explorer change formulas), server speeds (economy, research, fleet war/holding/peaceful, galaxies/systems, debris %), which modules are enabled and their settings, error counters of the last 10 min. If `хранилище журнала` is not `bg`/`extension IndexedDB`, the extension background did not answer (userscript, or a broken background) — events of very short page visits may be missing.
2. **SUMMARY.** "Ошибки (топ)" points at the failing module (`[S] error: <tag>` — the tag is the module name or core part, e.g. `http`, `galaxy`, `state`, `<module>:<event>`). "Сеть" shows failing endpoints (`err>0`, statuses ≠ 200) and whether the failing calls are ours (`ogx`) or the game's (`page`). "Последние алерты самообучения" tell you the server changed: a markup change (`selector-miss`, `tokens-gone/new`) or an API change (`api-key-lost/new`, `api-new`) usually explains a parser that returns nothing.
3. **Find the moment.** Search EVENTS for the first `[S] error`, `module-init-fail`, `uncaught`, `rejection`, `[N] … "st":4xx/5xx/0`, `[G] … "failed":true`, `[B] … "ok":false`, or `[L]`. Read 20-50 lines before it: the `[U]` clicks and `[B]` actions show what the user/add-on did, `[N]` what was sent (`f`) and answered (`r`), `[G]` what the game told the player.
4. **Stacks** (`d.stack`, `d.error.stack`) contain `chrome-extension://<id>/shared/core/NN-x.js:line:col` or `…/modules/<m>/<m>.js:line:col` (inject/test mode: `ogx-inject://<ext>/…`; userscript: the userscript name). Line numbers refer to the shipped file of the version in the header.
5. **Snapshots** (HTML file): each L-alert batch stores the page as it was (`reason=learn: <alert keys>`), plus manual snapshots. Compare the markup around the selector named in the alert with the fixtures in `ogx/fixtures/` and the blade views in `src/OGameX/resources/views/ingame/` to write the new selector/parser. Open a snapshot with the "показать" button or read the `<template>` text directly.
6. **Learning report**: per page the visit count, tokens that are missing right now (`пропадают сейчас`), new tokens, every selector with its hit rate (lowest first: a stable selector with `streak>0` is broken now); per endpoint the keys with frequency (`<95%` = optional key). Use it to tell "the server changed" (stable key/selector disappeared) from "our code is wrong" (selector never matched: `0% 0/12`).
7. **Fix**, then add a regression test (fixture from the snapshot, sanitized) under `ogx/tests/`.

What is deliberately absent: response bodies, typed text, tokens, cookies, e-mails. If a payload is needed to reproduce, ask John for the specific page snapshot or a fixture, not for raw logs.

## 6. Using it from modules and the bot

```js
OGX.log.rec('B', 'mybot', 'expedition:start', { slot: 3, ships: { 203: 50 } });   // any action worth seeing later
const send = OGX.log.wrap('mybot', async (req) => OGX.fleet.send(req), 'send');   // timed B event + S error with stack
OGX.learn.sel('#fleet1 .send_all');            // counted querySelector (OGX.dom.$/$$/waitFor already count)
OGX.learn.value('mybot.cargoNeeded', n, { min: 0, int: true });   // L 'implausible' when NaN/negative
OGX.learn.check('mybot.plan', planObject);      // scans numbers in an object
OGX.diag.snapshot('mybot: unexpected dialog', { force: true });
```

`ctx.log.error/warn` already land in the journal as `S error/warn`; failures inside `init` as `S module-init-fail`. Use `rec` for decisions and state transitions (they make the export readable), never for per-tick noise.
