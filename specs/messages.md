# OgameX messages: spec for content scripts

Scope: the `/messages` page, its tabs and subtabs, the AJAX endpoints that return message lists and single messages, message deletion, and the HTML of every report type: espionage, combat, expedition, transport, return, harvest, colonisation and missile. Each section gives selectors, URLs, response shapes and copy-ready parsing recipes, with the source `file:line` they come from.

Paths are relative to the OgameX checkout `src/OGameX/`. Short names used below:

| Short | File |
|---|---|
| `ctl` | `app/Http/Controllers/MessagesController.php` |
| `svc` | `app/Services/MessageService.php` |
| `fac` | `app/Factories/GameMessageFactory.php` |
| `gm` | `app/GameMessages/Abstracts/GameMessage.php` |
| `egm` | `app/GameMessages/Abstracts/ExpeditionGameMessage.php` |
| `index` | `resources/views/ingame/messages/index.blade.php` |
| `ftab` / `fsub` | `resources/views/ingame/messages/tabs/fleets/tab.blade.php` / `subtab.blade.php` |
| `dsub` | `resources/views/ingame/messages/tabs/default/subtab.blade.php` |
| `ctab` | `resources/views/ingame/messages/tabs/communication/tab.blade.php` |
| `detail` | `resources/views/ingame/messages/message.blade.php` |
| `esp` / `espf` | `resources/views/ingame/messages/templates/espionage_report.blade.php` / `espionage_report_full.blade.php` |
| `br` / `brf` | `resources/views/ingame/messages/templates/battle_report.blade.php` / `battle_report_full.blade.php` |
| `msgjs` | `resources/js/ingame/messages.js` (bundled by Vite, `vite.config.js:16`) |
| `lang` | `resources/lang/en/t_messages.php` |

## Fixtures

All fixtures live in `ogx/fixtures/`. `ogx/tools/blade/gen_messages_fixtures.php` renders them from the real Blade templates; it reuses the Blade mini-compiler in `tools/blade/blade.php` and adds `@forelse` support. The `GameMessage` logic is ported line by line: subject and body building, `replacePlaceholders`, number formatting, and the expedition, missile, espionage and battle overrides. The sample data is made up: me = *Commander Vega* (id 108) with Homeworld id 1 [1:42:8] + Moon id 5, and Colony id 3 [2:118:12]; also Lieutenant Nusakan (Arrakeen [1:45:9] + moon), Hagen [1:39:4] and Admiral Rigel (Kronos [1:42:11]). "Now" is 2026-10-30 00:57:17 UTC, the same as the layout fixtures. URLs use the origin `http://localhost`.

| Fixture | Exact body of |
|---|---|
| `messages-page.html` | `GET /messages`: the full layout. The tab panels are **empty**, exactly as the server sends them (section 2). |
| `messages-page-loaded-espionage.html` | DOM snapshot **after** the game JS ran jQuery UI tabs. It is `messages-page.html` with the two real AJAX bodies below inserted into `#ui-id-2` and `#ui-id-14`. Nothing else is changed. Use it to test content scripts that run on a live `/messages` page. |
| `messages-ajax-tab-fleets.html` | `GET /ajax/messages?tab=fleets` (subtab bar with unread counts) |
| `messages-ajax-tab-communication.html` | `GET /ajax/messages?tab=communication`. It contains **static demo messages** (section 3.3). |
| `messages-ajax-tab-economy.html` | `GET /ajax/messages?tab=economy`: **0 bytes** (section 3.3) |
| `messages-ajax-fleets-espionage.html` | `GET /ajax/messages?tab=fleets&subtab=espionage`: 3 espionage reports (planet, moon, planet with debris) and 1 "espionage detected" |
| `messages-ajax-fleets-combat_reports.html` | `…&subtab=combat_reports`: 3 battle reports (my attack won, attacked and lost, expedition pirates), fleet lost contact, missile attack and missile defence |
| `messages-ajax-fleets-expeditions.html` / `…-page2.html` | `…&subtab=expeditions` and `…&subtab=expeditions&pagination=2`: 11 expedition results, one of each outcome, split into pages of 10 |
| `messages-ajax-fleets-transport.html` | `…&subtab=transport`: transport arrived, ACS union invite |
| `messages-ajax-fleets-other.html` | `…&subtab=other`: return with and without resources, deployment with and without resources, transport received, debris harvest, ACS defend arrival |
| `messages-ajax-economy-economy.html` | `GET /ajax/messages?tab=economy&subtab=economy`: colony established, colonisation failed (astrophysics), wreck field repaired |
| `messages-ajax-universe-universe.html` | `…tab=universe&subtab=universe`: the welcome message |
| `messages-ajax-system-system.html` | `…tab=system&subtab=system`: an empty list ("no messages") |
| `messages-ajax-message-2051-espionage-full.html` | `GET /ajax/messages/2051?tab=fleets&subtab=espionage`: full report with all 4 sections |
| `messages-ajax-message-2044-espionage-moon-partial.html` | Full report on a **moon**, ships section only |
| `messages-ajax-message-2038-espionage-debris.html` | Full report with a debris-field section, ships + defence |
| `messages-ajax-message-2053-battle-attacker-win.html` | Full combat report, me as the winning attacker |
| `messages-ajax-message-2050-battle-defender-loss.html` | Full combat report, me as the losing defender |
| `messages-ajax-message-2034-battle-expedition-pirates.html` | Full combat report of an expedition battle (attacker "Pirates", "Deep space") |
| `messages-ajax-message-2054-expedition-resources.html` | Full view of a non-report message (the body is the same as in the list) |
| `messages-post-delete-2047.json` | `POST /messages` `messageId=2047&action=103` → `{"2047":true}` |
| `messages-expedition-texts.json` | Classification data, **not a server response**: every expedition body variation for en/fr/zh-TW, plus the outcome per key (section 7) |
| `messages-object-titles.json` | id ↔ machine_name ↔ English title for all units, buildings and research, parsed from `app/GameObjects/*.php` |
| `messages-expected-parse.json` | Output of the recipes in `ogx/tools/messages_recipes.js` on the fixtures. `node ogx/tools/check_messages.js` checks it with Playwright. |

`ogx/tools/messages_recipes.js` is the tested reference implementation of every recipe in this document (`window.OGXMsgRecipes`). Copy functions from it rather than retyping the snippets below.

---

## 1. Endpoints

