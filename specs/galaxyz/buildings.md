# GALAXYZ (ogamex.eu) buildings, research, shipyard, resources, techtree, officers, trader, scrap dealer: spec for content scripts

Target: `https://ogamex.eu/Aeternum/game.php?page=<name>[&mode=..][&cp=<planetId>]`, `<meta name="generator" content="GALAXYZ 1.8.git">`, a modified 2Moons 1.8 (PHP + Smarty + jQuery), English UI. Pages covered:

- `page=buildings`, `page=research`, `page=shipyard&mode=fleet|defense` (lists, forms, buildable flags, queue boxes)
- the details panels loaded by AJAX (`TechnologyDetailsAjax`, `ResearchDetailsAjax`, `ShipDetailsAjax`, `CommanderDetailsAjax`)
- `page=resources` (production table + production % form), `page=techtree` (requirements)
- `page=officier`, `page=trader`, `page=fleetDealer` (scrap merchant, the only page that prints the server's unit price list)
- the element catalog `elements.json` (ids, names, costs, factors, requirements, ship stats, with a source tag per field)

Layout (resource bar, planet list, `cp`, server time, overview fleet events) is in `galaxyz/layout.md`; fleet dispatch in the fleet spec. The old lanedirt-OgameX spec is `specs/buildings.md`; nothing in it applies to GALAXYZ markup.

## 0. Sources, tags, files

| Tag | Meaning |
|---|---|
| **[REAL page.html]** | Seen in a page saved from the live server on 2026-10-30 (`scratchpad/eu/pages/<page>.html`). Line numbers are of those files (`eu/<page>:<line>`). |
| **[REAL-JS]** | Read from the fork's own JavaScript (inline in those pages, or `eu/overview/*_files/base.js`, which every page loads). Shows what markup the fork expects; the markup itself was not seen. |
| **[UPSTREAM file:line]** | Only in 2Moons (`scratchpad/src/2Moons`). The fork may differ. |
| **[INFERRED]** / **[DERIVED]** | Concluded from REAL data; the reasoning is given. |
| **[SYNTHETIC]** | Run against a fixture built from REAL-JS selectors, not against a real response. |

Upstream short paths: `B` = `includes/pages/game/ShowBuildingsPage.class.php`, `R` = `ShowResearchPage.class.php`, `S` = `ShowShipyardPage.class.php`, `RS` = `ShowResourcesPage.class.php`, `T` = `ShowTraderPage.class.php`, `FD` = `ShowFleetDealerPage.class.php`, `O` = `ShowOfficierPage.class.php`, `BF` = `includes/classes/class.BuildFunctions.php`, `FF` = `includes/classes/class.FleetFunctions.php`, `SQL` = `install/install.sql`, `tpl/*` = `styles/templates/game/*`, `GF` = `includes/GeneralFunctions.php`.

Files of this area (all under `ogx/specs/galaxyz/`):

| File | What |
|---|---|
| `buildings.md` | this spec (rendered from `tools/buildings/buildings.md.src`, which inlines the recipe files) |
| `elements.json` | element catalog, every field with `src` (§12) |
| `tools/buildings/recipes/R1..R12-*.js` | the parsing recipes printed below, each `(doc = document) => result`, no dependencies, no jQuery |
| `tools/buildings/run-recipe.js` | `node run-recipe.js <page.html> <recipe.js> [--full]`: Chromium (Playwright), **JavaScript disabled**, network blocked, `page.setContent(realHtml)`, evaluates the recipe, prints JSON. All "Observed output" blocks below come from it. (jsdom is not installed.) |
| `tools/buildings/extract-real.js` | runs every recipe on its real page, writes `tools/buildings/_real.json` |
| `tools/buildings/verify-buyable.js` | checks "button present <=> next level affordable" with `elements.json` prices (§3.6) |
| `tools/buildings/gen_elements.py` | `python3 -I gen_elements.py <src/2Moons> ../../elements.json`: upstream SQL + `_real.json` -> `elements.json` |
| `tools/buildings/parse-buildings.js` + `verify.js` | older all-in-one bundle (`window.GZBuild`) incl. upstream-queue fallbacks and overview boxes; `node verify.js` re-runs it on `fixtures/buildings-*.html` -> `fixtures/buildings-expected-parse.json` |
| `fixtures/buildings-real-*.html` | REAL pages copied byte for byte plus one comment: buildings, research, shipyard-fleet, shipyard-defense, resources, techtree, overview, officier, trader, fleetDealer |
| `fixtures/buildings-upstream-*.html` | rendered from upstream templates (queue fallbacks only; the fork does NOT use these list layouts) |
| `fixtures/buildings-details-*-HYPOTHETICAL.*` | details panel/AJAX body built only from the selectors `base.js` reads |

Reproduce everything: `cd tools/buildings && node extract-real.js && python3 -I gen_elements.py <src/2Moons> ../../elements.json && node verify-buyable.js`.

---

## 1. Porting checklist (what differs from lanedirt OgameX / official OGame)

1. **URLs**: `game.php?page=<name>`; all buildings (mines, storage, facilities) on **one** page `page=buildings`; hangar `page=shipyard&mode=fleet` (default mode), defense `page=shipyard&mode=defense`. **[REAL]** menu links.
2. **Page detection**: `body#buildings|research|shipyard|resources|techtree|officier|trader|fleetDealer` plus inline `var queryString = "page=shipyard&mode=defense"` (fleet and defense share `body#shipyard`). Do not use headings: the research list `<h3>` reads "Buildings" (`eu/research:580`). Recipe R9 (§2.1).
3. **No CSRF token** on these forms: every action is a plain `<form method="post">` answered by a 302 back to the list page (no JSON, no error text). (Fleet forms DO carry a `token`; not here.) **[REAL]** forms, **[UPSTREAM]** `B:245-269`, `R:331-356`, `S:145-184`, `RS:27-65`.
4. **No timers on list items**: no `data-status="active"`, `data-start/end`, `time-counter`. Running work only shows in the separate "... under construction" box (§5), seen empty only.
5. **Levels**: buildings and units `span.level[data-value]`; research has **no** `data-value`, only the text of `span.level`.
6. **Status**: only `div.icon[data-status="off"]` (requirements unmet) exists. "Can start now" = `button.upgrade` present (buildings, research). Units have no button, only a hidden form ordering 1 unit.
7. **Ids are 2Moons ids**: 213 Star Fighter, 214 Battle Fortress, 215 Battle Cruiser, 216 Black Moon, 217 Battle Transporter, 218 Avatar, 219 Battle Recycler, 220 Dark Matter Collector, 124 Expedition Research (factor 1.75), 6 University, 131-133 Mineral/Semi-Crystals/Fuel Research, 409-411, and fork-only **71-73 conveyors**. No 36, no lifeforms.
8. **Duplicated ids** on every list page: `#navcontainer`, `#supplies`, `#technologies` (2 each: queue box + list); `#planetList`, `#myWorlds`, `#OvfleetEvents`, `#OvfleetContent`, `#fleettime_<n>` (layout); on fleetDealer every unit has `id="shipID"`. Never `getElementById` these; select by structure (`ul.icons`, `form#scrap .unit-item`).
9. **Two incompatible short number formats** on the same page (pitfall, §14): server `shortly_number` "3.417&nbsp;M" (= 3,417 x 10^6; `.` = thousands; M=1e6, **B=1e12**) vs fork header text "47.5K" / "4K" (`.` = decimal). Always prefer `data-real`, `data-value`, `data-tooltip-content`, inline JSON.
10. **Encoding**: UTF-8 (`<meta charset=UTF-8>`); planet names are Cyrillic ("Главная планета"); titles carry HTML-escaped markup (`title="University&lt;br&gt;Requirements are not met!"`, i.e. the DOM attribute value contains a literal `<br>`).

---

## 2. Endpoints

`game.php` dispatches `page` to `Show<Page>Page` and `mode` to the method of that name, else `show()` **[UPSTREAM game.php:27-57]**. Any request accepts `&cp=<planetId>` to switch the session's current planet first **[UPSTREAM Session.class.php:291-310]**; the planet list links use it (`game.php?page=buildings&cp=254102`) **[REAL]**. Params come from `$_REQUEST` (GET or POST body); the build handlers additionally require `REQUEST_METHOD === 'POST'`.

| Method | URL | Params | Effect | Tag |
|---|---|---|---|---|
| GET | `game.php?page=buildings` | | list | REAL |
| POST | `game.php?page=buildings` | `cmd=insert&building=<id>` | queue next level (`B:260-262`, `B:124-207`) | REAL form `eu/buildings:585-588` |
| POST | same | `cmd=destroy&building=<id>` | queue demolition of one level | UPSTREAM `B:263-265` |
| POST | same | `cmd=cancel` | cancel the running (first) item, refund | UPSTREAM `B:254-256`, `B:27-76` |
| POST | same | `cmd=remove&listid=<n>` | drop queue position n (1-based, n>=2) | UPSTREAM `B:257-259` |
| GET/POST | `game.php?page=research` | `cmd=insert&tech=<id>`, `cmd=cancel`, `cmd=remove&listid=<n>` | as above, research | REAL form `eu/research:591-594`; rest UPSTREAM `R:331-356` |
| GET | `game.php?page=shipyard&mode=fleet` / `&mode=defense` | | list | REAL |
| POST | `game.php?page=shipyard` | `fmenge[<id>]=<n>` (several ids allowed); real form also sends `cmd=insert` (ignored upstream) | order units; paid at order time | REAL form `eu/shipyard-fleet:583-586`; UPSTREAM `S:145-184`, `S:74-133` |
| POST | `game.php?page=shipyard&mode=<m>` | `action=delete&auftr[]=<idx>` (0-based) | cancel queue entries, 60 % refund (`FACTOR_CANCEL_SHIPYARD`) | UPSTREAM `S:30-72` |
| POST | `game.php?page=resources` | `mode=send&prod[<id>]=0..10` (x10 %) | production % per producer | REAL form `eu/resources:553-585`; UPSTREAM `RS:27-65` |
| GET | `game.php?page=TechnologyDetailsAjax&technology=<id>` | | JSON text `{target, content:{[target]: html}}` (buildings) | REAL-JS `eu/buildings:827` |
| GET | `game.php?page=ResearchDetailsAjax&technology=<id>` | | same, research | REAL-JS `eu/research:1031` |
| GET | `game.php?page=ShipDetailsAjax&technology=<id>` | | same, ships + defense | REAL-JS `eu/shipyard-fleet:806`, `eu/shipyard-defense:740` |
| GET | `game.php?page=CommanderDetailsAjax&technology=<601..615>&type=undefined` / `&dm=1&type=undefined` | | same, officer / Dark Matter tile (`data-type` attr is never set, so `type=undefined` is literally sent) | REAL-JS `eu/officier:1006,1027` |
| POST | `game.php?page=officier` | `id=<601..615>` | buy one officer level (form lives in the AJAX panel, not seen) | UPSTREAM `O:56-97`, `tpl/page.officier.default.tpl:35-44` |
| GET | `game.php?page=techtree` | | all requirements | REAL |
| GET | `game.php?page=information&id=<id>` | | info popup (`Dialog.info(id)`, base.js:150-151) | REAL-JS; content UPSTREAM |
| POST | `game.php?page=trader` | `mode=trade&resource=901|902|903|921` | opens the exchange form for that resource (costs the merchant fee) | REAL forms `eu/trader:568-601` |
| POST | `game.php?page=trader` | `mode=send&resource=<id>&trade[<otherId>]=<amount>` | exchange | UPSTREAM `T:78-180`, `tpl/page.trader.trade.tpl:3-29` (921 in the fork only) |
| POST | `game.php?page=fleetDealer` | `mode=multiSend&ships[<id>]=<n>` (several) | scrap units | REAL form `eu/fleetDealer:613-620` (upstream had `mode=send&shipID&count`, `FD:28-60`) |
| POST | `game.php?page=fleetDealer` | `mode=bargain` | renegotiate the scrap % for 5000 DM (+5000 per round, max 90 %) | REAL form `eu/fleetDealer:598-605`, tooltip text |
| GET | `game.php?page=imperium` | | levels/amounts of every planet (`table.empire`) | REAL (owned by layout) |

Server-side checks **[UPSTREAM]** (failures are silent; the answer is still the 302 to the list):
- **insert (buildings)**: allowed on this planet type, requirements met (`BF:110-127`, research = user value, buildings = **current planet** value); not 31 (and 6) while research runs; not 15/21 while the hangar queue is non-empty; at most `max_elements_build` (default 5) items; a free field; `<= maxLevel`; resources are checked **only when the queue is empty** (the first item is paid at once, later ones when they start and are dropped if unaffordable then).
- **research**: at most `max_elements_tech` (default 2); not while 6 or 31 is in this planet's building queue (`R:29-42`); player-wide queue that remembers the planet.
- **units**: nothing while 21 or 15 is in the building queue (`S:148-167`); at most `max_elements_ships` (default 10) queue entries; amount clamped to `max_fleet_per_build` (default 1,000,000) and to what is affordable (`BF:188-219`); missiles clamped to `level(44) x 10 x silo_factor` slots (502 = 1 slot, 503 = 2; `BF:221-250`); `onePerPlanet` (407, 408, 409, 411) limited to 1.
- **Vacation mode** blocks every POST.
- **Confirm** an action by re-parsing the returned page (queue box, level), never by status text.

### 2.1 Page detection (R9)

```js
// R9: which page am I on (REAL: <body id> + inline `var queryString`). Shipyard fleet/defense share body id "shipyard".
(doc = document) => {
  let qs = '';
  for (const s of doc.querySelectorAll('script:not([src])')) { const m = s.textContent.match(/var\s+queryString\s*=\s*"([^"]*)"/); if (m) { qs = m[1]; break; } }
  const q = new URLSearchParams(qs);
  return { bodyId: doc.body.id, queryString: qs, page: q.get('page'), mode: q.get('mode'),
           detailsAjax: (doc.documentElement.innerHTML.match(/page=(\w+DetailsAjax)/) || [])[1] || null,
           generator: doc.querySelector('meta[name=generator]')?.content };
}
```
Observed (all 9 pages, `extract-real.js`):
```
buildings        {"bodyId":"buildings","queryString":"page=buildings","page":"buildings","mode":null,"detailsAjax":"TechnologyDetailsAjax","generator":"GALAXYZ 1.8.git"}
research         {"bodyId":"research","queryString":"page=research",...,"detailsAjax":"ResearchDetailsAjax"}
shipyard-fleet   {"bodyId":"shipyard","queryString":"page=shipyard&mode=fleet","page":"shipyard","mode":"fleet","detailsAjax":"ShipDetailsAjax"}
shipyard-defense {"bodyId":"shipyard","queryString":"page=shipyard&mode=defense","page":"shipyard","mode":"defense","detailsAjax":"ShipDetailsAjax"}
resources|techtree|trader|fleetDealer  {"bodyId":"<same as page>",...,"detailsAjax":null}
officier         {"bodyId":"officier",...,"detailsAjax":"CommanderDetailsAjax"}
```
On a live page `location.search` may lack `page=` (e.g. after a POST redirect to `game.php?page=buildings` it is there, but `game.php` alone means overview); `queryString` is what the server rendered.

---

## 3. List pages: buildings, research, shipyard [REAL]

### 3.1 Containers

| Page | Box | Selector | Order on the saved (planet) page |
|---|---|---|---|
| buildings | queue box | first `#technologies` (no `ul.icons`), `h3` " Buildings under construction", `.bottom-side .largebox` (`eu/buildings:563-570`) | |
| buildings | list | `ul.icons > li.technology.has_details[data-technology]` (`eu/buildings:577-`) | 1 2 3 4 6 12 14 15 21 22 23 24 31 33 34 44 71 72 73 |
| research | queue box | `h3` " Research under construction" (`eu/research:567`) | |
| research | list | `ul.icons > li.technology.has_details#button<ID>[data-technology]` | 106 108 109 110 111 113 114 115 117 118 120 121 122 123 124 131 132 133 199 |
| shipyard fleet | queue box | `h3` " Ships under construction" (`eu/shipyard-fleet:559`) | |
| shipyard fleet | list | `ul.icons > li.technology.has_details[data-technology]` | 208 220 202 203 204 205 210 212 206 207 209 211 213 215 217 219 214 216 218 |
| shipyard defense | queue box | `h3` " Ships under construction" (same text) | |
| shipyard defense | list | same | 407 408 409 411 502 503 401 402 403 404 405 406 410 |

Above the list: `#planet[data-anchor=technologyDetails] > h2` (header) and `#technologydetails_wrapper > #technologydetails_content` (empty slot the AJAX panel fills). Unlike upstream (which skips inaccessible elements, `B:291`, `S:233`), the fork lists **every** element and marks unmet requirements `off`.

### 3.2 Building item (`eu/buildings:583-592`)
```html
<li class="technology has_details " data-technology="1">
  <button class="upgrade" onclick="document.getElementById(&#39;build_form1&#39;).submit();"></button>
  <div class="icon sprite sprite_medium medium tooltipTop hideOthers js_hideTipOnMobile metal_mine" title="Metal Mine">
    <form action="https://ogamex.eu/Aeternum/game.php?page=buildings" method="post" class="build_form" id="build_form1" style="display:none">
      <input type="hidden" name="cmd" value="insert">
      <input type="hidden" name="building" value="1">
    </form>
    <span class="level" data-value="38" data-bonus="0"><span>38</span><span class="bonus"></span></span>
  </div>
</li>
```
Requirements unmet (`eu/buildings:629-634`): `<div class="icon ... university" style="background: url(./styles/theme/gow/gebaeude/6.png)..." title="University&lt;br&gt;Requirements are not met!" data-status="off">` with `span.level[data-value=0]`, **no form, no button**.

| Datum | Selector | Sample | Tag |
|---|---|---|---|
| id | `li[data-technology]` | `1` | REAL |
| level | `span.level[data-value]` | `38` (`data-bonus="0"` everywhere) | REAL |
| name | `div.icon[title]` up to first `<br>` | `Metal Mine` | REAL (Tipped may move `title` away after load: read early or use `elements.json`) |
| key | last class of `div.icon` | `metal_mine`, `hangar`, `silo`, `conveyor1` | REAL (= 2Moons `vars.name`) |
| can start | `li > button.upgrade` exists | 16 of 19 | REAL; meaning §3.6 |
| requirements unmet | `div.icon[data-status="off"]` | id 6 | REAL |
| form | `form#build_form<ID>.build_form` | `cmd=insert&building=<ID>` | REAL: present whenever requirements are met, even if unaffordable |

### 3.3 Research item (`eu/research:582-605`)
```html
<li class="technology has_details " id="button106" style="width:99px;height:100px;margin:6px 2px" data-technology="106" title="Spy Technology ">
  <div class="premium"><div class="icon sprite sprite_medium medium spy_tech" style="padding:0;width:95px;height:95px;">
    <button class="upgrade" type="button" onclick="(function(btn){ if(btn.dataset.busy===&#39;1&#39;) return; btn.dataset.busy=&#39;1&#39;; btn.disabled=true; document.getElementById(&#39;build_form106&#39;).submit(); })(this);" style="z-index:10000"></button>
    <form action="https://ogamex.eu/Aeternum/game.php?page=research" method="post" class="build_form" id="build_form106" style="display:none">
      <input type="hidden" name="cmd" value="insert"><input type="hidden" name="tech" value="106">
    </form>
    <a ... class="detail_button tooltipTop js_hideTipOnMobile slideIn tpd-hideOnClickOutside" data-technology="106" title="Spy Technology" ...>
      <span class="ecke" style="top: 84px;left: 1px;"><span class="level" style="padding: 0 5px;">12</span></span>
    </a>
  </div></div>
</li>
```
- Level = **text** of `span.level` (`12`), no `data-value`. Name in `li[title]` (trailing space) or `a.detail_button[title]`; no `title` on `div.icon`.
- `data-technology` appears twice per item (`li` and `a`): dedupe by id, or select `li` only.
- Unavailable (199 Graviton: 300,000 energy) -> **both** button and form missing (`eu/research:996-1008`); on buildings the form stays. Research with unmet requirements never occurred on the saved page (all met), so its markup is unknown (probably `data-status="off"` like buildings).

### 3.4 Ship / defense item (`eu/shipyard-fleet:581-593`)
```html
<li class="technology has_details" data-technology="208">
  <div class="icon sprite sprite_medium medium tooltipTop hideOthers js_hideTipOnMobile 208" style="background: url(&#39;./styles/theme/gow/gebaeude/208.png&#39;); ..." title="Colony Ship">
    <form action="https://ogamex.eu/Aeternum/game.php?page=shipyard" method="post" class="build_form" id="build_form208" style="display:none">
      <input type="hidden" name="cmd" value="insert"><input type="hidden" name="fmenge[208]" value="1">
    </form>
    <span class="level" data-value="2"><span>2&nbsp;</span><span class="bonus"></span></span>
  </div>
</li>
```
- Amount = `span.level[data-value]` (`2`, `102`, `797`). Key class = numeric id.
- No `button.upgrade` on any unit; the amount input comes with `ShipDetailsAjax`. The hidden form orders **1** unit (defense forms also post to `page=shipyard`, `eu/shipyard-defense:583`).
- Requirements unmet: `div.icon[data-status=off]`, title suffix `<br>Requirements are not met!`, no form.
- Affordability of units is not shown; every unit with met requirements had a form, but all of them were affordable (open question 8).

### 3.5 Recipe R1 (all four list pages)
```js
// R1: items of page=buildings | research | shipyard&mode=fleet|defense (REAL markup; JS-free, works on a DOMParser doc)
(doc = document) => {
  const out = [], seen = new Set();
  // the list is the SECOND #technologies (the first one is the "... under construction" box) -> select by ul.icons, never by id
  for (const li of doc.querySelectorAll('ul.icons > li.technology[data-technology]')) {
    const id = +li.dataset.technology;
    if (seen.has(id)) continue; seen.add(id);
    const icon = li.querySelector('div.icon');
    const lv = li.querySelector('span.level');
    const form = li.querySelector('form.build_form');
    const title = icon?.getAttribute('title') || li.getAttribute('title') || '';   // research: title on <li> (trailing space) + a.detail_button
    out.push({
      id,
      name: title.split(/<br\s*\/?>/i)[0].trim(),             // "University<br>Requirements are not met!" -> "University"
      cssKey: icon ? [...icon.classList].at(-1) : null,       // upstream vars.name ("metal_mine", "conveyor1"); shipyard: the numeric id
      value: lv?.hasAttribute('data-value') ? +lv.dataset.value : +(lv?.textContent || '').replace(/\D/g, ''), // research has no data-value
      off: icon?.dataset.status === 'off',                     // requirements not met
      form: form ? Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) : null,
      button: !!li.querySelector('button.upgrade'),            // buildings/research only
    });
  }
  return out;
}
```
Observed (`node run-recipe.js eu/pages/<page>.html recipes/R1-list.js`, excerpts):
```
buildings (19): {"id":1,"name":"Metal Mine","cssKey":"metal_mine","value":38,"off":false,"form":{"cmd":"insert","building":"1"},"button":true}
                {"id":6,"name":"University","cssKey":"university","value":0,"off":true,"form":null,"button":false}
                {"id":15,"name":"Nanite Factory","cssKey":"nano_factory","value":10,"off":false,"form":{"cmd":"insert","building":"15"},"button":false}
                {"id":31,"name":"Research Lab","cssKey":"laboratory","value":21,"off":false,"form":{"cmd":"insert","building":"31"},"button":false}
                {"id":71,"name":"Light conveyor","cssKey":"conveyor1","value":1,...,"button":true}
research (19):  {"id":106,"name":"Spy Technology","cssKey":"spy_tech","value":12,"off":false,"form":{"cmd":"insert","tech":"106"},"button":true}
                {"id":199,"name":"Graviton Research","cssKey":"graviton_tech","value":0,"off":false,"form":null,"button":false}
fleet (19):     {"id":208,"name":"Colony Ship","cssKey":"208","value":2,"off":false,"form":{"cmd":"insert","fmenge[208]":"1"},"button":false}
                {"id":220,"name":"Dark Matter Collector","cssKey":"220","value":0,"off":true,"form":null,"button":false}   (8 off: 213-220)
defense (13):   {"id":407,"name":"Small Shield Dome","cssKey":"407","value":0,"off":false,"form":{"cmd":"insert","fmenge[407]":"1"},"button":false}
                {"id":409,"name":"Atmospheric Shield","cssKey":"409","value":0,"off":true,"form":null,"button":false}       (6 off: 404 409 410 411 502 503)
```

### 3.6 What `button.upgrade` means [REAL + DERIVED]

Upstream sets `buyable = QueueCount != 0 || isElementBuyable(...)` (`B:329`; the shipyard has no such exception, `S:239`): with an **empty** queue the button means "requirements met, free field, not busy, AND the next level is affordable"; with a non-empty queue it only means "can be appended". `tools/buildings/verify-buyable.js` checked the empty-queue case on the real pages with `price(L) = cost x factor^(L-1)` from `elements.json` and the stock from R11:

```js
// R11: resources on hand for affordability checks (REAL header): exact values in td[data-real].
// Energy t="438 / 47.480" = free / produced. Energy PRICES (Terraformer, Graviton) are checked against PRODUCED energy
// (2Moons getRestPrice uses $PLANET['energy'], class.BuildFunctions.php:58) -> 911 = second number.
(doc = document) => {
  const real = (id) => { const e = doc.getElementById(id); return e ? Math.floor(+e.dataset.real) : null; };
  const en = doc.querySelector('#resTable td.res_current.Imperium[t], td.res_current.Imperium[t]')?.getAttribute('t') || '';
  const [free, max] = en.split('/').map((s) => +s.replace(/\D/g, ''));
  return { 901: real('current_metal'), 902: real('current_crystal'), 903: real('current_deuterium'), 911: max, energyFree: free, 921: real('current_darkmatter') };
}
```
Observed:
```
buildings stock {"901":1412615756,"902":230077481,"903":351439906,"911":47480,"921":3981,"energyFree":438}
 15 L10->11 MATCH button=false off=false form=true short=[902]
 31 L21->22 MATCH button=false off=false form=true short=[902,903]
 33 L1->2  MATCH button=true  (energy price 2000 <= produced 47480; it would FAIL against free energy 438)
 71/72/73: cost UNKNOWN, button=true
 ... all other buildings MATCH button=true short=[]
research stock {"901":1420132698,"902":233276082,"903":352974404,"911":47480,...}
 199 L0->1 MATCH button=false off=false form=false short=[911]
 ... 18 others MATCH button=true
=> 35/35 match. Borderline cases 14 (crystal 125.8M vs 230M), 23, 24 (131M vs 230M) only match with factor^(L-1), not factor^L.
```
So: (a) the upstream prices/factors are in force on Aeternum for all 35 listed buildings/research, (b) energy prices are compared with **produced** energy (`$PLANET['energy']`, `BF:58`), (c) a missing button on a building with a form = unaffordable/busy/no field/max level (the list does not say which; use the details panel flags §4 or compute).

---

## 4. Details panel (AJAX) [REAL-JS, response never captured]

Click on `li.has_details` runs (`eu/buildings:812-845`; research `ResearchDetailsAjax`, shipyard `ShipDetailsAjax`, officers `CommanderDetailsAjax`):
```js
$.ajax({ url: './game.php?page=TechnologyDetailsAjax&technology=' + technologyId }).done(function (data) {
  var json = $.parseJSON(data);   // {target: "<key>", content: {"<key>": "<html>"}}
  $('#technologydetails_content').html(json.content[json.target]) ... });
```
`button.upgrade` clicks stop propagation (they do not open the panel). Close: `#technologydetails .close` (officers `#close`). A `.technology_tree[data-target]` link inside the panel loads a URL into `div.tech-dialog`.

Markup the panel must contain, from the fork's `base.js` block `[buildlist.js]` (`base.js:301-580`, loaded on every page):

| Datum | Selector | base.js line |
|---|---|---|
| panel root | `#technologydetails` | 356 |
| cost list | `.costs[data-tech-id][data-level][data-max][data-factor]` | 401-418 |
| one cost | `li.cost-item[data-res=901..921][data-base][data-have]`, text `.res-amount`/`.amount`, deficit `.lack-badge`/`.lack` ("−1.2 M", fork `shortFmt`) | 424-475 |
| build flags | `form.build_form[data-tech-ok][data-room-ok][data-max-reached][data-buyable][data-busy]` (`"1"` = true) | 355-390 |
| build button | `form.build_form .build-it_wrap .upgrade` (disabled = `[disabled]` + `.is-disabled`; label `.tooltipTop[title]`: "Requirements not met" / "No more fields" / "Max level reached" / "Working…" / "Not enough resources") | 479-515 |
| target level | `#b_input_<id>` or `input.upgrade-input`; cost = sum over levels level+1..target of floor(base x factor^i) | 346-352, 410-421, 572-577 |

So `data-base` is the price of the **next** level and the fork lets the user pick a target level (the field name sent with `cmd=insert` is unknown; open question 4).

Recipe R12 (**[SYNTHETIC]**: run on `fixtures/buildings-details-panel-HYPOTHETICAL.html`, built from the selectors above):
```js
// R12: details panel = json.content[json.target] of page=TechnologyDetailsAjax|ResearchDetailsAjax|ShipDetailsAjax.
// Selectors are the ones the fork's REAL base.js (lines 301-580) reads; the panel HTML itself was never captured.
(doc = document) => [...doc.querySelectorAll('#technologydetails')].map((card) => {
  const costs = card.querySelector('.costs');
  const form = [...card.querySelectorAll('form.build_form')].find((f) => f.querySelector('.build-it_wrap .upgrade'))
    || [...card.querySelectorAll('form.build_form')].pop();
  const flag = (n) => form ? form.getAttribute('data-' + n) === '1' : null;
  const input = card.querySelector('input.upgrade-input, [id^="b_input_"]');
  return {
    id: costs ? +costs.dataset.techId : null, level: costs ? +costs.dataset.level : null,
    max: costs ? +(costs.dataset.max || 255) : null, factor: costs ? +(costs.dataset.factor || 1) : null,
    cost: Object.fromEntries([...card.querySelectorAll('li.cost-item')].map((li) => [li.dataset.res, {
      base: +li.dataset.base, have: li.dataset.have != null ? +li.dataset.have : null,
      shown: (li.querySelector('.res-amount, .amount')?.textContent || '').trim() }])),
    flags: { techOk: flag('tech-ok'), roomOk: flag('room-ok'), maxReached: flag('max-reached'), buyable: flag('buyable'), busy: flag('busy') },
    form: form ? { action: form.getAttribute('action'), fields: Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) } : null,
    targetInput: input ? { id: input.id, name: input.name, value: input.value } : null,
    buttonDisabled: !!card.querySelector('.build-it_wrap .upgrade[disabled], .build-it_wrap .upgrade.is-disabled'),
  };
})
```
Observed (synthetic fixture):
```
[{"id":1,"level":30,"max":255,"factor":1.5,"cost":{"901":{"base":11505063,"have":2064425065,"shown":"11.505.063"},"902":{"base":2876265,...}},
  "flags":{"techOk":true,"roomOk":true,"maxReached":false,"buyable":true,"busy":false},
  "form":{"action":"game.php?page=buildings","fields":{"cmd":"insert","building":"1","level":"31"}},"targetInput":{"id":"b_input_1","name":"level","value":"31"},"buttonDisabled":false}]
```
(`level` as input name is a guess of the fixture.) Until a real response is captured, compute prices/times from `elements.json` (§13).

---

## 5. Queues and timers

### 5.1 List-page queue box [REAL, empty only]
```html
<div id="technologies">
  <h3> Buildings under construction</h3>
  <div class="bottom-side clearfix"><div class="largebox"></div></div>
</div>
```
(`eu/buildings:563-570`, `eu/research:567-574`, `eu/shipyard-fleet:559-566`; the h3 has a leading space.)

Recipe R2 (dumps the box so a first real sample shows up):
```js
// R2: "... under construction" box on list pages (first #technologies). REAL only in idle state (empty .largebox).
(doc = document) => [...doc.querySelectorAll('#technologies')].filter((t) => !t.querySelector('ul.icons')).map((t) => ({
  title: t.querySelector('h3')?.textContent.trim(),
  html: (t.querySelector('.largebox')?.innerHTML || '').trim(),
  timers: [...t.querySelectorAll('[data-time]')].map((e) => +e.dataset.time),
}))
```
Observed: `buildings [{"title":"Buildings under construction","html":"","timers":[]}]`, research `"Research under construction"`, shipyard `"Ships under construction"`.

### 5.2 Shipyard queue data [REAL, empty only]
Inline script (`eu/shipyard-fleet:978-980`, `eu/shipyard-defense:912`), followed by `$(function(){ ShipyardInit(); })`:
```
data			= {"Queue":[],"b_hangar_id_plus":0,"pretty_time_b_hangar":"00h 00m 00s"};
bd_operating	= '(In construction)';
bd_available	= 'Available: ';
```
Upstream fills `Queue` with `[name, count, secondsPerUnit, id]`, `b_hangar_id_plus` = seconds already spent on the current unit (`S:191-211`, `tpl/page.shipyard.default.tpl:92`); `shipyard.js` renders it into `#bx` (current unit countdown), `select#auftr` (one option per entry) and `#timeleft` (`scripts/game/shipyard.js:3-55`) **[UPSTREAM]**. Note the fork always emits the object (upstream `data = [];` when empty) and `ShipyardInit` must therefore tolerate an empty Queue (the fork's `shipyard.js` was not saved).

Recipe R3:
```js
// R3: shipyard queue = inline `data = {...}` (+ bd_operating) in page=shipyard. On a live page with JS on, window.data is the same object.
(doc = document) => {
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
    if (m && /"Queue"/.test(m[1])) {
      const d = JSON.parse(m[1]);
      return { raw: d, items: d.Queue.map(([name, count, secsPerUnit, id]) => ({ id: +id, name, count: +count, secsPerUnit: +secsPerUnit })),
               firstUnitElapsed: +d.b_hangar_id_plus, totalLeft: d.pretty_time_b_hangar };
    }
  }
  return null;
}
```
Observed: `{"raw":{"Queue":[],"b_hangar_id_plus":0,"pretty_time_b_hangar":"00h 00m 00s"},"items":[],"firstUnitElapsed":0,"totalLeft":"00h 00m 00s"}` (fleet and defense).
Remaining time of the whole queue = `sum(count x secsPerUnit) - b_hangar_id_plus` (as upstream `pretty_time_b_hangar`).

### 5.3 Overview boxes [REAL, idle only]
`eu/overview:630-694`: three `.content-box-s .smallbox` with `.header h3` "Buildings" / "Research" / "Hangar"; idle = `table.construction.active td.idle > a[href*="page=buildings|research|shipyard"]` (class `active` is present **even when idle**; all three idle texts say "...in the hangar", a fork string bug). The fork's `overview.js` (REAL-JS, 22 lines) ticks `.timer[data-time]` = **seconds remaining** relative to page load (`data-time - (serverTime - startTime)/1000`) and reloads `page=overview` at 0; `base.js:270-279` ticks `.countdown[data-time]` the same way (shows `-` at <= 0) on every page. Upstream active box: `{name} ({level})<br><div class="timer" data-time="{timeleft}">` (`tpl/page.overview.default.tpl:51-53`). Recipe `GZBuild.parseOverviewBoxes(doc)` in `parse-buildings.js` (verified on `fixtures/buildings-real-overview.html`: 3 boxes, all `idle:true`).

### 5.4 Upstream building/research queue markup [UPSTREAM fallback]
`tpl/page.buildings.default.tpl:3-42`, `tpl/page.research.default.tpl:3-47`: `#buildlist > table > tr` per item; first cell `"<n>.: <Name> <level>[ <Demolish>]"`; running row has `#progressbar[data-time=<rest s>]`, `#time[data-time=<total s>]` and a `cmd=cancel` form; other rows a `cmd=remove&listid=<n>` form; each row `span.timer[data-time=<end unix>]` text `"30. Oct 2026, 22:21:06"`. Queue tuples `[element, level, buildSeconds, endUnix, 'build'|'destroy'(, planetId for research)]` (`B:203`, `R:254`). Recipes `GZBuild.parseUpstreamQueue` / `parseUpstreamShipyardQueue` (verified on `fixtures/buildings-upstream-*.html`). Whether the fork's `.largebox` uses this is unknown.

### 5.5 Planet-list "is building" icon [REAL, INFERRED meaning]
`a.planetlink span.planet-koords > i.bi.bi-building-fill-up.buildingIco` is on the 3 colonies but not on the main planet (whose Buildings box was idle) and the colonies' used fields grew between saves -> most likely "this planet has a running building queue". `GZBuild.planetsBuilding(doc)`.

---

## 6. Actions

All actions are user-initiated form posts. **The extension must only send them on an explicit user click (or an explicit bot setting in the later bot phase).**

```js
async function post(url, fields) {                      // returns the re-rendered page (302 followed); parse it to confirm
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, String(x)));
  const r = await fetch(url, { method: 'POST', body, credentials: 'same-origin', redirect: 'follow' });
  return { ok: r.ok, url: r.url, html: await r.text() };
}
const at = (page, cp, extra = '') => `game.php?page=${page}${extra}${cp ? '&cp=' + cp : ''}`;
const build    = (id, cp) => post(at('buildings', cp), { cmd: 'insert', building: id });                 // [REAL]
const research = (id, cp) => post(at('research', cp), { cmd: 'insert', tech: id });                       // [REAL]
const units    = (map, cp) => post(at('shipyard', cp), Object.assign({ cmd: 'insert' },                   // [REAL] {202: 10}
  ...Object.entries(map).map(([id, n]) => ({ [`fmenge[${id}]`]: n }))));
const setProd  = (pct, cp) => post(at('resources', cp), Object.assign({ mode: 'send' },                   // [REAL] {1: 100, 212: 50}
  ...Object.entries(pct).map(([id, p]) => ({ [`prod[${id}]`]: Math.round(p / 10) }))));
const demolish = (id, cp) => post(at('buildings', cp), { cmd: 'destroy', building: id });                 // [UPSTREAM]
const cancelHead = (page, cp) => post(at(page, cp), { cmd: 'cancel' });                                   // [UPSTREAM] buildings|research
const removeAt = (page, n, cp) => post(at(page, cp), { cmd: 'remove', listid: n });                       // [UPSTREAM] n >= 2
const cancelUnits = (idx, cp, mode = 'fleet') => post(at('shipyard', cp, '&mode=' + mode), { action: 'delete', 'auftr[]': idx }); // [UPSTREAM]
const buyOfficer = (id) => post(at('officier'), { id });                                                  // [UPSTREAM] costs DM
const scrap    = (map, cp) => post(at('fleetDealer', cp), Object.assign({ mode: 'multiSend' },            // [REAL form] irreversible
  ...Object.entries(map).map(([id, n]) => ({ [`ships[${id}]`]: n }))));
```
`&cp=` on the POST URL selects the planet before the handler runs. Clicking the page's own button submits without `cp` (to the session's current planet). `fetch` from a content script carries the session cookie (same origin).

---

## 7. Resources page [REAL]

`form#resourceSettings[action$="page=resources"][method=post]` + `input[name=mode][value=send]` + submit `input.btn_blue[value="Cost estimate"]` around `table.list.listOfResourceSettingsPerPlanet` (`eu/resources:553-751`):

| Row `td.label` (`td[colspan=2]`) | Cells 2-5 (metal, crystal, deut, energy) | Control |
|---|---|---|
| `Basic Production` | `440.000` `220.000` `0` `0` | |
| `Metal Mine (Level 38)` | `<span style="color:lime">938.100.934</span>` `0` `0` `<span style="color:red">-14.214</span>` | `select[name="prod[1]"]` options `10`..`0` = 100 %..0 % |
| `Crystal Mine (Level 35)`, `Deuterium Refinery (Level 33)`, `Solar Power plant (Level 30)`, `Solar Satellite (Quantity 797)` | | `prod[2]`, `prod[3]`, `prod[4]`, `prod[212]` |
| `Bonus (Officers/Bonus):` | `994.386.990` ... `8.257` | |
| `Storage capacity` | `3.417&nbsp;M` `1.864&nbsp;M` `1.017&nbsp;M` `-` | shortly_number! |
| `Total:` | `1.932.927.923` `822.497.302` `394.585.192` `2.502` | per hour; energy = balance |
| `Daily Production:` / `Weekly Production:` | x24 / x168 (energy not multiplied) | |

Producers at level/amount 0 are omitted (`RS:122-126`): Deuterium Power Plant (12, level 0) is absent. Conveyors 71-73 are not producers.

Recipe R4:
```js
// R4: page=resources production table + form (REAL). Numbers: "." thousands; storage row uses short form "3.417 M".
(doc = document) => {
  // server number formats: pretty_number "1.932.927.923" ('.' thousands, ',' decimals) and
  // shortly_number "3.417&nbsp;M" = 3417 * 1e6 (K=1e3, M=1e6, B=1e12, T=1e18: the unit steps by 1e6 after M!)
  const MULT = { K: 1e3, M: 1e6, B: 1e12, T: 1e18, Q: 1e24, 'Q+': 1e30, S: 1e36, 'S+': 1e42, O: 1e48, N: 1e54 };
  const num = (s) => {
    const m = String(s).replace(/\u00a0/g, ' ').trim().match(/^(-?[\d.]+(?:,\d+)?)\s*(Q\+|S\+|[KMBTQSON])?$/);
    if (!m) return null;
    return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * (m[2] ? MULT[m[2]] : 1));
  };
  const form = doc.querySelector('form#resourceSettings');
  const rows = [];
  for (const tr of form.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')) {
    const td = tr.querySelectorAll('td');
    if (td.length < 5) continue;
    const label = td[0].textContent.trim();
    const sel = tr.querySelector('select[name^="prod["]');
    const m = label.match(/^(.*) \((?:Level|Quantity) (\d+)\)$/);
    rows.push({
      label, id: sel ? +sel.name.match(/\d+/)[0] : null, name: m ? m[1] : null, level: m ? +m[2] : null,
      cells: [1, 2, 3, 4].map((i) => td[i].textContent.replace(/ /g, ' ').trim()),
      metal: num(td[1].textContent), crystal: num(td[2].textContent), deuterium: num(td[3].textContent), energy: num(td[4].textContent),
      percent: sel ? +sel.value * 10 : null,
    });
  }
  return { action: form.getAttribute('action'), mode: form.querySelector('input[name=mode]').value, rows };
}
```
Observed (`eu/resources.html`):
```
action https://ogamex.eu/Aeternum/game.php?page=resources  mode send
{"label":"Basic Production","id":null,"level":null,"metal":440000,"crystal":220000,"deuterium":0,"energy":0,"percent":null}
{"label":"Metal Mine (Level 38)","id":1,"level":38,"metal":938100934,"crystal":0,"deuterium":0,"energy":-14214,"percent":100}
{"label":"Crystal Mine (Level 35)","id":2,"level":35,"metal":0,"crystal":432777527,"deuterium":0,"energy":-9836,"percent":100}
{"label":"Deuterium Refinery (Level 33)","id":3,"level":33,...,"deuterium":191546210,"energy":-22993,"percent":100}
{"label":"Solar Power plant (Level 30)","id":4,"level":30,...,"energy":10470,"percent":100}
{"label":"Solar Satellite (Quantity 797)","id":212,"level":797,...,"energy":30817,"percent":100}
{"label":"Bonus (Officers/Bonus):",...,"metal":994386990,"crystal":389499775,"deuterium":203038982,"energy":8257}
{"label":"Storage capacity",...,"metal":3417000000,"crystal":1864000000,"deuterium":1017000000,"energy":null}
{"label":"Total:",...,"metal":1932927923,"crystal":822497302,"deuterium":394585192,"energy":2502}
{"label":"Daily Production:",...,"metal":46390270157,...}  {"label":"Weekly Production:",...,"metal":324731891099,...}
```
Checks: Total metal 1,932,927,923 = resourceTicker `production: 1932927923.2055` (`eu/resources` inline); storage 3,417,000,000 vs exact `limit: [0, "3416925000"]` (shortly_number rounds to whole millions: use the ticker `limit` for exact values). Labels are localized; for language-independent code use `select[name^=prod]` rows and the fixed order (Total = third row from the end).

Formulas (from the previous analysis, still valid): mines produce exactly `formula x 22000` (`elements.json production`) -> **resource_multiplier = 22000** on Aeternum **[INFERRED]**; satellite `(Tmax+160)/6` per unit (797 x 38.67 = 30,817 at Tmax 72); bonus row = positive production x (factor.Resource + 0.02 x level 131/132/133) (`RS:186-191`); basic income 20/10 x multiplier. Storage limit is not the plain upstream formula at level 18: a storage multiplier applies (open question 5).

---

## 8. Techtree (requirements) [REAL]

`#tabs.techtree-table` (jQuery UI, `eu/techtree:546`) with 7 tabs `#tabs-1..7`: Buildings, Moon Buildings, Research, Fleet, Defenses, Missiles, Officers. One `tr` per element (`eu/techtree:921-927`):
```html
<tr><td><span><a href="...#" class="main" onclick="return Dialog.info(202)"><img src="./12_files/202.png" width="50" height="50"></a></span></td>
    <td><span><a href="...#" class="main" onclick="return Dialog.info(202)">Light Cargo</a></span></td>
    <td><a href="...#" onclick="return Dialog.info(202)"><span style="color:lime;">Shipyard (Level 2/2)</span></a><br>
        <a href="...#" onclick="return Dialog.info(202)"><span style="color:lime;">Combustion Engine (Level 2/2)</span></a></td></tr>
```
Pitfalls: (1) the requirement link's `Dialog.info()` carries the **owner's** id, not the required element's (upstream template bug, `tpl/page.techTree.default.tpl:17`) -> resolve requirement ids by name; (2) `(Level a/b)`: `a = min(own, need)` (capped! "Shipyard (Level 2/2)" while the shipyard is 18), `b = need`; colour lime = met, red = not met; (3) building requirements are evaluated on the **current planet**; (4) 14, 15 and 44 appear in two tabs.

Recipe R5:
```js
// R5: page=techtree (REAL, fork-specific jQuery-UI tabs). One <tr> per element; requirement spans are TEXT ONLY:
// "Shipyard (Level 2/2)" = min(own, need)/need, color lime|red. Their onclick points at the ELEMENT itself, not the requirement,
// so requirement ids must be resolved by name (names are unique across the whole tree).
(doc = document) => {
  const tabs = {}, byName = {}, rows = [];
  for (const a of doc.querySelectorAll('#tabs > ul a[href*="#tabs-"]')) tabs[a.getAttribute('href').split('#')[1]] = a.textContent.trim();
  for (const panel of doc.querySelectorAll('#tabs > div[id^="tabs-"]')) {
    for (const tr of panel.querySelectorAll('tr')) {
      const main = tr.querySelectorAll('a.main');
      if (main.length < 2) continue;
      const id = +main[1].getAttribute('onclick').match(/Dialog\.info\((\d+)\)/)[1];
      const name = main[1].textContent.trim();
      byName[name] = id;
      const reqs = [...tr.querySelectorAll('td:nth-child(3) span[style*="color"]')].map((s) => {
        const m = s.textContent.replace(/\s+/g, ' ').trim().match(/^(.*) \(\S+ (\d+)\/(\d+)\)$/);
        return { name: m[1], shown: +m[2], need: +m[3], met: /lime/.test(s.getAttribute('style')) };
      });
      rows.push({ tab: tabs[panel.id], id, name, reqs });
    }
  }
  for (const r of rows) for (const q of r.reqs) q.id = byName[q.name] ?? null;
  return rows;
}
```
Observed (91 rows; excerpts):
```
{"tab":"Buildings","id":6,"name":"University","reqs":[{"name":"Robot Factory","shown":20,"need":20,"met":true,"id":14},{"name":"Research Lab","shown":21,"need":22,"met":false,"id":31},
   {"name":"Nanite Factory","shown":4,"need":4,"met":true,"id":15},{"name":"Computer Technology","shown":12,"need":12,"met":true,"id":108},{"name":"Intergalactic Research Network","shown":3,"need":3,"met":true,"id":123}]}
{"tab":"Moon Buildings","id":42,"name":"Phalax Sensor","reqs":[{"name":"Moon base","shown":0,"need":1,"met":false,"id":41}]}
{"tab":"Defenses","id":409,"name":"Atmospheric Shield","reqs":[{"name":"Guardian","shown":0,"need":1,"met":false,"id":609}]}
71 Light conveyor   <- {15:5, 21:14};  72 Average conveyor <- {15:8, 21:14};  73 Heavy conveyor <- {15:10, 21:18}
```
**All requirements of the 88 upstream elements match upstream exactly** (`elements.json _meta.requirementsDifferFromUpstream = []`). Every name resolves to an id (`id:null` never occurs).

Moon Buildings tab = 14, 15, 41, 42, 43, 44, whereas upstream allows 14, 21, 22, 23, 24, 41, 42, 43 on moons (`elements.json _meta.lists`). Which is right is open (question 7).

---

## 9. Officers [REAL list, UPSTREAM buy]

`#offList > li.button#button<ID>` (`eu/officier:571-1059`: items, then an inline script), plus a first tile `li#button_rpg_darkMatter` for Dark Matter:
```html
<li class="button" id="button604"><div class="premium">
  <div class="officers100 rpg_technocrate" data-status="off" style="background: url(./styles/theme/gow/gebaeude/604.jpg)" title="Technocrat">
    <a ... class="detail_button tooltipTop js_hideTipOnMobile slideIn tpd-hideOnClickOutside has_details" data-technology="604" title="Technocrat">
      <span class="ecke"><span class="level"> 0/10 </span></span></a></div></div></li>
```
- `span.level` text = `current/max` ("18/20" Geologist). DM tile: `a[data-technologys="1"]` (sic) and text `3.981&nbsp;` = DM balance.
- `data-status="off"` on `.officers100` = requirements unmet (techtree Officers tab gives them: e.g. 604 needs Admiral 5).
- No buy form on the list: buying happens inside `CommanderDetailsAjax` content (not captured). Upstream: POST `page=officier` `id=<ID>`, price `cost921` (1000 DM upstream) per level, `O:56-84`.

Recipe R6:
```js
// R6: page=officier list (REAL). Level text "18/20" = current/max. Dark Matter tile has data-technologys="1" (no data-technology).
(doc = document) => [...doc.querySelectorAll('#offList > li.button')].map((li) => {
  const a = li.querySelector('a.detail_button');
  const box = li.querySelector('.officers100');
  const [cur, max] = a.querySelector('.level').textContent.replace(/\s+/g, '').split('/');
  return { liId: li.id, id: a.dataset.technology ? +a.dataset.technology : null, name: a.title,
           cssKey: [...box.classList].find((c) => c !== 'officers100'), off: box.dataset.status === 'off',
           level: +cur.replace(/\D/g, ''), max: max == null ? null : +max };
})
```
Observed:
```
{"liId":"button_rpg_darkMatter","id":null,"name":"Dark Matter","cssKey":"rpg_darkMatter","off":false,"level":3981,"max":null}
{"liId":"button601","id":601,"name":"Geologist","cssKey":"rpg_geologue","off":false,"level":18,"max":20}
{"liId":"button604","id":604,"name":"Technocrat","cssKey":"rpg_technocrate","off":true,"level":0,"max":10}
max levels: 601 20, 602 20, 603 10, 604 10, 605 3, 606 3, 607 2, 608 2, 609 1, 610 2, 611 3, 612 1, 613 3, 614 1, 615 1 (= upstream)
```

---

## 10. Trader (resource market) [REAL step 1, UPSTREAM step 2]

`#traderContainer .trader_col > form[action$="page=trader"][method=post]` x4 (`eu/trader:568-601`): hidden `mode=trade`, `resource=901|902|903|921`, an `input[type=image]#trader_<metal|crystal|deuterium|darkmatter>`, `label`. Below: `"The value of the merchant is 100 Dark Matter!"` (red) and `"The exchange rate is: 4/2/1"` (`eu/trader:612-613`). Step 2 (not saved) upstream: `form#trader` with `mode=send`, `resource=<sold id>`, `trade[<bought id>]=<amount>` (`tpl/page.trader.trade.tpl:3-29`); buying 1 unit of X costs `T::$Charge[R][X]` units of the sold resource R, `{901:{902:2,903:4}, 902:{901:0.5,903:2}, 903:{901:0.25,902:0.5}}` (`T:28-32`), i.e. value ratio metal:crystal:deut = 1:2:4 (the fork prints "4/2/1"). Fee = `darkmatter_cost_trader` (upstream default 750; here 100 DM; `T:34-48`). The fork adds **921 Dark Matter** as a sellable resource (not upstream).

Recipe R7:
```js
// R7: page=trader (REAL). One form per resource; rate text "4/2/1"; merchant cost text.
(doc = document) => ({
  forms: [...doc.querySelectorAll('#traderContainer form')].map((f) => ({
    action: f.getAttribute('action'), fields: Object.fromEntries([...f.querySelectorAll('input[type=hidden]')].map((i) => [i.name, i.value])),
    label: f.querySelector('label').textContent.trim() })),
  cost: doc.querySelector('#traderContainer').parentElement.querySelector('p span[style*="red"]')?.textContent.trim(),
  rate: [...doc.querySelectorAll('#traderContainer ~ div p')].map((p) => p.textContent.trim()).find((t) => /exchange rate/.test(t)),
})
```
Observed:
```
{"forms":[{"action":"https://ogamex.eu/Aeternum/game.php?page=trader","fields":{"mode":"trade","resource":"901"},"label":"Metal"},
  {..."resource":"902"},"label":"Crystal"},{..."resource":"903"},"label":"Deuterium"},{..."resource":"921"},"label":"Dark Matter"}],
 "cost":"The value of the merchant is 100 Dark Matter!","rate":"The exchange rate is: 4/2/1"}
```

---

## 11. Scrap merchant `page=fleetDealer` [REAL] -- the unit price list

Inline (`eu/fleetDealer:64-66`, before `fleettrader.js` runs):
```
var CostInfo = {"202":["0","Light Cargo",{"901":"2000","902":"2000","903":"0","911":"0","921":"0"}], ... ,"410":["0","Gravitons Cannon",{...}]};
var Charge = 0;
```
`CostInfo[id] = [amountOnThisPlanet, name, $pricelist[id]['cost']]` (upstream `FD:67-93`): this is the **server's own price table** (values are strings). It lists the ids in `trade_allowed_ships`: 202-220 and 401-406, 410 (26 ids); **not** 407-409, 411, 502, 503.

Markup: left `form#myform` (`mode=bargain`, link `a#btnBargain` "Bargain / Cost: 5000 DM", tooltip: pays 35 % normally, +2..9 % per 5000-DM round, max 90 %), `#percentage` (current bonus %), totals `#scrapTotalMetalValue|CrystalValue|DeuteriumValue`; right `form#scrap` (`mode=multiSend`) with one `.unit-item.x-ship-item#shipID` per unit **on this planet** (`data-unit-price-metal|crystal|deuterium`, `.unit-title`, hidden `#ship<ID>_value` = amount, `input.unit-input[name="ships[<ID>]"][max-value]`), submit link `a#btnScrap` (class `disabled` until something is entered). `Charge = 0` although upstream used `trade_charge` (30) -> the fork computes the payout differently (35 % base, text only).

Recipe R8:
```js
// R8: page=fleetDealer (REAL). `var CostInfo = {id:[amountOnPlanet, name, {901..921: "cost"}]}` is the only REAL per-unit price list.
(doc = document) => {
  let cost = null, charge = null;
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/CostInfo\s*=\s*(\{.*?\});/s);
    if (m) { cost = JSON.parse(m[1]); charge = +(s.textContent.match(/Charge\s*=\s*([\d.]+)/) || [])[1]; }
  }
  const units = [...doc.querySelectorAll('form#scrap .unit-item')].map((d) => ({   // all share the duplicated id="shipID"
    id: +d.querySelector('input.unit-input').name.match(/\d+/)[0], name: d.querySelector('.unit-title').textContent.trim(),
    have: +d.querySelector('input.unit-input').getAttribute('max-value'),
    price: { 901: +d.dataset.unitPriceMetal, 902: +d.dataset.unitPriceCrystal, 903: +d.dataset.unitPriceDeuterium } }));
  const forms = [...doc.querySelectorAll('form#myform, form#scrap')].map((f) => ({ id: f.id, action: f.getAttribute('action'),
    mode: f.querySelector('input[name=mode]').value, inputs: [...f.querySelectorAll('input.unit-input')].map((i) => i.name) }));
  return { charge, catalog: Object.entries(cost).map(([id, [have, name, c]]) => ({ id: +id, have: +have, name,
    cost: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +v]).filter(([, v]) => v)) })), units, forms };
}
```
Observed:
```
charge 0, catalog 26: {"id":202,"have":0,"name":"Light Cargo","cost":{"901":2000,"902":2000}}, {"id":203,"have":0,"name":"Heavy Cargo","cost":{"901":6000,"902":6000}}, ...
  {"id":220,"have":0,"name":"Dark Matter Collector","cost":{"901":60000,"902":70000,"903":30000}}    <- upstream 6000000/7000000/3000000 (100x)
units: [{"id":208,"name":"Colony Ship","have":2,"price":{"901":10000,"902":20000,"903":10000}}, {"id":210,...,"have":102}, {"id":212,...,"have":797}]
forms: [{"id":"myform","mode":"bargain","inputs":[]},{"id":"scrap","mode":"multiSend","inputs":["ships[208]","ships[210]","ships[212]"]}]
```
Every CostInfo price equals upstream except **220**. Scrapping is irreversible: never automate.

---

## 12. Element catalog `elements.json`

Built by `tools/buildings/gen_elements.py` from upstream `install.sql` (`vars` INSERT at `SQL:947`, rapidfire `SQL:1041`, requirements `SQL:1140`), `language/{en,ru}/TECH.php`, and `_real.json` (REAL pages). 95 elements: 88 upstream + 71-73 fork-only + 701-707 DM bonuses (upstream only). Top level:

- `_meta.srcTags`, `_meta.resources` (`901 Metal, 902 Crystal, 903 Deuterium, 911 Energy, 921 Dark Matter`), `_meta.formulas`
- `_meta.lists`: `buildings`, `research`, `shipyardFleet`, `shipyardDefense` (REAL page order), `officers`, `moonBuildingsTab` (REAL techtree), `upstreamAllowMoon`
- `_meta.diffsFromUpstream`: `[{"id":220,"field":"cost","upstream":{"901":6000000,"902":7000000,"903":3000000},"real":{"901":60000,"902":70000,"903":30000},"src":"REAL fleetDealer.html var CostInfo"}]` (the only difference found)
- `_meta.requirementsDifferFromUpstream`: `[]`

Per element (`elements["220"]`, abridged):
```json
{"id":220,"key":"dm_ship","kind":"ship","name":"Dark Matter Collector","nameRu":"Сборщик Тёмной материи","onPlanetType":[1,3],"onePerPlanet":false,
 "factor":1.0,"maxLevel":null,"cost":{"901":60000,"902":70000,"903":30000},"structure":130000,"attack":5,"shield":50000,
 "speed":100,"speed2":100,"speedTech":3,"capacity":6000000,"consumption":100000,"consumption2":100000,
 "requirements":{"21":9,"114":5,"118":6},"rapidfire":{"to":{"210":5,"212":5},"from":{}},
 "listedOn":{"page":"shipyard-fleet","position":1},"techtreeTabs":["Fleet"],"upstreamValue":{"cost":{"901":6000000,...}},
 "src":{"name":"REAL shipyard-fleet.html","cost":"REAL fleetDealer.html var CostInfo","structure":"DERIVED metal+crystal of REAL cost (2Moons rule)",
        "speed":"UPSTREAM install/install.sql:1004","requirements":"REAL techtree.html","rapidfire":"UPSTREAM install/install.sql:1041+",...}}
```
| Field | Meaning | Usual source |
|---|---|---|
| `id`, `key` | elementID; DB column name = CSS class on buildings/research/officers | REAL list pages / officier; UPSTREAM for the rest |
| `kind` | building, research, ship, defense, missile, officer, dmfunc | UPSTREAM class |
| `name` | English name exactly as the server shows it (incl. "Phalax Sensor", "Interplanetary missiles", "Solar Power plant") | REAL (list pages, techtree, officier, CostInfo); all equal upstream `TECH.php` |
| `nameRu` | Russian name | UPSTREAM |
| `onPlanetType`, `onePerPlanet` | `[1]` planet, `[3]` moon; domes 407/408/409/411 | UPSTREAM (71-73 INFERRED `[1]`) |
| `factor`, `maxLevel` | price growth; max level (null = 255 / units) | UPSTREAM, consistent with REAL buttons; officers' `maxLevel` REAL |
| `cost` | price of **level 1** (buildings/research) or of **1 unit**, `{resId: amount}` | REAL CostInfo for 26 units; UPSTREAM (consistent) for buildings/research; UPSTREAM for 407-409, 411, 502, 503, officers, 41-43; `null` for 71-73 |
| `costNote` | upstream `migration_2.sql` stores cost/factor; formula below already accounts for it | |
| `structure`, `attack`, `shield` | units (structure = metal+crystal; hull in combat = structure/10) | DERIVED / UPSTREAM |
| `speed`, `speed2`, `speedTech`, `capacity`, `consumption`, `consumption2` | ships | UPSTREAM; 208 and 210 speed confirmed by REAL pages (below) |
| `production`, `storage` | PHP formula strings (`$BuildLevel`, `$BuildLevelFactor` 0-10, `$BuildTemp`, `$BuildEnergy`) | UPSTREAM |
| `bonus`, `timeBonus` | officer / DM effects | UPSTREAM |
| `requirements` | `{reqId: level}` | REAL techtree (91 rows) |
| `rapidfire.to/from` | `{otherId: shots}` | UPSTREAM |
| `listedOn`, `techtreeTabs` | where and at which position the element is listed | REAL |
| `forkOnly`, `note` | 71-73 | REAL existence; effect UNKNOWN |
| `realCheck` | values seen on real pages that confirm upstream stats | REAL |

Ship stat checks (R10, `eu/fleetStep1:683` and `eu/fleetTable:629`):
```js
// R10: real per-ship speed/consumption (techs applied) from page=fleetStep1 inline `data = {...}`.
(doc = document) => {
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
    if (m && /"ships"/.test(m[1])) { const d = JSON.parse(m[1]); return { gamespeed: d.gamespeed, fleetspeedfactor: d.fleetspeedfactor, ships: d.ships }; }
  }
  return null;
}
```
Observed: `{"gamespeed":7,"fleetspeedfactor":1,"ships":{"208":{"consumption":"1000","speed":6000.000000000001,"amount":"1"}}}` -> 208: 2500 x (1 + 0.2 x Impulse 7) = 6000, consumption 1000 = upstream. fleetTable tooltip `Speed:  220000000` for 210: 100,000,000 x (1 + 0.1 x Combustion 12) -> upstream base confirmed. (Attack, shield, capacity, rapidfire: no real page shows them; upstream only.)

### 12.1 Table (from `elements.json`; cost = level 1 / per unit m/c/d [+E, DM]; req = id:level)

| id | key | name (REAL) | kind | factor | max | cost | cost src | requirements | unit stats (UPSTREAM) | listed on |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | metal_mine | Metal Mine | building | 1.5 |  | 60/15/0 | UPSTREAM+consistent | - |  | buildings |
| 2 | crystal_mine | Crystal Mine | building | 1.5 |  | 48/24/0 | UPSTREAM+consistent | - |  | buildings |
| 3 | deuterium_sintetizer | Deuterium Refinery | building | 1.5 |  | 225/75/0 | UPSTREAM+consistent | - |  | buildings |
| 4 | solar_plant | Solar Power plant | building | 1.5 |  | 75/30/0 | UPSTREAM+consistent | - |  | buildings |
| 6 | university | University | building | 2.0 |  | 100000000/50000000/25000000 | UPSTREAM+consistent | 14:20, 31:22, 15:4, 108:12, 123:3 |  | buildings |
| 12 | fusion_plant | Deuterium Power Plant | building | 2.0 |  | 900/360/180 | UPSTREAM+consistent | 3:5, 113:3 |  | buildings |
| 14 | robot_factory | Robot Factory | building | 2.0 |  | 400/120/200 | UPSTREAM+consistent | - |  | buildings |
| 15 | nano_factory | Nanite Factory | building | 2.0 |  | 1000000/500000/100000 | UPSTREAM+consistent | 14:10, 108:10 |  | buildings |
| 21 | hangar | Shipyard | building | 2.0 |  | 400/200/100 | UPSTREAM+consistent | 14:2 |  | buildings |
| 22 | metal_store | Metal Storage | building | 2.0 |  | 2000/0/0 | UPSTREAM+consistent | - |  | buildings |
| 23 | crystal_store | Crystal Storage | building | 2.0 |  | 2000/1000/0 | UPSTREAM+consistent | - |  | buildings |
| 24 | deuterium_store | Deuterium Storage | building | 2.0 |  | 2000/2000/0 | UPSTREAM+consistent | - |  | buildings |
| 31 | laboratory | Research Lab | building | 2.0 |  | 200/400/200 | UPSTREAM+consistent | - |  | buildings |
| 33 | terraformer | Terraformer | building | 2.0 |  | 0/50000/100000 E1000 | UPSTREAM+consistent | 15:1, 113:12 |  | buildings |
| 34 | ally_deposit | Alliance Depot | building | 2.0 |  | 20000/40000/0 | UPSTREAM+consistent | - |  | buildings |
| 41 | mondbasis | Moon base | building | 2.0 |  | 20000/40000/20000 | UPSTREAM | - |  | Moon Buildings |
| 42 | phalanx | Phalax Sensor | building | 2.0 |  | 20000/40000/20000 | UPSTREAM | 41:1 |  | Moon Buildings |
| 43 | sprungtor | Jumpgate | building | 2.0 |  | 2000000/4000000/2000000 | UPSTREAM | 41:1, 114:7 |  | Moon Buildings |
| 44 | silo | Missile Silo | building | 2.0 |  | 20000/20000/1000 | UPSTREAM+consistent | 21:1 |  | buildings |
| 71 | conveyor1 | Light conveyor | building | ? |  | unknown | UNKNOWN | 15:5, 21:14 |  | buildings |
| 72 | conveyor2 | Average conveyor | building | ? |  | unknown | UNKNOWN | 15:8, 21:14 |  | buildings |
| 73 | conveyor3 | Heavy conveyor | building | ? |  | unknown | UNKNOWN | 15:10, 21:18 |  | buildings |
| 106 | spy_tech | Spy Technology | research | 2.0 |  | 200/1000/200 | UPSTREAM+consistent | 31:3 |  | research |
| 108 | computer_tech | Computer Technology | research | 2.0 |  | 0/400/600 | UPSTREAM+consistent | 31:1 |  | research |
| 109 | military_tech | Weapons Technology | research | 2.0 |  | 800/200/0 | UPSTREAM+consistent | 31:4 |  | research |
| 110 | defence_tech | Shield Technology | research | 2.0 |  | 200/600/0 | UPSTREAM+consistent | 113:3, 31:6 |  | research |
| 111 | shield_tech | Armour Technology | research | 2.0 |  | 1000/0/0 | UPSTREAM+consistent | 31:2 |  | research |
| 113 | energy_tech | Energy Technology | research | 2.0 |  | 0/800/400 | UPSTREAM+consistent | 31:1 |  | research |
| 114 | hyperspace_tech | Hyperspace Technology | research | 2.0 |  | 0/4000/2000 | UPSTREAM+consistent | 113:5, 110:5, 31:7 |  | research |
| 115 | combustion_tech | Combustion Engine | research | 2.0 |  | 400/0/600 | UPSTREAM+consistent | 113:1, 31:1 |  | research |
| 117 | impulse_motor_tech | Impulse Engine | research | 2.0 |  | 2000/4000/600 | UPSTREAM+consistent | 113:1, 31:2 |  | research |
| 118 | hyperspace_motor_tech | Hyperspace Engine | research | 2.0 |  | 10000/20000/6000 | UPSTREAM+consistent | 114:3, 31:7 |  | research |
| 120 | laser_tech | Laser Technology | research | 2.0 |  | 200/100/0 | UPSTREAM+consistent | 31:1, 113:2 |  | research |
| 121 | ionic_tech | Ion Technology | research | 2.0 |  | 1000/300/100 | UPSTREAM+consistent | 31:4, 120:5, 113:4 |  | research |
| 122 | buster_tech | Plasma Technology | research | 2.0 |  | 2000/4000/1000 | UPSTREAM+consistent | 31:5, 113:8, 120:10, 121:5 |  | research |
| 123 | intergalactic_tech | Intergalactic Research Network | research | 2.0 |  | 240000/400000/160000 | UPSTREAM+consistent | 31:10, 108:8, 114:8 |  | research |
| 124 | expedition_tech | Expedition Research | research | 1.75 |  | 4000/8000/4000 | UPSTREAM+consistent | 106:3, 117:3, 31:3 |  | research |
| 131 | metal_proc_tech | Mineral Research | research | 2.0 |  | 750/500/250 | UPSTREAM+consistent | 31:8, 113:5 |  | research |
| 132 | crystal_proc_tech | Semi-Crystals Research | research | 2.0 |  | 1000/750/500 | UPSTREAM+consistent | 31:8, 113:5 |  | research |
| 133 | deuterium_proc_tech | Fuel Research | research | 2.0 |  | 1250/1000/750 | UPSTREAM+consistent | 31:8, 113:5 |  | research |
| 199 | graviton_tech | Graviton Research | research | 3.0 |  | 0/0/0 E300000 | UPSTREAM+consistent | 31:12 |  | research |
| 202 | small_ship_cargo | Light Cargo | ship | 1.0 |  | 2000/2000/0 | REAL fleetDealer | 21:2, 115:2 | spd 5000 (t4), cargo 5000, fuel 10, att 5, sh 10 | shipyard-fleet |
| 203 | big_ship_cargo | Heavy Cargo | ship | 1.0 |  | 6000/6000/0 | REAL fleetDealer | 21:4, 115:6 | spd 7500 (t1), cargo 25000, fuel 50, att 5, sh 25 | shipyard-fleet |
| 204 | light_hunter | Light Fighter | ship | 1.0 |  | 3000/1000/0 | REAL fleetDealer | 21:1, 115:1 | spd 12500 (t1), cargo 50, fuel 20, att 50, sh 10 | shipyard-fleet |
| 205 | heavy_hunter | Heavy Fighter | ship | 1.0 |  | 6000/4000/0 | REAL fleetDealer | 21:3, 111:2, 117:2 | spd 10000 (t2), cargo 100, fuel 75, att 150, sh 25 | shipyard-fleet |
| 206 | crusher | Cruiser | ship | 1.0 |  | 20000/7000/2000 | REAL fleetDealer | 21:5, 117:4, 121:2 | spd 15000 (t2), cargo 800, fuel 300, att 400, sh 50 | shipyard-fleet |
| 207 | battle_ship | Battleship | ship | 1.0 |  | 45000/15000/0 | REAL fleetDealer | 21:7, 118:4 | spd 10000 (t3), cargo 1500, fuel 250, att 1000, sh 200 | shipyard-fleet |
| 208 | colonizer | Colony Ship | ship | 1.0 |  | 10000/20000/10000 | REAL fleetDealer | 21:4, 117:3 | spd 2500 (t2), cargo 7500, fuel 1000, att 50, sh 100 | shipyard-fleet |
| 209 | recycler | Recycler | ship | 1.0 |  | 10000/6000/2000 | REAL fleetDealer | 21:4, 115:6, 110:2 | spd 2000 (t1), cargo 20000, fuel 300, att 1, sh 10 | shipyard-fleet |
| 210 | spy_sonde | Spy Probe | ship | 1.0 |  | 0/1000/0 | REAL fleetDealer | 21:3, 115:3, 106:2 | spd 100000000 (t1), cargo 5, fuel 1, att 0, sh 0 | shipyard-fleet |
| 211 | bomber_ship | Planet Bomber | ship | 1.0 |  | 50000/25000/15000 | REAL fleetDealer | 117:6, 21:8, 122:5 | spd 4000 (t5), cargo 500, fuel 1000, att 1000, sh 500 | shipyard-fleet |
| 212 | solar_satelit | Solar Satellite | ship | 1.0 |  | 0/2000/500 | REAL fleetDealer | 21:1 | spd 0 (t0), cargo 0, fuel 0, att 0, sh 0 | shipyard-fleet |
| 213 | destructor | Star Fighter | ship | 1.0 |  | 60000/50000/15000 | REAL fleetDealer | 21:9, 118:6, 114:5 | spd 5000 (t3), cargo 2000, fuel 1000, att 2000, sh 500 | shipyard-fleet |
| 214 | dearth_star | Battle Fortress | ship | 1.0 |  | 5000000/4000000/1000000 | REAL fleetDealer | 21:12, 118:7, 114:6, 199:1 | spd 200 (t3), cargo 1000000, fuel 1, att 200000, sh 50000 | shipyard-fleet |
| 215 | battleship | Battle Cruiser | ship | 1.0 |  | 30000/40000/15000 | REAL fleetDealer | 114:5, 120:12, 118:5, 21:8 | spd 10000 (t3), cargo 750, fuel 250, att 700, sh 400 | shipyard-fleet |
| 216 | lune_noir | Black Moon | ship | 1.0 |  | 8000000/2000000/1500000 | REAL fleetDealer | 106:12, 21:15, 109:14, 110:14, 111:15, 114:10, 120:20, 199:3 | spd 900 (t3), cargo 15000000, fuel 250, att 150000, sh 70000 | shipyard-fleet |
| 217 | ev_transporter | Battle Transporter | ship | 1.0 |  | 35000/20000/1500 | REAL fleetDealer | 111:10, 21:14, 114:10, 110:14, 117:15 | spd 6000 (t3), cargo 40000000 live (user 2026-10-31; upstream 400000000), fuel 90, att 50, sh 120 | shipyard-fleet |
| 218 | star_crasher | Avatar | ship | 1.0 |  | 275000000/130000000/60000000 | REAL fleetDealer | 21:18, 109:20, 110:20, 111:20, 114:15, 118:20, 120:25, 199:8 | spd 10 (t3), cargo 50000000, fuel 10000, att 35000000, sh 2000000 | shipyard-fleet |
| 219 | giga_recykler | Battle Recycler | ship | 1.0 |  | 1000000/600000/200000 | REAL fleetDealer | 21:15, 109:15, 110:15, 111:15, 118:8 | spd 7500 (t3), cargo 200000000, fuel 300, att 1, sh 1000 | shipyard-fleet |
| 220 | dm_ship | Dark Matter Collector | ship | 1.0 |  | 60000/70000/30000 | REAL fleetDealer | 21:9, 114:5, 118:6 | spd 100 (t3), cargo 6000000, fuel 100000, att 5, sh 50000 | shipyard-fleet |
| 401 | misil_launcher | Missile Launcher | defense | 1.0 |  | 2000/0/0 | REAL fleetDealer | 21:1 | att 80, sh 20 | shipyard-defense |
| 402 | small_laser | Light Laser Turret | defense | 1.0 |  | 1500/500/0 | REAL fleetDealer | 113:1, 21:2, 120:3 | att 100, sh 25 | shipyard-defense |
| 403 | big_laser | Heavy Laser Turret | defense | 1.0 |  | 6000/2000/0 | REAL fleetDealer | 113:3, 21:4, 120:6 | att 250, sh 100 | shipyard-defense |
| 404 | gauss_canyon | Gauss Cannon | defense | 1.0 |  | 20000/15000/2000 | REAL fleetDealer | 21:6, 113:6, 109:3, 110:1 | att 1100, sh 200 | shipyard-defense |
| 405 | ionic_canyon | Ion Cannon | defense | 1.0 |  | 2000/6000/0 | REAL fleetDealer | 21:4, 121:4 | att 150, sh 500 | shipyard-defense |
| 406 | buster_canyon | Plasma Cannon | defense | 1.0 |  | 50000/50000/30000 | REAL fleetDealer | 21:8, 122:7 | att 3000, sh 300 | shipyard-defense |
| 407 | small_protection_shield | Small Shield Dome | defense | 1.0 |  | 10000/10000/0 | UPSTREAM | 110:2, 21:1 | att 1, sh 2000, 1/planet | shipyard-defense |
| 408 | big_protection_shield | Large Shield Dome | defense | 1.0 |  | 50000/50000/0 | UPSTREAM | 110:6, 21:6 | att 1, sh 10000, 1/planet | shipyard-defense |
| 409 | planet_protector | Atmospheric Shield | defense | 1.0 |  | 10000000/5000000/2500000 | UPSTREAM | 609:1 | att 1, sh 1000000, 1/planet | shipyard-defense |
| 410 | graviton_canyon | Gravitons Cannon | defense | 1.0 |  | 15000000/15000000/0 | REAL fleetDealer | 199:7, 21:18, 109:20 | att 500000, sh 80000 | shipyard-defense |
| 411 | orbital_station | Orbital Defence Platform | defense | 1.0 |  | 5000000000/2000000000/500000000 E1000000 DM10000 | UPSTREAM | 199:10, 110:22, 122:20, 108:15, 111:25, 113:20, 608:2, 21:20 | att 400000000, sh 2000000000, 1/planet | shipyard-defense |
| 502 | interceptor_misil | Interceptor | missile | 1.0 |  | 8000/0/2000 | UPSTREAM | 44:2, 21:1 | att 1, sh 1 | shipyard-defense |
| 503 | interplanetary_misil | Interplanetary missiles | missile | 1.0 |  | 12500/2500/10000 | UPSTREAM | 44:4, 21:1, 117:1 | att 12000, sh 1 | shipyard-defense |
| 601 | rpg_geologue | Geologist | officer | 1.0 | 20 | 0/0/0 DM1000 | UPSTREAM | - |  | Officers |
| 602 | rpg_amiral | Admiral | officer | 1.0 | 20 | 0/0/0 DM1000 | UPSTREAM | - |  | Officers |
| 603 | rpg_ingenieur | Engineer | officer | 1.0 | 10 | 0/0/0 DM1000 | UPSTREAM | 601:5 |  | Officers |
| 604 | rpg_technocrate | Technocrat | officer | 1.0 | 10 | 0/0/0 DM1000 | UPSTREAM | 602:5 |  | Officers |
| 605 | rpg_constructeur | Constructor | officer | 1.0 | 3 | 0/0/0 DM1000 | UPSTREAM | 601:10, 603:2 |  | Officers |
| 606 | rpg_scientifique | Scientologist | officer | 1.0 | 3 | 0/0/0 DM1000 | UPSTREAM | 601:10, 603:2 |  | Officers |
| 607 | rpg_stockeur | Storage expert | officer | 1.0 | 2 | 0/0/0 DM1000 | UPSTREAM | 605:1 |  | Officers |
| 608 | rpg_defenseur | Minister of Defence | officer | 1.0 | 2 | 0/0/0 DM1000 | UPSTREAM | 606:1 |  | Officers |
| 609 | rpg_bunker | Guardian | officer | 1.0 | 1 | 0/0/0 DM1000 | UPSTREAM | 601:20, 603:10, 605:3, 606:3, 607:2, 608:2 |  | Officers |
| 610 | rpg_espion | Spy | officer | 1.0 | 2 | 0/0/0 DM1000 | UPSTREAM | 602:10, 604:5 |  | Officers |
| 611 | rpg_commandant | Commander | officer | 1.0 | 3 | 0/0/0 DM1000 | UPSTREAM | 602:10, 604:5 |  | Officers |
| 612 | rpg_destructeur | Destroyer | officer | 1.0 | 1 | 0/0/0 DM1000 | UPSTREAM | 610:1 |  | Officers |
| 613 | rpg_general | General | officer | 1.0 | 3 | 0/0/0 DM1000 | UPSTREAM | 611:1 |  | Officers |
| 614 | rpg_raideur | Emperor | officer | 1.0 | 1 | 0/0/0 DM1000 | UPSTREAM | 602:20, 604:10, 610:2, 611:2, 612:1, 613:3 |  | Officers |
| 615 | rpg_empereur | Raider | officer | 1.0 | 1 | 0/0/0 DM1000 | UPSTREAM | 614:1, 609:1 |  | Officers |

DM bonuses 701-707 (Weapons/Shield/Building/Ressource/Energy/Research/Fleet Upgrade) are in the JSON, upstream only; the fork's officier page does not list them.

Speed tech: 1 combustion (115, +10 %/level), 2 impulse (117, +20 %), 3 hyperspace drive (118, +30 %), 4 = combustion, impulse once 117 >= 5, 5 = impulse, hyperspace once 118 >= 8 (`FF:34-62`). `consumption2` applies to 202 when 117 >= 5 and to 211 when 118 >= 8 (`FF:26`).

---

## 13. Formulas [UPSTREAM, prices verified §3.6]

```js
// price of reaching level L (buildings/research) - floored for display; BF:65-108
const price = (el, L) => Object.fromEntries(Object.entries(el.cost).map(([r, v]) => [r, Math.floor(el.factor !== 1 ? v * el.factor ** (L - 1) : v)]));
// units: el.cost x amount.  Demolish: price(el, currentLevel) / 2 (BF:102-104).
// build time (s), BF:129-180, with cost = metal + crystal of that price:
//  building: floor(cost / (game_speed x (1 + robot14)) x 0.5^nanite15 x (1 + factor.BuildTime) x 3600)
//  ship/def: floor(cost / (game_speed x (1 + shipyard21)) x 0.5^nanite15 x (1 + factor.ShipTime|DefensiveTime) x 3600) per unit
//  research: floor(cost / (1000 x (1 + labLevel)) / (game_speed / 2500) x (1 - factor_university/100)^university6 x (1 + factor.ResearchTime) x 3600)
//            labLevel includes IRN-linked labs (each counted if >= the tech's lab requirement)
//  demolish: x1300 instead of x3600; minimum min_build_time (default 1 s); game_speed 2500 = 1x.
// max buildable units = min over resources floor(stock / unit cost); missiles also limited by silo (BF:188-250).
// buyable: every price component <= stock, energy compared with PRODUCED energy (BF:47-63, 182-186).
```
`game_speed`, `factor_university` and the conveyor effect are not visible on any saved page (fleetStep1 `gamespeed: 7` is the fleet speed). Prefer times from the details panel once captured.

---

## 14. Number, time and DOM pitfalls

| Format | Where | Example | Parse |
|---|---|---|---|
| `pretty_number` (`GF:237-240`: `number_format(n,0,',','.')`) | list tables, resources page, tooltips, `data-tooltip-content` | `938.100.934`, `-14.214` | strip everything but digits and leading `-` |
| `shortly_number` (`GF:306-327`) | resources "Storage capacity", resource bar text | `3.417&nbsp;M` = 3,417,000,000; `230&nbsp;M`; numbers < 100 get one decimal with `,` | `parseFloat(n.replace(/\./g,'').replace(',', '.')) x {K:1e3, M:1e6, B:1e12, T:1e18}` (each unit after M is x1e6!) |
| fork header `shortFmt`-like text | resource bar energy/DM | `438&nbsp;/&nbsp;47.5K`, `4K` | `.` is a DECIMAL point here; use `t="438 / 47.480"` or `data-real` instead |
| fork `base.js shortFmt` | details-panel deficit badges | `−1.2 M`, `B` = 1e9 | display only |
| `pretty_time` (`GF:191-211`) | shipyard `pretty_time_b_hangar` | `00h 00m 00s`, `[Nd ]HHh MMm SSs` | read numbers right to left: s, m, h, d |
| JS countdowns `GetRestTimeFormat` | `.timer`, `.countdown` text | `00:41:26` | prefer `data-time` (seconds left at page load) |
| date `tdformat` | header clock `[M] [D] [d] [H]:[i]:[s]`; upstream queue end `30. Oct 2026, 22:21:06` | | server time = inline `serverTime = new Date(2026, 9, 30, 10, 03, 45)` (`ServerTimezoneOffset = 0`) |

DOM: duplicated ids (§1.8); `title` attributes hold escaped HTML (`&lt;br&gt;`) and may be moved away by the tooltip library after load (parse early, or fall back to `elements.json` names); research `data-technology` twice per item; research title has a trailing space; `data = {...}` is a generic page global (shipyard queue here, fleet data on fleetStep1/2): check its keys (`"Queue"`); `CostInfo` values are strings.

---

## 15. Open questions (need real pages/responses)

1. **Running queues**: content of `.largebox` while building/researching/producing; overview boxes while active; timers (`.timer[data-time]`?), cancel controls, queue ids.
2. **Cancel/remove**: are `cmd=cancel`, `cmd=remove&listid=n` and `action=delete&auftr[]` still valid in the fork?
3. **Details AJAX bodies** (`TechnologyDetailsAjax`, `ResearchDetailsAjax`, `ShipDetailsAjax`, `CommanderDetailsAjax`): `target` key, HTML, build time, demolish form, unit amount input name, officer buy form.
4. **Multi-level build**: name of the target-level field (`#b_input_<id>` / `.upgrade-input`) and whether `cmd=insert` honours it.
5. **Server config**: `game_speed`, `factor_university`, storage multiplier (limit 3,416,925,000 at Metal Storage 18), `max_elements_build/tech/ships` (e.g. `page=Serverinfo`, `Dialog.Server()`).
6. **Conveyors 71-73**: cost, factor, max level, effect (`page=information&id=71` or the details panel).
7. **Moons**: which buildings the fork allows (techtree tab says 14, 15, 41, 42, 43, 44; upstream 14, 21-24, 41-43); a saved `page=buildings` on a moon.
8. **Unit affordability**: does an unaffordable unit keep its hidden form?
9. **Research with unmet requirements**: markup (never occurred).
10. **Prices of 407-409, 411, 502, 503, 41-43, officers**: not in any real page; upstream assumed.
11. **Trader step 2** (`mode=trade` response) and DM exchange rates; **fleetDealer** `bargain` / `multiSend` responses and payout %.
