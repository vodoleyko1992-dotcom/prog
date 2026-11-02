# GALAXYZ (ogamex.eu) messages and reports: page, AJAX views, spy / combat / fleet reports

Target: `https://ogamex.eu/Aeternum/game.php?page=messages`, engine `GALAXYZ 1.8.git` (2Moons fork). Replaces `specs/messages.md`
(lanedirt OgameX, `/messages` + `/ajax/messages/{id}`) for GALAXYZ. Nothing of the OgameX messages DOM exists here.

Tags: **[REAL x.html]** = seen in `eu/pages/x.html` (saved 2026-10-30, account vodoleyko1992, UTC+2).
**[UPSTREAM file:line]** = 2Moons source in `src/2Moons/` (paths below are relative to it), not seen live. **[GUESS]** = neither.

Real material: only `messages-spy.html` (Chrome DOM snapshot of `page=messages` **after a click on "Spy messages"**, i.e.
after the AJAX view of category 0, see 2.1) and `messages-all.html` (the same page after a further click on "All messages",
i.e. after the AJAX view of category 100). Both contain the **same two spy reports** and nothing else.
Combat, expedition, transport, recycle, return, missile, colonisation and player messages, the `page=raport` popup and the
AJAX fragment itself are **[UPSTREAM]** only.

## 0. Files and how to run

**Canonical recipe file: `messages-recipes.js` (`window.GZMessages`).** Port THAT one into core `19-messages.js`. The
earlier parallel spec `messages-gzmessages.md` is merged into this document (it stays only as a record); its parser
`GZMessages` and this document's original parser `GZMessagesB` (`messages-recipes-b.js`) were written independently and
agree on every [REAL] fact, so `GZMessagesB` is kept only as a cross-check. The `G_*` snippets below still show
`GZMessagesB` output; the `GZMessages` equivalents and their REAL-page output are in 0.1.

| file (in `specs/galaxyz/`) | what |
|---|---|
| `messages-recipes.js` | **canonical** `window.GZMessages`: `parseCategories, parseHeaderUnread, parseList, classify, parseItem, parseSpyReport, parseSpyDetected, parseCombatMessage, parseCombatReport, parseBattleHall, parseExpedition, parseFleetText, parseTdDate, idOf, urls.{page,view,actionBody,raport}, api.{categories,list,action,delete,markRead,raport,battleHall}`. No deps; `document`, a `DOMParser` doc or the AJAX fragment. |
| `tools/messages/check_messages.js [--write]` | runs `GZMessages` on every `fixtures/messages-*.html` (2 REAL + UPSTREAM), live DOM and `DOMParser` must agree, **32 hard expectations** (12 on the REAL pages); `--write` refreshes `fixtures/messages-expected-parse.json`. Last run: `OK 20 pages, 32 expectations`. |
| `messages-recipes-b.js` | `window.GZMessagesB` (cross-check only): `categories, headerUnread, list, classify, spyReport, combatShort, combatFull, fleetText, urls, parseTdDate`. |
| `tools/run_messages_snippets.js` | runs every `R_*` / `G_*` snippet of this document (Chromium, JS disabled). `R_*` = plain DOM, `G_*` = need `messages-recipes-b.js`. |
| `tools/check_messages_gz.js [--write]` | `GZMessagesB` on the same fixtures vs `fixtures/messages-gz-expected-parse.json` (20/20 ok). |
| `tools/gen_messages_fixtures.py`, `tools/messages/gen_messages_fixtures.php` | fixture generators: `messages-real-{spy,all}.html` are byte copies of `eu/pages/`; `messages-upstream-*` / `messages-live-synthetic-*` are rendered from the 2Moons Smarty templates with bodies from the `MissionCase*` code; `messages-texts.json` = en/ru expedition and fleet texts. |

```
cd specs/galaxyz
NODE_PATH=$(npm root -g) node tools/messages/check_messages.js                     # canonical parser, all fixtures
NODE_PATH=$(npm root -g) node tools/run_messages_snippets.js                       # both REAL pages, all snippets
NODE_PATH=$(npm root -g) node tools/check_messages_gz.js                           # cross-check parser
```

API differences when reading the `G_*` outputs below (B -> canonical): `list` -> `parseList` (`messcat` -> `cat`);
`spyReport` -> `parseSpyReport` (`resources.metal..energy` -> `resources[901..911]` **from the Simulate floats, floored**;
`ships` -> `fleet`; `known` -> `revealed`; `target.coords` array -> `coords {galaxy,system,planet}` + `coordsStr`;
`probesDestroyed` -> `destroyed`; `counterEspionage` -> `discoveryChance`; `attackParams` -> `planetType` only);
`headerUnread` -> `parseHeaderUnread`; `urls.actionBody(action, cat, ids)` -> `urls.actionBody(action, ids, cat, side)`
(returns `URLSearchParams`). Core keeps coordinates as arrays: convert `coords` at the core boundary.

### 0.1 Validation of `GZMessages` on the REAL pages

