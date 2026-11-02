# GALAXYZ (2Moons fork) messages: spec for content scripts (GZMessages edition)

> **Superseded: merged into `messages.md`** (read that one). Its parser `messages-recipes.js` (`GZMessages`) is now the
> canonical recipe file; `messages.md` 0.1 holds its REAL-page validation and the corrections. Kept as a record only.
> One correction applies here too: `submitTop` is `Confirm` and the real form also posts `side=1` (`GZMessages.urls.actionBody`).

> Two agents covered this area in parallel. `messages.md` (API `GZMessagesB`, `messages-recipes-b.js`) is the other one; this file documents `messages-recipes.js` (`GZMessages`) and the Smarty-rendered fixtures (`tools/messages/`). Both agree on every REAL fact; merge as you like. Both parsers pass on all fixtures of both agents.

Scope: `game.php?page=messages` (categories, the AJAX list view, paging, read/delete actions), every message body the Suite needs (espionage report, espionage detected, combat summary, missile hit, expedition result, transport/recycle/deploy arrival, fleet return, colonisation, construction failure, player mail), the full combat report `page=raport` (+ `CombatReport.php`, battle-hall mode), the Hall of Fame `page=battleHall`, and how to tell message types apart. Same information needs as the old `specs/messages.md` (lanedirt OgameX): list/fetch endpoints, delete, unread state, espionage numbers (resources, fleet, defence, buildings, research), combat result/loot/debris/losses/units, expedition outcome and amounts, transport/harvest statistics. Read `layout.md` first (routing, `cp`, number and date formats, server zone).

## 0. Sources, confidence tags, files

| Tag | Meaning |
|---|---|
| **[REAL]** | Seen in a saved live page (GALAXYZ 1.8.git, `ogamex.eu/Aeternum`, 2026-10-30, account vodoleyko1992). `ms:N` = line N of `eu/pages/messages-spy.html` (category 0 list visible), `ma:N` = `eu/pages/messages-all.html` (category 100 opened afterwards). Both are post-JS DOM. Copies: `fixtures/messages-real-spy.html`, `fixtures/messages-real-all.html`. |
| **[UPSTREAM]** | Only from 2Moons 1.8 source (`src/2Moons`). The fork may differ; verify on a real page. |
| **[REAL=UPSTREAM]** | Seen live **and** identical to what the upstream template/code produces (so the neighbouring upstream code is very likely unchanged). |

Upstream short names: `MP` = `includes/pages/game/ShowMessagesPage.class.php`, `RP` = `includes/pages/game/ShowRaportPage.class.php`, `BH` = `includes/pages/game/ShowBattleHallPage.class.php`, `tpl/` = `styles/templates/game/`, `msg.js` = `scripts/game/message.js`, `M/` = `includes/classes/missions/` (`Spy` = `MissionCaseSpy.class.php` etc.), `GR` = `M/functions/GenerateReport.php`, `PU` = `includes/classes/PlayerUtil.class.php`, `FL`/`IG`/`TE` = `language/en/FLEET.php` / `INGAME.php` / `TECH.php` (`ru/` = `language/ru/...`).

Files in `specs/galaxyz/`:

| File | What it is |
|---|---|
| `messages-recipes.js` | Dependency-free script `GZMessages`: `parseCategories / parseList / classify / parseItem / parseSpyReport / parseSpyDetected / parseCombatMessage / parseCombatReport / parseBattleHall / parseExpedition / parseFleetText`, `api.*`, `NAMES` (en+ru name → id, 178 entries), `setTexts`. Works on `document`, a `DOMParser` document, or the AJAX fragment; also `module.exports`. |
| `tools/messages/check_messages.js` | Playwright: runs the parsers on every `fixtures/messages-*.html` (live DOM and DOMParser must agree) + 27 hard expectations (5 on the REAL pages). `cd specs/galaxyz && NODE_PATH=/opt/node22/lib/node_modules node tools/messages/check_messages.js --write` → `OK 20 pages, 27 expectations`; writes `fixtures/messages-expected-parse.json`. |
| `tools/messages/gen_messages_fixtures.php` | Regenerates the fixtures below (`php tools/messages/gen_messages_fixtures.php`). Renders the **real upstream Smarty templates** with the bundled Smarty 3.1.30; bodies use the exact `sprintf`/heredoc code of `M/*.php` (combat heredocs are extracted from the PHP files at run time); strings from `language/en` + `language/ru`. Read-only on `src/`. |
| `fixtures/messages-real-spy.html`, `-real-all.html` | Byte copies of the REAL pages. |
| `fixtures/messages-upstream-view-cat{0,1,3,4,5,15,99,999}.html` | The AJAX fragment `page=messages&mode=view&messcat=N&ajax=1` exactly as upstream renders it. cat 0: full spy report (all 5 sections), filtered + destroyed report on a moon, "spy detected"; 3: attack won, attacked-and-lost, expedition battle, missile hit; 15: 10 expedition outcomes, page 1 of 2; 5: transport own/foreign, recycle, deploy; 4: five kinds of fleet return + colonisation; 99: construction failure; 1: player mail with reply link; 999: outbox. Marked UPSTREAM-DERIVED in an HTML comment on line 1. |
| `fixtures/messages-live-synthetic-cat{3,4,5,15}.html` | The REAL messages page with its list replaced by the upstream rows in the **live wrapper markup** (`div.mainRS`, `table.hard-table`, section 2.2). For content scripts on the live layout. |
| `fixtures/messages-upstream-raport.html`, `-raport-defender-won.html`, `-raport-battlehall.html` | `page=raport` popup: attacker won with loot/debris/moon created; defender won with the attacker destroyed; Hall-of-Fame view with masked coordinates. `<head>` abbreviated. |
| `fixtures/messages-upstream-battleHall.html` | Content of `page=battleHall` (attacker won / defender won / draw). |
| `fixtures/messages-texts.json` | Classification data, **not a server response**: en + ru subjects, senders, report labels, `mg_type`, `shortNames`, section heads, every expedition text with its outcome. `GZMessages.setTexts(json)`. |
| `fixtures/messages-expected-parse.json` | Output of the parsers on all fixtures. |

