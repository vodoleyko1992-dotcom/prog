# GALAXYZ galaxy page (+ tournament): spec for content scripts

Target: `https://ogamex.eu/Aeternum/game.php?page=galaxy`, engine meta `generator="GALAXYZ 1.8.git"` (2Moons fork, theme `./styles/theme/gow/`).
Replaces `specs/galaxy.md` (lanedirt OgameX `/galaxy` + `POST /ajax/galaxy`), which does not apply here.

Tags: **[REAL galaxy.html]** = seen in `eu/pages/galaxy.html` (saved 30 Oct 2026 10:04 server time, system 2:68, user `vodoleyko1992`, id 4377).
**[UPSTREAM file:line]** = 2Moons source under `src/2Moons/`. **[INFERRED]** = not seen anywhere, guessed from REAL markup + UPSTREAM logic; must be verified on a live foreign system.

Companion files (all read-only for the extension):
- `specs/galaxyz/tools/run_galaxy_md_snippets.js` runs every recipe of section 7 against the real pages (Chromium, page JS disabled, network aborted). `node specs/galaxyz/tools/run_galaxy_md_snippets.js` (add `--recipes` to print the recipe source).
- `specs/galaxyz/galaxy-recipes.js` + `tools/check_galaxy.js` + `fixtures/galaxy-*.html` exist in this folder from another run (synthetic "live" foreign rows, upstream statistics/search/playercard/phalanx fixtures). They were not written for this file; treat their *synthetic* fixtures as INFERRED, the same as below.

## 0. Biggest facts / surprises

1. **Full page, not AJAX.** The system view is a plain server-rendered page. Navigation = `form#galaxy_form` POST to `game.php?page=galaxy` (or GET with the same params). No JSON endpoint for galaxy rows. [REAL galaxy.html:577] [UPSTREAM ShowGalaxyPage.class.php:35-55]
2. **The real page only shows our own system (2:68) with our own 4 planets.** No foreign player, alliance, moon, debris, flag, spy/message/buddy/missile button exists in any real page. Everything about foreign rows is [UPSTREAM]/[INFERRED]. **Open question #1: save one foreign system (with an inactive, a moon, a debris field, an alliance member) from the live server.**
3. **Live markup is NOT the upstream template.** Live = OGame-like layout (`table#galaxytableHead`, `tr.row`, `td.position|microplanet1|planetname1|moon|debris|playername|allytag|action`, tooltips in `title` attr with `class=tooltipRight`). Upstream = `table.table569` + `data-tooltip-content`. The live `galaxy.js` was not saved (`./8_files/galaxy.js` missing); only upstream `scripts/game/galaxy.js` (25 lines) is available.
4. **Free slots carry planet-field and temperature ranges** in the position link title ("Planet fields: 215-244<br />Approximately220°Cto260°C") -> nice colonisation helper. [REAL]
5. **Own rows contain no planet id and no player id.** Ids for own planets come from the planet list (`cp=`); foreign ids only via `doit(6,ID)` / `Dialog.Playercard(ID)` (inferred).
6. **Footer "(1 Existing planets)" although 4 planets exist in 2:68.** Upstream prints `count($Result)` (= number of occupied positions). GALAXYZ counts something else (players? foreign planets?). Do not use it as a row count. [REAL galaxy.html:1031] Open question #2.
7. **Stats link in the player tooltip is `?page=statistics&who=1&start=194`** but upstream statistics reads `range`, not `start` (ShowStatisticsPage.class.php:34). The overview uses `page=statistics&range=194`. Build your own link with `range`. [REAL]
8. Viewing a foreign system costs deuterium (`deuterium_cost_galaxy`, upstream ShowGalaxyPage.class.php:56-67; error page "You dont have enough deuterium to view the galaxy"). Value on ogamex.eu unknown. Bulk scanning is not free. Open question #3.
9. Tournament page = 5 tournament leaderboards (top 15 each) with **player ids**; it is not a highscore. Highscore = `page=statistics` (not saved; [UPSTREAM]).

## 1. URLs