```js
// G2_real  (scratch runner: load messages-recipes.js into the saved page, then)
const l = GZMessages.parseList(document);
({ categories: GZMessages.parseCategories(document).map(c => c.cat + ':' + c.unread + '/' + c.total).join(' '),
   headerUnread: GZMessages.parseHeaderUnread(document), list: { cat: l.cat, page: l.page, pages: l.pages },
   items: l.items.map(it => GZMessages.parseItem(it, l.cat)) })
```
```
== messages-real-spy.html
{"categories":"0:0/2 1:0/0 2:0/0 3:0/0 4:0/0 5:0/0 15:0/0 50:0/0 99:0/0 100:0/2 999:0/0","headerUnread":2,"list":{"cat":0,"page":1,"pages":1},
 "items":[{"id":520244,"kind":"spy_report","unread":true,"date":"30. Oct 2026, 09:53:36","wall":1793354016000,"from":"Spying department","subject":"Intelligence report",
   "data":{"title":"Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44","targetName":"2 bolygó","coords":{"galaxy":2,"system":81,"planet":10},"coordsStr":"2:81:10",
     "planetType":1,"reportDateText":"30. Oct 2026, 08:53:44","reportWall":1793350424000,"destroyed":false,"discoveryChance":0,
     "revealed":{"resources":true,"fleet":true,"defense":false,"buildings":false,"research":false},
     "resources":{"901":2684939750000,"902":1700557697522,"903":675144412230,"911":356568},
     "fleet":{"202":0,"203":0,"204":0,"205":0,"206":0,"207":0,"208":0,"209":0,"210":0,"211":0,"212":0,"213":0,"214":0,"215":0,"216":0,"217":0,"218":0,"219":0,"220":0},
     "defense":null,"buildings":null,"research":null,"exact":true,"unknownNames":[]}},
  {"id":520242,"kind":"spy_report","unread":true,"date":"30. Oct 2026, 09:53:20","wall":1793354000000,"from":"Spying department","subject":"Intelligence report",
   "data":{"title":"Spy Report Colony [2:72:6] on 30. Oct 2026, 09:53:28","targetName":"Colony","coords":{"galaxy":2,"system":72,"planet":6},"coordsStr":"2:72:6",
     "planetType":1,"reportDateText":"30. Oct 2026, 09:53:28","reportWall":1793354008000,"destroyed":false,"discoveryChance":0,
     "revealed":{"resources":true,"fleet":false,"defense":false,"buildings":false,"research":false},
     "resources":{"901":11483000000,"902":11483000000,"903":6263925000,"911":3391},"fleet":null,"defense":null,"buildings":null,"research":null,"exact":true,"unknownNames":[]}}]}
== messages-real-all.html
 same categories / headerUnread 2, "list":{"cat":100,"page":1,"pages":1}, same two items with "unread":false (the cat-0 view had marked them read)
```
Form / action checks (`check_messages.js`, REAL):
```
messages-real-spy.html forms ["0+table"]            messages-real-all.html forms ["100+table","0"]   (2nd = empty shell, 2.1)
real form fields  mode=action, ajax=1, messcat=0, side=1, select actionTop, select actionBottom, submitTop=Confirm, submitBottom=Confirm
GZMessages.urls.actionBody('deletemarked', [520244, 520242], 0).toString()
  -> "mode=action&ajax=1&messcat=0&side=1&actionTop=deletemarked&submitTop=Confirm&messageID%5B520244%5D=1&messageID%5B520242%5D=1"
GZMessages.urls.view(0, 1) -> "game.php?page=messages&mode=view&messcat=0&site=1&ajax=1"
#loading style attribute: "display: none;"  (jQuery-written; the template has "display:none;")
```

**Corrections made after the REAL pages (earlier guesses that the real pages contradict):**

| earlier statement | real evidence | now |
|---|---|---|
| "GALAXYZ renders category 0 inline on the full page (server-rendered list)" (this doc, 1-3, 11) | Both saves are DOM snapshots taken after `Message.getMessages()` ran. Decisive: `#unread_100 = 0` although both rows of the cat-0 list are still `.mes_unread` (the server count would be 2); `#unread_0 = 0`, `#unread_100 = 0` is exactly what upstream `Message.MessageCount(0)` writes (`unread_0 = max(0, unread_100-10)`, `unread_100 -= count`). Supporting: `#loading` carries the jQuery-written `style="display: none;"` (with space, unlike the untouched template styles), and the form sits exactly where `$('#content table:eq(0)').after(data)` puts it. | Upstream behaviour holds: `GET page=messages` shows **no list** (and marks nothing read) unless `&category=N` (N != 0) auto-loads one. The list always comes from `mode=view`. `watch()` only needs to observe the `#messagestable` swap. |
| "`#unread_N` is useless as a 'new' signal" | the zeros are the client-side `MessageCount` rewrite after a click, not server values | `#unread_N` on a **fresh** page load (or a background `GET page=messages`) are server counts and usable; after any category click they are rewritten. The topnav badge is the server value and is not updated by the click. |
| `messages-gzmessages.md` / old `GZMessages.api.action`: `submitTop=1`, no `side` | real form: `submitTop=Confirm`, hidden `side=1` | `urls.actionBody` sends exactly the real fields (upstream only checks `isset(submitTop)`, so `1` also worked). |
| `GZMessagesB` spy `resources` (display, rounded: deuterium `675144412230`) vs `GZMessages` (Simulate float, rounded: `675144412230`) | both values are on the page (cell `675.144.412.230`, link `im[903]=675144412229.63`) | canonical = Simulate value rounded (Math.round = the shown cell, pretty_number %.0f); display value only when the link is missing (`exact:false`). |

## 1. URLs and parameters

| what | method + URL | params / body | response | tag |
|---|---|---|---|---|
| full page | GET `game.php?page=messages` | optional `category=N&side=P` (upstream `show()` then calls `Message.getMessages(N,P)` on load; `!empty(0)` is false, so category 0 never auto-loads) | full layout: category grid + "Game operators", **no list** until a click (~~"GALAXYZ renders category 0 inline"~~, corrected in 0.1) | [REAL layout messages-spy.html] / [UPSTREAM ShowMessagesPage.class.php:366-431, page.messages.default.tpl:28-32] |
| list of one category | GET `game.php?page=messages&mode=view&messcat=N&site=P&ajax=1` | N in {0,1,2,3,4,5,15,50,99,100,999}; P 1-based, clamped to 1..maxPage; **10 per page** (`MESSAGES_PER_PAGE`, includes/constants.php:91) | HTML **fragment** = `<form ...><table id="messagestable">...</table></form>` (no `<html>`) | [UPSTREAM ShowMessagesPage.class.php:27-146, scripts/game/message.js:31-45]; the result is visible in [REAL messages-all.html] |
| mark read / delete | POST `game.php?page=messages` | `mode=action&ajax=1&messcat=N&side=P&actionTop=<a>&submitTop=Confirm` (or `actionBottom`/`submitBottom`) + `messageID[<id>]=1` per checked row | 302 to `game.php?page=messages&category=N&side=...` | [REAL form] [UPSTREAM ShowMessagesPage.class.php:149-302] |
| write PM (popup) | GET `game.php?page=messages&mode=write&id=<userId>&subject=..&message=..` | GALAXYZ `Dialog.PM` adds `&message=` | popup form | [REAL eu/overview/..._files/base.js:161-166] |
| send PM | POST `game.php?page=messages&mode=send&id=<userId>&ajax=1` | `to, subject, text` (needs the session token set by `mode=write`) | JSON string | [UPSTREAM page.messages.write.tpl:27, ShowMessagesPage.class.php:304-325] |
| combat report | GET `game.php?page=raport&raport=<32 hex>` (popup, `body.popup`) | expedition battles link `CombatReport.php?raport=<id>` which redirects there | HTML (shared.mission.raport.tpl) | [UPSTREAM ShowRaportPage.class.php:51-93, CombatReport.php] |
| simulator prefill | GET `game.php?page=battleSimulator&im[ID]=N&...` | from the spy report footer | page | [REAL messages-spy.html] |
| attack prefill | GET `game.php?page=fleetTable&galaxy=G&system=S&planet=P&planettype=T&target_mission=1` | from the spy report footer | fleetTable | [REAL] |

