# «Сбор» v2: one-click resource collection on GALAXYZ, plus the new-planet fixes

Status: design for one implementation pass. Base: preview 0.2.3 (df706e8). Owner: infinity/fleethelp, with small core changes.
Supersedes the collect part of DESIGN §4.2.8. The keep rules, the fleetStep2 «Все ресурсы, кроме резерва» button and the
OgameX (lanedirt) paths stay as they are unless this spec names them.

Evidence: the live journal of 2026-10-31 (`scratchpad/logs4/log-today.txt`, line numbers `L…`) and two investigations
(COLLECT and PLANETS). They are summarised in §0 and every requirement below points back to them.

---------------------------------------------------------------------------------------------------------------------

## 0. What is broken today (short)

| # | Problem | Where | Fixed in |
|---|---------|-------|----------|
| B1 | With `collectTarget` empty, the target falls back to `OGX.state.current()`. Each prefill navigates to `cp=<source>`, so the next prepare targets the previous source (L47750 → 47840 → 47929). | fleethelp.js:329-336 | §2.1 |
| B2 | `prepareNext()` starts a NEW walk when `rowsTarget`/`targetKey()` differs from `walk.target` (L47997 → L48026). | fleethelp.js:488-498 | §2.2 |
| B3 | The target `<select>` is destroyed by re-renders on every state change (3 clicks, 0 `collect:target` events, L20853-20857). | fleethelp.js:157, 362-371 | §4.1 |
| B4 | The /fleet «Транспорт для ресурсов» button logged `ships:{}` (0.2.2: prefer [203,202]). The `collectShip` setting still offers 202/203. The log has no have/need numbers. | fleethelp.js:68, 261-264, 659-678 | §5 |
| B5 | Cargo per 217 is computed (40 M × 1.5 from stored officer 607 = 60 M) and never checked against the server's `fleetroom`. `gz.fillCargo` clamps silently. 2Moons step 3 refuses cargo above the room [UPSTREAM]. | 14-state.js:491-508, 16-fleet.js:439-468 | §3 |
| B6 | Sources without 217 (the new colonies 254106/254107) are greyed with «Нет свободных транспортов» and left out of the walk with no reason logged. | fleethelp.js:309, 494 | §2.4, §6 |
| B7 | Every source costs 3 page loads and 4-6 clicks. John gave up and sent by hand from 17:43. | prefill design | §1 |
| B8 | The GZ fleetTable merge only updates the listed ship types, so a type that dropped to 0 keeps its old count and an empty fleetTable never sets `shipsT`. | 14-state.js:381-384 | §6.2 |
| B9 | Own sends never decrement ships or resources in state. | 14-state.js:669-682 | §6.3 |
| B10 | Step-3 failures come back with `message` undefined (22 spy sends, err "undefined"). | 16-fleet.js:200, 229 | §3.4 |
| B11 | A pending prefill outlives «Завершить сбор». Origin mismatches only log a warning, with no banner (L48647-48726). | fleethelp.js:422/883, 16-fleet.js:663 | §2.3 |
| B12 | The tab plans on stale or flat data and never refreshes. New planets show «Корабли неизвестны» until an imperium visit. | fleethelp.js:373-388 | §1.2, §6 |

The parsers are fine: planet discovery handles all 6 bodies (PLANETS investigation, finding 1). «приложение не видит мои новые
планеты» comes from B6, B8 and B12.

Cargo factor, an open question: the module uses 60 M per 217 everywhere. The Oct 30 `officier.html` shows 607 at `0/2`, but the
stored officers give level 1, and fleetinfo (L49272) shows 81 × 217 = 4.86 B. Nothing today proves which is right. **v2 does not
guess.** It measures `data.fleetroom` on every direct send (§3), stores the factor, and never posts more cargo than the server's room.

---------------------------------------------------------------------------------------------------------------------

## 1. User flow

### 1.1 The tab «Сбор» (side panel «OgameX Infinity», order 80)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Собрать на: [ 1992 [2:68:8]                         ▾ ]  [⟳ Обновить] │  <- static header, never rebuilt by data refresh
│ Данные: обновлено 17:38:05 (империя + 2 планеты) · слоты 6/14        │  <- status line (red when older than the limit)
│ [ Собрать всё на 1992 (5 полётов) ]                                   │  <- primary button
├──────────────────────────────────────────────────────────────────────┤
│ Источник     │ Груз М/К/Д      │ Ул. трансп.   │ Полёт / топл. │ Статус │
│ Главная [5]  │ 3.4B/1.2B/0.9B  │ 104 из 104    │ 0:12:40 / 2.1M│ ✓ 17:39│
│ Colony [6]   │ …               │ 300 из 412 ⚠  │ …             │ ✗ нет …│
│   ⚠ не хватает 112 Ул. трансп. (останется 6.7B)                      │
│ Colony [9]   │ 2.0B/…          │ 0 из 34 ✗     │ —             │ пропуск│
│   ✗ нет Ул. трансп.: нужно 34                                         │
│ …                                                         [Подготовить]│  <- manual fallback per row
├──────────────────────────────────────────────────────────────────────┤
│ Итого: М … · К … · Д … · полётов 5 · топливо …                        │
│ Порядок загрузки: [Дейтерий → Кристалл → Металл ▾]                   │
│ ▸ Резерв (что оставлять на планете)   (the existing rules block)     │
│ ▸ Пошаговый сбор (Подготовить следующий / Начать заново)             │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 «Собрать всё»: the click sequence

