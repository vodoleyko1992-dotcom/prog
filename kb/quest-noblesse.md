# Сабклассы и квест Noblesse — Possessor of a Precious Soul (добавлены в игру 11.10.2026)

Источники: новость игры (прислал игрок 11.10 14:23 UTC) + живой API 11.10 ≈14:30 UTC (вход аккаунтом игрока, только GET, квест не брался, ничего не потрачено) + `kb/data/game-*.json`. Сырые ответы: `raw/sq-noblesse.json`, `raw/sq-subclass.json`, `raw/npc-anchors-noblesse.json`, JS страницы — `https://l2wap.com/noblesse-quest.js`.

Обновление16.10, 22:58 UTC+10: основной Arcana Lord78, саб1 Bounty Hunter40 уже взят, квест сабкласса завершён. Нужный для Noblesse уровень50 саба ещё не достигнут. Ниже описание состояния11.10; актуальные переключения/вещи — [живая проверка](subclasses-live.md).

## 1. Главное

- **Состояние11.10: Warlock взять квест не мог.** Нужен сабкласс 50+, а сабкласса нет: `/character/subclasses` — занят только слот 0 (Warlock 60), `secondAndThirdUnlocked:false`. Квест на сабкласс (`subclass_fates_whisper`) требует **75 ур. основного класса** и 4 РБ (§4). Путь: Warlock 60 → 75 → квест сабкласса → сабкласс 50 → Noblesse ч.1 … сабкласс 75 → Noblesse.
- Награда — постоянный Noblesse и скилл **Noblesse Blessing (1323)** на всех классах (1 ч, после смерти пропадает сам, остальные баффы остаются). Сейчас бот покупает 1323 у баффера за FA (8.0.4: докупка после смерти при платных баффах ≥5 FA). Свой 1323 = эта трата FA уходит совсем.
- Квест проходится один раз на персонажа. Квестовые мобы помечены ★ на карте (те же `mapMarkers`, что у квестов профессии).

## 2. Части (по новости; цели в API появятся только после «Взять квест»)

| Часть | Сабкласс | Что сделать | Сдать | Сверка с базой |
|---|---|---|---|---|
| 1 | 50 | убить 100 **Vanor Silenos Chieftain**, собрать 100 **Varnish** | Virgil, Rune | моб есть: ур. 50, npcId 20686, HP 2 580, EXP 3 637, агрессивный; точки **Колізей** (`coliseum`, 4 000) и **Аден** (`aden`, 15 000), не Руна. Varnish с него в обычном дропе нет — вероятно квестовый дроп (проверить после принятия). Обычный Varnish падает с 234 мобов 4+ ур. |
| 2 | 60 | убить 100 **Alpen Cougar**, собрать 80 **Mithril Ore** | Caradine, Goddard | **Alpen Cougar в базе нет** (ни в 400 мобах, ни в farm-guide) — новый моб обновления; точку покажет кнопка «Телепорт» цели. Mithril Ore — обычный ресурс (225 мобов, дроп и спойл; у самого Vanor Chieftain дроп 7 %, спойл 42 %) |
| 3 | 65 | участвовать в убийстве РБ **Flame of Splendor Barakiel** | Caradine | РБ есть: `l2dop_rb_25325`, ур. 70, HP 1 501 832, P.Atk 10 819, M.Atk 6 200, EXP 2 067 775, телепорт 100 000 адены. Ограничение игры `minRaidBossLevel` = герой − 9 (слишком слабых РБ бить нельзя), т.е. Barakiel 70 доступен герою до 79 ур. |
| 4 | 75 | поговорить с Caradine | Caradine | — |

«Участие» в Barakiel — скорее всего засчитывается как ежедневка `raid_boss_participate` (урон по РБ при его смерти), не обязательно добивание. Не проверено.

## 3. API квеста

