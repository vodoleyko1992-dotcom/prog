# OgameX in-game layout: spec for content scripts

Scope: the layout that every logged-in OgameX page shares (`resources/views/ingame/layouts/main.blade.php`, 2025 lines). It covers page detection, the planet list, the current planet and `?cp=`, the resource bar and how it ticks, server time, CSRF, player data, the left menu, JS globals, the URL map and `GET /ajax/resources`.

Paths below are relative to the OgameX checkout `src/OGameX/`.
- `main` = `resources/views/ingame/layouts/main.blade.php`
- `bundle` = `resources/js/ingame/e7c74974620fa35b197315ebdbb8c2.js`. Vite concatenates it into `/build/assets/ingame-<hash>.js` (see `vite.config.js:7-26`).
- `composer` = `app/Http/ViewComposers/IngameMainComposer.php`

Fixtures (in `ogx/fixtures/`) were rendered from the real Blade templates by `ogx/tools/blade/gen_layout_fixtures.php`. That script is a small Blade compiler plus stubbed services; the sample data is made up, but every piece of markup comes from the templates.

| Fixture | What it is |
|---|---|
| `layout-overview-planet.html` | Full `/overview?cp=1` page with 2 planets and 1 moon. The current planet is Homeworld (id 1), class Collector, normal (non-compact) planet bar. |
| `layout-overview-moon.html` | The same account on `/overview?cp=5`. The current body is the moon (id 5), the Jump Gate menu icon is active, and moon resources exceed storage. |
| `layout-overview-compact.html` | 6 planets, which triggers the compact planet bar (`#cutty`/`#myPlanets`, `.smaller`). The current planet is Colony (id 3); there is a downgrade wrench on id 6. |
| `layout-ajax-resources-technology-1.json` | Exact body of `GET /ajax/resources?technology=1` (Metal Mine 12→13). |
| `layout-overlay-server-settings.html` | Exact body of `GET /overlay/server-settings` (HTML fragment, no layout). |
| `layout-expected-parse.json` | What the recipes below return on the three page fixtures. `ogx/tools/check_layout.js` checks this with Playwright. |

All fixture URLs use the origin `http://localhost` (Laravel `route()`/`asset()` emit absolute URLs, see 9.1). A mock server can do a string replace on `http://localhost`. The page JS bundle (`/build/assets/ingame-*.js`) is not part of the fixtures, so inline scripts throw `ReferenceError: $ is not defined` when opened stand-alone. That is expected: content scripts must not depend on game JS anyway.

---

## 1. Detecting an OgameX in-game page

OgameX is self-hosted on an unknown origin, so manifests must match broadly (`http://*/*`, `https://*/*`, or user-granted optional host permissions). The decision is made at runtime. Markers, from strongest to weakest:

| # | Marker | Selector / test | Source |
|---|---|---|---|
| 1 | Head HTML comment with the ASCII logo and "Powered by OGameX", "GitHub: https://github.com/lanedirt/OGameX", "Version: …" | `[...document.head.childNodes].some(n => n.nodeType === 8 && /OGameX/.test(n.data))` | main:6-21 |
| 2 | Footer link to the repo | `#siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i]` | main:1894 |
| 3 | Laravel CSRF meta (official OGame has none) | `meta[name="csrf-token"]` | main:23 |
| 4 | OGame-style metas, some hard-coded | `meta[name="ogame-version"]`, `meta[name="ogame-session"][content="3c442273a6de4c8f79549e78f4c3ca50e7ea7580"]` (constant), `meta[name="ogame-timestamp"][content="1513426692"]` (constant) | main:27-46 |
| 5 | In-game layout skeleton | `body.ogame #pageContent #planetList` | main:113, 126, 1729 |
| 6 | Clean Laravel paths, no `index.php?page=` | `location.pathname` is one of section 10 | routes/web.php |

Recipe:

```js
function isOgxIngame(doc = document) {
  const meta = n => doc.querySelector(`meta[name="${n}"]`);
  if (!meta('csrf-token') || !meta('ogame-version')) return false;
  if (!doc.querySelector('#planetList')) return false;           // logged-in layout only
  const comment = [...doc.head.childNodes].some(n => n.nodeType === 8 && /OGameX/.test(n.data));
  const footer = !!doc.querySelector('#siteFooter a.homeLink[href*="github.com/lanedirt/ogamex" i]');
  return comment || footer;
}
```

- Never run on `*.ogame.gameforge.com`. Official pages have no `csrf-token` meta, so the check above already rejects them; add a hostname guard as a second safety net.
- The out-game (login) layout (`resources/views/outgame/layouts/main.blade.php`) has no `#planetList`, so the check returns `false` there.
- Admin pages (`/admin/*`) also use the in-game layout and pass the check. Exclude them by path if needed.
- `isOgxIngame` works at `document_end`. At `document_start` only the `<head>` exists, so wait for `DOMContentLoaded`.

## 2. Page identification

- **Use `location.pathname`**, mapped through the table in section 10.
- `body#id` is set only by some controllers; every other page keeps the default `ingamepage` (main:113). The `setBodyId` calls are in `app/Http/Controllers/*` and give: overview `overview`, resources `resources`, resources/settings `resourceSettings`, facilities `station`, research `research`, shipyard `shipyard`, defense `defense`, messages `messages`, merchant `traderOverview`, alliance `alliance`, buddies `buddies`, highscore `highscore`, options `preferences`, premium `premium`, shop `shop`, characterclass `characterclassselection`, chat `chat`. **Fleet (`/fleet`, `/fleet/movement`), galaxy, rewards and admin pages all have `body#ingamepage`.** Official OGame uses `fleetdispatch`, `galaxy`, etc.
- `var currentPage = "overview";` is hard-coded on every page (main:831). Do not use it.
- Body classes are always `ogame lang-en default no-touch` (main:113), even when the language is not English.

