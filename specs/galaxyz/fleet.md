# GALAXYZ (ogamex.eu) fleet: fleetTable, dispatch flow, events, formulas

Target: `https://ogamex.eu/Aeternum/game.php?page=<name>`, `<meta name="generator" content="GALAXYZ 1.8.git">` (2Moons fork).
Replaces `specs/fleet.md` (lanedirt OgameX: `/fleet`, `/ajax/fleet/dispatch/*`, none of which exists here) for GALAXYZ.
Read `specs/galaxyz/layout.md` first (detection, duplicated ids, number formats, server time, the event box).

Tags: **[REAL x.html]** = seen in `eu/pages/x.html` (saved 2026-10-30, account with 4 planets, no moon, Admiral 0).
**[UPSTREAM file:line]** = upstream 2Moons in `src/2Moons/` (paths below are relative to it), not seen live. **[GUESS]** = neither.

Every recipe below is in `tools/run_fleet_snippets.js` and was RUN on the real pages (Chromium, JS disabled, raw saved DOM):
`cd specs/galaxyz && NODE_PATH=$(npm root -g) node tools/run_fleet_snippets.js [--only=step1,step2]`. Outputs pasted below are copied from that run.

## 0. Summary

| what | where | tag |
|---|---|---|
| fleet slots / expeditions / asteroids | `page=fleetTable`, `.fleetTablemain th[colspan=9] > div.transparent` x3: `Fleet 1 / 13`, `0 / 2 expedition`, `0 / 5 Asteroids` | REAL fleetTable.html |
| own flying fleets (movement list) | `page=fleetTable`, first `table.listOfOthers` rows with 9 `td` | REAL |
| recall | `POST page=fleetTable&action=sendfleetback`, body `fleetID=<id>` (no token) | REAL |
| ships on current planet | `page=fleetTable`, `td#ship<ID>_value`, input `name=ship<ID>`, speed in `span.tooltip[data-tooltip-content="Speed:  6000"]` | REAL |
| tech bonus % (attack/def/shield/3 engines) | `page=fleetTable`, `img.tooltipTop[title="Impulse Engine +140 %"]` | REAL |
| dispatch | `POST fleetStep1` -> HTML with `token` + `data={...}` -> `POST fleetStep2` -> HTML with mission radios -> `POST fleetStep3` -> "Fleet sent" table + meta refresh to fleetTable | REAL fleetStep1/2/3.html |
| one-click spy/recycle | `GET page=fleetAjax&ajax=1&mission=6|8&planetID=<targetPlanetId>` -> JSON `{code,mess,slots,ships}` | UPSTREAM ShowFleetAjaxPage.class.php:38-219, scripts/game/galaxy.js:1-20 |
| prefilled dispatch links | `page=fleetTable&galaxy=&system=&planet=&planettype=&target_mission=` (GET) | REAL galaxy.html, messages-spy.html |
| transport page | `page=transport` (GALAXYZ-only) needs Admiral level 10, else an "Info" error page | REAL transport.html |
| event box (overview & every full page) | `#messages_collapsed .OvfleetEvents_ > span.fleets[id^=fleettime_]` | REAL, details in layout.md section 7 + section 6 here |
| formulas | distance / duration / consumption reproduce every number on the real pages exactly | UPSTREAM class.FleetFunctions.php:89-201 + scripts/game/flotten.js:13-48, verified |

Hard facts that change the design vs the lanedirt spec:
* There is **no JSON dispatch API**. Dispatch is 3 HTML form POSTs; the fleet (ships) and the target live in the PHP **session under a token** created by step 1. Step 2/3 forms carry only `token` + the step's own fields.
* There is **no event-list AJAX**. Events are server-rendered into every full page (`#messages_collapsed`). Refresh = refetch any cheap page (or keep counting `data-fleet-time` down).
* Galaxy one-click spy/recycle is `fleetAjax` (GET, JSON). The real galaxy.html of this account had no foreign planet in view, so no `doit(` link was seen [open question 1].

---

## 1. `page=fleetTable` [REAL fleetTable.html]

URL: `game.php?page=fleetTable[&cp=<planetId>]`. Body id `fleetTable`. Also accepts GET/POST prefill `galaxy, system, planet, planettype, target_mission` (copied into the hidden fields of the step-1 form) [UPSTREAM ShowFleetTablePage.class.php:206-210]. Note the prefill name is **`planettype`** here but **`type`** in the form it renders.

Skeleton (`#inhalt`):

```
div#messages_collapsed ...                          event box (layout.md 7)
div#planet > h2 "Details: Главная планета"          current planet name (Cyrillic possible)
div.headerRS
div.mainRS.fleetTablemain
  table.list.listOfOthers                           (1) slots header + movement list (9 columns)
  form[action$="page=fleetStep1"][method=post]      (2) hidden target + ship list
    input:hidden galaxy, system, planet, type, target_mission
    table.table519.list.listOfOthers.hard-table     ship rows
    table.hard-table                                (3) "Bonus" table (inside the form)
div.footerRS
div#rechts ...                                      planet list
```

### 1.1 Slots, expeditions, asteroids

`th[colspan="9"]` holds three `div.transparent`, text is split by newlines/spaces in the source (`Fleet 1 /\n   13`), so normalise whitespace.
GALAXYZ adds a third div "Asteroids" (not in upstream page.fleetTable.default.tpl:6-7). Its mission id is unknown [open question 2].
Upstream: slots used = count of own rows in `FLEETS` (every mission, outward+return of one fleet = 1 slot); max = `1 + computer tech(108) + factor` [UPSTREAM class.FleetFunctions.php:142-146]; expeditions max = `floor(sqrt(astrophysics(124)))` [UPSTREAM ShowFleetTablePage.class.php:191-201].

```js
const divs = [...document.querySelectorAll('.fleetTablemain th[colspan="9"] > div.transparent')].map(d => d.textContent.replace(/\s+/g, ' ').trim());
const pair = s => s.match(/(\d+)\s*\/\s*(\d+)/).slice(1).map(Number);
({ divs, slots: pair(divs[0]), expeditions: pair(divs[1]), asteroids: pair(divs[2]) })
// fleetTable.html -> {"divs":["Fleet 1 / 13","0 / 2 expedition","0 / 5 Asteroids"],"slots":[1,13],"expeditions":[0,2],"asteroids":[0,5]}
```