- **GET `/game/story-quests/noblesse`** → `{quest, character}`. `quest` (до принятия):
  ```
  questId "noblesse_possessor_precious_soul", part 0, totalParts 4, completed, active,
  subclassLevel null, minLevel 50, atNpc false,
  npc {id "noblesse_virgil", name "Virgil", worldX 44528, worldY -51290, teleportId "rune"},
  objectiveUk/objectiveRu, actions {canAccept, canAdvance}
  ```
  После принятия (по коду страницы): `targets[] {name, level, have, need, teleportId}`, `npc` меняется на текущего (Caradine с ч.2), `mapMarkers` — ★ на карте.
- **POST `/game/story-quests/noblesse/<action>`** `{expectedRevision, targetId?}` (409 → пересинхронизация `/character` и повтор с новой `revision`). Действия:
  - `accept` — «Взяти квест» (когда `actions.canAccept`);
  - `advance` — «Завершити частину» / на ч.4 «Отримати Noblesse» (когда `actions.canAdvance`);
  - `teleport` + `targetId` = `teleportId` NPC или цели — телепорт (цена обычного телепорта, не проверено), потом игра уходит на `/map.html`.
- В `/character`: `noblesse` (bool, сейчас false), `noblesseQuest` (null, пока не взят — по образцу других квестов там будут `targets`), `subclassQuest`, `classSlots`.
- Страница `/noblesse-quest.html` (JS `/noblesse-quest.js`): кнопки `[data-noblesse-action=accept|advance|teleport]`, `[data-noblesse-target]`; блоки `#noblesse-quest-title|body|actions|err`. На карте NPC — режим списка «NPC» (`#map-list-mode-npc`), строки `a.l2-map-mob-link--npc`; виден, только если герой в радиусе `npcInteractionRadius` = 12 000 от NPC.
- NPC (`/game/map/sync → worldMapNpcAnchors`): `noblesse_virgil` (44528, −51290; Rune), `noblesse_caradine` (148024, −55281; Goddard), оба ведут на `/noblesse-quest.html`.

## 4. Сабклассы и квест Fate's Whisper / Mimir's Elixir (обязательны до Noblesse)

Новость игры (игрок 11.10 14:25) + API/JS 11.10 ≈14:35 (только GET).

**Система:** 4 класса на персонажа — основной + 3 сабкласса; профессия любой расы. Новый сабкласс начинает с **40 ур.**; у каждого класса свои уровень, EXP, SP, навыки и краски; инвентарь, склад, адена и клан общие. 2-й и 3-й сабкласс — после 75 ур. первого сабкласса. Переключение без потери прогресса, но **активные баффы снимаются, слуга отзывается**. Добавлять/переключать можно только рядом с Maestro Reorin или Magister Ladd (`nearClassMaster`).

**API сабклассов** (страница `/subclasses.html`, JS `/subclasses.js`):
- GET `/character/subclasses` → `{classes {activeSlot, slots[4] {slot, owned, active, profession, race, level}, secondAndThirdUnlocked, questComplete, nearClassMaster, availableProfessions[30] ("human_sorcerer", "dwarf_bounty_hunter"…), canAdd[]}, character}`. Сейчас: только слот 0 Warlock 60, `questComplete:false`, `canAdd:[]` (сырой ответ — `raw/subclasses.json`).
- POST `/character/subclasses/add` `{expectedRevision, slot, profession}` — взять сабкласс; POST `/character/subclasses/switch` `{expectedRevision, slot}` — переключиться. 409 → пересинхронизация и повтор. Кнопки `[data-class-action]`, `[data-slot]`, выбор `[data-race]` → `[data-profession]`.
- В `/character` — `classSlots` (то же, что `slots`) и `subclassQuest`.