| What | Method + URL / params | Tag |
|---|---|---|
| Open system | `GET game.php?page=galaxy&galaxy=2&system=68` (planet list tooltip uses `game.php?page=galaxy&cp=254102&galaxy=2&system=68&position=5`) | [REAL galaxy.html:1083] |
| Navigate form | `POST game.php?page=galaxy` body `galaxy=2&system=68` (+ one of `galaxyLeft|galaxyRight|systemLeft|systemRight` = `dr`, set by `galaxy_submit(name)` which renames `input#auto` value `dr`) | [REAL :577-604] [UPSTREAM galaxy.js:22-25, ShowGalaxyPage:36-55] |
| Keyboard | Left/Right arrow = system -/+, Up/Down = galaxy +/- (inline `$(document).keydown`) | [REAL :546-568] |
| Expedition (pos 16) | `game.php?page=fleetTable&galaxy=2&system=68&planet=16&planettype=1&target_mission=15` in `#expeditionbutton a` | [REAL :620] |
| Colonize free slot | `game.php?page=fleetTable&galaxy=2&system=68&planet=1&planettype=1&target_mission=7` | [REAL :678] |
| Deploy / Transport own planet | `?page=fleetTable&galaxy=2&system=68&planet=5&planettype=1&target_mission=4` / `...=3` (inside planet tooltip) | [REAL :736-737] |
| Attack / Hold / Spy (fleet page) / Recycle / Destroy moon | `?page=fleetTable&galaxy=G&system=S&planet=P&planettype=1|3&target_mission=1|5|6|8|9` | [UPSTREAM page.galaxy.default.tpl:105,112] |
| Spy one click | `GET game.php?page=fleetAjax&ajax=1&mission=6&planetID=<target planet or moon id>` -> JSON | [UPSTREAM galaxy.js:1-20, ShowFleetAjaxPage.class.php:38-219] |
| Recycle one click | same with `mission=8&planetID=<planet id of the debris position>` | [UPSTREAM ShowFleetAjaxPage:84-116] |
| Missile form | `GET game.php?page=galaxy&action=sendMissle&galaxy=G&system=S&planet=P&type=1|3` shows form -> `POST game.php?page=fleetMissile` fields `galaxy,system,planet,type,SendMI,Target` (`Target` 0 = all defences, else 401..411/502) | [UPSTREAM tpl:39-60,154; ShowGalaxyPage:69-76] |
| Message | `Dialog.PM(ID)` -> popup `game.php?page=messages&mode=write&id=ID&subject=&message=` | [REAL live base.js:161-166] |
| Player card | `Dialog.Playercard(ID)` -> `game.php?page=playerCard&id=ID` | [REAL base.js:168-170, tournament.html:672] |
| Buddy request | `Dialog.Buddy(ID)` -> `game.php?page=buddyList&mode=request&id=ID` | [REAL base.js:172-174] |
| Phalanx | `OpenPopup('?page=phalanx&galaxy=G&system=S&planet=P&planettype=1','',640,510)` | [UPSTREAM tpl:105,158] |
| Alliance info | `?page=alliance&mode=info&id=ALLYID` | [UPSTREAM tpl:135] |
| Highscore | `game.php?page=statistics&who=1|2&type=1..5&range=N` (who 1 player 2 alliance; type 1 points 2 fleet 3 research 4 buildings 5 defense; range = position, page of 100) | [UPSTREAM ShowStatisticsPage:32-34,176-177]; overview uses `page=statistics&range=194` [REAL overview.html:609] |
| Tournament | `GET game.php?page=tournament` | [REAL tournament.html:2] |

Server clamps galaxy/system/planet to `1..max_*` (ShowGalaxyPage:40-42). Max planets here = 15 (+16 = expedition). Galaxy input `maxlength=3`.

**Pitfall `cp`:** any request carrying `cp=<id>` switches the session's current planet. A scanner must not add `cp`. All other requests act on the current planet (fleetAjax sends from the current planet).

### fleetAjax JSON [UPSTREAM ShowFleetAjaxPage.class.php]
`{ "slots": <used slots after send>, "ships": { "210": <probes left> }, "code": 600, "mess": "Send 5 Espionage Probe to 2:68:9 ..." }`
Codes: 600 ok; 601 planet does not exist; 603 too weak (noob); 604 too strong; 605 vacation; 610 no probes; 611 no probes/recyclers; 612 no slots; 613 fuel / cargo; 618 spy yourself; 619 not allowed; 620 you are in vacation; 699 module off.
Probe count sent = `min(settings spio_anz, probes on planet)` (user setting "number of probes"). Upstream `doit` writes `$('#slots').text(data.slots)` and `#elementID210`: **those ids do not exist in the live header** (live has `#slotValue` and plain text "102 Spy Probes"), so the live galaxy.js must differ. Open question #4: real `doit` / fleetAjax in GALAXYZ (method GET? extra token?). The fleet flow already needs a hidden `token` per form (fleetStep1-3 REAL), fleetAjax may too.
The extension may call it only on an explicit user click (spy button), never in a loop.