---

## 1. Endpoints

All URLs are relative to `https://ogamex.eu/Aeternum/game.php`. `game.php` dispatches `page` → class and `mode` → method (default `show`) (`game.php:28-57`). Any `ajax` parameter makes the page render **only** its content block (`AbstractGamePage.class.php:36-47`, `tpl/layout.ajax.tpl`). There is **no CSRF token and no JSON API** for messages. Parameters are read with `HTTP::_GP` = `$_REQUEST` (GET or POST).

| # | Request | Params | Response | Source | Tag |
|---|---|---|---|---|---|
| 1 | `GET game.php?page=messages` | optional `category=N&side=P` (auto-loads that category; upstream skips category 0 because `!empty(0)` is false) | full page: category table with unread/total, game operators. Upstream has no list until the JS click (see open question 4). | MP:366-431, `tpl/page.messages.default.tpl` | [REAL ms:576-617, 704] |
| 2 | `GET game.php?page=messages&mode=view&messcat=N&site=P&ajax=1` | `messcat` 0,1,2,3,4,5,15,50,99,100 (all, default),999 (outbox); `site` (default 1, clamped) | HTML fragment `form > table#messagestable` (2.2), **10 rows per page** (`MESSAGES_PER_PAGE`, `includes/constants.php:91`), newest first. **Marks every returned message read** (not in the outbox). | MP:27-146, `tpl/page.messages.view.tpl`, msg.js:32-46 | URL [UPSTREAM]; fragment [REAL ms:621-700] |
| 3 | `POST game.php?page=messages` | `mode=action`, `messcat=N`, `submitTop=<any>` + `actionTop=<action>` (or `submitBottom` + `actionBottom`), `messageID[<id>]=1` per selected row | `302` → `game.php?page=messages&category=N&side=…` (full page). No success flag. | MP:149-302 | form [REAL ms:621-641] |
| 4 | `GET game.php?page=raport&raport=<rid>` | `rid` = 32 hex (md5) | popup page (`body.popup`) with the full combat report, or `printMessage` "Invalid Battle Report ID" / "contact lost" | RP:127-169, `tpl/shared.mission.raport.tpl` | [UPSTREAM] |
| 4a | `GET CombatReport.php?raport=<rid>` | | `302` → #4 (used by expedition battle messages) | `CombatReport.php:24` | [UPSTREAM] |
| 4b | `GET game.php?page=raport&mode=battlehall&raport=<rid>` | | Hall-of-Fame view, "A VS B" header coloured by result, coordinates `[XX:XX:XX]`, no ownership check | RP:77-125 | [UPSTREAM] |
| 5 | `GET game.php?page=battleHall[&order=date\|units&sort=ASC\|DESC]` | | full page: top 100 battles | BH:27-82, `tpl/page.battleHall.default.tpl` | link [REAL footer of every page]; page [UPSTREAM] |
| 6 | `GET game.php?page=messages&mode=write&id=<userId>&subject=…&message=…` / `POST …&mode=send&id&subject&text` | GALAXYZ `Dialog.PM(id, subject)` opens the write popup and also sends `&message=` | popup form / JSON string "Message Sent!" (session token from `write`) | MP:304-364; `Dialog.PM` [REAL eu/overview/…_files/base.js:161-166] | |

Actions for #3 (`select[name=actionTop]` [REAL ms:633-641] = `tpl/page.messages.view.tpl:14-22`):

| value | effect (MP:185-300) |
|---|---|
| `readmarked` | mark `messageID[]` read |
| `readtypeall` | mark category `messcat` read (→ `readall` when 100) |
| `readall` | mark all read |
| `deletemarked` | delete `messageID[]` |
| `deleteunmarked` | delete all **except** `messageID[]`. **With no ids it becomes `deletetypeall`, and with `messcat=100` that becomes `deleteall`** (MP:176-180). Never send it with an empty list. |
| `deletetypeall` | delete category `messcat` (→ `deleteall` for 100) |
| `deleteall` | delete everything |

Facts:
* Only the **keys** of `messageID[...]` are used (`array_keys`, MP:213,262); values must be numeric. Ids are global DB ids (`message_520244` [REAL ms:654]); ownership is enforced in SQL.
* Delete is soft when `message_delete_behavior = 1` (sets `message_deleted`), otherwise a hard `DELETE` (MP:219-299). Either way the message leaves all lists and counters.
* `action()` reads `HTTP::_GP('page', 1)` for the redirect, which is the string `messages` (`…&side=messages`, harmless upstream bug, MP:156-159). The hidden `side` input is ignored.
* Reading = marking read. Only #1 and the raport page have no side effect. `tr.mes_unread` means "was unread **before** this request" (the template uses the rows selected before the UPDATE, MP:114-135) [REAL: rows have `mes_unread` in ms, not in ma].
* Invalid `messcat` → empty list; `site` past the end → last page.

