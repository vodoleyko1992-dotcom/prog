# L2wap Bot — контекст для работы в Claude Code

Браузерное расширение (Chrome MV3 + сборка для Firefox 128+), бот для браузерной игры **l2wap.com** (Lineage-2-подобная, интерфейс игры на украинском, журнал бота на русском). Текущая версия: **7.2.2**. Код — ванильный JS без сборщика, ~12 000 строк. Все комментарии и журнал — по-русски, в комментариях принято ссылаться на версию и лог, по которому сделана правка («7.1.26 (лог 10.10 14:11): …»).

## Игрок и его правила (обязательно соблюдать)

- Персонажи: **Warlock** (Human Wizard → Warlock, 2-я профессия взята 10.10), ~50 ур., маг с котом-слугой (Mew/Kai the Cat) — основной. **Спойлер** (гном: Scavenger/Bounty Hunter) — «спойлить ресурсы на крафт». West (воин) — редко.
- Спойл: **Sweeper не нужен** — игра собирает спойл сама; бот только считает «Спойл: X ×N» как ресурс X. Фарм ресурса/рецепта — по базе форума (дроп + спойл у спойлера): телепорт к лучшей точке, источники — цели при любом уровне, автофарм с точки не уводит.
- **Никогда не собирать zip без явной команды «сборка»**. Правки делать сразу, сборку — только по команде. Каждая сборка — **две** версии: `l2wap-bot-v<версия>.zip` (Chrome) и `l2wap-bot-v<версия>-firefox.zip` (игрок 10.10: «пока без Firefox» — пока только Chrome). В имени никаких суффиксов вроде «fix chrome». Нумерация последовательная: после 7.1.31 — **7.2** (по просьбе игрока), дальше 7.2.1, 7.2.2…
- **Перед каждой сборкой и каждым коммитом — все проверки** (игрок 10.10: «тесты нужно проводить всегда, чтобы я баги не ловил»): `node tests/run-all.cjs` (все PASS), `node --check` всех js, проверка геттеров модулей, на каждое исправление — новый тест; перед сборкой — ещё браузерные смоуки и загрузка собранного zip в Chromium. Что не удалось проверить — честно написать в ответе. Пакет расширения — без tests/, архив `-src.zip` с тестами — только по просьбе.
- Рабочий цикл: игрок **просто присылает логи** (`l2bot-log-*.txt`, `l2wap-pages-*.html` — снимки страниц, `l2bot-learn-*.html`, иногда `l2bot-memory-*.json` / `l2bot-settings-*.json`). Задача — самому найти ошибки и повторы багов и исправить. Каждую находку в ответе объяснять простым языком: что было в логе (со временем), почему, что исправлено, что проверено, что НЕ проверено в живой игре.
- **TvT по умолчанию всегда ВКЛ.** «Проверять карту каждые 0 боёв» = никогда не проверять карту (только цепочка «Охотиться дальше»). Исключение (выбор игрока): активная цель «ресурс»/«рецепт» на своей точке — карта раз в 5 боёв (farmMapOn, не реже 10 при большом N).
- Бот должен **стоять там, где его оставили** (пока «Автофарм» выключен): бить ★-цели квестов, иначе мобов этой локации (даже ниже уровня). Никуда не улетать самостоятельно.
- Автомагистр выключен по умолчанию — скиллы игрок учит сам. Кубиков у Warlock на этом сервере пока нет (игрок написал админу).
- Заряды (соски) — строго под **надетое** оружие: грейд оружия → грейд зарядов; маг. оружие → «Благословенний заряд духу» (blessed spiritshot), физ. → «Заряд душі воїна» (soulshot). Сейчас надет Demon's Staff (C).
- Настройки и память игрока встроены как **базовый профиль** (`base-profile.json`): применяется только в пустую установку (важно для Firefox: временное расширение стирает данные при перезапуске). Обновлять по присланным `settings`/`memory` экспортам.
- **Безопасность**: пароль автологина (storage-ключ `auth`) никогда не попадает в журнал, снимки, экспорт, базовый профиль. Никакого автоматического решения капчи/антибота.
- **MP не экономим — приоритет ДПС** (игрок 10.10: «банки МП всегда можно легко купить… нас интересует ДПС, нам ещё РБ убивать»). Никаких «экономных» тактик по умолчанию, которые стоят времени (добивание котом — по умолчанию ВЫКЛ). Режим экономии MP — только когда банки MP нет вообще.
- Удочки можно случайно продать — бот сам покупает одну; наживка: обычная «Fishing Lure» за адену, «Якісна наживка» только из Old Box/за Proof.

