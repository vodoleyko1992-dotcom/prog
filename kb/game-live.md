# l2wap.com — живая база знаний (снято 11.10.2026)

Источник: публичные страницы и JS игры (≈430 файлов, `catalogVersion 20261009-epic-jewelry-stats-valakas-mcrit30-v1`) + ответы API под аккаунтом игрока (Warlock, 60 ур., Ancient Battleground).
Сбор в два прохода: **2084 запроса — 2082 GET и два POST `/auth/login`** (по одному входу на проход; второй проход — 901 GET для добора мобов). Других POST/PUT/DELETE не было: ни боя, ни телепорта, ни покупок, ни баффов. **Адена, Coin of Luck и FA не тратились** (трат: 0). Позже координатор разрешил игровые POST и небольшие траты адены. Это разрешение не понадобилось: всё нужное отдают GET.
Пароль, токен и cookie нигде не записаны. В `kb/raw` вычищены поля token/session/email/ip/login/refresh; финальная проверка `kb/` на логин, пароль, JWT, email и IP — 0 совпадений.

Время в ответах — мс эпохи; `serverNowMs` есть в `/game/time`, `/game/fishing/state` и `/game/siege/schedule`. Числа EXP/SP у РБ приходят **строкой с пробелами** (`"1 837 252"`), у обычных мобов — числом.

## 1. Файлы

| Файл | Что внутри | Кол-во |
|---|---|---|
| `kb/data/game-endpoints.json` | каталог API фронтенда: метод, путь, JS, страницы, `usedByBot`, `crawledGET` | 275 путей (бот использует 23, снято GET 76) |
| `kb/data/game-mobs.json` | мобы: npcId, stats {maxHp,pAtk,pDef,mAtk,mDef}, exp, sp, expPerHp, адена [min,max,шанс], drops, spoil, локации (teleportId), kinds, примеры spawnId; отдельно `champion:true` | 400 записей (357 обычных + 43 чемпиона, 360 видов моба) + 81 моб только из farm-guide (имя/ур./локация, без цифр) |
| `kb/data/game-zones.json` | 90 точек телепорта: цена, `mobLevelMin/Max`, мобы точки | 90 |
| `kb/data/game-teleports.json` | телепорты: id, EN/UK, цена в адене, полоса уровней мобов | 90 |
| `kb/data/game-raid-bosses.json` | все РБ: spawnId, npcId, уровень, stats, exp/sp, цена телепорта, живой ли при снятии, дроп с шансами | 197 |
| `kb/data/game-epics.json` | 8 эпиков: stats, exp, `respawnHours`, `coinOfLuckCost` | 8 |
| `kb/data/game-shop-drops.json` | магазин `/game/drops-shop` по грейдам: shopKey, itemId, цена в адене/CoL, подтип, строки статов | 749 |
| `kb/data/game-buffer.json` | городской баффер (5 наборов) + баффер FA (4 набора, банки, краски) | — |
| `kb/data/game-items.json` | каталог предметов из `/character/catalog-hints`: 463 вещи с полными статами, 18 комплектов брони, имена EN 607 / UK 934, грейд, слот, статы, мин. уровень | — |
| `kb/data/game-fishing.json` | рыбалка: стартовый магазин, обмен Proof, удочки, наживка, пакеты времени, откаты pumping/reeling | — |
| `kb/data/game-skills-warlock.json` | 35 выученных скиллов Warlock (ранг/макс., подсказки UK/RU, иконки), кот, скиллы TvT | 35 |
| `kb/data/game-farm-guide.json` | «форумная база» фарма: resources 14, keyMaterials 116, raidEquipment 254 — источники (drop/spoil, моб, ур., локация, шанс, кол-во) | 384 предмета |
| `kb/data/game-recipes.json` | `/game/recipes/sources` D/C/B: где дропается/спойлится рецепт | 29/30/39 |
| `kb/data/game-other-shops.json` | магазин TvT, кристаллы Олимпиады, GM-премиум, Маммон, катакомбы, премиум/VIP, тату, бонусы, ивенты, ежедневки, расписание TvT/осад | — |
| `kb/raw/*.json` | сырые ответы (обёртка `{_path,_status,data}`), в т.ч. `spawn-info-bosses.json` (205 боссов) и `probe-mobs.json` (≈1330 spawnId) | 80+ файлов |