## 2. Page skeleton [REAL galaxy.html]

```
body#galaxy.full
 #content
  table#galaxytableHead              (one table; thead/tbody/tfoot)
   thead
    tr#galaxyheadbg > td[colspan=13]
      form#galaxy_form[action=...page=galaxy][method=post]
        input#auto[type=hidden][value=dr]            (no name until galaxy_submit sets it)
        #galaxyscroll  input[name=galaxy][value="2"]  a.backGalaxy[name=galaxyLeft]  a.forwardGalaxy[name=galaxyRight]
        #solarscroll   input[name=system][value="68"] a.backGalaxy[name=systemLeft]  a.forwardGalaxy[name=systemRight]
        #showbutton a (document.forms[0].submit())   <- NB forms[0], our injected forms must not come first
      #expeditionbutton a[href*=target_mission=15]    "Deep area of galaxy"
    tr.info.info_header > td
      span#probes      "102 Spy Probes"
      span#recycler    "0 Recycler"          <- duplicated id
      span#recycler    "0 Giga Recycler"     <- duplicated id
      span#rockets     "0 Available Missiles"
      span#slots > span#slotValue "1/13"  + text "Fleet Slots"
    tr#galaxyheadbg2  th: Pos.(colspan 3) | Planet | Planet Name | Moon (colspan 2) | Debris | Player (State) | Alliance | Actions | ''
   tbody
    tr.row  x15  (position 1..15, no id, no data-* attributes)
   tfoot
    tr#fleetstatusrow.info > td[colspan=13]   (empty; upstream doit() inserts status rows after it)
    tr.info > td > span#legend a.tooltip[data-tooltip-content] ; span#colonized "(1 Existing planets)"
 script: status_ok='Done'; status_fail='Error'; MaxFleetSetting = 3;
```
Counts are plain text with English labels: parse with regex on the number before the label, numbers can contain "." thousands separators.

## 3. Row markup

### 3.1 Free position [REAL galaxy.html:676-688]
```html
<tr class="row">
  <td class="position">
    <a class="tooltipTop js_hideTipOnMobile" title="Planet fields: 215-244&lt;br /&gt;Approximately220°Cto260°C&lt;br /&gt;"
       href=".../game.php?page=fleetTable&amp;galaxy=2&amp;system=68&amp;planet=1&amp;planettype=1&amp;target_mission=7">
      <span style="font-weight:bold;color:#FF1010">1</span></a>
  </td>
  <td></td> x7          <- only 8 cells; occupied rows have 11
</tr>
```
Note the missing spaces: "Approximately220°Cto260°C". Colour of the number encodes temperature (red hot -> blue cold), no meaning beyond that.