Do not match on the English words: `Lang` is a user setting. Use div order (slots, expeditions, asteroids). The galaxy page has the same slots as `#slotValue` `1/13` [REAL galaxy.html].

### 1.2 Movement list (own fleets only)

Header row texts [REAL]: `ID | Mission | Number | Start | Arrival(Destination) | Destination | Arrival(Back) | Objective | Order`. Column meaning (labels are misleading):

| col | content | sample [REAL] | upstream [page.fleetTable.default.tpl:23-56] |
|---|---|---|---|
| 0 | row number 1..n (NOT the fleet id) | `1` | `iteration` |
| 1 | mission name + `<br><a title="Fleet Target">(A)</a>` outward / `(R)` returning | `Recycle (A)` | `fl_a` / `fl_r` by `fleet_mess` |
| 2 | `a.tooltip_sticky` text = total ships (grouped `8.290`), `data-tooltip-content` = HTML table `Recycler:` / `8290` (ungrouped) | `8.290` | |
| 3 | origin link `[2:68:5]` (href `page=galaxy&galaxy=2&system=68`) | `[2:68:5]` | start coords |
| 4 | arrival at target, `style="color:lime"` while outward | `30. Oct 2026, 10:20:29` | `fleet_start_time` |
| 5 | target link | `[2:87:8]` | end coords |
| 6 | back home time (`-` for Deploy(4) outward) | `30. Oct 2026, 10:47:11` | `fleet_end_time` |
| 7 | `td#fleettime_<rowNo>.fleets[data-fleet-end-time=<unix>][data-fleet-time=<restSec>]` countdown to **return** (for Deploy outward: to arrival) | `00:42:47` | |
| 8 | recall form (only when not returning and not in vacation), else `&nbsp;-&nbsp;`; Attack(1) also gets an ACS form `action=acs` | form | |

Pitfalls:
* `td#fleettime_1` uses the ROW number; the event box uses `fleettime_<endUnix><fleetId>`. Both have class `.fleets` and are counted down by the same fleetTable.js (identical to upstream scripts/game/fleetTable.js). Never `document.querySelectorAll('.fleets')` globally.
* Dates are `D. Mon YYYY, HH:MM:SS` server wall clock (+ user timezone setting) [UPSTREAM `_date($LNG['php_tdformat'])`]; prefer `data-fleet-end-time` (unix).
* Empty list renders one row of nine `-` cells [UPSTREAM tpl:58-69]; the `/^\d+$/` test on cell 0 filters it out.
* Fleet id comes only from the recall form; a returning row has no form and therefore no id here (the event box key has it: layout.md 7).

```js
[...document.querySelectorAll('.fleetTablemain table.listOfOthers tr')]
  .filter(tr => tr.cells.length === 9 && tr.cells[0].tagName === 'TD' && /^\d+$/.test(tr.cells[0].textContent.trim()))
  .map(tr => {
    const c = tr.cells, tip = c[2].querySelector('a.tooltip_sticky'), ships = {};
    if (tip) { const d = new DOMParser().parseFromString(tip.dataset.tooltipContent, 'text/html');
      for (const r of d.querySelectorAll('tr')) { const td = r.querySelectorAll('td'); if (td.length === 2) ships[td[0].textContent.replace(/:$/, '').trim()] = +td[1].textContent.replace(/\./g, ''); } }
    const timer = c[7].querySelector('[id^="fleettime_"]') || c[7];
    const form = c[8].querySelector('form[action*="action=sendfleetback"]');
    return { row: +c[0].textContent, mission: c[1].firstChild.textContent.trim(), state: c[1].querySelector('a')?.textContent.trim() ?? null,
      amount: +c[2].textContent.trim().replace(/\./g, ''), ships,
      from: c[3].textContent.trim(), arriveText: c[4].textContent.trim(), outward: /lime/.test(c[4].getAttribute('style') || ''),
      to: c[5].textContent.trim(), backText: c[6].textContent.trim(),
      backUnix: +timer.dataset.fleetEndTime, restSec: +timer.dataset.fleetTime,
      fleetId: form ? +form.querySelector('input[name=fleetID]').value : null, recallUrl: form?.getAttribute('action') ?? null };
  })
// fleetTable.html -> [{"row":1,"mission":"Recycle","state":"(A)","amount":8290,"ships":{"Recycler":8290},"from":"[2:68:5]",
//   "arriveText":"30. Oct 2026, 10:20:29","outward":true,"to":"[2:87:8]","backText":"30. Oct 2026, 10:47:11","backUnix":1793350031,
//   "restSec":2571,"fleetId":396900,"recallUrl":"https://ogamex.eu/Aeternum/game.php?page=fleetTable&action=sendfleetback"}]
```

Ship names in the tooltip are localized names, not ids. Map them through the ship list (1.3) or `elements.json`.

### 1.3 Recall [REAL markup, UPSTREAM behaviour]

```html
<form action="https://ogamex.eu/Aeternum/game.php?page=fleetTable&amp;action=sendfleetback" method="post">
  <input name="fleetID" value="396900" type="hidden">
  <input class="button red small tooltip" data-tooltip-content="Return" value="Return" type="submit">
</form>
```

* `POST game.php?page=fleetTable&action=sendfleetback`, body `fleetID=396900`. No token, no confirmation. Response = the normal fleetTable page.
* Server [UPSTREAM class.FleetFunctions.php:298-384]: refused silently when not the owner or `fleet_mess==1` (already returning). New return time = `now + (now - start_time)` (= time already flown); Hold(5) while holding: `now + (fleet_start_time - start_time)`. For an ACS leader the whole group returns.
* Recall only on an explicit user click.

### 1.4 Ships on planet and the form to step 1