`action` aliases [UPSTREAM ShowMessagesPage.class.php:176-183]: `deleteunmarked` with no ids -> `deletetypeall`; `deletetypeall`
or `readtypeall` with messcat 100 -> `deleteall` / `readall`. **`deleteall` and `deletetypeall` need no ids: never build them
from code without an explicit user click.** Delete is soft or hard depending on server config `message_delete_behavior`.

**Side effect:** `mode=view` marks every listed message as read (`UPDATE ... message_unread = 0`, ShowMessagesPage.class.php:130-135),
except in the outbox. A background fetch therefore clears the user's unread state. Confirmed live: in `messages-all.html`
(after the AJAX view) the same two rows no longer have `mes_unread`.

Live JS: the page loads `message.js` (`<script src="./31_files/message.js">`, [REAL]) but the file was **not saved**; the
upstream one (`scripts/game/message.js`) is the reference: `Message.getMessages(MessID, page)` = `$.get(view URL)`, then
`$('#messagestable').remove(); $('#content table:eq(0)').after(data)`. `base.js`, `overview.js`, `topnav.js`, `fleetTable.js`
[REAL eu/overview] contain no other message URL than `Dialog.PM` above.

## 2. Full page structure [REAL messages-spy.html = DOM after a click on "Spy messages"]

```
<title>Messages - Aeternum (New) - Aeterum (New)</title>   body#messages.full   var queryString = "page=messages"
#inhalt
  #messages_collapsed.messpositionDiv  (fleet event box, see layout.md; #OvfleetEvents x4, #OvfleetContent x4 here)
  div#planet > h2 "News of administration" > span#loading (display:none)          <- upstream has #loading in a <th>
  .mainRS > #content
     table.hard-table (category grid, 2 rows of 6 cells, see 3)
     form[action$="page=messages"][method=post]                                  <- the mode=view fragment for messcat 0, inserted by getMessages(0)
        input[name=mode]=action  [name=ajax]=1  [name=messcat]=0  [name=side]=1
        div.mainRS > table#messagestable.hard-table
     table.hard-table  "Game operators" (Admin mailto)
```

**Pitfall: two forms after a category click.** `getMessages` removes only `#messagestable` and inserts the new fragment
after the first table, so the old form stays as an empty shell **below** the new one [REAL messages-all.html]:

```js
// R_forms
[...document.querySelectorAll('form[action*="page=messages"]')].map(f => ({
  messcat: f.querySelector('[name=messcat]').value, side: f.querySelector('[name=side]').value,
  hasTable: !!f.querySelector('#messagestable'), rows: f.querySelectorAll('tr.message_head').length }))
```
```
messages-spy.html  [{"messcat":"0","side":"1","hasTable":true,"rows":2}]
messages-all.html  [{"messcat":"100","side":"1","hasTable":true,"rows":2},{"messcat":"0","side":"1","hasTable":false,"rows":0}]
```
Always start from `table#messagestable` (unique) and take `closest('form')`; never `document.querySelector('[name=messcat]')`
without that scope (it is right only by luck of order). Ids `#unread_N`, `#total_N`, `#messagestable`, `#message_<id>` are unique.

Encoding UTF-8; planet names can be non-ASCII (`2 bolygó`, `Главная планета`). Texts follow the user language (`var Lang = "en"`).

## 3. Category grid [REAL]

Selector: `span[id^="total_"]` -> cell `td` (style `color:#RRGGBB`), link `a[onclick="Message.getMessages(N);return false;"]`,
counters `span#unread_N` / `span#total_N` (text `0/2`). Ids and colours are the upstream table [UPSTREAM ShowMessagesPage.class.php:375-383].

| id | name (en) | colour | sender of what (upstream) |
|---|---|---|---|
| 0 | Spy messages | #FFFF00 | own spy reports AND "Spying activity" (someone spied me) |
| 1 | Player messages | #FF6699 | PMs (have a reply icon) |
| 2 | Alliance messages | #FF3300 | circular mails |
| 3 | Combat messages | #FF9900 | fight reports (attack, ACS, moon destruction, expedition battle), missile impact |
| 4 | System messages | #773399 | every "Fleet return", colonisation report |
| 5 | Transport messages | #009933 | transport arrival (own and foreign), recycling report, "Located fleet" (deploy) |
| 15 | Expedition messages | #6495ed | expedition result (`fleet_end_stay`) |
| 50 | Game messages | #666600 | admin / game |
| 99 | Construction messages | #007070 | queue failures ("Impossible to build") |
| 100 | All messages | #ABABAB | virtual: everything except outbox |
| 999 | Outbox | #CCCCCC | sent PMs (no checkboxes, no actions, "To" column) |

```js
// R_categories
[...document.querySelectorAll('span[id^="total_"]')].map(t => {
  const id = +t.id.slice(6), td = t.closest('td'), a = td.querySelector('a[onclick*="getMessages"]');
  return id + ' ' + a.textContent.trim() + ' unread=' + document.getElementById('unread_' + id).textContent + ' total=' + t.textContent + ' ' + td.style.color;
})
```
```
["0 Spy messages unread=0 total=2 rgb(255, 255, 0)","1 Player messages unread=0 total=0 rgb(255, 102, 153)", ...,
 "15 Expedition messages unread=0 total=0 rgb(100, 149, 237)","50 Game messages ...","99 Construction messages ...",
 "100 All messages unread=0 total=2 rgb(171, 171, 171)","999 Outbox unread=0 total=0 rgb(204, 204, 204)"]
```
`unread_0 = 0` on the page whose 2 rows are `.mes_unread`: ~~GALAXYZ renders the list before counting~~ [corrected, 0.1]
it is upstream `Message.MessageCount` (message.js:4-28), which rewrites the counters client side on every click
(`unread_<cat> = max(0, unread_100 - 10)`, `unread_100 -= count`; cat 100 zeroes all). So `#unread_N` is a server count
only on a fresh load (or a background `GET page=messages`); after a click use `tr.mes_unread` and the topnav badge.