## 2. Эндпоинты — справочник полей

Авторизация: `POST /auth/login {login,password}` → `{token, expiresInSec}` и httpOnly cookie `l2wap_refresh_dev`. Дальше запросы идут с `Authorization: Bearer <token>`. На 401 `{error:"access_token_expired"}` клиент делает `POST /auth/refresh` (по cookie). Бот работает внутри страницы, поэтому этим занимается сама игра.

### Персонаж и мир
- **GET `/character`** → `{character, catalogVersion, pvpIncoming}`. В `character` 150+ полей. Бот пока **не читает** такие:
  - статы `pAtk/mAtk/pDef/mDef/castSpd/mCritPct/critRate/accuracy/evasion`, `magicCritDmgMul`, `skillMpCostMul`, `outgoingMagicalSkillDamagePct`, `vampiricPct`, `regenHp/Mp`, `armorSetBonus`, `weaponGradeMatchesArmor` (готовая проверка «оружие под броню»);
  - `learnedBattleSkillsDetail[] {battleId:"l2_1011", level, maxSkillLevel, nameUk, hintUk, hintRu, l2SkillId}` — ранги и описания всех скиллов без похода к магистру (бот ходит за ними на `/magister.html?mode=learned`);
  - `skillCooldowns`, `castableSelfBuffs`, `toggleStances`, `panelHotbarSkills`;
  - `battleHotbarSlots[]` — раскладка панели боя: `{k:"a", a:"l2_1151"}` — скилл, `{k:"u", id:728}` — предмет. Можно читать прямо, без DOM;
  - `activeBuffs[] {skillId, level, nameUk, descriptionUk, expiresAt, remainingSec}`;
  - `activeSummon {key, summonSkillId, summonSkillLevel, hp/maxHp, mp, pAtk, pDef, mAtk, …}` (Kai Lv.6: P.Atk 1455);
  - `inventory.stacks[] {itemId, qty}`, `warehouse`, `coinOfLuck`, `adena` (строкой);
  - `currentZoneId/currentZoneNameUk/locationType`, `worldX/worldY`, `inBattle/battleSpawnId`;
  - `dailyQuests`, `firstProfessionQuest/starterStoryQuest/dionCampaignQuest/giranCampaignQuest/subclassQuest`, `recipeBook`, `premium/vip`, `expBarCur/Max/Pct`.
- **GET `/game/time`** → `{serverNowMs, timeZone, gameDayKey, nextDailyResetAt}`.
- **GET `/game/map/spawns`** → `{nearbySpawns[400] {id, name, level, distance, inBattleRange, kind, icon}, spawns[] — РБ и охрана эпиков на карте мира {id, worldX, worldY, name, level, kind, aggressive}}`. `kind`: passive / aggressive / neutral / champion / raid / epic_guard. Мобы — только вокруг героя; параметра для другой зоны нет.
- **GET `/game/map/around`** → `{nearestLabelUk, teleportId, cityId, distance, mobs[{name,level}] — виды мобов зоны, nearbySpawns, nearbyHeroes}`. Даёт **готовый список видов мобов зоны** и `teleportId` текущей точки. Бот не использует.
- **GET `/game/map/sync[?mapCatalogVersion&personalMapSig&mammonRotationSig&revision]`** → `{changed, mapRadii {mobInteractionRadius:20000, npcInteractionRadius:12000, …}, mapState {hp, maxHp, expBarPct, currentZoneId, …}, around, spawns, mammonMerchant, dungeonEntrance, pvpIncoming, pvpDefeat, pveDefeat}`. Игра опрашивает его раз в 15 с вместо полного `/character`.
- **GET `/game/spawn/<spawnId>/info`** (работает для **любого** spawnId, расстояние не важно) → `{spawnId, name, level, kind, aggressive, templateId, npcId, icon, stats {maxHp,pAtk,pDef,mAtk,mDef}, rewardExp, rewardSp, drops[{id, kind:adena|resource|equipment|other, chance, min, max, displayName, l2ItemId, iconUrl}], spoil[], viewerMaySeeSpoil, rewardExpSynthetic, dropsSynthetic}`. У РБ ещё есть `canAttackRaidBoss, minRaidBossLevelForAttack`. Бот берёт отсюда только цифры РБ. Для обычных мобов это готовый EXP/HP/адена **до боя**: можно ранжировать цели без замеров.
- spawnId: `dense_0…≈32500` (основные мобы, идут блоками по зонам), `scatter_≈250…3600` (одиночные), `l2dop_rb_<npcId>`, `l2dop_eg_<эпик>_…` (охрана эпика).
- **GET `/game/teleport/locations`** → `locations[] {teleportId, labelUk, labelEn, baseAdenaCost, adenaCost, vipFreeApplied, mobLevelMin, mobLevelMax}`. Готовая полоса уровней точки — для `zoneForLevel` без замеров. Сам телепорт — `POST /game/teleport` (не вызывался).

