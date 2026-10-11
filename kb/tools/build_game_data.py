# -*- coding: utf-8 -*-
"""Игровые данные L2wap Bot → kb/data/*.json (мобы, зоны, РБ/эпики, скиллы, предметы, фарм, рыбалка, персонаж).

Источники — только файлы репозитория: base-profile.json (память Warlock: rt.*, farmDb, learn), константы кода
(modules/*.js, content.js, popup.js), тестовые фикстуры (tests/fixtures-*.json), справочники Interlude (skills-il.js,
items-il.json) и вручную выписанные из CLAUDE.md / CHANGELOG-*.md / навыков факты (таблицы DOC_* ниже, с источником).
Запуск: python3 -I kb/tools/build_game_data.py
"""
import os, sys, re, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kblib as K

JUNK = re.compile(r'^(Вход в бой|Вхід у бій)|…$')
BP_NOTE = 'base-profile.json (экспорт памяти Warlock 10.10.2026 22:40 UTC+10, версия 7.2.1; дополнения 8.0/8.0.3)'


def low(s):
    return str(s or '').strip().lower()


# =====================================================================================================
# Факты из документации (CLAUDE.md, CHANGELOG-*.md, .claude/skills/*) — с источником
# =====================================================================================================
DOC_ZONE = {
    'blazing_swamp': [('≈6,8 M EXP/ч на 49–50 ур.', 'CLAUDE.md «Замеры»'), ('≈4,6–6,8 M EXP/ч', 'CHANGELOG-7.1.28 (симуляция по замерам)'),
                      ('≈5,8 M EXP/ч (куда автофарм перекинул 10.10 19:39)', 'CHANGELOG-7.1.31'),
                      ('зона помечена «плохой» (rt.zoneBad, время метки — в zoneBad_t)', BP_NOTE)],
    'forest_of_mirrors': [('≈4,1 M EXP/ч на 49–50', 'CLAUDE.md «Замеры»')],
    'field_of_silence': [('≈3,65 M EXP/ч на 49–50', 'CLAUDE.md «Замеры»')],
    'pavel_ruins': [('≈2,6 M EXP/ч на 49–50 (замер с Demon\'s Staff C)', 'CLAUDE.md; CHANGELOG-7.2.1'),
                    ('≈2,2–2,9 M EXP/ч — бот «месяцами» сидел здесь до 7.1.28', 'CHANGELOG-7.1.28'),
                    ('≈4,58 M EXP/ч на 52 ур. с Sprite\'s Staff B, 299 боёв, бой ≈1,25 с (лог 10.10 21:18–21:31)', 'CHANGELOG-7.2.1'),
                    ('точка у Фальстона (мобы 75–80) ошибочно писалась как Pavel Ruins; замеры ≥55 ур. удалены миграцией', 'CHANGELOG-8.0.4; content.js:781')],
    'den_of_evil': [('≈6,52 M EXP/ч на 51 ур. (зоны 51–52 из шапок журналов 10.10 18:17–21:46)', 'CHANGELOG-8.0')],
    'antharas_lair': [('≈1,46 M EXP/ч — выбиралась на 53 ур. после переустановки без замеров (баг, исправлен)', 'CHANGELOG-8.0')],
    'enchanted_valley_north': [('≈1,6 M EXP/ч — ближайшая по уровню зона, куда бот улетел 10.10 19:35 (лишний телепорт)', 'CHANGELOG-7.1.31')],
    'enchanted_valley_south': [('зона «плохая» (zoneBad) по метке 10.10', BP_NOTE)],
}

DOC_RB = {
    '25158': [('M.Atk 7287, спецудар ≈108 % HP героя; 10.10 21:33:04 героя с полных 4022 HP убили одним ударом (бот прочёл окно другого РБ)', 'CHANGELOG-7.2.1, 8.0.3'),
              ('трижды стоил 100 000 аден телепорта «вслепую» после переустановки (логи 10–11.10)', 'CHANGELOG-8.0.3')],
    '25050': [('спецудар 2600 при M.Atk 3110 (≈60 % HP героя); оценка «на глаз» давала 1055', 'CHANGELOG-8.0')],
    '25013': [('спецудар 1853 при M.Atk 2217; 10.10 23:23:16 HP героя 4037 → 1866 (спецудар 1853 + удар ≈318), бой выигран 23:25:06', 'CHANGELOG-8.0; tests/v803-rbflee-single.test.js'),
              ('получал «не по силам» посреди боя, потом был убит', 'CHANGELOG-8.0')],
    '25437': [('реальный спецудар ×4,3 обычного (1344 при ≈313) — модель давала ×6,8', 'CHANGELOG-7.2.1'),
              ('итог «576 831 HP за 32 с · ДПС 18 026» ложный: у него оставалось 87 359 HP с прошлого захода', 'CHANGELOG-7.2.2'),
              ('смерть 10.10 21:39:12 после 6 мин боя (банка HP пила «Зілля мани»)', 'CHANGELOG-7.2.1')],
    '25277': [('недобита: оставалось 156 417 из 507 285 HP; герой погиб с 4 619 HP на первом действии (10.10 23:18:38)', 'CHANGELOG-7.2.3')],
    '25088': [('M.Atk 4204 → бот отклоняет (8.0); один лишний телепорт 10.10 22:18 после чистки замеров', 'CHANGELOG-8.0, 7.2.2')],
    '25434': [('11.10 10:31:48–10:32:18: ответ на ход висел 28,6 с (409), бот жал вслепую 20 с, смерть; РБ оставался на 71 %; был ошибочно заблокирован до 57 ур.', 'CHANGELOG-8.0.4; tests/v803-death.test.js')],
    '25423': [('смерть в туре РБ (лог 11.10 00:37); 11.10 09:59:55 клик аварийной банки потерян в окне занятости игры', 'CHANGELOG-8.0.4; tests/v803-lockretry.test.js')],
    '25099': [('10.10 22:10–22:23: убит за 2:46 (+685 тыс. EXP, +186 тыс. аден, +335 тыс. SP)', 'CHANGELOG-7.2.2')],
    '25418': [('РБ-сессия под FA 10.10 22:30–23:07: убит за ≈82 с', 'CHANGELOG-7.2.2')],
    '25438': [('РБ-сессия под FA: убит за ≈82 с', 'CHANGELOG-7.2.2')],
    '25431': [('РБ-сессия под FA: убит за ≈82 с; 10.10 21:33 его окно (HP 273375) бот принял за окно Тарлка', 'CHANGELOG-7.2.2, 7.2.1')],
    '25441': [('РБ-сессия под FA: убит за ≈90 с', 'CHANGELOG-7.2.2')],
    '25173': [('РБ-сессия под FA: убит за ≈90 с', 'CHANGELOG-7.2.2')],
    '25484': [('10.10 23:19–23:30: бой начинался при 139 B-зарядах (минимум был 500) — закупки не было', 'CHANGELOG-7.2.3')],
    '25322': [('11.10 10:32: после смерти 4 × 100 000 аден за РБ 60–66 за 20 с, каждый «не по силам» уже на месте', 'CHANGELOG-8.0.3')],
    '29014': [('Орфен бил КАЖДЫМ ударом 2508–2885 = 0,64–0,74 × P.Atk 3920 (крит почти не больше), = 40–57 % HP героя 56 ур.', 'modules/raid.js (комментарий 8.0.3); CHANGELOG-8.0.4'),
              ('в навыке l2-game-facts тот же удар записан как 0,79–0,90 × M.Atk (3192) — два способа выразить одно и то же; оценка бота до замера: 0,7 × max(P.Atk, M.Atk)', '.claude/skills/l2-game-facts; CHANGELOG-8.0.4'),
              ('11.10 01:45 старая версия бота сама потратила Coin of Luck на телепорт к Орфену и Ядру (2 CoL)', 'CHANGELOG-8.0.3')],
    '29006': [('11.10 01:45: старый бот потратил CoL на телепорт; 11.10 11:43 «Ядро(50)=?@bee_hive» — зона писалась из прежней', 'CHANGELOG-8.0.3; modules/raid.js')],
}

# 10.10 22:30–23:07 сессия под FA — общая статистика
DOC_RB_GENERAL = [
    ('спецудар РБ = 0,71–0,90 × M.Atk у 11 РБ; от P.Atk разброс 2,2–7,2 (спецудар магический)', 'CHANGELOG-8.0; skill l2-game-facts'),
    ('урон по РБ ≈3 100–3 400/с под FA-баффами против ≈1 650–1 700/с без; РБ 44–45 ур. дают ≈575–810 тыс. EXP и ≈185–240 тыс. аден', 'CHANGELOG-7.2.2'),
    ('8 РБ за 37 мин (10.10 22:30–23:07) без смертей', 'CHANGELOG-7.2.2'),
    ('телепорт к РБ 100 000 аден: POST /game/raid-boss/teleport {spawnId, expectedRevision, expectedAdenaCost}', 'skill l2-game-facts'),
    ('РБ невосприимчивы к дебаффам: «Raid Boss має імунітет до негативних ефектів» (rt.debuffImmune.rb)', 'CHANGELOG-7.2.1'),
    ('HP РБ сохраняется на сервере между заходами (недобитый РБ первым в туре)', 'CHANGELOG-7.2.3'),
    ('8.0 до 8.0.3: 3 из 18 телепортов впустую; 10 боёв с РБ на 8.0: 1302 потерянных нажатия на 1689 ходов, ДПС 1436–1606 вместо 3100–3350', 'CHANGELOG-8.0, 8.0.3'),
    ('сервер пускает к эпикам/РБ не ниже «герой − 9» (minRaidBossLevel); «Raid Boss нижче дозволеного рівня.» — отказ', 'tests/fixtures-epic-bosses-803.json; rbList'),
]