Topnav badge (every page) [REAL all 20 pages]: `.messages-section a.messages-button > span.new-msg-count` text `2`
(missing span = 0 [UPSTREAM AbstractGamePage.class.php:144 `new_message` = `$USER['messages']`]).
```js
// R_headerUnread
+document.querySelector('.messages-section .new-msg-count')?.textContent.trim() || 0      // -> 2 (both pages)
```

## 4. Message list rows [REAL + UPSTREAM page.messages.view.tpl:34-107]

```
table#messagestable
  tr > th[colspan=4] "Messages"
  tr > td > select[name=actionTop] (7 options, see 5) + input[type=submit][name=submitTop][value=Confirm]     (not in 999)
  tr > td.right "Page: " a[onclick="Message.getMessages(CAT, P);return false;"] ... current one wraps <b>[P]</b>
  tr > td Action | td Date | td From (999: To) | td Subject
  per message:
  tr#message_<id>.message_head[.mes_unread]
     td[rowspan=2] > input[type=checkbox][name="messageID[<id>]"][value=1]          (999: empty td)
     td  date  "30. Oct 2026, 09:53:36"
     td  from  "Spying department"
     td  subject "Intelligence report" [+ for type 1: a[onclick="return Dialog.PM(<senderId>, Message.CreateAnswer('<subject>'))"] > img]
  tr.messages_body > td[colspan=3].left > BODY (raw HTML stored at send time)
  tr > td.right pager again (here « » jump to page 1 / last)
  tr > select[name=actionBottom] + submitBottom
```

```js
// R_rows
[...document.querySelectorAll('#messagestable tr.message_head')].map(tr => {
  const td = tr.children, body = tr.nextElementSibling;
  return { id: +tr.id.replace('message_', ''), unread: tr.classList.contains('mes_unread'),
    date: td[1].textContent.trim(), from: td[2].textContent.trim(), subject: td[3].textContent.trim(),
    bodyKind: body.querySelector('.spyRaport') ? 'spy' : body.querySelector('.raportMessage') ? 'combat' : 'text' };
})
```
```
messages-spy.html [{"id":520244,"unread":true,"date":"30. Oct 2026, 09:53:36","from":"Spying department","subject":"Intelligence report","bodyKind":"spy"},
                   {"id":520242,"unread":true,"date":"30. Oct 2026, 09:53:20","from":"Spying department","subject":"Intelligence report","bodyKind":"spy"}]
messages-all.html  same ids, "unread":false
```
```js
// R_pager
[...document.querySelectorAll('#messagestable td.right a[onclick*="getMessages"]')].map(a =>
  a.getAttribute('onclick').match(/getMessages\((\d+),\s*(\d+)\)/).slice(1).join(',') + (a.querySelector('b') ? ' current' : ''))
```
```
messages-spy.html ["0,1 current","0,1 current"]        messages-all.html ["100,1 current","100,1 current"]
fixtures/messages-upstream-view-100-p2.html ["100,1","100,1","100,2 current","100,3","100,3","100,1","100,1","100,2 current","100,3","100,3"]
```
Pages = max number in the pager; current = the `<b>` one (also `input[name=side]`).

Dates: `_date('d. M Y, H:i:s', ts, USER timezone)` [UPSTREAM language/en/L18N.php:27]; month names from `var months = [...]`
in the page head (`["Jan",...,"Dec"]` [REAL]). Read them as wall clock in the user zone (same convention as layout.md
`serverTime`): `Date.UTC(y, m, d, h, i, s)`; subtract the user offset (UTC+2 here) for a real epoch. Message time is the
**arrival** time for arrival messages (`fleet_start_time`), the **return** time for "Fleet return" (`fleet_end_time`), the end
of the hold for expedition results (`fleet_end_stay`) [UPSTREAM MissionCase*.class.php sendMessage calls].

Recipe (wraps the above; `key` from `classify`, body element kept as `item.body`):
```js
// G_list
GZMessagesB.list(document)   // -> { messcat, page, pages, outbox, actions:[...], items:[{ id, unread, checkbox, date, wall, from, subject, senderId, messcat, body }] }
```
```
messages-spy.html {"messcat":0,"page":1,"pages":1,"outbox":false,"actions":["readmarked","readtypeall","readall","deletemarked","deleteunmarked","deletetypeall","deleteall"],
 "items":[{"id":520244,"unread":true,"checkbox":true,"date":"30. Oct 2026, 09:53:36","wall":1793354016000,"from":"Spying department","subject":"Intelligence report","senderId":null,"messcat":0,"key":"spy_report"},
          {"id":520242,"unread":true,"checkbox":true,"date":"30. Oct 2026, 09:53:20","wall":1793354000000,...,"key":"spy_report"}]}
```
For the AJAX fragment: `GZMessagesB.list(new DOMParser().parseFromString(html, 'text/html'))`.

## 5. Actions form [REAL]

`select[name=actionTop]` options (value = label) [REAL]: `readmarked` Mark selected messages as read, `readtypeall` Mark all
messages of this type as read, `readall` Mark all messages as read, `deletemarked` Delete marked messages, `deleteunmarked`
Delete all messages not marked, `deletetypeall` Delete all messages of this type, `deleteall` Delete all messages.

```js
// G_urls  (builders only; POST must follow an explicit user click)
GZMessagesB.urls.actionBody('deletemarked', 0, [520244, 520242])
// -> "mode=action&ajax=1&messcat=0&side=1&actionTop=deletemarked&submitTop=Confirm&messageID%5B520244%5D=1&messageID%5B520242%5D=1"
GZMessagesB.urls.view(0, 1)  // -> "game.php?page=messages&mode=view&messcat=0&site=1&ajax=1"
```
`submitTop` (or `submitBottom`) MUST be present or the server ignores the action and just redirects
[UPSTREAM ShowMessagesPage.class.php:163-174]. No CSRF token in the form [REAL]. Ids must be numeric
(`array_filter(..., 'is_numeric')` on the VALUE `1`; the id is the KEY).