```html
<form action="https://ogamex.eu/Aeternum/game.php?page=fleetStep1" method="post">
  <input type="hidden" name="galaxy" value="2"> ... name="system" 68, name="planet" 5, name="type" 1, name="target_mission" 0
  <tr><td><img src="./7_files/208.gif" alt="Colony Ship"> <span class="tooltip" data-tooltip-content="Speed:  6000">Colony Ship</span></td>
      <td id="ship208_value">2</td>
      <td><a class="button black small" href="javascript:maxShip('ship208');">max</a></td>
      <td><input name="ship208" id="ship208_input" size="10" value="0"></td></tr>
  <tr> ... 212 Solar Satellite: no speed span, no input (cannot fly) </tr>
  <tr class="alt"> javascript:noShips() / javascript:maxShips() </tr>
  <input class="button green" type="submit" value="Continue">
```

* Only ships with count > 0 are listed [UPSTREAM ShowFleetTablePage.class.php:252-264]. Count is grouped (`1.234`).
* Speed in the tooltip is the **effective** speed with engine techs (`Speed:  6000` = colony ship 2500 x (1 + 0.2 x impulse 7); spy probe `220000000` = 100M x (1 + 0.1 x combustion 12)). Two spaces after the colon.
* Differences to upstream: GALAXYZ uses absolute URLs, `#shipNNN_value` / `#shipNNN_input` ids (upstream the same), `button` classes, the satellite row; the form has **no token** (the token is created by step 1).
* Img `src` is the saved local copy (`./7_files/208.gif`); on the live page it is the skin path. Use the `id`, not the image.

```js
const form = document.querySelector('form[action*="page=fleetStep1"]');
const hidden = Object.fromEntries([...form.querySelectorAll('input[type=hidden]')].map(i => [i.name, i.value]));
const ships = [...form.querySelectorAll('td[id^="ship"][id$="_value"]')].map(td => {
  const id = +td.id.match(/^ship(\d+)_value$/)[1], row = td.parentElement, sp = row.querySelector('span.tooltip[data-tooltip-content]');
  return { id, name: row.querySelector('img').alt, count: +td.textContent.trim().replace(/\./g, ''),
    speed: sp ? +sp.dataset.tooltipContent.replace(/\D/g, '') : null, input: row.querySelector('input[name="ship' + id + '"]')?.id ?? null };
});
({ action: form.getAttribute('action'), hidden, ships })
// fleetTable.html -> {"action":"https://ogamex.eu/Aeternum/game.php?page=fleetStep1","hidden":{"galaxy":"2","system":"68","planet":"5","type":"1","target_mission":"0"},
//   "ships":[{"id":208,"name":"Colony Ship","count":2,"speed":6000,"input":"ship208_input"},{"id":210,"name":"Spy Probe","count":102,"speed":220000000,"input":"ship210_input"},
//            {"id":212,"name":"Solar Satellite","count":797,"speed":null,"input":null}]}
```

### 1.5 Bonus table (GALAXYZ shows it inside the form)

`table.hard-table` with six `img.tooltipTop[title="<Name> +N %"]`, cell text `+N %`. Key by the icon file name (language independent): `attack, defence, shield, combustion, impulse, hiperspace` (sic).
Upstream values [UPSTREAM ShowFleetTablePage.class.php:281-286]: attack/defence/shield = `tech x 10 + officer factor x 100` (so +35 is NOT a tech level), engines = `combustion x 10`, `impulse x 20`, `hyperspace x 30` -> engine levels = 12, 7, 4 here. Those levels give ship speeds without any other page.

```js
Object.fromEntries([...document.querySelectorAll('.fleetTablemain table.hard-table img.tooltipTop[title]')].map(i => {
  const m = i.title.match(/^(.*?)\s*\+?(-?\d+)\s*%$/); return [i.getAttribute('src').match(/([a-z]+)\.png$/)[1], +m[2]]; }))
// fleetTable.html -> {"attack":35,"defence":85,"shield":60,"combustion":120,"impulse":140,"hiperspace":120}
```

### 1.6 Prefill links that land on fleetTable [REAL]

* galaxy.html: `page=fleetTable&galaxy=2&system=68&planet=16&planettype=1&target_mission=15` (expedition = position **16** = `max_planets + 1`, so max_planets = 15), `...&planet=10&planettype=1&target_mission=7` (colonize, empty slot). Transport(3)/Deploy(4) links to own planets exist only inside galaxy tooltips (`data-tooltip-content`, `&amp;`-escaped).
* messages-spy.html "Attack": `?page=fleetTable&galaxy=2&system=81&planet=10&planettype=1&target_mission=1`.

```js
[...new Set([...document.querySelectorAll('a[href*="page=fleetTable&"][href*="target_mission="]')].map(a => { const q = new URL(a.href).searchParams; return [...q.keys()].join('&') + '  mission=' + q.get('target_mission'); }))]
// galaxy.html -> ["page&galaxy&system&planet&planettype&target_mission  mission=15","page&galaxy&system&planet&planettype&target_mission  mission=7"]
```

The extension can build the same URL to preselect a target; the user still picks ships and clicks.

---

## 2. Dispatch flow fleetStep1 -> fleetStep2 -> fleetStep3 [REAL fleetStep1/2/3.html]

Recorded flow: 1 Colony Ship from [2:68:5] to [2:68:9], 100 %, 7382 metal, mission 7.

```
fleetTable form           POST page=fleetStep1   galaxy,system,planet,type,target_mission, ship<ID>=N ...
  server: $_SESSION['fleet'][token] = {time, fleet, fleetRoom}         [UPSTREAM ShowFleetStep1Page.class.php:38-71]
fleetStep1.html form      POST page=fleetStep2   token, fleet_group, target_mission, galaxy, system, planet, type, speed
  (submit guarded by CheckTarget(): GET page=fleetStep1&mode=checkTarget&galaxy&system&planet&planet_type&lang&kolo -> JSON "OK" or an error string)
  server: computes distance/duration/consumption, stores target+speed in the session entry  [UPSTREAM ShowFleetStep2Page.class.php:33-110]
fleetStep2.html form      POST page=fleetStep3   token, mission, metal, crystal, deuterium [, staytime]
  server: re-validates everything, sends, unset($_SESSION['fleet'][token])                  [UPSTREAM ShowFleetStep3Page.class.php:35-424]
fleetStep3.html           "Fleet sent" table, <meta http-equiv="refresh" content="3;URL=game.php?page=fleetTable">
```

