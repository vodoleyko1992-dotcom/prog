# Квест «Слід Океану Полум'я» — A-плащ Cloak of Goddard Guardian

Источники: лог John 23.10 (24.10 00:49–00:56 по часам игры, сборка 20.53, Warlord 73), learn-отчёт того же времени,
код страниц игры `captain-andrei.js` и `scout-adrian.js` (скачаны 23.10 без входа, только чтение), сохранённый ответ
`kb/raw/sq-goddard.json` (Warlock 64, квест не взят).

## Награда

Cloak of Goddard Guardian (itemId 920017), грейд A: Max HP +1100, P.Def +260, M.Def +260. Мин. уровень квеста 70
(`minLevel`, по `effectiveLevel` — уровню активного класса).

## API

- `GET /game/story-quests/goddard-ocean-flame` → `{quest, character}`. Карта игры опрашивает его сама (learn: 1578 запросов с 10.10).
- `POST /game/story-quests/goddard-ocean-flame/<action>` с телом `{expectedRevision}` (revision героя) → `{quest, character}`; 409 — конфликт
  ревизии, страница перечитывает квест.
- Действия: `accept` (Andrei), `turn-in-supplies`, `turn-in-cloth`, `report-hunt` (Adrian), `claim-reward` (Andrei).
- Флаги `quest.actions`: `canAccept`, `canTurnInSupplies`, `canTurnInCloth`, `canReportHunt`, `canClaimReward` — игра даёт их
  только рядом с нужным NPC (в ответе с карты все false).
- `quest.location`: `atCaptainAndrei`, `atScoutAdrian`, `canonicalTeleportId` (у Warlock 64 в Шуттгарте — `schuttgart`, у Warlord 73 в
  Хейне — `alligator_island`; похоже на ближайший телепорт к герою, не к квесту).

## NPC

| NPC | Страница | Где пускает | Телепорт |
|---|---|---|---|
| Captain Andrei (капитан стражи Годдарда) | `/captain-andrei.html` | город Годдард: `currentTownId = l2dop_goddard`, `locationType = city`, иначе уводит на `/city.html` | `goddard` (18 000 адены без VIP) |
| Scout Adrian | `/scout-adrian.html` | зона `varka_silenos_stronghold` и `quest.location.atScoutAdrian`, иначе уводит на `/map.html` | `varka_silenos_stronghold` (8 000) |

Разметка обеих страниц одинакова: `#<npc>-quest-body`, `#<npc>-quest-actions` с кнопками `button[data-action=…]`, ошибка — `#<npc>-err`.

## Стадии (`quest.stage`)

1. `not_started` — взять у Andrei (`accept`). Показывает нужные припасы.
2. `collect_supplies` — Animal Bone (1872) ×1200, Iron Ore (1869) ×1000, Thread (1868) ×1000, Stem (1864) ×1200; сдать Adrian
   (`turn-in-supplies`). В логе 23.10 после `accept` (припасы уже были в сумке) сразу стояла `kill_ashakiel`, а запроса
   `turn-in-supplies` в learn нет — вероятно, при полных припасах игра забирает их при взятии.
3. `kill_ashakiel` — убить РБ Ocean Flame Ashakiel 76 (`l2dop_rb_25205`, HP 1,68 млн, P.Atk 11 735, P.Def 7 948, M.Def 8 795;
   телепорт к РБ 100 000, при VIP 0) и принести Cloth of Ocean Flame (920016) ×1 (`ashakiel.clothHave`); сдать Adrian (`turn-in-cloth`).
4. `kill_equal_level_mobs` — 150 мобов «рівня не нижче твого» (`hunt.have/need`); доложить Adrian (`report-hunt`).
   Подходят Варка (75–78) и окрестности Годдарда (71–78).
5. `return_to_andrei` — забрать плащ у Andrei (`claim-reward`).
6. `completed`.

## Что делает бот (20.54, `modules/story.js`, kind `goddard`)

- Прогресс пишет в `rt.story.goddard` из опросов игры и своего GET раз в 10 мин; охота — строка журнала раз в 25 убийств.
- Стадия Ashakiel: в туре РБ этот РБ первым (после свитков, `raid.rbTourPlan` ← `story.rbFirst`).
- Стадия охоты: на карте мобы не ниже уровня героя первыми в своём приоритете (`mobfarm.mobValRank` ← `story.huntUp`). Сам в Варку
  ради охоты не летит.
- Готовая стадия: обычным перелётом (`rt.zoneGo`, служба quests) в Варку/Годдард, свежий GET «NPC рядом», кнопка страницы.
  Не в бою; в туре РБ — только на его простое ≥ 3 мин. Если после перелёта NPC не рядом — запись в журнал и повтор через 30 мин.
- Выключатель `cfg.goddardQuest` (ВКЛ) в «Квесты»; работает и без задачи «Квесты». Взять квест — только игрок.

## Не проверено

- Как открыть Scout Adrian: хватит ли телепорта в Варку для `atScoutAdrian` — нужен лог с первой сдачей у Adrian.
- Падает ли ткань всегда и как она видна в награде боя.
- Считаются ли мобы в группе/AoE и чемпионы для охоты.