## Структура

```
manifest.json          MV3, version + version_name (тесты сверяют строку версии!)
background.js          service worker: замок вкладки (lockAcquire/Renew/Release, эпохи), statePatch/menuPatch (MAX_PATCH_KEYS 400),
                       charSwitch, heartbeat/watchdog, applyBaseProfile (install/update/startup), журнал в IndexedDB
hook.js                MAIN world: перехват fetch/XHR игры → postMessage {__l2bot:'net'|'netStart'} (пароли/токены вырезает)
content.js             ядро (~3700 строк): main() цикл, setRt/rtWriter (очередь патчей), DEF_CFG/DEF_RT, миграции once(),
                       сетевой обработчик (profQuestNote, weaponEquipNote, SHOP_BUY, PET), автообучение, док-панель
engine-core.js         createPatchQueue, domRace и прочие чистые функции (тестируются)
battle-cooldown.js     модель откатов: серверный GCD + индивидуальные, привязка к spawn
modules/*.js           фабрики L2V7Factories.<name>(env) → L2V7Modules.<name>; зависимости только через env.X
popup.html/js, ui-v7.* меню: 7 разделов (overview, hunt, rb, fish, panel, supply, svc; бывшие — подразделы с меткой
                       #tab-<старый>, TAB_GROUP в popup.js), «Чем занят бот» (setMode/paintModes — ровно один режим),
                       скрытие по классу (data-cls="fighter|mage|spoil" + html.cls-mage/cls-fighter/cls-spoil, «показать всё»)
skills-il.js, items-il.json   справочники Interlude (скиллы по id, предметы: грейд, тип, P/M.Atk)
base-profile.json      базовый профиль игрока (cfg + chars.Warlock.rt + learn + farmDb)
tests/                 node tests/run-all.cjs (77 PASS), *.py — playwright-смоуки (CHROMIUM=/opt/pw-browsers/chromium)
CHANGELOG-7.1.*.md     история правок, по файлу на версию
```

**Важное правило модулей:** модуль обращается к ядру только через `env.X`. Для каждого `env.X` в content.js у фабрики этого модуля должен быть геттер `get X(){return X}` в объекте `L2V7Modules.<name> = L2V7Factories.<name>({...})`. Пропущенный геттер = `undefined` в рантайме. Проверять скриптом (сравнить `env\.(\w+)` в модуле с `get (\w+)\(\)` в его фабрике); тест `v7-modules.test.js` ловит часть.

Модули: combat (бой, magePlan/dpsPlan/debuffPlan, кот, банки, potSlotRestore, сторожа), mobfarm (карта, candidates, цепочка «Охотиться дальше», автофарм-кик), navigation (zoneRate/zoneScore/zonePick, zoneForLevel, телепорт), quests (кампания, isQuestName), economy (магазин: shopPlan/shopBuyOne, shotGrade/weaponIsMage), equipment (сканер инвентаря, rankWeapons — грейд важнее цифр, никогда не даунгрейд), fishing (рыбалка целиком), raid, epics, tvt, buffs, resources, loot, survival, dungeons.

## Как устроено состояние

- `cfg` — настройки (общие + `cfg@Ник`), `rt` — память персонажа (`rt@Ник`), `learn`, `farmDb`, `on`, `paused`, `lock`, `auth`.
- Вкладки пишут в `rt` только патчами через `setRt(patch)` → `rtWriter` → background `statePatch`. Писать может только вкладка-хозяин замка. `rt` в памяти вкладки = `{...DEF_RT, ...storage}`.
- Разовые миграции — `once('flag', fn)` в content.js (~строка 3650): флаг теперь пишется и в `rt`, и в `cfg`. Новые правки настроек по умолчанию делать через `once`.
- Крупные ключи rt: `spawns` (кэш спавн→имя/уровень), `zoneStat` (EXP/ч по зонам и уровням героя), `skills` (замеры урона/MP/КД), `lootStat`, `hardMobs`, `questSeen`, `profQuest`, `weapons`/`weaponEq`, `debuffStat`, `petResummon`.