# Персонаж: хронология по документам
DOC_LEVELS = [
    ('09.10', 10, 'Human Mage (human_mage); на панели Wind Strike (l2_1177), Heal, Зілля мани', 'WARLOCK-TO-78-RU.md'),
    ('10.10 ночь (00:18–07:35)', '30→47', 'ночной журнал; MP 1838–2055, бился с MP 0–200 без банки на панели', 'CHANGELOG-7.1.20'),
    ('10.10 ~00:20', None, 'MP 928 («70 из 928»), Staff of Life D (M.Atk 72)', 'CHANGELOG-7.1.17'),
    ('10.10 13:22', None, 'квест 2-й профессии (Алхімік Орфеус «Еліксир Трьох Сил»: Giant Fungus 0/100, Dire Wyrm 2/15)', 'CHANGELOG-7.1.23'),
    ('10.10 14:11', 50, 'мобы локации 40–42 при герое 50', 'CHANGELOG-7.1.26'),
    ('10.10', None, '2-я профессия Warlock взята 10.10', 'CLAUDE.md'),
    ('10.10 19:35–19:45', None, 'Kai the Cat Lv.3: удар ≈1500 (1300–1670), крит 5721 (2 %), промах 16 %', 'CHANGELOG-7.1.31'),
    ('10.10 20:52', 51, 'Corpse Life Drain +178 HP = 51×3 + ранг 5×5', 'CHANGELOG-7.2'),
    ('10.10 21:05–21:31', 52, 'Sprite\'s Staff B с 21:07, Kai', 'CHANGELOG-7.2.1'),
    ('10.10 22:10–23:30', '52–53', 'heroMaxHp 4022 (52) / 4113 (53) в rt.rbDb', BP_NOTE),
    ('11.10 09:03', 54, 'characterLevel 54 в ответе /game/epic-bosses', 'tests/fixtures-epic-bosses-803.json'),
    ('11.10', 56, 'Warlock 56 ур.; с 11.10 есть Feline Queen', 'CLAUDE.md'),
]

WEAPONS = [
    {'name': 'Voodoo Doll (Лялька вуду)', 'il_id': 100, 'grade': 'NG', 'when': 'до 10.10 15:38; бот ошибочно надевал её вместо посоха D (7.1.28)', 'src': 'CHANGELOG-7.1.17, 7.1.28'},
    {'name': 'Staff of Life (Посох життя)', 'il_id': 189, 'grade': 'D', 'when': '10.10 00:50 (M.Atk 72); базовый профиль 7.1.26', 'src': 'CHANGELOG-7.1.17, 7.1.26'},
    {'name': "Demon's Staff", 'il_id': 206, 'grade': 'C', 'when': 'игрок надел 10.10 15:43 (бот узнал по POST /character/equip)', 'src': 'CHANGELOG-7.1.28, content.js weaponEquipNote'},
    {'name': "Sprite's Staff (Посох спрайта B-grade. Дворучна магічна зброя.)", 'il_id': 92, 'grade': 'B', 'when': 'с 10.10 21:07 (текущее по CLAUDE.md)', 'src': 'CLAUDE.md; CHANGELOG-7.2.1; cfg.nWeaponMain'},
]

# ID заклинаний Warlock (Interlude id = data-slot-cd l2_<id>; иконка skill<id>.gif в rt.skills подтверждает)
WARLOCK_SKILLS = {
    'Blaze': 1220, 'Aura Burn': 1172, 'Energy Bolt': 1274, 'Vampiric Touch': 1147, 'Wind Strike': 1177, 'Flame Strike': 1181, 'Ice Bolt': 1184,
    'Surrender to Fire': 1083, 'Curse Chaos': 1222, 'Curse Weakness': 1164, 'Curse Poison': 1168, 'Curse Gloom': 1263, 'Slow': 1160, 'Poisonous Cloud': 1167,
    'Corpse Life Drain': 1151, 'Heal': 1011, 'Self Heal': 1216, 'Body To Mind': 1157,
    'Summon Kat the Cat': 1111, 'Summon Mew the Cat': 1225, 'Summon Kai the Cat': 1276, 'Summon Feline Queen': 1331,
    'Servitor Heal': 1127, 'Servitor Recharge': 1126, 'Servitor Wind Walk': 1144, 'Servitor Ultimate Defense': 1299, 'Servitor Haste': 1141,
    'Servitor Magic Shield': 1139, 'Servitor Physical Shield': 1140, 'Transfer Pain': 1262, 'Summon Binding Cubic': 1279, 'Summon Storm Cubic': 10,
    'Spellcraft': 163, 'Mana Recovery': 214, "Magician's Movement": 118, 'Weapon Mastery': 250, 'Anti Magic': 146, 'Robe Mastery': 251, 'Higher Mana Gain': 285,
    'Cubic Mastery': 143,
}

# L2WAP-описания (скрин магистра 10.10; CLAUDE.md «Скиллы Warlock на L2WAP»)
L2WAP_SKILL = {
    'Blaze': {'rank': '8/8', 'power': 44, 'note': 'на максимуме ранга; лог: «Полум’я»'},
    'Aura Burn': {'rank': '8/8', 'power': 36, 'note': 'лог: «Опік аури»'},
    'Energy Bolt': {'rank': '4/4', 'power': 22, 'note': 'лучший урон на 1 MP; лог: «Енергетична блискавка»'},
    'Wind Strike': {'rank': '5/5', 'power': 21},
    'Flame Strike': {'rank': '3/3', 'power': 19, 'note': 'лог: «Удар полум’я»'},
    'Ice Bolt': {'rank': '6/6', 'power': 16, 'mp': 20, 'note': 'замедление'},
    'Vampiric Touch': {'rank': '6/6', 'power': 18, 'note': 'вампиризм 40 %; лог: «Вампірний дотик»'},
    'Surrender to Fire': {'note': 'L2WAP: M.Def цели −10 % (не огонь!); лог «Здача вогню»', 'il_fix': 'mDefDown'},
    'Curse Chaos': {'note': 'L2WAP: P.Atk −12 % и M.Def −10 % (не точность); лог «Прокляття хаосу»', 'il_fix': 'mDefDown+pAtkDown'},
    'Curse Weakness': {'note': 'L2WAP: P.Atk −20 % на 10 с, шанс 80 %; лог «Прокляття: слабкість»', 'il_fix': 'pAtkDown'},
    'Curse Poison': {'note': 'L2WAP: P.Atk −12 % (в Interlude — яд)', 'il_fix': 'pAtkDown'},
    'Slow': {'note': 'скорость ×0,7 — бесполезно'},
    'Poisonous Cloud': {'note': '120 × 6 тиков по 5 с (на обычном мобе ≈1 тик); в magisterSkip по умолчанию'},
    'Corpse Life Drain': {'rank': 'р.5 на 51', 'note': 'L2WAP: лечит себя в бою по ЖИВОЙ цели, HP = уровень×3 + ранг×5 (178 на 51/р.5), MP 0, повтор ≈2 с, кот бьёт и на этот ход; «Витяг життя з трупа»; в Interlude — маг. атака по трупу', 'il_fix': 'HEAL'},
    'Heal': {'note': 'Heal = Power×4 + уровень×3 + ранг×5 (Power 67 → ≈430 HP на 50); игрок заменил на Corpse Life Drain 10.10 20:52'},
    'Self Heal': {'note': '42 HP'},
    'Body To Mind': {'rank': '2/5', 'note': '«В бою эффекта нет» — бот не жмёт (NO_EFFECT_DEF)'},
    'Servitor Wind Walk': {'rank': '2/2', 'note': '«В бою эффекта нет»; иконка skill1144 = в Interlude «Fast Servitor» (бафф кота)'},
    'Servitor Ultimate Defense': {'note': 'с 7.2.1 не бафф кота (вешался 21 раз за 12 мин)'},
    'Summon Kat the Cat': {'rank': '7/18', 'note': 'P.Atk кота = +15 % от M.Atk хозяина'},
    'Summon Mew the Cat': {'rank': '7/18', 'note': '+20 % от M.Atk хозяина'},
    'Summon Kai the Cat': {'rank': '3/14', 'note': '+25 % от M.Atk хозяина, «основний DD-слуга»'},
    'Summon Feline Queen': {'note': 'с 11.10; support, +10 %, бафф физ. крита «Blessing of Queen» (магу бесполезен)'},
    'Spellcraft': {'note': 'пассив: в полной Robe скорость каста ×2, без Robe −50 %'},
    'Mana Recovery': {'note': 'пассив: реген MP +20 % только в Robe'},
    "Magician's Movement": {'note': 'пассив'},
    'Transfer Pain': {'note': 'на сервере пока нет'},
    'Servitor Haste': {'note': 'на сервере пока нет'},
}

DOC_SKILL_MEAS = [
    ('Blaze ≈895 урона / 22 MP / КД 3,1 с (старый замер, Warlock ~50)', 'CLAUDE.md «Замеры»'),
    ('Aura Burn ≈847 / 25 MP / 2,2 с', 'CLAUDE.md'), ('Energy Bolt ≈773 / 8 MP / 2,2 с — лучший урон на 1 MP (≈60/MP против Blaze ≈35/MP)', 'CLAUDE.md; CHANGELOG-7.1.22'),
    ('Vampiric Touch ≈657 / 12 MP; ≈665 урона + ≈266 HP', 'CLAUDE.md; CHANGELOG-7.2'), ('Атака мага ≈1 урон (бесполезна)', 'CLAUDE.md'),
    ('Ход ≈1,23 с; бой с цепочкой ≈0,7 с, ≈2,5 с на моба (лог 10.10 20:08–20:53)', 'CLAUDE.md; CHANGELOG-7.2'),
    ('С Sprite\'s Staff B Blaze ≈1800 (среднее из 5373 старых замеров показывало ≈900)', 'CHANGELOG-7.2.1'),
    ('Под FA-баффами Aura Burn 2 400–4 900 (было ≈1 700); Blaze ≈1730 → 2770–3100, крит 0 → 28–43 %', 'CHANGELOG-7.2.2, 8.0.3'),
    ('Откат сервера без FA ≈0,66–0,75 с (Blaze/AB); сервер принимал ход через ≈0,85 с с «Даром Серафима» и ≈1,1 с без — «КД 3,1 с» в старых замерах — артефакт', 'CHANGELOG-8.0.3; skill l2-game-facts'),
    ('Устаревшие «нижние границы»: Aura Burn 3,4 с при настоящих 1,1 с, VT 3,9 с (стерты once cdFloor80)', 'CHANGELOG-8.0'),
    ('Magnus\' Chant (1413) +13–18 % к урону заклинаний и кота — выгоднее «Дара Серафима» (4703, −30 % отката)', 'CHANGELOG-8.0.3'),
    ('Дебаффы на чемпионе: с 2 дебаффами бой 6,5 с и ДПС 832, без — 4,6 с и ДПС 1268; Blaze под дебаффами 1447, без — 1535', 'CHANGELOG-7.2.1'),
    ('Surrender to Fire = +11 % только к заклинаниям мага; ход окупается ≈9 заклинаниями', 'CHANGELOG-7.1.31'),
]

