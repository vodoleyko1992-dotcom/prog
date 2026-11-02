# GALAXYZ (ogamex.eu) in-game layout: detection, routing, header, planets, overview, insertion points

Target: `https://ogamex.eu/Aeternum/game.php?page=<name>[&mode=<mode>][&cp=<bodyId>]`, `<meta name="generator" content="GALAXYZ 1.8.git">`,
a modified fork of 2Moons (PHP + Smarty + jQuery 1.x). This replaces `specs/layout.md` (lanedirt OgameX) for GALAXYZ.

Tags: **[REAL x.html]** = seen in `eu/pages/x.html` (saved 2026-10-30 from the live server, account `vodoleyko1992`, 4 planets, no moon).
**[UPSTREAM file:line]** = upstream 2Moons source in `src/2Moons/`, not seen live. **[GUESS]** = neither.
Live JS used by the page: `eu/overview/*_files/{base,topnav,overview,fleetTable}.js` [REAL].

Companion files (all in `specs/galaxyz/`):

| file | what |
|---|---|
| `layout-recipes.js` | `GZLayout.*` browser JS, no deps: `detect, route, serverTime, planets, currentBody, resources, amountAt, player, fleetEvents, overview, anchors, parseLayout`. Works on `document` and on a `DOMParser` document (background fetch). |
| `tools/run_layout_snippets.js` | runs every snippet of THIS document (Chromium, JS disabled) on real pages; outputs below are copied from it. `node tools/run_layout_snippets.js [page.html ...] [--only=a,b]` |
| `tools/survey_layout.js` | runs `GZLayout.parseLayout` on all 20 real pages (one line per page, section 13). |
| `tools/pages_layout.js` | per-page chrome table (section 2). `tools/tree_layout.js page.html depth` prints the element skeleton. |
| `tools/check_layout.js [--write]` | `GZLayout.parseLayout` on real overview + `fixtures/layout-*.html`, also checks live DOM == DOMParser result; `--write` refreshes `fixtures/layout-expected-parse.json`. |
| `fixtures/layout-live-synthetic-{planet,moon}.html` | real overview skeleton + moon parts marked `<!-- GUESS -->` (no moon on the real account). |
| `fixtures/layout-upstream-overview.html` | upstream 2Moons overview rendering (for the 2Moons fallback). |

Run everything with `NODE_PATH=$(npm root -g) node tools/<x>.js` from `specs/galaxyz/` (Playwright is global; no jsdom installed).

General pitfalls (read first)

* Saved pages are the **post-JS DOM** (Chrome "Save page as"): `#fancybox-*` divs, `style="display:none"` and `data-hide="true"` on the duplicated event, the ticked `data-tooltip-content` on resource cells. A content script at `document_idle` sees the same; at `document_start` it does not. Every recipe here uses only server-rendered parts (they are present in both).
* **Duplicated ids on every full page** [REAL all pages]: `#planetList` x4 (one per planet), `#myWorlds` x2 (nested), `#OvfleetEvents` x3, `#OvfleetContent` x2, and the first event's `#fleettime_<key>` x2. Never use `getElementById` / `$('#planetList')` for these; use `querySelectorAll('[id=planetList]')` or classes (`.smallplanet`, `.OvfleetEvents_`).
* Encoding UTF-8 (`<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">`); names may be Cyrillic (`Главная планета`). `<html lang="en">`; texts are English but the language is a user setting (`var Lang = "en"`), so never match on English words where an attribute or class exists.
* Numbers: `.` = thousands separator, `,` = decimal (2Moons `number_format`, base.js:1-20): `1.408.320.362`, `20.000 km`. Short forms come in **two dialects**: JS `shortly_number` (base.js:34) = long scale with a NBSP before the unit, `1.411&nbsp;M` = 1 411 M = 1.411e9 (`K`=1e3, `M`=1e6, `B`=1e12, `T`=1e18; one decimal `,` when < 100); server PHP text on energy/DM = `47.5K`, `4K` (`.` is a DECIMAL point, short scale, no space). Never parse short forms when an exact value exists (`data-real`, `t=`, `title` tooltip, `resourceTicker(...)`).
* Absolute URLs everywhere: `https://ogamex.eu/Aeternum/game.php?page=...` (the game prints absolute hrefs). Tooltip HTML inside `title` uses relative `game.php?page=...`. Build URLs from `location.origin + location.pathname`.

---

## 1. Detection

| signal | selector / source | sample [REAL overview.html] | strength |
|---|---|---|---|
| generator meta | `meta[name="generator"]` content `/^(GALAXYZ\|2Moons)\b/i` | `GALAXYZ 1.8.git` | strong; upstream prints `2Moons <version>` [UPSTREAM styles/templates/game/main.header.tpl] |
| path | `location.pathname` ends with `/game.php` | `/Aeternum/game.php` (universe = first path segment) | required live; skip for `file:`/DOMParser |
| planet selector | `#planetSelector` (a `<select>`) | 4 options | present on every full page incl. info pages |
| server clock | inline `var serverTime = new Date(Y, M0, D, h, m, s);` in `<head>` | `new Date(2026, 9, 30, 10, 03, 37)` | every page (also popups) |
| resource ticker | inline `resourceTicker({...}, true)` inside `#links` | 3 calls | full pages only |
| body | `body.full` (full page) / `body.popup` (fancybox iframe / `OpenPopup`) [UPSTREAM AbstractGamePage.class.php:185 `bodyclass`] | `<body id="overview" class="full">` | id = page (see 2) |
| GALAXYZ skin | `#resTable`, `#planetSelect`, `#menuTable`, `#rechts` | yes | distinguishes from plain 2Moons (`#resourceTable`, `#leftmenu`) |

Recipe (RUN on all 20 real pages, all `genOk/selector/serverTime/ticker = true`, `bodyClass = "full"`):