## Игровое API (что бот видит в сети)

`/game/battle/start|action|sync|hunt-continue` (action: `l2_<id>`, `attack`, `battle_potion_use`), `/game/map/spawns`, `/game/drops-shop/buy {shopKey:"consumable/blessed_spiritshot_c", qty}`, `/character/equip {action:'equip'|'unequip', itemId}`, `/character/profession-quest/<class>/status` (kills[], stage, completed), `/game/fishing/action` (cast/pumping/reeling/selectBait/selectRod/buyFishingSpot/buyFishingTime), `/game/fishing/buy-starter {offerKey: starter_rod|bait_x10|soulshot_x50}`, `/game/tvt`, `/game/teleport`, `/character/skills/learn`. В ответах боя — `activeSummon {key,hp,maxHp}`, `globalCooldownUntilMs`.

ID предметов: BSPS (blessed spiritshot) NG 3947, D 3948, C 3949, B 3950, A 3951, S 3952; soulshot NG 1835, D 1463, C 1464.

## Разметка игры (ключевые селекторы)

- Бой: `.l2-battle-hotbar-slot[data-slot-cd="l2_1220"]`, `#battle-victory-hunt` («Охотиться дальше»), `#battle-mob-hp-val`, `#l2-hud-companion` (кот), окно слота `.l2-battle-hotbar-modal` → `.l2-battle-hotbar-tab[data-tab-key=consumable]` → `.l2-battle-hotbar-pick[title="Зілля мани (велика банка) ×150"]`.
- Карта: `#map-mob-list a.l2-map-mob-link` («★ Giant Fungus · ур. 40», `--champion`, `--raid`), `#map-mob-markers[data-l2-marker-sig]` (типы: champion/raid/epic_guard), пагинация `#map-mob-page-next`. Миньоны эпика = spawnId `l2dop_eg_*`, РБ = `l2dop_rb_*` — не цели фарма.
- Магазин `/gm-shop.html`: `.l2-drops-shop-tab[data-category|data-grade|data-consumablesub]`, строки `.l2-gm-shop-row--grade-d` с `.l2-gm-shop-name`, модалка `#l2-drops-shop-buy-qty-modal` (`[data-buy-qty-input]`, `[data-buy-qty-confirm]`).
- Рыбалка `/fishing.html`: хотбар `.l2-fishing-hotbar-slot[data-slot=fishing|pumping|reeling|soulshot|basicBait|goodBait]` (выбранное — `--toggle-on`; **счётчик невыбранной наживки читается как 0**), `#fishing-gear-row`, `#fishing-target`, `[data-action=open-rod-select]` / `#fishing-rod-select-list`, `#fishing-shop-open` / `#fishing-starter-offers [data-offer]`, `#fishing-spot-buy`, `button.l2-fishing-trainer-learn-btn[data-skill]`.
- Инвентарь `/char.html`: `.l2-char-bag-row[data-item-json]`, `img[data-l2-slot="weapon"]`, `.l2-char-bag-equip--wear`.
- Украинские имена заклинаний в логе боя: Vampiric Touch = «Вампірний дотик», Aura Burn = «Опік аури», Energy Bolt = «Енергетична блискавка», Blaze = «Полум’я». Дебафф прошёл: «Ефект пройшов (72%)».

## Скиллы Warlock на L2WAP (скрин магистра 10.10 — описания отличаются от Interlude!)