ITEM_PRICES_L2WAP = [
    # (что, цена, валюта, источник)
    ('Телепорт к РБ (тур)', 100000, 'адена', 'rt.rbList.price; skill l2-game-facts'),
    ('Телепорт к эпику', 1, 'Coin of Luck', 'tests/fixtures-epic-bosses-803.json (coinOfLuckCost 1, adenaCost 0)'),
    ('Благословенний заряд духу D ×3000', 114000, 'адена (≈38 за шт.)', 'CHANGELOG-7.2 (покупка 10.10 20:08:34)'),
    ('Наживка Fishing Lure: пакет bait_x10 (10 шт.)', 1000, 'адена (≈100 за шт.)', 'CHANGELOG-7.2.4, 8.0.3; skill l2-game-facts'),
    ('Рыболовные заряды: пакет soulshot_x50', 5000, 'адена (≈100 за шт.; 750 пак. = 3,75 млн)', 'CHANGELOG-7.2.4; 7.2.1 (≈540 аден на 5,4 шт.)'),
    ('Время рыбалки 1 ч / 2 ч / 3 ч / 6 ч', '3 000 000 / 5 500 000 / 7 500 000 / 14 000 000', 'адена', 'modules/fishing.js fishTimeTopUp prices'),
    ('Рыболовное место (#fishing-spot-buy), один раз', 10000000, 'адена', 'CHANGELOG-7.1.21'),
    ('Навыки Fishing / Pumping / Reeling у рыбака', 100000, 'SP каждый', 'CHANGELOG-7.1.21'),
    ('Свиток заточки удочки «Fishing Rod Enchant Scroll x1»', 100, 'Proof', 'modules/fishing.js; заточка до +10 = 1000 Proof (CHANGELOG-7.2.1)'),
    ('«Якісна наживка» (Good Fishing Lure) ×10', 3, 'Proof', 'CHANGELOG-7.2.1; modules/fishing.js'),
    ('Бафф Fast Aden обычный / Greater (Magnus\' Chant, Noblesse, Prophecy…)', '1 / 5', 'FA, на 3 ч', 'CHANGELOG-7.2.2; rt.faCat'),
    ('Городской «Звичайний баф»', 0, 'бесплатно, 24 ч (23 ч по панели)', 'content.js (комментарий); CHANGELOG-7.2.2'),
    ('Городской «Повний баф воїна/мага»', 15, 'Coin of Luck', 'content.js (комментарий городского баффера)'),
    ('Набор игрока для РБ-сессии (9 баффов)', 17, 'FA', 'CHANGELOG-7.2.2'),
    ('Награда TvT за победу', '500 000 аден + Coin of Luck + 2 Shil Coins', '—', 'content.js (комментарий v5.4 TvT)'),
    ('Плащ/тату/пояс рыбака D/C/B/A/S', '500/1500/3500/5000/8000 Proof + 0,5/1,5/5/15/50 млн аден', 'Proof + адена', 'popup.js GEAR_COST/GEAR_ADENA'),
    ('Один Proof по себестоимости рыбалки', '≈14 000 (7.2.1) / ≈15–18 тыс. (7.2.4)', 'адена', 'CHANGELOG-7.2.1, 7.2.4'),
]


# =====================================================================================================
def build_mobs():
    rt = K.rt_warlock()
    farm = K.base_profile()['farmDb']['res']
    fx = K.load_json('tests/fixtures-zones-7128.json')
    M = {}

    def mob(name):
        k = low(name)
        if not k:
            return None
        if k not in M:
            M[k] = {'name': name, 'levels': set(), 'spawnIds': [], 'zones': {}, 'flags': set(), 'sources': set()}
        return M[k]

    for sid, v in rt['spawns'].items():
        name, lvl = v[0], v[1]
        m = mob(name)
        m['levels'].add(lvl)
        m['spawnIds'].append(sid)
        m['sources'].add('rt.spawns')
        if 'champion' in sid:
            m['flags'].add('champion')
            m['flags'].add('quest_target')
    for z, names in rt['zoneMobs'].items():
        for n in names:
            if JUNK.search(n):
                continue
            m = mob(n)
            m['zones'].setdefault(z, set()).add('rt.zoneMobs')
            m['sources'].add('rt.zoneMobs')
    for res_key, r in farm.items():
        for t in r.get('drop', []):
            mname, lvl, ch, a, b, zk, zn = (list(t) + [None] * 7)[:7]
            m = mob(mname)
            m['levels'].add(lvl)
            if zk:
                m['zones'].setdefault(zk, set()).add('farmDb.drop')
            m.setdefault('drops_forum', []).append({'item': r['name'], 'chance': ch, 'min': a, 'max': b, 'zone': zk})
            m['sources'].add('farmDb.drop')
        for t in r.get('sp', []) or []:
            mname, lvl, ch, a, b, zk, zn = (list(t) + [None] * 7)[:7]
            m = mob(mname)
            m['levels'].add(lvl)
            m.setdefault('spoil_forum', []).append({'item': r['name'], 'chance': ch, 'min': a, 'max': b, 'zone': zk})
            m['sources'].add('farmDb.sp')
    for k, v in rt['hpMin'].items():
        m = M.get(low(k)) or mob(k)
        m['hpMin'] = v
        m['sources'].add('rt.hpMin')
    for k, v in rt['mobKills'].items():
        m = mob(k)
        m['kills_bot'] = v
        m['sources'].add('rt.mobKills')
    for k, v in rt['hardMobs'].items():
        m = M.get(low(k)) or mob(k)
        m['hard'] = {'lvl': v.get('lvl'), 'ttk_s': v.get('ttk'), 'why': v.get('why'), 't': K.iso(v.get('t'))}
        m['sources'].add('rt.hardMobs')
    for item, v in rt['lootStat'].items():
        for killer, n in (v.get('k') or {}).items():
            m = mob(killer)
            m.setdefault('loot_observed', []).append({'item': item, 'n': n})
            m['sources'].add('rt.lootStat')
    for ru, en in rt.get('qAlias', {}).items():
        m = mob(en)
        m.setdefault('aliases', []).append(ru)
    # охрана эпика (spawnId l2dop_eg_*): по CHANGELOG-7.1.23 и rt.hardMobs
    for n in ['Риба', 'Райкель', 'Райкель Леос', 'Риба Ирен']:
        m = M.get(low(n)) or mob(n)
        m['flags'].add('epic_guard')
        m['sources'].add('CHANGELOG-7.1.23')
        m['note'] = '«Риба · Райкель · ур. 48 · миньоны зоны эпика» (spawnId l2dop_eg_…, метка epic_guard) — не цели фарма'
    # РБ и эпики (подробно — raidbosses.json)
    for sid, v in rt['rbList'].items():
        m = mob(v['name'])
        m['levels'].add(v['lvl'])
        m['spawnIds'].append(sid)
        m['flags'].add('raid' if not sid.startswith('l2dop_rb_290') else 'raid_29xxx')
        m['sources'].add('rt.rbList')
    ep = K.load_json('tests/fixtures-epic-bosses-803.json')
    for b in ep['bosses']:
        m = mob(b['name'])
        m['levels'].add(b['level'])
        m['spawnIds'].append(b['spawnId'])
        m['flags'].add('epic')
        m['sources'].add('tests/fixtures-epic-bosses-803.json')
    # именные факты из документов
    DOC = {
        'buffalo slave': ('чемпион «Buffalo Slave 72 ур.» (лог 10.10 01:07): ответ на ход 1,1–2,8 с, бой 33 с; в rt.hardMobs — ур. 47, ttk 62 с', 'CHANGELOG-7.1.18'),
        'hatar ratman boss': ('НЕ рейд-босс: слово «Boss» в имени; 45 раз уходил из боя (10.10 20:21–20:29)', 'CHANGELOG-7.2'),
        'giant fungus': ('цель квеста 2-й профессии (Алхімік Орфеус): 0/100, был на 25-й странице из 26', 'CHANGELOG-7.1.23, 7.1.25'),
        'dire wyrm': ('цель квеста 2-й профессии: 2/15 → 15/15 (10.10 14:03)', 'CHANGELOG-7.1.23, 7.1.25'),
        'nos lad': ('урон ≈0,1/с — «моба убить ≈17791 с» (невосприимчив к магии?)', 'rt.hardMobs'),
        'steel trial champion': ('spawn quest_human_fighter_second_prof_champion_steel — чемпион квеста профессии воина', 'rt.spawns'),
    }
    for k, (note, src) in DOC.items():
        m = M.get(k) or mob(k.title())
        m.setdefault('doc_notes', []).append({'note': note, 'src': src})
        if k == 'hatar ratman boss':
            m['flags'].add('not_raid_name_contains_boss')
    out = []
    for k, m in sorted(M.items()):
        lv = sorted(x for x in m['levels'] if isinstance(x, (int, float)))
        rec = {'name': m['name'], 'levels': lv, 'spawnIds': sorted(set(m['spawnIds'])),
               'zones': sorted(m['zones']), 'flags': sorted(m['flags']), 'sources': sorted(m['sources'])}
        for f in ('aliases', 'hpMin', 'kills_bot', 'hard', 'note', 'doc_notes'):
            if f in m:
                rec[f] = m[f]
        if 'loot_observed' in m:
            rec['loot_observed'] = sorted(m['loot_observed'], key=lambda x: -x['n'])
        if 'drops_forum' in m:
            rec['drops_forum'] = sorted(m['drops_forum'], key=lambda x: (-(x['chance'] or 0), x['item']))
        if 'spoil_forum' in m:
            rec['spoil_forum'] = m['spoil_forum']
        rec['exp'] = None
        rec['adena'] = None
        out.append(rec)
    return {
        'meta': K.meta('Мобы и спавны L2WAP, известные боту', [
            BP_NOTE + ': rt.spawns (spawnId → [имя, ур.]), rt.zoneMobs, rt.hpMin (мин. HP по имени), rt.mobKills, rt.hardMobs, rt.lootStat, rt.rbList, rt.qAlias',
            'base-profile.json farmDb.res[*].drop/sp (база форума «Фарм ресурсов»: моб, ур., шанс %, мин, макс, телепорт, локация)',
            'tests/fixtures-epic-bosses-803.json', 'CHANGELOG-7.1.18/7.1.23/7.1.25/7.2'],
            'EXP/адена за отдельного моба в репозитории не хранятся (rt.mobVal в профиле нет) — поля exp/adena = null. '
            'Ориентиры: обычный моб ≈4 тыс. EXP, чемпион ≈46–49 тыс. EXP + 47–73 тыс. аден за ≈6–10 с (CLAUDE.md, лог 10.10). '
            'Флаги: champion (spawnId с champion), raid (l2dop_rb_*), raid_29xxx (обычные РБ с номером 290xx, не эпики), epic (8 эпиков), '
            'epic_guard (l2dop_eg_*), quest_target. Уровни из farmDb — уровни базы форума (Interlude), могут отличаться от карты игры.'),
        'counts': {'mobs': len(out), 'spawnIds': sum(len(x['spawnIds']) for x in out),
                   'with_forum_drops': sum(1 for x in out if 'drops_forum' in x)},
        'spawnId_kinds': {
            'dense_<N>': 'обычный спавн карты (плотная группа)', 'scatter_<N>': 'одиночный спавн карты',
            'l2dop_rb_<npcId>': 'рейд-босс (npcId Interlude, напр. 25158); 29001…29045 — эпики, другие 290xx — обычные РБ',
            'l2dop_eg_*': 'миньоны/охрана зоны эпика (метка epic_guard) — не цели',
            'quest_<class>_second_prof_champion_*': 'чемпион квеста 2-й профессии'},
        'mobs': out,
    }