## 3. Head metas (main:23-46)

| Meta | Value | Notes |
|---|---|---|
| `csrf-token` | Laravel session CSRF token (40 chars) | **Use this.** See section 7. |
| `ogame-session` | `3c442273a6de4c8f79549e78f4c3ca50e7ea7580` | Hard-coded constant. |
| `ogame-version` | `GitInfoUtil::getAppVersion()`, e.g. `0.14.0` | |
| `ogame-timestamp` | `1513426692` | **Hard-coded (2017). Not the server time.** |
| `ogame-universe` / `ogame-universe-name` | `s1` / `Home` | Hard-coded. The real universe name is in `/overlay/server-settings` (section 11). |
| `ogame-universe-speed` | `SettingsService::economySpeed()` (int) | Economy speed. |
| `ogame-universe-speed-fleet` | `SettingsService::fleetSpeed()` (setting `fleet_speed`) | OgameX also has separate **war/holding/peaceful** fleet speeds that are not in any meta; read them from `/overlay/server-settings`. |
| `ogame-language` | `en` | Hard-coded; the real locale is `<html lang>` (main:4). |
| `ogame-donut-galaxy` / `ogame-donut-system` | `1` / `1` | Hard-coded. |
| `ogame-player-id` | user id (int) | Reliable. |
| `ogame-player-name` | raw username (`getUsername(false)`, HTML-escaped) | Reliable. |
| `ogame-alliance-id`/`-name`/`-tag` | always empty | Hard-coded empty. |
| `ogame-planet-id` | current planet **or moon** id | Reliable. |
| `ogame-planet-name` | current planet or moon name | Reliable. |
| `ogame-planet-coordinates` | `g:s:p` of the current body | Reliable. |
| `ogame-planet-type` | always `planet` | **Hard-coded, wrong on moons.** Detect a moon as in 4.3. |

## 4. Planet list (main:1713-1858)

### 4.1 Structure

```
#right > #planetbarcomponent > #rechts
  > div#norm  > div#myWorlds        (fewer than 6 planets)
    div#cutty > div#myPlanets       (6 or more planets: $useCompactLayout = planetCount() >= 6, main:1720)
    > #countColonies > p.textCenter > span      "2/8" = planetCount / getMaxPlanetAmount (main:1726)
    > #planetList
      > div.smallplanet[.smaller][.hightlightPlanet]  data-planet-id="<planetId>"  id="planet-<N>"   (main:1737-1738)
          > a.planetlink[.active]  href=data-link=<current URL with cp=<planetId>>  title="<tooltip HTML>"   (main:1739-1753)
              > img.planetPic   (normal: width 48; compact: inside .planetBarSpaceObjectContainer, id="planetBarSpaceObjectImg_<planetId>", width 30)
              > span.planet-name    planet name (raw {!! !!})
              > span.planet-koords  "[g:s:p]"
          > a.constructionIcon  (only if the planet's building queue is non-empty, main:1774-1785)
              > span.icon12px.icon_wrench   (upgrading) | span.icon12px.icon_wrench_red (current item is a downgrade)
          > a.moonlink[.active]  href=data-link=<current URL with cp=<moonId>>  data-jumpgatelevel="0"  title="<tooltip HTML>"   (main:1793-1820)
              > img.icon-moon src="/img/moons/small/<1-5>.gif"   (compact: id="planetBarSpaceObjectImg_<moonId>")
          > a.wreckFieldIcon > span.icon.icon_wreck_field   (only if own active/blocked wreck field and Space Dock > 0, main:1839-1851)
```

**Differences from official OGame that break OGame Live / OGLight code:**

1. `div.smallplanet` **id is `planet-<1-based index>`, not `planet-<planetId>`**. The planet id is only in `data-planet-id`. OGame Live's `//div[contains(@id,"planetList")]/div/@id` returns `planet-1`, `planet-2`, …. Also, `contains(@id,"planet-1")` matches `planet-10`.
2. There is **no `hightlightMoon`** class. When the current body is a moon, no `.smallplanet` is highlighted; only `a.moonlink.active` marks it (main:1793). OGame Live's `getCurrentPlanetId()` fails on moons.
3. `hightlightPlanet` / `active` are added **only when the account has more than 1 body** (`allCount() > 1`, main:1737/1753/1793). With a single planet nothing is highlighted, so use `meta[name="ogame-planet-id"]`.
4. **The moon id appears only in the moonlink URL** (`cp=<moonId>`), and in `#planetBarSpaceObjectImg_<moonId>` in compact mode. Moon name, diameter and fields are only in the moonlink `title`.
5. **No constructionIcon is ever shown for moons.** Official OGame adds `.constructionIcon.moon`.
6. Planet order is database order (`Planet::where('user_id')` without `orderBy`, `app/Services/PlanetListService.php:43-54`), i.e. by creation id. There is no user sorting.
7. Planet diameter, used/max fields and temperature are only in the planetlink `title`. Official OGame has the same data in the tooltip, but formatted `12,800km (95/163)` here: thousands separator is always `,`, and fields are `getBuildingCount()/getPlanetFieldMax()`.

### 4.2 Tooltip formats (raw `title` attribute, before Tipped runs)

Planet (main:1741-1752):

```
<b>Homeworld [1:42:8]</b><br/>
    12,800km (95/163)<br>
    12 to 52°C<br/>
    <a href="http://host/overview?cp=1">Overview</a><br/> … Resources, Research, Facilities, Shipyard, Defense, Fleet, Galaxy
```

Moon (main:1794-1801):

```
<b>Moon [1:42:8]</b><br>
    8,660km (4/7)<br/>
    <a href="…?cp=5">Overview</a><br/> … Resources, Facilities, Defense, Fleet, Galaxy
```