```js
const BASE = location.origin + location.pathname;            // https://ogamex.eu/Aeternum/game.php
async function fetchList(cat = 100, site = 1) {              // WARNING: marks the returned page read
  const r = await fetch(`${BASE}?page=messages&mode=view&messcat=${cat}&site=${site}&ajax=1`, { credentials: 'same-origin' });
  return GZMessages.parseList(new DOMParser().parseFromString(await r.text(), 'text/html'));
}
async function deleteMessages(ids, cat = 100) {               // no CSRF token in this engine
  if (!ids.length) throw new Error('no ids');
  const body = new URLSearchParams({ mode: 'action', ajax: '1', messcat: String(cat), actionTop: 'deletemarked', submitTop: '1' });
  ids.forEach((id) => body.append(`messageID[${id}]`, '1'));
  const r = await fetch(`${BASE}?page=messages`, { method: 'POST', credentials: 'same-origin', body });
  return r.ok;                                                // only "the request went through"; re-list to confirm
}
```

## 2. The messages page

### 2.1 Full page and categories

`body#messages`, `queryString = "page=messages"` [REAL]. Inside `#inhalt` after the event box: `div#planet` with `h2` "News of administration" + `span#loading` [REAL ms:576-578; upstream has these in a `<th>`, `tpl/page.messages.default.tpl:5`], then `div.mainRS > div#content > table.hard-table` (categories), the list form, then `table.hard-table` "Game operators" [REAL ms:704]. Header unread counter: `.messages-section .new-msg-count` (layout.md 9) [REAL "2" on overview].

Category cell [REAL ms:586-617 = `tpl/page.messages.default.tpl:7-14` + MP:375]:

```html
<td style="word-wrap: break-word;color:#FFFF00;"><a href="#" onclick="Message.getMessages(0);return false;" style="color:#FFFF00;">Spy messages</a>
<br><span id="unread_0">0</span>/<span id="total_0">2</span></td>
```

| cat | key | en name (IG:508-518) [REAL] | ru (ru/IG:484-494) | colour | written by |
|---|---|---|---|---|---|
| 0 | spy | Spy messages | Шпионаж | #FFFF00 | own spy report (sender "Spying department", subject "Intelligence report") **and** the "spy detected" notice for the target (sender "Room monitoring", subject "Spying activity") (M/Spy:160,187) |
| 1 | player | Player messages | Игроки | #FF6699 | player mail, ACS invitation (`ShowFleetTablePage:155`), alliance diplomacy |
| 2 | alliance | Alliance messages | Альянс | #FF3300 | circular mail, applications |
| 3 | combat | Combat messages | Битвы | #FF9900 | combat summaries (attack, ACS, destroy, **expedition battle**), missile hits (M/Attack:474, M/Expedition:463, M/MIP:149,152, M/Destruction:503) |
| 4 | system | System messages | Системные | #773399 | **every fleet return** ("Fleet return"), colonisation report, buddy requests, referral bonus, support answers |
| 5 | transport | Transport messages | Транспорт | #009933 | transport arrival (own + foreign receiver), recycling report, deploy arrival (M/Transport:45,59, M/Recycling:117, M/Stay:51) |
| 15 | expedition | Expedition messages | Экспедиция | #6495ed | expedition result (M/Expedition:512, M/FoundDM:51) |
| 50 | game | Game messages | Новости | #666600 | admin broadcasts (`pages/adm/ShowSendMessagesPage.php:59`) |
| 99 | construction | Construction messages | Постройки | #007070 | build/research queue failures (`class.PlanetRessUpdate.php:477,605`) |
| 100 | all | All messages | Все | #ABABAB | everything |
| 999 | outbox | Outbox | Исходящие | #CCCCCC | mails I sent (`total_999` counts all ever sent) |

Six cells per row; an empty `<td>&nbsp;</td>` precedes the last cell [REAL ms:616]. `unread_N`/`total_N` ids are unique. `Message.MessageCount()` rewrites the unread spans **client-side** when a category is opened (msg.js:4-30), so a saved page shows `#unread_0` = 0 while its rows still carry `mes_unread` [REAL ms]. Use a fresh `GET page=messages` for exact counters.

```js
GZMessages.parseCategories(document)
// messages-real-spy.html -> [{"cat":0,"key":"spy","name":"Spy messages","color":"#FFFF00","unread":0,"total":2}, … 11 entries]
```

### 2.2 The list (AJAX fragment, live wrapper)

`Message.getMessages(cat, page)` → `$.get('game.php?page=messages&mode=view&messcat='+cat+'&site='+page+'&ajax=1')`, then `$('#messagestable').remove(); $('#content table:eq(0)').after(data)` (msg.js:32-46). Only the **table** is removed, so each click leaves the previous `<form><div class="mainRS"></div></form>` behind [REAL ma:702-710]. Always select `table#messagestable` (exactly one), never "the first form".

Live markup [REAL ms:621-700]; **LIVE** = differs from upstream `tpl/page.messages.view.tpl`:

```
form[action$="game.php?page=messages"][method=post]
  input[name=mode][value=action]  input[name=ajax][value=1]  input[name=messcat][value=0]  input[name=side][value=1]
  div.mainRS                                                    ← LIVE wrapper
    table#messagestable.hard-table[style="width:760px;"]        ← LIVE class
      tr > th[colspan=4] "Messages"
      tr > td[colspan=4] > select[name=actionTop] (7 options) + input[type=submit][name=submitTop][value=Confirm]   (absent in outbox)
      tr > td.right[colspan=4]  "Page: " a[onclick="Message.getMessages(0, 1);return false;"] > b "[1]"   (« prev, [n] links, » next)
      tr  td "Action" | "Date" | "From" ("To" in outbox) | "Subject"
      per message:
      tr#message_520244.message_head[.mes_unread]
         td[rowspan=2][style="width:40px;"] > input[type=checkbox][name="messageID[520244]"][value=1]   (absent in outbox)
         td  "30. Oct 2026, 09:53:36"        message time, viewer's timezone, php_tdformat 'd. M Y, H:i:s'
         td  "Spying department"             sender (system name, or "player [g:s:p]")
         td  "Intelligence report" [+ a[onclick^="return Dialog.PM(<senderId>, …)"] > img   type 1 only]
      tr.messages_body > td[colspan=3].left  = message_text (raw HTML stored at send time)
      tr > td.right "Page: …"   tr > select[name=actionBottom] + submitBottom
```

* The body HTML is **frozen at send time** in the recipient's language of that moment (`PU:615-646` stores `message_text`; missions call `getLanguage(NULL, userId)`).
* Message time = arrival (`fleet_start_time`) for arrivals, `fleet_end_stay` for expedition results, `fleet_end_time` for returns, in the viewer's timezone (MP:120). Server zone UTC+2 (layout.md 6).
* No per-row type attribute; in category 100 the type must be inferred (section 3).
* hrefs inside bodies are **relative** as stored (`game.php?page=galaxy…`); the saved page shows them absolute only because Chrome rewrote them. Recipes parse `getAttribute('href')` query strings, so both work.

```js
const list = GZMessages.parseList(document);     // or the DOMParser doc of the fragment
// messages-real-spy.html -> {"cat":0,"page":1,"pages":1,"items":[{"id":520244,"unread":true,"selectable":true,
//    "date":"30. Oct 2026, 09:53:36","wall":1793354016000,"from":"Spying department","subject":"Intelligence report","senderId":null,"body":<td>}, …]}
```

`wall` = wall-clock fields as a UTC timestamp (same convention as `fleet-recipes.js`); subtract the zone offset for a real instant.

## 3. Detecting the message type

Open **each category separately** (the category gives most of the type), then use structure; subject text only as a fallback for category 100. `GZMessages.classify(item, cat)` implements this table; `GZMessages.parseItem(item, cat, texts)` also runs the matching parser.

| kind | cat | language-independent signal | fallback subject (en / ru) | source |
|---|---|---|---|---|
| `spy_report` | 0 | body has `div.spyRaport` | Intelligence report / Шпионский доклад | M/Spy:158-161 [REAL] |
| `spy_detected` | 0 | cat 0 without `.spyRaport`; 2 galaxy links | Spying activity / Шпионаж | M/Spy:163-188 |
| `combat` | 3 | `div.raportMessage a[href*="page=raport&raport="]` | Fight report / Боевой доклад | M/Attack:51-69,474; M/Destruction:503 |
| `combat_expedition` | 3 | `div.raportMessage a[href^="CombatReport.php"]` (classes `raportSteal`/`raportDebris`, not `reportSteal`/`reportDebris`) | same | M/Expedition:220-239,463 |
| `missile` | 3 | cat 3 without `.raportMessage` | Rocket impact / Ракетная атака | M/MIP:110-153 |
| `expedition` | 15 | category | Expedition report / Доклад экспедиции | M/Expedition:512, M/FoundDM:51 |
| `recycle` | 5 | 0 galaxy links, 2 numbers | Recycling Report / Доклад переработчиков | M/Recycling:111-118 |
| `transport_received` | 5 | 2 galaxy links (sender planet, my planet) | Transportmessage / Транспортировка | M/Transport:47-60 |
| `transport_arrival` | 5 | 1 link, subject ≠ stay | Transportmessage | M/Transport:38-46 |
| `deploy_arrival` | 5 | 1 link, subject = stay | Located fleet / Удерживающийся флот | M/Stay:49-52 |
| `return` | 4 | subject "Fleet return"; 1 link + 3 numbers after it (attack/ACS loot, recycler load, deploy leftovers) | Fleet return / Возвращение флота | M/Attack:588-604, M/ACS:40-59, M/Recycling:129-146, M/Stay:64-74 |
| `return_empty` | 4 | 1 link, no numbers ("returns from the planet X [g:s:p].": transport, ACS-defend) | | M/Transport:72-84, M/StayAlly:38-47 |
| `return_expedition` | 4 | **no link**, 4 numbers (M, C, D, DM) | | M/Expedition:517-531 |
| `return_expedition_dm` | 4 | no link, < 4 numbers (mission 11 return) | | M/FoundDM:56-74 |
| `colonisation` | 4 | subject "Colonisation report" (sender "Colonisation") | Доклад поселенцев | M/Colonisation:118 |
| `construction` | 99 | category | Impossible to build | class.PlanetRessUpdate.php:477 |
| `player` | 1 | reply link `a[onclick*="Dialog.PM("]` | | MP:323, view.tpl:44-46 |
| `alliance` / `game` / `outbox` | 2 / 50 / 999 | category | | |

Senders: fleet events "Fleet Headquarters" / "Командование флотом" (`sys_mess_tower`, FL:52); spy report "Spying department" [REAL] (`sys_mess_qg`, FL:56; ru "Постройки", a translation slip identical to the category-99 name). Both languages are in `S` of the recipes and in `messages-texts.json`.

## 4. Espionage report

### 4.1 Markup [REAL=UPSTREAM]

`tpl/shared.mission.spyReport.tpl:1-21`, rendered at arrival with the `trimwhitespace` filter (M/Spy:136-158): one line, single spaces [REAL ms:664, 677]:

```
div.spyRaport
  div.spyRaportHead > a[href="game.php?page=galaxy&galaxy=2&system=81"]
        "Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44"        sys_mess_head (FL:59; ru 'Сканирование %s [%d:%d:%d] от %s')
  div.spyRaportContainer                                                    one per revealed class, in this order:
    div.spyRaportContainerHead.spyRaportContainerHeadClass900 "Ressources"   900 | 200 "Ships" | 400 "Planetary Defense" | 0 "Buildings" | 100 "Research" (TE tech[class])
    div.spyRaportContainerRow.clearfix  (two name/value pairs per row)
       div.spyRaportContainerCell "Metal"   div.spyRaportContainerCell "2.684.939.750.000"
       …
  div.spyRaportFooter
    a[href="game.php?page=fleetTable&galaxy=2&system=81&planet=10&planettype=1&target_mission=1"] "Attack"     ← planettype 1 planet / 3 moon
    <br>"The spy probes discovery chance was:  0 % "                     sys_mess_spy_lostproba (FL:60)   OR
    <br><font color="red">Your spy probes were destroyed! </font>         sys_mess_spy_destroyed (FL:66)
    <br>a[href="game.php?page=battleSimulator&im[901]=2684939750000&im[902]=1700557697522.1&…&im[220]=0"] "Simulate"
```

| Field | Selector / rule | Sample [REAL ms:664,677] | Source | Tag |
|---|---|---|---|---|
| target name | head link text before ` [`, minus "Spy Report " | `2 bolygó` | Spy:151 | REAL |
| coordinates | `/\[(\d+):(\d+):(\d+)\]/` on head text | `2:81:10` | Spy:151 | REAL |
| target type | `planettype` of the Attack link | `1` | tpl:17 | REAL |
| title date | `d. M Y, H:i:s` in the title | `30. Oct 2026, 08:53:44` = probes' **return** time (`fleet_end_time`) in the **target's** timezone | Spy:151 | REAL (its row says 09:53:36: other zone, +8 s flight back; 2nd report 09:53:20 vs 09:53:28 same zone) |
| sections | `.spyRaportContainerHeadClass(\d+)` | 900, 200 | tpl:7 | REAL |
| display values | 2nd cell of each pair, `pretty_number` (rounded) | `1.700.557.697.522` | tpl:11 | REAL |
| exact values + **ids** | Simulate link `im[ID]=raw`, same order as the cells, raw PHP floats | `im[902]=1700557697522.1` | tpl:19 | REAL |
| discovery chance | `(\d+)\s*%` in the footer | `0` | tpl:18, Spy:110-111 | REAL |
| destroyed | `font[color=red]` in the footer | — | tpl:18, Spy:190-207 | UPSTREAM |

Rules:
* **Cells have no ids**, only localized names. Zip the Simulate link `im[ID]` with the cells (`exact: true`). The link exists only while `ENABLE_SIMULATOR_LINK` and the simulator module are on (Spy:150); otherwise map names with `GZMessages.NAMES`. Fork en names are REAL: Star Fighter 213, Battle Fortress 214, Battle Cruiser 215, Black Moon 216, Battle Transporter 217, Avatar 218, Battle Recycler 219, Dark Matter Collector 220 [REAL ms:664]; see `elements.json`.
* Resources = 901, 902, 903 and **911 energy** (may be negative). No dark matter, no debris section, no player name, no activity, no class, no loot % (2Moons has none).
* Reveal thresholds (Spy:75-107, constants.php:118-134): `n` = probes × (1 + SpyPower), `MinAmount = ±(spy tech difference)²` (negative when I have the higher tech): fleet if `n ≥ MinAmount`, defence `+1`, buildings `+3`, research `+5`. Fixed order fleet < defence < buildings < research: a later section present proves the earlier ones. **Section present = revealed; absent = unknown.** Resources are always shown.
* Defence (400) = 401-411 **plus missiles 502, 503**. Buildings (0) include the fork's conveyors 71-73 (elements.json). Research (100) = 106…199.
* User setting `spyMessagesMode = 1` drops zero values (`array_filter`, Spy:128-131): a revealed section may have **no rows**, and missing entries mean 0. Mode 0 lists every element including 0 [REAL ms:664: 19 ships, all 0].
* **Unbalanced DIVs**: with an odd element count the last `spyRaportContainerRow` of a section is never closed (tpl:9-12), so the browser nests the next container or the footer **inside** the previous container [REAL ms:664: the 19-ship section contains the footer]. Scope cells with `cell.closest('.spyRaportContainer') === container`.

```js
function spyReport(el) {                     // abbreviated parseSpyReport
  const sr = el.querySelector('.spyRaport'), foot = sr.querySelector('.spyRaportFooter');
  const sim = foot.querySelector('a[href*="page=battleSimulator"]');
  const ids = sim ? [...new URLSearchParams(sim.getAttribute('href').split('?')[1])].filter(([k]) => /^im\[\d+\]$/.test(k))
                       .map(([k, v]) => [+k.slice(3, -1), Math.floor(parseFloat(v))]) : [];
  const out = {}; let i = 0;
  for (const box of sr.querySelectorAll('.spyRaportContainer')) {
    const cls = +/HeadClass(\d+)/.exec(box.querySelector('.spyRaportContainerHead').className)[1];
    out[cls] = {};
    const cells = [...box.querySelectorAll('.spyRaportContainerCell')].filter((c) => c.closest('.spyRaportContainer') === box);
    for (let j = 0; j + 1 < cells.length; j += 2, i++)
      if (ids[i]) out[cls][ids[i][0]] = ids[i][1];                          // else GZMessages.idOf(cells[j].textContent)
  }
  return out;   // {900:{901:…,902:…,903:…,911:…}, 200:{202:0,…}}
}
```