# =====================================================================================================
def build_zones():
    rt = K.rt_warlock()
    farm = K.base_profile()['farmDb']['res']
    fx = K.load_json('tests/fixtures-zones-7128.json')
    cat_list = K.js_const_file('content.js', 'CAT_LIST')
    lair = K.js_const_file('popup.js', 'LAIR')
    Z = {}

    def z(k):
        if k not in Z:
            Z[k] = {'key': k}
        return Z[k]

    for k, v in rt['zoneCat'].items():
        d = z(k)
        d.update({'name': v.get('name'), 'city': v.get('city'), 'teleportPrice': v.get('price'),
                  'levelBand': [v.get('lo'), v.get('hi')] if v.get('lo') is not None else None, 'town': bool(v.get('town'))})
        if v.get('forum'):
            d['forumUrl'] = v.get('url')
    for k, v in fx['zoneCat'].items():
        d = z(k)
        d.setdefault('name', v.get('name'))
        if v.get('lo') is not None and not d.get('levelBand'):
            d['levelBand'] = [v.get('lo'), v.get('hi')]

    def stat(S):
        out = {}
        for lvl, e in sorted(S.items(), key=lambda x: int(x[0])):
            sec = e.get('sec') or 0
            out[lvl] = {'kills': e.get('n'), 'exp': e.get('exp'), 'sec': round(sec, 1), 'pctLevel': round(e.get('pct') or 0, 2),
                        'expPerHour': round(e['exp'] / sec * 3600) if sec else None,
                        'secPerKill': round(sec / e['n'], 2) if e.get('n') else None,
                        'killsPerHour': round(e['n'] / sec * 3600) if sec and e.get('n') else None}
        return out

    for k, S in rt['zoneStat'].items():
        z(k)['expStat_baseProfile'] = stat(S)
    for k, S in fx['zoneStat'].items():
        z(k)['expStat_fixture7128'] = stat(S)
    for k, names in rt['zoneMobs'].items():
        z(k)['mobsSeenOnMap'] = [n for n in names if not JUNK.search(n)]
    fm = collections.defaultdict(dict)
    for r in farm.values():
        for t in r.get('drop', []) + (r.get('sp') or []):
            mname, lvl, ch, a, b, zk, zn = (list(t) + [None] * 7)[:7]
            if not zk:
                continue
            fm[zk][mname] = lvl
            if zn and not z(zk).get('name'):
                z(zk)['name'] = zn
    for zk, mobs in fm.items():
        d = z(zk)
        d['mobsForum'] = [{'name': n, 'lvl': l} for n, l in sorted(mobs.items(), key=lambda x: (x[1] or 0, x[0]))]
        lv = [l for l in mobs.values() if isinstance(l, (int, float))]
        if lv:
            d['forumMobLevelRange'] = [min(lv), max(lv)]
    for k, t in rt.get('zoneBad', {}).items():
        z(k)['zoneBad_t'] = K.iso(t)
    for k, v in cat_list.items():
        d = z(k)
        d.update({'name': v[0], 'dungeon': True, 'levelBand_start': [v[1], v[2]], 'url': '/catacombs.html'})
    for ek, zk in lair.items():
        z(zk).setdefault('epicLair', []).append(ek)
    for k, notes in DOC_ZONE.items():
        z(k)['doc_notes'] = [{'note': n, 'src': s} for n, s in notes]
    # лучшие зоны по EXP/ч на каждом уровне (из профиля)
    best = collections.defaultdict(list)
    for k, d in Z.items():
        for lvl, e in (d.get('expStat_baseProfile') or {}).items():
            if e['expPerHour'] and (e['kills'] or 0) >= 15:
                best[int(lvl)].append((e['expPerHour'], k, e['kills']))
    ranking = {str(l): [{'zone': k, 'expPerHour': x, 'kills': n} for x, k, n in sorted(v, reverse=True)[:5]] for l, v in sorted(best.items())}
    return {
        'meta': K.meta('Зоны (локации) L2WAP: полосы уровней, телепорт, EXP/ч по уровням героя, мобы', [
            BP_NOTE + ': rt.zoneCat (каталог «Телепорта»: город, цена, lo/hi), rt.zoneStat (уровень героя → n боёв, exp, sec, pct), rt.zoneMobs, rt.zoneBad',
            'tests/fixtures-zones-7128.json (замеры 40–49 ур. на 7.1.28)', 'farmDb (мобы форума по локациям)',
            'content.js CAT_LIST (катакомбы/некрополи, стартовые уровни Interlude)', 'popup.js LAIR (логова эпиков)', 'CLAUDE.md, CHANGELOG-*'],
            'expPerHour = exp / sec × 3600 (как navigation.zoneRate). Замеры на одном уровне героя зависят от оружия/баффов на тот момент '
            '(Pavel Ruins ≈2,6 M с Demon\'s Staff C vs ≈4,58 M с Sprite\'s Staff B). levelBand — из каталога телепорта игры; '
            'pavel_ruins hi=80 — точка у Фальстона (75–80) входит в ту же полосу. Ключ out:… — зона, не найденная в каталоге.'),
        'counts': {'zones': len(Z), 'with_exp_stat': sum(1 for d in Z.values() if d.get('expStat_baseProfile') or d.get('expStat_fixture7128'))},
        'bestByHeroLevel_baseProfile': ranking,
        'zones': [Z[k] for k in sorted(Z)],
    }


# =====================================================================================================
def build_raidbosses():
    rt = K.rt_warlock()
    known = K.js_const_file('modules/raid.js', 'RB_KNOWN')
    epic_ids = K.js_const_file('modules/raid.js', 'EPIC_IDS')['$set']
    epics = K.js_const_file('content.js', 'EPICS')
    lair = K.js_const_file('popup.js', 'LAIR')
    ep = K.load_json('tests/fixtures-epic-bosses-803.json')
    R = {}

    def r(n):
        n = str(n)
        if n not in R:
            R[n] = {'npcId': int(n), 'spawnId': 'l2dop_rb_' + n}
        return R[n]

    for n, s in known.items():
        r(n)['stats'] = {'hp': s[0], 'pAtk': s[1], 'pDef': s[2], 'mAtk': s[3], 'mDef': s[4], 'src': 'modules/raid.js RB_KNOWN (ответы /game/spawn/<id>/info)'}
    for sid, v in rt['rbStats'].items():
        n = sid.replace('l2dop_rb_', '')
        d = r(n)
        st = {'hp': v.get('hp'), 'pAtk': v.get('patk'), 'pDef': v.get('pdef'), 'mAtk': v.get('matk'), 'mDef': v.get('mdef'), 'src': 'rt.rbStats (' + str(v.get('src')) + (', ' + v['from'] if v.get('from') else '') + ')'}
        if 'stats' in d and any(d['stats'][x] != st[x] for x in ('hp', 'pAtk', 'pDef', 'mAtk', 'mDef')):
            d['stats_conflict'] = st
        d.setdefault('stats', st)
        rw = {}
        if v.get('exp'):
            rw['exp_api'] = v['exp']
        if v.get('sp'):
            rw['sp_api'] = v['sp']
        if v.get('adena'):
            rw['adena_api'] = v['adena']
        if rw:
            d['reward'] = rw
        if v.get('loss'):
            d['heroHpLossPerSec_measured'] = v['loss']
    for sid, v in rt['rbList'].items():
        n = sid.replace('l2dop_rb_', '')
        d = r(n)
        d.update({'name_uk': v['name'], 'level': v['lvl'], 'teleportPrice': v['price'],
                  'listSnapshot': {'status': v['status'], 'alive': v['alive'], 'deny': v['deny'] or None, 'page': v['page'], 't': K.iso(v['t'])}})
    for sid, v in rt['rbDb'].items():
        n = sid.replace('l2dop_rb_', '')
        d = r(n)
        d.setdefault('name_uk', v.get('name'))
        d.setdefault('level', v.get('lvl'))
        f = {k: v.get(k) for k in ('kills', 'tries', 'verdict', 'fightS', 'hitP90', 'heroLvl', 'heroMaxHp', 'expPerKill', 'adenaPerKill', 'zone', 'note', 'persist') if v.get(k) is not None}
        if v.get('sp'):
            f['specialHit'] = v['sp']
        d['fights_bot'] = f
        mat = (d.get('stats') or {}).get('mAtk')
        if v.get('sp') and mat:
            d['specialHitFactor_mAtk'] = round(v['sp'] / mat, 3)
    for e in epics:
        for i in e['ids']:
            d = r(i)
            d['epic'] = {'key': e['k'], 'name_ru': e['nm'], 'level': e['lvl'], 'lair': e['tp'], 'inEPIC_IDS': str(i) in epic_ids}
            d.setdefault('level', e['lvl'])
    for b in ep['bosses']:
        n = b['spawnId'].replace('l2dop_rb_', '')
        d = r(n)
        d['epicApi_811_0903'] = {k: b.get(k) for k in ('name', 'level', 'isAlive', 'canAttack', 'attackBlockedReasonUk', 'coinOfLuckCost', 'adenaCost', 'respawnHours', 'icon')}
        d.setdefault('name_ru', b['name'])
    for n, notes in DOC_RB.items():
        r(n)['doc_notes'] = [{'note': a, 'src': s} for a, s in notes]
    out = [R[k] for k in sorted(R, key=lambda x: int(x))]
    facs = sorted(d['specialHitFactor_mAtk'] for d in out if 'specialHitFactor_mAtk' in d)
    return {
        'meta': K.meta('Рейд-боссы и эпики', [
            'modules/raid.js RB_KNOWN (33 шт.: [HP, P.Atk, P.Def, M.Atk, M.Def] из /game/spawn/<id>/info), EPIC_IDS',
            'content.js EPICS (ключ, уровень, логово, id), popup.js LAIR', BP_NOTE + ': rt.rbList (197 РБ: имя UA, ур., цена телепорта, статус), rt.rbStats, rt.rbDb (бои бота), rt.rbK, rt.rbLossK, rt.rbDps',
            'tests/fixtures-epic-bosses-803.json (ответ GET /game/epic-bosses 11.10 09:03)', 'CHANGELOG-7.2.1…8.0.4, skill l2-game-facts'],
            'specialHitFactor_mAtk = rt.rbDb[id].sp (замеренный спецудар, HP) / M.Atk. ВНИМАНИЕ: rt.rbStats[id].sp — это SP-награда, а rt.rbDb[id].sp — спецудар (одно имя поля, разный смысл). '
            'heroHpLossPerSec_measured = rt.rbStats[id].loss (потеря HP героя в секунду с учётом банок). rbK — обычный удар РБ ≈ P.Atk × rbK.'),
        'global': {'rbK_normalHitPerPAtk': rt.get('rbK'), 'rbLossK_hpLossPerPAtk': rt.get('rbLossK'), 'rbDps_measured': rt.get('rbDps'),
                   'specialHitFactor_mAtk_range': [facs[0], facs[-1]] if facs else None,
                   'raid_js_defaults': {'rbK_default': 0.109, 'spK_without_data': 1.05, 'spK_clamp': [0.9, 1.4], 'RB_WIN_levels': 15, 'RB_IDLE_MS': 300000,
                                        'rbInfo_retry_after_error_min': 10, 'blind_pay_once_per_min': 30, 'refuse_2_in_10min_farm_min': 5},
                   'flee_rules_8_0_4': 'удар ≥45 % макс. HP и HP < 2 ударов → выход + «не по силам» до нового уровня; ≥35 % и следующий убьёт → выход + пропуск 30 мин; босс ≤5 % — добиваем',
                   'doc_notes': [{'note': a, 'src': s} for a, s in DOC_RB_GENERAL]},
        'epicApiMeta_811_0903': {k: ep[k] for k in ep if k not in ('bosses', '_note')},
        'counts': {'bosses': len(out), 'with_stats': sum(1 for d in out if 'stats' in d), 'epics': sum(1 for d in out if 'epic' in d),
                   'fought_by_bot': sum(1 for d in out if 'fights_bot' in d), 'RB_KNOWN': len(known)},
        'bosses': out,
    }