Token: 32 hex chars, `d583ed8b434e588148fe929b8f939eab`, **the same value in step 1 and step 2** (one token per dispatch, not per form). Single use (step 3 unsets it), expires 600 s after step 1 [UPSTREAM ShowFleetStep3Page.class.php:44-54]. Unknown/expired token -> redirect to `page=fleetTable` (`FleetFunctions::GotoFleetPage`, `&code=N`).
Changing ships or target means starting again at step 1. Several dispatches can run in parallel (one session entry per token).
No CSRF token besides this; the session cookie authenticates. Content-Type `application/x-www-form-urlencoded`.

### 2.1 Step 1 page (`page=fleetStep1`, POST only; no ships -> redirect to fleetTable)

```html
<form action="https://ogamex.eu/Aeternum/game.php?page=fleetStep2" method="post" onsubmit="return CheckTarget()" id="form" class="mainRS">
  <input type="hidden" name="token" value="d583ed8b434e588148fe929b8f939eab">
  <input type="hidden" name="fleet_group" value="0">
  <input type="hidden" name="target_mission" value="0">
  <input id="galaxy" name="galaxy" maxlength="2" value="2"> <input id="system" name="system" maxlength="3" value="68"> <input id="planet" name="planet" maxlength="2" value="5">
  <select id="type" name="type">1 Planet | 2 Debris Field | 3 Moon</select>
  <select id="speed" name="speed">10=100 ... 1=10</select> %
  td#distance, td#duration, td#arrival, td#return, td#consumption, td#maxspeed, td#storage   (filled by flotten.js)
  table.shortcut ... ("Shortcuts", inputs name="shortcut[][name|galaxy|system|planet|type]")
  "My planets": a[href="javascript:setTarget(2,68,6,1);updateVars();"]  (current planet excluded)
  (ACS list: javascript:setACSTarget(g,s,p,type,acsId) [UPSTREAM page.fleetStep1.default.tpl:137-151], none here)
</form>
<script> data = {"fleetroom":"7500","gamespeed":7,"fleetspeedfactor":1,"planet":{"galaxy":"2","system":"68","planet":"5","planet_type":"1"},
                  "maxspeed":6000.000000000001,"ships":{"208":{"consumption":"1000","speed":6000.000000000001,"amount":"1"}},"fleetMinDuration":5};
          shortCutRows = 2; fl_no_shortcuts = 'No shortcuts'; </script>
```

`data` fields [UPSTREAM ShowFleetStep1Page.class.php:55-63]: `fleetroom` = cargo capacity of the chosen fleet x (1 + ShipStorage factor), STRING; `gamespeed` = `fleet_speed / 2500` (**7** on Aeternum); `fleetspeedfactor` = `max(0, 1 + FlyTime factor)` (officer/bonus, 1 = none); `maxspeed` = slowest ship (float noise `6000.000000000001`); `ships[id]` = `{consumption (string, base or consumption2), speed (effective), amount (string)}`; `fleetMinDuration` = 5 s.
`#duration/#arrival/#return/#consumption/#storage` are written by page JS: in the server HTML they are empty; the saved page is post-JS (`0:00:47 h`, `Oct Fri 30 10:08:48`). Compute them yourself (section 4), do not read them.

```js
const f = document.querySelector('form#form[action*="page=fleetStep2"]');
const fields = {}; for (const el of f.querySelectorAll('input[name], select[name]')) if (!/^shortcut/.test(el.name)) fields[el.name] = el.value;
const data = (doc => { const m = [...doc.scripts].map(s => s.textContent).join('\n').match(/^\s*data\s*=\s*(\{.*\});\s*$/m); return m ? JSON.parse(m[1]) : null; })(document);
({ action: f.getAttribute('action'), fields,
   speeds: [...f.querySelectorAll('#speed option')].map(o => o.value + '=' + o.textContent + '%'),
   types: [...f.querySelectorAll('#type option')].map(o => o.value + '=' + o.textContent),
   shown: Object.fromEntries(['distance','duration','arrival','return','consumption','maxspeed','storage'].map(k => [k, document.getElementById(k)?.textContent.trim()])),
   colonies: [...f.querySelectorAll('a[href^="javascript:setTarget("]')].map(a => a.getAttribute('href').match(/setTarget\(([\d,]+)\)/)[1] + ' ' + a.textContent.replace(/\s+/g, ' ').trim()),
   data })
// fleetStep1.html -> {"action":"https://ogamex.eu/Aeternum/game.php?page=fleetStep2",
//  "fields":{"token":"d583ed8b434e588148fe929b8f939eab","fleet_group":"0","target_mission":"0","galaxy":"2","system":"68","planet":"5","type":"1","speed":"10"},
//  "speeds":["10=100%","9=90%",...,"1=10%"],"types":["1=Planet","2=Debris Field","3=Moon"],
//  "shown":{"distance":"5","duration":"0:00:47 h","arrival":"Oct Fri 30 10:08:48","return":"Oct Fri 30 10:09:35","consumption":"2","maxspeed":"6.000","storage":"7.498"},
//  "colonies":["2,68,6,1 Colony [2:68:6]","2,68,7,1 Colony [2:68:7]","2,68,8,1 Colony [2:68:8]"],
//  "data":{"fleetroom":"7500","gamespeed":7,"fleetspeedfactor":1,"planet":{...},"maxspeed":6000.000000000001,"ships":{"208":{"consumption":"1000","speed":6000.000000000001,"amount":"1"}},"fleetMinDuration":5}}
```

Pitfalls: the regex for `data` must be anchored to a line start (`data\t\t\t= {...};` uses TABs; other inline scripts contain `data.` and `data-`). `fleetroom`/`amount`/`consumption` are strings, `speed`/`maxspeed` are floats. Upstream copies `target_mission` from the fleetTable form into this hidden input [UPSTREAM page.fleetStep1.default.tpl:6]; on GALAXYZ it was `0` because the fleetTable form had `0` (propagation of a non-zero value not observed, open question 3). Speed values are tenths: `speed=10` = 100 %.