```js
const gen = document.querySelector('meta[name="generator"]')?.content || '';
const scripts = [...document.scripts].map(s => s.textContent).join('\n');
({ gen, genOk: /^(GALAXYZ|2Moons)\b/i.test(gen), selector: !!document.querySelector('#planetSelector'),
   serverTime: /\bserverTime\s*=\s*new Date\(/.test(scripts), ticker: /resourceTicker\(\{/.test(scripts),
   bodyClass: document.body.className })
// overview.html -> {"gen":"GALAXYZ 1.8.git","genOk":true,"selector":true,"serverTime":true,"ticker":true,"bodyClass":"full"}
```

Rule for `OGX.page.isOgx` replacement: `genOk && /\/game\.php$/.test(location.pathname) && serverTime`. Pages without `#planetSelector` are popups (`body.popup`) or login (`index.php`); boot a reduced mode there or skip.
Other noise in `<head>`: a third-party `<meta property="gosuslugi.plugin.extension.content">` injected by a browser extension of the user (ignore).

## 2. Page routing

`page`/`mode` come from the URL. The game repeats them in `var queryString = "page=...&mode=..."` (only `page` and `mode`, never `cp`) [REAL all; UPSTREAM AbstractGamePage.class.php:68-82]. Use `queryString` for DOMParser documents (no `location`). `body#id` is NOT reliable (see transport).

Table [REAL, `tools/pages_layout.js` + snippet `route`] (`ev` = event box `#messages_collapsed`, `rechts` = planet list column):

| file | URL (`saved from url`) | queryString | body id | `<title>` prefix | ev | rechts | first content nodes in `#inhalt` |
|---|---|---|---|---|---|---|---|
| overview | `?page=overview` | `page=overview` | overview | Overview | 1 | 1 | `#planet`, `.c-left`, `.c-right`, 3x `.content-box-s` |
| buildings | `?page=buildings` | `page=buildings` | buildings | Buildings | 1 | 1 | `.technologyContainer` |
| research | `?page=research` | `page=research` | research | Research | 1 | 1 | `#planet`, `#technologydetails_wrapper` |
| shipyard-fleet | `?page=shipyard&mode=fleet` | `page=shipyard&mode=fleet` | shipyard | Hangar | 1 | 1 | `#planet`, `#technologydetails_wrapper` |
| shipyard-defense | `?page=shipyard&mode=defense` | `page=shipyard&mode=defense` | shipyard | Defenses | 1 | 1 | `#planet`, `#technologydetails_wrapper` |
| fleetTable | `?page=fleetTable` | `page=fleetTable` | fleetTable | Fleet | 1 | 1 | `#planet` |
| fleetStep1 | `?page=fleetStep1` (POST) | `page=fleetStep1` | fleetStep1 | Fleet | 1 | 1 | `#fleet1` |
| fleetStep2 | `?page=fleetStep2` (POST) | `page=fleetStep2` | fleetStep2 | Fleet | 1 | 1 | `#fleet2` |
| fleetStep3 | `?page=fleetStep3` (POST) | `page=fleetStep3` | fleetStep3 | Fleet | 1 | **0** | `.headerRS`, `.mainRS`, `.footerRS`; `<meta http-equiv="refresh" content="3;URL=game.php?page=fleetTable">` |
| galaxy | `?page=galaxy` | `page=galaxy` | galaxy | Galaxy | 1 | 1 | `#content` |
| imperium | `?page=imperium` | `page=imperium` | imperium | Empire | 1 | 1 | `.imparatorluk_tab.mainRS` |
| resources | `?page=resources` | `page=resources` | resources | Resources | 1 | 1 | `#planet` |
| officier | `?page=officier` | `page=officier` | officier | Officers | 1 | 1 | `#planet`, `#technologydetails_wrapper` |
| trader | `?page=trader` | `page=trader` | trader | Market | 1 | 1 | `#planet` |
| fleetDealer | `?page=fleetDealer` | `page=fleetDealer` | fleetDealer | Merchant of Fleets | 1 | 1 | `#planet`, `.headerRS`, `.mainRS` |
| techtree | `?page=techtree` | `page=techtree` | techtree | Technologies | 1 | 1 | `#tabs.techtree-table` |
| tournament | `?page=tournament` | `page=tournament` | tournament | Tournament | 1 | 1 | `.headerRS`, `#achivment` |
| messages-spy / messages-all | `?page=messages` (category loaded by AJAX) | `page=messages` | messages | Messages | 1 | 1 | `#planet` |
| transport | `?page=transport` | `page=transport` | **shipyard** | **Info** | **0** | **0** | `.headerRS`, `.mainRS` = error box "You need Admiral officier at level 10!!" |

Notes
* `<title>` = `<Page> - Aeternum (New) - Aeterum (New)` (sic, typo in the second part).
* **Info/error pages** (upstream `printMessage` -> `error.default.tpl` [UPSTREAM AbstractGamePage.class.php:200-216]) keep the header/menu/selector/ticker but have no event box and no `#rechts`; body id is NOT the page name (transport -> `shipyard`). Detect: `!document.querySelector('#rechts') && document.querySelector('#inhalt > .headerRS + .mainRS')`; message text = `#inhalt .mainRS td p`. fleetStep3 matches the same test (result page, also no `#rechts`), so check `page` first.
* messages-spy and messages-all have the SAME URL; the category is chosen client-side (`Message.getMessages(cat)`), so routing cannot tell them apart.
* Menu links never carry `cp`; the active planet is server-side session state (section 4.4).
* `page` names are case-sensitive in the game's router (`fleetTable`, `fleetDealer`, `TechnologyDetailsAjax`); keep the original case and compare lower-cased.

Recipe (RUN, all pages; outputs in the table):

```js
const qs = ([...document.scripts].map(s => s.textContent).join('\n').match(/var\s+queryString\s*=\s*"([^"]*)"/) || [])[1];
const q = new URLSearchParams(qs || location.search);
({ queryString: qs, page: q.get('page'), mode: q.get('mode'), bodyId: document.body.id, title: document.title.split(' - ')[0],
   infoPage: !document.querySelector('#rechts') && !!document.querySelector('#inhalt > .headerRS + .mainRS') })
// shipyard-defense.html -> {"queryString":"page=shipyard&mode=defense","page":"shipyard","mode":"defense","bodyId":"shipyard","title":"Defenses","infoPage":false}
// transport.html        -> {"queryString":"page=transport","page":"transport","mode":null,"bodyId":"shipyard","title":"Info","infoPage":true}
```

