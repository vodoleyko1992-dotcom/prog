# Маммон: кузнец и торговец (снято 11.10.2026)

Источники: код страницы `mammon-blacksmith.js` и `mammon-location-common.js` с l2wap.com (11.10, 14:30 UTC), скриншот игрока (WestSPOIL 32 ур. у кузнеца), `kb/raw/catalog-hints.json`, `kb/raw/mammon-*.json`. API игры в момент разбора отвечало 502 (сервер лежал), поэтому живой список улучшений не снят. Ничего не улучшали, адену, FA и Coin of Luck не тратили.

## Кузнец Маммона (Blacksmith of Mammon, «Коваль Маммона»)

NPC 31126, иконка `/nps/76.png`. Одна функция: **улучшение особого снаряжения** (special gear) с Lv.0 до Lv.5. Улучшаются только плащи, пояса, тату и крылья (эмблемы). Оружие и броню кузнец не трогает: их заточка идёт через `/game/inventory/enchant`.

### Где стоит

Кочует по катакомбам и некрополям, смена раз в 4 ч (`rotationMs: 14400000`, `rotatesAtMs`, `slotIndex`). 11.10 стоял в Catacomb of the Witch (136672, 79328), следующий — Catacomb of Dark Omens. Торговец Маммона кочует так же, но по другим точкам (11.10 — The Pilgrim's Necropolis).

- `GET /game/mammon/blacksmith` → `{mammonBlacksmith {npcId, current {id, labelUk, worldX, worldY}, next, rotatesAtMs}, teleport {baseAdenaCost: 500000, adenaCost, vipFreeApplied}}`. Работает отовсюду.
- `/game/map/sync` отдаёт `mammonBlacksmith`/`mammonMerchant` только когда герой рядом (радиус NPC 12000). На карте NPC появляется ссылкой `/mammon-blacksmith.html` в списке `#map-mob-list`.
- Телепорт: страница `/mammon-blacksmith-loc.html`, `POST /game/mammon/teleport {kind:'blacksmith'|'merchant', expectedRevision, expectedAdenaCost}`. Цена 500 000 адены, с VIP бесплатно (`vipFreeApplied`). 412 — цена изменилась, 409 — конфликт ревизии.

### API улучшения

- `GET /game/mammon/blacksmith/upgrades` → `{items:[…]}`, только рядом с кузнецом; иначе 403 `mammon_blacksmith_not_nearby`. Поля предмета: `targetInstanceId, itemId, nameUk, grade, slotLabelUk, locationLabelUk` («Одягнено»/сумка), `level, max, stats[{labelUk, currentDisplay, nextDisplay}], canAfford, cost{nextLevel, adena, adenaOwned, coinOfLuck, coinOfLuckOwned, coinOfLuckItemId, materials[{itemId, nameUk, required, owned, enough}]}`.
- `POST /game/mammon/blacksmith/upgrade {expectedRevision, targetInstanceId, expectedLevel}` → `{character, upgraded {newLevel}}`. 409 `revision_conflict`. Шанса провала в коде нет: ответ сразу даёт новый уровень.
- Уровень предмета виден в инвентаре как `specialGearLevel` (0–5), имя показывается «… · Lv.N». На склад кладётся с `specialGearLevel`.

### Цена улучшения

Известна одна строка (скриншот игрока, Пояс першопрохідця D, Lv.0 → Lv.1): **250 000 адены, 1 Coin of Luck, 100 Кристалл D, 100 Железная руда, 100 Мифриловая руда, 3 Сталь**. Каждый уровень стоит Coin of Luck, поэтому **по правилу игрока бот улучшать не может** (Coin of Luck не тратим). Цены остальных уровней и грейдов не сняты: их отдаёт только `/upgrades` у кузнеца. Снять можно, когда герой окажется рядом с кузнецом (одним GET, ничего не нажимая).

### Бонусы по уровням

Полная таблица Lv.0–Lv.5 для всех 23 предметов лежит в `data/game-mammon-upgrades.json` (из `catalog-hints.specialGearUpgradeHints`, сервер считает её сам). Рост по типам:

| Тип | Что растёт | Lv.0 → Lv.5 |
|---|---|---|
| Плащ | HP, P.Def, M.Def | ×1,7 (шаги +10/+22/+36/+52/+70 %) |
| Пояс | HP, скорость бега, сила физ./маг. крита | HP ×1,7; крит +0,5 % за уровень (D 2 → 4,5 %), у C–S ×2,25 |
| Тату | P.Atk, M.Atk, скорость атаки/каста, **урон умений +2 % за уровень** (до +10 %) | P/M.Atk ×2,25, скорость ×1,7 |
| Крылья (Емблема Величі S) | CP, P.Def, M.Def, урон умений | ×1,7 |

Предметы: рыбацкие плащи/пояса/тату D–S (910618–910632, магазин рыбака за Proof или адену, а также gm-shop за Coin of Luck), награды кампаний (Пояс першопрохідця 920018 — стартовая сага, Тату Клятви Гірана 920047 — кампания Giran, Cloak of Goddard Guardian 920017 — Goddard, Плащ Захисника Діона 920019), S-предметы 920031–920034 (Емблема Величі, Пояс Долі, Тату Душі, Плащ Героя).

### Что это значит для Warlock

На Warlock надеты все три улучшаемых слота (по `kb/raw/character.json`): пояс 920018, плащ 920019, тату 910623 «Татуювання річки» D. Самое ценное для ДПС — тату: Lv.0 +173 M.Atk → Lv.5 +389 M.Atk, +10 % урона маг. умений, каст +1,7 %. Тату Клятви Гірана (кампания Giran) уже на Lv.0 сильнее (+230 M.Atk, до +518 на Lv.5).

## Торговец Маммона (Merchant of Mammon, NPC 31113)

- `GET /game/mammon/merchant/shop` — магазин за Ancient Adena (`aaPrice`): Gemstone D–S, Life Stone (General 129 600 … Unique 1 036 800), Greater Dye ±1 (45 000) и ±4 (174 000). Покупка `POST /game/mammon/merchant/buy`.
- **Заказ Маммона** `GET /game/mammon/merchant/request` → `{request {status OPEN|CLAIMED, resourceItemId, resourceNameEn, quantity, reward {coinOfLuck:1, adena:1500000}, expiresAt, winnerName, playerHaveQty}}`. Кто первым сдаст ресурс (`POST /game/mammon/merchant/request/claim`), получает 1 Coin of Luck и 1,5 млн адены. 11.10 просили 33 Silver Nugget, у героя было 2371, заказ уже забрал другой игрок. Это способ **получить** Coin of Luck, а не потратить.

## Что сделано в боте (9.0, CHANGELOG-9.0.md)

Модуль `modules/mammon.js` и раздел меню «🏺 Маммон»: заказ из сумки исполняется сам (телепорт ≤ лимита → «Здати» → обратно), цель «Копить на улучшение» добывает недостающие материалы по очереди, цены кузнеца бот читает сам. Важно: свои GET бота идут с `Authorization: Bearer <localStorage.token>` (`content.gameGet`), без токена сервер отвечает 401.

Крафт материалов (`GET /game/craft/materials`): только у Artisan/Warsmith/Maestro (`canCraftProfession`, `createItemLevel`), у Warlock — 0. Рецепты: Steel = 5 Iron Ore + 5 Varnish, Cokes = 3 Charcoal + 3 Coal, Braided Hemp = 5 Stem, Coarse Bone Powder = 10 Animal Bone, Leather = 6 Animal Skin, Mithril Alloy = 1 Mithril Ore + 1 Varnish of Purity + 2 Steel и др. (`MM_CRAFT` в модуле). Заказы идут окнами по 2 ч (`expiresAt` 14:00, 16:00 …).

## Что может пригодиться боту (версия 9)

1. Учитывать `specialGearLevel` при оценке снаряжения (сейчас equipment.js смотрит только оружие).
2. Следить за заказом Маммона: если ресурс есть в сумке и заказ `OPEN`, предлагать игроку сдать (или сдавать сам по разрешению). Нужен героем рядом с торговцем, телепорт 500 000 адены (с VIP бесплатно).
3. Показывать в меню, сколько материалов не хватает до следующего уровня (кристаллы D, руда, сталь можно фармить и спойлить), но сам апгрейд оставлять игроку из-за Coin of Luck.