# =====================================================================================================
def build_skills():
    rt = K.rt_warlock()
    IL = K.il_db()
    il_fix = K.js_const_file('content.js', 'IL_FIX')
    alias = K.js_const_file('content.js', 'NAME_ALIAS')
    fa_c = K.js_const_file('content.js', 'FA_KNOWN')
    fa_p = K.js_const_file('popup.js', 'FA_KNOWN')
    tb = K.js_const_file('content.js', 'TB_KEYS')
    tbl = K.js_const_file('modules/buffs.js', 'TB_LVL_DEF')
    pet_mul = K.js_const_file('modules/combat.js', 'PET_MUL')
    no_eff = K.js_const_file('content.js', 'NO_EFFECT_DEF')
    mag_skip = K.js_const_file('content.js', 'MAG_SKIP_DEF')
    force = K.js_const_file('content.js', 'FORCE_KNOWN')
    lock_a = K.js_const_file('modules/combat.js', 'LOCK_A')
    lock_b = K.js_const_file('modules/combat.js', 'LOCK_B')

    def il(i):
        e = IL.get(str(i))
        if not e:
            return None
        return {k: e.get(k) for k in ('n', 'c', 't', 'target', 'mp', 'pow', 'reuse', 'dur', 'L') if e.get(k) is not None}

    meas = {}
    for k, v in rt['skills'].items():
        m = {'name': v.get('name', k), 'kind': v.get('kind'), 'uses': v.get('uses'), 'usesUnmeasured': v.get('usesU')}
        if v.get('dmgN'):
            m['avgDmg_recent'] = round(v['dmg'] / v['dmgN'])
            m['dmgSamples'] = v['dmgN']
        if v.get('mpN'):
            m['avgMp'] = round(v['mp'] / v['mpN'], 1)
            m['mpSamples'] = v['mpN']
        for f in ('cd', 'cdS', 'heal', 'mpGain', 'img', 'cdNet'):
            if v.get(f) not in (None, 0, ''):
                m[f] = v[f]
        if v.get('img', '').startswith('skill'):
            m['il_id_from_icon'] = int(re.sub(r'\D', '', v['img']))
        if v.get('last'):
            m['lastLogLine'] = v['last']
        meas[low(m['name'])] = m
    wl = []
    for name, i in WARLOCK_SKILLS.items():
        rec = {'name': name, 'il_id': i, 'slot': f'l2_{i}', 'interlude': il(i)}
        if str(i) in il_fix:
            rec['il_fix_l2wap'] = il_fix[str(i)]
        if name in L2WAP_SKILL:
            rec['l2wap'] = L2WAP_SKILL[name]
        if low(name) in meas:
            rec['measured'] = meas.pop(low(name))
        la = alias.get(low(name)) or rt.get('logAlias', {}).get(low(name))
        if la:
            rec['logName_uk'] = la
        rec['onPanel_10_10'] = low(name) in rt.get('panelKnown', [])
        if low(name) in rt.get('debuffStat', {}):
            rec['debuffStat'] = rt['debuffStat'][low(name)]
        wl.append(rec)
    other_meas = list(meas.values())
    # баффы
    fa = {}
    for i, v in rt['faCat'].items():
        fa[i] = {'id': int(i), 'name': v['name'], 'costFA': v['cost'], 'src': 'rt.faCat (страница баффера FA 10.10 22:27)'}
    for i, (n, c) in fa_c.items():
        d = fa.setdefault(i, {'id': int(i), 'name': n, 'costFA': c, 'src': 'content.js FA_KNOWN'})
        d['FA_KNOWN_content'] = [n, c]
        if i not in fa_p:
            d['missing_in_popup_FA_KNOWN'] = True
    for i, d in fa.items():
        d['interlude'] = il(i)
    cfg = K.base_profile()['cfg']
    defcfg = K.js_const_file('content.js', 'DEF_CFG')
    rbsess = [int(x) for x in re.findall(r'\d+', defcfg.get('rbSessBuffs', ''))]
    pets = {k: {'pAtkPctOfOwnerMAtk': v} for k, v in pet_mul.items()}
    pets['kai_the_cat'].update({'stat_bot': rt['petStat'].get('kai_the_cat'), 'doc': [
        ('Kai Lv.3 (10.10 19:35–19:45): удар ≈1500 (1300–1670), крит 5721 (2 %), промах 16 %', 'CHANGELOG-7.1.31'),
        ('Kai Lv.5: P.Atk ≈1381, удар ≈1870', 'skill l2-game-facts'),
        ('кот ≈35–40 % урона (≈1100 за удар) на ~50 ур.', 'CLAUDE.md'),
        ('перепризыв в бою даёт полное HP: 10.10 19:43:35 HP 444 → 1965', 'CHANGELOG-7.1.31'),
        ('лог: «Слуга [Kai the Cat] атакує [моб] 1 409 урону.» / «… завдає критичного удару [моб] 5 721 урону.» / «… промахнувся»', 'CLAUDE.md')]})
    pets['mew_the_cat'].update({'doc': [('призыв в бою: MP −19, кот 736/750 (лог 10.10 00:20); перепризыв работает (rt.petResummon.mew_the_cat=true)', 'CHANGELOG-7.1.17; ' + BP_NOTE),
                                        ('Servitor Heal лечит Mew на 561 HP (rt.skills.servitor heal.last)', BP_NOTE)]})
    pets['feline_queen'].update({'doc': [('с 11.10; support; бафф физ. крита «Blessing of Queen» (4699 «Благословення Королеви») — магу бесполезен; с 8.0.3 первой на панели — бот её не выбирает по умолчанию', 'CLAUDE.md; skill l2-game-facts; CHANGELOG-8.0.3')]})
    k = rt['petStat'].get('kai_the_cat') or {}
    if k.get('hits'):
        pets['kai_the_cat']['derived'] = {'avgHit': round(k['hitDmg'] / k['hits']), 'hitRateOfActs': round(k['hits'] / k['acts'], 3) if k.get('acts') else None,
                                          'missRate': round(k['misses'] / (k['hits'] + k['misses'] + k['crits']), 3), 'critRate': round(k['crits'] / (k['hits'] + k['misses'] + k['crits']), 3)}
    return {
        'meta': K.meta('Скиллы Warlock (L2WAP) и баффы', [
            'skills-il.js (справочник Interlude по id)', 'content.js IL_FIX, NAME_ALIAS, NO_EFFECT_DEF, MAG_SKIP_DEF, FA_KNOWN, TB_KEYS', 'modules/buffs.js TB_LVL_DEF, modules/combat.js PET_MUL/LOCK_A/LOCK_B',
            BP_NOTE + ': rt.skills (замеры), rt.panelKnown, rt.logAlias, rt.debuffStat, rt.debuffImmune, rt.faCat, rt.petStat, rt.petAdvice', 'CLAUDE.md «Скиллы Warlock на L2WAP» (скрин магистра 10.10)', 'CHANGELOG-*'],
            'measured.avgDmg_recent = rt.skills.dmg/dmgN — СВЕЖЕЕ окно (последние ≈40–60 замеров, 7.2.1), снято в основном под FA-баффами на РБ 10.10 22:23+ — '
            'поэтому выше «Замеров» CLAUDE.md (≈895 Blaze). cd/cdS — экранный замер отката (до 8.0.3; «3,1 с» Blaze — артефакт, сервер принимает через ≈0,66–1,1 с). '
            'interlude — справочник Interlude (power/reuse/mp могут не совпадать с L2WAP).'),
        'counts': {'warlock_skills': len(wl), 'measured_other': len(other_meas), 'fa_buffs': len(fa)},
        'warlock': wl,
        'measured_other': other_meas,
        'doc_measurements': [{'note': a, 'src': s} for a, s in DOC_SKILL_MEAS],
        'noEffectInBattle_default': [x.strip() for x in no_eff.split(',')],
        'magisterSkip_default': [x.strip() for x in mag_skip.split(',')],
        'debuffImmune': {k: K.iso(v) for k, v in rt.get('debuffImmune', {}).items()},
        'logAlias_builtin': alias, 'logAlias_learned': rt.get('logAlias', {}),
        'panelKnown_10_10': rt.get('panelKnown', []),
        'pets': pets, 'petAdvice': rt.get('petAdvice'),
        'buffs': {
            'fastAden': [fa[i] for i in sorted(fa, key=int)],
            'rbSessionDefault': {'ids': rbsess, 'names': [fa.get(str(i), {}).get('name') for i in rbsess], 'costFA_total': 17, 'src': 'content.js DEF_CFG.rbSessBuffs; CHANGELOG-7.2.2'},
            'town': {'TB_KEYS': tb, 'TB_LVL_DEF_basic': {i: {'level': l, 'name': (fa.get(i) or {}).get('name') or (il(i) or {}).get('n')} for i, l in tbl['basic'].items()},
                     'note': 'городской набор 24 ч (23 ч по панели), слетает при смерти; не берётся, если понизит активный бафф (7.2.3)'},
            'durations': {'FA_buff_h': 3, 'FA_buff_panel_h': 2.96, 'town_buff_h': 24, 'note': '«Дар Серафима» тоже 3 ч, хотя в описании «20 хв»; Noblesse (1323) сохраняет баффы при смерти и уходит сам'},
            'cfg_player': {k: cfg.get(k) for k in ('faBuffs', 'townBuffSet', 'buffSec', 'nBuffs', 'nKeyBuffs', 'nPetBuffs')},
        },
        'clickGate_8_0_3': {'LOCK_A_ms_[min,max,start]': lock_a, 'LOCK_B_ms_[min,max,start]': lock_b,
                            'note': 'запас A после ответа хода, B после конца GET /character игры; клик в полёте GET /character теряется (770 из 770), через 25–200 мс после — доходит в 95 %'},
        'warrior_force_FORCE_KNOWN': force,
    }