Default when `page` is missing: `game.php` alone renders overview [UPSTREAM game.php]. `mode` default = `show`.

## 3. Page skeleton (same on every full page) [REAL overview.html, `tools/tree_layout.js`]

```
body#<page>.full
  div#tooltip.tip
  div#boxBG > div#page
    a#anchor
    div#info.header                      <- top header ("main.topnav")
      div#clearAdvice
      div#playerName  "Player: " span.textBeefy > a[href*=page=settings]  (player name)
      div#bar > ul > li x8               (Friendships, Notes, Statistics(&range=<rank>), Search, Options, Simulator, Voucher code, Logout)
      div#clock.servertime               "Oct Fri 30 10:03:43" (JS-updated text)
      div#planetSelect > table td#planetImage img + td#planetSelectorWrapper select#planetSelector + div._previous/._next
      div#resTable > table: row 1 = 5 icons img[data-currentname] with HTML tooltips in title; row 2 = 5 td.res_current
      div#officers > a.commander (vote notice)
      div.messages-section > a.messages-button span.new-msg-count + a.chat-button (Discord)
    div#links > ul#menuTable > li x11 ; then <script> viewShortlyNumber, vacation, 3x resourceTicker(...)
    div#inhalt
      <script> eventHeader() ; div#messages_collapsed.messpositionDiv (event box, section 7) ; <style>
      ... page content ...
    div#rechts > div#norm > div#myWorlds > div#myWorlds > div#countColonies + div#planetList x N
  (outside #boxBG or inside #page, varies:) div.gototop, div.clear, div#siteFooter.clearfloat > div.fcontent > div.fleft + div.fright (links)
```

`#siteFooter` position varies (fleetStep3: inside `#page`; transport: after `#boxBG`), always query it globally.

## 4. Planets, moons, current body

### 4.1 Planet selector (authoritative full list incl. moons) [REAL all pages]

`#planetSelector option[value=<bodyId>]`, text `<Name> [g:s:p]`; current body = `option[selected]`.
Moons: [UPSTREAM includes/pages/game/AbstractGamePage.class.php:107] text `<Name> (Moon) [g:s:p]` (`$LNG['fcm_moon']`, en "Moon", de "Mond"...), same coords as the planet, own id, listed in `getPlanets()` order (planet then its moon by default sort). Not seen live (account has no moon) -> [GUESS that GALAXYZ kept it]; fixture `layout-live-synthetic-moon.html`.

```js
[...document.querySelectorAll('#planetSelector option')].map(o => o.value + ' | ' + o.textContent.trim())
// overview.html -> ["254102 | Главная планета [2:68:5]","254103 | Colony [2:68:6]","254104 | Colony [2:68:7]","254105 | Colony [2:68:8]"]
```

Current body:

```js
const o = document.querySelector('#planetSelector option[selected]');
const c = o.textContent.match(/\[(\d+):(\d+):(\d+)\]/);
({ id: +o.value, text: o.textContent, coords: c.slice(1).map(Number), isMoon: /\((Moon|Mond|Luna|Луна)\)\s*\[/.test(o.textContent),
   image: document.querySelector('#planetImage img')?.getAttribute('src').match(/s_([a-z]+\d*)\./i)?.[1] })
// overview.html -> {"id":254102,"text":"Главная планета [2:68:5]","coords":[2,68,5],"isMoon":false,"image":"dschjungelplanet07"}
```

Use `option[selected]` (attribute), not `:checked`, on fetched documents; the `_previous/_next` handlers move the `selected` attribute live. Second moon hint: `#planetImage img` src `s_mond.gif` [UPSTREAM image name `mond`] [GUESS live].

### 4.2 Planet list (right column) [REAL all full pages except info/fleetStep3]

```
div#rechts > div#norm > div#myWorlds > div#myWorlds
  div#countColonies > p.textCenter > span "[4 / 6]" + " My planets"
  div#planetList (repeated per planet!) > div.smallplanet >
    a.planetlink[href=".../game.php?page=overview&cp=254102"]  (+ "active active-planet" on the current one)
       title = HTML tooltip: <b>Name [g:s:p]</b><br>32°C to 72°C<br>20.000 km (259 / 405)<br> + links Overview/Buildings/Research/Hangar/Defenses/Fleet/Galaxy
      img.planetPic[src*="s_dschjungelplanet07.gif"]
      span.planet-name "Главная планета"
      span.planet-koords "[2:68:5]" (+ <i class="bi bi-building-fill-up buildingIco"> when something is being built on that planet)
```

Moons in this list: **unknown** (not seen; no `a.moonlink` in the template we saw). `GZLayout.planets` supports a GUESS `a.moonlink` (fixture) but relies on the selector. When the current body is a moon, `.active` may be on no link at all [GUESS] -> always take current from the selector.

```js
[...document.querySelectorAll('#myWorlds .smallplanet')].map(sp => {
  const a = sp.querySelector('a.planetlink'), t = a.getAttribute('title');
  return { cp: +new URL(a.href, location.href).searchParams.get('cp'), name: sp.querySelector('.planet-name').textContent.trim(),
    coords: sp.querySelector('.planet-koords').textContent.trim(), active: a.classList.contains('active'),
    building: !!sp.querySelector('i.buildingIco'),
    temp: t.match(/(-?\d+)°C to (-?\d+)°C/).slice(1).map(Number),
    fields: t.match(/([\d.]+) km \((\d+) \/ (\d+)\)/).slice(1).map(s => +s.replace(/\./g, '')) };
})
// overview.html ->
// {"cp":254102,"name":"Главная планета","coords":"[2:68:5]","active":true,"building":false,"temp":[32,72],"fields":[20000,259,405]}
// {"cp":254103,"name":"Colony","coords":"[2:68:6]","active":false,"building":true,"temp":[20,60],"fields":[18627,81,347]}
// {"cp":254104,"name":"Colony","coords":"[2:68:7]","active":false,"building":true,"temp":[22,62],"fields":[20808,77,433]}
// {"cp":254105,"name":"Colony","coords":"[2:68:8]","active":false,"building":true,"temp":[-10,30],"fields":[22671,128,514]}
```