Shortcuts: `GET page=fleetStep1&mode=saveShortcuts&ajax=1&shortcut[<id>][name]=..` -> JSON string [UPSTREAM flotten.js:238, ShowFleetStep1Page.class.php:104-156]. Not needed by the extension.

### 2.2 Step 2 page (`page=fleetStep2`)

```html
<h2>Send fleet 2:68:5 - Planet</h2>                 <- ORIGIN coords + origin type, not the target
<form action="https://ogamex.eu/Aeternum/game.php?page=fleetStep3" method="post"><div class="mainRS">
  <input type="hidden" name="token" value="d583ed8b434e588148fe929b8f939eab">
  <input id="radio_7" type="radio" name="mission" value="7"><label for="radio_7"><span></span>Colonize</label>
  <input name="metal" ...> <input name="crystal" ...> <input name="deuterium" ...>      (maxResource('metal'), maxResources())
  td#remainingresources <font color="lime">7.382</font>     = fleetroom - consumption - loaded (JS)
  span#consumption.consumption 118
  span#fleetPoints.fleetPoints 150                            GALAXYZ-only ("Fleet points"), meaning unknown
  [UPSTREAM only when hold/expedition/DM: <select name="staytime"> hours; page.fleetStep2.default.tpl:57-63]
</div></form>
<script> data = {"fleetroom":"7500","consumption":"118"}; </script>
```

* Missions offered = `FleetFunctions::GetAvailableMissions` (section 3.2). Upstream pre-checks the radio equal to `target_mission`; here none is checked. Submitting without a mission makes the server default to 3 (Transport) [UPSTREAM ShowFleetStep3Page.class.php:35] - always send `mission` explicitly.
* Step 2 errors (empty debris, no mission possible, not enough deuterium) render a message page instead of the form (section 2.4).

```js
const f = document.querySelector('form[action*="page=fleetStep3"]');
({ action: f.getAttribute('action'), h2: document.querySelector('#inhalt h2')?.textContent.trim(), token: f.querySelector('input[name=token]').value,
   missions: [...f.querySelectorAll('input[type=radio][name=mission]')].map(r => ({ id: +r.value, label: f.querySelector('label[for="' + r.id + '"]')?.textContent.trim(), checked: r.checked })),
   staytime: [...f.querySelectorAll('select[name=staytime] option')].map(o => o.value),
   resourceInputs: [...f.querySelectorAll('input[name=metal], input[name=crystal], input[name=deuterium]')].map(i => i.name),
   capacityLeft: +document.getElementById('remainingresources').textContent.trim().replace(/\./g, ''),
   consumption: +document.getElementById('consumption').textContent.trim().replace(/\./g, ''),
   fleetPoints: +document.getElementById('fleetPoints')?.textContent.trim().replace(/\./g, ''),
   data: /* same data parser as 2.1 */ null })
// fleetStep2.html -> {"action":"https://ogamex.eu/Aeternum/game.php?page=fleetStep3","h2":"Send fleet 2:68:5 - Planet","token":"d583ed8b434e588148fe929b8f939eab",
//  "missions":[{"id":7,"label":"Colonize","checked":false}],"staytime":[],"resourceInputs":["metal","crystal","deuterium"],
//  "capacityLeft":7382,"consumption":118,"fleetPoints":150,"data":{"fleetroom":"7500","consumption":"118"}}
```

### 2.3 Step 3 result (`page=fleetStep3`)

```html
<meta http-equiv="refresh" content="3;URL=game.php?page=fleetTable">      (in <head>, relative URL)
<div class="mainRS"><table class="table519 list listOfOthers hard-table">
  <tr><th colspan="2" class="success">Fleet sent</th></tr>
  Mission | Colonize;  Distance | 1.020;  Fleet speed | 6.000;  Consumption of deuterium | 118;  From | 2:68:5;  Destination | 2:68:9;
  Target time | 30. Oct 2026, 10:20:01;  Time of Return | 30. Oct 2026, 10:30:54
  <tr><th colspan="2">Fleet</th></tr>  Colony Ship | 1
</table></div>
```

No `#rechts`/planet list on this page; the event box already contains the new fleet (`fleettime_1793348401396901`, fleet id **396901** = previous 396900 + 1, so ids are sequential per server, not per user).
Success marker: `th.success`. From/Destination have no brackets and no planet type (type is lost: moon vs planet not distinguishable here).

```js
const t = document.querySelector('#inhalt .mainRS table, .mainRS > table');
const ok = t?.querySelector('th.success');
if (ok) {
  const rows = [...t.rows], fleetAt = rows.findIndex((r, i) => i > 0 && r.cells.length === 1 && r.cells[0].tagName === 'TH');
  const kv = rows.slice(1, fleetAt).map(r => [r.cells[0].textContent.trim(), r.cells[1].textContent.trim()]);
  const ships = Object.fromEntries(rows.slice(fleetAt + 1).map(r => [r.cells[0].textContent.trim(), +r.cells[1].textContent.trim().replace(/\./g, '')]));
  ({ ok: true, title: ok.textContent.trim(), kv, ships, refresh: document.querySelector('meta[http-equiv="refresh" i]')?.content });
}
// fleetStep3.html -> {"ok":true,"title":"Fleet sent","kv":[["Mission","Colonize"],["Distance","1.020"],["Fleet speed","6.000"],["Consumption of deuterium","118"],
//   ["From","2:68:5"],["Destination","2:68:9"],["Target time","30. Oct 2026, 10:20:01"],["Time of Return","30. Oct 2026, 10:30:54"]],
//   "ships":{"Colony Ship":1},"refresh":"3;URL=game.php?page=fleetTable"}
```

Date parsing (`D. Mon YYYY, HH:MM:SS`, English month names from `php_tdformat`, server wall clock) checked against `serverTime`:

```js
const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const parse = s => { const m = s.match(/^(\d{1,2})\. (\w{3}) (\d{4}), (\d\d):(\d\d):(\d\d)$/); return m && Date.UTC(+m[3], months[m[2]], +m[1], +m[4], +m[5], +m[6]) / 1000; };
// fleetStep3.html -> {"serverWall":[2026,9,30,10,9,8],"target":"30. Oct 2026, 10:20:01","back":"30. Oct 2026, 10:30:54","oneWaySec":653,"returnLegSec":653}
```