## 6. Spy report [REAL messages-spy.html, UPSTREAM shared.mission.spyReport.tpl + MissionCaseSpy.class.php]

Row: category 0, from `Spying department` (`sys_mess_qg`), subject `Intelligence report` (`sys_mess_spy_report`), time = probe
arrival. Body (stored with Smarty `trimwhitespace`: one line, single spaces):

```
div.spyRaport
  div.spyRaportHead > a[href="game.php?page=galaxy&galaxy=2&system=81"]  "Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44"
  div.spyRaportContainer                                   one per REVEALED class, order 900, 200, 400, 0, 100
     div.spyRaportContainerHead.spyRaportContainerHeadClass900  "Ressources"  (200 Ships, 400 Planetary Defense, 0 Buildings, 100 Research)
     div.spyRaportContainerRow.clearfix > (div.spyRaportContainerCell NAME, div.spyRaportContainerCell VALUE) x2
  div.spyRaportFooter
     a[href*="page=fleetTable&galaxy=2&system=81&planet=10&planettype=1&target_mission=1"] "Attack"
     <br> "The spy probes discovery chance was:  0 % "   |  <font color="red">Your spy probes were destroyed! </font>
     <br> a[href*="page=battleSimulator&im[901]=2684939750000&im[902]=1700557697522.1&..."] "Simulate"
```

| datum | where | sample [REAL] | note |
|---|---|---|---|
| target name, coords | head link text `^(.*)\[g:s:p\]\s*on DATE` | `2 bolygó`, `[2:81:10]` | prefix `Spy Report ` and word `on` are `sys_mess_head` (localized) |
| target type | footer Attack link `planettype` | `1` (3 = moon) | name of a moon report has no "(Moon)" suffix upstream |
| report time | after the coords | `30. Oct 2026, 08:53:44` | = **return** time of the probes, formatted in the **target's** timezone (MissionCaseSpy.class.php:151) |
| resources | container 900: Metal, Crystal, Deuterium, Energy | `2.684.939.750.000`, `1.700.557.697.522`, `675.144.412.230`, `356.568` | display is **rounded** (`number_format`) |
| exact resources | Simulate link `im[901..903,911]` | `902=1700557697522.1`, `903=675144412229.63` | floats with `.` decimal |
| ships 202-220 | container 200, 19 entries incl. 0 | `Light Cargo 0 ... Dark Matter Collector 0` | ids from Simulate link order |
| defense 401-411, 502, 503 | container 400 (13 entries) | [UPSTREAM] | |
| buildings | container 0 (22 entries) | [UPSTREAM] | levels |
| research | container 100 (19 entries) | [UPSTREAM] | levels |
| counter-espionage | footer `(\d+) %` | `0` | absent when probes were destroyed |

**Pitfalls (all seen or derived from the REAL markup):**

1. **Broken nesting.** The template closes a row only after an even cell pair (spyReport.tpl:116-119). An odd element count
   (19 ships, 13 defence, 19 research) leaves the last row open, and its `</div>` closes the row instead of the container, so
   the next container and/or the footer are parsed **inside** the previous container. Seen live: the footer of report 1 is a
   child of the ships container. In a full report, ships contain defence, which contains buildings ... `c.querySelectorAll(cells)`
   then returns the cells of all later sections. Take only cells whose `closest('.spyRaportContainer') === c`.
   ```js
   // R_spyNesting
   [...document.querySelectorAll('.spyRaport')].map(sr => ({
     footerParent: sr.querySelector('.spyRaportFooter').parentElement.className,
     containers: [...sr.querySelectorAll('.spyRaportContainer')].map(c => c.querySelector('.spyRaportContainerHead').textContent +
       ': all=' + c.querySelectorAll('.spyRaportContainerCell').length +
       ' own=' + [...c.querySelectorAll('.spyRaportContainerCell')].filter(x => x.closest('.spyRaportContainer') === c).length) }))
   ```
   ```
   messages-spy.html [{"footerParent":"spyRaportContainer","containers":["Ressources: all=8 own=8","Ships: all=38 own=38"]},
                      {"footerParent":"spyRaport","containers":["Ressources: all=8 own=8"]}]
   fixtures/messages-upstream-view-100-p2.html (all 5 sections)
     {"footerParent":"spyRaportContainer","containers":["Ressources: all=8 own=8","Ships: all=146 own=38","Planetary Defense: all=108 own=26","Buildings: all=44 own=44","Research: all=38 own=38"]}
   ```
2. **Ids come from the Simulate link.** Cells carry no ids, only names (localized, GALAXYZ-renamed 213-220). The Simulate href
   lists `im[ID]=amount` in exactly the cell order (same nested `foreach`, spyReport.tpl:126). Pair them by position and check
   the count. If the link is missing (`ENABLE_SIMULATOR_LINK` / module off), fall back to a name->id map (`elements.json`).
   ```js
   // R_simulate
   [...document.querySelectorAll('.spyRaportFooter a[href*="battleSimulator"]')].map(a =>
     [...new URL(a.getAttribute('href'), location.href).searchParams].filter(([k]) => /^im\[\d+\]$/.test(k)).map(([k, v]) => k.slice(3, -1) + '=' + v).join(' '))
   ```
   ```
   ["901=2684939750000 902=1700557697522.1 903=675144412229.63 911=356568 202=0 203=0 204=0 205=0 206=0 207=0 208=0 209=0 210=0 211=0 212=0 213=0 214=0 215=0 216=0 217=0 218=0 219=0 220=0",
    "901=11483000000 902=11483000000 903=6263925000 911=3391"]
   ```
   The href has raw `[` `]` (not `%5B`); `URLSearchParams` decodes either way.