`a.getAttribute('title')` is the raw tooltip only before the tooltip lib moves it (the live lib copies on hover; saved pages still have it). Keep a fallback to the selector text. `.planet-koords` text has trailing whitespace/newlines (trim). Temperature in the tooltip is `32°C to 72°C` (English "to"; use `\D+?` between numbers for other languages, as `GZLayout.parseTooltip` does).

Colony count: `#countColonies` (unique) `[4 / 6]` = used / max planets (moons not counted [UPSTREAM]).

```js
document.querySelector('#countColonies').textContent.trim().replace(/\s+/g, ' ').match(/\[(\d+) \/ (\d+)\]/).slice(1).map(Number)
// overview.html -> [4,6]
```

### 4.3 Planet order differs

Selector order = planet list order here (254102..254105). The Empire page (`imperium`) uses another column order (see buildings/imperium spec). Store by id, never by index.

### 4.4 Switching body (`cp`) - SIDE EFFECT

* Game way [REAL base.js:281]: `$('#planetSelector').on('change', () => document.location = '?' + queryString + '&cp=' + val)`; list links are `?page=overview&cp=<id>`.
* Any request with `&cp=<id>` (GET or POST, also AJAX) makes that body the session's active planet for ALL tabs [UPSTREAM includes/classes/Session.class.php:291-310, called from includes/common.php:170]; a URL without `cp` uses the session's last body. Background fetches of other planets therefore switch the user's planet: always end with a fetch `&cp=<original id>` (or include `cp` in every request) and warn the user, as `state.refreshBodies` already does (`core.cpConfirmed`).
* An invalid / foreign `cp` is silently ignored (stays on current).

## 5. Resources, storage, production, energy, dark matter (every full page)

Three sources, in order of preference:

### 5.1 `resourceTicker` inline calls (exact floats) [REAL all pages, inside `#links` after `ul#menuTable`]

```html
resourceTicker({
    available: (1408320361.5606675),
    limit: [0, "3416925000"],
    production: 1932927923.2055,
    valueElem: "current_metal"
}, true);
```

`available` = amount at render time, `limit[1]` = storage capacity (string), `production` = per HOUR (planet total incl. basic income [UPSTREAM AbstractGamePage.class.php:120-127]). Only metal/crystal/deuterium. On moons production is the raw `_perhour` (0) [UPSTREAM].

```js
const src = [...document.scripts].map(s => s.textContent).join('\n'), out = {};
for (const m of src.matchAll(/resourceTicker\(\{\s*available:\s*\(([-\d.eE+]+)\),\s*limit:\s*\[0,\s*"([-\d.eE+]+)"\],\s*production:\s*([-\d.eE+]+),\s*valueElem:\s*"current_(\w+)"/g))
  out[m[4]] = { amount: +m[1], storage: +m[2], perHour: +m[3] };
// overview.html -> {"metal":{"amount":1408320361.5606675,"storage":3416925000,"perHour":1932927923.2055},
//                   "crystal":{"amount":228249710.0184198,"storage":1863925000,"perHour":822497302.17436},
//                   "deuterium":{"amount":350563050.6686126,"storage":1016750000,"perHour":394585191.6862}}
```

`GZLayout.resources` uses a looser regex (optional parens/quotes, works for upstream too). Amount at time t (exact port of topnav.js:6-34): `floor(available + production/3600 * elapsedSec)`, ticking stops once `>= limit[1]` (class `res_current_max`); 90% adds `res_current_warn`. See `GZLayout.amountAt`.

### 5.2 Header cells `#resTable` row 2 [REAL all pages]

| cell | selector | sample (overview) |
|---|---|---|
| metal / crystal / deuterium | `td#current_metal` / `#current_crystal` / `#current_deuterium` (unique ids) | `data-real="1408320361.5607"` (render-time amount, rounded to 4 decimals), `data-tooltip-content="1.411.541.908"` (JS-ticked value at save time, live-changing), text `1.411&nbsp;M` |
| energy | `#resTable td.res_current[t]` (NO id; class list `res_current tooltip Imperium tooltipRight`) | `t="438 / 47.480"`, text `438&nbsp;/&nbsp;47.5K` |
| dark matter | `td#current_darkmatter` | `data-real="3981"`, `data-tooltip-content="3.981"`, text `4K` |

```js
['metal','crystal','deuterium','darkmatter'].map(k => { const td = document.getElementById('current_' + k);
  return k + ': data-real=' + td.dataset.real + ' tooltip=' + td.dataset.tooltipContent + ' text=' + JSON.stringify(td.textContent.trim()); })
// overview.html ->
// "metal: data-real=1408320361.5607 tooltip=1.411.541.908 text=\"1.411 M\""
// "crystal: data-real=228249710.01842 tooltip=229.620.538 text=\"229 M\""
// "deuterium: data-real=350563050.66861 tooltip=351.220.692 text=\"351 M\""
// "darkmatter: data-real=3981 tooltip=3.981 text=\"4K\""
```

Energy: `t = "<free> / <total production>"`. The icon tooltip labels are misleading: "Available: 47.480" is the total production, "Current production:: 438" is the free energy, "Consumption: -47.042" [REAL overview.html resTable row 1]. free = production - consumption.

```js
const td = document.querySelector('#resTable td.res_current[t]');
const [free, total] = td.getAttribute('t').split('/').map(s => +s.trim().replace(/\./g, ''));
({ t: td.getAttribute('t'), text: td.textContent.trim().replace(/\s+/g, ' '), free, production: total, consumption: total - free })
// overview.html    -> {"t":"438 / 47.480","text":"438 / 47.5K","free":438,"production":47480,"consumption":47042}
// fleetDealer.html -> {"t":"2.502 / 49.544","text":"2.5K / 49.5K","free":2502,"production":49544,"consumption":47042}
```