Output on the real report 520244 (`messages-expected-parse.json`):

```json
{"title":"Spy Report 2 bolygó [2:81:10] on 30. Oct 2026, 08:53:44","targetName":"2 bolygó","coordsStr":"2:81:10","planetType":1,
 "reportDateText":"30. Oct 2026, 08:53:44","destroyed":false,"discoveryChance":0,
 "revealed":{"resources":true,"fleet":true,"defense":false,"buildings":false,"research":false},
 "resources":{"901":2684939750000,"902":1700557697522,"903":675144412230,"911":356568},
 "fleet":{"202":0,"203":0,"…":0,"220":0},"defense":null,"buildings":null,"research":null,"exact":true,"unknownNames":[]}
```

### 4.2 Spy detected [UPSTREAM]

Category 0, sender "Room monitoring", subject "Spying activity" (FL:61-62). Body (M/Spy:163-184):

```
A hostile fleet of the planet Kovacs Prime<a href="game.php?page=galaxy&galaxy=2&system=70">[2:70:4]</a> was sighted near your planet
		Главная планета <a href="game.php?page=galaxy&galaxy=2&system=68">[2:68:5]</a> sighted
```

First link = spying planet (name glued to the link; `(Moon) ` inserted when the probes came from a moon), second = my planet. **No counter-espionage chance and no player name.** `parseSpyDetected(item)` → `{from, target, fromText, fromMoon, wall}`.

## 5. Combat

### 5.1 Summary in the list (category 3) [UPSTREAM]

Heredoc M/Attack:51-67, filled at M/Attack:438-472 (one message per participant, in his language):

```
div.raportMessage > table
  tr > td[colspan=2] > a[href="game.php?page=raport&raport=<32 hex>"][target=_blank] > span.(raportWin|raportLose|raportDraw)  "Fight report [2:70:4] (P)"
  tr > td "Losses"      td > span.<attacker class> "Attacker: 36.000" &nbsp; span.<defender class> "Defender: 1.985.000"
  tr > td "Profit"      td > span "Metal:&nbsp;" span.reportSteal.element901 "12.053.668" … element902 … element903
  tr > td "Rubblefield" td > span "Metal:&nbsp;" span.reportDebris.element901 "495.000" … element902
```

| Field | Rule | Source |
|---|---|---|
| report id | `raport` param of the link (md5) | Attack:418 |
| target | `[g:s:p]` + `(P\|D\|M)` (`type_planet_short_N`; ru П/ПО/Л) in the title | Attack:443-449 |
| **my result** | title span class: `raportWin` I won, `raportLose` I lost, `raportDraw` | Attack:395-414,440 |
| winner | attacker loss span class: Win → attacker, Lose → defender, Draw | Attack:450-453 |
| my role | title class == attacker span class → attacker, else defender (undefined on a draw) | |
| losses | number after `:`, in **resource units** | Attack:451-453 |
| loot | `.reportSteal.element90x` (attack) / `.raportSteal.element90x` (expedition) | |
| new debris | `.reportDebris.element90x` / `.raportDebris.element90x` (metal, crystal) | |

No moon chance, no units in the summary. Expedition battles (M/Expedition:296-464) use the same layout, link `CombatReport.php?raport=…`, the player is the **attacker** and pirates/aliens the defender; coordinates are the expedition target (`[g:s:16]`).

Missile hit (category 3, "Rocket impact", M/MIP:110-153), sent **identically to attacker and defender**: `Interplanetary rockets (25) from Главная планета <a>[2:68:5]</a> are on the planet Kovacs Prime <a>[2:70:4]</a> <br><br>` + `5 Rockets of yours were intercepted.<br><br>` + per defence `Missile Launcher (- 300)<br>`, or `The planet does not have defences` / `All your rockets were intercepted.`.

```js
GZMessages.parseCombatMessage(item)
// -> {"reportId":"3f9a2c7e…","url":"game.php?page=raport&raport=3f9a2c7e…","isExpedition":false,"coordsStr":"2:70:4","planetTypeShort":"P",
//     "myResult":"win","winner":"attacker","myRole":"attacker","lost":{"attacker":36000,"defender":1985000},
//     "loot":{"901":12053668,"902":5251102,"903":1825031},"debris":{"901":495000,"902":225000}}
```

### 5.2 Full report `page=raport` [UPSTREAM]

`tpl/layout.popup.tpl` (`body.popup > div#content`) + `tpl/shared.mission.raport.tpl`; data = `unserialize(raport)` built by `GR:18-124`. Participants only (RP:147-153); an attacker who lost within ≤ 2 rounds gets "The contact to the attacking fleet was lost…" instead (RP:156-158). Text only, no ids/classes except `td.transparent`:

```
div#content > div[style="width:100%;text-align:center"]
  "The following fleets face each other on: " "30. Oct 2026, 08:54:00:" <br><br>        (mode 1 moon destruction: sys_destruc_title)
  per round k = 0..n (k = 0 start state, last pair = end state):
    table > tr > td.transparent (one per attacker fleet) > table > tr > td
         "Attacker vodoleyko1992 ([2:68:5] (P))<br>Firepower 140% - Shield 130% - Armour 150%"
         table[width=100%]: tr "Type" + names (shortNames) | tr "Amount" | tr "Firepower" | tr "Shield" | tr "Armour"   (or "Destroyed")
    <br><br>
    table > … defenders: "Defender Kovacs ([2:70:4] ())"   ← upstream bug: defender planet type always empty (tpl:82)
    (not after the last pair) "The attacking fleet fires with a power of 1.404.000 at the defender. The shields of the defender absorb 115.000 damage points.<br>
                              The defending fleet fires with a power of 680.000 at the attacker. The shields of the attacker absorb 59.200 damage points.<br><br>"
  result: "The attacker has won the battle!" | "The defender has won the battle!" | "The fight ends in a draw! "
  [result a] "He captures 12.053.668 Metal, 5.251.102 Crystal and 1.825.031 Deuterium"
  "The attackers losses: 36.000 units" / "The defenders losses: 1.985.000 units"
  "At the coordinates are now: 495.000 Metal and 225.000 Crystaldebris."          (no space, FL:27-28)
  mode 0: "Moon Chance:  7 %" [+ "A moon formed at the planet Moon [2:70:4] !"];  mode 1: destruction texts (tpl:149-170)
```

* Units have **no ids**: map `shortNames` with `GZMessages.idOf()` (en shortNames == elements.json names; ru from `ru/TECH.php`). Defences appear with the defender; missiles never.
* Tech % = tech × 10 (`techs × 100`, GR:53). Rows "Shield"/"Armour" print engine fields `def`/`shield` (GR:83-85).
* Pair k shows the fleets at the **start** of round k; `roundsFought = pairs − 1`; losses per type = start − end.
* Result is text only: match `S.won` (en/ru), else a loot line (3 numbers) ⇒ attacker won. Battle-hall mode: "A VS B" header colour (lime = winner) and `[XX:XX:XX]` coordinates.

```js
const r = GZMessages.parseCombatReport(new DOMParser().parseFromString(html, 'text/html'));
// messages-upstream-raport.html -> {"mode":0,"time":"30. Oct 2026, 08:54:00","result":"a","loot":{"901":12053668,"902":5251102,"903":1825031},
//   "lost":{"attacker":36000,"defender":1985000},"debris":{"901":495000,"902":225000},"moonChance":7,"moonCreated":true,"roundsFought":2,
//   "start":{"attackers":[{"name":"vodoleyko1992","coords":{…2:68:5},"tech":{"weapon":140,"shield":130,"armour":150},
//            "units":{"203":{"name":"Heavy Cargo","count":400,…},"207":{…,"count":150}}}],"defenders":[…204:800, 401:1500, 402:900]},
//   "end":{…"defenders":[{"destroyed":true,…}]}}
```

### 5.3 Hall of Fame `page=battleHall` [UPSTREAM; link REAL]

`table.table569 > tr.day<N>.week<M>`: rank, `a[href="game.php?page=raport&mode=battlehall&raport=<rid>"][target=_blank]` with `span[style="color:#00FF00"]` (winner) / `#FF0000` names (plain "A VS B" on a draw; ACS names joined by ` & `), date, units (pretty_number). Top 100, `order=units|date`, `sort=ASC|DESC` (BH:27-82). `GZMessages.parseBattleHall(doc)`.

## 6. Expedition

### 6.1 Result (category 15) [UPSTREAM]

Body = **one random flavour text** `$LNG['sys_expe_<group>_<n>']` and nothing else, except for found ships (M/Expedition:56-513). `messages-texts.json` holds all en + ru texts with their outcome:

| outcome | keys (FL:90-158) | extra content | amount here? |
|---|---|---|---|
| resources | `sys_expe_found_ress_{1_1..1_4, 2_1..2_3, 3_1..3_2}` | — | **no** (neither amount nor which resource) |
| darkmatter | `sys_expe_found_dm_{1_1..1_5, 2_1..2_3, 3_1..3_2}` | — | **no** |
| ships | `sys_expe_found_ships_{1_1..1_4, 2_1..2_2, 3_1..3_2}` | `<br>Light Cargo: 37<br>Light Fighter: 1.250` (localized `tech` names) or `<br><br>No ships could be found.` | ship counts |
| nothing | `sys_expe_nothing_{1..9}` | — | — |
| delay / speedup | `sys_expe_time_slow_{1..6}` / `sys_expe_time_fast_{1..3}` | — (new return time only in fleetTable) | — |
| fleet_lost | `sys_expe_lost_fleet_{1..4}` | — | — |
| battle_pirates / battle_aliens | `sys_expe_attack_1_*` / `_2_*` | plus a category-3 combat message (5.1) with the same time | — |

* Key = size class (`_1_` normal, `_2_` big, `_3_` huge). `ress_1_2` and `ress_1_3` share the English text (FL:91-92); the outcome is the same.
* **Resource and dark-matter amounts appear only in the fleet-return message** (6.2): pair with the next `return_expedition` (result at `fleet_end_stay`, return at `fleet_end_time`).
* Matching: whitespace-normalised text before the first `<br>`, exact then prefix. The fork may have rewritten the texts; unmatched → `outcome: null` (log it).

```js
GZMessages.setTexts(await (await fetch(chrome.runtime.getURL('messages-texts.json'))).json());
GZMessages.parseExpedition(item)   // -> {"outcome":"ships","key":"sys_expe_found_ships_1_2","lang":"en","ships":{"202":37,"204":1250},…}
```

### 6.2 Expedition return (category 4) [UPSTREAM]

`Your fleet has returned from the expedition.<br>It deliveres Metal 1.254.000, Crystal 0, Deuterium 0 and Dark Matter 450.` (`sys_expe_back_home`, FL:160; **name before number**, ru FL:154 same order). No coordinates, no ships. Numbers in order = 901, 902, 903, 921 (whole cargo). `parseFleetText(item, 'return_expedition')`.

