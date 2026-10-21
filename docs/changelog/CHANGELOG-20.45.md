# L2wap Bot 20.45 — в работе (сборка — по команде John)

Пока не собрано. Сюда копятся правки после выпуска 20.44.

## Обновлённый форум «Фарм ресурсов» (анонс игры 21.10)

- Игра обновила раздел форума: страница берёт данные из того же `GET /game/farm-guide`, что бот читает раз в сутки. В ответе появились новые разделы: `rareResources` (Mold Lubricant, Mold Hardener, Mold Glue, Enria, Asofe, Thons, Maestro Mold, Maestro Anvil Lock), `gradePieces` (Weapon/Armor Piece и Accessory Gemstone D–S), `craftedResources` (24 рецепта материалов) и `shopMaterials` (Gemstone/Crystal D–S за адену).
- Бот теперь кладёт в базу фарма и редкие материалы, и части экипировки (раньше только 14 базовых ресурсов). У сырья рецептов Maestro Holder, Craftsman Mold и Warsmith's Holder появились точки фарма для цели Маммона и «Фарм ресурса». В меню «Фарм ресурсов» новые разделы стоят после «Ресурсы».
- Рецепты и цены магазина из ответа совпали со встроенными `MM_RECIPES`/`MM_SHOP` — менять не пришлось, тест сверяет их.
- В игре изменился спойл: базовые ресурсы теперь спойлятся со всех мобов (раньше обычное сырьё только до 35 ур.), с мобов 40+ шанс на 5 % выше (Stem/Iron Ore/Coal… 60 %, Varnish/Skin/Suede/Silver 53 %, Mithril/Stone of Purity 47 %, Oriharukon/Adamantite 41 %). Бот берёт эти цифры из ответа игры сам.
- Данные: `kb/data/game-farm-guide.json`, `kb/raw/farm-guide.json` (снято 21.10 22:48 UTC). Тест `tests/v2045-farm-guide-sections.test.js`. Живая игра: только чтение `GET /game/farm-guide`.