Negative free energy: upstream wraps it in `style="color:red"` [UPSTREAM main.topnav.tpl:33]; `t` is expected to be `-123 / 47.480` [GUESS], the regex `-?[\d.]+` in `GZLayout.resources` handles it.

### 5.3 Icon tooltips `#resTable img[data-currentname]` [REAL]

`data-currentname` = `current_Metal | current_Crystal | current_Deuterium | current_Energy | current_Dark Matter` (with a space!). `title` = `"Metal:|<table class='resourceTooltip tool_39'>..."`: header before `|`, HTML after; spans `.current`, `.storage`, `.production` with `.`-grouped integers (rounded, so less exact than 5.1).

```js
const t = document.querySelector('img[data-currentname="current_Metal"]').getAttribute('title');
const d = new DOMParser().parseFromString(t.split('|')[1], 'text/html');
const n = c => +d.querySelector('.' + c).textContent.trim().replace(/\./g, '');
({ current: n('current'), storage: n('storage'), production: n('production') })
// overview.html -> {"current":1408320362,"storage":3416925000,"production":1932927923}
```

Dark matter has only `.current` (`3.981`). Other globals next to the tickers: `var viewShortlyNumber = 1; var vacation = 0;` [REAL].

## 6. Server time

[REAL every page, `<head>`]:

```js
var ServerTimezoneOffset = 0;                         // seconds: user tz offset - server tz offset [UPSTREAM AbstractGamePage.class.php:195]
var serverTime  = new Date(2026, 9, 30, 10, 03, 37);  // SERVER WALL CLOCK at render (month 0-based), built in the BROWSER tz
var startTime = serverTime.getTime();                 // + setInterval(+1 s) ticking serverTime
```

`#clock.servertime` text `Oct Fri 30 10:03:43` (JS-updated with `tdformat "[M] [D] [d] [H]:[i]:[s]"`; useless for parsing).
The wall clock has no zone. The absolute render instant comes from any event countdown: `data-fleet-end-time` (unix s) - `data-fleet-time` (remaining s) [REAL], both computed from the same PHP `TIMESTAMP`. Result here: server zone = **UTC+2** (Oct 30 2026 is after EU DST end, so not CEST; probably EET). With no fleet in the air (transport.html) there is no anchor: use the stored offset or calibrate later (fleetTable `data-fleet-end-time`, message dates).

```js
const src = [...document.scripts].map(s => s.textContent).join('\n');
const m = src.match(/serverTime\s*=\s*new Date\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/).slice(1).map(Number);
const wall = Date.UTC(...m);                          // server wall clock read as if UTC (month already 0-based)
const ev = document.querySelector('.fleets[data-fleet-end-time][data-fleet-time]');
const renderUnix = ev ? +ev.dataset.fleetEndTime - +ev.dataset.fleetTime : null;
({ args: m, offsetVar: +src.match(/ServerTimezoneOffset\s*=\s*(-?\d+)/)[1], clock: document.querySelector('#clock').textContent,
   renderUnix, serverUtcOffsetH: renderUnix ? Math.round((wall / 1000 - renderUnix) / 900) / 4 : null })
// overview.html  -> {"args":[2026,9,30,10,3,37],"offsetVar":0,"clock":"Oct Fri 30 10:03:43","renderUnix":1793347417,"serverUtcOffsetH":2}
// transport.html -> {"args":[2026,9,30,10,6,53],"offsetVar":0,"clock":"Oct Fri 30 10:07:01","renderUnix":null,"serverUtcOffsetH":null}
// all other 18 pages: serverUtcOffsetH 2
```

Pitfall: `new Date(Y,M,D,h,m,s)` in page JS interprets the wall clock in the BROWSER zone; `serverTime.getTime()` is therefore not a real epoch. Only differences (`serverTime - startTime`) are meaningful, which is how the game uses it. Times printed in event boxes (`span.fleet_static_time` `10:20:29`) are server wall clock (+ `ServerTimezoneOffset` if the user set a zone [UPSTREAM]).

## 7. Event box (fleet events) - on EVERY full page, not only overview

[REAL all full pages except info pages] `#inhalt > div#messages_collapsed.messpositionDiv`:

```
div#messages_collapsed
  div#OvfleetContent > span > a.OvfleetButton[href="javascript:eventHeader('.allFleetsEvent');"]     (toggle)
  div#OvfleetEvents.OvfleetEvents_        <- the NEXT event, shown always (copy of the first event)
  div.allFleetsEvent (display:none until toggled) > div#OvfleetEvents.OvfleetEvents_   <- one per event, first one = duplicate
  (div#OvfleetContent again ... div.allFleetsEvent ...)
each .OvfleetEvents_:
  span#fleettime_<endUnix><fleetId>.fleets[data-fleet-end-time=<endUnix>][data-fleet-time=<restSec>]  "00:16:46"
  span.fleet_static_time[data-fleet-end-time="10:20:29"]  "10:20:29"
  span > span.<flight|return|holding>.<own?><style>  "One of your <a class=tooltip>Fleets</a><span class=textForBlind> (8290 Recycler)</span> from Planet <name> <a href=page=galaxy...>[2:68:5]</a> reached the debris <a>[2:87:8]</a>. Mission: Recycle"
```

