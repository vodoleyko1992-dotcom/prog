# Квест Noblesse — Possessor of a Precious Soul (добавлен в игру 11.10.2026)

Источники: новость игры (прислал игрок 11.10 14:23 UTC) + живой API 11.10 ≈14:30 UTC (вход аккаунтом игрока, только GET, квест не брался, ничего не потрачено) + `kb/data/game-*.json`. Сырые ответы: `raw/sq-noblesse.json`, `raw/sq-subclass.json`, `raw/npc-anchors-noblesse.json`, JS страницы — `https://l2wap.com/noblesse-quest.js`.

## 1. Главное

- **Warlock сейчас взять квест не может.** Нужен сабкласс 50+, а сабкласса нет: `/character/subclasses` — занят только слот 0 (Warlock 60), `secondAndThirdUnlocked:false`. Квест на сабкласс (`subclass_fates_whisper`) требует **75 ур. основного класса** и 4 РБ (§4). Путь: Warlock 60 → 75 → квест сабкласса → сабкласс 50 → Noblesse ч.1 … сабкласс 75 → Noblesse.
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

## 4. Квест на сабкласс (обязателен до Noblesse)

GET `/game/story-quests/subclass` → `questId "subclass_fates_whisper"` «Шлях до сабкласу», `minLevel 75`, `stage`: `not_started → hunt_bosses → return_to_ladd → completed`. NPC: Maestro Reorin (`oren`, взять), Magister Ladd (`ivory_tower`, сдать). POST `/game/story-quests/subclass/<action>` (accept / complete / teleport). РБ по квесту:

| РБ | spawnId | Ур. | HP | P.Atk | M.Atk |
|---|---|---|---|---|---|
| Shilen's Messenger Cabrio | l2dop_rb_25035 | 70 | 1,50 M | 10 819 | 8 600 |
| Death Lord Hallate | l2dop_rb_25220 | 73 | 3,56 M | 11 974 | 5 663 |
| Kernon | l2dop_rb_25054 | 75 | 3,66 M | 12 697 | 7 774 |
| Longhorn Golkonda | l2dop_rb_25126 | 79 | 6,19 M | 9 953 | 5 139 |

## 5. Как бот (v9) мог бы это проходить

1. Общий модуль «сюжетные квесты»: раз в N боёв читать `/character` (`noblesseQuest`, `subclassQuest`, `dionCampaignQuest`…) и `/game/story-quests/<id>`; цели `targets[]` с `teleportId` превращать в ★-цели и точку фарма — так же, как сейчас квест профессии (`profQuest`).
2. Связка с автокачем по КПД локаций: квестовая точка — это просто зона с бонусом за прогресс квеста. Пока до квеста далеко (Warlock 60), автокач ведёт к 75; кнопка «идти к квесту» появляется, когда `actions.canAccept` или есть невыполненная цель на подходящем уровне.
3. Части 1–2 (100 убийств + сбор) бот делает сам: телепорт по `targetId`, бой только ★-целей, `advance` у NPC, когда `canAdvance`. Mithril Ore можно сначала проверить в сумке (`inventory.stacks`, itemId 1876) — возможно, уже есть.
4. Часть 3 (Barakiel) — через существующий модуль РБ (`raid`, rbFlee); РБ 70 ур. для героя 65 опасен, поэтому по умолчанию только с подтверждения игрока.
5. Принятие квеста и сабкласс — только по команде игрока (смена класса меняет скиллы и бой). FA и Coin of Luck не тратить.