1. **Click** `[data-ogx-act="fleethelp:collect-all"]` → `rec('U','collect:all',{target})`. The button switches to «Обновляю данные… i/N».
2. **Refresh** (§4.3): one GET `page=imperium` (no cp). Then, only for bodies whose ships or resources are still unknown or older
   than `collectMaxAgeMin`, GET `page=fleetTable&cp=<id>` per body (`state.refreshBodies({keys, include:['fleet']})`, inside
   one `http.withPlanet`). If slots are unknown or old, add one GET `page=fleetTable` without cp (`fleet.status()`). Every request
   goes through `OGX.http` (background queue, `core.httpGapMs` gap).
3. **Plan** (§2.4) from the refreshed state. The table re-renders. `rec('B','collect:rows',…)`.
4. **Confirm dialog** (§1.3): exactly ONE dialog, always shown. It ignores `core.confirmActions`, because collect is a bulk send.
5. **OK** → `rec('U','collect:confirm',{ok:true,flights:n})` → `OGX.fleet.sendBatch(flights, …)` (§3.2). The flights are sent one
   after another through POST fleetStep1/2/3, with `httpGapMs` between flights. Each row shows ⏳ → ✓ or ✗ with a reason.
6. **Summary toast** «Сбор: отправлено 4 из 5 · груз 41,2 млрд · ошибок 1». Then `rec('B','collect:done',…)`. State is updated
   optimistically (§6.3). The rows keep their ✓/✗ until the next plan (in memory, plus `fleethelp.batch` for 30 min so a reload
   still shows them).

Cancel at step 4 → `rec('U','collect:confirm',{ok:false})`, nothing is POSTed. During step 5 the button becomes «Стоп»
(`AbortSignal`: the flight in progress finishes, no new flight starts). A `beforeunload` guard asks the user to stay while flights
are being sent.

The total is 2 clicks. No setting gates «Собрать всё»: it is a clearly labelled button with a forced confirm, which John's rule
allows.

### 1.3 Confirm dialog (`OGX.dom.modal`, width 640)

Title: «Сбор на 1992 [2:68:8]». The body is a table with one line per flight:

`Главная [2:68:5] → 1992 [2:68:8] · Ул. трансп. 104 · М 3 412 000 000 · К … · Д … · топливо 2 104 551 · 0:12:40 (прилёт 17:51:02)`

The flight's warnings follow on the same line: «не хватает 112 Ул. трансп., останется 6,7 млрд» / «данные 6 мин назад».
Under the table:
- «Не отправляются:» lists every excluded source with its reason (no 217 / nothing to take / no data / no free slot).
- Totals: cargo per resource, fuel, flights N, «Свободных слотов: F».
- If N > F, only the first F flights (largest cargo first) are in the batch, and the rest are listed «нет свободного слота».

Buttons: «Отмена» and «Отправить N полётов» (danger style). These are the only send triggers.

### 1.4 Manual fallback

«Подготовить» on each row keeps the native prefill path (`fleet.prefill.open`). «Пошаговый сбор» (collapsible) keeps
«Подготовить следующий» / «Начать заново» with the fixed walk (§2.2). Per-row «Отправить» is shown only with
`allowDirectSend`. It now goes through the same `sendBatch` path with a one-flight confirm dialog (forced, like §1.3).

---------------------------------------------------------------------------------------------------------------------

## 2. Module design (`ogamex-infinity/modules/fleethelp/fleethelp.js`)

### 2.1 Target: one source of truth

- The only source of truth is the setting `fleethelp.collectTarget` (BodyKey `p<id>` / `m<id>`). Nothing reads `OGX.state.current()`
  for the target. Delete that fallback from `targetKey()`.
- `resolveTarget(bodies)`:
  1. if `collectTarget` is set and `bodies[collectTarget]` exists, return it.
  2. if `collectTarget` is set but that body is gone (planet removed or abandoned), clear it, show the toast «Цель сбора
     удалена из списка планет — выберите новую», log `rec('B','collect:target-lost',{old})`, and fall through to 3.
  3. default: the planet with the most 217 (after keep rules). On a tie, or when no ship data exists, the first planet in
     planet-list order (the main planet). **Persist it immediately** (`settings.set('collectTarget', key)`, logged as
     `rec('B','collect:target-default',{key, why})`), so the target never drifts.