* Key = `fleet_end_time . fleet_id` [UPSTREAM includes/classes/class.FlyingFleetsTable.php:111]: `fleettime_1793348429396900` -> end `1793348429`, fleet id `396900` (= `fleetID` in fleetTable recall form [REAL fleetTable.html:593]). Outward and return of one fleet = 2 events with the same fleet id.
* Classes: status `flight` / `return` / `holding` + `own` prefix when the fleet is the player's + style [UPSTREAM class.FlyingFleetsTable.php:155-173]: 1 attack, 2 federation, 3 transport, 4 deploy, 5 hold, 6 espionage, 7 colony, 8 harvest, 9 destroy, 10 missile, 11 and 15 (expedition) `transport`. Seen live: `ownharvest`, `owncolony`.
* `.textForBlind` #1 = ships `(8290 Recycler)` (`(1 Colony Ship)`); #2 (only when cargo) = `(Ressources: 7382 Metal; 0 Crystal; 0 Deuterium)` [REAL fleetStep3.html]. Numbers there are NOT grouped. The `a.tooltip` `data-tooltip-content` has a ship table with grouped numbers (`8.290`).
* Coordinate links: outward = [origin, target]; return = [target, origin] (the sentence order flips) [REAL]. `GZLayout.fleetEvents` normalises to `from` = origin, `to` = target.
* Hostile fleets: no `own` prefix, owner link `Dialog.PM(<id>)` [UPSTREAM]; not seen live.
* Do NOT select `.fleets` globally: fleetTable has its own `td#fleettime_N.fleets` rows.

```js
const seen = new Set();
[...document.querySelectorAll('#messages_collapsed .OvfleetEvents_ > span.fleets[id^="fleettime_"]')].filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => {
  const line = s.parentElement.querySelector('span.flight, span.return, span.holding');
  return { id: s.id, end: +s.dataset.fleetEndTime, rest: +s.dataset.fleetTime, clock: s.nextElementSibling.textContent,
    cls: line.className, coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map(a => a.textContent),
    blind: [...line.querySelectorAll('.textForBlind')].map(b => b.textContent.trim()) };
})
// overview.html ->
// {"id":"fleettime_1793348429396900","end":1793348429,"rest":1012,"clock":"10:20:29","cls":"flight ownharvest","coords":["[2:68:5]","[2:87:8]"],"blind":["(8290 Recycler)"]}
// {"id":"fleettime_1793350031396900","end":1793350031,"rest":2614,"clock":"10:47:11","cls":"return ownharvest","coords":["[2:87:8]","[2:68:5]"],"blind":["(8290 Recycler)"]}
```

`GZLayout.fleetEvents` on fleetStep3.html returns 4 events (colony outward/return with cargo text, recycler outward/return). Live JS (overview.js) counts `data-fleet-time` down and writes `-` at 0; it never reloads for fleets.

## 8. Player

| datum | selector / source | sample | tag |
|---|---|---|---|
| name | `#playerName .textBeefy a` (link to settings) | `vodoleyko1992` | [REAL all] |
| rank | `#bar a[href*="page=statistics"]` param `range` | `194` (193 on later pages) | [REAL all] |
| points, rank, player count | overview `#scoreContentField` | `489 (Position 194 of 547)` | [REAL overview] |
| unread messages | `.messages-section .new-msg-count` (absent/empty = 0 [GUESS]) | `2` | [REAL all] |
| vacation | `var vacation = 0;` in `#links` script | `0` | [REAL all] |
| auth level | `var auth = 0;` in head | `0` | [REAL all] |
| player id | NOT in header/head. Only via `Dialog.Playercard(<id>, '<name>')` on pages listing the player: tournament [REAL] (also statistics/alliance [UPSTREAM]); galaxy rows of OTHER players | `4377` | [REAL tournament.html:717] |
| online players | overview `.online-title span` | `4` | [REAL overview] |
| language / skin | `var Lang = "en"`, `var Skin = "./styles/theme/gow/"` | | [REAL] |

```js
({ name: document.querySelector('#playerName .textBeefy').textContent.trim(),
   rank: +new URL(document.querySelector('#bar a[href*="page=statistics"]').href).searchParams.get('range'),
   unread: +document.querySelector('.messages-section .new-msg-count')?.textContent.trim() || 0,
   vacation: +[...document.scripts].map(s => s.textContent).join('').match(/var\s+vacation\s*=\s*(\d+)/)[1],
   idFromPlayercard: (() => { const n = document.querySelector('#playerName .textBeefy').textContent.trim();
     for (const a of document.querySelectorAll('a[onclick*="Dialog.Playercard("]')) { const m = a.getAttribute('onclick').match(/Playercard\((\d+),\s*'([^']*)'/); if (m && m[2] === n) return +m[1]; } return null; })() })
// overview.html   -> {"name":"vodoleyko1992","rank":194,"unread":2,"vacation":0,"idFromPlayercard":null}
// tournament.html -> {"name":"vodoleyko1992","rank":194,"unread":2,"vacation":0,"idFromPlayercard":4377}

const t = document.querySelector('#scoreContentField').textContent.replace(/\s+/g, ' ').trim();
const m = t.match(/^([\d.]+) \(\D*(\d+)\D+([\d.]+)\)/);
({ text: t, points: +m[1].replace(/\./g, ''), rank: +m[2], players: +m[3].replace(/\./g, '') })
// overview.html -> {"text":"489 (Position 194 of 547)","points":489,"rank":194,"players":547}
```

Points are rounded thousands-of-resources (2Moons). The player name is HTML-escaped in `onclick` (quotes become `&#39;`, decoded by `getAttribute`); names with `'` would break the regex [GUESS, rare]. No character class, no officer levels in the header (officers: page=officier).

## 9. Overview page specifics [REAL overview.html]

```
#inhalt > div#planet[style="background-image:url(./styles/theme/gow/planeten/dschjungelplanet07.jpg)"]
  h2 > a.tooltip[onclick="return Dialog.PlanetAction();"] > p.planetNameOverview "Overview -" + span#planetNameHeader "Главная планета"
  div#moon  "&nbsp;"   (moon link here when the planet has a moon: upstream <a href="game.php?page=overview&cp=<moonId>&re=0"> [UPSTREAM page.overview.default.tpl:48]; GALAXYZ markup unknown)
  div#planetdata > div#planetDetails > table:
     .online-title span "4" ; a.brn-recruit (Dialog.Refferal)
     #diameterContentField "20.000 km (<a>259</a> / <a>405</a> Fields)"
     #temperatureContentField "Approximately 32°C to 72°C"
     #positionContentField a[href*=page=galaxy&galaxy=2&system=68] "[2:68:5]"
     #scoreContentField "489 (Position <a href=...statistics&range=194>194</a> of 547)"
  div#planetOptions > a.planetMoveStart[href*=page=relocate] "Planetarium"
div.c-left, div.c-right
div.content-box-s x3 > div.smallbox > div.header > h3 ("Buildings" | "Research" | "Hangar") + div.content > table.construction.active
```