### РБ и эпики
- **GET `/game/raid-bosses?page=N`** (15 на странице, всего 197) → `{baseAdenaCost:100000, adenaCost, vipFreeApplied, characterLevel, minRaidBossLevel (= герой − 9), bosses[] {spawnId, name, level, bossType, isAlive, adenaCost, icon, canAttack, attackBlockedReasonUk}}`. **Времени респавна у РБ нет** (есть только у эпиков).
- **GET `/game/epic-bosses`** → то же + `baseCoinOfLuckCost:1, coinOfLuckCost:1, respawnHours`.

### Магазины и экономика
- **GET `/game/drops-shop`** → `grades[] {grade, sections[] {category, items[] {shopKey, itemId, nameUk, priceAdena, priceCoinOfLuck, purchasable, consumableSubtype, statsPreview.lines}}}` (386 КБ). Оружие и броня здесь **без цены** — их только показывают, купить нельзя.
- **GET `/character/catalog-hints`** (292 КБ) — полный каталог предметов: `gearCatalog[] {itemId, nameUk, slot, grade, weaponType, stats {pAtk,mAtk,atkSpd,wpnCrit,…}, weaponMode phys|magic, masteryFamily}`, `armorSetCatalog[] {setId, armorType, pieceIds, stages[{requiredCorePieces, displayLines}]}`, `itemNamesEn/Uk`, `itemGradeHints`, `equipmentGradeMinCharLevel`, `itemRequiredLevelHints`, `itemUseActionByItemId`. Версия — `GET /character/catalog-version`. Может заменить или дополнить встроенный `items-il.json`.
- **GET `/game/farm-guide`** (2,2 МБ) — тот же «форум фарма»: `resourceTeleportAdenaCost:50000, resources[], keyMaterials[], raidEquipment[]`, у каждого `sources[] {mode:drop|spoil, mobName, mobLevel, locationEn, teleportId, chanceMin/Max, qtyMin/Max}`. Бот сейчас разбирает DOM страницы форума, а здесь та же база одним JSON. Телепорт к ресурсу — `POST /game/farm-guide/resource-teleport` (50 000).
- **GET `/game/recipes/sources?grade=D|C|B`** → `recipes[] {itemId, recipeCode, recipeName, category, drop[], spoil[] {mobName, mobLevel, teleportId, locationEn, chance}}`.
- **GET `/game/fishing/state`** → `starterShop.offers` (удочка 25 000; наживка ×10 = 1 000; заряды ×50 = 5 000), `economy {proofQty, exchanges[] — материалы рыбы → Proof, offers[] — за Proof: хорошая наживка ×10 = 3, заряды ×200 = 7, обычная наживка ×50 = 2, свиток заточки удочки = 100}`, `fishingTime {remainingMs, packages[] (1 ч = 3 000 000 адены…)}`, `fishingSpot {purchased, priceAdena:10 000 000}`, `cooldowns {pumpingUntil, reelingUntil, pumpingMs:500, reelingMs:700}`, `rod/rods/bait/basicBait/goodBait/fishingSoulshot/target/logTail`. Структура `fishing.cooldowns` из game-facts раньше была неизвестна — теперь она есть.
- **GET `/character/town/buffer/catalog`** → `sets[] {id, titleUk, feeAdena, feeCoinOfLuck, skills[] {skillId, nameUk, level, durationSec, descriptionUk}}`.
- **GET `/character/town/fast-aden-buffer/catalog`** → `{fastAdenItemId:920048, fastAdenBalance, sets[] {costFastAden, skills[]}, consumables[] (банки HP/MP/CP по 2 500 за 1 FA ×5), dyes[]}`.
- Ещё (сырые ответы в `kb/raw`): `/game/tvt/shop/catalog`, `/game/olympiad/crystal-shop`, `/game/gm-premium-shop`, `/game/mammon/merchant/shop`, `/game/premium`, `/game/vip`, `/game/tattoos`, `/game/ancient-trader/offers`, `/game/market/listings`.