# =====================================================================================================
def build_items():
    rt = K.rt_warlock()
    I = K.items_il()
    shot = K.js_const_file('content.js', 'SHOT_IDS')
    bsps = K.js_const_file('content.js', 'BSPS_IDS')
    shot_g = K.js_const_file('modules/resources.js', 'SHOT_ID_G')
    color = K.js_const_file('modules/resources.js', 'SHOT_COLOR')
    grade_lv = K.js_const_file('content.js', 'GRADE_LV')
    gear_info = K.js_const_file('popup.js', 'GEAR_INFO')
    gear_cost = K.js_const_file('popup.js', 'GEAR_COST')
    gear_ad = K.js_const_file('popup.js', 'GEAR_ADENA')
    rates = K.js_const_file('modules/fishing.js', 'FISH_RATE_DEF')
    by_name = {}
    for i, v in I.items():
        by_name.setdefault(low(v['n']), int(i))

    def ilrec(i):
        v = I.get(str(i))
        if not v:
            return None
        return {k: v.get(k) for k in ('n', 'k', 'g', 'et', 'wt', 'pa', 'ma', 'pr', 'ef') if v.get(k) is not None}

    shots = []
    for g, i in shot.items():
        shots.append({'grade': g, 'type': 'soulshot (Заряд душі воїна) — физ. оружие', 'id': i, 'interlude': ilrec(i)})
    for g, i in bsps.items():
        shots.append({'grade': g, 'type': 'blessed spiritshot (Благословенний заряд духу) — маг. оружие', 'id': i, 'interlude': ilrec(i),
                      'shopKey': f'consumable/blessed_spiritshot_{g.lower()}' if g != 'NG' else 'consumable/blessed_spiritshot_ng (? не видели)'})
    for i, g in shot_g.items():
        if int(i) in (2509, 2510, 2511, 2512, 2513, 2514):
            shots.append({'grade': g, 'type': 'spiritshot (обычный, распознаётся по #id на панели)', 'id': int(i), 'interlude': ilrec(i)})
    for i in range(6535, 6541):
        shots.append({'grade': (ilrec(i) or {}).get('g') or 'NG', 'type': 'fishing shot (Рибальський заряд душі; IL id — справочно)', 'id': i, 'interlude': ilrec(i)})
    pots = [{'name_uk': v.get('name'), 'kind': v.get('kind'), 'pulseHp_or_Mp': v.get('pulse') or v.get('heal'), 'everySec': v.get('every'), 'inBag': v.get('n'), 'usesMeasured': v.get('uses'), 't': K.iso(v.get('t'))}
            for v in rt['pots'].values()]
    pots.append({'name_uk': 'Велике зілля HP', 'note': 'импульсами по 2500 HP каждые 1 с («Велике зілля HP: відновлення імпульсами по 2500 HP кожні 1 с.»)', 'src': 'content.js (комментарий v4.40)'})
    pots.append({'name_uk': 'Велике зілля MP', 'inBag': rt['bagAll']['n'].get('Велике зілля MP'), 'src': 'rt.bagAll'})
    gear = []
    for kgi, (nm, st) in gear_info.items():
        k, g = kgi.split('_')
        gear.append({'key': kgi, 'slot': k, 'grade': g.upper(), 'name_uk': nm, 'stats': st, 'costProof': gear_cost[g], 'costAdenaMln': gear_ad[g]})
    bag = []
    for n, q in sorted(rt['bagAll']['n'].items()):
        i = by_name.get(low(n))
        bag.append({'name': n, 'qty': q, 'il_id': i, 'interlude': ilrec(i) if i else None})
    loot = []
    for n, v in sorted(rt['lootStat'].items(), key=lambda x: -x[1]['n']):
        loot.append({'item': n, 'dropsSeen': v['d'], 'qty': v['n'], 'killers': v['k'], 'il_id': by_name.get(low(n))})
    special = {
        'Adena': {'id': 57, 'note': 'валюта; тратить можно (игрок 11.10: «адена пофиг»), но без платных телепортов вслепую'},
        'Coin of Luck': {'id': 4037, 'note': 'донатная/ценная; НИКОГДА без явного положительного лимита (cfg.epicCoinDailyMax 0 = никогда); в сумке 53 (10.10)', 'interlude': ilrec(4037)},
        'Fast Aden (FA)': {'id': None, 'note': 'валюта баффера FA, падает с мобов (rt.loot «Fast Aden» 18); баланс 82 FA (10.10 22:27); не тратить без команды'},
        'Shil Coins': {'id': None, 'note': 'награда TvT (2 за победу); в сумке 6'},
        'Proof of Catching a Fish': {'id': 7609, 'note': 'валюта рыбака; 92 в сумке (10.10)', 'interlude': ilrec(7609)},
        'Old Box': {'id': 8547, 'note': '≈9 «якісних» наживок + 0,7 Coin of Luck; шанс +1 %/ур. заточки удочки', 'interlude': ilrec(8547)},
        'Fishing Lure (обычная наживка)': {'id': None, 'offerKey': 'bait_x10', 'note': '1 пакет = 10 шт. = 1000 аден; иконка /bait_basic/'},
        'Якісна наживка (Good Fishing Lure)': {'id': None, 'offerKey': 'good_bait_x10', 'note': '10 шт. = 3 Proof или из Old Box; бот за Proof не покупает; иконка /bait_good/'},
        'Fishing Rod (Starter Rod)': {'id': None, 'offerKey': 'starter_rod', 'note': 'удочки можно случайно продать — бот покупает одну (fishRodBuy); иконка /fishing_rod/'},
        'Fishing Rod Enchant Scroll x1': {'id': None, 'offerKey': 'rod_enchant_scroll_x1', 'note': '100 Proof; заточка даёт только +1 % к шансу Old Box за уровень, урон не растёт'},
        'Рибальський заряд душі': {'id': None, 'offerKey': 'soulshot_x50', 'note': 'пакет 50 шт. = 5000 аден; урон рыбе 70 вместо 35; в сумке 7203 (10.10)'},
        'Noblesse Blessing (бафф 1323)': {'id': None, 'note': '5 FA; сохраняет баффы при смерти и уходит сам'},
    }
    shop_keys = {
        'drops_shop_buy_body': '{shopKey: "consumable/blessed_spiritshot_<grade>", qty}',
        'seen_shopKeys': ['consumable/blessed_spiritshot_c', 'consumable/blessed_spiritshot_d'],
        'shopKey_pattern_inferred': ['consumable/blessed_spiritshot_<ng|d|c|b|a|s>', 'consumable/soulshot_<grade> (не видели в логе — выведено по аналогии)'],
        'consumablesub_by_need (economy.js SUB)': K.js_const(K.read('modules/economy.js'), 'SUB', 'modules/economy.js'),
        'gm_shop_tabs': '.l2-drops-shop-tab[data-category|data-grade|data-consumablesub]; строки .l2-gm-shop-row--grade-<g>; цена .l2-gm-shop-price--adena / --coin',
        'fishing_buy_starter_offerKeys': ['starter_rod', 'bait_x10', 'soulshot_x50', 'good_bait_x10 (только иконка/имя в коде)', 'rod_enchant_scroll_x1 (кнопка data-offer)'],
        'fishing_buy_starter_body': '{offerKey, amount}',
    }
    return {
        'meta': K.meta('Предметы: заряды, банки, валюты, рыбалка, снаряжение, ресурсы в сумке, ключи магазинов', [
            'content.js SHOT_IDS/BSPS_IDS/GRADE_LV', 'modules/resources.js SHOT_ID_G/SHOT_COLOR', 'popup.js GEAR_INFO/GEAR_COST/GEAR_ADENA', 'modules/fishing.js FISH_RATE_DEF',
            'modules/economy.js', 'items-il.json (справочник Interlude: pr — цена NPC Interlude, НЕ цена L2WAP)', BP_NOTE + ': rt.bagAll (сумка 10.10 22:10), rt.pots, rt.lootStat, rt.loot, rt.lootValue',
            'CLAUDE.md, CHANGELOG-7.1.21…8.0.3'],
            'Цены L2WAP — в pricesL2WAP (из логов/кода); interlude.pr — справочная цена Interlude.'),
        'counts': {'shots': len(shots), 'potions': len(pots), 'bag_items': len(bag), 'loot_items': len(loot), 'fishing_gear': len(gear), 'special': len(special),
                   'prices': len(ITEM_PRICES_L2WAP)},
        'gradeByHeroLevel_GRADE_LV': grade_lv,
        'shotGradeByIconColor': color,
        'shotRule': 'заряды строго под НАДЕТОЕ оружие: грейд оружия → грейд зарядов; маг. оружие → «Благословенний заряд духу», физ. → «Заряд душі воїна»; '
                    'маг. оружие по базе Interlude: M.Atk/P.Atk одноручное ≥0,7, посохи ≥0,6 (CHANGELOG-7.1.17); слот зарядов не того грейда — «#3950» в подписи или цвет иконки (7.2.1)',
        'shots': shots,
        'potions': pots,
        'special': special,
        'pricesL2WAP': [{'what': a, 'price': b, 'currency': c, 'src': d} for a, b, c, d in ITEM_PRICES_L2WAP],
        'shopKeys': shop_keys,
        'weapons_warlock': [dict(w, interlude=ilrec(w['il_id'])) for w in WEAPONS],
        'armor_avadon_set': {'pieces': ['Avadon Circlet (2415)', 'Avadon Gloves (2464)', 'Avadon Boots (600)'], 'type': 'мантия (Robe) — важна для Spellcraft/Mana Recovery',
                             'setBonus': 'M.Atk +12 %, скорость каста +10 %, урон маг. крита +9 %, Max HP +3 % и +950, Max MP +13 % и +1250, Max CP +1295, P.Def +7 %, скорость +11, сопротивление ядам и кровотечению +60 %',
                             'src': 'CHANGELOG-7.2.3'},
        'belts_8_0_1': 'пояса: сила физ./маг. крита D 2 %, C 3 %, B 5 %, A 7 %, S 10 %, +25 % базы за ур. заточки (S +5 = 22,5 %); плащи — бонусы HP/P.Def/M.Def растут от баффов (CHANGELOG-8.0.1)',
        'fishingGear': gear,
        'fishMaterialExchange_FISH_RATE_DEF': {k: {'give': v[0], 'getProof': v[1]} for k, v in rates.items()},
        'uk_names': {
            'Благословенний заряд духу': 'Blessed Spiritshot (грейд — по оружию; 10.10 — B #3950)', 'Заряд душі воїна': 'Soulshot', 'Рибальський заряд душі': 'Fishing Shot (рыболовные заряды)',
            'Зілля мани (велика банка)': 'банка MP, импульс 500 MP', 'Зілля мани (мала банка)': 'банка MP, импульс 200 MP', 'Велике зілля MP': 'большая банка MP (L2WAP)',
            'Зілля зцілення': 'банка HP, импульс 600 HP/с', 'Зілля слабкого зцілення': 'слабая банка HP', 'Велике зілля HP': 'банка HP, импульсы по 2500 HP/с',
            'Якісна наживка': 'Good Fishing Lure', 'Вудка': 'удочка (Fishing Rod), «+2 Вудка» — заточка +2', 'Енрія': 'Enria (4042)', 'Мисливська шкура': 'особая добыча (rt.lootSpecial)',
            'Кубок': 'особая добыча (rt.lootSpecial)', 'Посох спрайта': "Sprite's Staff (B)", 'Посох життя': 'Staff of Life (D)', 'Лялька вуду': 'Voodoo Doll (NG)'},
        'potion_cooldown_note': 'у банок в L2WAP своего отката нет (только общий ≈0,2 с; лог 08.10 14:14 — v5.3); локальные откаты Interlude убраны в 7.1.4',
        'bag_10_10': bag,
        'loot_observed': loot,
        'loot_totals': rt.get('loot'), 'lootSpecial': rt.get('lootSpecial'), 'lootValue_adena': rt.get('lootValue'),
        'lootStat_since': K.iso(rt.get('lootStatT0')),
    }