```js
({ name: document.querySelector('#planetNameHeader').textContent.trim(),
   diameter: document.querySelector('#diameterContentField').textContent.replace(/\s+/g, ' ').trim(),
   temp: document.querySelector('#temperatureContentField').textContent.replace(/\s+/g, ' ').trim(),
   pos: document.querySelector('#positionContentField a').textContent, online: +document.querySelector('.online-title span').textContent,
   moon: document.querySelector('#moon').innerHTML.trim() })
// overview.html -> {"name":"Главная планета","diameter":"20.000 km (259 / 405 Fields)","temp":"Approximately 32°C to 72°C","pos":"[2:68:5]","online":4,"moon":"&nbsp;"}
```

Construction boxes (build/research/shipyard queues): all three idle on the real page. Idle = `td.idle` with link to `page=buildings|research|shipyard` and the (copy-pasted, wrong for buildings/research) text "There is currently nothing being produced in the hangar." Note `table.construction` has class `active` even when idle: do not use `.active` as "busy". Active markup: **not seen**. Live overview.js:13-21 counts down every `.timer` by `data-time` (seconds) and reloads overview at 0, so an active box most likely contains upstream `<div class="timer" data-time="<sec>">` after `<name> (<level>)` [UPSTREAM page.overview.default.tpl:51-53] [GUESS for GALAXYZ]. The per-planet `i.buildingIco` in the planet list (4.2) is the reliable "building in progress" flag (no end time).

```js
[...document.querySelectorAll('#inhalt > .content-box-s')].map(b => ({ h3: b.querySelector('h3').textContent.trim(),
  idle: !!b.querySelector('td.idle'), link: b.querySelector('a[href*="page="]')?.href.split('?')[1], timer: b.querySelector('.timer[data-time]')?.dataset.time ?? null }))
// overview.html -> [{"h3":"Buildings","idle":true,"link":"page=buildings","timer":null},{"h3":"Research","idle":true,"link":"page=research","timer":null},{"h3":"Hangar","idle":true,"link":"page=shipyard","timer":null}]
```

Exact queue end times: take them from page=buildings / research / shipyard (see buildings spec), not from overview.

## 10. Left menu and insertion points

`#links > ul#menuTable > li` x11, identical on all 20 real pages; no "current page" marker class. Each `li`:

```html
<li>
  <span class="menu_icon"><a class="Imperium tooltipRight js_hideTipOnMobile " href=".../game.php?page=imperium" title="Empire" target="_self"></a></span>
  <a class="menubutton " href=".../game.php?page=overview" target="_self"><span class="textlabel">Overview</span></a>
</li>
```

The icon slot is a second link to a related page (or a plain `img` / `div.Satinal`). Two `li` are commented out in HTML.

```js
[...document.querySelectorAll('#menuTable > li')].map(li => (li.querySelector('.menu_icon a')?.className.split(' ')[0] || li.querySelector('.menu_icon img, .menu_icon div')?.tagName)
  + ' -> ' + new URL(li.querySelector('a.menubutton').href).search + ' "' + li.querySelector('.textlabel').textContent.trim() + '"')
// overview.html -> ["Imperium -> ?page=overview \"Overview\"", "Resources -> ?page=buildings \"Buildings\"", "FleetTrader -> ?page=trader \"Market\"",
//   "Research -> ?page=research \"Research\"", "Tersane -> ?page=shipyard&mode=fleet \"Hangar\"", "IMG -> ?page=shipyard&mode=defense \"Defenses\"",
//   "Filo -> ?page=fleetTable \"Fleet\"", "Galaxy -> ?page=galaxy \"Galaxy\"", "IMG -> ?page=alliance \"Alliance\"", "IMG -> ?page=officier \"Officers\"", "DIV -> ?page=premium \"Premium\""]
```

Icon-link mapping (useful for "hidden" pages): Imperium->imperium, Resources->resources, FleetTrader->fleetDealer, Research->techtree, Tersane->tournament, Filo->transport, Galaxy->donatebis (Shop).

Recommended insertion points (verified present on all 20 real pages unless noted):

| what | where | why |
|---|---|---|
| our menu entry | `document.querySelector('#menuTable').appendChild(li)` with the same `li > span.menu_icon + a.menubutton > span.textlabel` markup (own icon in `span.menu_icon`, `a.menubutton` with `href="javascript:void 0"` or `#`) | inherits skin styles; do NOT append to `#links` (it ends with the ticker `<script>`) |
| floating panel | `document.body.appendChild(panel)` with `position:fixed; z-index > 5` (event box uses `z-index:5`; fancybox overlay ~1100) | `#rechts` is missing on info pages and fleetStep3; body is always there; no layout shift |
| top-bar link (optional) | `#bar > ul` append `li > a` | present on all pages |
| per-page content | `#inhalt` (after `#messages_collapsed` when present) | the only content root; `#content` exists only on galaxy |
| footer link (optional) | `#siteFooter .fright` | position of `#siteFooter` varies, query globally |

Recipe `GZLayout.anchors(document)` returns `{menu, menuBefore, topBar, rightColumn, content, footer}`; survey: `menu,topBar,rightColumn,content,footer` on 18 pages, `menu,topBar,content,footer` on transport and fleetStep3.

## 11. What `tournament.html` is [REAL tournament.html]