Link labels are localized (`t_ingame.layout.menu_*`). Do not match on them.

**Tooltips are destroyed by the game JS.** `initTooltips()` → `Tipped.create()` moves `title` into jQuery data and sets `title=""` (bundle:13048-13060, 14191). jQuery `.data()` lives in the page JS world and cannot be read from an isolated content script. Read `title` at `document_end`, before `$(document).ready`; the layout delays ready with `$.holdReady(true)` (main:101-108). As a fallback, re-fetch the page HTML (`fetch(location.href)`) and parse it with `DOMParser`. The same applies to `#metal_box` and the other resource tooltips (section 5).

### 4.3 Parsing recipe (verified on all 3 fixtures)

```js
function parsePlanetList(doc = document, base = location.href) {
  return [...doc.querySelectorAll('#planetList > .smallplanet')].map(el => {
    const a = el.querySelector('a.planetlink');
    const t = a.getAttribute('title') || '';
    const f = t.match(/([\d,.]+)km \((\d+)\/(\d+)\)/);          // diameter, used, max
    const temp = t.match(/(-?\d+) to (-?\d+)°C/);                 // "to" is localized; use /(-?\d+)\D+(-?\d+)°C/ to be safe
    const m = el.querySelector('a.moonlink');
    const mt = m ? m.getAttribute('title') || '' : '';
    const mf = mt.match(/([\d,.]+)km \((\d+)\/(\d+)\)/);
    return {
      id: +el.dataset.planetId,
      name: el.querySelector('.planet-name').textContent.trim(),
      coords: el.querySelector('.planet-koords').textContent.trim().replace(/[[\]]/g, ''), // "1:42:8"
      diameter: f ? +f[1].replace(/\D/g, '') : null,
      fieldsUsed: f ? +f[2] : null, fieldsMax: f ? +f[3] : null,
      tempMin: temp ? +temp[1] : null, tempMax: temp ? +temp[2] : null,
      building: !!el.querySelector('a.constructionIcon'),
      downgrading: !!el.querySelector('a.constructionIcon .icon_wrench_red'),
      isCurrent: a.classList.contains('active'),
      moon: m ? {
        id: +new URL(m.getAttribute('href'), base).searchParams.get('cp'),
        name: (mt.match(/<b>(.*?) \[/) || [])[1] ?? null,
        diameter: mf ? +mf[1].replace(/\D/g, '') : null,
        fieldsUsed: mf ? +mf[2] : null, fieldsMax: mf ? +mf[3] : null,
        isCurrent: m.classList.contains('active'),
      } : null,
    };
  });
}

function currentBody(doc = document) {
  const id = +doc.querySelector('meta[name="ogame-planet-id"]').content;
  const moonLink = [...doc.querySelectorAll('#planetList a.moonlink')]
    .find(a => +new URL(a.href, location.href).searchParams.get('cp') === id);
  return { id, isMoon: !!moonLink,
           coords: doc.querySelector('meta[name="ogame-planet-coordinates"]').content,
           name: doc.querySelector('meta[name="ogame-planet-name"]').content };
}
```

Injection points: add per-planet widgets as a child of `.smallplanet` (as OGame Live does) and add totals at the end of `#planetList`. In compact mode each row is 33px high, so mind the CSS (`.smallplanet.smaller`).

## 5. Current planet and `?cp=` switching

- `app/Http/Middleware/GlobalGame.php:43-46`: on **every** request in the `auth` group (pages **and** `/ajax/*`), if `cp` is in the query string, `PlayerService::setCurrentPlanetId((int)cp)` runs. That method (`app/Services/PlayerService.php:519-531`) **persists** `users.planet_current` when the body is owned by the player (planet or moon); `cp=0` resets it to the first planet. Unknown or foreign ids are silently ignored.
- The current planet is therefore **server-side state that survives across tabs**. A background `fetch('/fleet?cp=3')` also switches the planet for the user's other tabs and later requests. When you collect data by AJAX with `cp`, restore the original afterwards with one more request using `?cp=<original>`.
- Only the **current** planet's resources are recalculated on each request (`$player->planets->current()->update()`, GlobalGame:58). Other planets are updated lazily, e.g. when they become current or a fleet arrives.
- Planet-list links keep all current query params and replace `cp` (main:1733-1735, `http_build_query`). Example: on `/galaxy?galaxy=1&system=42` the link becomes `/galaxy?galaxy=1&system=42&cp=3`.
- When no `planet_current` is set, the first planet is current (`PlanetListService::current()`, lines 134-159).

## 6. Resource bar

### 6.1 DOM (main:190-278)

```
#resourcesbarcomponent > #resources
  > .resource_tile.metal     > #metal_box.metal.tooltipHTML.resource[title="Metal|<table class=&quot;resourceTooltip&quot;>…"][data-shop-url][data-ipi-hint="ipiResourcemetal"]
        > .resourceIcon.metal
        > span.value > span#resources_metal[data-raw="<float>"][class="" | "middlemark" | "overmark"]  text = amount_formatted
  > .resource_tile.crystal   > #crystal_box   … span#resources_crystal
  > .resource_tile.deuterium > #deuterium_box … span#resources_deuterium
  > .resource_tile.energy    > #energy_box    … span#resources_energy[data-raw][class="" | "overmark" when < 0]
  > (population / food tiles are inside an HTML comment, main:243-263, so they are NOT in the DOM)
  > .resource_tile.darkmatter > #darkmatter_box … a.overlay[href="#TODO_page=payment"] + span#resources_darkmatter.overlay[data-raw="<int>"]
```

Server-side values (`composer:57-100`):