(The result is "wall clock as UTC"; only differences are meaningful, see layout.md 6. Month names may be localized for other languages [GUESS].)

### 2.4 Errors in the flow

* Real GALAXYZ message page [REAL transport.html]: `#inhalt > .headerRS` text `Info`, `#inhalt > .mainRS > table.hard-table td` with `img[src*="warning"]`, `<p>message</p>` and a `<a href=...><button class="button black medium">Back</button></a>`; no `#rechts`, no event box. Upstream's `printMessage` (`error.default.tpl`: `table.table519 th "Info"` + `td p`) is what step 2/3 errors use [UPSTREAM ShowFleetStep3Page.class.php:73-375]; GALAXYZ presumably renders it with the transport.html markup [GUESS - no real step error saved].
* Robust check after POST step 3: success iff `th.success` exists; otherwise take the first `#inhalt .mainRS p` text as the error.
* Redirects to `page=fleetTable&code=N` (`GotoFleetPage`) for bad token / no ships / bad speed [UPSTREAM class.FleetFunctions.php:395-406].
* Step 3 checks [UPSTREAM ShowFleetStep3Page.class.php:44-375, order]: token, same planet, coords range, Transport without resources, fleet slots, ACS, colonize target exists / only planets, target exists, ships available, DM/expedition slots, mission in available list, vacation, bash, admin, noob/strong protection, Hold same alliance/buddy, deuterium, stay time, cargo space.

### 2.5 Programmatic dispatch (for later phases; only on an explicit user click or an explicit bot setting)

```js
const base = location.origin + location.pathname;           // https://ogamex.eu/Aeternum/game.php
const post = (q, body) => fetch(base + '?' + q, { method: 'POST', credentials: 'include', body: new URLSearchParams(body) }).then(r => r.text());
const doc = html => new DOMParser().parseFromString(html, 'text/html');
// 1. ships -> token (also gives data.maxspeed etc.)
const d1 = doc(await post('page=fleetStep1', { galaxy: 2, system: 68, planet: 5, type: 1, target_mission: 0, ship208: 1 }));
const token = d1.querySelector('form#form input[name=token]')?.value;          // null -> redirected to fleetTable (no ships)
// 2. target + speed -> available missions
const d2 = doc(await post('page=fleetStep2', { token, fleet_group: 0, target_mission: 0, galaxy: 2, system: 68, planet: 9, type: 1, speed: 10 }));
const missions = [...d2.querySelectorAll('input[name=mission]')].map(r => +r.value);   // [] -> error page
// 3. mission + cargo -> result
const d3 = doc(await post('page=fleetStep3', { token, mission: 7, metal: 7382, crystal: 0, deuterium: 0 /*, staytime: 1 */ }));
const ok = !!d3.querySelector('th.success');
```

The `cp` of the origin planet is the session's current planet: switch first with `page=fleetTable&cp=<id>` or add `&cp=<id>` to the step-1 URL [UPSTREAM: `cp` is read on every request, layout.md 4]. Not tested live (network blocked) - shape copied from the real forms.

---

## 3. Ids, missions, speeds

### 3.1 Mission ids [UPSTREAM language/en/INGAME.php:33-44 (labels), class.FlyingFleetsTable.php:156-169 (event style)]

| id | mission (real label seen) | event style class | notes |
|---|---|---|---|
| 1 | Attack | attack | messages-spy "Attack" link uses `target_mission=1` [REAL] |
| 2 | ACS attack | federation | needs `fleet_group` (ACS id) |
| 3 | Transport | transport | needs resources > 0; "good" for the target |
| 4 | Deploy (Station) | deploy | own planets only; no outward event, recall gives `-` back time |
| 5 | Hold | hold | allied target; `staytime` 1,2,4,8,12,16,32 h; event status `holding` |
| 6 | Spy | espionage | only probes (210) alone, foreign target |
| 7 | Colonize (`Colonize` [REAL]) | colony | needs 208, empty position, type 1 |
| 8 | Recycle (`Recycle` [REAL]) | harvest | debris type 2, needs 209 or 219 |
| 9 | Destroy | destroy | moon, needs 214 |
| 10 | Missile attack | missile | not via fleetStep (fleetMissile page) |
| 11 | DM expedition | transport | own moon, only 220 |
| 15 | Expedition | transport | position 16; `staytime` 1..astro level, hours = i / halt_speed |
| ? | Asteroids | ? | GALAXYZ-only counter `0 / 5 Asteroids` [REAL], mission id unknown |

Target types: 1 planet, 2 debris field, 3 moon (`#type` options [REAL]). Speeds: `speed` 10..1 = 100 %..10 % [REAL].

### 3.2 Available missions for a target [UPSTREAM class.FleetFunctions.php:408-452]

`planet == max_planets+1` -> [15]; type 2 -> [8] if 209/219 in fleet and debris not empty; empty position -> [7] if 208 and type 1; occupied -> 3, then foreign: 6 (only probes), 1, 5; own: 4; + 2 (ACS), 9 (moon + 214), 11 (own moon + only 220).

### 3.3 fleetAjax (galaxy one-click) [UPSTREAM ShowFleetAjaxPage.class.php:38-219, scripts/game/galaxy.js:1-20]

`GET game.php?page=fleetAjax&ajax=1&mission=6&planetID=<target planet id>` (mission 6 spy: `min(user setting spio_anz, probes on planet)` probes; mission 8 recycle: recyclers 219 then 209 to cover `der_metal+der_crystal`). Always 100 % speed, no resources. Response JSON:

```json
{"slots": 2, "ships": {"210": 101}, "code": 600, "mess": "Send 1 Spy Probe to 2:72:6 ..."}
```