### Прочее
`/character/magister[?npcId=30344]` — список скиллов пуст, если герой не в городе у этого NPC (сейчас он в зоне); `/character/town`, `/character/bonuses`, `/character/subclasses`, `/character/profession-quest/human-mystic-second/status`, `/game/story-quests/{starter-saga,dion-campaign,giran-campaign,goddard-ocean-flame,noblesse,subclass}` (последние два — см. `quest-noblesse.md`), `/game/daily-quests`, `/game/achievements`, `/game/olympiad`, `/game/ratings?type=level`, `/game/arena`, `/game/tvt` (+`schedule`: слоты 08:00/15:00/20:00, регистрация за 10 мин), `/game/tvt/skills`, `/game/tvt/result/latest`, `/game/catacombs` (некрополи, вход за 1 адену), `/game/seven-seals`, `/game/brave-hunter`, `/game/siege/schedule`, `/game/dragon-dungeon`, `/game/online`, `/game/quiz/current`, `/game/server-news?page=1`, `/game/forum/news`, `/game/client-config` (`craftTestShop:true`). 403: `/game/mammon/blacksmith/upgrades` и `/game/clans/items/catalog` (нужен клан или NPC рядом).

### Важные POST (найдены в коде фронта, не вызывались)
`/game/battle/start|action|hunt-continue|return-to-town|hotbar|pvp/start`, `/game/battle/leave`, `/game/move`, `/game/world/enter-map|enter-city`, `/game/teleport`, `/game/raid-boss/teleport`, `/game/epic-boss/teleport`, `/game/catacombs/teleport`, `/game/mammon/teleport`, `/game/dungeon/enter`, `/game/drops-shop/buy`, `/character/equip`, `/character/consumable/use`, `/character/skills/learn|cast|toggle`, `/character/town/buffer`, `/character/town/restore-vitals`, `/character/town/fast-aden-buffer/apply|buy-consumable|buy-dye`, `/character/companion/dismiss|feline-queen-blessing|seraphim-gift`, `/game/fishing/action|buy-starter|buy-gear|buy-special|cut|enchant-rod|exchange-material|learn-skill|open-old-box`, `/game/recipes/learn`, `/game/craft/{weapons,armor,jewelry,shields,materials}`, `/game/inventory/enchant|expand`, `/game/antibot/activity|challenge` (есть код антибота!), `/game/tvt/register|unregister|action|target|summon/action`, `/game/olympiad/buy-coupon`. Полный список — `game-endpoints.json`.

## 3. Цифры

### Чемпионы — проверено на 40 парах «обычный ↔ чемпион»
У чемпиона **HP ×2, P.Atk ×2, EXP ×10, адена ×10** — без исключений. Пример: Requiem Lord 68 — 3 444 HP / 12 038 EXP против 6 888 HP / 120 380 EXP и 84–110 тыс. адены. На одну единицу HP это ×5 к EXP. Это подтверждает лог 10.10: поиск чемпионов (searchChamp) выгоден.

### Лучшие обычные мобы для Warlock 60
M.Atk героя 3 252, HP 5 417. У мобов 58–68 HP всего 3 000–3 450, M.Def 420–490.