- Ударные заклинания все на максимуме ранга и дальше не растут: Blaze 8/8 (Power 44), Aura Burn 8/8 (36), Energy Bolt 4/4 (22), Wind Strike 5/5 (21), Flame Strike 3/3 (19), Ice Bolt 6/6 (16, MP 20, замедление), Vampiric Touch 6/6 (18, вампиризм 40 %). Урон мага растёт только от M.Atk.
- Коты: P.Atk кота = +X % от **M.Atk хозяина** — Kat +15 % (7/18), Mew +20 % (7/18), **Kai +25 % «основний DD-слуга»** (3/14). Кот «автоматично атакує разом із власником». Кристаллы на призыв на этом сервере не нужны. Лог кота: «Слуга [Kai the Cat] атакує [моб] 1 409 урону.» / «… завдає критичного удару [моб] 5 721 урону.» / «… промахнувся» (Kai Lv.3: удар ≈1500, промах 16 %, крит 2 %).
- **«В бою эффекта нет»**: Servitor Wind Walk 2/2 (иконка skill1144 = в IL «Fast Servitor»!), Body To Mind 2/5 → бот не жмёт (`noEffect`: `NO_EFFECT_DEF` + описание из `rt.skillDb`, страница «Умения» = `/magister.html?mode=learned`).
- Дебаффы: Surrender to Fire = M.Def −10 % (не огонь!); Curse Chaos = P.Atk −12 % и M.Def −10 % (не точность); Curse Weakness −20 % P.Atk на 10 с, 80 % шанс; Curse Poison −12 % P.Atk; Slow — скорость ×0,7 (бесполезно); Poisonous Cloud — 120 × 6 тиков по 5 с (на обычном мобе ≈1 тик).
- Лечение: Heal = Power×4 + уровень×3 + ранг×5 (Power 67 → ≈430 HP на 50); **Corpse Life Drain** (игрок поставил вместо Heal, лог 10.10 20:52) — лечит себя в бою по ЖИВОЙ цели, 178 HP на 51/р.5, MP 0, повтор ≈2 с, кот бьёт и на этот ход → `IL_FIX` в content.js (c Лечение, t HEAL); у мага сначала Vampiric Touch, если готов. Self Heal 42 HP.
- Пассивы робы: Spellcraft — в полной Robe скорость каста ×2, без Robe −50 %; Mana Recovery — реген MP +20 % только в Robe; Magician's Movement. Броню бот пока не проверяет.
- Transfer Pain, кубики, Servitor Haste/Shields — на сервере пока нет.

## Замеры (по реальным логам Warlock ~50)

Blaze ≈895 урона/22 MP/КД 3,1 с; Aura Burn ≈847/25/2,2; Energy Bolt ≈773/8/2,2 (лучший урон на 1 MP); Vampiric Touch ≈657/12. Кот ≈35–40 % урона (≈1100 за удар). Атака мага ≈1 урон (бесполезна). Ход ≈1,23 с. Цепочка «Охотиться дальше» ≈5,4 с/моб против ≈11,4 с через карту — главный резерв скорости. Зоны (EXP/ч на 49–50): Blazing Swamp ≈6,8 M, Forest of Mirrors ≈4,1 M, Field of Silence ≈3,65 M, Pavel Ruins ≈2,6 M.

## Как проверять

```
cd <repo> && node tests/run-all.cjs            # 77 PASS; при смене версии обновить строку версии в tests/stage1,stage3,ios-fishing,v71-ui,v6-core
for f in content.js background.js popup.js modules/*.js; do node --check $f; done
```
Playwright-смоуки с реальным расширением (headless Chromium, подмена l2wap.com маршрутами): примеры были в scratchpad (base60.js — базовый профиль, shop60.js — магазин, fishsetup.js — настройка рыбалки, pausetest.js — меню/пауза, equipnet.js — надевание по сети, profq.js — квест профессии, baitswap.js — смена наживки, fishstall.js — зависание рыбалки). Схема: `chromium.launchPersistentContext` с `--load-extension`, `ctx.route('https://l2wap.com/**')` отдаёт мок-страницу, storage через service worker, итог читается из `chrome.storage.local`.