`slots` = used slots (+1 on success), `ships` = remaining on planet; codes: 600 sent, 601 planet missing, 603 noob, 604 strong, 605 vacation, 610 no probes, 611 no probes/recyclers, 612 no slots, 613 no fuel / no cargo for fuel, 618 spy yourself, 619 not allowed, 620 own vacation, 699 module off. Galaxy page shows counters `#probes` `102 Spy Probes`, `#slotValue` `1/13`, two `#recycler` spans (`0 Recycler`, `0 Giga Recycler` - duplicated id) [REAL galaxy.html]. The real galaxy rows had no `doit(` link (no foreign planets in the saved system) [open question 1].

---

## 4. Formulas [UPSTREAM class.FleetFunctions.php, scripts/game/flotten.js:13-48] - verified on REAL numbers

```js
// a, b = [galaxy, system, position]
const distance = (a, b) => a[0] != b[0] ? Math.abs(a[0] - b[0]) * 20000
  : a[1] != b[1] ? Math.abs(a[1] - b[1]) * 95 + 2700
  : a[2] != b[2] ? Math.abs(a[2] - b[2]) * 5 + 1000 : 5;          // no circular galaxies/systems
// speed10 = 10..1, maxspeed = slowest effective ship speed, gamespeed = data.gamespeed (7), factor = data.fleetspeedfactor
const duration = (speed10, d) => Math.max(Math.round((3500 / (speed10 * 0.1) * Math.sqrt(d * 10 / data.maxspeed) + 10) / data.gamespeed) * data.fleetspeedfactor, data.fleetMinDuration);
const consumption = (sec, d) => { let c = 0; for (const s of Object.values(data.ships)) {
  const spd = 35000 / (sec * data.gamespeed - 10) * Math.sqrt(d * 10 / s.speed);
  c += s.consumption * s.amount * d / 35000 * (spd / 10 + 1) ** 2; } return Math.round(c) + 1; };
const cargoFree = data.fleetroom - consumption(sec, d);           // what #storage / #remainingresources show
// fleetStep1.html data ->
// same planet:  {"distance":5,"durationSec":47,"consumption":2,"storage":7498}        page shows 5, 0:00:47 h, 2, 7.498   OK
// [2:68:9]:     {"distance":1020,"durationSec":653,"consumption":118,"storage":7382} step2/3 show 118, 7.382, 1.020, +653 s  OK
// [2:70:5]:     {"distance":2890,"durationSec":1099,"consumption":331,"storage":7169}
// [3:68:5]:     {"distance":20000,"durationSec":2888,"consumption":2287,"storage":5213}
```

Notes:
* Server PHP rounds differently from JS: PHP `GetMissionDuration` does not round (`max(x, 5)`, factor applied before max) and `GetFleetConsumption` rounds the duration inside; on these pages both agree. Arrival = send time + duration, return leg = same duration (653 + 653 [REAL step3]). Hold/expedition add `staytime` hours.
* Effective ship speed [UPSTREAM class.FleetFunctions.php:34-62]: drive 1 combustion `base x (1 + 0.1 x lvl)`, 2 impulse `x (1 + 0.2 x lvl)`, 3 hyperspace `x (1 + 0.3 x lvl)`; small cargo 202 switches to impulse at impulse 5 (base 10000, consumption 20), bomber 211 to hyperspace at hyperspace 8. Upstream base values [UPSTREAM install/install.sql:986-1004] (GALAXYZ ships 213-220 are customised, trust the page): 202 5000/10, 203 7500/50, 204 12500/20, 205 10000/75, 206 15000/300, 207 10000/250, 208 2500/1000 cap 7500, 209 2000/300 cap 20000, 210 1e8/1 cap 5, 211 4000/1000. Verified: 208 = 2500 x 2.4 = 6000, 210 = 1e8 x 2.2 = 2.2e8 [REAL fleetTable tooltips].
* Simplest source of effective speeds without formulas: fleetTable `span.tooltip[data-tooltip-content="Speed:  N"]` (only ships on the current planet) or `data.ships[id].speed` on step 1.
* `fleetspeedfactor` < 1 = faster (flight time bonus).

---

## 5. `page=transport` (GALAXYZ-only) [REAL transport.html]

Left menu entry `a.Filo[href$="page=transport"]` "Transport" on every full page. Without Admiral (officer 602) level 10 it renders an info page:

```js
const box = document.querySelector('#inhalt > .mainRS table.hard-table td img[src*="warning"]')?.closest('td');
({ infoPage: !document.querySelector('#rechts'), header: document.querySelector('#inhalt > .headerRS')?.textContent.trim(),
   error: box ? box.querySelector('p').textContent.trim() : null, back: box?.querySelector('a')?.getAttribute('href') })
// transport.html -> {"infoPage":true,"header":"Info","error":"You need Admiral officier at level 10!!","back":"https://ogamex.eu/Aeternum/game.php?page=overview"}
// officier.html a[data-technology="602"] -> {"title":"Admiral","level":"0/20"}
```

The page itself (probably a mass resource transport between own planets) was never seen [open question 4]. Also: transport.html has no event box and no planet list.

---

## 6. Event box (fleet events) - what the classes mean

Full markup and the de-duplicating recipe: layout.md section 7. Summary for fleet code:

* `span.fleets#fleettime_<endUnix><fleetId>[data-fleet-end-time][data-fleet-time]` + `span.fleet_static_time` + `span > span.<status> <own?><style>`.
* status [UPSTREAM class.FlyingFleetsTable.php:175]: `flight` = outward (time = arrival at target), `return` = coming home (time = arrival home), `holding` = end of a Hold/expedition stay.
* `own` prefix = the player's fleet. Without prefix = someone else's fleet targeting the player [UPSTREAM :60-68, :170-171]: hostile when style is `attack`, `federation`, `espionage`, `destroy`, `missile`; friendly (`cff_mission_target_good`) when mission 3 transport or 5 hold. Foreign recycles (8) are never shown. Foreign fleets appear only while outward; hostile text contains `<owner name> <a onclick="return Dialog.PM(<ownerId>)">`. Not seen live.
* Deploy (4) outward and missiles (10) of own fleets are skipped in the box [UPSTREAM :97]; deploy return is shown.
* `.textForBlind`: 1st = ships `(8290 Recycler)` (own fleets; foreign: needs espionage tech >= 4, < 8 shows only a total), 2nd (if cargo) = `(Ressources: 7382 Metal; 0 Crystal; 0 Deuterium)` (+ `; N Dark Matter`) with **ungrouped** numbers; tooltip tables use grouped numbers.

