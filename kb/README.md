# База знаний L2wap Bot (собрана 11.10.2026)

Справочник по игре l2wap.com и персонажу Warlock для будущих правок бота. В пакет расширения не входит (zip собирается с `-x 'kb/*'`).

## Три источника

| Файл | Откуда | Что внутри |
|---|---|---|
| `repo-facts.md` | код бота, CLAUDE.md, все CHANGELOG, base-profile.json | все цифры и факты по темам с источником; §16 — противоречия и устаревшее, §17 — пробелы данных |
| `history-facts.md` | вся прошлая сессия разбора логов (10.10 08:45 – 11.10 12:13 UTC) | хронология решений игрока, замеры из логов, формы API, механики, баги и их причины, открытые вопросы |
| `quest-noblesse.md` | новость игры + живой API 11.10 14:30 | квест Noblesse (4 части), система сабклассов и квест Fate's Whisper, API `/character/subclasses` (add/switch), `/game/story-quests/noblesse|subclass`, план для бота v9 |
| `mammon.md` | код страницы кузнеца Маммона и скриншот игрока (11.10) | кузнец: улучшение плащей/поясов/тату/крыльев Lv.0–5, API, цена (Coin of Luck!), торговец и заказ Маммона |
| `game-live.md` | живая игра 11.10 (вход аккаунтом игрока, только GET, ничего не потрачено) | справочник эндпоинтов и полей, лучшие мобы на 60, РБ в досягаемости, цены, что бот может взять из API |

Если источники расходятся, побеждает более новый: живая игра (11.10) → история логов → CLAUDE.md/CHANGELOG.

## Данные (`data/`)

- Из кода и профиля (`tools/build_all.py` пересобирает): `mobs`, `zones`, `raidbosses`, `skills`, `items`, `farm`, `fishing`, `character`, `api`, `selectors`.
- Из живой игры: `game-mobs` (400 записей, 360 видов: HP, атака/защита, EXP, SP, адена, дроп, спойл), `game-zones`, `game-teleports` (90 точек с ценой и уровнями мобов), `game-raid-bosses` (197 РБ с характеристиками и дропом), `game-epics`, `game-shop-drops`, `game-other-shops`, `game-buffer`, `game-items`, `game-fishing`, `game-skills-warlock`, `game-farm-guide` (база фарма форума), `game-recipes`, `game-endpoints` (275 путей фронтенда игры), `game-mammon-upgrades` (бонусы Lv.0–5 у 23 улучшаемых плащей, поясов, тату и крыльев).
- Из истории логов: `history-epics`, `history-rb`, `history-zones`, `history-fishing`, `history-buffs`, `history-skills`, `history-timeline`.
- `raw/` — сырые ответы сервера (токены, логин, почта, IP вырезаны).

## Главное для бота

1. `GET /game/spawn/<id>/info` отдаёт цифры любого моба и РБ (HP, атака, EXP, адена, дроп, спойл) до боя. Можно выбирать зону и цель по таблице, без пробных боёв.
2. У чемпионов всегда 2× HP и P.Atk, но 10× EXP и адены (проверено на 40 парах). Это аргумент включить поиск чемпионов.
3. Лучшие обычные мобы на 60 ур. по EXP на единицу HP: Past Knight 64 (Ancient Battleground), Requiem Lord 68, затем Bone Maker 66 и Bone Collector 67 (Den of Evil), Bloody Lord 68.
4. `RB_KNOWN` в `modules/raid.js` можно расширить с 33 до 197 РБ из `game-raid-bosses.json`. Время респа РБ API не отдаёт, только у эпиков.
5. Бесплатен только базовый набор баффера. Полные наборы стоят Coin of Luck, бот их не берёт.
6. В `/character` есть поля, которые бот пока не читает: `learnedBattleSkillsDetail`, `battleHotbarSlots`, `activeBuffs[].expiresAt`, `activeSummon.pAtk`, `armorSetBonus`, `weaponGradeMatchesArmor`, `skillMpCostMul`, `currentZoneId`.
7. Откаты рыбалки видны в `/game/fishing/state.cooldowns`: `pumpingMs:500`, `reelingMs:700` и время окончания в мс сервера.
8. У игры есть `/game/antibot/activity|challenge`. Если появится проверка, бот должен остановиться и написать игроку.
9. На сервере включён `craftTestShop` (427 предметов крафта по 0 адены). Это видно в данных, но не использовано.

## Правила

- Fast Aden и Coin of Luck не тратить никогда (игрок 11.10). Адену можно.
- Логин и пароль — только из переменных окружения, в файлы и журнал не попадают.