| Моб | Ур. | HP | EXP | SP | EXP/HP | Адена (70 %) | Точка |
|---|---|---|---|---|---|---|---|
| Past Knight | 64 | 3 252 | 11 588 | 2 120 | 3,56 | 7,6–9,7 тыс. | ancient_battleground |
| Requiem Lord | 68 | 3 444 | 12 038 | 2 326 | 3,50 | 8,4–11 тыс. | forest_of_the_dead, plunderous_plains, valley_of_saints |
| Bone Maker | 66 | 3 348 | 9 596 | 1 806 | 2,87 | 8–10,4 тыс. | den_of_evil |
| Bone Collector | 67 | 3 396 | 9 695 | 1 846 | 2,86 | 8,2–10,7 тыс. | den_of_evil |
| Bloody Lord | 68 | 3 444 | 9 382 | 1 812 | 2,72 | 8,4–11 тыс. | ancient_battleground |
| Doom Knight | 65 | 3 300 | 8 649 | 1 608 | 2,62 | 7,8–10 тыс. | fields_of_massacre |
| Bone Snatcher | 66 | 3 348 | 8 774 | 1 652 | 2,62 | 8–10,4 тыс. | den_of_evil, forest_of_the_dead |
| Antelope | 68 | 3 444 | 8 608 | 1 664 | 2,50 | | valley_of_saints, wild_beast_pastures |
| Fallen Orc Shaman | 58 | 2 964 | 6 898 | 1 166 | 2,33 | 6,1–7,8 тыс. | forest_of_the_dead, forsaken_plains |

Игрок сейчас стоит на Ancient Battleground (Past Knight 64 / Bloody Lord 68 / Dark Guard 70) — это одна из лучших точек. HP мобов ≈ M.Atk героя, так что на моба уходит примерно 1–2 заклинания плюс удар кота.

### РБ в досягаемости (минимум для атаки — 51, у героя 60)
48 РБ уровней 51–66 (`game-raid-bosses.json`). Слабые по атаке (M.Atk босса ≤ 1 600 при HP ≈ 5,4 тыс. у героя): Deadman Ereve 51 (386 тыс. HP, M.Atk 769), Fafurion's Envoy Pingolpin / Grave Robber Kim 52 (628 тыс., 1 104), Magus Kenishee 53, Paniel 54, группа 55-х (704 тыс. HP, M.Atk 1 468: Barda, Sephia, Black Lily, Ruell, Niniel, Kabed, Isirr), Leo / Garangky 56 (M.Atk 1 600). 2–3,4 млн HP у 65-х (Hekaton Prime, Rahha, Tiphon) — бить с FA.
Ловушки: Ice Fairy Sirra 60 и Captain of the Ice Queen's Royal Guard 59 дают **88 и 15 EXP** — это квестовые боссы, их не фармить. У Dark Shaman Varangka 53 всего 220 тыс. EXP.
Награда РБ: адена 260–330 тыс., 9–11 строк дропа (оружие/броня A 2,5–6,5 %). `dropsSynthetic:true` — значит дроп сгенерирован сервером, а не из Interlude.
Телепорт к РБ — 100 000 адены, к ресурсу — 50 000, к эпику — 1 Coin of Luck.

### Эпики
| Эпик | Ур. | HP | M.Atk | Респавн, ч |
|---|---|---|---|---|
| Queen Ant | 40 | 430 тыс. | 2 562 | 12 |
| Core | 50 | 877 тыс. | 3 192 | 12 |
| Orfen | 50 | 488 тыс. | 3 192 | 12 |
| Zaken | 60 | 3,65 млн | 3 222 | 36 |
| Baium | 75 | 41 млн | 11 767 | 60 |
| Antharas | 79 | 62,5 млн | 13 019 | 72 |
| Valakas | 85 | 86,5 млн | 11 397 | 240 |
| Frintezza | 90 | 42,6 млн | 8 712 | 60 |

Вход к любому эпику — 1 CoL.