### 3.2 Occupied position (own planet) [REAL galaxy.html:726-776]
| Cell | Selector | Sample | Notes |
|---|---|---|---|
| position | `td.position > span` | `<span style="color:#FC4242">5</span>` | no link when occupied |
| planet | `td.microplanet1 > a.tooltipRight.tooltipClose[title]` > `img` | img `./8_files/s_dschjungelplanet07.gif` (live: `./styles/theme/gow/planeten/small/s_dschjungelplanet07.gif`) | `1` suffix may be a size/type variant; select with `td[class^="microplanet"]` |
| planet tooltip (title, HTML-escaped) | `h1` "Planet Главная планета"; `span#pos-planet` "[2:68:5]"; `img.planetTooltip.jungle_2`; `ul.ListLinks` with 8 `li` slots, empty ones are `<li></li>` | own planet: li6 Deploy (`target_mission=4`), li7 Transport (`=3`) | foreign planet: the empty slots are presumably Spy/Phalanx/Attack/Hold/... **[INFERRED]** order from upstream tpl:105: spy `javascript:doit(6,ID)`, phalanx, attack 1, hold 5, deploy 4, transport 3, missile; i.e. the planet **id** is only in the `doit(6,ID)` href. `id='pos-planet'` repeats once per row inside tooltips (not in DOM until hover) |
| planet name + activity | `td.planetname1` text | `Главная планета (*)`, `Colony (49 min)`, `Colony (50 min)` | activity suffix: `(*)` = < 15 min, `(N min)` = 15..59 min, nothing = >= 60 min [UPSTREAM GalaxyRows.php:107-120, INGAME.php:219-220]; activity = max(planet, moon) last_update |
| moon | `td.moon` | empty here | [INFERRED] `a > img` when a moon exists; tooltip with name, diameter, temp, links `planettype=3` (attack 1, transport 3, deploy 4, hold 5, spy `doit(6,MOONID)`, destroy 9, missile) [UPSTREAM tpl:110-116] |
| spacer | `td.spacer02`, `td.spacer03`, `td.spacer04` | empty | layout only |
| debris | `td.debris` | empty | [INFERRED] `a > img` + tooltip "Metal: 1.234 / Crystal: 567" + `doit(8,PLANETID)` [UPSTREAM tpl:117-123]. Debris exists only on occupied positions (upstream stores der_metal/der_crystal on the planet row). Live fleet events show debris at [2:87:8] being harvested, so debris exists in this universe |
| player | `td.playername > a.tooltipRight[title] > span.galaxy-username` | `<span class=" galaxy-username">vodoleyko1992</span>` (leading space = empty class list from template) | flags appended as classes `galaxy-username-<flag>` + `<span>(</span><span class="galaxy-short-<flag> galaxy-short">i</span><span>)</span>` [UPSTREAM tpl:126-130] |
| player tooltip | `div#player.htmlTooltip` > `h1` "Player: <span>vodoleyko1992</span>", `li.rank` "Ranking: 194", `a[href*=page=statistics]` "Stats" | `?page=statistics&who=1&start=194` | own row: no Playercard/Buddy/PM. Foreign: [INFERRED] `Dialog.Playercard(ID)` / `Dialog.Buddy(ID)` links -> **player id** source. `id='player'` repeats per row (inside title only) |
| alliance | `td.allytag` | whitespace only | [INFERRED] `a > span.galaxy-alliance[.galaxy-alliance-member|friend|enemy]` with the tag, tooltip with name, "N Members", `?page=alliance&mode=info&id=ID`, stats `start=RANK&who=2`; upstream prints `-` when none |
| actions | `td.action[colspan=2]` | empty for own planet | [INFERRED] spy `a[href^="javascript:doit(6,"]`, PM `onclick="return Dialog.PM(ID)"`, buddy `Dialog.Buddy(ID)`, missile `?page=galaxy&action=sendMissle&...&type=1`, phalanx `a.textForBlind` [UPSTREAM tpl:140-159]. Each shown only if the user's settings enable it (settings_esp/wri/bud/mis) [UPSTREAM GalaxyRows.php:159-172] |

Destroyed planet [UPSTREAM tpl:88-98]: position text only + "Planet destroyed" in the 3rd cell; live markup unknown.

### 3.3 Player flags [REAL legend tfoot + UPSTREAM GalaxyRows.php:174-219]
| class suffix | short | meaning | rule |
|---|---|---|---|
| `strong` | S | strong player (noob protection, you are weaker) | CheckNoobProtec |
| `noob` | N | weak player (noob protection) | CheckNoobProtec |
| `vacation` | VM | vacation mode | urlaubs_modus=1 |
| `banned` | B | banned / suspended | banaday > now |
| `inactive` | i | offline >= 7 days | INACTIVE 604800 |
| `longinactive` | I | offline >= 28 days (always together with `inactive`) | INACTIVE_LONG 2419200 |
Combinations upstream: `vacation banned`, `inactive longinactive`; otherwise single. Alliance classes `member|friend|enemy` have empty short labels. Legend markup is REAL: `span#legend a.tooltip[data-tooltip-content]` with `span.galaxy-short-strong` "S", `-noob` "N", `-vacation` "VM", `-banned` "B", `-inactive` "i", `-longinactive` "I".

## 4. Encoding, numbers, attributes, duplicated ids