3. **Missing section = not revealed** (unlike OgameX where empty and hidden look the same). Report 2 [REAL] has only
   Ressources. Thresholds are monotone: ships `n >= Min`, defence `>= Min+1`, buildings `>= Min+3`, research `>= Min+5`, with
   `Min = ±(spyTechDiff)^2` (MissionCaseSpy.class.php:75-85, constants.php:118-134). So "defence shown, ships absent" cannot happen.
4. **Zeros may be filtered.** If the user option `spyMessagesMode == 1`, zero entries are dropped (`array_filter`,
   MissionCaseSpy.class.php:128-131): a revealed section can be **empty** (heading only) and resource keys can be missing
   (seen in the parallel fixture `messages-upstream-view-cat0.html`: `Planetary Defense: all=0 own=0`). The live account
   uses mode 0 (19 zero ship rows).
5. **Two clocks.** Row date `09:53:36` (arrival, viewer zone) vs title `08:53:44` (return, target zone) [REAL report 1]; report 2:
   `09:53:20` vs `09:53:28` (same zone, 8 s flight back). Use the ROW date as the report time; never compare the title time
   with anything.
6. Numbers: `.` thousands, `-` for negative energy (`-1.250`), no short forms. Values reach 2.7e12: still exact in JS doubles.

```js
// R_footer
[...document.querySelectorAll('.spyRaportFooter')].map(f => {
  const a = f.querySelector('a[href*="target_mission=1"]'), q = new URL(a.getAttribute('href'), location.href).searchParams;
  return { attack: ['galaxy', 'system', 'planet', 'planettype'].map(k => +q.get(k)), text: f.textContent.replace(/\s+/g, ' ').trim(),
    chance: +(f.textContent.match(/(\d+)\s*%/) || [])[1], destroyed: !!f.querySelector('font[color="red"]') };
})
```
```
[{"attack":[2,81,10,1],"text":"Attack The spy probes discovery chance was: 0 % Simulate","chance":0,"destroyed":false},
 {"attack":[2,72,6,1],"text":"Attack The spy probes discovery chance was: 0 % Simulate","chance":0,"destroyed":false}]
```

Full recipe (pitfalls 1-4 handled):
```js
// G_spy
[...document.querySelectorAll('.spyRaport')].map(sr => GZMessagesB.spyReport(sr))
```
```
[{"title":"Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44","target":{"name":"2 bolygó","coords":[2,81,10],"planetType":1},
  "reportDate":"30. Oct 2026, 08:53:44","reportWall":1793350424000,
  "resources":{"metal":2684939750000,"crystal":1700557697522,"deuterium":675144412230,"energy":356568},
  "ships":{"202":0,"203":0,"204":0,"205":0,"206":0,"207":0,"208":0,"209":0,"210":0,"211":0,"212":0,"213":0,"214":0,"215":0,"216":0,"217":0,"218":0,"219":0,"220":0},
  "defense":null,"buildings":null,"research":null,
  "exact":{"901":2684939750000,"902":1700557697522.1,"903":675144412229.63,"911":356568},"simulateMatches":true,
  "known":{"ships":true,"defense":false,"buildings":false,"research":false},"probesDestroyed":false,"counterEspionage":0,
  "attackParams":{"galaxy":2,"system":81,"planet":10,"planettype":1}},
 {"title":"Spy Report Colony [2:72:6] on 30. Oct 2026, 09:53:28","target":{"name":"Colony","coords":[2,72,6],"planetType":1},
  "reportDate":"30. Oct 2026, 09:53:28","reportWall":1793354008000,
  "resources":{"metal":11483000000,"crystal":11483000000,"deuterium":6263925000,"energy":3391},
  "ships":null,"defense":null,"buildings":null,"research":null,"exact":{"901":11483000000,"902":11483000000,"903":6263925000,"911":3391},
  "simulateMatches":true,"known":{"ships":false,"defense":false,"buildings":false,"research":false},"probesDestroyed":false,"counterEspionage":0,
  "attackParams":{"galaxy":2,"system":72,"planet":6,"planettype":1}}]
```
Output shape vs OgameX `OGX.messages.parse.espionageFull`: same keys `resources/ships/defense/buildings/research/known/attackParams/counterEspionage`;
`coords` arrays; no `player` (GALAXYZ reports do not name the owner: get it from galaxy data), no `debris`, no activity.
Loot is not shown; 2Moons steals up to 50 % of each resource limited by cargo [UPSTREAM MissionCaseAttack].

### 6.1 "Spying activity" (someone spied me) [UPSTREAM MissionCaseSpy.class.php:163-188]

Category 0, from `Room monitoring`, subject `Spying activity`, body (no wrapper element):
`A hostile fleet of the planet <NAME><a href="game.php?page=galaxy&galaxy=G&system=S">[g:s:p]</a> was sighted near your planet\n<MY PLANET> <a ...>[g:s:p]</a> sighted`.
First link = spying planet, second = mine. No player name, no chance. Upstream glues the name to the link (no space).
`GZMessagesB.classify` -> `spy_activity`; `fleetText(item).coords` -> `[[2,66,7],[2,68,6]]`.

## 7. Combat [UPSTREAM]

### 7.1 Combat message body (category 3, from `Fleet Headquarters`, subject `Fight report`)
[MissionCaseAttack.class.php:51-70 heredoc, 442-475; same in MissionCaseDestruction.class.php:54-60]
```
div.raportMessage > table
  tr > td[colspan=2] > a[href="game.php?page=raport&raport=<md5>"][target=_blank] > span.raportWin|raportLose|raportDraw "Fight report [2:70:4] (P)"
  tr > td "Losses"      td > span.<cls> "Attacker: 12.000" &nbsp; span.<cls> "Defender: 4.580.000"
  tr > td "Profit"      td > span "Metal:&nbsp;" span.reportSteal.element901 "2.261.500.000" ... element902, element903
  tr > td "Rubblefield" td > span "Metal:&nbsp;" span.reportDebris.element901 ... element902
```
* The head span class is from the **reader's** side (`$class[$i]`, attacker messages get class[0], defenders class[1]).
* Expedition battles (pirates/aliens) use `CombatReport.php?raport=` and classes **`raportSteal` / `raportDebris`**
  (MissionCaseExpedition.class.php:220-239). Accept both spellings.