| Field | Source | Format |
|---|---|---|
| `data-raw` (M/C/D) | `planet->metal()->get()` | **PHP float** printed with precision 14, e.g. `152347.29861111`. Columns are `double` (migration `2026_01_20_000001_change_resource_columns_to_double.php`). |
| text (M/C/D/energy) | `getFormattedLong()` → `AppUtil::formatNumberLong` | below 1M: `152,347` (truncated, `,` thousands); 1M or more: `1.234Mn` / `2Mn` |
| storage | `metalStorage()->get()` | float |
| production/hour | `planets.metal_production` (int column) | |
| production/second | production_hour / 3600 | float |
| energy amount | `energy_max - energy_used` (may be negative) | |
| dark matter | `users.dark_matter` (int) | text via `AppUtil::formatNumber` → `8,000` |

CSS classes on `#resources_<res>`: `middlemark` when 90% ≤ amount < storage, `overmark` when amount ≥ storage (main:201). The ticker uses the same rule (bundle `getStorageClass`).

### 6.2 Head tooltip vs ticker tooltip

The `title` attribute in the HTML (main:195) has **unformatted** production: `+4128`. The span class is always `undermark` and the "+" is always present, even on moons with 0 production. The first `reloadResources()` call then replaces the title with the JSON `tooltip`, which has formatted production (`+4,128`), class `undermark` or ` overmark ` (**with surrounding spaces**), no `+` for 0, and `overermark` (sic) on "Den Capacity" (main:1392). Tooltip row order: Available, Storage capacity, Current production, Den Capacity (always 0). Energy: Available, Current production, Consumption. Row labels are localized.

**Prefer the inline `reloadResources({...})` data (6.3) over tooltips.**

### 6.3 Client-side ticking: inline data, `ResourceTicker`

Inline in every page (main:1363-1432) the server emits:

```js
reloadResources({
    "resources": {
        // "population": {...}, "food": {...}   (commented out)
        "metal": {
            "amount": 152347.29861111,          // float, server snapshot at render time
            "storage": 255000,
            "baseProduction": 0, // TODO: add base production separately?
            "production": 1.1466666666667,      // PER SECOND
            "tooltip": "Metal|<table class=\"resourceTooltip\">…",
            "classesListItem": "",
            "shopUrl": "#TODO_…"
        },
        "crystal": {…same…}, "deuterium": {…same…},
        "energy": {"amount": 106, "tooltip": "…", "classesListItem": ""},
        "darkmatter": {"amount": 8000, "tooltip": "…", "classesListItem": "", "classes": "overlay", "link": "#TODO_page=payment", "img": "/img/icons/401d1a91ff40dc7c8acfa4377d3d65.gif"}
    },
    "techs": {
        // TODO: add tech levels as far as they are available
    },
    "honorScore": 11,
});
```

**This is not valid JSON**: it has `//` comments and trailing commas. Recipe (verified):