| Method + URL | Params | Returns | Source |
|---|---|---|---|
| `GET /messages` | `tab` (default `fleets`), `subtab` (default `espionage`), `pagination` (default 1) | Full HTML page, `body#messages`. **Panels are empty.** The params are used only for a server-side query whose result is thrown away (see below). | `routes/web.php:164`, ctl:19-45 |
| `GET /ajax/messages` | `tab` (default `fleets`); `subtab` (default empty); `pagination` (int, default 1) | HTML fragment. **No subtab** → the tab template (subtab bar). **With subtab** → the message list of that subtab, 10 per page. | `routes/web.php:168`, ctl:132-145 |
| `GET /ajax/messages/{messageId}` | `tab`, `subtab` (optional; used for the prev/next ids; if missing, taken from the message) | HTML fragment: pagination + `div.detail_msg` holding the **full** body (`getBodyFull()`) | `routes/web.php:170`, ctl:155-169, svc:312-373 |
| `POST /messages` | `messageId`, `action` (`103` = delete; anything else = no-op), `ajax=1` (ignored); CSRF token required | JSON `{"<messageId>": true}`, **always true**, even when nothing was deleted | `routes/web.php:166`, ctl:178-191, svc:297-302 |

Facts that matter for scripts:

- **Reading marks messages as read.** `getMessagesForTab()` sets `viewed=1` on every message of the page it returns (svc:208-212). `ajaxGetMessage` marks that one message (svc:356-358). `GET /messages` itself marks the first espionage page read (ctl:39 → `tabContent` → `subTabContent`). So does `GET /ajax/messages?tab=fleets` without a subtab (ctl:58 always runs `subTabContent` with the first subtab, svc:189-191). A background scanner therefore clears the player's "new" markers. That is acceptable, but warn the user, or only scan when the user opens `/messages`.
- `li.msg_new` = the message was unread **before** this request. The flag is read from a clone taken before `viewed` is set (gm:55, svc:204-212).
- Order: `created_at DESC`, 10 per page. Laravel's `paginate(10, ['*'], 'page', $page)` is used, but the request parameter is **`pagination`**, not `page` (ctl:37,136, svc:197-200). A page past the end returns an empty list showing `n/n`.
- Unknown `tab` with an empty `subtab` → PHP "undefined index" → HTTP 500 (svc:190). Unknown `subtab` → empty list. A message id that does not exist or belongs to someone else → `RuntimeException` → HTTP 500 (svc:319-321). Treat any non-2xx as "missing".
- CSRF: send `X-CSRF-TOKEN: <meta[name=csrf-token]>`. The layout sets it for all jQuery AJAX (layout spec §7). Use `credentials: 'same-origin'`.
- There is **no JSON API for messages** and no `data-raw-*` API (section 5.4). Everything is HTML.

Delete recipe:

```js
async function deleteMessage(id) {
  const token = document.querySelector('meta[name="csrf-token"]').content;
  const r = await fetch('/messages', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest',
               'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' },
    body: new URLSearchParams({ messageId: String(id), action: '103', ajax: '1' }),
  });
  return r.ok && (await r.json())[String(id)] === true;   // true even if the id did not exist
}
```

Fetching a list:

```js
async function fetchSubtab(tab, subtab, page = 1) {
  const u = `/ajax/messages?tab=${tab}&subtab=${subtab}` + (page > 1 ? `&pagination=${page}` : '');
  const r = await fetch(u, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new DOMParser().parseFromString(await r.text(), 'text/html');   // never inject: it has <script>s
}
```

Differences from official OGame: official uses `index.php?page=messages&tab=20` with numeric tab ids, `page=messages&ajax=1` POSTs with actions 101-105/121, and `data-raw-*` JSON on each message. OgameX uses string keys in clean URLs and supports only action 103. Favourite (101/102), trash and restore (104/105) are wired in `msgjs` (lines 442-630) but do nothing on the server: the response lacks `result`, so the game shows an error box.

## 2. `/messages` page (index)

`body#messages` (ctl:21). The layout is the common one (see `specs/layout.md`). The content is `#content > #buttonz` (index:11-139):

```
#buttonz > .header > h2                                  "News feed" (t_ingame.messages.news_feed)
#buttonz > .content > div.js_tabs.tabs_wrap.ui-tabs
   ul.tabs_btn > li.list_item#tabs-nf<Name>[data-tabid][aria-controls]   (index:20-111)
        > a.tabs_btn_img.tb_<name>[href=rel=/ajax/messages?tab=<name>]
             > span.new_msg_count (only if unread > 0) + img + .marker + span.icon_caption
   div#ui-id-2 … #ui-id-12 .ui-tabs-panel                 EMPTY on load (index:113-130)
   .ajax_load_shadow                                       loading spinner
```

| Tab li id | `data-tabid` | `tab=` key | Panel (`aria-controls`) | Server template |
|---|---|---|---|---|
| `tabs-nfFleets` (active) | 2 | `fleets` | `#ui-id-2` | ftab |
| `tabs-nfCommunication` | 1 | `communication` | `#ui-id-4` | ctab |
| `tabs-nfEconomy` | 3 | `economy` | `#ui-id-6` | default/tab.blade.php (**empty file**) |
| `tabs-nfUniverse` | 5 | `universe` | `#ui-id-8` | same, empty |
| `tabs-nfSystem` | 4 | `system` | `#ui-id-10` | same, empty |
| `tabs-nfFavorites` | 6 | `favorites` | `#ui-id-12` | same, empty |

- **Unread per tab:** `#tabs-nfFleets .new_msg_count` (absent when 0). The total is in the layout: `a.comm_menu.messages .new_msg_count[data-new-messages]` (main:332-341). The total is counted **after** the first espionage page was marked read, so it can be lower than the sum of the tabs (the fixture shows 8 on the fleets tab and 6 in the menu).
- Loading flow: the inline script calls `ogame.messages.initMessages(...)` (index:462). This runs jQuery UI `.tabs()` on `.js_tabs` (msgjs:431-438, 781-796). jQuery UI GETs the active tab's `href` into its `aria-controls` panel. The `load` callback calls `initTabFleets`, which runs `.tabs()` on `.js_subtabs_fleets` (msgjs:304-306, 397-402, 778-780). That loads the active subtab's href into `#ui-id-14`. Panel ids come from the markup's `aria-controls`, so they are stable.
- **Content-script hook:** observe `#ui-id-2` (fleets tab) with a `MutationObserver({childList: true, subtree: true})`. Process every `li.msg[data-msg-id]` you have not seen yet. Subtab panels: `#ui-id-14` espionage, `#ui-id-16` combat, `#ui-id-18` expeditions, `#ui-id-20` transport, `#ui-id-22` other (ftab:100-117). Pagination replaces the panel's whole content (msgjs:631-670).
- The active subtab is `.js_subtabs_fleets li.ui-tabs-active[data-tabid]` (20-24), or `ogame.messages.getCurrentMessageTab()` (msgjs:678-684).
- **Inline JS variables** on the page (index:299-465): `localizedBBCode`, `itemNames` (item hash → name), `loca`. No message data is embedded.