RUN recipe (extends layout.md's with status/own/style split and fleet id):

```js
const seen = new Set();
[...document.querySelectorAll('#messages_collapsed .OvfleetEvents_ > span.fleets[id^="fleettime_"]')].filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => {
  const line = s.parentElement.querySelector('span.flight, span.return, span.holding');
  const [, status, style] = line.className.match(/^(flight|return|holding)\s+(\S+)/);
  const k = s.id.slice('fleettime_'.length), end = s.dataset.fleetEndTime;
  return { fleetId: +k.slice(end.length), end: +end, rest: +s.dataset.fleetTime, status, own: style.startsWith('own'), style: style.replace(/^own/, ''),
    coords: [...line.querySelectorAll('a[href*="page=galaxy"]')].map(a => a.textContent),
    blind: [...line.querySelectorAll('.textForBlind')].map(b => b.textContent.trim()) };
})
// fleetStep3.html -> (4 events; overview.html has the 2 recycler ones)
// {"fleetId":396901,"end":1793348401,"rest":653,"status":"flight","own":true,"style":"colony","coords":["[2:68:5]","[2:68:9]"],"blind":["(1 Colony Ship)","(Ressources: 7382 Metal; 0 Crystal; 0 Deuterium)"]}
// {"fleetId":396900,"end":1793348429,"rest":681,"status":"flight","own":true,"style":"harvest","coords":["[2:68:5]","[2:87:8]"],"blind":["(8290 Recycler)"]}
// {"fleetId":396901,"end":1793349055,"rest":1307,"status":"return","own":true,"style":"colony","coords":["[2:68:9]","[2:68:5]"],...}
// {"fleetId":396900,"end":1793350031,"rest":2283,"status":"return","own":true,"style":"harvest","coords":["[2:87:8]","[2:68:5]"],...}
```

Survey over all 20 real pages (`eventSurvey`): classes seen = `flight ownharvest`, `return ownharvest`, `flight owncolony`, `return owncolony` only; transport.html has no box; the only `.fleets` outside the box is fleetTable's `td#fleettime_1`.
Pitfalls: the fleet id is the key minus the end time prefix (both digits, no separator) - slice by the length of `data-fleet-end-time`. A colony fleet "returns" with its cargo when the target was taken (here it carried 7382 metal, i.e. all free cargo).

---

## 7. Duplicated ids, encoding, numbers (fleet pages)

`ids` snippet (RUN): fleetTable/fleetStep1/fleetStep2: `OvfleetContent` x2, `OvfleetEvents` x3, first `fleettime_<key>` x2, `myWorlds` x2, `planetList` x4; fleetStep3: `OvfleetContent` x4, `OvfleetEvents` x5 (no planet list). Galaxy: `#recycler` x2. Fleet-specific ids that ARE unique: `#ship<ID>_value`, `#ship<ID>_input`, `#galaxy #system #planet #type #speed #distance #duration #arrival #return #consumption #maxspeed #storage` (step 1), `#remainingresources #consumption #fleetPoints` (step 2). Careful: `#galaxy` etc. are form inputs on step 1 only.

* UTF-8; planet names may be Cyrillic (`Details: Главная планета`, event text `Planet Главная планета`).
* Grouped numbers with `.`: `8.290`, `1.020`, `6.000`, `7.382`. Raw (ungrouped) in `.textForBlind`, tooltip of fleetTable "Number" cell, `data={...}` (strings), hidden inputs.
* Coords: `[g:s:p]` in links, `g:s:p` without brackets on step 3, `Send fleet g:s:p - Planet` in step-2 `h2`.
* Times: `D. Mon YYYY, HH:MM:SS` (fleetTable, step 3), `HH:MM:SS` (event box), countdown `HH:MM:SS` / `-` at 0, step-1 JS `Oct Fri 30 10:08:48` (`tdformat "[M] [D] [d] [H]:[i]:[s]"`).
* Absolute action URLs (`https://ogamex.eu/Aeternum/game.php?page=...`), but the step-3 meta refresh is relative.

## 8. Differences to upstream 2Moons (what GALAXYZ changed)

| item | upstream | GALAXYZ [REAL] |
|---|---|---|
| fleetTable header | slots + expeditions | + `0 / 5 Asteroids` |
| fleetTable table | `table style=width:760px`, header row of `td` | `table.list.listOfOthers` inside `.mainRS.fleetTablemain`, header `th.textCenter`, recall button classes |
| bonus table | separate | inside the step-1 form, icons `attack/defence/shield/combustion/impulse/hiperspace.png` |
| step 1 `target_mission` | `{$mission}` | `0` seen (open question 3) |
| step 2 | mission + resources + staytime | + `#fleetPoints` "Fleet points: 150" |
| messages | `table.table519 th Info` | `.headerRS "Info"` + `img[src*=warning]` + `p` + Back button |
| menu | - | `page=transport` (Admiral 10), `page=fleetDealer` |
| ids 213-220 | upstream ships | customised (stats differ; use page values) |

## 9. Open questions

1. Real galaxy row markup for foreign planets: is one-click spy still `doit(6, planetId)` -> `fleetAjax`, and what does the JSON look like on GALAXYZ? Needs a saved galaxy page with a foreign planet + a captured fleetAjax response.
2. Asteroids: which mission id / target type, where are asteroids listed, what does the event class look like?
3. Does GALAXYZ propagate `target_mission` from fleetTable (`&target_mission=1` from a spy report) into step 1/2 (pre-checked radio)? Save step 1/2 after clicking a report's Attack link.
4. `page=transport` with Admiral 10: form fields and endpoint unknown.
5. Real step-2/step-3 error pages (no slots, not enough deuterium, invalid mission) and the `fleetTable&code=N` redirect text - not saved.
6. `Fleet points` on step 2: meaning (tournament score? see tournament.html) unknown.
7. Hostile/foreign event markup and the `holding` status were never seen live.
8. Hold / expedition `staytime` select on GALAXYZ (values, name) - not seen; upstream `name="staytime"`.