page=tournament (menu icon `a.Tersane` next to "Hangar"): a GALAXYZ-only weekly tournament page, not part of 2Moons. `.headerRS` "Tournament", `#achivment` with countdown `span.countdown2[secs="178960"]` "02d 01h 42m: 41s" (seconds until the round ends), tabs `.ach_menu li.skils1..5` (Alpha..Epsilon; Zeta commented), each tab `div#skilsN.ach_content_box` with three ranked tables: "Victory tournament" (battle points for destroyed units), "Moon Destruction tournament", "Dark Matter expedition tournament"; prizes 20.000 / 15.000 / 10.000 units (dark matter icon `atm.gif`). Rows: position, `a[onclick="return Dialog.Playercard(<id>, '<name>')"]`, points (`2.5` decimal point!). Duplicated id `#ach_batle_level` x10. Useful for us only as the source of the own player id (section 8).

## 12. Number / text format summary

| kind | example | parse |
|---|---|---|
| grouped integer (PHP + JS `number_format`) | `1.408.320.362`, `20.000 km`, `47.480` | remove `.`; decimals use `,` (`41,7`) |
| JS short (`shortly_number`, NBSP before unit) | `1.411&nbsp;M` (= 1.411e9), `229&nbsp;M` | value * 1e3/1e6/1e12/1e18 for K/M/B/T; avoid |
| PHP short (energy/DM cells) | `47.5K`, `4K`, `2.5K` | `.` is decimal; avoid, use `t=` / `data-real` |
| floats in JS | `available: (1408320361.5606675)` | `+` |
| ungrouped integer in event text | `(8290 Recycler)`, `7382 Metal` | `+` |
| coords | `[2:68:5]` | `/\[(\d+):(\d+):(\d+)\]/` |
| durations | `00:16:46` (h may exceed 24), countdown2 `02d 01h 42m: 41s` | prefer `data-fleet-time` / `secs` |
| dates | `30. Oct 2026, 10:20:01` (fleetStep3, messages) | see fleet/messages specs |

## 13. Whole-page result (`GZLayout.parseLayout`) on all real pages (`tools/survey_layout.js`, RUN)

```
buildings.html   {"det":"true/galaxyz","route":"buildings/show/body=buildings","tz":7200000,"render":1793347425,"cur":254102,"n":4,"tt":4,"bld":"254103,254104,254105","res":"111","en":"438/47480","dm":3981,"ev":2,"pl":"vodoleyko1992#194 msg2","anchors":"menu,topBar,rightColumn,content,footer"}
fleetStep3.html  {"det":"true/galaxyz","route":"fleetStep3/show/body=fleetStep3","tz":7200000,"render":1793347748,"cur":254102,"n":4,"tt":0,"bld":"","res":"111","en":"2502/49544","dm":606,"ev":4,"pl":"vodoleyko1992#194 msg2","anchors":"menu,topBar,content,footer"}
imperium.html    {"det":"true/galaxyz","route":"imperium/show/body=imperium","tz":7200000,"render":1793347533,"cur":254102,"n":4,"tt":4,"bld":"254104,254105","res":"111","en":"2502/49544","dm":606,"ev":2,...}
messages-all.html{"det":"true/galaxyz","route":"messages/show/body=messages",...,"ev":4,"pl":"vodoleyko1992#193 msg2",...}
shipyard-defense {"det":"true/galaxyz","route":"shipyard/defense/body=shipyard",...}
transport.html   {"det":"true/galaxyz","route":"transport/show/body=shipyard","tz":null,"render":null,"cur":254102,"n":4,"tt":0,"bld":"","res":"111","en":"2502/49544","dm":606,"ev":0,...,"anchors":"menu,topBar,content,footer"}
(all 20 pages: det true, res 111, cur 254102, n 4; tt = planets with tooltip data = 0 where #rechts is missing)
```

`overview` result on the real overview (from `fixtures/layout-expected-parse.json`, regenerate with `check_layout.js --write`):
`{planetName:"Главная планета", diameter:20000, fieldsUsed:259, fieldsMax:405, tempMin:32, tempMax:72, coords:"2:68:5", points:489, rank:194, players:547, onlinePlayers:4, moonId:null, constructions:[3 x idle], events:[2]}`; live DOM and DOMParser parse are identical (`sameAsDomParser: true`) on all 4 inputs.

## 14. Mapping to the current core (`CORE_API.md`) - what must change

* `page.isOgx` (05-page.js): replace csrf/ogame-version checks by section 1. `page.info().name` from `page`(+`mode`) of section 2: `overview, buildings, research, shipyard(mode fleet|defense), resources, fleetTable, fleetStep1-3, galaxy, imperium, messages, officier, trader, fleetDealer, techtree, tournament, transport, statistics, alliance, premium, ...`. Map OGX PageName: `buildings`->facilities+resources(buildings are one page here), `shipyard&mode=defense`->defense, `fleetTable`->fleet/movement, `trader`->merchant, `officier`->premium(officers).
* `state.snapshotSync`: current = 4.1, planets = 4.1+4.2 (merge by id), resources = 5.1 (+5.2 energy/DM), player = 8, events = 7 (on every page).
* `time`: render instant from 6; tz rounding to 15 min; ServerTimezoneOffset is the user/server tz difference, not UTC.
* There is no CSRF meta; forms carry their own hidden `token` (fleet steps) [REAL fleetStep1-2].

## 15. Open questions

1. Moon markup live: selector text `(Moon)`? planet list entry (`a.moonlink`?) ? `#moon` content on overview? `#planetImage` = `s_mond.gif`? Need one saved page from an account with a moon, ideally with the moon active.
2. Active construction box markup on overview (building/research/shipyard running): need a saved overview while something is being built.
3. Hostile/foreign fleet event markup (class without `own`, `Dialog.PM`), expedition (`owntransport` to position 16?) and holding (`holding`) events: not seen.
4. Popup windows (`body.popup`, e.g. `?page=notes` via `OpenPopup`, `TechnologyDetailsAjax`): do they contain `#planetSelector`? (upstream: no). Boot must not crash there.
5. Vacation mode / negative energy rendering of `t=` and `var vacation = 1`.
6. Unread messages = 0: is `span.new-msg-count` present but empty, or absent?
7. Server timezone is UTC+2 at the end of October (after DST end): confirm whether it changes with DST (store it, recalibrate on every page with an event).