# =====================================================================================================
def build_farm():
    bp = K.base_profile()
    rt = K.rt_warlock()
    res = bp['farmDb']['res']
    tree = K.js_const_file('popup.js', 'TREE_ORDER')
    basic = K.js_const_file('popup.js', 'BASIC_RES')
    out = []
    cats = collections.Counter()
    for k, r in sorted(res.items()):
        cats[r.get('cat') or '—'] += 1
        rec = {'key': k, 'name': r.get('name'), 'cat': r.get('cat'), 'icon': r.get('icon'), 'sourcesN': r.get('n'),
               'spoilSourcesCount': r.get('spoil') if isinstance(r.get('spoil'), int) else len(r.get('spoil') or []),
               'drop': [dict(zip(('mob', 'lvl', 'chance', 'min', 'max', 'zone', 'zoneName'), t)) for t in r.get('drop', [])],
               'bosses': [dict(zip(('boss', 'lvl', 'chance'), t)) for t in r.get('bosses', [])], 't': K.iso(r.get('t'))}
        if r.get('sp'):
            rec['spoil'] = [dict(zip(('mob', 'lvl', 'chance', 'min', 'max', 'zone', 'zoneName'), t)) for t in r['sp']]
        out.append(rec)
    return {
        'meta': K.meta('База «Фарм ресурсов» (форум игры) — ресурсы, кейматы, шмот с РБ и их источники', [
            'base-profile.json farmDb.res (378 ресурсов, прочитано ботом с /forum-farm-resources.html 10.10)', 'popup.js TREE_ORDER/BASIC_RES', 'content.js farmRowParse',
            BP_NOTE + ': rt.farmGot, rt.lootSpecial', 'CHANGELOG-7.2, 7.2.2, 8.0.5'],
            'drop: [моб, ур., шанс %, мин, макс, ключ телепорта, локация] (content.farmRowParse). spoil-источники в базе пока только СЧЁТЧИКОМ (spoilSourcesCount) — '
            'разметка спойл-строк форума ботом ещё не виденa (CHANGELOG-7.2), поэтому массива spoil нет. icon — пусто (картинки подтягиваются с 8.0.5 при заходе на страницу). '
            'Уровни мобов — по базе форума.'),
        'counts': {'resources': len(out), 'drop_sources': sum(len(x['drop']) for x in out), 'boss_sources': sum(len(x['bosses']) for x in out),
                   'byCategory': dict(cats.most_common())},
        'rules': {
            'treeOrder': tree, 'basicResources_regex': basic,
            'farmWindow_default': {'farmLvlBelow': 3, 'farmLvlAbove': 5, 'note': 'источники в окне −3…+5 от героя первыми, среди них по шансу (7.2.2); вне окна оценка ниже'},
            'spoil': 'Sweeper не нужен — игра собирает спойл сама; «Спойл: X ×N» = ресурс X; шанс пометить моба 1 − (1 − p)³ (до 3 попыток), без замера 80 % (CHANGELOG-7.2)',
            'mapEvery': 'активная цель «ресурс»/«рецепт» на своей точке — карта раз в 5 боёв при «0», не реже 10 при большом N (CHANGELOG-7.2)',
            'urls': {'farm': '/forum-farm-resources.html', 'recipes': '/forum-recipe-hunt.html'},
            'resourceTeleport': 'POST /game/farm-guide/resource-teleport (увидено автообучением; бот жмёт кнопку страницы)',
        },
        'farmGot': rt.get('farmGot'), 'lootSpecial': rt.get('lootSpecial'),
        'resources': out,
    }