```js
function parseInlineResources(doc = document) {
  const src = [...doc.scripts].map(s => s.textContent).find(t => t.includes('reloadResources({')) || '';
  const num = '(-?[\\d.]+(?:[eE][-+]?\\d+)?)';
  const out = {};
  for (const k of ['metal', 'crystal', 'deuterium']) {
    const m = src.match(new RegExp(`"${k}":\\s*\\{\\s*"amount":\\s*${num},\\s*"storage":\\s*${num},[\\s\\S]*?"production":\\s*${num}`));
    if (m) out[k] = { amount: +m[1], storage: +m[2], perSecond: +m[3], perHour: +m[3] * 3600 };
  }
  const e = src.match(new RegExp(`"energy":\\s*\\{\\s*"amount":\\s*${num}`));
  const dm = src.match(new RegExp(`"darkmatter":\\s*\\{\\s*"amount":\\s*${num}`));
  out.energy = e ? +e[1] : null;
  out.darkmatter = dm ? +dm[1] : null;
  return out;
}
```

Use the energy tooltip (`#energy_box` title, or the `energy.tooltip` string) to get energy production/consumption (`+2,860` / `-2,754`), or the resource settings page.

How the page ticks (bundle:40010-40270, `timerhandler.js`):

- `var timerHandler = new TimerHandler();` (main:789) fires every 1000 ms (`setInterval`).
- `ResourceTicker.update` (bundle:40060): on each tick, for metal/crystal/deuterium, `amount += production` (production is per second). It is capped at `storage` only when it started below storage and production > 0; with negative production it is floored at 0. Above storage it does not grow.
- `refresh()` writes **only the text** of `#resources_<res>` using `gfNumberGetHumanReadable(Math.floor(amount), true)` (bundle:20865). `data-raw` is **never updated** and stays at the render-time snapshot.
- After JS runs, the text format changes. The server renders `1.234Mn`; the ticker writes `1.234M` (and `B` for 1e9 or more, from `LocalizationStrings.unitMega/unitMilliard`). Both use `,` thousands and `.` decimal. Parse text with `/^([\d,]+(?:\.\d+)?)(Mn|M|B|K)?$/`, after removing `,` from the number part. Do not rely on the text; use `data-raw` plus extrapolation.
- State lives in the page-world global `resourcesBar.resources.<res>.amount`, which isolated content scripts cannot see. Either extrapolate yourself:
  `amountNow = amount0 >= storage ? amount0 : Math.min(storage, amount0 + perSecond * (Date.now() - t0) / 1000)`, where `t0` is the page's render time (`performance.timeOrigin` is a good approximation, or the server time from section 8);
  or inject a page-world `<script>` that posts `resourcesBar.resources` via `window.postMessage`.
- `reloadResources(data, cb)` also sets the page globals `honorScore` and `darkMatter` (bundle:40251-40270).

### 6.4 There is NO resource-refresh AJAX endpoint

- `getAjaxResourcebox()` in the bundle is a no-op ("TODO: re-enable", bundle:40273).
- The inline layout redefines it (main:1438-1442) as `$.get("<origin>/overview#TODO_page=fetchResources&ajax=1", …, "text")`. That request returns the **full overview HTML**, and `reloadResources` then fails on `$.parseJSON`. **Do not use or imitate it.**
- To refresh resources, fetch any lightweight page (for example `GET /overview`) and run `parseInlineResources` on the HTML. Mind the `cp` side effect from section 5.

### 6.5 `GET /ajax/resources` is technology details, not resources

`routes/web.php:75` maps it to `ResourcesController::ajax` → `ObjectAjaxTrait::ajaxHandler` (`app/Http/Traits/ObjectAjaxTrait.php:25-335`). The same handler serves `/ajax/facilities`, `/ajax/research`, `/ajax/shipyard` and `/ajax/defense` (each controller calls `ajaxHandler`).

- Query: `technology=<objectId>` (required; without it the server throws an Exception, HTTP 500). The current planet is used; `cp` works (section 5).
- Response (`Content-Type: application/json`, `json_encode` flags 0, so `/` is escaped as `\/` and non-ASCII as `\uXXXX`):

```json
{
  "target": "technologydetails",
  "content": { "technologydetails": "<div id=\"technologydetails\" data-technology-id=\"3\">…</div><script>…</script>" },
  "files": { "js": [], "css": [] },
  "newAjaxToken": "<csrf token>",
  "page": { "stateObj": [], "title": "OGameX", "url": "http://host/resources" },
  "serverTime": 1793321837
}
```

- `serverTime` is **Unix seconds** (`time()`) and is the most reliable server clock (section 8).
- `page.url` is always `route('resources.index')`, whatever the endpoint.
- In `content.technologydetails` (`resources/views/ingame/ajax/object.blade.php`):
  - `#technologydetails[data-technology-id]` is **hard-coded to `3`** (line 3). Read the real id from `button.upgrade[data-technology]` (line 244) or `button.downgrade[data-technology]`.
  - Level: `.information > span.level[data-value=<nextLevel>]`, text `Level <current>`. Ships/defense: `span.amount[data-value]`, text `Number: <n>`.
  - Build time: `li.build_duration time.value[datetime="PT38M55S"]`, text `38m`.
  - Costs: `.costs li.resource.metal[data-value="7784"]` and the same for `.crystal`, `.deuterium`, `.energy`. `data-value` is a float printed by PHP, so use `parseFloat`. The class contains `sufficient` or `insufficient`. The visible text is `formatNumberShort`, e.g. `7,7K`: **here `,` is the DECIMAL separator**. Always use `data-value`.
  - Energy: `li.additional_energy_consumption .value[data-value]` (extra consumption) or `li.energy_production .value[data-value]` plus `.bonus[data-value]`.
  - Teardown: `#demolition_costs_tooltip table.demolition_costs tr.metal td[data-value]` and similar.
  - Ships/defense: max build amount in `#build_amount[max]`.
  - Upgrade is impossible when `button.upgrade[disabled]` is present.
  - Full markup: `fixtures/layout-ajax-resources-technology-1.json`.

## 7. CSRF token

| Where | Selector / variable | Source |
|---|---|---|
| Meta | `document.querySelector('meta[name="csrf-token"]').content` | main:23 |
| Page global | `window.token` | main:99 |
| Logout form | `#logout-form input[name="_token"]` | main:181-184 |
| AJAX JSON responses | `newAjaxToken` | ObjectAjaxTrait:327 and other controllers |

- Laravel's token is **per session**. It does not rotate per request (`newAjaxToken` = `csrf_token()` = the same value), and it changes only on login/logout.
- Send it as a form field `_token=<token>` (what OgameX JS does) or as the header `X-CSRF-TOKEN: <token>`. The layout sets the header for all jQuery AJAX (main:1700-1704). The session cookie `laravel_session` and the `XSRF-TOKEN` cookie must be sent: use `credentials: 'same-origin'` from page context. In Firefox, content-script `fetch` is not same-origin by default, so use `content.fetch(...)` or `credentials: 'include'`.
- `activateToken`, `miniFleetToken` and `changeSettingsToken` (main:829-830, 1445) are **hard-coded dummy strings**, not CSRF tokens.

## 8. Server time

| Source | Value | Source line |
|---|---|---|
| Inline JS | `var serverTime = new Date('2026-10-30 00:57:17');` (`Carbon::now()` → `Y-m-d H:i:s` in `APP_TIMEZONE`, default **UTC**, `config/app.php:67`) | main:839 |
| | `var localTime = new Date(); var timeDiff = serverTime - localTime;` | main:840-843 |
| Header clock | `#bar li.OGameClock`: server-rendered `d.m.Y H:i:s`; JS then rewrites it every second to `d.m.Y <span>H:i:s</span>` (bundle:21969-21975) | main:186 |
| JSON endpoints | `"serverTime": <unix seconds>` | ObjectAjaxTrait:333 |

- The page's own `serverTime` parses the string as **browser local time**, so `timeDiff` contains the browser↔server timezone offset. Do not reuse it as an epoch.
- Recipe: `Date.parse(str.replace(' ', 'T') + 'Z')` (assumes a UTC server) gives the server epoch in ms. Then `offset = serverEpoch - Date.now()` (accurate to about 1 s, minus network latency). If `APP_TIMEZONE` is not UTC, calibrate once against a JSON `serverTime`.
- `ogame-timestamp` is useless (constant, section 3).

## 9. Player, class, dark matter, officers, header

### 9.1 Origin and URLs

`route()` and `asset()` produce absolute URLs from the request host (`http(s)://host[:port]`). In JS `var ogameUrl = "http:\/\/host"` (main:882). Build URLs with `location.origin + path`.

### 9.2 Player

| Data | Where |
|---|---|
| id | `meta[name=ogame-player-id]`; JS `playerId` (string) and `player.playerId` (number) (main:795-802, later overwritten by `var player = {hasCommander:false}` at main:1612, so `player.playerId` is gone after that line) |
| name | `meta[name=ogame-player-name]`; `#playerName span.textBeefy > a.overlay` text. For admins the link contains `<span class="status_abbr_admin">name</span>` (`PlayerService::getUsername`, line 358). |
| admin | `#adminbar` exists at the top of `<body>` (main:122-124, `layouts/admin-menu.blade.php`), also during impersonation |
| highscore rank | `#bar li` containing `a[href$="/highscore"]`: text `Highscore (37)`. Regex `/\((\d+|-)\)/`; `-` means a hidden admin (composer:112-118). Cached for 5 min. |
| unread messages | `#message-wrapper a.comm_menu.messages .new_msg_count[data-new-messages]` (the element exists only when the count > 0) (main:332-341) |
| unread chat | `a.comm_menu.chat .new_msg_count.totalChatMessages[data-new-messages]` (class `noMessage` when 0) |
| buddy requests | `#bar a[href$="/buddies"] span` → `(n)` (only when > 0) |
| under attack | `#attack_alert` class `soon` (attacked), `wreckField`, or `noAttack` (main:394) |
| vacation | not exposed in the layout (`var vacation = 0;` is hard-coded at main:788) |
| alliance | not exposed (metas empty). `ogame.chat.initChat(playerId, isMobile, <alliance_id or null>)` at main:1695 contains it. |

### 9.3 Character class (main:287-306)

`#characterclass > a[href$="/characterclass"] > div.sprite.characterclass.medium.<cls>`, where `<cls>` is:

| Class | `<cls>` value |
|---|---|
| Collector | `miner` |
| General | `warrior` |
| Discoverer | `explorer` |
| none selected | `none` |

These come from `app/Enums/CharacterClass.php` `getMachineName()`. Same names as official OGame.

Recipe: `const cls = [...document.querySelector('#characterclass .sprite.characterclass').classList].find(c => ['miner','warrior','explorer','none'].includes(c));`

The link `title` is `Your class: Collector|+25% mine production&lt;br&gt;…` (bonuses joined by an escaped `<br>`).

### 9.4 Dark matter

`#resources_darkmatter[data-raw]` (int), or the inline `darkmatter.amount`. The JS global `darkMatter` is set by `reloadResources`; the earlier `var darkMatter = 0` at main:838 is overwritten.

### 9.5 Officers (main:307-328)

`#officers > a.commander | a.admiral | a.engineer | a.geologist | a.technocrat`. The links are `#TODO…`, the titles are always "Hire …", and there is **never an active state**. OgameX has no officers: `PlayerService::hasCommander()`, `hasGeologist()` and the others always return `false` (`app/Services/PlayerService.php:961-990`). Treat all officers as inactive in every formula (geologist +10%, admiral +2 slots, technocrat, etc.).

## 10. Page URLs (routes/web.php)

All in-game routes are behind `auth, banned, globalgame, locale, firstlogin`. `/` redirects to `/overview` (301).

| Page | URL | body id |
|---|---|---|
| Overview | `GET /overview` | `overview` |
| Resources (mines) | `GET /resources` | `resources` |
| Resource settings (production %) | `GET /resources/settings`, `POST /resources/settings` | `resourceSettings` |
| Facilities | `GET /facilities` (`?openTech=<id>`) | `station` |
| Research | `GET /research` | `research` |
| Shipyard | `GET /shipyard` | `shipyard` |
| Defense | `GET /defense` | `defense` |
| Fleet dispatch | `GET /fleet` | `ingamepage` |
| Fleet movement | `GET /fleet/movement` | `ingamepage` |
| Galaxy | `GET /galaxy` (`?galaxy=&system=&position=`) | `ingamepage` |
| Messages | `GET /messages` | `messages` |
| Merchant | `GET /merchant`, `/merchant/resource-market`, `/merchant/market/{type}`, `/merchant/scrap` | `traderOverview` |
| Alliance | `GET /alliance`, `/alliance/info/{id}`, `/alliance/apply/{id}` | `alliance` |
| Officers (premium) | `GET /premium` | `premium` |
| Shop / inventory | `GET /shop` (`#page=inventory`) | `shop` |
| Rewards | `GET /rewards` | `ingamepage` |
| Character class | `GET /characterclass` | `characterclassselection` |
| Highscore | `GET /highscore`; data `POST /ajax/highscore` | `highscore` |
| Buddies | `GET /buddies` | `buddies` |
| Chat | `GET /chat` | `chat` |
| Options | `GET /options` | `preferences` |
| Planet move | `GET /planet-move` | — |
| Admin | `/admin/server-settings`, `/admin/rules`, `/admin/fleet-timing`, `/admin/server-administration`, `/admin/developer-shortcuts` | `ingamepage` |

Overlays and AJAX endpoints referenced from the layout:

| What | URL |
|---|---|
| Search | `/overlay/search`, `POST /ajax/search` |
| Notes | `/overlay/notes` |
| Change nick | `/overlay/changenick` |
| Planet rename/abandon | `/overlay/planet-abandon` |
| Server settings | `/overlay/server-settings` |
| Tech tree | `/ajax/techtree?tab=&object_id=` |
| Jump gate | `/ajax/jumpgate` (moon with a jump gate, menu icon) |
| Event box | `GET /ajax/fleet/eventbox/fetch` (JS `ajaxEventboxURI`, main:916) |
| Event list | `GET /ajax/fleet/eventlist/fetch` (JS `eventlistLink`, main:1446) |
| Recall | `POST /ajax/fleet/dispatch/recall-fleet` (JS `ajaxRecallFleetURI`) |
| Mini fleet | `POST /ajax/fleet/dispatch/send-mini-fleet` (JS `miniFleetLink`, main:881) |
| Missile attack | `/overlay/galaxy/missile-attack?width=669&height=250` (JS `missleAttackLink`) |
| Chat | `POST /chat/send`, `/chat/history`, `/chat/more` |
| Language switch | `GET /lang/{en,it,nl,fr,zh-TW}` (footer, main:1903-1907) |
| Rules / legal | `/ajax/main/rules`, `/ajax/main/legal` |
| Logout | `POST /logout` with `_token` |

Those endpoints are specified in other area specs (fleet, galaxy, messages, buildings).

## 11. Universe settings: `GET /overlay/server-settings`

`ServerSettingsController::overlay` returns an HTML fragment (`resources/views/ingame/serversettings/overlay.blade.php`); see `fixtures/layout-overlay-server-settings.html`. Each row is `div.technology-fullrow > server-settings-icon.<key> + span(text) [+ div.emoji.activated|deactivated]`.

| `<key>` | Meaning | Parse |
|---|---|---|
| `acs_active` | ACS enabled | `.emoji.activated` |
| `darkmatter_bonus` (1st) | DM bonus | `/(\d+)\s*$/` |
| `debris_defense` | defense → debris % | `/\+(\d+)%/` |
| `debris_fleet` | ships → debris % | `/\+(\d+)%/` |
| `debris_deuterium` | deuterium in debris | `.emoji.activated` |
| `deuterium_save` | fleet deuterium reduction | always 30% (hard-coded) |
| `fleetspeed_war` | war fleet speed | `/x(\d+)/` |
| `fleetspeed_holding` | holding fleet speed | `/x(\d+)/` |
| `fleetspeed_peace` | peaceful fleet speed | `/x(\d+)/` |
| `ignore_empty` | ignore empty systems | `.emoji.activated` |
| `ignore_inactive` | ignore inactive systems | `.emoji.activated` |
| `number_galaxies` | galaxy count | `/(\d+)\s*$/` |
| `planetfield_bonus` | extra planet fields | `/(\d+)\s*$/` |
| `speedfactor` | economy speed | `/x(\d+)/` |
| `speedfactor_research` | research speed | `/x(\d+)/` |
| `darkmatter_bonus` (2nd, 3rd, 4th) | DM regeneration: enabled (`.emoji`); amount and period rows only when enabled | `/([\d,]+)/` |

The universe name is `thick-headline-header > p`. Parse by icon class, not by the localized text. Fetching this overlay has no side effects; cache it per origin.

## 12. Left menu and where to inject UI

```
#left
  > #ipimenucomponent (Directives, dummy)
  > #toolbarcomponent > #links
      > ul#menuTable.leftmenu > li   × 11   (main:514-710)
          > span.menu_icon > (a.tooltipRight > div.menuImage.<key>[.highlighted]) | div.menuImage.<key>
          > a.menubutton[.selected][.premiumHighligt] href="<page>" > span.textlabel  (localized)
          keys in order: overview(→rewards icon) resources(→/resources/settings) station(→jumpgate on a moon with a gate)
                         traderOverview(→/merchant/resource-market) research(→techtree overlay) shipyard defense
                         fleet1(→/fleet/movement) galaxy alliance premium shop(→/shop#page=inventory)
      > #attackblock (only when the admin attack block is active, main:712-764)
      > #toolLinksWrapper > ul#menuTableTools.leftmenu   ← EMPTY, made for tool links (main:766-768)
  > #advicebarcomponent > .adviceWrapper > #advice-bar (empty)
#middle > #eventlistcomponent > #eventboxContent + inline script + @yield('content')   (page content #inhalt is INSIDE #eventlistcomponent, main:781-1712)
#right  > #planetbarcomponent (planet list) + #bannerSkyscrapercomponent > #banner_skyscraper (static shop banner; safe to hide or reuse for a side panel)
#siteHeader (empty div before #pageContent, main:125), #siteFooter, #chatBar
```

- **Menu entries:** append `li` elements to `ul#menuTableTools`, mirroring the official markup so the game CSS styles them:

```html
<li><span class="menu_icon"><div class="menuImage ogx-icon"></div></span>
    <a class="menubutton" href="javascript:void(0)" data-ogx="panel"><span class="textlabel">Infinity</span></a></li>
```

- Selected-page detection: `#menuTable a.menubutton.selected` (`Request::is(...)`). It is wrong for `/rewards`, which highlights the overview icon.
- **Side panel:** a fixed-position container appended to `body` (do not reflow `#pageContent`), or `#bannerSkyscrapercomponent`, which is unused.
- The header bar `#bar > ul > li` (player, highscore, notes, buddies, search, options, support, logout, clock) can take an extra `li`.
- Notification area: `#notificationbarcomponent #message-wrapper`.
- Game dialogs available from page world: `fadeBox(text, isError)`, `errorBoxDecision(head, text, yes, no, cb)`, `errorBoxNotify(...)` (DOM at main:1944-1982). Their markup (`#fadeBox`, `#decisionTB`) can be imitated for consistent styling.

## 13. JS globals exposed by the layout

These live in the page world; content scripts must read them via an injected script or by parsing inline script text.

| Global | Value / meaning | Line |
|---|---|---|
| `token` | CSRF token | main:99 |
| `timerHandler` | `TimerHandler` (1 s interval). Callbacks: resource ticker, clock, countdowns. | main:789 |
| `resourcesBar` | `ResourceTicker`: `.resources.{metal,crystal,deuterium,energy,darkmatter}.{amount,storage,production}`, live amounts | bundle:40249 |
| `reloadResources(data, cb)` | re-feeds the resource bar | bundle:40251 |
| `playerId`, `playerName` | strings | main:795-796 |
| `player` | `{hasCommander:false}` (final value) | main:1612 |
| `serverTime`, `localTime`, `timeDiff`, `startServerTime` | see section 8 | main:839-843 |
| `darkMatter`, `honorScore` | set by reloadResources | bundle:40265-40266 |
| `LocalizationStrings` | `decimalPoint: "."`, `thousandSeperator: ","`, `unitMega: "M"`, `unitKilo: "K"`, `unitMilliard: "B"`, timeunits | main:844-868 |
| `jsloca`, `chatLoca`, `eventboxLoca`, `planetMoveLoca`, `locaPremium`, `loca`, `localizedBBCode`, `locaKeys` | UI strings | main:804-914, 1455-1489, 1613+, 1987 |
| `ajaxEventboxURI`, `ajaxRecallFleetURI`, `eventlistLink`, `miniFleetLink`, `missleAttackLink`, `changeNickLink`, `chatUrl`, `chatHistoryUrl`, `chatUrlLoadMoreMessages`, `bigChatLink`, `ogameUrl`, `startpageUrl` | URLs | main:878-891, 916-917, 1446, 1986 |
| `reverbAppKey`, `reverbHost`, `reverbPort`, `reverbScheme` | Laravel Reverb (websocket chat) | main:885-888 |
| `priceBuilding`, `priceResearch`, `priceShips` | 750 (DM halving price; hard-coded) | main:1479-1481 |
| `isMobile` | `false` | main:822 |
| Junk (hard-coded, do not use) | `session`, `vacation`, `currentPage`, `constants`, `userData`, `currentSpaceObjectId`, `activateToken`, `miniFleetToken`, `changeSettingsToken`, `honorScore` (11) | main:787-788, 829-831, 869-877, 918, 1445 |
| Functions | `redirectOverview()`, `reloadPage()`, `loadDetails(type)`, `sendBuildRequest`, `fastBuild`, `demolishBuilding`, `openPlanetRenameGiveupBox`, `openWreckFieldDetailsPopup`, `getAjaxResourcebox` (broken, 6.4) | main:921-1610 |

jQuery 1.12.4 and jQuery UI 1.12.1 are bundled (`$`, `jQuery`), together with Tipped, `ogame.*` (chat etc.), `gfNumberGetHumanReadable`, `number_format`, `changeTooltip`, `initTooltips`, `fadeBox`, `errorBoxDecision`, `openOverlay`.

Script loading: `@vite` emits a classic `<script src="/build/assets/ingame-<hash>.js">` in `<head>` (no `type="module"`, `app/Providers/AppServiceProvider.php:31`). The inline layout script then calls `$.holdReady(true)` and releases it once `initEmpireEquipment` exists (main:100-108). So `$(document).ready` handlers, including the tooltip init that strips `title`, run after DOMContentLoaded.

## 14. Number and text formats (summary)

| Context | Format | Example |
|---|---|---|
| Resource bar text (server) | `formatNumberLong` | `152,347`, `1.234Mn`, `2Mn` |
| Resource bar text (after JS) | `gfNumberGetHumanReadable(x, true)` | `152,347`, `1.234M`, `1.5B` |
| Tooltips, planet tooltip, dark matter | `formatNumber` | `12,800`, `4,128` |
| Cost list visible text (tech details) | `formatNumberShort` (decimal `,`!) | `7,7K`, `15K`, `2Mn` |
| `data-raw`, `data-value` | PHP float with precision 14 | `152347.29861111`, `7784` |
| Durations | `formatTimeDuration` | `1w 2d 3h 4m` (seconds shown only when under 1 min) |
| `<time datetime>` | `formatDateTimeDuration` | `PT38M55S` |

A universal parser for display numbers: `s => { s = s.trim(); const m = s.match(/^(-?[\d.,]+)\s*(Mn|M|B|K)?$/); … }`. Never rely on displayed text when a `data-*` attribute exists.

The language depends on the user locale (en/it/nl/fr/zh-TW). Never match UI labels; use ids, classes and data attributes.

## 15. Differences from official OGame (checklist for porting OGame Live / OGLight code)

1. `.smallplanet` id is an index, not the planet id; use `data-planet-id` (4.1).
2. No `hightlightMoon`; moon detection via `a.moonlink.active` or the metas (4.1, 4.3).
3. `ogame-planet-type` is always `planet`, `ogame-timestamp` is constant, and the alliance metas are empty (3).
4. No `.constructionIcon.moon`.
5. No `?page=…&component=…` routing; path-based routing (10). Body id `ingamepage` for fleet and galaxy (2).
6. `?cp=` persists server-side, including from AJAX requests (5).
7. There is no resources JSON endpoint; `/ajax/resources` returns technology details (6.4, 6.5).
8. Officers never active; no lifeforms (population/food tiles commented out); no honor points.
9. Number format: `,` thousands everywhere and `Mn` suffix server-side (14). OGame Live's `split('.').join('')` integer parsing breaks; use `replace(/,/g,'')`.
10. Tooltip titles are stripped by Tipped after ready (4.2).
11. Fleet speed meta = generic `fleet_speed`; war/holding/peaceful speeds come from `/overlay/server-settings` (11).
12. `#inhalt` sits inside `#middle > #eventlistcomponent` (12).

## 16. Open points

- The exact Vite asset hash and dev-mode tags (`@vite/client` on port 5173) vary by install; detection must not depend on them.
- `serverTime` assumes `APP_TIMEZONE=UTC` (the default); verify once against JSON `serverTime`.
- Per-planet production of non-current planets is not on any page except when that planet is current. Collect it as the user visits planets, or by `?cp=` fetches (with the restore step from section 5).