- `<meta charset UTF-8>`; names are raw UTF-8 Cyrillic ("Главная планета"). Text in cells is HTML-escaped once; tooltips are HTML **inside the `title` attribute** (escaped twice in source: `&lt;`, `&#39;`, `&amp;amp;` for links). Parse the title with DOMParser, never with regex on the raw source.
- `title` vs `data-tooltip-content`: galaxy rows use `title` (+ `tooltipRight tooltipClose js_hideTipOnMobile` for new_tooltip.js / Tipped); the legend and fleet events use `data-tooltip-content` (old tooltip.js). On mobile `new_tooltip.js:26-28` blanks `title` of `js_hideTipOnMobile`; Tipped may also take the title over after the first hover. **Parse a fresh `fetch()` + DOMParser copy, or read the DOM before tooltips initialise.**
- "Save page as" made hrefs absolute (`https://ogamex.eu/Aeternum/game.php?page=...`); live they are relative (`game.php?page=` / `?page=`; tooltip links keep `?page=`). Always parse query strings, never compare full hrefs.
- Numbers: "." thousands separator (`20.000 units`, `8.290`); header counts may be "1.234 Spy Probes". Temperatures can be negative (`-130°Cto-90°C`).
- Duplicated ids: `#recycler` x2 (Recycler and Giga Recycler) in galaxy header; `#planetList` x4 (one per planet, sidebar); inside tooltips `#pos-planet` and `#player` repeat per row (only in title strings, 0 in DOM). Tournament: `#ach_batle_level` repeated per board. Use `querySelectorAll('[id="recycler"]')` or text matching.
- `document.forms[0]` is used by the View button: do not insert a `<form>` before `#galaxy_form`.
- Rows have no ids/data attributes: identify a row by its index in `#galaxytableHead > tbody > tr.row` (position = index+1) or by `td.position` text.

## 5. Inserting UI
- Extra columns: rows have different cell counts (8 free vs 11 occupied, header 13 colspan); append cells to `td.action` content or put an absolutely positioned badge in `td.planetname1`, do not add `<td>`s.
- Status line: `tr#fleetstatusrow` (empty, visible) is the game's own place for spy/recycle results; upstream inserts `tr > td.success|error` after it and keeps `MaxFleetSetting` (3) rows.
- Header: `tr.info_header td` is a good place for summary chips. Width is fixed at 654 px.

## 6. Tournament page [REAL tournament.html]
Not player stats/highscore. Five boards (top 15 players each) of the current tournament round:

| board | tab (`.ach_menu li.skilsN a`) | title (`#skilsN center b`) | sample #1 |
|---|---|---|---|
| `div#skils1.ach_content_box` | Alpha | Victory tournament! | terror (4359) 5 |
| `#skils2` | Beta | Moon Destruction tournament! | freddy (3832) 0 |
| `#skils3` | Gamma | Dark Matter expedition tournament! | Anonymous (3850) 1259 |
| `#skils4` | Delta | Building tournament! | terror (4359) 4130 (we are #2, 1860) |
| `#skils5` | Epsilon | Voting tournament! | Axion destruyemundos (3863) 30 |

- Countdown to round end: `span.countdown2[secs="178960"]` text "02d 01h 42m: 41s".
- Prizes: `.record_name_utits` "20.000 units" / "15.000 units" / "10.000 units" (gold/silver/bronze imgs), same on every board.
- Rows: `tr` containing `span.ticket_row_linck_id` (position), `span.ticket_row_linck_subject a[onclick="return Dialog.Playercard(4377, 'vodoleyko1992');"]` (player **id** + name), `span.ticket_row_linck_status` (points). Some players have an **empty name** (`Dialog.Playercard(3834, '')`), keep the id.
- Hidden boards are `style="display:none"` but fully in the HTML; tabs switch with `openV('skilsN', N)`.
- Use: a cheap id <-> name directory for active players; it does not contain rank, points or alliance.

Highscore (`page=statistics`) was not saved. Upstream rows [UPSTREAM shared.statistics.playerTable.tpl:9-15]: `td a.tooltip` rank (+/- change in tooltip), `a[onclick*="Dialog.Playercard(ID, 'name')"]` (own row `style="color:lime"`), PM icon, alliance `a[href*=alliance&mode=info&id=]`, points text. Live markup unknown (open question #5).

## 7. Parsing recipes (RUN, output below)

Run on the real pages by `node specs/galaxyz/tools/run_galaxy_md_snippets.js` (Playwright Chromium, `javaScriptEnabled:false`, `page.setContent(html)`, all requests aborted). Recipes need only `DOMParser`, so they work in a content script on `document` or on `new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html')`.

```js
// number "1.234.567" / "102" / "-27" -> 1234567 / 102 / -27 (GALAXYZ uses "." as thousands separator)
const gzInt = (s) => { const m = String(s || '').match(/-?\d[\d.]*/); return m ? parseInt(m[0].replace(/\./g, ''), 10) : null; };
const gzText = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
// tooltip HTML lives in the title attribute (Tipped/new_tooltip.js), older widgets use data-tooltip-content
const gzTip = (el) => {
  const html = el ? (el.getAttribute('title') || el.getAttribute('data-tooltip-content') || '') : '';
  return new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
};
// parse any game href (absolute after "Save page as", relative "?page=" / "game.php?page=" live)
const gzParams = (href) => new URLSearchParams(String(href || '').replace(/^[^?]*\?/, '').replace(/#.*$/, ''));

function gzGalaxyHeader(doc) {
  const form = doc.querySelector('form#galaxy_form');
  const info = doc.querySelector('#galaxytableHead tr.info_header');
  const pick = (re) => { const m = gzText(info).match(re); return m ? gzInt(m[1]) : null; };
  const slots = gzText(doc.querySelector('#slotValue')).match(/(\d+)\s*\/\s*(\d+)/);
  return {
    galaxy: gzInt(form && form.elements.galaxy.value),
    system: gzInt(form && form.elements.system.value),
    probes: pick(/([\d.]+)\s+Spy Probes/),
    recyclers: pick(/([\d.]+)\s+Recycler(?!\w)/),
    gigaRecyclers: pick(/([\d.]+)\s+Giga Recycler/),
    missiles: pick(/([\d.]+)\s+Available Missiles/),
    slotsUsed: slots ? +slots[1] : null,
    slotsMax: slots ? +slots[2] : null,
    existingPlanets: gzInt(gzText(doc.querySelector('#colonized'))),
    expeditionHref: (doc.querySelector('#expeditionbutton a') || {}).href || null,
  };
}

function gzGalaxyRows(doc) {
  const rows = [...doc.querySelectorAll('#galaxytableHead > tbody > tr.row')];
  return rows.map((tr, i) => {
    const posCell = tr.querySelector('td.position');
    const position = gzInt(gzText(posCell)) || i + 1;
    const planetCell = tr.querySelector('td[class^="microplanet"]');
    if (!planetCell) {                                     // free slot: colonize link + fields/temperature hint
      const a = posCell && posCell.querySelector('a[href*="target_mission=7"]');
      const t = a ? (a.getAttribute('title') || '') : '';
      const f = t.match(/fields:\s*(\d+)-(\d+)/i);
      const c = t.match(/(-?\d+)°C\s*to\s*(-?\d+)°C/i);
      return { position, empty: true, colonizeHref: a ? a.getAttribute('href') : null,
        fieldsMin: f ? +f[1] : null, fieldsMax: f ? +f[2] : null, tempMin: c ? +c[1] : null, tempMax: c ? +c[2] : null };
    }
    const pTip = gzTip(planetCell.querySelector('a'));
    const links = [...pTip.querySelectorAll('ul.ListLinks a')].map((a) => {
      const href = a.getAttribute('href') || '';
      const doit = href.match(/doit\((\d+)\s*,\s*(\d+)/);            // upstream one-click: doit(6|8, planetId)
      const q = gzParams(href);
      return { label: gzText(a), href, mission: doit ? +doit[1] : gzInt(q.get('target_mission')),
        planetId: doit ? +doit[2] : null, planettype: gzInt(q.get('planettype')) };
    });
    const nameCell = tr.querySelector('td[class^="planetname"]');
    const nameRaw = gzText(nameCell);
    const act = nameRaw.match(/\((\*|\d+\s*min)\)\s*$/);
    const playerA = tr.querySelector('td.playername a');
    const userSpan = tr.querySelector('td.playername .galaxy-username');
    const plTip = gzTip(playerA);
    const pcard = (playerA && playerA.getAttribute('title') || '').match(/Playercard\((\d+)/);
    const rank = plTip.querySelector('li.rank');
    const flags = userSpan ? [...userSpan.classList].filter((c) => c.startsWith('galaxy-username-')).map((c) => c.slice(16)) : [];
    const short = [...tr.querySelectorAll('td.playername .galaxy-short')].map(gzText);
    const ally = tr.querySelector('td.allytag .galaxy-alliance');
    const debrisTip = gzTip(tr.querySelector('td.debris a'));
    const dbTxt = gzText(debrisTip.body);
    const dm = dbTxt.match(/Metal:?\s*([\d.]+)/i), dc = dbTxt.match(/Crystal:?\s*([\d.]+)/i);
    return {
      position, empty: false,
      coords: gzText(pTip.querySelector('#pos-planet')) || null,
      planetName: nameRaw.replace(/\s*\((\*|\d+\s*min)\)\s*$/, ''),
      activity: act ? (act[1] === '*' ? 0 : gzInt(act[1])) : null,          // 0 = <15 min, N = N min, null = >=60 min
      planetImg: (pTip.querySelector('img.planetTooltip') || {}).className || null,
      missions: links.filter((l) => l.mission != null),
      player: userSpan ? gzText(userSpan) : null,
      playerId: pcard ? +pcard[1] : null,
      rank: rank ? gzInt(gzText(rank)) : null,
      statsHref: (plTip.querySelector('a[href*="page=statistics"]') || { getAttribute: () => null }).getAttribute('href'),
      flags, short,
      own: !!userSpan && !flags.length && links.some((l) => l.mission === 4),
      moon: !!tr.querySelector('td.moon a, td.moon img'),
      debris: dm || dc ? { metal: dm ? gzInt(dm[1]) : 0, crystal: dc ? gzInt(dc[1]) : 0 } : (tr.querySelector('td.debris a, td.debris img') ? {} : null),
      ally: ally ? gzText(ally) : (gzText(tr.querySelector('td.allytag')) || null),
      actions: [...tr.querySelectorAll('td.action a')].map((a) => a.getAttribute('href') + ' ' + (a.getAttribute('onclick') || '')),
    };
  });
}

function gzTournament(doc) {
  const out = { endsInSec: gzInt((doc.querySelector('.countdown2') || { getAttribute: () => null }).getAttribute('secs')), boards: [] };
  doc.querySelectorAll('div.ach_content_box[id^="skils"]').forEach((box) => {
    const n = box.id.replace('skils', '');
    const menu = doc.querySelector('.ach_menu li.skils' + n + ' a');
    const rows = [...box.querySelectorAll('tr')].filter((tr) => tr.querySelector('span.ticket_row_linck_id')).map((tr) => {
      const a = tr.querySelector('span.ticket_row_linck_subject a');
      const m = (a && a.getAttribute('onclick') || '').match(/Playercard\((\d+)/);
      return { pos: gzInt(gzText(tr.querySelector('.ticket_row_linck_id'))), playerId: m ? +m[1] : null,
        name: gzText(a), points: gzInt(gzText(tr.querySelector('.ticket_row_linck_status'))) };
    });
    out.boards.push({ id: box.id, tab: gzText(menu), title: gzText(box.querySelector('center b')),
      prizes: [...box.querySelectorAll('.record_name_utits')].map(gzText), rows });
  });
  return out;
}
```

Observed output (trimmed, 30 Oct 2026):
```json
{
 "header": {
  "galaxy": 2,
  "system": 68,
  "probes": 102,
  "recyclers": 0,
  "gigaRecyclers": 0,
  "missiles": 0,
  "slotsUsed": 1,
  "slotsMax": 13,
  "existingPlanets": 1,
  "expeditionHref": "https://ogamex.eu/Aeternum/game.php?page=fleetTable&galaxy=2&system=68&planet=16&planettype=1&target_mission=15"
 },
 "rowCount": 15,
 "row1": {
  "position": 1,
  "empty": true,
  "colonizeHref": "https://ogamex.eu/Aeternum/game.php?page=fleetTable&galaxy=2&system=68&planet=1&planettype=1&target_mission=7",
  "fieldsMin": 215,
  "fieldsMax": 244,
  "tempMin": 220,
  "tempMax": 260
 },
 "row5": {
  "position": 5,
  "empty": false,
  "coords": "[2:68:5]",
  "planetName": "Главная планета",
  "activity": 0,
  "planetImg": "planetTooltip jungle_2",
  "missions": [
   {
    "label": "Deploy",
    "href": "?page=fleetTable&galaxy=2&system=68&planet=5&planettype=1&target_mission=4",
    "mission": 4,
    "planetId": null,
    "planettype": 1
   },
   {
    "label": "Transport",
    "href": "?page=fleetTable&galaxy=2&system=68&planet=5&planettype=1&target_mission=3",
    "mission": 3,
    "planetId": null,
    "planettype": 1
   }
  ],
  "player": "vodoleyko1992",
  "playerId": null,
  "rank": 194,
  "statsHref": "?page=statistics&who=1&start=194",
  "flags": [],
  "short": [],
  "own": true,
  "moon": false,
  "debris": null,
  "ally": null,
  "actions": []
 },
 "row6": {
  "position": 6,
  "empty": false,
  "coords": "[2:68:6]",
  "planetName": "Colony",
  "activity": 49,
  "planetImg": "planetTooltip jungle_2",
  "missions": [
   {
    "label": "Deploy",
    "href": "?page=fleetTable&galaxy=2&system=68&planet=6&planettype=1&target_mission=4",
    "mission": 4,
    "planetId": null,
    "planettype": 1
   },
   "... Transport (3)"
  ],
  "player": "vodoleyko1992",
  "playerId": null,
  "rank": 194,
  "statsHref": "?page=statistics&who=1&start=194",
  "flags": [],
  "short": [],
  "own": true,
  "moon": false,
  "debris": null,
  "ally": null,
  "actions": []
 },
 "dupIds": [
  "recycler:2",
  "planetList:4",
  "pos-planet:0",
  "player:0"
 ],
 "tournament": {
  "endsInSec": 178960,
  "boards": [
   {
    "id": "skils1",
    "tab": "Alpha",
    "title": "Victory tournament!",
    "prizes": [
     "20.000 units",
     "15.000 units",
     "10.000 units"
    ],
    "n": 15,
    "first": {
     "pos": 1,
     "playerId": 4359,
     "name": "terror",
     "points": 5
    },
    "me": {
     "pos": 10,
     "playerId": 4377,
     "name": "vodoleyko1992",
     "points": 0
    }
   },
   {
    "id": "skils2",
    "tab": "Beta",
    "title": "Moon Destruction tournament!",
    "prizes": [
     "20.000 units",
     "15.000 units",
     "10.000 units"
    ],
    "n": 15,
    "first": {
     "pos": 1,
     "playerId": 3832,
     "name": "freddy",
     "points": 0
    }
   },
   {
    "id": "skils4",
    "tab": "Delta",
    "title": "Building tournament!",
    "n": 15,
    "first": {
     "pos": 1,
     "playerId": 4359,
     "name": "terror",
     "points": 4130
    },
    "me": {
     "pos": 2,
     "playerId": 4377,
     "name": "vodoleyko1992",
     "points": 1860
    }
   },
   {
    "id": "skils5",
    "tab": "Epsilon",
    "title": "Voting tournament!",
    "n": 15,
    "first": {
     "pos": 1,
     "playerId": 3863,
     "name": "Axion destruyemundos",
     "points": 30
    },
    "me": {
     "pos": 5,
     "playerId": 4377,
     "name": "vodoleyko1992",
     "points": 20
    }
   }
  ]
 }
}
```
Foreign-row fields (`playerId`, `flags`, `short`, `moon`, `debris`, `ally`, `actions`, `missions[].planetId`) come back `null`/empty on the real page because no foreign row exists; the selectors for them are [INFERRED] from upstream and must be re-run on a saved foreign system.

## 8. Lanedirt OgameX vs GALAXYZ
| | lanedirt OgameX | GALAXYZ |
|---|---|---|
| system data | `POST /ajax/galaxy` JSON | full HTML page `page=galaxy` |
| navigation | JS, no reload | form POST / GET reload |
| player id in row | JSON | only via Playercard/doit links (foreign rows) |
| spy | `/ajax/fleet/dispatch/send-espionage` | `page=fleetAjax&ajax=1&mission=6&planetID=` (upstream) |
| cost | free | deuterium per foreign system (upstream) |
Nothing of the old `specs/galaxy.md` recipes is reusable except the general ideas (badge injection, polite scanning).

## 9. Open questions
1. Saved foreign system pages (inactive, vacation, banned, noob/strong, moon, debris, alliance, destroyed planet) to confirm sections 3.2/3.3.
2. Meaning of "(1 Existing planets)" in `#colonized`.
3. `deuterium_cost_galaxy` on ogamex.eu (see "Game information" `Dialog.Server()` -> `game.php?page=Serverinfo`), and whether GET navigation charges the same as POST.
4. Live `galaxy.js` (`doit`) and a real fleetAjax response; whether it needs a token.
5. Live `page=statistics` markup (highscore) and `page=playerCard` popup.
6. Is `microplanet1`/`planetname1` constant, or does the digit vary (planet type/size)? Recipes use `[class^=...]` to be safe.