- `setTarget(key)` (select change): `rec('U','collect:target',{from,to})`, save the setting, **reset the walk**, clear the pending
  prefill (§2.3), clear the batch statuses, then re-plan. `this.rowsTarget` is removed. Every caller reads `this.target()`.
- `<select>` options: every planet, and its moon right after it (`↳ Луна [g:s:p]`). Moons can be targets (type 3).

### 2.2 Walk

- The walk record is `{ v:2, target, keys, idx, t, excluded:[{key,reason}] }`. A `v:1` record is dropped on load.
- `prepareNext()`:
  - `w = this.walk`. If it exists, `validWalk(w)` holds and `w.target === settings.collectTarget`, **continue it, whatever page
    or planet is open**. It never re-derives the target from the open page.
  - If `w.target !== collectTarget` (the target was changed in another tab), drop the walk and start a new one toward
    `collectTarget`.
  - New walk: plan → `keys` = rows with `ok` → `rec('B','walk:start',{target, keys, excluded})`, where `excluded` lists every
    other row with its reason.
- `walk:skip` keeps `{key, reason}`. The walk bar text names the target: «Сбор на 1992 [2:68:8]: источник 2 из 4».

### 2.3 Prefill hygiene (core + module)

- Core: add `OGX.fleet.prefill.clear()` (removes storage key `prefill`, `rec('B','fleet','prefill:clear',{why})`).
- Module: call it on walk stop, walk reset, target change, and at the start of `sendBatch`.
- Core `initPrefillGz` step 0: on an origin mismatch, show `banner('Флот подготовлен для «X», а открыта «Y».')` with a button
  «Перейти на X» (`OGX.page.go('/fleet', {cp: spec.originId, galaxy, system, position, type, mission})`). Keep the record
  (it still expires after 2 min). Do the same in the OgameX path. Log `rec('B','fleet','prefill:mismatch',{want, have})`.

### 2.4 Planner (pure, exported for tests)

Signature: `planCollect({ bodies, targetKey, stats, keep, order, keepDeutForFuel, speed, now, freeSlots, estimate })`
returns `{ dst, rows, flights, excluded, totals }`. `estimate` is injected (`OGX.fleet.estimate`), so a unit test can pass a stub.
Export it as `OGX.fleethelp._test.planCollect`, and export `fillByOrder` too.

For each body S ≠ target, in planet-list order (each planet followed by its moon):

```
row = { key, body, ok:false, reason:'', code:'', avail:{m,c,d}, total, have217, need217, use217, short217,
        cap217, fuel, room, cargo:{m,c,d}, load, left, duration, arrival, age, stale:boolean, rule }
```

1. **No data**: `!S.res` gives `code:'nores'`. `!S.shipsT` gives `code:'noships'`, reason «Нет данных о кораблях». After §1.2
   step 2 this happens only when the fetch failed. The row then shows the fetch error text (`state.refreshErrorText`).
2. `proj = state.projected(S)`. `avail[k] = max(0, floor(proj[k]) − keep.resources[k])`.
3. `have217 = max(0, S.ships[217] − keep.ships[217])`. `cap217 = stats[217].cargo` (measured when known, §3.3).
4. Fuel-aware count, at most 4 passes:
   ```
   n = ceil(total0 / cap217)            // total0 = Σ avail
   repeat: est = estimate({from:S.coords, to:D.coords, ships:{217:n}, mission:3, speedPct:speed})
           fuel = ceil(est.fuelBudget)
           deutAvail = max(0, avail.d − fuel)          // always on GALAXYZ: the server takes the fuel from the planet stock
           total = avail.m + avail.c + deutAvail
           n' = ceil((total + fuel) / cap217)          // GALAXYZ: room = fleetroom − consumption
           stop when n' == n
   need217 = n; use217 = min(need217, have217); short217 = need217 − use217
   ```
   If `use217 < need217`, compute fuel and room again with `use217`.
5. `room = use217 × cap217 − fuel(use217)`. `cargo = fillByOrder(avail', room, order)` with the order from `collectOrder`.
   `load = Σ cargo`, `left = total − load`.
6. Status:
   - `use217 === 0 && total > 0` → `ok:false, code:'no217'`, reason «нет Ул. трансп.: нужно {need217}».
   - `total === 0` → `ok:false, code:'empty'`, reason «Нечего забирать (всё в резерве)».
   - otherwise `ok:true`. With `short217 > 0` the warning is «не хватает {short217} Ул. трансп. (останется {fmt.short(left)})».
7. `stale = now − min(S.res.t, S.shipsT) > collectMaxAgeMin`. A stale row is red in the table and gets a warning in the dialog.

Flights = the `ok` rows sorted by `load` descending, cut to `freeSlots` when slots are known. The rows past the cut get
`code:'noslot'`. When `S.coords === D.coords` (a planet and its own moon), the distance is 5 and the flight is allowed.

**Never** another ship type: `pickCargoShips` is not used by the collect planner, and 202/203/219 are never offered.