* `(P)` / `(D)` / `(M)` = `type_planet_short_N`.
```js
// G_combatShort  (fixtures/messages-upstream-view-100-p2.html)
[...document.querySelectorAll('.raportMessage')].map(GZMessagesB.combatShort)
```
```
[{"reportId":"3f1c0d6e8a2b4c5d6e7f8091a2b3c4d5","expedition":false,"url":"game.php?page=raport&raport=3f1c0d6e8a2b4c5d6e7f8091a2b3c4d5","result":"win",
  "coords":[2,70,4],"planetTypeShort":"P","losses":{"attacker":12000,"defender":4580000},
  "loot":{"metal":2261500000,"crystal":605250000,"deuterium":49000000},"debris":{"metal":1374000,"crystal":1260000}}, ...]
fixtures/messages-upstream-view-cat3.html, 3rd: {"reportId":"0123456789abcdef0123456789abcdef","expedition":true,"url":"CombatReport.php?raport=...","result":"lose",...}
```

### 7.2 Report popup `page=raport&raport=<id>` [UPSTREAM shared.mission.raport.tpl, ShowRaportPage.class.php:51-93]
`body.popup`, `#content > div[style*=text-align]`: "The following fleets face each other on: DATE:" then per round one
table of attacker blocks and one of defender blocks. A block = `td` whose first text node is
`Attacker NAME ([g:s:p] (P))` + `Firepower 140% - Shield 130% - Armour 150%` + an inner `table` with rows Type / Amount /
Firepower / Shield / Armour (ship **short names** `$LNG.shortNames`, no ids) or `Destroyed`. Between rounds:
"The attacking fleet fires with a power of X at the defender. The shields of the defender absorb Y damage points."
End: "The attacker has won the battle!" + "He captures A Metal, B Crystal and C Deuterium", "The defender has won the battle!",
or "The fight ends in a draw!"; "The attackers losses: N units", "The defenders losses: N units",
"At the coordinates are now: A Metal and B Crystal debris.", "Moon Chance: N %", optional "A moon formed at the planet ...".
Errors: "Invalid Battle Report ID", "The contact to the attacking fleet was lost ...". Battle hall (`mode=battlehall`) prints
`[XX:XX:XX]`. Upstream template bug: the defender's planet type uses `$LNG.type_planet_short[...]` which does not exist in en, so
it prints `()`.
```js
// G_combatFull  (fixtures/messages-upstream-raport.html, real-Smarty fixture of the parallel agent)
GZMessagesB.combatFull(document)
```
```
{"time":"30. Oct 2026, 08:54:00","result":"attacker","rounds":[{"attacker":[{"role":"attacker","name":"vodoleyko1992","coords":[2,68,5],"planetTypeShort":"P",
 "tech":[140,130,150],"ships":{"Heavy Cargo":400,"Battleship":150},"destroyed":false}],"defender":[{"role":"defender","name":"Kovacs","coords":[2,70,4],
 "planetTypeShort":null,"tech":[100,90,110],"ships":{"Light Fighter":800,"Missile Launcher":1500,"Light Laser Turret":900},"destroyed":false}]}, ...3 rounds],
 "loot":{"metal":12053668,"crystal":5251102,"deuterium":1825031},"lostUnits":{"attacker":36000,"defender":1985000},
 "debris":{"metal":495000,"crystal":225000},"moonChance":7,"moonBuilt":true,"notFound":false}
```
Ships in the popup are keyed by display name; map with `elements.json` names (short names may differ: verify live).

## 8. Fleet texts [UPSTREAM language/en/FLEET.php + MissionCase*.class.php]

All are plain sprintf text in `td.left`, numbers by `pretty_number` (`.` thousands), coordinates as
`<a href="game.php?page=galaxy&galaxy=G&system=S" class="">[g:s:p]</a>` (`GetStartAddressLink` / `GetTargetAddressLink`,
GeneralFunctions.php:222-230). Language dependent: match by category + structure first, text second.

| key (`classify`) | cat | from / subject | en text (FLEET.php line) | numbers |
|---|---|---|---|---|
| `transport_own` | 5 | Fleet Headquarters / Transportmessage | `One of your fleets reaches the planet NAME [link] and delivers N Metal, N Crystal and N Deuterium.` (164) | M C D |
| `transport_foreign` | 5 | same | `A peaceful fleet of NAME [link] reached NAME [link] and delivers ...` (165) | M C D |
| `recycle` | 5 | Fleet Headquarters / Recycling Report | `Having arrived at there destination your Recyclers collect N Metal and N Crystal` (168) | M C, **no coords** |
| `stay` (deploy) | 5 | Fleet Headquarters / Located fleet | `Your fleet reaches the planet [link] and delivers ...` (70) | M C D |
| `fleet_return` | 4 | Fleet Headquarters / Fleet return | `One of your fleets returns from the planet NAME [link].` (167) | none |
| `attack_return` | 4 | same | `One of your fleets returns from a attack at the planet NAME [link]. You have captured N Metal, N Crystal and N Deuterium ` (176) | loot |
| `expedition_back_home` | 4 | same | `Your fleet has returned from the expedition.<br>It deliveres Metal N, Crystal N, Deuterium N and Dark Matter N.` (160) | **name before number** (arg order bug, MissionCaseExpedition.class.php:522-527) |
| `colonisation_ok` / `_fail` | 4 | Colonisation / Colonisation report | `One of your fleets reaches the coordinates [2:68:9]. The settlers start to colonise ...` (72-80) | coords as plain text |
| `missile` | 3 | Fleet Headquarters / Rocket impact | `Interplanetary rockets (25) from NAME [link] are on the planet NAME [link] <br><br>5 Rockets of yours were intercepted.<br><br>Missile Launcher (- 300)<br>...` (170-174) | per-defence losses |
| `expedition_*` | 15 | Fleet Headquarters / Expedition report | one of `sys_expe_*` (84-157); ships found add `<br>NAME: N` lines; "No ships could be found." | amounts of resources/DM are **not** in the text; read them from the return message |
| `construction` | 99 | List of construction / Impossible to build | queue failure (see parallel fixture cat99) | |

Expedition outcomes (`classify` -> `expedition_<x>`): `resources`, `darkmatter`, `ships`, `nothing`, `delay`, `early`,
`lost`, `blackhole_partial`, `pirates`, `aliens` (+ a separate fight report in category 3).