**Квест** — GET `/game/story-quests/subclass` → `questId "subclass_fates_whisper"` «Шлях до сабкласу», `minLevel 75` (основной класс), `effectiveLevel`, `stage`: `not_started` (Fate's Whisper 1/3: взять у Maestro Reorin, `oren`) → `hunt_bosses` (2/3: убить 4 РБ, `bosses[] {spawnId, npcId, name, level, done}`, ★ на карте только у ещё нужных, `mapMarkers.spawnIds`) → `return_to_ladd` (Mimir's Elixir 3/3: сдать Magister Ladd, `ivory_tower`) → `completed` (ссылка на `/subclasses.html`). `location {atReorin, atLadd}`, `actions {canAccept, canComplete}`, `acceptedAt/completedAt`. POST `/game/story-quests/subclass/<accept|complete|teleport>` `{expectedRevision, targetId}`; у `teleport` `targetId` = `teleportId` NPC или **spawnId РБ** («Телепорт до РБ — за звичайною ціною, VIP безкоштовно» = 100 000 адены). Сырой ответ — `raw/sq-subclass.json`. NPC на карте: `subclass_reorin` (82956, 53162), `subclass_ladd` (85300, 16202) → `/subclass-quest.html`.

РБ квеста (все есть в `data/game-raid-bosses.json`; с героем 75 ограничение `minRaidBossLevel` = 66 их не отсекает):

| РБ | spawnId | Ур. | HP | P.Atk | M.Atk |
|---|---|---|---|---|---|
| Shilen's Messenger Cabrio | l2dop_rb_25035 | 70 | 1,50 M | 10 819 | 8 600 |
| Death Lord Hallate | l2dop_rb_25220 | 73 | 3,56 M | 11 974 | 5 663 |
| Kernon | l2dop_rb_25054 | 75 | 3,66 M | 12 697 | 7 774 |
| Longhorn Golkonda | l2dop_rb_25126 | 79 | 6,19 M | 9 953 | 5 139 |

Засчитывается ли «участие» или нужно добивание — по API не видно (`done` на каждого РБ). Для сравнения: Warlock 60 сейчас — M.Atk 3 252, HP 5 417; 6 M HP Golkonda в одиночку — долгий бой.

## 5. Как бот (v9) мог бы это проходить

1. Общий модуль «сюжетные квесты»: раз в N боёв читать `/character` (`noblesseQuest`, `subclassQuest`, `dionCampaignQuest`…) и `/game/story-quests/<id>`; цели `targets[]` с `teleportId` превращать в ★-цели и точку фарма — так же, как сейчас квест профессии (`profQuest`).
2. Связка с автокачем по КПД локаций: квестовая точка — это просто зона с бонусом за прогресс квеста. Пока до квеста далеко (Warlock 60), автокач ведёт к 75; кнопка «идти к квесту» появляется, когда `actions.canAccept` или есть невыполненная цель на подходящем уровне.
3. Части 1–2 (100 убийств + сбор) бот делает сам: телепорт по `targetId`, бой только ★-целей, `advance` у NPC, когда `canAdvance`. Mithril Ore можно сначала проверить в сумке (`inventory.stacks`, itemId 1876) — возможно, уже есть.
4. Часть 3 (Barakiel) — через существующий модуль РБ (`raid`, rbFlee); РБ 70 ур. для героя 65 опасен, поэтому по умолчанию только с подтверждения игрока.
5. Принятие квестов, выбор и переключение сабкласса — только по команде игрока. FA и Coin of Luck не тратить.
6. Сабклассы в боте: у каждого класса свои скиллы, панель и уровень, поэтому всё «по классу» (`rt@Ник` — замеры скиллов, `skills`, `zoneStat`, `petStat`, профиль боя) надо хранить по ключу ник + класс (`classSlots[activeSlot].profession`), иначе после переключения бот возьмёт замеры Warlock для чужого класса. Общие (инвентарь, адена, `farmDb`) — как есть.
7. Переключение снимает баффы и отзывает кота: бот должен заметить смену `activeSlot`/`l2Profession` (в `/character` или по сети `/character/subclasses/switch`), сбросить ожидания по баффам (не считать их «потерянными на смерти», не докупать Noblesse за FA) и заново прочитать скиллы и панель. Новый сабкласс 40 ур. — автокач с нуля по таблице зон, без замеров Warlock.
8. Квест сабкласса (4 РБ) — тот же модуль РБ с телепортом по `spawnId` из квеста; до 75 ур. — только автокач. Golkonda 79 / 6 M HP — по умолчанию только по подтверждению игрока.