#### keepDeuteriumForFuel and the resource order

- Setting `collectOrder` (enum): `'dcm'` «Дейтерий → Кристалл → Металл» (**default**), `'cmd'` «Кристалл → Металл → Дейтерий»,
  `'mcd'` «Металл → Кристалл → Дейтерий» (the game's own `maxResources()` order), `'prop'` «Пропорционально запасам». A select
  for it sits in the tab foot (logged `U collect:order`), and the same setting appears in the settings UI.
- `fillByOrder(avail, room, order)`: sequential fill for the three ordered modes. `'prop'` fills each resource with
  `floor(room × avail[k]/Σavail)`, then the remainder in `dcm` order, and never more than `avail[k]`.
- `keepDeuteriumForFuel` (kept, default true). On GALAXYZ the flight fuel is always taken off the deuterium that can be loaded,
  because the server rule makes this compulsory (step 4). The setting keeps its old meaning for OgameX. On GALAXYZ, ON also keeps
  on the source a reserve equal to that flight's own fuel. So a source that is emptied can still send one more fleet of the same
  size (for example the next wave after the 217 return). The hint text says this.
- Keep rules (`fleethelp.keep`) are unchanged. They act on resources and ships before anything else.

### 2.5 Settings (final list)

| key | type | default | note |
|-----|------|---------|------|
| `collectTarget` | string (hidden) | `''` | single source of truth (§2.1) |
| `collectOrder` | enum | `'dcm'` | §2.4 |
| `keepDeuteriumForFuel` | bool | true | §2.4 |
| `collectMaxAgeMin` | number 1..60 | 3 | refresh threshold (§4.3) |
| `collectSpeed` | enum 10..1 | 10 | 100 % … 10 % |
| `allowDirectSend` | bool | false | only shows per-row «Отправить» (§1.4). Hint fixed to «Отправка одного источника с подтверждением» |
| `showFleetButtons` | bool | true | unchanged |
| ~~`collectShip`~~ | removed | | 217 only. On load, delete the stored key (`ctx.settings.remove` if available, else ignore) |

---------------------------------------------------------------------------------------------------------------------

## 3. Core: direct send, room check, cargo factor (`shared/core/16-fleet.js`, `14-state.js`)

### 3.1 `gz.dispatch` with a room check before step 3

Extend `gz.step1`/`gz.step2` so that they also return what they saw:
- `step1` → `s1.room = { fleetroom: +data.fleetroom, ships: {id: amount} from data.ships }`.
- `step2` → `s2.stock = gz.stock(r.doc)` (the POST answer is a full page of the origin, so the header stock is the real stock now)
  and `s2.room = { fleetroom: +data.fleetroom, consumption: +data.consumption }`.

`gz.dispatch(req, { cp, fit })`: between step 2 and step 3, when `fit` is true (the default for `sendBatch`):
```
free  = fleetroom − consumption
deutMax = max(0, stock.deuterium − consumption − (req.keepDeut || 0))
want  = req.cargo
cargo = clamp each resource to the stock (deuterium to deutMax), then refill the room in req.order
        (the same fillByOrder; never above want[k], never above free in total)
result.fit = { asked: want, sent: cargo, clamped:[keys], free, fleetroom, consumption, stock }
```
If `free <= 0` it returns `stepFail(2,'Нет места: топливо больше вместимости')` **without** POSTing step 3. The fleetStep1/2
tokens simply expire, which is harmless.
[UPSTREAM 2Moons ShowFleetStep3Page: deuterium cargo ≤ planet deuterium − consumption; the fleet is refused when the cargo is
larger than fleetroom − consumption. Check once on the live server: the batch log shows `fit` for every flight.]

### 3.2 `OGX.fleet.sendBatch(flights, { confirmed, signal, onEach })`

- `flights`: `[{ originId, galaxy, system, position, type, mission:3, ships:{217:n}, speed, cargo, order, keepDeut, key, source }]`.
- It refuses unless `confirmed === true` (the caller has already shown its own dialog, inside a click chain). It returns
  `{ results: [...], sent, failed, aborted }`.
- It runs ONE `http.withPlanet(flights[0].originId, …)` around the batch. Every step POST names `cp: f.originId` (a lock, one
  restore GET at the end, no per-flight restore). Between flights: `await OGX.util.sleep(gapMs())`, where gapMs = `core.httpGapMs`.
- Per flight: `res = await gz.dispatch(f, { cp: f.originId, fit: true })`, then
  `OGX.bus.emit('fleet:sent', { request:f, response:res, ok:!!res.success, source:f.source, via:'batch', originId:f.originId })`,
  then `onEach(i, res)`.
- Journal (core): `OGX.log.rec('B','fleet','dispatch', { i, originId, to:'g:s:p:t', ships, cargoAsked, cargoSent, clamped, fleetroom,
  consumption, stock, ok, step, message, arrival, back, fleetId, ms })` once per flight. The network lines (`[N] req: POST
  fleetStep1/2/3`) are already journaled by `OGX.diag._ogxNet`.
- Stops early (`aborted:true`) on `signal.aborted`, on `loggedOut`/`csrf`, or on 3 failures in a row with the same message.
  The other failures are recorded and the batch goes on.
- At the end: `OGX.flights.invalidate()` once.
- `fleet.send(req)` (single) stays for spy/others. Its GZ branch now calls `gz.dispatch(req,{cp, fit:true})` too. It still confirms
  per `core.confirmActions`. The new `fleet.send(req, { confirmed:true })` skips the dialog only when a caller passes it after its
  own confirm, which collect does for per-row «Отправить».

### 3.3 Measured cargo factor

- In `gz.dispatch`, after step 1: `base = Σ n × catalog.cargo(id)` (the props cargo without officers). Then
  `factor = fleetroom / base`, when `base > 0` and `factor` is in [1, 10]. Store `OGX.storage.set('cargoMeasured',
  { factor, t, ships, fleetroom })` and log `learnValue('fleet.cargoFactor', factor, {min:1,max:10})` and
  `rec('B','fleet','cargo:measured',{factor, fleetroom, base})`. Do the same when the user's own fleetStep1 page is open
  (`initPrefill` already calls `gz.state` on step 1, so hook in there).
- `state.shipStats()` on GZ: if `cargoMeasured` exists, `cargo = round(base × factor)` for every ship, with `src:'fleetroom'`.
  This overrides the officer calc. The measurement wins until a newer officers record changes 607 (officersT > measured.t), and
  then the calc is used again until the next send. The M11 officer test (gz-core-fleet) still passes, because no measurement
  is stored there.
- The UI shows the effective cargo «Ул. трансп.: 60 000 000 (измерено 17:38)» or «… (расчёт: офицер «Кладовщик» ур. 1)» in
  the tab foot. Texts that print a fixed «40 000 000» use `stats[217].cargo`.

### 3.4 Failure messages are never empty

`stepFail(step, message, …)`: when `message` is falsy, use `failText(doc, step)`:
`infoMessage(doc)` → first `.mainRS` text (trimmed to 200 chars) → `<title>` → `'шаг ' + step + ': страница не распознана (' + size + ' байт, ' + url + ')'`.
`gz.step1` with a redirect to fleetTable (no form): if `parse.gz.fleetTable(doc).noFreeSlots`, give «нет свободных слотов
флота». Otherwise give «корабли не найдены на планете (их меньше, чем запрошено?)». Keep `url` and `status` on the result.
This also fixes the spy raid errors that read «undefined» (B10).

---------------------------------------------------------------------------------------------------------------------

## 4. Tab rendering, refresh and data age

### 4.1 Render split (B3)

- `render(container)` builds the static skeleton **once per tab open**: the header (select, ⟳, status line, main button), a
  `div.rows` table body host, the foot and the rules. A later `refreshTab()` only calls `renderRows()`, which replaces the
  contents of `tbody` and the totals.
- When the select's option set changes (a planet was added or removed), it is rebuilt **only if `document.activeElement !== sel`**.
  Otherwise the rebuild waits for `blur`.
- Log `U collect:target-open` on `focus`/`mousedown` of the select (to tell "dropdown closed by refresh" apart from "same
  option chosen").

### 4.2 Row DOM contract (tests rely on it)

`tr[data-key][data-code][data-status]` with these cells:
- `.…-src`: name and coordinates, plus «данные: N мин назад» (`.…-stale` when stale).
- `.…-cargo[data-metal|crystal|deuterium|total]`
- `.…-t217[data-have|need|use|short]`: text «104 из 104», or «300 из 412» with the warning, or «0 из 34».
- `.…-flight[data-duration|fuel]`
- `.…-status`: «⏳», «✓ 17:39:20 → прилёт 17:51», «✗ <message>» or «пропуск: <reason>».
- `.…-acts`: «Подготовить» and optionally «Отправить».
- Warning line `tr.…-warn` under the row: «не хватает K Ул. трансп. (останется X)» / «нет Ул. трансп.: нужно M».
- Main button: `[data-ogx-act="fleethelp:collect-all"]` with `data-flights=N`.

### 4.3 Refresh policy (B12, new planets)

`ensureFresh({ reason, force })`:
1. `bodies = state.bodies()`. `oldest = min over bodies of min(res.t, shipsT)` (a null value counts as 0).
2. If `force` or `oldest` is older than `collectMaxAgeMin`, or any body has `res === null`/`shipsT === null`:
   `state.refreshBodies({ include:['empire'] })`. That is one GET `page=imperium` with no cp switch. Its page carries the
   planet selector too, so `state.merge` adds and removes bodies (14-state.js:150-174). The body list therefore always follows
   the live planet list.
3. Bodies still missing data, or moons the imperium does not list: `state.refreshBodies({ keys: missing, include:['fleet'] })`
   (GET fleetTable with cp per body, one `withPlanet`, needs `core.cpConfirmed`. Without it, the row says «нет данных — откройте
   планету» and the status line says so).
4. Slots: when `state.slots()` is null or older than `collectMaxAgeMin`, call `fleet.status({ background:true })` (one GET,
   no cp) and save its slots.
5. `rec('B','collect:refresh',{reason, imperium:{ok,ms}, perBody:[keys], slots, errors, ms})`. The errors use
   `state.refreshErrorText` on the status line.

When it runs:
- **on tab open** (the tab's render hook), at most once per `collectMaxAgeMin`, steps 1-3 only, `reason:'open'`.
- **on «Собрать всё»**, always steps 1-4, `reason:'collect'`. `force` is true when the newest data is older than 60 s.
- **⟳ Обновить**: `force:true`, `reason:'manual'`.
- Never on a timer and never from `state.onChange`.

On tab open this is a read-only GET (like the empire module's refresh), so it is allowed without a click. It goes through the
polite background queue.

### 4.4 Data used by the rows

`state.projected(b)` for amounts. Bodies with `res.src === 'imperium'` (perHour null) are fine right after step 2 because
`res.t` is fresh. `fleet.estimate` handles flight time and fuel (GZ math, `gz.dataFor`).

---------------------------------------------------------------------------------------------------------------------

## 5. /fleet page «Транспорт для ресурсов» (B4)

`selectTransport()` on GZ fleetTable:
- `have217 = shipsOnPage()[217] − keep.ships[217]`, `cap = stats[217].cargo` (measured if known).
- Target for fuel: the fleetTable hidden target fields (prefill/GET) if set. Otherwise `collectTarget` if it is not this
  body. Otherwise no fuel, and the status says «без учёта топлива».
- Count: the same fuel-aware loop as §2.4 step 4 (shared helper `count217(total, cap, fuelFn)`).
- Selects `{217: min(need, have217)}` through `wSelect` and never any other type. It resets 202/203/219 inputs to 0
  (`fillShips` with `reset:true`).
- Status text: «Ул. трансп.: есть 547, нужно 612, не хватает 65 — выбрано 547 (вместимость 32,8 млрд для 36,7 млрд)», or
  «Ул. трансп.: выбрано 104 из 547 (хватает)». With 0 there: «Ул. трансп.: нет на планете, нужно 34».
- Journal `rec('U','fleet:transport',{key, total, have217, need217, use217, short217, cap, fuel, ships})`.

---------------------------------------------------------------------------------------------------------------------

## 6. New planets and ship state (core `14-state.js`)

### 6.1 Body list = live planet selector

This already works through `state.merge` (planets from `#planetSelector`/`.smallplanet`, deletion of the others). v2 adds:
- the imperium refresh on tab open and before planning (§4.3), so a colony founded in another tab appears without visiting it;
- `resolveTarget` handles a removed target (§2.1). A keep rule for a removed body is kept but hidden. The walk drops keys
  that are no longer bodies (`walk:skip reason 'removed'`).
- Regression test with 6 columns in a non-list order (§8, test 7).

### 6.2 fleetTable merge replaces the whole fleet (B8)

In `mergeCurrentBody` for `s.engine==='galaxyz'`: when the fleetTable form exists (`ft.prefill !== null`), or the page shows
the no-ships `#warning` (add `noShips:boolean` to `parse.gz.fleetTable`), and `newer(T, b.shipsT)`:
```
ships = {}; for (id of catalog.fleetShipIds) ships[id] = 0;
if (b.ships[212] !== undefined) ships[212] = b.ships[212];        // satellites: no input, keep the stored count unless listed
for (sh of ft.ships) if (sh.id) ships[sh.id] = sh.count || 0;     // listed rows (212 included when shown)
b.ships = ships; b.shipsT = T;                                     // also when ft.ships is empty
```

### 6.3 Optimistic update after own sends (B9)

`state.applySent({ originId, ships, cargo, consumption })` (core, single writer): subtract the ships, floored at 0. Subtract
`cargo` and `consumption` (deuterium) from `res`, keeping `res.t`. Also bump `slots.used` by 1. Then emit
`state:updated ['bodies','slots']`.
- Called by `sendBatch` per successful flight (using `res.result.ships` from step 3 when parsed, else the request) and by
  `fleet.send` on success.
- Called for the game's own fleetStep3 page (`initGameSendGz`) when the origin coords map to a body.
- Does not touch `shipsT` (the next real page or imperium read still wins via `newer`).

---------------------------------------------------------------------------------------------------------------------

## 7. Journal (complete list of new and changed events)

| src | name | data |
|-----|------|------|
| U | collect:all | {target} |
| U | collect:target / collect:target-open | {from,to} / {} |
| B | collect:target-default / collect:target-lost | {key,why} / {old} |
| B | collect:refresh | {reason, imperium:{ok,ms}, perBody, slots, errors, ms} |
| B | collect:rows | {target, rows:[{key,code,ok,have217,need217,use217,short217,load,fuel,duration,stale}]} |
| U | collect:confirm | {ok, flights, excluded} |
| B | collect:send | {i, key, ok, step, message, cargoAsked, cargoSent, clamped, room, arrival, fleetId} |
| B | collect:done | {sent, failed, skipped, aborted, cargo, fuel, ms} |
| U | collect:stop / collect:order | {} / {order} |
| B | walk:start / walk:skip | {target, keys, excluded:[{key,reason}]} / {key, reason} |
| U | fleet:transport | §5 |
| B (core) | fleet dispatch / cargo:measured / prefill:clear / prefill:mismatch | §3.2, §3.3, §2.3 |

The «request + result» of each send is `fleet dispatch` (core) plus `collect:send` (module). The raw POST bodies are already
in `[N]` lines.

---------------------------------------------------------------------------------------------------------------------

## 8. Tests

Sync after every core or module edit: `bash tests/sync.sh`. Run one file at a time: `node tests/gz-mod-inf-fleet.test.js`,
`node tests/gz-core-fleet.test.js`, `node tests/gz-core.test.js`. Run the full suite at the end (`node tests/run-all.js`, ~15 min,
in the background).

### 8.1 Mock server (`tests/gz-server.js`): what exists and what to add

Already there: POST fleetStep1 (token, ships, target; no ships → 302 fleetTable), POST fleetStep2 (missions from
`state.missions`), POST fleetStep3 (`state.fleetError` → info page, `state.sent[]` records), GET imperium/fleetTable saved
pages, `srv.route` overrides, `state.cp` sticky. Add:

1. **Origin on sent records**: in the fleetStep1 POST, store `st.fleet.origin = st.cp` (the cp the request named, or the sticky one).
   Push `origin` into `st.sent[]`.
2. **Computed inline data** (`state.cargoPerShip = {217: 60000000}`, optional `state.consumption` number): when set, rewrite
   `data = {...}` in fleetStep1 (fleetroom = Σ n × cargo, ships amounts = the posted counts) and in fleetStep2
   (`{"fleetroom":…, "consumption":…}`, and the `#consumption` text). When unset, keep today's saved page (7500/118).
3. **Room rule on step 3** (`state.enforceRoom = true`): cargo sum > fleetroom − consumption → `info('Not enough cargo space')`
   and no `sent` record [UPSTREAM shape].
4. **Ships per planet** (`state.bodyShips = { 254102: {217: 104}, … }`): fleetTable for `cp` renders those rows (generalises
   the test's `withCargo`). Step 1 with more than the planet holds → 302 fleetTable (2Moons GotoFleetPage).
5. **Per-call failure**: `state.fleetErrorAt = { 2: 'text' }` (failure on the n-th step-3 POST, 1-based), so a batch test can
   fail exactly one flight.
6. **Planet list helper** `withPlanets(srv, list)` (in `tests/gz-lib.js` or the test): a transform used by `sendPage` for every
   page that rewrites `#planetSelector` options and `#planetList .smallplanet` from `list = [{id,name,coords,moon?}]`, and
   `imperium.html` columns (clone the last column's cells with the new cp/name/coords, including a zero-everything new colony,
   in a shuffled order).

### 8.2 `tests/gz-mod-inf-fleet.test.js`

Update the existing «Сбор» test (L329): the tab now asks for one GET `page=imperium` on open when data is stale. Seed fresh
state, or assert `ownRequests` = `['GET page=imperium']` exactly. Keep its walk assertions (fleetTable → step 1 → step 2,
never submitted).

New tests:

1. **Target is sticky (B1/B2/B3)**: target p254105 is chosen through the select → setting saved, `U collect:target` journaled.
   «Подготовить следующий» → fleetTable `cp=254102&…&planet=8`. On that page the walk-bar next → the URL still has `planet=8`,
   and `walk.target === 'p254105'`. Change the target in the tab → the walk is cleared and `prefill` storage is empty. Fire
   `state:updated` while the select has focus → the select element is the same node (no rebuild).
2. **Собрать всё, happy path**: `bodyShips` for 3 sources, `cargoPerShip {217:60e6}`, `enforceRoom`, `missions [3,4]`,
   `core.httpGapMs 150`. Click → requests start with `GET page=imperium`. The dialog lists 3 flights and the excluded sources.
   **Cancel → zero POSTs.** Click again → OK → `POST fleetStep1,2,3 × 3` in order. Each POST has `cp=<origin>`. `sent[i].origin`
   matches. `ships = {217:n}` and only 217. Mission 3, target `2:68:8 type 1`. The cargo sum is ≤ room and the cargo is filled
   D → C → M. Time between flight i step 3 and flight i+1 step 1 ≥ 150 ms. One `GET overview` restore at the end. Rows have
   `data-status="sent"` with arrival times, and the toast says «отправлено 3 из 3». Journal: 3× `collect:send ok` and 1×
   `collect:done`. State: the origin's 217 count decreased.
3. **Room clamp and measured factor**: `cargoPerShip {217:40e6}` while the stored officer gives 60 M → the plan asks for more,
   `fit.clamped` is non-empty, the posted cargo is ≤ room, and step 3 is accepted. After the batch, `shipStats()[217]` has
   `cargo 40e6` and `src 'fleetroom'`. Re-plan → `need217` uses 40 M.
4. **One failure, no "undefined"**: `fleetErrorAt {2:'Fleet slots full'}` → row 2 `✗ Fleet slots full`, rows 1 and 3 ✓,
   `collect:done {sent:2, failed:1}`. A garbage step-3 page (route override returning `<html><title>X</title>`) → message «X», not
   empty.
5. **Too few 217**: a source with 0×217 and resources → row `data-code="no217"` with the text «нет Ул. трансп.: нужно M»,
   excluded from the dialog and listed under «Не отправляются». A source with fewer 217 than needed → `data-short` > 0, the
   warning line is present, and the flight is sent with `use217`.
6. **No other ship types**: fleetTable with 202/203/219 rows and 217 present → the dialog flights and the POSTs carry only
   `ship217`. With 217 absent and 202/203 present → no flight from that body (`no217`).
7. **New and removed planets**: start with state for 4 bodies, then serve 6 planets via `withPlanets` (254106 Colony
   [2:68:9], 254107 Планета [2:68:4], imperium columns shuffled, one all-zero) → opening the tab triggers one imperium GET,
   and rows appear for p254106/p254107 with data (no «нет данных»). Serve the list without 254104 → that row disappears. With
   `collectTarget = 'p254104'`, the target falls back to the default and the toast shows.
8. **Moon target and source**: `withPlanets` gives 254105 a moon `m254200`. The target option `↳ …` → the step-1 POST has
   `type=3`. A moon as source → step POSTs with `cp=254200`.
9. **/fleet transport button**: on fleetTable with 217 = 30 (`withCargo`), the status contains «Ул. трансп.:», «есть 30» and
   «нужно», `ship217` is filled, 202/203 are 0. The journal has `fleet:transport` with `have217`. Without 217 → «нет на
   планете», nothing selected.
10. **Prefill hygiene**: prepare a walk prefill, then «Завершить сбор» → `OGX.storage.get('prefill')` is null. Open the fleetTable
    of another cp with a fresh prefill → the banner «Флот подготовлен для …» with the button «Перейти».
11. **No send without a click**: load the tab and wait 3 s → no POST at all, and the only GETs are imperium (+ fleetTable per
    missing body).

### 8.3 Core tests

- `gz-core-fleet.test.js`: `gz.dispatch(fit)` clamps to room and stock (unit, mocked step docs). `stepFail` fallback text.
  `sendBatch` refuses without `confirmed`. `cargoMeasured` is used by `shipStats` and dropped after newer officers. M11 unchanged.
- `gz-core.test.js` (or `gz-core-fixes`): fleetTable merge sets missing ship types to 0 and sets `shipsT` on an empty fleetTable
  (fixture: saved fleetTable with all ship rows removed plus `#warning`). `applySent` decrements ships, resources and slots.
- `gz-mod-inf-empire.test.js`: unchanged, but run it (imperium merge path).

---------------------------------------------------------------------------------------------------------------------

## 9. Implementation order (one pass)

1. Core 16-fleet: `stepFail` text, `step1/2` room and stock, `dispatch({fit})`, `sendBatch`, `prefill.clear`, mismatch banner,
   `cargoMeasured`. Core 14-state: fleetTable merge, `applySent`, `shipStats` measured. 11-parse: `fleetTable.noShips`.
2. fleethelp: settings, `resolveTarget`, the walk v2, the pure `planCollect` + `fillByOrder` + `count217`, render split,
   `ensureFresh`, «Собрать всё» + dialog + batch statuses, `selectTransport` rewrite, the journal events.
3. Mock server additions and `withPlanets`, then the tests in §8, then `bash tests/sync.sh`, the single files, and the full suite.
4. Update the DESIGN §4.2.8 header comment of fleethelp.js and `specs/CORE_API.md` (sendBatch, prefill.clear, applySent,
   cargoMeasured, dispatch fit). Bump the preview version.

## 10. Out of scope (reported only)

- «Подвезти транспорты» (deploy 217 from a hub to empty colonies) and multi-wave planning after the 217 return. v2 only reports
  `no217` / `short217` precisely.
- Spy (spy.js): the raid origin is always the open planet, and `|| d.n` asks for phantom ships when 0 are there (spy.js:567).
  Raid loot should use the BASE cargo (2Moons attack loot ignores officers [UPSTREAM]). These get their own fix. v2's
  `stepFail` text already fixes spy's «undefined» errors.
- OgameX (lanedirt) collect: unchanged apart from the shared planner helpers (`fillByOrder` honours `collectOrder` there too).