**Сборка:**
```
zip -qr l2wap-bot-v7.1.NN.zip . -x 'tests/*' -x '*.orig'
# Firefox: копия без tests, в manifest.json: background: {scripts:["background.js"]}, убрать minimum_chrome_version/version_name,
# добавить browser_specific_settings.gecko {id:"l2wap-bot@local", strict_min_version:"128.0"}; зип -firefox
# проверить: grep -ci 'passw\|"auth"' base-profile.json → 0
```
Firefox ставится как временное дополнение (`about:debugging#/runtime/this-firefox`); после перезапуска браузера данные стираются → срабатывает базовый профиль.

## Последние версии (что уже сделано)

- 7.2.3 (не собрана; лог 23:17–23:19): городской набор не понижает активные баффы (buffs.tbDowngrade, hudLevels «· Lv.N», rt.tbLvl со страницы баффера); недобитый РБ первым (rt.rbWound, raid.rbWounded); повтор призыва кота через ≈2 с. Сет Авадон (мантия): M.Atk +12 %, каст +10 %, маг. крит урон +9 %, HP/MP/CP. Лог 23:30: запас по сумке из сети (hook.js `inv` — полный `inventory.stacks`, content INV_NET/invQty в sessionStorage, economy.shopNeedByPanel; redact в hook режет массивы до 8!), заряды 1000/5000 (once shots723), закупка в туре РБ только между боями (raid.rbShopFirst: все расходники, force; при отходе — магазин и обратно к тому же РБ), окно-индикатор не прыгает (engine-core.stickyFree, localStorage l2bot-indw).
- 7.2.2 (логи 22:10–23:07, экспорты 22:40): РБ-сессия с баффом FA; список «что фармить» как на форуме (popup renderTree, поиск, 🎯); диапазон уровней источников cfg.farmLvlBelow/Above (−3…+5, farmWin/farmFit, inWin в приоритете); базовый профиль из экспортов 22:40; потерянный клик → заклинание «занято» 0,7 с (combat.lostUntil); итог боя с раненым РБ — от HP на входе.
- 7.2.1 (логи 10.10 21:05–21:31): дебаффы по L2WAP (IL_FIX 1083/1222/1164/1168: mDefDown/pAtkDown) + замер выгоды `rt.debuffGain` (spellSample из observeSlot через BUFF_CTX); банка маны не попадает в «Банку HP»; **цепочка: игра шлёт battleSpawnId первого боя, а URL меняется** — откаты по `cdSpawn()`/`GAME_SPAWN`, принятый сервером ход (ACT_NET.ok) засчитывается, потерянный клик без ожидания; средний урон — последние ≈40–60 замеров; кампания убрана (квесты игрок ведёт сам, once camp721), «Квесты на ресурсы» только счётчик; нет своих рядом — свои дальше по локации до телепорта; слот зарядов не того грейда заменяется (shotSlotSwap: «#id»/цвет иконки); Servitor Ultimate Defense не бафф кота. РБ: окно карты должно показать этого РБ (rbModalIs: NPC из spawnId), спецудар ×rbSpK() по боям, «не по силам» по оценке — только пропуск 30 мин, РБ невосприимчивы к дебаффам (rt.debuffImmune), индикатор `#l2bot-ind.wide` по левому краю. Рыбалка: учёт после поимки фоном (fishStat/bg), наживка «Авто» по замеру Proof/ч (rt.fishBaitStat, rt.fishVal по разделке, rt.fishRates из магазина; хорошая за Proof — только если +0,3 Proof/заброс). Заточка удочки — только шанс Old Box +1 %/ур., урон не растёт. РБ-сессия (rt.rbSess, cfg.rbSessBuffs/rbSessNob, raid.rbSessTick/rbSessEnd): баффы FA по 1/5 FA на 3 ч, покупка один раз, после смерти только Noblesse (1323), конец → автофарм. FA с мобов, Coin of Luck донатная. Свой откат по нажатию (combat.ownLeft) не перекрывается серверным «готов».
- 7.1.21–7.1.23: авто-настройка рыбалки на новом персонаже; экономия MP; простой на 0 MP; раздел «Дебаффы»; охрана эпика не цель; квест профессии как ★-цели; карта раз в 10 боёв.
- 7.1.24–7.1.26: базовый профиль из экспортов; магистр вручную; выполненные ★ пропускаются; с локации не улетать; заряды по надетому оружию + проверка грейда в магазине; банка сама возвращается на панель.
- 7.1.27: 15 багов после 2 ревью (перезагрузки по кругу, кот, спам журнала, TvT ↔ рыбалка, рыбалка-настройка).
- 7.1.28: кнопка «⏸ Пауза / ▶ Продолжить»; раздел и быстрый режим «🗺 Автофарм» (по умолчанию ВЫКЛ; при ВКЛ сразу проверяет зоны, включает цепочку); zonePick по соседним уровням со сглаживанием (симуляция: ≈6,1 M вместо ≈3,1 M EXP/ч); оружие: грейд важнее цифр, никогда не даунгрейд, надевание видно по сети.
- 7.1.29: смена наживки, покупка удочки, заточка раз в 100 рыб, сторож зависания рыбалки.
- 7.1.30: глубокий аудит (4 ревью, 27 правок) — см. CHANGELOG-7.1.30.md.
- 7.2 (лог 10.10 20:08–20:53): isBoss/isChamp — метка только в приписке после имени (Hatar Ratman Boss ≠ РБ), Corpse Life Drain = лечение (IL_FIX), базовый профиль без снаряжения/панели + заряды только после чтения инвентаря (rt.weaponsT).
- 7.2: спойлер — свип убран, «Спойл: X ×N» = ресурс X, фарм ресурса по дроп + спойл (farmRowParse → r.sp, farmZones sp/spK, canSpoil), lootGoal держит на точке фарма (автофарм не уводит), источники вне окна уровней (farmT в candidates), профиль боя «Авто» у нового героя.
- 7.2 (было 7.1.32): меню — один режим «Чем занят бот» (6 режимов + дополнения Кампания/РБ между мобами/TvT), 15 разделов → 7, настройки под класс; TvT по умолчанию ВКЛ; «Проверять карту каждые 0 боёв» = НИКОГДА (только цепочка; mapOff в content.js).
- 7.1.31: раздел «🐱 Слуга» (`tab-pet`), статистика котов `rt.petStat` (hits/hitDmg/crits/misses/acts/deaths/summons) + `rt.petAdvice` (после 30 боёв), добивание с учётом удара кота (`petExpect` в magePlan; только при MP < petFinishMp 80 %), баффы кота (`nPetBuffs`, `rt.petBuffAt`, `rt.petBornT`), `noEffect` по `rt.skillDb[..].desc` (Body To Mind больше не жмётся), Corpse Life Drain не удар; по логу 10.10: zoneForLevel → сразу лучшая замеренная зона, дебаффы по окупаемости, спам «Обнаружен питомец», тотем воина у мага.

## Известные ограничения / что дальше

- Память `rt` — один блок ~180 КБ, переписывается целиком при каждом обновлении статуса; срезание по возрасту есть, раздельное хранение (`spawns` отдельным ключом) — задача на будущее.
- Состояние подбора зон размазано по меткам `zoneGoT/zoneLvlT/zoneTrialT/zoneExploreT/zoneTried/zoneBad` — кандидат на один маленький стейт-машин.
- Кубики — встроить, когда появятся у Warlock. Баффы кота уже есть (роль «Баффы кота»), ставятся только в бою.
- Дебаффы мага (7.2.1): по механике L2WAP и замеру выгоды. Стакается ли Chaos с Surrender — неизвестно (замер покажет). Квесты — вручную (игрок 10.10), бот только бьёт ★ первыми.
- Чемпионы очень выгодны (лог 10.10: ≈46–49 тыс. EXP + 47–73 тыс. аден за ≈6–10 с против ≈4 тыс. EXP у обычного моба).
- Этап квеста профессии с чемпионами («Резонанс 1/3») виден только на странице NPC — бот его не ведёт.
- Ничего из 7.1.29–7.1.30 ещё не подтверждено живым логом — первым делом попросить лог за 1–2 часа и проверить: смену наживки, выбор зоны при автофарме, отсутствие повторных перезагрузок.