## 3. Tabs, subtabs, keys

### 3.1 Tab and subtab structure (svc:30-54; ftab; ctab)

| tab | subtab key | fleets subtab li | `data-tabid` | `data-subtabname` | Panel | Message keys (`fac` + each class's `initialize()`) |
|---|---|---|---|---|---|---|
| fleets | `espionage` | `#subtabs-nfFleet20` | 20 | Espionage | `#ui-id-14` | `espionage_report`, `espionage_detected` |
| fleets | `combat_reports` | `#subtabs-nfFleet21` | 21 | Combat Reports | `#ui-id-16` | `battle_report`, `fleet_lost_contact`, `missile_attack_report`, `missile_defense_report`, `moon_destruction_success`, `moon_destruction_failure`, `moon_destruction_catastrophic`, `moon_destruction_mission_failed`, `moon_destruction_repelled`, `moon_destroyed` |
| fleets | `expeditions` | `#subtabs-nfFleet22` | 22 | Expeditions | `#ui-id-18` | all `expedition_*` (egm:15-21) |
| fleets | `transport` | `#subtabs-nfFleet23` | 23 | Unions/Transport | `#ui-id-20` | `transport_arrived`, `fleet_union_invite` |
| fleets | `other` | `#subtabs-nfFleet24` | 24 | Other | `#ui-id-22` | `return_of_fleet`, `return_of_fleet_with_resources`, `fleet_deployment`, `fleet_deployment_with_resources`, `transport_received`, `debris_field_harvest`, `acs_defend_arrival_sender`, `acs_defend_arrival_host` |
| communication | `messages` | `#subtabs-nfCommunication10` | 10 | Messages | `#ui-id-32` | `alliance_broadcast` |
| communication | `information` | `#subtabs-nfCommunication14` | 14 | Information | `#ui-id-34` | `buddy_request_received`, `buddy_request_accepted`, `buddy_removed`, `alliance_application_received` |
| economy | `economy` | — | — | — | — | `colony_established`, `colony_establish_fail_astrophysics`, `planet_relocation_success`, `wreck_field_repair_completed` |
| universe | `universe` | — | — | — | — | `welcome_message` |
| system | `system` | — | — | — | — | (none) |
| favorites | `favorites` | — | — | — | — | (none; favourites are not implemented) |

`data-subtabname` is hard-coded English. The visible labels come from `t_ingame.messages.subtab_*`. Communication subtabs 12, 11 and 13 (shared combat/espionage reports, expeditions) have `href="#"` and no content (ctab:31-58). `app/GameMessages/Alliance*` classes with tab `alliance` (for example `AllianceApplicationAccepted`) are **not** registered in `fac:64-124`, so they never appear.

### 3.2 Subtab list response (fsub:1-80 for fleets, dsub:1-70 for the others)

```
div#fleetsgenericpage > div#messagecontainercomponent > ul.tab_inner.clearfix      (fsub; dsub uses div#defaultmessagespage > div.tab_ctn > ul.tab_inner)
   ul.pagination > li.paginator[data-tab="20"][data-page]  ×4  +  li.curPage "N/M"   (top; repeated at the bottom)
   input[name=token][value=d99f68937305e0b2c3ff3f059259fcec]                          (constant dummy)
   li.no_msg  "There are currently no messages available in this tab"                (only when empty)
   li.msg[.msg_new][data-msg-id=ID]                                                   (one per message)
      div.msg_status
      div.msg_head
         span.msg_title.(blue_txt|middlemark)    subject, RAW HTML in fleets (fsub:160-164), ESCAPED text in dsub:237
         span.fright > a.fright > span.icon_nf.icon_refuse.js_actionKill   (delete)
                     + span.msg_date.fright  "dd.mm.YYYY HH:MM:SS"
         br + span.msg_sender_label "From:" + span.msg_sender  (static per key: lang `<key>.from`)
      span.msg_content            getBody() raw HTML
      message-footer.msg_actions > message-footer-actions (getFooterActions(), empty except buddy requests)
                                 > message-footer-details (getFooterDetails(): "More details" link for espionage/battle)
      script  initOverlays();
   include subtab-init-js (clears the unread counters in the tab bar)
```

- `data-tab` on paginators is **hard-coded** (20 in fsub:139-198, 3 in dsub). The JS reads the active subtab's `href`, appends `&pagination=N` and GETs it (msgjs:631-670).
- `span.msg_title` class: `middlemark` for every combat_reports message except `fleet_lost_contact`; `blue_txt` for everything else (fsub:160-164).
- Date: `created_at->format('d.m.Y H:i:s')` in `APP_TIMEZONE` (default UTC) (gm:101-108). Recipe: `Date.UTC(Y, m-1, d, H, i, s)`.
- **The message key is not in the markup.** There is no `data-message-type` and no key class. Classify by subtab plus structure or text (section 3.4).
- Stable attributes to rely on: `li.msg[data-msg-id]`, `.msg_new`, `.msg_title`, `.msg_date`, `.msg_sender`, `.msg_content`, `message-footer-details a.overlay[href]` (contains `/ajax/messages/<id>?tab=…&subtab=…`, gm:204-209), the `a.txt_link[href^=…/galaxy?]` place links, and the paginator `li.curPage` text.

### 3.3 Traps

- `GET /ajax/messages?tab=economy|universe|system|favorites` with no subtab returns **an empty body**, because `tabs/default/tab.blade.php` is a 0-byte file (ctl:83-89). The game UI therefore shows nothing in those tabs. Scripts must **always pass `subtab=<same key>`**: `tab=economy&subtab=economy`.
- `GET /ajax/messages?tab=communication` (ctab) contains **hard-coded demo messages** with fake ids (`data-msg-id="4543048"`, `4542257`, `4269146`; ctab:604-700). Ignore all `li.msg` outside a subtab response. Real data: `tab=communication&subtab=messages|information`.
- Duplicate ids: every subtab response contains `#fleetsgenericpage`/`#messagecontainercomponent`, and jQuery UI keeps old panels. Scope queries to the panel.

### 3.4 Key catalogue: params, subject, body, how to recognise

Placeholders in params are rendered by `replacePlaceholders` (gm:294-373):

| Param value | Rendered HTML | Parse with |
|---|---|---|
| `[planet]ID[/planet]` (planet) | `<a href="…/galaxy?galaxy=G&system=S&position=P" class="txt_link"><img src="…/img/planets/medium/<biome>_<n>.png" width="16" height="16" class="tooltip js_hideTipOnMobile" title="Planet"> NAME [G:S:P]</a>` | `parsePlaceLink(a)` → `{coords, type:'planet', planetType:1, name}` |
| `[planet]ID[/planet]` (moon) | same, but `<figure class="planetIcon moon tooltip js_hideTipOnMobile" title="Moon"></figure>` instead of the img | `type:'moon', planetType:3` |
| `[coordinates]G:S:P[/coordinates]` | `<a … class="txt_link">⏎<figure class="planetIcon planet …" title="Planet"></figure>⏎ [G:S:P]</a>` | `type:'coordinates'` (no name, owner unknown) |
| `[debrisfield]G:S:P[/debrisfield]` | `<a …>⏎<figure class="planetIcon tf …" title="Planet"></figure>⏎ debris field [G:S:P]</a>` | `type:'debris'` |
| `[player]ID[/player]` | plain username | text |

The planet name inside a link can contain anything. Take the coordinates with `/\[(\d+):(\d+):(\d+)\]/` from the **end** of the link text. Resource params (`metal`, `crystal`, `deuterium`, `harvested_*`, `storage_capacity`, `ship_amount`, `resource_amount`) are formatted with `number_format(n, 0, ',', ',')`, so `12,500` (gm:266-286). Bodies pass through `nl2br`, so they contain `<br />` + newline. `return_of_fleet*` `from`/`to` params are prefixed with the untranslated literal word `planet ` (`GameMission.php:629-640`).

| key | tab/subtab | sender (`.msg_sender`, en) | subject (en) | body (en, `lang` line) | Sent by |
|---|---|---|---|---|---|
| `espionage_report` | fleets/espionage | Fleet Command | `Espionage report from <planet link>` | template esp (section 4) | EspionageMission.php:207 |
| `espionage_detected` | fleets/espionage | Fleet Command | `Espionage report from Planet <attacker planet link>` | `A foreign fleet from planet <link> (NAME) was sighted near your planet<br />⏎<my planet link><br />⏎Chance of counter-espionage: N%` (lang:121-125) | EspionageMission.php:188-204 |
| `battle_report` | fleets/combat_reports | Fleet Command | `Combat report <defender planet link>` | template br (section 5) | Attack/Expedition/Espionage/MoonDestruction missions |
| `fleet_lost_contact` | fleets/combat_reports | Fleet Command | `Contact with the attacking fleet has been lost. <[coordinates] link>` | `(That means it was destroyed in the first round.)` | AttackMission.php:181,243,452 |
| `missile_attack_report` | fleets/combat_reports | Fleet Command | `Missile attack on G:S:P` (plain text) | **hard-coded English** (MissileAttackReport.php:36-111): `N missile(s) from your planet <link> smashed into the planet <link>!<br><br>[<b>Missiles Intercepted:</b> X<br><br>]<b>Defenses Hit</b><br>` + per defence `<span style="display:inline-block;min-width:200px;">NAME</span>AFTER(-DESTROYED)<br>` or `None<br>` | MissileMission.php:445 |
| `missile_defense_report` | fleets/combat_reports | Defense Command | `Missile attack on G:S:P` | hard-coded English (MissileDefenseReport.php:33-93): `Your planet <link> has been attacked by interplanetary missiles from <b>NAME</b>!<br><br><b>Incoming Missiles:</b> N<br>[<b>Missiles Intercepted:</b> X<br>]<br><b>Defenses Hit</b><br>…` | MissileMission.php:453 |
| `moon_destruction_*`, `moon_destroyed` | fleets/combat_reports | Fleet Command / Space Monitoring | lang:441-482 (placeholder texts) | `…destruction probability of X and a Deathstar loss probability of Y…` | MoonDestructionMission.php |
| `expedition_*` | fleets/expeditions | Fleet Command | `Expedition Result` (all of them) | section 7 | ExpeditionMission.php |
| `transport_arrived` | fleets/transport | Fleet Command | `Reaching a planet` | `Your fleet from <link> reaches <link> and delivers its goods:<br />⏎Metal: M Crystal: C Deuterium: D` (lang:71-76) | TransportMission.php:85 |
| `fleet_union_invite` | fleets/transport | Fleet Command (the `getFrom()` override falls back) | `Invitation to alliance combat` | `SENDER invited you to mission UNION against PLAYER on [G:S:P], the fleet has been timed for d.m.Y H:i:s.` … (lang:423-431) | FleetController.php:990 |
| `return_of_fleet_with_resources` | fleets/other | Fleet Command | `Return of a fleet` | `Your fleet is returning from planet <link> to planet <link> and delivered its goods:<br />⏎<br />⏎Metal: M<br />⏎Crystal: C<br />⏎Deuterium: D` (lang:33-41) | GameMission.php:655 |
| `return_of_fleet` | fleets/other | Fleet Command | `Return of a fleet` | `Your fleet is returning from <from> to planet <link>.<br />⏎<br />⏎The fleet doesn't deliver goods.` (`from` = planet link, `[coordinates]` for expeditions (pos 16), or `[debrisfield]`) | GameMission.php:662 |
| `fleet_deployment_with_resources` | fleets/other | Fleet Command | `Return of a fleet` | `One of your fleets from <link> has reached <link> and delivered its goods:` + Metal/Crystal/Deuterium lines. **Deuterium includes half of the flight fuel** (DeploymentMission.php:97) | DeploymentMission.php:92 |
| `fleet_deployment` | fleets/other | Fleet Command | `Return of a fleet` | `One of your fleets from <link> has reached <link>. The fleet doesn`t deliver goods.` | DeploymentMission.php:100 |
| `transport_received` | fleets/other | Fleet Command | `Incoming fleet` | `An incoming fleet from <link> has reached your planet <link> and delivered its goods:<br />⏎Metal: M Crystal: C Deuterium: D` (sent only when the sender is another player) | TransportMission.php:95 |
| `debris_field_harvest` | fleets/other | Fleet | `Harvesting report from DF on <[coordinates] link>` | `Your SHIP (N ships) have a total storage capacity of CAP. At the target <[debrisfield] link>, M Metal, C Crystal and D Deuterium are floating in space. You have harvested HM Metal, HC Crystal and HD Deuterium.` (lang:141-145). Also sent after a battle when **Reapers** auto-collect. | RecycleMission.php:135, AttackMission.php:474,496 |
| `acs_defend_arrival_sender` / `_host` | fleets/other | Fleet Command / Space Monitoring | `Fleet is stopping` | `A fleet has arrived at <link>.` | FleetMissionService.php:636-643 |
| `colony_established` | economy | Fleet Command | `Settlement Report` | `The fleet has arrived at the assigned coordinates G:S:P, found a new planet there…` (plain coords, no link) | ColonisationMission.php:120 |
| `colony_establish_fail_astrophysics` | economy | Settlers | `Settlement Report` | `…coordinates G:S:P and ascertains… knowledge of astrophysics is not sufficient…` | ColonisationMission.php:108 |
| `planet_relocation_success` | economy | Manage colonies | `NAME`s relocation has been successful` | `…relocated from the coordinates <link> to <link>.` | PlanetMoveService.php:237 |
| `wreck_field_repair_completed` | economy | System Message | `Repair completed` | `Your repair request on planet <link> has been completed.<br />⏎N ships have been put back into service.` | CleanupWreckFields.php:113 |
| `welcome_message` | universe | OGameX | `Welcome to OGameX!` | long text (lang:5-30) | MessageService.php:173-176 |
| `buddy_*`, `alliance_*` | communication/information or messages | Buddies / Alliance Management / sender | lang:346-413 | footer of `buddy_request_received`: `button.acceptRequest[data-buddyid]`, `button.rejectRequest[data-buddyid]` | |

**Classification recipe** (`classify(li, subtab, expIndex)` in messages_recipes.js):

- espionage: `li.querySelector('.msg_content .compacting')` → `espionage_report`, else `espionage_detected`. This does not depend on the language.
- combat_reports: `.msg_content .combatInfo` → `battle_report`. Body `^\d+ missiles? from your planet ` → `missile_attack_report`. `^Your planet … has been attacked by interplanetary missiles` → `missile_defense_report`; both are hard-coded English in PHP, so they work in every locale. `.msg_title.blue_txt` → `fleet_lost_contact`. Otherwise moon destruction: tell them apart by subject text.
- expeditions: section 7.
- transport, other, economy, universe: English body regexes, listed in the recipe file. These bodies are localised (`resources/lang/{fr,zh-TW}/t_messages.php`; `nl` has only a few keys and falls back to `en`, and `it` has none). For non-en servers, build the same regexes from that locale's lang strings. Language-independent signals: the number of place links (`a.txt_link`), the `planetIcon.tf` figure (harvest), and `.msg_sender` together with the subtab.

## 4. Espionage report

### 4.1 In the list (esp:1-56, inside `li.msg .msg_content`)

```
div.compacting: span.ctn.ctn4 "Player:" + span.status_abbr_active "&nbsp;&nbsp;NAME" + span.ctn.ctn4.fright "Activity: >60 minutes ago."   ← activity is STATIC
div.compacting: "Class:" Unknown                                    ← STATIC
div.compacting: "Alliance Class:" span.alliance_class "No alliance class selected"   ← STATIC
div.compacting > span.ctn.ctn4 > span.resspan ×3   "Metal: 1.468Mn" | "Crystal: 500,451" | "Deuterium: 65,266"   (formatNumberLong: LOSSY ≥ 1Mn)
               + span.ctn.ctn4.fright.tooltipRight.tooltipClose "Resources: 2,037,116"  = metal+crystal+deuterium+ENERGY, exact
                     (its title="Loot: 352,927 … S.Cargo: 51 … L.Cargo: 11" is a STATIC placeholder, esp:40)
div.compacting: span "Loot: 75%"  ← STATIC (esp:45)  + span.fright "Chance of counter-espionage: N%"  ← real
div.compacting: "Fleets: 0"  /  "Defense: 0" (title="693,000")  ← STATIC (esp:51-53)
```

- Target: `li .msg_title a.txt_link` (the subject is built from `[planet]id[/planet]`, EspionageReport.php:54-68). Coordinates come from the link text. Moon ⇔ `figure.planetIcon.moon`. If the target no longer exists, the subject uses a `[coordinates]` link and the **body** is the plain text `Planet has been deleted and espionage report is no longer available.` (EspionageReport.php:81-83).
- Footer: `message-footer-details a.msg_action_link.overlay[href="…/ajax/messages/ID?tab=fleets&subtab=espionage"]` "More details".
- Only these are real in the list view: player name, the 3 resources (approximate), the total including energy (exact), and the counter-espionage %. **Fleets, defence, loot and activity are placeholders.** For a spy table, fetch the full report.

### 4.2 Full report: `GET /ajax/messages/{id}` (detail + espf)

```
ul.pagination > li.p_li > a.msg_action_link[data-messageid][data-tab][data-subtab]   first/prev/"i/n"/next/last (detail:330-365)
div.detail_msg[data-msg-id=ID][data-message-type="10"]          (data-message-type is constant, detail:367)
  div.detail_msg_head
     span.msg_title.new.blue_txt   = subject (target link, see 4.1)
     span.msg_date.fright
     div.msg_actions
        span.icon_apikey[title=…'sr-en-256-265b38…']           STATIC fake API key (espf:13-14)
        a[href="#TODOpage=shareReportOverlay&messageId=1645218"] STATIC
        a.icon_nf_link[href="…/fleet?galaxy=G&amp;system=S&amp;position=P&amp;type=T&amp;mission=1"] > span.icon_attack   ← REAL target + type (espf:24)
        a[onClick="sendShipsWithPopup(6,1,4,10,1,0)"]          STATIC (wrong coords; do not use) (espf:28)
        span.js_actionKillDetail                                 delete
  div.detail_msg_ctn
     div.detail_txt > span "Player" span.status_abbr_active NAME
     div.detail_txt  Class / Alliance class (static)
     div.detail_txt  "Chance of counter-espionage: N%" + div "…no activity…" (static text, espf:50-55)
     .section_title "Resources"  + ul.detail_list[data-type=resources] > li.resource_list_el[title="1,468,279"] > div.resourceIcon.(metal|crystal|deuterium|energy) + span.res_value (formatNumberLong)
     [if debris>0] .section_title "debris field" + ul.detail_list[data-type=resources] (metal/crystal/deuterium)  (espf:91-111)
     .section_title "Fleets"   + ul.detail_list[data-type=ships]     > li.detail_list_el > div.shipImage > img.tech<ID>      + span.detail_list_txt NAME + span.fright AMOUNT
     .section_title "Defense"  + ul.detail_list[data-type=defense]   > li.detail_list_el > div.defense_image > img.defense<ID>
     .section_title "Building" + ul.detail_list[data-type=buildings] > li.detail_list_el > div.building_image > img.building<ID>  (level)
     .section_title "Research" + ul.detail_list[data-type=research]  > li.detail_list_el > div.research_image > img.research<ID>  (level)
     (an empty list contains only the text "We were unable to retrieve any reliable information of this type from the scan.")
```

- Use the `title` attribute of `li.resource_list_el` for **exact** values (`getFormattedFull`, espf:62-76). `span.res_value` is lossy.
- The second `ul[data-type=resources]` (when present) is the **debris field** at the target position. Energy is in the first list (can be negative).
- Ids: the numeric suffix of `img.tech|defense|building|research<ID>` (OGame ids, see `specs/objects.jsonl`). Defence includes missiles (502, 503). Buildings include station buildings (14, 15, 21, 31, 33, 34, 36, 41-44). Only non-zero entries are listed (PlanetService.php:961-1009, PlayerService.php:810-821).
- **Revealed but empty and not revealed render the same.** `null` (not revealed) and `[]` (nothing there) both produce the "unable to retrieve" text (EspionageMission.php:508-525). Reveal thresholds are monotone: ships(2) < defense(3) < buildings(5) < research(7) probes, with the level-difference rule in `canRevealData`. So an empty section is a confirmed **zero** if any later section has entries. Otherwise it is unknown. Recipe: `known.ships = ships.shown || defense.shown || buildings.shown || research.shown`, and so on (`parseEspionageFull`).
- Target type for raids: `type` from the attack link (1 planet, 3 moon), or the `figure.moon` in the subject.
- The loot that is actually possible is 50%, or 75% for an attacker of the Discoverer class against any target (knowledge base). The "Loot: 75%" in the list is a placeholder.
- Missing in OgameX (present in official OGame): activity minutes, player and alliance class, honour/status, the API key (the shown one is fake), the loot and cargo tooltip, and the fleet/defence value.

Recipe output for 2051 (from `messages-expected-parse.json`):

```json
{"id":2051,"target":{"coords":[1,45,9],"type":"planet","planetType":1,"name":"Arrakeen"},
 "attackParams":{"galaxy":1,"system":45,"position":9,"type":1},"player":"Lieutenant Nusakan","counterEspionage":4,
 "resources":{"metal":1468279,"crystal":500451,"deuterium":65266,"energy":3120},"debris":{"metal":0,"crystal":0,"deuterium":0},
 "ships":{"202":40,"203":12,"204":120,"206":14,"210":9,"212":25},"defense":{"401":150,"402":80,"403":12,"404":4,"407":1,"502":6},
 "buildings":{"1":24,"2":20,…},"research":{"106":8,…},"known":{"research":true,"buildings":true,"defense":true,"ships":true}}
```

### 4.3 Espionage detected (incoming probes)

Same subtab, `li.msg` without `.compacting`. Body: two place links (first = spying planet, second = my planet), then the spy's name in parentheses after the first link (`/\]\s*\((.*?)\)/` on the text), then `N%` at the end. Source: lang:121-125, EspionageMission.php:188-204. Useful as an activity signal for "stalk" tracking.

## 5. Combat report

### 5.1 In the list (br:1-26)

```
div.rawMessageData[data-raw-*]   ← STATIC sample from official OGame (coords 7:257:9, "Lieutenant Nusakan", …). NEVER parse it. (br:1-11)
div.combatInfo
  div.basicInfo
    span.msg_ctn.msg_ctn2.(undermark|overmark|middlemark).tooltipLeft[data-tooltip-title="12,000" STATIC]  "Attacker: (NAME): LOSSES"   (formatNumberLong)
    span.msg_ctn.msg_ctn3   "Resources: 107K, Loot: 50%"     (loot sum formatNumberShort = LOSSY; percentage exact)
    span.msg_ctn.msg_ctn3.tooltipLeft[data-tooltip-title=DEBRIS]   "Debris field (newly created): 3,600"   (formatNumberLong)
  div.miscInfo
    span.msg_ctn.msg_ctn2.(class).tooltipRight[data-tooltip-title="10,210,000" STATIC]   "Defender: (NAME): LOSSES"
    span.msg_ctn.msg_ctn3 "Actually repaired: N"            (N = repaired defence units)
    [only if the target had no moon] span.msg_ctn.msg_ctn3 "Moon Chance: N%"
```

- **Winner:** the class of the attacker span: `undermark` = attacker won, `middlemark` = draw, `overmark` = defender won (BattleReport.php:395-429). The defender span has the mirrored class. The rule is based on the last round's surviving units; with no rounds at all, the attacker wins.
- The subject `Combat report <defender planet link>` has a `[coordinates]` link if the planet was deleted (BattleReport.php:58-72). The title class is `middlemark`, whoever won.
- **My role:** compare the names in the brackets with my username (`meta[name=ogame-player-name]`, layout spec §9.2). Expedition battles: the attacker is `Pirates` or `Aliens` (player id −1/−2), the defender is me, and the defender planet is **my origin planet**, not position 16 (ExpeditionMission.php:833-913). Each expedition battle also sends an `expedition_battle_pirates|aliens` message with the same timestamp in the expeditions subtab.
- Losses are in **resource units** (metal + crystal + deuterium of the destroyed units). `formatNumberLong` is exact below 1 Mn and has 3 decimals above (`1.469Mn`).

### 5.2 Full report (brf)

```
div.detail_msg[data-msg-id] > div#messagedetails
  div.detail_msg_head
     span.msg_title > span.middlemark  "Combat Report NAME <figure class=planetIcon planet> <a href=…/galaxy?…>[G:S:P]</a>"  (figure is always "planet")
     span.msg_date.fright
     message-footer: favourite, API key ('cr-en-255-…'), share (gameforge URL), attack (gameforge URL),
                     espionage (sendShipsWithPopup(6,2,3,11,…)), delete — ALL buttons STATIC sample data (brf:18-71)
  div.rawMessageData[data-raw-*]   STATIC (brf:74-80)
  div.messageDetails > div.detailReport[data-combatreportid="8196210" STATIC]
     p.detail_txt "Tactical retreat: 1:R" + span.icon_info "The defending fleet did not flee." / "…has fled… Deuterium cost: X"
     ul.combat_round_list > li.round_id[data-round=0..n]          → number of rounds = count − 1
     div.resourcedisplay.loot > ul.detail_list > li.resource_list_el_small > div.resourceIconSmall.(metal|crystal|deuterium)
                                   + span.res_value[data-tooltip-title=formatNumberLong] formatNumberShort
     div.resourcedisplay.tf  > .section_title "Debris (new): SUM => N Recycler" + ul (metal/crystal/deuterium, formatNumberLong)
                             [if Reapers collected] "Mined after combat: … => N Reaper" + 2 ul (attacker, defender) + "Debris fields (left): … => N Recycler"
     div.fightdetails  "Honour points … -0 … +0"  STATIC
     [moon created] div.og_video > video[src$="video/messages/moon-created.mp4"]
     [Hamill manoeuvre] div.fightdetails "⚡ HAMILL MANOEUVRE SUCCESSFUL! ⚡"
     div.combat_participant.attacker.winner   (classes winner/defeated are STATIC)
        span#attacker_select_combatreport[data-member-name=NAME] > span "NAME from Planet|Moon PLANETNAME [G:S:P]"  (NPC: "Pirates from  Deep space [G:S:16]")
        span.participant_label.(undermark|overmark|middlemark)    ← real winner marker
        li.attackerCharacterClass "Class: Collector|General|Discoverer|" ; li.attackerWeapon/attackerShield/attackerCover "Weapons: 60%" (= tech level × 10)
        ul.ship_list_28 > li > div.buildingimg.military<ID>|civil<ID> > span.detail_shipname + span.detail_shipsleft (START amount) + span.detail_shipslost "0" STATIC
     div.combat_participant.defender.defeated   same; the tooltip span text is the defender NAME only; + defenceimg.defense<ID>
     [repaired>0] .section_title "Repaired defences: N" + ul.repairedDefensesContainer > li.detail_list_el (img alt=NAME) + span.fright N
     [wreckage, by role] ul.wreckageContainer / ul.attackerWreckageContainer
     p.detail_txt ×2  "The Attacker fires a total of 173 shots …" STATIC numbers (brf:468-487)
  script: var combatData = {…}  ← the only per-round data (brf:492-712)
```

- **combatData** is a JS object literal with `//` line comments and trailing commas. The `combatId` (8196210) and the fleet key `"4492924"` are constants. `isExpedition` is always `false`. `attackerJSON.member…ownerID/ownerCoordinates/planetId` are static. `combatRounds[0]` = start: `attackerShips: {"4492924": {id: n}}`, `defenderShips: [{id: n}]` (defence included). `combatRounds[i]` for i ≥ 1: `attackerShips`/`defenderShips` = **survivors after round i**, `attackerLosses`/`defenderLosses` = cumulative `[{id: "n"}]` (string counts), `statistic` = hits/absorbed/strength for that round. Extraction recipe: `extractCombatData(html)` = regex `var combatData = (\{[\s\S]*?\n\s*\});\s*\n\s*var attackerJson` → strip full-line `//` comments → remove `,(\s*[}\]])` → `JSON.parse`.
- Units lost = start − survivors of the last round. Defender losses include destroyed defences **before** repair; repaired counts are in `ul.repairedDefensesContainer`.
- Loot exact-ish: `data-tooltip-title` of each `.loot .res_value` (formatNumberLong). Debris: the `.tf` ul. **Attacker and defender losses are only in the list view** (5.1), not in the full report.
- The defender planet type is not shown in the full view (the figure is always `planet`). Take it from the list subject link.

Recipe output for 2050 (I was attacked):

```json
{"loot":{"metal":76173,"crystal":49356,"deuterium":20615},"debris":{"metal":39000,"crystal":15000,"deuterium":0},"recyclersNeeded":3,
 "attacker":{"name":"Admiral Rigel","origin":"Admiral Rigel from Planet Kronos [1:42:11]","mark":"undermark","characterClass":"General","weapons":80,"shields":70,"armour":80},
 "defender":{"name":"Commander Vega","mark":"overmark",…},"rounds":2,
 "unitsLost":{"attacker":{},"defender":{"202":5,"204":40,"401":60,"402":10}}}
```

### 5.3 Moon chance and debris

`moon_chance` comes from `$battleResult->moonChance` (AttackMission.php:685). The row is omitted when `moon_existed` is set. `Debris (new)` is the field created by this battle. "=> N Recycler" is `ceil(total / recycler capacity of the VIEWER)` (DebrisFieldService.php:189-196), so it changes with the viewer's hyperspace tech.

### 5.4 `data-raw-*` (official API) does not exist

Official OGame puts machine-readable JSON in `div.rawMessageData[data-raw-…]`. OgameX copies the markup with **one hard-coded sample** in every report (br:1-11, brf:74-80). Scripts ported from OGame Infinity/OGLight that read `data-raw-coords`, `data-raw-result` and similar fields will silently get the same fake battle for every report. Detect OgameX (layout spec §1) and switch to the DOM recipes above.

## 6. Missiles, fleet lost, moon destruction

- `missile_attack_report`: the subject is `Missile attack on G:S:P` (plain text; the coordinates are param `target_coords`). The body has exactly two place links: origin, then target. Then an optional `Missiles Intercepted: X`; X may carry the suffix ` (including N ABMs from parent planet)` (MissileMission.php:418-428). Then the "Defenses Hit" rows: `span[style*="min-width:200px"]` = name, followed by a text node `AFTER(-DESTROYED)`. Regex on innerHTML: `/<span style="display:inline-block;min-width:200px;">([^<]+)<\/span>(\d+)\(-(\d+)\)/g`.
- `missile_defense_report`: the attacker name is in `<b>` after `from`. `Incoming Missiles: N`.
- `fleet_lost_contact`: the coordinates are in the subject link (`[coordinates]`, the defender planet). The body is static.
- Moon destruction: `destruction_chance` and `loss_chance` are `number_format(x, 2) . '%'` strings, for example `12.34%`. `moon_coords` is a `[coordinates]` link, so the subject reads `Moon NAME [<a>…[G:S:P]</a>]`. `attacker_name` is plain text (MoonDestructionMission.php:329-340, 387-430).

## 7. Expedition results

Every `expedition_*` message has the subject `Expedition Result`, the sender `Fleet Command`, and the subtab `expeditions` (egm:15-21). The key is **not** in the HTML. The body is `nl2br(lang[<key>.body.<message_variation_id>])` (egm:67-80), followed by optional suffixes:

| key | outcome | variations | suffix after `<br /><br />` | Source |
|---|---|---|---|---|
| `expedition_gain_resources` | resources | 9 (normal 1,2,4,7; rare 3,5,8,9; exceptional 6) | `Metal|Crystal|Deuterium 412,500 have been captured.`; the label is **always English** (`ResourceType::getTranslation`), the amount is formatNumber | ExpeditionGainResources.php:46-63 |
| `expedition_gain_dark_matter` | dark_matter | 10 (normal 1-6,8; rare 7,9; exceptional 10) | `(1850 Dark Matter)`; raw integer, no separators | ExpeditionGainDarkMatter.php:45-60 |
| `expedition_gain_ships` | ships | 8 (normal 1-5; rare 6,7; exceptional 8) | `The following ships are now part of the fleet:` then `<br />TITLE: N` per ship (title localised, N formatNumber) | ExpeditionGainShips.php:47-76 |
| `expedition_gain_item` | item | 1 | — (no item name) | |
| `expedition_merchant_found` | merchant | 3 | — | |
| `expedition_failed` | nothing | 15 | — (a ships outcome that yields no ships is sent as `expedition_failed`, ExpeditionMission.php:180-186) | |
| `expedition_failed_and_delay` | delay | 3 | — (no duration) | |
| `expedition_failed_and_speedup` | speedup | 3 | — | |
| `expedition_battle_pirates` | pirates | 7 | — (plus a `battle_report` with attacker `Pirates`) | ExpeditionMission.php:812-818 |
| `expedition_battle_aliens` | aliens | 7 | — (plus a `battle_report` with attacker `Aliens`) | |
| `expedition_battle` | battle (legacy, no longer sent) | 7 | — | |
| `expedition_loss_of_fleet` | fleet_lost ("black hole") | 1 | — | |

Classification recipe (language-aware, exact):

1. Load `fixtures/messages-expedition-texts.json` (or embed it). It holds `texts[locale][key][variation] = text` for en, fr and zh-TW (`nl` and `it` fall back to en).
2. Index it: key = whitespace-normalised text, value = list of `{key, variation, locale}` (`buildExpeditionIndex`).
3. For a `li.msg`: take `.msg_content.innerHTML`, split on the first `<br /><br />`, strip tags, normalise whitespace, look it up.
4. Ambiguous texts: `expedition_battle` body 1, 2, 3 and 5 are identical to `_pirates` 1, 2, 3 and 5, and `expedition_battle` 6 and 7 are identical to `_aliens` 4 and 3. Any match that is only `expedition_battle*` keys means "battle". Prefer `_pirates`/`_aliens` when the hit set contains exactly one of them. Otherwise pair it with the `battle_report` that has the same `msg_date` (attacker `Pirates`/`Aliens`).
5. Amounts: resources `/(Metal|Crystal|Deuterium) ([\d,]+)/`; dark matter: the first number in the suffix; ships: lines `^(.+): ([\d,]+)$` after the suffix header. Map titles to ids through the `t_resources` titles of the server locale (`messages-object-titles.json` has the English ones).
6. There is no expedition position in the message. Pair with the `return_of_fleet*` message whose `from` is a `[coordinates]` link at position 16.

Recipe output on the fixtures: `{"key":"expedition_gain_resources","outcome":"resources","resources":{"metal":412500}}`, `{"key":"expedition_gain_ships","shipsByName":{"Small Cargo":5,"Light Fighter":12,"Espionage Probe":3}}`, `{"key":"expedition_gain_dark_matter","darkMatter":1850}`, and so on for all 11 keys.

## 8. Transport, return, harvest (statistics inputs)

Use `parseFleetMessage(li, key)`. `from`/`to` = the first and second `a.txt_link` (`parsePlaceLink`). Resources: `/(Metal|Crystal|Deuterium): ([\d,]+)/g` on the text; the labels are English in en only. On other locales, take the three numbers in order: metal, crystal, deuterium.

- `return_of_fleet_with_resources`: the cargo brought home (loot + leftovers). An expedition return has `from` = `[coordinates] [G:S:16]`. Attack returns come from the target planet.
- `debris_field_harvest`: harvest statistics. Use the regex in the recipe file. For locale independence, take the **9 numbers in order**: ship_amount, capacity, field M, C, D, harvested M, C, D. The ship name (`Recycler`, `Pathfinder` or `Reaper`) is localised.
- `transport_received`: resources received from another player. The `from` link is the foreign planet.
- `fleet_deployment_with_resources`: the deuterium shown includes the half-fuel refund.

## 9. Fleets subtab bar response (`GET /ajax/messages?tab=fleets`, ftab:1-123)

```
div#fleetsTab > div.tab_ctn > div.js_subtabs_fleets.ui-tabs
   ul.subtabs > li#subtabs-nfFleet20..24[data-tabid][data-subtabname][aria-controls=ui-id-14..22]
        > a.txt_link.ui-tabs-anchor[href=/ajax/messages?tab=fleets&subtab=KEY] "Label" + span "(N)" (unread, only if > 0)
   div#ui-id-14 … #ui-id-24 .ui-tabs-panel  (empty)
```

The trash tab (25) is commented out (ftab:77-98). Unread count per subtab: `/\((\d+)\)/` in the anchor text.

## 10. Porting notes (OGame Live / OGame Infinity)

| Official OGame | OgameX |
|---|---|
| `index.php?page=messages&tab=20&ajax=1`, POST `page=messages` with `action` 101-121 | `GET /ajax/messages?tab=fleets&subtab=espionage&pagination=N`; `POST /messages action=103` only |
| Message type in `data-raw-messagetype`, plus JSON in `data-raw-*` | No type attribute; `rawMessageData` is a static fake. Classify by subtab and DOM (§3.4) |
| Espionage list shows loot, fleet and defence value, activity, class | Only resources (lossy), the total and counter-espionage are real; the rest are placeholders |
| `li.msg[data-msg-id]`, `.msg_title`, `.msg_date`, `.msg_content` | Same names, so OGLight list selectors mostly still work |
| `msg_date` "dd.mm.YYYY HH:MM:SS" | Same format, server timezone `APP_TIMEZONE` (UTC by default) |
| API keys `sr-…`/`cr-…` | Fake constants |
| Expedition message type id | Only the text: use the variation table |
| Detail URL `page=messages&messageId=…&tabid=…&ajax=1` | `/ajax/messages/{id}?tab=…&subtab=…` |

## 11. Open points

- Moon destruction messages are only checked against their lang strings and controller params (no fixture). Their texts are marked as placeholders in `lang:437-441` and may change.
- `alliance_broadcast` and the communication subtabs were not rendered with real data. Their markup is the dsub list layout. `AllianceBroadcast::getFrom()` uses the sender name as the `msg_sender`.
- Non-en locales: the expedition table covers fr and zh-TW. Bodies for other keys must be matched with each locale's lang strings. `it` has no `t_messages.php` and `nl` has 19 lines (en fallback, `config/app.php:82`).
- Moon chance format: integer `%` from `BattleResult->moonChance`. Not verified for fractional values.