## 7. Transport, recycle, deploy, returns, colonisation [UPSTREAM]

Numbers are `pretty_number`. Planet names stand **before** their link and may contain digits (`2 bolygó` [REAL]), so `parseFleetText` takes the numbers **after the last galaxy link**.

| kind | cat | en template (FL line) | numbers |
|---|---|---|---|
| `transport_arrival` | 5 | `One of your fleets reaches the planet %s %s and delivers %s Metal, %s Crystal and %s Deuterium.` (164), target name + link | M, C, D delivered |
| `transport_received` | 5 | `A peaceful fleet of %s %s reached %s %s and delivers …` (165), sender name+link, my name+link | M, C, D received |
| `recycle` | 5 | `Having arrived at there destination your Recyclers collect %s Metal and %s Crystal` (168), **no coordinates** | M, C harvested (no field size/capacity) |
| `deploy_arrival` | 5 | `Your fleet reaches the planet %s and delivers …` (70, `sys_stat_mess`), target link | M, C, D; **D includes the refunded half fuel** (M/Stay:45-47) |
| `return` (attack, ACS) | 4 | `One of your fleets returns from a attack at the planet %s %s. You have captured …` (176): **own** planet name + **target** link | M, C, D brought home |
| `return` (recycle) | 4 | `sys_tran_mess_owner` (164) with start planet + link | M, C, D |
| `return` (deploy recalled) | 4 | `sys_stat_mess` with the start link | M, C, D |
| `return_empty` | 4 | `One of your fleets returns from the planet %s %s.` (167) | none |
| `return_expedition` | 4 | 6.2 | M, C, D, DM |
| `colonisation` | 4 | `sys_colo_allisok` / `_badpos` / `_notfree` / `_maxcolo` / `_notech` (FL:75-80): `One of your fleets reaches the coordinates <a>[g:s:p]</a>. …` | — |
| `construction` | 99 | `sys_notenough_money` (IG:417): `You dont have enough resources on NAME <a href="./game.php?page=buildings&cp=ID&re=0">[g:s:p]</a> to build …` | planet id in `cp` |

```js
GZMessages.parseFleetText(item)   // kind from classify()
// transport_arrival -> {"kind":"transport_arrival","links":[{2:68:6}],"target":{2:68:6},"resources":{"901":500000,"902":250000,"903":100000}}
// recycle           -> {"kind":"recycle","links":[],"resources":{"901":4145000,"902":2072500}}
```

## 8. Porting notes (what breaks in the old extension)

| Old (OgameX / OGame) | GALAXYZ |
|---|---|
| `/messages` tabs/subtabs, `GET /ajax/messages?tab=…&subtab=…&pagination=N` | `game.php?page=messages&mode=view&messcat=<0..999>&site=N&ajax=1` (numeric categories, 2.1) |
| `GET /ajax/messages/{id}` detail | **none**: the list has the full body; only combat has a detail page (`page=raport&raport=<md5>`) |
| `POST /messages messageId=…&action=103` + CSRF header, JSON `{id:true}` | `POST page=messages mode=action actionTop=deletemarked submitTop messageID[id]=1`, no token, 302, no JSON |
| `li.msg[data-msg-id]`, `.msg_title/.msg_date/.msg_content/.msg_sender` | `tr.message_head#message_<id>` (td 2 date, 3 from, 4 subject) + next `tr.messages_body > td` |
| `li.msg_new` | `tr.mes_unread`; viewing marks read |
| espionage `ul.detail_list[data-type] > li` with `img.tech<ID>`, exact `title` values | `spyRaportContainerHeadClass<900\|200\|400\|0\|100>` name/value cells, **no ids**; exact values + ids only via Simulate `im[ID]=` |
| espionage player, activity, class, debris, counter-espionage % | none; only "discovery chance %" and energy |
| empty section = "unable to retrieve" | section absent = not revealed; present without rows = revealed, all zero |
| combat `.combatInfo` with `undermark/overmark` | `.raportMessage` with `raportWin/raportLose/raportDraw` (relative to the **reader**) |
| combat detail `div.detailReport` + `var combatData = {…}` | text tables per round, names only, no JS data |
| expedition amounts in the result message | **amounts only in the return message** |
| harvest report (field, capacity, ships) | "your Recyclers collect M and C" only |
| `data-raw-*` | does not exist |
| dates `dd.mm.YYYY HH:MM:SS` | `30. Oct 2026, 09:53:36` (localized month: ru `Окт`) |
| numbers `1,234,567` (OgameX) | `1.234.567`, decimal `,` |

## 9. Open questions (need real pages)

1. A real **combat summary** and `page=raport`: same `raportMessage`/`reportSteal` markup, popup layout, defender `()` bug, text-only report? Any added ids or JS data? Battle-hall pages.
2. Real **expedition** results/returns: stock 2Moons texts (the dictionary depends on it)? Amounts in the result?
3. Real **transport / recycle / deploy / return** texts; any harvest details.
4. The live `message.js` was not saved. Is the category-0 list on `page=messages` rendered by the server (fork change) or by the user's click? Same view URL and `#messagestable` replacement?
5. `MESSAGES_PER_PAGE` (10 upstream) and whether `spyMessagesMode` is a user option.
6. A spy report with defence/buildings/research and one with destroyed probes (heads, nesting of odd sections).
7. Wording of "spy detected"; is a counter-espionage % added?
8. A ru account: bodies/senders in Russian? (stored in the recipient's language at send time.)
9. Response of `POST mode=action` on the fork.