### Цены
- Заряды BSPS / soulshot за штуку: NG 25, B 160, A 360, S 560 (D/C — в файле).
- Банки: HP 85, малая MP 90, **большая MP 2 200**.
- Кристаллы: B 9 000, A 15 000, S 25 000. Самоцветы: B 10 000, A 30 000, S 100 000.
- Краски: слабые 40 000, сильные 124 200.
- Телепорты по точкам: от 1 до 22 000 адены (большинство 1–10 тыс.). VIP (350 CoL / 30 дн.) делает телепорты и городские баффы бесплатными.
- **Городской баффер**: «Звичайний баф» (13 баффов) — бесплатно. «Повний баф воїна/мага» — **15 Coin of Luck**, «Резісти» и «Greater Buffs» — по 5 CoL. Боту нельзя брать никакой набор, кроме `basic`.
- **Баффер FA**: наборы warrior/mage/resists по 1 FA за скилл, Greater — 5 FA, срок 3 ч.
- Рыбалка: 1 ч времени — 3 000 000 адены; место (куплено) — 10 млн. Обмен материалов на Proof — в `game-fishing.json`.
- Олимпиада: купон 1 000 000 адены + 50 000 SP (с 40 ур.). Премиум: бронза 8 CoL / сутки (+50 %), серебро 24 CoL (+100 %).
- `craftTestShop:true`: в `drops-shop` 427 позиций `craft_test*` (рецепты S/A, части, ресурсы, уламки ×100…×7000) по **0 адены** с `purchasable:true`. Похоже, тестовый режим сервера. Не проверялось и ничего не покупалось — сказать игроку, но не использовать.

## 4. Что бот мог бы взять (сейчас не использует)
1. **`/game/spawn/<id>/info` для обычных мобов** — EXP/SP/HP/адена моба до первого боя. `zonePick` и `rt.mobVal` сейчас учатся по замерам, а можно стартовать с этих цифр (EXP/HP, чемпион ×10).
2. **`/game/teleport/locations` (`mobLevelMin/Max`, `adenaCost`)** и **`/game/map/around`** (виды мобов зоны, `teleportId`) — выбор зоны без разведки и без «zoneTrial».
3. **`/game/farm-guide` JSON** вместо разбора DOM форума: те же `sources`, плюс `teleportId` и `chanceMin/Max`, без ожидания `details`.
4. **`/character`**: `learnedBattleSkillsDetail` (ранги и описания вместо поездки к магистру), `battleHotbarSlots` (раскладка панели без DOM), `activeBuffs.expiresAt`, `activeSummon.pAtk`, `weaponGradeMatchesArmor`, `armorSetBonus` (бот «броню пока не проверяет»), `skillMpCostMul`, `currentZoneId`.
5. **`/character/catalog-hints`** — грейд, статы и `weaponMode` любого предмета (сейчас из `items-il.json` Interlude, а у L2WAP статы свои). Сюда же 18 сетов с бонусами по стадиям.
6. **`/game/fishing/state.cooldowns`** — `pumpingMs:500 / reelingMs:700` и `…Until` в мс сервера: точный откат рыбалки вместо подбора FCD_MIN.
7. **`/game/raid-bosses` целиком** (197 РБ, 14 страниц) + spawn-info: `RB_KNOWN` в `modules/raid.js` (33 шт.) можно дополнить до 197 из `kb/data/game-raid-bosses.json`.
8. **`/game/map/sync`** (лёгкий, раз в 15 с) — hp/exp/зона без полного `/character`.
9. **`/game/tvt` `schedule`** — точное время TvT (08:00/15:00/20:00, регистрация с T−10 мин).
10. В игре есть `/game/antibot/activity|challenge` (`battle-antibot.js`). Сейчас капчи нет, но эндпоинт живой. Если бот увидит challenge — останавливаться (по правилам проекта).

## 5. Ограничения сбора
- Мобов снимали выборкой spawnId: шаг 100 по `dense_0…33950` и `scatter` с шагом 250, затем второй проход — 900 проб делением пополам на границах блоков с разными мобами (до шага ≈12). Итог: 360 видов из ≈440. Без цифр остался 81 моб из farm-guide/рецептов (12 из них уровней 55–72) — это короткие блоки внутри участков одного моба; добирать дальше дорого (≈1 новый моб на 10 запросов).
- `/character/magister` отдаёт скиллы, только когда герой в городе у магистра. Каталог «что можно выучить» не снят; ранги выученных есть в `/character`.
- Респавна РБ API не отдаёт.
- Цены оружия и брони в `drops-shop` = null (их не продают). Рынок игроков (`/game/market/listings`) снят одной страницей.