# =====================================================================================================
def build_fishing():
    cfg = K.base_profile()['cfg']
    defcfg = K.js_const_file('content.js', 'DEF_CFG')
    rates = K.js_const_file('modules/fishing.js', 'FISH_RATE_DEF')
    prices = K.js_const_file('modules/fishing.js', 'prices')
    steps = K.js_const_file('modules/fishing.js', 'STEPS')
    learn = K.base_profile()['learn']['api']
    fishapi = {k: {'n': v.get('n'), 'statuses': v.get('st'), 'responseKeys': sorted(v.get('keys', {})), 'errorForms': sorted(f for f in v.get('forms', {}) if f.startswith('error'))}
               for k, v in learn.items() if 'fishing' in k}
    bag = K.rt_warlock()['bagAll']['n']
    return {
        'meta': K.meta('Рыбалка L2WAP: темп, экономика, наживки, удочка, магазин рыбака', [
            'modules/fishing.js (FISH_RATE_DEF, FCD_MIN/MAX, prices, STEPS, комментарии)', 'content.js DEF_CFG (fish*)', 'base-profile.json cfg (fish*), learn.api (fishing)',
            'CHANGELOG-7.1.5/6, 7.1.21, 7.1.29, 7.1.30, 7.2.1, 7.2.4, 8.0, 8.0.3, 8.0.4; CLAUDE.md; skill l2-game-facts'],
            'rt.fishRates / rt.fishVal / rt.fishBaitStat в базовом профиле НЕТ (не экспортировались) — замеры берутся из CHANGELOG.'),
        'counts': {'rates_measured': 4, 'exchange_rates': len(rates), 'time_packs': len(prices), 'api_endpoints': len(fishapi)},
        'rates_measured': [
            {'fishPerHour': '≈588', 'when': '10.10 18:32–19:35, ≈535 рыб', 'src': 'CHANGELOG-7.2.1'},
            {'fishPerHour': '≈562', 'when': '10.10 18:17–19:45, удочка +0…+2, обычная наживка, с зарядами', 'src': 'CHANGELOG-7.2.4'},
            {'fishPerHour': '≈540 с зарядами / ≈340 без зарядов', 'src': 'CHANGELOG-8.0'},
            {'fishPerHour': 'ожидание ≈630–650 после 8.0; ≈530 после 8.0.4', 'src': 'CHANGELOG-8.0, 8.0.4'},
        ],
        'proof': {
            'perFish': '≈0,33 (≈300 рыб → ≈99 Proof; 302 рыбы → +99, 297 → +97)',
            'perHour': '≈185 Proof за час ловли',
            'byFish': {'White Fish': {'proof': 0.36, 'pumpsReels': 3.6}, 'Black Fish': {'proof': 0.28, 'pumpsReels': 5.7}, 'Fat Fish': {'proof': 0.30, 'pumpsReels': 9.3}},
            'costPerProofAdena': '≈14 000 (7.2.1) / ≈15–18 тыс. (7.2.4)',
            'hourCostAdena': '≈2,7–3,4 млн: время 2,3–3 млн, заряды ≈300 тыс., наживка ≈60 тыс.',
            'perFishCost': 'время ≈4 000 аден (пакет 6 ч), заряды ≈540 (5,4 шт.), наживка 100',
            'src': 'CHANGELOG-7.2.1, 7.2.4',
        },
        'materialExchange_FISH_RATE_DEF': {k: f'{v[0]} → {v[1]} Proof' for k, v in rates.items()},
        'timing': {
            'actionCooldown_s': 'откат одного приёма ≈1,13 с (тот же приём подряд 0,94 с после ответа); смена Reeling↔Pumping 0,22 с; после поимки до заброса 0,63 с; «не клюнула» — каждый третий заброс (261 из 796)',
            'FCD_MIN_s': K.js_const_file('modules/fishing.js', 'FCD_MIN'), 'FCD_MAX_s': K.js_const_file('modules/fishing.js', 'FCD_MAX'),
            'accepted_s': '1,03–1,09 (лог), сохранённый раздутый откат возвращён к 1,22 с (8.0.4); лаг 1,4–2,5 с раздувал до 1,69–1,80',
            'stallWatch': 'рыба на экране, 8 с нет нажатия/изменения — перезагрузка (≤3 за 10 мин); лаг сервера до 15 с не считается зависанием',
            'background': 'в фоне вкладки игра оживляет кнопки раз в 1 с — держать окно видимым',
            'retrySteps_s': steps, 'src': 'CHANGELOG-7.2.1, 7.1.29, 7.1.30, 8.0, 8.0.4; skill l2-game-facts',
        },
        'bait': {
            'counterQuirk': 'счётчик НЕвыбранной наживки читается как 0 — сначала выбрать, дождаться подтверждения, потом читать (7.1.29/7.1.30)',
            'auto': 'режим «Авто»: по 60+ забросов на каждой, Proof/ч; хорошая лучше ≥3 % — ловим на ней, пока есть бесплатные (Old Box); покупать за Proof выгодно, только если +0,3 Proof/заброс (сам бот не покупает)',
            'buyPacks_history': '100 (до 7.2.4) → 1000 пакетов (7.2.4, 1 000 000 аден) → 100 пакетов (8.0.3, 1000 шт. ≈ 100 000 аден ≈ 1,5 ч)',
            'goodLure': '«Якісна наживка» 10 шт. = 3 Proof; описания в игре нет; 0 забросов в логах до 7.2.1',
            'bagSnapshot_10_10': {'Fishing Lure': bag.get('Fishing Lure'), 'Якісна наживка': bag.get('Якісна наживка'), 'Рибальський заряд душі': bag.get('Рибальський заряд душі'),
                                  'Proof of Catching a Fish': bag.get('Proof of Catching a Fish'), 'Old Box': bag.get('Old Box')},
        },
        'shots': {'damage': 'урон 70 с зарядом вместо 35 — вдвое быстрее; время дороже зарядов в ≈7 раз', 'perFish': '≈5,4–5,5 заряда на рыбу',
                  'autoRatio': 'на 1000 пакетов наживки (≈6 800 рыб × ≈5,5) ≈750 пакетов зарядов (3,75 млн)', 'buyAtOrBelow': 20, 'src': 'CHANGELOG-7.2.1, 7.2.4, 8.0'},
        'rod': {'enchant': 'заточка урон НЕ увеличивает (≈70 до и после +0→+2); только +1 % к шансу Old Box за уровень; свиток 100 Proof, до +10 = 1000 Proof',
                'oldBox': '≈9 «якісних» наживок + 0,7 Coin of Luck', 'enchantEvery': 'раз в 100 рыб (7.1.29)', 'goalDefault': 'rodEnchantTo 10 (7.1.5)', 'buyIfMissing': 'fishRodBuy: одна удочка, повтор через 2 мин',
                'levelFromGear': 'уровень удочки — со строки снаряжения «Вудка +2» (8.0)', 'src': 'CHANGELOG-7.2.1, 7.1.5, 7.1.28, 7.1.29, 8.0'},
        'setup': {'skills': 'Fishing / Pumping / Reeling у рыбака по 100 000 SP, по одному за проход', 'spot': '#fishing-spot-buy 10 000 000 аден один раз, только если останется shopReserve',
                  'check': 'проверка настройки раз в 6 ч (7.1.27)', 'src': 'CHANGELOG-7.1.21, 7.1.27'},
        'timePacks_adena': prices, 'timePackNote': 'пакет 6 ч на 22 % дешевле часа (2,33 млн/ч против 3 млн/ч); не хватает — меньший пакет (8.0)',
        'shop_gear_proof': 'плащи/тату/пояса рыбака: D 500 / C 1500 / B 3500 / A 5000 / S 8000 Proof + 0,5/1,5/5/15/50 млн аден (popup GEAR_COST/GEAR_ADENA; бонусы — items.json fishingGear)',
        'cfg_player': {k: v for k, v in cfg.items() if k.startswith('fish') or k in ('rodEnchantTo', 'shopBait')},
        'cfg_default': {k: v for k, v in defcfg.items() if k.startswith('fish') or k in ('rodEnchantTo', 'shopBait')},
        'api_observed': fishapi,
        'api_notes': 'POST /game/fishing/action {action: cast|pumping|reeling|selectBait|selectRod|buyFishingSpot|buyFishingTime} → {character, fishing{serverNowMs, cooldowns…}, revision}; '
                     'ошибка action_cooldown (400); POST /game/fishing/buy-starter {offerKey, amount}; cut / exchange-material / open-old-box / buy-special (видны автообучением)',
    }


# =====================================================================================================
def build_character():
    bp = K.base_profile()
    rt = K.rt_warlock()
    cfg = bp['cfg']
    safe_cfg = {k: v for k, v in cfg.items() if not re.search(r'pass|login|auth|token|mail', k, re.I)}
    return {
        'meta': K.meta('Персонаж Warlock — снимок профиля', [
            BP_NOTE + ': cfg (настройки игрока), chars.Warlock.rt', 'CLAUDE.md «Игрок и его правила», «Скиллы Warlock»', 'WARLOCK-TO-78-RU.md', 'CHANGELOG-*'],
            'Пароль автологина (storage-ключ auth) в профиле отсутствует и сюда не попадает.'),
        'counts': {'levelTimeline': len(DOC_LEVELS), 'weapons': len(WEAPONS), 'cfg_keys': len(safe_cfg)},
        'player_chars': [
            {'name': 'Warlock', 'race_class': 'Human Mystic → Wizard → Warlock (2-я профессия взята 10.10)', 'role': 'основной; маг с котом-слугой', 'level_11_10': 56},
            {'name': 'Спойлер (ник не указан)', 'race_class': 'гном: Scavenger / Bounty Hunter', 'role': 'спойлить ресурсы на крафт; Sweeper не нужен'},
            {'name': 'West', 'race_class': 'воин', 'role': 'редко'},
        ],
        'levelTimeline': [{'when': a, 'level': b, 'note': c, 'src': d} for a, b, c, d in DOC_LEVELS],
        'rt_snapshot_10_10': {
            'lvl': rt.get('lvl'), 'prof': rt.get('prof'), 'magLvl_lastMagister': rt.get('magLvl'), 'magNpc': rt.get('magNpc'),
            'dps': rt.get('dps'), 'turnMs': rt.get('turnMs'), 'rbDps': rt.get('rbDps'), 'eff': rt.get('eff'),
            'eff_note': 'rate — EXP/мин (EMA), sec — секунд на моба: chain — цепочка «Охотиться дальше» (≈5,2 с/моб, ≈64,8 тыс. EXP/мин ≈3,9 M/ч), map — через карту (≈11,4 с/моб, ≈23,5 тыс. EXP/мин) (content.js:739)',
            'lootValue_adena': rt.get('lootValue'), 'farmN': rt.get('farmN'),
            'heroMaxHp': {'52': 4022, '53': 4113, 'src': 'rt.rbDb heroMaxHp'},
        },
        'stats_doc': [
            ('MP 928 (~10.10 00:20, «70 из 928»)', 'CHANGELOG-7.1.17'), ('MP 1838–2055 (ночь 10.10, 30–47 ур.)', 'CHANGELOG-7.1.20'),
            ('Max HP 4022 на 52, 4113 на 53; 4 619 HP перед смертью 10.10 23:18 (с баффами)', BP_NOTE + '; CHANGELOG-7.2.3'),
            ('Олимпиада 05–11.10: Warlock 5-й → +500 P/M.Atk, +350 P/M.Def на неделю', 'CHANGELOG-8.0.2; CLAUDE.md'),
            ('Урон мага растёт только от M.Atk (ударные заклинания на максимуме ранга)', 'CLAUDE.md'),
            ('MP_REGEN в бою без банок ≈2,5 MP/с (Гармаш 2,4 · Белефа 2,6 — старые персонажи)', 'content.js MP_REGEN'),
        ],
        'weapons': WEAPONS,
        'armor': 'сет Авадон (Circlet, Gloves, Boots — мантия), см. items.json armor_avadon_set; броню бот не проверяет',
        'pets': {'current': 'Kai the Cat (основной DD, +25 % от M.Atk); с 11.10 есть Feline Queen (support, +10 %)', 'petStat': rt.get('petStat'), 'petAdvice': rt.get('petAdvice'),
                 'petResummon': rt.get('petResummon'), 'cubics': 'кубиков у Warlock на сервере пока нет (игрок написал админу)'},
        'panelKnown_10_10': rt.get('panelKnown'),
        'rules_player': [
            'MP не экономим — приоритет ДПС; режим экономии MP только без банок MP', 'TvT по умолчанию ВКЛ', 'бот стоит, где оставили (пока «Автофарм» выкл.)',
            'автомагистр выключен — скиллы игрок учит сам', 'Coin of Luck и FA не тратить без команды; адену можно', 'квесты — вручную (бот бьёт ★ первыми)',
            'добивание котом — по умолчанию ВЫКЛ', '«Проверять карту каждые 0 боёв» = никогда',
        ],
        'cfg_player_10_10': safe_cfg,
        'bag_10_10_t': K.iso(rt['bagAll'].get('t')),
    }


BUILDERS = {
    'mobs.json': build_mobs, 'zones.json': build_zones, 'raidbosses.json': build_raidbosses, 'skills.json': build_skills,
    'items.json': build_items, 'farm.json': build_farm, 'fishing.json': build_fishing, 'character.json': build_character,
}


def main(names=None):
    res = {}
    for n, f in BUILDERS.items():
        if names and n not in names:
            continue
        o = f()
        p = K.write_json(n, o)
        res[n] = o.get('counts')
        print(f'{n}: {o.get("counts")}  → {os.path.relpath(p, K.REPO)}')
    return res


if __name__ == '__main__':
    main(sys.argv[1:] or None)
