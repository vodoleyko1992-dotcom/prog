// ===== L2wap Bot — Life Stone (аугментация оружия) =====
// 10.0.2 (обновление игры 12.10 «СИСТЕМА LIFE STONE», код игры weapon-augmentation-display.js / augmentation-page.js / battle-hotbar.js):
// на надетом оружии C/B/A/S может стоять один Life Stone. Сервер отдаёт его в /character → inventory.eq.l1.augmentation
// {uid, outcomeId, grade}. Активный ЛС даёт умение ls_<имя> на панели боя (кнопка неактивна, если оружие снято).
// Чистые данные и функции: content.js (бой, сеть), modules/equipment.js (через rt.weaponAug), popup.js (меню).
(function (g) {
  'use strict';
  // k: active — умение на панели боя, positive / negative — пассивный бонус. il — id умения Interlude (иконка игры, skills-il.js).
  // mage / fighter — грубая оценка прибавки урона в процентах для класса (для меню; отрицательная — потеря).
  // Все активные на L2WAP — Power 109 (у Blaze 44): одно нажатие ≈ 2,5 Blaze.
  const OUT = {
    prominence: { n: 'Prominence', d: 'магическая атака огнём · Power 109', k: 'active', il: 1230, mage: 15, fighter: 3 },
    hurricane: { n: 'Hurricane', d: 'магическая атака ветром · Power 109', k: 'active', il: 1239, mage: 15, fighter: 3 },
    hydro_blast: { n: 'Hydro Blast', d: 'магическая атака водой · Power 109', k: 'active', il: 1235, mage: 15, fighter: 3 },
    vampiric_claw: { n: 'Vampiric Claw', d: 'магическая атака с лечением HP · Power 109', k: 'active', il: 1234, mage: 14, fighter: 3 },
    tempest: { n: 'Tempest', d: 'массовая магическая атака · Power 109', k: 'active', il: 1176, mage: 12, fighter: 2 },
    major_heal: { n: 'Major Heal', d: 'сильное лечение HP', k: 'active', il: 1401, mage: 0, fighter: 0 },
    matk_6: { n: 'P.Atk / M.Atk +6%', d: 'пассивный бонус', k: 'positive', mage: 6, fighter: 6 },
    mage_skill_5: { n: 'Сила магических умений +5%', d: 'пассивный бонус', k: 'positive', mage: 5, fighter: 0 },
    magic_crit_chance_10: { n: 'Шанс маг. крита +10%', d: 'пассивный бонус', k: 'positive', mage: 4, fighter: 0 },
    mage_crit_damage_5: { n: 'Сила маг. крита +5%', d: 'пассивный бонус', k: 'positive', mage: 1, fighter: 0 },
    physical_skill_10: { n: 'Сила физ. умений +10%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 7 },
    physical_crit_100: { n: 'Шанс физ. крита +100', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 6 },
    physical_crit_damage_5: { n: 'Сила физ. крита +5%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 2 },
    hp_5: { n: 'Максимум HP +5%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 0 },
    mp_5: { n: 'Максимум MP +5%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 0 },
    pdef_4: { n: 'P.Def +4%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 0 },
    mdef_5: { n: 'M.Def +5%', d: 'пассивный бонус', k: 'positive', mage: 0, fighter: 0 },
    bad_matk_10: { n: 'M.Atk −10%', d: 'отрицательный бонус', k: 'negative', mage: -10, fighter: 0 },
    bad_patk_9: { n: 'P.Atk −9%', d: 'отрицательный бонус', k: 'negative', mage: 0, fighter: -9 },
    bad_pdef_9: { n: 'P.Def −9%', d: 'отрицательный бонус', k: 'negative', mage: 0, fighter: 0 },
    bad_mdef_9: { n: 'M.Def −9%', d: 'отрицательный бонус', k: 'negative', mage: 0, fighter: 0 }
  };
  const POWER = 109;
  // действие боя → id умения Interlude (battle-hotbar.js ACTION_L2_ICON)
  const SKILL_IL = Object.fromEntries(Object.entries(OUT).filter(([, o]) => o.k === 'active').map(([id, o]) => ['ls_' + id, o.il]));
  const isLs = a => /^ls_[a-z_]+$/.test(String(a || ''));
  // Life Stone и Gemstone по грейдам: Life Stone — у Торговца Маммона за Ancient Adena,
  // Gemstone — дешевле всего в магазине игры за адену (gm-shop, «Самоцвіт: ранг X»), у Маммона — за AA
  const LIFE_STONE = { C: 10409, B: 10410, A: 10411, S: 10412 };
  const GEMSTONE = { C: 2131, B: 2132, A: 2133, S: 2134 };
  const LS_AA = { C: 70000, B: 80000, A: 100000, S: 160000 };
  const GEM_AA = { C: 78000, B: 43000, A: 187000, S: 121000 };
  const GEM_ADENA = { C: 3000, B: 10000, A: 30000, S: 100000 };
  // надетое оружие из ответа сервера: {w: itemId, e: заточка, o: outcomeId | null, g: грейд ЛС | null}; без оружия — {w: 0}
  function ofEq(eq) {
    if (!eq || typeof eq !== 'object') return null;
    const l1 = eq.l1;
    if (l1 == null) return { w: 0, e: 0, o: null, g: null };
    const w = typeof l1 === 'number' ? l1 : +l1.itemId || 0, a = typeof l1 === 'object' ? l1.augmentation : null;
    return { w, e: typeof l1 === 'object' ? +l1.enchant || 0 : 0, o: a && typeof a.outcomeId === 'string' ? a.outcomeId : null,
      g: a && a.grade ? String(a.grade).toUpperCase() : null };
  }
  const info = o => (o && OUT[o]) || null;
  function text(a) {
    const m = a && info(a.o);
    if (!a || !a.o) return 'нет';
    return m ? `${m.n} (${m.d}${a.g ? ', ' + a.g : ''})` : a.o;
  }
  // стоит ли держать это оружие ради ЛС: активное умение или положительный бонус
  const keep = a => { const m = a && info(a.o); return !!m && (m.k === 'active' || m.k === 'positive'); };
  // цена одной попытки: Life Stone за AA + Gemstone за адену (или за AA у Маммона)
  const tryCost = gr => { gr = String(gr || '').toUpperCase(); return LIFE_STONE[gr] ? { aa: LS_AA[gr], adena: GEM_ADENA[gr], aaGem: GEM_AA[gr] } : null; };
  g.L2Aug = { OUT, POWER, SKILL_IL, isLs, LIFE_STONE, GEMSTONE, LS_AA, GEM_AA, GEM_ADENA, ofEq, info, text, keep, tryCost };
})(typeof window !== 'undefined' ? window : globalThis);
