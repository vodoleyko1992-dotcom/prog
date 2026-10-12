// 9.2.5 (игрок 12.10: «на основе данных игры разработай фулл баф на РБ и Эпиков за ФА»): готовый набор баффов Fast Aden под класс.
// Данные: каталог баффера FA (GET /character/town/fast-aden-buffer/catalog 12.10: обычный 1 FA, Greater 5 FA, всё на 3 ч, баланс 101 FA),
// подсказки баффов на панели героя (снимки 11.10: Magnus' Chant «M.Atk/M.Def +30 %, каст +20 %, Max MP +20 %», Prophecy of Water
// «M.Atk +20 %, каст +20 %, маг. крит +100 %, Speed −20 %», Song of Warding M.Def +30 %, Song of Earth P.Def +25 %, Wild Magic маг. крит +2 %,
// Greater Shield P.Def +5 %), замеры логов (Magnus' Chant = +13–18 % к урону заклинаний и кота — урон растёт как √M.Atk;
// Blaze ≈1730 → 2770–3600 под набором FA, маг. крит 0 → 28–43 %; Дар Серафима: сервер принимает заклинание через ≈0,85 с вместо ≈1,1 с).
// Скорость каста у героя упёрлась в 3500 и с городским набором (/character 11.10 и 12.10) — баффы каста (Acumen Lv.3, Dance of
// Concentration) магу урона не добавляют, их нет в наборе. Порядок = приоритет покупки (FA не хватает — берутся первые по карману).
// Стакаются ли Greater-баффы между собой, игра не пишет: бот сам замечает, что покупка сняла другой бафф (rt.faClash), и пару больше не берёт.
(function (G) {
  'use strict';
  const SETS = {
    mage: [
      [1413, 'урон', "Magnus' Chant: M.Atk +30 % (≈+14 % урона заклинаний, кот — по M.Atk), M.Def +30 %"],
      [1323, 'защита', 'Noblesse Blessing: смерть снимает только его, остальные баффы остаются'],
      [365, 'урон', 'Dance of Siren: шанс маг. крита (крит ≈×1,9 урона)'],
      [1303, 'урон', 'Wild Magic Lv.2: шанс маг. крита'],
      [273, 'урон', 'Dance of Mystic: M.Atk группы (и кот)'],
      [4703, 'темп', 'Дар Серафима: откат −30 % (заклинание через ≈0,85 с вместо ≈1,1 с)'],
      [1059, 'урон', 'Empower Lv.3 (в городе Lv.2): M.Atk'],
      [1062, 'урон', 'Berserker Lv.2 (в городе Lv.1): M.Atk, но M.Def ниже'],
      [267, 'защита', 'Song of Warding: M.Def +30 % (спецудары РБ — магические)'],
      [1036, 'защита', 'Магический барьер Lv.2 (в городе Lv.1, M.Def +23 %)'],
      [264, 'защита', 'Song of Earth: P.Def +25 %'],
      [1045, 'защита', 'Благословение тела Lv.6 (в городе Lv.5, HP +10 %)'],
      [304, 'защита', 'Song of Vitality: Max HP группы'],
      [1389, 'защита', 'Great Shield Lv.3: P.Def +5 %'],
    ],
    fighter: [
      [1414, 'урон', "Victories of Pa'agrio: HP, атака, защита, скорость, крит, резисты"],
      [1323, 'защита', 'Noblesse Blessing: смерть снимает только его'],
      [4699, 'урон', 'Blessing of Queen Lv.3: шанс физ. крита +30 %, урон крита +25 %'],
      [1388, 'урон', 'Greater Might Lv.3: P.Atk'],
      [1068, 'урон', 'Might Lv.3 (в городе Lv.2, +8 %): P.Atk'],
      [271, 'урон', 'Dance of Warrior: P.Atk группы'],
      [275, 'урон', 'Dance of Fury: скорость атаки группы'],
      [1086, 'урон', 'Haste Lv.2 (в городе Lv.1, +15 %): скорость атаки'],
      [1077, 'урон', 'Focus Lv.3 (в городе Lv.2): шанс физ. крита'],
      [269, 'урон', 'Song of Hunter: шанс физ. крита группы'],
      [1062, 'урон', 'Berserker Lv.2: атака и скорость, защита ниже'],
      [4703, 'темп', 'Дар Серафима: откат умений −30 %'],
      [1240, 'урон', 'Guidance Lv.3: точность'],
      [272, 'урон', 'Dance of Inspiration: точность группы'],
      [1268, 'защита', 'Vampiric Rage Lv.4: вампиризм от ударов'],
      [267, 'защита', 'Song of Warding: M.Def +30 %'],
      [264, 'защита', 'Song of Earth: P.Def +25 %'],
      [1040, 'защита', 'Shield Lv.3 (в городе Lv.2, +8 %)'],
      [1389, 'защита', 'Great Shield Lv.3'],
      [1036, 'защита', 'Магический барьер Lv.2'],
      [1045, 'защита', 'Благословение тела Lv.6'],
      [304, 'защита', 'Song of Vitality: Max HP группы'],
    ],
  };
  // уровень баффа у баффера FA (там, где он выше городского набора): в шапке этот номер с уровнем ниже — городской, FA его поднимет
  const UP = { 1036: 2, 1040: 3, 1045: 6, 1048: 6, 1059: 3, 1062: 2, 1068: 3, 1077: 3, 1085: 3, 1086: 2, 1240: 3, 1268: 4, 4699: 3 };
  const COST = { 1413: 5, 1414: 5, 1363: 5, 1356: 5, 1357: 5, 1355: 5, 1323: 5 };
  const kind = role => (role && role.mage) || role === 'mage' ? 'mage' : 'fighter';
  const isAuto = v => { const s = String(v ?? '').trim(); return !s || /^(auto|авто)$/i.test(s); };
  const ids = role => SETS[kind(role)].map(x => x[0]);
  const cost = (role, costOf) => ids(role).reduce((a, id) => a + (+(costOf ? costOf(id) : 0) || COST[id] || 1), 0);
  // список «баффы РБ-сессии / эпиков»: «auto» (или пусто) — набор под класс, иначе номера игрока как есть
  const resolve = (v, role) => isAuto(v) ? ids(role) : String(v).split(/[,\s]+/).map(x => +x).filter(x => x > 0);
  // покупка X сняла Y (rt.faClash { X: [Y…] }) — из пары оставляем того, кто раньше в списке
  function dropClash(list, clash) {
    const C = clash || {}, out = [];
    for (const id of list) if (!out.some(k => (C[k] || []).includes(id) || (C[id] || []).includes(k))) out.push(id);
    return out;
  }
  G.L2FaFull = { SETS, UP, COST, kind, isAuto, ids, cost, resolve, dropClash };
})(typeof globalThis !== 'undefined' ? globalThis : this);