```js
// G_fleetText  (fixtures/messages-upstream-view-100-p2.html)
GZMessagesB.list(document).items.filter(i => !i.body.querySelector('.spyRaport,.raportMessage'))
  .map(i => { const r = GZMessagesB.fleetText(i); delete r.text; return i.id + ' ' + JSON.stringify(r); })
```
```
530101 {"key":"spy_activity","coords":[[2,66,7],[2,68,6]],"resources":{}}
530090 {"key":"attack_return","coords":[[2,70,4]],"resources":{"metal":2261500000,"crystal":605250000,"deuterium":49000000}}
530085 {"key":"recycle","coords":[],"resources":{"metal":1374000,"crystal":1260000}}
530080 {"key":"transport_own","coords":[[2,68,6]],"resources":{"metal":7382,"crystal":0,"deuterium":0}}
530079 {"key":"transport_foreign","coords":[[2,66,7],[2,68,5]],"resources":{"metal":1000000,"crystal":500000,"deuterium":0}}
530075 {"key":"fleet_return","coords":[[2,68,5]],"resources":{}}
530070 {"key":"expedition_resources","coords":[],"resources":{}}
530069 {"key":"expedition_ships","coords":[],"resources":{},"shipsByName":{"Light Cargo":1200,"Cruiser":35},"noShipsFound":false}
530068 {"key":"expedition_nothing","coords":[],"resources":{}}
530067 {"key":"expedition_back_home","coords":[],"resources":{"metal":812000,"crystal":0,"deuterium":0,"darkmatter":0}}
530060 {"key":"colonisation_ok","coords":[[2,68,9]],"resources":{}}
530055 {"key":"stay","coords":[[2,68,6]],"resources":{"metal":10,"crystal":20,"deuterium":30}}
530050 {"key":"player_message","coords":[],"resources":{}}
fixtures/messages-upstream-view-cat3.html missile: {"key":"missile","coords":[[2,68,5],[2,70,4]],"resources":{},"missiles":25,"intercepted":5,"destroyedByName":{"Missile Launcher":300,"Light Laser Turret":120}}
```
Correlation hint [REAL overview events]: the recycle event `(8290 Recycler)` to `[2:87:8]` arrives 10:20:29; its
"Recycling Report" will carry that time but no coordinates, so match recycle reports to flights by time.

## 9. Pitfalls summary

* Two `form`s after a category click; always scope from `table#messagestable` (2).
* `#unread_N` is rewritten client side by every category click (3); `mode=view` marks read (1); `GET page=messages` alone has no list and marks nothing.
* Spy report (section 6, pitfalls 1-5): own cells only; ids from the Simulate link, in order; missing section = hidden,
  empty section = filtered zeros; the title time is another clock.
* Display values are **rounded** (`number_format`), the Simulate link holds the float (`1700557697522.1`).
* Combat bodies: `reportSteal` vs `raportSteal`, `page=raport` vs `CombatReport.php` (7.1).
* Texts are localized (`var Lang`) and full of upstream typos ("there destination", "a attack", "deliveres", "Ressources",
  "Phalax"); never "fix" them in regexes. `Fleet return` is used for 5 different message kinds: decide by body.
* Saved pages show absolute `https://ogamex.eu/Aeternum/game.php?...` hrefs (Chrome rewrote them); the stored HTML and the
  AJAX fragment are relative `game.php?...`. Resolve with `new URL(href, location.href)` or read `getAttribute('href')` + `URLSearchParams`.
* Duplicated ids on the page come from the layout (`#OvfleetEvents`, `#OvfleetContent`, `#planetList`, `#myWorlds`), not from the message list.

## 10. Checklist: what a real page must confirm

1. A combat report row (cat 3): `div.raportMessage` markup, `reportSteal` class, link `page=raport&raport=<md5>`, head class from my side.
2. The `page=raport` popup: GALAXYZ skin (is it still `#content > div` with `td.transparent` tables? ship short names?).
3. An expedition result (cat 15) and its "Fleet return" (cat 4): texts (GALAXYZ may have rewritten them) and the `Metal 812.000` order bug.
4. Transport arrival own/foreign and return (cat 5/4), recycle report (cat 5): exact wording and the coordinate links.
5. A spy report revealing defence/buildings/research: nesting as predicted (defence inside ships), headings `Planetary Defense` /
   `Buildings` / `Research`, Simulate link containing `im[1]`, `im[106]` etc. (or GALAXYZ filtering them).
6. A spy report with destroyed probes (`<font color="red">`) and one on a moon (`planettype=3`, title name).
7. "Spying activity" when someone spies me (cat 0).
8. The AJAX fragment itself (`mode=view&messcat=N&site=P&ajax=1`): wrapper, pager with more than 10 messages, `site` clamp.
9. The live `message.js` (not saved): does GALAXYZ still `remove()` the table and insert after `#content table:eq(0)`?
   Does it update `.new-msg-count`?
10. Topnav badge semantics: unread or total? (both pages show `2` after reading).
11. `?page=messages&category=3&side=1` on the full page: auto-loaded via `getMessages` on load (upstream)? (The "category 0 inline" question is settled: it was a click, see 0.1.)
12. POST action response (redirect target) and whether `deletemarked` is soft (`message_deleted`) on this server.
13. Player message (cat 1): reply icon `Dialog.PM(senderId, ...)`, `From` = `NAME [g:s:p]`; outbox (999) layout.

## 11. Open questions

* ~~Why does the spy page render category 0 server side?~~ Settled: it does not; the save was taken after a click (0.1).
* Report title time zone: confirmed different from the row time by exactly 1 h in report 1; assumed to be the target's zone
  (upstream code). Not useful for anything; flag if the extension shows it.
* Does GALAXYZ keep `ENABLE_SIMULATOR_LINK` for all sections (buildings/research ids in the link)? Only 900/200 seen.
* Expedition/raport ship names: `$LNG.shortNames` (upstream) vs full names (parallel fixture). Unknown live.
* 213-220 are GALAXYZ ships (Star Fighter, Battle Fortress, Battle Cruiser, Black Moon, Battle Transporter, Avatar, Battle
  Recycler, Dark Matter Collector); they appear in spy reports in id order like the rest [REAL].
